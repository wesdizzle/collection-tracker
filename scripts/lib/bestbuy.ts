/**
 * BEST BUY DEALS & RETAIL PRICING CLIENT
 *
 * Integrates with the official Best Buy Developer API to fetch real-time
 * video game sales, clearance discounts, and retail pricing.
 */

export interface BestBuyProduct {
  sku: number;
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

/**
 * Maps Best Buy platform strings to Gagglog platform IDs.
 */
export const BESTBUY_TO_GAGGLOG_PLATFORM: Record<string, number> = {
  'PlayStation 4': 34,
  PS4: 34,
  'PlayStation 5': 35,
  PS5: 35,
  'Nintendo Switch': 26,
  Switch: 26,
  'Nintendo Switch 2': 27,
  'Xbox One': 49,
  'Xbox Series X': 50,
  'Xbox Series S': 50,
  'Xbox Series X|S': 50,
};

/**
 * Cleans a Best Buy product title by removing trailing platform suffixes and editions.
 * e.g., "Marvel's Spider-Man: Miles Morales - PlayStation 4" -> "Marvel's Spider-Man: Miles Morales"
 */
export function cleanBestBuyTitle(rawTitle: string): string {
  if (!rawTitle) return '';
  return rawTitle
    .replace(
      /\s*-\s*(PlayStation\s*[45]|PS[45]|Nintendo\s*Switch\s*2?|Switch\s*2?|Xbox\s*One|Xbox\s*Series\s*[XS](\|[XS])?)\s*$/i,
      '',
    )
    .replace(
      /\s*\[(PlayStation\s*[45]|PS[45]|Nintendo\s*Switch\s*2?|Switch\s*2?|Xbox\s*One|Xbox\s*Series\s*[XS])\]\s*$/i,
      '',
    )
    .replace(
      /\s*\((PlayStation\s*[45]|PS[45]|Nintendo\s*Switch\s*2?|Switch\s*2?|Xbox\s*One|Xbox\s*Series\s*[XS])\)\s*$/i,
      '',
    )
    .replace(/\s*Standard Edition\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes title for loose comparison.
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '')
    .trim();
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

export interface CandidateGame {
  stable_id: number;
  title: string;
  platform_id: number;
  barcode?: string | null;
}

/**
 * Matches a Best Buy product to a candidate game from the database.
 * First tries exact barcode/UPC match, then falls back to normalized title + platform match.
 */
export function matchBestBuyProduct(
  product: BestBuyProduct,
  candidates: CandidateGame[],
): number | null {
  // 1. UPC / Barcode match
  if (product.upc) {
    const cleanUpc = product.upc.trim();
    const barcodeMatch = candidates.find(
      (c) => c.barcode && c.barcode.trim() === cleanUpc,
    );
    if (barcodeMatch) {
      return barcodeMatch.stable_id;
    }
  }

  // 2. Title + Platform match
  const platformId = product.platform
    ? BESTBUY_TO_GAGGLOG_PLATFORM[product.platform]
    : undefined;

  const cleanedProductTitle = cleanBestBuyTitle(product.name);
  const normProductTitle = normalizeTitle(cleanedProductTitle);

  if (!normProductTitle) return null;

  for (const candidate of candidates) {
    // If platform is known from Best Buy, require platform match
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
