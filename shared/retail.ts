/**
 * RETAIL DEALS & STOCK CLIENT (VIDEOGAMESPLUS, PNP GAMES, BEST BUY)
 *
 * Integrates with:
 * 1. VideoGamesPlus / videogamesplus.ca Shopify JSON & Predictive Search API (CA - CAD converted to USD)
 * 2. PNP Games / pnpgamesonline.com WooCommerce Store API v1 (CA - CAD converted to USD)
 * 3. Official Best Buy Developer API (US - USD, optional when BESTBUY_API_KEY is configured)
 *
 * Covers both physical video games and toys-to-life / amiibo figures.
 * Designed to stay well within Cloudflare Workers Free Tier limits (~20-23 subrequests per run).
 */

export interface BestBuyProduct {
  sku: number | string;
  name: string;
  upc?: string;
  regularPrice: number;
  salePrice: number;
  onSale: boolean;
  percentSavings?: string | number;
  dollarSavings?: number;
  url: string;
  platform?: string;
  onlineAvailability?: boolean;
}

export interface BestBuyApiResponse {
  from: number;
  to: number;
  total: number;
  currentPage: number;
  totalPages: number;
  products: BestBuyProduct[];
}

export type RetailStoreName = 'Best Buy' | 'VGP' | 'PNP Games';

export interface RetailDealItem {
  store: RetailStoreName;
  sku: string;
  name: string;
  upc?: string;
  regularPrice: number; // USD dollars (e.g. 29.99)
  salePrice: number; // USD dollars (e.g. 9.99)
  onSale: boolean;
  percentSavings: number;
  url: string;
  platform?: string;
  onlineAvailability: boolean;
  categoryHint?: 'game' | 'toy';
}

export const DEFAULT_CAD_TO_USD_RATE = 0.73;

/**
 * Maps retailer platform strings to Collection Tracker platform IDs.
 */
export const BESTBUY_TO_TRACKER_PLATFORM: Record<string, number> = {
  'PlayStation 4': 34,
  PS4: 34,
  'SONY PLAYSTATION 4': 34,
  'PlayStation 5': 35,
  PS5: 35,
  'SONY PLAYSTATION 5': 35,
  'PlayStation 3': 32,
  PS3: 32,
  'PlayStation 2': 30,
  PS2: 30,
  PlayStation: 29,
  PS1: 29,
  PSX: 29,
  'PlayStation Vita': 33,
  'PS Vita': 33,
  PSV: 33,
  VITA: 33,
  'PlayStation Portable': 31,
  PSP: 31,
  'PlayStation VR': 51,
  PSVR: 51,
  'PlayStation VR2': 52,
  PSVR2: 52,
  'Nintendo Switch': 26,
  Switch: 26,
  NSW: 26,
  'Nintendo Switch 2': 27,
  'Switch 2': 27,
  NSW2: 27,
  'Nintendo 3DS': 23,
  '3DS': 23,
  N3DS: 23,
  'Nintendo DS': 21,
  DS: 21,
  NDS: 21,
  'Wii U': 24,
  'Nintendo Wii U': 24,
  Wii: 22,
  'Nintendo Wii': 22,
  'Nintendo GameCube': 20,
  GameCube: 20,
  'Xbox One': 49,
  XB1: 49,
  'XBOX ONE': 49,
  'Xbox Series X': 50,
  'Xbox Series S': 50,
  'Xbox Series X|S': 50,
  'Xbox Series X / Xbox One': 50,
  'XBOX SERIES X': 50,
  XSX: 50,
  'Xbox 360': 48,
  X360: 48,
  Xbox: 47,
  Dreamcast: 43,
  'Sega Dreamcast': 43,
};

const CASE_INSENSITIVE_PLATFORM_MAP = new Map<string, number>(
  Object.entries(BESTBUY_TO_TRACKER_PLATFORM).map(([k, v]) => [
    k.toLowerCase().trim(),
    v,
  ]),
);

/**
 * Decodes HTML entities commonly returned by WooCommerce / Shopify titles.
 */
