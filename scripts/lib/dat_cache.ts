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

export {
  type PlatformRecord,
  isPlatformMatch,
  extractRegions,
  extractVariants,
  isIgnoredFormatRelease,
  isRegionOrLanguageOrDisc,
} from '../../shared/source_format.js';
import {
  PlatformRecord,
  isPlatformMatch,
  extractRegions,
  extractVariants,
  isIgnoredFormatRelease,
} from '../../shared/source_format.js';

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

import { extractDatHeaderName } from '../../shared/dat_parser.js';

/**
 * Searches the 'dats' folder to find all DAT files matching a platform ID
 * (e.g., Atari Jaguar 6 pairs Redump Jaguar CD with No-Intro Atari Jaguar cartridges).
 *
 * @param db Database instance.
 * @param platformId Platform ID.
 * @returns Array of matching DAT files paired with platform metadata.
 */
export function findDatFilesForPlatform(
  db: Database.Database,
  platformId: number,
): Array<{ filePath: string; platform: PlatformRecord }> {
  const platform = db
    .prepare('SELECT id, name, display_name FROM platforms WHERE id = ?')
    .get(platformId) as PlatformRecord | undefined;
  if (!platform) {
    console.warn(
      `[DAT-Cache] Platform ID ${platformId} not found in database.`,
    );
    return [];
  }

  const datsDir = path.resolve(process.cwd(), 'dats');
  if (!fs.existsSync(datsDir)) return [];

  const allFiles = getFilesRecursive(datsDir);
  const ignoredPatterns = [
    /\(psn\)/i,
    /\(digital\)/i,
    /\(nonpdrm\)/i,
    /\(updates\)/i,
    /\(title updates\)/i,
    /\(dlc\)/i,
    /\(development kit/i,
    /\(dev\b/i,
    /\(themes\)/i,
    /\(avatars\)/i,
    /\(wallpapers\)/i,
    /\(tapes\)/i,
    /\(kryoflux\)/i,
    /\(flux/i,
    /\(waveform\)/i,
    /\(bitstream/i,
    /\(floppies\)/i,
    /\(desura\)/i,
    /\(steam\)/i,
    /\(hentai\)/i,
    /\(deprecated\)/i,
    /\(cdn\)/i,
    /\(content\)/i,
    /\(spotpass\)/i,
    /\(minis\)/i,
    /\(lotcheck\)/i,
    /\(download play\)/i,
    /\(dsvision/i,
    /\(e-reader\)/i,
    /\(multiboot\)/i,
    /\(play-yan\)/i,
    /\(video\)/i,
    /\(kiosk/i,
    /\(loosefilesarchive\)/i,
    /\(extracted\)/i,
    /\(encrypted\)/i,
  ];

  const datFiles = allFiles.filter((f) => {
    const ext = path.extname(f).toLowerCase();
    if (ext !== '.xml' && ext !== '.dat') return false;
    const base = path.basename(f);
    return !ignoredPatterns.some((p) => p.test(base));
  });

  // Sort: prioritize root DAT files (Redump) for disc systems, and direct No-Intro DATs for cart systems
  datFiles.sort((a, b) => {
    const aInRoot = path.dirname(a) === datsDir ? 0 : 1;
    const bInRoot = path.dirname(b) === datsDir ? 0 : 1;
    if (aInRoot !== bInRoot) return aInRoot - bInRoot;
    return a.localeCompare(b);
  });

  // Platforms whose physical library intentionally spans two distinct DAT sets (e.g., cart + CD or BW + Color)
  const allowMultiDat = platformId === 6 || platformId === 11;
  const matched: Array<{ filePath: string; platform: PlatformRecord }> = [];
  const seenNormalizedHeaders = new Set<string>();
  for (const filePath of datFiles) {
    try {
      // Speed Optimization: Read the first 2000 characters rather than parsing the full file
      const fileHead = fs
        .readFileSync(filePath, { encoding: 'utf8', flag: 'r' })
        .substring(0, 2000);
      const platformName = extractDatHeaderName(fileHead);
      if (platformName && isPlatformMatch(platformName, platform)) {
        const headerKey = platformName
          .replace(/&amp;/gi, ' and ')
          .replace(/\(parent-clone\)/gi, '')
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '');
        if (!seenNormalizedHeaders.has(headerKey)) {
          seenNormalizedHeaders.add(headerKey);
          matched.push({ filePath, platform });
          if (!allowMultiDat) {
            return matched;
          }
        }
      }
    } catch (err) {
      console.error(
        `[DAT-Cache] Error inspecting file header ${filePath}:`,
        err,
      );
    }
  }

  return matched;
}

/**
 * Searches the 'dats' folder to find the primary XML DAT file corresponding to a platform ID.
 *
 * @param db Database instance.
 * @param platformId Platform ID.
 * @returns Object containing the XML file path and platform details, or null if not found.
 */
export function findDatFileForPlatform(
  db: Database.Database,
  platformId: number,
): { filePath: string; platform: PlatformRecord } | null {
  return findDatFilesForPlatform(db, platformId)[0] ?? null;
}

/**
 * Retrieves physical releases for a specific platform from the JSON cache.
 * If the cache does not exist or is older than any source XML DAT file, parses all
 * matching DATs and writes a fresh JSON cache under 'scripts/temp/dat_cache_<platformId>.json'.
 *
 * @param db SQLite database instance.
 * @param platformId Platform ID.
 * @returns Array of CachedRelease objects.
 */
export function getPlatformDatReleases(
  db: Database.Database,
  platformId: number,
): CachedRelease[] {
  const datMatches = findDatFilesForPlatform(db, platformId);
  if (datMatches.length === 0) {
    console.log(
      `[DAT-Cache] No matching DAT file found for Platform ID: ${platformId}`,
    );
    return [];
  }

  const platform = datMatches[0].platform;
  const tempDir = path.resolve(process.cwd(), 'scripts', 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const cachePath = path.join(tempDir, `dat_cache_${platformId}.json`);

  // Verify cache freshness against every matching DAT file
  let isCacheValid = false;
  if (fs.existsSync(cachePath)) {
    try {
      const latestSourceMtime = Math.max(
        ...datMatches.map((m) => fs.statSync(m.filePath).mtimeMs),
      );
      const cacheMtime = fs.statSync(cachePath).mtimeMs;
      if (cacheMtime >= latestSourceMtime) {
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
    `[DAT-Cache] Generating fresh JSON releases cache for platform: ${platform.display_name || platform.name} (DATs: ${datMatches.map((m) => path.basename(m.filePath)).join(', ')})`,
  );
  const parsedReleases = datMatches.flatMap(
    (m) => parseDatFile(m.filePath).releases,
  );
  const cacheData: CachedRelease[] = [];

  for (const release of parsedReleases) {
    let roms = release.roms;

    // Platform-specific rules: PS Vita (ID: 33) prefer .zip archives, disallow .psv and .vpk
    if (platformId === 33) {
      roms = roms.filter(
        (r) =>
          !r.name.toLowerCase().endsWith('.rap') &&
          !r.name.toLowerCase().endsWith('.pkg') &&
          !r.name.toLowerCase().endsWith('.psv') &&
          !r.name.toLowerCase().endsWith('.vpk'),
      );
    }

    if (roms.length === 0 && platformId !== 33) continue;

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

    let romName = primaryRom?.name || `${release.name}.zip`;
    if (platformId === 33) {
      const baseWithoutExt = release.name.replace(/\.(vpk|psv|zip|7z)$/i, '');
      romName = `${baseWithoutExt}.zip`;
    }

    if (isIgnoredFormatRelease(release.name, romName, platformId)) {
      continue;
    }

    cacheData.push({
      name: release.name,
      romName,
      romCrc: platformId === 33 ? null : primaryRom?.crc || null,
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
