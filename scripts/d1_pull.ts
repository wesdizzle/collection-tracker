/**
 * CLOUDFLARE D1 PULL UTILITY
 *
 * Downloads the current state of the remote Cloudflare D1 database (collection-db)
 * and recreates the local `collection.sqlite` staging database.
 *
 * USAGE:
 *   npx tsx scripts/d1_pull.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const localDbPath = path.join(rootDir, 'collection.sqlite');
const tempSqlPath = path.join(rootDir, 'd1_export_temp.sql');

console.log(
  '[D1Pull] Initiating pull from remote Cloudflare D1 (collection-db)...',
);

// Step 1: Export remote D1 to a temporary SQL file via wrangler
try {
  if (fs.existsSync(tempSqlPath)) {
    fs.unlinkSync(tempSqlPath);
  }

  console.log('[D1Pull] Exporting remote D1 schema and data...');
  execSync(
    `wrangler d1 export collection-db --remote --output=${tempSqlPath}`,
    {
      stdio: 'inherit',
      shell: true as unknown as string,
    },
  );

  if (!fs.existsSync(tempSqlPath) || fs.statSync(tempSqlPath).size === 0) {
    throw new Error('Exported SQL dump is empty or missing.');
  }

  // Step 2: Create a safety backup of existing local collection.sqlite if present
  if (fs.existsSync(localDbPath)) {
    const backupPath = path.join(
      rootDir,
      `collection_local_prev_${Date.now()}.sqlite.bak`,
    );
    fs.copyFileSync(localDbPath, backupPath);
    console.log(
      `[D1Pull] Backed up existing local sqlite to: ${path.basename(backupPath)}`,
    );
    fs.unlinkSync(localDbPath);
  }

  // Step 3: Reconstruct local SQLite from exported SQL
  console.log(
    '[D1Pull] Rebuilding local collection.sqlite from remote dump...',
  );
  const newDb = new Database(localDbPath);
  const sqlContent = fs.readFileSync(tempSqlPath, 'utf8');
  newDb.exec(sqlContent);
  newDb.close();

  // Clean up temp SQL
  fs.unlinkSync(tempSqlPath);

  console.log(
    '✅ Successfully pulled remote Cloudflare D1 state to local collection.sqlite!',
  );
} catch (err) {
  console.error('[D1Pull] Failed to pull database from Cloudflare D1:', err);
  if (fs.existsSync(tempSqlPath)) {
    try {
      fs.unlinkSync(tempSqlPath);
    } catch {
      // ignore
    }
  }
  process.exit(1);
}
