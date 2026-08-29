/**
 * CANONICAL SERIES UPDATER
 *
 * Uses scripts/lib/canonical_series.ts to update games in collection.sqlite
 * and optionally outputs a targeted SQL update script for Cloudflare D1.
 *
 * Usage: npx tsx scripts/compute_canonical_series.ts
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import {
  computeGameCanonicalSeries,
  GameMetadata,
} from './lib/canonical_series.js';

const CONFIG = {
  dbPath: 'collection.sqlite',
  sqlExportPath: 'update_canonical_series.sql',
  columns: {
    stableId: 'stable_id',
    id: 'id',
    title: 'title',
    summary: 'summary',
    seriesList: 'collections',
    franchiseList: 'franchises',
    target: 'canonical_series',
  },
};

export async function recomputeCanonicalSeries() {
  console.log('=== Canonical Series Updater & Pipeline ===\n');
  const db = new Database(CONFIG.dbPath);

  const games = db.prepare(`SELECT * FROM games`).all() as (GameMetadata & {
    stable_id: number;
    id: string;
    canonical_series?: string;
  })[];
  const updateStmt = db.prepare(
    `UPDATE games SET ${CONFIG.columns.target} = ? WHERE stable_id = ?`,
  );

  console.log(`Processing ${games.length} games...`);

  let updateCount = 0;
  const sqlUpdates: string[] = [];

  for (const game of games) {
    const computedSeries = computeGameCanonicalSeries(game);

    if (computedSeries !== game.canonical_series) {
      updateStmt.run(computedSeries, game.stable_id);
      updateCount++;

      // Escape single quotes for SQL statement
      const escapedSeries = computedSeries.replace(/'/g, "''");
      sqlUpdates.push(
        `UPDATE games SET canonical_series = '${escapedSeries}' WHERE stable_id = ${game.stable_id};`,
      );
    }
  }

  // Generate surgical update script for Cloudflare D1 if there were updates
  if (sqlUpdates.length > 0) {
    const fullSql = `-- Automated Canonical Series D1 Update Migration\n-- Total affected records: ${sqlUpdates.length}\n\n${sqlUpdates.join('\n')}\n`;
    fs.writeFileSync(
      path.resolve(process.cwd(), CONFIG.sqlExportPath),
      fullSql,
      'utf8',
    );
    console.log(
      `Generated '${CONFIG.sqlExportPath}' with ${sqlUpdates.length} update statements.`,
    );
  }

  console.log(
    `Done. Updated ${updateCount}/${games.length} games in local database.`,
  );
  db.close();
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  recomputeCanonicalSeries().catch((err) => {
    console.error('Fatal error updating canonical series:', err);
    process.exit(1);
  });
}
