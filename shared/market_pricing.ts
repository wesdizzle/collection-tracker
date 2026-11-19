/**
 * ISOMORPHIC MARKET PRICING & EBAY VALUATION ENGINE
 *
 * Pure TypeScript module shared between the Cloudflare Worker and Angular SPA.
 * Enforces eBay API License Agreement freshness constraints (strict 6-hour TTL)
 * and performs deterministic query construction, noise filtering, platform-aware
 * condition bucketing, and IQR active-floor estimation.
 */

export type MarketPriceItemType = 'game' | 'toy';
export type MarketPriceConfidence = 'high' | 'medium' | 'low';
export type MarketPriceConditionBucket = 'loose' | 'cib' | 'new';

export const EBAY_PRICE_TTL_MS = 6 * 60 * 60 * 1000;
export const PRICE_CACHE_SHARD_COUNT = 8;
export const EBAY_VIDEO_GAMES_CATEGORY_ID = '139973';
export const EBAY_TOYS_TO_LIFE_CATEGORY_ID = '182180';

export interface EbaySampleListing {
  title: string;
  totalCents: number;
  url: string;
  condition: MarketPriceConditionBucket;
}

export interface EphemeralMarketPrice {
  item_type: MarketPriceItemType;
  item_id: string;
  loose_cents: number | null;
  cib_cents: number | null;
  new_cents: number | null;
  loose_sample_size: number;
  cib_sample_size: number;
  new_sample_size: number;
  confidence: MarketPriceConfidence | null;
  source: 'ebay_browse';
  fetched_at: string;
  expires_at: string;
  query_used: string;
  sample_listings: {
    loose: EbaySampleListing[];
    cib: EbaySampleListing[];
    new: EbaySampleListing[];
  };
  last_error?: string | null;
}

export interface PriceCacheShardPayload {
  updatedAt: string;
  items: Record<string, EphemeralMarketPrice>;
}

export interface EbayItemSummary {
  itemId?: string;
  title?: string;
  price?: {
    value?: string | number;
    currency?: string;
  };
  shippingOptions?: Array<{
    shippingCostType?: string;
    shippingCost?: {
      value?: string | number;
      currency?: string;
    };
  }>;
  condition?: string;
  conditionId?: string;
  buyingOptions?: string[];
  itemGroupType?: string;
  itemWebUrl?: string;
}

export interface PricingItemDescriptor {
  itemType: MarketPriceItemType;
  itemId: string;
  title: string;
  platformId?: number | null;
  platformName?: string | null;
  region?: string | null;
  barcode?: string | null;
  toyLine?: string | null;
  toyType?: string | null;
  toySeries?: string | null;
}

export interface EbaySearchPlan {
  primaryQuery: {
    q?: string;
    gtin?: string;
    categoryId: string;
  };
  fallbackQuery?: {
    q: string;
    categoryId: string;
  };
  displayQuery: string;
}

export interface NormalizedEbayListing {
  title: string;
  totalCents: number;
  url: string;
  bucket: MarketPriceConditionBucket;
}

export interface MarketValuationSummary {
  loose_cents: number | null;
  cib_cents: number | null;
  new_cents: number | null;
  loose_sample_size: number;
  cib_sample_size: number;
  new_sample_size: number;
  confidence: MarketPriceConfidence | null;
  sample_listings: {
    loose: EbaySampleListing[];
    cib: EbaySampleListing[];
    new: EbaySampleListing[];
  };
}

/** Retro bare-cartridge platforms where unspecified Used listings default to Loose. */
const BARE_CART_PLATFORM_IDS = new Set<number>([
  2, // Atari 2600
  3, // Atari 5200
  4, // Atari 7800
  5, // Atari Lynx
  6, // Atari Jaguar
  7, // ColecoVision
  8, // Intellivision
  9, // Neo Geo AES
  11, // Neo Geo Pocket Color
  13, // NES
  14, // Game Boy
  15, // SNES
  16, // Virtual Boy
  17, // Nintendo 64
  18, // Game Boy Color
  19, // Game Boy Advance
  36, // Sega Master System
  37, // Sega Genesis
  38, // Sega Game Gear
  41, // Sega 32X
  44, // Game.com
  45, // TurboGrafx-16
  53, // Famicom
  54, // Famicom Disk System
  55, // Nintendo 64DD
]);

