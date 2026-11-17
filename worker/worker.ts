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
 *    `/api/collection/sort`, `/api/discovery/add`, `/api/discovery/add-toy`) behind OIDC 1.0 /
 *    OAuth 2.1 + PKCE (`S256`) session validation while public browsing is uninhibited.
 * 4. **Automated R2 Snapshots**: Implements a `scheduled` cron handler that automatically dumps
 *    all D1 tables into structured, timestamped JSON backups in Cloudflare R2 indefinitely.
 * 5. **Edge-Native Discovery**: Connects directly to IGDB via Twitch OAuth secrets and AmiiboAPI
 *    using Web Standard fetch for real-time game and amiibo discovery.
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
  SharedBackupReleaseLink,
  enrichGameDetailWithCompanionsAndVouchers,
  resolveRegionalCoverUrl,
  isOfficialIGDBGame,
  JournalEntryRow,
  RESOLVE_CANONICAL_GAME_ID_QUERY,
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
  isIgnoredFormatRelease,
  isRegionMatchingHome,
} from '../shared/source_format';
import {
  detectPhysicalReleaseStatus,
  CanonicalRelease,
} from '../shared/canonical_releases';
import {
  fetchSwitchSpreadsheetTabs,
  parseSwitchRevisionsCsv,
  PAST_REVISION_TITLE_ALIASES,
} from '../shared/switch_revisions';
import {
  normalizeTitleForMatching,
  stripEditionSuffix,
} from '../shared/title_matching';
import { MULTI_POSE_AMIIBO_EXPANSIONS } from '../shared/amiibo_poses';
import {
  computeGameCanonicalSeries,
  computeGameCanonicalSeriesWithSource,
} from '../shared/canonical_series';
import {
  fetchAllRetailDeals,
  matchRetailGameProduct,
  matchRetailToyProduct,
  CandidateGame,
  CandidateToy,
  RetailDealItem,
} from '../shared/retail';
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
  BoutiquePreOrder,
} from '../shared/physical_feeds';
import { DealNotificationPreferences } from '../src/app/core/models/collection.models';

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
  BESTBUY_API_KEY?: string;
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
  backup_status?: number;
  ownership_status?: number;
  release_date?: string | null;
  metadata_json?: string | null;
  releases?: Array<Record<string, unknown>>;
  other_releases?: Array<Record<string, unknown>>;
  bundled_games?: unknown[];
  shared_backup_releases?: SharedBackupReleaseLink[];
}

let cachedTwitchToken: { token: string; expiresAt: number } | null = null;

let cachedSeriesScanMetadata: {
  allSeries: string[];
  parentMap: Map<number, number>;
  igdbToPlatformId: Map<
    number,
    { id: number; displayName: string; launchDate: string | null }
  >;
  ownedKeys: Set<string>;
  expiresAt: number;
} | null = null;

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

function isValidHttpsExternalUrl(raw: unknown): boolean {
  if (raw === null || raw === undefined || raw === '') return true;
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function isValidCatalogImageUrl(raw: unknown): boolean {
  if (raw === null || raw === undefined || raw === '') return true;
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed) return true;
  if (
    trimmed.startsWith('/') &&
    !trimmed.startsWith('//') &&
    !trimmed.includes('\\')
  ) {
    return true;
  }
  return isValidHttpsExternalUrl(trimmed);
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
  cachedSeriesScanMetadata = null;
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
  const nesEntry = igdbToPlatformId.get(18);
  if (nesEntry) igdbToPlatformId.set(99, nesEntry);
  const snesEntry = igdbToPlatformId.get(19);
  if (snesEntry) igdbToPlatformId.set(58, snesEntry);
  const ps4Entry = igdbToPlatformId.get(48);
  if (ps4Entry) igdbToPlatformId.set(165, ps4Entry);
  const ps5Entry = igdbToPlatformId.get(167);
  if (ps5Entry) igdbToPlatformId.set(390, ps5Entry);

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

export function getIgdbCompanionPlatformIds(igdbPlatformId: number): number[] {
  switch (igdbPlatformId) {
    case 18:
      return [18, 99];
    case 99:
      return [99, 18];
    case 19:
      return [19, 58];
    case 58:
      return [58, 19];
    case 48:
      return [48, 165];
    case 165:
      return [165, 48];
    case 167:
      return [167, 390];
    case 390:
      return [390, 167];
    default:
      return [igdbPlatformId];
  }
}

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
  '/api/collection/toggle',
  '/api/collection/backups/apply',
  '/api/collection/sort',
  '/api/discovery/add',
  '/api/discovery/add-toy',
  '/api/journal',
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
  'users',
  'user_tracking_rules',
  'user_game_releases',
  'user_games',
  'user_toys',
] as const;

export const R2_META_LITE_KEY = 'snapshots/meta-lite.json';
export const R2_TOYS_LITE_KEY = 'snapshots/toys-lite.json';
export const R2_GAMES_ACTIVE_LITE_KEY = 'snapshots/games-active-lite.json';
export const R2_CATALOG_MANIFEST_KEY = 'catalog/manifest.json';
export const R2_CATALOG_GAMES_CHUNK_PREFIX = 'catalog/games-chunk-';
export const R2_CATALOG_TOYS_CHUNK_KEY = 'catalog/toys-chunk-0.json';
export const X_CATALOG_PARTIAL_HEADER = 'X-Catalog-Partial';
export const X_CATALOG_VERSION_HEADER = 'X-Catalog-Version';
export const X_CATALOG_TOTAL_ROWS_HEADER = 'X-Catalog-Total-Rows';
export const X_CATALOG_CHUNK_SIZE_HEADER = 'X-Catalog-Chunk-Size';
export const X_CATALOG_CHUNK_COUNT_HEADER = 'X-Catalog-Chunk-Count';
export const MAX_FALLBACK_SNAPSHOT_BYTES = 5_000_000;
export const MAX_GAMES_LITE_SNAPSHOT_BYTES = 8_000_000;

export interface CatalogManifest {
  version: string;
  timestamp: string;
  totalRows: number;
  chunkSize: number;
  chunkCount: number;
  maxStableId: number;
  toysTotalRows: number;
  toysChunkCount: number;
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

export function getCatalogChunkR2Key(chunkIndex: number): string {
  return `${R2_CATALOG_GAMES_CHUNK_PREFIX}${chunkIndex}.json`;
}

const LITE_GAMES_SELECT_COLS = `stable_id, id, title, series, platform_id, sort_index, image_url, igdb_id, genres, region, collections, franchises, canonical_series, manually_verified, CASE WHEN metadata_json LIKE '%alternative_names%' OR metadata_json LIKE '%game_localizations%' THEN metadata_json ELSE NULL END AS metadata_json, igdb_url, physical_status, verification_tier, barcode, release_medium, bundle_parent_id, bundle_disc_number, retail_price, retail_regular_price, retail_discount_pct, retail_on_sale, retail_store, retail_url, retail_updated_at`;

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
    'SELECT COUNT(*) AS cnt FROM games',
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
        Number(ugr['backup_status'] ?? 0) > 0 ||
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
      'SELECT * FROM game_releases WHERE game_id',
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
      { httpMetadata: { contentType: 'application/json' } },
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
      { httpMetadata: { contentType: 'application/json' } },
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
      { httpMetadata: { contentType: 'application/json' } },
    ),
  ]);

  resetR2SnapshotCache();
}

const CATALOG_CHUNKS_STATE_KEY = 'catalog_chunks_state';

interface CatalogChunksBuildState {
  targetVersion: string;
  timestamp: string;
  nextChunk: number;
  chunkCount: number;
  totalRows: number;
  maxStableId: number;
  toysTotalRows: number;
}

/**
 * Generates pre-processed, user-agnostic R2 catalog chunks (`catalog/games-chunk-0..N.json`,
 * `catalog/toys-chunk-0.json`) and `catalog/manifest.json`. Supports resuming across cron
 * invocations when `maxChunksPerRun` is bounded for Free Tier CPU safety.
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
          typeof parsed.chunkCount === 'number' &&
          parsed.nextChunk < parsed.chunkCount
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
  let maxStableId: number;
  let chunkCount: number;
  let startChunk: number;
  let toysTotalRows: number;
  let targetVersion: string;

  if (resumeState) {
    timestamp = resumeState.timestamp;
    totalRows = resumeState.totalRows;
    maxStableId = resumeState.maxStableId;
    chunkCount = resumeState.chunkCount;
    startChunk = resumeState.nextChunk;
    toysTotalRows = resumeState.toysTotalRows;
    targetVersion = resumeState.targetVersion;
  } else {
    timestamp = options.timestampOverride || new Date().toISOString();
    const [statsRow, toyRowsResult] = await Promise.all([
      env.DB.prepare(
        `SELECT COUNT(*) AS total_rows, COALESCE(MAX(g.stable_id), 0) AS max_stable_id
         FROM games g
         LEFT JOIN game_releases r ON g.stable_id = r.game_id`,
      ).first<{ total_rows?: number; max_stable_id?: number }>(),
      env.DB.prepare(buildToysListQuery(null)).all(),
    ]);

    totalRows = Number(statsRow?.total_rows ?? 0);
    maxStableId = Number(statsRow?.max_stable_id ?? 0);
    chunkCount = Math.max(1, Math.ceil(totalRows / chunkSize));
    startChunk = Math.max(0, options.startChunk ?? 0);

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

    targetVersion = `${timestamp.slice(0, 10)}:${totalRows}:${maxStableId}:${Date.parse(timestamp) || Date.now()}`;
  }

  const endChunk = Math.min(
    chunkCount,
    Number.isFinite(maxChunksPerRun)
      ? startChunk + Math.max(1, Math.floor(maxChunksPerRun))
      : chunkCount,
  );
  const chunkQuery = buildCatalogGamesChunkQuery();

  for (let idx = startChunk; idx < endChunk; idx++) {
    const { results } = await env.DB.prepare(chunkQuery)
      .bind(chunkSize, idx * chunkSize)
      .all();
    const chunkRows = (results as Array<Record<string, unknown>>) || [];
    if (chunkRows.length > 0) {
      postProcessGameListRows(chunkRows, DEFAULT_USER_HOME_REGION);
    }
    await env.BACKUP_BUCKET.put(
      getCatalogChunkR2Key(idx),
      JSON.stringify(chunkRows),
      {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: {
          chunkIndex: String(idx),
          rowCount: String(chunkRows.length),
          version: targetVersion,
          timestamp,
        },
      },
    );
  }

  if (endChunk < chunkCount) {
    const nextState: CatalogChunksBuildState = {
      targetVersion,
      timestamp,
      nextChunk: endChunk,
      chunkCount,
      totalRows,
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
    return null;
  }

  const manifest: CatalogManifest = {
    version: targetVersion,
    timestamp,
    totalRows,
    chunkSize,
    chunkCount,
    maxStableId,
    toysTotalRows,
    toysChunkCount: 1,
  };

  await env.BACKUP_BUCKET.put(
    R2_CATALOG_MANIFEST_KEY,
    JSON.stringify(manifest),
    {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: {
        version: manifest.version,
        totalRows: String(manifest.totalRows),
        chunkCount: String(manifest.chunkCount),
      },
    },
  );
  try {
    await env.DB.prepare(`DELETE FROM sync_state WHERE key = ?`)
      .bind(CATALOG_CHUNKS_STATE_KEY)
      .run();
  } catch {
    // ignore cleanup error in minimal schemas
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

  if (env.BACKUP_BUCKET) {
    try {
      const obj = await env.BACKUP_BUCKET.get(R2_CATALOG_MANIFEST_KEY);
      if (obj) {
        const parsed = JSON.parse(await obj.text()) as CatalogManifest;
        if (parsed && typeof parsed.version === 'string') {
          cachedCatalogManifest = {
            manifest: parsed,
            expiresAt: Date.now() + 60_000,
          };
          return parsed;
        }
      }
    } catch {
      // Fall back to D1 synthesis below
    }
  }

  try {
    const [gameStats, toyStats] = await Promise.all([
      env.DB.prepare(
        `SELECT COUNT(*) AS total_rows, COALESCE(MAX(g.stable_id), 0) AS max_stable_id
         FROM games g
         LEFT JOIN game_releases r ON g.stable_id = r.game_id`,
      ).first<{ total_rows?: number; max_stable_id?: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS cnt FROM toys')
        .first<{ cnt?: number }>()
        .catch(() => ({ cnt: 0 })),
    ]);

    const timestamp = new Date().toISOString();
    const totalRows = Number(gameStats?.total_rows ?? 0);
    const maxStableId = Number(gameStats?.max_stable_id ?? 0);
    const toysTotalRows = Number(toyStats?.cnt ?? 0);
    const chunkSize = CATALOG_GAMES_CHUNK_SIZE;
    const chunkCount = Math.max(1, Math.ceil(totalRows / chunkSize));
    const manifest: CatalogManifest = {
      version: `${timestamp.slice(0, 10)}:${totalRows}:${maxStableId}`,
      timestamp,
      totalRows,
      chunkSize,
      chunkCount,
      maxStableId,
      toysTotalRows,
      toysChunkCount: 1,
    };
    if (env.BACKUP_BUCKET && totalRows <= 7000) {
      await env.BACKUP_BUCKET.put(
        R2_CATALOG_MANIFEST_KEY,
        JSON.stringify(manifest),
        {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {
            version: manifest.version,
            totalRows: String(manifest.totalRows),
            chunkCount: String(manifest.chunkCount),
          },
        },
      ).catch(() => {});
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

async function invalidateToysCatalogChunk(env: Env): Promise<void> {
  cachedCatalogToys = null;
  if (env.BACKUP_BUCKET && typeof env.BACKUP_BUCKET.delete === 'function') {
    await env.BACKUP_BUCKET.delete(R2_CATALOG_TOYS_CHUNK_KEY).catch(() => {});
  }
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
  if (!env.BACKUP_BUCKET) return null;
  try {
    const obj = await env.BACKUP_BUCKET.get(R2_CATALOG_TOYS_CHUNK_KEY);
    if (!obj) return null;
    const rows = JSON.parse(await obj.text()) as Array<Record<string, unknown>>;
    if (!Array.isArray(rows)) return null;
    let maxStableId = Number(obj.customMetadata?.['maxStableId'] ?? 0);
    if (!maxStableId && rows.length > 0) {
      for (const r of rows) {
        const sid = Number(r['stable_id'] ?? 0);
        if (sid > maxStableId) maxStableId = sid;
      }
    }
    const rowCount = Number(obj.customMetadata?.['rowCount'] ?? rows.length);
    const timestamp =
      obj.customMetadata?.['timestamp'] || new Date().toISOString();
    const cached = {
      rows,
      rowCount,
      maxStableId,
      timestamp,
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
      env.DB.prepare(
        'SELECT COUNT(*) AS cnt, COALESCE(MAX(stable_id), 0) AS max_id FROM toys',
      ).first<{ cnt?: number; max_id?: number }>(),
      userId
        ? env.DB.prepare(USER_TOYS_OVERLAY_QUERY)
            .bind(userId)
            .all<{ toy_id: string; ownership_status: number }>()
        : Promise.resolve({
            results: [] as Array<{ toy_id: string; ownership_status: number }>,
          }),
    ]);

    const d1Count = Number(d1Stats?.cnt ?? 0);
    const d1MaxId = Number(d1Stats?.max_id ?? 0);

    // If toys were deleted directly in D1, re-query live D1 cleanly
    if (d1Count >= baseChunk.rowCount) {
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
      'SELECT id, username, is_public, home_region, display_name, bio, COALESCE(auto_track_series_on_add, 1) as auto_track_series_on_add FROM users WHERE id = ?',
    )
      .bind(sessionUser.id)
      .first()) as DbUserRow | null;
  } catch (primaryErr) {
    if (isD1QuotaOrReadError(primaryErr)) {
      d1Failed = true;
    } else {
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
  if (userId) {
    for (const ug of userGames) {
      if (Number(ug['user_id']) === userId) {
        userGamesByStableId.set(Number(ug['game_id']), ug);
      }
    }
    for (const ugr of userGameReleases) {
      if (Number(ugr['user_id']) === userId) {
        userReleasesByReleaseId.set(String(ugr['release_id']), ugr);
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

  const rows: Array<Record<string, unknown>> = [];
  for (const g of games) {
    if (g['is_hidden'] === 1) continue;
    const platId = Number(g['platform_id']);
    if (allowedPlatformIds && !allowedPlatformIds.has(platId)) continue;

    const stableId = Number(g['stable_id']);
    const p = platformById.get(platId);
    const pp =
      p &&
      p['parent_platform_id'] !== undefined &&
      p['parent_platform_id'] !== null
        ? platformById.get(Number(p['parent_platform_id']))
        : undefined;
    const effPlatform = pp || p;
    const ug = userId ? userGamesByStableId.get(stableId) : undefined;
    const gameReleases = releasesByGameId.get(stableId);
    const relList: Array<Record<string, unknown> | null> =
      gameReleases && gameReleases.length > 0 ? gameReleases : [null];

    for (const r of relList) {
      const relId = r ? String(r['id']) : null;
      const ugr =
        userId && relId ? userReleasesByReleaseId.get(relId) : undefined;
      rows.push({
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
        physical_status: g['physical_status'] ?? null,
        verification_tier: g['verification_tier'] ?? null,
        barcode: g['barcode'] ?? null,
        release_medium: g['release_medium'] ?? null,
        bundle_parent_id: g['bundle_parent_id'] ?? null,
        bundle_disc_number: g['bundle_disc_number'] ?? null,
        bundle_count: bundleCounts.get(stableId) ?? 0,
        ownership_status: ugr ? Number(ugr['ownership_status'] ?? 0) : 0,
        region: r?.['region'] || g['region'] || null,
        variants: r?.['variants'] ?? null,
        also_released_as: r?.['also_released_as'] ?? null,
        rom_name: r?.['rom_name'] ?? null,
        rom_crc: r?.['rom_crc'] ?? null,
        backup_status: ugr ? Number(ugr['backup_status'] ?? 0) : 0,
        has_case: ugr ? Number(ugr['has_case'] ?? 0) : 0,
        has_manual: ugr ? Number(ugr['has_manual'] ?? 0) : 0,
        retail_price: g['retail_price'] ?? null,
        retail_regular_price: g['retail_regular_price'] ?? null,
        retail_discount_pct: g['retail_discount_pct'] ?? null,
        retail_on_sale: Number(g['retail_on_sale'] ?? 0),
        retail_store: g['retail_store'] ?? null,
        retail_url: g['retail_url'] ?? null,
        retail_updated_at: g['retail_updated_at'] ?? null,
        display_name:
          platId === 0
            ? 'Physical Watch'
            : ((effPlatform?.['display_name'] as string | null) ?? null),
        platform:
          platId === 0
            ? 'Physical Watch'
            : ((effPlatform?.['display_name'] as string | null) ?? null),
        brand:
          platId === 0
            ? null
            : ((effPlatform?.['brand'] as string | null) ?? null),
        platform_launch_date: effPlatform?.['launch_date'] ?? null,
        platform_logo: effPlatform?.['image_url'] ?? null,
        parent_platform_id: p?.['parent_platform_id'] ?? null,
        canonical_release_id: r?.['canonical_release_id'] ?? null,
        source: null,
        serial_code: null,
        is_source_verified: r?.['rom_name'] ? 1 : 0,
      });
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

  if (game.platform_id === 0) {
    // Virtual Platform 0 ("No Platform") represents untracked / physical watch list games
    // that have not yet released on a physical console. They must never expose synthetic
    // or placeholder physical release rows.
    game.releases = [];
    game.other_releases = [];
  } else if (isMulti) {
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
        backup_status: game.backup_status || 0,
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
): DbGame | null {
  const games = snapshot.tables?.['games'] || [];
  const releases = snapshot.tables?.['game_releases'] || [];
  const platforms = snapshot.tables?.['platforms'] || [];
  const userGames = snapshot.tables?.['user_games'] || [];
  const userGameReleases = snapshot.tables?.['user_game_releases'] || [];

  const matchedRelease = releases.find((r) => String(r['id']) === id) || null;
  let g: Record<string, unknown> | undefined;
  if (matchedRelease) {
    const gid = Number(matchedRelease['game_id']);
    g = games.find((item) => Number(item['stable_id']) === gid);
  }
  if (!g) {
    g = games.find(
      (item) => String(item['id']) === id || String(item['stable_id']) === id,
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
    physical_status: (g['physical_status'] as string | null) ?? null,
    verification_tier: (g['verification_tier'] as number | null) ?? null,
    barcode: (g['barcode'] as string | null) ?? null,
    release_medium: (g['release_medium'] as string | null) ?? null,
    origin_metadata: (g['origin_metadata'] as string | null) ?? null,
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
    backup_status: primaryUgr ? Number(primaryUgr['backup_status'] ?? 0) : 0,
    has_case: primaryUgr ? Number(primaryUgr['has_case'] ?? 0) : 0,
    has_manual: primaryUgr ? Number(primaryUgr['has_manual'] ?? 0) : 0,
    display_name:
      platId === 0
        ? 'Physical Watch'
        : ((effPlatform?.['display_name'] as string | null) ?? null),
    platform:
      platId === 0
        ? 'Physical Watch'
        : ((effPlatform?.['display_name'] as string | null) ?? null),
    brand:
      platId === 0 ? null : ((effPlatform?.['brand'] as string | null) ?? null),
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
      backup_status: ugr ? Number(ugr['backup_status'] ?? 0) : 0,
      ownership_status: ugr ? Number(ugr['ownership_status'] ?? 0) : 0,
      title: (r['also_released_as'] as string | null) ?? null,
      release_date:
        (r['release_date'] as string | null) ?? fallbackReleaseDate ?? null,
      image_url: (r['image_url'] as string | null) ?? null,
      has_case: ugr ? Number(ugr['has_case'] ?? 0) : 0,
      has_manual: ugr ? Number(ugr['has_manual'] ?? 0) : 0,
      canonical_release_id:
        (r['canonical_release_id'] as string | null) ?? null,
      source: null,
      is_source_verified: r['rom_name'] ? 1 : 0,
      serial_code: null,
      comments: null,
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
        backup_status: ugr ? Number(ugr['backup_status'] ?? 0) : 0,
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
        release_medium: bg['release_medium'] ?? null,
        origin_metadata: bg['origin_metadata'] ?? null,
        rom_name: rel?.['rom_name'] || bg['title'],
        backup_status: ugr ? Number(ugr['backup_status'] ?? 0) : 0,
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
): Promise<{ trackedSeries: string | null; autoAddedCount: number }> {
  try {
    let autoTrack = 1;
    let homeRegion = 'USA';
    try {
      const userRow = await env.DB.prepare(
        "SELECT COALESCE(auto_track_series_on_add, 1) as auto_track, COALESCE(home_region, 'USA') as home_region FROM users WHERE id = ?",
      )
        .bind(userId)
        .first<{ auto_track: number; home_region: string }>();
      if (userRow) {
        autoTrack = Number(userRow.auto_track ?? 1);
        homeRegion = userRow.home_region || 'USA';
      }
    } catch {
      // Fallback if auto_track_series_on_add column is not yet present in unmigrated test DB
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
    const regionScope = existingRule?.region_scope || 'home';

    if (!existingRule) {
      await env.DB.prepare(
        `INSERT INTO user_tracking_rules (user_id, rule_type, match_value, target_status, region_scope, is_ignored)
         VALUES (?, 'series', ?, 2, 'home', 0)
         ON CONFLICT(user_id, rule_type, match_value) DO NOTHING`,
      )
        .bind(userId, canonicalSeries)
        .run();
    }

    // Find all sibling games in this canonical_series and their releases
    const { results: seriesReleases } = await env.DB.prepare(
      `SELECT g.stable_id, g.title, g.collections, g.franchises,
              r.id as release_id, COALESCE(r.region, g.region) as region, r.variants,
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
        title: string | null;
        collections: string | null;
        franchises: string | null;
        release_id: string;
        region: string | null;
        variants: string | null;
        ownership_status: number;
      }>();

    const untrackableGames = new Set<number>();
    const byGame = new Map<
      number,
      Array<{
        release_id: string;
        region: string | null;
        variants: string | null;
        ownership_status: number;
      }>
    >();
    for (const row of seriesReleases || []) {
      let list = byGame.get(row.stable_id);
      if (!list) {
        list = [];
        byGame.set(row.stable_id, list);
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
    for (const [stableId, rels] of byGame.entries()) {
      if (stableId === gameStableId) continue;
      // Siblings that only share a generic title-derived series are not real series members
      if (untrackableGames.has(stableId)) continue;
      // Skip if user already has any positive status (Owned=1, Seeking=2, Ordered=3, PrioritySeeking=4) on any release of this game
      if (rels.some((r) => Number(r.ownership_status) > 0)) {
        continue;
      }

      const matchingRels =
        regionScope === 'any'
          ? rels
          : rels.filter((r) => isRegionMatchingHome(r.region, homeRegion));

      if (matchingRels.length === 0) continue;

      const chosen = matchingRels[0];
      statements.push(
        env.DB.prepare(
          `INSERT INTO user_game_releases (user_id, release_id, ownership_status, backup_status)
           VALUES (?, ?, ?, 0)
           ON CONFLICT(user_id, release_id) DO UPDATE SET
             ownership_status = excluded.ownership_status
           WHERE user_game_releases.ownership_status = 0`,
        ).bind(userId, chosen.release_id, targetStatus),
      );
    }

    if (statements.length > 0) {
      for (let i = 0; i < statements.length; i += 100) {
        await env.DB.batch(statements.slice(i, i + 100));
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
 * Evaluates active `user_tracking_rules` (series and platform rules) for newly added games
 * and automatically marks matching releases as Seeking (2) or PrioritySeeking (4).
 */
