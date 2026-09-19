/**
 * BACKUP FILE SCANNER & RECONCILIATOR (TS)
 *
 * This script scans a user-specified backup directory recursively for
 * filenames matching the 'rom_name' field of games on their respective
 * platforms. Matches are updated in the SQLite database by setting
 * 'backup_status' to 1 on game_releases and synchronizing the games table.
 *
 * It also exports a surgical 'update_backup_status.sql' migration file
 * that can be safely applied to remote Cloudflare D1 without exceeding quotas.
 *
 * SAFETY GUARANTEE:
 * - This script treats the backup folder as strictly READ-ONLY.
 * - It will never write, delete, rename, or modify any files or directories in the backup path.
 * - It will not perform hash calculations or decompress archives to avoid performance overhead.
 *
 * USAGE:
 * npm run scan-backups <path-to-backups>
 */

import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import {
  normalizeTitleForMatching,
  titlesMatch,
} from './lib/title_matching.js';
import { extractRegions, isPlatformMatch } from './lib/dat_format.js';
import { stripDiscIndicator } from './lib/queries.js';

export interface PlatformRow {
  id: number;
  name: string;
  display_name: string | null;
  brand: string | null;
  launch_date: string | null;
  parent_platform_id: number | null;
}

export interface ReleaseRow {
  id: string;
  game_id: number;
  title: string;
  rom_name: string;
  stable_id: number;
  region: string | null;
  ownership_status?: number;
  variants?: string | null;
}

/**
 * Valid game file extensions to verify base-name matching.
 */
export const GAME_EXTENSIONS = new Set([
  '.rvz',
  '.gcm',
  '.iso',
  '.wux',
  '.wud',
  '.chd',
  '.cso',
  '.pbp',
  '.bin',
  '.cue',
  '.md',
  '.gg',
  '.sms',
  '.a26',
  '.a52',
  '.a78',
  '.lnx',
  '.col',
  '.int',
  '.zip',
  '.7z',
  '.rar',
  '.gba',
  '.gbc',
  '.gb',
  '.nes',
  '.sfc',
  '.smc',
  '.nds',
  '.3ds',
  '.cci',
  '.cia',
  '.z64',
  '.n64',
  '.v64',
  '.wbfs',
  '.ciso',
  '.tgc',
  '.gcz',
  '.wad',
  '.gdi',
  '.cdi',
  '.img',
  '.mdf',
  '.nrg',
  '.gen',
  '.smd',
  '.pkg',
  '.psv',
  '.dax',
  '.vb',
  '.j64',
  '.jag',
  '.ngp',
  '.ngc',
  '.neo',
  '.ws',
  '.wsc',
  '.pce',
  '.fds',
  '.xci',
  '.nsp',
  '.wua',
  '.xiso.iso',
]);

/**
 * Standardizes platform names to facilitate mapping between folder names and database entries.
 *
 * @param name The platform name string.
 * @returns Cleaned alphanumeric lowercase platform string.
 */