/** Modern optical/card cased platforms where retail releases routinely omit paper manuals. */
const MODERN_CASED_NO_MANUAL_PLATFORM_IDS = new Set<number>([
  26, // Nintendo Switch
  27, // Nintendo Switch 2
  33, // PlayStation Vita
  34, // PlayStation 4
  35, // PlayStation 5
  49, // Xbox One
  50, // Xbox Series X
  51, // PlayStation VR
  52, // PlayStation VR2
]);

const PLATFORM_SEARCH_ALIASES: Record<number, { usa: string; alt?: string }> = {
  1: { usa: '3DO' },
  2: { usa: 'Atari 2600' },
  3: { usa: 'Atari 5200' },
  4: { usa: 'Atari 7800' },
  5: { usa: 'Atari Lynx' },
  6: { usa: 'Atari Jaguar' },
  7: { usa: 'ColecoVision' },
  8: { usa: 'Intellivision' },
  9: { usa: 'Neo Geo AES' },
  10: { usa: 'Neo Geo CD' },
  11: { usa: 'Neo Geo Pocket Color' },
  12: { usa: 'Neo Geo X' },
  13: { usa: 'NES', alt: 'Famicom' },
  14: { usa: 'Game Boy' },
  15: { usa: 'SNES', alt: 'Super Famicom' },
  16: { usa: 'Virtual Boy' },
  17: { usa: 'Nintendo 64' },
  18: { usa: 'Game Boy Color' },
  19: { usa: 'Game Boy Advance' },
  20: { usa: 'GameCube' },
  21: { usa: 'Nintendo DS' },
  22: { usa: 'Nintendo Wii' },
  23: { usa: 'Nintendo 3DS' },
  24: { usa: 'Wii U' },
  25: { usa: 'New 3DS' },
  26: { usa: 'Nintendo Switch' },
  27: { usa: 'Nintendo Switch 2' },
  28: { usa: 'Philips CD-i' },
  29: { usa: 'PS1' },
  30: { usa: 'PS2' },
  31: { usa: 'PSP' },
  32: { usa: 'PS3' },
  33: { usa: 'PS Vita' },
  34: { usa: 'PS4' },
  35: { usa: 'PS5' },
  36: { usa: 'Sega Master System' },
  37: { usa: 'Sega Genesis', alt: 'Mega Drive' },
  38: { usa: 'Sega Game Gear' },
  39: { usa: 'Sega CD', alt: 'Mega CD' },
  40: { usa: 'Sega Pico' },
  41: { usa: 'Sega 32X' },
  42: { usa: 'Sega Saturn' },
  43: { usa: 'Dreamcast' },
  44: { usa: 'Game.com' },
  45: { usa: 'TurboGrafx 16', alt: 'PC Engine' },
  46: { usa: 'TurboGrafx CD', alt: 'PC Engine CD' },
  47: { usa: 'Original Xbox' },
  48: { usa: 'Xbox 360' },
  49: { usa: 'Xbox One' },
  50: { usa: 'Xbox Series X' },
  51: { usa: 'PSVR PS4' },
  52: { usa: 'PSVR2 PS5' },
  53: { usa: 'Famicom' },
  54: { usa: 'Famicom Disk System' },
  55: { usa: 'Nintendo 64DD' },
};

const TITLE_STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'edition',
  'version',
  'game',
  'video',
  'nintendo',
  'playstation',
  'xbox',
  'sega',
]);

