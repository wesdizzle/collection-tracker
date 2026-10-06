/**
 * CANONICAL RELEASES & PHYSICAL VERIFICATION ENGINE
 *
 * Provides high-performance physical release normalization, deduplication,
 * multi-tier confirmation heuristics, and physical publisher catalog matching.
 *
 * Designed to operate within zero-cost constraints across Cloudflare Workers (D1/R2)
 * and local SQLite environments.
 */

import {
  normalizeTitleForMatching,
  gameMatchesReleaseWithAlternatives,
} from './title_matching.js';
import {
  extractRegions,
  extractVariants,
  isIgnoredFormatRelease,
} from './dat_format.js';
import { KNOWN_VITA_PHYSICAL_SERIALS } from './vita_physical_serials.js';
import {
  isKnownPhysicalModernDiscSerial,
  KNOWN_PS4_PHYSICAL_DISC_SERIALS,
  KNOWN_PS5_PHYSICAL_DISC_SERIALS,
} from './modern_disc_serials.js';
export {
  isKnownPhysicalModernDiscSerial,
  KNOWN_PS4_PHYSICAL_DISC_SERIALS,
  KNOWN_PS5_PHYSICAL_DISC_SERIALS,
};
export {
  CANONICAL_VOUCHER_BUNDLES,
  type VoucherBundleDefinition,
} from './special_labels.js';

export interface CanonicalRelease {
  id?: number;
  platform_id: number;
  raw_title: string;
  normalized_title: string;
  region: string | null;
  variants: string | null;
  rom_name: string | null;
  rom_crc: string | null;
  serial_code?: string | null;
  barcode?: string | null;
  publisher?: string | null;
  source:
    | 'dat'
    | 'igdb_physical'
    | 'publisher_whitelist'
    | 'barcode'
    | 'gameye_vgpc'
    | 'custom';
  is_verified_physical: number;
}

export type ReleaseMedium =
  | 'physical_retail'
  | 'physical_limited'
  | 'digital_extracted_rom'
  | 'digital_native'
  | 'unreleased_prototype';

export type PhysicalStatus =
  | 'verified_physical'
  | 'likely_physical'
  | 'digital_extracted_rom'
  | 'digital_only'
  | 'unreleased_prototype'
  | 'unverified';

export interface OriginMetadata {
  origin_type:
    | 'virtual_console'
    | 'nintendo_switch_online'
    | 'classic_mini'
    | 'compilation_extraction'
    | 'digital_translation'
    | 'prototype';
  origin_platform?: string;
  origin_channel?: string;
  origin_year?: number;
  origin_package_title?: string;
  target_hardware?: string;
  notes?: string;
}

export interface PhysicalVerificationResult {
  physical_status: PhysicalStatus;
  verification_tier: number; // 1 = DAT/Redump, 2 = Barcode/Publisher/IGDB, 3 = Heuristic Fluff/Extracted, 0 = Unverified
  is_physical: boolean;
  reasons: string[];
  matched_releases: CanonicalRelease[];
  physical_regions: string[];
  origin_metadata?: OriginMetadata;
}

export interface ExtractedRomDefinition {
  targetPlatformId: number;
  cleanTitle: string;
  normalizedTitle: string;
  region: string;
  romName: string;
  romCrc?: string;
  originMetadata: OriginMetadata;
  aliases: string[];
}

