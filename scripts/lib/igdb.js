const axios = require('axios');
const { getAccessToken } = require('./igdb-auth');
require('dotenv').config();

const IGDB_ENDPOINT = 'https://api.igdb.com/v4';

// Map of local platform names to IGDB platform IDs
const PLATFORM_MAP = {
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
const PHYSICAL_DOMINANT_PLATFORMS = [
    5, 7, 8, 9, 11, 12, 15, 18, 19, 21, 23, 29, 30, 32, 33, 35, 37, 38, 41, 46, 48, 49, 50, 59, 60, 61, 62, 64, 66, 67, 86, 120, 130, 167, 169
];

async function queryIGDB(endpoint, query) {
    const token = await getAccessToken();
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            const response = await axios.post(`${IGDB_ENDPOINT}/${endpoint}`, query, {
                headers: {
                    'Client-ID': process.env.TWITCH_CLIENT_ID,
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'text/plain'
                }
            });
            // 500ms delay to safely stay under 4 RPS (targeting 2 RPS)
            await new Promise(resolve => setTimeout(resolve, 500));
            return response.data;
        } catch (error) {
            if (error.response?.status === 429) {
                attempt++;
                const delay = Math.pow(2, attempt) * 1000;
                console.warn(`  Rate limited (429). Retrying in ${delay}ms... (Attempt ${attempt}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            console.error(`IGDB Error (${endpoint}):`, error.response?.data || error.message);
            return [];
        }
    }
    return [];
}

async function normalizeTitle(title) {
    if (!title) return '';
    return title.toLowerCase()
        .replace(/[\(\)\-:]/g, ' ') // Replace parentheses, hyphens, and colons with spaces
        .replace(/[^a-z0-9]/g, '')  // Remove non-alphanumeric (including spaces)
        .trim();
}

/**
 * Search for a game with metadata, strictly filtering by platform ID and official releases.
 */
async function findGame(title, platformId) {
    // Categories: 0: Main Game, 8: Remake, 9: Remaster, 10: Expanded Game, 11: Port
    // We explicitly exclude Category 12 (Forks/Mods) to focus on official physical releases.
    const platformFilter = platformId ? `platforms = (${platformId})` : '';
    
    // Clean title for search: replace special hyphens and remove characters that break IGDB fuzzy search
    const cleanTitle = title.replace(/[–—]/g, '-').replace(/[":()]/g, '').trim();

    const query = `
        fields name, summary, cover.url, first_release_date, platforms.name, collection.name, franchises.name, genres.name, themes.name, category, version_parent, release_dates.region;
        search "${cleanTitle.replace(/"/g, '')}";
        ${platformFilter ? `where platforms = (${platformId});` : ''}
        limit 10;
    `;

    try {
        const results = await queryIGDB('games', query);
        if (!results || results.length === 0) return [];

        // Filter for official releases only (0: Main Game, 8: Remake, 9: Remaster, 10: Expanded Game, 11: Port)
        const officialCategories = [0, 8, 9, 10, 11, undefined, null];
        const initialFiltered = results.filter(g => officialCategories.includes(g.category));

        if (initialFiltered.length === 0) return [];

        // Heuristic: Filter out hacks/mods miscategorized as Main Game (0) or null
        const filteredResults = initialFiltered.filter(g => {
            const lowerName = g.name.toLowerCase();
            const lowerSummary = (g.summary || '').toLowerCase();
            const isHack = lowerName.includes('hack') || lowerSummary.includes('level hack') || 
                           lowerSummary.includes('graphics mod') || lowerName.includes('translation') || 
                           lowerName.includes('patched');
            
            // If it's a known hack but NOT tagged as a hack (5 or 12), and it's not the ONLY result, deprioritize or drop.
            if (isHack && g.category !== 5 && g.category !== 12) return false;
            return true;
        });

        if (filteredResults.length === 0 && initialFiltered.length > 0) {
            // If we filtered EVERYTHING out as hacks, but had results, fallback to first official just in case
            // but the heuristic is usually safe for official-seeking.
            return []; 
        }

        // Matching & Ranking
        const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
        const normTarget = normalize(title);

        return filteredResults.map(game => {
            const regionId = game.release_dates?.[0]?.region;
            const regionMap = { 1: 'EU', 2: 'NA', 3: 'AU', 4: 'NZ', 5: 'JP', 6: 'CH', 7: 'AS', 8: 'WW' };
            const region = regionId ? regionMap[regionId] : 'NA';

            const matchedPlatform = game.platforms?.find(p => p.id === Number(platformId));
            const platformName = matchedPlatform ? matchedPlatform.name : (game.platforms ? game.platforms[0].name : 'Unknown');

            return {
                id: `igdb-${game.id}`,
                name: game.name,
                summary: game.summary,
                image_url: game.cover ? `https:${game.cover.url.replace('t_thumb', 't_cover_big')}` : null,
                platform: platformName,
                platforms: game.platforms || [],
                platform_ids: (game.platforms || []).map(p => p.id),
                release_date: game.first_release_date ? new Date(game.first_release_date * 1000).toISOString().split('T')[0] : null,
                collection: game.collection ? (typeof game.collection === 'object' ? game.collection.name : null) : null,
                franchise: game.franchises ? game.franchises[0].name : null,
                category: game.category,
                region: region,
                confidence: normalize(game.name) === normTarget ? 100 : 50
            };
        }).sort((a, b) => b.confidence - a.confidence);
    } catch (error) {
        console.error('Error finding game:', error.message);
        return null;
    }
}

async function getCollectionGames(collectionId) {
    if (!collectionId) return [];
    
    // Fetch all games in the collection
    const query = `fields id, name, cover.image_id, summary, platforms.id, platforms.name, first_release_date; where collection = ${collectionId}; limit 500;`;
    const games = await queryIGDB('games', query);
    
    // Filter for physical-likelihood platforms
    const physicalGames = games.filter(g => {
        return g.platforms && g.platforms.some(p => PHYSICAL_DOMINANT_PLATFORMS.includes(p.id));
    });
    
    return physicalGames;
}

module.exports = { findGame, getCollectionGames, PLATFORM_MAP, queryIGDB };
