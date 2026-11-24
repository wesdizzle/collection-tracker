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
import { CanonicalRelease } from '../../../shared/canonical_releases.js';
import { normalizeLegacyPlatformId } from '../../../shared/igdb_platforms.js';
import {
  BoutiquePreOrder,
  fetchBoutiquePreOrders,
  fetchLimitedGameNewsReleases,
} from '../../../shared/physical_feeds.js';
import {
  cleanRetailTitle,
  DEFAULT_CAD_TO_USD_RATE,
  fetchPnpPreOrders,
  fetchVgpNewPreOrders,
  isNonGameRetailTitle,
  isStandaloneToyListing,
  resolveRetailPlatformId,
  RetailDealItem,
} from '../../../shared/retail.js';
import { normalizeTitleForMatching } from '../../../shared/title_matching.js';

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

async function fetchVgpCatalogPages(
  fetchFn: typeof fetch,
  maxPages: number,
  cadToUsdRate = DEFAULT_CAD_TO_USD_RATE,
): Promise<RetailDealItem[]> {
  const items: RetailDealItem[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = `https://videogamesplus.ca/collections/all/products.json?limit=250&page=${page}`;
    try {
      const res = await fetchFn(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'CollectionTracker/2.0 (RetailBackCatalogFetch)',
        },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) break;
      const payload = (await res.json()) as { products?: ShopifyProductRaw[] };
      const products = payload.products || [];
      if (products.length === 0) break;

      for (const prod of products) {
        if (
          !prod.title ||
          isNonGameRetailTitle(prod.title, prod.product_type)
        ) {
          continue;
        }
        const platformId = resolveRetailPlatformId(
          prod.product_type,
          prod.title,
        );
        if (!platformId) continue;
        const firstVariant = prod.variants?.[0];
        const priceCad = parseFloat(firstVariant?.price || '0') || 0;
        const rawBarcode = (firstVariant?.barcode || '').trim();
        const barcode =
          rawBarcode.length >= 8 && /^\d+$/.test(rawBarcode)
            ? rawBarcode
            : undefined;
        const item: RetailDealItem = {
          store: 'VGP',
          sku: firstVariant?.sku || String(prod.id),
          upc: barcode,
          name: prod.title,
          regularPrice: Number((priceCad * cadToUsdRate).toFixed(2)),
          salePrice: Number((priceCad * cadToUsdRate).toFixed(2)),
          onSale: false,
          percentSavings: 0,
          url: `https://videogamesplus.ca/products/${prod.handle}`,
          platform: prod.product_type || undefined,
          onlineAvailability: true,
          categoryHint: 'game',
        };
        if (isStandaloneToyListing(item)) continue;
        items.push(item);
      }
      if (products.length < 250) break;
    } catch {
      break;
    }
  }
  return items;
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
    const normTitle = normalizeTitleForMatching(item.cleanTitle);
    const platformId = item.platformId
      ? normalizeLegacyPlatformId(item.platformId)
      : null;
    if (!item.cleanTitle || !normTitle || !platformId) continue;
    addRelease({
      platform_id: platformId,
      raw_title: item.cleanTitle,
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
    const normTitle = normalizeTitleForMatching(item.cleanTitle);
    const platformId = item.platformId
      ? normalizeLegacyPlatformId(item.platformId)
      : null;
    if (!item.cleanTitle || !normTitle || !platformId) continue;
    addRelease({
      platform_id: platformId,
      raw_title: item.cleanTitle,
      normalized_title: normTitle,
      region: item.region || 'USA',
      variants: item.edition || null,
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
    if (isStandaloneToyListing(item)) continue;
    const rawPlatformId = resolveRetailPlatformId(item.platform, item.name);
    const platformId = rawPlatformId
      ? normalizeLegacyPlatformId(rawPlatformId)
      : undefined;
    if (!platformId) continue;
    const cleanTitle = cleanRetailTitle(item.name);
    const normTitle = normalizeTitleForMatching(cleanTitle);
    if (!cleanTitle || !normTitle) continue;
    const region = /\b(PEGI|EUR|UK)\b/i.test(item.name)
      ? 'Europe'
      : /\b(JPN|Japan)\s*Import\b/i.test(item.name)
        ? 'Japan'
        : /\bAsia\b/i.test(item.name)
          ? 'Asia'
          : 'USA';

    addRelease({
      platform_id: platformId,
      raw_title: cleanTitle,
      normalized_title: normTitle,
      region,
      variants: null,
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

export async function fetchRetailBackCatalogSources(
  sourcesDir: string,
  options?: { maxPages?: number; fetchFn?: typeof fetch },
): Promise<{ savedPath: string; totalParsed: number }> {
  fs.mkdirSync(sourcesDir, { recursive: true });
  const maxPages = options?.maxPages ?? 5;
  const fetchFn = options?.fetchFn ?? fetch;

  const [boutique, lgn, vgpPre, pnpPre, vgpCatalog] = await Promise.all([
    fetchBoutiquePreOrders(fetchFn, undefined, maxPages),
    fetchLimitedGameNewsReleases(fetchFn, {
      maxPages: Math.min(maxPages, 3),
    }),
    fetchVgpNewPreOrders(fetchFn, maxPages).catch(() => []),
    fetchPnpPreOrders(fetchFn, maxPages).catch(() => []),
    fetchVgpCatalogPages(fetchFn, maxPages).catch(() => []),
  ]);

  const byUrl = new Map<string, RetailDealItem>();
  for (const item of [...vgpPre, ...pnpPre, ...vgpCatalog]) {
    if (!byUrl.has(item.url)) {
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
