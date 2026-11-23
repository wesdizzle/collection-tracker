/**
 * CLOUDFLARE D1 / R2 PULL UTILITY
 *
 * Synchronizes the local `collection.sqlite` database with production state.
 *
 * DEFAULT: Pulls the latest production snapshot directly from Cloudflare R2
 * (`snapshots/latest.json`) via `@wesdizzle/app-kit/scripts` (`runD1PullFromR2`).
 * This incurs 0 D1 row reads, 0 writes, and $0 egress fees.
 *
 * EXPLICIT FALLBACK: Pass `--direct-d1` to execute a direct D1 export via Wrangler.
 * Never falls back to `--remote` D1 export automatically if R2 fails.
 *
 * USAGE:
 *   npx tsx scripts/d1_pull.ts
 *   npx tsx scripts/d1_pull.ts --direct-d1
 */

import Database from 'better-sqlite3';
import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  findWranglerSqliteFile,
  loadDeployEnv,
  runD1PullFromR2,
} from '@wesdizzle/app-kit/scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

function resolveLocalD1Path(): string {
  const d1StateDir = path.join(
    rootDir,
    '.wrangler',
    'state',
    'v3',
    'd1',
    'miniflare-D1DatabaseObject',
  );
  const found = findWranglerSqliteFile(d1StateDir);
  if (found) return found;
  fs.mkdirSync(d1StateDir, { recursive: true });
  return path.join(
    d1StateDir,
    '169f8be8b215c89203fa79284f81f610be46edc169f8d19359d676b5963cb1eb.sqlite',
  );
}

const localDbPath = resolveLocalD1Path();
const schemaSqlPath = path.join(rootDir, 'migrations', 'schema.sql');

const TABLE_HYDRATION_ORDER = [
  'platforms',
  'toy_series',
  'canonical_releases',
  'ignored_items',
  'users',
  'user_tracking_rules',
  'games',
  'game_releases',
  'toys',
  'toy_game_compatibility',
  'user_games',
  'user_game_releases',
  'user_toys',
  'journal_entries',
  'price_query_overrides',
  'push_subscriptions',
  'sync_state',
] as const;

const isDirectD1 = process.argv.includes('--direct-d1');

const SAFE_IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function hydrateCanonicalReleasesFromSnapshotFile(
  dbPath: string,
  snapshotJsonPath: string,
): number {
  const parsed = JSON.parse(fs.readFileSync(snapshotJsonPath, 'utf-8')) as {
    tables?: { canonical_releases?: Array<Record<string, unknown>> };
  };
  const rows = parsed?.tables?.canonical_releases;
  if (!Array.isArray(rows)) return 0;

  const db = new Database(dbPath);
  try {
    db.pragma('foreign_keys = OFF');
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM "canonical_releases"').run();
      if (rows.length === 0) return;
      const columns = Object.keys(rows[0]).filter((c) => SAFE_IDENT_RE.test(c));
      const colList = columns.map((c) => `"${c}"`).join(', ');
      const placeholders = columns.map(() => '?').join(', ');
      const insertStmt = db.prepare(
        `INSERT INTO "canonical_releases" (${colList}) VALUES (${placeholders})`,
      );
      for (const row of rows) {
        insertStmt.run(...columns.map((c) => row[c] ?? null));
      }
    });
    tx();
    db.pragma('foreign_keys = ON');
  } finally {
    db.close();
  }
  return rows.length;
}

/**
 * Replaces `tableName` inside an existing SQLite database from an ordered list
 * of chunk JSON files (`{ rows: [...] }` or raw row arrays) inside a single transaction.
 */
