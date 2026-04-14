const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { findGame, getCollectionGames, PLATFORM_MAP, superNormalize } = require('./lib/igdb');
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

            // Check for potential syncs (name or platform differs)
            const normLocal = normalizeTitle(game.title);
            const normIgdb = normalizeTitle(bestMatch.name);
            const superNormLocal = superNormalize(game.title);
            const superNormIgdb = superNormalize(bestMatch.name);
            
            // Platform verification: ID match OR Name match fallback
            const platformIdMatch = bestMatch.platform_ids && bestMatch.platform_ids.includes(game.platform_igdb_id);
            const platformNameMatch = bestMatch.platform && game.platform_display_name && (bestMatch.platform === game.platform_display_name);
            const platformMatches = platformIdMatch || platformNameMatch;

            // Match Scenario A: Titles are identical or super-normalized titles match
            if (platformMatches && (normLocal === normIgdb || superNormLocal === superNormIgdb)) {
                // Automatic title normalization update
                if (game.title !== bestMatch.name) {
                    db.prepare('UPDATE games SET title = ? WHERE id = ?').run(bestMatch.name, game.id);
                    console.log(`  Auto-normalized: ${game.title} -> ${bestMatch.name}`);
                }
                
                db.prepare('UPDATE games SET igdb_id = ?, region = ? WHERE id = ?')
                    .run(bestMatch.id.replace('igdb-', ''), 'NA', game.id);
                console.log(`  Verified & Matched: ${bestMatch.name}`);
                continue;
            } else if (normLocal === normIgdb || superNormLocal === superNormIgdb) {
                console.log(`  Title Match found for "${bestMatch.name}" but platform check failed: IGDB Platform="${bestMatch.platform}" vs Local="${game.platform_display_name}"`);
            }

            // Match Scenario B: Local title is a prefix/subtitle of IGDB title AND only one official match exists
            const isSignificantPrefix = superNormIgdb.startsWith(superNormLocal) && superNormLocal.length > 5;
            const singleOfficialMatch = matches.filter(r => r.platform_ids && r.platform_ids.includes(game.platform_igdb_id)).length === 1;

            if (platformMatches && isSignificantPrefix && singleOfficialMatch) {
                db.prepare('UPDATE games SET title = ?, igdb_id = ?, region = ? WHERE id = ?')
                    .run(bestMatch.name, bestMatch.id.replace('igdb-', ''), 'NA', game.id);
                console.log(`  Auto-matched Subtitle: ${game.title} -> ${bestMatch.name}`);
                continue;
            }

            // If not auto-matched, check for detailed suggestions or imagery updates
            if (bestMatch.name !== game.title || !platformMatches) {
                syncSuggestions.push({
                    type: 'Game',
                    current: `${game.title} (${game.platform_display_name || game.platform})`,
                    options: matches.slice(0, 10),
                    localId: game.id
                });
            }

            // Fallback: update imagery if missing but keep for sync review if ambiguous
            if (!game.image_url || !game.summary) {
                db.prepare('UPDATE games SET image_url = ?, summary = ? WHERE id = ?').run(
                    bestMatch.image_url, 
                    bestMatch.summary || null, 
                    game.id
                );
            }
        } else {
            console.log(`  No exact match found for ${game.title}`);
            const suggestions = await findGame(searchTitle, null);
            unmatchedGames.push({ item: game, suggestions });
        }
    }

    // ... (rest of discovery logic - unchanged but ensure existingGames/ignoredItems are valid)
    const ignoredItems = db.prepare('SELECT id FROM ignored_items').all().map(i => i.id);
    const existingGameNorms = existingGames.map(g => normalizeTitle(g.title));

    // 3. Discovery: Games
    const gameSeriesList = db.prepare('SELECT DISTINCT series FROM games WHERE series IS NOT NULL').all();
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
                gameDiscoveryResults.push({ series, games: missing });
            }
        }
    }

    // 4. Discovery: Figures
    let figureDiscoveryResults = [];
    const figureSeriesList = db.prepare('SELECT DISTINCT line FROM figures WHERE line IS NOT NULL').all();
    const existingFigureIds = db.prepare('SELECT id FROM figures').all().map(f => f.id);

    for (const { line: series_name } of figureSeriesList) {
        console.log(`Discovering Figures for series: ${series_name}...`);
        let figures = [];
        if (series_name.toLowerCase().includes('amiibo')) figures = await getAmiiboSeries(series_name);
        else if (series_name.toLowerCase().includes('skylanders')) figures = await getSkylandersSeries(series_name);
        else if (series_name.toLowerCase().includes('starlink')) figures = await getStarlinkSeries(series_name);

        const missing = figures.filter(f => !existingFigureIds.includes(f.id) && !ignoredItems.includes(f.id));
        if (missing.length > 0) figureDiscoveryResults.push({ series: series_name, items: missing });
    }

    generateReport(unmatchedGames, syncSuggestions, gameDiscoveryResults, figureDiscoveryResults);
}

