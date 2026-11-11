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

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  getGameById,
  PLATFORM_LIFESPANS,
  PLATFORM_MAP,
  NormalizedGame,
} from './lib/igdb.js';

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const tempDir = path.join(rootDir, 'scripts', 'temp');

/**
 * Main execution function that scans the database and fixes outlier release dates.
 */
import { getDatabase } from './lib/db.js';

export async function fixOutlierReleaseDates(isDryRun = false) {
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  console.log(
    `=== Outlier Release Date Scanner & Fixer ${isDryRun ? '(DRY RUN)' : ''} ===\n`,
  );
  const db = getDatabase();

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
  const gameCache = new Map<string, NormalizedGame | null>();
  const sqlStatements: string[] = [];

  const updateReleaseStmt = isDryRun
    ? null
    : db.prepare(`UPDATE game_releases SET release_date = ? WHERE id = ?`);

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
      const cacheKey = `${game.igdb_id}-${igdbPlatformId}`;
      let freshGame = gameCache.get(cacheKey);

      if (freshGame === undefined) {
        freshGame = await getGameById(game.igdb_id, igdbPlatformId);
        gameCache.set(cacheKey, freshGame);
      }

      if (freshGame && freshGame.release_date) {
        const dateChanged = freshGame.release_date !== game.release_date;

        if (dateChanged) {
          if (!isDryRun && updateReleaseStmt) {
            updateReleaseStmt.run(freshGame.release_date, game.release_id);
          }
          sqlStatements.push(
            `UPDATE game_releases SET release_date = '${freshGame.release_date}' WHERE id = '${game.release_id.replace(/'/g, "''")}';`,
          );
          fixedCount++;
          console.log(
            `[Fixed] "${game.title}" (${platformName}): ${game.release_date || 'MISSING'} -> ${freshGame.release_date}${freshGame.flagged_outlier ? ' [Flagged Outlier Guideline]' : ''}`,
          );
        } else {
          console.log(
            `[Maintained] "${game.title}" (${platformName}): ${freshGame.release_date}${freshGame.flagged_outlier ? ' [Flagged Outlier Guideline]' : ''}`,
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

  const sqlFilePath = path.join(tempDir, 'fix_outlier_release_dates.sql');
  fs.writeFileSync(sqlFilePath, sqlStatements.join('\n'), 'utf8');

  console.log('\n=== Summary ===');
  console.log(`Total Releases Scanned:                      ${scannedCount}`);
  console.log(`Outliers Identified:                         ${outlierCount}`);
  console.log(`Releases Updated:                            ${fixedCount}`);
  console.log(`Boutique / Late Releases Flagged for Review: ${flaggedCount}`);
  console.log(
    `SQL statements generated:                    ${sqlStatements.length}`,
  );
  console.log(`SQL migration file:                          ${sqlFilePath}`);
  console.log('================');

  db.close();
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const isDryRun = process.argv.includes('--dry-run');
  fixOutlierReleaseDates(isDryRun).catch((err) => {
    console.error('Fatal error fixing release dates:', err);
    process.exit(1);
  });
}
