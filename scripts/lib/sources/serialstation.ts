/**
 * SERIALSTATION OPENAPI V1 SOURCE ADAPTER (Vita, PS4, PS5 by default)
 *
 * Fetches paginated physical releases (`/v1/releases/?release_type=PHYSICAL&limit=100`)
 * into `data/sources/serialstation_releases.json` and re-exports shared parser helpers.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CanonicalRelease } from '../../../shared/canonical_releases.js';
import {
  DEFAULT_SERIALSTATION_PLATFORM_IDS,
  mapSerialStationTitleIdToPlatformId,
  parseSerialStationRecords,
  SERIALSTATION_PAGE_LIMIT,
  SERIALSTATION_RELEASES_URL,
  SERIALSTATION_TMDB_URL,
  SerialStationReleaseItem,
  SerialStationTmdbItem,
} from '../../../shared/serialstation.js';

export {
  DEFAULT_SERIALSTATION_PLATFORM_IDS,
  mapSerialStationTitleIdToPlatformId,
  parseSerialStationRecords,
  SERIALSTATION_PAGE_LIMIT,
  SERIALSTATION_RELEASES_URL,
  SERIALSTATION_TMDB_URL,
  type SerialStationReleaseItem,
  type SerialStationTmdbItem,
};

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
    includeTmdb?: boolean;
    allowedPlatformIds?: Set<number>;
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
  const includeTmdb = options?.includeTmdb ?? false;

  const releases = await fetchPaginatedEndpoint<SerialStationReleaseItem>(
    SERIALSTATION_RELEASES_URL,
    'release_type=PHYSICAL',
    maxPages,
    delayMs,
    fetchFn,
  );
  const tmdbItems = includeTmdb
    ? await fetchPaginatedEndpoint<SerialStationTmdbItem>(
        SERIALSTATION_TMDB_URL,
        'media_type=disc',
        maxPages,
        delayMs,
        fetchFn,
      )
    : [];

  const releasesPath = path.join(sourcesDir, 'serialstation_releases.json');
  const tmdbPath = path.join(sourcesDir, 'serialstation_tmdb.json');
  fs.writeFileSync(releasesPath, JSON.stringify({ items: releases }), 'utf8');
  if (includeTmdb) {
    fs.writeFileSync(tmdbPath, JSON.stringify({ items: tmdbItems }), 'utf8');
  }

  const parsed = parseSerialStationRecords(releases, tmdbItems, {
    allowedPlatformIds: options?.allowedPlatformIds,
  });
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
  options?: { allowedPlatformIds?: Set<number>; includeTmdb?: boolean },
): CanonicalRelease[] {
  const releasesPath = path.join(sourcesDir, 'serialstation_releases.json');
  const tmdbPath = path.join(sourcesDir, 'serialstation_tmdb.json');
  const includeTmdb = options?.includeTmdb ?? false;
  if (
    !fs.existsSync(releasesPath) &&
    (!includeTmdb || !fs.existsSync(tmdbPath))
  ) {
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
  if (includeTmdb && fs.existsSync(tmdbPath)) {
    const parsed = JSON.parse(fs.readFileSync(tmdbPath, 'utf8')) as {
      items?: SerialStationTmdbItem[];
    };
    tmdbItems = Array.isArray(parsed.items) ? parsed.items : [];
  }

  return parseSerialStationRecords(releases, tmdbItems, {
    allowedPlatformIds: options?.allowedPlatformIds,
  });
}
