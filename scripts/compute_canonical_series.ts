/**
 * CANONICAL SERIES UPDATER
 * 
 * Logic:
 * 1. Normalized Matching: Strips non-alphanumeric chars for all comparisons.
 * 2. Robust Substring Filtering: Detects root series (Pac-Man vs Ms. Pac-Man).
 * 3. Redirect/Blocklist: Maps legacy names and suppresses generic meta-collections.
 * 4. Consensus & Keyword Scoring: Weights items found in both metadata fields or the title.
 * 5. Fallback: If no series is identified, sets canonical_series to the game title.
 * 
 * Usage: npx tsx scripts/compute_canonical_series.ts
 */

import Database from 'better-sqlite3';
import { pipeline } from '@xenova/transformers';

interface GameRow {
    id: number | string;
    title: string;
    summary?: string;
    collections?: string;
    franchises?: string;
    igdb_id?: number;
    [key: string]: unknown;
}

// --- CONFIGURATION ---

const CONFIG = {
    dbPath: 'collection.sqlite',
    modelName: 'Xenova/all-MiniLM-L6-v2',
    columns: {
        id: 'id',
        title: 'title',
        summary: 'summary',
        seriesList: 'collections',
        franchiseList: 'franchises',
        target: 'canonical_series'
    }
};

const SERIES_REDIRECTS: Record<string, string | null> = {
    "DK": "Donkey Kong",
    "Detective Pikachu": "Pokémon",
    "Final Fantasy Legend": "SaGa",
    "Final Fantasy Legend II": "SaGa",
    "Final Fantasy Legend III": "SaGa",
    "Harvest Moon (old)": "Story of Seasons",
    "Harvest Moon": "Story of Seasons",
    "Harvest Moon (new)": "Harvest Moon",
    "Light Gun Series": null, 
    "NES Series": null,
    "Classic Series": null,
    "Nintendo Selects": null,
    "Amiibo": null,
    "Sega Ages": null,
    "Robot Series": null,
    "Nintendo Sports": null,
    "Action Series": null,
    "Programmable Series": null,
    "Sports Series": null
};

// --- UTILS ---

