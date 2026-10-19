/**
 * BOUTIQUE PHYSICAL PUBLISHER & PRE-ORDER FEEDS ENGINE
 *
 * Ingests public storefront product feeds from boutique physical limited-print publishers:
 * 1. Limited Run Games (Shopify JSON)
 * 2. Super Rare Games (Shopify JSON)
 * 3. iam8bit (Shopify JSON)
 * 4. Fangamer (Shopify JSON)
 * 5. Strictly Limited Games (Shopify JSON)
 *
 * Normalizes pre-order game titles, extracts target platforms, and identifies physical releases.
 */

import { DEFAULT_CAD_TO_USD_RATE } from './bestbuy.js';

export interface ShopifyProductItem {
  id?: number | string;
  title?: string;
  handle?: string;
  tags?: string[] | string;
  variants?: Array<{
    price?: string | number;
    compare_at_price?: string | number;
    available?: boolean;
  }>;
  images?: Array<{ src?: string }>;
  published_at?: string;
  created_at?: string;
}

export interface ShopifyFeedResponse {
  products?: ShopifyProductItem[];
}

export interface WooProductItem {
  id?: number | string;
  name?: string;
  permalink?: string;
  prices?: {
    price?: string;
    regular_price?: string;
    sale_price?: string;
    currency_minor_unit?: number;
  };
  categories?: Array<{ name?: string }>;
  tags?: Array<{ name?: string }>;
  images?: Array<{ src?: string }>;
  is_in_stock?: boolean;
  date_created?: string;
}

export type BoutiqueStoreName =
  | 'Limited Run Games'
  | 'Super Rare Games'
  | 'iam8bit'
  | 'Fangamer'
  | 'Strictly Limited Games';

export interface BoutiquePreOrder {
  store: BoutiqueStoreName;
  id: string;
  rawTitle: string;
  cleanTitle: string;
  platformId: number | null;
  productUrl: string;
  imageUrl?: string;
  priceUsd?: number;
  priceCents?: number;
  edition?: string | null;
  region?: string | null;
  isAvailable: boolean;
  isPreOrder: boolean;
  publishedAt?: string;
}

export const STORE_DEFAULT_REGIONS: Record<BoutiqueStoreName, string> = {
  'Limited Run Games': 'USA',
  'Super Rare Games': 'Europe',
  iam8bit: 'USA',
  Fangamer: 'USA',
  'Strictly Limited Games': 'Europe',
};

export interface BoutiqueFeedConfig {
  store: BoutiqueStoreName;
  url: string;
  baseUrl: string;
  type: 'shopify' | 'woocommerce';
  isCad?: boolean;
}

export const BOUTIQUE_FEED_CONFIGS: BoutiqueFeedConfig[] = [
  {
    store: 'Limited Run Games',
    url: 'https://limitedrungames.com/collections/all/products.json?limit=250',
    baseUrl: 'https://limitedrungames.com',
    type: 'shopify',
  },
  {
    store: 'Super Rare Games',
    url: 'https://superraregames.com/collections/all/products.json?limit=250',
    baseUrl: 'https://superraregames.com',
    type: 'shopify',
  },
  {
    store: 'iam8bit',
    url: 'https://www.iam8bit.com/collections/games/products.json?limit=250',
    baseUrl: 'https://www.iam8bit.com',
    type: 'shopify',
  },
  {
    store: 'Fangamer',
    url: 'https://www.fangamer.com/collections/games/products.json?limit=250',
    baseUrl: 'https://www.fangamer.com',
    type: 'shopify',
  },
  {
    store: 'Strictly Limited Games',
    url: 'https://strictlylimitedgames.com/collections/all/products.json?limit=250',
    baseUrl: 'https://strictlylimitedgames.com',
    type: 'shopify',
  },
];

/**
 * Common non-game merch or peripheral keywords to filter out from game pre-order feeds.
 */
const NON_GAME_KEYWORDS = [
  'vinyl',
  'soundtrack',
  'ost',
  'plush',
  't-shirt',
  'tee',
  'hoodie',
  'poster',
  'artbook',
  'art book',
  'pin set',
  'enamel pin',
  'keychain',
  'slipcover only',
  'trading cards',
  'card pack',
  'blind box',
  'standee',
  'figure only',
  'controller',
  'faceplate',
  'carrying case',
];

/**
 * Extracts platform ID, region, edition, and sanitizes the title from boutique store listing formats.
 */
