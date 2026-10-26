/**
 * PRE-FLIGHT CLOUDFLARE D1 COST GUARD & RUNNER
 *
 * Enforces zero-unbudgeted-mutation safety for Cloudflare D1 migrations:
 * 1. Simulates execution against an isolated sandbox clone of `data/remote_baseline.db`.
 * 2. Audits every statement with `EXPLAIN QUERY PLAN` to detect unindexed table scans.
 * 3. Calculates exact index write amplification: Sum(Delta_rows * (1 + K_indexes)).
 * 4. Hard-aborts if projected billable writes exceed `--max-writes`.
 * 5. Executes against remote D1 only with explicit `--confirm` and updates the baseline.
 *
 * USAGE:
 *   npx tsx scripts/lib/d1_cost_guard.ts --file=<path.sql> --max-writes=<N> [--dry-run | --confirm]
 */

import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

export interface CostGuardReport {
  file: string;
  statementCount: number;
  tableBreakdown: Record<
    string,
    {
      rowsChanged: number;
      secondaryIndexes: number;
      multiplier: number;
      billableWrites: number;
    }
  >;
  totalRowsChanged: number;
  totalBillableWrites: number;
  maxWritesAllowed: number;
  isWithinBudget: boolean;
  unindexedScans: Array<{ statement: string; plan: string }>;
}

export interface CostGuardOptions {
  sqlFilePath: string;
  maxWrites: number;
  baselineDbPath?: string;
  isDryRun?: boolean;
  confirm?: boolean;
}

/**
 * Splits a SQL script into individual executable statements,
 * correctly ignoring semicolons inside strings and line comments.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inString: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const nextCh = sql[i + 1];

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
      }
      current += ch;
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && nextCh === '/') {
        inBlockComment = false;
        current += '*/';
        i++;
        continue;
      }
      current += ch;
      continue;
    }

    if (inString) {
      if (ch === inString) {
        // Escaped quote: ''
        if (nextCh === inString) {
          current += ch + nextCh;
          i++;
          continue;
        }
        inString = null;
      }
      current += ch;
      continue;
    }

    // Check for comment starts
    if (ch === '-' && nextCh === '-') {
      inLineComment = true;
      current += '--';
      i++;
      continue;
    }
    if (ch === '/' && nextCh === '*') {
      inBlockComment = true;
      current += '/*';
      i++;
      continue;
    }

    // Check for string starts
    if (ch === "'" || ch === '"') {
      inString = ch;
      current += ch;
      continue;
    }

    // Statement terminator
    if (ch === ';') {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = '';
      continue;
    }

    current += ch;
  }

  const remainder = current.trim();
  if (remainder.length > 0) {
    statements.push(remainder);
  }

  return statements;
}

/**
 * Identifies the primary table targeted by an INSERT, UPDATE, or DELETE statement.
 */
