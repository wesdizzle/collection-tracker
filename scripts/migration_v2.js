const Database = require('better-sqlite3');
const db = new Database('collection.sqlite');

console.log('--- Starting Schema Migration (v2) ---');

function addColumnIfNotExists(table, column, type) {
    const info = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!info.some(c => c.name === column)) {
        console.log(`Adding column "${column}" to table "${table}"...`);
        db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
    } else {
        console.log(`Column "${column}" already exists in table "${table}".`);
    }
}

try {
    db.transaction(() => {
        addColumnIfNotExists('games', 'region', 'TEXT');
        addColumnIfNotExists('figures', 'region', 'TEXT');
    })();
    console.log('Migration Complete!');
} catch (error) {
    console.error('Migration Failed:', error.message);
    process.exit(1);
}