function generateReport(unmatched, sync, gameDiscovery, figureDiscovery) {
    let report = '# Discovery Report\n\nThis report lists findings from the collection discovery pipeline.\n\n';
    report += '### Instructions:\n';
    report += '- Mark with **`[x]`** to add the item as **Wanted**.\n';
    report += '- Mark with **`[o]`** to **Sync/Update** an existing item.\n';
    report += '- Mark with **`[r]`** to **Reject** the item.\n\n';

    if (sync.length > 0) {
        report += '## Action Required: Sync Suggestions\n';
        for (const s of sync) {
            report += `### ${s.current}\n`;
            s.options.forEach(opt => {
                report += `- [ ] **Update to:** ${opt.name} (${opt.platform}) - ID: ${opt.id}\n`;
                if (opt.image_url) report += `  - ![cover](${opt.image_url})\n`;
                if (opt.summary) {
                    const shortSummary = opt.summary.length > 200 ? opt.summary.substring(0, 200) + '...' : opt.summary;
                    report += `  - *${shortSummary.replace(/\n/g, ' ')}*\n`;
                }
            });
            report += '\n';
        }
    }

    if (unmatched.length > 0) {
        report += '## Action Required: Unmatched Items\n';
        for (const u of unmatched) {
            report += `### ${u.item.title} (${u.item.platform_display_name || u.item.platform})\n`;
            if (u.suggestions.length > 0) {
                u.suggestions.slice(0, 10).forEach(s => {
                    report += `- [ ] **Link to:** ${s.name} (${s.platform}) - ID: ${s.id}\n`;
                    if (s.image_url) report += `  - ![cover](${s.image_url})\n`;
                    if (s.summary) {
                        const shortSummary = s.summary.length > 200 ? s.summary.substring(0, 200) + '...' : s.summary;
                        report += `  - *${shortSummary.replace(/\n/g, ' ')}*\n`;
                    }
                });
            } else {
                report += '- No suggestions found.\n';
            }
            report += '\n';
        }
    }

    if (gameDiscovery.length > 0) {
        report += '## Discovery: New Games\n';
        for (const d of gameDiscovery) {
            report += `### Series: ${d.series}\n`;
            d.games.forEach(g => {
                report += `- [ ] ${g.name} (${g.platform}) - ID: igdb-${g.id}\n`;
            });
            report += '\n';
        }
    }

    if (figureDiscovery.length > 0) {
        report += '## Discovery: New Figures\n';
        for (const d of figureDiscovery) {
            report += `### Line: ${d.series}\n`;
            d.items.forEach(i => {
                report += `- [ ] ${i.name} (${i.line}) - ID: ${i.id}\n`;
            });
            report += '\n';
        }
    }

    fs.writeFileSync('discovery_report.md', report);
    console.log('Report generated: discovery_report.md');
}

runScraper().catch(console.error);
