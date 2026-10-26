/**
 * PULL R2 DATABASE SNAPSHOT & BUILD REMOTE BASELINE CLONE
 *
 * Downloads the latest automated JSON snapshot from Cloudflare R2 (collection-backups)
 * and hydrates `data/remote_baseline.db` without consuming Cloudflare D1 row read/write quota.
 *
 * USAGE:
 *   npx tsx scripts/d1_pull_r2_snapshot.ts [--reconcile-live]
 */

import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getLocalD1Path } from './lib/db.js';

interface R2SnapshotPayload {
  metadata: {
    timestamp: string;
    date: string;
    version: number;
    totalRows: number;
    tableCounts: Record<string, number>;
  };
  tables: Record<string, Record<string, unknown>[]>;
}

export function pullR2SnapshotAndBuildBaseline(
  options: {
    reconcileLive?: boolean;
    outputPath?: string;
  } = {},
): {
  baselineDbPath: string;
  timestamp: string;
  totalRows: number;
  tableCounts: Record<string, number>;
} {
  const rootDir = process.cwd();
  const tempDir = path.join(rootDir, 'scripts', 'temp');
  const dataDir = path.join(rootDir, 'data');
  const baselineDbPath =
    options.outputPath || path.join(dataDir, 'remote_baseline.db');

  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const snapshotJsonPath = path.join(tempDir, 'r2_latest.json');

  console.log(
    '📦 [R2 Baseline] Downloading latest snapshot from Cloudflare R2...',
  );
  try {
    execSync(
      `npx wrangler r2 object get collection-backups/snapshots/latest.json --remote --file="${snapshotJsonPath}"`,
      { stdio: 'inherit' },
    );
  } catch (err) {
    console.error(
      '❌ [R2 Baseline] Failed to download snapshots/latest.json from R2:',
      err,
    );
    throw err;
  }

  if (!fs.existsSync(snapshotJsonPath)) {
    throw new Error(`Snapshot JSON file was not found at ${snapshotJsonPath}`);
  }

  const rawJson = fs.readFileSync(snapshotJsonPath, 'utf8');
  const payload: R2SnapshotPayload = JSON.parse(rawJson);

  console.log(
    `✅ [R2 Baseline] Loaded snapshot from ${payload.metadata.timestamp} (${payload.metadata.totalRows} dynamic rows)`,
  );

  // If previous baseline DB exists, remove it for clean hydration
  if (fs.existsSync(baselineDbPath)) {
    fs.unlinkSync(baselineDbPath);
  }

  const baselineDb = new Database(baselineDbPath);
  baselineDb.pragma('foreign_keys = OFF');
  baselineDb.pragma('journal_mode = WAL');

  // Copy canonical schema from local SQLite
  const localDbPath = getLocalD1Path();
  const localDb = new Database(localDbPath, { readonly: true });

  console.log('🔨 [R2 Baseline] Initializing database schema...');
  const schemaObjects = localDb
    .prepare(
      `SELECT type, name, sql FROM sqlite_master
       WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
       ORDER BY CASE WHEN type = 'table' THEN 1 ELSE 2 END ASC`,
    )
    .all() as Array<{ type: string; name: string; sql: string }>;

  for (const obj of schemaObjects) {
    baselineDb.exec(obj.sql);
  }

  // Copy static canonical_releases catalog from local DB
  console.log('📚 [R2 Baseline] Copying static canonical_releases catalog...');
  const copyCanonical = baselineDb.transaction(() => {
    const rows = localDb
      .prepare('SELECT * FROM canonical_releases')
      .all() as Record<string, unknown>[];
    if (rows.length === 0) return;

    const cols = Object.keys(rows[0]);
    const placeholders = cols.map(() => '?').join(', ');
    const insertStmt = baselineDb.prepare(
      `INSERT INTO canonical_releases (${cols.join(', ')}) VALUES (${placeholders})`,
    );

    for (const row of rows) {
      insertStmt.run(Object.values(row));
    }
  });
  copyCanonical();

  // Populate dynamic tables from R2 snapshot
  console.log('📥 [R2 Baseline] Hydrating tables from R2 snapshot...');
  const hydrateTables = baselineDb.transaction(() => {
    for (const [table, rows] of Object.entries(payload.tables)) {
      if (!rows || rows.length === 0) continue;

      const cols = Object.keys(rows[0]);
      const placeholders = cols.map(() => '?').join(', ');
      const insertStmt = baselineDb.prepare(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`,
      );

      for (const row of rows) {
        insertStmt.run(Object.values(row));
      }
    }
  });
  hydrateTables();

  localDb.close();

  // Replay locally tracked remote migrations applied after snapshot timestamp
  const logPath = path.join(dataDir, 'remote_migrations_log.json');
  if (fs.existsSync(logPath)) {
    try {
      const logEntries = JSON.parse(fs.readFileSync(logPath, 'utf8')) as Array<{
        file: string;
        timestamp: string;
        sql?: string;
      }>;
      const snapshotEpoch = new Date(payload.metadata.timestamp).getTime();
      const pendingReplays = logEntries.filter(
        (e) => new Date(e.timestamp).getTime() > snapshotEpoch,
      );

      if (pendingReplays.length > 0) {
        console.log(
          `🔄 [R2 Baseline] Replaying ${pendingReplays.length} migration(s) applied after snapshot...`,
        );
        for (const entry of pendingReplays) {
          if (entry.sql) {
            baselineDb.exec(entry.sql);
          } else if (entry.file && fs.existsSync(entry.file)) {
            baselineDb.exec(fs.readFileSync(entry.file, 'utf8'));
          }
        }
      }
    } catch (logErr) {
      console.warn(
        '⚠️ [R2 Baseline] Failed to process migrations log:',
        logErr,
      );
    }
  }

  // Reconcile live if requested (low-cost: ~15 row reads from sync_state)
  if (options.reconcileLive) {
    console.log(
      '📡 [R2 Baseline] Checking remote D1 sync_state for live mutations...',
    );
    try {
      const syncStateOut = execSync(
        `npx wrangler d1 execute collection-db --remote --command="SELECT key, value, updated_at FROM sync_state" --json`,
        { encoding: 'utf8' },
      );
      const parsed = JSON.parse(syncStateOut);
      const rows = parsed[0]?.results as
        | Array<{ key: string; value: string; updated_at: string }>
        | undefined;

      if (rows && rows.length > 0) {
        const remoteSync = new Map(rows.map((r) => [r.key, r.value]));
        const isDirty = remoteSync.get('db_dirty') === '1';

        if (!isDirty) {
          console.log(
            '✅ [R2 Baseline] Remote D1 confirms db_dirty = 0. Baseline is 100% in sync with production.',
          );
        } else {
          console.warn(
            '⚠️ [R2 Baseline] Remote D1 has db_dirty = 1 (live mutations occurred since snapshot).',
          );
        }
      }
    } catch (liveErr) {
      console.warn('⚠️ [R2 Baseline] Live sync_state probe skipped:', liveErr);
    }
  }

  baselineDb.pragma('foreign_keys = ON');
  baselineDb.close();

  console.log(
    `\n🎉 [R2 Baseline] Created remote baseline clone at: ${baselineDbPath}\n`,
  );

  return {
    baselineDbPath,
    timestamp: payload.metadata.timestamp,
    totalRows: payload.metadata.totalRows,
    tableCounts: payload.metadata.tableCounts,
  };
}

async function main() {
  const reconcileLive = process.argv.includes('--reconcile-live');
  pullR2SnapshotAndBuildBaseline({ reconcileLive });
}

const isMainModule =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
