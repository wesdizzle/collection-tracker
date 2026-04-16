import Database from 'better-sqlite3';
import { getAccessToken } from './lib/igdb-auth.js';
import axios from 'axios';
import * as fs from 'fs';
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
        return [];
    }
}

async function definitiveRecovery() {
    console.log('--- Phase 1: Scorched Earth Sanitization ---');
    db.prepare('UPDATE games SET igdb_id = NULL, image_url = NULL').run();
    console.log('  Cleaned all game identifiers and box art URLs.');

    console.log('\n--- Phase 2: High-Fidelity Data Reconstruction ---');
    const token = await getAccessToken();

    const games = db.prepare(`
        SELECT g.stable_id, g.title, p.display_name as platform_name, 
               p.igdb_id as platform_igdb_id, p.id as platform_id
        FROM games g
        JOIN platforms p ON g.platform_id = p.id
    `).all() as any[];

    console.log(`Verifying ${games.length} games with strict query structure...`);

    const unmatchedItems: any[] = [];
    let matchedCount = 0;

    for (const g of games) {
        const searchTitle = g.title.replace(/\(.*\)/g, '').replace(/[:]/g, '').trim();
        const platformFilter = g.platform_igdb_id ? `; where platforms = (${g.platform_igdb_id})` : '';
        
        // Correct query structure confirmed by research: search follows by fields and where
        const query = `search "${searchTitle.replace(/"/g, '')}"; fields name, id, release_dates.region, cover.url${platformFilter}; limit 20;`;
        const matches = await queryIGDB('games', query, token);
        
        const localNorm = normalizeForMatch(g.title);
        const exactMatches = matches.filter(m => normalizeForMatch(m.name) === localNorm);

        let bestMatch = null;
        if (exactMatches.length > 0) {
            // Priority: shortest name to avoid "Series" or "Collection" entries overriding base games
            bestMatch = exactMatches.sort((a, b) => a.name.length - b.name.length)[0];
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

            // Slug generation with clash avoidance 
            const slugify = (text: string) => text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
            let newSlug = `${slugify(updatedTitle)}-${slugify(g.platform_name)}`;
            const collision = db.prepare('SELECT stable_id FROM games WHERE id = ? AND stable_id != ?').get(newSlug, g.stable_id);
            if (collision) newSlug += `-${g.stable_id}`;

            db.prepare('UPDATE games SET title = ?, id = ?, igdb_id = ?, region = ?, image_url = ? WHERE stable_id = ?')
                .run(updatedTitle, newSlug, updatedIgdbId, updatedRegion, updatedImageUrl, g.stable_id);
            
            matchedCount++;
            process.stdout.write('.');
        } else {
            unmatchedItems.push({ item: g, suggestions: matches.slice(0, 10) });
            process.stdout.write('x');
        }
    }

    // 3. Discovery Report
    let report = '# Discovery Report\n\nThis report lists results from the scorched-earth restoration pipeline.\n\n';
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
    console.log(`\n\nRestoration Complete. Matched: ${matchedCount}, Unmatched: ${unmatchedItems.length}. Recommendations saved to discovery_report.md.`);
}

definitiveRecovery().catch(console.error);
