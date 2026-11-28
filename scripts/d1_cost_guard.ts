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

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
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
  buildCompatibleGamesForToyQuery,
  buildCompatibleToysForGameQuery,
  buildGameDetailQuery,
  buildGamesListQuery,
  buildTargetedCompanionByVersionParentQuery,
  CATALOG_GAMES_CHUNK_BOUND_QUERY,
  CATALOG_MAX_GAME_STABLE_ID_QUERY,
  CATALOG_MAX_TOY_STABLE_ID_QUERY,
  getGameDetailQueryParams,
  getResolveCanonicalGameIdParams,
  RESOLVE_CANONICAL_GAME_ID_QUERY,
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
  allowOwnershipLoss?: boolean;
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
  game_releases: 7,
  toys: 5,
  toy_game_compatibility: 1,
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
      name: 'canonical_releases pending queue count',
      sql: `SELECT COUNT(*) as cnt
            FROM canonical_releases
            WHERE id > ?
              AND is_verified_physical = 1
              AND NOT (COALESCE(source, '') = 'nintendo_revised' AND (region = 'World' OR region IS NULL) AND serial_code IS NULL)`,
      params: [0],
    },
    {
      name: 'canonical_releases max id bound',
      sql: 'SELECT COALESCE(MAX(id), 0) as max_id FROM canonical_releases',
      params: [],
    },
    {
      name: 'active tracking rules lookup by user_id and rule_type',
      sql: "SELECT r.user_id, r.rule_type, r.match_value, r.target_status, r.region_scope, COALESCE(u.home_region, 'USA') as home_region, COALESCE(u.auto_seek_release_scope, 'one_per_game') as auto_seek_release_scope FROM users u CROSS JOIN user_tracking_rules r WHERE u.id > 0 AND r.user_id = u.id AND r.is_ignored = 0 AND r.rule_type IN ('series', 'platform')",
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
    {
      name: 'game detail lookup by stable_id and optional release',
      sql: buildGameDetailQuery(1),
      params: getGameDetailQueryParams('387', 1, '387-1'),
    },
    {
      name: 'canonical game ID resolver (numeric, slug, or release)',
      sql: RESOLVE_CANONICAL_GAME_ID_QUERY,
      params: getResolveCanonicalGameIdParams('387'),
    },
    {
      name: 'upcoming physical releases IGDB refresh lookup',
      sql: "SELECT DISTINCT g.stable_id, g.id, g.title, g.platform_id, g.region, g.igdb_id, g.collections, g.franchises, g.canonical_series, g.metadata_json FROM game_releases r CROSS JOIN games g ON g.stable_id = r.game_id WHERE r.release_date >= DATE('now') AND g.igdb_id IS NOT NULL AND g.igdb_id > 0 LIMIT 100",
      params: [],
    },
    {
      name: 'igdb passive release_date backfill by game_id IN (...)',
      sql: 'SELECT id, game_id, region, release_date FROM game_releases WHERE game_id IN (?, ?, ?)',
      params: [1, 2, 3],
    },
    {
      name: 'retail deals platform-scoped candidate lookup',
      sql: 'SELECT g.stable_id, g.id, g.title, g.platform_id, 0 as ownership_status, COALESCE(r.barcode, g.barcode) as barcode FROM games g LEFT JOIN game_releases r ON r.game_id = g.stable_id WHERE g.platform_id IN (?, ?)',
      params: [26, 27],
    },
    {
      name: 'chunked backup games PK cursor slice',
      sql: 'SELECT * FROM games WHERE stable_id > ? ORDER BY stable_id ASC LIMIT ?',
      params: [0, 10000],
    },
    {
      name: 'chunked backup game_releases PK cursor slice',
      sql: 'SELECT * FROM game_releases WHERE id > ? ORDER BY id ASC LIMIT ?',
      params: ['', 15000],
    },
    {
      name: 'chunked backup canonical_releases PK cursor slice',
      sql: 'SELECT * FROM canonical_releases WHERE id > ? ORDER BY id ASC LIMIT ?',
      params: [0, 15000],
    },
    {
      name: 'canonical_releases pack-in companion lookup by (platform_id, packin_host_normalized_title)',
      sql: 'SELECT id, raw_title, region, variants, also_released_as, packin_host_normalized_title, rom_name, rom_crc, serial_code FROM canonical_releases WHERE platform_id = ? AND packin_host_normalized_title = ? AND is_verified_physical = 1 ORDER BY id ASC',
      params: [29, 'themisadventuresoftronbonne'],
    },
    {
      name: 'unmatched IGDB retry Phase 1 user-tracked lookup (CROSS JOIN)',
      sql: "SELECT DISTINCT g.stable_id, g.id, g.title, g.platform_id, g.region, g.image_url, g.summary, g.genres, g.igdb_url, g.collections, g.franchises, g.canonical_series, g.metadata_json FROM user_game_releases ugr CROSS JOIN game_releases r ON r.id = ugr.release_id CROSS JOIN games g ON g.stable_id = r.game_id WHERE ugr.user_id > 0 AND ugr.ownership_status > 0 AND g.igdb_id IS NULL AND COALESCE(g.image_url, '') NOT LIKE '/covers/%' AND g.stable_id > ? ORDER BY g.stable_id ASC LIMIT 20",
      params: [0],
    },
    {
      name: 'unmatched IGDB retry Phase 2 catalog tail lookup by stable_id PK',
      sql: "SELECT stable_id, id, title, platform_id, region, image_url, summary, genres, igdb_url, collections, franchises, canonical_series, metadata_json FROM games WHERE igdb_id IS NULL AND COALESCE(image_url, '') NOT LIKE '/covers/%' AND stable_id > ? ORDER BY stable_id ASC LIMIT 30",
      params: [0],
    },
    {
      name: 'unmatched IGDB retry duplicate sibling check by igdb_id',
      sql: 'SELECT stable_id, title FROM games WHERE igdb_id = ? AND igdb_id IS NOT NULL AND +platform_id = ? AND stable_id != ? LIMIT 1',
      params: [100, 26, 1],
    },
    {
      name: 'merge duplicate game: source/target release lookup by game_id',
      sql: 'SELECT id, region, variants, canonical_release_id FROM game_releases WHERE game_id = ?',
      params: [1],
    },
    {
      name: 'merge duplicate game: user_game_releases lookup by release_id',
      sql: 'SELECT user_id, ownership_status, has_media, has_case, has_manual FROM user_game_releases WHERE release_id = ?',
      params: ['rel-1'],
    },
    {
      name: 'merge duplicate game: user_games lookup by game_id',
      sql: 'SELECT user_id, play_status, queued FROM user_games WHERE game_id = ?',
      params: [1],
    },
    {
      name: 'merge duplicate game: toy_game_compatibility lookup by game_stable_id',
      sql: 'SELECT toy_stable_id, can_read, can_write, description FROM toy_game_compatibility WHERE game_stable_id = ?',
      params: [1],
    },
    {
      name: 'merge duplicate game: bundle_parent_id repoint',
      sql: 'UPDATE games SET bundle_parent_id = ? WHERE bundle_parent_id = ?',
      params: [2, 1],
    },
    {
      name: 'toy_game_compatibility lookup by game_stable_id',
      sql: buildCompatibleToysForGameQuery(1),
      params: [1, 1],
    },
    {
      name: 'toy_game_compatibility lookup by toy_stable_id',
      sql: buildCompatibleGamesForToyQuery(1),
      params: [1, 1],
    },
    {
      name: 'version_parent children companion lookup by indexed version_parent_igdb_id',
      sql: buildTargetedCompanionByVersionParentQuery(1),
      params: [1, 10760, 26],
    },
  ];

  const result = runStaticSchemaCostGuard({
    schemaSqlPaths: [schemaPath],
    maxSecondaryIndexes: MAX_SECONDARY_INDEXES,
    criticalQueries,
  });

  if (fs.existsSync(schemaPath)) {
    const planCheckDb = new Database(':memory:');
    try {
      planCheckDb.exec(fs.readFileSync(schemaPath, 'utf8'));
      const queryByName = new Map(criticalQueries.map((q) => [q.name, q]));
      const upcomingQuery = queryByName.get(
        'upcoming physical releases IGDB refresh lookup',
      )!;
      const backfillQuery = queryByName.get(
        'igdb passive release_date backfill by game_id IN (...)',
      )!;
      const retailCandidatesQuery = queryByName.get(
        'retail deals platform-scoped candidate lookup',
      )!;
      const indexAssertions: Array<{
        name: string;
        sql: string;
        params: unknown[];
        requiredSubstrings: string[];
        forbiddenSubstrings?: string[];
      }> = [
        {
          name: upcomingQuery.name,
          sql: upcomingQuery.sql,
          params: upcomingQuery.params,
          requiredSubstrings: ['idx_game_releases_release_date'],
          forbiddenSubstrings: ['idx_games_igdb_id'],
        },
        {
          name: backfillQuery.name,
          sql: backfillQuery.sql,
          params: backfillQuery.params,
          requiredSubstrings: ['idx_game_releases_game_id'],
          forbiddenSubstrings: ['idx_game_releases_release_date'],
        },
        {
          name: retailCandidatesQuery.name,
          sql: retailCandidatesQuery.sql,
          params: retailCandidatesQuery.params,
          requiredSubstrings: [
            'idx_games_platform_id',
            'idx_game_releases_game_id',
          ],
        },
        {
          name: 'version_parent children companion lookup by indexed version_parent_igdb_id',
          sql: buildTargetedCompanionByVersionParentQuery(1),
          params: [1, 10760, 26],
          requiredSubstrings: [
            'idx_games_version_parent_igdb_id',
            'idx_game_releases_game_id',
          ],
        },
      ];
      for (const assertion of indexAssertions) {
        const planRows = planCheckDb
          .prepare(`EXPLAIN QUERY PLAN ${assertion.sql}`)
          .all(...assertion.params) as Array<{ detail: string }>;
        const details = planRows.map((r) => r.detail).join(' | ');
        for (const reqIdx of assertion.requiredSubstrings) {
          if (!details.includes(reqIdx)) {
            result.passed = false;
            result.errors.push(
              `Query '${assertion.name}' expected query plan to use '${reqIdx}', got: ${details}`,
            );
          }
        }
        for (const forbidIdx of assertion.forbiddenSubstrings || []) {
          if (details.includes(forbidIdx)) {
            result.passed = false;
            result.errors.push(
              `Query '${assertion.name}' regressed to forbidden index '${forbidIdx}': ${details}`,
            );
          }
        }
      }
    } finally {
      planCheckDb.close();
    }
  }

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

  const workerTsPath = path.join(rootDir, 'worker', 'worker.ts');
  if (fs.existsSync(workerTsPath)) {
    const workerSrc = fs.readFileSync(workerTsPath, 'utf8');
    if (/MAX\s*\(\s*(?:ugr\.)?ownership_status\s*\)/i.test(workerSrc)) {
      result.passed = false;
      result.errors.push(
        'worker/worker.ts uses MAX(ownership_status), which ranks Seeking (2) above Owned (1). Use precedence CASE (1 > 3 > 4 > 2 > 0).',
      );
    }
  }

  return result;
}