export const CANONICAL_EXTRACTED_ROMS: ExtractedRomDefinition[] = [
  {
    targetPlatformId: 13, // NES
    cleanTitle: 'EarthBound Beginnings',
    normalizedTitle: 'earthbound beginnings',
    region: 'USA, Europe',
    romName: 'EarthBound Beginnings (USA, Europe) (Virtual Console).nes',
    originMetadata: {
      origin_type: 'virtual_console',
      origin_platform: 'Wii U',
      origin_channel: 'Wii U Virtual Console / Nintendo Switch Online',
      origin_year: 2015,
      origin_package_title: 'EarthBound Beginnings (Wii U Virtual Console)',
      target_hardware: 'Nintendo Entertainment System',
      notes:
        'Official 1990 English localization released for the first time on Wii U Virtual Console in 2015.',
    },
    aliases: ['mother', 'earth bound', 'earthbound zero'],
  },
  {
    targetPlatformId: 19, // SNES
    cleanTitle: 'Star Fox 2',
    normalizedTitle: 'star fox 2',
    region: 'USA, Europe',
    romName: 'Star Fox 2 (USA, Europe).sfc',
    originMetadata: {
      origin_type: 'classic_mini',
      origin_platform: 'Super NES Classic Edition',
      origin_channel: 'Super NES Classic Edition / Nintendo Switch Online',
      origin_year: 2017,
      origin_package_title: 'Super NES Classic Edition',
      target_hardware: 'Super Nintendo Entertainment System',
      notes:
        'Completed in 1995; officially released for the first time in 2017 on Super NES Classic Edition.',
    },
    aliases: ['star fox 2'],
  },
  {
    targetPlatformId: 19, // SNES
    cleanTitle: 'Trials of Mana',
    normalizedTitle: 'trials of mana',
    region: 'USA, Europe',
    romName: 'Trials of Mana (USA, Europe).sfc',
    originMetadata: {
      origin_type: 'compilation_extraction',
      origin_platform: 'Nintendo Switch',
      origin_channel: 'Collection of Mana',
      origin_year: 2019,
      origin_package_title: 'Collection of Mana',
      target_hardware: 'Super Nintendo Entertainment System',
      notes:
        'Original 1995 Super Famicom game (Seiken Densetsu 3) officially translated into English for Collection of Mana.',
    },
    aliases: ['seiken densetsu 3'],
  },
  {
    targetPlatformId: 37, // Sega Genesis
    cleanTitle: 'Monster World IV',
    normalizedTitle: 'monster world iv',
    region: 'USA, Europe',
    romName: 'Monster World IV (USA, Europe) (Virtual Console).md',
    originMetadata: {
      origin_type: 'digital_translation',
      origin_platform: 'Wii',
      origin_channel: 'Wii Virtual Console / XBLA / PSN',
      origin_year: 2012,
      origin_package_title: 'Sega Vintage Collection: Monster World',
      target_hardware: 'Sega Genesis / Mega Drive',
      notes:
        '1994 Japanese Mega Drive exclusive officially translated into English in 2012 by M2.',
    },
    aliases: ['monster world 4'],
  },
  {
    targetPlatformId: 13, // NES
    cleanTitle: 'Fire Emblem: Shadow Dragon and the Blade of Light',
    normalizedTitle: 'fire emblem shadow dragon and the blade of light',
    region: 'USA, Europe',
    romName:
      'Fire Emblem - Shadow Dragon and the Blade of Light (USA) (Switch Online).nes',
    originMetadata: {
      origin_type: 'digital_translation',
      origin_platform: 'Nintendo Switch',
      origin_channel: 'Nintendo eShop (30th Anniversary)',
      origin_year: 2020,
      origin_package_title:
        'Fire Emblem: Shadow Dragon and the Blade of Light 30th Anniversary',
      target_hardware: 'Nintendo Entertainment System',
      notes:
        '1990 Famicom game officially translated into English for the 30th Anniversary Switch release in 2020.',
    },
    aliases: ['fire emblem: ankoku ryu to hikari no ken', 'fire emblem 1'],
  },
  {
    targetPlatformId: 17, // Nintendo 64
    cleanTitle: 'Sin and Punishment',
    normalizedTitle: 'sin and punishment',
    region: 'USA, Europe',
    romName: 'Sin and Punishment (USA, Europe) (Virtual Console).z64',
    originMetadata: {
      origin_type: 'virtual_console',
      origin_platform: 'Wii',
      origin_channel: 'Wii Virtual Console / Nintendo Switch Online',
      origin_year: 2007,
      origin_package_title: 'Sin and Punishment (Wii Virtual Console)',
      target_hardware: 'Nintendo 64',
      notes:
        '2000 Japanese N64 exclusive released internationally with translated English menus on Wii Virtual Console in 2007.',
    },
    aliases: ['tsumi to batsu: hoshi no keishousha'],
  },
  {
    targetPlatformId: 19, // SNES
    cleanTitle: 'Clock Tower',
    normalizedTitle: 'clock tower',
    region: 'USA, Europe',
    romName: 'Clock Tower (USA, Europe) (Carbon Engine).sfc',
    originMetadata: {
      origin_type: 'compilation_extraction',
      origin_platform: 'Nintendo Switch / PS5',
      origin_channel: 'Clock Tower: Rewind',
      origin_year: 2024,
      origin_package_title: 'Clock Tower: Rewind',
      target_hardware: 'Super Nintendo Entertainment System',
      notes:
        '1995 Super Famicom game officially translated into English using Carbon Engine in 2024.',
    },
    aliases: ['clock tower: the first fear'],
  },
];

