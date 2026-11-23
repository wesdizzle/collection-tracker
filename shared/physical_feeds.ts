/**
 * BOUTIQUE PHYSICAL PUBLISHER & PRE-ORDER FEEDS ENGINE
 *
 * Ingests public storefront product feeds from boutique physical limited-print publishers:
 * 1. Limited Run Games (Shopify JSON)
 * 2. Super Rare Games (Shopify JSON)
 * 3. iam8bit (Shopify JSON)
 * 4. Fangamer (Shopify JSON)
 * 5. Strictly Limited Games (Shopify JSON)
 * 6. NIS America, Aksys Games, Clear River Games, Serenity Forge, Premium Edition Games, CastleMania
 * 7. Silver Lining Direct & First Press Games (Shopify JSON)
 * 8. Limited Game News (WordPress REST API — aggregates Red Art Games, VGNYsoft, Play-Asia, EastAsiaSoft, etc.)
 *
 * Normalizes pre-order game titles, extracts target platforms, and identifies physical releases.
 */

import { DEFAULT_CAD_TO_USD_RATE, decodeHtmlEntities } from './retail.js';
import {
  stripBoutiqueCatalogPrefix,
  stripLgnPlatformPipeTrailer,
} from './title_matching.js';

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
  | 'Strictly Limited Games'
  | 'NIS America'
  | 'Aksys Games'
  | 'Clear River Games'
  | 'Serenity Forge'
  | 'Premium Edition Games'
  | 'CastleMania'
  | 'Silver Lining Direct'
  | 'First Press Games'
  | 'Limited Game News';

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
  regularPriceCents?: number;
  discountPct?: number;
  onSale?: boolean;
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
  'NIS America': 'USA',
  'Aksys Games': 'USA',
  'Clear River Games': 'Europe',
  'Serenity Forge': 'USA',
  'Premium Edition Games': 'USA',
  CastleMania: 'USA',
  'Silver Lining Direct': 'Europe',
  'First Press Games': 'Europe',
  'Limited Game News': 'USA',
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
  {
    store: 'NIS America',
    url: 'https://store.nisamerica.com/collections/games/products.json?limit=250',
    baseUrl: 'https://store.nisamerica.com',
    type: 'shopify',
  },
  {
    store: 'Aksys Games',
    url: 'https://store.aksysgames.com/products.json?limit=250',
    baseUrl: 'https://store.aksysgames.com',
    type: 'shopify',
  },
  {
    store: 'Clear River Games',
    url: 'https://shop.clearrivergames.com/products.json?limit=250',
    baseUrl: 'https://shop.clearrivergames.com',
    type: 'shopify',
  },
  {
    store: 'Serenity Forge',
    url: 'https://store.serenityforge.com/products.json?limit=250',
    baseUrl: 'https://store.serenityforge.com',
    type: 'shopify',
  },
  {
    store: 'Premium Edition Games',
    url: 'https://premiumeditiongames.com/products.json?limit=250',
    baseUrl: 'https://premiumeditiongames.com',
    type: 'shopify',
  },
  {
    store: 'CastleMania',
    url: 'https://castlemaniagames.com/products.json?limit=250',
    baseUrl: 'https://castlemaniagames.com',
    type: 'shopify',
  },
  {
    store: 'Silver Lining Direct',
    url: 'https://direct.silverliningint.com/products.json?limit=250',
    baseUrl: 'https://direct.silverliningint.com',
    type: 'shopify',
  },
  {
    store: 'First Press Games',
    url: 'https://firstpressgames.com/products.json?limit=250',
    baseUrl: 'https://firstpressgames.com',
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
  'slipcover',
  'trading cards',
  'card pack',
  'card sleeve',
  'blind box',
  'standee',
  'acrylic stand',
  'figure only',
  'figurine',
  'statue',
  'controller',
  'faceplate',
  'carrying case',
  'replacement case',
  'manual only',
  'desk mat',
  'wall scroll',
  'medallion',
  'mug',
  'jacket',
  'tote bag',
  'apparel',
  'digital code only',
];

const NON_GAME_REGEXES = NON_GAME_KEYWORDS.map(
  (kw) =>
    new RegExp(
      `\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\b`,
      'i',
    ),
);

