/**
 * CLOUDFLARE D1 PUSH UTILITY
 *
 * Synchronizes local `collection.sqlite` changes up to the remote Cloudflare D1 database.
 * Includes safety guards to prevent accidental production overrides.
 *
 * In CI/CD environments (such as Cloudflare Pages/Workers build or GitHub Actions) where
 * Cloudflare D1 is the primary database, this script gracefully no-ops.
 *
 * USAGE:
 *   ALLOW_LOCAL_DEPLOY=true npx tsx scripts/d1_push.ts
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const dbPath = path.join(rootDir, 'collection.sqlite');

// CI / Cloudflare Build Environment Check
// When building in CI/CD, Cloudflare D1 is already the authoritative primary database.
if (process.env['CI'] || process.env['CF_PAGES'] || !fs.existsSync(dbPath)) {
  console.log(
    '[D1Push] Build environment or missing local SQLite detected.\n' +
      '[D1Push] Skipping SQLite push — Cloudflare D1 is the authoritative primary database.',
  );
  process.exit(0);
}

// Safety Guard: Prevent accidental local database overrides without explicit confirmation
if (process.env['ALLOW_LOCAL_DEPLOY'] !== 'true') {
  console.error(
    '\x1b[31m[D1Push] Error: Direct push to remote Cloudflare D1 requires ALLOW_LOCAL_DEPLOY=true.\x1b[0m\n' +
      'To push your local changes, run:\n' +
      '  ALLOW_LOCAL_DEPLOY=true npm run db:push\n' +
      'or set ALLOW_LOCAL_DEPLOY=true in your .env file.\n',
  );
  process.exit(1);
}

console.log(
  '[D1Push] Extracting SQLite schema and records for Cloudflare D1 synchronization...',
);

const db = new Database(dbPath, { readonly: true });
let sqlDump = 'PRAGMA foreign_keys = OFF;\n\n';

const tables = db
  .prepare(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
  )
  .all() as { name: string; sql: string }[];

for (const table of tables) {
  sqlDump += `DROP TABLE IF EXISTS ${table.name};\n`;
  sqlDump += table.sql + ';\n';

  const rows = db.prepare(`SELECT * FROM ${table.name}`).all() as Record<
    string,
    unknown
  >[];

  if (rows.length > 0) {
    for (const row of rows) {
      const cols = Object.keys(row);
      const vals = Object.values(row).map((v) => {
        if (v === null) return 'NULL';
        if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
        if (typeof v === 'boolean') return v ? '1' : '0';
        return v;
      });
      sqlDump += `INSERT INTO ${table.name} (${cols.join(', ')}) VALUES (${vals.join(', ')});\n`;
    }
  }
  sqlDump += '\n';
}

sqlDump += 'PRAGMA foreign_keys = ON;\n';
db.close();

const outPath = path.join(rootDir, 'deploy.sql');
fs.writeFileSync(outPath, sqlDump, 'utf8');
console.log(
  '[D1Push] Generated deploy.sql. Uploading to Cloudflare D1 (collection-db)...',
);

try {
  execSync(`wrangler d1 execute collection-db --remote --file=deploy.sql`, {
    stdio: 'inherit',
    shell: true as unknown as string,
  });
  console.log(
    '✅ Successfully synchronized local database changes to remote Cloudflare D1!',
  );
} catch (err) {
  console.error('[D1Push] Failed to push to Cloudflare D1:', err);
  process.exit(1);
} finally {
  if (fs.existsSync(outPath)) {
    try {
      fs.unlinkSync(outPath);
    } catch {
      // ignore
    }
  }
}
