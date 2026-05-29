/**
 * GAME COLLECTION RECONCILIATION & DISCOVERY ENGINE
 *
 * This script is the backbone of the collection's metadata integrity. It performs
 * a multi-tier search to reconcile local entries with IGDB and web sources.
 *
 * ARCHITECTURAL DESIGN:
 * 1. **Multi-Tier Search Strategy**:
 *    - **Phase 1: Platform-Locked IGDB Search**: Attempts to find an exact match
 *      on the specific platform. High-confidence (100%) matches are auto-applied.
 *    - **Phase 2: Global IGDB Search**: If Phase 1 fails, searches across all
 *      platforms. Useful for identifying items accidentally logged on the wrong platform.
 *    - **Phase 3: Web Scraping Fallback**: If IGDB is missing data (common for
 *      niche or regional variants), it falls back to PriceCharting and PS Store.
 * 2. **Discovery Mechanism**:
 *    - When run with `--discovery`, it analyzes the series/franchises owned by
 *      the user and identifies missing canonical entries to populate the 'Wanted' list.
 * 3. **Programmatic Reconciliation**:
 *    - Items with ambiguous matches (confidence < 100) are offloaded to a
 *      `discovery_report.md` which serves as the data source for the
 *      Discovery page in the local development UI.
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import {
  findGame,
  getGameById,
  getGamesByIds,
  NormalizedGame,
  IGDBGame,
  calculateConfidence,
} from './lib/igdb.js';
import {
  scrapePriceCharting,
  scrapePlayStationStore,
} from './lib/web_scraper.js';
import { getAmiiboSeries, Toy } from './lib/toys.js';
import { recomputeCanonicalSeries } from './compute_canonical_series.js';
import axios from 'axios';
import { parseDatFile } from './lib/dat_parser.js';
import * as path from 'path';
import {
  titlesMatch,
  normalizeTitleForMatching,
} from './lib/title_matching.js';

const db = new Database('collection.sqlite');
const checkReleaseExistsStmt = db.prepare(
  'SELECT 1 FROM game_releases WHERE id = ?',
);

interface GameRecord {
  id: string;
  stable_id: number;
  title: string;
  platform: string;
  platform_id: number;
  platform_igdb_id: number;
  platform_display_name: string;
  region?: string | null;
  image_url?: string;
  summary?: string;
  series?: string;
  igdb_id?: string;
  igdb_url?: string | null;
  genres?: string;
  collections?: string;
  franchises?: string;
  release_date?: string;
  sort_index?: number;
  play_status?: number;
  backup_status?: number;
  canonical_series?: string;
  manually_verified?: number;
  metadata_json?: string;
  ownership_status?: number;
  rom_name?: string | null;
  rom_crc?: string | null;
  variants?: string | null;
}

interface ToySuggestion {
  id: string;
  name: string;
  platform: string;
  image_url: string | null;
  summary: string;
  category: string;
}

interface SyncSuggestion {
  type: 'Game' | 'Toy';
  current: string;
  options: (NormalizedGame | ToySuggestion)[];
  localId: number | string;
}

interface UnmatchedItem {
  item: GameRecord;
  suggestions: NormalizedGame[] | null;
}

interface GameDiscovery {
  series: string;
  games: IGDBGame[];
}

interface ToyDiscovery {
  series: string;
  items: Toy[];
}

interface UpdateChange {
  id: string | number;
  title: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

const slugify = (s: string) =>
  (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * UTILITY: superNormalize
 *
 * Aggressively standardizes strings for cross-source matching by removing
 * all non-alphanumeric characters.
 */
function superNormalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

interface PlatformRecord {
  id: number;
  name: string;
  display_name: string;
}

/**
 * Resolves platform ID to an array of platform IDs that are scanned symmetrically.
 * Specifically, NES (13) and Famicom (53) are mapped together so cross-region
 * titles match correctly.
 *
 * @param platformId The database platform ID.
 * @returns Array of symmetrical platform IDs.
 */
function getScannedPlatformIds(platformId: number): number[] {
  if (platformId === 13 || platformId === 53) {
    return [13, 53];
  }
  return [platformId];
}

/**
 * Matches a platform name from a DAT file header to a database platform definition.
 *
 * @param datPlatformName The platform name from the DAT header.
 * @param dbPlatforms All platform records from the database.
 * @returns The matched platform record, or null.
 */
function findDbPlatform(
  datPlatformName: string,
  dbPlatforms: PlatformRecord[],
): PlatformRecord | null {
  const clean = (s: string) => {
    return s
      .toLowerCase()
      .replace(
        /\b(nintendo|sony|sega|microsoft|philips|atari|tiger|snk|nec)\b/gi,
        '',
      )
      .replace(/[^a-z0-9]/g, '');
  };

  const datClean = clean(datPlatformName);
  const lowerDat = datPlatformName.toLowerCase();

  // 1. Check explicit fallbacks first to catch specific cases.
  // Sort fallbacks by length descending to check longer substrings first (e.g. SNES before NES).
  const fallbacks: Record<string, string> = {
    'pc engine cd & turbografx cd': 'turbografx cd',
    'pc engine cd': 'turbografx cd',
    'turbografx cd': 'turbografx cd',
    'mega cd': 'sega cd',
    'sega cd': 'sega cd',
    'pc engine': 'turbografx-16',
    turbografx: 'turbografx-16',
    'super nintendo entertainment system':
      'super nintendo entertainment system',
    'nintendo entertainment system': 'nintendo entertainment system',
    megadrive: 'genesis',
    'mega drive': 'genesis',
    genesis: 'genesis',
    gameboy: 'game boy',
    'game boy color': 'game boy color',
    'game boy advance': 'game boy advance',
    'nintendo 64': 'nintendo 64',
    'nintendo ds': 'nintendo ds',
    'playstation vita': 'playstation vita',
    'playstation portable': 'playstation portable',
    'playstation 5': 'playstation 5',
    'playstation 4': 'playstation 4',
    'playstation 3': 'playstation 3',
    'playstation 2': 'playstation 2',
    playstation: 'playstation',
    gamecube: 'gamecube',
    'wii u': 'wii u',
    wii: 'wii',
    saturn: 'saturn',
    '3do': '3do',
    dreamcast: 'dreamcast',
    'new nintendo 3ds': 'new nintendo 3ds',
    'new 3ds': 'new nintendo 3ds',
    '3ds': '3ds',
    'game gear': 'game gear',
    '32x': '32x',
    lynx: 'lynx',
    'jaguar cd': 'atari jaguar cd',
    jaguar: 'jaguar',
  };

  const sortedFallbackKeys = Object.keys(fallbacks).sort(
    (a, b) => b.length - a.length,
  );

  for (const key of sortedFallbackKeys) {
    const dbVal = fallbacks[key];
    if (lowerDat.includes(key)) {
      const matched = dbPlatforms.find((p) =>
        (p.display_name || p.name).toLowerCase().includes(dbVal),
      );
      if (matched) return matched;
    }
  }

  // 2. Try exact cleaned match
  for (const p of dbPlatforms) {
    const pClean = clean(p.display_name || p.name);
    if (pClean === datClean) {
      return p;
    }
  }

  // 3. Try substring match, but sort platforms by clean name length descending
  // so that longer names (like "xbox360", "xboxone") match before shorter names (like "xbox")
  const sortedPlatforms = [...dbPlatforms].sort((a, b) => {
    const cleanA = clean(a.display_name || a.name);
    const cleanB = clean(b.display_name || b.name);
    return cleanB.length - cleanA.length;
  });

  for (const p of sortedPlatforms) {
    const pClean = clean(p.display_name || p.name);
    // Ignore extremely short clean names (like "ds", "cd") for contains matching to avoid false matches
    if (pClean.length > 2) {
      if (datClean.includes(pClean) || pClean.includes(datClean)) {
        return p;
      }
    }
  }

  return null;
}

/**
 * Extracts and maps region names from a game or release title (typically within parentheses).
 * Maps common variants (including "hong kong" and "hongkong") to standardized region names.
 *
 * @param name The game or release title containing regional indicators.
 * @returns A comma-separated list of standardized regions (e.g. "USA, Europe"), or null if no regions are found.
 */
