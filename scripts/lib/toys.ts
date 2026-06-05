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
import * as cheerio from 'cheerio';
import Database from 'better-sqlite3';

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
  series_id?: number | null;
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
    'https://skylanderscharacterlist.com/post-sitemap.xml',
    'https://skylanderscharacterlist.com/post-sitemap2.xml',
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
              const secureImgUrl = img['image:loc'].replace(
                /^http:\/\/skylanderscharacterlist\.com/i,
                'https://skylanderscharacterlist.com',
              );
              images.push(secureImgUrl);
            }
          }
        }

        const secureLocUrl = u.loc.replace(
          /^http:\/\/skylanderscharacterlist\.com/i,
          'https://skylanderscharacterlist.com',
        );

        allEntries.push({
          loc: secureLocUrl,
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

export interface StarlinkToyMetadata {
  type: 'Starship' | 'Pilot' | 'Weapon';
  releaseDate: string;
  sortIndex: number;
}

export const STARLINK_TOYS: Record<string, StarlinkToyMetadata> = {
  // Ships
  arwing: { type: 'Starship', releaseDate: '2018-10-16', sortIndex: 1001 },
  cerberus: { type: 'Starship', releaseDate: '2018-10-16', sortIndex: 1002 },
  lance: { type: 'Starship', releaseDate: '2018-10-16', sortIndex: 1003 },
  nadir: { type: 'Starship', releaseDate: '2018-10-16', sortIndex: 1004 },
  neptune: { type: 'Starship', releaseDate: '2018-10-16', sortIndex: 1005 },
  pulse: { type: 'Starship', releaseDate: '2018-10-16', sortIndex: 1006 },
  scramble: { type: 'Starship', releaseDate: '2018-10-16', sortIndex: 1007 },
  zenith: { type: 'Starship', releaseDate: '2018-10-16', sortIndex: 1008 },

  // Pilots
  chasedasilva: { type: 'Pilot', releaseDate: '2018-10-16', sortIndex: 2001 },
  eliarborwood: { type: 'Pilot', releaseDate: '2018-10-16', sortIndex: 2002 },
  foxmccloud: { type: 'Pilot', releaseDate: '2018-10-16', sortIndex: 2003 },
  hunterhakka: { type: 'Pilot', releaseDate: '2018-10-16', sortIndex: 2004 },
  judge: { type: 'Pilot', releaseDate: '2018-10-16', sortIndex: 2005 },
  kharlzeon: { type: 'Pilot', releaseDate: '2018-10-16', sortIndex: 2006 },
  levimccray: { type: 'Pilot', releaseDate: '2018-10-16', sortIndex: 2007 },
  masonrana: { type: 'Pilot', releaseDate: '2018-10-16', sortIndex: 2008 },
  razorlemay: { type: 'Pilot', releaseDate: '2018-10-16', sortIndex: 2009 },
  shaid: { type: 'Pilot', releaseDate: '2018-10-16', sortIndex: 2010 },
  startail: { type: 'Pilot', releaseDate: '2018-10-16', sortIndex: 2011 },

  // Weapons
  crusher: { type: 'Weapon', releaseDate: '2018-10-16', sortIndex: 3001 },
  flamethrower: { type: 'Weapon', releaseDate: '2018-10-16', sortIndex: 3002 },
  freezeraymk2: { type: 'Weapon', releaseDate: '2018-10-16', sortIndex: 3003 },
  frostbarrage: { type: 'Weapon', releaseDate: '2018-10-16', sortIndex: 3004 },
  furycannon: { type: 'Weapon', releaseDate: '2018-10-16', sortIndex: 3005 },
  gaussgunmk2: { type: 'Weapon', releaseDate: '2018-10-16', sortIndex: 3006 },
  hailstorm: { type: 'Weapon', releaseDate: '2018-10-16', sortIndex: 3007 },
  imploder: { type: 'Weapon', releaseDate: '2018-10-16', sortIndex: 3008 },
  ironfist: { type: 'Weapon', releaseDate: '2018-10-16', sortIndex: 3009 },
  levitator: { type: 'Weapon', releaseDate: '2018-10-16', sortIndex: 3010 },
  meteormk2: { type: 'Weapon', releaseDate: '2018-10-16', sortIndex: 3011 },
  nullifier: { type: 'Weapon', releaseDate: '2018-10-16', sortIndex: 3012 },
  shockwave: { type: 'Weapon', releaseDate: '2018-10-16', sortIndex: 3013 },
  shredder: { type: 'Weapon', releaseDate: '2018-10-16', sortIndex: 3014 },
  shreddermk2: { type: 'Weapon', releaseDate: '2018-10-16', sortIndex: 3015 },
  volcano: { type: 'Weapon', releaseDate: '2018-10-16', sortIndex: 3016 },
};

export interface CleanedToyName {
  baseName: string;
  variantName: string;
}

/**
 * Strips common variant modifiers, series indicators, and element designations
 * to find the base character name for grouping and sorting.
 *
 * @param name The original toy name (e.g. "Gnarly Tree Rex").
 * @returns An object containing the extracted base name and variant modifiers.
 * @throws None.
 */
export function extractBaseCharacterName(name: string): CleanedToyName {
  let cleanName = name.replace(/\s+/g, ' ').trim();

  // Remove series indicators (case-insensitive)
  const seriesRegex = /\b(?:series\s*\d+|series-\d+)\b/gi;
  cleanName = cleanName.replace(seriesRegex, '').replace(/\s+/g, ' ').trim();

  // Remove trailing "gear" and "figure" words for items and figures
  cleanName = cleanName
    .replace(/\bgear\b/gi, '')
    .replace(/\bfigure\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const lower = cleanName.toLowerCase();
  const isException =
    lower === 'king pen' ||
    lower === 'golden queen' ||
    lower.startsWith('dark reactor') ||
    lower.startsWith('dark rune') ||
    lower.startsWith('dark pyramid');

  const modifiers = [
    'gnarly',
    'legendary',
    'dark',
    'lightcore',
    'polar',
    'molten',
    'scarlet',
    'punch',
    'royal',
    'sidekick',
    'eggscellent',
    'eggsellent',
    'power punch',
    'power-punch',
    'power blue',
    'power-blue',
    'kickoff',
    'springtime',
    'double dare',
    'double-dare',
    'big-bang',
    'big bang',
    'quick draw',
    'quick-draw',
    'phantom',
    'steel plated',
    'steel-plated',
    'solar flare',
    'solar-flare',
    'candy-coated',
    'candy coated',
    'mystical',
    'love potion',
    'love-potion',
    'super gulp',
    'super-gulp',
    'sure shot',
    'sure-shot',
    'nitro',
    'jade',
    'jolly',
    'enchanted',
    'hyper beam',
    'hyper-beam',
    'knockout',
    'heavy duty',
    'heavy-duty',
    'winterfest',
    'tidal wave',
    'tidal-wave',
    'anchors away',
    'anchors-away',
    'deep dive',
    'deep-dive',
    'fizzy frenzy',
    'fizzy-frenzy',
    'frightful',
    'missile-tow',
    'eggcited',
    'jingle bell',
    'jingle-bell',
    'lava barf',
    'lava-barf',
    'volcanic',
    'fire bone',
    'fire-bone',
    'bone bash',
    'bone-bash',
    'birthday bash',
    'birthday-bash',
    'twin blade',
    'twin-beta',
    'twin-blade',
    'mega ram',
    'mega-ram',
    'horn blast',
    'horn-blast',
    'hyper',
    'blizzard',
    'event exclusive',
    'event-exclusive',
    'e3 exclusive',
    'e3-exclusive',
    'gold',
    'silver',
    'bronze',
    'platinum',
    'ninja',
    'turbo',
    'full blast',
    'full-blast',
    'hog wild',
    'hog-wild',
    'rock candy',
    'rock-candy',
    'heartbreaker',
    'dec-ember',
    'december',
    'pink',
    'orange',
    'blue',
    'red',
    'green',
    'purple',
    'white',
    'chrome',
    'metallic',
    'clear',
    'flocked',
    'stone',
    'pearl',
    'sparkle',
    'glow',
    'patina',
    'spring-ahead',
    'sea-trophy',
    'sky-trophy',
    'mini',
    'sidekick',
    "eon's elite",
    'eons elite',
    "eon's",
    'eons',
    'elite',
    'thorn-horn',
    'thorn horn',
  ];

  const activeModifiers: string[] = [];

  if (!isException) {
    // Strip modifiers globally from anywhere in the string while preserving original casing
    for (const mod of modifiers) {
      const regex = new RegExp(`\\b${mod}\\b`, 'gi');
      const match = cleanName.match(regex);
      if (match) {
        activeModifiers.push(match[0]);
        cleanName = cleanName.replace(regex, '').replace(/\s+/g, ' ').trim();
      }
    }

    // Special check for "King" (e.g. "King Cobra Cadabra" -> "Cobra Cadabra")
    if (
      cleanName.toLowerCase().startsWith('king ') &&
      cleanName.toLowerCase() !== 'king pen'
    ) {
      activeModifiers.push(cleanName.substring(0, 4));
      cleanName = cleanName.substring(5).trim();
    }
  }

  return {
    baseName: cleanName,
    variantName: activeModifiers.join(' '),
  };
}

export interface SkylandersDetail {
  title: string | null;
  element: string | null;
  series: string | null;
  releasedWith: string | null;
  releaseDate: string | null;
  description?: string | null;
}

/**
 * Fetches and parses a Skylanders toy detail page from Skylanders Character List.
 *
 * @param url The SCL URL of the character (e.g. https://skylanderscharacterlist.com/bash-series-1/).
 * @returns A promise resolving to the parsed character details or null on failure.
 * @throws None.
 */
export async function scrapeSkylandersDetail(
  url: string,
): Promise<SkylandersDetail | null> {
  try {
    // Standard delay to respect SCL rate limit
    await new Promise((resolve) => setTimeout(resolve, 200));

    const response = await axios.get(url, {
      headers: HEADERS,
      timeout: 10000,
    });
    const $ = cheerio.load(response.data as string);
    const title =
      $('h1.entry-title').text().trim() ||
      $('h1').first().text().trim() ||
      null;

    let element: string | null = null;
    let series: string | null = null;
    let releasedWith: string | null = null;

    $('table tr').each((_, row) => {
      const thText = $(row).find('th').text().trim().toLowerCase();
      const tdText = $(row).find('td').text().trim();
      if (thText.includes('element:')) {
        element = tdText;
      } else if (thText.includes('series:')) {
        series = tdText;
      } else if (thText.includes('released with:')) {
        releasedWith = tdText;
      }
    });

    // Parse release date paragraph from page body
    let releaseDate: string | null = null;
    const bodyText = $('body').text();

    const monthMap: Record<string, string> = {
      january: '01',
      february: '02',
      march: '03',
      april: '04',
      may: '05',
      june: '06',
      july: '07',
      august: '08',
      september: '09',
      october: '10',
      november: '11',
      december: '12',
    };

    const months =
      '(january|february|march|april|may|june|july|august|september|october|november|december)';
    const dateRegex = new RegExp(
      `\\b${months}\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`,
      'i',
    );
    const match = bodyText.match(dateRegex);
    if (match) {
      const monthNum = monthMap[match[1].toLowerCase()];
      const day = match[2].padStart(2, '0');
      const year = match[3];
      releaseDate = `${year}-${monthNum}-${day}`;
    } else {
      const monthYearRegex = new RegExp(`\\b${months}\\s+(\\d{4})\\b`, 'i');
      const matchMY = bodyText.match(monthYearRegex);
      if (matchMY) {
        const monthNum = monthMap[matchMY[1].toLowerCase()];
        const year = matchMY[2];
        releaseDate = `${year}-${monthNum}-01`;
      }
    }

    // Fallback to game release dates if specific date not found in body text
    if (!releaseDate && releasedWith) {
      const cleanGame = (releasedWith as string).toLowerCase().trim();
      const gameLaunchDates: Record<string, string> = {
        "spyro's adventure": '2011-10-16',
        giants: '2012-10-21',
        'swap force': '2013-10-13',
        'trap team': '2014-10-05',
        superchargers: '2015-09-20',
        imaginators: '2016-10-16',
        "eon's elite": '2014-11-01',
      };
      for (const [key, dateVal] of Object.entries(gameLaunchDates)) {
        if (cleanGame.includes(key) || key.includes(cleanGame)) {
          releaseDate = dateVal;
          break;
        }
      }
    }

    // Replace all <br> tags with newline text nodes to preserve line breaks in lists
    $('br').replaceWith('\n');

    const paragraphs: string[] = [];
    $('.post-content p').each((_, el) => {
      const text = $(el).text().trim();
      if (!text) return;
      if (
        text.includes('eBay Partner Network') ||
        text.includes('Amazon Associate') ||
        text.includes('compensated if you make a purchase')
      ) {
        return;
      }
      if (
        text.includes('Activision Blizzard') ||
        text.includes('Version 33, LLC') ||
        text.includes('not affiliated, associated')
      ) {
        return;
      }
      paragraphs.push(text);
    });
    const description = paragraphs.length > 0 ? paragraphs.join('\n') : null;

    return {
      title,
      element,
      series,
      releasedWith,
      releaseDate,
      description,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[Toys] Failed to scrape Skylanders detail page ${url}:`,
      message,
    );
    return null;
  }
}

/**
 * Re-indexes all Skylanders toys in the database sequentially based on their
 * Game Order, Element Order (alphabetical), Base Character Name, and Variant.
 *
 * @param db The SQLite database connection instance.
 * @returns None.
 * @throws Error if database operations fail.
 */
export function reindexSkylanders(db: Database.Database): void {
  console.log('\n--- Reindexing Skylanders Sort Order ---');

  const skylanders = db
    .prepare("SELECT * FROM toys WHERE line = 'Skylanders'")
    .all() as Toy[];
  if (skylanders.length === 0) {
    console.log('No Skylanders found to reindex.');
    return;
  }

  const elementOrder: Record<string, number> = {
    air: 1,
    dark: 2,
    earth: 3,
    fire: 4,
    life: 5,
    light: 6,
    magic: 7,
    tech: 8,
    undead: 9,
    water: 10,
  };

  const getElement = (t: Toy): string => {
    try {
      if (t.metadata_json) {
        const meta = JSON.parse(t.metadata_json);
        if (meta.element) {
          return meta.element.toLowerCase().trim();
        }
      }
    } catch {
      // Ignore JSON parsing errors
    }
    return 'kaos/other';
  };

  const sorted = skylanders
    .map((t) => {
      const parsed = extractBaseCharacterName(t.name);
      const element = getElement(t);

      let gameOrder = 99;
      if (t.series_id) {
        const seriesRow = db
          .prepare('SELECT sort_index FROM toy_series WHERE id = ?')
          .get(t.series_id) as { sort_index: number | null } | undefined;
        if (seriesRow && seriesRow.sort_index !== null) {
          gameOrder = seriesRow.sort_index;
        }
      }

      const elemOrder = elementOrder[element] || 99;

      // Group by Category: 1 = Characters, 2 = Vehicles, 3 = Crystals, 4 = Traps, 5 = Magic Items
      let categoryOrder = 1;
      const typeLower = (t.type || '').toLowerCase().trim();
      if (typeLower === 'vehicle') {
        categoryOrder = 2;
      } else if (typeLower === 'creation crystal') {
        categoryOrder = 3;
      } else if (typeLower === 'trap') {
        categoryOrder = 4;
      } else if (
        t.type === 'Magic Item' ||
        !element ||
        element === 'kaos/other'
      ) {
        categoryOrder = 5;
      }

      // Calculate Subtype priority within characters (category 1):
      // 1 = Gimmick (Giants, SWAP Force, Trap Master, Sensei)
      // 2 = Standard (Series 1-4, SuperCharger, Figure)
      // 3 = LightCore
      // 4 = Minis/Sidekicks (Mini, Sidekicks)
      let subtypePriority = 5;
      if (categoryOrder === 1) {
        const tType = t.type || '';
        if (
          tType === 'Giants' ||
          tType === 'SWAP Force' ||
          tType === 'Trap Master' ||
          tType === 'Sensei'
        ) {
          subtypePriority = 1;
        } else if (
          tType.startsWith('Series') ||
          tType === 'SuperCharger' ||
          tType === 'Figure'
        ) {
          subtypePriority = 2;
        } else if (tType === 'LightCore') {
          subtypePriority = 3;
        } else if (tType === 'Mini' || tType === 'Sidekicks') {
          subtypePriority = 4;
        }
      }

      // groupPriority: Gimmick = 1, Standard/LightCore = 2, Mini = 3, other = 4
      let groupPriority = 4;
      if (categoryOrder === 1) {
        if (subtypePriority === 1) {
          groupPriority = 1;
        } else if (subtypePriority === 2 || subtypePriority === 3) {
          groupPriority = 2;
        } else if (subtypePriority === 4) {
          groupPriority = 3;
        }
      }

      return {
        toy: t,
        gameOrder,
        categoryOrder,
        elemOrder,
        subtypePriority,
        groupPriority,
        baseName: parsed.baseName.toLowerCase(),
        variant: parsed.variantName.toLowerCase(),
      };
    })
    .sort((a, b) => {
      if (a.gameOrder !== b.gameOrder) {
        return a.gameOrder - b.gameOrder;
      }
      if (a.categoryOrder !== b.categoryOrder) {
        return a.categoryOrder - b.categoryOrder;
      }
      if (a.elemOrder !== b.elemOrder) {
        return a.elemOrder - b.elemOrder;
      }
      if (a.groupPriority !== b.groupPriority) {
        return a.groupPriority - b.groupPriority;
      }
      if (a.baseName !== b.baseName) {
        return a.baseName.localeCompare(b.baseName);
      }
      if (a.subtypePriority !== b.subtypePriority) {
        return a.subtypePriority - b.subtypePriority;
      }
      if (a.variant === '' && b.variant !== '') {
        return -1;
      }
      if (a.variant !== '' && b.variant === '') {
        return 1;
      }
      return a.variant.localeCompare(b.variant);
    });

  const updateStmt = db.prepare(
    'UPDATE toys SET sort_index = ? WHERE stable_id = ?',
  );
  const trans = db.transaction(() => {
    sorted.forEach((item, index) => {
      updateStmt.run(index + 1, item.toy.stable_id);
    });
  });
  trans();

  console.log(
    `Successfully reindexed ${skylanders.length} Skylanders sort orders.`,
  );
}

/**
 * Generates all possible Fandom Wiki slug variations for a Starlink toy name.
 *
 * @param toyName The name of the toy.
 * @returns An array of string slugs to try fetching.
 * @throws None.
 */
export function getStarlinkSlugs(toyName: string): string[] {
  let name = toyName.trim();

  // Normalize slash in "Hunter/Hakka"
  name = name.replace(/\//g, ' ');

  // Capitalize words, keeping "da" or "de" lowercase
  const words = name.split(/\s+/).map((w) => {
    const lw = w.toLowerCase();
    if (lw === 'da' || lw === 'de') {
      return lw;
    }
    return w.charAt(0).toUpperCase() + w.slice(1);
  });

  const formatted = words.join('_');
  const slugs: string[] = [formatted];

  // Specific overrides/replacements
  if (
    formatted.toLowerCase().includes('karl_zeon') ||
    formatted.toLowerCase().includes('kharl_zeon')
  ) {
    slugs.unshift('Kharl_Zeon');
  }
  if (formatted.toLowerCase().includes('chase_da_silva')) {
    slugs.unshift('Calisto_Chase_Da_Silva');
    slugs.push('Chase');
  }

  // If name has Mk 2 / Mk2 / Mk. 2
  if (name.match(/\bMk\.?\s*2\b/i)) {
    const cleanBase = formatted.replace(/_Mk\.?\s*2\b/i, '');
    slugs.unshift(cleanBase + '_Mk._2');
    slugs.push(cleanBase + '_Mk2');
    slugs.push(cleanBase); // Fallback to base weapon page
  }

  return Array.from(new Set(slugs));
}

/**
 * Fetches and parses a Starlink toy image from the Starlink Wiki on Fandom.
 *
 * @param toyName The name of the Starlink toy (e.g. "Arwing", "Zenith", "Mason Rana").
 * @returns A promise resolving to the image URL or null on failure.
 * @throws None.
 */
export async function scrapeStarlinkWikiImage(
  toyName: string,
): Promise<string | null> {
  const slugs = getStarlinkSlugs(toyName);

  for (const slug of slugs) {
    const title = slug.replace(/_/g, ' ');
    const url = `https://starlink.fandom.com/api.php?action=query&prop=pageimages&titles=${encodeURIComponent(title)}&format=json&pithumbsize=1000&redirects=1`;
    try {
      console.log(`[Starlink Wiki API] Fetching details for: "${title}"...`);
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 8000,
      });

      const pages = response.data?.query?.pages;
      if (pages) {
        const pageId = Object.keys(pages)[0];
        const page = pages[pageId];
        if (page && page.thumbnail && page.thumbnail.source) {
          let img = page.thumbnail.source;
          if (
            img &&
            !img.includes('Site-community-image') &&
            !img.includes('placeholder')
          ) {
            img = img.split('/revision/')[0] + '/revision/latest';
            return img;
          }
        }
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.log(
        `[Starlink Wiki API] Failed to fetch for "${title}": ${errMsg}`,
      );
    }
  }
  return null;
}
