const { findGame } = require('../scripts/lib/igdb');

async function debug() {
    console.log('--- findGame results for Mega Man Battle Network (GBA) ---');
    const results = await findGame("Mega Man Battle Network", 24);
    console.log(results.map(r => ({ id: r.id, name: r.name, confidence: r.confidence })));
}

debug();
