/**
 * OUTLIER RELEASE DATE SCANNER & FIXER
 *
 * Purpose:
 * Scans all games and game_releases in collection.sqlite to detect release dates that are
 * outliers relative to platform active lifespan guidelines (e.g. Virtual Console re-release
 * dates assigned to original NES/SNES physical games).
 *
 * For any detected outlier date or missing release date, it re-queries IGDB using platform-locked
 * queries to update the database with authentic release dates.
 *
 * Usage:
 * npx tsx scripts/fix_outlier_release_dates.ts
 */

import Database from 'better-sqlite3';
import { getGameById, PLATFORM_LIFESPANS, PLATFORM_MAP } from './lib/igdb.js';

interface GameReleaseRow {
  release_id: string;
  game_id: number;
  stable_id: number;
  title: string;
  platform_id: number;
  igdb_id: number | null;
  release_date: string | null;
  platform_display_name: string | null;
  platform_name: string | null;
}

/**
 * Main execution function that scans the database and fixes outlier release dates.
 */
export async function fixOutlierReleaseDates() {
  console.log('=== Outlier Release Date Scanner & Fixer ===\n');
  const db = new Database('collection.sqlite');

  const games: GameReleaseRow[] = db
    .prepare(
      `
      SELECT 
        r.id as release_id,
        g.id as game_id,
        g.stable_id,
        g.title,
        g.platform_id,
        g.igdb_id,
        r.release_date,
        p.display_name as platform_display_name,
        p.name as platform_name
      FROM games g
      JOIN game_releases r ON g.stable_id = r.game_id
      LEFT JOIN platforms p ON g.platform_id = p.id
    `,
    )
    .all() as GameReleaseRow[];

  console.log(`Auditing ${games.length} game releases...`);

  let scannedCount = 0;
  let outlierCount = 0;
  let fixedCount = 0;
  let flaggedCount = 0;

  const updateReleaseStmt = db.prepare(
    `UPDATE game_releases SET release_date = ? WHERE id = ?`,
  );

  for (const game of games) {
    scannedCount++;
    const platformName = game.platform_display_name || game.platform_name || '';
    const igdbPlatformId = PLATFORM_MAP[platformName] || game.platform_id;
    const lifespan = PLATFORM_LIFESPANS[igdbPlatformId];
    let isOutlier = false;
    if (game.release_date) {
      const currentYear = parseInt(game.release_date.split('-')[0], 10);
      if (
        lifespan &&
        (currentYear < lifespan[0] || currentYear > lifespan[1])
      ) {
        isOutlier = true;
      }
    } else {
      isOutlier = true; // Missing release date
    }

    if (isOutlier && game.igdb_id) {
      outlierCount++;
      console.log(
        `[Outlier Detected] "${game.title}" (${platformName} -> IGDB Platform ${igdbPlatformId}): Current Date = ${game.release_date || 'MISSING'} (Lifespan: ${lifespan ? lifespan.join('-') : 'Unknown'})`,
      );

      // Re-query IGDB using platform-locked release date logic with correct IGDB platform ID
      const freshGame = await getGameById(game.igdb_id, igdbPlatformId);

      if (freshGame && freshGame.release_date) {
        const dateChanged = freshGame.release_date !== game.release_date;

        if (dateChanged) {
          updateReleaseStmt.run(freshGame.release_date, game.release_id);
          fixedCount++;
          console.log(
            `  -> UPDATED to authentic release date: ${freshGame.release_date}${freshGame.flagged_outlier ? ' [Flagged Outlier Guideline]' : ''}`,
          );
        } else {
          console.log(
            `  -> Maintained date: ${freshGame.release_date}${freshGame.flagged_outlier ? ' [Flagged Outlier Guideline]' : ''}`,
          );
        }

        if (freshGame.flagged_outlier) {
          flaggedCount++;
        }
      } else {
        console.warn(
          `  -> IGDB returned no valid date for IGDB ID ${game.igdb_id}`,
        );
      }
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Total Releases Scanned: ${scannedCount}`);
  console.log(`Outliers Identified: ${outlierCount}`);
  console.log(`Releases Updated: ${fixedCount}`);
  console.log(`Boutique / Late Releases Flagged for Review: ${flaggedCount}`);
  console.log('================');

  db.close();
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  fixOutlierReleaseDates().catch((err) => {
    console.error('Fatal error fixing release dates:', err);
    process.exit(1);
  });
}
