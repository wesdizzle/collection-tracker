import Database from 'better-sqlite3';

const db = new Database('collection.sqlite');

function deduplicatePlatforms() {
    console.log('--- Starting Platform Deduplication ---');
    
    // 1. Find all duplicate platform names
    const duplicates = db.prepare('SELECT name FROM platforms GROUP BY name HAVING COUNT(*) > 1').all() as { name: string }[];
    
    console.log(`Found ${duplicates.length} duplicate platform names to reconcile.`);
    
    db.transaction(() => {
        for (const { name } of duplicates) {
            // Get all instances of this name
            const instances = db.prepare('SELECT id, igdb_id, launch_date FROM platforms WHERE name = ? ORDER BY id ASC').all(name) as any[];
            
            // Keep the first one as the master
            const master = instances[0];
            const toDelete = instances.slice(1);
            
            // Update the master with any missing metadata from others
            for (const other of toDelete) {
                if (!master.igdb_id && other.igdb_id) master.igdb_id = other.igdb_id;
                if (!master.launch_date && other.launch_date) master.launch_date = other.launch_date;
            }
            
            db.prepare('UPDATE platforms SET igdb_id = ?, launch_date = ? WHERE id = ?').run(master.igdb_id, master.launch_date, master.id);
            
            // Re-point all games from the old platforms to the master
            for (const other of toDelete) {
                const updatedGames = db.prepare('UPDATE games SET platform_id = ? WHERE platform_id = ?').run(master.id, other.id);
                console.log(`  Merged ${name} (ID: ${other.id} -> ${master.id}): Updated ${updatedGames.changes} games.`);
                db.prepare('DELETE FROM platforms WHERE id = ?').run(other.id);
            }
        }
    })();
    
    console.log('--- Deduplication Complete ---');
}

deduplicatePlatforms();
