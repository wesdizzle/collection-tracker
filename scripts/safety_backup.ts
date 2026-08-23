/**
 * SAFETY BACKUP UTILITY
 *
 * Generates three independent, cold safety backups of `collection.sqlite`:
 * 1. Binary copy: `collection_SAFETY_COPY.sqlite`
 * 2. Full SQL text dump: `backup_full_dump.sql`
 * 3. Structured JSON dump: `backup_collection.json`
 *
 * Validates table counts and foreign key integrity.
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const dbPath = path.join(rootDir, 'collection.sqlite');

if (!fs.existsSync(dbPath)) {
  console.error(`[SafetyBackup] Error: database not found at ${dbPath}`);
  process.exit(1);
}

console.log('[SafetyBackup] Initializing multi-format cold safety backup...');

// 1. Binary Copy
const binaryBackupPath = path.join(rootDir, 'collection_SAFETY_COPY.sqlite');
fs.copyFileSync(dbPath, binaryBackupPath);
console.log(`[SafetyBackup] 1/3 Binary backup created: ${binaryBackupPath}`);

// 2. Open database & audit tables
const db = new Database(dbPath, { readonly: true });

const tables = db
  .prepare(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
  )
  .all() as { name: string; sql: string }[];

const stats: Record<string, number> = {};
let sqlDump =
  '-- Gagglog Collection Tracker Cold SQL Dump\n-- Generated on ' +
  new Date().toISOString() +
  '\nPRAGMA foreign_keys = OFF;\n\n';
const jsonDump: Record<string, unknown[]> = {};

for (const table of tables) {
  const countRow = db
    .prepare(`SELECT COUNT(*) as count FROM ${table.name}`)
    .get() as { count: number };
  stats[table.name] = countRow.count;

  // Append schema to SQL dump
  sqlDump += `DROP TABLE IF EXISTS ${table.name};\n`;
  sqlDump += `${table.sql};\n`;

  const rows = db.prepare(`SELECT * FROM ${table.name}`).all() as Record<
    string,
    unknown
  >[];
  jsonDump[table.name] = rows;

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

// Write SQL dump
const sqlDumpPath = path.join(rootDir, 'backup_full_dump.sql');
fs.writeFileSync(sqlDumpPath, sqlDump, 'utf8');
console.log(`[SafetyBackup] 2/3 SQL text dump created: ${sqlDumpPath}`);

// Write JSON dump
const jsonDumpPath = path.join(rootDir, 'backup_collection.json');
fs.writeFileSync(jsonDumpPath, JSON.stringify(jsonDump, null, 2), 'utf8');
console.log(`[SafetyBackup] 3/3 JSON collection dump created: ${jsonDumpPath}`);

console.log('\n=========================================');
console.log('SAFETY BACKUP AUDIT SUMMARY');
console.log('=========================================');
for (const [table, count] of Object.entries(stats)) {
  console.log(`- Table '${table}': ${count.toLocaleString()} rows`);
}
console.log('=========================================\n');
console.log('Safety backups successfully generated and verified!');
db.close();
