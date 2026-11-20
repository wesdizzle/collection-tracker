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
import {
  ACTIVE_GAMES_LIST_WHERE_CLAUSE,
  ACTIVE_GAMES_PUBLIC_WHERE_CLAUSE,
  buildCatalogGamesChunkQuery,
  buildGamesListQuery,
  CATALOG_GAMES_CHUNK_BOUND_QUERY,
  CATALOG_MAX_GAME_STABLE_ID_QUERY,
  CATALOG_MAX_TOY_STABLE_ID_QUERY,
} from '../shared/queries.js';

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
  'price_query_overrides',
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
  price_query_overrides: 0,
};

export const D1_MAX_COMPOUND_SELECT_TERMS = 5;

/**
 * Counts the maximum number of compound `SELECT` branches joined by `UNION`,
 * `UNION ALL`, `INTERSECT`, or `EXCEPT` within any single parenthesis scope.
 * Cloudflare D1 enforces SQLite's `SQLITE_MAX_COMPOUND_SELECT = 5` limit per scope.
 */
export function getMaxCompoundSelectTerms(sql: string): number {
  const scopeTermCounts: number[] = [1];
  let maxTerms = 1;
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];
    const next = i + 1 < sql.length ? sql[i + 1] : '';

    if (ch === '-' && next === '-') {
      i += 2;
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (
        i < sql.length &&
        !(sql[i] === '*' && i + 1 < sql.length && sql[i + 1] === '/')
      ) {
        i++;
      }
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (i + 1 < sql.length && sql[i + 1] === quote) {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === '[') {
      i++;
      while (i < sql.length && sql[i] !== ']') i++;
      i++;
      continue;
    }
    if (ch === '(') {
      scopeTermCounts.push(1);
      i++;
      continue;
    }
    if (ch === ')') {
      if (scopeTermCounts.length > 1) {
        scopeTermCounts.pop();
      }
      i++;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      i++;
      while (i < sql.length && /[A-Za-z0-9_]/.test(sql[i])) i++;
      const word = sql.slice(start, i).toUpperCase();
      if (word === 'UNION' || word === 'INTERSECT' || word === 'EXCEPT') {
        const nextCount = ++scopeTermCounts[scopeTermCounts.length - 1];
        if (nextCount > maxTerms) {
          maxTerms = nextCount;
        }
      }
      continue;
    }
    i++;
  }

  return maxTerms;
}

