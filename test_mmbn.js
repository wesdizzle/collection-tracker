const { findGame } = require('./scripts/lib/igdb');

async function main() {
    const title = 'Mega Man Battle Network';
    const platformId = 24; // GBA
    const results = await findGame(title, platformId);
    console.log(JSON.stringify(results, null, 2));
}

main();
