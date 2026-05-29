/**
 * MIGRATION SCRIPT: Populate Release Dates
 *
 * This script identifies all game releases in 'collection.sqlite' that are missing
 * release dates, queries the IGDB API for their regional release dates in batches,
 * and updates the database records.
 */

import dotenv from 'dotenv';
dotenv.config();

import Database from 'better-sqlite3';
import { getGamesByIds, type NormalizedGame } from './lib/igdb.js';

const db = new Database('collection.sqlite');

// Region mapping from scrape.ts
const regionMap: Record<string, number> = {
  EU: 1,
  Europe: 1,
  NA: 2,
  USA: 2,
  US: 2,
  'North America': 2,
  AU: 3,
  Australia: 3,
  NZ: 4,
  'New Zealand': 4,
  JP: 5,
  Japan: 5,
  CH: 6,
  China: 6,
  AS: 7,
  Asia: 7,
  WW: 8,
  Worldwide: 8,
};

async function main() {
  console.log('Finding releases missing release dates...');

  // Find all releases that have NULL release_date and their parent game has an igdb_id
  const pendingReleases = db
    .prepare(
      `
    SELECT r.id, r.game_id, r.region, g.igdb_id, g.title
    FROM game_releases r
    JOIN games g ON r.game_id = g.stable_id
    WHERE r.release_date IS NULL AND g.igdb_id IS NOT NULL
  `,
    )
    .all() as {
    id: string;
    game_id: number;
    region: string | null;
    igdb_id: number;
    title: string;
  }[];

  if (pendingReleases.length === 0) {
    console.log('No pending releases found missing release dates.');
    return;
  }

  console.log(`Found ${pendingReleases.length} releases to update.`);

  // Group by IGDB ID to fetch each game's metadata only once
  const igdbIdMap = new Map<number, typeof pendingReleases>();
  for (const r of pendingReleases) {
    const numericId = Number(r.igdb_id);
    if (!igdbIdMap.has(numericId)) {
      igdbIdMap.set(numericId, []);
    }
    igdbIdMap.get(numericId)!.push(r);
  }

  const igdbIds = Array.from(igdbIdMap.keys());
  console.log(`Unique games to query from IGDB: ${igdbIds.length}`);

  // Fetch from IGDB in batches of 100
  const freshCache = new Map<number, NormalizedGame>();
  const batchSize = 100;
  for (let i = 0; i < igdbIds.length; i += batchSize) {
    const chunk = igdbIds.slice(i, i + batchSize);
    console.log(
      `Querying IGDB batch ${i / batchSize + 1} / ${Math.ceil(igdbIds.length / batchSize)}...`,
    );
    try {
      const freshGames = await getGamesByIds(chunk);
      for (const fg of freshGames) {
        const numericId = Number(fg.id.replace('igdb-', ''));
        freshCache.set(numericId, fg);
      }
    } catch (err) {
      console.error('Error querying IGDB batch:', err);
    }
  }

  console.log('Updating database release dates...');
  const updateStmt = db.prepare(
    'UPDATE game_releases SET release_date = ? WHERE id = ?',
  );
  let updatedCount = 0;

  db.transaction(() => {
    for (const [igdbId, releases] of igdbIdMap.entries()) {
      const fresh = freshCache.get(igdbId);
      if (!fresh) {
        // Fallback: try to see if parent game's default release_date exists
        continue;
      }

      const igdbReleaseDates = fresh.release_dates || [];
      const fallbackDate = fresh.release_date;

      for (const r of releases) {
        let chosenDate: string | null = null;

        if (igdbReleaseDates.length > 0 && r.region) {
          const releaseRegParts = r.region
            .split(/[\s,]+/)
            .map((p) => p.trim().toLowerCase());

          for (const regText of Object.keys(regionMap)) {
            if (releaseRegParts.includes(regText.toLowerCase())) {
              const igdbRegId = regionMap[regText];
              const matched = igdbReleaseDates.find(
                (d: { region: number; date: number }) => d.region === igdbRegId,
              );
              if (matched && matched.date) {
                chosenDate = new Date(matched.date * 1000)
                  .toISOString()
                  .split('T')[0];
                break;
              }
            }
          }
        }

        if (!chosenDate) {
          chosenDate = fallbackDate || null;
        }

        if (chosenDate) {
          updateStmt.run(chosenDate, r.id);
          updatedCount++;
        }
      }
    }
  })();

  console.log(
    `Successfully updated release dates for ${updatedCount} / ${pendingReleases.length} releases.`,
  );
}

main().catch(console.error);
