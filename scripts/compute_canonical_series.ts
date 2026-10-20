/**
 * CANONICAL SERIES UPDATER
 *
 * Uses scripts/lib/canonical_series.ts to update games in collection.sqlite
 * and outputs a targeted SQL update script for Cloudflare D1 into scripts/temp/.
 *
 * Usage:
 *   npx tsx scripts/compute_canonical_series.ts --dry-run
 *   npx tsx scripts/compute_canonical_series.ts --apply
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import {
  computeGameCanonicalSeries,
  GameMetadata,
} from './lib/canonical_series.js';
import { getLocalD1Path } from './lib/db.js';

export interface ComputeCanonicalOptions {
  apply?: boolean;
  dryRun?: boolean;
  dbPath?: string;
  sqlExportPath?: string;
}

const CONFIG = {
  dbPath: getLocalD1Path(),
  sqlExportPath: path.join('scripts', 'temp', 'update_canonical_series.sql'),
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

export async function recomputeCanonicalSeries(
  options: ComputeCanonicalOptions = {},
) {
  console.log('=== Canonical Series Updater & Pipeline ===\n');

  const isDirectCli = Boolean(
    process.argv[1] &&
    (process.argv[1].endsWith('compute_canonical_series.ts') ||
      process.argv[1].endsWith('compute_canonical_series.js')),
  );

  const isDryRun =
    options.dryRun ??
    (options.apply === false ||
      (isDirectCli && !process.argv.includes('--apply')));

  const dbPath = options.dbPath || CONFIG.dbPath;
  const sqlExportRelPath = options.sqlExportPath || CONFIG.sqlExportPath;
  const sqlExportFullPath = path.resolve(process.cwd(), sqlExportRelPath);

  if (isDryRun) {
    console.log(
      '[Mode: DRY RUN] Calculating diffs without modifying database.',
    );
  } else {
    console.log('[Mode: APPLY] Modifying local database with updates.');
  }

  const db = new Database(dbPath);

  const games = db.prepare(`SELECT * FROM games`).all() as (GameMetadata & {
    stable_id: number;
    id: string;
    canonical_series?: string;
  })[];

  console.log(`Processing ${games.length} games...`);

  let updateCount = 0;
  const sqlUpdates: string[] = [];
  const previewDiffs: {
    id: string;
    title: string;
    from: string;
    to: string;
  }[] = [];

  for (const game of games) {
    const computedSeries = computeGameCanonicalSeries(game);

    if (computedSeries !== (game.canonical_series ?? '')) {
      if (!isDryRun) {
        db.prepare(
          `UPDATE games SET ${CONFIG.columns.target} = ? WHERE stable_id = ?`,
        ).run(computedSeries, game.stable_id);
        updateCount++;
      }

      previewDiffs.push({
        id: game.id,
        title: game.title,
        from: game.canonical_series || '(none)',
        to: computedSeries || '(none)',
      });

      // Escape single quotes for SQL statement
      const escapedSeries = computedSeries.replace(/'/g, "''");
      sqlUpdates.push(
        `UPDATE games SET canonical_series = '${escapedSeries}' WHERE stable_id = ${game.stable_id};`,
      );
    }
  }

  // Display top changes preview if any
  if (previewDiffs.length > 0) {
    console.log(
      `\nSample changes (showing up to 10 of ${previewDiffs.length}):`,
    );
    for (const diff of previewDiffs.slice(0, 10)) {
      console.log(`  - "${diff.title}": "${diff.from}" -> "${diff.to}"`);
    }
  }

  // Generate surgical update script for Cloudflare D1 into scripts/temp/
  fs.mkdirSync(path.dirname(sqlExportFullPath), { recursive: true });
  if (sqlUpdates.length > 0) {
    const fullSql = `-- Automated Canonical Series D1 Update Migration\n-- Total affected records: ${sqlUpdates.length}\n\n${sqlUpdates.join('\n')}\n`;
    fs.writeFileSync(sqlExportFullPath, fullSql, 'utf8');
    console.log(
      `\nGenerated '${sqlExportRelPath}' with ${sqlUpdates.length} update statement(s).`,
    );
  } else {
    console.log(
      '\nAll games are up-to-date with canonical series rules. No SQL generated.',
    );
  }

  if (isDryRun) {
    console.log(
      `\n[Dry Run Complete] Evaluated ${games.length} games. ${sqlUpdates.length} record(s) require update. Local database was NOT modified.`,
    );
    if (sqlUpdates.length > 0) {
      console.log('To apply locally, run:');
      console.log('  npm run canonical:compute -- --apply');
      console.log('  OR: npm run db:apply ' + sqlExportRelPath);
      console.log('To deploy to Cloudflare D1, run:');
      console.log('  npm run d1:update-canonical -- --yes');
    }
  } else {
    console.log(
      `\n[Apply Complete] Updated ${updateCount}/${games.length} games in local database.`,
    );
  }

  db.close();
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith('compute_canonical_series.ts') ||
    process.argv[1].endsWith('compute_canonical_series.js'))
) {
  recomputeCanonicalSeries().catch((err) => {
    console.error('Fatal error updating canonical series:', err);
    process.exit(1);
  });
}
