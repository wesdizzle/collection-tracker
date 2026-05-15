import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'collection.sqlite');
const db = new Database(dbPath);

console.log('Renaming columns in games table...');
try {
  db.exec('ALTER TABLE games RENAME COLUMN owned TO ownership_status;');
  console.log('Renamed owned to ownership_status');
} catch (e) {
  console.log('owned already renamed?', e.message);
}

try {
  db.exec('ALTER TABLE games RENAME COLUMN played TO play_status;');
  console.log('Renamed played to play_status');
} catch (e) {
  console.log('played already renamed?', e.message);
}

try {
  db.exec('ALTER TABLE games RENAME COLUMN backed_up TO backup_status;');
  console.log('Renamed backed_up to backup_status');
} catch (e) {
  console.log('backed_up already renamed?', e.message);
}

console.log('Finished renaming columns in collection.sqlite');
