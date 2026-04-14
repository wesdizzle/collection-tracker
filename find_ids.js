const { queryIGDB } = require('./scripts/lib/igdb');

async function findPlatformIds() {
    const queries = [
        'Game.com',
        'Neo Geo',
        'Sega Pico',
        'Philips CD-i',
        'TurboGrafx',
        'Nintendo Switch 2',
        'PlayStation VR'
    ];

    for (const q of queries) {
        console.log(`Searching for: ${q}...`);
        const results = await queryIGDB('platforms', `fields id, name; search "${q}";`);
        console.log(JSON.stringify(results, null, 2));
    }
}

findPlatformIds();
