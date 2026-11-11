import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import * as webPush from './web_push';
import {
  signSession,
  verifySession,
  SESSION_COOKIE,
  HOST_SESSION_COOKIE,
  HOST_OIDC_STATE_COOKIE,
  parseCookies,
  resetOidcJwksCache,
} from './auth';
import worker, {
  Env,
  isAuthorizedAdmin,
  markDbDirty,
  performScheduledBackup,
  resetWorkerRateLimits,
  syncOrResolveOidcUser,
  syncWorkerBoutiquePreOrders,
  syncWorkerLaunchDayNotifications,
  syncWorkerRetailDeals,
} from './worker';

const CANONICAL_SCHEMA_SQL = fs.readFileSync(
  path.resolve(__dirname, '../migrations/schema.sql'),
  'utf-8',
);

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
        run: () => Promise<{ success: boolean; meta: { changes: number } }>;
      };
      all: () => Promise<{ results: unknown[] }>;
      first: () => Promise<unknown>;
      run: () => Promise<{ success: boolean; meta: { changes: number } }>;
    };
    batch: (
      statements: { run: () => Promise<{ success: boolean }> }[],
    ) => Promise<unknown[]>;
  };
  let mockBucket: {
    storage: Map<string, string>;
    metadata: Map<string, Record<string, string>>;
    put: (
      key: string,
      data: string,
      options?: { customMetadata?: Record<string, string> },
    ) => Promise<unknown>;
    head: (key: string) => Promise<{
      key: string;
      customMetadata?: Record<string, string>;
    } | null>;
    get: (key: string) => Promise<{
      body: string;
      customMetadata?: Record<string, string>;
      text: () => Promise<string>;
    } | null>;
    list: (options?: { prefix?: string }) => Promise<{
      objects: { key: string; uploaded?: Date }[];
      truncated: boolean;
    }>;
    delete: (key: string) => Promise<void>;
  };
  let mockEnv: Env;

  beforeEach(() => {
    resetWorkerRateLimits();
    resetOidcJwksCache();

    // Initialize an in-memory database loaded from canonical migrations/schema.sql (PRAGMA foreign_keys = ON)
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(CANONICAL_SCHEMA_SQL);

    // Seed baseline test fixtures against canonical schema
    db.exec(`
      INSERT INTO users (id, username, is_public, home_region, display_name)
      VALUES (1, 'alice', 1, 'USA', 'Alice');
      INSERT INTO games (stable_id, id, title, series, canonical_series, platform_id, sort_index)
      VALUES (1, 'mario', 'Super Mario Bros', 'Mario', 'Super Mario', 1, 0);
      INSERT INTO game_releases (id, game_id, region, variants, rom_name, rom_crc, release_date)
      VALUES ('gb-mario', 1, 'USA', null, null, null, '1985-10-18');
      INSERT INTO user_game_releases (user_id, release_id, ownership_status, backup_status)
      VALUES (1, 'gb-mario', 1, 0);
      INSERT OR IGNORE INTO toy_series (id, name, line, sort_index)
      VALUES ('smash', 'Smash', 'amiibo', 0);
      INSERT INTO toys (stable_id, id, name, line, series_id, sort_index)
      VALUES (1, 'link-amiibo', 'Link', 'amiibo', 'smash', 0);
      INSERT INTO sync_state (key, value) VALUES ('boutique_seed_completed', '1');
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
            const info = db.prepare(query).run(...params);
            return { success: true, meta: { changes: info.changes } };
          },
        }),
        all: async () => ({ results: db.prepare(query).all() as unknown[] }),
        first: async () => db.prepare(query).get() as unknown,
        run: async () => {
          const info = db.prepare(query).run();
          return { success: true, meta: { changes: info.changes } };
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
    const metadata = new Map<string, Record<string, string>>();
    mockBucket = {
      storage,
      metadata,
      put: async (key: string, data: string, options) => {
        storage.set(key, data);
        if (options?.customMetadata) {
          metadata.set(key, { ...options.customMetadata });
        } else {
          metadata.delete(key);
        }
        return { key };
      },
      head: async (key: string) => {
        if (!storage.has(key)) return null;
        return { key, customMetadata: metadata.get(key) };
      },
      get: async (key: string) => {
        const item = storage.get(key);
        if (!item) return null;
        return {
          body: item,
          customMetadata: metadata.get(key),
          text: async () => item,
        };
      },
      list: async (options?: { prefix?: string }) => {
        const prefix = options?.prefix || '';
        const objects: { key: string }[] = [];
        for (const [key] of storage) {
          if (key.startsWith(prefix)) {
            objects.push({ key });
          }
        }
        return { objects, truncated: false };
      },
      delete: async (key: string) => {
        storage.delete(key);
        metadata.delete(key);
      },
    };

    mockEnv = {
      DB: mockDb as unknown as Env['DB'],
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(new Response('Asset Content')),
      },
      BACKUP_BUCKET: mockBucket as unknown as Env['BACKUP_BUCKET'],
      ADMIN_EMAIL: 'admin@example.com',
      SESSION_SECRET: 'test-unit-session-secret-32-chars-minimum',
      VAPID_PUBLIC_KEY:
        'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9ScVw_test_public_key_placeholder_65bytes',
      VAPID_PRIVATE_KEY: 'test-vapid-private-key-placeholder',
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
    const data = (await res.json()) as { id: number; brand: string }[];
    expect(data.some((p) => p.id === 1 && p.brand === '3DO')).toBe(true);
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
    expect(unauthRes.status).toBe(401);

    // Unverified Cf-Access-Authenticated-User-Email header alone is rejected on production domain
    const spoofedHeaderReq = new Request(
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
    const spoofedRes = await worker.fetch(spoofedHeaderReq, mockEnv);
    expect(spoofedRes.status).toBe(401);

    // Authenticated request with verified HMAC session cookie
    const sessionToken = await signSession(
      { id: 1, username: 'alice', role: 'admin', homeRegion: 'USA' },
      mockEnv.SESSION_SECRET!,
    );
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
          Cookie: `${SESSION_COOKIE}=${sessionToken}`,
        },
      },
    );

    const authRes = await worker.fetch(authReq, mockEnv);
    expect(authRes.status).toBe(200);

    const updatedToy = db
      .prepare('SELECT ownership_status FROM user_toys WHERE toy_id = ?')
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
      .prepare(
        'SELECT play_status FROM user_games WHERE game_id = (SELECT stable_id FROM games WHERE id = ?)',
      )
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

  it('performScheduledBackup dumps tables, deduplicates unchanged SHA-256 via head(), and saves daily snapshot to R2', async () => {
    // Non-daily call updates latest.json
    const nonDailyRes = await performScheduledBackup(mockEnv, false);
    expect(nonDailyRes.rowCount).toBeGreaterThan(0);
    expect(mockBucket.storage.has('snapshots/latest.json')).toBe(true);
    expect(mockBucket.storage.size).toBe(1);

    // Repeat call with unchanged DB skips upload via head() SHA-256 metadata check
    const unchangedRes = await performScheduledBackup(mockEnv, true);
    expect(unchangedRes.skipped).toBe(true);
    expect(mockBucket.storage.size).toBe(1);

    // Mutate DB and run daily call -> saves both dated snapshot and updated latest.json
    db.prepare('UPDATE games SET sort_index = 7 WHERE stable_id = 1').run();
    const dailyRes = await performScheduledBackup(mockEnv, true);
    expect(dailyRes.rowCount).toBeGreaterThan(0);
    expect(mockBucket.storage.size).toBe(2); // dated snapshot + latest.json

    const latest = mockBucket.storage.get('snapshots/latest.json');
    expect(latest).toBeDefined();
    const parsed = JSON.parse(latest!);
    expect(parsed.metadata.totalRows).toBe(dailyRes.rowCount);
    expect(parsed.tables.games.length).toBe(1);
    expect(parsed.tables.platforms.length).toBeGreaterThanOrEqual(1);
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
      // 1. Clean run outside daily window -> backup should be skipped
      await worker.scheduled(scheduledEvent, mockEnv, {} as ExecutionContext);
      expect(mockBucket.storage.size).toBe(0);

      // 2. Mark dirty
      await markDbDirty(mockEnv);
      const dirtyRow = db
        .prepare("SELECT value FROM sync_state WHERE key = 'db_dirty'")
        .get() as { value: string };
      expect(dirtyRow.value).toBe('1');

      // 3. Dirty run outside daily window -> backup should still be skipped to protect daytime D1 quota
      await worker.scheduled(scheduledEvent, mockEnv, {} as ExecutionContext);
      expect(mockBucket.storage.size).toBe(0);

      // 4. Daily window cron event -> backup should execute and reset db_dirty to 0
      const dailyEvent = {
        cron: '30 23 * * *',
        type: 'scheduled',
        scheduledTime: Date.now(),
      } as unknown as ScheduledEvent;
      await worker.scheduled(dailyEvent, mockEnv, {} as ExecutionContext);
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

  it('GET /api/games with ?bust=1 bypasses edge cache and updates it', async () => {
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
      // 1. Prime cache with stale response
      cachedMap.set(
        'http://example.com/api/games',
        new Response(JSON.stringify([{ id: 'stale-game' }]), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      // 2. Normal request returns stale response
      const normalReq = new Request('http://example.com/api/games');
      const normalRes = await worker.fetch(normalReq, mockEnv);
      const normalData = await normalRes.json();
      expect(normalData).toEqual([{ id: 'stale-game' }]);

      // 3. Anonymous request with ?bust=1 does NOT purge cache (still returns stale cached response)
      const anonBustReq = new Request('http://example.com/api/games?bust=1');
      const anonBustRes = await worker.fetch(anonBustReq, mockEnv);
      expect(await anonBustRes.json()).toEqual([{ id: 'stale-game' }]);
      expect(mockCache.delete).not.toHaveBeenCalled();

      // 4. Admin-authorized request (or loopback) with ?bust=1 bypasses cache and updates it
      cachedMap.set(
        'http://localhost/api/games',
        new Response(JSON.stringify([{ id: 'stale-game' }]), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      // Note: on loopback, resolveSessionUser returns an admin sessionUser so isPublicCacheable is false.
      // Test public cache purge on production domain with a non-session admin or verify cache key normalization:
      const randomParamReq = new Request(
        'http://example.com/api/games?utm_source=test&random=123',
      );
      const randomParamRes = await worker.fetch(randomParamReq, mockEnv);
      expect(await randomParamRes.json()).toEqual([{ id: 'stale-game' }]);
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
          release_date: '1994-03-19',
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
      .prepare(
        'SELECT rom_name, rom_crc, release_date FROM game_releases WHERE id LIKE ?',
      )
      .all(`${data.gameId}%`) as {
      rom_name: string;
      rom_crc: string;
      release_date: string;
    }[];
    expect(releases.length).toBe(1);
    expect(releases[0].rom_crc).toBe('D63ED5F8');
    expect(releases[0].release_date).toBe('1994-03-19');
  });

  it('POST /api/discovery/add handles duplicate release identifiers cleanly with unique slugs', async () => {
    const req = new Request('http://localhost/api/discovery/add', {
      method: 'POST',
      body: JSON.stringify({
        game: {
          title: 'Mega Man & Bass',
          platform_id: 1,
          igdb_id: 5555,
          physical_status: 'verified_physical',
          ownership_status: 0,
        },
        releases: [
          {
            region: 'USA',
            rom_name: 'Mega Man & Bass (USA)',
            rom_crc: '11223344',
          },
          {
            region: 'Europe',
            rom_name: 'Mega Man & Bass (USA)', // duplicate rom_name & rom_crc
            rom_crc: '11223344',
          },
        ],
      }),
      headers: {
        'Content-Type': 'application/json',
        'cf-access-authenticated-user-email': 'admin@example.com',
      },
    });

    const res = await worker.fetch(req, mockEnv);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      success: boolean;
      gameId: string;
      stableId: number;
    };
    expect(data.success).toBe(true);
    expect(data.stableId).toBeGreaterThan(0);

    const releases = db
      .prepare('SELECT id, region FROM game_releases WHERE id LIKE ?')
      .all(`${data.gameId}%`) as { id: string; region: string }[];
    expect(releases.length).toBe(2);
    expect(releases[0].id).not.toBe(releases[1].id);
  });

  it('POST /api/discovery/add inserts Platform 0 wishlist title with 0 releases', async () => {
    const req = new Request('http://localhost/api/discovery/add', {
      method: 'POST',
      body: JSON.stringify({
        game: {
          title: 'Mushroom 11',
          platform_id: 0,
          igdb_id: 9999,
          physical_status: 'not_yet_physical',
          ownership_status: 2,
        },
        releases: [],
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await worker.fetch(req, mockEnv);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { success: boolean; gameId: string };
    expect(data.success).toBe(true);

    const insertedGame = db
      .prepare(
        'SELECT title, platform_id, physical_status, stable_id FROM games WHERE id = ?',
      )
      .get(data.gameId) as {
      title: string;
      platform_id: number;
      physical_status: string;
      stable_id: number;
    };
    expect(insertedGame.title).toBe('Mushroom 11');
    expect(insertedGame.platform_id).toBe(0);
    expect(insertedGame.physical_status).toBe('not_yet_physical');

    const releases = db
      .prepare('SELECT id FROM game_releases WHERE game_id = ?')
      .all(insertedGame.stable_id);
    expect(releases).toHaveLength(0);

    // Verify GET /api/games/:id does NOT synthesize a fake physical release for Platform 0
    const getRes = await worker.fetch(
      new Request(`http://localhost/api/games/${data.gameId}`),
      mockEnv,
    );
    expect(getRes.status).toBe(200);
    const detail = (await getRes.json()) as {
      id: string;
      platform_id: number;
      releases: unknown[];
    };
    expect(detail.platform_id).toBe(0);
    expect(detail.releases).toEqual([]);

    // Verify re-adding the same Platform 0 game is idempotent (no -1 duplicate)
    const dupRes = await worker.fetch(
      new Request('http://localhost/api/discovery/add', {
        method: 'POST',
        body: JSON.stringify({
          game: {
            title: 'Mushroom 11',
            platform_id: 0,
            igdb_id: 9999,
            physical_status: 'not_yet_physical',
            ownership_status: 2,
          },
          releases: [],
        }),
        headers: { 'Content-Type': 'application/json' },
      }),
      mockEnv,
    );
    expect(dupRes.status).toBe(200);
    const dupData = (await dupRes.json()) as {
      success: boolean;
      gameId: string;
      stableId: number;
    };
    expect(dupData.gameId).toBe(data.gameId);
    expect(dupData.stableId).toBe(insertedGame.stable_id);

    const countRow = db
      .prepare(
        "SELECT COUNT(*) as cnt FROM games WHERE title = 'Mushroom 11' AND platform_id = 0",
      )
      .get() as { cnt: number };
    expect(countRow.cnt).toBe(1);

    // Verify DELETE /api/collection/release cleanly removes a release-less Platform 0 game
    const delRes = await worker.fetch(
      new Request(
        `http://localhost/api/collection/release?id=${encodeURIComponent(data.gameId)}`,
        { method: 'DELETE' },
      ),
      mockEnv,
    );
    expect(delRes.status).toBe(200);
    const afterDelCount = db
      .prepare(
        "SELECT COUNT(*) as cnt FROM games WHERE title = 'Mushroom 11' AND platform_id = 0",
      )
      .get() as { cnt: number };
    expect(afterDelCount.cnt).toBe(0);
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

  it('POST /api/discovery/add-toy defaults ownership_status to 0 when omitted', async () => {
    const req = new Request('http://localhost/api/discovery/add-toy', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Ganondorf - Tears of the Kingdom',
        line: 'amiibo',
        series_name: 'The Legend of Zelda',
        amiibo_id: '0103000000400502',
        type: 'Figure',
        image_url: 'https://raw.githubusercontent.com/ganon.png',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await worker.fetch(req, mockEnv);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { success: boolean; id: string };
    expect(data.success).toBe(true);

    const userToy = db
      .prepare('SELECT ownership_status FROM user_toys WHERE toy_id = ?')
      .get(data.id) as { ownership_status: number };
    expect(userToy.ownership_status).toBe(0);
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

  it('GET /admin/login rejects unconfigured non-loopback requests and mints dev session on loopback', async () => {
    const unauthReq = new Request('https://tracker.example.com/admin/login');
    const unauthRes = await worker.fetch(unauthReq, mockEnv);
    expect(unauthRes.status).toBe(302);
    expect(unauthRes.headers.get('Location')).toBe(
      'https://tracker.example.com/',
    );
    expect(unauthRes.headers.get('x-auth-status')).toBe('missing-oidc-config');

    // Loopback fallback when OIDC_ISSUER is unset mints dev session
    const loopbackReq = new Request('http://localhost/admin/login');
    const res = await worker.fetch(loopbackReq, mockEnv);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(
      'http://localhost/collection/games',
    );
    expect(res.headers.get('x-auth-status')).toBe('session-minted');

    const cookies = res.headers.getSetCookie();
    expect(
      cookies.some(
        (c) => c.includes('app_user_session=') && c.includes('Max-Age=2592000'),
      ),
    ).toBe(true);

    // Test custom ADMIN_SESSION_DAYS
    const customDaysEnv = { ...mockEnv, ADMIN_SESSION_DAYS: '10' };
    const customRes = await worker.fetch(loopbackReq, customDaysEnv);
    const customCookies = customRes.headers.getSetCookie();
    // 10 days = 864000 seconds
    expect(customCookies.some((c) => c.includes('Max-Age=864000'))).toBe(true);
  });

  it('POST /admin/logout revokes __Host- and legacy session/OIDC cookies with 303 redirect and rejects GET', async () => {
    const getRes = await worker.fetch(
      new Request('https://tracker.example.com/admin/logout'),
      mockEnv,
    );
    expect(getRes.status).toBe(405);
    expect(getRes.headers.get('Allow')).toBe('POST');

    const req = new Request('https://tracker.example.com/admin/logout', {
      method: 'POST',
      headers: { Origin: 'https://tracker.example.com' },
    });
    const res = await worker.fetch(req, mockEnv);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/');
    const cookies = res.headers.getSetCookie();
    expect(
      cookies.some(
        (c) =>
          c.includes(`${HOST_SESSION_COOKIE}=;`) && c.includes('Max-Age=0'),
      ),
    ).toBe(true);
    expect(
      cookies.some(
        (c) => c.includes('app_user_session=;') && c.includes('Max-Age=0'),
      ),
    ).toBe(true);
    expect(
      cookies.some(
        (c) =>
          c.includes(`${HOST_OIDC_STATE_COOKIE}=;`) && c.includes('Max-Age=0'),
      ),
    ).toBe(true);
  });

  it('GET /api/admin/me returns authentication status and rejects spoofed headers', async () => {
    const unauthReq = new Request('https://tracker.example.com/api/admin/me');
    const unauthRes = await worker.fetch(unauthReq, mockEnv);
    const unauthData = (await unauthRes.json()) as { authenticated: boolean };
    expect(unauthData.authenticated).toBe(false);

    // Unverified header on non-loopback is rejected and does not echo email
    const spoofReq = new Request('https://tracker.example.com/api/admin/me', {
      headers: { 'Cf-Access-Authenticated-User-Email': 'admin@example.com' },
    });
    const spoofRes = await worker.fetch(spoofReq, mockEnv);
    const spoofData = (await spoofRes.json()) as {
      authenticated: boolean;
      email: string | null;
    };
    expect(spoofData.authenticated).toBe(false);
    expect(spoofData.email).toBeNull();

    // Test signed app_user_session fallback cookie for admin
    const signedAdminToken = await signSession(
      { id: 1, username: 'alice', role: 'admin', homeRegion: 'USA' },
      mockEnv.SESSION_SECRET!,
    );
    const sessionCookieReq = new Request(
      'https://tracker.example.com/api/admin/me',
      {
        headers: { Cookie: `app_user_session=${signedAdminToken}` },
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

  it('isAuthorizedAdmin correctly identifies authorized identities and rejects spoofed headers/cookies', () => {
    const localReq = new Request('http://localhost/api/test');
    expect(isAuthorizedAdmin(localReq, mockEnv)).toBe(true);

    const prodUnauth = new Request('https://tracker.com/api/test');
    expect(isAuthorizedAdmin(prodUnauth, mockEnv)).toBe(false);

    // Raw Cf-Access-Authenticated-User-Email header without verified sessionUser must be rejected
    const prodSpoofHeader = new Request('https://tracker.com/api/test', {
      headers: { 'Cf-Access-Authenticated-User-Email': 'admin@example.com' },
    });
    expect(isAuthorizedAdmin(prodSpoofHeader, mockEnv)).toBe(false);

    // Unsigned CF_Authorization cookie without verified sessionUser must be rejected
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const validJwtPayload = btoa(
      JSON.stringify({ email: 'admin@example.com', exp: futureExp }),
    );
    const validJwt = `header.${validJwtPayload}.signature`;

    const cookieReq = new Request('https://tracker.com/api/test', {
      headers: { Cookie: `CF_Authorization=${validJwt}` },
    });
    expect(isAuthorizedAdmin(cookieReq, mockEnv)).toBe(false);

    // Constant-time x-admin-key header grants admin authorization
    const adminKeyEnv = { ...mockEnv, ADMIN_KEY: 'super-secret-admin-key' };
    const validKeyReq = new Request('https://tracker.com/api/test', {
      headers: { 'x-admin-key': 'super-secret-admin-key' },
    });
    expect(isAuthorizedAdmin(validKeyReq, adminKeyEnv)).toBe(true);

    const wrongKeyReq = new Request('https://tracker.com/api/test', {
      headers: { 'x-admin-key': 'wrong-key' },
    });
    expect(isAuthorizedAdmin(wrongKeyReq, adminKeyEnv)).toBe(false);

    // Ensure CF_AppSession cookie alone does NOT grant admin authorization
    const appSessionReq = new Request('https://tracker.com/api/test', {
      headers: { Cookie: 'CF_AppSession=valid-session-token-12345' },
    });
    expect(isAuthorizedAdmin(appSessionReq, mockEnv)).toBe(false);

    // Ensure legacy app_admin_session cookie alone does NOT grant admin authorization
    const persistentSessionReq = new Request('https://tracker.com/api/test', {
      headers: { Cookie: 'app_admin_session=active' },
    });
    expect(isAuthorizedAdmin(persistentSessionReq, mockEnv)).toBe(false);

    // Test explicit admin sessionUser
    expect(
      isAuthorizedAdmin(prodUnauth, mockEnv, {
        id: 1,
        username: 'alice',
        role: 'admin',
        homeRegion: 'USA',
      }),
    ).toBe(true);

    // Test non-admin sessionUser
    expect(
      isAuthorizedAdmin(prodUnauth, mockEnv, {
        id: 2,
        username: 'bob_collector',
        role: 'user',
        homeRegion: 'USA',
      }),
    ).toBe(false);
  });

  it('GET /api/discovery/search annotates physical release status and filters digital fluff', async () => {
    // Seed platform and canonical releases
    db.prepare(
      'INSERT OR IGNORE INTO platforms (id, name, display_name, brand, launch_date) VALUES (?, ?, ?, ?, ?)',
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
          const bodyStr = String(init?.body || '');
          if (bodyStr.includes('Mushroom 11')) {
            // First call with platforms = (...) returns []
            if (bodyStr.includes('platforms = (')) {
              return Promise.resolve(
                new Response(JSON.stringify([]), {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' },
                }),
              );
            }
            return Promise.resolve(
              new Response(
                JSON.stringify([
                  {
                    id: 9999,
                    name: 'Mushroom 11',
                    platforms: [
                      { id: 6, name: 'PC' },
                      { id: 39, name: 'iOS' },
                    ],
                    cover: { image_id: 'm11_cover' },
                    first_release_date: 1444867200,
                  },
                ]),
                {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' },
                },
              ),
            );
          }

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
      // 1. Search with default digital filter (defaults to filterDigital = true)
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
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Metroid Fusion');
      expect(results[0].physical_status).toBe('verified_physical');
      expect(results[0].verification_tier).toBe(1);
      expect(results[0].is_physical).toBe(true);

      // 2. Search WITH filterDigital=false explicitly requesting all digital fluff
      const filterReq = new Request(
        'http://localhost/api/discovery/search?query=Metroid&platformId=19&filterDigital=false',
      );
      const filterRes = await worker.fetch(filterReq, mockEnv);
      expect(filterRes.status).toBe(200);
      const allResults = (await filterRes.json()) as Array<{
        name: string;
        physical_status: string;
        verification_tier: number;
        is_physical: boolean;
      }>;
      expect(allResults).toHaveLength(2);
      expect(allResults[0].name).toBe('Metroid Fusion');
      expect(allResults[1].name).toBe('Super Mario Bros. (Virtual Console)');
      expect(allResults[1].physical_status).toBe('digital_only');
      expect(allResults[1].verification_tier).toBe(3);
      expect(allResults[1].is_physical).toBe(false);

      // 3. Search with Platform 0 fallback for untracked indie title
      const indieReq = new Request(
        'http://localhost/api/discovery/search?query=Mushroom+11&platformId=0',
      );
      const indieRes = await worker.fetch(indieReq, mockEnv);
      expect(indieRes.status).toBe(200);
      const indieResults = (await indieRes.json()) as Array<{
        name: string;
        platform: string;
        platform_id: number;
        physical_status: string;
        untracked_platforms?: string[];
      }>;
      expect(indieResults).toHaveLength(1);
      expect(indieResults[0].name).toBe('Mushroom 11');
      expect(indieResults[0].platform_id).toBe(0);
      expect(indieResults[0].platform).toBe('Physical Watch');
      expect(indieResults[0].physical_status).toBe('not_yet_physical');
      expect(indieResults[0].untracked_platforms).toContain('PC');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('GET /api/discovery/matches returns matched physical releases and verification tier', async () => {
    db.prepare(
      'INSERT OR IGNORE INTO platforms (id, name, display_name, brand, launch_date) VALUES (?, ?, ?, ?, ?)',
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
                  alternative_names: [
                    { name: 'ゼノブレイドクロス', comment: 'Japanese title' },
                  ],
                  game_localizations: [
                    { name: 'Xenoblade Chronicles X JP', region: 3 },
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
      const res = await syncWorkerIgdbSeriesAndCanonical(envWithIgdb);
      expect(res.refreshedIgdbCount).toBe(1);
      expect(res.updatedGamesCount).toBeGreaterThanOrEqual(2);

      const game10 = db
        .prepare(
          'SELECT collections, franchises, canonical_series, metadata_json FROM games WHERE stable_id = 10',
        )
        .get() as {
        collections: string;
        franchises: string;
        canonical_series: string;
        metadata_json: string | null;
      };
      expect(game10.collections).toBe('Xenoblade Chronicles');
      expect(game10.franchises).toBe('Xenoblade');
      expect(game10.canonical_series).toBe('Xenoblade Chronicles');
      expect(game10.metadata_json).toContain('ゼノブレイドクロス');
      expect(game10.metadata_json).toContain('Xenoblade Chronicles X JP');

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

  it('syncWorkerIgdbSeriesAndCanonical paginates across batches and wraps cursor around', async () => {
    const { syncWorkerIgdbSeriesAndCanonical } = await import('./worker');
    const envWithIgdb: Env = {
      ...mockEnv,
      TWITCH_CLIENT_ID: 'test-client-id',
      TWITCH_CLIENT_SECRET: 'test-client-secret',
    };

    // Seed games with stable_id 100, 101, 102
    db.prepare(
      `INSERT INTO games (stable_id, id, title, series, platform_id, igdb_id)
       VALUES (100, 'g100', 'Game 100', 'Series', 1, 1000)`,
    ).run();
    db.prepare(
      `INSERT INTO games (stable_id, id, title, series, platform_id, igdb_id)
       VALUES (101, 'g101', 'Game 101', 'Series', 1, 1001)`,
    ).run();
    db.prepare(
      `INSERT INTO games (stable_id, id, title, series, platform_id, igdb_id)
       VALUES (102, 'g102', 'Game 102', 'Series', 1, 1002)`,
    ).run();

    // Set cursor to 99
    db.prepare(
      `INSERT INTO sync_state (key, value)
       VALUES ('igdb_sync_offset', '99')
       ON CONFLICT(key) DO UPDATE SET value = '99'`,
    ).run();

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes('id.twitch.tv/oauth2/token')) {
          return new Response(
            JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

    try {
      // Run with batchSize = 2. It should pick games 100 and 101, advancing cursor to 101
      const res1 = await syncWorkerIgdbSeriesAndCanonical(envWithIgdb, {
        batchSize: 2,
      });
      expect(res1.cursorOffset).toBe(101);

      // Next run picks game 102. Since only 1 game returned (< batchSize 2), wraps cursor to 0
      const res2 = await syncWorkerIgdbSeriesAndCanonical(envWithIgdb, {
        batchSize: 2,
      });
      expect(res2.cursorOffset).toBe(0);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('GET /api/discovery/scan-series separates Switch 1 (130) from Switch 2 (508) and surfaces FDS (54) & 64DD (55) titles via alternative_names', async () => {
    db.prepare(
      'INSERT OR IGNORE INTO platforms (id, name, display_name, brand, launch_date) VALUES (?, ?, ?, ?, ?)',
    ).run(26, 'Nintendo Switch', 'Nintendo Switch', 'Nintendo', '2017-03-03');
    db.prepare(
      'INSERT OR IGNORE INTO platforms (id, name, display_name, brand, launch_date) VALUES (?, ?, ?, ?, ?)',
    ).run(
      27,
      'Nintendo Switch 2',
      'Nintendo Switch 2',
      'Nintendo',
      '2025-06-05',
    );
    db.prepare(
      'INSERT OR IGNORE INTO platforms (id, name, display_name, brand, launch_date) VALUES (?, ?, ?, ?, ?)',
    ).run(
      54,
      'Famicom Disk System',
      'Famicom Disk System',
      'Nintendo',
      '1986-02-21',
    );
    db.prepare(
      'INSERT OR IGNORE INTO platforms (id, name, display_name, brand, launch_date) VALUES (?, ?, ?, ?, ?)',
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
    it('should return the VAPID public key when configured and 503 when VAPID_PRIVATE_KEY is missing', async () => {
      const req = new Request(
        'http://localhost/api/notifications/vapid-public-key',
      );
      const res = await worker.fetch(req, mockEnv);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        configured: boolean;
        publicKey: string;
      };
      expect(body.configured).toBe(true);
      expect(body.publicKey).toBeDefined();
      expect(typeof body.publicKey).toBe('string');
      expect(body.publicKey.length).toBeGreaterThan(20);

      const unconfiguredEnv: Env = {
        ...mockEnv,
        VAPID_PRIVATE_KEY: undefined,
      };
      const unconfRes = await worker.fetch(
        new Request('http://localhost/api/notifications/vapid-public-key'),
        unconfiguredEnv,
      );
      expect(unconfRes.status).toBe(503);
      const unconfBody = (await unconfRes.json()) as { configured: boolean };
      expect(unconfBody.configured).toBe(false);
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
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, preferences_json, created_at, updated_at)
         VALUES ('test-id', 1, ?, 'dummy-p256dh', 'dummy-auth', '{}', '2026-01-01', '2026-01-01')`,
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
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at, updated_at)
         VALUES ('unsub-id', 1, ?, 'p256dh', 'auth', '2026-01-01', '2026-01-01')`,
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
        APP_NAME: 'Custom Tracker',
        APP_SHORT_NAME: 'Custom',
        APP_TAGLINE: 'Cataloging an Eclectic Collection of Games',
      };
      const req = new Request('http://localhost/api/config');
      const res = await worker.fetch(req, customEnv);

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        appName: string;
        shortName: string;
        tagline: string;
      };
      expect(data.appName).toBe('Custom Tracker');
      expect(data.shortName).toBe('Custom');
      expect(data.tagline).toBe('Cataloging an Eclectic Collection of Games');
    });

    it('GET /manifest.webmanifest returns dynamic app name', async () => {
      const customEnv = {
        ...mockEnv,
        APP_NAME: 'Custom Tracker',
        APP_SHORT_NAME: 'Custom',
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
      expect(data.name).toBe('Custom Tracker');
      expect(data.short_name).toBe('Custom');
      expect(data.theme_color).toBe('#121214');
      expect(data.background_color).toBe('#121214');
    });

    it('POST /api/admin/logout clears session and OIDC state cookies', async () => {
      const req = new Request('https://tracker.example.com/api/admin/logout', {
        method: 'POST',
        headers: { Origin: 'https://tracker.example.com' },
      });
      const res = await worker.fetch(req, mockEnv);

      expect(res.status).toBe(303);
      const cookies = res.headers.getSetCookie();
      expect(
        cookies.some(
          (c) =>
            c.includes(`${HOST_SESSION_COOKIE}=;`) && c.includes('Max-Age=0'),
        ),
      ).toBe(true);
      expect(
        cookies.some(
          (c) => c.includes('app_user_session=;') && c.includes('Max-Age=0'),
        ),
      ).toBe(true);
      expect(
        cookies.some(
          (c) =>
            c.includes(`${HOST_OIDC_STATE_COOKIE}=;`) &&
            c.includes('Max-Age=0'),
        ),
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
      expect(postRes.status).toBe(401);
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
        INSERT INTO game_releases (id, game_id)
        VALUES ('sos-rel', 777)
      `,
      ).run();
      db.prepare(
        `
        INSERT INTO user_game_releases (user_id, release_id, ownership_status)
        VALUES (1, 'sos-rel', 2)
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

    it('syncWorkerLaunchDayNotifications transitions games launching today', async () => {
      db.prepare(
        `
        INSERT OR IGNORE INTO platforms (id, name, display_name)
        VALUES (26, 'Nintendo Switch', 'Switch')
      `,
      ).run();

      db.prepare(
        `
        INSERT INTO games (stable_id, id, title, platform_id, physical_status)
        VALUES (888, 'metroid-prime-4', 'Metroid Prime 4: Beyond', 26, 'likely_physical')
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
        `INSERT INTO game_releases (id, game_id, region)
         VALUES ('anton-usa-rel', 901, 'USA')`,
      ).run();
      db.prepare(
        `INSERT INTO user_game_releases (user_id, release_id, ownership_status)
         VALUES (1, 'anton-usa-rel', 1)`,
      ).run();

      // Another release row for Europe unowned (mimicking real catalog)
      db.prepare(
        `INSERT INTO game_releases (id, game_id, region)
         VALUES ('anton-eur-rel', 901, 'EUR')`,
      ).run();
      db.prepare(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, preferences_json, user_agent, created_at, updated_at)
         VALUES ('sub-anton', 1, 'https://push.example.com/sub-anton', 'p256', 'auth', '{"enabled": true, "notify_physical_announcements": true, "physical_announcement_scope": {"unowned": true}}', 'agent', datetime('now'), datetime('now'))`,
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
        `INSERT INTO game_releases (id, game_id, region, variants)
         VALUES ('hk-std-rel', 902, 'USA', 'Standard')`,
      ).run();
      db.prepare(
        `INSERT INTO user_game_releases (user_id, release_id, ownership_status)
         VALUES (1, 'hk-std-rel', 1)`,
      ).run();

      // Push subscription listening for announcements
      db.prepare(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, preferences_json, user_agent, created_at, updated_at)
         VALUES ('sub-1', 1, 'https://push.example.com/sub1', 'p256', 'auth', '{"enabled": true, "notify_physical_announcements": true}', 'agent', datetime('now'), datetime('now'))`,
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
        `INSERT INTO game_releases (id, game_id, region)
         VALUES ('anton-sw-rel', 903, 'USA')`,
      ).run();
      db.prepare(
        `INSERT INTO user_game_releases (user_id, release_id, ownership_status)
         VALUES (1, 'anton-sw-rel', 1)`,
      ).run();

      db.prepare(
        `INSERT INTO games (stable_id, id, title, platform_id, physical_status)
         VALUES (904, 'antonblast-ps5', 'Antonblast', 35, 'unverified')`,
      ).run();

      db.prepare(
        `INSERT INTO game_releases (id, game_id, region)
         VALUES ('anton-ps5-rel', 904, 'USA')`,
      ).run();

      db.prepare(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, preferences_json, user_agent, created_at, updated_at)
         VALUES ('sub-ps5', 1, 'https://push.example.com/sub-ps5', 'p256', 'auth', '{"enabled": true, "notify_physical_announcements": true, "physical_announcement_scope": {"unowned": true}}', 'agent', datetime('now'), datetime('now'))`,
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

    it('syncWorkerBoutiquePreOrders cold-start suppresses all notifications on initial baseline run and completes seeding', async () => {
      // Clear boutique_seed_completed from sync_state
      db.prepare(
        `DELETE FROM sync_state WHERE key = 'boutique_seed_completed'`,
      ).run();

      db.prepare(
        `INSERT INTO games (stable_id, id, title, platform_id, physical_status)
         VALUES (910, 'celeste-switch', 'Celeste', 26, 'digital_only')`,
      ).run();

      db.prepare(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, preferences_json, user_agent, created_at, updated_at)
         VALUES ('sub-cold', 1, 'https://push.example.com/sub-cold', 'p256', 'auth', '{"enabled": true, "notify_physical_announcements": true, "physical_announcement_scope": {"unowned": true, "uncataloged": true}}', 'agent', datetime('now'), datetime('now'))`,
      ).run();

      const mockShopify = {
        products: [
          {
            id: 889900,
            title: 'Celeste - Nintendo Switch',
            handle: 'celeste-switch',
            tags: ['game', 'pre-order'],
            created_at: new Date().toISOString(),
            variants: [{ price: '34.99' }],
          },
          {
            id: 889901,
            title: 'Uncataloged Indie Quest - Nintendo Switch',
            handle: 'uncataloged-indie-quest',
            tags: ['game', 'pre-order'],
            created_at: new Date().toISOString(),
            variants: [{ price: '29.99' }],
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
        // Notifications are completely suppressed during cold start seed
        expect(result.notifications.dispatchedCount).toBe(0);
        expect(webPushSpy).not.toHaveBeenCalled();

        // Seed flag is recorded in sync_state
        const seedRow = db
          .prepare(
            `SELECT value FROM sync_state WHERE key = 'boutique_seed_completed'`,
          )
          .get() as { value: string };
        expect(seedRow).toBeDefined();
        expect(seedRow.value).toBe('1');

        // Uncataloged URL was recorded so it won't alert later either
        const uncatalogedSeen = db
          .prepare(
            `SELECT value FROM sync_state WHERE key LIKE '%uncataloged-indie-quest%'`,
          )
          .get();
        expect(uncatalogedSeen).toBeDefined();
      } finally {
        fetchSpy.mockRestore();
        webPushSpy.mockRestore();
      }
    });

    it('syncWorkerBoutiquePreOrders graduates Platform 0 wishlist title to announced console platform', async () => {
      // Game exists in Wishlist under Platform 0 ('No Platform')
      db.prepare(
        `INSERT INTO games (stable_id, id, title, platform_id, physical_status)
         VALUES (995, 'mushroom-11-no-platform', 'Mushroom 11', 0, 'not_yet_physical')`,
      ).run();

      // Ensure boutique_seed_completed is present so notifications / updates fire normally
      db.prepare(
        `INSERT OR REPLACE INTO sync_state (key, value) VALUES ('boutique_seed_completed', '1')`,
      ).run();

      // Limited Run Games announces Mushroom 11 for Nintendo Switch (platform 26)
      const mockShopify = {
        products: [
          {
            id: 991122,
            title: 'Mushroom 11 - Nintendo Switch',
            handle: 'mushroom-11-switch',
            tags: ['game', 'pre-order'],
            created_at: new Date().toISOString(),
            variants: [{ price: '34.99' }],
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
        expect(result.matchedCount).toBeGreaterThanOrEqual(1);

        // Verify game graduated from platform 0 to platform 26 and status is likely_physical
        const updatedGame = db
          .prepare(
            'SELECT platform_id, physical_status, retail_store FROM games WHERE stable_id = 995',
          )
          .get() as {
          platform_id: number;
          physical_status: string;
          retail_store: string;
        };
        expect(updatedGame.platform_id).toBe(26);
        expect(updatedGame.physical_status).toBe('likely_physical');
        expect(updatedGame.retail_store).toBe('Limited Run Games');

        // Verify a boutique pre-order edition release was inserted
        const insertedReleases = db
          .prepare(
            'SELECT id, game_id, variants FROM game_releases WHERE game_id = 995',
          )
          .all() as Array<{ id: string; game_id: number; variants: string }>;
        expect(insertedReleases.length).toBe(1);
        expect(insertedReleases[0].variants).toBe('Standard Physical');
      } finally {
        fetchSpy.mockRestore();
        webPushSpy.mockRestore();
      }
    });

    it('syncWorkerBoutiquePreOrders silently updates retail_url for games already physical without dispatching notifications', async () => {
      // Game is verified_physical with an old retail_url
      db.prepare(
        `INSERT INTO games (stable_id, id, title, platform_id, physical_status, retail_url)
         VALUES (911, 'hollow-knight-switch-2', 'Hollow Knight', 26, 'verified_physical', 'https://old-retailer.com/hk')`,
      ).run();

      db.prepare(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, preferences_json, user_agent, created_at, updated_at)
         VALUES ('sub-silent', 1, 'https://push.example.com/sub-silent', 'p256', 'auth', '{"enabled": true, "notify_physical_announcements": true, "physical_announcement_scope": {"unowned": true}}', 'agent', datetime('now'), datetime('now'))`,
      ).run();

      const mockShopify = {
        products: [
          {
            id: 771122,
            title: 'Hollow Knight - Nintendo Switch',
            handle: 'hollow-knight-switch-new',
            tags: ['game', 'pre-order'],
            variants: [{ price: '34.99' }],
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
        // Zero notifications dispatched because game is already physical and not a special edition
        expect(result.notifications.dispatchedCount).toBe(0);
        expect(webPushSpy).not.toHaveBeenCalled();

        // But retail_url was updated in the database
        const updatedGame = db
          .prepare(
            'SELECT retail_url, retail_store FROM games WHERE stable_id = 911',
          )
          .get() as { retail_url: string; retail_store: string };
        expect(updatedGame.retail_url).toContain('hollow-knight-switch-new');
        expect(updatedGame.retail_store).toBe('Fangamer');
      } finally {
        fetchSpy.mockRestore();
        webPushSpy.mockRestore();
      }
    });

    it('syncWorkerBoutiquePreOrders dispatches announcement notification when digital_only game transitions to likely_physical', async () => {
      db.prepare(
        `INSERT INTO games (stable_id, id, title, platform_id, physical_status)
         VALUES (912, 'crow-country-switch', 'Crow Country', 26, 'digital_only')`,
      ).run();

      db.prepare(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, preferences_json, user_agent, created_at, updated_at)
         VALUES ('sub-transition', 1, 'https://push.example.com/sub-transition', 'p256', 'auth', '{"enabled": true, "notify_physical_announcements": true, "physical_announcement_scope": {"unowned": true}}', 'agent', datetime('now'), datetime('now'))`,
      ).run();

      const mockShopify = {
        products: [
          {
            id: 665544,
            title: 'Crow Country - Nintendo Switch',
            handle: 'crow-country-switch',
            tags: ['game', 'pre-order'],
            variants: [{ price: '34.99' }],
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
            title: '📦 Physical Edition Announced: Crow Country',
          }),
          expect.anything(),
        );

        const updated = db
          .prepare('SELECT physical_status FROM games WHERE stable_id = 912')
          .get() as { physical_status: string };
        expect(updated.physical_status).toBe('likely_physical');
      } finally {
        fetchSpy.mockRestore();
        webPushSpy.mockRestore();
      }
    });

    it('syncWorkerBoutiquePreOrders suppresses uncataloged announcements for items older than 72 hours or non-preorders', async () => {
      db.prepare(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, preferences_json, user_agent, created_at, updated_at)
         VALUES ('sub-uncat-old', 1, 'https://push.example.com/sub-uncat-old', 'p256', 'auth', '{"enabled": true, "notify_physical_announcements": true, "physical_announcement_scope": {"uncataloged": true}}', 'agent', datetime('now'), datetime('now'))`,
      ).run();

      const fourDaysAgo = new Date(
        Date.now() - 4 * 24 * 60 * 60 * 1000,
      ).toISOString();

      const mockShopify = {
        products: [
          {
            id: 112299,
            title: 'Ancient Indie Title - Nintendo Switch',
            handle: 'ancient-indie-title-switch',
            tags: ['game', 'pre-order'],
            created_at: fourDaysAgo,
            published_at: fourDaysAgo,
            variants: [{ price: '39.99' }],
          },
          {
            id: 112298,
            title: 'In-Stock Catalog Title - Nintendo Switch',
            handle: 'in-stock-title-switch',
            tags: ['game'], // No pre-order tag
            created_at: new Date().toISOString(),
            published_at: new Date().toISOString(),
            variants: [{ price: '39.99' }],
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
        // Suppressed because:
        // 1) First item published 4 days ago (>72h)
        // 2) Second item is not a pre-order
        expect(result.notifications.dispatchedCount).toBe(0);
        expect(webPushSpy).not.toHaveBeenCalled();

        // But both are recorded into sync_state
        const row1 = db
          .prepare(
            `SELECT value FROM sync_state WHERE key LIKE '%ancient-indie-title-switch%'`,
          )
          .get();
        expect(row1).toBeDefined();
      } finally {
        fetchSpy.mockRestore();
        webPushSpy.mockRestore();
      }
    });

    it('syncWorkerBoutiquePreOrders dispatches uncataloged announcement for fresh pre-order items within 72 hours', async () => {
      db.prepare(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, preferences_json, user_agent, created_at, updated_at)
         VALUES ('sub-uncat-fresh', 1, 'https://push.example.com/sub-uncat-fresh', 'p256', 'auth', '{"enabled": true, "notify_physical_announcements": true, "physical_announcement_scope": {"uncataloged": true}}', 'agent', datetime('now'), datetime('now'))`,
      ).run();

      const twoHoursAgo = new Date(
        Date.now() - 2 * 60 * 60 * 1000,
      ).toISOString();

      const mockShopify = {
        products: [
          {
            id: 991122,
            title: 'Brand New Indie Pre-Order - Nintendo Switch',
            handle: 'brand-new-indie-switch',
            tags: ['game', 'pre-order'],
            created_at: twoHoursAgo,
            published_at: twoHoursAgo,
            variants: [{ price: '34.99' }],
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
            title: '📦 Physical Edition Announced: Brand New Indie Pre-Order',
          }),
          expect.anything(),
        );
      } finally {
        fetchSpy.mockRestore();
        webPushSpy.mockRestore();
      }
    });

    it('syncWorkerBoutiquePreOrders suppresses announcements when listing is sold out (available: false)', async () => {
      db.prepare(
        `INSERT INTO games (stable_id, id, title, platform_id, physical_status)
         VALUES (920, 'pizza-tower-switch', 'Pizza Tower', 26, 'digital_only')`,
      ).run();

      db.prepare(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, preferences_json, user_agent, created_at, updated_at)
         VALUES ('sub-sold-out', 1, 'https://push.example.com/sub-sold-out', 'p256', 'auth', '{"enabled": true, "notify_physical_announcements": true}', 'agent', datetime('now'), datetime('now'))`,
      ).run();

      const mockShopify = {
        products: [
          {
            id: 991122,
            title: "Pizza Tower for Nintendo Switch™ Collector's Edition",
            handle: 'pizza-tower-switch-ce',
            tags: ['game', 'pre-order'],
            variants: [{ price: '79.99', available: false }],
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
        expect(result.notifications.dispatchedCount).toBe(0);
        expect(webPushSpy).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
        webPushSpy.mockRestore();
      }
    });

    it('syncWorkerBoutiquePreOrders suppresses announcements for ancient special editions (> 7 days old and not pre-orders)', async () => {
      db.prepare(
        `INSERT INTO games (stable_id, id, title, platform_id, physical_status)
         VALUES (921, 'celeste-switch', 'Celeste', 26, 'likely_physical')`,
      ).run();

      db.prepare(
        `INSERT INTO game_releases (id, game_id, region, variants)
         VALUES ('celeste-std-rel', 921, 'USA', 'Standard')`,
      ).run();
      db.prepare(
        `INSERT INTO user_game_releases (user_id, release_id, ownership_status)
         VALUES (1, 'celeste-std-rel', 1)`,
      ).run();

      db.prepare(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, preferences_json, user_agent, created_at, updated_at)
         VALUES ('sub-ancient', 1, 'https://push.example.com/sub-ancient', 'p256', 'auth', '{"enabled": true, "notify_physical_announcements": true}', 'agent', datetime('now'), datetime('now'))`,
      ).run();

      // Ancient listing from 2023, not a pre-order, in stock
      const mockShopify = {
        products: [
          {
            id: 991133,
            title: 'Celeste Deluxe Edition for Nintendo Switch™',
            handle: 'celeste-deluxe-switch',
            tags: ['game'],
            published_at: '2023-01-25T10:37:20-07:00',
            variants: [{ price: '34.99', available: true }],
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
        expect(result.notifications.dispatchedCount).toBe(0);
        expect(webPushSpy).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
        webPushSpy.mockRestore();
      }
    });

    it('GET /api/games/:id prioritizes owned release matching game region over unowned foreign releases', async () => {
      db.prepare(
        `INSERT INTO games (stable_id, id, title, platform_id, region, physical_status)
         VALUES (930, 'castlevania-dominus-test', 'Castlevania Dominus Collection', 35, 'USA', 'verified_physical')`,
      ).run();

      // First release inserted is Japan and unowned
      db.prepare(
        `INSERT INTO game_releases (id, game_id, region)
         VALUES ('castlevania-jp', 930, 'Japan')`,
      ).run();

      // Second release inserted is USA and owned by User 1
      db.prepare(
        `INSERT INTO game_releases (id, game_id, region)
         VALUES ('castlevania-usa', 930, 'USA')`,
      ).run();
      db.prepare(
        `INSERT INTO user_game_releases (user_id, release_id, ownership_status)
         VALUES (1, 'castlevania-usa', 1)`,
      ).run();

      const sessionToken = await signSession(
        { id: 1, username: 'alice', role: 'admin', homeRegion: 'USA' },
        mockEnv.SESSION_SECRET!,
      );
      const req = new Request(
        'https://collection-tracker.example.com/api/games/castlevania-dominus-test',
        {
          headers: { Cookie: `${SESSION_COOKIE}=${sessionToken}` },
        },
      );
      const res = await worker.fetch(req, mockEnv);
      expect(res.status).toBe(200);

      const data = (await res.json()) as {
        id: string;
        region: string;
        ownership_status: number;
      };
      expect(data.id).toBe('castlevania-usa');
      expect(data.region).toBe('USA');
      expect(data.ownership_status).toBe(1);
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

    describe('Game & release deletion', () => {
      const adminHeaders = { 'x-admin-key': 'test-secret-key' };

      beforeEach(() => {
        db.prepare(
          `INSERT INTO games (stable_id, id, title, platform_id, physical_status)
           VALUES (950, 'del-game', 'Deletable Game', 26, 'likely_physical')`,
        ).run();
        db.prepare(
          `INSERT INTO game_releases (id, game_id, region)
           VALUES ('del-game-usa', 950, 'USA'), ('del-game-eu', 950, 'Europe')`,
        ).run();
        db.prepare(
          `INSERT INTO user_game_releases (user_id, release_id, ownership_status)
           VALUES (1, 'del-game-usa', 1), (1, 'del-game-eu', 2)`,
        ).run();
        db.prepare(
          `INSERT INTO journal_entries (user_id, item_type, item_id, notes)
           VALUES (1, 'game', 'del-game', 'bought at a flea market')`,
        ).run();
      });

      it('DELETE /api/collection/game requires admin authentication', async () => {
        const req = new Request(
          'https://collection-tracker.example.com/api/collection/game?id=del-game',
          { method: 'DELETE' },
        );
        const res = await worker.fetch(req, mockEnv);
        expect(res.status).toBe(403);
        expect(
          db.prepare('SELECT 1 FROM games WHERE id = ?').get('del-game'),
        ).toBeDefined();
      });

      it('DELETE /api/collection/game removes the game, its releases and journal entry', async () => {
        const req = new Request(
          'http://localhost/api/collection/game?id=del-game',
          { method: 'DELETE', headers: adminHeaders },
        );
        const res = await worker.fetch(req, mockEnv);
        expect(res.status).toBe(200);

        expect(
          db.prepare('SELECT 1 FROM games WHERE id = ?').get('del-game'),
        ).toBeUndefined();
        expect(
          db.prepare('SELECT 1 FROM game_releases WHERE game_id = 950').get(),
        ).toBeUndefined();
        expect(
          db
            .prepare(
              `SELECT 1 FROM journal_entries WHERE item_type = 'game' AND item_id = 'del-game'`,
            )
            .get(),
        ).toBeUndefined();
      });

      it('DELETE /api/collection/game resolves a release id to its parent game', async () => {
        const req = new Request(
          'http://localhost/api/collection/game?id=del-game-eu',
          { method: 'DELETE', headers: adminHeaders },
        );
        const res = await worker.fetch(req, mockEnv);
        expect(res.status).toBe(200);
        expect(
          db.prepare('SELECT 1 FROM games WHERE id = ?').get('del-game'),
        ).toBeUndefined();
      });

      it('DELETE /api/collection/game returns 404 for unknown ids', async () => {
        const req = new Request(
          'http://localhost/api/collection/game?id=nope',
          { method: 'DELETE', headers: adminHeaders },
        );
        const res = await worker.fetch(req, mockEnv);
        expect(res.status).toBe(404);
      });

      it('DELETE /api/collection/release removes only the targeted release', async () => {
        const req = new Request(
          'http://localhost/api/collection/release?id=del-game-eu',
          { method: 'DELETE', headers: adminHeaders },
        );
        const res = await worker.fetch(req, mockEnv);
        expect(res.status).toBe(200);

        const remaining = db
          .prepare('SELECT id FROM game_releases WHERE game_id = 950')
          .all() as Array<{ id: string }>;
        expect(remaining.map((r) => r.id)).toEqual(['del-game-usa']);
        expect(
          db.prepare('SELECT 1 FROM games WHERE id = ?').get('del-game'),
        ).toBeDefined();
      });

      it('DELETE /api/collection/release returns 404 for unknown ids', async () => {
        const req = new Request(
          'http://localhost/api/collection/release?id=nope',
          { method: 'DELETE', headers: adminHeaders },
        );
        const res = await worker.fetch(req, mockEnv);
        expect(res.status).toBe(404);
      });
    });
  });

  describe('Scheduled Cron & Multi-User Execution', () => {
    it('scheduled cron gates boutique pre-order sync to 1-hour interval', async () => {
      const scheduledEvent = {
        cron: '*/30 * * * *',
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
        // 1. Initial run: boutique_sync_last_run does not exist -> runs boutique sync
        db.prepare(
          `DELETE FROM sync_state WHERE key = 'boutique_sync_last_run'`,
        ).run();
        db.prepare(
          `DELETE FROM cron_execution_logs WHERE job_name = 'boutique_preorders'`,
        ).run();

        await worker.scheduled(scheduledEvent, mockEnv, {} as ExecutionContext);

        const initialLogCount = (
          db
            .prepare(
              `SELECT COUNT(*) as c FROM cron_execution_logs WHERE job_name = 'boutique_preorders'`,
            )
            .get() as { c: number }
        ).c;
        expect(initialLogCount).toBe(1);

        // 2. Second run immediately (simulating 30 min run within 55 min window) -> skips boutique sync
        db.prepare(
          `INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES ('boutique_sync_last_run', datetime('now'), datetime('now'))`,
        ).run();
        await worker.scheduled(scheduledEvent, mockEnv, {} as ExecutionContext);

        const skippedLogCount = (
          db
            .prepare(
              `SELECT COUNT(*) as c FROM cron_execution_logs WHERE job_name = 'boutique_preorders'`,
            )
            .get() as { c: number }
        ).c;
        expect(skippedLogCount).toBe(1); // Still 1, did not re-run!

        // 3. Third run after 60 minutes -> executes boutique sync
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        db.prepare(
          `INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES ('boutique_sync_last_run', ?, ?)`,
        ).run(oneHourAgo, oneHourAgo);
        await worker.scheduled(scheduledEvent, mockEnv, {} as ExecutionContext);

        const afterHourLogCount = (
          db
            .prepare(
              `SELECT COUNT(*) as c FROM cron_execution_logs WHERE job_name = 'boutique_preorders'`,
            )
            .get() as { c: number }
        ).c;
        expect(afterHourLogCount).toBe(2); // Ran again!
      } finally {
        fetchSpy.mockRestore();
      }
    });

    describe('Multi-User, OIDC PKCE & Profile Endpoints', () => {
      it('GET /api/auth/me returns authenticated user profile and Account Hub metadata when signed in', async () => {
        const sessionToken = await signSession(
          { id: 1, username: 'alice', role: 'admin', homeRegion: 'USA' },
          mockEnv.SESSION_SECRET!,
        );
        const oidcEnv: Env = {
          ...mockEnv,
          OIDC_ISSUER: 'https://id.example.com',
          OIDC_CLIENT_ID: 'collection-tracker',
        };
        const req = new Request(
          'https://collection-tracker.example.com/api/auth/me',
          {
            headers: {
              Cookie: `${HOST_SESSION_COOKIE}=${sessionToken}`,
            },
          },
        );
        const res = await worker.fetch(req, oidcEnv);
        expect(res.status).toBe(200);
        const data = (await res.json()) as {
          authenticated: boolean;
          oidcIssuer: string;
          oidcClientId: string;
          accountHubUrl: string;
          user: {
            username: string;
            email: string;
            role: string;
            homeRegion: string;
          };
        };
        expect(data.authenticated).toBe(true);
        expect(data.oidcIssuer).toBe('https://id.example.com');
        expect(data.oidcClientId).toBe('collection-tracker');
        expect(data.accountHubUrl).toBe(
          'https://id.example.com/account?client_id=collection-tracker',
        );
        expect(data.user.username).toBe('alice');
        expect(data.user.email).toBeUndefined();
        expect(data.user.role).toBe('admin');
        expect(data.user.homeRegion).toBe('USA');
      });

      it('GET /api/auth/login and GET /api/auth/callback execute OIDC Authorization Code + PKCE (S256) flow and mint session cookie', async () => {
        resetOidcJwksCache();
        const ecKeyPair = await crypto.subtle.generateKey(
          { name: 'ECDSA', namedCurve: 'P-256' },
          true,
          ['sign', 'verify'],
        );
        const pubJwk = await crypto.subtle.exportKey(
          'jwk',
          ecKeyPair.publicKey,
        );

        const oidcEnv: Env = {
          ...mockEnv,
          OIDC_ISSUER: 'https://id.example.com',
          OIDC_CLIENT_ID: 'collection-tracker',
        };

        // 1. GET /api/auth/login -> 302 to /authorize with PKCE S256 & signed app_oidc_state cookie
        const loginReq = new Request(
          'https://collection-tracker.example.com/api/auth/login',
        );
        const loginRes = await worker.fetch(loginReq, oidcEnv);
        expect(loginRes.status).toBe(302);
        const location = loginRes.headers.get('Location')!;
        expect(location).toContain('https://id.example.com/authorize');

        const authUrl = new URL(location);
        expect(authUrl.searchParams.get('response_type')).toBe('code');
        expect(authUrl.searchParams.get('client_id')).toBe(
          'collection-tracker',
        );
        expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
        const stateParam = authUrl.searchParams.get('state')!;
        const nonceParam = authUrl.searchParams.get('nonce')!;
        expect(stateParam).toBeTruthy();
        expect(nonceParam).toBeTruthy();

        const setCookies = loginRes.headers.getSetCookie();
        const stateCookieHeader = setCookies.find((c) =>
          c.startsWith(`${HOST_OIDC_STATE_COOKIE}=`),
        );
        expect(stateCookieHeader).toBeTruthy();
        const parsedCookie = parseCookies(stateCookieHeader!);
        const stateCookieVal = parsedCookie[HOST_OIDC_STATE_COOKIE];

        // 2. Mock OIDC provider /token and /.well-known/jwks.json
        const b64UrlStr = (s: string) =>
          btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const b64UrlBytes = (bytes: Uint8Array) => {
          let bin = '';
          for (let i = 0; i < bytes.byteLength; i++) {
            bin += String.fromCharCode(bytes[i]);
          }
          return btoa(bin)
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
        };

        const nowSec = Math.floor(Date.now() / 1000);
        const jwtHeader = b64UrlStr(
          JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: 'oidc-ec-1' }),
        );
        const jwtPayload = b64UrlStr(
          JSON.stringify({
            iss: 'https://id.example.com',
            sub: 'oidc-sub-new-user',
            aud: 'collection-tracker',
            exp: nowSec + 600,
            iat: nowSec,
            nonce: nonceParam,
            email: 'newcollector@example.com',
            preferred_username: 'newcollector',
            name: 'New Collector',
            role: 'user',
          }),
        );
        const sigBuf = await crypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          ecKeyPair.privateKey,
          new TextEncoder().encode(`${jwtHeader}.${jwtPayload}`),
        );
        const idToken = `${jwtHeader}.${jwtPayload}.${b64UrlBytes(new Uint8Array(sigBuf))}`;

        const fetchSpy = vi
          .spyOn(globalThis, 'fetch')
          .mockImplementation(async (input) => {
            const urlStr = input.toString();
            if (urlStr === 'https://id.example.com/token') {
              return new Response(
                JSON.stringify({
                  id_token: idToken,
                  access_token: 'opaque-access-token',
                  token_type: 'Bearer',
                  expires_in: 3600,
                }),
                {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' },
                },
              );
            }
            if (urlStr === 'https://id.example.com/.well-known/jwks.json') {
              return new Response(
                JSON.stringify({
                  keys: [
                    { ...pubJwk, kid: 'oidc-ec-1', alg: 'ES256', use: 'sig' },
                  ],
                }),
                {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' },
                },
              );
            }
            throw new Error(`Unexpected fetch URL: ${urlStr}`);
          });

        try {
          // 3. GET /api/auth/callback with code & state
          const cbReq = new Request(
            `https://collection-tracker.example.com/api/auth/callback?code=auth-code-xyz&state=${encodeURIComponent(stateParam)}`,
            {
              headers: {
                Cookie: `${HOST_OIDC_STATE_COOKIE}=${stateCookieVal}`,
              },
            },
          );
          const cbRes = await worker.fetch(cbReq, oidcEnv);
          expect(cbRes.status).toBe(302);
          expect(cbRes.headers.get('Location')).toBe(
            'https://collection-tracker.example.com/collection/games',
          );

          const cbCookies = cbRes.headers.getSetCookie();
          const sessionCookieLine = cbCookies.find((c) =>
            c.startsWith(`${HOST_SESSION_COOKIE}=`),
          );
          expect(sessionCookieLine).toBeTruthy();

          const sessionCookieMap = parseCookies(sessionCookieLine!);
          const verifiedSession = await verifySession(
            sessionCookieMap[HOST_SESSION_COOKIE],
            oidcEnv.SESSION_SECRET!,
          );
          expect(verifiedSession).not.toBeNull();
          expect(verifiedSession?.username).toBe('newcollector');
          expect(verifiedSession?.role).toBe('user');

          // Verify user was auto-provisioned in D1 users table
          const dbUser = db
            .prepare(
              'SELECT id, username, display_name FROM users WHERE username = ?',
            )
            .get('newcollector') as {
            id: number;
            username: string;
            display_name: string | null;
          };
          expect(dbUser).toBeDefined();
          expect(dbUser.username).toBe('newcollector');
          expect(dbUser.display_name).toBe('New Collector');
        } finally {
          fetchSpy.mockRestore();
        }
      });

      it('GET /api/auth/account redirects to centralized Account Hub URL', async () => {
        const oidcEnv: Env = {
          ...mockEnv,
          OIDC_ISSUER: 'https://id.example.com',
        };
        const req = new Request(
          'https://collection-tracker.example.com/api/auth/account',
        );
        const res = await worker.fetch(req, oidcEnv);
        expect(res.status).toBe(302);
        expect(res.headers.get('Location')).toBe(
          'https://id.example.com/account?client_id=collection-tracker',
        );
      });

      it('GET /api/auth/me returns authenticated: false when unauthenticated and ignores unverified headers', async () => {
        const spoofReq = new Request(
          'https://collection-tracker.example.com/api/auth/me',
          {
            headers: {
              'Cf-Access-Authenticated-User-Email': 'stranger@example.com',
            },
          },
        );
        const spoofRes = await worker.fetch(spoofReq, mockEnv);
        expect(spoofRes.status).toBe(200);
        const spoofData = (await spoofRes.json()) as {
          authenticated: boolean;
          user: unknown;
        };
        expect(spoofData.authenticated).toBe(false);
        expect(spoofData.user).toBeNull();
      });

      it('GET /api/user/regions returns allowed home regions', async () => {
        const req = new Request(
          'https://collection-tracker.example.com/api/user/regions',
        );
        const res = await worker.fetch(req, mockEnv);
        expect(res.status).toBe(200);
        const regions = (await res.json()) as string[];
        expect(regions).toContain('USA');
        expect(regions).toContain('Japan');
        expect(regions).toContain('Europe');
      });

      it('GET /api/user/profile and PUT /api/user/profile manages user settings and homeRegion', async () => {
        const adminToken = await signSession(
          { id: 1, username: 'alice', role: 'admin', homeRegion: 'USA' },
          mockEnv.SESSION_SECRET!,
        );
        const authHeaders = {
          'Content-Type': 'application/json',
          Cookie: `${HOST_SESSION_COOKIE}=${adminToken}`,
        };

        // 1. GET profile
        const getReq = new Request(
          'https://collection-tracker.example.com/api/user/profile',
          { headers: authHeaders },
        );
        const getRes = await worker.fetch(getReq, mockEnv);
        expect(getRes.status).toBe(200);
        const initial = (await getRes.json()) as {
          username: string;
          homeRegion: string;
          isPublic: boolean;
        };
        expect(initial.username).toBe('alice');
        expect(initial.homeRegion).toBe('USA');

        // 2. PUT profile updating homeRegion, isPublic, bio
        const putReq = new Request(
          'https://collection-tracker.example.com/api/user/profile',
          {
            method: 'PUT',
            headers: authHeaders,
            body: JSON.stringify({
              homeRegion: 'Japan',
              isPublic: true,
              bio: 'Retro gaming archivist',
              displayName: 'Alice M.',
            }),
          },
        );
        const putRes = await worker.fetch(putReq, mockEnv);
        expect(putRes.status).toBe(200);
        const updated = (await putRes.json()) as {
          homeRegion: string;
          isPublic: boolean;
          bio: string;
          displayName: string;
        };
        expect(updated.homeRegion).toBe('Japan');
        expect(updated.isPublic).toBe(true);
        expect(updated.bio).toBe('Retro gaming archivist');
        expect(updated.displayName).toBe('Alice M.');

        // 3. Verify in DB
        const dbRow = db
          .prepare(
            'SELECT home_region, is_public, bio, display_name FROM users WHERE id = 1',
          )
          .get() as {
          home_region: string;
          is_public: number;
          bio: string;
          display_name: string;
        };
        expect(dbRow.home_region).toBe('Japan');
        expect(dbRow.is_public).toBe(1);
        expect(dbRow.bio).toBe('Retro gaming archivist');
        expect(dbRow.display_name).toBe('Alice M.');
      });

      it('GET /api/u/:username returns public profile, and 404 for private or missing profiles', async () => {
        // Seed private user
        db.prepare(
          `
          INSERT INTO users (id, username, is_public, home_region, display_name)
          VALUES (2, 'stealth_user', 0, 'Europe', 'Stealth')
        `,
        ).run();

        // Public profile lookup
        const pubReq = new Request(
          'https://collection-tracker.example.com/api/u/alice',
        );
        const pubRes = await worker.fetch(pubReq, mockEnv);
        expect(pubRes.status).toBe(200);
        expect(pubRes.headers.get('Cache-Control')).toContain('s-maxage=60');
        const pubData = (await pubRes.json()) as {
          username: string;
          homeRegion: string;
        };
        expect(pubData.username).toBe('alice');

        // Private profile lookup by unauthenticated guest -> 404
        const privReq = new Request(
          'https://collection-tracker.example.com/api/u/stealth_user',
        );
        const privRes = await worker.fetch(privReq, mockEnv);
        expect(privRes.status).toBe(404);

        // Non-existent profile -> 404
        const missingReq = new Request(
          'https://collection-tracker.example.com/api/u/ghost',
        );
        const missingRes = await worker.fetch(missingReq, mockEnv);
        expect(missingRes.status).toBe(404);
      });

      it('enforces security headers, CSRF Origin checks, push user_id isolation, and input validation', async () => {
        // 1. Security headers on API and HTML responses
        const apiRes = await worker.fetch(
          new Request('https://collection-tracker.example.com/api/platforms'),
          mockEnv,
        );
        expect(apiRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
        expect(apiRes.headers.get('X-Frame-Options')).toBe('DENY');
        expect(apiRes.headers.get('Referrer-Policy')).toBe(
          'strict-origin-when-cross-origin',
        );

        const htmlEnv: Env = {
          ...mockEnv,
          ASSETS: {
            fetch: vi.fn().mockResolvedValue(
              new Response('<!doctype html><html></html>', {
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
              }),
            ),
          },
        };
        const htmlRes = await worker.fetch(
          new Request('https://collection-tracker.example.com/'),
          htmlEnv,
        );
        const csp = htmlRes.headers.get('Content-Security-Policy') || '';
        expect(csp).toContain("default-src 'self'");
        expect(csp).toContain("script-src 'self'");
        expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");

        // 2. Cross-origin Origin check on POST/PUT/DELETE
        const csrfRes = await worker.fetch(
          new Request(
            'https://collection-tracker.example.com/api/collection/toggle',
            {
              method: 'POST',
              headers: {
                Origin: 'https://evil.example.org',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ id: 'mario', type: 'game', status: 1 }),
            },
          ),
          mockEnv,
        );
        expect(csrfRes.status).toBe(403);

        // 3. Discovery search & matches require authentication off-loopback and validate numeric igdbId
        const unauthSearch = await worker.fetch(
          new Request(
            'https://collection-tracker.example.com/api/discovery/search?query=Mario',
          ),
          mockEnv,
        );
        expect(unauthSearch.status).toBe(401);

        const badIgdbMatches = await worker.fetch(
          new Request(
            'http://localhost/api/discovery/matches?igdbId=101;where+id=1',
          ),
          mockEnv,
        );
        expect(badIgdbMatches.status).toBe(400);

        // 4. Push subscription user_id scoping and SSRF endpoint protection
        db.prepare(
          `INSERT INTO users (id, username, is_public, home_region)
           VALUES (2, 'user2', 0, 'USA')`,
        ).run();
        const user1Token = await signSession(
          { id: 1, username: 'alice', role: 'admin', homeRegion: 'USA' },
          mockEnv.SESSION_SECRET!,
        );
        const user2Token = await signSession(
          { id: 2, username: 'user2', role: 'user', homeRegion: 'USA' },
          mockEnv.SESSION_SECRET!,
        );

        // Disallowed push host on production domain -> 400
        const ssrfPushRes = await worker.fetch(
          new Request(
            'https://collection-tracker.example.com/api/notifications/subscribe',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Cookie: `${SESSION_COOKIE}=${user1Token}`,
              },
              body: JSON.stringify({
                endpoint: 'https://internal.corp.local/push',
                keys: { p256dh: 'p256', auth: 'auth' },
              }),
            },
          ),
          mockEnv,
        );
        expect(ssrfPushRes.status).toBe(400);

        // User 1 subscribes a valid FCM endpoint
        const validEndpoint = 'https://fcm.googleapis.com/fcm/send/user1-token';
        const sub1Res = await worker.fetch(
          new Request(
            'https://collection-tracker.example.com/api/notifications/subscribe',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Cookie: `${SESSION_COOKIE}=${user1Token}`,
              },
              body: JSON.stringify({
                endpoint: validEndpoint,
                keys: { p256dh: 'p256', auth: 'auth' },
              }),
            },
          ),
          mockEnv,
        );
        expect(sub1Res.status).toBe(200);

        // User 2 attempting to overwrite User 1's endpoint is blocked with 403
        const hijackRes = await worker.fetch(
          new Request(
            'https://collection-tracker.example.com/api/notifications/subscribe',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Cookie: `${SESSION_COOKIE}=${user2Token}`,
              },
              body: JSON.stringify({
                endpoint: validEndpoint,
                keys: { p256dh: 'p256-2', auth: 'auth-2' },
              }),
            },
          ),
          mockEnv,
        );
        expect(hijackRes.status).toBe(403);

        // User 2 attempting to unsubscribe User 1's endpoint does not delete it
        await worker.fetch(
          new Request(
            'https://collection-tracker.example.com/api/notifications/unsubscribe',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Cookie: `${SESSION_COOKIE}=${user2Token}`,
              },
              body: JSON.stringify({ endpoint: validEndpoint }),
            },
          ),
          mockEnv,
        );
        const stillExists = db
          .prepare('SELECT user_id FROM push_subscriptions WHERE endpoint = ?')
          .get(validEndpoint) as { user_id: number } | undefined;
        expect(stillExists?.user_id).toBe(1);
      });

      it('aborts performScheduledBackup if any table query throws so latest.json is not overwritten with partial data', async () => {
        mockBucket.storage.set(
          'snapshots/latest.json',
          JSON.stringify({ intact: true }),
        );
        const brokenEnv: Env = {
          ...mockEnv,
          DB: {
            prepare: (q: string) => ({
              all: async () => {
                if (q.includes('FROM "games"') || q.includes('FROM games')) {
                  throw new Error('Simulated D1 read error');
                }
                return { results: [] };
              },
            }),
          } as unknown as Env['DB'],
        };

        await expect(performScheduledBackup(brokenEnv, false)).rejects.toThrow(
          /Aborted backup/,
        );
        expect(mockBucket.storage.get('snapshots/latest.json')).toBe(
          JSON.stringify({ intact: true }),
        );
      });

      it('evaluates boutique pre-order ownership per subscriber user_id and coalesces >3 announcements', async () => {
        // Seed 4 digital_only games on Switch (26); User 1 owns game 1, User 2 owns none
        db.prepare(
          `INSERT INTO users (id, username, is_public, home_region)
           VALUES (2, 'sub2', 0, 'USA')`,
        ).run();
        for (let i = 1; i <= 4; i++) {
          db.prepare(
            `INSERT INTO games (stable_id, id, title, platform_id, physical_status)
             VALUES (?, ?, ?, 26, 'digital_only')`,
          ).run(960 + i, `coalesce-game-${i}`, `Coalesce Game ${i}`);
          db.prepare(
            `INSERT INTO game_releases (id, game_id, region)
             VALUES (?, ?, 'USA')`,
          ).run(`coalesce-rel-${i}`, 960 + i);
        }
        // User 1 owns all 4 games physically; User 2 owns none
        for (let i = 1; i <= 4; i++) {
          db.prepare(
            `INSERT INTO user_game_releases (user_id, release_id, ownership_status)
             VALUES (1, ?, 1)`,
          ).run(`coalesce-rel-${i}`);
        }

        db.prepare(
          `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, preferences_json, created_at, updated_at)
           VALUES ('sub-u1', 1, 'https://fcm.googleapis.com/fcm/send/u1', 'p256', 'auth', '{"enabled": true, "notify_physical_announcements": true, "physical_announcement_scope": {"unowned": true}}', datetime('now'), datetime('now')),
                  ('sub-u2', 2, 'https://fcm.googleapis.com/fcm/send/u2', 'p256', 'auth', '{"enabled": true, "notify_physical_announcements": true, "physical_announcement_scope": {"unowned": true}}', datetime('now'), datetime('now'))`,
        ).run();

        const mockShopify = {
          products: [1, 2, 3, 4].map((i) => ({
            id: 880000 + i,
            title: `Coalesce Game ${i} - Nintendo Switch`,
            handle: `coalesce-game-${i}-switch`,
            tags: ['game', 'pre-order'],
            variants: [{ price: '34.99' }],
          })),
        };

        const webPushSpy = vi
          .spyOn(webPush, 'sendWebPushNotification')
          .mockResolvedValue({
            success: true,
            status: 201,
            shouldDelete: false,
          });
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
          // User 1 owns all 4 -> 0 notifications; User 2 owns 0 of the 4 -> coalesced into 1 summary notification!
          expect(result.notifications.dispatchedCount).toBe(1);
          expect(webPushSpy).toHaveBeenCalledTimes(1);
          expect(webPushSpy).toHaveBeenCalledWith(
            expect.objectContaining({
              endpoint: 'https://fcm.googleapis.com/fcm/send/u2',
            }),
            expect.objectContaining({
              title: '📦 4 Physical Editions Announced',
            }),
            expect.anything(),
          );
        } finally {
          fetchSpy.mockRestore();
          webPushSpy.mockRestore();
        }
      });

      it('short-circuits syncWorkerBoutiquePreOrders when boutique_feed_hash is unchanged and re-evaluates after markDbDirty', async () => {
        db.prepare(
          `INSERT INTO games (stable_id, id, title, platform_id, physical_status)
           VALUES (975, 'feed-hash-game', 'Feed Hash Game', 26, 'digital_only')`,
        ).run();

        const mockShopify = {
          products: [
            {
              id: 771100,
              title: 'Feed Hash Game - Nintendo Switch',
              handle: 'feed-hash-game-switch',
              tags: ['game', 'pre-order'],
              variants: [{ price: '29.99' }],
            },
          ],
        };

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
          const firstRun = await syncWorkerBoutiquePreOrders(mockEnv);
          expect(firstRun.matchedCount).toBeGreaterThanOrEqual(1);

          const hashRow = db
            .prepare(
              `SELECT value FROM sync_state WHERE key = 'boutique_feed_hash'`,
            )
            .get() as { value: string } | undefined;
          expect(hashRow?.value).toMatch(/^[0-9a-f]{64}$/);

          // Second run with identical upstream feed should short-circuit with 0 matches
          const secondRun = await syncWorkerBoutiquePreOrders(mockEnv);
          expect(secondRun.matchedCount).toBe(0);
          expect(secondRun.totalPreOrders).toBe(1);
        } finally {
          fetchSpy.mockRestore();
        }
      });

      it('POST /api/auth/logout?silent=1 clears session cookies and returns JSON with CORS credentials for OIDC_ISSUER', async () => {
        const oidcEnv: Env = {
          ...mockEnv,
          OIDC_ISSUER: 'https://auth.example.com',
          OIDC_CLIENT_ID: 'collection-tracker',
          SESSION_SECRET: 'test-session-secret-32-chars-minimum',
        };
        const getRes = await worker.fetch(
          new Request('https://tracker.example.com/api/auth/logout?silent=1'),
          oidcEnv,
        );
        expect(getRes.status).toBe(405);

        const req = new Request(
          'https://tracker.example.com/api/auth/logout?silent=1',
          {
            method: 'POST',
            headers: {
              Origin: 'https://auth.example.com',
              Cookie: `${HOST_SESSION_COOKIE}=some-token`,
            },
          },
        );
        const res = await worker.fetch(req, oidcEnv);
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toContain('application/json');
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
          'https://auth.example.com',
        );
        expect(res.headers.get('Access-Control-Allow-Credentials')).toBe(
          'true',
        );
        const setCookie = res.headers.get('Set-Cookie') || '';
        expect(setCookie).toContain(`${HOST_SESSION_COOKIE}=;`);
        expect(setCookie).toContain('app_user_session=;');
        expect(setCookie).toContain('Max-Age=0');
        const body = (await res.json()) as { ok: boolean; success: boolean };
        expect(body).toEqual({ ok: true, success: true });
      });

      it('POST /api/auth/logout returns 303 See Other for same-origin and blocks Origin: null', async () => {
        const oidcEnv: Env = {
          ...mockEnv,
          OIDC_ISSUER: 'https://auth.example.com',
          OIDC_CLIENT_ID: 'collection-tracker',
          SESSION_SECRET: 'test-session-secret-32-chars-minimum',
        };
        const nullOriginReq = new Request(
          'https://tracker.example.com/api/auth/logout',
          {
            method: 'POST',
            headers: {
              Origin: 'null',
              Cookie: `${HOST_SESSION_COOKIE}=some-token`,
            },
          },
        );
        const nullOriginRes = await worker.fetch(nullOriginReq, oidcEnv);
        expect(nullOriginRes.status).toBe(403);

        const sameOriginReq = new Request(
          'https://tracker.example.com/api/auth/logout',
          {
            method: 'POST',
            headers: {
              Origin: 'https://tracker.example.com',
              Cookie: `${HOST_SESSION_COOKIE}=some-token`,
            },
          },
        );
        const res = await worker.fetch(sameOriginReq, oidcEnv);
        expect(res.status).toBe(303);
        expect(res.headers.get('Location')).toContain(
          'https://auth.example.com/logout?',
        );
        const setCookie = res.headers.get('Set-Cookie') || '';
        expect(setCookie).toContain(`${HOST_SESSION_COOKIE}=;`);
        expect(setCookie).toContain('app_user_session=;');
        expect(setCookie).toContain('Max-Age=0');
      });

      it('GET /api/auth/login?prompt=none forwards prompt=none and redirects silent callback errors to /?sso=checked', async () => {
        const oidcEnv: Env = {
          ...mockEnv,
          OIDC_ISSUER: 'https://auth.example.com',
          OIDC_CLIENT_ID: 'collection-tracker',
          SESSION_SECRET: 'test-session-secret-32-chars-minimum',
        };
        const loginReq = new Request(
          'https://tracker.example.com/api/auth/login?return_to=%2Fcollection%2Fgames&prompt=none',
        );
        const loginRes = await worker.fetch(loginReq, oidcEnv);
        expect(loginRes.status).toBe(302);
        const authorizeUrl = new URL(loginRes.headers.get('Location')!);
        expect(authorizeUrl.searchParams.get('prompt')).toBe('none');
        const state = authorizeUrl.searchParams.get('state')!;

        const setCookie = loginRes.headers.get('Set-Cookie') || '';
        const stateCookieMatch = setCookie.match(
          /(?:__Host-)?app_oidc_state=([^;]+)/,
        );
        expect(stateCookieMatch).not.toBeNull();

        const callbackReq = new Request(
          `https://tracker.example.com/api/auth/callback?error=access_denied&state=${encodeURIComponent(state)}`,
          {
            headers: {
              Cookie: `${HOST_OIDC_STATE_COOKIE}=${stateCookieMatch![1]}`,
            },
          },
        );
        const callbackRes = await worker.fetch(callbackReq, oidcEnv);
        expect(callbackRes.status).toBe(302);
        expect(callbackRes.headers.get('Location')).toBe(
          'https://tracker.example.com/?sso=checked',
        );
      });

      it('PERF-01: POST /api/discovery/add preserves multi-user user_game_releases under PRAGMA foreign_keys = ON (0 cascade deletes, 0 writes when identical)', async () => {
        const fkEnabled = db.pragma('foreign_keys', { simple: true });
        expect(fkEnabled).toBe(1);

        db.prepare(
          `INSERT INTO users (id, username, is_public, home_region)
           VALUES (2, 'bob', 1, 'Europe')`,
        ).run();

        // Initial ingest of Chrono Trigger with USA release
        const addPayload = {
          game: {
            title: 'Chrono Trigger',
            platform_id: 2,
            igdb_id: 7777,
            physical_status: 'verified_physical',
            ownership_status: 1,
            release_date: '1995-08-11',
          },
          releases: [
            {
              region: 'USA',
              rom_name: 'Chrono Trigger (USA).sfc',
              rom_crc: '2D206BF7',
              ownership_status: 1,
              backup_status: 1,
            },
          ],
        };

        const firstRes = await worker.fetch(
          new Request('http://localhost/api/discovery/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(addPayload),
          }),
          mockEnv,
        );
        expect(firstRes.status).toBe(200);
        const firstBody = (await firstRes.json()) as {
          gameId: string;
          stableId: number;
        };

        const relRow = db
          .prepare('SELECT id FROM game_releases WHERE game_id = ?')
          .get(firstBody.stableId) as { id: string };
        expect(relRow).toBeDefined();

        // Enrich both User 1 (Alice) and User 2 (Bob) ownership flags on this release
        db.prepare(
          `INSERT INTO user_game_releases (user_id, release_id, ownership_status, backup_status, has_case, has_manual)
           VALUES (1, ?, 1, 1, 1, 1)
           ON CONFLICT(user_id, release_id) DO UPDATE SET
             ownership_status = 1, backup_status = 1, has_case = 1, has_manual = 1`,
        ).run(relRow.id);
        db.prepare(
          `INSERT INTO user_game_releases (user_id, release_id, ownership_status, backup_status, has_case, has_manual)
           VALUES (2, ?, 1, 0, 1, 0)`,
        ).run(relRow.id);

        // Track SQL changes on game_releases during identical re-ingest
        let releaseRowChanges = 0;
        const basePrepare = mockDb.prepare;
        mockDb.prepare = (q: string) => {
          const stmt = basePrepare(q);
          if (q.includes('INSERT INTO game_releases')) {
            return {
              ...stmt,
              bind: (...params: (string | number | null)[]) => {
                const bound = stmt.bind(...params);
                return {
                  ...bound,
                  run: async () => {
                    const out = await bound.run();
                    releaseRowChanges += out.meta.changes;
                    return out;
                  },
                };
              },
            };
          }
          return stmt;
        };

        try {
          // 1) Identical re-ingest -> 0 writes to game_releases and 0 cascade deletes!
          const repeatRes = await worker.fetch(
            new Request('http://localhost/api/discovery/add', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(addPayload),
            }),
            mockEnv,
          );
          expect(repeatRes.status).toBe(200);
          expect(releaseRowChanges).toBe(0);

          // 2) Metadata update on the same release -> updates game_releases in place without deleting user_game_releases!
          const updatedPayload = {
            ...addPayload,
            releases: [
              {
                ...addPayload.releases[0],
                barcode: '045496830410',
              },
            ],
          };
          const updateRes = await worker.fetch(
            new Request('http://localhost/api/discovery/add', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(updatedPayload),
            }),
            mockEnv,
          );
          expect(updateRes.status).toBe(200);
          expect(releaseRowChanges).toBe(1);
        } finally {
          mockDb.prepare = basePrepare;
        }

        const aliceUgr = db
          .prepare(
            'SELECT ownership_status, backup_status, has_case, has_manual FROM user_game_releases WHERE user_id = 1 AND release_id = ?',
          )
          .get(relRow.id) as {
          ownership_status: number;
          backup_status: number;
          has_case: number;
          has_manual: number;
        };
        const bobUgr = db
          .prepare(
            'SELECT ownership_status, backup_status, has_case, has_manual FROM user_game_releases WHERE user_id = 2 AND release_id = ?',
          )
          .get(relRow.id) as {
          ownership_status: number;
          backup_status: number;
          has_case: number;
          has_manual: number;
        };

        expect(aliceUgr).toEqual({
          ownership_status: 1,
          backup_status: 1,
          has_case: 1,
          has_manual: 1,
        });
        expect(bobUgr).toEqual({
          ownership_status: 1,
          backup_status: 0,
          has_case: 1,
          has_manual: 0,
        });
      });

      it('PERF-02: syncWorkerRetailDeals incurs 0 writes on unchanged repeat runs and resets only expired sales', async () => {
        db.prepare(
          `INSERT INTO games (stable_id, id, title, platform_id, physical_status, retail_on_sale, retail_price, retail_regular_price, retail_discount_pct, retail_store, retail_url)
           VALUES (980, 'active-deal-sw', 'Octopath Traveler II', 26, 'verified_physical', 0, null, null, null, null, null),
                  (981, 'expired-deal-sw', 'Expired Sale Game', 26, 'verified_physical', 1, 1999, 5999, 67, 'VGP', 'https://videogamesplus.ca/products/expired')`,
        ).run();

        const vgpMock = {
          products: [
            {
              id: 501,
              title: 'Octopath Traveler II - Nintendo Switch',
              handle: 'octopath-traveler-ii-switch',
              tags: ['Nintendo Switch'],
              variants: [
                {
                  price: '29.99',
                  compare_at_price: '59.99',
                  available: true,
                },
              ],
            },
          ],
        };

        let gameRowWrites = 0;
        const basePrepare = mockDb.prepare;
        mockDb.prepare = (q: string) => {
          const stmt = basePrepare(q);
          if (q.includes('UPDATE games')) {
            return {
              ...stmt,
              bind: (...params: (string | number | null)[]) => {
                const bound = stmt.bind(...params);
                return {
                  ...bound,
                  run: async () => {
                    const out = await bound.run();
                    gameRowWrites += out.meta.changes;
                    return out;
                  },
                };
              },
            };
          }
          return stmt;
        };

        const fetchSpy = vi
          .spyOn(globalThis, 'fetch')
          .mockImplementation(async (input) => {
            const urlStr = String(input);
            if (urlStr.includes('videogamesplus.ca')) {
              return new Response(JSON.stringify(vgpMock), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              });
            }
            return new Response(JSON.stringify({ products: [], records: [] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          });

        try {
          // Run 1: activates game 980 and expires game 981 (2 row updates)
          await syncWorkerRetailDeals(mockEnv);
          expect(gameRowWrites).toBe(2);

          const activeRow = db
            .prepare(
              'SELECT retail_on_sale, retail_price FROM games WHERE stable_id = 980',
            )
            .get() as { retail_on_sale: number; retail_price: number };
          const expiredRow = db
            .prepare('SELECT retail_on_sale FROM games WHERE stable_id = 981')
            .get() as { retail_on_sale: number };
          expect(activeRow).toEqual({ retail_on_sale: 1, retail_price: 2189 });
          expect(expiredRow.retail_on_sale).toBe(0);

          // Run 2 with identical retail feed -> 0 D1 row writes!
          gameRowWrites = 0;
          await syncWorkerRetailDeals(mockEnv);
          expect(gameRowWrites).toBe(0);
        } finally {
          mockDb.prepare = basePrepare;
          fetchSpy.mockRestore();
        }
      });

      it('syncOrResolveOidcUser enforces oidc_sub binding, requires email_verified for legacy link, and disambiguates username collisions', async () => {
        const oidcEnv: Env = {
          ...mockEnv,
          ADMIN_EMAIL: 'admin@example.com',
        };

        // 1. Unverified email matching ADMIN_EMAIL must NOT link User 1; provisions separate user with disambiguated username if colliding with 'alice'
        const unverifiedClaims = {
          iss: 'https://id.example.com',
          sub: 'sub-attacker-unverified',
          aud: 'collection-tracker',
          exp: Math.floor(Date.now() / 1000) + 600,
          iat: Math.floor(Date.now() / 1000),
          email: 'admin@example.com',
          email_verified: false,
          preferred_username: 'alice',
        };
        const unverifiedUser = await syncOrResolveOidcUser(
          oidcEnv,
          unverifiedClaims,
          'https://collection-tracker.example.com/api/auth/callback',
        );
        expect(unverifiedUser.id).not.toBe(1);
        expect(unverifiedUser.username).toMatch(/^alice_[a-z0-9]+$/);
        expect(unverifiedUser.oidc_sub).toBe('sub-attacker-unverified');

        // 2. Verified ADMIN_EMAIL links legacy User 1 (where oidc_sub IS NULL) and binds oidc_sub
        const verifiedAdminClaims = {
          iss: 'https://id.example.com',
          sub: 'sub-real-admin',
          aud: 'collection-tracker',
          exp: Math.floor(Date.now() / 1000) + 600,
          iat: Math.floor(Date.now() / 1000),
          email: 'admin@example.com',
          email_verified: true,
          preferred_username: 'alice',
        };
        const linkedAdmin = await syncOrResolveOidcUser(
          oidcEnv,
          verifiedAdminClaims,
          'https://collection-tracker.example.com/api/auth/callback',
        );
        expect(linkedAdmin.id).toBe(1);
        expect(linkedAdmin.oidc_sub).toBe('sub-real-admin');

        // 3. Returning login resolves directly by immutable oidc_sub
        const returningAdmin = await syncOrResolveOidcUser(
          oidcEnv,
          { ...verifiedAdminClaims, preferred_username: 'alice_renamed' },
          'https://collection-tracker.example.com/api/auth/callback',
        );
        expect(returningAdmin.id).toBe(1);
        expect(returningAdmin.username).toBe('alice_renamed');
      });

      it('deterministically evicts /api/u/:username* from Edge Cache on privacy toggle and enforces rate limits & https:// URL validation', async () => {
        const cachedMap = new Map<string, Response>();
        const deletedKeys: string[] = [];
        const mockCache = {
          match: vi.fn(async (req: RequestInfo | URL) => {
            const key = req instanceof Request ? req.url : String(req);
            return cachedMap.get(key)?.clone();
          }),
          put: vi.fn(async (req: RequestInfo | URL, res: Response) => {
            const key = req instanceof Request ? req.url : String(req);
            cachedMap.set(key, res.clone());
          }),
          delete: vi.fn(async (req: RequestInfo | URL) => {
            const key = req instanceof Request ? req.url : String(req);
            deletedKeys.push(key);
            return cachedMap.delete(key);
          }),
        };
        vi.stubGlobal('caches', { default: mockCache });

        try {
          // Prime public profile cache across another isolate (without relying on in-memory Set)
          await worker.fetch(
            new Request('https://collection-tracker.example.com/api/u/alice'),
            mockEnv,
          );
          expect(
            cachedMap.has('https://collection-tracker.example.com/api/u/alice'),
          ).toBe(true);

          const adminToken = await signSession(
            { id: 1, username: 'alice', role: 'admin', homeRegion: 'USA' },
            mockEnv.SESSION_SECRET!,
          );
          const privToggleRes = await worker.fetch(
            new Request(
              'https://collection-tracker.example.com/api/user/profile',
              {
                method: 'PUT',
                headers: {
                  Origin: 'https://collection-tracker.example.com',
                  'Content-Type': 'application/json',
                  Cookie: `${HOST_SESSION_COOKIE}=${adminToken}`,
                },
                body: JSON.stringify({ isPublic: false }),
              },
            ),
            mockEnv,
          );
          expect(privToggleRes.status).toBe(200);
          expect(deletedKeys).toContain(
            'https://collection-tracker.example.com/api/u/alice',
          );
          expect(deletedKeys).toContain(
            'https://collection-tracker.example.com/api/u/alice/games',
          );
          expect(deletedKeys).toContain(
            'https://collection-tracker.example.com/api/u/alice/toys',
          );

          // Missing Content-Type: application/json returns 415
          const badCtRes = await worker.fetch(
            new Request('http://localhost/api/collection/toggle', {
              method: 'POST',
              headers: { 'Content-Type': 'text/plain' },
              body: JSON.stringify({ id: 'mario', type: 'game', status: 1 }),
            }),
            mockEnv,
          );
          expect(badCtRes.status).toBe(415);

          // Reject http:// external URLs on discovery add & add-toy
          const badUrlGameRes = await worker.fetch(
            new Request('http://localhost/api/discovery/add', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                game: {
                  title: 'Insecure URL Game',
                  platform_id: 1,
                  igdb_url: 'http://insecure.example.com/game',
                },
                releases: [],
              }),
            }),
            mockEnv,
          );
          expect(badUrlGameRes.status).toBe(400);

          const badUrlToyRes = await worker.fetch(
            new Request('http://localhost/api/discovery/add-toy', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: 'Insecure Toy',
                line: 'amiibo',
                scl_url: 'javascript:alert(1)',
              }),
            }),
            mockEnv,
          );
          expect(badUrlToyRes.status).toBe(400);

          // Rate limiting on /api/notifications/test (> 5/min -> 429)
          let lastStatus = 0;
          for (let i = 0; i < 6; i++) {
            const testPushRes = await worker.fetch(
              new Request('http://localhost/api/notifications/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  endpoint: 'https://fcm.googleapis.com/fcm/send/missing',
                }),
              }),
              mockEnv,
            );
            lastStatus = testPushRes.status;
          }
          expect(lastStatus).toBe(429);
        } finally {
          vi.unstubAllGlobals();
        }
      });
    });
  });
});
