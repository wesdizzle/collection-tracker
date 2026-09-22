/**
 * GAMEYE & PRICECHARTING RECONCILIATION CLIENT
 *
 * Provides title resolution, platform/country mapping, and PriceCharting (VGPC)
 * price extraction using GAMEYE's public deep_search API endpoint.
 */

import axios from 'axios';

export const GAMEYE_API_BASE = 'https://www.gameye.app/api';

/**
 * Gagglog Platform ID -> GAMEYE Platform ID mapping.
 */
export const GAGGLOG_TO_GAMEYE_PLATFORM: Record<number, number> = {
  1: 21, // 3DO Interactive Multiplayer
  2: 22, // Atari 2600
  3: 23, // Atari 5200
  4: 24, // Atari 7800
  5: 26, // Atari Lynx
  6: 25, // Atari Jaguar
  7: 28, // ColecoVision
  8: 27, // Intellivision
  9: 30, // Neo Geo AES
  10: 31, // Neo Geo CD
  11: 33, // Neo Geo Pocket Color
  13: 7, // Nintendo Entertainment System
  14: 4, // Game Boy
  15: 6, // Super Nintendo Entertainment System
  16: 35, // Virtual Boy
  17: 3, // Nintendo 64
  18: 42, // Game Boy Color
  19: 5, // Game Boy Advance
  20: 2, // Nintendo GameCube
  21: 8, // Nintendo DS
  22: 9, // Wii
  23: 41, // Nintendo 3DS
  24: 36, // Wii U
  25: 41, // New Nintendo 3DS
  26: 97, // Nintendo Switch
  27: 97, // Nintendo Switch 2
  28: 38, // Philips CD-i
  29: 10, // PlayStation
  30: 11, // PlayStation 2
  31: 13, // PlayStation Portable
  32: 12, // PlayStation 3
  33: 37, // PlayStation Vita
  34: 46, // PlayStation 4
  35: 105, // PlayStation 5
  36: 34, // Sega Master System
  37: 18, // Sega Genesis
  38: 19, // Sega Game Gear
  39: 20, // Sega CD
  41: 32, // Sega 32X
  42: 17, // Sega Saturn
  43: 16, // Dreamcast
  45: 29, // TurboGrafx-16
  46: 43, // TurboGrafx CD
  47: 14, // Xbox
  48: 15, // Xbox 360
  49: 47, // Xbox One
  50: 106, // Xbox Series X
  51: 46, // PlayStation VR -> PS4 platform
  52: 105, // PlayStation VR2 -> PS5 platform
  53: 7, // Famicom -> NES platform
};

/**
 * Region String -> GAMEYE Country ID mapping.
 */
export const GAGGLOG_TO_GAMEYE_COUNTRY: Record<string, number> = {
  USA: 1,
  US: 1,
  'North America': 1,
  Europe: 15,
  EUR: 15,
  UK: 15,
  PAL: 15,
  Japan: 3,
  JPN: 3,
  World: 34,
};

export const GAMEYE_TOY_PLATFORMS: Record<string, number> = {
  Skylanders: 119,
  amiibo: 116,
  Starlink: 119, // In GAMEYE toys-to-life category
};

export interface GameyeRecord {
  id: number;
  category_id: number;
  platform_id: number;
  country_id: number;
  title: string;
  release_date?: number | null;
  has_vgpc?: boolean;
  price?: {
    Loose?: number | null;
    CIB?: number | null;
    New?: number | null;
    ManualPrice?: number | null;
    BoxPrice?: number | null;
    BoxedPrice?: number | null;
  } | null;
}

export interface GameyeSearchResult {
  gameye_id: number;
  gameye_platform_id: number;
  gameye_country_id: number;
  title: string;
  price_loose: number | null;
  price_cib: number | null;
  price_new: number | null;
  has_vgpc: boolean;
  confidence: 'exact' | 'high' | 'medium' | 'low';
}

/**
 * Normalizes title for search query: strips disc markers, revisions, and parentheticals.
 */
