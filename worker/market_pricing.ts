/**
 * WORKER EPHEMERAL MARKET PRICING ENGINE
 *
 * Manages the 8-shard L1 (caches.default) + L2 (R2 cache/ebay-prices/shard-0..7.json)
 * ephemeral cache with hard 6-hour per-item expiration, zero D1 persistence of eBay
 * data, and user-owned search query overrides in D1 `price_query_overrides`.
 */

import {
  EphemeralMarketPrice,
  PRICE_CACHE_SHARD_COUNT,
  PriceCacheShardPayload,
  PricingItemDescriptor,
  buildEbaySearchPlan,
  buildEphemeralMarketPrice,
  computeMarketValuation,
  getMarketPriceKey,
  getPriceShardIndex,
  isMarketPriceFresh,
} from '../shared/market_pricing';
import {
  RESOLVE_CANONICAL_GAME_ID_QUERY,
  getResolveCanonicalGameIdParams,
} from '../shared/queries';
import {
  EbayApiError,
  EbayConfigEnv,
  EbayNotConfiguredError,
  EbayRateLimitError,
  EbayRateLimitSnapshot,
  fetchEbayBrowseRateLimits,
  isEbayConfigured,
  searchEbayListings,
} from './ebay_client';

export const R2_PRICE_SHARD_PREFIX = 'cache/ebay-prices/shard-';
export const L1_PRICE_SHARD_URL_PREFIX =
  'https://edge-cache.internal/ebay-prices/v1/shard-';
export const L1_PRICE_SHARD_TTL_SECONDS = 300;
export const MAX_LIVE_BATCH_ITEMS = 5;
export const EBAY_FETCH_CONCURRENCY = 2;
export const BATCH_EBAY_RESULT_LIMIT = 30;
export const WAVE_STAGGER_MS = 200;

export interface MarketPricingEnv extends EbayConfigEnv {
  DB: D1Database;
  BACKUP_BUCKET?: R2Bucket;
  MARKET_PRICING_ACCESS?: string;
}

export interface BatchMarketPriceResult {
  prices: Record<string, EphemeralMarketPrice>;
  cacheHits: number;
  fetchedCount: number;
  errors: Record<string, string>;
  rateLimited: boolean;
  retryableError?: boolean;
  retryAfterSec?: number;
}

function getEdgeCacheSync(): Cache | null {
  if (typeof caches !== 'undefined') {
    const cfCaches = caches as unknown as { default?: Cache };
    if (cfCaches.default) {
      return cfCaches.default;
    }
  }
  return null;
}

export function getPriceShardR2Key(shardIndex: number): string {
  return `${R2_PRICE_SHARD_PREFIX}${shardIndex}.json`;
}

function getPriceShardL1Request(shardIndex: number): Request {
  return new Request(`${L1_PRICE_SHARD_URL_PREFIX}${shardIndex}`);
}

async function readR2Json<T>(obj: R2ObjectBody): Promise<T | null> {
  try {
    if (typeof obj.text === 'function') {
      const txt = await obj.text();
      return txt ? (JSON.parse(txt) as T) : null;
    }
    if (typeof obj.json === 'function') {
      return (await obj.json()) as T;
    }
    return null;
  } catch {
    return null;
  }
}

function filterFreshItems(
  items: Record<string, EphemeralMarketPrice> | undefined | null,
  nowMs: number,
): {
  fresh: Record<string, EphemeralMarketPrice>;
  hadExpired: boolean;
} {
  const fresh: Record<string, EphemeralMarketPrice> = {};
  let hadExpired = false;
  if (!items || typeof items !== 'object') {
    return { fresh, hadExpired };
  }
  for (const [key, entry] of Object.entries(items)) {
    if (entry && isMarketPriceFresh(entry, nowMs)) {
      fresh[key] = entry;
    } else {
      hadExpired = true;
    }
  }
  return { fresh, hadExpired };
}