const BOUTIQUE_PLATFORM_PATTERNS: Array<{ regex: RegExp; id: number }> = [
  { regex: /\b(?:Nintendo\s+)?Switch\s+2\b/i, id: 27 },
  { regex: /\bNSW2\b/i, id: 27 },
  { regex: /\b(?:Nintendo\s+)?Switch\b(?!\s+2)/i, id: 26 },
  { regex: /\bNSW\b(?!2)/i, id: 26 },
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

/**
 * Extracts platform ID, region, edition, and sanitizes the title from boutique store listing formats.
 */
export function cleanBoutiqueTitle(
  rawTitle: string,
  options: { requirePlatform?: boolean } = {},
): {
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

  // Fast rejection of merchandise / soundtracks using word boundaries
  if (NON_GAME_REGEXES.some((rx) => rx.test(rawTitle))) {
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

  // 1. Strip store catalogue prefixes:
  // e.g. "LRG #500: ", "Limited Run #273: ", "SRG#120 - ", "SLG #45: ", "PRE-ORDER: ", "[PRE-ORDER]"
  let title = stripBoutiqueCatalogPrefix(rawTitle, {
    stripPreOrderPrefix: true,
  });

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

  // First, check if any parenthetical/bracket contains platform keywords or pre-order
  title = title.replace(/[([][^)\]]*[)\]]/g, (bracketContent) => {
    for (const p of BOUTIQUE_PLATFORM_PATTERNS) {
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
    for (const p of BOUTIQUE_PLATFORM_PATTERNS) {
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

  const requirePlatform = options.requirePlatform ?? true;
  // If title was reduced to empty or is not identified as a console game, mark isGame
  const isGame = requirePlatform
    ? Boolean(platformId && title.length > 1)
    : title.length > 1;

  return {
    cleanTitle: title,
    platformId,
    edition: matchedEdition,
    region: matchedRegion,
    isPreOrder,
    isGame,
  };
}

function parseShopifyBoutiqueItem(
  config: BoutiqueFeedConfig,
  item: ShopifyProductItem,
): BoutiquePreOrder | null {
  const rawTitle = item.title || '';
  const cleaned = cleanBoutiqueTitle(rawTitle);

  if (!cleaned.isGame) {
    return null;
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

  const region = cleaned.region || STORE_DEFAULT_REGIONS[config.store] || null;

  let priceUsd: number | undefined;
  let priceCents: number | undefined;
  let regularPriceCents: number | undefined;
  let discountPct: number | undefined;
  let onSale: boolean | undefined;
  if (Array.isArray(item.variants) && item.variants.length > 0) {
    const rawPrice = parseFloat(String(item.variants[0].price || ''));
    if (!isNaN(rawPrice)) {
      priceUsd = config.isCad
        ? Math.round(rawPrice * DEFAULT_CAD_TO_USD_RATE * 100) / 100
        : rawPrice;
      priceCents = Math.round(priceUsd * 100);

      const rawCompare = parseFloat(
        String(item.variants[0].compare_at_price || ''),
      );
      if (!isNaN(rawCompare) && rawCompare > rawPrice) {
        const regUsd = config.isCad
          ? Math.round(rawCompare * DEFAULT_CAD_TO_USD_RATE * 100) / 100
          : rawCompare;
        regularPriceCents = Math.round(regUsd * 100);
        discountPct = Math.round(
          ((regularPriceCents - priceCents) / regularPriceCents) * 100,
        );
        onSale = discountPct > 0;
      }
    }
  }

  const productUrl = `${config.baseUrl}/products/${item.handle}`;
  const imageUrl =
    Array.isArray(item.images) && item.images.length > 0
      ? item.images[0].src
      : undefined;

  return {
    store: config.store,
    id: `${config.store}_${item.id}`,
    rawTitle,
    cleanTitle: cleaned.cleanTitle,
    platformId: cleaned.platformId,
    productUrl,
    imageUrl,
    priceUsd,
    priceCents,
    regularPriceCents,
    discountPct,
    onSale,
    edition: cleaned.edition,
    region,
    isAvailable,
    isPreOrder: isPre,
    publishedAt: item.published_at || item.created_at,
  };
}

function parseWooBoutiqueItem(
  config: BoutiqueFeedConfig,
  item: WooProductItem,
): BoutiquePreOrder | null {
  const rawTitle = item.name || '';
  const cleaned = cleanBoutiqueTitle(rawTitle);

  if (!cleaned.isGame) {
    return null;
  }

  const isPre = cleaned.isPreOrder;
  const isAvailable = item.is_in_stock !== false;
  const region = cleaned.region || STORE_DEFAULT_REGIONS[config.store] || null;

  let priceUsd: number | undefined;
  let priceCents: number | undefined;
  if (item.prices && item.prices.price) {
    const cents = parseInt(item.prices.price, 10);
    if (!isNaN(cents)) {
      const rawCad = cents / 100;
      priceUsd = Math.round(rawCad * DEFAULT_CAD_TO_USD_RATE * 100) / 100;
      priceCents = Math.round(priceUsd * 100);
    }
  }

  const productUrl = item.permalink || `${config.baseUrl}/product/${item.id}`;
  const imageUrl =
    Array.isArray(item.images) && item.images.length > 0
      ? item.images[0].src
      : undefined;

  return {
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
  };
}

/**
 * Fetches and aggregates pre-order/physical release items from all configured boutique stores.
 * Pass `maxPages > 1` for full offline back-catalog crawls (Worker crons default to `maxPages = 1`).
 */
export async function fetchBoutiquePreOrders(
  fetchFn: typeof fetch = fetch,
  storesToFetch: BoutiqueFeedConfig[] = BOUTIQUE_FEED_CONFIGS,
  maxPages = 1,
): Promise<BoutiquePreOrder[]> {
  const results: BoutiquePreOrder[] = [];
  const pageLimit = Math.max(1, maxPages);

  const promises = storesToFetch.map(async (config) => {
    try {
      for (let page = 1; page <= pageLimit; page++) {
        const pageUrl =
          page === 1
            ? config.url
            : `${config.url}${config.url.includes('?') ? '&' : '?'}page=${page}`;
        const resp = await fetchFn(pageUrl, {
          headers: {
            'User-Agent': 'CollectionTracker/2.0 (BoutiqueCatalogSync)',
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(15000),
        });

        if (!resp.ok) {
          break;
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
          if (json.products.length === 0) break;
          for (const item of json.products) {
            const parsed = parseShopifyBoutiqueItem(config, item);
            if (parsed) results.push(parsed);
          }
          if (json.products.length < 250) break;
        } else if (config.type === 'woocommerce' && Array.isArray(json)) {
          if (json.length === 0) break;
          for (const item of json) {
            const parsed = parseWooBoutiqueItem(config, item);
            if (parsed) results.push(parsed);
          }
          if (json.length < 100) break;
        } else {
          break;
        }
      }
    } catch {
      // Store failure or network timeout should never crash the aggregate process
    }
  });

  await Promise.all(promises);
  return results;
}

export interface LimitedGameNewsPost {
  id: number;
  date_gmt?: string;
  link?: string;
  title?: { rendered?: string };
  excerpt?: { rendered?: string };
  categories?: number[];
}

interface LimitedGameNewsCategory {
  id: number;
  name?: string;
  slug?: string;
}

const LGN_NON_ANNOUNCEMENT_REGEX =
  /\b(roundup|weekly\s+recap|giveaway|contest|podcast|shipping\s+update|flash\s+sale|newsletter|interview|merchandise\s+drop|shipping\s+schedule)\b/i;

function stripWpHtml(html?: string): string {
  if (!html) return '';
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/&hellip;|&#8230;/gi, '...')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripLgnNewsFraming(rawTitle: string): string {
  const platToken =
    '(?:(?:Nintendo\\s+)?Switch(?:\\s+2)?|NSW2?|PlayStation\\s*[1-5]|PS[1-5]|PlayStation\\s*Vita|PS\\s*Vita|PSVR2?|Xbox\\s+Series\\s+[XS](?:[|/]S)?|Xbox\\s+One|3DS)';
  return stripLgnPlatformPipeTrailer(
    rawTitle
      .replace(
        /^(?:limited\s+run\s+games|super\s+rare\s+games|strictly\s+limited(?:\s+games)?|red\s+art\s+games|vgnysoft|eastasiasoft|play[- ]?asia|first\s+press\s+games|nis\s+america|serenity\s+forge|fangamer|iam8bit|clear\s+river\s+games|silver\s+lining(?:\s+direct|\s+interactive)?)\s+(?:announces?|reveals?|launches?|opens?\s+pre[- ]?orders?\s+for)\s+/i,
        '',
      )
      .replace(
        /\s+(?:gets?|receives?|is\s+getting|announced\s+for)\s+(?:a\s+)?(?:physical\s+(?:release|edition|version)|pre[- ]?orders?)\b.*$/i,
        '',
      )
      .replace(
        /\s+(?:physical\s+(?:release|edition|version)\s+(?:announced|revealed|now\s+available|up\s+for\s+pre[- ]?order))\b.*$/i,
        '',
      ),
  )
    .replace(
      new RegExp(
        `\\s+(?:on|for)\\s+${platToken}(?:\\s*(?:,|\\/|&|\\band\\b)\\s*${platToken})*\\s*$`,
        'i',
      ),
      '',
    )
    .replace(/\s*[([]\s*asia(?:n)?[\s-]+english\s*[\])]\s*/gi, ' ')
    .replace(/\s+asia(?:n)?[\s-]+english\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractAllPlatformIds(text: string): number[] {
  const found: number[] = [];
  for (const p of BOUTIQUE_PLATFORM_PATTERNS) {
    if (p.regex.test(text) && !found.includes(p.id)) {
      found.push(p.id);
    }
  }
  return found;
}

/**
 * Fetches recent physical release announcements from Limited Game News (WordPress REST API),
 * covering boutique publishers without Shopify feeds (e.g. Red Art Games, VGNYsoft, Play-Asia).
 */
export async function fetchLimitedGameNewsReleases(
  fetchFn: typeof fetch = fetch,
  options: { maxPages?: number; perPage?: number } = {},
): Promise<BoutiquePreOrder[]> {
  const maxPages = Math.max(1, options.maxPages ?? 1);
  const perPage = Math.min(100, Math.max(1, options.perPage ?? 50));

  // Optionally resolve dynamic WP category IDs to platform/region hints (non-fatal on failure)
  const categoryPlatforms = new Map<number, number>();
  const asiaCategoryIds = new Set<number>([10022]);
  try {
    const catResp = await fetchFn(
      'https://limitedgamenews.com/wp-json/wp/v2/categories?per_page=100&_fields=id,name,slug',
      {
        headers: {
          'User-Agent': 'CollectionTracker/2.0 (LimitedGameNewsSync)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (catResp.ok) {
      const cats = (await catResp.json()) as LimitedGameNewsCategory[];
      if (Array.isArray(cats)) {
        for (const cat of cats) {
          const label = `${cat.name || ''} ${cat.slug || ''}`;
          if (/asia(?:n)?[\s-]+english/i.test(label)) {
            asiaCategoryIds.add(cat.id);
            continue;
          }
          for (const p of BOUTIQUE_PLATFORM_PATTERNS) {
            if (p.regex.test(label)) {
              categoryPlatforms.set(cat.id, p.id);
              break;
            }
          }
        }
      }
    }
  } catch {
    // Proceed with headline/excerpt platform extraction
  }

  const results: BoutiquePreOrder[] = [];
  for (let page = 1; page <= maxPages; page++) {
    try {
      const url = `https://limitedgamenews.com/wp-json/wp/v2/posts?per_page=${perPage}&page=${page}&_fields=id,date_gmt,link,title,categories,excerpt`;
      const resp = await fetchFn(url, {
        headers: {
          'User-Agent': 'CollectionTracker/2.0 (LimitedGameNewsSync)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) break;

      const posts = (await resp.json()) as LimitedGameNewsPost[];
      if (!Array.isArray(posts) || posts.length === 0) break;

      for (const post of posts) {
        const decodedHeadline = stripWpHtml(post.title?.rendered);
        if (
          !decodedHeadline ||
          LGN_NON_ANNOUNCEMENT_REGEX.test(decodedHeadline)
        ) {
          continue;
        }

        const decodedExcerpt = stripWpHtml(post.excerpt?.rendered);
        const catIds = Array.isArray(post.categories) ? post.categories : [];
        const isAsiaEnglish =
          catIds.some((id) => asiaCategoryIds.has(id)) ||
          /\basia(?:n)?[\s-]+english\b/i.test(
            `${decodedHeadline} ${decodedExcerpt}`,
          );

        const unframed = stripLgnNewsFraming(decodedHeadline);
        const cleaned = cleanBoutiqueTitle(unframed, {
          requirePlatform: false,
        });
        if (
          !cleaned.isGame ||
          NON_GAME_REGEXES.some((rx) => rx.test(decodedHeadline)) ||
          !cleaned.cleanTitle ||
          cleaned.cleanTitle.length < 2
        ) {
          continue;
        }

        const textPlatforms = extractAllPlatformIds(
          `${decodedHeadline} ${decodedExcerpt}`,
        );
        const categoryMatchedPlatforms = catIds
          .map((id) => categoryPlatforms.get(id))
          .filter((id): id is number => id !== undefined);
        const platformIds = Array.from(
          new Set(
            textPlatforms.length > 0
              ? textPlatforms
              : categoryMatchedPlatforms.length > 0
                ? categoryMatchedPlatforms
                : cleaned.platformId !== null
                  ? [cleaned.platformId]
                  : [],
          ),
        );

        const region =
          cleaned.region ||
          (isAsiaEnglish ? 'Asia' : STORE_DEFAULT_REGIONS['Limited Game News']);

        if (platformIds.length === 0) {
          continue;
        }

        for (const platformId of platformIds) {
          results.push({
            store: 'Limited Game News',
            id: `Limited Game News_${post.id}_${platformId}`,
            rawTitle: decodedHeadline,
            cleanTitle: cleaned.cleanTitle,
            platformId,
            productUrl:
              post.link || `https://limitedgamenews.com/?p=${post.id}`,
            edition: cleaned.edition,
            region,
            isAvailable: true,
            isPreOrder: true,
            publishedAt: post.date_gmt,
          });
        }
      }

      if (posts.length < perPage) break;
    } catch {
      break;
    }
  }

  return results;
}