function extractRegions(name: string): string | null {
  const regionsMap: Record<string, string> = {
    usa: 'USA',
    europe: 'Europe',
    japan: 'Japan',
    world: 'World',
    asia: 'Asia',
    france: 'France',
    germany: 'Germany',
    australia: 'Australia',
    uk: 'UK',
    canada: 'Canada',
    korea: 'Korea',
    brazil: 'Brazil',
    spain: 'Spain',
    italy: 'Italy',
    netherlands: 'Netherlands',
    sweden: 'Sweden',
    russia: 'Russia',
    china: 'China',
    taiwan: 'Taiwan',
    portugal: 'Portugal',
    denmark: 'Denmark',
    norway: 'Norway',
    finland: 'Finland',
    'hong kong': 'Hong Kong',
    hongkong: 'Hong Kong',
  };

  const found: string[] = [];
  const parentheticalMatches = name.match(/\(([^)]+)\)/g);
  if (parentheticalMatches) {
    for (const match of parentheticalMatches) {
      const content = match.slice(1, -1);
      const parts = content.split(/[\s,]+/);
      for (const part of parts) {
        const cleanPart = part.trim().toLowerCase();
        if (regionsMap[cleanPart]) {
          const mapped = regionsMap[cleanPart];
          if (!found.includes(mapped)) {
            found.push(mapped);
          }
        }
      }
    }
  }
  return found.length > 0 ? found.join(', ') : null;
}

function isRegionOrLanguageOrDisc(content: string): boolean {
  const normalized = content.toLowerCase().trim();

  // 1. Check if it is a disc or side indicator
  const discRegex =
    /^(?:disc|side)\s+[a-zA-Z0-9]+(?:\s+of\s+[0-9]+|\s*[/\\\\]\s*[0-9]+)?$/i;
  if (discRegex.test(normalized)) {
    return true;
  }

  // 2. Check if it consists entirely of regions or languages
  const regions = new Set([
    'usa',
    'europe',
    'japan',
    'world',
    'asia',
    'france',
    'germany',
    'australia',
    'uk',
    'canada',
    'korea',
    'brazil',
    'spain',
    'italy',
    'netherlands',
    'sweden',
    'russia',
    'china',
    'taiwan',
    'portugal',
    'denmark',
    'norway',
    'finland',
    'hong kong',
    'hongkong',
    'latam',
    'nz',
    'new zealand',
  ]);

  const languages = new Set([
    'en',
    'fr',
    'de',
    'es',
    'it',
    'nl',
    'pt',
    'sv',
    'no',
    'da',
    'fi',
    'pl',
    'ru',
    'ja',
    'zh',
    'ko',
    'el',
    'tr',
    'uk',
    'ar',
    'he',
    'th',
    'vi',
    'm1',
    'm2',
    'm3',
    'm4',
    'm5',
    'm6',
    'm7',
    'm8',
    'm9',
    'multi1',
    'multi2',
    'multi3',
    'multi4',
    'multi5',
    'multi6',
    'multi7',
    'multi8',
    'multi9',
    'english',
    'french',
    'german',
    'spanish',
    'italian',
    'dutch',
    'portuguese',
    'swedish',
    'norwegian',
    'danish',
    'finnish',
    'polish',
    'russian',
    'japanese',
    'chinese',
    'korean',
  ]);

  const parts = normalized.split(/[\s,/\-\\+]+/);
  return parts.every((part) => {
    const p = part.trim();
    if (!p) return true;
    return regions.has(p) || languages.has(p);
  });
}

function extractVariants(name: string): string | null {
  const found: string[] = [];
  const parentheticalMatches = name.match(/\(([^)]+)\)/g);
  if (parentheticalMatches) {
    for (const match of parentheticalMatches) {
      const content = match.slice(1, -1).trim();

      if (!isRegionOrLanguageOrDisc(content)) {
        if (!found.includes(content)) {
          found.push(content);
        }
      }
    }
  }
  return found.length > 0 ? found.join(', ') : null;
}

/**
 * Evaluates whether a release or ROM should be ignored based on file format,
 * digital platform markers, or platform-specific constraints (e.g. Vita .psv).
 *
 * @param releaseName The clean release title.
 * @param romName The ROM filename.
 * @param platformId The platform ID.
 * @returns True if the release should be ignored, false otherwise.
 */
