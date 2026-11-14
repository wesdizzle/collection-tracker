/**
 * CANONICAL PHYSICAL RELEASE SOURCE SYNCHRONIZER
 *
 * Parses all local DAT files in `/dats` (No-Intro and Redump) + curated physical serial catalogs
 * and populates the `canonical_releases` table locally, while generating a delta (or full) SQL file
 * (`scripts/temp/seed_canonical_releases.sql`) and reconciling `game_releases` rows.
 *
 * Usage:
 *   npx tsx scripts/sync_canonical_sources.ts
 *   npx tsx scripts/sync_canonical_sources.ts --platform=29
 *   npx tsx scripts/sync_canonical_sources.ts --full-seed
 *   npx tsx scripts/sync_canonical_sources.ts --push-remote --max-writes=50000
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { getLocalDatabase } from './lib/db.js';
import { getPlatformDatReleases, PlatformRecord } from './lib/dat_cache.js';
import { deduplicateDatReleases } from '../shared/canonical_releases.js';
import { reconcileGameReleasesWithCanonical } from './lib/reconcile_releases.js';
import {
  fetchAllPublicBudgetInductions,
  classifyCartridgeBudgetWithRecords,
  BudgetInductionRecord,
} from './lib/budget_sources.js';
import { findRetailPackInDisc } from '../shared/special_labels.js';
import { runWithD1CostGuard } from './d1_cost_guard.js';

export interface SyncCanonicalOptions {
  targetPlatformId?: number;
  skipReconcile?: boolean;
  fullSeed?: boolean;
  pushRemote?: boolean;
  maxWrites?: number;
  db?: Database.Database;
}

export interface SyncCanonicalResult {
  totalProcessed: number;
  deltaCount: number;
  reconciledCount: number;
  sqlFilePath: string;
  reconcileSqlPath: string;
}

interface CanonicalCandidateRow {
  platformId: number;
  rawTitle: string;
  normalizedTitle: string;
  region: string;
  variants: string | null;
  alsoReleasedAs: string | null;
  packinHostNormTitle: string | null;
  romName: string;
  romCrc: string | null;
  serialCode: string | null;
}

function escapeSql(s: string | null | undefined): string {
  return s === null || s === undefined ? 'NULL' : `'${s.replace(/'/g, "''")}'`;
}

export async function syncCanonicalSources(
  options: SyncCanonicalOptions = {},
): Promise<SyncCanonicalResult> {
  const {
    targetPlatformId,
    skipReconcile = false,
    fullSeed = false,
    pushRemote = false,
    maxWrites = 50000,
  } = options;

  console.log('=== Canonical Physical Release Source Synchronizer ===');
  const ownDb = !options.db;
  const db = options.db || getLocalDatabase();

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS canonical_releases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform_id INTEGER NOT NULL,
        raw_title TEXT NOT NULL,
        normalized_title TEXT NOT NULL,
        region TEXT,
        variants TEXT,
        also_released_as TEXT,
        packin_host_normalized_title TEXT,
        redump_disc_id INTEGER,
        rom_name TEXT,
        rom_crc TEXT,
        serial_code TEXT,
        barcode TEXT,
        publisher TEXT,
        source TEXT NOT NULL DEFAULT 'dat',
        is_verified_physical INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (platform_id) REFERENCES platforms(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_canonical_releases_platform_norm ON canonical_releases(platform_id, normalized_title);
      CREATE INDEX IF NOT EXISTS idx_canonical_releases_crc ON canonical_releases(rom_crc);
      CREATE INDEX IF NOT EXISTS idx_canonical_releases_rom_name ON canonical_releases(rom_name);
    `);

    const crColumns = db
      .prepare("PRAGMA table_info('canonical_releases')")
      .all() as Array<{ name: string }>;
    if (!crColumns.some((c) => c.name === 'also_released_as')) {
      db.exec(
        'ALTER TABLE canonical_releases ADD COLUMN also_released_as TEXT;',
      );
    }
    if (!crColumns.some((c) => c.name === 'packin_host_normalized_title')) {
      db.exec(
        'ALTER TABLE canonical_releases ADD COLUMN packin_host_normalized_title TEXT;',
      );
    }
    if (!crColumns.some((c) => c.name === 'redump_disc_id')) {
      db.exec(
        'ALTER TABLE canonical_releases ADD COLUMN redump_disc_id INTEGER;',
      );
    }

    let budgetRecords: BudgetInductionRecord[] = [];
    try {
      budgetRecords = await fetchAllPublicBudgetInductions(false);
    } catch {
      // Fallback gracefully if offline
    }

    let platforms = db
      .prepare(
        'SELECT id, name, display_name FROM platforms WHERE id != 0 ORDER BY id ASC',
      )
      .all() as PlatformRecord[];
    if (targetPlatformId !== undefined) {
      platforms = platforms.filter((p) => p.id === targetPlatformId);
    }

    // Load existing DAT rows so we only emit SQL for actual new/changed releases (unless --full-seed)
    const existingByPlatformAndRom = new Map<
      string,
      {
        id: number;
        raw_title: string;
        normalized_title: string;
        region: string | null;
        variants: string | null;
        also_released_as: string | null;
        packin_host_normalized_title: string | null;
        rom_crc: string | null;
        serial_code: string | null;
      }
    >();

    const existingRowsQuery =
      targetPlatformId !== undefined
        ? "SELECT id, platform_id, raw_title, normalized_title, region, variants, also_released_as, packin_host_normalized_title, rom_name, rom_crc, serial_code FROM canonical_releases WHERE source = 'dat' AND platform_id = ?"
        : "SELECT id, platform_id, raw_title, normalized_title, region, variants, also_released_as, packin_host_normalized_title, rom_name, rom_crc, serial_code FROM canonical_releases WHERE source = 'dat'";
    const existingRows = (
      targetPlatformId !== undefined
        ? db.prepare(existingRowsQuery).all(targetPlatformId)
        : db.prepare(existingRowsQuery).all()
    ) as Array<{
      id: number;
      platform_id: number;
      raw_title: string;
      normalized_title: string;
      region: string | null;
      variants: string | null;
      also_released_as: string | null;
      packin_host_normalized_title: string | null;
      rom_name: string | null;
      rom_crc: string | null;
      serial_code: string | null;
    }>;

    for (const row of existingRows) {
      if (row.rom_name) {
        existingByPlatformAndRom.set(
          `${row.platform_id}::${row.rom_name}`,
          row,
        );
      }
    }

    const insertStmt = db.prepare(`
      INSERT INTO canonical_releases (
        platform_id, raw_title, normalized_title, region, variants,
        also_released_as, packin_host_normalized_title,
        rom_name, rom_crc, serial_code, source, is_verified_physical
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'dat', 1)
    `);

    const updateStmt = db.prepare(`
      UPDATE canonical_releases
      SET raw_title = ?,
          normalized_title = ?,
          region = ?,
          variants = ?,
          also_released_as = ?,
          packin_host_normalized_title = ?,
          rom_crc = ?,
          serial_code = COALESCE(?, serial_code)
      WHERE id = ?
    `);

    const tempDir = path.join(process.cwd(), 'scripts', 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const sqlFilePath = path.join(tempDir, 'seed_canonical_releases.sql');
    const sqlStream = fs.createWriteStream(sqlFilePath, { encoding: 'utf8' });

    let totalProcessed = 0;
    let deltaCount = 0;

    const recordCandidate = (cand: CanonicalCandidateRow) => {
      totalProcessed++;
      const key = `${cand.platformId}::${cand.romName}`;
      const existing = existingByPlatformAndRom.get(key);

      if (!existing) {
        insertStmt.run(
          cand.platformId,
          cand.rawTitle,
          cand.normalizedTitle,
          cand.region,
          cand.variants,
          cand.alsoReleasedAs,
          cand.packinHostNormTitle,
          cand.romName,
          cand.romCrc,
          cand.serialCode,
        );
        existingByPlatformAndRom.set(key, {
          id: -1,
          raw_title: cand.rawTitle,
          normalized_title: cand.normalizedTitle,
          region: cand.region,
          variants: cand.variants,
          also_released_as: cand.alsoReleasedAs,
          packin_host_normalized_title: cand.packinHostNormTitle,
          rom_crc: cand.romCrc,
          serial_code: cand.serialCode,
        });
        deltaCount++;
        sqlStream.write(
          `INSERT INTO canonical_releases (platform_id, raw_title, normalized_title, region, variants, also_released_as, packin_host_normalized_title, rom_name, rom_crc, serial_code, source, is_verified_physical) SELECT ${cand.platformId}, ${escapeSql(cand.rawTitle)}, ${escapeSql(cand.normalizedTitle)}, ${escapeSql(cand.region)}, ${escapeSql(cand.variants)}, ${escapeSql(cand.alsoReleasedAs)}, ${escapeSql(cand.packinHostNormTitle)}, ${escapeSql(cand.romName)}, ${escapeSql(cand.romCrc)}, ${escapeSql(cand.serialCode)}, 'dat', 1 WHERE NOT EXISTS (SELECT 1 FROM canonical_releases WHERE platform_id = ${cand.platformId} AND rom_name = ${escapeSql(cand.romName)} AND source = 'dat');\n`,
        );
        return;
      }

      const isChanged =
        existing.raw_title !== cand.rawTitle ||
        existing.normalized_title !== cand.normalizedTitle ||
        (existing.region || null) !== (cand.region || null) ||
        (existing.variants || null) !== (cand.variants || null) ||
        (existing.also_released_as || null) !== (cand.alsoReleasedAs || null) ||
        (existing.packin_host_normalized_title || null) !==
          (cand.packinHostNormTitle || null) ||
        (existing.rom_crc || null) !== (cand.romCrc || null) ||
        (cand.serialCode && existing.serial_code !== cand.serialCode);

      if (isChanged) {
        if (existing.id > 0) {
          updateStmt.run(
            cand.rawTitle,
            cand.normalizedTitle,
            cand.region,
            cand.variants,
            cand.alsoReleasedAs,
            cand.packinHostNormTitle,
            cand.romCrc,
            cand.serialCode,
            existing.id,
          );
        }
        deltaCount++;
        sqlStream.write(
          `UPDATE canonical_releases SET raw_title = ${escapeSql(cand.rawTitle)}, normalized_title = ${escapeSql(cand.normalizedTitle)}, region = ${escapeSql(cand.region)}, variants = ${escapeSql(cand.variants)}, also_released_as = ${escapeSql(cand.alsoReleasedAs)}, packin_host_normalized_title = ${escapeSql(cand.packinHostNormTitle)}, rom_crc = ${escapeSql(cand.romCrc)}, serial_code = COALESCE(${escapeSql(cand.serialCode)}, serial_code) WHERE platform_id = ${cand.platformId} AND rom_name = ${escapeSql(cand.romName)} AND source = 'dat';\n`,
        );
      } else if (fullSeed) {
        deltaCount++;
        sqlStream.write(
          `INSERT INTO canonical_releases (platform_id, raw_title, normalized_title, region, variants, also_released_as, packin_host_normalized_title, rom_name, rom_crc, serial_code, source, is_verified_physical) SELECT ${cand.platformId}, ${escapeSql(cand.rawTitle)}, ${escapeSql(cand.normalizedTitle)}, ${escapeSql(cand.region)}, ${escapeSql(cand.variants)}, ${escapeSql(cand.alsoReleasedAs)}, ${escapeSql(cand.packinHostNormTitle)}, ${escapeSql(cand.romName)}, ${escapeSql(cand.romCrc)}, ${escapeSql(cand.serialCode)}, 'dat', 1 WHERE NOT EXISTS (SELECT 1 FROM canonical_releases WHERE platform_id = ${cand.platformId} AND rom_name = ${escapeSql(cand.romName)} AND source = 'dat');\n`,
        );
      }
    };

    const syncTransaction = db.transaction(() => {
      for (const plat of platforms) {
        if (plat.id === 26) {
          console.log(
            `  [${plat.display_name || plat.name}] Managed in production Worker via Nintendo Revised sheet (skipping local DAT sync)`,
          );
          continue;
        }

        const datReleases = getPlatformDatReleases(db, plat.id, false);
        const deduplicated = deduplicateDatReleases(
          plat.id,
          datReleases.map((d) => ({
            name: d.name,
            roms: [
              {
                name: d.romName || `${d.name}.rom`,
                crc: d.romCrc || null,
              },
            ],
          })),
        );
        let platCount = 0;

        for (const rel of deduplicated) {
          const region = rel.region || 'USA';
          let variants = rel.variants || null;
          let alsoReleasedAs = rel.also_released_as || null;

          const isUpdatedEdition =
            /welcome amiibo/i.test(rel.raw_title) ||
            Boolean(rel.rom_name && /welcome amiibo/i.test(rel.rom_name));
          const budgetClass = classifyCartridgeBudgetWithRecords(
            budgetRecords,
            {
              platformId: plat.id,
              gameTitle: rel.raw_title,
              region,
              physicalReleaseDate: isUpdatedEdition ? '2016-11-25' : null,
              isUpdatedEdition,
            },
          );
          if (budgetClass.isBudget) {
            if (budgetClass.isBudgetOnly && budgetClass.budgetLabel) {
              if (
                !variants ||
                !variants
                  .toLowerCase()
                  .includes(budgetClass.budgetLabel.toLowerCase())
              ) {
                variants = variants
                  ? `${variants}, ${budgetClass.budgetLabel}`
                  : budgetClass.budgetLabel;
              }
            } else if (budgetClass.alsoReleasedAs && !alsoReleasedAs) {
              alsoReleasedAs = budgetClass.alsoReleasedAs;
            }
          }

          const packInEntry =
            findRetailPackInDisc(rel.rom_name || '') ||
            findRetailPackInDisc(rel.raw_title);
          const packinHostNormTitle =
            rel.packin_host_normalized_title ||
            (packInEntry ? packInEntry.hostGameNormTitle : null);

          recordCandidate({
            platformId: plat.id,
            rawTitle: rel.raw_title,
            normalizedTitle: rel.normalized_title,
            region,
            variants,
            alsoReleasedAs,
            packinHostNormTitle,
            romName: rel.rom_name || `${rel.raw_title}.rom`,
            romCrc: rel.rom_crc ? rel.rom_crc.toLowerCase() : null,
            serialCode: rel.serial_code || null,
          });
          platCount++;
        }

        if (platCount > 0) {
          console.log(
            `  [${plat.display_name || plat.name}] Processed ${platCount} canonical releases`,
          );
        }
      }
    });

    syncTransaction();

    if (deltaCount > 0) {
      sqlStream.write(
        `INSERT INTO sync_state (key, value, updated_at) VALUES ('canonical_releases_dirty', '1', CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = CURRENT_TIMESTAMP;\n`,
      );
      db.prepare(
        `INSERT INTO sync_state (key, value, updated_at) VALUES ('canonical_releases_dirty', '1', CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = CURRENT_TIMESTAMP`,
      ).run();
    }

    await new Promise<void>((resolve, reject) => {
      sqlStream.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });

    console.log(
      `\n✅ Processed ${totalProcessed} canonical releases across platforms (${deltaCount} SQL delta statements written to ${sqlFilePath}).`,
    );

    const reconcileSqlPath = path.join(tempDir, 'reconcile_game_releases.sql');
    let reconciledCount = 0;

    if (!skipReconcile) {
      console.log(
        '\n=== Reconciling Game Releases against Canonical Releases ===',
      );
      const result = reconcileGameReleasesWithCanonical(db, {
        dryRun: false,
        platformId: targetPlatformId,
        sqlOutputPath: reconcileSqlPath,
      });
      reconciledCount = result.reconciledCount;
      console.log(
        `✅ Reconciled ${result.reconciledCount} unlinked game_releases rows across ${Object.keys(result.updatesByPlatform).length} platforms.`,
      );
    }

    if (pushRemote && deltaCount > 0) {
      console.log(
        `\n=== Pushing Canonical Releases Delta to Remote D1 (maxWrites=${maxWrites}) ===`,
      );
      runWithD1CostGuard({
        sqlFilePath,
        maxWrites,
        confirm: true,
        isDryRun: false,
      });
    }

    return {
      totalProcessed,
      deltaCount,
      reconciledCount,
      sqlFilePath,
      reconcileSqlPath,
    };
  } finally {
    if (ownDb) {
      db.close();
    }
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const args = process.argv.slice(2);
  const platformArg = args.find((a) => a.startsWith('--platform='));
  const targetPlatformId = platformArg
    ? parseInt(platformArg.split('=')[1], 10)
    : undefined;
  const skipReconcile = args.includes('--skip-reconcile');
  const fullSeed = args.includes('--full-seed');
  const pushRemote = args.includes('--push-remote');
  const maxWritesArg = args.find((a) => a.startsWith('--max-writes='));
  const maxWrites = maxWritesArg
    ? parseInt(maxWritesArg.split('=')[1], 10)
    : 50000;

  syncCanonicalSources({
    targetPlatformId,
    skipReconcile,
    fullSeed,
    pushRemote,
    maxWrites,
  }).catch((err) => {
    console.error('Fatal error syncing canonical sources:', err);
    process.exit(1);
  });
}
