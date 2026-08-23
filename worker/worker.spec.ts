import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import worker, {
  Env,
  isAuthorizedAdmin,
  performScheduledBackup,
} from './worker';

/**
 * UNIT TEST: Cloudflare Worker Logic
 *
 * We mock the D1 binding and R2 bucket using in-memory SQLite and Map instances.
 * This allows us to verify SQL logic, auth guards, mutation endpoints, and backup logic cleanly.
 */

describe('Worker API Logic', () => {
  let db: Database.Database;
  let mockDb: {
    prepare: (query: string) => {
      bind: (...params: (string | number | null)[]) => {
        all: () => Promise<{ results: unknown[] }>;
        first: () => Promise<unknown>;
        run: () => Promise<{ success: boolean }>;
      };
      all: () => Promise<{ results: unknown[] }>;
      first: () => Promise<unknown>;
      run: () => Promise<{ success: boolean }>;
    };
    batch: (
      statements: { run: () => Promise<{ success: boolean }> }[],
    ) => Promise<unknown[]>;
  };
  let mockBucket: {
    storage: Map<string, string>;
    put: (key: string, data: string, options?: unknown) => Promise<unknown>;
    get: (key: string) => Promise<{ text: () => Promise<string> } | null>;
  };
  let mockEnv: Env;

  beforeEach(() => {
    // Initialize an in-memory database for clean, isolated tests
    db = new Database(':memory:');

    // Setup schema - matching canonical migration schema
    db.exec(`
      CREATE TABLE platforms (
        id INTEGER PRIMARY KEY, 
        name TEXT UNIQUE,
        display_name TEXT, 
        brand TEXT, 
        launch_date DATE, 
        parent_platform_id INTEGER,
        image_url TEXT
      );
      CREATE TABLE games (
        stable_id INTEGER PRIMARY KEY, 
        id TEXT, 
        title TEXT, 
        series TEXT, 
        canonical_series TEXT,
        platform_id INTEGER, 
        sort_index INTEGER,
        queued BOOLEAN,
        image_url TEXT,
        play_status INTEGER DEFAULT 0,
        backup_status INTEGER DEFAULT 0,
        igdb_id INTEGER,
        igdb_url TEXT,
        summary TEXT,
        genres TEXT,
        region TEXT,
        collections TEXT,
        franchises TEXT,
        manually_verified BOOLEAN,
        metadata_json TEXT
      );
      CREATE TABLE game_releases (
        id TEXT PRIMARY KEY,
        game_id INTEGER NOT NULL REFERENCES games(stable_id) ON DELETE CASCADE,
        region TEXT,
        variants TEXT,
        rom_name TEXT,
        rom_crc TEXT,
        backup_status INTEGER NOT NULL DEFAULT 0,
        ownership_status INTEGER NOT NULL DEFAULT 0,
        release_date DATE
      );
      CREATE TABLE toys (
        stable_id INTEGER PRIMARY KEY,
        id TEXT UNIQUE, 
        name TEXT, 
        line TEXT,
        series_id TEXT, 
        release_date DATE,
        sort_index INTEGER,
        series TEXT,
        type TEXT,
        ownership_status INTEGER DEFAULT 0,
        verified BOOLEAN DEFAULT 0,
        metadata_json TEXT,
        image_url TEXT
      );
      CREATE TABLE toy_series (
        id TEXT PRIMARY KEY, 
        name TEXT, 
        line TEXT,
        sort_index INTEGER
      );
      CREATE TABLE ignored_items (id TEXT PRIMARY KEY);
      CREATE TABLE toy_game_compatibility (
        toy_stable_id INTEGER,
        game_stable_id INTEGER,
        PRIMARY KEY (toy_stable_id, game_stable_id)
      );

      INSERT INTO platforms (id, name, display_name, brand, launch_date) VALUES (1, 'NES', 'NES', 'Nintendo', '1985-10-18');
      INSERT INTO games (stable_id, id, title, series, platform_id, sort_index) VALUES (1, 'mario', 'Super Mario Bros', 'Mario', 1, 0);
      INSERT INTO game_releases (id, game_id, region, variants, rom_name, rom_crc, backup_status, ownership_status, release_date) VALUES ('gb-mario', 1, 'USA', null, null, null, 0, 1, '1985-10-18');
      INSERT INTO toy_series (id, name, line, sort_index) VALUES ('smash', 'Smash', 'amiibo', 0);
      INSERT INTO toys (stable_id, id, name, line, series_id, sort_index, ownership_status) VALUES (1, 'link-amiibo', 'Link', 'amiibo', 'smash', 0, 0);
    `);

    // Mock the Cloudflare D1 interface
    mockDb = {
      prepare: (query: string) => ({
        bind: (...params: (string | number | null)[]) => ({
          all: async () => ({
            results: db.prepare(query).all(...params) as unknown[],
          }),
          first: async () => db.prepare(query).get(...params) as unknown,
          run: async () => {
            db.prepare(query).run(...params);
            return { success: true };
          },
        }),
        all: async () => ({ results: db.prepare(query).all() as unknown[] }),
        first: async () => db.prepare(query).get() as unknown,
        run: async () => {
          db.prepare(query).run();
          return { success: true };
        },
      }),
      batch: async (statements) => {
        const results = [];
        for (const s of statements) {
          results.push(await s.run());
        }
        return results;
      },
    };

    const storage = new Map<string, string>();
    mockBucket = {
      storage,
      put: async (key: string, data: string) => {
        storage.set(key, data);
        return { key };
      },
      get: async (key: string) => {
        const item = storage.get(key);
        if (!item) return null;
        return { text: async () => item };
      },
    };

    mockEnv = {
      DB: mockDb as unknown as Env['DB'],
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(new Response('Asset Content')),
      },
      BACKUP_BUCKET: mockBucket as unknown as Env['BACKUP_BUCKET'],
      ADMIN_EMAIL: 'admin@example.com',
    };
  });

  it('GET /api/games returns matched game list', async () => {
    const req = new Request('http://localhost/api/games');
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(200);
    const data = (await res.json()) as { title: string }[];
    expect(data[0].title).toBe('Super Mario Bros');
  });

  it('GET /api/toys joins with series info', async () => {
    const req = new Request('http://localhost/api/toys');
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(200);
    const data = (await res.json()) as { name: string; series_name: string }[];
    expect(data[0].name).toBe('Link');
    expect(data[0].series_name).toBe('Smash');
  });

  it('GET /api/platforms returns platforms', async () => {
    const req = new Request('http://localhost/api/platforms');
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(200);
    const data = (await res.json()) as { brand: string }[];
    expect(data[0].brand).toBe('Nintendo');
  });

  it('Delegates non-API routes to static assets', async () => {
    const req = new Request('http://localhost/index.html');
    const res = await worker.fetch(req, mockEnv);

    expect(mockEnv.ASSETS.fetch).toHaveBeenCalled();
    const text = await res.text();
    expect(text).toBe('Asset Content');
  });

  it('Enforces admin auth on production domain for mutation routes', async () => {
    // Unauthenticated request on production domain
    const unauthReq = new Request(
      'https://collection-tracker.example.com/api/collection/toggle',
      {
        method: 'POST',
        body: JSON.stringify({
          id: 'link-amiibo',
          type: 'toy',
          status: 1,
          field: 'ownership_status',
        }),
        headers: { 'Content-Type': 'application/json' },
      },
    );

    const unauthRes = await worker.fetch(unauthReq, mockEnv);
    expect(unauthRes.status).toBe(403);

    // Authenticated request with Cloudflare Access header for admin@example.com
    const authReq = new Request(
      'https://collection-tracker.example.com/api/collection/toggle',
      {
        method: 'POST',
        body: JSON.stringify({
          id: 'link-amiibo',
          type: 'toy',
          status: 1,
          field: 'ownership_status',
        }),
        headers: {
          'Content-Type': 'application/json',
          'Cf-Access-Authenticated-User-Email': 'admin@example.com',
        },
      },
    );

    const authRes = await worker.fetch(authReq, mockEnv);
    expect(authRes.status).toBe(200);

    const updatedToy = db
      .prepare('SELECT ownership_status FROM toys WHERE id = ?')
      .get('link-amiibo') as { ownership_status: number };
    expect(updatedToy.ownership_status).toBe(1);
  });

  it('POST /api/collection/toggle updates play_status on games', async () => {
    const req = new Request('http://localhost/api/collection/toggle', {
      method: 'POST',
      body: JSON.stringify({
        id: 'mario',
        type: 'game',
        status: 2,
        field: 'play_status',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await worker.fetch(req, mockEnv);
    expect(res.status).toBe(200);

    const updatedGame = db
      .prepare('SELECT play_status FROM games WHERE id = ?')
      .get('mario') as { play_status: number };
    expect(updatedGame.play_status).toBe(2);
  });

  it('POST /api/collection/sort updates sort_index', async () => {
    const req = new Request('http://localhost/api/collection/sort', {
      method: 'POST',
      body: JSON.stringify({ id: 'mario', type: 'game', sort_index: 42 }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await worker.fetch(req, mockEnv);
    expect(res.status).toBe(200);

    const updatedGame = db
      .prepare('SELECT sort_index FROM games WHERE id = ?')
      .get('mario') as { sort_index: number };
    expect(updatedGame.sort_index).toBe(42);
  });

  it('performScheduledBackup dumps tables and saves snapshot to R2', async () => {
    const result = await performScheduledBackup(mockEnv);
    expect(result.rowCount).toBeGreaterThan(0);
    expect(mockBucket.storage.size).toBe(2); // snapshot + latest.json

    const latest = mockBucket.storage.get('snapshots/latest.json');
    expect(latest).toBeDefined();
    const parsed = JSON.parse(latest!);
    expect(parsed.metadata.totalRows).toBe(result.rowCount);
    expect(parsed.tables.games.length).toBe(1);
    expect(parsed.tables.platforms.length).toBe(1);
  });

  it('isAuthorizedAdmin correctly identifies authorized identities', () => {
    const localReq = new Request('http://localhost/api/test');
    expect(isAuthorizedAdmin(localReq, mockEnv)).toBe(true);

    const prodUnauth = new Request('https://tracker.com/api/test');
    expect(isAuthorizedAdmin(prodUnauth, mockEnv)).toBe(false);

    const prodAuth = new Request('https://tracker.com/api/test', {
      headers: { 'Cf-Access-Authenticated-User-Email': 'admin@example.com' },
    });
    expect(isAuthorizedAdmin(prodAuth, mockEnv)).toBe(true);

    const prodWrongEmail = new Request('https://tracker.com/api/test', {
      headers: { 'Cf-Access-Authenticated-User-Email': 'other@example.com' },
    });
    expect(isAuthorizedAdmin(prodWrongEmail, mockEnv)).toBe(false);
  });
});