function isIgnoredFormatRelease(
  releaseName: string,
  romName: string,
  platformId?: number,
): boolean {
  const romLower = romName.toLowerCase();
  const relLower = releaseName.toLowerCase();
  const ext = path.extname(romLower);

  // 1. Unwanted file extensions (global or platform-specific)
  const badExtensions = [
    '.tmd',
    '.tik',
    '.cert',
    '.app',
    '.cetk',
    '.pkg',
    '.unh',
  ];
  if (badExtensions.includes(ext)) return true;

  // For PS Vita (ID: 33), strictly only allow physical .psv card backups
  if (platformId === 33 && ext !== '.psv') {
    return true;
  }

  // 2. Numeric-only rom names or starting with tmd. (common in Wii/Wii U updates)
  if (romLower.startsWith('tmd.')) return true;
  const nameWithoutExt = path.parse(romLower).name;
  if (/^\d+(\.\d+)*$/.test(romLower) || /^\d+(\.\d+)*$/.test(nameWithoutExt)) {
    return true;
  }

  // 3. Substring indicators for digital platforms, DLC, updates, virtual console, or emulator-wrapped mini-compilations
  const ignoredIndicators = [
    '(psn)',
    '(xbla)',
    '(eshop)',
    '(wiiware)',
    '(minis)',
    '(dlc)',
    '(update)',
    '(virtual console)',
    '(sega genesis mini)',
    '(mega drive mini)',
    '(nintendo classic mini)',
    '(classic mini)',
    '(anniversary collection)',
    '(evercade)',
  ];
  if (
    ignoredIndicators.some(
      (indicator) =>
        relLower.includes(indicator) || romLower.includes(indicator),
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Recursively scans a directory and retrieves all file paths.
 *
 * @param dir Path to the directory.
 * @returns An array of absolute file paths found.
 */
function getFilesRecursive(dir: string): string[] {
  let results: string[] = [];
  try {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat && stat.isDirectory()) {
        results = results.concat(getFilesRecursive(fullPath));
      } else {
        results.push(fullPath);
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${dir}:`, err);
  }
  return results;
}

/**
 * Scans the 'dats' directory for XML files, parses them as No-Intro/Redump DATs,
 * maps them to platforms, and reconciles DAT releases with database games.
 * For the first match of a game, updates the existing record's rom_name/rom_crc (if null).
 * For subsequent matches of a game, duplicates the record with ownership/backup status set to 0.
 *
 * This function enforces a clean rebuild by migrating user statuses to default releases,
 * wiping existing physical releases, and rebuilding them from the DAT files.
 *
 * @returns A Promise that resolves when the DAT sync is complete.
 * @throws Error if the 'dats' directory cannot be read or database operations fail.
 */
async function syncDats(): Promise<void> {
  const datsDir = path.resolve(process.cwd(), 'dats');
  if (!fs.existsSync(datsDir)) {
    console.log(`dats directory not found at ${datsDir}. Creating it.`);
    fs.mkdirSync(datsDir, { recursive: true });
    return;
  }

  const allFiles = getFilesRecursive(datsDir);
  const datFiles = allFiles.filter((f) => {
    const ext = path.extname(f).toLowerCase();
    const isDat = ext === '.xml' || ext === '.dat';
    if (!isDat) return false;
    const base = path.basename(f).toLowerCase();
    const skipMarkers = [
      '(digital)',
      '(cdn)',
      '(updates)',
      '(dlc)',
      '(eshop)',
      '(development kit hard drives)',
      '(dlc and updates)',
      '(byteswapped)',
      '(psn)',
      '(xbla)',
      '(wiiware)',
      '(minis)',
      '(evercade)',
    ];
    if (skipMarkers.some((marker) => base.includes(marker))) return false;
    return true;
  });

  if (datFiles.length === 0) {
    console.log('No DAT files (.xml or .dat) found in the dats directory.');
    return;
  }

  // Load all platforms from the database to map platforms
  const dbPlatforms = db
    .prepare('SELECT * FROM platforms')
    .all() as PlatformRecord[];

  const syncedReleaseIds = new Set<string>();
  const processedPlatformIds = new Set<number>();

  for (const filePath of datFiles) {
    const fileName = path.basename(filePath);
    console.log(`Parsing DAT file: ${fileName}...`);
    let datContent;
    try {
      datContent = parseDatFile(filePath);
    } catch (err) {
      console.error(`Failed to parse DAT file ${fileName}:`, err);
      continue;
    }

    const platformName = datContent.platformName;
    const dbPlatform = findDbPlatform(platformName, dbPlatforms);

    if (!dbPlatform) {
      console.warn(
        `Could not map DAT platform "${platformName}" to any database platform. Skipping file.`,
      );
      continue;
    }

    console.log(
      `Matched DAT platform "${platformName}" to database platform "${dbPlatform.display_name || dbPlatform.name}" (ID: ${dbPlatform.id})`,
    );

    // Fetch all existing games on this platform (including symmetrical ones, e.g. NES + Famicom)
    const platformIds = getScannedPlatformIds(dbPlatform.id);
    platformIds.forEach((id) => processedPlatformIds.add(id));
    const placeholders = platformIds.map(() => '?').join(',');
    const dbGames = db
      .prepare(`SELECT * FROM games WHERE platform_id IN (${placeholders})`)
      .all(...platformIds) as GameRecord[];

    // Prepare SQLite statements outside the releases loop to eliminate overhead inside the loop
    const existsStmt = db.prepare(`
      SELECT id, region, variants FROM game_releases 
      WHERE game_id IN (SELECT stable_id FROM games WHERE platform_id IN (${placeholders})) AND (rom_name = ? OR (rom_crc = ? AND rom_crc IS NOT NULL))
    `);

    const updateReleaseStmt = db.prepare(`
      UPDATE game_releases 
      SET region = ?, variants = ?
      WHERE id = ?
    `);

    const insertReleaseStmt = db.prepare(`
      INSERT INTO game_releases (
        id, game_id, region, variants, rom_name, rom_crc, backup_status, release_date
      ) VALUES (
        ?, ?, ?, ?, ?, ?, 0, ?
      )
    `);

    let matchedCount = 0;
    let addedCount = 0;

    // Use a transaction for performance and safety during reconciliation
    const transaction = db.transaction(() => {
      for (const release of datContent.releases) {
        // PlayStation Vita platform ID is 33. We prefer physical .psv card backups for this platform,
        // but if no .psv files are present (e.g. for PSN content DATs), we fall back to other extensions,
        // while ignoring .rap license/activation files.
        let roms = release.roms;
        if (dbPlatform.id === 33) {
          const hasPsv = roms.some((r) =>
            r.name.toLowerCase().endsWith('.psv'),
          );
          if (hasPsv) {
            roms = roms.filter((r) => r.name.toLowerCase().endsWith('.psv'));
          } else {
            roms = roms.filter((r) => !r.name.toLowerCase().endsWith('.rap'));
          }
        }
        if (roms.length === 0) continue;

        // Select the primary ROM. For folder-based/decrypted dumps (like Vita/PS3),
        // we search for the main executable (e.g., eboot.bin / EBOOT.BIN) to use as the representative ROM.
        let primaryRom = roms[0];
        const executableRom = roms.find((r) => {
          const nameLower = r.name.toLowerCase();
          return (
            nameLower.endsWith('eboot.bin') ||
            nameLower.endsWith('boot.bin') ||
            nameLower.endsWith('launch.elf') ||
            nameLower.endsWith('default.xex')
          );
        });
        if (executableRom) {
          primaryRom = executableRom;
        }

        const romName = primaryRom.name;
        const romCrc = primaryRom.crc || null;

        // Skip ignored formats, digital files, updates, or Vita non-.psv dumps
        if (isIgnoredFormatRelease(release.name, romName, dbPlatform.id)) {
          continue;
        }

        const regions = extractRegions(release.name);
        const variants = extractVariants(release.name);

        // Idempotency check: does this physical release (rom_name/rom_crc) already exist on this platform(s)?
        const exists = existsStmt.get(...platformIds, romName, romCrc) as
          | { id: string; region: string | null; variants: string | null }
          | undefined;

        if (exists) {
          // Already exists: update its region and variants if they differ from database values
          if (exists.region !== regions || exists.variants !== variants) {
            updateReleaseStmt.run(regions, variants, exists.id);
          }
          syncedReleaseIds.add(exists.id);
          matchedCount++;
          continue;
        }

        // Clean release name (strip region/variant parentheticals for matching)
        let baseTitle = release.name
          .replace(/\s*[([][^\])]*[)\]]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (baseTitle.includes(', The')) {
          baseTitle = 'The ' + baseTitle.replace(', The', '');
        }

        // Find candidate games in the database on this platform that match the title
        const matchingGames = dbGames.filter((g) =>
          titlesMatch(g.title, baseTitle, release.name, dbPlatform.id),
        );

        if (matchingGames.length === 0) {
          // No match in database, skip as we only want to track games the user has in their list
          continue;
        }

        // Helper to calculate the difference score for duplicate matching
        const getDiffScore = (g: GameRecord): number => {
          const normG = normalizeTitleForMatching(g.title);
          const normRelease = normalizeTitleForMatching(baseTitle);
          let diff = Math.abs(normG.length - normRelease.length);

          const brandRegex =
            /^\s*['"]?(disney|sega|nintendo|sony|microsoft|capcom|konami|namco|square enix|square|enix|atari|ubisoft|ea|marvel|sid meiers?|tom clancys?|lego|nickelodeon|lara croft)s?\b/i;
          const gHasBrand = brandRegex.test(g.title);
          const relHasBrand = brandRegex.test(baseTitle);

          if (gHasBrand && !relHasBrand) diff += 1000;
          return diff;
        };

        // Sort matching candidates by difference score
        matchingGames.sort((a, b) => getDiffScore(a) - getDiffScore(b));

        const minScore = getDiffScore(matchingGames[0]);
        // Filter to get all games sharing the minimum title difference score
        const bestGames = matchingGames.filter(
          (g) => getDiffScore(g) === minScore,
        );

        for (const parentGame of bestGames) {
          // Generate a unique id slug
          const baseSlug = `${parentGame.id}-${romCrc || slugify(romName)}`;
          const uniqueId = generateUniqueId(baseSlug);

          insertReleaseStmt.run(
            uniqueId,
            parentGame.stable_id,
            regions,
            variants,
            romName,
            romCrc,
            parentGame.release_date || null,
          );

          syncedReleaseIds.add(uniqueId);
          addedCount++;
        }
      }
    });

    transaction();
    console.log(`Reconciliation finished for ${fileName}:`);
    console.log(`  - Reconciled/Updated: ${matchedCount} release(s)`);
    console.log(`  - Created/Duplicated: ${addedCount} release(s)`);
  }

  // Non-destructive pruning at the end of the sync
  if (processedPlatformIds.size > 0) {
    const processedIdsArr = Array.from(processedPlatformIds);
    const placeholders = processedIdsArr.map(() => '?').join(',');

    // 1. Find all existing physical releases for these processed platforms
    const physicalReleases = db
      .prepare(
        `
      SELECT r.id, r.game_id, r.ownership_status, r.backup_status
      FROM game_releases r
      JOIN games g ON r.game_id = g.stable_id
      WHERE g.platform_id IN (${placeholders}) AND r.id NOT LIKE '%-default'
    `,
      )
      .all(...processedIdsArr) as {
      id: string;
      game_id: number;
      ownership_status: number;
      backup_status: number;
    }[];

    // 2. Identify releases that were not synced in this run
    const staleReleases = physicalReleases.filter(
      (r) => !syncedReleaseIds.has(r.id),
    );
    if (staleReleases.length > 0) {
      console.log(
        `Pruning ${staleReleases.length} stale physical releases for processed platforms...`,
      );

      // Ensure default releases exist first before migrating status to them
      const columns = db.prepare('PRAGMA table_info(games)').all() as {
        name: string;
      }[];
      const hasReleaseDate = columns.some((c) => c.name === 'release_date');

      const allGames = db
        .prepare(
          hasReleaseDate
            ? `SELECT stable_id, region, release_date FROM games WHERE platform_id IN (${placeholders})`
            : `SELECT stable_id, region FROM games WHERE platform_id IN (${placeholders})`,
        )
        .all(...processedIdsArr) as {
        stable_id: number;
        region: string | null;
        release_date?: string | null;
      }[];

      const insertVirtualStmt = db.prepare(`
        INSERT OR IGNORE INTO game_releases (id, game_id, region, variants, rom_name, rom_crc, backup_status, ownership_status, release_date)
        VALUES (?, ?, ?, NULL, NULL, NULL, 0, 0, ?)
      `);

      db.transaction(() => {
        for (const game of allGames) {
          const virtualId = `${game.stable_id}-default`;
          insertVirtualStmt.run(
            virtualId,
            game.stable_id,
            game.region,
            game.release_date || null,
          );
        }
      })();

      // Migrate user statuses to virtual default releases
      const updateVirtualStmt = db.prepare(`
        UPDATE game_releases 
        SET ownership_status = MAX(ownership_status, ?),
            backup_status = MAX(backup_status, ?)
        WHERE id = ?
      `);

      const deleteReleaseStmt = db.prepare(`
        DELETE FROM game_releases WHERE id = ?
      `);

      db.transaction(() => {
        for (const r of staleReleases) {
          if (r.ownership_status > 0 || r.backup_status > 0) {
            const virtualId = `${r.game_id}-default`;
            updateVirtualStmt.run(
              r.ownership_status,
              r.backup_status,
              virtualId,
            );
          }
          deleteReleaseStmt.run(r.id);
        }
      })();
      console.log(
        `Successfully migrated and pruned ${staleReleases.length} stale releases.`,
      );
    }
  }

  // Perform post-processing cleanup and virtual/default release enforcement
  cleanupVirtualReleases(db);
  ensureVirtualReleases(db);
}

/**
 * Generates a unique text ID/slug for a game record by checking for existing collisions in the database.
 * If a collision is found, appends an incrementing numeric suffix.
 *
 * @param baseId The base slug string.
 * @returns A unique slug string guaranteed not to exist in the games table.
 */
function generateUniqueId(baseId: string): string {
  let candidate = baseId;
  let counter = 1;
  while (true) {
    const exists = checkReleaseExistsStmt.get(candidate);
    if (!exists) {
      return candidate;
    }
    candidate = `${baseId}-${counter}`;
    counter++;
  }
}

/**
 * Evaluates whether two region identifier strings match, taking into account
 * regional equivalences (such as North America (NA) and USA/United States).
 *
 * @param reg1 The first region string to check (e.g. from a game record).
 * @param reg2 The second region string to check (e.g. from a release record).
 * @returns True if there is an overlapping matched region (e.g. USA matches NA), false otherwise.
 */
function regionsMatch(reg1: string | null, reg2: string | null): boolean {
  if (!reg1 || !reg2) return false;

  const normalize = (r: string): string[] => {
    return r
      .toLowerCase()
      .split(/[\s,]+/)
      .map((part) => {
        const p = part.trim();
        if (
          p === 'na' ||
          p === 'usa' ||
          p === 'us' ||
          p === 'northamerica' ||
          p === 'north america'
        ) {
          return 'usa';
        }
        if (p === 'jp' || p === 'jpn' || p === 'japan') {
          return 'japan';
        }
        if (p === 'eu' || p === 'eur' || p === 'europe') {
          return 'europe';
        }
        return p;
      })
      .filter(Boolean);
  };

  const parts1 = normalize(reg1);
  const parts2 = normalize(reg2);

  if (parts1.includes('world') || parts2.includes('world')) {
    return true;
  }

  // Return true if any normalized part matches between the two sets
  return parts1.some((p1) => parts2.includes(p1));
}

/**
 * Iterates through all virtual/default releases ('*-default') and migrates their
 * ownership and backup statuses to newly imported physical releases if they exist.
 * The virtual release is deleted afterwards.
 *
 * @param dbInstance The better-sqlite3 database instance.
 */
function cleanupVirtualReleases(dbInstance: Database.Database): void {
  console.log('Running virtual releases cleanup post-processing...');
  const virtualReleases = dbInstance
    .prepare("SELECT * FROM game_releases WHERE id LIKE '%-default'")
    .all() as {
    id: string;
    game_id: number;
    region: string | null;
    ownership_status: number;
    backup_status: number;
  }[];

  let migratedCount = 0;
  for (const vr of virtualReleases) {
    // Find all real, physical releases for the same game
    const realReleases = dbInstance
      .prepare(
        "SELECT * FROM game_releases WHERE game_id = ? AND id NOT LIKE '%-default'",
      )
      .all(vr.game_id) as {
      id: string;
      game_id: number;
      region: string | null;
      variants: string | null;
    }[];

    if (realReleases.length > 0) {
      // Prioritize stable releases over beta/proto/demo variants
      const getPriority = (variants: string | null): number => {
        if (!variants) return 0;
        const lower = variants.toLowerCase();
        if (/\b(beta|proto|prototype|demo|kiosk|sample|promo)\b/i.test(lower)) {
          return 2;
        }
        return 1;
      };
      realReleases.sort(
        (a, b) => getPriority(a.variants) - getPriority(b.variants),
      );

      // Only clean up/migrate if a real release with a matching region is found (or if vr.region is null)
      const game = dbInstance
        .prepare('SELECT region FROM games WHERE stable_id = ?')
        .get(vr.game_id) as { region: string | null } | undefined;
      const gameRegion = game?.region || null;

      const bestRelease = gameRegion
        ? realReleases.find((r) => regionsMatch(r.region, gameRegion))
        : realReleases[0];

      if (bestRelease) {
        // If the virtual release had a set ownership status or backup status, migrate it
        if (vr.ownership_status > 0 || vr.backup_status > 0) {
          dbInstance
            .prepare(
              `
              UPDATE game_releases
              SET ownership_status = MAX(ownership_status, ?),
                  backup_status = MAX(backup_status, ?)
              WHERE id = ?
            `,
            )
            .run(vr.ownership_status, vr.backup_status, bestRelease.id);
          migratedCount++;
        }

        // Delete the virtual release as it is now replaced by real ones
        dbInstance.prepare('DELETE FROM game_releases WHERE id = ?').run(vr.id);
      }
    }
  }
  console.log(
    `Migrated status from ${migratedCount} virtual release(s) to real release(s) and cleaned them up.`,
  );
}

/**
 * Checks all games in the collection and guarantees that every game has at least
 * one entry in `game_releases`. If a game has no physical releases (due to not
 * being present in the DAT files), a virtual default release is created.
 * Also creates a virtual release if a game has releases but none of them match the game's region.
 *
 * @param dbInstance The better-sqlite3 database instance.
 */
/**
 * Resolves regional release dates from IGDB metadata and updates the associated game releases.
 *
 * @param dbInstance The better-sqlite3 database instance.
 * @param gameStableId The stable ID of the game.
 * @param igdbReleaseDates Optional array of regional release dates from IGDB.
 * @param fallbackDate Optional baseline/earliest release date.
 */
function updateReleaseDatesForGameReleases(
  dbInstance: Database.Database,
  gameStableId: number,
  igdbReleaseDates: { region: number; date: number }[] | undefined,
  fallbackDate: string | null | undefined,
): void {
  // Region mapping: we map our text regions in database to IGDB region numbers
  const regionMap: Record<string, number> = {
    EU: 1,
    Europe: 1,
    NA: 2,
    USA: 2,
    US: 2,
    'North America': 2,
    AU: 3,
    Australia: 3,
    NZ: 4,
    'New Zealand': 4,
    JP: 5,
    Japan: 5,
    CH: 6,
    China: 6,
    AS: 7,
    Asia: 7,
    WW: 8,
    Worldwide: 8,
  };

  const releases = dbInstance
    .prepare('SELECT id, region FROM game_releases WHERE game_id = ?')
    .all(gameStableId) as { id: string; region: string | null }[];

  for (const release of releases) {
    let chosenDate: string | null = null;

    if (igdbReleaseDates && igdbReleaseDates.length > 0 && release.region) {
      const releaseRegParts = release.region
        .split(/[\s,]+/)
        .map((p) => p.trim().toLowerCase());

      for (const regText of Object.keys(regionMap)) {
        if (releaseRegParts.includes(regText.toLowerCase())) {
          const igdbRegId = regionMap[regText];
          const matched = igdbReleaseDates.find((d) => d.region === igdbRegId);
          if (matched && matched.date) {
            chosenDate = new Date(matched.date * 1000)
              .toISOString()
              .split('T')[0];
            break;
          }
        }
      }
    }

    if (!chosenDate) {
      chosenDate = fallbackDate || null;
    }

    dbInstance
      .prepare('UPDATE game_releases SET release_date = ? WHERE id = ?')
      .run(chosenDate, release.id);
  }
}

/**
 * Checks all games in the collection and guarantees that every game has at least
 * one entry in `game_releases`. If a game has no physical releases (due to not
 * being present in the DAT files), a virtual default release is created.
 * Also creates a virtual release if a game has releases but none of them match the game's region.
 *
 * @param dbInstance The better-sqlite3 database instance.
 */
function ensureVirtualReleases(dbInstance: Database.Database): void {
  console.log(
    'Creating virtual releases for games without matching region releases...',
  );

  // Check if release_date column exists on games table
  const columns = dbInstance.prepare('PRAGMA table_info(games)').all() as {
    name: string;
  }[];
  const hasReleaseDate = columns.some((c) => c.name === 'release_date');

  const allGames = dbInstance
    .prepare(
      hasReleaseDate
        ? 'SELECT stable_id, id, title, region, release_date FROM games'
        : 'SELECT stable_id, id, title, region FROM games',
    )
    .all() as {
    stable_id: number;
    id: string;
    title: string;
    region: string | null;
    release_date?: string | null;
  }[];

  let createdCount = 0;
  const insertStmt = dbInstance.prepare(`
    INSERT INTO game_releases (id, game_id, region, variants, rom_name, rom_crc, backup_status, ownership_status, release_date)
    VALUES (?, ?, ?, NULL, NULL, NULL, 0, 0, ?)
  `);

  dbInstance.transaction(() => {
    for (const game of allGames) {
      const releases = dbInstance
        .prepare(
          `
        SELECT region FROM game_releases WHERE game_id = ?
      `,
        )
        .all(game.stable_id) as { region: string | null }[];

      let needsVirtual = false;
      if (releases.length === 0) {
        needsVirtual = true;
      } else if (game.region) {
        const hasMatchingRegion = releases.some((r) =>
          regionsMatch(r.region, game.region),
        );
        if (!hasMatchingRegion) {
          needsVirtual = true;
        }
      }

      if (needsVirtual) {
        const virtualId = `${game.stable_id}-default`;
        // Check if virtual release already exists to ensure idempotency
        const exists = dbInstance
          .prepare('SELECT 1 FROM game_releases WHERE id = ?')
          .get(virtualId);
        if (!exists) {
          insertStmt.run(
            virtualId,
            game.stable_id,
            game.region,
            game.release_date || null,
          );
          createdCount++;
        }
      }
    }
  })();
  console.log(
    `Created ${createdCount} virtual/default release(s) for games without matching region releases.`,
  );
}

async function runScraper(): Promise<void> {
  const args = process.argv.slice(2);
  const runDiscovery = args.includes('--discovery');
  const runRefresh = args.includes('--refresh');
  const runRecomputeSeries = args.includes('--recompute-series');
  const runSyncDats = args.includes('--sync-dats');

  if (runSyncDats) {
    console.log('--- Starting DAT Sync Phase ---');
    await syncDats();
    console.log('\n--- Starting Series Recomputation Phase ---');
    await recomputeCanonicalSeries();
    console.log('--- DAT Sync Complete ---');
    return;
  }

  console.log('--- Starting Gagglog Reconciliation Phase ---');
  const unmatchedGames: UnmatchedItem[] = [];
  const syncSuggestions: SyncSuggestion[] = [];
  const updateChanges: UpdateChange[] = [];
  let autoMatchedCount = 0;
  const gameDiscoveryResults: GameDiscovery[] = [];

  // 1. Verify Games (Metadata & Sync checking)
  const existingGames = db
    .prepare(
      `
        SELECT g.*, p.igdb_id as platform_igdb_id, p.display_name as platform_display_name
        FROM games g
        LEFT JOIN platforms p ON g.platform_id = p.id
    `,
    )
    .all() as GameRecord[];

  console.log(`Processing ${existingGames.length} collection items...`);

  const freshCache = new Map<number, NormalizedGame>();
  if (runRefresh) {
    const refreshGamesList = existingGames.filter((g) => g.igdb_id);
    const refreshIds = refreshGamesList.map((g) => Number(g.igdb_id));
    const platformIdMap: Record<number, number> = {};
    for (const g of refreshGamesList) {
      if (g.igdb_id && g.platform_igdb_id) {
        platformIdMap[Number(g.igdb_id)] = g.platform_igdb_id;
      }
    }
    console.log(
      `Pre-fetching metadata for ${refreshIds.length} games in batches of 100...`,
    );
    const freshGames = await getGamesByIds(refreshIds, platformIdMap);
    for (const fg of freshGames) {
      const numericId = Number(fg.id.replace('igdb-', ''));
      freshCache.set(numericId, fg);
    }
  }

  for (const game of existingGames) {
    if (game.igdb_id || game.manually_verified) {
      if (runRefresh && game.igdb_id) {
        process.stdout.write(
          `Refreshing Game: ${game.title} (${game.platform_display_name})... `,
        );
        const fresh =
          freshCache.get(Number(game.igdb_id)) ||
          (await getGameById(Number(game.igdb_id), game.platform_igdb_id));
        if (fresh) {
          const checkField = (
            field: string,
            oldVal: string | number | null | undefined,
            newVal: string | number | null | undefined,
          ) => {
            if (newVal !== undefined && newVal !== oldVal) {
              return true;
            }
            return false;
          };

          checkField('summary', game.summary, fresh.summary);
          checkField('image_url', game.image_url, fresh.image_url);
          checkField('genres', game.genres, fresh.genres);
          checkField('collections', game.collections, fresh.collections);
          checkField('franchises', game.franchises, fresh.franchises);
          checkField('release_date', game.release_date, fresh.release_date);

          // Canonical Slug Check
          let canonicalId = `${slugify(fresh.name)}-${slugify(game.platform_display_name || game.platform)}`;

          // Avoid collisions with other games
          const collision = db
            .prepare(
              'SELECT stable_id FROM games WHERE id = ? AND stable_id != ?',
            )
            .get(canonicalId, game.stable_id);
          if (collision) {
            canonicalId += `-${game.id.split('-').pop()}`; // Fallback to current suffix if possible
          }

          const finalId = canonicalId;
          const finalSummary = fresh.summary || game.summary;
          const finalImageUrl = fresh.image_url || game.image_url;
          const finalGenres = fresh.genres || game.genres;
          const finalCollections = fresh.collections || game.collections;
          const finalFranchises = fresh.franchises || game.franchises;
          const finalReleaseDate = fresh.release_date || game.release_date;
          const finalIgdbUrl = fresh.igdb_url || game.igdb_url;

          const hasActualChanges =
            finalId !== game.id ||
            (fresh.summary !== undefined &&
              fresh.summary !== null &&
              fresh.summary !== game.summary) ||
            (fresh.image_url !== undefined &&
              fresh.image_url !== null &&
              fresh.image_url !== game.image_url) ||
            (fresh.genres !== undefined &&
              fresh.genres !== null &&
              fresh.genres !== game.genres) ||
            (fresh.collections !== undefined &&
              fresh.collections !== null &&
              fresh.collections !== game.collections) ||
            (fresh.franchises !== undefined &&
              fresh.franchises !== null &&
              fresh.franchises !== game.franchises) ||
            (fresh.igdb_url !== undefined &&
              fresh.igdb_url !== null &&
              fresh.igdb_url !== game.igdb_url);

          if (hasActualChanges) {
            db.prepare(
              `
                            UPDATE games 
                            SET id = ?, summary = ?, image_url = ?, genres = ?, collections = ?, franchises = ?, igdb_url = ?
                            WHERE stable_id = ?
                        `,
            ).run(
              finalId,
              finalSummary,
              finalImageUrl,
              finalGenres,
              finalCollections,
              finalFranchises,
              finalIgdbUrl,
              game.stable_id,
            );

            // Only log changes that actually resulted in a different value in the DB
            const actualChanges: UpdateChange[] = [];
            if (finalId !== game.id)
              actualChanges.push({
                id: game.id,
                title: game.title,
                field: 'id',
                oldValue: game.id,
                newValue: finalId,
              });
            if (finalSummary !== game.summary && fresh.summary)
              actualChanges.push({
                id: game.id,
                title: game.title,
                field: 'summary',
                oldValue: String(game.summary),
                newValue: String(finalSummary),
              });
            if (finalImageUrl !== game.image_url && fresh.image_url)
              actualChanges.push({
                id: game.id,
                title: game.title,
                field: 'image_url',
                oldValue: String(game.image_url),
                newValue: String(finalImageUrl),
              });
            if (finalGenres !== game.genres && fresh.genres)
              actualChanges.push({
                id: game.id,
                title: game.title,
                field: 'genres',
                oldValue: String(game.genres),
                newValue: String(finalGenres),
              });
            if (finalCollections !== game.collections && fresh.collections)
              actualChanges.push({
                id: game.id,
                title: game.title,
                field: 'collections',
                oldValue: String(game.collections),
                newValue: String(finalCollections),
              });
            if (finalFranchises !== game.franchises && fresh.franchises)
              actualChanges.push({
                id: game.id,
                title: game.title,
                field: 'franchises',
                oldValue: String(game.franchises),
                newValue: String(finalFranchises),
              });
            if (finalReleaseDate !== game.release_date && fresh.release_date)
              actualChanges.push({
                id: game.id,
                title: game.title,
                field: 'release_date',
                oldValue: String(game.release_date),
                newValue: String(finalReleaseDate),
              });
            if (finalIgdbUrl !== game.igdb_url && fresh.igdb_url)
              actualChanges.push({
                id: game.id,
                title: game.title,
                field: 'igdb_url',
                oldValue: String(game.igdb_url),
                newValue: String(finalIgdbUrl),
              });

            if (actualChanges.length > 0) {
              updateChanges.push(...actualChanges);
              appendUpdateReport(actualChanges);
            }
            console.log('Updated.');
          } else {
            console.log('No changes.');
          }

          updateReleaseDatesForGameReleases(
            db,
            game.stable_id,
            fresh.release_dates,
            finalReleaseDate,
          );
        } else {
          console.log('API Error.');
        }
      } else {
        console.log(
          `Skipping already-verified Game: ${game.title} (${game.platform_display_name})`,
        );
      }
      continue;
    }

    process.stdout.write(
      `Verifying: ${game.title} (${game.platform_display_name})... `,
    );

    // Phase 1: Strict Platform-Locked Match
    const searchTitle = game.title.replace(/\(.*\)/g, '').trim();
    const matches = await findGame(searchTitle, game.platform_igdb_id);

    if (matches && matches.length > 0) {
      const bestMatch = matches[0];

      // In a real scenario, we might want to re-query IGDB for this specific region,
      // but our findGame already fetched release_dates. We just need to prioritize it.
      // NOTE: We'd need to cast to any here because release_dates is not in NormalizedGame,
      // but for now we'll just rely on the default logic or fix findGame to pass it through.
      // For this script, we'll bypass regionalDate logic for now to stay type-safe.
      // For this script, we'll bypass regionalDate logic for now to stay type-safe.

      const confidence = calculateConfidence(
        game.title,
        bestMatch.name,
        bestMatch.category,
      );

      // Title Match Logic - Auto-update if high confidence (100)
      if (confidence === 100) {
        db.prepare(
          `
                    UPDATE games 
                    SET title = ?, igdb_id = ?, igdb_url = ?, region = ?, summary = ?, genres = ?, image_url = ?, played = 0, backed_up = 0, collections = ?, franchises = ?
                    WHERE id = ?
                `,
        ).run(
          bestMatch.name,
          bestMatch.id.replace('igdb-', ''),
          bestMatch.igdb_url,
          bestMatch.region,
          bestMatch.summary || null,
          bestMatch.genres || null,
          bestMatch.image_url,
          bestMatch.collections,
          bestMatch.franchises,
          game.id,
        );

        updateReleaseDatesForGameReleases(
          db,
          game.stable_id,
          bestMatch.release_dates,
          bestMatch.release_date,
        );

        console.log(`  Auto-matched and updated! [ID: ${bestMatch.id}]`);
        autoMatchedCount++;
        continue;
      }

      // If titles don't perfectly match, add to suggestions
      syncSuggestions.push({
        type: 'Game',
        current: `${game.title} (${game.platform_display_name || game.platform})`,
        options: matches.slice(0, 10),
        localId: game.id,
      });
      console.log('Ambiguous.');
    } else {
      process.stdout.write(`No platform match. Global search... `);
      // Phase 2: Global Platform Discovery
      const globalMatches = await findGame(searchTitle, 0);

      if (globalMatches && globalMatches.length > 0) {
        const bestGlobal = globalMatches[0];
        const globalConfidence = calculateConfidence(
          game.title,
          bestGlobal.name,
          bestGlobal.category,
        );

        // If we found a high-confidence match on a DIFFERENT platform, add to syncSuggestions
        // This allows the user to "Update to" this better match (and change platform)
        if (globalConfidence >= 90) {
          syncSuggestions.push({
            type: 'Game',
            current: `${game.title} (${game.platform_display_name || game.platform})`,
            options: globalMatches.slice(0, 10),
            localId: game.id,
          });
          console.log(
            `Potential cross-platform match found [ID: ${bestGlobal.id}]`,
          );
        } else {
          unmatchedGames.push({ item: game, suggestions: globalMatches });
          console.log('Candidates found.');
        }

        // If IGDB confidence is low, try web validation as a better alternative
        if (globalConfidence < 90) {
          const success = await performWebValidation(searchTitle, game);
          if (success) {
            autoMatchedCount++;
            continue;
          }
        }
      } else {
        // Phase 3: Web Validation Fallback
        const success = await performWebValidation(searchTitle, game);
        if (success) {
          autoMatchedCount++;
          continue;
        }

        unmatchedGames.push({ item: game, suggestions: null });
        console.log('No candidates.');
      }
    }
  }

  // 2. Verify Toys
  const existingToys = db.prepare('SELECT * FROM toys').all() as Toy[];
  console.log(`Processing ${existingToys.length} toys...`);

  // Fetch all Amiibos once for efficient matching and discovery
  let allApiAmiibo: Toy[] = [];
  if (
    runDiscovery ||
    existingToys.some((f) => f.line.toLowerCase() === 'amiibo' && !f.verified)
  ) {
    console.log('Fetching master Amiibo list...');
    allApiAmiibo = await getAmiiboSeries();
  }

  for (const toy of existingToys) {
    // Handle Refresh
    if (runRefresh && toy.amiibo_id && toy.verified) {
      process.stdout.write(`Refreshing Toy: ${toy.name}... `);
      try {
        const response = await axios.get(
          `https://amiiboapi.org/api/amiibo/?id=${toy.amiibo_id}`,
        );
        const a = response.data.amiibo;
        if (a) {
          const effectiveSeries =
            a.amiiboSeries === 'Others' ? a.gameSeries : a.amiiboSeries;
          const releaseDate =
            a.release?.na ||
            a.release?.jp ||
            a.release?.eu ||
            a.release?.au ||
            null;
          const region = a.release?.na
            ? 'NA'
            : a.release?.jp
              ? 'JP'
              : a.release?.eu
                ? 'EU'
                : 'AU';

          const checkField = (
            field: string,
            oldVal: string | number | null | undefined,
            newVal: string | number | null | undefined,
          ) => {
            if (newVal !== undefined && newVal !== oldVal) {
              return true;
            }
            return false;
          };

          checkField('image_url', toy.image_url, a.image);
          checkField('series', toy.series, effectiveSeries);
          checkField('type', toy.type, a.type);
          checkField('release_date', toy.release_date, releaseDate);
          checkField('region', toy.region, region);

          // Canonical Slug Check
          let canonicalId = `${slugify(a.name)}-amiibo-${slugify(effectiveSeries)}`;

          // Collision check for toys
          const collision = db
            .prepare(
              'SELECT stable_id FROM toys WHERE id = ? AND stable_id != ?',
            )
            .get(canonicalId, toy.stable_id);
          if (collision) {
            canonicalId += `-${toy.amiibo_id?.substring(0, 8) || toy.id.split('-').pop()}`;
          }

          const finalId = canonicalId;
          const finalImageUrl = a.image || toy.image_url;
          const finalSeries = effectiveSeries || toy.series;
          const finalType = a.type || toy.type;
          const finalReleaseDate = releaseDate || toy.release_date;
          const finalRegion = region || toy.region;
          const finalMetadata = JSON.stringify(a);

          const hasActualChanges =
            finalId !== toy.id ||
            (a.image !== undefined &&
              a.image !== null &&
              a.image !== toy.image_url) ||
            (effectiveSeries !== undefined &&
              effectiveSeries !== null &&
              effectiveSeries !== toy.series) ||
            (a.type !== undefined && a.type !== null && a.type !== toy.type) ||
            (releaseDate !== undefined &&
              releaseDate !== null &&
              releaseDate !== toy.release_date) ||
            (region !== undefined && region !== null && region !== toy.region);

          if (hasActualChanges) {
            db.prepare(
              `
                            UPDATE toys 
                            SET id = ?, image_url = ?, series = ?, type = ?, release_date = ?, region = ?, metadata_json = ?
                            WHERE stable_id = ?
                        `,
            ).run(
              finalId,
              finalImageUrl,
              finalSeries,
              finalType,
              finalReleaseDate,
              finalRegion,
              finalMetadata,
              toy.stable_id,
            );

            const localChanges: UpdateChange[] = [];
            if (finalId !== toy.id)
              localChanges.push({
                id: toy.id,
                title: toy.name,
                field: 'id',
                oldValue: toy.id,
                newValue: finalId,
              });
            if (finalImageUrl !== toy.image_url && a.image)
              localChanges.push({
                id: toy.id,
                title: toy.name,
                field: 'image_url',
                oldValue: String(toy.image_url),
                newValue: String(finalImageUrl),
              });
            if (finalSeries !== toy.series && effectiveSeries)
              localChanges.push({
                id: toy.id,
                title: toy.name,
                field: 'series',
                oldValue: String(toy.series),
                newValue: String(finalSeries),
              });
            if (finalType !== toy.type && a.type)
              localChanges.push({
                id: toy.id,
                title: toy.name,
                field: 'type',
                oldValue: String(toy.type),
                newValue: String(finalType),
              });
            if (finalReleaseDate !== toy.release_date && releaseDate)
              localChanges.push({
                id: toy.id,
                title: toy.name,
                field: 'release_date',
                oldValue: String(toy.release_date),
                newValue: String(finalReleaseDate),
              });
            if (finalRegion !== toy.region && region)
              localChanges.push({
                id: toy.id,
                title: toy.name,
                field: 'region',
                oldValue: String(toy.region),
                newValue: String(finalRegion),
              });

            if (localChanges.length > 0) {
              updateChanges.push(...localChanges);
              appendUpdateReport(localChanges);
            }
            console.log('Updated.');
          } else {
            console.log('No changes.');
          }
        }
      } catch {
        console.log('API Error.');
      }
      continue;
    }

    // Skip if already linked or verified
    if (toy.verified || toy.amiibo_id) continue;

    // Strictly focus on Amiibo sync suggestions as requested
    if (toy.line.toLowerCase() !== 'amiibo') continue;

    process.stdout.write(`Verifying Toy: ${toy.name}... `);

    // Find broad candidates for manual matching
    const normName = superNormalize(toy.name);
    const matches = allApiAmiibo.filter((a) => {
      if (a.type === 'Card') return false; // Explicitly exclude cards as requested
      const aNorm = superNormalize(a.name);
      return aNorm.includes(normName) || normName.includes(aNorm);
    });

    if (matches.length > 0) {
      // Sort by better match (exact normalized match first)
      const sortedMatches = matches.sort((a, b) => {
        const aExact = superNormalize(a.name) === normName;
        const bExact = superNormalize(b.name) === normName;
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        return 0;
      });

      syncSuggestions.push({
        type: 'Toy',
        current: `${toy.name} (amiibo) | Line: ${toy.line} | Series: ${toy.series}`,
        options: sortedMatches.slice(0, 15).map((m) => {
          // Replicating toy_discovery.ts naming: name (effectiveSeries)
          return {
            id: `amiibo-${m.id}`,
            name: `${m.name} (${m.series_name})`,
            platform: 'amiibo',
            image_url: m.image_url,
            summary: `Amiibo Series: ${m.series_name}`,
            category: m.type,
          };
        }),
        localId: toy.id as unknown as number,
      });
      console.log(`${matches.length} candidates found.`);
    } else {
      console.log('No candidates.');
    }
  }

  // const ignoredItems = (db.prepare('SELECT id FROM ignored_items').all() as { id: string }[]).map(i => i.id);
  const toyDiscoveryResults: ToyDiscovery[] = [];

  // 3. Discovery Phase: Series-based
  if (runDiscovery) {
    /* Temporarily disabled until PriceCharting physical verification is implemented
        // Discovery: Games
        const gameSeriesList = db.prepare('SELECT DISTINCT series FROM games WHERE series IS NOT NULL').all() as { series: string }[];
        for (const { series } of gameSeriesList) {
            console.log(`Discovering Games for Series: ${series}...`);
            const searchResults = await findGame(series.replace(/\(.*\)/g, '').trim(), 0) || [];
            const initialMatch = searchResults.length > 0 ? searchResults[0] : null;

            if (initialMatch && initialMatch.id) {
                // Find collection context via original IGDB ID
                const igdbIdNum = Number(initialMatch.id.replace('igdb-', ''));
                const collectionGames = await getCollectionGames(igdbIdNum);
                const missing = [];
                for (const igdbGame of collectionGames) {
                    const igdbId = `igdb-${igdbGame.id}`;
                    if (ignoredItems.includes(igdbId)) continue;
                    const normalizedIgdb = normalizeTitle(igdbGame.name);
                    if (existingGameNorms.includes(normalizedIgdb)) continue;
                    missing.push(igdbGame);
                }
                if (missing.length > 0) {
                    gameDiscoveryResults.push({ series, games: missing });
                }
            }
        }
        */

    // 4. Discovery: amiibo
    if (runDiscovery) {
      console.log('Starting full amiibo discovery pass...');
      const discovered = await discoverAllAmiibo(existingToys);
      if (discovered.length > 0) {
        toyDiscoveryResults.push({
          series: 'amiibo (Auto-Added)',
          items: discovered,
        });
      }
    }
  }

  console.log('\n--- Scrape Summary ---');
  console.log(
    `Manual Entries Processed: ${unmatchedGames.length + syncSuggestions.length + autoMatchedCount}`,
  );
  console.log(`  - Auto-matched: ${autoMatchedCount}`);
  console.log(
    `  - Remaining in Report: ${unmatchedGames.length + syncSuggestions.length}`,
  );
  if (runRefresh) {
    console.log(
      `  - Refreshed Items: ${updateChanges.length} changes detected`,
    );
    console.log('Report generated: update_report.md');
  }
  if (runDiscovery) {
    console.log(
      `Discovery Results: ${gameDiscoveryResults.length} game series, ${toyDiscoveryResults.length} toy series`,
    );
  } else {
    console.log(
      'Discovery phase skipped. Use --discovery to find missing items in your series.',
    );
  }

  generateReport(
    unmatchedGames,
    syncSuggestions,
    gameDiscoveryResults,
    toyDiscoveryResults,
  );

  // 4. Final Phase: Series Recomputation
  if (runRefresh || runRecomputeSeries) {
    console.log('\n--- Starting Series Recomputation Phase ---');
    await recomputeCanonicalSeries();
  }
}

