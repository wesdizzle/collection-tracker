const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { findGame, getCollectionGames, PLATFORM_MAP } = require('./lib/igdb');
const { getAmiiboSeries, getSkylandersSeries, getStarlinkSeries } = require('./lib/figures');

const db = new Database('collection.sqlite');

function normalizeTitle(title) {
    if (!title) return '';
    return title.toLowerCase()
        .replace(/[–—]/g, '-') // Replace special hyphens
        .replace(/[\(\)\-:]/g, ' ') // Replace parentheses, hyphens, and colons with spaces
        .replace(/[^a-z0-9]/g, '')  // Remove non-alphanumeric (including spaces)
        .trim();
}

async function runScraper() {
    console.log('--- Starting Verification Phase ---');
    let unmatchedGames = [];
    let syncSuggestions = [];
    let gameDiscoveryResults = [];
    
    // 1. Verify Games (Metadata & Sync checking)
    const existingGames = db.prepare(`
        SELECT g.*, p.igdb_id as platform_igdb_id, p.display_name as platform_display_name
        FROM games g
        LEFT JOIN platforms p ON g.platform_id = p.id
    `).all();

    for (const game of existingGames) {
        // Skip if already has region metadata (implies already verified in this session)
        if (game.region) continue;

        console.log(`Verifying Game: ${game.title} (${game.platform_display_name || game.platform})...`);
        const searchTitle = game.title.replace(/\(.*\)/g, '').replace(/[:]/g, '').trim();
        const matches = await findGame(searchTitle, game.platform_igdb_id);
        
        if (matches && matches.length > 0) {
            const bestMatch = matches[0];
            const igdbName = bestMatch.name;
            const igdbPlatform = bestMatch.platform;

            // Check for potential syncs (name or platform differs)
            const normLocal = normalizeTitle(game.title);
            const normIgdb = normalizeTitle(bestMatch.name);
            
            // Platform match is verified if the local platform IGDB ID is in the IGDB result's platform list
            const platformMatches = !game.platform_igdb_id || (bestMatch.platform_ids && bestMatch.platform_ids.includes(game.platform_igdb_id));

            if (normLocal === normIgdb && platformMatches) {
                // Automatic title normalization update
                if (game.title !== bestMatch.name) {
                    db.prepare('UPDATE games SET title = ? WHERE id = ?').run(bestMatch.name, game.id);
                    console.log(`  Auto-normalized: ${game.title} -> ${bestMatch.name}`);
                }
            } else if (bestMatch.name !== game.title || !platformMatches) {
                // Significant difference or ambiguous platform, add to suggestions
                syncSuggestions.push({
                    type: 'Game',
                    current: `${game.title} (${game.platform_display_name || game.platform})`,
                    options: matches.slice(0, 3),
                    localId: game.id
                });
            }

            // Silently update imagery/summary/region if missing
            if (!game.image_url || !game.summary || !game.region) {
                db.prepare('UPDATE games SET image_url = ?, summary = ?, region = ?, igdb_id = ? WHERE id = ?').run(
                    bestMatch.image_url, 
                    bestMatch.summary || null, 
                    game.region || bestMatch.region,
                    bestMatch.id.replace('igdb-', ''),
                    game.id
                );
            }
        } else {
            console.log(`  No exact match found for ${game.title}`);
            // Try broad search for unmatched section
            const suggestions = await findGame(searchTitle, null);
            unmatchedGames.push({ item: game, suggestions });
        }
    }

    let newItemsCount = 0;


    // 3. Discovery: Games
    const gameSeriesList = db.prepare('SELECT DISTINCT series FROM games WHERE series IS NOT NULL').all();
    const ignoredItems = db.prepare('SELECT id FROM ignored_items').all().map(i => i.id);
    const existingGameNorms = existingGames.map(g => normalizeTitle(g.title));

    for (const { series } of gameSeriesList) {
        console.log(`Discovering Games for Series: ${series}...`);
        const searchResults = await findGame(series.replace(/\(.*\)/g, '').trim(), '');
        const initialMatch = searchResults && searchResults.length > 0 ? searchResults[0] : null;

        if (initialMatch && initialMatch.collection) {
            const collectionGames = await getCollectionGames(initialMatch.collection);
            const missing = [];
            for (const igdbGame of collectionGames) {
                const igdbId = `igdb-${igdbGame.id}`;
                if (ignoredItems.includes(igdbId)) continue;

                const normalizedIgdb = normalizeTitle(igdbGame.name);
                if (existingGameNorms.includes(normalizedIgdb)) continue;

                missing.push(igdbGame);
            }
            if (missing.length > 0) {
                gameDiscoveryResults.push({
                    seriesName: series,
                    items: missing
                });
                newItemsCount += missing.length;
            }
        }
    }

    // 4. Discovery: Figures
    const figureSeries = db.prepare("SELECT * FROM figure_series").all();
    const existingFigures = db.prepare('SELECT * FROM figures').all();

    for (const series of figureSeries) {
        console.log(`Discovering Figures for ${series.line}: ${series.name}...`);
        
        let allItems = [];
        if (series.line.toLowerCase() === 'amiibo') {
            allItems = await getAmiiboSeries(series.name);
        } else if (series.line.toLowerCase() === 'skylanders') {
            allItems = await getSkylandersSeries(series.name);
        } else if (series.line.toLowerCase() === 'starlink') {
            allItems = await getStarlinkSeries(series.name);
        }

        const missingFiguresInSeries = [];
        for (const item of allItems) {
            const figId = `fig-${item.id}`;
            if (ignoredItems.includes(figId)) continue;

            const normItem = normalizeTitle(item.name);
            const localMatch = existingFigures.find(f => normalizeTitle(f.name) === normItem && f.series_id === series.id);
            
            if (localMatch) {
                const normLocal = normalizeTitle(localMatch.name);
                const normFig = normalizeTitle(item.name);
                if (normLocal === normFig) {
                    if (localMatch.name !== item.name) {
                        db.prepare('UPDATE figures SET name = ? WHERE id = ?').run(item.name, localMatch.id);
                        console.log(`  Auto-normalized figure: ${localMatch.name} -> ${item.name}`);
                    }
                } else if (localMatch.name !== item.name) {
                    syncSuggestions.push({
                        type: 'Figure',
                        current: localMatch.name,
                        suggested: item.name,
                        id: `fig-${item.id}`,
                        localId: localMatch.id
                    });
                }
                continue;
            }
            missingFiguresInSeries.push(item);
        }

        if (missingFiguresInSeries.length > 0) {
            gameDiscoveryResults.push({
                seriesName: series.name,
                line: series.line,
                items: missingFiguresInSeries
            });
            newItemsCount += missingFiguresInSeries.length;
        }
    }

    // 5. Generate Report
    let discoveryReport = '# Discovery Report\n\nThis report lists findings from the collection discovery pipeline.\n\n';
    discoveryReport += '### Instructions:\n';
    reportInstructions(discoveryReport); // Abstracted or just keep writing

    function reportInstructions(rep) {
        // I'll just keep it inline for simplicity in replace_file_content
    }

    discoveryReport += '### Instructions:\n';
    discoveryReport += '- Mark with **`[x]`** to add the item as **Wanted**.\n';
    discoveryReport += '- Mark with **`[o]`** to **Sync/Update** an existing item (updates name/platform/metadata/IDs).\n';
    discoveryReport += '- Mark with **`[r]`** to **Reject** the item (permanent ignore).\n';
    discoveryReport += '- Leave as **`[ ]`** to skip for now.\n\n';

    if (syncSuggestions.length > 0) {
        discoveryReport += '## Action Required: Sync Suggestions\n';
        discoveryReport += 'Found different names or multiple official matches for items in your collection.\n\n';
        
        syncSuggestions.forEach(s => {
            discoveryReport += `### ${s.current}\n`;
            if (s.options) {
                s.options.forEach(opt => {
                    discoveryReport += `- [ ] **Update to:** ${opt.name} (${opt.platform}) - ID: ${opt.id}\n`;
                });
            } else {
                discoveryReport += `- [ ] **Update to:** ${s.suggested} - ID: ${s.id}\n`;
            }
            discoveryReport += '\n';
        });
    }

    // Re-render Game Discovery
    gameDiscoveryResults.forEach(res => {
        if (res.line) {
             discoveryReport += `## Series: ${res.seriesName} (Figures)\n`;
             res.items.forEach(m => {
                 discoveryReport += `- [ ] **${m.name}** (${res.line} ${m.type}) - ID: ${m.id}\n`;
             });
        } else {
            discoveryReport += `## Series: ${res.seriesName} (Games)\n`;
            res.items.forEach(m => {
                discoveryReport += `- [ ] **${m.name}** (${m.platform || 'Multiple Platforms'}) - ID: ${m.id}\n`;
            });
        }
        discoveryReport += '\n';
    });

    if (unmatchedGames.length > 0) {
        discoveryReport += `---\n\n## Unmatched Games\nThe following games failed to find an exact match on IGDB. You may need to manually verify their names.\n\n`;
        unmatchedGames.forEach(u => {
            discoveryReport += `### ${u.item.title} (${u.item.platform_display_name || u.item.platform})\n`;
            if (u.suggestions && u.suggestions.length > 0) {
                u.suggestions.slice(0, 3).forEach(s => {
                    discoveryReport += `- [ ] **Suggestion:** ${s.name} (${s.platform}) - ID: ${s.id}\n`;
                });
            }
            discoveryReport += '\n';
        });
    }

    fs.writeFileSync('discovery_report.md', discoveryReport);
    console.log(`\nDiscovery Complete! ${newItemsCount} new items found. Sync items identified. Review discovery_report.md.`);
}

runScraper().catch(console.error);
