const { queryIGDB } = require('./scripts/lib/igdb');

async function test() {
    console.log('--- Testing fuzzy name matching (where name ~ "Doom"*) ---');
    const results = await queryIGDB('games', 'fields name, category, platforms; where name ~ "Doom"* & platforms = (50);');
    console.log(JSON.stringify(results, null, 2));
}

test();
