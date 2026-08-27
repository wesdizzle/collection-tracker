import axios from 'axios';
import { getAccessToken } from './igdb-auth.js';
import 'dotenv/config';

const IGDB_ENDPOINT = 'https://api.igdb.com/v4';

/**
 * IGDB Type Definitions
 */
export interface IGDBPlatform {
  id: number;
  name: string;
}

export interface IGDBImage {
  id: number;
  url: string;
  image_id?: string;
}

export interface IGDBGame {
  id: number;
  name: string;
  slug?: string;
  url?: string;
  summary?: string;
  cover?: IGDBImage;
  first_release_date?: number;
  platforms?: IGDBPlatform[];
  collections?: { id: number; name: string }[];
  franchises?: { id: number; name: string }[];
  genres?: { name: string }[];
  themes?: { name: string }[];
  category?: number;
  game_type?: number;
  version_parent?:
    | number
    | {
        id: number;
        collections?: { id: number; name: string }[];
        franchises?: { id: number; name: string }[];
      };
  release_dates?: { platform?: number; region: number; date: number }[];
  confidence?: number;
  bundles?: number[];
}

export interface NormalizedGame {
  id: string;
  slug: string | null;
  igdb_url: string | null;
  name: string;
  summary?: string;
  image_url: string | null;
  platform: string;
  platforms: IGDBPlatform[];
  platform_ids: number[];
  release_date: string | null;
  release_dates?: { platform?: number; region: number; date: number }[];
  collections: string | null;
  franchises: string | null;
  category?: number;
  region: string;
  confidence: number;
  genres: string | null;
  flagged_outlier?: boolean;
}

// Map of local platform names to IGDB platform IDs
export const PLATFORM_MAP: Record<string, number> = {
  '3DO Interactive Multiplayer': 50,
  'Atari 2600': 59,
  'Atari Video Computer System': 59,
  'Atari 5200': 66,
  'Atari 5200 SuperSystem': 66,
  'Atari 7800': 60,
  'Atari 7800 ProSystem': 60,
  'Atari Lynx': 61,
  'Atari Jaguar': 62,
  ColecoVision: 67,
  Intellivision: 68,
  'Neo Geo Pocket Color': 120,
  'Nintendo Entertainment System': 18,
  'Game Boy': 33,
  'Super Nintendo Entertainment System': 19,
  'Virtual Boy': 87,
  'Nintendo 64': 4,
  'Game Boy Color': 22,
  'Game Boy Advance': 24,
  'Nintendo GameCube': 21,
  'Nintendo DS': 20,
  Wii: 5,
  'Nintendo 3DS': 37,
  'Wii U': 41,
  'New Nintendo 3DS': 137,
  'Nintendo Switch': 130,
  PlayStation: 7,
  'PlayStation 2': 8,
  'PlayStation Portable': 38,
  'PlayStation 3': 9,
  'PlayStation Vita': 46,
  'PlayStation 4': 48,
  'PlayStation 5': 167,
  'Sega Master System': 64,
  'Sega Genesis': 29,
  'Sega Game Gear': 35,
  'Game Gear': 35,
  'Sega CD': 78,
  'Sega 32X': 30,
  'Sega Saturn': 32,
  Dreamcast: 23,
  'TurboGrafx-16': 86,
  'TurboGrafx 16': 86,
  Xbox: 11,
  'Xbox 360': 12,
  'Xbox One': 49,
  'Xbox Series X': 169,
  'Game.com': 379,
  'Neo Geo AES': 80,
  'Neo Geo Advanced Entertainment System': 80,
  'Neo Geo CD': 136,
  'Neo Geo X': 80,
  'Philips CD-i': 117,
  'Sega Pico': 339,
  'TurboGrafx-CD': 150,
  'TurboGrafx CD': 150,
  'PlayStation VR': 165,
  'PlayStation VR2': 390,
  Famicom: 18,
  'Nintendo Switch 2': 130,
};

/**
 * Guideline active lifespan windows for platforms [startYear, endYear].
 * Used to prioritize original platform release dates over digital re-releases (e.g. Virtual Console)
 * while preserving late/boutique physical releases with outlier warning flags.
 */
