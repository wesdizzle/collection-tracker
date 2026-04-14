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

    let currentSeries = '';
    let currentLine = '';
    let addedCount = 0;
    let ignoredCount = 0;
    let updatedCount = 0;

    console.log('--- Applying Discovery Changes ---');

    for (const line of lines) {
        if (line.startsWith('## Series:')) {
            const seriesMatch = line.match(/## Series: (.*) \((.*)\)/);
            if (seriesMatch) {
                currentSeries = seriesMatch[1];
                currentLine = seriesMatch[2];
            }
            continue;
        }

        const isAdd = line.startsWith('- [x]');
        const isOwned = line.startsWith('- [o]');
        const isIgnore = line.startsWith('- [r]');
        const isActionable = isAdd || isOwned;

        if (isActionable) {
            // Check for Sync Suggestions format first: "- [o] **Update:** Current (Platform) → **Suggested (Platform)** - ID: igdb-ID"
            const syncMatch = line.match(/- \[o\] \*\*Update:\*\* (.*) → \*\*(.*)\*\* - ID: (.*)/);
            if (syncMatch) {
                const id = syncMatch[3];
                const suggestedRaw = syncMatch[2].match(/(.*) \((.*)\)/) || [null, syncMatch[2], null];
                const newName = suggestedRaw[1].trim();
                const newPlatform = suggestedRaw[2] ? suggestedRaw[2].trim() : null;

                if (id.startsWith('igdb-')) {
                    const localId = id.replace('igdb-', '');
                    // For syncing existing games, we target the ID if we had it, but for now we find by the "Current" string in the report
                    // Actually, let's keep it simple: the sync suggestions in scrape.js have the ID encoded.
                    const existing = db.prepare('SELECT id, title, platform FROM games WHERE title = ?').get(syncMatch[1].split(' (')[0]);
                    if (existing) {
                        if (newPlatform && newPlatform !== existing.platform) {
                            // This is a platform migration
                            renamePlatformGlobal(existing.platform, newPlatform);
                            // After global rename, the existing game's platform is now newPlatform
                        }
                        
                        if (newPlatform) {
                            db.prepare('UPDATE games SET title = ?, platform = ?, owned = 1 WHERE id = ?').run(newName, newPlatform, existing.id);
                        } else {
                            db.prepare('UPDATE games SET title = ?, owned = 1 WHERE id = ?').run(newName, existing.id);
                        }
                        console.log(`  Synced Game: "${existing.title}" -> "${newName}"`);
                        updatedCount++;
                    }
                } else if (id.startsWith('fig-')) {
                    const localId = id.replace('fig-', '');
                    const existing = db.prepare('SELECT id, name FROM figures WHERE id = ?').get(localId);
                    if (existing) {
                        db.prepare('UPDATE figures SET name = ?, owned = 1 WHERE id = ?').run(newName, existing.id);
                        console.log(`  Synced Figure: "${existing.name}" -> "${newName}"`);
                        updatedCount++;
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
