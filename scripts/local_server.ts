/**
 * LOCAL DEVELOPMENT API & DISCOVERY SERVER (TS)
 * 
 * This server serves as the backend for the local development environment.
 * It directly queries the 'collection.sqlite' source-of-truth database.
 * 
 * It handles:
 * 1. Collection API: Games, Figures, and Platforms (mirroring worker/worker.ts)
 * 2. Discovery API: Reading and applying scraping reconciliation reports.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import { getGameById, PLATFORM_MAP } from './lib/igdb.js';

// Source of truth local database
const db = new Database('collection.sqlite');
const PORT = 3000;

interface DiscoveryOption {
    name: string;
    platform: string;
    id: string;
    image_url: string | null;
    summary: string | null;
}

interface DiscoveryItem {
    title: string;
    platform: string;
    options: DiscoveryOption[];
}

interface ApplyPayload {
    currentTitle: string;
    currentPlatform: string;
    selectedIgdbId: string;
    selectedName: string;
    region?: string;
}

const server = http.createServer(async (req, res) => {
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
            const lines = content.split('\n');
            const discoveryItems: DiscoveryItem[] = [];
            let currentItem: DiscoveryItem | null = null;

            for (const line of lines) {
                if (line.startsWith('### ')) {
                    if (currentItem) discoveryItems.push(currentItem);
                    const match = line.match(/### (.*) \((.*)\)/);
                    if (match) {
                        currentItem = {
                            title: match[1].trim(),
                            platform: match[2].trim(),
                            options: []
                        };
                    }
                } else if (currentItem && line.match(/- \[ \] \*\*(Update to|Link to):\*\*/)) {
                    const match = line.match(/- \[ \] \*\*(?:Update to|Link to):\*\* (.*) \((.*)\) - ID: (.*)/);
                    if (match) {
                        currentItem.options.push({
                            name: match[1].trim(),
                            platform: match[2].trim(),
                            id: match[3].trim(),
                            image_url: null,
                            summary: null
                        });
                    }
                } else if (currentItem && currentItem.options.length > 0 && line.startsWith('  - ![')) {
                    const match = line.match(/!\[.*\]\((.*)\)/);
                    if (match) currentItem.options[currentItem.options.length - 1].image_url = match[1];
                } else if (currentItem && currentItem.options.length > 0 && line.startsWith('  - *')) {
                    const match = line.match(/\*([\s\S]*)\*/);
                    if (match) currentItem.options[currentItem.options.length - 1].summary = match[1].trim();
                }
            }
            if (currentItem) discoveryItems.push(currentItem);
            res.end(JSON.stringify(discoveryItems));
        }

        /**
         * ROUTE: POST /api/discovery/apply
         */
        else if (req.method === 'POST' && pathname === '/api/discovery/apply') {
            const body = await new Promise<string>((resolve, reject) => {
                let data = '';
                req.on('data', chunk => data += chunk);
                req.on('end', () => resolve(data));
                req.on('error', err => reject(err));
            });

            const { currentTitle, currentPlatform, selectedIgdbId, selectedName, region }: ApplyPayload = JSON.parse(body);
            
            // 1. Fetch Full Metadata from IGDB
            let summary: string | null = null;
            let imageUrl: string | null = null;
            let genres: string | null = null;
            let finalName = selectedName;
            const finalIgdbId = selectedIgdbId.toString().replace('igdb-', '');

            try {
                const igdbPlatformId = PLATFORM_MAP[currentPlatform];
                const igdbData = await getGameById(Number(finalIgdbId), igdbPlatformId);
                
                if (igdbData) {
                    summary = igdbData.summary || null;
                    imageUrl = igdbData.image_url || null;
                    genres = igdbData.genres || null;
                    finalName = igdbData.name; // Use canonical name from IGDB
                }
            } catch (igdbErr) {
                console.error('Failed to fetch rich metadata from IGDB:', igdbErr);
                // Fallback to what we have in the payload
            }

            // 2. Update the Local SQLite Source-of-Truth
            const game = db.prepare(`
                SELECT g.id FROM games g
                JOIN platforms p ON g.platform_id = p.id
                WHERE (g.title = ? OR g.title = ?) AND p.display_name = ?
            `).get(currentTitle, finalName, currentPlatform) as { id: number } | undefined;

            if (game) {
                db.prepare(`
                    UPDATE games 
                    SET title = ?, igdb_id = ?, region = ?, summary = ?, image_url = ?, genres = ?, owned = 1 
                    WHERE id = ?
                `).run(finalName, finalIgdbId, region || 'NA', summary, imageUrl, genres, game.id);
                
                console.log(`Matched: ${currentTitle} -> ${finalName} (ID: ${finalIgdbId}) with full metadata.`);

                // 2. Sync to Local D1 Instance (important for frontend preview)
                try {
                    const syncCmd = process.platform === 'win32' ? 'npm.cmd run sync-db' : 'npm run sync-db';
                    execSync(syncCmd, { stdio: 'inherit' });
                    console.log('Successfully synced to Local D1.');
                } catch (syncErr) {
                    console.error('D1 Sync Error:', syncErr);
                }

                // 3. Force Checkpoint (merges WAL into main sqlite file so user sees timestamp update)
                try {
                    db.pragma('wal_checkpoint(FULL)');
                    console.log('Database checkpoint completed.');
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
                            const targetHeader = `${currentTitle} (${currentPlatform})`;
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
            } else {
                res.statusCode = 404;
                res.end(JSON.stringify({ error: `Local game not found: "${currentTitle}" on "${currentPlatform}"` }));
            }
        }

        /**
         * STANDALONE COLLECTION API HANDLERS
         * (Migrated from worker/worker.ts to ensure stability during local dev)
         */

        // GET /api/platforms
        else if (req.method === 'GET' && pathname === '/api/platforms') {
            const query = `
                SELECT p.* FROM platforms p 
                WHERE EXISTS (
                    SELECT 1 FROM games g 
                    WHERE g.platform_id = p.id 
                    OR g.platform_id IN (SELECT id FROM platforms WHERE parent_platform_id = p.id)
                )
                ORDER BY brand ASC, COALESCE(parent_platform_id, id) ASC, launch_date ASC
            `;
            const platforms = db.prepare(query).all();
            res.end(JSON.stringify(platforms));
        }

        // GET /api/games
        else if (req.method === 'GET' && pathname === '/api/games') {
            const platformId = url.searchParams.get('platform');
            const params: unknown[] = [];
            let query = `
                SELECT g.*, p.display_name, p.brand, p.launch_date as platform_launch_date, p.image_url as platform_logo
                FROM games g 
                LEFT JOIN platforms p ON g.platform_id = p.id
                WHERE 1=1
            `;

            if (platformId) {
                query += ' AND (g.platform_id = ? OR p.parent_platform_id = ?)';
                params.push(platformId, platformId);
            }

            query += ` ORDER BY p.brand COLLATE NOCASE ASC, COALESCE(p.parent_platform_id, p.id) ASC, p.launch_date ASC, g.platform_id ASC, 
                       CASE WHEN COALESCE(g.series, g.title) COLLATE NOCASE LIKE 'the %' THEN SUBSTR(COALESCE(g.series, g.title), 5) WHEN COALESCE(g.series, g.title) COLLATE NOCASE LIKE 'a %' THEN SUBSTR(COALESCE(g.series, g.title), 3) ELSE COALESCE(g.series, g.title) END COLLATE NOCASE ASC, 
                       g.release_date IS NULL ASC, g.release_date ASC, g.sort_index IS NULL ASC, g.sort_index ASC, 
                       CASE WHEN g.title COLLATE NOCASE LIKE 'the %' THEN SUBSTR(g.title, 5) WHEN g.title COLLATE NOCASE LIKE 'a %' THEN SUBSTR(g.title, 3) ELSE g.title END COLLATE NOCASE ASC`;

            const games = db.prepare(query).all(...params);
            res.end(JSON.stringify(games));
        }

        // GET /api/games/:id
        else if (req.method === 'GET' && pathname.startsWith('/api/games/')) {
            const id = pathname.split('/').pop();
            const query = `
                SELECT g.*, p.display_name, p.brand, p.launch_date as platform_launch_date, p.image_url as platform_logo
                FROM games g 
                LEFT JOIN platforms p ON g.platform_id = p.id 
                WHERE g.id = ?
            `;
            const game = db.prepare(query).get(id);
            if (!game) {
                res.statusCode = 404;
                res.end(JSON.stringify({ error: 'Not found' }));
            } else {
                res.end(JSON.stringify(game));
            }
        }

        // GET /api/figures
        else if (req.method === 'GET' && pathname === '/api/figures') {
            const query = `
                SELECT f.*, fs.line as series_line, fs.name as series_name, fs.sort_index as series_index
                FROM figures f
                LEFT JOIN figure_series fs ON f.series_id = fs.id
                ORDER BY 
                         CASE WHEN fs.line COLLATE NOCASE LIKE 'the %' THEN SUBSTR(fs.line, 5) WHEN fs.line COLLATE NOCASE LIKE 'a %' THEN SUBSTR(fs.line, 3) ELSE fs.line END COLLATE NOCASE ASC, 
                         fs.sort_index IS NULL ASC, fs.sort_index ASC, 
                         CASE WHEN fs.name COLLATE NOCASE LIKE 'the %' THEN SUBSTR(fs.name, 5) WHEN fs.name COLLATE NOCASE LIKE 'a %' THEN SUBSTR(fs.name, 3) ELSE fs.name END COLLATE NOCASE ASC, 
                         f.release_date IS NULL ASC, f.release_date ASC, 
                         f.sort_index IS NULL ASC, f.sort_index ASC, 
                         CASE WHEN f.name COLLATE NOCASE LIKE 'the %' THEN SUBSTR(f.name, 5) WHEN f.name COLLATE NOCASE LIKE 'a %' THEN SUBSTR(f.name, 3) ELSE f.name END COLLATE NOCASE ASC
            `;
            const figures = db.prepare(query).all();
            res.end(JSON.stringify(figures));
        }

        // 404 Fallback
        else {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Route not found locally' }));
        }

    } catch (e: unknown) {
        console.error('Server Logic Error:', e);
        res.statusCode = 500;
        const message = e instanceof Error ? e.message : 'Unknown error';
        res.end(JSON.stringify({ error: message }));
    }
});

server.listen(PORT, () => {
    console.log(`Standalone Local API Server running at http://localhost:${PORT}`);
});
