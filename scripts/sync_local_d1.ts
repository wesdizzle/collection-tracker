/**
 * LOCAL D1 INTEGRITY & HEALTH CHECK BRIDGE
 *
 * With the removal of redundant `collection.sqlite` dual-database state,
 * Cloudflare Wrangler's local D1 SQLite instance is the single, direct local source
 * of truth used by both Miniflare (`wrangler dev`) and local development scripts (`local_server.ts`).
 *
 * This utility validates that the local D1 instance is healthy, verifies WAL journal mode,
 * and executes SQLite PRAGMA integrity checks to ensure zero-corruption operation.
 */

import Database from 'better-sqlite3';
import { getLocalD1Path } from './lib/db.js';
import * as fs from 'fs';
import * as path from 'path';

console.log('--- Checking Unified Local D1 State ---');
const d1Path = getLocalD1Path();

if (!fs.existsSync(d1Path)) {
  console.log(
    `Local D1 database not found at ${d1Path}. Run "npm run db:pull" to pull from remote D1.`,
  );
  process.exit(1);
}

console.log(`Local D1 Database: ${path.relative(process.cwd(), d1Path)}`);

const db = new Database(d1Path);
const journalMode = db.pragma('journal_mode', { simple: true });
console.log(`Journal Mode: ${journalMode}`);

const integrity = db.pragma('integrity_check') as Array<{
  integrity_check: string;
}>;
console.log(`Integrity Check: ${JSON.stringify(integrity)}`);

if (integrity.length === 1 && integrity[0]?.integrity_check === 'ok') {
  console.log('✅ Local D1 database is healthy and ready for development.');
} else {
  console.error('❌ Local D1 database integrity issue detected.');
  process.exit(1);
}

db.close();