export interface SqlDataInvariantResult {
  passed: boolean;
  errors: string[];
}

/**
 * Validates ownership, case/manual part, and polymorphic journal invariants
 * before running any SQL file against remote D1.
 */
export function auditSqlDataInvariants(
  sqlFilePath: string,
  baselineDbPath = REMOTE_BASELINE_DB_PATH,
  options?: { allowOwnershipLoss?: boolean },
): SqlDataInvariantResult {
  const errors: string[] = [];
  const rawSql = fs.readFileSync(sqlFilePath, 'utf8');
  const statements = splitSqlStatements(rawSql)
    .map((s) => stripLeadingSqlComments(s).trim())
    .filter(Boolean);

  for (let i = 0; i < statements.length; i++) {
    if (/MAX\s*\([^)]*ownership_status/i.test(statements[i])) {
      errors.push(
        `Statement #${i + 1} uses MAX(...ownership_status...), which corrupts ownership precedence (Owned=1 < Seeking=2 < Ordered=3 < PrioritySeeking=4).`,
      );
    }
  }

  if (errors.length > 0 || !baselineDbPath || !fs.existsSync(baselineDbPath)) {
    return { passed: errors.length === 0, errors };
  }

  const tmpDbPath = path.join(
    os.tmpdir(),
    `d1_cost_guard_inv_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.db`,
  );
  fs.copyFileSync(baselineDbPath, tmpDbPath);
  const db = new Database(tmpDbPath);
  try {
    db.pragma('foreign_keys = ON');
    const tableNames = new Set(
      (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all() as Array<{ name: string }>
      ).map((r) => r.name),
    );

    const checkOwnership =
      tableNames.has('user_game_releases') &&
      tableNames.has('game_releases') &&
      tableNames.has('games');
    const checkJournals =
      tableNames.has('journal_entries') &&
      tableNames.has('games') &&
      tableNames.has('toys');

    const getOwnedKeys = (): Set<string> =>
      new Set(
        (
          db
            .prepare(
              `SELECT DISTINCT ugr.user_id || ':' || r.game_id AS k
               FROM user_game_releases ugr
               JOIN game_releases r ON r.id = ugr.release_id
               WHERE ugr.ownership_status = 1`,
            )
            .all() as Array<{ k: string }>
        ).map((r) => r.k),
      );

    const getInvalidPartKeys = (): Set<string> =>
      new Set(
        (
          db
            .prepare(
              `SELECT user_id || ':' || release_id AS k
               FROM user_game_releases
               WHERE ownership_status IN (0, 2)
                 AND (has_case = 1 OR has_manual = 1)`,
            )
            .all() as Array<{ k: string }>
        ).map((r) => r.k),
      );

    const getOrphanJournalIds = (): Set<number> =>
      new Set(
        (
          db
            .prepare(
              `SELECT id
               FROM journal_entries
               WHERE (item_type = 'game' AND item_id NOT IN (
                 SELECT CAST(stable_id AS TEXT) FROM games
                 UNION
                 SELECT id FROM games WHERE id IS NOT NULL
               ))
               OR (item_type = 'toy' AND item_id NOT IN (
                 SELECT CAST(stable_id AS TEXT) FROM toys
                 UNION
                 SELECT id FROM toys WHERE id IS NOT NULL
               ))`,
            )
            .all() as Array<{ id: number }>
        ).map((r) => r.id),
      );

    const ownedBefore = checkOwnership ? getOwnedKeys() : new Set<string>();
    const invalidPartsBefore = checkOwnership
      ? getInvalidPartKeys()
      : new Set<string>();
    const orphanJournalsBefore = checkJournals
      ? getOrphanJournalIds()
      : new Set<number>();

    const tx = db.transaction(() => {
      for (const stmt of statements) {
        db.exec(stmt);
      }
    });
    tx();

    if (checkOwnership) {
      if (!options?.allowOwnershipLoss) {
        const ownedAfter = getOwnedKeys();
        const lostOwned = Array.from(ownedBefore).filter(
          (k) => !ownedAfter.has(k),
        );
        if (lostOwned.length > 0) {
          errors.push(
            `Ownership regression detected for ${lostOwned.length} owned game(s): ${lostOwned.slice(0, 10).join(', ')} (pass --allow-ownership-loss to override).`,
          );
        }
      }

      const invalidPartsAfter = getInvalidPartKeys();
      const newInvalidParts = Array.from(invalidPartsAfter).filter(
        (k) => !invalidPartsBefore.has(k),
      );
      if (newInvalidParts.length > 0) {
        errors.push(
          `Introduced ${newInvalidParts.length} user_game_releases row(s) with ownership_status IN (0, 2) and has_case/has_manual = 1: ${newInvalidParts.slice(0, 10).join(', ')}.`,
        );
      }
    }

    if (checkJournals) {
      const orphanJournalsAfter = getOrphanJournalIds();
      const newOrphanJournals = Array.from(orphanJournalsAfter).filter(
        (id) => !orphanJournalsBefore.has(id),
      );
      if (newOrphanJournals.length > 0) {
        errors.push(
          `Orphaned ${newOrphanJournals.length} journal_entries row(s): IDs ${newOrphanJournals.slice(0, 10).join(', ')}.`,
        );
      }
    }
  } finally {
    try {
      db.close();
    } catch {
      // Ignore close error
    }
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(`${tmpDbPath}${suffix}`)) {
        fs.unlinkSync(`${tmpDbPath}${suffix}`);
      }
    }
  }

  return { passed: errors.length === 0, errors };
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
  const baselineDbPath = options.baselineDbPath || REMOTE_BASELINE_DB_PATH;
  const inv = auditSqlDataInvariants(options.sqlFilePath, baselineDbPath, {
    allowOwnershipLoss: options.allowOwnershipLoss,
  });
  if (!inv.passed) {
    throw new Error(
      `[CostGuard] Data invariant check failed:\n - ${inv.errors.join('\n - ')}`,
    );
  }
  const executeRemote = Boolean(
    options.executeRemote || (options.confirm && !options.isDryRun),
  );
  return kitRunWithD1CostGuard({
    sqlFilePath: options.sqlFilePath,
    maxWrites: options.maxWrites ?? 5000,
    executeRemote,
    remoteDbName: options.remoteDbName || 'collection-db',
    rootDir,
    baselineDbPath,
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
  let allowOwnershipLoss = false;

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
    } else if (arg === '--allow-ownership-loss') {
      allowOwnershipLoss = true;
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

  runWithD1CostGuard({
    sqlFilePath,
    maxWrites,
    confirm,
    isDryRun,
    allowOwnershipLoss,
  });
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
