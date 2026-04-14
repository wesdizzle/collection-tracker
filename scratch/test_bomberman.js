const { findGame } = require('../scripts/lib/igdb');
const dotenv = require('dotenv');
dotenv.config();

async function test() {
    console.log('Searching for "Bomberman" on NES (ID: 18)...');
    const results = await findGame('Bomberman', 18);
    console.log('Results:', JSON.stringify(results, null, 2));
}

test();
