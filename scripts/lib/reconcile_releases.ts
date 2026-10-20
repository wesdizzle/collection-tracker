/**
 * GAME RELEASES CANONICAL RECONCILIATION ENGINE
 *
 * Automatically links unlinked or missing collection releases (`game_releases`)
 * to their matching canonical DAT release signatures (`canonical_releases`),
 * populating `canonical_release_id`, `rom_name`, and `rom_crc`.
 *
 * Generates surgical, write-minimized SQL for remote Cloudflare D1 deployment.
 */

import type Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getDatabase } from './db.js';
import { normalizeTitleForMatching, titlesMatch } from './title_matching.js';
import { cleanTitleWithoutParentheticals } from './canonical_releases.js';
import { getRomGroupingKey } from './queries.js';
import { BOX_SET_ROM_GROUPING_MAP } from './special_labels.js';

export interface ReconcileOptions {
  dryRun?: boolean;
  platformId?: number;
  sqlOutputPath?: string;
  insertMissingVariants?: boolean;
}

export interface ReconcileResult {
  totalEvaluated: number;
  reconciledCount: number;
  updatesByPlatform: Record<number, number>;
  sqlPath: string;
  updates: Array<{
    releaseId: string;
    gameId: number;
    gameTitle: string;
    platformId: number;
    canonicalId: number;
    romName: string;
    romCrc: string | null;
  }>;
}

/**
 * Strips common edition suffixes, subtitles, and DLC add-on phrases from titles
 * so base releases can match their canonical cartridge dumps.
 */
