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
    summary?: string;
    cover?: IGDBImage;
    first_release_date?: number;
    platforms?: IGDBPlatform[];
    collections?: { id: number; name: string }[];
    franchises?: { id: number; name: string }[];
    genres?: { name: string }[];
    themes?: { name: string }[];
    category?: number;
    version_parent?: number;
    release_dates?: { region: number; date: number }[];
    confidence?: number;
}

export interface NormalizedGame {
    id: string;
    slug: string | null;
    name: string;
    summary?: string;
    image_url: string | null;
    platform: string;
    platforms: IGDBPlatform[];
    platform_ids: number[];
    release_date: string | null;
    collections: string | null;
    franchises: string | null;
    category?: number;
    region: string;
    confidence: number;
    genres: string | null;
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
    'ColecoVision': 67,
    'Intellivision': 68,
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
    'Wii': 5,
    'Nintendo 3DS': 37,
    'Wii U': 41,
    'New Nintendo 3DS': 137,
    'Nintendo Switch': 130,
    'PlayStation': 7,
    'PlayStation 2': 8,
    'PlayStation Portable': 38,
    'PlayStation 3': 9,
    'PlayStation Vita': 46,
    'PlayStation 4': 48,
    'PlayStation 5': 167,
    'Sega Master System': 64,
    'Sega Genesis': 29,
    'Game Gear': 35,
    'Sega CD': 78,
    'Sega 32X': 30,
    'Sega Saturn': 32,
    'Dreamcast': 23,
    'TurboGrafx-16': 86,
    'Xbox': 11,
    'Xbox 360': 12,
    'Xbox One': 49,
    'Xbox Series X': 169,
    'Game.com': 379,
    'GameCube': 21,
    'Neo Geo Advanced Entertainment System': 80,
    'Neo Geo CD': 136,
    'Philips CD-i': 117,
    'Sega Pico': 339,
    'TurboGrafx-CD': 150,
    'PlayStation VR': 165,
    'PlayStation VR2': 390
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
    'Metcha! Taiko no Tatsujin DS: 7-tsu no Shima no Daibouken': 'JP',
    'Sonic the Hedgehog (1991)': 'EU', // For Master System canonical EU releases
    'Mario Kart 8 Deluxe + Booster Course Pass': 'SEA',
    'Chrono Cross: The Radical Dreamers Edition': 'SEA',
    'Chrono Cross: The Radical Dreamers': 'SEA',
    
    // IGDB IDs (More stable)
    'igdb-328142': 'JP',   // Pico Park 1+2
    'igdb-3683': 'JP',     // Mother 3
    'igdb-245049': 'SEA',  // Mario Kart 8 Deluxe + BCP
    'igdb-188613': 'SEA',  // Chrono Cross: The Radical Dreamers Edition
    'igdb-538': 'EU',      // Sonic the Hedgehog (Master System / GG)
};

/**
 * UTILITY: queryIGDB
 * 
 * Performs a raw query against the IGDB API with retries and rate limiting.
 */
