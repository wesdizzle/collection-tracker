/**
 * DATABASE INITIALIZATION UTILITY
 *
 * Initializes a new local `collection.sqlite` database using the canonical schema
 * and base reference catalog from `migrations/0001_initial_schema.sql`.
 *
 * USAGE:
 *   npx tsx scripts/init_database.ts
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const dbPath = path.join(rootDir, 'collection.sqlite');
const migrationPath = path.join(
  rootDir,
  'migrations',
  '0001_initial_schema.sql',
);

if (!fs.existsSync(migrationPath)) {
  console.error(`[InitDb] Error: Migration file not found at ${migrationPath}`);
  process.exit(1);
}

console.log('[InitDb] Initializing fresh local collection.sqlite database...');

if (fs.existsSync(dbPath)) {
  console.log(
    '[InitDb] Applying schema and seed data to existing local collection.sqlite...',
  );
} else {
  console.log('[InitDb] Creating new collection.sqlite database...');
}

const db = new Database(dbPath);
const migrationSql = fs.readFileSync(migrationPath, 'utf8');

try {
  db.exec(migrationSql);
  console.log(
    '✅ Successfully initialized database schema and base reference catalog!',
  );

  // Print summary counts
  const platformCount = (
    db.prepare('SELECT COUNT(*) as c FROM platforms').get() as { c: number }
  ).c;
  const toySeriesCount = (
    db.prepare('SELECT COUNT(*) as c FROM toy_series').get() as { c: number }
  ).c;
  console.log(`- Platforms initialized: ${platformCount}`);
  console.log(`- Toy Series initialized: ${toySeriesCount}`);
} catch (err) {
  console.error('[InitDb] Failed to initialize database:', err);
  process.exit(1);
} finally {
  db.close();
}
