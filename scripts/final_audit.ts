import Database from 'better-sqlite3';

const db = new Database('collection.sqlite');

function finalAudit() {
    console.log('--- FINAL AUDIT: Castlevania NES ---');
    const row = db.prepare(`
        SELECT g.stable_id, g.id as slug, g.title, g.igdb_id, g.image_url 
        FROM games g
        JOIN platforms p ON g.platform_id = p.id
        WHERE g.title = 'Castlevania' AND p.igdb_id = 18
    `).get();
    
    console.log(JSON.stringify(row, null, 2));
}

finalAudit();
