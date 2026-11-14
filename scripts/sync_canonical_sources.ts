/**
 * CANONICAL SOURCES SYNCHRONIZATION UTILITY
 *
 * Scans canonical XML DAT files in `dats/` for tracked platforms and populates
 * the local `canonical_releases` database table using a diff-guarded comparison
 * against existing rows.
 *
 * Supports platform-specific surgical syncing via `--platform=<name|id>` to prevent
 * exhausting Cloudflare D1's daily free-tier write quota (100,000 writes/day).
 *
 * Compiles targeted, surgical SQL files (`scripts/temp/seed_canonical_releases.sql`
 * and `scripts/temp/reconcile_releases.sql`) for deployment to remote Cloudflare D1.
 *
 * USAGE:
 *   npx tsx scripts/sync_canonical_sources.ts [options]
 *
 * OPTIONS:
 *   --platform=<id|name>   Sync only the specified platform (e.g. --platform=vita or --platform=19)
 *   --dry-run              Calculate source counts, per-platform diffs, and D1 quota impact without modifying data
 *   --remote               Execute generated SQL against remote D1 via d1_cost_guard
 *   --help, -h             Show usage information
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { parseDatFile } from './lib/dat_parser.js';
import { findDatFileForPlatform, PlatformRecord } from './lib/dat_cache.js';
import { deduplicateDatReleases } from '../shared/canonical_releases.js';
import {
  reconcileGameReleasesWithCanonical,
  ReconcileResult,
} from './lib/reconcile_releases.js';
import { getLocalDatabase } from './lib/db.js';
import {
  getPublicBudgetInductionRecords,
  classifyCartridgeBudgetWithRecords,
} from './lib/budget_sources.js';
import { findRetailPackInDisc } from '../shared/special_labels.js';
import { extractDiscLabel } from '../shared/source_format.js';
import { normalizeTitleForMatching } from '../shared/title_matching.js';
import { runWithD1CostGuard } from './d1_cost_guard.js';

export interface SyncCanonicalOptions {
  db?: Database.Database;
  datsDir?: string;
  targetPlatformId?: number;
  targetPlatformFilter?: string;
  dryRun?: boolean;
  skipReconcile?: boolean;
  pushRemote?: boolean;
  maxWrites?: number;
}

export interface SyncCanonicalSummary {
  platformsProcessed: number;
  totalRawReleases: number;
  totalDeduplicatedReleases: number;
  insertedCount: number;
  updatedCount: number;
  deletedCount: number;
  reconcileResult: ReconcileResult | null;
  seedSqlPath: string;
}

function escapeSql(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  return `'${String(val).replace(/'/g, "''")}'`;
}

export async function syncCanonicalSources(
  options: SyncCanonicalOptions = {},
): Promise<SyncCanonicalSummary> {
  const ownDb = !options.db;
  const db = options.db || getLocalDatabase();
  const isDryRun = Boolean(options.dryRun);
  const tempDir = path.join(process.cwd(), 'scripts', 'temp');
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    const allPlatforms = db
      .prepare('SELECT id, name, display_name FROM platforms ORDER BY id ASC')
      .all() as PlatformRecord[];

    let targetPlatforms = allPlatforms;
    const filter =
      options.targetPlatformId !== undefined
        ? String(options.targetPlatformId)
        : options.targetPlatformFilter?.trim().toLowerCase() || null;

    if (filter) {
      const exactIdMatch = allPlatforms.filter((p) => String(p.id) === filter);
      if (exactIdMatch.length > 0) {
        targetPlatforms = exactIdMatch;
      } else {
        const exactNameMatch = allPlatforms.filter(
          (p) =>
            p.name.toLowerCase() === filter ||
            (p.display_name && p.display_name.toLowerCase() === filter),
        );
        if (exactNameMatch.length > 0) {
          targetPlatforms = exactNameMatch;
        } else {
          const subMatch = allPlatforms.filter(
            (p) =>
              p.name.toLowerCase().includes(filter) ||
              (p.display_name && p.display_name.toLowerCase().includes(filter)),
          );
          if (subMatch.length > 0) {
            targetPlatforms = subMatch;
          } else {
            throw new Error(`No platform found matching "${filter}".`);
          }
        }
      }
    }

    const isScoped = targetPlatforms.length < allPlatforms.length;
    const singlePlatform =
      targetPlatforms.length === 1 ? targetPlatforms[0] : null;

    console.log(
      isDryRun
        ? `🔍 [SyncDats] DRY RUN MODE: Analyzing ${isScoped ? `scoped platform (${targetPlatforms.map((p) => p.display_name || p.name).join(', ')})` : 'all platforms'} & Cloudflare Free Tier quota impact...`
        : `🚀 [SyncDats] Scanning ${isScoped ? `scoped platform (${targetPlatforms.map((p) => p.display_name || p.name).join(', ')})` : 'all platforms'} for canonical DAT files...`,
    );

    const budgetRecords = await getPublicBudgetInductionRecords();

    const datesMap = new Map<string, string>();
    try {
      const releaseDatesRows = db
        .prepare(
          `SELECT g.title, gr.region, gr.release_date
           FROM game_releases gr
           JOIN games g ON gr.game_id = g.stable_id
           WHERE gr.release_date IS NOT NULL AND gr.release_date != ''`,
        )
        .all() as Array<{
        title: string;
        region: string | null;
        release_date: string;
      }>;
      for (const row of releaseDatesRows) {
        const norm = normalizeTitleForMatching(row.title);
        const key = `${norm}::${(row.region || '').toLowerCase()}`;
        datesMap.set(key, row.release_date);
        datesMap.set(norm, row.release_date);
      }
    } catch {
      // Unpopulated DB
    }

    const existingStmt = db.prepare(`
      SELECT id, raw_title, normalized_title, region, variants, also_released_as,
             packin_host_normalized_title, redump_disc_id, rom_name, rom_crc,
             serial_code, barcode, publisher, source, is_verified_physical
      FROM canonical_releases
      WHERE platform_id = ? AND source = 'dat'
    `);

    const insertStmt = isDryRun
      ? null
      : db.prepare(`
      INSERT INTO canonical_releases (
        platform_id, raw_title, normalized_title, region, variants, also_released_as,
        packin_host_normalized_title, redump_disc_id, rom_name, rom_crc,
        serial_code, barcode, publisher, source, is_verified_physical
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'dat', ?)
    `);

    const updateStmt = isDryRun
      ? null
      : db.prepare(`
      UPDATE canonical_releases
      SET raw_title = ?, normalized_title = ?, region = ?, variants = ?,
          also_released_as = ?, packin_host_normalized_title = ?, redump_disc_id = ?,
          rom_name = ?, rom_crc = ?, serial_code = ?, barcode = ?,
          publisher = ?, is_verified_physical = ?
      WHERE id = ?
    `);

    const hasLinkedReleaseStmt = db.prepare(
      `SELECT 1 FROM game_releases WHERE canonical_release_id = ? LIMIT 1`,
    );
    const unlinkReleaseStmt = isDryRun
      ? null
      : db.prepare(
          `UPDATE game_releases SET canonical_release_id = NULL WHERE canonical_release_id = ?`,
        );
    const updateLinkedReleaseRomStmt = isDryRun
      ? null
      : db.prepare(
          `UPDATE game_releases SET rom_name = ?, rom_crc = ? WHERE canonical_release_id = ?`,
        );
    const deleteStmt = isDryRun
      ? null
      : db.prepare(`DELETE FROM canonical_releases WHERE id = ?`);

    let platformsProcessed = 0;
    let totalRawCount = 0;
    let totalDeduplicatedCount = 0;
    let insertedCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;
    const sqlStatements: string[] = [
      '-- Generated by scripts/sync_canonical_sources.ts',
      `-- Timestamp: ${new Date().toISOString()}`,
      '',
    ];

    const runSyncLoop = () => {
      for (const plat of targetPlatforms) {
        if (plat.id === 26 || plat.id === 27) {
          continue; // Switch 1 & 2 handled via Worker Nintendo Revised sync
        }

        const datInfo = findDatFileForPlatform(db, plat.id);
        if (!datInfo) continue;

        platformsProcessed++;
        const { filePath } = datInfo;
        const parsed = parseDatFile(filePath);
        const rawCount = parsed.releases.length;
        totalRawCount += rawCount;

        const deduplicated = deduplicateDatReleases(plat.id, parsed.releases);
        totalDeduplicatedCount += deduplicated.length;

        for (const rel of deduplicated) {
          if (!rel.packin_host_normalized_title) {
            const packIn = findRetailPackInDisc(rel.rom_name || rel.raw_title);
            if (packIn) {
              rel.packin_host_normalized_title = packIn.hostGameNormTitle;
            }
          }

          if (budgetRecords.length > 0) {
            const isUpdatedEdition =
              /welcome\s*amiibo|edition|plus|\+|deluxe|director'?s cut|game of the year|goty/i.test(
                rel.raw_title,
              );
            const dateKey = `${rel.normalized_title}::${(rel.region || '').toLowerCase()}`;
            const relDate =
              datesMap.get(dateKey) ||
              datesMap.get(rel.normalized_title) ||
              null;

            const classification = classifyCartridgeBudgetWithRecords(
              budgetRecords,
              {
                platformId: plat.id,
                gameTitle: rel.raw_title,
                region: rel.region,
                physicalReleaseDate: relDate,
                isUpdatedEdition,
              },
            );

            if (classification.isBudget) {
              if (classification.isBudgetOnly && classification.budgetLabel) {
                if (!rel.variants) {
                  rel.variants = classification.budgetLabel;
                } else if (
                  !rel.variants
                    .toLowerCase()
                    .includes(classification.budgetLabel.toLowerCase())
                ) {
                  rel.variants = `${rel.variants}, ${classification.budgetLabel}`;
                }
              } else if (
                !classification.isBudgetOnly &&
                classification.alsoReleasedAs
              ) {
                rel.also_released_as = classification.alsoReleasedAs;
              }
            }
          }
        }

        const existingRows = existingStmt.all(plat.id) as Array<{
          id: number;
          raw_title: string;
          normalized_title: string;
          region: string | null;
          variants: string | null;
          also_released_as: string | null;
          packin_host_normalized_title: string | null;
          redump_disc_id: number | null;
          rom_name: string | null;
          rom_crc: string | null;
          serial_code: string | null;
          barcode: string | null;
          publisher: string | null;
          source: string;
          is_verified_physical: number;
        }>;

        const existingByKey = new Map<string, typeof existingRows>();
        const existingByCrc = new Map<string, typeof existingRows>();
        const existingByGroup = new Map<string, typeof existingRows>();
        for (const row of existingRows) {
          const key = `${row.rom_name || ''}::${row.raw_title}::${row.region || ''}`;
          const list = existingByKey.get(key) || [];
          list.push(row);
          existingByKey.set(key, list);

          if (row.rom_crc) {
            const crcKey = row.rom_crc.toLowerCase();
            const crcList = existingByCrc.get(crcKey) || [];
            crcList.push(row);
            existingByCrc.set(crcKey, crcList);
          }

          const discLabel = extractDiscLabel(row.rom_name) || 'Single';
          const groupKey = `${row.normalized_title}::${row.region || 'World'}::${row.variants || 'Standard'}::${discLabel}`;
          const grpList = existingByGroup.get(groupKey) || [];
          grpList.push(row);
          existingByGroup.set(groupKey, grpList);
        }

        const seenExistingIds = new Set<number>();
        const matchedExistingByIndex = new Map<
          number,
          (typeof existingRows)[number]
        >();

        // Pass 1: Claim exact (rom_name, raw_title, region) matches first
        for (let idx = 0; idx < deduplicated.length; idx++) {
          const rel = deduplicated[idx];
          const key = `${rel.rom_name || ''}::${rel.raw_title}::${rel.region || ''}`;
          const candidates = (existingByKey.get(key) || []).filter(
            (r) => !seenExistingIds.has(r.id),
          );
          if (candidates.length > 0) {
            const romCrcVal = rel.rom_crc || null;
            const match =
              candidates.find((r) => r.rom_crc === romCrcVal) || candidates[0];
            matchedExistingByIndex.set(idx, match);
            seenExistingIds.add(match.id);
          }
        }

        // Pass 2: Fallback match by identical CRC or (normalized_title, region, variants, discLabel)
        for (let idx = 0; idx < deduplicated.length; idx++) {
          if (matchedExistingByIndex.has(idx)) continue;
          const rel = deduplicated[idx];
          const romCrcVal = rel.rom_crc ? rel.rom_crc.toLowerCase() : null;
          let fallbackMatch: (typeof existingRows)[number] | undefined;

          if (romCrcVal) {
            const crcCandidates = (existingByCrc.get(romCrcVal) || []).filter(
              (r) => !seenExistingIds.has(r.id),
            );
            fallbackMatch =
              crcCandidates.find(
                (r) => r.normalized_title === rel.normalized_title,
              ) || crcCandidates[0];
          }

          if (!fallbackMatch) {
            const discLabel = extractDiscLabel(rel.rom_name) || 'Single';
            const groupKey = `${rel.normalized_title}::${rel.region || 'World'}::${rel.variants || 'Standard'}::${discLabel}`;
            const grpCandidates = (existingByGroup.get(groupKey) || []).filter(
              (r) => !seenExistingIds.has(r.id),
            );
            fallbackMatch = grpCandidates[0];
          }

          if (fallbackMatch) {
            matchedExistingByIndex.set(idx, fallbackMatch);
            seenExistingIds.add(fallbackMatch.id);
          }
        }

        let platInserted = 0;
        let platUpdated = 0;
        let platDeleted = 0;

        for (let idx = 0; idx < deduplicated.length; idx++) {
          const rel = deduplicated[idx];
          const romCrcVal = rel.rom_crc || null;
          const existing = matchedExistingByIndex.get(idx);

          const regionVal = rel.region || null;
          const variantsVal = rel.variants || null;
          const alsoReleasedVal = rel.also_released_as || null;
          const packinVal = rel.packin_host_normalized_title || null;
          const redumpIdVal = rel.redump_disc_id || null;
          const romNameVal = rel.rom_name || null;
          const serialVal = rel.serial_code || null;
          const barcodeVal = rel.barcode || null;
          const publisherVal = rel.publisher || null;
          const verifiedVal = rel.is_verified_physical ?? 1;

          if (!existing) {
            if (insertStmt) {
              insertStmt.run(
                plat.id,
                rel.raw_title,
                rel.normalized_title,
                regionVal,
                variantsVal,
                alsoReleasedVal,
                packinVal,
                redumpIdVal,
                romNameVal,
                romCrcVal,
                serialVal,
                barcodeVal,
                publisherVal,
                verifiedVal,
              );
            }
            sqlStatements.push(
              `INSERT INTO canonical_releases (platform_id, raw_title, normalized_title, region, variants, also_released_as, packin_host_normalized_title, redump_disc_id, rom_name, rom_crc, serial_code, barcode, publisher, source, is_verified_physical) VALUES (${plat.id}, ${escapeSql(rel.raw_title)}, ${escapeSql(rel.normalized_title)}, ${escapeSql(regionVal)}, ${escapeSql(variantsVal)}, ${escapeSql(alsoReleasedVal)}, ${escapeSql(packinVal)}, ${escapeSql(redumpIdVal)}, ${escapeSql(romNameVal)}, ${escapeSql(romCrcVal)}, ${escapeSql(serialVal)}, ${escapeSql(barcodeVal)}, ${escapeSql(publisherVal)}, 'dat', ${verifiedVal});`,
            );
            insertedCount++;
            platInserted++;
          } else {
            const hasDiff =
              existing.raw_title !== rel.raw_title ||
              existing.normalized_title !== rel.normalized_title ||
              existing.region !== regionVal ||
              existing.variants !== variantsVal ||
              existing.also_released_as !== alsoReleasedVal ||
              existing.packin_host_normalized_title !== packinVal ||
              existing.redump_disc_id !== redumpIdVal ||
              existing.rom_name !== romNameVal ||
              existing.rom_crc !== romCrcVal ||
              existing.serial_code !== serialVal ||
              existing.barcode !== barcodeVal ||
              existing.publisher !== publisherVal ||
              existing.is_verified_physical !== verifiedVal;

            if (hasDiff) {
              if (updateStmt) {
                updateStmt.run(
                  rel.raw_title,
                  rel.normalized_title,
                  regionVal,
                  variantsVal,
                  alsoReleasedVal,
                  packinVal,
                  redumpIdVal,
                  romNameVal,
                  romCrcVal,
                  serialVal,
                  barcodeVal,
                  publisherVal,
                  verifiedVal,
                  existing.id,
                );
              }
              const whereClause = existing.rom_name
                ? `WHERE platform_id = ${plat.id} AND rom_name = ${escapeSql(existing.rom_name)}`
                : `WHERE id = ${existing.id}`;
              sqlStatements.push(
                `UPDATE canonical_releases SET raw_title = ${escapeSql(rel.raw_title)}, normalized_title = ${escapeSql(rel.normalized_title)}, region = ${escapeSql(regionVal)}, variants = ${escapeSql(variantsVal)}, also_released_as = ${escapeSql(alsoReleasedVal)}, packin_host_normalized_title = ${escapeSql(packinVal)}, redump_disc_id = ${escapeSql(redumpIdVal)}, rom_name = ${escapeSql(romNameVal)}, rom_crc = ${escapeSql(romCrcVal)}, serial_code = ${escapeSql(serialVal)}, barcode = ${escapeSql(barcodeVal)}, publisher = ${escapeSql(publisherVal)}, is_verified_physical = ${verifiedVal} ${whereClause};`,
              );
              if (
                (existing.rom_name !== romNameVal ||
                  existing.rom_crc !== romCrcVal) &&
                hasLinkedReleaseStmt.get(existing.id)
              ) {
                if (updateLinkedReleaseRomStmt) {
                  updateLinkedReleaseRomStmt.run(
                    romNameVal,
                    romCrcVal,
                    existing.id,
                  );
                }
                const linkedWhere = romNameVal
                  ? `WHERE canonical_release_id = (SELECT id FROM canonical_releases WHERE rom_name = ${escapeSql(romNameVal)} AND platform_id = ${plat.id} LIMIT 1)`
                  : `WHERE canonical_release_id = ${existing.id}`;
                sqlStatements.push(
                  `UPDATE game_releases SET rom_name = ${escapeSql(romNameVal)}, rom_crc = ${escapeSql(romCrcVal)} ${linkedWhere};`,
                );
              }
              updatedCount++;
              platUpdated++;
            }
          }
        }

        const rowsToDelete = existingRows.filter(
          (existing) => !seenExistingIds.has(existing.id),
        );
        const romsToDelete = rowsToDelete
          .map((r) => r.rom_name)
          .filter((r): r is string => Boolean(r));
        const idsWithoutRom = rowsToDelete
          .filter((r) => !r.rom_name)
          .map((r) => r.id);

        const UNLINK_CHUNK = 50;
        for (let i = 0; i < romsToDelete.length; i += UNLINK_CHUNK) {
          const chunk = romsToDelete.slice(i, i + UNLINK_CHUNK);
          sqlStatements.push(
            `UPDATE game_releases SET canonical_release_id = NULL WHERE canonical_release_id IN (SELECT id FROM canonical_releases WHERE platform_id = ${plat.id} AND rom_name IN (${chunk.map((r) => escapeSql(r)).join(', ')}));`,
          );
        }
        for (let i = 0; i < idsWithoutRom.length; i += UNLINK_CHUNK) {
          const chunk = idsWithoutRom.slice(i, i + UNLINK_CHUNK);
          sqlStatements.push(
            `UPDATE game_releases SET canonical_release_id = NULL WHERE canonical_release_id IN (${chunk.join(', ')});`,
          );
        }

        for (const existing of rowsToDelete) {
          if (hasLinkedReleaseStmt.get(existing.id) && unlinkReleaseStmt) {
            unlinkReleaseStmt.run(existing.id);
          }
          if (deleteStmt) {
            deleteStmt.run(existing.id);
          }
          if (existing.rom_name) {
            sqlStatements.push(
              `DELETE FROM canonical_releases WHERE platform_id = ${plat.id} AND rom_name = ${escapeSql(existing.rom_name)};`,
            );
          } else {
            sqlStatements.push(
              `DELETE FROM canonical_releases WHERE id = ${existing.id};`,
            );
          }
          deletedCount++;
          platDeleted++;
        }

        console.log(
          `  [${plat.display_name || plat.name}] ${rawCount} raw -> ${deduplicated.length} canonical (+${platInserted} new, ~${platUpdated} updated, -${platDeleted} removed)`,
        );
      }
    };

    if (!isDryRun) {
      db.pragma('foreign_keys = OFF');
      const syncTx = db.transaction(runSyncLoop);
      syncTx();
      db.pragma('foreign_keys = ON');

      db.prepare(
        `UPDATE game_releases
         SET also_released_as = COALESCE(also_released_as, (SELECT also_released_as FROM canonical_releases WHERE id = game_releases.canonical_release_id)),
             variants = COALESCE(game_releases.variants, (SELECT variants FROM canonical_releases WHERE id = game_releases.canonical_release_id))
         WHERE canonical_release_id IS NOT NULL
           AND (also_released_as IS NULL OR variants IS NULL)`,
      ).run();
    } else {
      runSyncLoop();
    }

    if (insertedCount + updatedCount + deletedCount > 0) {
      const dirtySql = `INSERT INTO sync_state (key, value, updated_at) VALUES ('canonical_releases_dirty', '1', CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = CURRENT_TIMESTAMP;`;
      sqlStatements.push(dirtySql);
      if (!isDryRun) {
        try {
          db.prepare(dirtySql).run();
        } catch {
          // Ignore if sync_state table does not exist in minimal test DB
        }
      }
    }

    const seedSqlPath = path.join(tempDir, 'seed_canonical_releases.sql');
    fs.writeFileSync(seedSqlPath, sqlStatements.join('\n') + '\n', 'utf8');

    let reconcileResult: ReconcileResult | null = null;
    if (!options.skipReconcile) {
      reconcileResult = reconcileGameReleasesWithCanonical(db, {
        dryRun: isDryRun,
        platformId: singlePlatform ? singlePlatform.id : undefined,
        sqlOutputPath: path.join(tempDir, 'reconcile_releases.sql'),
      });
    }

    const totalWriteOps =
      insertedCount +
      updatedCount +
      deletedCount +
      (reconcileResult?.reconciledCount || 0);
    const quotaPercentage = ((totalWriteOps / 100000) * 100).toFixed(2);

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
    console.log(`- Synced Platforms:                  ${platformsProcessed}`);
    console.log(
      `- Raw DAT Releases Scanned:          ${totalRawCount.toLocaleString()}`,
    );
    console.log(
      `- Canonical Physical Signatures:     ${totalDeduplicatedCount.toLocaleString()}`,
    );
    console.log(
      `- Diff vs Existing DB:               +${insertedCount} new, ~${updatedCount} updated, -${deletedCount} removed`,
    );
    console.log(
      `- Collection Releases Reconciled:    ${reconcileResult?.reconciledCount || 0} releases`,
    );
    console.log(
      `- Remote Write Operations:           ${totalWriteOps.toLocaleString()} statements (${quotaPercentage}% of 100k daily quota)`,
    );
    console.log(
      '===============================================================\n',
    );

    if (
      options.pushRemote &&
      !isDryRun &&
      insertedCount + updatedCount + deletedCount > 0
    ) {
      runWithD1CostGuard({
        sqlFilePath: seedSqlPath,
        maxWrites: options.maxWrites ?? 50000,
        confirm: true,
        isDryRun: false,
      });
    }

    return {
      platformsProcessed,
      totalRawReleases: totalRawCount,
      totalDeduplicatedReleases: totalDeduplicatedCount,
      insertedCount,
      updatedCount,
      deletedCount,
      reconcileResult,
      seedSqlPath,
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
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Canonical DAT Synchronization Utility

Usage:
  npx tsx scripts/sync_canonical_sources.ts [options]

Options:
  --platform=<id|name>  Sync only the specified platform (e.g. --platform=vita or --platform=19)
  --dry-run             Analyze DAT files and calculate D1 quota impact without modifying database
  --remote              Push generated SQL to remote D1 via d1_cost_guard
  --help, -h            Show this help message
`);
    process.exit(0);
  }

  const dryRun = args.includes('--dry-run');
  const pushRemote = args.includes('--remote');
  const skipReconcile = args.includes('--skip-reconcile');
  const platArg = args.find((a) => a.startsWith('--platform='))?.split('=')[1];

  syncCanonicalSources({
    targetPlatformFilter: platArg,
    dryRun,
    pushRemote,
    skipReconcile,
  }).catch((err) => {
    console.error('Fatal error syncing canonical sources:', err);
    process.exit(1);
  });
}
