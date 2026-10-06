/**
 * SURGICAL PLAYSTATION VITA (PLATFORM 33) SYNCHRONIZATION UTILITY
 *
 * Synchronizes Sony PlayStation Vita canonical releases to preferred .zip archives,
 * extracts Title IDs into serial_code, links collection releases in local D1,
 * and exports a quota-minimized SQL migration file for remote Cloudflare D1 deployment.
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { parseDatFile } from './lib/dat_parser.js';
import { deduplicateDatReleases } from './lib/canonical_releases.js';
import { titlesMatch } from './lib/title_matching.js';
import { reconcileGameReleasesWithCanonical } from './lib/reconcile_releases.js';
import { getLocalD1Path } from './lib/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const tempDir = path.join(rootDir, 'scripts', 'temp');

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

export function syncVitaPlatform(options: { dryRun?: boolean } = {}) {
  const isDryRun = options.dryRun ?? false;
  const dbPath = getLocalD1Path();
  const db = new Database(dbPath);

  const datPath = path.join(
    rootDir,
    'dats',
    'No-Intro',
    'Sony - PlayStation Vita.dat',
  );
  if (!fs.existsSync(datPath)) {
    throw new Error(`Vita DAT file not found at: ${datPath}`);
  }

  console.log(
    `[SyncVita] Parsing DAT file: ${path.relative(rootDir, datPath)}...`,
  );
  const parsed = parseDatFile(datPath);
  console.log(`[SyncVita] Parsed ${parsed.releases.length} raw releases.`);

  const deduplicated = deduplicateDatReleases(33, parsed.releases);
  console.log(
    `[SyncVita] Deduplicated into ${deduplicated.length} canonical .zip releases with Title IDs.`,
  );

  // Enrich deduplicated releases with DB physical games
  const dbPhysicalGames = db
    .prepare(
      `
    SELECT DISTINCT g.title
    FROM games g
    JOIN game_releases gr ON g.stable_id = gr.game_id
    WHERE g.platform_id = 33 AND (gr.is_physical = 1 OR gr.ownership_status = 1 OR g.gameye_id IS NOT NULL)
  `,
    )
    .all() as Array<{ title: string }>;

  for (const rel of deduplicated) {
    if (rel.is_verified_physical === 0) {
      const isDbPhysical = dbPhysicalGames.some((g) =>
        titlesMatch(g.title, rel.raw_title, rel.rom_name || undefined, 33),
      );
      if (isDbPhysical) {
        rel.is_verified_physical = 1;
      }
    }
  }

  const physicalCount = deduplicated.filter(
    (r) => r.is_verified_physical === 1,
  ).length;
  const digitalCount = deduplicated.filter(
    (r) => r.is_verified_physical === 0,
  ).length;
  console.log(
    `[SyncVita] Physical breakdown: ${physicalCount} verified physical (is_verified_physical = 1), ${digitalCount} digital/unverified (is_verified_physical = 0).`,
  );

  // Measure before-state
  const existingDatCount = db
    .prepare(
      "SELECT count(*) as count FROM canonical_releases WHERE platform_id = 33 AND source = 'dat'",
    )
    .get() as { count: number };

  const existingGameReleasesWithPsvOrVpk = db
    .prepare(
      `
    SELECT count(*) as count
    FROM game_releases r
    JOIN games g ON r.game_id = g.stable_id
    WHERE g.platform_id = 33 AND (r.rom_name LIKE '%.psv' OR r.rom_name LIKE '%.vpk')
  `,
    )
    .get() as { count: number };

  console.log(`[SyncVita] Current local D1 state for Platform 33:`);
  console.log(
    `  - Existing canonical_releases (source = 'dat'): ${existingDatCount.count}`,
  );
  console.log(
    `  - Existing game_releases with legacy .psv/.vpk:     ${existingGameReleasesWithPsvOrVpk.count}`,
  );

  const insertStmt = db.prepare(`
    INSERT INTO canonical_releases (
      platform_id, raw_title, normalized_title, region, variants,
      rom_name, rom_crc, serial_code, barcode, publisher, source, is_verified_physical
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?
    )
  `);

  if (!isDryRun) {
    db.pragma('foreign_keys = OFF');
    const tx = db.transaction(() => {
      // 1. Delete old Vita DAT canonical releases
      db.prepare(
        "DELETE FROM canonical_releases WHERE platform_id = 33 AND source = 'dat'",
      ).run();

      // 2. Insert new canonical releases with .zip and serial codes
      for (const rel of deduplicated) {
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

      // 3. Clear existing Vita rom_name and canonical_release_id so all releases re-match cleanly
      db.prepare(
        `
        UPDATE game_releases
        SET rom_name = NULL, rom_crc = NULL, canonical_release_id = NULL
        WHERE game_id IN (SELECT stable_id FROM games WHERE platform_id = 33)
      `,
      ).run();
    });
    tx();
    db.pragma('foreign_keys = ON');
  }

  // 4. Reconcile game_releases with new canonical_releases
  const reconcileResult = reconcileGameReleasesWithCanonical(db, {
    platformId: 33,
    dryRun: isDryRun,
  });

  console.log(
    `[SyncVita] Reconciled ${reconcileResult.reconciledCount} Vita game_releases to .zip canonical signatures.`,
  );

  // Generate surgical SQL file for remote Cloudflare D1
  const sqlFilePath = path.join(tempDir, 'update_vita_d1.sql');
  const BATCH_SIZE = 100;
  let sql = `-- =========================================================================\n`;
  sql += `-- SURGICAL PLAYSTATION VITA (PLATFORM 33) REMOTE CLOUDFLARE D1 UPDATE\n`;
  sql += `-- Total estimated D1 row writes: ~${deduplicated.length + existingDatCount.count + reconcileResult.reconciledCount} rows (<0.5% of 100,000 daily free tier quota)\n`;
  sql += `-- =========================================================================\n\n`;
  sql += `PRAGMA foreign_keys = OFF;\n\n`;
  sql += `-- Step 1: Remove legacy Platform 33 DAT rows\n`;
  sql += `DELETE FROM canonical_releases WHERE platform_id = 33 AND source = 'dat';\n\n`;
  sql += `-- Step 2: Clear existing Platform 33 rom_name bindings to allow clean re-reconciliation\n`;
  sql += `UPDATE game_releases SET rom_name = NULL, rom_crc = NULL, canonical_release_id = NULL WHERE game_id IN (SELECT stable_id FROM games WHERE platform_id = 33);\n\n`;
  sql += `-- Step 3: Insert canonical .zip releases with Title IDs\n`;

  for (let i = 0; i < deduplicated.length; i += BATCH_SIZE) {
    const batch = deduplicated.slice(i, i + BATCH_SIZE);
    sql += `INSERT INTO canonical_releases (platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, serial_code, barcode, publisher, source, is_verified_physical) VALUES\n`;
    const rows = batch.map((r) => {
      const escape = (val: string | null | undefined) =>
        val !== null && val !== undefined
          ? `'${String(val).replace(/'/g, "''")}'`
          : 'NULL';
      return `  (${r.platform_id}, ${escape(r.raw_title)}, ${escape(r.normalized_title)}, ${escape(r.region)}, ${escape(r.variants)}, ${escape(r.rom_name)}, ${escape(r.rom_crc)}, ${escape(r.serial_code)}, ${escape(r.barcode)}, ${escape(r.publisher)}, '${r.source}', ${r.is_verified_physical})`;
    });
    sql += rows.join(',\n') + ';\n\n';
  }

  sql += `-- Step 4: Apply reconciled game_releases updates\n`;
  if (fs.existsSync(reconcileResult.sqlPath)) {
    const reconcileSql = fs.readFileSync(reconcileResult.sqlPath, 'utf8');
    sql += reconcileSql + '\n';
  }

  sql += `PRAGMA foreign_keys = ON;\n`;
  fs.writeFileSync(sqlFilePath, sql, 'utf8');

  const finalVitaExtensions = db
    .prepare(
      `
    SELECT r.rom_name
    FROM game_releases r
    JOIN games g ON r.game_id = g.stable_id
    WHERE g.platform_id = 33 AND r.rom_name IS NOT NULL
  `,
    )
    .all() as Array<{ rom_name: string }>;

  const extMap = finalVitaExtensions.reduce(
    (acc, r) => {
      const ext = r.rom_name.slice(r.rom_name.lastIndexOf('.'));
      acc[ext] = (acc[ext] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  console.log(
    `[SyncVita] Post-sync local D1 Vita extensions breakdown:`,
    extMap,
  );
  console.log(
    `[SyncVita] Generated remote migration SQL at: ${path.relative(rootDir, sqlFilePath)}`,
  );

  return {
    deduplicatedCount: deduplicated.length,
    reconciledCount: reconcileResult.reconciledCount,
    extMap,
    sqlFilePath,
  };
}

if (process.argv[1] && process.argv[1].endsWith('sync_vita.ts')) {
  syncVitaPlatform({ dryRun: process.argv.includes('--dry-run') });
}
