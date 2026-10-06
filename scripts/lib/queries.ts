/**
 * SHARED SQL QUERIES
 *
 * These templates are used by both the Cloudflare Worker (D1) and the
 * Local API Server (better-sqlite3). Centralizing these prevents
 * logic drift between production and development environments.
 */

import {
  DISC_ROLE_INDICATORS,
  extractDiscLabel,
  isRegionOrLanguageOrDisc,
  isTrueEditionOrRevisionVariant,
} from './dat_format.js';
import {
  BOX_SET_DEFINITIONS,
  BOX_SET_DISC_LABELS,
  BOX_SET_ROM_GROUPING_MAP,
  BoxSetCompanionSpec,
  CANONICAL_VOUCHER_BUNDLES,
  SUPERSEDED_RELEASE_PAIRS,
  normalizeForLabelMatch,
} from './special_labels.js';

export const GAMES_LIST_QUERY = `
    SELECT COALESCE(r.id, g.id) as id,
           g.id as game_id,
           g.stable_id,
           g.title,
           g.series,
           g.canonical_series,
           r.release_date,
           g.platform_id,
            g.queued,
            g.sort_index,
            COALESCE(r.image_url, g.image_url) as image_url,
            g.play_status,
            g.igdb_id,
            g.igdb_url,
            g.summary,
            g.genres,
            g.collections,
            g.franchises,
            g.manually_verified,
            g.metadata_json,
            g.physical_status,
            g.verification_tier,
            g.barcode,
            g.release_medium,
            g.origin_metadata,
            g.bundle_parent_id,
            g.bundle_disc_number,
            COALESCE(bc.bundle_count, 0) as bundle_count,
            COALESCE(r.ownership_status, 0) as ownership_status,
            COALESCE(r.region, g.region) as region,
            r.variants,
            r.also_released_as,
            r.rom_name,
            r.rom_crc,
            COALESCE(r.backup_status, 0) as backup_status,
            COALESCE(r.has_case, 0) as has_case,
            COALESCE(r.has_manual, 0) as has_manual,
            g.gameye_id,
            g.gameye_platform_id,
            g.price_loose,
            g.price_cib,
            g.price_new,
            g.price_updated_at,
            g.retail_price,
            g.retail_regular_price,
            g.retail_discount_pct,
            COALESCE(g.retail_on_sale, 0) as retail_on_sale,
            g.retail_store,
            g.retail_url,
            g.retail_updated_at,
            COALESCE(pp.display_name, p.display_name) as display_name, 
            COALESCE(pp.brand, p.brand) as brand, 
            COALESCE(pp.launch_date, p.launch_date) as platform_launch_date, 
            COALESCE(pp.image_url, p.image_url) as platform_logo,
            p.parent_platform_id
     FROM games g 
     LEFT JOIN game_releases r ON g.stable_id = r.game_id
     LEFT JOIN platforms p ON g.platform_id = p.id
     LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
     LEFT JOIN (
         SELECT bundle_parent_id, COUNT(*) as bundle_count 
         FROM games 
         WHERE bundle_parent_id IS NOT NULL 
         GROUP BY bundle_parent_id
     ) bc ON g.stable_id = bc.bundle_parent_id
     WHERE 1=1
 `;

export const GAME_DETAIL_QUERY = `
     SELECT COALESCE(r.id, g.id) as id,
            g.id as game_id,
            g.stable_id,
            g.title,
            g.series,
            g.canonical_series,
            r.release_date,
            g.platform_id,
            g.queued,
            g.sort_index,
            COALESCE(r.image_url, g.image_url) as image_url,
            g.play_status,
            g.igdb_id,
            g.igdb_url,
            g.summary,
            g.genres,
            g.collections,
            g.franchises,
            g.manually_verified,
            g.metadata_json,
            g.physical_status,
            g.verification_tier,
            g.barcode,
            g.release_medium,
            g.origin_metadata,
            g.bundle_parent_id,
            g.bundle_disc_number,
            COALESCE(bc.bundle_count, 0) as bundle_count,
            COALESCE(r.ownership_status, 0) as ownership_status,
            COALESCE(r.region, g.region) as region,
            r.variants,
            r.also_released_as,
            r.rom_name,
            r.rom_crc,
            COALESCE(r.backup_status, 0) as backup_status,
            COALESCE(r.has_case, 0) as has_case,
            COALESCE(r.has_manual, 0) as has_manual,
            g.gameye_id,
            g.gameye_platform_id,
            g.price_loose,
            g.price_cib,
            g.price_new,
            g.price_updated_at,
            g.retail_price,
            g.retail_regular_price,
            g.retail_discount_pct,
            COALESCE(g.retail_on_sale, 0) as retail_on_sale,
            g.retail_store,
            g.retail_url,
            g.retail_updated_at,
            COALESCE(pp.display_name, p.display_name) as display_name, 
            COALESCE(pp.brand, p.brand) as brand, 
            COALESCE(pp.launch_date, p.launch_date) as platform_launch_date, 
            COALESCE(pp.image_url, p.image_url) as platform_logo,
            p.parent_platform_id
     FROM games g 
     LEFT JOIN game_releases r ON r.id = (
         SELECT id FROM game_releases WHERE id = ?
         UNION ALL
         SELECT id FROM game_releases WHERE game_id = g.stable_id
         LIMIT 1
     )
     LEFT JOIN platforms p ON g.platform_id = p.id 
     LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
     LEFT JOIN (
         SELECT bundle_parent_id, COUNT(*) as bundle_count 
         FROM games 
         WHERE bundle_parent_id IS NOT NULL 
         GROUP BY bundle_parent_id
     ) bc ON g.stable_id = bc.bundle_parent_id
     WHERE g.stable_id = (
         SELECT game_id FROM game_releases WHERE id = ?
         UNION ALL
         SELECT stable_id FROM games WHERE id = ?
         LIMIT 1
     )
 `;

