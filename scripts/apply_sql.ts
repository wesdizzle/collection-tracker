/**
 * LOCAL SQL SCRIPT APPLIER
 *
 * Applies a generated SQL migration file (such as from scripts/temp/)
 * directly and atomically to the local SQLite database.
 *
 * USAGE:
 *   npm run db:apply scripts/temp/update_backup_status.sql
 *   npx tsx scripts/apply_sql.ts <path-to-sql> [--dry-run]
 */

import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { getLocalD1Path } from './lib/db.js';

export function applySqlFile(
  filePath: string,
  options: { dryRun?: boolean; dbPath?: string } = {},
): { statementCount: number; executionTimeMs: number } {
  const resolvedPath = path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`SQL file not found at: ${resolvedPath}`);
  }

  const stat = fs.statSync(resolvedPath);
  if (stat.size === 0) {
    throw new Error(`SQL file is empty: ${resolvedPath}`);
  }

  const sqlContent = fs.readFileSync(resolvedPath, 'utf8');
  const dbPath = options.dbPath || getLocalD1Path();

  // Count executable DML / DDL statements
  const statementMatches = sqlContent.match(
    /(?:^|\n)\s*(?:UPDATE|INSERT|DELETE|CREATE|ALTER|DROP|PRAGMA)\b/gi,
  );
  const statementCount = statementMatches ? statementMatches.length : 0;

  console.log(
    `[db:apply] Target file: ${path.relative(process.cwd(), resolvedPath)}`,
  );
  console.log(`[db:apply] Statements detected: ${statementCount}`);
  console.log(`[db:apply] Target database: ${dbPath}`);

  if (options.dryRun) {
    console.log(
      '[db:apply] [DRY RUN] Verification complete. Database was not modified.',
    );
    return { statementCount, executionTimeMs: 0 };
  }

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Target database not found at: ${dbPath}`);
  }

  const startTime = Date.now();
  const db = new Database(dbPath);

  try {
    const tx = db.transaction(() => {
      db.exec(sqlContent);
    });
    tx();
  } finally {
    db.close();
  }

  const executionTimeMs = Date.now() - startTime;
  console.log(
    `[db:apply] Successfully applied ${statementCount} statement(s) in ${executionTimeMs}ms.`,
  );

  return { statementCount, executionTimeMs };
}

function main(): void {
  const args = process.argv.slice(2);
  const nonFlagArgs = args.filter((a) => !a.startsWith('--'));

  if (nonFlagArgs.length === 0) {
    console.error('Error: Please provide the path to a SQL file.');
    console.log('Usage: npm run db:apply <path-to-sql> [--dry-run]');
    process.exit(1);
  }

  const targetFile = nonFlagArgs[0];
  const isDryRun = args.includes('--dry-run');

  try {
    applySqlFile(targetFile, { dryRun: isDryRun });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[db:apply] Error: ${message}`);
    process.exit(1);
  }
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith('apply_sql.ts') ||
    process.argv[1].endsWith('apply_sql.js'))
) {
  main();
}
