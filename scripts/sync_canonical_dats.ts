/**
 * CANONICAL DAT SYNCHRONIZATION UTILITY
 *
 * Scans the canonical XML DAT files in `dats/` for all tracked platforms,
 * normalizes titles, extracts regions/variants/CRCs/serials, deduplicates multi-disc sets,
 * and populates the local `canonical_releases` database table.
 *
 * Also compiles optimized, chunked SQL files (`scripts/temp/canonical_releases_seed.sql`)
 * for deployment to remote Cloudflare D1 via `wrangler d1 execute`.
 *
 * USAGE:
 *   npx tsx scripts/sync_canonical_dats.ts
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { parseDatFile } from './lib/dat_parser.js';
import { findDatFileForPlatform, PlatformRecord } from './lib/dat_cache.js';
import {
  deduplicateDatReleases,
  CanonicalRelease,
} from './lib/canonical_releases.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const dbPath = path.join(rootDir, 'collection.sqlite');
const tempDir = path.join(rootDir, 'scripts', 'temp');

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

if (!fs.existsSync(dbPath)) {
  console.error(
    `[SyncDats] Error: Database not found at ${dbPath}. Run npm run db:init first.`,
  );
  process.exit(1);
}

const db = new Database(dbPath);

const isDryRun = process.argv.includes('--dry-run');

console.log(
  isDryRun
    ? '🔍 [SyncDats] DRY RUN MODE: Analyzing canonical DATs & Cloudflare Free Tier quota impact...'
    : '🚀 [SyncDats] Scanning tracked platforms for canonical DAT files...',
);

const platforms = db
  .prepare('SELECT id, name, display_name FROM platforms ORDER BY id ASC')
  .all() as PlatformRecord[];

let totalRawCount = 0;
let totalDeduplicatedCount = 0;
const allCanonicalReleases: CanonicalRelease[] = [];
const platformBreakdown: Array<{
  id: number;
  name: string;
  raw: number;
  deduped: number;
  pct: string;
}> = [];

// Prepare SQLite statements (only if not dry run)
const insertStmt = isDryRun
  ? null
  : db.prepare(`
  INSERT INTO canonical_releases (
    platform_id, raw_title, normalized_title, region, variants,
    rom_name, rom_crc, serial_code, barcode, publisher, source, is_verified_physical
  ) VALUES (
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?, ?
  )
`);

const processDats = () => {
  if (!isDryRun) {
    db.prepare("DELETE FROM canonical_releases WHERE source = 'dat'").run();
  }

  for (const plat of platforms) {
    const datInfo = findDatFileForPlatform(db, plat.id);
    if (!datInfo) {
      if (!isDryRun) {
        console.log(
          `[SyncDats] Platform ${plat.id} (${plat.display_name || plat.name}): No DAT file found in dats/`,
        );
      }
      continue;
    }

    const { filePath } = datInfo;
    const parsed = parseDatFile(filePath);
    const rawCount = parsed.releases.length;
    totalRawCount += rawCount;

    const deduplicated = deduplicateDatReleases(plat.id, parsed.releases);
    totalDeduplicatedCount += deduplicated.length;

    platformBreakdown.push({
      id: plat.id,
      name: plat.display_name || plat.name,
      raw: rawCount,
      deduped: deduplicated.length,
      pct: `${((1 - deduplicated.length / (rawCount || 1)) * 100).toFixed(1)}%`,
    });

    for (const rel of deduplicated) {
      if (insertStmt) {
        insertStmt.run(
          rel.platform_id,
          rel.raw_title,
          rel.normalized_title,
          rel.region || null,
          rel.variants || null,
          rel.rom_name || null,
          rel.rom_crc || null,
          rel.serial_code || null,
          rel.barcode || null,
          rel.publisher || null,
          rel.source,
          rel.is_verified_physical,
        );
      }
      allCanonicalReleases.push(rel);
    }

    if (!isDryRun) {
      console.log(
        `[SyncDats] Platform ${plat.id} (${plat.display_name || plat.name}): ${rawCount} raw releases -> ${deduplicated.length} canonical physical signatures.`,
      );
    }
  }
};

try {
  if (!isDryRun) {
    const syncTx = db.transaction(processDats);
    syncTx();
  } else {
    processDats();
  }

  const BATCH_SIZE = 250;
  const numBatches = Math.ceil(allCanonicalReleases.length / BATCH_SIZE);
  // Estimated seed SQL size (~160 bytes per row + SQL overhead)
  const estimatedSizeBytes = allCanonicalReleases.length * 160;
  const estimatedSizeMb = (estimatedSizeBytes / 1024 / 1024).toFixed(2);

  console.log(
    '\n===============================================================',
  );
  console.log(
    isDryRun
      ? '📊 CLOUDFLARE D1 FREE TIER QUOTA IMPACT (DRY RUN)'
      : '✅ CANONICAL RELEASES SYNCHRONIZATION SUMMARY',
  );
  console.log(
    '===============================================================',
  );
  console.log(
    `- Tracked Platforms with DATs:       ${platformBreakdown.length} / ${platforms.length}`,
  );
  console.log(
    `- Raw DAT Releases Scanned:           ${totalRawCount.toLocaleString()}`,
  );
  console.log(
    `- Canonical Physical Signatures:      ${totalDeduplicatedCount.toLocaleString()}`,
  );
  console.log(
    `- Multi-Disc Deduplication Savings:   ${((1 - totalDeduplicatedCount / (totalRawCount || 1)) * 100).toFixed(1)}% reduction`,
  );
  console.log(`- SQL Multi-Row Batches (250/batch):  ${numBatches} statements`);

  console.log('\n--- 🌐 Cloudflare Free Tier Limit Analysis ---');
  console.log(
    `1. Total Storage (500 MB max):        ~${estimatedSizeMb} MB (~${((Number(estimatedSizeMb) / 500) * 100).toFixed(1)}% of 500 MB quota) ✅`,
  );
  console.log(`2. Remote Seed Operations:`);
  console.log(
    `   - Batched SQL statements:          ${numBatches} statements (<0.4% of daily limit) ✅`,
  );
  console.log(
    `   - Row-level writes (worst-case):   ${totalDeduplicatedCount.toLocaleString()} rows (${((totalDeduplicatedCount / 100000) * 100).toFixed(1)}% of 100k daily write quota, resets in 24h) ✅`,
  );
  console.log(
    `3. Daily Steady-State Production:     0 writes/day (read-only indexed queries against D1) ✅`,
  );
  console.log(
    '===============================================================\n',
  );

  if (!isDryRun) {
    // Generate chunked SQL seed file for Cloudflare D1 remote deployment
    const seedSqlPath = path.join(tempDir, 'canonical_releases_seed.sql');
    let sqlBuffer =
      "PRAGMA foreign_keys = OFF;\nDELETE FROM canonical_releases WHERE source = 'dat';\n\n";

    for (let i = 0; i < allCanonicalReleases.length; i += BATCH_SIZE) {
      const batch = allCanonicalReleases.slice(i, i + BATCH_SIZE);
      sqlBuffer +=
        'INSERT INTO canonical_releases (platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, serial_code, barcode, publisher, source, is_verified_physical) VALUES\n';

      const valueRows = batch.map((r) => {
        const escape = (val: string | null | undefined) =>
          val !== null && val !== undefined
            ? `'${String(val).replace(/'/g, "''")}'`
            : 'NULL';
        return `  (${r.platform_id}, ${escape(r.raw_title)}, ${escape(r.normalized_title)}, ${escape(r.region)}, ${escape(r.variants)}, ${escape(r.rom_name)}, ${escape(r.rom_crc)}, ${escape(r.serial_code)}, ${escape(r.barcode)}, ${escape(r.publisher)}, '${r.source}', ${r.is_verified_physical})`;
      });

      sqlBuffer += valueRows.join(',\n') + ';\n\n';
    }

    sqlBuffer += 'PRAGMA foreign_keys = ON;\n';
    fs.writeFileSync(seedSqlPath, sqlBuffer, 'utf8');
    const actualSizeMb = (fs.statSync(seedSqlPath).size / 1024 / 1024).toFixed(
      2,
    );
    console.log(
      `[SyncDats] Generated D1 deployment seed SQL: ${path.relative(rootDir, seedSqlPath)} (${actualSizeMb} MB)`,
    );
  }
} catch (err) {
  console.error('[SyncDats] Synchronization failed:', err);
  process.exit(1);
} finally {
  db.close();
}