export function stripEditionSuffix(title: string): string {
  return title
    .replace(
      /:\s*(crewmate|definitive|deluxe|special|collector'?s?|anniversary|remastered|legacy|hd|plus|\d+th anniversary)\s*edition/gi,
      '',
    )
    .replace(
      /\s*-\s*(crewmate|definitive|deluxe|special|collector'?s?|anniversary|remastered|legacy|hd|plus)\s*edition/gi,
      '',
    )
    .replace(
      /\s+(definitive|deluxe|special|collector'?s?|anniversary|remastered|legacy)\s+edition/gi,
      '',
    )
    .replace(/:\s*deluxe$/i, '')
    .replace(/\s*\+\s*the hidden treasure of area zero/gi, '')
    .replace(/\s*\+\s*booster course pass/gi, '')
    .trim();
}

/**
 * Selects the best candidate canonical release based on strict regional compatibility.
 * Returns null when no candidate is regionally compatible with targetRegion (preventing
 * cross-region fallback mismatches like assigning Japan or Germany ROMs to USA rows).
 */
export function selectBestRegionalCandidate<
  T extends { region: string | null },
>(candidates: T[], targetRegion: string | null): T | null {
  if (candidates.length === 0) {
    return null;
  }
  if (!targetRegion || !targetRegion.trim()) {
    return candidates[0];
  }

  const regLower = targetRegion.toLowerCase().trim();
  const targetTokens = regLower
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // 1. Exact match (case-insensitive)
  const exact = candidates.find(
    (c) => c.region && c.region.toLowerCase().trim() === regLower,
  );
  if (exact) return exact;

  // 2. Direct token overlap (e.g. target "USA" matches candidate "USA, Europe" or "USA, Canada")
  const tokenMatch = candidates.find((c) => {
    if (!c.region) return false;
    const candTokens = c.region
      .toLowerCase()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return candTokens.some((t) => targetTokens.includes(t));
  });
  if (tokenMatch) return tokenMatch;

  // 3. World fallback (if candidate is World or target is World)
  if (targetTokens.includes('world')) {
    return candidates[0];
  }
  const anyWorld = candidates.find((c) => {
    if (!c.region) return false;
    const candTokens = c.region
      .toLowerCase()
      .split(',')
      .map((s) => s.trim());
    return candTokens.includes('world');
  });
  if (anyWorld) return anyWorld;

  // 4. North America -> USA / Canada compatibility
  if (targetTokens.includes('north america') || targetTokens.includes('usa')) {
    const naMatch = candidates.find((c) => {
      if (!c.region) return false;
      const candLower = c.region.toLowerCase();
      return candLower.includes('usa') || candLower.includes('north america');
    });
    if (naMatch) return naMatch;
  }

  return null;
}

/**
 * Reconciles unlinked game_releases with canonical DAT releases.
 */
export function reconcileGameReleasesWithCanonical(
  db: Database.Database,
  options: ReconcileOptions = {},
): ReconcileResult {
  const isDryRun = options.dryRun ?? false;
  const tempDir = path.resolve(process.cwd(), 'scripts', 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  const defaultSqlPath = path.join(tempDir, 'reconcile_game_releases.sql');
  const sqlPath = options.sqlOutputPath ?? defaultSqlPath;

  // Query releases that need ROM names
  const candidateQuery = `
    SELECT gr.id, gr.game_id, g.id as game_slug, g.platform_id, g.title, gr.region, gr.variants,
           gr.rom_name, gr.rom_crc, gr.canonical_release_id, gr.ownership_status
    FROM game_releases gr
    JOIN games g ON gr.game_id = g.stable_id
    WHERE gr.rom_name IS NULL
    ${options.platformId ? 'AND g.platform_id = ' + Number(options.platformId) : ''}
    ORDER BY g.platform_id ASC, g.title ASC, gr.id ASC
  `;

  const candidateReleases = db.prepare(candidateQuery).all() as Array<{
    id: string;
    game_id: number;
    game_slug: string;
    platform_id: number;
    title: string;
    region: string | null;
    variants: string | null;
    rom_name: string | null;
    rom_crc: string | null;
    canonical_release_id: number | null;
    ownership_status: number;
  }>;

  // Track already-assigned ROM names and CRCs per game_id and per platform_id to prevent duplicate overwrites
  const usedRomsByGameId = new Map<number, Set<string>>();
  const usedRomsByPlatformId = new Map<number, Set<string>>();
  const usedCrcsByGameId = new Map<number, Set<string>>();
  const usedCrcsByPlatformId = new Map<number, Set<string>>();
  const existingRoms = db
    .prepare(
      `SELECT gr.game_id, g.platform_id, gr.rom_name, gr.rom_crc
       FROM game_releases gr
       JOIN games g ON gr.game_id = g.stable_id
       WHERE gr.rom_name IS NOT NULL`,
    )
    .all() as Array<{
    game_id: number;
    platform_id: number;
    rom_name: string;
    rom_crc: string | null;
  }>;
  for (const row of existingRoms) {
    let set = usedRomsByGameId.get(row.game_id);
    if (!set) {
      set = new Set();
      usedRomsByGameId.set(row.game_id, set);
    }
    set.add(row.rom_name);

    let pSet = usedRomsByPlatformId.get(row.platform_id);
    if (!pSet) {
      pSet = new Set();
      usedRomsByPlatformId.set(row.platform_id, pSet);
    }
    pSet.add(row.rom_name);

    if (row.rom_crc) {
      const crcNorm = row.rom_crc.toLowerCase();
      let cSet = usedCrcsByGameId.get(row.game_id);
      if (!cSet) {
        cSet = new Set();
        usedCrcsByGameId.set(row.game_id, cSet);
      }
      cSet.add(crcNorm);

      let pCrcSet = usedCrcsByPlatformId.get(row.platform_id);
      if (!pCrcSet) {
        pCrcSet = new Set();
        usedCrcsByPlatformId.set(row.platform_id, pCrcSet);
      }
      pCrcSet.add(crcNorm);
    }
  }

  // Map parent platform relationships (e.g. PSVR 51 -> PS4 34, PSVR2 52 -> PS5 35)
  const parentPlatformMap = new Map<number, number>();
  try {
    const platformRows = db
      .prepare(
        'SELECT id, parent_platform_id FROM platforms WHERE parent_platform_id IS NOT NULL',
      )
      .all() as Array<{ id: number; parent_platform_id: number }>;
    for (const p of platformRows) {
      parentPlatformMap.set(p.id, p.parent_platform_id);
    }
  } catch {
    // Platforms table lacks parent_platform_id column in simplified test mocks
  }

  let datPlatformFilter = '';
  if (options.platformId) {
    const pId = Number(options.platformId);
    const parentId = parentPlatformMap.get(pId);
    if (parentId) {
      datPlatformFilter = `AND platform_id IN (${pId}, ${parentId})`;
    } else {
      datPlatformFilter = `AND platform_id = ${pId}`;
    }
  }

  // Query all canonical DAT releases
  const datQuery = `
    SELECT id, platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc
    FROM canonical_releases
    WHERE source = 'dat' AND rom_name IS NOT NULL
    ${datPlatformFilter}
  `;

  const allDatReleases = db.prepare(datQuery).all() as Array<{
    id: number;
    platform_id: number;
    raw_title: string;
    normalized_title: string;
    region: string | null;
    variants: string | null;
    rom_name: string;
    rom_crc: string | null;
  }>;

  // Group DAT releases by platform_id -> normalized_title -> list
  const datByPlatformNorm = new Map<
    number,
    Map<string, typeof allDatReleases>
  >();
  for (const r of allDatReleases) {
    if (!datByPlatformNorm.has(r.platform_id)) {
      datByPlatformNorm.set(r.platform_id, new Map());
    }
    const normMap = datByPlatformNorm.get(r.platform_id)!;
    if (!normMap.has(r.normalized_title)) {
      normMap.set(r.normalized_title, []);
    }
    normMap.get(r.normalized_title)!.push(r);
  }

  const updates: ReconcileResult['updates'] = [];
  const updatesByPlatform: Record<number, number> = {};
  const sqlStatements: string[] = [
    '-- Automatic Game Releases Reconciliation for Cloudflare D1',
    `-- Generated on: ${new Date().toISOString()}`,
    'PRAGMA foreign_keys = OFF;',
    '',
  ];

  for (const rel of candidateReleases) {
    const normMap = datByPlatformNorm.get(rel.platform_id);
    const parentId = parentPlatformMap.get(rel.platform_id);
    const parentNormMap = parentId
      ? datByPlatformNorm.get(parentId)
      : undefined;

    // Helper to search a specific norm map
    const searchMap = (map?: Map<string, typeof allDatReleases>) => {
      if (!map) return undefined;
      // Strategy 1: Exact normalized title match
      const norm = normalizeTitleForMatching(rel.title);
      let cand = map.get(norm);

      // Strategy 2: Clean parentheticals
      if (!cand || cand.length === 0) {
        const clean = cleanTitleWithoutParentheticals(rel.title);
        if (clean !== rel.title) {
          cand = map.get(normalizeTitleForMatching(clean));
        }
      }

      // Strategy 3: Strip common edition suffixes
      if (!cand || cand.length === 0) {
        const stripped = stripEditionSuffix(rel.title);
        if (stripped !== rel.title) {
          cand = map.get(normalizeTitleForMatching(stripped));
        }
      }

      // Strategy 4: Subtitle prefix splitting (e.g. Job Simulator: The 2050 Archives -> Job Simulator)
      if ((!cand || cand.length === 0) && rel.title.includes(':')) {
        const prefix = rel.title.split(':')[0].trim();
        const rawCands = map.get(normalizeTitleForMatching(prefix));
        if (rawCands && rawCands.length > 0) {
          cand = rawCands.filter((c) =>
            titlesMatch(
              rel.title,
              c.raw_title,
              c.rom_name || c.raw_title,
              rel.platform_id,
            ),
          );
        }
      }

      return cand;
    };

    let candidates = searchMap(normMap);
    if ((!candidates || candidates.length === 0) && parentNormMap) {
      candidates = searchMap(parentNormMap);
    }

    if (!candidates || candidates.length === 0) continue;

    const usedSet = usedRomsByGameId.get(rel.game_id) ?? new Set<string>();
    const usedCrcSet = usedCrcsByGameId.get(rel.game_id) ?? new Set<string>();
    const availableCandidates = candidates.filter((c) => {
      if (usedSet.has(c.rom_name)) return false;
      if (c.rom_crc && usedCrcSet.has(c.rom_crc.toLowerCase())) {
        if (
          !rel.rom_crc ||
          rel.rom_crc.toLowerCase() !== c.rom_crc.toLowerCase()
        ) {
          return false;
        }
      }
      return true;
    });
    if (availableCandidates.length === 0) continue;

    // Prefer candidates matching rel.variants when present
    let variantFiltered = availableCandidates;
    if (rel.variants && rel.variants.trim()) {
      const targetVarLower = rel.variants.toLowerCase().trim();
      const exactVar = availableCandidates.filter(
        (c) => (c.variants || '').toLowerCase().trim() === targetVarLower,
      );
      if (exactVar.length > 0) {
        variantFiltered = exactVar;
      } else {
        const targetVarTokens = targetVarLower
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const partialVar = availableCandidates.filter((c) => {
          const cVarLower = (c.variants || '').toLowerCase();
          return targetVarTokens.some((t) => cVarLower.includes(t));
        });
        if (partialVar.length > 0) {
          variantFiltered = partialVar;
        }
      }
    } else {
      // When rel.variants is null, prefer Standard (null variants) over special editions/demos if available
      const standardOnly = availableCandidates.filter((c) => !c.variants);
      if (standardOnly.length > 0) {
        variantFiltered = standardOnly;
      }
    }

    const best = selectBestRegionalCandidate(variantFiltered, rel.region);
    if (!best) continue;

    usedSet.add(best.rom_name);
    usedRomsByGameId.set(rel.game_id, usedSet);
    if (best.rom_crc) {
      usedCrcSet.add(best.rom_crc.toLowerCase());
      usedCrcsByGameId.set(rel.game_id, usedCrcSet);
    }

    updates.push({
      releaseId: rel.id,
      gameId: rel.game_id,
      gameTitle: rel.title,
      platformId: rel.platform_id,
      canonicalId: best.id,
      romName: best.rom_name,
      romCrc: best.rom_crc,
    });

    updatesByPlatform[rel.platform_id] =
      (updatesByPlatform[rel.platform_id] || 0) + 1;

    const escapeSql = (s: string | null) =>
      s !== null ? `'${s.replace(/'/g, "''")}'` : 'NULL';

    sqlStatements.push(
      `UPDATE game_releases SET canonical_release_id = ${best.id}, rom_name = ${escapeSql(best.rom_name)}, rom_crc = ${escapeSql(best.rom_crc)} WHERE id = ${escapeSql(rel.id)} AND (rom_name IS NULL OR rom_name != ${escapeSql(best.rom_name)});`,
    );

    // If best is Disc 1 of a multi-disc set, automatically ensure Disc 2+ exist for this game
    const bestGroupKey = getRomGroupingKey(best.rom_name);
    if (bestGroupKey.startsWith('multi:')) {
      const siblingDiscs = availableCandidates
        .filter(
          (c) =>
            c.id !== best.id &&
            !usedSet.has(c.rom_name) &&
            c.region === best.region &&
            c.variants === best.variants &&
            getRomGroupingKey(c.rom_name) === bestGroupKey,
        )
        .sort((a, b) => a.rom_name.localeCompare(b.rom_name));

      for (const sibling of siblingDiscs) {
        usedSet.add(sibling.rom_name);
        const siblingId = `${rel.game_slug || rel.id.replace(/-default$/, '')}-disc-${sibling.id}`;
        sqlStatements.push(
          `INSERT OR IGNORE INTO game_releases (id, game_id, canonical_release_id, region, variants, rom_name, rom_crc, ownership_status, backup_status) VALUES (${escapeSql(siblingId)}, ${rel.game_id}, ${sibling.id}, ${escapeSql(sibling.region || rel.region)}, ${escapeSql(sibling.variants || rel.variants)}, ${escapeSql(sibling.rom_name)}, ${escapeSql(sibling.rom_crc)}, ${rel.ownership_status ?? 0}, 0);`,
        );
        if (!isDryRun) {
          db.prepare(
            `INSERT OR IGNORE INTO game_releases (id, game_id, canonical_release_id, region, variants, rom_name, rom_crc, ownership_status, backup_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          ).run(
            siblingId,
            rel.game_id,
            sibling.id,
            sibling.region || rel.region,
            sibling.variants || rel.variants,
            sibling.rom_name,
            sibling.rom_crc,
            rel.ownership_status ?? 0,
          );
        }
      }
    }
  }

  if (options.insertMissingVariants) {
    const escapeSql = (s: string | null) =>
      s !== null ? `'${s.replace(/'/g, "''")}'` : 'NULL';
    const catalogGames = db
      .prepare(
        `SELECT stable_id, id as slug, title, platform_id FROM games WHERE 1=1 ${options.platformId ? 'AND platform_id = ' + Number(options.platformId) : ''}`,
      )
      .all() as Array<{
      stable_id: number;
      slug: string;
      title: string;
      platform_id: number;
    }>;

    for (const g of catalogGames) {
      const normMap = datByPlatformNorm.get(g.platform_id);
      if (!normMap) continue;
      const norm = normalizeTitleForMatching(g.title);
      const cands = normMap.get(norm);
      if (!cands || cands.length === 0) continue;

      const usedSet = usedRomsByGameId.get(g.stable_id) ?? new Set<string>();
      const usedCrcSet = usedCrcsByGameId.get(g.stable_id) ?? new Set<string>();
      const platUsedSet =
        usedRomsByPlatformId.get(g.platform_id) ?? new Set<string>();
      const platUsedCrcSet =
        usedCrcsByPlatformId.get(g.platform_id) ?? new Set<string>();

      for (const c of cands) {
        if (usedSet.has(c.rom_name) || platUsedSet.has(c.rom_name)) continue;
        const crcNorm = c.rom_crc ? c.rom_crc.toLowerCase() : null;
        if (
          crcNorm &&
          (usedCrcSet.has(crcNorm) || platUsedCrcSet.has(crcNorm))
        ) {
          continue;
        }

        // Exclude re-homed box set constituent ROMs from being added onto standalone base games
        const baseNameWithoutExt = c.rom_name
          .replace(/\.(?:xiso\.iso|[a-z0-9]{2,4})$/i, '')
          .trim()
          .toLowerCase();
        if (BOX_SET_ROM_GROUPING_MAP[baseNameWithoutExt]) {
          continue;
        }

        if (
          !titlesMatch(
            g.title,
            c.raw_title,
            c.rom_name || c.raw_title,
            g.platform_id,
          )
        ) {
          continue;
        }
        usedSet.add(c.rom_name);
        usedRomsByGameId.set(g.stable_id, usedSet);
        platUsedSet.add(c.rom_name);
        usedRomsByPlatformId.set(g.platform_id, platUsedSet);
        if (crcNorm) {
          usedCrcSet.add(crcNorm);
          usedCrcsByGameId.set(g.stable_id, usedCrcSet);
          platUsedCrcSet.add(crcNorm);
          usedCrcsByPlatformId.set(g.platform_id, platUsedCrcSet);
        }
        const newId = `${g.slug}-dat-${c.id}`;
        sqlStatements.push(
          `INSERT OR IGNORE INTO game_releases (id, game_id, canonical_release_id, region, variants, rom_name, rom_crc, ownership_status, backup_status) VALUES (${escapeSql(newId)}, ${g.stable_id}, ${c.id}, ${escapeSql(c.region)}, ${escapeSql(c.variants)}, ${escapeSql(c.rom_name)}, ${escapeSql(c.rom_crc)}, 0, 0);`,
        );
        if (!isDryRun) {
          db.prepare(
            `INSERT OR IGNORE INTO game_releases (id, game_id, canonical_release_id, region, variants, rom_name, rom_crc, ownership_status, backup_status) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`,
          ).run(
            newId,
            g.stable_id,
            c.id,
            c.region,
            c.variants,
            c.rom_name,
            c.rom_crc,
          );
        }
      }
    }
  }

  sqlStatements.push('');
  sqlStatements.push('PRAGMA foreign_keys = ON;');
  sqlStatements.push('');

  // Write SQL migration file
  fs.writeFileSync(sqlPath, sqlStatements.join('\n'), 'utf8');

  // Apply to local database in a transaction if not dry run
  if (!isDryRun && updates.length > 0) {
    const updateStmt = db.prepare(`
      UPDATE game_releases
      SET canonical_release_id = ?, rom_name = ?, rom_crc = ?
      WHERE id = ?
    `);

    const applyTx = db.transaction(() => {
      for (const u of updates) {
        updateStmt.run(u.canonicalId, u.romName, u.romCrc, u.releaseId);
      }
    });

    applyTx();
  }

  return {
    totalEvaluated: candidateReleases.length,
    reconciledCount: updates.length,
    updatesByPlatform,
    sqlPath,
    updates,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const db = getDatabase();
  let platformId: number | undefined;
  const platArg = process.argv.find((a) => a.startsWith('--platform='));
  if (platArg) {
    platformId = Number(platArg.split('=')[1]);
  }
  const isDryRun = process.argv.includes('--dry-run');
  const insertMissingVariants = process.argv.includes(
    '--insert-missing-variants',
  );
  const res = reconcileGameReleasesWithCanonical(db, {
    platformId,
    dryRun: isDryRun,
    insertMissingVariants,
  });
  console.log(
    `Evaluated: ${res.totalEvaluated}, Reconciled: ${res.reconciledCount}`,
  );
  for (const [pId, cnt] of Object.entries(res.updatesByPlatform)) {
    console.log(`Platform ${pId}: ${cnt} updates`);
  }
  db.close();
}