export function decodeHtmlEntities(text: string): string {
  if (!text) return '';
  return text
    .replace(/&#8211;|&#x2013;|&ndash;/gi, '-')
    .replace(/&#8212;|&#x2014;|&mdash;/gi, '-')
    .replace(/&#8217;|&#x2019;|&rsquo;/gi, "'")
    .replace(/&#8216;|&#x2018;|&lsquo;/gi, "'")
    .replace(/&#038;|&#38;|&amp;/gi, '&')
    .replace(/&quot;|&#34;|&#8220;|&#8221;/gi, '"')
    .replace(/&#039;|&#39;/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

/**
 * Resolves a Collection Tracker platform ID from an explicit platform string or trailing title suffix.
 */
export function resolveRetailPlatformId(
  platformStr?: string | null,
  rawTitle?: string | null,
): number | undefined {
  if (platformStr) {
    const direct =
      BESTBUY_TO_TRACKER_PLATFORM[platformStr] ??
      CASE_INSENSITIVE_PLATFORM_MAP.get(platformStr.toLowerCase().trim());
    if (direct !== undefined) return direct;
  }

  if (rawTitle) {
    const decoded = decodeHtmlEntities(rawTitle).replace(/[\])\s]+$/, '');
    // Check trailing platform suffixes in title
    if (/\b(Nintendo\s*Switch\s*2|Switch\s*2|NSW2)\b\s*$/i.test(decoded)) {
      return 27;
    }
    if (/\b(Nintendo\s*Switch|Switch|NSW)\b\s*$/i.test(decoded)) {
      return 26;
    }
    if (/\b(PlayStation\s*VR2|PS\s*VR2|PSVR2)\b\s*$/i.test(decoded)) {
      return 52;
    }
    if (/\b(PlayStation\s*VR|PS\s*VR|PSVR)\b\s*$/i.test(decoded)) {
      return 51;
    }
    if (/\b(PlayStation\s*5|PS5)\b\s*$/i.test(decoded)) {
      return 35;
    }
    if (/\b(PlayStation\s*4|PS4)\b\s*$/i.test(decoded)) {
      return 34;
    }
    if (/\b(PlayStation\s*3|PS3)\b\s*$/i.test(decoded)) {
      return 32;
    }
    if (/\b(PlayStation\s*2|PS2)\b\s*$/i.test(decoded)) {
      return 30;
    }
    if (/\b(PlayStation\s*Vita|PS\s*Vita|Vita)\b\s*$/i.test(decoded)) {
      return 33;
    }
    if (/\b(PlayStation\s*Portable|PSP)\b\s*$/i.test(decoded)) {
      return 31;
    }
    if (/\b(Xbox\s*Series\s*[XS](\|[XS])?|XSX)\b\s*$/i.test(decoded)) {
      return 50;
    }
    if (/\b(Xbox\s*One|XB1)\b\s*$/i.test(decoded)) {
      return 49;
    }
    if (/\b(Xbox\s*360|X360)\b\s*$/i.test(decoded)) {
      return 48;
    }
    if (/\b(Nintendo\s*3DS|3DS|N3DS)\b\s*$/i.test(decoded)) {
      return 23;
    }
    if (/\b(Nintendo\s*DS|NDS|DS)\b\s*$/i.test(decoded)) {
      return 21;
    }
    if (/\b(Wii\s*U)\b\s*$/i.test(decoded)) {
      return 24;
    }
    if (/\b(Nintendo\s*Wii|Wii)\b\s*$/i.test(decoded)) {
      return 22;
    }
  }

  return undefined;
}

/**
 * Cleans a retailer product title by decoding HTML entities and removing trailing
 * platform suffixes, shipping tags, and edition noise.
 * e.g., "Marvel's Spider-Man: Miles Morales - PlayStation 4" -> "Marvel's Spider-Man: Miles Morales"
 */
export function cleanBestBuyTitle(rawTitle: string): string {
  if (!rawTitle) return '';
  let cleaned = decodeHtmlEntities(rawTitle);

  // Strip common VGP/PNP promotional suffixes and parentheticals
  cleaned = cleaned
    .replace(
      /\s*\((Free\s*Shipping|PRE-ORDER|Pre-Order|Import|JPN\s*Import[^)]*|Multi-Language[^)]*|English[^)]*|Bilingual|USA|CAN|ESRB|US\/ESRB|PEGI[^)]*|Standard\s*Edition)\)\s*/gi,
      ' ',
    )
    .replace(
      /\s*\[(Standard\s*Edition|Import|PEGI[^\]]*|US\/ESRB|Multi-Language[^\]]*|PRE-ORDER|ESRB)\]\s*/gi,
      ' ',
    );

  // Strip trailing platform names (including PNP's doubled "– PlayStation 5 PS5" or "– Nintendo Switch NSW")
  const platformPattern =
    '(?:PlayStation\\s*VR2|PSVR2|PlayStation\\s*VR|PSVR|PlayStation\\s*[12345]|PS[12345]|PlayStation\\s*Vita|PS\\s*Vita|Vita|PlayStation\\s*Portable|PSP|Nintendo\\s*Switch\\s*2?|Switch\\s*2?|NSW2?|Nintendo\\s*3DS|3DS|Nintendo\\s*DS|NDS|DS|Wii\\s*U|Nintendo\\s*Wii|Wii|Xbox\\s*Series\\s*[XS](?:\\|[XS])?|XSX|Xbox\\s*One|XB1|Xbox\\s*360|Sega\\s*Dreamcast|Dreamcast)';

  cleaned = cleaned
    .replace(
      new RegExp(
        `\\s*[-–—]\\s*${platformPattern}(?:\\s*[/|]?\\s*${platformPattern})*\\s*$`,
        'i',
      ),
      '',
    )
    .replace(new RegExp(`\\s*\\[${platformPattern}\\]\\s*$`, 'i'), '')
    .replace(new RegExp(`\\s*\\(${platformPattern}\\)\\s*$`, 'i'), '')
    .replace(/\s*Standard Edition\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned;
}

/**
 * Normalizes title for loose comparison.
 */
export function normalizeTitle(title: string): string {
  return decodeHtmlEntities(title)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Fetches live CAD to USD exchange rate from open.er-api.com (no API key required).
 * Gracefully falls back to DEFAULT_CAD_TO_USD_RATE (0.73) on failure.
 */
export async function fetchCadToUsdRate(
  fetchFn: typeof fetch = fetch,
): Promise<number> {
  try {
    const res = await fetchFn('https://open.er-api.com/v6/latest/CAD', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return DEFAULT_CAD_TO_USD_RATE;
    const data = (await res.json()) as { rates?: { USD?: number } };
    const rate = data?.rates?.USD;
    if (typeof rate === 'number' && rate > 0.4 && rate < 1.5) {
      return rate;
    }
  } catch {
    // Fallback to default CAD->USD conversion
  }
  return DEFAULT_CAD_TO_USD_RATE;
}

/**
 * Fetches active on-sale video games from Best Buy API.
 * Supports both Fetch API (Cloudflare Worker) and custom fetch functions.
 */
export async function fetchBestBuyDeals(
  apiKey: string,
  fetchFn: typeof fetch = fetch,
  maxPages = 4,
): Promise<BestBuyProduct[]> {
  if (!apiKey) {
    throw new Error('Best Buy API key is required');
  }

  const allProducts: BestBuyProduct[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= maxPages) {
    // Best Buy SQL-style query filter for Video Games category on sale
    const query = encodeURIComponent(
      'categoryPath.name="Video Games"&onSale=true',
    );
    const show =
      'sku,name,upc,regularPrice,salePrice,onSale,percentSavings,dollarSavings,url,platform,onlineAvailability';
    const url = `https://api.bestbuy.com/v1/products(${query})?apiKey=${encodeURIComponent(apiKey)}&pageSize=100&page=${page}&show=${show}&format=json`;

    const res = await fetchFn(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CollectionTracker/1.0',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      throw new Error(
        `Best Buy API request failed with status ${res.status}: ${res.statusText}`,
      );
    }

    const data = (await res.json()) as BestBuyApiResponse;
    if (data.products && Array.isArray(data.products)) {
      allProducts.push(...data.products);
    }

    totalPages = data.totalPages || 1;
    page++;
  }

  return allProducts;
}

interface VgpShopifyVariant {
  id: number;
  price: string;
  compare_at_price: string | null;
  available: boolean;
  sku?: string;
  barcode?: string | null;
}

interface VgpShopifyProduct {
  id: number;
  title: string;
  handle: string;
  product_type?: string;
  tags?: string[];
  variants?: VgpShopifyVariant[];
}

interface VgpSearchSuggestProduct {
  id?: number;
  title?: string;
  handle?: string;
  url?: string;
  available?: boolean;
  price?: string;
  compare_at_price_max?: string;
  compare_at_price_min?: string;
  product_type?: string;
}

function parseVgpProductToRetailItem(
  prod: VgpShopifyProduct,
  cadToUsdRate: number,
  forceOnSaleFlag?: boolean,
  categoryHint?: 'game' | 'toy',
): RetailDealItem | null {
  const availableVariants = (prod.variants || []).filter(
    (v) => v.available && parseFloat(v.price) > 0,
  );
  if (availableVariants.length === 0) return null;

  // Select lowest price available variant
  availableVariants.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
  const bestVar = availableVariants[0];

  const priceCad = parseFloat(bestVar.price);
  const compareCad = bestVar.compare_at_price
    ? parseFloat(bestVar.compare_at_price)
    : priceCad;

  const salePriceUsd = Number((priceCad * cadToUsdRate).toFixed(2));
  const regularPriceUsd = Number(
    (Math.max(compareCad, priceCad) * cadToUsdRate).toFixed(2),
  );
  const isDiscounted = regularPriceUsd > salePriceUsd;
  const discountPct = isDiscounted
    ? Math.round(((regularPriceUsd - salePriceUsd) / regularPriceUsd) * 100)
    : 0;

  return {
    store: 'VGP',
    sku: bestVar.sku || String(prod.id),
    name: prod.title,
    upc: bestVar.barcode || undefined,
    regularPrice: regularPriceUsd,
    salePrice: salePriceUsd,
    onSale: forceOnSaleFlag ?? isDiscounted,
    percentSavings: discountPct,
    url: `https://videogamesplus.ca/products/${prod.handle}`,
    platform: prod.product_type || undefined,
    onlineAvailability: true,
    categoryHint,
  };
}

/**
 * Fetches active in-stock video game deals from VideoGamesPlus (videogamesplus.ca)
 * via their public Shopify JSON endpoint (/collections/sales/products.json).
 * Converts CAD prices to USD using cadToUsdRate.
 */
export async function fetchVgpDeals(
  fetchFn: typeof fetch = fetch,
  maxPages = 6,
  cadToUsdRate = DEFAULT_CAD_TO_USD_RATE,
): Promise<RetailDealItem[]> {
  const deals: RetailDealItem[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const url = `https://videogamesplus.ca/collections/sales/products.json?limit=250&page=${page}`;
    const res = await fetchFn(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CollectionTracker/1.0',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      throw new Error(
        `VGP API request failed with status ${res.status}: ${res.statusText}`,
      );
    }

    const data = (await res.json()) as { products?: VgpShopifyProduct[] };
    const products = data.products || [];
    if (products.length === 0) break;

    for (const prod of products) {
      const item = parseVgpProductToRetailItem(prod, cadToUsdRate, true);
      if (item) {
        deals.push(item);
      }
    }

    if (products.length < 250) break;
  }

  return deals;
}

/**
 * Fetches in-stock amiibo & toys-to-life from VideoGamesPlus (videogamesplus.ca)
 * via their /collections/amiibo-collection/products.json endpoint and Shopify
 * predictive search (/search/suggest.json?q=amiibo).
 * Captures both on-sale and regular-price in-stock items in 2 subrequests.
 */
export async function fetchVgpAmiiboStock(
  fetchFn: typeof fetch = fetch,
  cadToUsdRate = DEFAULT_CAD_TO_USD_RATE,
): Promise<RetailDealItem[]> {
  const byUrl = new Map<string, RetailDealItem>();

  // 1. Primary amiibo-collection JSON feed
  try {
    const colUrl =
      'https://videogamesplus.ca/collections/amiibo-collection/products.json?limit=250&page=1';
    const res = await fetchFn(colUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CollectionTracker/1.0',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const data = (await res.json()) as { products?: VgpShopifyProduct[] };
      for (const prod of data.products || []) {
        const tagStr = Array.isArray(prod.tags) ? prod.tags.join(' ') : '';
        if (
          !/\b(amiibo|skylanders?|starlink)\b/i.test(
            `${prod.title} ${prod.handle} ${prod.product_type || ''} ${tagStr}`,
          )
        ) {
          continue;
        }
        const item = parseVgpProductToRetailItem(
          prod,
          cadToUsdRate,
          undefined,
          'toy',
        );
        if (item) {
          byUrl.set(item.url, item);
        }
      }
    }
  } catch {
    // Continue to predictive search fallback
  }

  // 2. Predictive search endpoint to capture wave-specific amiibo sub-collections
  try {
    const suggestUrl =
      'https://videogamesplus.ca/search/suggest.json?q=amiibo&resources[type]=product&resources[limit]=250&resources[options][unavailable_products]=hide';
    const res = await fetchFn(suggestUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CollectionTracker/1.0',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        resources?: { results?: { products?: VgpSearchSuggestProduct[] } };
      };
      const products = data?.resources?.results?.products || [];
      for (const prod of products) {
        if (prod.available === false || !prod.title) continue;
        const priceCad = parseFloat(prod.price || '0');
        if (isNaN(priceCad) || priceCad <= 0) continue;

        const compareCad = parseFloat(
          prod.compare_at_price_max || prod.compare_at_price_min || '0',
        );
        const salePriceUsd = Number((priceCad * cadToUsdRate).toFixed(2));
        const regularPriceUsd = Number(
          (Math.max(compareCad, priceCad) * cadToUsdRate).toFixed(2),
        );
        const isDiscounted = regularPriceUsd > salePriceUsd;
        const discountPct = isDiscounted
          ? Math.round(
              ((regularPriceUsd - salePriceUsd) / regularPriceUsd) * 100,
            )
          : 0;

        const rawPath = prod.url
          ? prod.url.split('?')[0]
          : prod.handle
            ? `/products/${prod.handle}`
            : '';
        if (!rawPath) continue;
        const cleanUrl = rawPath.startsWith('http')
          ? rawPath
          : `https://videogamesplus.ca${rawPath}`;

        if (!byUrl.has(cleanUrl)) {
          byUrl.set(cleanUrl, {
            store: 'VGP',
            sku: String(prod.id || cleanUrl),
            name: prod.title,
            regularPrice: regularPriceUsd,
            salePrice: salePriceUsd,
            onSale: isDiscounted,
            percentSavings: discountPct,
            url: cleanUrl,
            platform: prod.product_type || undefined,
            onlineAvailability: true,
            categoryHint: 'toy',
          });
        }
      }
    }
  } catch {
    // Non-fatal if suggest endpoint fails
  }

  return Array.from(byUrl.values());
}

