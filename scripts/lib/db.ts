/**
 * CENTRALIZED LOCAL DATABASE RESOLUTION
 *
 * Directs all local scripts, tooling, and servers directly to Cloudflare Wrangler's
 * local D1 SQLite database located in `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/`.
 *
 * Eliminates dual-database drift and file copying corruption.
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

let cachedD1Path: string | null = null;

export function getLocalD1Path(): string {
  if (cachedD1Path && fs.existsSync(cachedD1Path)) {
    return cachedD1Path;
  }

  const rootDir = process.cwd();
  const d1StateDir = path.join(
    rootDir,
    '.wrangler',
    'state',
    'v3',
    'd1',
    'miniflare-D1DatabaseObject',
  );

  if (fs.existsSync(d1StateDir)) {
    const items = fs.readdirSync(d1StateDir);
    const candidates = items
      .filter(
        (item) => item.endsWith('.sqlite') && !item.startsWith('metadata'),
      )
      .map((item) => {
        const fullPath = path.join(d1StateDir, item);
        return { path: fullPath, size: fs.statSync(fullPath).size };
      })
      .filter((c) => c.size > 0)
      .sort((a, b) => b.size - a.size);

    if (candidates.length > 0) {
      cachedD1Path = candidates[0].path;
      return cachedD1Path;
    }
  }

  // Fallback to predictable path
  if (!fs.existsSync(d1StateDir)) {
    fs.mkdirSync(d1StateDir, { recursive: true });
  }
  const fallback = path.join(
    d1StateDir,
    '169f8be8b215c89203fa79284f81f610be46edc169f8d19359d676b5963cb1eb.sqlite',
  );
  cachedD1Path = fallback;
  return fallback;
}

export function getDatabase(options?: Database.Options): Database.Database {
  const dbPath = getLocalD1Path();
  const db = new Database(dbPath, options);
  // Ensure WAL mode is active for safe concurrent multi-process access
  if (!options?.readonly) {
    db.pragma('journal_mode = WAL');
  }
  return db;
}
