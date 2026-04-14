const Database = require('better-sqlite3');
const { PLATFORM_MAP, queryIGDB } = require('./lib/igdb');
const db = new Database('collection.sqlite');

async function fix() {
    console.log('Fixing Platforms and Linking Games...');
    db.prepare('PRAGMA foreign_keys = OFF').run();

    // 1. Get all current games and their unique platform strings
    const currentGames = db.prepare('SELECT platform, COUNT(*) as count FROM games GROUP BY platform').all();
    console.log(`Found ${currentGames.length} unique platform strings in games.`);

    // 2. Fetch Metadata for all mapped IDs
    const igdbIds = [...new Set(Object.values(PLATFORM_MAP))];
    console.log(`Fetching metadata for ${igdbIds.length} IGDB platform IDs...`);
    const metadata = await queryIGDB('platforms', `fields id, name, summary, updated_at; where id = (${igdbIds.join(',')}); limit 500;`);
    const metadataMap = {};
    metadata.forEach(m => metadataMap[m.id] = m);

    // 3. Rebuild the platforms table content
    // We'll keep existing IDs if possible, but let's just make sure mapped ones are correct.
    db.transaction(() => {
        // Clear mapped ones to avoid overlaps
        db.prepare('UPDATE platforms SET igdb_id = NULL').run();

        for (const [localName, id] of Object.entries(PLATFORM_MAP)) {
            const meta = metadataMap[id];
            const canonicalName = meta ? meta.name : localName;
            const description = meta ? meta.summary : null;
            
            // Upsert based on IGDB ID
            db.prepare(`
                INSERT INTO platforms (name, igdb_id, display_name, description)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(igdb_id) DO UPDATE SET
                    name = excluded.name,
                    description = excluded.description
            `).run(canonicalName, id, localName, description);
        }

        // Apply display_name overrides
        db.prepare('UPDATE platforms SET display_name = ? WHERE igdb_id = ?').run('Sega Genesis', 29);
        db.prepare('UPDATE platforms SET display_name = ? WHERE igdb_id = ?').run('Xbox Series X', 169);

        // Apply parentings (Accessories)
        // PSVR (165) -> PS4 (48), PSVR2 (390) -> PS5 (167)
        db.prepare('UPDATE platforms SET parent_platform_id = (SELECT id FROM platforms WHERE igdb_id = 48) WHERE igdb_id = 165').run();
        db.prepare('UPDATE platforms SET parent_platform_id = (SELECT id FROM platforms WHERE igdb_id = 167) WHERE igdb_id = 390').run();
    })();

    // 4. Link Games
    console.log('Linking games to platforms...');
    db.transaction(() => {
        // Reset links
        db.prepare('UPDATE games SET platform_id = NULL').run();

        // Match by platform name OR display_name
        for (const row of currentGames) {
            const platformStr = row.platform;
            const platformIdRow = db.prepare(`
                SELECT id FROM platforms 
                WHERE name = ? OR display_name = ? 
                LIMIT 1
            `).get(platformStr, platformStr);

            if (platformIdRow) {
                db.prepare('UPDATE games SET platform_id = ? WHERE platform = ?').run(platformIdRow.id, platformStr);
            } else {
                console.warn(`  Could not find platform record for "${platformStr}"`);
            }
        }
    })();

    const missing = db.prepare('SELECT COUNT(*) as count FROM games WHERE platform_id IS NULL').get().count;
    console.log(`Linking complete. ${missing} games still without platform_id.`);
    
    db.prepare('PRAGMA foreign_keys = ON').run();
}

fix().catch(err => {
    console.error('Fix failed:', err);
    process.exit(1);
});
