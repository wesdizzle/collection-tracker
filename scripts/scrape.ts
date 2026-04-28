/**
 * GAME COLLECTION RECONCILIATION & DISCOVERY ENGINE
 * 
 * This script is the backbone of the collection's metadata integrity. It performs 
 * a multi-tier search to reconcile local entries with IGDB and web sources.
 * 
 * ARCHITECTURAL DESIGN:
 * 1. **Multi-Tier Search Strategy**:
 *    - **Phase 1: Platform-Locked IGDB Search**: Attempts to find an exact match 
 *      on the specific platform. High-confidence (100%) matches are auto-applied.
 *    - **Phase 2: Global IGDB Search**: If Phase 1 fails, searches across all 
 *      platforms. Useful for identifying items accidentally logged on the wrong platform.
 *    - **Phase 3: Web Scraping Fallback**: If IGDB is missing data (common for 
 *      niche or regional variants), it falls back to PriceCharting and PS Store.
 * 2. **Discovery Mechanism**:
 *    - When run with `--discovery`, it analyzes the series/franchises owned by 
 *      the user and identifies missing canonical entries to populate the 'Wanted' list.
 * 3. **Programmatic Reconciliation**:
 *    - Items with ambiguous matches (confidence < 100) are offloaded to a 
 *      `discovery_report.md` which serves as the data source for the 
 *      Discovery page in the local development UI.
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import { findGame, getGameById, NormalizedGame, IGDBGame, calculateConfidence } from './lib/igdb.js';
import { scrapePriceCharting, scrapePlayStationStore } from './lib/web_scraper.js';
import { getAmiiboSeries, Toy } from './lib/toys.js';
import { recomputeCanonicalSeries } from './compute_canonical_series.js';
import axios from 'axios';

const db = new Database('collection.sqlite');

interface GameRecord {
    id: string;
    stable_id: string;
    title: string;
    platform: string;
    platform_id: number;
    platform_igdb_id: number;
    platform_display_name: string;
    region?: string;
    image_url?: string;
    summary?: string;
    series?: string;
    igdb_id?: string;
    pricecharting_url?: string;
    genres?: string;
    collections?: string;
    franchises?: string;
    release_date?: string;
}

interface ToySuggestion {
    id: string;
    name: string;
    platform: string;
    image_url: string | null;
    summary: string;
    category: string;
}

interface SyncSuggestion {
    type: 'Game' | 'Toy';
    current: string;
    options: (NormalizedGame | ToySuggestion)[];
    localId: number | string;
}

interface UnmatchedItem {
    item: GameRecord;
    suggestions: NormalizedGame[] | null;
}

interface GameDiscovery {
    series: string;
    games: IGDBGame[];
}

interface ToyDiscovery {
    series: string;
    items: Toy[];
}

interface UpdateChange {
    id: string | number;
    title: string;
    field: string;
    oldValue: string | null;
    newValue: string | null;
}

const slugify = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');



/**
 * UTILITY: superNormalize
 * 
 * Aggressively standardizes strings for cross-source matching by removing 
 * all non-alphanumeric characters.
 */
function superNormalize(s: string): string {
    return s.toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, '');
}


