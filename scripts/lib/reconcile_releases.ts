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

export interface ReconcileOptions {
  dryRun?: boolean;
  platformId?: number;
  sqlOutputPath?: string;
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
 * Selects the best candidate canonical release based on regional compatibility.
 */
export function selectBestRegionalCandidate<
  T extends { region: string | null },
>(candidates: T[], targetRegion: string | null): T {
  if (candidates.length <= 1 || !targetRegion) {
    return candidates[0];
  }

  const regLower = targetRegion.toLowerCase();

  // 1. Exact match (case-insensitive)
  const exact = candidates.find(
    (c) => c.region && c.region.toLowerCase() === regLower,
  );
  if (exact) return exact;

  // 2. Region substring contains target region
  const contains = candidates.find(
    (c) => c.region && c.region.toLowerCase().includes(regLower),
  );
  if (contains) return contains;

  // 3. USA / North America fallback to World
  if (regLower === 'usa' || regLower === 'north america') {
    const world = candidates.find(
      (c) =>
        c.region &&
        (c.region.toLowerCase() === 'world' ||
          c.region.toLowerCase().includes('north america')),
    );
    if (world) return world;
  }

  // 4. Europe fallback to World
  if (regLower === 'europe') {
    const world = candidates.find(
      (c) => c.region && c.region.toLowerCase() === 'world',
    );
    if (world) return world;
  }

  // 5. Any World release
  const anyWorld = candidates.find(
    (c) => c.region && c.region.toLowerCase() === 'world',
  );
  if (anyWorld) return anyWorld;

  return candidates[0];
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
    SELECT gr.id, gr.game_id, g.platform_id, g.title, gr.region, gr.variants,
           gr.rom_name, gr.rom_crc, gr.canonical_release_id
    FROM game_releases gr
    JOIN games g ON gr.game_id = g.stable_id
    WHERE gr.rom_name IS NULL
    ${options.platformId ? 'AND g.platform_id = ' + Number(options.platformId) : ''}
    ORDER BY g.platform_id ASC, g.title ASC
  `;

  const candidateReleases = db.prepare(candidateQuery).all() as Array<{
    id: string;
    game_id: number;
    platform_id: number;
    title: string;
    region: string | null;
    variants: string | null;
    rom_name: string | null;
    rom_crc: string | null;
    canonical_release_id: number | null;
  }>;

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
            titlesMatch(rel.title, c.raw_title, c.raw_title, rel.platform_id),
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

    const best = selectBestRegionalCandidate(candidates, rel.region);

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
  const res = reconcileGameReleasesWithCanonical(db, {
    platformId,
    dryRun: isDryRun,
  });
  console.log(
    `Evaluated: ${res.totalEvaluated}, Reconciled: ${res.reconciledCount}`,
  );
  for (const [pId, cnt] of Object.entries(res.updatesByPlatform)) {
    console.log(`Platform ${pId}: ${cnt} updates`);
  }
  db.close();
}
