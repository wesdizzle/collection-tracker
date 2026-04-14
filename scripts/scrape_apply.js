const Database = require('better-sqlite3');
const fs = require('fs');

const db = new Database('collection.sqlite');

function normalizeTitle(title) {
    if (!title) return '';
    return title.toLowerCase()
        .replace(/[–—]/g, '-')
        .replace(/[\(\)\-:]/g, ' ')
        .replace(/[^a-z0-9]/g, '')
        .trim();
}

function renamePlatformGlobal(oldName, newName) {
    if (oldName === newName) return;
    console.log(`  GLOBAL MIGRATION: Renaming platform "${oldName}" to "${newName}"...`);
    
    // 1. Update platforms table
    const platformUpdate = db.prepare('UPDATE platforms SET name = ? WHERE name = ?').run(newName, oldName);
    if (platformUpdate.changes > 0) {
        console.log(`    Updated platform record in "platforms" table.`);
    }

    // 2. Update all games
    const gamesUpdate = db.prepare('UPDATE games SET platform = ? WHERE platform = ?').run(newName, oldName);
    console.log(`    Updated ${gamesUpdate.changes} games in the "games" table.`);
}

async function applyChanges() {
    const reportPath = 'discovery_report.md';
    if (!fs.existsSync(reportPath)) {
        console.error('No discovery_report.md found.');
        return;
    }

    const content = fs.readFileSync(reportPath, 'utf8');
    const lines = content.split('\n');

    let currentSectionGame = null;
    let addedCount = 0;
    let ignoredCount = 0;
    let updatedCount = 0;

    console.log('--- Applying Discovery Changes ---');

    for (const line of lines) {
        if (line.startsWith('### ')) {
            const gameMatch = line.match(/### (.*) \((.*)\)/);
            if (gameMatch) {
                currentSectionGame = { title: gameMatch[1].trim(), platform: gameMatch[2].trim() };
            }
            continue;
        }

        const isAdd = line.startsWith('- [x]');
        const isOwned = line.startsWith('- [o]');
        const isIgnore = line.startsWith('- [r]');
        const isActionable = isAdd || isOwned;

        if (isActionable) {
            // Check for Sync Suggestions format: "- [o] **Update to:** Suggested (Platform) - ID: igdb-ID"
            // We need to handle the header above it to know which game we are updating
            const syncMatch = line.match(/- \[[xo]\] \*\*Update to:\*\* (.*) - ID: (.*)/);
            if (syncMatch) {
                const suggestedRaw = syncMatch[1].match(/(.*) \((.*)\)/) || [null, syncMatch[1], null];
                const newName = suggestedRaw[1].trim();
                const newPlatform = suggestedRaw[2] ? suggestedRaw[2].trim() : null;
                const id = syncMatch[2];

                // Since we don't have the "Current" in the line, we rely on the nearest h3 header
                // We'll need to track the current section game
                if (currentSectionGame) {
                    const localId = id.replace('igdb-', '').replace('fig-', '');
                    
                    if (id.startsWith('igdb-')) {
                        const existing = db.prepare(`
                            SELECT g.id, g.platform_id, p.display_name as platform
                            FROM games g
                            JOIN platforms p ON g.platform_id = p.id
                            WHERE g.title = ? AND p.display_name = ?
                        `).get(currentSectionGame.title, currentSectionGame.platform);

                        if (existing) {
                            db.prepare('UPDATE games SET title = ?, igdb_id = ?, region = ?, owned = 1 WHERE id = ?')
                                .run(newName, localId, 'NA', existing.id);
                            console.log(`  Synced Game: "${currentSectionGame.title}" (${currentSectionGame.platform}) -> "${newName}" [ID: ${localId}]`);
                            updatedCount++;
                        }
                    } else if (id.startsWith('fig-')) {
                        // Figures logic ... (if needed)
                    }
                }
                continue;
            }

            // Normal ADD/Discovery logic
            const itemMatch = line.match(/- \[[xo]\] \*\*(.*)\*\* \((.*) (.*)\) - ID: (.*)/) || 
                             line.match(/- \[[xo]\] \*\*(.*)\*\* \(.*\) - ID: (.*)/);
            
            if (itemMatch) {
                const name = itemMatch[1];
                const id = itemMatch[4] || itemMatch[2];
                const type = itemMatch[3] || 'Figure';
                const ownedStatus = isOwned ? 1 : 0;
                const normName = normalizeTitle(name);

                if (currentLine === 'Games') {
                    const existing = db.prepare('SELECT id, title FROM games').all().find(g => normalizeTitle(g.title) === normName);
                    
                    if (existing) {
                        db.prepare('UPDATE games SET title = ?, owned = ? WHERE id = ?').run(name, ownedStatus, existing.id);
                        console.log(`  Updated existing Game: "${existing.title}" -> "${name}"`);
                        updatedCount++;
                    } else {
                        db.prepare(`
                            INSERT OR IGNORE INTO games (id, title, series, platform, owned, queued) 
                            VALUES (?, ?, ?, ?, ?, 0)
                        `).run(id, name, currentSeries, 'Multiple Platforms', ownedStatus);
                        addedCount++;
                    }
                } else if (currentLine === 'Figures') {
                    const s = db.prepare('SELECT id FROM figure_series WHERE name = ?').get(currentSeries);
                    if (s) {
                        const existing = db.prepare('SELECT id, name FROM figures WHERE series_id = ?').all(s.id).find(f => normalizeTitle(f.name) === normName);
                        
                        if (existing) {
                            db.prepare('UPDATE figures SET name = ?, owned = ?, type = ? WHERE id = ?').run(name, ownedStatus, type, existing.id);
                            console.log(`  Updated existing Figure: "${existing.name}" -> "${name}" (${type})`);
                            updatedCount++;
                        } else {
                            db.prepare(`
                                INSERT OR IGNORE INTO figures (id, name, line, series_id, owned, type)
                                VALUES (?, ?, ?, ?, ?, ?)
                            `).run(id, name, 'amiibo', s.id, ownedStatus, type);
                            addedCount++;
                        }
                    }
                }
            }
        } else if (isIgnore) {
            const itemMatch = line.match(/- \[r\] \*\*(.*)\*\* \(.*\) - ID: (.*)/);
            if (itemMatch) {
                const name = itemMatch[1];
                const id = itemMatch[2];
                db.prepare('INSERT OR IGNORE INTO ignored_items (id, type, reason) VALUES (?, ?, ?)').run(id, currentLine, 'User Rejected');
                console.log(`  Ignored: ${name}`);
                ignoredCount++;
            }
        }
    }

    console.log(`\nApply Complete! Added: ${addedCount}, Updated: ${updatedCount}, Ignored: ${ignoredCount}`);
}

applyChanges();
