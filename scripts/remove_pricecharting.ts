/**
 * @fileoverview Database Migration Script
 * Drops the `pricecharting_url` column from the `games` table in `collection.sqlite`.
 * Since we have transitioned to community dump hash files (No-Intro / Redump DAT files)
 * for physical/ROM verification, we no longer need the PriceCharting integration.
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
 * Main function to run the database migration.
 * Inspects the games table and drops the pricecharting_url column if present.
 */
function runMigration(): void {
  console.log(`Opening database at: ${dbPath}`);
  const db = new Database(dbPath);

  try {
    const hasPricechartingUrl = hasColumn(db, 'games', 'pricecharting_url');

    if (hasPricechartingUrl) {
      console.log("Column 'pricecharting_url' found. Dropping column...");
      // Drop column is supported natively in modern SQLite (3.35.0+)
      db.exec('ALTER TABLE games DROP COLUMN pricecharting_url;');
      console.log(
        "Successfully dropped 'pricecharting_url' from 'games' table.",
      );
    } else {
      console.log(
        "Column 'pricecharting_url' does not exist in 'games' table. Skipping migration.",
      );
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