export const PLATFORM_LIFESPANS: Record<number, [number, number]> = {
  18: [1983, 1996], // NES
  19: [1990, 2001], // SNES
  4: [1996, 2003], // N64
  21: [2001, 2008], // GameCube
  5: [2006, 2017], // Wii
  41: [2012, 2019], // Wii U
  130: [2017, 2035], // Nintendo Switch
  33: [1989, 2003], // Game Boy
  22: [1998, 2004], // Game Boy Color
  24: [2001, 2009], // Game Boy Advance
  20: [2004, 2014], // Nintendo DS
  37: [2011, 2023], // Nintendo 3DS (Physical releases through Fragrant Story/Andro Dunos 2 in 2022)
  137: [2014, 2023], // New Nintendo 3DS
  7: [1994, 2006], // PlayStation
  8: [2000, 2014], // PlayStation 2
  9: [2006, 2017], // PlayStation 3
  48: [2013, 2026], // PlayStation 4
  167: [2020, 2035], // PlayStation 5
  38: [2004, 2015], // PSP
  46: [2011, 2020], // PS Vita
  64: [1985, 1997], // Sega Master System
  29: [1988, 1999], // Sega Genesis
  35: [1990, 1997], // Game Gear
  78: [1991, 1997], // Sega CD
  30: [1994, 1997], // Sega 32X
  32: [1994, 2001], // Sega Saturn
  23: [1998, 2007], // Dreamcast
  86: [1987, 1995], // TurboGrafx-16
  150: [1989, 1996], // TurboGrafx-CD
  11: [2001, 2009], // Xbox
  12: [2005, 2017], // Xbox 360
  49: [2013, 2026], // Xbox One (Cross-gen physical releases ongoing)
  169: [2020, 2035], // Xbox Series X
  59: [1977, 1992], // Atari 2600
  66: [1982, 1985], // Atari 5200
  60: [1986, 1992], // Atari 7800
  61: [1989, 1996], // Atari Lynx
  62: [1993, 1997], // Atari Jaguar
  67: [1982, 1985], // ColecoVision
  68: [1979, 1990], // Intellivision
  50: [1993, 1997], // 3DO
  120: [1999, 2002], // Neo Geo Pocket Color
  80: [1990, 2004], // Neo Geo AES
};

// Platforms that are primarily physical for historical consoles
// NOTE: Kept for reference but commented out to satisfy linter if unused
// const PHYSICAL_DOMINANT_PLATFORMS = [
//     5, 7, 8, 9, 11, 12, 15, 18, 19, 21, 23, 29, 30, 32, 33, 35, 37, 38, 41, 46, 48, 49, 50, 59, 60, 61, 62, 64, 66, 67, 86, 120, 130, 167, 169
// ];

/**
 * REGIONAL OVERRIDES
 * Maps specific game titles or IGDB IDs to their required region strings.
 * This is prioritized over all automated heuristics.
 */
export const REGIONAL_OVERRIDES: Record<string, string> = {
  // Exact Titles
  'Pico Park 1 + 2': 'JP',
  'Pico Park 1+2': 'JP',
  'Mother 3': 'JP',
  'Taiko no Tatsujin DS': 'JP',
  'Meccha! Taiko no Tatsujin DS - 7-tsu no Shima no Daibouken': 'JP',
  'Meccha! Taiko no Tatsujin DS: 7-tsu no Shima no Daibouken': 'JP',
  'Metcha! Taiko no Tatsujin DS: 7-tsu no Shima no Daibouken': 'JP',
  'Star Wars: Masters of Teräs Käsi': 'NA',
  'Super Mario All-Stars 25th Anniversary Edition': 'NA',
  'Harvest Moon 3D: The Tale of Two Towns': 'NA',
  'The Elder Scrolls Online: Tamriel Unlimited': 'NA',
  'Xbox 360 Triple Pack': 'NA',
  'Batman: Return of the Joker': 'NA',
  'Sonic the Hedgehog (1991)': 'EU', // For Master System canonical EU releases
  'Mario Kart 8 Deluxe + Booster Course Pass': 'SEA',
  'Chrono Cross: The Radical Dreamers Edition': 'SEA',
  'Chrono Cross: The Radical Dreamers': 'SEA',

  // IGDB IDs (More stable)
  'igdb-328142': 'JP', // Pico Park 1+2
  'igdb-3683': 'JP', // Mother 3
  'igdb-245049': 'SEA', // Mario Kart 8 Deluxe + BCP
  'igdb-188613': 'SEA', // Chrono Cross: The Radical Dreamers Edition
  'igdb-106274': 'EU', // Sonic the Hedgehog (Master System / GG)
  'igdb-72548': 'JP', // Meccha! Taiko no Tatsujin DS
};

/**
 * DATE OVERRIDES
 * Maps IGDB ID + Platform ID keys to exact release dates to override IGDB upstream data bugs.
 */
export const DATE_OVERRIDES: Record<string, string> = {
  'igdb-41862-130': '2019-05-21', // Resident Evil: Origins Collection (Nintendo Switch)
  'igdb-119280-130': '2019-09-20', // Ni no Kuni: Wrath of the White Witch (Nintendo Switch)
  'igdb-191632-130': '2022-04-20', // Star Wars: The Force Unleashed (Nintendo Switch)
  'igdb-1819-59': '1980-03-31', // Space Invaders (Atari 2600)
  'igdb-1047-33': '1989-07-31', // Tetris (Game Boy)
  'igdb-26197-24': '2001-12-05', // Star Wars: Episode I - Jedi Power Battles (Game Boy Advance)
  'igdb-2933-21': '2004-08-30', // Pikmin 2 (Nintendo GameCube)
};

