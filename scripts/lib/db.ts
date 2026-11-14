import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

function findFileRecursively(dir: string, extension: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFileRecursively(fullPath, extension);
      if (found) return found;
    } else if (entry.name.endsWith(extension)) {
      return fullPath;
    }
  }
  return null;
}

/**
 * Resolves the active local SQLite database path:
 * 1. Explicit `COLLECTION_DB_PATH` environment variable override.
 * 2. Local Wrangler D1 SQLite database under `.wrangler/state/v3/d1` if initialized with schema.
 * 3. Local baseline clone at `data/remote_baseline.db`.
 */
export function resolveLocalDatabasePath(rootDir = process.cwd()): string {
  const envOverride = process.env['COLLECTION_DB_PATH']?.trim();
  if (envOverride && fs.existsSync(envOverride)) {
    return envOverride;
  }

  const d1Dir = path.join(rootDir, '.wrangler', 'state', 'v3', 'd1');
  const wranglerSqlite = findFileRecursively(d1Dir, '.sqlite');
  if (wranglerSqlite && fs.existsSync(wranglerSqlite)) {
    try {
      const probe = new Database(wranglerSqlite, { readonly: true });
      const hasPlatforms = probe
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='platforms'",
        )
        .get();
      probe.close();
      if (hasPlatforms) {
        return wranglerSqlite;
      }
    } catch {
      // Fall through to remote_baseline.db if Wrangler state is unreadable
    }
  }

  const baselineDb = path.join(rootDir, 'data', 'remote_baseline.db');
  if (fs.existsSync(baselineDb)) {
    return baselineDb;
  }

  if (wranglerSqlite) {
    return wranglerSqlite;
  }

  throw new Error(
    'Could not find a local SQLite database in .wrangler/state/v3/d1 or data/remote_baseline.db. Run npm run db:pull or initialize schema first.',
  );
}

/**
 * Connects to and returns the local SQLite database instance.
 */
export function getLocalDatabase(rootDir = process.cwd()): Database.Database {
  const dbPath = resolveLocalDatabasePath(rootDir);
  return new Database(dbPath);
}