export async function readPriceShard(
  env: MarketPricingEnv,
  shardIndex: number,
  options: { bypassL1?: boolean; nowMs?: number } = {},
): Promise<Record<string, EphemeralMarketPrice>> {
  const nowMs = options.nowMs ?? Date.now();
  const edgeCache = getEdgeCacheSync();
  const l1Req = getPriceShardL1Request(shardIndex);

  if (!options.bypassL1 && edgeCache) {
    try {
      const l1Res = await edgeCache.match(l1Req);
      if (l1Res) {
        const parsed = (await l1Res.json()) as PriceCacheShardPayload;
        const { fresh, hadExpired } = filterFreshItems(parsed?.items, nowMs);
        if (!hadExpired || Object.keys(fresh).length > 0) {
          return fresh;
        }
      }
    } catch {
      // Fall through to R2 on malformed/failed L1 read
    }
  }

  if (!env.BACKUP_BUCKET) {
    return {};
  }

  const r2Key = getPriceShardR2Key(shardIndex);
  try {
    const obj = await env.BACKUP_BUCKET.get(r2Key);
    if (!obj) {
      return {};
    }
    const parsed = await readR2Json<PriceCacheShardPayload>(obj);
    const { fresh, hadExpired } = filterFreshItems(parsed?.items, nowMs);
    const freshKeys = Object.keys(fresh);

    if (freshKeys.length === 0) {
      if (hadExpired) {
        await env.BACKUP_BUCKET.delete(r2Key).catch(() => {});
        if (edgeCache) {
          await edgeCache.delete(l1Req).catch(() => {});
        }
      }
      return {};
    }

    if (edgeCache) {
      const payload: PriceCacheShardPayload = {
        updatedAt: parsed?.updatedAt || new Date(nowMs).toISOString(),
        items: fresh,
      };
      await edgeCache
        .put(
          l1Req,
          new Response(JSON.stringify(payload), {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': `public, max-age=${L1_PRICE_SHARD_TTL_SECONDS}`,
            },
          }),
        )
        .catch(() => {});
    }

    return fresh;
  } catch {
    return {};
  }
}

export async function writePriceShard(
  env: MarketPricingEnv,
  shardIndex: number,
  updates: Record<string, EphemeralMarketPrice>,
  nowMs: number = Date.now(),
  existingItems?: Record<string, EphemeralMarketPrice>,
): Promise<Record<string, EphemeralMarketPrice>> {
  const existing =
    existingItems ??
    (await readPriceShard(env, shardIndex, {
      bypassL1: true,
      nowMs,
    }));

  const mergedRaw: Record<string, EphemeralMarketPrice> = {
    ...existing,
    ...updates,
  };
  const { fresh } = filterFreshItems(mergedRaw, nowMs);
  const edgeCache = getEdgeCacheSync();
  const l1Req = getPriceShardL1Request(shardIndex);
  const r2Key = getPriceShardR2Key(shardIndex);

  if (Object.keys(fresh).length === 0) {
    if (env.BACKUP_BUCKET) {
      await env.BACKUP_BUCKET.delete(r2Key).catch(() => {});
    }
    if (edgeCache) {
      await edgeCache.delete(l1Req).catch(() => {});
    }
    return {};
  }

  const payload: PriceCacheShardPayload = {
    updatedAt: new Date(nowMs).toISOString(),
    items: fresh,
  };
  const serialized = JSON.stringify(payload);

  if (env.BACKUP_BUCKET) {
    await env.BACKUP_BUCKET.put(r2Key, serialized, {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { updatedAt: payload.updatedAt },
    });
  }

  if (edgeCache) {
    await edgeCache
      .put(
        l1Req,
        new Response(serialized, {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `public, max-age=${L1_PRICE_SHARD_TTL_SECONDS}`,
          },
        }),
      )
      .catch(() => {});
  }

  return fresh;
}