/**
 * Recognized boutique / aftermarket physical releases on legacy hardware.
 * Format: 'igdb-<igdb_id>-<igdb_platform_id>'
 */
export const BOUTIQUE_PHYSICAL_RELEASES = new Set<string>([
  'igdb-203442-24', // Shantae Advance: Risky Revolution (Game Boy Advance)
  'igdb-197992-37', // Fragrant Story (Nintendo 3DS)
  'igdb-14694-9', // Shakedown: Hawaii (PlayStation 3)
]);

/**
 * UTILITY: queryIGDB
 *
 * Performs a raw query against the IGDB API with retries and rate limiting.
 */
export async function queryIGDB(
  endpoint: string,
  query: string,
): Promise<unknown[]> {
  const token = await getAccessToken();
  const maxRetries = 3;
  let attempt = 0;

  const clientId = process.env['TWITCH_CLIENT_ID'];

  while (attempt < maxRetries) {
    try {
      const response = await axios.post(`${IGDB_ENDPOINT}/${endpoint}`, query, {
        headers: {
          'Client-ID': clientId,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'text/plain',
        },
      });
      // 500ms delay to safely stay under 4 RPS (targeting 2 RPS)
      await new Promise((resolve) => setTimeout(resolve, 500));
      return response.data as unknown[];
    } catch (error: unknown) {
      const err = error as {
        response?: { status?: number; data?: unknown };
        message: string;
      };
      if (err.response?.status === 429) {
        attempt++;
        const delay = Math.pow(2, attempt) * 1000;
        console.warn(
          `  Rate limited (429). Retrying in ${delay}ms... (Attempt ${attempt}/${maxRetries})`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      console.error(
        `IGDB Error (${endpoint}):`,
        err.response?.data || err.message,
      );
      return [];
    }
  }
  return [];
}

/**
 * Searches for a game with metadata, strictly filtering by platform ID and official releases.
 */
export async function findGame(
  title: string,
  platformId: number,
): Promise<NormalizedGame[] | null> {
  const trackedIgdbIds = Array.from(
    new Set(Object.values(PLATFORM_MAP)),
  ).filter((id): id is number => typeof id === 'number' && id > 0);

  let platformFilter = platformId
    ? `platforms = (${platformId})`
    : `platforms = (${trackedIgdbIds.join(',')})`;

  // VR Heuristic: If searching for PS4/PS5, also look for PSVR/PSVR2
  if (platformId === 48) platformFilter = 'platforms = (48, 165)';
  if (platformId === 167) platformFilter = 'platforms = (167, 390)';

  // Clean title for search
  const cleanTitle = title
    .replace(/[–—]/g, '-')
    .replace(/[":()]/g, '')
    .trim();

  // SPECIAL CASE: The LEGO Movie Videogame (3DS) - IGDB is missing 3DS platform but it is the correct entity
  if (
    cleanTitle.toLowerCase() === 'the lego movie videogame' &&
    platformId === 37
  ) {
    return getGameById(4845, 37).then((g) => (g ? [g] : null));
  }

  // SPECIAL CASE: 20XX/30XX (Switch)
  if (cleanTitle.toLowerCase() === '20xx/30xx' && platformId === 130) {
    return getGameById(364164, 130).then((g) => (g ? [g] : null));
  }

  // SPECIAL CASE: Star Wars: Masters of Teräs Käsi (PS1)
  if (cleanTitle.toLowerCase().includes('teras kasi') && platformId === 7) {
    // Star Wars: Masters of Teräs Käsi is ID 1341 (Wait, let's verify ID)
    // I'll use a safer search if ID is uncertain, but search is failing.
    // Let's try searching with 'teras kasi' literal.
  }

  // SPECIAL CASE: Super Mario All-Stars 25th Anniversary Edition (Wii)
  if (
    cleanTitle.toLowerCase().includes('mario all-stars 25th') &&
    platformId === 5
  ) {
    return getGameById(84920, 5).then((g) => (g ? [g] : null));
  }

  // SPECIAL CASE: Harvest Moon 3D: The Tale of Two Towns (3DS)
  if (
    cleanTitle.toLowerCase().includes('tale of two towns') &&
    platformId === 37
  ) {
    return getGameById(3392, 37).then((g) => (g ? [g] : null));
  }

  // SPECIAL CASE: The Elder Scrolls Online (PS4/Xbox)
  if (
    cleanTitle.toLowerCase().includes('elder scrolls online') &&
    (platformId === 48 || platformId === 49)
  ) {
    return getGameById(1081, platformId).then((g) => (g ? [g] : null));
  }

  // SPECIAL CASE: Triple Pack: Trials HD, Limbo, Splosion Man (Xbox 360)
  if (
    cleanTitle.toLowerCase().includes('triple pack') &&
    cleanTitle.toLowerCase().includes('trials hd') &&
    platformId === 12
  ) {
    return getGameById(141767, 12).then((g) => (g ? [g] : null));
  }

  // SPECIAL CASE: Doom (SNES) - ID 259982 has the correct cover art
  if (cleanTitle.toLowerCase() === 'doom' && platformId === 19) {
    return getGameById(259982, 19).then((g) => (g ? [g] : null));
  }

  // SPECIAL CASE: Sonic the Hedgehog 3 (Genesis) - ID 6797 is the canonical game
  if (
    cleanTitle.toLowerCase() === 'sonic the hedgehog 3' &&
    platformId === 29
  ) {
    return getGameById(6797, 29).then((g) => (g ? [g] : null));
  }

  const searchQuery = `
        fields name, slug, url, summary, cover.url, first_release_date, platforms.name, collections.id, collections.name, franchises.id, franchises.name, genres.name, themes.name, category, version_parent, release_dates.platform, release_dates.region, release_dates.date;
        search "${cleanTitle.replace(/"/g, '')}";
        ${platformFilter ? `where ${platformFilter};` : ''}
        limit 50;
    `;

  const nameQuery = `
        fields name, slug, url, summary, cover.url, first_release_date, platforms.name, collections.id, collections.name, franchises.id, franchises.name, genres.name, themes.name, category, version_parent, release_dates.platform, release_dates.region, release_dates.date;
        where name ~ "${cleanTitle.replace(/"/g, '')}"${platformFilter ? ` & ${platformFilter}` : ''};
        limit 50;
    `;

  try {
    // Pass 1: Exact search
    const [searchResults, nameResults] = await Promise.all([
      queryIGDB('games', searchQuery) as Promise<IGDBGame[]>,
      queryIGDB('games', nameQuery) as Promise<IGDBGame[]>,
    ]);

    let results: IGDBGame[] = [
      ...(searchResults || []),
      ...(nameResults || []),
    ];

    // Pass 2: Fallback to simplified title if results are poor
    if (!results || results.length < 2) {
      const simplifiedTitle = getSimplifiedTitle(cleanTitle);
      if (simplifiedTitle !== cleanTitle) {
        console.log(
          `  Falling back to simplified search: "${simplifiedTitle}"`,
        );
        const fallbackSearchQuery = `
                    fields name, slug, url, summary, cover.url, first_release_date, platforms.name, collections.id, collections.name, franchises.id, franchises.name, genres.name, themes.name, category, version_parent, release_dates.platform, release_dates.region, release_dates.date;
                    search "${simplifiedTitle.replace(/"/g, '')}";
                    ${platformFilter ? `where platforms = (${platformId});` : ''}
                    limit 50;
                `;
        const fallbackNameQuery = `
                    fields name, slug, url, summary, cover.url, first_release_date, platforms.name, collections.id, collections.name, franchises.id, franchises.name, genres.name, themes.name, category, version_parent, release_dates.platform, release_dates.region, release_dates.date;
                    where name ~ "${simplifiedTitle.replace(/"/g, '')}"${platformFilter ? ` & platforms = (${platformId})` : ''};
                    limit 50;
                `;
        const [fallbackSearch, fallbackName] = await Promise.all([
          queryIGDB('games', fallbackSearchQuery) as Promise<IGDBGame[]>,
          queryIGDB('games', fallbackNameQuery) as Promise<IGDBGame[]>,
        ]);
        results = [
          ...results,
          ...(fallbackSearch || []),
          ...(fallbackName || []),
        ];
      }
    }

    // Pass 3: Ultra-aggressive fallback (remove all known suffixes)
    if (!results || results.length === 0) {
      const ultraSimplified = superNormalize(cleanTitle, true);
      if (
        ultraSimplified &&
        ultraSimplified !==
          cleanTitle
            .toLowerCase()
            .replace(/[^a-z0-9 ]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
      ) {
        console.log(
          `  Falling back to ultra-simplified search: "${ultraSimplified}"`,
        );
        const ultraSearchQuery = `
                    fields name, slug, url, summary, cover.url, first_release_date, platforms.name, collections.id, collections.name, franchises.id, franchises.name, genres.name, themes.name, category, version_parent, release_dates.platform, release_dates.region, release_dates.date;
                    search "${ultraSimplified}";
                    ${platformFilter ? `where platforms = (${platformId});` : ''}
                    limit 50;
                `;
        const ultraResults = (await queryIGDB(
          'games',
          ultraSearchQuery,
        )) as IGDBGame[];
        results = [...results, ...(ultraResults || [])];
      }
    }

    if (!results || results.length === 0) return [];

    // De-duplicate by ID
    const seen = new Set<number>();
    const uniqueResults = results.filter((g) => {
      if (seen.has(g.id)) return false;
      seen.add(g.id);
      return true;
    });

    // Filter for official categories only
    const officialCategories = [0, 8, 9, 10, 11, 13, 14, undefined, null];
    const initialFiltered = uniqueResults.filter((g) =>
      officialCategories.includes(g.category),
    );

    if (initialFiltered.length === 0) return [];

    const filteredResults = initialFiltered.filter((g) => {
      const lowerName = g.name.toLowerCase();
      const lowerSummary = (g.summary || '').toLowerCase();
      if (g.category === 12) return false;

      const hackKeywords = [
        ' hack:',
        ' hack)',
        ' hack!',
        ' hack\n',
        'level hack',
        'fan translation',
        'patched version',
        'fan-made',
        'fanmade',
        'fan project',
        'unofficial',
        'rom hack',
        'romhack',
        ' graphics mod ',
        ' graphics mod:',
        ' a mod for ',
        ' this mod ',
        ' modded ',
        ' mod:',
        ' mod)',
      ];

      const isHack = hackKeywords.some(
        (kw) => lowerName.includes(kw) || lowerSummary.includes(kw),
      );
      if (isHack && g.category !== 5) return false;

      return true;
    });

    if (filteredResults.length === 0) return [];

    return filteredResults
      .map((game) => normalizeIGDBGame(game, title, platformId))
      .sort((a, b) => {
        // Primary: Confidence
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        // Secondary: Category priority (Main Game > Remake > Remaster > Port > Bundle)
        const catA = a.category ?? 0;
        const catB = b.category ?? 0;
        if (catA !== catB) {
          const priority: Record<number, number> = {
            0: 10,
            8: 9,
            9: 8,
            10: 7,
            11: 6,
            13: 5,
            14: 4,
          };
          return (priority[catB] || 0) - (priority[catA] || 0);
        }
        return 0;
      });
  } catch (error: unknown) {
    const err = error as { message: string };
    console.error('Error finding game:', err.message);
    return null;
  }
}

/**
 * Fetches a single game by its IGDB ID.
 * If the game is a bundle (category 3), it aggregates collections/franchises from its members.
 */
export async function getGameById(
  igdbId: number,
  platformId?: number,
): Promise<NormalizedGame | null> {
  const fields = `name, slug, url, summary, cover.url, first_release_date, platforms.name, collections.id, collections.name, franchises.id, franchises.name, genres.name, themes.name, category, game_type, version_parent.id, version_parent.collections.name, version_parent.franchises.name, release_dates.platform, release_dates.region, release_dates.date`;
  const query = `
        fields ${fields};
        where id = ${igdbId};
    `;

  try {
    const results = (await queryIGDB('games', query)) as IGDBGame[];
    if (!results || results.length === 0) return null;
    const game = results[0];
    const category = game.game_type ?? game.category;

    // 1. If it's a bundle, fetch members and aggregate metadata
    if (category === 3) {
      const memberFields = `name, summary, cover.url, first_release_date, collections.name, franchises.id, franchises.name, genres.name`;
      const memberQuery = `fields ${memberFields}; where bundles = (${game.id});`;
      const members = (await queryIGDB('games', memberQuery)) as IGDBGame[];

      if (members.length > 0) {
        // Aggregate collections/franchises
        const collections = new Set(game.collections?.map((c) => c.name) || []);
        const franchises = new Set(game.franchises?.map((f) => f.name) || []);
        const genres = new Set(game.genres?.map((g) => g.name) || []);

        for (const member of members) {
          member.collections?.forEach((c) => collections.add(c.name));
          member.franchises?.forEach((f) => franchises.add(f.name));
          member.genres?.forEach((g) => genres.add(g.name));
        }

        game.collections = Array.from(collections).map((name) => ({
          id: 0,
          name,
        }));
        game.franchises = Array.from(franchises).map((name) => ({
          id: 0,
          name,
        }));
        game.genres = Array.from(genres).map((name) => ({ name }));

        // Aggregate Summary in release order if bundle summary is missing or short
        if (!game.summary || game.summary.length < 50) {
          const sortedMembers = [...members].sort(
            (a, b) => (a.first_release_date || 0) - (b.first_release_date || 0),
          );
          const aggregatedSummary = sortedMembers
            .map((m) => m.summary?.trim())
            .filter((s) => !!s)
            .join('\n\n');
          if (aggregatedSummary) {
            game.summary = aggregatedSummary;
          }
        }

        // Use cover from most recent component if bundle cover is missing
        if (!game.cover) {
          const mostRecent = [...members].sort(
            (a, b) => (b.first_release_date || 0) - (a.first_release_date || 0),
          )[0];
          if (mostRecent?.cover) {
            game.cover = mostRecent.cover;
          }
        }
      }
    }

    // 2. If it has a version_parent with collections/franchises, inherit them
    if (game.version_parent && typeof game.version_parent === 'object') {
      interface ParentInfo {
        collections?: { name: string }[];
        franchises?: { name: string }[];
      }
      const parent = game.version_parent as ParentInfo;
      if (parent.collections || parent.franchises) {
        const collections = new Set(game.collections?.map((c) => c.name) || []);
        const franchises = new Set(game.franchises?.map((f) => f.name) || []);

        parent.collections?.forEach((c) => collections.add(c.name));
        parent.franchises?.forEach((f) => franchises.add(f.name));

        game.collections = Array.from(collections).map((name) => ({
          id: 0,
          name,
        }));
        game.franchises = Array.from(franchises).map((name) => ({
          id: 0,
          name,
        }));
      }
    }

    return normalizeIGDBGame(game, game.name, platformId);
  } catch (error: unknown) {
    const err = error as { message: string };
    console.error('Error fetching game by ID:', err.message);
    return null;
  }
}

/**
 * UTILITY: Normalizes a raw IGDB game object into our internal format.
 */
export function normalizeIGDBGame(
  game: IGDBGame,
  targetTitle: string,
  platformId?: number,
): NormalizedGame {
  // Priority 0: Manual Override
  let regionCode =
    REGIONAL_OVERRIDES[game.name] || REGIONAL_OVERRIDES[`igdb-${game.id}`];

  // REGIONAL DATE LOGIC: Override Region -> US (2) -> WW (8) -> Earliest
  const allDates = game.release_dates || [];
  const regionMap: Record<number, string> = {
    1: 'EU',
    2: 'NA',
    3: 'AU',
    4: 'NZ',
    5: 'JP',
    6: 'CH',
    7: 'AS',
    8: 'WW',
  };
  const regionToId: Record<string, number> = {
    EU: 1,
    NA: 2,
    AU: 3,
    NZ: 4,
    JP: 5,
    CH: 6,
    AS: 7,
    WW: 8,
    SEA: 7,
  };

  const targetPlatformId = platformId ? Number(platformId) : undefined;
  const lifespan = targetPlatformId
    ? PLATFORM_LIFESPANS[targetPlatformId]
    : undefined;

  // Filter by platform ID if available
  let platformFilteredDates = targetPlatformId
    ? allDates.filter((d) => d.platform === targetPlatformId)
    : allDates;

  // Disqualify impossible pre-platform launch dates (e.g. 2016 date for a Nintendo Switch game)
  if (lifespan) {
    platformFilteredDates = platformFilteredDates.filter((d) => {
      if (!d.date) return false;
      const year = new Date(d.date * 1000).getUTCFullYear();
      return year >= lifespan[0];
    });
  }

  // Fallback to all dates if no valid platform-specific dates exist
  if (platformFilteredDates.length === 0) {
    platformFilteredDates = lifespan
      ? allDates.filter(
          (d) =>
            d.date && new Date(d.date * 1000).getUTCFullYear() >= lifespan[0],
        )
      : allDates;
  }

  // For historical platforms, candidate dates MUST be restricted to lifespan window [lifespan[0], lifespan[1]]
  // unless the release is an explicitly recognized boutique physical release.
  const isBoutiqueRelease = BOUTIQUE_PHYSICAL_RELEASES.has(
    `igdb-${game.id}-${targetPlatformId}`,
  );

  let candidateDates = platformFilteredDates;
  if (lifespan && !isBoutiqueRelease) {
    const lifespanDates = platformFilteredDates.filter((d) => {
      if (!d.date) return false;
      const year = new Date(d.date * 1000).getUTCFullYear();
      return year >= lifespan[0] && year <= lifespan[1];
    });

    if (lifespanDates.length > 0) {
      candidateDates = lifespanDates;
    } else if (game.first_release_date) {
      const firstYear = new Date(
        game.first_release_date * 1000,
      ).getUTCFullYear();
      if (firstYear >= lifespan[0] && firstYear <= lifespan[1]) {
        candidateDates = [{ region: 2, date: game.first_release_date }];
      }
    }
  }

  let chosenDateObj:
    | { platform?: number; region?: number; date: number }
    | undefined;

  // 1. If we have an override region, try to find that specific date first
  if (regionCode) {
    const targetRegionId = regionToId[regionCode];
    if (targetRegionId) {
      chosenDateObj = candidateDates.find((d) => d.region === targetRegionId);
    }
  }

  // 2. Standard Priority: North America / US (Region 2)
  if (!chosenDateObj) {
    chosenDateObj = candidateDates.find((d) => d.region === 2);
    if (chosenDateObj && !regionCode) regionCode = 'NA';
  }

  // 3. Worldwide (Region 8)
  if (!chosenDateObj) {
    chosenDateObj = candidateDates.find((d) => d.region === 8);
    if (chosenDateObj && !regionCode) regionCode = 'WW';
  }

  // 4. Earliest available fallback in candidateDates
  if (!chosenDateObj && candidateDates.length > 0) {
    chosenDateObj = candidateDates.reduce((prev, curr) =>
      prev.date < curr.date ? prev : curr,
    );
    if (!regionCode) {
      regionCode = chosenDateObj.region
        ? regionMap[chosenDateObj.region] || 'OT'
        : 'NA';
    }
  }

  // 5. Ultimate fallback to allDates
  if (!chosenDateObj && allDates.length > 0) {
    chosenDateObj = allDates.reduce((prev, curr) =>
      prev.date < curr.date ? prev : curr,
    );
  }

  // Outlier Flag: Mark if selected release date falls outside active lifespan guidelines
  let isOutlier = false;
  if (chosenDateObj && lifespan) {
    const selectedYear = new Date(chosenDateObj.date * 1000).getUTCFullYear();
    if (selectedYear < lifespan[0] || selectedYear > lifespan[1]) {
      isOutlier = true;
    }
  }

  // Final default for region
  if (!regionCode) regionCode = 'NA';

  // Unwanted VR platforms to ignore
  const unwantedVR = [162, 163, 170, 384]; // Oculus, WMR, Meta Quest
  const cleanPlatforms = (game.platforms || []).filter(
    (p) => !unwantedVR.includes(p.id),
  );

  // Preference: If source is PS4/PS5, prefer PSVR/PSVR2 if exact platform not found
  let matchedPlatform = cleanPlatforms.find((p) => p.id === Number(platformId));
  if (!matchedPlatform && platformId === 48)
    matchedPlatform = cleanPlatforms.find((p) => p.id === 165);
  if (!matchedPlatform && platformId === 167)
    matchedPlatform = cleanPlatforms.find((p) => p.id === 390);

  const platformName = matchedPlatform
    ? matchedPlatform.name
    : cleanPlatforms.length > 0
      ? cleanPlatforms[0].name
      : 'Unknown';

  const overrideDate = DATE_OVERRIDES[`igdb-${game.id}-${platformId}`];
  const finalReleaseDate = overrideDate
    ? overrideDate
    : chosenDateObj?.date
      ? new Date(chosenDateObj.date * 1000).toISOString().split('T')[0]
      : game.first_release_date
        ? new Date(game.first_release_date * 1000).toISOString().split('T')[0]
        : null;

  const finalIsOutlier = overrideDate ? false : isOutlier;

  return {
    id: `igdb-${game.id}`,
    slug: game.slug || null,
    igdb_url: game.url || null,
    name: game.name,
    summary: game.summary,
    image_url: game.cover
      ? `https:${game.cover.url.replace('t_thumb', 't_cover_big')}`
      : null,
    platform: platformName,
    platforms: cleanPlatforms,
    platform_ids: cleanPlatforms.map((p) => p.id),
    release_date: finalReleaseDate,
    release_dates: game.release_dates || [],
    collections: game.collections
      ? game.collections.map((c) => c.name).join(', ')
      : null,
    franchises: game.franchises
      ? game.franchises.map((f) => f.name).join(', ')
      : null,
    category: game.category,
    region: regionCode,
    confidence: calculateConfidence(targetTitle, game.name, game.category),
    genres: game.genres ? game.genres.map((g) => g.name).join(', ') : null,
    flagged_outlier: finalIsOutlier,
  };
}

/**
 * Fetches all games in a collection (series) by collection ID.
 */
export async function getCollectionGames(
  collectionId: number,
): Promise<IGDBGame[]> {
  const query = `
        fields name, platforms.name, first_release_date, cover.url;
        where collections = (${collectionId});
        limit 500;
    `;
  return queryIGDB('games', query) as Promise<IGDBGame[]>;
}

/**
 * UTILITY: normalizeStr
 *
 * Simple normalization for basic string comparison.
 */
export function normalizeStr(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9+: -]/g, '')
    .trim();
}

/**
 * UTILITY: superNormalize
 *
 * Deep normalization of game titles for improved matching heuristics.
 */
export function superNormalize(title: string, keepSpaces = false): string {
  if (!title) return '';
  let t = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  t = t.toLowerCase();
  t = t.replace(/rayman m\b/gi, 'rayman arena');
  t = t.replace(/\bjr\b/gi, 'junior');
  t = t.replace(/\bjr\b/gi, 'junior');
  t = t.replace(
    /^(disney's|marvel's|sid meier's|lego|j\.r\.r\. tolkien's|the amazing|telltale's|the)\b/gi,
    '',
  );
  t = t.replace(
    /\b(version|the videogame|the video game|special edition|game of the year edition|goty edition|a fantasy harvest moon|toy box challenge|special pikachu edition|director's cut|hd remaster|nintendo switch edition|complete edition|definitive edition|ultimate edition|gold edition|remastered|remake|standard edition|plus|the telltale series|includes picnic panic|plus 400 days|vol 1|vol 2|vol 3|anniversary edition|starter pack|triple pack|unplugged vol 1|the complete first season|the complete second season|the final season|the complete series|the|of|a|and|for|ds|3ds|gba|nes|snes|n64|gc|gamecube|wii|wiiu|ps1|ps2|ps3|ps4|ps5|psp|vita|xbox|360|one)\b/gi,
    '',
  );
  t = t.replace(/[:&.\-/]/g, ' ');
  t = t.replace(/\bvol\s*\d+\b/gi, '');
  if (keepSpaces) {
    t = t
      .replace(/[^a-z0-9 ]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  } else {
    t = t.replace(/[^a-z0-9]/gi, '');
  }
  return t;
}

/**
 * UTILITY: calculateConfidence
 *
 * Scores a candidate game name against a target title using word overlap and category heuristics.
 */
export function calculateConfidence(
  target: string,
  candidate: string,
  category?: number,
): number {
  const normTarget = normalizeStr(target);
  const normCandidate = normalizeStr(candidate);

  if (normTarget === normCandidate) return 100;

  const simplifiedTarget = normalizeStr(getSimplifiedTitle(target));
  if (simplifiedTarget === normCandidate) return 100;

  const superNormTarget = superNormalize(target);
  const superNormCandidate = superNormalize(candidate);
  if (superNormTarget && superNormTarget === superNormCandidate) return 100;

  // Word overlap scoring (ignoring small filler words)
  const targetWords = new Set(
    normTarget.split(/[:\s+-]+/).filter((w) => w.length > 2),
  );
  const candidateWords = new Set(
    normCandidate.split(/[:\s+-]+/).filter((w) => w.length > 2),
  );

  if (targetWords.size === 0) return 50;

  let matches = 0;
  for (const word of targetWords) {
    if (candidateWords.has(word)) matches++;
  }

  const overlapScore = (matches / targetWords.size) * 100;

  // Category boosts for bundles
  let boost = 0;
  if (category === 10 || category === 13) {
    const bundleKeywords = [
      '+',
      'expansion',
      'collection',
      'pack',
      'pass',
      'complete',
    ];
    if (bundleKeywords.some((kw) => normTarget.includes(kw))) {
      boost += 15;
    }
  }

  // Penalize if the candidate has extra words that significantly change meaning
  if (candidateWords.size > targetWords.size + 2) {
    boost -= 10;
  }

  return Math.min(95, Math.max(0, overlapScore + boost));
}

/**
 * UTILITY: getSimplifiedTitle
 *
 * Returns the "head" of a title by splitting on common version/bundle separators.
 */
export function getSimplifiedTitle(title: string): string {
  const separators = [':', '+', ' - ', '('];
  let simplified = title;

  // Handle "Title + Title Suffix" redundancy (e.g., "Pokemon Sword + Pokemon Sword Expansion Pass")
  if (title.includes('+')) {
    const parts = title.split('+').map((p) => p.trim());
    if (parts.length === 2) {
      const [p1, p2] = parts;
      if (p2.toLowerCase().startsWith(p1.toLowerCase())) {
        return `${p1} + ${p2.substring(p1.length).trim()}`;
      }
    }
  }

  for (const sep of separators) {
    const index = simplified.indexOf(sep);
    if (index > 0) {
      simplified = simplified.substring(0, index);
    }
  }
  return simplified.trim();
}

/**
 * Fetches multiple games by their IGDB IDs in batches of 100.
 *
 * @param ids The array of IGDB IDs.
 * @param platformIdMap Map of game ID to platform ID.
 * @returns Array of NormalizedGame objects.
 */
export async function getGamesByIds(
  ids: number[],
  platformIdMap?: Record<number, number>,
): Promise<NormalizedGame[]> {
  if (ids.length === 0) return [];
  const fields = `id, name, slug, url, summary, cover.url, first_release_date, platforms.name, collections.id, collections.name, franchises.id, franchises.name, genres.name, themes.name, category, game_type, version_parent.id, version_parent.collections.name, version_parent.franchises.name, release_dates.platform, release_dates.region, release_dates.date`;

  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += 100) {
    chunks.push(ids.slice(i, i + 100));
  }

  const allNormalized: NormalizedGame[] = [];

  for (const chunk of chunks) {
    const query = `
      fields ${fields};
      where id = (${chunk.join(',')});
      limit 100;
    `;
    const results = (await queryIGDB('games', query)) as IGDBGame[];
    if (results && results.length > 0) {
      for (const game of results) {
        const platformId = platformIdMap ? platformIdMap[game.id] : undefined;
        const category = game.game_type ?? game.category;

        if (category === 3) {
          // Bundles require special individual query to pull member data
          const individual = await getGameById(game.id, platformId);
          if (individual) {
            allNormalized.push(individual);
          }
        } else {
          // Version parent inheritance
          if (game.version_parent && typeof game.version_parent === 'object') {
            interface ParentInfo {
              collections?: { name: string }[];
              franchises?: { name: string }[];
            }
            const parent = game.version_parent as ParentInfo;
            if (parent.collections || parent.franchises) {
              const collections = new Set(
                game.collections?.map((c) => c.name) || [],
              );
              const franchises = new Set(
                game.franchises?.map((f) => f.name) || [],
              );

              parent.collections?.forEach((c) => collections.add(c.name));
              parent.franchises?.forEach((f) => franchises.add(f.name));

              game.collections = Array.from(collections).map((name) => ({
                id: 0,
                name,
              }));
              game.franchises = Array.from(franchises).map((name) => ({
                id: 0,
                name,
              }));
            }
          }
          allNormalized.push(normalizeIGDBGame(game, game.name, platformId));
        }
      }
    }
  }

  return allNormalized;
}
