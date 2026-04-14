const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const dbPath = path.join(__dirname, '..', 'collection.sqlite');
if (!fs.existsSync(dbPath)) {
    console.error('Error: collection.sqlite not found. Run node scripts/init_database.js first.');
    process.exit(1);
}

const db = new Database(dbPath);

console.log('Extracting SQLite parameters natively for Cloudflare synchronization...');
let sqlDump = 'PRAGMA foreign_keys = OFF;\n\n';

const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'").all();

for (const table of tables) {
    if (table.name === 'sqlite_sequence' || table.name.startsWith('_')) continue;
    
    // Dump Table Schema Generation
    sqlDump += `DROP TABLE IF EXISTS ${table.name};\n`;
    sqlDump += table.sql + ';\n';
    
    const rows = db.prepare(`SELECT * FROM ${table.name}`).all();
    
    // Optimised Transaction Batching
    if (rows.length > 0) {
        for (const row of rows) {
            let cols = Object.keys(row);
            let vals = Object.values(row).map(v => {
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
console.log('Successfully generated deploy.sql! Initializing Cloudflare D1 sync...');

try {
    console.log('Pushing to Cloudflare D1 (collection-db)...');
    // Using npx with shell:true to handle Windows/Unix differences correctly
    execSync('npx wrangler d1 execute collection-db --remote --file=deploy.sql', { 
        stdio: 'inherit',
        shell: true 
    });
    console.log('Successfully synchronized database to Cloudflare!');
} catch (error) {
    console.error('Failed to sync database to Cloudflare.');
    process.exit(1);
}