export async function readAllCachedMarketPrices(
  env: MarketPricingEnv,
  options: { bypassL1?: boolean; nowMs?: number } = {},
): Promise<Record<string, EphemeralMarketPrice>> {
  const nowMs = options.nowMs ?? Date.now();
  const merged: Record<string, EphemeralMarketPrice> = {};

  for (let start = 0; start < PRICE_CACHE_SHARD_COUNT; start += 4) {
    const indices = Array.from(
      { length: Math.min(4, PRICE_CACHE_SHARD_COUNT - start) },
      (_, offset) => start + offset,
    );
    const results = await Promise.all(
      indices.map((idx) =>
        readPriceShard(env, idx, {
          bypassL1: options.bypassL1,
          nowMs,
        }),
      ),
    );
    for (const shardMap of results) {
      Object.assign(merged, shardMap);
    }
  }

  return merged;
}

export async function purgeSingleExpiredPriceShard(
  env: MarketPricingEnv,
  shardIndex: number,
  nowMs: number = Date.now(),
): Promise<{ pruned: boolean; remainingCount: number }> {
  if (!env.BACKUP_BUCKET) {
    return { pruned: false, remainingCount: 0 };
  }
  const r2Key = getPriceShardR2Key(shardIndex);
  const obj = await env.BACKUP_BUCKET.get(r2Key);
  if (!obj) {
    return { pruned: false, remainingCount: 0 };
  }
  try {
    const parsed = await readR2Json<PriceCacheShardPayload>(obj);
    const { fresh, hadExpired } = filterFreshItems(parsed?.items, nowMs);
    const remainingCount = Object.keys(fresh).length;
    if (!hadExpired) {
      return { pruned: false, remainingCount };
    }
    const edgeCache = getEdgeCacheSync();
    const l1Req = getPriceShardL1Request(shardIndex);
    if (remainingCount === 0) {
      await env.BACKUP_BUCKET.delete(r2Key).catch(() => {});
      if (edgeCache) await edgeCache.delete(l1Req).catch(() => {});
      return { pruned: true, remainingCount: 0 };
    }
    const payload: PriceCacheShardPayload = {
      updatedAt: new Date(nowMs).toISOString(),
      items: fresh,
    };
    const serialized = JSON.stringify(payload);
    await env.BACKUP_BUCKET.put(r2Key, serialized, {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { updatedAt: payload.updatedAt },
    });
    if (edgeCache) {
      await edgeCache
        .put(
          l1Req,
          new Response(serialized, {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': `public, max-age=${L1_PRICE_SHARD_TTL_SECONDS}`,
            },
          }),
        )
        .catch(() => {});
    }
    return { pruned: true, remainingCount };
  } catch {
    await env.BACKUP_BUCKET.delete(r2Key).catch(() => {});
    return { pruned: true, remainingCount: 0 };
  }
}

export async function clearAllEbayPriceShards(
  env: MarketPricingEnv,
): Promise<void> {
  const edgeCache = getEdgeCacheSync();
  for (let start = 0; start < PRICE_CACHE_SHARD_COUNT; start += 4) {
    const indices = Array.from(
      { length: Math.min(4, PRICE_CACHE_SHARD_COUNT - start) },
      (_, offset) => start + offset,
    );
    await Promise.all(
      indices.map(async (idx) => {
        if (env.BACKUP_BUCKET) {
          await env.BACKUP_BUCKET.delete(getPriceShardR2Key(idx)).catch(
            () => {},
          );
        }
        if (edgeCache) {
          await edgeCache.delete(getPriceShardL1Request(idx)).catch(() => {});
        }
      }),
    );
  }
}

export async function loadAllPriceQueryOverrides(
  env: MarketPricingEnv,
): Promise<Record<string, string>> {
  try {
    const { results } = await env.DB.prepare(
      'SELECT item_type, item_id, custom_query FROM price_query_overrides',
    ).all<{
      item_type: 'game' | 'toy';
      item_id: string;
      custom_query: string;
    }>();
    const map: Record<string, string> = {};
    for (const row of results || []) {
      if (row.item_id && row.custom_query) {
        map[getMarketPriceKey(row.item_type, row.item_id)] = row.custom_query;
      }
    }
    return map;
  } catch {
    // Graceful fallback when price_query_overrides has not yet been migrated
    return {};
  }
}