async function runScraper(): Promise<void> {
    const args = process.argv.slice(2);
    const runDiscovery = args.includes('--discovery');
    const runRefresh = args.includes('--refresh');
    const runRecomputeSeries = args.includes('--recompute-series');

    console.log('--- Starting Gagglog Reconciliation Phase ---');
    const unmatchedGames: UnmatchedItem[] = [];
    const syncSuggestions: SyncSuggestion[] = [];
    const updateChanges: UpdateChange[] = [];
    let autoMatchedCount = 0;
    const gameDiscoveryResults: GameDiscovery[] = [];

    // 1. Verify Games (Metadata & Sync checking)
    const existingGames = db.prepare(`
        SELECT g.*, p.igdb_id as platform_igdb_id, p.display_name as platform_display_name
        FROM games g
        LEFT JOIN platforms p ON g.platform_id = p.id
    `).all() as GameRecord[];

    console.log(`Processing ${existingGames.length} collection items...`);

    for (const game of existingGames) {
        if (game.igdb_id || game.pricecharting_url) {
            if (runRefresh && game.igdb_id) {
                process.stdout.write(`Refreshing Game: ${game.title} (${game.platform_display_name})... `);
                const fresh = await getGameById(Number(game.igdb_id), game.platform_igdb_id);
                if (fresh) {
                    const checkField = (field: string, oldVal: string | number | null | undefined, newVal: string | number | null | undefined) => {
                        if (newVal !== undefined && newVal !== oldVal) {
                            return true;
                        }
                        return false;
                    };

                    checkField('summary', game.summary, fresh.summary);
                    checkField('image_url', game.image_url, fresh.image_url);
                    checkField('genres', game.genres, fresh.genres);
                    checkField('collections', game.collections, fresh.collections);
                    checkField('franchises', game.franchises, fresh.franchises);
                    checkField('release_date', game.release_date, fresh.release_date);

                    // Canonical Slug Check
                    let canonicalId = `${slugify(fresh.name)}-${slugify(game.platform_display_name || game.platform)}`;
                    
                    // Avoid collisions with other games
                    const collision = db.prepare('SELECT stable_id FROM games WHERE id = ? AND stable_id != ?').get(canonicalId, game.stable_id);
                    if (collision) {
                        canonicalId += `-${game.id.split('-').pop()}`; // Fallback to current suffix if possible
                    }
                    

                        const finalId = canonicalId;
                        const finalSummary = fresh.summary || game.summary;
                        const finalImageUrl = fresh.image_url || game.image_url;
                        const finalGenres = fresh.genres || game.genres;
                        const finalCollections = fresh.collections || game.collections;
                        const finalFranchises = fresh.franchises || game.franchises;
                        const finalReleaseDate = fresh.release_date || game.release_date;
 
                    const hasActualChanges = finalId !== game.id || 
                                             (fresh.summary !== undefined && fresh.summary !== null && fresh.summary !== game.summary) ||
                                             (fresh.image_url !== undefined && fresh.image_url !== null && fresh.image_url !== game.image_url) ||
                                             (fresh.genres !== undefined && fresh.genres !== null && fresh.genres !== game.genres) ||
                                             (fresh.collections !== undefined && fresh.collections !== null && fresh.collections !== game.collections) ||
                                             (fresh.franchises !== undefined && fresh.franchises !== null && fresh.franchises !== game.franchises) ||
                                             (fresh.release_date !== undefined && fresh.release_date !== null && fresh.release_date !== game.release_date);

                    if (hasActualChanges) {
                        db.prepare(`
                            UPDATE games 
                            SET id = ?, summary = ?, image_url = ?, genres = ?, collections = ?, franchises = ?, release_date = ?
                            WHERE stable_id = ?
                        `).run(finalId, finalSummary, finalImageUrl, finalGenres, finalCollections, finalFranchises, finalReleaseDate, game.stable_id);
                        
                        // Only log changes that actually resulted in a different value in the DB
                        const actualChanges: UpdateChange[] = [];
                        if (finalId !== game.id) actualChanges.push({ id: game.id, title: game.title, field: 'id', oldValue: game.id, newValue: finalId });
                        if (finalSummary !== game.summary && fresh.summary) actualChanges.push({ id: game.id, title: game.title, field: 'summary', oldValue: String(game.summary), newValue: String(finalSummary) });
                        if (finalImageUrl !== game.image_url && fresh.image_url) actualChanges.push({ id: game.id, title: game.title, field: 'image_url', oldValue: String(game.image_url), newValue: String(finalImageUrl) });
                        if (finalGenres !== game.genres && fresh.genres) actualChanges.push({ id: game.id, title: game.title, field: 'genres', oldValue: String(game.genres), newValue: String(finalGenres) });
                        if (finalCollections !== game.collections && fresh.collections) actualChanges.push({ id: game.id, title: game.title, field: 'collections', oldValue: String(game.collections), newValue: String(finalCollections) });
                        if (finalFranchises !== game.franchises && fresh.franchises) actualChanges.push({ id: game.id, title: game.title, field: 'franchises', oldValue: String(game.franchises), newValue: String(finalFranchises) });
                        if (finalReleaseDate !== game.release_date && fresh.release_date) actualChanges.push({ id: game.id, title: game.title, field: 'release_date', oldValue: String(game.release_date), newValue: String(finalReleaseDate) });
                        
                        if (actualChanges.length > 0) {
                            updateChanges.push(...actualChanges);
                            appendUpdateReport(actualChanges);
                        }
                        console.log('Updated.');
                    } else {
                        console.log('No changes.');
                    }
                } else {
                    console.log('API Error.');
                }
            } else {
                console.log(`Skipping already-verified Game: ${game.title} (${game.platform_display_name})`);
            }
            continue;
        }

        process.stdout.write(`Verifying: ${game.title} (${game.platform_display_name})... `);

        // Phase 1: Strict Platform-Locked Match
        const searchTitle = game.title.replace(/\(.*\)/g, '').trim();
        const matches = await findGame(searchTitle, game.platform_igdb_id);

        if (matches && matches.length > 0) {
            const bestMatch = matches[0];

            // In a real scenario, we might want to re-query IGDB for this specific region,
            // but our findGame already fetched release_dates. We just need to prioritize it.
            // NOTE: We'd need to cast to any here because release_dates is not in NormalizedGame, 
            // but for now we'll just rely on the default logic or fix findGame to pass it through.
            // For this script, we'll bypass regionalDate logic for now to stay type-safe.
            // For this script, we'll bypass regionalDate logic for now to stay type-safe.

            const confidence = calculateConfidence(game.title, bestMatch.name, bestMatch.category);

            // Title Match Logic - Auto-update if high confidence (100)
            if (confidence === 100) {
                db.prepare(`
                    UPDATE games 
                    SET title = ?, igdb_id = ?, region = ?, summary = ?, genres = ?, image_url = ?, played = 0, backed_up = 0, collections = ?, franchises = ?
                    WHERE id = ?
                `).run(
                    bestMatch.name,
                    bestMatch.id.replace('igdb-', ''),
                    bestMatch.region,
                    bestMatch.summary || null,
                    bestMatch.genres || null,
                    bestMatch.image_url,
                    bestMatch.collections,
                    bestMatch.franchises,
                    game.id
                );
                console.log(`  Auto-matched and updated! [ID: ${bestMatch.id}]`);
                autoMatchedCount++;
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
            const globalMatches = await findGame(searchTitle, 0);
            
            if (globalMatches && globalMatches.length > 0) {
                const bestGlobal = globalMatches[0];
                const globalConfidence = calculateConfidence(game.title, bestGlobal.name, bestGlobal.category);
                
                // If we found a high-confidence match on a DIFFERENT platform, add to syncSuggestions
                // This allows the user to "Update to" this better match (and change platform)
                if (globalConfidence >= 90) {
                    syncSuggestions.push({
                        type: 'Game',
                        current: `${game.title} (${game.platform_display_name || game.platform})`,
                        options: globalMatches.slice(0, 10),
                        localId: game.id
                    });
                    console.log(`Potential cross-platform match found [ID: ${bestGlobal.id}]`);
                } else {
                    unmatchedGames.push({ item: game, suggestions: globalMatches });
                    console.log("Candidates found.");
                }

                // If IGDB confidence is low, try web validation as a better alternative
                if (globalConfidence < 90) {
                    const success = await performWebValidation(searchTitle, game);
                    if (success) {
                        autoMatchedCount++;
                        continue;
                    }
                }
            } else {
                // Phase 3: Web Validation Fallback
                const success = await performWebValidation(searchTitle, game);
                if (success) {
                    autoMatchedCount++;
                    continue;
                }

                unmatchedGames.push({ item: game, suggestions: null });
                console.log("No candidates.");
            }
        }
    }

    // 2. Verify Toys
    const existingToys = db.prepare('SELECT * FROM toys').all() as Toy[];
    console.log(`Processing ${existingToys.length} toys...`);

    // Fetch all Amiibos once for efficient matching and discovery
    let allApiAmiibo: Toy[] = [];
    if (runDiscovery || existingToys.some(f => f.line.toLowerCase() === 'amiibo' && !f.verified)) {
        console.log('Fetching master Amiibo list...');
        allApiAmiibo = await getAmiiboSeries();
    }


    for (const toy of existingToys) {
        // Handle Refresh
        if (runRefresh && toy.amiibo_id && toy.verified) {
            process.stdout.write(`Refreshing Toy: ${toy.name}... `);
            try {
                const response = await axios.get(`https://amiiboapi.org/api/amiibo/?id=${toy.amiibo_id}`);
                const a = response.data.amiibo;
                if (a) {
                    const effectiveSeries = a.amiiboSeries === 'Others' ? a.gameSeries : a.amiiboSeries;
                    const releaseDate = a.release?.na || a.release?.jp || a.release?.eu || a.release?.au || null;
                    const region = a.release?.na ? 'NA' : (a.release?.jp ? 'JP' : (a.release?.eu ? 'EU' : 'AU'));
 
                    const checkField = (field: string, oldVal: string | number | null | undefined, newVal: string | number | null | undefined) => {
                        if (newVal !== undefined && newVal !== oldVal) {
                            return true;
                        }
                        return false;
                    };
 
                    checkField('image_url', toy.image_url, a.image);
                    checkField('series', toy.series, effectiveSeries);
                    checkField('type', toy.type, a.type);
                    checkField('release_date', toy.release_date, releaseDate);
                    checkField('region', toy.region, region);

                    // Canonical Slug Check
                    let canonicalId = `${slugify(a.name)}-amiibo-${slugify(effectiveSeries)}`;
                    
                    // Collision check for toys
                    const collision = db.prepare('SELECT stable_id FROM toys WHERE id = ? AND stable_id != ?').get(canonicalId, toy.stable_id);
                    if (collision) {
                        canonicalId += `-${toy.amiibo_id?.substring(0, 8) || toy.id.split('-').pop()}`;
                    }

                    const finalId = canonicalId;
                    const finalImageUrl = a.image || toy.image_url;
                    const finalSeries = effectiveSeries || toy.series;
                    const finalType = a.type || toy.type;
                    const finalReleaseDate = releaseDate || toy.release_date;
                    const finalRegion = region || toy.region;
                    const finalMetadata = JSON.stringify(a);

                    const hasActualChanges = finalId !== toy.id ||
                                             (a.image !== undefined && a.image !== null && a.image !== toy.image_url) ||
                                             (effectiveSeries !== undefined && effectiveSeries !== null && effectiveSeries !== toy.series) ||
                                             (a.type !== undefined && a.type !== null && a.type !== toy.type) ||
                                             (releaseDate !== undefined && releaseDate !== null && releaseDate !== toy.release_date) ||
                                             (region !== undefined && region !== null && region !== toy.region);

                    if (hasActualChanges) {
                        db.prepare(`
                            UPDATE toys 
                            SET id = ?, image_url = ?, series = ?, type = ?, release_date = ?, region = ?, metadata_json = ?
                            WHERE stable_id = ?
                        `).run(finalId, finalImageUrl, finalSeries, finalType, finalReleaseDate, finalRegion, finalMetadata, toy.stable_id);
                        
                        const localChanges: UpdateChange[] = [];
                        if (finalId !== toy.id) localChanges.push({ id: toy.id, title: toy.name, field: 'id', oldValue: toy.id, newValue: finalId });
                        if (finalImageUrl !== toy.image_url && a.image) localChanges.push({ id: toy.id, title: toy.name, field: 'image_url', oldValue: String(toy.image_url), newValue: String(finalImageUrl) });
                        if (finalSeries !== toy.series && effectiveSeries) localChanges.push({ id: toy.id, title: toy.name, field: 'series', oldValue: String(toy.series), newValue: String(finalSeries) });
                        if (finalType !== toy.type && a.type) localChanges.push({ id: toy.id, title: toy.name, field: 'type', oldValue: String(toy.type), newValue: String(finalType) });
                        if (finalReleaseDate !== toy.release_date && releaseDate) localChanges.push({ id: toy.id, title: toy.name, field: 'release_date', oldValue: String(toy.release_date), newValue: String(finalReleaseDate) });
                        if (finalRegion !== toy.region && region) localChanges.push({ id: toy.id, title: toy.name, field: 'region', oldValue: String(toy.region), newValue: String(finalRegion) });

                        if (localChanges.length > 0) {
                            updateChanges.push(...localChanges);
                            appendUpdateReport(localChanges);
                        }
                        console.log('Updated.');
                    } else {
                        console.log('No changes.');
                    }
                }
            } catch {
                console.log('API Error.');
            }
            continue;
        }

        // Skip if already linked or verified
        if (toy.verified || toy.amiibo_id) continue;

        // Strictly focus on Amiibo sync suggestions as requested
        if (toy.line.toLowerCase() !== 'amiibo') continue;

        process.stdout.write(`Verifying Toy: ${toy.name}... `);
        
        // Find broad candidates for manual matching
        const normName = superNormalize(toy.name);
        const matches = allApiAmiibo.filter(a => {
            if (a.type === 'Card') return false; // Explicitly exclude cards as requested
            const aNorm = superNormalize(a.name);
            return aNorm.includes(normName) || normName.includes(aNorm);
        });
        
        if (matches.length > 0) {
            // Sort by better match (exact normalized match first)
            const sortedMatches = matches.sort((a, b) => {
                const aExact = superNormalize(a.name) === normName;
                const bExact = superNormalize(b.name) === normName;
                if (aExact && !bExact) return -1;
                if (!aExact && bExact) return 1;
                return 0;
            });

            syncSuggestions.push({
                type: 'Toy',
                current: `${toy.name} (amiibo) | Line: ${toy.line} | Series: ${toy.series}`,
                options: sortedMatches.slice(0, 15).map(m => {
                    // Replicating toy_discovery.ts naming: name (effectiveSeries)
                    return {
                        id: `amiibo-${m.id}`,
                        name: `${m.name} (${m.series_name})`,
                        platform: 'amiibo',
                        image_url: m.image_url,
                        summary: `Amiibo Series: ${m.series_name}`,
                        category: m.type
                    };
                }),
                localId: toy.id as unknown as number
            });
            console.log(`${matches.length} candidates found.`);
        } else {
            console.log("No candidates.");
        }
    }


    // const ignoredItems = (db.prepare('SELECT id FROM ignored_items').all() as { id: string }[]).map(i => i.id);
    const toyDiscoveryResults: ToyDiscovery[] = [];

    // 3. Discovery Phase: Series-based
    if (runDiscovery) {
        /* Temporarily disabled until PriceCharting physical verification is implemented
        // Discovery: Games
        const gameSeriesList = db.prepare('SELECT DISTINCT series FROM games WHERE series IS NOT NULL').all() as { series: string }[];
        for (const { series } of gameSeriesList) {
            console.log(`Discovering Games for Series: ${series}...`);
            const searchResults = await findGame(series.replace(/\(.*\)/g, '').trim(), 0) || [];
            const initialMatch = searchResults.length > 0 ? searchResults[0] : null;

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
        */


        // 4. Discovery: amiibo
        if (runDiscovery) {
            console.log('Starting full amiibo discovery pass...');
            const discovered = await discoverAllAmiibo(existingToys);
            if (discovered.length > 0) {
                toyDiscoveryResults.push({ series: 'amiibo (Auto-Added)', items: discovered });
            }
        }
        }


    console.log('\n--- Scrape Summary ---');
    console.log(`Manual Entries Processed: ${unmatchedGames.length + syncSuggestions.length + autoMatchedCount}`);
    console.log(`  - Auto-matched: ${autoMatchedCount}`);
    console.log(`  - Remaining in Report: ${unmatchedGames.length + syncSuggestions.length}`);
    if (runRefresh) {
        console.log(`  - Refreshed Items: ${updateChanges.length} changes detected`);
        console.log('Report generated: update_report.md');
    }
    if (runDiscovery) {
        console.log(`Discovery Results: ${gameDiscoveryResults.length} game series, ${toyDiscoveryResults.length} toy series`);
    } else {
        console.log('Discovery phase skipped. Use --discovery to find missing items in your series.');
    }

    generateReport(unmatchedGames, syncSuggestions, gameDiscoveryResults, toyDiscoveryResults);

    // 4. Final Phase: Series Recomputation
    if (runRefresh || runRecomputeSeries) {
        console.log('\n--- Starting Series Recomputation Phase ---');
        await recomputeCanonicalSeries();
    }
}

/**
 * UTILITY: discoverAllAmiibo
 */
async function discoverAllAmiibo(existingToys: Toy[]): Promise<Toy[]> {
    console.log('Fetching master amiibo list...');
    const allAmiibo = await getAmiiboSeries();
    const existingAmiiboIds = new Set(existingToys.filter(t => t.line === 'amiibo').map(t => t.amiibo_id));
    const added: Toy[] = [];

    const insertStmt = db.prepare(`
        INSERT INTO toys (id, name, line, series, type, image_url, amiibo_id, owned, verified, metadata_json, series_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertSeriesStmt = db.prepare('INSERT OR IGNORE INTO toy_series (id, line, name) VALUES (?, ?, ?)');

    const usedSlugs = new Set((db.prepare('SELECT id FROM toys').all() as { id: string }[]).map(t => t.id));

    for (const a of allAmiibo) {
        if (existingAmiiboIds.has(a.id)) continue;

        // a.id is head+tail from getAmiiboSeries
        let canonicalId = `${slugify(a.name)}-amiibo-${slugify(a.series_name)}`;
        if (usedSlugs.has(canonicalId)) {
            canonicalId += `-${a.id.substring(0, 8)}`;
        }
        
        usedSlugs.add(canonicalId);

        const seriesId = `amiibo-${slugify(a.series_name)}`;
        insertSeriesStmt.run(seriesId, 'amiibo', a.series_name);

        insertStmt.run(
            canonicalId,
            a.name,
            'amiibo',
            a.series_name,
            a.type,
            a.image_url,
            a.id,
            0, // Wanted
            1, // Verified
            null, // We could store more if needed, but getAmiiboSeries only returns subset
            seriesId
        );
        added.push(a);
    }
    console.log(`Added ${added.length} missing amiibo as Wanted.`);
    return added;
}

/**
 * UTILITY: appendUpdateReport
 */
function appendUpdateReport(changes: UpdateChange[]): void {
    if (changes.length === 0) return;
    
    const reportPath = 'update_report.md';
    if (!fs.existsSync(reportPath)) {
        fs.writeFileSync(reportPath, '# Update Report\n\nThis report lists metadata updates performed during the refresh pass.\n\n');
    }

    const item = `${changes[0].title} (${changes[0].id})`;
    let entry = `### ${item}\n`;
    changes.forEach(c => {
        entry += `- **${c.field}**: \`${c.oldValue}\` -> \`${c.newValue}\`\n`;
    });
    entry += '\n';

    fs.appendFileSync(reportPath, entry);
}

/**
 * UTILITY: generateReport
 * 
 * Writes the discovery_report.md file with all findings for manual verification.
 */
function generateReport(unmatched: UnmatchedItem[], sync: SyncSuggestion[], gameDiscovery: GameDiscovery[], toyDiscovery: ToyDiscovery[]): void {
    let report = '# Discovery Report\n\nThis report lists findings from the collection discovery pipeline.\n\n';


    if (sync.length > 0) {
        const gameSync = sync.filter(s => s.type === 'Game');
        const toySync = sync.filter(s => s.type === 'Toy');

        if (gameSync.length > 0) {
            report += '## Action Required: Sync Suggestions (Games)\n';
            for (const s of gameSync) {
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

        if (toySync.length > 0) {
            report += '## Toy Discovery (Amiibo)\n';
            for (const s of toySync) {
                report += `### ${s.current}\n`;
                s.options.forEach(opt => {
                    report += `- [ ] **Link to:** ${opt.name} (amiibo) - ID: ${opt.id}\n`;
                    if (opt.image_url) report += `  - ![image](${opt.image_url})\n`;
                    if (opt.summary) {
                        report += `  - *${opt.summary}*\n`;
                    }
                });
                report += '\n';
            }
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
                const platformName = g.platforms && g.platforms.length > 0 ? g.platforms[0].name : 'Unknown';
                report += `- [ ] ${g.name} (${platformName}) - ID: igdb-${g.id}\n`;
            });
            report += '\n';
        }
    }

    if (toyDiscovery.length > 0) {
        report += '## Discovery: New Toys\n';
        for (const d of toyDiscovery) {
            report += `### Line: ${d.series}\n`;
            d.items.forEach(i => {
                report += `- [ ] ${i.name} (${i.line}) - ID: ${i.id}\n`;
                if (i.image_url) report += `  - ![cover](${i.image_url})\n`;
            });
            report += '\n';
        }
    }

    fs.writeFileSync('discovery_report.md', report);
    console.log('Report generated: discovery_report.md');
}

/**
 * Performs web validation using PriceCharting and PlayStation Store.
 * Returns true if the game was successfully updated.
 */
async function performWebValidation(searchTitle: string, game: GameRecord): Promise<boolean> {
    process.stdout.write(`Attempting web validation... `);
    const scraped = await scrapePriceCharting(searchTitle, game.platform_display_name);
    
    if (scraped) {
        const imageUrl = scraped.image_url;
        let summary = null;
        let releaseDate = null;

        // Use scraped image URL directly without downloading


        // If it's a PlayStation title, try to get more metadata from PS Store
        const psPlatforms = ['PlayStation 4', 'PlayStation 5', 'PlayStation VR', 'PlayStation VR2'];
        if (psPlatforms.includes(game.platform_display_name)) {
            const psData = await scrapePlayStationStore(searchTitle);
            if (psData) {
                summary = psData.description || null;
                releaseDate = psData.release_date || null;
            }
        }

        db.prepare(`
            UPDATE games 
            SET title = ?, pricecharting_url = ?, image_url = ?, summary = ?, release_date = ?, played = 0, backed_up = 0
            WHERE id = ?
        `).run(
            scraped.title,
            scraped.pricecharting_url,
            imageUrl,
            summary,
            releaseDate,
            game.id
        );

        console.log(`Web validated via PriceCharting! [${scraped.title}]`);
        return true;
    }
    return false;
}

runScraper().catch(console.error);
