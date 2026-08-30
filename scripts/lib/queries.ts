/**
 * SHARED SQL QUERIES
 *
 * These templates are used by both the Cloudflare Worker (D1) and the
 * Local API Server (better-sqlite3). Centralizing these prevents
 * logic drift between production and development environments.
 */

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
           g.image_url,
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
           (SELECT COUNT(*) FROM games bg WHERE bg.bundle_parent_id = g.stable_id) as bundle_count,
           COALESCE(r.ownership_status, 0) as ownership_status,
           COALESCE(r.region, g.region) as region,
           r.variants,
           r.rom_name,
           r.rom_crc,
           COALESCE(r.backup_status, 0) as backup_status,
           COALESCE(pp.display_name, p.display_name) as display_name, 
           COALESCE(pp.brand, p.brand) as brand, 
           COALESCE(pp.launch_date, p.launch_date) as platform_launch_date, 
           COALESCE(pp.image_url, p.image_url) as platform_logo,
           p.parent_platform_id
    FROM games g 
    LEFT JOIN game_releases r ON g.stable_id = r.game_id
    LEFT JOIN platforms p ON g.platform_id = p.id
    LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
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
           g.image_url,
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
           (SELECT COUNT(*) FROM games bg WHERE bg.bundle_parent_id = g.stable_id) as bundle_count,
           COALESCE(r.ownership_status, 0) as ownership_status,
           COALESCE(r.region, g.region) as region,
           r.variants,
           r.rom_name,
           r.rom_crc,
           COALESCE(r.backup_status, 0) as backup_status,
           COALESCE(pp.display_name, p.display_name) as display_name, 
           COALESCE(pp.brand, p.brand) as brand, 
           COALESCE(pp.launch_date, p.launch_date) as platform_launch_date, 
           COALESCE(pp.image_url, p.image_url) as platform_logo,
           p.parent_platform_id
    FROM games g 
    LEFT JOIN game_releases r ON g.stable_id = r.game_id
    LEFT JOIN platforms p ON g.platform_id = p.id 
    LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
    WHERE r.id = ? OR (r.id IS NULL AND g.id = ?)
`;

export const GAME_RELEASES_BY_GAME_ID_QUERY = `
    SELECT id, game_id, region, variants, rom_name, rom_crc, backup_status, ownership_status, release_date
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
    WHERE EXISTS (
        SELECT 1 FROM games g 
        WHERE g.platform_id = p.id 
        OR g.platform_id IN (SELECT id FROM platforms WHERE parent_platform_id = p.id)
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
 * Checks if the filename contains a disc indicator (e.g. "Disc 1", "(Disc A)").
 */
export function hasDiscIndicator(filename: string | null | undefined): boolean {
  if (!filename) {
    return false;
  }
  const discRegex =
    /[-_\s]*\(?Disc\s+[a-zA-Z0-9]+(?:\s+of\s+[0-9]+|\s*[/\\\\]\s*[0-9]+)?\)?/i;
  return discRegex.test(filename);
}

/**
 * Strips disc-specific markers and file extensions from a ROM filename.
 */
export function stripDiscIndicator(
  filename: string | null | undefined,
): string {
  if (!filename) {
    return '';
  }

  // Extract base name without file extension (if any)
  const lastDot = filename.lastIndexOf('.');
  let base = lastDot !== -1 ? filename.slice(0, lastDot) : filename;

  // Regex to match and strip typical disc indicators (e.g. "Disc 1", "(Disc A)", etc.)
  base = base.replace(
    /[-_\s]*\(?Disc\s+[a-zA-Z0-9]+(?:\s+of\s+[0-9]+|\s*[/\\\\]\s*[0-9]+)?\)?/gi,
    '',
  );

  // Strip Japanese parenthetical counting indicators (e.g. "Ichi", "Ni" etc.) when used alongside or as disc indicators
  base = base.replace(/[-_\s]*\((?:ichi|ni|san|yon|shi|go)\)/gi, '');

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
  if (hasDiscIndicator(filename)) {
    return `multi:${stripDiscIndicator(filename)}`;
  }
  // For single-disc releases, group only by exact filename (without extension)
  const lastDot = filename.lastIndexOf('.');
  const base = lastDot !== -1 ? filename.slice(0, lastDot) : filename;
  return `single:${base.toLowerCase()}`;
}

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
  ColecoVision: 67,
  Intellivision: 68,
  'Neo Geo Pocket Color': 120,
  'Nintendo Entertainment System': 18,
  'Game Boy': 33,
  'Super Nintendo Entertainment System': 19,
  'Virtual Boy': 87,
  'Nintendo 64': 4,
  'Game Boy Color': 22,
  'Game Boy Advance': 24,
  'Nintendo GameCube': 21,
  'Nintendo DS': 20,
  Wii: 5,
  'Nintendo 3DS': 37,
  'Wii U': 41,
  'New Nintendo 3DS': 137,
  'Nintendo Switch': 130,
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
  'Neo Geo X': 80,
  'Philips CD-i': 117,
  'Sega Pico': 339,
  'TurboGrafx-CD': 150,
  'TurboGrafx CD': 150,
  'PlayStation VR': 165,
  'PlayStation VR2': 390,
  Famicom: 18,
  'Nintendo Switch 2': 130,
};
