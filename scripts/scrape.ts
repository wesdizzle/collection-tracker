/**
 * GAME COLLECTION RECONCILIATION & DISCOVERY (TS)
 * 
 * This script serves as the primary engine for verifying your local collection 
 * against IGDB and discovering missing items in series you own.
 * It produces a 'discovery_report.md' for manual review.
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import { findGame, getCollectionGames, superNormalize, IGDBGame, NormalizedGame } from './lib/igdb.js';
import { getAmiiboSeries, getSkylandersSeries, getStarlinkSeries, Figure } from './lib/figures.js';

const db = new Database('collection.sqlite');

interface GameRecord {
    id: number;
    title: string;
    platform: string;
    platform_id: number;
    platform_igdb_id: number;
    platform_display_name: string;
    region?: string;
    image_url?: string;
    summary?: string;
    series?: string;
}

interface SyncSuggestion {
    type: 'Game' | 'Figure';
    current: string;
    options: NormalizedGame[];
    localId: number;
}

interface UnmatchedItem {
    item: GameRecord;
    suggestions: NormalizedGame[] | null;
}

interface GameDiscovery {
    series: string;
    games: any[]; // Raw IGDB collection results
}

interface FigureDiscovery {
    series: string;
    items: Figure[];
}

/**
 * UTILITY: normalizeTitle
 * 
 * Standardizes titles for high-fidelity matching across different data sources.
 */
function normalizeTitle(title: string): string {
    if (!title) return '';
    return title.toLowerCase()
        .replace(/[–—]/g, '-')
        .replace(/&/g, 'and')
        .replace(/[^a-z0-9+:\-]/g, '') // Preserve +, :, and -
        .trim();
}

const REGIONAL_OVERRIDES: Record<string, number> = {
    'sonic the hedgehog': 1, // UK for SMS
    'mario kart 8 deluxe + booster course pass': 12, // SEA
    'chrono cross: the radical dreamers edition': 12, // SEA
    'pico park 1 + 2': 5, // JP
    'mother': 5, // JP
    'mother 3': 5, // JP
    'taiko no tatsujin ds': 5 // JP
};

