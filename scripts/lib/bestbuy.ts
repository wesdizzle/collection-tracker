/**
 * RETAIL DEALS & PRICING CLIENT (BEST BUY, VIDEOGAMESPLUS, PNP GAMES)
 *
 * Integrates with:
 * 1. Official Best Buy Developer API (US - USD)
 * 2. VideoGamesPlus / videogamesplus.ca Shopify JSON API (CA - CAD converted to USD)
 * 3. PNP Games / pnpgamesonline.com WooCommerce Store API v1 (CA - CAD converted to USD)
 *
 * Designed to stay well within Cloudflare Workers Free Tier limits (~15-20 subrequests per run).
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
}

export const DEFAULT_CAD_TO_USD_RATE = 0.73;

/**
 * Maps retailer platform strings to Gagglog platform IDs.
 */
export const BESTBUY_TO_GAGGLOG_PLATFORM: Record<string, number> = {
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
  Object.entries(BESTBUY_TO_GAGGLOG_PLATFORM).map(([k, v]) => [
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
 * Resolves a Gagglog platform ID from an explicit platform string or trailing title suffix.
 */
export function resolveRetailPlatformId(
  platformStr?: string | null,
  rawTitle?: string | null,
): number | undefined {
  if (platformStr) {
    const direct =
      BESTBUY_TO_GAGGLOG_PLATFORM[platformStr] ??
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
        'User-Agent': 'GagglogCollectionTracker/1.0',
      },
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
        'User-Agent': 'GagglogCollectionTracker/1.0',
      },
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
      const availableVariants = (prod.variants || []).filter(
        (v) => v.available && parseFloat(v.price) > 0,
      );
      if (availableVariants.length === 0) continue;

      // Select lowest price available variant
      availableVariants.sort(
        (a, b) => parseFloat(a.price) - parseFloat(b.price),
      );
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

      deals.push({
        store: 'VGP',
        sku: bestVar.sku || String(prod.id),
        name: prod.title,
        upc: bestVar.barcode || undefined,
        regularPrice: regularPriceUsd,
        salePrice: salePriceUsd,
        onSale: true,
        percentSavings: discountPct,
        url: `https://videogamesplus.ca/products/${prod.handle}`,
        platform: prod.product_type || undefined,
        onlineAvailability: true,
      });
    }

    if (products.length < 250) break;
  }

  return deals;
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
        'User-Agent': 'GagglogCollectionTracker/1.0',
      },
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
      if (!prod.is_in_stock || !prod.prices) continue;

      const minorUnit = prod.prices.currency_minor_unit ?? 2;
      const divisor = Math.pow(10, minorUnit);
      const priceCad = parseFloat(prod.prices.price) / divisor;
      const regularCad =
        parseFloat(prod.prices.regular_price || prod.prices.price) / divisor;

      if (isNaN(priceCad) || priceCad <= 0) continue;

      const salePriceUsd = Number((priceCad * cadToUsdRate).toFixed(2));
      const regularPriceUsd = Number(
        (Math.max(regularCad, priceCad) * cadToUsdRate).toFixed(2),
      );
      const discountPct =
        regularPriceUsd > salePriceUsd
          ? Math.round(
              ((regularPriceUsd - salePriceUsd) / regularPriceUsd) * 100,
            )
          : 0;

      // Extract platform attribute if available
      const platAttr = (prod.attributes || []).find(
        (a) =>
          a.taxonomy === 'pa_platform' || a.name?.toLowerCase() === 'platform',
      );
      const platName = platAttr?.terms?.[0]?.name;

      deals.push({
        store: 'PNP Games',
        sku: prod.sku || String(prod.id),
        name: decodeHtmlEntities(prod.name),
        regularPrice: regularPriceUsd,
        salePrice: salePriceUsd,
        onSale: true,
        percentSavings: discountPct,
        url: prod.permalink,
        platform: platName || undefined,
        onlineAvailability: true,
      });
    }

    if (products.length < 100) break;
  }

  return deals;
}

/**
 * Aggregates active deals across VGP, PNP Games, and (if configured) Best Buy.
 * Designed to execute in ~15-19 total subrequests (well within Cloudflare Worker's 50-subrequest free limit).
 */
export async function fetchAllRetailDeals(
  options: {
    bestBuyApiKey?: string;
    fetchFn?: typeof fetch;
    maxVgpPages?: number;
    maxPnpPages?: number;
    maxBestBuyPages?: number;
  } = {},
): Promise<{
  deals: RetailDealItem[];
  sources: { vgp: number; pnp: number; bestbuy: number };
  cadToUsdRate: number;
}> {
  const fetchFn = options.fetchFn || fetch;
  const cadToUsdRate = await fetchCadToUsdRate(fetchFn);

  const [vgpDeals, pnpDeals, bestBuyProducts] = await Promise.all([
    fetchVgpDeals(fetchFn, options.maxVgpPages ?? 6, cadToUsdRate).catch(
      (err) => {
        console.warn('[RetailSync] VGP fetch warning:', err);
        return [] as RetailDealItem[];
      },
    ),
    fetchPnpDeals(fetchFn, options.maxPnpPages ?? 8, cadToUsdRate).catch(
      (err) => {
        console.warn('[RetailSync] PNP Games fetch warning:', err);
        return [] as RetailDealItem[];
      },
    ),
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

  return {
    deals: [...bestBuyDeals, ...vgpDeals, ...pnpDeals],
    sources: {
      vgp: vgpDeals.length,
      pnp: pnpDeals.length,
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

/**
 * Matches a retail product (Best Buy, VGP, or PNP Games) to a candidate game from the database.
 * First tries exact barcode/UPC match, then falls back to normalized title + platform match.
 */
export function matchBestBuyProduct(
  product: BestBuyProduct | RetailDealItem,
  candidates: CandidateGame[],
): number | null {
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