function cleanPlatformName(name: string): string {
  return name
    .toLowerCase()
    .replace(
      /\b(nintendo|sony|sega|microsoft|philips|atari|tiger|snk|nec)\b/gi,
      '',
    )
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Resolves platform ID to an array of platform IDs that are scanned together.
 * Specifically, NES (13) and Famicom (53) are mapped symmetrically,
 * and child platforms (e.g. PSVR under PS4, PSVR2 under PS5, New 3DS under 3DS)
 * are included when scanning parent platforms.
 *
 * @param platformId The database platform ID.
 * @param allPlatforms Optional list of all platforms to resolve dynamic parent/child relationships.
 * @returns Array of scanned platform IDs.
 */
export function getScannedPlatformIds(
  platformId: number,
  allPlatforms?: PlatformRow[],
): number[] {
  const ids = new Set<number>([platformId]);

  // Symmetrical platforms (NES & Famicom)
  if (platformId === 13 || platformId === 53) {
    return [13, 53];
  }

  // Child platforms resolution
  if (allPlatforms) {
    for (const p of allPlatforms) {
      if (p.parent_platform_id === platformId) {
        ids.add(p.id);
      }
    }
  } else {
    // Known hierarchy fallbacks
    if (platformId === 34) ids.add(51); // PSVR under PS4
    if (platformId === 35) ids.add(52); // PSVR2 under PS5
    if (platformId === 23) ids.add(25); // New 3DS under 3DS
  }

  return Array.from(ids);
}

/**
 * Checks if a file is an ignored non-backup format or sidecar/save state.
 *
 * @param filename The filename to evaluate.
 * @returns True if the file should be ignored from scanning and unmatched alerts.
 */
export function isIgnoredFile(filename: string): boolean {
  const lower = filename.toLowerCase();

  // Exact name matches
  if (
    lower === 'param.pbp' ||
    lower === 'desktop.ini' ||
    lower === '.ds_store' ||
    lower === 'thumbs.db'
  ) {
    return true;
  }

  // AppleDouble / macOS metadata
  if (lower.startsWith('._')) {
    return true;
  }

  // Extension matches for saves, sidecars, cheats, artwork, playlists, and checksums
  const ignoredExtensions = [
    '.sav',
    '.srm',
    '.edat',
    '.m3u',
    '.cht',
    '.nfo',
    '.sfv',
    '.md5',
    '.sha1',
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
    '.gif',
    '.mp4',
    '.txt',
    '.xml',
    '.pdf',
    '.nvram',
    '.eeprom',
    '.hi',
    '.fs',
  ];

  if (ignoredExtensions.some((ext) => lower.endsWith(ext))) {
    return true;
  }

  // State files (e.g. .state, .state1, .state.auto)
  if (/\.state(\d+|\.auto)?$/i.test(lower)) {
    return true;
  }

  // Multi-track secondary .bin audio/data files (e.g. Track 2.bin, Track 02.bin, Track 2 of 5.bin)
  // Track 1 is retained as the primary entry for bin/cue releases.
  if (/(?:track|side)\s*(?:0?[2-9]|[1-9]\d+).*\.bin$/i.test(lower)) {
    return true;
  }

  return false;
}

/**
 * Helper to split a filename into base title and extension.
 * Correctly handles double extensions like '.xiso.iso' by stripping both.
 * Also normalizes title format (like converting 'Title, The' to 'The Title').
 *
 * @param filename The base filename.
 * @returns Object containing the cleaned base name and the extension.
 */
export function getGameFileParts(filename: string): {
  base: string;
  ext: string;
} {
  const lower = filename.toLowerCase();

  let ext: string;
  let base: string;
  if (lower.endsWith('.xiso.iso')) {
    ext = '.xiso.iso';
    base = filename.substring(0, filename.length - 9);
  } else {
    ext = path.parse(lower).ext;
    base = path.parse(filename).name;
  }

  // Clean parentheticals and brackets from the base title
  let baseTitle = base
    .replace(/\s*[([][^\])]*[)\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Handle ", The" and ", A" suffix
  if (baseTitle.includes(', The')) {
    baseTitle = 'The ' + baseTitle.replace(', The', '');
  } else if (baseTitle.includes(', A')) {
    baseTitle = 'A ' + baseTitle.replace(', A', '');
  }

  return {
    base: baseTitle,
    ext: ext.toLowerCase(),
  };
}

/**
 * Splits a base title into individual segments based on delimiters (~, /, :, -).
 *
 * @param baseTitle The cleaned base title.
 * @returns Array of segment strings.
 */
export function getTitleSegments(baseTitle: string): string[] {
  let normalized = baseTitle.replace(/\s+-\s+/g, '___SPLIT___');
  normalized = normalized.replace(/[~/:]/g, '___SPLIT___');
  return normalized
    .split('___SPLIT___')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Maps a subdirectory name to a database platform definition using name cleaning and fallbacks.
 *
 * @param subDirName Name of the directory.
 * @param dbPlatforms Array of platform records from the database.
 * @returns The matched platform database record, or null if no match is found.
 */
export function findDbPlatform(
  subDirName: string,
  dbPlatforms: PlatformRow[],
): PlatformRow | null {
  const datClean = cleanPlatformName(subDirName);
  const lowerDat = subDirName.toLowerCase();

  // 1. Check if dat_format's isPlatformMatch directly matches any platform
  for (const p of dbPlatforms) {
    if (
      isPlatformMatch(subDirName, {
        id: p.id,
        name: p.name,
        display_name: p.display_name || p.name,
      })
    ) {
      return p;
    }
  }

  // 2. Explicit fallbacks table with abbreviations (snes, ps1, n64, gba, etc.)
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
    'nintendo switch 2': 'nintendo switch 2',
    'switch 2': 'nintendo switch 2',
    'nintendo switch': 'nintendo switch',
    switch: 'nintendo switch',
    snes: 'super nintendo entertainment system',
    nes: 'nintendo entertainment system',
    n64: 'nintendo 64',
    gamecube: 'nintendo gamecube',
    ngc: 'nintendo gamecube',
    gc: 'nintendo gamecube',
    gba: 'game boy advance',
    gbc: 'game boy color',
    gb: 'game boy',
    nds: 'nintendo ds',
    ds: 'nintendo ds',
    '3ds': 'nintendo 3ds',
    n3ds: 'new nintendo 3ds',
    'new 3ds': 'new nintendo 3ds',
    ps1: 'playstation',
    psx: 'playstation',
    ps2: 'playstation 2',
    ps3: 'playstation 3',
    ps4: 'playstation 4',
    ps5: 'playstation 5',
    psp: 'playstation portable',
    psvita: 'playstation vita',
    vita: 'playstation vita',
    psvr2: 'playstation vr2',
    psvr: 'playstation vr',
    'xbox 360': 'xbox 360',
    xbox360: 'xbox 360',
    'xbox one': 'xbox one',
    xboxone: 'xbox one',
    'xbox series x': 'xbox series x',
    'xbox series': 'xbox series x',
    xboxseries: 'xbox series x',
    xboxseriesx: 'xbox series x',
    xbox: 'xbox',
    saturn: 'sega saturn',
    dreamcast: 'dreamcast',
    'game gear': 'sega game gear',
    gamegear: 'sega game gear',
    'master system': 'sega master system',
    mastersystem: 'sega master system',
    '32x': 'sega 32x',
    tg16: 'turbografx-16',
    pce: 'turbografx-16',
    'neo geo pocket color': 'neo geo pocket color',
    'neo geo cd': 'neo geo cd',
    'neo geo x': 'neo geo x',
    'neo geo aes': 'neo geo aes',
    'neo geo': 'neo geo aes',
    neogeo: 'neo geo aes',
  };

  const sortedFallbackKeys = Object.keys(fallbacks).sort(
    (a, b) => b.length - a.length,
  );

  for (const key of sortedFallbackKeys) {
    const dbVal = fallbacks[key];
    if (
      lowerDat === key ||
      lowerDat === key.replace(/\s+/g, '') ||
      new RegExp(`\\b${key}\\b`, 'i').test(lowerDat)
    ) {
      const matched = dbPlatforms.find((p) => {
        const pName = (p.display_name || p.name).toLowerCase();
        return pName === dbVal || pName.includes(dbVal);
      });
      if (matched) return matched;
    }
  }

  // 3. Exact cleaned match
  for (const p of dbPlatforms) {
    const pClean = cleanPlatformName(p.display_name || p.name);
    if (pClean === datClean) {
      return p;
    }
  }

  // 4. Substring match: only match if the directory name contains the platform name
  // Sorted by clean name length descending so specific platforms (e.g. "switch2") match before ("switch")
  const sortedPlatforms = [...dbPlatforms].sort((a, b) => {
    const cleanA = cleanPlatformName(a.display_name || a.name);
    const cleanB = cleanPlatformName(b.display_name || b.name);
    return cleanB.length - cleanA.length;
  });

  for (const p of sortedPlatforms) {
    const pClean = cleanPlatformName(p.display_name || p.name);
    if (pClean.length > 2 && datClean.includes(pClean)) {
      return p;
    }
  }

  return null;
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
 * Normalizes region strings to handle common equivalent representations
 * (e.g. NA, USA, North America) when comparing game and release regions.
 *
 * @param region The region string to normalize.
 * @returns Array of normalized region parts.
 */
function normalizeRegion(region: string | null): string[] {
  if (!region) return [];
  return region
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
}

/**
 * Compares two region strings and determines if there is any overlap
 * after resolving regional equivalences and World compatibility.
 *
 * @param reg1 First region string.
 * @param reg2 Second region string.
 * @returns True if the regions match, false otherwise.
 */
function regionsMatch(reg1: string | null, reg2: string | null): boolean {
  if (!reg1 || !reg2) return false;
  const parts1 = normalizeRegion(reg1);
  const parts2 = normalizeRegion(reg2);
  if (parts1.includes('world') || parts2.includes('world')) {
    return true;
  }
  return parts1.some((p1) => parts2.includes(p1));
}

/**
 * Retrieves the base filename prior to the extension.
 * Correctly handles double extensions like '.xiso.iso' by stripping both.
 *
 * @param filename The full filename.
 * @returns The base filename string.
 */
function getBaseName(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xiso.iso')) {
    return filename.substring(0, filename.length - 9);
  }
  return path.parse(filename).name;
}

/**
 * Normalizes a ROM base name for tolerant comparison by:
 * - Lowercasing and trimming
 * - Stripping Track 1 indicator (e.g. "(Track 1)", "(Track 01)")
 * - Stripping disc indicators (e.g. "Disc 1", "(Disc 2)")
 * - Normalizing "Megaman" <-> "Mega Man"
 * - Normalizing regional tag variants: "(USA, Canada)", "(Canada, USA)", "(US)" -> "(USA)"
 *
 * @param base The base filename prior to the extension.
 * @returns Normalized base string for comparison.
 */
export function normalizeRomBaseForMatching(base: string): string {
  let s = base.toLowerCase().trim();

  // Strip Track 1 indicator (e.g. "(Track 1)", "(Track 01)")
  s = s.replace(/[-_\s]*\(track\s+0*1\)/gi, '');

  // Strip Redump language tags (e.g. "(En,Ja,Fr,De,Es)", "(En,Fr)", "(En,Es)", etc.)
  s = s.replace(
    /\(\s*(?:en|ja|fr|de|es|it|nl|pt|sv|no|da|fi|ko|zh|ru|pl)(?:\s*,\s*(?:en|ja|fr|de|es|it|nl|pt|sv|no|da|fi|ko|zh|ru|pl))*\s*\)/gi,
    '',
  );

  // Strip Disc indicator (using existing disc stripping logic)
  s = stripDiscIndicator(s);

  // Normalize "Megaman" <-> "Mega Man"
  s = s.replace(/\bmegaman\b/gi, 'mega man');

  // Normalize regional tag variants: (USA, Canada), (Canada, USA), (US) -> (USA)
  s = s.replace(/\(\s*usa\s*,\s*canada\s*\)/gi, '(usa)');
  s = s.replace(/\(\s*canada\s*,\s*usa\s*\)/gi, '(usa)');
  s = s.replace(/\(\s*us\s*\)/gi, '(usa)');

  // Normalize multiple spaces
  s = s.replace(/\s+/g, ' ').trim();

  return s;
}

/**
 * Extracts a normalized disc index or indicator (e.g. "1", "2", "a", "b") from a filename.
 *
 * @param filename The ROM or release filename.
 * @returns The lowercase disc identifier if present, or null.
 */
export function extractDiscNumber(
  filename: string | null | undefined,
): string | null {
  if (!filename) return null;
  const match = filename.match(
    /[-_\s]*\(?Disc\s+([a-zA-Z0-9]+)(?:\s+of\s+[0-9]+|\s*[/\\\\]\s*[0-9]+)?\)?/i,
  );
  return match ? match[1].toLowerCase() : null;
}

/**
 * Resolves the best physical release match for a given backup file.
 * Case-Insensitive Mode: Base name matches case-insensitively with compatible extensions.
 * Multi-Disc Sets: Automatically preserves disc indices (e.g. Disc 2 strictly matches Disc 2).
 * Normalized Matching: Automatically normalizes Megaman spacing, (USA)/(USA, Canada) tags, Track 1, and Redump languages.
 * Regional Fallback: Matches clean base names when regions are compatible (e.g. Retro-Bit World reprint matching USA backup).
 *
 * @param filename The backup filename.
 * @param releases Array of physical database releases on the platform.
 * @returns The best matched release database record, or null.
 */
export function findBestReleaseMatch(
  filename: string,
  releases: ReleaseRow[],
): ReleaseRow | null {
  const fileParts = getGameFileParts(filename);
  const fileBase = getBaseName(filename).toLowerCase();
  const fileExt = fileParts.ext.toLowerCase();
  const fileDisc = extractDiscNumber(filename);
  const fileRegion = extractRegions(filename);

  // 1. Direct case-insensitive base name match with compatible extension
  for (const r of releases) {
    const romParts = getGameFileParts(r.rom_name);
    const romBase = getBaseName(r.rom_name).toLowerCase();
    const romExt = romParts.ext.toLowerCase();

    const baseMatches = fileBase === romBase;
    const extMatches =
      fileExt === romExt ||
      (GAME_EXTENSIONS.has(fileExt) && GAME_EXTENSIONS.has(romExt));

    if (baseMatches && extMatches) {
      return r;
    }
  }

  // 2. Normalized base name match with multi-disc preservation
  // Resolves "Megaman" <-> "Mega Man", "(USA)" <-> "(USA, Canada)", "(Track 1)", Redump language tags,
  // and disc indicators while strictly prioritizing disc-to-disc matching when a disc indicator is present.
  const fileBaseRaw = getBaseName(filename);
  const fileNormBase = normalizeRomBaseForMatching(fileBaseRaw);
  const matchingCandidates: ReleaseRow[] = [];

  for (const r of releases) {
    const romParts = getGameFileParts(r.rom_name);
    const romExt = romParts.ext.toLowerCase();
    const extMatches =
      fileExt === romExt ||
      (GAME_EXTENSIONS.has(fileExt) && GAME_EXTENSIONS.has(romExt));

    if (!extMatches) continue;

    const romNormBase = normalizeRomBaseForMatching(getBaseName(r.rom_name));
    if (fileNormBase.length > 0 && fileNormBase === romNormBase) {
      matchingCandidates.push(r);
    }
  }

  if (matchingCandidates.length > 0) {
    if (fileDisc) {
      // If backup has Disc N, strictly match candidate with Disc N
      const discMatch = matchingCandidates.find(
        (r) => extractDiscNumber(r.rom_name) === fileDisc,
      );
      if (discMatch) return discMatch;
    } else {
      // If backup does NOT specify a disc (e.g. merged multi-disc CHD), prefer Disc 1
      const disc1Match = matchingCandidates.find(
        (r) => extractDiscNumber(r.rom_name) === '1',
      );
      if (disc1Match) return disc1Match;
    }
    return matchingCandidates[0];
  }

  // 3. Cleaned base name match with region compatibility (e.g. Retro-Bit World reprint matching USA backup)
  const fileBaseClean = fileParts.base.toLowerCase();
  const cleanCandidates: ReleaseRow[] = [];
  for (const r of releases) {
    const romParts = getGameFileParts(r.rom_name);
    const romBaseClean = romParts.base.toLowerCase();
    const romExt = romParts.ext.toLowerCase();
    const extMatches =
      fileExt === romExt ||
      (GAME_EXTENSIONS.has(fileExt) && GAME_EXTENSIONS.has(romExt));

    if (
      fileBaseClean === romBaseClean &&
      extMatches &&
      (!fileRegion || !r.region || regionsMatch(fileRegion, r.region))
    ) {
      cleanCandidates.push(r);
    }
  }

  if (cleanCandidates.length > 0) {
    // 1. Prefer physically owned release if available
    const ownedCandidate = cleanCandidates.find(
      (r) => r.ownership_status === 1,
    );
    if (ownedCandidate) return ownedCandidate;

    // 2. Prefer standard cartridge/disc releases over plug-and-play / mini console ROMs
    const physicalCartCandidate = cleanCandidates.find(
      (r) => !r.variants?.match(/mini|virtual console/i),
    );
    if (physicalCartCandidate) return physicalCartCandidate;

    return cleanCandidates[0];
  }

  return null;
}

/**
 * Identifies a tolerant release match for alerting when base name mismatch occurs.
 *
 * @param filename The backup filename.
 * @param releases Array of physical database releases on the platform.
 * @returns The best tolerantly matched release database record, or null.
 */
export function findTolerantReleaseMatch(
  filename: string,
  releases: ReleaseRow[],
): ReleaseRow | null {
  const fileParts = getGameFileParts(filename);
  const fileBase = getBaseName(filename).toLowerCase();
  const fileExt = fileParts.ext.toLowerCase();
  const fileRegion = extractRegions(filename);

  // 0. Case-insensitive exact base name match
  for (const r of releases) {
    const romBase = getBaseName(r.rom_name).toLowerCase();
    const romParts = getGameFileParts(r.rom_name);
    const romExt = romParts.ext.toLowerCase();
    if (
      fileBase === romBase &&
      GAME_EXTENSIONS.has(fileExt) &&
      GAME_EXTENSIONS.has(romExt)
    ) {
      return r;
    }
  }

  // 1. Cleaned base name match (without parentheticals) AND region compatibility
  for (const r of releases) {
    const romParts = getGameFileParts(r.rom_name);
    const fileBaseClean = fileParts.base.toLowerCase();
    const romBaseClean = romParts.base.toLowerCase();
    const romExt = romParts.ext.toLowerCase();
    if (
      fileBaseClean === romBaseClean &&
      GAME_EXTENSIONS.has(fileExt) &&
      GAME_EXTENSIONS.has(romExt)
    ) {
      if (!fileRegion || !r.region || regionsMatch(fileRegion, r.region)) {
        return r;
      }
    }
  }

  // 2. Canonical title matching engine (using shared titlesMatch)
  for (const r of releases) {
    const romParts = getGameFileParts(r.rom_name);
    const romExt = romParts.ext.toLowerCase();
    if (GAME_EXTENSIONS.has(fileExt) && GAME_EXTENSIONS.has(romExt)) {
      if (
        titlesMatch(fileParts.base, romParts.base, r.rom_name) ||
        normalizeTitleForMatching(fileParts.base) ===
          normalizeTitleForMatching(romParts.base)
      ) {
        if (!fileRegion || !r.region || regionsMatch(fileRegion, r.region)) {
          return r;
        }
      }
    }
  }

  return null;
}

/**
 * Checks if a filename matches a Sonic & Knuckles lock-on combination warning exception.
 *
 * @param filename The backup file name.
 * @returns True if it's one of the lock-on combinations.
 */
function isSonicKnucklesException(filename: string): boolean {
  const nameLower = filename.toLowerCase();
  const exceptions = [
    'sonic & knuckles + sonic the hedgehog (usa, europe) (lock-on combination).md',
    'sonic & knuckles + sonic the hedgehog 2 (world) (rev a) (lock-on combination).md',
    'sonic & knuckles + sonic the hedgehog 3 (usa) (lock-on combination).md',
  ];
  return exceptions.includes(nameLower);
}

/**
 * Main execution method for the backup reconciliation process.
 *
 * @throws Error if database connection fails or input directory is invalid.
 */
function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Error: Please provide the path to your backup directory.');
    console.log('Usage: npx tsx scripts/scan_backups.ts <path-to-backups>');
    process.exit(1);
  }

  const backupDir = path.resolve(args[0]);
  if (!fs.existsSync(backupDir) || !fs.statSync(backupDir).isDirectory()) {
    console.error(`Error: The path "${backupDir}" is not a valid directory.`);
    process.exit(1);
  }

  console.log(`Starting backup scan on: ${backupDir}`);
  console.log(
    'Safety check: Backup folder is treated as strictly read-only.\n',
  );

  const dbPath = path.resolve(process.cwd(), 'collection.sqlite');
  if (!fs.existsSync(dbPath)) {
    console.error(`Error: Database not found at ${dbPath}`);
    process.exit(1);
  }
  const db = new Database(dbPath);

  const dbPlatforms = db
    .prepare('SELECT * FROM platforms')
    .all() as PlatformRow[];

  // Read subdirectories in the backup directory
  const subDirs = fs.readdirSync(backupDir).filter((f) => {
    const fullPath = path.join(backupDir, f);
    return fs.statSync(fullPath).isDirectory();
  });

  if (subDirs.length === 0) {
    console.log('No platform subdirectories found in the backup directory.');
    return;
  }

  // Pre-calculate scanned platform IDs across present subdirectories
  const allScannedPlatformIds = new Set<number>();
  for (const subDir of subDirs) {
    const dbPlatform = findDbPlatform(subDir, dbPlatforms);
    if (dbPlatform) {
      const ids = getScannedPlatformIds(dbPlatform.id, dbPlatforms);
      ids.forEach((id) => allScannedPlatformIds.add(id));
    }
  }

  // Scoped Reset: Only reset platforms being scanned
  if (allScannedPlatformIds.size > 0) {
    const resetPlaceholders = Array.from(allScannedPlatformIds)
      .map(() => '?')
      .join(',');
    console.log(
      `Resetting existing backup status for ${allScannedPlatformIds.size} scanned platform(s)...`,
    );
    db.prepare(
      `UPDATE game_releases SET backup_status = 0 WHERE game_id IN (SELECT stable_id FROM games WHERE platform_id IN (${resetPlaceholders}))`,
    ).run(...allScannedPlatformIds);
  }

  let totalScannedFiles = 0;
  let totalMatchedReleases = 0;
  const platformStats: Record<string, { scanned: number; matched: number }> =
    {};
  const baseNameMismatchAlerts: {
    file: string;
    game: string;
    rom: string;
    platform: string;
  }[] = [];
  const allMatchedReleaseIds = new Set<string>();

  for (const subDir of subDirs) {
    const dbPlatform = findDbPlatform(subDir, dbPlatforms);
    if (!dbPlatform) {
      console.warn(
        `[Platform Skip] Subdirectory "${subDir}" could not be mapped to any database platform.`,
      );
      continue;
    }

    const platformDisplayName = dbPlatform.display_name || dbPlatform.name;
    const subDirPath = path.join(backupDir, subDir);
    console.log(
      `Scanning [${platformDisplayName}] from subdirectory "${subDir}"...`,
    );

    const rawFiles = getFilesRecursive(subDirPath);

    // Filter ignored files, sidecars, artwork, and system directories
    const files = rawFiles.filter((f) => {
      const filename = path.basename(f);
      return !isIgnoredFile(filename);
    });

    if (!platformStats[platformDisplayName]) {
      platformStats[platformDisplayName] = { scanned: 0, matched: 0 };
    }
    platformStats[platformDisplayName].scanned += files.length;
    totalScannedFiles += files.length;

    if (files.length === 0) {
      console.log(
        `  No files found under "${subDir}" after filtering ignored files.`,
      );
      continue;
    }

    // Load game releases for this platform & hierarchy
    const platformIds = getScannedPlatformIds(dbPlatform.id, dbPlatforms);
    const placeholders = platformIds.map(() => '?').join(',');

    const dbReleases = db
      .prepare(
        `
      SELECT r.id, r.game_id, g.title, r.rom_name, g.stable_id, r.region, r.ownership_status, r.variants
      FROM game_releases r
      JOIN games g ON r.game_id = g.stable_id
      WHERE g.platform_id IN (${placeholders}) AND r.rom_name IS NOT NULL
    `,
      )
      .all(...platformIds) as ReleaseRow[];

    // Load all games for fallback title-matching verification
    const platformGames = db
      .prepare(
        `
      SELECT stable_id, title 
      FROM games 
      WHERE platform_id IN (${placeholders})
    `,
      )
      .all(...platformIds) as { stable_id: number; title: string }[];

    const matchesToUpdate: string[] = [];

    for (const file of files) {
      const filename = path.basename(file);
      if (isSonicKnucklesException(filename)) {
        console.log(
          `  [S&K Exception] Skipping unmatched alert for lock-on file: "${filename}"`,
        );
        continue;
      }

      const matched = findBestReleaseMatch(filename, dbReleases);
      if (matched) {
        console.log(
          `  [Match Found] "${filename}" -> "${matched.title}" (${matched.rom_name})`,
        );
        matchesToUpdate.push(matched.id);
        allMatchedReleaseIds.add(matched.id);
        platformStats[platformDisplayName].matched++;
        totalMatchedReleases++;
      }
      const matchedRelease = !!matched;

      if (!matchedRelease) {
        const tolerantMatch = findTolerantReleaseMatch(filename, dbReleases);
        if (tolerantMatch) {
          console.warn(
            `  [ALERT: Base Name Mismatch] Backup file "${filename}" matches game "${tolerantMatch.title}" tolerantly but has differences prior to the extension. Target DB ROM name: "${tolerantMatch.rom_name}"`,
          );
          baseNameMismatchAlerts.push({
            file: filename,
            game: tolerantMatch.title,
            rom: tolerantMatch.rom_name,
            platform: platformDisplayName,
          });
        } else {
          // Fallback title matching: strip parentheticals & extension
          const fileParts = getGameFileParts(filename);
          const normFile = normalizeTitleForMatching(fileParts.base);
          const fileSegments = getTitleSegments(fileParts.base)
            .map((s) => normalizeTitleForMatching(s))
            .filter((s) => s.length >= 3);

          let matchedGameDirect = false;
          let matchedGameTitle = '';
          for (const game of platformGames) {
            const gameNorm = normalizeTitleForMatching(game.title);
            if (gameNorm === normFile || fileSegments.includes(gameNorm)) {
              matchedGameDirect = true;
              matchedGameTitle = game.title;
              break;
            }
          }

          if (matchedGameDirect) {
            console.warn(
              `  [Release Mismatch Warning] Backup file "${filename}" matched game "${matchedGameTitle}" but did not match any physical release in game_releases.`,
            );
          } else {
            console.error(
              `  [ALERT] Backup file "${filename}" on platform "${platformDisplayName}" does not correspond to any game in the database!`,
            );
          }
        }
      }
    }

    if (matchesToUpdate.length > 0) {
      const updateStmt = db.prepare(
        'UPDATE game_releases SET backup_status = 1 WHERE id = ?',
      );
      const transaction = db.transaction(() => {
        for (const releaseId of matchesToUpdate) {
          updateStmt.run(releaseId);
        }
      });
      transaction();
      console.log(
        `  Updated database: marked ${matchesToUpdate.length} release(s) as backed up.`,
      );
    } else {
      console.log('  No backup matches found.');
    }
  }

  // Synchronize games table backup_status for all scanned platforms
  if (allScannedPlatformIds.size > 0) {
    const platPlaceholders = Array.from(allScannedPlatformIds)
      .map(() => '?')
      .join(',');
    db.prepare(
      `UPDATE games SET backup_status = 0 WHERE platform_id IN (${platPlaceholders})`,
    ).run(...allScannedPlatformIds);
    db.prepare(
      `UPDATE games SET backup_status = 1 WHERE stable_id IN (
        SELECT DISTINCT game_id FROM game_releases WHERE backup_status = 1 AND game_id IS NOT NULL
      ) AND platform_id IN (${platPlaceholders})`,
    ).run(...allScannedPlatformIds);
    console.log(
      'Synchronized games.backup_status with game_releases for scanned platforms.',
    );
  }

  // Display scan summary
  console.log('\n========================================');
  console.log('            SCAN SUMMARY');
  console.log('========================================');
  console.log(`Total files scanned: ${totalScannedFiles}`);
  console.log(`Total releases matched & updated: ${totalMatchedReleases}`);
  console.log('\nBreakdown by Platform:');
  for (const [platform, stats] of Object.entries(platformStats)) {
    console.log(`- ${platform}:`);
    console.log(`  Scanned: ${stats.scanned} files`);
    console.log(`  Matched: ${stats.matched} releases`);
  }
  console.log('========================================');

  // Write surgical Cloudflare D1 migration SQL
  const tempDir = path.join(process.cwd(), 'scripts', 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  const sqlOutPath = path.join(tempDir, 'update_backup_status.sql');
  console.log(`Writing surgical Cloudflare D1 migration to: ${sqlOutPath}`);
  let sqlContent =
    '-- Surgical Backup Status Update Migration for Cloudflare D1\n';
  sqlContent += '-- Generated on: ' + new Date().toISOString() + '\n\n';
  sqlContent += 'PRAGMA foreign_keys = OFF;\n\n';

  if (allScannedPlatformIds.size > 0) {
    const platList = Array.from(allScannedPlatformIds).join(', ');
    sqlContent += `-- 1. Reset backup_status only for scanned platforms\n`;
    sqlContent += `UPDATE game_releases SET backup_status = 0 WHERE game_id IN (SELECT stable_id FROM games WHERE platform_id IN (${platList}));\n\n`;
  }

  if (allMatchedReleaseIds.size > 0) {
    sqlContent += `-- 2. Mark matched releases as backed up\n`;
    const releaseArr = Array.from(allMatchedReleaseIds);
    const CHUNK_SIZE = 100;
    for (let i = 0; i < releaseArr.length; i += CHUNK_SIZE) {
      const chunk = releaseArr.slice(i, i + CHUNK_SIZE);
      const escapedIds = chunk
        .map((id) => `'${id.replace(/'/g, "''")}'`)
        .join(', ');
      sqlContent += `UPDATE game_releases SET backup_status = 1 WHERE id IN (${escapedIds});\n`;
    }
    sqlContent += '\n';
  }

  if (allScannedPlatformIds.size > 0) {
    const platList = Array.from(allScannedPlatformIds).join(', ');
    sqlContent += `-- 3. Synchronize games table backup_status\n`;
    sqlContent += `UPDATE games SET backup_status = 0 WHERE platform_id IN (${platList});\n`;
    sqlContent += `UPDATE games SET backup_status = 1 WHERE stable_id IN (SELECT DISTINCT game_id FROM game_releases WHERE backup_status = 1 AND game_id IS NOT NULL) AND platform_id IN (${platList});\n\n`;
  }

  sqlContent += 'PRAGMA foreign_keys = ON;\n';
  fs.writeFileSync(sqlOutPath, sqlContent, 'utf-8');
  console.log(
    `Successfully generated update_backup_status.sql with ${allMatchedReleaseIds.size} matched release(s).`,
  );

  // Write base name mismatch alerts report
  const alertsDir = path.join(process.cwd(), 'scratch');
  if (!fs.existsSync(alertsDir)) {
    fs.mkdirSync(alertsDir, { recursive: true });
  }
  const alertsPath = path.join(
    alertsDir,
    'backup_base_name_mismatch_alerts.md',
  );
  console.log(`Writing base name mismatch alerts to: ${alertsPath}`);
  let alertMd = `# Backup Base Name Mismatch Alerts\n\n`;
  alertMd += `The following is a list of local backup files that match a database release tolerantly (by title or segments) but deviate in their base name prior to the extension. These backups were **not** marked as backed up in the database.\n\n`;
  alertMd += `To resolve these, rename the local backup file to match the database ROM name exactly (except for compressed extensions).\n\n`;
  alertMd += `| Platform | Backup Filename on Disk | Target Game Title | Target Database ROM Name |\n`;
  alertMd += `| --- | --- | --- | --- |\n`;

  for (const a of baseNameMismatchAlerts) {
    alertMd += `| ${a.platform} | ${a.file} | ${a.game} | ${a.rom} |\n`;
  }

  fs.writeFileSync(alertsPath, alertMd, 'utf-8');
  console.log(
    `Successfully generated ${baseNameMismatchAlerts.length} base name mismatch alert(s).`,
  );
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith('scan_backups.ts') ||
    process.argv[1].endsWith('scan_backups.js'))
) {
  main();
}
