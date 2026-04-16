import Database from 'better-sqlite3';
import { getAccessToken } from './scripts/lib/igdb-auth.js';
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

async function fixPlatforms() {
    console.log('--- DEFINITIVE REPAIR: North American Platform Launch Dates ---');
    const token = await getAccessToken();

    const platforms = db.prepare('SELECT id, name, igdb_id FROM platforms WHERE launch_date IS NULL OR launch_date = 0').all() as any[];
    console.log(`Found ${platforms.length} platforms requiring chronological data.`);

    for (const p of platforms) {
        process.stdout.write(`  Updating ${p.name}... `);
        
        // 1. Get Platform Versions and Release Dates in one go
        let platformQuery = '';
        if (p.igdb_id) {
            platformQuery = `fields name, versions.platform_version_release_dates.*; where id = ${p.igdb_id};`;
        } else {
            platformQuery = `fields name, versions.platform_version_release_dates.*; search "${p.name}"; limit 10;`;
        }

        const platformResults = await queryIGDB('platforms', platformQuery, token);
        let bestPlatform = null;
        if (p.igdb_id) {
            bestPlatform = platformResults[0];
        } else {
            const localNorm = normalizeForMatch(p.name);
            bestPlatform = platformResults.find(m => normalizeForMatch(m.name) === localNorm);
        }

        if (bestPlatform && bestPlatform.versions) {
            const allDateObjects: any[] = [];
            for (const v of bestPlatform.versions) {
                if (v.platform_version_release_dates) {
                    allDateObjects.push(...v.platform_version_release_dates);
                }
            }

            if (allDateObjects.length > 0) {
                // Filter for Region 2 (NA) or 8 (Worldwide)
                // Note: IGDB uses 'region' or 'release_region' depending on version/endpoint
                let naDates = allDateObjects.filter(d => (d.region === 2 || d.release_region === 2) && d.date);
                if (naDates.length === 0) {
                    naDates = allDateObjects.filter(d => (d.region === 8 || d.release_region === 8) && d.date);
                }
                
                // Fallback: earliest date available if no NA/Worldwide found
                if (naDates.length === 0) {
                    naDates = allDateObjects.filter(d => d.date);
                }

                if (naDates.length > 0) {
                    const earliestNaDate = Math.min(...naDates.map(d => d.date));
                    const isoDate = new Date(earliestNaDate * 1000).toISOString().split('T')[0];
                    db.prepare('UPDATE platforms SET launch_date = ? WHERE id = ?').run(isoDate, p.id);
                    console.log(`[Launch Date: ${isoDate}]`);
                    continue;
                }
            }
        }
        console.log('[No Valid Date Found]');
    }

    console.log('\nDefinitive platform repair complete.');
}

fixPlatforms().catch(console.error);