async function runScraper(): Promise<void> {
    console.log('--- Starting Gaggledex Verification Phase ---');
    const unmatchedGames: UnmatchedItem[] = [];
    const syncSuggestions: SyncSuggestion[] = [];
    const gameDiscoveryResults: GameDiscovery[] = [];
    
    // 1. Verify Games (Metadata & Sync checking)
    const existingGames = db.prepare(`
        SELECT g.*, p.igdb_id as platform_igdb_id, p.display_name as platform_display_name
        FROM games g
        LEFT JOIN platforms p ON g.platform = p.display_name
    `).all() as GameRecord[];

    console.log(`Processing ${existingGames.length} collection items...`);

    for (const game of existingGames) {
        if (game.igdb_id) {
            console.log(`Skipping already-verified Game: ${game.title} (${game.platform_display_name || game.platform})`);
            continue;
        }
        
        process.stdout.write(`Verifying: ${game.title} (${game.platform_display_name || game.platform})... `);
        
        // Phase 1: Strict Platform-Locked Match
        const searchTitle = game.title.replace(/\(.*\)/g, '').trim();
        let matches = await findGame(searchTitle, game.platform_igdb_id);
        
        // Check for regional override
        const normTitle = normalizeTitle(game.title);
        const overrideRegion = REGIONAL_OVERRIDES[normTitle];

        if (matches && matches.length > 0) {
            let bestMatch = matches[0];
            
            // If we have an override, we need to re-fetch or filter the release dates
            if (overrideRegion) {
                // In a real scenario, we might want to re-query IGDB for this specific region,
                // but our findGame already fetched release_dates. We just need to prioritize it.
                const regionalDate = (bestMatch as any).release_dates?.find((d: any) => d.region === overrideRegion);
                if (regionalDate) {
                    bestMatch.release_date = new Date(regionalDate.date * 1000).toISOString().split('T')[0];
                    bestMatch.region = overrideRegion.toString();
                }
            }

            const normLocal = normalizeTitle(game.title);
            const normIgdb = normalizeTitle(bestMatch.name);
            
            // Title Match Logic
            if (normLocal === normIgdb) {
                db.prepare(`
                    UPDATE games 
                    SET title = ?, igdb_id = ?, region_chosen = ?, summary = ?, genres = ?, image_url = ?, played = 0, backed_up = 0
                    WHERE id = ?
                `).run(
                    bestMatch.name, 
                    bestMatch.id.replace('igdb-', ''), 
                    bestMatch.region, 
                    bestMatch.summary || null, 
                    (bestMatch as any).genres || null,
                    bestMatch.image_url,
                    game.id
                );
                console.log(`Matched! [ID: ${bestMatch.id}]`);
                continue;
            }

            // If titles don't perfectly match, add to suggestions
            syncSuggestions.push({
                type: 'Game',
                current: `${game.title} (${game.platform_display_name || game.platform})`,
                options: matches.slice(0, 10),
                localId: game.id
            });
            console.log("Ambiguous.");
        } else {
            process.stdout.write(`No platform match. Global search... `);
            // Phase 2: Global Platform Discovery
            const suggestions = await findGame(searchTitle, 0); 
            unmatchedGames.push({ item: game, suggestions });
            console.log(suggestions && suggestions.length > 0 ? "Candidates found." : "No candidates.");
        }
    }

    const ignoredItems = (db.prepare('SELECT id FROM ignored_items').all() as { id: string }[]).map(i => i.id);
    const existingGameNorms = existingGames.map(g => normalizeTitle(g.title));

    // 3. Discovery: Games
    const gameSeriesList = db.prepare('SELECT DISTINCT series FROM games WHERE series IS NOT NULL').all() as { series: string }[];
    for (const { series } of gameSeriesList) {
        console.log(`Discovering Games for Series: ${series}...`);
        const searchResults = await findGame(series.replace(/\(.*\)/g, '').trim(), 0);
        const initialMatch = searchResults && searchResults.length > 0 ? searchResults[0] : null;

        if (initialMatch && initialMatch.id) {
            // Find collection context via original IGDB ID
            const igdbIdNum = Number(initialMatch.id.replace('igdb-', ''));
            const collectionGames = await getCollectionGames(igdbIdNum);
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
    let figureDiscoveryResults: FigureDiscovery[] = [];
    const figureSeriesList = db.prepare('SELECT DISTINCT line FROM figures WHERE line IS NOT NULL').all() as { line: string }[];
    const existingFigureIds = (db.prepare('SELECT id FROM figures').all() as { id: string }[]).map(f => f.id);

    for (const { line: series_name } of figureSeriesList) {
        console.log(`Discovering Figures for series: ${series_name}...`);
        let figures: Figure[] = [];
        if (series_name.toLowerCase().includes('amiibo')) figures = await getAmiiboSeries(series_name);
        else if (series_name.toLowerCase().includes('skylanders')) figures = await getSkylandersSeries(series_name);
        else if (series_name.toLowerCase().includes('starlink')) figures = await getStarlinkSeries(series_name);

        const missing = figures.filter(f => !existingFigureIds.includes(f.id) && !ignoredItems.includes(f.id));
        if (missing.length > 0) figureDiscoveryResults.push({ series: series_name, items: missing });
    }

    generateReport(unmatchedGames, syncSuggestions, gameDiscoveryResults, figureDiscoveryResults);
}

/**
 * UTILITY: generateReport
 * 
 * Writes the discovery_report.md file with all findings for manual verification.
 */
function generateReport(unmatched: UnmatchedItem[], sync: SyncSuggestion[], gameDiscovery: GameDiscovery[], figureDiscovery: FigureDiscovery[]): void {
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
            if (u.suggestions && u.suggestions.length > 0) {
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