const ROMAN_NUMERAL_TO_ARABIC: Record<string, string> = {
  i: '1',
  ii: '2',
  iii: '3',
  iv: '4',
  v: '5',
  vi: '6',
  vii: '7',
  viii: '8',
  ix: '9',
  x: '10',
  xi: '11',
  xii: '12',
  xiii: '13',
  xiv: '14',
  xv: '15',
  xvi: '16',
};

const MULTI_VARIATION_TITLE_RE =
  /\b(pick your|choose your|you pick|u pick|complete your collection|buy \d+ get \d+|lot of|bundle of|collection of|set of \d+|wholesale lot)\b/i;

const GAME_NOISE_TITLE_RE =
  /\b(manual only|instruction manual|booklet only|case only|box only|empty case|empty box|empty dvd|replacement case|replacement box|cover art only|insert only|artwork only|no game|no disc|no cartridge|no cart|disc not included|cart not included|game not included|steelbook only|repro|reproduction|homebrew|custom made|custom case|for parts|not working|broken|untested|read description|read desc|digital code|download code|voucher only|dlc code|strategy guide|official guide|players guide|player's guide|soundtrack|ost cd|poster only|plush|action figure|amiibo)\b/i;

const TOY_COMMON_NOISE_RE =
  /\b(lot of|bundle|custom|repro|reproduction|nfc|coin|coins|tag|tags|empty box|box only|packaging only|poster|for parts|broken)\b/i;

const TOY_NON_CARD_NOISE_RE = /\b(card|cards)\b/i;
const TOY_CARD_NOISE_RE =
  /\b(booster|sealed pack|factory sealed box|complete set|full set|album|binder)\b/i;
const SKYLANDERS_NOISE_RE = /\b(portal of power|portal only|starter pack)\b/i;
const STARLINK_NOISE_RE = /\b(starter pack|controller mount|mount only)\b/i;

const IMPORT_JAPAN_RE =
  /\b(japan|japanese|jpn|ntsc-j|ntsc j|famicom|super famicom)\b/i;
const IMPORT_PAL_RE = /\b(pal|uk version|eur version|pegi|european version)\b/i;

const SEALED_TITLE_RE =
  /\b(brand new|factory sealed|new sealed|sealed|nib|bnib|new in box)\b/i;
const NOT_SEALED_OVERRIDE_RE =
  /\b(unsealed|open box|opened|like new|used|pre-owned|preowned|resealed)\b/i;

const EXPLICIT_LOOSE_RE =
  /\b(loose|disc only|disk only|cart only|cartridge only|game only|card only|no case|no box|without case|without box|bare cart|generic case|gamestop case)\b/i;

const EXPLICIT_CIB_RE =
  /\b(cib|complete in box|complete|with manual|w\/\s*manual|with box|in box|case\s*(?:&|and)\s*manual|box\s*(?:&|and)\s*manual|with case\s*(?:&|and)\s*manual|includes manual|authentic complete)\b/i;

const MISSING_MANUAL_RE =
  /\b(no manual|missing manual|without manual|no booklet|missing booklet|no instructions)\b/i;

export function getMarketPriceKey(
  itemType: MarketPriceItemType,
  itemId: string,
): string {
  return `${itemType}:${itemId}`;
}

export function getPriceShardIndex(
  itemType: MarketPriceItemType,
  itemId: string,
): number {
  const input = getMarketPriceKey(itemType, itemId);
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % PRICE_CACHE_SHARD_COUNT;
}

export function isMarketPriceFresh(
  price: Pick<EphemeralMarketPrice, 'expires_at'> | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!price?.expires_at) return false;
  const expiresMs = Date.parse(price.expires_at);
  return Number.isFinite(expiresMs) && expiresMs > nowMs;
}

