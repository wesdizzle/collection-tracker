const Database = require('better-sqlite3');
const { PLATFORM_MAP, queryIGDB } = require('./lib/igdb');
const db = new Database('collection.sqlite');

async function migrate() {
    console.log('Starting Migration V3 (Table Rebuild): ID-Based Joins...');

    // 0. Disable Foreign Keys
    db.prepare('PRAGMA foreign_keys = OFF').run();

    // 1. Create the NEW platforms table
    // We remove the UNIQUE constraint on 'name' and use 'igdb_id' as the primary unique key
    db.prepare('BEGIN TRANSACTION').run();
    try {
        db.prepare(`
            CREATE TABLE platforms_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                igdb_id INTEGER UNIQUE,
                display_name TEXT,
                parent_platform_id INTEGER,
                brand TEXT,
                launch_date DATE,
                image_url TEXT,
                description TEXT
            )
        `).run();

        // 2. Initial data copy (copying what we can)
        // We match by name for the first pass
        db.prepare(`
            INSERT INTO platforms_new (id, name, brand, launch_date, image_url, description)
            SELECT id, name, brand, launch_date, image_url, description FROM platforms
        `).run();

        // 3. Assign IGDB IDs from PLATFORM_MAP
        const updateIgdbId = db.prepare('UPDATE platforms_new SET igdb_id = ? WHERE name = ?');
        for (const [name, id] of Object.entries(PLATFORM_MAP)) {
            updateIgdbId.run(id, name);
        }

        // 4. Assign display_name default (use name if not set)
        db.prepare('UPDATE platforms_new SET display_name = name WHERE display_name IS NULL').run();

        // 5. Finalize table swap
        db.prepare('DROP TABLE platforms').run();
        db.prepare('ALTER TABLE platforms_new RENAME TO platforms').run();
        db.prepare('CREATE UNIQUE INDEX idx_platforms_igdb_id ON platforms(igdb_id)').run();
        
        db.prepare('COMMIT').run();
        console.log('Platforms table rebuilt successfully.');
    } catch (e) {
        db.prepare('ROLLBACK').run();
        console.error('Rebuild failed, rolled back:', e);
        throw e;
    }

    // 6. Ensure column existence in games/figures
    const gamesInfo = db.prepare('PRAGMA table_info(games)').all();
    const figuresInfo = db.prepare('PRAGMA table_info(figures)').all();
    if (!gamesInfo.some(c => c.name === 'platform_id')) db.prepare('ALTER TABLE games ADD COLUMN platform_id INTEGER').run();
    if (!figuresInfo.some(c => c.name === 'platform_id')) db.prepare('ALTER TABLE figures ADD COLUMN platform_id INTEGER').run();

    // 7. Resolve Merges (If multiple platforms have same igdb_id)
    console.log('Resolving platform merges...');
    const duplicates = db.prepare(`
        SELECT igdb_id, GROUP_CONCAT(name) as names, GROUP_CONCAT(id) as ids 
        FROM platforms WHERE igdb_id IS NOT NULL 
        GROUP BY igdb_id HAVING COUNT(*) > 1
    `).all();

    db.transaction(() => {
        for (const dup of duplicates) {
            const ids = dup.ids.split(',');
            const survivorId = ids[0];
            const survivorName = db.prepare('SELECT name FROM platforms WHERE id = ?').get(survivorId).name;
            const otherIds = ids.slice(1);

            for (const otherId of otherIds) {
                const otherName = db.prepare('SELECT name FROM platforms WHERE id = ?').get(otherId).name;
                console.log(`  Merging duplicate ${otherName} into ${survivorName} (ID: ${dup.igdb_id})`);
                db.prepare('UPDATE games SET platform = ? WHERE platform = ?').run(survivorName, otherName);
                db.prepare('DELETE FROM platforms WHERE id = ?').run(otherId);
            }
        }
    })();

    // 8. Fetch and Update Metadata from IGDB
    const igdbIds = [...new Set(Object.values(PLATFORM_MAP))];
    console.log(`Fetching metadata for ${igdbIds.length} official platforms...`);
    const metadata = await queryIGDB('platforms', `fields id, name, summary, updated_at; where id = (${igdbIds.join(',')}); limit 500;`);
    const metadataMap = {};
    metadata.forEach(m => metadataMap[m.id] = m);

    db.transaction(() => {
        for (const m of metadata) {
            db.prepare(`
                UPDATE platforms 
                SET name = ?, description = ? 
                WHERE igdb_id = ?
            `).run(m.name, m.summary, m.id);
        }

        // Apply naming overrides
        db.prepare('UPDATE platforms SET display_name = ? WHERE igdb_id = ?').run('Sega Genesis', 29);
        db.prepare('UPDATE platforms SET display_name = ? WHERE igdb_id = ?').run('Xbox Series X', 169);

        // Apply accessory groupings
        // PSVR (165) -> PS4 (48), PSVR2 (390) -> PS5 (167)
        db.prepare('UPDATE platforms SET parent_platform_id = ? WHERE igdb_id = ?').run(48, 165);
        db.prepare('UPDATE platforms SET parent_platform_id = ? WHERE igdb_id = ?').run(167, 390);
    })();

    // 9. Link Games and Figures via internal platforms.id
    console.log('Linking games and figures to platforms via stable IDs...');
    db.prepare(`
        UPDATE games
        SET platform_id = (
            SELECT id FROM platforms WHERE platforms.igdb_id = (
                SELECT igdb_id FROM (SELECT igdb_id, name, display_name FROM platforms) p 
                WHERE p.name = games.platform OR p.display_name = games.platform LIMIT 1
            )
        )
    `).run();

    db.prepare(`
        UPDATE figures
        SET platform_id = (
            SELECT id FROM platforms WHERE platforms.igdb_id = (
                SELECT igdb_id FROM (SELECT igdb_id, name, display_name FROM platforms) p 
                WHERE p.name = (SELECT line FROM figures f2 WHERE f2.id = figures.id) 
                   OR p.display_name = (SELECT line FROM figures f3 WHERE f3.id = figures.id) LIMIT 1
            )
        )
    `).run();

    db.prepare('PRAGMA foreign_keys = ON').run();
    console.log('Migration V3 Successful!');
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
