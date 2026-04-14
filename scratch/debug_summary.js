const { queryIGDB } = require('../scripts/lib/igdb');

async function debug() {
    const results = await queryIGDB('games', 'fields name, summary; where id = 1755;');
    console.log(JSON.stringify(results, null, 2));
}

debug();
