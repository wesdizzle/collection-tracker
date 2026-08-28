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
const migrationsDir = path.join(rootDir, 'migrations');

if (!fs.existsSync(migrationsDir)) {
  console.error(
    `[InitDb] Error: Migrations directory not found at ${migrationsDir}`,
  );
  process.exit(1);
}

console.log('[InitDb] Initializing local collection.sqlite database...');

const db = new Database(dbPath);

try {
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of migrationFiles) {
    console.log(`[InitDb] Applying migration: ${file}...`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    // Split on statements or execute directly; if an ALTER TABLE fails because column exists, handle gracefully
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      try {
        db.exec(stmt);
      } catch (stmtErr: unknown) {
        const msg =
          stmtErr instanceof Error ? stmtErr.message : String(stmtErr);
        if (msg.includes('duplicate column name')) {
          // Column already exists, safe to ignore
          continue;
        }
        throw stmtErr;
      }
    }
  }

  console.log(
    '✅ Successfully applied all migrations and base reference catalog!',
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
