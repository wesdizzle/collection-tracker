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

// The source database we work with in the root folder
const sourcePath = 'collection.sqlite';
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
 * We run a 'dry-run' of wrangler dev to force it to create the folder structure
 * without actually starting the server.
 */
if (!fs.existsSync(d1StateDir)) {
    console.log('Wrangler state directory not found. Starting wrangler briefly to initialize...');
    try {
        const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
        execSync(`${cmd} wrangler dev --local --dry-run`, { stdio: 'ignore' });
    } catch (e) {
        // Ignored, we check for the folder again below
    }
}

if (!fs.existsSync(d1StateDir)) {
    console.error('Error: Could not find or initialize Wrangler D1 state directory.');
    process.exit(1);
}

/**
 * FILE IDENTIFICATION:
 * Wrangler generates a random hash for each database ID in your wrangler.toml.
 * We look for all .sqlite files but EXCLUDE 'metadata.sqlite' which Wrangler
 * uses for internal tracking (not actual user data).
 */
const files = fs.readdirSync(d1StateDir);
const d1Files = files.filter(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite');

if (d1Files.length === 0) {
    console.warn('No active D1 sqlite file found. Please run "node scripts/dev.ts" (via tsx) once, stop it, and try again.');
    process.exit(1);
}

console.log(`Found ${d1Files.length} potential D1 database(s). Synchronizing...`);

/**
 * SYNCHRONIZATION:
 * We use a simple file-level copy (copyFileSync). This is more efficient than
 * SQL dumps for local development and ensures that the local D1 instance 
 * is a bit-for-bit match of your working source database.
 */
for (const d1File of d1Files) {
    const targetPath = path.join(d1StateDir, d1File);
    console.log(`Copying ${sourcePath} to ${targetPath}...`);
    fs.copyFileSync(sourcePath, targetPath);
}

console.log('\nSUCCESS: Local D1 is now 100% synchronized with collection.sqlite.');
console.log('You can now run: npm run dev');
