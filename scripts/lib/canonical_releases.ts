/**
 * CANONICAL RELEASES & PHYSICAL VERIFICATION ENGINE
 *
 * Provides high-performance physical release normalization, deduplication,
 * multi-tier confirmation heuristics, and physical publisher catalog matching.
 *
 * Designed to operate within zero-cost constraints across Cloudflare Workers (D1/R2)
 * and local SQLite environments.
 */

import { normalizeTitleForMatching, titlesMatch } from './title_matching.js';
import {
  extractRegions,
  extractVariants,
  isIgnoredFormatRelease,
} from './dat_cache.js';

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
    | 'custom';
  is_verified_physical: number;
}

export type PhysicalStatus =
  | 'verified_physical'
  | 'likely_physical'
  | 'digital_only'
  | 'unverified';

export interface PhysicalVerificationResult {
  physical_status: PhysicalStatus;
  verification_tier: number; // 1 = DAT/Redump, 2 = Barcode/Publisher/IGDB, 3 = Heuristic Fluff, 0 = Unverified
  is_physical: boolean;
  reasons: string[];
  matched_releases: CanonicalRelease[];
  physical_regions: string[];
}

/**
 * Curated list of known physical-only or boutique physical console publishers.
 * Matching these provides a high-confidence Tier 2 physical release signal.
 */
export const PHYSICAL_PUBLISHERS_WHITELIST = new Set<string>([
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
  'tesura games',
]);

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

  // IGDB Category Check:
  // 1 = DLC / Addon, 2 = Expansion, 3 = Bundle, 5 = Mod, 6 = Episode, 7 = Season
  if (igdbCategory && [1, 2, 3, 5, 6, 7].includes(igdbCategory)) {
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
 * Detects the physical release status of a candidate game across all three verification tiers.
 */
export function detectPhysicalReleaseStatus(options: {
  platformId: number;
  gameTitle: string;
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
    return titlesMatch(
      gameTitle,
      cleanTitleWithoutParentheticals(r.raw_title),
      r.raw_title,
      platformId,
    );
  });

  if (matchedReleases.length > 0) {
    const regions = Array.from(
      new Set(
        matchedReleases
          .map((r) => r.region)
          .filter((reg): reg is string => Boolean(reg))
          .flatMap((reg) => reg.split(',').map((s) => s.trim())),
      ),
    );

    reasons.push(
      `Matched ${matchedReleases.length} canonical physical release variant(s) in DAT database`,
    );

    return {
      physical_status: 'verified_physical',
      verification_tier: 1,
      is_physical: true,
      reasons,
      matched_releases: matchedReleases,
      physical_regions: regions,
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

  // Tier 2: Free Signals (Publisher Whitelist, Packaging, Barcode, Serial)
  const pubClean = (publisher || '').toLowerCase().trim();
  const isWhitelistedPublisher = Array.from(PHYSICAL_PUBLISHERS_WHITELIST).some(
    (p) => pubClean.includes(p),
  );

  if (isWhitelistedPublisher) {
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

  // Fallback: Retro platforms with 100% DAT coverage are digital only if not in DAT
  const retroPlatformsWithFullDats = new Set([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21, 28,
    29, 30, 31, 36, 37, 38, 39, 41, 42, 43, 45, 46, 47, 53,
  ]);

  if (retroPlatformsWithFullDats.has(platformId)) {
    reasons.push('Retro platform with full DAT coverage had no physical match');
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
  }>,
): CanonicalRelease[] {
  const releaseMap = new Map<string, CanonicalRelease>();

  for (const rel of rawReleases) {
    if (!rel.roms || rel.roms.length === 0) continue;

    const primaryRom = rel.roms[0];
    if (isIgnoredFormatRelease(rel.name, primaryRom.name, platformId)) {
      continue;
    }

    const cleanBase = cleanTitleWithoutParentheticals(rel.name);
    const normalized = normalizeTitleForMatching(cleanBase);
    if (!normalized) continue;

    const region = extractRegions(rel.name);
    const variants = extractVariants(rel.name);
    const serial =
      primaryRom.serial ||
      extractSerialCode(rel.name) ||
      extractSerialCode(primaryRom.name);

    // Grouping key: platform + normalized title + primary region
    const groupKey = `${platformId}::${normalized}::${region || 'World'}::${variants || 'Standard'}`;

    if (!releaseMap.has(groupKey)) {
      releaseMap.set(groupKey, {
        platform_id: platformId,
        raw_title: cleanBase,
        normalized_title: normalized,
        region: region || null,
        variants: variants || null,
        rom_name: primaryRom.name,
        rom_crc: primaryRom.crc || null,
        serial_code: serial || null,
        barcode: null,
        publisher: null,
        source: 'dat',
        is_verified_physical: 1,
      });
    } else {
      // If entry exists, append secondary variant info or update CRC if missing
      const existing = releaseMap.get(groupKey)!;
      if (!existing.rom_crc && primaryRom.crc) {
        existing.rom_crc = primaryRom.crc;
      }
      if (!existing.serial_code && serial) {
        existing.serial_code = serial;
      }
    }
  }

  return Array.from(releaseMap.values());
}
