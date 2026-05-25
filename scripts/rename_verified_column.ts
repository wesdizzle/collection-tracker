/**
 * @fileoverview Database Migration Script
 * Renames the `verified` column to `manually_verified` in the `games` table.
 * Also marks games matching 'PSVR Demo Disc' as manually verified (manually_verified = 1)
 * to prevent the scraper from attempting to overwrite them.
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.resolve(__dirname, '..', 'collection.sqlite');

/**
 * Checks if a column exists in a given table.
 *
 * @param db The active better-sqlite3 database instance.
 * @param tableName The table name to check.
 * @param columnName The column name to search for.
 * @returns True if the column exists in the table, false otherwise.
 */
function hasColumn(
  db: Database.Database,
  tableName: string,
  columnName: string,
): boolean {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as {
    name: string;
  }[];
  return columns.some((col) => col.name === columnName);
}

/**
 * Main migration execution function.
 */
function runMigration(): void {
  console.log(`Opening database at: ${dbPath}`);
  const db = new Database(dbPath);

  try {
    const hasVerified = hasColumn(db, 'games', 'verified');
    const hasManuallyVerified = hasColumn(db, 'games', 'manually_verified');

    if (hasVerified && !hasManuallyVerified) {
      console.log(
        "Renaming column 'verified' to 'manually_verified' in 'games' table...",
      );
      db.exec('ALTER TABLE games RENAME COLUMN verified TO manually_verified;');
      console.log('Column successfully renamed.');
    } else if (hasManuallyVerified) {
      console.log(
        "Column 'manually_verified' already exists. Skipping column rename.",
      );
    } else {
      console.error(
        "Neither 'verified' nor 'manually_verified' exists in 'games' table!",
      );
      process.exit(1);
    }

    // Set manually_verified = 1 for PSVR Demo Disc games
    console.log(
      "Finding 'PSVR Demo Disc' games to mark as manually verified...",
    );
    const psvrGames = db
      .prepare(
        "SELECT stable_id, title FROM games WHERE title LIKE '%Demo Disc%'",
      )
      .all() as { stable_id: number; title: string }[];

    if (psvrGames.length > 0) {
      console.log(`Found ${psvrGames.length} demo disc game(s):`);
      const updateStmt = db.prepare(
        'UPDATE games SET manually_verified = 1 WHERE stable_id = ?',
      );

      db.transaction(() => {
        for (const g of psvrGames) {
          console.log(`  - Marking: "${g.title}" (ID: ${g.stable_id})`);
          updateStmt.run(g.stable_id);
        }
      })();
      console.log('Successfully marked demo disc games as manually verified!');
    } else {
      console.log('No demo disc games found in the collection to mark.');
    }

    // Verify schema changes
    const schema = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='games'",
      )
      .get() as { sql: string };
    console.log('\nUpdated Games Table Schema:');
    console.log(schema.sql);
  } catch (error) {
    console.error(
      'Migration failed:',
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  } finally {
    db.close();
  }
}

runMigration();
