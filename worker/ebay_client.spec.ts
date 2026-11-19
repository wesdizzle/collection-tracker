import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  EbayNotConfiguredError,
  EbayRateLimitError,
  fetchEbayBrowseRateLimits,
  getEdgeEbayToken,
  isEbayConfigured,
  resetEbayTokenCache,
  searchEbayListings,
} from './ebay_client';

describe('worker/ebay_client', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetEbayTokenCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('detects whether eBay credentials are configured', () => {
    expect(isEbayConfigured({})).toBe(false);
    expect(isEbayConfigured({ EBAY_CLIENT_ID: 'id-only' })).toBe(false);
    expect(
      isEbayConfigured({
        EBAY_CLIENT_ID: 'app-id',
        EBAY_CLIENT_SECRET: 'cert-id',
      }),
    ).toBe(true);
  });

  it('throws EbayNotConfiguredError when credentials are missing', async () => {
    await expect(getEdgeEbayToken({})).rejects.toBeInstanceOf(
      EbayNotConfiguredError,
    );
  });

  it('caches OAuth token in memory and refreshes when within 5 minutes of expiry', async () => {
    let callCount = 0;
    const fetchMock = vi.fn(async () => {
      callCount++;
      return new Response(
        JSON.stringify({
          access_token: `tok-${callCount}`,
          expires_in: callCount === 1 ? 7200 : 7200,
        }),
        { status: 200 },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const env = { EBAY_CLIENT_ID: 'cid', EBAY_CLIENT_SECRET: 'csec' };
    const t1 = await getEdgeEbayToken(env);
    const t2 = await getEdgeEbayToken(env);
    expect(t1).toBe('tok-1');
    expect(t2).toBe('tok-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const t3 = await getEdgeEbayToken(env, true);
    expect(t3).toBe('tok-2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('constructs properly URL-encoded Browse API requests and retries once on 401', async () => {
    let oauthCount = 0;
    let searchCount = 0;
    const capturedUrls: string[] = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/identity/v1/oauth2/token')) {
        oauthCount++;
        return new Response(
          JSON.stringify({
            access_token: `tok-${oauthCount}`,
            expires_in: 7200,
          }),
          { status: 200 },
        );
      }
      searchCount++;
      capturedUrls.push(url);
      if (searchCount === 1) {
        return new Response('Unauthorized', { status: 401 });
      }
      return new Response(
        JSON.stringify({
          itemSummaries: [
            {
              title: 'Chrono Trigger SNES',
              price: { value: '199.99', currency: 'USD' },
            },
          ],
        }),
        { status: 200 },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const env = { EBAY_CLIENT_ID: 'cid', EBAY_CLIENT_SECRET: 'csec' };
    const items = await searchEbayListings(env, {
      q: 'Chrono Trigger SNES',
      categoryId: '139973',
      limit: 50,
    });

    expect(oauthCount).toBe(2);
    expect(searchCount).toBe(2);
    expect(items).toHaveLength(1);
    expect(capturedUrls[0]).toContain('category_ids=139973');
    expect(capturedUrls[0]).toContain(
      'filter=buyingOptions%3A%7BFIXED_PRICE%7D%2Cconditions%3A%7BNEW%7CUSED%7D',
    );
    expect(capturedUrls[0]).not.toContain('sort=price');
  });

  it('throws EbayRateLimitError on HTTP 429', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/identity/v1/oauth2/token')) {
        return new Response(
          JSON.stringify({ access_token: 'tok-1', expires_in: 7200 }),
          { status: 200 },
        );
      }
      return new Response('Too many requests', {
        status: 429,
        headers: { 'Retry-After': '120' },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      searchEbayListings(
        { EBAY_CLIENT_ID: 'cid', EBAY_CLIENT_SECRET: 'csec' },
        { gtin: '045496590741', categoryId: '139973' },
      ),
    ).rejects.toMatchObject({
      status: 429,
      retryAfterSec: 120,
    } satisfies Partial<EbayRateLimitError>);
  });

  it('parses daily rate limits gracefully and returns null when unconfigured', async () => {
    expect(await fetchEbayBrowseRateLimits({})).toBeNull();

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/identity/v1/oauth2/token')) {
        return new Response(
          JSON.stringify({ access_token: 'tok-1', expires_in: 7200 }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          rateLimits: [
            {
              apiName: 'browse',
              resources: [
                {
                  name: 'buy.browse.item_summary.search',
                  rates: [
                    {
                      limit: 5000,
                      remaining: 4820,
                      count: 180,
                      reset: '2026-11-19T07:00:00.000Z',
                      timeWindow: 86400,
                    },
                  ],
                },
              ],
            },
          ],
        }),
        { status: 200 },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const snap = await fetchEbayBrowseRateLimits({
      EBAY_CLIENT_ID: 'cid',
      EBAY_CLIENT_SECRET: 'csec',
    });
    expect(snap).toEqual({
      limit: 5000,
      remaining: 4820,
      count: 180,
      reset: '2026-11-19T07:00:00.000Z',
      timeWindowSeconds: 86400,
    });
  });
});