export function runCollectionStaticSchemaCostGuard(
  schemaPath = SCHEMA_SQL_PATH,
): StaticSchemaCostGuardResult {
  const criticalQueries = [
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
      name: 'price query override lookup by PK',
      sql: 'SELECT custom_query, updated_at FROM price_query_overrides WHERE item_type = ? AND item_id = ?',
      params: ['game', 'super-mario-odyssey-nintendo-switch'],
    },
    {
      name: 'price query overrides batch lookup by PK',
      sql: 'SELECT item_type, item_id, custom_query FROM price_query_overrides WHERE item_type = ? AND item_id IN (?)',
      params: ['game', 'super-mario-odyssey-nintendo-switch'],
    },
    {
      name: 'verify-ownership apply: source completeness lookup',
      sql: 'SELECT release_id, ownership_status, has_case, has_manual FROM user_game_releases WHERE user_id = ? AND release_id IN (?)',
      params: [1, 'rel-1'],
    },
    {
      name: 'verify-ownership apply: clear source release ownership',
      sql: `UPDATE user_game_releases
              SET ownership_status = 0,
                  has_case = 0,
                  has_manual = 0,
                  has_media = CASE WHEN ? = 1 THEN 0 ELSE has_media END
              WHERE user_id = ? AND release_id = ?
                AND (ownership_status != 0 OR has_case != 0 OR has_manual != 0 OR (? = 1 AND has_media != 0))`,
      params: [1, 1, 'rel-1', 1],
    },
    {
      name: 'verify-ownership apply: target ownership + has_media UPSERT',
      sql: `INSERT INTO user_game_releases (user_id, release_id, ownership_status, has_media, has_case, has_manual)
              SELECT ?, id, 1, ?, ?, ? FROM game_releases WHERE id = ?
              ON CONFLICT(user_id, release_id) DO UPDATE SET
                ownership_status = 1,
                has_media = CASE WHEN ? = 1 THEN 1 ELSE user_game_releases.has_media END,
                has_case = MAX(user_game_releases.has_case, excluded.has_case),
                has_manual = MAX(user_game_releases.has_manual, excluded.has_manual)
              WHERE user_game_releases.ownership_status IS NOT 1
                 OR (? = 1 AND user_game_releases.has_media IS NOT 1)
                 OR user_game_releases.has_case < excluded.has_case
                 OR user_game_releases.has_manual < excluded.has_manual`,
      params: [1, 1, 1, 1, 'rel-2', 1, 1],
    },
    {
      name: 'verify-ownership apply: setMediaOwned UPSERT',
      sql: `INSERT INTO user_game_releases (user_id, release_id, has_media)
              SELECT ?, id, 1 FROM game_releases WHERE id = ?
              ON CONFLICT(user_id, release_id) DO UPDATE SET
                has_media = 1
              WHERE user_game_releases.has_media IS NOT 1`,
      params: [1, 'rel-1'],
    },
    {
      name: 'user profile track_individual_media update by PK',
      sql: 'UPDATE users SET track_individual_media = ? WHERE id = ?',
      params: [1, 1],
    },
    {
      name: 'canonical_releases min id bound',
      sql: 'SELECT COALESCE(MIN(id), 0) as min_id FROM canonical_releases',
      params: [],
    },
    {
      name: 'canonical_releases max id bound',
      sql: 'SELECT COALESCE(MAX(id), 0) as max_id FROM canonical_releases',
      params: [],
    },
    {
      name: 'active tracking rules lookup by user_id and rule_type',
      sql: "SELECT r.user_id, r.rule_type, r.match_value, r.target_status, r.region_scope, COALESCE(u.home_region, 'USA') as home_region FROM users u CROSS JOIN user_tracking_rules r WHERE u.id > 0 AND r.user_id = u.id AND r.is_ignored = 0 AND r.rule_type IN ('series', 'platform')",
      params: [],
    },
    {
      name: 'user game releases overlay lookup by user_id',
      sql: 'SELECT release_id, ownership_status, has_media, has_case, has_manual FROM user_game_releases WHERE user_id = ? AND (ownership_status > 0 OR has_media > 0 OR has_case > 0 OR has_manual > 0)',
      params: [1],
    },
    {
      name: 'user games overlay lookup by user_id',
      sql: 'SELECT game_id, play_status, queued FROM user_games WHERE user_id = ? AND (play_status > 0 OR queued > 0)',
      params: [1],
    },
    {
      name: 'user toys overlay lookup by user_id',
      sql: 'SELECT toy_id, ownership_status FROM user_toys WHERE user_id = ? AND ownership_status > 0',
      params: [1],
    },
    {
      name: 'same-day catalog delta games lookup by stable_id PK',
      sql: 'SELECT g.stable_id, g.id, g.title, r.id as rel_id FROM games g LEFT JOIN game_releases r ON g.stable_id = r.game_id WHERE g.stable_id > ?',
      params: [100],
    },
    {
      name: 'same-day catalog delta toys lookup by stable_id PK',
      sql: 'SELECT f.stable_id, f.id, f.name FROM toys f LEFT JOIN toy_series fs ON f.series_id = fs.id WHERE f.stable_id > ?',
      params: [10],
    },
    {
      name: 'catalog games chunk lookup by stable_id PK range',
      sql: buildCatalogGamesChunkQuery(),
      params: [0, 1500],
    },
    {
      name: 'catalog games chunk upper stable_id bound lookup',
      sql: CATALOG_GAMES_CHUNK_BOUND_QUERY,
      params: [0, 1500],
    },
    {
      name: 'games max stable_id bound',
      sql: CATALOG_MAX_GAME_STABLE_ID_QUERY,
      params: [],
    },
    {
      name: 'toys max stable_id bound',
      sql: CATALOG_MAX_TOY_STABLE_ID_QUERY,
      params: [],
    },
    {
      name: 'active games list query (authenticated)',
      sql: `${buildGamesListQuery(1)} ${ACTIVE_GAMES_LIST_WHERE_CLAUSE}`,
      params: [1, 1, 1, 1],
    },
    {
      name: 'active games list query (public)',
      sql: `${buildGamesListQuery(null)} ${ACTIVE_GAMES_PUBLIC_WHERE_CLAUSE}`,
      params: [],
    },
  ];

  const result = runStaticSchemaCostGuard({
    schemaSqlPaths: [schemaPath],
    maxSecondaryIndexes: MAX_SECONDARY_INDEXES,
    criticalQueries,
  });

  const compoundChecks = [
    {
      name: 'ACTIVE_GAMES_LIST_WHERE_CLAUSE',
      sql: ACTIVE_GAMES_LIST_WHERE_CLAUSE,
    },
    {
      name: 'ACTIVE_GAMES_PUBLIC_WHERE_CLAUSE',
      sql: ACTIVE_GAMES_PUBLIC_WHERE_CLAUSE,
    },
    ...criticalQueries.map((q) => ({ name: q.name, sql: q.sql })),
  ];
  for (const check of compoundChecks) {
    const terms = getMaxCompoundSelectTerms(check.sql);
    if (terms > D1_MAX_COMPOUND_SELECT_TERMS) {
      result.passed = false;
      result.errors.push(
        `Query '${check.name}' has ${terms} compound SELECT terms in one scope (Cloudflare D1 limit: ${D1_MAX_COMPOUND_SELECT_TERMS}).`,
      );
    }
  }

  return result;
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
