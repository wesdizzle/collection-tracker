import Database from 'better-sqlite3';
import { getAccessToken } from './lib/igdb-auth.js';
import axios from 'axios';
import * as fs from 'fs';
import 'dotenv/config';

const db = new Database('collection.sqlite');
const IGDB_ENDPOINT = 'https://api.igdb.com/v4';

/**
 * UTILITY: normalizeForMatch
 * 
 * Standardizes titles for loose but accurate matching by removing 
 * casing, punctuation, and extra whitespace.
 */
function normalizeForMatch(title: string): string {
    if (!title) return '';
    return title.toLowerCase()
        .replace(/[–—]/g, '-')
        .replace(/[\(\)\-:]/g, ' ')
        .replace(/[^a-z0-9]/g, '')
        .trim();
}

/**
 * UTILITY: queryIGDB
 */
async function queryIGDB(endpoint: string, query: string, token: string, retryCount = 0): Promise<any[]> {
    const clientId = process.env['TWITCH_CLIENT_ID'];
    try {
        const response = await axios.post(`${IGDB_ENDPOINT}/${endpoint}`, query, {
            headers: {
                'Client-ID': clientId,
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'text/plain'
            }
        });
        await new Promise(resolve => setTimeout(resolve, 250)); 
        return response.data;
    } catch (error: any) {
        if (error.response?.status === 429 && retryCount < 5) {
            const delay = Math.pow(2, retryCount + 1) * 1000;
            console.warn(`  Rate limited. Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return queryIGDB(endpoint, query, token, retryCount + 1);
        }
        console.error(`  IGDB Error (${endpoint}):`, error.response?.data || error.message);
        return [];
    }
}

async function fixLegacyData() {
    console.log('--- Starting Data Reconstruction & Discovery Generation (v2) ---');
    const token = await getAccessToken();

    // 1. RECONCILE PLATFORM IDS
    // Some platforms have null igdb_id, which breaks discovery searching.
    const platforms = db.prepare('SELECT id, name, igdb_id FROM platforms').all() as any[];
    for (const p of platforms) {
        if (!p.igdb_id) {
            console.log(`  Fetching IGDB ID for Platform: ${p.name}...`);
            const results = await queryIGDB('platforms', `fields id; search "${p.name}"; limit 1;`, token);
            if (results.length > 0) {
                db.prepare('UPDATE platforms SET igdb_id = ? WHERE id = ?').run(results[0].id, p.id);
                p.igdb_id = results[0].id;
                console.log(`    Updated ${p.name} -> ID: ${p.igdb_id}`);
            }
        }
    }

    const unmatchedItems: any[] = [];

    // 2. Detect Collision Pairs
    const clashes = db.prepare('SELECT title, platform_id, COUNT(*) as c FROM games GROUP BY title, platform_id HAVING c > 1').all() as any[];
    const clashingPairs = new Set(clashes.map(c => `${c.title}|${c.platform_id}`));

    // 3. Fetch all games with updated platform metadata
    const games = db.prepare(`
        SELECT g.stable_id, g.id as current_slug, g.title, p.display_name as platform_name, 
               p.igdb_id as platform_igdb_id, p.id as platform_id
        FROM games g
        JOIN platforms p ON g.platform_id = p.id
    `).all() as any[];

    console.log(`Processing ${games.length} games for reconstruction...`);

    for (const g of games) {
        const searchTitle = g.title.replace(/\(.*\)/g, '').replace(/[:]/g, '').trim();
        // If platform IGDB ID is still null (e.g. Switch 2), skip platform filtering to try and find a match
        const platformFilter = g.platform_igdb_id ? ` & platforms = (${g.platform_igdb_id})` : '';
        const query = `fields name, id, release_dates.region, cover.url; search "${searchTitle.replace(/"/g, '')}"; where 1=1 ${platformFilter}; limit 20;`;
        const matches = await queryIGDB('games', query, token);
        
        let bestMatch = null;
        const localNorm = normalizeForMatch(g.title);

        for (const m of matches) {
            if (normalizeForMatch(m.name) === localNorm) {
                bestMatch = m;
                break;
            }
        }

        if (bestMatch) {
            const updatedTitle = bestMatch.name;
            const updatedIgdbId = bestMatch.id;
            let updatedRegion = 'NA';
            let updatedImageUrl = null;

            if (bestMatch.cover && bestMatch.cover.url) {
                updatedImageUrl = 'https:' + bestMatch.cover.url.replace('t_thumb', 't_cover_big');
            }

            if (bestMatch.release_dates && bestMatch.release_dates.length > 0) {
                const regionId = bestMatch.release_dates[0].region;
                const regionMap: Record<number, string> = { 1: 'EU', 2: 'NA', 3: 'AU', 4: 'NZ', 5: 'JP', 6: 'CH', 7: 'AS', 8: 'WW' };
                updatedRegion = regionMap[regionId] || 'NA';
            }

            const slugify = (text: string) => text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
            let newSlug = `${slugify(updatedTitle)}-${slugify(g.platform_name)}`;
            if (clashingPairs.has(`${g.title}|${g.platform_id}`)) {
                newSlug += `-${g.stable_id}`;
            }

            db.prepare('UPDATE games SET title = ?, id = ?, igdb_id = ?, region = ?, image_url = ? WHERE stable_id = ?')
                .run(updatedTitle, newSlug, updatedIgdbId, updatedRegion, updatedImageUrl, g.stable_id);
            
            process.stdout.write('.'); // Minor progress indicator
        } else {
            db.prepare('UPDATE games SET igdb_id = NULL, image_url = NULL WHERE stable_id = ?').run(g.stable_id);
            unmatchedItems.push({ item: g, suggestions: matches.slice(0, 10) });
            process.stdout.write('x');
        }
    }

    // 4. Generate Discovery Report
    let report = '# Discovery Report\n\nThis report lists findings from the collection reconstruction pipeline.\n\n';
    report += '### Instructions:\n';
    report += '- Mark with **`[o]`** to **Link** an existing item.\n\n';
    report += '## Action Required: Unmatched Items\n';

    for (const u of unmatchedItems) {
        report += `### ${u.item.title} (${u.item.platform_name})\n`;
        if (u.suggestions.length > 0) {
            for (const s of u.suggestions) {
                const img = s.cover && s.cover.url ? 'https:' + s.cover.url.replace('t_thumb', 't_cover_big') : null;
                report += `- [ ] **Link to:** ${s.name} (${u.item.platform_name}) - ID: igdb-${s.id}\n`;
                if (img) report += `  - ![cover](${img})\n`;
            }
        } else {
            report += '- No suggestions found.\n';
        }
        report += '\n';
    }

    fs.writeFileSync('discovery_report.md', report);
    console.log(`\nReconstruction complete. ${games.length - unmatchedItems.length} matched, ${unmatchedItems.length} unmatched. Recommendations saved to discovery_report.md.`);
}

fixLegacyData().catch(console.error);
