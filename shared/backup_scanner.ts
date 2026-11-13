/**
 * ISOMORPHIC WEB BACKUP SCANNER & OWNERSHIP RECONCILIATION ENGINE
 *
 * Pure, environment-agnostic TypeScript library shared between the Angular browser
 * application and Node/Worker test suites.
 *
 * SAFETY & PRIVACY INVARIANTS:
 * - Operates 100% on file and directory names (zero file bytes read, hashed, or uploaded).
 * - Never mutates shared `game_releases` catalog metadata.
 * - Computes surgical per-user diffs for `user_game_releases` (`backup_status`,
 *   plus guarded SKU-level ownership transfers preserving `has_case` and `has_manual`).
 */

import { normalizeTitleForMatching, titlesMatch } from './title_matching.js';
import { extractRegions, isPlatformMatch } from './source_format.js';
import { getRomGroupingKey, stripDiscIndicator } from './queries.js';
import {
  extractRevisionFromVariant,
  extractVersionFromVariant,
  parseNxdumptoolFilename,
  resolveBestSwitchRevisionMatch,
} from './switch_revisions.js';
import { CanonicalRelease } from './canonical_releases.js';

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
  base_title?: string;
  game_slug?: string;
  platform_id?: number;
  platform_name?: string;
  rom_name: string;
  stable_id: number;
  region: string | null;
  ownership_status?: number;
  backup_status?: number;
  has_case?: number;
  has_manual?: number;
  variants?: string | null;
  rom_crc?: string | null;
  serial_code?: string | null;
  canonical_release_id?: number | null;
  is_pack_in?: boolean;
}

export interface CatalogReleaseCandidate {
  id: string;
  game_id: number;
  game_slug?: string;
  title: string;
  base_title?: string;
  platform_id: number;
  platform_name: string;
  rom_name: string | null;
  rom_crc?: string | null;
  serial_code?: string | null;
  region: string | null;
  variants?: string | null;
  canonical_release_id?: number | null;
  ownership_status: number;
  backup_status: number;
  has_case?: number;
  has_manual?: number;
  is_pack_in?: boolean;
}

export interface CrawledFileEntry {
  /** Path relative to selected root (e.g. "SNES/Chrono Trigger (USA).sfc" or "Chrono Trigger (USA).sfc") */
  relativePath: string;
  /** Base filename (e.g. "Chrono Trigger (USA).sfc") */
  fileName: string;
}

export type ReleaseMatchConfidence = 'exact' | 'clean_fallback';

export interface ReleaseMatchResult {
  release: ReleaseRow;
  confidence: ReleaseMatchConfidence;
}

export interface ReleaseDiffRow {
  id: string;
  game_id: number;
  title: string;
  platform_name: string;
  rom_name: string;
  backup_status: number;
  ownership_status?: number;
  region?: string | null;
  variants?: string | null;
  matched_filename?: string;
}

export interface GameDiffRow {
  stable_id: number;
  title: string;
  platform_id: number;
  platform_name: string;
  backup_status?: number;
}

export interface NetDiffResult {
  releases: {
    newlyBackedUp: ReleaseDiffRow[];
    lostBackup: ReleaseDiffRow[];
    unchangedBackedUpCount: number;
    unchangedUnbackedCount: number;
    totalTargetBackedUp: number;
  };
  games: {
    newlyBackedUp: GameDiffRow[];
    lostBackup: GameDiffRow[];
    unchangedBackedUpCount: number;
    unchangedUnbackedCount: number;
    totalTargetBackedUp: number;
  };
}

export interface OwnershipSwitchProposal {
  gameId: number;
  gameSlug: string;
  gameTitle: string;
  platformName: string;
  fromSkuLabel: string;
  fromRegion: string | null;
  fromVariants: string | null;
  fromReleaseIds: string[];
  hasCase: number;
  hasManual: number;
  toSkuLabel: string;
  toRegion: string | null;
  toVariants: string | null;
  toReleaseIds: string[];
  matchedFilenames: string[];
  isRegionChange: boolean;
  /** true when !isRegionChange; false for cross-region switches (explicit opt-in) */
  defaultSelected: boolean;
}

export interface IgnoredBackupFile {
  relativePath: string;
  fileName: string;
  platformName: string | null;
  reason: 'unmatched_catalog_release' | 'unrecognized_platform_folder';
}

export interface BackupScanReport {
  rootFolderName: string;
  detectedMode: 'multi_platform_root' | 'single_platform' | 'platform_override';
  scannedPlatforms: Array<{
    id: number;
    name: string;
    scannedFiles: number;
    matchedReleases: number;
  }>;
  unrecognizedFolders: string[];
  totalScannedFiles: number;
  totalMatchedReleases: number;
  matchedReleaseIds: Set<string>;
  matchedFileByReleaseId: Map<string, string>;
  matchConfidenceByReleaseId: Map<string, ReleaseMatchConfidence>;
  diff: NetDiffResult;
  ownershipSwitches: OwnershipSwitchProposal[];
  ignoredUnmatchedFiles: IgnoredBackupFile[];
}

/**
 * Valid game file extensions to verify base-name matching.
 */
