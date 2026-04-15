const fs = require('fs');
const path = require('path');

const sourcePath = 'collection.sqlite';
const d1StateDir = path.join('.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');

console.log('--- Phase 1: Locating Wrangler Local D1 ---');

if (!fs.existsSync(sourcePath)) {
    console.error(`Error: ${sourcePath} not found.`);
    process.exit(1);
}

if (!fs.existsSync(d1StateDir)) {
    console.log('Wrangler state directory not found. Starting wrangler briefly to initialize...');
    // This is safe because we just need the folder structure
    try {
        const { execSync } = require('child_process');
        execSync('npx wrangler dev --local --dry-run', { stdio: 'ignore' });
    } catch (e) {}
}

if (!fs.existsSync(d1StateDir)) {
    console.error('Error: Could not find or initialize Wrangler D1 state directory.');
    process.exit(1);
}

// Find all .sqlite files in the directory
const files = fs.readdirSync(d1StateDir);
const d1Files = files.filter(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite');

if (d1Files.length === 0) {
    console.warn('No active D1 sqlite file found. Please run "npx wrangler dev --local" once manually, then stop it and run this script again.');
    process.exit(1);
}

console.log(`Found ${d1Files.length} potential D1 database(s). Synchronizing...`);

for (const d1File of d1Files) {
    const targetPath = path.join(d1StateDir, d1File);
    console.log(`Copying ${sourcePath} to ${targetPath}...`);
    fs.copyFileSync(sourcePath, targetPath);
}

console.log('\nSUCCESS: Local D1 is now 100% synchronized with collection.sqlite.');
console.log('You can now run: npm run dev');
