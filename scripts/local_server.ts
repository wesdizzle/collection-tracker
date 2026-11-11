/**
 * LOCAL DEVELOPMENT API & DISCOVERY SERVER (TS)
 *
 * Thin Node.js HTTP wrapper around the Cloudflare Worker (`worker/worker.ts`)
 * backed by a `better-sqlite3` D1Database-compatible adapter over the unified
 * local D1 SQLite database.
 *
 * Delegating all route handling to `worker.fetch()` guarantees 100% behavioral
 * parity between `npm run dev` (`local_server.ts`) and production (`worker.ts`).
 */

import 'dotenv/config';
import * as http from 'http';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import worker, { Env, invalidateSeriesScanCache } from '../worker/worker.js';
import { recomputeCanonicalSeries } from './compute_canonical_series.js';
import { getDatabase } from './lib/db.js';

export const PORT = Number(process.env['PORT'] || 3000);
export const HOST = process.env['HOST'] || '127.0.0.1';

const initializedDatabases = new WeakSet<Database.Database>();

/**
 * Ensures multi-user and auxiliary tables exist on the target SQLite database
 * (including in-memory unit test databases) and installs lightweight triggers
 * so legacy single-user columns (`game_releases.ownership_status`, `games.play_status`,
 * `toys.ownership_status`) stay bidirectionally synchronized with `user_*` tables
 * for the default local admin user (`user_id = 1`).
 */