/**
 * UTILITY: discoverAllAmiibo
 */
async function discoverAllAmiibo(existingToys: Toy[]): Promise<Toy[]> {
  console.log('Fetching master amiibo list...');
  const allAmiibo = await getAmiiboSeries();
  const existingAmiiboIds = new Set(
    existingToys.filter((t) => t.line === 'amiibo').map((t) => t.amiibo_id),
  );
  const added: Toy[] = [];

  const insertStmt = db.prepare(`
        INSERT INTO toys (id, name, line, series, type, image_url, amiibo_id, owned, verified, metadata_json, series_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

  const insertSeriesStmt = db.prepare(
    'INSERT OR IGNORE INTO toy_series (id, line, name) VALUES (?, ?, ?)',
  );

  const usedSlugs = new Set(
    (db.prepare('SELECT id FROM toys').all() as { id: string }[]).map(
      (t) => t.id,
    ),
  );

  for (const a of allAmiibo) {
    if (existingAmiiboIds.has(a.id)) continue;

    // a.id is head+tail from getAmiiboSeries
    let canonicalId = `${slugify(a.name)}-amiibo-${slugify(a.series_name)}`;
    if (usedSlugs.has(canonicalId)) {
      canonicalId += `-${a.id.substring(0, 8)}`;
    }

    usedSlugs.add(canonicalId);

    const seriesId = `amiibo-${slugify(a.series_name)}`;
    insertSeriesStmt.run(seriesId, 'amiibo', a.series_name);

    insertStmt.run(
      canonicalId,
      a.name,
      'amiibo',
      a.series_name,
      a.type,
      a.image_url,
      a.id,
      0, // Wanted
      1, // Verified
      null, // We could store more if needed, but getAmiiboSeries only returns subset
      seriesId,
    );
    added.push(a);
  }
  console.log(`Added ${added.length} missing amiibo as Wanted.`);
  return added;
}

/**
 * UTILITY: appendUpdateReport
 */
function appendUpdateReport(changes: UpdateChange[]): void {
  if (changes.length === 0) return;

  const reportPath = 'update_report.md';
  if (!fs.existsSync(reportPath)) {
    fs.writeFileSync(
      reportPath,
      '# Update Report\n\nThis report lists metadata updates performed during the refresh pass.\n\n',
    );
  }

  const item = `${changes[0].title} (${changes[0].id})`;
  let entry = `### ${item}\n`;
  changes.forEach((c) => {
    entry += `- **${c.field}**: \`${c.oldValue}\` -> \`${c.newValue}\`\n`;
  });
  entry += '\n';

  fs.appendFileSync(reportPath, entry);
}

/**
 * UTILITY: generateReport
 *
 * Writes the discovery_report.md file with all findings for manual verification.
 */
function generateReport(
  unmatched: UnmatchedItem[],
  sync: SyncSuggestion[],
  gameDiscovery: GameDiscovery[],
  toyDiscovery: ToyDiscovery[],
): void {
  let report =
    '# Discovery Report\n\nThis report lists findings from the collection discovery pipeline.\n\n';

  if (sync.length > 0) {
    const gameSync = sync.filter((s) => s.type === 'Game');
    const toySync = sync.filter((s) => s.type === 'Toy');

    if (gameSync.length > 0) {
      report += '## Action Required: Sync Suggestions (Games)\n';
      for (const s of gameSync) {
        report += `### ${s.current}\n`;
        s.options.forEach((opt) => {
          report += `- [ ] **Update to:** ${opt.name} (${opt.platform}) - ID: ${opt.id}\n`;
          if (opt.image_url) report += `  - ![cover](${opt.image_url})\n`;
          if (opt.summary) {
            const shortSummary =
              opt.summary.length > 200
                ? opt.summary.substring(0, 200) + '...'
                : opt.summary;
            report += `  - *${shortSummary.replace(/\n/g, ' ')}*\n`;
          }
        });
        report += '\n';
      }
    }

    if (toySync.length > 0) {
      report += '## Toy Discovery (Amiibo)\n';
      for (const s of toySync) {
        report += `### ${s.current}\n`;
        s.options.forEach((opt) => {
          report += `- [ ] **Link to:** ${opt.name} (amiibo) - ID: ${opt.id}\n`;
          if (opt.image_url) report += `  - ![image](${opt.image_url})\n`;
          if (opt.summary) {
            report += `  - *${opt.summary}*\n`;
          }
        });
        report += '\n';
      }
    }
  }

  if (unmatched.length > 0) {
    report += '## Action Required: Unmatched Items\n';
    for (const u of unmatched) {
      report += `### ${u.item.title} (${u.item.platform_display_name || u.item.platform})\n`;
      if (u.suggestions && u.suggestions.length > 0) {
        u.suggestions.slice(0, 10).forEach((s) => {
          report += `- [ ] **Link to:** ${s.name} (${s.platform}) - ID: ${s.id}\n`;
          if (s.image_url) report += `  - ![cover](${s.image_url})\n`;
          if (s.summary) {
            const shortSummary =
              s.summary.length > 200
                ? s.summary.substring(0, 200) + '...'
                : s.summary;
            report += `  - *${shortSummary.replace(/\n/g, ' ')}*\n`;
          }
        });
      } else {
        report += '- No suggestions found.\n';
      }
      report += '\n';
    }
  }

  if (gameDiscovery.length > 0) {
    report += '## Discovery: New Games\n';
    for (const d of gameDiscovery) {
      report += `### Series: ${d.series}\n`;
      d.games.forEach((g) => {
        const platformName =
          g.platforms && g.platforms.length > 0
            ? g.platforms[0].name
            : 'Unknown';
        report += `- [ ] ${g.name} (${platformName}) - ID: igdb-${g.id}\n`;
      });
      report += '\n';
    }
  }

  if (toyDiscovery.length > 0) {
    report += '## Discovery: New Toys\n';
    for (const d of toyDiscovery) {
      report += `### Line: ${d.series}\n`;
      d.items.forEach((i) => {
        report += `- [ ] ${i.name} (${i.line}) - ID: ${i.id}\n`;
        if (i.image_url) report += `  - ![cover](${i.image_url})\n`;
      });
      report += '\n';
    }
  }

  fs.writeFileSync('discovery_report.md', report);
  console.log('Report generated: discovery_report.md');
}

/**
 * Performs web validation using PriceCharting and PlayStation Store.
 * Returns true if the game was successfully updated.
 */
async function performWebValidation(
  searchTitle: string,
  game: GameRecord,
): Promise<boolean> {
  process.stdout.write(`Attempting web validation... `);
  const scraped = await scrapePriceCharting(
    searchTitle,
    game.platform_display_name,
  );

  if (scraped) {
    const imageUrl = scraped.image_url;
    let summary = null;
    let releaseDate = null;

    // Use scraped image URL directly without downloading

    // If it's a PlayStation title, try to get more metadata from PS Store
    const psPlatforms = [
      'PlayStation 4',
      'PlayStation 5',
      'PlayStation VR',
      'PlayStation VR2',
    ];
    if (psPlatforms.includes(game.platform_display_name)) {
      const psData = await scrapePlayStationStore(searchTitle);
      if (psData) {
        summary = psData.description || null;
        releaseDate = psData.release_date || null;
      }
    }

    db.prepare(
      `
            UPDATE games 
            SET title = ?, image_url = ?, summary = ?, played = 0, backed_up = 0
            WHERE id = ?
        `,
    ).run(scraped.title, imageUrl, summary, game.id);

    updateReleaseDatesForGameReleases(
      db,
      game.stable_id,
      undefined,
      releaseDate,
    );

    console.log(`Web validated via PriceCharting! [${scraped.title}]`);
    return true;
  }
  return false;
}

runScraper().catch(console.error);
