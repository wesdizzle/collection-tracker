/**
 * SERIALSTATION OPENAPI V1 SOURCE ADAPTER (PlayStation 3, Vita, PSP, PS4, PS5, PSVR, PSVR2)
 *
 * Fetches paginated physical releases (`/v1/releases/?release_type=PHYSICAL&limit=100`)
 * and physical disc TMDB masters (`/v1/tmdb/?media_type=disc&limit=100`), maps
 * PlayStation product Title IDs and console tags to tracker `platform_id`s, and emits
 * CanonicalRelease rows with `source = 'serialstation'`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CanonicalRelease } from '../../../shared/canonical_releases.js';
import { normalizeSpreadsheetRegion } from '../../../shared/switch_revisions.js';
import { normalizeTitleForMatching } from '../../../shared/title_matching.js';

export const SERIALSTATION_RELEASES_URL =
  'https://api.serialstation.com/v1/releases/';
export const SERIALSTATION_TMDB_URL = 'https://api.serialstation.com/v1/tmdb/';
export const SERIALSTATION_PAGE_LIMIT = 100;

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
 * Converts SerialStation `/v1/releases/` + `/v1/tmdb/` records into deduplicated
 * PlayStation CanonicalRelease records.
 */
export function parseSerialStationRecords(
  releases: SerialStationReleaseItem[],
  tmdbItems: SerialStationTmdbItem[],
): CanonicalRelease[] {
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
    if (!platformId) continue;

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
    if (!platformId) continue;

    const rawTitle = cleanTmdbTitle(tmdb);
    const normTitle = normalizeTitleForMatching(rawTitle);
    if (!rawTitle || !normTitle) continue;

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

async function fetchPaginatedEndpoint<T>(
  baseUrl: string,
  extraParams: string,
  maxPages: number,
  delayMs: number,
  fetchFn: typeof fetch,
): Promise<T[]> {
  const allItems: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const offset = page * SERIALSTATION_PAGE_LIMIT;
    const sep = baseUrl.includes('?') ? '&' : '?';
    const url = `${baseUrl}${sep}${extraParams}&limit=${SERIALSTATION_PAGE_LIMIT}&offset=${offset}`;
    const res = await fetchFn(url, {
      headers: {
        'User-Agent': 'CollectionTracker/2.0 (SerialStationSourceFetch)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      throw new Error(
        `SerialStation request failed (${res.status} ${res.statusText}): ${url}`,
      );
    }
    const payload = (await res.json()) as { items?: T[]; count?: number };
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (items.length === 0) break;
    allItems.push(...items);

    const totalCount =
      typeof payload.count === 'number' ? payload.count : undefined;
    if (
      items.length < SERIALSTATION_PAGE_LIMIT ||
      (totalCount !== undefined && allItems.length >= totalCount)
    ) {
      break;
    }

    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return allItems;
}

export async function fetchSerialStationSources(
  sourcesDir: string,
  options?: {
    maxPages?: number;
    delayMs?: number;
    fetchFn?: typeof fetch;
  },
): Promise<{
  releasesPath: string;
  tmdbPath: string;
  releasesCount: number;
  tmdbCount: number;
  parsedCount: number;
}> {
  fs.mkdirSync(sourcesDir, { recursive: true });
  const maxPages = options?.maxPages ?? 600;
  const delayMs = options?.delayMs ?? 100;
  const fetchFn = options?.fetchFn ?? fetch;

  const releases = await fetchPaginatedEndpoint<SerialStationReleaseItem>(
    SERIALSTATION_RELEASES_URL,
    'release_type=PHYSICAL',
    maxPages,
    delayMs,
    fetchFn,
  );
  const tmdbItems = await fetchPaginatedEndpoint<SerialStationTmdbItem>(
    SERIALSTATION_TMDB_URL,
    'media_type=disc',
    maxPages,
    delayMs,
    fetchFn,
  );

  const releasesPath = path.join(sourcesDir, 'serialstation_releases.json');
  const tmdbPath = path.join(sourcesDir, 'serialstation_tmdb.json');
  fs.writeFileSync(releasesPath, JSON.stringify({ items: releases }), 'utf8');
  fs.writeFileSync(tmdbPath, JSON.stringify({ items: tmdbItems }), 'utf8');

  const parsed = parseSerialStationRecords(releases, tmdbItems);
  return {
    releasesPath,
    tmdbPath,
    releasesCount: releases.length,
    tmdbCount: tmdbItems.length,
    parsedCount: parsed.length,
  };
}

export function loadSerialStationReleases(
  sourcesDir: string,
): CanonicalRelease[] {
  const releasesPath = path.join(sourcesDir, 'serialstation_releases.json');
  const tmdbPath = path.join(sourcesDir, 'serialstation_tmdb.json');
  if (!fs.existsSync(releasesPath) && !fs.existsSync(tmdbPath)) {
    return [];
  }

  let releases: SerialStationReleaseItem[] = [];
  if (fs.existsSync(releasesPath)) {
    const parsed = JSON.parse(fs.readFileSync(releasesPath, 'utf8')) as {
      items?: SerialStationReleaseItem[];
    };
    releases = Array.isArray(parsed.items) ? parsed.items : [];
  }

  let tmdbItems: SerialStationTmdbItem[] = [];
  if (fs.existsSync(tmdbPath)) {
    const parsed = JSON.parse(fs.readFileSync(tmdbPath, 'utf8')) as {
      items?: SerialStationTmdbItem[];
    };
    tmdbItems = Array.isArray(parsed.items) ? parsed.items : [];
  }

  return parseSerialStationRecords(releases, tmdbItems);
}
