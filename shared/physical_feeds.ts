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

import {
  DEFAULT_CAD_TO_USD_RATE,
  decodeHtmlEntities,
  isStorefrontNonGameOrMultiBoxBundle,
} from './retail.js';
import {
  buildStructuralTitleCandidates,
  stripBoutiqueCatalogPrefix,
  stripLgnPlatformPipeTrailer,
} from './title_matching.js';

export interface ShopifyProductItem {
  id?: number | string;
  title?: string;
  handle?: string;
  product_type?: string;
  body_html?: string;
  tags?: string[] | string;
  variants?: Array<{
    title?: string;
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
  | 'Nicalis'
  | 'Limited Game News';

export interface BoutiquePreOrder {
  store: BoutiqueStoreName;
  id: string;
  rawTitle: string;
  cleanTitle: string;
  platformId: number | null;
  ambiguousXbox?: boolean;
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
  Nicalis: 'USA',
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
  {
    store: 'Nicalis',
    url: 'https://store.nicalis.com/products.json?limit=250',
    baseUrl: 'https://store.nicalis.com',
    type: 'shopify',
  },
];

/**
 * Boutique feed hardware/merch filtering delegates to the unified `isStorefrontNonGameOrMultiBoxBundle`
 * helper exported by `./retail.js` so storefront exclusion rules never drift between modules.
 */

const BOUTIQUE_PLATFORM_PATTERNS: Array<{ regex: RegExp; id: number }> = [
  { regex: /\b(?:Nintendo\s+)?Switch\s+2\b/i, id: 27 },
  { regex: /\bNSW2\b/i, id: 27 },
  { regex: /\b(?:Nintendo\s+)?Switch\b(?!\s+2)/i, id: 26 },
  { regex: /\bNSW\b(?!2)/i, id: 26 },
  { regex: /\b(?:PlayStation\s+5|PS5)\b/i, id: 35 },
  { regex: /\b(?:PlayStation\s+4|PS4)\b/i, id: 34 },
  { regex: /\b(?:PlayStation\s+Vita|PS\s*Vita|PSV)\b/i, id: 33 },
  { regex: /\b(?:PlayStation\s+3|PS3)\b/i, id: 32 },
  { regex: /\b(?:PlayStation\s+VR2|PSVR2)\b/i, id: 35 },
  { regex: /\b(?:PlayStation\s+VR|PSVR)\b/i, id: 34 },
  // Xbox One / forward-compatible dual Xbox One + Series X discs classify strictly as Xbox One (49)
  { regex: /\b(?:Xbox\s+One|XB1)\b/i, id: 49 },
  { regex: /\b(?:Xbox\s+Series\s+[XS](?:[|/]S)?|XSX)\b/i, id: 50 },
  { regex: /\b(?:Xbox\s+360|X360)\b/i, id: 48 },
  {
    regex:
      /\b(?:ONLY\s+WORKS\s+ON\s+NEW\s+(?:NINTENDO\s+)?3DS(?:\s*(?:&|AND)\s*2DS(?:\s+SYSTEMS)?)?|New\s+(?:Nintendo\s+)?3DS(?:\s+XL|\s+LL)?|N3DS)\b/i,
    id: 25,
  },
  { regex: /\b(?:Nintendo\s+)?3DS\b/i, id: 23 },
  { regex: /\b(?:Sega\s+Genesis|Mega\s+Drive)\b/i, id: 37 },
  { regex: /\b(?:Super\s+Nintendo|SNES)\b/i, id: 15 },
  { regex: /\b(?:Nintendo\s+Entertainment\s+System|NES)\b/i, id: 13 },
  { regex: /\b(?:Game\s+Boy\s+Advance|GBA)\b/i, id: 19 },
  {
    regex: /\b(?:Only\s+for\s+Game\s+Boy\s+Color|Game\s+Boy\s+Color|GBC)\b/i,
    id: 18,
  },
  { regex: /\b(?:Game\s+Boy|GB)\b/i, id: 14 },
  { regex: /\b(?:Nintendo\s+64|N64)\b/i, id: 17 },
];

const BARE_XBOX_PLATFORM_REGEX =
  /\bXbox\b(?!\s*(?:360|One|Series|Live|Game\s*Pass|Design\s*Lab))/i;

const BOUTIQUE_PLATFORM_ALT = `(?:${BOUTIQUE_PLATFORM_PATTERNS.map((p) => p.regex.source).join('|')})`;
const ANCHORED_CONNECTOR_PLATFORM_SPAN_RE = new RegExp(
  `(?:\\s*[-–—|/]\\s*|\\s+\\b(?:for|on)\\b\\s+(?:the\\s+)?)${BOUTIQUE_PLATFORM_ALT}(?:\\s*(?:,|\\/|\\||&|\\band\\b)\\s*${BOUTIQUE_PLATFORM_ALT})*(?=\\s*(?:$|[-–—|/]|(?:Collector'?s?|Deluxe|Special|Limited|Standard|Physical|Classic|Retro|Anniversary|Definitive|Exclusive|Steelbook)\\b))`,
  'i',
);
const TRAILING_BARE_PLATFORM_RE = new RegExp(
  `(?:^|\\s+)${BOUTIQUE_PLATFORM_ALT}(?=\\s*$)`,
  'i',
);

const HARDWARE_SUB_PLATFORM_UPGRADES = new Set<string>(['23->25', '14->18']);

function mergeBoutiquePlatformId(
  current: number | null,
  candidate: number,
): number {
  if (current === null) return candidate;
  if (HARDWARE_SUB_PLATFORM_UPGRADES.has(`${current}->${candidate}`)) {
    return candidate;
  }
  return current;
}

/**
 * Extracts platform ID, region, edition, and sanitizes the title from boutique store listing formats.
 */
export function cleanBoutiqueTitle(
  rawTitle: string,
  options: { requirePlatform?: boolean } = {},
): {
  cleanTitle: string;
  platformId: number | null;
  ambiguousXbox?: boolean;
  edition?: string | null;
  region?: string | null;
  isPreOrder: boolean;
  isGame: boolean;
} {
  if (!rawTitle) {
    return {
      cleanTitle: '',
      platformId: null,
      ambiguousXbox: false,
      edition: null,
      region: null,
      isPreOrder: false,
      isGame: false,
    };
  }

  const lowerRaw = rawTitle.toLowerCase();

  // Fast rejection of merchandise, soundtracks, hardware, and multi-box storefront bundles
  if (isStorefrontNonGameOrMultiBoxBundle(rawTitle)) {
    return {
      cleanTitle: rawTitle,
      platformId: null,
      ambiguousXbox: false,
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

  // 1. Strip store catalogue prefixes and trademark symbols before anchored platform scanning
  let title = stripBoutiqueCatalogPrefix(decodeHtmlEntities(rawTitle), {
    stripPreOrderPrefix: true,
  })
    .replace(/[™®]/g, '')
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
  let ambiguousXbox = false;

  // First, check if any parenthetical/bracket contains platform keywords or pre-order
  title = title.replace(/[([][^)\]]*[)\]]/g, (bracketContent) => {
    for (const p of BOUTIQUE_PLATFORM_PATTERNS) {
      if (p.regex.test(bracketContent)) {
        const nextPid = mergeBoutiquePlatformId(platformId, p.id);
        if (nextPid !== platformId) {
          platformId = nextPid;
          ambiguousXbox = false;
        }
        return '';
      }
    }
    if (BARE_XBOX_PLATFORM_REGEX.test(bracketContent)) {
      if (!platformId) {
        platformId = 49;
        ambiguousXbox = true;
      }
      return '';
    }
    if (/pre-?order/i.test(bracketContent)) return '';
    return bracketContent;
  });

  // Always check remaining title for anchored multi-platform phrases or trailing platform tags
  // so multi-platform listings ("OMORI for Nintendo Switch and PlayStation 4") never leave
  // mid-prose residue ("OMORI for and PlayStation 4"), while sub-platform upgrades (23->25, 14->18) hold.
  for (let pass = 0; pass < 2; pass++) {
    const connMatch = title.match(ANCHORED_CONNECTOR_PLATFORM_SPAN_RE);
    const bareMatch = !connMatch
      ? title.match(TRAILING_BARE_PLATFORM_RE)
      : null;
    const matchedSpan = connMatch ?? bareMatch;
    if (!matchedSpan || matchedSpan.index === undefined) break;
    const spanText = matchedSpan[0];
    for (const p of BOUTIQUE_PLATFORM_PATTERNS) {
      if (p.regex.test(spanText)) {
        const nextPid = mergeBoutiquePlatformId(platformId, p.id);
        if (nextPid !== platformId) {
          platformId = nextPid;
          ambiguousXbox = false;
        }
        break;
      }
    }
    title = (
      title.slice(0, matchedSpan.index) +
      title.slice(matchedSpan.index + spanText.length)
    )
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Fallback for bare "Xbox" (without 360 / One / Series): mark ambiguousXbox for tag/body/catalog resolution
  if (!platformId && BARE_XBOX_PLATFORM_REGEX.test(title)) {
    platformId = 49;
    ambiguousXbox = true;
    title = title.replace(BARE_XBOX_PLATFORM_REGEX, '').trim();
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
    ambiguousXbox,
    edition: matchedEdition,
    region: matchedRegion,
    isPreOrder,
    isGame,
  };
}

function resolveXboxDisambiguationFromText(
  initialPlatformId: number | null,
  wasAmbiguousXbox: boolean,
  contextText: string,
): { platformId: number | null; ambiguousXbox: boolean } {
  if (initialPlatformId !== 49 || !wasAmbiguousXbox) {
    return { platformId: initialPlatformId, ambiguousXbox: false };
  }
  if (/\b(?:Xbox\s+One|XB1)\b/i.test(contextText)) {
    return { platformId: 49, ambiguousXbox: false };
  }
  if (/\b(?:Xbox\s+Series\s+[XS](?:[|/]S)?|XSX)\b/i.test(contextText)) {
    return { platformId: 50, ambiguousXbox: false };
  }
  if (/\b(?:Xbox\s+360|X360)\b/i.test(contextText)) {
    return { platformId: 48, ambiguousXbox: false };
  }
  return { platformId: 49, ambiguousXbox: true };
}

function extractPlatformFromShopifyText(text: string): {
  platformId: number | null;
  ambiguousXbox: boolean;
} {
  if (!text) return { platformId: null, ambiguousXbox: false };
  for (const p of BOUTIQUE_PLATFORM_PATTERNS) {
    if (p.regex.test(text)) {
      return { platformId: p.id, ambiguousXbox: false };
    }
  }
  if (BARE_XBOX_PLATFORM_REGEX.test(text)) {
    return { platformId: 49, ambiguousXbox: true };
  }
  return { platformId: null, ambiguousXbox: false };
}

const BOX_SET_TITLE_RE =
  /\b(?:deluxe\s+limited\s+edition|box\s+set|anthology|collection\s+box)\b/i;

const BOX_SET_NON_GAME_LINE_RE =
  /\b(?:soundtrack|vinyl|2xlp|3xlp|folio|slipcover|book|artbook|art\s+book|box|case|bag|poster|print|certificate|limited\s+to|individually\s+numbered|cover|sleeve|manual|pin|sticker|patch|keychain|medallion|coin|postcards?|disc(?:s)?\s+for|cartridge(?:s)?\s+for|features?\b|includes?\b|packaging|per\s+customer|shipping|download\s+code|voucher)\b/i;

const BOX_SET_PROSE_SENTENCE_RE =
  /(?:\.\s+[A-Z]|^(?:featuring|reversible|region[- ]free|full[- ]color|collectible|custom\s+|physical\s+(?:copy|edition|cartridge|disc)|all\s+\d+\s+games)\b)/i;

function normalizeBoxSetBulletText(htmlFrag: string): string {
  return decodeHtmlEntities(htmlFrag.replace(/<[^>]+>/g, ' '))
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^[•\-*\u2022]+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isCleanBoxSetGameLine(text: string): boolean {
  if (text.length < 2) return false;
  if (BOX_SET_NON_GAME_LINE_RE.test(text)) return false;
  if (BOX_SET_PROSE_SENTENCE_RE.test(text)) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length >= 6 && /[.!]$/.test(text)) return false;
  return !isStorefrontNonGameOrMultiBoxBundle(text);
}

function extractTagGamePrefix(
  tagsRaw: string | string[] | undefined,
  cleanTitle: string,
): { baseTitle: string; edition: string } | null {
  const tagList = Array.isArray(tagsRaw)
    ? tagsRaw
    : typeof tagsRaw === 'string'
      ? tagsRaw.split(',')
      : [];
  for (const tag of tagList) {
    const trimmedTag = tag.trim();
    const m = trimmedTag.match(/^game_(.{2,})$/i);
    if (!m) continue;
    const tagTitle = decodeHtmlEntities(m[1].replace(/[-_]+/g, ' ')).trim();
    if (tagTitle.length < 2) continue;
    const normTag = tagTitle.toLowerCase();
    const normClean = cleanTitle.trim().toLowerCase();
    if (normClean.startsWith(normTag) && normClean.length > normTag.length) {
      const rest = cleanTitle.slice(tagTitle.length).trim();
      const edMatch = rest.match(/^(?:[:\-–—]\s*)?(.+\bEditions?)$/i);
      if (edMatch && cleanTitle[tagTitle.length]?.match(/[\s:\-–—]/)) {
        return {
          baseTitle: cleanTitle.slice(0, tagTitle.length).trim(),
          edition: edMatch[1].trim(),
        };
      }
    }
  }
  return null;
}

/**
 * Dynamically extracts constituent game titles from an explicit HTML `Includes` list
 * or clean leading game bullet list on multi-game boutique box sets (e.g. iam8bit's
 * `Annapurna Interactive Deluxe Limited Edition` across Switch/PS4/PS5 layouts)
 * without hardcoding game names or fragile character/item-count thresholds.
 * Returns `[]` unless `>= 2` clean game titles are found.
 */
export function extractBoxSetConstituentGameTitles(
  rawTitle: string,
  bodyHtml?: string | null,
): string[] {
  if (!rawTitle || !bodyHtml || !BOX_SET_TITLE_RE.test(rawTitle)) return [];

  const collectTitles = (
    rawItems: string[],
    requireAllClean: boolean,
  ): string[] => {
    if (rawItems.length < 2) return [];
    const titles: string[] = [];
    const seen = new Set<string>();
    for (const htmlFrag of rawItems) {
      const text = normalizeBoxSetBulletText(htmlFrag);
      if (!isCleanBoxSetGameLine(text)) {
        if (requireAllClean) return [];
        continue;
      }
      const cand = buildStructuralTitleCandidates(text)[0] ?? text;
      const key = cand.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        titles.push(cand);
      }
    }
    return titles.length >= 2 ? titles : [];
  };

  // Layout 1 & 2: Explicit Includes heading followed by <li> rows or standalone <div>/<p> rows
  const includesMatch = bodyHtml.match(
    /(?:games?\s+included|included\s+games|this\s+(?:collection|set)\s+includes|discs?\s+for\s*:|\bincludes\b\s*[:<])([\s\S]{10,4000})/i,
  );
  if (includesMatch) {
    const block = includesMatch[1];
    const liItems = Array.from(
      block.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi),
      (m) => m[1],
    );
    const liTitles = collectTitles(liItems, false);
    if (liTitles.length >= 2) return liTitles;

    // Layout 2 (e.g. PS4 Annapurna): standalone Includes heading followed by <div>/<p> rows or <br>-separated lines
    const headingStopped = block.split(/<h[1-6]\b/i)[0] || block;
    const blockItems = Array.from(
      headingStopped.matchAll(/<(?:div|p)[^>]*>([\s\S]*?)<\/(?:div|p)>/gi),
      (m) => m[1],
    );
    const divTitles = collectTitles(blockItems, false);
    if (divTitles.length >= 2) return divTitles;

    const brLines = headingStopped
      .split(/<br\s*\/?>/gi)
      .map((s) => s.trim())
      .filter(Boolean);
    const brTitles = collectTitles(brLines, false);
    if (brTitles.length >= 2) return brTitles;
  }

  // Layout 3: Leading <ul> before <p> — only accepted when 100% of bullets are clean game titles
  const leadingUlMatch = bodyHtml.match(/^\s*<ul[^>]*>([\s\S]*?)<\/ul>/i);
  const firstParagraphIdx = bodyHtml.search(/<p\b/i);
  if (
    leadingUlMatch &&
    leadingUlMatch.index !== undefined &&
    (firstParagraphIdx === -1 || leadingUlMatch.index < firstParagraphIdx)
  ) {
    const leadingItems = Array.from(
      leadingUlMatch[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi),
      (m) => m[1],
    );
    const leadingTitles = collectTitles(leadingItems, true);
    if (leadingTitles.length >= 2) return leadingTitles;
  }

  return [];
}

function parseShopifyBoutiqueItem(
  config: BoutiqueFeedConfig,
  item: ShopifyProductItem,
): BoutiquePreOrder[] {
  const rawTitle = item.title || '';
  const tagsStr = Array.isArray(item.tags)
    ? item.tags.join(' ')
    : typeof item.tags === 'string'
      ? item.tags
      : '';
  if (
    !rawTitle ||
    isStorefrontNonGameOrMultiBoxBundle(rawTitle, item.product_type, tagsStr)
  ) {
    return [];
  }

  const boxSetTitles = extractBoxSetConstituentGameTitles(
    rawTitle,
    item.body_html,
  );

  const baseCleaned = cleanBoutiqueTitle(rawTitle, { requirePlatform: false });
  if (!baseCleaned.isGame || baseCleaned.cleanTitle.length <= 1) {
    return [];
  }
  const tagGameOverride = extractTagGamePrefix(
    item.tags,
    baseCleaned.cleanTitle,
  );
  if (tagGameOverride) {
    baseCleaned.cleanTitle = tagGameOverride.baseTitle;
    if (!baseCleaned.edition) {
      baseCleaned.edition = tagGameOverride.edition;
    }
  }

  const xboxContext = `${rawTitle} ${item.product_type || ''} ${tagsStr}`;

  let isPre = baseCleaned.isPreOrder;
  if (!isPre && tagsStr) {
    isPre = /pre-?order/i.test(tagsStr);
  }

  const baseRegion =
    baseCleaned.region || STORE_DEFAULT_REGIONS[config.store] || null;
  const productUrl = `${config.baseUrl}/products/${item.handle}`;
  const imageUrl =
    Array.isArray(item.images) && item.images.length > 0
      ? item.images[0].src
      : undefined;

  const variants = Array.isArray(item.variants) ? item.variants : [];
  type VariantItem = NonNullable<ShopifyProductItem['variants']>[number];

  const computePricing = (groupVariants: VariantItem[]) => {
    const isAvailable =
      groupVariants.length > 0 &&
      groupVariants.some((v) => v.available !== false);
    let priceUsd: number | undefined;
    let priceCents: number | undefined;
    let regularPriceCents: number | undefined;
    let discountPct: number | undefined;
    let onSale: boolean | undefined;

    for (const v of groupVariants) {
      const rawPrice = parseFloat(String(v.price || ''));
      if (isNaN(rawPrice)) continue;
      const candUsd = config.isCad
        ? Math.round(rawPrice * DEFAULT_CAD_TO_USD_RATE * 100) / 100
        : rawPrice;
      const candCents = Math.round(candUsd * 100);
      if (priceCents === undefined || candCents < priceCents) {
        priceUsd = candUsd;
        priceCents = candCents;
        const rawCompare = parseFloat(String(v.compare_at_price || ''));
        if (!isNaN(rawCompare) && rawCompare > rawPrice) {
          const regUsd = config.isCad
            ? Math.round(rawCompare * DEFAULT_CAD_TO_USD_RATE * 100) / 100
            : rawCompare;
          regularPriceCents = Math.round(regUsd * 100);
          discountPct = Math.round(
            ((regularPriceCents - priceCents) / regularPriceCents) * 100,
          );
          onSale = discountPct > 0;
        } else {
          regularPriceCents = undefined;
          discountPct = undefined;
          onSale = undefined;
        }
      }
    }

    return {
      isAvailable,
      priceUsd,
      priceCents,
      regularPriceCents,
      discountPct,
      onSale,
    };
  };

  // Detect per-variant platforms when a single product page bundles Switch / PS4 / PS5 / Xbox variants
  const variantGroups = new Map<
    number,
    {
      platformId: number;
      ambiguousXbox: boolean;
      edition: string | null | undefined;
      variants: VariantItem[];
    }
  >();

  for (const v of variants) {
    const vTitle = (v.title || '').trim();
    if (!vTitle || /^default\s+title$/i.test(vTitle)) continue;
    const vParsed = cleanBoutiqueTitle(vTitle, { requirePlatform: false });
    if (!vParsed.platformId) continue;

    const resolvedXbox = resolveXboxDisambiguationFromText(
      vParsed.platformId,
      Boolean(vParsed.ambiguousXbox),
      `${vTitle} ${xboxContext}`,
    );
    const pid = resolvedXbox.platformId!;
    let grp = variantGroups.get(pid);
    if (!grp) {
      grp = {
        platformId: pid,
        ambiguousXbox: resolvedXbox.ambiguousXbox,
        edition: baseCleaned.edition || vParsed.edition,
        variants: [],
      };
      variantGroups.set(pid, grp);
    } else {
      grp.ambiguousXbox = grp.ambiguousXbox && resolvedXbox.ambiguousXbox;
    }
    grp.variants.push(v);
  }

  // Forward-compat guard: if a Shopify item contains both Xbox One (49) and XSX (50) variants, consolidate onto 49 only
  if (variantGroups.has(49) && variantGroups.has(50)) {
    const g49 = variantGroups.get(49)!;
    const g50 = variantGroups.get(50)!;
    g49.variants.push(...g50.variants);
    g49.ambiguousXbox = false;
    variantGroups.delete(50);
  }

  const expandBoxSet = (entries: BoutiquePreOrder[]): BoutiquePreOrder[] => {
    if (boxSetTitles.length < 2) return entries;
    const expanded: BoutiquePreOrder[] = [];
    for (const entry of entries) {
      boxSetTitles.forEach((constituentTitle, idx) => {
        expanded.push({
          ...entry,
          id: `${entry.id}_box_${idx}`,
          cleanTitle: constituentTitle,
          edition: entry.edition || 'Box Set',
        });
      });
    }
    return expanded;
  };

  if (variantGroups.size > 0) {
    const multiPlatform = variantGroups.size > 1;
    const out: BoutiquePreOrder[] = [];
    for (const grp of variantGroups.values()) {
      const pricing = computePricing(grp.variants);
      out.push({
        store: config.store,
        id: multiPlatform
          ? `${config.store}_${item.id}_${grp.platformId}`
          : `${config.store}_${item.id}`,
        rawTitle,
        cleanTitle: baseCleaned.cleanTitle,
        platformId: grp.platformId,
        ...(grp.ambiguousXbox ? { ambiguousXbox: true } : {}),
        productUrl,
        imageUrl,
        priceUsd: pricing.priceUsd,
        priceCents: pricing.priceCents,
        regularPriceCents: pricing.regularPriceCents,
        discountPct: pricing.discountPct,
        onSale: pricing.onSale,
        edition: grp.edition,
        region: baseRegion,
        isAvailable: pricing.isAvailable,
        isPreOrder: isPre,
        publishedAt: item.published_at || item.created_at,
      });
    }
    return expandBoxSet(out);
  }

  // Single-platform fallback: rawTitle platform -> product_type -> unambiguous single-platform tags
  let resolvedPid = baseCleaned.platformId;
  let resolvedAmbiguous = Boolean(baseCleaned.ambiguousXbox);
  if (resolvedPid === null && item.product_type) {
    const typeHit = extractPlatformFromShopifyText(item.product_type);
    resolvedPid = typeHit.platformId;
    resolvedAmbiguous = typeHit.ambiguousXbox;
  }
  if (resolvedPid === null && tagsStr) {
    const tagPlatforms = extractAllPlatformIds(tagsStr);
    const nonXboxSeriesCollapsed = Array.from(
      new Set(
        tagPlatforms.map((id) =>
          id === 50 && tagPlatforms.includes(49) ? 49 : id,
        ),
      ),
    );
    if (nonXboxSeriesCollapsed.length === 1) {
      resolvedPid = nonXboxSeriesCollapsed[0];
      resolvedAmbiguous = false;
    } else if (tagPlatforms.length === 0) {
      const bareHit = extractPlatformFromShopifyText(tagsStr);
      resolvedPid = bareHit.platformId;
      resolvedAmbiguous = bareHit.ambiguousXbox;
    }
  }
  if (resolvedPid === null) {
    return [];
  }

  const finalXbox = resolveXboxDisambiguationFromText(
    resolvedPid,
    resolvedAmbiguous,
    xboxContext,
  );
  const pricing = computePricing(variants);

  return expandBoxSet([
    {
      store: config.store,
      id: `${config.store}_${item.id}`,
      rawTitle,
      cleanTitle: baseCleaned.cleanTitle,
      platformId: finalXbox.platformId,
      ...(finalXbox.ambiguousXbox ? { ambiguousXbox: true } : {}),
      productUrl,
      imageUrl,
      priceUsd: pricing.priceUsd,
      priceCents: pricing.priceCents,
      regularPriceCents: pricing.regularPriceCents,
      discountPct: pricing.discountPct,
      onSale: pricing.onSale,
      edition: baseCleaned.edition,
      region: baseRegion,
      isAvailable: pricing.isAvailable,
      isPreOrder: isPre,
      publishedAt: item.published_at || item.created_at,
    },
  ]);
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
            const parsedItems = parseShopifyBoutiqueItem(config, item);
            if (parsedItems.length > 0) results.push(...parsedItems);
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
  /\b(roundup|weekly\s+(?:recap|deals?)|free\s+shipping\s+deals?|giveaway|contest|podcast|shipping\s+update|flash\s+sale|newsletter|interview|merchandise\s+drop|shipping\s+schedule)\b/i;

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
  // Dual Xbox One + Xbox Series X announcements belong strictly to Xbox One (49)
  if (found.includes(49) && found.includes(50)) {
    return found.filter((id) => id !== 50);
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
          isStorefrontNonGameOrMultiBoxBundle(decodedHeadline) ||
          !cleaned.cleanTitle ||
          cleaned.cleanTitle.length < 2
        ) {
          continue;
        }

        const headlinePlatforms = extractAllPlatformIds(decodedHeadline);
        const categoryMatchedPlatforms = catIds
          .map((id) => categoryPlatforms.get(id))
          .filter((id): id is number => id !== undefined);
        const excerptPlatforms =
          headlinePlatforms.length === 0 &&
          categoryMatchedPlatforms.length === 0
            ? extractAllPlatformIds(decodedExcerpt)
            : [];
        const platformIds = Array.from(
          new Set(
            headlinePlatforms.length > 0
              ? headlinePlatforms
              : categoryMatchedPlatforms.length > 0
                ? categoryMatchedPlatforms
                : cleaned.platformId !== null
                  ? [cleaned.platformId]
                  : excerptPlatforms,
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
