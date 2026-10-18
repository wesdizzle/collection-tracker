/**
 * CLOUDFLARE D1 / R2 PULL UTILITY
 *
 * Synchronizes the local `collection.sqlite` database with production state.
 *
 * DEFAULT: Pulls the latest production snapshot directly from Cloudflare R2
 * (`snapshots/latest.json`). This incurs 0 D1 row reads, 0 writes, $0 egress fees,
 * and takes ~2 seconds.
 *
 * FALLBACK: Pass `--direct-d1` to execute a direct D1 export via Wrangler.
 *
 * USAGE:
 *   npx tsx scripts/d1_pull.ts
 *   npx tsx scripts/d1_pull.ts --direct-d1
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

import { getLocalD1Path } from './lib/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const localDbPath = getLocalD1Path();
const tempDir = path.join(rootDir, 'scripts', 'temp');

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const isDirectD1 = process.argv.includes('--direct-d1');

function ensureLocalSchema(db: Database.Database) {
  const migrationsDir = path.join(rootDir, 'migrations');
  if (!fs.existsSync(migrationsDir)) return;

  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of migrationFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const cleanSql = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    const statements = cleanSql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      try {
        db.exec(stmt);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          !msg.includes('already exists') &&
          !msg.includes('duplicate column')
        ) {
          // Ignore idempotent DDL warnings
        }
      }
    }
  }
}

function backupExistingLocalDb() {
  const backupDir = path.join(rootDir, 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  if (fs.existsSync(localDbPath)) {
    const backupPath = path.join(
      backupDir,
      `d1_local_prev_${Date.now()}.sqlite.bak`,
    );
    fs.copyFileSync(localDbPath, backupPath);
    console.log(
      `[D1Pull] Backed up existing local database to: backups/${path.basename(backupPath)}`,
    );
  }
}

async function pullFromR2() {
  console.log(
    '[D1Pull] Initiating zero-cost pull from Cloudflare R2 (collection-backups)...',
  );
  const tempSnapshotPath = path.join(tempDir, '_latest_snapshot.json');

  try {
    if (fs.existsSync(tempSnapshotPath)) {
      fs.unlinkSync(tempSnapshotPath);
    }

    console.log('[D1Pull] Downloading snapshots/latest.json from R2...');
    execSync(
      `npx wrangler r2 object get collection-backups/snapshots/latest.json --remote --file="${tempSnapshotPath}"`,
      {
        stdio: 'inherit',
        shell: true as unknown as string,
      },
    );

    if (
      !fs.existsSync(tempSnapshotPath) ||
      fs.statSync(tempSnapshotPath).size === 0
    ) {
      throw new Error('Downloaded R2 snapshot is missing or empty.');
    }

    const raw = fs.readFileSync(tempSnapshotPath, 'utf8');
    const snapshot = JSON.parse(raw) as {
      metadata?: { timestamp?: string; totalRows?: number; date?: string };
      tables?: Record<string, unknown[]>;
    };

    backupExistingLocalDb();

    console.log(
      `[D1Pull] Snapshot generated on: ${snapshot.metadata?.timestamp || 'unknown'}`,
    );
    console.log('[D1Pull] Hydrating local SQLite database...');

    const db = new Database(localDbPath);
    ensureLocalSchema(db);

    db.pragma('foreign_keys = OFF');

    const tables = snapshot.tables || {};
    let totalRestored = 0;

    const hydrateTx = db.transaction(() => {
      for (const [tableName, rows] of Object.entries(tables)) {
        if (!Array.isArray(rows)) continue;

        // Verify table exists locally before truncating/populating
        const exists = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
          )
          .get(tableName);
        if (!exists) continue;

        db.prepare(`DELETE FROM ${tableName}`).run();

        if (rows.length > 0) {
          const sample = rows[0] as Record<string, unknown>;
          const cols = Object.keys(sample);
          const placeholders = cols.map(() => '?').join(', ');
          const insertStmt = db.prepare(
            `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders})`,
          );

          for (const row of rows) {
            const r = row as Record<string, unknown>;
            insertStmt.run(cols.map((c) => (r[c] !== undefined ? r[c] : null)));
          }
        }
        totalRestored += rows.length;
        console.log(`  • ${tableName}: ${rows.length} rows`);
      }
    });

    hydrateTx();

    db.pragma('foreign_keys = ON');
    const integrity = db.pragma('integrity_check');
    console.log('[D1Pull] Integrity check:', integrity);
    db.close();

    fs.unlinkSync(tempSnapshotPath);
    console.log(
      `\n✅ Successfully pulled remote state from R2 into local SQLite! (${totalRestored} rows hydrated, 0 D1 reads consumed)`,
    );
  } catch (err) {
    if (fs.existsSync(tempSnapshotPath)) {
      try {
        fs.unlinkSync(tempSnapshotPath);
      } catch {
        // Ignore removal error
      }
    }
    throw err;
  }
}

async function pullFromDirectD1() {
  console.log(
    '[D1Pull] Initiating direct export from Cloudflare D1 (collection-db)...',
  );
  const tempSqlPath = path.join(rootDir, 'd1_export_temp.sql');

  try {
    if (fs.existsSync(tempSqlPath)) {
      fs.unlinkSync(tempSqlPath);
    }

    console.log('[D1Pull] Exporting remote D1 schema and data...');
    execSync(
      `npx wrangler d1 export collection-db --remote --output="${tempSqlPath}"`,
      {
        stdio: 'inherit',
        shell: true as unknown as string,
      },
    );

    if (!fs.existsSync(tempSqlPath) || fs.statSync(tempSqlPath).size === 0) {
      throw new Error('Exported SQL dump is empty or missing.');
    }

    backupExistingLocalDb();

    // Clean up database file AND any active -wal and -shm files to prevent corruption
    const localDir = path.dirname(localDbPath);
    const baseName = path.basename(localDbPath, '.sqlite');
    for (const f of fs.readdirSync(localDir)) {
      if (f.startsWith(baseName)) {
        try {
          fs.unlinkSync(path.join(localDir, f));
        } catch {
          // Ignore cleanup error
        }
      }
    }

    console.log(
      `[D1Pull] Rebuilding local D1 (${path.basename(localDbPath)}) from remote dump...`,
    );
    const newDb = new Database(localDbPath);
    newDb.pragma('foreign_keys = OFF');
    const sqlContent = fs.readFileSync(tempSqlPath, 'utf8');
    newDb.exec(sqlContent);

    const integrity = newDb.pragma('integrity_check');
    console.log('[D1Pull] Integrity check:', integrity);
    newDb.close();

    fs.unlinkSync(tempSqlPath);
    console.log(
      '✅ Successfully pulled remote Cloudflare D1 state directly into local D1!',
    );
  } catch (err) {
    if (fs.existsSync(tempSqlPath)) {
      try {
        fs.unlinkSync(tempSqlPath);
      } catch {
        // Ignore removal error
      }
    }
    throw err;
  }
}

async function main() {
  if (isDirectD1) {
    await pullFromDirectD1();
  } else {
    try {
      await pullFromR2();
    } catch (r2Err) {
      console.warn(
        '[D1Pull] Warning: R2 pull encountered an issue. Falling back to direct D1 export...',
        r2Err,
      );
      await pullFromDirectD1();
    }
  }
}

main().catch((err) => {
  console.error('[D1Pull] Failed to pull database:', err);
  process.exit(1);
});
