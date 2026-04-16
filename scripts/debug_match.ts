import Database from 'better-sqlite3';
import { getAccessToken } from './lib/igdb-auth.js';
import axios from 'axios';
import 'dotenv/config';

const db = new Database('collection.sqlite');
const IGDB_ENDPOINT = 'https://api.igdb.com/v4';

function normalizeForMatch(title: string): string {
    if (!title) return '';
    return title.toLowerCase()
        .replace(/[–—]/g, '-')
        .replace(/[\(\)\-:]/g, ' ')
        .replace(/[^a-z0-9]/g, '')
        .trim();
}

async function queryIGDB(endpoint: string, query: string, token: string): Promise<any[]> {
    const clientId = process.env['TWITCH_CLIENT_ID'];
    console.log(`  [Query]: ${query}`);
    try {
        const response = await axios.post(`${IGDB_ENDPOINT}/${endpoint}`, query, {
            headers: {
                'Client-ID': clientId,
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'text/plain'
            }
        });
        return response.data;
    } catch (error: any) {
        console.error(`  [IGDB Error]:`, error.response?.data || error.message);
        return [];
    }
}

async function debugMatch() {
    const token = await getAccessToken();
    const game = { title: 'Castlevania', platform_name: 'Nintendo Entertainment System', platform_igdb_id: 18 };
    
    console.log(`--- Debugging Match for: ${game.title} ---`);
    const searchTitle = game.title.replace(/\(.*\)/g, '').replace(/[:]/g, '').trim();
    const platformFilter = game.platform_igdb_id ? `where platforms = (${game.platform_igdb_id});` : '';
    const query = `fields name, id; search "${searchTitle.replace(/"/g, '')}"; ${platformFilter} limit 10;`;
    
    const matches = await queryIGDB('games', query, token);
    console.log(`  [Matches Count]: ${matches.length}`);
    
    const localNorm = normalizeForMatch(game.title);
    console.log(`  [Local Normalized]: "${localNorm}"`);

    for (const m of matches) {
        const remoteNorm = normalizeForMatch(m.name);
        console.log(`  [Remote]: "${m.name}" -> Normalized: "${remoteNorm}" | Match: ${localNorm === remoteNorm}`);
    }
}

debugMatch().catch(console.error);
