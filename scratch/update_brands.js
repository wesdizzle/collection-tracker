const db = require('better-sqlite3')('collection.sqlite');
db.prepare("UPDATE platforms SET brand = 'Atari' WHERE name IN ('Atari 2600', 'Atari 5200', 'Atari 7800')").run();
db.prepare("UPDATE platforms SET brand = 'Nintendo' WHERE name = 'Nintendo GameCube'").run();
console.log('Platforms updated.');
