import axios from 'axios';

export interface Figure {
    id: string;
    name: string;
    line: string;
    series_name: string;
    type: string;
    image_url: string | null;
    release_date?: string | null;
    verified?: boolean | number;
    amiibo_id?: string;
    metadata_json?: string;
    scl_url?: string;
    game_series?: string;
}

/**
 * UTILITY: getAmiiboSeries
 * 
 * Fetches all figures in a given series from the AmiiboAPI.
 */
export async function getAmiiboSeries(seriesName: string): Promise<Figure[]> {
    try {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1s delay
        const response = await axios.get(`https://www.amiiboapi.org/api/amiibo/`, {
            params: { amiiboSeries: seriesName },
            headers: { 'User-Agent': 'CollectionTracker/1.0' },
            timeout: 10000
        });
        
        interface Amiibo {
            tail: string;
            name: string;
            amiiboSeries: string;
            type: string;
            image: string;
            release?: { na?: string };
        }
        
        const data = response.data as { amiibo: Amiibo[] };
        return data.amiibo.map((a: Amiibo) => ({
            id: a.tail,
            name: a.name,
            line: 'amiibo',
            series_name: a.amiiboSeries,
            type: a.type, // "Figure", "Card", etc.
            image_url: a.image,
            release_date: a.release?.na || null
        }));
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        const code = (error as { code?: string }).code;
        if (code === 'ECONNRESET') {
            console.error(`AmiiboAPI: Connection reset for ${seriesName}, skipping...`);
        } else {
            console.error(`AmiiboAPI Error for ${seriesName}:`, message);
        }
        return [];
    }
}

/**
 * UTILITY: getSkylandersSeries
 * 
 * Returns curated figures for Skylanders series since they lack a public API.
 */
export async function getSkylandersSeries(seriesName: string): Promise<Figure[]> {
    // Skylanders doesn't have a public API, so we use a curated list of series.
    const seriesManifest: Record<string, string[]> = {
        "Spyro's Adventure": ["Spyro", "Gill Grunt", "Trigger Happy", "Eruptor", "Bash", "Ignitor", "Chop Chop", "Terrafin"],
        "Giants": ["Tree Rex", "Bouncer", "Crusher", "Eye-Brawl", "Hot Head", "Ninjini", "Swarm", "Thumpback"],
        "Swap Force": ["Wash Buckler", "Blast Zone", "Free Ranger", "Freeze Blade", "Magna Charge", "Night Shift", "Rattle Shake", "Stink Bomb"],
        "Trap Team": ["Snap Shot", "Wallop", "Wildfire", "Jawbreaker", "Krypt King", "Gust Black", "Lob-Star", "Bushwhack"],
        "SuperChargers": ["Spitfire", "Stormblade", "Dive-Clops", "Nightfall", "Smash Hit", "Fiesta", "High Volt", "Splat"],
        "Imaginators": ["King Pen", "Golden Queen", "Tri-Tip", "Starcast", "Ambush", "Barbella", "Ro-Bow", "Wild Storm"]
    };
    
    const items = seriesManifest[seriesName] || [];
    return items.map(name => ({
        id: `skylanders-${name.toLowerCase().replace(/ /g, '-')}`,
        name: name,
        line: 'Skylanders',
        series_name: seriesName,
        type: 'Figure',
        image_url: null
    }));
}

/**
 * UTILITY: getStarlinkSeries
 * 
 * Returns curated figures for Starlink: Battle for Atlas.
 */
export async function getStarlinkSeries(seriesName: string): Promise<Figure[]> {
    const seriesManifest: Record<string, string[]> = {
        "Battle for Atlas": ["Mason Rana", "Judge", "Chase da Silva", "Hunter Hakka", "Shaid", "Levi McCray", "Razor Lemay", "Eli Arborwood", "Karl Zeon", "Fern Wilder"]
    };
    
    const items = seriesManifest[seriesName] || [];
    return items.map(name => ({
        id: `starlink-${name.toLowerCase().replace(/ /g, '-')}`,
        name: name,
        line: 'Starlink',
        series_name: seriesName,
        type: 'Figure',
        image_url: null
    }));
}