/**
 * Finds a canonical extracted ROM entry by title and target platform ID.
 */
export function findCanonicalExtractedRom(
  title: string,
  platformId: number,
): ExtractedRomDefinition | null {
  if (!title) return null;
  const norm = normalizeTitleForMatching(
    cleanTitleWithoutParentheticals(title),
  );
  for (const def of CANONICAL_EXTRACTED_ROMS) {
    if (def.targetPlatformId !== platformId) continue;
    if (
      normalizeTitleForMatching(def.cleanTitle) === norm ||
      normalizeTitleForMatching(def.normalizedTitle) === norm
    ) {
      return def;
    }
    for (const alias of def.aliases) {
      if (normalizeTitleForMatching(alias) === norm) return def;
    }
  }
  return null;
}

export interface IncludedBundleGame {
  title: string;
  platformId: number;
  discNumber: number;
  romNamePattern: string;
  notes?: string;
}

export interface BundleDefinition {
  parentTitle: string;
  parentPlatformId: number;
  bundleType:
    | 'same_platform_multidisc'
    | 'cross_platform_multidisc'
    | 'compilation_cart';
  includedGames: IncludedBundleGame[];
}

export const CANONICAL_BUNDLES: BundleDefinition[] = [
  {
    parentTitle: 'Bayonetta 2',
    parentPlatformId: 24, // Wii U
    bundleType: 'same_platform_multidisc',
    includedGames: [
      {
        title: 'Bayonetta 2',
        platformId: 24,
        discNumber: 1,
        romNamePattern: 'Bayonetta 2',
        notes: 'Primary retail game (Disc 1)',
      },
      {
        title: 'Bayonetta',
        platformId: 24,
        discNumber: 2,
        romNamePattern: 'Bayonetta',
        notes: 'Included full game (Disc 2)',
      },
    ],
  },
  {
    parentTitle: 'Rodea the Sky Soldier',
    parentPlatformId: 24, // Wii U
    bundleType: 'cross_platform_multidisc',
    includedGames: [
      {
        title: 'Rodea the Sky Soldier',
        platformId: 24, // Wii U
        discNumber: 1,
        romNamePattern: 'Rodea the Sky Soldier',
        notes: 'Wii U primary version (Disc 1)',
      },
      {
        title: 'Rodea the Sky Soldier',
        platformId: 22, // Wii
        discNumber: 2,
        romNamePattern: 'Rodea the Sky Soldier',
        notes: 'Original Wii version on physical bonus disc (Disc 2)',
      },
    ],
  },
];

/**
 * Finds a bundle definition by parent title and platform ID.
 */
export function findCanonicalBundle(
  title: string,
  platformId: number,
): BundleDefinition | null {
  if (!title) return null;
  const norm = normalizeTitleForMatching(
    cleanTitleWithoutParentheticals(title),
  );
  for (const b of CANONICAL_BUNDLES) {
    if (b.parentPlatformId !== platformId) continue;
    if (normalizeTitleForMatching(b.parentTitle) === norm) return b;
  }
  return null;
}

/**
 * Curated list of known physical-only or boutique physical console publishers.
 * Matching these provides a high-confidence Tier 2 physical release signal.
 */
export const PHYSICAL_PUBLISHERS_ALLOWLIST = new Set<string>([
  'limited run games',
  'super rare games',
  'strictly limited games',
  'special reserve games',
  'red art games',
  'signature edition games',
  'signature edition',
  'fangamer',
  'iam8bit',
  "pix'n love",
  'pix n love',
  'eastasiasoft',
  'play-asia',
  'nippon ichi software',
  'nis america',
  'pqube',
  'merge games',
  'maximum games',
  'aksys games',
  'microids',
  'inin games',
  'clear river games',
  'physical only',
  'warpfrog',
  'numskull games',
  'first press games',
  'premium edition games',
  'vgnysoft',
  'retro-bit',
  'forever limited',
  'badland publishing',
]);

export const PHYSICAL_PUBLISHERS_WHITELIST = PHYSICAL_PUBLISHERS_ALLOWLIST;

/**
 * Keywords in titles or metadata that indicate digital-only or emulation wrappers.
 */