interface PnpWooProduct {
  id: number;
  name: string;
  slug: string;
  permalink: string;
  sku?: string;
  on_sale: boolean;
  is_in_stock: boolean;
  prices?: {
    price: string;
    regular_price: string;
    sale_price: string;
    currency_code: string;
    currency_minor_unit?: number;
  };
  attributes?: Array<{
    name: string;
    taxonomy: string;
    terms?: Array<{ name: string; slug: string }>;
  }>;
}

function parsePnpProductToRetailItem(
  prod: PnpWooProduct,
  cadToUsdRate: number,
  forceOnSaleFlag?: boolean,
  categoryHint?: 'game' | 'toy',
): RetailDealItem | null {
  if (!prod.is_in_stock || !prod.prices) return null;

  const minorUnit = prod.prices.currency_minor_unit ?? 2;
  const divisor = Math.pow(10, minorUnit);
  const priceCad = parseFloat(prod.prices.price) / divisor;
  const regularCad =
    parseFloat(prod.prices.regular_price || prod.prices.price) / divisor;

  if (isNaN(priceCad) || priceCad <= 0) return null;

  const salePriceUsd = Number((priceCad * cadToUsdRate).toFixed(2));
  const regularPriceUsd = Number(
    (Math.max(regularCad, priceCad) * cadToUsdRate).toFixed(2),
  );
  const isDiscounted = regularPriceUsd > salePriceUsd;
  const discountPct = isDiscounted
    ? Math.round(((regularPriceUsd - salePriceUsd) / regularPriceUsd) * 100)
    : 0;

  // Extract platform attribute if available
  const platAttr = (prod.attributes || []).find(
    (a) => a.taxonomy === 'pa_platform' || a.name?.toLowerCase() === 'platform',
  );
  const platName = platAttr?.terms?.[0]?.name;

  return {
    store: 'PNP Games',
    sku: prod.sku || String(prod.id),
    name: decodeHtmlEntities(prod.name),
    regularPrice: regularPriceUsd,
    salePrice: salePriceUsd,
    onSale: forceOnSaleFlag ?? Boolean(prod.on_sale || isDiscounted),
    percentSavings: discountPct,
    url: prod.permalink,
    platform: platName || undefined,
    onlineAvailability: true,
    categoryHint,
  };
}

