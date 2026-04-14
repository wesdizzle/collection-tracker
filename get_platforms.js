const axios = require('axios');
const { getAccessToken } = require('./scripts/lib/igdb-auth');
require('dotenv').config();

async function fetchPlatforms() {
    const token = await getAccessToken();
    const query = `fields id, name; limit 500; sort name asc;`;
    
    try {
        const response = await axios.post('https://api.igdb.com/v4/platforms', query, {
            headers: {
                'Client-ID': process.env.TWITCH_CLIENT_ID,
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'text/plain'
            }
        });
        console.log(JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.error('Error:', error.response?.data || error.message);
    }
}

fetchPlatforms();