export const DIGITAL_TITLE_KEYWORDS = [
  'virtual console',
  'nintendo switch online',
  'arcade archives',
  'sega ages',
  'psn digital',
  'xbox live arcade',
  'aca neogeo',
  'digital deluxe',
  'starter pack',
  'season pass',
  'expansion pass',
  'dlc quest',
];

/**
 * Extracts a serial code (e.g. SLUS-20001, CUSA-12345, HAC-P-AAAAA) from a release title or ROM filename.
 */
export function extractSerialCode(name: string): string | null {
  if (!name) return null;

  // Common serial formats:
  // Sony: SLUS-12345, SCUS-12345, SLES-12345, BCUS-12345, CUSA-12345, PPSA-12345, etc.
  // Nintendo: HAC-P-AAAAA, NUS-XXXX, NTR-XXXX, CTR-XXXX, RVL-XXXX, WUP-XXXX
  // Sega: T-12345, MK-12345, HDR-12345
  const patterns = [
    /\b([A-Z]{3,4}-\d{4,5})\b/i,
    /\b(HAC-[P|A]-[A-Z0-9]{4,5})\b/i,
    /\b(CTR-[P|A]-[A-Z0-9]{4,5})\b/i,
    /\b(NTR-[P|A]-[A-Z0-9]{4,5})\b/i,
    /\b(RVL-[P|A]-[A-Z0-9]{4,5})\b/i,
    /\b(WUP-[P|A]-[A-Z0-9]{4,5})\b/i,
  ];

  for (const pattern of patterns) {
    const match = name.match(pattern);
    if (match) {
      return match[1].toUpperCase();
    }
  }

  return null;
}

/**
 * Normalizes a title to a clean string stripped of parentheticals for canonical storage.
 */