export const GAME_EXTENSIONS = new Set([
  '.psv',
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
  '.unh',
  '.img',
  '.mdf',
  '.nrg',
  '.gen',
  '.smd',
  '.pkg',
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
 * Strips common edition suffixes, subtitles, and DLC add-on phrases from titles
 * so base releases can match their canonical cartridge dumps.
 */
export function stripEditionSuffix(title: string): string {
  return title
    .replace(
      /:\s*(crewmate|definitive|deluxe|ultimate|complete|standard|special|collector'?s?|anniversary|remastered|legacy|hd|plus|plortable|archaeologist|hero|crafted|ultra deluxe|ancestral|the radical dreamers|nintendo switch(?:\s*2)?|deathinitive|warmastered|return to castlevania|owltimate|fully yoked|tv|the prince'?s?|nes|\d+th anniversary)\s*edition/gi,
      '',
    )
    .replace(
      /\s*-\s*(crewmate|definitive|deluxe|ultimate|complete|standard|special|collector'?s?|anniversary|remastered|legacy|hd|plus|plortable|archaeologist|hero|crafted|ultra deluxe|ancestral|the radical dreamers|nintendo switch(?:\s*2)?|deathinitive|warmastered|return to castlevania|owltimate|fully yoked|tv|the prince'?s?|nes)\s*edition/gi,
      '',
    )
    .replace(
      /\s+(definitive|deluxe|ultimate|complete|standard|special|collector'?s?|anniversary|remastered|legacy|plortable|archaeologist|hero|crafted|ancestral|deathinitive|warmastered|owltimate|fully yoked)\s+edition/gi,
      '',
    )
    .replace(/:\s*(?:ultra\s+)?deluxe$/i, '')
    .replace(/\s*\+\s*the hidden treasure of area zero/gi, '')
    .replace(/\s*\+\s*booster course pass/gi, '')
    .replace(/\s*\+\s*expansion pass/gi, '')
    .replace(/\s*\+\s*star-crossed world/gi, '')
    .replace(/\s*\+\s*jamboree tv/gi, '')
    .trim();
}

/**
 * Extracts the basename of a path string (handling both `/` and `\`).
 */
function extractFileNameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const idx = normalized.lastIndexOf('/');
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

/**
 * Splits a filename into its name (without extension) and lowercase extension,
 * matching `path.parse` semantics without requiring `node:path`.
 */
function parseFilenameParts(filename: string): { name: string; ext: string } {
  const baseName = extractFileNameFromPath(filename);
  const lower = baseName.toLowerCase();
  if (lower.endsWith('.xiso.iso')) {
    return {
      name: baseName.slice(0, baseName.length - 9),
      ext: '.xiso.iso',
    };
  }
  const dotIdx = baseName.lastIndexOf('.');
  if (dotIdx <= 0) {
    return { name: baseName, ext: '' };
  }
  return {
    name: baseName.slice(0, dotIdx),
    ext: lower.slice(dotIdx),
  };
}

/**
 * Standardizes platform names to facilitate mapping between folder names and database entries.
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
 * Detects whether a filename is a standalone digital update or DLC package
 * (e.g. `[UPD]`, `[DLC]`, or Switch `nxdumptool` dumps whose 16-hex TitleIDs
 * do not end in `000`).
 */
export function isUpdateOrDlcDump(filename: string): boolean {
  if (/\[(?:upd|dlc|update)\]/i.test(filename)) {
    return true;
  }

  const parsed = parseNxdumptoolFilename(filename);
  if (parsed.isNxdumptool) {
    const segmentsWithTitleId = parsed.segments.filter(
      (s) => s.titleId && /^[0-9A-Fa-f]{16}$/.test(s.titleId),
    );
    if (
      segmentsWithTitleId.length > 0 &&
      segmentsWithTitleId.every(
        (s) => !s.titleId!.toUpperCase().endsWith('000'),
      )
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Checks if a file is an ignored non-backup format, sidecar, save state, or DLC/update dump.
 */
export function isIgnoredFile(filename: string): boolean {
  const baseName = extractFileNameFromPath(filename);
  const lower = baseName.toLowerCase();

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

  // Standalone digital updates and DLC dumps
  if (isUpdateOrDlcDump(baseName)) {
    return true;
  }

  return false;
}

/**
 * Helper to split a filename into base title and extension.
 * Correctly handles double extensions like '.xiso.iso' by stripping both.
 * Also normalizes title format (like converting 'Title, The' to 'The Title').
 */
export function getGameFileParts(filename: string): {
  base: string;
  ext: string;
} {
  const parsed = parseFilenameParts(filename);
  const base = parsed.name;
  const ext = parsed.ext;

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
 */
export function findDbPlatform(
  subDirName: string,
  dbPlatforms: PlatformRow[],
): PlatformRow | null {
  const datClean = cleanPlatformName(subDirName);
  const lowerDat = subDirName.toLowerCase().trim();

  // 1. Check if source_format's isPlatformMatch directly matches any platform
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
    if (pClean === datClean && datClean.length > 0) {
      return p;
    }
  }

  // 4. Substring match: only match if the directory name contains the platform name
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
 * Collapses container folder dumps (Vita / PSP / PS3 / Xbox 360 extracted directories
 * containing `eboot.bin`, `sce_sys/param.sfo`, or `default.xex`) into a single virtual
 * `<FolderName>.zip` entry so internal assets are not scanned as individual unmatched files.
 */
export function collapseContainerDirectories(
  entries: CrawledFileEntry[],
): CrawledFileEntry[] {
  const containerPrefixes = new Set<string>();

  for (const entry of entries) {
    const norm = entry.relativePath
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '');
    const lower = norm.toLowerCase();

    if (lower.endsWith('/eboot.bin') || lower.endsWith('/default.xex')) {
      const slashIdx = norm.lastIndexOf('/');
      if (slashIdx > 0) {
        containerPrefixes.add(norm.slice(0, slashIdx));
      }
    } else if (lower.endsWith('/sce_sys/param.sfo')) {
      const markerIdx = lower.lastIndexOf('/sce_sys/param.sfo');
      if (markerIdx > 0) {
        containerPrefixes.add(norm.slice(0, markerIdx));
      }
    }
  }

  if (containerPrefixes.size === 0) {
    return entries;
  }

  // Sort prefixes shortest-first so outer containers absorb nested ones
  const sortedPrefixes = Array.from(containerPrefixes).sort(
    (a, b) => a.length - b.length,
  );
  const emittedContainers = new Set<string>();
  const result: CrawledFileEntry[] = [];

  for (const entry of entries) {
    const norm = entry.relativePath
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '');
    const matchedPrefix = sortedPrefixes.find((prefix) =>
      norm.toLowerCase().startsWith(prefix.toLowerCase() + '/'),
    );

    if (matchedPrefix) {
      const key = matchedPrefix.toLowerCase();
      if (!emittedContainers.has(key)) {
        emittedContainers.add(key);
        const folderName = extractFileNameFromPath(matchedPrefix);
        result.push({
          relativePath: `${matchedPrefix}.zip`,
          fileName: `${folderName}.zip`,
        });
      }
    } else {
      result.push(entry);
    }
  }

  return result;
}

/**
 * Normalizes region strings to handle common equivalent representations
 * (e.g. NA, USA, North America) when comparing game and release regions.
 */
export function normalizeRegion(region: string | null): string[] {
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
 */
export function regionsMatch(
  reg1: string | null | undefined,
  reg2: string | null | undefined,
): boolean {
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
 */
function getBaseName(filename: string): string {
  return parseFilenameParts(filename).name;
}

/**
 * Normalizes a ROM base name for tolerant comparison by:
 * - Lowercasing and trimming
 * - Stripping Track 1 indicator (e.g. "(Track 1)", "(Track 01)")
 * - Stripping Redump language tags
 * - Stripping disc indicators (e.g. "Disc 1", "(Disc 2)")
 * - Normalizing "Megaman" <-> "Mega Man"
 * - Normalizing regional tag variants: "(USA, Canada)", "(Canada, USA)", "(US)" -> "(USA)"
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
 * Selects the preferred release candidate among equal-confidence matches:
 * 1. Owned release (`ownership_status === 1`) with compatible region
 * 2. Any owned release (`ownership_status === 1`)
 * 3. Region-compatible release
 * 4. Physical cartridge release (excluding Mini / Virtual Console re-releases)
 * 5. First candidate in list
 */
function preferOwnedRelease<
  T extends {
    ownership_status?: number;
    region: string | null;
    variants?: string | null;
  },
>(candidates: T[], fileRegion?: string | null): T {
  if (candidates.length <= 1) return candidates[0];

  const ownedRegionMatch = candidates.find(
    (r) =>
      r.ownership_status === 1 &&
      (!fileRegion || !r.region || regionsMatch(fileRegion, r.region)),
  );
  if (ownedRegionMatch) return ownedRegionMatch;

  const ownedMatch = candidates.find((r) => r.ownership_status === 1);
  if (ownedMatch) return ownedMatch;

  if (fileRegion) {
    const regionMatch = candidates.find(
      (r) => r.region && regionsMatch(fileRegion, r.region),
    );
    if (regionMatch) return regionMatch;
  }

  const physicalCart = candidates.find(
    (r) => !r.variants?.match(/mini|virtual console/i),
  );
  if (physicalCart) return physicalCart;

  return candidates[0];
}

/**
 * Resolves the best physical release match along with its confidence tier:
 * - `'exact'`: Direct ROM base match, Serial Code / Title ID match, or normalized Redump/Track1/Multi-Disc ROM base match.
 * - `'clean_fallback'`: Untagged base-name + region fallback.
 */
export function findBestReleaseMatchWithConfidence(
  filename: string,
  releases: ReleaseRow[],
): ReleaseMatchResult | null {
  const fileParts = getGameFileParts(filename);
  const fileBase = getBaseName(filename).toLowerCase();
  const fileExt = fileParts.ext.toLowerCase();
  const fileDisc = extractDiscNumber(filename);
  const fileRegion = extractRegions(filename);

  // 1. Direct case-insensitive base name match with compatible extension
  const directCandidates: ReleaseRow[] = [];
  for (const r of releases) {
    if (!r.rom_name) continue;
    const romParts = getGameFileParts(r.rom_name);
    const romBase = getBaseName(r.rom_name).toLowerCase();
    const romExt = romParts.ext.toLowerCase();

    const baseMatches = fileBase === romBase;
    const extMatches =
      fileExt === romExt ||
      (GAME_EXTENSIONS.has(fileExt) && GAME_EXTENSIONS.has(romExt));

    if (baseMatches && extMatches) {
      directCandidates.push(r);
    }
  }
  if (directCandidates.length > 0) {
    return {
      release: preferOwnedRelease(directCandidates, fileRegion),
      confidence: 'exact',
    };
  }

  // 1b. Title ID / Serial Code match (e.g. PCSE00120, PCSE-00120, PCSB00074, SLUS-20001, CUSA-11970)
  const fileBaseRaw = getBaseName(filename);
  if (
    /^[A-Z]{3,4}-?\d{4,5}$/i.test(fileBaseRaw) ||
    /^[A-Z]{3,4}-?\d{4,5}$/i.test(fileParts.base)
  ) {
    const cleanFileCode = (fileBaseRaw || fileParts.base)
      .replace(/[^a-z0-9]/gi, '')
      .toUpperCase();
    const serialCandidates = releases.filter((r) => {
      const codeSource =
        r.serial_code ||
        (r.variants && /^[A-Z]{3,4}-?\d{4,5}$/i.test(r.variants.trim())
          ? r.variants.trim()
          : null);
      if (!codeSource) return false;
      const cleanRelCode = codeSource.replace(/[^a-z0-9]/gi, '').toUpperCase();
      return cleanRelCode === cleanFileCode;
    });
    if (serialCandidates.length > 0) {
      return {
        release: preferOwnedRelease(serialCandidates, fileRegion),
        confidence: 'exact',
      };
    }
  }

  // 2. Normalized base name match with multi-disc preservation
  const fileNormBase = normalizeRomBaseForMatching(fileBaseRaw);
  const matchingCandidates: ReleaseRow[] = [];

  for (const r of releases) {
    if (!r.rom_name) continue;
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
    let discFiltered = matchingCandidates;
    if (fileDisc) {
      const discMatches = matchingCandidates.filter(
        (r) => extractDiscNumber(r.rom_name) === fileDisc,
      );
      if (discMatches.length > 0) discFiltered = discMatches;
    } else {
      const disc1Matches = matchingCandidates.filter(
        (r) => extractDiscNumber(r.rom_name) === '1',
      );
      if (disc1Matches.length > 0) discFiltered = disc1Matches;
    }
    return {
      release: preferOwnedRelease(discFiltered, fileRegion),
      confidence: 'exact',
    };
  }

  // 3. Cleaned base name match with region compatibility (e.g. Retro-Bit World reprint matching USA backup)
  const fileBaseClean = fileParts.base.toLowerCase();
  const cleanCandidates: ReleaseRow[] = [];
  for (const r of releases) {
    if (!r.rom_name) continue;
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
    // When the backup filename explicitly carries a region tag (e.g. "(USA)" or "(Japan)"),
    // only treat it as 'exact' if there is a single unambiguous regional candidate or an exact
    // variant match; untagged filenames remain 'clean_fallback'.
    const confidence: ReleaseMatchConfidence =
      fileRegion && cleanCandidates.length === 1 ? 'exact' : 'clean_fallback';

    let discFilteredClean = cleanCandidates;
    if (fileDisc) {
      const discMatches = cleanCandidates.filter(
        (r) => extractDiscNumber(r.rom_name) === fileDisc,
      );
      if (discMatches.length > 0) discFilteredClean = discMatches;
    }

    return {
      release: preferOwnedRelease(discFilteredClean, fileRegion),
      confidence,
    };
  }

  return null;
}

/**
 * Resolves the best physical release match for a given backup file.
 */
export function findBestReleaseMatch(
  filename: string,
  releases: ReleaseRow[],
): ReleaseRow | null {
  return (
    findBestReleaseMatchWithConfidence(filename, releases)?.release ?? null
  );
}

/**
 * Identifies a tolerant release match for alerting when base name mismatch occurs.
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
    if (!r.rom_name) continue;
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
    if (!r.rom_name) continue;
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
    if (!r.rom_name) continue;
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
 */
export function isSonicKnucklesException(filename: string): boolean {
  const nameLower = extractFileNameFromPath(filename).toLowerCase();
  const exceptions = [
    'sonic & knuckles + sonic the hedgehog (usa, europe) (lock-on combination).md',
    'sonic & knuckles + sonic the hedgehog 2 (world) (rev a) (lock-on combination).md',
    'sonic & knuckles + sonic the hedgehog 3 (usa) (lock-on combination).md',
  ];
  return exceptions.includes(nameLower);
}

/**
 * Checks if a release row is a pack-in demo bonus disc that shares a host `game_id`
 * and should be excluded from competing with main retail SKUs during ownership reassignment.
 */
export function isPackInDemoRelease(r: {
  platform_id?: number;
  rom_name?: string | null;
  is_pack_in?: boolean;
}): boolean {
  if (r.is_pack_in) return true;
  if (!r.rom_name) return false;
  return (
    (r.platform_id === 29 &&
      /^mega man legends 2.*\(demo\)/i.test(r.rom_name)) ||
    (r.platform_id === 30 &&
      /^metal gear solid 2 - sons of liberty - trial edition.*\(demo\)/i.test(
        r.rom_name,
      )) ||
    (r.platform_id === 30 &&
      /^final fantasy xii\s*\(usa\)\s*\(demo\)/i.test(r.rom_name))
  );
}

/**
 * Strips trailing bundle/pack descriptors as well as edition suffixes for multi-game
 * cartridge title comparison (e.g. "Subnautica + Subnautica Below Zero Double Pack" -> "Subnautica + Subnautica Below Zero").
 */
function stripMultiGamePackaging(title: string): string {
  return stripEditionSuffix(
    title
      .replace(
        /\s*(?:[-:]\s*)?\b(?:double pack|twin pack|triple pack|pawsome pack|bundle)\b$/i,
        '',
      )
      .trim(),
  );
}

/**
 * Splits a multi-game catalog title into constituent sub-game titles, expanding shorthand
 * patterns such as "Pikmin 1+2 Bundle", "Pico Park 1+2", or "Axiom Verge 1 & 2 Double Pack".
 */
function splitCatalogMultiGameTitle(title: string): string[] {
  const cleaned = stripMultiGamePackaging(title);
  const shorthand12 = cleaned.match(/^(.+?)\s+1\s*(?:\+|&|\/)\s*2$/i);
  if (shorthand12) {
    const prefix = shorthand12[1].trim();
    return [prefix, `${prefix} 2`];
  }
  const parts = cleaned
    .split(/\s*(?:\+|\/|&)\s*/)
    .map((p) => stripMultiGamePackaging(p.trim()))
    .filter(Boolean);
  return parts.length > 1 ? parts : [];
}

/**
 * Matches a Nintendo Switch 1 (26) or Switch 2 (27) `nxdumptool` filename against
 * catalog releases on that platform.
 */
export function matchSwitchNxdumptoolRelease(
  filename: string,
  platformId: number,
  platformReleases: CatalogReleaseCandidate[],
): ReleaseMatchResult | null {
  if (platformId !== 26 && platformId !== 27) {
    return null;
  }

  const parsed = parseNxdumptoolFilename(filename);
  if (!parsed.isNxdumptool) {
    return null;
  }

  const compMappings: Record<string, string> = {
    'asteroids: recharged + breakout: recharged':
      'atari recharged collection 1',
    'black widow: recharged + centipede: recharged':
      'atari recharged collection 2',
    'gravitar: recharged + missile command: recharged':
      'atari recharged collection 3',
    'caverns of mars: recharged + yars: recharged':
      'atari recharged collection 4',
    '20xx + 30xx': '20xx / 30xx',
    'axiom verge + axiom verge 2': 'axiom verge 1 & 2 double pack',
    'child of light + valiant hearts: the great war':
      'child of light: ultimate edition + valiant hearts: the great war',
    'child of light: ultimate edition + valiant hearts: the great war':
      'child of light: ultimate edition + valiant hearts: the great war',
    'ori and the blind forest: definitive edition + ori and the will of the wisps':
      'ori: the collection',
    'ori and the blind forest + ori and the will of the wisps':
      'ori: the collection',
    'guacamelee! super turbo championship edition + guacamelee! 2':
      'guacamelee! one-two punch collection',
    'pikmin + pikmin 2': 'pikmin 1+2 bundle',
    'pikmin 1 + pikmin 2': 'pikmin 1+2 bundle',
    'pico park + pico park 2': 'pico park 1+2',
    'subnautica + subnautica: below zero':
      'subnautica + subnautica below zero double pack',
    'bioshock remastered + bioshock 2 remastered + bioshock infinite: the complete edition':
      'bioshock: the collection',
    'doom (1993) + doom ii + doom 3': 'doom: the classics collection',
    'monument valley + monument valley 2 + monument valley 3':
      'monument valley: the trilogy',
    "oddworld: new 'n' tasty + oddworld: munch's oddysee + oddworld: stranger's wrath":
      'oddworld collection',
    'dave the diver + the art of dave the diver':
      'dave the diver: anniversary edition',
    'final fantasy + final fantasy ii + final fantasy iii + final fantasy iv + final fantasy v':
      'final fantasy: pixel remaster collection',
    'final fantasy + final fantasy ii + final fantasy iii + final fantasy iv + final fantasy v + final fantasy vi':
      'final fantasy: pixel remaster collection',
  };

  // Deduplicate games on this platform by game_id (stable_id)
  const gamesMap = new Map<
    number,
    { stable_id: number; title: string; base_title: string }
  >();
  for (const r of platformReleases) {
    if (!gamesMap.has(r.game_id)) {
      gamesMap.set(r.game_id, {
        stable_id: r.game_id,
        title: r.title,
        base_title: r.base_title || r.title,
      });
    }
  }
  const platformGames = Array.from(gamesMap.values());

  let matchedGameId: number | null = null;
  const compKey = parsed.compositeTitle.toLowerCase();
  const strippedCompKey = parsed.segments
    .map((s) => stripMultiGamePackaging(s.cleanTitle).toLowerCase())
    .join(' + ');

  const mappedTarget = compMappings[compKey] || compMappings[strippedCompKey];
  if (mappedTarget) {
    const targetNorm = normalizeTitleForMatching(mappedTarget);
    const found = platformGames.find(
      (g) =>
        normalizeTitleForMatching(g.base_title) === targetNorm ||
        normalizeTitleForMatching(g.title) === targetNorm,
    );
    if (found) matchedGameId = found.stable_id;
  }

  // Generic multi-game cartridge matching (run BEFORE single-segment matching so multi-game
  // cards do not prematurely match a standalone single game on the same platform)
  if (matchedGameId === null && parsed.segments.length > 1) {
    const compNorm = normalizeTitleForMatching(
      stripMultiGamePackaging(parsed.compositeTitle),
    );
    const compNormRoman = normalizeTitleForMatching(
      stripMultiGamePackaging(parsed.compositeTitle),
      true,
    );
    const segNorms = parsed.segments.map((s) =>
      normalizeTitleForMatching(stripMultiGamePackaging(s.cleanTitle)),
    );
    const segNormsRoman = parsed.segments.map((s) =>
      normalizeTitleForMatching(stripMultiGamePackaging(s.cleanTitle), true),
    );

    // 1. Direct or edition-stripped composite title match
    const directCompositeMatch = platformGames.find((g) => {
      const gClean = stripMultiGamePackaging(g.base_title);
      const tClean = stripMultiGamePackaging(g.title);
      return (
        normalizeTitleForMatching(gClean) === compNorm ||
        normalizeTitleForMatching(tClean) === compNorm ||
        normalizeTitleForMatching(gClean, true) === compNormRoman ||
        normalizeTitleForMatching(tClean, true) === compNormRoman
      );
    });

    if (directCompositeMatch) {
      matchedGameId = directCompositeMatch.stable_id;
    }

    // 2. Constituent segment-by-segment match against `+`, `/`, or `&` catalog titles
    if (matchedGameId === null) {
      const splitMatch = platformGames.find((g) => {
        const parts = splitCatalogMultiGameTitle(g.base_title);
        if (parts.length !== parsed.segments.length) return false;
        return parts.every((part, idx) => {
          const pNorm = normalizeTitleForMatching(part);
          const pNormRoman = normalizeTitleForMatching(part, true);
          return (
            pNorm === segNorms[idx] ||
            pNormRoman === segNormsRoman[idx] ||
            titlesMatch(
              part,
              parsed.segments[idx].cleanTitle,
              filename,
              platformId,
            )
          );
        });
      });
      if (splitMatch) {
        matchedGameId = splitMatch.stable_id;
      }
    }

    // 3. Shared franchise prefix matching a single `<Franchise>: ... Collection / Trilogy / Pack / Bundle`
    if (matchedGameId === null) {
      const segWordArrays = parsed.segments.map((s) =>
        stripMultiGamePackaging(s.cleanTitle)
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter(Boolean),
      );
      if (segWordArrays.length > 0 && segWordArrays[0].length > 0) {
        const firstSegWords = segWordArrays[0];
        let commonWordCount = 0;
        while (
          commonWordCount < firstSegWords.length &&
          segWordArrays.every(
            (arr) => arr[commonWordCount] === firstSegWords[commonWordCount],
          )
        ) {
          commonWordCount++;
        }
        const sharedPrefixNorm = normalizeTitleForMatching(
          firstSegWords.slice(0, Math.max(1, commonWordCount)).join(' '),
        );
        if (sharedPrefixNorm && sharedPrefixNorm.length >= 3) {
          const franchiseCollections = platformGames.filter((g) => {
            const gNorm = normalizeTitleForMatching(g.base_title, true);
            return (
              gNorm.startsWith(sharedPrefixNorm) &&
              /\b(collection|trilogy|pack|bundle|anniversary)\b/i.test(
                g.base_title,
              )
            );
          });
          if (franchiseCollections.length === 1) {
            matchedGameId = franchiseCollections[0].stable_id;
          }
        }
      }
    }
  }

  // Single-segment exact & edition-stripped matching
  if (matchedGameId === null) {
    for (const seg of parsed.segments) {
      const segNorm = normalizeTitleForMatching(seg.cleanTitle);
      const exactFound = platformGames.find((g) => {
        const gNorm = normalizeTitleForMatching(g.base_title);
        const titleNorm = normalizeTitleForMatching(g.title);
        return gNorm === segNorm || titleNorm === segNorm;
      });
      if (exactFound) {
        matchedGameId = exactFound.stable_id;
        break;
      }

      const strippedSegNorm = normalizeTitleForMatching(
        stripEditionSuffix(seg.cleanTitle),
      );
      const strippedFound = platformGames.find((g) => {
        const strippedNorm = normalizeTitleForMatching(
          stripEditionSuffix(g.base_title),
        );
        return strippedNorm === segNorm || strippedNorm === strippedSegNorm;
      });
      if (strippedFound) {
        matchedGameId = strippedFound.stable_id;
        break;
      }
    }
  }

  if (matchedGameId === null && parsed.segments.length > 0) {
    const segClean = parsed.segments[0].cleanTitle;
    const toTokenStr = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(Boolean)
        .sort()
        .join(' ');

    for (const g of platformGames) {
      if (
        titlesMatch(g.base_title, segClean, filename, platformId) ||
        titlesMatch(
          stripEditionSuffix(g.base_title),
          segClean,
          filename,
          platformId,
        ) ||
        toTokenStr(g.base_title) === toTokenStr(segClean)
      ) {
        matchedGameId = g.stable_id;
        break;
      }
    }
  }

  if (matchedGameId === null) {
    return null;
  }

  const gameRels = platformReleases.filter((r) => r.game_id === matchedGameId);
  if (gameRels.length === 0) {
    return null;
  }

  const defaultRel =
    gameRels.find((r) => r.ownership_status === 1) || gameRels[0];

  // Prioritize owned releases and releases matching defaultRel's region so equal-revision
  // candidates across regions never lose to alphabetical region ordering ("Europe" < "USA")
  const sortedGameRels = [...gameRels].sort((a, b) => {
    const aOwned = a.ownership_status === 1 ? 1 : 0;
    const bOwned = b.ownership_status === 1 ? 1 : 0;
    if (aOwned !== bOwned) return bOwned - aOwned;
    const aReg =
      defaultRel?.region &&
      a.region &&
      regionsMatch(defaultRel.region, a.region)
        ? 1
        : 0;
    const bReg =
      defaultRel?.region &&
      b.region &&
      regionsMatch(defaultRel.region, b.region)
        ? 1
        : 0;
    return bReg - aReg;
  });

  // Build CanonicalRelease candidates from the game's catalog releases
  const canonicalCandidates: Array<CanonicalRelease & { _releaseId: string }> =
    sortedGameRels.map((r, idx) => ({
      id: r.canonical_release_id ?? idx + 1,
      _releaseId: r.id,
      platform_id: r.platform_id,
      raw_title: r.base_title || r.title,
      normalized_title: normalizeTitleForMatching(r.base_title || r.title),
      region: r.region,
      variants: r.variants ?? null,
      rom_name: r.rom_name,
      rom_crc: r.rom_crc ?? null,
      serial_code: r.serial_code ?? null,
      source: 'nintendo_revised',
      is_verified_physical: 1,
    }));

  const bestRev = resolveBestSwitchRevisionMatch(
    parsed,
    canonicalCandidates,
    defaultRel?.region,
  );

  const bestRevReleaseId = (
    bestRev as (CanonicalRelease & { _releaseId?: string }) | null
  )?._releaseId;

  let targetRel =
    (bestRev
      ? (bestRevReleaseId
          ? sortedGameRels.find((r) => r.id === bestRevReleaseId)
          : undefined) ||
        sortedGameRels.find(
          (r) =>
            (bestRev.id && r.canonical_release_id === bestRev.id) ||
            (bestRev.variants &&
              r.variants &&
              r.variants.toLowerCase().trim() ===
                bestRev.variants.toLowerCase().trim() &&
              (!bestRev.region ||
                !r.region ||
                r.region.toLowerCase() === bestRev.region.toLowerCase())),
        ) ||
        sortedGameRels.find(
          (r) =>
            bestRev.variants &&
            r.variants &&
            r.variants.toLowerCase().trim() ===
              bestRev.variants.toLowerCase().trim(),
        )
      : undefined) || defaultRel;

  if (!targetRel) {
    return null;
  }

  // Guard against false cross-region or unindexed-variant switches when the user owns defaultRel:
  // nxdumptool filenames do not carry region tags, so if defaultRel is owned and either:
  // (a) has identical revision/version metadata to targetRel across a different region, or
  // (b) is an untagged default SKU (`variants === null`) and the dump is a base `[v0]` cartridge
  //     whereas targetRel is in a different region,
  // preserve the user's owned release (`defaultRel`).
  if (
    defaultRel &&
    defaultRel.ownership_status === 1 &&
    targetRel.id !== defaultRel.id
  ) {
    const defVer = extractVersionFromVariant(defaultRel.variants);
    const tgtVer = extractVersionFromVariant(targetRel.variants);
    const defRev = extractRevisionFromVariant(defaultRel.variants);
    const tgtRev = extractRevisionFromVariant(targetRel.variants);

    const sameVersionAndRev =
      Boolean(defaultRel.variants && targetRel.variants) &&
      (defaultRel.variants!.toLowerCase().trim() ===
        targetRel.variants!.toLowerCase().trim() ||
        (defVer !== null && defVer === tgtVer && defRev === tgtRev));

    const isCrossRegionUntaggedBase =
      !defaultRel.variants &&
      (parsed.segments[0]?.versionInt ?? 0) === 0 &&
      Boolean(
        defaultRel.region &&
        targetRel.region &&
        !regionsMatch(defaultRel.region, targetRel.region),
      );

    if (sameVersionAndRev || isCrossRegionUntaggedBase) {
      targetRel = defaultRel;
    }
  }

  return {
    release: {
      id: targetRel.id,
      game_id: targetRel.game_id,
      title: targetRel.title,
      base_title: targetRel.base_title,
      game_slug: targetRel.game_slug,
      platform_id: targetRel.platform_id,
      platform_name: targetRel.platform_name,
      rom_name: targetRel.rom_name || filename,
      stable_id: targetRel.game_id,
      region: targetRel.region,
      ownership_status: targetRel.ownership_status,
      backup_status: targetRel.backup_status,
      has_case: targetRel.has_case,
      has_manual: targetRel.has_manual,
      variants: targetRel.variants,
      rom_crc: targetRel.rom_crc,
      serial_code: targetRel.serial_code,
      canonical_release_id: targetRel.canonical_release_id,
    },
    confidence: 'exact',
  };
}

/**
 * Fallback matcher for catalog releases whose `rom_name` is `null` (or `-default` placeholder
 * releases, such as modern disc/cartridge games not yet linked to a Redump/No-Intro DAT filename).
 *
 * Returns `'exact'` when matched by an explicit disc/cartridge serial code (e.g. `CUSA-11970`),
 * or `'clean_fallback'` when matched by normalized title against an unlinked release so that
 * `computeOwnershipSwitches` never proposes a false SKU switch from a title-only fallback.
 */
export function matchUnlinkedCatalogRelease(
  filename: string,
  platformId: number,
  platReleases: CatalogReleaseCandidate[],
): ReleaseMatchResult | null {
  const fileParts = getGameFileParts(filename);
  const fileBaseRaw = getBaseName(filename);
  const fileExt = fileParts.ext.toLowerCase();
  const fileRegion = extractRegions(filename);

  const toReleaseRow = (r: CatalogReleaseCandidate): ReleaseRow => ({
    id: r.id,
    game_id: r.game_id,
    title: r.title,
    base_title: r.base_title,
    game_slug: r.game_slug,
    platform_id: r.platform_id,
    platform_name: r.platform_name,
    rom_name: r.rom_name || filename,
    stable_id: r.game_id,
    region: r.region,
    ownership_status: r.ownership_status,
    backup_status: r.backup_status,
    has_case: r.has_case,
    has_manual: r.has_manual,
    variants: r.variants,
    rom_crc: r.rom_crc,
    serial_code: r.serial_code,
    canonical_release_id: r.canonical_release_id,
    is_pack_in: r.is_pack_in,
  });

  // 1. Check serial code / Title ID across all releases on the platform (including rom_name === null)
  if (
    /^[A-Z]{3,4}-?\d{4,5}$/i.test(fileBaseRaw) ||
    /^[A-Z]{3,4}-?\d{4,5}$/i.test(fileParts.base)
  ) {
    const cleanFileCode = (fileBaseRaw || fileParts.base)
      .replace(/[^a-z0-9]/gi, '')
      .toUpperCase();
    const serialCandidates = platReleases.filter((r) => {
      const codeSource =
        r.serial_code ||
        (r.variants && /^[A-Z]{3,4}-?\d{4,5}$/i.test(r.variants.trim())
          ? r.variants.trim()
          : null);
      if (!codeSource) return false;
      return (
        codeSource.replace(/[^a-z0-9]/gi, '').toUpperCase() === cleanFileCode
      );
    });
    if (serialCandidates.length > 0) {
      const chosen = preferOwnedRelease(serialCandidates, fileRegion);
      return { release: toReleaseRow(chosen), confidence: 'exact' };
    }
  }

  if (!GAME_EXTENSIONS.has(fileExt)) {
    return null;
  }

  // 2. Match clean title against games on the platform that have unlinked releases (`!r.rom_name` or `-default`)
  const gamesMap = new Map<
    number,
    { stable_id: number; title: string; base_title: string }
  >();
  for (const r of platReleases) {
    if (!gamesMap.has(r.game_id)) {
      gamesMap.set(r.game_id, {
        stable_id: r.game_id,
        title: r.title,
        base_title: r.base_title || r.title,
      });
    }
  }
  const platformGames = Array.from(gamesMap.values());

  const fileNorm = normalizeTitleForMatching(fileParts.base);
  const strippedFileNorm = normalizeTitleForMatching(
    stripEditionSuffix(fileParts.base),
  );
  if (!fileNorm) {
    return null;
  }

  let matchedGame = platformGames.find((g) => {
    const gNorm = normalizeTitleForMatching(g.base_title);
    const tNorm = normalizeTitleForMatching(g.title);
    return gNorm === fileNorm || tNorm === fileNorm;
  });

  if (!matchedGame && strippedFileNorm) {
    matchedGame = platformGames.find((g) => {
      const strippedGNorm = normalizeTitleForMatching(
        stripEditionSuffix(g.base_title),
      );
      return (
        strippedGNorm === fileNorm ||
        strippedGNorm === strippedFileNorm ||
        normalizeTitleForMatching(g.base_title) === strippedFileNorm
      );
    });
  }

  if (!matchedGame) {
    const segments = getTitleSegments(fileParts.base);
    if (segments.length > 1) {
      for (const seg of segments) {
        const segNorm = normalizeTitleForMatching(seg);
        if (!segNorm) continue;
        const found = platformGames.find(
          (g) =>
            normalizeTitleForMatching(g.base_title) === segNorm ||
            normalizeTitleForMatching(g.title) === segNorm,
        );
        if (found) {
          matchedGame = found;
          break;
        }
      }
    }
  }

  if (!matchedGame) {
    matchedGame = platformGames.find((g) =>
      titlesMatch(fileParts.base, g.base_title, filename, platformId),
    );
  }

  if (!matchedGame) {
    return null;
  }

  const gameRels = platReleases.filter(
    (r) => r.game_id === matchedGame!.stable_id,
  );
  const unlinkedRels = gameRels.filter(
    (r) => !r.rom_name || r.id.endsWith('-default'),
  );
  if (unlinkedRels.length === 0) {
    return null;
  }

  const chosen = preferOwnedRelease(unlinkedRels, fileRegion);
  return {
    release: toReleaseRow(chosen),
    confidence: 'clean_fallback',
  };
}

/**
 * Computes a human-readable SKU label for a group of releases (e.g. "USA • Rev 1" or "USA • Standard").
 */
export function formatSkuLabel(
  releases: Array<{
    region: string | null;
    variants?: string | null;
    rom_name?: string | null;
    id: string;
  }>,
): string {
  if (releases.length === 0) return 'Standard';
  const primary = releases[0];
  const regionPart = primary.region || 'World';
  let variantPart = (primary.variants || '').trim();

  if (!variantPart && primary.rom_name) {
    const revMatch = primary.rom_name.match(
      /\((rev\s*[a-z0-9.]+|v[0-9]+\.[0-9a-z.]+|greatest hits|player'?s choice|platinum|limited edition|collector'?s edition|goty|game of the year edition)\)/i,
    );
    if (revMatch) {
      variantPart = revMatch[1];
    }
  }

  const discSuffix = releases.length > 1 ? ` (${releases.length} Discs)` : '';
  return `${regionPart} • ${variantPart || 'Standard'}${discSuffix}`;
}

/**
 * Computes SKU-level ownership switch proposals (`Owned SKU A → Matched SKU B`)
 * subject to all five safety invariants:
 * 1. SKU-group granularity (partial multi-disc dumps confirm the owned SKU; target multi-disc SKUs transfer ownership across all discs).
 * 2. Unambiguous 1-to-1 replacement (0 owned SKUs matched, 1 owned unmatched SKU, 1 unowned matched SKU).
 * 3. Pack-in demo / companion disc exclusion.
 * 4. Explicit filename evidence only (`'exact'` confidence required; `'clean_fallback'` never proposes ownership switches).
 * 5. Region-aware defaults (same-region pre-selected, cross-region unchecked with `isRegionChange: true`).
 */
export function computeOwnershipSwitches(
  scannedReleases: CatalogReleaseCandidate[],
  matchedReleaseIds: Set<string>,
  matchConfidenceByReleaseId: Map<string, ReleaseMatchConfidence>,
  matchedFileByReleaseId: Map<string, string>,
): OwnershipSwitchProposal[] {
  const releasesByGame = new Map<number, CatalogReleaseCandidate[]>();
  for (const r of scannedReleases) {
    // Guard 3: Exclude pack-in demo / companion discs from competing with main retail SKUs
    if (isPackInDemoRelease(r)) {
      continue;
    }
    if (!releasesByGame.has(r.game_id)) {
      releasesByGame.set(r.game_id, []);
    }
    releasesByGame.get(r.game_id)!.push(r);
  }

  const proposals: OwnershipSwitchProposal[] = [];

  for (const [gameId, gameReleases] of releasesByGame.entries()) {
    if (gameReleases.length < 2) continue;

    // Guard 1: Group game releases into retail SKUs
    const skuMap = new Map<string, CatalogReleaseCandidate[]>();
    for (const r of gameReleases) {
      const romKey = r.rom_name ? getRomGroupingKey(r.rom_name) : '';
      const isMultiDisc = romKey.startsWith('multi:');
      const variantPart = (r.variants || '')
        .replace(/^(?:disc|disco|disque|disk|side)\s+[a-z0-9]+$/i, '')
        .trim()
        .toLowerCase();
      const skuKey = isMultiDisc
        ? `${r.game_id}__${(r.region || '').toLowerCase()}__${variantPart}__${romKey}`
        : `single__${r.id}`;

      if (!skuMap.has(skuKey)) {
        skuMap.set(skuKey, []);
      }
      skuMap.get(skuKey)!.push(r);
    }

    const skus = Array.from(skuMap.values()).map((rels) => {
      const sorted = [...rels].sort((a, b) =>
        (a.rom_name || a.id).localeCompare(b.rom_name || b.id),
      );
      const isOwned = sorted.some((r) => r.ownership_status === 1);
      const isMatchedInScan = sorted.some((r) => matchedReleaseIds.has(r.id));
      const hasExactMatch = sorted.some(
        (r) => matchConfidenceByReleaseId.get(r.id) === 'exact',
      );
      return {
        releases: sorted,
        isOwned,
        isMatchedInScan,
        hasExactMatch,
      };
    });

    const ownedMatchedSkus = skus.filter((s) => s.isOwned && s.isMatchedInScan);
    const ownedUnmatchedSkus = skus.filter(
      (s) => s.isOwned && !s.isMatchedInScan,
    );
    const unownedMatchedSkus = skus.filter(
      (s) => !s.isOwned && s.isMatchedInScan,
    );

    // Guard 2: Strictly 0 owned matched SKUs, 1 owned unmatched SKU, and 1 unowned matched SKU
    if (
      ownedMatchedSkus.length !== 0 ||
      ownedUnmatchedSkus.length !== 1 ||
      unownedMatchedSkus.length !== 1
    ) {
      continue;
    }

    const fromSku = ownedUnmatchedSkus[0];
    const toSku = unownedMatchedSkus[0];

    // Guard 4: Require explicit 'exact' filename evidence on the target SKU
    if (!toSku.hasExactMatch) {
      continue;
    }

    const primaryFrom = fromSku.releases[0];
    const primaryTo = toSku.releases[0];

    // Guard 5: Region compatibility check for default selection
    const fromRegion = primaryFrom.region;
    const toRegion = primaryTo.region;
    const isRegionChange = Boolean(
      fromRegion && toRegion && !regionsMatch(fromRegion, toRegion),
    );

    const hasCase = fromSku.releases.some((r) => (r.has_case ?? 0) === 1)
      ? 1
      : 0;
    const hasManual = fromSku.releases.some((r) => (r.has_manual ?? 0) === 1)
      ? 1
      : 0;

    const matchedFilenames = Array.from(
      new Set(
        toSku.releases
          .map((r) => matchedFileByReleaseId.get(r.id))
          .filter((f): f is string => Boolean(f)),
      ),
    );

    proposals.push({
      gameId,
      gameSlug: primaryFrom.game_slug || String(gameId),
      gameTitle: primaryFrom.base_title || primaryFrom.title,
      platformName: primaryFrom.platform_name,
      fromSkuLabel: formatSkuLabel(fromSku.releases),
      fromRegion,
      fromVariants: primaryFrom.variants ?? null,
      fromReleaseIds: fromSku.releases
        .filter((r) => r.ownership_status === 1)
        .map((r) => r.id),
      hasCase,
      hasManual,
      toSkuLabel: formatSkuLabel(toSku.releases),
      toRegion,
      toVariants: primaryTo.variants ?? null,
      toReleaseIds: toSku.releases.map((r) => r.id),
      matchedFilenames,
      isRegionChange,
      defaultSelected: !isRegionChange,
    });
  }

  return proposals.sort(
    (a, b) =>
      a.platformName.localeCompare(b.platformName) ||
      a.gameTitle.localeCompare(b.gameTitle),
  );
}

export function computeBackupNetDiffs(
  priorReleases: ReleaseDiffRow[],
  priorGames: GameDiffRow[],
  matchedReleaseIds: Set<string>,
): NetDiffResult {
  const newlyBackedUpReleases: ReleaseDiffRow[] = [];
  const lostBackupReleases: ReleaseDiffRow[] = [];
  let unchangedBackedUpReleasesCount = 0;
  let unchangedUnbackedReleasesCount = 0;

  for (const r of priorReleases) {
    const isMatched = matchedReleaseIds.has(r.id);
    if (isMatched) {
      if (r.backup_status === 0) {
        newlyBackedUpReleases.push(r);
      } else {
        unchangedBackedUpReleasesCount++;
      }
    } else {
      if (r.backup_status === 1) {
        lostBackupReleases.push(r);
      } else {
        unchangedUnbackedReleasesCount++;
      }
    }
  }

  const releasesByGame = new Map<number, ReleaseDiffRow[]>();
  for (const r of priorReleases) {
    if (!releasesByGame.has(r.game_id)) {
      releasesByGame.set(r.game_id, []);
    }
    releasesByGame.get(r.game_id)!.push(r);
  }

  const newlyBackedUpGames: GameDiffRow[] = [];
  const lostBackupGames: GameDiffRow[] = [];
  let unchangedBackedUpGamesCount = 0;
  let unchangedUnbackedGamesCount = 0;

  for (const g of priorGames) {
    const gRels = releasesByGame.get(g.stable_id) || [];
    const owned = gRels.filter((r) => r.ownership_status === 1);
    const targetRels = owned.length > 0 ? owned : gRels;

    const priorBackedUp =
      g.backup_status !== undefined
        ? g.backup_status
        : targetRels.length > 0 &&
            targetRels.every((r) => r.backup_status === 1)
          ? 1
          : 0;

    const isTargetBackedUp =
      targetRels.length > 0 &&
      targetRels.every((r) => matchedReleaseIds.has(r.id));

    if (isTargetBackedUp) {
      if (priorBackedUp === 0) {
        newlyBackedUpGames.push({ ...g, backup_status: 1 });
      } else {
        unchangedBackedUpGamesCount++;
      }
    } else {
      if (priorBackedUp === 1) {
        lostBackupGames.push({ ...g, backup_status: 0 });
      } else {
        unchangedUnbackedGamesCount++;
      }
    }
  }

  return {
    releases: {
      newlyBackedUp: newlyBackedUpReleases,
      lostBackup: lostBackupReleases,
      unchangedBackedUpCount: unchangedBackedUpReleasesCount,
      unchangedUnbackedCount: unchangedUnbackedReleasesCount,
      totalTargetBackedUp:
        newlyBackedUpReleases.length + unchangedBackedUpReleasesCount,
    },
    games: {
      newlyBackedUp: newlyBackedUpGames,
      lostBackup: lostBackupGames,
      unchangedBackedUpCount: unchangedBackedUpGamesCount,
      unchangedUnbackedCount: unchangedUnbackedGamesCount,
      totalTargetBackedUp:
        newlyBackedUpGames.length + unchangedBackedUpGamesCount,
    },
  };
}

export function generateBackupDiffMarkdown(
  diff: NetDiffResult,
  platformStats: Record<string, { scanned: number; matched: number }>,
  scanDir: string,
  mode: 'DRY RUN' | 'APPLY',
): string {
  let md = `# Backup Scan Net Diff Report\n\n`;
  md += `- **Date:** ${new Date().toISOString()}\n`;
  md += `- **Scanned Directory:** \`${scanDir}\`\n`;
  md += `- **Execution Mode:** \`${mode}\`\n\n`;

  md += `## Overall Summary\n\n`;
  md += `| Category | + Newly Backed Up (0 -> 1) | - Lost Backup (1 -> 0) | = Unchanged (1 -> 1) | Total Target Backed Up |\n`;
  md += `| --- | --- | --- | --- | --- |\n`;
  md += `| **Releases** | ${diff.releases.newlyBackedUp.length} | ${diff.releases.lostBackup.length} | ${diff.releases.unchangedBackedUpCount} | ${diff.releases.totalTargetBackedUp} |\n`;
  md += `| **Games** | ${diff.games.newlyBackedUp.length} | ${diff.games.lostBackup.length} | ${diff.games.unchangedBackedUpCount} | ${diff.games.totalTargetBackedUp} |\n\n`;

  md += `## Platform Breakdown\n\n`;
  md += `| Platform | Files Scanned | Releases Matched |\n`;
  md += `| --- | --- | --- |\n`;
  for (const [plat, stats] of Object.entries(platformStats)) {
    md += `| ${plat} | ${stats.scanned} | ${stats.matched} |\n`;
  }
  md += `\n`;

  if (diff.releases.newlyBackedUp.length > 0) {
    md += `## Newly Backed Up Releases (+0 -> 1) (${diff.releases.newlyBackedUp.length})\n\n`;
    md += `| Platform | Game Title | ROM Name | Release ID |\n`;
    md += `| --- | --- | --- | --- |\n`;
    for (const r of diff.releases.newlyBackedUp) {
      md += `| ${r.platform_name} | ${r.title} | ${r.rom_name} | \`${r.id}\` |\n`;
    }
    md += `\n`;
  }

  if (diff.releases.lostBackup.length > 0) {
    md += `## Releases Losing Backup Status (-1 -> 0) (${diff.releases.lostBackup.length})\n\n`;
    md += `| Platform | Game Title | ROM Name | Release ID |\n`;
    md += `| --- | --- | --- | --- |\n`;
    for (const r of diff.releases.lostBackup) {
      md += `| ${r.platform_name} | ${r.title} | ${r.rom_name} | \`${r.id}\` |\n`;
    }
    md += `\n`;
  }

  return md;
}

/**
 * Full client-side backup directory scan and reconciliation pipeline.
 * Accepts crawled file entries, platform definitions, and the user's catalog releases,
 * returning the complete diff report, ownership switch proposals, and ignored file list.
 */
export function scanBackupEntries(options: {
  rootFolderName: string;
  entries: CrawledFileEntry[];
  platforms: PlatformRow[];
  catalogReleases: CatalogReleaseCandidate[];
  platformOverrideId?: number | null;
}): BackupScanReport {
  const {
    rootFolderName,
    platforms,
    catalogReleases,
    platformOverrideId = null,
  } = options;

  // 1. Collapse container directories (Vita/PSP/PS3/Xbox folder dumps) into virtual .zip entries
  const collapsedEntries = collapseContainerDirectories(options.entries);

  // 2. Determine folder layout mode (platform_override vs single_platform vs multi_platform_root)
  let detectedMode:
    | 'multi_platform_root'
    | 'single_platform'
    | 'platform_override' = 'multi_platform_root';
  let singlePlatform: PlatformRow | null = null;

  if (platformOverrideId !== null && platformOverrideId !== undefined) {
    singlePlatform = platforms.find((p) => p.id === platformOverrideId) || null;
    if (singlePlatform) {
      detectedMode = 'platform_override';
    }
  }

  // Extract first subfolder name under rootFolderName (if any) for each entry
  const stripRootPrefix = (relPath: string): string => {
    const norm = relPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (
      rootFolderName &&
      norm.toLowerCase().startsWith(rootFolderName.toLowerCase() + '/')
    ) {
      return norm.slice(rootFolderName.length + 1);
    }
    return norm;
  };

  if (!singlePlatform) {
    const rootMatchedPlatform = findDbPlatform(rootFolderName, platforms);
    if (rootMatchedPlatform) {
      // Check if top-level subdirectories look like OTHER distinct platforms
      const topSubDirs = new Set<string>();
      for (const entry of collapsedEntries) {
        const rel = stripRootPrefix(entry.relativePath);
        const slashIdx = rel.indexOf('/');
        if (slashIdx > 0) {
          topSubDirs.add(rel.slice(0, slashIdx));
        }
      }
      const otherPlatformSubDirs = Array.from(topSubDirs).filter((sub) => {
        const subPlat = findDbPlatform(sub, platforms);
        return subPlat !== null && subPlat.id !== rootMatchedPlatform.id;
      });
      if (otherPlatformSubDirs.length === 0) {
        singlePlatform = rootMatchedPlatform;
        detectedMode = 'single_platform';
      }
    }
  }

  // 3. Bucket files by resolved PlatformRow
  const filesByPlatform = new Map<
    number,
    { platform: PlatformRow; entries: CrawledFileEntry[] }
  >();
  const unrecognizedFoldersSet = new Set<string>();
  const ignoredUnmatchedFiles: IgnoredBackupFile[] = [];

  for (const entry of collapsedEntries) {
    if (
      isIgnoredFile(entry.fileName) ||
      isSonicKnucklesException(entry.fileName)
    ) {
      continue;
    }

    if (singlePlatform) {
      if (!filesByPlatform.has(singlePlatform.id)) {
        filesByPlatform.set(singlePlatform.id, {
          platform: singlePlatform,
          entries: [],
        });
      }
      filesByPlatform.get(singlePlatform.id)!.entries.push(entry);
    } else {
      const rel = stripRootPrefix(entry.relativePath);
      const slashIdx = rel.indexOf('/');
      if (slashIdx <= 0) {
        ignoredUnmatchedFiles.push({
          relativePath: entry.relativePath,
          fileName: entry.fileName,
          platformName: null,
          reason: 'unrecognized_platform_folder',
        });
        continue;
      }
      const subDir = rel.slice(0, slashIdx);
      const resolvedPlat = findDbPlatform(subDir, platforms);
      if (!resolvedPlat) {
        unrecognizedFoldersSet.add(subDir);
        ignoredUnmatchedFiles.push({
          relativePath: entry.relativePath,
          fileName: entry.fileName,
          platformName: null,
          reason: 'unrecognized_platform_folder',
        });
        continue;
      }
      if (!filesByPlatform.has(resolvedPlat.id)) {
        filesByPlatform.set(resolvedPlat.id, {
          platform: resolvedPlat,
          entries: [],
        });
      }
      filesByPlatform.get(resolvedPlat.id)!.entries.push(entry);
    }
  }

  // 4. Match files per platform
  const allScannedPlatformIds = new Set<number>();
  const matchedReleaseIds = new Set<string>();
  const matchedFileByReleaseId = new Map<string, string>();
  const matchConfidenceByReleaseId = new Map<string, ReleaseMatchConfidence>();
  const scannedPlatformsSummary: Array<{
    id: number;
    name: string;
    scannedFiles: number;
    matchedReleases: number;
  }> = [];

  let totalScannedFiles = 0;
  let totalMatchedReleases = 0;

  for (const { platform, entries: platEntries } of filesByPlatform.values()) {
    const expandedIds = getScannedPlatformIds(platform.id, platforms);
    expandedIds.forEach((id) => allScannedPlatformIds.add(id));

    const platformDisplayName = platform.display_name || platform.name;
    const platReleases = catalogReleases.filter((r) =>
      expandedIds.includes(r.platform_id),
    );
    const romReleases: ReleaseRow[] = platReleases
      .filter((r): r is CatalogReleaseCandidate & { rom_name: string } =>
        Boolean(r.rom_name),
      )
      .map((r) => ({
        id: r.id,
        game_id: r.game_id,
        title: r.title,
        base_title: r.base_title,
        game_slug: r.game_slug,
        platform_id: r.platform_id,
        platform_name: r.platform_name,
        rom_name: r.rom_name,
        stable_id: r.game_id,
        region: r.region,
        ownership_status: r.ownership_status,
        backup_status: r.backup_status,
        has_case: r.has_case,
        has_manual: r.has_manual,
        variants: r.variants,
        rom_crc: r.rom_crc,
        serial_code: r.serial_code,
        canonical_release_id: r.canonical_release_id,
        is_pack_in: r.is_pack_in,
      }));

    let platMatchedReleases = 0;
    totalScannedFiles += platEntries.length;

    for (const entry of platEntries) {
      let matchResult: ReleaseMatchResult | null = null;

      // Switch 1 & 2 nxdumptool filename matching
      if (platform.id === 26 || platform.id === 27) {
        matchResult = matchSwitchNxdumptoolRelease(
          entry.fileName,
          platform.id,
          platReleases,
        );
      }

      if (!matchResult) {
        matchResult = findBestReleaseMatchWithConfidence(
          entry.fileName,
          romReleases,
        );
      }

      if (!matchResult) {
        matchResult = matchUnlinkedCatalogRelease(
          entry.fileName,
          platform.id,
          platReleases,
        );
      }

      if (matchResult) {
        const { release: matched, confidence } = matchResult;
        if (!matchedReleaseIds.has(matched.id)) {
          matchedReleaseIds.add(matched.id);
          matchedFileByReleaseId.set(matched.id, entry.fileName);
          matchConfidenceByReleaseId.set(matched.id, confidence);
          platMatchedReleases++;
          totalMatchedReleases++;
        } else if (
          confidence === 'exact' &&
          matchConfidenceByReleaseId.get(matched.id) !== 'exact'
        ) {
          matchConfidenceByReleaseId.set(matched.id, 'exact');
        }

        // Propagate shared rom_crc across identical-hash sibling releases of the same game or owned compilations
        if (matched.rom_crc) {
          const identicalHashReleases = romReleases.filter(
            (r) =>
              r.rom_crc === matched.rom_crc &&
              !matchedReleaseIds.has(r.id) &&
              (r.game_id === matched.game_id ||
                (r.ownership_status !== undefined && r.ownership_status > 0)),
          );
          for (const dup of identicalHashReleases) {
            matchedReleaseIds.add(dup.id);
            matchedFileByReleaseId.set(dup.id, entry.fileName);
            matchConfidenceByReleaseId.set(dup.id, confidence);
            platMatchedReleases++;
            totalMatchedReleases++;
          }
        }
      } else {
        ignoredUnmatchedFiles.push({
          relativePath: entry.relativePath,
          fileName: entry.fileName,
          platformName: platformDisplayName,
          reason: 'unmatched_catalog_release',
        });
      }
    }

    scannedPlatformsSummary.push({
      id: platform.id,
      name: platformDisplayName,
      scannedFiles: platEntries.length,
      matchedReleases: platMatchedReleases,
    });
  }

  // 5. Build prior state for all scanned platforms and compute net diffs + ownership switch proposals
  const scannedCatalogReleases = catalogReleases.filter((r) =>
    allScannedPlatformIds.has(r.platform_id),
  );

  const priorReleases: ReleaseDiffRow[] = scannedCatalogReleases.map((r) => ({
    id: r.id,
    game_id: r.game_id,
    title: r.base_title || r.title,
    platform_name: r.platform_name,
    rom_name: r.rom_name || formatSkuLabel([r]),
    backup_status: r.backup_status ? 1 : 0,
    ownership_status: r.ownership_status,
    region: r.region,
    variants: r.variants ?? null,
    matched_filename: matchedFileByReleaseId.get(r.id),
  }));

  const gamesById = new Map<number, GameDiffRow>();
  for (const r of scannedCatalogReleases) {
    if (!gamesById.has(r.game_id)) {
      gamesById.set(r.game_id, {
        stable_id: r.game_id,
        title: r.base_title || r.title,
        platform_id: r.platform_id,
        platform_name: r.platform_name,
      });
    }
  }

  const ownershipSwitches = computeOwnershipSwitches(
    scannedCatalogReleases,
    matchedReleaseIds,
    matchConfidenceByReleaseId,
    matchedFileByReleaseId,
  );

  const switchFromReleaseIds = new Set<string>();
  for (const sw of ownershipSwitches) {
    for (const fid of sw.fromReleaseIds) {
      switchFromReleaseIds.add(fid);
    }
  }

  const diff = computeBackupNetDiffs(
    priorReleases,
    Array.from(gamesById.values()),
    matchedReleaseIds,
  );

  if (switchFromReleaseIds.size > 0) {
    diff.releases.lostBackup = diff.releases.lostBackup.filter(
      (r) => !switchFromReleaseIds.has(r.id),
    );
  }

  return {
    rootFolderName,
    detectedMode,
    scannedPlatforms: scannedPlatformsSummary.sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    unrecognizedFolders: Array.from(unrecognizedFoldersSet).sort(),
    totalScannedFiles,
    totalMatchedReleases,
    matchedReleaseIds,
    matchedFileByReleaseId,
    matchConfidenceByReleaseId,
    diff,
    ownershipSwitches,
    ignoredUnmatchedFiles,
  };
}
