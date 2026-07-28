/**
 * CANONICAL SERIES UPDATER
 *
 * Uses scripts/lib/canonical_series.ts to update games in collection.sqlite.
 *
 * Usage: npx tsx scripts/compute_canonical_series.ts
 */

import Database from 'better-sqlite3';
import {
  computeGameCanonicalSeries,
  GameMetadata,
} from './lib/canonical_series.js';

const CONFIG = {
  dbPath: 'collection.sqlite',
  columns: {
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
    id: number | string;
    canonical_series?: string;
  })[];
  const updateStmt = db.prepare(
    `UPDATE games SET ${CONFIG.columns.target} = ? WHERE id = ?`,
  );

  console.log(`Processing ${games.length} games...`);

  let updateCount = 0;

  for (const game of games) {
    const computedSeries = computeGameCanonicalSeries(game);

    if (computedSeries !== game.canonical_series) {
      updateStmt.run(computedSeries, game.id);
      updateCount++;
    }
  }

  console.log(`Done. Updated ${updateCount}/${games.length} games.`);
  db.close();
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  recomputeCanonicalSeries().catch((err) => {
    console.error('Fatal error updating canonical series:', err);
    process.exit(1);
  });
}
