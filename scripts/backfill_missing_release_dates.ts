/**
 * BACKFILL MISSING RELEASE DATES
 *
 * Populates NULL release_date fields in game_releases:
 * 1. From sibling game_releases belonging to the same game that have non-null release_date.
 * 2. For games where all releases lack release dates:
 *    - Uses IGDB first_release_date or known accurate release dates.
 *
 * Usage:
 * npx tsx scripts/backfill_missing_release_dates.ts
 */

import { getDatabase } from './lib/db.js';

export function backfillMissingReleaseDates(): void {
  const db = getDatabase();

  console.log('--- Backfilling Missing Release Dates ---');

  // Step 1: Copy release_date from sibling releases of the same game
  const siblingUpdate = db
    .prepare(
      `
    UPDATE game_releases
    SET release_date = (
      SELECT r2.release_date
      FROM game_releases r2
      WHERE r2.game_id = game_releases.game_id
        AND r2.release_date IS NOT NULL
      ORDER BY r2.release_date ASC
      LIMIT 1
    )
    WHERE release_date IS NULL
      AND EXISTS (
        SELECT 1
        FROM game_releases r3
        WHERE r3.game_id = game_releases.game_id
          AND r3.release_date IS NOT NULL
      )
  `,
    )
    .run();

  console.log(
    `Copied release dates from sibling releases: ${siblingUpdate.changes} rows updated.`,
  );

  // Step 2: Handle specific known games that have 0 release dates across all releases
  const specificDates: Record<string, string> = {
    'wolverine-nintendo-entertainment-system': '1991-10-01',
    'rayman-raving-rabbids-wii': '2006-11-19',
    'rayman-raving-rabbids-xbox-360': '2007-03-06',
    'atari-recharged-collection-1-nintendo-switch': '2023-04-06',
    'atari-recharged-collection-2-nintendo-switch': '2023-06-22',
    'atari-recharged-collection-3-nintendo-switch': '2023-08-31',
    'atari-recharged-collection-1-playstation-4': '2023-04-06',
    'atari-recharged-collection-2-playstation-4': '2023-06-22',
    'atari-recharged-collection-3-playstation-4': '2023-08-31',
    'atari-recharged-collection-1-playstation-5': '2023-04-06',
    'atari-recharged-collection-2-playstation-5': '2023-06-22',
    'atari-recharged-collection-3-playstation-5': '2023-08-31',
    'playstation-vr-demo-disc-playstation-4': '2016-10-13',
    'playstation-vr-demo-disc-2-playstation-4': '2017-10-10',
    'playstation-vr-demo-disc-3-playstation-4': '2019-01-22',
  };

  let specificUpdates = 0;
  for (const [gameId, date] of Object.entries(specificDates)) {
    const res = db
      .prepare(
        `
      UPDATE game_releases
      SET release_date = ?
      WHERE release_date IS NULL
        AND game_id = (SELECT stable_id FROM games WHERE id = ?)
    `,
      )
      .run(date, gameId);
    if (res.changes > 0) {
      specificUpdates += res.changes;
      console.log(
        `Updated "${gameId}" with release date ${date} (${res.changes} releases)`,
      );
    }
  }
  console.log(
    `Updated specific game dates: ${specificUpdates} total releases.`,
  );

  // Final check
  const remainingNull = db
    .prepare(
      `
    SELECT count(*) as count FROM game_releases WHERE release_date IS NULL
  `,
    )
    .get() as { count: number };

  console.log(
    `Remaining releases with NULL release_date: ${remainingNull.count}`,
  );
  console.log('--- Finished Backfill ---');
}

// Self-run when invoked directly
if (process.argv[1]?.endsWith('backfill_missing_release_dates.ts')) {
  backfillMissingReleaseDates();
}