export function cleanTitleWithoutParentheticals(rawTitle: string): string {
  let title = rawTitle
    .replace(/\s*[([][^\])]*[)\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Re-order ", The" prefix
  if (title.includes(', The')) {
    title = 'The ' + title.replace(', The', '').trim();
  }
  if (title.includes(', A')) {
    title = 'A ' + title.replace(', A', '').trim();
  }

  return title;
}

/**
 * Checks if a game title or category strongly indicates a digital-only re-release or fluff.
 */
export function isDigitalFluffTitle(
  title: string,
  igdbCategory?: number,
): boolean {
  const lower = title.toLowerCase();

  // IGDB Category / Game Type Check:
  // 1 = DLC / Addon, 2 = Expansion, 5 = Mod, 6 = Episode, 7 = Season, 13 = Pack / Addon
  // Note: 3 = Bundle is intentionally NOT filtered because physical compilations/multi-packs are categorized as Bundles.
  if (igdbCategory && [1, 2, 5, 6, 7, 13].includes(igdbCategory)) {
    return true;
  }

  return DIGITAL_TITLE_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Checks for era discrepancy: e.g. An original release date from 1992 on a 2006/2017 platform
 * without a physical compilation package.
 *
 * @param firstReleaseYear Year of original first release (e.g. 1990)
 * @param platformLaunchYear Year platform launched (e.g. 2006 for Wii, 2017 for Switch)
 */
export function hasEraDiscrepancy(
  firstReleaseYear?: number | null,
  platformLaunchYear?: number | null,
): boolean {
  if (!firstReleaseYear || !platformLaunchYear) return false;
  // If original game came out more than 3 years before the platform even existed,
  // it is likely a digital port, Virtual Console, or retro emulation re-release.
  return firstReleaseYear < platformLaunchYear - 3;
}

/**
 * Platforms considered effectively complete in community DAT sets (No-Intro / Redump).
 * Includes 1st through 7th generation consoles/handhelds plus Nintendo 3DS, New Nintendo 3DS, and Wii U.
 */
export const COMPLETE_DAT_PLATFORM_IDS = new Set<number>([
  1, // 3DO Interactive Multiplayer
  2, // Atari 2600
  3, // Atari 5200
  4, // Atari 7800
  5, // Atari Lynx
  6, // Atari Jaguar
  7, // ColecoVision
  8, // Intellivision
  9, // Neo Geo AES
  10, // Neo Geo CD
  11, // Neo Geo Pocket Color
  13, // Nintendo Entertainment System
  14, // Game Boy
  15, // Super Nintendo Entertainment System
  16, // Virtual Boy
  17, // Nintendo 64
  18, // Game Boy Color
  19, // Game Boy Advance
  20, // Nintendo GameCube
  21, // Nintendo DS
  22, // Wii
  23, // Nintendo 3DS
  24, // Wii U
  25, // New Nintendo 3DS
  28, // Philips CD-i
  29, // PlayStation
  30, // PlayStation 2
  31, // PlayStation Portable
  32, // PlayStation 3
  36, // Sega Master System
  37, // Sega Genesis
  38, // Sega Game Gear
  39, // Sega CD
  40, // Sega Pico
  41, // Sega 32X
  42, // Sega Saturn
  43, // Dreamcast
  44, // Game.com
  45, // TurboGrafx-16
  46, // TurboGrafx CD
  47, // Xbox
  48, // Xbox 360
  53, // Famicom
  54, // Famicom Disk System
  55, // Nintendo 64DD
]);

/**
 * Platforms that are still active or have incomplete community DAT tracking.
 * On these platforms, DAT files cannot be treated as the sole source of truth for regional releases.
 */
export const ACTIVE_OR_INCOMPLETE_DAT_PLATFORM_IDS = new Set<number>([
  12, // Neo Geo X
  26, // Nintendo Switch
  27, // Nintendo Switch 2
  33, // PlayStation Vita
  34, // PlayStation 4
  35, // PlayStation 5
  49, // Xbox One
  50, // Xbox Series X
  51, // PlayStation VR
  52, // PlayStation VR2
]);

/**
 * Returns true if the given platform ID has effectively complete DAT coverage.
 */
export function isPlatformDatComplete(platformId: number): boolean {
  return COMPLETE_DAT_PLATFORM_IDS.has(platformId);
}

/**
 * Detects the physical release status of a candidate game across all three verification tiers.
 */
export function detectPhysicalReleaseStatus(options: {
  platformId: number;
  gameTitle: string;
  alternativeNames?: Array<{ name: string; comment?: string }>;
  firstReleaseDate?: string | number | null;
  platformLaunchDate?: string | null;
  publisher?: string | null;
  igdbCategory?: number;
  igdbPackaging?: number | string | null; // e.g. Physical packaging attribute
  igdbGameFormat?: string | null;
  barcode?: string | null;
  serialCode?: string | null;
  canonicalReleases?: CanonicalRelease[];
}): PhysicalVerificationResult {
  const {
    platformId,
    gameTitle,
    alternativeNames,
    firstReleaseDate,
    platformLaunchDate,
    publisher,
    igdbCategory,
    igdbPackaging,
    igdbGameFormat,
    barcode,
    serialCode,
    canonicalReleases = [],
  } = options;

  const reasons: string[] = [];

  // Parse release years for Tier 3 era checks
  let firstYear: number | null = null;
  if (typeof firstReleaseDate === 'number') {
    // Unix timestamp in seconds
    firstYear = new Date(firstReleaseDate * 1000).getUTCFullYear();
  } else if (typeof firstReleaseDate === 'string' && firstReleaseDate.trim()) {
    firstYear = parseInt(firstReleaseDate.substring(0, 4), 10) || null;
  }

  let launchYear: number | null = null;
  if (platformLaunchDate) {
    launchYear = parseInt(platformLaunchDate.substring(0, 4), 10) || null;
  }

  // Tier 1: Canonical Match (No-Intro / Redump in D1/SQLite)
  const matchedReleases = canonicalReleases.filter((r) => {
    if (r.platform_id !== platformId) return false;
    return gameMatchesReleaseWithAlternatives(
      gameTitle,
      cleanTitleWithoutParentheticals(r.raw_title),
      r.raw_title,
      platformId,
      alternativeNames,
      r.region,
    );
  });

  const matchedPhysicalReleases = matchedReleases.filter(
    (r) => r.is_verified_physical !== 0,
  );

  if (matchedPhysicalReleases.length > 0) {
    const regions = Array.from(
      new Set(
        matchedPhysicalReleases
          .map((r) => r.region)
          .filter((reg): reg is string => Boolean(reg))
          .flatMap((reg) => reg.split(',').map((s) => s.trim())),
      ),
    );

    reasons.push(
      `Matched ${matchedPhysicalReleases.length} canonical physical release variant(s) in DAT database`,
    );

    return {
      physical_status: 'verified_physical',
      verification_tier: 1,
      is_physical: true,
      reasons,
      matched_releases: matchedPhysicalReleases,
      physical_regions: regions,
    };
  }

  // If all matched canonical releases are explicitly digital-only (is_verified_physical === 0)
  if (matchedReleases.length > 0 && matchedPhysicalReleases.length === 0) {
    reasons.push(
      `Matched ${matchedReleases.length} canonical release(s) identified as digital-only PSN release`,
    );

    return {
      physical_status: 'digital_only',
      verification_tier: 3,
      is_physical: false,
      reasons,
      matched_releases: matchedReleases,
      physical_regions: [],
    };
  }

  // Tier 1b: Curated Canonical Extracted ROMs (e.g. EarthBound Beginnings on NES, Star Fox 2 on SNES)
  const canonicalExtracted = findCanonicalExtractedRom(gameTitle, platformId);
  if (canonicalExtracted) {
    reasons.push(
      `Identified as canonical official digital extracted ROM (${canonicalExtracted.originMetadata.origin_channel})`,
    );
    return {
      physical_status: 'digital_extracted_rom',
      verification_tier: 3,
      is_physical: false,
      reasons,
      matched_releases: [],
      physical_regions: [canonicalExtracted.region],
      origin_metadata: canonicalExtracted.originMetadata,
    };
  }

  // Tier 3 Early Gate: Digital Fluff / Virtual Console / DLC Detection
  if (isDigitalFluffTitle(gameTitle, igdbCategory)) {
    reasons.push(
      'Title or category matches digital-only / DLC / expansion pattern',
    );
    return {
      physical_status: 'digital_only',
      verification_tier: 3,
      is_physical: false,
      reasons,
      matched_releases: [],
      physical_regions: [],
    };
  }

  if (hasEraDiscrepancy(firstYear, launchYear)) {
    reasons.push(
      `Original release date (${firstYear}) precedes platform launch (${launchYear}) by >3 years without physical compilation match`,
    );
    return {
      physical_status: 'digital_only',
      verification_tier: 3,
      is_physical: false,
      reasons,
      matched_releases: [],
      physical_regions: [],
    };
  }

  // Tier 2: Free Signals (Publisher Allowlist, Packaging, Barcode, Serial)
  const pubClean = (publisher || '').toLowerCase().trim();
  const isAllowlistedPublisher = Array.from(PHYSICAL_PUBLISHERS_ALLOWLIST).some(
    (p) => pubClean.includes(p),
  );

  if (isAllowlistedPublisher) {
    reasons.push(`Publisher '${publisher}' is a verified physical distributor`);
    return {
      physical_status: 'likely_physical',
      verification_tier: 2,
      is_physical: true,
      reasons,
      matched_releases: [],
      physical_regions: ['USA', 'World'],
    };
  }

  if (barcode) {
    reasons.push(`Physical retail barcode present: ${barcode}`);
    return {
      physical_status: 'likely_physical',
      verification_tier: 2,
      is_physical: true,
      reasons,
      matched_releases: [],
      physical_regions: ['USA'],
    };
  }

  if (serialCode || extractSerialCode(gameTitle)) {
    const code = serialCode || extractSerialCode(gameTitle);
    if (code && isKnownPhysicalModernDiscSerial(platformId, code)) {
      reasons.push(
        `Verified physical optical disc serial code detected in community catalog: ${code}`,
      );
      return {
        physical_status: 'verified_physical',
        verification_tier: 1,
        is_physical: true,
        reasons,
        matched_releases: [],
        physical_regions: ['USA', 'Europe', 'Japan', 'World'],
      };
    }

    reasons.push(`Physical platform serial code detected: ${code}`);
    return {
      physical_status: 'likely_physical',
      verification_tier: 2,
      is_physical: true,
      reasons,
      matched_releases: [],
      physical_regions: [],
    };
  }

  if (
    (igdbPackaging && igdbPackaging !== 0) ||
    (igdbGameFormat && igdbGameFormat.toLowerCase().includes('physical'))
  ) {
    reasons.push('IGDB release format indicates physical packaging');
    return {
      physical_status: 'likely_physical',
      verification_tier: 2,
      is_physical: true,
      reasons,
      matched_releases: [],
      physical_regions: [],
    };
  }

  // Fallback: Platforms with complete DAT coverage are digital only if not in DAT
  if (isPlatformDatComplete(platformId)) {
    reasons.push('Platform with complete DAT coverage had no physical match');
    return {
      physical_status: 'digital_only',
      verification_tier: 3,
      is_physical: false,
      reasons,
      matched_releases: [],
      physical_regions: [],
    };
  }

  // Modern console with undetermined signals
  reasons.push(
    'Modern platform title with no physical DAT, serial, or publisher signals',
  );
  return {
    physical_status: 'unverified',
    verification_tier: 0,
    is_physical: false,
    reasons,
    matched_releases: [],
    physical_regions: [],
  };
}

/**
 * Deduplicates and aggregates raw XML DAT releases for a specific platform.
 * Merges multi-disc releases into a unified canonical entry and removes junk.
 */
export function deduplicateDatReleases(
  platformId: number,
  rawReleases: Array<{
    name: string;
    roms: Array<{ name: string; crc?: string | null; serial?: string | null }>;
    publisher?: string | null;
    serial?: string | null;
  }>,
): CanonicalRelease[] {
  const releaseMap = new Map<string, CanonicalRelease>();

  for (const rel of rawReleases) {
    if (!rel.roms || rel.roms.length === 0) continue;

    const primaryRom = rel.roms[0];

    // For Platform 33 (PS Vita): prefer .zip archives, do not support .psv or .vpk
    let romName = primaryRom.name;
    if (platformId === 33) {
      const baseWithoutExt = rel.name.replace(/\.(vpk|psv|zip|7z)$/i, '');
      romName = `${baseWithoutExt}.zip`;
    }

    if (isIgnoredFormatRelease(rel.name, romName, platformId)) {
      continue;
    }

    const cleanBase = cleanTitleWithoutParentheticals(rel.name);
    const normalized = normalizeTitleForMatching(cleanBase);
    if (!normalized) continue;

    const region = extractRegions(rel.name);
    const variants = extractVariants(rel.name, platformId);
    const serial =
      primaryRom.serial ||
      rel.serial ||
      extractSerialCode(rel.name) ||
      extractSerialCode(primaryRom.name);

    // Grouping key: platform + normalized title + primary region
    const groupKey = `${platformId}::${normalized}::${region || 'World'}::${variants || 'Standard'}`;

    let isVerifiedPhysical = 1;
    if (platformId === 33) {
      const cleanSerial = serial
        ? serial.replace(/[^A-Z0-9]/g, '').toUpperCase()
        : '';
      const isKnownSerial = cleanSerial
        ? KNOWN_VITA_PHYSICAL_SERIALS.has(cleanSerial)
        : false;
      const isKnownPublisher = rel.publisher
        ? Array.from(PHYSICAL_PUBLISHERS_ALLOWLIST).some((p) =>
            rel.publisher!.toLowerCase().includes(p),
          )
        : false;
      isVerifiedPhysical = isKnownSerial || isKnownPublisher ? 1 : 0;
    } else if (platformId === 34 || platformId === 35) {
      const cleanSerial = serial
        ? serial.replace(/[^A-Z0-9]/g, '').toUpperCase()
        : '';
      const isKnownSerial = isKnownPhysicalModernDiscSerial(
        platformId,
        cleanSerial,
      );
      const isKnownPublisher = rel.publisher
        ? Array.from(PHYSICAL_PUBLISHERS_ALLOWLIST).some((p) =>
            rel.publisher!.toLowerCase().includes(p),
          )
        : false;
      if (cleanSerial || rel.publisher) {
        isVerifiedPhysical = isKnownSerial || isKnownPublisher ? 1 : 0;
      }
    }

    if (!releaseMap.has(groupKey)) {
      releaseMap.set(groupKey, {
        platform_id: platformId,
        raw_title: cleanBase,
        normalized_title: normalized,
        region: region || null,
        variants: variants || null,
        rom_name: romName,
        rom_crc: platformId === 33 ? null : primaryRom.crc || null,
        serial_code: serial || null,
        barcode: null,
        publisher: rel.publisher || null,
        source: 'dat',
        is_verified_physical: isVerifiedPhysical,
      });
    } else {
      // If entry exists, append secondary variant info or update CRC if missing
      const existing = releaseMap.get(groupKey)!;
      if (isVerifiedPhysical === 1) {
        existing.is_verified_physical = 1;
      }
      if (!existing.rom_crc && primaryRom.crc && platformId !== 33) {
        existing.rom_crc = primaryRom.crc;
      }
      if (!existing.serial_code && serial) {
        existing.serial_code = serial;
      }
      if (!existing.publisher && rel.publisher) {
        existing.publisher = rel.publisher;
      }
    }
  }

  return Array.from(releaseMap.values());
}