export const GAME_RELEASES_BY_GAME_ID_QUERY = `
     SELECT id, game_id, region, variants, also_released_as, rom_name, rom_crc, backup_status, ownership_status, release_date, image_url, COALESCE(has_case, 0) as has_case, COALESCE(has_manual, 0) as has_manual
     FROM game_releases
     WHERE game_id = ? AND region IS ? AND variants IS ?
 `;

export const BUNDLED_GAMES_BY_PARENT_QUERY = `
    SELECT g.stable_id,
           g.id,
           g.title,
           g.platform_id,
           g.bundle_disc_number,
           g.release_medium,
           g.origin_metadata,
           COALESCE(r.rom_name, g.title) as rom_name,
           COALESCE(r.backup_status, g.backup_status, 0) as backup_status,
           COALESCE(pp.display_name, p.display_name) as platform_name
    FROM games g
    LEFT JOIN game_releases r ON g.stable_id = r.game_id
    LEFT JOIN platforms p ON g.platform_id = p.id
    LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
    WHERE g.bundle_parent_id = ?
    ORDER BY g.bundle_disc_number ASC, g.title ASC
`;

export const PLATFORMS_LIST_QUERY = `
    SELECT p.* FROM platforms p 
    WHERE (
        EXISTS (
            SELECT 1 FROM games g 
            WHERE g.platform_id = p.id 
            OR g.platform_id IN (SELECT id FROM platforms WHERE parent_platform_id = p.id)
        )
        OR EXISTS (
            SELECT 1 FROM canonical_releases cr WHERE cr.platform_id = p.id
        )
    )
    AND p.parent_platform_id IS NULL
    ORDER BY p.launch_date ASC, p.id ASC
`;

export const TOYS_LIST_QUERY = `
    SELECT f.*, fs.line as series_line, COALESCE(CASE WHEN f.line = 'Skylanders' THEN NULL ELSE f.series END, fs.name) as series_name, fs.sort_index as series_index
    FROM toys f
    LEFT JOIN toy_series fs ON f.series_id = fs.id
    ORDER BY 
             CASE WHEN fs.line COLLATE NOCASE LIKE 'the %' THEN SUBSTR(fs.line, 5) WHEN fs.line COLLATE NOCASE LIKE 'a %' THEN SUBSTR(fs.line, 3) ELSE fs.line END COLLATE NOCASE ASC, 
             fs.sort_index IS NULL ASC, fs.sort_index ASC, 
             CASE WHEN COALESCE(CASE WHEN f.line = 'Skylanders' THEN NULL ELSE f.series END, fs.name) COLLATE NOCASE LIKE 'the %' THEN SUBSTR(COALESCE(CASE WHEN f.line = 'Skylanders' THEN NULL ELSE f.series END, fs.name), 5) WHEN COALESCE(CASE WHEN f.line = 'Skylanders' THEN NULL ELSE f.series END, fs.name) COLLATE NOCASE LIKE 'a %' THEN SUBSTR(COALESCE(CASE WHEN f.line = 'Skylanders' THEN NULL ELSE f.series END, fs.name), 3) ELSE COALESCE(CASE WHEN f.line = 'Skylanders' THEN NULL ELSE f.series END, fs.name) END COLLATE NOCASE ASC, 
             -- 1. Amiibo Type (Figures first, Cards last)
             CASE 
               WHEN f.line = 'amiibo' THEN 
                 CASE f.type 
                   WHEN 'Figure' THEN 1 
                   WHEN 'Yarn' THEN 2 
                   WHEN 'Block' THEN 3 
                   WHEN 'Band' THEN 4 
                   ELSE 5 
                 END 
               ELSE 1 
             END ASC,
             -- 2. Non-Amiibo Sort Index (since non-amiibos sort by sort_index first)
             CASE WHEN f.line = 'amiibo' THEN 1 ELSE (CASE WHEN f.sort_index IS NULL THEN 1 ELSE 0 END) END ASC,
             CASE WHEN f.line = 'amiibo' THEN 1 ELSE f.sort_index END ASC,
             -- 3. Release Date
             f.release_date IS NULL ASC, f.release_date ASC, 
             -- 4. Amiibo Sort Index (since amiibos sort by type -> release_date -> sort_index)
             CASE WHEN f.line = 'amiibo' THEN (CASE WHEN f.sort_index IS NULL THEN 1 ELSE 0 END) ELSE 1 END ASC,
             CASE WHEN f.line = 'amiibo' THEN f.sort_index ELSE 1 END ASC,
             -- 5. Fallback Name
             CASE WHEN f.name COLLATE NOCASE LIKE 'the %' THEN SUBSTR(f.name, 5) WHEN f.name COLLATE NOCASE LIKE 'a %' THEN SUBSTR(f.name, 3) ELSE f.name END COLLATE NOCASE ASC
`;

export const TOY_DETAIL_QUERY = `
    SELECT f.*, fs.line as series_line, COALESCE(CASE WHEN f.line = 'Skylanders' THEN NULL ELSE f.series END, fs.name) as series_name, fs.sort_index as series_index
    FROM toys f
    LEFT JOIN toy_series fs ON f.series_id = fs.id
    WHERE f.id = ?
`;

/**
 * Common Sorters and Filters can also be added here if they share SQL syntax.
 */
