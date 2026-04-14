const axios = require('axios');

async function getAmiiboSeries(seriesName) {
    try {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1s delay
        const response = await axios.get(`https://www.amiiboapi.org/api/amiibo/`, {
            params: { amiiboSeries: seriesName },
            headers: { 'User-Agent': 'CollectionTracker/1.0' },
            timeout: 10000
        });
        return response.data.amiibo.map(a => ({
            id: a.tail,
            name: a.name,
            line: 'amiibo',
            series_name: a.amiiboSeries,
            type: a.type, // "Figure", "Card", etc.
            image_url: a.image,
            release_date: a.release?.na || null
        }));
    } catch (error) {
        if (error.code === 'ECONNRESET') {
            console.error(`AmiiboAPI: Connection reset for ${seriesName}, skipping...`);
        } else {
            console.error(`AmiiboAPI Error for ${seriesName}:`, error.message);
        }
        return [];
    }
}

async function getSkylandersSeries(seriesName) {
    // Skylanders doesn't have a public API, so we use a curated list of series.
    const seriesManifest = {
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

async function getStarlinkSeries(seriesName) {
    const seriesManifest = {
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

module.exports = { getAmiiboSeries, getSkylandersSeries, getStarlinkSeries };
