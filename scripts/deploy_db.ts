import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

// Safety Guard: Prevent accidental local database overrides
if (!process.env['CI'] && process.env['ALLOW_LOCAL_DEPLOY'] !== 'true') {
  console.error(
    '\x1b[31mError: Direct local database deployment is disabled to prevent accidental production overrides.\x1b[0m\n' +
      'Deployments should be triggered via CI/CD by pushing to GitHub.\n' +
      'If you absolutely must deploy locally, set ALLOW_LOCAL_DEPLOY=true in your environment or .env file.\n',
  );
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '..', 'collection.sqlite');
if (!fs.existsSync(dbPath)) {
  console.error(
    'Error: collection.sqlite not found. Run node scripts/init_database.js first.',
  );
  process.exit(1);
}

const db = new Database(dbPath);

console.log(
  'Extracting SQLite parameters natively for Cloudflare synchronization...',
);
let sqlDump = 'PRAGMA foreign_keys = OFF;\n\n';

const tables = db
  .prepare("SELECT name, sql FROM sqlite_master WHERE type='table'")
  .all() as {
  name: string;
  sql: string;
}[];

for (const table of tables) {
  if (table.name === 'sqlite_sequence' || table.name.startsWith('_')) continue;

  // Dump Table Schema Generation
  sqlDump += `DROP TABLE IF EXISTS ${table.name};\n`;
  sqlDump += table.sql + ';\n';

  const rows = db.prepare(`SELECT * FROM ${table.name}`).all() as Record<
    string,
    unknown
  >[];

  // Optimised Transaction Batching
  if (rows.length > 0) {
    for (const row of rows) {
      const cols = Object.keys(row);
      const vals = Object.values(row).map((v) => {
        if (v === null) return 'NULL';
        if (typeof v === 'string') {
          // Escape single quotes for SQLite
          return `'${v.replace(/'/g, "''")}'`;
        }
        return v;
      });
      sqlDump += `INSERT INTO ${table.name} (${cols.join(', ')}) VALUES (${vals.join(', ')});\n`;
    }
  }
  sqlDump += '\n';
}

sqlDump += 'PRAGMA foreign_keys = ON;\n';

const outPath = path.join(__dirname, '..', 'deploy.sql');
fs.writeFileSync(outPath, sqlDump);
console.log(
  'Successfully generated deploy.sql! Initializing Cloudflare D1 sync...',
);

try {
  console.log('Pushing to Cloudflare D1 (collection-db)...');
  execSync(`wrangler d1 execute collection-db --remote --file=deploy.sql`, {
    stdio: 'inherit',
    shell: true as unknown as string,
  });
  console.log('Successfully synchronized database to Cloudflare!');
} catch (err) {
  console.error('Failed to sync database to Cloudflare:', err);
  process.exit(1);
}