export const GAMES_ORDER_BY = `
    ORDER BY COALESCE(pp.launch_date, p.launch_date) ASC, 
             COALESCE(p.parent_platform_id, p.id) ASC, 
             g.platform_id ASC, 
             CASE WHEN COALESCE(g.canonical_series, g.title) COLLATE NOCASE LIKE 'the %' THEN SUBSTR(COALESCE(g.canonical_series, g.title), 5) WHEN COALESCE(g.canonical_series, g.title) COLLATE NOCASE LIKE 'a %' THEN SUBSTR(COALESCE(g.canonical_series, g.title), 3) ELSE COALESCE(g.canonical_series, g.title) END COLLATE NOCASE ASC, 
             r.release_date IS NULL ASC, r.release_date ASC, g.sort_index IS NULL ASC, g.sort_index ASC, 
             CASE WHEN g.title COLLATE NOCASE LIKE 'the %' THEN SUBSTR(g.title, 5) WHEN g.title COLLATE NOCASE LIKE 'a %' THEN SUBSTR(g.title, 3) ELSE g.title END COLLATE NOCASE ASC,
             CASE 
               WHEN r.variants IS NULL THEN 0 
               WHEN r.variants LIKE '%beta%' OR r.variants LIKE '%proto%' OR r.variants LIKE '%demo%' OR r.variants LIKE '%kiosk%' OR r.variants LIKE '%sample%' OR r.variants LIKE '%promo%' THEN 2 
               ELSE 1 
             END ASC,
             COALESCE(r.region, '') ASC,
             COALESCE(r.id, g.id) ASC
`;

/**
 * Checks if the filename contains a disc indicator (e.g. "Disc 1", "(Disco 2)", "(Disque 1)", "(Play Disc)").
 */