export async function queryIGDB(endpoint: string, query: string): Promise<unknown[]> {
    const token = await getAccessToken();
    const maxRetries = 3;
    let attempt = 0;

    const clientId = process.env['TWITCH_CLIENT_ID'];

    while (attempt < maxRetries) {
        try {
            const response = await axios.post(`${IGDB_ENDPOINT}/${endpoint}`, query, {
                headers: {
                    'Client-ID': clientId,
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'text/plain'
                }
            });
            // 500ms delay to safely stay under 4 RPS (targeting 2 RPS)
            await new Promise(resolve => setTimeout(resolve, 500));
            return response.data as unknown[];
        } catch (error: unknown) {
            const err = error as { response?: { status?: number; data?: unknown }; message: string };
            if (err.response?.status === 429) {
                attempt++;
                const delay = Math.pow(2, attempt) * 1000;
                console.warn(`  Rate limited (429). Retrying in ${delay}ms... (Attempt ${attempt}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            console.error(`IGDB Error (${endpoint}):`, err.response?.data || err.message);
            return [];
        }
    }
    return [];
}

/**
 * Searches for a game with metadata, strictly filtering by platform ID and official releases.
 */
export async function findGame(title: string, platformId: number): Promise<NormalizedGame[] | null> {
    // Categories: 0: Main Game, 8: Remake, 9: Remaster, 10: Expanded Game, 11: Port
    const platformFilter = platformId ? `platforms = (${platformId})` : '';
    
    // Clean title for search
    const cleanTitle = title.replace(/[–—]/g, '-').replace(/[":()]/g, '').trim();

    const searchQuery = `
        fields name, slug, summary, cover.url, first_release_date, platforms.name, collections.id, collections.name, franchises.id, franchises.name, genres.name, themes.name, category, version_parent, release_dates.region, release_dates.date;
        search "${cleanTitle.replace(/"/g, '')}";
        ${platformFilter ? `where platforms = (${platformId});` : ''}
        limit 50;
    `;

    const nameQuery = `
        fields name, slug, summary, cover.url, first_release_date, platforms.name, collections.id, collections.name, franchises.id, franchises.name, genres.name, themes.name, category, version_parent, release_dates.region, release_dates.date;
        where name ~ "${cleanTitle.replace(/"/g, '')}"${platformFilter ? ` & platforms = (${platformId})` : ''};
        limit 50;
    `;

    try {
        // Pass 1: Exact search
        const [searchResults, nameResults] = await Promise.all([
            queryIGDB('games', searchQuery) as Promise<IGDBGame[]>,
            queryIGDB('games', nameQuery) as Promise<IGDBGame[]>
        ]);

        let results: IGDBGame[] = [...(searchResults || []), ...(nameResults || [])];

        // Pass 2: Fallback to simplified title if results are poor
        if (!results || results.length < 2) {
            const simplifiedTitle = getSimplifiedTitle(cleanTitle);
            if (simplifiedTitle !== cleanTitle) {
                console.log(`  Falling back to simplified search: "${simplifiedTitle}"`);
                const fallbackSearchQuery = `
                    fields name, slug, summary, cover.url, first_release_date, platforms.name, collections.id, collections.name, franchises.id, franchises.name, genres.name, themes.name, category, version_parent, release_dates.region, release_dates.date;
                    search "${simplifiedTitle.replace(/"/g, '')}";
                    ${platformFilter ? `where platforms = (${platformId});` : ''}
                    limit 50;
                `;
                const fallbackNameQuery = `
                    fields name, slug, summary, cover.url, first_release_date, platforms.name, collections.id, collections.name, franchises.id, franchises.name, genres.name, themes.name, category, version_parent, release_dates.region, release_dates.date;
                    where name ~ "${simplifiedTitle.replace(/"/g, '')}"${platformFilter ? ` & platforms = (${platformId})` : ''};
                    limit 50;
                `;
                const [fallbackSearch, fallbackName] = await Promise.all([
                    queryIGDB('games', fallbackSearchQuery) as Promise<IGDBGame[]>,
                    queryIGDB('games', fallbackNameQuery) as Promise<IGDBGame[]>
                ]);
                results = [...results, ...(fallbackSearch || []), ...(fallbackName || [])];
            }
        }

        if (!results || results.length === 0) return [];

        // De-duplicate by ID
        const seen = new Set<number>();
        const uniqueResults = results.filter(g => {
            if (seen.has(g.id)) return false;
            seen.add(g.id);
            return true;
        });

        // Filter for official categories only
        const officialCategories = [0, 8, 9, 10, 11, 13, 14, undefined, null];
        const initialFiltered = uniqueResults.filter(g => officialCategories.includes(g.category));

        if (initialFiltered.length === 0) return [];

        const filteredResults = initialFiltered.filter(g => {
            const lowerName = g.name.toLowerCase();
            const lowerSummary = (g.summary || '').toLowerCase();
            if (g.category === 12) return false;

            const hackKeywords = [
                ' hack:', ' hack)', ' hack!', ' hack\n',
                'level hack', 'fan translation', 'patched version',
                'fan-made', 'fanmade', 'fan project', 'unofficial',
                'rom hack', 'romhack', ' graphics mod ', ' graphics mod:',
                ' a mod for ', ' this mod ', ' modded ', ' mod:', ' mod)'
            ];
            
            const isHack = hackKeywords.some(kw => lowerName.includes(kw) || lowerSummary.includes(kw));
            if (isHack && g.category !== 5) return false;
            
            return true;
        });

        if (filteredResults.length === 0) return [];

        return filteredResults.map(game => normalizeIGDBGame(game, title, platformId))
            .sort((a, b) => {
                // Primary: Confidence
                if (b.confidence !== a.confidence) return b.confidence - a.confidence;
                // Secondary: Category priority (Main Game > Remake > Remaster > Port > Bundle)
                const catA = a.category ?? 0;
                const catB = b.category ?? 0;
                if (catA !== catB) {
                    const priority: Record<number, number> = { 0: 10, 8: 9, 9: 8, 10: 7, 11: 6, 13: 5, 14: 4 };
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
 */
export async function getGameById(igdbId: number, platformId?: number): Promise<NormalizedGame | null> {
    const query = `
        fields name, slug, summary, cover.url, first_release_date, platforms.name, collections.id, collections.name, franchises.id, franchises.name, genres.name, themes.name, category, version_parent, release_dates.region, release_dates.date;
        where id = ${igdbId};
    `;
    
    try {
        const results = await queryIGDB('games', query) as IGDBGame[];
        if (!results || results.length === 0) return null;
        return normalizeIGDBGame(results[0], results[0].name, platformId);
    } catch (error: unknown) {
        const err = error as { message: string };
        console.error('Error fetching game by ID:', err.message);
        return null;
    }
}

/**
 * UTILITY: Normalizes a raw IGDB game object into our internal format.
 */
function normalizeIGDBGame(game: IGDBGame, targetTitle: string, platformId?: number): NormalizedGame {
    // Priority 0: Manual Override
    let regionCode = REGIONAL_OVERRIDES[game.name] || REGIONAL_OVERRIDES[`igdb-${game.id}`];

    // REGIONAL DATE LOGIC: Override Region -> US (2) -> WW (8) -> Earliest
    const allDates = game.release_dates || [];
    const regionMap: Record<number, string> = { 1: 'EU', 2: 'NA', 3: 'AU', 4: 'NZ', 5: 'JP', 6: 'CH', 7: 'AS', 8: 'WW' };
    const regionToId: Record<string, number> = { 'EU': 1, 'NA': 2, 'AU': 3, 'NZ': 4, 'JP': 5, 'CH': 6, 'AS': 7, 'WW': 8, 'SEA': 7 };

    let chosenDateObj: { region?: number; date: number } | undefined;

    // 1. If we have an override region, try to find that specific date first
    if (regionCode) {
        const targetRegionId = regionToId[regionCode];
        if (targetRegionId) {
            chosenDateObj = allDates.find(d => d.region === targetRegionId);
        }
    }

    // 2. Standard Priority: North America / US (Region 2)
    if (!chosenDateObj) {
        chosenDateObj = allDates.find(d => d.region === 2);
        if (chosenDateObj && !regionCode) regionCode = 'NA';
    }

    // 3. Worldwide (Region 8)
    if (!chosenDateObj) {
        chosenDateObj = allDates.find(d => d.region === 8);
        if (chosenDateObj && !regionCode) regionCode = 'WW';
    }

    // 4. Earliest available fallback
    if (!chosenDateObj && allDates.length > 0) {
        chosenDateObj = allDates.reduce((prev, curr) => (prev.date < curr.date ? prev : curr));
        if (!regionCode) {
            regionCode = chosenDateObj.region ? (regionMap[chosenDateObj.region] || 'OT') : 'NA';
        }
    }

    // Final default for region
    if (!regionCode) regionCode = 'NA';

    const matchedPlatform = game.platforms?.find(p => p.id === Number(platformId));
    const platformName = matchedPlatform ? matchedPlatform.name : (game.platforms ? game.platforms[0].name : 'Unknown');

    return {
        id: `igdb-${game.id}`,
        slug: game.slug || null,
        name: game.name,
        summary: game.summary,
        image_url: game.cover ? `https:${game.cover.url.replace('t_thumb', 't_cover_big')}` : null,
        platform: platformName,
        platforms: game.platforms || [],
        platform_ids: (game.platforms || []).map(p => p.id),
        release_date: chosenDateObj?.date ? new Date(chosenDateObj.date * 1000).toISOString().split('T')[0] : (game.first_release_date ? new Date(game.first_release_date * 1000).toISOString().split('T')[0] : null),
        collections: game.collections ? game.collections.map(c => c.name).join(', ') : null,
        franchises: game.franchises ? game.franchises.map(f => f.name).join(', ') : null,
        category: game.category,
        region: regionCode,
        confidence: calculateConfidence(targetTitle, game.name, game.category),
        genres: game.genres ? game.genres.map(g => g.name).join(', ') : null
    };
}

/**
 * Fetches all games in a collection (series) by collection ID.
 */
export async function getCollectionGames(collectionId: number): Promise<IGDBGame[]> {
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
    return (s || '').toLowerCase()
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
export function superNormalize(title: string): string {
    if (!title) return '';
    let t = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    t = t.toLowerCase();
    t = t.replace(/^(disney's|marvel's|sid meier's|lego|j\.r\.r\. tolkien's)\b/gi, '');
    t = t.replace(/\b(version|the videogame|the video game|special edition|game of the year edition|goty edition|a fantasy harvest moon|toy box challenge|special pikachu edition|director's cut|hd remaster|nintendo switch edition)\b/gi, '');
    t = t.replace(/:/g, ' ');
    t = t.replace(/&/g, 'and');
    t = t.replace(/\btelltale series\b/gi, '');
    t = t.replace(/[^a-z0-9]/gi, '');
    return t;
}

/**
 * UTILITY: calculateConfidence
 * 
 * Scores a candidate game name against a target title using word overlap and category heuristics.
 */
export function calculateConfidence(target: string, candidate: string, category?: number): number {
    const normTarget = normalizeStr(target);
    const normCandidate = normalizeStr(candidate);

    if (normTarget === normCandidate) return 100;

    const simplifiedTarget = normalizeStr(getSimplifiedTitle(target));
    if (simplifiedTarget === normCandidate) return 100;

    // Word overlap scoring (ignoring small filler words)
    const targetWords = new Set(normTarget.split(/[:\s+-]+/).filter(w => w.length > 2));
    const candidateWords = new Set(normCandidate.split(/[:\s+-]+/).filter(w => w.length > 2));

    if (targetWords.size === 0) return 50;

    let matches = 0;
    for (const word of targetWords) {
        if (candidateWords.has(word)) matches++;
    }

    const overlapScore = (matches / targetWords.size) * 100;
    
    // Category boosts for bundles
    let boost = 0;
    if (category === 10 || category === 13) {
        const bundleKeywords = ['+', 'expansion', 'collection', 'pack', 'pass', 'complete'];
        if (bundleKeywords.some(kw => normTarget.includes(kw))) {
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
        const parts = title.split('+').map(p => p.trim());
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
