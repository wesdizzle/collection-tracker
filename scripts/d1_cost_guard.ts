/**
 * D1 PRE-FLIGHT COST GUARD, SCHEMA DIFFER & STATIC CI AUDITOR (collection-tracker)
 *
 * Supports three modes via `@wesdizzle/app-kit/scripts`:
 * 1. Static CI Schema & Query Plan Audit (default when invoked without `--file=`):
 *    Applies `migrations/schema.sql` in `:memory:`, verifies `(1 + K)` index bounds,
 *    and audits `EXPLAIN QUERY PLAN` on critical runtime queries.
 * 2. Pre-Flight SQL Delta Sandbox Audit (`--file=<sql>` [--max-writes=<N>] [--confirm]):
 *    Profiles a SQL delta file against `data/remote_baseline.db` before any remote write.
 * 3. Declarative Schema Diff (`--diff`):
 *    Compares `data/remote_baseline.db` against `migrations/schema.sql` via `diffSqliteSchema`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  auditSqlCost as kitAuditSqlCost,
  CostGuardReport,
  diffSqliteSchema,
  extractTargetTable,
  isCreateIndexStatement,
  isInsertOrReplaceStatement,
  isSecondaryIndexOrigin,
  isTableWithoutRowid,
  loadDeployEnv,
  printCostReport,
  runStaticSchemaCostGuard,
  runWithD1CostGuard as kitRunWithD1CostGuard,
  SchemaDiffReport,
  splitSqlStatements,
  StaticSchemaCostGuardConfig,
  stripLeadingSqlComments,
  TableWriteCost,
} from '@wesdizzle/app-kit/scripts';

export type StaticSchemaCostGuardResult = ReturnType<
  typeof runStaticSchemaCostGuard
>;

export type {
  CostGuardReport,
  SchemaDiffReport,
  StaticSchemaCostGuardConfig,
  TableWriteCost,
};
export {
  diffSqliteSchema,
  extractTargetTable,
  isCreateIndexStatement,
  isInsertOrReplaceStatement,
  isSecondaryIndexOrigin,
  isTableWithoutRowid,
  printCostReport,
  runStaticSchemaCostGuard,
  splitSqlStatements,
  stripLeadingSqlComments,
};

export interface CostGuardOptions {
  sqlFilePath: string;
  maxWrites?: number;
  baselineDbPath?: string;
  isDryRun?: boolean;
  confirm?: boolean;
  executeRemote?: boolean;
  remoteDbName?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

export const SCHEMA_SQL_PATH = path.join(rootDir, 'migrations', 'schema.sql');

export const REMOTE_BASELINE_DB_PATH = path.join(
  rootDir,
  'data',
  'remote_baseline.db',
);

export const REMOTE_MIGRATIONS_LOG_PATH = path.join(
  rootDir,
  'data',
  'remote_migrations_log.json',
);

export const PROTECTED_TABLES = [
  'games',
  'toys',
  'game_releases',
  'canonical_releases',
  'users',
  'user_games',
  'user_toys',
  'user_game_releases',
  'user_tracking_rules',
  'journal_entries',
] as const;

export const MAX_SECONDARY_INDEXES: Record<string, number> = {
  users: 2,
  games: 8,
  game_releases: 6,
  toys: 5,
  user_games: 1,
  user_game_releases: 1,
  user_toys: 1,
  user_tracking_rules: 0,
  journal_entries: 1,
};

export function runCollectionStaticSchemaCostGuard(
  schemaPath = SCHEMA_SQL_PATH,
): StaticSchemaCostGuardResult {
  return runStaticSchemaCostGuard({
    schemaSqlPaths: [schemaPath],
    maxSecondaryIndexes: MAX_SECONDARY_INDEXES,
    criticalQueries: [
      {
        name: 'user lookup by id',
        sql: 'SELECT id, username, oidc_sub, is_public, home_region FROM users WHERE id = ?',
        params: [1],
      },
      {
        name: 'user lookup by username',
        sql: 'SELECT id, username, oidc_sub, is_public, home_region FROM users WHERE username = ? COLLATE NOCASE',
        params: ['alice'],
      },
      {
        name: 'user lookup by oidc_sub',
        sql: 'SELECT id, username, oidc_sub FROM users WHERE oidc_sub = ? AND oidc_sub IS NOT NULL',
        params: ['sub-123'],
      },
      {
        name: 'game lookup by stable_id',
        sql: 'SELECT stable_id, id, title FROM games WHERE stable_id = ?',
        params: [1],
      },
      {
        name: 'game lookup by igdb_id',
        sql: 'SELECT stable_id, id, title FROM games WHERE igdb_id = ? AND igdb_id IS NOT NULL',
        params: [100],
      },
      {
        name: 'game lookup by title COLLATE NOCASE',
        sql: 'SELECT stable_id, id, title FROM games WHERE title = ? COLLATE NOCASE',
        params: ['Super Mario Odyssey'],
      },
      {
        name: 'releases lookup by game_id',
        sql: 'SELECT id, game_id, region, release_date FROM game_releases WHERE game_id = ?',
        params: [1],
      },
      {
        name: 'journal lookup by (user_id, item_type, item_id)',
        sql: 'SELECT id, purchase_date, price_paid, notes FROM journal_entries WHERE user_id = ? AND item_type = ? AND item_id = ?',
        params: [1, 'game', '1'],
      },
      {
        name: 'backup apply: source completeness lookup',
        sql: 'SELECT release_id, ownership_status, has_case, has_manual FROM user_game_releases WHERE user_id = ? AND release_id IN (?)',
        params: [1, 'rel-1'],
      },
      {
        name: 'backup apply: clear source release ownership',
        sql: `UPDATE user_game_releases
              SET ownership_status = 0,
                  has_case = 0,
                  has_manual = 0,
                  backup_status = CASE WHEN ? = 1 THEN 0 ELSE backup_status END
              WHERE user_id = ? AND release_id = ?
                AND (ownership_status != 0 OR has_case != 0 OR has_manual != 0 OR (? = 1 AND backup_status != 0))`,
        params: [1, 1, 'rel-1', 1],
      },
      {
        name: 'backup apply: target ownership + backup UPSERT',
        sql: `INSERT INTO user_game_releases (user_id, release_id, ownership_status, backup_status, has_case, has_manual)
              SELECT ?, id, 1, ?, ?, ? FROM game_releases WHERE id = ?
              ON CONFLICT(user_id, release_id) DO UPDATE SET
                ownership_status = 1,
                backup_status = CASE WHEN ? = 1 THEN 1 ELSE user_game_releases.backup_status END,
                has_case = MAX(user_game_releases.has_case, excluded.has_case),
                has_manual = MAX(user_game_releases.has_manual, excluded.has_manual)
              WHERE user_game_releases.ownership_status IS NOT 1
                 OR (? = 1 AND user_game_releases.backup_status IS NOT 1)
                 OR user_game_releases.has_case < excluded.has_case
                 OR user_game_releases.has_manual < excluded.has_manual`,
        params: [1, 1, 1, 1, 'rel-2', 1, 1],
      },
      {
        name: 'backup apply: setBackedUp UPSERT',
        sql: `INSERT INTO user_game_releases (user_id, release_id, backup_status)
              SELECT ?, id, 1 FROM game_releases WHERE id = ?
              ON CONFLICT(user_id, release_id) DO UPDATE SET
                backup_status = 1
              WHERE user_game_releases.backup_status IS NOT 1`,
        params: [1, 'rel-1'],
      },
    ],
  });
}

export function auditSqlCost(
  sqlFilePath: string,
  maxAllowedWrites = 5000,
  baselineDbPath = REMOTE_BASELINE_DB_PATH,
): CostGuardReport {
  return kitAuditSqlCost(sqlFilePath, maxAllowedWrites, {
    baselineDbPath,
    protectedTables: PROTECTED_TABLES,
  });
}

export function runWithD1CostGuard(options: CostGuardOptions): CostGuardReport {
  const executeRemote = Boolean(
    options.executeRemote || (options.confirm && !options.isDryRun),
  );
  return kitRunWithD1CostGuard({
    sqlFilePath: options.sqlFilePath,
    maxWrites: options.maxWrites ?? 5000,
    executeRemote,
    remoteDbName: options.remoteDbName || 'collection-db',
    rootDir,
    baselineDbPath: options.baselineDbPath || REMOTE_BASELINE_DB_PATH,
    migrationsLogPath: REMOTE_MIGRATIONS_LOG_PATH,
    protectedTables: PROTECTED_TABLES,
    patchWranglerConfig: <T>(fn: () => T): T => {
      const wranglerPath = path.join(rootDir, 'wrangler.toml');
      const env = loadDeployEnv(rootDir);
      const d1DatabaseId = env['D1_DATABASE_ID']?.trim();
      if (!d1DatabaseId || d1DatabaseId === 'local-dev-db') {
        throw new Error(
          '[CostGuard] D1_DATABASE_ID is required in .dev.vars or environment variables for remote execution.',
        );
      }
      const originalWrangler = fs.readFileSync(wranglerPath, 'utf-8');
      if (!originalWrangler.includes('database_id = "local-dev-db"')) {
        throw new Error(
          '[CostGuard] Expected placeholder database_id = "local-dev-db" in wrangler.toml.',
        );
      }
      const patchedWrangler = originalWrangler.replace(
        'database_id = "local-dev-db"',
        `database_id = "${d1DatabaseId}"`,
      );
      try {
        fs.writeFileSync(wranglerPath, patchedWrangler, 'utf-8');
        return fn();
      } finally {
        fs.writeFileSync(wranglerPath, originalWrangler, 'utf-8');
      }
    },
  });
}

function runCli(): void {
  const args = process.argv.slice(2);
  let sqlFilePath = '';
  let maxWrites = 5000;
  let confirm = false;
  let isDryRun = true;
  let diffMode = false;

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
    } else if (arg === '--diff') {
      diffMode = true;
    }
  }

  if (diffMode) {
    const diff = diffSqliteSchema(REMOTE_BASELINE_DB_PATH, SCHEMA_SQL_PATH);
    if (diff.inSync) {
      console.log(
        '[SchemaDiff] ✅ data/remote_baseline.db matches migrations/schema.sql.',
      );
    } else {
      if (diff.additiveSql.length > 0) {
        console.log('[SchemaDiff] Additive SQL delta:');
        for (const stmt of diff.additiveSql) {
          console.log(`  ${stmt}`);
        }
      }
      if (diff.manualReviewWarnings.length > 0) {
        console.warn('[SchemaDiff] Manual review warnings:');
        for (const w of diff.manualReviewWarnings) {
          console.warn(`  ⚠️ ${w}`);
        }
      }
    }
    return;
  }

  if (!sqlFilePath) {
    const result = runCollectionStaticSchemaCostGuard();
    for (const line of result.tableSummaries) {
      console.log(line);
    }
    if (!result.passed) {
      for (const err of result.errors) {
        console.error(`[d1-cost-guard] ❌ ${err}`);
      }
      process.exit(1);
    }
    console.log(
      '[d1-cost-guard] ✅ Static schema index bounds and runtime query plans verified.',
    );
    return;
  }

  runWithD1CostGuard({ sqlFilePath, maxWrites, confirm, isDryRun });
}

const isMainModule =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  try {
    runCli();
  } catch (err) {
    console.error('Fatal Cost Guard Error:', err);
    process.exit(1);
  }
}
