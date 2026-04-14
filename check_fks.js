const Database = require('better-sqlite3');
const db = new Database('collection.sqlite');

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
for (const t of tables) {
    const fks = db.prepare(`PRAGMA foreign_key_list(${t.name})`).all();
    if (fks.length > 0) {
        const platformFks = fks.filter(fk => fk.table === 'platforms');
        if (platformFks.length > 0) {
            console.log(`Table '${t.name}' has foreign keys to platforms:`, platformFks);
        }
    }
}