/**
 * Fetches active in-stock new video game deals from PNP Games (pnpgamesonline.com)
 * via their public WooCommerce Store API v1.
 * Category 38368 = "ALL NEW SOFTWARE".
 * Converts CAD prices to USD using cadToUsdRate.
 */
export async function fetchPnpDeals(
  fetchFn: typeof fetch = fetch,
  maxPages = 8,
  cadToUsdRate = DEFAULT_CAD_TO_USD_RATE,
): Promise<RetailDealItem[]> {
  const deals: RetailDealItem[] = [];
  let totalPages = maxPages;

  for (let page = 1; page <= totalPages && page <= maxPages; page++) {
    const url = `https://pnpgamesonline.com/wp-json/wc/store/v1/products?on_sale=true&stock_status=instock&category=38368&per_page=100&page=${page}`;
    const res = await fetchFn(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CollectionTracker/1.0',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      throw new Error(
        `PNP Games API request failed with status ${res.status}: ${res.statusText}`,
      );
    }

    const headerTotalPages = res.headers?.get?.('x-wp-totalpages');
    if (headerTotalPages) {
      const parsedPages = parseInt(headerTotalPages, 10);
      if (!isNaN(parsedPages) && parsedPages > 0) {
        totalPages = Math.min(maxPages, parsedPages);
      }
    }

    const products = (await res.json()) as PnpWooProduct[];
    if (!Array.isArray(products) || products.length === 0) break;

    for (const prod of products) {
      const item = parsePnpProductToRetailItem(prod, cadToUsdRate, true);
      if (item) {
        deals.push(item);
      }
    }

    if (products.length < 100) break;
  }

  return deals;
}

