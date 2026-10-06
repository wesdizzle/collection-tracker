/**
 * CANONICAL DAT SYNCHRONIZATION UTILITY
 *
 * Scans canonical XML DAT files in `dats/` for tracked platforms,
 * normalizes titles, extracts regions/variants/CRCs/serials, deduplicates multi-disc sets,
 * and populates the local `canonical_releases` database table.
 *
 * Supports platform-specific surgical syncing via `--platform=<name|id>` to prevent
 * exhausting Cloudflare D1's daily free-tier write quota (100,000 writes/day).
 *
 * Compiles targeted, chunked SQL files (`scripts/temp/update_<platform>_d1.sql` or
 * `scripts/temp/canonical_releases_seed.sql`) for deployment to remote Cloudflare D1.
 *
 * USAGE:
 *   npx tsx scripts/sync_canonical_dats.ts [options]
 *
 * OPTIONS:
 *   --platform=<id|name>   Sync only the specified platform (e.g. --platform=vita or --platform=26)
 *   --dry-run              Calculate DAT counts and D1 quota impact without modifying data
 *   --help, -h             Show usage information
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
import { reconcileGameReleasesWithCanonical } from './lib/reconcile_releases.js';
import { getLocalD1Path } from './lib/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const dbPath = getLocalD1Path();
const tempDir = path.join(rootDir, 'scripts', 'temp');

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Canonical DAT Synchronization Utility

Usage:
  npx tsx scripts/sync_canonical_dats.ts [options]

Options:
  --platform=<id|name>  Sync only the specified platform (e.g. --platform=vita or --platform=26)
  --dry-run             Analyze DAT files and calculate D1 quota impact without modifying database
  --help, -h            Show this help message
`);
  process.exit(0);
}

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

// Parse --platform argument
let targetPlatformFilter: string | null = null;
const platformArg = process.argv.find((arg) => arg.startsWith('--platform='));
if (platformArg) {
  targetPlatformFilter = platformArg.split('=')[1].trim().toLowerCase();
} else {
  const platIdx = process.argv.indexOf('--platform');
  if (platIdx !== -1 && platIdx < process.argv.length - 1) {
    targetPlatformFilter = process.argv[platIdx + 1].trim().toLowerCase();
  }
}

const allPlatforms = db
  .prepare('SELECT id, name, display_name FROM platforms ORDER BY id ASC')
  .all() as PlatformRecord[];

let targetPlatforms = allPlatforms;
if (targetPlatformFilter) {
  // 1. Exact ID match
  const exactIdMatch = allPlatforms.filter(
    (p) => String(p.id) === targetPlatformFilter,
  );
  if (exactIdMatch.length > 0) {
    targetPlatforms = exactIdMatch;
  } else {
    // 2. Exact name or display_name match
    const exactNameMatch = allPlatforms.filter(
      (p) =>
        p.name.toLowerCase() === targetPlatformFilter ||
        (p.display_name &&
          p.display_name.toLowerCase() === targetPlatformFilter),
    );
    if (exactNameMatch.length > 0) {
      targetPlatforms = exactNameMatch;
    } else {
      // 3. Substring match
      const subMatch = allPlatforms.filter(
        (p) =>
          p.name.toLowerCase().includes(targetPlatformFilter!) ||
          (p.display_name &&
            p.display_name.toLowerCase().includes(targetPlatformFilter!)),
      );
      if (subMatch.length > 0) {
        targetPlatforms = subMatch;
      } else {
        console.error(
          `\n❌ [SyncDats] Error: No platform found matching "${targetPlatformFilter}".`,
        );
        console.error('Available platforms:');
        allPlatforms.forEach((p) =>
          console.error(
            `  - ID ${p.id.toString().padStart(2)}: ${p.display_name || p.name}`,
          ),
        );
        process.exit(1);
      }
    }
  }
}

const isScoped = targetPlatforms.length < allPlatforms.length;
const singlePlatform = targetPlatforms.length === 1 ? targetPlatforms[0] : null;

console.log(
  isDryRun
    ? `🔍 [SyncDats] DRY RUN MODE: Analyzing ${isScoped ? `scoped platform (${targetPlatforms.map((p) => p.display_name || p.name).join(', ')})` : 'all platforms'} & Cloudflare Free Tier quota impact...`
    : `🚀 [SyncDats] Scanning ${isScoped ? `scoped platform (${targetPlatforms.map((p) => p.display_name || p.name).join(', ')})` : 'all platforms'} for canonical DAT files...`,
);

if (!isScoped && !isDryRun) {
  console.log(
    '⚠️ [SyncDats] Notice: Full sync across all platforms consumes ~85,000 writes (~85% of daily 100k D1 quota). Use --platform=<name|id> for surgical single-platform updates.',
  );
}

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
    if (isScoped) {
      const targetIds = targetPlatforms.map((p) => p.id).join(',');
      db.prepare(
        `DELETE FROM canonical_releases WHERE source = 'dat' AND platform_id IN (${targetIds})`,
      ).run();
    } else {
      db.prepare("DELETE FROM canonical_releases WHERE source = 'dat'").run();
    }
  }

  for (const plat of targetPlatforms) {
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
    db.pragma('foreign_keys = OFF');
    const syncTx = db.transaction(processDats);
    syncTx();
    db.pragma('foreign_keys = ON');
  } else {
    processDats();
  }

  // Determine migration SQL filename
  const platformSlug = singlePlatform
    ? (singlePlatform.display_name || singlePlatform.name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
    : isScoped
      ? 'scoped_platforms'
      : 'canonical_releases_seed';

  const outputSqlFilename = singlePlatform
    ? `update_${platformSlug}_d1.sql`
    : isScoped
      ? 'update_scoped_platforms_d1.sql'
      : 'canonical_releases_seed.sql';

  const migrationSqlPath = path.join(tempDir, outputSqlFilename);

  // Reconcile unlinked collection game_releases with newly synced canonical_releases
  const reconcileResult = reconcileGameReleasesWithCanonical(db, {
    dryRun: isDryRun,
    platformId: singlePlatform ? singlePlatform.id : undefined,
    sqlOutputPath: path.join(
      tempDir,
      `reconcile_${singlePlatform ? platformSlug : 'releases'}.sql`,
    ),
  });

  const BATCH_SIZE = 250;
  const numBatches = Math.ceil(allCanonicalReleases.length / BATCH_SIZE);
  const estimatedSizeBytes = allCanonicalReleases.length * 160;
  const estimatedSizeMb = (estimatedSizeBytes / 1024 / 1024).toFixed(2);

  // Quota calculation (Cloudflare D1 free tier: 100,000 writes/day)
  const totalWriteOperations =
    totalDeduplicatedCount + reconcileResult.reconciledCount;
  const quotaPercentage = ((totalWriteOperations / 100000) * 100).toFixed(2);

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
    `- Synced Platforms:                  ${platformBreakdown.length} / ${targetPlatforms.length}`,
  );
  console.log(
    `- Raw DAT Releases Scanned:          ${totalRawCount.toLocaleString()}`,
  );
  console.log(
    `- Canonical Physical Signatures:     ${totalDeduplicatedCount.toLocaleString()}`,
  );
  console.log(
    `- Deduplication Savings:             ${((1 - totalDeduplicatedCount / (totalRawCount || 1)) * 100).toFixed(1)}% reduction`,
  );
  console.log(
    `- Collection Releases Reconciled:    ${reconcileResult.reconciledCount} releases`,
  );
  console.log(`- SQL Multi-Row Batches:             ${numBatches} statements`);

  console.log('\n--- 🌐 Cloudflare Free Tier Limit Analysis ---');
  console.log(
    `1. Total Storage:                    ~${estimatedSizeMb} MB (~${((Number(estimatedSizeMb) / 500) * 100).toFixed(1)}% of 500 MB quota) ✅`,
  );
  console.log(
    `2. Remote Write Operations:          ${totalWriteOperations.toLocaleString()} writes (${quotaPercentage}% of 100k daily write quota) ✅`,
  );
  console.log(
    `3. Daily Steady-State Production:    0 writes/day (read-only indexed queries against D1) ✅`,
  );
  console.log(
    '===============================================================\n',
  );

  if (!isDryRun) {
    // Generate surgical chunked SQL seed file for Cloudflare D1 deployment
    let sqlBuffer = 'PRAGMA foreign_keys = OFF;\n';
    if (isScoped) {
      const targetIds = targetPlatforms.map((p) => p.id).join(',');
      sqlBuffer += `-- 1. Remove previous canonical releases for scoped platform(s)\nDELETE FROM canonical_releases WHERE source = 'dat' AND platform_id IN (${targetIds});\n\n`;
    } else {
      sqlBuffer +=
        "-- 1. Remove all previous DAT canonical releases\nDELETE FROM canonical_releases WHERE source = 'dat';\n\n";
    }

    if (allCanonicalReleases.length > 0) {
      sqlBuffer += '-- 2. Insert deduplicated canonical releases\n';
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
    }

    if (reconcileResult.updates && reconcileResult.updates.length > 0) {
      sqlBuffer += '-- 3. Reconcile collection game releases\n';
      for (const update of reconcileResult.updates) {
        const escapedRom = `'${update.romName.replace(/'/g, "''")}'`;
        const escapedCrc = update.romCrc ? `'${update.romCrc}'` : 'NULL';
        sqlBuffer += `UPDATE game_releases SET canonical_release_id = ${update.canonicalId}, rom_name = ${escapedRom}, rom_crc = ${escapedCrc} WHERE id = '${update.releaseId}';\n`;
      }
      sqlBuffer += '\n';
    }

    sqlBuffer += 'PRAGMA foreign_keys = ON;\n';
    fs.writeFileSync(migrationSqlPath, sqlBuffer, 'utf8');
    const actualSizeMb = (
      fs.statSync(migrationSqlPath).size /
      1024 /
      1024
    ).toFixed(2);
    console.log(
      `[SyncDats] Generated surgical D1 deployment SQL: ${path.relative(rootDir, migrationSqlPath)} (${actualSizeMb} MB)`,
    );
    console.log(
      `[SyncDats] To apply to remote D1: npx wrangler d1 execute collection-db --remote --file=${path.relative(rootDir, migrationSqlPath)}`,
    );
  }
} catch (err) {
  console.error('[SyncDats] Synchronization failed:', err);
  process.exit(1);
} finally {
  db.close();
}
