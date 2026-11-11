/**
 * DATABASE INITIALIZATION UTILITY
 *
 * Initializes a local `collection.sqlite` database using the canonical schema
 * and base reference catalog from `migrations/schema.sql`.
 *
 * USAGE:
 *   npx tsx scripts/init_database.ts
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { getLocalD1Path } from './lib/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const dbPath = getLocalD1Path();
const schemaPath = path.join(rootDir, 'migrations', 'schema.sql');

if (!fs.existsSync(schemaPath)) {
  console.error(`[InitDb] Error: Canonical schema not found at ${schemaPath}`);
  process.exit(1);
}

console.log('[InitDb] Initializing local collection.sqlite database...');

const db = new Database(dbPath);

try {
  console.log('[InitDb] Applying canonical schema: migrations/schema.sql...');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(sql);

  console.log(
    '✅ Successfully applied canonical schema and base reference catalog!',
  );

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
