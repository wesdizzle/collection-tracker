/**
 * DATABASE SYNCHRONIZATION SCRIPT (TS)
 * 
 * This script ensures that the local Wrangler D1 environment has the same 
 * data as your source-of-truth 'collection.sqlite'. It finds the hidden 
 * SQLite files that Wrangler/Miniflare uses and overwrites them with your data.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';

// The source database we work with in the root folder
const sourcePath = 'collection.sqlite';

console.log('--- Phase 0: Checkpointing SQLite ---');
const db = new Database(sourcePath);
db.pragma('wal_checkpoint(FULL)');
db.close();
console.log('Checkpoint complete. WAL merged into main file.');

// The internal folder where Wrangler stores local persistence
const d1StateDir = path.join('.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');

console.log('--- Phase 1: Locating Wrangler Local D1 ---');

// Guard: Ensure source exists
if (!fs.existsSync(sourcePath)) {
    console.error(`Error: ${sourcePath} not found.`);
    process.exit(1);
}

/**
 * INITIALIZATION TRICK:
 * If the user has never run wrangler dev, the state directory won't exist.
 * We run a dummy query to force it to create the folder structure.
 */
if (!fs.existsSync(d1StateDir)) {
    console.log('Wrangler state directory not found. Initializing with a dummy query...');
    try {
        const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        execSync(`${cmd} wrangler d1 execute collection-db --command="SELECT 1;" --local`, { stdio: 'ignore', shell: true } as any);
    } catch {
        // Ignored
    }
}

if (!fs.existsSync(d1StateDir)) {
    console.error('Error: Could not find or initialize Wrangler D1 state directory.');
    process.exit(1);
}

/**
 * FILE IDENTIFICATION:
 * Wrangler generates a random hash for each database ID in your wrangler.toml.
 * We look for all .sqlite files but EXCLUDE 'metadata.sqlite'.
 */
const items = fs.readdirSync(d1StateDir);
const d1Targets: string[] = [];

for (const item of items) {
    const fullPath = path.join(d1StateDir, item);
    const stats = fs.statSync(fullPath);

    if (stats.isDirectory()) {
        // Modern Wrangler structure: hash.sqlite/db.sqlite
        // In some versions, the database is inside a directory named after the hash.
        const nestedFiles = fs.readdirSync(fullPath);
        for (const nested of nestedFiles) {
            if (nested.endsWith('.sqlite')) {
                d1Targets.push(path.join(fullPath, nested));
            }
        }
    } else if (item.endsWith('.sqlite') && !item.startsWith('metadata')) {
        // Legacy/Traditional structure: hash.sqlite is the file.
        d1Targets.push(fullPath);
    }
}

if (d1Targets.length === 0) {
    console.warn('No active D1 sqlite targets found. Please run "npm run dev" once, stop it, and try again.');
    process.exit(1);
}

console.log(`Found ${d1Targets.length} potential D1 database target(s). Synchronizing...`);

/**
 * SYNCHRONIZATION:
 * We perform a file-level copy.
 */
for (const targetPath of d1Targets) {
    // 1. Create a backup of the existing D1 state if it exists
    try {
        const backupDir = path.join(process.cwd(), 'backups');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const dbName = path.basename(targetPath, '.sqlite');
        const backupPath = path.join(backupDir, `${dbName}_${timestamp}.sqlite.bak`);
        
        fs.copyFileSync(targetPath, backupPath);
        console.log(`[Backup] Saved existing D1 state to: ${path.relative(process.cwd(), backupPath)}`);
    } catch (e) {
        console.warn(`[Backup] Failed to create backup of ${targetPath}:`, e);
    }

    // 2. Perform the synchronization
    fs.copyFileSync(sourcePath, targetPath);
}

console.log('\nSUCCESS: Local D1 is now 100% synchronized with collection.sqlite.');
console.log('You can now run: npm run dev');
