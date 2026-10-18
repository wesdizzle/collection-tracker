import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import * as webPush from './web_push';
import worker, {
  Env,
  isAuthorizedAdmin,
  markDbDirty,
  performScheduledBackup,
  syncWorkerBoutiquePreOrders,
  syncWorkerLaunchDayNotifications,
  syncWorkerGameyePricing,
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
    list: (options?: { prefix?: string }) => Promise<{
      objects: { key: string; uploaded?: Date }[];
    }>;
    delete: (key: string) => Promise<void>;
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
        metadata_json TEXT,
        physical_status TEXT DEFAULT 'unverified',
        verification_tier INTEGER DEFAULT 0,
        barcode TEXT,
        release_medium TEXT DEFAULT 'physical_retail',
        origin_metadata TEXT,
        bundle_parent_id INTEGER,
        bundle_disc_number INTEGER,
        gameye_id INTEGER,
        gameye_platform_id INTEGER,
        price_loose INTEGER,
        price_cib INTEGER,
        price_new INTEGER,
        price_updated_at TEXT,
        retail_price INTEGER,
        retail_regular_price INTEGER,
        retail_discount_pct INTEGER,
        retail_on_sale INTEGER DEFAULT 0,
        retail_store TEXT,
        retail_url TEXT,
        retail_updated_at TEXT
      );
      CREATE TABLE game_releases (
        id TEXT PRIMARY KEY,
        game_id INTEGER NOT NULL REFERENCES games(stable_id) ON DELETE CASCADE,
        region TEXT,
        variants TEXT,
        also_released_as TEXT,
        rom_name TEXT,
        rom_crc TEXT,
        backup_status INTEGER NOT NULL DEFAULT 0,
        ownership_status INTEGER NOT NULL DEFAULT 0,
        release_date DATE,
        canonical_release_id INTEGER,
        barcode TEXT,
        is_physical INTEGER DEFAULT 1,
        has_case INTEGER NOT NULL DEFAULT 0,
        has_manual INTEGER NOT NULL DEFAULT 0,
        image_url TEXT
      );
      CREATE TABLE canonical_releases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform_id INTEGER NOT NULL,
        raw_title TEXT NOT NULL,
        normalized_title TEXT NOT NULL,
        region TEXT,
        variants TEXT,
        rom_name TEXT,
        rom_crc TEXT,
        serial_code TEXT,
        barcode TEXT,
        publisher TEXT,
        source TEXT NOT NULL DEFAULT 'dat',
        is_verified_physical INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE toys (
        stable_id INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE, 
        name TEXT NOT NULL, 
        line TEXT NOT NULL,
        series_id TEXT, 
        series_name TEXT, 
        series_line TEXT,
        series TEXT,
        type TEXT,
        release_date DATE,
        sort_index INTEGER,
        ownership_status INTEGER DEFAULT 0,
        verified BOOLEAN DEFAULT 0,
        metadata_json TEXT,
        image_url TEXT,
        amiibo_id TEXT,
        scl_url TEXT,
        region TEXT,
        details TEXT,
        gameye_id INTEGER,
        price_loose INTEGER,
        price_cib INTEGER,
        price_new INTEGER,
        price_updated_at TEXT
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
      CREATE TABLE push_subscriptions (
        id TEXT PRIMARY KEY,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        preferences_json TEXT NOT NULL DEFAULT '{}',
        user_agent TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS journal_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        UNIQUE(item_type, item_id)
      );
      CREATE TABLE IF NOT EXISTS cron_execution_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_name TEXT NOT NULL,
        status TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        summary TEXT,
        details_json TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO platforms (id, name, display_name, brand, launch_date) VALUES (1, 'NES', 'NES', 'Nintendo', '1985-10-18');
      INSERT INTO games (stable_id, id, title, series, canonical_series, platform_id, sort_index) VALUES (1, 'mario', 'Super Mario Bros', 'Mario', 'Super Mario', 1, 0);
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
        return { body: item, text: async () => item };
      },
      list: async (options?: { prefix?: string }) => {
        const prefix = options?.prefix || '';
        const objects: { key: string }[] = [];
        for (const [key] of storage) {
          if (key.startsWith(prefix)) {
            objects.push({ key });
          }
        }
        return { objects };
      },
      delete: async (key: string) => {
        storage.delete(key);
      },
    };

    mockEnv = {
      DB: mockDb as unknown as Env['DB'],
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(new Response('Asset Content')),
      },
      BACKUP_BUCKET: mockBucket as unknown as Env['BACKUP_BUCKET'],
      ADMIN_EMAIL: 'admin@example.com',
      TWITCH_CLIENT_ID: 'test-twitch-id',
      TWITCH_CLIENT_SECRET: 'test-twitch-secret',
    };
  });

  it('GET /api/games returns matched game list', async () => {
    const req = new Request('http://localhost/api/games');
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(200);
    const data = (await res.json()) as { title: string }[];
    expect(data[0].title).toBe('Super Mario Bros');
  });

  it('GET /api/games supports platform and platform_id query filtering', async () => {
    const req1 = new Request('http://localhost/api/games?platform=1');
    const res1 = await worker.fetch(req1, mockEnv);
    expect(res1.status).toBe(200);
    const data1 = (await res1.json()) as { title: string }[];
    expect(data1.length).toBe(1);
    expect(data1[0].title).toBe('Super Mario Bros');

    const req2 = new Request('http://localhost/api/games?platform_id=1');
    const res2 = await worker.fetch(req2, mockEnv);
    expect(res2.status).toBe(200);
    const data2 = (await res2.json()) as { title: string }[];
    expect(data2.length).toBe(1);
    expect(data2[0].title).toBe('Super Mario Bros');

    const reqEmpty = new Request('http://localhost/api/games?platform_id=999');
    const resEmpty = await worker.fetch(reqEmpty, mockEnv);
    expect(resEmpty.status).toBe(200);
    const dataEmpty = (await resEmpty.json()) as { title: string }[];
    expect(dataEmpty.length).toBe(0);
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

  it('GET /robots.txt returns plain text directives and cache header without delegating to assets', async () => {
    const req = new Request('http://localhost/robots.txt');
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    expect(res.headers.get('Cache-Control')).toContain('public, max-age=86400');
    const text = await res.text();
    expect(text).toContain('User-agent: *');
    expect(text).toContain('Disallow: /api/');
    expect(text).toContain('Disallow: /discovery/');
    expect(text).toContain('User-agent: GPTBot');
  });

  it('GET /api/games returns public Edge Cache-Control headers', async () => {
    const req = new Request('https://collection-tracker.example.com/api/games');
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=3600');
  });

  it('Enforces admin auth on production domain for /api/discovery/scan-series', async () => {
    const unauthReq = new Request(
      'https://collection-tracker.example.com/api/discovery/scan-series',
    );
    const unauthRes = await worker.fetch(unauthReq, mockEnv);
    expect(unauthRes.status).toBe(403);
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
    // Non-daily call updates latest.json
    const nonDailyRes = await performScheduledBackup(mockEnv, false);
    expect(nonDailyRes.rowCount).toBeGreaterThan(0);
    expect(mockBucket.storage.has('snapshots/latest.json')).toBe(true);
    expect(mockBucket.storage.size).toBe(1);

    // Daily call saves both dated snapshot and latest.json
    const dailyRes = await performScheduledBackup(mockEnv, true);
    expect(dailyRes.rowCount).toBeGreaterThan(0);
    expect(mockBucket.storage.size).toBe(2); // dated snapshot + latest.json

    const latest = mockBucket.storage.get('snapshots/latest.json');
    expect(latest).toBeDefined();
    const parsed = JSON.parse(latest!);
    expect(parsed.metadata.totalRows).toBe(dailyRes.rowCount);
    expect(parsed.tables.games.length).toBe(1);
    expect(parsed.tables.platforms.length).toBe(1);
  });

  it('performScheduledBackup prunes snapshots older than 30 days', async () => {
    // Add an ancient snapshot (timestamp in 2020)
    const oldKey = 'snapshots/backup-2020-01-01-1577836800000.json';
    mockBucket.storage.set(oldKey, JSON.stringify({ old: true }));

    expect(mockBucket.storage.has(oldKey)).toBe(true);

    await performScheduledBackup(mockEnv, true);

    // Old snapshot should be pruned, while recent snapshot and latest.json exist
    expect(mockBucket.storage.has(oldKey)).toBe(false);
    expect(mockBucket.storage.has('snapshots/latest.json')).toBe(true);
  });

  it('scheduled cron skips backup when clean and executes when dirty', async () => {
    // Clean state
    db.prepare(
      `INSERT INTO sync_state (key, value, updated_at)
       VALUES ('db_dirty', '0', datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = '0'`,
    ).run();

    mockBucket.storage.clear();

    const scheduledEvent = {
      cron: '*/30 * * * *',
      type: 'scheduled',
      scheduledTime: Date.now(),
    } as unknown as ScheduledEvent;

    // Outside daily window (e.g. 12:00 UTC)
    const originalDate = globalThis.Date;
    const mockNow = new Date('2026-10-18T12:00:00Z');
    globalThis.Date = class extends originalDate {
      constructor() {
        super();
        return mockNow;
      }
      static override now() {
        return mockNow.getTime();
      }
    } as unknown as typeof Date;

    // Mock fetch to avoid hitting live boutique stores during scheduled cron tests
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => {
        return {
          ok: true,
          json: async () => ({ products: [] }),
          text: async () => '',
        } as unknown as Response;
      });

    try {
      // 1. Clean run -> backup should be skipped
      await worker.scheduled(scheduledEvent, mockEnv, {} as ExecutionContext);
      expect(mockBucket.storage.size).toBe(0);

      // 2. Mark dirty
      await markDbDirty(mockEnv);
      const dirtyRow = db
        .prepare("SELECT value FROM sync_state WHERE key = 'db_dirty'")
        .get() as { value: string };
      expect(dirtyRow.value).toBe('1');

      // 3. Dirty run -> backup should execute and reset db_dirty to 0
      await worker.scheduled(scheduledEvent, mockEnv, {} as ExecutionContext);
      expect(mockBucket.storage.has('snapshots/latest.json')).toBe(true);
      const afterRow = db
        .prepare("SELECT value FROM sync_state WHERE key = 'db_dirty'")
        .get() as { value: string };
      expect(afterRow.value).toBe('0');
    } finally {
      globalThis.Date = originalDate;
      fetchSpy.mockRestore();
    }
  });

  it('GET /api/games uses Edge Cache and mutation invalidates it', async () => {
    const cachedMap = new Map<string, Response>();
    const mockCache = {
      match: vi.fn(async (req: RequestInfo | URL) => {
        const key =
          typeof req === 'string'
            ? req
            : req instanceof Request
              ? req.url
              : req.toString();
        return cachedMap.get(key)?.clone() || undefined;
      }),
      put: vi.fn(async (req: RequestInfo | URL, res: Response) => {
        const key =
          typeof req === 'string'
            ? req
            : req instanceof Request
              ? req.url
              : req.toString();
        cachedMap.set(key, res.clone());
      }),
      delete: vi.fn(async (req: RequestInfo | URL) => {
        const key =
          typeof req === 'string'
            ? req
            : req instanceof Request
              ? req.url
              : req.toString();
        return cachedMap.delete(key);
      }),
    };

    vi.stubGlobal('caches', { default: mockCache });

    try {
      // 1. Initial request populates edge cache
      const req = new Request('http://example.com/api/games');
      const res1 = await worker.fetch(req, mockEnv);
      expect(res1.status).toBe(200);
      expect(mockCache.put).toHaveBeenCalled();

      // 2. Subsequent request matches cached response
      const res2 = await worker.fetch(req, mockEnv);
      expect(res2.status).toBe(200);
      expect(mockCache.match).toHaveBeenCalled();

      // 3. Mutation invalidates edge cache
      const toggleReq = new Request(
        'http://example.com/api/collection/toggle',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-key': 'test',
          },
          body: JSON.stringify({ id: 'mario', type: 'game', status: 1 }),
        },
      );
      // Give mockEnv an admin key
      const adminEnv = { ...mockEnv, ADMIN_KEY: 'test' };
      const toggleRes = await worker.fetch(toggleReq, adminEnv);
      expect(toggleRes.status).toBe(200);
      expect(mockCache.delete).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('POST /api/discovery/add inserts game and releases transactionally', async () => {
    const req = new Request('http://localhost/api/discovery/add', {
      method: 'POST',
      body: JSON.stringify({
        game: {
          title: 'Super Metroid',
          platform_id: 1,
          igdb_id: 1234,
          summary: 'Classic SNES game',
          region: 'USA',
          ownership_status: 1,
          play_status: 1,
          backup_status: 1,
        },
        releases: [
          {
            region: 'USA',
            rom_name: 'Super Metroid (USA).sfc',
            rom_crc: 'D63ED5F8',
            ownership_status: 1,
            backup_status: 1,
          },
        ],
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await worker.fetch(req, mockEnv);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { success: boolean; gameId: string };
    expect(data.success).toBe(true);
    expect(data.gameId).toContain('super-metroid');

    const insertedGame = db
      .prepare('SELECT title, igdb_id FROM games WHERE id = ?')
      .get(data.gameId) as { title: string; igdb_id: number };
    expect(insertedGame.title).toBe('Super Metroid');
    expect(insertedGame.igdb_id).toBe(1234);

    const releases = db
      .prepare('SELECT rom_name, rom_crc FROM game_releases WHERE id LIKE ?')
      .all(`${data.gameId}%`) as { rom_name: string; rom_crc: string }[];
    expect(releases.length).toBe(1);
    expect(releases[0].rom_crc).toBe('D63ED5F8');
  });

  it('POST /api/discovery/add-toy inserts or updates amiibo toys', async () => {
    const req = new Request('http://localhost/api/discovery/add-toy', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Zelda - Tears of the Kingdom',
        line: 'amiibo',
        series_name: 'The Legend of Zelda',
        amiibo_id: '01030000003f0502',
        type: 'Figure',
        image_url: 'https://raw.githubusercontent.com/zelda.png',
        ownership_status: 1,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await worker.fetch(req, mockEnv);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { success: boolean; id: string };
    expect(data.success).toBe(true);

    const insertedToy = db
      .prepare('SELECT name, amiibo_id, line FROM toys WHERE id = ?')
      .get(data.id) as { name: string; amiibo_id: string; line: string };
    expect(insertedToy.name).toBe('Zelda - Tears of the Kingdom');
    expect(insertedToy.amiibo_id).toBe('01030000003f0502');
  });

  it('GET /api/discovery/scan-amiibo queries AmiiboAPI and filters existing items', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi
      .fn()
      .mockImplementation((url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes('amiiboapi.org')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                amiibo: [
                  {
                    head: '00000000',
                    tail: '00000002',
                    name: 'Mario',
                    amiiboSeries: 'Super Mario',
                    type: 'Figure',
                    image: 'https://raw.githubusercontent.com/mario.png',
                  },
                  {
                    head: '99999999',
                    tail: '99999999',
                    name: 'Ganondorf - TOTK',
                    amiiboSeries: 'The Legend of Zelda',
                    type: 'Figure',
                    image: 'https://raw.githubusercontent.com/ganondorf.png',
                  },
                ],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }
        return originalFetch(url);
      });

    try {
      const req = new Request('http://localhost/api/discovery/scan-amiibo');
      const res = await worker.fetch(req, mockEnv);
      expect(res.status).toBe(200);
      const items = (await res.json()) as { name: string; amiibo_id: string }[];
      // Mario already exists in seed DB (link-amiibo or mario), Ganondorf should be discovered
      expect(items.some((i) => i.name === 'Ganondorf - TOTK')).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('GET /admin/login returns HTML with refresh redirect and persistent session cookies', async () => {
    const req = new Request('https://tracker.example.com/admin/login');
    const res = await worker.fetch(req, mockEnv);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('/collection/games');

    const cookies = res.headers.getSetCookie();
    expect(
      cookies.some(
        (c) =>
          c.includes('CF_AppSession=dev-admin-session') &&
          c.includes('Max-Age=2592000'),
      ),
    ).toBe(true);
    expect(
      cookies.some(
        (c) =>
          c.includes('app_admin_session=active') &&
          c.includes('Max-Age=2592000'),
      ),
    ).toBe(true);

    // Test custom ADMIN_SESSION_DAYS
    const customDaysEnv = { ...mockEnv, ADMIN_SESSION_DAYS: '10' };
    const customRes = await worker.fetch(req, customDaysEnv);
    const customCookies = customRes.headers.getSetCookie();
    // 10 days = 864000 seconds
    expect(customCookies.some((c) => c.includes('Max-Age=864000'))).toBe(true);
  });

  it('GET /admin/logout revokes cookies and redirects to Cloudflare logout', async () => {
    const req = new Request('https://tracker.example.com/admin/logout');
    const res = await worker.fetch(req, mockEnv);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('/cdn-cgi/access/logout');
    const cookies = res.headers.getSetCookie();
    expect(
      cookies.some(
        (c) => c.includes('CF_AppSession=') && c.includes('Max-Age=0'),
      ),
    ).toBe(true);
    expect(
      cookies.some(
        (c) => c.includes('app_admin_session=') && c.includes('Max-Age=0'),
      ),
    ).toBe(true);
    expect(
      cookies.some(
        (c) => c.includes('CF_Authorization=') && c.includes('Max-Age=0'),
      ),
    ).toBe(true);
  });

  it('GET /api/admin/me returns authentication status', async () => {
    const unauthReq = new Request('https://tracker.example.com/api/admin/me');
    const unauthRes = await worker.fetch(unauthReq, mockEnv);
    const unauthData = (await unauthRes.json()) as { authenticated: boolean };
    expect(unauthData.authenticated).toBe(false);

    const authReq = new Request('https://tracker.example.com/api/admin/me', {
      headers: { 'Cf-Access-Authenticated-User-Email': 'admin@example.com' },
    });
    const authRes = await worker.fetch(authReq, mockEnv);
    const authData = (await authRes.json()) as {
      authenticated: boolean;
      email: string;
    };
    expect(authData.authenticated).toBe(true);
    expect(authData.email).toBe('admin@example.com');

    // Test app_admin_session cookie
    const sessionCookieReq = new Request(
      'https://tracker.example.com/api/admin/me',
      {
        headers: { Cookie: 'app_admin_session=active' },
      },
    );
    const sessionRes = await worker.fetch(sessionCookieReq, mockEnv);
    const sessionData = (await sessionRes.json()) as {
      authenticated: boolean;
      authorized: boolean;
      hasCookie: boolean;
    };
    expect(sessionData.authenticated).toBe(true);
    expect(sessionData.authorized).toBe(true);
    expect(sessionData.hasCookie).toBe(true);
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

    // Test CF_Authorization cookie extraction
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const validJwtPayload = btoa(
      JSON.stringify({ email: 'admin@example.com', exp: futureExp }),
    );
    const validJwt = `header.${validJwtPayload}.signature`;

    const cookieReq = new Request('https://tracker.com/api/test', {
      headers: { Cookie: `CF_Authorization=${validJwt}` },
    });
    expect(isAuthorizedAdmin(cookieReq, mockEnv)).toBe(true);

    const pastExp = Math.floor(Date.now() / 1000) - 3600;
    const expiredJwtPayload = btoa(
      JSON.stringify({ email: 'admin@example.com', exp: pastExp }),
    );
    const expiredJwt = `header.${expiredJwtPayload}.signature`;

    const expiredCookieReq = new Request('https://tracker.com/api/test', {
      headers: { Cookie: `CF_Authorization=${expiredJwt}` },
    });
    expect(isAuthorizedAdmin(expiredCookieReq, mockEnv)).toBe(false);

    // Test CF_AppSession cookie authentication
    const appSessionReq = new Request('https://tracker.com/api/test', {
      headers: { Cookie: 'CF_AppSession=valid-session-token-12345' },
    });
    expect(isAuthorizedAdmin(appSessionReq, mockEnv)).toBe(true);

    // Test app_admin_session cookie authentication
    const persistentSessionReq = new Request('https://tracker.com/api/test', {
      headers: { Cookie: 'app_admin_session=active' },
    });
    expect(isAuthorizedAdmin(persistentSessionReq, mockEnv)).toBe(true);
  });

  it('GET /api/discovery/search annotates physical release status and filters digital fluff', async () => {
    // Seed platform and canonical releases
    db.prepare(
      'INSERT OR REPLACE INTO platforms (id, name, display_name, brand, launch_date) VALUES (?, ?, ?, ?, ?)',
    ).run(19, 'Game Boy Advance', 'Game Boy Advance', 'Nintendo', '2001-06-11');
    db.prepare(
      `
      INSERT INTO canonical_releases (platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, is_verified_physical)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      19,
      'Metroid Fusion',
      'metroidfusion',
      'USA',
      null,
      'Metroid Fusion (USA).gba',
      '8F523456',
      1,
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi
      .fn()
      .mockImplementation((url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes('id.twitch.tv/oauth2/token')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                access_token: 'mock-token',
                expires_in: 3600,
                token_type: 'bearer',
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }
        if (urlStr.includes('api.igdb.com/v4/games')) {
          return Promise.resolve(
            new Response(
              JSON.stringify([
                {
                  id: 101,
                  name: 'Metroid Fusion',
                  platforms: [{ id: 24, name: 'Game Boy Advance' }],
                  cover: { image_id: 'fusion123' },
                  first_release_date: 1037577600, // 2002
                },
                {
                  id: 102,
                  name: 'Super Mario Bros. (Virtual Console)',
                  platforms: [{ id: 24, name: 'Game Boy Advance' }],
                  cover: { image_id: 'smb123' },
                  first_release_date: 500000000, // 1985 (Era discrepancy)
                },
              ]),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }
        return originalFetch(url, init);
      });

    try {
      // 1. Search without digital filter
      const req = new Request(
        'http://localhost/api/discovery/search?query=Metroid&platformId=19',
      );
      const res = await worker.fetch(req, mockEnv);
      if (res.status !== 200) {
        console.error('Search error body:', await res.text());
      }
      expect(res.status).toBe(200);
      const results = (await res.json()) as Array<{
        name: string;
        physical_status: string;
        verification_tier: number;
        is_physical: boolean;
      }>;
      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('Metroid Fusion');
      expect(results[0].physical_status).toBe('verified_physical');
      expect(results[0].verification_tier).toBe(1);
      expect(results[0].is_physical).toBe(true);

      expect(results[1].name).toBe('Super Mario Bros. (Virtual Console)');
      expect(results[1].physical_status).toBe('digital_only');
      expect(results[1].verification_tier).toBe(3);
      expect(results[1].is_physical).toBe(false);

      // 2. Search WITH digital filter
      const filterReq = new Request(
        'http://localhost/api/discovery/search?query=Metroid&platformId=19&filterDigital=true',
      );
      const filterRes = await worker.fetch(filterReq, mockEnv);
      expect(filterRes.status).toBe(200);
      const filteredResults = (await filterRes.json()) as Array<{
        name: string;
      }>;
      expect(filteredResults).toHaveLength(1);
      expect(filteredResults[0].name).toBe('Metroid Fusion');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('GET /api/discovery/matches returns matched physical releases and verification tier', async () => {
    db.prepare(
      'INSERT OR REPLACE INTO platforms (id, name, display_name, brand, launch_date) VALUES (?, ?, ?, ?, ?)',
    ).run(19, 'Game Boy Advance', 'Game Boy Advance', 'Nintendo', '2001-06-11');
    db.prepare(
      `
      INSERT INTO canonical_releases (platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, is_verified_physical)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      19,
      'Metroid Fusion',
      'metroidfusion',
      'USA',
      'Rev 1',
      'Metroid Fusion (USA) (Rev 1).gba',
      'AABBCCDD',
      1,
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi
      .fn()
      .mockImplementation((url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes('id.twitch.tv/oauth2/token')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                access_token: 'mock-token',
                expires_in: 3600,
                token_type: 'bearer',
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }
        if (urlStr.includes('api.igdb.com/v4/games')) {
          return Promise.resolve(
            new Response(
              JSON.stringify([
                {
                  id: 101,
                  name: 'Metroid Fusion',
                  platforms: [{ id: 24, name: 'Game Boy Advance' }],
                  cover: { image_id: 'fusion123' },
                  first_release_date: 1037577600,
                },
              ]),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }
        return originalFetch(url, init);
      });

    try {
      const req = new Request(
        'http://localhost/api/discovery/matches?igdbId=101&platformId=19',
      );
      const res = await worker.fetch(req, mockEnv);
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        game: { name: string; physical_status: string };
        matchedReleases: Array<{
          name: string;
          romCrc: string;
          region: string;
        }>;
        physical_status: string;
        verification_tier: number;
      };

      expect(data.game.name).toBe('Metroid Fusion');
      expect(data.physical_status).toBe('verified_physical');
      expect(data.verification_tier).toBe(1);
      expect(data.matchedReleases).toHaveLength(1);
      expect(data.matchedReleases[0].romCrc).toBe('AABBCCDD');
      expect(data.matchedReleases[0].region).toBe('USA');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('syncWorkerIgdbSeriesAndCanonical refreshes IGDB series/franchises and reconciles canonical_series diffs', async () => {
    const { syncWorkerIgdbSeriesAndCanonical } = await import('./worker');
    const envWithIgdb: Env = {
      ...mockEnv,
      TWITCH_CLIENT_ID: 'test-client-id',
      TWITCH_CLIENT_SECRET: 'test-client-secret',
    };

    // Seed two games:
    // Game 10: Has igdb_id=500, outdated collections/franchises, and stale canonical_series
    // Game 11: No igdb_id, already has PopCap Arcade Vol. 1 with stale canonical_series 'PopCap Hits!'
    db.prepare(
      `INSERT INTO games (stable_id, id, title, series, canonical_series, platform_id, igdb_id, collections, franchises)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      10,
      'xeno-x',
      'Xenoblade Chronicles X',
      'Xenoblade',
      'Xenoblade Chronicles X',
      1,
      500,
      'Xenoblade Chronicles X',
      'Xenoblade',
    );

    db.prepare(
      `INSERT INTO games (stable_id, id, title, series, canonical_series, platform_id, igdb_id, collections, franchises)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      11,
      'popcap-1',
      'PopCap Arcade Vol 1',
      'PopCap Hits!',
      'PopCap Hits!',
      1,
      null,
      'PopCap Hits!',
      null,
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi
      .fn()
      .mockImplementation((url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes('id.twitch.tv/oauth2/token')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                access_token: 'mock-igdb-token',
                expires_in: 3600,
                token_type: 'bearer',
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }
        if (urlStr.includes('api.igdb.com/v4/games')) {
          return Promise.resolve(
            new Response(
              JSON.stringify([
                {
                  id: 500,
                  collections: [{ name: 'Xenoblade Chronicles' }],
                  franchises: [{ name: 'Xenoblade' }],
                },
              ]),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }
        return originalFetch(url, init);
      });

    try {
      const res = await syncWorkerIgdbSeriesAndCanonical(envWithIgdb);
      expect(res.refreshedIgdbCount).toBe(1);
      expect(res.updatedGamesCount).toBeGreaterThanOrEqual(2);

      const game10 = db
        .prepare(
          'SELECT collections, franchises, canonical_series FROM games WHERE stable_id = 10',
        )
        .get() as {
        collections: string;
        franchises: string;
        canonical_series: string;
      };
      expect(game10.collections).toBe('Xenoblade Chronicles');
      expect(game10.franchises).toBe('Xenoblade');
      expect(game10.canonical_series).toBe('Xenoblade Chronicles');

      const game11 = db
        .prepare('SELECT canonical_series FROM games WHERE stable_id = 11')
        .get() as { canonical_series: string };
      expect(game11.canonical_series).toBe('PopCap Arcade');

      expect(res.cursorOffset).toBe(0);
      const cursor = db
        .prepare("SELECT value FROM sync_state WHERE key = 'igdb_sync_offset'")
        .get() as { value: string };
      expect(cursor?.value).toBe('0');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('GET /api/discovery/scan-series separates Switch 1 (130) from Switch 2 (508) and surfaces FDS (54) & 64DD (55) titles via alternative_names', async () => {
    db.prepare(
      'INSERT OR REPLACE INTO platforms (id, name, display_name, brand, launch_date) VALUES (?, ?, ?, ?, ?)',
    ).run(26, 'Nintendo Switch', 'Nintendo Switch', 'Nintendo', '2017-03-03');
    db.prepare(
      'INSERT OR REPLACE INTO platforms (id, name, display_name, brand, launch_date) VALUES (?, ?, ?, ?, ?)',
    ).run(
      27,
      'Nintendo Switch 2',
      'Nintendo Switch 2',
      'Nintendo',
      '2025-06-05',
    );
    db.prepare(
      'INSERT OR REPLACE INTO platforms (id, name, display_name, brand, launch_date) VALUES (?, ?, ?, ?, ?)',
    ).run(
      54,
      'Famicom Disk System',
      'Famicom Disk System',
      'Nintendo',
      '1986-02-21',
    );
    db.prepare(
      'INSERT OR REPLACE INTO platforms (id, name, display_name, brand, launch_date) VALUES (?, ?, ?, ?, ?)',
    ).run(55, 'Nintendo 64DD', 'Nintendo 64DD', 'Nintendo', '1999-12-01');

    // Owned Switch 1 game: Everybody 1-2-Switch! (igdb_id: 252035 on platform 26)
    db.prepare(
      `INSERT INTO games (stable_id, id, title, canonical_series, platform_id, igdb_id, collections, franchises)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      20,
      'everybody-1-2-switch-ns',
      'Everybody 1-2-Switch!',
      '1-2-Switch',
      26,
      252035,
      '1-2-Switch, Super Mario, Animal Crossing',
      'Mario',
    );

    // Seed canonical_releases for FDS (54) and 64DD (55)
    db.prepare(
      `INSERT INTO canonical_releases (platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, is_verified_physical)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      54,
      'Super Mario Bros. 2',
      'supermariobros2',
      'Japan',
      null,
      'Super Mario Bros. 2 (Japan).fds',
      'F04CD4CD',
      1,
    );
    db.prepare(
      `INSERT INTO canonical_releases (platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, is_verified_physical)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      55,
      'Doubutsu no Mori',
      'dobutsunomori',
      'Japan',
      null,
      'Doubutsu no Mori (Japan).ndd',
      '34FA2991',
      1,
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi
      .fn()
      .mockImplementation((url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes('id.twitch.tv/oauth2/token')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                access_token: 'mock-token',
                expires_in: 3600,
                token_type: 'bearer',
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }
        if (urlStr.includes('api.igdb.com/v4/multiquery')) {
          return Promise.resolve(
            new Response(
              JSON.stringify([
                {
                  name: 'b0',
                  result: [
                    {
                      id: 252035,
                      name: 'Everybody 1-2-Switch!',
                      platforms: [{ id: 130, name: 'Nintendo Switch' }],
                    },
                    {
                      id: 1068,
                      name: 'Super Mario Bros.: The Lost Levels',
                      platforms: [
                        { id: 51, name: 'Family Computer Disk System' },
                      ],
                      alternative_names: [
                        {
                          name: 'Super Mario Bros. 2',
                          comment: 'Japanese title',
                        },
                      ],
                    },
                    {
                      id: 277075,
                      name: 'Animal Crossing',
                      platforms: [{ id: 416, name: '64DD' }],
                      alternative_names: [
                        { name: 'Dōbutsu no Mori', comment: 'Japanese title' },
                      ],
                    },
                  ],
                },
              ]),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }
        return originalFetch(url, init);
      });

    try {
      const req = new Request('http://localhost/api/discovery/scan-series');
      const res = await worker.fetch(req, mockEnv);
      expect(res.status).toBe(200);
      const suggestions = (await res.json()) as Array<{
        id: number;
        title: string;
        platform: string;
        platform_id: number;
        physical_status: string;
      }>;

      // Everybody 1-2-Switch! on Switch (130 -> 26) is owned and must NOT appear (nor be misclassified as Switch 2)
      expect(suggestions.some((s) => s.title === 'Everybody 1-2-Switch!')).toBe(
        false,
      );

      // Super Mario Bros.: The Lost Levels on FDS (54) and Animal Crossing on 64DD (55) MUST appear as verified_physical
      const lostLevels = suggestions.find(
        (s) => s.title === 'Super Mario Bros.: The Lost Levels',
      );
      expect(lostLevels).toBeDefined();
      expect(lostLevels?.platform_id).toBe(54);
      expect(lostLevels?.physical_status).toBe('verified_physical');

      const animalCrossing = suggestions.find(
        (s) => s.title === 'Animal Crossing',
      );
      expect(animalCrossing).toBeDefined();
      expect(animalCrossing?.platform_id).toBe(55);
      expect(animalCrossing?.physical_status).toBe('verified_physical');

      // Paged request returns { suggestions, offset, limit, totalSeries, hasMore }
      const pagedReq = new Request(
        'http://localhost/api/discovery/scan-series?offset=0&limit=10',
      );
      const pagedRes = await worker.fetch(pagedReq, mockEnv);
      expect(pagedRes.status).toBe(200);
      const pagedData = (await pagedRes.json()) as {
        suggestions: unknown[];
        offset: number;
        limit: number;
        totalSeries: number;
        hasMore: boolean;
      };
      expect(pagedData.suggestions).toBeDefined();
      expect(pagedData.offset).toBe(0);
      expect(pagedData.limit).toBe(10);
      expect(pagedData.totalSeries).toBeGreaterThan(0);
      expect(pagedData.hasMore).toBe(false);

      // Targeted franchise scan via ?series=
      const seriesReq = new Request(
        'http://localhost/api/discovery/scan-series?series=1-2-Switch',
      );
      const seriesRes = await worker.fetch(seriesReq, mockEnv);
      expect(seriesRes.status).toBe(200);
      const seriesData = (await seriesRes.json()) as unknown[];
      expect(Array.isArray(seriesData)).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  describe('Notification Endpoints', () => {
    it('should return the VAPID public key', async () => {
      const req = new Request(
        'http://localhost/api/notifications/vapid-public-key',
      );
      const res = await worker.fetch(req, mockEnv);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { publicKey: string };
      expect(body.publicKey).toBeDefined();
      expect(typeof body.publicKey).toBe('string');
      expect(body.publicKey.length).toBeGreaterThan(20);
    });

    it('should subscribe and persist push subscription with preferences', async () => {
      const subPayload = {
        endpoint: 'https://push.example.com/sub/12345',
        keys: {
          p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9ScVw',
          auth: 'tBHItJI5svbpez7KI4CCXg',
        },
        preferences: {
          enabled: true,
          scope: 'seeking_only',
          minDiscountPct: 25,
          platformIds: [26, 33],
          stores: ['VGP'],
        },
      };

      const req = new Request('http://localhost/api/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subPayload),
      });

      const res = await worker.fetch(req, mockEnv);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { success: boolean; id: string };
      expect(data.success).toBe(true);
      expect(data.id).toBeDefined();

      const row = db
        .prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?')
        .get(subPayload.endpoint) as {
        endpoint: string;
        p256dh: string;
        preferences_json: string;
      };
      expect(row).toBeDefined();
      expect(row.endpoint).toBe(subPayload.endpoint);
      expect(row.p256dh).toBe(subPayload.keys.p256dh);
      const savedPrefs = JSON.parse(row.preferences_json);
      expect(savedPrefs.minDiscountPct).toBe(25);
      expect(savedPrefs.scope).toBe('seeking_only');
    });

    it('should update preferences for an existing endpoint', async () => {
      const endpoint = 'https://push.example.com/sub/update-test';
      db.prepare(
        `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, preferences_json, created_at, updated_at)
         VALUES ('test-id', ?, 'dummy-p256dh', 'dummy-auth', '{}', '2026-01-01', '2026-01-01')`,
      ).run(endpoint);

      const updateReq = new Request(
        'http://localhost/api/notifications/preferences',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint,
            preferences: {
              enabled: true,
              scope: 'seeking_and_unowned',
              minDiscountPct: 50,
            },
          }),
        },
      );

      const res = await worker.fetch(updateReq, mockEnv);
      expect(res.status).toBe(200);

      const row = db
        .prepare(
          'SELECT preferences_json FROM push_subscriptions WHERE endpoint = ?',
        )
        .get(endpoint) as { preferences_json: string };
      const parsed = JSON.parse(row.preferences_json);
      expect(parsed.minDiscountPct).toBe(50);
      expect(parsed.scope).toBe('seeking_and_unowned');
    });

    it('should unsubscribe an endpoint', async () => {
      const endpoint = 'https://push.example.com/sub/unsub-test';
      db.prepare(
        `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, created_at, updated_at)
         VALUES ('unsub-id', ?, 'p256dh', 'auth', '2026-01-01', '2026-01-01')`,
      ).run(endpoint);

      const req = new Request(
        'http://localhost/api/notifications/unsubscribe',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint }),
        },
      );

      const res = await worker.fetch(req, mockEnv);
      expect(res.status).toBe(200);

      const row = db
        .prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ?')
        .get(endpoint);
      expect(row).toBeUndefined();
    });
  });

  describe('Branding & Dynamic Configuration Endpoints', () => {
    it('GET /api/config returns default branding when env is unset', async () => {
      const req = new Request('http://localhost/api/config');
      const res = await worker.fetch(req, mockEnv);

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        appName: string;
        shortName: string;
        tagline: string;
      };
      expect(data.appName).toBe('Collection Tracker');
      expect(data.shortName).toBe('Tracker');
      expect(data.tagline).toBe('Physical Game & Toy Collection Tracker');
    });

    it('GET /api/config returns custom branding when env variables are provided', async () => {
      const customEnv = {
        ...mockEnv,
        APP_NAME: 'Gagglog',
        APP_SHORT_NAME: 'Gagglog',
        APP_TAGLINE: 'Cataloging an Eclectic Gaggle of Games',
      };
      const req = new Request('http://localhost/api/config');
      const res = await worker.fetch(req, customEnv);

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        appName: string;
        shortName: string;
        tagline: string;
      };
      expect(data.appName).toBe('Gagglog');
      expect(data.shortName).toBe('Gagglog');
      expect(data.tagline).toBe('Cataloging an Eclectic Gaggle of Games');
    });

    it('GET /manifest.webmanifest returns dynamic app name', async () => {
      const customEnv = {
        ...mockEnv,
        APP_NAME: 'Gagglelog',
        APP_SHORT_NAME: 'Gaggle',
      };
      const req = new Request('http://localhost/manifest.webmanifest');
      const res = await worker.fetch(req, customEnv);

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain(
        'application/manifest+json',
      );
      const data = (await res.json()) as {
        name: string;
        short_name: string;
        theme_color: string;
        background_color: string;
      };
      expect(data.name).toBe('Gagglelog');
      expect(data.short_name).toBe('Gaggle');
      expect(data.theme_color).toBe('#121214');
      expect(data.background_color).toBe('#121214');
    });

    it('GET /api/admin/logout sets domain-agnostic cookies based on request host', async () => {
      const req = new Request('https://tracker.example.com/api/admin/logout');
      const res = await worker.fetch(req, mockEnv);

      expect(res.status).toBe(200);
      const cookies = res.headers.getSetCookie();
      expect(
        cookies.some((c) => c.includes('Domain=tracker.example.com')),
      ).toBe(true);
    });

    it('GET /favicon.svg returns custom SVG when env.CUSTOM_FAVICON_SVG is set', async () => {
      const customSvg = '<svg viewBox="0 0 10 10"><circle r="5"/></svg>';
      const customEnv = {
        ...mockEnv,
        CUSTOM_FAVICON_SVG: customSvg,
      };
      const req = new Request('http://localhost/favicon.svg');
      const res = await worker.fetch(req, customEnv);

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('image/svg+xml');
      const text = await res.text();
      expect(text).toBe(customSvg);
    });
  });

  describe('Collection Journal & Acquisition Provenance Endpoints', () => {
    it('blocks unauthenticated public requests from reading or writing journal entries', async () => {
      const lockedEnv: Env = {
        ...mockEnv,
        ADMIN_EMAIL: 'admin@example.com',
      };

      const getRes = await worker.fetch(
        new Request(
          'https://tracker.example.com/api/journal?item_type=game&item_id=mario',
        ),
        lockedEnv,
      );
      expect(getRes.status).toBe(200);
      const getBody = (await getRes.json()) as {
        authorized: boolean;
        entry: unknown;
      };
      expect(getBody.authorized).toBe(false);
      expect(getBody.entry).toBeNull();

      const listRes = await worker.fetch(
        new Request('https://tracker.example.com/api/journal/entries'),
        lockedEnv,
      );
      expect(listRes.status).toBe(200);
      const listBody = (await listRes.json()) as {
        authorized: boolean;
        entries: unknown[];
      };
      expect(listBody.authorized).toBe(false);
      expect(listBody.entries).toEqual([]);

      const postRes = await worker.fetch(
        new Request('https://tracker.example.com/api/journal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            item_type: 'game',
            item_id: 'mario',
            price_paid: 19.99,
          }),
        }),
        lockedEnv,
      );
      expect(postRes.status).toBe(403);
    });

    it('normalizes merchant names, approximate dates, receipt URLs, and canonical game IDs on save, read, and delete', async () => {
      // Request from localhost is authorized in dev/test mode
      const postRes = await worker.fetch(
        new Request('http://localhost/api/journal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            item_type: 'game',
            item_id: 'gb-mario', // Release ID that resolves to canonical game ID 'mario'
            purchase_date: '~2009-06',
            price_paid: 4.1,
            merchant: 'eBay (hrlcksgames)',
            gifted_by: null,
            receipt_url: '16867f8a6f04196d', // Bare Gmail ID auto-expands to full URL
            notes: 'Purchased standalone for $4.10',
          }),
        }),
        mockEnv,
      );

      expect(postRes.status).toBe(200);
      const savedData = (await postRes.json()) as {
        success: boolean;
        entry: {
          item_type: string;
          item_id: string;
          purchase_date: string;
          is_approximate_date: number;
          price_paid: number;
          merchant: string;
          receipt_url: string;
          notes: string;
        };
      };
      expect(savedData.success).toBe(true);
      expect(savedData.entry.item_id).toBe('mario');
      expect(savedData.entry.purchase_date).toBe('2009-06');
      expect(savedData.entry.is_approximate_date).toBe(1);
      expect(savedData.entry.price_paid).toBe(4.1);
      expect(savedData.entry.merchant).toBe('eBay');
      expect(savedData.entry.receipt_url).toBe(
        'https://mail.google.com/mail/u/0/#all/16867f8a6f04196d',
      );

      // Querying via release ID 'gb-mario' resolves to canonical 'mario' entry
      const getRes = await worker.fetch(
        new Request(
          'http://localhost/api/journal?item_type=game&item_id=gb-mario',
        ),
        mockEnv,
      );
      expect(getRes.status).toBe(200);
      const getData = (await getRes.json()) as {
        authorized: boolean;
        entry: { item_id: string; merchant: string; receipt_url: string };
      };
      expect(getData.authorized).toBe(true);
      expect(getData.entry.item_id).toBe('mario');
      expect(getData.entry.merchant).toBe('eBay');

      // Update with a non-Gmail external receipt link
      const updateRes = await worker.fetch(
        new Request('http://localhost/api/journal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            item_type: 'game',
            item_id: 'mario',
            purchase_date: 'Around 2013',
            price_paid: 0,
            merchant: 'Best Buy',
            receipt_url: 'https://www.bestbuy.com/orders/12345',
            notes: 'Free promotion bundle',
          }),
        }),
        mockEnv,
      );
      expect(updateRes.status).toBe(200);
      const updated = (await updateRes.json()) as {
        entry: {
          purchase_date: string;
          is_approximate_date: number;
          receipt_url: string;
        };
      };
      expect(updated.entry.purchase_date).toBe('2013');
      expect(updated.entry.is_approximate_date).toBe(1);
      expect(updated.entry.receipt_url).toBe(
        'https://www.bestbuy.com/orders/12345',
      );

      // List all entries
      const listRes = await worker.fetch(
        new Request('http://localhost/api/journal/entries'),
        mockEnv,
      );
      const listData = (await listRes.json()) as {
        authorized: boolean;
        entries: unknown[];
      };
      expect(listData.authorized).toBe(true);
      expect(listData.entries).toHaveLength(1);

      // Delete entry
      const delRes = await worker.fetch(
        new Request(
          'http://localhost/api/journal?item_type=game&item_id=gb-mario',
          { method: 'DELETE' },
        ),
        mockEnv,
      );
      expect(delRes.status).toBe(200);

      const afterDelRes = await worker.fetch(
        new Request('http://localhost/api/journal/entries'),
        mockEnv,
      );
      const afterDelData = (await afterDelRes.json()) as {
        entries: unknown[];
      };
      expect(afterDelData.entries).toHaveLength(0);
    });

    it('syncWorkerBoutiquePreOrders updates physical_status and stores retail url on pre-order match', async () => {
      db.prepare(
        `
        INSERT INTO games (stable_id, id, title, platform_id, physical_status)
        VALUES (777, 'switch-sea-of-stars', 'Sea of Stars', 26, 'physical_pending')
      `,
      ).run();

      db.prepare(
        `
        INSERT INTO game_releases (id, game_id, ownership_status)
        VALUES ('sos-rel', 777, 2)
      `,
      ).run();

      const mockShopify = {
        products: [
          {
            id: 998877,
            title: 'Sea of Stars - Physical Edition (Switch)',
            handle: 'sea-of-stars-switch',
            tags: ['game', 'pre-order'],
            images: [{ src: 'https://cdn.iam8bit.com/sea.jpg' }],
            variants: [{ price: '39.99' }],
          },
        ],
      };

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async () => {
          return {
            ok: true,
            json: async () => mockShopify,
          } as unknown as Response;
        });

      try {
        const result = await syncWorkerBoutiquePreOrders(mockEnv);
        expect(result.matchedCount).toBeGreaterThan(0);

        const updated = db
          .prepare(
            'SELECT physical_status, retail_url, retail_store FROM games WHERE id = ?',
          )
          .get('switch-sea-of-stars') as {
          physical_status: string;
          retail_url: string;
          retail_store: string;
        };
        expect(updated.physical_status).toBe('likely_physical');
        expect(updated.retail_url).toContain('sea-of-stars-switch');
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('syncWorkerLaunchDayNotifications transitions announced_unreleased games launching today', async () => {
      db.prepare(
        `
        INSERT OR IGNORE INTO platforms (id, name, display_name)
        VALUES (26, 'Nintendo Switch', 'Switch')
      `,
      ).run();

      db.prepare(
        `
        INSERT INTO games (stable_id, id, title, platform_id, physical_status)
        VALUES (888, 'metroid-prime-4', 'Metroid Prime 4: Beyond', 26, 'announced_unreleased')
      `,
      ).run();

      db.prepare(
        `
        INSERT INTO game_releases (id, game_id, release_date)
        VALUES ('mp4-rel', 888, DATE('now'))
      `,
      ).run();

      await syncWorkerLaunchDayNotifications(mockEnv);
      const updated = db
        .prepare('SELECT physical_status FROM games WHERE id = ?')
        .get('metroid-prime-4') as { physical_status: string };
      expect(updated.physical_status).toBe('likely_physical');
    });

    it('syncWorkerBoutiquePreOrders suppresses standard announcement if physical copy is already owned on same platform', async () => {
      // User owns USA physical copy of Antonblast on Switch
      db.prepare(
        `INSERT INTO games (stable_id, id, title, platform_id, physical_status)
         VALUES (901, 'antonblast-switch', 'Antonblast', 26, 'verified_physical')`,
      ).run();

      db.prepare(
        `INSERT INTO game_releases (id, game_id, region, ownership_status, is_physical)
         VALUES ('anton-usa-rel', 901, 'USA', 1, 1)`,
      ).run();

      // Another release row for Europe unowned (mimicking real catalog)
      db.prepare(
        `INSERT INTO game_releases (id, game_id, region, ownership_status, is_physical)
         VALUES ('anton-eur-rel', 901, 'EUR', 0, 1)`,
      ).run();

      // Standard Fangamer pre-order drops
      const mockShopify = {
        products: [
          {
            id: 112233,
            title: 'Antonblast - Nintendo Switch',
            handle: 'antonblast-switch',
            tags: ['game', 'pre-order'],
            variants: [{ price: '35.00' }],
          },
        ],
      };

      const webPushSpy = vi
        .spyOn(webPush, 'sendWebPushNotification')
        .mockResolvedValue({ success: true, status: 201, shouldDelete: false });

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async () => {
          return {
            ok: true,
            json: async () => mockShopify,
          } as unknown as Response;
        });

      try {
        const result = await syncWorkerBoutiquePreOrders(mockEnv);
        // Matched statement updated URL, but notification was suppressed because standard physical is owned
        expect(result.notifications.dispatchedCount).toBe(0);
        expect(webPushSpy).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
        webPushSpy.mockRestore();
      }
    });

    it('syncWorkerBoutiquePreOrders allows announcement for a special edition even if standard copy is owned', async () => {
      // User owns Standard physical copy
      db.prepare(
        `INSERT INTO games (stable_id, id, title, platform_id, physical_status)
         VALUES (902, 'hollow-knight-switch', 'Hollow Knight', 26, 'verified_physical')`,
      ).run();

      db.prepare(
        `INSERT INTO game_releases (id, game_id, region, variants, ownership_status, is_physical)
         VALUES ('hk-std-rel', 902, 'USA', 'Standard', 1, 1)`,
      ).run();

      // Push subscription listening for announcements
      db.prepare(
        `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, preferences_json, user_agent, created_at, updated_at)
         VALUES ('sub-1', 'https://push.example.com/sub1', 'p256', 'auth', '{"enabled": true, "notify_physical_announcements": true}', 'agent', datetime('now'), datetime('now'))`,
      ).run();

      // Collector's Edition pre-order drops
      const mockShopify = {
        products: [
          {
            id: 223344,
            title: "Hollow Knight Collector's Edition - Nintendo Switch",
            handle: 'hollow-knight-collectors-edition',
            tags: ['game', 'pre-order'],
            variants: [{ price: '69.99' }],
          },
        ],
      };

      const webPushSpy = vi
        .spyOn(webPush, 'sendWebPushNotification')
        .mockResolvedValue({ success: true, status: 201, shouldDelete: false });

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) => {
          if (
            typeof input === 'string' &&
            input.includes('limitedrungames.com')
          ) {
            return {
              ok: true,
              json: async () => mockShopify,
            } as unknown as Response;
          }
          return {
            ok: true,
            json: async () => ({ products: [] }),
          } as unknown as Response;
        });

      try {
        const result = await syncWorkerBoutiquePreOrders(mockEnv);
        expect(result.notifications.dispatchedCount).toBe(1);
        expect(webPushSpy).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            title:
              "📦 Physical Edition Announced: Hollow Knight (Collector's Edition)",
          }),
          expect.anything(),
        );
      } finally {
        fetchSpy.mockRestore();
        webPushSpy.mockRestore();
      }
    });

    it('syncWorkerBoutiquePreOrders allows announcement across different platforms', async () => {
      // User owns Antonblast on Switch (stable_id 903), but PS5 (stable_id 904) is unowned
      db.prepare(
        `INSERT INTO games (stable_id, id, title, platform_id, physical_status)
         VALUES (903, 'antonblast-switch', 'Antonblast', 26, 'verified_physical')`,
      ).run();

      db.prepare(
        `INSERT INTO game_releases (id, game_id, region, ownership_status, is_physical)
         VALUES ('anton-sw-rel', 903, 'USA', 1, 1)`,
      ).run();

      db.prepare(
        `INSERT INTO games (stable_id, id, title, platform_id, physical_status)
         VALUES (904, 'antonblast-ps5', 'Antonblast', 34, 'unverified')`,
      ).run();

      db.prepare(
        `INSERT INTO game_releases (id, game_id, region, ownership_status, is_physical)
         VALUES ('anton-ps5-rel', 904, 'USA', 0, 1)`,
      ).run();

      db.prepare(
        `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, preferences_json, user_agent, created_at, updated_at)
         VALUES ('sub-ps5', 'https://push.example.com/sub-ps5', 'p256', 'auth', '{"enabled": true, "notify_physical_announcements": true}', 'agent', datetime('now'), datetime('now'))`,
      ).run();

      const mockShopify = {
        products: [
          {
            id: 334455,
            title: 'Antonblast - PS5',
            handle: 'antonblast-ps5',
            tags: ['game', 'pre-order'],
            variants: [{ price: '35.00' }],
          },
        ],
      };

      const webPushSpy = vi
        .spyOn(webPush, 'sendWebPushNotification')
        .mockResolvedValue({ success: true, status: 201, shouldDelete: false });

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) => {
          if (typeof input === 'string' && input.includes('fangamer.com')) {
            return {
              ok: true,
              json: async () => mockShopify,
            } as unknown as Response;
          }
          return {
            ok: true,
            json: async () => ({ products: [] }),
          } as unknown as Response;
        });

      try {
        const result = await syncWorkerBoutiquePreOrders(mockEnv);
        expect(result.notifications.dispatchedCount).toBe(1);
        expect(webPushSpy).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            title: '📦 Physical Edition Announced: Antonblast',
          }),
          expect.anything(),
        );
      } finally {
        fetchSpy.mockRestore();
        webPushSpy.mockRestore();
      }
    });

    it('GET /api/admin/diagnostics/jobs returns logged cron executions when authorized', async () => {
      // Insert execution log
      db.prepare(
        `INSERT INTO cron_execution_logs (job_name, status, duration_ms, summary, details_json)
         VALUES ('boutique_preorders', 'SUCCESS', 1234, 'Matched 5 pre-orders', '{"matched": 5}')`,
      ).run();

      const authEnv = { ...mockEnv, ADMIN_KEY: 'test-secret-key' };

      const unauthReq = new Request(
        'https://collection-tracker.example.com/api/admin/diagnostics/jobs',
      );
      const unauthRes = await worker.fetch(unauthReq, authEnv);
      expect(unauthRes.status).toBe(403);

      const authReq = new Request(
        'https://collection-tracker.example.com/api/admin/diagnostics/jobs',
        {
          headers: { 'x-admin-key': 'test-secret-key' },
        },
      );
      const authRes = await worker.fetch(authReq, authEnv);
      expect(authRes.status).toBe(200);

      const data = (await authRes.json()) as {
        logs: Array<{ job_name: string; summary: string }>;
      };
      expect(data.logs.length).toBeGreaterThan(0);
      expect(data.logs[0].job_name).toBe('boutique_preorders');
      expect(data.logs[0].summary).toBe('Matched 5 pre-orders');
    });

    it('POST /api/collection/toggle updates physical_status on a game', async () => {
      db.prepare(
        `INSERT INTO games (stable_id, id, title, platform_id, physical_status)
         VALUES (905, 'digital-game', 'Digital Indie Game', 26, 'digital_only')`,
      ).run();

      const req = new Request('http://localhost/api/collection/toggle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': 'test-secret-key',
        },
        body: JSON.stringify({
          id: 'digital-game',
          type: 'game',
          field: 'physical_status',
          status: 'physical_pending',
        }),
      });

      const res = await worker.fetch(req, mockEnv);
      expect(res.status).toBe(200);

      const row = db
        .prepare('SELECT physical_status FROM games WHERE id = ?')
        .get('digital-game') as {
        physical_status: string;
      };
      expect(row.physical_status).toBe('physical_pending');
    });
  });

  describe('Rolling GAMEYE / PriceCharting Valuation Sync', () => {
    it('syncWorkerGameyePricing prioritizes unpriced items (NULLS FIRST) and updates round-robin queue', async () => {
      db.prepare(
        `INSERT INTO toys (stable_id, id, name, line, ownership_status, price_loose, price_updated_at)
         VALUES (101, 'toy-unpriced', 'Unpriced Toy', 'amiibo', 1, NULL, NULL),
                (102, 'toy-priced', 'Priced Toy', 'amiibo', 1, 1500, '2026-09-01T00:00:00Z')`,
      ).run();

      const mockClient = {
        get: vi.fn(async () => {
          return {
            data: {
              records: [
                {
                  id: 8881,
                  title: 'Unpriced Toy',
                  platform_id: 118,
                  country_id: 1,
                  release_type: 0,
                  price: {
                    Loose: 2500,
                    CIB: 3500,
                    New: 5000,
                  },
                },
              ],
            },
            status: 200,
          };
        }),
      };

      const result = await syncWorkerGameyePricing(mockEnv, {
        toyLimit: 1,
        gameLimit: 0,
        client: mockClient,
      });

      expect(result.toysChecked).toBe(1);
      expect(result.toysUpdated).toBe(1);
      expect(result.details[0].stableId).toBe(101);
      expect(result.details[0].newPrice).toBe(2500);

      const updatedRow = db
        .prepare(
          'SELECT gameye_id, price_loose, price_updated_at FROM toys WHERE stable_id = 101',
        )
        .get() as {
        gameye_id: number;
        price_loose: number;
        price_updated_at: string;
      };
      expect(updatedRow.gameye_id).toBe(8881);
      expect(updatedRow.price_loose).toBe(2500);
      expect(updatedRow.price_updated_at).toBeTruthy();
    });

    it('syncWorkerGameyePricing re-prices Camo from $450 chase mismatch to $9.16 base figure', async () => {
      db.prepare(
        `INSERT INTO toys (stable_id, id, name, line, series_id, type, ownership_status, gameye_id, price_loose, price_updated_at)
         VALUES (256, 'camo-spyro', 'Camo', 'Skylanders', 'skylanders-spyro-s-adventure', 'Series 1', 1, 99903, 45000, '2026-09-23T00:00:00Z')`,
      ).run();

      const mockClient = {
        get: vi.fn(async () => {
          return {
            data: {
              records: [
                {
                  id: 99903,
                  title: 'Camo [Fruit Punch]',
                  platform_id: 119,
                  country_id: 1,
                  release_type: 0,
                  price: {
                    Loose: 45000,
                    CIB: 55000,
                    New: 65000,
                  },
                },
                {
                  id: 99902,
                  title: 'Camo',
                  platform_id: 119,
                  country_id: 1,
                  release_type: 0,
                  price: {
                    Loose: 916,
                    CIB: 1500,
                    New: 2500,
                  },
                },
              ],
            },
            status: 200,
          };
        }),
      };

      const res = await syncWorkerGameyePricing(mockEnv, {
        specificToyStableId: 256,
        gameLimit: 0,
        client: mockClient,
      });

      expect(res.toysChecked).toBe(1);
      expect(res.toysUpdated).toBe(1);
      expect(res.details[0].oldPrice).toBe(45000);
      expect(res.details[0].newPrice).toBe(916);
      expect(res.details[0].gameyeId).toBe(99902);

      const camoRow = db
        .prepare(
          'SELECT gameye_id, price_loose, price_updated_at FROM toys WHERE stable_id = 256',
        )
        .get() as {
        gameye_id: number;
        price_loose: number;
        price_updated_at: string;
      };
      expect(camoRow.gameye_id).toBe(99902);
      expect(camoRow.price_loose).toBe(916);
    });

    it('syncWorkerGameyePricing touches price_updated_at for unmatched items so the queue advances', async () => {
      db.prepare(
        `INSERT INTO toys (stable_id, id, name, line, ownership_status, price_loose, price_updated_at)
         VALUES (201, 'obscure-toy', 'Obscure Toy', 'amiibo', 1, 1000, '2026-08-01T00:00:00Z')`,
      ).run();

      const mockEmptyClient = {
        get: vi.fn(async () => ({
          data: { records: [] },
          status: 200,
        })),
      };

      const res = await syncWorkerGameyePricing(mockEnv, {
        specificToyStableId: 201,
        gameLimit: 0,
        client: mockEmptyClient,
      });

      expect(res.toysChecked).toBe(1);
      expect(res.toysUpdated).toBe(0);

      const row = db
        .prepare(
          'SELECT price_loose, price_updated_at FROM toys WHERE stable_id = 201',
        )
        .get() as { price_loose: number; price_updated_at: string };
      expect(row.price_loose).toBe(1000);
      expect(row.price_updated_at).not.toBe('2026-08-01T00:00:00Z');
    });

    it('POST /api/admin/sync/gameye-pricing requires admin auth on production domain and executes sync', async () => {
      const unauthReq = new Request(
        'https://collection-tracker.example.com/api/admin/sync/gameye-pricing',
        {
          method: 'POST',
        },
      );
      const unauthRes = await worker.fetch(unauthReq, mockEnv);
      expect(unauthRes.status).toBe(403);

      const authReq = new Request(
        'https://collection-tracker.example.com/api/admin/sync/gameye-pricing',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cf-Access-Authenticated-User-Email': 'admin@example.com',
          },
          body: JSON.stringify({
            toyLimit: 0,
            gameLimit: 0,
          }),
        },
      );
      const authRes = await worker.fetch(authReq, mockEnv);
      expect(authRes.status).toBe(200);
      const json = await authRes.json();
      expect(json).toEqual({
        toysChecked: 0,
        toysUpdated: 0,
        gamesChecked: 0,
        gamesUpdated: 0,
        details: [],
      });
    });

    it('scheduled cron executes syncWorkerGameyePricing and logs SUCCESS', async () => {
      const scheduledEvent = {
        cron: '*/5 * * * *',
        type: 'scheduled',
        scheduledTime: Date.now(),
      } as unknown as ScheduledEvent;

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async () => {
          return {
            ok: true,
            json: async () => ({ records: [], products: [] }),
            text: async () => '',
          } as unknown as Response;
        });

      try {
        await worker.scheduled(scheduledEvent, mockEnv, {} as ExecutionContext);

        const logRow = db
          .prepare(
            `SELECT job_name, status FROM cron_execution_logs WHERE job_name = 'gameye_pricing' ORDER BY id DESC LIMIT 1`,
          )
          .get() as { job_name: string; status: string };

        expect(logRow).toBeTruthy();
        expect(logRow.job_name).toBe('gameye_pricing');
        expect(logRow.status).toBe('SUCCESS');
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });
});
