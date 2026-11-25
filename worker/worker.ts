/**
 * PRODUCTION CLOUDFLARE WORKER
 *
 * This worker acts as the edge API, static asset server, and automated backup engine
 * for the Collection Tracker.
 *
 * ARCHITECTURAL DESIGN:
 * 1. **Centralized Query Sharing**: Imports SQL constants and PLATFORM_MAP from `../shared/queries`
 *    to ensure query consistency between environments.
 * 2. **Workers Assets Integration**: Seamlessly serves the Angular SPA via `env.ASSETS` fallback.
 * 3. **Role-Based Edge Authentication**: Gates mutation endpoints (`/api/collection/toggle`,
 *    `/api/collection/sort`, `/api/admin/catalog-seed`) behind OIDC 1.0 /
 *    OAuth 2.1 + PKCE (`S256`) session validation while public browsing is uninhibited.
 * 4. **Automated R2 Snapshots**: Implements a `scheduled` cron handler that automatically dumps
 *    all D1 tables into structured, timestamped JSON backups in Cloudflare R2 indefinitely.
 * 5. **Autonomous Catalog Ingestion**: Connects directly to IGDB via Twitch OAuth secrets,
 *    AmiiboAPI, boutique stores, and retail feeds on scheduled crons.
 */

import {
  PLATFORMS_LIST_QUERY,
  getRomGroupingKey,
  PLATFORM_MAP,
  buildTargetedCompanionByCrcBatchQuery,
  buildTargetedCompanionByGameIdQuery,
  buildTargetedCompanionByTitleQuery,
  getRelatedGameIdsForCompanion,
  getRelatedGameTitlesForCompanion,
  CompanionDiscCandidateRow,
  SharedMediaReleaseLink,
  enrichGameDetailWithCompanionsAndVouchers,
  isOfficialIGDBGame,
  JournalEntryRow,
  RESOLVE_CANONICAL_GAME_ID_QUERY,
  getResolveCanonicalGameIdParams,
  JOURNAL_ENTRY_BY_ITEM_QUERY,
  JOURNAL_ENTRIES_ALL_QUERY,
  UPSERT_JOURNAL_ENTRY_QUERY,
  DELETE_JOURNAL_ENTRY_QUERY,
  normalizeJournalDatePayload,
  normalizeMerchantName,
  normalizeReceiptUrl,
  parseGameMetadataOnce,
  resolveLocalizedReleaseTitle,
  postProcessGameListRows,
  postProcessToyListRows,
  buildGamesListQuery,
  buildCatalogGamesChunkQuery,
  buildCatalogDeltaGamesQuery,
  CATALOG_GAMES_CHUNK_SIZE,
  CATALOG_GAMES_PER_CHUNK,
  CATALOG_GAMES_CHUNK_BOUND_QUERY,
  CATALOG_CHUNK_SCHEMA_VERSION,
  CATALOG_MAX_GAME_STABLE_ID_QUERY,
  CATALOG_MAX_TOY_STABLE_ID_QUERY,
  GAMES_HAS_MANY_ROWS_QUERY,
  USER_GAME_RELEASES_OVERLAY_QUERY,
  USER_GAMES_OVERLAY_QUERY,
  USER_TOYS_OVERLAY_QUERY,
  TOYS_DELTA_LIST_QUERY,
  ACTIVE_GAMES_LIST_WHERE_CLAUSE,
  ACTIVE_GAMES_PUBLIC_WHERE_CLAUSE,
  buildGameDetailQuery,
  getGameDetailQueryParams,
  buildGameReleasesByGameIdQuery,
  buildBundledGamesByParentQuery,
  buildToysListQuery,
  buildToyDetailQuery,
  DEFAULT_USER_HOME_REGION,
} from '../shared/queries';
import {
  getIgdbCompanionPlatformIds,
  getIgdbQueryPlatformIds,
  normalizeLegacyPlatformId,
  registerIgdbAliasPlatforms,
} from '../shared/igdb_platforms';
import {
  isIgnoredFormatRelease,
  isPackInCompanionDemoRom,
  isRegionMatchingHome,
} from '../shared/source_format';
import {
  CANONICAL_BUNDLES,
  deduplicateDatReleases,
  detectPhysicalReleaseStatus,
  findCanonicalBundle,
  getCanonicalSourcePriority,
  regionsOverlap,
  CanonicalRelease,
} from '../shared/canonical_releases';
import {
  REDUMP_TARGETS,
  REDUMP_WIP_TARGETS,
  getRedumpInfoDatUrl,
} from '../shared/dat_targets';
import { parseDatContent } from '../shared/dat_parser';
import { extractFirstMatchingZipEntry, isZipBuffer } from '../shared/zip';
import {
  fetchSwitchSpreadsheetTabs,
  parseSwitchRevisionsCsv,
  PAST_REVISION_TITLE_ALIASES,
} from '../shared/switch_revisions';
import {
  areCanonicalTitlesSequelCompatible,
  buildCanonicalLinkerMatchKeys,
  buildDetailedIgdbMatchVariants,
  cleanTitleForIgdbLookup,
  extractTitleSequelSignature,
  isCompilationOrBundleTitle,
  normalizeForIgdbMatch,
  normalizeSafeSequelNumerals,
  normalizeTitleForMatching,
  resolveCanonicalDisplayTitle,
  stripEditionSuffix,
  stripIgdbEditionWrapper,
} from '../shared/title_matching';
import { PS5DB_CSV_URL, parsePs5DbCsv } from '../shared/ps5db';
import {
  DEFAULT_SERIALSTATION_PLATFORM_IDS,
  SERIALSTATION_PAGE_LIMIT,
  SERIALSTATION_RELEASES_URL,
  SerialStationReleaseItem,
  parseSerialStationRecords,
} from '../shared/serialstation';
import { MULTI_POSE_AMIIBO_EXPANSIONS } from '../shared/amiibo_poses';
import {
  computeGameCanonicalSeries,
  computeGameCanonicalSeriesWithSource,
} from '../shared/canonical_series';
import {
  fetchAllRetailDeals,
  fetchAllRetailPreOrders,
  matchRetailGameProduct,
  matchRetailToyProduct,
  resolveRetailPlatformId,
  cleanRetailTitle,
  CandidateGame,
  CandidateToy,
  RetailDealItem,
} from '../shared/retail';
import {
  NSCOLLECTORS_TABS,
  getNsCollectorsCsvUrl,
  parseNsCollectorsCsv,
} from '../shared/nscollectors';
import {
  sendWebPushNotification,
  resolveVapidSubject,
  isAllowedPushEndpoint,
  WebPushNotificationPayload,
} from './web_push';
import {
  OIDC_STATE_TTL_SECONDS,
  DEFAULT_SESSION_DAYS,
  SessionUser,
  OidcIdTokenClaims,
  signSession,
  verifySession,
  generateRandomBase64Url,
  computePkceCodeChallenge,
  signOidcStateCookie,
  verifyOidcStateCookie,
  verifyOidcIdToken,
  parseCookies,
  isLoopbackRequest,
  isSecureOrigin,
  readSessionCookie,
  readOidcStateCookie,
  serializeSessionCookie,
  serializeClearSessionCookies,
  serializeOidcStateCookie,
  serializeClearOidcStateCookies,
  sanitizeReturnToPath,
  resolveStrongSecret,
  isCrossOriginMutatingRequest,
  buildCspHeader,
  kitWithSecurityHeaders,
  timingSafeEqualStrings,
  ALLOWED_HOME_REGIONS,
  normalizeHomeRegion,
} from './auth';
import {
  performScheduledBackup as kitPerformScheduledBackup,
  KIT_DEGRADED_HEADER,
  KIT_SNAPSHOT_TIMESTAMP_HEADER,
  loadR2LatestSnapshot,
  resetR2SnapshotCache,
  isD1QuotaOrReadError,
  R2BackupSnapshot,
} from '@wesdizzle/app-kit/worker';
import {
  fetchBoutiquePreOrders,
  fetchLimitedGameNewsReleases,
  BoutiquePreOrder,
} from '../shared/physical_feeds';
import { DealNotificationPreferences } from '../src/app/core/models/collection.models';
import {
  EbayNotConfiguredError,
  EbayRateLimitError,
  isEbayConfigured,
  resetEbayTokenCache,
} from './ebay_client';
import {
  clearAllEbayPriceShards,
  fetchLiveBatchMarketPrices,
  fetchLiveItemMarketPrice,
  getMarketPricingDiagnostics,
  loadAllPriceQueryOverrides,
  MAX_LIVE_BATCH_ITEMS,
  purgeSingleExpiredPriceShard,
  readAllCachedMarketPrices,
  savePriceQueryOverride,
} from './market_pricing';
import { PRICE_CACHE_SHARD_COUNT } from '../shared/market_pricing';

export interface Env {
  DB: D1Database;
  ASSETS: { fetch: typeof fetch };
  BACKUP_BUCKET?: R2Bucket;
  ADMIN_EMAIL?: string;
  ADMIN_KEY?: string;
  SESSION_SECRET?: string;
  DEV_AUTH_EMAIL?: string;
  OIDC_ISSUER?: string;
  OIDC_ISSUER_URL?: string;
  OIDC_CLIENT_ID?: string;
  APP_REPO_URL?: string;
  TWITCH_CLIENT_ID?: string;
  TWITCH_CLIENT_SECRET?: string;
  EBAY_CLIENT_ID?: string;
  EBAY_CLIENT_SECRET?: string;
  MARKET_PRICING_ACCESS?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  APP_NAME?: string;
  APP_SHORT_NAME?: string;
  APP_TAGLINE?: string;
  APP_AUTHOR?: string;
  CUSTOM_FAVICON_SVG?: string;
  ADMIN_SESSION_DAYS?: string;
}

export const DEFAULT_ADMIN_SESSION_DAYS = 30; // 30 days

interface DbGame {
  stable_id: number;
  id: string;
  title?: string;
  base_title?: string;
  raw_title?: string | null;
  platform_id?: number;
  region?: string | null;
  variants?: string | null;
  rom_name?: string | null;
  rom_crc?: string | null;
  has_media?: number;
  ownership_status?: number;
  release_date?: string | null;
  metadata_json?: string | null;
  releases?: Array<Record<string, unknown>>;
  other_releases?: Array<Record<string, unknown>>;
  bundled_games?: unknown[];
  shared_media_releases?: SharedMediaReleaseLink[];
}

let cachedTwitchToken: { token: string; expiresAt: number } | null = null;

/**
 * Safely accesses the Cloudflare Workers Edge Cache API (caches.default).
 * Returns null if not running in an environment with the Cache API.
 */
export async function getEdgeCache(): Promise<Cache | null> {
  if (typeof caches !== 'undefined') {
    const cfCaches = caches as unknown as { default?: Cache };
    if (cfCaches.default) {
      return cfCaches.default;
    }
  }
  return null;
}

let lastKnownOrigin: string | null = null;
const trackedEdgeCacheUrls = new Set<string>();

async function putEdgeCacheEntry(
  edgeCache: Cache,
  cacheKey: Request,
  response: Response,
  isNoCache: boolean,
  skipTracking = false,
): Promise<void> {
  if (isNoCache) {
    await edgeCache.delete(cacheKey).catch(() => {});
  }
  if (!skipTracking && trackedEdgeCacheUrls.size < 250) {
    trackedEdgeCacheUrls.add(cacheKey.url);
  }
  await edgeCache.put(cacheKey, response.clone()).catch(() => {});
}

export interface EdgeCacheInvalidationOptions {
  userId?: number;
  username?: string;
  previousUsername?: string;
  invalidateCatalog?: boolean;
}

/**
 * Invalidates Cloudflare Edge Cache entries for public collection endpoints,
 * public user profiles (`/api/u/<username>*`), and authenticated user-scoped
 * `?__uid=` cache keys across isolates whenever a mutation occurs.
 */
export async function invalidateEdgeApiCache(
  originUrl?: string,
  options?: EdgeCacheInvalidationOptions,
): Promise<void> {
  const edgeCache = await getEdgeCache();
  if (!edgeCache) return;
  try {
    const rawOrigin = originUrl || lastKnownOrigin;
    if (!rawOrigin) return;
    const origin = new URL(rawOrigin).origin;
    const paths = ['/api/games', '/api/toys', '/api/platforms'];
    for (const p of paths) {
      await edgeCache.delete(new Request(`${origin}${p}`));
      try {
        await edgeCache.delete(new Request(`${origin}${p}`), {
          ignoreSearch: true,
        });
      } catch {
        // ignoreSearch may not be supported in all environments
      }
    }

    // Deterministically purge user-scoped edge cache keys across isolates
    const userIds = Array.from(
      new Set([1, ...(options?.userId ? [options.userId] : [])]),
    );
    for (const uid of userIds) {
      await edgeCache
        .delete(new Request(`https://edge-cache.internal/auth-me/user:${uid}`))
        .catch(() => {});
      await edgeCache
        .delete(new Request(`https://edge-cache.internal/journal/user:${uid}`))
        .catch(() => {});
      await edgeCache
        .delete(new Request(`${origin}/api/toys?__uid=${uid}`))
        .catch(() => {});
      await edgeCache
        .delete(new Request(`${origin}/api/games?__uid=${uid}`))
        .catch(() => {});
      for (const reg of ALLOWED_HOME_REGIONS) {
        await edgeCache
          .delete(new Request(`${origin}/api/games?__uid=${uid}&__reg=${reg}`))
          .catch(() => {});
        await edgeCache
          .delete(
            new Request(
              `${origin}/api/games?__uid=${uid}&__reg=${reg}&include_unowned=1`,
            ),
          )
          .catch(() => {});
      }
    }

    // Deterministically purge public profile `/api/u/<username>*` keys across isolates
    const usernames = Array.from(
      new Set(
        [
          options?.username,
          options?.username?.toLowerCase(),
          options?.previousUsername,
          options?.previousUsername?.toLowerCase(),
        ].filter((u): u is string => Boolean(u && u.trim().length > 0)),
      ),
    );
    for (const u of usernames) {
      const encoded = encodeURIComponent(u.trim());
      const profilePaths = [
        `/api/u/${encoded}`,
        `/api/u/${encoded}/games`,
        `/api/u/${encoded}/toys`,
      ];
      for (const up of profilePaths) {
        await edgeCache.delete(new Request(`${origin}${up}`)).catch(() => {});
        try {
          await edgeCache.delete(new Request(`${origin}${up}`), {
            ignoreSearch: true,
          });
        } catch {
          // ignoreSearch may not be supported in all environments
        }
      }
    }

    for (const urlStr of trackedEdgeCacheUrls) {
      await edgeCache.delete(new Request(urlStr)).catch(() => {});
    }
    trackedEdgeCacheUrls.clear();

    if (options?.invalidateCatalog) {
      cachedCatalogDeltaGames = null;
      for (const catalogPath of ['/api/catalog/games', '/api/catalog/toys']) {
        await edgeCache
          .delete(new Request(`${origin}${catalogPath}`))
          .catch(() => {});
        await edgeCache
          .delete(new Request(`${origin}${catalogPath}?manifest=1`))
          .catch(() => {});
        try {
          await edgeCache.delete(new Request(`${origin}${catalogPath}`), {
            ignoreSearch: true,
          });
        } catch {
          // ignoreSearch may not be supported in all environments
        }
      }
    }
  } catch (err) {
    console.warn('[invalidateEdgeApiCache] Failed to purge edge cache:', err);
  }
}

const workerRateLimitBuckets = new Map<string, number[]>();

export function resetWorkerRateLimits(): void {
  workerRateLimitBuckets.clear();
  cachedCatalogManifest = null;
  cachedCatalogToys = null;
  cachedCatalogDeltaGames = null;
  resetEbayTokenCache();
  resetR2SnapshotCache();
}

function getRateLimitClientKey(
  request: Request,
  sessionUser?: SessionUser | null,
): string {
  const cfIp = request.headers.get('CF-Connecting-IP')?.trim();
  if (cfIp) return `ip:${cfIp}`;
  const xff = request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim();
  if (xff) return `ip:${xff}`;
  if (sessionUser) return `user:${sessionUser.id}`;
  return 'anon';
}

function checkWorkerRateLimit(
  bucket: string,
  clientKey: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const compositeKey = `${bucket}:${clientKey}`;
  const existing = workerRateLimitBuckets.get(compositeKey) || [];
  const active = existing.filter((ts) => now - ts < windowMs);
  if (active.length >= maxRequests) {
    workerRateLimitBuckets.set(compositeKey, active);
    const oldest = active[0] ?? now;
    const retryAfterSec = Math.max(
      1,
      Math.ceil((windowMs - (now - oldest)) / 1000),
    );
    return { allowed: false, retryAfterSec };
  }
  active.push(now);
  if (workerRateLimitBuckets.size > 2000) {
    for (const [k, timestamps] of workerRateLimitBuckets) {
      if (timestamps.every((ts) => now - ts >= windowMs)) {
        workerRateLimitBuckets.delete(k);
      }
    }
  }
  workerRateLimitBuckets.set(compositeKey, active);
  return { allowed: true, retryAfterSec: 0 };
}

let cachedPlatformMetadata: {
  parentMap: Map<number, number>;
  igdbToPlatformId: Map<
    number,
    { id: number; displayName: string; launchDate: string | null }
  >;
  expiresAt: number;
} | null = null;

export function invalidateSeriesScanCache() {
  cachedPlatformMetadata = null;
  cachedCatalogManifest = null;
  cachedCatalogToys = null;
  resetR2SnapshotCache();
}

export async function getCachedPlatformMetadata(env: Env): Promise<{
  parentMap: Map<number, number>;
  igdbToPlatformId: Map<
    number,
    { id: number; displayName: string; launchDate: string | null }
  >;
}> {
  if (cachedPlatformMetadata && cachedPlatformMetadata.expiresAt > Date.now()) {
    return cachedPlatformMetadata;
  }

  const { results: allPlatformRows } = await env.DB.prepare(
    `SELECT id, display_name, name, launch_date, parent_platform_id FROM platforms`,
  ).all();

  const parentMap = new Map<number, number>();
  const igdbToPlatformId = new Map<
    number,
    { id: number; displayName: string; launchDate: string | null }
  >();

  (allPlatformRows || []).forEach((p) => {
    const row = p as {
      id: number;
      display_name: string;
      name: string;
      launch_date: string | null;
      parent_platform_id?: number | null;
    };
    if (row.parent_platform_id) {
      parentMap.set(row.id, row.parent_platform_id);
      return;
    }
    const igdbId = PLATFORM_MAP[row.display_name] || PLATFORM_MAP[row.name];
    if (igdbId) {
      igdbToPlatformId.set(igdbId, {
        id: row.id,
        displayName: row.display_name || row.name,
        launchDate: row.launch_date,
      });
    }
  });

  // Map regional/VR IGDB platform IDs to unified parent local platforms
  registerIgdbAliasPlatforms(igdbToPlatformId);

  cachedPlatformMetadata = {
    parentMap,
    igdbToPlatformId,
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
  return cachedPlatformMetadata;
}

export interface IgdbReleaseDateEntry {
  platform?: number | { id: number };
  region?: number;
  release_region?: number;
  date?: number;
}

export interface IgdbRelatedEditionRef {
  id: number;
  name?: string;
  platforms?: Array<number | { id: number }>;
}

const IGDB_RELEASE_REGION_PREFERENCES: Record<
  string,
  { primary: number[]; secondary: number[] }
> = {
  NA: { primary: [2], secondary: [8] },
  USA: { primary: [2], secondary: [8] },
  US: { primary: [2], secondary: [8] },
  'NORTH AMERICA': { primary: [2], secondary: [8] },
  CANADA: { primary: [2], secondary: [8] },
  EU: { primary: [1], secondary: [8] },
  EUROPE: { primary: [1], secondary: [8] },
  UK: { primary: [1], secondary: [8] },
  GERMANY: { primary: [1], secondary: [8] },
  FRANCE: { primary: [1], secondary: [8] },
  SPAIN: { primary: [1], secondary: [8] },
  ITALY: { primary: [1], secondary: [8] },
  AU: { primary: [3], secondary: [1, 8] },
  AUSTRALIA: { primary: [3], secondary: [1, 8] },
  NZ: { primary: [4, 3], secondary: [1, 8] },
  'NEW ZEALAND': { primary: [4, 3], secondary: [1, 8] },
  JP: { primary: [5], secondary: [7, 8] },
  JAPAN: { primary: [5], secondary: [7, 8] },
  AS: { primary: [7, 5], secondary: [8] },
  ASIA: { primary: [7, 5], secondary: [8] },
  KR: { primary: [9], secondary: [7, 8] },
  KOREA: { primary: [9], secondary: [7, 8] },
  CH: { primary: [6], secondary: [7, 8] },
  CHINA: { primary: [6], secondary: [7, 8] },
  BR: { primary: [10], secondary: [2, 8] },
  BRAZIL: { primary: [10], secondary: [2, 8] },
  WW: { primary: [8], secondary: [2, 1, 5] },
  WORLD: { primary: [8], secondary: [2, 1, 5] },
  WORLDWIDE: { primary: [8], secondary: [2, 1, 5] },
};

export function extractIgdbPlatformIds(
  platforms?: Array<number | { id: number }>,
): number[] {
  if (!Array.isArray(platforms)) return [];
  const out: number[] = [];
  for (const p of platforms) {
    const id = typeof p === 'number' ? p : p?.id;
    if (typeof id === 'number' && Number.isFinite(id)) {
      out.push(id);
    }
  }
  return out;
}

export { getIgdbCompanionPlatformIds };

function toIsoDateFromIgdbValue(
  val: number | string | null | undefined,
): string | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
  }
  if (typeof val === 'number' && Number.isFinite(val)) {
    const iso = new Date(val * 1000).toISOString().split('T')[0];
    return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
  }
  return null;
}

function subtractDaysFromIsoDate(isoDate: string, days: number): string {
  const ms = Date.parse(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(ms)) return isoDate;
  return new Date(ms - days * 86400 * 1000).toISOString().split('T')[0];
}

/**
 * Resolves the platform-specific (and region-preferred) ISO release date (`YYYY-MM-DD`)
 * from an IGDB `release_dates` array, enforcing hardware launch date floors and supporting
 * companion hardware IDs (Famicom `99` <-> NES `18`, Super Famicom `58` <-> SNES `19`,
 * PlayStation VR `165` <-> PS4 `48`, PlayStation VR2 `390` <-> PS5 `167`).
 * Only falls back to `fallbackFirstReleaseDate` when no platform-specific entry exists
 * and `fallbackFirstReleaseDate >= platformLaunchDate`.
 */
export function resolveIgdbPlatformReleaseDate(
  releaseDates: IgdbReleaseDateEntry[] | undefined | null,
  igdbPlatformId: number | null | undefined,
  platformLaunchDate: string | null | undefined,
  preferredRegion?: string | null,
  fallbackFirstReleaseDate?: number | string | null,
): string | null {
  const launchFloor = toIsoDateFromIgdbValue(platformLaunchDate);
  const fallbackIso = toIsoDateFromIgdbValue(fallbackFirstReleaseDate);

  if (
    !igdbPlatformId ||
    !Array.isArray(releaseDates) ||
    releaseDates.length === 0
  ) {
    if (fallbackIso && (!launchFloor || fallbackIso >= launchFloor)) {
      return fallbackIso;
    }
    return null;
  }

  const regionParts = (preferredRegion || 'USA')
    .split(',')
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean);
  const isJapanPreferred =
    regionParts.length > 0 &&
    (regionParts[0] === 'JAPAN' || regionParts[0] === 'JP');

  const primaryRegionIds = new Set<number>();
  const secondaryRegionIds = new Set<number>();
  for (const part of regionParts) {
    const pref = IGDB_RELEASE_REGION_PREFERENCES[part];
    if (pref) {
      for (const r of pref.primary) primaryRegionIds.add(r);
      for (const r of pref.secondary) secondaryRegionIds.add(r);
    }
  }
  if (primaryRegionIds.size === 0) {
    primaryRegionIds.add(2);
    secondaryRegionIds.add(8);
  }

  const platformCandidates: Array<{ platId: number; floor: string | null }> =
    [];
  if (igdbPlatformId === 18 || igdbPlatformId === 99) {
    if (isJapanPreferred || igdbPlatformId === 99) {
      platformCandidates.push(
        { platId: 99, floor: '1983-07-15' },
        { platId: 18, floor: '1983-07-15' },
      );
    } else {
      platformCandidates.push(
        { platId: 18, floor: launchFloor || '1985-10-18' },
        { platId: 99, floor: '1983-07-15' },
      );
    }
  } else if (igdbPlatformId === 19 || igdbPlatformId === 58) {
    if (isJapanPreferred || igdbPlatformId === 58) {
      platformCandidates.push(
        { platId: 58, floor: '1990-11-21' },
        { platId: 19, floor: '1990-11-21' },
      );
    } else {
      platformCandidates.push(
        { platId: 19, floor: launchFloor || '1991-08-23' },
        { platId: 58, floor: '1990-11-21' },
      );
    }
  } else if (igdbPlatformId === 48 || igdbPlatformId === 165) {
    const primary = igdbPlatformId;
    const secondary = igdbPlatformId === 48 ? 165 : 48;
    platformCandidates.push(
      { platId: primary, floor: launchFloor || '2013-11-15' },
      { platId: secondary, floor: '2013-11-15' },
    );
  } else if (igdbPlatformId === 167 || igdbPlatformId === 390) {
    const primary = igdbPlatformId;
    const secondary = igdbPlatformId === 167 ? 390 : 167;
    platformCandidates.push(
      { platId: primary, floor: launchFloor || '2020-11-12' },
      { platId: secondary, floor: '2020-11-12' },
    );
  } else {
    platformCandidates.push({ platId: igdbPlatformId, floor: launchFloor });
  }

  for (const { platId, floor } of platformCandidates) {
    const explicitPlatFloor = floor ? subtractDaysFromIsoDate(floor, 60) : null;
    const validForPlat: Array<{ isoDate: string; reg: number | undefined }> =
      [];
    for (const entry of releaseDates) {
      const entryPlat =
        typeof entry.platform === 'number'
          ? entry.platform
          : entry.platform?.id;
      if (entryPlat !== platId) continue;
      const isoDate = toIsoDateFromIgdbValue(entry.date);
      if (!isoDate) continue;
      if (explicitPlatFloor && isoDate < explicitPlatFloor) continue;
      const reg = entry.release_region ?? entry.region;
      validForPlat.push({ isoDate, reg });
    }

    if (validForPlat.length === 0) continue;

    validForPlat.sort((a, b) => a.isoDate.localeCompare(b.isoDate));

    const primaryMatch = validForPlat.find(
      (v) => v.reg !== undefined && primaryRegionIds.has(v.reg),
    );
    if (primaryMatch) return primaryMatch.isoDate;

    const secondaryMatch = validForPlat.find(
      (v) =>
        v.reg === undefined || v.reg === null || secondaryRegionIds.has(v.reg),
    );
    if (secondaryMatch) return secondaryMatch.isoDate;

    return validForPlat[0].isoDate;
  }

  if (fallbackIso && (!launchFloor || fallbackIso >= launchFloor)) {
    return fallbackIso;
  }
  return null;
}

/**
 * Determines whether a base game candidate on a target platform should be suppressed
 * because its global `first_release_date` predates `platformLaunchDate` and IGDB links
 * a dedicated Remaster, Expanded Game, or Port on that target platform (or because a
 * related edition on that platform is already owned in the user's collection).
 */
export function shouldSuppressCrossGenBasePlatform(options: {
  game: {
    id: number;
    name?: string | null;
    first_release_date?: number | string | null;
    remasters?: IgdbRelatedEditionRef[];
    expanded_games?: IgdbRelatedEditionRef[];
    ports?: IgdbRelatedEditionRef[];
  };
  igdbPlatformId: number;
  platformLaunchDate?: string | null;
  isBaseVerifiedPhysicalOnPlatform?: boolean;
  isRelatedIgdbIdOwnedOnPlatform?: (relatedIgdbId: number) => boolean;
}): boolean {
  const {
    game,
    igdbPlatformId,
    platformLaunchDate,
    isBaseVerifiedPhysicalOnPlatform = false,
    isRelatedIgdbIdOwnedOnPlatform,
  } = options;

  const related = [
    ...(game.remasters || []),
    ...(game.expanded_games || []),
    ...(game.ports || []),
  ];
  if (related.length === 0) return false;

  const targetPlatSet = new Set(getIgdbCompanionPlatformIds(igdbPlatformId));
  const launchFloor = toIsoDateFromIgdbValue(platformLaunchDate);
  const firstRelIso = toIsoDateFromIgdbValue(game.first_release_date);
  const predatesPlatformLaunch = Boolean(
    launchFloor && firstRelIso && firstRelIso < launchFloor,
  );
  const normBaseName = normalizeTitleForMatching(game.name || '');

  for (const rel of related) {
    if (!rel || typeof rel.id !== 'number' || rel.id === game.id) continue;
    const relPlats = extractIgdbPlatformIds(rel.platforms);
    const relOnPlatform =
      relPlats.length === 0 || relPlats.some((pid) => targetPlatSet.has(pid));
    if (!relOnPlatform) continue;

    const isOwned = Boolean(isRelatedIgdbIdOwnedOnPlatform?.(rel.id));
    const normRelName = normalizeTitleForMatching(rel.name || '');
    const isSameOrRemasterName =
      !normRelName ||
      normRelName === normBaseName ||
      normRelName === `${normBaseName}remastered` ||
      normRelName.startsWith(normBaseName);

    if (isOwned && (predatesPlatformLaunch || normRelName === normBaseName)) {
      return true;
    }

    if (
      predatesPlatformLaunch &&
      !isBaseVerifiedPhysicalOnPlatform &&
      isSameOrRemasterName &&
      relPlats.some((pid) => targetPlatSet.has(pid))
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Retrieves a valid Twitch Access Token for IGDB API queries.
 * Caches token in isolate memory to avoid redundant authentication requests.
 */
export async function getEdgeTwitchToken(env: Env): Promise<string | null> {
  if (cachedTwitchToken && cachedTwitchToken.expiresAt > Date.now()) {
    return cachedTwitchToken.token;
  }
  const clientId = env.TWITCH_CLIENT_ID;
  const clientSecret = env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return null;
  }
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
  });
  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?${params.toString()}`,
    {
      method: 'POST',
    },
  );
  if (!res.ok) {
    throw new Error(`Twitch OAuth failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedTwitchToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return data.access_token;
}

/**
 * Executes a query against the IGDB API endpoint.
 */
export async function queryIGDBEdge(
  endpoint: string,
  query: string,
  env: Env,
): Promise<unknown[]> {
  const token = await getEdgeTwitchToken(env);
  if (!token || !env.TWITCH_CLIENT_ID) {
    throw new Error(
      'IGDB credentials (TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET) not configured in Cloudflare Worker.',
    );
  }
  const res = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method: 'POST',
    headers: {
      'Client-ID': env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/plain',
    },
    body: query,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`IGDB API Error (${res.status}): ${errText}`);
  }
  return (await res.json()) as unknown[];
}

const LOOPBACK_DEV_ORIGINS = new Set([
  'http://localhost:4200',
  'http://127.0.0.1:4200',
]);

const WORKER_HTML_CSP = buildCspHeader({
  scriptSrc: "'self'",
  styleSrc: "'self' 'unsafe-inline' https://fonts.googleapis.com",
  fontSrc: "'self' https://fonts.gstatic.com data:",
  imgSrc: "'self' https: data: blob:",
  connectSrc: "'self' https:",
  workerSrc: "'self' blob:",
});

const JSON_BODY_MUTATION_PATHS = new Set([
  '/api/user/profile',
  '/api/user/tracking-rules',
  '/api/admin/catalog-seed',
  '/api/admin/plan-tier',
  '/api/collection/toggle',
  '/api/admin/verify-ownership/apply',
  '/api/collection/sort',
  '/api/journal',
  '/api/prices/live',
  '/api/prices/live-batch',
  '/api/prices/override',
  '/api/prices/cache/clear',
  '/api/notifications/subscribe',
  '/api/notifications/preferences',
  '/api/notifications/unsubscribe',
  '/api/notifications/test',
]);

const BACKUP_TABLES = [
  'platforms',
  'toy_series',
  'ignored_items',
  'games',
  'toys',
  'toy_game_compatibility',
  'game_releases',
  'push_subscriptions',
  'sync_state',
  'journal_entries',
  'price_query_overrides',
  'users',
  'user_tracking_rules',
  'user_game_releases',
  'user_games',
  'user_toys',
] as const;

export const R2_META_LITE_KEY = 'snapshots/meta-lite.json';
export const R2_TOYS_LITE_KEY = 'snapshots/toys-lite.json';
export const R2_GAMES_ACTIVE_LITE_KEY = 'snapshots/games-active-lite.json';
export const R2_BACKUP_CHUNK_PREFIX = 'snapshots/chunks/';
export const R2_BACKUP_CATALOG_MANIFEST_KEY =
  'snapshots/chunks/catalog-manifest.json';
export const R2_BACKUP_CANONICAL_MANIFEST_KEY =
  'snapshots/chunks/canonical-manifest.json';
export const BACKUP_CATALOG_CHUNKS_STATE_KEY = 'backup_catalog_chunks_state';
export const BACKUP_CANONICAL_CHUNKS_STATE_KEY =
  'backup_canonical_chunks_state';
export const BACKUP_GAMES_CHUNK_SIZE = 10_000;
export const BACKUP_RELEASES_CHUNK_SIZE = 15_000;
export const BACKUP_CANONICAL_CHUNK_SIZE = 15_000;
export const R2_CATALOG_MANIFEST_KEY = 'catalog/manifest.json';
export const R2_CATALOG_GAMES_CHUNK_PREFIX = 'catalog/games-chunk-';
export const R2_CATALOG_BUILDS_PREFIX = 'catalog/builds/';
export const R2_CATALOG_TOYS_CHUNK_KEY = 'catalog/toys-chunk-0.json';
export const CATALOG_MANIFEST_STATE_KEY = 'catalog_manifest_v1';
export const CATALOG_CHUNKS_DIRTY_KEY = 'catalog_chunks_dirty';
export const CATALOG_CHUNKS_LAST_BUILT_AT_KEY = 'catalog_chunks_last_built_at';
export const CATALOG_CHUNKS_ACTIVE_BUILDS_KEY = 'catalog_chunks_active_builds';
export const CATALOG_CHUNKS_COOLDOWN_MS = 2 * 60 * 60 * 1000;
export type WorkerPlanTier = 'paid' | 'free';
export const WORKER_PLAN_TIER_KEY = 'worker_plan_tier';
export const WORKER_DAT_SYNC_META_PREFIX = 'dat_sync_meta:';
export const WORKER_DAT_RETRO_CURSOR_KEY = 'worker_dat_retro_cursor';
export const WORKER_DAT_SYNC_STATS_KEY = 'worker_dat_sync_stats';

export async function resolveWorkerPlanTier(env: Env): Promise<WorkerPlanTier> {
  try {
    const row = await env.DB.prepare(
      'SELECT value FROM sync_state WHERE key = ?',
    )
      .bind(WORKER_PLAN_TIER_KEY)
      .first<{ value: string }>();
    if (row?.value === 'free') return 'free';
  } catch {
    // Default to 'paid' if sync_state unavailable
  }
  return 'paid';
}
export const X_CATALOG_PARTIAL_HEADER = 'X-Catalog-Partial';
export const X_CATALOG_VERSION_HEADER = 'X-Catalog-Version';
export const X_CATALOG_TOTAL_ROWS_HEADER = 'X-Catalog-Total-Rows';
export const X_CATALOG_CHUNK_SIZE_HEADER = 'X-Catalog-Chunk-Size';
export const X_CATALOG_CHUNK_COUNT_HEADER = 'X-Catalog-Chunk-Count';
export const X_CATALOG_SOURCE_HEADER = 'X-Catalog-Source';
export const MAX_FALLBACK_SNAPSHOT_BYTES = 5_000_000;
export const MAX_GAMES_LITE_SNAPSHOT_BYTES = 16_000_000;

export interface CatalogManifest {
  version: string;
  timestamp: string;
  totalRows: number;
  chunkSize: number;
  chunkCount: number;
  maxStableId: number;
  toysTotalRows: number;
  toysChunkCount: number;
  schemaVersion?: string;
  chunkPrefix?: string;
  chunkBounds?: number[];
  source?: 'd1-edge-cache' | 'r2-backup';
}

export function sanitizeCatalogBuildId(version: string): string {
  return (version || '').trim().replace(/[^A-Za-z0-9_-]/g, '_');
}

export function getCatalogChunkR2Key(
  chunkIndex: number,
  buildVersionOrId?: string,
): string {
  const sanitized = buildVersionOrId
    ? sanitizeCatalogBuildId(buildVersionOrId)
    : '';
  if (sanitized) {
    return `${R2_CATALOG_BUILDS_PREFIX}${sanitized}/games-chunk-${chunkIndex}.json`;
  }
  return `${R2_CATALOG_GAMES_CHUNK_PREFIX}${chunkIndex}.json`;
}

let cachedCatalogManifest: {
  manifest: CatalogManifest;
  expiresAt: number;
} | null = null;

let cachedCatalogToys: {
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  maxStableId: number;
  timestamp: string;
  expiresAt: number;
} | null = null;

let cachedCatalogDeltaGames: {
  key: string;
  rows: Array<Record<string, unknown>>;
  expiresAt: number;
} | null = null;

const LITE_GAMES_SELECT_COLS = `stable_id, id, title, series, platform_id, sort_index, image_url, igdb_id, genres, region, collections, franchises, canonical_series, manually_verified, CASE WHEN metadata_json LIKE '%alternative_names%' OR metadata_json LIKE '%game_localizations%' THEN metadata_json ELSE NULL END AS metadata_json, igdb_url, barcode, bundle_parent_id, bundle_disc_number, retail_price, retail_regular_price, retail_discount_pct, retail_on_sale, retail_store, retail_url, retail_updated_at`;
const LITE_GAME_RELEASES_SELECT_COLS = `id, game_id, region, variants, also_released_as, rom_name, rom_crc, release_date, image_url, canonical_release_id`;

export async function loadMetaSnapshotForFallback(
  bucket?: R2Bucket,
): Promise<R2BackupSnapshot<SnapshotTables> | null> {
  const lite = await loadR2LatestSnapshot<SnapshotTables>(bucket, {
    objectKey: R2_META_LITE_KEY,
    maxBytes: MAX_FALLBACK_SNAPSHOT_BYTES,
  });
  if (lite) return lite;
  return loadR2LatestSnapshot<SnapshotTables>(bucket, {
    maxBytes: MAX_FALLBACK_SNAPSHOT_BYTES,
  });
}

export async function loadToysSnapshotForFallback(
  bucket?: R2Bucket,
): Promise<R2BackupSnapshot<SnapshotTables> | null> {
  const lite = await loadR2LatestSnapshot<SnapshotTables>(bucket, {
    objectKey: R2_TOYS_LITE_KEY,
    maxBytes: MAX_FALLBACK_SNAPSHOT_BYTES,
  });
  if (lite) return lite;
  return loadR2LatestSnapshot<SnapshotTables>(bucket, {
    maxBytes: MAX_FALLBACK_SNAPSHOT_BYTES,
  });
}

export async function loadGamesSnapshotForFallback(
  bucket?: R2Bucket,
): Promise<R2BackupSnapshot<SnapshotTables> | null> {
  const lite = await loadR2LatestSnapshot<SnapshotTables>(bucket, {
    objectKey: R2_GAMES_ACTIVE_LITE_KEY,
    maxBytes: MAX_GAMES_LITE_SNAPSHOT_BYTES,
  });
  if (lite) return lite;
  return loadR2LatestSnapshot<SnapshotTables>(bucket, {
    maxBytes: MAX_FALLBACK_SNAPSHOT_BYTES,
  });
}

export async function loadOverlaySnapshotForFallback(
  bucket?: R2Bucket,
): Promise<R2BackupSnapshot<SnapshotTables> | null> {
  const latest = await loadR2LatestSnapshot<SnapshotTables>(bucket, {
    maxBytes: MAX_FALLBACK_SNAPSHOT_BYTES,
  });
  if (latest) return latest;
  return loadR2LatestSnapshot<SnapshotTables>(bucket, {
    objectKey: R2_GAMES_ACTIVE_LITE_KEY,
    maxBytes: MAX_GAMES_LITE_SNAPSHOT_BYTES,
  });
}

function stripGameMetadataJsonInPlace(
  rows: Array<Record<string, unknown>>,
): void {
  for (const g of rows) {
    const rawMeta = g['metadata_json'];
    if (typeof rawMeta !== 'string' || !rawMeta) {
      g['metadata_json'] = null;
      continue;
    }
    const parsed = parseGameMetadataOnce(rawMeta);
    if (parsed && (parsed.alternative_names || parsed.game_localizations)) {
      const minimalMeta: Record<string, unknown> = {};
      if (parsed.alternative_names) {
        minimalMeta['alternative_names'] = parsed.alternative_names;
      }
      if (parsed.game_localizations) {
        minimalMeta['game_localizations'] = parsed.game_localizations;
      }
      g['metadata_json'] = JSON.stringify(minimalMeta);
    } else {
      g['metadata_json'] = null;
    }
  }
}

async function queryChunkedByColumn(
  db: D1Database,
  sqlPrefix: string,
  values: Array<string | number>,
  chunkSize = 80,
): Promise<Array<Record<string, unknown>>> {
  if (values.length === 0) return [];
  const allRows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    const chunk = values.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    const { results } = await db
      .prepare(`${sqlPrefix} IN (${placeholders})`)
      .bind(...chunk)
      .all();
    if (results && results.length > 0) {
      allRows.push(...(results as Array<Record<string, unknown>>));
    }
  }
  return allRows;
}

export async function writeLiteBackupSnapshots(
  env: Env,
  timestampOverride?: string,
): Promise<void> {
  if (!env.BACKUP_BUCKET) return;
  const timestamp = timestampOverride || new Date().toISOString();

  const dumpAll = async (
    table: string,
  ): Promise<Array<Record<string, unknown>>> => {
    const { results } = await env.DB.prepare(`SELECT * FROM ${table}`).all();
    return (results as Array<Record<string, unknown>>) || [];
  };

  const [
    platforms,
    toy_series,
    users,
    user_tracking_rules,
    journal_entries,
    sync_state,
    toys,
    toy_game_compatibility,
    user_toys,
    user_games,
    user_game_releases,
  ] = await Promise.all([
    dumpAll('platforms'),
    dumpAll('toy_series'),
    dumpAll('users'),
    dumpAll('user_tracking_rules'),
    dumpAll('journal_entries'),
    dumpAll('sync_state'),
    dumpAll('toys'),
    dumpAll('toy_game_compatibility'),
    dumpAll('user_toys'),
    dumpAll('user_games'),
    dumpAll('user_game_releases'),
  ]);

  const countRow = (await env.DB.prepare(
    GAMES_HAS_MANY_ROWS_QUERY,
  ).first()) as { cnt?: number } | null;
  const totalGamesCount = Number(countRow?.cnt ?? 0);

  let activeGames: Array<Record<string, unknown>>;
  let activeReleases: Array<Record<string, unknown>>;

  if (totalGamesCount <= 500) {
    const gamesRes = await env.DB.prepare(
      `SELECT ${LITE_GAMES_SELECT_COLS} FROM games`,
    ).all();
    activeGames = (gamesRes.results as Array<Record<string, unknown>>) || [];
    activeReleases = await dumpAll('game_releases');
  } else {
    const activeStableIdSet = new Set<number>();
    for (const ug of user_games) {
      if (
        Number(ug['queued'] ?? 0) === 1 ||
        Number(ug['play_status'] ?? 0) > 0
      ) {
        activeStableIdSet.add(Number(ug['game_id']));
      }
    }
    const activeReleaseIds: string[] = [];
    for (const ugr of user_game_releases) {
      if (
        Number(ugr['ownership_status'] ?? 0) > 0 ||
        Number(ugr['has_media'] ?? 0) > 0 ||
        Number(ugr['has_case'] ?? 0) === 1 ||
        Number(ugr['has_manual'] ?? 0) === 1
      ) {
        activeReleaseIds.push(String(ugr['release_id']));
      }
    }
    if (activeReleaseIds.length > 0) {
      const relGameRows = await queryChunkedByColumn(
        env.DB,
        'SELECT id, game_id FROM game_releases WHERE id',
        activeReleaseIds,
      );
      for (const r of relGameRows) {
        activeStableIdSet.add(Number(r['game_id']));
      }
    }

    const [saleRows, bundleRows] = await Promise.all([
      env.DB.prepare(
        'SELECT stable_id, bundle_parent_id FROM games WHERE retail_on_sale = 1',
      ).all(),
      env.DB.prepare(
        'SELECT stable_id, bundle_parent_id FROM games WHERE bundle_parent_id IS NOT NULL',
      ).all(),
    ]);
    for (const row of [
      ...((saleRows.results as Array<Record<string, unknown>>) || []),
      ...((bundleRows.results as Array<Record<string, unknown>>) || []),
    ]) {
      activeStableIdSet.add(Number(row['stable_id']));
      if (
        row['bundle_parent_id'] !== null &&
        row['bundle_parent_id'] !== undefined
      ) {
        activeStableIdSet.add(Number(row['bundle_parent_id']));
      }
    }

    const stableIds = Array.from(activeStableIdSet).filter((id) =>
      Number.isFinite(id),
    );
    activeGames = await queryChunkedByColumn(
      env.DB,
      `SELECT ${LITE_GAMES_SELECT_COLS} FROM games WHERE stable_id`,
      stableIds,
    );
    activeReleases = await queryChunkedByColumn(
      env.DB,
      `SELECT ${LITE_GAME_RELEASES_SELECT_COLS} FROM game_releases WHERE game_id`,
      stableIds,
    );
  }

  stripGameMetadataJsonInPlace(activeGames);

  const buildSnapshotJson = (tables: SnapshotTables): string => {
    const tableCounts: Record<string, number> = {};
    let totalRows = 0;
    for (const [name, rows] of Object.entries(tables)) {
      tableCounts[name] = rows.length;
      totalRows += rows.length;
    }
    return JSON.stringify({
      timestamp,
      metadata: {
        version: '1.0',
        totalRows,
        tableCounts,
      },
      tables,
    });
  };

  const liteCustomMetadata = {
    date: timestamp.slice(0, 10),
    timestamp,
  };

  await Promise.all([
    env.BACKUP_BUCKET.put(
      R2_META_LITE_KEY,
      buildSnapshotJson({
        platforms,
        toy_series,
        users,
        user_tracking_rules,
        journal_entries,
        sync_state,
      }),
      {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: liteCustomMetadata,
      },
    ),
    env.BACKUP_BUCKET.put(
      R2_TOYS_LITE_KEY,
      buildSnapshotJson({
        platforms,
        toy_series,
        users,
        toys,
        toy_game_compatibility,
        user_toys,
      }),
      {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: liteCustomMetadata,
      },
    ),
    env.BACKUP_BUCKET.put(
      R2_GAMES_ACTIVE_LITE_KEY,
      buildSnapshotJson({
        platforms,
        users,
        user_tracking_rules,
        games: activeGames,
        game_releases: activeReleases,
        user_games,
        user_game_releases,
      }),
      {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: liteCustomMetadata,
      },
    ),
  ]);

  resetR2SnapshotCache();
}

const CATALOG_CHUNKS_STATE_KEY = 'catalog_chunks_state';
const CATALOG_GAMES_TOTAL_ROWS_KEY = 'catalog_games_total_rows';

interface CatalogChunksBuildState {
  targetVersion: string;
  buildId?: string;
  chunkPrefix?: string;
  timestamp: string;
  nextChunk: number;
  cursorStableId: number;
  chunkCount: number;
  totalRows: number;
  gamesCount?: number;
  maxStableId: number;
  toysTotalRows: number;
}

/**
 * Generates pre-processed, user-agnostic build-scoped R2 catalog chunks
 * (`catalog/builds/<buildId>/games-chunk-0..N.json`, `catalog/toys-chunk-0.json`)
 * and atomically swaps `catalog/manifest.json` upon completion, retaining 1 previous build
 * as a grace buffer and pruning older builds. Uses primary-key cursor ranges without OFFSET scans.
 */
export async function writeCatalogChunksToR2(
  env: Env,
  options: {
    startChunk?: number;
    maxChunksPerRun?: number;
    timestampOverride?: string;
    forceRestart?: boolean;
  } = {},
): Promise<CatalogManifest | null> {
  if (!env.BACKUP_BUCKET) return null;

  const chunkSize = CATALOG_GAMES_CHUNK_SIZE;
  const maxChunksPerRun = options.maxChunksPerRun ?? Infinity;

  let resumeState: CatalogChunksBuildState | null = null;
  if (!options.forceRestart && options.startChunk === undefined) {
    try {
      const stateRow = await env.DB.prepare(
        `SELECT value FROM sync_state WHERE key = ?`,
      )
        .bind(CATALOG_CHUNKS_STATE_KEY)
        .first<{ value: string }>();
      if (stateRow?.value) {
        const parsed = JSON.parse(stateRow.value) as CatalogChunksBuildState;
        if (
          parsed &&
          typeof parsed.nextChunk === 'number' &&
          typeof parsed.cursorStableId === 'number' &&
          typeof parsed.chunkCount === 'number' &&
          typeof parsed.maxStableId === 'number' &&
          parsed.cursorStableId < parsed.maxStableId &&
          parsed.targetVersion?.endsWith(`:${CATALOG_CHUNK_SCHEMA_VERSION}`)
        ) {
          resumeState = parsed;
        }
      }
    } catch {
      // ignore missing or malformed cursor state
    }
  }

  let timestamp: string;
  let totalRows: number;
  let gamesCount: number;
  let maxStableId: number;
  let chunkCount: number;
  let startChunk: number;
  let cursorStableId: number;
  let toysTotalRows: number;
  let targetVersion: string;
  let buildId: string;
  let chunkPrefix: string;

  if (resumeState) {
    timestamp = resumeState.timestamp;
    totalRows = resumeState.totalRows;
    gamesCount = resumeState.gamesCount ?? 0;
    maxStableId = resumeState.maxStableId;
    chunkCount = resumeState.chunkCount;
    startChunk = resumeState.nextChunk;
    cursorStableId = resumeState.cursorStableId;
    toysTotalRows = resumeState.toysTotalRows;
    targetVersion = resumeState.targetVersion;
    buildId = resumeState.buildId || sanitizeCatalogBuildId(targetVersion);
    chunkPrefix =
      resumeState.chunkPrefix ||
      `${R2_CATALOG_BUILDS_PREFIX}${buildId}/games-chunk-`;
  } else {
    timestamp = options.timestampOverride || new Date().toISOString();
    const [statsRow, toyRowsResult] = await Promise.all([
      env.DB.prepare(CATALOG_MAX_GAME_STABLE_ID_QUERY).first<{
        max_stable_id?: number;
      }>(),
      env.DB.prepare(buildToysListQuery(null)).all(),
    ]);

    maxStableId = Number(statsRow?.max_stable_id ?? 0);
    totalRows = 0;
    gamesCount = 0;
    chunkCount = Math.max(1, Math.ceil(maxStableId / CATALOG_GAMES_PER_CHUNK));
    startChunk = Math.max(0, options.startChunk ?? 0);
    if (startChunk > 0 && maxStableId > 0) {
      const startBoundRow = await env.DB.prepare(
        CATALOG_GAMES_CHUNK_BOUND_QUERY,
      )
        .bind(0, startChunk * CATALOG_GAMES_PER_CHUNK)
        .first<{ end_stable_id?: number }>();
      cursorStableId = Number(startBoundRow?.end_stable_id ?? 0);
    } else {
      cursorStableId = 0;
    }

    const toyRows =
      (toyRowsResult.results as Array<Record<string, unknown>>) || [];
    if (toyRows.length > 0) {
      postProcessToyListRows(toyRows, DEFAULT_USER_HOME_REGION);
    }
    let maxToyStableId = 0;
    for (const tr of toyRows) {
      const sid = Number(tr['stable_id'] ?? 0);
      if (sid > maxToyStableId) maxToyStableId = sid;
    }
    toysTotalRows = toyRows.length;

    await env.BACKUP_BUCKET.put(
      R2_CATALOG_TOYS_CHUNK_KEY,
      JSON.stringify(toyRows),
      {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: {
          rowCount: String(toysTotalRows),
          maxStableId: String(maxToyStableId),
          timestamp,
        },
      },
    );
    cachedCatalogToys = {
      rows: toyRows,
      rowCount: toysTotalRows,
      maxStableId: maxToyStableId,
      timestamp,
      expiresAt: Date.now() + 60_000,
    };

    targetVersion = `${timestamp.slice(0, 10)}:${maxStableId}:${Date.parse(timestamp) || Date.now()}:${CATALOG_CHUNK_SCHEMA_VERSION}`;
    buildId = sanitizeCatalogBuildId(targetVersion);
    chunkPrefix = `${R2_CATALOG_BUILDS_PREFIX}${buildId}/games-chunk-`;
    try {
      await env.DB.prepare(
        `INSERT INTO sync_state (key, value, updated_at)
         VALUES (?, '0', datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = '0', updated_at = datetime('now')
         WHERE sync_state.value != '0'`,
      )
        .bind(CATALOG_CHUNKS_DIRTY_KEY)
        .run();
    } catch {
      // ignore if sync_state is unavailable in minimal schemas
    }
  }

  const chunkQuery = buildCatalogGamesChunkQuery();
  const chunkLimit = Number.isFinite(maxChunksPerRun)
    ? Math.max(1, Math.floor(maxChunksPerRun))
    : Number.POSITIVE_INFINITY;
  let idx = startChunk;
  let chunksProcessed = 0;

  while (
    chunksProcessed < chunkLimit &&
    ((idx === 0 && maxStableId === 0) || cursorStableId < maxStableId)
  ) {
    let chunkRows: Array<Record<string, unknown>> = [];
    let endStableId = 0;
    if (maxStableId > 0) {
      const endRow = await env.DB.prepare(CATALOG_GAMES_CHUNK_BOUND_QUERY)
        .bind(cursorStableId, CATALOG_GAMES_PER_CHUNK)
        .first<{ end_stable_id?: number }>();
      endStableId = Number(endRow?.end_stable_id ?? 0);
      if (endStableId <= cursorStableId) {
        cursorStableId = maxStableId;
        break;
      }
      const { results } = await env.DB.prepare(chunkQuery)
        .bind(cursorStableId, endStableId)
        .all();
      chunkRows = (results as Array<Record<string, unknown>>) || [];
      if (chunkRows.length > 0) {
        postProcessGameListRows(chunkRows, DEFAULT_USER_HOME_REGION);
      }
    }

    await env.BACKUP_BUCKET.put(
      getCatalogChunkR2Key(idx, buildId),
      JSON.stringify(chunkRows),
      {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: {
          chunkIndex: String(idx),
          rowCount: String(chunkRows.length),
          version: targetVersion,
          buildId,
          schemaVersion: CATALOG_CHUNK_SCHEMA_VERSION,
          timestamp,
        },
      },
    );

    const chunkGameIds = new Set<unknown>();
    for (const r of chunkRows) {
      if (r['stable_id'] !== undefined && r['stable_id'] !== null) {
        chunkGameIds.add(r['stable_id']);
      }
    }
    totalRows += chunkRows.length;
    gamesCount += chunkGameIds.size;
    cursorStableId = maxStableId === 0 ? 0 : endStableId;
    idx++;
    chunksProcessed++;

    if (maxStableId === 0) {
      break;
    }

    if (cursorStableId < maxStableId) {
      chunkCount = Math.max(
        chunkCount,
        idx +
          Math.max(
            1,
            Math.ceil((maxStableId - cursorStableId) / CATALOG_GAMES_PER_CHUNK),
          ),
      );
      const nextState: CatalogChunksBuildState = {
        targetVersion,
        buildId,
        chunkPrefix,
        timestamp,
        nextChunk: idx,
        cursorStableId,
        chunkCount,
        totalRows,
        gamesCount,
        maxStableId,
        toysTotalRows,
      };
      try {
        await env.DB.prepare(
          `INSERT INTO sync_state (key, value, updated_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        )
          .bind(CATALOG_CHUNKS_STATE_KEY, JSON.stringify(nextState))
          .run();
      } catch {
        // ignore if sync_state is unavailable in minimal schemas
      }
    }
  }

  if (maxStableId > 0 && cursorStableId < maxStableId) {
    return null;
  }

  const finalChunkCount = Math.max(1, idx);
  const resolvedMaxStableId = Math.max(maxStableId, cursorStableId);
  const manifest: CatalogManifest = {
    version: targetVersion,
    timestamp,
    totalRows,
    chunkSize,
    chunkCount: finalChunkCount,
    maxStableId: resolvedMaxStableId,
    toysTotalRows,
    toysChunkCount: 1,
    schemaVersion: CATALOG_CHUNK_SCHEMA_VERSION,
    chunkPrefix,
  };

  await env.BACKUP_BUCKET.put(
    R2_CATALOG_MANIFEST_KEY,
    JSON.stringify(manifest),
    {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: {
        version: manifest.version,
        schemaVersion: CATALOG_CHUNK_SCHEMA_VERSION,
        chunkPrefix,
        totalRows: String(manifest.totalRows),
        chunkCount: String(manifest.chunkCount),
      },
    },
  );
  let retainBuilds = [buildId];
  try {
    const prevBuildsRow = await env.DB.prepare(
      `SELECT value FROM sync_state WHERE key = ?`,
    )
      .bind(CATALOG_CHUNKS_ACTIVE_BUILDS_KEY)
      .first<{ value: string }>()
      .catch(() => null);
    if (prevBuildsRow?.value) {
      const parsedPrev = JSON.parse(prevBuildsRow.value);
      if (Array.isArray(parsedPrev)) {
        for (const oldId of parsedPrev) {
          if (typeof oldId === 'string' && oldId && oldId !== buildId) {
            retainBuilds.push(oldId);
            break;
          }
        }
      }
    }
    retainBuilds = retainBuilds.slice(0, 2);

    await env.DB.prepare(
      `INSERT INTO sync_state (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
       WHERE sync_state.value != excluded.value`,
    )
      .bind(
        CATALOG_GAMES_TOTAL_ROWS_KEY,
        JSON.stringify({
          totalRows,
          gamesCount,
          chunkCount: finalChunkCount,
          maxStableId: resolvedMaxStableId,
          toysTotalRows,
        }),
      )
      .run();
    await env.DB.prepare(
      `INSERT INTO sync_state (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
      .bind(CATALOG_CHUNKS_ACTIVE_BUILDS_KEY, JSON.stringify(retainBuilds))
      .run();
    await env.DB.prepare(
      `INSERT INTO sync_state (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
      .bind(CATALOG_CHUNKS_LAST_BUILT_AT_KEY, timestamp)
      .run();
    await env.DB.prepare(`DELETE FROM sync_state WHERE key = ?`)
      .bind(CATALOG_CHUNKS_STATE_KEY)
      .run();
  } catch {
    // ignore cleanup error in minimal schemas
  }

  if (
    typeof env.BACKUP_BUCKET.list === 'function' &&
    typeof env.BACKUP_BUCKET.delete === 'function'
  ) {
    const retainSet = new Set(retainBuilds);
    const keysToDelete: string[] = [];
    let pruneCursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const listed = await env.BACKUP_BUCKET.list({
        prefix: R2_CATALOG_BUILDS_PREFIX,
        ...(pruneCursor ? { cursor: pruneCursor } : {}),
      }).catch(() => null);
      if (!listed?.objects) break;
      for (const obj of listed.objects) {
        const match = /^catalog\/builds\/([^/]+)\//.exec(obj.key);
        if (match && !retainSet.has(match[1])) {
          keysToDelete.push(obj.key);
        }
      }
      if (listed.truncated && 'cursor' in listed && listed.cursor) {
        pruneCursor = listed.cursor;
      } else {
        break;
      }
    }
    for (const staleKey of keysToDelete) {
      await env.BACKUP_BUCKET.delete(staleKey).catch(() => {});
    }
  }

  cachedCatalogManifest = {
    manifest,
    expiresAt: Date.now() + 60_000,
  };
  return manifest;
}

export async function resolveCatalogManifest(
  env: Env,
): Promise<CatalogManifest | null> {
  if (cachedCatalogManifest && cachedCatalogManifest.expiresAt > Date.now()) {
    return cachedCatalogManifest.manifest;
  }

  try {
    const [maxGameRow, maxToyRow, manifestRow, dirtyRow, catalogMetaRow] =
      await Promise.all([
        env.DB.prepare(CATALOG_MAX_GAME_STABLE_ID_QUERY).first<{
          max_stable_id?: number;
        }>(),
        env.DB.prepare(CATALOG_MAX_TOY_STABLE_ID_QUERY)
          .first<{ max_stable_id?: number }>()
          .catch(() => ({ max_stable_id: 0 })),
        env.DB.prepare('SELECT value FROM sync_state WHERE key = ?')
          .bind(CATALOG_MANIFEST_STATE_KEY)
          .first<{ value?: string }>()
          .catch(() => null),
        env.DB.prepare('SELECT value FROM sync_state WHERE key = ?')
          .bind(CATALOG_CHUNKS_DIRTY_KEY)
          .first<{ value?: string }>()
          .catch(() => null),
        env.DB.prepare('SELECT value FROM sync_state WHERE key = ?')
          .bind(CATALOG_GAMES_TOTAL_ROWS_KEY)
          .first<{ value?: string }>()
          .catch(() => null),
      ]);

    const maxStableId = Number(maxGameRow?.max_stable_id ?? 0);
    const maxToyStableId = Number(maxToyRow?.max_stable_id ?? 0);
    const isDirty = dirtyRow?.value === '1';

    if (manifestRow?.value && !isDirty) {
      try {
        const stored = JSON.parse(manifestRow.value) as CatalogManifest;
        if (
          stored &&
          typeof stored.version === 'string' &&
          stored.maxStableId === maxStableId &&
          stored.schemaVersion === CATALOG_CHUNK_SCHEMA_VERSION &&
          Array.isArray(stored.chunkBounds) &&
          stored.chunkBounds.length === stored.chunkCount + 1
        ) {
          const hydrated: CatalogManifest = {
            ...stored,
            source: 'd1-edge-cache',
          };
          cachedCatalogManifest = {
            manifest: hydrated,
            expiresAt: Date.now() + 60_000,
          };
          return hydrated;
        }
      } catch {
        // Recompute manifest below if sync_state JSON is corrupt
      }
    }

    const timestamp = new Date().toISOString();
    const chunkBounds: number[] = [0];
    if (maxStableId > 0) {
      let cursor = 0;
      for (let step = 0; step < 500 && cursor < maxStableId; step++) {
        const boundRow = await env.DB.prepare(CATALOG_GAMES_CHUNK_BOUND_QUERY)
          .bind(cursor, CATALOG_GAMES_PER_CHUNK)
          .first<{ end_stable_id?: number }>();
        const endStableId = Number(boundRow?.end_stable_id ?? 0);
        if (endStableId <= cursor) break;
        chunkBounds.push(endStableId);
        cursor = endStableId;
      }
    }
    if (chunkBounds.length === 1) {
      chunkBounds.push(maxStableId);
    }

    const chunkCount = Math.max(1, chunkBounds.length - 1);
    let totalRows = maxStableId;
    let gamesCount = maxStableId;
    let toysTotalRows = maxToyStableId;

    if (maxStableId === 0) {
      totalRows = 0;
      gamesCount = 0;
      if (maxToyStableId > 0) {
        const toyStats = await env.DB.prepare(
          'SELECT COUNT(*) AS cnt FROM toys',
        )
          .first<{ cnt?: number }>()
          .catch(() => ({ cnt: maxToyStableId }));
        toysTotalRows = Number(toyStats?.cnt ?? maxToyStableId);
      }
    } else if (maxStableId <= 600) {
      const [gameStats, toyStats] = await Promise.all([
        env.DB.prepare(
          `SELECT COUNT(*) AS total_rows, COUNT(DISTINCT g.stable_id) AS games_count
           FROM games g
           LEFT JOIN game_releases r ON g.stable_id = r.game_id`,
        ).first<{ total_rows?: number; games_count?: number }>(),
        env.DB.prepare('SELECT COUNT(*) AS cnt FROM toys')
          .first<{ cnt?: number }>()
          .catch(() => ({ cnt: 0 })),
      ]);
      totalRows = Number(gameStats?.total_rows ?? maxStableId);
      gamesCount = Number(gameStats?.games_count ?? maxStableId);
      toysTotalRows = Number(toyStats?.cnt ?? maxToyStableId);
    } else if (catalogMetaRow?.value && !isDirty) {
      try {
        const parsedMeta = JSON.parse(catalogMetaRow.value) as {
          totalRows?: number;
          gamesCount?: number;
          toysTotalRows?: number;
        };
        if (
          typeof parsedMeta.totalRows === 'number' &&
          parsedMeta.totalRows >= 0
        ) {
          totalRows = parsedMeta.totalRows;
        }
        if (
          typeof parsedMeta.gamesCount === 'number' &&
          parsedMeta.gamesCount >= 0
        ) {
          gamesCount = parsedMeta.gamesCount;
        }
        if (
          typeof parsedMeta.toysTotalRows === 'number' &&
          parsedMeta.toysTotalRows >= 0
        ) {
          toysTotalRows = parsedMeta.toysTotalRows;
        }
      } catch {
        // Ignore malformed metadata
      }
    } else {
      const [gCntRow, rCntRow, tCntRow] = await Promise.all([
        env.DB.prepare('SELECT COUNT(*) AS cnt FROM games').first<{
          cnt?: number;
        }>(),
        env.DB.prepare('SELECT COUNT(*) AS cnt FROM game_releases').first<{
          cnt?: number;
        }>(),
        env.DB.prepare('SELECT COUNT(*) AS cnt FROM toys')
          .first<{ cnt?: number }>()
          .catch(() => ({ cnt: maxToyStableId })),
      ]);
      gamesCount = Number(gCntRow?.cnt ?? maxStableId);
      const releaseCount = Number(rCntRow?.cnt ?? gamesCount);
      totalRows = Math.max(gamesCount, releaseCount);
      toysTotalRows = Number(tCntRow?.cnt ?? maxToyStableId);
    }

    const version = `${timestamp.slice(0, 10)}:${maxStableId}:${Date.parse(timestamp) || Date.now()}:${CATALOG_CHUNK_SCHEMA_VERSION}`;
    const manifest: CatalogManifest = {
      version,
      timestamp,
      totalRows,
      chunkSize: CATALOG_GAMES_CHUNK_SIZE,
      chunkCount,
      maxStableId,
      toysTotalRows,
      toysChunkCount: 1,
      schemaVersion: CATALOG_CHUNK_SCHEMA_VERSION,
      chunkBounds,
      source: 'd1-edge-cache',
    };

    try {
      await env.DB.prepare(
        `INSERT INTO sync_state (key, value, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
         WHERE sync_state.value != excluded.value`,
      )
        .bind(CATALOG_MANIFEST_STATE_KEY, JSON.stringify(manifest))
        .run();
      await env.DB.prepare(
        `INSERT INTO sync_state (key, value, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
         WHERE sync_state.value != excluded.value`,
      )
        .bind(
          CATALOG_GAMES_TOTAL_ROWS_KEY,
          JSON.stringify({
            totalRows,
            gamesCount,
            chunkCount,
            maxStableId,
            toysTotalRows,
          }),
        )
        .run();
      await env.DB.prepare(
        `INSERT INTO sync_state (key, value, updated_at)
         VALUES (?, '0', datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = '0', updated_at = datetime('now')
         WHERE sync_state.value != '0'`,
      )
        .bind(CATALOG_CHUNKS_DIRTY_KEY)
        .run();
    } catch {
      // Ignore sync_state persistence failures in minimal/read-only schemas
    }

    cachedCatalogManifest = {
      manifest,
      expiresAt: Date.now() + 60_000,
    };
    return manifest;
  } catch {
    return null;
  }
}

export async function recoverCatalogManifestFromR2Chunks(
  bucket?: R2Bucket,
): Promise<{ manifest: CatalogManifest; timestamp: string } | null> {
  if (!bucket || typeof bucket.list !== 'function') {
    return null;
  }

  type ChunkMetaEntry = {
    rowCount?: number;
    version?: string;
    schemaVersion?: string;
    timestamp?: string;
    uploaded?: Date;
  };

  // Prefer build-scoped immutable chunk folders (`catalog/builds/<buildId>/games-chunk-<idx>.json`)
  const buildsMap = new Map<string, Map<number, ChunkMetaEntry>>();
  let buildsCursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const listOpts = {
      prefix: R2_CATALOG_BUILDS_PREFIX,
      include: ['customMetadata'],
      ...(buildsCursor ? { cursor: buildsCursor } : {}),
    } as unknown as R2ListOptions;
    const listed = await bucket.list(listOpts).catch(() => null);
    if (!listed?.objects) break;
    for (const obj of listed.objects) {
      const m = /^catalog\/builds\/([^/]+)\/games-chunk-(\d+)\.json$/.exec(
        obj.key,
      );
      if (!m) continue;
      const folder = m[1];
      const chunkIdx = Number(m[2]);
      if (!Number.isInteger(chunkIdx) || chunkIdx < 0) continue;
      const custom = obj.customMetadata;
      const parsedCount = custom?.['rowCount']
        ? Number(custom['rowCount'])
        : undefined;
      let folderMap = buildsMap.get(folder);
      if (!folderMap) {
        folderMap = new Map();
        buildsMap.set(folder, folderMap);
      }
      folderMap.set(chunkIdx, {
        ...(parsedCount !== undefined &&
        Number.isFinite(parsedCount) &&
        parsedCount >= 0
          ? { rowCount: parsedCount }
          : {}),
        version: custom?.['version'],
        schemaVersion: custom?.['schemaVersion'],
        timestamp: custom?.['timestamp'],
        uploaded: obj.uploaded,
      });
    }
    if (listed.truncated && 'cursor' in listed && listed.cursor) {
      buildsCursor = listed.cursor;
    } else {
      break;
    }
  }

  let bestBuild: {
    folder: string;
    contiguousCount: number;
    totalRows: number;
    latestTimestamp: string;
    latestUploadedMs: number;
    chunk0Meta: ChunkMetaEntry | undefined;
  } | null = null;

  for (const [folder, folderMap] of buildsMap.entries()) {
    let contiguous = 0;
    while (folderMap.has(contiguous)) contiguous++;
    if (contiguous === 0) continue;
    const c0 = folderMap.get(0);
    let totalRows = 0;
    let latestTs = c0?.timestamp || '';
    let latestMs = 0;
    for (let i = 0; i < contiguous; i++) {
      const entry = folderMap.get(i);
      if (!entry) break;
      totalRows +=
        entry.rowCount !== undefined ? entry.rowCount : CATALOG_GAMES_PER_CHUNK;
      if (entry.timestamp && entry.timestamp > latestTs) {
        latestTs = entry.timestamp;
      }
      if (entry.uploaded instanceof Date) {
        const ms = entry.uploaded.getTime();
        if (ms > latestMs) latestMs = ms;
      }
    }
    if (
      !bestBuild ||
      contiguous > bestBuild.contiguousCount ||
      (contiguous === bestBuild.contiguousCount &&
        (latestTs > bestBuild.latestTimestamp ||
          (latestTs === bestBuild.latestTimestamp &&
            latestMs > bestBuild.latestUploadedMs)))
    ) {
      bestBuild = {
        folder,
        contiguousCount: contiguous,
        totalRows,
        latestTimestamp: latestTs,
        latestUploadedMs: latestMs,
        chunk0Meta: c0,
      };
    }
  }

  if (bestBuild) {
    const timestamp =
      bestBuild.latestTimestamp ||
      (bestBuild.latestUploadedMs > 0
        ? new Date(bestBuild.latestUploadedMs).toISOString()
        : new Date().toISOString());
    const version = bestBuild.chunk0Meta?.version || bestBuild.folder;
    const manifest: CatalogManifest = {
      version,
      timestamp,
      totalRows: bestBuild.totalRows,
      chunkSize: CATALOG_GAMES_CHUNK_SIZE,
      chunkCount: bestBuild.contiguousCount,
      maxStableId: 0,
      toysTotalRows: 0,
      toysChunkCount: 1,
      schemaVersion:
        bestBuild.chunk0Meta?.schemaVersion || CATALOG_CHUNK_SCHEMA_VERSION,
      chunkPrefix: `${R2_CATALOG_BUILDS_PREFIX}${bestBuild.folder}/games-chunk-`,
    };
    return { manifest, timestamp };
  }

  // Fallback: legacy unversioned `catalog/games-chunk-<idx>.json` keys
  const chunkMetaMap = new Map<number, ChunkMetaEntry>();
  let cursor: string | undefined;

  for (let page = 0; page < 10; page++) {
    const listOpts = {
      prefix: R2_CATALOG_GAMES_CHUNK_PREFIX,
      include: ['customMetadata'],
      ...(cursor ? { cursor } : {}),
    } as unknown as R2ListOptions;
    const listed = await bucket.list(listOpts).catch(() => null);
    if (!listed?.objects) {
      break;
    }
    for (const obj of listed.objects) {
      const m = /^catalog\/games-chunk-(\d+)\.json$/.exec(obj.key);
      if (!m) continue;
      const chunkIdx = Number(m[1]);
      if (!Number.isInteger(chunkIdx) || chunkIdx < 0) continue;
      const custom = obj.customMetadata;
      const parsedCount = custom?.['rowCount']
        ? Number(custom['rowCount'])
        : undefined;
      chunkMetaMap.set(chunkIdx, {
        ...(parsedCount !== undefined &&
        Number.isFinite(parsedCount) &&
        parsedCount >= 0
          ? { rowCount: parsedCount }
          : {}),
        version: custom?.['version'],
        timestamp: custom?.['timestamp'],
        uploaded: obj.uploaded,
      });
    }
    if (listed.truncated && 'cursor' in listed && listed.cursor) {
      cursor = listed.cursor;
    } else {
      break;
    }
  }

  let contiguousCount = 0;
  while (chunkMetaMap.has(contiguousCount)) {
    contiguousCount++;
  }
  if (contiguousCount === 0) {
    return null;
  }

  let chunk0Meta = chunkMetaMap.get(0);
  if (
    chunk0Meta &&
    !chunk0Meta.version &&
    !chunk0Meta.timestamp &&
    typeof bucket.head === 'function'
  ) {
    const headObj = await bucket
      .head(getCatalogChunkR2Key(0))
      .catch(() => null);
    if (headObj?.customMetadata) {
      const headCount = headObj.customMetadata['rowCount']
        ? Number(headObj.customMetadata['rowCount'])
        : undefined;
      chunk0Meta = {
        ...chunk0Meta,
        ...(headCount !== undefined &&
        Number.isFinite(headCount) &&
        headCount >= 0
          ? { rowCount: headCount }
          : {}),
        version: headObj.customMetadata['version'],
        timestamp: headObj.customMetadata['timestamp'],
      };
      chunkMetaMap.set(0, chunk0Meta);
    }
  }

  let totalRows = 0;
  let latestTimestamp = chunk0Meta?.timestamp || '';
  let latestUploadedMs = 0;
  for (let i = 0; i < contiguousCount; i++) {
    const entry = chunkMetaMap.get(i);
    if (!entry) break;
    totalRows +=
      entry.rowCount !== undefined ? entry.rowCount : CATALOG_GAMES_PER_CHUNK;
    if (entry.timestamp && entry.timestamp > latestTimestamp) {
      latestTimestamp = entry.timestamp;
    }
    if (entry.uploaded instanceof Date) {
      const ms = entry.uploaded.getTime();
      if (ms > latestUploadedMs) latestUploadedMs = ms;
    }
  }

  const timestamp =
    latestTimestamp ||
    (latestUploadedMs > 0
      ? new Date(latestUploadedMs).toISOString()
      : new Date().toISOString());
  const baseVersion = chunk0Meta?.version || timestamp.slice(0, 10);
  const manifest: CatalogManifest = {
    version: `${baseVersion}:r2-${contiguousCount}`,
    timestamp,
    totalRows,
    chunkSize: CATALOG_GAMES_CHUNK_SIZE,
    chunkCount: contiguousCount,
    maxStableId: 0,
    toysTotalRows: 0,
    toysChunkCount: 1,
  };
  return { manifest, timestamp };
}

async function invalidateCatalogManifest(env: Env): Promise<void> {
  cachedCatalogManifest = null;
  try {
    await env.DB.prepare('DELETE FROM sync_state WHERE key = ?')
      .bind(CATALOG_MANIFEST_STATE_KEY)
      .run();
  } catch {
    // Ignore in minimal/read-only schemas
  }
}

async function invalidateToysCatalogChunk(_env: Env): Promise<void> {
  cachedCatalogToys = null;
}

async function loadBaseToysCatalogChunk(env: Env): Promise<{
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  maxStableId: number;
  timestamp: string;
} | null> {
  if (cachedCatalogToys && cachedCatalogToys.expiresAt > Date.now()) {
    return cachedCatalogToys;
  }
  try {
    const { results } = await env.DB.prepare(buildToysListQuery(null)).all();
    const rows = (results as Array<Record<string, unknown>>) || [];
    if (rows.length > 0) {
      postProcessToyListRows(rows, DEFAULT_USER_HOME_REGION);
    }
    let maxStableId = 0;
    for (const r of rows) {
      const sid = Number(r['stable_id'] ?? 0);
      if (sid > maxStableId) maxStableId = sid;
    }
    const cached = {
      rows,
      rowCount: rows.length,
      maxStableId,
      timestamp: new Date().toISOString(),
      expiresAt: Date.now() + 60_000,
    };
    cachedCatalogToys = cached;
    return cached;
  } catch {
    return null;
  }
}

async function executeToysListWithR2Catalog(
  env: Env,
  userId: number | null,
  homeRegion: string,
): Promise<Array<Record<string, unknown>>> {
  const baseChunk = await loadBaseToysCatalogChunk(env);
  if (baseChunk) {
    const [d1Stats, userToyRows] = await Promise.all([
      env.DB.prepare(CATALOG_MAX_TOY_STABLE_ID_QUERY).first<{
        max_stable_id?: number;
      }>(),
      userId
        ? env.DB.prepare(USER_TOYS_OVERLAY_QUERY)
            .bind(userId)
            .all<{ toy_id: string; ownership_status: number }>()
        : Promise.resolve({
            results: [] as Array<{ toy_id: string; ownership_status: number }>,
          }),
    ]);

    const d1MaxId = Number(d1Stats?.max_stable_id ?? 0);

    // If toys were deleted directly in D1, re-query live D1 cleanly
    if (d1MaxId >= baseChunk.maxStableId || baseChunk.rowCount === 0) {
      let deltaRows: Array<Record<string, unknown>> = [];
      if (d1MaxId > baseChunk.maxStableId) {
        const { results: addedToys } = await env.DB.prepare(
          TOYS_DELTA_LIST_QUERY,
        )
          .bind(baseChunk.maxStableId)
          .all();
        deltaRows = (addedToys as Array<Record<string, unknown>>) || [];
      }

      const ownershipByToyId = new Map<string, number>();
      for (const ut of userToyRows.results || []) {
        ownershipByToyId.set(
          String(ut.toy_id),
          Number(ut.ownership_status ?? 0),
        );
      }

      const merged: Array<Record<string, unknown>> = [];
      const seenIds = new Set<string>();
      for (const row of [...baseChunk.rows, ...deltaRows]) {
        const id = String(row['id'] ?? '');
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        merged.push({
          ...row,
          ownership_status: userId ? (ownershipByToyId.get(id) ?? 0) : 0,
        });
      }

      if (merged.length > 0) {
        postProcessToyListRows(merged, homeRegion);
      }
      return merged;
    }
  }

  const query = buildToysListQuery(userId);
  const { results } = userId
    ? await env.DB.prepare(query).bind(userId).all()
    : await env.DB.prepare(query).all();
  const rows = (results as Array<Record<string, unknown>>) || [];
  if (rows.length > 0) {
    postProcessToyListRows(rows, homeRegion);
  }
  return rows;
}

/**
 * Resolves the session signing secret.
 * On non-loopback requests, requires a strong (>= 32 char, non-placeholder) SESSION_SECRET binding.
 * On loopback requests, allows fallback to ADMIN_KEY or a local dev secret.
 */
export function getSessionSecret(env: Env, url: URL): string | null {
  const isLoopback = isLoopbackRequest(url);
  const raw = env.SESSION_SECRET?.trim();
  if (!isLoopback) {
    if (!raw || raw === 'dev-insecure-session-secret-change-me') {
      return null;
    }
    try {
      return resolveStrongSecret(raw, 'SESSION_SECRET', false);
    } catch {
      return null;
    }
  }
  if (raw && raw.length > 0) {
    return raw;
  }
  return (
    env.ADMIN_KEY || 'dev-only-collection-tracker-local-session-secret-32c'
  );
}

/**
 * Applies standard security headers (HSTS on HTTPS, Permissions-Policy, XFO, nosniff,
 * Referrer-Policy, and strict Content-Security-Policy without 'unsafe-inline' in script-src)
 * to outgoing Worker responses.
 */
export function withSecurityHeaders(
  res: Response,
  includeHsts: boolean = true,
): Response {
  return kitWithSecurityHeaders(res, {
    htmlCsp: WORKER_HTML_CSP,
    includeHsts,
  });
}

export function getOidcIssuer(env: Env): string | null {
  const raw = (env.OIDC_ISSUER || env.OIDC_ISSUER_URL || '').trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, '');
}

export function getOidcClientId(env: Env): string {
  const raw = (env.OIDC_CLIENT_ID || '').trim();
  return raw || 'collection-tracker';
}

export function getAccountHubUrl(env: Env): string | null {
  const issuer = getOidcIssuer(env);
  if (!issuer) return null;
  const clientId = getOidcClientId(env);
  return `${issuer}/account?client_id=${encodeURIComponent(clientId)}`;
}

interface DbUserRow {
  id: number;
  username: string;
  oidc_sub?: string | null;
  is_public: number;
  home_region: string | null;
  display_name: string | null;
  bio: string | null;
  auto_track_series_on_add?: number | null;
  auto_seek_release_scope?: string | null;
  auto_seek_region_scope?: string | null;
  track_individual_media?: number | null;
}

type SnapshotTables = Record<string, Array<Record<string, unknown>>>;

function buildR2DegradedHeaders(
  timestamp: string | null | undefined,
  baseHeaders: Record<string, string> = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    ...baseHeaders,
    [KIT_DEGRADED_HEADER]: 'r2-backup',
  };
  if (timestamp) {
    headers[KIT_SNAPSHOT_TIMESTAMP_HEADER] = timestamp;
  }
  return headers;
}

function buildD1QuotaExceededResponse(
  baseHeaders: Record<string, string> = {},
): Response {
  return Response.json(
    {
      error: 'Database read quota exceeded',
      degraded: true,
    },
    {
      status: 503,
      headers: {
        'Cache-Control': 'no-store, private',
        ...baseHeaders,
      },
    },
  );
}

function normalizeAutoSeekReleaseScope(
  value: unknown,
): 'one_per_game' | 'all_releases' {
  return value === 'all_releases' ? 'all_releases' : 'one_per_game';
}

function normalizeAutoSeekRegionScope(value: unknown): 'home' | 'any' {
  return value === 'any' ? 'any' : 'home';
}

function toUserProfileResponsePayload(
  profile: DbUserRow,
  role: SessionUser['role'],
) {
  return {
    id: profile.id,
    username: profile.username,
    role,
    isPublic: Boolean(profile.is_public),
    homeRegion: profile.home_region || DEFAULT_USER_HOME_REGION,
    displayName: profile.display_name,
    bio: profile.bio,
    autoTrackSeriesOnAdd:
      profile.auto_track_series_on_add !== undefined &&
      profile.auto_track_series_on_add !== null
        ? Boolean(profile.auto_track_series_on_add)
        : true,
    autoSeekReleaseScope: normalizeAutoSeekReleaseScope(
      profile.auto_seek_release_scope,
    ),
    autoSeekRegionScope: normalizeAutoSeekRegionScope(
      profile.auto_seek_region_scope,
    ),
    trackIndividualMedia: Boolean(profile.track_individual_media),
  };
}

function snapshotRowToDbUserRow(row: Record<string, unknown>): DbUserRow {
  return {
    id: Number(row['id']),
    username: String(row['username'] || ''),
    oidc_sub: (row['oidc_sub'] as string | null) ?? null,
    is_public: Number(row['is_public'] ?? 0),
    home_region: (row['home_region'] as string | null) ?? null,
    display_name: (row['display_name'] as string | null) ?? null,
    bio: (row['bio'] as string | null) ?? null,
    auto_track_series_on_add:
      row['auto_track_series_on_add'] === undefined ||
      row['auto_track_series_on_add'] === null
        ? 1
        : Number(row['auto_track_series_on_add']),
    auto_seek_release_scope: normalizeAutoSeekReleaseScope(
      row['auto_seek_release_scope'],
    ),
    auto_seek_region_scope: normalizeAutoSeekRegionScope(
      row['auto_seek_region_scope'],
    ),
    track_individual_media: Number(row['track_individual_media'] ?? 0),
  };
}

function resolvePublicUserFromSnapshot(
  snapshot: R2BackupSnapshot<SnapshotTables>,
  username: string,
): {
  id: number;
  username: string;
  display_name: string | null;
  bio: string | null;
  home_region: string | null;
  is_public: number;
} | null {
  const users = snapshot.tables?.['users'] || [];
  const target = username.trim().toLowerCase();
  const match = users.find(
    (u) =>
      String(u['username'] || '')
        .trim()
        .toLowerCase() === target,
  );
  if (!match) return null;
  return {
    id: Number(match['id']),
    username: String(match['username'] || ''),
    display_name: (match['display_name'] as string | null) ?? null,
    bio: (match['bio'] as string | null) ?? null,
    home_region: (match['home_region'] as string | null) ?? null,
    is_public: Number(match['is_public'] ?? 0),
  };
}

async function resolveUserProfileWithFallback(
  env: Env,
  sessionUser: SessionUser,
): Promise<{
  profile: DbUserRow | null;
  degraded: boolean;
  degradedReason: 'r2_backup' | 'd1_unavailable' | null;
  snapshotTimestamp: string | null;
}> {
  let profile: DbUserRow | null = null;
  let d1Failed = false;

  try {
    profile = (await env.DB.prepare(
      "SELECT id, username, is_public, home_region, display_name, bio, COALESCE(auto_track_series_on_add, 1) as auto_track_series_on_add, COALESCE(auto_seek_release_scope, 'one_per_game') as auto_seek_release_scope, COALESCE(auto_seek_region_scope, 'home') as auto_seek_region_scope, COALESCE(track_individual_media, 0) as track_individual_media FROM users WHERE id = ?",
    )
      .bind(sessionUser.id)
      .first()) as DbUserRow | null;
  } catch (primaryErr) {
    if (isD1QuotaOrReadError(primaryErr)) {
      d1Failed = true;
    } else {
      try {
        profile = (await env.DB.prepare(
          'SELECT id, username, is_public, home_region, display_name, bio, COALESCE(auto_track_series_on_add, 1) as auto_track_series_on_add, COALESCE(track_individual_media, 0) as track_individual_media FROM users WHERE id = ?',
        )
          .bind(sessionUser.id)
          .first()) as DbUserRow | null;
      } catch {
        try {
          profile = (await env.DB.prepare(
            'SELECT id, username, is_public, home_region, display_name, bio FROM users WHERE id = ?',
          )
            .bind(sessionUser.id)
            .first()) as DbUserRow | null;
        } catch {
          d1Failed = true;
        }
      }
    }
  }

  if (!d1Failed) {
    return {
      profile,
      degraded: false,
      degradedReason: null,
      snapshotTimestamp: null,
    };
  }

  const snapshot = await loadMetaSnapshotForFallback(env.BACKUP_BUCKET);
  const r2Users = snapshot?.tables?.['users'] || [];
  const r2Row = r2Users.find((u) => Number(u['id']) === sessionUser.id);
  if (r2Row) {
    return {
      profile: snapshotRowToDbUserRow(r2Row),
      degraded: true,
      degradedReason: 'r2_backup',
      snapshotTimestamp: snapshot?.timestamp ?? null,
    };
  }

  // Stateless verified-cookie synthesis when neither D1 nor R2 backup row exists
  return {
    profile: {
      id: sessionUser.id,
      username: sessionUser.username,
      is_public: 0,
      home_region: sessionUser.homeRegion || DEFAULT_USER_HOME_REGION,
      display_name: null,
      bio: null,
      auto_track_series_on_add: 1,
      auto_seek_release_scope: 'one_per_game',
      auto_seek_region_scope: 'home',
      track_individual_media: 0,
    },
    degraded: true,
    degradedReason: 'd1_unavailable',
    snapshotTimestamp: snapshot?.timestamp ?? null,
  };
}

function buildPlatformsFromSnapshot(
  snapshot: R2BackupSnapshot<SnapshotTables>,
): Array<Record<string, unknown>> {
  const platforms = snapshot.tables?.['platforms'] || [];
  const games = snapshot.tables?.['games'] || [];
  const directPlatformIds = new Set<number>();
  for (const g of games) {
    if (g['platform_id'] !== undefined && g['platform_id'] !== null) {
      directPlatformIds.add(Number(g['platform_id']));
    }
  }
  const childIdsByParent = new Map<number, number[]>();
  for (const p of platforms) {
    const parentId = p['parent_platform_id'];
    if (parentId !== undefined && parentId !== null) {
      const pid = Number(parentId);
      const list = childIdsByParent.get(pid) || [];
      list.push(Number(p['id']));
      childIdsByParent.set(pid, list);
    }
  }

  return platforms
    .filter((p) => {
      const id = Number(p['id']);
      if (id === 0) return false;
      if (
        p['parent_platform_id'] !== undefined &&
        p['parent_platform_id'] !== null
      ) {
        return false;
      }
      if (games.length === 0) return true;
      if (directPlatformIds.has(id)) return true;
      const children = childIdsByParent.get(id) || [];
      return children.some((cid) => directPlatformIds.has(cid));
    })
    .sort((a, b) => {
      const aLaunch = (a['launch_date'] as string | null) ?? null;
      const bLaunch = (b['launch_date'] as string | null) ?? null;
      const aNull = aLaunch === null ? 1 : 0;
      const bNull = bLaunch === null ? 1 : 0;
      if (aNull !== bNull) return aNull - bNull;
      if (aLaunch !== null && bLaunch !== null && aLaunch !== bLaunch) {
        return aLaunch < bLaunch ? -1 : 1;
      }
      return Number(a['id']) - Number(b['id']);
    });
}

function buildGamesListFromSnapshot(
  snapshot: R2BackupSnapshot<SnapshotTables>,
  userId: number | null,
  homeRegion: string,
  platformIdFilter?: string | null,
): Array<Record<string, unknown>> {
  const platforms = snapshot.tables?.['platforms'] || [];
  const games = snapshot.tables?.['games'] || [];
  const releases = snapshot.tables?.['game_releases'] || [];
  const userGames = snapshot.tables?.['user_games'] || [];
  const userGameReleases = snapshot.tables?.['user_game_releases'] || [];

  const platformById = new Map<number, Record<string, unknown>>();
  for (const p of platforms) {
    platformById.set(Number(p['id']), p);
  }

  let allowedPlatformIds: Set<number> | null = null;
  if (platformIdFilter) {
    const targetPid = Number(platformIdFilter);
    allowedPlatformIds = new Set<number>([targetPid]);
    for (const p of platforms) {
      if (
        p['parent_platform_id'] !== undefined &&
        p['parent_platform_id'] !== null &&
        Number(p['parent_platform_id']) === targetPid
      ) {
        allowedPlatformIds.add(Number(p['id']));
      }
    }
  }

  const releasesByGameId = new Map<number, Array<Record<string, unknown>>>();
  for (const r of releases) {
    const gid = Number(r['game_id']);
    const list = releasesByGameId.get(gid) || [];
    list.push(r);
    releasesByGameId.set(gid, list);
  }

  const userGamesByStableId = new Map<number, Record<string, unknown>>();
  const userReleasesByReleaseId = new Map<string, Record<string, unknown>>();
  const activeUserStableIds = new Set<number>();
  if (userId !== null) {
    for (const ug of userGames) {
      if (Number(ug['user_id']) === userId) {
        const sid = Number(ug['game_id']);
        userGamesByStableId.set(sid, ug);
        if (
          Number(ug['play_status'] ?? 0) > 0 ||
          Number(ug['queued'] ?? 0) > 0
        ) {
          activeUserStableIds.add(sid);
        }
      }
    }
    const releaseToGameId = new Map<string, number>();
    for (const r of releases) {
      releaseToGameId.set(String(r['id']), Number(r['game_id']));
    }
    for (const ugr of userGameReleases) {
      if (Number(ugr['user_id']) === userId) {
        const relId = String(ugr['release_id']);
        userReleasesByReleaseId.set(relId, ugr);
        if (
          Number(ugr['ownership_status'] ?? 0) > 0 ||
          Number(ugr['has_media'] ?? 0) > 0 ||
          Number(ugr['has_case'] ?? 0) > 0 ||
          Number(ugr['has_manual'] ?? 0) > 0
        ) {
          const gid = releaseToGameId.get(relId);
          if (gid !== undefined && Number.isFinite(gid)) {
            activeUserStableIds.add(gid);
          }
        }
      }
    }
    for (const g of games) {
      const sid = Number(g['stable_id']);
      const parentId = g['bundle_parent_id'];
      if (
        activeUserStableIds.has(sid) &&
        parentId !== undefined &&
        parentId !== null
      ) {
        const pid = Number(parentId);
        if (Number.isFinite(pid) && pid > 0) {
          activeUserStableIds.add(pid);
        }
      }
    }
  }

  const bundleCounts = new Map<number, number>();
  for (const g of games) {
    const parentId = g['bundle_parent_id'];
    if (parentId !== undefined && parentId !== null) {
      const pid = Number(parentId);
      bundleCounts.set(pid, (bundleCounts.get(pid) ?? 0) + 1);
    }
  }

  const todayDateStr = new Date().toISOString().slice(0, 10);
  const rows: Array<Record<string, unknown>> = [];
  for (const g of games) {
    if (g['is_hidden'] === 1) continue;
    const platId = Number(g['platform_id']);
    if (allowedPlatformIds && !allowedPlatformIds.has(platId)) continue;

    const stableId = Number(g['stable_id']);
    const gameReleases = releasesByGameId.get(stableId);
    const relList: Array<Record<string, unknown> | null> =
      gameReleases && gameReleases.length > 0 ? gameReleases : [null];

    const isRetailOnSale = Number(g['retail_on_sale'] ?? 0) === 1;
    const hasBundleParent =
      g['bundle_parent_id'] !== null &&
      g['bundle_parent_id'] !== undefined &&
      Number(g['bundle_parent_id']) > 0;
    const hasUpcomingRelease = relList.some((r) =>
      Boolean(
        r &&
        typeof r['release_date'] === 'string' &&
        String(r['release_date']).slice(0, 10) >= todayDateStr,
      ),
    );
    const isGlobalActive =
      isRetailOnSale || hasUpcomingRelease || hasBundleParent;
    const isUserActive = userId !== null && activeUserStableIds.has(stableId);
    if (!isUserActive && !isGlobalActive) continue;

    const p = platformById.get(platId);
    const pp =
      p &&
      p['parent_platform_id'] !== undefined &&
      p['parent_platform_id'] !== null
        ? platformById.get(Number(p['parent_platform_id']))
        : undefined;
    const effPlatform = pp || p;
    const ug = userId !== null ? userGamesByStableId.get(stableId) : undefined;
    const isUgActive = Boolean(
      ug &&
      (Number(ug['play_status'] ?? 0) > 0 || Number(ug['queued'] ?? 0) > 0),
    );
    const hasPositiveRetailPrice =
      g['retail_price'] !== null &&
      g['retail_price'] !== undefined &&
      Number(g['retail_price']) > 0;

    let pushedForGame = 0;
    const gameRows: Array<Record<string, unknown>> = [];

    for (const r of relList) {
      const relId = r ? String(r['id']) : null;
      const ugr =
        userId !== null && relId
          ? userReleasesByReleaseId.get(relId)
          : undefined;
      const isUgrActive = Boolean(
        ugr &&
        (Number(ugr['ownership_status'] ?? 0) > 0 ||
          Number(ugr['has_media'] ?? 0) > 0 ||
          Number(ugr['has_case'] ?? 0) > 0 ||
          Number(ugr['has_manual'] ?? 0) > 0),
      );
      const isRowUpcoming = Boolean(
        r &&
        typeof r['release_date'] === 'string' &&
        String(r['release_date']).slice(0, 10) >= todayDateStr,
      );
      const isRowGlobalActive =
        isRetailOnSale ||
        (hasPositiveRetailPrice && isGlobalActive) ||
        isRowUpcoming ||
        hasBundleParent;

      const builtRow: Record<string, unknown> = {
        id: relId ?? g['id'],
        game_id: g['id'],
        stable_id: stableId,
        title: g['title'],
        base_title: g['title'],
        raw_title: null,
        series: g['series'] ?? null,
        canonical_series: g['canonical_series'] ?? null,
        release_date: (r ? r['release_date'] : g['release_date']) ?? null,
        platform_id: platId,
        queued: ug ? Number(ug['queued'] ?? 0) : 0,
        sort_index: g['sort_index'] ?? null,
        image_url: r?.['image_url'] || g['image_url'] || null,
        play_status: ug ? Number(ug['play_status'] ?? 0) : 0,
        igdb_id: g['igdb_id'] ?? null,
        igdb_url: g['igdb_url'] ?? null,
        genres: g['genres'] ?? null,
        collections: g['collections'] ?? null,
        franchises: g['franchises'] ?? null,
        manually_verified: g['manually_verified'] ?? 0,
        metadata_json: g['metadata_json'] ?? null,
        barcode: g['barcode'] ?? null,
        bundle_parent_id: g['bundle_parent_id'] ?? null,
        bundle_disc_number: g['bundle_disc_number'] ?? null,
        bundle_count: bundleCounts.get(stableId) ?? 0,
        ownership_status: ugr ? Number(ugr['ownership_status'] ?? 0) : 0,
        region: r?.['region'] || g['region'] || null,
        variants: r?.['variants'] ?? null,
        also_released_as: r?.['also_released_as'] ?? null,
        rom_name: r?.['rom_name'] ?? null,
        rom_crc: r?.['rom_crc'] ?? null,
        has_media: ugr ? Number(ugr['has_media'] ?? 0) : 0,
        has_case: ugr ? Number(ugr['has_case'] ?? 0) : 0,
        has_manual: ugr ? Number(ugr['has_manual'] ?? 0) : 0,
        retail_price: g['retail_price'] ?? null,
        retail_regular_price: g['retail_regular_price'] ?? null,
        retail_discount_pct: g['retail_discount_pct'] ?? null,
        retail_on_sale: Number(g['retail_on_sale'] ?? 0),
        retail_store: g['retail_store'] ?? null,
        retail_url: g['retail_url'] ?? null,
        retail_updated_at: g['retail_updated_at'] ?? null,
        display_name: (effPlatform?.['display_name'] as string | null) ?? null,
        platform: (effPlatform?.['display_name'] as string | null) ?? null,
        brand: (effPlatform?.['brand'] as string | null) ?? null,
        platform_launch_date: effPlatform?.['launch_date'] ?? null,
        platform_logo: effPlatform?.['image_url'] ?? null,
        parent_platform_id: p?.['parent_platform_id'] ?? null,
        canonical_release_id: r?.['canonical_release_id'] ?? null,
        source: (r?.['verified_source'] as string | null) ?? null,
        serial_code: (r?.['serial_code'] as string | null) ?? null,
        is_source_verified:
          r?.['canonical_release_id'] != null ||
          Boolean(r?.['rom_name']) ||
          Boolean(r?.['verified_source'])
            ? 1
            : 0,
      };
      gameRows.push(builtRow);
      if (isUgrActive || isUgActive || isRowGlobalActive) {
        rows.push(builtRow);
        pushedForGame++;
      }
    }

    if (pushedForGame === 0 && isUserActive && gameRows.length > 0) {
      rows.push(...gameRows);
    }
  }

  if (rows.length > 0) {
    postProcessGameListRows(rows, homeRegion);
  }
  return rows;
}

function applyGameDetailReleasePartitionAndTitles(
  game: DbGame,
  typedResults: Array<
    Record<string, unknown> & {
      id?: string;
      rom_name?: string | null;
      region?: string | null;
      variants?: string | null;
    }
  >,
  effectiveHomeRegion: string,
): void {
  const targetKey = getRomGroupingKey(game.rom_name);
  const isMulti = targetKey.startsWith('multi:');

  if (isMulti) {
    game.releases = typedResults.filter(
      (r) => getRomGroupingKey(r.rom_name) === targetKey,
    );
    game.other_releases = typedResults.filter(
      (r) => getRomGroupingKey(r.rom_name) !== targetKey,
    );
  } else {
    let primaryReleases = typedResults.filter((r) => r.id === game.id);
    if (primaryReleases.length === 0) {
      primaryReleases = typedResults.filter(
        (r) => r.region === game.region && r.variants === game.variants,
      );
    }
    if (primaryReleases.length === 0 && typedResults.length > 0) {
      primaryReleases = [typedResults[0]];
    }
    // Also include companion pack-in demo/bonus discs in primaryReleases if they belong to this game and region
    const packInReleases = typedResults.filter(
      (r) =>
        !primaryReleases.some((pr) => pr.id === r.id) &&
        (r.region === game.region || (!r.region && game.region === 'USA')) &&
        (/\b(demo|trial edition|bonus disc|sampler)\b/i.test(
          String(r.variants || ''),
        ) ||
          /\b(demo|trial edition|bonus disc|sampler)\b/i.test(
            String(r.rom_name || ''),
          )),
    );
    if (packInReleases.length > 0) {
      primaryReleases = [...primaryReleases, ...packInReleases];
    }
    game.releases = primaryReleases;
    game.other_releases = typedResults.filter(
      (r) => !primaryReleases.some((pr) => pr.id === r.id),
    );
  }

  const extractDiscOrder = (rel: Record<string, unknown>): number => {
    const label = String(rel['disc_label'] || '');
    let m = label.match(/^(?:disc|disco|disque|disk)\s+(\d+)/i);
    if (m) return parseInt(m[1], 10);
    const rom = String(rel['rom_name'] || '');
    m = rom.match(/\b(?:disc|disco|disque|disk)\s*(\d+)/i);
    if (m) return parseInt(m[1], 10);
    return 99;
  };
  if (game.releases.length > 1) {
    game.releases.sort(
      (a, b) =>
        extractDiscOrder(a) - extractDiscOrder(b) ||
        String(a['rom_name'] || '').localeCompare(String(b['rom_name'] || '')),
    );
  }

  const baseTitle = game.base_title || game.title || '';
  const parsedMeta = parseGameMetadataOnce(game.metadata_json || null);
  game.title = resolveLocalizedReleaseTitle(
    baseTitle,
    game.region as string | null,
    parsedMeta,
    game.raw_title || game.title || '',
    effectiveHomeRegion,
  );
  if (game.releases && game.releases.length > 0) {
    for (const rel of game.releases) {
      rel['title'] = resolveLocalizedReleaseTitle(
        baseTitle,
        rel['region'] as string | null,
        parsedMeta,
        rel['title'] as string | null,
        effectiveHomeRegion,
      );
    }
  }
  if (game.other_releases && game.other_releases.length > 0) {
    for (const rel of game.other_releases) {
      rel['title'] = resolveLocalizedReleaseTitle(
        baseTitle,
        rel['region'] as string | null,
        parsedMeta,
        rel['title'] as string | null,
        effectiveHomeRegion,
      );
    }
  }

  if (
    (!game.releases || game.releases.length === 0) &&
    game.platform_id !== 0
  ) {
    game.releases = [
      {
        id: game.id,
        game_id: game.stable_id,
        region: game.region || null,
        variants: game.variants || null,
        rom_name: game.rom_name || null,
        rom_crc: game.rom_crc || null,
        has_media: game.has_media || 0,
        ownership_status: game.ownership_status || 0,
        release_date: game.release_date || null,
      },
    ];
  }
}

function finalizeGameDetailObject(
  game: DbGame,
  typedResults: Array<
    Record<string, unknown> & {
      id?: string;
      rom_name?: string | null;
      region?: string | null;
      variants?: string | null;
    }
  >,
  candidateReleases: CompanionDiscCandidateRow[],
  bundledRows: Array<Record<string, unknown>>,
  effectiveHomeRegion: string,
): DbGame {
  applyGameDetailReleasePartitionAndTitles(
    game,
    typedResults,
    effectiveHomeRegion,
  );

  if (game.platform_id) {
    enrichGameDetailWithCompanionsAndVouchers(game, candidateReleases);
  }

  if (game.stable_id) {
    game.bundled_games = bundledRows.map((row) => ({
      ...row,
      platform_id: (row as { platform_id: number }).platform_id,
    }));
  }

  return game;
}

function buildGameDetailFromSnapshot(
  snapshot: R2BackupSnapshot<SnapshotTables>,
  id: string,
  userId: number | null,
  homeRegion: string,
  releaseId?: string | null,
): DbGame | null {
  const games = snapshot.tables?.['games'] || [];
  const releases = snapshot.tables?.['game_releases'] || [];
  const platforms = snapshot.tables?.['platforms'] || [];
  const userGames = snapshot.tables?.['user_games'] || [];
  const userGameReleases = snapshot.tables?.['user_game_releases'] || [];

  const explicitRelId = (releaseId || '').trim();
  const matchedRelease = explicitRelId
    ? releases.find((r) => String(r['id']) === explicitRelId) || null
    : releases.find((r) => String(r['id']) === id) || null;
  let g: Record<string, unknown> | undefined;
  if (matchedRelease) {
    const gid = Number(matchedRelease['game_id']);
    g = games.find((item) => Number(item['stable_id']) === gid);
  }
  if (!g) {
    g = games.find(
      (item) => String(item['stable_id']) === id || String(item['id']) === id,
    );
  }
  if (!g) return null;

  const stableId = Number(g['stable_id']);
  const platId = Number(g['platform_id']);
  const platformById = new Map<number, Record<string, unknown>>();
  for (const p of platforms) {
    platformById.set(Number(p['id']), p);
  }
  const gameByStableId = new Map<number, Record<string, unknown>>();
  for (const item of games) {
    gameByStableId.set(Number(item['stable_id']), item);
  }
  const userReleasesByReleaseId = new Map<string, Record<string, unknown>>();
  if (userId) {
    for (const ugr of userGameReleases) {
      if (Number(ugr['user_id']) === userId) {
        userReleasesByReleaseId.set(String(ugr['release_id']), ugr);
      }
    }
  }
  const ug = userId
    ? userGames.find(
        (item) =>
          Number(item['user_id']) === userId &&
          Number(item['game_id']) === stableId,
      )
    : undefined;

  const gameReleases = releases.filter(
    (r) => Number(r['game_id']) === stableId,
  );
  let primaryRel = matchedRelease;
  if (!primaryRel && gameReleases.length > 0) {
    primaryRel = [...gameReleases].sort((a, b) => {
      const aOwned = userId
        ? Number(
            userReleasesByReleaseId.get(String(a['id']))?.[
              'ownership_status'
            ] ?? 0,
          )
        : 0;
      const bOwned = userId
        ? Number(
            userReleasesByReleaseId.get(String(b['id']))?.[
              'ownership_status'
            ] ?? 0,
          )
        : 0;
      if (aOwned !== bOwned) return bOwned - aOwned;
      const aReg = a['region'] === g['region'] ? 0 : 1;
      const bReg = b['region'] === g['region'] ? 0 : 1;
      if (aReg !== bReg) return aReg - bReg;
      return String(a['id']).localeCompare(String(b['id']));
    })[0];
  }

  const p = platformById.get(platId);
  const pp =
    p &&
    p['parent_platform_id'] !== undefined &&
    p['parent_platform_id'] !== null
      ? platformById.get(Number(p['parent_platform_id']))
      : undefined;
  const effPlatform = pp || p;
  const bundleCount = games.filter(
    (item) =>
      item['bundle_parent_id'] !== null &&
      item['bundle_parent_id'] !== undefined &&
      Number(item['bundle_parent_id']) === stableId,
  ).length;
  const fallbackReleaseDate =
    (primaryRel?.['release_date'] as string | null | undefined) ??
    (gameReleases.find((r) => Boolean(r['release_date']))?.['release_date'] as
      | string
      | null
      | undefined) ??
    (g['release_date'] as string | null | undefined) ??
    null;
  const primaryUgr =
    userId && primaryRel
      ? userReleasesByReleaseId.get(String(primaryRel['id']))
      : undefined;

  const game: DbGame = {
    id: primaryRel ? String(primaryRel['id']) : String(g['id']),
    game_id: String(g['id']),
    stable_id: stableId,
    title: String(g['title'] || ''),
    base_title: String(g['title'] || ''),
    raw_title: null,
    series: (g['series'] as string | null) ?? null,
    canonical_series: (g['canonical_series'] as string | null) ?? null,
    release_date: fallbackReleaseDate,
    platform_id: platId,
    queued: ug ? Number(ug['queued'] ?? 0) : 0,
    sort_index: (g['sort_index'] as number | null) ?? null,
    image_url:
      ((primaryRel?.['image_url'] || g['image_url']) as string | null) ?? null,
    play_status: ug ? Number(ug['play_status'] ?? 0) : 0,
    igdb_id: (g['igdb_id'] as string | number | null) ?? null,
    igdb_url: (g['igdb_url'] as string | null) ?? null,
    summary: (g['summary'] as string | null) ?? null,
    genres: (g['genres'] as string | null) ?? null,
    collections: (g['collections'] as string | null) ?? null,
    franchises: (g['franchises'] as string | null) ?? null,
    manually_verified: Number(g['manually_verified'] ?? 0),
    metadata_json: (g['metadata_json'] as string | null) ?? null,
    barcode: (g['barcode'] as string | null) ?? null,
    bundle_parent_id: (g['bundle_parent_id'] as number | null) ?? null,
    bundle_disc_number: (g['bundle_disc_number'] as number | null) ?? null,
    bundle_count: bundleCount,
    ownership_status: primaryUgr
      ? Number(primaryUgr['ownership_status'] ?? 0)
      : 0,
    region: ((primaryRel?.['region'] || g['region']) as string | null) ?? null,
    variants: (primaryRel?.['variants'] as string | null) ?? null,
    also_released_as:
      (primaryRel?.['also_released_as'] as string | null) ?? null,
    rom_name: (primaryRel?.['rom_name'] as string | null) ?? null,
    rom_crc: (primaryRel?.['rom_crc'] as string | null) ?? null,
    has_media: primaryUgr ? Number(primaryUgr['has_media'] ?? 0) : 0,
    has_case: primaryUgr ? Number(primaryUgr['has_case'] ?? 0) : 0,
    has_manual: primaryUgr ? Number(primaryUgr['has_manual'] ?? 0) : 0,
    display_name: (effPlatform?.['display_name'] as string | null) ?? null,
    platform: (effPlatform?.['display_name'] as string | null) ?? null,
    brand: (effPlatform?.['brand'] as string | null) ?? null,
    platform_launch_date:
      (effPlatform?.['launch_date'] as string | null) ?? null,
    platform_logo: (effPlatform?.['image_url'] as string | null) ?? null,
    parent_platform_id: (p?.['parent_platform_id'] as number | null) ?? null,
  } as DbGame;

  const isMulti = getRomGroupingKey(game.rom_name).startsWith('multi:');
  const mapReleaseRow = (r: Record<string, unknown>) => {
    const rid = String(r['id']);
    const ugr = userId ? userReleasesByReleaseId.get(rid) : undefined;
    return {
      id: rid,
      game_id: Number(r['game_id']),
      region: (r['region'] as string | null) ?? null,
      variants: (r['variants'] as string | null) ?? null,
      also_released_as: (r['also_released_as'] as string | null) ?? null,
      rom_name: (r['rom_name'] as string | null) ?? null,
      rom_crc: (r['rom_crc'] as string | null) ?? null,
      has_media: ugr ? Number(ugr['has_media'] ?? 0) : 0,
      ownership_status: ugr ? Number(ugr['ownership_status'] ?? 0) : 0,
      title: (r['also_released_as'] as string | null) ?? null,
      release_date:
        (r['release_date'] as string | null) ?? fallbackReleaseDate ?? null,
      image_url: (r['image_url'] as string | null) ?? null,
      has_case: ugr ? Number(ugr['has_case'] ?? 0) : 0,
      has_manual: ugr ? Number(ugr['has_manual'] ?? 0) : 0,
      canonical_release_id:
        (r['canonical_release_id'] as string | null) ?? null,
      source: (r['verified_source'] as string | null) ?? null,
      is_source_verified:
        r['canonical_release_id'] != null ||
        Boolean(r['rom_name']) ||
        Boolean(r['verified_source'])
          ? 1
          : 0,
      serial_code: (r['serial_code'] as string | null) ?? null,
      comments: (r['publisher'] as string | null) ?? null,
    };
  };

  const typedResults = gameReleases.map(mapReleaseRow).sort((a, b) => {
    if (!isMulti) {
      const regRank = (reg: string | null) =>
        reg === game.region ? 0 : reg === 'World' ? 1 : reg === null ? 2 : 3;
      const rDiff = regRank(a.region) - regRank(b.region);
      if (rDiff !== 0) return rDiff;
      const aVar = String(a.variants || '');
      const bVar = String(b.variants || '');
      if (aVar !== bVar) return aVar < bVar ? -1 : 1;
    }
    const aKey = String(a.rom_name || a.id || '');
    const bKey = String(b.rom_name || b.id || '');
    return aKey.localeCompare(bKey);
  });

  const candidateReleases: CompanionDiscCandidateRow[] = [];
  if (platId) {
    const primaryIds = new Set(typedResults.map((r) => r.id));
    const distinctCrcs = new Set<string>(
      typedResults
        .map((r) => (r.rom_crc || '').trim())
        .filter((c) => c.length > 0),
    );
    const relatedIds = new Set(getRelatedGameIdsForCompanion(game));
    const relatedTitles = new Set(getRelatedGameTitlesForCompanion(game));
    const seenIds = new Set<string>();

    for (const r of releases) {
      const rid = String(r['id']);
      if (seenIds.has(rid)) continue;
      const parentGame = gameByStableId.get(Number(r['game_id']));
      if (!parentGame) continue;
      const crc = String(r['rom_crc'] || '').trim();
      const matchCrc = crc && distinctCrcs.has(crc) && !primaryIds.has(rid);
      const matchRelId = relatedIds.has(Number(r['game_id']));
      const matchTitle =
        Number(parentGame['platform_id']) === platId &&
        relatedTitles.has(String(parentGame['title'] || '')) &&
        Boolean(r['rom_name']);
      if (!matchCrc && !matchRelId && !matchTitle) continue;
      seenIds.add(rid);
      const ugr = userId ? userReleasesByReleaseId.get(rid) : undefined;
      candidateReleases.push({
        id: rid,
        game_id: Number(r['game_id']),
        region: (r['region'] as string | null) ?? null,
        variants: (r['variants'] as string | null) ?? null,
        also_released_as: (r['also_released_as'] as string | null) ?? null,
        rom_name: (r['rom_name'] as string | null) ?? null,
        rom_crc: (r['rom_crc'] as string | null) ?? null,
        has_media: ugr ? Number(ugr['has_media'] ?? 0) : 0,
        ownership_status: ugr ? Number(ugr['ownership_status'] ?? 0) : 0,
        release_date: (r['release_date'] as string | null) ?? null,
        has_case: ugr ? Number(ugr['has_case'] ?? 0) : 0,
        has_manual: ugr ? Number(ugr['has_manual'] ?? 0) : 0,
        game_title: String(parentGame['title'] || ''),
        platform_id: Number(parentGame['platform_id']),
      });
    }
  }

  const bundledRows = games
    .filter(
      (item) =>
        item['bundle_parent_id'] !== null &&
        item['bundle_parent_id'] !== undefined &&
        Number(item['bundle_parent_id']) === stableId,
    )
    .sort((a, b) => {
      const aDisc = Number(a['bundle_disc_number'] ?? 0);
      const bDisc = Number(b['bundle_disc_number'] ?? 0);
      if (aDisc !== bDisc) return aDisc - bDisc;
      return String(a['title'] || '').localeCompare(String(b['title'] || ''));
    })
    .map((bg) => {
      const bgPlatId = Number(bg['platform_id']);
      const bp = platformById.get(bgPlatId);
      const bpp =
        bp &&
        bp['parent_platform_id'] !== undefined &&
        bp['parent_platform_id'] !== null
          ? platformById.get(Number(bp['parent_platform_id']))
          : undefined;
      const effBp = bpp || bp;
      const rel = releases.find(
        (r) => Number(r['game_id']) === Number(bg['stable_id']),
      );
      const ugr =
        userId && rel
          ? userReleasesByReleaseId.get(String(rel['id']))
          : undefined;
      return {
        stable_id: Number(bg['stable_id']),
        id: bg['id'],
        title: bg['title'],
        platform_id: bgPlatId,
        bundle_disc_number: bg['bundle_disc_number'] ?? null,
        rom_name: rel?.['rom_name'] || bg['title'],
        has_media: ugr ? Number(ugr['has_media'] ?? 0) : 0,
        platform_name: effBp?.['display_name'] ?? null,
        platform: effBp?.['display_name'] ?? null,
      };
    });

  return finalizeGameDetailObject(
    game,
    typedResults,
    candidateReleases,
    bundledRows,
    homeRegion,
  );
}

function buildToysListFromSnapshot(
  snapshot: R2BackupSnapshot<SnapshotTables>,
  userId: number | null,
  homeRegion: string,
): Array<Record<string, unknown>> {
  const toys = snapshot.tables?.['toys'] || [];
  const toySeries = snapshot.tables?.['toy_series'] || [];
  const userToys = snapshot.tables?.['user_toys'] || [];

  const seriesById = new Map<string, Record<string, unknown>>();
  for (const s of toySeries) {
    seriesById.set(String(s['id']), s);
  }
  const userToysByToyId = new Map<string, Record<string, unknown>>();
  if (userId) {
    for (const ut of userToys) {
      if (Number(ut['user_id']) === userId) {
        userToysByToyId.set(String(ut['toy_id']), ut);
      }
    }
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const f of toys) {
    if (f['is_hidden'] === 1) continue;
    const fs =
      f['series_id'] !== undefined && f['series_id'] !== null
        ? seriesById.get(String(f['series_id']))
        : undefined;
    const ut = userId ? userToysByToyId.get(String(f['id'])) : undefined;
    const seriesName =
      (f['line'] === 'Skylanders' ? null : (f['series'] as string | null)) ??
      (fs?.['name'] as string | null) ??
      null;
    rows.push({
      ...f,
      retail_on_sale: Number(f['retail_on_sale'] ?? 0),
      ownership_status: ut ? Number(ut['ownership_status'] ?? 0) : 0,
      series_line: fs?.['line'] ?? null,
      series_name: seriesName,
      series_index: fs?.['sort_index'] ?? null,
    });
  }

  if (rows.length > 0) {
    postProcessToyListRows(rows, homeRegion);
  }
  return rows;
}

function buildToyDetailFromSnapshot(
  snapshot: R2BackupSnapshot<SnapshotTables>,
  id: string,
  userId: number | null,
): Record<string, unknown> | null {
  const toys = snapshot.tables?.['toys'] || [];
  const f = toys.find(
    (item) => String(item['id']) === id || String(item['stable_id']) === id,
  );
  if (!f) return null;

  const toySeries = snapshot.tables?.['toy_series'] || [];
  const userToys = snapshot.tables?.['user_toys'] || [];
  const fs =
    f['series_id'] !== undefined && f['series_id'] !== null
      ? toySeries.find((s) => String(s['id']) === String(f['series_id']))
      : undefined;
  const ut = userId
    ? userToys.find(
        (item) =>
          Number(item['user_id']) === userId &&
          String(item['toy_id']) === String(f['id']),
      )
    : undefined;
  const seriesName =
    (f['line'] === 'Skylanders' ? null : (f['series'] as string | null)) ??
    (fs?.['name'] as string | null) ??
    null;

  return {
    ...f,
    retail_on_sale: Number(f['retail_on_sale'] ?? 0),
    ownership_status: ut ? Number(ut['ownership_status'] ?? 0) : 0,
    series_line: fs?.['line'] ?? null,
    series_name: seriesName,
    series_index: fs?.['sort_index'] ?? null,
  };
}

function buildJournalEntriesFromSnapshot(
  snapshot: R2BackupSnapshot<SnapshotTables>,
  userId: number,
): Array<Record<string, unknown>> {
  const entries = snapshot.tables?.['journal_entries'] || [];
  return entries
    .filter((e) => Number(e['user_id']) === userId)
    .sort((a, b) =>
      String(b['updated_at'] || b['id'] || '').localeCompare(
        String(a['updated_at'] || a['id'] || ''),
      ),
    );
}

function findJournalEntryFromSnapshot(
  snapshot: R2BackupSnapshot<SnapshotTables>,
  userId: number,
  itemType: string,
  itemId: string,
): Record<string, unknown> | null {
  let canonicalId = itemId;
  if (itemType === 'game') {
    const rel = (snapshot.tables?.['game_releases'] || []).find(
      (r) => String(r['id']) === itemId,
    );
    if (rel && rel['game_id'] !== undefined && rel['game_id'] !== null) {
      canonicalId = String(rel['game_id']);
    } else {
      const g = (snapshot.tables?.['games'] || []).find(
        (item) =>
          String(item['id']) === itemId || String(item['stable_id']) === itemId,
      );
      if (g && g['stable_id'] !== undefined && g['stable_id'] !== null) {
        canonicalId = String(g['stable_id']);
      }
    }
  }
  const entries = snapshot.tables?.['journal_entries'] || [];
  return (
    entries.find(
      (e) =>
        Number(e['user_id']) === userId &&
        String(e['item_type'] || '') === itemType &&
        (String(e['item_id'] || '') === itemId ||
          String(e['item_id'] || '') === canonicalId),
    ) || null
  );
}

/**
 * Derives verifiable comma-separated region list and regional release dates JSON
 * from AmiiboAPI's `release` object (`{ na, eu, jp, au }`).
 */
export function resolveAmiiboRegionsAndMetadata(
  release?: {
    na?: string | null;
    eu?: string | null;
    jp?: string | null;
    au?: string | null;
  } | null,
  existingMetadataJson?: string | null,
): {
  region: string;
  defaultDate: string | null;
  metadataJson: string | null;
} {
  const regions: string[] = [];
  const releasesMap: Record<string, string> = {};

  if (release?.na) {
    regions.push('USA');
    releasesMap['USA'] = release.na;
  }
  if (release?.eu) {
    regions.push('Europe');
    releasesMap['Europe'] = release.eu;
  }
  if (release?.jp) {
    regions.push('Japan');
    releasesMap['Japan'] = release.jp;
  }
  if (release?.au) {
    regions.push('Australia');
    releasesMap['Australia'] = release.au;
  }

  const region = regions.length > 0 ? regions.join(', ') : 'USA';
  const defaultDate =
    release?.na || release?.jp || release?.eu || release?.au || null;

  let parsedMeta: Record<string, unknown> = {};
  if (existingMetadataJson) {
    try {
      const parsed = JSON.parse(existingMetadataJson);
      if (parsed && typeof parsed === 'object') {
        parsedMeta = parsed as Record<string, unknown>;
      }
    } catch {
      // Ignore malformed JSON
    }
  }

  if (Object.keys(releasesMap).length > 0) {
    parsedMeta['releases'] = releasesMap;
  }

  const metadataJson =
    Object.keys(parsedMeta).length > 0 ? JSON.stringify(parsedMeta) : null;

  return { region, defaultDate, metadataJson };
}

/**
 * A game's canonical_series may drive automatic series tracking only when it is backed by
 * IGDB metadata or curated rules, not when it is merely the game's own title.
 */
export function isSeriesTrackable(game: {
  title: string;
  collections?: string | null;
  franchises?: string | null;
}): boolean {
  const res = computeGameCanonicalSeriesWithSource({
    title: game.title,
    collections: game.collections ?? undefined,
    franchises: game.franchises ?? undefined,
  });
  if (res.source !== 'title_fallback') {
    return true;
  }
  // Allow numbered sequels and colon-subtitled entries (e.g. "Doom II" -> "Doom")
  // where the fallback series name differs from the bare edition-stripped title.
  const normTitle = normalizeTitleForMatching(
    stripEditionSuffix(game.title || ''),
  );
  const normSeries = normalizeTitleForMatching(res.series || '');
  return Boolean(normSeries && normTitle && normSeries !== normTitle);
}

/**
 * Reactive series auto-tracking:
 * When a user marks a game as Owned (1), Seeking (2), Ordered (3), or PrioritySeeking (4),
 * if the user has `auto_track_series_on_add = 1` (default) and the game's `canonical_series`
 * is not explicitly ignored (`is_ignored = 1`), this function:
 * 1. Upserts `(user_id, 'series', canonical_series)` into `user_tracking_rules` (tracking all future games).
 * 2. Marks all existing Unowned (0) games in that `canonical_series` (matching the user's home region) as Seeking (2).
 */
export async function applyReactiveSeriesAutoTracking(
  env: Env,
  userId: number,
  gameStableId: number,
  explicitCanonicalSeries?: string | null,
  options?: { notifySubscribers?: boolean },
): Promise<{ trackedSeries: string | null; autoAddedCount: number }> {
  try {
    let autoTrack = 1;
    let homeRegion = 'USA';
    let releaseScope: 'one_per_game' | 'all_releases' = 'one_per_game';
    let defaultRegionScope: 'home' | 'any' = 'home';
    try {
      const userRow = await env.DB.prepare(
        "SELECT COALESCE(auto_track_series_on_add, 1) as auto_track, COALESCE(home_region, 'USA') as home_region, COALESCE(auto_seek_release_scope, 'one_per_game') as auto_seek_release_scope, COALESCE(auto_seek_region_scope, 'home') as auto_seek_region_scope FROM users WHERE id = ?",
      )
        .bind(userId)
        .first<{
          auto_track: number;
          home_region: string;
          auto_seek_release_scope: string;
          auto_seek_region_scope: string;
        }>();
      if (userRow) {
        autoTrack = Number(userRow.auto_track ?? 1);
        homeRegion = userRow.home_region || 'USA';
        releaseScope = normalizeAutoSeekReleaseScope(
          userRow.auto_seek_release_scope,
        );
        defaultRegionScope = normalizeAutoSeekRegionScope(
          userRow.auto_seek_region_scope,
        );
      }
    } catch {
      try {
        const legacyUserRow = await env.DB.prepare(
          "SELECT COALESCE(auto_track_series_on_add, 1) as auto_track, COALESCE(home_region, 'USA') as home_region FROM users WHERE id = ?",
        )
          .bind(userId)
          .first<{ auto_track: number; home_region: string }>();
        if (legacyUserRow) {
          autoTrack = Number(legacyUserRow.auto_track ?? 1);
          homeRegion = legacyUserRow.home_region || 'USA';
        }
      } catch {
        // Fallback if columns are not yet present in unmigrated test DB
        const fallbackUser = await env.DB.prepare(
          'SELECT home_region FROM users WHERE id = ?',
        )
          .bind(userId)
          .first<{ home_region: string | null }>()
          .catch(() => null);
        if (fallbackUser?.home_region) {
          homeRegion = fallbackUser.home_region;
        }
      }
    }

    if (autoTrack === 0) {
      return { trackedSeries: null, autoAddedCount: 0 };
    }

    let canonicalSeries = explicitCanonicalSeries?.trim() || null;
    if (gameStableId > 0) {
      const gameRow = await env.DB.prepare(
        'SELECT title, collections, franchises, canonical_series FROM games WHERE stable_id = ?',
      )
        .bind(gameStableId)
        .first<{
          title: string | null;
          collections: string | null;
          franchises: string | null;
          canonical_series: string | null;
        }>();
      if (!canonicalSeries) {
        canonicalSeries = gameRow?.canonical_series?.trim() || null;
      }
      // Generic title-derived series (e.g. "Tennis", "Golf") are not real series identities;
      // never create follow rules from them.
      if (
        gameRow &&
        !isSeriesTrackable({
          title: gameRow.title || '',
          collections: gameRow.collections,
          franchises: gameRow.franchises,
        })
      ) {
        return { trackedSeries: null, autoAddedCount: 0 };
      }
    }

    if (!canonicalSeries) {
      return { trackedSeries: null, autoAddedCount: 0 };
    }

    // Check if user_tracking_rules table exists and whether this series is ignored
    let existingRule: {
      target_status: number;
      region_scope: string;
      is_ignored: number;
    } | null = null;
    try {
      existingRule = await env.DB.prepare(
        `SELECT target_status, region_scope, is_ignored
         FROM user_tracking_rules
         WHERE user_id = ? AND rule_type = 'series' AND match_value = ?`,
      )
        .bind(userId, canonicalSeries)
        .first<{
          target_status: number;
          region_scope: string;
          is_ignored: number;
        }>();
    } catch {
      // Table not created in unmigrated environment
      return { trackedSeries: null, autoAddedCount: 0 };
    }

    if (existingRule && Number(existingRule.is_ignored) === 1) {
      return { trackedSeries: null, autoAddedCount: 0 };
    }

    const targetStatus = existingRule?.target_status || 2;
    const regionScope = existingRule?.region_scope || defaultRegionScope;

    if (!existingRule) {
      await env.DB.prepare(
        `INSERT INTO user_tracking_rules (user_id, rule_type, match_value, target_status, region_scope, is_ignored)
         VALUES (?, 'series', ?, 2, ?, 0)
         ON CONFLICT(user_id, rule_type, match_value) DO NOTHING`,
      )
        .bind(userId, canonicalSeries, defaultRegionScope)
        .run();
    }

    // Find all sibling games in this canonical_series and their releases
    const { results: seriesReleases } = await env.DB.prepare(
      `SELECT g.stable_id, g.id as game_slug, g.platform_id, g.title, g.collections, g.franchises,
              r.id as release_id, COALESCE(r.region, g.region) as region, r.variants, r.rom_name,
              COALESCE(ugr.ownership_status, 0) as ownership_status
       FROM games g
       JOIN game_releases r ON r.game_id = g.stable_id
       LEFT JOIN user_game_releases ugr ON ugr.release_id = r.id AND ugr.user_id = ?
       WHERE g.canonical_series = ?
       ORDER BY g.stable_id ASC, CASE WHEN r.variants IS NULL OR r.variants = '' THEN 0 ELSE 1 END ASC, r.id ASC`,
    )
      .bind(userId, canonicalSeries)
      .all<{
        stable_id: number;
        game_slug: string | null;
        platform_id: number | null;
        title: string | null;
        collections: string | null;
        franchises: string | null;
        release_id: string;
        region: string | null;
        variants: string | null;
        rom_name: string | null;
        ownership_status: number;
      }>();

    const untrackableGames = new Set<number>();
    const gameMetaById = new Map<
      number,
      { gameSlug: string; platformId: number | null; title: string }
    >();
    const byGame = new Map<
      number,
      Array<{
        release_id: string;
        region: string | null;
        variants: string | null;
        rom_name: string | null;
        ownership_status: number;
      }>
    >();
    for (const row of seriesReleases || []) {
      let list = byGame.get(row.stable_id);
      if (!list) {
        list = [];
        byGame.set(row.stable_id, list);
        gameMetaById.set(row.stable_id, {
          gameSlug: row.game_slug || row.release_id,
          platformId: row.platform_id ?? null,
          title: row.title || canonicalSeries,
        });
        if (
          !isSeriesTrackable({
            title: row.title || '',
            collections: row.collections,
            franchises: row.franchises,
          })
        ) {
          untrackableGames.add(row.stable_id);
        }
      }
      list.push(row);
    }

    const statements: D1PreparedStatement[] = [];
    const addedItems: Array<{ stableId: number; releaseId: string }> = [];
    for (const [stableId, rels] of byGame.entries()) {
      if (stableId === gameStableId) continue;
      // Siblings that only share a generic title-derived series are not real series members
      if (untrackableGames.has(stableId)) continue;

      const meta = gameMetaById.get(stableId);
      const matchingRels = rels.filter(
        (r) =>
          !isPackInCompanionDemoRom(meta?.platformId ?? null, r.rom_name) &&
          (regionScope === 'any' || isRegionMatchingHome(r.region, homeRegion)),
      );

      if (matchingRels.length === 0) continue;

      if (releaseScope === 'one_per_game') {
        // Skip if user already has any positive status (Owned=1, Seeking=2, Ordered=3, PrioritySeeking=4) on any release of this game
        if (rels.some((r) => Number(r.ownership_status) > 0)) {
          continue;
        }
        const chosen = matchingRels[0];
        statements.push(
          env.DB.prepare(
            `INSERT INTO user_game_releases (user_id, release_id, ownership_status, has_media)
             VALUES (?, ?, ?, 0)
             ON CONFLICT(user_id, release_id) DO UPDATE SET
               ownership_status = excluded.ownership_status
             WHERE user_game_releases.ownership_status = 0`,
          ).bind(userId, chosen.release_id, targetStatus),
        );
        addedItems.push({ stableId, releaseId: chosen.release_id });
      } else {
        for (const chosen of matchingRels) {
          if (Number(chosen.ownership_status) > 0) continue;
          statements.push(
            env.DB.prepare(
              `INSERT INTO user_game_releases (user_id, release_id, ownership_status, has_media)
               VALUES (?, ?, ?, 0)
               ON CONFLICT(user_id, release_id) DO UPDATE SET
                 ownership_status = excluded.ownership_status
               WHERE user_game_releases.ownership_status = 0`,
            ).bind(userId, chosen.release_id, targetStatus),
          );
          addedItems.push({ stableId, releaseId: chosen.release_id });
        }
      }
    }

    if (statements.length > 0) {
      for (let i = 0; i < statements.length; i += 100) {
        await env.DB.batch(statements.slice(i, i + 100));
      }
      if (options?.notifySubscribers && addedItems.length > 0) {
        const { byId: platformById } = await loadPlatformLookupMaps(env);
        const uniqueAlertsByGame = new Map<number, WatchedSeriesAlertItem>();
        for (const added of addedItems) {
          if (uniqueAlertsByGame.has(added.stableId)) continue;
          const meta = gameMetaById.get(added.stableId);
          const platformName =
            meta?.platformId != null
              ? (platformById.get(meta.platformId)?.displayName ?? null)
              : null;
          uniqueAlertsByGame.set(added.stableId, {
            userId,
            itemType: 'game',
            itemId: String(added.stableId),
            title: meta?.title || canonicalSeries,
            series: canonicalSeries,
            platformName,
          });
        }
        await dispatchWatchedSeriesNotifications(
          env,
          Array.from(uniqueAlertsByGame.values()),
        );
      }
    }

    return {
      trackedSeries: canonicalSeries,
      autoAddedCount: statements.length,
    };
  } catch (err) {
    console.warn(
      '[AutoTrackSeries] Error applying reactive series tracking:',
      err,
    );
    return { trackedSeries: null, autoAddedCount: 0 };
  }
}

/**
 * When periodic IGDB sync or metadata backfill links a previously standalone game
 * into a trackable series (e.g., via a sequel), promote any user's active tracking
 * on that game into a series rule and auto-add sibling Seeking rows.
 */
export async function promoteNewlyTrackableOwnedGames(
  env: Env,
  candidates: Array<{ stableId: number; canonicalSeries: string }>,
): Promise<number> {
  if (!candidates || candidates.length === 0) return 0;

  const seriesByStableId = new Map<number, string>();
  for (const candidate of candidates) {
    const trimmed = candidate.canonicalSeries?.trim();
    if (trimmed) {
      seriesByStableId.set(candidate.stableId, trimmed);
    }
  }
  const uniqueIds = Array.from(seriesByStableId.keys());
  if (uniqueIds.length === 0) return 0;

  let promotedAutoAddedCount = 0;
  try {
    const seenUserSeries = new Set<string>();
    for (let i = 0; i < uniqueIds.length; i += 80) {
      const chunk = uniqueIds.slice(i, i + 80);
      const ph = chunk.map(() => '?').join(',');
      const { results } = await env.DB.prepare(
        `SELECT DISTINCT ugr.user_id, r.game_id
         FROM game_releases r
         JOIN user_game_releases ugr ON ugr.release_id = r.id
         WHERE r.game_id IN (${ph}) AND ugr.ownership_status > 0`,
      )
        .bind(...chunk)
        .all<{ user_id: number; game_id: number }>();

      for (const row of results || []) {
        const series = seriesByStableId.get(row.game_id);
        if (!series) continue;
        const userSeriesKey = `${row.user_id}::${series}`;
        if (seenUserSeries.has(userSeriesKey)) continue;
        seenUserSeries.add(userSeriesKey);

        const res = await applyReactiveSeriesAutoTracking(
          env,
          row.user_id,
          row.game_id,
          series,
          { notifySubscribers: true },
        );
        promotedAutoAddedCount += res.autoAddedCount;
      }
    }
  } catch {
    // Ignore when release or tracking rule tables are absent in minimal test schemas
  }
  return promotedAutoAddedCount;
}

/**
 * Resets Seeking (2) user_game_releases back to None (0) for every game
 * assigned to a given canonical series when ignoring or removing a series rule.
 */
async function clearSeekingReleasesForSeries(
  env: Env,
  userId: number,
  canonicalSeries: string,
): Promise<number> {
  const clearRes = await env.DB.prepare(
    `UPDATE user_game_releases
     SET ownership_status = 0
     WHERE user_id = ?
       AND ownership_status = 2
       AND release_id IN (
         SELECT r.id FROM game_releases r
         JOIN games g ON g.stable_id = r.game_id
         WHERE g.canonical_series = ?
       )`,
  )
    .bind(userId, canonicalSeries)
    .run();
  return Number(clearRes.meta?.changes || 0);
}

/**
 * Evaluates active `user_tracking_rules` (series and platform rules) for newly added games
 * and automatically marks matching releases as Seeking (2) or PrioritySeeking (4).
 */
function slugifySegment(value: string): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const NON_GAME_MERCH_REGEX =
  /\b(soundtrack|vinyl|record\s+lp|ost|art\s*book|plush|pin\s+set|apparel|t-shirt|hoodie|poster|strategy\s+guide|card\s+sleeve|slipcase|controller|charging\s+(?:dock|station|grip|cable)|carrying\s+case|memory\s+card|microsd|headset|gift\s+card|console\s+bundle|screen\s+protector|amiibo\s+card|adapter)\b/i;

function isLikelyNonGameMerchTitle(title: string): boolean {
  return NON_GAME_MERCH_REGEX.test(title || '');
}

async function sendWebPushPayloadsToSubscriber(
  env: Env,
  endpoint: string,
  p256dh: string,
  auth: string,
  payloads: WebPushNotificationPayload[],
): Promise<{ dispatchedCount: number; purged: boolean }> {
  let dispatchedCount = 0;
  let purged = false;
  for (const payload of payloads) {
    const result = await sendWebPushNotification(
      { endpoint, p256dh, auth },
      payload,
      {
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
        subject: resolveVapidSubject(undefined, undefined, env.ADMIN_EMAIL),
        fetchFn: fetch,
      },
    );
    if (result.success) {
      dispatchedCount++;
    } else if (result.shouldDelete) {
      await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')
        .bind(endpoint)
        .run();
      purged = true;
      break;
    }
  }
  return { dispatchedCount, purged };
}

interface CatalogPlatformLookupEntry {
  id: number;
  igdbId: number | null;
  name: string;
  displayName: string;
  launchDate: string | null;
  parentPlatformId: number | null;
}

async function loadPlatformLookupMaps(env: Env): Promise<{
  byId: Map<number, CatalogPlatformLookupEntry>;
  byIgdbId: Map<number, CatalogPlatformLookupEntry>;
}> {
  const byId = new Map<number, CatalogPlatformLookupEntry>();
  const byIgdbId = new Map<number, CatalogPlatformLookupEntry>();
  try {
    const { results } = await env.DB.prepare(
      'SELECT id, igdb_id, name, display_name, launch_date, parent_platform_id FROM platforms',
    ).all<{
      id: number;
      igdb_id: number | null;
      name: string;
      display_name: string | null;
      launch_date: string | null;
      parent_platform_id: number | null;
    }>();
    for (const row of results || []) {
      const entry: CatalogPlatformLookupEntry = {
        id: row.id,
        igdbId: row.igdb_id ?? null,
        name: row.name,
        displayName: row.display_name || row.name,
        launchDate: row.launch_date ?? null,
        parentPlatformId: row.parent_platform_id ?? null,
      };
      byId.set(entry.id, entry);
      if (
        normalizeLegacyPlatformId(entry.id) === entry.id &&
        entry.igdbId &&
        entry.igdbId > 0 &&
        !byIgdbId.has(entry.igdbId)
      ) {
        byIgdbId.set(entry.igdbId, entry);
      }
    }
  } catch {
    // Minimal test schemas may omit igdb_id or parent_platform_id
  }
  if (byId.size === 0) {
    try {
      const { results } = await env.DB.prepare(
        'SELECT id, name, display_name FROM platforms',
      ).all<{
        id: number;
        name: string;
        display_name?: string | null;
      }>();
      for (const row of results || []) {
        const displayName = row.display_name || row.name;
        const igdbId =
          PLATFORM_MAP[displayName] ?? PLATFORM_MAP[row.name] ?? null;
        const entry: CatalogPlatformLookupEntry = {
          id: row.id,
          igdbId: typeof igdbId === 'number' ? igdbId : null,
          name: row.name,
          displayName,
          launchDate: null,
          parentPlatformId: null,
        };
        byId.set(entry.id, entry);
        if (
          normalizeLegacyPlatformId(entry.id) === entry.id &&
          entry.igdbId &&
          entry.igdbId > 0 &&
          !byIgdbId.has(entry.igdbId)
        ) {
          byIgdbId.set(entry.igdbId, entry);
        }
      }
    } catch {
      // Minimal test schemas may omit the platforms table
    }
  }
  registerIgdbAliasPlatforms(byIgdbId);
  return { byId, byIgdbId };
}

async function allocateNextGameStableId(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COALESCE(MAX(stable_id), 0) AS max_id FROM games',
  ).first<{ max_id: number }>();
  return Number(row?.max_id ?? 0) + 1;
}

function nextSequentialReleaseId(
  gameStableId: number,
  existingIds: Iterable<string>,
): string {
  let maxSeq = 0;
  const prefix = `${gameStableId}-`;
  for (const existingId of existingIds) {
    if (!existingId.startsWith(prefix)) continue;
    const tail = existingId.slice(prefix.length);
    if (/^\d+$/.test(tail)) {
      const seq = Number(tail);
      if (seq > maxSeq) maxSeq = seq;
    }
  }
  const nextId = `${prefix}${maxSeq + 1}`;
  if (existingIds instanceof Set) {
    existingIds.add(nextId);
  }
  return nextId;
}

async function ensureCanonicalReleaseForRetailOrBoutique(
  env: Env,
  params: {
    platformId: number;
    rawTitle: string;
    region?: string | null;
    variants?: string | null;
    barcode?: string | null;
    publisher: string;
    source: 'retail_catalog' | 'lgn';
  },
): Promise<{
  id: number;
  source: 'retail_catalog' | 'lgn';
  rawTitle: string;
  publisher: string;
} | null> {
  const cleanTitle = (params.rawTitle || '').trim();
  const normalizedTitle = normalizeTitleForMatching(cleanTitle);
  if (!cleanTitle || !normalizedTitle || !params.platformId) {
    return null;
  }
  const region = (params.region || 'USA').trim() || 'USA';
  const variants = params.variants ?? null;

  try {
    const existing = await env.DB.prepare(
      `SELECT id, source, raw_title, publisher
       FROM canonical_releases
       WHERE platform_id = ?
         AND source = ?
         AND normalized_title = ?
         AND region IS ?
         AND variants IS ?
       LIMIT 1`,
    )
      .bind(params.platformId, params.source, normalizedTitle, region, variants)
      .first<{
        id: number;
        source: string;
        raw_title: string;
        publisher: string | null;
      }>();

    if (existing && Number.isFinite(existing.id) && existing.id > 0) {
      return {
        id: existing.id,
        source: existing.source === 'lgn' ? 'lgn' : 'retail_catalog',
        rawTitle: existing.raw_title || cleanTitle,
        publisher: existing.publisher ?? params.publisher,
      };
    }

    const inserted = await env.DB.prepare(
      `INSERT INTO canonical_releases (
         platform_id, raw_title, normalized_title, region, variants,
         barcode, publisher, source, is_verified_physical
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
       RETURNING id`,
    )
      .bind(
        params.platformId,
        cleanTitle,
        normalizedTitle,
        region,
        variants,
        params.barcode ?? null,
        params.publisher,
        params.source,
      )
      .first<{ id: number }>();

    const insertedId = inserted?.id ?? null;
    if (insertedId && Number.isFinite(insertedId) && insertedId > 0) {
      return {
        id: insertedId,
        source: params.source,
        rawTitle: cleanTitle,
        publisher: params.publisher,
      };
    }
  } catch {
    // Graceful fallback for minimal test schemas without canonical_releases
  }
  return null;
}

async function insertCatalogGameWithReleases(
  env: Env,
  params: {
    title: string;
    platformId: number;
    platformSlugHint?: string;
    region: string;
    canonicalSeries: string | null;
    barcode?: string | null;
    igdbMeta?: IgdbGameMeta | null;
    imageUrlFallback?: string | null;
    retailPriceCents?: number | null;
    retailRegularPriceCents?: number | null;
    retailDiscountPct?: number;
    retailOnSale?: number;
    retailStore?: string | null;
    retailUrl?: string | null;
    retailUpdatedAt?: string | null;
    usedSlugs: Set<string>;
    releases: Array<{
      slugSuffix: string;
      region?: string | null;
      variants?: string | null;
      romName?: string | null;
      romCrc?: string | null;
      releaseDate?: string | null;
      canonicalReleaseId?: number | null;
      barcode?: string | null;
      verifiedSource?: string | null;
      serialCode?: string | null;
      canonicalTitle?: string | null;
      publisher?: string | null;
    }>;
  },
): Promise<{
  stableId: number;
  gameSlug: string;
  insertedReleases: Array<{ id: string; region: string | null }>;
} | null> {
  const canonicalTitle = resolveCanonicalDisplayTitle(
    params.title,
    params.igdbMeta?.name,
  );
  let stableId = await allocateNextGameStableId(env);
  let gameSlug = String(stableId);
  let inserted = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    gameSlug = String(stableId);
    try {
      await env.DB.prepare(
        `INSERT INTO games (
           stable_id, id, title, platform_id, region,
           manually_verified,
           canonical_series, barcode, igdb_id, igdb_url, image_url, summary, genres,
           collections, franchises, metadata_json,
           retail_price, retail_regular_price, retail_discount_pct, retail_on_sale,
           retail_store, retail_url, retail_updated_at
         ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          stableId,
          gameSlug,
          canonicalTitle,
          params.platformId,
          params.region || 'USA',
          params.canonicalSeries ?? null,
          params.barcode ?? null,
          params.igdbMeta?.igdb_id ?? null,
          params.igdbMeta?.igdb_url ?? null,
          params.igdbMeta?.image_url ?? params.imageUrlFallback ?? null,
          params.igdbMeta?.summary ?? null,
          params.igdbMeta?.genres ?? null,
          params.igdbMeta?.collections ?? null,
          params.igdbMeta?.franchises ?? null,
          params.igdbMeta?.metadata_json ?? null,
          params.retailPriceCents ?? null,
          params.retailRegularPriceCents ?? null,
          params.retailDiscountPct ?? 0,
          params.retailOnSale ?? 0,
          params.retailStore ?? null,
          params.retailUrl ?? null,
          params.retailUpdatedAt ?? null,
        )
        .run();
      inserted = true;
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/UNIQUE constraint failed/i.test(msg) && attempt < 2) {
        stableId = (await allocateNextGameStableId(env)) + attempt + 1;
        continue;
      }
      throw err;
    }
  }
  if (!inserted) return null;
  params.usedSlugs.add(gameSlug);

  const insertedReleases: Array<{
    id: string;
    region: string | null;
    variants?: string | null;
    romName?: string | null;
  }> = [];
  const relStatements: D1PreparedStatement[] = [];
  const seenCanonicalIds = new Set<number>();
  for (let i = 0; i < params.releases.length; i++) {
    const rel = params.releases[i];
    if (rel.canonicalReleaseId != null) {
      if (seenCanonicalIds.has(rel.canonicalReleaseId)) continue;
      seenCanonicalIds.add(rel.canonicalReleaseId);
    }
    const relId = `${stableId}-${i + 1}`;
    const relRegion = rel.region ?? params.region ?? 'USA';
    insertedReleases.push({
      id: relId,
      region: relRegion,
      variants: rel.variants ?? null,
      romName: rel.romName ?? null,
    });
    relStatements.push(
      env.DB.prepare(
        `INSERT INTO game_releases (
           id, game_id, region, variants, rom_name, rom_crc, release_date, canonical_release_id, barcode,
           verified_source, serial_code, canonical_title, publisher
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,
      ).bind(
        relId,
        stableId,
        relRegion,
        rel.variants ?? null,
        rel.romName ?? null,
        rel.romCrc ?? null,
        rel.releaseDate ?? null,
        rel.canonicalReleaseId ?? null,
        rel.barcode ?? null,
        rel.verifiedSource ?? null,
        rel.serialCode ?? null,
        rel.canonicalTitle ?? null,
        rel.publisher ?? null,
      ),
    );
  }
  if (relStatements.length > 0) {
    await env.DB.batch(relStatements);
  }
  return { stableId, gameSlug, insertedReleases };
}

export interface WatchedSeriesAlertItem {
  userId: number;
  itemType: 'game' | 'toy';
  itemId: string;
  title: string;
  series: string;
  platformName?: string | null;
}

/**
 * Dispatches Web Push notifications when autonomous ingestion adds new games or toys
 * matching users' active watched series rules (`notify_watched_series !== false`).
 * Coalesces when > 3 items match for a subscriber in one run.
 */
export async function dispatchWatchedSeriesNotifications(
  env: Env,
  matchedItems: WatchedSeriesAlertItem[],
): Promise<{ dispatchedCount: number; purgedCount: number }> {
  if (!matchedItems || matchedItems.length === 0) {
    return { dispatchedCount: 0, purgedCount: 0 };
  }

  let dispatchedCount = 0;
  let purgedCount = 0;
  const byUser = new Map<number, WatchedSeriesAlertItem[]>();
  for (const item of matchedItems) {
    let list = byUser.get(item.userId);
    if (!list) {
      list = [];
      byUser.set(item.userId, list);
    }
    list.push(item);
  }

  try {
    const subRows = await env.DB.prepare(
      `SELECT COALESCE(user_id, 1) as user_id, endpoint, p256dh, auth, preferences_json FROM push_subscriptions`,
    ).all<{
      user_id: number;
      endpoint: string;
      p256dh: string;
      auth: string;
      preferences_json: string | null;
    }>();

    const subscriptions = subRows.results || [];
    if (subscriptions.length === 0) {
      return { dispatchedCount: 0, purgedCount: 0 };
    }

    for (const sub of subscriptions) {
      const subUserId = sub.user_id || 1;
      const userItems = byUser.get(subUserId);
      if (!userItems || userItems.length === 0) continue;

      let prefs: Partial<DealNotificationPreferences> = {};
      try {
        if (sub.preferences_json) {
          prefs = JSON.parse(sub.preferences_json);
        }
      } catch {
        // Use defaults on malformed preferences JSON
      }
      if (prefs.enabled === false || prefs.notify_watched_series === false) {
        continue;
      }

      const payloadsToSend: WebPushNotificationPayload[] = [];
      if (userItems.length > 3) {
        const top = userItems[0];
        payloadsToSend.push({
          title: `✨ ${userItems.length} New Watched Series Additions`,
          body: `${top.title} (${top.series}) & ${userItems.length - 1} more added to your Seeking list.`,
          icon: '/icons/icon-192.png',
          badge: '/icons/badge-96.png',
          data: {
            url:
              top.itemType === 'toy' ? '/collection/toys' : '/collection/games',
          },
        });
      } else {
        for (const item of userItems) {
          payloadsToSend.push({
            title: `✨ New in ${item.series || 'Watched Series'}: ${item.title}`,
            body: `Added to your Seeking list${item.platformName ? ` (${item.platformName})` : ''}.`,
            icon: '/icons/icon-192.png',
            badge: '/icons/badge-96.png',
            data: {
              url:
                item.itemType === 'toy'
                  ? `/collection/toy/${item.itemId}`
                  : `/game/${item.itemId}`,
            },
          });
        }
      }

      const sendRes = await sendWebPushPayloadsToSubscriber(
        env,
        sub.endpoint,
        sub.p256dh,
        sub.auth,
        payloadsToSend,
      );
      dispatchedCount += sendRes.dispatchedCount;
      if (sendRes.purged) purgedCount++;
    }
  } catch (err) {
    console.warn('[WorkerPush] Failed to dispatch watched series alerts:', err);
  }

  return { dispatchedCount, purgedCount };
}

/**
 * Evaluates active `user_tracking_rules` (series and platform rules) for newly added games
 * and automatically marks matching home-region releases as Seeking (2) or PrioritySeeking (4)
 * for each user without overwriting already-owned/ordered entries (`ownership_status = 0` guard).
 */
export async function evaluateTrackingRulesForNewGames(
  env: Env,
  newGames: Array<{
    stableId: number;
    platformId: number;
    canonicalSeries?: string | null;
    /** false when canonicalSeries is only the game's own title (must not match series rules) */
    seriesTrackable?: boolean;
    title?: string;
    platformName?: string | null;
    gameSlug?: string;
    releases: Array<{
      id: string;
      region: string | null;
      variants?: string | null;
      romName?: string | null;
    }>;
  }>,
  options?: { notifySubscribers?: boolean },
): Promise<number> {
  if (!newGames || newGames.length === 0) return 0;
  try {
    let rules: Array<{
      user_id: number;
      rule_type: 'series' | 'platform';
      match_value: string;
      target_status: number;
      region_scope: string;
      home_region: string;
      auto_seek_release_scope?: string | null;
    }> = [];
    try {
      const { results: ruleRows } = await env.DB.prepare(
        `SELECT r.user_id, r.rule_type, r.match_value, r.target_status, r.region_scope,
                COALESCE(u.home_region, 'USA') as home_region,
                COALESCE(u.auto_seek_release_scope, 'one_per_game') as auto_seek_release_scope
         FROM users u
         CROSS JOIN user_tracking_rules r
         WHERE u.id > 0 AND r.user_id = u.id AND r.is_ignored = 0 AND r.rule_type IN ('series', 'platform')`,
      ).all<{
        user_id: number;
        rule_type: 'series' | 'platform';
        match_value: string;
        target_status: number;
        region_scope: string;
        home_region: string;
        auto_seek_release_scope: string;
      }>();
      rules = ruleRows || [];
    } catch {
      const { results: ruleRows } = await env.DB.prepare(
        `SELECT r.user_id, r.rule_type, r.match_value, r.target_status, r.region_scope,
                COALESCE(u.home_region, 'USA') as home_region
         FROM users u
         CROSS JOIN user_tracking_rules r
         WHERE u.id > 0 AND r.user_id = u.id AND r.is_ignored = 0 AND r.rule_type IN ('series', 'platform')`,
      ).all<{
        user_id: number;
        rule_type: 'series' | 'platform';
        match_value: string;
        target_status: number;
        region_scope: string;
        home_region: string;
      }>();
      rules = ruleRows || [];
    }

    if (rules.length === 0) return 0;

    const fallbackPlatformById = newGames.some((g) => !g.platformName)
      ? (await loadPlatformLookupMaps(env)).byId
      : null;

    const pendingPairs: Array<{
      userId: number;
      gameStableId: number;
      releaseId: string;
      targetStatus: number;
      releaseScope: 'one_per_game' | 'all_releases';
      allGameReleaseIds: string[];
      matchedSeriesName: string | null;
      itemTitle: string;
      itemSlug: string;
      platformName: string | null;
    }> = [];
    for (const game of newGames) {
      if (!game.releases || game.releases.length === 0) continue;
      const seriesLower =
        game.seriesTrackable === false
          ? ''
          : (game.canonicalSeries || '').trim().toLowerCase();
      const platStr = String(game.platformId);

      // Group matching rules by user_id (taking highest target_status if both series & platform match)
      const matchedByUser = new Map<
        number,
        {
          targetStatus: number;
          regionScope: string;
          homeRegion: string;
          releaseScope: 'one_per_game' | 'all_releases';
          matchedSeriesName: string | null;
        }
      >();

      for (const rule of rules) {
        const valLower = rule.match_value.trim().toLowerCase();
        const matchedSeries =
          rule.rule_type === 'series' &&
          Boolean(seriesLower) &&
          valLower === seriesLower;
        const matchedPlatform =
          rule.rule_type === 'platform' && valLower === platStr;

        if (matchedSeries || matchedPlatform) {
          const prev = matchedByUser.get(rule.user_id);
          const seriesName = matchedSeries
            ? rule.match_value.trim()
            : (prev?.matchedSeriesName ?? null);
          if (!prev || rule.target_status > prev.targetStatus) {
            matchedByUser.set(rule.user_id, {
              targetStatus: rule.target_status || 2,
              regionScope: rule.region_scope || 'home',
              homeRegion: rule.home_region || 'USA',
              releaseScope: normalizeAutoSeekReleaseScope(
                rule.auto_seek_release_scope,
              ),
              matchedSeriesName: seriesName,
            });
          } else if (matchedSeries && !prev.matchedSeriesName) {
            prev.matchedSeriesName = rule.match_value.trim();
          }
        }
      }

      const fallbackPlatName =
        game.platformName ??
        fallbackPlatformById?.get(game.platformId)?.displayName ??
        null;
      const allGameReleaseIds = game.releases.map((r) => r.id);
      for (const [userId, match] of matchedByUser.entries()) {
        const candidateRels = game.releases.filter(
          (r) =>
            !isPackInCompanionDemoRom(game.platformId, r.romName) &&
            (match.regionScope === 'any' ||
              match.regionScope === 'all' ||
              isRegionMatchingHome(r.region, match.homeRegion) ||
              (match.homeRegion === 'USA' && r.region === 'World')),
        );
        if (candidateRels.length === 0) continue;

        let targetRels: typeof candidateRels;
        if (match.releaseScope === 'all_releases') {
          targetRels = candidateRels;
        } else {
          const sorted = [...candidateRels].sort(
            (a, b) =>
              (a.variants && a.variants.trim() ? 1 : 0) -
              (b.variants && b.variants.trim() ? 1 : 0),
          );
          targetRels = [sorted[0]];
        }

        for (const targetRel of targetRels) {
          pendingPairs.push({
            userId,
            gameStableId: game.stableId,
            releaseId: targetRel.id,
            targetStatus: match.targetStatus,
            releaseScope: match.releaseScope,
            allGameReleaseIds,
            matchedSeriesName: match.matchedSeriesName,
            itemTitle:
              game.title ||
              game.canonicalSeries ||
              match.matchedSeriesName ||
              targetRel.id,
            itemSlug: String(game.stableId),
            platformName: fallbackPlatName,
          });
        }
      }
    }

    const pairsByUser = new Map<number, typeof pendingPairs>();
    for (const p of pendingPairs) {
      let list = pairsByUser.get(p.userId);
      if (!list) {
        list = [];
        pairsByUser.set(p.userId, list);
      }
      list.push(p);
    }

    const pairsToWrite: typeof pendingPairs = [];
    const watchedAlerts: WatchedSeriesAlertItem[] = [];
    const seenAlertGameKeys = new Set<string>();
    for (const [uid, pairs] of pairsByUser.entries()) {
      const releaseIdsToCheck = new Set<string>();
      for (const p of pairs) {
        releaseIdsToCheck.add(p.releaseId);
        if (p.releaseScope === 'one_per_game') {
          for (const rid of p.allGameReleaseIds) {
            releaseIdsToCheck.add(rid);
          }
        }
      }
      const uniqueReleaseIds = Array.from(releaseIdsToCheck);
      const existingStatusByRel = new Map<string, number>();
      for (let i = 0; i < uniqueReleaseIds.length; i += 80) {
        const chunkIds = uniqueReleaseIds.slice(i, i + 80);
        const ph = chunkIds.map(() => '?').join(',');
        const existingRows = await env.DB.prepare(
          `SELECT release_id, ownership_status FROM user_game_releases WHERE user_id = ? AND release_id IN (${ph})`,
        )
          .bind(uid, ...chunkIds)
          .all<{ release_id: string; ownership_status: number }>();
        for (const row of existingRows.results || []) {
          existingStatusByRel.set(row.release_id, row.ownership_status);
        }
      }
      const queuedOnePerGame = new Set<number>();
      for (const p of pairs) {
        if (p.releaseScope === 'one_per_game') {
          if (queuedOnePerGame.has(p.gameStableId)) continue;
          const hasAnyActive = p.allGameReleaseIds.some(
            (rid) => (existingStatusByRel.get(rid) ?? 0) > 0,
          );
          if (hasAnyActive) continue;
          queuedOnePerGame.add(p.gameStableId);
        } else {
          const existingStatus = existingStatusByRel.get(p.releaseId);
          if (existingStatus !== undefined && existingStatus !== 0) {
            continue;
          }
        }
        pairsToWrite.push(p);
        if (options?.notifySubscribers && p.matchedSeriesName) {
          const alertKey = `${uid}::${p.itemSlug}`;
          if (!seenAlertGameKeys.has(alertKey)) {
            seenAlertGameKeys.add(alertKey);
            watchedAlerts.push({
              userId: uid,
              itemType: 'game',
              itemId: p.itemSlug,
              title: p.itemTitle,
              series: p.matchedSeriesName,
              platformName: p.platformName,
            });
          }
        }
      }
    }

    const statements = pairsToWrite.map((p) =>
      env.DB.prepare(
        `INSERT INTO user_game_releases (user_id, release_id, ownership_status, has_media)
         VALUES (?, ?, ?, 0)
         ON CONFLICT(user_id, release_id) DO UPDATE SET
           ownership_status = excluded.ownership_status
         WHERE user_game_releases.ownership_status = 0`,
      ).bind(p.userId, p.releaseId, p.targetStatus),
    );

    if (statements.length > 0) {
      for (let i = 0; i < statements.length; i += 100) {
        await env.DB.batch(statements.slice(i, i + 100));
      }
    }
    if (options?.notifySubscribers && watchedAlerts.length > 0) {
      await dispatchWatchedSeriesNotifications(env, watchedAlerts);
    }
    return statements.length;
  } catch {
    return 0;
  }
}

/**
 * Evaluates active `user_tracking_rules` (toy_line and toy_series rules) for newly added toys
 * and automatically marks matching toys as Seeking (2) or PrioritySeeking (4).
 */
export async function evaluateTrackingRulesForNewToys(
  env: Env,
  newToys: Array<{
    id: string;
    line: string;
    series: string;
    region: string | null;
    name?: string;
  }>,
  options?: { notifySubscribers?: boolean },
): Promise<number> {
  if (!newToys || newToys.length === 0) return 0;
  try {
    const { results: ruleRows } = await env.DB.prepare(
      `SELECT r.user_id, r.rule_type, r.match_value, r.target_status, r.region_scope,
              COALESCE(u.home_region, 'USA') as home_region
       FROM users u
       CROSS JOIN user_tracking_rules r
       WHERE u.id > 0 AND r.user_id = u.id AND r.is_ignored = 0 AND r.rule_type IN ('toy_line', 'toy_series')`,
    ).all<{
      user_id: number;
      rule_type: 'toy_line' | 'toy_series';
      match_value: string;
      target_status: number;
      region_scope: string;
      home_region: string;
    }>();

    const rules = ruleRows || [];
    if (rules.length === 0) return 0;

    const pendingPairs: Array<{
      userId: number;
      toyId: string;
      targetStatus: number;
      matchedSeriesName: string | null;
      itemName: string;
    }> = [];
    for (const toy of newToys) {
      const lineLower = (toy.line || '').trim().toLowerCase();
      const seriesLower = (toy.series || '').trim().toLowerCase();

      const matchedByUser = new Map<
        number,
        {
          targetStatus: number;
          regionScope: string;
          homeRegion: string;
          matchedSeriesName: string | null;
        }
      >();

      for (const rule of rules) {
        const valLower = rule.match_value.trim().toLowerCase();
        const matchedLine =
          rule.rule_type === 'toy_line' &&
          Boolean(lineLower) &&
          valLower === lineLower;
        const matchedSeries =
          rule.rule_type === 'toy_series' &&
          Boolean(seriesLower) &&
          valLower === seriesLower;

        if (matchedLine || matchedSeries) {
          const prev = matchedByUser.get(rule.user_id);
          const seriesName = matchedSeries
            ? rule.match_value.trim()
            : (prev?.matchedSeriesName ?? null);
          if (!prev || rule.target_status > prev.targetStatus) {
            matchedByUser.set(rule.user_id, {
              targetStatus: rule.target_status || 2,
              regionScope: rule.region_scope || 'home',
              homeRegion: rule.home_region || 'USA',
              matchedSeriesName: seriesName,
            });
          } else if (matchedSeries && !prev.matchedSeriesName) {
            prev.matchedSeriesName = rule.match_value.trim();
          }
        }
      }

      for (const [userId, match] of matchedByUser.entries()) {
        if (
          match.regionScope !== 'any' &&
          !isRegionMatchingHome(toy.region, match.homeRegion)
        ) {
          continue;
        }
        pendingPairs.push({
          userId,
          toyId: toy.id,
          targetStatus: match.targetStatus,
          matchedSeriesName: match.matchedSeriesName,
          itemName: toy.name || toy.id,
        });
      }
    }

    const watchedAlerts: WatchedSeriesAlertItem[] = [];
    if (options?.notifySubscribers) {
      const seriesPairsByUser = new Map<number, typeof pendingPairs>();
      for (const p of pendingPairs) {
        if (!p.matchedSeriesName) continue;
        let list = seriesPairsByUser.get(p.userId);
        if (!list) {
          list = [];
          seriesPairsByUser.set(p.userId, list);
        }
        list.push(p);
      }
      for (const [uid, pairs] of seriesPairsByUser.entries()) {
        const existingStatusByToy = new Map<string, number>();
        for (let i = 0; i < pairs.length; i += 80) {
          const chunk = pairs.slice(i, i + 80);
          const ph = chunk.map(() => '?').join(',');
          const existingRows = await env.DB.prepare(
            `SELECT toy_id, ownership_status FROM user_toys WHERE user_id = ? AND toy_id IN (${ph})`,
          )
            .bind(uid, ...chunk.map((c) => c.toyId))
            .all<{ toy_id: string; ownership_status: number }>();
          for (const row of existingRows.results || []) {
            existingStatusByToy.set(row.toy_id, row.ownership_status);
          }
        }
        for (const p of pairs) {
          const existingStatus = existingStatusByToy.get(p.toyId);
          if (existingStatus === undefined || existingStatus === 0) {
            watchedAlerts.push({
              userId: uid,
              itemType: 'toy',
              itemId: p.toyId,
              title: p.itemName,
              series: p.matchedSeriesName!,
            });
          }
        }
      }
    }

    const statements = pendingPairs.map((p) =>
      env.DB.prepare(
        `INSERT INTO user_toys (user_id, toy_id, ownership_status, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id, toy_id) DO UPDATE SET
           ownership_status = excluded.ownership_status,
           updated_at = CURRENT_TIMESTAMP
         WHERE user_toys.ownership_status = 0`,
      ).bind(p.userId, p.toyId, p.targetStatus),
    );

    if (statements.length > 0) {
      for (let i = 0; i < statements.length; i += 100) {
        await env.DB.batch(statements.slice(i, i + 100));
      }
    }
    if (options?.notifySubscribers && watchedAlerts.length > 0) {
      await dispatchWatchedSeriesNotifications(env, watchedAlerts);
    }
    return statements.length;
  } catch {
    return 0;
  }
}

async function resolveUniqueOidcUsername(
  env: Env,
  desiredUsername: string,
  excludeUserId?: number,
): Promise<string> {
  const base = desiredUsername.trim() || 'collector';
  const existingOwner = (await env.DB.prepare(
    'SELECT id FROM users WHERE username = ? COLLATE NOCASE',
  )
    .bind(base)
    .first()) as { id: number } | null;

  if (
    !existingOwner ||
    (excludeUserId !== undefined && existingOwner.id === excludeUserId)
  ) {
    return base;
  }

  for (let attempt = 0; attempt < 6; attempt++) {
    const suffix =
      generateRandomBase64Url(4)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 6) || Math.random().toString(36).slice(2, 8);
    const candidate = `${base}_${suffix}`;
    const conflict = (await env.DB.prepare(
      'SELECT id FROM users WHERE username = ? COLLATE NOCASE',
    )
      .bind(candidate)
      .first()) as { id: number } | null;
    if (!conflict) {
      return candidate;
    }
  }
  return `${base}_${Date.now().toString(36)}`;
}

/**
 * Synchronizes or resolves a verified OIDC user against the D1 `users` table.
 * - Binds returning users by immutable `oidc_sub` first.
 * - Links pre-seeded row `id = 1` (`oidc_sub IS NULL`) ONLY when `claims.email_verified === true`
 *   and `claims.email` matches `env.ADMIN_EMAIL`. Never links by mutable `username`!
 * - Disambiguates colliding `preferred_username` values with a short random suffix.
 * - Performs diff-only updates so unchanged repeat logins incur 0 D1 writes.
 */
export async function syncOrResolveOidcUser(
  env: Env,
  claims: OidcIdTokenClaims,
  requestUrl?: string,
): Promise<DbUserRow> {
  const sub = String(claims.sub || '').trim();
  if (!sub) {
    throw new Error('Missing OIDC subject claim.');
  }
  const rawEmail = (claims.email || '').toLowerCase().trim();
  const rawUsername = (
    claims.preferred_username ||
    (rawEmail ? rawEmail.split('@')[0] : '') ||
    `user_${sub}`
  ).trim();
  const claimDisplayName =
    typeof claims.name === 'string' && claims.name.trim().length > 0
      ? claims.name.trim()
      : null;

  const selectCols =
    'SELECT id, username, oidc_sub, is_public, home_region, display_name, bio FROM users';
  let fetchedExisting: DbUserRow | undefined;

  try {
    let existing = (await env.DB.prepare(
      `${selectCols} WHERE oidc_sub = ? AND oidc_sub IS NOT NULL`,
    )
      .bind(sub)
      .first()) as DbUserRow | null;

    if (
      !existing &&
      claims.email_verified === true &&
      rawEmail &&
      env.ADMIN_EMAIL &&
      rawEmail === env.ADMIN_EMAIL.trim().toLowerCase()
    ) {
      existing = (await env.DB.prepare(
        `${selectCols} WHERE id = 1 AND oidc_sub IS NULL`,
      ).first()) as DbUserRow | null;
    }

    if (existing) {
      fetchedExisting = existing;
      let nextUsername = existing.username;
      if (
        rawUsername &&
        rawUsername.toLowerCase() !== existing.username.toLowerCase()
      ) {
        const alreadyDisambiguated = existing.username
          .toLowerCase()
          .startsWith(`${rawUsername.toLowerCase()}_`);
        const ownerOfRaw = (await env.DB.prepare(
          'SELECT id FROM users WHERE username = ? COLLATE NOCASE',
        )
          .bind(rawUsername)
          .first()) as { id: number } | null;

        if (!ownerOfRaw || ownerOfRaw.id === existing.id) {
          nextUsername = rawUsername;
        } else if (!alreadyDisambiguated) {
          nextUsername = await resolveUniqueOidcUsername(
            env,
            rawUsername,
            existing.id,
          );
        }
      }

      const nextDisplayName = existing.display_name || claimDisplayName;
      const usernameChanged = existing.username !== nextUsername;
      const oidcSubMissing = !existing.oidc_sub;
      const needsUpdate =
        oidcSubMissing ||
        usernameChanged ||
        (!existing.display_name && Boolean(claimDisplayName));

      if (needsUpdate) {
        const prevUsername = existing.username;
        await env.DB.prepare(
          `UPDATE users
           SET oidc_sub = COALESCE(oidc_sub, ?),
               username = ?,
               display_name = COALESCE(display_name, ?),
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
          .bind(sub, nextUsername, claimDisplayName, existing.id)
          .run();
        if (usernameChanged) {
          await invalidateEdgeApiCache(requestUrl, {
            userId: existing.id,
            username: nextUsername,
            previousUsername: prevUsername,
          });
        }
        await markDbDirty(env);
        existing = {
          ...existing,
          oidc_sub: existing.oidc_sub || sub,
          username: nextUsername,
          display_name: nextDisplayName,
        };
      }
      return existing;
    }

    const uniqueUsername = await resolveUniqueOidcUsername(
      env,
      rawUsername || `user_${sub}`,
    );
    await env.DB.prepare(
      `INSERT INTO users (username, oidc_sub, is_public, home_region, display_name)
       VALUES (?, ?, 0, 'USA', ?)`,
    )
      .bind(uniqueUsername, sub, claimDisplayName)
      .run();
    await markDbDirty(env);

    const created = (await env.DB.prepare(
      `${selectCols} WHERE oidc_sub = ? AND oidc_sub IS NOT NULL`,
    )
      .bind(sub)
      .first()) as DbUserRow | null;
    if (!created) {
      throw new Error('Failed to provision OIDC user in D1.');
    }
    return created;
  } catch (err) {
    console.warn(
      '[OIDC] D1 user resolution/provisioning failed; falling back to R2/claims:',
      err,
    );
    if (fetchedExisting) {
      return fetchedExisting;
    }
    const snapshot = await loadMetaSnapshotForFallback(env.BACKUP_BUCKET);
    const r2Users = snapshot?.tables?.['users'] || [];
    const bySubRow = r2Users.find(
      (u) =>
        u['oidc_sub'] !== null &&
        u['oidc_sub'] !== undefined &&
        String(u['oidc_sub']) === sub,
    );
    if (bySubRow) {
      return snapshotRowToDbUserRow(bySubRow);
    }
    if (
      claims.email_verified === true &&
      rawEmail &&
      env.ADMIN_EMAIL &&
      rawEmail === env.ADMIN_EMAIL.trim().toLowerCase()
    ) {
      const legacyAdminRow = r2Users.find(
        (u) => Number(u['id']) === 1 && !u['oidc_sub'],
      );
      if (legacyAdminRow) {
        return snapshotRowToDbUserRow(legacyAdminRow);
      }
    }
    const parsedId = /^\d+$/.test(sub) ? Number(sub) : 1;
    const synthesizedId =
      Number.isSafeInteger(parsedId) && parsedId > 0 ? parsedId : 1;
    return {
      id: synthesizedId,
      username: rawUsername,
      oidc_sub: sub,
      is_public: 0,
      home_region: DEFAULT_USER_HOME_REGION,
      display_name: claimDisplayName,
      bio: null,
      auto_track_series_on_add: 1,
      auto_seek_release_scope: 'one_per_game',
      auto_seek_region_scope: 'home',
      track_individual_media: 0,
    };
  }
}

/**
 * Determines whether synthetic loopback developer admin auto-elevation is safe:
 * - Must be a loopback host (`localhost`, `127.0.0.1`, `[::1]`)
 * - Disabled whenever `OIDC_ISSUER` is configured
 * - Disabled whenever `Sec-Fetch-Site` or `Origin` indicates a cross-site / drive-by request
 */
function isSafeLoopbackDevBypass(
  request: Request,
  url: URL,
  env: Env,
): boolean {
  if (!isLoopbackRequest(url)) return false;
  if (getOidcIssuer(env)) return false;
  const secFetchSite = request.headers.get('Sec-Fetch-Site')?.toLowerCase();
  if (secFetchSite === 'cross-site' || secFetchSite === 'same-site') {
    return false;
  }
  const originHeader = request.headers.get('Origin');
  if (
    originHeader !== null &&
    originHeader !== url.origin &&
    !LOOPBACK_DEV_ORIGINS.has(originHeader)
  ) {
    return false;
  }
  return true;
}

/**
 * Resolves the authenticated SessionUser from the signed session cookie (`__Host-app_user_session`
 * or `app_user_session`), constant-time admin key header, or safe local loopback dev fallback.
 */
export async function resolveSessionUser(
  request: Request,
  env: Env,
  _ctx?: ExecutionContext,
): Promise<SessionUser | null> {
  const url = new URL(request.url);
  const cookieHeader = request.headers.get('Cookie');
  const cookies = parseCookies(cookieHeader);
  const token = readSessionCookie(cookies);
  const secret = getSessionSecret(env, url);

  if (token && secret) {
    const user = await verifySession(token, secret);
    if (user) {
      return user;
    }
  }

  const adminKey = request.headers.get('x-admin-key');
  if (
    (env.ADMIN_KEY &&
      adminKey &&
      timingSafeEqualStrings(adminKey, env.ADMIN_KEY)) ||
    isSafeLoopbackDevBypass(request, url, env)
  ) {
    return {
      id: 1,
      username: 'admin',
      role: 'admin',
      homeRegion: 'USA',
    };
  }

  return null;
}

/**
 * Validates whether the incoming request is authorized to execute admin actions.
 * Supports explicit sessionUser role verification, constant-time admin key, and safe loopback dev testing.
 */
export function isAuthorizedAdmin(
  request: Request,
  env: Env,
  sessionUser?: SessionUser | null,
): boolean {
  if (sessionUser) {
    return sessionUser.role === 'admin';
  }
  const url = new URL(request.url);

  // 1. Explicit admin key header (constant-time comparison)
  const adminKey = request.headers.get('x-admin-key');
  if (
    env.ADMIN_KEY &&
    adminKey &&
    timingSafeEqualStrings(adminKey, env.ADMIN_KEY)
  ) {
    return true;
  }

  // 2. Safe loopback local dev bypass (only when OIDC_ISSUER is unset and not cross-site)
  if (isSafeLoopbackDevBypass(request, url, env)) {
    return true;
  }

  return false;
}

export function isMarketPricingAuthorized(
  request: Request,
  env: Env,
  sessionUser?: SessionUser | null,
): boolean {
  if (isAuthorizedAdmin(request, env, sessionUser)) {
    return true;
  }
  const policy = (env.MARKET_PRICING_ACCESS || 'admin').trim().toLowerCase();
  if (policy === 'authenticated' && sessionUser) {
    return true;
  }
  return false;
}

/**
 * Emits a structured background job execution event to Cloudflare Workers Logs.
 */
export function logCronExecution(
  jobName: string,
  status: 'SUCCESS' | 'ERROR' | 'SKIPPED',
  durationMs: number,
  summary?: string,
  details?: unknown,
): void {
  const entry = {
    event: 'cron_execution',
    job_name: jobName,
    status,
    duration_ms: durationMs,
    summary: summary ?? null,
    details: details ?? null,
  };
  if (status === 'ERROR') {
    console.error(entry);
  } else {
    console.log(entry);
  }
}

/**
 * Dumps all tables from D1 and writes a compact SHA-256 deduplicated snapshot to Cloudflare R2
 * via `@wesdizzle/app-kit/worker`.
 */
export async function performScheduledBackup(
  env: Env,
  isDaily: boolean = false,
  skipIfUnchanged: boolean = true,
): Promise<{
  key: string;
  rowCount: number;
  skipped?: boolean;
  prunedCount?: number;
}> {
  let hasManyGames: boolean;
  try {
    const countRow = (await env.DB.prepare(
      GAMES_HAS_MANY_ROWS_QUERY,
    ).first()) as { cnt?: number } | null;
    hasManyGames = Number(countRow?.cnt ?? 0) > 500;
  } catch {
    hasManyGames = false;
  }
  const tablesToDump = hasManyGames
    ? BACKUP_TABLES.filter((t) => t !== 'games' && t !== 'game_releases')
    : BACKUP_TABLES;
  const res = await kitPerformScheduledBackup(env, tablesToDump, {
    isDaily,
    skipIfUnchanged,
  });
  if (
    env.BACKUP_BUCKET &&
    (!res.skipped || !(await env.BACKUP_BUCKET.head(R2_GAMES_ACTIVE_LITE_KEY)))
  ) {
    try {
      await writeLiteBackupSnapshots(env);
    } catch (err) {
      console.warn('[WorkerBackup] Failed to write lite snapshots:', err);
    }
  }
  return res;
}

/**
 * Flags the database as dirty in `sync_state` (diff-guarded so already-dirty state incurs 0 writes)
 * and selectively clears `boutique_feed_hash` only when a game's ownership or physical status changes.
 */
export async function markDbDirty(
  env: Env,
  _table?: string,
  _id?: string | number,
  options?: { clearBoutiqueHash?: boolean },
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO sync_state (key, value, updated_at)
       VALUES ('db_dirty', '1', datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = datetime('now')
       WHERE sync_state.value != '1'`,
    ).run();
    if (options?.clearBoutiqueHash) {
      await env.DB.prepare(
        `DELETE FROM sync_state WHERE key = 'boutique_feed_hash'`,
      ).run();
    }
  } catch (err) {
    console.warn('[WorkerBackup] Failed to mark db dirty:', err);
  }
}

/**
 * Flags `canonical_releases` as dirty in `sync_state` (diff-guarded so already-dirty state incurs 0 writes)
 * so the next daily backup window snapshots `canonical_releases` to R2 (`snapshots/canonical_releases.json`).
 */
export async function markCanonicalReleasesDirty(env: Env): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO sync_state (key, value, updated_at)
       VALUES ('canonical_releases_dirty', '1', datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = datetime('now')
       WHERE sync_state.value != '1'`,
    ).run();
  } catch (err) {
    console.warn(
      '[WorkerBackup] Failed to mark canonical_releases dirty:',
      err,
    );
  }
}

/**
 * Flags `catalog_chunks_dirty` in `sync_state` (diff-guarded) so the next
 * daytime or daily cron tick rebuilds build-scoped R2 catalog chunks.
 */
export async function markCatalogChunksDirty(env: Env): Promise<void> {
  cachedCatalogManifest = null;
  try {
    await env.DB.prepare(
      `INSERT INTO sync_state (key, value, updated_at)
       VALUES (?, '1', datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = datetime('now')
       WHERE sync_state.value != '1'`,
    )
      .bind(CATALOG_CHUNKS_DIRTY_KEY)
      .run();
  } catch (err) {
    console.warn('[WorkerBackup] Failed to mark catalog chunks dirty:', err);
  }
}

export interface BackupCatalogManifest {
  version: string;
  timestamp: string;
  date: string;
  tables: {
    games: { rowCount: number; chunks: string[] };
    game_releases: { rowCount: number; chunks: string[] };
  };
}

export interface BackupCanonicalManifest {
  version: string;
  timestamp: string;
  date: string;
  rowCount: number;
  maxId: number;
  chunkCount: number;
  sha256: string;
  chunks: string[];
}

interface CatalogBackupChunksState {
  version: string;
  startedAt: string;
  phase: 'games' | 'game_releases';
  cursor: number | string;
  chunkIndex: number;
  targetMaxGameStableId: number;
  targetMaxReleaseId: string;
  gameChunks: string[];
  releaseChunks: string[];
  gameRowCount: number;
  releaseRowCount: number;
}

interface CanonicalBackupChunksState {
  version: string;
  startedAt: string;
  cursor: number;
  chunkIndex: number;
  targetMaxId: number;
  chunks: string[];
  rowsWritten: number;
}

export function getBackupChunkR2Key(
  table: 'games' | 'game_releases' | 'canonical_releases',
  chunkIndex: number,
): string {
  return `${R2_BACKUP_CHUNK_PREFIX}${table}-${String(chunkIndex).padStart(3, '0')}.json`;
}

async function readBucketCustomMetadata(
  bucket: R2Bucket,
  key: string,
): Promise<Record<string, string> | null> {
  try {
    if (typeof bucket.head === 'function') {
      const headObj = await bucket.head(key);
      return headObj?.customMetadata ?? null;
    }
    if (typeof bucket.get === 'function') {
      const getObj = await bucket.get(key);
      return getObj?.customMetadata ?? null;
    }
  } catch {
    // Ignore R2 metadata lookup error
  }
  return null;
}

async function readSyncStateJson<T>(
  db: D1Database,
  key: string,
): Promise<T | null> {
  try {
    const row = await db
      .prepare('SELECT value FROM sync_state WHERE key = ?')
      .bind(key)
      .first<{ value: string }>();
    if (!row?.value) return null;
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

async function writeSyncStateValue(
  db: D1Database,
  key: string,
  value: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sync_state (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
    .bind(key, value)
    .run();
}

async function deleteSyncStateKey(db: D1Database, key: string): Promise<void> {
  await db.prepare('DELETE FROM sync_state WHERE key = ?').bind(key).run();
}

async function pruneTrailingBackupChunks(
  bucket: R2Bucket,
  table: 'games' | 'game_releases' | 'canonical_releases',
  activeChunkCount: number,
): Promise<void> {
  if (
    typeof bucket.list !== 'function' ||
    typeof bucket.delete !== 'function'
  ) {
    return;
  }
  const prefix = `${R2_BACKUP_CHUNK_PREFIX}${table}-`;
  const listed = await bucket.list({ prefix }).catch(() => null);
  if (!listed?.objects) return;
  for (const obj of listed.objects) {
    const match = obj.key.match(new RegExp(`^${prefix}(\\d+)\\.json$`));
    if (match && Number(match[1]) >= activeChunkCount) {
      await bucket.delete(obj.key).catch(() => {});
    }
  }
}

/**
 * Tier 2 diff-gated, cursor-resumed R2 backup for `games` and `game_releases`.
 * Writes primary-key slices (`snapshots/chunks/games-NNN.json`,
 * `snapshots/chunks/game_releases-NNN.json`) across consecutive cron ticks
 * and publishes `snapshots/chunks/catalog-manifest.json` on completion.
 */
export async function performChunkedCatalogBackup(
  env: Env,
  options: {
    gamesPageSize?: number;
    releasesPageSize?: number;
    maxChunksPerRun?: number;
    forceRestart?: boolean;
  } = {},
): Promise<{
  key: string;
  skipped: boolean;
  completed: boolean;
  inProgress: boolean;
  chunksWritten: number;
  gamesRowCount: number;
  releasesRowCount: number;
}> {
  if (!env.BACKUP_BUCKET) {
    return {
      key: 'none',
      skipped: true,
      completed: false,
      inProgress: false,
      chunksWritten: 0,
      gamesRowCount: 0,
      releasesRowCount: 0,
    };
  }

  const gamesPageSize = Math.max(
    1,
    options.gamesPageSize ?? BACKUP_GAMES_CHUNK_SIZE,
  );
  const releasesPageSize = Math.max(
    1,
    options.releasesPageSize ?? BACKUP_RELEASES_CHUNK_SIZE,
  );
  const chunkLimit =
    options.maxChunksPerRun === undefined
      ? 2
      : Number.isFinite(options.maxChunksPerRun)
        ? Math.max(1, Math.floor(options.maxChunksPerRun))
        : Number.POSITIVE_INFINITY;

  let state: CatalogBackupChunksState | null = null;
  if (!options.forceRestart) {
    const saved = await readSyncStateJson<CatalogBackupChunksState>(
      env.DB,
      BACKUP_CATALOG_CHUNKS_STATE_KEY,
    );
    if (
      saved &&
      (saved.phase === 'games' || saved.phase === 'game_releases') &&
      Array.isArray(saved.gameChunks) &&
      Array.isArray(saved.releaseChunks)
    ) {
      state = saved;
    }
  }

  if (!state) {
    const [dirtyRow, manifestMeta, gameStats, relStats] = await Promise.all([
      env.DB.prepare("SELECT value FROM sync_state WHERE key = 'db_dirty'")
        .first<{ value: string }>()
        .catch(() => null),
      readBucketCustomMetadata(
        env.BACKUP_BUCKET,
        R2_BACKUP_CATALOG_MANIFEST_KEY,
      ),
      env.DB.prepare(
        'SELECT COUNT(*) AS cnt, COALESCE(MAX(stable_id), 0) AS max_id FROM games',
      )
        .first<{ cnt: number; max_id: number }>()
        .catch(() => ({ cnt: 0, max_id: 0 })),
      env.DB.prepare(
        "SELECT COUNT(*) AS cnt, COALESCE(MAX(id), '') AS max_id FROM game_releases",
      )
        .first<{ cnt: number; max_id: string }>()
        .catch(() => ({ cnt: 0, max_id: '' })),
    ]);

    const isDirty = dirtyRow?.value === '1';
    const totalGames = Number(gameStats?.cnt ?? 0);
    const totalReleases = Number(relStats?.cnt ?? 0);
    if (
      !options.forceRestart &&
      !isDirty &&
      manifestMeta &&
      manifestMeta['gamesRowCount'] === String(totalGames) &&
      manifestMeta['releasesRowCount'] === String(totalReleases)
    ) {
      return {
        key: 'none',
        skipped: true,
        completed: true,
        inProgress: false,
        chunksWritten: 0,
        gamesRowCount: totalGames,
        releasesRowCount: totalReleases,
      };
    }

    const startedAt = new Date().toISOString();
    state = {
      version: `${startedAt.slice(0, 10)}:${totalGames}:${totalReleases}:${Date.now()}`,
      startedAt,
      phase: totalGames > 0 ? 'games' : 'game_releases',
      cursor: totalGames > 0 ? 0 : '',
      chunkIndex: 0,
      targetMaxGameStableId: Number(gameStats?.max_id ?? 0),
      targetMaxReleaseId: String(relStats?.max_id ?? ''),
      gameChunks: [],
      releaseChunks: [],
      gameRowCount: 0,
      releaseRowCount: 0,
    };
  }

  let chunksWritten = 0;
  let completed = false;

  while (chunksWritten < chunkLimit && !completed) {
    if (state.phase === 'games') {
      const { results } = await env.DB.prepare(
        'SELECT * FROM games WHERE stable_id > ? ORDER BY stable_id ASC LIMIT ?',
      )
        .bind(Number(state.cursor) || 0, gamesPageSize)
        .all<Record<string, unknown>>();
      const batch = results || [];
      if (batch.length === 0) {
        state.phase = 'game_releases';
        state.cursor = '';
        state.chunkIndex = 0;
        continue;
      }

      const chunkKey = getBackupChunkR2Key('games', state.chunkIndex);
      await env.BACKUP_BUCKET.put(
        chunkKey,
        JSON.stringify({
          table: 'games',
          chunkIndex: state.chunkIndex,
          rowCount: batch.length,
          rows: batch,
        }),
        {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {
            table: 'games',
            chunkIndex: String(state.chunkIndex),
            rowCount: String(batch.length),
            version: state.version,
          },
        },
      );
      state.gameChunks.push(chunkKey);
      state.gameRowCount += batch.length;
      chunksWritten++;

      const lastStableId = Number(batch[batch.length - 1]?.['stable_id'] ?? 0);
      if (
        batch.length < gamesPageSize ||
        lastStableId <= (Number(state.cursor) || 0) ||
        lastStableId >= state.targetMaxGameStableId
      ) {
        state.phase = 'game_releases';
        state.cursor = '';
        state.chunkIndex = 0;
      } else {
        state.cursor = lastStableId;
        state.chunkIndex++;
      }
    } else {
      const { results } = await env.DB.prepare(
        'SELECT * FROM game_releases WHERE id > ? ORDER BY id ASC LIMIT ?',
      )
        .bind(String(state.cursor ?? ''), releasesPageSize)
        .all<Record<string, unknown>>();
      const batch = results || [];
      if (batch.length === 0) {
        completed = true;
        break;
      }

      const chunkKey = getBackupChunkR2Key('game_releases', state.chunkIndex);
      await env.BACKUP_BUCKET.put(
        chunkKey,
        JSON.stringify({
          table: 'game_releases',
          chunkIndex: state.chunkIndex,
          rowCount: batch.length,
          rows: batch,
        }),
        {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {
            table: 'game_releases',
            chunkIndex: String(state.chunkIndex),
            rowCount: String(batch.length),
            version: state.version,
          },
        },
      );
      state.releaseChunks.push(chunkKey);
      state.releaseRowCount += batch.length;
      chunksWritten++;

      const lastId = String(batch[batch.length - 1]?.['id'] ?? '');
      if (
        batch.length < releasesPageSize ||
        !lastId ||
        lastId <= String(state.cursor ?? '') ||
        (state.targetMaxReleaseId !== '' && lastId >= state.targetMaxReleaseId)
      ) {
        completed = true;
        break;
      }
      state.cursor = lastId;
      state.chunkIndex++;
    }
  }

  if (!completed) {
    await writeSyncStateValue(
      env.DB,
      BACKUP_CATALOG_CHUNKS_STATE_KEY,
      JSON.stringify(state),
    ).catch(() => {});
    return {
      key: R2_BACKUP_CATALOG_MANIFEST_KEY,
      skipped: false,
      completed: false,
      inProgress: true,
      chunksWritten,
      gamesRowCount: state.gameRowCount,
      releasesRowCount: state.releaseRowCount,
    };
  }

  const timestamp = new Date().toISOString();
  const manifest: BackupCatalogManifest = {
    version: state.version,
    timestamp,
    date: timestamp.slice(0, 10),
    tables: {
      games: { rowCount: state.gameRowCount, chunks: state.gameChunks },
      game_releases: {
        rowCount: state.releaseRowCount,
        chunks: state.releaseChunks,
      },
    },
  };

  await env.BACKUP_BUCKET.put(
    R2_BACKUP_CATALOG_MANIFEST_KEY,
    JSON.stringify(manifest),
    {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: {
        version: manifest.version,
        gamesRowCount: String(state.gameRowCount),
        releasesRowCount: String(state.releaseRowCount),
        chunkCount: String(
          state.gameChunks.length + state.releaseChunks.length,
        ),
      },
    },
  );
  await deleteSyncStateKey(env.DB, BACKUP_CATALOG_CHUNKS_STATE_KEY).catch(
    () => {},
  );
  await pruneTrailingBackupChunks(
    env.BACKUP_BUCKET,
    'games',
    state.gameChunks.length,
  );
  await pruneTrailingBackupChunks(
    env.BACKUP_BUCKET,
    'game_releases',
    state.releaseChunks.length,
  );

  return {
    key: R2_BACKUP_CATALOG_MANIFEST_KEY,
    skipped: false,
    completed: true,
    inProgress: false,
    chunksWritten,
    gamesRowCount: state.gameRowCount,
    releasesRowCount: state.releaseRowCount,
  };
}

/**
 * Tier 3 diff-gated, cursor-resumed R2 backup for `canonical_releases`
 * (`snapshots/chunks/canonical_releases-NNN.json` + `snapshots/chunks/canonical-manifest.json`).
 * Reads up to `maxChunksPerRun` primary-key slices per invocation so 100k+ rows never
 * exceed Cloudflare Workers Free Tier CPU/memory limits.
 */
export async function performCanonicalReleasesBackup(
  env: Env,
  options: {
    pageSize?: number;
    maxChunksPerRun?: number;
    force?: boolean;
  } = {},
): Promise<{
  key: string;
  rowCount: number;
  maxId: number;
  skipped: boolean;
  inProgress: boolean;
  chunksWritten: number;
}> {
  const pageSize = Math.max(1, options.pageSize ?? BACKUP_CANONICAL_CHUNK_SIZE);
  const chunkLimit =
    options.maxChunksPerRun === undefined
      ? 2
      : Number.isFinite(options.maxChunksPerRun)
        ? Math.max(1, Math.floor(options.maxChunksPerRun))
        : Number.POSITIVE_INFINITY;

  if (!env.BACKUP_BUCKET) {
    return {
      key: 'none',
      rowCount: 0,
      maxId: 0,
      skipped: true,
      inProgress: false,
      chunksWritten: 0,
    };
  }

  let state: CanonicalBackupChunksState | null = null;
  if (!options.force) {
    const saved = await readSyncStateJson<CanonicalBackupChunksState>(
      env.DB,
      BACKUP_CANONICAL_CHUNKS_STATE_KEY,
    );
    if (
      saved &&
      Array.isArray(saved.chunks) &&
      typeof saved.cursor === 'number'
    ) {
      state = saved;
    }
  }

  if (!state) {
    const [dirtyRow, statsRow, manifestMeta] = await Promise.all([
      env.DB.prepare(
        "SELECT value FROM sync_state WHERE key = 'canonical_releases_dirty'",
      )
        .first<{ value: string }>()
        .catch(() => null),
      env.DB.prepare(
        'SELECT COUNT(*) AS cnt, COALESCE(MAX(id), 0) AS max_id FROM canonical_releases',
      )
        .first<{ cnt: number; max_id: number }>()
        .catch(() => ({ cnt: 0, max_id: 0 })),
      readBucketCustomMetadata(
        env.BACKUP_BUCKET,
        R2_BACKUP_CANONICAL_MANIFEST_KEY,
      ),
    ]);

    const isDirty = dirtyRow?.value === '1';
    const rowCount = Number(statsRow?.cnt ?? 0);
    const maxId = Number(statsRow?.max_id ?? 0);

    if (!options.force && !isDirty) {
      if (rowCount === 0) {
        return {
          key: 'none',
          rowCount: 0,
          maxId: 0,
          skipped: true,
          inProgress: false,
          chunksWritten: 0,
        };
      }
      if (
        manifestMeta &&
        manifestMeta['rowCount'] === String(rowCount) &&
        manifestMeta['maxId'] === String(maxId)
      ) {
        return {
          key: 'none',
          rowCount,
          maxId,
          skipped: true,
          inProgress: false,
          chunksWritten: 0,
        };
      }
    }

    if (rowCount === 0 && !isDirty && !options.force) {
      return {
        key: 'none',
        rowCount: 0,
        maxId: 0,
        skipped: true,
        inProgress: false,
        chunksWritten: 0,
      };
    }

    const startedAt = new Date().toISOString();
    state = {
      version: `${startedAt.slice(0, 10)}:${rowCount}:${maxId}:${Date.now()}`,
      startedAt,
      cursor: 0,
      chunkIndex: 0,
      targetMaxId: maxId,
      chunks: [],
      rowsWritten: 0,
    };
  }

  let chunksWritten = 0;
  let completed = false;

  while (chunksWritten < chunkLimit) {
    const { results } = await env.DB.prepare(
      'SELECT * FROM canonical_releases WHERE id > ? ORDER BY id ASC LIMIT ?',
    )
      .bind(state.cursor, pageSize)
      .all<Record<string, unknown>>();
    const batch = results || [];
    if (batch.length === 0) {
      completed = true;
      break;
    }

    const chunkKey = getBackupChunkR2Key(
      'canonical_releases',
      state.chunkIndex,
    );
    await env.BACKUP_BUCKET.put(
      chunkKey,
      JSON.stringify({
        table: 'canonical_releases',
        chunkIndex: state.chunkIndex,
        rowCount: batch.length,
        rows: batch,
      }),
      {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: {
          table: 'canonical_releases',
          chunkIndex: String(state.chunkIndex),
          rowCount: String(batch.length),
          version: state.version,
        },
      },
    );

    state.chunks.push(chunkKey);
    state.rowsWritten += batch.length;
    chunksWritten++;

    const lastId = Number(batch[batch.length - 1]?.['id'] ?? 0);
    if (!lastId || lastId <= state.cursor) {
      completed = true;
      break;
    }
    state.cursor = lastId;
    state.chunkIndex++;
    if (lastId >= state.targetMaxId || batch.length < pageSize) {
      completed = true;
      break;
    }
  }

  if (!completed) {
    await writeSyncStateValue(
      env.DB,
      BACKUP_CANONICAL_CHUNKS_STATE_KEY,
      JSON.stringify(state),
    ).catch(() => {});
    return {
      key: R2_BACKUP_CANONICAL_MANIFEST_KEY,
      rowCount: state.rowsWritten,
      maxId: state.targetMaxId,
      skipped: false,
      inProgress: true,
      chunksWritten,
    };
  }

  const finalMaxId =
    state.rowsWritten > 0 ? Math.max(state.cursor, state.targetMaxId) : 0;
  const manifestSummaryStr = JSON.stringify({
    version: state.version,
    rowCount: state.rowsWritten,
    maxId: finalMaxId,
    chunks: state.chunks,
  });
  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(manifestSummaryStr),
  );
  const sha256 = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const timestamp = new Date().toISOString();
  const manifest: BackupCanonicalManifest = {
    version: state.version,
    timestamp,
    date: timestamp.slice(0, 10),
    rowCount: state.rowsWritten,
    maxId: finalMaxId,
    chunkCount: state.chunks.length,
    sha256,
    chunks: state.chunks,
  };

  await env.BACKUP_BUCKET.put(
    R2_BACKUP_CANONICAL_MANIFEST_KEY,
    JSON.stringify(manifest),
    {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: {
        version: manifest.version,
        sha256,
        totalRows: String(state.rowsWritten),
        rowCount: String(state.rowsWritten),
        maxId: String(finalMaxId),
        chunkCount: String(state.chunks.length),
      },
    },
  );

  await deleteSyncStateKey(env.DB, BACKUP_CANONICAL_CHUNKS_STATE_KEY).catch(
    () => {},
  );
  await writeSyncStateValue(env.DB, 'canonical_releases_dirty', '0').catch(
    () => {},
  );
  await pruneTrailingBackupChunks(
    env.BACKUP_BUCKET,
    'canonical_releases',
    state.chunks.length,
  );

  return {
    key: R2_BACKUP_CANONICAL_MANIFEST_KEY,
    rowCount: state.rowsWritten,
    maxId: finalMaxId,
    skipped: false,
    inProgress: false,
    chunksWritten,
  };
}

interface GamesListQueryResult {
  rows: Array<Record<string, unknown>>;
  isPartial: boolean;
}

async function executeGamesListQuery(
  db: D1Database,
  userId: number | null,
  homeRegion: string,
  platformId: string | null,
  includeUnowned: boolean,
): Promise<GamesListQueryResult> {
  let useActiveFilter = false;
  if (!platformId && !includeUnowned) {
    const countRow = (await db.prepare(GAMES_HAS_MANY_ROWS_QUERY).first()) as {
      cnt?: number;
    } | null;
    useActiveFilter = Number(countRow?.cnt ?? 0) > 500;
  }

  const runQuery = async (
    activeOnly: boolean,
  ): Promise<Array<Record<string, unknown>>> => {
    const params: (string | number)[] = [];
    let query = buildGamesListQuery(userId);
    if (userId !== null) {
      params.push(userId, userId);
    }
    if (platformId) {
      query +=
        ' AND g.platform_id IN (SELECT id FROM platforms WHERE id = ? OR parent_platform_id = ?)';
      params.push(platformId, platformId);
    }
    if (activeOnly) {
      query +=
        userId !== null
          ? ACTIVE_GAMES_LIST_WHERE_CLAUSE
          : ACTIVE_GAMES_PUBLIC_WHERE_CLAUSE;
      if (userId !== null) {
        params.push(userId, userId);
      }
    }
    const { results } = await db
      .prepare(query)
      .bind(...params)
      .all();
    return (results as Array<Record<string, unknown>>) || [];
  };

  let rows: Array<Record<string, unknown>>;
  let isPartial = useActiveFilter;
  try {
    rows = await runQuery(useActiveFilter);
  } catch (err) {
    if (!useActiveFilter && !isD1QuotaOrReadError(err)) {
      console.warn(
        '[WorkerGames] Full games query failed; retrying active-only D1 query:',
        err,
      );
      isPartial = true;
      rows = await runQuery(true);
    } else {
      throw err;
    }
  }

  if (rows.length > 0) {
    try {
      postProcessGameListRows(rows, homeRegion);
    } catch (postErr) {
      console.warn(
        '[WorkerGames] postProcessGameListRows failed, stripping metadata in-place:',
        postErr,
      );
      for (const r of rows) {
        r['metadata_json'] = undefined;
        r['raw_title'] = undefined;
      }
    }
  }
  return { rows, isPartial };
}

async function buildCollectionOverlayPayload(
  env: Env,
  userId: number | null,
  homeRegion: string,
  sinceStableIdOverride?: number | null,
  edgeCacheArg?: Cache | null,
): Promise<{
  version: string;
  timestamp: string;
  maxStableId: number;
  ugr: Array<Record<string, unknown>>;
  ug: Array<Record<string, unknown>>;
  ut: Array<Record<string, unknown>>;
  deltaGames: Array<Record<string, unknown>>;
}> {
  const manifest = await resolveCatalogManifest(env);
  const sinceStableId =
    sinceStableIdOverride !== null &&
    sinceStableIdOverride !== undefined &&
    Number.isFinite(sinceStableIdOverride) &&
    sinceStableIdOverride >= 0
      ? Math.floor(sinceStableIdOverride)
      : (manifest?.maxStableId ?? 0);

  const [ugrRes, ugRes, utRes, maxGameRow] = await Promise.all([
    userId !== null
      ? env.DB.prepare(USER_GAME_RELEASES_OVERLAY_QUERY).bind(userId).all()
      : Promise.resolve({ results: [] }),
    userId !== null
      ? env.DB.prepare(USER_GAMES_OVERLAY_QUERY).bind(userId).all()
      : Promise.resolve({ results: [] }),
    userId !== null
      ? env.DB.prepare(USER_TOYS_OVERLAY_QUERY).bind(userId).all()
      : Promise.resolve({ results: [] }),
    sinceStableId > 0
      ? env.DB.prepare(CATALOG_MAX_GAME_STABLE_ID_QUERY).first<{
          max_stable_id?: number;
        }>()
      : Promise.resolve({ max_stable_id: 0 }),
  ]);

  const ugrRows = (ugrRes.results as Array<Record<string, unknown>>) || [];
  const ugRows = (ugRes.results as Array<Record<string, unknown>>) || [];
  const utRows = (utRes.results as Array<Record<string, unknown>>) || [];
  const currentMaxStableId = Number(maxGameRow?.max_stable_id ?? 0);

  let deltaGames: Array<Record<string, unknown>> = [];
  if (sinceStableId > 0 && currentMaxStableId > sinceStableId) {
    const deltaCacheKeyStr = `https://edge-cache.internal/catalog-delta/since:${sinceStableId}:max:${currentMaxStableId}:reg:${homeRegion}`;
    let baseDelta: Array<Record<string, unknown>> | null = null;
    if (
      cachedCatalogDeltaGames &&
      cachedCatalogDeltaGames.key === deltaCacheKeyStr &&
      cachedCatalogDeltaGames.expiresAt > Date.now()
    ) {
      baseDelta = cachedCatalogDeltaGames.rows;
    }

    const edgeCache =
      baseDelta === null ? (edgeCacheArg ?? (await getEdgeCache())) : null;
    if (baseDelta === null && edgeCache) {
      const cachedDeltaRes = await edgeCache
        .match(new Request(deltaCacheKeyStr))
        .catch(() => undefined);
      if (cachedDeltaRes) {
        const parsed = (await cachedDeltaRes.json().catch(() => null)) as Array<
          Record<string, unknown>
        > | null;
        if (Array.isArray(parsed)) {
          baseDelta = parsed;
          cachedCatalogDeltaGames = {
            key: deltaCacheKeyStr,
            rows: baseDelta,
            expiresAt: Date.now() + 60_000,
          };
        }
      }
    }

    if (baseDelta === null) {
      const deltaRes = await env.DB.prepare(buildCatalogDeltaGamesQuery(null))
        .bind(sinceStableId)
        .all();
      baseDelta = (deltaRes.results as Array<Record<string, unknown>>) || [];
      if (baseDelta.length > 0) {
        postProcessGameListRows(baseDelta, homeRegion);
      }
      cachedCatalogDeltaGames = {
        key: deltaCacheKeyStr,
        rows: baseDelta,
        expiresAt: Date.now() + 60_000,
      };
      if (edgeCache) {
        await edgeCache
          .put(
            new Request(deltaCacheKeyStr),
            new Response(JSON.stringify(baseDelta), {
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=86400, s-maxage=86400',
              },
            }),
          )
          .catch(() => {});
      }
    }

    if (baseDelta.length > 0) {
      if (userId !== null) {
        const ugrByReleaseId = new Map<string, Record<string, unknown>>();
        for (const r of ugrRows) {
          ugrByReleaseId.set(String(r['release_id'] ?? ''), r);
        }
        const ugByGameId = new Map<number, Record<string, unknown>>();
        for (const g of ugRows) {
          ugByGameId.set(Number(g['game_id'] ?? 0), g);
        }
        deltaGames = baseDelta.map((row) => {
          const relUgr = ugrByReleaseId.get(String(row['id'] ?? ''));
          const stableUg = ugByGameId.get(Number(row['stable_id'] ?? 0));
          return {
            ...row,
            ownership_status: Number(relUgr?.['ownership_status'] ?? 0),
            has_media: Number(relUgr?.['has_media'] ?? 0),
            has_case: Number(relUgr?.['has_case'] ?? 0),
            has_manual: Number(relUgr?.['has_manual'] ?? 0),
            play_status: Number(stableUg?.['play_status'] ?? 0),
            queued: Number(stableUg?.['queued'] ?? 0),
          };
        });
      } else {
        deltaGames = baseDelta.map((row) => ({ ...row }));
      }
    }
  }

  return {
    version: manifest?.version || '',
    timestamp: manifest?.timestamp || new Date().toISOString(),
    maxStableId: manifest?.maxStableId ?? sinceStableId,
    ugr: ugrRows,
    ug: ugRows,
    ut: utRows,
    deltaGames,
  };
}

async function handleFetch(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  lastKnownOrigin = url.origin;

  // Direct /robots.txt handler for search engines and crawlers
  if (path === '/robots.txt') {
    const robotsTxt = `# Robots.txt for Collection Tracker
User-agent: *
Disallow: /api/
Disallow: /admin/
Allow: /

# Block aggressive AI scrapers and crawlers from excessive crawling
User-agent: GPTBot
Disallow: /

User-agent: ChatGPT-User
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: anthropic-ai
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: Bytespider
Disallow: /

User-agent: PetalBot
Disallow: /

User-agent: Amazonbot
Disallow: /
`;
    return new Response(robotsTxt, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  }

  // Handle CORS preflight requests without ever reflecting '*' or arbitrary Origins
  if (request.method === 'OPTIONS') {
    const reqOrigin = request.headers.get('Origin');
    const oidcIssuer = getOidcIssuer(env);
    const allowCredentialedOrigin = Boolean(
      reqOrigin &&
      (reqOrigin === url.origin ||
        (oidcIssuer && reqOrigin === oidcIssuer) ||
        (isLoopbackRequest(url) && LOOPBACK_DEV_ORIGINS.has(reqOrigin))),
    );
    return new Response(null, {
      headers: {
        ...(allowCredentialedOrigin && reqOrigin
          ? {
              'Access-Control-Allow-Origin': reqOrigin,
              'Access-Control-Allow-Credentials': 'true',
              Vary: 'Origin',
            }
          : {}),
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers':
          'Content-Type, Authorization, X-Requested-With, Accept, Cache-Control',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  try {
    // Enforce Fetch Metadata + Origin CSRF protection on all state-mutating requests
    const isLogoutEndpoint =
      path === '/api/auth/logout' ||
      path === '/api/admin/logout' ||
      path === '/admin/logout';
    const isSilentLogout =
      isLogoutEndpoint &&
      (url.searchParams.get('silent') === '1' ||
        url.searchParams.get('frontchannel') === '1');
    const oidcIssuer = getOidcIssuer(env);
    const allowedMutationOrigins: string[] = [];
    if (isLoopbackRequest(url)) {
      allowedMutationOrigins.push(...LOOPBACK_DEV_ORIGINS);
    }
    if (isSilentLogout && oidcIssuer) {
      allowedMutationOrigins.push(oidcIssuer);
    }

    if (
      isCrossOriginMutatingRequest(request, url, {
        allowedOrigins: allowedMutationOrigins,
      })
    ) {
      return Response.json(
        { error: 'Forbidden: Cross-origin state mutation blocked.' },
        { status: 403 },
      );
    }

    if (
      (request.method === 'POST' ||
        request.method === 'PUT' ||
        request.method === 'PATCH') &&
      JSON_BODY_MUTATION_PATHS.has(path)
    ) {
      const contentType = (
        request.headers.get('Content-Type') || ''
      ).toLowerCase();
      if (!contentType.includes('application/json')) {
        return Response.json(
          {
            error:
              'Unsupported Media Type: Content-Type must be application/json.',
          },
          { status: 415 },
        );
      }
    }

    const sessionUser = await resolveSessionUser(request, env, ctx);

    // Rate-limit push test endpoint
    if (request.method === 'POST' && path === '/api/notifications/test') {
      const rl = checkWorkerRateLimit(
        'notifications-test',
        getRateLimitClientKey(request, sessionUser),
        5,
        60_000,
      );
      if (!rl.allowed) {
        return Response.json(
          {
            error:
              'Too many test notifications sent. Please wait before trying again.',
          },
          {
            status: 429,
            headers: { 'Retry-After': String(rl.retryAfterSec) },
          },
        );
      }
    } else if (
      request.method === 'POST' &&
      path === '/api/admin/verify-ownership/apply'
    ) {
      const rl = checkWorkerRateLimit(
        'verify-ownership-apply',
        getRateLimitClientKey(request, sessionUser),
        20,
        60_000,
      );
      if (!rl.allowed) {
        return Response.json(
          {
            error:
              'Too many ownership verification requests. Please wait before trying again.',
          },
          {
            status: 429,
            headers: { 'Retry-After': String(rl.retryAfterSec) },
          },
        );
      }
    }

    /**
     * READ-ONLY API ENDPOINTS (Edge-cacheable for anonymous callers, public profiles,
     * and user-scoped internal keys for authenticated sessions on non-loopback origins)
     */
    const isPublicCacheable =
      !sessionUser &&
      request.method === 'GET' &&
      (path === '/api/games' ||
        path === '/api/toys' ||
        path === '/api/platforms' ||
        (path.startsWith('/api/u/') && !path.endsWith('/collection-overlay')));

    const isUserEdgeCacheable =
      Boolean(sessionUser) &&
      !isLoopbackRequest(url) &&
      request.method === 'GET' &&
      (path === '/api/games' ||
        path === '/api/toys' ||
        path === '/api/platforms');

    const isNoCache =
      (url.searchParams.has('bust') ||
        url.searchParams.has('purge') ||
        url.searchParams.has('refresh') ||
        request.headers.get('x-cache-purge') === 'true') &&
      isAuthorizedAdmin(request, env, sessionUser);

    const edgeCache = await getEdgeCache();
    const normalizedCacheUrl = new URL(url.origin + path);
    if (
      path === '/api/games' ||
      (path.startsWith('/api/u/') && path.endsWith('/games'))
    ) {
      const plat =
        url.searchParams.get('platform') || url.searchParams.get('platform_id');
      if (plat) {
        normalizedCacheUrl.searchParams.set('platform_id', plat);
      }
    }
    if (sessionUser && path === '/api/games') {
      normalizedCacheUrl.searchParams.set('__uid', String(sessionUser.id));
      normalizedCacheUrl.searchParams.set(
        '__reg',
        sessionUser.homeRegion || DEFAULT_USER_HOME_REGION,
      );
      if (url.searchParams.get('include_unowned') === '1') {
        normalizedCacheUrl.searchParams.set('include_unowned', '1');
      }
    } else if (sessionUser && path === '/api/toys') {
      normalizedCacheUrl.searchParams.set('__uid', String(sessionUser.id));
    } else if (
      path.startsWith('/api/u/') &&
      path.endsWith('/games') &&
      url.searchParams.get('include_unowned') === '1'
    ) {
      normalizedCacheUrl.searchParams.set('include_unowned', '1');
    }
    const cacheKey = new Request(normalizedCacheUrl.toString());
    if ((isPublicCacheable || isUserEdgeCacheable) && !isNoCache && edgeCache) {
      const cached = await edgeCache.match(cacheKey);
      if (cached) {
        if (sessionUser && (path === '/api/games' || path === '/api/toys')) {
          const cachedHeaders = new Headers({
            'Content-Type': 'application/json',
            'Cache-Control': 'private, no-cache, no-store, must-revalidate',
          });
          const partialHdr = cached.headers.get(X_CATALOG_PARTIAL_HEADER);
          if (partialHdr) {
            cachedHeaders.set(X_CATALOG_PARTIAL_HEADER, partialHdr);
            const chunkSizeHdr = cached.headers.get(
              X_CATALOG_CHUNK_SIZE_HEADER,
            );
            if (chunkSizeHdr) {
              cachedHeaders.set(X_CATALOG_CHUNK_SIZE_HEADER, chunkSizeHdr);
            }
          }
          return new Response(cached.body, {
            status: cached.status,
            headers: cachedHeaders,
          });
        }
        return cached;
      }
    }

    const publicCacheHeaders = {
      'Content-Type': 'application/json',
      'Cache-Control':
        'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    };
    const platformsCacheHeaders = {
      'Content-Type': 'application/json',
      'Cache-Control':
        'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800',
    };

    // Endpoint: GET /api/auth/me
    if (path === '/api/auth/me') {
      const privateHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, private',
      };
      const oidcIssuer = getOidcIssuer(env);
      const oidcClientId = getOidcClientId(env);
      const accountHubUrl = getAccountHubUrl(env);

      if (sessionUser) {
        const authCacheKey = new Request(
          `https://edge-cache.internal/auth-me/user:${sessionUser.id}`,
        );
        if (edgeCache && !isNoCache) {
          const cachedAuth = await edgeCache.match(authCacheKey);
          if (cachedAuth) {
            return new Response(cachedAuth.body, {
              status: cachedAuth.status,
              headers: privateHeaders,
            });
          }
        }

        const resolved = await resolveUserProfileWithFallback(env, sessionUser);
        if (resolved.profile) {
          const payload = {
            authenticated: true,
            oidcIssuer,
            oidcClientId,
            accountHubUrl,
            ...(resolved.degraded
              ? {
                  degraded: true,
                  degradedReason: resolved.degradedReason,
                  snapshotTimestamp: resolved.snapshotTimestamp,
                }
              : {}),
            user: toUserProfileResponsePayload(
              resolved.profile,
              sessionUser.role,
            ),
          };
          const bodyJson = JSON.stringify(payload);
          if (!resolved.degraded && edgeCache) {
            await putEdgeCacheEntry(
              edgeCache,
              authCacheKey,
              new Response(bodyJson, {
                headers: {
                  'Content-Type': 'application/json',
                  'Cache-Control': 'public, max-age=300',
                },
              }),
              isNoCache,
            );
          }
          const responseHeaders =
            resolved.degradedReason === 'r2_backup'
              ? buildR2DegradedHeaders(
                  resolved.snapshotTimestamp,
                  privateHeaders,
                )
              : privateHeaders;
          return new Response(bodyJson, { headers: responseHeaders });
        }
      }

      return new Response(
        JSON.stringify({
          authenticated: false,
          oidcIssuer,
          oidcClientId,
          accountHubUrl,
          user: null,
        }),
        { headers: privateHeaders },
      );
    }

    // Endpoint: GET /api/user/regions
    else if (path === '/api/user/regions') {
      return Response.json(ALLOWED_HOME_REGIONS, {
        headers: { 'Cache-Control': 'public, max-age=86400' },
      });
    }

    // Endpoint: GET/PUT /api/user/profile
    else if (path === '/api/user/profile') {
      if (!sessionUser) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }

      if (request.method === 'GET') {
        const resolved = await resolveUserProfileWithFallback(env, sessionUser);
        if (!resolved.profile) {
          return Response.json({ error: 'User not found' }, { status: 404 });
        }

        const headers =
          resolved.degradedReason === 'r2_backup'
            ? buildR2DegradedHeaders(resolved.snapshotTimestamp, {
                'Cache-Control': 'private, no-cache, no-store',
              })
            : { 'Cache-Control': 'private, no-cache, no-store' };

        return Response.json(
          toUserProfileResponsePayload(resolved.profile, sessionUser.role),
          { headers },
        );
      }

      if (request.method === 'PUT') {
        const body = (await request.json().catch(() => null)) as {
          isPublic?: boolean;
          homeRegion?: string;
          displayName?: unknown;
          bio?: unknown;
          autoTrackSeriesOnAdd?: boolean;
          autoSeekReleaseScope?: unknown;
          autoSeekRegionScope?: unknown;
          trackIndividualMedia?: boolean;
        } | null;

        if (!body || typeof body !== 'object') {
          return Response.json(
            { error: 'Invalid JSON payload' },
            { status: 400 },
          );
        }

        if (
          body.autoSeekReleaseScope !== undefined &&
          body.autoSeekReleaseScope !== 'one_per_game' &&
          body.autoSeekReleaseScope !== 'all_releases'
        ) {
          return Response.json(
            {
              error:
                "Invalid autoSeekReleaseScope: expected 'one_per_game' or 'all_releases'",
            },
            { status: 400 },
          );
        }
        if (
          body.autoSeekRegionScope !== undefined &&
          body.autoSeekRegionScope !== 'home' &&
          body.autoSeekRegionScope !== 'any'
        ) {
          return Response.json(
            {
              error: "Invalid autoSeekRegionScope: expected 'home' or 'any'",
            },
            { status: 400 },
          );
        }

        if (
          body.displayName !== undefined &&
          body.displayName !== null &&
          typeof body.displayName !== 'string'
        ) {
          return Response.json(
            { error: 'displayName must be a string or null' },
            { status: 400 },
          );
        }

        if (
          body.bio !== undefined &&
          body.bio !== null &&
          typeof body.bio !== 'string'
        ) {
          return Response.json(
            { error: 'bio must be a string or null' },
            { status: 400 },
          );
        }

        let normalizedRegion: string | undefined = undefined;
        if (body.homeRegion !== undefined) {
          const matched = normalizeHomeRegion(body.homeRegion);
          if (!matched) {
            return Response.json(
              { error: `Invalid home region: ${body.homeRegion}` },
              { status: 400 },
            );
          }
          normalizedRegion = matched;
        }

        const updates: string[] = ['updated_at = CURRENT_TIMESTAMP'];
        const updateParams: unknown[] = [];

        if (body.isPublic !== undefined) {
          updates.push('is_public = ?');
          updateParams.push(body.isPublic ? 1 : 0);
        }
        if (normalizedRegion !== undefined) {
          updates.push('home_region = ?');
          updateParams.push(normalizedRegion);
        }
        if (body.displayName !== undefined) {
          updates.push('display_name = ?');
          updateParams.push(
            body.displayName ? body.displayName.trim().slice(0, 100) : null,
          );
        }
        if (body.bio !== undefined) {
          updates.push('bio = ?');
          updateParams.push(body.bio ? body.bio.trim().slice(0, 500) : null);
        }
        if (body.autoTrackSeriesOnAdd !== undefined) {
          updates.push('auto_track_series_on_add = ?');
          updateParams.push(body.autoTrackSeriesOnAdd ? 1 : 0);
        }
        if (body.autoSeekReleaseScope !== undefined) {
          updates.push('auto_seek_release_scope = ?');
          updateParams.push(
            normalizeAutoSeekReleaseScope(body.autoSeekReleaseScope),
          );
        }
        if (body.autoSeekRegionScope !== undefined) {
          updates.push('auto_seek_region_scope = ?');
          updateParams.push(
            normalizeAutoSeekRegionScope(body.autoSeekRegionScope),
          );
        }
        if (body.trackIndividualMedia !== undefined) {
          updates.push('track_individual_media = ?');
          updateParams.push(body.trackIndividualMedia ? 1 : 0);
        }

        updateParams.push(sessionUser.id);
        await env.DB.prepare(
          `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
        )
          .bind(...updateParams)
          .run();

        let profile: DbUserRow | null = null;
        try {
          profile = (await env.DB.prepare(
            "SELECT id, username, is_public, home_region, display_name, bio, COALESCE(auto_track_series_on_add, 1) as auto_track_series_on_add, COALESCE(auto_seek_release_scope, 'one_per_game') as auto_seek_release_scope, COALESCE(auto_seek_region_scope, 'home') as auto_seek_region_scope, COALESCE(track_individual_media, 0) as track_individual_media FROM users WHERE id = ?",
          )
            .bind(sessionUser.id)
            .first()) as DbUserRow | null;
        } catch {
          try {
            profile = (await env.DB.prepare(
              'SELECT id, username, is_public, home_region, display_name, bio, COALESCE(auto_track_series_on_add, 1) as auto_track_series_on_add, COALESCE(track_individual_media, 0) as track_individual_media FROM users WHERE id = ?',
            )
              .bind(sessionUser.id)
              .first()) as DbUserRow | null;
          } catch {
            profile = (await env.DB.prepare(
              'SELECT id, username, is_public, home_region, display_name, bio FROM users WHERE id = ?',
            )
              .bind(sessionUser.id)
              .first()) as DbUserRow | null;
          }
        }

        if (!profile) {
          return Response.json({ error: 'User not found' }, { status: 404 });
        }

        await invalidateEdgeApiCache(request.url, {
          userId: profile.id,
          username: profile.username,
          previousUsername: sessionUser.username,
        });
        await markDbDirty(env);

        const res = Response.json(
          toUserProfileResponsePayload(profile, sessionUser.role),
        );

        // If homeRegion changed, re-mint session cookie
        if (normalizedRegion !== undefined) {
          const secret = getSessionSecret(env, url);
          if (secret) {
            const updatedUser: SessionUser = {
              id: profile.id,
              username: profile.username,
              role: sessionUser.role,
              homeRegion: profile.home_region || 'USA',
            };
            const token = await signSession(updatedUser, secret);
            const isSecure = isSecureOrigin(url);
            res.headers.set(
              'Set-Cookie',
              serializeSessionCookie(token, isSecure, 30 * 86400),
            );
          }
        }

        return res;
      }

      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    // Endpoint: GET/POST/DELETE /api/user/tracking-rules
    else if (path === '/api/user/tracking-rules') {
      if (!sessionUser) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }

      if (request.method === 'GET') {
        let rules: unknown[] = [];
        try {
          const res = await env.DB.prepare(
            `SELECT rule_type, match_value, match_value as target_value, target_status, region_scope, is_ignored, created_at
             FROM user_tracking_rules
             WHERE user_id = ?
             ORDER BY is_ignored ASC, rule_type ASC, match_value COLLATE NOCASE ASC`,
          )
            .bind(sessionUser.id)
            .all();
          rules = res.results || [];
        } catch {
          rules = [];
        }
        return Response.json(rules, {
          headers: { 'Cache-Control': 'private, no-cache, no-store' },
        });
      }

      if (request.method === 'POST') {
        const body = (await request.json().catch(() => null)) as {
          rule_type?: string;
          match_value?: string;
          target_value?: string;
          target_status?: number;
          region_scope?: string;
          is_ignored?: number | boolean;
          applyToExisting?: boolean;
          clearExistingSeeking?: boolean;
          clear_existing_seeking?: boolean;
        } | null;

        const validRuleTypes = ['series', 'platform', 'toy_line', 'toy_series'];
        const rawMatchVal = body?.match_value ?? body?.target_value;
        if (
          !body ||
          !body.rule_type ||
          !validRuleTypes.includes(body.rule_type) ||
          !rawMatchVal ||
          !String(rawMatchVal).trim()
        ) {
          return Response.json(
            {
              error: 'Valid rule_type and non-empty match_value are required.',
            },
            { status: 400 },
          );
        }

        const ruleType = body.rule_type;
        const matchValue = String(rawMatchVal).trim();
        const targetStatus = body.target_status === 4 ? 4 : 2;
        let regionScope: 'home' | 'any';
        if (body.region_scope === 'any' || body.region_scope === 'home') {
          regionScope = body.region_scope;
        } else {
          try {
            const prefRow = await env.DB.prepare(
              "SELECT COALESCE(auto_seek_region_scope, 'home') as auto_seek_region_scope FROM users WHERE id = ?",
            )
              .bind(sessionUser.id)
              .first<{ auto_seek_region_scope: string }>();
            regionScope = normalizeAutoSeekRegionScope(
              prefRow?.auto_seek_region_scope,
            );
          } catch {
            regionScope = 'home';
          }
        }
        const isIgnored = body.is_ignored ? 1 : 0;

        await env.DB.prepare(
          `INSERT INTO user_tracking_rules (user_id, rule_type, match_value, target_status, region_scope, is_ignored)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, rule_type, match_value) DO UPDATE SET
             target_status = excluded.target_status,
             region_scope = excluded.region_scope,
             is_ignored = excluded.is_ignored`,
        )
          .bind(
            sessionUser.id,
            ruleType,
            matchValue,
            targetStatus,
            regionScope,
            isIgnored,
          )
          .run();

        let autoAddedCount = 0;
        let clearedCount = 0;
        const shouldClearSeeking =
          body.clearExistingSeeking === true ||
          body.clear_existing_seeking === true;

        if (
          isIgnored === 0 &&
          body.applyToExisting !== false &&
          ruleType === 'series'
        ) {
          const res = await applyReactiveSeriesAutoTracking(
            env,
            sessionUser.id,
            0,
            matchValue,
          );
          autoAddedCount = res.autoAddedCount;
        } else if (
          isIgnored === 1 &&
          shouldClearSeeking &&
          ruleType === 'series'
        ) {
          clearedCount = await clearSeekingReleasesForSeries(
            env,
            sessionUser.id,
            matchValue,
          );
        }

        await invalidateEdgeApiCache(request.url, {
          userId: sessionUser.id,
          username: sessionUser.username,
        });
        await markDbDirty(env);

        return Response.json({
          success: true,
          rule: {
            rule_type: ruleType,
            match_value: matchValue,
            target_value: matchValue,
            target_status: targetStatus,
            region_scope: regionScope,
            is_ignored: isIgnored,
          },
          autoAddedCount,
          clearedCount,
        });
      }

      if (request.method === 'DELETE') {
        const ruleType = (url.searchParams.get('rule_type') || '').trim();
        const matchValue = (
          url.searchParams.get('match_value') ||
          url.searchParams.get('target_value') ||
          ''
        ).trim();
        const clearParam = (
          url.searchParams.get('clear_existing_seeking') ||
          url.searchParams.get('clearExistingSeeking') ||
          ''
        )
          .trim()
          .toLowerCase();
        const shouldClearSeeking = clearParam === '1' || clearParam === 'true';

        if (!ruleType || !matchValue) {
          return Response.json(
            { error: 'rule_type and match_value query params are required.' },
            { status: 400 },
          );
        }

        await env.DB.prepare(
          `DELETE FROM user_tracking_rules
           WHERE user_id = ? AND rule_type = ? AND match_value = ?`,
        )
          .bind(sessionUser.id, ruleType, matchValue)
          .run();

        let clearedCount = 0;
        if (shouldClearSeeking && ruleType === 'series') {
          clearedCount = await clearSeekingReleasesForSeries(
            env,
            sessionUser.id,
            matchValue,
          );
        }

        await invalidateEdgeApiCache(request.url, {
          userId: sessionUser.id,
          username: sessionUser.username,
        });
        await markDbDirty(env);
        return Response.json({ success: true, clearedCount });
      }

      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    // Endpoint: GET/POST /api/admin/plan-tier
    else if (path === '/api/admin/plan-tier') {
      if (!isAuthorizedAdmin(request, env, sessionUser)) {
        return Response.json(
          { error: 'Unauthorized: Admin authentication required.' },
          { status: 403 },
        );
      }

      if (request.method === 'GET') {
        const tier = await resolveWorkerPlanTier(env);
        return Response.json(
          { tier },
          { headers: { 'Cache-Control': 'private, no-cache, no-store' } },
        );
      }

      if (request.method === 'POST') {
        const body = (await request.json().catch(() => null)) as {
          tier?: string;
        } | null;
        if (body?.tier !== 'paid' && body?.tier !== 'free') {
          return Response.json(
            { error: "Invalid tier: expected 'paid' or 'free'." },
            { status: 400 },
          );
        }
        const nextTier: WorkerPlanTier = body.tier;
        const updatedAt = new Date().toISOString();
        await env.DB.prepare(
          `INSERT INTO sync_state (key, value, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
          .bind(WORKER_PLAN_TIER_KEY, nextTier, updatedAt)
          .run();
        return Response.json({
          success: true,
          tier: nextTier,
          updatedAt,
        });
      }

      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    // Endpoint: GET/POST /api/admin/catalog-seed
    else if (path === '/api/admin/catalog-seed') {
      if (!isAuthorizedAdmin(request, env, sessionUser)) {
        return Response.json(
          { error: 'Unauthorized: Admin authentication required.' },
          { status: 403 },
        );
      }

      if (request.method === 'GET') {
        const status = await getBroadCatalogSeedStatus(env);
        return Response.json(status, {
          headers: { 'Cache-Control': 'private, no-cache, no-store' },
        });
      }

      if (request.method === 'POST') {
        const body = (await request.json().catch(() => null)) as {
          runBatchNow?: boolean;
          runRollingRefreshNow?: boolean;
          runUnmatchedIgdbRetryNow?: boolean;
          runSeriesDiscoveryNow?: boolean;
          runNsCollectorsNow?: boolean;
          runRetailPreOrdersNow?: boolean;
          runPs5DbNow?: boolean;
          runSerialStationNow?: boolean;
          runWorkerDatsNow?: boolean;
        } | null;

        let batchResult: unknown = undefined;
        let rollingResult: unknown = undefined;
        let unmatchedRetryResult: unknown = undefined;
        let seriesDiscoveryResult: unknown = undefined;
        let nsCollectorsResult: unknown = undefined;
        let retailPreOrdersResult: unknown = undefined;
        let ps5DbResult: unknown = undefined;
        let serialStationResult: unknown = undefined;
        let workerDatsResult: unknown = undefined;
        if (body?.runBatchNow) {
          batchResult = await syncWorkerBroadCatalogPopulation(env);
          await invalidateEdgeApiCache(request.url);
        }
        if (body?.runRollingRefreshNow) {
          rollingResult = await syncWorkerIgdbSeriesAndCanonical(env);
          await invalidateEdgeApiCache(request.url);
        }
        if (body?.runUnmatchedIgdbRetryNow) {
          unmatchedRetryResult = await syncWorkerUnmatchedIgdbRetry(env);
          await invalidateEdgeApiCache(request.url);
        }
        if (body?.runSeriesDiscoveryNow) {
          seriesDiscoveryResult = await syncWorkerWatchedSeriesDiscovery(env);
          await invalidateEdgeApiCache(request.url);
        }
        if (body?.runNsCollectorsNow) {
          nsCollectorsResult = await syncWorkerNsCollectors(env);
          await invalidateEdgeApiCache(request.url);
        }
        if (body?.runRetailPreOrdersNow) {
          retailPreOrdersResult = await syncWorkerRetailPreOrders(env);
          await invalidateEdgeApiCache(request.url);
        }
        if (body?.runPs5DbNow) {
          ps5DbResult = await syncWorkerPs5Db(env);
          await invalidateEdgeApiCache(request.url);
        }
        if (body?.runSerialStationNow) {
          serialStationResult = await syncWorkerSerialStation(env, {
            force: true,
          });
          await invalidateEdgeApiCache(request.url);
        }
        if (body?.runWorkerDatsNow) {
          workerDatsResult = await syncWorkerDats(env, {
            force: true,
            mode: 'active',
          });
          await invalidateEdgeApiCache(request.url);
        }

        const status = await getBroadCatalogSeedStatus(env);
        return Response.json({
          success: true,
          status,
          batchResult,
          rollingResult,
          unmatchedRetryResult,
          seriesDiscoveryResult,
          nsCollectorsResult,
          retailPreOrdersResult,
          ps5DbResult,
          serialStationResult,
          workerDatsResult,
        });
      }

      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    // Endpoint: GET /api/catalog/games (?manifest=1 or ?chunk=<idx>&v=<version>)
    else if (request.method === 'GET' && path === '/api/catalog/games') {
      if (url.searchParams.get('manifest') === '1') {
        const manifestCacheKey = new Request(`${url.origin}${path}?manifest=1`);
        if (edgeCache && !isNoCache) {
          const cached = await edgeCache.match(manifestCacheKey);
          if (cached) {
            const hitHeaders = new Headers(cached.headers);
            hitHeaders.set('X-Cache-Status', 'HIT');
            if (!hitHeaders.has(X_CATALOG_SOURCE_HEADER)) {
              hitHeaders.set(X_CATALOG_SOURCE_HEADER, 'd1-edge-cache');
            }
            return new Response(cached.body, {
              status: cached.status,
              statusText: cached.statusText,
              headers: hitHeaders,
            });
          }
        }
        const manifest = await resolveCatalogManifest(env);
        if (manifest) {
          const manifestRes = Response.json(manifest, {
            headers: {
              'Cache-Control':
                'public, max-age=60, s-maxage=300, stale-while-revalidate=86400',
              [X_CATALOG_SOURCE_HEADER]: manifest.source || 'd1-edge-cache',
              'X-Cache-Status': 'MISS',
            },
          });
          if (edgeCache) {
            await putEdgeCacheEntry(
              edgeCache,
              manifestCacheKey,
              manifestRes,
              isNoCache,
              true,
            );
          }
          return manifestRes;
        }
        const recovered = await recoverCatalogManifestFromR2Chunks(
          env.BACKUP_BUCKET,
        );
        if (!recovered) {
          return buildD1QuotaExceededResponse();
        }
        return Response.json(
          { ...recovered.manifest, source: 'r2-backup' },
          {
            headers: buildR2DegradedHeaders(recovered.timestamp, {
              'Cache-Control': 'private, no-cache, no-store, must-revalidate',
              [X_CATALOG_SOURCE_HEADER]: 'r2-backup',
            }),
          },
        );
      }

      const rawChunk = url.searchParams.get('chunk') ?? '0';
      const chunkIndex = Number(rawChunk);
      if (
        !Number.isInteger(chunkIndex) ||
        chunkIndex < 0 ||
        chunkIndex > 1000
      ) {
        return Response.json(
          { error: 'Invalid chunk index parameter.' },
          { status: 400 },
        );
      }

      const versionParam = url.searchParams.get('v') || 'latest';
      const chunkCacheUrl = new URL(`${url.origin}${path}`);
      chunkCacheUrl.searchParams.set('chunk', String(chunkIndex));
      chunkCacheUrl.searchParams.set('v', versionParam);
      const chunkCacheKey = new Request(chunkCacheUrl.toString());

      const immutableCatalogHeaders = {
        'Content-Type': 'application/json',
        'Cache-Control':
          'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800, immutable',
        [X_CATALOG_SOURCE_HEADER]: 'd1-edge-cache',
        'X-Cache-Status': 'MISS',
      };
      const shortCatalogHeaders = {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60, s-maxage=60',
        [X_CATALOG_SOURCE_HEADER]: 'd1-edge-cache',
        'X-Cache-Status': 'MISS',
      };

      if (edgeCache && !isNoCache) {
        const cached = await edgeCache.match(chunkCacheKey);
        if (cached) {
          const hitHeaders = new Headers(cached.headers);
          hitHeaders.set('X-Cache-Status', 'HIT');
          if (!hitHeaders.has(X_CATALOG_SOURCE_HEADER)) {
            hitHeaders.set(X_CATALOG_SOURCE_HEADER, 'd1-edge-cache');
          }
          return new Response(cached.body, {
            status: cached.status,
            statusText: cached.statusText,
            headers: hitHeaders,
          });
        }
      }

      const activeManifest = await resolveCatalogManifest(env).catch(
        () => null,
      );

      if (activeManifest) {
        try {
          let rows: Array<Record<string, unknown>> = [];
          if (
            Array.isArray(activeManifest.chunkBounds) &&
            activeManifest.chunkBounds.length >= 2
          ) {
            if (chunkIndex < activeManifest.chunkCount) {
              const startStableId = activeManifest.chunkBounds[chunkIndex] ?? 0;
              const endStableId =
                activeManifest.chunkBounds[chunkIndex + 1] ??
                activeManifest.maxStableId;
              if (endStableId > startStableId) {
                const { results } = await env.DB.prepare(
                  buildCatalogGamesChunkQuery(),
                )
                  .bind(startStableId, endStableId)
                  .all();
                rows = (results as Array<Record<string, unknown>>) || [];
              }
            }
          } else {
            let startStableId = 0;
            if (chunkIndex > 0) {
              const startBoundRow = await env.DB.prepare(
                CATALOG_GAMES_CHUNK_BOUND_QUERY,
              )
                .bind(0, chunkIndex * CATALOG_GAMES_PER_CHUNK)
                .first<{ end_stable_id?: number }>();
              startStableId = Number(startBoundRow?.end_stable_id ?? 0);
            }
            if (chunkIndex === 0 || startStableId > 0) {
              const endBoundRow = await env.DB.prepare(
                CATALOG_GAMES_CHUNK_BOUND_QUERY,
              )
                .bind(startStableId, CATALOG_GAMES_PER_CHUNK)
                .first<{ end_stable_id?: number }>();
              const endStableId = Number(endBoundRow?.end_stable_id ?? 0);
              if (endStableId > startStableId) {
                const { results } = await env.DB.prepare(
                  buildCatalogGamesChunkQuery(),
                )
                  .bind(startStableId, endStableId)
                  .all();
                rows = (results as Array<Record<string, unknown>>) || [];
              }
            }
          }

          if (rows.length > 0) {
            postProcessGameListRows(rows, DEFAULT_USER_HOME_REGION);
          }

          const isVersionMatched =
            versionParam !== 'latest' &&
            versionParam === activeManifest.version;
          const d1Res = new Response(JSON.stringify(rows), {
            headers: isVersionMatched
              ? immutableCatalogHeaders
              : shortCatalogHeaders,
          });
          if (edgeCache && isVersionMatched) {
            await putEdgeCacheEntry(
              edgeCache,
              chunkCacheKey,
              d1Res,
              isNoCache,
              true,
            );
          }
          return d1Res;
        } catch {
          // Fall through to legacy R2 degraded fallback below on D1 outage
        }
      }

      if (env.BACKUP_BUCKET) {
        try {
          if (versionParam !== 'latest') {
            const versionedObj = await env.BACKUP_BUCKET.get(
              getCatalogChunkR2Key(chunkIndex, versionParam),
            );
            if (versionedObj) {
              const rawBody = versionedObj.body ?? (await versionedObj.text());
              return new Response(rawBody, {
                headers: buildR2DegradedHeaders(
                  versionedObj.customMetadata?.['timestamp'] ||
                    new Date().toISOString(),
                  {
                    'Content-Type': 'application/json',
                    'Cache-Control':
                      'private, no-cache, no-store, must-revalidate',
                    [X_CATALOG_SOURCE_HEADER]: 'r2-backup',
                  },
                ),
              });
            }
          }
          const r2Obj = await env.BACKUP_BUCKET.get(
            getCatalogChunkR2Key(chunkIndex),
          );
          if (r2Obj) {
            const rawBody = r2Obj.body ?? (await r2Obj.text());
            return new Response(rawBody, {
              headers: buildR2DegradedHeaders(
                r2Obj.customMetadata?.['timestamp'] || new Date().toISOString(),
                {
                  'Content-Type': 'application/json',
                  'Cache-Control':
                    'private, no-cache, no-store, must-revalidate',
                  [X_CATALOG_SOURCE_HEADER]: 'r2-backup',
                },
              ),
            });
          }
        } catch {
          // Fall through to 503 D1 outage response
        }
      }

      return buildD1QuotaExceededResponse();
    }

    // Endpoint: GET /api/catalog/toys
    else if (request.method === 'GET' && path === '/api/catalog/toys') {
      const versionParam = url.searchParams.get('v') || 'latest';
      const toyCacheUrl = new URL(`${url.origin}${path}`);
      toyCacheUrl.searchParams.set('v', versionParam);
      const toyCacheKey = new Request(toyCacheUrl.toString());
      const immutableCatalogHeaders = {
        'Content-Type': 'application/json',
        'Cache-Control':
          'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800, immutable',
        [X_CATALOG_SOURCE_HEADER]: 'd1-edge-cache',
        'X-Cache-Status': 'MISS',
      };

      if (edgeCache && !isNoCache) {
        const cached = await edgeCache.match(toyCacheKey);
        if (cached) {
          const hitHeaders = new Headers(cached.headers);
          hitHeaders.set('X-Cache-Status', 'HIT');
          if (!hitHeaders.has(X_CATALOG_SOURCE_HEADER)) {
            hitHeaders.set(X_CATALOG_SOURCE_HEADER, 'd1-edge-cache');
          }
          return new Response(cached.body, {
            status: cached.status,
            statusText: cached.statusText,
            headers: hitHeaders,
          });
        }
      }

      try {
        const { results } = await env.DB.prepare(
          buildToysListQuery(null),
        ).all();
        const rows = (results as Array<Record<string, unknown>>) || [];
        if (rows.length > 0) {
          postProcessToyListRows(rows, DEFAULT_USER_HOME_REGION);
        }
        const d1Res = new Response(JSON.stringify(rows), {
          headers: immutableCatalogHeaders,
        });
        if (edgeCache) {
          await putEdgeCacheEntry(
            edgeCache,
            toyCacheKey,
            d1Res,
            isNoCache,
            true,
          );
        }
        return d1Res;
      } catch {
        const snapshot = await loadToysSnapshotForFallback(env.BACKUP_BUCKET);
        if (!snapshot) {
          return buildD1QuotaExceededResponse();
        }
        const rows = buildToysListFromSnapshot(
          snapshot,
          null,
          DEFAULT_USER_HOME_REGION,
        );
        return new Response(JSON.stringify(rows), {
          headers: buildR2DegradedHeaders(snapshot.timestamp, {
            'Content-Type': 'application/json',
            'Cache-Control': 'private, no-cache, no-store, must-revalidate',
            [X_CATALOG_SOURCE_HEADER]: 'r2-backup',
          }),
        });
      }
    }

    // Endpoint: GET /api/user/collection-overlay
    else if (
      request.method === 'GET' &&
      path === '/api/user/collection-overlay'
    ) {
      const privateHeaders = {
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      };
      const rawSince = url.searchParams.get('since_stable_id');
      const sinceStableId = rawSince !== null ? Number(rawSince) : null;
      const userId = sessionUser ? sessionUser.id : null;
      const effectiveHomeRegion = sessionUser
        ? sessionUser.homeRegion
        : DEFAULT_USER_HOME_REGION;

      try {
        const payload = await buildCollectionOverlayPayload(
          env,
          userId,
          effectiveHomeRegion,
          sinceStableId,
          edgeCache,
        );
        return Response.json(payload, { headers: privateHeaders });
      } catch {
        const snapshot = await loadOverlaySnapshotForFallback(
          env.BACKUP_BUCKET,
        );
        if (!snapshot) {
          return buildD1QuotaExceededResponse();
        }
        const r2Ugr =
          userId !== null
            ? (snapshot.tables?.['user_game_releases'] || []).filter(
                (r) => Number(r['user_id']) === userId,
              )
            : [];
        const r2Ug =
          userId !== null
            ? (snapshot.tables?.['user_games'] || []).filter(
                (g) => Number(g['user_id']) === userId,
              )
            : [];
        const r2Ut =
          userId !== null
            ? (snapshot.tables?.['user_toys'] || []).filter(
                (t) => Number(t['user_id']) === userId,
              )
            : [];
        return Response.json(
          {
            version: snapshot.timestamp || '',
            timestamp: snapshot.timestamp || '',
            maxStableId: 0,
            ugr: r2Ugr,
            ug: r2Ug,
            ut: r2Ut,
            deltaGames: [],
          },
          {
            headers: buildR2DegradedHeaders(snapshot.timestamp, privateHeaders),
          },
        );
      }
    }

    // Endpoint: GET /api/u/:username/collection-overlay
    else if (
      request.method === 'GET' &&
      path.startsWith('/api/u/') &&
      path.endsWith('/collection-overlay')
    ) {
      const parts = path.split('/');
      const username = decodeURIComponent(parts[3] || '').trim();
      const rawSince = url.searchParams.get('since_stable_id');
      const sinceStableId = rawSince !== null ? Number(rawSince) : null;

      try {
        const user = (await env.DB.prepare(
          'SELECT id, username, home_region, is_public FROM users WHERE username = ? COLLATE NOCASE',
        )
          .bind(username)
          .first()) as {
          id: number;
          username: string;
          home_region: string | null;
          is_public: number;
        } | null;

        if (
          !user ||
          (!user.is_public && (!sessionUser || sessionUser.id !== user.id))
        ) {
          return Response.json({ error: 'User not found' }, { status: 404 });
        }

        const payload = await buildCollectionOverlayPayload(
          env,
          user.id,
          user.home_region || DEFAULT_USER_HOME_REGION,
          sinceStableId,
          edgeCache,
        );
        return Response.json(payload, {
          headers: {
            'Cache-Control': user.is_public
              ? 'public, max-age=60, s-maxage=60'
              : 'private, no-cache, no-store, must-revalidate',
          },
        });
      } catch {
        const snapshot = await loadOverlaySnapshotForFallback(
          env.BACKUP_BUCKET,
        );
        if (!snapshot) {
          return buildD1QuotaExceededResponse();
        }
        const user = resolvePublicUserFromSnapshot(snapshot, username);
        if (
          !user ||
          (!user.is_public && (!sessionUser || sessionUser.id !== user.id))
        ) {
          return Response.json({ error: 'User not found' }, { status: 404 });
        }
        const r2Ugr = (snapshot.tables?.['user_game_releases'] || []).filter(
          (r) => Number(r['user_id']) === user.id,
        );
        const r2Ug = (snapshot.tables?.['user_games'] || []).filter(
          (g) => Number(g['user_id']) === user.id,
        );
        const r2Ut = (snapshot.tables?.['user_toys'] || []).filter(
          (t) => Number(t['user_id']) === user.id,
        );
        return Response.json(
          {
            version: snapshot.timestamp || '',
            timestamp: snapshot.timestamp || '',
            maxStableId: 0,
            ugr: r2Ugr,
            ug: r2Ug,
            ut: r2Ut,
            deltaGames: [],
          },
          {
            headers: buildR2DegradedHeaders(snapshot.timestamp, {
              'Cache-Control': 'private, no-cache, no-store, must-revalidate',
            }),
          },
        );
      }
    }

    // Endpoint: GET /api/u/:username/games
    else if (path.startsWith('/api/u/') && path.endsWith('/games')) {
      const parts = path.split('/');
      const username = decodeURIComponent(parts[3] || '').trim();
      const platformId =
        url.searchParams.get('platform') || url.searchParams.get('platform_id');
      const includeUnowned = url.searchParams.get('include_unowned') === '1';

      try {
        const user = (await env.DB.prepare(
          'SELECT id, username, home_region, is_public FROM users WHERE username = ? COLLATE NOCASE',
        )
          .bind(username)
          .first()) as {
          id: number;
          username: string;
          home_region: string | null;
          is_public: number;
        } | null;

        if (
          !user ||
          (!user.is_public && (!sessionUser || sessionUser.id !== user.id))
        ) {
          return Response.json({ error: 'User not found' }, { status: 404 });
        }

        const homeRegion = user.home_region || 'USA';
        const { rows: results, isPartial } = await executeGamesListQuery(
          env.DB,
          user.id,
          homeRegion,
          platformId,
          includeUnowned,
        );

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'Cache-Control': user.is_public
            ? 'public, max-age=60, s-maxage=60'
            : 'private, no-cache, no-store, must-revalidate',
        };
        if (isPartial) {
          headers[X_CATALOG_PARTIAL_HEADER] = '1';
          headers[X_CATALOG_CHUNK_SIZE_HEADER] = String(
            CATALOG_GAMES_CHUNK_SIZE,
          );
        }
        const res = Response.json(results, { headers });
        if (user.is_public && isPublicCacheable && edgeCache) {
          await putEdgeCacheEntry(edgeCache, cacheKey, res, isNoCache);
        }
        return res;
      } catch {
        const snapshot = await loadGamesSnapshotForFallback(env.BACKUP_BUCKET);
        if (!snapshot) {
          return buildD1QuotaExceededResponse();
        }
        const user = resolvePublicUserFromSnapshot(snapshot, username);
        if (
          !user ||
          (!user.is_public && (!sessionUser || sessionUser.id !== user.id))
        ) {
          return Response.json({ error: 'User not found' }, { status: 404 });
        }
        const rows = buildGamesListFromSnapshot(
          snapshot,
          user.id,
          user.home_region || DEFAULT_USER_HOME_REGION,
          platformId,
        );
        return Response.json(rows, {
          headers: buildR2DegradedHeaders(snapshot.timestamp, {
            'Content-Type': 'application/json',
            'Cache-Control': 'private, no-cache, no-store, must-revalidate',
            [X_CATALOG_PARTIAL_HEADER]: '1',
            [X_CATALOG_CHUNK_SIZE_HEADER]: String(CATALOG_GAMES_CHUNK_SIZE),
          }),
        });
      }
    }

    // Endpoint: GET /api/u/:username/toys
    else if (path.startsWith('/api/u/') && path.endsWith('/toys')) {
      const parts = path.split('/');
      const username = decodeURIComponent(parts[3] || '').trim();
      try {
        const user = (await env.DB.prepare(
          'SELECT id, username, home_region, is_public FROM users WHERE username = ? COLLATE NOCASE',
        )
          .bind(username)
          .first()) as {
          id: number;
          username: string;
          home_region?: string | null;
          is_public: number;
        } | null;

        if (
          !user ||
          (!user.is_public && (!sessionUser || sessionUser.id !== user.id))
        ) {
          return Response.json({ error: 'User not found' }, { status: 404 });
        }

        const homeRegion = user.home_region || 'USA';
        const results = await executeToysListWithR2Catalog(
          env,
          user.id,
          homeRegion,
        );

        const res = Response.json(results || [], {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': user.is_public
              ? 'public, max-age=60, s-maxage=60'
              : 'private, no-cache, no-store, must-revalidate',
          },
        });
        if (user.is_public && isPublicCacheable && edgeCache) {
          await putEdgeCacheEntry(edgeCache, cacheKey, res, isNoCache);
        }
        return res;
      } catch {
        const snapshot = await loadToysSnapshotForFallback(env.BACKUP_BUCKET);
        if (!snapshot) {
          return buildD1QuotaExceededResponse();
        }
        const user = resolvePublicUserFromSnapshot(snapshot, username);
        if (
          !user ||
          (!user.is_public && (!sessionUser || sessionUser.id !== user.id))
        ) {
          return Response.json({ error: 'User not found' }, { status: 404 });
        }
        const rows = buildToysListFromSnapshot(
          snapshot,
          user.id,
          user.home_region || DEFAULT_USER_HOME_REGION,
        );
        return Response.json(rows, {
          headers: buildR2DegradedHeaders(snapshot.timestamp, {
            'Content-Type': 'application/json',
            'Cache-Control': 'private, no-cache, no-store, must-revalidate',
          }),
        });
      }
    }

    // Endpoint: GET /api/u/:username
    else if (path.startsWith('/api/u/') && !path.slice(7).includes('/')) {
      const username = decodeURIComponent(path.slice(7)).trim();
      try {
        const user = (await env.DB.prepare(
          'SELECT id, username, display_name, bio, home_region, is_public FROM users WHERE username = ? COLLATE NOCASE',
        )
          .bind(username)
          .first()) as {
          id: number;
          username: string;
          display_name: string | null;
          bio: string | null;
          home_region: string | null;
          is_public: number;
        } | null;

        if (
          !user ||
          (!user.is_public && (!sessionUser || sessionUser.id !== user.id))
        ) {
          return Response.json({ error: 'User not found' }, { status: 404 });
        }

        const res = Response.json(
          {
            username: user.username,
            displayName: user.display_name,
            bio: user.bio,
            homeRegion: user.home_region || 'USA',
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': user.is_public
                ? 'public, max-age=60, s-maxage=60'
                : 'private, no-cache, no-store, must-revalidate',
            },
          },
        );
        if (user.is_public && isPublicCacheable && edgeCache) {
          await putEdgeCacheEntry(edgeCache, cacheKey, res, isNoCache);
        }
        return res;
      } catch {
        const snapshot = await loadMetaSnapshotForFallback(env.BACKUP_BUCKET);
        if (!snapshot) {
          return buildD1QuotaExceededResponse();
        }
        const user = resolvePublicUserFromSnapshot(snapshot, username);
        if (
          !user ||
          (!user.is_public && (!sessionUser || sessionUser.id !== user.id))
        ) {
          return Response.json({ error: 'User not found' }, { status: 404 });
        }
        return Response.json(
          {
            username: user.username,
            displayName: user.display_name,
            bio: user.bio,
            homeRegion: user.home_region || 'USA',
          },
          {
            headers: buildR2DegradedHeaders(snapshot.timestamp, {
              'Content-Type': 'application/json',
              'Cache-Control': 'private, no-cache, no-store, must-revalidate',
            }),
          },
        );
      }
    }

    // Endpoint: GET /api/games
    else if (path === '/api/games') {
      const platformId =
        url.searchParams.get('platform') || url.searchParams.get('platform_id');
      const includeUnowned = url.searchParams.get('include_unowned') === '1';
      const userId = sessionUser ? sessionUser.id : null;
      const effectiveHomeRegion = sessionUser
        ? sessionUser.homeRegion
        : DEFAULT_USER_HOME_REGION;

      try {
        const { rows: results, isPartial } = await executeGamesListQuery(
          env.DB,
          userId,
          effectiveHomeRegion,
          platformId,
          includeUnowned,
        );
        const bodyJson = JSON.stringify(results);
        const partialHeaders: Record<string, string> = isPartial
          ? {
              [X_CATALOG_PARTIAL_HEADER]: '1',
              [X_CATALOG_CHUNK_SIZE_HEADER]: String(CATALOG_GAMES_CHUNK_SIZE),
            }
          : {};
        const cacheableRes = new Response(bodyJson, {
          headers: {
            ...publicCacheHeaders,
            ...partialHeaders,
          },
        });
        if ((isPublicCacheable || isUserEdgeCacheable) && edgeCache) {
          await putEdgeCacheEntry(edgeCache, cacheKey, cacheableRes, isNoCache);
        }
        if (sessionUser) {
          return new Response(bodyJson, {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'private, no-cache, no-store, must-revalidate',
              ...partialHeaders,
            },
          });
        }
        return cacheableRes;
      } catch {
        const snapshot = await loadGamesSnapshotForFallback(env.BACKUP_BUCKET);
        if (!snapshot) {
          return buildD1QuotaExceededResponse();
        }
        const rows = buildGamesListFromSnapshot(
          snapshot,
          userId,
          effectiveHomeRegion,
          platformId,
        );
        return new Response(JSON.stringify(rows), {
          headers: buildR2DegradedHeaders(snapshot.timestamp, {
            'Content-Type': 'application/json',
            'Cache-Control': 'private, no-cache, no-store, must-revalidate',
            [X_CATALOG_PARTIAL_HEADER]: '1',
            [X_CATALOG_CHUNK_SIZE_HEADER]: String(CATALOG_GAMES_CHUNK_SIZE),
          }),
        });
      }
    }

    // Endpoint: GET /api/games/:id
    else if (path.startsWith('/api/games/')) {
      const id = path.split('/').pop() || '';
      const releaseId = (url.searchParams.get('release') || '').trim() || null;
      const userId = sessionUser ? sessionUser.id : null;
      const effectiveHomeRegion = sessionUser
        ? sessionUser.homeRegion
        : DEFAULT_USER_HOME_REGION;

      try {
        const query = buildGameDetailQuery(userId);
        const params = getGameDetailQueryParams(id, userId, releaseId);
        const game = (await env.DB.prepare(query)
          .bind(...params)
          .first()) as DbGame | null;

        if (!game)
          return Response.json({ error: 'Not found' }, { status: 404 });

        const targetKey = getRomGroupingKey(game.rom_name);
        const isMulti = targetKey.startsWith('multi:');
        const releaseParams = userId
          ? isMulti
            ? [userId, game.stable_id]
            : [userId, game.stable_id, game.region]
          : isMulti
            ? [game.stable_id]
            : [game.stable_id, game.region];
        const releaseQuery = buildGameReleasesByGameIdQuery(userId, isMulti);
        const { results } = await env.DB.prepare(releaseQuery)
          .bind(...releaseParams)
          .all();
        const typedResults = (results || []) as Array<
          Record<string, unknown> & {
            id?: string;
            rom_name?: string | null;
            region?: string | null;
            variants?: string | null;
          }
        >;

        applyGameDetailReleasePartitionAndTitles(
          game,
          typedResults,
          effectiveHomeRegion,
        );

        if (game.platform_id) {
          const candidateReleases: CompanionDiscCandidateRow[] = [];
          const seenCandidateIds = new Set<string>();

          const companionGameIdQuery =
            buildTargetedCompanionByGameIdQuery(userId);
          const companionTitleQuery =
            buildTargetedCompanionByTitleQuery(userId);

          // 1. Target companion releases by rom_crc across all releases in this game in a single batch query
          const releasesToCheck =
            game.releases && game.releases.length > 0 ? game.releases : [game];
          const primaryReleaseIds = new Set<string>();
          const distinctCrcs: string[] = [];
          const seenCrcs = new Set<string>();
          for (const rel of releasesToCheck) {
            const relId = (rel['id'] as string | null) || null;
            if (relId) primaryReleaseIds.add(relId);
            const relCrc = (rel['rom_crc'] as string | null)?.trim() || '';
            if (relCrc && !seenCrcs.has(relCrc)) {
              seenCrcs.add(relCrc);
              distinctCrcs.push(relCrc);
            }
          }
          if (distinctCrcs.length > 0) {
            const companionCrcBatchQuery =
              buildTargetedCompanionByCrcBatchQuery(
                userId,
                distinctCrcs.length,
              );
            const bindParams = userId
              ? [userId, ...distinctCrcs]
              : [...distinctCrcs];
            const { results: crcRows } = await env.DB.prepare(
              companionCrcBatchQuery,
            )
              .bind(...bindParams)
              .all();
            for (const r of (crcRows ||
              []) as unknown as CompanionDiscCandidateRow[]) {
              if (!primaryReleaseIds.has(r.id) && !seenCandidateIds.has(r.id)) {
                seenCandidateIds.add(r.id);
                candidateReleases.push(r);
              }
            }
          }

          // 2. Target companion releases by related game IDs (e.g. Superseded pairs)
          const relatedIds = getRelatedGameIdsForCompanion(game);
          for (const relStableId of relatedIds) {
            const bindParams = userId ? [userId, relStableId] : [relStableId];
            const { results: idRows } = await env.DB.prepare(
              companionGameIdQuery,
            )
              .bind(...bindParams)
              .all();
            for (const r of (idRows ||
              []) as unknown as CompanionDiscCandidateRow[]) {
              if (!seenCandidateIds.has(r.id)) {
                seenCandidateIds.add(r.id);
                candidateReleases.push(r);
              }
            }
          }

          // 3. Target companion releases by related game titles (e.g. Box sets and standalone counterparts)
          const relatedTitles = getRelatedGameTitlesForCompanion(game);
          for (const title of relatedTitles) {
            const bindParams = userId
              ? [userId, game.platform_id, title]
              : [game.platform_id, title];
            const { results: titleRows } = await env.DB.prepare(
              companionTitleQuery,
            )
              .bind(...bindParams)
              .all();
            for (const r of (titleRows ||
              []) as unknown as CompanionDiscCandidateRow[]) {
              if (!seenCandidateIds.has(r.id)) {
                seenCandidateIds.add(r.id);
                candidateReleases.push(r);
              }
            }
          }

          enrichGameDetailWithCompanionsAndVouchers(game, candidateReleases);
        }

        if (game.stable_id) {
          const bundledQuery = buildBundledGamesByParentQuery(userId);
          const bundledParams = userId
            ? [userId, game.stable_id]
            : [game.stable_id];
          const { results: bundled } = await env.DB.prepare(bundledQuery)
            .bind(...bundledParams)
            .all();
          game.bundled_games = (bundled || []).map((row) => ({
            ...row,
            platform_id: (row as { platform_id: number }).platform_id,
          }));
        }

        if (sessionUser) {
          return Response.json(game, {
            headers: {
              'Cache-Control': 'private, no-cache, no-store, must-revalidate',
            },
          });
        }

        return new Response(JSON.stringify(game), {
          headers: publicCacheHeaders,
        });
      } catch {
        const snapshot = await loadGamesSnapshotForFallback(env.BACKUP_BUCKET);
        if (!snapshot) {
          return buildD1QuotaExceededResponse();
        }
        const game = buildGameDetailFromSnapshot(
          snapshot,
          id,
          userId,
          effectiveHomeRegion,
          releaseId,
        );
        if (!game) {
          return Response.json({ error: 'Not found' }, { status: 404 });
        }
        return Response.json(game, {
          headers: buildR2DegradedHeaders(snapshot.timestamp, {
            'Cache-Control': 'private, no-cache, no-store, must-revalidate',
          }),
        });
      }
    }

    // Endpoint: GET /api/toys
    else if (path === '/api/toys') {
      const userId = sessionUser ? sessionUser.id : null;
      const effectiveHomeRegion = sessionUser
        ? sessionUser.homeRegion
        : DEFAULT_USER_HOME_REGION;

      try {
        const results = await executeToysListWithR2Catalog(
          env,
          userId,
          effectiveHomeRegion,
        );
        const bodyJson = JSON.stringify(results || []);
        const cacheableRes = new Response(bodyJson, {
          headers: publicCacheHeaders,
        });
        if ((isPublicCacheable || isUserEdgeCacheable) && edgeCache) {
          await putEdgeCacheEntry(edgeCache, cacheKey, cacheableRes, isNoCache);
        }
        if (sessionUser) {
          return new Response(bodyJson, {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'private, no-cache, no-store, must-revalidate',
            },
          });
        }
        return cacheableRes;
      } catch {
        const snapshot = await loadToysSnapshotForFallback(env.BACKUP_BUCKET);
        if (!snapshot) {
          return buildD1QuotaExceededResponse();
        }
        const rows = buildToysListFromSnapshot(
          snapshot,
          userId,
          effectiveHomeRegion,
        );
        return new Response(JSON.stringify(rows), {
          headers: buildR2DegradedHeaders(snapshot.timestamp, {
            'Content-Type': 'application/json',
            'Cache-Control': 'private, no-cache, no-store, must-revalidate',
          }),
        });
      }
    }

    // Endpoint: GET /api/toys/:id
    else if (path.startsWith('/api/toys/')) {
      const id = path.split('/').pop() || '';
      const userId = sessionUser ? sessionUser.id : null;
      try {
        const query = buildToyDetailQuery(userId);
        const toy = userId
          ? await env.DB.prepare(query).bind(userId, id).first()
          : await env.DB.prepare(query).bind(id).first();
        if (!toy) return Response.json({ error: 'Not found' }, { status: 404 });
        if (sessionUser) {
          return Response.json(toy, {
            headers: {
              'Cache-Control': 'private, no-cache, no-store, must-revalidate',
            },
          });
        }
        return new Response(JSON.stringify(toy), {
          headers: publicCacheHeaders,
        });
      } catch {
        const snapshot = await loadToysSnapshotForFallback(env.BACKUP_BUCKET);
        if (!snapshot) {
          return buildD1QuotaExceededResponse();
        }
        const toy = buildToyDetailFromSnapshot(snapshot, id, userId);
        if (!toy) return Response.json({ error: 'Not found' }, { status: 404 });
        return Response.json(toy, {
          headers: buildR2DegradedHeaders(snapshot.timestamp, {
            'Cache-Control': 'private, no-cache, no-store, must-revalidate',
          }),
        });
      }
    }

    // Endpoint: GET /api/platforms
    else if (path === '/api/platforms') {
      try {
        const query = PLATFORMS_LIST_QUERY;
        const { results } = await env.DB.prepare(query).all();
        const res = new Response(JSON.stringify(results || []), {
          headers: platformsCacheHeaders,
        });
        if ((isPublicCacheable || isUserEdgeCacheable) && edgeCache) {
          await putEdgeCacheEntry(edgeCache, cacheKey, res, isNoCache);
        }
        return res;
      } catch {
        const snapshot = await loadMetaSnapshotForFallback(env.BACKUP_BUCKET);
        if (!snapshot) {
          return buildD1QuotaExceededResponse();
        }
        const rows = buildPlatformsFromSnapshot(snapshot);
        return new Response(JSON.stringify(rows), {
          headers: buildR2DegradedHeaders(snapshot.timestamp, {
            'Content-Type': 'application/json',
            'Cache-Control': 'private, no-cache, no-store, must-revalidate',
          }),
        });
      }
    }

    // Endpoint: GET /api/auth/login, /api/admin/login, /admin/login
    else if (
      path === '/api/auth/login' ||
      path === '/api/admin/login' ||
      path === '/admin/login'
    ) {
      const returnTo = sanitizeReturnToPath(
        url.searchParams.get('return_to'),
        url.origin,
        '/collection/games',
      );

      const oidcIssuer = getOidcIssuer(env);
      const isSecure = isSecureOrigin(url);
      const prompt = url.searchParams.get('prompt')?.trim() || '';

      if (oidcIssuer && url.searchParams.get('dev_bypass') !== '1') {
        const sessionSecret = getSessionSecret(env, url);
        if (!sessionSecret) {
          return Response.json(
            { error: 'Server session secret not configured.' },
            { status: 500 },
          );
        }

        const codeVerifier = generateRandomBase64Url(32);
        const codeChallenge = await computePkceCodeChallenge(codeVerifier);
        const state = generateRandomBase64Url(24);
        const nonce = generateRandomBase64Url(24);
        const redirectUri = new URL(
          '/api/auth/callback',
          request.url,
        ).toString();

        const stateToken = await signOidcStateCookie(
          {
            state,
            nonce,
            codeVerifier,
            redirectUri,
            returnTo,
            silent: prompt === 'none',
            exp: Math.floor(Date.now() / 1000) + OIDC_STATE_TTL_SECONDS,
          },
          sessionSecret,
        );

        const authorizeUrl = new URL(`${oidcIssuer}/authorize`);
        authorizeUrl.searchParams.set('response_type', 'code');
        authorizeUrl.searchParams.set('client_id', getOidcClientId(env));
        authorizeUrl.searchParams.set('redirect_uri', redirectUri);
        authorizeUrl.searchParams.set('scope', 'openid profile email');
        authorizeUrl.searchParams.set('state', state);
        authorizeUrl.searchParams.set('nonce', nonce);
        authorizeUrl.searchParams.set('code_challenge', codeChallenge);
        authorizeUrl.searchParams.set('code_challenge_method', 'S256');
        if (prompt) {
          authorizeUrl.searchParams.set('prompt', prompt);
        }

        return new Response(null, {
          status: 302,
          headers: {
            Location: authorizeUrl.toString(),
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Set-Cookie': serializeOidcStateCookie(
              stateToken,
              isSecure,
              OIDC_STATE_TTL_SECONDS,
            ),
            'x-auth-status': 'oidc-redirect',
          },
        });
      }

      // Local loopback development fallback when OIDC_ISSUER is not configured
      if (!isLoopbackRequest(url)) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: new URL('/', request.url).toString(),
            'x-auth-status': 'missing-oidc-config',
          },
        });
      }

      const userRow = (await env.DB.prepare(
        'SELECT id, username, is_public, home_region, display_name, bio FROM users WHERE id = 1',
      ).first()) as DbUserRow | null;

      if (!userRow) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: new URL('/?account=missing', request.url).toString(),
            'x-auth-status': 'user-not-found',
          },
        });
      }

      const sessionSecret = getSessionSecret(env, url);
      if (!sessionSecret) {
        return Response.json(
          { error: 'Server session secret not configured.' },
          { status: 500 },
        );
      }

      const sessionDays = env.ADMIN_SESSION_DAYS
        ? parseInt(env.ADMIN_SESSION_DAYS, 10)
        : DEFAULT_SESSION_DAYS;
      const validDays =
        isNaN(sessionDays) || sessionDays <= 0
          ? DEFAULT_SESSION_DAYS
          : sessionDays;
      const maxAge = validDays * 24 * 60 * 60;

      const sessionPayloadUser: SessionUser = {
        id: userRow.id,
        username: userRow.username,
        role: 'admin',
        homeRegion: userRow.home_region || 'USA',
      };
      const sessionToken = await signSession(
        sessionPayloadUser,
        sessionSecret,
        validDays,
      );

      const targetUrl = new URL(returnTo, request.url).toString();
      const res = new Response(null, {
        status: 302,
        headers: {
          Location: targetUrl,
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'x-auth-status': 'session-minted',
        },
      });

      res.headers.append(
        'Set-Cookie',
        serializeSessionCookie(sessionToken, isSecure, maxAge),
      );

      return res;
    }

    // Endpoint: GET /api/auth/callback (OIDC Authorization Code + PKCE S256 callback)
    else if (path === '/api/auth/callback') {
      const isSecure = isSecureOrigin(url);
      const sessionSecret = getSessionSecret(env, url);
      const cookies = parseCookies(request.headers.get('Cookie'));
      const stateCookieToken = readOidcStateCookie(cookies);
      const statePayload =
        stateCookieToken && sessionSecret
          ? await verifyOidcStateCookie(stateCookieToken, sessionSecret)
          : null;

      const buildCallbackErrorRedirect = (
        redirectPath: string,
        authStatus: string,
      ): Response => {
        const errRes = new Response(null, {
          status: 302,
          headers: {
            Location: new URL(redirectPath, request.url).toString(),
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'x-auth-status': authStatus,
          },
        });
        for (const c of serializeClearOidcStateCookies(isSecure)) {
          errRes.headers.append('Set-Cookie', c);
        }
        return errRes;
      };

      const oauthError = url.searchParams.get('error');
      if (oauthError) {
        let redirectPath =
          oauthError === 'access_denied'
            ? '/?account=missing'
            : `/?auth_error=${encodeURIComponent(oauthError)}`;
        if (statePayload?.silent || oauthError === 'login_required') {
          redirectPath = '/?sso=checked';
        }
        return buildCallbackErrorRedirect(redirectPath, 'oidc-error');
      }

      const code = (url.searchParams.get('code') || '').trim();
      const state = (url.searchParams.get('state') || '').trim();
      const oidcIssuer = getOidcIssuer(env);
      if (!code || !state || !oidcIssuer || !sessionSecret) {
        return buildCallbackErrorRedirect(
          statePayload?.silent
            ? '/?sso=checked'
            : '/?auth_error=invalid_callback',
          'invalid-callback',
        );
      }

      if (!statePayload || !timingSafeEqualStrings(statePayload.state, state)) {
        return buildCallbackErrorRedirect(
          '/?auth_error=invalid_state',
          'invalid-state',
        );
      }

      const clientId = getOidcClientId(env);
      const tokenBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri:
          statePayload.redirectUri ||
          new URL('/api/auth/callback', request.url).toString(),
        client_id: clientId,
        code_verifier: statePayload.codeVerifier,
      });

      const tokenRes = await fetch(`${oidcIssuer}/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: tokenBody.toString(),
      });

      if (!tokenRes.ok) {
        return buildCallbackErrorRedirect(
          statePayload?.silent
            ? '/?sso=checked'
            : '/?auth_error=token_exchange_failed',
          'token-exchange-failed',
        );
      }

      const tokenData = (await tokenRes.json().catch(() => null)) as {
        id_token?: string;
        access_token?: string;
      } | null;

      if (!tokenData?.id_token) {
        return buildCallbackErrorRedirect(
          statePayload?.silent
            ? '/?sso=checked'
            : '/?auth_error=missing_id_token',
          'missing-id-token',
        );
      }

      const claims = await verifyOidcIdToken(tokenData.id_token, {
        issuer: oidcIssuer,
        clientId,
        expectedNonce: statePayload.nonce,
      });

      if (!claims) {
        return buildCallbackErrorRedirect(
          statePayload?.silent
            ? '/?sso=checked'
            : '/?auth_error=invalid_id_token',
          'invalid-id-token',
        );
      }

      const userRow = await syncOrResolveOidcUser(env, claims, request.url);
      const claimRole: 'admin' | 'user' =
        claims.role === 'admin' ? 'admin' : 'user';
      const sessionDays = env.ADMIN_SESSION_DAYS
        ? parseInt(env.ADMIN_SESSION_DAYS, 10)
        : DEFAULT_SESSION_DAYS;
      const validDays =
        isNaN(sessionDays) || sessionDays <= 0
          ? DEFAULT_SESSION_DAYS
          : sessionDays;
      const maxAge = validDays * 24 * 60 * 60;

      const sessionPayloadUser: SessionUser = {
        id: userRow.id,
        username: userRow.username,
        role: claimRole,
        homeRegion: userRow.home_region || 'USA',
      };
      const sessionToken = await signSession(
        sessionPayloadUser,
        sessionSecret,
        validDays,
      );

      const returnTo = sanitizeReturnToPath(
        statePayload.returnTo,
        url.origin,
        '/collection/games',
      );
      const targetUrl = new URL(returnTo, request.url).toString();
      const res = new Response(null, {
        status: 302,
        headers: {
          Location: targetUrl,
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'x-auth-status': 'session-minted',
        },
      });
      res.headers.append(
        'Set-Cookie',
        serializeSessionCookie(sessionToken, isSecure, maxAge),
      );
      for (const c of serializeClearOidcStateCookies(isSecure)) {
        res.headers.append('Set-Cookie', c);
      }
      if (edgeCache) {
        await edgeCache
          .delete(
            new Request(
              `https://edge-cache.internal/auth-me/user:${userRow.id}`,
            ),
          )
          .catch(() => {});
      }
      return res;
    }

    // Endpoint: GET /api/auth/account (Redirect to Centralized OIDC Account Hub)
    else if (path === '/api/auth/account') {
      const accountHubUrl =
        getAccountHubUrl(env) || new URL('/', request.url).toString();
      return new Response(null, {
        status: 302,
        headers: {
          Location: accountHubUrl,
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      });
    }

    // Endpoint: POST /api/auth/logout, /api/admin/logout, /admin/logout
    else if (
      path === '/api/auth/logout' ||
      path === '/api/admin/logout' ||
      path === '/admin/logout'
    ) {
      if (request.method !== 'POST') {
        return Response.json(
          { error: 'Method Not Allowed: Use POST to log out.' },
          { status: 405, headers: { Allow: 'POST' } },
        );
      }

      const oidcIssuer = getOidcIssuer(env);
      const returnUrl = new URL('/', request.url).toString();
      const isLocalDev = isLoopbackRequest(url);
      const isSilent =
        url.searchParams.get('silent') === '1' ||
        url.searchParams.get('frontchannel') === '1';
      const targetRedirect =
        oidcIssuer && !isLocalDev
          ? `${oidcIssuer}/logout?post_logout_redirect_uri=${encodeURIComponent(returnUrl)}&client_id=${encodeURIComponent(getOidcClientId(env))}`
          : '/';
      const isSecure = isSecureOrigin(url);

      let res: Response;
      if (isSilent) {
        const reqOrigin = request.headers.get('Origin');
        const allowCorsOrigin =
          reqOrigin &&
          (reqOrigin === url.origin ||
            (oidcIssuer && reqOrigin === oidcIssuer) ||
            (isLocalDev && LOOPBACK_DEV_ORIGINS.has(reqOrigin)));
        const headers = new Headers({
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        });
        if (allowCorsOrigin) {
          headers.set('Access-Control-Allow-Origin', reqOrigin);
          headers.set('Access-Control-Allow-Credentials', 'true');
          headers.set('Vary', 'Origin');
        }
        res = new Response(JSON.stringify({ ok: true, success: true }), {
          status: 200,
          headers,
        });
      } else {
        res = new Response(null, {
          status: 303,
          headers: {
            Location: targetRedirect,
            'Cache-Control': 'no-store, no-cache, must-revalidate',
          },
        });
      }
      for (const c of serializeClearSessionCookies(isSecure)) {
        res.headers.append('Set-Cookie', c);
      }
      for (const c of serializeClearOidcStateCookies(isSecure)) {
        res.headers.append('Set-Cookie', c);
      }
      res.headers.append(
        'Set-Cookie',
        `CF_AppSession=; Path=/; Domain=${url.hostname}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
      );
      res.headers.append(
        'Set-Cookie',
        'CF_AppSession=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; SameSite=Lax',
      );
      res.headers.append(
        'Set-Cookie',
        `app_admin_session=; Path=/; Domain=${url.hostname}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; SameSite=Lax`,
      );
      res.headers.append(
        'Set-Cookie',
        'app_admin_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; SameSite=Lax',
      );
      res.headers.append(
        'Set-Cookie',
        `CF_Authorization=; Path=/; Domain=${url.hostname}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
      );
      res.headers.append(
        'Set-Cookie',
        'CF_Authorization=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
      );
      return res;
    }

    // Endpoint: GET /api/admin/me
    else if (path === '/api/admin/me') {
      const cookieHeader = request.headers.get('Cookie') || '';
      const hasCookie = Boolean(readSessionCookie(parseCookies(cookieHeader)));
      const authorized = isAuthorizedAdmin(request, env, sessionUser);
      return Response.json({
        authenticated: Boolean(sessionUser || authorized),
        authorized,
        hasCookie,
        email: authorized ? env.ADMIN_EMAIL || 'admin' : null,
      });
    }

    /**
     * AUTHENTICATED MUTATION ENDPOINTS
     */

    // Endpoint: POST /api/collection/toggle
    else if (request.method === 'POST' && path === '/api/collection/toggle') {
      const body = (await request.json().catch(() => null)) as {
        id?: string;
        type?: 'game' | 'toy';
        status?: number | string | boolean;
        field?: string;
      } | null;

      if (!body || typeof body !== 'object' || !body.id || !body.type) {
        return Response.json(
          { error: 'Invalid toggle payload' },
          { status: 400 },
        );
      }

      const { id, type, status, field = 'ownership_status' } = body;

      if (type !== 'game' && type !== 'toy') {
        return Response.json(
          { error: `Invalid item type: ${String(type)}` },
          { status: 400 },
        );
      }

      const allowedFields = [
        'ownership_status',
        'play_status',
        'has_media',
        'has_case',
        'has_manual',
        'queued',
      ];
      if (!allowedFields.includes(field)) {
        return Response.json(
          { error: `Invalid field: ${field}` },
          { status: 400 },
        );
      }

      if (type === 'toy' && field !== 'ownership_status') {
        return Response.json(
          { error: `Field ${field} is not supported for toys.` },
          { status: 400 },
        );
      }

      // Validate status domain by field
      if (field === 'ownership_status' || field === 'play_status') {
        const numStatus = Number(status);
        if (
          typeof status === 'boolean' ||
          !Number.isInteger(numStatus) ||
          numStatus < 0 ||
          numStatus > 5
        ) {
          return Response.json(
            { error: `Invalid ${field} value: ${String(status)}` },
            { status: 400 },
          );
        }
      } else {
        // has_media, has_case, has_manual, queued
        if (
          status !== 0 &&
          status !== 1 &&
          status !== true &&
          status !== false
        ) {
          return Response.json(
            { error: `Invalid boolean/integer flag for ${field}` },
            { status: 400 },
          );
        }
      }

      const normalizedStatus =
        typeof status === 'boolean' ? (status ? 1 : 0) : status!;

      // Personal state mutation: requires logged-in session user
      if (!sessionUser) {
        return Response.json(
          { error: 'Unauthorized: Authentication required.' },
          { status: 401 },
        );
      }

      const currentUserId = sessionUser ? sessionUser.id : 1;

      if (type === 'game') {
        if (field === 'play_status' || field === 'queued') {
          let stableId: number | null = null;
          const release = (await env.DB.prepare(
            'SELECT game_id FROM game_releases WHERE id = ?',
          )
            .bind(id)
            .first()) as { game_id: number } | null;
          if (release) {
            stableId = release.game_id;
          } else {
            const game = (await env.DB.prepare(
              'SELECT stable_id FROM games WHERE id = ?',
            )
              .bind(id)
              .first()) as { stable_id: number } | null;
            if (game) stableId = game.stable_id;
          }

          if (stableId === null) {
            return Response.json(
              { error: `Could not find game/release with ID: ${id}` },
              { status: 404 },
            );
          }

          await env.DB.prepare(
            `INSERT INTO user_games (user_id, game_id, ${field}, updated_at)
               VALUES (?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(user_id, game_id) DO UPDATE SET
                 ${field} = excluded.${field},
                 updated_at = CURRENT_TIMESTAMP
               WHERE user_games.${field} IS NOT excluded.${field}`,
          )
            .bind(currentUserId, stableId, normalizedStatus)
            .run();
        } else {
          // ownership_status, has_case, has_manual, or has_media on user_game_releases
          let toggledGameStableId: number | null = null;
          const release = (await env.DB.prepare(
            'SELECT id, game_id, region, variants, rom_name FROM game_releases WHERE id = ?',
          )
            .bind(id)
            .first()) as {
            id: string;
            game_id: number;
            region: string | null;
            variants: string | null;
            rom_name: string | null;
          } | null;

          if (release) {
            toggledGameStableId = release.game_id;
            if (
              field === 'ownership_status' ||
              field === 'has_case' ||
              field === 'has_manual'
            ) {
              const { results: allReleases } = await env.DB.prepare(
                'SELECT id, region, variants, rom_name FROM game_releases WHERE game_id = ?',
              )
                .bind(release.game_id)
                .all();

              const targetKey = getRomGroupingKey(release.rom_name);
              const typedReleases = (allReleases || []) as {
                id: string;
                region: string | null;
                variants: string | null;
                rom_name: string | null;
              }[];

              const matchingReleases = typedReleases.filter(
                (r) =>
                  r.region === release.region &&
                  r.variants === release.variants &&
                  getRomGroupingKey(r.rom_name) === targetKey,
              );

              const statements = matchingReleases.map((r) =>
                env.DB.prepare(
                  `INSERT INTO user_game_releases (user_id, release_id, ${field})
                     VALUES (?, ?, ?)
                     ON CONFLICT(user_id, release_id) DO UPDATE SET
                       ${field} = excluded.${field}
                     WHERE user_game_releases.${field} IS NOT excluded.${field}`,
                ).bind(currentUserId, r.id, normalizedStatus),
              );
              if (statements.length > 0) {
                await env.DB.batch(statements);
              }
            } else {
              await env.DB.prepare(
                `INSERT INTO user_game_releases (user_id, release_id, ${field})
                   VALUES (?, ?, ?)
                   ON CONFLICT(user_id, release_id) DO UPDATE SET
                     ${field} = excluded.${field}
                   WHERE user_game_releases.${field} IS NOT excluded.${field}`,
              )
                .bind(currentUserId, id, normalizedStatus)
                .run();
            }
          } else {
            const game = (await env.DB.prepare(
              'SELECT stable_id, region FROM games WHERE id = ?',
            )
              .bind(id)
              .first()) as {
              stable_id: number;
              region: string | null;
            } | null;

            if (!game) {
              return Response.json(
                { error: `Game or Release not found: ${id}` },
                { status: 404 },
              );
            }
            toggledGameStableId = game.stable_id;

            const { results: releases } = await env.DB.prepare(
              'SELECT id FROM game_releases WHERE game_id = ? ORDER BY id ASC',
            )
              .bind(game.stable_id)
              .all();

            const typedReleases = (releases || []) as { id: string }[];
            if (typedReleases.length > 0) {
              if (
                field === 'ownership_status' ||
                field === 'has_case' ||
                field === 'has_manual'
              ) {
                const statements = typedReleases.map((r) =>
                  env.DB.prepare(
                    `INSERT INTO user_game_releases (user_id, release_id, ${field})
                       VALUES (?, ?, ?)
                       ON CONFLICT(user_id, release_id) DO UPDATE SET
                         ${field} = excluded.${field}
                       WHERE user_game_releases.${field} IS NOT excluded.${field}`,
                  ).bind(currentUserId, r.id, normalizedStatus),
                );
                await env.DB.batch(statements);
              } else {
                await env.DB.prepare(
                  `INSERT INTO user_game_releases (user_id, release_id, ${field})
                     VALUES (?, ?, ?)
                     ON CONFLICT(user_id, release_id) DO UPDATE SET
                       ${field} = excluded.${field}
                     WHERE user_game_releases.${field} IS NOT excluded.${field}`,
                )
                  .bind(currentUserId, typedReleases[0].id, normalizedStatus)
                  .run();
              }
            } else {
              if (!isAuthorizedAdmin(request, env, sessionUser)) {
                return Response.json(
                  { error: `No physical releases found for game: ${id}` },
                  { status: 404 },
                );
              }
              const releaseId = `${id}-default`;
              await env.DB.prepare(
                `INSERT OR IGNORE INTO game_releases (id, game_id, region)
                   VALUES (?, ?, ?)`,
              )
                .bind(releaseId, game.stable_id, game.region)
                .run();

              await env.DB.prepare(
                `INSERT INTO user_game_releases (user_id, release_id, ${field})
                   VALUES (?, ?, ?)
                   ON CONFLICT(user_id, release_id) DO UPDATE SET
                     ${field} = excluded.${field}
                   WHERE user_game_releases.${field} IS NOT excluded.${field}`,
              )
                .bind(currentUserId, releaseId, normalizedStatus)
                .run();
            }
          }

          if (
            field === 'ownership_status' &&
            Number(normalizedStatus) > 0 &&
            toggledGameStableId !== null
          ) {
            await applyReactiveSeriesAutoTracking(
              env,
              currentUserId,
              toggledGameStableId,
            );
          }
        }
      } else {
        // Toys update: verify toy exists in catalog first
        const existingToy = await env.DB.prepare(
          'SELECT 1 FROM toys WHERE id = ?',
        )
          .bind(id)
          .first();
        if (!existingToy) {
          return Response.json(
            { error: `Toy not found: ${id}` },
            { status: 404 },
          );
        }

        await env.DB.prepare(
          `INSERT INTO user_toys (user_id, toy_id, ${field}, updated_at)
             VALUES (?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(user_id, toy_id) DO UPDATE SET
               ${field} = excluded.${field},
               updated_at = CURRENT_TIMESTAMP
             WHERE user_toys.${field} IS NOT excluded.${field}`,
        )
          .bind(currentUserId, id, normalizedStatus)
          .run();
      }

      await invalidateEdgeApiCache(request.url, {
        userId: currentUserId,
        username: sessionUser?.username,
      });
      await markDbDirty(env, type === 'game' ? 'games' : 'toys', id, {
        clearBoutiqueHash: type === 'game' && field === 'ownership_status',
      });
      return Response.json({ success: true });
    }

    // Endpoint: POST /api/admin/verify-ownership/apply
    else if (
      request.method === 'POST' &&
      path === '/api/admin/verify-ownership/apply'
    ) {
      if (!isAuthorizedAdmin(request, env, sessionUser)) {
        return Response.json(
          {
            error: sessionUser
              ? 'Forbidden: Admin authentication required.'
              : 'Unauthorized: Admin authentication required.',
          },
          { status: sessionUser ? 403 : 401 },
        );
      }

      const body = (await request.json().catch(() => null)) as {
        setMediaOwned?: unknown;
        clearMediaOwned?: unknown;
        ownershipTransfers?: unknown;
        ownershipDeclarations?: unknown;
      } | null;

      if (!body || typeof body !== 'object') {
        return Response.json(
          { error: 'Invalid ownership verification apply payload.' },
          { status: 400 },
        );
      }

      const rawSet = body.setMediaOwned ?? [];
      const rawClear = body.clearMediaOwned ?? [];
      const rawTransfers = body.ownershipTransfers ?? [];
      const rawDeclarations = body.ownershipDeclarations ?? [];

      if (
        !Array.isArray(rawSet) ||
        !Array.isArray(rawClear) ||
        !Array.isArray(rawTransfers) ||
        !Array.isArray(rawDeclarations)
      ) {
        return Response.json(
          {
            error:
              'setMediaOwned, clearMediaOwned, ownershipTransfers, and ownershipDeclarations must be arrays.',
          },
          { status: 400 },
        );
      }

      if (
        rawSet.length > 10000 ||
        rawClear.length > 10000 ||
        rawTransfers.length > 2000 ||
        rawDeclarations.length > 10000
      ) {
        return Response.json(
          { error: 'Verification batch payload exceeds maximum size.' },
          { status: 400 },
        );
      }

      const setIds = Array.from(
        new Set(
          rawSet
            .filter((v): v is string => typeof v === 'string')
            .map((v) => v.trim())
            .filter(Boolean),
        ),
      );
      const clearIds = Array.from(
        new Set(
          rawClear
            .filter((v): v is string => typeof v === 'string')
            .map((v) => v.trim())
            .filter(Boolean),
        ),
      );

      if (
        setIds.length !== rawSet.length &&
        rawSet.some((v) => typeof v !== 'string' || !v.trim())
      ) {
        return Response.json(
          { error: 'setMediaOwned must contain non-empty release ID strings.' },
          { status: 400 },
        );
      }
      if (
        clearIds.length !== rawClear.length &&
        rawClear.some((v) => typeof v !== 'string' || !v.trim())
      ) {
        return Response.json(
          {
            error: 'clearMediaOwned must contain non-empty release ID strings.',
          },
          { status: 400 },
        );
      }

      const setIdSet = new Set(setIds);
      const clearIdSet = new Set(clearIds);
      for (const id of setIds) {
        if (clearIdSet.has(id)) {
          return Response.json(
            {
              error: `Release ID "${id}" cannot be present in both setMediaOwned and clearMediaOwned.`,
            },
            { status: 400 },
          );
        }
      }

      const declarationMap = new Map<
        string,
        { hasCase: number; hasManual: number }
      >();
      for (const rawDecl of rawDeclarations) {
        if (!rawDecl || typeof rawDecl !== 'object') {
          return Response.json(
            { error: 'Invalid ownershipDeclaration entry.' },
            { status: 400 },
          );
        }
        const declObj = rawDecl as {
          releaseId?: unknown;
          hasCase?: unknown;
          hasManual?: unknown;
        };
        const releaseId =
          typeof declObj.releaseId === 'string' ? declObj.releaseId.trim() : '';
        if (!releaseId) {
          return Response.json(
            {
              error:
                'ownershipDeclarations must contain non-empty releaseId strings.',
            },
            { status: 400 },
          );
        }
        if (clearIdSet.has(releaseId)) {
          return Response.json(
            {
              error: `Release ID "${releaseId}" cannot be present in both ownershipDeclarations and clearMediaOwned.`,
            },
            { status: 400 },
          );
        }
        const hasCase =
          declObj.hasCase === 1 || declObj.hasCase === true ? 1 : 0;
        const hasManual =
          declObj.hasManual === 1 || declObj.hasManual === true ? 1 : 0;
        const existing = declarationMap.get(releaseId);
        declarationMap.set(releaseId, {
          hasCase: Math.max(existing?.hasCase ?? 0, hasCase),
          hasManual: Math.max(existing?.hasManual ?? 0, hasManual),
        });
      }

      const parsedTransfers: Array<{
        fromReleaseIds: string[];
        toReleaseIds: string[];
      }> = [];
      const allFromIdsSet = new Set<string>();
      const allToIdsSet = new Set<string>();

      for (const rawTransfer of rawTransfers) {
        if (!rawTransfer || typeof rawTransfer !== 'object') {
          return Response.json(
            { error: 'Invalid ownershipTransfer entry.' },
            { status: 400 },
          );
        }
        const tObj = rawTransfer as {
          fromReleaseIds?: unknown;
          toReleaseIds?: unknown;
        };
        if (
          !Array.isArray(tObj.fromReleaseIds) ||
          !Array.isArray(tObj.toReleaseIds) ||
          tObj.fromReleaseIds.length === 0 ||
          tObj.toReleaseIds.length === 0 ||
          tObj.fromReleaseIds.length > 50 ||
          tObj.toReleaseIds.length > 50
        ) {
          return Response.json(
            {
              error:
                'Each ownershipTransfer must include non-empty fromReleaseIds and toReleaseIds arrays.',
            },
            { status: 400 },
          );
        }
        const fromReleaseIds = Array.from(
          new Set(
            tObj.fromReleaseIds
              .filter((v): v is string => typeof v === 'string')
              .map((v) => v.trim())
              .filter(Boolean),
          ),
        );
        const toReleaseIds = Array.from(
          new Set(
            tObj.toReleaseIds
              .filter((v): v is string => typeof v === 'string')
              .map((v) => v.trim())
              .filter(Boolean),
          ),
        );
        if (fromReleaseIds.length === 0 || toReleaseIds.length === 0) {
          return Response.json(
            {
              error:
                'fromReleaseIds and toReleaseIds must contain non-empty release ID strings.',
            },
            { status: 400 },
          );
        }
        for (const fid of fromReleaseIds) {
          if (allToIdsSet.has(fid) || toReleaseIds.includes(fid)) {
            return Response.json(
              {
                error: `Release ID "${fid}" cannot be both a transfer source and target.`,
              },
              { status: 400 },
            );
          }
          allFromIdsSet.add(fid);
        }
        for (const tid of toReleaseIds) {
          if (allFromIdsSet.has(tid)) {
            return Response.json(
              {
                error: `Release ID "${tid}" cannot be both a transfer source and target.`,
              },
              { status: 400 },
            );
          }
          allToIdsSet.add(tid);
        }
        parsedTransfers.push({ fromReleaseIds, toReleaseIds });
      }

      const currentUserId = sessionUser ? sessionUser.id : 1;

      // Verify ownershipTransfers belong to the exact same game_id and read source has_case / has_manual
      const verifiedTransfers: Array<{
        fromReleaseIds: string[];
        toReleaseIds: string[];
        migratedCase: number;
        migratedManual: number;
      }> = [];

      if (parsedTransfers.length > 0) {
        const allTransferReleaseIds = Array.from(
          new Set([...allFromIdsSet, ...allToIdsSet]),
        );
        const releaseGameMap = new Map<string, number>();

        for (let i = 0; i < allTransferReleaseIds.length; i += 100) {
          const chunk = allTransferReleaseIds.slice(i, i + 100);
          const placeholders = chunk.map(() => '?').join(', ');
          const { results: relRows } = await env.DB.prepare(
            `SELECT id, game_id FROM game_releases WHERE id IN (${placeholders})`,
          )
            .bind(...chunk)
            .all<{ id: string; game_id: number }>();

          for (const row of relRows || []) {
            releaseGameMap.set(row.id, Number(row.game_id));
          }
        }

        const allFromIdsList = Array.from(allFromIdsSet);
        const sourceCompletenessMap = new Map<
          string,
          { ownership_status: number; has_case: number; has_manual: number }
        >();

        for (let i = 0; i < allFromIdsList.length; i += 100) {
          const chunk = allFromIdsList.slice(i, i + 100);
          const placeholders = chunk.map(() => '?').join(', ');
          const { results: ugrRows } = await env.DB.prepare(
            `SELECT release_id, ownership_status, has_case, has_manual
             FROM user_game_releases
             WHERE user_id = ? AND release_id IN (${placeholders})`,
          )
            .bind(currentUserId, ...chunk)
            .all<{
              release_id: string;
              ownership_status: number;
              has_case: number;
              has_manual: number;
            }>();

          for (const row of ugrRows || []) {
            sourceCompletenessMap.set(row.release_id, {
              ownership_status: Number(row.ownership_status || 0),
              has_case: Number(row.has_case || 0),
              has_manual: Number(row.has_manual || 0),
            });
          }
        }

        for (const transfer of parsedTransfers) {
          const firstGameId = releaseGameMap.get(transfer.fromReleaseIds[0]);
          if (firstGameId === undefined) {
            return Response.json(
              {
                error: `Unknown release ID in ownership transfer: "${transfer.fromReleaseIds[0]}".`,
              },
              { status: 400 },
            );
          }

          for (const id of [
            ...transfer.fromReleaseIds,
            ...transfer.toReleaseIds,
          ]) {
            const gid = releaseGameMap.get(id);
            if (gid === undefined) {
              return Response.json(
                {
                  error: `Unknown release ID in ownership transfer: "${id}".`,
                },
                { status: 400 },
              );
            }
            if (gid !== firstGameId) {
              return Response.json(
                {
                  error:
                    'Ownership transfers are only permitted between releases of the same game.',
                },
                { status: 400 },
              );
            }
          }

          let migratedCase = 0;
          let migratedManual = 0;
          for (const fid of transfer.fromReleaseIds) {
            const comp = sourceCompletenessMap.get(fid);
            if (comp) {
              if (comp.has_case === 1) migratedCase = 1;
              if (comp.has_manual === 1) migratedManual = 1;
            }
          }

          verifiedTransfers.push({
            fromReleaseIds: transfer.fromReleaseIds,
            toReleaseIds: transfer.toReleaseIds,
            migratedCase,
            migratedManual,
          });
        }
      }

      const statements: D1PreparedStatement[] = [];
      const handledSetIds = new Set<string>();
      const handledClearIds = new Set<string>();

      for (const transfer of verifiedTransfers) {
        for (const fromId of transfer.fromReleaseIds) {
          const alsoClearMedia = clearIdSet.has(fromId) ? 1 : 0;
          if (alsoClearMedia === 1) {
            handledClearIds.add(fromId);
          }
          statements.push(
            env.DB.prepare(
              `UPDATE user_game_releases
               SET ownership_status = 0,
                   has_case = 0,
                   has_manual = 0,
                   has_media = CASE WHEN ? = 1 THEN 0 ELSE has_media END
               WHERE user_id = ? AND release_id = ?
                 AND (ownership_status != 0 OR has_case != 0 OR has_manual != 0 OR (? = 1 AND has_media != 0))`,
            ).bind(alsoClearMedia, currentUserId, fromId, alsoClearMedia),
          );
        }

        for (const toId of transfer.toReleaseIds) {
          const alsoSetMedia = setIdSet.has(toId) ? 1 : 0;
          if (alsoSetMedia === 1) {
            handledSetIds.add(toId);
          }
          statements.push(
            env.DB.prepare(
              `INSERT INTO user_game_releases (user_id, release_id, ownership_status, has_media, has_case, has_manual)
               SELECT ?, id, 1, ?, ?, ? FROM game_releases WHERE id = ?
               ON CONFLICT(user_id, release_id) DO UPDATE SET
                 ownership_status = 1,
                 has_media = CASE WHEN ? = 1 THEN 1 ELSE user_game_releases.has_media END,
                 has_case = MAX(user_game_releases.has_case, excluded.has_case),
                 has_manual = MAX(user_game_releases.has_manual, excluded.has_manual)
               WHERE user_game_releases.ownership_status IS NOT 1
                  OR (? = 1 AND user_game_releases.has_media IS NOT 1)
                  OR user_game_releases.has_case < excluded.has_case
                  OR user_game_releases.has_manual < excluded.has_manual`,
            ).bind(
              currentUserId,
              alsoSetMedia,
              transfer.migratedCase,
              transfer.migratedManual,
              toId,
              alsoSetMedia,
              alsoSetMedia,
            ),
          );
        }
      }

      for (const id of setIds) {
        if (handledSetIds.has(id)) continue;
        const decl = declarationMap.get(id);
        if (decl) {
          handledSetIds.add(id);
          statements.push(
            env.DB.prepare(
              `INSERT INTO user_game_releases (user_id, release_id, ownership_status, has_media, has_case, has_manual)
               SELECT ?, id, 1, 1, ?, ? FROM game_releases WHERE id = ?
               ON CONFLICT(user_id, release_id) DO UPDATE SET
                 ownership_status = 1,
                 has_media = 1,
                 has_case = MAX(user_game_releases.has_case, excluded.has_case),
                 has_manual = MAX(user_game_releases.has_manual, excluded.has_manual)
               WHERE user_game_releases.ownership_status IS NOT 1
                  OR user_game_releases.has_media IS NOT 1
                  OR user_game_releases.has_case < excluded.has_case
                  OR user_game_releases.has_manual < excluded.has_manual`,
            ).bind(currentUserId, decl.hasCase, decl.hasManual, id),
          );
        } else {
          statements.push(
            env.DB.prepare(
              `INSERT INTO user_game_releases (user_id, release_id, has_media)
               SELECT ?, id, 1 FROM game_releases WHERE id = ?
               ON CONFLICT(user_id, release_id) DO UPDATE SET
                 has_media = 1
               WHERE user_game_releases.has_media IS NOT 1`,
            ).bind(currentUserId, id),
          );
        }
      }

      for (const [id, decl] of declarationMap.entries()) {
        if (handledSetIds.has(id)) continue;
        statements.push(
          env.DB.prepare(
            `INSERT INTO user_game_releases (user_id, release_id, ownership_status, has_media, has_case, has_manual)
             SELECT ?, id, 1, 1, ?, ? FROM game_releases WHERE id = ?
             ON CONFLICT(user_id, release_id) DO UPDATE SET
               ownership_status = 1,
               has_media = 1,
               has_case = MAX(user_game_releases.has_case, excluded.has_case),
               has_manual = MAX(user_game_releases.has_manual, excluded.has_manual)
             WHERE user_game_releases.ownership_status IS NOT 1
                OR user_game_releases.has_media IS NOT 1
                OR user_game_releases.has_case < excluded.has_case
                OR user_game_releases.has_manual < excluded.has_manual`,
          ).bind(currentUserId, decl.hasCase, decl.hasManual, id),
        );
      }

      for (const id of clearIds) {
        if (handledClearIds.has(id)) continue;
        statements.push(
          env.DB.prepare(
            `UPDATE user_game_releases
             SET has_media = 0
             WHERE user_id = ? AND release_id = ? AND has_media != 0`,
          ).bind(currentUserId, id),
        );
      }

      if (statements.length > 0) {
        for (let i = 0; i < statements.length; i += 100) {
          await env.DB.batch(statements.slice(i, i + 100));
        }

        await invalidateEdgeApiCache(request.url, {
          userId: currentUserId,
          username: sessionUser?.username,
        });
        await markDbDirty(env, 'games', 'verify-ownership-apply', {
          clearBoutiqueHash:
            verifiedTransfers.length > 0 || declarationMap.size > 0,
        });
      }

      return Response.json({
        success: true,
        setCount: setIds.length,
        clearCount: clearIds.length,
        transferredCount: verifiedTransfers.length,
        declaredOwnedCount: declarationMap.size,
      });
    }

    // Endpoint: POST /api/collection/sort
    else if (request.method === 'POST' && path === '/api/collection/sort') {
      if (!isAuthorizedAdmin(request, env, sessionUser)) {
        return Response.json(
          { error: 'Unauthorized: Admin authentication required.' },
          { status: 403 },
        );
      }

      const body = (await request.json().catch(() => null)) as {
        id?: string;
        type?: 'game' | 'toy';
        sort_index?: number;
      } | null;

      if (
        !body ||
        typeof body !== 'object' ||
        !body.id ||
        (body.type !== 'game' && body.type !== 'toy') ||
        typeof body.sort_index !== 'number' ||
        Number.isNaN(body.sort_index)
      ) {
        return Response.json(
          { error: 'Invalid sort payload' },
          { status: 400 },
        );
      }

      const { id, type, sort_index } = body;

      if (type === 'game') {
        let stableId: number | null = null;
        const release = (await env.DB.prepare(
          'SELECT game_id FROM game_releases WHERE id = ?',
        )
          .bind(id)
          .first()) as { game_id: number } | null;
        if (release) {
          stableId = release.game_id;
        } else {
          const game = (await env.DB.prepare(
            'SELECT stable_id FROM games WHERE id = ?',
          )
            .bind(id)
            .first()) as { stable_id: number } | null;
          if (game) stableId = game.stable_id;
        }

        if (stableId === null) {
          return Response.json(
            { error: `Could not find game/release with ID: ${id}` },
            { status: 404 },
          );
        }

        await env.DB.prepare(
          'UPDATE games SET sort_index = ? WHERE stable_id = ?',
        )
          .bind(sort_index, stableId)
          .run();
      } else {
        await env.DB.prepare('UPDATE toys SET sort_index = ? WHERE id = ?')
          .bind(sort_index, id)
          .run();
        await invalidateToysCatalogChunk(env);
      }

      await invalidateEdgeApiCache(request.url, {
        userId: sessionUser?.id,
        username: sessionUser?.username,
      });
      await markDbDirty(env, type === 'game' ? 'games' : 'toys', id);
      return Response.json({ success: true });
    }

    // Endpoint: POST /api/retail/sync-deals
    else if (request.method === 'POST' && path === '/api/retail/sync-deals') {
      if (!isAuthorizedAdmin(request, env, sessionUser)) {
        return Response.json(
          { error: 'Unauthorized: Admin authentication required.' },
          { status: 403 },
        );
      }

      const result = await syncWorkerRetailDeals(env);
      await invalidateEdgeApiCache(request.url);
      return Response.json({ success: true, ...result });
    }

    // Endpoint: POST /api/retail/sync-boutique
    else if (
      request.method === 'POST' &&
      path === '/api/retail/sync-boutique'
    ) {
      if (!isAuthorizedAdmin(request, env, sessionUser)) {
        return Response.json(
          { error: 'Unauthorized: Admin authentication required.' },
          { status: 403 },
        );
      }

      const result = await syncWorkerBoutiquePreOrders(env);
      await invalidateEdgeApiCache(request.url);
      return Response.json({ success: true, ...result });
    }

    // Endpoint: GET /api/journal?item_type=game|toy&item_id=:id
    else if (request.method === 'GET' && path === '/api/journal') {
      const privateHeaders = {
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      };
      if (!sessionUser) {
        return Response.json(
          { authorized: false, entry: null },
          { headers: privateHeaders },
        );
      }

      const itemType = url.searchParams.get('item_type') || 'game';
      const itemId = (url.searchParams.get('item_id') || '').trim();
      if ((itemType !== 'game' && itemType !== 'toy') || !itemId) {
        return Response.json(
          { error: 'Valid item_type (game|toy) and item_id are required.' },
          { status: 400, headers: privateHeaders },
        );
      }

      try {
        let canonicalId = itemId;
        let legacyId: string | null = null;
        if (itemType === 'game') {
          const resolved = (await env.DB.prepare(
            RESOLVE_CANONICAL_GAME_ID_QUERY,
          )
            .bind(...getResolveCanonicalGameIdParams(itemId))
            .first()) as { game_id?: string; legacy_id?: string | null } | null;
          if (resolved?.game_id) {
            canonicalId = resolved.game_id;
            legacyId = resolved.legacy_id ?? null;
          }
        }

        const entry = (await env.DB.prepare(JOURNAL_ENTRY_BY_ITEM_QUERY)
          .bind(sessionUser.id, itemType, canonicalId, legacyId || itemId)
          .first()) as JournalEntryRow | null;

        return Response.json(
          { authorized: true, entry: entry || null },
          { headers: privateHeaders },
        );
      } catch {
        const snapshot = await loadMetaSnapshotForFallback(env.BACKUP_BUCKET);
        if (!snapshot) {
          return buildD1QuotaExceededResponse();
        }
        const entry = findJournalEntryFromSnapshot(
          snapshot,
          sessionUser.id,
          itemType,
          itemId,
        );
        return Response.json(
          { authorized: true, entry, degraded: true },
          {
            headers: buildR2DegradedHeaders(snapshot.timestamp, privateHeaders),
          },
        );
      }
    }

    // Endpoint: GET /api/journal/entries
    else if (request.method === 'GET' && path === '/api/journal/entries') {
      const privateHeaders = {
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      };
      if (!sessionUser) {
        return Response.json(
          { authorized: false, entries: [] },
          { headers: privateHeaders },
        );
      }

      const journalCacheKey = new Request(
        `https://edge-cache.internal/journal/user:${sessionUser.id}`,
      );
      if (edgeCache && !isNoCache) {
        const cachedJournal = await edgeCache
          .match(journalCacheKey)
          .catch(() => undefined);
        if (cachedJournal) {
          return new Response(cachedJournal.body, {
            status: cachedJournal.status,
            headers: {
              'Content-Type': 'application/json',
              ...privateHeaders,
            },
          });
        }
      }

      try {
        const { results } = await env.DB.prepare(JOURNAL_ENTRIES_ALL_QUERY)
          .bind(sessionUser.id)
          .all();
        const bodyJson = JSON.stringify({
          authorized: true,
          entries: results || [],
        });
        if (edgeCache) {
          await putEdgeCacheEntry(
            edgeCache,
            journalCacheKey,
            new Response(bodyJson, {
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=3600',
              },
            }),
            isNoCache,
            true,
          );
        }
        return new Response(bodyJson, {
          headers: {
            'Content-Type': 'application/json',
            ...privateHeaders,
          },
        });
      } catch {
        const snapshot = await loadMetaSnapshotForFallback(env.BACKUP_BUCKET);
        if (!snapshot) {
          return buildD1QuotaExceededResponse();
        }
        const entries = buildJournalEntriesFromSnapshot(
          snapshot,
          sessionUser.id,
        );
        return Response.json(
          { authorized: true, entries, degraded: true },
          {
            headers: buildR2DegradedHeaders(snapshot.timestamp, privateHeaders),
          },
        );
      }
    }

    // Endpoint: POST /api/journal
    else if (request.method === 'POST' && path === '/api/journal') {
      if (!sessionUser) {
        return Response.json(
          { error: 'Unauthorized: Authentication required.' },
          { status: 401 },
        );
      }

      const body = (await request.json().catch(() => null)) as {
        item_type?: string;
        item_id?: string;
        purchase_date?: string | null;
        is_approximate_date?: number | boolean | null;
        price_paid?: number | string | null;
        merchant?: string | null;
        gifted_by?: string | null;
        receipt_url?: string | null;
        notes?: string | null;
      } | null;

      if (!body || typeof body !== 'object') {
        return Response.json(
          { error: 'Invalid JSON payload' },
          { status: 400 },
        );
      }

      const itemType = (body?.item_type || '').trim();
      const rawItemId = (body?.item_id || '').trim();
      if ((itemType !== 'game' && itemType !== 'toy') || !rawItemId) {
        return Response.json(
          { error: 'Valid item_type (game|toy) and item_id are required.' },
          { status: 400 },
        );
      }

      let canonicalId = rawItemId;
      let legacyId: string | null = null;
      if (itemType === 'game') {
        const resolved = (await env.DB.prepare(RESOLVE_CANONICAL_GAME_ID_QUERY)
          .bind(...getResolveCanonicalGameIdParams(rawItemId))
          .first()) as { game_id?: string; legacy_id?: string | null } | null;
        if (resolved?.game_id) {
          canonicalId = resolved.game_id;
          legacyId = resolved.legacy_id ?? null;
        }
      }

      const { purchaseDate, isApproximateDate } = normalizeJournalDatePayload(
        body.purchase_date,
        body.is_approximate_date,
      );

      let pricePaid: number | null = null;
      if (
        body.price_paid !== null &&
        body.price_paid !== undefined &&
        String(body.price_paid).trim() !== ''
      ) {
        const parsed = Number(body.price_paid);
        if (Number.isNaN(parsed) || parsed < 0) {
          return Response.json(
            { error: 'price_paid must be a non-negative number.' },
            { status: 400 },
          );
        }
        pricePaid = Math.round(parsed * 100) / 100;
      }

      const merchant = normalizeMerchantName(body.merchant);
      const giftedBy = body.gifted_by
        ? String(body.gifted_by).trim() || null
        : null;
      const receiptUrl = normalizeReceiptUrl(body.receipt_url);
      const notes = body.notes ? String(body.notes).trim() || null : null;

      await env.DB.prepare(UPSERT_JOURNAL_ENTRY_QUERY)
        .bind(
          sessionUser.id,
          itemType,
          canonicalId,
          purchaseDate,
          isApproximateDate,
          pricePaid,
          merchant,
          giftedBy,
          receiptUrl,
          notes,
        )
        .run();

      if (canonicalId !== rawItemId) {
        await env.DB.prepare(DELETE_JOURNAL_ENTRY_QUERY)
          .bind(sessionUser.id, itemType, rawItemId)
          .run();
      }
      if (legacyId && legacyId !== canonicalId && legacyId !== rawItemId) {
        await env.DB.prepare(DELETE_JOURNAL_ENTRY_QUERY)
          .bind(sessionUser.id, itemType, legacyId)
          .run();
      }

      const savedEntry = (await env.DB.prepare(JOURNAL_ENTRY_BY_ITEM_QUERY)
        .bind(sessionUser.id, itemType, canonicalId, canonicalId)
        .first()) as JournalEntryRow | null;

      if (edgeCache) {
        await edgeCache
          .delete(
            new Request(
              `https://edge-cache.internal/journal/user:${sessionUser.id}`,
            ),
          )
          .catch(() => {});
      }
      await markDbDirty(env);
      return Response.json({ success: true, entry: savedEntry });
    }

    // Endpoint: DELETE /api/journal?item_type=game|toy&item_id=:id
    else if (request.method === 'DELETE' && path === '/api/journal') {
      if (!sessionUser) {
        return Response.json(
          { error: 'Unauthorized: Authentication required.' },
          { status: 401 },
        );
      }

      const itemType = (url.searchParams.get('item_type') || 'game').trim();
      const rawItemId = (url.searchParams.get('item_id') || '').trim();
      if ((itemType !== 'game' && itemType !== 'toy') || !rawItemId) {
        return Response.json(
          { error: 'Valid item_type (game|toy) and item_id are required.' },
          { status: 400 },
        );
      }

      let canonicalId = rawItemId;
      let legacyId: string | null = null;
      if (itemType === 'game') {
        const resolved = (await env.DB.prepare(RESOLVE_CANONICAL_GAME_ID_QUERY)
          .bind(...getResolveCanonicalGameIdParams(rawItemId))
          .first()) as { game_id?: string; legacy_id?: string | null } | null;
        if (resolved?.game_id) {
          canonicalId = resolved.game_id;
          legacyId = resolved.legacy_id ?? null;
        }
      }

      await env.DB.prepare(DELETE_JOURNAL_ENTRY_QUERY)
        .bind(sessionUser.id, itemType, canonicalId)
        .run();
      if (canonicalId !== rawItemId) {
        await env.DB.prepare(DELETE_JOURNAL_ENTRY_QUERY)
          .bind(sessionUser.id, itemType, rawItemId)
          .run();
      }
      if (legacyId && legacyId !== canonicalId && legacyId !== rawItemId) {
        await env.DB.prepare(DELETE_JOURNAL_ENTRY_QUERY)
          .bind(sessionUser.id, itemType, legacyId)
          .run();
      }

      if (edgeCache) {
        await edgeCache
          .delete(
            new Request(
              `https://edge-cache.internal/journal/user:${sessionUser.id}`,
            ),
          )
          .catch(() => {});
      }
      await markDbDirty(env);
      return Response.json({ success: true });
    }

    // Endpoint: GET /api/notifications/vapid-public-key
    else if (
      request.method === 'GET' &&
      path === '/api/notifications/vapid-public-key'
    ) {
      if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
        return Response.json(
          {
            configured: false,
            error: 'Web Push notifications are not configured.',
          },
          { status: 503 },
        );
      }
      return Response.json({
        configured: true,
        publicKey: env.VAPID_PUBLIC_KEY,
      });
    }

    // Endpoint: POST /api/notifications/subscribe
    else if (
      request.method === 'POST' &&
      path === '/api/notifications/subscribe'
    ) {
      if (!sessionUser) {
        return Response.json(
          { error: 'Unauthorized: Authentication required.' },
          { status: 401 },
        );
      }

      const body = (await request.json().catch(() => null)) as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
        preferences?: Record<string, unknown>;
      } | null;

      if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
        return Response.json(
          {
            error:
              'Invalid subscription payload: endpoint and keys (p256dh, auth) are required.',
          },
          { status: 400 },
        );
      }

      if (!isAllowedPushEndpoint(body.endpoint, isLoopbackRequest(url))) {
        return Response.json(
          {
            error:
              'Invalid push endpoint: must be a trusted HTTPS Web Push service.',
          },
          { status: 400 },
        );
      }

      const existingOwner = await env.DB.prepare(
        'SELECT user_id FROM push_subscriptions WHERE endpoint = ?',
      )
        .bind(body.endpoint)
        .first<{ user_id: number } | null>();

      if (existingOwner && existingOwner.user_id !== sessionUser.id) {
        return Response.json(
          {
            error: 'Forbidden: Subscription endpoint belongs to another user.',
          },
          { status: 403 },
        );
      }

      const id = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      const userAgent = request.headers.get('User-Agent') || null;
      const prefsJson = JSON.stringify(body.preferences || {});

      await env.DB.prepare(
        `INSERT INTO push_subscriptions (
             id, user_id, endpoint, p256dh, auth, preferences_json, user_agent, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(endpoint) DO UPDATE SET
             p256dh = excluded.p256dh,
             auth = excluded.auth,
             preferences_json = excluded.preferences_json,
             user_agent = excluded.user_agent,
             updated_at = excluded.updated_at
           WHERE push_subscriptions.user_id = excluded.user_id`,
      )
        .bind(
          id,
          sessionUser.id,
          body.endpoint,
          body.keys.p256dh,
          body.keys.auth,
          prefsJson,
          userAgent,
          nowIso,
          nowIso,
        )
        .run();

      return Response.json({ success: true, id });
    }

    // Endpoint: PUT /api/notifications/preferences
    else if (
      request.method === 'PUT' &&
      path === '/api/notifications/preferences'
    ) {
      if (!sessionUser) {
        return Response.json(
          { error: 'Unauthorized: Authentication required.' },
          { status: 401 },
        );
      }

      const body = (await request.json().catch(() => null)) as {
        endpoint?: string;
        preferences?: Record<string, unknown>;
      } | null;

      if (!body?.endpoint || !body?.preferences) {
        return Response.json(
          {
            error: 'Invalid payload: endpoint and preferences are required.',
          },
          { status: 400 },
        );
      }

      if (!isAllowedPushEndpoint(body.endpoint, isLoopbackRequest(url))) {
        return Response.json(
          {
            error:
              'Invalid push endpoint: must be a trusted HTTPS Web Push service.',
          },
          { status: 400 },
        );
      }

      const nowIso = new Date().toISOString();
      const prefsJson = JSON.stringify(body.preferences);

      await env.DB.prepare(
        `UPDATE push_subscriptions
           SET preferences_json = ?, updated_at = ?
           WHERE endpoint = ? AND user_id = ?`,
      )
        .bind(prefsJson, nowIso, body.endpoint, sessionUser.id)
        .run();

      return Response.json({ success: true });
    }

    // Endpoint: POST /api/notifications/unsubscribe
    else if (
      request.method === 'POST' &&
      path === '/api/notifications/unsubscribe'
    ) {
      if (!sessionUser) {
        return Response.json(
          { error: 'Unauthorized: Authentication required.' },
          { status: 401 },
        );
      }

      const body = (await request.json().catch(() => null)) as {
        endpoint?: string;
      } | null;
      if (!body?.endpoint) {
        return Response.json(
          { error: 'Endpoint is required.' },
          { status: 400 },
        );
      }

      if (!isAllowedPushEndpoint(body.endpoint, isLoopbackRequest(url))) {
        return Response.json(
          {
            error:
              'Invalid push endpoint: must be a trusted HTTPS Web Push service.',
          },
          { status: 400 },
        );
      }

      await env.DB.prepare(
        'DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?',
      )
        .bind(body.endpoint, sessionUser.id)
        .run();

      return Response.json({ success: true });
    }

    // Endpoint: POST /api/notifications/test
    else if (request.method === 'POST' && path === '/api/notifications/test') {
      if (!sessionUser) {
        return Response.json(
          { error: 'Unauthorized: Authentication required.' },
          { status: 401 },
        );
      }

      const body = (await request.json().catch(() => null)) as {
        endpoint?: string;
      } | null;
      if (!body?.endpoint) {
        return Response.json(
          { error: 'Endpoint is required.' },
          { status: 400 },
        );
      }

      if (!isAllowedPushEndpoint(body.endpoint, isLoopbackRequest(url))) {
        return Response.json(
          {
            error:
              'Invalid push endpoint: must be a trusted HTTPS Web Push service.',
          },
          { status: 400 },
        );
      }

      const sub = await env.DB.prepare(
        'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE endpoint = ? AND user_id = ?',
      )
        .bind(body.endpoint, sessionUser.id)
        .first<{ endpoint: string; p256dh: string; auth: string } | null>();

      if (!sub) {
        return Response.json(
          { error: 'Subscription not found.' },
          { status: 404 },
        );
      }

      const nowMs = Date.now();
      const testId = `test-alert-${crypto.randomUUID()}`;
      const result = await sendWebPushNotification(
        sub,
        {
          title: '🔔 Deal Alerts Active',
          body: 'Push notifications are successfully configured for your device!',
          icon: '/icons/icon-192.png',
          badge: '/icons/badge-96.png',
          tag: testId,
          timestamp: nowMs,
          data: { url: '/', testId },
        },
        {
          publicKey: env.VAPID_PUBLIC_KEY,
          privateKey: env.VAPID_PRIVATE_KEY,
          subject: resolveVapidSubject(undefined, request.url, env.ADMIN_EMAIL),
          fetchFn: fetch,
          allowTestHost: isLoopbackRequest(url),
          urgency: 'high',
        },
      );

      if (result.shouldDelete) {
        await env.DB.prepare(
          'DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?',
        )
          .bind(body.endpoint, sessionUser.id)
          .run();
      }

      return Response.json({ ...result, testId });
    }

    // Endpoint: GET /api/prices/cached (?sync=1 bypasses 5m L1 Edge Cache and reads R2 L2)
    else if (request.method === 'GET' && path === '/api/prices/cached') {
      const privateHeaders = {
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      };
      if (!isMarketPricingAuthorized(request, env, sessionUser)) {
        return Response.json(
          { error: 'Unauthorized: Admin authentication required.' },
          { status: 403, headers: privateHeaders },
        );
      }
      const bypassL1 = url.searchParams.get('sync') === '1';
      const [prices, overrides] = await Promise.all([
        readAllCachedMarketPrices(env, { bypassL1 }),
        loadAllPriceQueryOverrides(env),
      ]);
      return Response.json(
        {
          configured: isEbayConfigured(env),
          prices,
          overrides,
          serverTime: new Date().toISOString(),
        },
        { headers: privateHeaders },
      );
    }

    // Endpoint: POST /api/prices/live
    else if (request.method === 'POST' && path === '/api/prices/live') {
      const privateHeaders = {
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      };
      if (!isMarketPricingAuthorized(request, env, sessionUser)) {
        return Response.json(
          { error: 'Unauthorized: Admin authentication required.' },
          { status: 403, headers: privateHeaders },
        );
      }
      const rl = checkWorkerRateLimit(
        'prices-live',
        getRateLimitClientKey(request, sessionUser),
        20,
        60_000,
      );
      if (!rl.allowed) {
        return Response.json(
          {
            error:
              'Too many live price checks requested. Please wait before trying again.',
          },
          {
            status: 429,
            headers: {
              ...privateHeaders,
              'Retry-After': String(rl.retryAfterSec),
            },
          },
        );
      }

      const body = (await request.json().catch(() => null)) as {
        itemType?: string;
        itemId?: string;
        force?: boolean;
      } | null;
      const itemType = body?.itemType;
      const itemId = (body?.itemId || '').trim();
      if ((itemType !== 'game' && itemType !== 'toy') || !itemId) {
        return Response.json(
          { error: 'Valid itemType (game|toy) and itemId are required.' },
          { status: 400, headers: privateHeaders },
        );
      }

      if (!isEbayConfigured(env)) {
        return Response.json(
          {
            error:
              'eBay Browse API credentials (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET) are not configured.',
            code: 'ebay_not_configured',
          },
          { status: 503, headers: privateHeaders },
        );
      }

      try {
        const result = await fetchLiveItemMarketPrice(env, itemType, itemId, {
          force: Boolean(body?.force),
        });
        if (!result.price && result.error === 'Item not found in catalog.') {
          return Response.json(
            { error: result.error },
            { status: 404, headers: privateHeaders },
          );
        }
        return Response.json(result, { headers: privateHeaders });
      } catch (err) {
        if (err instanceof EbayNotConfiguredError) {
          return Response.json(
            { error: err.message, code: 'ebay_not_configured' },
            { status: 503, headers: privateHeaders },
          );
        }
        if (err instanceof EbayRateLimitError) {
          return Response.json(
            {
              error: err.message,
              code: 'ebay_rate_limited',
              retryAfterSec: err.retryAfterSec,
            },
            {
              status: 429,
              headers: {
                ...privateHeaders,
                'Retry-After': String(err.retryAfterSec),
              },
            },
          );
        }
        throw err;
      }
    }

    // Endpoint: POST /api/prices/live-batch
    else if (request.method === 'POST' && path === '/api/prices/live-batch') {
      const privateHeaders = {
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      };
      if (!isMarketPricingAuthorized(request, env, sessionUser)) {
        return Response.json(
          { error: 'Unauthorized: Admin authentication required.' },
          { status: 403, headers: privateHeaders },
        );
      }
      const rl = checkWorkerRateLimit(
        'prices-live-batch',
        getRateLimitClientKey(request, sessionUser),
        120,
        60_000,
      );
      if (!rl.allowed) {
        return Response.json(
          {
            error:
              'Batch price scan rate limit exceeded. Please wait before continuing.',
          },
          {
            status: 429,
            headers: {
              ...privateHeaders,
              'Retry-After': String(rl.retryAfterSec),
            },
          },
        );
      }

      const body = (await request.json().catch(() => null)) as {
        items?: Array<{ itemType?: string; itemId?: string }>;
        force?: boolean;
      } | null;
      const rawItems = Array.isArray(body?.items) ? body.items : [];
      if (rawItems.length === 0 || rawItems.length > MAX_LIVE_BATCH_ITEMS) {
        return Response.json(
          {
            error: `items must be an array of 1 to ${MAX_LIVE_BATCH_ITEMS} entries.`,
          },
          { status: 400, headers: privateHeaders },
        );
      }

      const validItems: Array<{ itemType: 'game' | 'toy'; itemId: string }> =
        [];
      for (const entry of rawItems) {
        const it = entry?.itemType;
        const id = (entry?.itemId || '').trim();
        if ((it !== 'game' && it !== 'toy') || !id) {
          return Response.json(
            {
              error:
                'Every item must include valid itemType (game|toy) and itemId.',
            },
            { status: 400, headers: privateHeaders },
          );
        }
        validItems.push({ itemType: it, itemId: id });
      }

      if (!isEbayConfigured(env)) {
        return Response.json(
          {
            error:
              'eBay Browse API credentials (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET) are not configured.',
            code: 'ebay_not_configured',
          },
          { status: 503, headers: privateHeaders },
        );
      }

      try {
        const result = await fetchLiveBatchMarketPrices(env, validItems, {
          force: Boolean(body?.force),
        });
        return Response.json(result, { headers: privateHeaders });
      } catch (err) {
        if (err instanceof EbayNotConfiguredError) {
          return Response.json(
            { error: err.message, code: 'ebay_not_configured' },
            { status: 503, headers: privateHeaders },
          );
        }
        throw err;
      }
    }

    // Endpoint: PUT /api/prices/override (Admin-only)
    else if (request.method === 'PUT' && path === '/api/prices/override') {
      const privateHeaders = {
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      };
      if (!isAuthorizedAdmin(request, env, sessionUser)) {
        return Response.json(
          { error: 'Unauthorized: Admin authentication required.' },
          { status: 403, headers: privateHeaders },
        );
      }

      const body = (await request.json().catch(() => null)) as {
        itemType?: string;
        itemId?: string;
        customQuery?: string | null;
        refreshNow?: boolean;
      } | null;
      const itemType = body?.itemType;
      const itemId = (body?.itemId || '').trim();
      if ((itemType !== 'game' && itemType !== 'toy') || !itemId) {
        return Response.json(
          { error: 'Valid itemType (game|toy) and itemId are required.' },
          { status: 400, headers: privateHeaders },
        );
      }
      const customQuery =
        body?.customQuery === null || body?.customQuery === undefined
          ? null
          : String(body.customQuery).trim();
      if (customQuery && customQuery.length > 160) {
        return Response.json(
          { error: 'customQuery must be 160 characters or fewer.' },
          { status: 400, headers: privateHeaders },
        );
      }

      let saved: { itemId: string; customQuery: string | null };
      try {
        saved = await savePriceQueryOverride(
          env,
          itemType,
          itemId,
          customQuery,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/no such table:\s*price_query_overrides/i.test(msg)) {
          return Response.json(
            {
              error:
                'price_query_overrides table is not migrated yet. Apply migrations/schema.sql first.',
              code: 'table_not_migrated',
            },
            { status: 503, headers: privateHeaders },
          );
        }
        throw err;
      }

      let price = null;
      let priceError: string | null = null;
      if (body?.refreshNow) {
        if (!isEbayConfigured(env)) {
          priceError =
            'Query saved, but eBay API credentials are not yet configured.';
        } else {
          try {
            const refreshed = await fetchLiveItemMarketPrice(
              env,
              itemType,
              saved.itemId,
              { force: true },
            );
            price = refreshed.price;
            priceError = refreshed.error ?? null;
          } catch (err) {
            priceError = err instanceof Error ? err.message : String(err);
          }
        }
      }

      return Response.json(
        {
          success: true,
          itemType,
          itemId: saved.itemId,
          customQuery: saved.customQuery,
          price,
          priceError,
        },
        { headers: privateHeaders },
      );
    }

    // Endpoint: GET /api/prices/rate-limits (Admin-only)
    else if (request.method === 'GET' && path === '/api/prices/rate-limits') {
      const privateHeaders = {
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      };
      if (!isAuthorizedAdmin(request, env, sessionUser)) {
        return Response.json(
          { error: 'Unauthorized: Admin authentication required.' },
          { status: 403, headers: privateHeaders },
        );
      }
      const diag = await getMarketPricingDiagnostics(env);
      return Response.json(diag, { headers: privateHeaders });
    }

    // Endpoint: POST /api/prices/cache/clear (Admin-only)
    else if (request.method === 'POST' && path === '/api/prices/cache/clear') {
      const privateHeaders = {
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      };
      if (!isAuthorizedAdmin(request, env, sessionUser)) {
        return Response.json(
          { error: 'Unauthorized: Admin authentication required.' },
          { status: 403, headers: privateHeaders },
        );
      }
      await clearAllEbayPriceShards(env);
      return Response.json({ cleared: true }, { headers: privateHeaders });
    }

    // Endpoint: GET /api/config
    else if (request.method === 'GET' && path === '/api/config') {
      const appName = env.APP_NAME || 'Collection Tracker';
      const shortName = env.APP_SHORT_NAME || env.APP_NAME || 'Tracker';
      const tagline =
        env.APP_TAGLINE || 'Physical Game & Toy Collection Tracker';
      const authorName = env.APP_AUTHOR || appName;
      return Response.json(
        {
          appName,
          shortName,
          tagline,
          authorName,
          logoUrl: '/favicon.svg',
          oidcIssuer: getOidcIssuer(env),
          oidcClientId: getOidcClientId(env),
          accountHubUrl: getAccountHubUrl(env),
          repoUrl: env.APP_REPO_URL || null,
        },
        {
          headers: {
            'Cache-Control': 'public, max-age=3600',
          },
        },
      );
    }

    // Endpoint: GET /manifest.webmanifest
    else if (request.method === 'GET' && path === '/manifest.webmanifest') {
      const appName = env.APP_NAME || 'Collection Tracker';
      const shortName = env.APP_SHORT_NAME || env.APP_NAME || 'Tracker';
      return Response.json(
        {
          name: appName,
          short_name: shortName,
          start_url: '/',
          scope: '/',
          display: 'standalone',
          handle_links: 'preferred',
          launch_handler: {
            client_mode: ['navigate-existing', 'auto'],
          },
          background_color: '#121214',
          theme_color: '#121214',
          icons: [
            {
              src: '/favicon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any',
            },
            {
              src: '/icons/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/icons/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: '/icons/badge-96.png',
              sizes: '96x96',
              type: 'image/png',
              purpose: 'monochrome',
            },
          ],
        },
        {
          headers: {
            'Content-Type': 'application/manifest+json; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
          },
        },
      );
    }

    // Endpoint: GET /favicon.svg (override if provided via env)
    else if (
      request.method === 'GET' &&
      path === '/favicon.svg' &&
      env.CUSTOM_FAVICON_SVG
    ) {
      return new Response(env.CUSTOM_FAVICON_SVG, {
        headers: {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'Cache-Control': 'public, max-age=86400',
        },
      });
    }

    if (path.startsWith('/api/')) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    /**
     * FALLBACK: Serve from Static Assets
     */
    return env.ASSETS.fetch(request);
  } catch (e: unknown) {
    if (isD1QuotaOrReadError(e)) {
      return buildD1QuotaExceededResponse();
    }
    const errorMessage =
      e instanceof Error ? e.message : 'Internal Server Error';
    console.error('Worker Error:', errorMessage);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export default {
  /**
   * Main fetch router handling edge API requests and falling back to static SPA assets.
   */
  async fetch(
    request: Request,
    env: Env,
    ctx?: ExecutionContext,
  ): Promise<Response> {
    const isSecure = isSecureOrigin(new URL(request.url));
    return withSecurityHeaders(await handleFetch(request, env, ctx), isSecure);
  },

  /**
   * Deterministic 24-slot UTC hourly cron dispatcher (`0 * * * *`).
   * Isolates each heavy ingestion job to its own UTC hour slot (zero overlapping
   * CPU spikes), reserves 00:00 UTC for daily R2 disaster-recovery backups +
   * launch-day push notifications, and honors the Paid/Free tier switch
   * (`SKIPPED (free_tier_mode)` on heavy ingestion slots when in Free tier).
   */
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const tier = await resolveWorkerPlanTier(env);
    const scheduledMs =
      event.scheduledTime && Number.isFinite(event.scheduledTime)
        ? event.scheduledTime
        : Date.now();
    const now = new Date(scheduledMs);
    const utcHour = now.getUTCHours();
    const todayDateStr = now.toISOString().slice(0, 10);

    let lastDailyRunDate = '';
    try {
      const row = await env.DB.prepare(
        "SELECT value FROM sync_state WHERE key = 'daily_window_last_run'",
      ).first<{ value: string }>();
      if (row?.value) {
        lastDailyRunDate = row.value;
      }
    } catch {
      // unmigrated sync_state table fallback
    }

    const isDailyWindow =
      event.cron === '0 0 * * *' ||
      event.cron === '30 23 * * *' ||
      (utcHour === 0 &&
        (event.cron === '0 * * * *' ||
          (now.getUTCMinutes() < 30 && lastDailyRunDate !== todayDateStr)));

    if (isDailyWindow) {
      try {
        await env.DB.prepare(
          `INSERT INTO sync_state (key, value, updated_at)
           VALUES ('daily_window_last_run', ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')`,
        )
          .bind(todayDateStr, todayDateStr)
          .run();
      } catch (dateErr) {
        console.warn(
          '[WorkerCron] Failed to record daily_window_last_run:',
          dateErr,
        );
      }

      let isDirty: boolean;
      try {
        const dirtyRow = (await env.DB.prepare(
          "SELECT value FROM sync_state WHERE key = 'db_dirty'",
        ).first()) as { value: string } | null;
        isDirty = dirtyRow?.value === '1';
      } catch {
        isDirty = true;
      }

      if (isDirty || !lastDailyRunDate) {
        console.log(
          `[WorkerCron] Executing scheduled daily backup (reason: ${isDirty ? 'data_modified' : 'daily_window'})...`,
        );
        const backupStart = Date.now();
        try {
          const res = await performScheduledBackup(env, true);
          await performChunkedCatalogBackup(env, {
            maxChunksPerRun: 2,
            forceRestart: true,
          }).catch((catBackupErr) => {
            console.warn(
              '[WorkerCron] Chunked catalog backup start failed:',
              catBackupErr,
            );
          });
          await env.DB.prepare(
            `INSERT INTO sync_state (key, value, updated_at)
             VALUES ('db_dirty', '0', datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = '0', updated_at = datetime('now')`,
          ).run();
          logCronExecution(
            'scheduled_backup',
            'SUCCESS',
            Date.now() - backupStart,
            `Backup completed (${res.rowCount} rows, reason: daily_window)`,
            res,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[WorkerCron] Scheduled backup failed:', err);
          logCronExecution(
            'scheduled_backup',
            'ERROR',
            Date.now() - backupStart,
            `Failed: ${msg}`,
            { error: msg },
          );
        }
      } else {
        console.log(
          '[WorkerCron] Database unchanged since last daily backup. Skipping snapshot.',
        );
        if (
          env.BACKUP_BUCKET &&
          !(await env.BACKUP_BUCKET.head(R2_GAMES_ACTIVE_LITE_KEY))
        ) {
          try {
            await writeLiteBackupSnapshots(env);
          } catch (liteErr) {
            console.warn(
              '[WorkerCron] Failed to backfill lite snapshots:',
              liteErr,
            );
          }
        }
        await performChunkedCatalogBackup(env, { maxChunksPerRun: 2 }).catch(
          (catBackupErr) => {
            console.warn(
              '[WorkerCron] Chunked catalog backup resume failed:',
              catBackupErr,
            );
          },
        );
      }

      // Diff-guarded canonical_releases R2 backup (both Paid & Free tiers)
      const canonicalBackupStart = Date.now();
      try {
        const crBackupRes = await performCanonicalReleasesBackup(env, {
          maxChunksPerRun: 2,
        });
        if (!crBackupRes.skipped) {
          logCronExecution(
            'canonical_releases_backup',
            'SUCCESS',
            Date.now() - canonicalBackupStart,
            crBackupRes.inProgress
              ? `Chunked canonical_releases backup in progress (${crBackupRes.rowCount} rows staged, ${crBackupRes.chunksWritten} chunks)`
              : `Backed up ${crBackupRes.rowCount} canonical_releases rows to R2 (${crBackupRes.key})`,
            crBackupRes,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[WorkerCron] Canonical releases R2 backup failed:', err);
        logCronExecution(
          'canonical_releases_backup',
          'ERROR',
          Date.now() - canonicalBackupStart,
          `Failed: ${msg}`,
          { error: msg },
        );
      }
    } else {
      // Daytime lightweight R2 disaster-recovery catchup only when incomplete/stale
      if (env.BACKUP_BUCKET && typeof env.BACKUP_BUCKET.head === 'function') {
        try {
          const [
            hasLatest,
            hasGamesLite,
            hasBackupCatalogManifest,
            hasBackupCanonicalManifest,
            backupCatalogCursorRow,
            backupCanonicalCursorRow,
            canonicalDirtyRow,
          ] = await Promise.all([
            env.BACKUP_BUCKET.head('snapshots/latest.json'),
            env.BACKUP_BUCKET.head(R2_GAMES_ACTIVE_LITE_KEY),
            env.BACKUP_BUCKET.head(R2_BACKUP_CATALOG_MANIFEST_KEY),
            env.BACKUP_BUCKET.head(R2_BACKUP_CANONICAL_MANIFEST_KEY),
            env.DB.prepare('SELECT value FROM sync_state WHERE key = ?')
              .bind(BACKUP_CATALOG_CHUNKS_STATE_KEY)
              .first<{ value: string }>()
              .catch(() => null),
            env.DB.prepare('SELECT value FROM sync_state WHERE key = ?')
              .bind(BACKUP_CANONICAL_CHUNKS_STATE_KEY)
              .first<{ value: string }>()
              .catch(() => null),
            env.DB.prepare(
              "SELECT value FROM sync_state WHERE key = 'canonical_releases_dirty'",
            )
              .first<{ value: string }>()
              .catch(() => null),
          ]);
          const liteDate = hasGamesLite?.customMetadata?.['date'] || '';
          const isGamesLiteStale = Boolean(
            hasLatest && hasGamesLite && liteDate && liteDate !== todayDateStr,
          );
          if (hasLatest && (!hasGamesLite || isGamesLiteStale)) {
            await writeLiteBackupSnapshots(env);
          }
          if (
            backupCatalogCursorRow?.value ||
            (hasLatest && !hasBackupCatalogManifest)
          ) {
            await performChunkedCatalogBackup(env, { maxChunksPerRun: 2 });
          }
          if (
            backupCanonicalCursorRow?.value ||
            canonicalDirtyRow?.value === '1' ||
            (hasLatest && !hasBackupCanonicalManifest)
          ) {
            await performCanonicalReleasesBackup(env, { maxChunksPerRun: 2 });
          }
        } catch (liteBackfillErr) {
          console.warn(
            '[WorkerCron] Daytime one-time lite/chunked backup failed:',
            liteBackfillErr,
          );
        }
      }

      const runGatedIngestion = async (
        jobName: string,
        fn: () => Promise<{
          status?: 'SUCCESS' | 'ERROR';
          summary: string;
          details?: unknown;
          silent?: boolean;
        }>,
      ): Promise<void> => {
        if (tier === 'free') {
          logCronExecution(jobName, 'SKIPPED', 0, 'SKIPPED (free_tier_mode)', {
            tier: 'free',
            utcHour,
          });
          return;
        }
        const jobStart = Date.now();
        try {
          const outcome = await fn();
          if (!outcome.silent) {
            logCronExecution(
              jobName,
              outcome.status ?? 'SUCCESS',
              Date.now() - jobStart,
              outcome.summary,
              outcome.details,
            );
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[WorkerCron] ${jobName} failed:`, err);
          logCronExecution(
            jobName,
            'ERROR',
            Date.now() - jobStart,
            `Failed: ${msg}`,
            { error: msg },
          );
        }
      };

      if (utcHour === 13) {
        // Launch-day release notifications at 13:00 UTC (8 AM EST / 9 AM EDT) in both Paid & Free tiers
        const launchStart = Date.now();
        try {
          const res = await syncWorkerLaunchDayNotifications(env);
          logCronExecution(
            'launch_day',
            'SUCCESS',
            Date.now() - launchStart,
            `Dispatched ${res.dispatchedCount} launch day alerts`,
            res,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[WorkerCron] Launch-day release scan failed:', err);
          logCronExecution(
            'launch_day',
            'ERROR',
            Date.now() - launchStart,
            `Failed: ${msg}`,
            { error: msg },
          );
        }
      }

      switch (utcHour) {
        case 1:
          await runGatedIngestion('worker_dat_sync', async () => {
            const datRes = await syncWorkerDats(env, { mode: 'active' });
            return {
              summary: `Worker DAT sync (active): checked ${datRes.targetsChecked}, updated ${datRes.targetsUpdated}, +${datRes.addedCanonical} canonical, ${datRes.linkedReleases} linked (${datRes.writesUsed} writes)`,
              details: datRes,
            };
          });
          break;
        case 2:
          await runGatedIngestion('nscollectors_sync', async () => {
            const res = await syncWorkerNsCollectors(env);
            return {
              summary: res.hashMatch
                ? 'r/NSCollectors sheets unchanged (0 writes)'
                : `Synced r/NSCollectors (+${res.addedCanonical} canonical, ${res.matchedGames} matched, ${res.ingestedGames} ingested)`,
              details: res,
            };
          });
          break;
        case 3:
          await runGatedIngestion('ps5db_sync', async () => {
            const ps5Res = await syncWorkerPs5Db(env);
            return {
              silent: !ps5Res.checked,
              summary: ps5Res.hashMatch
                ? 'PS5DB sheet unchanged (0 writes)'
                : `Synced PS5DB (+${ps5Res.addedCanonical} / ~${ps5Res.upgradedCanonical} upg / ~${ps5Res.enrichedCanonical} enr, ${ps5Res.linkedReleases} linked)`,
              details: ps5Res,
            };
          });
          break;
        case 4:
        case 16:
          await runGatedIngestion('serialstation_sync', async () => {
            const ssRes = await syncWorkerSerialStation(env);
            return {
              silent: Boolean(ssRes.skipped),
              status: ssRes.error ? 'ERROR' : 'SUCCESS',
              summary: ssRes.error
                ? `Fail-soft at offset ${ssRes.nextOffset}: ${ssRes.error}`
                : `SerialStation sweep (+${ssRes.addedCanonical} / ~${ssRes.upgradedCanonical} upg / ~${ssRes.enrichedCanonical} enr, ${ssRes.linkedReleases} linked, next offset ${ssRes.nextOffset})`,
              details: ssRes,
            };
          });
          break;
        case 5:
        case 17:
          await runGatedIngestion('retail_preorders', async () => {
            try {
              await env.DB.prepare(
                `INSERT INTO sync_state (key, value, updated_at)
                 VALUES ('retail_preorder_sync_last_run', datetime('now'), datetime('now'))
                 ON CONFLICT(key) DO UPDATE SET value = datetime('now'), updated_at = datetime('now')`,
              ).run();
            } catch {
              // Ignore in minimal test mocks
            }
            const rpRes = await syncWorkerRetailPreOrders(env);
            return {
              summary: `Matched ${rpRes.matchedCount}, ingested ${rpRes.ingestedCount} retail pre-orders (${rpRes.totalPreOrders} checked)`,
              details: rpRes,
            };
          });
          break;
        case 6:
        case 18: {
          let lastBoutiqueRun = 0;
          try {
            const row = await env.DB.prepare(
              "SELECT updated_at FROM sync_state WHERE key = 'boutique_sync_last_run'",
            ).first<{ updated_at: string }>();
            if (row?.updated_at) {
              lastBoutiqueRun = new Date(row.updated_at).getTime();
            }
          } catch {
            // unmigrated sync_state table fallback
          }
          if (
            lastBoutiqueRun === 0 ||
            Date.now() - lastBoutiqueRun >= 55 * 60 * 1000
          ) {
            await runGatedIngestion('boutique_preorders', async () => {
              const res = await syncWorkerBoutiquePreOrders(env);
              await env.DB.prepare(
                `INSERT INTO sync_state (key, value, updated_at)
                 VALUES ('boutique_sync_last_run', datetime('now'), datetime('now'))
                 ON CONFLICT(key) DO UPDATE SET value = datetime('now'), updated_at = datetime('now')`,
              ).run();
              return {
                summary: `Matched ${res.matchedCount} pre-orders, sent ${res.notifications.dispatchedCount} alerts`,
                details: res,
              };
            });
          }
          break;
        }
        case 7:
        case 19:
          await runGatedIngestion('retail_deals', async () => {
            const res = await syncWorkerRetailDeals(env);
            await env.DB.prepare(
              `INSERT INTO sync_state (key, value, updated_at)
               VALUES ('retail_deals_last_run', datetime('now'), datetime('now'))
               ON CONFLICT(key) DO UPDATE SET value = datetime('now'), updated_at = datetime('now')`,
            ).run();
            return {
              summary: `Matched ${res.matchedCount} deals from ${res.totalDeals} items`,
              details: res,
            };
          });
          break;
        case 8:
        case 14:
        case 20:
          await runGatedIngestion('watched_series_discovery', async () => {
            const sdRes = await syncWorkerWatchedSeriesDiscovery(env);
            await env.DB.prepare(
              `INSERT INTO sync_state (key, value, updated_at)
               VALUES ('watched_series_discovery_last_run', datetime('now'), datetime('now'))
               ON CONFLICT(key) DO UPDATE SET value = datetime('now'), updated_at = datetime('now')`,
            ).run();
            return {
              silent: Boolean(sdRes.skipped && sdRes.ingestedGames === 0),
              summary: `Scanned ${sdRes.seriesScanned} watched series: ingested ${sdRes.ingestedGames} games / ${sdRes.ingestedReleases} releases, applied ${sdRes.rulesApplied} tracking rules (cursor ${sdRes.cursor})`,
              details: sdRes,
            };
          });
          break;
        case 9:
        case 21:
          await runGatedIngestion('igdb_unmatched_retry', async () => {
            const retryRes = await syncWorkerUnmatchedIgdbRetry(env);
            await env.DB.prepare(
              `INSERT INTO sync_state (key, value, updated_at)
               VALUES ('igdb_retry_last_run', datetime('now'), datetime('now'))
               ON CONFLICT(key) DO UPDATE SET value = datetime('now'), updated_at = datetime('now')`,
            ).run();
            return {
              silent: retryRes.phase === 'disabled',
              summary: `Phase=${retryRes.phase}: scanned ${retryRes.scannedCount}, matched ${retryRes.matchedCount}, updated ${retryRes.updatedCount}, skippedDups=${retryRes.skippedDuplicates}, writes=${retryRes.writesUsed}`,
              details: retryRes,
            };
          });
          break;
        case 10:
        case 22:
          await runGatedIngestion('canonical_tailer', async () => {
            const tailRes = await syncWorkerBroadCatalogPopulation(env);
            return {
              silent: Boolean(tailRes.skipped && tailRes.ingestedGames === 0),
              summary: `Ingested ${tailRes.ingestedGames} games / ${tailRes.ingestedReleases} releases (${tailRes.writesUsed} writes, cursor ${tailRes.cursor})`,
              details: tailRes,
            };
          });
          break;
        case 11:
        case 23:
          await runGatedIngestion('igdb_batch', async () => {
            const res = await syncWorkerIgdbSeriesAndCanonical(env);
            return {
              summary: `Processed ${res.refreshedIgdbCount} IGDB games, updated ${res.updatedGamesCount}, self-healed ${res.selfHealedRulesCount ?? 0} tracking rules (cursor ${res.cursorOffset ?? 0})`,
              details: res,
            };
          });
          break;
        case 12:
          await runGatedIngestion('switch_revisions', async () => {
            const res = await syncWorkerSwitchRevisions(env);
            return {
              summary: res.hashMatch
                ? 'Spreadsheet unchanged (0 writes)'
                : `Synced Switch revisions (+${res.addedCanonical} / ~${res.updatedCanonical} / -${res.deletedCanonical}, ${res.verifiedGames} games verified)`,
              details: res,
            };
          });
          break;
        case 13:
          await runGatedIngestion('worker_dat_sync', async () => {
            const datRes = await syncWorkerDats(env, { mode: 'retro' });
            return {
              summary: `Worker DAT sync (retro): checked ${datRes.targetsChecked}, updated ${datRes.targetsUpdated}, +${datRes.addedCanonical} canonical, ${datRes.linkedReleases} linked (next cursor ${datRes.retroCursor})`,
              details: datRes,
            };
          });
          break;
        case 15:
          await runGatedIngestion('amiibo_catalog', async () => {
            const res = await syncWorkerAmiiboCatalog(env);
            return {
              summary: res.hashMatch
                ? 'AmiiboAPI catalog unchanged (0 writes)'
                : `Synced Amiibo catalog (+${res.addedCount} / ~${res.updatedCount}, ${res.writesUsed} writes)`,
              details: res,
            };
          });
          break;
      }
    }

    // Rotating sweep of 1 ephemeral eBay price shard per tick (max 1-2 subrequests, 0 D1 writes)
    if (env.BACKUP_BUCKET && typeof env.BACKUP_BUCKET.get === 'function') {
      const shardToSweep =
        Math.floor(Date.now() / (30 * 60_000)) % PRICE_CACHE_SHARD_COUNT;
      await purgeSingleExpiredPriceShard(env, shardToSweep).catch((err) => {
        console.warn(
          `[WorkerCron] Failed to sweep expired eBay price shard ${shardToSweep}:`,
          err,
        );
      });
    }
  },
};

interface CatalogRetailLookupEntry {
  stable_id: number;
  title: string;
  platform_id: number;
  igdb_id?: number | null;
  retail_url?: string | null;
  barcode?: string | null;
}

/**
 * Indexes existing and newly ingested catalog rows per platform across URL,
 * exact/numeral-normalized titles, edition-stripped canonical keys, IGDB IDs,
 * and barcodes so retail/boutique cron runs cannot re-ingest duplicates when
 * IGDB renames or numeral/pipe formatting diverges from the store feed.
 */
class PlatformCatalogDedupeIndex<T extends CatalogRetailLookupEntry> {
  private byPlatformUrl = new Map<string, T>();
  private byPlatformDirectKey = new Map<string, T[]>();
  private byPlatformLinkerKey = new Map<string, T[]>();
  private byPlatformLowerTitle = new Map<string, T>();
  private igdbKeys = new Set<string>();
  private barcodes = new Set<string>();

  constructor(entries: Iterable<T> = []) {
    for (const entry of entries) {
      this.register(entry);
    }
  }

  private normalizeUrl(url?: string | null): string {
    return (url || '').trim().toLowerCase();
  }

  private addToKeyBucket(
    map: Map<string, T[]>,
    platformId: number,
    key: string,
    entry: T,
  ): void {
    if (!key) return;
    const mapKey = `${platformId}::${key}`;
    let list = map.get(mapKey);
    if (!list) {
      list = [];
      map.set(mapKey, list);
    }
    if (!list.some((item) => item.stable_id === entry.stable_id)) {
      list.push(entry);
    }
  }

  private getDirectKeys(title: string): string[] {
    const trimmed = (title || '').trim();
    if (!trimmed) return [];
    const exact = normalizeTitleForMatching(trimmed);
    const numeralVol = normalizeTitleForMatching(
      normalizeSafeSequelNumerals(trimmed.replace(/\bvolume\b/gi, 'vol')),
    );
    const keys: string[] = [];
    if (exact) keys.push(exact);
    if (numeralVol && numeralVol !== exact) keys.push(numeralVol);
    return keys;
  }

  register(entry: T): void {
    const pid = entry.platform_id;
    const normUrl = this.normalizeUrl(entry.retail_url);
    if (normUrl) {
      const urlKey = `${pid}::${normUrl}`;
      if (!this.byPlatformUrl.has(urlKey)) {
        this.byPlatformUrl.set(urlKey, entry);
      }
    }
    const lowerTitle = (entry.title || '').trim().toLowerCase();
    if (lowerTitle) {
      const lowerKey = `${pid}::${lowerTitle}`;
      if (!this.byPlatformLowerTitle.has(lowerKey)) {
        this.byPlatformLowerTitle.set(lowerKey, entry);
      }
    }
    for (const directKey of this.getDirectKeys(entry.title)) {
      this.addToKeyBucket(this.byPlatformDirectKey, pid, directKey, entry);
    }
    for (const linkerKey of buildCanonicalLinkerMatchKeys(entry.title)) {
      this.addToKeyBucket(this.byPlatformLinkerKey, pid, linkerKey, entry);
    }
    if (entry.igdb_id && Number(entry.igdb_id) > 0) {
      this.igdbKeys.add(`${pid}::${entry.igdb_id}`);
    }
    if (entry.barcode && entry.barcode.trim()) {
      this.barcodes.add(entry.barcode.trim());
    }
  }

  registerAliases(platformId: number, titles: string[], entry: T): void {
    for (const title of titles) {
      for (const directKey of this.getDirectKeys(title)) {
        this.addToKeyBucket(
          this.byPlatformDirectKey,
          platformId,
          directKey,
          entry,
        );
      }
      for (const linkerKey of buildCanonicalLinkerMatchKeys(title)) {
        this.addToKeyBucket(
          this.byPlatformLinkerKey,
          platformId,
          linkerKey,
          entry,
        );
      }
    }
  }

  findByUrl(platformId: number, url?: string | null): T | undefined {
    const normUrl = this.normalizeUrl(url);
    if (!normUrl) return undefined;
    return this.byPlatformUrl.get(`${platformId}::${normUrl}`);
  }

  findByTitle(platformId: number, title: string): T | undefined {
    if (!title) return undefined;
    // Pass 1: exact / Roman-Arabic numeral match before edition-stripped matches
    for (const directKey of this.getDirectKeys(title)) {
      const list = this.byPlatformDirectKey.get(`${platformId}::${directKey}`);
      if (!list) continue;
      for (const cand of list) {
        if (areCanonicalTitlesSequelCompatible(title, cand.title)) {
          return cand;
        }
      }
    }
    const lowerHit = this.byPlatformLowerTitle.get(
      `${platformId}::${title.trim().toLowerCase()}`,
    );
    if (lowerHit) return lowerHit;

    // Pass 2: edition-stripped canonical match keys (still sequel-guarded)
    for (const linkerKey of buildCanonicalLinkerMatchKeys(title)) {
      const list = this.byPlatformLinkerKey.get(`${platformId}::${linkerKey}`);
      if (!list) continue;
      for (const cand of list) {
        if (areCanonicalTitlesSequelCompatible(title, cand.title)) {
          return cand;
        }
      }
    }
    return undefined;
  }

  findMatch(
    platformId: number,
    title: string,
    url?: string | null,
  ): T | undefined {
    return (
      this.findByUrl(platformId, url) ?? this.findByTitle(platformId, title)
    );
  }

  hasIgdb(platformId: number, igdbId?: number | null): boolean {
    if (!igdbId || Number(igdbId) <= 0) return false;
    return this.igdbKeys.has(`${platformId}::${igdbId}`);
  }

  hasBarcode(barcode?: string | null): boolean {
    const trim = (barcode || '').trim();
    return Boolean(trim && this.barcodes.has(trim));
  }
}

/**
 * Synchronizes active physical video game sales from VGP and PNP Games
 * directly into Cloudflare D1 within Free Tier subrequest limits.
 */
export async function syncWorkerRetailDeals(env: Env): Promise<{
  matchedCount: number;
  totalDeals: number;
  sources?: { vgp: number; pnp: number };
  notifications?: { dispatchedCount: number; purgedCount: number };
}> {
  const { deals, sources } = await fetchAllRetailDeals({
    fetchFn: fetch,
    maxVgpPages: 6,
    maxPnpPages: 8,
  });

  if (deals.length === 0) {
    return { matchedCount: 0, totalDeals: 0, sources };
  }

  const targetPlatforms = Array.from(
    new Set(
      deals
        .filter((d) => d.categoryHint !== 'toy')
        .map((d) => resolveRetailPlatformId(d.platform, d.name))
        .filter((id): id is number => typeof id === 'number' && id > 0),
    ),
  );

  let candidates: Array<
    CandidateGame & {
      id: string;
      igdb_id?: number | null;
      retail_url?: string | null;
    }
  > = [];
  if (targetPlatforms.length > 0) {
    const placeholders = targetPlatforms.map(() => '?').join(', ');
    const candidateRows = await env.DB.prepare(
      `SELECT g.stable_id, g.id, g.title, g.platform_id, g.igdb_id, g.retail_url, 0 as ownership_status, COALESCE(r.barcode, g.barcode) as barcode
       FROM games g
       LEFT JOIN game_releases r ON r.game_id = g.stable_id
       WHERE g.platform_id IN (${placeholders})`,
    )
      .bind(...targetPlatforms)
      .all<{
        stable_id: number;
        id: string;
        title: string;
        platform_id: number;
        igdb_id: number | null;
        retail_url: string | null;
        ownership_status: number;
        barcode: string | null;
      }>();
    candidates = candidateRows.results || [];
  }

  const candidateLookup = new Map<
    number,
    { id: string; title: string; platform_id: number; ownership_status: number }
  >();
  for (const c of candidates) {
    if (!candidateLookup.has(c.stable_id)) {
      candidateLookup.set(c.stable_id, {
        id: c.id,
        title: c.title,
        platform_id: c.platform_id,
        ownership_status: 0,
      });
    }
  }

  const matchedDealItems = new Set<RetailDealItem>();
  const bestDealByGame = new Map<number, RetailDealItem>();
  for (const deal of deals) {
    const stableId = matchRetailGameProduct(deal, candidates);
    if (stableId !== null) {
      matchedDealItems.add(deal);
      if (deal.onSale) {
        const existing = bestDealByGame.get(stableId);
        if (!existing || deal.salePrice < existing.salePrice) {
          bestDealByGame.set(stableId, deal);
        }
      }
    }
  }

  let toyCandidates: CandidateToy[] = [];
  let prevToyRetailRows: Array<{ id: string }> = [];
  try {
    const toyRows = await env.DB.prepare(
      `SELECT id, name, line, series, type, region FROM toys`,
    ).all<CandidateToy>();
    toyCandidates = toyRows.results || [];

    const prevToys = await env.DB.prepare(
      `SELECT id FROM toys WHERE retail_store IN ('VGP', 'PNP Games') AND (retail_on_sale != 0 OR retail_price IS NOT NULL OR retail_url IS NOT NULL)`,
    ).all<{ id: string }>();
    prevToyRetailRows = prevToys.results || [];
  } catch {
    // Toys table or retail columns may not exist in minimal test schemas
  }

  const bestItemByToy = new Map<string, RetailDealItem>();
  if (toyCandidates.length > 0) {
    for (const item of deals) {
      const toyId = matchRetailToyProduct(item, toyCandidates);
      if (toyId !== null) {
        matchedDealItems.add(item);
        const existing = bestItemByToy.get(toyId);
        if (
          !existing ||
          (item.onSale && !existing.onSale) ||
          (item.onSale === existing.onSale &&
            item.salePrice < existing.salePrice)
        ) {
          bestItemByToy.set(toyId, item);
        }
      }
    }
  }

  // Track previously active retail sales so we only clear games whose deals actually expired
  const prevSaleRows = await env.DB.prepare(
    `SELECT stable_id FROM games WHERE retail_store IN ('VGP', 'PNP Games') AND retail_on_sale != 0`,
  ).all<{ stable_id: number }>();

  const statements: D1PreparedStatement[] = [];
  const nowIso = new Date().toISOString();

  for (const [stableId, deal] of bestDealByGame.entries()) {
    const salePriceCents = Math.round(deal.salePrice * 100);
    const regularPriceCents = Math.round(deal.regularPrice * 100);
    const discountPct = Math.round(Number(deal.percentSavings) || 0);

    statements.push(
      env.DB.prepare(
        `UPDATE games
         SET retail_price = ?,
             retail_regular_price = ?,
             retail_discount_pct = ?,
             retail_on_sale = 1,
             retail_store = ?,
             retail_url = ?,
             retail_updated_at = ?
         WHERE stable_id = ?
           AND (retail_on_sale IS NOT 1 OR retail_price IS NOT ? OR retail_regular_price IS NOT ? OR retail_discount_pct IS NOT ? OR retail_store IS NOT ? OR retail_url IS NOT ?)`,
      ).bind(
        salePriceCents,
        regularPriceCents,
        discountPct,
        deal.store,
        deal.url,
        nowIso,
        stableId,
        salePriceCents,
        regularPriceCents,
        discountPct,
        deal.store,
        deal.url,
      ),
    );
  }

  const expiredSaleIds = (prevSaleRows.results || [])
    .map((r) => r.stable_id)
    .filter((id) => !bestDealByGame.has(id));
  if (expiredSaleIds.length > 0) {
    const EXP_CHUNK = 80;
    for (let i = 0; i < expiredSaleIds.length; i += EXP_CHUNK) {
      const slice = expiredSaleIds.slice(i, i + EXP_CHUNK);
      statements.push(
        env.DB.prepare(
          `UPDATE games
           SET retail_on_sale = 0,
               retail_price = COALESCE(retail_regular_price, retail_price),
               retail_discount_pct = 0
           WHERE stable_id IN (${slice.map(() => '?').join(',')}) AND retail_on_sale != 0`,
        ).bind(...slice),
      );
    }
  }

  for (const [toyId, item] of bestItemByToy.entries()) {
    const salePriceCents = Math.round(item.salePrice * 100);
    const regularPriceCents = Math.round(item.regularPrice * 100);
    const discountPct = item.onSale
      ? Math.round(Number(item.percentSavings) || 0)
      : 0;
    const onSaleInt = item.onSale && discountPct > 0 ? 1 : 0;

    statements.push(
      env.DB.prepare(
        `UPDATE toys
         SET retail_price = ?,
             retail_regular_price = ?,
             retail_discount_pct = ?,
             retail_on_sale = ?,
             retail_store = ?,
             retail_url = ?,
             retail_updated_at = ?
         WHERE id = ?
           AND (retail_on_sale IS NOT ? OR retail_price IS NOT ? OR retail_regular_price IS NOT ? OR retail_discount_pct IS NOT ? OR retail_store IS NOT ? OR retail_url IS NOT ?)`,
      ).bind(
        salePriceCents,
        regularPriceCents,
        discountPct,
        onSaleInt,
        item.store,
        item.url,
        nowIso,
        toyId,
        onSaleInt,
        salePriceCents,
        regularPriceCents,
        discountPct,
        item.store,
        item.url,
      ),
    );
  }

  const expiredToyIds = prevToyRetailRows
    .map((r) => r.id)
    .filter((id) => !bestItemByToy.has(id));
  if (expiredToyIds.length > 0) {
    const EXP_CHUNK = 80;
    for (let i = 0; i < expiredToyIds.length; i += EXP_CHUNK) {
      const slice = expiredToyIds.slice(i, i + EXP_CHUNK);
      statements.push(
        env.DB.prepare(
          `UPDATE toys
           SET retail_on_sale = 0,
               retail_price = NULL,
               retail_regular_price = NULL,
               retail_discount_pct = 0,
               retail_store = NULL,
               retail_url = NULL
           WHERE id IN (${slice.map(() => '?').join(',')})
             AND (retail_on_sale != 0 OR retail_price IS NOT NULL OR retail_url IS NOT NULL)`,
        ).bind(...slice),
      );
    }
  }

  if (statements.length > 0) {
    const CHUNK_SIZE = 100;
    for (let i = 0; i < statements.length; i += CHUNK_SIZE) {
      const chunk = statements.slice(i, i + CHUNK_SIZE);
      await env.DB.batch(chunk);
    }
  }

  if (bestItemByToy.size > 0 || expiredToyIds.length > 0) {
    await invalidateToysCatalogChunk(env);
  }

  // Auto-ingest unmatched physical retail games (up to 15 per run, requiring IGDB match or 8-14 digit barcode)
  let retailIngestedCount = 0;
  try {
    const catalogIndex = new PlatformCatalogDedupeIndex(candidates);

    const RETAIL_AUTO_INGEST_CAP = 15;
    const retailIngestMap = new Map<
      string,
      {
        deal: RetailDealItem;
        platformId: number;
        cleanedTitle: string;
        normTitle: string;
        upcTrim: string;
      }
    >();

    for (const item of deals) {
      if (matchedDealItems.has(item) || item.categoryHint === 'toy') continue;
      const platformId = resolveRetailPlatformId(item.platform, item.name);
      if (!platformId || platformId <= 0) continue;
      const cleanedTitle = cleanRetailTitle(item.name);
      if (
        !cleanedTitle ||
        cleanedTitle.length < 2 ||
        isLikelyNonGameMerchTitle(cleanedTitle)
      ) {
        continue;
      }
      const normTitle = normalizeTitleForMatching(cleanedTitle);
      if (!normTitle) continue;
      const dedupeKey = `${platformId}::${normTitle}`;
      if (
        retailIngestMap.has(dedupeKey) ||
        catalogIndex.findMatch(platformId, cleanedTitle, item.url)
      ) {
        continue;
      }
      const upcTrim = (item.upc || '').trim();
      if (upcTrim && catalogIndex.hasBarcode(upcTrim)) continue;

      retailIngestMap.set(dedupeKey, {
        deal: item,
        platformId,
        cleanedTitle,
        normTitle,
        upcTrim,
      });
      if (retailIngestMap.size >= RETAIL_AUTO_INGEST_CAP) break;
    }

    if (retailIngestMap.size > 0) {
      const { byId: platformById } = await loadPlatformLookupMaps(env);
      const igdbLookupItems = Array.from(retailIngestMap.entries())
        .map(([key, entry]) => ({
          key,
          title: entry.cleanedTitle,
          normalizedTitle: entry.normTitle,
          igdbPlatformId: platformById.get(entry.platformId)?.igdbId ?? null,
        }))
        .filter((i) => i.igdbPlatformId && i.igdbPlatformId > 0);
      const igdbMetaMap =
        igdbLookupItems.length > 0
          ? await fetchIgdbMetadataForTitles(env, igdbLookupItems)
          : new Map<string, IgdbGameMeta>();

      const usedSlugs = new Set<string>();
      const retailIngestedForRules: Array<{
        stableId: number;
        platformId: number;
        canonicalSeries?: string | null;
        seriesTrackable?: boolean;
        title?: string;
        platformName?: string | null;
        gameSlug?: string;
        releases: Array<{ id: string; region: string | null }>;
      }> = [];

      for (const [key, entry] of retailIngestMap.entries()) {
        const igdbMeta = igdbMetaMap.get(key) ?? null;
        const validBarcode = /^\d{8,14}$/.test(entry.upcTrim)
          ? entry.upcTrim
          : null;
        if (!igdbMeta && !validBarcode) continue;
        if (
          igdbMeta?.igdb_id &&
          catalogIndex.hasIgdb(entry.platformId, igdbMeta.igdb_id)
        ) {
          continue;
        }

        const platInfo = platformById.get(entry.platformId);
        const canonicalTitle = resolveCanonicalDisplayTitle(
          entry.cleanedTitle,
          igdbMeta?.name,
        );
        if (
          catalogIndex.findMatch(
            entry.platformId,
            canonicalTitle,
            entry.deal.url,
          ) ||
          catalogIndex.findMatch(
            entry.platformId,
            entry.cleanedTitle,
            entry.deal.url,
          )
        ) {
          continue;
        }
        const canonicalSeries = computeGameCanonicalSeries({
          title: canonicalTitle,
          collections: igdbMeta?.collections ?? undefined,
          franchises: igdbMeta?.franchises ?? undefined,
        });
        const salePriceCents = Number.isFinite(entry.deal.salePrice)
          ? Math.round(entry.deal.salePrice * 100)
          : null;
        const regularPriceCents = Number.isFinite(entry.deal.regularPrice)
          ? Math.round(entry.deal.regularPrice * 100)
          : salePriceCents;
        const discountPct = entry.deal.onSale
          ? Math.round(Number(entry.deal.percentSavings) || 0)
          : 0;
        const onSaleInt = entry.deal.onSale && discountPct > 0 ? 1 : 0;
        const canonicalRef = await ensureCanonicalReleaseForRetailOrBoutique(
          env,
          {
            platformId: entry.platformId,
            rawTitle: canonicalTitle,
            region: 'USA',
            variants: 'Standard Edition',
            barcode: validBarcode,
            publisher: entry.deal.store,
            source: 'retail_catalog',
          },
        );
        if (!canonicalRef?.id) continue;

        const inserted = await insertCatalogGameWithReleases(env, {
          title: canonicalTitle,
          platformId: entry.platformId,
          platformSlugHint: platInfo?.displayName || platInfo?.name,
          region: 'USA',
          canonicalSeries,
          barcode: validBarcode,
          igdbMeta,
          retailPriceCents: salePriceCents,
          retailRegularPriceCents: regularPriceCents,
          retailDiscountPct: discountPct,
          retailOnSale: onSaleInt,
          retailStore: entry.deal.store,
          retailUrl: entry.deal.url,
          retailUpdatedAt: nowIso,
          usedSlugs,
          releases: [
            {
              slugSuffix: validBarcode || 'usa',
              region: 'USA',
              variants: 'Standard Edition',
              barcode: validBarcode,
              canonicalReleaseId: canonicalRef?.id ?? null,
              verifiedSource: canonicalRef?.source ?? null,
              canonicalTitle: canonicalRef?.rawTitle ?? null,
              publisher: canonicalRef?.publisher ?? null,
            },
          ],
        });
        if (!inserted) continue;

        const registeredEntry = {
          stable_id: inserted.stableId,
          id: inserted.gameSlug,
          title: canonicalTitle,
          platform_id: entry.platformId,
          igdb_id: igdbMeta?.igdb_id ?? null,
          retail_url: entry.deal.url,
          barcode: validBarcode,
        };
        catalogIndex.register(registeredEntry);
        catalogIndex.registerAliases(
          entry.platformId,
          [entry.cleanedTitle],
          registeredEntry,
        );

        retailIngestedCount++;
        retailIngestedForRules.push({
          stableId: inserted.stableId,
          platformId: entry.platformId,
          canonicalSeries,
          seriesTrackable: isSeriesTrackable({
            title: canonicalTitle,
            collections: igdbMeta?.collections,
            franchises: igdbMeta?.franchises,
          }),
          title: canonicalTitle,
          platformName: platInfo?.displayName || platInfo?.name || null,
          gameSlug: String(inserted.stableId),
          releases: inserted.insertedReleases,
        });
      }

      if (retailIngestedForRules.length > 0) {
        await evaluateTrackingRulesForNewGames(env, retailIngestedForRules, {
          notifySubscribers: true,
        });
        invalidateSeriesScanCache();
        await invalidateCatalogManifest(env);
        await markDbDirty(env);
      }
    }
  } catch (retailIngestErr) {
    console.warn('[WorkerCron] Retail auto-ingestion failed:', retailIngestErr);
  }

  let notificationResult = { dispatchedCount: 0, purgedCount: 0 };
  if (bestDealByGame.size > 0) {
    notificationResult = await dispatchDealPushNotifications(
      env,
      candidateLookup,
      bestDealByGame,
    );
  }

  return {
    matchedCount:
      bestDealByGame.size + bestItemByToy.size + retailIngestedCount,
    totalDeals: deals.length,
    sources,
    notifications: notificationResult,
  };
}

/**
 * Synchronizes newly listed mainstream pre-orders from VGP & PNP Games (category 13767).
 * Matches existing titles (filling missing release dates & retail pricing) and immediately
 * auto-ingests newly announced physical releases (with IGDB metadata when available).
 */
export async function syncWorkerRetailPreOrders(env: Env): Promise<{
  matchedCount: number;
  ingestedCount: number;
  totalPreOrders: number;
  sources: { vgp: number; pnp: number };
}> {
  const { preOrders, sources } = await fetchAllRetailPreOrders({
    fetchFn: fetch,
    maxVgpPages: 2,
    maxPnpPages: 4,
  });

  if (preOrders.length === 0) {
    return { matchedCount: 0, ingestedCount: 0, totalPreOrders: 0, sources };
  }

  let currentHash = '';
  try {
    const sig = preOrders
      .map(
        (po) =>
          `${po.store}|${po.sku}|${po.name}|${po.platform ?? ''}|${po.releaseDate ?? ''}|${po.salePrice}`,
      )
      .sort()
      .join('||');
    const hashBuf = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(sig),
    );
    currentHash = Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const lastHash = await env.DB.prepare(
      "SELECT value FROM sync_state WHERE key = 'retail_preorders_hash'",
    ).first<{ value: string }>();
    if (lastHash?.value === currentHash) {
      return {
        matchedCount: 0,
        ingestedCount: 0,
        totalPreOrders: preOrders.length,
        sources,
      };
    }
  } catch {
    // Proceed cleanly in minimal test schemas
  }

  const targetPlatforms = Array.from(
    new Set(
      preOrders
        .map((po) => resolveRetailPlatformId(po.platform, po.name))
        .filter((id): id is number => typeof id === 'number' && id > 0),
    ),
  );
  if (targetPlatforms.length === 0) {
    return {
      matchedCount: 0,
      ingestedCount: 0,
      totalPreOrders: preOrders.length,
      sources,
    };
  }

  const placeholders = targetPlatforms.map(() => '?').join(', ');
  const candidateRows = await env.DB.prepare(
    `SELECT g.stable_id, g.id, g.title, g.platform_id, g.igdb_id, g.retail_url, COALESCE(r.barcode, g.barcode) as barcode
     FROM games g
     LEFT JOIN game_releases r ON r.game_id = g.stable_id
     WHERE g.platform_id IN (${placeholders})`,
  )
    .bind(...targetPlatforms)
    .all<
      CandidateGame & {
        igdb_id?: number | null;
        retail_url?: string | null;
      }
    >();

  const candidates = candidateRows.results || [];
  const catalogIndex = new PlatformCatalogDedupeIndex(candidates);

  let matchedCount = 0;
  const nowIso = new Date().toISOString();
  const updateStmts: D1PreparedStatement[] = [];
  const RETAIL_PREORDER_AUTO_INGEST_CAP = 15;
  const pendingIngest = new Map<
    string,
    {
      item: RetailDealItem;
      platformId: number;
      cleanedTitle: string;
      normTitle: string;
      upcTrim: string;
    }
  >();

  for (const po of preOrders) {
    const cleanedTitle = cleanRetailTitle(po.name);
    if (!cleanedTitle || cleanedTitle.length < 2) continue;
    const normTitle = normalizeTitleForMatching(cleanedTitle);
    const platformId = resolveRetailPlatformId(po.platform, po.name);

    let matchedId = matchRetailGameProduct(po, candidates);
    if (matchedId === null && platformId) {
      matchedId =
        catalogIndex.findMatch(platformId, cleanedTitle, po.url)?.stable_id ??
        null;
    }

    if (matchedId !== null) {
      matchedCount++;
      const saleCents = Number.isFinite(po.salePrice)
        ? Math.round(po.salePrice * 100)
        : null;
      const regularCents = Number.isFinite(po.regularPrice)
        ? Math.round(po.regularPrice * 100)
        : saleCents;
      updateStmts.push(
        env.DB.prepare(
          `UPDATE games
           SET retail_price = COALESCE(?, retail_price),
               retail_regular_price = COALESCE(?, retail_regular_price),
               retail_store = COALESCE(retail_store, ?),
               retail_url = COALESCE(retail_url, ?),
               retail_updated_at = ?
           WHERE stable_id = ? AND (retail_url IS NULL OR retail_price IS NULL)`,
        ).bind(saleCents, regularCents, po.store, po.url, nowIso, matchedId),
      );
      if (po.releaseDate) {
        updateStmts.push(
          env.DB.prepare(
            `UPDATE game_releases
             SET release_date = ?
             WHERE game_id = ? AND release_date IS NULL`,
          ).bind(po.releaseDate, matchedId),
        );
      }
      continue;
    }

    if (
      !platformId ||
      platformId <= 0 ||
      isLikelyNonGameMerchTitle(cleanedTitle)
    ) {
      continue;
    }
    const dedupeKey = `${platformId}::${normTitle}`;
    const upcTrim = (po.upc || '').trim();
    if (
      !normTitle ||
      pendingIngest.has(dedupeKey) ||
      (upcTrim && catalogIndex.hasBarcode(upcTrim))
    ) {
      continue;
    }
    if (pendingIngest.size < RETAIL_PREORDER_AUTO_INGEST_CAP) {
      pendingIngest.set(dedupeKey, {
        item: po,
        platformId,
        cleanedTitle,
        normTitle,
        upcTrim,
      });
    }
  }

  for (let i = 0; i < updateStmts.length; i += 100) {
    await env.DB.batch(updateStmts.slice(i, i + 100));
  }

  let ingestedCount = 0;
  if (pendingIngest.size > 0) {
    let isColdStartSeed: boolean;
    try {
      const seedRow = await env.DB.prepare(
        "SELECT value FROM sync_state WHERE key = 'retail_preorder_seed_completed'",
      ).first<{ value: string }>();
      isColdStartSeed = seedRow?.value !== '1';
    } catch {
      isColdStartSeed = true;
    }

    const { byId: platformById } = await loadPlatformLookupMaps(env);
    const igdbLookupItems = Array.from(pendingIngest.entries())
      .map(([key, entry]) => ({
        key,
        title: entry.cleanedTitle,
        normalizedTitle: entry.normTitle,
        igdbPlatformId: platformById.get(entry.platformId)?.igdbId ?? null,
      }))
      .filter((i) => i.igdbPlatformId && i.igdbPlatformId > 0);
    const igdbMetaMap =
      igdbLookupItems.length > 0
        ? await fetchIgdbMetadataForTitles(env, igdbLookupItems)
        : new Map<string, IgdbGameMeta>();

    const usedSlugs = new Set<string>();
    const ingestedForRules: Array<{
      stableId: number;
      platformId: number;
      canonicalSeries?: string | null;
      seriesTrackable?: boolean;
      title?: string;
      platformName?: string | null;
      gameSlug?: string;
      releases: Array<{ id: string; region: string | null }>;
    }> = [];

    for (const [key, entry] of pendingIngest.entries()) {
      const igdbMeta = igdbMetaMap.get(key) ?? null;
      if (
        igdbMeta?.igdb_id &&
        catalogIndex.hasIgdb(entry.platformId, igdbMeta.igdb_id)
      ) {
        continue;
      }
      const validBarcode = /^\d{8,14}$/.test(entry.upcTrim)
        ? entry.upcTrim
        : null;
      const platInfo = platformById.get(entry.platformId);
      const canonicalTitle = resolveCanonicalDisplayTitle(
        entry.cleanedTitle,
        igdbMeta?.name,
      );
      if (
        catalogIndex.findMatch(
          entry.platformId,
          canonicalTitle,
          entry.item.url,
        ) ||
        catalogIndex.findMatch(
          entry.platformId,
          entry.cleanedTitle,
          entry.item.url,
        )
      ) {
        continue;
      }
      const canonicalSeries = computeGameCanonicalSeries({
        title: canonicalTitle,
        collections: igdbMeta?.collections ?? undefined,
        franchises: igdbMeta?.franchises ?? undefined,
      });
      const saleCents = Number.isFinite(entry.item.salePrice)
        ? Math.round(entry.item.salePrice * 100)
        : null;
      const regularCents = Number.isFinite(entry.item.regularPrice)
        ? Math.round(entry.item.regularPrice * 100)
        : saleCents;
      const canonicalRef = await ensureCanonicalReleaseForRetailOrBoutique(
        env,
        {
          platformId: entry.platformId,
          rawTitle: canonicalTitle,
          region: 'USA',
          variants: 'Standard Edition',
          barcode: validBarcode,
          publisher: entry.item.store,
          source: 'retail_catalog',
        },
      );
      if (!canonicalRef?.id) continue;

      const inserted = await insertCatalogGameWithReleases(env, {
        title: canonicalTitle,
        platformId: entry.platformId,
        platformSlugHint: platInfo?.displayName || platInfo?.name,
        region: 'USA',
        canonicalSeries,
        barcode: validBarcode,
        igdbMeta,
        retailPriceCents: saleCents,
        retailRegularPriceCents: regularCents,
        retailStore: entry.item.store,
        retailUrl: entry.item.url,
        retailUpdatedAt: nowIso,
        usedSlugs,
        releases: [
          {
            slugSuffix: validBarcode || 'usa',
            region: 'USA',
            variants: 'Standard Edition',
            releaseDate: entry.item.releaseDate ?? null,
            barcode: validBarcode,
            canonicalReleaseId: canonicalRef?.id ?? null,
            verifiedSource: canonicalRef?.source ?? null,
            canonicalTitle: canonicalRef?.rawTitle ?? null,
            publisher: canonicalRef?.publisher ?? null,
          },
        ],
      });
      if (!inserted) continue;

      const registeredEntry = {
        stable_id: inserted.stableId,
        id: inserted.gameSlug,
        title: canonicalTitle,
        platform_id: entry.platformId,
        igdb_id: igdbMeta?.igdb_id ?? null,
        retail_url: entry.item.url,
        barcode: validBarcode,
      };
      catalogIndex.register(registeredEntry);
      catalogIndex.registerAliases(
        entry.platformId,
        [entry.cleanedTitle],
        registeredEntry,
      );

      ingestedCount++;
      ingestedForRules.push({
        stableId: inserted.stableId,
        platformId: entry.platformId,
        canonicalSeries,
        seriesTrackable: isSeriesTrackable({
          title: canonicalTitle,
          collections: igdbMeta?.collections,
          franchises: igdbMeta?.franchises,
        }),
        title: canonicalTitle,
        platformName: platInfo?.displayName || platInfo?.name || null,
        gameSlug: String(inserted.stableId),
        releases: inserted.insertedReleases,
      });
    }

    if (ingestedForRules.length > 0) {
      await evaluateTrackingRulesForNewGames(env, ingestedForRules, {
        notifySubscribers: !isColdStartSeed,
      });
      invalidateSeriesScanCache();
      await invalidateCatalogManifest(env);
      await markDbDirty(env);
    }

    if (isColdStartSeed) {
      try {
        await env.DB.prepare(
          `INSERT INTO sync_state (key, value, updated_at)
           VALUES ('retail_preorder_seed_completed', '1', CURRENT_TIMESTAMP)
           ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = CURRENT_TIMESTAMP`,
        ).run();
      } catch {
        // Ignore in minimal schemas
      }
    }
  }

  if (currentHash) {
    try {
      await env.DB.prepare(
        `INSERT INTO sync_state (key, value, updated_at)
         VALUES ('retail_preorders_hash', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      )
        .bind(currentHash)
        .run();
    } catch {
      // Ignore in minimal schemas
    }
  }

  return {
    matchedCount,
    ingestedCount,
    totalPreOrders: preOrders.length,
    sources,
  };
}

/**
 * Dispatches Web Push deal notifications to active subscribers matching user preferences.
 */
export async function dispatchDealPushNotifications(
  env: Env,
  gameLookup: Map<
    number,
    { id: string; title: string; platform_id: number; ownership_status: number }
  >,
  bestDealByGame: Map<number, RetailDealItem>,
): Promise<{ dispatchedCount: number; purgedCount: number }> {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, COALESCE(user_id, 1) as user_id, endpoint, p256dh, auth, preferences_json FROM push_subscriptions`,
    ).all<{
      id: string;
      user_id: number;
      endpoint: string;
      p256dh: string;
      auth: string;
      preferences_json: string;
    }>();

    const subscriptions = results || [];
    if (subscriptions.length === 0 || bestDealByGame.size === 0) {
      return { dispatchedCount: 0, purgedCount: 0 };
    }

    const subscribedUserIds = Array.from(
      new Set(subscriptions.map((s) => s.user_id || 1)),
    );
    const userOwnershipMap = new Map<string, number>();
    if (subscribedUserIds.length > 0) {
      try {
        const subPlaceholders = subscribedUserIds.map(() => '?').join(',');
        const ugrRows = await env.DB.prepare(
          `SELECT ugr.user_id, r.game_id as stable_id, MAX(ugr.ownership_status) as ownership_status
           FROM user_game_releases ugr
           JOIN game_releases r ON r.id = ugr.release_id
           WHERE ugr.user_id IN (${subPlaceholders})
           GROUP BY ugr.user_id, r.game_id`,
        )
          .bind(...subscribedUserIds)
          .all<{
            user_id: number;
            stable_id: number;
            ownership_status: number;
          }>();
        for (const row of ugrRows.results || []) {
          userOwnershipMap.set(
            `${row.user_id}:${row.stable_id}`,
            row.ownership_status ?? 0,
          );
        }
      } catch {
        // Fallback to 0 (unowned) if user_game_releases lookup fails
      }
    }

    let dispatchedCount = 0;
    let purgedCount = 0;

    for (const sub of subscriptions) {
      const subUserId = sub.user_id || 1;
      let prefs: {
        enabled?: boolean;
        scope?:
          | 'priority_seeking_only'
          | 'all_seeking'
          | 'seeking_only'
          | 'seeking_and_unowned'
          | 'all';
        minDiscountPct?: number;
        maxPriceCents?: number | null;
        platformIds?: number[];
        stores?: string[];
      } = {};

      try {
        prefs = JSON.parse(sub.preferences_json || '{}');
      } catch {
        prefs = {};
      }

      if (prefs.enabled === false) {
        continue;
      }

      const scope = prefs.scope || 'seeking_only';
      const minDiscount = prefs.minDiscountPct ?? 20;
      const maxPrice = prefs.maxPriceCents ?? null;
      const platformIds =
        prefs.platformIds && prefs.platformIds.length > 0
          ? new Set(prefs.platformIds)
          : null;
      const stores =
        prefs.stores && prefs.stores.length > 0
          ? new Set(prefs.stores.map((s) => s.toLowerCase()))
          : null;

      const matchedGames: Array<{
        title: string;
        slug: string;
        deal: RetailDealItem;
        discountPct: number;
      }> = [];

      for (const [stableId, deal] of bestDealByGame.entries()) {
        const game = gameLookup.get(stableId);
        if (!game) continue;

        const userKey = `${subUserId}:${stableId}`;
        const effectiveOwnership = userOwnershipMap.get(userKey) ?? 0;

        if (scope === 'priority_seeking_only' && effectiveOwnership !== 4) {
          continue;
        } else if (
          (scope === 'all_seeking' || scope === 'seeking_only') &&
          effectiveOwnership !== 2 &&
          effectiveOwnership !== 4
        ) {
          continue;
        } else if (
          scope === 'seeking_and_unowned' &&
          effectiveOwnership !== 2 &&
          effectiveOwnership !== 4 &&
          effectiveOwnership !== 0
        ) {
          continue;
        }

        const discountPct = Math.round(Number(deal.percentSavings) || 0);
        if (discountPct < minDiscount) {
          continue;
        }

        const priceCents = Math.round(deal.salePrice * 100);
        if (maxPrice !== null && priceCents > maxPrice) {
          continue;
        }

        if (platformIds && !platformIds.has(game.platform_id)) {
          continue;
        }

        if (stores && !stores.has(deal.store.toLowerCase())) {
          continue;
        }

        matchedGames.push({
          title: game.title,
          slug: String(stableId),
          deal,
          discountPct,
        });
      }

      if (matchedGames.length === 0) {
        continue;
      }

      matchedGames.sort((a, b) => b.discountPct - a.discountPct);
      const top = matchedGames[0];

      let title = `Deal Alert: ${top.title}`;
      let body = `Now $${top.deal.salePrice.toFixed(2)} (${top.discountPct}% off) at ${top.deal.store}!`;
      if (matchedGames.length > 1) {
        title = `Deal Alerts: ${matchedGames.length} Games On Sale`;
        body = `${top.title} ($${top.deal.salePrice.toFixed(2)}, -${top.discountPct}%) & ${matchedGames.length - 1} more!`;
      }

      const payload: WebPushNotificationPayload = {
        title,
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
        data: {
          url: `/game/${top.slug}`,
        },
      };

      const result = await sendWebPushNotification(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        payload,
        {
          publicKey: env.VAPID_PUBLIC_KEY,
          privateKey: env.VAPID_PRIVATE_KEY,
          subject: resolveVapidSubject(undefined, undefined, env.ADMIN_EMAIL),
          fetchFn: fetch,
        },
      );

      if (result.success) {
        dispatchedCount++;
      } else if (result.shouldDelete) {
        await env.DB.prepare(
          'DELETE FROM push_subscriptions WHERE endpoint = ?',
        )
          .bind(sub.endpoint)
          .run();
        purgedCount++;
      }
    }

    return { dispatchedCount, purgedCount };
  } catch (err) {
    console.error('[WebPush] Error dispatching deal notifications:', err);
    return { dispatchedCount: 0, purgedCount: 0 };
  }
}

/**
 * Synchronizes Nintendo Switch 1 & 2 canonical cartridge revisions from the Nintendo Revised
 * community Google Spreadsheet into Cloudflare D1 with hash-gated zero-write fast path and row-level diffing.
 */
export async function syncWorkerSwitchRevisions(env: Env): Promise<{
  checked: boolean;
  hashMatch: boolean;
  addedCanonical: number;
  updatedCanonical: number;
  deletedCanonical: number;
  verifiedGames: number;
}> {
  const tabContents = await fetchSwitchSpreadsheetTabs();

  // Compute SHA-256 hash of all tab CSV contents combined (prefixed with parser schema version)
  const combinedCsv =
    'v4||' + tabContents.map((t) => `${t.tab.gid}:${t.csv}`).join('||');
  const encoder = new TextEncoder();
  const data = encoder.encode(combinedCsv);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const currentHash = hashArray
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const lastHashRow = await env.DB.prepare(
    "SELECT value FROM sync_state WHERE key = 'switch_revisions_hash'",
  ).first<{ value: string }>();

  if (lastHashRow?.value === currentHash) {
    return {
      checked: true,
      hashMatch: true,
      addedCanonical: 0,
      updatedCanonical: 0,
      deletedCanonical: 0,
      verifiedGames: 0,
    };
  }

  // Parse CSV into canonical releases
  const canonicalReleases = parseSwitchRevisionsCsv(tabContents);

  // Unlink & delete legacy DAT rows for platforms 26 & 27 if any exist
  await env.DB.prepare(
    `
    UPDATE game_releases
    SET canonical_release_id = NULL,
        verified_source = NULL,
        serial_code = NULL,
        canonical_title = NULL,
        publisher = NULL
    WHERE canonical_release_id IN (
      SELECT id FROM canonical_releases WHERE platform_id IN (26, 27) AND source = 'dat'
    )
  `,
  ).run();
  await env.DB.prepare(
    "DELETE FROM canonical_releases WHERE platform_id IN (26, 27) AND source = 'dat'",
  ).run();

  // Prune any superseded Past Revisions alias rows from previous parser versions
  const aliasKeys = Object.keys(PAST_REVISION_TITLE_ALIASES);
  for (let i = 0; i < aliasKeys.length; i += 80) {
    const chunk = aliasKeys.slice(i, i + 80);
    const ph = chunk.map(() => '?').join(',');
    await env.DB.prepare(
      `UPDATE game_releases
       SET canonical_release_id = NULL,
           verified_source = NULL,
           serial_code = NULL,
           canonical_title = NULL,
           publisher = NULL
       WHERE canonical_release_id IN (
         SELECT id FROM canonical_releases
         WHERE platform_id IN (26, 27) AND source = 'nintendo_revised' AND normalized_title IN (${ph})
       )`,
    )
      .bind(...chunk)
      .run();
    await env.DB.prepare(
      `DELETE FROM canonical_releases
       WHERE platform_id IN (26, 27) AND source = 'nintendo_revised' AND normalized_title IN (${ph})`,
    )
      .bind(...chunk)
      .run();
  }

  // Query existing canonical releases
  const existingRows = await env.DB.prepare(
    "SELECT id, platform_id, raw_title, normalized_title, region, variants, serial_code FROM canonical_releases WHERE platform_id IN (26, 27) AND source = 'nintendo_revised'",
  ).all<{
    id: number;
    platform_id: number;
    raw_title: string;
    normalized_title: string;
    region: string | null;
    variants: string | null;
    serial_code: string | null;
  }>();

  const existingMap = new Map<string, (typeof existingRows.results)[0]>();
  for (const r of existingRows.results || []) {
    const key = `${r.platform_id}::${r.normalized_title}::${r.region || 'World'}::${r.variants || 'Standard'}`;
    existingMap.set(key, r);
  }

  // Preserve historical canonical_releases rows as an append-only ledger so revisions
  // overwritten on the main spreadsheet tab without a Past Revisions entry are never lost.
  const statements: D1PreparedStatement[] = [];
  let added = 0;
  let updated = 0;
  const deleted = 0;

  for (const rel of canonicalReleases) {
    const key = `${rel.platform_id}::${rel.normalized_title}::${rel.region || 'World'}::${rel.variants || 'Standard'}`;
    const existing = existingMap.get(key);
    if (!existing) {
      statements.push(
        env.DB.prepare(
          "INSERT INTO canonical_releases (platform_id, raw_title, normalized_title, region, variants, serial_code, source, is_verified_physical) VALUES (?, ?, ?, ?, ?, ?, 'nintendo_revised', 1)",
        ).bind(
          rel.platform_id,
          rel.raw_title,
          rel.normalized_title,
          rel.region,
          rel.variants,
          rel.serial_code,
        ),
      );
      added++;
    } else if (
      existing.serial_code !== (rel.serial_code || null) ||
      existing.raw_title !== rel.raw_title
    ) {
      statements.push(
        env.DB.prepare(
          'UPDATE canonical_releases SET raw_title = ?, serial_code = ? WHERE id = ?',
        ).bind(rel.raw_title, rel.serial_code || null, existing.id),
      );
      statements.push(
        env.DB.prepare(
          `UPDATE game_releases
           SET verified_source = 'nintendo_revised',
               canonical_title = ?,
               serial_code = ?
           WHERE canonical_release_id = ?
             AND (verified_source IS NOT 'nintendo_revised' OR canonical_title IS NOT ? OR serial_code IS NOT ?)`,
        ).bind(
          rel.raw_title,
          rel.serial_code || null,
          existing.id,
          rel.raw_title,
          rel.serial_code || null,
        ),
      );
      updated++;
    }
  }

  // Execute in batches of 100 statements
  for (let i = 0; i < statements.length; i += 100) {
    await env.DB.batch(statements.slice(i, i + 100));
  }

  // Count matched Switch games and materialize any missing regional revisions into game_releases
  const gamesRes = await env.DB.prepare(
    'SELECT stable_id, id, title, platform_id FROM games WHERE platform_id IN (26, 27)',
  ).all<{
    stable_id: number;
    id: string;
    title: string;
    platform_id: number;
  }>();

  const canonicalByPlatformNorm = new Set<string>();
  for (const cr of canonicalReleases) {
    canonicalByPlatformNorm.add(`${cr.platform_id}::${cr.normalized_title}`);
    const strippedCr = normalizeTitleForMatching(
      stripEditionSuffix(cr.raw_title),
    );
    if (strippedCr) {
      canonicalByPlatformNorm.add(`${cr.platform_id}::${strippedCr}`);
    }
  }

  const gameStatements: D1PreparedStatement[] = [];
  let verifiedGames = 0;
  for (const g of gamesRes.results || []) {
    const norm = normalizeTitleForMatching(g.title);
    const strippedNorm = normalizeTitleForMatching(stripEditionSuffix(g.title));
    if (
      canonicalByPlatformNorm.has(`${g.platform_id}::${norm}`) ||
      canonicalByPlatformNorm.has(`${g.platform_id}::${strippedNorm}`)
    ) {
      verifiedGames++;
    }
  }

  if (added > 0 || updated > 0) {
    const [allCanonicalRes, existingGameRelsRes] = await Promise.all([
      env.DB.prepare(
        "SELECT id, platform_id, raw_title, normalized_title, region, variants, serial_code, publisher, source FROM canonical_releases WHERE platform_id IN (26, 27) AND source = 'nintendo_revised'",
      ).all<{
        id: number;
        platform_id: number;
        raw_title: string;
        normalized_title: string;
        region: string | null;
        variants: string | null;
        serial_code: string | null;
        publisher: string | null;
        source: string;
      }>(),
      env.DB.prepare(
        'SELECT gr.id, gr.game_id, gr.region, gr.variants, gr.canonical_release_id FROM game_releases gr JOIN games g ON g.stable_id = gr.game_id WHERE g.platform_id IN (26, 27)',
      ).all<{
        id: string;
        game_id: number;
        region: string | null;
        variants: string | null;
        canonical_release_id: number | null;
      }>(),
    ]);

    const canonicalByKey = new Map<
      string,
      Array<(typeof allCanonicalRes.results)[0]>
    >();
    const pushCanonicalKey = (
      key: string,
      cr: (typeof allCanonicalRes.results)[0],
    ) => {
      let list = canonicalByKey.get(key);
      if (!list) {
        list = [];
        canonicalByKey.set(key, list);
      }
      if (!list.some((existing) => existing.id === cr.id)) {
        list.push(cr);
      }
    };
    for (const cr of allCanonicalRes.results || []) {
      pushCanonicalKey(`${cr.platform_id}::${cr.normalized_title}`, cr);
      const strippedCrNorm = normalizeTitleForMatching(
        stripEditionSuffix(cr.raw_title),
      );
      if (strippedCrNorm && strippedCrNorm !== cr.normalized_title) {
        pushCanonicalKey(`${cr.platform_id}::${strippedCrNorm}`, cr);
      }
    }

    const existingRelIdsByGame = new Map<number, Set<string>>();
    const existingCanonicalIdsByGame = new Map<number, Set<number>>();
    const verifiedByGame = new Map<
      number,
      Array<{ region: string | null; variants: string | null }>
    >();
    const unlinkedByGame = new Map<
      number,
      Array<{ id: string; region: string | null; variants: string | null }>
    >();
    for (const gr of existingGameRelsRes.results || []) {
      let idSet = existingRelIdsByGame.get(gr.game_id);
      if (!idSet) {
        idSet = new Set<string>();
        existingRelIdsByGame.set(gr.game_id, idSet);
      }
      idSet.add(gr.id);
      if (gr.canonical_release_id != null) {
        let canSet = existingCanonicalIdsByGame.get(gr.game_id);
        if (!canSet) {
          canSet = new Set<number>();
          existingCanonicalIdsByGame.set(gr.game_id, canSet);
        }
        canSet.add(gr.canonical_release_id);
      }
      if (gr.canonical_release_id || gr.variants) {
        const vList = verifiedByGame.get(gr.game_id) || [];
        vList.push({ region: gr.region || 'World', variants: gr.variants });
        verifiedByGame.set(gr.game_id, vList);
      } else {
        const uList = unlinkedByGame.get(gr.game_id) || [];
        uList.push({
          id: gr.id,
          region: gr.region || 'USA',
          variants: gr.variants,
        });
        unlinkedByGame.set(gr.game_id, uList);
      }
    }

    for (const g of gamesRes.results || []) {
      const norm = normalizeTitleForMatching(g.title);
      const strippedNorm = normalizeTitleForMatching(
        stripEditionSuffix(g.title),
      );
      const rawCrs =
        canonicalByKey.get(`${g.platform_id}::${norm}`) ||
        canonicalByKey.get(`${g.platform_id}::${strippedNorm}`) ||
        [];
      const crs = rawCrs
        .slice()
        .sort((a, b) => (a.variants || '').localeCompare(b.variants || ''));
      for (const cr of crs) {
        let usedCanSet = existingCanonicalIdsByGame.get(g.stable_id);
        if (!usedCanSet) {
          usedCanSet = new Set<number>();
          existingCanonicalIdsByGame.set(g.stable_id, usedCanSet);
        }
        if (usedCanSet.has(cr.id)) continue;
        const reg = cr.region || 'World';
        if (reg === 'World') continue;
        const targetVar = (cr.variants || 'Standard').trim();
        const verifiedList = verifiedByGame.get(g.stable_id) || [];
        const alreadyCovered = verifiedList.some(
          (v) =>
            regionsOverlap(v.region, reg) &&
            (v.variants || 'Standard').trim() === targetVar,
        );
        if (alreadyCovered) continue;

        const unlinkedList = unlinkedByGame.get(g.stable_id) || [];
        const unlinkedIdx = unlinkedList.findIndex(
          (u) => !u.variants && regionsOverlap(u.region, reg),
        );
        const hasVerifiedInRegion = verifiedList.some((v) =>
          regionsOverlap(v.region, reg),
        );
        if (
          unlinkedIdx >= 0 &&
          (/^Rev\s+0{2,3}\b/i.test(cr.variants || '') || !hasVerifiedInRegion)
        ) {
          const [claimed] = unlinkedList.splice(unlinkedIdx, 1);
          usedCanSet.add(cr.id);
          verifiedList.push({
            region: claimed.region || reg,
            variants: cr.variants,
          });
          verifiedByGame.set(g.stable_id, verifiedList);
          gameStatements.push(
            env.DB.prepare(
              `UPDATE game_releases
               SET variants = ?, canonical_release_id = ?, verified_source = ?, serial_code = ?, canonical_title = ?, publisher = ?
               WHERE id = ?
                 AND canonical_release_id IS NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM game_releases gr2
                   WHERE gr2.game_id = game_releases.game_id
                     AND gr2.canonical_release_id = ?
                     AND gr2.id != game_releases.id
                 )`,
            ).bind(
              cr.variants,
              cr.id,
              cr.source,
              cr.serial_code,
              cr.raw_title,
              cr.publisher,
              claimed.id,
              cr.id,
            ),
          );
          continue;
        }

        usedCanSet.add(cr.id);
        verifiedList.push({ region: reg, variants: cr.variants });
        verifiedByGame.set(g.stable_id, verifiedList);
        let idSet = existingRelIdsByGame.get(g.stable_id);
        if (!idSet) {
          idSet = new Set<string>();
          existingRelIdsByGame.set(g.stable_id, idSet);
        }
        const relId = nextSequentialReleaseId(g.stable_id, idSet);
        gameStatements.push(
          env.DB.prepare(
            `INSERT INTO game_releases (
               id, game_id, region, variants, canonical_release_id,
               verified_source, serial_code, canonical_title, publisher
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT DO NOTHING`,
          ).bind(
            relId,
            g.stable_id,
            reg,
            cr.variants,
            cr.id,
            cr.source,
            cr.serial_code,
            cr.raw_title,
            cr.publisher,
          ),
        );
      }
    }
  }

  for (let i = 0; i < gameStatements.length; i += 100) {
    await env.DB.batch(gameStatements.slice(i, i + 100));
  }
  if (gameStatements.length > 0) {
    await markDbDirty(env);
    await markCatalogChunksDirty(env);
  }
  if (added > 0 || updated > 0 || deleted > 0) {
    await markCanonicalReleasesDirty(env);
  }

  // Save new hash into sync_state
  await env.DB.prepare(
    `INSERT INTO sync_state (key, value, updated_at) VALUES ('switch_revisions_hash', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')`,
  )
    .bind(currentHash, currentHash)
    .run();

  return {
    checked: true,
    hashMatch: false,
    addedCanonical: added,
    updatedCanonical: updated,
    deletedCanonical: deleted,
    verifiedGames,
  };
}

/**
 * Synchronizes the r/NSCollectors Switch 1 & 2 community physical lists (5 CSV tabs)
 * into `canonical_releases` and ingests genuinely new Switch 1 & 2 physical releases
 * immediately when listed in Master, SW2 Details, or Upcoming tabs.
 * Links existing unlinked Switch 1/2 releases, upgrades graduated Upcoming releases
 * to Master/SW2 Details, and prunes cancelled Upcoming entries after 2 consecutive
 * non-truncated misses (strictly user-state-independent).
 * Uses SHA-256 hash gating (`nscollectors_sync_hash`) so unchanged sheets cost 0 writes.
 */
export async function syncWorkerNsCollectors(env: Env): Promise<{
  checked: boolean;
  hashMatch: boolean;
  addedCanonical: number;
  matchedGames: number;
  ingestedGames: number;
  linkedReleases: number;
  upgradedReleases: number;
  cancelledCanonical: number;
}> {
  const fetchedTabs = await Promise.all(
    NSCOLLECTORS_TABS.map(async (tab) => {
      try {
        const res = await fetch(
          getNsCollectorsCsvUrl(tab.spreadsheetId, tab.gid),
          {
            headers: {
              'User-Agent': 'CollectionTracker/2.0 (NsCollectorsSync)',
              Accept: 'text/csv',
            },
            signal: AbortSignal.timeout(15000),
          },
        );
        if (!res.ok) return { tab, csv: '' };
        return { tab, csv: await res.text() };
      } catch {
        return { tab, csv: '' };
      }
    }),
  );

  const nonEmptyTabs = fetchedTabs.filter((t) => t.csv.trim().length > 0);
  if (nonEmptyTabs.length === 0) {
    return {
      checked: false,
      hashMatch: false,
      addedCanonical: 0,
      matchedGames: 0,
      ingestedGames: 0,
      linkedReleases: 0,
      upgradedReleases: 0,
      cancelledCanonical: 0,
    };
  }

  const combinedPayload =
    'v1||' + nonEmptyTabs.map((t) => `${t.tab.id}:${t.csv}`).join('||');
  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(combinedPayload),
  );
  const currentHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  try {
    const lastHash = await env.DB.prepare(
      "SELECT value FROM sync_state WHERE key = 'nscollectors_sync_hash'",
    ).first<{ value: string }>();
    if (lastHash?.value === currentHash) {
      return {
        checked: true,
        hashMatch: true,
        addedCanonical: 0,
        matchedGames: 0,
        ingestedGames: 0,
        linkedReleases: 0,
        upgradedReleases: 0,
        cancelledCanonical: 0,
      };
    }
  } catch {
    // Proceed cleanly in minimal schemas
  }

  const entries = parseNsCollectorsCsv(nonEmptyTabs);
  const existingCanonical = await env.DB.prepare(
    `SELECT id, platform_id, normalized_title, region, variants, source, is_verified_physical
     FROM canonical_releases
     WHERE platform_id IN (26, 27)`,
  ).all<{
    id: number;
    platform_id: number;
    normalized_title: string;
    region: string | null;
    variants: string | null;
    source: string;
    is_verified_physical: number;
  }>();

  const existingCanonicalRows = existingCanonical.results || [];
  const existingCanonicalSet = new Set<string>();
  const verifyUpcomingStmts: D1PreparedStatement[] = [];
  for (const row of existingCanonicalRows) {
    if (
      row.source === 'nscollectors' ||
      row.source === 'nscollectors_upcoming' ||
      row.source === 'nscollectors_ciab'
    ) {
      existingCanonicalSet.add(
        `${row.platform_id}::${row.normalized_title}::${row.region || 'World'}::${row.source}::${row.variants || ''}`,
      );
      if (
        row.source === 'nscollectors_upcoming' &&
        row.is_verified_physical !== 1
      ) {
        verifyUpcomingStmts.push(
          env.DB.prepare(
            `UPDATE canonical_releases SET is_verified_physical = 1 WHERE id = ?`,
          ).bind(row.id),
        );
      }
    }
  }

  const insertCanonicalStmts: D1PreparedStatement[] = [];
  for (const entry of entries) {
    const cr = entry.release;
    const key = `${cr.platform_id}::${cr.normalized_title}::${cr.region || 'World'}::${cr.source}::${cr.variants || ''}`;
    if (existingCanonicalSet.has(key)) continue;
    existingCanonicalSet.add(key);
    insertCanonicalStmts.push(
      env.DB.prepare(
        `INSERT INTO canonical_releases (platform_id, raw_title, normalized_title, region, variants, publisher, source, is_verified_physical)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        cr.platform_id,
        cr.raw_title,
        cr.normalized_title,
        cr.region,
        cr.variants ?? null,
        cr.publisher ?? null,
        cr.source,
        cr.is_verified_physical,
      ),
    );
  }

  for (let i = 0; i < verifyUpcomingStmts.length; i += 100) {
    await env.DB.batch(verifyUpcomingStmts.slice(i, i + 100));
  }
  for (let i = 0; i < insertCanonicalStmts.length; i += 100) {
    await env.DB.batch(insertCanonicalStmts.slice(i, i + 100));
  }

  // Safe, user-state-independent 2-miss cancellation pruning for nscollectors_upcoming
  const fetchedTabIds = new Set(nonEmptyTabs.map((t) => t.tab.id));
  const currentUpcomingByPlatNorm = new Map<
    string,
    Array<{ region: string | null }>
  >();
  const parsedUpcomingCountByPlat = new Map<number, number>([
    [26, 0],
    [27, 0],
  ]);
  const verifiedNonUpcomingByPlatNorm = new Map<
    string,
    Array<{ region: string | null }>
  >();

  for (const row of existingCanonicalRows) {
    if (
      row.source !== 'nscollectors_upcoming' &&
      (row.is_verified_physical === 1 || row.source === 'nscollectors')
    ) {
      const k = `${row.platform_id}::${row.normalized_title}`;
      const list = verifiedNonUpcomingByPlatNorm.get(k) || [];
      list.push({ region: row.region });
      verifiedNonUpcomingByPlatNorm.set(k, list);
    }
  }
  for (const entry of entries) {
    const cr = entry.release;
    const k = `${cr.platform_id}::${cr.normalized_title}`;
    if (cr.source === 'nscollectors_upcoming') {
      const list = currentUpcomingByPlatNorm.get(k) || [];
      list.push({ region: cr.region });
      currentUpcomingByPlatNorm.set(k, list);
      parsedUpcomingCountByPlat.set(
        cr.platform_id,
        (parsedUpcomingCountByPlat.get(cr.platform_id) || 0) + 1,
      );
    } else if (cr.source === 'nscollectors') {
      const list = verifiedNonUpcomingByPlatNorm.get(k) || [];
      list.push({ region: cr.region });
      verifiedNonUpcomingByPlatNorm.set(k, list);
    }
  }

  let missMap: Record<string, number> = {};
  let prevMissJson = '{}';
  try {
    const missRow = await env.DB.prepare(
      "SELECT value FROM sync_state WHERE key = 'nscollectors_upcoming_missing_v1'",
    ).first<{ value: string }>();
    if (missRow?.value) {
      const parsed = JSON.parse(missRow.value);
      if (parsed && typeof parsed === 'object') {
        missMap = parsed as Record<string, number>;
        prevMissJson = JSON.stringify(missMap);
      }
    }
  } catch {
    missMap = {};
  }

  const cancelledCanonicalIds: number[] = [];
  for (const pid of [26, 27] as const) {
    const upcomingTabId = pid === 26 ? 'sw1_upcoming' : 'sw2_upcoming';
    if (!fetchedTabIds.has(upcomingTabId)) continue;
    const dbUpcomingRows = existingCanonicalRows.filter(
      (r) => r.platform_id === pid && r.source === 'nscollectors_upcoming',
    );
    if (dbUpcomingRows.length === 0) continue;

    // Partition graduated upcoming rows out before evaluating the 50% sheet-truncation sanity denominator
    const activeDbUpcomingRows: typeof dbUpcomingRows = [];
    for (const row of dbUpcomingRows) {
      const platNormKey = `${row.platform_id}::${row.normalized_title}`;
      const graduated = (
        verifiedNonUpcomingByPlatNorm.get(platNormKey) || []
      ).some((v) => regionsOverlap(row.region, v.region));
      if (graduated) {
        delete missMap[String(row.id)];
      } else {
        activeDbUpcomingRows.push(row);
      }
    }

    if (activeDbUpcomingRows.length === 0) continue;
    const parsedCount = parsedUpcomingCountByPlat.get(pid) || 0;
    // Sanity gate: skip incrementing misses if upstream sheet looks truncated (< 50% of active upcoming rows)
    if (parsedCount < Math.ceil(activeDbUpcomingRows.length * 0.5)) continue;

    for (const row of activeDbUpcomingRows) {
      const idKey = String(row.id);
      const platNormKey = `${row.platform_id}::${row.normalized_title}`;
      const stillUpcoming = (
        currentUpcomingByPlatNorm.get(platNormKey) || []
      ).some((u) => regionsOverlap(row.region, u.region));

      if (stillUpcoming) {
        delete missMap[idKey];
      } else {
        const nextMisses = (Number(missMap[idKey]) || 0) + 1;
        if (nextMisses >= 2) {
          cancelledCanonicalIds.push(row.id);
          delete missMap[idKey];
        } else {
          missMap[idKey] = nextMisses;
        }
      }
    }
  }

  let cancelledCanonical = 0;
  let cancelledReleasesRemoved = 0;
  if (cancelledCanonicalIds.length > 0) {
    const affectedGameIds = new Set<number>();
    const deleteRelStmts: D1PreparedStatement[] = [];
    const deleteCanonStmts: D1PreparedStatement[] = [];
    for (const canonId of cancelledCanonicalIds) {
      const relGames = await env.DB.prepare(
        `SELECT DISTINCT game_id FROM game_releases WHERE canonical_release_id = ?`,
      )
        .bind(canonId)
        .all<{ game_id: number }>();
      for (const rg of relGames.results || []) {
        affectedGameIds.add(rg.game_id);
        cancelledReleasesRemoved++;
      }
      deleteRelStmts.push(
        env.DB.prepare(
          `DELETE FROM game_releases WHERE canonical_release_id = ?`,
        ).bind(canonId),
      );
      deleteCanonStmts.push(
        env.DB.prepare(`DELETE FROM canonical_releases WHERE id = ?`).bind(
          canonId,
        ),
      );
    }
    for (let i = 0; i < deleteRelStmts.length; i += 100) {
      await env.DB.batch(deleteRelStmts.slice(i, i + 100));
    }
    const deleteGameStmts: D1PreparedStatement[] = [];
    for (const gid of affectedGameIds) {
      const remaining = await env.DB.prepare(
        `SELECT 1 AS ok FROM game_releases WHERE game_id = ? LIMIT 1`,
      )
        .bind(gid)
        .first<{ ok: number }>();
      if (!remaining) {
        deleteGameStmts.push(
          env.DB.prepare(`DELETE FROM games WHERE stable_id = ?`).bind(gid),
        );
      }
    }
    for (let i = 0; i < deleteGameStmts.length; i += 100) {
      await env.DB.batch(deleteGameStmts.slice(i, i + 100));
    }
    for (let i = 0; i < deleteCanonStmts.length; i += 100) {
      await env.DB.batch(deleteCanonStmts.slice(i, i + 100));
    }
    cancelledCanonical = cancelledCanonicalIds.length;
  }

  const nextMissJson = JSON.stringify(missMap);
  if (nextMissJson !== prevMissJson) {
    try {
      await env.DB.prepare(
        `INSERT INTO sync_state (key, value, updated_at) VALUES ('nscollectors_upcoming_missing_v1', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      )
        .bind(nextMissJson)
        .run();
    } catch {
      // Ignore in minimal schemas
    }
  }

  const canonicalIdRows = await env.DB.prepare(
    `SELECT id, platform_id, normalized_title, region, source, variants
     FROM canonical_releases
     WHERE platform_id IN (26, 27)
       AND source IN ('nscollectors', 'nscollectors_upcoming')`,
  ).all<{
    id: number;
    platform_id: number;
    normalized_title: string;
    region: string | null;
    source: string;
    variants: string | null;
  }>();
  const canonicalIdMap = new Map<string, number>();
  for (const row of canonicalIdRows.results || []) {
    canonicalIdMap.set(
      `${row.platform_id}::${row.normalized_title}::${row.region || 'World'}::${row.source}::${row.variants || ''}`,
      row.id,
    );
  }

  const gamesRes = await env.DB.prepare(
    'SELECT stable_id, id, title, platform_id, igdb_id FROM games WHERE platform_id IN (26, 27)',
  ).all<{
    stable_id: number;
    id: string;
    title: string;
    platform_id: number;
    igdb_id?: number | null;
  }>();

  const existingRelsRes = await env.DB.prepare(
    `SELECT r.id, r.game_id, r.region, r.variants, r.canonical_release_id, r.verified_source
     FROM game_releases r
     JOIN games g ON g.stable_id = r.game_id
     WHERE g.platform_id IN (26, 27)`,
  ).all<{
    id: string;
    game_id: number;
    region: string | null;
    variants: string | null;
    canonical_release_id: number | null;
    verified_source: string | null;
  }>();

  const existingRelsByGame = new Map<
    number,
    Array<{
      id: string;
      game_id: number;
      region: string | null;
      variants: string | null;
      canonical_release_id: number | null;
      verified_source: string | null;
    }>
  >();
  for (const rel of existingRelsRes.results || []) {
    const arr = existingRelsByGame.get(rel.game_id) || [];
    arr.push(rel);
    existingRelsByGame.set(rel.game_id, arr);
  }

  const existingGameByPlatformNorm = new Map<string, number>();
  const existingIgdbByPlatform = new Set<string>();
  for (const g of gamesRes.results || []) {
    if (g.igdb_id && Number(g.igdb_id) > 0) {
      existingIgdbByPlatform.add(`${g.platform_id}::${g.igdb_id}`);
    }
    const norm = normalizeTitleForMatching(g.title);
    if (norm && !existingGameByPlatformNorm.has(`${g.platform_id}::${norm}`)) {
      existingGameByPlatformNorm.set(`${g.platform_id}::${norm}`, g.stable_id);
    }
    const strippedNorm = normalizeTitleForMatching(stripEditionSuffix(g.title));
    if (
      strippedNorm &&
      !existingGameByPlatformNorm.has(`${g.platform_id}::${strippedNorm}`)
    ) {
      existingGameByPlatformNorm.set(
        `${g.platform_id}::${strippedNorm}`,
        g.stable_id,
      );
    }
  }

  let matchedGames = 0;
  let linkedReleases = 0;
  let upgradedReleases = 0;
  const matchedDatesToFill = new Map<number, string>();
  const linkOrUpgradeStmts: D1PreparedStatement[] = [];
  const pendingIngest = new Map<string, (typeof entries)[0]>();
  const NSCOLLECTORS_AUTO_INGEST_CAP = 20;

  for (const entry of entries) {
    const cr = entry.release;
    const strippedNorm = normalizeTitleForMatching(
      stripEditionSuffix(cr.raw_title),
    );
    const existingStableId =
      existingGameByPlatformNorm.get(
        `${cr.platform_id}::${cr.normalized_title}`,
      ) ??
      (strippedNorm
        ? existingGameByPlatformNorm.get(`${cr.platform_id}::${strippedNorm}`)
        : undefined);
    if (existingStableId !== undefined) {
      matchedGames++;
      if (entry.releaseDate && !matchedDatesToFill.has(existingStableId)) {
        matchedDatesToFill.set(existingStableId, entry.releaseDate);
      }
      if (cr.source !== 'nscollectors_ciab') {
        const canonId = canonicalIdMap.get(
          `${cr.platform_id}::${cr.normalized_title}::${cr.region || 'World'}::${cr.source}::${cr.variants || ''}`,
        );
        if (canonId != null) {
          const rels = existingRelsByGame.get(existingStableId) || [];
          const unlinked = rels.find(
            (r) =>
              r.canonical_release_id == null &&
              regionsOverlap(r.region, cr.region || 'USA'),
          );
          if (unlinked) {
            unlinked.canonical_release_id = canonId;
            unlinked.verified_source = cr.source;
            linkedReleases++;
            linkOrUpgradeStmts.push(
              env.DB.prepare(
                `UPDATE game_releases
                 SET canonical_release_id = ?,
                     verified_source = ?,
                     serial_code = COALESCE(serial_code, ?),
                     canonical_title = COALESCE(canonical_title, ?),
                     publisher = COALESCE(publisher, ?),
                     variants = COALESCE(variants, ?),
                     release_date = COALESCE(release_date, ?)
                 WHERE id = ?`,
              ).bind(
                canonId,
                cr.source,
                cr.serial_code ?? null,
                cr.raw_title ?? null,
                cr.publisher ?? null,
                cr.variants ?? null,
                entry.releaseDate ?? null,
                unlinked.id,
              ),
            );
          } else if (cr.source === 'nscollectors') {
            const upcomingRel = rels.find(
              (r) =>
                r.verified_source === 'nscollectors_upcoming' &&
                r.canonical_release_id !== canonId &&
                regionsOverlap(r.region, cr.region || 'USA'),
            );
            if (upcomingRel) {
              upcomingRel.canonical_release_id = canonId;
              upcomingRel.verified_source = 'nscollectors';
              upgradedReleases++;
              linkOrUpgradeStmts.push(
                env.DB.prepare(
                  `UPDATE game_releases
                   SET canonical_release_id = ?,
                       verified_source = 'nscollectors',
                       serial_code = COALESCE(serial_code, ?),
                       canonical_title = COALESCE(canonical_title, ?),
                       publisher = COALESCE(publisher, ?),
                       variants = COALESCE(?, variants),
                       release_date = COALESCE(?, release_date)
                   WHERE id = ?`,
                ).bind(
                  canonId,
                  cr.serial_code ?? null,
                  cr.raw_title ?? null,
                  cr.publisher ?? null,
                  cr.variants ?? null,
                  entry.releaseDate ?? null,
                  upcomingRel.id,
                ),
              );
            }
          }
        }
      }
      continue;
    }

    if (cr.source === 'nscollectors_ciab') continue;
    const ingestCanonId = canonicalIdMap.get(
      `${cr.platform_id}::${cr.normalized_title}::${cr.region || 'World'}::${cr.source}::${cr.variants || ''}`,
    );
    if (ingestCanonId == null) continue;
    const ingestKey = `${cr.platform_id}::${cr.normalized_title}`;
    if (
      !pendingIngest.has(ingestKey) &&
      pendingIngest.size < NSCOLLECTORS_AUTO_INGEST_CAP
    ) {
      pendingIngest.set(ingestKey, entry);
    }
  }

  for (let i = 0; i < linkOrUpgradeStmts.length; i += 100) {
    await env.DB.batch(linkOrUpgradeStmts.slice(i, i + 100));
  }

  const releaseDateStmts: D1PreparedStatement[] = [];
  for (const [stableId, relDate] of matchedDatesToFill.entries()) {
    releaseDateStmts.push(
      env.DB.prepare(
        `UPDATE game_releases SET release_date = ? WHERE game_id = ? AND release_date IS NULL`,
      ).bind(relDate, stableId),
    );
  }
  for (let i = 0; i < releaseDateStmts.length; i += 100) {
    await env.DB.batch(releaseDateStmts.slice(i, i + 100));
  }

  let ingestedGames = 0;
  if (pendingIngest.size > 0) {
    let isColdStartSeed: boolean;
    try {
      const seedRow = await env.DB.prepare(
        "SELECT value FROM sync_state WHERE key = 'nscollectors_seed_completed'",
      ).first<{ value: string }>();
      isColdStartSeed = seedRow?.value !== '1';
    } catch {
      isColdStartSeed = true;
    }

    const { byId: platformById } = await loadPlatformLookupMaps(env);
    const igdbLookupItems = Array.from(pendingIngest.entries())
      .map(([key, entry]) => ({
        key,
        title: entry.release.raw_title,
        normalizedTitle: entry.release.normalized_title,
        igdbPlatformId:
          platformById.get(entry.release.platform_id)?.igdbId ?? null,
      }))
      .filter((i) => i.igdbPlatformId && i.igdbPlatformId > 0);
    const igdbMetaMap =
      igdbLookupItems.length > 0
        ? await fetchIgdbMetadataForTitles(env, igdbLookupItems)
        : new Map<string, IgdbGameMeta>();

    const usedSlugs = new Set<string>();
    const ingestedForRules: Array<{
      stableId: number;
      platformId: number;
      canonicalSeries?: string | null;
      seriesTrackable?: boolean;
      title?: string;
      platformName?: string | null;
      gameSlug?: string;
      releases: Array<{ id: string; region: string | null }>;
    }> = [];

    for (const [key, entry] of pendingIngest.entries()) {
      const cr = entry.release;
      const igdbMeta = igdbMetaMap.get(key) ?? null;
      if (
        igdbMeta?.igdb_id &&
        existingIgdbByPlatform.has(`${cr.platform_id}::${igdbMeta.igdb_id}`)
      ) {
        continue;
      }
      const platInfo = platformById.get(cr.platform_id);
      const canonicalTitle = resolveCanonicalDisplayTitle(
        cr.raw_title,
        igdbMeta?.name,
      );
      const canonicalSeries = computeGameCanonicalSeries({
        title: canonicalTitle,
        collections: igdbMeta?.collections ?? undefined,
        franchises: igdbMeta?.franchises ?? undefined,
      });
      const canonicalId =
        canonicalIdMap.get(
          `${cr.platform_id}::${cr.normalized_title}::${cr.region || 'World'}::${cr.source}::${cr.variants || ''}`,
        ) ?? null;
      if (canonicalId == null) continue;

      const inserted = await insertCatalogGameWithReleases(env, {
        title: canonicalTitle,
        platformId: cr.platform_id,
        platformSlugHint: platInfo?.displayName || platInfo?.name,
        region: cr.region || 'USA',
        canonicalSeries,
        igdbMeta,
        usedSlugs,
        releases: [
          {
            slugSuffix: (cr.region || 'usa').toLowerCase(),
            region: cr.region || 'USA',
            variants: cr.variants || null,
            releaseDate: entry.releaseDate ?? null,
            canonicalReleaseId: canonicalId,
            verifiedSource: cr.source ?? null,
            serialCode: cr.serial_code ?? null,
            canonicalTitle: cr.raw_title ?? null,
            publisher: cr.publisher ?? null,
          },
        ],
      });
      if (!inserted) continue;

      if (igdbMeta?.igdb_id) {
        existingIgdbByPlatform.add(`${cr.platform_id}::${igdbMeta.igdb_id}`);
      }

      ingestedGames++;
      ingestedForRules.push({
        stableId: inserted.stableId,
        platformId: cr.platform_id,
        canonicalSeries,
        seriesTrackable: isSeriesTrackable({
          title: canonicalTitle,
          collections: igdbMeta?.collections,
          franchises: igdbMeta?.franchises,
        }),
        title: canonicalTitle,
        platformName: platInfo?.displayName || platInfo?.name || null,
        gameSlug: String(inserted.stableId),
        releases: inserted.insertedReleases,
      });
    }

    if (ingestedForRules.length > 0) {
      await evaluateTrackingRulesForNewGames(env, ingestedForRules, {
        notifySubscribers: !isColdStartSeed,
      });
      invalidateSeriesScanCache();
      await invalidateCatalogManifest(env);
      await markDbDirty(env);
    }

    if (isColdStartSeed) {
      try {
        await env.DB.prepare(
          `INSERT INTO sync_state (key, value, updated_at)
           VALUES ('nscollectors_seed_completed', '1', CURRENT_TIMESTAMP)
           ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = CURRENT_TIMESTAMP`,
        ).run();
      } catch {
        // Ignore in minimal schemas
      }
    }
  }

  if (
    insertCanonicalStmts.length > 0 ||
    verifyUpcomingStmts.length > 0 ||
    cancelledCanonical > 0
  ) {
    await markCanonicalReleasesDirty(env);
  }
  if (
    insertCanonicalStmts.length > 0 ||
    ingestedGames > 0 ||
    releaseDateStmts.length > 0 ||
    linkOrUpgradeStmts.length > 0 ||
    cancelledReleasesRemoved > 0
  ) {
    await markCatalogChunksDirty(env);
  }
  if (cancelledCanonical > 0 && ingestedGames === 0) {
    invalidateSeriesScanCache();
    await invalidateCatalogManifest(env);
    await markDbDirty(env);
  }
  await env.DB.prepare(
    `INSERT INTO sync_state (key, value, updated_at) VALUES ('nscollectors_sync_hash', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  )
    .bind(currentHash)
    .run();

  return {
    checked: true,
    hashMatch: false,
    addedCanonical: insertCanonicalStmts.length,
    matchedGames,
    ingestedGames,
    linkedReleases,
    upgradedReleases,
    cancelledCanonical,
  };
}

/**
 * In-Worker streaming Redump DAT synchronization (`redump.info`).
 * Uses HEAD (ETag / Last-Modified) and WebCrypto SHA-256 gating so unchanged
 * DAT archives incur zero D1 canonical writes, and merges changed entries via
 * the shared 4-tier hierarchy and unlinked `game_releases` linker.
 */
export async function syncWorkerDats(
  env: Env,
  options?: {
    force?: boolean;
    mode?: 'active' | 'retro' | 'all';
    targetSlugs?: string[];
    maxWriteBudget?: number;
  },
): Promise<{
  skipped: boolean;
  reason?: string;
  targetsChecked: number;
  targetsUpdated: number;
  addedCanonical: number;
  upgradedCanonical: number;
  enrichedCanonical: number;
  linkedReleases: number;
  writesUsed: number;
  retroCursor: number;
  results: Array<{
    slug: string;
    platformId: number;
    status: 'updated' | 'unchanged' | 'error' | 'budget_capped';
    entriesParsed?: number;
    error?: string;
  }>;
}> {
  const tier = await resolveWorkerPlanTier(env);
  if (tier === 'free' && !options?.force) {
    return {
      skipped: true,
      reason: 'free_tier_mode',
      targetsChecked: 0,
      targetsUpdated: 0,
      addedCanonical: 0,
      upgradedCanonical: 0,
      enrichedCanonical: 0,
      linkedReleases: 0,
      writesUsed: 0,
      retroCursor: 0,
      results: [],
    };
  }

  const allTargets = [...REDUMP_WIP_TARGETS, ...REDUMP_TARGETS];
  let retroCursor = 0;
  try {
    const cursorRow = await env.DB.prepare(
      'SELECT value FROM sync_state WHERE key = ?',
    )
      .bind(WORKER_DAT_RETRO_CURSOR_KEY)
      .first<{ value: string }>();
    const parsed = parseInt(cursorRow?.value || '0', 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      retroCursor = parsed;
    }
  } catch {
    // Ignore missing sync_state key in minimal schemas
  }

  let selectedTargets = REDUMP_WIP_TARGETS as Array<{
    platformId: number;
    name: string;
    slug: string;
    redumpInfoSlug: string;
    canonicalFileName?: string;
  }>;
  if (options?.targetSlugs && options.targetSlugs.length > 0) {
    const wanted = new Set(options.targetSlugs.map((s) => s.toLowerCase()));
    selectedTargets = allTargets.filter((t) =>
      wanted.has(t.slug.toLowerCase()),
    );
  } else if (options?.mode === 'retro') {
    if (REDUMP_TARGETS.length > 0) {
      const idx = retroCursor % REDUMP_TARGETS.length;
      selectedTargets = [REDUMP_TARGETS[idx]];
      retroCursor = (idx + 1) % REDUMP_TARGETS.length;
    } else {
      selectedTargets = [];
    }
  } else if (options?.mode === 'all') {
    selectedTargets = allTargets;
  }

  const maxBudget = options?.maxWriteBudget ?? 40_000;
  let totalWritesUsed = 0;
  let addedCanonical = 0;
  let upgradedCanonical = 0;
  let enrichedCanonical = 0;
  let linkedReleases = 0;
  let linkedCanonicalMutated = false;
  let targetsUpdated = 0;
  const results: Array<{
    slug: string;
    platformId: number;
    status: 'updated' | 'unchanged' | 'error' | 'budget_capped';
    entriesParsed?: number;
    error?: string;
  }> = [];

  for (const target of selectedTargets) {
    if (totalWritesUsed >= maxBudget) {
      results.push({
        slug: target.slug,
        platformId: target.platformId,
        status: 'budget_capped',
      });
      continue;
    }

    const metaKey = `${WORKER_DAT_SYNC_META_PREFIX}${target.slug}`;
    let prevMeta: {
      etag?: string | null;
      lastModified?: string | null;
      sha256?: string | null;
    } = {};
    try {
      const metaRow = await env.DB.prepare(
        'SELECT value FROM sync_state WHERE key = ?',
      )
        .bind(metaKey)
        .first<{ value: string }>();
      if (metaRow?.value) {
        prevMeta = JSON.parse(metaRow.value) as typeof prevMeta;
      }
    } catch {
      // Ignore malformed/missing DAT metadata
    }

    const datUrl = getRedumpInfoDatUrl(target.redumpInfoSlug);
    const reqHeaders: Record<string, string> = {
      'User-Agent': 'CollectionTracker/2.0 (DatSync)',
      Accept: 'application/zip,application/xml,text/xml,text/plain,*/*',
    };

    try {
      let headEtag: string | null = null;
      let headLastMod: string | null = null;
      if (!options?.force && (prevMeta.etag || prevMeta.lastModified)) {
        try {
          const headRes = await fetch(datUrl, {
            method: 'HEAD',
            headers: reqHeaders,
            signal: AbortSignal.timeout(8000),
          });
          if (headRes.ok) {
            headEtag = headRes.headers.get('etag');
            headLastMod = headRes.headers.get('last-modified');
            const etagMatched = Boolean(
              headEtag && prevMeta.etag && headEtag === prevMeta.etag,
            );
            const lastModMatched = Boolean(
              headLastMod &&
              prevMeta.lastModified &&
              headLastMod === prevMeta.lastModified,
            );
            if (etagMatched || (!headEtag && lastModMatched)) {
              results.push({
                slug: target.slug,
                platformId: target.platformId,
                status: 'unchanged',
              });
              continue;
            }
          }
        } catch {
          // Proceed to GET if HEAD is unsupported or times out
        }
      }

      const res = await fetch(datUrl, {
        headers: reqHeaders,
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        results.push({
          slug: target.slug,
          platformId: target.platformId,
          status: 'error',
          error: `HTTP ${res.status}`,
        });
        continue;
      }

      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength === 0) {
        results.push({
          slug: target.slug,
          platformId: target.platformId,
          status: 'error',
          error: 'Empty DAT response',
        });
        continue;
      }

      const hashBuf = await crypto.subtle.digest('SHA-256', bytes);
      const sha256 = Array.from(new Uint8Array(hashBuf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      if (!options?.force && prevMeta.sha256 && prevMeta.sha256 === sha256) {
        results.push({
          slug: target.slug,
          platformId: target.platformId,
          status: 'unchanged',
        });
        continue;
      }

      let datText: string;
      if (isZipBuffer(bytes)) {
        const extracted = await extractFirstMatchingZipEntry(
          bytes,
          (fileName) =>
            !fileName.endsWith('/') &&
            (/\.(dat|xml)$/i.test(fileName) || !fileName.includes('.')),
        );
        datText = extracted.text();
      } else {
        datText = new TextDecoder('utf-8').decode(bytes);
      }

      const parsed = parseDatContent(
        datText,
        target.canonicalFileName || target.name,
      );
      const deduped = deduplicateDatReleases(
        target.platformId,
        parsed.releases,
      );
      const canonicalRows: CanonicalRelease[] = deduped.map((d) => ({
        platform_id: d.platform_id,
        raw_title: d.raw_title,
        normalized_title: d.normalized_title,
        region: d.region,
        variants: d.variants,
        also_released_as: d.also_released_as,
        packin_host_normalized_title: d.packin_host_normalized_title,
        rom_name: d.rom_name,
        rom_crc: d.rom_crc,
        serial_code: d.serial_code,
        publisher: d.publisher,
        source: 'dat',
        is_verified_physical: 1,
      }));

      const existingRes = await env.DB.prepare(
        `SELECT id, platform_id, raw_title, normalized_title, region, variants,
                serial_code, barcode, publisher, source, is_verified_physical
         FROM canonical_releases
         WHERE platform_id = ? AND is_verified_physical = 1`,
      )
        .bind(target.platformId)
        .all<WorkerCanonicalMergeRow>();

      const mergeRes = await applyWorkerCanonicalHierarchyMerge(
        env,
        canonicalRows,
        existingRes.results || [],
        {
          touchedPlatforms: [target.platformId],
          maxWriteBudget: Math.max(0, maxBudget - totalWritesUsed),
          loadPostInsertRows: async (plats, normKeys) => {
            const out: WorkerCanonicalMergeRow[] = [];
            const platPh = plats.map(() => '?').join(',');
            for (let i = 0; i < normKeys.length; i += 40) {
              const chunk = normKeys.slice(i, i + 40);
              const keyPh = chunk.map(() => '?').join(',');
              const r = await env.DB.prepare(
                `SELECT id, platform_id, raw_title, normalized_title, region, variants,
                        serial_code, barcode, publisher, source, is_verified_physical
                 FROM canonical_releases
                 WHERE platform_id IN (${platPh}) AND normalized_title IN (${keyPh}) AND is_verified_physical = 1`,
              )
                .bind(...plats, ...chunk)
                .all<WorkerCanonicalMergeRow>();
              out.push(...(r.results || []));
            }
            return out;
          },
        },
      );

      totalWritesUsed += mergeRes.writesUsed;
      addedCanonical += mergeRes.addedCanonical;
      upgradedCanonical += mergeRes.upgradedCanonical;
      enrichedCanonical += mergeRes.enrichedCanonical;
      linkedReleases += mergeRes.linkedReleases;
      if (mergeRes.linkedCanonicalMutated) {
        linkedCanonicalMutated = true;
      }

      const nextEtag = res.headers.get('etag') || headEtag;
      const nextLastMod = res.headers.get('last-modified') || headLastMod;
      await env.DB.prepare(
        `INSERT INTO sync_state (key, value, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      )
        .bind(
          metaKey,
          JSON.stringify({
            etag: nextEtag,
            lastModified: nextLastMod,
            sha256,
            releaseCount: canonicalRows.length,
            updatedAt: new Date().toISOString(),
          }),
        )
        .run();

      targetsUpdated++;
      results.push({
        slug: target.slug,
        platformId: target.platformId,
        status: 'updated',
        entriesParsed: canonicalRows.length,
      });
    } catch (err) {
      results.push({
        slug: target.slug,
        platformId: target.platformId,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (addedCanonical > 0 || upgradedCanonical > 0 || enrichedCanonical > 0) {
    await markCanonicalReleasesDirty(env);
  }
  if (linkedReleases > 0 || linkedCanonicalMutated) {
    await markCatalogChunksDirty(env);
  }

  const nowIso = new Date().toISOString();
  try {
    if (options?.mode === 'retro') {
      await env.DB.prepare(
        `INSERT INTO sync_state (key, value, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      )
        .bind(WORKER_DAT_RETRO_CURSOR_KEY, String(retroCursor))
        .run();
    }
    await env.DB.prepare(
      `INSERT INTO sync_state (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
      .bind(
        WORKER_DAT_SYNC_STATS_KEY,
        JSON.stringify({
          lastRunAt: nowIso,
          lastTargetsChecked: selectedTargets.length,
          lastChangedCount: targetsUpdated,
          retroCursor,
          addedCanonical,
          linkedReleases,
          writesUsed: totalWritesUsed,
        }),
      )
      .run();
  } catch {
    // Ignore sync_state persistence failures in minimal schemas
  }

  return {
    skipped: false,
    targetsChecked: selectedTargets.length,
    targetsUpdated,
    addedCanonical,
    upgradedCanonical,
    enrichedCanonical,
    linkedReleases,
    writesUsed: totalWritesUsed,
    retroCursor,
    results,
  };
}

interface WorkerCanonicalMergeRow {
  id: number;
  platform_id: number;
  raw_title: string;
  normalized_title: string;
  region: string | null;
  variants: string | null;
  serial_code: string | null;
  barcode: string | null;
  publisher: string | null;
  source: string;
  is_verified_physical: number;
}

/**
 * Shared hierarchy-aware canonical merge and sequel-guarded unlinked `game_releases`
 * linker for online Worker verification crons (`syncWorkerPs5Db`, `syncWorkerSerialStation`).
 */
async function applyWorkerCanonicalHierarchyMerge(
  env: Env,
  incoming: CanonicalRelease[],
  initialExisting: WorkerCanonicalMergeRow[],
  options: {
    touchedPlatforms: number[];
    maxWriteBudget: number;
    loadPostInsertRows: (
      platIds: number[],
      normKeys: string[],
    ) => Promise<WorkerCanonicalMergeRow[]>;
  },
): Promise<{
  addedCanonical: number;
  upgradedCanonical: number;
  enrichedCanonical: number;
  linkedReleases: number;
  linkedCanonicalMutated: boolean;
  writesUsed: number;
}> {
  const byPlatKey = new Map<string, WorkerCanonicalMergeRow[]>();
  const rowsById = new Map<number, WorkerCanonicalMergeRow>();
  const indexRow = (row: WorkerCanonicalMergeRow) => {
    if (row.id > 0) {
      rowsById.set(row.id, row);
    }
    const keys = new Set<string>([
      row.normalized_title,
      ...buildCanonicalLinkerMatchKeys(row.raw_title),
    ]);
    for (const k of keys) {
      if (!k) continue;
      const mapKey = `${row.platform_id}::${k}`;
      const list = byPlatKey.get(mapKey) || [];
      if (!list.includes(row)) {
        list.push(row);
        byPlatKey.set(mapKey, list);
      }
    }
  };

  for (const ex of initialExisting) {
    indexRow(ex);
  }

  let writesUsed = 0;
  let addedCanonical = 0;
  let upgradedCanonical = 0;
  let enrichedCanonical = 0;
  const canonicalStmts: D1PreparedStatement[] = [];
  const mutatedExistingIds = new Set<number>();
  const enrichedGuard = new Set<string>();
  const seenIncomingExact = new Set<string>();
  const newlyInsertedNormKeys = new Set<string>();

  for (const rel of incoming) {
    if (writesUsed + 5 > options.maxWriteBudget) break;
    const regionVal = rel.region || null;
    const variantsVal = rel.variants || null;
    const serialVal = rel.serial_code || null;
    const barcodeVal = rel.barcode || null;
    const publisherVal = rel.publisher || null;
    const verifiedVal = rel.is_verified_physical ?? 1;
    const exactSig = `${rel.platform_id}::${rel.source}::${rel.normalized_title}::${regionVal || ''}::${variantsVal || ''}::${serialVal || ''}`;
    if (seenIncomingExact.has(exactSig)) continue;
    seenIncomingExact.add(exactSig);

    const relKeys = new Set<string>([
      rel.normalized_title,
      ...buildCanonicalLinkerMatchKeys(rel.raw_title),
    ]);
    const seenCand = new Set<WorkerCanonicalMergeRow>();
    const candidates: WorkerCanonicalMergeRow[] = [];
    for (const k of relKeys) {
      for (const c of byPlatKey.get(`${rel.platform_id}::${k}`) || []) {
        if (seenCand.has(c)) continue;
        seenCand.add(c);
        if ((c.variants || null) !== variantsVal) continue;
        if (!areCanonicalTitlesSequelCompatible(c.raw_title, rel.raw_title)) {
          continue;
        }
        if (!regionsOverlap(c.region, regionVal)) continue;
        candidates.push(c);
      }
    }

    const sameSourceExact = candidates.find(
      (c) =>
        c.source === rel.source &&
        c.normalized_title === rel.normalized_title &&
        (c.region || null) === regionVal &&
        (c.serial_code || null) === serialVal,
    );
    const sameSourceLoose =
      sameSourceExact ||
      candidates.find(
        (c) =>
          c.source === rel.source &&
          c.normalized_title === rel.normalized_title &&
          (c.region || null) === regionVal,
      );

    if (sameSourceLoose) {
      const hasDiff =
        sameSourceLoose.raw_title !== rel.raw_title ||
        sameSourceLoose.normalized_title !== rel.normalized_title ||
        sameSourceLoose.region !== regionVal ||
        sameSourceLoose.variants !== variantsVal ||
        sameSourceLoose.serial_code !== serialVal ||
        sameSourceLoose.barcode !== barcodeVal ||
        sameSourceLoose.publisher !== publisherVal ||
        sameSourceLoose.is_verified_physical !== verifiedVal;

      if (!hasDiff) continue;
      if (sameSourceLoose.id > 0) {
        canonicalStmts.push(
          env.DB.prepare(
            `UPDATE canonical_releases
             SET raw_title = ?, normalized_title = ?, region = ?, variants = ?,
                 serial_code = COALESCE(?, serial_code),
                 barcode = COALESCE(?, barcode),
                 publisher = COALESCE(?, publisher),
                 is_verified_physical = ?
             WHERE id = ?`,
          ).bind(
            rel.raw_title,
            rel.normalized_title,
            regionVal,
            variantsVal,
            serialVal,
            barcodeVal,
            publisherVal,
            verifiedVal,
            sameSourceLoose.id,
          ),
        );
        mutatedExistingIds.add(sameSourceLoose.id);
        sameSourceLoose.raw_title = rel.raw_title;
        sameSourceLoose.normalized_title = rel.normalized_title;
        sameSourceLoose.region = regionVal;
        sameSourceLoose.variants = variantsVal;
        sameSourceLoose.serial_code = serialVal ?? sameSourceLoose.serial_code;
        sameSourceLoose.barcode = barcodeVal ?? sameSourceLoose.barcode;
        sameSourceLoose.publisher = publisherVal ?? sameSourceLoose.publisher;
        sameSourceLoose.is_verified_physical = verifiedVal;
        writesUsed += 5;
        enrichedCanonical++;
      }
      continue;
    }

    const higherRegionCoversLower = (
      higherRegion: string | null | undefined,
      lowerRegion: string | null | undefined,
    ): boolean => {
      if (!regionsOverlap(higherRegion, lowerRegion)) return false;
      const lowerTrim = (lowerRegion || '').trim().toLowerCase();
      const higherTrim = (higherRegion || '').trim().toLowerCase();
      const lowerIsWorld = !lowerTrim || lowerTrim === 'world';
      const higherIsWorld = !higherTrim || higherTrim === 'world';
      if (lowerIsWorld && !higherIsWorld) {
        return false;
      }
      return true;
    };

    const incomingPrio = getCanonicalSourcePriority(rel.source);
    const crossCandidates = candidates.filter((c) => {
      if (c.source === rel.source) return true;
      const existingPrio = getCanonicalSourcePriority(c.source);
      if (existingPrio <= incomingPrio) {
        return higherRegionCoversLower(c.region, regionVal);
      }
      return higherRegionCoversLower(regionVal, c.region);
    });

    crossCandidates.sort((a, b) => {
      const prioDiff =
        getCanonicalSourcePriority(a.source) -
        getCanonicalSourcePriority(b.source);
      if (prioDiff !== 0) return prioDiff;
      return (a.id || 0) - (b.id || 0);
    });

    const bestExisting = crossCandidates[0];
    if (bestExisting) {
      const existingPrio = getCanonicalSourcePriority(bestExisting.source);
      if (existingPrio <= incomingPrio) {
        const addSerial =
          !bestExisting.serial_code && serialVal ? serialVal : null;
        const addBarcode =
          !bestExisting.barcode && barcodeVal ? barcodeVal : null;
        const addPublisher =
          !bestExisting.publisher && publisherVal ? publisherVal : null;
        if (!addSerial && !addBarcode && !addPublisher) continue;

        const guardKey = `${bestExisting.id}::${addSerial || ''}::${addBarcode || ''}::${addPublisher || ''}`;
        if (enrichedGuard.has(guardKey)) continue;
        enrichedGuard.add(guardKey);

        if (bestExisting.id > 0) {
          canonicalStmts.push(
            env.DB.prepare(
              `UPDATE canonical_releases
               SET serial_code = COALESCE(serial_code, ?),
                   barcode = COALESCE(barcode, ?),
                   publisher = COALESCE(publisher, ?)
               WHERE id = ?`,
            ).bind(addSerial, addBarcode, addPublisher, bestExisting.id),
          );
          mutatedExistingIds.add(bestExisting.id);
          writesUsed += 5;
          enrichedCanonical++;
        }
        if (addSerial) bestExisting.serial_code = addSerial;
        if (addBarcode) bestExisting.barcode = addBarcode;
        if (addPublisher) bestExisting.publisher = addPublisher;
      } else {
        const mergedSerial = serialVal || bestExisting.serial_code;
        const mergedBarcode = barcodeVal || bestExisting.barcode;
        const mergedPublisher = publisherVal || bestExisting.publisher;
        const mergedRegion = regionVal || bestExisting.region;
        const mergedVariants = variantsVal || bestExisting.variants;

        if (bestExisting.id > 0) {
          canonicalStmts.push(
            env.DB.prepare(
              `UPDATE canonical_releases
               SET source = ?, raw_title = ?, normalized_title = ?, region = ?, variants = ?,
                   serial_code = ?, barcode = ?, publisher = ?, is_verified_physical = ?
               WHERE id = ?`,
            ).bind(
              rel.source,
              rel.raw_title,
              rel.normalized_title,
              mergedRegion,
              mergedVariants,
              mergedSerial,
              mergedBarcode,
              mergedPublisher,
              verifiedVal,
              bestExisting.id,
            ),
          );
          mutatedExistingIds.add(bestExisting.id);
          writesUsed += 5;
          upgradedCanonical++;
        }
        bestExisting.source = rel.source;
        bestExisting.raw_title = rel.raw_title;
        bestExisting.normalized_title = rel.normalized_title;
        bestExisting.region = mergedRegion;
        bestExisting.variants = mergedVariants;
        bestExisting.serial_code = mergedSerial;
        bestExisting.barcode = mergedBarcode;
        bestExisting.publisher = mergedPublisher;
        bestExisting.is_verified_physical = verifiedVal;
        indexRow(bestExisting);
      }
      continue;
    }

    canonicalStmts.push(
      env.DB.prepare(
        `INSERT INTO canonical_releases (
           platform_id, raw_title, normalized_title, region, variants,
           serial_code, barcode, publisher, source, is_verified_physical
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        rel.platform_id,
        rel.raw_title,
        rel.normalized_title,
        regionVal,
        variantsVal,
        serialVal,
        barcodeVal,
        publisherVal,
        rel.source,
        verifiedVal,
      ),
    );
    newlyInsertedNormKeys.add(rel.normalized_title);
    writesUsed += 5;
    addedCanonical++;
  }

  for (let i = 0; i < canonicalStmts.length; i += 100) {
    await env.DB.batch(canonicalStmts.slice(i, i + 100));
  }

  // Reload newly inserted rows with real DB IDs so unlinked game_releases can link directly
  if (newlyInsertedNormKeys.size > 0 && options.touchedPlatforms.length > 0) {
    const reloaded = await options.loadPostInsertRows(
      options.touchedPlatforms,
      Array.from(newlyInsertedNormKeys),
    );
    for (const r of reloaded) {
      indexRow(r);
    }
  }

  let linkedCanonicalMutated = false;
  if (mutatedExistingIds.size > 0) {
    const propagateStmts: D1PreparedStatement[] = [];
    const mutatedArr = Array.from(mutatedExistingIds);
    for (let i = 0; i < mutatedArr.length; i += 40) {
      const chunk = mutatedArr.slice(i, i + 40);
      const ph = chunk.map(() => '?').join(',');
      try {
        const linkedHits = await env.DB.prepare(
          `SELECT DISTINCT canonical_release_id FROM game_releases WHERE canonical_release_id IN (${ph})`,
        )
          .bind(...chunk)
          .all<{ canonical_release_id: number }>();
        for (const hit of linkedHits.results || []) {
          linkedCanonicalMutated = true;
          const mutatedRow = rowsById.get(hit.canonical_release_id);
          if (!mutatedRow) continue;
          if (writesUsed + 7 > options.maxWriteBudget) continue;
          propagateStmts.push(
            env.DB.prepare(
              `UPDATE game_releases
               SET verified_source = ?,
                   serial_code = ?,
                   canonical_title = ?,
                   publisher = ?
               WHERE canonical_release_id = ?
                 AND (
                   verified_source IS NOT ?
                   OR serial_code IS NOT ?
                   OR canonical_title IS NOT ?
                   OR publisher IS NOT ?
                 )`,
            ).bind(
              mutatedRow.source,
              mutatedRow.serial_code,
              mutatedRow.raw_title,
              mutatedRow.publisher,
              hit.canonical_release_id,
              mutatedRow.source,
              mutatedRow.serial_code,
              mutatedRow.raw_title,
              mutatedRow.publisher,
            ),
          );
          writesUsed += 7;
        }
      } catch {
        // Ignore in minimal test mocks
      }
    }
    for (let i = 0; i < propagateStmts.length; i += 100) {
      await env.DB.batch(propagateStmts.slice(i, i + 100));
    }
  }

  let linkedReleases = 0;
  if (
    options.touchedPlatforms.length > 0 &&
    writesUsed + 7 <= options.maxWriteBudget
  ) {
    const platPh = options.touchedPlatforms.map(() => '?').join(',');
    const [unlinkedRes, existingLinkedRes] = await Promise.all([
      env.DB.prepare(
        `SELECT gr.id, gr.game_id, gr.region, gr.variants, g.title, g.platform_id
         FROM game_releases gr
         JOIN games g ON g.stable_id = gr.game_id
         WHERE gr.canonical_release_id IS NULL
           AND g.platform_id IN (${platPh})`,
      )
        .bind(...options.touchedPlatforms)
        .all<{
          id: string;
          game_id: number;
          region: string | null;
          variants: string | null;
          title: string;
          platform_id: number;
        }>(),
      env.DB.prepare(
        `SELECT gr.game_id, gr.canonical_release_id
         FROM game_releases gr
         JOIN games g ON g.stable_id = gr.game_id
         WHERE gr.canonical_release_id IS NOT NULL
           AND g.platform_id IN (${platPh})`,
      )
        .bind(...options.touchedPlatforms)
        .all<{ game_id: number; canonical_release_id: number }>(),
    ]);

    const usedCanonicalByGame = new Map<number, Set<number>>();
    for (const row of existingLinkedRes.results || []) {
      let set = usedCanonicalByGame.get(row.game_id);
      if (!set) {
        set = new Set<number>();
        usedCanonicalByGame.set(row.game_id, set);
      }
      set.add(row.canonical_release_id);
    }

    const linkStmts: D1PreparedStatement[] = [];
    for (const gr of unlinkedRes.results || []) {
      if (writesUsed + 7 > options.maxWriteBudget) break;
      const usedForGame = usedCanonicalByGame.get(gr.game_id);
      const lookupKeys = buildCanonicalLinkerMatchKeys(gr.title);
      const seenCand = new Set<WorkerCanonicalMergeRow>();
      const candidates: WorkerCanonicalMergeRow[] = [];
      for (const lk of lookupKeys) {
        for (const cand of byPlatKey.get(`${gr.platform_id}::${lk}`) || []) {
          if (seenCand.has(cand)) continue;
          seenCand.add(cand);
          if (cand.id <= 0 || cand.is_verified_physical !== 1) continue;
          if (usedForGame?.has(cand.id)) continue;
          if (!areCanonicalTitlesSequelCompatible(gr.title, cand.raw_title)) {
            continue;
          }
          if (
            gr.variants &&
            cand.variants &&
            gr.variants.toLowerCase() !== cand.variants.toLowerCase()
          ) {
            continue;
          }
          if (gr.region && !regionsOverlap(gr.region, cand.region)) {
            continue;
          }
          candidates.push(cand);
        }
      }
      if (candidates.length === 0) continue;

      const exactNorm = normalizeTitleForMatching(gr.title);
      const targetRegionLower = (gr.region || '').trim().toLowerCase();
      candidates.sort((a, b) => {
        const prioDiff =
          getCanonicalSourcePriority(a.source) -
          getCanonicalSourcePriority(b.source);
        if (prioDiff !== 0) return prioDiff;
        const normA = a.normalized_title === exactNorm ? 0 : 1;
        const normB = b.normalized_title === exactNorm ? 0 : 1;
        if (normA !== normB) return normA - normB;
        if (targetRegionLower) {
          const regExactA =
            (a.region || '').trim().toLowerCase() === targetRegionLower ? 0 : 1;
          const regExactB =
            (b.region || '').trim().toLowerCase() === targetRegionLower ? 0 : 1;
          if (regExactA !== regExactB) return regExactA - regExactB;
        }
        return (b.serial_code ? 1 : 0) - (a.serial_code ? 1 : 0);
      });

      const best = candidates[0];
      let gameSet = usedCanonicalByGame.get(gr.game_id);
      if (!gameSet) {
        gameSet = new Set<number>();
        usedCanonicalByGame.set(gr.game_id, gameSet);
      }
      gameSet.add(best.id);
      linkStmts.push(
        env.DB.prepare(
          `UPDATE game_releases
           SET canonical_release_id = ?,
               variants = COALESCE(variants, ?),
               barcode = COALESCE(barcode, ?),
               verified_source = ?,
               serial_code = ?,
               canonical_title = ?,
               publisher = ?
           WHERE id = ?
             AND canonical_release_id IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM game_releases gr2
               WHERE gr2.game_id = game_releases.game_id
                 AND gr2.canonical_release_id = ?
                 AND gr2.id != game_releases.id
             )`,
        ).bind(
          best.id,
          best.variants,
          best.barcode,
          best.source,
          best.serial_code,
          best.raw_title,
          best.publisher,
          gr.id,
          best.id,
        ),
      );
      writesUsed += 7;
      linkedReleases++;
    }

    for (let i = 0; i < linkStmts.length; i += 100) {
      await env.DB.batch(linkStmts.slice(i, i + 100));
    }
  }

  return {
    addedCanonical,
    upgradedCanonical,
    enrichedCanonical,
    linkedReleases,
    linkedCanonicalMutated,
    writesUsed,
  };
}

/**
 * Daily SHA-256 hash-gated sync for the community PlayStation 5 Physical Database (PS5DB).
 * Applies 4-tier source precedence on `platform_id = 35` and links unlinked PS5 `game_releases`.
 */
export async function syncWorkerPs5Db(env: Env): Promise<{
  checked: boolean;
  hashMatch: boolean;
  addedCanonical: number;
  upgradedCanonical: number;
  enrichedCanonical: number;
  linkedReleases: number;
  writesUsed: number;
}> {
  let csv: string | undefined;
  try {
    const res = await fetch(PS5DB_CSV_URL, {
      headers: {
        'User-Agent': 'CollectionTracker/2.0 (Ps5DbSync)',
        Accept: 'text/csv,text/plain,*/*',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      return {
        checked: false,
        hashMatch: false,
        addedCanonical: 0,
        upgradedCanonical: 0,
        enrichedCanonical: 0,
        linkedReleases: 0,
        writesUsed: 0,
      };
    }
    csv = await res.text();
  } catch {
    return {
      checked: false,
      hashMatch: false,
      addedCanonical: 0,
      upgradedCanonical: 0,
      enrichedCanonical: 0,
      linkedReleases: 0,
      writesUsed: 0,
    };
  }

  if (!csv || !csv.trim() || !csv.includes('Title')) {
    return {
      checked: false,
      hashMatch: false,
      addedCanonical: 0,
      upgradedCanonical: 0,
      enrichedCanonical: 0,
      linkedReleases: 0,
      writesUsed: 0,
    };
  }

  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`v1||${csv}`),
  );
  const currentHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  try {
    const lastHash = await env.DB.prepare(
      "SELECT value FROM sync_state WHERE key = 'ps5db_sync_hash'",
    ).first<{ value: string }>();
    if (lastHash?.value === currentHash) {
      return {
        checked: true,
        hashMatch: true,
        addedCanonical: 0,
        upgradedCanonical: 0,
        enrichedCanonical: 0,
        linkedReleases: 0,
        writesUsed: 0,
      };
    }
  } catch {
    // Proceed in minimal schemas
  }

  const entries = parsePs5DbCsv(csv);
  const existingRes = await env.DB.prepare(
    `SELECT id, platform_id, raw_title, normalized_title, region, variants,
            serial_code, barcode, publisher, source, is_verified_physical
     FROM canonical_releases
     WHERE platform_id = 35 AND is_verified_physical = 1`,
  ).all<WorkerCanonicalMergeRow>();

  const mergeRes = await applyWorkerCanonicalHierarchyMerge(
    env,
    entries,
    existingRes.results || [],
    {
      touchedPlatforms: [35],
      maxWriteBudget: 45000,
      loadPostInsertRows: async (_plats, normKeys) => {
        const out: WorkerCanonicalMergeRow[] = [];
        for (let i = 0; i < normKeys.length; i += 40) {
          const chunk = normKeys.slice(i, i + 40);
          const ph = chunk.map(() => '?').join(',');
          const res = await env.DB.prepare(
            `SELECT id, platform_id, raw_title, normalized_title, region, variants,
                    serial_code, barcode, publisher, source, is_verified_physical
             FROM canonical_releases
             WHERE platform_id = 35 AND normalized_title IN (${ph}) AND is_verified_physical = 1`,
          )
            .bind(...chunk)
            .all<WorkerCanonicalMergeRow>();
          out.push(...(res.results || []));
        }
        return out;
      },
    },
  );

  if (
    mergeRes.addedCanonical > 0 ||
    mergeRes.upgradedCanonical > 0 ||
    mergeRes.enrichedCanonical > 0
  ) {
    await markCanonicalReleasesDirty(env);
  }
  if (mergeRes.linkedReleases > 0 || mergeRes.linkedCanonicalMutated) {
    await markCatalogChunksDirty(env);
  }

  await env.DB.prepare(
    `INSERT INTO sync_state (key, value, updated_at)
     VALUES ('ps5db_sync_hash', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  )
    .bind(currentHash)
    .run();

  return {
    checked: true,
    hashMatch: false,
    addedCanonical: mergeRes.addedCanonical,
    upgradedCanonical: mergeRes.upgradedCanonical,
    enrichedCanonical: mergeRes.enrichedCanonical,
    linkedReleases: mergeRes.linkedReleases,
    writesUsed: mergeRes.writesUsed + 1,
  };
}

const SERIALSTATION_CRON_INTERVAL_MS = 115 * 60 * 1000;
const SERIALSTATION_MAX_WRITES_PER_RUN = 1500;

/**
 * Fail-soft rolling sweep over SerialStation `/v1/releases/?release_type=PHYSICAL`
 * (`2` pages / ~2h, default Vita 33 / PS4 34 / PS5 35), applying 4-tier hierarchy
 * enrichment and linking matching unlinked PlayStation `game_releases`.
 */
export async function syncWorkerSerialStation(
  env: Env,
  options?: { force?: boolean; maxPages?: number },
): Promise<{
  checked: boolean;
  skipped: boolean;
  error?: string;
  pagesFetched: number;
  addedCanonical: number;
  upgradedCanonical: number;
  enrichedCanonical: number;
  linkedReleases: number;
  nextOffset: number;
  writesUsed: number;
}> {
  const nowMs = Date.now();
  let startOffset = 0;
  try {
    const [lastRunRow, cursorRow] = await Promise.all([
      env.DB.prepare(
        "SELECT value FROM sync_state WHERE key = 'serialstation_last_run'",
      ).first<{ value: string }>(),
      env.DB.prepare(
        "SELECT value FROM sync_state WHERE key = 'serialstation_cursor_offset'",
      ).first<{ value: string }>(),
    ]);
    if (cursorRow?.value && /^\d+$/.test(cursorRow.value)) {
      startOffset = parseInt(cursorRow.value, 10);
    }
    if (!options?.force && lastRunRow?.value) {
      const lastRunMs = /^\d+$/.test(lastRunRow.value)
        ? parseInt(lastRunRow.value, 10)
        : Date.parse(lastRunRow.value);
      if (
        Number.isFinite(lastRunMs) &&
        lastRunMs > 0 &&
        nowMs - lastRunMs < SERIALSTATION_CRON_INTERVAL_MS
      ) {
        return {
          checked: false,
          skipped: true,
          pagesFetched: 0,
          addedCanonical: 0,
          upgradedCanonical: 0,
          enrichedCanonical: 0,
          linkedReleases: 0,
          nextOffset: startOffset,
          writesUsed: 0,
        };
      }
    }
  } catch {
    // Proceed in minimal schemas
  }

  const maxPages = Math.max(1, options?.maxPages ?? 5);
  const rawItems: SerialStationReleaseItem[] = [];
  let pagesFetched = 0;
  let lastSucceededOffset: number | null = null;
  let reachedEnd = false;
  let fetchError: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const pageOffset = startOffset + page * SERIALSTATION_PAGE_LIMIT;
    const url = `${SERIALSTATION_RELEASES_URL}?release_type=PHYSICAL&limit=${SERIALSTATION_PAGE_LIMIT}&offset=${pageOffset}`;
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'CollectionTracker/2.0 (SerialStationCron)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        fetchError = `HTTP ${res.status} ${res.statusText}`;
        if (res.status === 429) break;
        if (page < maxPages - 1) continue;
        break;
      }
      const payload = (await res.json()) as {
        items?: SerialStationReleaseItem[];
        count?: number;
      } | null;
      if (
        !payload ||
        typeof payload !== 'object' ||
        !Array.isArray(payload.items)
      ) {
        fetchError = 'Unexpected SerialStation JSON payload';
        if (page < maxPages - 1) continue;
        break;
      }
      pagesFetched++;
      lastSucceededOffset = pageOffset;
      rawItems.push(...payload.items);
      const totalCount =
        typeof payload.count === 'number' ? payload.count : undefined;
      if (
        payload.items.length < SERIALSTATION_PAGE_LIMIT ||
        (totalCount !== undefined &&
          pageOffset + payload.items.length >= totalCount)
      ) {
        reachedEnd = true;
        break;
      }
    } catch (err) {
      fetchError = err instanceof Error ? err.message : String(err);
      if (page < maxPages - 1) continue;
      break;
    }
  }

  // Record last run timestamp on fail-soft error WITHOUT advancing cursor_offset
  if (fetchError && pagesFetched === 0) {
    try {
      await env.DB.prepare(
        `INSERT INTO sync_state (key, value, updated_at)
         VALUES ('serialstation_last_run', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      )
        .bind(String(nowMs))
        .run();
    } catch {
      // Ignore in minimal schemas
    }
    return {
      checked: true,
      skipped: false,
      error: fetchError,
      pagesFetched: 0,
      addedCanonical: 0,
      upgradedCanonical: 0,
      enrichedCanonical: 0,
      linkedReleases: 0,
      nextOffset: startOffset,
      writesUsed: 0,
    };
  }

  const parsed = parseSerialStationRecords(rawItems, [], {
    allowedPlatformIds: DEFAULT_SERIALSTATION_PLATFORM_IDS,
  });

  const keysByPlat = new Map<number, Set<string>>();
  for (const rel of parsed) {
    let set = keysByPlat.get(rel.platform_id);
    if (!set) {
      set = new Set<string>();
      keysByPlat.set(rel.platform_id, set);
    }
    set.add(rel.normalized_title);
    for (const k of buildCanonicalLinkerMatchKeys(rel.raw_title)) {
      set.add(k);
    }
  }

  const loadByPlatKeys = async (
    platIds: number[],
    filterKeys?: string[],
  ): Promise<WorkerCanonicalMergeRow[]> => {
    const rows: WorkerCanonicalMergeRow[] = [];
    for (const platId of platIds) {
      const keyArr = filterKeys ?? Array.from(keysByPlat.get(platId) || []);
      for (let i = 0; i < keyArr.length; i += 40) {
        const chunk = keyArr.slice(i, i + 40);
        const ph = chunk.map(() => '?').join(',');
        const res = await env.DB.prepare(
          `SELECT id, platform_id, raw_title, normalized_title, region, variants,
                  serial_code, barcode, publisher, source, is_verified_physical
           FROM canonical_releases
           WHERE platform_id = ? AND normalized_title IN (${ph}) AND is_verified_physical = 1`,
        )
          .bind(platId, ...chunk)
          .all<WorkerCanonicalMergeRow>();
        rows.push(...(res.results || []));
      }
    }
    return rows;
  };

  const touchedPlatforms = Array.from(keysByPlat.keys());
  const existingRows = await loadByPlatKeys(touchedPlatforms);

  const mergeRes =
    parsed.length > 0
      ? await applyWorkerCanonicalHierarchyMerge(env, parsed, existingRows, {
          touchedPlatforms,
          maxWriteBudget: SERIALSTATION_MAX_WRITES_PER_RUN,
          loadPostInsertRows: loadByPlatKeys,
        })
      : {
          addedCanonical: 0,
          upgradedCanonical: 0,
          enrichedCanonical: 0,
          linkedReleases: 0,
          linkedCanonicalMutated: false,
          writesUsed: 0,
        };

  if (
    mergeRes.addedCanonical > 0 ||
    mergeRes.upgradedCanonical > 0 ||
    mergeRes.enrichedCanonical > 0
  ) {
    await markCanonicalReleasesDirty(env);
  }
  if (mergeRes.linkedReleases > 0 || mergeRes.linkedCanonicalMutated) {
    await markCatalogChunksDirty(env);
  }

  const nextOffset = reachedEnd
    ? 0
    : (lastSucceededOffset ?? startOffset) + SERIALSTATION_PAGE_LIMIT;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO sync_state (key, value, updated_at)
       VALUES ('serialstation_cursor_offset', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    ).bind(String(nextOffset)),
    env.DB.prepare(
      `INSERT INTO sync_state (key, value, updated_at)
       VALUES ('serialstation_last_run', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    ).bind(String(nowMs)),
  ]);

  return {
    checked: true,
    skipped: false,
    ...(fetchError ? { error: fetchError } : {}),
    pagesFetched,
    addedCanonical: mergeRes.addedCanonical,
    upgradedCanonical: mergeRes.upgradedCanonical,
    enrichedCanonical: mergeRes.enrichedCanonical,
    linkedReleases: mergeRes.linkedReleases,
    nextOffset,
    writesUsed: mergeRes.writesUsed + 2,
  };
}

/**
 * Synchronizes boutique physical publisher pre-orders and storefront catalogs
 * (Limited Run Games, Super Rare Games, iam8bit, Fangamer, Strictly Limited Games, VGP, PNP Games)
 * into Cloudflare D1 and dispatches push notifications when physical editions are detected.
 */
export async function syncWorkerBoutiquePreOrders(env: Env): Promise<{
  matchedCount: number;
  ingestedCount: number;
  totalPreOrders: number;
  notifications: { dispatchedCount: number; purgedCount: number };
}> {
  const [storePreOrders, lgnPreOrders] = await Promise.all([
    fetchBoutiquePreOrders(fetch),
    fetchLimitedGameNewsReleases(fetch, { maxPages: 1, perPage: 50 }).catch(
      () => [] as BoutiquePreOrder[],
    ),
  ]);
  const preOrders = [...storePreOrders, ...lgnPreOrders];
  if (preOrders.length === 0) {
    return {
      matchedCount: 0,
      ingestedCount: 0,
      totalPreOrders: 0,
      notifications: { dispatchedCount: 0, purgedCount: 0 },
    };
  }

  const targetPlatformSet = new Set<number>(
    preOrders
      .map((po) => po.platformId)
      .filter((id): id is number => typeof id === 'number' && id > 0),
  );
  if (preOrders.some((po) => po.ambiguousXbox)) {
    targetPlatformSet.add(49);
    targetPlatformSet.add(50);
  }
  const targetPlatforms = Array.from(targetPlatformSet);

  if (targetPlatforms.length === 0) {
    return {
      matchedCount: 0,
      ingestedCount: 0,
      totalPreOrders: preOrders.length,
      notifications: { dispatchedCount: 0, purgedCount: 0 },
    };
  }

  // Compute SHA-256 fingerprint of upstream boutique feed items to skip D1 table scans when unchanged
  let currentFeedHash = '';
  try {
    const feedSignature = preOrders
      .map(
        (po) =>
          `${po.store}|${po.platformId ?? ''}|${po.cleanTitle}|${po.edition ?? ''}|${po.productUrl}|${po.priceCents ?? po.priceUsd ?? ''}|${po.isPreOrder ? 1 : 0}|${po.isAvailable === false ? 0 : 1}`,
      )
      .sort()
      .join('||');
    const hashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(feedSignature),
    );
    currentFeedHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const lastHashRow = await env.DB.prepare(
      `SELECT value FROM sync_state WHERE key = 'boutique_feed_hash'`,
    ).first<{ value: string }>();
    if (lastHashRow?.value && lastHashRow.value === currentFeedHash) {
      return {
        matchedCount: 0,
        ingestedCount: 0,
        totalPreOrders: preOrders.length,
        notifications: { dispatchedCount: 0, purgedCount: 0 },
      };
    }
  } catch {
    // Proceed with full sync if sync_state lookup fails
  }

  const placeholders = targetPlatforms.map(() => '?').join(', ');
  const candidateRows = await env.DB.prepare(
    `SELECT g.stable_id, g.id, g.title, g.platform_id, g.igdb_id, g.retail_url,
            0 AS ownership_status,
            0 AS has_owned_physical,
            NULL AS owned_variants
     FROM games g
     WHERE g.platform_id IN (${placeholders})`,
  )
    .bind(...targetPlatforms)
    .all<{
      stable_id: number;
      id: string;
      title: string;
      platform_id: number;
      igdb_id: number | null;
      retail_url: string | null;
      ownership_status: number;
      has_owned_physical: number;
      owned_variants: string | null;
    }>();

  const games = candidateRows.results || [];
  const catalogIndex = new PlatformCatalogDedupeIndex(games);

  // Read previously announced URLs from sync_state to avoid repeating uncataloged notifications
  let announcedUrls = new Set<string>();
  let isColdStartSeed = false;
  try {
    const seedRow = await env.DB.prepare(
      `SELECT value FROM sync_state WHERE key = 'boutique_seed_completed'`,
    ).first<{ value: string }>();
    if (!seedRow || seedRow.value !== '1') {
      isColdStartSeed = true;
    }

    const seenRows = await env.DB.prepare(
      `SELECT key FROM sync_state WHERE key >= 'boutique_announced:' AND key < 'boutique_announced;'`,
    ).all<{ key: string }>();
    announcedUrls = new Set(
      (seenRows.results || []).map((r) =>
        r.key.slice('boutique_announced:'.length),
      ),
    );
  } catch {
    // sync_state table may not exist yet in unmigrated environments
  }

  const newlyAnnouncedGames: Array<{
    game: {
      stable_id?: number;
      id: string;
      title: string;
      ownership_status: number;
      platform_id: number;
    };
    preOrder: BoutiquePreOrder;
    isSpecialEdition?: boolean;
    isUncataloged?: boolean;
  }> = [];

  const BOUTIQUE_AUTO_INGEST_CAP = 10;
  const pendingBoutiqueIngest = new Map<
    string,
    {
      po: BoutiquePreOrder;
      platformId: number;
      poNorm: string;
      priceCents: number | null;
      regularPriceCents: number | null;
      discountPct: number;
      onSaleInt: number;
      shouldAnnounceFresh: boolean;
    }
  >();

  const statements: D1PreparedStatement[] = [];

  for (const po of preOrders) {
    if (!po.platformId) continue;
    // Sold-out boutique items must never update retail status or trigger announcement notifications
    if (po.isAvailable === false) continue;

    const poNorm = normalizeTitleForMatching(po.cleanTitle);
    if (!poNorm) continue;

    const isRecent = (() => {
      if (!po.publishedAt) return false;
      const pubMs = new Date(po.publishedAt).getTime();
      if (isNaN(pubMs)) return false;
      return Date.now() - pubMs <= 7 * 24 * 60 * 60 * 1000;
    })();

    const isActionableAnnouncement = po.isPreOrder || isRecent;

    let effectivePlatformId = po.platformId;
    let match = catalogIndex.findMatch(
      effectivePlatformId,
      po.cleanTitle,
      po.productUrl,
    );
    // Ambiguous bare "Xbox" resolves via catalog preferring Xbox One (49), falling back to XSX (50) only if XSX-only
    if (!match && po.ambiguousXbox && effectivePlatformId === 49) {
      const xsxMatch = catalogIndex.findMatch(50, po.cleanTitle, po.productUrl);
      if (xsxMatch) {
        effectivePlatformId = 50;
        match = xsxMatch;
      }
    }

    const priceCents =
      po.priceCents ?? (po.priceUsd ? Math.round(po.priceUsd * 100) : null);
    const regularPriceCents = po.regularPriceCents ?? priceCents;
    const discountPct = po.onSale ? (po.discountPct ?? 0) : 0;
    const onSaleInt = po.onSale && discountPct > 0 ? 1 : 0;

    if (match) {
      const isUrlDifferent = match.retail_url !== po.productUrl;

      if (isUrlDifferent) {
        statements.push(
          env.DB.prepare(
            `UPDATE games
             SET retail_url = ?,
                 retail_price = COALESCE(?, retail_price),
                 retail_regular_price = COALESCE(?, retail_regular_price),
                 retail_discount_pct = ?,
                 retail_on_sale = ?,
                 retail_store = ?
             WHERE stable_id = ?`,
          ).bind(
            po.productUrl,
            priceCents,
            regularPriceCents,
            discountPct,
            onSaleInt,
            po.store,
            match.stable_id,
          ),
        );
      }

      // Notify only when a special edition is announced for the first time
      // (per-user ownership suppression is evaluated per subscriber in dispatchPhysicalAnnouncementNotifications).
      const isSpecialEdition = Boolean(po.edition);
      const isUnannouncedSpecialEdition =
        isSpecialEdition &&
        isActionableAnnouncement &&
        !announcedUrls.has(po.productUrl);

      const shouldNotify = !isColdStartSeed && isUnannouncedSpecialEdition;

      if (shouldNotify) {
        newlyAnnouncedGames.push({
          game: match,
          preOrder: po,
          isSpecialEdition,
        });

        if (isUnannouncedSpecialEdition) {
          statements.push(
            env.DB.prepare(
              `INSERT INTO sync_state (key, value, updated_at)
               VALUES (?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(key) DO UPDATE SET updated_at = CURRENT_TIMESTAMP`,
            ).bind(
              `boutique_announced:${po.productUrl}`,
              `${match.title} (${po.edition})`,
            ),
          );
          announcedUrls.add(po.productUrl);
        }
      }
    } else {
      // Uncataloged game drop:
      // 1. Must be a genuine pre-order (not in-stock older inventory)
      // 2. Announcement requires publication within the last 72 hours
      // 3. Auto-ingest up to BOUTIQUE_AUTO_INGEST_CAP per run into D1 with IGDB enrichment
      const isRecentAnnouncement = (() => {
        if (!po.publishedAt) return false;
        const pubMs = new Date(po.publishedAt).getTime();
        if (isNaN(pubMs)) return false;
        return Date.now() - pubMs <= 72 * 60 * 60 * 1000;
      })();

      const shouldAnnounceFresh =
        po.isPreOrder &&
        isRecentAnnouncement &&
        !announcedUrls.has(po.productUrl) &&
        !isColdStartSeed;

      const ingestKey = `${effectivePlatformId}::${poNorm}`;
      const canAutoIngest =
        po.isPreOrder &&
        effectivePlatformId > 0 &&
        po.cleanTitle.trim().length > 1 &&
        !isLikelyNonGameMerchTitle(po.cleanTitle) &&
        !pendingBoutiqueIngest.has(ingestKey) &&
        pendingBoutiqueIngest.size < BOUTIQUE_AUTO_INGEST_CAP;

      if (canAutoIngest) {
        pendingBoutiqueIngest.set(ingestKey, {
          po: { ...po, platformId: effectivePlatformId },
          platformId: effectivePlatformId,
          poNorm,
          priceCents,
          regularPriceCents,
          discountPct,
          onSaleInt,
          shouldAnnounceFresh,
        });
      } else if (shouldAnnounceFresh) {
        newlyAnnouncedGames.push({
          game: {
            id: `boutique-${po.store.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${encodeURIComponent(po.cleanTitle)}`,
            title: po.cleanTitle,
            ownership_status: 0,
            platform_id: effectivePlatformId,
          },
          preOrder: { ...po, platformId: effectivePlatformId },
          isUncataloged: true,
        });
      }

      // Always record into sync_state so it is never treated as new again
      if (!announcedUrls.has(po.productUrl)) {
        statements.push(
          env.DB.prepare(
            `INSERT INTO sync_state (key, value, updated_at)
             VALUES (?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(key) DO UPDATE SET updated_at = CURRENT_TIMESTAMP`,
          ).bind(`boutique_announced:${po.productUrl}`, po.cleanTitle),
        );
        announcedUrls.add(po.productUrl);
      }
    }
  }

  let boutiqueIngestedCount = 0;
  let boutiqueIngestFailed = false;
  if (pendingBoutiqueIngest.size > 0) {
    try {
      const { byId: platformById } = await loadPlatformLookupMaps(env);
      const igdbLookupItems = Array.from(pendingBoutiqueIngest.entries())
        .map(([key, entry]) => ({
          key,
          title: entry.po.cleanTitle,
          normalizedTitle: entry.poNorm,
          igdbPlatformId: platformById.get(entry.platformId)?.igdbId ?? null,
        }))
        .filter((i) => i.igdbPlatformId && i.igdbPlatformId > 0);
      const igdbMetaMap =
        igdbLookupItems.length > 0
          ? await fetchIgdbMetadataForTitles(env, igdbLookupItems)
          : new Map<string, IgdbGameMeta>();

      const usedSlugs = new Set<string>();
      const boutiqueIngestedForRules: Array<{
        stableId: number;
        platformId: number;
        canonicalSeries?: string | null;
        seriesTrackable?: boolean;
        title?: string;
        platformName?: string | null;
        gameSlug?: string;
        releases: Array<{ id: string; region: string | null }>;
      }> = [];

      for (const [key, entry] of pendingBoutiqueIngest.entries()) {
        const { po, platformId } = entry;
        const igdbMeta = igdbMetaMap.get(key) ?? null;
        if (
          igdbMeta?.igdb_id &&
          catalogIndex.hasIgdb(platformId, igdbMeta.igdb_id)
        ) {
          continue;
        }
        const platInfo = platformById.get(platformId);
        const canonicalTitle = resolveCanonicalDisplayTitle(
          po.cleanTitle,
          igdbMeta?.name,
        );
        if (
          catalogIndex.findMatch(platformId, canonicalTitle, po.productUrl) ||
          catalogIndex.findMatch(platformId, po.cleanTitle, po.productUrl)
        ) {
          continue;
        }
        const canonicalSeries = computeGameCanonicalSeries({
          title: canonicalTitle,
          collections: igdbMeta?.collections ?? undefined,
          franchises: igdbMeta?.franchises ?? undefined,
        });
        const storeSlug = slugifySegment(po.store) || 'boutique';
        const releaseRegion = po.region || 'USA';
        const releaseVariant = po.edition || 'Standard Physical';
        const canonicalSource =
          po.store === 'Limited Game News' ? 'lgn' : 'retail_catalog';
        const canonicalRef = await ensureCanonicalReleaseForRetailOrBoutique(
          env,
          {
            platformId,
            rawTitle: canonicalTitle,
            region: releaseRegion,
            variants: releaseVariant,
            publisher: po.store,
            source: canonicalSource,
          },
        );
        if (!canonicalRef?.id) continue;

        const inserted = await insertCatalogGameWithReleases(env, {
          title: canonicalTitle,
          platformId,
          platformSlugHint: platInfo?.displayName || platInfo?.name,
          region: releaseRegion,
          canonicalSeries,
          igdbMeta,
          imageUrlFallback: po.imageUrl ?? null,
          retailPriceCents: entry.priceCents,
          retailRegularPriceCents: entry.regularPriceCents,
          retailDiscountPct: entry.discountPct,
          retailOnSale: entry.onSaleInt,
          retailStore: po.store,
          retailUrl: po.productUrl,
          retailUpdatedAt: new Date().toISOString(),
          usedSlugs,
          releases: [
            {
              slugSuffix: `boutique-${storeSlug}`,
              region: releaseRegion,
              variants: releaseVariant,
              canonicalReleaseId: canonicalRef?.id ?? null,
              verifiedSource: canonicalRef?.source ?? null,
              canonicalTitle: canonicalRef?.rawTitle ?? null,
              publisher: canonicalRef?.publisher ?? null,
            },
          ],
        });

        if (inserted) {
          const registeredEntry = {
            stable_id: inserted.stableId,
            id: inserted.gameSlug,
            title: canonicalTitle,
            platform_id: platformId,
            igdb_id: igdbMeta?.igdb_id ?? null,
            retail_url: po.productUrl,
            ownership_status: 0,
            has_owned_physical: 0,
            owned_variants: null,
          };
          catalogIndex.register(registeredEntry);
          catalogIndex.registerAliases(
            platformId,
            [po.cleanTitle],
            registeredEntry,
          );
          boutiqueIngestedCount++;
          boutiqueIngestedForRules.push({
            stableId: inserted.stableId,
            platformId,
            canonicalSeries,
            seriesTrackable: isSeriesTrackable({
              title: canonicalTitle,
              collections: igdbMeta?.collections,
              franchises: igdbMeta?.franchises,
            }),
            title: canonicalTitle,
            platformName: platInfo?.displayName || platInfo?.name || null,
            gameSlug: String(inserted.stableId),
            releases: inserted.insertedReleases,
          });
          if (entry.shouldAnnounceFresh) {
            newlyAnnouncedGames.push({
              game: {
                stable_id: inserted.stableId,
                id: inserted.gameSlug,
                title: canonicalTitle,
                ownership_status: 0,
                platform_id: platformId,
              },
              preOrder: po,
              isUncataloged: true,
            });
          }
        } else if (entry.shouldAnnounceFresh) {
          newlyAnnouncedGames.push({
            game: {
              id: `boutique-${po.store.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${encodeURIComponent(canonicalTitle)}`,
              title: canonicalTitle,
              ownership_status: 0,
              platform_id: platformId,
            },
            preOrder: po,
            isUncataloged: true,
          });
        }
      }

      if (boutiqueIngestedForRules.length > 0) {
        await evaluateTrackingRulesForNewGames(env, boutiqueIngestedForRules, {
          notifySubscribers: !isColdStartSeed,
        });
        invalidateSeriesScanCache();
        await invalidateCatalogManifest(env);
        await markDbDirty(env);
      }
    } catch (boutiqueIngestErr) {
      boutiqueIngestFailed = true;
      console.warn(
        '[WorkerCron] Boutique pre-order auto-ingestion failed:',
        boutiqueIngestErr,
      );
    }
  }

  // If this was a cold-start seed, mark seed completed so subsequent runs alert on new items
  if (isColdStartSeed) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO sync_state (key, value, updated_at)
         VALUES ('boutique_seed_completed', '1', CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = CURRENT_TIMESTAMP`,
      ),
    );
  }

  if (statements.length > 0) {
    const CHUNK_SIZE = 100;
    for (let i = 0; i < statements.length; i += CHUNK_SIZE) {
      const chunk = statements.slice(i, i + CHUNK_SIZE);
      await env.DB.batch(chunk);
    }
    await markDbDirty(env);
  }

  if (currentFeedHash && !boutiqueIngestFailed) {
    try {
      await env.DB.prepare(
        `INSERT INTO sync_state (key, value, updated_at)
         VALUES ('boutique_feed_hash', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      )
        .bind(currentFeedHash)
        .run();
    } catch {
      // Ignore sync_state persistence errors in unmigrated test environments
    }
  }

  let notificationsResult = { dispatchedCount: 0, purgedCount: 0 };
  if (newlyAnnouncedGames.length > 0) {
    notificationsResult = await dispatchPhysicalAnnouncementNotifications(
      newlyAnnouncedGames,
      env,
    );
  }

  return {
    matchedCount: statements.length + boutiqueIngestedCount,
    ingestedCount: boutiqueIngestedCount,
    totalPreOrders: preOrders.length,
    notifications: notificationsResult,
  };
}

async function dispatchPhysicalAnnouncementNotifications(
  items: Array<{
    game: {
      stable_id?: number;
      id: string;
      title: string;
      ownership_status: number;
      has_owned_physical?: number;
      owned_variants?: string | null;
      platform_id: number;
    };
    preOrder: BoutiquePreOrder;
    isSpecialEdition?: boolean;
    isUncataloged?: boolean;
  }>,
  env: Env,
): Promise<{ dispatchedCount: number; purgedCount: number }> {
  let dispatchedCount = 0;
  let purgedCount = 0;

  try {
    const subRows = await env.DB.prepare(
      `SELECT COALESCE(user_id, 1) as user_id, endpoint, p256dh, auth, preferences_json FROM push_subscriptions`,
    ).all<{
      user_id: number;
      endpoint: string;
      p256dh: string;
      auth: string;
      preferences_json: string | null;
    }>();

    const subscriptions = subRows.results || [];
    if (subscriptions.length === 0) {
      return { dispatchedCount: 0, purgedCount: 0 };
    }

    const subscribedUserIds = Array.from(
      new Set(subscriptions.map((s) => s.user_id || 1)),
    );
    const userOwnershipByGame = new Map<
      string,
      {
        ownership_status: number;
        has_owned_physical: number;
        owned_variants: string | null;
      }
    >();
    try {
      const subPlaceholders = subscribedUserIds.map(() => '?').join(',');
      const ugrRows = await env.DB.prepare(
        `SELECT ugr.user_id, r.game_id as stable_id,
                MAX(ugr.ownership_status) as ownership_status,
                MAX(CASE WHEN ugr.ownership_status = 1 THEN 1 ELSE 0 END) as has_owned_physical,
                GROUP_CONCAT(CASE WHEN ugr.ownership_status = 1 THEN COALESCE(r.variants, '') ELSE NULL END) as owned_variants
         FROM user_game_releases ugr
         JOIN game_releases r ON r.id = ugr.release_id
         WHERE ugr.user_id IN (${subPlaceholders})
         GROUP BY ugr.user_id, r.game_id`,
      )
        .bind(...subscribedUserIds)
        .all<{
          user_id: number;
          stable_id: number;
          ownership_status: number;
          has_owned_physical: number;
          owned_variants: string | null;
        }>();
      for (const row of ugrRows.results || []) {
        userOwnershipByGame.set(`${row.user_id}:${row.stable_id}`, {
          ownership_status: row.ownership_status ?? 0,
          has_owned_physical: row.has_owned_physical ?? 0,
          owned_variants: row.owned_variants ?? null,
        });
      }
    } catch {
      // Fallback to 0 (unowned) if user_game_releases query fails
    }

    for (const sub of subscriptions) {
      const subUserId = sub.user_id || 1;
      let prefs: Partial<DealNotificationPreferences> = {};
      try {
        if (sub.preferences_json) {
          prefs = JSON.parse(sub.preferences_json);
        }
      } catch (err) {
        console.warn('Failed to parse subscription preferences:', err);
      }

      if (
        prefs.enabled === false ||
        prefs.notify_physical_announcements === false
      ) {
        continue;
      }

      const userPlatforms =
        prefs.platformIds && prefs.platformIds.length > 0
          ? new Set(prefs.platformIds)
          : null;

      const pas = prefs.physical_announcement_scope;
      const scopeSeeking = pas?.seeking ?? true;
      const scopeUncataloged = pas?.uncataloged ?? true;
      const scopeSpecialEditions = pas?.special_editions ?? true;
      const scopeUnowned =
        pas?.unowned ??
        (prefs.scope === 'all' || prefs.scope === 'seeking_and_unowned');

      const matchedForSub = items.filter(
        ({ game, preOrder, isSpecialEdition, isUncataloged }) => {
          if (
            userPlatforms &&
            game.platform_id &&
            !userPlatforms.has(game.platform_id)
          ) {
            return false;
          }

          if (isUncataloged) {
            return scopeUncataloged;
          }

          const userState =
            game.stable_id !== undefined
              ? userOwnershipByGame.get(`${subUserId}:${game.stable_id}`)
              : undefined;
          const subOwnershipStatus = userState?.ownership_status ?? 0;
          const subHasOwnedPhysical = userState?.has_owned_physical ?? 0;
          const subOwnedVariants = userState?.owned_variants ?? null;

          const variantAlreadyOwned = Boolean(
            isSpecialEdition &&
            preOrder.edition &&
            subOwnedVariants &&
            subOwnedVariants
              .toLowerCase()
              .includes(preOrder.edition.toLowerCase()),
          );
          if (
            subHasOwnedPhysical === 1 &&
            (!isSpecialEdition || variantAlreadyOwned)
          ) {
            return false;
          }

          if (isSpecialEdition) {
            return scopeSpecialEditions;
          }
          if (subOwnershipStatus === 2 || subOwnershipStatus === 4) {
            return scopeSeeking;
          }
          return scopeUnowned;
        },
      );

      if (matchedForSub.length === 0) continue;

      // Coalesce into a single summary notification when >3 items trigger for a subscriber
      const payloadsToSend: WebPushNotificationPayload[] = [];
      if (matchedForSub.length > 3) {
        const top = matchedForSub[0];
        const titleEdition = top.preOrder.edition
          ? ` (${top.preOrder.edition})`
          : '';
        payloadsToSend.push({
          title: `📦 ${matchedForSub.length} Physical Editions Announced`,
          body: `${top.game.title}${titleEdition} at ${top.preOrder.store} & ${matchedForSub.length - 1} more!`,
          icon: '/icons/icon-192.png',
          badge: '/icons/badge-96.png',
          data: {
            url: '/collection/games',
          },
        });
      } else {
        for (const top of matchedForSub) {
          const titleEdition = top.preOrder.edition
            ? ` (${top.preOrder.edition})`
            : '';
          const title = `📦 Physical Edition Announced: ${top.game.title}${titleEdition}`;
          const body = `Pre-order now available at ${top.preOrder.store}!`;

          const url = top.isUncataloged
            ? `/collection/games?search=${encodeURIComponent(top.preOrder.cleanTitle)}`
            : `/game/${top.game.stable_id ?? top.game.id}`;

          payloadsToSend.push({
            title,
            body,
            icon: '/icons/icon-192.png',
            badge: '/icons/badge-96.png',
            data: {
              url,
            },
          });
        }
      }

      for (const payload of payloadsToSend) {
        const result = await sendWebPushNotification(
          { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
          payload,
          {
            publicKey: env.VAPID_PUBLIC_KEY,
            privateKey: env.VAPID_PRIVATE_KEY,
            subject: resolveVapidSubject(undefined, undefined, env.ADMIN_EMAIL),
            fetchFn: fetch,
          },
        );

        if (result.success) {
          dispatchedCount++;
        } else if (result.shouldDelete) {
          await env.DB.prepare(
            'DELETE FROM push_subscriptions WHERE endpoint = ?',
          )
            .bind(sub.endpoint)
            .run();
          purgedCount++;
          break;
        }
      }
    }
  } catch (err) {
    console.error(
      '[WebPush] Error dispatching physical announcement notifications:',
      err,
    );
  }

  return { dispatchedCount, purgedCount };
}

/**
 * Scans `game_releases` for releases matching `DATE('now')` and dispatches per-user
 * launch-day push notifications once per `(user_id, release_id, release_date)` via
 * `sync_state` deduplication. Alerts only trigger for releases on the user's tracked
 * list (`Seeking`, `Priority Seeking`, `Ordered`) or—when `launch_day_scope` is
 * `'tracked_and_series'`—for unowned games matching an active `Watched Series` rule
 * in an overlapping region.
 */
export async function syncWorkerLaunchDayNotifications(env: Env): Promise<{
  dispatchedCount: number;
  purgedCount: number;
}> {
  let dispatchedCount = 0;
  let purgedCount = 0;

  try {
    const launchRows = await env.DB.prepare(
      `SELECT DISTINCT g.stable_id, g.id, g.title, g.platform_id, g.canonical_series,
              COALESCE(p.display_name, p.name) as platform_name,
              r.id as release_id, r.region as release_region, r.release_date
       FROM game_releases r
       JOIN games g ON g.stable_id = r.game_id
       JOIN platforms p ON p.id = g.platform_id
       WHERE r.release_date = DATE('now')`,
    ).all<{
      stable_id: number;
      id: string;
      title: string;
      platform_id: number;
      canonical_series: string | null;
      platform_name: string;
      release_id: string;
      release_region: string | null;
      release_date: string;
    }>();

    const allLaunchingToday = launchRows.results || [];
    if (allLaunchingToday.length === 0) {
      return { dispatchedCount: 0, purgedCount: 0 };
    }

    let subscriptions: Array<{
      user_id: number;
      home_region: string;
      endpoint: string;
      p256dh: string;
      auth: string;
      preferences_json: string | null;
    }> = [];
    try {
      const subRows = await env.DB.prepare(
        `SELECT COALESCE(ps.user_id, 1) as user_id,
                COALESCE(u.home_region, 'USA') as home_region,
                ps.endpoint, ps.p256dh, ps.auth, ps.preferences_json
         FROM push_subscriptions ps
         LEFT JOIN users u ON u.id = COALESCE(ps.user_id, 1)`,
      ).all<{
        user_id: number;
        home_region: string;
        endpoint: string;
        p256dh: string;
        auth: string;
        preferences_json: string | null;
      }>();
      subscriptions = subRows.results || [];
    } catch {
      const fallbackSubRows = await env.DB.prepare(
        `SELECT COALESCE(user_id, 1) as user_id, endpoint, p256dh, auth, preferences_json FROM push_subscriptions`,
      ).all<{
        user_id: number;
        endpoint: string;
        p256dh: string;
        auth: string;
        preferences_json: string | null;
      }>();
      subscriptions = (fallbackSubRows.results || []).map((s) => ({
        ...s,
        home_region: 'USA',
      }));
    }

    if (subscriptions.length === 0) {
      return { dispatchedCount: 0, purgedCount: 0 };
    }

    const subscribedUserIds = Array.from(
      new Set(subscriptions.map((s) => Number(s.user_id || 1))),
    );
    const launchingGameIds = Array.from(
      new Set(allLaunchingToday.map((g) => Number(g.stable_id))),
    );

    const statusByUserRelease = new Map<string, number>();
    const ownedGamesByUser = new Map<number, Set<number>>();
    try {
      const subPh = subscribedUserIds.map(() => '?').join(',');
      for (let i = 0; i < launchingGameIds.length; i += 80) {
        const gameChunk = launchingGameIds.slice(i, i + 80);
        const gamePh = gameChunk.map(() => '?').join(',');
        const ugrRows = await env.DB.prepare(
          `SELECT ugr.user_id, r.id as release_id, r.game_id as stable_id, ugr.ownership_status
           FROM user_game_releases ugr
           JOIN game_releases r ON r.id = ugr.release_id
           WHERE ugr.user_id IN (${subPh}) AND r.game_id IN (${gamePh})`,
        )
          .bind(...subscribedUserIds, ...gameChunk)
          .all<{
            user_id: number;
            release_id: string;
            stable_id: number;
            ownership_status: number;
          }>();
        for (const row of ugrRows.results || []) {
          statusByUserRelease.set(
            `${row.user_id}:${row.release_id}`,
            Number(row.ownership_status ?? 0),
          );
          if (Number(row.ownership_status) === 1) {
            let ownedSet = ownedGamesByUser.get(row.user_id);
            if (!ownedSet) {
              ownedSet = new Set<number>();
              ownedGamesByUser.set(row.user_id, ownedSet);
            }
            ownedSet.add(Number(row.stable_id));
          }
        }
      }
    } catch {
      // Minimal test schemas may omit user_game_releases
    }

    const seriesRulesByUser = new Map<number, Map<string, 'home' | 'any'>>();
    try {
      const subPh = subscribedUserIds.map(() => '?').join(',');
      const ruleRows = await env.DB.prepare(
        `SELECT user_id, match_value, region_scope
         FROM user_tracking_rules
         WHERE user_id IN (${subPh}) AND rule_type = 'series' AND is_ignored = 0`,
      )
        .bind(...subscribedUserIds)
        .all<{
          user_id: number;
          match_value: string;
          region_scope: string | null;
        }>();
      for (const rule of ruleRows.results || []) {
        const seriesKey = (rule.match_value || '').trim().toLowerCase();
        if (!seriesKey) continue;
        let userMap = seriesRulesByUser.get(rule.user_id);
        if (!userMap) {
          userMap = new Map<string, 'home' | 'any'>();
          seriesRulesByUser.set(rule.user_id, userMap);
        }
        const nextScope: 'home' | 'any' =
          rule.region_scope === 'any' || userMap.get(seriesKey) === 'any'
            ? 'any'
            : 'home';
        userMap.set(seriesKey, nextScope);
      }
    } catch {
      // Minimal test schemas may omit user_tracking_rules
    }

    const candidateDedupKeys: string[] = [];
    for (const userId of subscribedUserIds) {
      for (const rel of allLaunchingToday) {
        candidateDedupKeys.push(
          `launch_notified:${userId}:${rel.release_id}:${rel.release_date}`,
        );
      }
    }
    const alreadyNotifiedSet = new Set<string>();
    try {
      for (let i = 0; i < candidateDedupKeys.length; i += 80) {
        const chunk = candidateDedupKeys.slice(i, i + 80);
        const ph = chunk.map(() => '?').join(',');
        const existing = await env.DB.prepare(
          `SELECT key FROM sync_state WHERE key IN (${ph})`,
        )
          .bind(...chunk)
          .all<{ key: string }>();
        for (const row of existing.results || []) {
          alreadyNotifiedSet.add(row.key);
        }
      }
    } catch {
      // Minimal test schemas may omit sync_state
    }

    const succeededDedupKeys = new Set<string>();

    for (const sub of subscriptions) {
      const subUserId = Number(sub.user_id || 1);
      const subHomeRegion = sub.home_region || 'USA';
      let prefs: Partial<
        DealNotificationPreferences & {
          launch_day_scope?: 'tracked_only' | 'tracked_and_series';
        }
      > = {};
      try {
        if (sub.preferences_json) {
          prefs = JSON.parse(sub.preferences_json);
        }
      } catch (err) {
        console.warn('Failed to parse subscription preferences:', err);
      }

      if (prefs.enabled === false || prefs.notify_game_releases === false) {
        continue;
      }

      const userPlatforms =
        prefs.platformIds && prefs.platformIds.length > 0
          ? new Set(prefs.platformIds)
          : null;
      const launchScope = prefs.launch_day_scope ?? 'tracked_only';
      const userSeriesRules = seriesRulesByUser.get(subUserId);
      const userOwnedGames = ownedGamesByUser.get(subUserId);

      for (const rel of allLaunchingToday) {
        if (userPlatforms && !userPlatforms.has(rel.platform_id)) {
          continue;
        }

        const dedupKey = `launch_notified:${subUserId}:${rel.release_id}:${rel.release_date}`;
        if (alreadyNotifiedSet.has(dedupKey)) {
          continue;
        }

        const relStatus =
          statusByUserRelease.get(`${subUserId}:${rel.release_id}`) ?? 0;
        let reason: string | null = null;
        if (relStatus === 2) {
          reason = 'Seeking';
        } else if (relStatus === 3) {
          reason = 'Ordered';
        } else if (relStatus === 4) {
          reason = 'Priority Seeking';
        } else if (
          launchScope === 'tracked_and_series' &&
          rel.canonical_series &&
          !userOwnedGames?.has(rel.stable_id)
        ) {
          const ruleScope = userSeriesRules?.get(
            rel.canonical_series.trim().toLowerCase(),
          );
          if (
            ruleScope &&
            (ruleScope === 'any' ||
              regionsOverlap(rel.release_region, subHomeRegion))
          ) {
            reason = `Tracked Series: ${rel.canonical_series}`;
          }
        }

        if (!reason) {
          continue;
        }

        const regionTag = rel.release_region ? ` (${rel.release_region})` : '';
        const title = `🎉 Game Launch Day: ${rel.title}`;
        const body = `${reason}${regionTag} — releases today on ${rel.platform_name}!`;

        const payload: WebPushNotificationPayload = {
          title,
          body,
          icon: '/icons/icon-192.png',
          badge: '/icons/badge-96.png',
          data: {
            url: `/game/${rel.stable_id}`,
          },
        };

        const result = await sendWebPushNotification(
          { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
          payload,
          {
            publicKey: env.VAPID_PUBLIC_KEY,
            privateKey: env.VAPID_PRIVATE_KEY,
            subject: resolveVapidSubject(undefined, undefined, env.ADMIN_EMAIL),
            fetchFn: fetch,
          },
        );

        if (result.success) {
          dispatchedCount++;
          succeededDedupKeys.add(dedupKey);
        } else if (result.shouldDelete) {
          await env.DB.prepare(
            'DELETE FROM push_subscriptions WHERE endpoint = ?',
          )
            .bind(sub.endpoint)
            .run();
          purgedCount++;
        }
      }
    }

    if (succeededDedupKeys.size > 0) {
      try {
        const dedupStmts = Array.from(succeededDedupKeys).map((key) =>
          env.DB.prepare(
            `INSERT INTO sync_state (key, value, updated_at)
             VALUES (?, '1', datetime('now'))
             ON CONFLICT(key) DO NOTHING`,
          ).bind(key),
        );
        for (let i = 0; i < dedupStmts.length; i += 100) {
          await env.DB.batch(dedupStmts.slice(i, i + 100));
        }
      } catch {
        // Ignore in minimal schemas
      }
    }
  } catch (err) {
    console.error(
      '[WorkerPush] Error dispatching launch day notifications:',
      err,
    );
  }

  return { dispatchedCount, purgedCount };
}

/**
 * Refreshes a rolling window of up to 500 IGDB games per day (1 IGDB batch query)
 * and reconciles `canonical_series` across all games in D1 using diff-only updates.
 *
 * Uses a persistent cursor in the `sync_state` table ('igdb_sync_offset') so that:
 * 1. If an update fails, crashes, or is quota-limited, the cursor is not advanced and
 *    the following run retries the exact same batch.
 * 2. It burns only 1 row write per day to advance the cursor, plus diff-only row writes
 *    for games with actual metadata changes.
 */
export interface IgdbSeriesSyncOptions {
  batchSize?: number;
  forceSelfHeal?: boolean;
}

/**
 * Synchronizes IGDB series, franchise, and collections metadata in rolling batches
 * using primary-key cursor pagination (WHERE stable_id > ? ORDER BY stable_id ASC LIMIT 16).
 *
 * Runs every 5 minutes (288 runs/day) so that the entire catalog of ~4,340 games is refreshed
 * once every 24 hours while consuming only ~16 row reads per run (~4,600 reads/day, <0.1% of quota).
 *
 * Updates to D1 are diff-only, touching only games where collections, franchises, or canonical_series
 * actually changed upstream.
 */
interface PassiveReleaseDateCandidate {
  stableId: number;
  platformId: number;
  fallbackRegion: string | null;
  firstReleaseDate: number | string | null;
  releaseDates: IgdbReleaseDateEntry[];
}

interface TrackableHealCandidate {
  stableId: number;
  gameSlug: string;
  title: string;
  platformId: number;
  canonicalSeries: string;
  seriesTrackable: boolean;
  wasSeriesTrackable: boolean;
}

function extractIgdbCoverImageUrl(cover?: {
  image_id?: string;
  url?: string;
}): string | null {
  if (cover?.image_id) {
    return `https://images.igdb.com/igdb/image/upload/t_cover_big/${cover.image_id}.jpg`;
  }
  if (cover?.url) {
    return (
      cover.url.startsWith('//') ? `https:${cover.url}` : cover.url
    ).replace('/t_thumb/', '/t_cover_big/');
  }
  return null;
}

async function backfillMissingReleaseDatesForGames(
  env: Env,
  candidates: PassiveReleaseDateCandidate[],
  maxUpdates?: number,
): Promise<number> {
  if (!candidates || candidates.length === 0) return 0;
  try {
    const { byId: platformById } = await loadPlatformLookupMaps(env);
    const dateByGameId = new Map(candidates.map((c) => [c.stableId, c]));
    const releaseDateStatements: D1PreparedStatement[] = [];
    for (let i = 0; i < candidates.length; i += 80) {
      const chunkIds = candidates.slice(i, i + 80).map((c) => c.stableId);
      const ph = chunkIds.map(() => '?').join(',');
      const missingDateRes = await env.DB.prepare(
        `SELECT id, game_id, region, release_date FROM game_releases WHERE game_id IN (${ph})`,
      )
        .bind(...chunkIds)
        .all<{
          id: string;
          game_id: number;
          region: string | null;
          release_date: string | null;
        }>();
      for (const rel of missingDateRes.results || []) {
        if (rel.release_date) continue;
        if (
          maxUpdates !== undefined &&
          releaseDateStatements.length >= maxUpdates
        ) {
          break;
        }
        const info = dateByGameId.get(rel.game_id);
        if (!info) continue;
        const plat = platformById.get(info.platformId);
        const resolvedDate = resolveIgdbPlatformReleaseDate(
          info.releaseDates,
          plat?.igdbId ?? null,
          plat?.launchDate ?? null,
          rel.region ?? info.fallbackRegion ?? 'USA',
          info.firstReleaseDate,
        );
        if (resolvedDate) {
          releaseDateStatements.push(
            env.DB.prepare(
              `UPDATE game_releases SET release_date = ? WHERE id = ? AND release_date IS NULL`,
            ).bind(resolvedDate, rel.id),
          );
        }
      }
      if (
        maxUpdates !== undefined &&
        releaseDateStatements.length >= maxUpdates
      ) {
        break;
      }
    }
    if (releaseDateStatements.length > 0) {
      for (let i = 0; i < releaseDateStatements.length; i += 100) {
        await env.DB.batch(releaseDateStatements.slice(i, i + 100));
      }
      return releaseDateStatements.length;
    }
  } catch {
    // Ignore if game_releases / platforms are absent in minimal test schemas
  }
  return 0;
}

async function healNewlyTrackableGames(
  env: Env,
  trackableCandidates: TrackableHealCandidate[],
): Promise<number> {
  if (!trackableCandidates || trackableCandidates.length === 0) return 0;
  let selfHealedRulesCount = 0;
  try {
    const newlyTrackableOwned = trackableCandidates
      .filter((c) => !c.wasSeriesTrackable)
      .map((c) => ({
        stableId: c.stableId,
        canonicalSeries: c.canonicalSeries,
      }));
    if (newlyTrackableOwned.length > 0) {
      selfHealedRulesCount += await promoteNewlyTrackableOwnedGames(
        env,
        newlyTrackableOwned,
      );
    }

    const releasesByGameId = new Map<
      number,
      Array<{
        id: string;
        region: string | null;
        variants?: string | null;
        romName?: string | null;
      }>
    >();

    for (let i = 0; i < trackableCandidates.length; i += 80) {
      const chunk = trackableCandidates.slice(i, i + 80);
      const ids = chunk.map((c) => c.stableId);
      const ph = ids.map(() => '?').join(',');

      const relRes = await env.DB.prepare(
        `SELECT id, game_id, region, variants, rom_name FROM game_releases WHERE game_id IN (${ph})`,
      )
        .bind(...ids)
        .all<{
          id: string;
          game_id: number;
          region: string | null;
          variants: string | null;
          rom_name: string | null;
        }>();

      for (const rel of relRes.results || []) {
        let list = releasesByGameId.get(rel.game_id);
        if (!list) {
          list = [];
          releasesByGameId.set(rel.game_id, list);
        }
        list.push({
          id: rel.id,
          region: rel.region,
          variants: rel.variants,
          romName: rel.rom_name,
        });
      }
    }

    const healGames = trackableCandidates
      .filter((c) => (releasesByGameId.get(c.stableId)?.length || 0) > 0)
      .map((c) => ({
        stableId: c.stableId,
        gameSlug: c.gameSlug,
        title: c.title,
        platformId: c.platformId,
        canonicalSeries: c.canonicalSeries,
        seriesTrackable: c.seriesTrackable,
        releases: releasesByGameId.get(c.stableId) || [],
      }));

    if (healGames.length > 0) {
      selfHealedRulesCount += await evaluateTrackingRulesForNewGames(
        env,
        healGames,
        { notifySubscribers: true },
      );
    }
  } catch {
    // Ignore if tracking tables are absent in minimal test schemas
  }
  return selfHealedRulesCount;
}

export const DAILY_IGDB_RETRY_WRITE_BUDGET = 15000;
const IGDB_RETRY_TRACKED_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Hourly, write-budgeted IGDB retry job for `games` with `igdb_id IS NULL`.
 *  - Phase 1 (User-Tracked Priority): Scans tracked (`ownership_status > 0`) unmatched
 *    titles via a `CROSS JOIN` driven from `user_game_releases` (ugr.user_id > 0), then
 *    enters a 7-day cooldown once caught up.
 *  - Phase 2 (Catalog Tail): Paginates remaining unmatched catalog rows by primary key.
 * Strictly enrich-only (skips collisions where another row already holds `(igdb_id, platform_id)`)
 * and preserves custom `/covers/...` assets.
 */
export async function syncWorkerUnmatchedIgdbRetry(
  env: Env,
  options?: { batchSize?: number; forceTracked?: boolean },
): Promise<{
  phase: 'tracked' | 'catalog' | 'budget_exhausted' | 'disabled';
  scannedCount: number;
  matchedCount: number;
  updatedCount: number;
  skippedDuplicates: number;
  updatedReleaseDatesCount: number;
  selfHealedRulesCount: number;
  writesUsed: number;
  cursor: number;
}> {
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) {
    return {
      phase: 'disabled',
      scannedCount: 0,
      matchedCount: 0,
      updatedCount: 0,
      skippedDuplicates: 0,
      updatedReleaseDatesCount: 0,
      selfHealedRulesCount: 0,
      writesUsed: 0,
      cursor: 0,
    };
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const nowMs = Date.now();
  let writesUsedToday = 0;
  let trackedCursor = 0;
  let trackedCooldownUntil = 0;
  let catalogCursor = 0;

  try {
    const { results: stateRows } = await env.DB.prepare(
      `SELECT key, value FROM sync_state WHERE key IN (
         'igdb_retry_daily_writes',
         'igdb_retry_tracked_cursor',
         'igdb_retry_tracked_cooldown_until',
         'igdb_retry_catalog_cursor'
       )`,
    ).all<{ key: string; value: string }>();
    for (const row of stateRows || []) {
      if (row.key === 'igdb_retry_daily_writes' && row.value) {
        try {
          const parsed = JSON.parse(row.value) as {
            date?: string;
            writes?: number;
          };
          if (parsed.date === todayStr) {
            writesUsedToday = Math.max(0, Number(parsed.writes) || 0);
          }
        } catch {
          // ignore malformed JSON
        }
      } else if (row.key === 'igdb_retry_tracked_cursor' && row.value) {
        trackedCursor = Math.max(0, parseInt(row.value, 10) || 0);
      } else if (row.key === 'igdb_retry_tracked_cooldown_until' && row.value) {
        trackedCooldownUntil = Math.max(0, parseInt(row.value, 10) || 0);
      } else if (row.key === 'igdb_retry_catalog_cursor' && row.value) {
        catalogCursor = Math.max(0, parseInt(row.value, 10) || 0);
      }
    }
  } catch {
    // sync_state may not exist yet
  }

  if (writesUsedToday + 8 > DAILY_IGDB_RETRY_WRITE_BUDGET) {
    return {
      phase: 'budget_exhausted',
      scannedCount: 0,
      matchedCount: 0,
      updatedCount: 0,
      skippedDuplicates: 0,
      updatedReleaseDatesCount: 0,
      selfHealedRulesCount: 0,
      writesUsed: 0,
      cursor: catalogCursor,
    };
  }

  interface RetryGameRow {
    stable_id: number;
    id: string;
    title: string;
    platform_id: number;
    region: string | null;
    image_url: string | null;
    summary: string | null;
    genres: string | null;
    igdb_url: string | null;
    collections: string | null;
    franchises: string | null;
    canonical_series: string | null;
    metadata_json: string | null;
  }

  let activePhase: 'tracked' | 'catalog' =
    !options?.forceTracked && trackedCooldownUntil > nowMs
      ? 'catalog'
      : 'tracked';
  const trackedLimit = Math.min(30, Math.max(1, options?.batchSize ?? 20));
  const catalogLimit = Math.min(30, Math.max(1, options?.batchSize ?? 30));
  let activeLimit = activePhase === 'tracked' ? trackedLimit : catalogLimit;
  let rows: RetryGameRow[] = [];
  let setTrackedCooldownAfterEmpty = false;

  if (activePhase === 'tracked') {
    const trackedRes = await env.DB.prepare(
      `SELECT DISTINCT g.stable_id, g.id, g.title, g.platform_id, g.region, g.image_url, g.summary, g.genres, g.igdb_url, g.collections, g.franchises, g.canonical_series, g.metadata_json
       FROM user_game_releases ugr
       CROSS JOIN game_releases r ON r.id = ugr.release_id
       CROSS JOIN games g ON g.stable_id = r.game_id
       WHERE ugr.user_id > 0
         AND ugr.ownership_status > 0
         AND g.igdb_id IS NULL
         AND COALESCE(g.manually_verified, 0) = 0
         AND g.stable_id > ?
       ORDER BY g.stable_id ASC
       LIMIT ?`,
    )
      .bind(trackedCursor, trackedLimit)
      .all<RetryGameRow>();
    rows = trackedRes.results || [];
    if (rows.length === 0) {
      setTrackedCooldownAfterEmpty = true;
      activePhase = 'catalog';
      activeLimit = catalogLimit;
    }
  }

  if (activePhase === 'catalog') {
    const catRes = await env.DB.prepare(
      `SELECT stable_id, id, title, platform_id, region, image_url, summary, genres, igdb_url, collections, franchises, canonical_series, metadata_json
       FROM games
       WHERE igdb_id IS NULL
         AND COALESCE(manually_verified, 0) = 0
         AND stable_id > ?
       ORDER BY stable_id ASC
       LIMIT ?`,
    )
      .bind(catalogCursor, catalogLimit)
      .all<RetryGameRow>();
    rows = catRes.results || [];
  }

  if (rows.length === 0) {
    const stateStmts: D1PreparedStatement[] = [];
    if (setTrackedCooldownAfterEmpty) {
      const nextCd = nowMs + IGDB_RETRY_TRACKED_COOLDOWN_MS;
      stateStmts.push(
        env.DB.prepare(
          `INSERT INTO sync_state (key, value, updated_at)
           VALUES ('igdb_retry_tracked_cursor', '0', CURRENT_TIMESTAMP)
           ON CONFLICT(key) DO UPDATE SET value = '0', updated_at = CURRENT_TIMESTAMP`,
        ),
        env.DB.prepare(
          `INSERT INTO sync_state (key, value, updated_at)
           VALUES ('igdb_retry_tracked_cooldown_until', ?, CURRENT_TIMESTAMP)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
        ).bind(String(nextCd)),
      );
    }
    if (activePhase === 'catalog' && catalogCursor > 0) {
      stateStmts.push(
        env.DB.prepare(
          `INSERT INTO sync_state (key, value, updated_at)
           VALUES ('igdb_retry_catalog_cursor', '0', CURRENT_TIMESTAMP)
           ON CONFLICT(key) DO UPDATE SET value = '0', updated_at = CURRENT_TIMESTAMP`,
        ),
      );
    }
    if (stateStmts.length > 0) {
      await env.DB.batch(stateStmts);
    }
    return {
      phase: activePhase,
      scannedCount: 0,
      matchedCount: 0,
      updatedCount: 0,
      skippedDuplicates: 0,
      updatedReleaseDatesCount: 0,
      selfHealedRulesCount: 0,
      writesUsed: 0,
      cursor: 0,
    };
  }

  const { byId: platformById } = await loadPlatformLookupMaps(env);
  const lookupItems: Array<{
    key: string;
    title: string;
    normalizedTitle: string;
    igdbPlatformId: number | null;
    trackerPlatformId?: number | null;
    platformLaunchDate?: string | null;
  }> = [];

  for (const row of rows) {
    if (isIgnoredFormatRelease(row.title, '', row.platform_id)) continue;
    const plat = platformById.get(row.platform_id);
    if (!plat?.igdbId || plat.igdbId <= 0) continue;
    const cleanTitle = cleanTitleForIgdbLookup(row.title) || row.title;
    const normTitle =
      normalizeForIgdbMatch(cleanTitle) ||
      normalizeTitleForMatching(cleanTitle);
    if (!normTitle) continue;
    lookupItems.push({
      key: String(row.stable_id),
      title: row.title,
      normalizedTitle: normTitle,
      igdbPlatformId: plat.igdbId,
      trackerPlatformId: plat.id,
      platformLaunchDate: plat.launchDate,
    });
  }

  const igdbMetaMap =
    lookupItems.length > 0
      ? await fetchIgdbMetadataForTitles(env, lookupItems)
      : new Map<string, IgdbGameMeta>();

  let tickWritesUsed = 0;
  let updatedCount = 0;
  let skippedDuplicates = 0;
  let stoppedOnBudget = false;
  let lastAttemptedStableId = rows[rows.length - 1].stable_id;
  const updateStatements: D1PreparedStatement[] = [];
  const dateBackfillCandidates: PassiveReleaseDateCandidate[] = [];
  const trackableCandidates: TrackableHealCandidate[] = [];

  for (const game of rows) {
    const meta = igdbMetaMap.get(String(game.stable_id));
    if (!meta) continue;

    if (writesUsedToday + tickWritesUsed + 8 > DAILY_IGDB_RETRY_WRITE_BUDGET) {
      stoppedOnBudget = true;
      lastAttemptedStableId = Math.max(0, game.stable_id - 1);
      break;
    }

    const dupRow = await env.DB.prepare(
      `SELECT stable_id
       FROM games
       WHERE igdb_id = ? AND igdb_id IS NOT NULL AND +platform_id = ? AND stable_id != ?
       LIMIT 1`,
    )
      .bind(meta.igdb_id, game.platform_id, game.stable_id)
      .first<{ stable_id: number }>();
    if (dupRow?.stable_id) {
      skippedDuplicates++;
      continue;
    }

    const nextImageUrl =
      game.image_url && game.image_url.startsWith('/')
        ? game.image_url
        : (meta.image_url ?? game.image_url ?? null);
    const nextSummary = meta.summary ?? game.summary ?? null;
    const nextGenres = meta.genres ?? game.genres ?? null;
    const nextIgdbUrl = meta.igdb_url ?? game.igdb_url ?? null;
    const nextCollections = meta.collections ?? game.collections ?? null;
    const nextFranchises = meta.franchises ?? game.franchises ?? null;
    const nextCanonicalSeries = computeGameCanonicalSeries({
      title: game.title,
      collections: nextCollections || undefined,
      franchises: nextFranchises || undefined,
    });
    const nextMetaJson = meta.metadata_json ?? game.metadata_json ?? null;

    updateStatements.push(
      env.DB.prepare(
        `UPDATE games
         SET igdb_id = ?,
             igdb_url = ?,
             image_url = ?,
             summary = ?,
             genres = ?,
             collections = ?,
             franchises = ?,
             canonical_series = ?,
             metadata_json = ?
         WHERE stable_id = ? AND igdb_id IS NULL`,
      ).bind(
        meta.igdb_id,
        nextIgdbUrl,
        nextImageUrl,
        nextSummary,
        nextGenres,
        nextCollections,
        nextFranchises,
        nextCanonicalSeries,
        nextMetaJson,
        game.stable_id,
      ),
    );
    tickWritesUsed += 8;
    updatedCount++;

    if (
      meta.first_release_date != null ||
      (meta.release_dates && meta.release_dates.length > 0)
    ) {
      dateBackfillCandidates.push({
        stableId: game.stable_id,
        platformId: game.platform_id,
        fallbackRegion: game.region ?? null,
        firstReleaseDate: meta.first_release_date,
        releaseDates: meta.release_dates || [],
      });
    }

    const wasTrackable = isSeriesTrackable({
      title: game.title,
      collections: game.collections,
      franchises: game.franchises,
    });
    if (
      nextCanonicalSeries &&
      isSeriesTrackable({
        title: game.title,
        collections: nextCollections,
        franchises: nextFranchises,
      })
    ) {
      trackableCandidates.push({
        stableId: game.stable_id,
        gameSlug: game.id,
        title: game.title,
        platformId: game.platform_id,
        canonicalSeries: nextCanonicalSeries,
        seriesTrackable: true,
        wasSeriesTrackable: wasTrackable,
      });
    }
  }

  for (let i = 0; i < updateStatements.length; i += 100) {
    await env.DB.batch(updateStatements.slice(i, i + 100));
  }

  const remainingForDates = Math.max(
    0,
    Math.floor(
      (DAILY_IGDB_RETRY_WRITE_BUDGET - writesUsedToday - tickWritesUsed) / 7,
    ),
  );
  const releaseDateUpdatesCount =
    remainingForDates > 0
      ? await backfillMissingReleaseDatesForGames(
          env,
          dateBackfillCandidates,
          remainingForDates,
        )
      : 0;
  tickWritesUsed += releaseDateUpdatesCount * 7;

  const selfHealedRulesCount = await healNewlyTrackableGames(
    env,
    trackableCandidates,
  );
  tickWritesUsed += selfHealedRulesCount * 2;

  const reachedEndOfPass = !stoppedOnBudget && rows.length < activeLimit;
  const nextCursor = reachedEndOfPass ? 0 : lastAttemptedStableId;
  const stateStmts: D1PreparedStatement[] = [];

  if (activePhase === 'tracked') {
    stateStmts.push(
      env.DB.prepare(
        `INSERT INTO sync_state (key, value, updated_at)
         VALUES ('igdb_retry_tracked_cursor', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      ).bind(String(nextCursor)),
    );
    if (reachedEndOfPass) {
      stateStmts.push(
        env.DB.prepare(
          `INSERT INTO sync_state (key, value, updated_at)
           VALUES ('igdb_retry_tracked_cooldown_until', ?, CURRENT_TIMESTAMP)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
        ).bind(String(nowMs + IGDB_RETRY_TRACKED_COOLDOWN_MS)),
      );
    }
  } else {
    if (setTrackedCooldownAfterEmpty) {
      stateStmts.push(
        env.DB.prepare(
          `INSERT INTO sync_state (key, value, updated_at)
           VALUES ('igdb_retry_tracked_cursor', '0', CURRENT_TIMESTAMP)
           ON CONFLICT(key) DO UPDATE SET value = '0', updated_at = CURRENT_TIMESTAMP`,
        ),
        env.DB.prepare(
          `INSERT INTO sync_state (key, value, updated_at)
           VALUES ('igdb_retry_tracked_cooldown_until', ?, CURRENT_TIMESTAMP)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
        ).bind(String(nowMs + IGDB_RETRY_TRACKED_COOLDOWN_MS)),
      );
    }
    stateStmts.push(
      env.DB.prepare(
        `INSERT INTO sync_state (key, value, updated_at)
         VALUES ('igdb_retry_catalog_cursor', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      ).bind(String(nextCursor)),
    );
  }

  stateStmts.push(
    env.DB.prepare(
      `INSERT INTO sync_state (key, value, updated_at)
       VALUES ('igdb_retry_daily_writes', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    ).bind(
      JSON.stringify({
        date: todayStr,
        writes: writesUsedToday + tickWritesUsed,
      }),
    ),
  );

  await env.DB.batch(stateStmts);

  if (
    updatedCount > 0 ||
    releaseDateUpdatesCount > 0 ||
    selfHealedRulesCount > 0
  ) {
    await invalidateCatalogManifest(env);
    await markDbDirty(env);
  }

  return {
    phase: activePhase,
    scannedCount: rows.length,
    matchedCount: igdbMetaMap.size,
    updatedCount,
    skippedDuplicates,
    updatedReleaseDatesCount: releaseDateUpdatesCount,
    selfHealedRulesCount,
    writesUsed: tickWritesUsed,
    cursor: nextCursor,
  };
}

export async function syncWorkerIgdbSeriesAndCanonical(
  env: Env,
  options?: IgdbSeriesSyncOptions,
): Promise<{
  refreshedIgdbCount: number;
  updatedGamesCount: number;
  selfHealedRulesCount?: number;
  updatedReleaseDatesCount?: number;
  cursorOffset?: number;
}> {
  const batchSize = options?.batchSize ?? 100;

  // 1. Read persistent sync bookmark cursor and cumulative rolling stats from sync_state
  let lastStableId = 0;
  let prevRollingStats = {
    refreshedTotal: 0,
    updatedTotal: 0,
    selfHealedRulesTotal: 0,
  };
  try {
    const { results: stateRows } = await env.DB.prepare(
      `SELECT key, value FROM sync_state WHERE key IN ('igdb_sync_offset', 'igdb_rolling_stats')`,
    ).all<{ key: string; value: string }>();
    for (const row of stateRows || []) {
      if (row.key === 'igdb_sync_offset' && row.value) {
        const parsed = parseInt(row.value, 10);
        if (Number.isFinite(parsed) && parsed >= 0) {
          lastStableId = parsed;
        }
      } else if (row.key === 'igdb_rolling_stats' && row.value) {
        try {
          const parsed = JSON.parse(row.value) as {
            refreshedTotal?: number;
            updatedTotal?: number;
            selfHealedRulesTotal?: number;
          };
          prevRollingStats = {
            refreshedTotal: Number(parsed?.refreshedTotal) || 0,
            updatedTotal: Number(parsed?.updatedTotal) || 0,
            selfHealedRulesTotal: Number(parsed?.selfHealedRulesTotal) || 0,
          };
        } catch {
          // ignore malformed JSON
        }
      }
    }
  } catch {
    // sync_state table may not exist yet in unmigrated environments
  }

  interface RollingGameRow {
    stable_id: number;
    id: string;
    title: string;
    platform_id: number;
    region?: string | null;
    igdb_id: number | null;
    collections: string | null;
    franchises: string | null;
    canonical_series: string | null;
    metadata_json?: string | null;
    summary?: string | null;
    image_url?: string | null;
    genres?: string | null;
    igdb_url?: string | null;
    manually_verified?: number | null;
  }

  // 2. Query next incremental slice of games using primary key index
  let { results: batchResults } = await env.DB.prepare(
    `SELECT stable_id, id, title, platform_id, region, igdb_id, collections, franchises, canonical_series, metadata_json, summary, image_url, genres, igdb_url, manually_verified
     FROM games
     WHERE stable_id > ?
     ORDER BY stable_id ASC
     LIMIT ?`,
  )
    .bind(lastStableId, batchSize)
    .all<RollingGameRow>();

  let isEndOfTable = false;
  if (!batchResults || batchResults.length === 0) {
    // Reached the end of the collection; wrap around to beginning
    const wrapRes = await env.DB.prepare(
      `SELECT stable_id, id, title, platform_id, region, igdb_id, collections, franchises, canonical_series, metadata_json, summary, image_url, genres, igdb_url, manually_verified
       FROM games
       WHERE stable_id > 0
       ORDER BY stable_id ASC
       LIMIT ?`,
    )
      .bind(batchSize)
      .all<RollingGameRow>();
    batchResults = wrapRes.results || [];
    isEndOfTable = false;
  } else if (batchResults.length < batchSize) {
    isEndOfTable = true;
  }

  const batchGames = batchResults || [];
  if (batchGames.length === 0) {
    return {
      refreshedIgdbCount: 0,
      updatedGamesCount: 0,
      selfHealedRulesCount: 0,
      cursorOffset: 0,
    };
  }

  // 3. Query upcoming games (release_date >= DATE('now')) to keep pre-release metadata synchronized
  let trackedUpcomingGames: RollingGameRow[] = [];
  try {
    const upcomingRes = await env.DB.prepare(
      `SELECT DISTINCT g.stable_id, g.id, g.title, g.platform_id, g.region, g.igdb_id, g.collections, g.franchises, g.canonical_series, g.metadata_json, g.summary, g.image_url, g.genres, g.igdb_url, g.manually_verified
       FROM game_releases r
       CROSS JOIN games g ON g.stable_id = r.game_id
       WHERE r.release_date >= DATE('now')
         AND g.igdb_id IS NOT NULL AND g.igdb_id > 0
       LIMIT 100`,
    ).all<RollingGameRow>();
    trackedUpcomingGames = upcomingRes.results || [];
  } catch {
    // Graceful fallback if game_releases.release_date is absent in minimal test schemas
  }

  // Combine batch games + tracked upcoming games, deduplicated by stable_id
  const candidateGamesMap = new Map<number, RollingGameRow>();
  for (const g of batchGames) {
    candidateGamesMap.set(g.stable_id, g);
  }
  for (const g of trackedUpcomingGames) {
    if (!candidateGamesMap.has(g.stable_id)) {
      candidateGamesMap.set(g.stable_id, g);
    }
  }
  const candidateGames = Array.from(candidateGamesMap.values());

  const igdbIdsToQuery = Array.from(
    new Set(
      candidateGames
        .map((g) => Number(g.igdb_id))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  );

  const igdbFreshMap = new Map<
    number,
    {
      collections: string | null;
      franchises: string | null;
      metadataJson: string | null;
      summary: string | null;
      imageUrl: string | null;
      genres: string | null;
      igdbUrl: string | null;
      firstReleaseDate: number | string | null;
      releaseDates: IgdbReleaseDateEntry[];
    }
  >();

  if (
    igdbIdsToQuery.length > 0 &&
    env.TWITCH_CLIENT_ID &&
    env.TWITCH_CLIENT_SECRET
  ) {
    const igdbQuery = `fields id, url, summary, cover.image_id, cover.url, genres.name, collections.name, franchises.name, first_release_date, release_dates.platform, release_dates.region, release_dates.release_region, release_dates.date, alternative_names.name, alternative_names.comment, game_localizations.name, game_localizations.region; where id = (${igdbIdsToQuery.join(',')}); limit ${igdbIdsToQuery.length};`;
    const rawIgdb = (await queryIGDBEdge('games', igdbQuery, env)) as Array<{
      id: number;
      url?: string;
      summary?: string;
      cover?: { image_id?: string; url?: string };
      genres?: Array<{ name: string }>;
      collections?: Array<{ name: string }>;
      franchises?: Array<{ name: string }>;
      first_release_date?: number | string | null;
      release_dates?: IgdbReleaseDateEntry[];
      alternative_names?: Array<{ name: string; comment?: string }>;
      game_localizations?: Array<{ name: string; region?: number }>;
    }>;

    for (const item of rawIgdb || []) {
      const collections =
        item.collections && item.collections.length > 0
          ? item.collections.map((c) => c.name).join(', ')
          : null;
      const franchises =
        item.franchises && item.franchises.length > 0
          ? item.franchises.map((f) => f.name).join(', ')
          : null;
      const genres =
        item.genres && item.genres.length > 0
          ? item.genres.map((g) => g.name).join(', ')
          : null;
      const metadataJson =
        (item.game_localizations && item.game_localizations.length > 0) ||
        (item.alternative_names && item.alternative_names.length > 0)
          ? JSON.stringify({
              game_localizations: item.game_localizations || [],
              alternative_names: item.alternative_names || [],
            })
          : null;
      igdbFreshMap.set(item.id, {
        collections,
        franchises,
        metadataJson,
        summary: item.summary?.trim() || null,
        imageUrl: extractIgdbCoverImageUrl(item.cover),
        genres,
        igdbUrl: item.url?.trim() || null,
        firstReleaseDate: item.first_release_date ?? null,
        releaseDates: item.release_dates || [],
      });
    }
  }

  const gameUpdateStatements: D1PreparedStatement[] = [];
  const trackableCandidates: TrackableHealCandidate[] = [];
  const dateBackfillCandidates: PassiveReleaseDateCandidate[] = [];

  for (const game of candidateGames) {
    const numericIgdbId = Number(game.igdb_id);
    const fresh =
      Number.isFinite(numericIgdbId) && numericIgdbId > 0
        ? igdbFreshMap.get(numericIgdbId)
        : undefined;

    const nextCollections = fresh?.collections ?? game.collections ?? null;
    const nextFranchises = fresh?.franchises ?? game.franchises ?? null;
    const nextCanonicalSeries = computeGameCanonicalSeries({
      title: game.title,
      collections: nextCollections || undefined,
      franchises: nextFranchises || undefined,
    });
    const isManuallyVerified = Number(game.manually_verified ?? 0) === 1;
    const hasLocalCover = Boolean(
      game.image_url && game.image_url.startsWith('/'),
    );
    const nextSummary = isManuallyVerified
      ? (game.summary ?? fresh?.summary ?? null)
      : (fresh?.summary ?? game.summary ?? null);
    const nextImageUrl = hasLocalCover
      ? game.image_url!
      : isManuallyVerified
        ? (game.image_url ?? fresh?.imageUrl ?? null)
        : (fresh?.imageUrl ?? game.image_url ?? null);
    const nextGenres = isManuallyVerified
      ? (game.genres ?? fresh?.genres ?? null)
      : (fresh?.genres ?? game.genres ?? null);
    const nextIgdbUrl = fresh?.igdbUrl ?? game.igdb_url ?? null;

    const metadataChanged =
      Boolean(fresh?.metadataJson) &&
      fresh?.metadataJson !== (game.metadata_json ?? null);
    const seriesChanged =
      nextCollections !== (game.collections ?? null) ||
      nextFranchises !== (game.franchises ?? null) ||
      nextCanonicalSeries !== (game.canonical_series ?? null);
    const profileFieldsChanged =
      nextSummary !== (game.summary ?? null) ||
      nextImageUrl !== (game.image_url ?? null) ||
      nextGenres !== (game.genres ?? null) ||
      nextIgdbUrl !== (game.igdb_url ?? null);

    const wasTrackable = isSeriesTrackable({
      title: game.title,
      collections: game.collections,
      franchises: game.franchises,
    });

    if (
      (seriesChanged || options?.forceSelfHeal) &&
      nextCanonicalSeries &&
      isSeriesTrackable({
        title: game.title,
        collections: nextCollections,
        franchises: nextFranchises,
      })
    ) {
      trackableCandidates.push({
        stableId: game.stable_id,
        gameSlug: game.id,
        title: game.title,
        platformId: game.platform_id,
        canonicalSeries: nextCanonicalSeries,
        seriesTrackable: true,
        wasSeriesTrackable: wasTrackable,
      });
    }

    if (
      fresh &&
      (fresh.firstReleaseDate != null || fresh.releaseDates.length > 0)
    ) {
      dateBackfillCandidates.push({
        stableId: game.stable_id,
        platformId: game.platform_id,
        fallbackRegion: game.region ?? null,
        firstReleaseDate: fresh.firstReleaseDate,
        releaseDates: fresh.releaseDates,
      });
    }

    if (seriesChanged || metadataChanged || profileFieldsChanged) {
      gameUpdateStatements.push(
        env.DB.prepare(
          `UPDATE games
           SET collections = ?,
               franchises = ?,
               canonical_series = ?,
               metadata_json = COALESCE(?, metadata_json),
               summary = ?,
               image_url = ?,
               genres = ?,
               igdb_url = ?
           WHERE stable_id = ?`,
        ).bind(
          nextCollections,
          nextFranchises,
          nextCanonicalSeries,
          fresh?.metadataJson ?? null,
          nextSummary,
          nextImageUrl,
          nextGenres,
          nextIgdbUrl,
          game.stable_id,
        ),
      );
    }
  }

  // Persist game metadata/canonical_series updates before rule promotion and healing
  // so sibling queries read the refreshed canonical series.
  const gameUpdatesCount = gameUpdateStatements.length;
  if (gameUpdateStatements.length > 0) {
    const CHUNK_SIZE = 100;
    for (let i = 0; i < gameUpdateStatements.length; i += CHUNK_SIZE) {
      await env.DB.batch(gameUpdateStatements.slice(i, i + CHUNK_SIZE));
    }
  }

  // Passively backfill missing game_releases.release_date values using the already-fetched
  // IGDB response (0 extra IGDB subrequests; touches only rows with release_date IS NULL).
  const releaseDateUpdatesCount = await backfillMissingReleaseDatesForGames(
    env,
    dateBackfillCandidates,
  );

  // Rolling self-healing: promote newly-sequelized owned standalone games first,
  // then evaluate active user_tracking_rules for unowned trackable games in this batch.
  const selfHealedRulesCount = await healNewlyTrackableGames(
    env,
    trackableCandidates,
  );

  // Advance the persistent cursor
  const nextOffset = isEndOfTable
    ? 0
    : batchGames[batchGames.length - 1].stable_id;

  const updatedRollingStats = {
    refreshedTotal: prevRollingStats.refreshedTotal + igdbFreshMap.size,
    updatedTotal: prevRollingStats.updatedTotal + gameUpdatesCount,
    selfHealedRulesTotal:
      prevRollingStats.selfHealedRulesTotal + selfHealedRulesCount,
    lastRunAt: new Date().toISOString(),
  };

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO sync_state (key, value, updated_at)
       VALUES ('igdb_sync_offset', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).bind(String(nextOffset)),
    env.DB.prepare(
      `INSERT INTO sync_state (key, value, updated_at)
       VALUES ('igdb_rolling_stats', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    ).bind(JSON.stringify(updatedRollingStats)),
  ]);
  if (
    gameUpdatesCount > 0 ||
    selfHealedRulesCount > 0 ||
    releaseDateUpdatesCount > 0
  ) {
    await markDbDirty(env);
  }

  return {
    refreshedIgdbCount: igdbFreshMap.size,
    updatedGamesCount: gameUpdatesCount + 1,
    selfHealedRulesCount,
    updatedReleaseDatesCount: releaseDateUpdatesCount,
    cursorOffset: nextOffset,
  };
}

export const DAILY_CATALOG_WRITE_BUDGET = 60000;

export interface IgdbGameMeta {
  igdb_id: number;
  name: string | null;
  igdb_url: string | null;
  image_url: string | null;
  summary: string | null;
  genres: string | null;
  collections: string | null;
  franchises: string | null;
  first_release_date: number | string | null;
  release_dates: IgdbReleaseDateEntry[];
  metadata_json: string | null;
}

export interface IgdbSearchCandidate {
  id: number;
  name?: string;
  url?: string;
  summary?: string;
  first_release_date?: number | string | null;
  category?: number;
  game_type?: number;
  cover?: { image_id?: string; url?: string };
  genres?: Array<{ name: string }>;
  collections?: Array<{ name: string }>;
  franchises?: Array<{ name: string }>;
  platforms?: Array<number | { id: number }>;
  alternative_names?: Array<{ name: string; comment?: string }>;
  game_localizations?: Array<{ name?: string; region?: number }>;
  release_dates?: IgdbReleaseDateEntry[];
  remasters?: Array<number | IgdbRelatedEditionRef>;
  expanded_games?: Array<number | IgdbRelatedEditionRef>;
  ports?: Array<number | IgdbRelatedEditionRef>;
}

const IGDB_MULTIQUERY_MAX = 10;

const IGDB_SEARCH_STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'in',
  'of',
  'for',
  'with',
  'on',
  'at',
  'to',
  'by',
  'or',
  'from',
  'version',
  'edition',
  'vs',
  'vol',
  'volume',
  'featuring',
  'ft',
  'presents',
  'disney',
  'sega',
  'nintendo',
  'sony',
  'microsoft',
  'capcom',
  'konami',
  'namco',
  'square',
  'enix',
  'atari',
  'ubisoft',
  'ea',
  'marvel',
  'sid',
  'meier',
  'meiers',
  'tom',
  'clancy',
  'clancys',
  'lego',
  'nickelodeon',
  'lara',
  'croft',
  'walt',
  'pictures',
  'dreamworks',
  'hedgehog',
  'ds',
  'gba',
  'gbc',
  'n64',
  'nes',
  'snes',
  'ps3',
  'ps2',
  'ps1',
  'wii',
  'xbox',
  '3ds',
  'ps4',
  'ps5',
  'psvr',
  'psvr2',
  'nsw',
  'nsw2',
]);

function sanitizeIgdbSearchTerm(title: string): string {
  return (title || '')
    .replace(/["\\]/g, '')
    .replace(/[\r\n;{}]/g, ' ')
    .trim();
}

const INTERCHANGEABLE_FIRST_NUMERAL_RE = /^(?:1|i)$/i;
const INTERCHANGEABLE_SMALL_NUMERAL_RE = /^(?:[2-4]|ii|iii|iv)$/i;

/**
 * Extracts up to 4 longest significant alphanumeric tokens for IGDB `multiquery`
 * substring predicates so DAT punctuation differences (like `" - "` vs `":"`),
 * stripped edition/retail wrappers, dual-region ` ~ ` splits, and Roman/Arabic
 * sequel numerals still match upstream IGDB entries.
 */
export function buildIgdbSearchTokens(title: string): string[] {
  const rawLookup = cleanTitleForIgdbLookup(title || '') || title || '';
  const halves = rawLookup
    .split(/\s+~\s+/)
    .map((h) => h.trim())
    .filter(Boolean);
  const preferredHalf =
    halves.length > 1
      ? halves.find((h, idx) => idx > 0 && /[a-z]/i.test(h)) || halves[0]
      : halves[0] || rawLookup;
  const wrapperStripped =
    stripIgdbEditionWrapper(preferredHalf) || preferredHalf;

  const cleaned = wrapperStripped
    .replace(/[\u2018\u2019\u201B\u2032`]/g, "'")
    .replace(/'s\b/gi, '')
    .replace(/["\\]/g, '');
  const raw = cleaned.match(/[\p{L}\p{N}]+/gu) || [];
  const filtered = raw.filter(
    (t) =>
      (t.length >= 2 || /^\p{N}$/u.test(t)) &&
      !IGDB_SEARCH_STOPWORDS.has(t.toLowerCase()),
  );
  let pool = filtered.length > 0 ? filtered : raw.filter((t) => t.length >= 1);

  // Drop interchangeable sequel numerals ('1'/'I' when >=2 non-numeral tokens remain,
  // or small '2'-'4'/'II'-'IV' when >=3 non-numeral tokens remain) so Roman vs Arabic
  // differences don't block IGDB substring search, while keeping two-digit sports years ('06').
  const nonNumeralCount = pool.filter(
    (t) =>
      !INTERCHANGEABLE_FIRST_NUMERAL_RE.test(t) &&
      !INTERCHANGEABLE_SMALL_NUMERAL_RE.test(t) &&
      !/^\d+$/.test(t),
  ).length;
  if (nonNumeralCount >= 2) {
    const withoutInterchangeable = pool.filter((t) => {
      if (INTERCHANGEABLE_FIRST_NUMERAL_RE.test(t)) return false;
      if (nonNumeralCount >= 3 && INTERCHANGEABLE_SMALL_NUMERAL_RE.test(t)) {
        return false;
      }
      return true;
    });
    if (withoutInterchangeable.length > 0) {
      pool = withoutInterchangeable;
    }
  }

  if (pool.length === 0) {
    pool = [sanitizeIgdbSearchTerm(title)].filter(Boolean);
  }
  const uniq: string[] = [];
  const seen = new Set<string>();
  for (const t of pool) {
    const key = t.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      uniq.push(t);
    }
  }
  uniq.sort((a, b) => b.length - a.length);
  return uniq.slice(0, 4);
}

const NON_MAINLINE_IGDB_CATEGORIES = new Set<number>([1, 2, 5, 6, 7, 13, 14]);
const MODERN_BOUTIQUE_IGDB_PLATFORMS = new Set<number>([
  48, 49, 130, 167, 169, 508,
]);
const BENIGN_TIER3_SUBTITLE_RE =
  /^(?:the\s+(?:official\s+)?video\s*game|the\s+game|the\s+legend\s+returns|your\s+personal\s+trainer|challenge|six\s+ways\s+to\s+get\s+in\s+shape|the\s+sith\s+lords|hell\s+on\s+earth)$/i;

const BENIGN_TIER3B_QUERY_SUBTITLE_RE =
  /^(?:the\s+official\s+(?:video\s*)?game(?:\s+of\b.*)?|the\s+(?:video\s*)?game|a\s+telltale\s+games?\s+series|a\s+comedy\s+adventure|learn\s+a\s+new\s+language|improve\s+your\s+health|the\s+prelude\s+to\s+the\s+lord\s+of\s+the\s+rings|the\s+complete\s+(?:first\s+season|adventure)|the\s+midnight\s+carnival|music\s+is\s+the\s+weapon|peace\s+has\s+a\s+price\.{0,3}|deluxe\s+series|racing\s+game\s+of\s+the\s+year|ultimate\s+collection|bush\s+rescue\s+bundle|perfect\s+attendance\s+collection)$/i;

function isMainlineOrRemasterCandidate(c: IgdbSearchCandidate): boolean {
  if (
    c.game_type != null &&
    NON_MAINLINE_IGDB_CATEGORIES.has(Number(c.game_type))
  ) {
    return false;
  }
  if (
    c.category != null &&
    NON_MAINLINE_IGDB_CATEGORIES.has(Number(c.category))
  ) {
    return false;
  }
  return true;
}

function splitTitlePrefixAndSubtitle(
  title: string,
): { prefix: string; subtitle: string } | null {
  const m = (title || '')
    .trim()
    .match(/^([^:–—-]+?)\s*(?::|\s+[-–—]\s+)\s*(.+)$/);
  if (!m) return null;
  return { prefix: m[1].trim(), subtitle: m[2].trim() };
}

function splitTrailingSubtitle(
  title: string,
): { prefix: string; subtitle: string } | null {
  const trimmed = (title || '').trim();
  const colonMatches = Array.from(trimmed.matchAll(/\s*:\s+/g));
  const dashMatches = Array.from(trimmed.matchAll(/\s+[-–—]\s+/g));
  let bestIdx = -1;
  let bestLen = 0;
  for (const m of [...colonMatches, ...dashMatches]) {
    if (m.index !== undefined && m.index > bestIdx) {
      bestIdx = m.index;
      bestLen = m[0].length;
    }
  }
  if (bestIdx <= 0) return null;
  const prefix = trimmed.slice(0, bestIdx).trim();
  const subtitle = trimmed.slice(bestIdx + bestLen).trim();
  if (!prefix || !subtitle) return null;
  return { prefix, subtitle };
}

function extractBenignPrefixCandidates(title: string): string[] {
  const prefixes: string[] = [];
  let cur = (title || '').trim();
  for (let i = 0; i < 3; i++) {
    const split = splitTrailingSubtitle(cur);
    if (!split || !BENIGN_TIER3B_QUERY_SUBTITLE_RE.test(split.subtitle)) break;
    prefixes.push(split.prefix);
    cur = split.prefix;
  }
  return prefixes;
}

function hasDistinctiveShortTitle(title: string): boolean {
  const trimmed = (title || '').trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return true;
  return trimmed.length >= 5 && extractTitleSequelSignature(trimmed).length > 0;
}

/**
 * 3-tier strict IGDB candidate selector with sequel-parity and ambiguity rejection:
 *  - Tier 1: Exact normalized match (across cleaned, base-edition, swapped, and split variants)
 *            with primary name > alternative > localized precedence and native remaster upgrade.
 *  - Tier 2: Unique non-DLC native remaster / port / edition wrapper on `igdbPlatformId`.
 *  - Tier 3: Unique non-DLC benign-subtitle or longer-query-prefix match on `igdbPlatformId`.
 * Any ambiguity (>1 match in Tier 2 or Tier 3), short single-word alias collision,
 * or sequel mismatch is rejected (`null`).
 */
export function selectStrictIgdbMatch(
  candidates: IgdbSearchCandidate[],
  normalizedTitle: string,
  igdbPlatformId: number,
  options?: {
    platformLaunchDate?: string | null;
    hasBaseCanonicalRelease?: boolean;
    rawTitle?: string;
  },
): IgdbSearchCandidate | null {
  if (!normalizedTitle) return null;
  const companionIds = new Set(getIgdbCompanionPlatformIds(igdbPlatformId));
  const onPlatform = (candidates || []).filter((c) =>
    extractIgdbPlatformIds(c.platforms).some((pid) => companionIds.has(pid)),
  );
  if (onPlatform.length === 0) return null;

  const isModernPlatform = Array.from(companionIds).some((pid) =>
    MODERN_BOUTIQUE_IGDB_PLATFORMS.has(pid),
  );
  const rawTitle = options?.rawTitle?.trim() || '';
  const variantObjs = rawTitle
    ? buildDetailedIgdbMatchVariants(rawTitle, {
        allowBareSpecial: isModernPlatform,
      })
    : [];
  const variantMeta = variantObjs.map((v) => ({
    raw: v.title,
    isTildeHalf: v.isTildeHalf,
    wordCount: v.title.split(/\s+/).filter(Boolean).length,
    strictNorm: normalizeTitleForMatching(v.title),
    igdbNorm: normalizeForIgdbMatch(v.title),
    sequelSig: extractTitleSequelSignature(v.title).join(','),
  }));
  const fallbackRawEntry = {
    raw: rawTitle,
    isTildeHalf: false,
    wordCount: rawTitle.split(/\s+/).filter(Boolean).length,
    strictNorm: normalizedTitle,
    igdbNorm: rawTitle ? normalizeForIgdbMatch(rawTitle) : normalizedTitle,
    sequelSig: rawTitle ? extractTitleSequelSignature(rawTitle).join(',') : '',
  };
  const allEntries = variantMeta.length > 0 ? variantMeta : [fallbackRawEntry];

  const primaryExactEntry =
    variantMeta.length > 0 ? variantMeta[0] : fallbackRawEntry;
  const matchesEntryList = (
    candStr: string,
    entries: typeof allEntries,
    isPrimaryField: boolean,
  ): boolean => {
    if (!candStr) return false;
    const candStrict = normalizeTitleForMatching(candStr);
    const candIgdb = normalizeForIgdbMatch(candStr);
    const candSeq = rawTitle
      ? extractTitleSequelSignature(candStr).join(',')
      : '';
    return entries.some((entry) => {
      if (rawTitle && candSeq !== entry.sequelSig) return false;
      // Single-word regional ` ~ ` split halves (e.g. "Capture") cannot match vague
      // third-party alternative/localized names such as Wall-Defender's French alias.
      if (!isPrimaryField && entry.isTildeHalf && entry.wordCount < 2) {
        return false;
      }
      if (rawTitle) {
        return Boolean(entry.igdbNorm && candIgdb === entry.igdbNorm);
      }
      return Boolean(
        (entry.strictNorm && candStrict === entry.strictNorm) ||
        (entry.igdbNorm && candIgdb === entry.igdbNorm),
      );
    });
  };

  const resolveTier1ForEntries = (
    entries: typeof allEntries,
  ): IgdbSearchCandidate | null => {
    const matchesPrimaryName = (c: IgdbSearchCandidate) =>
      matchesEntryList(c.name || '', entries, true);
    const matchesAlternativeName = (c: IgdbSearchCandidate) =>
      (c.alternative_names || []).some((a) =>
        matchesEntryList(a.name || '', entries, false),
      );
    const matchesLocalized = (c: IgdbSearchCandidate) =>
      (c.game_localizations || []).some((l) =>
        matchesEntryList(l.name || '', entries, false),
      );

    const exactMatches = onPlatform.filter(
      (c) =>
        matchesPrimaryName(c) ||
        matchesAlternativeName(c) ||
        matchesLocalized(c),
    );
    if (exactMatches.length === 0) return null;

    const entryNormSet = new Set(
      entries
        .flatMap((e) => (rawTitle ? [e.igdbNorm] : [e.strictNorm, e.igdbNorm]))
        .filter(Boolean),
    );
    for (const match of exactMatches) {
      const relatedIds = new Set<number>(
        [
          ...(match.remasters || []),
          ...(match.expanded_games || []),
          ...(match.ports || []),
        ]
          .map((r) => (typeof r === 'number' ? r : r?.id))
          .filter(
            (id): id is number => typeof id === 'number' && id !== match.id,
          ),
      );
      const launchFloor = toIsoDateFromIgdbValue(options?.platformLaunchDate);
      const firstRelIso = toIsoDateFromIgdbValue(match.first_release_date);
      const predatesLaunch = Boolean(
        launchFloor && firstRelIso && firstRelIso < launchFloor,
      );

      if (
        !options?.hasBaseCanonicalRelease &&
        (predatesLaunch || relatedIds.size > 0)
      ) {
        const relatedCandidate = onPlatform.find((c) => {
          if (c.id === match.id) return false;
          const cNorm = normalizeTitleForMatching(c.name || '');
          const cIgdb = normalizeForIgdbMatch(c.name || '');
          if (relatedIds.has(c.id)) {
            if (entryNormSet.has(cNorm) || entryNormSet.has(cIgdb)) return true;
            if (
              predatesLaunch &&
              Array.from(entryNormSet).some((n) => cNorm === `${n}remastered`)
            ) {
              return true;
            }
          }
          if (
            predatesLaunch &&
            Array.from(entryNormSet).some((n) => cNorm === `${n}remastered`)
          ) {
            return true;
          }
          return false;
        });
        if (relatedCandidate) {
          return relatedCandidate;
        }
      }
    }

    const byName = onPlatform.find(matchesPrimaryName);
    if (byName) return byName;
    const byAlternative = onPlatform.find(matchesAlternativeName);
    if (byAlternative) return byAlternative;
    return onPlatform.find(matchesLocalized) || null;
  };

  // Tier 1a: Exact unstripped match first (preserves distinct editions when IGDB has them)
  const exactUnstripped = resolveTier1ForEntries([primaryExactEntry]);
  if (exactUnstripped) return exactUnstripped;

  // Tier 1b: Exact match across cleaned/edition-stripped/swapped/split variants
  if (allEntries.length > 1) {
    const exactVariant = resolveTier1ForEntries(allEntries.slice(1));
    if (exactVariant) return exactVariant;
  }

  // Tier 2: Unique non-DLC native remaster / port / edition wrapper on platform
  const mainlineOnPlatform = onPlatform.filter(isMainlineOrRemasterCandidate);
  const tier2Matches = mainlineOnPlatform.filter((c) => {
    const candNames: Array<{ str: string; isPrimary: boolean }> = [
      { str: c.name || '', isPrimary: true },
      ...(c.alternative_names || []).map((a) => ({
        str: a.name || '',
        isPrimary: false,
      })),
      ...(c.game_localizations || []).map((l) => ({
        str: l.name || '',
        isPrimary: false,
      })),
    ].filter((n) => Boolean(n.str));
    return candNames.some(({ str: candStr, isPrimary }) => {
      const stripped = stripIgdbEditionWrapper(candStr, {
        allowBareSpecial: true,
      });
      if (!stripped || stripped.toLowerCase() === candStr.toLowerCase()) {
        return false;
      }
      const candSeq = rawTitle
        ? extractTitleSequelSignature(candStr).join(',')
        : '';
      const candStrippedIgdb = normalizeForIgdbMatch(stripped);
      const candStrippedStrict = normalizeTitleForMatching(stripped);
      return allEntries.some((entry) => {
        if (!isPrimary && entry.isTildeHalf && entry.wordCount < 2) {
          return false;
        }
        if (rawTitle && candSeq !== entry.sequelSig) return false;
        if (rawTitle) {
          return Boolean(entry.igdbNorm && candStrippedIgdb === entry.igdbNorm);
        }
        return Boolean(
          (entry.igdbNorm && candStrippedIgdb === entry.igdbNorm) ||
          (entry.strictNorm && candStrippedStrict === entry.strictNorm),
        );
      });
    });
  });

  if (tier2Matches.length === 1) return tier2Matches[0];
  if (tier2Matches.length > 1) return null;

  // Tier 3: Unique non-DLC benign-subtitle or longer-query-prefix match on platform
  if (!rawTitle) return null;
  const tier3Matches = mainlineOnPlatform.filter((c) => {
    const candName = (c.name || '').trim();
    if (!candName) return false;
    const candSeq = extractTitleSequelSignature(candName).join(',');
    const candSplit = splitTitlePrefixAndSubtitle(candName);

    return allEntries.some((entry) => {
      if (candSeq !== entry.sequelSig) return false;
      const candNorm = normalizeForIgdbMatch(candName);
      const qNorm = entry.igdbNorm;
      if (!candNorm || !qNorm) return false;

      // 3a: Query bare <-> Candidate has a benign generic or canonical subtitle
      // (blocks distinct subtitled games/sequels like "Ghost Recon 2: Summit Strike")
      if (
        candSplit &&
        normalizeForIgdbMatch(candSplit.prefix) === qNorm &&
        hasDistinctiveShortTitle(entry.raw) &&
        BENIGN_TIER3_SUBTITLE_RE.test(candSplit.subtitle)
      ) {
        return true;
      }

      // 3b: Query trailing benign subtitle <-> Candidate bare (e.g. "The Hobbit - The Prelude..." <-> "The Hobbit")
      const benignPrefixes = extractBenignPrefixCandidates(entry.raw);
      if (
        benignPrefixes.some(
          (prefix) =>
            normalizeForIgdbMatch(prefix) === candNorm &&
            hasDistinctiveShortTitle(candName),
        )
      ) {
        return true;
      }

      return false;
    });
  });

  if (tier3Matches.length === 1) return tier3Matches[0];
  return null;
}

function toIgdbGameMeta(c: IgdbSearchCandidate): IgdbGameMeta {
  const imageUrl = extractIgdbCoverImageUrl(c.cover);
  const hasLocalized =
    (c.game_localizations && c.game_localizations.length > 0) ||
    (c.alternative_names && c.alternative_names.length > 0);
  return {
    igdb_id: c.id,
    name: c.name?.trim() || null,
    igdb_url: c.url || null,
    image_url: imageUrl,
    summary: c.summary || null,
    genres: c.genres?.map((g) => g.name).join(', ') || null,
    collections: c.collections?.map((x) => x.name).join(', ') || null,
    franchises: c.franchises?.map((x) => x.name).join(', ') || null,
    first_release_date: c.first_release_date ?? null,
    release_dates: c.release_dates || [],
    metadata_json: hasLocalized
      ? JSON.stringify({
          game_localizations: c.game_localizations || [],
          alternative_names: c.alternative_names || [],
        })
      : null,
  };
}

/**
 * Batch-resolves IGDB metadata for catalog titles via IGDB `multiquery`
 * (≤10 sub-queries per request). Never throws: on missing credentials or IGDB
 * errors it returns whatever was resolved so far (possibly an empty map).
 */
export async function fetchIgdbMetadataForTitles(
  env: Env,
  items: Array<{
    key: string;
    title: string;
    normalizedTitle: string;
    igdbPlatformId: number | null;
    trackerPlatformId?: number | null;
    platformLaunchDate?: string | null;
  }>,
): Promise<Map<string, IgdbGameMeta>> {
  const out = new Map<string, IgdbGameMeta>();
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) return out;

  const eligible = items.filter(
    (i) =>
      ((i.igdbPlatformId && i.igdbPlatformId > 0) ||
        (i.trackerPlatformId != null &&
          getIgdbQueryPlatformIds(i.trackerPlatformId, i.igdbPlatformId)
            .length > 0)) &&
      i.normalizedTitle &&
      buildIgdbSearchTokens(i.title).length > 0,
  );

  const runChunkPass = async (
    chunk: typeof eligible,
    getQueryTitle: (item: (typeof eligible)[number]) => string,
  ) => {
    const body = chunk
      .map((item, idx) => {
        const tokens = buildIgdbSearchTokens(getQueryTitle(item));
        if (tokens.length === 0) return null;
        const resolvedPlatformIds =
          item.trackerPlatformId != null
            ? getIgdbQueryPlatformIds(
                item.trackerPlatformId,
                item.igdbPlatformId,
              )
            : getIgdbCompanionPlatformIds(item.igdbPlatformId as number);
        if (resolvedPlatformIds.length === 0) return null;
        const platformIds = resolvedPlatformIds.join(',');
        const buildFieldClause = (field: string) =>
          tokens.length === 1
            ? `${field} ~ *"${tokens[0]}"*`
            : `(${tokens.map((t) => `${field} ~ *"${t}"*`).join(' & ')})`;
        // NOTE: IGDB `search` returns no rows inside multiquery sub-queries, and inner `*`
        // wildcards inside quotes are treated literally, so AND separate token substring filters
        // and apply strict normalized matching locally.
        return `query games "q${idx}" { fields id, name, url, summary, first_release_date, category, game_type, cover.image_id, cover.url, genres.name, collections.name, franchises.name, platforms, alternative_names.name, alternative_names.comment, game_localizations.name, game_localizations.region, release_dates.platform, release_dates.region, release_dates.release_region, release_dates.date, remasters, expanded_games, ports; where platforms = (${platformIds}) & (${buildFieldClause('name')} | ${buildFieldClause('alternative_names.name')} | ${buildFieldClause('game_localizations.name')}); sort id asc; limit 50; };`;
      })
      .filter((q): q is string => Boolean(q))
      .join('\n');
    if (!body) return;
    const res = (await queryIGDBEdge('multiquery', body, env)) as Array<{
      name: string;
      result?: IgdbSearchCandidate[];
    }>;
    for (const entry of res || []) {
      const idx = parseInt((entry.name || '').replace(/^q/, ''), 10);
      const item = Number.isFinite(idx) ? chunk[idx] : undefined;
      if (!item) continue;
      const effectiveIgdbPlatformId =
        item.igdbPlatformId && item.igdbPlatformId > 0
          ? item.igdbPlatformId
          : (getIgdbQueryPlatformIds(
              item.trackerPlatformId as number,
              item.igdbPlatformId,
            )[0] ?? 0);
      const match = selectStrictIgdbMatch(
        entry.result || [],
        item.normalizedTitle,
        effectiveIgdbPlatformId,
        {
          rawTitle: item.title,
          platformLaunchDate: item.platformLaunchDate,
        },
      );
      if (match) out.set(item.key, toIgdbGameMeta(match));
    }
  };

  for (let start = 0; start < eligible.length; start += IGDB_MULTIQUERY_MAX) {
    const chunk = eligible.slice(start, start + IGDB_MULTIQUERY_MAX);
    try {
      await runChunkPass(chunk, (item) => item.title);
      const tildeRetries = chunk.filter(
        (item) => !out.has(item.key) && /\s+~\s+/.test(item.title),
      );
      if (tildeRetries.length > 0) {
        await runChunkPass(tildeRetries, (item) => {
          const halves = item.title
            .split(/\s+~\s+/)
            .map((h) => h.trim())
            .filter(Boolean);
          return halves[0] || item.title;
        });
      }
      const subtitlePrefixRetries = chunk
        .map((item) => {
          if (out.has(item.key) || /\s+~\s+/.test(item.title)) return null;
          const cleaned = cleanTitleForIgdbLookup(item.title) || item.title;
          const benignPrefixes = extractBenignPrefixCandidates(cleaned);
          const targetPrefix =
            benignPrefixes.length > 0
              ? benignPrefixes[benignPrefixes.length - 1]
              : '';
          if (!targetPrefix || !hasDistinctiveShortTitle(targetPrefix)) {
            return null;
          }
          return { item, targetPrefix };
        })
        .filter(
          (
            entry,
          ): entry is {
            item: (typeof eligible)[number];
            targetPrefix: string;
          } => entry !== null,
        );
      if (subtitlePrefixRetries.length > 0) {
        const prefixByKey = new Map(
          subtitlePrefixRetries.map((e) => [e.item.key, e.targetPrefix]),
        );
        await runChunkPass(
          subtitlePrefixRetries.map((e) => e.item),
          (item) => prefixByKey.get(item.key) || item.title,
        );
      }
    } catch (err) {
      console.error('[IGDB] multiquery metadata lookup failed:', err);
      break;
    }
  }
  return out;
}

export function cleanCanonicalDisplayTitle(rawTitle: string): string {
  if (!rawTitle) return '';
  // Strip DAT/Nintendo Revised parenthetical metadata tags like (USA), (Europe), (En,Fr,De), (Rev 1)
  const cleaned = rawTitle
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || rawTitle.trim();
}

export async function getBroadCatalogSeedStatus(
  env: Env,
  options?: { includeTableBounds?: boolean },
): Promise<{
  canonicalTailer: {
    cursor: number;
    canonicalMinId: number;
    canonicalMaxId: number;
    pendingCanonicalRows: number;
    writesUsedToday: number;
    dailyWriteBudget: number;
    gamesIngestedToday: number;
    releasesIngestedToday: number;
    lastUpdatedAt: string | null;
    maxGameStableId: number;
  };
  igdbRolling: {
    cursorOffset: number;
    refreshedTotal: number;
    updatedTotal: number;
    selfHealedRulesTotal: number;
    lastRunAt: string | null;
  };
  seriesDiscovery: {
    cursor: number;
    totalSeriesRules: number;
    seriesScannedTotal: number;
    discoveredGamesTotal: number;
    lastRunAt: string | null;
  };
  upstreamSources: {
    boutiquePreOrdersUpdatedAt: string | null;
    retailPreOrdersUpdatedAt: string | null;
    retailDealsUpdatedAt: string | null;
    switchRevisionsUpdatedAt: string | null;
    nsCollectorsUpdatedAt: string | null;
    amiiboCatalogUpdatedAt: string | null;
    catalogChunksUpdatedAt: string | null;
  };
  workerPlanTier: WorkerPlanTier;
  catalogDelivery: {
    mode: 'd1-edge-cache';
    version: string | null;
    totalRows: number;
    chunkCount: number;
    maxStableId: number;
    updatedAt: string | null;
  };
  workerDatSync: {
    lastRunAt: string | null;
    lastTargetsChecked: number;
    lastChangedCount: number;
    retroCursor: number;
  };
}> {
  const includeTableBounds = options?.includeTableBounds ?? true;
  const todayStr = new Date().toISOString().slice(0, 10);
  let cursor = 0;
  let writesUsedToday = 0;
  let gamesIngestedToday = 0;
  let releasesIngestedToday = 0;
  let lastUpdatedAt: string | null = null;
  let igdbSyncOffset = 0;
  let igdbRollingStats = {
    refreshedTotal: 0,
    updatedTotal: 0,
    selfHealedRulesTotal: 0,
    lastRunAt: null as string | null,
  };
  let boutiquePreOrdersUpdatedAt: string | null = null;
  let retailPreOrdersUpdatedAt: string | null = null;
  let retailDealsUpdatedAt: string | null = null;
  let switchRevisionsUpdatedAt: string | null = null;
  let nsCollectorsUpdatedAt: string | null = null;
  let amiiboCatalogUpdatedAt: string | null = null;
  let catalogChunksUpdatedAt: string | null = null;
  let seriesDiscoveryCursor = 0;
  let seriesDiscoveryStats = {
    seriesScannedTotal: 0,
    discoveredGamesTotal: 0,
    lastRunAt: null as string | null,
  };
  let workerPlanTier: WorkerPlanTier = 'paid';
  let catalogDelivery: {
    mode: 'd1-edge-cache';
    version: string | null;
    totalRows: number;
    chunkCount: number;
    maxStableId: number;
    updatedAt: string | null;
  } = {
    mode: 'd1-edge-cache',
    version: null,
    totalRows: 0,
    chunkCount: 0,
    maxStableId: 0,
    updatedAt: null,
  };
  let workerDatSync = {
    lastRunAt: null as string | null,
    lastTargetsChecked: 0,
    lastChangedCount: 0,
    retroCursor: 0,
  };

  try {
    const { results } = await env.DB.prepare(
      `SELECT key, value, updated_at FROM sync_state
       WHERE key IN (
         'catalog_seed_cursor',
         'catalog_seed_daily_writes',
         'igdb_sync_offset',
         'igdb_rolling_stats',
         'boutique_sync_last_run',
         'retail_preorder_sync_last_run',
         'retail_deals_last_run',
         'switch_revisions_hash',
         'nscollectors_sync_hash',
         'amiibo_catalog_hash',
         'catalog_chunks_state',
         'catalog_manifest_v1',
         'watched_series_discovery_cursor',
         'watched_series_discovery_stats',
         'worker_plan_tier',
         'worker_dat_sync_stats',
         'worker_dat_retro_cursor'
       )`,
    ).all<{ key: string; value: string; updated_at: string }>();

    for (const row of results || []) {
      if (row.key === 'catalog_seed_cursor') {
        const parsed = parseInt(row.value, 10);
        if (Number.isFinite(parsed) && parsed >= 0) {
          cursor = parsed;
        }
        lastUpdatedAt = row.updated_at || lastUpdatedAt;
      } else if (row.key === 'catalog_seed_daily_writes') {
        try {
          const parsed = JSON.parse(row.value) as {
            date?: string;
            writes?: number;
            games?: number;
            releases?: number;
          };
          if (parsed && parsed.date === todayStr) {
            writesUsedToday = Number(parsed.writes) || 0;
            gamesIngestedToday = Number(parsed.games) || 0;
            releasesIngestedToday = Number(parsed.releases) || 0;
          }
        } catch {
          // ignore malformed JSON
        }
        lastUpdatedAt = row.updated_at || lastUpdatedAt;
      } else if (row.key === 'igdb_sync_offset') {
        const parsed = parseInt(row.value, 10);
        if (Number.isFinite(parsed) && parsed >= 0) {
          igdbSyncOffset = parsed;
        }
      } else if (row.key === 'igdb_rolling_stats') {
        try {
          const parsed = JSON.parse(row.value) as {
            refreshedTotal?: number;
            updatedTotal?: number;
            selfHealedRulesTotal?: number;
            lastRunAt?: string | null;
          };
          igdbRollingStats = {
            refreshedTotal: Number(parsed?.refreshedTotal) || 0,
            updatedTotal: Number(parsed?.updatedTotal) || 0,
            selfHealedRulesTotal: Number(parsed?.selfHealedRulesTotal) || 0,
            lastRunAt: parsed?.lastRunAt || row.updated_at || null,
          };
        } catch {
          // ignore malformed JSON
        }
      } else if (row.key === 'boutique_sync_last_run') {
        boutiquePreOrdersUpdatedAt = row.updated_at || null;
      } else if (row.key === 'retail_preorder_sync_last_run') {
        retailPreOrdersUpdatedAt = row.updated_at || null;
      } else if (row.key === 'retail_deals_last_run') {
        retailDealsUpdatedAt = row.updated_at || null;
      } else if (row.key === 'switch_revisions_hash') {
        switchRevisionsUpdatedAt = row.updated_at || null;
      } else if (row.key === 'nscollectors_sync_hash') {
        nsCollectorsUpdatedAt = row.updated_at || null;
      } else if (row.key === 'amiibo_catalog_hash') {
        amiiboCatalogUpdatedAt = row.updated_at || null;
      } else if (row.key === 'catalog_chunks_state') {
        catalogChunksUpdatedAt = row.updated_at || null;
      } else if (row.key === 'catalog_manifest_v1') {
        try {
          const parsedManifest = JSON.parse(row.value) as CatalogManifest;
          catalogDelivery = {
            mode: 'd1-edge-cache',
            version: parsedManifest?.version || null,
            totalRows: Number(parsedManifest?.totalRows) || 0,
            chunkCount: Number(parsedManifest?.chunkCount) || 0,
            maxStableId: Number(parsedManifest?.maxStableId) || 0,
            updatedAt: parsedManifest?.timestamp || row.updated_at || null,
          };
          catalogChunksUpdatedAt =
            catalogDelivery.updatedAt || catalogChunksUpdatedAt;
        } catch {
          // ignore malformed JSON
        }
      } else if (row.key === 'worker_plan_tier') {
        workerPlanTier = row.value === 'free' ? 'free' : 'paid';
      } else if (row.key === 'worker_dat_retro_cursor') {
        const parsed = parseInt(row.value, 10);
        if (Number.isFinite(parsed) && parsed >= 0) {
          workerDatSync.retroCursor = parsed;
        }
      } else if (row.key === 'worker_dat_sync_stats') {
        try {
          const parsedDat = JSON.parse(row.value) as {
            lastRunAt?: string | null;
            lastTargetsChecked?: number;
            lastChangedCount?: number;
            retroCursor?: number;
          };
          workerDatSync = {
            lastRunAt: parsedDat?.lastRunAt || row.updated_at || null,
            lastTargetsChecked: Number(parsedDat?.lastTargetsChecked) || 0,
            lastChangedCount: Number(parsedDat?.lastChangedCount) || 0,
            retroCursor:
              Number(parsedDat?.retroCursor ?? workerDatSync.retroCursor) || 0,
          };
        } catch {
          // ignore malformed JSON
        }
      } else if (row.key === 'watched_series_discovery_cursor') {
        const parsed = parseInt(row.value, 10);
        if (Number.isFinite(parsed) && parsed >= 0) {
          seriesDiscoveryCursor = parsed;
        }
      } else if (row.key === 'watched_series_discovery_stats') {
        try {
          const parsed = JSON.parse(row.value) as {
            seriesScannedTotal?: number;
            discoveredGamesTotal?: number;
            lastRunAt?: string | null;
          };
          seriesDiscoveryStats = {
            seriesScannedTotal: Number(parsed?.seriesScannedTotal) || 0,
            discoveredGamesTotal: Number(parsed?.discoveredGamesTotal) || 0,
            lastRunAt: parsed?.lastRunAt || row.updated_at || null,
          };
        } catch {
          // ignore malformed JSON
        }
      }
    }
  } catch {
    // Fallback if sync_state table is unmigrated
  }

  let canonicalMinId = 0;
  let canonicalMaxId = 0;
  let maxGameStableId = 0;
  let totalSeriesRules = 0;
  if (includeTableBounds) {
    try {
      const [minRow, maxRow, gameMaxRow, seriesCountRow] = await Promise.all([
        env.DB.prepare(
          'SELECT COALESCE(MIN(id), 0) as min_id FROM canonical_releases',
        ).first<{ min_id: number }>(),
        env.DB.prepare(
          'SELECT COALESCE(MAX(id), 0) as max_id FROM canonical_releases',
        ).first<{ max_id: number }>(),
        env.DB.prepare(
          'SELECT COALESCE(MAX(stable_id), 0) as max_stable_id FROM games',
        ).first<{ max_stable_id: number }>(),
        env.DB.prepare(
          `SELECT COUNT(DISTINCT TRIM(match_value)) as cnt
           FROM user_tracking_rules
           WHERE rule_type = 'series' AND is_ignored = 0 AND TRIM(match_value) != ''`,
        )
          .first<{ cnt: number }>()
          .catch(() => ({ cnt: 0 })),
      ]);
      canonicalMinId = Number(minRow?.min_id) || 0;
      canonicalMaxId = Number(maxRow?.max_id) || 0;
      maxGameStableId = Number(gameMaxRow?.max_stable_id) || 0;
      totalSeriesRules = Number(seriesCountRow?.cnt) || 0;
    } catch {
      // Minimal test schemas may omit canonical_releases or platforms
    }
  }

  const pendingCanonicalRows = Math.max(0, canonicalMaxId - cursor);

  return {
    canonicalTailer: {
      cursor,
      canonicalMinId,
      canonicalMaxId,
      pendingCanonicalRows,
      writesUsedToday,
      dailyWriteBudget: DAILY_CATALOG_WRITE_BUDGET,
      gamesIngestedToday,
      releasesIngestedToday,
      lastUpdatedAt,
      maxGameStableId,
    },
    igdbRolling: {
      cursorOffset: igdbSyncOffset,
      refreshedTotal: igdbRollingStats.refreshedTotal,
      updatedTotal: igdbRollingStats.updatedTotal,
      selfHealedRulesTotal: igdbRollingStats.selfHealedRulesTotal,
      lastRunAt: igdbRollingStats.lastRunAt,
    },
    seriesDiscovery: {
      cursor: seriesDiscoveryCursor,
      totalSeriesRules,
      seriesScannedTotal: seriesDiscoveryStats.seriesScannedTotal,
      discoveredGamesTotal: seriesDiscoveryStats.discoveredGamesTotal,
      lastRunAt: seriesDiscoveryStats.lastRunAt,
    },
    upstreamSources: {
      boutiquePreOrdersUpdatedAt,
      retailPreOrdersUpdatedAt,
      retailDealsUpdatedAt,
      switchRevisionsUpdatedAt,
      nsCollectorsUpdatedAt,
      amiiboCatalogUpdatedAt,
      catalogChunksUpdatedAt,
    },
    workerPlanTier,
    catalogDelivery,
    workerDatSync,
  };
}

/**
 * Rolling Watched-Series Discovery Cron (`watched_series_discovery`).
 * Discovers verified/likely physical console games in IGDB matching users' active
 * `rule_type = 'series'` rules, inserts missing games + releases, and triggers
 * tracking rule evaluation + watched-series Web Push notifications.
 */
export async function syncWorkerWatchedSeriesDiscovery(
  env: Env,
  options?: { seriesLimit?: number },
): Promise<{
  skipped: boolean;
  reason?: string;
  seriesScanned: number;
  ingestedGames: number;
  ingestedReleases: number;
  rulesApplied: number;
  cursor: number;
}> {
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) {
    return {
      skipped: true,
      reason: 'missing_igdb_credentials',
      seriesScanned: 0,
      ingestedGames: 0,
      ingestedReleases: 0,
      rulesApplied: 0,
      cursor: 0,
    };
  }

  const ruleSeriesRows = await env.DB.prepare(
    `SELECT DISTINCT TRIM(match_value) AS series_name
     FROM user_tracking_rules
     WHERE rule_type = 'series' AND is_ignored = 0 AND TRIM(match_value) != ''
     ORDER BY series_name COLLATE NOCASE ASC`,
  ).all<{ series_name: string }>();

  const allSeries = (ruleSeriesRows.results || [])
    .map((r) => r.series_name)
    .filter(Boolean);
  if (allSeries.length === 0) {
    return {
      skipped: true,
      reason: 'no_series_rules',
      seriesScanned: 0,
      ingestedGames: 0,
      ingestedReleases: 0,
      rulesApplied: 0,
      cursor: 0,
    };
  }

  let currentCursor = 0;
  let prevStats = {
    seriesScannedTotal: 0,
    discoveredGamesTotal: 0,
    lastRunAt: null as string | null,
  };
  try {
    const { results: stateRows } = await env.DB.prepare(
      `SELECT key, value FROM sync_state
       WHERE key IN ('watched_series_discovery_cursor', 'watched_series_discovery_stats')`,
    ).all<{ key: string; value: string }>();
    for (const r of stateRows || []) {
      if (r.key === 'watched_series_discovery_cursor') {
        const n = parseInt(r.value, 10);
        if (Number.isFinite(n) && n >= 0) currentCursor = n;
      } else if (r.key === 'watched_series_discovery_stats') {
        const parsed = JSON.parse(r.value) as typeof prevStats;
        if (parsed && typeof parsed === 'object') {
          prevStats = {
            seriesScannedTotal: Number(parsed.seriesScannedTotal) || 0,
            discoveredGamesTotal: Number(parsed.discoveredGamesTotal) || 0,
            lastRunAt: parsed.lastRunAt ?? null,
          };
        }
      }
    }
  } catch {
    // Ignore sync_state fallback errors
  }

  const batchSize = Math.min(
    IGDB_MULTIQUERY_MAX,
    Math.max(1, options?.seriesLimit ?? IGDB_MULTIQUERY_MAX),
  );
  const startIdx = currentCursor % allSeries.length;
  const batchSeries: string[] = [];
  for (let i = 0; i < Math.min(batchSize, allSeries.length); i++) {
    batchSeries.push(allSeries[(startIdx + i) % allSeries.length]);
  }
  const nextCursor = (startIdx + batchSeries.length) % allSeries.length;

  const { byIgdbId: platformByIgdbId } = await loadPlatformLookupMaps(env);
  const trackedIgdbIds = Array.from(platformByIgdbId.keys()).filter(
    (id) => id > 0,
  );
  if (trackedIgdbIds.length === 0) {
    return {
      skipped: true,
      reason: 'no_tracked_platforms',
      seriesScanned: 0,
      ingestedGames: 0,
      ingestedReleases: 0,
      rulesApplied: 0,
      cursor: startIdx,
    };
  }

  const igdbPlatformList = trackedIgdbIds.join(',');
  const multiqueryBody = batchSeries
    .map((seriesName, idx) => {
      const term = sanitizeIgdbSearchTerm(seriesName);
      return `query games "s${idx}" { fields name, cover.url, cover.image_id, first_release_date, platforms.id, platforms.name, summary, genres.name, url, collections.name, franchises.name, category, game_type, alternative_names.name, alternative_names.comment, game_localizations.name, game_localizations.region, release_dates.platform, release_dates.region, release_dates.release_region, release_dates.date, remasters.id, remasters.name, remasters.platforms, expanded_games.id, expanded_games.name, expanded_games.platforms, ports.id, ports.name, ports.platforms, involved_companies.company.name, involved_companies.publisher; where (collections.name ~ *"${term}"* | franchises.name ~ *"${term}"*) & platforms = (${igdbPlatformList}); sort first_release_date desc; limit 50; };`;
    })
    .join('\n');

  interface WatchedSeriesIgdbGame extends IgdbSearchCandidate {
    category?: number;
    game_type?: number;
    involved_companies?: Array<{
      company?: { name: string };
      publisher?: boolean;
    }>;
  }

  let mqResult: Array<{ name: string; result?: WatchedSeriesIgdbGame[] }>;
  try {
    mqResult = (await queryIGDBEdge(
      'multiquery',
      multiqueryBody,
      env,
    )) as Array<{
      name: string;
      result?: WatchedSeriesIgdbGame[];
    }>;
  } catch (err) {
    console.warn('[WatchedSeriesDiscovery] IGDB multiquery failed:', err);
    return {
      skipped: true,
      reason: 'igdb_query_failed',
      seriesScanned: 0,
      ingestedGames: 0,
      ingestedReleases: 0,
      rulesApplied: 0,
      cursor: startIdx,
    };
  }

  const candidates: Array<{
    game: WatchedSeriesIgdbGame;
    matchedSeries: string;
  }> = [];
  const seenCandIgdbIds = new Set<number>();
  for (const entry of mqResult || []) {
    const idx = parseInt((entry.name || '').replace(/^s/, ''), 10);
    const queriedSeries = Number.isFinite(idx) ? batchSeries[idx] : undefined;
    if (!queriedSeries) continue;
    const queriedLower = queriedSeries.trim().toLowerCase();

    for (const g of entry.result || []) {
      if (!g || !g.id || !g.name || !isOfficialIGDBGame(g)) continue;
      if (seenCandIgdbIds.has(g.id)) continue;

      const collectionsStr =
        g.collections?.map((c) => c.name).join(', ') || undefined;
      const franchisesStr =
        g.franchises?.map((f) => f.name).join(', ') || undefined;
      const computedSeries = computeGameCanonicalSeries({
        title: g.name,
        collections: collectionsStr,
        franchises: franchisesStr,
      });
      const belongsToSeries =
        Boolean(computedSeries) &&
        computedSeries!.toLowerCase() === queriedLower;
      if (!belongsToSeries) continue;

      seenCandIgdbIds.add(g.id);
      candidates.push({ game: g, matchedSeries: queriedSeries });
    }
  }

  let ingestedGamesCount = 0;
  let ingestedReleasesCount = 0;
  let rulesApplied = 0;

  if (candidates.length > 0) {
    const allLookupIgdbIds = Array.from(
      new Set(
        candidates
          .flatMap(({ game }) => [
            game.id,
            ...(game.remasters || []).map((r) =>
              typeof r === 'number' ? r : r.id,
            ),
            ...(game.expanded_games || []).map((r) =>
              typeof r === 'number' ? r : r.id,
            ),
            ...(game.ports || []).map((r) =>
              typeof r === 'number' ? r : r.id,
            ),
          ])
          .filter(
            (id): id is number => typeof id === 'number' && Number.isFinite(id),
          ),
      ),
    );
    const candidateTitles = Array.from(
      new Set(candidates.map(({ game }) => game.name!).filter(Boolean)),
    );
    const candidateNormTitles = Array.from(
      new Set(
        candidates
          .flatMap(({ game }) => [
            normalizeTitleForMatching(game.name || ''),
            ...(game.alternative_names || []).map((a) =>
              normalizeTitleForMatching(a.name || ''),
            ),
          ])
          .filter(Boolean),
      ),
    );

    const existingSet = new Set<string>();
    const ownedRelatedPlatformSet = new Set<string>();

    for (let i = 0; i < allLookupIgdbIds.length; i += 80) {
      const chunk = allLookupIgdbIds.slice(i, i + 80);
      const ph = chunk.map(() => '?').join(',');
      const res = await env.DB.prepare(
        `SELECT stable_id, igdb_id, platform_id, title FROM games WHERE igdb_id IN (${ph})`,
      )
        .bind(...chunk)
        .all<{
          stable_id: number;
          igdb_id: number | null;
          platform_id: number;
          title: string;
        }>();
      for (const row of res.results || []) {
        if (row.igdb_id) {
          existingSet.add(`igdb-${row.igdb_id}-${row.platform_id}`);
          ownedRelatedPlatformSet.add(`${row.igdb_id}::${row.platform_id}`);
        }
        existingSet.add(
          `norm-${normalizeTitleForMatching(row.title)}-${row.platform_id}`,
        );
      }
    }

    for (let i = 0; i < candidateTitles.length; i += 80) {
      const chunk = candidateTitles.slice(i, i + 80);
      const ph = chunk.map(() => '?').join(',');
      const res = await env.DB.prepare(
        `SELECT platform_id, title FROM games WHERE (title COLLATE NOCASE) IN (${ph})`,
      )
        .bind(...chunk)
        .all<{ platform_id: number; title: string }>();
      for (const row of res.results || []) {
        existingSet.add(
          `norm-${normalizeTitleForMatching(row.title)}-${row.platform_id}`,
        );
      }
    }

    const canonicalByNorm = new Map<string, CanonicalRelease[]>();
    for (let i = 0; i < candidateNormTitles.length; i += 80) {
      const chunk = candidateNormTitles.slice(i, i + 80);
      const ph = chunk.map(() => '?').join(',');
      const res = await env.DB.prepare(
        `SELECT id, platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, serial_code, publisher, source, is_verified_physical
         FROM canonical_releases
         WHERE normalized_title IN (${ph})`,
      )
        .bind(...chunk)
        .all<CanonicalRelease>();
      for (const cr of res.results || []) {
        let list = canonicalByNorm.get(cr.normalized_title);
        if (!list) {
          list = [];
          canonicalByNorm.set(cr.normalized_title, list);
        }
        list.push(cr);
      }
    }

    const MAX_SERIES_DISCOVERY_GAMES_PER_RUN = 25;
    const usedSlugs = new Set<string>();
    const newlyIngestedForRules: Array<{
      stableId: number;
      platformId: number;
      canonicalSeries?: string | null;
      seriesTrackable?: boolean;
      title?: string;
      platformName?: string | null;
      gameSlug?: string;
      releases: Array<{ id: string; region: string | null }>;
    }> = [];

    for (const { game, matchedSeries } of candidates) {
      if (ingestedGamesCount >= MAX_SERIES_DISCOVERY_GAMES_PER_RUN) break;
      const gPlats = extractIgdbPlatformIds(game.platforms);
      const publisher =
        game.involved_companies?.find((ic) => ic.publisher)?.company?.name ||
        null;
      const altNames = (game.alternative_names || [])
        .map((a) => a.name)
        .filter(Boolean);
      const titleNorm = normalizeTitleForMatching(game.name || '');
      const igdbMeta = toIgdbGameMeta(game);
      const canonicalSeries =
        computeGameCanonicalSeries({
          title: game.name!,
          collections: igdbMeta.collections ?? undefined,
          franchises: igdbMeta.franchises ?? undefined,
        }) || matchedSeries;

      const candidateCanonicals = [
        ...(canonicalByNorm.get(titleNorm) || []),
        ...altNames.flatMap(
          (an) => canonicalByNorm.get(normalizeTitleForMatching(an)) || [],
        ),
      ];

      const seenLocalPlatIds = new Set<number>();
      for (const igdbPid of gPlats) {
        if (ingestedGamesCount >= MAX_SERIES_DISCOVERY_GAMES_PER_RUN) break;
        const localPlat = platformByIgdbId.get(igdbPid);
        if (!localPlat || seenLocalPlatIds.has(localPlat.id)) continue;
        seenLocalPlatIds.add(localPlat.id);

        if (
          existingSet.has(`igdb-${game.id}-${localPlat.id}`) ||
          existingSet.has(`norm-${titleNorm}-${localPlat.id}`)
        ) {
          continue;
        }

        const detection = detectPhysicalReleaseStatus({
          gameTitle: game.name!,
          platformId: localPlat.id,
          parentPlatformId: localPlat.parentPlatformId,
          alternativeNames: game.alternative_names,
          firstReleaseDate: game.first_release_date,
          platformLaunchDate: localPlat.launchDate,
          publisher,
          igdbCategory: game.game_type ?? game.category,
          canonicalReleases: candidateCanonicals,
        });

        // Require verified_physical to avoid auto-ingesting unverified likely_physical entries
        if (detection.physical_status !== 'verified_physical') {
          continue;
        }

        const isSuppressed = shouldSuppressCrossGenBasePlatform({
          game: {
            id: game.id,
            name: game.name,
            first_release_date: game.first_release_date,
            remasters: (game.remasters || []).filter(
              (r): r is IgdbRelatedEditionRef =>
                typeof r === 'object' && r !== null,
            ),
            expanded_games: (game.expanded_games || []).filter(
              (r): r is IgdbRelatedEditionRef =>
                typeof r === 'object' && r !== null,
            ),
            ports: (game.ports || []).filter(
              (r): r is IgdbRelatedEditionRef =>
                typeof r === 'object' && r !== null,
            ),
          },
          igdbPlatformId: igdbPid,
          platformLaunchDate: localPlat.launchDate,
          isBaseVerifiedPhysicalOnPlatform:
            detection.physical_status === 'verified_physical',
          isRelatedIgdbIdOwnedOnPlatform: (relIgdbId: number) =>
            ownedRelatedPlatformSet.has(`${relIgdbId}::${localPlat.id}`),
        });
        if (isSuppressed) continue;

        const platReleaseDate = resolveIgdbPlatformReleaseDate(
          game.release_dates,
          igdbPid,
          localPlat.launchDate,
          'USA',
          game.first_release_date,
        );

        if (detection.matched_releases.length === 0) continue;
        const releasesToCreate = detection.matched_releases.map((cr, idx) => ({
          slugSuffix:
            cr.rom_crc ||
            cr.serial_code ||
            cr.rom_name ||
            cr.region ||
            `rel-${idx + 1}`,
          region: cr.region || 'USA',
          variants: cr.variants || null,
          romName: cr.rom_name || null,
          romCrc: cr.rom_crc || null,
          releaseDate: platReleaseDate,
          canonicalReleaseId: cr.id,
          verifiedSource: cr.source ?? null,
          serialCode: cr.serial_code ?? null,
          canonicalTitle: cr.raw_title ?? null,
          publisher: cr.publisher ?? null,
        }));

        const inserted = await insertCatalogGameWithReleases(env, {
          title: game.name!,
          platformId: localPlat.id,
          platformSlugHint: localPlat.displayName || localPlat.name,
          region: 'USA',
          canonicalSeries,
          igdbMeta,
          usedSlugs,
          releases: releasesToCreate,
        });
        if (!inserted) continue;

        existingSet.add(`igdb-${game.id}-${localPlat.id}`);
        existingSet.add(`norm-${titleNorm}-${localPlat.id}`);
        ingestedGamesCount++;
        ingestedReleasesCount += inserted.insertedReleases.length;
        newlyIngestedForRules.push({
          stableId: inserted.stableId,
          platformId: localPlat.id,
          canonicalSeries,
          seriesTrackable: isSeriesTrackable({
            title: game.name!,
            collections: igdbMeta.collections,
            franchises: igdbMeta.franchises,
          }),
          title: game.name!,
          platformName: localPlat.displayName || localPlat.name,
          gameSlug: inserted.gameSlug,
          releases: inserted.insertedReleases,
        });
      }
    }

    if (newlyIngestedForRules.length > 0) {
      rulesApplied = await evaluateTrackingRulesForNewGames(
        env,
        newlyIngestedForRules,
        { notifySubscribers: true },
      );
      invalidateSeriesScanCache();
      await invalidateCatalogManifest(env);
      await markDbDirty(env);
    }
  }

  const nextStats = {
    seriesScannedTotal: prevStats.seriesScannedTotal + batchSeries.length,
    discoveredGamesTotal: prevStats.discoveredGamesTotal + ingestedGamesCount,
    lastRunAt: new Date().toISOString(),
  };

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO sync_state (key, value, updated_at)
         VALUES ('watched_series_discovery_cursor', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      ).bind(String(nextCursor)),
      env.DB.prepare(
        `INSERT INTO sync_state (key, value, updated_at)
         VALUES ('watched_series_discovery_stats', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      ).bind(JSON.stringify(nextStats)),
    ]);
  } catch {
    // Ignore sync_state errors in minimal test schemas
  }

  return {
    skipped: false,
    seriesScanned: batchSeries.length,
    ingestedGames: ingestedGamesCount,
    ingestedReleases: ingestedReleasesCount,
    rulesApplied,
    cursor: nextCursor,
  };
}

/**
 * Steady-State Canonical Tailer (`DAILY_CATALOG_WRITE_BUDGET = 60,000` writes/day).
 * Materializes any newly added verified `canonical_releases` rows (`id > catalog_seed_cursor`)
 * into `games` + `game_releases` and evaluates `user_tracking_rules`.
 */
export async function syncWorkerBroadCatalogPopulation(env: Env): Promise<{
  skipped: boolean;
  reason?: string;
  cursor: number;
  ingestedGames: number;
  ingestedReleases: number;
  writesUsed: number;
  igdbMatched?: number;
}> {
  const status = await getBroadCatalogSeedStatus(env, {
    includeTableBounds: false,
  });
  const tail = status.canonicalTailer;

  if (tail.writesUsedToday >= DAILY_CATALOG_WRITE_BUDGET) {
    return {
      skipped: true,
      reason: 'daily_budget_reached',
      cursor: tail.cursor,
      ingestedGames: 0,
      ingestedReleases: 0,
      writesUsed: 0,
    };
  }

  const tickWriteBudget = Math.min(
    1250,
    DAILY_CATALOG_WRITE_BUDGET - tail.writesUsedToday,
  );

  const currentCursor = tail.cursor;

  const sliceRes = await env.DB.prepare(
    `SELECT id, platform_id, raw_title, normalized_title, region, variants, also_released_as, packin_host_normalized_title, rom_name, rom_crc, serial_code
     FROM canonical_releases
     WHERE id > ?
       AND is_verified_physical = 1
       AND NOT (COALESCE(source, '') = 'nintendo_revised' AND (region = 'World' OR region IS NULL) AND serial_code IS NULL)
     ORDER BY id ASC
     LIMIT 100`,
  )
    .bind(currentCursor)
    .all<{
      id: number;
      platform_id: number;
      raw_title: string;
      normalized_title: string;
      region: string | null;
      variants: string | null;
      also_released_as: string | null;
      packin_host_normalized_title: string | null;
      rom_name: string | null;
      rom_crc: string | null;
      serial_code: string | null;
    }>();

  const slice = sliceRes.results || [];
  if (slice.length === 0) {
    return {
      skipped: true,
      reason: 'up_to_date',
      cursor: currentCursor,
      ingestedGames: 0,
      ingestedReleases: 0,
      writesUsed: 0,
    };
  }

  // Group slice rows by (platform_id, effective normalized title) where pack-in demo
  // discs route directly to their retail host game (`packin_host_normalized_title`).
  const groupsMap = new Map<
    string,
    {
      platform_id: number;
      normalized_title: string;
      raw_title: string;
      hasNonPackInInSlice: boolean;
      maxSliceId: number;
      sliceCrcs: Set<string>;
    }
  >();
  // canonical_releases.is_verified_physical can be stale; re-apply the current non-retail
  // format filter (compilation extractions, Virtual Console, Anthology dumps, ...).
  const sliceMaxId = slice.reduce((m, r) => Math.max(m, r.id), currentCursor);
  for (const row of slice) {
    if (
      isIgnoredFormatRelease(row.raw_title, row.rom_name || '', row.platform_id)
    ) {
      continue;
    }
    const isPackInRow = Boolean(row.packin_host_normalized_title?.trim());
    const effectiveNorm = isPackInRow
      ? row.packin_host_normalized_title!.trim()
      : row.normalized_title;
    const key = `${row.platform_id}::${effectiveNorm}`;
    const crcUpper = (row.rom_crc || '').trim().toUpperCase();
    const existing = groupsMap.get(key);
    if (!existing) {
      const sliceCrcs = new Set<string>();
      if (crcUpper) sliceCrcs.add(crcUpper);
      groupsMap.set(key, {
        platform_id: row.platform_id,
        normalized_title: effectiveNorm,
        raw_title: row.raw_title,
        hasNonPackInInSlice: !isPackInRow,
        maxSliceId: row.id,
        sliceCrcs,
      });
    } else {
      if (!isPackInRow && !existing.hasNonPackInInSlice) {
        existing.raw_title = row.raw_title;
        existing.hasNonPackInInSlice = true;
      }
      if (row.id > existing.maxSliceId) {
        existing.maxSliceId = row.id;
      }
      if (crcUpper) existing.sliceCrcs.add(crcUpper);
    }
  }

  if (groupsMap.size === 0) {
    // Entire slice was non-retail: just advance the cursor past it.
    await env.DB.prepare(
      `INSERT INTO sync_state (key, value, updated_at)
       VALUES ('catalog_seed_cursor', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(String(sliceMaxId))
      .run();
    return {
      skipped: false,
      cursor: sliceMaxId,
      ingestedGames: 0,
      ingestedReleases: 0,
      writesUsed: 0,
      igdbMatched: 0,
    };
  }

  const distinctPlatforms = Array.from(
    new Set(Array.from(groupsMap.values()).map((g) => g.platform_id)),
  );
  const platformPlaceholders = distinctPlatforms.map(() => '?').join(',');
  const [platformsRes, existingGamesRes] = await Promise.all([
    env.DB.prepare(
      `SELECT id, display_name, igdb_id, launch_date FROM platforms WHERE id IN (${platformPlaceholders})`,
    )
      .bind(...distinctPlatforms)
      .all<{
        id: number;
        display_name: string;
        igdb_id: number | null;
        launch_date: string | null;
      }>(),
    env.DB.prepare(
      `SELECT stable_id, id, title, platform_id, igdb_id, canonical_series, collections, franchises, bundle_parent_id
       FROM games
       WHERE platform_id IN (${platformPlaceholders})`,
    )
      .bind(...distinctPlatforms)
      .all<{
        stable_id: number;
        id: string;
        title: string;
        platform_id: number;
        igdb_id: number | null;
        canonical_series: string | null;
        collections: string | null;
        franchises: string | null;
        bundle_parent_id: number | null;
      }>(),
  ]);

  const platformNameById = new Map<number, string>();
  const platformIgdbIdById = new Map<number, number | null>();
  const platformLaunchDateById = new Map<number, string | null>();
  for (const p of platformsRes.results || []) {
    platformNameById.set(p.id, p.display_name);
    platformIgdbIdById.set(p.id, p.igdb_id ?? null);
    platformLaunchDateById.set(p.id, p.launch_date ?? null);
  }

  interface ExistingCatalogGameMeta {
    stable_id: number;
    id: string;
    title: string;
    platform_id: number;
    igdb_id: number | null;
    canonical_series: string | null;
    collections: string | null;
    franchises: string | null;
    bundle_parent_id: number | null;
  }

  const existingGameByPlatformNorm = new Map<string, ExistingCatalogGameMeta>();
  const existingGameByPlatformIgdb = new Map<string, ExistingCatalogGameMeta>();
  const existingGameByPlatformCrc = new Map<string, ExistingCatalogGameMeta>();
  const maxSortByPlatform = new Map<number, number>();
  for (const g of existingGamesRes.results || []) {
    const meta: ExistingCatalogGameMeta = {
      stable_id: g.stable_id,
      id: g.id,
      title: g.title,
      platform_id: g.platform_id,
      igdb_id: g.igdb_id ?? null,
      canonical_series: g.canonical_series ?? null,
      collections: g.collections ?? null,
      franchises: g.franchises ?? null,
      bundle_parent_id: g.bundle_parent_id ?? null,
    };
    if (
      g.igdb_id != null &&
      g.igdb_id > 0 &&
      !existingGameByPlatformIgdb.has(`${g.platform_id}::${g.igdb_id}`)
    ) {
      existingGameByPlatformIgdb.set(`${g.platform_id}::${g.igdb_id}`, meta);
    }
    const strippedNorm = normalizeTitleForMatching(stripEditionSuffix(g.title));
    if (
      strippedNorm &&
      !existingGameByPlatformNorm.has(`${g.platform_id}::${strippedNorm}`)
    ) {
      existingGameByPlatformNorm.set(`${g.platform_id}::${strippedNorm}`, meta);
    }
    const norm = normalizeTitleForMatching(g.title);
    if (norm) {
      existingGameByPlatformNorm.set(`${g.platform_id}::${norm}`, meta);
    }
  }

  // Pre-fetch existing (platform_id, rom_crc) matches via idx_game_releases_rom_crc
  // for candidate non-compilation groups not already matched by title.
  const unmatchedSliceCrcs = new Set<string>();
  for (const [key, group] of groupsMap) {
    if (existingGameByPlatformNorm.has(key)) continue;
    if (isCompilationOrBundleTitle(group.raw_title)) continue;
    for (const crc of group.sliceCrcs) {
      unmatchedSliceCrcs.add(crc);
    }
  }
  if (unmatchedSliceCrcs.size > 0) {
    const crcVariants = Array.from(unmatchedSliceCrcs).flatMap((c) => {
      const lower = c.toLowerCase();
      return lower === c ? [c] : [c, lower];
    });
    for (let i = 0; i < crcVariants.length; i += 80) {
      const chunk = crcVariants.slice(i, i + 80);
      const ph = chunk.map(() => '?').join(',');
      const crcRes = await env.DB.prepare(
        `SELECT gr.rom_crc, g.stable_id, g.id, g.title, g.platform_id, g.igdb_id,
                g.canonical_series, g.collections, g.franchises, g.bundle_parent_id
         FROM game_releases gr
         JOIN games g ON g.stable_id = gr.game_id
         WHERE gr.rom_crc IN (${ph})
           AND gr.rom_crc IS NOT NULL
           AND gr.rom_crc != ''`,
      )
        .bind(...chunk)
        .all<ExistingCatalogGameMeta & { rom_crc: string }>();
      for (const row of crcRes.results || []) {
        if (
          row.bundle_parent_id != null ||
          isCompilationOrBundleTitle(row.title)
        ) {
          continue;
        }
        const k = `${row.platform_id}::${row.rom_crc.trim().toUpperCase()}`;
        if (!existingGameByPlatformCrc.has(k)) {
          existingGameByPlatformCrc.set(k, row);
        }
      }
    }
  }

  let tickWritesUsed = 0;
  let ingestedGamesCount = 0;
  let ingestedReleasesCount = 0;
  let igdbMatchedCount = 0;
  let anyReleasesChanged = false;
  let nextCursor = currentCursor;
  let nextGameStableId: number | null = null;

  // Resolve IGDB metadata up front for groups that will be inserted, so each new game
  // row carries igdb_id / cover / summary in its single INSERT (no follow-up UPDATE).
  const igdbLookupItems: Array<{
    key: string;
    title: string;
    normalizedTitle: string;
    igdbPlatformId: number | null;
    trackerPlatformId?: number | null;
    platformLaunchDate?: string | null;
  }> = [];
  for (const [key, group] of groupsMap) {
    if (existingGameByPlatformNorm.has(key)) continue;
    if (!group.hasNonPackInInSlice) continue;
    const title = cleanCanonicalDisplayTitle(group.raw_title);
    igdbLookupItems.push({
      key,
      title,
      normalizedTitle: normalizeTitleForMatching(title),
      igdbPlatformId: platformIgdbIdById.get(group.platform_id) ?? null,
      trackerPlatformId: group.platform_id,
      platformLaunchDate: platformLaunchDateById.get(group.platform_id) ?? null,
    });
  }
  const igdbMetaByGroup = await fetchIgdbMetadataForTitles(
    env,
    igdbLookupItems,
  );
  const newlyIngestedForTracking: Array<{
    stableId: number;
    platformId: number;
    canonicalSeries: string;
    seriesTrackable: boolean;
    title?: string;
    platformName?: string | null;
    gameSlug?: string;
    releases: Array<{ id: string; region: string | null }>;
  }> = [];

  let stoppedEarly = false;
  for (const group of groupsMap.values()) {
    type CanonicalGroupReleaseRow = {
      id: number;
      raw_title: string;
      region: string | null;
      variants: string | null;
      also_released_as: string | null;
      packin_host_normalized_title: string | null;
      rom_name: string | null;
      rom_crc: string | null;
      serial_code: string | null;
      publisher: string | null;
      source: string | null;
    };
    // Fetch verified canonical releases via two indexed queries (primary title + pack-in host)
    const [allRelRes, packInRelRes] = await Promise.all([
      env.DB.prepare(
        `SELECT id, raw_title, region, variants, also_released_as, packin_host_normalized_title, rom_name, rom_crc, serial_code, publisher, source
         FROM canonical_releases
         WHERE platform_id = ?
           AND normalized_title = ?
           AND packin_host_normalized_title IS NULL
           AND is_verified_physical = 1
           AND NOT (COALESCE(source, '') = 'nintendo_revised' AND (region = 'World' OR region IS NULL) AND serial_code IS NULL)
         ORDER BY id ASC`,
      )
        .bind(group.platform_id, group.normalized_title)
        .all<CanonicalGroupReleaseRow>(),
      env.DB.prepare(
        `SELECT id, raw_title, region, variants, also_released_as, packin_host_normalized_title, rom_name, rom_crc, serial_code, publisher, source
         FROM canonical_releases
         WHERE platform_id = ?
           AND packin_host_normalized_title = ?
           AND is_verified_physical = 1
         ORDER BY id ASC`,
      )
        .bind(group.platform_id, group.normalized_title)
        .all<CanonicalGroupReleaseRow>(),
    ]);

    const combinedRelMap = new Map<number, CanonicalGroupReleaseRow>();
    for (const r of allRelRes.results || []) {
      combinedRelMap.set(r.id, r);
    }
    for (const r of packInRelRes.results || []) {
      combinedRelMap.set(r.id, r);
    }

    const canonicalRels = Array.from(combinedRelMap.values())
      .sort((a, b) => a.id - b.id)
      .filter(
        (r) =>
          !isIgnoredFormatRelease(
            r.raw_title,
            r.rom_name || '',
            group.platform_id,
          ),
      );
    if (canonicalRels.length === 0) {
      nextCursor = Math.max(nextCursor, group.maxSliceId);
      continue;
    }

    const hasPrimaryCanonical = canonicalRels.some(
      (r) => !r.packin_host_normalized_title,
    );

    const groupKey = `${group.platform_id}::${group.normalized_title}`;
    const igdbMeta = igdbMetaByGroup.get(groupKey) || null;
    let existingGame = existingGameByPlatformNorm.get(groupKey) || null;
    if (!existingGame && igdbMeta?.igdb_id) {
      existingGame =
        existingGameByPlatformIgdb.get(
          `${group.platform_id}::${igdbMeta.igdb_id}`,
        ) || null;
    }
    if (!existingGame && !isCompilationOrBundleTitle(group.raw_title)) {
      for (const cr of canonicalRels) {
        const crcUpper = (cr.rom_crc || '').trim().toUpperCase();
        if (!crcUpper) continue;
        const crcMatch = existingGameByPlatformCrc.get(
          `${group.platform_id}::${crcUpper}`,
        );
        if (
          crcMatch &&
          (!igdbMeta?.igdb_id ||
            !crcMatch.igdb_id ||
            igdbMeta.igdb_id === crcMatch.igdb_id)
        ) {
          existingGame = crcMatch;
          break;
        }
      }
    }

    const platIgdbId = platformIgdbIdById.get(group.platform_id) ?? null;
    const platLaunchDate =
      platformLaunchDateById.get(group.platform_id) ?? null;

    if (existingGame) {
      // Attach any newly discovered regional or revision releases past the cursor to the existing game,
      // preferring to link matching unlinked stub rows in place rather than inserting duplicate releases.
      const existingRelRes = await env.DB.prepare(
        'SELECT id, region, variants, rom_name, rom_crc, canonical_release_id FROM game_releases WHERE game_id = ?',
      )
        .bind(existingGame.stable_id)
        .all<{
          id: string;
          region: string | null;
          variants: string | null;
          rom_name: string | null;
          rom_crc: string | null;
          canonical_release_id: number | null;
        }>();
      const existingRels = existingRelRes.results || [];
      const existingCanonicalIds = new Set(
        existingRels
          .map((r) => r.canonical_release_id)
          .filter((id): id is number => id !== null && id !== undefined),
      );
      const existingCrcs = new Set(
        existingRels
          .map((r) => (r.rom_crc || '').trim().toUpperCase())
          .filter(Boolean),
      );
      const verifiedOrNamedRels = existingRels.filter(
        (r) => r.canonical_release_id != null || Boolean(r.rom_name),
      );
      const unlinkedRels = existingRels.filter(
        (r) => r.canonical_release_id == null && !r.rom_name,
      );

      type PlannedReleaseOp =
        | { kind: 'link'; unlinkedId: string; cr: CanonicalGroupReleaseRow }
        | { kind: 'insert'; cr: CanonicalGroupReleaseRow };
      const releaseOps: PlannedReleaseOp[] = [];

      for (const cr of canonicalRels) {
        if (cr.id <= currentCursor) continue;
        if (existingCanonicalIds.has(cr.id)) continue;
        const crCrc = (cr.rom_crc || '').trim().toUpperCase();
        if (crCrc && existingCrcs.has(crCrc)) continue;
        const crReg = (cr.region || 'USA').trim();
        const crVar = (cr.variants || 'Standard').trim();

        const unlinkedIdx = unlinkedRels.findIndex(
          (ur) =>
            regionsOverlap(ur.region, crReg) &&
            (!ur.variants || ur.variants.trim() === crVar),
        );
        if (unlinkedIdx >= 0) {
          const [claimed] = unlinkedRels.splice(unlinkedIdx, 1);
          existingCanonicalIds.add(cr.id);
          verifiedOrNamedRels.push({
            ...claimed,
            region: claimed.region || crReg,
            variants: claimed.variants || cr.variants || null,
            canonical_release_id: cr.id,
          });
          if (crCrc) existingCrcs.add(crCrc);
          releaseOps.push({ kind: 'link', unlinkedId: claimed.id, cr });
          continue;
        }

        const alreadyCovered = verifiedOrNamedRels.some(
          (vr) =>
            regionsOverlap(vr.region, crReg) &&
            (vr.variants || 'Standard').trim() === crVar,
        );
        if (alreadyCovered) continue;

        existingCanonicalIds.add(cr.id);
        verifiedOrNamedRels.push({
          id: `pending-${cr.id}`,
          region: crReg,
          variants: cr.variants || null,
          rom_name: cr.rom_name || null,
          rom_crc: cr.rom_crc || null,
          canonical_release_id: cr.id,
        });
        if (crCrc) existingCrcs.add(crCrc);
        releaseOps.push({ kind: 'insert', cr });
      }

      if (releaseOps.length > 0) {
        const estimatedNewRelWrites = releaseOps.length * 7;
        if (
          tickWritesUsed > 0 &&
          tickWritesUsed + estimatedNewRelWrites > tickWriteBudget
        ) {
          stoppedEarly = true;
          break;
        }

        const usedRelSlugs = new Set<string>(existingRels.map((r) => r.id));
        const relStatements: D1PreparedStatement[] = [];
        const addedReleasesForExisting: Array<{
          id: string;
          region: string | null;
        }> = [];
        let insertedHere = 0;

        for (const op of releaseOps) {
          const cr = op.cr;
          const relRegion = cr.region || 'USA';
          const relReleaseDate = igdbMeta
            ? resolveIgdbPlatformReleaseDate(
                igdbMeta.release_dates,
                platIgdbId,
                platLaunchDate,
                relRegion,
                igdbMeta.first_release_date,
              )
            : null;
          if (op.kind === 'link') {
            relStatements.push(
              env.DB.prepare(
                `UPDATE game_releases
                 SET canonical_release_id = ?,
                     variants = COALESCE(variants, ?),
                     also_released_as = COALESCE(also_released_as, ?),
                     rom_name = COALESCE(rom_name, ?),
                     rom_crc = COALESCE(rom_crc, ?),
                     release_date = COALESCE(release_date, ?),
                     verified_source = ?,
                     serial_code = ?,
                     canonical_title = ?,
                     publisher = ?
                 WHERE id = ?
                   AND canonical_release_id IS NULL
                   AND NOT EXISTS (
                     SELECT 1 FROM game_releases gr2
                     WHERE gr2.game_id = game_releases.game_id
                       AND gr2.canonical_release_id = ?
                       AND gr2.id != game_releases.id
                   )`,
              ).bind(
                cr.id,
                cr.variants || null,
                cr.also_released_as || null,
                cr.rom_name || null,
                cr.rom_crc || null,
                relReleaseDate,
                cr.source || null,
                cr.serial_code || null,
                cr.raw_title || null,
                cr.publisher || null,
                op.unlinkedId,
                cr.id,
              ),
            );
            continue;
          }

          const relSlug = nextSequentialReleaseId(
            existingGame.stable_id,
            usedRelSlugs,
          );
          addedReleasesForExisting.push({ id: relSlug, region: relRegion });
          insertedHere++;
          relStatements.push(
            env.DB.prepare(
              `INSERT INTO game_releases (
                 id, game_id, region, variants, also_released_as, rom_name, rom_crc, release_date, canonical_release_id,
                 verified_source, serial_code, canonical_title, publisher
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT DO NOTHING`,
            ).bind(
              relSlug,
              existingGame.stable_id,
              relRegion,
              cr.variants || null,
              cr.also_released_as || null,
              cr.rom_name || null,
              cr.rom_crc || null,
              relReleaseDate,
              cr.id,
              cr.source || null,
              cr.serial_code || null,
              cr.raw_title || null,
              cr.publisher || null,
            ),
          );
        }

        if (relStatements.length > 0) {
          await env.DB.batch(relStatements);
          anyReleasesChanged = true;
        }

        if (addedReleasesForExisting.length > 0) {
          const existingCanonicalSeries =
            existingGame.canonical_series ||
            computeGameCanonicalSeries({
              title: existingGame.title,
              collections: existingGame.collections ?? undefined,
              franchises: existingGame.franchises ?? undefined,
            });
          newlyIngestedForTracking.push({
            stableId: existingGame.stable_id,
            platformId: existingGame.platform_id,
            canonicalSeries: existingCanonicalSeries,
            seriesTrackable: isSeriesTrackable({
              title: existingGame.title,
              collections: existingGame.collections,
              franchises: existingGame.franchises,
            }),
            releases: addedReleasesForExisting,
          });
        }
        tickWritesUsed += estimatedNewRelWrites;
        ingestedReleasesCount += insertedHere;
      }

      nextCursor = Math.max(nextCursor, group.maxSliceId);
      continue;
    }

    if (!hasPrimaryCanonical) {
      nextCursor = Math.max(nextCursor, group.maxSliceId);
      continue;
    }

    // Estimate billable writes: 1 game row + 6 always-populated indexes (+1 partial idx_games_igdb_id
    // when igdb_id is set) + M release rows (M * (1 + 6) = 7M writes)
    const estimatedWrites = (igdbMeta ? 8 : 7) + canonicalRels.length * 7;
    if (
      tickWritesUsed > 0 &&
      tickWritesUsed + estimatedWrites > tickWriteBudget
    ) {
      stoppedEarly = true;
      break;
    }

    const primaryRels = canonicalRels.filter(
      (r) => !r.packin_host_normalized_title,
    );
    const prefPool = primaryRels.length > 0 ? primaryRels : canonicalRels;
    const preferredRel =
      prefPool.find(
        (r) =>
          r.region === 'USA' ||
          r.region === 'World' ||
          (r.region && r.region.includes('USA')),
      ) || prefPool[0];
    const sourceTitle = cleanCanonicalDisplayTitle(
      preferredRel.raw_title || group.raw_title,
    );
    const displayTitle = resolveCanonicalDisplayTitle(
      sourceTitle,
      igdbMeta?.name,
    );
    const displayNorm = normalizeTitleForMatching(displayTitle);

    // Check if this new game is a disc-2+ child of an already-ingested multi-disc bundle
    let bundleParentId: number | null = null;
    let bundleDiscNumber: number | null = null;
    for (const bundle of CANONICAL_BUNDLES) {
      const childSpec = bundle.includedGames.find(
        (inc) =>
          inc.discNumber > 1 &&
          inc.platformId === group.platform_id &&
          normalizeTitleForMatching(inc.title) === displayNorm,
      );
      if (!childSpec) continue;
      const parentNorm = normalizeTitleForMatching(bundle.parentTitle);
      const cachedParent = existingGameByPlatformNorm.get(
        `${bundle.parentPlatformId}::${parentNorm}`,
      );
      if (cachedParent) {
        bundleParentId = cachedParent.stable_id;
        bundleDiscNumber = childSpec.discNumber;
        break;
      }
      const parentRow = await env.DB.prepare(
        `SELECT stable_id FROM games WHERE title = ? COLLATE NOCASE AND platform_id = ? LIMIT 1`,
      )
        .bind(bundle.parentTitle, bundle.parentPlatformId)
        .first<{ stable_id: number }>();
      if (parentRow?.stable_id) {
        bundleParentId = parentRow.stable_id;
        bundleDiscNumber = childSpec.discNumber;
        break;
      }
    }

    const platformName =
      platformNameById.get(group.platform_id) ||
      `platform-${group.platform_id}`;
    const canonicalSeries = computeGameCanonicalSeries({
      title: displayTitle,
      collections: igdbMeta?.collections ?? undefined,
      franchises: igdbMeta?.franchises ?? undefined,
    });
    const gameRegion = preferredRel.region || 'USA';
    const nextSort = (maxSortByPlatform.get(group.platform_id) ?? 1000) + 1;
    maxSortByPlatform.set(group.platform_id, nextSort);

    const baseStableId: number =
      nextGameStableId ?? (await allocateNextGameStableId(env));
    let stableId: number = baseStableId;
    nextGameStableId = baseStableId + 1;
    let candidateGameId = String(stableId);
    let inserted = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      candidateGameId = String(stableId);
      try {
        await env.DB.prepare(
          `INSERT INTO games (
             stable_id, id, title, platform_id, sort_index, region,
             manually_verified, canonical_series,
             igdb_id, igdb_url, image_url, summary, genres, collections, franchises, metadata_json,
             bundle_parent_id, bundle_disc_number
           ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            stableId,
            candidateGameId,
            displayTitle,
            group.platform_id,
            nextSort,
            gameRegion,
            canonicalSeries,
            igdbMeta?.igdb_id ?? null,
            igdbMeta?.igdb_url ?? null,
            igdbMeta?.image_url ?? null,
            igdbMeta?.summary ?? null,
            igdbMeta?.genres ?? null,
            igdbMeta?.collections ?? null,
            igdbMeta?.franchises ?? null,
            igdbMeta?.metadata_json ?? null,
            bundleParentId,
            bundleDiscNumber,
          )
          .run();
        inserted = true;
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/UNIQUE constraint failed/i.test(msg) && attempt < 2) {
          stableId = (await allocateNextGameStableId(env)) + attempt + 1;
          nextGameStableId = stableId + 1;
          continue;
        }
        throw err;
      }
    }
    if (!inserted) {
      nextCursor = Math.max(nextCursor, group.maxSliceId);
      continue;
    }
    nextGameStableId = Math.max(nextGameStableId, stableId + 1);
    if (igdbMeta) igdbMatchedCount++;

    const newGameMeta: ExistingCatalogGameMeta = {
      stable_id: stableId,
      id: candidateGameId,
      title: displayTitle,
      platform_id: group.platform_id,
      igdb_id: igdbMeta?.igdb_id ?? null,
      canonical_series: canonicalSeries,
      collections: igdbMeta?.collections ?? null,
      franchises: igdbMeta?.franchises ?? null,
      bundle_parent_id: bundleParentId,
    };
    existingGameByPlatformNorm.set(
      `${group.platform_id}::${group.normalized_title}`,
      newGameMeta,
    );
    if (newGameMeta.igdb_id != null && newGameMeta.igdb_id > 0) {
      existingGameByPlatformIgdb.set(
        `${group.platform_id}::${newGameMeta.igdb_id}`,
        newGameMeta,
      );
    }

    // If this newly inserted game is the parent of a multi-disc bundle whose child
    // disc was already ingested earlier, attach the child now.
    const parentBundleDef = findCanonicalBundle(
      displayTitle,
      group.platform_id,
    );
    if (parentBundleDef) {
      for (const inc of parentBundleDef.includedGames) {
        if (inc.discNumber <= 1) continue;
        const childNorm = normalizeTitleForMatching(inc.title);
        const cachedChild = existingGameByPlatformNorm.get(
          `${inc.platformId}::${childNorm}`,
        );
        let childStableId = cachedChild?.stable_id ?? null;
        if (childStableId == null) {
          const childRow = await env.DB.prepare(
            `SELECT stable_id FROM games WHERE title = ? COLLATE NOCASE AND platform_id = ? AND bundle_parent_id IS NULL LIMIT 1`,
          )
            .bind(inc.title, inc.platformId)
            .first<{ stable_id: number }>();
          childStableId = childRow?.stable_id ?? null;
        }
        if (childStableId != null && childStableId !== stableId) {
          const linkRes = await env.DB.prepare(
            `UPDATE games SET bundle_parent_id = ?, bundle_disc_number = ? WHERE stable_id = ? AND bundle_parent_id IS NULL`,
          )
            .bind(stableId, inc.discNumber, childStableId)
            .run();
          if ((linkRes.meta?.changes ?? 0) > 0) {
            tickWritesUsed += 8;
            if (cachedChild) {
              cachedChild.bundle_parent_id = stableId;
            }
          }
        }
      }
    }

    const relStatements: D1PreparedStatement[] = [];
    const addedReleases: Array<{
      id: string;
      region: string | null;
      variants?: string | null;
      romName?: string | null;
    }> = [];

    const seenNewCanIds = new Set<number>();
    for (let i = 0; i < canonicalRels.length; i++) {
      const cr = canonicalRels[i];
      if (seenNewCanIds.has(cr.id)) continue;
      seenNewCanIds.add(cr.id);
      const crcUpper = (cr.rom_crc || '').trim().toUpperCase();
      if (crcUpper && !isCompilationOrBundleTitle(displayTitle)) {
        existingGameByPlatformCrc.set(
          `${group.platform_id}::${crcUpper}`,
          newGameMeta,
        );
      }
      const relSlug = `${stableId}-${i + 1}`;
      const relRegion = cr.region || gameRegion;
      const relReleaseDate = igdbMeta
        ? resolveIgdbPlatformReleaseDate(
            igdbMeta.release_dates,
            platIgdbId,
            platLaunchDate,
            relRegion,
            igdbMeta.first_release_date,
          )
        : null;
      addedReleases.push({
        id: relSlug,
        region: relRegion,
        variants: cr.variants || null,
        romName: cr.rom_name || null,
      });

      relStatements.push(
        env.DB.prepare(
          `INSERT INTO game_releases (
             id, game_id, region, variants, also_released_as, rom_name, rom_crc, release_date, canonical_release_id,
             verified_source, serial_code, canonical_title, publisher
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT DO NOTHING`,
        ).bind(
          relSlug,
          stableId,
          relRegion,
          cr.variants || null,
          cr.also_released_as || null,
          cr.rom_name || null,
          cr.rom_crc || null,
          relReleaseDate,
          cr.id,
          cr.source || null,
          cr.serial_code || null,
          cr.raw_title || null,
          cr.publisher || null,
        ),
      );
    }

    if (relStatements.length > 0) {
      await env.DB.batch(relStatements);
    }

    if (bundleParentId == null) {
      newlyIngestedForTracking.push({
        stableId: stableId,
        platformId: group.platform_id,
        canonicalSeries: canonicalSeries,
        seriesTrackable: isSeriesTrackable({
          title: displayTitle,
          collections: igdbMeta?.collections,
          franchises: igdbMeta?.franchises,
        }),
        title: displayTitle,
        platformName,
        gameSlug: candidateGameId,
        releases: addedReleases,
      });
    }

    tickWritesUsed += estimatedWrites;
    ingestedGamesCount++;
    ingestedReleasesCount += canonicalRels.length;
    nextCursor = Math.max(nextCursor, group.maxSliceId);
  }

  // If every group in the slice was handled, also skip past filtered-out non-retail rows.
  if (!stoppedEarly) {
    nextCursor = Math.max(nextCursor, sliceMaxId);
  }

  if (newlyIngestedForTracking.length > 0) {
    const matchedSeekingRows = await evaluateTrackingRulesForNewGames(
      env,
      newlyIngestedForTracking,
      { notifySubscribers: true },
    );
    // Each user_game_releases row insert incurs 1 + 1 = 2 billable writes
    const ruleWrites = matchedSeekingRows * 2;
    tickWritesUsed += ruleWrites;
    invalidateSeriesScanCache();
    await markDbDirty(env);
    await markCatalogChunksDirty(env);
  } else if (anyReleasesChanged) {
    await markDbDirty(env);
    await markCatalogChunksDirty(env);
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const updatedDaily = {
    date: todayStr,
    writes: tail.writesUsedToday + tickWritesUsed,
    games: tail.gamesIngestedToday + ingestedGamesCount,
    releases: tail.releasesIngestedToday + ingestedReleasesCount,
  };

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO sync_state (key, value, updated_at)
       VALUES ('catalog_seed_cursor', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    ).bind(String(nextCursor)),
    env.DB.prepare(
      `INSERT INTO sync_state (key, value, updated_at)
       VALUES ('catalog_seed_daily_writes', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    ).bind(JSON.stringify(updatedDaily)),
  ]);

  return {
    skipped: false,
    cursor: nextCursor,
    ingestedGames: ingestedGamesCount,
    ingestedReleases: ingestedReleasesCount,
    writesUsed: tickWritesUsed,
    igdbMatched: igdbMatchedCount,
  };
}

/**
 * Synchronizes the Amiibo figure, card, yarn, band, and wooden-block catalog from AmiiboAPI
 * (`https://amiiboapi.org/api/amiibo/`) into Cloudflare D1 during the daily cron window.
 *
 * Uses a SHA-256 hash guard (`amiibo_catalog_hash` in `sync_state`) so unchanged days incur
 * 0 D1 table reads and 0 writes. When upstream items are added or regional release dates update,
 * expands multi-pose Amiibo (`MULTI_POSE_AMIIBO_EXPANSIONS`), auto-creates new `toy_series` rows,
 * chunks writes within `maxWritesPerRun` to respect Free Tier write limits, and evaluates
 * `user_tracking_rules` for newly added items.
 */
export async function syncWorkerAmiiboCatalog(
  env: Env,
  options: { maxWritesPerRun?: number } = {},
): Promise<{
  checked: boolean;
  hashMatch: boolean;
  addedCount: number;
  updatedCount: number;
  writesUsed: number;
}> {
  const maxWritesPerRun = options.maxWritesPerRun ?? 6000;
  const response = await fetch('https://amiiboapi.org/api/amiibo/', {
    headers: { 'User-Agent': 'CollectionTracker/1.0' },
  });
  if (!response.ok) {
    throw new Error(`AmiiboAPI failed: ${response.status}`);
  }

  let rawText = '';
  let data: {
    amiibo?: Array<{
      head: string;
      tail: string;
      name: string;
      amiiboSeries: string;
      gameSeries?: string;
      type?: string;
      image?: string;
      release?: {
        na?: string | null;
        jp?: string | null;
        eu?: string | null;
        au?: string | null;
      };
    }>;
  } | null = null;

  if (typeof response.text === 'function') {
    rawText = await response.text();
    if (rawText.trim()) {
      try {
        data = JSON.parse(rawText);
      } catch {
        data = null;
      }
    }
  }
  if (!data && typeof response.json === 'function') {
    data = (await response.json().catch(() => null)) as typeof data;
    if (data && !rawText) {
      rawText = JSON.stringify(data);
    }
  }

  const amiiboList = data?.amiibo;
  if (!Array.isArray(amiiboList) || amiiboList.length === 0) {
    return {
      checked: true,
      hashMatch: false,
      addedCount: 0,
      updatedCount: 0,
      writesUsed: 0,
    };
  }

  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode('v1||' + (rawText || JSON.stringify(amiiboList))),
  );
  const currentHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const lastHashRow = await env.DB.prepare(
    "SELECT value FROM sync_state WHERE key = 'amiibo_catalog_hash'",
  ).first<{ value: string }>();

  if (lastHashRow?.value === currentHash) {
    return {
      checked: true,
      hashMatch: true,
      addedCount: 0,
      updatedCount: 0,
      writesUsed: 0,
    };
  }

  interface ExistingAmiiboRow {
    stable_id: number;
    id: string;
    name: string;
    amiibo_id: string | null;
    series_id: string | null;
    series: string | null;
    type: string | null;
    image_url: string | null;
    release_date: string | null;
    region: string | null;
    metadata_json: string | null;
    sort_index: number | null;
  }

  const [existingToysRes, existingSeriesRes, ignoredRes] = await Promise.all([
    env.DB.prepare(
      `SELECT stable_id, id, name, amiibo_id, series_id, series, type, image_url, release_date, region, metadata_json, sort_index
       FROM toys WHERE line = 'amiibo'`,
    ).all<ExistingAmiiboRow>(),
    env.DB.prepare(
      `SELECT id, name FROM toy_series WHERE line = 'amiibo'`,
    ).all<{ id: string; name: string }>(),
    env.DB.prepare(`SELECT id FROM ignored_items`).all<{ id: string }>(),
  ]);

  const ignoredSet = new Set<string>(
    (ignoredRes.results || []).map((r) => r.id),
  );
  const seriesIdByNameLower = new Map<string, string>();
  for (const s of existingSeriesRes.results || []) {
    seriesIdByNameLower.set(s.name.toLowerCase().trim(), s.id);
  }

  const existingById = new Map<string, ExistingAmiiboRow>();
  const existingByAmiiboId = new Map<string, ExistingAmiiboRow>();
  const existingByNameLower = new Map<string, ExistingAmiiboRow>();
  let maxSortIndex = 0;

  for (const row of existingToysRes.results || []) {
    if (row.id) existingById.set(row.id, row);
    if (row.amiibo_id) existingByAmiiboId.set(row.amiibo_id, row);
    if (row.name) existingByNameLower.set(row.name.toLowerCase().trim(), row);
    if (row.sort_index && row.sort_index > maxSortIndex) {
      maxSortIndex = row.sort_index;
    }
  }

  const slugify = (s: string) =>
    (s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  interface CandidateAmiiboItem {
    id: string;
    amiibo_id: string;
    name: string;
    series_name: string;
    type: string;
    image_url: string | null;
    release_date: string | null;
    region: string;
    metadata_json: string | null;
    isMultiPose: boolean;
  }

  const candidates: CandidateAmiiboItem[] = [];
  for (const a of amiiboList) {
    const amiiboId = `${a.head || ''}${a.tail || ''}`.trim();
    if (!amiiboId || !a.name) continue;
    const cleanName = a.name.toLowerCase().trim();
    const lowerSeries = (a.amiiboSeries || '').toLowerCase();
    const lowerGame = (a.gameSeries || '').toLowerCase();
    if (
      lowerSeries.includes('skylanders') ||
      lowerGame.includes('skylanders') ||
      cleanName.includes('hammer slam bowser') ||
      cleanName.includes('turbo charge donkey kong')
    ) {
      continue;
    }

    const effectiveSeries =
      a.amiiboSeries === 'Others' && a.gameSeries
        ? a.gameSeries
        : a.amiiboSeries || 'Other';

    const {
      region: defaultRegion,
      defaultDate,
      metadataJson,
    } = resolveAmiiboRegionsAndMetadata(a.release);

    const poseExpansions = MULTI_POSE_AMIIBO_EXPANSIONS[amiiboId];
    if (poseExpansions && poseExpansions.length > 0) {
      for (const p of poseExpansions) {
        const poseName = `${a.name}${p.nameSuffix}`;
        const poseId = p.slugSuffix ? `${amiiboId}${p.slugSuffix}` : amiiboId;
        candidates.push({
          id: poseId,
          amiibo_id: amiiboId,
          name: poseName,
          series_name: effectiveSeries,
          type: a.type || 'Figure',
          image_url: a.image || null,
          release_date: defaultDate,
          region: defaultRegion,
          metadata_json: metadataJson,
          isMultiPose: true,
        });
      }
      continue;
    }

    candidates.push({
      id: amiiboId,
      amiibo_id: amiiboId,
      name: a.name,
      series_name: effectiveSeries,
      type: a.type || 'Figure',
      image_url: a.image || null,
      release_date: defaultDate,
      region: defaultRegion,
      metadata_json: metadataJson,
      isMultiPose: false,
    });
  }

  const seriesStatements: D1PreparedStatement[] = [];
  const toyStatements: D1PreparedStatement[] = [];
  const newlyAddedToys: Array<{
    id: string;
    line: string;
    series: string;
    region: string | null;
  }> = [];

  let writesUsed = 0;
  let addedCount = 0;
  let updatedCount = 0;
  let stoppedEarly = false;

  for (const cand of candidates) {
    if (ignoredSet.has(cand.id) || ignoredSet.has(cand.amiibo_id)) {
      continue;
    }

    const existing = cand.isMultiPose
      ? existingById.get(cand.id) ||
        existingByNameLower.get(cand.name.toLowerCase().trim())
      : existingById.get(cand.id) ||
        existingByAmiiboId.get(cand.amiibo_id) ||
        existingByNameLower.get(cand.name.toLowerCase().trim());

    if (!existing) {
      // 1 toy row + 5 secondary indexes = 6 billable writes (+2 if creating a new toy_series row)
      const seriesKey = cand.series_name.toLowerCase().trim();
      let seriesId = seriesIdByNameLower.get(seriesKey) || null;
      const needsNewSeries = !seriesId && Boolean(seriesKey);
      const estimatedWrites = 6 + (needsNewSeries ? 2 : 0);

      if (writesUsed > 0 && writesUsed + estimatedWrites > maxWritesPerRun) {
        stoppedEarly = true;
        break;
      }

      if (needsNewSeries) {
        seriesId = `amiibo-${slugify(cand.series_name)}`;
        seriesIdByNameLower.set(seriesKey, seriesId);
        seriesStatements.push(
          env.DB.prepare(
            `INSERT OR IGNORE INTO toy_series (id, line, name) VALUES (?, 'amiibo', ?)`,
          ).bind(seriesId, cand.series_name),
        );
      }

      maxSortIndex++;
      toyStatements.push(
        env.DB.prepare(
          `INSERT INTO toys (
             id, name, line, series_id, series, type, release_date,
             image_url, amiibo_id, verified, metadata_json, sort_index, region
           ) VALUES (?, ?, 'amiibo', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
           ON CONFLICT(id) DO NOTHING`,
        ).bind(
          cand.id,
          cand.name,
          seriesId,
          cand.series_name,
          cand.type,
          cand.release_date,
          cand.image_url,
          cand.amiibo_id,
          cand.metadata_json,
          maxSortIndex,
          cand.region,
        ),
      );

      const newRow: ExistingAmiiboRow = {
        stable_id: 0,
        id: cand.id,
        name: cand.name,
        amiibo_id: cand.amiibo_id,
        series_id: seriesId,
        series: cand.series_name,
        type: cand.type,
        image_url: cand.image_url,
        release_date: cand.release_date,
        region: cand.region,
        metadata_json: cand.metadata_json,
        sort_index: maxSortIndex,
      };
      existingById.set(cand.id, newRow);
      if (!cand.isMultiPose) {
        existingByAmiiboId.set(cand.amiibo_id, newRow);
      }
      existingByNameLower.set(cand.name.toLowerCase().trim(), newRow);

      newlyAddedToys.push({
        id: cand.id,
        line: 'amiibo',
        series: cand.series_name,
        region: cand.region,
      });

      writesUsed += estimatedWrites;
      addedCount++;
    } else {
      const regionChanged = Boolean(
        cand.region && existing.region !== cand.region,
      );
      const dateChanged = Boolean(
        cand.release_date && existing.release_date !== cand.release_date,
      );
      const imageMissing = Boolean(!existing.image_url && cand.image_url);
      const amiiboIdMissing = Boolean(!existing.amiibo_id && cand.amiibo_id);

      let mergedMetaJson = existing.metadata_json;
      let metaChanged = false;
      if (cand.metadata_json) {
        try {
          const candMeta = JSON.parse(cand.metadata_json) as {
            releases?: Record<string, string>;
          };
          const existMeta = existing.metadata_json
            ? (JSON.parse(existing.metadata_json) as Record<string, unknown>)
            : {};
          const existReleases = (existMeta['releases'] || {}) as Record<
            string,
            string
          >;
          const candReleases = candMeta.releases || {};
          for (const [reg, dt] of Object.entries(candReleases)) {
            if (dt && existReleases[reg] !== dt) {
              existReleases[reg] = dt;
              metaChanged = true;
            }
          }
          if (metaChanged) {
            existMeta['releases'] = existReleases;
            mergedMetaJson = JSON.stringify(existMeta);
          }
        } catch {
          // Ignore malformed metadata_json
        }
      }

      if (
        regionChanged ||
        dateChanged ||
        imageMissing ||
        amiiboIdMissing ||
        metaChanged
      ) {
        if (writesUsed > 0 && writesUsed + 6 > maxWritesPerRun) {
          stoppedEarly = true;
          break;
        }
        toyStatements.push(
          env.DB.prepare(
            `UPDATE toys
             SET region = ?,
                 release_date = COALESCE(?, release_date),
                 image_url = COALESCE(image_url, ?),
                 amiibo_id = COALESCE(amiibo_id, ?),
                 metadata_json = ?,
                 verified = 1
             WHERE stable_id = ?`,
          ).bind(
            cand.region || existing.region || 'USA',
            cand.release_date,
            cand.image_url,
            cand.amiibo_id,
            mergedMetaJson,
            existing.stable_id,
          ),
        );
        writesUsed += 6;
        updatedCount++;
      }
    }
  }

  for (let i = 0; i < seriesStatements.length; i += 100) {
    await env.DB.batch(seriesStatements.slice(i, i + 100));
  }
  for (let i = 0; i < toyStatements.length; i += 100) {
    await env.DB.batch(toyStatements.slice(i, i + 100));
  }

  if (newlyAddedToys.length > 0) {
    const matchedToyRuleRows = await evaluateTrackingRulesForNewToys(
      env,
      newlyAddedToys,
      { notifySubscribers: true },
    );
    writesUsed += matchedToyRuleRows * 2;
  }

  if (addedCount > 0 || updatedCount > 0) {
    await invalidateToysCatalogChunk(env);
    await markDbDirty(env);
  }

  if (!stoppedEarly) {
    await env.DB.prepare(
      `INSERT INTO sync_state (key, value, updated_at)
       VALUES ('amiibo_catalog_hash', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
      .bind(currentHash)
      .run();
    writesUsed += 1;
  }

  return {
    checked: true,
    hashMatch: false,
    addedCount,
    updatedCount,
    writesUsed,
  };
}