function ensureLocalSchemaAndSync(db: Database.Database): void {
  if (initializedDatabases.has(db)) {
    return;
  }
  initializedDatabases.add(db);
  invalidateSeriesScanCache();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      is_public INTEGER NOT NULL DEFAULT 0,
      home_region TEXT NOT NULL DEFAULT 'USA',
      display_name TEXT,
      bio TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    INSERT OR IGNORE INTO users (id, username, is_public, home_region, display_name)
    VALUES (1, 'wesley', 1, 'USA', 'Wesley');

    CREATE TABLE IF NOT EXISTS user_games (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game_id INTEGER NOT NULL REFERENCES games(stable_id) ON DELETE CASCADE,
      play_status INTEGER NOT NULL DEFAULT 0,
      queued BOOLEAN NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, game_id)
    );

    CREATE TABLE IF NOT EXISTS user_game_releases (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      release_id TEXT NOT NULL REFERENCES game_releases(id) ON DELETE CASCADE,
      ownership_status INTEGER NOT NULL DEFAULT 0,
      backup_status INTEGER NOT NULL DEFAULT 0,
      has_case INTEGER NOT NULL DEFAULT 0,
      has_manual INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, release_id)
    );

    CREATE TABLE IF NOT EXISTS user_toys (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      toy_id TEXT NOT NULL REFERENCES toys(id) ON DELETE CASCADE,
      ownership_status INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, toy_id)
    );

    CREATE TABLE IF NOT EXISTS toy_series (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      line TEXT NOT NULL,
      sort_index INTEGER
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      preferences_json TEXT NOT NULL DEFAULT '{}',
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cron_execution_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_name TEXT NOT NULL,
      status TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      summary TEXT,
      details_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS journal_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id) ON DELETE CASCADE,
      item_type TEXT NOT NULL CHECK(item_type IN ('game', 'toy')),
      item_id TEXT NOT NULL,
      purchase_date TEXT,
      is_approximate_date INTEGER NOT NULL DEFAULT 0,
      price_paid REAL,
      merchant TEXT,
      gifted_by TEXT,
      receipt_url TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, item_type, item_id)
    );
  `);

  const releaseCols = new Set(
    (
      db.prepare('PRAGMA table_info(game_releases)').all() as Array<{
        name: string;
      }>
    ).map((c) => c.name),
  );
  if (releaseCols.has('ownership_status') && releaseCols.has('backup_status')) {
    const hasCaseExpr = releaseCols.has('has_case') ? 'has_case' : '0';
    const hasManualExpr = releaseCols.has('has_manual') ? 'has_manual' : '0';
    db.exec(`
      INSERT OR IGNORE INTO user_game_releases (user_id, release_id, ownership_status, backup_status, has_case, has_manual)
      SELECT 1, id, COALESCE(ownership_status, 0), COALESCE(backup_status, 0), COALESCE(${hasCaseExpr}, 0), COALESCE(${hasManualExpr}, 0)
      FROM game_releases
      WHERE COALESCE(ownership_status, 0) > 0 OR COALESCE(backup_status, 0) > 0;

      CREATE TRIGGER IF NOT EXISTS trg_local_sync_gr_after_insert
      AFTER INSERT ON game_releases
      WHEN COALESCE(NEW.ownership_status, 0) > 0 OR COALESCE(NEW.backup_status, 0) > 0
      BEGIN
        INSERT INTO user_game_releases (user_id, release_id, ownership_status, backup_status, has_case, has_manual)
        VALUES (1, NEW.id, COALESCE(NEW.ownership_status, 0), COALESCE(NEW.backup_status, 0), COALESCE(NEW.${hasCaseExpr}, 0), COALESCE(NEW.${hasManualExpr}, 0))
        ON CONFLICT(user_id, release_id) DO UPDATE SET
          ownership_status = excluded.ownership_status,
          backup_status = excluded.backup_status,
          has_case = excluded.has_case,
          has_manual = excluded.has_manual;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_local_sync_ugr_after_insert
      AFTER INSERT ON user_game_releases
      WHEN NEW.user_id = 1
      BEGIN
        UPDATE game_releases
        SET ownership_status = NEW.ownership_status,
            backup_status = NEW.backup_status
        WHERE id = NEW.release_id;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_local_sync_ugr_after_update
      AFTER UPDATE ON user_game_releases
      WHEN NEW.user_id = 1
      BEGIN
        UPDATE game_releases
        SET ownership_status = NEW.ownership_status,
            backup_status = NEW.backup_status
        WHERE id = NEW.release_id;
      END;
    `);
  }

  const gameCols = new Set(
    (
      db.prepare('PRAGMA table_info(games)').all() as Array<{ name: string }>
    ).map((c) => c.name),
  );
  if (gameCols.has('play_status')) {
    db.exec(`
      INSERT OR IGNORE INTO user_games (user_id, game_id, play_status, queued)
      SELECT 1, stable_id, COALESCE(CAST(play_status AS INTEGER), 0), COALESCE(queued, 0)
      FROM games
      WHERE COALESCE(CAST(play_status AS INTEGER), 0) > 0 OR COALESCE(queued, 0) > 0;

      CREATE TRIGGER IF NOT EXISTS trg_local_sync_ug_after_insert
      AFTER INSERT ON user_games
      WHEN NEW.user_id = 1
      BEGIN
        UPDATE games
        SET play_status = NEW.play_status,
            queued = NEW.queued
        WHERE stable_id = NEW.game_id;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_local_sync_ug_after_update
      AFTER UPDATE ON user_games
      WHEN NEW.user_id = 1
      BEGIN
        UPDATE games
        SET play_status = NEW.play_status,
            queued = NEW.queued
        WHERE stable_id = NEW.game_id;
      END;
    `);
  }

  const toyCols = new Set(
    (
      db.prepare('PRAGMA table_info(toys)').all() as Array<{ name: string }>
    ).map((c) => c.name),
  );
  if (toyCols.has('ownership_status')) {
    db.exec(`
      INSERT OR IGNORE INTO user_toys (user_id, toy_id, ownership_status)
      SELECT 1, id, COALESCE(ownership_status, 0)
      FROM toys
      WHERE id IS NOT NULL AND COALESCE(ownership_status, 0) > 0;

      CREATE TRIGGER IF NOT EXISTS trg_local_sync_ut_after_insert
      AFTER INSERT ON user_toys
      WHEN NEW.user_id = 1
      BEGIN
        UPDATE toys
        SET ownership_status = NEW.ownership_status
        WHERE id = NEW.toy_id;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_local_sync_ut_after_update
      AFTER UPDATE ON user_toys
      WHEN NEW.user_id = 1
      BEGIN
        UPDATE toys
        SET ownership_status = NEW.ownership_status
        WHERE id = NEW.toy_id;
      END;
    `);
  }
}

function normalizeSqliteParam(val: unknown): unknown {
  if (val === undefined) return null;
  if (typeof val === 'boolean') return val ? 1 : 0;
  return val;
}

/**
 * Wraps a synchronous `better-sqlite3` Database instance in a Cloudflare
 * `D1Database`-compatible async interface so `worker/worker.ts` can execute
 * directly against local SQLite without duplicating route handlers.
 */
export function createLocalD1Adapter(db: Database.Database): D1Database {
  ensureLocalSchemaAndSync(db);

  const createStatement = (
    query: string,
    boundParams: unknown[] = [],
  ): D1PreparedStatement => {
    const normalizedParams = boundParams.map(normalizeSqliteParam);
    const statement: D1PreparedStatement = {
      bind: (...params: unknown[]) => createStatement(query, params),
      all: async <T = Record<string, unknown>>() => {
        const stmt = db.prepare(query);
        const results = (
          stmt.reader ? stmt.all(...normalizedParams) : []
        ) as T[];
        if (!stmt.reader) {
          stmt.run(...normalizedParams);
        }
        return {
          results,
          success: true,
          meta: {
            duration: 0,
            size_after: 0,
            rows_read: results.length,
            rows_written: 0,
            last_row_id: 0,
            changed_db: false,
            changes: 0,
          },
        };
      },
      first: async <T = unknown>(colName?: string): Promise<T | null> => {
        const stmt = db.prepare(query);
        const row = stmt.get(...normalizedParams) as
          | Record<string, unknown>
          | undefined;
        if (!row) return null;
        if (colName !== undefined) {
          return ((row[colName] as T) ?? null) as T | null;
        }
        return row as unknown as T;
      },
      run: async <T = Record<string, unknown>>() => {
        const info = db.prepare(query).run(...normalizedParams);
        return {
          results: [] as T[],
          success: true,
          meta: {
            duration: 0,
            size_after: 0,
            rows_read: 0,
            rows_written: info.changes,
            last_row_id: Number(info.lastInsertRowid || 0),
            changed_db: info.changes > 0,
            changes: info.changes,
          },
        };
      },
      raw: (async <T = unknown[]>(options?: { columnNames?: boolean }) => {
        const stmt = db.prepare(query);
        const rows = stmt.raw(true).all(...normalizedParams) as T[];
        if (options?.columnNames) {
          const cols = stmt.columns().map((c) => c.name);
          return [cols, ...rows];
        }
        return rows;
      }) as D1PreparedStatement['raw'],
    };
    return statement;
  };

  return {
    prepare: (query: string) => createStatement(query),
    batch: async <T = unknown>(
      statements: D1PreparedStatement[],
    ): Promise<D1Result<T>[]> => {
      const results: D1Result<T>[] = [];
      for (const stmt of statements) {
        const res = (await stmt.run()) as D1Result<T>;
        results.push(res);
      }
      return results;
    },
    exec: async (query: string): Promise<D1ExecResult> => {
      db.exec(query);
      return { count: 1, duration: 0 };
    },
    withSession: () => {
      throw new Error('D1 sessions are not supported in local adapter');
    },
    dump: async (): Promise<ArrayBuffer> => new ArrayBuffer(0),
  };
}

/**
 * CORE REQUEST HANDLER
 * Converts Node.js `http.IncomingMessage` into a Web `Request`, delegates to
 * `worker.fetch()`, and streams the Web `Response` back to `http.ServerResponse`.
 */
export const handleRequest = (db: Database.Database) => {
  const d1 = createLocalD1Adapter(db);

  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    // Enable cross-origin requests for the local Angular dev server (Port 4200)
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, DELETE, OPTIONS',
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Admin-Key',
    );

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      const method = req.method || 'GET';
      const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

      let bodyBuffer: Buffer | undefined;
      const hasBodyHeader = Boolean(
        req.headers?.['content-length'] ||
        req.headers?.['content-type'] ||
        req.headers?.['transfer-encoding'],
      );
      if (
        method !== 'GET' &&
        method !== 'HEAD' &&
        (method !== 'DELETE' || hasBodyHeader)
      ) {
        bodyBuffer = await new Promise<Buffer>((resolve, reject) => {
          const chunks: Buffer[] = [];
          req.on('data', (chunk) =>
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
          );
          req.on('end', () => resolve(Buffer.concat(chunks)));
          req.on('error', (err) => reject(err));
        });
      }

      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers || {})) {
        if (Array.isArray(value)) {
          for (const v of value) headers.append(key, v);
        } else if (typeof value === 'string') {
          headers.set(key, value);
        }
      }

      const webReq = new Request(url.toString(), {
        method,
        headers,
        body:
          bodyBuffer && bodyBuffer.length > 0
            ? new Uint8Array(bodyBuffer)
            : undefined,
      });

      const env: Env = {
        DB: d1,
        ASSETS: {
          fetch: async () =>
            new Response(JSON.stringify({ error: 'Not found' }), {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
            }),
        } as unknown as Fetcher,
        BACKUP_BUCKET: {
          put: async () => null,
          get: async () => null,
          list: async () => ({ objects: [] }),
          delete: async () => {},
        } as unknown as R2Bucket,
        TWITCH_CLIENT_ID:
          process.env['TWITCH_CLIENT_ID'] || 'local-dev-client-id',
        TWITCH_CLIENT_SECRET:
          process.env['TWITCH_CLIENT_SECRET'] || 'local-dev-client-secret',
        BESTBUY_API_KEY: process.env['BESTBUY_API_KEY'],
        VAPID_PUBLIC_KEY: process.env['VAPID_PUBLIC_KEY'],
        VAPID_PRIVATE_KEY:
          process.env['VAPID_PRIVATE_KEY'] || process.env['VAPID_PRIVATE_JWK'],
        ADMIN_KEY: process.env['ADMIN_KEY'],
        ADMIN_EMAIL: process.env['ADMIN_EMAIL'] || 'admin@example.com',
        DEV_AUTH_EMAIL: process.env['DEV_AUTH_EMAIL'] || 'admin@example.com',
        SESSION_SECRET:
          process.env['SESSION_SECRET'] ||
          'dev-insecure-session-secret-change-me',
        OIDC_ISSUER: process.env['OIDC_ISSUER'],
        OIDC_CLIENT_ID: process.env['OIDC_CLIENT_ID'] || 'collection-tracker',
        APP_REPO_URL: process.env['APP_REPO_URL'],
        APP_NAME: process.env['APP_NAME'],
        APP_SHORT_NAME: process.env['APP_SHORT_NAME'],
        APP_TAGLINE: process.env['APP_TAGLINE'],
        APP_AUTHOR: process.env['APP_AUTHOR'],
      };

      const ctx = {
        waitUntil: () => {},
        passThroughOnException: () => {},
      } as unknown as ExecutionContext;

      const webRes = await worker.fetch(webReq, env, ctx);

      if (
        method === 'POST' &&
        url.pathname === '/api/discovery/add' &&
        webRes.ok &&
        !process.env['VITEST']
      ) {
        try {
          await recomputeCanonicalSeries();
          db.pragma('wal_checkpoint(FULL)');
        } catch (postAddErr) {
          console.warn(
            '[LocalServer] Post-discovery series recompute warning:',
            postAddErr,
          );
        }
      }

      res.statusCode = webRes.status;
      webRes.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });
      res.setHeader('Access-Control-Allow-Origin', '*');

      const responseText = await webRes.text();
      res.end(responseText);
    } catch (err) {
      console.error('Server Error:', err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
  };
};

// Only start the server if this file is run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = getDatabase();
  const server = http.createServer(handleRequest(db));
  server.listen(PORT, HOST, () => {
    console.log(
      `Standalone Local API Server (unified Worker runtime) running at http://${HOST}:${PORT}`,
    );
  });
}
