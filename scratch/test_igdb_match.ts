import { getAccessToken } from './scripts/lib/igdb-auth.js';
import axios from 'axios';
import 'dotenv/config';

async function testQuery(searchTitle, platformId) {
    const token = await getAccessToken();
    const query = `fields name, id, cover.url; search "${searchTitle}"; where platforms = (${platformId});`;
    const response = await axios.post('https://api.igdb.com/v4/games', query, {
        headers: {
            'Client-ID': process.env.TWITCH_CLIENT_ID,
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'text/plain'
        }
    });
    console.log(`Results for "${searchTitle}" on platform ${platformId}:`);
    console.log(JSON.stringify(response.data, null, 2));
}

async function run() {
    await testQuery('Castlevania', 18); // NES
    await testQuery('Castlevania', 4);  // N64
}

run().catch(console.error);
