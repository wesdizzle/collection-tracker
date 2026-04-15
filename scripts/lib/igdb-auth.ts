import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

// ES Module equivalent for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN_CACHE_PATH = path.join(__dirname, '..', '..', '.igdb_token_cache.json');

interface TokenCache {
    access_token: string;
    expires_at: number;
}

/**
 * UTILITY: getAccessToken
 * 
 * Retrieves a valid Twitch Access Token for IGDB API requests.
 * Implements a simple file-level cache to avoid redundant token generation.
 */
export async function getAccessToken(): Promise<string> {
    const clientId = process.env['TWITCH_CLIENT_ID'];
    const clientSecret = process.env['TWITCH_CLIENT_SECRET'];

    if (!clientId || !clientSecret) {
        throw new Error('TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET must be set in .env');
    }

    // Check Cache
    if (fs.existsSync(TOKEN_CACHE_PATH)) {
        try {
            const cache: TokenCache = JSON.parse(fs.readFileSync(TOKEN_CACHE_PATH, 'utf8'));
            if (cache.expires_at > Date.now()) {
                return cache.access_token;
            }
        } catch (e) {
            console.warn('Malformed IGDB token cache. Refreshing...');
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
        const cacheData: TokenCache = {
            access_token,
            expires_at: Date.now() + (expires_in - 60) * 1000 // Buffer of 60 seconds
        };

        fs.writeFileSync(TOKEN_CACHE_PATH, JSON.stringify(cacheData));
        return access_token;
    } catch (error: any) {
        console.error('Failed to get Twitch access token:', error.response?.data || error.message);
        throw error;
    }
}