export function formatPriceAge(
  fetchedAt: string | null | undefined,
  expiresAt?: string | null | undefined,
  nowMs: number = Date.now(),
): string {
  if (!fetchedAt) return 'Live check required';
  const fetchedMs = Date.parse(fetchedAt);
  if (!Number.isFinite(fetchedMs)) return 'Unknown age';

  const ageMins = Math.max(0, Math.floor((nowMs - fetchedMs) / 60_000));
  const ageLabel =
    ageMins < 1
      ? 'just now'
      : ageMins < 60
        ? `${ageMins}m ago`
        : `${Math.floor(ageMins / 60)}h ${ageMins % 60}m ago`;

  if (!expiresAt) return `Live eBay active listings · ${ageLabel}`;
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) {
    return `Expired (${ageLabel})`;
  }
  const remMins = Math.max(1, Math.ceil((expiresMs - nowMs) / 60_000));
  const remLabel =
    remMins < 60
      ? `${remMins}m`
      : `${Math.floor(remMins / 60)}h ${remMins % 60}m`;

  return `Live eBay active listings · ${ageLabel} · expires in ${remLabel}`;
}

function cleanQueryText(raw: string): string {
  return raw
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[™®©]/g, '')
    .replace(/[:/\\|—–-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanToyQueryText(raw: string): string {
  return raw
    .replace(/[()[\]]/g, ' ')
    .replace(/[™®©]/g, '')
    .replace(/[:/\\|—–-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isJapanOnlyRegion(region: string | null | undefined): boolean {
  if (!region) return false;
  const lower = region.toLowerCase();
  return (
    (lower.includes('japan') || lower.includes('jp')) &&
    !lower.includes('usa') &&
    !lower.includes('world') &&
    !lower.includes('north america')
  );
}

function isPalOnlyRegion(region: string | null | undefined): boolean {
  if (!region) return false;
  const lower = region.toLowerCase();
  return (
    (lower.includes('europe') ||
      lower.includes('pal') ||
      lower.includes('uk') ||
      lower.includes('australia')) &&
    !lower.includes('usa') &&
    !lower.includes('world') &&
    !lower.includes('north america')
  );
}

function resolvePlatformSearchLabel(item: PricingItemDescriptor): string {
  const pid = item.platformId ?? null;
  if (pid && PLATFORM_SEARCH_ALIASES[pid]) {
    const alias = PLATFORM_SEARCH_ALIASES[pid];
    if (
      alias.alt &&
      (isJapanOnlyRegion(item.region) ||
        (pid !== 13 && pid !== 15 && isPalOnlyRegion(item.region)))
    ) {
      return alias.alt;
    }
    return alias.usa;
  }
  const cleaned = cleanQueryText(item.platformName || '');
  return cleaned;
}

function normalizeSkylandersQueryQualifier(
  toyType: string | null | undefined,
  toySeries: string | null | undefined,
): string {
  const raw = (toyType || '').replace(/[*]+/g, '').trim();
  const lower = raw.toLowerCase();
  if (!raw || lower === 'series 1' || lower === 'series 1.5') {
    return toySeries && !/spyro/i.test(toySeries) ? toySeries : '';
  }
  if (lower === 'sidekicks') return 'Sidekick';
  if (lower === 'magic item' || lower === 'mini') return '';
  return raw;
}

export function buildEbaySearchPlan(
  item: PricingItemDescriptor,
  customQuery?: string | null,
): EbaySearchPlan {
  const categoryId =
    item.itemType === 'toy'
      ? EBAY_TOYS_TO_LIFE_CATEGORY_ID
      : EBAY_VIDEO_GAMES_CATEGORY_ID;

  const trimmedOverride = (customQuery || '').trim();
  if (trimmedOverride) {
    return {
      primaryQuery: { q: trimmedOverride, categoryId },
      displayQuery: trimmedOverride,
    };
  }

  let keywordQuery: string;

  if (item.itemType === 'toy') {
    const cleanName = cleanToyQueryText(item.title);
    const line = (item.toyLine || '').trim().toLowerCase();
    const type = (item.toyType || '').trim();
    const series = (item.toySeries || '').trim();

    if (line === 'amiibo') {
      if (type === 'Card') {
        keywordQuery = `${cleanName} amiibo card`;
      } else if (type === 'Yarn') {
        keywordQuery = `${cleanName} yarn amiibo`;
      } else if (type === 'Band') {
        keywordQuery = `${cleanName} power up band amiibo`;
      } else if (type === 'Block') {
        keywordQuery = `${cleanName} wooden block amiibo`;
      } else if (
        series &&
        /^(mario|link|luigi|peach|yoshi|zelda|bowser|kirby|donkey kong)$/i.test(
          cleanName,
        )
      ) {
        keywordQuery = `${cleanName} ${cleanQueryText(series)} amiibo`;
      } else {
        keywordQuery = `${cleanName} amiibo`;
      }
    } else if (line === 'skylanders') {
      const qualifier = normalizeSkylandersQueryQualifier(type, series);
      keywordQuery = [cleanName, 'Skylanders', qualifier]
        .filter(Boolean)
        .join(' ');
    } else if (line === 'starlink') {
      keywordQuery = [cleanName, 'Starlink', type].filter(Boolean).join(' ');
    } else {
      keywordQuery = [cleanName, cleanQueryText(item.toyLine || '')]
        .filter(Boolean)
        .join(' ');
    }
  } else {
    const cleanTitle = cleanQueryText(item.title);
    const platformLabel = resolvePlatformSearchLabel(item);
    const regionHint = isJapanOnlyRegion(item.region)
      ? 'Japan'
      : isPalOnlyRegion(item.region)
        ? 'PAL'
        : '';
    keywordQuery = [cleanTitle, platformLabel, regionHint]
      .filter(Boolean)
      .join(' ');
  }

  const cleanBarcode = (item.barcode || '').replace(/\D/g, '');
  if (cleanBarcode.length >= 8 && cleanBarcode.length <= 14) {
    return {
      primaryQuery: { gtin: cleanBarcode, categoryId },
      fallbackQuery: { q: keywordQuery, categoryId },
      displayQuery: keywordQuery,
    };
  }

  return {
    primaryQuery: { q: keywordQuery, categoryId },
    displayQuery: keywordQuery,
  };
}

function tokenizeComparableWords(
  text: string,
  preserveParentheticals = false,
): string[] {
  const cleaned = preserveParentheticals
    ? cleanToyQueryText(text)
    : cleanQueryText(text);
  return cleaned
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/\s+/)
    .map((tok) => ROMAN_NUMERAL_TO_ARABIC[tok] ?? tok)
    .filter(Boolean);
}

function extractSequelNumbers(
  tokens: string[],
  ignoredPlatformNumbers: Set<string>,
): Set<string> {
  const nums = new Set<string>();
  for (const tok of tokens) {
    if (/^\d{1,2}$/.test(tok) && !ignoredPlatformNumbers.has(tok)) {
      nums.add(tok);
    }
  }
  return nums;
}

function matchesTargetTitle(
  listingTitle: string,
  item: PricingItemDescriptor,
): boolean {
  const targetTokensRaw = tokenizeComparableWords(
    item.title,
    item.itemType === 'toy',
  );
  const significantTargetTokens = targetTokensRaw.filter(
    (t) => t.length >= 3 && !TITLE_STOP_WORDS.has(t),
  );
  const targetForMatch =
    significantTargetTokens.length > 0
      ? significantTargetTokens
      : targetTokensRaw;

  if (targetForMatch.length === 0) return true;

  const listingTokens = tokenizeComparableWords(listingTitle, true);
  const listingSet = new Set(listingTokens);

  let matchedCount = 0;
  for (const tok of targetForMatch) {
    if (listingSet.has(tok)) {
      matchedCount++;
    }
  }

  const requiredRatio = targetForMatch.length <= 2 ? 1.0 : 0.6;
  if (matchedCount / targetForMatch.length < requiredRatio) {
    return false;
  }

  // Guard against sequel cross-contamination (e.g. "Final Fantasy 7" vs "Final Fantasy 8")
  const platformTokens = new Set(
    tokenizeComparableWords(resolvePlatformSearchLabel(item)),
  );
  const targetNums = extractSequelNumbers(targetTokensRaw, platformTokens);
  if (targetNums.size > 0) {
    for (const num of targetNums) {
      if (!listingSet.has(num)) {
        return false;
      }
    }
  }

  return true;
}

function computeLandedCents(summary: EbayItemSummary): number | null {
  const priceVal = Number(summary.price?.value);
  const currency = (summary.price?.currency || 'USD').toUpperCase();
  if (!Number.isFinite(priceVal) || priceVal <= 0 || currency !== 'USD') {
    return null;
  }
  const baseCents = Math.round(priceVal * 100);

  const shipOpt = summary.shippingOptions?.[0];
  if (!shipOpt) return baseCents;

  const shipCurrency = (shipOpt.shippingCost?.currency || 'USD').toUpperCase();
  if (shipOpt.shippingCost?.value !== undefined && shipCurrency !== 'USD') {
    return null;
  }

  const shipVal = Number(shipOpt.shippingCost?.value);
  if (Number.isFinite(shipVal) && shipVal >= 0) {
    return baseCents + Math.round(shipVal * 100);
  }

  if (shipOpt.shippingCostType === 'FREE') {
    return baseCents;
  }

  // Conservative $5 shipping floor for calculated shipping when eBay omits an exact figure
  if (shipOpt.shippingCostType === 'CALCULATED') {
    return baseCents + 500;
  }

  return baseCents;
}

export function classifyListingCondition(
  summary: EbayItemSummary,
  item: PricingItemDescriptor,
): MarketPriceConditionBucket | null {
  const title = (summary.title || '').trim();
  const condId = String(summary.conditionId || '').trim();

  if (condId === '7000') return null;

  const isExplicitlyNotNew = NOT_SEALED_OVERRIDE_RE.test(title);
  if (
    condId === '1000' ||
    (SEALED_TITLE_RE.test(title) && !isExplicitlyNotNew)
  ) {
    return 'new';
  }

  if (item.itemType === 'toy') {
    return 'loose';
  }

  if (EXPLICIT_LOOSE_RE.test(title)) {
    return 'loose';
  }

  if (MISSING_MANUAL_RE.test(title)) {
    // Boxed without manual is neither pure Loose nor true CIB
    return null;
  }

  if (EXPLICIT_CIB_RE.test(title)) {
    return 'cib';
  }

  const pid = item.platformId ?? null;
  if (pid && BARE_CART_PLATFORM_IDS.has(pid)) {
    return 'loose';
  }

  if (pid && MODERN_CASED_NO_MANUAL_PLATFORM_IDS.has(pid)) {
    return 'cib';
  }

  // Classic optical/cased systems: only promote unspecified Used listings to CIB if Like New + box/case mention
  if (condId === '2750' && /\b(case|box)\b/i.test(title)) {
    return 'cib';
  }

  return null;
}

export function filterAndNormalizeEbaySummaries(
  summaries: EbayItemSummary[],
  item: PricingItemDescriptor,
  options: { skipTitleMatch?: boolean } = {},
): NormalizedEbayListing[] {
  const results: NormalizedEbayListing[] = [];
  const expectJapan = isJapanOnlyRegion(item.region);
  const expectPal = isPalOnlyRegion(item.region);
  const isToyCard =
    item.itemType === 'toy' && (item.toyType || '').trim() === 'Card';
  const toyLine = (item.toyLine || '').trim().toLowerCase();

  for (const s of summaries) {
    const title = (s.title || '').trim();
    if (!title) continue;
    if (s.itemGroupType === 'SELLER_DEFINED_VARIATIONS') continue;
    if (
      Array.isArray(s.buyingOptions) &&
      s.buyingOptions.length > 0 &&
      !s.buyingOptions.includes('FIXED_PRICE')
    ) {
      continue;
    }

    if (MULTI_VARIATION_TITLE_RE.test(title)) continue;

    if (item.itemType === 'game') {
      if (GAME_NOISE_TITLE_RE.test(title)) continue;
      if (!expectJapan && IMPORT_JAPAN_RE.test(title)) continue;
      if (!expectPal && IMPORT_PAL_RE.test(title)) continue;
    } else {
      if (TOY_COMMON_NOISE_RE.test(title)) continue;
      if (!isToyCard && TOY_NON_CARD_NOISE_RE.test(title)) continue;
      if (isToyCard && TOY_CARD_NOISE_RE.test(title)) continue;
      if (toyLine === 'skylanders' && SKYLANDERS_NOISE_RE.test(title)) continue;
      if (toyLine === 'starlink' && STARLINK_NOISE_RE.test(title)) continue;
    }

    if (!options.skipTitleMatch && !matchesTargetTitle(title, item)) {
      continue;
    }

    const totalCents = computeLandedCents(s);
    if (totalCents === null || totalCents <= 0) continue;

    const bucket = classifyListingCondition(s, item);
    if (!bucket) continue;

    results.push({
      title,
      totalCents,
      url:
        s.itemWebUrl ||
        `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(title)}`,
      bucket,
    });
  }

  return results;
}

function interpolatePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const frac = idx - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

export function computeBucketValuation(listings: NormalizedEbayListing[]): {
  cents: number | null;
  sampleSize: number;
  samples: EbaySampleListing[];
} {
  if (listings.length === 0) {
    return { cents: null, sampleSize: 0, samples: [] };
  }

  const sorted = [...listings].sort((a, b) => a.totalCents - b.totalCents);
  if (sorted.length < 3) {
    const median = Math.round(
      interpolatePercentile(
        sorted.map((x) => x.totalCents),
        0.5,
      ),
    );
    return {
      cents: median,
      sampleSize: sorted.length,
      samples: sorted.slice(0, 2).map((l) => ({
        title: l.title,
        totalCents: l.totalCents,
        url: l.url,
        condition: l.bucket,
      })),
    };
  }

  const values = sorted.map((x) => x.totalCents);
  const q1 = interpolatePercentile(values, 0.25);
  const q3 = interpolatePercentile(values, 0.75);
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;

  const cleaned = sorted.filter(
    (x) => x.totalCents >= lowerFence && x.totalCents <= upperFence,
  );
  const pool = cleaned.length > 0 ? cleaned : sorted;
  const floorCents = Math.round(
    interpolatePercentile(
      pool.map((x) => x.totalCents),
      0.25,
    ),
  );

  return {
    cents: floorCents,
    sampleSize: pool.length,
    samples: pool.slice(0, 2).map((l) => ({
      title: l.title,
      totalCents: l.totalCents,
      url: l.url,
      condition: l.bucket,
    })),
  };
}

export function computeMarketValuation(
  summaries: EbayItemSummary[],
  item: PricingItemDescriptor,
  options: { skipTitleMatch?: boolean } = {},
): MarketValuationSummary {
  const normalized = filterAndNormalizeEbaySummaries(summaries, item, options);
  const looseBucket = normalized.filter((l) => l.bucket === 'loose');
  const cibBucket = normalized.filter((l) => l.bucket === 'cib');
  const newBucket = normalized.filter((l) => l.bucket === 'new');

  const loose = computeBucketValuation(looseBucket);
  const cib =
    item.itemType === 'toy'
      ? { cents: null, sampleSize: 0, samples: [] }
      : computeBucketValuation(cibBucket);
  const sealed = computeBucketValuation(newBucket);

  const primarySample =
    item.itemType === 'toy'
      ? Math.max(loose.sampleSize, sealed.sampleSize)
      : Math.max(cib.sampleSize, loose.sampleSize, sealed.sampleSize);

  const confidence: MarketPriceConfidence | null =
    primarySample === 0
      ? null
      : primarySample >= 10
        ? 'high'
        : primarySample >= 4
          ? 'medium'
          : 'low';

  return {
    loose_cents: loose.cents,
    cib_cents: cib.cents,
    new_cents: sealed.cents,
    loose_sample_size: loose.sampleSize,
    cib_sample_size: cib.sampleSize,
    new_sample_size: sealed.sampleSize,
    confidence,
    sample_listings: {
      loose: loose.samples,
      cib: cib.samples,
      new: sealed.samples,
    },
  };
}

export function buildEphemeralMarketPrice(
  item: PricingItemDescriptor,
  valuation: MarketValuationSummary,
  queryUsed: string,
  nowMs: number = Date.now(),
  lastError: string | null = null,
): EphemeralMarketPrice {
  return {
    item_type: item.itemType,
    item_id: item.itemId,
    loose_cents: valuation.loose_cents,
    cib_cents: valuation.cib_cents,
    new_cents: valuation.new_cents,
    loose_sample_size: valuation.loose_sample_size,
    cib_sample_size: valuation.cib_sample_size,
    new_sample_size: valuation.new_sample_size,
    confidence: valuation.confidence,
    source: 'ebay_browse',
    fetched_at: new Date(nowMs).toISOString(),
    expires_at: new Date(nowMs + EBAY_PRICE_TTL_MS).toISOString(),
    query_used: queryUsed,
    sample_listings: valuation.sample_listings,
    last_error: lastError,
  };
}

export function computeItemEstimatedValueCents(
  item: {
    has_case?: boolean | number | null;
    has_manual?: boolean | number | null;
    ownership_status?: number | null;
  },
  price:
    | Pick<
        EphemeralMarketPrice,
        'item_type' | 'loose_cents' | 'cib_cents' | 'new_cents'
      >
    | null
    | undefined,
): { cents: number | null; tierLabel: string } {
  if (!price) return { cents: null, tierLabel: 'Unpriced' };

  if (price.item_type === 'toy') {
    if (price.loose_cents !== null) {
      return { cents: price.loose_cents, tierLabel: 'Loose' };
    }
    if (price.new_cents !== null) {
      return { cents: price.new_cents, tierLabel: 'New / Sealed' };
    }
    return { cents: null, tierLabel: 'No Comps' };
  }

  const isOwned = Number(item.ownership_status ?? 0) === 1;
  const hasCase = Boolean(item.has_case);
  const hasManual = Boolean(item.has_manual);

  if (!isOwned) {
    if (price.cib_cents !== null) {
      return { cents: price.cib_cents, tierLabel: 'CIB' };
    }
    if (price.loose_cents !== null) {
      return { cents: price.loose_cents, tierLabel: 'Loose' };
    }
    if (price.new_cents !== null) {
      return { cents: price.new_cents, tierLabel: 'New' };
    }
    return { cents: null, tierLabel: 'No Comps' };
  }

  if (hasCase && hasManual) {
    if (price.cib_cents !== null) {
      return { cents: price.cib_cents, tierLabel: 'CIB' };
    }
    if (price.loose_cents !== null) {
      return { cents: price.loose_cents, tierLabel: 'Loose (est.)' };
    }
    return { cents: null, tierLabel: 'No Comps' };
  }

  if (hasCase && !hasManual) {
    if (price.loose_cents !== null && price.cib_cents !== null) {
      return {
        cents: Math.round((price.loose_cents + price.cib_cents) / 2),
        tierLabel: 'Boxed (est.)',
      };
    }
    if (price.cib_cents !== null) {
      return { cents: price.cib_cents, tierLabel: 'CIB (est.)' };
    }
    if (price.loose_cents !== null) {
      return { cents: price.loose_cents, tierLabel: 'Loose (est.)' };
    }
    return { cents: null, tierLabel: 'No Comps' };
  }

  if (price.loose_cents !== null) {
    return { cents: price.loose_cents, tierLabel: 'Loose' };
  }
  if (price.cib_cents !== null) {
    return { cents: price.cib_cents, tierLabel: 'CIB (est.)' };
  }
  return { cents: null, tierLabel: 'No Comps' };
}
