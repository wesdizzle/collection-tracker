/**
 * SERIALSTATION OPENAPI V1 SOURCE ADAPTER (Vita, PS4, PS5 by default)
 *
 * Fetches paginated physical releases (`/v1/releases/?release_type=PHYSICAL&limit=100`)
 * sequentially with exponential cooldown retries and resumable partial checkpoints into
 * `data/sources/serialstation_releases.json`, and re-exports shared parser helpers.
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

const SERIALSTATION_MAX_CONSECUTIVE_FAILURES = 5;
const CHECKPOINT_WRITE_INTERVAL_PAGES = 10;

interface SerialStationCheckpoint<T> {
  nextPage: number;
  totalCount?: number;
  items: T[];
}

function writeCheckpointAtomic<T>(
  checkpointPath: string,
  data: SerialStationCheckpoint<T>,
): void {
  const tmpPath = `${checkpointPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data), 'utf8');
  fs.renameSync(tmpPath, checkpointPath);
}

async function fetchPageWithCooldown<T>(
  url: string,
  timeoutMs: number,
  maxRetries: number,
  cooldownBaseMs: number,
  fetchFn: typeof fetch,
): Promise<
  | { ok: true; items: T[]; count?: number }
  | { ok: false; retryable: boolean; errorMsg: string }
> {
  let lastError = 'Unknown fetch error';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetchFn(url, {
        headers: {
          'User-Agent': 'CollectionTracker/2.0 (SerialStationSourceFetch)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        lastError = `SerialStation request failed (${res.status} ${res.statusText}): ${url}`;
        if (!retryable) {
          return { ok: false, retryable: false, errorMsg: lastError };
        }
        if (attempt < maxRetries) {
          const waitMs = cooldownBaseMs * Math.pow(2, attempt);
          if (waitMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, waitMs));
          }
          continue;
        }
        return { ok: false, retryable: true, errorMsg: lastError };
      }
      const payload = (await res.json()) as { items?: T[]; count?: number };
      const items = Array.isArray(payload.items) ? payload.items : [];
      const count =
        typeof payload.count === 'number' ? payload.count : undefined;
      return { ok: true, items, count };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < maxRetries) {
        const waitMs = cooldownBaseMs * Math.pow(2, attempt);
        if (waitMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
        continue;
      }
      return { ok: false, retryable: true, errorMsg: lastError };
    }
  }
  return { ok: false, retryable: true, errorMsg: lastError };
}

async function fetchPaginatedEndpoint<T>(
  baseUrl: string,
  extraParams: string,
  maxPages: number,
  delayMs: number,
  fetchFn: typeof fetch,
  options?: {
    timeoutMs?: number;
    maxRetries?: number;
    cooldownBaseMs?: number;
    checkpointPath?: string;
  },
): Promise<{ items: T[]; skippedPages: number }> {
  const timeoutMs = options?.timeoutMs ?? 15000;
  const maxRetries = options?.maxRetries ?? 3;
  const cooldownBaseMs = options?.cooldownBaseMs ?? 15000;
  const checkpointPath = options?.checkpointPath;

  let startPage = 0;
  let totalCount: number | undefined;
  const allItems: T[] = [];

  if (checkpointPath && fs.existsSync(checkpointPath)) {
    try {
      const saved = JSON.parse(
        fs.readFileSync(checkpointPath, 'utf8'),
      ) as SerialStationCheckpoint<T>;
      if (
        saved &&
        typeof saved.nextPage === 'number' &&
        saved.nextPage >= 0 &&
        Array.isArray(saved.items)
      ) {
        startPage = saved.nextPage;
        totalCount =
          typeof saved.totalCount === 'number' ? saved.totalCount : undefined;
        allItems.push(...saved.items);
        if (startPage > 0) {
          console.log(
            `[SerialStation] Resuming from checkpoint page ${startPage} (${allItems.length} saved items)`,
          );
        }
      }
    } catch {
      // Ignore corrupt checkpoint and restart cleanly from page 0
    }
  }

  let skippedPages = 0;
  let consecutiveFailures = 0;
  const sep = baseUrl.includes('?') ? '&' : '?';

  for (let page = startPage; page < maxPages; page++) {
    if (
      totalCount !== undefined &&
      page * SERIALSTATION_PAGE_LIMIT >= totalCount
    ) {
      break;
    }

    if (page > startPage && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const offset = page * SERIALSTATION_PAGE_LIMIT;
    const url = `${baseUrl}${sep}${extraParams}&limit=${SERIALSTATION_PAGE_LIMIT}&offset=${offset}`;
    const pageRes = await fetchPageWithCooldown<T>(
      url,
      timeoutMs,
      maxRetries,
      cooldownBaseMs,
      fetchFn,
    );

    if (!pageRes.ok) {
      if (!pageRes.retryable) {
        throw new Error(pageRes.errorMsg);
      }
      skippedPages++;
      consecutiveFailures++;
      console.warn(
        `[SerialStation] Skipped page ${page} (offset=${offset}) after ${maxRetries + 1} attempts: ${pageRes.errorMsg}`,
      );
      if (consecutiveFailures >= SERIALSTATION_MAX_CONSECUTIVE_FAILURES) {
        throw new Error(
          `SerialStation aborted after ${consecutiveFailures} consecutive page failures`,
        );
      }
      continue;
    }

    consecutiveFailures = 0;
    if (pageRes.count !== undefined) {
      totalCount = pageRes.count;
    }
    if (pageRes.items.length === 0) break;
    allItems.push(...pageRes.items);

    const isDone =
      pageRes.items.length < SERIALSTATION_PAGE_LIMIT ||
      (totalCount !== undefined && offset + pageRes.items.length >= totalCount);

    if (
      checkpointPath &&
      !isDone &&
      (page + 1) % CHECKPOINT_WRITE_INTERVAL_PAGES === 0
    ) {
      writeCheckpointAtomic(checkpointPath, {
        nextPage: page + 1,
        totalCount,
        items: allItems,
      });
    }

    const totalPagesEst =
      totalCount !== undefined
        ? Math.min(maxPages, Math.ceil(totalCount / SERIALSTATION_PAGE_LIMIT))
        : undefined;
    if ((page + 1) % CHECKPOINT_WRITE_INTERVAL_PAGES === 0 || isDone) {
      console.log(
        `[SerialStation] Progress: page ${page + 1}/${totalPagesEst ?? '?'} (${allItems.length} items, ${skippedPages} skipped pages)`,
      );
    }

    if (isDone) {
      break;
    }
  }

  if (checkpointPath && fs.existsSync(checkpointPath)) {
    fs.unlinkSync(checkpointPath);
  }

  return { items: allItems, skippedPages };
}

export async function fetchSerialStationSources(
  sourcesDir: string,
  options?: {
    maxPages?: number;
    delayMs?: number;
    timeoutMs?: number;
    maxRetries?: number;
    cooldownBaseMs?: number;
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
  skippedPages: number;
}> {
  fs.mkdirSync(sourcesDir, { recursive: true });
  const maxPages = options?.maxPages ?? 600;
  const delayMs = options?.delayMs ?? 2000;
  const fetchFn = options?.fetchFn ?? fetch;
  const includeTmdb = options?.includeTmdb ?? false;
  const releasesCheckpointPath = path.join(
    sourcesDir,
    'serialstation_releases.partial.json',
  );
  const tmdbCheckpointPath = path.join(
    sourcesDir,
    'serialstation_tmdb.partial.json',
  );

  const releasesRes = await fetchPaginatedEndpoint<SerialStationReleaseItem>(
    SERIALSTATION_RELEASES_URL,
    'release_type=PHYSICAL',
    maxPages,
    delayMs,
    fetchFn,
    {
      timeoutMs: options?.timeoutMs,
      maxRetries: options?.maxRetries,
      cooldownBaseMs: options?.cooldownBaseMs,
      checkpointPath: releasesCheckpointPath,
    },
  );
  const tmdbRes = includeTmdb
    ? await fetchPaginatedEndpoint<SerialStationTmdbItem>(
        SERIALSTATION_TMDB_URL,
        'media_type=disc',
        maxPages,
        delayMs,
        fetchFn,
        {
          timeoutMs: options?.timeoutMs,
          maxRetries: options?.maxRetries,
          cooldownBaseMs: options?.cooldownBaseMs,
          checkpointPath: tmdbCheckpointPath,
        },
      )
    : { items: [] as SerialStationTmdbItem[], skippedPages: 0 };

  const releases = releasesRes.items;
  const tmdbItems = tmdbRes.items;

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
    skippedPages: releasesRes.skippedPages + tmdbRes.skippedPages,
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