function normalize(s: string): string {
    return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getFirstWord(s: string): string {
    return s.split(' ')[0].toLowerCase();
}

function getFirstNontrivialWord(s: string): string {
    const skip = new Set(['the', 'a', 'an']);
    const words = s.split(' ');
    for (const word of words) {
        const clean = normalize(word);
        if (clean && !skip.has(clean)) return clean;
    }
    return normalize(words[0]);
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// --- MAIN ---

export async function recomputeCanonicalSeries() {
    console.log('--- Canonical Series Updater ---');
    const db = new Database(CONFIG.dbPath);
    
    console.log('Loading embedding model...');
    const embedder = await pipeline('feature-extraction', CONFIG.modelName);

    console.log('Calculating metadata frequencies...');
    const frequencies: Record<string, number> = {};
    const allGamesRaw = db.prepare(`SELECT ${CONFIG.columns.seriesList} as s, ${CONFIG.columns.franchiseList} as f FROM games WHERE igdb_id IS NOT NULL`).all() as { s: string, f: string }[];
    
    for (const row of allGamesRaw) {
        const items = new Set([
            ...(row.s || '').split(',').map((i: string) => i.trim()).filter(Boolean),
            ...(row.f || '').split(',').map((i: string) => i.trim()).filter(Boolean)
        ]);
        for (const item of items) {
            frequencies[item] = (frequencies[item] || 0) + 1;
        }
    }

    const games = db.prepare(`SELECT * FROM games`).all() as GameRow[];
    const updateStmt = db.prepare(`UPDATE games SET ${CONFIG.columns.target} = ? WHERE id = ?`);

    console.log(`Processing ${games.length} games...`);
    
    let updateCount = 0;

    for (const game of games) {
        let canonicalSeries: string | null = null;

        const seriesRaw = (game.collections || '').split(',').map((s: string) => s.trim()).filter(Boolean);
        const franchisesRaw = (game.franchises || '').split(',').map((s: string) => s.trim()).filter(Boolean);
        
        const applyRedirects = (list: string[]) => {
            return list.map(item => {
                if (SERIES_REDIRECTS[item] !== undefined) return SERIES_REDIRECTS[item];
                return item;
            }).filter(Boolean) as string[];
        };

        const series = applyRedirects(seriesRaw);
        const franchises = applyRedirects(franchisesRaw);
        const candidates = Array.from(new Set([...series, ...franchises]));

        if (candidates.length > 0) {
            // A. Substring Filter: Only filter out if the shorter one is a tiny common word OR if the longer one is significantly more frequent
            const filtered = candidates.filter((a, i) => {
                const normA = normalize(a);
                return !candidates.some((b, j) => {
                    if (i === j) return false;
                    const normB = normalize(b);
                    // If A contains B
                    if (normA.includes(normB) && normA.length > normB.length) {
                        // If B is a single letter (and not 'N' or other valid ones we want to keep) or very generic, drop it
                        const skipShort = new Set(['a', 'v', 'i', 'ii', 'iii']);
                        if (normB.length === 1 && !['n'].includes(normB)) return true;
                        if (skipShort.has(normB)) return true;
                        
                        // Otherwise, if B is the "root" (like Pac-Man vs Ms. Pac-Man), we usually want B.
                        // So we DON'T filter out A here, but we might prefer B in scoring.
                    }
                    return false;
                });
            });

            // B. First Word Frequency Filter
            const groups: Record<string, string[]> = {};
            for (const cand of filtered) {
                const firstWord = getFirstWord(cand);
                if (!groups[firstWord]) groups[firstWord] = [];
                groups[firstWord].push(cand);
            }
            const survivors = Object.values(groups).map(group => {
                return group.reduce((prev, curr) => (frequencies[curr] || 0) > (frequencies[prev] || 0) ? curr : prev);
            });

            // C. Scoring
            const normTitle = normalize(game.title);
            const normSummary = normalize(game.summary || '');
            
            // Colon-Prefix Heuristic: Extract the part before the first colon
            const colonIndex = game.title.indexOf(':');
            const primaryPrefix = colonIndex > 0 ? normalize(game.title.substring(0, colonIndex)) : null;

            const scores = survivors.map(s => {
                let score = 0;
                let candidate = s;
                const normS = normalize(s);

                // Contextual Xeno Logic
                if (normS === 'xeno') {
                    if (normTitle.includes('xenoblade')) candidate = 'Xenoblade Chronicles';
                    else if (normTitle.includes('xenogears')) candidate = 'Xenogears';
                    else if (normTitle.includes('xenosaga')) candidate = 'Xenosaga';
                }

                if (series.some(x => normalize(x) === normS) && franchises.some(x => normalize(x) === normS)) score += 5;
                if (normTitle.includes(normS)) score += 10;
                else if (normTitle.includes(getFirstNontrivialWord(s))) score += 3;

                // Colon-Prefix Bonus
                if (primaryPrefix && normS === primaryPrefix) score += 10;

                if (normSummary.includes(normS)) score += 2;
                score += Math.min(frequencies[s] || 0, 100) / 100;
                return { item: candidate, score };
            });

            scores.sort((a, b) => b.score - a.score);

            if (scores.length > 0 && (scores[0].score > 1 || (scores[0].score > 0 && scores.length === 1))) {
                const topScore = scores[0].score;
                const topCandidates = scores.filter(s => s.score === topScore).map(s => s.item);
                if (topCandidates.length === 1) canonicalSeries = topCandidates[0];
                else canonicalSeries = await runVectorTieBreaker(game, topCandidates, embedder);
            }
        }

        // Fallback to title
        if (!canonicalSeries) {
            canonicalSeries = game.title;
        }

        updateStmt.run(canonicalSeries, game.id);
        updateCount++;

        if (updateCount % 500 === 0) console.log(`Updated ${updateCount}/${games.length} games...`);
    }

    console.log(`--- Done. Total games updated: ${updateCount} ---`);
    db.close();
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
    recomputeCanonicalSeries().catch(console.error);
}

async function runVectorTieBreaker(game: GameRow, candidates: string[], embedder: any): Promise<string> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const gameText = `${game.title} ${game.summary || ''}`.trim();
    const targetOutput = await embedder(gameText, { pooling: 'mean', normalize: true });
    const targetVector = Array.from(targetOutput.data) as number[];

    let bestMatch = candidates[0];
    let maxSimilarity = -1;

    for (const candidate of candidates) {
        const candidateOutput = await embedder(candidate, { pooling: 'mean', normalize: true });
        const candidateVector = Array.from(candidateOutput.data) as number[];
        const similarity = cosineSimilarity(targetVector, candidateVector);
        if (similarity > maxSimilarity) {
            maxSimilarity = similarity;
            bestMatch = candidate;
        }
    }
    return bestMatch;
}

