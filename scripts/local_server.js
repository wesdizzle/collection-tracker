const http = require('http');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const db = new Database('collection.sqlite');
const PORT = 3000;

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;

    // CORS and JSON Headers
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    try {
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

        else if (req.method === 'POST' && pathname === '/api/discovery/apply') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                const { currentTitle, currentPlatform, selectedIgdbId, selectedName, region } = JSON.parse(body);
                
                const game = db.prepare(`
                    SELECT g.id FROM games g
                    JOIN platforms p ON g.platform_id = p.id
                    WHERE g.title = ? AND p.display_name = ?
                `).get(currentTitle, currentPlatform);

                if (game) {
                    const cleanId = selectedIgdbId.replace('igdb-', '');
                    db.prepare('UPDATE games SET title = ?, igdb_id = ?, region = ?, owned = 1 WHERE id = ?')
                        .run(selectedName, cleanId, region || 'NA', game.id);
                    res.end(JSON.stringify({ success: true }));
                } else {
                    res.statusCode = 404;
                    res.end(JSON.stringify({ error: 'Local game not found' }));
                }
            });
        }

        // FALLBACK: Proxy to Wrangler Dev (Port 8787)
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
                res.end(JSON.stringify({ error: 'Wrangler Dev not reached' }));
            });

            req.pipe(proxyReq, { end: true });
        }

    } catch (e) {
        console.error(e);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: e.message }));
    }
});

server.listen(PORT, () => {
    console.log(`Local API Server running at http://localhost:${PORT}`);
});
