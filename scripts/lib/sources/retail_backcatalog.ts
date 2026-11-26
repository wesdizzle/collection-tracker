/**
 * RETAIL & BOUTIQUE BACK-CATALOG OFFLINE SOURCE ADAPTER
 *
 * Fetches full paginated boutique publisher catalogs (LRG, Super Rare Games,
 * Strictly Limited, Silver Lining Direct, First Press Games, etc.), Limited Game
 * News Asian-English / limited print announcements, and VGP + PNP Games pre-order
 * & catalog feeds into `data/sources/retail_backcatalog.json`.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  CanonicalRelease,
  isCanonicalNoiseTitle,
} from '../../../shared/canonical_releases.js';
import { normalizeLegacyPlatformId } from '../../../shared/igdb_platforms.js';
import {
  BoutiqueFeedConfig,
  BoutiquePreOrder,
  fetchBoutiquePreOrders,
  fetchLimitedGameNewsReleases,
} from '../../../shared/physical_feeds.js';
import {
  cleanRetailTitle,
  decodeHtmlEntities,
  DEFAULT_CAD_TO_USD_RATE,
  fetchPnpPreOrders,
  fetchVgpNewPreOrders,
  isNonGameRetailTitle,
  isStandaloneToyListing,
  resolveRetailPlatformId,
  RetailDealItem,
  RetailStoreName,
} from '../../../shared/retail.js';
import {
  extractPhysicalEditionForVariant,
  normalizeTitleForMatching,
  stripBoutiqueCatalogPrefix,
  stripLgnPlatformPipeTrailer,
} from '../../../shared/title_matching.js';

export interface RetailBackCatalogSnapshot {
  fetchedAt: string;
  boutique: BoutiquePreOrder[];
  lgn: BoutiquePreOrder[];
  retail: RetailDealItem[];
}

interface ShopifyProductRaw {
  id: number;
  title: string;
  handle: string;
  product_type?: string;
  variants?: Array<{
    price: string;
    compare_at_price?: string | null;
    sku?: string | null;
    barcode?: string | null;
  }>;
}

interface WooStoreProductRaw {
  id: number;
  name: string;
  permalink: string;
  sku?: string;
  prices?: {
    price?: string;
    regular_price?: string;
    currency_minor_unit?: number;
  };
  categories?: Array<{ name?: string; slug?: string }>;
}

function isHardwareOrAccessoryType(productType?: string | null): boolean {
  if (!productType) return false;
  return /\b(hardware|consoles?|controllers?|headsets?|accessories)\b/i.test(
    productType,
  );
}

async function fetchShopifyCollectionPages(params: {
  store: RetailStoreName;
  baseUrl: string;
  endpoints: Array<{ urlBase: string; forcedPlatformId?: number }>;
  fetchFn: typeof fetch;
  maxPages: number;
  cadToUsdRate?: number;
}): Promise<RetailDealItem[]> {
  const byUrl = new Map<string, RetailDealItem>();
  const fxRate = params.cadToUsdRate ?? 1;

  for (const endpoint of params.endpoints) {
    for (let page = 1; page <= params.maxPages; page++) {
      const url = `${endpoint.urlBase}?limit=250&page=${page}`;
      try {
        const res = await params.fetchFn(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'CollectionTracker/2.0 (RetailBackCatalogFetch)',
          },
          signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) break;
        const payload = (await res.json()) as {
          products?: ShopifyProductRaw[];
        };
        const products = payload.products || [];
        if (products.length === 0) break;

        for (const prod of products) {
          if (
            !prod.title ||
            isHardwareOrAccessoryType(prod.product_type) ||
            isNonGameRetailTitle(prod.title, prod.product_type)
          ) {
            continue;
          }
          // Dual Xbox One / Series X always resolves to Xbox One (49); never override Xbox One to 50
          let platformId = resolveRetailPlatformId(
            prod.product_type,
            prod.title,
          );
          if (
            endpoint.forcedPlatformId &&
            platformId &&
            platformId !== endpoint.forcedPlatformId &&
            !(endpoint.forcedPlatformId === 50 && platformId === 49)
          ) {
            continue;
          }
          if (!platformId && endpoint.forcedPlatformId) {
            platformId = endpoint.forcedPlatformId;
          }
          if (!platformId) continue;

          const firstVariant = prod.variants?.[0];
          const priceRaw = parseFloat(firstVariant?.price || '0') || 0;
          const rawBarcode = (firstVariant?.barcode || '').trim();
          const barcode =
            rawBarcode.length >= 8 && /^\d+$/.test(rawBarcode)
              ? rawBarcode
              : undefined;
          const itemUrl = `${params.baseUrl}/products/${prod.handle}`;
          const item: RetailDealItem = {
            store: params.store,
            sku: firstVariant?.sku || String(prod.id),
            upc: barcode,
            name: prod.title,
            regularPrice: Number((priceRaw * fxRate).toFixed(2)),
            salePrice: Number((priceRaw * fxRate).toFixed(2)),
            onSale: false,
            percentSavings: 0,
            url: itemUrl,
            platform:
              platformId === 33
                ? 'PlayStation Vita'
                : platformId === 34
                  ? 'PlayStation 4'
                  : platformId === 35
                    ? 'PlayStation 5'
                    : platformId === 49
                      ? 'Xbox One'
                      : platformId === 50
                        ? 'Xbox Series X'
                        : prod.product_type || undefined,
            onlineAvailability: true,
            categoryHint: 'game',
          };
          if (isStandaloneToyListing(item)) continue;
          const existing = byUrl.get(itemUrl);
          if (!existing || platformId === 49) {
            byUrl.set(itemUrl, item);
          }
        }
        if (products.length < 250) break;
      } catch {
        break;
      }
    }
  }
  return Array.from(byUrl.values());
}

async function fetchVgpCatalogPages(
  fetchFn: typeof fetch,
  maxPages: number,
  cadToUsdRate = DEFAULT_CAD_TO_USD_RATE,
): Promise<RetailDealItem[]> {
  return fetchShopifyCollectionPages({
    store: 'VGP',
    baseUrl: 'https://videogamesplus.ca',
    endpoints: [
      { urlBase: 'https://videogamesplus.ca/collections/all/products.json' },
      {
        urlBase:
          'https://videogamesplus.ca/collections/all-xbox-one/products.json',
        forcedPlatformId: 49,
      },
      {
        urlBase:
          'https://videogamesplus.ca/collections/all-xbox-series-x/products.json',
        forcedPlatformId: 50,
      },
      {
        urlBase:
          'https://videogamesplus.ca/collections/all-ps-vita/products.json',
        forcedPlatformId: 33,
      },
      {
        urlBase: 'https://videogamesplus.ca/collections/all-ps4/products.json',
        forcedPlatformId: 34,
      },
    ],
    fetchFn,
    maxPages,
    cadToUsdRate,
  });
}

async function fetchGameOverCatalogPages(
  fetchFn: typeof fetch,
  maxPages: number,
): Promise<RetailDealItem[]> {
  return fetchShopifyCollectionPages({
    store: 'Game Over Videogames',
    baseUrl: 'https://gameovervideogames.com',
    endpoints: [
      {
        urlBase:
          'https://gameovervideogames.com/collections/microsoft-xbox-one/products.json',
        forcedPlatformId: 49,
      },
      {
        urlBase:
          'https://gameovervideogames.com/collections/microsoft-xbox-series-x-s/products.json',
        forcedPlatformId: 50,
      },
      {
        urlBase:
          'https://gameovervideogames.com/collections/sony-playstation-4/products.json',
        forcedPlatformId: 34,
      },
      {
        urlBase:
          'https://gameovervideogames.com/collections/sony-playstation-5/products.json',
        forcedPlatformId: 35,
      },
    ],
    fetchFn,
    maxPages,
  });
}

async function fetchJnlCatalogPages(
  fetchFn: typeof fetch,
  maxPages: number,
): Promise<RetailDealItem[]> {
  return fetchShopifyCollectionPages({
    store: 'J&L Game',
    baseUrl: 'https://www.jnlgame.com',
    endpoints: [
      {
        urlBase:
          'https://www.jnlgame.com/collections/microsoft-xbox-one-xb1-video-games-consoles-accessories/products.json',
        forcedPlatformId: 49,
      },
      {
        urlBase:
          'https://www.jnlgame.com/collections/microsoft-xbox-series-x-xbox-series-s-xsx-xss-video-games-consoles-accessories/products.json',
        forcedPlatformId: 50,
      },
      {
        urlBase:
          'https://www.jnlgame.com/collections/sony-playstation-vita-ps-vita-psvita-vita-video-games-consoles-accessories/products.json',
        forcedPlatformId: 33,
      },
      {
        urlBase:
          'https://www.jnlgame.com/collections/sony-playstation-4-ps4-video-games-consoles-accessories/products.json',
        forcedPlatformId: 34,
      },
      {
        urlBase:
          'https://www.jnlgame.com/collections/sony-playstation-5-ps5-video-games-consoles-accessories/products.json',
        forcedPlatformId: 35,
      },
      {
        urlBase:
          'https://www.jnlgame.com/collections/sony-playstation-vr-psvr-video-games-consoles-accessories/products.json',
        forcedPlatformId: 34,
      },
    ],
    fetchFn,
    maxPages,
  });
}

const PNP_ACCEPTED_PLATFORM_IDS = new Set([33, 34, 35, 49, 50]);

async function fetchPnpBackCatalogPages(
  fetchFn: typeof fetch,
  maxPages: number,
  cadToUsdRate = DEFAULT_CAD_TO_USD_RATE,
): Promise<RetailDealItem[]> {
  const byUrl = new Map<string, RetailDealItem>();
  const searches: Array<{ query: string; forcedPlatformId: number }> = [
    { query: 'Xbox+One', forcedPlatformId: 49 },
    { query: 'Xbox+Series+X', forcedPlatformId: 50 },
    { query: 'PS+Vita', forcedPlatformId: 33 },
    { query: 'PS4', forcedPlatformId: 34 },
  ];

  for (const search of searches) {
    for (let page = 1; page <= maxPages; page++) {
      const url = `https://pnpgamesonline.com/wp-json/wc/store/v1/products?per_page=100&page=${page}&search=${search.query}`;
      try {
        const res = await fetchFn(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'CollectionTracker/2.0 (RetailBackCatalogFetch)',
          },
          signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) break;
        const products = (await res.json()) as WooStoreProductRaw[];
        if (!Array.isArray(products) || products.length === 0) break;

        for (const prod of products) {
          const decodedName = decodeHtmlEntities(prod.name || '').trim();
          const catStr = (prod.categories || [])
            .map((c) => decodeHtmlEntities(c.name || ''))
            .join(' ')
            .trim();
          if (
            !decodedName ||
            !prod.permalink ||
            isHardwareOrAccessoryType(catStr) ||
            isNonGameRetailTitle(decodedName, catStr)
          ) {
            continue;
          }

          let platformId = resolveRetailPlatformId(catStr, decodedName);
          if (!platformId || !PNP_ACCEPTED_PLATFORM_IDS.has(platformId)) {
            if (
              platformId === undefined &&
              /\b(xbox\s*one|xb1|xbox\s*series|xsx|ps\s*vita|psv|ps4|playstation\s*4)\b/i.test(
                `${catStr} ${decodedName}`,
              )
            ) {
              platformId = search.forcedPlatformId;
            } else {
              continue;
            }
          }

          const minorUnit = prod.prices?.currency_minor_unit ?? 2;
          const divisor = Math.pow(10, minorUnit);
          const regCad =
            (parseInt(
              prod.prices?.regular_price || prod.prices?.price || '0',
              10,
            ) || 0) / divisor;
          const curCad =
            (parseInt(
              prod.prices?.price || prod.prices?.regular_price || '0',
              10,
            ) || 0) / divisor;

          const item: RetailDealItem = {
            store: 'PNP Games',
            sku: prod.sku || String(prod.id),
            name: decodedName,
            regularPrice: Number((regCad * cadToUsdRate).toFixed(2)),
            salePrice: Number((curCad * cadToUsdRate).toFixed(2)),
            onSale: curCad > 0 && regCad > curCad,
            percentSavings:
              regCad > curCad && regCad > 0
                ? Math.round(((regCad - curCad) / regCad) * 100)
                : 0,
            url: prod.permalink,
            platform:
              platformId === 33
                ? 'PlayStation Vita'
                : platformId === 34
                  ? 'PlayStation 4'
                  : platformId === 35
                    ? 'PlayStation 5'
                    : platformId === 49
                      ? 'Xbox One'
                      : 'Xbox Series X',
            onlineAvailability: true,
            categoryHint: 'game',
          };
          if (isStandaloneToyListing(item)) continue;
          const existing = byUrl.get(prod.permalink);
          if (!existing || platformId === 49) {
            byUrl.set(prod.permalink, item);
          }
        }
        if (products.length < 100) break;
      } catch {
        break;
      }
    }
  }
  return Array.from(byUrl.values());
}

export function parseRetailBackCatalog(
  snapshot: RetailBackCatalogSnapshot,
): CanonicalRelease[] {
  const results: CanonicalRelease[] = [];
  const seenKeys = new Set<string>();

  const addRelease = (rel: CanonicalRelease) => {
    const dedupKey = `${rel.platform_id}::${rel.source}::${rel.normalized_title}::${rel.region || ''}::${rel.variants || ''}`;
    if (seenKeys.has(dedupKey)) return;
    seenKeys.add(dedupKey);
    results.push(rel);
  };

  for (const item of snapshot.lgn || []) {
    const cleanedTitle = cleanRetailTitle(
      stripBoutiqueCatalogPrefix(
        stripLgnPlatformPipeTrailer(item.cleanTitle || item.rawTitle || ''),
        { stripPreOrderPrefix: true },
      ),
    );
    const normTitle = normalizeTitleForMatching(cleanedTitle);
    const platformId = item.platformId
      ? normalizeLegacyPlatformId(item.platformId)
      : null;
    if (!cleanedTitle || !normTitle || !platformId) continue;
    if (isCanonicalNoiseTitle(cleanedTitle, platformId, item.edition)) {
      continue;
    }
    addRelease({
      platform_id: platformId,
      raw_title: cleanedTitle,
      normalized_title: normTitle,
      region: item.region || 'Asia',
      variants: item.edition || null,
      rom_name: null,
      rom_crc: null,
      serial_code: null,
      barcode: null,
      publisher: 'Limited Game News',
      source: 'lgn',
      is_verified_physical: 1,
    });
  }

  for (const item of snapshot.boutique || []) {
    if (isNonGameRetailTitle(item.rawTitle || item.cleanTitle || '', null)) {
      continue;
    }
    const cleanedTitle = cleanRetailTitle(
      stripBoutiqueCatalogPrefix(item.cleanTitle || item.rawTitle || '', {
        stripPreOrderPrefix: true,
      }),
    );
    const extracted = extractPhysicalEditionForVariant(cleanedTitle);
    const baseTitle = extracted.baseTitle || cleanedTitle;
    const normTitle = normalizeTitleForMatching(baseTitle);
    const platformId = item.platformId
      ? normalizeLegacyPlatformId(item.platformId)
      : null;
    if (!baseTitle || !normTitle || !platformId) continue;
    if (
      isCanonicalNoiseTitle(
        baseTitle,
        platformId,
        item.edition || extracted.edition,
      )
    ) {
      continue;
    }
    const rawEd = item.edition || extracted.edition || null;
    const isMerchEd =
      rawEd &&
      /\b(?:plushie|book|yunomi|nendoroid)\s+bundle\b|\bpromo\s+card\b|\bstore\s+exclusive\b/i.test(
        rawEd,
      );
    const variants = isMerchEd ? null : rawEd;
    addRelease({
      platform_id: platformId,
      raw_title: cleanedTitle,
      normalized_title: normTitle,
      region: item.region || 'USA',
      variants,
      rom_name: null,
      rom_crc: null,
      serial_code: null,
      barcode: null,
      publisher: item.store,
      source: 'retail_catalog',
      is_verified_physical: 1,
    });
  }

  for (const item of snapshot.retail || []) {
    if (isStandaloneToyListing(item) || isNonGameRetailTitle(item.name, null)) {
      continue;
    }
    const rawPlatformId = resolveRetailPlatformId(item.platform, item.name);
    const platformId = rawPlatformId
      ? normalizeLegacyPlatformId(rawPlatformId)
      : undefined;
    if (!platformId) continue;
    const cleanTitle = cleanRetailTitle(
      stripBoutiqueCatalogPrefix(item.name, { stripPreOrderPrefix: true }),
    );
    const extracted = extractPhysicalEditionForVariant(cleanTitle);
    const baseTitle = extracted.baseTitle || cleanTitle;
    const normTitle = normalizeTitleForMatching(baseTitle);
    if (!baseTitle || !normTitle) continue;
    if (isCanonicalNoiseTitle(cleanTitle, platformId)) continue;
    const region =
      /\b(PAL(?:\s+IMPORT)?|PEGI|UK(?:\s+IMPORT)?|EUR(?:OPE)?(?:\s+IMPORT)?|EU\s+IMPORT)\b/i.test(
        item.name,
      )
        ? 'Europe'
        : /\b(JPN(?:\s+IMPORT)?|JPIM|JAPAN(?:\s+IMPORT)?|JP\s+IMPORT)\b/i.test(
              item.name,
            )
          ? 'Japan'
          : /\b(ASIA(?:N)?(?:\s+ENGLISH)?(?:\s+IMPORT)?|MSE)\b/i.test(item.name)
            ? 'Asia'
            : 'USA';

    addRelease({
      platform_id: platformId,
      raw_title: cleanTitle,
      normalized_title: normTitle,
      region,
      variants: extracted.edition ?? null,
      rom_name: null,
      rom_crc: null,
      serial_code: null,
      barcode: item.upc || null,
      publisher: item.store,
      source: 'retail_catalog',
      is_verified_physical: 1,
    });
  }

  return results;
}

const EXTRA_BOUTIQUE_BACKCATALOG_CONFIGS: BoutiqueFeedConfig[] = [
  {
    store: 'Limited Run Games',
    url: 'https://limitedrungames.com/collections/archive/products.json?limit=250',
    baseUrl: 'https://limitedrungames.com',
    type: 'shopify',
  },
  {
    store: 'iam8bit',
    url: 'https://www.iam8bit.com/collections/ps4-ps5/products.json?limit=250',
    baseUrl: 'https://www.iam8bit.com',
    type: 'shopify',
  },
  {
    store: 'iam8bit',
    url: 'https://www.iam8bit.com/collections/xbox/products.json?limit=250',
    baseUrl: 'https://www.iam8bit.com',
    type: 'shopify',
  },
];

export async function fetchRetailBackCatalogSources(
  sourcesDir: string,
  options?: { maxPages?: number; fetchFn?: typeof fetch },
): Promise<{ savedPath: string; totalParsed: number }> {
  fs.mkdirSync(sourcesDir, { recursive: true });
  const maxPages = options?.maxPages ?? 15;
  const boutiqueArchivePages = options?.maxPages ?? 25;
  const fetchFn = options?.fetchFn ?? fetch;

  const [
    boutiqueMain,
    boutiqueArchive,
    lgn,
    vgpPre,
    pnpPre,
    vgpCatalog,
    pnpBack,
    gameOverCatalog,
    jnlCatalog,
  ] = await Promise.all([
    fetchBoutiquePreOrders(fetchFn, undefined, maxPages),
    fetchBoutiquePreOrders(
      fetchFn,
      EXTRA_BOUTIQUE_BACKCATALOG_CONFIGS,
      boutiqueArchivePages,
    ).catch(() => []),
    fetchLimitedGameNewsReleases(fetchFn, {
      maxPages: Math.min(maxPages, 3),
    }),
    fetchVgpNewPreOrders(fetchFn, maxPages).catch(() => []),
    fetchPnpPreOrders(fetchFn, maxPages).catch(() => []),
    fetchVgpCatalogPages(fetchFn, maxPages).catch(() => []),
    fetchPnpBackCatalogPages(fetchFn, maxPages).catch(() => []),
    fetchGameOverCatalogPages(fetchFn, maxPages).catch(() => []),
    fetchJnlCatalogPages(fetchFn, maxPages).catch(() => []),
  ]);

  const boutiqueByKey = new Map<string, BoutiquePreOrder>();
  for (const item of [...boutiqueMain, ...boutiqueArchive]) {
    const dedupKey = `${item.productUrl}::${item.platformId ?? ''}`;
    if (!boutiqueByKey.has(dedupKey)) {
      boutiqueByKey.set(dedupKey, item);
    }
  }
  const boutique = Array.from(boutiqueByKey.values());

  const byUrl = new Map<string, RetailDealItem>();
  for (const item of [
    ...vgpPre,
    ...pnpPre,
    ...vgpCatalog,
    ...pnpBack,
    ...gameOverCatalog,
    ...jnlCatalog,
  ]) {
    const existing = byUrl.get(item.url);
    const itemPid = resolveRetailPlatformId(item.platform, item.name);
    if (!existing || itemPid === 49) {
      byUrl.set(item.url, item);
    }
  }

  const snapshot: RetailBackCatalogSnapshot = {
    fetchedAt: new Date().toISOString(),
    boutique,
    lgn,
    retail: Array.from(byUrl.values()),
  };

  const savedPath = path.join(sourcesDir, 'retail_backcatalog.json');
  fs.writeFileSync(savedPath, JSON.stringify(snapshot, null, 2), 'utf8');
  return {
    savedPath,
    totalParsed: parseRetailBackCatalog(snapshot).length,
  };
}

export function loadRetailBackCatalogReleases(
  sourcesDir: string,
): CanonicalRelease[] {
  const filePath = path.join(sourcesDir, 'retail_backcatalog.json');
  if (!fs.existsSync(filePath)) return [];
  const snapshot = JSON.parse(
    fs.readFileSync(filePath, 'utf8'),
  ) as RetailBackCatalogSnapshot;
  return parseRetailBackCatalog(snapshot);
}