export function hasDiscIndicator(filename: string | null | undefined): boolean {
  if (!filename) {
    return false;
  }
  const discRegex =
    /[-_\s]*\(?((?:disc|disco|disque|disk|side)\s+[a-zA-Z0-9]+(?:\s+of\s+[0-9]+|\s*[/\\\\]\s*[0-9]+)?)\)?/i;
  if (discRegex.test(filename)) return true;

  if (/[-_\s]*\((?:ichi|ni|san|yon|shi|go)\)/i.test(filename)) return true;

  const parentheticals = filename.match(/\(([^)]+)\)/g);
  if (parentheticals) {
    for (const m of parentheticals) {
      const inner = m.slice(1, -1).trim().toLowerCase();
      if (DISC_ROLE_INDICATORS.has(inner)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Strips disc-specific markers, per-disc subtitles, and file extensions from a ROM filename.
 */
export function stripDiscIndicator(
  filename: string | null | undefined,
): string {
  if (!filename) {
    return '';
  }

  // Extract base name without file extension (if any)
  let base = filename;
  const lastDot = filename.lastIndexOf('.');
  if (lastDot !== -1) {
    const extCandidate = filename.slice(lastDot);
    if (/^\.[a-zA-Z0-9]{1,5}$/.test(extCandidate)) {
      base = filename.slice(0, lastDot);
    }
  }

  const baseLower = base.toLowerCase();
  const hasNumberedDisc =
    /[-_\s]*\(?((?:disc|disco|disque|disk|side)\s+[a-zA-Z0-9]+(?:\s+of\s+[0-9]+|\s*[/\\\\]\s*[0-9]+)?)\)?/i.test(
      base,
    ) || /[-_\s]*\((?:ichi|ni|san|yon|shi|go)\)/i.test(base);

  // Normalize cross-region companion Disc 2s that share a retail box with a single-region Disc 1
  if (baseLower.startsWith('halo 3 - odst')) {
    base = base
      .replace(/\(usa,\s*brazil\)/gi, '(USA)')
      .replace(/\(europe,\s*asia\)/gi, '(Europe, Australia)');
  } else if (
    baseLower.startsWith('resident evil 6') &&
    baseLower.includes('(voice over pack)')
  ) {
    base = base.replace(/\(usa,\s*europe\)/gi, '(World)');
  }

  // Regex to match and strip typical disc indicators (e.g. "Disc 1", "Disco 2", "Disque 1", "(Disc A)")
  base = base.replace(
    /[-_\s]*\(?((?:disc|disco|disque|disk|side)\s+[a-zA-Z0-9]+(?:\s+of\s+[0-9]+|\s*[/\\\\]\s*[0-9]+)?)\)?/gi,
    '',
  );

  // Strip Japanese parenthetical counting indicators (e.g. "Ichi", "Ni" etc.)
  base = base.replace(/[-_\s]*\((?:ichi|ni|san|yon|shi|go)\)/gi, '');

  // Strip disc-role indicators and per-disc subtitles while preserving regions and true editions/revisions
  base = base.replace(/\s*\(([^)]+)\)/g, (match, innerRaw: string) => {
    const inner = innerRaw.trim();
    const innerLower = inner.toLowerCase();
    if (DISC_ROLE_INDICATORS.has(innerLower)) {
      return '';
    }
    if (
      hasNumberedDisc &&
      !isRegionOrLanguageOrDisc(inner) &&
      !isTrueEditionOrRevisionVariant(inner)
    ) {
      return '';
    }
    if (
      hasNumberedDisc &&
      baseLower.startsWith('metal gear solid 3 - subsistence') &&
      /^(?:limited edition|shokai seisanban)$/i.test(innerLower)
    ) {
      return '';
    }
    // Also strip pure language lists (e.g. "(En,Ja)") so companion discs with/without language tags match
    if (
      hasNumberedDisc &&
      isRegionOrLanguageOrDisc(inner) &&
      !/\b(usa|europe|japan|world|asia|france|germany|australia|uk|united kingdom|canada|korea|brazil|spain|italy|netherlands|sweden|russia|china|taiwan|portugal|denmark|norway|finland|hong kong|hongkong|latam|latin america|nz|new zealand|scandinavia|poland|austria|switzerland|ireland|turkey|united arab emirates|uae|greece|south africa|india)\b/i.test(
        innerLower,
      )
    ) {
      return '';
    }
    return match;
  });

  // Normalize extra spaces and trim any trailing separator characters
  base = base.replace(/\s+/g, ' ').trim();
  base = base.replace(/[-_]$/, '').trim();

  return base.toLowerCase();
}

/**
 * Returns a robust grouping key for ROMs to correctly handle multi-disc sets
 * while separating single-disc releases with different names/modifiers.
 */
export function getRomGroupingKey(filename: string | null | undefined): string {
  if (!filename) {
    return '';
  }
  const lastDot = filename.lastIndexOf('.');
  const base = lastDot !== -1 ? filename.slice(0, lastDot) : filename;
  const baseLower = base.toLowerCase();
  if (BOX_SET_ROM_GROUPING_MAP[baseLower]) {
    return BOX_SET_ROM_GROUPING_MAP[baseLower];
  }
  if (hasDiscIndicator(filename)) {
    return `multi:${stripDiscIndicator(filename)}`;
  }
  // For single-disc releases, group only by exact filename (without extension)
  return `single:${baseLower}`;
}

export const PLATFORM_RELEASES_FOR_COMPANION_QUERY = `
    SELECT r.id, r.game_id, r.region, r.variants, r.also_released_as, r.rom_name, r.rom_crc,
           r.backup_status, r.ownership_status, r.release_date,
           COALESCE(r.has_case, 0) as has_case, COALESCE(r.has_manual, 0) as has_manual,
           g.title as game_title, g.platform_id
    FROM game_releases r
    JOIN games g ON r.game_id = g.stable_id
    WHERE g.platform_id = ? AND r.rom_name IS NOT NULL
    ORDER BY r.rom_name ASC
`;

export const TARGETED_COMPANION_BY_CRC_QUERY = `
    SELECT r.id, r.game_id, r.region, r.variants, r.also_released_as, r.rom_name, r.rom_crc,
           r.backup_status, r.ownership_status, r.release_date,
           COALESCE(r.has_case, 0) as has_case, COALESCE(r.has_manual, 0) as has_manual,
           g.title as game_title, g.platform_id
    FROM game_releases r
    JOIN games g ON r.game_id = g.stable_id
    WHERE r.rom_crc = ? AND r.id != ?
`;

export const TARGETED_COMPANION_BY_GAME_ID_QUERY = `
    SELECT r.id, r.game_id, r.region, r.variants, r.also_released_as, r.rom_name, r.rom_crc,
           r.backup_status, r.ownership_status, r.release_date,
           COALESCE(r.has_case, 0) as has_case, COALESCE(r.has_manual, 0) as has_manual,
           g.title as game_title, g.platform_id
    FROM game_releases r
    JOIN games g ON r.game_id = g.stable_id
    WHERE g.stable_id = ? AND r.rom_name IS NOT NULL
`;

export const TARGETED_COMPANION_BY_TITLE_QUERY = `
    SELECT r.id, r.game_id, r.region, r.variants, r.also_released_as, r.rom_name, r.rom_crc,
           r.backup_status, r.ownership_status, r.release_date,
           COALESCE(r.has_case, 0) as has_case, COALESCE(r.has_manual, 0) as has_manual,
           g.title as game_title, g.platform_id
    FROM game_releases r
    JOIN games g ON r.game_id = g.stable_id
    WHERE g.platform_id = ? AND g.title = ? AND r.rom_name IS NOT NULL
`;

/**
 * Returns any related game titles that should be queried for companion candidate releases
 * (e.g. standalone game titles for box sets, box set titles for standalone games, or Superseded pairs).
 */
export function getRelatedGameTitlesForCompanion(game: {
  stable_id?: number;
  title?: string;
  platform_id?: number;
  rom_name?: string | null;
}): string[] {
  if (!game || !game.platform_id) return [];
  const relatedTitles = new Set<string>();
  const romLower = (game.rom_name || '').toLowerCase();
  const normRomTitle = normalizeForLabelMatch(
    game.rom_name || game.title || '',
  );
  const normGameTitle = normalizeForLabelMatch(game.title || '');

  for (const pair of SUPERSEDED_RELEASE_PAIRS) {
    if (pair.platformId !== game.platform_id) continue;
    const isSuperset =
      (pair.supersetStableId !== undefined &&
        pair.supersetStableId === game.stable_id &&
        (!pair.supersetRomMarker ||
          romLower.includes(pair.supersetRomMarker))) ||
      normRomTitle === pair.supersetNormalizedTitle ||
      normGameTitle === pair.supersetNormalizedTitle;
    if (isSuperset) relatedTitles.add(pair.originalDisplayTitle);

    const isOriginal =
      (pair.originalStableId !== undefined &&
        pair.originalStableId === game.stable_id) ||
      normRomTitle === pair.originalNormalizedTitle ||
      normGameTitle === pair.originalNormalizedTitle;
    if (isOriginal) relatedTitles.add(pair.supersetDisplayTitle);
  }

  for (const boxSet of BOX_SET_DEFINITIONS) {
    if (boxSet.platformId !== game.platform_id) continue;
    if (normGameTitle === boxSet.boxSetNormTitle) {
      for (const disc of boxSet.discs) {
        relatedTitles.add(disc.standaloneDisplayTitle);
      }
    }
    const matchesDisc = boxSet.discs.some(
      (d) =>
        d.standaloneNormTitle === normGameTitle ||
        d.standaloneNormTitle === normRomTitle,
    );
    if (matchesDisc) {
      relatedTitles.add(boxSet.boxSetDisplayTitle);
    }
  }

  return Array.from(relatedTitles);
}

/**
 * Returns any related game stable_ids that should be queried for companion candidate releases
 * (e.g. partner games in Superseded pairs such as Oblivion vs Oblivion GOTY).
 */
export function getRelatedGameIdsForCompanion(game: {
  stable_id?: number;
  title?: string;
  platform_id?: number;
  rom_name?: string | null;
}): number[] {
  if (!game || !game.platform_id) return [];
  const relatedStableIds = new Set<number>();
  const romLower = (game.rom_name || '').toLowerCase();
  const normRomTitle = normalizeForLabelMatch(
    game.rom_name || game.title || '',
  );
  const normGameTitle = normalizeForLabelMatch(game.title || '');

  for (const pair of SUPERSEDED_RELEASE_PAIRS) {
    if (pair.platformId !== game.platform_id) continue;

    const isSuperset =
      (pair.supersetStableId !== undefined &&
        pair.supersetStableId === game.stable_id &&
        (!pair.supersetRomMarker ||
          romLower.includes(pair.supersetRomMarker))) ||
      normRomTitle === pair.supersetNormalizedTitle ||
      normGameTitle === pair.supersetNormalizedTitle;

    if (isSuperset && pair.originalStableId) {
      relatedStableIds.add(pair.originalStableId);
    }

    const isOriginal =
      (pair.originalStableId !== undefined &&
        pair.originalStableId === game.stable_id) ||
      normRomTitle === pair.originalNormalizedTitle ||
      normGameTitle === pair.originalNormalizedTitle;

    if (isOriginal && pair.supersetStableId) {
      relatedStableIds.add(pair.supersetStableId);
    }
  }

  return Array.from(relatedStableIds);
}

/**
 * Checks if a game release row matches a box set disc specification.
 */
export function matchesBoxSetDiscSpec(
  rel: Record<string, unknown>,
  spec: BoxSetCompanionSpec,
): boolean {
  const rName = String(rel['rom_name'] || '');
  const rNameNorm = normalizeForLabelMatch(rName);
  const rNameLower = rName.toLowerCase();
  const alsoReleasedAs = String(rel['also_released_as'] || '');
  const alsoTokens = alsoReleasedAs
    .split(',')
    .map((s) => normalizeForLabelMatch(s))
    .filter(Boolean);

  if (
    spec.companionRomFilter &&
    !rNameLower.includes(spec.companionRomFilter.toLowerCase())
  ) {
    return false;
  }

  if (rNameNorm === spec.standaloneNormTitle) return true;
  if (alsoTokens.includes(spec.standaloneNormTitle)) return true;
  if (normalizeForLabelMatch(alsoReleasedAs) === spec.standaloneNormTitle)
    return true;

  return false;
}

export interface CompanionDiscCandidateRow {
  id: string;
  game_id: number;
  region: string | null;
  variants: string | null;
  also_released_as?: string | null;
  rom_name: string | null;
  rom_crc: string | null;
  backup_status: number;
  ownership_status: number;
  release_date: string | null;
  has_case?: number;
  has_manual?: number;
  game_title: string;
  platform_id: number;
  disc_label?: string | null;
  is_companion_base_disc?: boolean;
  companion_game_id?: string;
  companion_game_title?: string;
}

export interface SharedBackupReleaseLink {
  id: string;
  title: string;
  region: string | null;
  variants: string | null;
  rom_name: string | null;
  ownership_status: number;
  backup_status: number;
}

function regionsOverlap(
  regionA: string | null | undefined,
  regionB: string | null | undefined,
): boolean {
  const tokensA = (regionA || '')
    .toLowerCase()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const tokensB = (regionB || '')
    .toLowerCase()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (tokensA.length === 0 || tokensB.length === 0) return false;
  if (tokensA.includes('world') || tokensB.includes('world')) return true;
  return tokensA.some((t) => tokensB.includes(t));
}

/**
 * Enriches a game detail response with:
 * 1. Per-disc labels (`disc_label`) on `game.releases`.
 * 2. Case 1 (When viewing a GOTY/expanded release or Box Set):
 *    Attaches matching regional companion discs from standalone releases (with their
 *    `backup_status` and a link back to the standalone release) without altering `ownership_status`.
 * 3. Case 2 (When viewing a Superseded original release or a standalone game included in a Box Set):
 *    Attaches `shared_backup_releases` linking forward to the GOTY/expanded release(s) or Box Set(s).
 * 4. Case 3 (When viewing a Physical Release that bundled companion games via digital vouchers):
 *    Attaches `voucher_notes` detailing the voucher companion contents without creating phantom entries.
 */
export function enrichGameDetailWithCompanionsAndVouchers(
  game: {
    id?: string;
    stable_id?: number;
    title?: string;
    platform_id?: number;
    region?: string | null;
    variants?: string | null;
    rom_name?: string | null;
    releases?: Array<Record<string, unknown>>;
    shared_backup_releases?: SharedBackupReleaseLink[];
    voucher_notes?: string[];
  },
  platformReleases: CompanionDiscCandidateRow[],
): void {
  if (!game || !game.releases) return;

  // 1. Attach human-readable disc_label to each release row
  for (const rel of game.releases) {
    const rName = (rel['rom_name'] as string | null) || null;
    const rNameWithoutExt = (rName || '')
      .replace(/\.(?:xiso\.iso|[a-z0-9]{2,4})$/i, '')
      .trim()
      .toLowerCase();
    rel['disc_label'] =
      BOX_SET_DISC_LABELS[rNameWithoutExt] || extractDiscLabel(rName);
  }

  const romLower = (game.rom_name || '').toLowerCase();
  const normRomTitle = normalizeForLabelMatch(
    game.rom_name || game.title || '',
  );
  const normGameTitle = normalizeForLabelMatch(game.title || '');
  const regTokens = (game.region || '')
    .toLowerCase()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const scoreCandidate = (c: CompanionDiscCandidateRow): number => {
    let score = 0;
    if ((c.region || '').toLowerCase() === (game.region || '').toLowerCase()) {
      score += 100;
    } else if (
      (c.region || '')
        .toLowerCase()
        .split(',')
        .map((s) => s.trim())[0] === regTokens[0]
    ) {
      score += 50;
    }
    if (c.backup_status === 1) score += 25;
    if (c.ownership_status === 1) score += 10;
    const cVar = (c.variants || '').toLowerCase();
    if (!cVar || cVar === 'superseded') score += 5;
    return score;
  };

  // 2. Check if this release is the Superset (GOTY/Expanded) side of a SupersededReleasePair (Case 1)
  for (const pair of SUPERSEDED_RELEASE_PAIRS) {
    if (pair.platformId !== game.platform_id) continue;

    const isSupersetMatch =
      (pair.supersetStableId !== undefined &&
        pair.supersetStableId === game.stable_id &&
        (!pair.supersetRomMarker ||
          romLower.includes(pair.supersetRomMarker))) ||
      normRomTitle === pair.supersetNormalizedTitle ||
      normGameTitle === pair.supersetNormalizedTitle;

    if (!isSupersetMatch) continue;
    if (
      pair.excludedRegions?.some((ex) => regTokens.includes(ex)) ||
      !regTokens.some((r) => pair.applicableRegions.includes(r))
    ) {
      continue;
    }

    // Only prepend companion Disc 1 if this release group doesn't already contain a Disc 1
    const alreadyHasDisc1 = game.releases.some((r) =>
      /\((?:disc|disco|disque|disk)\s+1\b/i.test(String(r['rom_name'] || '')),
    );
    if (alreadyHasDisc1) continue;

    // Find candidate original Disc 1 releases on the same platform
    const candidates = platformReleases.filter((cand) => {
      const candRomLower = (cand.rom_name || '').toLowerCase();
      if (
        /\b(beta|proto|prototype|demo|kiosk|sample|promo|taikenban|title update|bonus)\b/i.test(
          candRomLower,
        ) ||
        candRomLower.startsWith('tu_')
      ) {
        return false;
      }
      if (
        pair.supersetRomMarker &&
        candRomLower.includes(pair.supersetRomMarker)
      ) {
        return false;
      }
      if (
        pair.originalExcludeMarker &&
        candRomLower.includes(pair.originalExcludeMarker)
      ) {
        return false;
      }
      const candNorm = normalizeForLabelMatch(cand.rom_name || cand.game_title);
      if (candNorm !== pair.originalNormalizedTitle) return false;
      return regionsOverlap(game.region, cand.region);
    });

    if (candidates.length > 0) {
      candidates.sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
      const bestBase = candidates[0];

      game.releases.unshift({
        id: bestBase.id,
        game_id: bestBase.game_id,
        region: bestBase.region,
        variants: bestBase.variants,
        also_released_as: bestBase.also_released_as,
        rom_name: bestBase.rom_name,
        rom_crc: bestBase.rom_crc,
        backup_status: bestBase.backup_status,
        ownership_status: bestBase.ownership_status,
        release_date: bestBase.release_date,
        disc_label: 'Disc 1 (Base Game)',
        is_companion_base_disc: true,
        companion_game_id: bestBase.id,
        companion_game_title: pair.originalDisplayTitle,
      });
    }
  }

  // 3. Check if this release is a Multi-Game Box Set in BOX_SET_DEFINITIONS
  for (const boxSet of BOX_SET_DEFINITIONS) {
    if (boxSet.platformId !== game.platform_id) continue;
    if (normGameTitle !== boxSet.boxSetNormTitle) continue;

    for (const spec of boxSet.discs) {
      // First, label any concrete discs already inside game.releases
      for (const rel of game.releases) {
        if (matchesBoxSetDiscSpec(rel, spec)) {
          if (!rel['disc_label'] || rel['disc_label'] === 'Disc') {
            rel['disc_label'] = spec.discLabel;
          }
        }
      }

      // Find standalone game's best matching release in this region
      const candidates = platformReleases.filter((cand) => {
        if (cand.game_id === game.stable_id) return false;
        const candRomLower = (cand.rom_name || '').toLowerCase();
        if (
          /\b(beta|proto|prototype|demo|kiosk|sample|promo|taikenban|title update|bonus)\b/i.test(
            candRomLower,
          ) ||
          candRomLower.startsWith('tu_') ||
          candRomLower.includes('\\')
        ) {
          return false;
        }
        if (
          spec.companionRomFilter &&
          !candRomLower.includes(spec.companionRomFilter.toLowerCase())
        ) {
          return false;
        }
        const candGameNorm = normalizeForLabelMatch(cand.game_title);
        const candRomNorm = normalizeForLabelMatch(
          cand.rom_name || cand.game_title,
        );
        if (
          candGameNorm !== spec.standaloneNormTitle &&
          candRomNorm !== spec.standaloneNormTitle
        ) {
          return false;
        }
        return regionsOverlap(game.region, cand.region);
      });

      if (candidates.length === 0) continue;
      candidates.sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
      const bestStandalone = candidates[0];

      if (spec.isVirtualCompanion) {
        // Avoid adding a virtual companion disc if a re-homed disc for that same standalone game is already in game.releases
        const alreadyPresent = game.releases.some((r) => {
          const rRomLower = String(r['rom_name'] || '').toLowerCase();
          if (
            spec.companionRomFilter &&
            !rRomLower.includes(spec.companionRomFilter.toLowerCase())
          ) {
            return false;
          }
          return (
            normalizeForLabelMatch(String(r['rom_name'] || '')) ===
            spec.standaloneNormTitle
          );
        });
        if (!alreadyPresent) {
          game.releases.push({
            id: bestStandalone.id,
            game_id: bestStandalone.game_id,
            region: bestStandalone.region,
            variants: bestStandalone.variants,
            also_released_as: bestStandalone.also_released_as,
            rom_name: bestStandalone.rom_name,
            rom_crc: bestStandalone.rom_crc,
            backup_status: bestStandalone.backup_status,
            ownership_status: bestStandalone.ownership_status,
            release_date: bestStandalone.release_date,
            disc_label: spec.discLabel,
            is_companion_base_disc: true,
            companion_game_id: bestStandalone.id,
            companion_game_title: spec.standaloneDisplayTitle,
          });
        }
      } else {
        // For concrete discs already inside game.releases, attach a link to the standalone game release
        for (const rel of game.releases) {
          if (matchesBoxSetDiscSpec(rel, spec)) {
            rel['companion_game_id'] = bestStandalone.id;
            rel['companion_game_title'] = spec.standaloneDisplayTitle;
          }
        }
      }
    }

    // Sort box set discs sequentially by Disc number (Disc 1, Disc 2, Disc 3, ...)
    const extractDiscOrder = (label: unknown): number => {
      const m = String(label || '').match(
        /^(?:disc|disco|disque|disk)\s+(\d+)/i,
      );
      return m ? parseInt(m[1], 10) : 99;
    };
    game.releases.sort(
      (a, b) =>
        extractDiscOrder(a['disc_label']) - extractDiscOrder(b['disc_label']),
    );
  }

  // 4. Check if this release is the Superseded (Original) side of a SupersededReleasePair (Case 2)
  const sharedLinks: SharedBackupReleaseLink[] = [];
  for (const pair of SUPERSEDED_RELEASE_PAIRS) {
    if (pair.platformId !== game.platform_id) continue;

    const isOriginalMatch =
      ((pair.originalStableId !== undefined &&
        pair.originalStableId === game.stable_id) ||
        normRomTitle === pair.originalNormalizedTitle ||
        normGameTitle === pair.originalNormalizedTitle) &&
      (!pair.supersetRomMarker || !romLower.includes(pair.supersetRomMarker)) &&
      (!pair.originalExcludeMarker ||
        !romLower.includes(pair.originalExcludeMarker));

    if (!isOriginalMatch) continue;
    if (
      pair.excludedRegions?.some((ex) => regTokens.includes(ex)) ||
      !regTokens.some((r) => pair.applicableRegions.includes(r))
    ) {
      continue;
    }

    // Find all matching superseding (GOTY/expanded) releases on the platform that share this Disc 1
    const supersetMatches = platformReleases.filter((cand) => {
      if (cand.id === game.id) return false;
      const candRomLower = (cand.rom_name || '').toLowerCase();
      const candNorm = normalizeForLabelMatch(cand.rom_name || cand.game_title);
      const isSupersetCand =
        (pair.supersetStableId !== undefined &&
          cand.game_id === pair.supersetStableId &&
          (!pair.supersetRomMarker ||
            candRomLower.includes(pair.supersetRomMarker))) ||
        candNorm === pair.supersetNormalizedTitle ||
        (pair.supersetRomMarker &&
          candNorm === pair.originalNormalizedTitle &&
          candRomLower.includes(pair.supersetRomMarker));
      if (!isSupersetCand) return false;
      if (
        pair.excludedRegions?.some((ex) =>
          (cand.region || '').toLowerCase().includes(ex),
        )
      ) {
        return false;
      }
      return regionsOverlap(game.region, cand.region);
    });

    for (const sup of supersetMatches) {
      if (!sharedLinks.some((s) => s.id === sup.id)) {
        sharedLinks.push({
          id: sup.id,
          title: pair.supersetDisplayTitle || sup.game_title,
          region: sup.region,
          variants: sup.variants,
          rom_name: sup.rom_name,
          ownership_status: sup.ownership_status,
          backup_status: sup.backup_status,
        });
      }
    }
  }

  // 5. Check if this standalone game is included in any Multi-Game Box Set in BOX_SET_DEFINITIONS
  for (const boxSet of BOX_SET_DEFINITIONS) {
    if (boxSet.platformId !== game.platform_id) continue;
    if (normGameTitle === boxSet.boxSetNormTitle) continue;

    const matchingSpec = boxSet.discs.find(
      (d) =>
        d.standaloneNormTitle === normGameTitle ||
        d.standaloneNormTitle === normRomTitle,
    );
    if (!matchingSpec) continue;

    const boxSetMatches = platformReleases.filter((cand) => {
      if (cand.id === game.id) return false;
      if (normalizeForLabelMatch(cand.game_title) !== boxSet.boxSetNormTitle) {
        return false;
      }
      return regionsOverlap(game.region, cand.region);
    });

    if (boxSetMatches.length > 0) {
      // Group by (game_id, region) and prefer the disc row whose rom_name matches this standalone game
      const byRegion = new Map<string, CompanionDiscCandidateRow>();
      for (const cand of boxSetMatches) {
        const regKey = `${cand.game_id}::${(cand.region || '').toLowerCase()}`;
        const existing = byRegion.get(regKey);
        const candMatchesStandalone = matchesBoxSetDiscSpec(
          cand as unknown as Record<string, unknown>,
          matchingSpec,
        );
        if (!existing || candMatchesStandalone) {
          byRegion.set(regKey, cand);
        }
      }

      for (const boxCand of byRegion.values()) {
        if (!sharedLinks.some((s) => s.id === boxCand.id)) {
          sharedLinks.push({
            id: boxCand.id,
            title: boxSet.boxSetDisplayTitle,
            region: boxCand.region,
            variants: boxCand.variants,
            rom_name: boxCand.rom_name,
            ownership_status: boxCand.ownership_status,
            backup_status: boxCand.backup_status,
          });
        }
      }
    }
  }

  if (sharedLinks.length > 0) {
    game.shared_backup_releases = sharedLinks;
  }

  // 6. Check if this release is a Physical Parent in CANONICAL_VOUCHER_BUNDLES
  const voucherNotes: string[] = [];
  for (const bundle of CANONICAL_VOUCHER_BUNDLES) {
    if (bundle.platformId !== game.platform_id) continue;
    const isParentMatch =
      normGameTitle === bundle.parentNormalizedTitle ||
      normRomTitle === bundle.parentNormalizedTitle ||
      (bundle.aliases &&
        (bundle.aliases.includes(normGameTitle) ||
          bundle.aliases.includes(normRomTitle)));
    if (isParentMatch) {
      voucherNotes.push(bundle.note);
    }
  }
  if (voucherNotes.length > 0) {
    game.voucher_notes = voucherNotes;
  }
}

/** Backward-compatible export alias */
export { enrichGameDetailWithCompanionsAndVouchers as enrichGameDetailWithCompanionDiscs };

// Map of database platform display names to IGDB platform IDs
export const PLATFORM_MAP: Record<string, number> = {
  '3DO Interactive Multiplayer': 50,
  'Atari 2600': 59,
  'Atari Video Computer System': 59,
  'Atari 5200': 66,
  'Atari 5200 SuperSystem': 66,
  'Atari 7800': 60,
  'Atari 7800 ProSystem': 60,
  'Atari Lynx': 61,
  'Atari Jaguar': 62,
  ColecoVision: 68,
  Intellivision: 67,
  'Neo Geo Pocket Color': 120,
  'Nintendo Entertainment System': 18,
  'Game Boy': 33,
  'Super Nintendo Entertainment System': 19,
  'Super Famicom': 58,
  'Virtual Boy': 87,
  'Nintendo 64': 4,
  'Nintendo 64DD': 416,
  'Game Boy Color': 22,
  'Game Boy Advance': 24,
  'Nintendo GameCube': 21,
  'Nintendo DS': 20,
  Wii: 5,
  'Nintendo 3DS': 37,
  'Wii U': 41,
  'New Nintendo 3DS': 137,
  'Nintendo Switch': 130,
  'Nintendo Switch 2': 508,
  PlayStation: 7,
  'PlayStation 2': 8,
  'PlayStation Portable': 38,
  'PlayStation 3': 9,
  'PlayStation Vita': 46,
  'PlayStation 4': 48,
  'PlayStation 5': 167,
  'Sega Master System': 64,
  'Sega Genesis': 29,
  'Sega Game Gear': 35,
  'Game Gear': 35,
  'Sega CD': 78,
  'Sega 32X': 30,
  'Sega Saturn': 32,
  Dreamcast: 23,
  'TurboGrafx-16': 86,
  'TurboGrafx 16': 86,
  Xbox: 11,
  'Xbox 360': 12,
  'Xbox One': 49,
  'Xbox Series X': 169,
  'Game.com': 379,
  'Neo Geo AES': 80,
  'Neo Geo Advanced Entertainment System': 80,
  'Neo Geo CD': 136,
  'Neo Geo X': 377,
  'Philips CD-i': 117,
  'Sega Pico': 339,
  'TurboGrafx-CD': 150,
  'TurboGrafx CD': 150,
  'PlayStation VR': 165,
  'PlayStation VR2': 390,
  Famicom: 99,
  'Family Computer': 99,
  'Famicom Disk System': 51,
  'Family Computer Disk System': 51,
};

const IGDB_LOCALIZATION_REGION_IDS: Record<string, number[]> = {
  NA: [1, 8],
  USA: [1, 8],
  US: [1, 8],
  'North America': [1, 8],
  Canada: [1, 8],
  JP: [3, 7, 8],
  Japan: [3, 7, 8],
  Asia: [7, 3, 8],
  EU: [4, 8],
  Europe: [4, 8],
  UK: [4, 8],
  Germany: [4, 8],
  France: [4, 8],
  Spain: [4, 8],
  Italy: [4, 8],
  AU: [5, 4, 8],
  Australia: [5, 4, 8],
  Korea: [2, 7, 8],
  World: [1, 4, 3, 8],
};

function formatCoverUrl(rawUrl?: string | null): string | null {
  if (!rawUrl) return null;
  const replaced = rawUrl.replace('t_thumb', 't_cover_big');
  return replaced.startsWith('http') ? replaced : `https:${replaced}`;
}

export function resolveRegionalCoverUrl(
  game: {
    cover?: { url?: string | null };
    game_localizations?: Array<{
      name?: string;
      region?: number;
      cover?: { url?: string | null };
    }>;
  },
  regionStr?: string | null,
): string | null {
  const defaultCover = formatCoverUrl(game.cover?.url);
  if (
    !regionStr ||
    !game.game_localizations ||
    game.game_localizations.length === 0
  ) {
    return defaultCover;
  }

  const parts = regionStr
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of parts) {
    const candidateRegionIds =
      IGDB_LOCALIZATION_REGION_IDS[part] ||
      IGDB_LOCALIZATION_REGION_IDS[part.toUpperCase()];
    if (!candidateRegionIds) continue;

    for (const regId of candidateRegionIds) {
      const loc = game.game_localizations.find(
        (l) => l.region === regId && l.cover?.url,
      );
      if (loc?.cover?.url) {
        return formatCoverUrl(loc.cover.url);
      }
    }
  }

  return defaultCover;
}

export const OFFICIAL_IGDB_CATEGORIES = [
  0,
  3,
  8,
  9,
  10,
  11,
  13,
  14,
  undefined,
  null,
];

export const IGDB_HACK_KEYWORDS = [
  ' hack:',
  ' hack)',
  ' hack!',
  ' hack\n',
  'level hack',
  'fan translation',
  'patched version',
  'fan-made',
  'fanmade',
  'fan project',
  'unofficial',
  'rom hack',
  'romhack',
  ' graphics mod ',
  ' graphics mod:',
  ' a mod for ',
  ' this mod ',
  ' modded ',
  ' mod:',
  ' mod)',
];

/**
 * Checks whether an IGDB game object represents an official release rather than
 * a ROM hack, fan modification, or fan game fork.
 */
export function isOfficialIGDBGame(game: {
  name?: string | null;
  summary?: string | null;
  category?: number;
  game_type?: number;
}): boolean {
  const cat = game.game_type ?? game.category;
  if (cat === 5 || cat === 12) return false;
  if (!OFFICIAL_IGDB_CATEGORIES.includes(cat)) return false;

  const lowerName = (game.name || '').toLowerCase();
  const lowerSummary = (game.summary || '').toLowerCase();
  const isHack = IGDB_HACK_KEYWORDS.some(
    (kw) => lowerName.includes(kw) || lowerSummary.includes(kw),
  );
  if (isHack) return false;

  return true;
}
