/**
 * SERIALSTATION OPENAPI V1 SHARED PARSER (PS3, Vita, PSP, PS4, PS5)
 *
 * Pure parser for SerialStation `/v1/releases/?release_type=PHYSICAL&limit=100`
 * (and optional `/v1/tmdb/?media_type=disc`) responses, safe for both Cloudflare
 * Workers and Node CLI scripts.
 */

import {
  CanonicalRelease,
  isCanonicalNoiseTitle,
} from './canonical_releases.js';
import { normalizeSpreadsheetRegion } from './switch_revisions.js';
import { normalizeTitleForMatching } from './title_matching.js';

export const SERIALSTATION_RELEASES_URL =
  'https://api.serialstation.com/v1/releases/';
export const SERIALSTATION_TMDB_URL = 'https://api.serialstation.com/v1/tmdb/';
export const SERIALSTATION_PAGE_LIMIT = 100;

/**
 * Default platforms synced from SerialStation (Option A): Vita (33), PS4 (34), PS5 (35).
 * Older Sony DAT-covered consoles (PS1 29, PS2 30, PSP 31, PS3 32) are excluded by default.
 */
export const DEFAULT_SERIALSTATION_PLATFORM_IDS = new Set<number>([33, 34, 35]);

export interface SerialStationReleaseItem {
  id?: string;
  name?: string | null;
  regions?: string[] | null;
  title_id?: string | null;
  edition?: string | null;
  release_date?: string | null;
  release_type?: string | null;
  barcode?: string | null;
  publisher_serial?: string | null;
}

export interface SerialStationTmdbItem {
  title_id?: string | null;
  console?: string[] | null;
  name?: string | null;
  names?: Array<{ language?: string | null; name?: string | null }> | null;
  media_type?: string | null;
  ps_vr?: number | boolean | null;
}

const PS5_PREFIXES = new Set([
  'PPSA',
  'ELAS',
  'ELJM',
  'ELJS',
  'ELKS',
  'ECAS',
  'ECJS',
  'ECKS',
  'ECUS',
  'ECES',
  'ELUS',
  'ELES',
]);

const PS4_PREFIXES = new Set([
  'CUSA',
  'PLAS',
  'PLJM',
  'PLJS',
  'PLKS',
  'PCAS',
  'PCJS',
  'PCKS',
  'PLCS',
  'PCUS',
  'PCES',
  'PLUS',
  'PLES',
]);

const VITA_PREFIXES = new Set([
  'PCSE',
  'PCSB',
  'PCSA',
  'PCSG',
  'PCSH',
  'VLAS',
  'VLJM',
  'VLJS',
  'VLKS',
  'VCAS',
  'VCJS',
  'VCKS',
  'VCUS',
  'VCES',
  'VLUS',
  'VLES',
]);

const PS3_PREFIXES = new Set([
  'BCUS',
  'BLUS',
  'BCES',
  'BLES',
  'BCAS',
  'BLAS',
  'BCJS',
  'BLJS',
  'BLJM',
  'BCKS',
  'BLKS',
  'BCED',
  'BLED',
  'BCET',
  'BLET',
  'BCJB',
  'BLJB',
  'BCJD',
  'BCJV',
  'BCJX',
  'BCJZ',
  'BLJX',
]);

const PSP_PREFIXES = new Set([
  'UCUS',
  'ULUS',
  'UCES',
  'ULES',
  'UCAS',
  'ULAS',
  'UCJS',
  'ULJS',
  'ULJM',
  'UCKS',
  'ULKS',
  'UCET',
  'ULET',
  'UCJB',
  'ULJB',
]);

