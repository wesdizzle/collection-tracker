const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const TOKEN_CACHE_PATH = path.join(__dirname, '..', '..', '.igdb_token_cache.json');

async function getAccessToken() {
    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error('TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET must be set in .env');
    }

    // Check Cache
    if (fs.existsSync(TOKEN_CACHE_PATH)) {
        const cache = JSON.parse(fs.readFileSync(TOKEN_CACHE_PATH, 'utf8'));
        if (cache.expires_at > Date.now()) {
            return cache.access_token;
        }
    }

    console.log('Fetching new Twitch Access Token...');
    try {
        const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
            params: {
                client_id: clientId,
                client_secret: clientSecret,
                grant_type: 'client_credentials'
            }
        });

        const { access_token, expires_in } = response.data;
        const cacheData = {
            access_token,
            expires_at: Date.now() + (expires_in - 60) * 1000 // Buffer of 60 seconds
        };

        fs.writeFileSync(TOKEN_CACHE_PATH, JSON.stringify(cacheData));
        return access_token;
    } catch (error) {
        console.error('Failed to get Twitch access token:', error.response?.data || error.message);
        throw error;
    }
}

module.exports = { getAccessToken };
