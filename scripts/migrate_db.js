const Database = require('better-sqlite3');
const db = new Database('collection.sqlite');

console.log('Starting Database Restructuring...');

db.exec('PRAGMA foreign_keys = OFF;');

try {
    db.transaction(() => {
        // 1. Unify platforms
        const platforms = db.prepare('SELECT * FROM platforms').all();
        const oldPs = platforms.filter(p => p.id <= 60);
        const newPs = platforms.filter(p => p.id > 60);
        const nameToIgdb = {};
        for (const np of newPs) { 
            if (np.igdb_id) nameToIgdb[np.display_name] = np.igdb_id; 
        }

        // Clear new igdb_ids to avoid unique collision during update
        db.prepare('UPDATE platforms SET igdb_id = NULL WHERE id > 60').run();

        for (const np of newPs) {
            const op = oldPs.find(o => o.display_name === np.display_name);
            if (op) {
                const igdbId = nameToIgdb[np.display_name];
                if (igdbId) {
                    db.prepare('UPDATE platforms SET igdb_id = ? WHERE id = ?').run(igdbId, op.id);
                }
                db.prepare('UPDATE games SET platform_id = ? WHERE platform_id = ?').run(op.id, np.id);
                db.prepare('DELETE FROM platforms WHERE id = ?').run(np.id);
            } else {
                // If no old equivalent, keep it but ensure it has its igdb_id if it had one
                const igdbId = nameToIgdb[np.display_name];
                if (igdbId) {
                    db.prepare('UPDATE platforms SET igdb_id = ? WHERE id = ?').run(igdbId, np.id);
                }
            }
        }

        // 2. Recreate games table with correct foreign key
        db.exec(`
            CREATE TABLE games_new (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                series TEXT,
                release_date DATE,
                platform TEXT,
                owned BOOLEAN,
                queued BOOLEAN,
                sort_index INTEGER,
                image_url TEXT,
                summary TEXT,
                region TEXT,
                platform_id INTEGER,
                igdb_id INTEGER,
                FOREIGN KEY(platform_id) REFERENCES platforms(id)
            )
        `);

        db.exec(`
            INSERT INTO games_new (id, title, series, release_date, platform, owned, queued, sort_index, image_url, summary, region, platform_id, igdb_id)
            SELECT id, title, series, release_date, platform, owned, queued, sort_index, image_url, summary, region, platform_id, igdb_id FROM games
        `);

        db.exec('DROP TABLE games');
        db.exec('ALTER TABLE games_new RENAME TO games');
        
        // 3. Clear regions for re-verification to get correct matches
        db.prepare('UPDATE games SET region = NULL').run();
        
        console.log('Transaction successful.');
    })();
} catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
} finally {
    db.exec('PRAGMA foreign_keys = ON;');
}

console.log('Database restructured, platforms unified, and regions reset.');