export function cleanBoutiqueTitle(rawTitle: string): {
  cleanTitle: string;
  platformId: number | null;
  edition?: string | null;
  region?: string | null;
  isPreOrder: boolean;
  isGame: boolean;
} {
  if (!rawTitle) {
    return {
      cleanTitle: '',
      platformId: null,
      edition: null,
      region: null,
      isPreOrder: false,
      isGame: false,
    };
  }

  const lowerRaw = rawTitle.toLowerCase();

  // Fast rejection of merchandise / soundtracks
  if (NON_GAME_KEYWORDS.some((kw) => lowerRaw.includes(kw))) {
    return {
      cleanTitle: rawTitle,
      platformId: null,
      edition: null,
      region: null,
      isPreOrder: false,
      isGame: false,
    };
  }

  const isPreOrder =
    lowerRaw.includes('pre-order') ||
    lowerRaw.includes('preorder') ||
    lowerRaw.includes('pre order');

  let title = rawTitle;

  // 1. Strip store catalogue prefixes:
  // e.g. "LRG #500: ", "SRG#120 - ", "SLG #45: ", "PRE-ORDER: ", "[PRE-ORDER]"
  title = title
    .replace(/^\[?\s*pre-?order\s*\]?\s*[:-]?\s*/i, '')
    .replace(/^(?:LRG|SRG|SLG|Strictly Limited)\s*#?\s*\d+\s*[:-]?\s*/i, '')
    .trim();

  // 2. Identify region from parentheticals/brackets or trailing delimiters
  let matchedRegion: string | null = null;
  const regionDefs: Array<{ regex: RegExp; region: string }> = [
    { regex: /^(?:USA|US|NA|North\s+America)$/i, region: 'USA' },
    { regex: /^(?:Europe|EU|PAL)$/i, region: 'Europe' },
    { regex: /^(?:Japan|JP)$/i, region: 'Japan' },
    { regex: /^(?:Asia)$/i, region: 'Asia' },
    { regex: /^(?:Australia|AUS)$/i, region: 'Australia' },
  ];

  title = title.replace(/[([][^)\]]*[)\]]/g, (bracketContent) => {
    const inner = bracketContent.slice(1, -1).trim();
    for (const rd of regionDefs) {
      if (rd.regex.test(inner)) {
        if (!matchedRegion) matchedRegion = rd.region;
        return '';
      }
    }
    const compMatch = inner.match(
      /\b(EU|Europe|PAL|JP|Japan|USA|US|NA|Asia|Australia|AUS)\b/i,
    );
    if (compMatch && /\b(version|import|edition|release)\b/i.test(inner)) {
      for (const rd of regionDefs) {
        if (rd.regex.test(compMatch[1])) {
          if (!matchedRegion) matchedRegion = rd.region;
          return '';
        }
      }
    }
    return bracketContent;
  });

  // End of title region check (e.g. " - EU", " - JP", " - USA")
  title = title
    .replace(/\s*-\s*(?:EU|Europe|PAL)\s*$/i, () => {
      if (!matchedRegion) matchedRegion = 'Europe';
      return '';
    })
    .replace(/\s*-\s*(?:JP|Japan)\s*$/i, () => {
      if (!matchedRegion) matchedRegion = 'Japan';
      return '';
    })
    .replace(/\s*-\s*(?:USA|US|NA)\s*$/i, () => {
      if (!matchedRegion) matchedRegion = 'USA';
      return '';
    })
    .replace(/\s*-\s*(?:Asia)\s*$/i, () => {
      if (!matchedRegion) matchedRegion = 'Asia';
      return '';
    });

  // 3. Identify platform
  let platformId: number | null = null;

  // Platform regex checks in order of specificity
  const platformPatterns: Array<{ regex: RegExp; id: number }> = [
    { regex: /\b(?:Nintendo\s+)?Switch\s+2\b/i, id: 27 },
    { regex: /\bNSW2\b/i, id: 27 },
    { regex: /\b(?:Nintendo\s+)?Switch\b/i, id: 26 },
    { regex: /\bNSW\b/i, id: 26 },
    { regex: /\b(?:PlayStation\s+5|PS5)\b/i, id: 35 },
    { regex: /\b(?:PlayStation\s+4|PS4)\b/i, id: 34 },
    { regex: /\b(?:PlayStation\s+Vita|PS\s*Vita|PSV)\b/i, id: 33 },
    { regex: /\b(?:PlayStation\s+3|PS3)\b/i, id: 32 },
    { regex: /\b(?:PlayStation\s+VR2|PSVR2)\b/i, id: 52 },
    { regex: /\b(?:PlayStation\s+VR|PSVR)\b/i, id: 51 },
    { regex: /\b(?:Xbox\s+Series\s+X(?:[|/]S)?|XSX)\b/i, id: 50 },
    { regex: /\b(?:Xbox\s+One|XB1)\b/i, id: 49 },
    { regex: /\b(?:Sega\s+Genesis|Mega\s+Drive)\b/i, id: 37 },
    { regex: /\b(?:Super\s+Nintendo|SNES)\b/i, id: 15 },
    { regex: /\b(?:Nintendo\s+Entertainment\s+System|NES)\b/i, id: 13 },
    { regex: /\b(?:Game\s+Boy\s+Advance|GBA)\b/i, id: 19 },
    { regex: /\b(?:Game\s+Boy\s+Color|GBC)\b/i, id: 18 },
    { regex: /\b(?:Game\s+Boy|GB)\b/i, id: 14 },
    { regex: /\b(?:Nintendo\s+64|N64)\b/i, id: 17 },
  ];

  // First, check if any parenthetical/bracket contains platform keywords or pre-order
  title = title.replace(/[([][^)\]]*[)\]]/g, (bracketContent) => {
    for (const p of platformPatterns) {
      if (p.regex.test(bracketContent)) {
        if (!platformId) platformId = p.id;
        return '';
      }
    }
    if (/pre-?order/i.test(bracketContent)) return '';
    return bracketContent;
  });

  // If not found in brackets, check remaining title (e.g. " - PS5" or " - Nintendo Switch")
  if (!platformId) {
    for (const p of platformPatterns) {
      if (p.regex.test(title)) {
        platformId = p.id;
        title = title.replace(p.regex, '').trim();
        break;
      }
    }
  }

  // 4. Detect and strip Edition markers
  let matchedEdition: string | null = null;
  const editionPatterns: Array<{ regex: RegExp; name: string }> = [
    { regex: /\bCollector'?s?\s+Edition\b/i, name: "Collector's Edition" },
    { regex: /\bDeluxe\s+Edition\b/i, name: 'Deluxe Edition' },
    { regex: /\bSpecial\s+Edition\b/i, name: 'Special Edition' },
    { regex: /\bLimited\s+Edition\b/i, name: 'Limited Edition' },
    { regex: /\bSteelbook(?:\s+Edition)?\b/i, name: 'Steelbook Edition' },
    { regex: /\bAnniversary\s+Edition\b/i, name: 'Anniversary Edition' },
    { regex: /\bClassic\s+Edition\b/i, name: 'Classic Edition' },
    { regex: /\bRetro\s+Edition\b/i, name: 'Retro Edition' },
    { regex: /\bDefinitive\s+Edition\b/i, name: 'Definitive Edition' },
    { regex: /\bExclusive\s+Variant\b/i, name: 'Exclusive Variant' },
    {
      regex: /\b(?:Expansion\s+(?:Pack|Pass)|DLC(?:\s+Bundle)?)\b/i,
      name: 'Expansion Edition',
    },
  ];

  for (const ep of editionPatterns) {
    if (ep.regex.test(title)) {
      if (!matchedEdition) matchedEdition = ep.name;
      title = title.replace(ep.regex, ' ').trim();
    }
  }

  // Also strip generic edition tags that don't constitute a special edition variant
  title = title
    .replace(/\b(?:Standard|Physical)\s+Edition\b/gi, ' ')
    .replace(/\[\s*Pre-?Order\s*\]/gi, ' ')
    .replace(/\(\s*Pre-?Order\s*\)/gi, ' ')
    .trim();

  // 5. Clean trademarks, brackets, connectors, and trailing whitespace
  title = title.replace(/[™®]/g, '');

  title = title
    .replace(/[([][^)\]]*[)\]]/g, (match) => {
      if (/pre-?order/i.test(match)) return '';
      return match;
    })
    .trim();

  // Remove empty trailing parens like () or []
  title = title.replace(/\(\s*\)|\[\s*\]/g, '').trim();

  // Strip trailing/leading connectors and punctuation
  let prev: string;
  do {
    prev = title;
    title = title
      .replace(/\s*-\s*$/, '')
      .replace(/^\s*-\s*/, '')
      .replace(/\s*:\s*$/, '')
      .replace(/\s*\/\s*$/, '')
      .replace(/\s+\b(?:for|on|at)\b\s*$/i, '')
      .replace(/^\s*\b(?:for|on|at)\b\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  } while (title !== prev);

  // If title was reduced to empty or is not identified as a console game, mark isGame
  const isGame = Boolean(platformId && title.length > 1);

  return {
    cleanTitle: title,
    platformId,
    edition: matchedEdition,
    region: matchedRegion,
    isPreOrder,
    isGame,
  };
}

