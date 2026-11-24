/**
 * CANONICAL SOURCES SYNCHRONIZATION UTILITY
 *
 * Scans canonical XML DAT files in `dats/` and offline verification sources in
 * `data/sources/` (`neogeo`, `nscollectors`, `ps5db`, `serialstation`, `retail`,
 * `community` drop-in CSVs) to populate `canonical_releases` using diff-guarded
 * comparisons against existing rows, and links matching `game_releases`.
 *
 * USAGE:
 *   npx tsx scripts/sync_canonical_sources.ts [options]
 *
 * OPTIONS:
 *   --source=<list>        Comma-separated sources: dats,neogeo,nscollectors,ps5db,serialstation,retail,community,all (default: all)
 *   --sources-dir=<path>   Directory containing fetched source artifacts (default: data/sources)
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
import {
  CanonicalRelease,
  deduplicateDatReleases,
  getCanonicalSourcePriority,
  regionsOverlap,
} from '../shared/canonical_releases.js';
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
import { cleanRetailTitle } from '../shared/retail.js';
import {
  areCanonicalTitlesSequelCompatible,
  buildCanonicalLinkerMatchKeys,
  normalizeTitleForMatching,
  stripBoutiqueCatalogPrefix,
  stripLgnPlatformPipeTrailer,
} from '../shared/title_matching.js';
import { runWithD1CostGuard } from './d1_cost_guard.js';
import { loadNeoGeoReleases } from './lib/sources/neogeo.js';
import { loadNsCollectorsReleases } from './lib/sources/nscollectors_sync.js';
import { loadPs5DbReleases } from './lib/sources/ps5db.js';
import { loadSerialStationReleases } from './lib/sources/serialstation.js';
import { loadRetailBackCatalogReleases } from './lib/sources/retail_backcatalog.js';
import { loadCommunityCsvReleases } from './lib/sources/community_csv.js';

export type SyncSourceFilter =
  | 'dats'
  | 'neogeo'
  | 'nscollectors'
  | 'ps5db'
  | 'serialstation'
  | 'retail'
  | 'community'
  | 'all';

const VALID_SYNC_SOURCES = new Set<SyncSourceFilter>([
  'dats',
  'neogeo',
  'nscollectors',
  'ps5db',
  'serialstation',
  'retail',
  'community',
  'all',
]);

export function parseSyncSourceFilterArg(raw?: string): SyncSourceFilter[] {
  if (!raw || !raw.trim()) return ['all'];
  const tokens = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0 || tokens.includes('all')) return ['all'];
  const out: SyncSourceFilter[] = [];
  for (const t of tokens) {
    if (!VALID_SYNC_SOURCES.has(t as SyncSourceFilter)) {
      throw new Error(
        `Unknown sync source "${t}". Valid values: dats, neogeo, nscollectors, ps5db, serialstation, retail, community, all`,
      );
    }
    if (!out.includes(t as SyncSourceFilter)) {
      out.push(t as SyncSourceFilter);
    }
  }
  return out;
}

export interface SyncCanonicalOptions {
  db?: Database.Database;
  datsDir?: string;
  sourcesDir?: string;
  sources?: SyncSourceFilter[];
  targetPlatformId?: number;
  targetPlatformFilter?: string;
  dryRun?: boolean;
  skipReconcile?: boolean;
  pushRemote?: boolean;
  maxWrites?: number;
  sqlOutputPath?: string;
}

export interface SyncCanonicalSummary {
  platformsProcessed: number;
  totalRawReleases: number;
  totalDeduplicatedReleases: number;
  insertedCount: number;
  updatedCount: number;
  deletedCount: number;
  linkedNonDatReleases: number;
  reconcileResult: ReconcileResult | null;
  seedSqlPath: string;
}

function escapeSql(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  return `'${String(val).replace(/'/g, "''")}'`;
}

function sqlNullableEquals(
  col: string,
  val: string | null | undefined,
): string {
  return val === null || val === undefined
    ? `${col} IS NULL`
    : `${col} = ${escapeSql(val)}`;
}

export async function syncCanonicalSources(
  options: SyncCanonicalOptions = {},
): Promise<SyncCanonicalSummary> {
  const ownDb = !options.db;
  const db = options.db || getLocalDatabase();
  const isDryRun = Boolean(options.dryRun);
  const seedSqlPath =
    options.sqlOutputPath ||
    path.join(process.cwd(), 'scripts', 'temp', 'seed_canonical_releases.sql');
  const tempDir = path.dirname(seedSqlPath);
  fs.mkdirSync(tempDir, { recursive: true });
  const sourcesDir =
    options.sourcesDir || path.join(process.cwd(), 'data', 'sources');
  const selectedSources = new Set<SyncSourceFilter>(
    options.sources && options.sources.length > 0 ? options.sources : ['all'],
  );
  const runAllSources = selectedSources.has('all');

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

    const grCols = new Set(
      (db.pragma('table_info(game_releases)') as Array<{ name: string }>).map(
        (c) => c.name,
      ),
    );
    const hasDenormalizedCols = grCols.has('verified_source');
    const unlinkSetSql = hasDenormalizedCols
      ? 'canonical_release_id = NULL, verified_source = NULL, serial_code = NULL, canonical_title = NULL, publisher = NULL'
      : 'canonical_release_id = NULL';

    const hasLinkedReleaseStmt = db.prepare(
      `SELECT 1 FROM game_releases WHERE canonical_release_id = ? LIMIT 1`,
    );
    const unlinkReleaseStmt = isDryRun
      ? null
      : db.prepare(
          `UPDATE game_releases SET ${unlinkSetSql} WHERE canonical_release_id = ?`,
        );
    const updateLinkedReleaseRomStmt = isDryRun
      ? null
      : hasDenormalizedCols
        ? db.prepare(
            `UPDATE game_releases
             SET rom_name = ?, rom_crc = ?, verified_source = 'dat',
                 serial_code = ?, canonical_title = ?, publisher = ?
             WHERE canonical_release_id = ?`,
          )
        : db.prepare(
            `UPDATE game_releases SET rom_name = ?, rom_crc = ? WHERE canonical_release_id = ?`,
          );
    const deleteStmt = isDryRun
      ? null
      : db.prepare(`DELETE FROM canonical_releases WHERE id = ?`);

    let platformsProcessed = 0;
    const processedPlatformIds = new Set<number>();
    let totalRawCount = 0;
    let totalDeduplicatedCount = 0;
    let insertedCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;
    let linkedNonDatReleases = 0;
    const sqlStatements: string[] = [
      '-- Generated by scripts/sync_canonical_sources.ts',
      `-- Timestamp: ${new Date().toISOString()}`,
      '',
    ];

    const allowedPlatformIds = new Set(targetPlatforms.map((p) => p.id));

    const nonDatReleases: CanonicalRelease[] = [];
    if (runAllSources || selectedSources.has('neogeo')) {
      nonDatReleases.push(...loadNeoGeoReleases(sourcesDir));
    }
    if (runAllSources || selectedSources.has('nscollectors')) {
      nonDatReleases.push(...loadNsCollectorsReleases(sourcesDir).releases);
    }
    if (runAllSources || selectedSources.has('ps5db')) {
      nonDatReleases.push(...loadPs5DbReleases(sourcesDir));
    }
    if (runAllSources || selectedSources.has('serialstation')) {
      nonDatReleases.push(...loadSerialStationReleases(sourcesDir));
    }
    if (runAllSources || selectedSources.has('retail')) {
      nonDatReleases.push(...loadRetailBackCatalogReleases(sourcesDir));
    }
    if (runAllSources || selectedSources.has('community')) {
      nonDatReleases.push(
        ...loadCommunityCsvReleases(sourcesDir, allPlatforms),
      );
    }

    const filteredNonDatReleases = nonDatReleases.filter((r) =>
      allowedPlatformIds.has(r.platform_id),
    );

    const syncDatReleasesForPlatform = (
      plat: PlatformRecord,
      rawDatReleases: ReturnType<typeof parseDatFile>['releases'],
    ) => {
      processedPlatformIds.add(plat.id);
      platformsProcessed = processedPlatformIds.size;
      const rawCount = rawDatReleases.length;
      totalRawCount += rawCount;

      const deduplicated = deduplicateDatReleases(plat.id, rawDatReleases);
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
            datesMap.get(dateKey) || datesMap.get(rel.normalized_title) || null;

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
            const romChanged =
              existing.rom_name !== romNameVal ||
              existing.rom_crc !== romCrcVal;
            const denormChanged =
              hasDenormalizedCols &&
              (existing.raw_title !== rel.raw_title ||
                existing.serial_code !== serialVal ||
                existing.publisher !== publisherVal);
            if (
              (romChanged || denormChanged) &&
              hasLinkedReleaseStmt.get(existing.id)
            ) {
              if (updateLinkedReleaseRomStmt) {
                if (hasDenormalizedCols) {
                  updateLinkedReleaseRomStmt.run(
                    romNameVal,
                    romCrcVal,
                    serialVal,
                    rel.raw_title,
                    publisherVal,
                    existing.id,
                  );
                } else {
                  updateLinkedReleaseRomStmt.run(
                    romNameVal,
                    romCrcVal,
                    existing.id,
                  );
                }
              }
              const linkedWhere = romNameVal
                ? `WHERE canonical_release_id = (SELECT id FROM canonical_releases WHERE rom_name = ${escapeSql(romNameVal)} AND platform_id = ${plat.id} LIMIT 1)`
                : `WHERE canonical_release_id = ${existing.id}`;
              if (hasDenormalizedCols) {
                sqlStatements.push(
                  `UPDATE game_releases SET rom_name = ${escapeSql(romNameVal)}, rom_crc = ${escapeSql(romCrcVal)}, verified_source = 'dat', serial_code = ${escapeSql(serialVal)}, canonical_title = ${escapeSql(rel.raw_title)}, publisher = ${escapeSql(publisherVal)} ${linkedWhere};`,
                );
              } else {
                sqlStatements.push(
                  `UPDATE game_releases SET rom_name = ${escapeSql(romNameVal)}, rom_crc = ${escapeSql(romCrcVal)} ${linkedWhere};`,
                );
              }
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
          `UPDATE game_releases SET ${unlinkSetSql} WHERE canonical_release_id IN (SELECT id FROM canonical_releases WHERE platform_id = ${plat.id} AND rom_name IN (${chunk.map((r) => escapeSql(r)).join(', ')}));`,
        );
      }
      for (let i = 0; i < idsWithoutRom.length; i += UNLINK_CHUNK) {
        const chunk = idsWithoutRom.slice(i, i + UNLINK_CHUNK);
        sqlStatements.push(
          `UPDATE game_releases SET ${unlinkSetSql} WHERE canonical_release_id IN (${chunk.join(', ')});`,
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
    };

    const runSyncLoop = () => {
      if (runAllSources || selectedSources.has('dats')) {
        for (const plat of targetPlatforms) {
          if (plat.id === 26 || plat.id === 27) {
            continue; // Switch 1 & 2 handled via Nintendo Revised & r/NSCollectors
          }

          const datInfo = findDatFileForPlatform(db, plat.id);
          if (!datInfo) continue;

          const parsed = parseDatFile(datInfo.filePath);
          syncDatReleasesForPlatform(plat, parsed.releases);
        }
      }

      if (filteredNonDatReleases.length > 0) {
        const groupedNonDat = new Map<string, CanonicalRelease[]>();
        for (const rel of filteredNonDatReleases) {
          const groupKey = `${rel.platform_id}::${rel.source}`;
          const list = groupedNonDat.get(groupKey) || [];
          list.push(rel);
          groupedNonDat.set(groupKey, list);
        }

        // Process higher-authority sources first so lower-priority duplicates enrich rather than multiply
        const sortedGroups = Array.from(groupedNonDat.values()).sort((a, b) => {
          const prioDiff =
            getCanonicalSourcePriority(a[0].source) -
            getCanonicalSourcePriority(b[0].source);
          if (prioDiff !== 0) return prioDiff;
          return a[0].platform_id - b[0].platform_id;
        });

        type IndexedCanonicalRow = {
          id: number;
          platform_id: number;
          raw_title: string;
          normalized_title: string;
          region: string | null;
          variants: string | null;
          serial_code: string | null;
          barcode: string | null;
          publisher: string | null;
          source: string;
          is_verified_physical: number;
          rom_name: string | null;
        };

        const buildCanonicalNaturalWhere = (row: {
          platform_id: number;
          normalized_title: string;
          source: string;
          region: string | null;
          variants: string | null;
          serial_code?: string | null;
          rom_name?: string | null;
        }): string => {
          if (row.rom_name) {
            return `platform_id = ${row.platform_id} AND rom_name = ${escapeSql(row.rom_name)} AND source = ${escapeSql(row.source)}`;
          }
          return `platform_id = ${row.platform_id} AND normalized_title = ${escapeSql(row.normalized_title)} AND source = ${escapeSql(row.source)} AND ${sqlNullableEquals('region', row.region)} AND ${sqlNullableEquals('variants', row.variants)} AND ${sqlNullableEquals('serial_code', row.serial_code ?? null)}`;
        };

        const cleanLegacyRetailTitle = (raw: string): string =>
          cleanRetailTitle(
            stripBoutiqueCatalogPrefix(stripLgnPlatformPipeTrailer(raw), {
              stripPreOrderPrefix: true,
            }),
          );

        const selectAllVerifiedPlatStmt = db.prepare(`
          SELECT id, platform_id, raw_title, normalized_title, region, variants,
                 serial_code, barcode, publisher, source, is_verified_physical, rom_name
          FROM canonical_releases
          WHERE platform_id = ? AND is_verified_physical = 1
        `);

        const verifiedPoolByPlat = new Map<
          number,
          {
            rows: IndexedCanonicalRow[];
            byKey: Map<string, IndexedCanonicalRow[]>;
          }
        >();
        const deletedCanonicalIds = new Set<number>();

        const higherRegionCoversLower = (
          higherRegion: string | null | undefined,
          lowerRegion: string | null | undefined,
        ): boolean => {
          if (!regionsOverlap(higherRegion, lowerRegion)) return false;
          const lowerTrim = (lowerRegion || '').trim().toLowerCase();
          const higherTrim = (higherRegion || '').trim().toLowerCase();
          const lowerIsWorld = !lowerTrim || lowerTrim === 'world';
          const higherIsWorld = !higherTrim || higherTrim === 'world';
          if (lowerIsWorld && !higherIsWorld) {
            return false;
          }
          return true;
        };

        const indexRowIntoPlatPool = (
          byKey: Map<string, IndexedCanonicalRow[]>,
          row: IndexedCanonicalRow,
        ) => {
          const keys = new Set<string>([
            row.normalized_title,
            ...buildCanonicalLinkerMatchKeys(row.raw_title),
          ]);
          for (const k of keys) {
            if (!k) continue;
            const list = byKey.get(k) || [];
            if (!list.includes(row)) {
              list.push(row);
              byKey.set(k, list);
            }
          }
        };

        const getVerifiedPlatPool = (platId: number) => {
          let pool = verifiedPoolByPlat.get(platId);
          if (!pool) {
            const rows = selectAllVerifiedPlatStmt.all(
              platId,
            ) as IndexedCanonicalRow[];
            const byKey = new Map<string, IndexedCanonicalRow[]>();
            for (const r of rows) {
              indexRowIntoPlatPool(byKey, r);
            }
            pool = { rows, byKey };
            verifiedPoolByPlat.set(platId, pool);
          }
          return pool;
        };

        const findBestCrossSourceMatch = (
          platId: number,
          rel: CanonicalRelease,
          excludeSource: string,
        ): IndexedCanonicalRow | null => {
          const pool = getVerifiedPlatPool(platId);
          const candidateKeys = new Set<string>([
            rel.normalized_title,
            ...buildCanonicalLinkerMatchKeys(rel.raw_title),
          ]);
          const seen = new Set<IndexedCanonicalRow>();
          const matches: IndexedCanonicalRow[] = [];
          const relVar = rel.variants || null;

          for (const k of candidateKeys) {
            for (const cand of pool.byKey.get(k) || []) {
              if (seen.has(cand)) continue;
              seen.add(cand);
              if (deletedCanonicalIds.has(cand.id)) continue;
              if (cand.is_verified_physical !== 1) continue;
              if (cand.source === excludeSource) continue;
              if ((cand.variants || null) !== relVar) continue;
              if (
                !areCanonicalTitlesSequelCompatible(
                  cand.raw_title,
                  rel.raw_title,
                )
              ) {
                continue;
              }
              const candPrio = getCanonicalSourcePriority(cand.source);
              const relPrio = getCanonicalSourcePriority(excludeSource);
              if (candPrio <= relPrio) {
                if (!higherRegionCoversLower(cand.region, rel.region || null)) {
                  continue;
                }
              } else {
                if (!higherRegionCoversLower(rel.region || null, cand.region)) {
                  continue;
                }
              }
              matches.push(cand);
            }
          }

          if (matches.length === 0) return null;
          matches.sort((a, b) => {
            const prioDiff =
              getCanonicalSourcePriority(a.source) -
              getCanonicalSourcePriority(b.source);
            if (prioDiff !== 0) return prioDiff;
            const exactA = a.normalized_title === rel.normalized_title ? 0 : 1;
            const exactB = b.normalized_title === rel.normalized_title ? 0 : 1;
            if (exactA !== exactB) return exactA - exactB;
            return (a.id || 0) - (b.id || 0);
          });
          return matches[0];
        };

        const selectNonDatExistingStmt = db.prepare(`
          SELECT id, platform_id, raw_title, normalized_title, region, variants,
                 serial_code, barcode, publisher, source, is_verified_physical, rom_name
          FROM canonical_releases
          WHERE platform_id = ? AND source = ?
        `);
        const insertNonDatStmt = isDryRun
          ? null
          : db.prepare(`
              INSERT INTO canonical_releases (
                platform_id, raw_title, normalized_title, region, variants,
                serial_code, barcode, publisher, source, is_verified_physical
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
        const updateNonDatStmt = isDryRun
          ? null
          : db.prepare(`
              UPDATE canonical_releases
              SET raw_title = ?, normalized_title = ?, region = ?, variants = ?,
                  serial_code = ?, barcode = ?, publisher = ?, is_verified_physical = ?
              WHERE id = ?
            `);
        const enrichOtherStmt = isDryRun
          ? null
          : db.prepare(`
              UPDATE canonical_releases
              SET serial_code = COALESCE(serial_code, ?),
                  barcode = COALESCE(barcode, ?),
                  publisher = COALESCE(publisher, ?)
              WHERE id = ?
            `);
        const upgradeOtherStmt = isDryRun
          ? null
          : db.prepare(`
              UPDATE canonical_releases
              SET source = ?, raw_title = ?, normalized_title = ?, region = ?, variants = ?,
                  serial_code = ?, barcode = ?, publisher = ?, is_verified_physical = ?
              WHERE id = ?
            `);
        const repointReleaseStmt = isDryRun
          ? null
          : hasDenormalizedCols
            ? db.prepare(
                `UPDATE game_releases
                 SET canonical_release_id = ?, verified_source = ?, serial_code = ?, canonical_title = ?, publisher = ?
                 WHERE canonical_release_id = ?`,
              )
            : db.prepare(
                `UPDATE game_releases SET canonical_release_id = ? WHERE canonical_release_id = ?`,
              );
        const propagateLinkedDenormStmt =
          isDryRun || !hasDenormalizedCols
            ? null
            : db.prepare(
                `UPDATE game_releases
                 SET verified_source = ?, serial_code = ?, canonical_title = ?, publisher = ?
                 WHERE canonical_release_id = ?
                   AND (
                     verified_source IS NOT ?
                     OR serial_code IS NOT ?
                     OR canonical_title IS NOT ?
                     OR publisher IS NOT ?
                   )`,
              );
        const emitLinkedDenormPropagation = (target: IndexedCanonicalRow) => {
          if (!hasDenormalizedCols || target.id <= 0) return;
          if (!hasLinkedReleaseStmt.get(target.id)) return;
          if (propagateLinkedDenormStmt) {
            propagateLinkedDenormStmt.run(
              target.source,
              target.serial_code,
              target.raw_title,
              target.publisher,
              target.id,
              target.source,
              target.serial_code,
              target.raw_title,
              target.publisher,
            );
          }
          const updatedWhere = buildCanonicalNaturalWhere(target);
          sqlStatements.push(
            `UPDATE game_releases SET verified_source = ${escapeSql(target.source)}, serial_code = ${escapeSql(target.serial_code)}, canonical_title = ${escapeSql(target.raw_title)}, publisher = ${escapeSql(target.publisher)} WHERE canonical_release_id = (SELECT id FROM canonical_releases WHERE ${updatedWhere} ORDER BY id ASC LIMIT 1) AND (verified_source IS NOT ${escapeSql(target.source)} OR serial_code IS NOT ${escapeSql(target.serial_code)} OR canonical_title IS NOT ${escapeSql(target.raw_title)} OR publisher IS NOT ${escapeSql(target.publisher)});`,
          );
        };
        const syncedNonDatPlatforms = new Set<number>();
        const upgradedIds = new Set<number>();
        const enrichedKeyGuard = new Set<string>();
        let nextSyntheticDryId = -1;

        for (const groupReleases of sortedGroups) {
          if (groupReleases.length === 0) continue;
          const platId = groupReleases[0].platform_id;
          const sourceName = groupReleases[0].source;
          const sourcePriority = getCanonicalSourcePriority(sourceName);
          processedPlatformIds.add(platId);
          platformsProcessed = processedPlatformIds.size;
          if (groupReleases.some((r) => r.is_verified_physical === 1)) {
            syncedNonDatPlatforms.add(platId);
          }

          totalRawCount += groupReleases.length;
          totalDeduplicatedCount += groupReleases.length;

          const platPool = getVerifiedPlatPool(platId);
          const existingRows = (
            selectNonDatExistingStmt.all(
              platId,
              sourceName,
            ) as IndexedCanonicalRow[]
          ).filter((r) => !upgradedIds.has(r.id));

          const existingByExactKey = new Map<string, IndexedCanonicalRow>();
          const existingByLooseKey = new Map<string, IndexedCanonicalRow>();
          const existingByRecleanedKey = new Map<string, IndexedCanonicalRow>();
          const recleanedLooseKeyById = new Map<number, string>();
          const supportsTitleReclean =
            sourceName === 'retail_catalog' || sourceName === 'lgn';

          for (const ex of existingRows) {
            const exactKey = `${ex.normalized_title}::${ex.region || ''}::${ex.variants || ''}::${ex.serial_code || ''}`;
            if (!existingByExactKey.has(exactKey)) {
              existingByExactKey.set(exactKey, ex);
            }
            const looseKey = `${ex.normalized_title}::${ex.region || ''}::${ex.variants || ''}`;
            if (!existingByLooseKey.has(looseKey)) {
              existingByLooseKey.set(looseKey, ex);
            }
            if (supportsTitleReclean) {
              const cleanedNorm = normalizeTitleForMatching(
                cleanLegacyRetailTitle(ex.raw_title),
              );
              if (cleanedNorm) {
                const recleanKey = `${cleanedNorm}::${ex.region || ''}::${ex.variants || ''}`;
                recleanedLooseKeyById.set(ex.id, recleanKey);
                if (!existingByRecleanedKey.has(recleanKey)) {
                  existingByRecleanedKey.set(recleanKey, ex);
                }
              }
            }
          }

          const claimedIds = new Set<number>();
          const survivorByRecleanedKey = new Map<string, IndexedCanonicalRow>();
          const absorbedByHigherTier = new Map<number, IndexedCanonicalRow>();
          let srcInserted = 0;
          let srcUpdated = 0;
          let srcDeleted = 0;

          const enrichHigherAuthorityRow = (
            target: IndexedCanonicalRow,
            serialVal: string | null,
            barcodeVal: string | null,
            publisherVal: string | null,
          ) => {
            const addSerial =
              !target.serial_code && serialVal ? serialVal : null;
            const addBarcode =
              !target.barcode && barcodeVal ? barcodeVal : null;
            const addPublisher =
              !target.publisher && publisherVal ? publisherVal : null;
            if (!addSerial && !addBarcode && !addPublisher) return;

            const guardKey = `${target.id}::${addSerial || ''}::${addBarcode || ''}::${addPublisher || ''}`;
            if (enrichedKeyGuard.has(guardKey)) return;
            enrichedKeyGuard.add(guardKey);

            const targetWhere = buildCanonicalNaturalWhere(target);
            if (enrichOtherStmt && target.id > 0) {
              enrichOtherStmt.run(
                addSerial,
                addBarcode,
                addPublisher,
                target.id,
              );
            }
            sqlStatements.push(
              `UPDATE canonical_releases SET serial_code = COALESCE(serial_code, ${escapeSql(addSerial)}), barcode = COALESCE(barcode, ${escapeSql(addBarcode)}), publisher = COALESCE(publisher, ${escapeSql(addPublisher)}) WHERE id = (SELECT id FROM canonical_releases WHERE ${targetWhere} ORDER BY id ASC LIMIT 1);`,
            );
            if (addSerial) target.serial_code = addSerial;
            if (addBarcode) target.barcode = addBarcode;
            if (addPublisher) target.publisher = addPublisher;
            emitLinkedDenormPropagation(target);
            updatedCount++;
            srcUpdated++;
          };

          for (const rel of groupReleases) {
            const regionVal = rel.region || null;
            const variantsVal = rel.variants || null;
            const serialVal = rel.serial_code || null;
            const barcodeVal = rel.barcode || null;
            const publisherVal = rel.publisher || null;
            const verifiedVal = rel.is_verified_physical ?? 1;

            const exactKey = `${rel.normalized_title}::${regionVal || ''}::${variantsVal || ''}::${serialVal || ''}`;
            const looseKey = `${rel.normalized_title}::${regionVal || ''}::${variantsVal || ''}`;
            let existing = existingByExactKey.get(exactKey);
            if (existing && claimedIds.has(existing.id)) existing = undefined;
            if (!existing) {
              const candidate = existingByLooseKey.get(looseKey);
              if (candidate && !claimedIds.has(candidate.id)) {
                existing = candidate;
              }
            }
            if (!existing && supportsTitleReclean) {
              const recleanCandidate = existingByRecleanedKey.get(looseKey);
              if (recleanCandidate && !claimedIds.has(recleanCandidate.id)) {
                existing = recleanCandidate;
              }
            }

            const crossMatch =
              verifiedVal === 1
                ? findBestCrossSourceMatch(platId, rel, sourceName)
                : null;
            const crossPriority = crossMatch
              ? getCanonicalSourcePriority(crossMatch.source)
              : 999;

            if (existing) {
              // If an existing lower-authority row is already covered by a higher-authority source,
              // absorb complementary metadata into the higher-authority row and mark the duplicate for cleanup.
              if (crossMatch && crossPriority < sourcePriority) {
                enrichHigherAuthorityRow(
                  crossMatch,
                  serialVal,
                  barcodeVal,
                  publisherVal,
                );
                absorbedByHigherTier.set(existing.id, crossMatch);
                continue;
              }

              claimedIds.add(existing.id);
              const recleanKey = recleanedLooseKeyById.get(existing.id);
              if (recleanKey && !survivorByRecleanedKey.has(recleanKey)) {
                survivorByRecleanedKey.set(recleanKey, existing);
              }
              if (
                supportsTitleReclean &&
                !survivorByRecleanedKey.has(looseKey)
              ) {
                survivorByRecleanedKey.set(looseKey, existing);
              }

              const hasDiff =
                existing.raw_title !== rel.raw_title ||
                existing.normalized_title !== rel.normalized_title ||
                existing.region !== regionVal ||
                existing.variants !== variantsVal ||
                existing.serial_code !== serialVal ||
                existing.barcode !== barcodeVal ||
                existing.publisher !== publisherVal ||
                existing.is_verified_physical !== verifiedVal;

              if (hasDiff) {
                const preUpdateWhere = buildCanonicalNaturalWhere(existing);
                if (updateNonDatStmt) {
                  updateNonDatStmt.run(
                    rel.raw_title,
                    rel.normalized_title,
                    regionVal,
                    variantsVal,
                    serialVal,
                    barcodeVal,
                    publisherVal,
                    verifiedVal,
                    existing.id,
                  );
                }
                sqlStatements.push(
                  `UPDATE canonical_releases SET raw_title = ${escapeSql(rel.raw_title)}, normalized_title = ${escapeSql(rel.normalized_title)}, region = ${escapeSql(regionVal)}, variants = ${escapeSql(variantsVal)}, serial_code = ${escapeSql(serialVal)}, barcode = ${escapeSql(barcodeVal)}, publisher = ${escapeSql(publisherVal)}, is_verified_physical = ${verifiedVal} WHERE id = (SELECT id FROM canonical_releases WHERE ${preUpdateWhere} ORDER BY id ASC LIMIT 1);`,
                );
                const prevDenormDiff =
                  existing.raw_title !== rel.raw_title ||
                  existing.serial_code !== serialVal ||
                  existing.publisher !== publisherVal;
                existing.raw_title = rel.raw_title;
                existing.normalized_title = rel.normalized_title;
                existing.region = regionVal;
                existing.variants = variantsVal;
                existing.serial_code = serialVal;
                existing.barcode = barcodeVal;
                existing.publisher = publisherVal;
                existing.is_verified_physical = verifiedVal;
                if (prevDenormDiff) {
                  emitLinkedDenormPropagation(existing);
                }
                const poolMatch = platPool.rows.find(
                  (r) => r.id === existing!.id,
                );
                if (poolMatch) {
                  poolMatch.raw_title = rel.raw_title;
                  poolMatch.normalized_title = rel.normalized_title;
                  poolMatch.region = regionVal;
                  poolMatch.variants = variantsVal;
                  poolMatch.serial_code = serialVal;
                  poolMatch.barcode = barcodeVal;
                  poolMatch.publisher = publisherVal;
                  poolMatch.is_verified_physical = verifiedVal;
                  indexRowIntoPlatPool(platPool.byKey, poolMatch);
                }
                updatedCount++;
                srcUpdated++;
              }
            } else if (crossMatch) {
              if (crossPriority <= sourcePriority) {
                // Higher or equal authority source already covers this release: enrich NULL metadata only.
                enrichHigherAuthorityRow(
                  crossMatch,
                  serialVal,
                  barcodeVal,
                  publisherVal,
                );
              } else {
                // Incoming source has higher authority: upgrade existing row in place preserving ID & links.
                const preUpgradeWhere = buildCanonicalNaturalWhere(crossMatch);
                const mergedSerial = serialVal || crossMatch.serial_code;
                const mergedBarcode = barcodeVal || crossMatch.barcode;
                const mergedPublisher = publisherVal || crossMatch.publisher;
                const mergedRegion = regionVal || crossMatch.region;
                const mergedVariants = variantsVal || crossMatch.variants;

                if (upgradeOtherStmt && crossMatch.id > 0) {
                  upgradeOtherStmt.run(
                    sourceName,
                    rel.raw_title,
                    rel.normalized_title,
                    mergedRegion,
                    mergedVariants,
                    mergedSerial,
                    mergedBarcode,
                    mergedPublisher,
                    verifiedVal,
                    crossMatch.id,
                  );
                }
                sqlStatements.push(
                  `UPDATE canonical_releases SET source = ${escapeSql(sourceName)}, raw_title = ${escapeSql(rel.raw_title)}, normalized_title = ${escapeSql(rel.normalized_title)}, region = ${escapeSql(mergedRegion)}, variants = ${escapeSql(mergedVariants)}, serial_code = ${escapeSql(mergedSerial)}, barcode = ${escapeSql(mergedBarcode)}, publisher = ${escapeSql(mergedPublisher)}, is_verified_physical = ${verifiedVal} WHERE id = (SELECT id FROM canonical_releases WHERE ${preUpgradeWhere} ORDER BY id ASC LIMIT 1);`,
                );
                if (crossMatch.id > 0) {
                  upgradedIds.add(crossMatch.id);
                }
                crossMatch.source = sourceName;
                crossMatch.raw_title = rel.raw_title;
                crossMatch.normalized_title = rel.normalized_title;
                crossMatch.region = mergedRegion;
                crossMatch.variants = mergedVariants;
                crossMatch.serial_code = mergedSerial;
                crossMatch.barcode = mergedBarcode;
                crossMatch.publisher = mergedPublisher;
                crossMatch.is_verified_physical = verifiedVal;
                emitLinkedDenormPropagation(crossMatch);
                indexRowIntoPlatPool(platPool.byKey, crossMatch);
                updatedCount++;
                srcUpdated++;
              }
            } else {
              let insertedId = nextSyntheticDryId--;
              if (insertNonDatStmt) {
                const info = insertNonDatStmt.run(
                  platId,
                  rel.raw_title,
                  rel.normalized_title,
                  regionVal,
                  variantsVal,
                  serialVal,
                  barcodeVal,
                  publisherVal,
                  sourceName,
                  verifiedVal,
                );
                insertedId = Number(info.lastInsertRowid);
              }
              sqlStatements.push(
                `INSERT INTO canonical_releases (platform_id, raw_title, normalized_title, region, variants, serial_code, barcode, publisher, source, is_verified_physical) VALUES (${platId}, ${escapeSql(rel.raw_title)}, ${escapeSql(rel.normalized_title)}, ${escapeSql(regionVal)}, ${escapeSql(variantsVal)}, ${escapeSql(serialVal)}, ${escapeSql(barcodeVal)}, ${escapeSql(publisherVal)}, ${escapeSql(sourceName)}, ${verifiedVal});`,
              );
              const newRow: IndexedCanonicalRow = {
                id: insertedId,
                platform_id: platId,
                raw_title: rel.raw_title,
                normalized_title: rel.normalized_title,
                region: regionVal,
                variants: variantsVal,
                serial_code: serialVal,
                barcode: barcodeVal,
                publisher: publisherVal,
                source: sourceName,
                is_verified_physical: verifiedVal,
                rom_name: null,
              };
              if (verifiedVal === 1) {
                platPool.rows.push(newRow);
                indexRowIntoPlatPool(platPool.byKey, newRow);
              }
              if (
                supportsTitleReclean &&
                !survivorByRecleanedKey.has(looseKey)
              ) {
                survivorByRecleanedKey.set(looseKey, newRow);
              }
              insertedCount++;
              srcInserted++;
            }
          }

          const toDelete = existingRows.filter(
            (r) => !claimedIds.has(r.id) && !upgradedIds.has(r.id),
          );
          for (const obsolete of toDelete) {
            const obsoleteWhere = buildCanonicalNaturalWhere(obsolete);
            const recleanKey = recleanedLooseKeyById.get(obsolete.id);
            const repointTarget =
              absorbedByHigherTier.get(obsolete.id) ||
              (recleanKey ? survivorByRecleanedKey.get(recleanKey) : undefined);

            const hasLinks = Boolean(hasLinkedReleaseStmt.get(obsolete.id));
            if (repointTarget) {
              if (hasLinks && repointReleaseStmt && repointTarget.id > 0) {
                if (hasDenormalizedCols) {
                  repointReleaseStmt.run(
                    repointTarget.id,
                    repointTarget.source,
                    repointTarget.serial_code,
                    repointTarget.raw_title,
                    repointTarget.publisher,
                    obsolete.id,
                  );
                } else {
                  repointReleaseStmt.run(repointTarget.id, obsolete.id);
                }
              }
              const targetWhere = buildCanonicalNaturalWhere(repointTarget);
              if (hasDenormalizedCols) {
                sqlStatements.push(
                  `UPDATE game_releases SET canonical_release_id = (SELECT id FROM canonical_releases WHERE ${targetWhere} ORDER BY id ASC LIMIT 1), verified_source = ${escapeSql(repointTarget.source)}, serial_code = ${escapeSql(repointTarget.serial_code)}, canonical_title = ${escapeSql(repointTarget.raw_title)}, publisher = ${escapeSql(repointTarget.publisher)} WHERE canonical_release_id IN (SELECT id FROM canonical_releases WHERE ${obsoleteWhere});`,
                );
              } else {
                sqlStatements.push(
                  `UPDATE game_releases SET canonical_release_id = (SELECT id FROM canonical_releases WHERE ${targetWhere} ORDER BY id ASC LIMIT 1) WHERE canonical_release_id IN (SELECT id FROM canonical_releases WHERE ${obsoleteWhere});`,
                );
              }
            } else {
              if (hasLinks && unlinkReleaseStmt) {
                unlinkReleaseStmt.run(obsolete.id);
              }
              sqlStatements.push(
                `UPDATE game_releases SET ${unlinkSetSql} WHERE canonical_release_id IN (SELECT id FROM canonical_releases WHERE ${obsoleteWhere});`,
              );
            }

            if (deleteStmt) {
              deleteStmt.run(obsolete.id);
            }
            sqlStatements.push(
              `DELETE FROM canonical_releases WHERE ${obsoleteWhere};`,
            );
            deletedCanonicalIds.add(obsolete.id);
            const poolIdx = platPool.rows.findIndex(
              (r) => r.id === obsolete.id,
            );
            if (poolIdx >= 0) {
              platPool.rows.splice(poolIdx, 1);
            }
            deletedCount++;
            srcDeleted++;
          }

          console.log(
            `  [source=${sourceName} p=${platId}] ${groupReleases.length} releases (+${srcInserted} new, ~${srcUpdated} updated, -${srcDeleted} removed)`,
          );
        }

        // Link existing unlinked game_releases on newly synced verified non-DAT platforms
        if (syncedNonDatPlatforms.size > 0) {
          type LinkCandidateRow = {
            id: number;
            platform_id: number;
            raw_title: string;
            normalized_title: string;
            region: string | null;
            variants: string | null;
            serial_code: string | null;
            barcode: string | null;
            publisher: string | null;
            source: string;
          };
          const verifiedByPlatKey = new Map<string, LinkCandidateRow[]>();
          const ph = Array.from(syncedNonDatPlatforms)
            .map(() => '?')
            .join(',');
          const verifiedRows = db
            .prepare(
              `SELECT id, platform_id, raw_title, normalized_title, region, variants, serial_code, barcode, publisher, source
               FROM canonical_releases
               WHERE platform_id IN (${ph})
                 AND is_verified_physical = 1
                 AND COALESCE(source, '') != 'dat'`,
            )
            .all(...Array.from(syncedNonDatPlatforms)) as LinkCandidateRow[];

          const indexCandidateForLink = (vr: LinkCandidateRow) => {
            const keys = new Set<string>([
              vr.normalized_title,
              ...buildCanonicalLinkerMatchKeys(vr.raw_title),
            ]);
            for (const key of keys) {
              if (!key) continue;
              const k = `${vr.platform_id}::${key}`;
              const arr = verifiedByPlatKey.get(k) || [];
              if (!arr.includes(vr)) {
                arr.push(vr);
                verifiedByPlatKey.set(k, arr);
              }
            }
          };

          const seenCandidateKeys = new Set<string>();
          for (const vr of verifiedRows) {
            indexCandidateForLink(vr);
            seenCandidateKeys.add(
              `${vr.platform_id}::${vr.source}::${vr.normalized_title}::${vr.region || ''}::${vr.variants || ''}`,
            );
          }
          if (isDryRun) {
            for (const platId of syncedNonDatPlatforms) {
              for (const row of getVerifiedPlatPool(platId).rows) {
                if (
                  row.is_verified_physical !== 1 ||
                  row.source === 'dat' ||
                  deletedCanonicalIds.has(row.id)
                ) {
                  continue;
                }
                const candKey = `${row.platform_id}::${row.source}::${row.normalized_title}::${row.region || ''}::${row.variants || ''}`;
                if (seenCandidateKeys.has(candKey)) continue;
                seenCandidateKeys.add(candKey);
                indexCandidateForLink({
                  id: row.id,
                  platform_id: row.platform_id,
                  raw_title: row.raw_title,
                  normalized_title: row.normalized_title,
                  region: row.region,
                  variants: row.variants,
                  serial_code: row.serial_code,
                  barcode: row.barcode,
                  publisher: row.publisher,
                  source: row.source,
                });
              }
            }
          }

          const unlinkedReleases = db
            .prepare(
              `SELECT gr.id, gr.region, gr.variants, gr.barcode, g.title, g.platform_id
               FROM game_releases gr
               JOIN games g ON g.stable_id = gr.game_id
               WHERE gr.canonical_release_id IS NULL
                 AND g.platform_id IN (${ph})`,
            )
            .all(...Array.from(syncedNonDatPlatforms)) as Array<{
            id: string;
            region: string | null;
            variants: string | null;
            barcode: string | null;
            title: string;
            platform_id: number;
          }>;

          const linkStmt = isDryRun
            ? null
            : hasDenormalizedCols
              ? db.prepare(
                  `UPDATE game_releases
                   SET canonical_release_id = ?,
                       variants = COALESCE(variants, ?),
                       barcode = COALESCE(barcode, ?),
                       verified_source = ?,
                       serial_code = ?,
                       canonical_title = ?,
                       publisher = ?
                   WHERE id = ? AND canonical_release_id IS NULL`,
                )
              : db.prepare(
                  `UPDATE game_releases
                   SET canonical_release_id = ?,
                       variants = COALESCE(variants, ?),
                       barcode = COALESCE(barcode, ?)
                   WHERE id = ? AND canonical_release_id IS NULL`,
                );

          for (const gr of unlinkedReleases) {
            const lookupKeys = buildCanonicalLinkerMatchKeys(gr.title);
            const seenCand = new Set<LinkCandidateRow>();
            const candidates: LinkCandidateRow[] = [];
            for (const lk of lookupKeys) {
              for (const cand of verifiedByPlatKey.get(
                `${gr.platform_id}::${lk}`,
              ) || []) {
                if (seenCand.has(cand)) continue;
                seenCand.add(cand);
                if (
                  !areCanonicalTitlesSequelCompatible(gr.title, cand.raw_title)
                ) {
                  continue;
                }
                if (
                  gr.variants &&
                  cand.variants &&
                  gr.variants.toLowerCase() !== cand.variants.toLowerCase()
                ) {
                  continue;
                }
                if (gr.region && !regionsOverlap(gr.region, cand.region)) {
                  continue;
                }
                candidates.push(cand);
              }
            }
            if (candidates.length === 0) continue;

            const exactTitleNorm = normalizeTitleForMatching(gr.title);
            const targetRegionLower = (gr.region || '').trim().toLowerCase();
            candidates.sort((a, b) => {
              const prioDiff =
                getCanonicalSourcePriority(a.source) -
                getCanonicalSourcePriority(b.source);
              if (prioDiff !== 0) return prioDiff;
              const normA = a.normalized_title === exactTitleNorm ? 0 : 1;
              const normB = b.normalized_title === exactTitleNorm ? 0 : 1;
              if (normA !== normB) return normA - normB;
              if (targetRegionLower) {
                const regExactA =
                  (a.region || '').trim().toLowerCase() === targetRegionLower
                    ? 0
                    : 1;
                const regExactB =
                  (b.region || '').trim().toLowerCase() === targetRegionLower
                    ? 0
                    : 1;
                if (regExactA !== regExactB) return regExactA - regExactB;
              }
              const serialDiff =
                (b.serial_code ? 1 : 0) - (a.serial_code ? 1 : 0);
              if (serialDiff !== 0) return serialDiff;
              return (b.barcode ? 1 : 0) - (a.barcode ? 1 : 0);
            });

            const best = candidates[0];
            if (linkStmt) {
              if (hasDenormalizedCols) {
                linkStmt.run(
                  best.id,
                  best.variants,
                  best.barcode,
                  best.source,
                  best.serial_code,
                  best.raw_title,
                  best.publisher,
                  gr.id,
                );
              } else {
                linkStmt.run(best.id, best.variants, best.barcode, gr.id);
              }
            }
            if (hasDenormalizedCols) {
              sqlStatements.push(
                `UPDATE game_releases SET canonical_release_id = (SELECT id FROM canonical_releases WHERE platform_id = ${gr.platform_id} AND source = ${escapeSql(best.source)} AND normalized_title = ${escapeSql(best.normalized_title)} AND ${sqlNullableEquals('region', best.region)} AND ${sqlNullableEquals('variants', best.variants)} ORDER BY id ASC LIMIT 1), variants = COALESCE(variants, ${escapeSql(best.variants)}), barcode = COALESCE(barcode, ${escapeSql(best.barcode)}), verified_source = ${escapeSql(best.source)}, serial_code = ${escapeSql(best.serial_code)}, canonical_title = ${escapeSql(best.raw_title)}, publisher = ${escapeSql(best.publisher)} WHERE id = ${escapeSql(gr.id)} AND canonical_release_id IS NULL;`,
              );
            } else {
              sqlStatements.push(
                `UPDATE game_releases SET canonical_release_id = (SELECT id FROM canonical_releases WHERE platform_id = ${gr.platform_id} AND source = ${escapeSql(best.source)} AND normalized_title = ${escapeSql(best.normalized_title)} AND ${sqlNullableEquals('region', best.region)} AND ${sqlNullableEquals('variants', best.variants)} ORDER BY id ASC LIMIT 1), variants = COALESCE(variants, ${escapeSql(best.variants)}), barcode = COALESCE(barcode, ${escapeSql(best.barcode)}) WHERE id = ${escapeSql(gr.id)} AND canonical_release_id IS NULL;`,
              );
            }
            linkedNonDatReleases++;
          }
        }
      }
    };

    if (!isDryRun) {
      db.pragma('foreign_keys = OFF');
      const syncTx = db.transaction(runSyncLoop);
      syncTx();
      db.pragma('foreign_keys = ON');

      if (hasDenormalizedCols) {
        db.prepare(
          `UPDATE game_releases
           SET also_released_as = COALESCE(also_released_as, (SELECT also_released_as FROM canonical_releases WHERE id = game_releases.canonical_release_id)),
               variants = COALESCE(game_releases.variants, (SELECT variants FROM canonical_releases WHERE id = game_releases.canonical_release_id)),
               verified_source = (SELECT source FROM canonical_releases WHERE id = game_releases.canonical_release_id),
               serial_code = (SELECT serial_code FROM canonical_releases WHERE id = game_releases.canonical_release_id),
               canonical_title = (SELECT raw_title FROM canonical_releases WHERE id = game_releases.canonical_release_id),
               publisher = (SELECT publisher FROM canonical_releases WHERE id = game_releases.canonical_release_id)
           WHERE canonical_release_id IS NOT NULL`,
        ).run();
      } else {
        db.prepare(
          `UPDATE game_releases
           SET also_released_as = COALESCE(also_released_as, (SELECT also_released_as FROM canonical_releases WHERE id = game_releases.canonical_release_id)),
               variants = COALESCE(game_releases.variants, (SELECT variants FROM canonical_releases WHERE id = game_releases.canonical_release_id))
           WHERE canonical_release_id IS NOT NULL
             AND (also_released_as IS NULL OR variants IS NULL)`,
        ).run();
      }
    } else {
      runSyncLoop();
    }

    if (
      insertedCount + updatedCount + deletedCount + linkedNonDatReleases >
      0
    ) {
      const canonicalDirtySql = `INSERT INTO sync_state (key, value, updated_at) VALUES ('canonical_releases_dirty', '1', CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = CURRENT_TIMESTAMP;`;
      const catalogDirtySql = `INSERT INTO sync_state (key, value, updated_at) VALUES ('catalog_chunks_dirty', '1', CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = CURRENT_TIMESTAMP;`;
      if (insertedCount + updatedCount + deletedCount > 0) {
        sqlStatements.push(canonicalDirtySql);
        if (!isDryRun) {
          try {
            db.prepare(canonicalDirtySql).run();
          } catch {
            // Ignore if sync_state table does not exist in minimal test DB
          }
        }
      }
      sqlStatements.push(catalogDirtySql);
      if (!isDryRun) {
        try {
          db.prepare(catalogDirtySql).run();
        } catch {
          // Ignore if sync_state table does not exist in minimal test DB
        }
      }
    }

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
      linkedNonDatReleases +
      (reconcileResult?.reconciledCount || 0);
    const quotaPercentage = ((totalWriteOps / 100000) * 100).toFixed(2);

    console.log(
      '\n===============================================================',
    );
    console.log(
      isDryRun
        ? '📊 CLOUDFLARE D1 QUOTA IMPACT (DRY RUN)'
        : '✅ CANONICAL RELEASES SYNCHRONIZATION SUMMARY',
    );
    console.log(
      '===============================================================',
    );
    console.log(`- Synced Platforms:                  ${platformsProcessed}`);
    console.log(
      `- Raw Releases Scanned:              ${totalRawCount.toLocaleString()}`,
    );
    console.log(
      `- Canonical Physical Signatures:     ${totalDeduplicatedCount.toLocaleString()}`,
    );
    console.log(
      `- Diff vs Existing DB:               +${insertedCount} new, ~${updatedCount} updated, -${deletedCount} removed`,
    );
    console.log(
      `- Linked Non-DAT Game Releases:      ${linkedNonDatReleases} releases`,
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
      insertedCount + updatedCount + deletedCount + linkedNonDatReleases > 0
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
      linkedNonDatReleases,
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
Canonical Sources Synchronization Utility

Usage:
  npx tsx scripts/sync_canonical_sources.ts [options]

Options:
  --source=<list>       Comma-separated sources: dats,neogeo,nscollectors,ps5db,serialstation,retail,community,all (default: all)
  --sources-dir=<path>  Directory containing fetched non-DAT artifacts (default: data/sources)
  --platform=<id|name>  Sync only the specified platform (e.g. --platform=vita or --platform=19)
  --dry-run             Analyze source files and calculate D1 quota impact without modifying database
  --remote              Push generated SQL to remote D1 via d1_cost_guard
  --help, -h            Show this help message
`);
    process.exit(0);
  }

  const dryRun = args.includes('--dry-run');
  const pushRemote = args.includes('--remote');
  const skipReconcile = args.includes('--skip-reconcile');
  const platArg = args.find((a) => a.startsWith('--platform='))?.split('=')[1];
  const sourceArg = args.find((a) => a.startsWith('--source='))?.split('=')[1];
  const sourcesDirArg = args
    .find((a) => a.startsWith('--sources-dir='))
    ?.split('=')[1];

  syncCanonicalSources({
    sources: parseSyncSourceFilterArg(sourceArg),
    sourcesDir: sourcesDirArg ? path.resolve(sourcesDirArg) : undefined,
    targetPlatformFilter: platArg,
    dryRun,
    pushRemote,
    skipReconcile,
  }).catch((err) => {
    console.error('Fatal error syncing canonical sources:', err);
    process.exit(1);
  });
}