export async function evaluateTrackingRulesForNewGames(
  env: Env,
  newGames: Array<{
    stableId: number;
    platformId: number;
    canonicalSeries?: string | null;
    /** false when canonicalSeries is only the game's own title (must not match series rules) */
    seriesTrackable?: boolean;
    releases: Array<{ id: string; region: string | null }>;
  }>,
): Promise<number> {
  if (!newGames || newGames.length === 0) return 0;
  try {
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

    const rules = ruleRows || [];
    if (rules.length === 0) return 0;

    const statements: D1PreparedStatement[] = [];
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
        { targetStatus: number; regionScope: string; homeRegion: string }
      >();

      for (const rule of rules) {
        const valLower = rule.match_value.trim().toLowerCase();
        const isMatch =
          (rule.rule_type === 'series' &&
            seriesLower &&
            valLower === seriesLower) ||
          (rule.rule_type === 'platform' && valLower === platStr);

        if (isMatch) {
          const prev = matchedByUser.get(rule.user_id);
          if (!prev || rule.target_status > prev.targetStatus) {
            matchedByUser.set(rule.user_id, {
              targetStatus: rule.target_status || 2,
              regionScope: rule.region_scope || 'home',
              homeRegion: rule.home_region || 'USA',
            });
          }
        }
      }

      for (const [userId, match] of matchedByUser.entries()) {
        const candidateRels =
          match.regionScope === 'any' || match.regionScope === 'all'
            ? game.releases
            : game.releases.filter(
                (r) =>
                  isRegionMatchingHome(r.region, match.homeRegion) ||
                  (match.homeRegion === 'USA' && r.region === 'World'),
              );
        if (candidateRels.length === 0) continue;

        const targetRel = candidateRels[0];
        statements.push(
          env.DB.prepare(
            `INSERT INTO user_game_releases (user_id, release_id, ownership_status, backup_status)
             VALUES (?, ?, ?, 0)
             ON CONFLICT(user_id, release_id) DO UPDATE SET
               ownership_status = excluded.ownership_status
             WHERE user_game_releases.ownership_status = 0`,
          ).bind(userId, targetRel.id, match.targetStatus),
        );
      }
    }

    if (statements.length > 0) {
      for (let i = 0; i < statements.length; i += 100) {
        await env.DB.batch(statements.slice(i, i + 100));
      }
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
  }>,
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

    const statements: D1PreparedStatement[] = [];
    for (const toy of newToys) {
      const lineLower = (toy.line || '').trim().toLowerCase();
      const seriesLower = (toy.series || '').trim().toLowerCase();

      const matchedByUser = new Map<
        number,
        { targetStatus: number; regionScope: string; homeRegion: string }
      >();

      for (const rule of rules) {
        const valLower = rule.match_value.trim().toLowerCase();
        const isMatch =
          (rule.rule_type === 'toy_line' &&
            lineLower &&
            valLower === lineLower) ||
          (rule.rule_type === 'toy_series' &&
            seriesLower &&
            valLower === seriesLower);

        if (isMatch) {
          const prev = matchedByUser.get(rule.user_id);
          if (!prev || rule.target_status > prev.targetStatus) {
            matchedByUser.set(rule.user_id, {
              targetStatus: rule.target_status || 2,
              regionScope: rule.region_scope || 'home',
              homeRegion: rule.home_region || 'USA',
            });
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
        statements.push(
          env.DB.prepare(
            `INSERT INTO user_toys (user_id, toy_id, ownership_status, updated_at)
             VALUES (?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(user_id, toy_id) DO UPDATE SET
               ownership_status = excluded.ownership_status,
               updated_at = CURRENT_TIMESTAMP
             WHERE user_toys.ownership_status = 0`,
          ).bind(userId, toy.id, match.targetStatus),
        );
      }
    }

    if (statements.length > 0) {
      for (let i = 0; i < statements.length; i += 100) {
        await env.DB.batch(statements.slice(i, i + 100));
      }
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

/**
 * Records a background job execution entry in cron_execution_logs table.
 */
export async function logCronExecution(
  env: Env,
  jobName: string,
  status: 'SUCCESS' | 'ERROR',
  durationMs: number,
  summary?: string,
  details?: unknown,
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO cron_execution_logs (job_name, status, duration_ms, summary, details_json)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(
        jobName,
        status,
        durationMs,
        summary || null,
        details ? JSON.stringify(details) : null,
      )
      .run();
  } catch (err) {
    console.warn(`[WorkerCron] Failed to log execution for ${jobName}:`, err);
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
  const res = await kitPerformScheduledBackup(env, BACKUP_TABLES, {
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
 * Diff-guarded daily R2 backup for `canonical_releases` (`snapshots/canonical_releases.json`).
 * Only reads and uploads `canonical_releases` (in primary-key pages) when `canonical_releases_dirty = '1'`
 * or when the R2 object's `customMetadata` (`rowCount`, `maxId`) does not match D1.
 */
export async function performCanonicalReleasesBackup(
  env: Env,
  options: { pageSize?: number; force?: boolean } = {},
): Promise<{
  key: string;
  rowCount: number;
  maxId: number;
  skipped: boolean;
}> {
  const latestCanonicalKey = 'snapshots/canonical_releases.json';
  const pageSize = options.pageSize ?? 20000;
  if (!env.BACKUP_BUCKET) {
    return { key: 'none', rowCount: 0, maxId: 0, skipped: true };
  }

  const [dirtyRow, statsRow] = await Promise.all([
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
  ]);

  const isDirty = dirtyRow?.value === '1';
  const rowCount = Number(statsRow?.cnt ?? 0);
  const maxId = Number(statsRow?.max_id ?? 0);

  if (!options.force && !isDirty) {
    if (rowCount === 0) {
      return { key: 'none', rowCount: 0, maxId: 0, skipped: true };
    }
    try {
      let existingRowCount: string | undefined;
      let existingMaxId: string | undefined;
      if (typeof env.BACKUP_BUCKET.head === 'function') {
        const headObj = await env.BACKUP_BUCKET.head(latestCanonicalKey);
        existingRowCount = headObj?.customMetadata?.['rowCount'];
        existingMaxId = headObj?.customMetadata?.['maxId'];
      } else if (typeof env.BACKUP_BUCKET.get === 'function') {
        const getObj = await env.BACKUP_BUCKET.get(latestCanonicalKey);
        existingRowCount = getObj?.customMetadata?.['rowCount'];
        existingMaxId = getObj?.customMetadata?.['maxId'];
      }
      if (
        existingRowCount === String(rowCount) &&
        existingMaxId === String(maxId)
      ) {
        return {
          key: 'none',
          rowCount,
          maxId,
          skipped: true,
        };
      }
    } catch {
      // Proceed with backup if R2 metadata check fails
    }
  }

  if (rowCount === 0 && !isDirty && !options.force) {
    return { key: 'none', rowCount: 0, maxId: 0, skipped: true };
  }

  const allRows: Record<string, unknown>[] = [];
  let cursor = 0;
  while (true) {
    const { results } = await env.DB.prepare(
      'SELECT * FROM canonical_releases WHERE id > ? ORDER BY id ASC LIMIT ?',
    )
      .bind(cursor, pageSize)
      .all<Record<string, unknown>>();
    const batch = results || [];
    if (batch.length === 0) break;
    for (const r of batch) {
      allRows.push(r);
    }
    const lastId = Number(batch[batch.length - 1]?.['id'] ?? 0);
    if (!lastId || lastId <= cursor || batch.length < pageSize) break;
    cursor = lastId;
  }

  const actualCount = allRows.length;
  const actualMaxId =
    actualCount > 0 ? Number(allRows[actualCount - 1]?.['id'] ?? maxId) : 0;

  const tablesJson = `{"canonical_releases":${JSON.stringify(allRows)}}`;
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(tablesJson),
  );
  const sha256 = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const timestamp = new Date().toISOString();
  const metadataJson = JSON.stringify({
    timestamp,
    date: timestamp.slice(0, 10),
    version: 1,
    totalRows: actualCount,
    rowCount: actualCount,
    maxId: actualMaxId,
    sha256,
    tableCounts: { canonical_releases: actualCount },
  });
  const payload = `{"timestamp":${JSON.stringify(timestamp)},"version":"1.0","metadata":${metadataJson},"tables":${tablesJson}}`;

  await env.BACKUP_BUCKET.put(latestCanonicalKey, payload, {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: {
      sha256,
      totalRows: String(actualCount),
      rowCount: String(actualCount),
      maxId: String(actualMaxId),
    },
  });

  await env.DB.prepare(
    `INSERT INTO sync_state (key, value, updated_at)
     VALUES ('canonical_releases_dirty', '0', datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = '0', updated_at = datetime('now')`,
  ).run();

  return {
    key: latestCanonicalKey,
    rowCount: actualCount,
    maxId: actualMaxId,
    skipped: false,
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
    const countRow = (await db
      .prepare('SELECT COUNT(*) AS cnt FROM games')
      .first()) as { cnt?: number } | null;
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
        r['origin_metadata'] = undefined;
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

  const [ugrRes, ugRes, utRes, deltaRes] = await Promise.all([
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
      ? env.DB.prepare(buildCatalogDeltaGamesQuery(userId))
          .bind(...(userId !== null ? [userId, userId] : []), sinceStableId)
          .all()
      : Promise.resolve({ results: [] }),
  ]);

  const deltaGames = (deltaRes.results as Array<Record<string, unknown>>) || [];
  if (deltaGames.length > 0) {
    postProcessGameListRows(deltaGames, homeRegion);
  }

  return {
    version: manifest?.version || '',
    timestamp: manifest?.timestamp || new Date().toISOString(),
    maxStableId: manifest?.maxStableId ?? sinceStableId,
    ugr: (ugrRes.results as Array<Record<string, unknown>>) || [],
    ug: (ugRes.results as Array<Record<string, unknown>>) || [],
    ut: (utRes.results as Array<Record<string, unknown>>) || [],
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
Disallow: /discovery/
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

    // Rate-limit external-API discovery endpoints and push test endpoint
    if (path.startsWith('/api/discovery/')) {
      const rl = checkWorkerRateLimit(
        'discovery',
        getRateLimitClientKey(request, sessionUser),
        30,
        60_000,
      );
      if (!rl.allowed) {
        return Response.json(
          { error: 'Too many discovery requests. Please try again shortly.' },
          {
            status: 429,
            headers: { 'Retry-After': String(rl.retryAfterSec) },
          },
        );
      }
    } else if (
      request.method === 'POST' &&
      path === '/api/notifications/test'
    ) {
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
      path === '/api/collection/backups/apply'
    ) {
      const rl = checkWorkerRateLimit(
        'backups-apply',
        getRateLimitClientKey(request, sessionUser),
        20,
        60_000,
      );
      if (!rl.allowed) {
        return Response.json(
          {
            error:
              'Too many backup sync requests. Please wait before trying again.',
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
        } | null;

        if (!body || typeof body !== 'object') {
          return Response.json(
            { error: 'Invalid JSON payload' },
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

        updateParams.push(sessionUser.id);
        await env.DB.prepare(
          `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
        )
          .bind(...updateParams)
          .run();

        let profile: DbUserRow | null = null;
        try {
          profile = (await env.DB.prepare(
            'SELECT id, username, is_public, home_region, display_name, bio, COALESCE(auto_track_series_on_add, 1) as auto_track_series_on_add FROM users WHERE id = ?',
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

        if (!profile) {
          return Response.json({ error: 'User not found' }, { status: 404 });
        }

        await invalidateEdgeApiCache(request.url, {
          userId: profile.id,
          username: profile.username,
          previousUsername: sessionUser.username,
        });
        await markDbDirty(env);

        const res = Response.json({
          id: profile.id,
          username: profile.username,
          role: sessionUser.role,
          isPublic: Boolean(profile.is_public),
          homeRegion: profile.home_region || 'USA',
          displayName: profile.display_name,
          bio: profile.bio,
          autoTrackSeriesOnAdd:
            profile.auto_track_series_on_add !== undefined &&
            profile.auto_track_series_on_add !== null
              ? Boolean(profile.auto_track_series_on_add)
              : true,
        });

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
        const regionScope = body.region_scope === 'any' ? 'any' : 'home';
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
            .bind(sessionUser.id, matchValue)
            .run();
          clearedCount = Number(clearRes.meta?.changes || 0);
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

        await markDbDirty(env);
        return Response.json({ success: true });
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
          paused?: boolean;
          stage?: '2A' | '2B' | 'done';
          cursor?: number;
          runBatchNow?: boolean;
          runBackfillNow?: boolean;
          runRollingRefreshNow?: boolean;
        } | null;

        if (body && typeof body.paused === 'boolean') {
          await env.DB.prepare(
            `INSERT INTO sync_state (key, value, updated_at)
             VALUES ('catalog_seed_paused', ?, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
          )
            .bind(body.paused ? '1' : '0')
            .run();
        }

        if (
          body &&
          (body.stage === '2A' || body.stage === '2B' || body.stage === 'done')
        ) {
          await env.DB.prepare(
            `INSERT INTO sync_state (key, value, updated_at)
             VALUES ('catalog_seed_stage', ?, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
          )
            .bind(body.stage)
            .run();
        }

        if (
          body &&
          typeof body.cursor === 'number' &&
          Number.isFinite(body.cursor) &&
          body.cursor >= 0
        ) {
          await env.DB.prepare(
            `INSERT INTO sync_state (key, value, updated_at)
             VALUES ('catalog_seed_cursor', ?, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
          )
            .bind(String(Math.floor(body.cursor)))
            .run();
        }

        let batchResult: unknown = undefined;
        let backfillResult: unknown = undefined;
        let rollingResult: unknown = undefined;
        if (body?.runBatchNow) {
          batchResult = await syncWorkerBroadCatalogPopulation(env);
          await invalidateEdgeApiCache(request.url);
        }
        if (body?.runBackfillNow) {
          backfillResult = await syncWorkerIgdbMetadataBackfill(env);
          await invalidateEdgeApiCache(request.url);
        }
        if (body?.runRollingRefreshNow) {
          rollingResult = await syncWorkerIgdbSeriesAndCanonical(env);
          await invalidateEdgeApiCache(request.url);
        }

        const status = await getBroadCatalogSeedStatus(env);
        return Response.json({
          success: true,
          status,
          batchResult,
          backfillResult,
          rollingResult,
        });
      }

      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    // Endpoint: GET /api/catalog/games (?manifest=1 or ?chunk=<idx>&v=<version>)
    else if (request.method === 'GET' && path === '/api/catalog/games') {
      if (url.searchParams.get('manifest') === '1') {
        const manifest = await resolveCatalogManifest(env);
        if (manifest) {
          return Response.json(manifest, {
            headers: {
              'Cache-Control':
                'public, max-age=60, s-maxage=60, stale-while-revalidate=86400',
            },
          });
        }
        const fallbackSnapshot = await loadGamesSnapshotForFallback(
          env.BACKUP_BUCKET,
        );
        if (!fallbackSnapshot) {
          return buildD1QuotaExceededResponse();
        }
        const fallbackRows = buildGamesListFromSnapshot(
          fallbackSnapshot,
          null,
          DEFAULT_USER_HOME_REGION,
        );
        const fallbackManifest: CatalogManifest = {
          version: fallbackSnapshot.timestamp || 'r2-fallback',
          timestamp: fallbackSnapshot.timestamp || new Date().toISOString(),
          totalRows: fallbackRows.length,
          chunkSize: CATALOG_GAMES_CHUNK_SIZE,
          chunkCount: 1,
          maxStableId: 0,
          toysTotalRows: 0,
          toysChunkCount: 1,
        };
        return Response.json(fallbackManifest, {
          headers: buildR2DegradedHeaders(fallbackSnapshot.timestamp, {
            'Cache-Control': 'private, no-cache, no-store, must-revalidate',
          }),
        });
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
      };

      if (edgeCache && !isNoCache) {
        const cached = await edgeCache.match(chunkCacheKey);
        if (cached) {
          return cached;
        }
      }

      if (env.BACKUP_BUCKET) {
        try {
          const r2Obj = await env.BACKUP_BUCKET.get(
            getCatalogChunkR2Key(chunkIndex),
          );
          if (r2Obj) {
            const rawBody = r2Obj.body ?? (await r2Obj.text());
            const r2Res = new Response(rawBody, {
              headers: immutableCatalogHeaders,
            });
            if (edgeCache) {
              await putEdgeCacheEntry(
                edgeCache,
                chunkCacheKey,
                r2Res,
                isNoCache,
                true,
              );
            }
            return r2Res;
          }
        } catch {
          // Fall through to single-chunk D1 write-through
        }
      }

      try {
        const { results } = await env.DB.prepare(buildCatalogGamesChunkQuery())
          .bind(CATALOG_GAMES_CHUNK_SIZE, chunkIndex * CATALOG_GAMES_CHUNK_SIZE)
          .all();
        const rows = (results as Array<Record<string, unknown>>) || [];
        if (rows.length > 0) {
          postProcessGameListRows(rows, DEFAULT_USER_HOME_REGION);
        }
        const bodyJson = JSON.stringify(rows);
        if (env.BACKUP_BUCKET) {
          await env.BACKUP_BUCKET.put(
            getCatalogChunkR2Key(chunkIndex),
            bodyJson,
            {
              httpMetadata: { contentType: 'application/json' },
              customMetadata: {
                chunkIndex: String(chunkIndex),
                rowCount: String(rows.length),
                version: versionParam,
              },
            },
          ).catch(() => {});
        }
        const d1Res = new Response(bodyJson, {
          headers: immutableCatalogHeaders,
        });
        if (edgeCache) {
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
        const snapshot = await loadGamesSnapshotForFallback(env.BACKUP_BUCKET);
        if (!snapshot) {
          return buildD1QuotaExceededResponse();
        }
        const allRows = buildGamesListFromSnapshot(
          snapshot,
          null,
          DEFAULT_USER_HOME_REGION,
        );
        const start = chunkIndex * CATALOG_GAMES_CHUNK_SIZE;
        const slice = allRows.slice(start, start + CATALOG_GAMES_CHUNK_SIZE);
        return new Response(JSON.stringify(slice), {
          headers: buildR2DegradedHeaders(snapshot.timestamp, {
            'Content-Type': 'application/json',
            'Cache-Control': 'private, no-cache, no-store, must-revalidate',
          }),
        });
      }
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
      };

      if (edgeCache && !isNoCache) {
        const cached = await edgeCache.match(toyCacheKey);
        if (cached) {
          return cached;
        }
      }

      if (env.BACKUP_BUCKET) {
        try {
          const r2Obj = await env.BACKUP_BUCKET.get(R2_CATALOG_TOYS_CHUNK_KEY);
          if (r2Obj) {
            const rawBody = r2Obj.body ?? (await r2Obj.text());
            const r2Res = new Response(rawBody, {
              headers: immutableCatalogHeaders,
            });
            if (edgeCache) {
              await putEdgeCacheEntry(
                edgeCache,
                toyCacheKey,
                r2Res,
                isNoCache,
                true,
              );
            }
            return r2Res;
          }
        } catch {
          // Fall through to D1 write-through
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
        const bodyJson = JSON.stringify(rows);
        if (env.BACKUP_BUCKET) {
          let maxStableId = 0;
          for (const r of rows) {
            const sid = Number(r['stable_id'] ?? 0);
            if (sid > maxStableId) maxStableId = sid;
          }
          await env.BACKUP_BUCKET.put(R2_CATALOG_TOYS_CHUNK_KEY, bodyJson, {
            httpMetadata: { contentType: 'application/json' },
            customMetadata: {
              rowCount: String(rows.length),
              maxStableId: String(maxStableId),
              timestamp: new Date().toISOString(),
            },
          }).catch(() => {});
        }
        const d1Res = new Response(bodyJson, {
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
        );
        return Response.json(payload, { headers: privateHeaders });
      } catch {
        const snapshot = await loadGamesSnapshotForFallback(env.BACKUP_BUCKET);
        if (!snapshot) {
          return buildD1QuotaExceededResponse();
        }
        const r2Ugr = userId
          ? (snapshot.tables?.['user_game_releases'] || []).filter(
              (r) => Number(r['user_id']) === userId,
            )
          : [];
        const r2Ug = userId
          ? (snapshot.tables?.['user_games'] || []).filter(
              (g) => Number(g['user_id']) === userId,
            )
          : [];
        return Response.json(
          {
            version: snapshot.timestamp || '',
            timestamp: snapshot.timestamp || '',
            maxStableId: 0,
            ugr: r2Ugr,
            ug: r2Ug,
            ut: [],
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
        );
        return Response.json(payload, {
          headers: {
            'Cache-Control': user.is_public
              ? 'public, max-age=60, s-maxage=60'
              : 'private, no-cache, no-store, must-revalidate',
          },
        });
      } catch {
        return buildD1QuotaExceededResponse();
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
          }),
        });
      }
    }

    // Endpoint: GET /api/games/:id
    else if (path.startsWith('/api/games/')) {
      const id = path.split('/').pop() || '';
      const userId = sessionUser ? sessionUser.id : null;
      const effectiveHomeRegion = sessionUser
        ? sessionUser.homeRegion
        : DEFAULT_USER_HOME_REGION;

      try {
        const query = buildGameDetailQuery(userId);
        const params = getGameDetailQueryParams(id, userId);
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

    // Endpoint: GET /api/discovery/search
    else if (path === '/api/discovery/search') {
      if (!sessionUser && !isAuthorizedAdmin(request, env, sessionUser)) {
        return Response.json(
          { error: 'Unauthorized: Authentication required.' },
          { status: 401 },
        );
      }
      const query = url.searchParams.get('query') || '';
      const platformIdParam = url.searchParams.get('platformId');
      const platformId = platformIdParam ? parseInt(platformIdParam, 10) : 0;
      const filterDigitalParam = url.searchParams.get('filterDigital');
      const hideDigitalParam = url.searchParams.get('hideDigital');
      const filterDigital =
        filterDigitalParam !== null
          ? filterDigitalParam === 'true' || filterDigitalParam === '1'
          : hideDigitalParam !== null
            ? hideDigitalParam === 'true' || hideDigitalParam === '1'
            : true;

      if (!query.trim()) {
        return Response.json([]);
      }

      const trackedIgdbIds = Array.from(
        new Set(Object.values(PLATFORM_MAP)),
      ).filter((id): id is number => typeof id === 'number' && id > 0);

      let targetPlatformId: number | null = null;
      if (platformId > 0) {
        const platformRow = (await env.DB.prepare(
          'SELECT display_name, name FROM platforms WHERE id = ?',
        )
          .bind(platformId)
          .first()) as { display_name: string; name: string } | null;

        if (platformRow) {
          targetPlatformId =
            PLATFORM_MAP[platformRow.display_name] ||
            PLATFORM_MAP[platformRow.name] ||
            null;
        }
      }

      const sanitizedQuery = query.replace(/["\\]/g, '');
      const baseWhere = targetPlatformId
        ? `platforms = (${targetPlatformId})`
        : `platforms = (${trackedIgdbIds.join(',')})`;
      const whereClause = `where ${baseWhere} & (game_type = null | (game_type != 5 & game_type != 12)) & (category = null | (category != 5 & category != 12));`;
      const igdbQuery = `
          search "${sanitizedQuery}";
          fields name, cover.url, cover.image_id, first_release_date, platforms.id, platforms.name, summary, genres.name, url, collections.name, franchises.name, category, game_type, alternative_names.name, alternative_names.comment, game_localizations.name, game_localizations.region, game_localizations.cover.url, release_dates.platform, release_dates.region, release_dates.release_region, release_dates.date, remasters.id, remasters.name, remasters.platforms, expanded_games.id, expanded_games.name, expanded_games.platforms, ports.id, ports.name, ports.platforms, involved_companies.company.name, involved_companies.publisher;
          ${whereClause}
          limit 30;
        `;

      try {
        const rawResults = (await queryIGDBEdge(
          'games',
          igdbQuery,
          env,
        )) as Array<{
          id: number;
          name: string;
          cover?: { url?: string; image_id?: string };
          platforms?: Array<{ id: number; name: string }>;
          first_release_date?: number;
          summary?: string;
          genres?: Array<{ name: string }>;
          url?: string;
          collections?: Array<{ name: string }>;
          franchises?: Array<{ name: string }>;
          category?: number;
          game_type?: number;
          alternative_names?: Array<{ name: string; comment?: string }>;
          game_localizations?: Array<{
            name?: string;
            region?: number;
            cover?: { url?: string };
          }>;
          release_dates?: IgdbReleaseDateEntry[];
          remasters?: IgdbRelatedEditionRef[];
          expanded_games?: IgdbRelatedEditionRef[];
          ports?: IgdbRelatedEditionRef[];
          involved_companies?: Array<{
            company?: { name: string };
            publisher?: boolean;
          }>;
        }>;

        let officialResults = (rawResults || []).filter((g) =>
          isOfficialIGDBGame(g),
        );

        // If searching with platformId == 0 or if search across tracked platforms produced 0 results,
        // execute global IGDB fallback without platform filter
        let isGlobalFallback = false;
        if (
          officialResults.length === 0 &&
          (!targetPlatformId || targetPlatformId === 0)
        ) {
          const globalQuery = `
              search "${sanitizedQuery}";
              fields name, cover.url, cover.image_id, first_release_date, platforms.id, platforms.name, summary, genres.name, url, collections.name, franchises.name, category, game_type, alternative_names.name, alternative_names.comment, game_localizations.name, game_localizations.region, game_localizations.cover.url, release_dates.platform, release_dates.region, release_dates.release_region, release_dates.date, remasters.id, remasters.name, remasters.platforms, expanded_games.id, expanded_games.name, expanded_games.platforms, ports.id, ports.name, ports.platforms, involved_companies.company.name, involved_companies.publisher;
              where (game_type = null | (game_type != 5 & game_type != 12)) & (category = null | (category != 5 & category != 12));
              limit 30;
            `;
          const rawGlobal = (await queryIGDBEdge(
            'games',
            globalQuery,
            env,
          )) as typeof rawResults;
          officialResults = (rawGlobal || []).filter((g) =>
            isOfficialIGDBGame(g),
          );
          isGlobalFallback = true;
        }

        if (officialResults.length === 0) {
          return Response.json([]);
        }

        const { results: platformRows } = await env.DB.prepare(
          `SELECT id, display_name, name, launch_date FROM platforms`,
        ).all();

        const igdbToPlatform = new Map<
          number,
          { id: number; displayName: string; launchDate: string | null }
        >();
        (platformRows || []).forEach((p) => {
          const row = p as {
            id: number;
            display_name: string;
            name: string;
            launch_date: string | null;
          };
          const igdbId =
            PLATFORM_MAP[row.display_name] || PLATFORM_MAP[row.name];
          if (igdbId) {
            igdbToPlatform.set(igdbId, {
              id: row.id,
              displayName: row.display_name || row.name,
              launchDate: row.launch_date,
            });
          }
        });
        // Map regional/VR IGDB platform IDs to unified parent local platforms
        const nesPlat = igdbToPlatform.get(18);
        if (nesPlat) igdbToPlatform.set(99, nesPlat);
        const snesPlat = igdbToPlatform.get(19);
        if (snesPlat) igdbToPlatform.set(58, snesPlat);
        const ps4Plat = igdbToPlatform.get(48);
        if (ps4Plat) igdbToPlatform.set(165, ps4Plat);
        const ps5Plat = igdbToPlatform.get(167);
        if (ps5Plat) igdbToPlatform.set(390, ps5Plat);

        // Fast targeted lookup for candidate IGDB IDs (including related remasters/ports) and titles rather than full table scan
        const candidateIgdbIds = Array.from(
          new Set(
            officialResults
              .flatMap((g) => [
                g.id,
                ...(g.remasters || []).map((r) => r.id),
                ...(g.expanded_games || []).map((r) => r.id),
                ...(g.ports || []).map((r) => r.id),
              ])
              .filter(
                (id): id is number =>
                  typeof id === 'number' && Number.isFinite(id),
              ),
          ),
        );
        const candidateTitles = Array.from(
          new Set(officialResults.map((g) => g.name).filter(Boolean)),
        );

        const igdbPlaceholders = candidateIgdbIds.map(() => '?').join(',');
        const titlePlaceholders = candidateTitles.map(() => '?').join(',');

        const { results: existingGames } = await env.DB.prepare(
          `SELECT igdb_id, platform_id, title FROM games WHERE igdb_id IN (${igdbPlaceholders}) OR (title COLLATE NOCASE) IN (${titlePlaceholders})`,
        )
          .bind(...candidateIgdbIds, ...candidateTitles)
          .all();

        const existingSet = new Set<string>();
        (existingGames || []).forEach((g) => {
          const row = g as {
            igdb_id: number | null;
            platform_id: number;
            title: string;
          };
          if (row.igdb_id) {
            existingSet.add(`igdb-${row.igdb_id}-${row.platform_id}`);
          }
          if (row.title) {
            existingSet.add(
              `title-${row.title.toLowerCase().replace(/[^a-z0-9]/g, '')}-${row.platform_id}`,
            );
            existingSet.add(
              `norm-${normalizeTitleForMatching(row.title)}-${row.platform_id}`,
            );
          }
        });

        // Collect relevant local platform IDs and normalized titles to query canonical releases via index
        const candidatePlatIds = new Set<number>();
        const candidateNorms = new Set<string>();
        officialResults.forEach((g) => {
          (g.platforms || []).forEach((p) => {
            const localPlat = igdbToPlatform.get(p.id);
            if (localPlat) candidatePlatIds.add(localPlat.id);
          });
          const baseNorm = normalizeTitleForMatching(g.name);
          if (baseNorm) candidateNorms.add(baseNorm);
          (g.alternative_names || []).forEach((a) => {
            const altNorm = normalizeTitleForMatching(a.name || '');
            if (altNorm && altNorm.length >= 4) candidateNorms.add(altNorm);
          });
        });

        let canonicalReleasesList: CanonicalRelease[] = [];
        if (candidatePlatIds.size > 0 && candidateNorms.size > 0) {
          const platIdArr = Array.from(candidatePlatIds);
          const normArr = Array.from(candidateNorms);
          const platPlaceholders = platIdArr.map(() => '?').join(',');
          const normPlaceholders = normArr.map(() => '?').join(',');
          const { results: canonicalRows } = await env.DB.prepare(
            `SELECT platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, serial_code, barcode, publisher, is_verified_physical
               FROM canonical_releases WHERE platform_id IN (${platPlaceholders}) AND normalized_title IN (${normPlaceholders})`,
          )
            .bind(...platIdArr, ...normArr)
            .all();
          canonicalReleasesList = (canonicalRows ||
            []) as unknown as CanonicalRelease[];
        }

        const normalized = officialResults
          .map((g) => {
            const cleanTitle = g.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            const normTitle = normalizeTitleForMatching(g.name);
            const publisherName =
              g.involved_companies?.find((ic) => ic.publisher)?.company?.name ||
              null;

            let imageUrl: string | null = null;
            if (g.cover?.image_id) {
              imageUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg`;
            } else if (g.cover?.url) {
              imageUrl = g.cover.url.startsWith('//')
                ? `https:${g.cover.url}`
                : g.cover.url;
              imageUrl = imageUrl.replace('/t_thumb/', '/t_cover_big/');
            }

            const candidatePlatforms = (g.platforms || []).filter((p) => {
              return targetPlatformId
                ? p.id === targetPlatformId
                : trackedIgdbIds.includes(p.id);
            });

            // Untracked platform detection for global fallback
            const allPlatformNames = (g.platforms || [])
              .map((p) => p.name)
              .filter(Boolean);
            const untrackedPlatforms =
              isGlobalFallback && candidatePlatforms.length === 0
                ? allPlatformNames
                : undefined;

            if (candidatePlatforms.length === 0) {
              if (isGlobalFallback) {
                // Check if already tracked under Platform 0 or elsewhere
                const isAlreadyOwned =
                  existingSet.has(`igdb-${g.id}-0`) ||
                  existingSet.has(`title-${cleanTitle}-0`) ||
                  existingSet.has(`norm-${normTitle}-0`);

                if (isAlreadyOwned) {
                  return null;
                }

                return {
                  id: `igdb-${g.id}`,
                  name: g.name,
                  platform: 'Physical Watch',
                  platform_id: 0,
                  image_url: imageUrl,
                  summary: g.summary || null,
                  genres: g.genres?.map((ge) => ge.name).join(', ') || null,
                  igdb_url: g.url || null,
                  collections:
                    g.collections?.map((c) => c.name).join(', ') || null,
                  franchises:
                    g.franchises?.map((f) => f.name).join(', ') || null,
                  physical_status: 'not_yet_physical' as const,
                  verification_tier: 0,
                  is_physical: false,
                  physical_regions: [],
                  region: 'USA',
                  matched_releases: [],
                  verification_reasons: [
                    'Game has not released on tracked physical consoles. Tracked on physical wishlist.',
                  ],
                  first_release_date: g.first_release_date
                    ? new Date(g.first_release_date * 1000)
                        .toISOString()
                        .split('T')[0]
                    : null,
                  physical_platforms: [
                    {
                      platform_id: 0,
                      platform_name: 'Physical Watch',
                      physical_status: 'not_yet_physical' as const,
                      is_physical: false,
                      is_owned: false,
                      matched_releases_count: 0,
                      matched_releases: [],
                    },
                  ],
                  untracked_platforms: untrackedPlatforms,
                };
              }
              return null;
            }

            const physicalPlatformOptions: Array<{
              platform_id: number;
              platform_name: string;
              physical_status: ReturnType<
                typeof detectPhysicalReleaseStatus
              >['physical_status'];
              is_physical: boolean;
              is_owned: boolean;
              matched_releases_count: number;
              first_release_date: string | null;
              matched_releases: Array<{
                name: string;
                romName: string;
                romCrc: string | null;
                region: string | null;
                variants: string | null;
                releaseDate: string | null;
                canonical_release_id: number | null;
                serial_code: string | null;
                barcode: string | null;
                is_physical: boolean | number;
                image_url: string | null;
              }>;
              verification: ReturnType<typeof detectPhysicalReleaseStatus>;
            }> = [];

            const isWatchedOnNoPlatform =
              existingSet.has(`igdb-${g.id}-0`) ||
              existingSet.has(`title-${cleanTitle}-0`) ||
              existingSet.has(`norm-${normTitle}-0`);

            const seenLocalPlatformIds = new Set<number>();

            for (const p of candidatePlatforms) {
              const localPlat = igdbToPlatform.get(p.id);
              if (!localPlat) continue;
              if (seenLocalPlatformIds.has(localPlat.id)) continue;

              const verification = detectPhysicalReleaseStatus({
                platformId: localPlat.id,
                gameTitle: g.name,
                alternativeNames: g.alternative_names,
                firstReleaseDate: g.first_release_date,
                platformLaunchDate: localPlat.launchDate,
                publisher: publisherName,
                igdbCategory: g.game_type ?? g.category,
                canonicalReleases: canonicalReleasesList,
              });

              if (
                filterDigital &&
                verification.physical_status === 'digital_only'
              ) {
                continue;
              }

              if (
                shouldSuppressCrossGenBasePlatform({
                  game: g,
                  igdbPlatformId: p.id,
                  platformLaunchDate: localPlat.launchDate,
                  isBaseVerifiedPhysicalOnPlatform:
                    verification.physical_status === 'verified_physical',
                  isRelatedIgdbIdOwnedOnPlatform: (relId) =>
                    existingSet.has(`igdb-${relId}-${localPlat.id}`),
                })
              ) {
                continue;
              }

              seenLocalPlatformIds.add(localPlat.id);

              const isAlreadyOwned =
                existingSet.has(`igdb-${g.id}-${localPlat.id}`) ||
                existingSet.has(`title-${cleanTitle}-${localPlat.id}`) ||
                existingSet.has(`norm-${normTitle}-${localPlat.id}`) ||
                (!verification.is_physical && isWatchedOnNoPlatform);

              const optionRegion =
                verification.physical_regions.length === 1 &&
                verification.physical_regions[0] === 'Japan'
                  ? 'Japan'
                  : 'USA';
              const platformFirstReleaseDate = resolveIgdbPlatformReleaseDate(
                g.release_dates,
                p.id,
                localPlat.launchDate,
                optionRegion,
                g.first_release_date,
              );

              const matchedReleasesFormatted =
                verification.matched_releases.map((mr) => ({
                  name: mr.raw_title,
                  romName: mr.rom_name || mr.raw_title,
                  romCrc: mr.rom_crc || null,
                  region: mr.region || null,
                  variants: mr.variants || null,
                  releaseDate:
                    resolveIgdbPlatformReleaseDate(
                      g.release_dates,
                      p.id,
                      localPlat.launchDate,
                      mr.region || optionRegion,
                      g.first_release_date,
                    ) || platformFirstReleaseDate,
                  canonical_release_id: mr.id || null,
                  serial_code: mr.serial_code || null,
                  barcode: mr.barcode || null,
                  is_physical: mr.is_verified_physical,
                  image_url:
                    resolveRegionalCoverUrl(
                      { game_localizations: g.game_localizations },
                      mr.region,
                    ) || null,
                }));

              physicalPlatformOptions.push({
                platform_id: localPlat.id,
                platform_name: localPlat.displayName,
                physical_status: verification.physical_status,
                is_physical: verification.is_physical,
                is_owned: isAlreadyOwned,
                matched_releases_count: matchedReleasesFormatted.length,
                first_release_date: platformFirstReleaseDate,
                matched_releases: matchedReleasesFormatted,
                verification,
              });
            }

            if (physicalPlatformOptions.length === 0) {
              return null;
            }

            const unownedOptions = physicalPlatformOptions.filter(
              (po) => !po.is_owned,
            );
            if (unownedOptions.length === 0) {
              return null;
            }

            const primary = unownedOptions[0] || physicalPlatformOptions[0];

            return {
              id: `igdb-${g.id}`,
              name: g.name,
              platform: primary.platform_name,
              platform_id: primary.platform_id,
              image_url: imageUrl,
              summary: g.summary || null,
              genres: g.genres?.map((ge) => ge.name).join(', ') || null,
              igdb_url: g.url || null,
              collections: g.collections?.map((c) => c.name).join(', ') || null,
              franchises: g.franchises?.map((f) => f.name).join(', ') || null,
              physical_status: primary.physical_status,
              verification_tier: primary.verification.verification_tier,
              is_physical: primary.is_physical,
              physical_regions: primary.verification.physical_regions,
              region:
                primary.verification.physical_regions.length === 1 &&
                primary.verification.physical_regions[0] === 'Japan'
                  ? 'Japan'
                  : 'USA',
              matched_releases: primary.matched_releases,
              verification_reasons: primary.verification.reasons,
              first_release_date: primary.first_release_date,
              physical_platforms: physicalPlatformOptions.map((po) => ({
                platform_id: po.platform_id,
                platform_name: po.platform_name,
                physical_status: po.physical_status,
                is_physical: po.is_physical,
                is_owned: po.is_owned,
                matched_releases_count: po.matched_releases_count,
                first_release_date: po.first_release_date,
                matched_releases: po.matched_releases,
              })),
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);

        return Response.json(normalized);
      } catch (err: unknown) {
        console.error('[DiscoverySearch] Error:', err);
        return Response.json(
          { error: 'Internal discovery search error' },
          { status: 500 },
        );
      }
    }

    // Endpoint: GET /api/discovery/matches
    else if (path === '/api/discovery/matches') {
      if (!sessionUser && !isAuthorizedAdmin(request, env, sessionUser)) {
        return Response.json(
          { error: 'Unauthorized: Authentication required.' },
          { status: 401 },
        );
      }
      const igdbIdParam = url.searchParams.get('igdbId');
      const platformIdParam = url.searchParams.get('platformId');
      const cleanIgdbId = (igdbIdParam || '').replace('igdb-', '').trim();
      const platformId = platformIdParam ? parseInt(platformIdParam, 10) : 0;

      if (!cleanIgdbId) {
        return Response.json({ error: 'Missing igdbId' }, { status: 400 });
      }
      if (!/^\d+$/.test(cleanIgdbId)) {
        return Response.json({ error: 'Invalid igdbId' }, { status: 400 });
      }

      try {
        const rawGames = (await queryIGDBEdge(
          'games',
          `fields name, cover.url, cover.image_id, first_release_date, platforms.id, platforms.name, summary, genres.name, url, collections.name, franchises.name, category, game_type, alternative_names.name, alternative_names.comment, game_localizations.name, game_localizations.region, game_localizations.cover.url, release_dates.platform, release_dates.region, release_dates.release_region, release_dates.date, involved_companies.company.name, involved_companies.publisher; where id = ${cleanIgdbId}; limit 1;`,
          env,
        )) as Array<{
          id: number;
          name: string;
          cover?: { url?: string; image_id?: string };
          platforms?: Array<{ id: number; name: string }>;
          first_release_date?: number;
          summary?: string;
          genres?: Array<{ name: string }>;
          url?: string;
          collections?: Array<{ name: string }>;
          franchises?: Array<{ name: string }>;
          category?: number;
          game_type?: number;
          alternative_names?: Array<{ name: string; comment?: string }>;
          game_localizations?: Array<{
            name?: string;
            region?: number;
            cover?: { url?: string };
          }>;
          release_dates?: IgdbReleaseDateEntry[];
          involved_companies?: Array<{
            company?: { name: string };
            publisher?: boolean;
          }>;
        }>;

        if (!rawGames || rawGames.length === 0) {
          return Response.json(
            { error: 'Game not found on IGDB' },
            { status: 404 },
          );
        }

        const g = rawGames[0];
        let imageUrl: string | null = null;
        if (g.cover?.image_id) {
          imageUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg`;
        } else if (g.cover?.url) {
          imageUrl = g.cover.url.startsWith('//')
            ? `https:${g.cover.url}`
            : g.cover.url;
          imageUrl = imageUrl.replace('/t_thumb/', '/t_cover_big/');
        }

        let localPlatformId = platformId;
        let platformLaunchDate: string | null = null;
        let targetIgdbPlatformId: number | null =
          g.platforms && g.platforms.length > 0 ? g.platforms[0].id : null;
        let platformDisplayName =
          g.platforms && g.platforms.length > 0
            ? g.platforms[0].name
            : 'Unknown';

        if (platformId > 0) {
          const platformRow = (await env.DB.prepare(
            'SELECT id, display_name, name, launch_date FROM platforms WHERE id = ?',
          )
            .bind(platformId)
            .first()) as {
            id: number;
            display_name: string;
            name: string;
            launch_date: string | null;
          } | null;

          if (platformRow) {
            localPlatformId = platformRow.id;
            platformDisplayName = platformRow.display_name || platformRow.name;
            platformLaunchDate = platformRow.launch_date;
            targetIgdbPlatformId =
              PLATFORM_MAP[platformRow.display_name] ||
              PLATFORM_MAP[platformRow.name] ||
              targetIgdbPlatformId;
          }
        }

        // Fetch canonical releases from D1 for this platform (including alternative name normalized titles)
        const gameClean =
          normalizeTitleForMatching(g.name) ||
          g.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const altNorms = Array.from(
          new Set(
            (g.alternative_names || [])
              .map((a) => normalizeTitleForMatching(a.name || ''))
              .filter((n) => n.length >= 4),
          ),
        );

        const exactNorms = Array.from(
          new Set([gameClean, ...altNorms].filter(Boolean)),
        );
        let initialCanonicalRows: unknown[] | undefined;

        if (exactNorms.length > 0) {
          const exactRes = await env.DB.prepare(
            `SELECT id, platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, serial_code, barcode, publisher, is_verified_physical
             FROM canonical_releases
             WHERE platform_id = ? AND normalized_title IN (${exactNorms.map(() => '?').join(',')})`,
          )
            .bind(localPlatformId, ...exactNorms)
            .all();
          initialCanonicalRows = exactRes.results;
        }

        if (!initialCanonicalRows || initialCanonicalRows.length === 0) {
          let canonicalQuery = `SELECT id, platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, serial_code, barcode, publisher, is_verified_physical
               FROM canonical_releases WHERE platform_id = ? AND (normalized_title LIKE ? OR raw_title LIKE ?`;
          const bindArgs: Array<string | number> = [
            localPlatformId,
            `%${gameClean}%`,
            `%${g.name}%`,
          ];
          if (altNorms.length > 0) {
            canonicalQuery += ` OR normalized_title IN (${altNorms.map(() => '?').join(',')})`;
            bindArgs.push(...altNorms);
          }
          canonicalQuery += ')';

          const fallbackRes = await env.DB.prepare(canonicalQuery)
            .bind(...bindArgs)
            .all();
          initialCanonicalRows = fallbackRes.results;
        }
        const canonicalRows = (initialCanonicalRows ||
          []) as unknown as CanonicalRelease[];

        const publisherName =
          g.involved_companies?.find((ic) => ic.publisher)?.company?.name ||
          null;

        const verification = detectPhysicalReleaseStatus({
          platformId: localPlatformId,
          gameTitle: g.name,
          alternativeNames: g.alternative_names,
          firstReleaseDate: g.first_release_date,
          platformLaunchDate,
          publisher: publisherName,
          igdbCategory: g.game_type ?? g.category,
          canonicalReleases: canonicalRows,
        });

        const primaryRegion =
          verification.physical_regions.length === 1 &&
          verification.physical_regions[0] === 'Japan'
            ? 'Japan'
            : 'USA';
        const platformFirstReleaseDate = resolveIgdbPlatformReleaseDate(
          g.release_dates,
          targetIgdbPlatformId,
          platformLaunchDate,
          primaryRegion,
          g.first_release_date,
        );

        const matchedReleasesFormatted = verification.matched_releases.map(
          (mr) => ({
            name: mr.raw_title,
            romName: mr.rom_name || mr.raw_title,
            romCrc: mr.rom_crc || null,
            region: mr.region || null,
            variants: mr.variants || null,
            also_released_as: mr.also_released_as || null,
            releaseDate:
              resolveIgdbPlatformReleaseDate(
                g.release_dates,
                targetIgdbPlatformId,
                platformLaunchDate,
                mr.region || primaryRegion,
                g.first_release_date,
              ) || platformFirstReleaseDate,
            canonical_release_id: mr.id || null,
            serial_code: mr.serial_code || null,
            barcode: mr.barcode || null,
            is_physical: mr.is_verified_physical,
            image_url:
              resolveRegionalCoverUrl(
                { game_localizations: g.game_localizations },
                mr.region,
              ) || null,
          }),
        );

        const game = {
          id: `igdb-${g.id}`,
          name: g.name,
          platform: platformDisplayName,
          platform_id: localPlatformId,
          image_url: imageUrl,
          summary: g.summary || null,
          genres: g.genres?.map((ge) => ge.name).join(', ') || null,
          igdb_url: g.url || null,
          collections: g.collections?.map((c) => c.name).join(', ') || null,
          franchises: g.franchises?.map((f) => f.name).join(', ') || null,
          physical_status: verification.physical_status,
          verification_tier: verification.verification_tier,
          is_physical: verification.is_physical,
          physical_regions: verification.physical_regions,
          region: primaryRegion,
          first_release_date: platformFirstReleaseDate,
          verification_reasons: verification.reasons,
        };

        return Response.json({
          game,
          matchedReleases: matchedReleasesFormatted,
          physical_status: verification.physical_status,
          verification_tier: verification.verification_tier,
          physical_regions: verification.physical_regions,
          verification_reasons: verification.reasons,
        });
      } catch (err: unknown) {
        console.error('[DiscoveryMatches] Error:', err);
        return Response.json(
          { error: 'Internal discovery error' },
          { status: 500 },
        );
      }
    }

    // Endpoint: GET /api/discovery/scan-series
    else if (path === '/api/discovery/scan-series') {
      if (!isAuthorizedAdmin(request, env, sessionUser)) {
        return Response.json(
          { error: 'Unauthorized: Admin authentication required.' },
          { status: 403 },
        );
      }

      const filterDigitalParam = url.searchParams.get('filterDigital');
      const hideDigitalParam = url.searchParams.get('hideDigital');
      const filterDigital =
        filterDigitalParam !== null
          ? filterDigitalParam === 'true' || filterDigitalParam === '1'
          : hideDigitalParam !== null
            ? hideDigitalParam === 'true' || hideDigitalParam === '1'
            : true;

      try {
        const specificSeries = url.searchParams.get('series');
        const offsetParam = url.searchParams.get('offset');
        const limitParam = url.searchParams.get('limit');
        const isPaged = offsetParam !== null;
        const offset = offsetParam ? Math.max(0, parseInt(offsetParam, 10)) : 0;
        const limit = limitParam
          ? Math.min(40, Math.max(1, parseInt(limitParam, 10)))
          : 30;

        let canonicalSeriesList: string[] = [];
        let totalSeriesCount = 0;
        let ownedKeys: Set<string>;

        const platformMeta = await getCachedPlatformMetadata(env);
        const igdbToPlatformId = platformMeta.igdbToPlatformId;

        if (specificSeries && specificSeries.trim()) {
          const trimmed = specificSeries.trim();
          canonicalSeriesList = [trimmed];
          totalSeriesCount = 1;

          if (
            cachedSeriesScanMetadata &&
            cachedSeriesScanMetadata.expiresAt > Date.now()
          ) {
            ownedKeys = cachedSeriesScanMetadata.ownedKeys;
          } else {
            // Targeted franchise scan: query only matching or related series records
            const { results: scopedGames } = await env.DB.prepare(
              `SELECT g.igdb_id, g.platform_id, g.title FROM games g
                 WHERE g.canonical_series = ? OR g.series = ? OR LOWER(g.title) LIKE ?`,
            )
              .bind(trimmed, trimmed, `%${trimmed.toLowerCase()}%`)
              .all();

            ownedKeys = new Set<string>();
            (scopedGames || []).forEach((g) => {
              const row = g as {
                igdb_id: number | null;
                platform_id: number;
                title: string | null;
              };
              const effPid =
                platformMeta.parentMap.get(row.platform_id) || row.platform_id;
              if (row.igdb_id) {
                ownedKeys.add(`igdb:${row.igdb_id}:${effPid}`);
              }
              if (row.title) {
                ownedKeys.add(
                  `raw:${row.title.toLowerCase().replace(/[^a-z0-9]/g, '')}:${effPid}`,
                );
                ownedKeys.add(
                  `norm:${normalizeTitleForMatching(row.title)}:${effPid}`,
                );
              }
            });
          }
        } else {
          // Full or progressive series scan
          if (
            !cachedSeriesScanMetadata ||
            cachedSeriesScanMetadata.expiresAt <= Date.now()
          ) {
            const { results: allSeriesRows } = await env.DB.prepare(
              `SELECT canonical_series, COUNT(*) as c FROM games
                 WHERE canonical_series IS NOT NULL AND canonical_series != ''
                 GROUP BY canonical_series
                 ORDER BY c DESC, canonical_series ASC`,
            ).all();

            const allSeries = (allSeriesRows || [])
              .map((r) => (r as { canonical_series: string }).canonical_series)
              .filter(Boolean);

            const { results: existingGames } = await env.DB.prepare(
              `SELECT g.igdb_id, g.platform_id, g.title FROM games g`,
            ).all();

            const fullOwnedKeys = new Set<string>();
            (existingGames || []).forEach((g) => {
              const row = g as {
                igdb_id: number | null;
                platform_id: number;
                title: string | null;
              };
              const effPid =
                platformMeta.parentMap.get(row.platform_id) || row.platform_id;
              if (row.igdb_id) {
                fullOwnedKeys.add(`igdb:${row.igdb_id}:${effPid}`);
              }
              if (row.title) {
                fullOwnedKeys.add(
                  `raw:${row.title.toLowerCase().replace(/[^a-z0-9]/g, '')}:${effPid}`,
                );
                fullOwnedKeys.add(
                  `norm:${normalizeTitleForMatching(row.title)}:${effPid}`,
                );
              }
            });

            cachedSeriesScanMetadata = {
              allSeries,
              parentMap: platformMeta.parentMap,
              igdbToPlatformId: platformMeta.igdbToPlatformId,
              ownedKeys: fullOwnedKeys,
              expiresAt: Date.now() + 60 * 60 * 1000,
            };
          }

          const { allSeries } = cachedSeriesScanMetadata;
          ownedKeys = cachedSeriesScanMetadata.ownedKeys;
          totalSeriesCount = allSeries.length;
          if (isPaged) {
            canonicalSeriesList = allSeries.slice(offset, offset + limit);
          } else {
            canonicalSeriesList = allSeries.slice(0, 30);
          }
        }

        if (canonicalSeriesList.length === 0) {
          if (isPaged) {
            return Response.json({
              suggestions: [],
              offset,
              limit,
              totalSeries: totalSeriesCount,
              hasMore: false,
            });
          }
          return Response.json([]);
        }

        const suggestions: unknown[] = [];
        const token = await getEdgeTwitchToken(env);
        if (!token) {
          return Response.json([]);
        }

        type EdgeSeriesGame = {
          id: number;
          name: string;
          cover?: { url?: string; image_id?: string };
          platforms?: Array<{ id: number; name: string }>;
          first_release_date?: number;
          summary?: string;
          genres?: Array<{ name: string }>;
          url?: string;
          collections?: Array<{ name: string }>;
          franchises?: Array<{ name: string }>;
          category?: number;
          game_type?: number;
          alternative_names?: Array<{ name: string; comment?: string }>;
          game_localizations?: Array<{
            name?: string;
            region?: number;
            cover?: { url?: string };
          }>;
          release_dates?: IgdbReleaseDateEntry[];
          remasters?: IgdbRelatedEditionRef[];
          expanded_games?: IgdbRelatedEditionRef[];
          ports?: IgdbRelatedEditionRef[];
          involved_companies?: Array<{
            company?: { name: string };
            publisher?: boolean;
          }>;
        };

        const SERIES_PER_BLOCK = 15;
        const BLOCKS_PER_MULTIQUERY = 10;
        const seriesBlocks: string[][] = [];
        for (let i = 0; i < canonicalSeriesList.length; i += SERIES_PER_BLOCK) {
          seriesBlocks.push(canonicalSeriesList.slice(i, i + SERIES_PER_BLOCK));
        }

        const igdbFields =
          'id, name, cover.url, cover.image_id, first_release_date, summary, genres.name, url, collections.name, franchises.name, platforms.id, platforms.name, category, game_type, alternative_names.name, alternative_names.comment, game_localizations.name, game_localizations.region, game_localizations.cover.url, release_dates.platform, release_dates.region, release_dates.release_region, release_dates.date, remasters.id, remasters.name, remasters.platforms, expanded_games.id, expanded_games.name, expanded_games.platforms, ports.id, ports.name, ports.platforms, involved_companies.company.name, involved_companies.publisher';

        const candidateEntries: Array<{
          game: EdgeSeriesGame;
          igdbPlatformId: number;
          mapped: {
            id: number;
            displayName: string;
            launchDate: string | null;
          };
        }> = [];
        const emittedKeys = new Set<string>();

        for (let b = 0; b < seriesBlocks.length; b += BLOCKS_PER_MULTIQUERY) {
          const group = seriesBlocks.slice(b, b + BLOCKS_PER_MULTIQUERY);
          const multiqueryBody = group
            .map((names, idx) => {
              const quoted = names
                .map((n) => `"${n.replace(/["\\]/g, '')}"`)
                .join(',');
              return `query games "b${idx}" { fields ${igdbFields}; where (collections.name = (${quoted}) | franchises.name = (${quoted})) & (game_type = null | (game_type != 5 & game_type != 12)) & (category = null | (category != 5 & category != 12)); limit 40; };`;
            })
            .join('\n');

          try {
            const rawMq = await queryIGDBEdge(
              'multiquery',
              multiqueryBody,
              env,
            );
            const gamesFromBatch: EdgeSeriesGame[] = [];
            for (const item of rawMq || []) {
              if (
                item &&
                typeof item === 'object' &&
                'result' in item &&
                Array.isArray((item as { result?: unknown[] }).result)
              ) {
                gamesFromBatch.push(
                  ...((item as { result: EdgeSeriesGame[] }).result || []),
                );
              } else if (item && typeof item === 'object' && 'id' in item) {
                gamesFromBatch.push(item as EdgeSeriesGame);
              }
            }

            for (const g of gamesFromBatch) {
              if (!isOfficialIGDBGame(g)) continue;
              if (!g.platforms) continue;

              // When scanning a specific targeted franchise (specificSeries), prevent crossover explosion
              // where games have unrelated collections/franchises tagged (e.g. Smash Bros tagged with Mario, Sonic, Persona)
              if (specificSeries && specificSeries.trim()) {
                const computedSeries = computeGameCanonicalSeries({
                  title: g.name,
                  collections: g.collections?.map((c) => c.name).join(', '),
                  franchises: g.franchises?.map((f) => f.name).join(', '),
                });
                const normComputed = (computedSeries || '')
                  .toLowerCase()
                  .trim();
                const normTitle = (g.name || '').toLowerCase().trim();

                const matchesRequestedSeries = canonicalSeriesList.some((s) => {
                  const normS = s.toLowerCase().trim();
                  if (normComputed === normS || normTitle.includes(normS))
                    return true;
                  const collMatches = (g.collections || []).some(
                    (c) => c.name.toLowerCase().trim() === normS,
                  );
                  if (collMatches) return true;
                  // If matching only via franchise tag, require title or computedSeries alignment to avoid crossover contamination
                  const franMatches = (g.franchises || []).some(
                    (f) => f.name.toLowerCase().trim() === normS,
                  );
                  if (franMatches) {
                    return (
                      normTitle.includes(normS) || normComputed.includes(normS)
                    );
                  }
                  return false;
                });

                if (!matchesRequestedSeries) continue;
              }

              for (const plat of g.platforms) {
                const mapped = igdbToPlatformId.get(plat.id);
                if (!mapped) continue;

                const emitKey = `${g.id}:${mapped.id}`;
                if (emittedKeys.has(emitKey)) continue;

                const rawKey = `raw:${(g.name || '').toLowerCase().replace(/[^a-z0-9]/g, '')}:${mapped.id}`;
                const normKey = `norm:${normalizeTitleForMatching(g.name || '')}:${mapped.id}`;
                if (
                  ownedKeys.has(`igdb:${g.id}:${mapped.id}`) ||
                  ownedKeys.has(rawKey) ||
                  ownedKeys.has(normKey)
                ) {
                  continue;
                }
                emittedKeys.add(emitKey);
                candidateEntries.push({
                  game: g,
                  igdbPlatformId: plat.id,
                  mapped,
                });
              }
            }
          } catch (mqErr) {
            console.warn('[WorkerDiscovery] Multiquery batch failed:', mqErr);
          }
        }

        // Prefetch matching canonical_releases from D1 for all candidate normalized titles in chunks
        const candidateNorms = new Set<string>();
        for (const { game: g } of candidateEntries) {
          const baseNorm = normalizeTitleForMatching(g.name || '');
          if (baseNorm) candidateNorms.add(baseNorm);
          for (const seg of (g.name || '').split(/(?:\s+-\s+|:)/)) {
            const segNorm = normalizeTitleForMatching(seg);
            if (segNorm && segNorm.length >= 4) candidateNorms.add(segNorm);
          }
          for (const alt of g.alternative_names || []) {
            const altNorm = normalizeTitleForMatching(alt.name || '');
            if (altNorm && altNorm.length >= 4) candidateNorms.add(altNorm);
          }
        }

        const allCanonicalRows: CanonicalRelease[] = [];
        const normArr = Array.from(candidateNorms);
        const CHUNK_SIZE = 80;
        for (let i = 0; i < normArr.length; i += CHUNK_SIZE) {
          const chunk = normArr.slice(i, i + CHUNK_SIZE);
          const placeholders = chunk.map(() => '?').join(',');
          const { results: rows } = await env.DB.prepare(
            `SELECT id, platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, serial_code, barcode, publisher, is_verified_physical
               FROM canonical_releases WHERE normalized_title IN (${placeholders})`,
          )
            .bind(...chunk)
            .all();
          if (rows) {
            allCanonicalRows.push(...(rows as unknown as CanonicalRelease[]));
          }
        }

        for (const { game: g, igdbPlatformId, mapped } of candidateEntries) {
          let imageUrl: string | null = null;
          if (g.cover?.image_id) {
            imageUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg`;
          } else if (g.cover?.url) {
            imageUrl = g.cover.url.startsWith('//')
              ? `https:${g.cover.url}`
              : g.cover.url;
            imageUrl = imageUrl.replace('/t_thumb/', '/t_cover_big/');
          }

          const publisherName =
            g.involved_companies?.find((ic) => ic.publisher)?.company?.name ||
            null;

          const verification = detectPhysicalReleaseStatus({
            platformId: mapped.id,
            gameTitle: g.name,
            alternativeNames: g.alternative_names,
            firstReleaseDate: g.first_release_date,
            platformLaunchDate: mapped.launchDate,
            publisher: publisherName,
            igdbCategory: g.game_type ?? g.category,
            canonicalReleases: allCanonicalRows,
          });

          if (
            filterDigital &&
            verification.physical_status === 'digital_only'
          ) {
            continue;
          }

          if (
            shouldSuppressCrossGenBasePlatform({
              game: g,
              igdbPlatformId,
              platformLaunchDate: mapped.launchDate,
              isBaseVerifiedPhysicalOnPlatform:
                verification.physical_status === 'verified_physical',
              isRelatedIgdbIdOwnedOnPlatform: (relId) =>
                ownedKeys.has(`igdb:${relId}:${mapped.id}`),
            })
          ) {
            continue;
          }

          const primaryRegion =
            verification.physical_regions.length === 1 &&
            verification.physical_regions[0] === 'Japan'
              ? 'Japan'
              : 'USA';
          const platformFirstReleaseDate = resolveIgdbPlatformReleaseDate(
            g.release_dates,
            igdbPlatformId,
            mapped.launchDate,
            primaryRegion,
            g.first_release_date,
          );

          const matchedReleasesFormatted = verification.matched_releases.map(
            (mr) => ({
              name: mr.raw_title,
              romName: mr.rom_name || mr.raw_title,
              romCrc: mr.rom_crc || null,
              region: mr.region || null,
              variants: mr.variants || null,
              releaseDate:
                resolveIgdbPlatformReleaseDate(
                  g.release_dates,
                  igdbPlatformId,
                  mapped.launchDate,
                  mr.region || primaryRegion,
                  g.first_release_date,
                ) || platformFirstReleaseDate,
              canonical_release_id: mr.id || null,
              serial_code: mr.serial_code || null,
              barcode: mr.barcode || null,
              is_physical: mr.is_verified_physical,
              image_url:
                resolveRegionalCoverUrl(
                  { game_localizations: g.game_localizations },
                  mr.region,
                ) || null,
            }),
          );

          suggestions.push({
            id: g.id,
            title: g.name,
            platform: mapped.displayName,
            platform_id: mapped.id,
            image_url: imageUrl,
            summary: g.summary || null,
            collections: g.collections?.map((c) => c.name).join(', ') || null,
            franchises: g.franchises?.map((f) => f.name).join(', ') || null,
            genres: g.genres?.map((ge) => ge.name).join(', ') || null,
            igdb_url: g.url || null,
            region: primaryRegion,
            releases: matchedReleasesFormatted,
            physical_status: verification.physical_status,
            verification_tier: verification.verification_tier,
            is_physical: verification.is_physical,
            physical_regions: verification.physical_regions,
            verification_reasons: verification.reasons,
            first_release_date: platformFirstReleaseDate,
          });
        }

        if (isPaged) {
          return Response.json({
            suggestions,
            offset,
            limit,
            totalSeries: totalSeriesCount,
            hasMore: offset + limit < totalSeriesCount,
          });
        }

        return Response.json(suggestions);
      } catch (err: unknown) {
        console.error('[DiscoveryScanSeries] Error:', err);
        return Response.json(
          { error: 'Internal discovery error' },
          { status: 500 },
        );
      }
    }

    // Endpoint: GET /api/discovery/scan-amiibo
    else if (path === '/api/discovery/scan-amiibo') {
      if (!isAuthorizedAdmin(request, env, sessionUser)) {
        return Response.json(
          { error: 'Unauthorized: Admin authentication required.' },
          { status: 403 },
        );
      }

      try {
        const response = await fetch('https://amiiboapi.org/api/amiibo/', {
          headers: { 'User-Agent': 'CollectionTracker/1.0' },
        });
        if (!response.ok) {
          throw new Error(`AmiiboAPI failed: ${response.status}`);
        }
        const data = (await response.json()) as {
          amiibo: Array<{
            head: string;
            tail: string;
            name: string;
            amiiboSeries: string;
            gameSeries?: string;
            type: string;
            image: string;
            release?: { na?: string; jp?: string; eu?: string };
          }>;
        };

        const { results: existingRows } = await env.DB.prepare(
          `SELECT id, name, amiibo_id FROM toys WHERE line = 'amiibo'`,
        ).all();

        const existingIds = new Set<string>();
        const existingNames = new Set<string>();
        (existingRows || []).forEach((r) => {
          const row = r as {
            id: string;
            name: string;
            amiibo_id?: string | null;
          };
          if (row.amiibo_id) existingIds.add(row.amiibo_id);
          if (row.id) existingIds.add(row.id);
          if (row.name) existingNames.add(row.name.toLowerCase().trim());
        });

        const missingAmiibo: unknown[] = [];
        for (const a of data.amiibo || []) {
          const amiiboId = `${a.head}${a.tail}`;
          const cleanName = (a.name || '').toLowerCase().trim();
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
          } = resolveAmiiboRegionsAndMetadata(
            a.release as {
              na?: string | null;
              eu?: string | null;
              jp?: string | null;
              au?: string | null;
            },
          );

          const poseExpansions = MULTI_POSE_AMIIBO_EXPANSIONS[amiiboId];
          if (poseExpansions && poseExpansions.length > 0) {
            for (const p of poseExpansions) {
              const poseName = `${a.name}${p.nameSuffix}`;
              const poseCleanName = poseName.toLowerCase().trim();
              const poseId = p.slugSuffix
                ? `${amiiboId}${p.slugSuffix}`
                : amiiboId;
              if (existingNames.has(poseCleanName) || existingIds.has(poseId)) {
                continue;
              }
              missingAmiibo.push({
                id: poseId,
                amiibo_id: amiiboId,
                name: poseName,
                line: 'amiibo',
                series_name: effectiveSeries,
                game_series: a.gameSeries || null,
                type: a.type || 'Figure',
                image_url: a.image,
                release_date: defaultDate,
                region: defaultRegion,
                metadata_json: metadataJson,
              });
            }
            continue;
          }

          if (existingIds.has(amiiboId) || existingNames.has(cleanName)) {
            continue;
          }

          missingAmiibo.push({
            id: amiiboId,
            amiibo_id: amiiboId,
            name: a.name,
            line: 'amiibo',
            series_name: effectiveSeries,
            game_series: a.gameSeries || null,
            type: a.type || 'Figure',
            image_url: a.image,
            release_date: defaultDate,
            region: defaultRegion,
            metadata_json: metadataJson,
          });
        }

        return Response.json(missingAmiibo);
      } catch (err: unknown) {
        console.error('[DiscoveryScanAmiibo] Error:', err);
        return Response.json(
          { error: 'Internal discovery error' },
          { status: 500 },
        );
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

    // Endpoint: GET /api/admin/diagnostics/jobs
    else if (path === '/api/admin/diagnostics/jobs') {
      if (!isAuthorizedAdmin(request, env, sessionUser)) {
        return Response.json(
          { error: 'Unauthorized: Admin authentication required.' },
          { status: 403 },
        );
      }

      const parsedLimit = parseInt(url.searchParams.get('limit') || '50', 10);
      const limit = Number.isNaN(parsedLimit)
        ? 50
        : Math.max(1, Math.min(parsedLimit, 200));
      const { results } = await env.DB.prepare(
        `SELECT id, job_name, status, duration_ms, summary, details_json, created_at
           FROM cron_execution_logs
           ORDER BY id DESC
           LIMIT ?`,
      )
        .bind(limit)
        .all<{
          id: number;
          job_name: string;
          status: string;
          duration_ms: number;
          summary: string | null;
          details_json: string | null;
          created_at: string;
        }>();

      return Response.json({
        logs: (results || []).map((row) => {
          let details: unknown = null;
          if (row.details_json) {
            try {
              details = JSON.parse(String(row.details_json));
            } catch {
              details = null;
            }
          }
          return {
            ...row,
            details,
          };
        }),
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
        'backup_status',
        'has_case',
        'has_manual',
        'physical_status',
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
      if (field === 'physical_status') {
        const validPhysicalStatuses = [
          'verified_physical',
          'likely_physical',
          'physical_pending',
          'not_yet_physical',
          'digital_only',
          'unverified',
        ];
        if (
          typeof status !== 'string' ||
          !validPhysicalStatuses.includes(status)
        ) {
          return Response.json(
            { error: `Invalid physical_status value: ${String(status)}` },
            { status: 400 },
          );
        }
      } else if (
        field === 'ownership_status' ||
        field === 'play_status' ||
        field === 'backup_status'
      ) {
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
        // has_case, has_manual, queued
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

      // Field permission check: physical_status is catalog-level and admin-only
      if (field === 'physical_status') {
        if (!isAuthorizedAdmin(request, env, sessionUser)) {
          return Response.json(
            { error: 'Unauthorized: Admin authentication required.' },
            { status: 403 },
          );
        }
      } else {
        // Personal state mutation: requires logged-in session user
        if (!sessionUser) {
          return Response.json(
            { error: 'Unauthorized: Authentication required.' },
            { status: 401 },
          );
        }
      }

      const currentUserId = sessionUser ? sessionUser.id : 1;

      if (type === 'game') {
        if (field === 'physical_status') {
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
            `UPDATE games SET physical_status = ? WHERE stable_id = ?`,
          )
            .bind(normalizedStatus, stableId)
            .run();
        } else if (field === 'play_status' || field === 'queued') {
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
          // ownership_status, has_case, has_manual, or backup_status on user_game_releases
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
        clearBoutiqueHash:
          type === 'game' &&
          (field === 'ownership_status' || field === 'physical_status'),
      });
      return Response.json({ success: true });
    }

    // Endpoint: POST /api/collection/backups/apply
    else if (
      request.method === 'POST' &&
      path === '/api/collection/backups/apply'
    ) {
      if (!sessionUser) {
        return Response.json(
          { error: 'Unauthorized: Authentication required.' },
          { status: 401 },
        );
      }

      const body = (await request.json().catch(() => null)) as {
        setBackedUp?: unknown;
        clearBackedUp?: unknown;
        ownershipTransfers?: unknown;
        ownershipDeclarations?: unknown;
      } | null;

      if (!body || typeof body !== 'object') {
        return Response.json(
          { error: 'Invalid backup apply payload.' },
          { status: 400 },
        );
      }

      const rawSet = body.setBackedUp ?? [];
      const rawClear = body.clearBackedUp ?? [];
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
              'setBackedUp, clearBackedUp, ownershipTransfers, and ownershipDeclarations must be arrays.',
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
          { error: 'Backup batch payload exceeds maximum size.' },
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
          { error: 'setBackedUp must contain non-empty release ID strings.' },
          { status: 400 },
        );
      }
      if (
        clearIds.length !== rawClear.length &&
        rawClear.some((v) => typeof v !== 'string' || !v.trim())
      ) {
        return Response.json(
          { error: 'clearBackedUp must contain non-empty release ID strings.' },
          { status: 400 },
        );
      }

      const setIdSet = new Set(setIds);
      const clearIdSet = new Set(clearIds);
      for (const id of setIds) {
        if (clearIdSet.has(id)) {
          return Response.json(
            {
              error: `Release ID "${id}" cannot be present in both setBackedUp and clearBackedUp.`,
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
              error: `Release ID "${releaseId}" cannot be present in both ownershipDeclarations and clearBackedUp.`,
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

      const currentUserId = sessionUser.id;

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
          const alsoClearBackup = clearIdSet.has(fromId) ? 1 : 0;
          if (alsoClearBackup === 1) {
            handledClearIds.add(fromId);
          }
          statements.push(
            env.DB.prepare(
              `UPDATE user_game_releases
               SET ownership_status = 0,
                   has_case = 0,
                   has_manual = 0,
                   backup_status = CASE WHEN ? = 1 THEN 0 ELSE backup_status END
               WHERE user_id = ? AND release_id = ?
                 AND (ownership_status != 0 OR has_case != 0 OR has_manual != 0 OR (? = 1 AND backup_status != 0))`,
            ).bind(alsoClearBackup, currentUserId, fromId, alsoClearBackup),
          );
        }

        for (const toId of transfer.toReleaseIds) {
          const alsoSetBackup = setIdSet.has(toId) ? 1 : 0;
          if (alsoSetBackup === 1) {
            handledSetIds.add(toId);
          }
          statements.push(
            env.DB.prepare(
              `INSERT INTO user_game_releases (user_id, release_id, ownership_status, backup_status, has_case, has_manual)
               SELECT ?, id, 1, ?, ?, ? FROM game_releases WHERE id = ?
               ON CONFLICT(user_id, release_id) DO UPDATE SET
                 ownership_status = 1,
                 backup_status = CASE WHEN ? = 1 THEN 1 ELSE user_game_releases.backup_status END,
                 has_case = MAX(user_game_releases.has_case, excluded.has_case),
                 has_manual = MAX(user_game_releases.has_manual, excluded.has_manual)
               WHERE user_game_releases.ownership_status IS NOT 1
                  OR (? = 1 AND user_game_releases.backup_status IS NOT 1)
                  OR user_game_releases.has_case < excluded.has_case
                  OR user_game_releases.has_manual < excluded.has_manual`,
            ).bind(
              currentUserId,
              alsoSetBackup,
              transfer.migratedCase,
              transfer.migratedManual,
              toId,
              alsoSetBackup,
              alsoSetBackup,
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
              `INSERT INTO user_game_releases (user_id, release_id, ownership_status, backup_status, has_case, has_manual)
               SELECT ?, id, 1, 1, ?, ? FROM game_releases WHERE id = ?
               ON CONFLICT(user_id, release_id) DO UPDATE SET
                 ownership_status = 1,
                 backup_status = 1,
                 has_case = MAX(user_game_releases.has_case, excluded.has_case),
                 has_manual = MAX(user_game_releases.has_manual, excluded.has_manual)
               WHERE user_game_releases.ownership_status IS NOT 1
                  OR user_game_releases.backup_status IS NOT 1
                  OR user_game_releases.has_case < excluded.has_case
                  OR user_game_releases.has_manual < excluded.has_manual`,
            ).bind(currentUserId, decl.hasCase, decl.hasManual, id),
          );
        } else {
          statements.push(
            env.DB.prepare(
              `INSERT INTO user_game_releases (user_id, release_id, backup_status)
               SELECT ?, id, 1 FROM game_releases WHERE id = ?
               ON CONFLICT(user_id, release_id) DO UPDATE SET
                 backup_status = 1
               WHERE user_game_releases.backup_status IS NOT 1`,
            ).bind(currentUserId, id),
          );
        }
      }

      for (const [id, decl] of declarationMap.entries()) {
        if (handledSetIds.has(id)) continue;
        statements.push(
          env.DB.prepare(
            `INSERT INTO user_game_releases (user_id, release_id, ownership_status, backup_status, has_case, has_manual)
             SELECT ?, id, 1, 1, ?, ? FROM game_releases WHERE id = ?
             ON CONFLICT(user_id, release_id) DO UPDATE SET
               ownership_status = 1,
               backup_status = 1,
               has_case = MAX(user_game_releases.has_case, excluded.has_case),
               has_manual = MAX(user_game_releases.has_manual, excluded.has_manual)
             WHERE user_game_releases.ownership_status IS NOT 1
                OR user_game_releases.backup_status IS NOT 1
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
             SET backup_status = 0
             WHERE user_id = ? AND release_id = ? AND backup_status != 0`,
          ).bind(currentUserId, id),
        );
      }

      if (statements.length > 0) {
        for (let i = 0; i < statements.length; i += 100) {
          await env.DB.batch(statements.slice(i, i + 100));
        }

        await invalidateEdgeApiCache(request.url, {
          userId: currentUserId,
          username: sessionUser.username,
        });
        await markDbDirty(env, 'games', 'backups-apply', {
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

    // Endpoint: DELETE /api/collection/game?id=<game id | release id | stable_id>
    else if (request.method === 'DELETE' && path === '/api/collection/game') {
      if (!isAuthorizedAdmin(request, env, sessionUser)) {
        return Response.json(
          { error: 'Unauthorized: Admin authentication required.' },
          { status: 403 },
        );
      }

      const rawId = (url.searchParams.get('id') || '').trim();
      if (!rawId) {
        return Response.json(
          { error: 'Game id is required.' },
          { status: 400 },
        );
      }

      const game = (await env.DB.prepare(
        `SELECT stable_id, id FROM games WHERE id = ?
           UNION ALL
           SELECT g.stable_id, g.id FROM games g
             JOIN game_releases r ON r.game_id = g.stable_id WHERE r.id = ?
           LIMIT 1`,
      )
        .bind(rawId, rawId)
        .first()) as { stable_id: number; id: string } | null;

      if (!game) {
        return Response.json(
          { error: `Could not find game with ID: ${rawId}` },
          { status: 404 },
        );
      }

      await env.DB.batch([
        env.DB.prepare(
          `DELETE FROM journal_entries WHERE item_type = 'game' AND item_id = ?`,
        ).bind(game.id),
        env.DB.prepare(
          `DELETE FROM user_game_releases WHERE release_id IN (SELECT id FROM game_releases WHERE game_id = ?)`,
        ).bind(game.stable_id),
        env.DB.prepare('DELETE FROM user_games WHERE game_id = ?').bind(
          game.stable_id,
        ),
        env.DB.prepare('DELETE FROM game_releases WHERE game_id = ?').bind(
          game.stable_id,
        ),
        env.DB.prepare('DELETE FROM games WHERE stable_id = ?').bind(
          game.stable_id,
        ),
      ]);

      invalidateSeriesScanCache();
      await invalidateEdgeApiCache(request.url, {
        userId: sessionUser?.id,
        username: sessionUser?.username,
      });
      await markDbDirty(env, 'games', game.stable_id, {
        clearBoutiqueHash: true,
      });
      return Response.json({ success: true, deletedGameId: game.id });
    }

    // Endpoint: DELETE /api/collection/release?id=<release id>
    else if (
      request.method === 'DELETE' &&
      path === '/api/collection/release'
    ) {
      if (!isAuthorizedAdmin(request, env, sessionUser)) {
        return Response.json(
          { error: 'Unauthorized: Admin authentication required.' },
          { status: 403 },
        );
      }

      const releaseId = (url.searchParams.get('id') || '').trim();
      if (!releaseId) {
        return Response.json(
          { error: 'Release id is required.' },
          { status: 400 },
        );
      }

      const existingRelease = (await env.DB.prepare(
        'SELECT r.game_id, g.id as parent_slug, g.platform_id FROM game_releases r JOIN games g ON g.stable_id = r.game_id WHERE r.id = ? LIMIT 1',
      )
        .bind(releaseId)
        .first()) as {
        game_id: number;
        parent_slug: string;
        platform_id: number;
      } | null;

      await env.DB.prepare(
        'DELETE FROM user_game_releases WHERE release_id = ?',
      )
        .bind(releaseId)
        .run();

      const result = await env.DB.prepare(
        'DELETE FROM game_releases WHERE id = ?',
      )
        .bind(releaseId)
        .run();

      if (!result.meta || result.meta.changes === 0) {
        // Fallback: if releaseId refers directly to a Virtual Platform 0 ("No Platform")
        // game that has no physical release rows, delete the Platform 0 game cleanly.
        const noPlatGame = (await env.DB.prepare(
          'SELECT stable_id, id FROM games WHERE id = ? AND platform_id = 0 LIMIT 1',
        )
          .bind(releaseId)
          .first()) as { stable_id: number; id: string } | null;

        if (!noPlatGame) {
          return Response.json(
            { error: `Could not find release with ID: ${releaseId}` },
            { status: 404 },
          );
        }

        await env.DB.batch([
          env.DB.prepare(
            `DELETE FROM journal_entries WHERE item_type = 'game' AND item_id = ?`,
          ).bind(noPlatGame.id),
          env.DB.prepare(
            `DELETE FROM user_game_releases WHERE release_id IN (SELECT id FROM game_releases WHERE game_id = ?)`,
          ).bind(noPlatGame.stable_id),
          env.DB.prepare('DELETE FROM user_games WHERE game_id = ?').bind(
            noPlatGame.stable_id,
          ),
          env.DB.prepare('DELETE FROM game_releases WHERE game_id = ?').bind(
            noPlatGame.stable_id,
          ),
          env.DB.prepare('DELETE FROM games WHERE stable_id = ?').bind(
            noPlatGame.stable_id,
          ),
        ]);

        invalidateSeriesScanCache();
        await invalidateEdgeApiCache(request.url, {
          userId: sessionUser?.id,
          username: sessionUser?.username,
        });
        await markDbDirty(env, 'games', noPlatGame.stable_id, {
          clearBoutiqueHash: true,
        });
        return Response.json({
          success: true,
          deletedReleaseId: releaseId,
          deletedGameId: noPlatGame.id,
        });
      }

      // If deleting a placeholder release from a Platform 0 game leaves it with 0 releases,
      // remove the orphaned Platform 0 game row as well.
      if (existingRelease && existingRelease.platform_id === 0) {
        const remaining = await env.DB.prepare(
          'SELECT 1 FROM game_releases WHERE game_id = ? LIMIT 1',
        )
          .bind(existingRelease.game_id)
          .first();
        if (!remaining) {
          await env.DB.batch([
            env.DB.prepare(
              `DELETE FROM journal_entries WHERE item_type = 'game' AND item_id = ?`,
            ).bind(existingRelease.parent_slug),
            env.DB.prepare('DELETE FROM user_games WHERE game_id = ?').bind(
              existingRelease.game_id,
            ),
            env.DB.prepare('DELETE FROM games WHERE stable_id = ?').bind(
              existingRelease.game_id,
            ),
          ]);
        }
      }

      invalidateSeriesScanCache();
      await invalidateEdgeApiCache(request.url, {
        userId: sessionUser?.id,
        username: sessionUser?.username,
      });
      await markDbDirty(env, undefined, undefined, { clearBoutiqueHash: true });
      return Response.json({ success: true, deletedReleaseId: releaseId });
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
      }

      await invalidateEdgeApiCache(request.url, {
        userId: sessionUser?.id,
        username: sessionUser?.username,
      });
      await markDbDirty(env, type === 'game' ? 'games' : 'toys', id);
      return Response.json({ success: true });
    }

    // Endpoint: POST /api/discovery/add
    else if (request.method === 'POST' && path === '/api/discovery/add') {
      if (!isAuthorizedAdmin(request, env, sessionUser)) {
        return Response.json(
          { error: 'Unauthorized: Admin authentication required.' },
          { status: 403 },
        );
      }

      const body = (await request.json().catch(() => null)) as {
        game?: {
          title: string;
          platform_id: number;
          igdb_id?: number | null;
          igdb_url?: string | null;
          summary?: string | null;
          genres?: string | null;
          region?: string | null;
          image_url?: string | null;
          collections?: string | null;
          franchises?: string | null;
          ownership_status?: number;
          play_status?: number;
          backup_status?: number;
          physical_status?: string;
          verification_tier?: number;
          barcode?: string | null;
          release_date?: string | null;
        };
        releases?: Array<{
          region?: string | null;
          variants?: string | null;
          also_released_as?: string | null;
          rom_name?: string | null;
          rom_crc?: string | null;
          ownership_status?: number;
          backup_status?: number;
          release_date?: string | null;
          canonical_release_id?: number | null;
          barcode?: string | null;
          image_url?: string | null;
        }>;
      } | null;

      const { game, releases } = body || {};
      if (
        !game ||
        !game.title ||
        game.platform_id === undefined ||
        game.platform_id === null
      ) {
        return Response.json(
          { error: 'Invalid game payload' },
          { status: 400 },
        );
      }

      if (
        !isValidHttpsExternalUrl(game.igdb_url) ||
        !isValidCatalogImageUrl(game.image_url) ||
        (releases || []).some((r) => !isValidCatalogImageUrl(r.image_url))
      ) {
        return Response.json(
          { error: 'Invalid URL: catalog URLs must use https://' },
          { status: 400 },
        );
      }

      const slugify = (s: string) =>
        (s || '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');

      const platformRow = (await env.DB.prepare(
        'SELECT display_name FROM platforms WHERE id = ?',
      )
        .bind(game.platform_id)
        .first()) as { display_name: string } | null;

      const platformName = platformRow ? platformRow.display_name : 'unknown';
      const baseSlug = `${slugify(game.title)}-${slugify(platformName)}`;

      const canonicalSeries = computeGameCanonicalSeries({
        title: game.title,
        collections: game.collections || undefined,
        franchises: game.franchises || undefined,
      });

      const normalizeRegionStr = (r: string | null | undefined): string => {
        if (!r) return 'USA';
        if (r === 'NA') return 'USA';
        if (r === 'JP') return 'Japan';
        if (r === 'EU') return 'Europe';
        return r;
      };
      const gameRegion = normalizeRegionStr(
        game.region || (releases && releases[0]?.region),
      );

      const currentUserId = sessionUser ? sessionUser.id : 1;

      // Deduplicate: check if this game already exists on the same platform_id
      // (by igdb_id when present, or by case-insensitive title) so repeated adds
      // update in place rather than minting -1, -2 duplicate rows.
      let existingGame: { id: string; stable_id: number } | null = null;
      if (game.igdb_id) {
        existingGame = (await env.DB.prepare(
          'SELECT id, stable_id FROM games WHERE igdb_id = ? AND platform_id = ? ORDER BY stable_id ASC LIMIT 1',
        )
          .bind(game.igdb_id, game.platform_id)
          .first()) as { id: string; stable_id: number } | null;
      }
      if (!existingGame) {
        existingGame = (await env.DB.prepare(
          'SELECT id, stable_id FROM games WHERE title = ? COLLATE NOCASE AND platform_id = ? AND (igdb_id IS NULL OR ? IS NULL OR igdb_id = ?) ORDER BY stable_id ASC LIMIT 1',
        )
          .bind(
            game.title.trim(),
            game.platform_id,
            game.igdb_id || null,
            game.igdb_id || null,
          )
          .first()) as { id: string; stable_id: number } | null;
      }

      let candidateGameId = baseSlug;
      let finalStableId = 0;

      if (existingGame) {
        candidateGameId = existingGame.id;
        finalStableId = existingGame.stable_id;
        await env.DB.prepare(
          `
            UPDATE games
            SET image_url = COALESCE(?, image_url),
                igdb_id = COALESCE(?, igdb_id),
                igdb_url = COALESCE(?, igdb_url),
                summary = COALESCE(?, summary),
                genres = COALESCE(?, genres),
                region = COALESCE(?, region),
                collections = COALESCE(?, collections),
                franchises = COALESCE(?, franchises),
                manually_verified = 1,
                physical_status = COALESCE(?, physical_status),
                verification_tier = CASE WHEN ? > COALESCE(verification_tier, 0) THEN ? ELSE COALESCE(verification_tier, 0) END,
                barcode = COALESCE(?, barcode),
                canonical_series = COALESCE(?, canonical_series)
            WHERE stable_id = ?
          `,
        )
          .bind(
            game.image_url || null,
            game.igdb_id || null,
            game.igdb_url || null,
            game.summary || null,
            game.genres || null,
            gameRegion,
            game.collections || null,
            game.franchises || null,
            game.physical_status || null,
            game.verification_tier || 0,
            game.verification_tier || 0,
            game.barcode || null,
            canonicalSeries,
            finalStableId,
          )
          .run();
      } else {
        let counter = 1;
        while (true) {
          const exists = await env.DB.prepare(
            'SELECT 1 FROM games WHERE id = ?',
          )
            .bind(candidateGameId)
            .first();
          if (!exists) break;
          candidateGameId = `${baseSlug}-${counter}`;
          counter++;
        }

        const maxSortIndexRow = (await env.DB.prepare(
          'SELECT MAX(sort_index) as max_idx FROM games WHERE platform_id = ?',
        )
          .bind(game.platform_id)
          .first()) as { max_idx: number | null } | null;

        const sortIndex =
          (maxSortIndexRow?.max_idx !== null &&
          maxSortIndexRow?.max_idx !== undefined
            ? maxSortIndexRow.max_idx
            : 0) + 1;

        await env.DB.prepare(
          `
            INSERT INTO games (
              id, title, platform_id, sort_index, image_url,
              igdb_id, igdb_url, summary, genres, region, collections, franchises, manually_verified,
              physical_status, verification_tier, barcode, canonical_series
            ) VALUES (
              ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?, 1,
              ?, ?, ?, ?
            )
          `,
        )
          .bind(
            candidateGameId,
            game.title,
            game.platform_id,
            sortIndex,
            game.image_url || null,
            game.igdb_id || null,
            game.igdb_url || null,
            game.summary || null,
            game.genres || null,
            gameRegion,
            game.collections || null,
            game.franchises || null,
            game.physical_status || 'unverified',
            game.verification_tier || 0,
            game.barcode || null,
            canonicalSeries,
          )
          .run();

        const insertedGame = (await env.DB.prepare(
          'SELECT stable_id FROM games WHERE id = ?',
        )
          .bind(candidateGameId)
          .first()) as { stable_id: number } | null;

        finalStableId = insertedGame?.stable_id || 0;
      }

      if (game.play_status) {
        await env.DB.prepare(
          `INSERT INTO user_games (user_id, game_id, play_status, queued, updated_at)
             VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP)
             ON CONFLICT(user_id, game_id) DO UPDATE SET
               play_status = excluded.play_status,
               updated_at = CURRENT_TIMESTAMP
             WHERE user_games.play_status IS NOT excluded.play_status`,
        )
          .bind(currentUserId, finalStableId, game.play_status)
          .run();
      }

      const addedReleasesForTracking: Array<{
        id: string;
        region: string | null;
      }> = [];
      let anyPositiveOwnership = (game.ownership_status || 0) > 0;

      if (game.platform_id === 0) {
        // Virtual Platform 0 represents untracked / wishlist games with 0 releases.
        // Do not create default releases.
      } else if (releases && releases.length > 0) {
        const statements = [];
        const userStatements = [];
        const usedRelSlugs = new Set<string>();
        for (let i = 0; i < releases.length; i++) {
          const rel = releases[i];
          const rawSlug = `${candidateGameId}-${rel.rom_crc || slugify(rel.rom_name || `release-${i + 1}`)}`;
          let baseRelSlug = rawSlug;
          let relSuffix = 1;
          while (usedRelSlugs.has(baseRelSlug)) {
            baseRelSlug = `${rawSlug}-${relSuffix++}`;
          }
          usedRelSlugs.add(baseRelSlug);
          const relRegion = rel.region ? normalizeRegionStr(rel.region) : null;
          addedReleasesForTracking.push({ id: baseRelSlug, region: relRegion });

          statements.push(
            env.DB.prepare(
              `
                INSERT INTO game_releases (
                  id, game_id, region, variants, also_released_as, rom_name, rom_crc, release_date,
                  canonical_release_id, barcode, image_url
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  game_id = excluded.game_id,
                  region = excluded.region,
                  variants = excluded.variants,
                  also_released_as = excluded.also_released_as,
                  rom_name = excluded.rom_name,
                  rom_crc = excluded.rom_crc,
                  release_date = excluded.release_date,
                  canonical_release_id = excluded.canonical_release_id,
                  barcode = excluded.barcode,
                  image_url = COALESCE(excluded.image_url, game_releases.image_url)
                WHERE game_releases.game_id IS NOT excluded.game_id
                   OR game_releases.region IS NOT excluded.region
                   OR game_releases.variants IS NOT excluded.variants
                   OR game_releases.also_released_as IS NOT excluded.also_released_as
                   OR game_releases.rom_name IS NOT excluded.rom_name
                   OR game_releases.rom_crc IS NOT excluded.rom_crc
                   OR game_releases.release_date IS NOT excluded.release_date
                   OR game_releases.canonical_release_id IS NOT excluded.canonical_release_id
                   OR game_releases.barcode IS NOT excluded.barcode
                   OR game_releases.image_url IS NOT COALESCE(excluded.image_url, game_releases.image_url)
              `,
            ).bind(
              baseRelSlug,
              finalStableId,
              relRegion,
              rel.variants || null,
              rel.also_released_as || null,
              rel.rom_name || null,
              rel.rom_crc || null,
              rel.release_date || game.release_date || null,
              rel.canonical_release_id || null,
              rel.barcode || null,
              rel.image_url || null,
            ),
          );

          const ownStatus =
            rel.ownership_status ?? (game.ownership_status || 0);
          if (ownStatus > 0) {
            anyPositiveOwnership = true;
          }
          const bkpStatus = rel.backup_status ?? 0;
          if (ownStatus > 0 || bkpStatus > 0) {
            userStatements.push(
              env.DB.prepare(
                `INSERT INTO user_game_releases (user_id, release_id, ownership_status, backup_status)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(user_id, release_id) DO UPDATE SET
                     ownership_status = excluded.ownership_status,
                     backup_status = excluded.backup_status
                   WHERE user_game_releases.ownership_status IS NOT excluded.ownership_status
                      OR user_game_releases.backup_status IS NOT excluded.backup_status`,
              ).bind(currentUserId, baseRelSlug, ownStatus, bkpStatus),
            );
          }
        }
        if (statements.length > 0) {
          await env.DB.batch(statements);
        }
        if (userStatements.length > 0) {
          await env.DB.batch(userStatements);
        }
      } else {
        const defaultRelId = `${candidateGameId}-default`;
        addedReleasesForTracking.push({ id: defaultRelId, region: gameRegion });
        await env.DB.prepare(
          `
            INSERT INTO game_releases (
              id, game_id, region, variants, rom_name, rom_crc, release_date
            ) VALUES (?, ?, ?, NULL, NULL, NULL, ?)
            ON CONFLICT(id) DO UPDATE SET
              game_id = excluded.game_id,
              region = excluded.region,
              variants = excluded.variants,
              rom_name = excluded.rom_name,
              rom_crc = excluded.rom_crc,
              release_date = excluded.release_date
            WHERE game_releases.game_id IS NOT excluded.game_id
               OR game_releases.region IS NOT excluded.region
               OR game_releases.variants IS NOT excluded.variants
               OR game_releases.rom_name IS NOT excluded.rom_name
               OR game_releases.rom_crc IS NOT excluded.rom_crc
               OR game_releases.release_date IS NOT excluded.release_date
          `,
        )
          .bind(
            defaultRelId,
            finalStableId,
            gameRegion,
            game.release_date || null,
          )
          .run();

        const ownStatus = game.ownership_status || 0;
        if (ownStatus > 0) {
          await env.DB.prepare(
            `INSERT INTO user_game_releases (user_id, release_id, ownership_status, backup_status)
               VALUES (?, ?, ?, 0)
               ON CONFLICT(user_id, release_id) DO UPDATE SET
                 ownership_status = excluded.ownership_status
               WHERE user_game_releases.ownership_status IS NOT excluded.ownership_status`,
          )
            .bind(currentUserId, defaultRelId, ownStatus)
            .run();
        }
      }

      if (finalStableId > 0 && addedReleasesForTracking.length > 0) {
        await evaluateTrackingRulesForNewGames(env, [
          {
            stableId: finalStableId,
            platformId: game.platform_id,
            canonicalSeries: canonicalSeries,
            seriesTrackable: isSeriesTrackable({
              title: game.title,
              collections: game.collections,
              franchises: game.franchises,
            }),
            releases: addedReleasesForTracking,
          },
        ]);
      }

      if (finalStableId > 0 && anyPositiveOwnership) {
        await applyReactiveSeriesAutoTracking(
          env,
          currentUserId,
          finalStableId,
          canonicalSeries,
        );
      }

      invalidateSeriesScanCache();
      await invalidateEdgeApiCache(request.url, {
        userId: currentUserId,
        username: sessionUser?.username,
      });
      await markDbDirty(env, 'games', finalStableId, {
        clearBoutiqueHash: true,
      });
      return Response.json({
        success: true,
        gameId: candidateGameId,
        stableId: finalStableId,
      });
    }

    // Endpoint: POST /api/discovery/add-toy
    else if (request.method === 'POST' && path === '/api/discovery/add-toy') {
      if (!isAuthorizedAdmin(request, env, sessionUser)) {
        return Response.json(
          { error: 'Unauthorized: Admin authentication required.' },
          { status: 403 },
        );
      }

      const toy = (await request.json().catch(() => null)) as {
        id?: string;
        name: string;
        line?: string;
        series_name?: string;
        series?: string;
        type?: string;
        release_date?: string | null;
        ownership_status?: number;
        image_url?: string | null;
        scl_url?: string | null;
        amiibo_id?: string | null;
        metadata_json?: string | null;
        region?: string | null;
      } | null;

      if (!toy || !toy.name) {
        return Response.json({ error: 'Invalid toy payload' }, { status: 400 });
      }

      if (
        !isValidCatalogImageUrl(toy.image_url) ||
        !isValidHttpsExternalUrl(toy.scl_url)
      ) {
        return Response.json(
          { error: 'Invalid URL: catalog URLs must use https://' },
          { status: 400 },
        );
      }

      const slugify = (s: string) =>
        (s || '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');

      const candidateId =
        toy.id ||
        `amiibo-${slugify(toy.name)}-${slugify(toy.series_name || 'amiibo')}`;

      const existingToy = (await env.DB.prepare(
        `SELECT id, stable_id, line, series, region FROM toys WHERE (amiibo_id IS NOT NULL AND amiibo_id = ?) OR id = ? OR name = ? COLLATE NOCASE`,
      )
        .bind(toy.amiibo_id || candidateId, candidateId, toy.name)
        .first()) as {
        id: string;
        stable_id: number;
        line: string | null;
        series: string | null;
        region: string | null;
      } | null;

      const currentUserId = sessionUser ? sessionUser.id : 1;

      if (existingToy) {
        await env.DB.prepare(
          `UPDATE toys 
             SET verified = 1,
                 image_url = COALESCE(?, image_url),
                 scl_url = COALESCE(?, scl_url),
                 metadata_json = COALESCE(?, metadata_json),
                 amiibo_id = COALESCE(?, amiibo_id),
                 region = COALESCE(?, region)
             WHERE stable_id = ?`,
        )
          .bind(
            toy.image_url || null,
            toy.scl_url || null,
            toy.metadata_json || null,
            toy.amiibo_id || null,
            toy.region || null,
            existingToy.stable_id,
          )
          .run();

        const ownStatus = toy.ownership_status ?? 0;
        await env.DB.prepare(
          `INSERT INTO user_toys (user_id, toy_id, ownership_status, updated_at)
             VALUES (?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(user_id, toy_id) DO UPDATE SET
               ownership_status = excluded.ownership_status,
               updated_at = CURRENT_TIMESTAMP
             WHERE user_toys.ownership_status IS NOT excluded.ownership_status`,
        )
          .bind(currentUserId, existingToy.id, ownStatus)
          .run();

        await evaluateTrackingRulesForNewToys(env, [
          {
            id: existingToy.id,
            line: toy.line || existingToy.line || 'amiibo',
            series:
              toy.series || toy.series_name || existingToy.series || 'Other',
            region: toy.region || existingToy.region || 'USA',
          },
        ]);

        await invalidateToysCatalogChunk(env);
        await invalidateEdgeApiCache(request.url, {
          userId: currentUserId,
          username: sessionUser?.username,
          invalidateCatalog: true,
        });
        await markDbDirty(env);
        return Response.json({ success: true, id: existingToy.id });
      }

      const maxSortIndexRow = (await env.DB.prepare(
        'SELECT MAX(sort_index) as max_idx FROM toys WHERE line = ?',
      )
        .bind(toy.line || 'amiibo')
        .first()) as { max_idx: number | null } | null;

      const sortIndex =
        (maxSortIndexRow?.max_idx !== null &&
        maxSortIndexRow?.max_idx !== undefined
          ? maxSortIndexRow.max_idx
          : 0) + 1;

      const toyLine = toy.line || 'amiibo';
      const rawSeriesName = toy.series_name || toy.series || '';
      const seriesLabel = toy.series || toy.series_name || 'Other';
      let seriesId: string | null = null;

      if (rawSeriesName) {
        const existingSeries = (await env.DB.prepare(
          'SELECT id FROM toy_series WHERE line = ? AND name = ? COLLATE NOCASE',
        )
          .bind(toyLine, rawSeriesName)
          .first()) as { id: string } | null;

        if (existingSeries?.id) {
          seriesId = existingSeries.id;
        } else {
          seriesId = `${slugify(toyLine)}-${slugify(rawSeriesName)}`;
          await env.DB.prepare(
            'INSERT OR IGNORE INTO toy_series (id, line, name) VALUES (?, ?, ?)',
          )
            .bind(seriesId, toyLine, rawSeriesName)
            .run();
        }
      }

      const toyRegion = toy.region || 'USA';
      await env.DB.prepare(
        `
          INSERT INTO toys (
            id, name, line, series_id, series, type, release_date,
            image_url, scl_url, amiibo_id, verified, metadata_json, sort_index, region
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, 1, ?, ?, ?
          )
        `,
      )
        .bind(
          candidateId,
          toy.name,
          toyLine,
          seriesId,
          seriesLabel,
          toy.type || 'Figure',
          toy.release_date || null,
          toy.image_url || null,
          toy.scl_url || null,
          toy.amiibo_id || null,
          toy.metadata_json || null,
          sortIndex,
          toyRegion,
        )
        .run();

      const ownStatus = toy.ownership_status ?? 0;
      await env.DB.prepare(
        `INSERT INTO user_toys (user_id, toy_id, ownership_status, updated_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(user_id, toy_id) DO UPDATE SET
             ownership_status = excluded.ownership_status,
             updated_at = CURRENT_TIMESTAMP
           WHERE user_toys.ownership_status IS NOT excluded.ownership_status`,
      )
        .bind(currentUserId, candidateId, ownStatus)
        .run();

      await evaluateTrackingRulesForNewToys(env, [
        {
          id: candidateId,
          line: toyLine,
          series: seriesLabel,
          region: toyRegion,
        },
      ]);

      await invalidateToysCatalogChunk(env);
      await invalidateEdgeApiCache(request.url, {
        userId: currentUserId,
        username: sessionUser?.username,
        invalidateCatalog: true,
      });
      await markDbDirty(env);
      return Response.json({ success: true, id: candidateId });
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
        if (itemType === 'game') {
          const resolved = (await env.DB.prepare(
            RESOLVE_CANONICAL_GAME_ID_QUERY,
          )
            .bind(itemId, itemId)
            .first()) as { game_id?: string } | null;
          if (resolved?.game_id) {
            canonicalId = resolved.game_id;
          }
        }

        const entry = (await env.DB.prepare(JOURNAL_ENTRY_BY_ITEM_QUERY)
          .bind(sessionUser.id, itemType, itemId, canonicalId)
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

      try {
        const { results } = await env.DB.prepare(JOURNAL_ENTRIES_ALL_QUERY)
          .bind(sessionUser.id)
          .all();
        return Response.json(
          { authorized: true, entries: results || [] },
          { headers: privateHeaders },
        );
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
      if (itemType === 'game') {
        const resolved = (await env.DB.prepare(RESOLVE_CANONICAL_GAME_ID_QUERY)
          .bind(rawItemId, rawItemId)
          .first()) as { game_id?: string } | null;
        if (resolved?.game_id) {
          canonicalId = resolved.game_id;
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

      const savedEntry = (await env.DB.prepare(JOURNAL_ENTRY_BY_ITEM_QUERY)
        .bind(sessionUser.id, itemType, canonicalId, canonicalId)
        .first()) as JournalEntryRow | null;

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
      if (itemType === 'game') {
        const resolved = (await env.DB.prepare(RESOLVE_CANONICAL_GAME_ID_QUERY)
          .bind(rawItemId, rawItemId)
          .first()) as { game_id?: string } | null;
        if (resolved?.game_id) {
          canonicalId = resolved.game_id;
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

      const result = await sendWebPushNotification(
        sub,
        {
          title: '🔔 Deal Alerts Active',
          body: 'Push notifications are successfully configured for your device!',
          icon: '/icons/icon-192.png',
          badge: '/icons/badge-96.png',
          data: { url: '/' },
        },
        {
          publicKey: env.VAPID_PUBLIC_KEY,
          privateKey: env.VAPID_PRIVATE_KEY,
          subject: resolveVapidSubject(undefined, request.url, env.ADMIN_EMAIL),
          fetchFn: fetch,
          allowTestHost: isLoopbackRequest(url),
        },
      );

      if (result.shouldDelete) {
        await env.DB.prepare(
          'DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?',
        )
          .bind(body.endpoint, sessionUser.id)
          .run();
      }

      return Response.json(result);
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
   * Scheduled cron event handler invoked by Cloudflare.
   * Runs every 30 minutes (gated by persistent sync_state cadence >= 25 mins):
   * 1. Advances the rolling IGDB series/franchise batch query and checks tracked upcoming games.
   * 2. Ingests boutique physical publisher pre-order feeds (LRG, SRG, iam8bit, Fangamer, Strictly Limited, VGP, PNP Games).
   *
   * Runs during daily window (23:30 UTC or cron "30 23 * * *"):
   * 1. Generates daily structured R2 database snapshot backup.
   * 2. Scans active retail deals (Best Buy, VGP, PNP Games).
   * 3. Dispatches launch-day push notifications for tracked games releasing today.
   * 4. Prunes cron execution logs older than 7 days.
   */
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    // 1. Rolling IGDB series / franchise refresh and canonical_series reconciliation
    console.log(
      '[WorkerCron] Executing scheduled rolling IGDB series/franchise refresh...',
    );
    const igdbStart = Date.now();
    try {
      const res = await syncWorkerIgdbSeriesAndCanonical(env);
      await logCronExecution(
        env,
        'igdb_batch',
        'SUCCESS',
        Date.now() - igdbStart,
        `Processed ${res.refreshedIgdbCount} IGDB games, updated ${res.updatedGamesCount}, self-healed ${res.selfHealedRulesCount ?? 0} tracking rules (cursor ${res.cursorOffset ?? 0})`,
        res,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        '[WorkerCron] IGDB series refresh and canonical_series sync failed:',
        err,
      );
      await logCronExecution(
        env,
        'igdb_batch',
        'ERROR',
        Date.now() - igdbStart,
        `Failed: ${msg}`,
        { error: msg },
      );
    }

    // 2. Broad physical catalog population (budgeted at 60,000 billable writes/day across 48 ticks)
    const seedStart = Date.now();
    try {
      const seedRes = await syncWorkerBroadCatalogPopulation(env);
      if (!seedRes.skipped || seedRes.ingestedGames > 0) {
        await logCronExecution(
          env,
          'broad_catalog_seed',
          'SUCCESS',
          Date.now() - seedStart,
          `Stage ${seedRes.stage}: ingested ${seedRes.ingestedGames} games (${seedRes.igdbMatched ?? 0} IGDB-matched) / ${seedRes.ingestedReleases} releases (${seedRes.writesUsed} writes, cursor ${seedRes.cursor})`,
          seedRes,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[WorkerCron] Broad catalog population failed:', err);
      await logCronExecution(
        env,
        'broad_catalog_seed',
        'ERROR',
        Date.now() - seedStart,
        `Failed: ${msg}`,
        { error: msg },
      );
    }

    // 2b. One-time IGDB metadata backfill for games seeded without metadata (shares the daily budget)
    const backfillStart = Date.now();
    try {
      const bfRes = await syncWorkerIgdbMetadataBackfill(env);
      if (!bfRes.skipped || bfRes.reason === 'wrapped_to_start') {
        await logCronExecution(
          env,
          'igdb_metadata_backfill',
          'SUCCESS',
          Date.now() - backfillStart,
          bfRes.reason === 'wrapped_to_start'
            ? `Wrapped IGDB backfill cursor to start (${bfRes.writesUsed} writes)`
            : `Matched ${bfRes.matched}/${bfRes.scanned} games missing IGDB metadata, applied ${bfRes.rulesApplied ?? 0} tracking rules (${bfRes.writesUsed} writes, cursor ${bfRes.cursor})`,
          bfRes,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[WorkerCron] IGDB metadata backfill failed:', err);
      await logCronExecution(
        env,
        'igdb_metadata_backfill',
        'ERROR',
        Date.now() - backfillStart,
        `Failed: ${msg}`,
        { error: msg },
      );
    }

    // 3. Check 1-hour interval tasks (Boutique Pre-Orders)
    const nowMs = Date.now();
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

    const shouldRunBoutiqueTasks =
      lastBoutiqueRun === 0 || nowMs - lastBoutiqueRun >= 55 * 60 * 1000;

    if (shouldRunBoutiqueTasks) {
      console.log(
        '[WorkerCron] Executing scheduled boutique physical pre-order sync (1-hour window)...',
      );
      const boutiqueStart = Date.now();
      try {
        const res = await syncWorkerBoutiquePreOrders(env);
        await env.DB.prepare(
          `INSERT INTO sync_state (key, value, updated_at)
           VALUES ('boutique_sync_last_run', datetime('now'), datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = datetime('now'), updated_at = datetime('now')`,
        ).run();
        await logCronExecution(
          env,
          'boutique_preorders',
          'SUCCESS',
          Date.now() - boutiqueStart,
          `Matched ${res.matchedCount} pre-orders, sent ${res.notifications.dispatchedCount} alerts`,
          res,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[WorkerCron] Boutique pre-order sync failed:', err);
        await logCronExecution(
          env,
          'boutique_preorders',
          'ERROR',
          Date.now() - boutiqueStart,
          `Failed: ${msg}`,
          { error: msg },
        );
      }
    }

    const now = new Date();
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
      (now.getUTCHours() === 0 &&
        now.getUTCMinutes() < 30 &&
        lastDailyRunDate !== todayDateStr);

    if (isDailyWindow) {
      // Immediately record daily run in sync_state to prevent re-entrant cascade on task failure
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

    if (isDailyWindow) {
      if (isDirty || !lastDailyRunDate) {
        console.log(
          `[WorkerCron] Executing scheduled daily backup (reason: ${isDirty ? 'data_modified' : 'daily_window'})...`,
        );
        const backupStart = Date.now();
        try {
          const res = await performScheduledBackup(env, true);
          await env.DB.prepare(
            `INSERT INTO sync_state (key, value, updated_at)
             VALUES ('db_dirty', '0', datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = '0', updated_at = datetime('now')`,
          ).run();
          await logCronExecution(
            env,
            'scheduled_backup',
            'SUCCESS',
            Date.now() - backupStart,
            `Backup completed (${res.rowCount} rows, reason: daily_window)`,
            res,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[WorkerCron] Scheduled backup failed:', err);
          await logCronExecution(
            env,
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
      }
    }

    if (
      !isDailyWindow &&
      env.BACKUP_BUCKET &&
      typeof env.BACKUP_BUCKET.head === 'function'
    ) {
      try {
        const [hasLatest, hasGamesLite, hasCatalogManifest, chunkCursorRow] =
          await Promise.all([
            env.BACKUP_BUCKET.head('snapshots/latest.json'),
            env.BACKUP_BUCKET.head(R2_GAMES_ACTIVE_LITE_KEY),
            env.BACKUP_BUCKET.head(R2_CATALOG_MANIFEST_KEY),
            env.DB.prepare('SELECT value FROM sync_state WHERE key = ?')
              .bind(CATALOG_CHUNKS_STATE_KEY)
              .first<{ value: string }>()
              .catch(() => null),
          ]);
        if (hasLatest && !hasGamesLite) {
          await writeLiteBackupSnapshots(env);
        }
        if (chunkCursorRow?.value || (hasLatest && !hasCatalogManifest)) {
          await writeCatalogChunksToR2(env, { maxChunksPerRun: 2 });
        }
      } catch (liteBackfillErr) {
        console.warn(
          '[WorkerCron] Daytime one-time lite snapshot backfill failed:',
          liteBackfillErr,
        );
      }
    }

    if (isDailyWindow) {
      console.log(
        '[WorkerCron] Executing scheduled retail deal scan (VGP, PNP Games, Best Buy)...',
      );
      const dealsStart = Date.now();
      try {
        const res = await syncWorkerRetailDeals(env);
        await logCronExecution(
          env,
          'retail_deals',
          'SUCCESS',
          Date.now() - dealsStart,
          `Matched ${res.matchedCount} deals from ${res.totalDeals} items`,
          res,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[WorkerCron] Retail deal sync failed:', err);
        await logCronExecution(
          env,
          'retail_deals',
          'ERROR',
          Date.now() - dealsStart,
          `Failed: ${msg}`,
          { error: msg },
        );
      }

      console.log(
        '[WorkerCron] Checking for launch-day game releases and notifications...',
      );
      const launchStart = Date.now();
      try {
        const res = await syncWorkerLaunchDayNotifications(env);
        await logCronExecution(
          env,
          'launch_day',
          'SUCCESS',
          Date.now() - launchStart,
          `Dispatched ${res.dispatchedCount} launch day alerts`,
          res,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[WorkerCron] Launch-day release scan failed:', err);
        await logCronExecution(
          env,
          'launch_day',
          'ERROR',
          Date.now() - launchStart,
          `Failed: ${msg}`,
          { error: msg },
        );
      }

      // 4. Scheduled Nintendo Switch 1 & 2 revisions sync (daily window)
      console.log(
        '[WorkerCron] Executing scheduled Nintendo Switch 1 & 2 revisions sync...',
      );
      const switchStart = Date.now();
      try {
        const res = await syncWorkerSwitchRevisions(env);
        await logCronExecution(
          env,
          'switch_revisions',
          'SUCCESS',
          Date.now() - switchStart,
          res.hashMatch
            ? 'Spreadsheet unchanged (0 writes)'
            : `Synced Switch revisions (+${res.addedCanonical} / ~${res.updatedCanonical} / -${res.deletedCanonical}, ${res.verifiedGames} games verified)`,
          res,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[WorkerCron] Switch revisions sync failed:', err);
        await logCronExecution(
          env,
          'switch_revisions',
          'ERROR',
          Date.now() - switchStart,
          `Failed: ${msg}`,
          { error: msg },
        );
      }

      // 5. Scheduled Amiibo catalog sync (daily window, SHA-256 hash-gated)
      console.log(
        '[WorkerCron] Executing scheduled Amiibo catalog sync (AmiiboAPI)...',
      );
      const amiiboStart = Date.now();
      try {
        const res = await syncWorkerAmiiboCatalog(env);
        await logCronExecution(
          env,
          'amiibo_catalog',
          'SUCCESS',
          Date.now() - amiiboStart,
          res.hashMatch
            ? 'AmiiboAPI catalog unchanged (0 writes)'
            : `Synced Amiibo catalog (+${res.addedCount} / ~${res.updatedCount}, ${res.writesUsed} writes)`,
          res,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[WorkerCron] Amiibo catalog sync failed:', err);
        await logCronExecution(
          env,
          'amiibo_catalog',
          'ERROR',
          Date.now() - amiiboStart,
          `Failed: ${msg}`,
          { error: msg },
        );
      }

      // 6. Diff-guarded canonical_releases R2 backup (only dumps when dirty or out of sync with R2)
      const canonicalBackupStart = Date.now();
      try {
        const crBackupRes = await performCanonicalReleasesBackup(env);
        if (!crBackupRes.skipped) {
          await logCronExecution(
            env,
            'canonical_releases_backup',
            'SUCCESS',
            Date.now() - canonicalBackupStart,
            `Backed up ${crBackupRes.rowCount} canonical_releases rows to R2 (${crBackupRes.key})`,
            crBackupRes,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[WorkerCron] Canonical releases R2 backup failed:', err);
        await logCronExecution(
          env,
          'canonical_releases_backup',
          'ERROR',
          Date.now() - canonicalBackupStart,
          `Failed: ${msg}`,
          { error: msg },
        );
      }

      // 7. Build pre-processed, user-agnostic R2 catalog chunks for progressive client loading
      try {
        await writeCatalogChunksToR2(env, {
          maxChunksPerRun: 2,
          forceRestart: true,
        });
      } catch (chunkErr) {
        console.warn(
          '[WorkerCron] Failed to write R2 catalog chunks:',
          chunkErr,
        );
      }

      // Prune cron execution logs older than 7 days (zero-churn retention)
      try {
        await env.DB.prepare(
          `DELETE FROM cron_execution_logs WHERE created_at < datetime('now', '-7 days')`,
        ).run();
        console.log(
          '[WorkerCron] Pruned cron execution logs older than 7 days.',
        );
      } catch (pruneErr) {
        console.warn('[WorkerCron] Failed to prune aged cron logs:', pruneErr);
      }
    }
  },
};

/**
 * Synchronizes active physical video game sales from VGP, PNP Games, and Best Buy
 * directly into Cloudflare D1 within Free Tier subrequest limits (~15-19 subrequests).
 */
export async function syncWorkerRetailDeals(env: Env): Promise<{
  matchedCount: number;
  totalDeals: number;
  sources?: { vgp: number; pnp: number; bestbuy: number };
  notifications?: { dispatchedCount: number; purgedCount: number };
}> {
  const { deals, sources } = await fetchAllRetailDeals({
    bestBuyApiKey: env.BESTBUY_API_KEY,
    fetchFn: fetch,
    maxVgpPages: 6,
    maxPnpPages: 8,
    maxBestBuyPages: 4,
  });

  if (deals.length === 0) {
    return { matchedCount: 0, totalDeals: 0, sources };
  }

  const candidateRows = await env.DB.prepare(
    `SELECT g.stable_id, g.id, g.title, g.platform_id, 0 as ownership_status, COALESCE(r.barcode, g.barcode) as barcode
     FROM games g
     LEFT JOIN game_releases r ON r.game_id = g.stable_id`,
  ).all<{
    stable_id: number;
    id: string;
    title: string;
    platform_id: number;
    ownership_status: number;
    barcode: string | null;
  }>();

  const candidates: CandidateGame[] = candidateRows.results || [];
  const candidateLookup = new Map<
    number,
    { id: string; title: string; platform_id: number; ownership_status: number }
  >();
  for (const c of candidateRows.results || []) {
    if (!candidateLookup.has(c.stable_id)) {
      candidateLookup.set(c.stable_id, {
        id: c.id,
        title: c.title,
        platform_id: c.platform_id,
        ownership_status: 0,
      });
    }
  }

  const bestDealByGame = new Map<number, RetailDealItem>();
  for (const deal of deals) {
    if (!deal.onSale) continue;
    const stableId = matchRetailGameProduct(deal, candidates);
    if (stableId !== null) {
      const existing = bestDealByGame.get(stableId);
      if (!existing || deal.salePrice < existing.salePrice) {
        bestDealByGame.set(stableId, deal);
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
      `SELECT id FROM toys WHERE retail_store IN ('Best Buy', 'VGP', 'PNP Games') AND (retail_on_sale != 0 OR retail_price IS NOT NULL OR retail_url IS NOT NULL)`,
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
    `SELECT stable_id FROM games WHERE retail_store IN ('Best Buy', 'VGP', 'PNP Games') AND retail_on_sale != 0`,
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

  let notificationResult = { dispatchedCount: 0, purgedCount: 0 };
  if (bestDealByGame.size > 0) {
    notificationResult = await dispatchDealPushNotifications(
      env,
      candidateLookup,
      bestDealByGame,
    );
  }

  return {
    matchedCount: bestDealByGame.size + bestItemByToy.size,
    totalDeals: deals.length,
    sources,
    notifications: notificationResult,
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
          slug: game.id,
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
          url: `/collection/game/${top.slug}`,
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
    'v3||' + tabContents.map((t) => `${t.tab.gid}:${t.csv}`).join('||');
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
    SET canonical_release_id = NULL
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
       SET canonical_release_id = NULL
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
      updated++;
    }
  }

  // Execute in batches of 100 statements
  for (let i = 0; i < statements.length; i += 100) {
    await env.DB.batch(statements.slice(i, i + 100));
  }

  // Update physical_status on Switch games and materialize any missing regional revisions into game_releases
  const gamesRes = await env.DB.prepare(
    'SELECT stable_id, id, title, platform_id, physical_status FROM games WHERE platform_id IN (26, 27)',
  ).all<{
    stable_id: number;
    id: string;
    title: string;
    platform_id: number;
    physical_status: string | null;
  }>();

  const canonicalByPlatformNorm = new Set<string>();
  for (const cr of canonicalReleases) {
    canonicalByPlatformNorm.add(`${cr.platform_id}::${cr.normalized_title}`);
  }

  const gameStatements: D1PreparedStatement[] = [];
  let verifiedGames = 0;
  for (const g of gamesRes.results || []) {
    const norm = normalizeTitleForMatching(g.title);
    const strippedNorm = normalizeTitleForMatching(stripEditionSuffix(g.title));
    if (
      (canonicalByPlatformNorm.has(`${g.platform_id}::${norm}`) ||
        canonicalByPlatformNorm.has(`${g.platform_id}::${strippedNorm}`)) &&
      g.physical_status !== 'verified_physical'
    ) {
      gameStatements.push(
        env.DB.prepare(
          "UPDATE games SET physical_status = 'verified_physical', verification_tier = 1 WHERE stable_id = ?",
        ).bind(g.stable_id),
      );
      verifiedGames++;
    }
  }

  if (added > 0) {
    const [allCanonicalRes, existingGameRelsRes] = await Promise.all([
      env.DB.prepare(
        "SELECT id, platform_id, normalized_title, region, variants FROM canonical_releases WHERE platform_id IN (26, 27) AND source = 'nintendo_revised'",
      ).all<{
        id: number;
        platform_id: number;
        normalized_title: string;
        region: string | null;
        variants: string | null;
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
    for (const cr of allCanonicalRes.results || []) {
      const k = `${cr.platform_id}::${cr.normalized_title}`;
      let list = canonicalByKey.get(k);
      if (!list) {
        list = [];
        canonicalByKey.set(k, list);
      }
      list.push(cr);
    }

    const existingRelSet = new Set<string>();
    const unlinkedByGameReg = new Map<string, string>();
    for (const gr of existingGameRelsRes.results || []) {
      existingRelSet.add(
        `${gr.game_id}::${gr.region || 'World'}::${gr.variants || 'Standard'}`,
      );
      if (!gr.variants && !gr.canonical_release_id) {
        unlinkedByGameReg.set(`${gr.game_id}::${gr.region || 'USA'}`, gr.id);
      }
    }

    const slugify = (s: string) =>
      (s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

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
        const reg = cr.region || 'World';
        if (reg === 'World') continue;
        const relKey = `${g.stable_id}::${reg}::${cr.variants || 'Standard'}`;
        if (existingRelSet.has(relKey)) continue;

        const unlinkedRelId = unlinkedByGameReg.get(`${g.stable_id}::${reg}`);
        if (unlinkedRelId && (cr.variants || '').startsWith('Rev 000')) {
          existingRelSet.add(relKey);
          unlinkedByGameReg.delete(`${g.stable_id}::${reg}`);
          gameStatements.push(
            env.DB.prepare(
              'UPDATE game_releases SET variants = ?, canonical_release_id = ? WHERE id = ?',
            ).bind(cr.variants, cr.id, unlinkedRelId),
          );
          continue;
        }

        existingRelSet.add(relKey);
        const relId = `${g.id}-rev-${slugify(reg)}-${slugify(cr.variants || 'standard')}`;
        gameStatements.push(
          env.DB.prepare(
            `INSERT INTO game_releases (id, game_id, region, variants, canonical_release_id)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(id) DO NOTHING`,
          ).bind(relId, g.stable_id, reg, cr.variants, cr.id),
        );
      }
    }
  }

  for (let i = 0; i < gameStatements.length; i += 100) {
    await env.DB.batch(gameStatements.slice(i, i + 100));
  }
  if (gameStatements.length > 0) {
    await markDbDirty(env);
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
 * Synchronizes boutique physical publisher pre-orders and storefront catalogs
 * (Limited Run Games, Super Rare Games, iam8bit, Fangamer, Strictly Limited Games, VGP, PNP Games)
 * into Cloudflare D1 and dispatches push notifications when physical editions are detected.
 */
export async function syncWorkerBoutiquePreOrders(env: Env): Promise<{
  matchedCount: number;
  totalPreOrders: number;
  notifications: { dispatchedCount: number; purgedCount: number };
}> {
  const preOrders = await fetchBoutiquePreOrders(fetch);
  if (preOrders.length === 0) {
    return {
      matchedCount: 0,
      totalPreOrders: 0,
      notifications: { dispatchedCount: 0, purgedCount: 0 },
    };
  }

  const targetPlatforms = Array.from(
    new Set(
      preOrders
        .map((po) => po.platformId)
        .filter((id): id is number => typeof id === 'number' && id > 0),
    ),
  );

  if (targetPlatforms.length === 0) {
    return {
      matchedCount: 0,
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
        totalPreOrders: preOrders.length,
        notifications: { dispatchedCount: 0, purgedCount: 0 },
      };
    }
  } catch {
    // Proceed with full sync if sync_state lookup fails
  }

  const platformsWithNoPlat = [...targetPlatforms, 0];
  const placeholders = platformsWithNoPlat.map(() => '?').join(', ');
  const candidateRows = await env.DB.prepare(
    `SELECT g.stable_id, g.id, g.title, g.platform_id, g.physical_status, g.retail_url,
            0 AS ownership_status,
            0 AS has_owned_physical,
            NULL AS owned_variants
     FROM games g
     WHERE g.platform_id IN (${placeholders})`,
  )
    .bind(...platformsWithNoPlat)
    .all<{
      stable_id: number;
      id: string;
      title: string;
      platform_id: number;
      physical_status: string;
      retail_url: string | null;
      ownership_status: number;
      has_owned_physical: number;
      owned_variants: string | null;
    }>();

  const games = candidateRows.results || [];
  const gamesWithNorm = games.map((g) => ({
    ...g,
    normTitle: normalizeTitleForMatching(g.title),
  }));

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
      id: string;
      title: string;
      ownership_status: number;
      platform_id: number;
      physical_status?: string;
    };
    preOrder: BoutiquePreOrder;
    isSpecialEdition?: boolean;
    isUncataloged?: boolean;
  }> = [];

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

    const match = gamesWithNorm.find(
      (g) =>
        (g.platform_id === po.platformId || g.platform_id === 0) &&
        (g.normTitle === poNorm ||
          g.title.toLowerCase() === po.cleanTitle.toLowerCase()),
    );

    const priceCents =
      po.priceCents ?? (po.priceUsd ? Math.round(po.priceUsd * 100) : null);
    const regularPriceCents = po.regularPriceCents ?? priceCents;
    const discountPct = po.onSale ? (po.discountPct ?? 0) : 0;
    const onSaleInt = po.onSale && discountPct > 0 ? 1 : 0;

    if (match) {
      const isGraduatingFromNoPlatform = match.platform_id === 0;
      const shouldUpdatePhysicalStatus =
        match.physical_status === 'not_yet_physical' ||
        match.physical_status === 'physical_pending' ||
        match.physical_status === 'unverified' ||
        match.physical_status === 'digital_only';

      const nextPhysicalStatus = shouldUpdatePhysicalStatus
        ? 'likely_physical'
        : match.physical_status;

      const isUrlDifferent = match.retail_url !== po.productUrl;

      if (
        shouldUpdatePhysicalStatus ||
        isUrlDifferent ||
        isGraduatingFromNoPlatform
      ) {
        if (isGraduatingFromNoPlatform) {
          // Graduate game to target console platform and update slug
          const slugify = (s: string) =>
            (s || '')
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '');
          const newSlug = `${slugify(match.title)}-${po.platformId}`;

          statements.push(
            env.DB.prepare(
              `UPDATE games
               SET platform_id = ?,
                   id = ?,
                   physical_status = 'likely_physical',
                   retail_url = ?,
                   retail_price = COALESCE(?, retail_price),
                   retail_regular_price = COALESCE(?, retail_regular_price),
                   retail_discount_pct = ?,
                   retail_on_sale = ?,
                   retail_store = ?
               WHERE stable_id = ?`,
            ).bind(
              po.platformId,
              newSlug,
              po.productUrl,
              priceCents,
              regularPriceCents,
              discountPct,
              onSaleInt,
              po.store,
              match.stable_id,
            ),
          );

          // Insert the boutique pre-order edition release
          const relId = `${newSlug}-boutique-${po.store.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
          statements.push(
            env.DB.prepare(
              `INSERT OR IGNORE INTO game_releases (
                 id, game_id, region, variants, release_date
               ) VALUES (?, ?, 'USA', ?, NULL)`,
            ).bind(relId, match.stable_id, po.edition || 'Standard Physical'),
          );
        } else {
          statements.push(
            env.DB.prepare(
              `UPDATE games
               SET physical_status = ?,
                   retail_url = ?,
                   retail_price = COALESCE(?, retail_price),
                   retail_regular_price = COALESCE(?, retail_regular_price),
                   retail_discount_pct = ?,
                   retail_on_sale = ?,
                   retail_store = ?
               WHERE stable_id = ?`,
            ).bind(
              nextPhysicalStatus,
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
      }

      // Evaluate announcement notification criteria (Proposal 3):
      // - Standard games already physical MUST NOT alert on mere retail_url change!
      // - Alert ONLY if transitioning from digital/unverified/pending to likely_physical, OR
      // - A special edition announced for the first time.
      // Per-user ownership suppression is evaluated per subscriber in dispatchPhysicalAnnouncementNotifications.
      const isSpecialEdition = Boolean(po.edition);
      const isUnannouncedSpecialEdition =
        isSpecialEdition &&
        isActionableAnnouncement &&
        !announcedUrls.has(po.productUrl);

      const shouldNotify =
        !isColdStartSeed &&
        ((shouldUpdatePhysicalStatus && isActionableAnnouncement) ||
          isUnannouncedSpecialEdition);

      if (shouldNotify) {
        newlyAnnouncedGames.push({
          game: {
            ...match,
            platform_id: isGraduatingFromNoPlatform
              ? po.platformId
              : match.platform_id,
          },
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
      // Uncataloged game drop (Proposal 2):
      // 1. Must be a genuine pre-order (not in-stock older inventory)
      // 2. Must be published within the last 72 hours
      // 3. Must not have been announced previously
      const isRecent = (() => {
        if (!po.publishedAt) return false;
        const pubMs = new Date(po.publishedAt).getTime();
        if (isNaN(pubMs)) return false;
        return Date.now() - pubMs <= 72 * 60 * 60 * 1000;
      })();

      if (
        po.isPreOrder &&
        isRecent &&
        !announcedUrls.has(po.productUrl) &&
        !isColdStartSeed
      ) {
        newlyAnnouncedGames.push({
          game: {
            id: `boutique-${po.store.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${encodeURIComponent(po.cleanTitle)}`,
            title: po.cleanTitle,
            ownership_status: 0,
            platform_id: po.platformId,
            physical_status: 'likely_physical',
          },
          preOrder: po,
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

  if (currentFeedHash) {
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
    matchedCount: statements.length,
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
      physical_status?: string;
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
      const scopeWatchPhysical = pas?.watch_physical ?? true;
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
          if (
            game.physical_status === 'not_yet_physical' ||
            game.physical_status === 'physical_pending'
          ) {
            return scopeWatchPhysical;
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
            : `/collection/game/${top.game.id}`;

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
 * Checks for tracked games releasing on today's calendar date, transitions their status
 * to 'likely_physical', and dispatches launch-day push notifications.
 */
export async function syncWorkerLaunchDayNotifications(env: Env): Promise<{
  dispatchedCount: number;
  purgedCount: number;
}> {
  let dispatchedCount = 0;
  let purgedCount = 0;

  try {
    const launchRows = await env.DB.prepare(
      `SELECT g.stable_id, g.id, g.title, g.platform_id, p.display_name as platform_name, r.release_date
       FROM games g
       JOIN platforms p ON p.id = g.platform_id
       JOIN game_releases r ON r.game_id = g.stable_id
       WHERE r.release_date = DATE('now')
         AND g.physical_status != 'verified_physical'`,
    ).all<{
      stable_id: number;
      id: string;
      title: string;
      platform_id: number;
      platform_name: string;
      release_date: string;
    }>();

    const gamesLaunchingToday = launchRows.results || [];
    if (gamesLaunchingToday.length === 0) {
      return { dispatchedCount: 0, purgedCount: 0 };
    }

    const updateStmts = gamesLaunchingToday.map((g) =>
      env.DB.prepare(
        `UPDATE games SET physical_status = 'likely_physical' WHERE stable_id = ?`,
      ).bind(g.stable_id),
    );
    await env.DB.batch(updateStmts);
    await markDbDirty(env);

    const subRows = await env.DB.prepare(
      `SELECT endpoint, p256dh, auth, preferences_json FROM push_subscriptions`,
    ).all<{
      endpoint: string;
      p256dh: string;
      auth: string;
      preferences_json: string | null;
    }>();

    for (const sub of subRows.results || []) {
      let prefs: Partial<DealNotificationPreferences> = {};
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

      for (const game of gamesLaunchingToday) {
        const title = `🎉 Game Launch Day: ${game.title}`;
        const body = `${game.title} officially releases today on ${game.platform_name}!`;

        const payload: WebPushNotificationPayload = {
          title,
          body,
          icon: '/icons/icon-192.png',
          badge: '/icons/badge-96.png',
          data: {
            url: `/collection/game/${game.id}`,
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
    }
  } catch (err) {
    console.error('[WebPush] Error dispatching launch day notifications:', err);
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
export async function syncWorkerIgdbSeriesAndCanonical(
  env: Env,
  options?: IgdbSeriesSyncOptions,
): Promise<{
  refreshedIgdbCount: number;
  updatedGamesCount: number;
  selfHealedRulesCount?: number;
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

  // 2. Query next incremental slice of games using primary key index
  let { results: batchResults } = await env.DB.prepare(
    `SELECT stable_id, title, platform_id, igdb_id, collections, franchises, canonical_series, physical_status, metadata_json
     FROM games
     WHERE stable_id > ?
     ORDER BY stable_id ASC
     LIMIT ?`,
  )
    .bind(lastStableId, batchSize)
    .all<{
      stable_id: number;
      title: string;
      platform_id: number;
      igdb_id: number | null;
      collections: string | null;
      franchises: string | null;
      canonical_series: string | null;
      physical_status?: string | null;
      metadata_json?: string | null;
    }>();

  let isEndOfTable = false;
  if (!batchResults || batchResults.length === 0) {
    // Reached the end of the collection; wrap around to beginning
    const wrapRes = await env.DB.prepare(
      `SELECT stable_id, title, platform_id, igdb_id, collections, franchises, canonical_series, physical_status, metadata_json
       FROM games
       WHERE stable_id > 0
       ORDER BY stable_id ASC
       LIMIT ?`,
    )
      .bind(batchSize)
      .all<{
        stable_id: number;
        title: string;
        platform_id: number;
        igdb_id: number | null;
        collections: string | null;
        franchises: string | null;
        canonical_series: string | null;
        physical_status?: string | null;
        metadata_json?: string | null;
      }>();
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

  // 3. Query tracked upcoming games (if any) to keep them always synchronized
  let trackedUpcomingGames: typeof batchGames = [];
  try {
    const upcomingRes = await env.DB.prepare(
      `SELECT stable_id, title, platform_id, igdb_id, collections, franchises, canonical_series, physical_status, metadata_json
       FROM games
       WHERE physical_status IN ('not_yet_physical', 'physical_pending', 'likely_physical')
         AND igdb_id IS NOT NULL AND igdb_id > 0`,
    ).all<{
      stable_id: number;
      title: string;
      platform_id: number;
      igdb_id: number | null;
      collections: string | null;
      franchises: string | null;
      canonical_series: string | null;
      physical_status?: string | null;
      metadata_json?: string | null;
    }>();
    trackedUpcomingGames = upcomingRes.results || [];
  } catch {
    // physical_status column fallback
  }

  // Combine batch games + tracked upcoming games, deduplicated by stable_id
  const candidateGamesMap = new Map<number, (typeof batchGames)[0]>();
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
    }
  >();

  if (
    igdbIdsToQuery.length > 0 &&
    env.TWITCH_CLIENT_ID &&
    env.TWITCH_CLIENT_SECRET
  ) {
    const igdbQuery = `fields id, collections.name, franchises.name, alternative_names.name, alternative_names.comment, game_localizations.name, game_localizations.region; where id = (${igdbIdsToQuery.join(',')}); limit ${igdbIdsToQuery.length};`;
    const rawIgdb = (await queryIGDBEdge('games', igdbQuery, env)) as Array<{
      id: number;
      collections?: Array<{ name: string }>;
      franchises?: Array<{ name: string }>;
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
      const metadataJson =
        (item.game_localizations && item.game_localizations.length > 0) ||
        (item.alternative_names && item.alternative_names.length > 0)
          ? JSON.stringify({
              game_localizations: item.game_localizations || [],
              alternative_names: item.alternative_names || [],
            })
          : null;
      igdbFreshMap.set(item.id, { collections, franchises, metadataJson });
    }
  }

  const statements: D1PreparedStatement[] = [];
  const trackableCandidates: Array<{
    stableId: number;
    platformId: number;
    canonicalSeries: string;
    seriesTrackable: boolean;
  }> = [];

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
    const metadataChanged =
      Boolean(fresh?.metadataJson) &&
      fresh?.metadataJson !== (game.metadata_json ?? null);

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
        platformId: game.platform_id,
        canonicalSeries: nextCanonicalSeries,
        seriesTrackable: true,
      });
    }

    if (
      nextCollections !== (game.collections ?? null) ||
      nextFranchises !== (game.franchises ?? null) ||
      nextCanonicalSeries !== (game.canonical_series ?? null) ||
      metadataChanged
    ) {
      statements.push(
        env.DB.prepare(
          `UPDATE games
           SET collections = ?,
               franchises = ?,
               canonical_series = ?,
               metadata_json = COALESCE(?, metadata_json)
           WHERE stable_id = ?`,
        ).bind(
          nextCollections,
          nextFranchises,
          nextCanonicalSeries,
          fresh?.metadataJson ?? null,
          game.stable_id,
        ),
      );
    }
  }

  const gameUpdatesCount = statements.length;

  // Rolling self-healing: evaluate active user_tracking_rules for any trackable games
  // in this batch that still lack any positive user_game_releases row or game-level override.
  let selfHealedRulesCount = 0;
  if (trackableCandidates.length > 0) {
    try {
      const releasesByGameId = new Map<
        number,
        Array<{ id: string; region: string | null }>
      >();
      const ownedOrSeekingGameIds = new Set<number>();

      for (let i = 0; i < trackableCandidates.length; i += 80) {
        const chunk = trackableCandidates.slice(i, i + 80);
        const ids = chunk.map((c) => c.stableId);
        const ph = ids.map(() => '?').join(',');

        const [relRes, activeRes] = await Promise.all([
          env.DB.prepare(
            `SELECT id, game_id, region FROM game_releases WHERE game_id IN (${ph})`,
          )
            .bind(...ids)
            .all<{ id: string; game_id: number; region: string | null }>(),
          env.DB.prepare(
            `SELECT DISTINCT r.game_id
             FROM user_game_releases ugr
             JOIN game_releases r ON r.id = ugr.release_id
             WHERE r.game_id IN (${ph}) AND ugr.ownership_status > 0`,
          )
            .bind(...ids)
            .all<{ game_id: number }>(),
        ]);

        for (const rel of relRes.results || []) {
          let list = releasesByGameId.get(rel.game_id);
          if (!list) {
            list = [];
            releasesByGameId.set(rel.game_id, list);
          }
          list.push({ id: rel.id, region: rel.region });
        }
        for (const row of activeRes.results || []) {
          ownedOrSeekingGameIds.add(row.game_id);
        }
      }

      const healGames = trackableCandidates
        .filter(
          (c) =>
            (releasesByGameId.get(c.stableId)?.length || 0) > 0 &&
            !ownedOrSeekingGameIds.has(c.stableId),
        )
        .map((c) => ({
          stableId: c.stableId,
          platformId: c.platformId,
          canonicalSeries: c.canonicalSeries,
          seriesTrackable: c.seriesTrackable,
          releases: releasesByGameId.get(c.stableId) || [],
        }));

      if (healGames.length > 0) {
        selfHealedRulesCount = await evaluateTrackingRulesForNewGames(
          env,
          healGames,
        );
      }
    } catch {
      // Ignore if tracking tables are absent in minimal test schemas
    }
  }

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

  statements.push(
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
  );

  if (statements.length > 0) {
    const CHUNK_SIZE = 100;
    for (let i = 0; i < statements.length; i += CHUNK_SIZE) {
      const chunk = statements.slice(i, i + CHUNK_SIZE);
      await env.DB.batch(chunk);
    }
    if (gameUpdatesCount > 0 || selfHealedRulesCount > 0) {
      await markDbDirty(env);
    }
  }

  return {
    refreshedIgdbCount: igdbFreshMap.size,
    updatedGamesCount: gameUpdatesCount + 1,
    selfHealedRulesCount,
    cursorOffset: nextOffset,
  };
}

export const DAILY_CATALOG_WRITE_BUDGET = 60000;

export interface IgdbGameMeta {
  igdb_id: number;
  igdb_url: string | null;
  image_url: string | null;
  summary: string | null;
  genres: string | null;
  collections: string | null;
  franchises: string | null;
  metadata_json: string | null;
}

export interface IgdbSearchCandidate {
  id: number;
  name?: string;
  url?: string;
  summary?: string;
  first_release_date?: number | string | null;
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

function sanitizeIgdbSearchTerm(title: string): string {
  return (title || '')
    .replace(/["\\]/g, '')
    .replace(/[\r\n;{}]/g, ' ')
    .trim();
}

/**
 * Strictly selects the IGDB candidate whose normalized name (or an alternative name)
 * exactly equals `normalizedTitle` and that lists `igdbPlatformId`. When a matched base
 * game's `first_release_date` predates `platformLaunchDate` (or links a dedicated remaster/port
 * on `igdbPlatformId`), prefers the native platform edition in `candidates`. Ambiguous or fuzzy
 * candidates are rejected: no metadata is preferred over wrong metadata.
 */
export function selectStrictIgdbMatch(
  candidates: IgdbSearchCandidate[],
  normalizedTitle: string,
  igdbPlatformId: number,
  options?: {
    platformLaunchDate?: string | null;
    hasBaseCanonicalRelease?: boolean;
  },
): IgdbSearchCandidate | null {
  if (!normalizedTitle) return null;
  const companionIds = new Set(getIgdbCompanionPlatformIds(igdbPlatformId));
  const onPlatform = (candidates || []).filter((c) =>
    extractIgdbPlatformIds(c.platforms).some((pid) => companionIds.has(pid)),
  );
  const exactMatches = onPlatform.filter(
    (c) =>
      normalizeTitleForMatching(c.name || '') === normalizedTitle ||
      (c.alternative_names || []).some(
        (a) => normalizeTitleForMatching(a.name || '') === normalizedTitle,
      ),
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
        if (relatedIds.has(c.id)) {
          if (cNorm === normalizedTitle) return true;
          if (predatesLaunch && cNorm === `${normalizedTitle}remastered`) {
            return true;
          }
        }
        if (predatesLaunch && cNorm === `${normalizedTitle}remastered`) {
          return true;
        }
        return false;
      });
      if (relatedCandidate) {
        return relatedCandidate;
      }
    }
  }

  const byName = onPlatform.find(
    (c) => normalizeTitleForMatching(c.name || '') === normalizedTitle,
  );
  if (byName) return byName;
  return (
    onPlatform.find((c) =>
      (c.alternative_names || []).some(
        (a) => normalizeTitleForMatching(a.name || '') === normalizedTitle,
      ),
    ) || null
  );
}

function toIgdbGameMeta(c: IgdbSearchCandidate): IgdbGameMeta {
  let imageUrl: string | null = null;
  if (c.cover?.image_id) {
    imageUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${c.cover.image_id}.jpg`;
  } else if (c.cover?.url) {
    imageUrl = (
      c.cover.url.startsWith('//') ? `https:${c.cover.url}` : c.cover.url
    ).replace('/t_thumb/', '/t_cover_big/');
  }
  const hasLocalized =
    (c.game_localizations && c.game_localizations.length > 0) ||
    (c.alternative_names && c.alternative_names.length > 0);
  return {
    igdb_id: c.id,
    igdb_url: c.url || null,
    image_url: imageUrl,
    summary: c.summary || null,
    genres: c.genres?.map((g) => g.name).join(', ') || null,
    collections: c.collections?.map((x) => x.name).join(', ') || null,
    franchises: c.franchises?.map((x) => x.name).join(', ') || null,
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
  }>,
): Promise<Map<string, IgdbGameMeta>> {
  const out = new Map<string, IgdbGameMeta>();
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) return out;

  const eligible = items.filter(
    (i) =>
      i.igdbPlatformId &&
      i.igdbPlatformId > 0 &&
      i.normalizedTitle &&
      sanitizeIgdbSearchTerm(i.title).length > 0,
  );

  for (let start = 0; start < eligible.length; start += IGDB_MULTIQUERY_MAX) {
    const chunk = eligible.slice(start, start + IGDB_MULTIQUERY_MAX);
    const body = chunk
      .map((item, idx) => {
        const term = sanitizeIgdbSearchTerm(item.title);
        // NOTE: IGDB `search` returns no rows inside multiquery sub-queries, so use
        // case-insensitive substring filters and apply strict normalized matching locally.
        return `query games "q${idx}" { fields id, name, url, summary, cover.image_id, cover.url, genres.name, collections.name, franchises.name, platforms, alternative_names.name, alternative_names.comment, game_localizations.name, game_localizations.region; where platforms = (${item.igdbPlatformId}) & (name ~ *"${term}"* | alternative_names.name ~ *"${term}"*); sort id asc; limit 50; };`;
      })
      .join('\n');
    try {
      const res = (await queryIGDBEdge('multiquery', body, env)) as Array<{
        name: string;
        result?: IgdbSearchCandidate[];
      }>;
      for (const entry of res || []) {
        const idx = parseInt((entry.name || '').replace(/^q/, ''), 10);
        const item = Number.isFinite(idx) ? chunk[idx] : undefined;
        if (!item) continue;
        const match = selectStrictIgdbMatch(
          entry.result || [],
          item.normalizedTitle,
          item.igdbPlatformId as number,
        );
        if (match) out.set(item.key, toIgdbGameMeta(match));
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
  stage: '2A' | '2B' | 'done';
  paused: boolean;
  cursor: number;
  dailyWriteBudget: number;
  writesUsedToday: number;
  gamesIngestedToday: number;
  releasesIngestedToday: number;
  lastUpdatedAt: string | null;
  canonicalMinId: number;
  canonicalMaxId: number;
  currentPlatformName: string | null;
  maxGameStableId: number;
  igdbBackfill: {
    cursor: number;
    lastWrapDate: string | null;
    matchedTotal: number;
    rulesAppliedTotal: number;
    lastRunAt: string | null;
  };
  igdbRolling: {
    cursorOffset: number;
    refreshedTotal: number;
    updatedTotal: number;
    selfHealedRulesTotal: number;
    lastRunAt: string | null;
  };
  upstreamSources: {
    switchRevisionsUpdatedAt: string | null;
    amiiboCatalogUpdatedAt: string | null;
  };
}> {
  const includeTableBounds = options?.includeTableBounds ?? true;
  const todayStr = new Date().toISOString().slice(0, 10);
  let stage: '2A' | '2B' | 'done' = '2A';
  let paused = false;
  let cursor = 0;
  let writesUsedToday = 0;
  let gamesIngestedToday = 0;
  let releasesIngestedToday = 0;
  let lastUpdatedAt: string | null = null;
  let igdbBackfillCursor = 0;
  let igdbBackfillLastWrapDate: string | null = null;
  let igdbBackfillStats = {
    matchedTotal: 0,
    rulesAppliedTotal: 0,
    lastRunAt: null as string | null,
  };
  let igdbSyncOffset = 0;
  let igdbRollingStats = {
    refreshedTotal: 0,
    updatedTotal: 0,
    selfHealedRulesTotal: 0,
    lastRunAt: null as string | null,
  };
  let switchRevisionsUpdatedAt: string | null = null;
  let amiiboCatalogUpdatedAt: string | null = null;

  try {
    const { results } = await env.DB.prepare(
      `SELECT key, value, updated_at FROM sync_state
       WHERE key IN (
         'catalog_seed_stage',
         'catalog_seed_paused',
         'catalog_seed_cursor',
         'catalog_seed_daily_writes',
         'igdb_backfill_cursor',
         'igdb_backfill_last_wrap_date',
         'igdb_backfill_stats',
         'igdb_sync_offset',
         'igdb_rolling_stats',
         'switch_revisions_hash',
         'amiibo_catalog_hash'
       )`,
    ).all<{ key: string; value: string; updated_at: string }>();

    for (const row of results || []) {
      if (row.key === 'catalog_seed_stage') {
        if (row.value === '2A' || row.value === '2B' || row.value === 'done') {
          stage = row.value;
        }
      } else if (row.key === 'catalog_seed_paused') {
        paused = row.value === '1';
      } else if (row.key === 'catalog_seed_cursor') {
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
      } else if (row.key === 'igdb_backfill_cursor') {
        const parsed = parseInt(row.value, 10);
        if (Number.isFinite(parsed) && parsed >= 0) {
          igdbBackfillCursor = parsed;
        }
      } else if (row.key === 'igdb_backfill_last_wrap_date') {
        igdbBackfillLastWrapDate = row.value || null;
      } else if (row.key === 'igdb_backfill_stats') {
        try {
          const parsed = JSON.parse(row.value) as {
            matchedTotal?: number;
            rulesAppliedTotal?: number;
            lastRunAt?: string | null;
          };
          igdbBackfillStats = {
            matchedTotal: Number(parsed?.matchedTotal) || 0,
            rulesAppliedTotal: Number(parsed?.rulesAppliedTotal) || 0,
            lastRunAt: parsed?.lastRunAt || row.updated_at || null,
          };
        } catch {
          // ignore malformed JSON
        }
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
      } else if (row.key === 'switch_revisions_hash') {
        switchRevisionsUpdatedAt = row.updated_at || null;
      } else if (row.key === 'amiibo_catalog_hash') {
        amiiboCatalogUpdatedAt = row.updated_at || null;
      }
    }
  } catch {
    // Fallback if sync_state table is unmigrated
  }

  let canonicalMinId = 0;
  let canonicalMaxId = 0;
  let currentPlatformName: string | null = null;
  let maxGameStableId = 0;
  if (includeTableBounds) {
    try {
      const [minRow, maxRow, platRow, gameMaxRow] = await Promise.all([
        env.DB.prepare(
          'SELECT COALESCE(MIN(id), 0) as min_id FROM canonical_releases',
        ).first<{ min_id: number }>(),
        env.DB.prepare(
          'SELECT COALESCE(MAX(id), 0) as max_id FROM canonical_releases',
        ).first<{ max_id: number }>(),
        env.DB.prepare(
          `SELECT p.display_name
           FROM canonical_releases cr
           LEFT JOIN platforms p ON p.id = cr.platform_id
           WHERE cr.id >= ?
           ORDER BY cr.id ASC
           LIMIT 1`,
        )
          .bind(cursor)
          .first<{ display_name: string | null }>(),
        env.DB.prepare(
          'SELECT COALESCE(MAX(stable_id), 0) as max_stable_id FROM games',
        ).first<{ max_stable_id: number }>(),
      ]);
      canonicalMinId = Number(minRow?.min_id) || 0;
      canonicalMaxId = Number(maxRow?.max_id) || 0;
      currentPlatformName = platRow?.display_name ?? null;
      maxGameStableId = Number(gameMaxRow?.max_stable_id) || 0;
    } catch {
      // Minimal test schemas may omit canonical_releases or platforms
    }
  }

  return {
    stage,
    paused,
    cursor,
    dailyWriteBudget: DAILY_CATALOG_WRITE_BUDGET,
    writesUsedToday,
    gamesIngestedToday,
    releasesIngestedToday,
    lastUpdatedAt,
    canonicalMinId,
    canonicalMaxId,
    currentPlatformName,
    maxGameStableId,
    igdbBackfill: {
      cursor: igdbBackfillCursor,
      lastWrapDate: igdbBackfillLastWrapDate,
      matchedTotal: igdbBackfillStats.matchedTotal,
      rulesAppliedTotal: igdbBackfillStats.rulesAppliedTotal,
      lastRunAt: igdbBackfillStats.lastRunAt,
    },
    igdbRolling: {
      cursorOffset: igdbSyncOffset,
      refreshedTotal: igdbRollingStats.refreshedTotal,
      updatedTotal: igdbRollingStats.updatedTotal,
      selfHealedRulesTotal: igdbRollingStats.selfHealedRulesTotal,
      lastRunAt: igdbRollingStats.lastRunAt,
    },
    upstreamSources: {
      switchRevisionsUpdatedAt,
      amiiboCatalogUpdatedAt,
    },
  };
}

/**
 * Autonomous Broad Physical Release Ingestion (`DAILY_CATALOG_WRITE_BUDGET = 60,000` writes/day).
 * Stage 2A ingests all verified USA/World physical releases first (`canonical_releases`),
 * followed by Stage 2B for international exclusives, and evaluates `user_tracking_rules`
 * so matching games enter users' libraries as `Seeking (2)` while everything else enters as `Unowned (0)`.
 */
export async function syncWorkerBroadCatalogPopulation(env: Env): Promise<{
  skipped: boolean;
  reason?: string;
  stage: '2A' | '2B' | 'done';
  cursor: number;
  ingestedGames: number;
  ingestedReleases: number;
  writesUsed: number;
  igdbMatched?: number;
}> {
  const status = await getBroadCatalogSeedStatus(env, {
    includeTableBounds: false,
  });
  if (status.paused) {
    return {
      skipped: true,
      reason: 'paused',
      stage: status.stage,
      cursor: status.cursor,
      ingestedGames: 0,
      ingestedReleases: 0,
      writesUsed: 0,
    };
  }

  if (status.writesUsedToday >= DAILY_CATALOG_WRITE_BUDGET) {
    return {
      skipped: true,
      reason: 'daily_budget_reached',
      stage: status.stage,
      cursor: status.cursor,
      ingestedGames: 0,
      ingestedReleases: 0,
      writesUsed: 0,
    };
  }

  // 48 ticks per 24h -> ~1,250 billable writes per 30-min tick (~60-65 games/tick)
  const tickWriteBudget = Math.min(
    1250,
    DAILY_CATALOG_WRITE_BUDGET - status.writesUsedToday,
  );

  let currentStage = status.stage;
  let currentCursor = status.cursor;

  const fetchStageSlice = async (
    stageToQuery: '2A' | '2B' | 'done',
    afterId: number,
  ) => {
    if (stageToQuery === '2A') {
      const res = await env.DB.prepare(
        `SELECT id, platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, serial_code
         FROM canonical_releases
         WHERE id > ?
           AND is_verified_physical = 1
           AND NOT (COALESCE(source, '') = 'nintendo_revised' AND (region = 'World' OR region IS NULL) AND serial_code IS NULL)
           AND region IN ('USA', 'World', 'USA, Europe', 'Japan, USA', 'USA, Australia', 'USA, Korea')
         ORDER BY id ASC
         LIMIT 200`,
      )
        .bind(afterId)
        .all<{
          id: number;
          platform_id: number;
          raw_title: string;
          normalized_title: string;
          region: string | null;
          variants: string | null;
          rom_name: string | null;
          rom_crc: string | null;
          serial_code: string | null;
        }>();
      return res.results || [];
    } else if (stageToQuery === '2B') {
      const res = await env.DB.prepare(
        `SELECT id, platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, serial_code
         FROM canonical_releases
         WHERE id > ?
           AND is_verified_physical = 1
           AND NOT (COALESCE(source, '') = 'nintendo_revised' AND (region = 'World' OR region IS NULL) AND serial_code IS NULL)
           AND (region IS NULL OR region NOT IN ('USA', 'World', 'USA, Europe', 'Japan, USA', 'USA, Australia', 'USA, Korea'))
         ORDER BY id ASC
         LIMIT 200`,
      )
        .bind(afterId)
        .all<{
          id: number;
          platform_id: number;
          raw_title: string;
          normalized_title: string;
          region: string | null;
          variants: string | null;
          rom_name: string | null;
          rom_crc: string | null;
          serial_code: string | null;
        }>();
      return res.results || [];
    } else {
      const res = await env.DB.prepare(
        `SELECT id, platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, serial_code
         FROM canonical_releases
         WHERE id > ?
           AND is_verified_physical = 1
           AND NOT (COALESCE(source, '') = 'nintendo_revised' AND (region = 'World' OR region IS NULL) AND serial_code IS NULL)
         ORDER BY id ASC
         LIMIT 100`,
      )
        .bind(afterId)
        .all<{
          id: number;
          platform_id: number;
          raw_title: string;
          normalized_title: string;
          region: string | null;
          variants: string | null;
          rom_name: string | null;
          rom_crc: string | null;
          serial_code: string | null;
        }>();
      return res.results || [];
    }
  };

  let slice = await fetchStageSlice(currentStage, currentCursor);
  if (slice.length === 0) {
    if (currentStage === '2A') {
      currentStage = '2B';
      currentCursor = 0;
      slice = await fetchStageSlice('2B', 0);
    }
    if (slice.length === 0 && currentStage === '2B') {
      const maxIdRow = await env.DB.prepare(
        'SELECT COALESCE(MAX(id), 0) as max_id FROM canonical_releases',
      ).first<{ max_id: number }>();
      currentCursor = maxIdRow?.max_id ?? 0;
      if (status.stage !== 'done') {
        await env.DB.batch([
          env.DB.prepare(
            `INSERT INTO sync_state (key, value, updated_at)
             VALUES ('catalog_seed_stage', 'done', CURRENT_TIMESTAMP)
             ON CONFLICT(key) DO UPDATE SET value = 'done', updated_at = CURRENT_TIMESTAMP`,
          ),
          env.DB.prepare(
            `INSERT INTO sync_state (key, value, updated_at)
             VALUES ('catalog_seed_cursor', ?, CURRENT_TIMESTAMP)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
          ).bind(String(currentCursor)),
        ]);
      }
      return {
        skipped: true,
        reason: 'completed',
        stage: 'done',
        cursor: currentCursor,
        ingestedGames: 0,
        ingestedReleases: 0,
        writesUsed: 0,
      };
    }
    if (slice.length === 0) {
      return {
        skipped: true,
        reason: 'no_new_canonical_releases',
        stage: currentStage,
        cursor: currentCursor,
        ingestedGames: 0,
        ingestedReleases: 0,
        writesUsed: 0,
      };
    }
  }

  // Group slice rows by (platform_id, normalized_title) while preserving highest canonical ID seen per group
  const groupsMap = new Map<
    string,
    {
      platform_id: number;
      normalized_title: string;
      raw_title: string;
      maxSliceId: number;
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
    const key = `${row.platform_id}::${row.normalized_title}`;
    const existing = groupsMap.get(key);
    if (!existing) {
      groupsMap.set(key, {
        platform_id: row.platform_id,
        normalized_title: row.normalized_title,
        raw_title: row.raw_title,
        maxSliceId: row.id,
      });
    } else if (row.id > existing.maxSliceId) {
      existing.maxSliceId = row.id;
    }
  }

  if (groupsMap.size === 0) {
    // Entire slice was non-retail: just advance the cursor past it.
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO sync_state (key, value, updated_at)
         VALUES ('catalog_seed_stage', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      ).bind(currentStage),
      env.DB.prepare(
        `INSERT INTO sync_state (key, value, updated_at)
         VALUES ('catalog_seed_cursor', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      ).bind(String(sliceMaxId)),
    ]);
    return {
      skipped: false,
      stage: currentStage,
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
      `SELECT id, display_name, igdb_id FROM platforms WHERE id IN (${platformPlaceholders})`,
    )
      .bind(...distinctPlatforms)
      .all<{ id: number; display_name: string; igdb_id: number | null }>(),
    env.DB.prepare(
      `SELECT stable_id, id, title, platform_id, canonical_series, collections, franchises
       FROM games
       WHERE platform_id IN (${platformPlaceholders})`,
    )
      .bind(...distinctPlatforms)
      .all<{
        stable_id: number;
        id: string;
        title: string;
        platform_id: number;
        canonical_series: string | null;
        collections: string | null;
        franchises: string | null;
      }>(),
  ]);

  const platformNameById = new Map<number, string>();
  const platformIgdbIdById = new Map<number, number | null>();
  for (const p of platformsRes.results || []) {
    platformNameById.set(p.id, p.display_name);
    platformIgdbIdById.set(p.id, p.igdb_id ?? null);
  }

  const existingGameByPlatformNorm = new Map<
    string,
    {
      stable_id: number;
      id: string;
      title: string;
      platform_id: number;
      canonical_series: string | null;
      collections: string | null;
      franchises: string | null;
    }
  >();
  const usedGameSlugs = new Set<string>();
  const maxSortByPlatform = new Map<number, number>();
  for (const g of existingGamesRes.results || []) {
    usedGameSlugs.add(g.id);
    const meta = {
      stable_id: g.stable_id,
      id: g.id,
      title: g.title,
      platform_id: g.platform_id,
      canonical_series: g.canonical_series ?? null,
      collections: g.collections ?? null,
      franchises: g.franchises ?? null,
    };
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

  const slugify = (s: string) =>
    (s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  let tickWritesUsed = 0;
  let ingestedGamesCount = 0;
  let ingestedReleasesCount = 0;
  let igdbMatchedCount = 0;
  let nextCursor = currentCursor;

  // Resolve IGDB metadata up front for groups that will be inserted, so each new game
  // row carries igdb_id / cover / summary in its single INSERT (no follow-up UPDATE).
  const igdbLookupItems: Array<{
    key: string;
    title: string;
    normalizedTitle: string;
    igdbPlatformId: number | null;
  }> = [];
  for (const [key, group] of groupsMap) {
    if (existingGameByPlatformNorm.has(key)) continue;
    const title = cleanCanonicalDisplayTitle(group.raw_title);
    igdbLookupItems.push({
      key,
      title,
      normalizedTitle: normalizeTitleForMatching(title),
      igdbPlatformId: platformIgdbIdById.get(group.platform_id) ?? null,
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
    releases: Array<{ id: string; region: string | null }>;
  }> = [];

  let stoppedEarly = false;
  for (const group of groupsMap.values()) {
    // Fetch all verified canonical releases for this (platform_id, normalized_title) via idx_canonical_platform_norm
    const allRelRes = await env.DB.prepare(
      `SELECT id, raw_title, region, variants, rom_name, rom_crc, serial_code
       FROM canonical_releases
       WHERE platform_id = ?
         AND normalized_title = ?
         AND is_verified_physical = 1
         AND NOT (COALESCE(source, '') = 'nintendo_revised' AND (region = 'World' OR region IS NULL) AND serial_code IS NULL)
       ORDER BY id ASC`,
    )
      .bind(group.platform_id, group.normalized_title)
      .all<{
        id: number;
        raw_title: string;
        region: string | null;
        variants: string | null;
        rom_name: string | null;
        rom_crc: string | null;
        serial_code: string | null;
      }>();

    const canonicalRels = (allRelRes.results || []).filter(
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

    const existingGame = existingGameByPlatformNorm.get(
      `${group.platform_id}::${group.normalized_title}`,
    );
    if (existingGame) {
      // Attach any newly discovered regional or revision releases past the cursor to the existing game
      const existingRelRes = await env.DB.prepare(
        'SELECT id, region, variants, rom_crc, canonical_release_id FROM game_releases WHERE game_id = ?',
      )
        .bind(existingGame.stable_id)
        .all<{
          id: string;
          region: string | null;
          variants: string | null;
          rom_crc: string | null;
          canonical_release_id: number | null;
        }>();
      const existingRels = existingRelRes.results || [];
      const existingCanonicalIds = new Set(
        existingRels
          .map((r) => r.canonical_release_id)
          .filter((id): id is number => id !== null && id !== undefined),
      );
      const existingRegionVariantKeys = new Set(
        existingRels.map(
          (r) =>
            `${(r.region || '').trim()}::${(r.variants || 'Standard').trim()}`,
        ),
      );
      const existingCrcs = new Set(
        existingRels
          .map((r) => (r.rom_crc || '').trim().toUpperCase())
          .filter(Boolean),
      );

      const newCanonicalRels = canonicalRels.filter((cr) => {
        if (cr.id <= currentCursor) return false;
        if (existingCanonicalIds.has(cr.id)) return false;
        const crCrc = (cr.rom_crc || '').trim().toUpperCase();
        if (crCrc && existingCrcs.has(crCrc)) return false;
        const crReg = (cr.region || 'USA').trim();
        const crVar = (cr.variants || 'Standard').trim();
        if (existingRegionVariantKeys.has(`${crReg}::${crVar}`)) return false;
        return true;
      });

      if (newCanonicalRels.length > 0) {
        const estimatedNewRelWrites = newCanonicalRels.length * 7;
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

        for (let i = 0; i < newCanonicalRels.length; i++) {
          const cr = newCanonicalRels[i];
          const rawRelSlug = `${existingGame.id}-${cr.rom_crc || slugify(cr.serial_code || cr.rom_name || cr.region || `rel-${cr.id}`)}`;
          let relSlug = rawRelSlug;
          let relCounter = 1;
          while (usedRelSlugs.has(relSlug)) {
            relSlug = `${rawRelSlug}-${relCounter++}`;
          }
          usedRelSlugs.add(relSlug);
          const relRegion = cr.region || 'USA';
          addedReleasesForExisting.push({ id: relSlug, region: relRegion });
          relStatements.push(
            env.DB.prepare(
              `INSERT INTO game_releases (
                 id, game_id, region, variants, rom_name, rom_crc, canonical_release_id
               ) VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO NOTHING`,
            ).bind(
              relSlug,
              existingGame.stable_id,
              relRegion,
              cr.variants || null,
              cr.rom_name || null,
              cr.rom_crc || null,
              cr.id,
            ),
          );
        }

        if (relStatements.length > 0) {
          await env.DB.batch(relStatements);
        }

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
        tickWritesUsed += estimatedNewRelWrites;
        ingestedReleasesCount += newCanonicalRels.length;
      }

      nextCursor = Math.max(nextCursor, group.maxSliceId);
      continue;
    }

    // Estimate billable writes: 1 game row + 7 always-populated indexes (+1 partial idx_games_igdb_id
    // when igdb_id is set) + M release rows (M * (1 + 6) = 7M writes)
    const igdbMeta =
      igdbMetaByGroup.get(`${group.platform_id}::${group.normalized_title}`) ||
      null;
    const estimatedWrites = (igdbMeta ? 9 : 8) + canonicalRels.length * 7;
    if (
      tickWritesUsed > 0 &&
      tickWritesUsed + estimatedWrites > tickWriteBudget
    ) {
      stoppedEarly = true;
      break;
    }

    const preferredRel =
      canonicalRels.find(
        (r) =>
          r.region === 'USA' ||
          r.region === 'World' ||
          (r.region && r.region.includes('USA')),
      ) || canonicalRels[0];
    const displayTitle = cleanCanonicalDisplayTitle(
      preferredRel.raw_title || group.raw_title,
    );
    const platformName =
      platformNameById.get(group.platform_id) ||
      `platform-${group.platform_id}`;
    const baseSlug = `${slugify(displayTitle)}-${slugify(platformName)}`;
    let candidateGameId = baseSlug;
    let suffix = 1;
    while (usedGameSlugs.has(candidateGameId)) {
      candidateGameId = `${baseSlug}-${suffix++}`;
    }
    usedGameSlugs.add(candidateGameId);

    const canonicalSeries = computeGameCanonicalSeries({
      title: displayTitle,
      collections: igdbMeta?.collections ?? undefined,
      franchises: igdbMeta?.franchises ?? undefined,
    });
    const gameRegion = preferredRel.region || 'USA';
    const nextSort = (maxSortByPlatform.get(group.platform_id) ?? 1000) + 1;
    maxSortByPlatform.set(group.platform_id, nextSort);

    await env.DB.prepare(
      `INSERT INTO games (
         id, title, platform_id, sort_index, region,
         manually_verified, physical_status, verification_tier, canonical_series,
         igdb_id, igdb_url, image_url, summary, genres, collections, franchises, metadata_json
       ) VALUES (?, ?, ?, ?, ?, 0, 'verified_physical', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
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
      )
      .run();
    if (igdbMeta) igdbMatchedCount++;

    const insertedGame = await env.DB.prepare(
      'SELECT stable_id FROM games WHERE id = ?',
    )
      .bind(candidateGameId)
      .first<{ stable_id: number }>();

    const stableId = insertedGame?.stable_id ?? 0;
    if (!stableId) {
      nextCursor = Math.max(nextCursor, group.maxSliceId);
      continue;
    }

    existingGameByPlatformNorm.set(
      `${group.platform_id}::${group.normalized_title}`,
      {
        stable_id: stableId,
        id: candidateGameId,
        title: displayTitle,
        platform_id: group.platform_id,
        canonical_series: canonicalSeries,
        collections: igdbMeta?.collections ?? null,
        franchises: igdbMeta?.franchises ?? null,
      },
    );

    const relStatements: D1PreparedStatement[] = [];
    const addedReleases: Array<{ id: string; region: string | null }> = [];
    const usedRelSlugs = new Set<string>();

    for (let i = 0; i < canonicalRels.length; i++) {
      const cr = canonicalRels[i];
      const rawRelSlug = `${candidateGameId}-${cr.rom_crc || slugify(cr.serial_code || cr.rom_name || cr.region || `rel-${i + 1}`)}`;
      let relSlug = rawRelSlug;
      let relCounter = 1;
      while (usedRelSlugs.has(relSlug)) {
        relSlug = `${rawRelSlug}-${relCounter++}`;
      }
      usedRelSlugs.add(relSlug);
      addedReleases.push({ id: relSlug, region: cr.region || gameRegion });

      relStatements.push(
        env.DB.prepare(
          `INSERT INTO game_releases (
             id, game_id, region, variants, rom_name, rom_crc, canonical_release_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO NOTHING`,
        ).bind(
          relSlug,
          stableId,
          cr.region || gameRegion,
          cr.variants || null,
          cr.rom_name || null,
          cr.rom_crc || null,
          cr.id,
        ),
      );
    }

    if (relStatements.length > 0) {
      await env.DB.batch(relStatements);
    }

    newlyIngestedForTracking.push({
      stableId: stableId,
      platformId: group.platform_id,
      canonicalSeries: canonicalSeries,
      seriesTrackable: isSeriesTrackable({
        title: displayTitle,
        collections: igdbMeta?.collections,
        franchises: igdbMeta?.franchises,
      }),
      releases: addedReleases,
    });

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
    );
    // Each user_game_releases row insert incurs 1 + 1 = 2 billable writes
    const ruleWrites = matchedSeekingRows * 2;
    tickWritesUsed += ruleWrites;
    invalidateSeriesScanCache();
    await markDbDirty(env);
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const updatedDaily = {
    date: todayStr,
    writes: status.writesUsedToday + tickWritesUsed,
    games: status.gamesIngestedToday + ingestedGamesCount,
    releases: status.releasesIngestedToday + ingestedReleasesCount,
  };

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO sync_state (key, value, updated_at)
       VALUES ('catalog_seed_stage', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    ).bind(currentStage),
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
    stage: currentStage,
    cursor: nextCursor,
    ingestedGames: ingestedGamesCount,
    ingestedReleases: ingestedReleasesCount,
    writesUsed: tickWritesUsed,
    igdbMatched: igdbMatchedCount,
  };
}

/**
 * Continuous IGDB metadata backfill and rule self-healing for bare games.
 * Walks `games` by primary key (`igdb_backfill_cursor`), only touching rows with no
 * igdb_id, image_url, or summary (so hand-curated games are never modified), wraps around
 * at most once per UTC day (`igdb_backfill_last_wrap_date`), and evaluates
 * `user_tracking_rules` whenever a game gains IGDB series/franchise metadata.
 */
export async function syncWorkerIgdbMetadataBackfill(
  env: Env,
  options?: { batchSize?: number },
): Promise<{
  skipped: boolean;
  reason?: string;
  scanned: number;
  matched: number;
  rulesApplied?: number;
  cursor: number;
  writesUsed: number;
}> {
  const batchSize = options?.batchSize ?? 100;
  const todayStr = new Date().toISOString().slice(0, 10);
  let cursor = 0;
  let lastWrapDate: string | null = null;
  let prevStats = { matchedTotal: 0, rulesAppliedTotal: 0 };
  try {
    const { results } = await env.DB.prepare(
      `SELECT key, value FROM sync_state
       WHERE key IN ('igdb_backfill_cursor', 'igdb_backfill_last_wrap_date', 'igdb_backfill_stats')`,
    ).all<{ key: string; value: string }>();
    for (const row of results || []) {
      if (row.key === 'igdb_backfill_cursor') {
        const parsed = parseInt(row.value, 10);
        if (Number.isFinite(parsed) && parsed >= 0) cursor = parsed;
      } else if (row.key === 'igdb_backfill_last_wrap_date') {
        lastWrapDate = row.value || null;
      } else if (row.key === 'igdb_backfill_stats' && row.value) {
        try {
          const parsed = JSON.parse(row.value) as {
            matchedTotal?: number;
            rulesAppliedTotal?: number;
          };
          prevStats = {
            matchedTotal: Number(parsed?.matchedTotal) || 0,
            rulesAppliedTotal: Number(parsed?.rulesAppliedTotal) || 0,
          };
        } catch {
          // ignore malformed JSON
        }
      }
    }
  } catch {
    // unmigrated sync_state
  }
  const base = {
    scanned: 0,
    matched: 0,
    rulesApplied: 0,
    cursor,
    writesUsed: 0,
  };
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) {
    return { skipped: true, reason: 'igdb_not_configured', ...base };
  }

  const status = await getBroadCatalogSeedStatus(env, {
    includeTableBounds: false,
  });
  const estimatedMaxWrites = batchSize * 2 + 2;
  if (
    status.writesUsedToday + estimatedMaxWrites >
    DAILY_CATALOG_WRITE_BUDGET
  ) {
    return { skipped: true, reason: 'daily_budget_reached', ...base };
  }

  // PK range scan over games; platforms joined by primary key.
  const { results: rows } = await env.DB.prepare(
    `SELECT g.stable_id, g.title, g.platform_id, g.region, g.igdb_id, g.image_url, g.summary, p.igdb_id AS igdb_platform_id
     FROM games g
     LEFT JOIN platforms p ON p.id = g.platform_id
     WHERE g.stable_id > ?
     ORDER BY g.stable_id ASC
     LIMIT ?`,
  )
    .bind(cursor, batchSize)
    .all<{
      stable_id: number;
      title: string;
      platform_id: number;
      region: string | null;
      igdb_id: number | null;
      image_url: string | null;
      summary: string | null;
      igdb_platform_id: number | null;
    }>();

  const slice = rows || [];
  if (slice.length === 0) {
    if (lastWrapDate === todayStr) {
      return { skipped: true, reason: 'completed', ...base };
    }
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO sync_state (key, value, updated_at)
         VALUES ('igdb_backfill_cursor', '0', CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = '0', updated_at = CURRENT_TIMESTAMP`,
      ),
      env.DB.prepare(
        `INSERT INTO sync_state (key, value, updated_at)
         VALUES ('igdb_backfill_last_wrap_date', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      ).bind(todayStr),
      env.DB.prepare(
        `INSERT INTO sync_state (key, value, updated_at)
         VALUES ('igdb_backfill_done', '0', CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = '0', updated_at = CURRENT_TIMESTAMP`,
      ),
    ]);
    return {
      skipped: true,
      reason: 'wrapped_to_start',
      scanned: 0,
      matched: 0,
      rulesApplied: 0,
      cursor: 0,
      writesUsed: 2,
    };
  }

  const candidates = slice.filter(
    (r) => r.igdb_id == null && r.image_url == null && r.summary == null,
  );
  const metaById = await fetchIgdbMetadataForTitles(
    env,
    candidates.map((r) => ({
      key: String(r.stable_id),
      title: r.title,
      normalizedTitle: normalizeTitleForMatching(r.title),
      igdbPlatformId: r.igdb_platform_id,
    })),
  );

  const statements: D1PreparedStatement[] = [];
  const matchedGames: Array<{
    stableId: number;
    platformId: number;
    fallbackRegion: string | null;
    canonicalSeries: string;
    seriesTrackable: boolean;
  }> = [];

  for (const r of candidates) {
    const meta = metaById.get(String(r.stable_id));
    if (!meta) continue;
    const canonicalSeries = computeGameCanonicalSeries({
      title: r.title,
      collections: meta.collections ?? undefined,
      franchises: meta.franchises ?? undefined,
    });
    statements.push(
      env.DB.prepare(
        `UPDATE games SET
           igdb_id = ?, igdb_url = ?, image_url = ?, summary = ?, genres = ?,
           collections = ?, franchises = ?,
           metadata_json = COALESCE(metadata_json, ?),
           canonical_series = COALESCE(NULLIF(?, ''), canonical_series)
         WHERE stable_id = ? AND igdb_id IS NULL`,
      ).bind(
        meta.igdb_id,
        meta.igdb_url,
        meta.image_url,
        meta.summary,
        meta.genres,
        meta.collections,
        meta.franchises,
        meta.metadata_json,
        canonicalSeries || null,
        r.stable_id,
      ),
    );
    matchedGames.push({
      stableId: r.stable_id,
      platformId: r.platform_id,
      fallbackRegion: r.region ?? null,
      canonicalSeries,
      seriesTrackable: isSeriesTrackable({
        title: r.title,
        collections: meta.collections,
        franchises: meta.franchises,
      }),
    });
  }

  const nextCursor = slice[slice.length - 1].stable_id;
  const matchedCount = matchedGames.length;
  statements.push(
    env.DB.prepare(
      `INSERT INTO sync_state (key, value, updated_at)
       VALUES ('igdb_backfill_cursor', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    ).bind(String(nextCursor)),
  );
  await env.DB.batch(statements);

  // Evaluate tracking rules for games that just gained IGDB series/franchise metadata
  let rulesApplied = 0;
  if (matchedGames.length > 0) {
    try {
      const releasesByGame = new Map<
        number,
        Array<{ id: string; region: string | null }>
      >();
      for (let i = 0; i < matchedGames.length; i += 80) {
        const chunkIds = matchedGames.slice(i, i + 80).map((g) => g.stableId);
        const ph = chunkIds.map(() => '?').join(',');
        const relRes = await env.DB.prepare(
          `SELECT id, game_id, region FROM game_releases WHERE game_id IN (${ph})`,
        )
          .bind(...chunkIds)
          .all<{ id: string; game_id: number; region: string | null }>();
        for (const rel of relRes.results || []) {
          let list = releasesByGame.get(rel.game_id);
          if (!list) {
            list = [];
            releasesByGame.set(rel.game_id, list);
          }
          list.push({ id: rel.id, region: rel.region });
        }
      }

      const gamesForRules = matchedGames
        .map((g) => ({
          stableId: g.stableId,
          platformId: g.platformId,
          canonicalSeries: g.canonicalSeries,
          seriesTrackable: g.seriesTrackable,
          releases: (releasesByGame.get(g.stableId) || []).map((rel) => ({
            id: rel.id,
            region: rel.region ?? g.fallbackRegion,
          })),
        }))
        .filter((g) => g.releases.length > 0);

      if (gamesForRules.length > 0) {
        rulesApplied = await evaluateTrackingRulesForNewGames(
          env,
          gamesForRules,
        );
      }
    } catch {
      // Ignore if tracking rule tables are absent in minimal schemas
    }
  }

  const writesUsed = matchedCount * 2 + rulesApplied * 2;
  const statsPayload = {
    matchedTotal: prevStats.matchedTotal + matchedCount,
    rulesAppliedTotal: prevStats.rulesAppliedTotal + rulesApplied,
    lastRunAt: new Date().toISOString(),
  };

  const stateStatements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO sync_state (key, value, updated_at)
       VALUES ('igdb_backfill_stats', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    ).bind(JSON.stringify(statsPayload)),
  ];
  if (writesUsed > 0) {
    const updatedDaily = {
      date: todayStr,
      writes: status.writesUsedToday + writesUsed,
      games: status.gamesIngestedToday,
      releases: status.releasesIngestedToday,
    };
    stateStatements.push(
      env.DB.prepare(
        `INSERT INTO sync_state (key, value, updated_at)
         VALUES ('catalog_seed_daily_writes', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      ).bind(JSON.stringify(updatedDaily)),
    );
  }
  await env.DB.batch(stateStatements);

  if (writesUsed > 0) {
    invalidateSeriesScanCache();
    await markDbDirty(env);
  }

  return {
    skipped: false,
    scanned: candidates.length,
    matched: matchedCount,
    rulesApplied,
    cursor: nextCursor,
    writesUsed,
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
