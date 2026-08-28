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
} from './dat_format.js';
import {
  PlatformRecord,
  isPlatformMatch,
  extractRegions,
  extractVariants,
  isIgnoredFormatRelease,
} from './dat_format.js';

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
  const ignoredPatterns = [
    /\(psn\)/i,
    /\(digital\)/i,
    /\(updates\)/i,
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
    return aInRoot - bInRoot;
  });

  for (const filePath of datFiles) {
    try {
      // Speed Optimization: Read the first 2000 characters rather than parsing the full file
      const fileHead = fs
        .readFileSync(filePath, { encoding: 'utf8', flag: 'r' })
        .substring(0, 2000);
      const nameMatch =
        fileHead.match(/<name>([^<]+)<\/name>/i) ||
        fileHead.match(/clrmamepro\s*\(\s*name\s*"([^"]+)"/i) ||
        fileHead.match(/name\s*"([^"]+)"/i);
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
