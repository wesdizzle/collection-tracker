import Database from 'better-sqlite3';

const db = new Database('collection.sqlite');

function auditCastlevania() {
    console.log('--- AUDIT: Castlevania Records ---');
    const rows = db.prepare(`
        SELECT g.stable_id, g.id as slug, g.title, g.igdb_id, g.image_url, p.name as platform_name, p.igdb_id as platform_igdb_id
        FROM games g
        JOIN platforms p ON g.platform_id = p.id
        WHERE g.title LIKE 'Castlevania%'
    `).all();
    
    console.table(rows);
    
    console.log('\n--- AUDIT: Recent Duplicates or Clashes ---');
    const clashingSlugs = db.prepare(`
        SELECT id, COUNT(*) as count 
        FROM games 
        GROUP BY id 
        HAVING count > 1
    `).all();
    console.log('Duplicate Slugs (Should be 0):', clashingSlugs.length);
    if (clashingSlugs.length > 0) console.table(clashingSlugs);
}

auditCastlevania();