/**
 * Fetches and aggregates pre-order/physical release items from all configured boutique stores.
 */
export async function fetchBoutiquePreOrders(
  fetchFn: typeof fetch = fetch,
  storesToFetch: BoutiqueFeedConfig[] = BOUTIQUE_FEED_CONFIGS,
): Promise<BoutiquePreOrder[]> {
  const results: BoutiquePreOrder[] = [];

  const promises = storesToFetch.map(async (config) => {
    try {
      const resp = await fetchFn(config.url, {
        headers: {
          'User-Agent': 'Gagglog/1.0 (BoutiqueCatalogSync)',
          Accept: 'application/json',
        },
      });

      if (!resp.ok) {
        return;
      }

      const json = (await resp.json()) as
        | ShopifyFeedResponse
        | WooProductItem[];

      if (
        config.type === 'shopify' &&
        json &&
        'products' in json &&
        Array.isArray(json.products)
      ) {
        for (const item of json.products) {
          const rawTitle = item.title || '';
          const cleaned = cleanBoutiqueTitle(rawTitle);

          if (!cleaned.isGame) {
            continue;
          }

          // Check tags for pre-order if not in title
          let isPre = cleaned.isPreOrder;
          if (!isPre && Array.isArray(item.tags)) {
            isPre = item.tags.some((t: string) =>
              /pre-?order/i.test(typeof t === 'string' ? t : ''),
            );
          }

          const isAvailable =
            Array.isArray(item.variants) &&
            item.variants.length > 0 &&
            item.variants.some((v) => v.available !== false);

          const region =
            cleaned.region || STORE_DEFAULT_REGIONS[config.store] || null;

          let priceUsd: number | undefined;
          let priceCents: number | undefined;
          if (Array.isArray(item.variants) && item.variants.length > 0) {
            const rawPrice = parseFloat(String(item.variants[0].price || ''));
            if (!isNaN(rawPrice)) {
              priceUsd = config.isCad
                ? Math.round(rawPrice * DEFAULT_CAD_TO_USD_RATE * 100) / 100
                : rawPrice;
              priceCents = Math.round(priceUsd * 100);
            }
          }

          const productUrl = `${config.baseUrl}/products/${item.handle}`;
          const imageUrl =
            Array.isArray(item.images) && item.images.length > 0
              ? item.images[0].src
              : undefined;

          results.push({
            store: config.store,
            id: `${config.store}_${item.id}`,
            rawTitle,
            cleanTitle: cleaned.cleanTitle,
            platformId: cleaned.platformId,
            productUrl,
            imageUrl,
            priceUsd,
            priceCents,
            edition: cleaned.edition,
            region,
            isAvailable,
            isPreOrder: isPre,
            publishedAt: item.published_at || item.created_at,
          });
        }
      } else if (config.type === 'woocommerce' && Array.isArray(json)) {
        for (const item of json) {
          const rawTitle = item.name || '';
          const cleaned = cleanBoutiqueTitle(rawTitle);

          if (!cleaned.isGame) {
            continue;
          }

          const isPre = cleaned.isPreOrder;
          const isAvailable = item.is_in_stock !== false;
          const region =
            cleaned.region || STORE_DEFAULT_REGIONS[config.store] || null;

          let priceUsd: number | undefined;
          let priceCents: number | undefined;
          if (item.prices && item.prices.price) {
            const cents = parseInt(item.prices.price, 10);
            if (!isNaN(cents)) {
              const rawCad = cents / 100;
              priceUsd =
                Math.round(rawCad * DEFAULT_CAD_TO_USD_RATE * 100) / 100;
              priceCents = Math.round(priceUsd * 100);
            }
          }

          const productUrl =
            item.permalink || `${config.baseUrl}/product/${item.id}`;
          const imageUrl =
            Array.isArray(item.images) && item.images.length > 0
              ? item.images[0].src
              : undefined;

          results.push({
            store: config.store,
            id: `${config.store}_${item.id}`,
            rawTitle,
            cleanTitle: cleaned.cleanTitle,
            platformId: cleaned.platformId,
            productUrl,
            imageUrl,
            priceUsd,
            priceCents,
            edition: cleaned.edition,
            region,
            isAvailable,
            isPreOrder: isPre,
            publishedAt: item.date_created,
          });
        }
      }
    } catch {
      // Store failure or network timeout should never crash the aggregate process
    }
  });

  await Promise.all(promises);
  return results;
}
