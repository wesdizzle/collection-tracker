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
        if (req.method === 'GET' && pathname === '/api/games') {
            const platformId = url.searchParams.get('platform_id');
            let query = `
                SELECT g.*, p.display_name, p.brand, p.launch_date as platform_launch_date 
                FROM games g 
                LEFT JOIN platforms p ON g.platform_id = p.id 
                WHERE 1=1
            `;
            const params = [];
            if (platformId) {
                query += ` AND (g.platform_id = ? OR p.parent_platform_id = ?)`;
                params.push(platformId, platformId);
            }
            query += ` ORDER BY p.brand COLLATE NOCASE ASC, COALESCE(p.parent_platform_id, p.id) ASC, p.launch_date ASC, g.platform_id ASC, 
                       CASE WHEN COALESCE(g.series, g.title) COLLATE NOCASE LIKE 'the %' THEN SUBSTR(COALESCE(g.series, g.title), 5) WHEN COALESCE(g.series, g.title) COLLATE NOCASE LIKE 'a %' THEN SUBSTR(COALESCE(g.series, g.title), 3) ELSE COALESCE(g.series, g.title) END COLLATE NOCASE ASC, 
                       g.release_date IS NULL ASC, g.release_date ASC, g.sort_index IS NULL ASC, g.sort_index ASC, 
                       CASE WHEN g.title COLLATE NOCASE LIKE 'the %' THEN SUBSTR(g.title, 5) WHEN g.title COLLATE NOCASE LIKE 'a %' THEN SUBSTR(g.title, 3) ELSE g.title END COLLATE NOCASE ASC`;
            
            const results = db.prepare(query).all(...params);
            res.end(JSON.stringify(results));
        }

        else if (req.method === 'GET' && pathname.startsWith('/api/games/')) {
            const id = pathname.split('/').pop();
            const query = `
                SELECT g.*, p.display_name, p.brand, p.launch_date as platform_launch_date 
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
            const results = db.prepare(query).all();
            res.end(JSON.stringify(results));
        }

        else if (req.method === 'GET' && pathname === '/api/discovery') {
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
                
                // Find game
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

        else {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Path not found' }));
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
