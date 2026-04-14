const Database = require('better-sqlite3');
const db = new Database('collection.sqlite');

console.log('--- Tables ---');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log(tables.map(t => t.name).join(', '));

for (const table of tables) {
    console.log(`\n--- Schema for ${table.name} ---`);
    const schema = db.prepare(`PRAGMA table_info(${table.name})`).all();
    console.log(schema);
}
