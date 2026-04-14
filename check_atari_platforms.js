const { queryIGDB } = require('./scripts/lib/igdb');

async function check() {
    console.log('--- Fetching Atari Platform IDs ---');
    const platforms = await queryIGDB('platforms', 'fields name, id; where name ~ *"Atari"*; limit 100;');
    console.log('All Atari-related platforms:', JSON.stringify(platforms, null, 2));

    console.log('\n--- Checking Mario Bros. Variations ---');
    const games = await queryIGDB('games', 'fields name, platforms.name, category, version_parent; search "Mario Bros."; limit 50;');
    const marioBros = games.filter(g => g.name === 'Mario Bros.');
    console.log('Mario Bros. exact matches:', JSON.stringify(marioBros, null, 2));
}

check().catch(console.error);
