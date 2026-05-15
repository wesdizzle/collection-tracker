import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'collection.sqlite');
const db = new Database(dbPath);

const row = db
  .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='games'")
  .get();
console.log(row.sql);
