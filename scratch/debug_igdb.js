const { queryIGDB } = require('../scripts/lib/igdb');

async function debug() {
    console.log('--- Querying IGDB for Mega Man Battle Network (GBA) ---');
    const results = await queryIGDB('games', 'fields name, category, id, platforms.name; where name ~ "Mega Man Battle Network" & platforms = (24); limit 100;');
    console.log(JSON.stringify(results, null, 2));
}

debug();
