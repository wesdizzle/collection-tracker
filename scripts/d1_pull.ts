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
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { runD1PullFromR2 } from '@wesdizzle/app-kit/scripts';

import { getLocalD1Path } from './lib/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const localDbPath = getLocalD1Path();
const schemaSqlPath = path.join(rootDir, 'migrations', 'schema.sql');

const TABLE_HYDRATION_ORDER = [
  'platforms',
  'toy_series',
  'canonical_releases',
  'ignored_items',
  'users',
  'games',
  'game_releases',
  'toys',
  'toy_game_compatibility',
  'user_games',
  'user_game_releases',
  'user_toys',
  'journal_entries',
  'push_subscriptions',
  'sync_state',
  'cron_execution_logs',
] as const;

const isDirectD1 = process.argv.includes('--direct-d1');

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

  let totalRestored = 0;
  for (const [table, count] of Object.entries(rowCounts)) {
    totalRestored += count;
    console.log(`  • ${table}: ${count} rows`);
  }

  console.log(
    `\n✅ Successfully pulled remote state from R2 into local SQLite! (${totalRestored} rows hydrated, 0 D1 reads consumed)`,
  );
}

async function pullFromDirectD1() {
  console.log(
    '[D1Pull] Initiating explicit --direct-d1 export from Cloudflare D1 (collection-db)...',
  );
  const tempSqlPath = path.join(
    os.tmpdir(),
    `_d1_export_${process.pid}_${Date.now()}.sql`,
  );

  try {
    execSync(
      `npx wrangler d1 export collection-db --remote --output="${tempSqlPath}"`,
      {
        cwd: rootDir,
        stdio: 'inherit',
        shell: true as unknown as string,
      },
    );

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
      const sqlContent = fs.readFileSync(tempSqlPath, 'utf8');
      newDb.exec(sqlContent);
      if (fs.existsSync(schemaSqlPath)) {
        newDb.exec(fs.readFileSync(schemaSqlPath, 'utf8'));
      }
      newDb.pragma('foreign_keys = ON');
      const integrity = newDb.pragma('integrity_check');
      console.log('[D1Pull] Integrity check:', integrity);
    } finally {
      newDb.close();
    }

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

main().catch((err) => {
  console.error('[D1Pull] Failed to pull database:', err);
  process.exit(1);
});
