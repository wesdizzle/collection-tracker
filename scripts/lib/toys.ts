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
    'https://skylanderscharacterlist.com/post-sitemap3.xml',
    'https://skylanderscharacterlist.com/page-sitemap.xml',
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

/**
 * UTILITY: superNormalize
 *
 * Aggressively standardizes strings for cross-source matching by removing
 * all accents and non-alphanumeric characters.
 *
 * @param s The string to normalize.
 * @returns The lowercase alphanumeric-only string.
 */
export function superNormalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * UTILITY: cleanSclTitle
 *
 * Removes series indicators and other metadata suffixes from the SCL page title
 * to get the clean toy name.
 *
 * @param title The raw HTML title from the Skylanders Character List page.
 * @returns The standardized toy name.
 */
export function cleanSclTitle(title: string): string {
  return title
    .replace(
      /\s*\(\s*(Series\s*\d+|LightCore|Eon's Elite|Elite|Giant|Swap Force|Trap Team|SuperChargers|Imaginators)\s*\)/gi,
      '',
    )
    .replace(/\b(Series\s*\d+|LightCore|Eon's Elite|Elite)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const POSE_MODIFIERS = [
  'ninja',
  'turbo',
  'full-blast',
  'full blast',
  'hog-wild',
  'hog wild',
  'horn-blast',
  'horn blast',
  'mega-ram',
  'mega ram',
  'heavy-duty',
  'heavy duty',
  'big-bang',
  'big bang',
  'twin-blade',
  'twin blade',
  'blizzard',
  'anchors-away',
  'anchors away',
  'fizzy-frenzy',
  'fizzy frenzy',
  'sure-shot',
  'sure shot',
  'tidal-wave',
  'tidal wave',
  'deep-dive',
  'deep dive',
  'lava-barf',
  'lava barf',
  'volcanic',
  'knockout',
  'hyper-beam',
  'hyper beam',
  'thorn-horn',
  'thorn horn',
  'mega',
  'ram',
  'double-dare',
  'double dare',
  'double',
  'dare',
  'big',
  'bang',
  'heavy',
  'duty',
  'full',
  'blast',
  'hog',
  'wild',
  'fizzy',
  'frenzy',
  'sure',
  'shot',
  'tidal',
  'wave',
  'deep',
  'dive',
  'lava',
  'barf',
  'twin',
  'blade',
  'bone-bash',
  'bone bash',
  'bone',
  'bash',
  'hurricane',
  'shark-shooter',
  'shark',
  'shooter',
  'super-shot',
  'super shot',
  'super',
  'shot',
  'big-bubble',
  'big bubble',
  'bubble',
  'lava-lance',
  'lava lance',
  'lance',
  'fizz',
];

export const CRYSTAL_MAP: Record<string, string> = {
  // Air
  'air-creation-crystal': 'Air Angel Creation Crystal',
  'air-creation-crystal-2': 'Air Lantern Creation Crystal',
  // Dark
  'dark-creation-crystal': 'Dark Rune Creation Crystal',
  'dark-creation-crystal-2': 'Dark Pyramid Creation Crystal',
  'dark-creation-crystal-3': 'Dark Reactor Creation Crystal',
  // Earth
  'earth-creation-crystal': 'Earth Rocket Creation Crystal',
  'earth-armor-creation-crystal': 'Earth Armor Creation Crystal',
  // Fire
  'fire-creation-crystal': 'Fire Reactor Creation Crystal',
  'fire-creation-crystal-2': 'Fire Acorn Creation Crystal',
  // Life
  'life-creation-crystal': 'Life Rune Creation Crystal',
  'life-creation-crystal-2': 'Life Acorn Creation Crystal',
  'life-creation-crystal-3': 'Life Rocket Creation Crystal',
  'life-creation-crystal-4': 'Life Claw Creation Crystal',
  'legendary-life-creation-crystal': 'Legendary Life Acorn Creation Crystal',
  // Light
  'light-creation-crystal': 'Light Fanged Creation Crystal',
  'light-creation-crystal-2': 'Light Rune Creation Crystal',
  'legendary-light-creation-crystal': 'Legendary Light Fanged Creation Crystal',
  // Magic
  'magic-creation-crystal': 'Magic Pyramid Creation Crystal',
  'magic-creation-crystal-2': 'Magic Lantern Creation Crystal',
  'magic-creation-crystal-3': 'Magic Claw Creation Crystal',
  'legendary-magic-creation-crystal':
    'Legendary Magic Lantern Creation Crystal',
  // Tech
  'tech-creation-crystal': 'Tech Reactor Creation Crystal',
  'tech-creation-crystal-2': 'Tech Armor Creation Crystal',
  // Undead
  'undead-creation-crystal': 'Undead Fanged Creation Crystal',
  'undead-creation-crystal-2': 'Undead Claw Creation Crystal',
  'undead-creation-crystal-3': 'Undead Lantern Creation Crystal',
  // Water
  'water-creation-crystal': 'Water Rocket Creation Crystal',
  'water-creation-crystal-2': 'Water Creation Crystal',
  'water-creation-crystal-3': 'Water Fanged Creation Crystal',
  'water-creation-crystal-4': 'Water Armor Creation Crystal',
};

/**
 * Matches a Skylanders toy to entries in the scraped sitemap.
 *
 * @param toy The toy record from the database.
 * @param sitemap The parsed WordPress sitemap entries from Skylanders Character List.
 * @param allToysList Optional array of toys used to dynamically compute character series ranks.
 * @returns Array of matching sitemap entries.
 * @throws None.
 */
export function findSkylandersMatch(
  toy: Toy,
  sitemap: SitemapEntry[],
  allToysList?: { name: string; series: string }[],
): SitemapEntry[] {
  const toyNameLower = toy.name
    .toLowerCase()
    .replace('eggscellent', 'eggsellent')
    .replace('e3-exclusive', 'event-exclusive')
    .replace('e3 exclusive', 'event-exclusive')
    .replace(
      'power blue trigger happy',
      'power blue double dare trigger happy',
    );

  if (
    toyNameLower.includes('quick draw') ||
    toyNameLower.includes('quick-draw') ||
    toyNameLower.includes('quickdraw')
  ) {
    const match = sitemap.find((e) => {
      const loc = e.loc.toLowerCase();
      return (
        loc.includes('rattle') &&
        (loc.includes('quick') || loc.includes('draw'))
      );
    });
    if (match) return [match];
  }
  if (
    toyNameLower.includes('missile-tow') ||
    toyNameLower.includes('missile tow')
  ) {
    const match = sitemap.find(
      (e) =>
        e.loc.toLowerCase().includes('missile-tow-dive-clops') ||
        e.loc.toLowerCase().includes('missile-tow'),
    );
    if (match) return [match];
  }

  // 1. Trap Matching Logic for Series 4
  const TRAP_SHAPES = [
    'hourglass',
    'jughead',
    'screamer',
    'snake',
    'sword',
    'toucan',
    'hammer',
    'handstand',
    'orb',
    'totem',
    'scepter',
    'torch',
    'yawn',
    'spider',
    'owl',
    'rocket',
    'axe',
    'log holder',
    'log-holder',
    'skull',
    'angel',
    'flying helmet',
    'flying-helmet',
    'hand',
    'tiki',
    'spear',
    'hat',
  ];

  const isTrap =
    toy.series === '4' &&
    (toyNameLower.includes('trap') ||
      TRAP_SHAPES.some((shape) => toyNameLower.includes(shape)));

  if (isTrap) {
    if (
      toyNameLower.includes("undead captain's hat") ||
      toyNameLower.includes('undead captain’s hat')
    ) {
      const match = sitemap.find((e) =>
        e.loc.toLowerCase().includes('undead-spear-trap'),
      );
      if (match) return [match];
    }
    if (
      toyNameLower.includes("fire captain's hat") ||
      toyNameLower.includes('fire captain’s hat')
    ) {
      const match = sitemap.find((e) =>
        e.loc.toLowerCase().includes('fire-spear-trap'),
      );
      if (match) return [match];
    }
    if (toyNameLower.includes('ultimate kaos')) {
      const match = sitemap.find((e) =>
        e.loc.toLowerCase().includes('ultimate-kaos-trap'),
      );
      if (match) return [match];
    }
    if (toyNameLower.includes('kaos trap')) {
      const match = sitemap.find((e) =>
        e.loc.toLowerCase().endsWith('/kaos-trap/'),
      );
      if (match) return [match];
    }

    const elements = [
      'air',
      'dark',
      'earth',
      'fire',
      'life',
      'light',
      'magic',
      'tech',
      'undead',
      'water',
    ];
    const toyNorm = superNormalize(toy.name);
    const isLegendary = toyNameLower.includes('legendary');
    const isEaster =
      toyNameLower.includes('easter') || toyNameLower.includes('bunny');

    const trapCandidate = sitemap.find((entry) => {
      const loc = entry.loc.toLowerCase();
      if (!loc.includes('trap')) return false;
      const slug = loc
        .replace('https://skylanderscharacterlist.com/', '')
        .replace(/\/$/g, '');
      const slugNorm = superNormalize(slug);

      if (isLegendary !== slug.includes('legendary')) return false;
      if (isEaster !== (slug.includes('easter') || slug.includes('bunny'))) {
        return false;
      }

      const toyElem = elements.find((el) => toyNameLower.includes(el));
      const slugElem = elements.find((el) => slug.includes(el));
      if (toyElem && slugElem && toyElem !== slugElem) return false;

      for (const shape of TRAP_SHAPES) {
        const shapeClean = shape.replace(/[\s-]/g, '');
        if (toyNorm.includes(shapeClean) && slugNorm.includes(shapeClean)) {
          return true;
        }
      }
      return false;
    });

    if (trapCandidate) return [trapCandidate];
  }

  // 1.5. Custom check for Ghost Swords (force to pirate-ghost-swords to avoid card/gear)
  if (toyNameLower === 'ghost swords') {
    const match = sitemap.find((e) =>
      e.loc.toLowerCase().includes('pirate-ghost-swords'),
    );
    if (match) return [match];
  }

  // 2. Creation Crystal Static Map check
  const isCrystal =
    toy.series === '6' &&
    (toyNameLower.includes('rune') ||
      toyNameLower.includes('lantern') ||
      toyNameLower.includes('rocket') ||
      toyNameLower.includes('acorn') ||
      toyNameLower.includes('reactor') ||
      toyNameLower.includes('claw') ||
      toyNameLower.includes('fanged') ||
      toyNameLower.includes('pyramid') ||
      toyNameLower.includes('angel') ||
      toyNameLower.includes('chest') ||
      toyNameLower.includes('armor'));

  if (isCrystal) {
    const toyNorm = superNormalize(toy.name);
    let matchedSlug: string | null = null;
    for (const [slug, title] of Object.entries(CRYSTAL_MAP)) {
      const titleNorm = superNormalize(title);
      if (titleNorm.includes(toyNorm) || toyNorm.includes(titleNorm)) {
        matchedSlug = slug;
        break;
      }
    }
    if (matchedSlug) {
      const fullUrl = `https://skylanderscharacterlist.com/${matchedSlug}/`;
      const match = sitemap.find(
        (e) => e.loc.toLowerCase() === fullUrl.toLowerCase(),
      );
      if (match) return [match];
    }

    // Fallback: match by element + creation crystal in sitemap
    const elements = [
      'air',
      'dark',
      'earth',
      'fire',
      'life',
      'light',
      'magic',
      'tech',
      'undead',
      'water',
    ];
    const elem = elements.find((el) => toyNameLower.includes(el));
    const isLegendary = toyNameLower.includes('legendary');
    if (elem) {
      const crystalMatches = sitemap.filter((e) => {
        const slug = e.loc.toLowerCase();
        if (!slug.includes('creation-crystal') && !slug.includes('crystal')) {
          return false;
        }
        if (isLegendary !== slug.includes('legendary')) return false;
        return slug.includes(elem);
      });
      if (crystalMatches.length === 1) {
        return crystalMatches;
      }
      const shapeMatch = crystalMatches.find((e) => {
        const locNorm = superNormalize(e.loc);
        const imgNorm = e.images.map((img) => superNormalize(img)).join(' ');
        return locNorm.includes(toyNorm) || imgNorm.includes(toyNorm);
      });
      if (shapeMatch) return [shapeMatch];
      if (crystalMatches.length > 0) return [crystalMatches[0]];
    }
  }

  // 2.5. Custom check for SuperChargers Trophies
  if (toyNameLower.includes('trophy')) {
    const toyNorm = superNormalize(toy.name);
    const match = sitemap.find((e) => {
      const slug = e.loc
        .toLowerCase()
        .replace('https://skylanderscharacterlist.com/', '')
        .replace(/\/$/g, '');
      const slugNorm = superNormalize(slug);
      return (
        slugNorm === toyNorm ||
        slugNorm.includes(toyNorm) ||
        toyNorm.includes(slugNorm) ||
        (toyNameLower.includes('land') &&
          slugNorm.includes('land') &&
          slugNorm.includes('trophy')) ||
        (toyNameLower.includes('sea') &&
          slugNorm.includes('sea') &&
          slugNorm.includes('trophy')) ||
        (toyNameLower.includes('sky') &&
          slugNorm.includes('sky') &&
          slugNorm.includes('trophy')) ||
        (toyNameLower.includes('kaos') &&
          slugNorm.includes('kaos') &&
          slugNorm.includes('trophy'))
      );
    });
    if (match) return [match];
  }

  // 3. Custom check for Blue Chest CTT
  if (
    toyNameLower.includes('blue chest') &&
    (toyNameLower.includes('cursed tiki temple') ||
      toyNameLower.includes('ctt'))
  ) {
    const match = sitemap.find((e) =>
      e.loc.toLowerCase().includes('blue-chest-ctt'),
    );
    if (match) return [match];
  }

  const toyClean = extractBaseCharacterName(toy.name);
  const toyBaseNorm = superNormalize(toyClean.baseName);

  // Build series list dynamically for rank-based series matching
  const seriesList: number[] = [];
  if (allToysList) {
    for (const t of allToysList) {
      const base = extractBaseCharacterName(t.name).baseName;
      if (superNormalize(base) === toyBaseNorm) {
        const seriesNum = parseInt(t.series, 10);
        if (!isNaN(seriesNum) && !seriesList.includes(seriesNum)) {
          seriesList.push(seriesNum);
        }
      }
    }
    seriesList.sort((a, b) => a - b);
  }

  const toyPoseMods = toyClean.variantName
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => POSE_MODIFIERS.includes(w));

  let candidates = sitemap.filter((entry) => {
    const loc = entry.loc.toLowerCase();
    let slug = loc
      .replace('https://skylanderscharacterlist.com/', '')
      .replace(/\/$/g, '');

    slug = slug
      .replace('eggscellent', 'eggsellent')
      .replace('e3-exclusive', 'event-exclusive')
      .replace('e3exclusive', 'eventexclusive');

    const slugClean = slug.replace(/['’.]/g, '');

    // Basic Exclusions
    if (
      slug.includes('review') ||
      slug.includes('unboxing') ||
      slug.includes('giveaway') ||
      slug.includes('servers-shutting-down')
    ) {
      return false;
    }
    if (slug.includes('spell') && !toyNameLower.includes('spell')) return false;
    if (slug.includes('hat') && !toyNameLower.includes('hat')) return false;
    if (slug.includes('card') && !toyNameLower.includes('card')) return false;
    if (
      (slug.includes('skylander') || slug.includes('skylanders')) &&
      !toyNameLower.includes('skylander') &&
      !toyNameLower.includes('skylanders')
    )
      return false;

    // Extract from slug
    const slugName = slug.replace(/-/g, ' ');
    const slugCleanInfo = extractBaseCharacterName(slugName);
    const slugBaseNorm = superNormalize(slugCleanInfo.baseName);

    // Base character name check
    if (toyBaseNorm !== slugBaseNorm) {
      return false;
    }

    // Series Check
    let bypassSeriesCheck = false;
    const isMiniSlug = slug.startsWith('mini-') || slug.includes('-mini');
    const isSidekickSlug =
      slug.startsWith('sidekick-') || slug.includes('-sidekick');

    const toyHasPose = toyPoseMods.length > 0;
    const slugHasPose = POSE_MODIFIERS.some((pm) => {
      const pmClean = pm.replace(/-/g, '');
      return slugClean.replace(/-/g, '').includes(pmClean);
    });

    if (
      toyNameLower.includes('lightcore') ||
      slug.includes('lightcore') ||
      toyNameLower.includes('dark') ||
      slug.includes('dark') ||
      toyNameLower.includes('legendary') ||
      slug.includes('legendary') ||
      toyNameLower.includes('springtime') ||
      slug.includes('springtime') ||
      toyNameLower.includes('double dare') ||
      toyNameLower.includes('double-dare') ||
      toyNameLower.includes('power blue') ||
      toyNameLower.includes('power-blue') ||
      toyNameLower.includes('bone bash') ||
      toyNameLower.includes('bone-bash') ||
      toyNameLower.includes('event exclusive') ||
      toyNameLower.includes('event-exclusive') ||
      toyNameLower.includes('e3 exclusive') ||
      toyNameLower.includes('e3-exclusive') ||
      toyNameLower.includes('gnarly') ||
      slug.includes('gnarly') ||
      toyNameLower.includes('missile') ||
      slug.includes('missile') ||
      toyNameLower.includes('mystical') ||
      slug.includes('mystical') ||
      toyNameLower.includes('jingle bell') ||
      slug.includes('jingle-bell') ||
      toyNameLower.includes('steel plated') ||
      slug.includes('steel-plated') ||
      toyNameLower.includes('polar') ||
      slug.includes('polar') ||
      toyNameLower.includes('quick') ||
      slug.includes('quick') ||
      toyNameLower.includes('kickoff') ||
      slug.includes('kickoff') ||
      isMiniSlug ||
      isSidekickSlug ||
      toyHasPose ||
      slugHasPose
    ) {
      bypassSeriesCheck = true;
    }

    let expectedSeries: string | number = 1;
    if (toy.series === "Eon's Elite") {
      expectedSeries = "Eon's Elite";
    } else {
      const toySeriesNum = parseInt(toy.series || '', 10);
      if (!isNaN(toySeriesNum)) {
        expectedSeries =
          seriesList.length > 0 ? seriesList.indexOf(toySeriesNum) + 1 : 1;
      }
    }

    let slugSeries: string | number | null = null;
    if (slug.includes('series-2') || slug.includes('series2')) slugSeries = 2;
    else if (slug.includes('series-3') || slug.includes('series3'))
      slugSeries = 3;
    else if (slug.includes('series-4') || slug.includes('series4'))
      slugSeries = 4;
    else if (slug.includes('eons-elite') || slug.includes('elite'))
      slugSeries = "Eon's Elite";

    if (bypassSeriesCheck) {
      if (slugSeries !== null && expectedSeries !== slugSeries) {
        return false;
      }
    } else {
      const finalSlugSeries = slugSeries !== null ? slugSeries : 1;
      if (expectedSeries !== finalSlugSeries) {
        return false;
      }
    }

    // Sensei vs Villain figure check for Series 6
    if (toy.series === '6') {
      const hasFigureInSlug = slug.endsWith('-figure');
      const characterHasFigurePage = sitemap.some((e) => {
        const s = e.loc
          .toLowerCase()
          .replace('https://skylanderscharacterlist.com/', '')
          .replace(/\/$/g, '');
        return (
          s.endsWith('-figure') &&
          superNormalize(s).replace('figure', '') === toyBaseNorm
        );
      });
      const toyHasExplicitVariant =
        toyClean.variantName.length > 0 || slugCleanInfo.variantName.length > 0;
      if (
        characterHasFigurePage &&
        !hasFigureInSlug &&
        !toyHasExplicitVariant
      ) {
        return false;
      }
    }

    // Strict variant modifier checks:
    const toyMods = toyClean.variantName
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 0);
    const slugMods = slugCleanInfo.variantName
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 0);

    // CRITICAL: Reject if slug has legendary/lightcore/dark/etc. but toy doesn't
    const criticalModifiers = [
      'legendary',
      'lightcore',
      'dark',
      'gold',
      'silver',
      'bronze',
      'steel-plated',
      'mystical',
      'solar-flare',
      'candy-coated',
      'heartbreaker',
      'jingle-bell',
      'power-blue',
      'power-punch',
      'eggscellent',
      'eggsellent',
      'nitro',
      'jade',
      'enchanted',
      'polar',
      'molten',
      'scarlet',
      'punch',
      'royal',
      'quick-draw',
      'quick',
      'missile-tow',
      'missile',
      'kickoff',
      'springtime',
    ];
    for (const crit of criticalModifiers) {
      const critClean = crit.replace(/-/g, '');
      const slugHasCrit = slugClean.replace(/-/g, '').includes(critClean);
      const toyHasCrit = toyNameLower
        .replace(/[^a-z0-9]/g, '')
        .includes(critClean);
      if (slugHasCrit && !toyHasCrit) {
        return false;
      }
      if (toyHasCrit && !slugHasCrit) {
        return false;
      }
    }

    const isVariantMismatch =
      toyMods.some((m) => {
        if (POSE_MODIFIERS.includes(m)) return false;
        const mClean = m.replace(/-/g, '');
        const slugCleanNoDash = slugClean.replace(/-/g, '');
        return !slugCleanNoDash.includes(mClean);
      }) ||
      slugMods.some((m) => {
        if (m === 'series' || m.match(/^\d+$/) || m === 'elite' || m === 'eon')
          return false;
        if (isMiniSlug && m === 'mini' && toy.series === '4') return false;
        if (
          isSidekickSlug &&
          m === 'sidekick' &&
          (toy.series === '1' || toy.series === '2')
        )
          return false;
        if (
          (m === 'elite' || m === 'eon' || m === 'eons') &&
          toy.series === "Eon's Elite"
        )
          return false;

        // Reject slug if it contains a pose modifier NOT in the toy name
        if (POSE_MODIFIERS.includes(m)) {
          const mClean = m.replace(/-/g, '');
          const toyCleanNoDash = toyNameLower.replace(/[^a-z0-9]/g, '');
          return !toyCleanNoDash.includes(mClean);
        }

        const mClean = m.replace(/-/g, '');
        const toyCleanNoDash = toyNameLower.replace(/[^a-z0-9]/g, '');
        return !toyCleanNoDash.includes(mClean);
      });

    if (isVariantMismatch) {
      return false;
    }

    return true;
  });

  // Tie breaker 1: Prefer exact pose modifier matches if toy name contains one
  if (toyPoseMods.length > 0 && candidates.length > 1) {
    const matchingPose = candidates.filter((c) => {
      const cSlug = c.loc.toLowerCase();
      return toyPoseMods.every((pm) =>
        cSlug.replace(/-/g, '').includes(pm.replace(/-/g, '')),
      );
    });
    if (matchingPose.length > 0) {
      candidates = matchingPose;
    }
  }

  // Tie breaker 2: Sky-Iron Shield / gear
  if (candidates.length > 1) {
    const nonGear = candidates.filter(
      (c) => !c.loc.toLowerCase().includes('-gear'),
    );
    if (nonGear.length > 0) {
      candidates = nonGear;
    }
  }

  // Tie breaker 3: Prefer explicit series match if multiple candidates exist
  if (candidates.length > 1) {
    let expectedSeries: string | number = 1;
    if (toy.series === "Eon's Elite") {
      expectedSeries = "Eon's Elite";
    } else {
      const toySeriesNum = parseInt(toy.series || '', 10);
      if (!isNaN(toySeriesNum)) {
        expectedSeries =
          seriesList.length > 0
            ? seriesList.indexOf(toySeriesNum) + 1
            : toySeriesNum;
      }
    }

    const explicitSeriesMatches = candidates.filter((c) => {
      const loc = c.loc.toLowerCase();
      const slug = loc
        .replace('https://skylanderscharacterlist.com/', '')
        .replace(/\/$/g, '');
      let slugSeries: string | number | null = null;
      if (slug.includes('series-2') || slug.includes('series2')) slugSeries = 2;
      else if (slug.includes('series-3') || slug.includes('series3'))
        slugSeries = 3;
      else if (slug.includes('series-4') || slug.includes('series4'))
        slugSeries = 4;
      else if (slug.includes('eons-elite') || slug.includes('elite'))
        slugSeries = "Eon's Elite";

      return slugSeries === expectedSeries;
    });

    if (explicitSeriesMatches.length > 0) {
      candidates = explicitSeriesMatches;
    }
  }

  return candidates;
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
      const nameLower = (t.name || '').toLowerCase().trim();
      if (typeLower === 'vehicle') {
        categoryOrder = 2;
      } else if (
        typeLower === 'creation crystal' ||
        typeLower.includes('crystal') ||
        (t.series === '6' &&
          (nameLower.includes('creation crystal') ||
            nameLower.includes('crystal') ||
            nameLower.includes('rune') ||
            nameLower.includes('lantern') ||
            nameLower.includes('rocket') ||
            nameLower.includes('acorn') ||
            nameLower.includes('reactor') ||
            nameLower.includes('claw') ||
            nameLower.includes('fanged') ||
            nameLower.includes('pyramid') ||
            nameLower.includes('angel') ||
            nameLower.includes('armor')))
      ) {
        categoryOrder = 3;
      } else if (typeLower === 'trap' || nameLower.includes('trap')) {
        categoryOrder = 4;
      } else if (
        typeLower === 'magic item' ||
        typeLower === 'trophy' ||
        typeLower === 'adventure pack' ||
        nameLower.includes('trophy') ||
        nameLower.includes('adventure pack') ||
        !element ||
        element === 'kaos/other'
      ) {
        categoryOrder = 5;
      }

      // Calculate Subtype priority within characters (category 1):
      // 1 = Gimmick (Giants, SWAP Force, Trap Master, Sensei)
      // 2 = Standard (Series 1-4, SuperCharger, Figure)
      // 3 = LightCore
      // 4 = Minis/Sidekicks (Mini, Sidekicks, Sidekick)
      let subtypePriority = 5;
      if (categoryOrder === 1) {
        const tType = t.type || '';
        const tNameLower = t.name.toLowerCase();
        if (
          tType === 'Giants' ||
          tType === 'SWAP Force' ||
          tType === 'Trap Master' ||
          tType === 'Sensei'
        ) {
          subtypePriority = 1;
        } else if (
          tType === 'Mini' ||
          tType === 'Sidekicks' ||
          tType === 'Sidekick' ||
          tNameLower.includes('sidekick') ||
          tNameLower.startsWith('mini ') ||
          tNameLower.endsWith(' mini')
        ) {
          subtypePriority = 4;
        } else if (tType === 'LightCore') {
          subtypePriority = 3;
        } else if (
          tType.startsWith('Series') ||
          tType === 'SuperCharger' ||
          tType === 'Figure'
        ) {
          subtypePriority = 2;
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
