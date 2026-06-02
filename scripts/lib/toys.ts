/**
 * TOYS METADATA LIBRARY
 *
 * This library provides utility functions for fetching and normalizing metadata
 * for various toy lines, including amiibo, Skylanders, and Starlink.
 *
 * It serves as the primary data ingestion layer for the toy reconciliation
 * and discovery pipelines.
 */

import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';

export interface Toy {
  id: string;
  stable_id?: number;
  name: string;
  line: string;
  series_name: string;
  type: string;
  image_url: string | null;
  release_date?: string | null;
  region?: string | null;
  verified?: boolean | number;
  amiibo_id?: string;
  metadata_json?: string;
  scl_url?: string;
  series?: string;
}

/**
 * UTILITY: getAmiiboSeries
 *
 * Fetches all toys in a given series from the AmiiboAPI.
 */
export async function getAmiiboSeries(seriesName?: string): Promise<Toy[]> {
  try {
    await new Promise((resolve) => setTimeout(resolve, 1000)); // 1s delay
    const params: Record<string, string> = {};
    if (seriesName) params['amiiboSeries'] = seriesName;

    const response = await axios.get(`https://amiiboapi.org/api/amiibo/`, {
      params,
      headers: { 'User-Agent': 'CollectionTracker/1.0' },
      timeout: 10000,
    });

    interface Amiibo {
      head: string;
      tail: string;
      name: string;
      amiiboSeries: string;
      gameSeries?: string;
      type: string;
      image: string;
      release?: { na?: string };
    }

    const data = response.data as { amiibo: Amiibo[] };
    return data.amiibo.map((a: Amiibo) => {
      const effectiveSeries =
        a.amiiboSeries === 'Others' && a.gameSeries
          ? a.gameSeries
          : a.amiiboSeries;
      return {
        id: `${a.head}${a.tail}`,
        name: a.name,
        line: 'amiibo',
        series_name: effectiveSeries,
        type: a.type,
        image_url: a.image,
        release_date: a.release?.na || null,
      };
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const code = (error as { code?: string }).code;
    if (code === 'ECONNRESET') {
      console.error(
        `AmiiboAPI: Connection reset for ${seriesName}, skipping...`,
      );
    } else {
      console.error(`AmiiboAPI Error for ${seriesName}:`, message);
    }
    return [];
  }
}

/**
 * UTILITY: getSkylandersSeries
 *
 * Returns curated toys for Skylanders series since they lack a public API.
 */
export async function getSkylandersSeries(seriesName: string): Promise<Toy[]> {
  // Skylanders doesn't have a public API, so we use a curated list of series.
  const seriesManifest: Record<string, string[]> = {
    "Spyro's Adventure": [
      'Spyro',
      'Gill Grunt',
      'Trigger Happy',
      'Eruptor',
      'Bash',
      'Ignitor',
      'Chop Chop',
      'Terrafin',
    ],
    Giants: [
      'Tree Rex',
      'Bouncer',
      'Crusher',
      'Eye-Brawl',
      'Hot Head',
      'Ninjini',
      'Swarm',
      'Thumpback',
    ],
    'Swap Force': [
      'Wash Buckler',
      'Blast Zone',
      'Free Ranger',
      'Freeze Blade',
      'Magna Charge',
      'Night Shift',
      'Rattle Shake',
      'Stink Bomb',
    ],
    'Trap Team': [
      'Snap Shot',
      'Wallop',
      'Wildfire',
      'Jawbreaker',
      'Krypt King',
      'Gust Black',
      'Lob-Star',
      'Bushwhack',
    ],
    SuperChargers: [
      'Spitfire',
      'Stormblade',
      'Dive-Clops',
      'Nightfall',
      'Smash Hit',
      'Fiesta',
      'High Volt',
      'Splat',
    ],
    Imaginators: [
      'King Pen',
      'Golden Queen',
      'Tri-Tip',
      'Starcast',
      'Ambush',
      'Barbella',
      'Ro-Bow',
      'Wild Storm',
    ],
  };

  const items = seriesManifest[seriesName] || [];
  return items.map((name) => ({
    id: `skylanders-${name.toLowerCase().replace(/ /g, '-')}`,
    name: name,
    line: 'Skylanders',
    series_name: seriesName,
    type: 'Figure',
    image_url: null,
  }));
}

/**
 * UTILITY: getStarlinkSeries
 *
 * Returns curated toys for Starlink: Battle for Atlas.
 */
export async function getStarlinkSeries(seriesName: string): Promise<Toy[]> {
  const seriesManifest: Record<string, string[]> = {
    'Battle for Atlas': [
      'Mason Rana',
      'Judge',
      'Chase da Silva',
      'Hunter Hakka',
      'Shaid',
      'Levi McCray',
      'Razor Lemay',
      'Eli Arborwood',
      'Karl Zeon',
      'Fern Wilder',
    ],
  };

  const items = seriesManifest[seriesName] || [];
  return items.map((name) => ({
    id: `starlink-${name.toLowerCase().replace(/ /g, '-')}`,
    name: name,
    line: 'Starlink',
    series_name: seriesName,
    type: 'Figure',
    image_url: null,
  }));
}

export interface SitemapEntry {
  loc: string;
  images: string[];
}

export interface PCProduct {
  id: string;
  productName: string;
  imageUri: string | null;
}

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
};

/**
 * UTILITY: scrapeSkylandersSitemap
 *
 * Fetches and parses Skylanders character list sitemaps to get URLs and associated images.
 * This is used to map Skylanders characters to high-quality image URLs.
 *
 * Why this is used: Skylanders lacks a public API. SCL maintains a visual sitemap of all its pages
 * which includes featured images inline, allowing us to find images in bulk with only two requests.
 *
 * @returns A promise resolving to an array of sitemap location entries and image lists.
 */
export async function scrapeSkylandersSitemap(): Promise<SitemapEntry[]> {
  const sitemaps = [
    'http://skylanderscharacterlist.com/post-sitemap.xml',
    'http://skylanderscharacterlist.com/post-sitemap2.xml',
  ];
  const allEntries: SitemapEntry[] = [];
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });

  for (const url of sitemaps) {
    try {
      console.log(`[Toys] Fetching sitemap: ${url}...`);
      const response = await axios.get(url, {
        headers: HEADERS,
        timeout: 10000,
      });
      const result = parser.parse(response.data);
      const urls = result?.urlset?.url || [];
      const list = Array.isArray(urls) ? urls : [urls];

      for (const u of list) {
        if (!u.loc) continue;

        const rawImages = u['image:image'];
        const images: string[] = [];

        if (rawImages) {
          const imgArray = Array.isArray(rawImages) ? rawImages : [rawImages];
          for (const img of imgArray) {
            if (img['image:loc']) {
              images.push(img['image:loc']);
            }
          }
        }

        allEntries.push({
          loc: u.loc,
          images,
        });
      }
      console.log(
        `[Toys] Successfully parsed ${allEntries.length} entries from sitemap.`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Toys] Failed to fetch/parse sitemap ${url}:`, message);
    }
  }

  return allEntries;
}

/**
 * UTILITY: scrapeStarlinkConsole
 *
 * Fetches the Starlink console product listings from PriceCharting directly in JSON format.
 * Returns product names, IDs, and high-res image URLs.
 *
 * Why this is used: Starlink toys are documented under the 'Starlink' platform category on PriceCharting.
 * The endpoint returns JSON output containing all matching products and image links.
 *
 * @returns A promise resolving to an array of PriceCharting products.
 */
export async function scrapeStarlinkConsole(): Promise<PCProduct[]> {
  const url = 'https://www.pricecharting.com/console/starlink';
  try {
    console.log(
      `[Toys] Fetching Starlink listings from PriceCharting: ${url}...`,
    );
    const response = await axios.get(url, {
      headers: HEADERS,
      timeout: 10000,
    });
    const data =
      typeof response.data === 'string'
        ? JSON.parse(response.data)
        : response.data;
    const products = data?.products || [];
    const list = Array.isArray(products) ? products : [products];

    interface PCProductRaw {
      id: string | number;
      productName?: string;
      imageUri?: string | null;
    }

    return (list as PCProductRaw[]).map((p: PCProductRaw) => {
      // Replace low-res /60.jpg thumbnail with high-res /1600.jpg cover image
      const largeImg = p.imageUri
        ? p.imageUri.replace('/60.jpg', '/1600.jpg')
        : null;
      return {
        id: String(p.id),
        productName: p.productName || 'Unknown Product',
        imageUri: largeImg,
      };
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(
      `[Toys] Failed to fetch Starlink listings from PriceCharting:`,
      message,
    );
    return [];
  }
}