export function cleanTitleForSearch(title: string): string {
  return title
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/\s*-\s*Disc\s*\d+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compares two titles for confidence scoring.
 */
export function scoreTitleMatch(
  searchTitle: string,
  candidateTitle: string,
): 'exact' | 'high' | 'medium' | 'low' {
  const normSearch = searchTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normCandidate = candidateTitle.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (normSearch === normCandidate) {
    return 'exact';
  }

  // Exact startsWith or includes
  if (
    normCandidate.startsWith(normSearch) ||
    normSearch.startsWith(normCandidate)
  ) {
    return 'high';
  }

  // Word overlap
  const searchWords = new Set(
    searchTitle.toLowerCase().split(/\s+/).filter(Boolean),
  );
  const candWords = new Set(
    candidateTitle.toLowerCase().split(/\s+/).filter(Boolean),
  );

  let common = 0;
  for (const w of searchWords) {
    if (candWords.has(w)) common++;
  }

  const ratio = common / Math.max(searchWords.size, 1);
  if (ratio >= 0.75) return 'high';
  if (ratio >= 0.5) return 'medium';
  return 'low';
}

/**
 * Searches GAMEYE deep_search for a game title.
 */
export async function searchGameyeGame(
  title: string,
  gagglogPlatformId: number,
  region?: string | null,
  client: { get: typeof axios.get } = axios,
): Promise<GameyeSearchResult | null> {
  const gameyePlatformId = GAGGLOG_TO_GAMEYE_PLATFORM[gagglogPlatformId];
  if (!gameyePlatformId) {
    return null;
  }

  const queryTitle = cleanTitleForSearch(title);
  if (!queryTitle) {
    return null;
  }

  const countryId =
    (region && GAGGLOG_TO_GAMEYE_COUNTRY[region]) ||
    GAGGLOG_TO_GAMEYE_COUNTRY['USA'] ||
    1;

  try {
    // Pass 1: Targeted by platform and country
    const url = `${GAMEYE_API_BASE}/deep_search?offset=0&limit=10&title=${encodeURIComponent(queryTitle)}&platforms=${gameyePlatformId}&country=${countryId}&cat=0`;
    const response = await client.get(url, { timeout: 10000 });
    const records: GameyeRecord[] = response.data?.records || [];

    if (records.length === 0) {
      // Pass 2: Fallback without country filter
      const fallbackUrl = `${GAMEYE_API_BASE}/deep_search?offset=0&limit=10&title=${encodeURIComponent(queryTitle)}&platforms=${gameyePlatformId}&cat=0`;
      const fallbackRes = await client.get(fallbackUrl, { timeout: 10000 });
      const fallbackRecords: GameyeRecord[] = fallbackRes.data?.records || [];
      if (fallbackRecords.length > 0) {
        return pickBestRecord(queryTitle, fallbackRecords, gameyePlatformId);
      }
      return null;
    }

    return pickBestRecord(queryTitle, records, gameyePlatformId);
  } catch {
    return null;
  }
}

/**
 * Searches GAMEYE deep_search for a toy figure (Skylanders, amiibo, Starlink).
 */
export async function searchGameyeToy(
  name: string,
  line: string,
  client: { get: typeof axios.get } = axios,
): Promise<GameyeSearchResult | null> {
  const queryName = cleanTitleForSearch(name);
  if (!queryName) {
    return null;
  }

  const platformId = GAMEYE_TOY_PLATFORMS[line];
  const platformParam = platformId ? `&platforms=${platformId}` : '';

  try {
    const url = `${GAMEYE_API_BASE}/deep_search?offset=0&limit=15&title=${encodeURIComponent(queryName)}&cat=3${platformParam}`;
    const response = await client.get(url, { timeout: 10000 });
    const records: GameyeRecord[] = response.data?.records || [];

    if (records.length === 0) {
      return null;
    }

    return pickBestRecord(queryName, records, platformId || 0);
  } catch {
    return null;
  }
}

function pickBestRecord(
  queryTitle: string,
  records: GameyeRecord[],
  preferredPlatformId: number,
): GameyeSearchResult | null {
  let bestRecord: GameyeRecord | null = null;
  let bestConfidence: 'exact' | 'high' | 'medium' | 'low' = 'low';

  for (const record of records) {
    // Skip records with mismatched platforms if a preferred platform was specified
    if (preferredPlatformId && record.platform_id !== preferredPlatformId) {
      continue;
    }

    const conf = scoreTitleMatch(queryTitle, record.title);
    if (conf === 'exact') {
      bestRecord = record;
      bestConfidence = conf;
      break;
    }

    if (conf === 'high' && bestConfidence !== 'high') {
      bestRecord = record;
      bestConfidence = conf;
    } else if (conf === 'medium' && bestConfidence === 'low') {
      bestRecord = record;
      bestConfidence = conf;
    } else if (!bestRecord) {
      bestRecord = record;
      bestConfidence = conf;
    }
  }

  if (!bestRecord) {
    return null;
  }

  return {
    gameye_id: bestRecord.id,
    gameye_platform_id: bestRecord.platform_id,
    gameye_country_id: bestRecord.country_id,
    title: bestRecord.title,
    price_loose: bestRecord.price?.Loose ?? null,
    price_cib: bestRecord.price?.CIB ?? null,
    price_new: bestRecord.price?.New ?? null,
    has_vgpc: !!bestRecord.has_vgpc,
    confidence: bestConfidence,
  };
}