/**
 * Fetches active in-stock NEW amiibo from PNP Games (pnpgamesonline.com)
 * via their public WooCommerce Store API v1.
 * Category 6779 = "NEW - AMIIBO".
 * Captures both on-sale and regular-price in-stock items.
 */
export async function fetchPnpAmiiboStock(
  fetchFn: typeof fetch = fetch,
  maxPages = 2,
  cadToUsdRate = DEFAULT_CAD_TO_USD_RATE,
): Promise<RetailDealItem[]> {
  const items: RetailDealItem[] = [];
  let totalPages = maxPages;

  for (let page = 1; page <= totalPages && page <= maxPages; page++) {
    const url = `https://pnpgamesonline.com/wp-json/wc/store/v1/products?stock_status=instock&category=6779&per_page=100&page=${page}`;
    const res = await fetchFn(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CollectionTracker/1.0',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      throw new Error(
        `PNP Games Amiibo API request failed with status ${res.status}: ${res.statusText}`,
      );
    }

    const headerTotalPages = res.headers?.get?.('x-wp-totalpages');
    if (headerTotalPages) {
      const parsedPages = parseInt(headerTotalPages, 10);
      if (!isNaN(parsedPages) && parsedPages > 0) {
        totalPages = Math.min(maxPages, parsedPages);
      }
    }

    const products = (await res.json()) as PnpWooProduct[];
    if (!Array.isArray(products) || products.length === 0) break;

    for (const prod of products) {
      if (
        !/\b(amiibo|skylanders?|starlink)\b/i.test(
          `${prod.name || ''} ${prod.slug || ''}`,
        )
      ) {
        continue;
      }
      const item = parsePnpProductToRetailItem(
        prod,
        cadToUsdRate,
        undefined,
        'toy',
      );
      if (item) {
        items.push(item);
      }
    }

    if (products.length < 100) break;
  }

  return items;
}

/**
 * Aggregates active deals & toy stock across VGP, PNP Games, and (if configured) Best Buy.
 * Designed to execute in ~19-23 total subrequests (well within Cloudflare Worker's 50-subrequest free limit).
 */