export function hydrateTableFromChunkFiles(
  dbPath: string,
  tableName: string,
  chunkJsonPaths: string[],
): number {
  if (!SAFE_IDENT_RE.test(tableName)) {
    throw new Error(`[D1Pull] Unsafe table identifier: ${tableName}`);
  }

  let totalInserted = 0;
  const db = new Database(dbPath);
  try {
    db.pragma('foreign_keys = OFF');
    db.pragma('synchronous = OFF');
    db.pragma('temp_store = MEMORY');

    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM "${tableName}"`).run();
      let cachedSignature = '';
      let cachedColumns: string[] = [];
      let cachedStmt: Database.Statement | null = null;

      for (const chunkPath of chunkJsonPaths) {
        const parsed = JSON.parse(fs.readFileSync(chunkPath, 'utf-8')) as
          | { rows?: Array<Record<string, unknown>> }
          | Array<Record<string, unknown>>;
        const rows = Array.isArray(parsed) ? parsed : parsed?.rows;
        if (!Array.isArray(rows) || rows.length === 0) continue;

        const columns = Object.keys(rows[0]).filter((c) =>
          SAFE_IDENT_RE.test(c),
        );
        if (columns.length === 0) continue;

        const signature = columns.join('\0');
        if (!cachedStmt || signature !== cachedSignature) {
          cachedSignature = signature;
          cachedColumns = columns;
          const colList = columns.map((c) => `"${c}"`).join(', ');
          const placeholders = columns.map(() => '?').join(', ');
          cachedStmt = db.prepare(
            `INSERT INTO "${tableName}" (${colList}) VALUES (${placeholders})`,
          );
        }

        for (const row of rows) {
          cachedStmt.run(...cachedColumns.map((c) => row[c] ?? null));
          totalInserted++;
        }
      }
    });
    tx();
  } finally {
    try {
      db.pragma('synchronous = FULL');
      db.pragma('foreign_keys = ON');
    } catch {
      // Ignore pragma restore errors if db failed early
    }
    db.close();
  }
  return totalInserted;
}

function downloadR2ObjectToFile(
  objectKey: string,
  targetFile: string,
): boolean {
  if (!objectKey.startsWith('snapshots/') || objectKey.includes('..')) {
    throw new Error(`[D1Pull] Invalid R2 object key: ${objectKey}`);
  }
  const r2Res = spawnSync(
    'npx',
    [
      'wrangler',
      'r2',
      'object',
      'get',
      `collection-backups/${objectKey}`,
      '--file',
      targetFile,
      '--remote',
    ],
    {
      cwd: rootDir,
      stdio: 'pipe',
      shell: process.platform === 'win32',
      timeout: 60_000,
    },
  );
  return r2Res.status === 0 && fs.existsSync(targetFile);
}

function pullChunkedR2Table(
  tempDir: string,
  targetDbPath: string,
  tableName: 'games' | 'game_releases' | 'canonical_releases',
  chunkKeys: string[],
): number {
  const localPaths: string[] = [];
  for (let i = 0; i < chunkKeys.length; i++) {
    const chunkKey = chunkKeys[i];
    const localPath = path.join(tempDir, `${tableName}-${i}.json`);
    if (!downloadR2ObjectToFile(chunkKey, localPath)) {
      throw new Error(
        `[D1Pull] Failed to download R2 backup chunk: ${chunkKey}`,
      );
    }
    localPaths.push(localPath);
  }
  return hydrateTableFromChunkFiles(targetDbPath, tableName, localPaths);
}

function pullCanonicalReleasesFromR2(targetDbPath: string): number | null {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '_r2_canonical_'));
  try {
    const chunkedManifestPath = path.join(tempDir, 'canonical-manifest.json');
    if (
      downloadR2ObjectToFile(
        'snapshots/chunks/canonical-manifest.json',
        chunkedManifestPath,
      )
    ) {
      const manifest = JSON.parse(
        fs.readFileSync(chunkedManifestPath, 'utf-8'),
      ) as { chunks?: string[] };
      if (Array.isArray(manifest?.chunks)) {
        return pullChunkedR2Table(
          tempDir,
          targetDbPath,
          'canonical_releases',
          manifest.chunks,
        );
      }
    }

    const legacyCanonicalPath = path.join(tempDir, 'canonical_releases.json');
    if (
      !downloadR2ObjectToFile(
        'snapshots/canonical_releases.json',
        legacyCanonicalPath,
      )
    ) {
      return null;
    }
    return hydrateCanonicalReleasesFromSnapshotFile(
      targetDbPath,
      legacyCanonicalPath,
    );
  } finally {
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup error
      }
    }
  }
}

function pullChunkedCatalogFromR2(
  targetDbPath: string,
): { games: number; game_releases: number } | null {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '_r2_catalog_'));
  try {
    const manifestPath = path.join(tempDir, 'catalog-manifest.json');
    if (
      !downloadR2ObjectToFile(
        'snapshots/chunks/catalog-manifest.json',
        manifestPath,
      )
    ) {
      return null;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
      tables?: {
        games?: { chunks?: string[] };
        game_releases?: { chunks?: string[] };
      };
    };
    const gameChunks = manifest?.tables?.games?.chunks;
    const relChunks = manifest?.tables?.game_releases?.chunks;
    if (!Array.isArray(gameChunks) || !Array.isArray(relChunks)) {
      return null;
    }
    const gamesCount = pullChunkedR2Table(
      tempDir,
      targetDbPath,
      'games',
      gameChunks,
    );
    const relsCount = pullChunkedR2Table(
      tempDir,
      targetDbPath,
      'game_releases',
      relChunks,
    );
    return { games: gamesCount, game_releases: relsCount };
  } finally {
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup error
      }
    }
  }
}

function syncBaselineDbFromLocal(): void {
  const dataDir = path.join(rootDir, 'data');
  const baselinePath = path.join(dataDir, 'remote_baseline.db');
  if (path.resolve(localDbPath) === path.resolve(baselinePath)) {
    return;
  }
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.copyFileSync(localDbPath, baselinePath);
}

async function pullFromR2() {
  console.log(
    '[D1Pull] Initiating zero-D1-read pull from Cloudflare R2 (collection-backups)...',
  );
  const rowCounts = await runD1PullFromR2({
    rootDir,
    r2BucketName: 'collection-backups',
    localDbPath,
    schemaSqlPaths: [schemaSqlPath],
    tableOrder: TABLE_HYDRATION_ORDER,
  });

  const chunkedCatalogCounts = pullChunkedCatalogFromR2(localDbPath);
  if (chunkedCatalogCounts !== null) {
    rowCounts['games'] = chunkedCatalogCounts.games;
    rowCounts['game_releases'] = chunkedCatalogCounts.game_releases;
  }

  const canonicalCount = pullCanonicalReleasesFromR2(localDbPath);
  if (canonicalCount !== null) {
    rowCounts['canonical_releases'] = canonicalCount;
  }

  const verifyDb = new Database(localDbPath, { readonly: true });
  try {
    const integrity = verifyDb.pragma('integrity_check') as Array<{
      integrity_check: string;
    }>;
    if (integrity?.[0]?.integrity_check !== 'ok') {
      throw new Error(
        `[D1Pull] SQLite integrity check failed: ${JSON.stringify(integrity)}`,
      );
    }
  } finally {
    verifyDb.close();
  }

  let totalRestored = 0;
  for (const [table, count] of Object.entries(rowCounts)) {
    totalRestored += count;
    console.log(`  • ${table}: ${count} rows`);
  }

  syncBaselineDbFromLocal();

  console.log(
    `\n✅ Successfully pulled remote state from R2 into local SQLite! (${totalRestored} rows hydrated, 0 D1 reads consumed)`,
  );
  reportSnapshotAge(canonicalCount !== null);
}

/** R2 snapshots are taken by the daily backup cron, so they can be many hours old. */
const SNAPSHOT_STALE_HOURS = 6;

function reportSnapshotAge(hasCanonicalSnapshot = false): void {
  const db = new Database(localDbPath, { readonly: true });
  try {
    const row = db
      .prepare('SELECT MAX(updated_at) AS ts FROM sync_state')
      .get() as { ts: string | null } | undefined;
    if (!row?.ts) {
      console.log(
        '[D1Pull] ⚠️  Could not determine snapshot age (sync_state is empty).',
      );
      return;
    }
    const snapshotMs = Date.parse(`${row.ts.replace(' ', 'T')}Z`);
    const ageHours = (Date.now() - snapshotMs) / 3_600_000;
    const msg = `[D1Pull] Snapshot reflects remote state as of ${row.ts} UTC (~${ageHours.toFixed(1)}h old).`;
    if (ageHours > SNAPSHOT_STALE_HOURS) {
      const canonicalNote = hasCanonicalSnapshot
        ? ''
        : ' snapshots/canonical_releases.json was not yet found in R2.';
      console.log(
        `${msg}\n[D1Pull] ⚠️  Snapshot is older than ${SNAPSHOT_STALE_HOURS}h: rows written since then (e.g. cron catalog seeding) are NOT present locally.${canonicalNote}`,
      );
    } else {
      console.log(msg);
    }
  } finally {
    db.close();
  }
}

async function pullFromDirectD1() {
  console.log(
    '[D1Pull] Initiating explicit --direct-d1 export from Cloudflare D1 (collection-db)...',
  );
  const envVars = loadDeployEnv(rootDir);
  const d1DatabaseId = envVars['D1_DATABASE_ID']?.trim();
  if (!d1DatabaseId || d1DatabaseId === 'local-dev-db') {
    throw new Error(
      '[D1Pull] D1_DATABASE_ID is required in .dev.vars or environment variables for --direct-d1.',
    );
  }
  const wranglerPath = path.join(rootDir, 'wrangler.toml');
  const originalWrangler = fs.readFileSync(wranglerPath, 'utf-8');
  if (!originalWrangler.includes('database_id = "local-dev-db"')) {
    throw new Error(
      '[D1Pull] Expected placeholder database_id = "local-dev-db" in wrangler.toml.',
    );
  }
  const patchedWrangler = originalWrangler.replace(
    'database_id = "local-dev-db"',
    `database_id = "${d1DatabaseId}"`,
  );
  const execEnv: NodeJS.ProcessEnv = { ...process.env };
  delete execEnv['CLOUDFLARE_API_TOKEN'];

  const tempSqlPath = path.join(
    os.tmpdir(),
    `_d1_export_${process.pid}_${Date.now()}.sql`,
  );

  try {
    fs.writeFileSync(wranglerPath, patchedWrangler, 'utf-8');
    try {
      execSync(
        `npx wrangler d1 export collection-db --remote --output="${tempSqlPath}"`,
        {
          cwd: rootDir,
          stdio: 'inherit',
          env: execEnv,
          shell: true as unknown as string,
        },
      );
    } finally {
      fs.writeFileSync(wranglerPath, originalWrangler, 'utf-8');
    }

    if (!fs.existsSync(tempSqlPath) || fs.statSync(tempSqlPath).size === 0) {
      throw new Error('Exported SQL dump is empty or missing.');
    }

    if (fs.existsSync(localDbPath)) {
      const existingDb = new Database(localDbPath, { readonly: true });
      try {
        await existingDb.backup(`${localDbPath}.bak`);
      } finally {
        existingDb.close();
      }
    }

    const localDir = path.dirname(localDbPath);
    const baseName = path.basename(localDbPath, '.sqlite');
    if (fs.existsSync(localDir)) {
      for (const f of fs.readdirSync(localDir)) {
        if (f === `${baseName}.sqlite` || f.startsWith(`${baseName}.sqlite-`)) {
          try {
            fs.unlinkSync(path.join(localDir, f));
          } catch {
            // Ignore cleanup error
          }
        }
      }
    } else {
      fs.mkdirSync(localDir, { recursive: true });
    }

    console.log(
      `[D1Pull] Rebuilding local D1 (${path.basename(localDbPath)}) from remote dump...`,
    );
    const newDb = new Database(localDbPath);
    try {
      newDb.pragma('foreign_keys = OFF');
      newDb.pragma('synchronous = OFF');
      newDb.pragma('temp_store = MEMORY');
      const sqlContent = fs.readFileSync(tempSqlPath, 'utf8');
      const loadDumpTx = newDb.transaction(() => {
        newDb.exec(sqlContent);
      });
      loadDumpTx();
      if (fs.existsSync(schemaSqlPath)) {
        const schemaContent = fs.readFileSync(schemaSqlPath, 'utf8');
        const applySchemaTx = newDb.transaction(() => {
          newDb.exec(schemaContent);
        });
        applySchemaTx();
      }
      newDb.pragma('synchronous = FULL');
      newDb.pragma('foreign_keys = ON');
      const integrity = newDb.pragma('integrity_check');
      console.log('[D1Pull] Integrity check:', integrity);
    } finally {
      newDb.close();
    }

    syncBaselineDbFromLocal();

    console.log(
      '✅ Successfully pulled remote Cloudflare D1 state directly into local D1!',
    );
  } finally {
    if (fs.existsSync(tempSqlPath)) {
      try {
        fs.unlinkSync(tempSqlPath);
      } catch {
        // Ignore removal error
      }
    }
  }
}

async function main() {
  if (isDirectD1) {
    await pullFromDirectD1();
  } else {
    await pullFromR2();
  }
}

const isMainModule =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  main().catch((err) => {
    console.error('[D1Pull] Failed to pull database:', err);
    process.exit(1);
  });
}
