const Database = require('better-sqlite3');
const db = new Database('collection.sqlite');

console.log('Checking Atari platforms...');
const rows = db.prepare(`
    SELECT title, platform, image_url, summary 
    FROM games 
    WHERE platform IN ('Atari Video Computer System', 'Atari 2600', 'Atari 7800 ProSystem', 'Atari 7800')
    LIMIT 10
`).all();

console.log(JSON.stringify(rows, null, 2));

const missingMetadata = db.prepare(`
    SELECT count(*) as count 
    FROM games 
    WHERE platform IN ('Atari Video Computer System', 'Atari 2600', 'Atari 7800 ProSystem', 'Atari 7800')
    AND (image_url IS NULL OR summary IS NULL)
`).get();

console.log('Count missing metadata for these platforms:', missingMetadata.count);
