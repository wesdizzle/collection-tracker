/**
 * LOCAL DEVELOPMENT API & DISCOVERY SERVER (TS)
 * 
 * This server serves as the backend for the local development environment.
 * It directly queries the 'collection.sqlite' source-of-truth database.
 * 
 * It handles:
 * 1. Collection API: Games, Toys, and Platforms (mirroring worker/worker.ts)
 * 2. Discovery API: Reading and applying scraping reconciliation reports.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import { getGameById, PLATFORM_MAP } from './lib/igdb.js';
import { parseDiscoveryReport } from './lib/discovery.js';
import type { ApplyPayload } from './lib/discovery.js';
import { 
    GAMES_LIST_QUERY, 
    GAME_DETAIL_QUERY, 
    PLATFORMS_LIST_QUERY, 
    TOYS_LIST_QUERY, 
    TOY_DETAIL_QUERY,
    GAMES_ORDER_BY 
} from './lib/queries.js';

// Source of truth local database
const db = new Database('collection.sqlite');
const PORT = 3000;

/**
 * CORE REQUEST HANDLER
 * Extracted for unit testing with dependency injection (db).
 */
export const handleRequest = (db: Database.Database) => async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);
    const pathname = url.pathname;

    // Enable cross-origin requests for the frontend (running on Port 4200)
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle Pre-flight options
    if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
    }

    try {
        /**
         * ROUTE: GET /api/discovery
         */
        if (req.method === 'GET' && pathname === '/api/discovery') {
            const reportPath = path.join(process.cwd(), 'discovery_report.md');
            if (!fs.existsSync(reportPath)) {
                res.end(JSON.stringify([]));
                return;
            }

            const content = fs.readFileSync(reportPath, 'utf8');
            const discoveryItems = parseDiscoveryReport(content);
            res.end(JSON.stringify(discoveryItems));
        }

        /**
         * ROUTE: POST /api/discovery/apply
         */
        else if (req.method === 'POST' && pathname === '/api/discovery/apply') {
            let currentTitle = '';
            let currentPlatform = '';
            let isToy = false;

            try {
                const body = await new Promise<string>((resolve, reject) => {
                    let data = '';
                    req.on('data', chunk => data += chunk);
                    req.on('end', () => resolve(data));
                    req.on('error', err => reject(err));
                });

                const payload: ApplyPayload = JSON.parse(body);
                currentTitle = payload.currentTitle;
                currentPlatform = payload.currentPlatform;
                const { selectedIgdbId, selectedName, selectedPlatform, region } = payload;
                isToy = selectedIgdbId.toString().startsWith('amiibo-');

                if (isToy) {
                    const amiiboId = selectedIgdbId.toString().replace('amiibo-', '');
                    try {
                        const apiUrl = `https://amiiboapi.org/api/amiibo/?id=${amiiboId}`;
                        console.log(`Fetching amiibo metadata: ${apiUrl}`);
                        const response = await axios.get(apiUrl, { timeout: 10000 });
                        const a = response.data.amiibo;
                        
                        if (!a) {
                            throw new Error(`Amiibo API returned no results for ID: ${amiiboId}`);
                        }
                        
                        db.prepare(`
                            UPDATE toys 
                            SET amiibo_id = ?, name = ?, type = ?, image_url = ?, game_series = ?, region = ?, verified = 1, metadata_json = ?
                            WHERE name = ? AND line = 'amiibo'
                        `).run(amiiboId, a.name, a.type, a.image, a.gameSeries, region || 'NA', JSON.stringify(a), currentTitle);
                        
                        console.log(`Matched Toy: ${currentTitle} -> ${a.name} [ID: ${amiiboId}]`);
                    } catch (apiErr: unknown) {
                        console.error(`Amiibo API fetch failed for ID ${amiiboId}:`, apiErr);
                        const apiErrMsg = apiErr instanceof Error ? apiErr.message : 'Unknown error';
                        // Throw specific error format so frontend displays it cleanly
                        throw new Error(`Failed to fetch amiibo metadata: ${apiErrMsg}`, { cause: apiErr });
                    }
                } else {
                    // 1. Fetch Full Metadata from IGDB
                    let summary: string | null = null;
                    let imageUrl: string | null = null;
                    let genres: string | null = null;
                    let finalName = selectedName;
                    const finalIgdbId = selectedIgdbId.toString().replace('igdb-', '');

                    try {
                        const igdbPlatformId = PLATFORM_MAP[selectedPlatform || currentPlatform];
                        const igdbData = await getGameById(Number(finalIgdbId), igdbPlatformId);

                        if (igdbData) {
                            summary = igdbData.summary || null;
                            imageUrl = igdbData.image_url || null;
                            genres = igdbData.genres || null;
                            finalName = igdbData.name; // Use canonical name from IGDB
                        }
                    } catch (igdbErr) {
                        console.error('Failed to fetch rich metadata from IGDB:', igdbErr);
                    }

                    // 2. Update the Local SQLite Source-of-Truth
                    const game = db.prepare(`
                        SELECT g.id FROM games g
                        JOIN platforms p ON g.platform_id = p.id
                        WHERE (g.title = ? OR g.title = ?) AND p.display_name = ?
                    `).get(currentTitle, finalName, currentPlatform) as { id: number } | undefined;

                    if (game) {
                        let finalPlatformId = null;
                        if (selectedPlatform && selectedPlatform !== currentPlatform) {
                            const platform = db.prepare('SELECT id FROM platforms WHERE display_name = ?').get(selectedPlatform) as { id: number } | undefined;
                            if (platform) {
                                finalPlatformId = platform.id;
                            }
                        }

                        const slugify = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                        const newId = `${slugify(finalName)}-${slugify(selectedPlatform || currentPlatform)}`;

                        db.prepare(`
                            UPDATE games 
                            SET id = ?, title = ?, platform_id = COALESCE(?, platform_id), igdb_id = ?, region = ?, summary = ?, image_url = ?, genres = ? 
                            WHERE id = ?
                        `).run(newId, finalName, finalPlatformId, finalIgdbId, region || 'NA', summary, imageUrl, genres, game.id);

                        console.log(`Matched Game: ${currentTitle} (${currentPlatform}) -> ${finalName} (${selectedPlatform || currentPlatform}) [ID: ${finalIgdbId}]`);
                    }
                }
            } catch (err: unknown) {
                console.error('Discovery Apply failed:', err);
                const error = err instanceof Error ? err : new Error('Unknown error');
                res.statusCode = 500;
                res.end(JSON.stringify({ 
                    error: error.message || 'Internal server error during discovery apply',
                    details: error.stack 
                }));
                return;
            }

            // Sync to Local D1 Instance
            try {
                const syncCmd = process.platform === 'win32' ? 'npm.cmd run sync-db' : 'npm run sync-db';
                execSync(syncCmd, { stdio: 'inherit' });
            } catch (syncErr) {
                console.error('D1 Sync Error:', syncErr);
            }

            // Force Checkpoint
            try {
                db.pragma('wal_checkpoint(FULL)');
            } catch (checkpointErr) {
                console.error('Checkpoint Error:', checkpointErr);
            }

            // 3. Update Discovery Report (Remove matched item)
            try {
                const reportPath = path.join(process.cwd(), 'discovery_report.md');
                if (fs.existsSync(reportPath)) {
                    const content = fs.readFileSync(reportPath, 'utf8');
                    const sections = content.split('\n### ');

                    // Keep the first section (header) and filter out the matched one
                    const header = sections[0];
                    const remainingSections = sections.slice(1).filter(section => {
                        const headerLine = section.split('\n')[0];
                        const targetHeader = isToy ? `${currentTitle} (amiibo)` : `${currentTitle} (${currentPlatform})`;
                        return headerLine.trim() !== targetHeader.trim();
                    });

                    const newContent = [header, ...remainingSections].join('\n### ');
                    fs.writeFileSync(reportPath, newContent, 'utf8');
                    console.log('Updated discovery_report.md');
                }
            } catch (reportErr) {
                console.error('Report Update Error:', reportErr);
            }

            res.end(JSON.stringify({ success: true }));
        }

        /**
         * STANDALONE COLLECTION API HANDLERS
         * (Migrated from worker/worker.ts to ensure stability during local dev)
         */

        // GET /api/platforms
        else if (req.method === 'GET' && pathname === '/api/platforms') {
            const query = PLATFORMS_LIST_QUERY;
            const platforms = db.prepare(query).all();
            res.end(JSON.stringify(platforms));
        }

        // GET /api/games
        else if (req.method === 'GET' && pathname === '/api/games') {
            const platformId = url.searchParams.get('platform');
            const params: unknown[] = [];
            let query = GAMES_LIST_QUERY;

            if (platformId) {
                query += ' AND (g.platform_id = ? OR p.parent_platform_id = ?)';
                params.push(platformId, platformId);
            }

            query += GAMES_ORDER_BY;

            const games = db.prepare(query).all(...params);
            res.end(JSON.stringify(games));
        }

        // GET /api/games/:id
        else if (req.method === 'GET' && pathname.startsWith('/api/games/')) {
            const id = pathname.split('/').pop();
            const query = GAME_DETAIL_QUERY;
            const game = db.prepare(query).get(id);
            if (!game) {
                res.statusCode = 404;
                res.end(JSON.stringify({ error: 'Not found' }));
            } else {
                res.end(JSON.stringify(game));
            }
        }

        // GET /api/toys
        else if (req.method === 'GET' && pathname === '/api/toys') {
            const query = TOYS_LIST_QUERY;
            const toys = db.prepare(query).all();
            res.end(JSON.stringify(toys));
        }

        // GET /api/toys/:id
        else if (req.method === 'GET' && pathname.startsWith('/api/toys/')) {
            const id = pathname.split('/').pop();
            const query = TOY_DETAIL_QUERY;
            const toy = db.prepare(query).get(id);
            if (!toy) {
                res.statusCode = 404;
                res.end(JSON.stringify({ error: 'Not found' }));
            } else {
                res.end(JSON.stringify(toy));
            }
        }

        // Default fallback
        else {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Not found' }));
        }

    } catch (err) {
        console.error('Server Error:', err);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
};

const server = http.createServer(handleRequest(db));

// Only start the server if this file is run directly
import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    server.listen(PORT, () => {
        console.log(`Standalone Local API Server running at http://localhost:${PORT}`);
    });
}
