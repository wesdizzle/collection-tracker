const { queryIGDB } = require('./scripts/lib/igdb');

async function testRegions() {
    console.log('Fetching Super Mario Odyssey release dates...');
    const result = await queryIGDB('games', 'fields name, release_dates.region, release_dates.human, release_dates.y; where name = "Super Mario Odyssey";');
    console.log(JSON.stringify(result, null, 2));
}

testRegions();
