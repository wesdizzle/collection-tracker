/**
 * EBAY BROWSE & DEVELOPER ANALYTICS API CLIENT
 *
 * Uses OAuth 2.0 Client Credentials with isolate-memory token caching
 * (zero D1 persistence) and enforces eBay Browse API rate-limit and timeout guards.
 */

import { EbayItemSummary } from '../shared/market_pricing';

export interface EbayConfigEnv {
  EBAY_CLIENT_ID?: string;
  EBAY_CLIENT_SECRET?: string;
}

export interface EbayRateLimitSnapshot {
  limit: number;
  remaining: number;
  count: number;
  reset: string | null;
  timeWindowSeconds: number;
}

export class EbayNotConfiguredError extends Error {
  public readonly code = 'ebay_not_configured';
  constructor(
    message = 'eBay Browse API credentials (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET) are not configured.',
  ) {
    super(message);
    this.name = 'EbayNotConfiguredError';
  }
}

export class EbayRateLimitError extends Error {
  public readonly status = 429;
  public readonly retryAfterSec: number;

  constructor(message = 'eBay API rate limit exceeded', retryAfterSec = 60) {
    super(message);
    this.name = 'EbayRateLimitError';
    this.retryAfterSec = retryAfterSec;
  }
}

export class EbayApiError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'EbayApiError';
    this.status = status;
  }
}

let cachedEbayToken: { token: string; expiresAt: number } | null = null;
let inFlightEbayTokenPromise: Promise<string> | null = null;

export function resetEbayTokenCache(): void {
  cachedEbayToken = null;
  inFlightEbayTokenPromise = null;
}

export function isEbayConfigured(env: EbayConfigEnv): boolean {
  return Boolean(env.EBAY_CLIENT_ID?.trim() && env.EBAY_CLIENT_SECRET?.trim());
}

function encodeBasicAuth(clientId: string, clientSecret: string): string {
  return btoa(`${clientId}:${clientSecret}`);
}

export async function getEdgeEbayToken(
  env: EbayConfigEnv,
  forceRefresh = false,
): Promise<string> {
  const now = Date.now();
  if (!forceRefresh && cachedEbayToken && cachedEbayToken.expiresAt > now) {
    return cachedEbayToken.token;
  }

  if (!forceRefresh && inFlightEbayTokenPromise) {
    return inFlightEbayTokenPromise;
  }

  const clientId = env.EBAY_CLIENT_ID?.trim();
  const clientSecret = env.EBAY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new EbayNotConfiguredError();
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'https://api.ebay.com/oauth/api_scope',
  });

  const tokenFetchPromise = (async (): Promise<string> => {
    const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${encodeBasicAuth(clientId, clientSecret)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(8000),
    });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') || '60', 10);
      throw new EbayRateLimitError(
        'eBay OAuth rate limit exceeded.',
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60,
      );
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new EbayApiError(
        res.status,
        `eBay OAuth failed (${res.status}): ${errText}`,
      );
    }

    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!data?.access_token) {
      throw new EbayApiError(502, 'eBay OAuth response omitted access_token.');
    }

    const expiresInSec = Math.max(60, Number(data.expires_in) || 7200);
    // Refresh 5 minutes before expiry (or half TTL if very short)
    const bufferSec = Math.min(300, Math.floor(expiresInSec / 2));
    cachedEbayToken = {
      token: data.access_token,
      expiresAt: Date.now() + (expiresInSec - bufferSec) * 1000,
    };

    return data.access_token;
  })().finally(() => {
    if (inFlightEbayTokenPromise === tokenFetchPromise) {
      inFlightEbayTokenPromise = null;
    }
  });

  inFlightEbayTokenPromise = tokenFetchPromise;
  return tokenFetchPromise;
}

export interface SearchEbayListingsParams {
  q?: string;
  gtin?: string;
  categoryId: string;
  limit?: number;
}

export async function searchEbayListings(
  env: EbayConfigEnv,
  params: SearchEbayListingsParams,
): Promise<EbayItemSummary[]> {
  const searchParams = new URLSearchParams();
  if (params.gtin) {
    searchParams.set('gtin', params.gtin);
  } else if (params.q) {
    searchParams.set('q', params.q);
  } else {
    throw new Error('searchEbayListings requires either q or gtin.');
  }

  searchParams.set('category_ids', params.categoryId);
  searchParams.set(
    'filter',
    'buyingOptions:{FIXED_PRICE},conditions:{NEW|USED}',
  );
  searchParams.set(
    'limit',
    String(Math.min(100, Math.max(1, params.limit ?? 50))),
  );

  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?${searchParams.toString()}`;

  const fetchOnce = async (token: string): Promise<Response> =>
    fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

  const isTransientHttpStatus = (status: number): boolean =>
    status === 500 || status === 502 || status === 503 || status === 504;

  const executeCall = async (token: string): Promise<Response> => {
    try {
      const first = await fetchOnce(token);
      if (!isTransientHttpStatus(first.status)) {
        return first;
      }
      await new Promise((r) => setTimeout(r, 250));
      return await fetchOnce(token);
    } catch (err) {
      if (err instanceof EbayNotConfiguredError) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 250));
      return await fetchOnce(token);
    }
  };

  let token = await getEdgeEbayToken(env);
  let res = await executeCall(token);

  if (res.status === 401) {
    resetEbayTokenCache();
    token = await getEdgeEbayToken(env, true);
    res = await executeCall(token);
  }

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') || '60', 10);
    throw new EbayRateLimitError(
      'eBay Browse API rate limit exceeded.',
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60,
    );
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new EbayApiError(
      res.status,
      `eBay Browse API Error (${res.status}): ${errText}`,
    );
  }

  const payload = (await res.json()) as {
    itemSummaries?: EbayItemSummary[];
  };
  return Array.isArray(payload?.itemSummaries) ? payload.itemSummaries : [];
}

export async function fetchEbayBrowseRateLimits(
  env: EbayConfigEnv,
): Promise<EbayRateLimitSnapshot | null> {
  if (!isEbayConfigured(env)) return null;
  try {
    const token = await getEdgeEbayToken(env);
    const res = await fetch(
      'https://api.ebay.com/developer/analytics/v1_beta/rate_limit/?api_name=browse&api_context=buy',
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(6000),
      },
    );
    if (!res.ok) return null;

    const data = (await res.json()) as {
      rateLimits?: Array<{
        apiName?: string;
        resources?: Array<{
          name?: string;
          rates?: Array<{
            limit?: number;
            remaining?: number;
            count?: number;
            reset?: string;
            timeWindow?: number;
          }>;
        }>;
      }>;
    };

    const browseLimit = data?.rateLimits?.find(
      (r) => r.apiName?.toLowerCase() === 'browse',
    );
    const summaryRes =
      browseLimit?.resources?.find((r) => r.name?.includes('item_summary')) ||
      browseLimit?.resources?.[0];
    const dailyRate =
      summaryRes?.rates?.find((r) => (r.timeWindow ?? 0) >= 86400) ||
      summaryRes?.rates?.[0];
    if (!dailyRate || typeof dailyRate.limit !== 'number') {
      return null;
    }

    return {
      limit: dailyRate.limit,
      remaining:
        typeof dailyRate.remaining === 'number'
          ? dailyRate.remaining
          : Math.max(0, dailyRate.limit - (dailyRate.count ?? 0)),
      count: typeof dailyRate.count === 'number' ? dailyRate.count : 0,
      reset: dailyRate.reset ?? null,
      timeWindowSeconds: dailyRate.timeWindow ?? 86400,
    };
  } catch {
    return null;
  }
}