export async function fetchAllRetailDeals(
  options: {
    bestBuyApiKey?: string;
    fetchFn?: typeof fetch;
    maxVgpPages?: number;
    maxPnpPages?: number;
    maxBestBuyPages?: number;
    includeToys?: boolean;
  } = {},
): Promise<{
  deals: RetailDealItem[];
  sources: { vgp: number; pnp: number; bestbuy: number };
  cadToUsdRate: number;
}> {
  const fetchFn = options.fetchFn || fetch;
  const includeToys = options.includeToys ?? true;
  const cadToUsdRate = await fetchCadToUsdRate(fetchFn);

  const [vgpDeals, vgpAmiibo, pnpDeals, pnpAmiibo, bestBuyProducts] =
    await Promise.all([
      fetchVgpDeals(fetchFn, options.maxVgpPages ?? 6, cadToUsdRate).catch(
        (err) => {
          console.warn('[RetailSync] VGP fetch warning:', err);
          return [] as RetailDealItem[];
        },
      ),
      includeToys
        ? fetchVgpAmiiboStock(fetchFn, cadToUsdRate).catch((err) => {
            console.warn('[RetailSync] VGP Amiibo fetch warning:', err);
            return [] as RetailDealItem[];
          })
        : Promise.resolve([] as RetailDealItem[]),
      fetchPnpDeals(fetchFn, options.maxPnpPages ?? 8, cadToUsdRate).catch(
        (err) => {
          console.warn('[RetailSync] PNP Games fetch warning:', err);
          return [] as RetailDealItem[];
        },
      ),
      includeToys
        ? fetchPnpAmiiboStock(fetchFn, 2, cadToUsdRate).catch((err) => {
            console.warn('[RetailSync] PNP Games Amiibo fetch warning:', err);
            return [] as RetailDealItem[];
          })
        : Promise.resolve([] as RetailDealItem[]),
      options.bestBuyApiKey
        ? fetchBestBuyDeals(
            options.bestBuyApiKey,
            fetchFn,
            options.maxBestBuyPages ?? 4,
          ).catch((err) => {
            console.warn('[RetailSync] Best Buy fetch warning:', err);
            return [] as BestBuyProduct[];
          })
        : Promise.resolve([] as BestBuyProduct[]),
    ]);

  const bestBuyDeals: RetailDealItem[] = bestBuyProducts.map((p) => ({
    store: 'Best Buy',
    sku: String(p.sku),
    name: p.name,
    upc: p.upc,
    regularPrice: p.regularPrice,
    salePrice: p.salePrice,
    onSale: p.onSale,
    percentSavings: Math.round(Number(p.percentSavings) || 0),
    url: p.url,
    platform: p.platform,
    onlineAvailability: p.onlineAvailability ?? true,
  }));

  // Merge and deduplicate VGP and PNP items by URL so on-sale items from sales feeds
  // are not duplicated by the dedicated amiibo feeds
  const mergeByUrl = (
    primary: RetailDealItem[],
    secondary: RetailDealItem[],
  ): RetailDealItem[] => {
    const byKey = new Map<string, RetailDealItem>();
    for (const item of primary) {
      byKey.set(item.url || `${item.store}:${item.sku}`, item);
    }
    for (const item of secondary) {
      const key = item.url || `${item.store}:${item.sku}`;
      if (!byKey.has(key)) {
        byKey.set(key, item);
      }
    }
    return Array.from(byKey.values());
  };

  const mergedVgp = mergeByUrl(vgpDeals, vgpAmiibo);
  const mergedPnp = mergeByUrl(pnpDeals, pnpAmiibo);

  return {
    deals: [...bestBuyDeals, ...mergedVgp, ...mergedPnp],
    sources: {
      vgp: mergedVgp.length,
      pnp: mergedPnp.length,
      bestbuy: bestBuyDeals.length,
    },
    cadToUsdRate,
  };
}

export interface CandidateGame {
  stable_id: number;
  title: string;
  platform_id: number;
  barcode?: string | null;
}

export interface CandidateToy {
  id: string;
  name: string;
  line?: string | null;
  series?: string | null;
  type?: string | null;
  region?: string | null;
}

const STANDALONE_TOY_PRODUCT_REGEX =
  /\b(amiibo|skylanders?\s+(?:trap|creation\s+crystal|sensei|superchargers?\s+vehicle|giants?\s+figure|swap\s+force\s+figure)|starlink\s*:?\s*(?:battle\s+for\s+atlas\s*)?(?:weapon|starship|ship|pilot)\s+pack)\b/i;

