/**
 * LOCAL DEVELOPMENT PROXY & DISCOVERY SERVER
 * 
 * This server serves two roles in the local development environment:
 * 1. DISCOVERY HANDLER: It has direct access to the local filesystem (discovery_report.md)
 *    and the local source-of-truth database (collection.sqlite).
 * 2. PROXY: It transparently forwards all standard API requests (Games, Figures, Platforms)
 *    to the Cloudflare Wrangler dev server (Port 8787).
 * 
 * This architecture ensures that local-only tasks (scraping/reconciliation) work normally
 * while the core API uses the exact same logic that will run in production.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Source of truth local database
const db = new Database('collection.sqlite');
const PORT = 3000;

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
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
         * Reads the local 'discovery_report.md' file produced by my scraping scripts
         * and parses it into a JSON format for the UI.
         */
        if (req.method === 'GET' && pathname === '/api/discovery') {
            const reportPath = path.join(process.cwd(), 'discovery_report.md');
            if (!fs.existsSync(reportPath)) {
                res.end(JSON.stringify([]));
                return;
            }

            const content = fs.readFileSync(reportPath, 'utf8');
            const lines = content.split('\n');
            const discoveryItems = [];
            let currentItem = null;

            // Simple Markdown parser for the specific discovery report format
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
         * Updates the local database when a user 'reconciles' a game in the UI.
         */
        else if (req.method === 'POST' && pathname === '/api/discovery/apply') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                const { currentTitle, currentPlatform, selectedIgdbId, selectedName, region } = JSON.parse(body);
                
                // Find the existing local record
                const game = db.prepare(`
                    SELECT g.id FROM games g
                    JOIN platforms p ON g.platform_id = p.id
                    WHERE g.title = ? AND p.display_name = ?
                `).get(currentTitle, currentPlatform);

                if (game) {
                    const cleanId = selectedIgdbId.replace('igdb-', '');
                    // Update the local SQLite source-of-truth
                    db.prepare('UPDATE games SET title = ?, igdb_id = ?, region = ?, owned = 1 WHERE id = ?')
                        .run(selectedName, cleanId, region || 'NA', game.id);
                    res.end(JSON.stringify({ success: true }));
                } else {
                    res.statusCode = 404;
                    res.end(JSON.stringify({ error: 'Local game not found' }));
                }
            });
        }

        /**
         * FALLBACK: Transparent Proxy to Wrangler Dev (Port 8787)
         * All other API requests (Games, Figures, Platforms) are forwarded to the 
         * Cloudflare Worker running locally.
         */
        else {
            const proxyReq = http.request({
                host: 'localhost',
                port: 8787,
                path: req.url,
                method: req.method,
                headers: req.headers
            }, (proxyRes) => {
                res.writeHead(proxyRes.statusCode, proxyRes.headers);
                proxyRes.pipe(res, { end: true });
            });

            proxyReq.on('error', (err) => {
                console.error(`Proxy Error (is wrangler running?): ${err.message}`);
                res.statusCode = 502;
                res.end(JSON.stringify({ error: 'Wrangler Dev/D1 not reached' }));
            });

            req.pipe(proxyReq, { end: true });
        }

    } catch (e) {
        console.error('Server Logic Error:', e);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: e.message }));
    }
});

server.listen(PORT, () => {
    console.log(`Local Discovery/Proxy Server running at http://localhost:${PORT}`);
});