export function mapSerialStationTitleIdToPlatformId(
  titleId: string | null | undefined,
  consoleTags?: string[] | null,
  _isPsVr?: number | boolean | null,
): number | null {
  void _isPsVr;
  const cleanId = (titleId || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const prefix = cleanId.slice(0, 4);

  if (PS5_PREFIXES.has(prefix)) return 35;
  if (PS4_PREFIXES.has(prefix)) return 34;
  if (VITA_PREFIXES.has(prefix)) return 33;
  if (PS3_PREFIXES.has(prefix)) return 32;
  if (PSP_PREFIXES.has(prefix)) return 31;

  const upperConsoles = (consoleTags || []).map((c) => c.toUpperCase());
  if (
    upperConsoles.some((c) => c.includes('PS5') || c.includes('PLAYSTATION 5'))
  ) {
    return 35;
  }
  if (
    upperConsoles.some((c) => c.includes('PS4') || c.includes('PLAYSTATION 4'))
  ) {
    return 34;
  }
  if (upperConsoles.some((c) => c.includes('VITA'))) return 33;
  if (
    upperConsoles.some((c) => c.includes('PS3') || c.includes('PLAYSTATION 3'))
  ) {
    return 32;
  }
  if (upperConsoles.some((c) => c.includes('PSP'))) return 31;

  return null;
}

function inferRegionFromTitleId(titleId: string | null | undefined): string {
  const cleanId = (titleId || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  if (cleanId.length < 4) return 'World';
  const regionChar = cleanId[2];
  if (regionChar === 'U') return 'USA';
  if (regionChar === 'E') return 'Europe';
  if (regionChar === 'J') return 'Japan';
  if (regionChar === 'K') return 'Korea';
  if (regionChar === 'A' || regionChar === 'H') return 'Asia';
  return 'World';
}

function normalizeSerialStationRegions(
  regions: string[] | null | undefined,
  titleId?: string | null,
): string {
  if (!Array.isArray(regions) || regions.length === 0) {
    return inferRegionFromTitleId(titleId);
  }
  const tokens = new Set<string>();
  for (const raw of regions) {
    const trimmed = (raw || '').trim();
    if (!trimmed) continue;
    const upper = trimmed.toUpperCase();
    if (
      upper.includes('AMERICA') ||
      upper === 'USA' ||
      upper === 'US' ||
      upper === 'NA'
    ) {
      tokens.add('USA');
      continue;
    }
    if (
      upper.includes('EUROPE') ||
      upper === 'EU' ||
      upper === 'PAL' ||
      upper === 'UK'
    ) {
      tokens.add('Europe');
      continue;
    }
    if (upper.includes('JAPAN') || upper === 'JP' || upper === 'JPN') {
      tokens.add('Japan');
      continue;
    }
    if (upper === 'KOREA' || upper === 'KR') {
      tokens.add('Korea');
      continue;
    }
    if (upper.includes('ASIA')) {
      tokens.add('Asia');
      continue;
    }
    if (upper.includes('AUSTRALIA') || upper === 'AU' || upper === 'AUS') {
      tokens.add('Australia');
      continue;
    }
    const normalized = normalizeSpreadsheetRegion(trimmed);
    if (normalized) {
      for (const part of normalized.split(',')) {
        const clean = part.trim();
        if (clean) tokens.add(clean);
      }
      continue;
    }
    tokens.add(trimmed);
  }
  return tokens.size > 0
    ? Array.from(tokens).join(', ')
    : inferRegionFromTitleId(titleId);
}

function cleanTmdbTitle(item: SerialStationTmdbItem): string {
  const names = item.names || [];
  const english =
    names.find((n) => n.language === '1' && n.name)?.name ||
    names.find((n) => n.language === '18' && n.name)?.name ||
    item.name ||
    '';
  return english.replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Converts SerialStation `/v1/releases/` (and optional `/v1/tmdb/`) records into deduplicated
 * PlayStation CanonicalRelease records.
 */
export function parseSerialStationRecords(
  releases: SerialStationReleaseItem[],
  tmdbItems: SerialStationTmdbItem[] = [],
  options?: { allowedPlatformIds?: Set<number> },
): CanonicalRelease[] {
  const allowedPlatformIds =
    options?.allowedPlatformIds ?? DEFAULT_SERIALSTATION_PLATFORM_IDS;
  const results: CanonicalRelease[] = [];
  const seenKeys = new Set<string>();

  const tmdbByTitleId = new Map<string, SerialStationTmdbItem>();
  for (const tmdb of tmdbItems) {
    const cleanId = (tmdb.title_id || '').trim().toUpperCase();
    if (cleanId && !tmdbByTitleId.has(cleanId)) {
      tmdbByTitleId.set(cleanId, tmdb);
    }
  }

  for (const rel of releases) {
    if (rel.release_type && rel.release_type !== 'PHYSICAL') continue;
    const rawTitle = (rel.name || '')
      .replace(/[™®©]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const normTitle = normalizeTitleForMatching(rawTitle);
    if (!rawTitle || !normTitle) continue;

    const cleanId = (rel.title_id || '').trim().toUpperCase() || null;
    const tmdb = cleanId ? tmdbByTitleId.get(cleanId) : undefined;
    const platformId = mapSerialStationTitleIdToPlatformId(
      cleanId,
      tmdb?.console,
      tmdb?.ps_vr,
    );
    if (!platformId || !allowedPlatformIds.has(platformId)) continue;
    if (isCanonicalNoiseTitle(rawTitle, platformId, rel.edition)) continue;

    const region = normalizeSerialStationRegions(rel.regions, cleanId);
    const edition = (rel.edition || '').trim();
    const variants =
      edition && !/^(original|standard)$/i.test(edition) ? edition : null;
    const barcode = (rel.barcode || '').trim() || null;
    const dedupKey = `${platformId}::${normTitle}::${region}::${cleanId || ''}::${variants || ''}`;
    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);

    results.push({
      platform_id: platformId,
      raw_title: rawTitle,
      normalized_title: normTitle,
      region,
      variants,
      rom_name: null,
      rom_crc: null,
      serial_code: cleanId,
      barcode,
      publisher: null,
      source: 'serialstation',
      is_verified_physical: 1,
    });
  }

  for (const tmdb of tmdbItems) {
    if (tmdb.media_type && tmdb.media_type.toLowerCase() !== 'disc') continue;
    const cleanId = (tmdb.title_id || '').trim().toUpperCase() || null;
    const platformId = mapSerialStationTitleIdToPlatformId(
      cleanId,
      tmdb.console,
      tmdb.ps_vr,
    );
    if (!platformId || !allowedPlatformIds.has(platformId)) continue;

    const rawTitle = cleanTmdbTitle(tmdb);
    const normTitle = normalizeTitleForMatching(rawTitle);
    if (!rawTitle || !normTitle) continue;
    if (isCanonicalNoiseTitle(rawTitle, platformId)) continue;

    const region = inferRegionFromTitleId(cleanId);
    const dedupKey = `${platformId}::${normTitle}::${region}::${cleanId || ''}::`;
    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);

    results.push({
      platform_id: platformId,
      raw_title: rawTitle,
      normalized_title: normTitle,
      region,
      variants: null,
      rom_name: null,
      rom_crc: null,
      serial_code: cleanId,
      barcode: null,
      publisher: null,
      source: 'serialstation',
      is_verified_physical: 1,
    });
  }

  return results;
}