export async function loadPriceQueryOverridesForItems(
  env: MarketPricingEnv,
  descriptors: PricingItemDescriptor[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (descriptors.length === 0) return out;

  const gameIds = Array.from(
    new Set(
      descriptors.filter((d) => d.itemType === 'game').map((d) => d.itemId),
    ),
  );
  const toyIds = Array.from(
    new Set(
      descriptors.filter((d) => d.itemType === 'toy').map((d) => d.itemId),
    ),
  );

  try {
    if (gameIds.length > 0) {
      const ph = gameIds.map(() => '?').join(',');
      const { results } = await env.DB.prepare(
        `SELECT item_id, custom_query FROM price_query_overrides WHERE item_type = 'game' AND item_id IN (${ph})`,
      )
        .bind(...gameIds)
        .all<{ item_id: string; custom_query: string }>();
      for (const row of results || []) {
        out.set(getMarketPriceKey('game', row.item_id), row.custom_query);
      }
    }
    if (toyIds.length > 0) {
      const ph = toyIds.map(() => '?').join(',');
      const { results } = await env.DB.prepare(
        `SELECT item_id, custom_query FROM price_query_overrides WHERE item_type = 'toy' AND item_id IN (${ph})`,
      )
        .bind(...toyIds)
        .all<{ item_id: string; custom_query: string }>();
      for (const row of results || []) {
        out.set(getMarketPriceKey('toy', row.item_id), row.custom_query);
      }
    }
  } catch {
    // Graceful fallback when price_query_overrides table is unmigrated
  }

  return out;
}

export async function savePriceQueryOverride(
  env: MarketPricingEnv,
  itemType: 'game' | 'toy',
  rawItemId: string,
  customQuery: string | null,
): Promise<{ itemId: string; customQuery: string | null }> {
  let canonicalId = rawItemId.trim();
  if (itemType === 'game') {
    const resolved = await env.DB.prepare(RESOLVE_CANONICAL_GAME_ID_QUERY)
      .bind(...getResolveCanonicalGameIdParams(canonicalId))
      .first<{ game_id?: string; legacy_id?: string | null }>();
    const preferredId = resolved?.legacy_id || resolved?.game_id;
    if (preferredId) {
      canonicalId = preferredId;
    }
  }

  const trimmed = (customQuery || '').trim();
  if (!trimmed) {
    await env.DB.prepare(
      'DELETE FROM price_query_overrides WHERE item_type = ? AND item_id = ?',
    )
      .bind(itemType, canonicalId)
      .run();
    return { itemId: canonicalId, customQuery: null };
  }

  await env.DB.prepare(
    `INSERT INTO price_query_overrides (item_type, item_id, custom_query, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(item_type, item_id) DO UPDATE SET
       custom_query = excluded.custom_query,
       updated_at = datetime('now')
     WHERE price_query_overrides.custom_query IS NOT excluded.custom_query`,
  )
    .bind(itemType, canonicalId, trimmed)
    .run();

  return { itemId: canonicalId, customQuery: trimmed };
}

export async function resolvePricingItemDescriptors(
  env: MarketPricingEnv,
  items: Array<{ itemType: 'game' | 'toy'; itemId: string }>,
): Promise<{
  descriptors: Map<string, PricingItemDescriptor>;
  aliasToCanonicalKey: Map<string, string>;
}> {
  const descriptors = new Map<string, PricingItemDescriptor>();
  const aliasToCanonicalKey = new Map<string, string>();

  const rawGameIds = Array.from(
    new Set(
      items
        .filter((i) => i.itemType === 'game' && i.itemId.trim())
        .map((i) => i.itemId.trim()),
    ),
  );
  const rawToyIds = Array.from(
    new Set(
      items
        .filter((i) => i.itemType === 'toy' && i.itemId.trim())
        .map((i) => i.itemId.trim()),
    ),
  );

  if (rawGameIds.length > 0) {
    const ph = rawGameIds.map(() => '?').join(',');
    // Resolve both games.id and game_releases.id directly via indexed lookups
    const [directRes, relRes] = await Promise.all([
      env.DB.prepare(
        `SELECT g.id, g.title, g.platform_id, g.region, g.barcode, COALESCE(pp.display_name, p.display_name, p.name) AS platform_name
         FROM games g
         LEFT JOIN platforms p ON g.platform_id = p.id
         LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
         WHERE g.id IN (${ph})`,
      )
        .bind(...rawGameIds)
        .all<{
          id: string;
          title: string;
          platform_id: number | null;
          region: string | null;
          barcode: string | null;
          platform_name: string | null;
        }>(),
      env.DB.prepare(
        `SELECT r.id AS release_id, g.id, g.title, g.platform_id, COALESCE(r.region, g.region) AS region, COALESCE(r.barcode, g.barcode) AS barcode, COALESCE(pp.display_name, p.display_name, p.name) AS platform_name
         FROM game_releases r
         JOIN games g ON g.stable_id = r.game_id
         LEFT JOIN platforms p ON g.platform_id = p.id
         LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
         WHERE r.id IN (${ph})`,
      )
        .bind(...rawGameIds)
        .all<{
          release_id: string;
          id: string;
          title: string;
          platform_id: number | null;
          region: string | null;
          barcode: string | null;
          platform_name: string | null;
        }>(),
    ]);

    for (const row of directRes.results || []) {
      const key = getMarketPriceKey('game', row.id);
      aliasToCanonicalKey.set(key, key);
      descriptors.set(key, {
        itemType: 'game',
        itemId: row.id,
        title: row.title,
        platformId: row.platform_id,
        platformName: row.platform_name,
        region: row.region,
        barcode: row.barcode,
      });
    }

    for (const row of relRes.results || []) {
      const canonicalKey = getMarketPriceKey('game', row.id);
      const releaseKey = getMarketPriceKey('game', row.release_id);
      aliasToCanonicalKey.set(releaseKey, canonicalKey);
      aliasToCanonicalKey.set(canonicalKey, canonicalKey);
      if (!descriptors.has(canonicalKey)) {
        descriptors.set(canonicalKey, {
          itemType: 'game',
          itemId: row.id,
          title: row.title,
          platformId: row.platform_id,
          platformName: row.platform_name,
          region: row.region,
          barcode: row.barcode,
        });
      }
    }
  }

  if (rawToyIds.length > 0) {
    const ph = rawToyIds.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT f.id, f.name, f.line, f.type, f.region, COALESCE(CASE WHEN f.line = 'Skylanders' THEN NULL ELSE f.series END, fs.name) AS series_name
       FROM toys f
       LEFT JOIN toy_series fs ON f.series_id = fs.id
       WHERE f.id IN (${ph})`,
    )
      .bind(...rawToyIds)
      .all<{
        id: string;
        name: string;
        line: string | null;
        type: string | null;
        region: string | null;
        series_name: string | null;
      }>();

    for (const row of results || []) {
      const key = getMarketPriceKey('toy', row.id);
      aliasToCanonicalKey.set(key, key);
      descriptors.set(key, {
        itemType: 'toy',
        itemId: row.id,
        title: row.name,
        region: row.region,
        toyLine: row.line,
        toyType: row.type,
        toySeries: row.series_name,
      });
    }
  }

  return { descriptors, aliasToCanonicalKey };
}

async function fetchLiveValuationForDescriptor(
  env: MarketPricingEnv,
  descriptor: PricingItemDescriptor,
  customQuery: string | null,
  allowGtinFallback: boolean,
  resultLimit: number,
  nowMs: number,
): Promise<EphemeralMarketPrice> {
  const plan = buildEbaySearchPlan(descriptor, customQuery);
  let summaries = await searchEbayListings(env, {
    ...plan.primaryQuery,
    limit: resultLimit,
  });

  let valuation = computeMarketValuation(summaries, descriptor, {
    skipTitleMatch: Boolean(customQuery?.trim()),
  });

  const primaryTotal =
    valuation.loose_sample_size +
    valuation.cib_sample_size +
    valuation.new_sample_size;

  if (primaryTotal < 3 && plan.fallbackQuery && allowGtinFallback) {
    summaries = await searchEbayListings(env, {
      ...plan.fallbackQuery,
      limit: resultLimit,
    });
    valuation = computeMarketValuation(summaries, descriptor, {
      skipTitleMatch: Boolean(customQuery?.trim()),
    });
  }

  return buildEphemeralMarketPrice(
    descriptor,
    valuation,
    plan.displayQuery,
    nowMs,
  );
}

export async function fetchLiveBatchMarketPrices(
  env: MarketPricingEnv,
  requestedItems: Array<{ itemType: 'game' | 'toy'; itemId: string }>,
  options: {
    force?: boolean;
    nowMs?: number;
    singleItem?: boolean;
    waveStaggerMs?: number;
  } = {},
): Promise<BatchMarketPriceResult> {
  if (!isEbayConfigured(env)) {
    throw new EbayNotConfiguredError();
  }

  const nowMs = options.nowMs ?? Date.now();
  const sliced = requestedItems.slice(0, MAX_LIVE_BATCH_ITEMS);
  const { descriptors, aliasToCanonicalKey } =
    await resolvePricingItemDescriptors(env, sliced);

  const uniqueDescriptors = Array.from(descriptors.values());
  const overridesMap = await loadPriceQueryOverridesForItems(
    env,
    uniqueDescriptors,
  );

  // Read each touched R2 shard once (bypassing short L1 to avoid cross-device lag)
  const touchedShards = new Set<number>();
  for (const desc of uniqueDescriptors) {
    touchedShards.add(getPriceShardIndex(desc.itemType, desc.itemId));
  }
  const shardContents = new Map<number, Record<string, EphemeralMarketPrice>>();
  await Promise.all(
    Array.from(touchedShards).map(async (shardIdx) => {
      shardContents.set(
        shardIdx,
        await readPriceShard(env, shardIdx, { bypassL1: true, nowMs }),
      );
    }),
  );

  const prices: Record<string, EphemeralMarketPrice> = {};
  const errors: Record<string, string> = {};
  const misses: PricingItemDescriptor[] = [];
  let cacheHits = 0;

  for (const req of sliced) {
    const reqKey = getMarketPriceKey(req.itemType, req.itemId.trim());
    const canonicalKey = aliasToCanonicalKey.get(reqKey);
    if (!canonicalKey) {
      errors[reqKey] = 'Item not found in catalog.';
      continue;
    }
    const desc = descriptors.get(canonicalKey)!;
    const shardIdx = getPriceShardIndex(desc.itemType, desc.itemId);
    const cached = shardContents.get(shardIdx)?.[canonicalKey];
    if (!options.force && cached && isMarketPriceFresh(cached, nowMs)) {
      if (!prices[canonicalKey]) {
        prices[canonicalKey] = cached;
        cacheHits++;
      }
      continue;
    }
    if (
      !misses.some(
        (m) => getMarketPriceKey(m.itemType, m.itemId) === canonicalKey,
      )
    ) {
      misses.push(desc);
    }
  }

  let fetchedCount = 0;
  let rateLimited = false;
  let retryableError = false;
  let retryAfterSec: number | undefined;
  const updatesByShard = new Map<
    number,
    Record<string, EphemeralMarketPrice>
  >();

  const resultLimit = options.singleItem ? 50 : BATCH_EBAY_RESULT_LIMIT;
  const waveStaggerMs = options.waveStaggerMs ?? WAVE_STAGGER_MS;
  const allowGtinFallback = Boolean(options.singleItem) || misses.length <= 2;

  // Process misses in 2-way staggered waves to stay safely under eBay QPS & Cloudflare CPU limits
  for (let i = 0; i < misses.length; i += EBAY_FETCH_CONCURRENCY) {
    if (i > 0 && waveStaggerMs > 0) {
      await new Promise((r) => setTimeout(r, waveStaggerMs));
    }
    const chunk = misses.slice(i, i + EBAY_FETCH_CONCURRENCY);
    const chunkResults = await Promise.allSettled(
      chunk.map((desc) => {
        const key = getMarketPriceKey(desc.itemType, desc.itemId);
        const customQuery = overridesMap.get(key) ?? null;
        return fetchLiveValuationForDescriptor(
          env,
          desc,
          customQuery,
          allowGtinFallback,
          resultLimit,
          nowMs,
        );
      }),
    );

    for (let j = 0; j < chunk.length; j++) {
      const desc = chunk[j];
      const key = getMarketPriceKey(desc.itemType, desc.itemId);
      const outcome = chunkResults[j];
      if (outcome.status === 'fulfilled') {
        const resultPrice = outcome.value;
        prices[key] = resultPrice;
        fetchedCount++;
        const shardIdx = getPriceShardIndex(desc.itemType, desc.itemId);
        const shardUpdates = updatesByShard.get(shardIdx) || {};
        shardUpdates[key] = resultPrice;
        updatesByShard.set(shardIdx, shardUpdates);
      } else {
        const reason = outcome.reason;
        if (reason instanceof EbayRateLimitError) {
          rateLimited = true;
          retryableError = true;
          retryAfterSec = reason.retryAfterSec;
          errors[key] = reason.message;
        } else if (reason instanceof EbayNotConfiguredError) {
          throw reason;
        } else if (
          reason instanceof EbayApiError &&
          (reason.status >= 500 || reason.status === 408)
        ) {
          retryableError = true;
          errors[key] = reason.message;
        } else if (
          reason instanceof Error &&
          /timeout|abort|network|fetch/i.test(reason.message)
        ) {
          retryableError = true;
          errors[key] = reason.message;
        } else {
          errors[key] =
            reason instanceof Error ? reason.message : String(reason);
        }
      }
    }

    if (rateLimited) {
      break;
    }
  }

  if (updatesByShard.size > 0) {
    await Promise.all(
      Array.from(updatesByShard.entries()).map(([shardIdx, shardUpdates]) =>
        writePriceShard(
          env,
          shardIdx,
          shardUpdates,
          nowMs,
          shardContents.get(shardIdx),
        ),
      ),
    );
  }

  return {
    prices,
    cacheHits,
    fetchedCount,
    errors,
    rateLimited,
    retryableError,
    retryAfterSec,
  };
}

export async function fetchLiveItemMarketPrice(
  env: MarketPricingEnv,
  itemType: 'game' | 'toy',
  itemId: string,
  options: { force?: boolean; nowMs?: number } = {},
): Promise<{
  price: EphemeralMarketPrice | null;
  canonicalKey: string;
  cacheHit: boolean;
  error?: string;
}> {
  const result = await fetchLiveBatchMarketPrices(env, [{ itemType, itemId }], {
    ...options,
    singleItem: true,
  });
  const firstKey = Object.keys(result.prices)[0];
  if (firstKey) {
    return {
      price: result.prices[firstKey],
      canonicalKey: firstKey,
      cacheHit: result.cacheHits > 0,
    };
  }
  const errKey = Object.keys(result.errors)[0];
  return {
    price: null,
    canonicalKey: getMarketPriceKey(itemType, itemId),
    cacheHit: false,
    error: errKey ? result.errors[errKey] : 'Unable to fetch eBay pricing.',
  };
}

export async function getMarketPricingDiagnostics(
  env: MarketPricingEnv,
  nowMs: number = Date.now(),
): Promise<{
  configured: boolean;
  ebayRateLimit: EbayRateLimitSnapshot | null;
  cachedCount: number;
  shardCount: number;
  ttlHours: number;
}> {
  const configured = isEbayConfigured(env);
  const [cached, ebayRateLimit] = await Promise.all([
    readAllCachedMarketPrices(env, { bypassL1: true, nowMs }),
    configured ? fetchEbayBrowseRateLimits(env) : Promise.resolve(null),
  ]);
  return {
    configured,
    ebayRateLimit,
    cachedCount: Object.keys(cached).length,
    shardCount: PRICE_CACHE_SHARD_COUNT,
    ttlHours: 6,
  };
}
