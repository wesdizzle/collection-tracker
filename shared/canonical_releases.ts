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
  extractDiscLabel,
  extractRegions,
  extractVariants,
  isCuratedPsvrDemoDiscTitle,
  isIgnoredFormatRelease,
} from './source_format.js';
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
import {
  CANONICAL_VOUCHER_BUNDLES,
  findRetailPackInDisc,
  normalizeForLabelMatch,
  type VoucherBundleDefinition,
} from './special_labels.js';
export { CANONICAL_VOUCHER_BUNDLES, type VoucherBundleDefinition };

export interface CanonicalRelease {
  id?: number;
  platform_id: number;
  raw_title: string;
  normalized_title: string;
  region: string | null;
  variants: string | null;
  also_released_as?: string | null;
  packin_host_normalized_title?: string | null;
  redump_disc_id?: number | null;
  rom_name: string | null;
  rom_crc: string | null;
  serial_code?: string | null;
  barcode?: string | null;
  publisher?: string | null;
  source:
    | 'dat'
    | 'nintendo_revised'
    | 'nscollectors'
    | 'nscollectors_upcoming'
    | 'nscollectors_ciab'
    | 'serialstation'
    | 'ps5db'
    | 'mame'
    | 'neogeo_x'
    | 'lgn'
    | 'retail_catalog'
    | 'community_csv'
    | 'igdb_physical'
    | 'publisher_whitelist'
    | 'barcode'
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
 * Platforms considered effectively complete in community catalog sets (No-Intro / Redump).
 * Includes 1st through 7th generation consoles/handhelds plus Nintendo 3DS, New Nintendo 3DS, and Wii U.
 */
export const COMPLETE_SOURCE_PLATFORM_IDS = new Set<number>([
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
export const COMPLETE_DAT_PLATFORM_IDS = COMPLETE_SOURCE_PLATFORM_IDS;

/**
 * Platforms that are still active or have evolving community catalog tracking.
 * On these platforms, standard offline DAT files cannot be treated as the sole source of truth for regional releases.
 * Includes Nintendo Switch (Platform 26) and Nintendo Switch 2 (Platform 27) whose physical releases
 * are maintained via the Nintendo Revised catalog.
 */
export const ACTIVE_OR_INCOMPLETE_SOURCE_PLATFORM_IDS = new Set<number>([
  12, // Neo Geo X
  26, // Nintendo Switch
  27, // Nintendo Switch 2
  33, // PlayStation Vita
  34, // PlayStation 4
  35, // PlayStation 5
  49, // Xbox One
  50, // Xbox Series X
]);
export const ACTIVE_OR_INCOMPLETE_DAT_PLATFORM_IDS =
  ACTIVE_OR_INCOMPLETE_SOURCE_PLATFORM_IDS;

/**
 * Returns true if the given platform ID has effectively complete source catalog coverage.
 */
export function isPlatformSourceComplete(platformId: number): boolean {
  return COMPLETE_SOURCE_PLATFORM_IDS.has(platformId);
}
export const isPlatformDatComplete = isPlatformSourceComplete;

/**
 * Detects the physical release status of a candidate game across all three verification tiers.
 */
export function detectPhysicalReleaseStatus(options: {
  platformId: number;
  parentPlatformId?: number | null;
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
  targetRegion?: string | null;
  canonicalReleases?: CanonicalRelease[];
}): PhysicalVerificationResult {
  const {
    platformId,
    parentPlatformId,
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
    targetRegion,
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
  const normTargetGameTitle = normalizeForLabelMatch(gameTitle);
  const allMatchedReleases = canonicalReleases.filter((r) => {
    if (
      r.platform_id !== platformId &&
      (!parentPlatformId || r.platform_id !== parentPlatformId)
    ) {
      return false;
    }
    const rawReleaseName = r.rom_name || r.raw_title;
    const packIn = findRetailPackInDisc(rawReleaseName);
    if (packIn) {
      return (
        packIn.hostPlatformId === r.platform_id &&
        packIn.hostGameNormTitle === normTargetGameTitle
      );
    }
    return gameMatchesReleaseWithAlternatives(
      gameTitle,
      cleanTitleWithoutParentheticals(r.raw_title),
      rawReleaseName,
      r.platform_id,
      alternativeNames,
      r.region,
    );
  });

  const matchedReleases =
    targetRegion && targetRegion.trim()
      ? allMatchedReleases.filter((r) => regionsOverlap(r.region, targetRegion))
      : allMatchedReleases;

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
      `Matched ${matchedPhysicalReleases.length} canonical physical release variant(s) in canonical source dataset`,
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

  // Check if upcoming / announced (release date in future or current/future year)
  let isUpcoming = false;
  const currentYear = new Date().getUTCFullYear();
  if (typeof firstReleaseDate === 'number') {
    isUpcoming = firstReleaseDate * 1000 > Date.now();
  } else if (typeof firstReleaseDate === 'string' && firstReleaseDate.trim()) {
    const parsed = new Date(firstReleaseDate).getTime();
    if (!isNaN(parsed)) {
      isUpcoming = parsed > Date.now();
    } else if (firstYear && firstYear >= currentYear) {
      isUpcoming = true;
    }
  } else if (firstYear && firstYear > currentYear) {
    isUpcoming = true;
  }

  if (isUpcoming) {
    const pubClean = (publisher || '').toLowerCase().trim();
    const isAllowlistedPublisher = Array.from(
      PHYSICAL_PUBLISHERS_ALLOWLIST,
    ).some((p) => pubClean.includes(p));
    const hasPhysicalSignal = Boolean(
      isAllowlistedPublisher ||
      barcode ||
      serialCode ||
      igdbPackaging ||
      (igdbGameFormat && igdbGameFormat.toLowerCase().includes('physical')),
    );
    reasons.push(
      hasPhysicalSignal
        ? 'Upcoming game with confirmed or likely physical distribution signals'
        : 'Upcoming/announced title awaiting physical release confirmation',
    );
    return {
      physical_status: hasPhysicalSignal ? 'likely_physical' : 'unverified',
      verification_tier: hasPhysicalSignal ? 2 : 0,
      is_physical: hasPhysicalSignal,
      reasons,
      matched_releases: [],
      physical_regions: hasPhysicalSignal ? ['USA', 'World'] : [],
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

  // Fallback: Platforms with complete source coverage are digital only if not in source catalog
  if (
    isPlatformSourceComplete(platformId) ||
    platformId === 26 ||
    platformId === 27
  ) {
    reasons.push(
      platformId === 26 || platformId === 27
        ? 'Nintendo Switch title had no physical cartridge match in Nintendo Revised catalog'
        : 'Platform with complete source catalog coverage had no physical match',
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

  // Modern console with undetermined signals
  reasons.push(
    'Modern platform title with no physical source catalog, serial, or publisher signals',
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
    category?: string | null;
    publisher?: string | null;
    serial?: string | null;
  }>,
): CanonicalRelease[] {
  const releaseMap = new Map<string, CanonicalRelease>();

  for (const rel of rawReleases) {
    if (!rel.roms || rel.roms.length === 0) continue;

    const primaryRom = rel.roms[0];

    const romName = primaryRom.name;

    if (isIgnoredFormatRelease(rel.name, romName, platformId, rel.category)) {
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

    // Grouping key: platform + normalized title + primary region + variants + disc label
    const discLabel = extractDiscLabel(romName) || 'Single';
    const groupKey = `${platformId}::${normalized}::${region || 'World'}::${variants || 'Standard'}::${discLabel}`;

    let isVerifiedPhysical = 1;
    if (platformId === 33) {
      if (romName.toLowerCase().endsWith('.psv')) {
        isVerifiedPhysical = 1;
      } else {
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
      }
    } else if (platformId === 34 || platformId === 35) {
      // Redump optical Blu-ray dumps (.iso/.cue/.bin) represent pressed physical discs;
      // only gate non-optical/digital package entries via the legacy serial/publisher allowlist.
      const isOpticalDiscDump = /\.(?:iso|cue|bin)$/i.test(romName);
      if (isOpticalDiscDump) {
        isVerifiedPhysical = 1;
      } else {
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
    }

    if (!releaseMap.has(groupKey)) {
      releaseMap.set(groupKey, {
        platform_id: platformId,
        raw_title: cleanBase,
        normalized_title: normalized,
        region: region || null,
        variants: variants || null,
        rom_name: romName,
        rom_crc: primaryRom.crc || null,
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
      if (!existing.rom_crc && primaryRom.crc) {
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

const REGION_OVERLAP_ALIAS_MAP: Record<string, string> = {
  us: 'USA',
  usa: 'USA',
  na: 'USA',
  'north america': 'USA',
  'ntsc-u': 'USA',
  esrb: 'USA',
  americas: 'USA',
  eu: 'Europe',
  eur: 'Europe',
  europe: 'Europe',
  pal: 'Europe',
  uk: 'Europe',
  'united kingdom': 'Europe',
  pegi: 'Europe',
  jp: 'Japan',
  jpn: 'Japan',
  japan: 'Japan',
  'ntsc-j': 'Japan',
  cero: 'Japan',
  au: 'Australia',
  aus: 'Australia',
  australia: 'Australia',
  nz: 'New Zealand',
  'new zealand': 'New Zealand',
  kr: 'Korea',
  kor: 'Korea',
  korea: 'Korea',
  as: 'Asia',
  asi: 'Asia',
  sea: 'Asia',
  asia: 'Asia',
  asian: 'Asia',
  cn: 'China',
  chn: 'China',
  china: 'China',
  tw: 'Taiwan',
  twn: 'Taiwan',
  taiwan: 'Taiwan',
  hk: 'Hong Kong',
  'hong kong': 'Hong Kong',
  ca: 'Canada',
  canada: 'Canada',
  fr: 'France',
  france: 'France',
  de: 'Germany',
  germany: 'Germany',
  es: 'Spain',
  spain: 'Spain',
  it: 'Italy',
  italy: 'Italy',
  nl: 'Netherlands',
  netherlands: 'Netherlands',
  br: 'Brazil',
  brazil: 'Brazil',
  world: 'World',
  ww: 'World',
  global: 'World',
  'region free': 'World',
  regionfree: 'World',
};

/**
 * Splits a comma/slash-delimited region string into normalized canonical region tokens.
 */
export function normalizeRegionTokens(
  region: string | null | undefined,
): Set<string> {
  const out = new Set<string>();
  if (!region) return out;
  for (const part of region.split(/[,/]+/)) {
    const cleaned = part.trim();
    if (!cleaned || cleaned === '-' || cleaned.toLowerCase() === 'n/a') {
      continue;
    }
    const mapped = REGION_OVERLAP_ALIAS_MAP[cleaned.toLowerCase()];
    out.add(mapped || cleaned.toLowerCase());
  }
  return out;
}

/**
 * Returns true if two release region strings overlap once normalized (or if either
 * represents an unspecified/`World` region), avoiding false exact-string misses such
 * as `"Europe"` vs `"Europe, Australia"` or `"USA, Europe"` vs `"USA"`.
 */
export function regionsOverlap(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const setA = normalizeRegionTokens(a);
  const setB = normalizeRegionTokens(b);
  if (
    setA.size === 0 ||
    setB.size === 0 ||
    setA.has('World') ||
    setB.has('World')
  ) {
    return true;
  }
  for (const tok of setA) {
    if (setB.has(tok)) return true;
  }
  return false;
}

/**
 * Authoritative source precedence hierarchy (lower numeric rank = higher authority).
 * Tier 1 (checksum/official): dat, mame, nintendo_revised
 * Tier 2 (serial/catalog DB): serialstation
 * Tier 3 (curated community): ps5db, nscollectors, neogeo_x, community_csv
 * Tier 4 (verified retail/boutique fallback): retail_catalog, lgn
 */
export const CANONICAL_SOURCE_PRIORITY: Record<string, number> = {
  dat: 10,
  mame: 20,
  nintendo_revised: 30,
  serialstation: 40,
  ps5db: 50,
  nscollectors: 60,
  neogeo_x: 70,
  community_csv: 80,
  retail_catalog: 90,
  lgn: 100,
  nscollectors_upcoming: 200,
  nscollectors_ciab: 210,
  igdb_physical: 220,
  publisher_whitelist: 230,
  barcode: 240,
  custom: 250,
};

/** Returns numeric source priority (lower = higher authority). */
export function getCanonicalSourcePriority(
  source: string | null | undefined,
): number {
  const key = (source || '').trim().toLowerCase();
  return CANONICAL_SOURCE_PRIORITY[key] ?? 999;
}

/**
 * Maps a canonical source string onto its 1–4 verification tier (or 0 for unverified/fallback).
 * Tier 4 (`retail_catalog`, `lgn`) remains verified at the lowest priority in the hierarchy.
 */
export function getCanonicalSourceTier(
  source: string | null | undefined,
): 0 | 1 | 2 | 3 | 4 {
  switch ((source || '').trim().toLowerCase()) {
    case 'dat':
    case 'mame':
    case 'nintendo_revised':
      return 1;
    case 'serialstation':
      return 2;
    case 'ps5db':
    case 'nscollectors':
    case 'neogeo_x':
    case 'community_csv':
      return 3;
    case 'retail_catalog':
    case 'lgn':
      return 4;
    default:
      return 0;
  }
}

const NOISE_EDITION_RE =
  /\b(?:playstation\s+hits|greatest\s+hits|playstation\s+essentials|essentials|platinum(?:\s+hits)?|best\s+hits|the\s+best|bighit(?:\s+series)?|nintendo\s+selects|player'?s?\s+choice|value\s+selection|welcome\s+price|budget|demo|trial|kiosk|promo(?:tional)?|press\s*(?:kit|disc)|review\s*(?:copy|disc)|not\s+for\s+resale|nfr|beta|alpha|prototype|code[\s-]+in[\s-]+(?:a[\s-]+)?box|ciab)\b/i;

const BRACKET_NOISE_TAG_RE =
  /[([][^)\]]*\b(?:beta|proto|prototype|demo|kiosk|sample|taikenban|trial(?:\s+(?:version|edition|disc))?|promo(?:tional)?|nfr|not\s+for\s+resale|press\s*(?:kit|disc)|review\s*(?:copy|disc)|playstation\s+hits|greatest\s+hits|playstation\s+essentials|essentials|platinum(?:\s+hits)?|the\s+best|best\s+hits|bighit(?:\s+series)?|nintendo\s+selects|player'?s?\s+choice|value\s+selection|welcome\s+price)\b[^)\]]*[)\]]/i;

const TRAILING_BUDGET_REPRINT_RE =
  /(?:\s*[:\-–—]\s*|\s+)(?:playstation\s+hits|greatest\s+hits|playstation\s+essentials|platinum\s+hits|best\s+hits|the\s+best|bighit\s+series|nintendo\s+selects|player'?s?\s+choice|value\s+selection|welcome\s+price)$/i;

const PLAYSTATION_PLATFORMS = new Set([29, 30, 31, 32, 33, 34, 35]);

const TRAILING_PS_REPRINT_RE =
  /\s*[:\-–—]\s*(?:platinum|essentials|classics|demo(?:\s+disc)?|trial(?:\s+disc)?|not\s+for\s+resale|nfr|promo(?:tional)?|press\s*kit|review\s*copy)$/i;

const EXPLICIT_NON_GAME_TITLE_RE =
  /\b(?:playable\s+demo|demo\s+disc|trial\s+(?:edition|version|disc)|kiosk\s+(?:demo|disc)|not\s+for\s+resale|digital\s+(?:download\s+)?code|voucher\s+only|download\s+only|code[\s-]+in[\s-]+(?:a[\s-]+)?box|season\s+pass\s+only|soundtrack\s+(?:cd|vinyl|lp|only)|art\s*book\s+only|strategy\s+guide)\b/i;

/**
 * Shared conservative noise/demo/budget-reprint filter across non-DAT sources
 * (`serialstation`, `ps5db`, `retail_catalog`, `lgn`) consistent with Redump/No-Intro DAT filtering.
 * Preserves real titles containing words like "Platinum" (e.g. "Pokémon Platinum") and the three
 * curated boxed PSVR Demo Discs on PS4 (`platformId = 34`).
 */
export function isCanonicalNoiseTitle(
  rawTitle: string,
  platformId?: number | null,
  edition?: string | null,
): boolean {
  const title = (rawTitle || '').trim();
  if (!title) return true;

  if (platformId === 34 && isCuratedPsvrDemoDiscTitle(title)) {
    return false;
  }

  if (edition && NOISE_EDITION_RE.test(edition)) {
    return true;
  }

  if (isIgnoredFormatRelease(title, '', platformId ?? undefined)) {
    return true;
  }

  if (
    BRACKET_NOISE_TAG_RE.test(title) ||
    TRAILING_BUDGET_REPRINT_RE.test(title) ||
    EXPLICIT_NON_GAME_TITLE_RE.test(title)
  ) {
    return true;
  }

  if (
    platformId != null &&
    PLAYSTATION_PLATFORMS.has(platformId) &&
    TRAILING_PS_REPRINT_RE.test(title)
  ) {
    return true;
  }

  return false;
}
