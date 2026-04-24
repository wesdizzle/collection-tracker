/**
 * FIX MISSING GAME IMAGES
 * 
 * This script identifies games in the local database that are missing image URLs
 * and attempts to fetch them from IGDB using existing IDs or title-based search.
 */

import Database from 'better-sqlite3';
import { findGame, getGameById } from './lib/igdb.js';

const db = new Database('collection.sqlite');

interface GameRecord {
    id: string;
    title: string;
    platform_id: number;
    igdb_id: string | null;
    platform_display_name: string;
    platform_igdb_id: number;
}

async function fixMissingImages() {
    console.log('--- Starting Missing Image Fix Phase ---');

    // Query for games with missing images
    const missingGames = db.prepare(`
        SELECT g.id, g.title, g.platform_id, g.igdb_id, 
               p.display_name as platform_display_name,
               p.igdb_id as platform_igdb_id
        FROM games g
        LEFT JOIN platforms p ON g.platform_id = p.id
        WHERE g.image_url IS NULL OR g.image_url = ''
    `).all() as GameRecord[];

    if (missingGames.length === 0) {
        console.log('No games found with missing images.');
        return;
    }

    console.log(`Found ${missingGames.length} games to fix.`);

    for (const game of missingGames) {
        process.stdout.write(`Processing: ${game.title} (${game.platform_display_name})... `);

        let metadata = null;

        // Step 1: Try fetching by IGDB ID if available
        if (game.igdb_id) {
            metadata = await getGameById(Number(game.igdb_id), game.platform_igdb_id);
        }

        // Step 2: If no metadata yet, or if it has no image, try searching by title and platform
        if (!metadata || !metadata.image_url) {
            const searchTitle = game.title.replace(/\(.*\)/g, '').trim();
            const matches = await findGame(searchTitle, game.platform_igdb_id);
            if (matches && matches.length > 0) {
                // Try to find the first match WITH an image
                const matchWithImage = matches.find(m => m.image_url);
                if (matchWithImage) {
                    metadata = matchWithImage;
                } else if (!metadata) {
                    metadata = matches[0];
                }
            }
        }

        // Step 2.5: Final fallback - Global search (no platform lock) if still no image
        if (!metadata || !metadata.image_url) {
            const searchTitle = game.title.replace(/\(.*\)/g, '').trim();
            const globalMatches = await findGame(searchTitle, 0);
            if (globalMatches && globalMatches.length > 0) {
                const globalWithImage = globalMatches.find(m => m.image_url);
                if (globalWithImage) {
                    metadata = globalWithImage;
                }
            }
        }

        // Step 3: Update database if we found an image URL
        if (metadata) {
            if (metadata.image_url) {
                db.prepare(`
                    UPDATE games 
                    SET image_url = ?, 
                        igdb_id = COALESCE(igdb_id, ?),
                        summary = COALESCE(summary, ?),
                        genres = COALESCE(genres, ?),
                        franchises = COALESCE(franchises, ?),
                        collections = COALESCE(collections, ?)
                    WHERE id = ?
                `).run(
                    metadata.image_url,
                    metadata.id.replace('igdb-', ''),
                    metadata.summary || null,
                    metadata.genres || null,
                    metadata.franchises || null,
                    metadata.collections || null,
                    game.id
                );
                console.log(`Updated! [ID: ${metadata.id}]`);
            } else {
                console.log(`Found game ${metadata.id} but it has no cover art on IGDB.`);
            }
        } else {
            console.log('No metadata found at all.');
        }
    }

    console.log('--- Fix Phase Complete ---');
}

fixMissingImages().catch(console.error);