export function extractTargetTable(sql: string): string | null {
  const normalized = sql.replace(/\s+/g, ' ').trim();
  const match = normalized.match(
    /^(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM)\s+[`"']?([a-zA-Z0-9_]+)[`"']?/i,
  );
  return match ? match[1].toLowerCase() : null;
}

/**
 * Executes a full pre-flight audit against a clone of the baseline database.
 */
export function auditSqlCost(
  sqlFilePath: string,
  maxWrites: number,
  baselineDbPath?: string,
): CostGuardReport {
  const rootDir = process.cwd();
  const baselinePath =
    baselineDbPath || path.join(rootDir, 'data', 'remote_baseline.db');

  if (!fs.existsSync(baselinePath)) {
    throw new Error(
      `Remote baseline database not found at ${baselinePath}. Run 'npx tsx scripts/d1_pull_r2_snapshot.ts' first to download the latest R2 snapshot.`,
    );
  }

  if (!fs.existsSync(sqlFilePath)) {
    throw new Error(`SQL file not found at ${sqlFilePath}`);
  }

  const tempDir = path.join(rootDir, 'scripts', 'temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const sandboxDbPath = path.join(tempDir, '_cost_guard_sandbox.db');
  if (fs.existsSync(sandboxDbPath)) fs.unlinkSync(sandboxDbPath);

  // Copy baseline to sandbox
  fs.copyFileSync(baselinePath, sandboxDbPath);

  const sandboxDb = new Database(sandboxDbPath);
  sandboxDb.pragma('journal_mode = OFF');
  sandboxDb.pragma('synchronous = OFF');

  // Discover all tables and index multipliers (1 + K)
  const tables = sandboxDb
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
    )
    .pluck()
    .all() as string[];

  const indexMultipliers: Record<
    string,
    { secondaryIndexes: number; multiplier: number }
  > = {};
  for (const table of tables) {
    const indexes = sandboxDb
      .prepare(`PRAGMA index_list("${table}")`)
      .all() as Array<{ name: string; origin: string }>;
    // Filter out primary key auto-index
    const secondary = indexes.filter((idx) => idx.origin === 'c');
    indexMultipliers[table.toLowerCase()] = {
      secondaryIndexes: secondary.length,
      multiplier: 1 + secondary.length,
    };
  }

  const rawSql = fs.readFileSync(sqlFilePath, 'utf8');
  const statements = splitSqlStatements(rawSql);

  const unindexedScans: Array<{ statement: string; plan: string }> = [];
  const tableBreakdown: CostGuardReport['tableBreakdown'] = {};
  let totalRowsChanged = 0;
  let totalBillableWrites = 0;

  // Audit and execute inside sandbox
  sandboxDb.exec('BEGIN TRANSACTION;');
  try {
    for (const stmt of statements) {
      const targetTable = extractTargetTable(stmt);

      // Audit query plan for unindexed scans on large tables
      try {
        const planRows = sandboxDb
          .prepare(`EXPLAIN QUERY PLAN ${stmt}`)
          .all() as Array<{ detail: string }>;
        for (const row of planRows) {
          const detail = row.detail.toUpperCase();
          if (
            detail.includes('SCAN TABLE') &&
            (detail.includes('GAMES') ||
              detail.includes('GAME_RELEASES') ||
              detail.includes('CANONICAL_RELEASES') ||
              detail.includes('TOYS'))
          ) {
            unindexedScans.push({ statement: stmt, plan: row.detail });
          }
        }
      } catch {
        // Some statements (e.g. PRAGMA) might not support EXPLAIN QUERY PLAN
      }

      // Execute statement and measure changes
      sandboxDb.exec(stmt);
      const changes = sandboxDb
        .prepare('SELECT changes() as c')
        .pluck()
        .get() as number;

      if (targetTable && changes > 0) {
        const idxInfo = indexMultipliers[targetTable] || {
          secondaryIndexes: 0,
          multiplier: 1,
        };
        const billable = changes * idxInfo.multiplier;

        if (!tableBreakdown[targetTable]) {
          tableBreakdown[targetTable] = {
            rowsChanged: 0,
            secondaryIndexes: idxInfo.secondaryIndexes,
            multiplier: idxInfo.multiplier,
            billableWrites: 0,
          };
        }

        tableBreakdown[targetTable].rowsChanged += changes;
        tableBreakdown[targetTable].billableWrites += billable;
        totalRowsChanged += changes;
        totalBillableWrites += billable;
      }
    }
    sandboxDb.exec('ROLLBACK;');
  } finally {
    sandboxDb.close();
    if (fs.existsSync(sandboxDbPath)) fs.unlinkSync(sandboxDbPath);
  }

  return {
    file: sqlFilePath,
    statementCount: statements.length,
    tableBreakdown,
    totalRowsChanged,
    totalBillableWrites,
    maxWritesAllowed: maxWrites,
    isWithinBudget:
      totalBillableWrites <= maxWrites && unindexedScans.length === 0,
    unindexedScans,
  };
}

/**
 * Runs the Cost Guard check and optionally applies the migration to remote D1.
 */
export function runWithD1CostGuard(options: CostGuardOptions): CostGuardReport {
  const report = auditSqlCost(
    options.sqlFilePath,
    options.maxWrites,
    options.baselineDbPath,
  );

  console.log('\n======================================================');
  console.log('🛡️  CLOUDFLARE D1 PRE-FLIGHT COST GUARD REPORT');
  console.log('======================================================');
  console.log(`File:              ${report.file}`);
  console.log(`Statements:        ${report.statementCount}`);
  console.log(`Total Rows Mutated:${report.totalRowsChanged}`);
  console.log(`Billable Writes:   ${report.totalBillableWrites}`);
  console.log(`Max Writes Cap:    ${report.maxWritesAllowed}`);
  console.log('------------------------------------------------------');
  console.log('Table Breakdown (accounting for 1 + K secondary indexes):');

  for (const [table, data] of Object.entries(report.tableBreakdown)) {
    console.log(
      `  • ${table.padEnd(20)}: ${String(data.rowsChanged).padStart(5)} rows × ${data.multiplier}x (1+${data.secondaryIndexes} idx) = ${String(data.billableWrites).padStart(6)} billable writes`,
    );
  }

  if (report.unindexedScans.length > 0) {
    console.error('\n❌ UNINDEXED TABLE SCAN(S) DETECTED:');
    for (const scan of report.unindexedScans) {
      console.error(`  - Plan: ${scan.plan}`);
      console.error(`    SQL:  ${scan.statement.slice(0, 120)}...`);
    }
  }

  console.log('------------------------------------------------------');
  if (!report.isWithinBudget) {
    if (report.totalBillableWrites > report.maxWritesAllowed) {
      console.error(
        `❌ ABORTED: Projected billable writes (${report.totalBillableWrites}) exceed quota cap (${report.maxWritesAllowed})!`,
      );
    }
    if (report.unindexedScans.length > 0) {
      console.error(
        `❌ ABORTED: Found ${report.unindexedScans.length} unindexed table scan(s)!`,
      );
    }
    throw new Error('Pre-flight cost guard validation failed.');
  }

  console.log(
    '✅ PRE-FLIGHT CHECKS PASSED: Within quota budget and 0 unindexed scans.',
  );

  if (options.confirm) {
    console.log('\n🚀 Executing migration against remote Cloudflare D1...');
    const fileSize = fs.statSync(options.sqlFilePath).size;
    const MAX_CHUNK_BYTES = 7500;

    if (fileSize <= MAX_CHUNK_BYTES) {
      execSync(
        `npx wrangler d1 execute collection-db --remote --file="${options.sqlFilePath}"`,
        { stdio: 'inherit' },
      );
    } else {
      const rawSql = fs.readFileSync(options.sqlFilePath, 'utf8');
      const statements = splitSqlStatements(rawSql);
      const chunks: string[] = [];
      let currentChunk: string[] = [];
      let currentSize = 0;

      for (const stmt of statements) {
        const stmtWithSemi = stmt.endsWith(';') ? stmt : `${stmt};`;
        if (
          currentSize + stmtWithSemi.length + 1 > MAX_CHUNK_BYTES &&
          currentChunk.length > 0
        ) {
          chunks.push(currentChunk.join('\n'));
          currentChunk = [stmtWithSemi];
          currentSize = stmtWithSemi.length;
        } else {
          currentChunk.push(stmtWithSemi);
          currentSize += stmtWithSemi.length + 1;
        }
      }
      if (currentChunk.length > 0) {
        chunks.push(currentChunk.join('\n'));
      }

      console.log(
        `📦 File size (${(fileSize / 1024).toFixed(1)} KB) exceeds 7.5 KB. Executing via ${chunks.length} safe direct-execute batches...`,
      );
      const tempChunkPath = path.join(
        process.cwd(),
        'scripts',
        'temp',
        '_d1_cost_guard_chunk.sql',
      );

      try {
        for (let i = 0; i < chunks.length; i++) {
          console.log(
            `  [${i + 1}/${chunks.length}] Executing batch (${chunks[i].length} bytes)...`,
          );
          fs.writeFileSync(tempChunkPath, chunks[i], 'utf8');
          execSync(
            `npx wrangler d1 execute collection-db --remote --file="${tempChunkPath}"`,
            { stdio: 'inherit' },
          );
        }
      } finally {
        if (fs.existsSync(tempChunkPath)) {
          fs.unlinkSync(tempChunkPath);
        }
      }
    }

    // Apply to local baseline DB so it stays in lockstep
    const baselinePath =
      options.baselineDbPath ||
      path.join(process.cwd(), 'data', 'remote_baseline.db');
    if (fs.existsSync(baselinePath)) {
      console.log(
        '🔄 Synchronizing remote_baseline.db with applied migration...',
      );
      const baselineDb = new Database(baselinePath);
      baselineDb.exec(fs.readFileSync(options.sqlFilePath, 'utf8'));
      baselineDb.close();
    }

    // Append to remote migrations log
    const logPath = path.join(
      process.cwd(),
      'data',
      'remote_migrations_log.json',
    );
    const existingLog: Array<{
      file: string;
      timestamp: string;
      billableWrites: number;
    }> = fs.existsSync(logPath)
      ? JSON.parse(fs.readFileSync(logPath, 'utf8'))
      : [];

    existingLog.push({
      file: options.sqlFilePath,
      timestamp: new Date().toISOString(),
      billableWrites: report.totalBillableWrites,
    });
    fs.writeFileSync(logPath, JSON.stringify(existingLog, null, 2));
    console.log(`📝 Logged migration to ${logPath}`);
  } else {
    console.log('ℹ️  Dry-run complete. Pass --confirm to execute remotely.');
  }

  return report;
}

// CLI entry point
function parseArgs(): CostGuardOptions {
  const args = process.argv.slice(2);
  let sqlFilePath = '';
  let maxWrites = 5000;
  let confirm = false;
  let isDryRun = true;

  for (const arg of args) {
    if (arg.startsWith('--file=')) {
      sqlFilePath = arg.slice(7);
    } else if (arg.startsWith('--max-writes=')) {
      maxWrites = parseInt(arg.slice(13), 10);
    } else if (arg === '--confirm') {
      confirm = true;
      isDryRun = false;
    } else if (arg === '--dry-run') {
      isDryRun = true;
      confirm = false;
    }
  }

  if (!sqlFilePath) {
    console.error(
      'Usage: npx tsx scripts/lib/d1_cost_guard.ts --file=<sql-path> [--max-writes=<N>] [--confirm | --dry-run]',
    );
    process.exit(1);
  }

  return { sqlFilePath, maxWrites, confirm, isDryRun };
}

const isMainModule =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  try {
    const opts = parseArgs();
    runWithD1CostGuard(opts);
  } catch (err) {
    console.error('Fatal Cost Guard Error:', err);
    process.exit(1);
  }
}