const GAME_WITH_TOY_BUNDLE_REGEX =
  /\b(starter\s+pack|game\s*(?:&|and|\+)\s*amiibo|bundle|collector'?s\s+edition|limited\s+edition)\b/i;

const TOY_ACCESSORY_EXCLUSION_REGEX =
  /\b(carrying\s+case|storage\s+case|display\s+case|clear\s+box|protector|pouch|travel\s+bag|nfc\s+reader|binder|album|diorama\s+kit)\b/i;

/**
 * Returns true if the product title or categoryHint indicates a standalone toy/amiibo figure
 * rather than a video game.
 */
export function isStandaloneToyListing(
  product: BestBuyProduct | RetailDealItem,
): boolean {
  if ('categoryHint' in product && product.categoryHint === 'toy') {
    return !GAME_WITH_TOY_BUNDLE_REGEX.test(product.name);
  }
  const decoded = decodeHtmlEntities(product.name || '');
  if (
    STANDALONE_TOY_PRODUCT_REGEX.test(decoded) &&
    !GAME_WITH_TOY_BUNDLE_REGEX.test(decoded)
  ) {
    return true;
  }
  if (product.platform && /\bamiibo\b/i.test(product.platform)) {
    return !GAME_WITH_TOY_BUNDLE_REGEX.test(decoded);
  }
  return false;
}

/**
 * Matches a retail product (Best Buy, VGP, or PNP Games) to a candidate game from the database.
 * First tries exact barcode/UPC match, then falls back to normalized title + platform match.
 */
export function matchRetailGameProduct(
  product: BestBuyProduct | RetailDealItem,
  candidates: CandidateGame[],
): number | null {
  // Guard against matching standalone amiibo/toys to games with the same title
  if (isStandaloneToyListing(product)) {
    return null;
  }

  // 1. UPC / Barcode match
  if (product.upc) {
    const cleanUpc = product.upc.trim();
    if (cleanUpc.length >= 8) {
      const barcodeMatch = candidates.find(
        (c) => c.barcode && c.barcode.trim() === cleanUpc,
      );
      if (barcodeMatch) {
        return barcodeMatch.stable_id;
      }
    }
  }

  // 2. Title + Platform match
  const platformId = resolveRetailPlatformId(product.platform, product.name);

  const cleanedProductTitle = cleanBestBuyTitle(product.name);
  const normProductTitle = normalizeTitle(cleanedProductTitle);

  if (!normProductTitle) return null;

  for (const candidate of candidates) {
    // If platform is resolved, require platform match
    if (platformId !== undefined && candidate.platform_id !== platformId) {
      continue;
    }

    const normCandidateTitle = normalizeTitle(candidate.title);
    if (normProductTitle === normCandidateTitle) {
      return candidate.stable_id;
    }
  }

  return null;
}

/**
 * Backwards-compatible alias for matchRetailGameProduct.
 */
export const matchBestBuyProduct = matchRetailGameProduct;

/**
 * Extracts normalized character/figure name, optional series hint, and whether the listing
 * is an amiibo card pack from a raw retailer toy title.
 */
export function parseRetailToyTitle(rawTitle: string): {
  cleanName: string;
  seriesHint: string | null;
  isCard: boolean;
} {
  const decoded = decodeHtmlEntities(rawTitle || '').trim();
  const isCard =
    /\b(amiibo\s+cards?|cards?\s+pack|booster\s+pack|series\s+\d+\s+cards?)\b/i.test(
      decoded,
    );

  let working = decoded;
  let seriesHint: string | null = null;

  // 1. Extract bracketed or parenthesized "[... Series]" / "(... Series)"
  const bracketSeriesMatch = working.match(
    /[([]\s*([^\]()]+?)\s+Series\s*[\])]/i,
  );
  if (bracketSeriesMatch) {
    seriesHint = bracketSeriesMatch[1].trim();
    working = working.replace(bracketSeriesMatch[0], ' ');
  }

  // 2. Strip common retailer region/import/condition parentheticals and tags
  working = working
    .replace(
      /\s*[([]\s*(?:JPIM|JPN\s*Import[^\]()]*|Japan\s*Import[^\]()]*|Import|Reprint|Restock|PRE-ORDER|Pre-Order|Free\s*Shipping|USA|CAN|EUR|UK|AUS|Multi-Language[^\]()]*|Nintendo\s*Switch(?:\s*2)?|Switch(?:\s*2)?|NSW2?|3DS|Wii\s*U)[\])]\s*/gi,
      ' ',
    )
    .replace(/\bNintendo\s+Amiibo\b\s*[-–—:]?\s*/gi, ' ')
    .replace(
      /\s*[-–—]\s*(?:Nintendo\s*Switch\s*2?|Switch\s*2?|NSW2?|Wii\s*U|Nintendo\s*3DS|3DS)(?:\s*[/|]\s*(?:Nintendo\s*Switch\s*2?|Switch\s*2?|NSW2?))*\s*$/i,
      '',
    );

  // 3. Handle PNP / VGP hyphenated segments:
  //    e.g., "Metroid - Metroid Series - amiibo"
  //    or "Minerus Construct - The Legend of Zelda"
  //    or "Samus - Metroid Dread - amiibo"
  const segments = working
    .split(/\s+[-–—]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const filteredSegments: string[] = [];
  for (const seg of segments) {
    if (/^(?:nintendo\s+)?amiibo(?:\s+figure)?$/i.test(seg)) {
      continue;
    }
    const segSeriesMatch = seg.match(/^(.+?)\s+Series$/i);
    if (segSeriesMatch) {
      if (!seriesHint) {
        seriesHint = segSeriesMatch[1].trim();
      }
      continue;
    }
    filteredSegments.push(seg);
  }

  if (filteredSegments.length >= 2 && !seriesHint) {
    // Check if the last segment is a known game/franchise series name (e.g. "The Legend of Zelda", "Super Smash Bros.", "Street Fighter 6", "Kirby Air Riders")
    const lastSeg = filteredSegments[filteredSegments.length - 1];
    if (
      /\b(zelda|smash\s*bros|super\s*mario|metroid|splatoon|animal\s*crossing|fire\s*emblem|kirby|monster\s*hunter|street\s*fighter|xenoblade|pikmin|mega\s*man|shulk|donkey\s*kong|resident\s*evil|dragon\s*quest|persona|banjo|bayonetta|castlevania|final\s*fantasy|kingdom\s*hearts|arms|pok[eé]mon|chibi[- ]?robo|dark\s*souls|diablo|shovel\s*knight)\b/i.test(
        lastSeg,
      )
    ) {
      seriesHint = lastSeg;
      filteredSegments.pop();
    }
  }

  let cleanName = filteredSegments.join(' - ');
  cleanName = cleanName
    .replace(/\b(?:nintendo\s+)?amiibo(?:\s+figure)?\b/gi, ' ')
    .replace(/\b\d+-pack\b/gi, ' ')
    .replace(/\bfigure\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[-–—:\s]+|[-–—:\s]+$/g, '')
    .trim();

  return {
    cleanName,
    seriesHint,
    isCard,
  };
}

