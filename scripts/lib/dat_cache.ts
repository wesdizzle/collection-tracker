/**
 * @file dat_cache.ts
 * @description Provides a platform-level JSON caching layer for No-Intro and Redump XML DAT files.
 * It recursively scans the 'dats' directory to find the DAT file corresponding to a platform,
 * parses it on-demand using the fast-xml-parser utility, and saves a minified, lightweight
 * JSON cache in 'scripts/temp/dat_cache_<platformId>.json' to speed up subsequent matching.
 */

import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { parseDatFile } from './dat_parser.js';

/**
 * Standardized interface for releases loaded from the JSON cache file.
 */
export interface CachedRelease {
  name: string;
  romName: string;
  romCrc: string | null;
  region: string | null;
  variants: string | null;
  releaseDate: string | null;
}

/**
 * Interface representing a platform database record.
 */
export interface PlatformRecord {
  id: number;
  name: string;
  display_name: string;
}

/**
 * Scans a directory recursively and returns all file paths.
 *
 * @param dir Absolute path of the directory to scan.
 * @returns Array of absolute file paths.
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
 * Normalizes a platform name for comparison.
 *
 * @param s String to normalize.
 * @returns Cleaned lowercase string with platform brands removed.
 */
function cleanPlatformName(s: string): string {
  return s
    .toLowerCase()
    .replace(
      /\b(nintendo|sony|sega|microsoft|philips|atari|tiger|snk|nec)\b/gi,
      '',
    )
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Maps a platform name from a DAT file header to a database platform definition.
 * Uses explicit string fallbacks followed by exact and substring matching.
 *
 * @param datPlatformName Platform name declared in the DAT file header.
 * @param targetPlatform The database platform record we are trying to match.
 * @returns True if the DAT platform maps to the target platform, false otherwise.
 */
export function isPlatformMatch(
  datPlatformName: string,
  targetPlatform: PlatformRecord,
): boolean {
  const datClean = cleanPlatformName(datPlatformName);
  const lowerDat = datPlatformName.toLowerCase();

  // Explicit mapping overrides matching scripts/scrape.ts
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

  const targetDisplayName = (
    targetPlatform.display_name || targetPlatform.name
  ).toLowerCase();

  for (const key of sortedFallbackKeys) {
    const dbVal = fallbacks[key];
    if (lowerDat.includes(key)) {
      if (targetDisplayName.includes(dbVal)) {
        return true;
      }
    }
  }

  // Exact match on cleaned titles
  const targetClean = cleanPlatformName(
    targetPlatform.display_name || targetPlatform.name,
  );
  if (datClean === targetClean) {
    return true;
  }

  // Substring match on clean platform titles (ignoring short platform abbreviations)
  if (targetClean.length > 2) {
    if (datClean.includes(targetClean) || targetClean.includes(datClean)) {
      return true;
    }
  }

  return false;
}

/**
 * Extracts region codes from a release title.
 *
 * @param name The raw release name containing parentheses.
 * @returns Comma-separated region string or null.
 */
export function extractRegions(name: string): string | null {
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

/**
 * Checks if a string content consists entirely of regions or languages or disc indicators.
 * Used to separate variants from language/region parentheticals.
 *
 * @param content Parenthetical inner content.
 * @returns True if it is a region, language, or disc, false otherwise.
 */
function isRegionOrLanguageOrDisc(content: string): boolean {
  const normalized = content.toLowerCase().trim();

  const discRegex =
    /^(?:disc|side)\s+[a-zA-Z0-9]+(?:\s+of\s+[0-9]+|\s*[/\\\\]\s*[0-9]+)?$/i;
  if (discRegex.test(normalized)) return true;

  const jpDiscRegex = /^(?:ichi|ni|san|yon|shi|go)$/i;
  if (jpDiscRegex.test(normalized)) return true;

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

/**
 * Extracts variant indicators (such as 'Beta', 'Proto', 'Rev 1') from a release title.
 *
 * @param name Raw release name containing parenthetical variants.
 * @returns Comma-separated list of variants, or null.
 */
export function extractVariants(name: string): string | null {
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
 * Determines whether a release or ROM should be ignored based on global or platform-specific rules.
 *
 * @param releaseName The clean release title.
 * @param romName The ROM filename.
 * @param platformId The platform ID.
 * @returns True if the release is ignored, false otherwise.
 */
export function isIgnoredFormatRelease(
  releaseName: string,
  romName: string,
  platformId?: number,
): boolean {
  const romLower = romName.toLowerCase();
  const ext = path.extname(romLower);

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

  if (platformId === 33 && ext !== '.psv') {
    return true;
  }

  if (romLower.startsWith('tmd.')) return true;

  return false;
}

/**
 * Searches the 'dats' folder to find the XML DAT file corresponding to a platform ID.
 *
 * @param db Database instance.
 * @param platformId Platform ID.
 * @returns Object containing the XML file path and platform details, or null if not found.
 */
export function findDatFileForPlatform(
  db: Database.Database,
  platformId: number,
): { filePath: string; platform: PlatformRecord } | null {
  const platform = db
    .prepare('SELECT id, name, display_name FROM platforms WHERE id = ?')
    .get(platformId) as PlatformRecord | undefined;
  if (!platform) {
    console.warn(
      `[DAT-Cache] Platform ID ${platformId} not found in database.`,
    );
    return null;
  }

  const datsDir = path.resolve(process.cwd(), 'dats');
  if (!fs.existsSync(datsDir)) return null;

  const allFiles = getFilesRecursive(datsDir);
  const datFiles = allFiles.filter((f) => {
    const ext = path.extname(f).toLowerCase();
    return ext === '.xml' || ext === '.dat';
  });

  for (const filePath of datFiles) {
    try {
      // Speed Optimization: Read the first 2000 characters rather than parsing the full XML file
      const fileHead = fs
        .readFileSync(filePath, { encoding: 'utf8', flag: 'r' })
        .substring(0, 2000);
      const nameMatch = fileHead.match(/<name>([^<]+)<\/name>/i);
      if (nameMatch) {
        const platformName = nameMatch[1].trim();
        if (isPlatformMatch(platformName, platform)) {
          return { filePath, platform };
        }
      }
    } catch (err) {
      console.error(
        `[DAT-Cache] Error inspecting file header ${filePath}:`,
        err,
      );
    }
  }

  return null;
}

/**
 * Retrieves physical releases for a specific platform from the JSON cache.
 * If the cache does not exist or is older than the source XML DAT file, parses the source
 * XML DAT and writes a fresh JSON cache under 'scripts/temp/dat_cache_<platformId>.json'.
 *
 * @param db SQLite database instance.
 * @param platformId Platform ID.
 * @returns Array of CachedRelease objects.
 * @throws Error if the platform cannot be resolved or if parsing files fails.
 */
export function getPlatformDatReleases(
  db: Database.Database,
  platformId: number,
): CachedRelease[] {
  const datInfo = findDatFileForPlatform(db, platformId);
  if (!datInfo) {
    console.log(
      `[DAT-Cache] No matching DAT file found for Platform ID: ${platformId}`,
    );
    return [];
  }

  const { filePath: datFilePath, platform } = datInfo;
  const tempDir = path.resolve(process.cwd(), 'scripts', 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const cachePath = path.join(tempDir, `dat_cache_${platformId}.json`);

  // Verify cache freshness (MTime comparison)
  let isCacheValid = false;
  if (fs.existsSync(cachePath)) {
    try {
      const sourceMtime = fs.statSync(datFilePath).mtimeMs;
      const cacheMtime = fs.statSync(cachePath).mtimeMs;
      if (cacheMtime >= sourceMtime) {
        isCacheValid = true;
      }
    } catch (statErr) {
      console.warn(
        `[DAT-Cache] Mtime check failed for platform ${platformId}:`,
        statErr,
      );
    }
  }

  if (isCacheValid) {
    try {
      const cacheRaw = fs.readFileSync(cachePath, 'utf8');
      return JSON.parse(cacheRaw) as CachedRelease[];
    } catch (readErr) {
      console.warn(
        `[DAT-Cache] Failed to load JSON cache for platform ${platformId}. Re-generating.`,
        readErr,
      );
    }
  }

  console.log(
    `[DAT-Cache] Generating fresh JSON releases cache for platform: ${platform.display_name || platform.name} (DAT: ${path.basename(datFilePath)})`,
  );
  const parsedDat = parseDatFile(datFilePath);
  const cacheData: CachedRelease[] = [];

  for (const release of parsedDat.releases) {
    let roms = release.roms;

    // Platform-specific rules: PS Vita (ID: 33) cards vs executables
    if (platformId === 33) {
      const hasPsv = roms.some((r) => r.name.toLowerCase().endsWith('.psv'));
      if (hasPsv) {
        roms = roms.filter((r) => r.name.toLowerCase().endsWith('.psv'));
      } else {
        roms = roms.filter((r) => !r.name.toLowerCase().endsWith('.rap'));
      }
    }

    if (roms.length === 0) continue;

    // Pick primary representative ROM
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

    if (isIgnoredFormatRelease(release.name, primaryRom.name, platformId)) {
      continue;
    }

    cacheData.push({
      name: release.name,
      romName: primaryRom.name,
      romCrc: primaryRom.crc || null,
      region: extractRegions(release.name),
      variants: extractVariants(release.name),
      releaseDate: null, // Populated dynamically during ingestion via IGDB matching
    });
  }

  try {
    fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2), 'utf8');
    console.log(
      `[DAT-Cache] Cached ${cacheData.length} releases successfully to ${path.basename(cachePath)}.`,
    );
  } catch (writeErr) {
    console.error(
      `[DAT-Cache] Failed to write cache file to ${cachePath}:`,
      writeErr,
    );
  }

  return cacheData;
}