function seriesMatchesHint(
  candidateSeries: string | null | undefined,
  seriesHint: string | null,
): boolean {
  if (!candidateSeries || !seriesHint) return false;
  const normCand = normalizeTitle(
    candidateSeries.replace(/^the\s+/i, '').replace(/\bbros\.?\b/i, 'bros'),
  );
  const normHint = normalizeTitle(
    seriesHint.replace(/^the\s+/i, '').replace(/\bbros\.?\b/i, 'bros'),
  );
  if (!normCand || !normHint) return false;
  return (
    normCand === normHint ||
    normCand.includes(normHint) ||
    normHint.includes(normCand)
  );
}

/**
 * Matches a retail product listing to a candidate toy from the database.
 * Returns the matched toy's `id` (slug) or null if no confident match is found.
 */
export function matchRetailToyProduct(
  product: BestBuyProduct | RetailDealItem,
  candidates: CandidateToy[],
): string | null {
  const rawName = decodeHtmlEntities(product.name || '');
  if (!rawName) return null;

  // Reject cases, protectors, pouches, and used/pre-owned items
  if (TOY_ACCESSORY_EXCLUSION_REGEX.test(rawName)) {
    return null;
  }
  if (/\b(used|pre-owned|preowned|loose)\b/i.test(rawName)) {
    return null;
  }

  // Require toy indicator in title, platform, or categoryHint
  const hasToyHint =
    ('categoryHint' in product && product.categoryHint === 'toy') ||
    /\b(amiibo|skylanders?|starlink)\b/i.test(rawName) ||
    Boolean(product.platform && /\bamiibo\b/i.test(product.platform));
  if (!hasToyHint) {
    return null;
  }

  // Reject game starter packs / bundles that belong in the games table
  if (GAME_WITH_TOY_BUNDLE_REGEX.test(rawName)) {
    return null;
  }

  const { cleanName, seriesHint, isCard } = parseRetailToyTitle(rawName);
  const normProduct = normalizeTitle(cleanName);
  if (!normProduct) return null;

  // Also build a combined norm with seriesHint in case the candidate toy's name includes the qualifier
  // (e.g. "Link - Tears of the Kingdom" or "Isabelle - Winter Outfit")
  const normProductWithSeries = seriesHint
    ? normalizeTitle(`${cleanName} ${seriesHint}`)
    : null;

  const exactMatches: CandidateToy[] = [];
  const qualifiedMatches: CandidateToy[] = [];

  for (const candidate of candidates) {
    const candIsCard =
      candidate.type?.toLowerCase() === 'card' ||
      /\bcard\b/i.test(candidate.name);
    if (isCard !== candIsCard) {
      continue;
    }

    const normCandidate = normalizeTitle(candidate.name);
    if (!normCandidate) continue;

    if (normCandidate === normProduct) {
      exactMatches.push(candidate);
    } else if (
      normProductWithSeries &&
      normCandidate === normProductWithSeries
    ) {
      qualifiedMatches.push(candidate);
    } else {
      // Handle parenthetical costume/variant in product name vs hyphenated candidate name
      // e.g. "Link (Twilight Princess)" -> cleanName "Link (Twilight Princess)" -> norm "linktwilightprincess"
      // which already equals normalizeTitle("Link - Twilight Princess")!
      // Also check when candidate has series suffix in parentheses or after hyphen
      const normCandPlusSeries = candidate.series
        ? normalizeTitle(`${candidate.name} ${candidate.series}`)
        : '';
      if (
        normProductWithSeries &&
        normCandPlusSeries &&
        normProductWithSeries === normCandPlusSeries
      ) {
        qualifiedMatches.push(candidate);
      }
    }
  }

  if (qualifiedMatches.length === 1) {
    return qualifiedMatches[0].id;
  }
  if (qualifiedMatches.length > 1 && seriesHint) {
    const bySeries = qualifiedMatches.find((c) =>
      seriesMatchesHint(c.series, seriesHint),
    );
    if (bySeries) return bySeries.id;
  }

  if (exactMatches.length === 1) {
    // If there is only 1 candidate with this name in the catalog, return it
    // (unless seriesHint explicitly conflicts with a different franchise, e.g. a brand-new wave not in DB)
    return exactMatches[0].id;
  }

  if (exactMatches.length > 1) {
    if (seriesHint) {
      const bySeries = exactMatches.find((c) =>
        seriesMatchesHint(c.series, seriesHint),
      );
      if (bySeries) return bySeries.id;
    }
    return exactMatches[0].id;
  }

  return null;
}
