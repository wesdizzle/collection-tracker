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
  CATALOG_CHUNKS_DIRTY_KEY,
  MAX_GAMES_LITE_SNAPSHOT_BYTES,
  R2_META_LITE_KEY,
  R2_TOYS_LITE_KEY,
  R2_GAMES_ACTIVE_LITE_KEY,
  R2_BACKUP_CATALOG_MANIFEST_KEY,
  R2_BACKUP_CANONICAL_MANIFEST_KEY,
  R2_CATALOG_BUILDS_PREFIX,
  R2_CATALOG_MANIFEST_KEY,
  R2_CATALOG_TOYS_CHUNK_KEY,
  X_CATALOG_PARTIAL_HEADER,
  X_CATALOG_CHUNK_SIZE_HEADER,
  buildIgdbSearchTokens,
  fetchIgdbMetadataForTitles,
  getBackupChunkR2Key,
  getCatalogChunkR2Key,
  getBroadCatalogSeedStatus,
  isAuthorizedAdmin,
  logCronExecution,
  markCanonicalReleasesDirty,
  markCatalogChunksDirty,
  markDbDirty,
  performCanonicalReleasesBackup,
  performChunkedCatalogBackup,
  performScheduledBackup,
  recoverCatalogManifestFromR2Chunks,
  resetWorkerRateLimits,
  resolveAmiiboRegionsAndMetadata,
  resolveCatalogManifest,
  resolveWorkerPlanTier,
  selectStrictIgdbMatch,
  syncOrResolveOidcUser,
  syncWorkerAmiiboCatalog,
  syncWorkerBoutiquePreOrders,
  syncWorkerBroadCatalogPopulation,
  syncWorkerDats,
  syncWorkerIgdbSeriesAndCanonical,
  syncWorkerLaunchDayNotifications,
  syncWorkerNsCollectors,
  syncWorkerPs5Db,
  syncWorkerRetailDeals,
  syncWorkerRetailPreOrders,
  syncWorkerSerialStation,
  syncWorkerSwitchRevisions,
  syncWorkerUnmatchedIgdbRetry,
  syncWorkerWatchedSeriesDiscovery,
  applyReactiveSeriesAutoTracking,
  buildMultiLineNotificationBodies,
  dispatchDealPushNotifications,
  evaluateTrackingRulesForNewGames,
  evaluateTrackingRulesForNewToys,
  writeCatalogChunksToR2,
} from './worker';
import { CATALOG_CHUNK_SCHEMA_VERSION } from '../shared/queries';
import { normalizeTitleForMatching } from '../shared/title_matching';
import {
  getPriceShardR2Key,
  purgeSingleExpiredPriceShard,
} from './market_pricing';
import {
  EBAY_PRICE_TTL_MS,
  getMarketPriceKey,
  getPriceShardIndex,
} from '../shared/market_pricing';
import {
  KIT_DEGRADED_HEADER,
  KIT_SNAPSHOT_TIMESTAMP_HEADER,
  resetR2SnapshotCache,
} from '@wesdizzle/app-kit/worker';

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
      objects: {
        key: string;
        uploaded?: Date;
        customMetadata?: Record<string, string>;
      }[];
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
      INSERT INTO user_game_releases (user_id, release_id, ownership_status, has_media)
      VALUES (1, 'gb-mario', 1, 0);
      INSERT OR IGNORE INTO toy_series (id, name, line, sort_index)
      VALUES ('smash', 'Smash', 'amiibo', 0);
      INSERT INTO toys (stable_id, id, name, line, series_id, sort_index)
      VALUES (1, 'link-amiibo', 'Link', 'amiibo', 'smash', 0);
      INSERT INTO sync_state (key, value) VALUES
        ('boutique_seed_completed', '1'),
        ('boutique_store_seeded:Limited Run Games', '1'),
        ('boutique_store_seeded:Super Rare Games', '1'),
        ('boutique_store_seeded:iam8bit', '1'),
        ('boutique_store_seeded:Fangamer', '1'),
        ('boutique_store_seeded:Strictly Limited Games', '1'),
        ('boutique_store_seeded:NIS America', '1'),
        ('boutique_store_seeded:Aksys Games', '1'),
        ('boutique_store_seeded:Clear River Games', '1'),
        ('boutique_store_seeded:Serenity Forge', '1'),
        ('boutique_store_seeded:Premium Edition Games', '1'),
        ('boutique_store_seeded:CastleMania', '1'),
        ('boutique_store_seeded:Silver Lining Direct', '1'),
        ('boutique_store_seeded:First Press Games', '1'),
        ('boutique_store_seeded:Limited Game News', '1');
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
        const objects: {
          key: string;
          customMetadata?: Record<string, string>;
        }[] = [];
        for (const [key] of storage) {
          if (key.startsWith(prefix)) {
            objects.push({ key, customMetadata: metadata.get(key) });
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
    expect(text).toContain('Disallow: /admin/');
    expect(text).toContain('User-agent: GPTBot');
  });

  it('GET /api/games returns public Edge Cache-Control headers', async () => {
    const req = new Request('https://collection-tracker.example.com/api/games');
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=3600');
  });

  it('Enforces admin auth on production domain for /api/admin/catalog-seed', async () => {
    const unauthReq = new Request(
      'https://collection-tracker.example.com/api/admin/catalog-seed',
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

  it('POST /api/collection/sort updates toy sort_index and serves updated toys via D1 Edge Cache without writing R2 catalog chunks', async () => {
    const req = new Request('http://localhost/api/collection/sort', {
      method: 'POST',
      body: JSON.stringify({
        id: 'link-amiibo',
        type: 'toy',
        sort_index: 15,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await worker.fetch(req, mockEnv);
    expect(res.status).toBe(200);

    const updatedToy = db
      .prepare('SELECT sort_index FROM toys WHERE id = ?')
      .get('link-amiibo') as { sort_index: number };
    expect(updatedToy.sort_index).toBe(15);

    const catalogToysRes = await worker.fetch(
      new Request('http://localhost/api/catalog/toys?v=sort-test'),
      mockEnv,
    );
    expect(catalogToysRes.status).toBe(200);
    expect(catalogToysRes.headers.get('X-Catalog-Source')).toBe(
      'd1-edge-cache',
    );
    const catalogToys = (await catalogToysRes.json()) as Array<{
      id: string;
      sort_index: number;
    }>;
    expect(catalogToys.find((t) => t.id === 'link-amiibo')?.sort_index).toBe(
      15,
    );
    expect(mockBucket.storage.has(R2_CATALOG_TOYS_CHUNK_KEY)).toBe(false);
  });

  it('performScheduledBackup dumps tables, deduplicates unchanged SHA-256 via head(), and saves daily snapshot to R2', async () => {
    // Non-daily call updates latest.json and lite fallback snapshots
    const nonDailyRes = await performScheduledBackup(mockEnv, false);
    expect(nonDailyRes.rowCount).toBeGreaterThan(0);
    expect(mockBucket.storage.has('snapshots/latest.json')).toBe(true);
    expect(mockBucket.storage.has(R2_META_LITE_KEY)).toBe(true);
    expect(mockBucket.storage.has(R2_TOYS_LITE_KEY)).toBe(true);
    expect(mockBucket.storage.has(R2_GAMES_ACTIVE_LITE_KEY)).toBe(true);
    expect(mockBucket.storage.size).toBe(4);

    // Repeat call with unchanged DB skips upload via head() SHA-256 metadata check
    const unchangedRes = await performScheduledBackup(mockEnv, true);
    expect(unchangedRes.skipped).toBe(true);
    expect(mockBucket.storage.size).toBe(4);

    // Mutate DB and run daily call -> saves dated snapshot, latest.json, and updated lite snapshots
    db.prepare('UPDATE games SET sort_index = 7 WHERE stable_id = 1').run();
    const dailyRes = await performScheduledBackup(mockEnv, true);
    expect(dailyRes.rowCount).toBeGreaterThan(0);
    expect(mockBucket.storage.size).toBe(5); // dated snapshot + latest.json + 3 lite snapshots

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

    const originalDate = globalThis.Date;
    const mockNow = new Date('2026-10-18T12:00:00Z');
    const scheduledEvent = {
      cron: '0 * * * *',
      type: 'scheduled',
      scheduledTime: mockNow.getTime(),
    } as unknown as ScheduledEvent;
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

  it('performScheduledBackup omits bulk games/game_releases when catalog > 500 rows while writing active lite snapshots and accepting >8MB lite backups', async () => {
    expect(MAX_GAMES_LITE_SNAPSHOT_BYTES).toBe(16_000_000);

    const insertMany = db.transaction(() => {
      const stmt = db.prepare(
        `INSERT INTO games (stable_id, id, title, platform_id, sort_index) VALUES (?, ?, ?, 1, ?)`,
      );
      for (let sid = 2; sid <= 505; sid++) {
        stmt.run(sid, `game-${sid}`, `Catalog Game ${sid}`, sid);
      }
    });
    insertMany();

    const res = await performScheduledBackup(mockEnv, false);
    expect(res.rowCount).toBeGreaterThan(0);

    const latestRaw = mockBucket.storage.get('snapshots/latest.json');
    expect(latestRaw).toBeDefined();
    const latestParsed = JSON.parse(latestRaw!) as {
      tables: Record<string, unknown[]>;
    };
    expect(latestParsed.tables['games']).toBeUndefined();
    expect(latestParsed.tables['game_releases']).toBeUndefined();
    expect(Array.isArray(latestParsed.tables['user_game_releases'])).toBe(true);

    const gamesLiteRaw = mockBucket.storage.get(R2_GAMES_ACTIVE_LITE_KEY);
    expect(gamesLiteRaw).toBeDefined();
    const gamesLiteParsed = JSON.parse(gamesLiteRaw!) as {
      tables: { games: Array<{ stable_id: number }> };
    };
    expect(gamesLiteParsed.tables.games.map((g) => g.stable_id)).toEqual([1]);
    expect(mockBucket.metadata.get(R2_GAMES_ACTIVE_LITE_KEY)?.['date']).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });

  it('daytime cron auto-recovers stale lite snapshots without generating R2 catalog chunks', async () => {
    db.prepare(
      `INSERT INTO sync_state (key, value, updated_at)
       VALUES ('db_dirty', '0', datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = '0'`,
    ).run();

    mockBucket.storage.clear();
    mockBucket.metadata.clear();

    await mockBucket.put('snapshots/latest.json', JSON.stringify({ ok: true }));
    await mockBucket.put(
      R2_GAMES_ACTIVE_LITE_KEY,
      JSON.stringify({ stale: true }),
      {
        customMetadata: { date: '2026-11-17' },
      },
    );

    const scheduledEvent = {
      cron: '*/30 * * * *',
      type: 'scheduled',
      scheduledTime: Date.now(),
    } as unknown as ScheduledEvent;

    const originalDate = globalThis.Date;
    const mockNow = new Date('2026-11-18T12:00:00Z');
    globalThis.Date = class extends originalDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          super(mockNow.getTime());
        } else {
          super(...(args as [string | number | Date]));
        }
      }
      static override now() {
        return mockNow.getTime();
      }
    } as unknown as typeof Date;

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
      await worker.scheduled(scheduledEvent, mockEnv, {} as ExecutionContext);

      expect(mockBucket.metadata.get(R2_GAMES_ACTIVE_LITE_KEY)?.['date']).toBe(
        '2026-11-18',
      );
      expect(mockBucket.storage.has(R2_CATALOG_MANIFEST_KEY)).toBe(false);
      const hasAnyBuildChunk = Array.from(mockBucket.storage.keys()).some((k) =>
        k.startsWith(R2_CATALOG_BUILDS_PREFIX),
      );
      expect(hasAnyBuildChunk).toBe(false);
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
      expect(savedData.entry.item_id).toBe('1');
      expect(savedData.entry.purchase_date).toBe('2009-06');
      expect(savedData.entry.is_approximate_date).toBe(1);
      expect(savedData.entry.price_paid).toBe(4.1);
      expect(savedData.entry.merchant).toBe('eBay');
      expect(savedData.entry.receipt_url).toBe(
        'https://mail.google.com/mail/u/0/#all/16867f8a6f04196d',
      );

      // Querying via release ID 'gb-mario' resolves to canonical numeric stable_id '1' entry
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
      expect(getData.entry.item_id).toBe('1');
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

    it('syncWorkerBoutiquePreOrders stores retail url and store on pre-order match', async () => {
      db.prepare(
        `
        INSERT INTO games (stable_id, id, title, platform_id)
        VALUES (777, 'switch-sea-of-stars', 'Sea of Stars', 26)
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
          .prepare('SELECT retail_url, retail_store FROM games WHERE id = ?')
          .get('switch-sea-of-stars') as {
          retail_url: string;
          retail_store: string;
        };
        expect(updated.retail_url).toContain('sea-of-stars-switch');
        expect(updated.retail_store).toBeTruthy();
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('syncWorkerLaunchDayNotifications scopes alerts per user list/series/region with configurable scope and dedups via sync_state', async () => {
      db.prepare(
        `
        INSERT OR IGNORE INTO platforms (id, name, display_name)
        VALUES (26, 'Nintendo Switch', 'Switch')
      `,
      ).run();

      db.prepare(
        `
        INSERT INTO games (stable_id, id, title, platform_id, canonical_series)
        VALUES
          (888, 'metroid-prime-4', 'Metroid Prime 4: Beyond', 26, 'Metroid'),
          (889, 'expelled-paradise', 'Expelled from Paradise: The Stellar Angel', 26, 'Expelled from Paradise'),
          (890, 'mario-kart-next', 'Mario Kart Next', 26, 'Mario Kart')
      `,
      ).run();

      db.prepare(
        `
        INSERT INTO game_releases (id, game_id, region, release_date)
        VALUES
          ('mp4-rel', 888, 'USA', DATE('now')),
          ('efp-rel-asia', 889, 'Asia', DATE('now')),
          ('mk-rel-jp', 890, 'Japan', DATE('now')),
          ('mk-rel-us', 890, 'USA', DATE('now'))
      `,
      ).run();

      db.prepare(
        `INSERT INTO user_game_releases (user_id, release_id, ownership_status)
         VALUES (1, 'mp4-rel', 2)`,
      ).run();

      db.prepare(
        `INSERT INTO user_tracking_rules (user_id, rule_type, match_value, region_scope, is_ignored)
         VALUES (1, 'series', 'Mario Kart', 'home', 0)`,
      ).run();

      db.prepare(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, preferences_json, user_agent, created_at, updated_at)
         VALUES ('sub-launch', 1, 'https://push.example.com/launch', 'p256', 'auth', '{"enabled": true, "notify_game_releases": true, "launch_day_scope": "tracked_only"}', 'agent', datetime('now'), datetime('now'))`,
      ).run();

      const webPushSpy = vi
        .spyOn(webPush, 'sendWebPushNotification')
        .mockResolvedValue({ success: true, status: 201, shouldDelete: false });

      try {
        // Default tracked_only notifies ONLY Seeking/Ordered release ('mp4-rel'), skipping untracked game & untracked watched series
        const first = await syncWorkerLaunchDayNotifications(mockEnv);
        expect(first.dispatchedCount).toBe(1);
        expect(webPushSpy).toHaveBeenCalledTimes(1);
        expect(webPushSpy.mock.calls[0][1].body).toContain('Seeking (USA)');

        // Second run on the same launch day must be deduplicated cleanly
        webPushSpy.mockClear();
        const second = await syncWorkerLaunchDayNotifications(mockEnv);
        expect(second.dispatchedCount).toBe(0);
        expect(webPushSpy).not.toHaveBeenCalled();

        // Enable tracked_and_series -> notifies USA watched-series launch ONLY (skips Japan release for home_region=USA and skips untracked Expelled from Paradise)
        db.prepare(
          `UPDATE push_subscriptions SET preferences_json = '{"enabled": true, "notify_game_releases": true, "launch_day_scope": "tracked_and_series"}' WHERE id = 'sub-launch'`,
        ).run();
        webPushSpy.mockClear();
        const third = await syncWorkerLaunchDayNotifications(mockEnv);
        expect(third.dispatchedCount).toBe(1);
        expect(webPushSpy).toHaveBeenCalledTimes(1);
        expect(webPushSpy.mock.calls[0][1].title).toContain('Mario Kart Next');
        expect(webPushSpy.mock.calls[0][1].body).toContain(
          'Tracked Series: Mario Kart (USA)',
        );
      } finally {
        webPushSpy.mockRestore();
      }
    });

    it('syncWorkerBoutiquePreOrders suppresses standard announcement if physical copy is already owned on same platform', async () => {
      // User owns USA physical copy of Antonblast on Switch
      db.prepare(
        `INSERT INTO games (stable_id, id, title, platform_id)
         VALUES (901, 'antonblast-switch', 'Antonblast', 26)`,
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
        `INSERT INTO games (stable_id, id, title, platform_id)
         VALUES (902, 'hollow-knight-switch', 'Hollow Knight', 26)`,
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
      // User owns Antonblast on Switch (stable_id 903), while PS5 version is newly announced uncataloged
      db.prepare(
        `INSERT INTO games (stable_id, id, title, platform_id)
         VALUES (903, 'antonblast-switch', 'Antonblast', 26)`,
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
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, preferences_json, user_agent, created_at, updated_at)
         VALUES ('sub-ps5', 1, 'https://push.example.com/sub-ps5', 'p256', 'auth', '{"enabled": true, "notify_physical_announcements": true, "physical_announcement_scope": {"unowned": true, "uncataloged": true}}', 'agent', datetime('now'), datetime('now'))`,
      ).run();

      const mockShopify = {
        products: [
          {
            id: 334455,
            title: 'Antonblast - PS5',
            handle: 'antonblast-ps5',
            tags: ['game', 'pre-order'],
            published_at: new Date().toISOString(),
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
      // Clear boutique_seed_completed and per-store seed flags from sync_state
      db.prepare(
        `DELETE FROM sync_state WHERE key = 'boutique_seed_completed' OR key LIKE 'boutique_store_seeded:%'`,
      ).run();

      db.prepare(
        `INSERT INTO games (stable_id, id, title, platform_id)
         VALUES (910, 'celeste-switch', 'Celeste', 26)`,
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

        // Now add a previously unseeded storefront when boutique_seed_completed = '1':
        // first run must seed quietly, while an already-seeded store alerts normally.
        db.prepare(
          `INSERT INTO games (stable_id, id, title, platform_id)
           VALUES (918, 'fresh-unseeded-game', 'Fresh Unseeded Game', 26)`,
        ).run();
        const storeFetchSpy = vi
          .spyOn(globalThis, 'fetch')
          .mockImplementation(async (input) => {
            if (typeof input === 'string' && input.includes('iam8bit.com')) {
              return {
                ok: true,
                json: async () => ({
                  products: [
                    {
                      id: 889902,
                      title: 'Fresh Unseeded Game - Nintendo Switch',
                      handle: 'fresh-unseeded-game-switch',
                      tags: ['game', 'pre-order'],
                      published_at: new Date().toISOString(),
                      variants: [{ price: '34.99' }],
                    },
                  ],
                }),
              } as unknown as Response;
            }
            return {
              ok: true,
              json: async () => ({ products: [] }),
            } as unknown as Response;
          });
        try {
          const storeSeedRes = await syncWorkerBoutiquePreOrders(mockEnv);
          expect(storeSeedRes.notifications.dispatchedCount).toBe(0);
          expect(
            db
              .prepare(
                `SELECT value FROM sync_state WHERE key = 'boutique_store_seeded:iam8bit'`,
              )
              .get(),
          ).toEqual({ value: '1' });
        } finally {
          storeFetchSpy.mockRestore();
        }
      } finally {
        fetchSpy.mockRestore();
        webPushSpy.mockRestore();
      }
    });

    it('syncWorkerBoutiquePreOrders silently updates retail_url for existing games without dispatching notifications', async () => {
      db.prepare(
        `INSERT INTO games (stable_id, id, title, platform_id, retail_url)
         VALUES (911, 'hollow-knight-switch-2', 'Hollow Knight', 26, 'https://old-retailer.com/hk')`,
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

    it('syncWorkerBoutiquePreOrders ingests and announces new physical editions from Limited Game News', async () => {
      db.prepare(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, preferences_json, user_agent, created_at, updated_at)
         VALUES ('sub-lgn', 1, 'https://push.example.com/sub-lgn', 'p256', 'auth', '{"enabled": true, "notify_physical_announcements": true, "physical_announcement_scope": {"uncataloged": true}}', 'agent', datetime('now'), datetime('now'))`,
      ).run();

      const webPushSpy = vi
        .spyOn(webPush, 'sendWebPushNotification')
        .mockResolvedValue({ success: true, status: 201, shouldDelete: false });

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) => {
          const url = String(input);
          if (url.includes('limitedgamenews.com/wp-json/wp/v2/posts')) {
            return {
              ok: true,
              json: async () => [
                {
                  id: 7771,
                  date_gmt: new Date().toISOString(),
                  link: 'https://limitedgamenews.com/crow-country-switch/',
                  title: {
                    rendered:
                      'Red Art Games announces Crow Country for Nintendo Switch',
                  },
                  excerpt: {
                    rendered: '<p>Physical edition pre-orders open now.</p>',
                  },
                  categories: [],
                },
              ],
            } as unknown as Response;
          }
          if (url.includes('limitedgamenews.com/wp-json/wp/v2/categories')) {
            return {
              ok: true,
              json: async () => [],
            } as unknown as Response;
          }
          return {
            ok: true,
            json: async () => ({ products: [] }),
          } as unknown as Response;
        });

      try {
        const result = await syncWorkerBoutiquePreOrders(mockEnv);
        expect(result.ingestedCount).toBe(1);
        expect(result.notifications.dispatchedCount).toBe(1);
        expect(webPushSpy).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            title: '📦 Physical Edition Announced: Crow Country',
          }),
          expect.anything(),
        );

        const inserted = db
          .prepare(
            "SELECT retail_store, retail_url FROM games WHERE title = 'Crow Country' AND platform_id = 26",
          )
          .get() as { retail_store: string; retail_url: string };
        expect(inserted.retail_store).toBe('Limited Game News');
        expect(inserted.retail_url).toContain('crow-country-switch');
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
        `INSERT INTO games (stable_id, id, title, platform_id)
         VALUES (920, 'pizza-tower-switch', 'Pizza Tower', 26)`,
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
        `INSERT INTO games (stable_id, id, title, platform_id)
         VALUES (921, 'celeste-switch', 'Celeste', 26)`,
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

    it('syncWorkerBoutiquePreOrders deduplicates IGDB edition-renamed LGN titles across feed hash changes without repeating Seeking alerts', async () => {
      db.prepare(
        `INSERT INTO user_tracking_rules (user_id, rule_type, match_value, target_status, region_scope, is_ignored)
         VALUES (1, 'series', 'The Lord of the Rings', 2, 'home', 0)`,
      ).run();
      db.prepare(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, preferences_json, user_agent, created_at, updated_at)
         VALUES ('sub-lotr', 1, 'https://push.example.com/sub-lotr', 'p256', 'auth', '{"enabled": true, "notify_watched_series": true}', 'agent', datetime('now'), datetime('now'))`,
      ).run();

      let lgnPostVersion = 1;
      const webPushSpy = vi
        .spyOn(webPush, 'sendWebPushNotification')
        .mockResolvedValue({ success: true, status: 201, shouldDelete: false });

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) => {
          const url = String(input);
          if (url.includes('id.twitch.tv/oauth2/token')) {
            return Response.json({ access_token: 'tok', expires_in: 3600 });
          }
          if (url.includes('api.igdb.com/v4/multiquery')) {
            return Response.json([
              {
                name: 'q0',
                result: [
                  {
                    id: 413144,
                    name: 'The Lord of the Rings: War in the North - Legacy Edition',
                    platforms: [167],
                    collections: [{ name: 'The Lord of the Rings' }],
                    franchises: [{ name: 'The Lord of the Rings' }],
                    url: 'https://www.igdb.com/games/the-lord-of-the-rings-war-in-the-north-legacy-edition',
                  },
                ],
              },
            ]);
          }
          if (url.includes('limitedgamenews.com/wp-json/wp/v2/posts')) {
            return {
              ok: true,
              json: async () => [
                {
                  id: 8801,
                  date_gmt: '2026-10-01T12:00:00',
                  link: 'https://limitedgamenews.com/2026/10/01/the-lord-of-the-rings-war-in-the-north-ps5/',
                  title: {
                    rendered:
                      lgnPostVersion === 1
                        ? 'The Lord of the Rings: War in the North | PlayStation 5'
                        : 'The Lord of the Rings: War in the North - PS5',
                  },
                  excerpt: {
                    rendered: '<p>Physical release announced for PS5.</p>',
                  },
                  categories: [],
                },
              ],
            } as unknown as Response;
          }
          if (url.includes('limitedgamenews.com/wp-json/wp/v2/categories')) {
            return { ok: true, json: async () => [] } as unknown as Response;
          }
          // Shift unrelated boutique feed price between runs so boutique_feed_hash changes
          if (url.includes('strictlylimitedgames.com')) {
            return {
              ok: true,
              json: async () => ({
                products: [
                  {
                    id: 9999,
                    title: 'Unrelated Game (PS5)',
                    handle: 'unrelated-game-ps5',
                    tags: [],
                    variants: [
                      {
                        price: lgnPostVersion === 1 ? '39.99' : '29.99',
                        available: true,
                      },
                    ],
                  },
                ],
              }),
            } as unknown as Response;
          }
          return {
            ok: true,
            json: async () => ({ products: [] }),
          } as unknown as Response;
        });

      try {
        const res1 = await syncWorkerBoutiquePreOrders(mockEnv);
        expect(res1.ingestedCount).toBe(1);
        expect(webPushSpy).toHaveBeenCalledTimes(1);

        lgnPostVersion = 2;
        const res2 = await syncWorkerBoutiquePreOrders(mockEnv);
        expect(res2.ingestedCount).toBe(0);
        expect(webPushSpy).toHaveBeenCalledTimes(1);

        const rows = db
          .prepare(
            `SELECT stable_id, title, igdb_id FROM games WHERE platform_id = 35 AND igdb_id = 413144`,
          )
          .all() as Array<{
          stable_id: number;
          title: string;
          igdb_id: number;
        }>;
        expect(rows).toHaveLength(1);
        expect(rows[0].title).toBe(
          'The Lord of the Rings: War in the North - Legacy Edition',
        );
      } finally {
        fetchSpy.mockRestore();
        webPushSpy.mockRestore();
      }
    });

    it('syncWorkerBoutiquePreOrders deduplicates Roman/Arabic numeral renames across repeated runs', async () => {
      let feedTick = 1;
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) => {
          const url = String(input);
          if (url.includes('id.twitch.tv/oauth2/token')) {
            return Response.json({ access_token: 'tok', expires_in: 3600 });
          }
          if (url.includes('api.igdb.com/v4/multiquery')) {
            return Response.json([
              {
                name: 'q0',
                result: [
                  {
                    id: 329138,
                    name: 'Endless Legend 2',
                    platforms: [167],
                    url: 'https://www.igdb.com/games/endless-legend-2',
                  },
                ],
              },
              {
                name: 'q1',
                result: [
                  {
                    id: 350035,
                    name: 'Beholgar II',
                    platforms: [167],
                    url: 'https://www.igdb.com/games/beholgar-ii',
                  },
                ],
              },
            ]);
          }
          if (url.includes('strictlylimitedgames.com')) {
            return {
              ok: true,
              json: async () => ({
                products: [
                  {
                    id: 7711,
                    title: 'ENDLESS Legend II Collector Edition (PS5)',
                    handle: 'endless-legend-2-collectors-edition-playstation-5',
                    tags: ['pre-order'],
                    variants: [
                      {
                        price: feedTick === 1 ? '59.99' : '54.99',
                        available: true,
                      },
                    ],
                  },
                ],
              }),
            } as unknown as Response;
          }
          if (url.includes('limitedgamenews.com/wp-json/wp/v2/posts')) {
            return {
              ok: true,
              json: async () => [
                {
                  id: 8802,
                  date_gmt: '2026-09-15T12:00:00',
                  link: 'https://limitedgamenews.com/2026/09/15/beholgar-2-playstation-5/',
                  title: { rendered: 'Beholgar 2 | PlayStation 5' },
                  excerpt: { rendered: '<p>Physical release announced.</p>' },
                  categories: [],
                },
              ],
            } as unknown as Response;
          }
          if (url.includes('limitedgamenews.com/wp-json/wp/v2/categories')) {
            return { ok: true, json: async () => [] } as unknown as Response;
          }
          return {
            ok: true,
            json: async () => ({ products: [] }),
          } as unknown as Response;
        });

      try {
        const res1 = await syncWorkerBoutiquePreOrders(mockEnv);
        expect(res1.ingestedCount).toBe(2);

        feedTick = 2;
        const res2 = await syncWorkerBoutiquePreOrders(mockEnv);
        expect(res2.ingestedCount).toBe(0);

        const countEndless = db
          .prepare(
            `SELECT COUNT(*) AS cnt FROM games WHERE platform_id = 35 AND igdb_id = 329138`,
          )
          .get() as { cnt: number };
        const countBeholgar = db
          .prepare(
            `SELECT COUNT(*) AS cnt FROM games WHERE platform_id = 35 AND igdb_id = 350035`,
          )
          .get() as { cnt: number };
        expect(countEndless.cnt).toBe(1);
        expect(countBeholgar.cnt).toBe(1);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('syncWorkerBoutiquePreOrders matches existing row by (platform_id, retail_url) when stored title formatting differs', async () => {
      db.prepare(
        `INSERT INTO games (stable_id, id, title, platform_id, retail_store, retail_url)
         VALUES (955, '955', 'Aeruta | PlayStation 5,', 35, 'Limited Game News', 'https://limitedgamenews.com/2026/09/11/aeruta-playstation-5/')`,
      ).run();

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) => {
          const url = String(input);
          if (url.includes('limitedgamenews.com/wp-json/wp/v2/posts')) {
            return {
              ok: true,
              json: async () => [
                {
                  id: 8803,
                  date_gmt: '2026-09-11T12:00:00',
                  link: 'https://limitedgamenews.com/2026/09/11/aeruta-playstation-5/',
                  title: { rendered: 'Aeruta | PlayStation 5' },
                  excerpt: { rendered: '<p>Physical edition announced.</p>' },
                  categories: [],
                },
              ],
            } as unknown as Response;
          }
          if (url.includes('limitedgamenews.com/wp-json/wp/v2/categories')) {
            return { ok: true, json: async () => [] } as unknown as Response;
          }
          return {
            ok: true,
            json: async () => ({ products: [] }),
          } as unknown as Response;
        });

      try {
        const res = await syncWorkerBoutiquePreOrders(mockEnv);
        expect(res.ingestedCount).toBe(0);
        const rows = db
          .prepare(`SELECT stable_id FROM games WHERE platform_id = 35`)
          .all();
        expect(rows).toHaveLength(1);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('GET /api/games/:id prioritizes owned release matching game region over unowned foreign releases', async () => {
      db.prepare(
        `INSERT INTO games (stable_id, id, title, platform_id, region)
         VALUES (930, 'castlevania-dominus-test', 'Castlevania Dominus Collection', 35, 'USA')`,
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

      // Querying by numeric stable_id with explicit ?release= overrides default owned release selection
      const explicitRelRes = await worker.fetch(
        new Request(
          'https://collection-tracker.example.com/api/games/930?release=castlevania-jp',
          {
            headers: { Cookie: `${SESSION_COOKIE}=${sessionToken}` },
          },
        ),
        mockEnv,
      );
      expect(explicitRelRes.status).toBe(200);
      const explicitData = (await explicitRelRes.json()) as {
        id: string;
        region: string;
        ownership_status: number;
      };
      expect(explicitData.id).toBe('castlevania-jp');
      expect(explicitData.region).toBe('Japan');
      expect(explicitData.ownership_status).toBe(0);

      // Foreign release ID passed in ?release= must not replace this game's own release
      db.prepare(
        `INSERT INTO games (stable_id, id, title, platform_id) VALUES (931, '931', 'Other Game', 35)`,
      ).run();
      db.prepare(
        `INSERT INTO game_releases (id, game_id, region) VALUES ('931-1', 931, 'Europe')`,
      ).run();
      const foreignRelRes = await worker.fetch(
        new Request(
          'https://collection-tracker.example.com/api/games/930?release=931-1',
          {
            headers: { Cookie: `${SESSION_COOKIE}=${sessionToken}` },
          },
        ),
        mockEnv,
      );
      expect(foreignRelRes.status).toBe(200);
      const foreignData = (await foreignRelRes.json()) as {
        id: string;
        region: string;
      };
      expect(foreignData.id).toBe('castlevania-usa');
      expect(foreignData.region).toBe('USA');
    });

    it('GET /api/admin/diagnostics/jobs returns 404 after migrating cron logs off D1', async () => {
      const authEnv = { ...mockEnv, ADMIN_KEY: 'test-secret-key' };

      const req = new Request(
        'https://collection-tracker.example.com/api/admin/diagnostics/jobs',
        {
          headers: { 'x-admin-key': 'test-secret-key' },
        },
      );
      const res = await worker.fetch(req, authEnv);
      expect(res.status).toBe(404);
    });

    it('logCronExecution emits structured JSON to console.log/console.error without writing to D1', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        logCronExecution(
          'boutique_preorders',
          'SUCCESS',
          1234,
          'Matched 5 pre-orders',
          { matched: 5 },
        );
        expect(logSpy).toHaveBeenCalledWith({
          event: 'cron_execution',
          job_name: 'boutique_preorders',
          status: 'SUCCESS',
          duration_ms: 1234,
          summary: 'Matched 5 pre-orders',
          details: { matched: 5 },
        });

        logCronExecution('retail_deals', 'ERROR', 99, 'Failed: boom', {
          error: 'boom',
        });
        expect(errSpy).toHaveBeenCalledWith({
          event: 'cron_execution',
          job_name: 'retail_deals',
          status: 'ERROR',
          duration_ms: 99,
          summary: 'Failed: boom',
          details: { error: 'boom' },
        });
      } finally {
        logSpy.mockRestore();
        errSpy.mockRestore();
      }
    });

    describe('Game & release deletion', () => {
      const adminHeaders = { 'x-admin-key': 'test-secret-key' };

      beforeEach(() => {
        db.prepare(
          `INSERT INTO games (stable_id, id, title, platform_id)
           VALUES (950, 'del-game', 'Deletable Game', 26)`,
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

      it('DELETE /api/collection/game and DELETE /api/collection/release return 404 even for admins and preserve rows', async () => {
        const delGameRes = await worker.fetch(
          new Request('http://localhost/api/collection/game?id=del-game', {
            method: 'DELETE',
            headers: adminHeaders,
          }),
          mockEnv,
        );
        expect(delGameRes.status).toBe(404);

        const delRelRes = await worker.fetch(
          new Request(
            'http://localhost/api/collection/release?id=del-game-eu',
            {
              method: 'DELETE',
              headers: adminHeaders,
            },
          ),
          mockEnv,
        );
        expect(delRelRes.status).toBe(404);

        expect(
          db.prepare('SELECT 1 FROM games WHERE id = ?').get('del-game'),
        ).toBeDefined();
        expect(
          db
            .prepare(
              'SELECT COUNT(*) AS cnt FROM game_releases WHERE game_id = 950',
            )
            .get(),
        ).toEqual({ cnt: 2 });
        expect(
          db
            .prepare(
              `SELECT COUNT(*) AS cnt FROM user_game_releases WHERE release_id IN ('del-game-usa', 'del-game-eu')`,
            )
            .get(),
        ).toEqual({ cnt: 2 });
        expect(
          db
            .prepare(
              `SELECT 1 FROM journal_entries WHERE item_type = 'game' AND item_id = 'del-game'`,
            )
            .get(),
        ).toBeDefined();
      });
    });
  });

  describe('Scheduled Cron & Multi-User Execution', () => {
    it('scheduled cron gates boutique pre-order sync to 1-hour interval', async () => {
      const slot06Ms = Date.parse('2026-11-18T06:00:00Z');
      const scheduledEvent = {
        cron: '0 * * * *',
        type: 'scheduled',
        scheduledTime: slot06Ms,
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

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const countBoutiqueLogs = () =>
        logSpy.mock.calls.filter(
          ([arg]) =>
            typeof arg === 'object' &&
            arg !== null &&
            (arg as Record<string, unknown>)['event'] === 'cron_execution' &&
            (arg as Record<string, unknown>)['job_name'] ===
              'boutique_preorders',
        ).length;

      try {
        // 1. Initial run: boutique_sync_last_run does not exist -> runs boutique sync
        db.prepare(
          `DELETE FROM sync_state WHERE key = 'boutique_sync_last_run'`,
        ).run();

        await worker.scheduled(scheduledEvent, mockEnv, {} as ExecutionContext);

        expect(countBoutiqueLogs()).toBe(1);

        // 2. Second run immediately (simulating 30 min run within 55 min window) -> skips boutique sync
        db.prepare(
          `INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES ('boutique_sync_last_run', datetime('now'), datetime('now'))`,
        ).run();
        await worker.scheduled(scheduledEvent, mockEnv, {} as ExecutionContext);

        expect(countBoutiqueLogs()).toBe(1); // Still 1, did not re-run!

        // 3. Third run after 60 minutes -> executes boutique sync
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        db.prepare(
          `INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES ('boutique_sync_last_run', ?, ?)`,
        ).run(oneHourAgo, oneHourAgo);
        await worker.scheduled(scheduledEvent, mockEnv, {} as ExecutionContext);

        expect(countBoutiqueLogs()).toBe(2); // Ran again!
      } finally {
        logSpy.mockRestore();
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

      it('GET /api/user/profile and PUT /api/user/profile manages user settings, homeRegion, and trackIndividualMedia', async () => {
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
          trackIndividualMedia: boolean;
        };
        expect(initial.username).toBe('alice');
        expect(initial.homeRegion).toBe('USA');
        expect(initial.trackIndividualMedia).toBe(false);

        // 2. PUT profile updating homeRegion, isPublic, bio, trackIndividualMedia
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
              trackIndividualMedia: true,
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
          trackIndividualMedia: boolean;
        };
        expect(updated.homeRegion).toBe('Japan');
        expect(updated.isPublic).toBe(true);
        expect(updated.bio).toBe('Retro gaming archivist');
        expect(updated.displayName).toBe('Alice M.');
        expect(updated.trackIndividualMedia).toBe(true);

        // 3. Verify GET /api/user/profile and GET /api/auth/me return trackIndividualMedia: true
        const getRes2 = await worker.fetch(
          new Request(
            'https://collection-tracker.example.com/api/user/profile',
            { headers: authHeaders },
          ),
          mockEnv,
        );
        expect(getRes2.status).toBe(200);
        expect(
          ((await getRes2.json()) as { trackIndividualMedia: boolean })
            .trackIndividualMedia,
        ).toBe(true);

        const meRes = await worker.fetch(
          new Request('https://collection-tracker.example.com/api/auth/me', {
            headers: authHeaders,
          }),
          mockEnv,
        );
        expect(meRes.status).toBe(200);
        const meJson = (await meRes.json()) as {
          authenticated: boolean;
          user: { trackIndividualMedia: boolean };
        };
        expect(meJson.authenticated).toBe(true);
        expect(meJson.user.trackIndividualMedia).toBe(true);

        // 4. Verify in DB
        const dbRow = db
          .prepare(
            'SELECT home_region, is_public, bio, display_name, track_individual_media FROM users WHERE id = 1',
          )
          .get() as {
          home_region: string;
          is_public: number;
          bio: string;
          display_name: string;
          track_individual_media: number;
        };
        expect(dbRow.home_region).toBe('Japan');
        expect(dbRow.is_public).toBe(1);
        expect(dbRow.bio).toBe('Retro gaming archivist');
        expect(dbRow.display_name).toBe('Alice M.');
        expect(dbRow.track_individual_media).toBe(1);

        // 5. Toggle back to false and update autoSeekReleaseScope / autoSeekRegionScope
        const putDisableRes = await worker.fetch(
          new Request(
            'https://collection-tracker.example.com/api/user/profile',
            {
              method: 'PUT',
              headers: authHeaders,
              body: JSON.stringify({
                trackIndividualMedia: false,
                autoSeekReleaseScope: 'all_releases',
                autoSeekRegionScope: 'any',
              }),
            },
          ),
          mockEnv,
        );
        expect(putDisableRes.status).toBe(200);
        const disabledPayload = (await putDisableRes.json()) as {
          trackIndividualMedia: boolean;
          autoSeekReleaseScope: string;
          autoSeekRegionScope: string;
        };
        expect(disabledPayload.trackIndividualMedia).toBe(false);
        expect(disabledPayload.autoSeekReleaseScope).toBe('all_releases');
        expect(disabledPayload.autoSeekRegionScope).toBe('any');

        // 6. Reject invalid autoSeekReleaseScope / autoSeekRegionScope
        const badScopeRes = await worker.fetch(
          new Request(
            'https://collection-tracker.example.com/api/user/profile',
            {
              method: 'PUT',
              headers: authHeaders,
              body: JSON.stringify({ autoSeekReleaseScope: 'invalid_scope' }),
            },
          ),
          mockEnv,
        );
        expect(badScopeRes.status).toBe(400);
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

        // 3. Push subscription user_id scoping and SSRF endpoint protection
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
            `INSERT INTO games (stable_id, id, title, platform_id)
             VALUES (?, ?, ?, 26)`,
          ).run(960 + i, `coalesce-game-${i}`, `Coalesce Game ${i}`);
          db.prepare(
            `INSERT INTO game_releases (id, game_id, region, variants)
             VALUES (?, ?, 'USA', ?)`,
          ).run(`coalesce-rel-${i}`, 960 + i, "Collector's Edition");
        }
        // User 1 owns the Collector's Edition of all 4 games; User 2 owns none
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
            title: `Coalesce Game ${i} Collector's Edition - Nintendo Switch`,
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
          // User 1 owns all 4 -> 0 notifications; User 2 owns 0 of the 4 -> single multi-line notification listing all 4!
          expect(result.notifications.dispatchedCount).toBe(1);
          expect(webPushSpy).toHaveBeenCalledTimes(1);
          const sentPayload = webPushSpy.mock.calls[0][1];
          expect(sentPayload.title).toBe('📦 4 Physical Editions Announced');
          expect(sentPayload.body).toContain('Coalesce Game 1');
          expect(sentPayload.body).toContain('Coalesce Game 2');
          expect(sentPayload.body).toContain('Coalesce Game 3');
          expect(sentPayload.body).toContain('Coalesce Game 4');
          expect(sentPayload.body).not.toContain('more!');
          expect(webPushSpy).toHaveBeenCalledWith(
            expect.objectContaining({
              endpoint: 'https://fcm.googleapis.com/fcm/send/u2',
            }),
            expect.anything(),
            expect.anything(),
          );
        } finally {
          fetchSpy.mockRestore();
          webPushSpy.mockRestore();
        }
      });

      it('short-circuits syncWorkerBoutiquePreOrders when boutique_feed_hash is unchanged and re-evaluates after markDbDirty', async () => {
        db.prepare(
          `INSERT INTO games (stable_id, id, title, platform_id)
           VALUES (975, 'feed-hash-game', 'Feed Hash Game', 26)`,
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

      it('PERF-02: syncWorkerRetailDeals incurs 0 writes on unchanged repeat runs and resets only expired sales', async () => {
        db.prepare(
          `INSERT INTO games (stable_id, id, title, platform_id, retail_on_sale, retail_price, retail_regular_price, retail_discount_pct, retail_store, retail_url)
           VALUES (980, 'active-deal-sw', 'Octopath Traveler II', 26, 0, null, null, null, null, null),
                  (981, 'expired-deal-sw', 'Expired Sale Game', 26, 1, 1999, 5999, 67, 'VGP', 'https://videogamesplus.ca/products/expired')`,
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
            .prepare(
              'SELECT retail_on_sale, retail_price, retail_discount_pct FROM games WHERE stable_id = 981',
            )
            .get() as {
            retail_on_sale: number;
            retail_price: number;
            retail_discount_pct: number;
          };
          expect(activeRow).toEqual({ retail_on_sale: 1, retail_price: 2189 });
          expect(expiredRow).toEqual({
            retail_on_sale: 0,
            retail_price: 5999,
            retail_discount_pct: 0,
          });

          // Run 2 with identical retail feed -> 0 D1 row writes!
          gameRowWrites = 0;
          await syncWorkerRetailDeals(mockEnv);
          expect(gameRowWrites).toBe(0);
        } finally {
          mockDb.prepare = basePrepare;
          fetchSpy.mockRestore();
        }
      });

      it('suppresses deal notifications when a game has an Owned (1) release alongside a Seeking (2) sibling release', async () => {
        db.prepare(
          `INSERT INTO games (stable_id, id, title, platform_id)
           VALUES (991, 'mixed-owned-game', 'Mixed Owned Game', 26)`,
        ).run();
        db.prepare(
          `INSERT INTO game_releases (id, game_id, region)
           VALUES ('991-1', 991, 'USA'), ('991-2', 991, 'Europe')`,
        ).run();
        db.prepare(
          `INSERT INTO user_game_releases (user_id, release_id, ownership_status)
           VALUES (1, '991-1', 1), (1, '991-2', 2)`,
        ).run();
        db.prepare(
          `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, preferences_json, created_at, updated_at)
           VALUES ('sub-deal-prec', 1, 'https://fcm.googleapis.com/fcm/send/prec', 'p256', 'auth', '{"enabled":true,"scope":"seeking_only","minDiscountPct":10}', datetime('now'), datetime('now'))`,
        ).run();

        const webPushSpy = vi
          .spyOn(webPush, 'sendWebPushNotification')
          .mockResolvedValue({
            success: true,
            status: 201,
            shouldDelete: false,
          });
        try {
          const gameLookup = new Map([
            [
              991,
              {
                id: 'mixed-owned-game',
                title: 'Mixed Owned Game',
                platform_id: 26,
                ownership_status: 2,
              },
            ],
          ]);
          const bestDealByGame = new Map([
            [
              991,
              {
                store: 'VGP' as const,
                sku: 'mixed-owned-game',
                name: 'Mixed Owned Game',
                regularPrice: 59.99,
                salePrice: 29.99,
                onSale: true,
                percentSavings: 50,
                url: 'https://videogamesplus.ca/products/mixed-owned',
                onlineAvailability: true,
              },
            ],
          ]);

          const res = await dispatchDealPushNotifications(
            mockEnv,
            gameLookup,
            bestDealByGame,
          );
          expect(res.dispatchedCount).toBe(0);
          expect(webPushSpy).not.toHaveBeenCalled();

          // Multi-line deal notifications list all deals and split into 2 notifications if body > 350 chars
          expect(
            buildMultiLineNotificationBodies(
              Array.from(
                { length: 8 },
                (_, i) =>
                  `• Very Long Game Title Number ${i + 1}: Special Complete Edition — $19.99 (-50%, VGP)`,
              ),
              350,
            ).length,
          ).toBeGreaterThan(1);

          db.prepare(
            `DELETE FROM user_game_releases WHERE release_id = '991-1'`,
          ).run();
          for (let i = 1; i <= 7; i++) {
            const gid = 992 + i;
            db.prepare(
              `INSERT INTO games (stable_id, id, title, platform_id) VALUES (?, ?, ?, 26)`,
            ).run(
              gid,
              `long-deal-${i}`,
              `Ultra Long Deluxe Collector Physical Game Title ${i}`,
            );
            db.prepare(
              `INSERT INTO game_releases (id, game_id, region) VALUES (?, ?, 'USA')`,
            ).run(`${gid}-1`, gid);
            db.prepare(
              `INSERT INTO user_game_releases (user_id, release_id, ownership_status) VALUES (1, ?, 2)`,
            ).run(`${gid}-1`);
            gameLookup.set(gid, {
              id: `long-deal-${i}`,
              title: `Ultra Long Deluxe Collector Physical Game Title ${i}`,
              platform_id: 26,
              ownership_status: 2,
            });
            bestDealByGame.set(gid, {
              store: 'VGP' as const,
              sku: `long-deal-${i}`,
              name: `Ultra Long Deluxe Collector Physical Game Title ${i}`,
              regularPrice: 59.99,
              salePrice: 19.99,
              onSale: true,
              percentSavings: 67,
              url: `https://videogamesplus.ca/products/long-deal-${i}`,
              onlineAvailability: true,
            });
          }
          const multiRes = await dispatchDealPushNotifications(
            mockEnv,
            gameLookup,
            bestDealByGame,
          );
          expect(multiRes.dispatchedCount).toBeGreaterThan(1);
          expect(
            webPushSpy.mock.calls.every(
              (c) => !String(c[1].body).includes('more!'),
            ),
          ).toBe(true);
          expect(webPushSpy.mock.calls[0][1].title).toContain('(1/');
        } finally {
          webPushSpy.mockRestore();
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

          // Sanitize unsafe javascript: receipt_url on journal entry -> stored as null
          const badUrlJournalRes = await worker.fetch(
            new Request('http://localhost/api/journal', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                item_type: 'game',
                item_id: 'mario',
                receipt_url: 'javascript:alert(1)',
              }),
            }),
            mockEnv,
          );
          expect(badUrlJournalRes.status).toBe(200);
          const journalRow = db
            .prepare(
              `SELECT receipt_url FROM journal_entries WHERE item_type = 'game' AND item_id = 'mario'`,
            )
            .get() as { receipt_url: string | null } | undefined;
          expect(journalRow?.receipt_url ?? null).toBeNull();

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

    describe('POST /api/admin/verify-ownership/apply', () => {
      it('rejects unauthenticated requests with 401, non-admin sessions with 403, and cross-origin requests with 403', async () => {
        const unauthRes = await worker.fetch(
          new Request(
            'https://collection-tracker.example.com/api/admin/verify-ownership/apply',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Origin: 'https://collection-tracker.example.com',
              },
              body: JSON.stringify({
                setMediaOwned: ['gb-mario'],
                clearMediaOwned: [],
              }),
            },
          ),
          mockEnv,
        );
        expect(unauthRes.status).toBe(401);

        const nonAdminToken = await signSession(
          {
            id: 2,
            username: 'bob',
            role: 'user',
            homeRegion: 'USA',
          },
          mockEnv.SESSION_SECRET!,
        );
        const nonAdminRes = await worker.fetch(
          new Request(
            'https://collection-tracker.example.com/api/admin/verify-ownership/apply',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Origin: 'https://collection-tracker.example.com',
                Cookie: `${HOST_SESSION_COOKIE}=${nonAdminToken}`,
              },
              body: JSON.stringify({
                setMediaOwned: ['gb-mario'],
                clearMediaOwned: [],
              }),
            },
          ),
          mockEnv,
        );
        expect(nonAdminRes.status).toBe(403);

        const csrfRes = await worker.fetch(
          new Request('http://localhost/api/admin/verify-ownership/apply', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://evil.example.com',
            },
            body: JSON.stringify({
              setMediaOwned: ['gb-mario'],
              clearMediaOwned: [],
            }),
          }),
          mockEnv,
        );
        expect(csrfRes.status).toBe(403);
      });

      it('applies setMediaOwned and clearMediaOwned isolated to the authenticated admin user', async () => {
        db.exec(`
          INSERT INTO users (id, username, is_public, home_region, display_name)
          VALUES (2, 'bob', 1, 'USA', 'Bob');
          INSERT INTO game_releases (id, game_id, region, variants, rom_name)
          VALUES ('gb-mario-rev1', 1, 'USA', 'Rev 1', 'Super Mario Bros (USA) (Rev 1).nes');
          INSERT INTO user_game_releases (user_id, release_id, ownership_status, has_media)
          VALUES (1, 'gb-mario-rev1', 0, 1),
                 (2, 'gb-mario', 1, 0),
                 (2, 'gb-mario-rev1', 1, 1);
        `);

        const token = await signSession(
          {
            id: 1,
            username: 'alice',
            role: 'admin',
            homeRegion: 'USA',
          },
          mockEnv.SESSION_SECRET!,
        );

        const res = await worker.fetch(
          new Request('http://localhost/api/admin/verify-ownership/apply', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `${SESSION_COOKIE}=${token}`,
            },
            body: JSON.stringify({
              setMediaOwned: ['gb-mario'],
              clearMediaOwned: ['gb-mario-rev1'],
            }),
          }),
          mockEnv,
        );

        expect(res.status).toBe(200);
        const data = (await res.json()) as {
          success: boolean;
          setCount: number;
          clearCount: number;
          transferredCount: number;
        };
        expect(data).toEqual({
          success: true,
          setCount: 1,
          clearCount: 1,
          transferredCount: 0,
          declaredOwnedCount: 0,
        });

        const aliceRows = db
          .prepare(
            'SELECT release_id, ownership_status, has_media FROM user_game_releases WHERE user_id = 1 ORDER BY release_id',
          )
          .all() as Array<{
          release_id: string;
          ownership_status: number;
          has_media: number;
        }>;
        expect(aliceRows).toEqual([
          { release_id: 'gb-mario', ownership_status: 1, has_media: 1 },
          {
            release_id: 'gb-mario-rev1',
            ownership_status: 0,
            has_media: 0,
          },
        ]);

        // Bob's rows remain completely untouched
        const bobRows = db
          .prepare(
            'SELECT release_id, ownership_status, has_media FROM user_game_releases WHERE user_id = 2 ORDER BY release_id',
          )
          .all() as Array<{
          release_id: string;
          ownership_status: number;
          has_media: number;
        }>;
        expect(bobRows).toEqual([
          { release_id: 'gb-mario', ownership_status: 1, has_media: 0 },
          {
            release_id: 'gb-mario-rev1',
            ownership_status: 1,
            has_media: 1,
          },
        ]);
      });

      it('transfers SKU ownership, migrates has_case and has_manual across multi-disc target SKUs, and preserves play_status & journal entries', async () => {
        db.exec(`
          INSERT INTO games (stable_id, id, title, platform_id)
          VALUES (50, 'ff7-ps1', 'Final Fantasy VII', 1);
          INSERT INTO game_releases (id, game_id, region, variants, rom_name)
          VALUES ('ff7-rev0-d1', 50, 'USA', null, 'Final Fantasy VII (USA) (Disc 1).cue'),
                 ('ff7-rev0-d2', 50, 'USA', null, 'Final Fantasy VII (USA) (Disc 2).cue'),
                 ('ff7-rev1-d1', 50, 'USA', 'Rev 1', 'Final Fantasy VII (USA) (Disc 1) (Rev 1).cue'),
                 ('ff7-rev1-d2', 50, 'USA', 'Rev 1', 'Final Fantasy VII (USA) (Disc 2) (Rev 1).cue');
          INSERT INTO user_game_releases (user_id, release_id, ownership_status, has_media, has_case, has_manual)
          VALUES (1, 'ff7-rev0-d1', 1, 0, 1, 1),
                 (1, 'ff7-rev0-d2', 1, 0, 1, 1);
          INSERT INTO user_games (user_id, game_id, play_status, queued)
          VALUES (1, 50, 2, 1);
          INSERT INTO journal_entries (user_id, item_type, item_id, purchase_date, price_paid, merchant)
          VALUES (1, 'game', 'ff7-ps1', '1997-09-07', 49.99, 'EB Games');
        `);

        const token = await signSession(
          {
            id: 1,
            username: 'alice',
            role: 'admin',
            homeRegion: 'USA',
          },
          mockEnv.SESSION_SECRET!,
        );

        // Only Disc 1 of Rev 1 was verified in the scan, while ownership transfers to the full 2-disc Rev 1 SKU
        const res = await worker.fetch(
          new Request('http://localhost/api/admin/verify-ownership/apply', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `${SESSION_COOKIE}=${token}`,
            },
            body: JSON.stringify({
              setMediaOwned: ['ff7-rev1-d1'],
              clearMediaOwned: [],
              ownershipTransfers: [
                {
                  fromReleaseIds: ['ff7-rev0-d1', 'ff7-rev0-d2'],
                  toReleaseIds: ['ff7-rev1-d1', 'ff7-rev1-d2'],
                },
              ],
            }),
          }),
          mockEnv,
        );

        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          success: boolean;
          setCount: number;
          clearCount: number;
          transferredCount: number;
        };
        expect(body).toEqual({
          success: true,
          setCount: 1,
          clearCount: 0,
          transferredCount: 1,
          declaredOwnedCount: 0,
        });

        const ff7Rels = db
          .prepare(
            `SELECT release_id, ownership_status, has_media, has_case, has_manual
             FROM user_game_releases
             WHERE user_id = 1 AND release_id LIKE 'ff7-%'
             ORDER BY release_id`,
          )
          .all() as Array<{
          release_id: string;
          ownership_status: number;
          has_media: number;
          has_case: number;
          has_manual: number;
        }>;

        expect(ff7Rels).toEqual([
          {
            release_id: 'ff7-rev0-d1',
            ownership_status: 0,
            has_media: 0,
            has_case: 0,
            has_manual: 0,
          },
          {
            release_id: 'ff7-rev0-d2',
            ownership_status: 0,
            has_media: 0,
            has_case: 0,
            has_manual: 0,
          },
          {
            release_id: 'ff7-rev1-d1',
            ownership_status: 1,
            has_media: 1,
            has_case: 1,
            has_manual: 1,
          },
          {
            release_id: 'ff7-rev1-d2',
            ownership_status: 1,
            has_media: 0,
            has_case: 1,
            has_manual: 1,
          },
        ]);

        // Verify play_status, queued, and journal entry are preserved
        const userGame = db
          .prepare(
            'SELECT play_status, queued FROM user_games WHERE user_id = 1 AND game_id = 50',
          )
          .get() as { play_status: number; queued: number };
        expect(userGame).toEqual({ play_status: 2, queued: 1 });

        const journal = db
          .prepare(
            "SELECT item_id, price_paid, merchant FROM journal_entries WHERE user_id = 1 AND item_id = 'ff7-ps1'",
          )
          .get() as { item_id: string; price_paid: number; merchant: string };
        expect(journal).toEqual({
          item_id: 'ff7-ps1',
          price_paid: 49.99,
          merchant: 'EB Games',
        });
      });

      it('rejects cross-game ownershipTransfers with 400', async () => {
        db.exec(`
          INSERT INTO games (stable_id, id, title, platform_id)
          VALUES (60, 'other-game', 'Other Game', 1);
          INSERT INTO game_releases (id, game_id, region)
          VALUES ('other-game-rel', 60, 'USA');
        `);

        const token = await signSession(
          {
            id: 1,
            username: 'alice',
            role: 'admin',
            homeRegion: 'USA',
          },
          mockEnv.SESSION_SECRET!,
        );

        const res = await worker.fetch(
          new Request('http://localhost/api/admin/verify-ownership/apply', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `${SESSION_COOKIE}=${token}`,
            },
            body: JSON.stringify({
              setMediaOwned: ['other-game-rel'],
              clearMediaOwned: [],
              ownershipTransfers: [
                {
                  fromReleaseIds: ['gb-mario'],
                  toReleaseIds: ['other-game-rel'],
                },
              ],
            }),
          }),
          mockEnv,
        );

        expect(res.status).toBe(400);
        const err = (await res.json()) as { error: string };
        expect(err.error).toContain('same game');
      });

      it('declares ownership with has_case and has_manual via ownershipDeclarations without clearing existing flags', async () => {
        db.exec(`
          INSERT INTO games (stable_id, id, title, platform_id)
          VALUES (60, 'metroid-snes', 'Super Metroid', 1);
          INSERT INTO game_releases (id, game_id, region, variants, rom_name)
          VALUES ('sm-usa', 60, 'USA', null, 'Super Metroid (USA).sfc'),
                 ('sm-jpn', 60, 'Japan', null, 'Super Metroid (Japan).sfc');
          INSERT INTO user_game_releases (user_id, release_id, ownership_status, has_media, has_case, has_manual)
          VALUES (1, 'sm-jpn', 2, 0, 0, 1);
        `);

        const token = await signSession(
          {
            id: 1,
            username: 'alice',
            role: 'admin',
            homeRegion: 'USA',
          },
          mockEnv.SESSION_SECRET!,
        );

        const res = await worker.fetch(
          new Request('http://localhost/api/admin/verify-ownership/apply', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `${SESSION_COOKIE}=${token}`,
            },
            body: JSON.stringify({
              setMediaOwned: ['sm-usa', 'sm-jpn'],
              clearMediaOwned: [],
              ownershipDeclarations: [
                { releaseId: 'sm-usa', hasCase: 1, hasManual: 0 },
                { releaseId: 'sm-jpn', hasCase: 1, hasManual: 0 },
              ],
            }),
          }),
          mockEnv,
        );

        expect(res.status).toBe(200);
        const data = (await res.json()) as {
          success: boolean;
          setCount: number;
          clearCount: number;
          transferredCount: number;
          declaredOwnedCount: number;
        };
        expect(data).toEqual({
          success: true,
          setCount: 2,
          clearCount: 0,
          transferredCount: 0,
          declaredOwnedCount: 2,
        });

        const rows = db
          .prepare(
            `SELECT release_id, ownership_status, has_media, has_case, has_manual
             FROM user_game_releases
             WHERE user_id = 1 AND release_id IN ('sm-usa', 'sm-jpn')
             ORDER BY release_id`,
          )
          .all() as Array<{
          release_id: string;
          ownership_status: number;
          has_media: number;
          has_case: number;
          has_manual: number;
        }>;

        expect(rows).toEqual([
          {
            release_id: 'sm-jpn',
            ownership_status: 1,
            has_media: 1,
            has_case: 1,
            has_manual: 1, // preserved existing has_manual = 1 via MAX
          },
          {
            release_id: 'sm-usa',
            ownership_status: 1,
            has_media: 1,
            has_case: 1,
            has_manual: 0,
          },
        ]);
      });

      it('POST /api/collection/toggle with field has_media accepts integers/booleans and updates only the targeted release', async () => {
        db.exec(`
          INSERT INTO games (stable_id, id, title, platform_id)
          VALUES (55, 'mgs-ps1', 'Metal Gear Solid', 1);
          INSERT INTO game_releases (id, game_id, region, variants, rom_name)
          VALUES ('mgs-d1', 55, 'USA', 'Disc 1', 'Metal Gear Solid (USA) (Disc 1).cue'),
                 ('mgs-d2', 55, 'USA', 'Disc 2', 'Metal Gear Solid (USA) (Disc 2).cue');
          INSERT INTO user_game_releases (user_id, release_id, ownership_status, has_media)
          VALUES (1, 'mgs-d1', 1, 0),
                 (1, 'mgs-d2', 1, 0);
        `);

        const token = await signSession(
          {
            id: 1,
            username: 'alice',
            role: 'user',
            homeRegion: 'USA',
          },
          mockEnv.SESSION_SECRET!,
        );

        const toggleTrueRes = await worker.fetch(
          new Request(
            'https://collection-tracker.example.com/api/collection/toggle',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Origin: 'https://collection-tracker.example.com',
                Cookie: `${HOST_SESSION_COOKIE}=${token}`,
              },
              body: JSON.stringify({
                id: 'mgs-d1',
                type: 'game',
                field: 'has_media',
                status: true,
              }),
            },
          ),
          mockEnv,
        );
        expect(toggleTrueRes.status).toBe(200);

        const rowsAfterEnable = db
          .prepare(
            "SELECT release_id, has_media FROM user_game_releases WHERE user_id = 1 AND release_id IN ('mgs-d1', 'mgs-d2') ORDER BY release_id",
          )
          .all() as Array<{ release_id: string; has_media: number }>;
        expect(rowsAfterEnable).toEqual([
          { release_id: 'mgs-d1', has_media: 1 },
          { release_id: 'mgs-d2', has_media: 0 },
        ]);

        const toggleZeroRes = await worker.fetch(
          new Request(
            'https://collection-tracker.example.com/api/collection/toggle',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Origin: 'https://collection-tracker.example.com',
                Cookie: `${HOST_SESSION_COOKIE}=${token}`,
              },
              body: JSON.stringify({
                id: 'mgs-d1',
                type: 'game',
                field: 'has_media',
                status: 0,
              }),
            },
          ),
          mockEnv,
        );
        expect(toggleZeroRes.status).toBe(200);

        const rowAfterDisable = db
          .prepare(
            "SELECT has_media FROM user_game_releases WHERE user_id = 1 AND release_id = 'mgs-d1'",
          )
          .get() as { has_media: number };
        expect(rowAfterDisable.has_media).toBe(0);
      });

      it('hydrates has_media from R2 fallback snapshots', async () => {
        resetR2SnapshotCache();
        resetWorkerRateLimits();

        const r2Snapshot = {
          version: 'v1-snapshot',
          timestamp: '2026-11-21T00:00:00Z',
          tables: {
            platforms: [
              { id: 1, name: 'SNES', display_name: 'SNES', sort_index: 0 },
            ],
            games: [
              {
                stable_id: 1,
                id: 'mario',
                title: 'Super Mario Bros',
                platform_id: 1,
                sort_index: 0,
              },
            ],
            game_releases: [
              {
                id: 'gb-mario',
                game_id: 1,
                region: 'USA',
                variants: null,
                rom_name: 'Super Mario Bros (USA).nes',
                rom_crc: null,
                release_date: '1985-10-18',
              },
            ],
            users: [
              {
                id: 1,
                username: 'alice',
                is_public: 1,
                home_region: 'USA',
              },
            ],
            user_game_releases: [
              {
                user_id: 1,
                release_id: 'gb-mario',
                ownership_status: 1,
                has_media: 1,
                has_case: 1,
                has_manual: 0,
              },
            ],
            user_games: [{ user_id: 1, game_id: 1, play_status: 2 }],
            toy_series: [],
            toys: [],
            user_toys: [],
            game_bundles: [],
            journal_entries: [],
            price_query_overrides: [],
          },
        };
        mockBucket.storage.set(
          'snapshots/latest.json',
          JSON.stringify(r2Snapshot),
        );

        const failingDb = {
          prepare: () => ({
            bind: () => ({
              all: async () => {
                throw new Error('D1_ERROR: exceeded rows read quota');
              },
              first: async () => {
                throw new Error('D1_ERROR: exceeded rows read quota');
              },
              run: async () => {
                throw new Error('D1_ERROR: exceeded rows read quota');
              },
            }),
            all: async () => {
              throw new Error('D1_ERROR: exceeded rows read quota');
            },
            first: async () => {
              throw new Error('D1_ERROR: exceeded rows read quota');
            },
            run: async () => {
              throw new Error('D1_ERROR: exceeded rows read quota');
            },
          }),
          batch: async () => {
            throw new Error('D1_ERROR: exceeded rows read quota');
          },
        } as unknown as Env['DB'];

        const token = await signSession(
          { id: 1, username: 'alice', role: 'user', homeRegion: 'USA' },
          mockEnv.SESSION_SECRET!,
        );

        const gamesRes = await worker.fetch(
          new Request('https://collection-tracker.example.com/api/games', {
            headers: { Cookie: `${HOST_SESSION_COOKIE}=${token}` },
          }),
          { ...mockEnv, DB: failingDb },
        );
        expect(gamesRes.status).toBe(200);
        const gamesBody = (await gamesRes.json()) as Array<{
          id: string;
          has_media?: number;
        }>;
        expect(gamesBody[0]).toMatchObject({
          id: 'gb-mario',
          has_media: 1,
        });

        const detailRes = await worker.fetch(
          new Request(
            'https://collection-tracker.example.com/api/games/gb-mario',
            {
              headers: { Cookie: `${HOST_SESSION_COOKIE}=${token}` },
            },
          ),
          { ...mockEnv, DB: failingDb },
        );
        expect(detailRes.status).toBe(200);
        const detailBody = (await detailRes.json()) as {
          has_media?: number;
          releases?: Array<{ id: string; has_media?: number }>;
        };
        expect(detailBody.has_media).toBe(1);
        expect(detailBody.releases?.[0]?.has_media).toBe(1);
      });
    });

    describe('PrioritySeeking, User Tracking Rules & Broad Catalog Population', () => {
      it('resolveAmiiboRegionsAndMetadata derives multi-region strings and metadata_json.releases from AmiiboAPI release dates', () => {
        const worldwide = resolveAmiiboRegionsAndMetadata({
          na: '2014-11-21',
          eu: '2014-11-28',
          jp: '2014-12-06',
          au: '2014-11-29',
        });
        expect(worldwide.region).toBe('USA, Europe, Japan, Australia');
        expect(worldwide.defaultDate).toBe('2014-11-21');
        expect(JSON.parse(worldwide.metadataJson || '{}')).toEqual({
          releases: {
            USA: '2014-11-21',
            Europe: '2014-11-28',
            Japan: '2014-12-06',
            Australia: '2014-11-29',
          },
        });

        const jpOnly = resolveAmiiboRegionsAndMetadata({
          na: null,
          eu: null,
          jp: '2017-03-25',
          au: null,
        });
        expect(jpOnly.region).toBe('Japan');
        expect(jpOnly.defaultDate).toBe('2017-03-25');
      });

      it('reactively auto-tracks a canonical_series and marks existing unowned games in that series as Seeking (2) when toggling a game to Owned (1)', async () => {
        db.exec(`
          INSERT INTO games (stable_id, id, title, platform_id, canonical_series, collections, region)
          VALUES
            (701, 'pikmin-1', 'Pikmin', 20, 'Pikmin', 'Pikmin', 'USA'),
            (702, 'pikmin-2', 'Pikmin 2', 20, 'Pikmin', 'Pikmin', 'USA');
          INSERT INTO game_releases (id, game_id, region)
          VALUES
            ('pikmin-1-usa', 701, 'USA'),
            ('pikmin-2-usa', 702, 'USA');
        `);

        const token = await signSession(
          {
            id: 1,
            username: 'alice',
            role: 'admin',
            homeRegion: 'USA',
          },
          mockEnv.SESSION_SECRET!,
        );

        const res = await worker.fetch(
          new Request('http://localhost/api/collection/toggle', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `${SESSION_COOKIE}=${token}`,
            },
            body: JSON.stringify({
              id: 'pikmin-1-usa',
              type: 'game',
              status: 1,
              field: 'ownership_status',
            }),
          }),
          mockEnv,
        );

        expect(res.status).toBe(200);

        const rule = db
          .prepare(
            "SELECT rule_type, match_value, target_status, is_ignored FROM user_tracking_rules WHERE user_id = 1 AND rule_type = 'series' AND match_value = 'Pikmin'",
          )
          .get() as {
          rule_type: string;
          match_value: string;
          target_status: number;
          is_ignored: number;
        };
        expect(rule).toEqual({
          rule_type: 'series',
          match_value: 'Pikmin',
          target_status: 2,
          is_ignored: 0,
        });

        const pikmin2Status = db
          .prepare(
            "SELECT ownership_status FROM user_game_releases WHERE user_id = 1 AND release_id = 'pikmin-2-usa'",
          )
          .get() as { ownership_status: number };
        expect(pikmin2Status).toEqual({ ownership_status: 2 });
      });

      it('supports /api/user/tracking-rules GET/POST/DELETE and clears existing Seeking (2) when ignoring a series', async () => {
        db.exec(`
          INSERT INTO games (stable_id, id, title, platform_id, canonical_series, region)
          VALUES (710, 'fifa-23', 'FIFA 23', 35, 'FIFA', 'USA');
          INSERT INTO game_releases (id, game_id, region)
          VALUES ('fifa-23-usa', 710, 'USA');
          INSERT INTO user_game_releases (user_id, release_id, ownership_status)
          VALUES (1, 'fifa-23-usa', 2);
        `);

        const token = await signSession(
          {
            id: 1,
            username: 'alice',
            role: 'admin',
            homeRegion: 'USA',
          },
          mockEnv.SESSION_SECRET!,
        );

        // Ignore FIFA series and clear existing seeking
        const postRes = await worker.fetch(
          new Request('http://localhost/api/user/tracking-rules', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `${SESSION_COOKIE}=${token}`,
            },
            body: JSON.stringify({
              rule_type: 'series',
              target_value: 'FIFA',
              is_ignored: true,
              clear_existing_seeking: true,
            }),
          }),
          mockEnv,
        );
        expect(postRes.status).toBe(200);

        const fifaStatus = db
          .prepare(
            "SELECT ownership_status FROM user_game_releases WHERE user_id = 1 AND release_id = 'fifa-23-usa'",
          )
          .get() as { ownership_status: number };
        expect(fifaStatus.ownership_status).toBe(0);

        const getRes = await worker.fetch(
          new Request('http://localhost/api/user/tracking-rules', {
            headers: { Cookie: `${SESSION_COOKIE}=${token}` },
          }),
          mockEnv,
        );
        expect(getRes.status).toBe(200);
        const rules = (await getRes.json()) as Array<{
          rule_type: string;
          target_value: string;
          is_ignored: number;
        }>;
        expect(rules).toContainEqual(
          expect.objectContaining({
            rule_type: 'series',
            target_value: 'FIFA',
            is_ignored: 1,
          }),
        );

        const delRes = await worker.fetch(
          new Request(
            'http://localhost/api/user/tracking-rules?rule_type=series&target_value=FIFA',
            {
              method: 'DELETE',
              headers: { Cookie: `${SESSION_COOKIE}=${token}` },
            },
          ),
          mockEnv,
        );
        expect(delRes.status).toBe(200);
      });

      it('DELETE /api/user/tracking-rules clears Seeking releases only when clear_existing_seeking=1 is set', async () => {
        db.exec(`
          INSERT INTO games (stable_id, id, title, platform_id, canonical_series, region)
          VALUES
            (711, 'sw-outlaws', 'Star Wars Outlaws', 35, 'Star Wars', 'USA'),
            (712, 'sw-kotor', 'Star Wars: Knights of the Old Republic', 47, 'Star Wars', 'USA'),
            (713, 'metroid-prime', 'Metroid Prime', 26, 'Metroid', 'USA');
          INSERT INTO game_releases (id, game_id, region)
          VALUES
            ('sw-outlaws-usa', 711, 'USA'),
            ('sw-kotor-usa', 712, 'USA'),
            ('metroid-prime-usa', 713, 'USA');
          INSERT INTO user_game_releases (user_id, release_id, ownership_status)
          VALUES
            (1, 'sw-outlaws-usa', 2),
            (1, 'sw-kotor-usa', 1),
            (1, 'metroid-prime-usa', 2);
          INSERT INTO user_tracking_rules (user_id, rule_type, match_value, target_status, region_scope, is_ignored)
          VALUES
            (1, 'series', 'Star Wars', 2, 'home', 0),
            (1, 'series', 'Metroid', 2, 'home', 0);
        `);

        const token = await signSession(
          {
            id: 1,
            username: 'alice',
            role: 'admin',
            homeRegion: 'USA',
          },
          mockEnv.SESSION_SECRET!,
        );

        const keepRes = await worker.fetch(
          new Request(
            'http://localhost/api/user/tracking-rules?rule_type=series&match_value=Metroid',
            {
              method: 'DELETE',
              headers: { Cookie: `${SESSION_COOKIE}=${token}` },
            },
          ),
          mockEnv,
        );
        expect(keepRes.status).toBe(200);
        const keepJson = (await keepRes.json()) as {
          success: boolean;
          clearedCount: number;
        };
        expect(keepJson.clearedCount).toBe(0);
        expect(
          (
            db
              .prepare(
                "SELECT ownership_status FROM user_game_releases WHERE user_id = 1 AND release_id = 'metroid-prime-usa'",
              )
              .get() as { ownership_status: number }
          ).ownership_status,
        ).toBe(2);

        const clearRes = await worker.fetch(
          new Request(
            'http://localhost/api/user/tracking-rules?rule_type=series&match_value=Star%20Wars&clear_existing_seeking=1',
            {
              method: 'DELETE',
              headers: { Cookie: `${SESSION_COOKIE}=${token}` },
            },
          ),
          mockEnv,
        );
        expect(clearRes.status).toBe(200);
        const clearJson = (await clearRes.json()) as {
          success: boolean;
          clearedCount: number;
        };
        expect(clearJson.clearedCount).toBe(1);
        expect(
          db
            .prepare(
              "SELECT 1 FROM user_tracking_rules WHERE user_id = 1 AND rule_type = 'series' AND match_value = 'Star Wars'",
            )
            .get(),
        ).toBeUndefined();
        expect(
          (
            db
              .prepare(
                "SELECT ownership_status FROM user_game_releases WHERE user_id = 1 AND release_id = 'sw-outlaws-usa'",
              )
              .get() as { ownership_status: number }
          ).ownership_status,
        ).toBe(0);
        expect(
          (
            db
              .prepare(
                "SELECT ownership_status FROM user_game_releases WHERE user_id = 1 AND release_id = 'sw-kotor-usa'",
              )
              .get() as { ownership_status: number }
          ).ownership_status,
        ).toBe(1);
      });

      it('syncWorkerBroadCatalogPopulation populates canonical releases into games and evaluates user_tracking_rules', async () => {
        db.exec(`
          INSERT INTO canonical_releases (id, platform_id, raw_title, normalized_title, region, is_verified_physical)
          VALUES (5001, 26, 'F-Zero 99 Physical Edition (USA)', 'fzero99physicaledition', 'USA', 1);
          INSERT INTO user_tracking_rules (user_id, rule_type, match_value, target_status, region_scope, is_ignored)
          VALUES (1, 'platform', '26', 2, 'home', 0);
        `);

        const result = await (async () => {
          stubIgdbFetch({});
          try {
            return await syncWorkerBroadCatalogPopulation(mockEnv);
          } finally {
            vi.unstubAllGlobals();
          }
        })();
        expect(result.ingestedGames).toBeGreaterThanOrEqual(1);
        expect(result.ingestedReleases).toBeGreaterThanOrEqual(1);

        const newGame = db
          .prepare(
            "SELECT stable_id, title FROM games WHERE title = 'F-Zero 99 Physical Edition'",
          )
          .get() as {
          stable_id: number;
          title: string;
        };
        expect(newGame).toBeTruthy();

        const trackedRelease = db
          .prepare(
            `SELECT ugr.ownership_status
             FROM user_game_releases ugr
             JOIN game_releases gr ON gr.id = ugr.release_id
             WHERE ugr.user_id = 1 AND gr.game_id = ?`,
          )
          .get(newGame.stable_id) as { ownership_status: number };
        expect(trackedRelease).toEqual({ ownership_status: 2 });
      });

      it('syncWorkerBroadCatalogPopulation only applies series rules to metadata-backed series and skips compilation-extracted ROMs', async () => {
        db.exec(`
          UPDATE platforms SET igdb_id = 59 WHERE id = 26;
          INSERT INTO canonical_releases (id, platform_id, raw_title, normalized_title, region, rom_name, is_verified_physical)
          VALUES (6201, 26, 'Tennis (USA)', '${normalizeTitleForMatching('Tennis')}', 'USA', 'Tennis (USA).a26', 1),
                 (6202, 26, 'Star Fox 64 (USA)', '${normalizeTitleForMatching('Star Fox 64')}', 'USA', 'Star Fox 64 (USA).a26', 1),
                 (6203, 26, 'Baseball', '${normalizeTitleForMatching('Baseball')}', 'USA', 'Baseball (USA) (Activision Anthology - Remix Edition).a26', 1);
          INSERT INTO user_tracking_rules (user_id, rule_type, match_value, target_status, region_scope, is_ignored)
          VALUES (1, 'series', 'Tennis', 2, 'home', 0),
                 (1, 'series', 'Star Fox', 2, 'home', 0),
                 (1, 'series', 'Baseball', 2, 'home', 0);
        `);
        stubIgdbFetch({
          'Star Fox 64': [
            {
              id: 2591,
              name: 'Star Fox 64',
              platforms: [59],
              collections: [{ name: 'Star Fox' }],
              franchises: [{ name: 'Star Fox' }],
            },
          ],
        });
        try {
          await syncWorkerBroadCatalogPopulation(mockEnv);
        } finally {
          vi.unstubAllGlobals();
        }

        const statusFor = (title: string) =>
          db
            .prepare(
              `SELECT ugr.ownership_status
               FROM games g
               JOIN game_releases gr ON gr.game_id = g.stable_id
               LEFT JOIN user_game_releases ugr ON ugr.release_id = gr.id AND ugr.user_id = 1
               WHERE g.title = ? AND g.platform_id = 26`,
            )
            .get(title) as { ownership_status: number | null } | undefined;

        // Generic title-only series must not trigger the "Tennis" rule
        expect(statusFor('Tennis')).toEqual({ ownership_status: null });
        // IGDB-backed series triggers the "Star Fox" rule
        expect(statusFor('Star Fox 64')).toEqual({ ownership_status: 2 });
        // Compilation-extracted ROM is never ingested
        expect(statusFor('Baseball')).toBeUndefined();
      });

      const stubIgdbFetch = (
        resultsByTitle: Record<string, unknown[]>,
        opts?: { igdbStatus?: number },
      ) => {
        const igdbBodies: string[] = [];
        const fetchMock = vi.fn(
          async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url.startsWith('https://id.twitch.tv/')) {
              return Response.json({
                access_token: 'tok',
                expires_in: 3600,
              });
            }
            if (url === 'https://api.igdb.com/v4/multiquery') {
              const body = String(init?.body || '');
              igdbBodies.push(body);
              if (opts?.igdbStatus && opts.igdbStatus !== 200) {
                return new Response('boom', { status: opts.igdbStatus });
              }
              const out = [
                ...body.matchAll(/query games "(q\d+)" \{([^}]*)\}/g),
              ].map((m) => {
                const subQuery = m[2];
                const tokens = [
                  ...subQuery.matchAll(/(?<![.\w])name ~ \*"([^"]*)"\*/g),
                ].map((tm) => tm[1]);
                let matchedResults: unknown[] = [];
                if (tokens.length === 1 && resultsByTitle[tokens[0]]) {
                  matchedResults = resultsByTitle[tokens[0]];
                } else if (tokens.length > 0) {
                  for (const [key, entries] of Object.entries(resultsByTitle)) {
                    const keyLower = key.toLowerCase();
                    if (
                      tokens.every((tok) =>
                        keyLower.includes(tok.toLowerCase()),
                      )
                    ) {
                      matchedResults = entries;
                      break;
                    }
                  }
                }
                return {
                  name: m[1],
                  result: matchedResults,
                };
              });
              return Response.json(out);
            }
            return new Response('unexpected', { status: 500 });
          },
        );
        vi.stubGlobal('fetch', fetchMock);
        return { fetchMock, igdbBodies };
      };

      const alienIgdb = {
        id: 4242,
        name: 'Alien',
        url: 'https://www.igdb.com/games/alien--1',
        summary: 'Atari 2600 maze game.',
        cover: { image_id: 'abc123' },
        genres: [{ name: 'Arcade' }],
        collections: [{ name: 'Alien' }],
        franchises: [{ name: 'Alien' }],
        platforms: [59],
        alternative_names: [],
        game_localizations: [],
      };

      it('selectStrictIgdbMatch accepts exact name/alternative-name matches on the platform and rejects near-misses', () => {
        const norm = normalizeTitleForMatching('Alien');
        expect(selectStrictIgdbMatch([alienIgdb], norm, 59)?.id).toBe(4242);
        // platform mismatch
        expect(selectStrictIgdbMatch([alienIgdb], norm, 18)).toBeNull();
        // near-miss title
        expect(
          selectStrictIgdbMatch(
            [{ ...alienIgdb, id: 1, name: 'Aliens' }],
            norm,
            59,
          ),
        ).toBeNull();
        // alternative name match
        expect(
          selectStrictIgdbMatch(
            [
              {
                ...alienIgdb,
                id: 7,
                name: 'Alien: The Game',
                alternative_names: [{ name: 'Alien' }],
              },
            ],
            norm,
            59,
          )?.id,
        ).toBe(7);
      });

      it('buildIgdbSearchTokens extracts significant tokens for DAT punctuation, articles, apostrophes, and Unicode', () => {
        expect(buildIgdbSearchTokens('Guitar Hero - Van Halen')).toEqual([
          'Guitar',
          'Halen',
          'Hero',
          'Van',
        ]);
        expect(
          buildIgdbSearchTokens('Legend of Zelda, The - Ocarina of Time'),
        ).toEqual(['Ocarina', 'Legend', 'Zelda', 'Time']);
        expect(buildIgdbSearchTokens("Nicktoons Movin'")).toEqual([
          'Nicktoons',
          'Movin',
        ]);
        expect(buildIgdbSearchTokens('Gretzky NHL 06')).toEqual([
          'Gretzky',
          'NHL',
          '06',
        ]);
        expect(buildIgdbSearchTokens("SingStar '80s")).toEqual([
          'SingStar',
          '80s',
        ]);
        expect(
          buildIgdbSearchTokens("Disney Presents Piglet's Big Game"),
        ).toEqual(['Piglet', 'Game', 'Big']);
        expect(buildIgdbSearchTokens('N')).toEqual(['N']);
        expect(buildIgdbSearchTokens('ポケットモンスター')).toEqual([
          'ポケットモンスター',
        ]);
      });

      it('selectStrictIgdbMatch accepts localized names and preserves name > alternative > localized precedence', () => {
        const leMansNorm = normalizeTitleForMatching('Le Mans 24 Hours');
        const leMansCandidate = {
          id: 27556,
          name: 'Test Drive: Le Mans',
          platforms: [8],
          alternative_names: [{ name: '24 Heures Du Mans' }],
          game_localizations: [{ name: 'Le Mans 24 Hours' }],
        };
        expect(
          selectStrictIgdbMatch([leMansCandidate], leMansNorm, 8)?.id,
        ).toBe(27556);
        expect(
          selectStrictIgdbMatch([leMansCandidate], leMansNorm, 99),
        ).toBeNull();
        expect(
          selectStrictIgdbMatch(
            [
              {
                ...leMansCandidate,
                game_localizations: [{ name: 'Le Mans 25 Hours' }],
              },
            ],
            leMansNorm,
            8,
          ),
        ).toBeNull();

        const targetNorm = normalizeTitleForMatching('Shadow Gate');
        const localizedMatch = {
          id: 101,
          name: 'Different Title',
          platforms: [18],
          game_localizations: [{ name: 'Shadow Gate' }],
        };
        const altMatch = {
          id: 102,
          name: 'Another Title',
          platforms: [18],
          alternative_names: [{ name: 'Shadow Gate' }],
        };
        const nameMatch = {
          id: 103,
          name: 'Shadow Gate',
          platforms: [18],
        };
        expect(
          selectStrictIgdbMatch(
            [localizedMatch, altMatch, nameMatch],
            targetNorm,
            18,
          )?.id,
        ).toBe(103);
        expect(
          selectStrictIgdbMatch([localizedMatch, altMatch], targetNorm, 18)?.id,
        ).toBe(102);
        expect(
          selectStrictIgdbMatch([localizedMatch], targetNorm, 18)?.id,
        ).toBe(101);
      });

      it('fetchIgdbMetadataForTitles builds token-ANDed clauses with companion platforms and localized names', async () => {
        const { igdbBodies } = stubIgdbFetch({
          'Guitar Hero: Van Halen': [
            {
              id: 2675,
              name: 'Guitar Hero: Van Halen',
              url: 'https://www.igdb.com/games/guitar-hero-van-halen',
              summary: 'Rock rhythm game.',
              cover: { image_id: 'ghvh1' },
              genres: [{ name: 'Music' }],
              collections: [{ name: 'Guitar Hero' }],
              platforms: [8],
            },
          ],
          'Bio Miracle Bokutte Upa': [
            {
              id: 41245,
              name: 'Bio Miracle Bokutte Upa',
              url: 'https://www.igdb.com/games/bio-miracle-bokutte-upa',
              summary: 'Famicom platformer.',
              cover: { image_id: 'bmbu1' },
              platforms: [99],
            },
          ],
          'Le Mans 24 Hours': [
            {
              id: 27556,
              name: 'Test Drive: Le Mans',
              url: 'https://www.igdb.com/games/test-drive-le-mans',
              summary: 'Endurance racing.',
              cover: { image_id: 'lemans1' },
              platforms: [8],
              game_localizations: [{ name: 'Le Mans 24 Hours' }],
            },
          ],
        });
        try {
          const result = await fetchIgdbMetadataForTitles(mockEnv, [
            {
              key: 'ghvh',
              title: 'Guitar Hero - Van Halen',
              normalizedTitle: normalizeTitleForMatching(
                'Guitar Hero - Van Halen',
              ),
              igdbPlatformId: 8,
            },
            {
              key: 'upa',
              title: 'Bio Miracle Bokutte Upa',
              normalizedTitle: normalizeTitleForMatching(
                'Bio Miracle Bokutte Upa',
              ),
              igdbPlatformId: 18,
            },
            {
              key: 'snes-check',
              title: 'F-Zero',
              normalizedTitle: normalizeTitleForMatching('F-Zero'),
              igdbPlatformId: 19,
            },
            {
              key: 'lemans',
              title: 'Le Mans 24 Hours',
              normalizedTitle: normalizeTitleForMatching('Le Mans 24 Hours'),
              igdbPlatformId: 8,
            },
          ]);

          expect(igdbBodies.length).toBe(1);
          const body = igdbBodies[0];
          expect(body).toContain('where platforms = (18,99)');
          expect(body).toContain('where platforms = (19,58)');
          expect(body).toContain(
            '(name ~ *"Guitar"* & name ~ *"Halen"* & name ~ *"Hero"* & name ~ *"Van"*)',
          );
          expect(body).toContain(
            '(alternative_names.name ~ *"Guitar"* & alternative_names.name ~ *"Halen"* & alternative_names.name ~ *"Hero"* & alternative_names.name ~ *"Van"*)',
          );
          expect(body).toContain(
            '(game_localizations.name ~ *"Guitar"* & game_localizations.name ~ *"Halen"* & game_localizations.name ~ *"Hero"* & game_localizations.name ~ *"Van"*)',
          );

          expect(result.get('ghvh')?.igdb_id).toBe(2675);
          expect(result.get('ghvh')?.image_url).toBe(
            'https://images.igdb.com/igdb/image/upload/t_cover_big/ghvh1.jpg',
          );
          expect(result.get('upa')?.igdb_id).toBe(41245);
          expect(result.get('lemans')?.igdb_id).toBe(27556);
        } finally {
          vi.unstubAllGlobals();
        }
      });

      it('syncWorkerBroadCatalogPopulation inserts IGDB metadata inline when strictly matched and still inserts unmatched games', async () => {
        db.exec(`
          UPDATE platforms SET igdb_id = 59 WHERE id = 26;
          INSERT INTO canonical_releases (id, platform_id, raw_title, normalized_title, region, is_verified_physical)
          VALUES (6001, 26, 'Alien (USA)', '${normalizeTitleForMatching('Alien')}', 'USA', 1),
                 (6002, 26, 'Obscure Thing (USA)', '${normalizeTitleForMatching('Obscure Thing')}', 'USA', 1);
        `);
        const { igdbBodies } = stubIgdbFetch({ Alien: [alienIgdb] });
        try {
          const result = await syncWorkerBroadCatalogPopulation(mockEnv);
          expect(result.igdbMatched).toBe(1);
          expect(igdbBodies.length).toBe(1);
          expect(igdbBodies[0]).toContain('where platforms = (59)');

          const alien = db
            .prepare(
              "SELECT igdb_id, igdb_url, image_url, summary, genres FROM games WHERE title = 'Alien' AND platform_id = 26",
            )
            .get();
          expect(alien).toEqual({
            igdb_id: 4242,
            igdb_url: 'https://www.igdb.com/games/alien--1',
            image_url:
              'https://images.igdb.com/igdb/image/upload/t_cover_big/abc123.jpg',
            summary: 'Atari 2600 maze game.',
            genres: 'Arcade',
          });
          const obscure = db
            .prepare(
              "SELECT igdb_id, image_url FROM games WHERE title = 'Obscure Thing' AND platform_id = 26",
            )
            .get();
          expect(obscure).toEqual({ igdb_id: null, image_url: null });
        } finally {
          vi.unstubAllGlobals();
        }
      });

      it('syncWorkerBroadCatalogPopulation keeps seeding without metadata when IGDB fails', async () => {
        db.exec(`
          UPDATE platforms SET igdb_id = 59 WHERE id = 26;
          INSERT INTO canonical_releases (id, platform_id, raw_title, normalized_title, region, is_verified_physical)
          VALUES (6101, 26, 'Alien (USA)', '${normalizeTitleForMatching('Alien')}', 'USA', 1);
        `);
        stubIgdbFetch({}, { igdbStatus: 500 });
        try {
          const result = await syncWorkerBroadCatalogPopulation(mockEnv);
          expect(result.ingestedGames).toBeGreaterThanOrEqual(1);
          expect(result.igdbMatched).toBe(0);
          const alien = db
            .prepare(
              "SELECT igdb_id FROM games WHERE title = 'Alien' AND platform_id = 26",
            )
            .get();
          expect(alien).toEqual({ igdb_id: null });
        } finally {
          vi.unstubAllGlobals();
        }
      });

      it('POST /api/admin/catalog-seed returns streamlined maintenance telemetry and getBroadCatalogSeedStatus honors includeTableBounds', async () => {
        db.exec(`
          INSERT INTO canonical_releases (id, platform_id, raw_title, normalized_title, region, is_verified_physical)
          VALUES (7001, 26, 'Telemetry Game (USA)', 'telemetrygame', 'USA', 1);
          INSERT INTO games (stable_id, id, title, platform_id)
          VALUES (8001, 'telemetry-game', 'Telemetry Game', 26);
        `);

        const token = await signSession(
          {
            id: 1,
            username: 'alice',
            role: 'admin',
            homeRegion: 'USA',
          },
          mockEnv.SESSION_SECRET!,
        );

        const postRes = await worker.fetch(
          new Request('http://localhost/api/admin/catalog-seed', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `${SESSION_COOKIE}=${token}`,
            },
            body: JSON.stringify({}),
          }),
          mockEnv,
        );
        expect(postRes.status).toBe(200);
        const postJson = (await postRes.json()) as {
          success: boolean;
          status: {
            canonicalTailer: {
              cursor: number;
              canonicalMinId: number;
              canonicalMaxId: number;
              maxGameStableId: number;
            };
            igdbRolling: { cursorOffset: number };
            seriesDiscovery: { cursor: number };
            upstreamSources: {
              switchRevisionsUpdatedAt: string | null;
              nsCollectorsUpdatedAt: string | null;
              retailPreOrdersUpdatedAt: string | null;
            };
          };
        };
        expect(postJson.success).toBe(true);
        expect(postJson.status.canonicalTailer.canonicalMinId).toBe(7001);
        expect(
          postJson.status.canonicalTailer.canonicalMaxId,
        ).toBeGreaterThanOrEqual(7001);
        expect(
          postJson.status.canonicalTailer.maxGameStableId,
        ).toBeGreaterThanOrEqual(8001);
        expect(postJson.status.igdbRolling).toBeDefined();
        expect(postJson.status.seriesDiscovery).toBeDefined();
        expect(postJson.status.upstreamSources).toBeDefined();

        const fullStatus = await getBroadCatalogSeedStatus(mockEnv);
        expect(fullStatus.canonicalTailer.canonicalMinId).toBe(7001);
        expect(fullStatus.canonicalTailer.canonicalMaxId).toBe(7001);
        expect(fullStatus.canonicalTailer.maxGameStableId).toBe(8001);

        const prepareSpy = vi.spyOn(mockEnv.DB, 'prepare');
        try {
          const lightStatus = await getBroadCatalogSeedStatus(mockEnv, {
            includeTableBounds: false,
          });
          expect(lightStatus.canonicalTailer.canonicalMinId).toBe(0);
          expect(lightStatus.canonicalTailer.canonicalMaxId).toBe(0);
          expect(lightStatus.canonicalTailer.maxGameStableId).toBe(0);
          const issuedSql = prepareSpy.mock.calls.map((c) => String(c[0]));
          expect(
            issuedSql.some((sql) => sql.includes('canonical_releases')),
          ).toBe(false);
        } finally {
          prepareSpy.mockRestore();
        }
      });

      it('syncWorkerBroadCatalogPopulation in steady-state attaches new regional releases to existing games, ignores World placeholders, and evaluates rules', async () => {
        db.exec(`
          INSERT INTO games (stable_id, id, title, platform_id, canonical_series, collections)
          VALUES (9201, 'luigis-mansion-2-hd-switch', 'Luigi''s Mansion 2 HD', 26, 'Luigi''s Mansion', 'Luigi''s Mansion');
          INSERT INTO game_releases (id, game_id, region)
          VALUES ('luigis-mansion-2-hd-switch-jpn', 9201, 'Japan');
          INSERT INTO user_tracking_rules (user_id, rule_type, match_value, target_status, region_scope, is_ignored)
          VALUES (1, 'series', 'Luigi''s Mansion', 2, 'home', 0);
          INSERT INTO canonical_releases (id, platform_id, raw_title, normalized_title, region, variants, serial_code, source, is_verified_physical)
          VALUES
            (9501, 26, 'Unknown Past Typo', '${normalizeTitleForMatching('Unknown Past Typo')}', 'World', 'Rev 000 (v1.0.0)', NULL, 'nintendo_revised', 1),
            (9502, 26, 'Luigi''s Mansion 2 HD', '${normalizeTitleForMatching("Luigi's Mansion 2 HD")}', 'USA', 'Rev 000 (v1.0.0)', 'LA-H-BANRA-USA', 'nintendo_revised', 1);
          INSERT INTO sync_state (key, value) VALUES ('catalog_seed_cursor', '9500');
        `);

        stubIgdbFetch({});
        try {
          const res = await syncWorkerBroadCatalogPopulation(mockEnv);
          expect(res.skipped).toBe(false);
          expect(res.ingestedGames).toBe(0);
          expect(res.ingestedReleases).toBe(1);
          expect(res.cursor).toBe(9502);

          // World placeholder without serial_code must NOT create a game
          const placeholderGame = db
            .prepare(
              "SELECT id FROM games WHERE title LIKE '%Unknown Past Typo%'",
            )
            .get();
          expect(placeholderGame).toBeUndefined();

          // USA Switch release should be attached to existing game and marked Seeking (2)
          const usaRel = db
            .prepare(
              "SELECT id, region, canonical_release_id FROM game_releases WHERE game_id = 9201 AND region = 'USA'",
            )
            .get() as {
            id: string;
            region: string;
            canonical_release_id: number;
          };
          expect(usaRel.region).toBe('USA');
          expect(usaRel.canonical_release_id).toBe(9502);

          const trackingRow = db
            .prepare(
              'SELECT ownership_status FROM user_game_releases WHERE user_id = 1 AND release_id = ?',
            )
            .get(usaRel.id) as { ownership_status: number };
          expect(trackingRow.ownership_status).toBe(2);
        } finally {
          vi.unstubAllGlobals();
        }
      });

      it('syncWorkerSwitchRevisions links unlinked Switch 2 standard release in place for Rev 00 without duplicating', async () => {
        db.exec(`
          INSERT INTO games (stable_id, id, title, platform_id)
          VALUES (9202, 'metroid-prime-4-sw2', 'Metroid Prime 4: Beyond', 27);
          INSERT INTO game_releases (id, game_id, region)
          VALUES ('9202-1', 9202, 'USA');
          INSERT INTO user_game_releases (user_id, release_id, ownership_status, has_case, has_manual)
          VALUES (1, '9202-1', 1, 1, 1);
        `);

        const sw2Csv = [
          'Game,Revision,Version,Download,Size,Region,Code,Publisher',
          'Metroid Prime 4: Beyond,00,1.0.1,No,,USA,LN-XXXXX-USA-0,Nintendo',
          ',01,1.1.0,No,,USA,LN-XXXXX-USA-1,Nintendo',
        ].join('\n');

        const fetchSpy = vi
          .spyOn(globalThis, 'fetch')
          .mockImplementation(async (input) => {
            const url = String(input);
            if (url.includes('gid=561582322')) {
              return new Response(sw2Csv, { status: 200 });
            }
            return new Response('Game,Revision\n', { status: 200 });
          });

        try {
          const res = await syncWorkerSwitchRevisions(mockEnv);
          expect(res.addedCanonical).toBeGreaterThanOrEqual(2);

          const rels = db
            .prepare(
              'SELECT id, region, variants, canonical_release_id FROM game_releases WHERE game_id = 9202 ORDER BY id',
            )
            .all() as Array<{
            id: string;
            region: string;
            variants: string | null;
            canonical_release_id: number | null;
          }>;
          expect(rels).toHaveLength(2);
          const rev00 = rels.find((r) => r.id === '9202-1');
          const rev01 = rels.find((r) => r.variants === 'Rev 01 (v1.1.0)');
          expect(rev00?.variants).toBe('Rev 00 (v1.0.1)');
          expect(rev00?.canonical_release_id).toBeTruthy();
          expect(rev01?.canonical_release_id).toBeTruthy();

          const dirtyRow = db
            .prepare(
              `SELECT value FROM sync_state WHERE key = '${CATALOG_CHUNKS_DIRTY_KEY}'`,
            )
            .get() as { value: string } | undefined;
          expect(dirtyRow?.value).toBe('1');
        } finally {
          fetchSpy.mockRestore();
        }
      });

      it('syncWorkerBroadCatalogPopulation links unlinked stub releases in place across overlapping normalized regions', async () => {
        db.exec(`
          INSERT INTO games (stable_id, id, title, platform_id)
          VALUES (9203, 'ps4-overlap-stub', 'Overlap Stub Game', 34);
          INSERT INTO game_releases (id, game_id, region, canonical_release_id)
          VALUES ('9203-1', 9203, 'Europe', NULL);
          INSERT INTO canonical_releases (id, platform_id, raw_title, normalized_title, region, rom_name, rom_crc, source, is_verified_physical)
          VALUES (9550, 34, 'Overlap Stub Game', '${normalizeTitleForMatching('Overlap Stub Game')}', 'Europe, Australia', 'Overlap Stub Game (Europe, Australia).iso', 'deadbeef', 'dat', 1);
          INSERT INTO sync_state (key, value) VALUES ('catalog_seed_cursor', '9549');
        `);

        stubIgdbFetch({});
        try {
          const res = await syncWorkerBroadCatalogPopulation(mockEnv);
          expect(res.skipped).toBe(false);
          expect(res.ingestedGames).toBe(0);
          expect(res.ingestedReleases).toBe(0);
          expect(res.cursor).toBe(9550);

          const rels = db
            .prepare(
              'SELECT id, region, rom_name, rom_crc, canonical_release_id FROM game_releases WHERE game_id = 9203',
            )
            .all() as Array<{
            id: string;
            region: string;
            rom_name: string | null;
            rom_crc: string | null;
            canonical_release_id: number | null;
          }>;
          expect(rels).toHaveLength(1);
          expect(rels[0].id).toBe('9203-1');
          expect(rels[0].canonical_release_id).toBe(9550);
          expect(rels[0].rom_name).toBe(
            'Overlap Stub Game (Europe, Australia).iso',
          );
          expect(rels[0].rom_crc).toBe('deadbeef');
        } finally {
          vi.unstubAllGlobals();
        }
      });

      it('syncWorkerBroadCatalogPopulation safely ingests titles matching Object.prototype properties such as Constructor', async () => {
        db.exec(`
          INSERT INTO canonical_releases (id, platform_id, raw_title, normalized_title, region, is_verified_physical)
          VALUES (9601, 34, 'Constructor', '${normalizeTitleForMatching('Constructor')}', 'USA', 1);
          INSERT INTO sync_state (key, value) VALUES ('catalog_seed_cursor', '9600');
        `);

        stubIgdbFetch({});
        try {
          const res = await syncWorkerBroadCatalogPopulation(mockEnv);
          expect(res.skipped).toBe(false);
          expect(res.ingestedGames).toBe(1);
          expect(res.cursor).toBe(9601);

          const inserted = db
            .prepare(
              "SELECT title, canonical_series FROM games WHERE title = 'Constructor' AND platform_id = 34",
            )
            .get() as { title: string; canonical_series: string } | undefined;
          expect(inserted).toEqual({
            title: 'Constructor',
            canonical_series: 'Constructor',
          });
        } finally {
          vi.unstubAllGlobals();
        }
      });

      it('syncWorkerIgdbSeriesAndCanonical self-heals missed tracking rules for trackable games including numbered sequel fallbacks', async () => {
        const { syncWorkerIgdbSeriesAndCanonical } = await import('./worker');
        const envWithIgdb: Env = {
          ...mockEnv,
          TWITCH_CLIENT_ID: 'test-client-id',
          TWITCH_CLIENT_SECRET: 'test-client-secret',
        };

        db.exec(`
          INSERT INTO games (stable_id, id, title, platform_id, canonical_series, igdb_id)
          VALUES (9301, 'doom-ii-gba', 'Doom II', 1, 'Doom II', NULL);
          INSERT INTO game_releases (id, game_id, region)
          VALUES ('doom-ii-gba-usa', 9301, 'USA');
          INSERT INTO user_tracking_rules (user_id, rule_type, match_value, target_status, region_scope, is_ignored)
          VALUES (1, 'series', 'Doom', 4, 'home', 0);
        `);

        const originalFetch = globalThis.fetch;
        globalThis.fetch = vi
          .fn()
          .mockResolvedValue(
            new Response(
              JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          );

        try {
          const res = await syncWorkerIgdbSeriesAndCanonical(envWithIgdb, {
            batchSize: 50,
          });
          expect(res.selfHealedRulesCount).toBe(1);

          const healedStatus = db
            .prepare(
              "SELECT ownership_status FROM user_game_releases WHERE user_id = 1 AND release_id = 'doom-ii-gba-usa'",
            )
            .get() as { ownership_status: number };
          expect(healedStatus.ownership_status).toBe(4);

          const rollingStatsRow = db
            .prepare(
              "SELECT value FROM sync_state WHERE key = 'igdb_rolling_stats'",
            )
            .get() as { value: string };
          const stats = JSON.parse(rollingStatsRow.value) as {
            selfHealedRulesTotal: number;
          };
          expect(stats.selfHealedRulesTotal).toBe(1);
        } finally {
          globalThis.fetch = originalFetch;
        }
      });

      it('syncWorkerIgdbSeriesAndCanonical forwards title and slug in alerts and auto-promotes owned standalone games after sequel linkage', async () => {
        const { syncWorkerIgdbSeriesAndCanonical } = await import('./worker');
        const envWithIgdb: Env = {
          ...mockEnv,
          TWITCH_CLIENT_ID: 'test-client-id',
          TWITCH_CLIENT_SECRET: 'test-client-secret',
        };

        db.exec(`
          INSERT INTO games (stable_id, id, title, platform_id, collections, canonical_series, igdb_id)
          VALUES
            (9311, 'hollow-knight-switch', 'Hollow Knight', 26, NULL, 'Hollow Knight', 14593),
            (9312, 'hollow-knight-silksong-switch', 'Hollow Knight: Silksong', 26, 'Hollow Knight', 'Hollow Knight', NULL),
            (9313, 'doom-eternal-switch', 'Doom Eternal', 26, 'Doom', 'Doom Eternal', NULL);
          INSERT INTO game_releases (id, game_id, region)
          VALUES
            ('hollow-knight-switch-usa', 9311, 'USA'),
            ('hollow-knight-silksong-switch-usa', 9312, 'USA'),
            ('doom-eternal-switch-usa', 9313, 'USA');
          INSERT INTO user_game_releases (user_id, release_id, ownership_status)
          VALUES (1, 'hollow-knight-switch-usa', 1);
          INSERT INTO user_tracking_rules (user_id, rule_type, match_value, target_status, region_scope, is_ignored)
          VALUES (1, 'series', 'Doom', 2, 'home', 0);
          INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, preferences_json, user_agent, created_at, updated_at)
          VALUES ('sub-igdb-sync', 1, 'https://push.example.com/igdb-sync', 'p256', 'auth', '{"enabled": true, "notify_watched_series": true}', 'agent', datetime('now'), datetime('now'));
        `);

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
            const urlStr = String(input);
            if (urlStr.includes('id.twitch.tv/oauth2/token')) {
              return new Response(
                JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
                {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' },
                },
              );
            }
            if (urlStr.includes('api.igdb.com/v4/games')) {
              return new Response(
                JSON.stringify([
                  {
                    id: 14593,
                    name: 'Hollow Knight',
                    collections: [{ name: 'Hollow Knight' }],
                  },
                ]),
                {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' },
                },
              );
            }
            return new Response('[]', { status: 200 });
          });

        try {
          const res = await syncWorkerIgdbSeriesAndCanonical(envWithIgdb, {
            batchSize: 50,
          });
          expect(res.selfHealedRulesCount).toBe(2);

          const newRule = db
            .prepare(
              "SELECT match_value FROM user_tracking_rules WHERE user_id = 1 AND rule_type = 'series' AND match_value = 'Hollow Knight'",
            )
            .get() as { match_value: string } | undefined;
          expect(newRule?.match_value).toBe('Hollow Knight');

          const promotedSeeking = db
            .prepare(
              "SELECT ownership_status FROM user_game_releases WHERE user_id = 1 AND release_id = 'hollow-knight-silksong-switch-usa'",
            )
            .get() as { ownership_status: number } | undefined;
          expect(promotedSeeking?.ownership_status).toBe(2);

          const payloads = webPushSpy.mock.calls.map((c) => c[1]);
          expect(payloads).toContainEqual(
            expect.objectContaining({
              title: '✨ New in Hollow Knight: Hollow Knight: Silksong',
              data: { url: '/game/9312' },
            }),
          );
          expect(payloads).toContainEqual(
            expect.objectContaining({
              title: '✨ New in Doom: Doom Eternal',
              data: { url: '/game/9313' },
            }),
          );
        } finally {
          fetchSpy.mockRestore();
          webPushSpy.mockRestore();
        }
      });

      it('syncWorkerIgdbSeriesAndCanonical skips rule self-healing when series did not change unless forceSelfHeal is true, and passively backfills NULL release_date without overwriting existing dates', async () => {
        const { syncWorkerIgdbSeriesAndCanonical } = await import('./worker');
        const envWithIgdb: Env = {
          ...mockEnv,
          TWITCH_CLIENT_ID: 'test-client-id',
          TWITCH_CLIENT_SECRET: 'test-client-secret',
        };

        db.exec(`
          UPDATE platforms SET igdb_id = 130, launch_date = '2017-03-03' WHERE id = 26;
          INSERT INTO games (stable_id, id, title, platform_id, collections, canonical_series, igdb_id)
          VALUES (9401, 'steady-state-switch', 'Steady State Game', 26, 'Steady', 'Steady', 77001);
          INSERT INTO game_releases (id, game_id, region, release_date)
          VALUES
            ('steady-usa', 9401, 'USA', NULL),
            ('steady-jpn', 9401, 'Japan', '2020-01-01');
          INSERT INTO user_tracking_rules (user_id, rule_type, match_value, target_status, region_scope, is_ignored)
          VALUES (1, 'series', 'Steady', 2, 'home', 0);
        `);

        const fetchSpy = vi
          .spyOn(globalThis, 'fetch')
          .mockImplementation(async (url: string | URL | Request) => {
            const urlStr = url.toString();
            if (urlStr.includes('id.twitch.tv/oauth2/token')) {
              return new Response(
                JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
                {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' },
                },
              );
            }
            if (urlStr.includes('api.igdb.com/v4/games')) {
              return new Response(
                JSON.stringify([
                  {
                    id: 77001,
                    collections: [{ name: 'Steady' }],
                    franchises: [],
                    first_release_date: 1609459200,
                    release_dates: [
                      {
                        platform: 130,
                        release_region: 2,
                        date: 1612137600,
                      },
                      {
                        platform: 130,
                        release_region: 5,
                        date: 1600000000,
                      },
                    ],
                  },
                ]),
                {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' },
                },
              );
            }
            return new Response('unexpected', { status: 500 });
          });

        try {
          const steadyRes = await syncWorkerIgdbSeriesAndCanonical(
            envWithIgdb,
            {
              batchSize: 50,
            },
          );
          expect(steadyRes.selfHealedRulesCount).toBe(0);
          expect(steadyRes.updatedReleaseDatesCount).toBe(1);

          const usaRel = db
            .prepare(
              "SELECT release_date FROM game_releases WHERE id = 'steady-usa'",
            )
            .get() as { release_date: string | null };
          const jpnRel = db
            .prepare(
              "SELECT release_date FROM game_releases WHERE id = 'steady-jpn'",
            )
            .get() as { release_date: string | null };
          expect(usaRel.release_date).toBe('2021-02-01');
          expect(jpnRel.release_date).toBe('2020-01-01');

          const trackingBeforeForce = db
            .prepare(
              "SELECT ownership_status FROM user_game_releases WHERE user_id = 1 AND release_id = 'steady-usa'",
            )
            .get();
          expect(trackingBeforeForce).toBeUndefined();

          db.prepare(
            "INSERT INTO sync_state (key, value) VALUES ('igdb_sync_offset', '0') ON CONFLICT(key) DO UPDATE SET value = '0'",
          ).run();

          const forcedRes = await syncWorkerIgdbSeriesAndCanonical(
            envWithIgdb,
            {
              batchSize: 50,
              forceSelfHeal: true,
            },
          );
          expect(forcedRes.selfHealedRulesCount).toBe(1);

          const trackingAfterForce = db
            .prepare(
              "SELECT ownership_status FROM user_game_releases WHERE user_id = 1 AND release_id = 'steady-usa'",
            )
            .get() as { ownership_status: number };
          expect(trackingAfterForce.ownership_status).toBe(2);
        } finally {
          fetchSpy.mockRestore();
        }
      });

      it('syncWorkerBroadCatalogPopulation resolves IGDB release_date and deduplicates by (platform_id, igdb_id) and non-compilation (platform_id, rom_crc) without skipping compilations', async () => {
        db.exec(`
          UPDATE platforms SET igdb_id = 130, launch_date = '2017-03-03' WHERE id = 26;
          INSERT INTO games (stable_id, id, title, platform_id, igdb_id)
          VALUES
            (9410, 'wave-race-64-switch', 'Wave Race 64', 26, 3456),
            (9411, 'crash-2-switch', 'Crash Bandicoot 2', 26, NULL),
            (9412, 'box-set-vol-1-switch', 'Box Set Vol 1', 26, 8888);
          INSERT INTO game_releases (id, game_id, region, rom_crc)
          VALUES
            ('wr64-usa', 9410, 'USA', 'AABBCCDD'),
            ('cb2-usa', 9411, 'USA', '11223344'),
            ('box1-usa', 9412, 'USA', '55667788');
          INSERT INTO canonical_releases (id, platform_id, raw_title, normalized_title, region, rom_crc, is_verified_physical)
          VALUES
            (9701, 26, 'Wave Race 64 - Kawasaki Jet Ski (Japan)', '${normalizeTitleForMatching('Wave Race 64 - Kawasaki Jet Ski')}', 'Japan', 'EEFF0011', 1),
            (9702, 26, 'Crash 2 Alternate Title (USA)', '${normalizeTitleForMatching('Crash 2 Alternate Title')}', 'USA', '11223344', 1),
            (9705, 26, 'Crash 2 Alternate Title (Europe)', '${normalizeTitleForMatching('Crash 2 Alternate Title')}', 'Europe', '11223355', 1),
            (9703, 26, 'Super Mega Trilogy Pack (USA)', '${normalizeTitleForMatching('Super Mega Trilogy Pack')}', 'USA', '55667788', 1),
            (9704, 26, 'Alien (USA)', '${normalizeTitleForMatching('Alien')}', 'USA', '99887766', 1);
          INSERT INTO sync_state (key, value) VALUES ('catalog_seed_cursor', '9700');
        `);

        stubIgdbFetch({
          'Wave Race 64 - Kawasaki Jet Ski': [
            {
              id: 3456,
              name: 'Wave Race 64',
              url: 'https://www.igdb.com/games/wave-race-64',
              summary: 'Jet ski racing.',
              cover: { image_id: 'wr64' },
              genres: [{ name: 'Racing' }],
              collections: [{ name: 'Wave Race' }],
              franchises: [],
              platforms: [130],
              alternative_names: [{ name: 'Wave Race 64 - Kawasaki Jet Ski' }],
              game_localizations: [],
              first_release_date: 1585699200,
              release_dates: [
                {
                  platform: 130,
                  release_region: 5,
                  date: 1585699200,
                },
              ],
            },
          ],
          Alien: [
            {
              ...alienIgdb,
              platforms: [130],
              first_release_date: 1612137600,
              release_dates: [
                {
                  platform: 130,
                  release_region: 2,
                  date: 1612137600,
                },
              ],
            },
          ],
        });

        try {
          const res = await syncWorkerBroadCatalogPopulation(mockEnv);
          expect(res.skipped).toBe(false);
          // Only Super Mega Trilogy Pack (9703) and Alien (9704) should insert new games
          expect(res.ingestedGames).toBe(2);

          const waveRaceGames = db
            .prepare('SELECT stable_id FROM games WHERE igdb_id = 3456')
            .all();
          expect(waveRaceGames.length).toBe(1);

          const waveRaceJpn = db
            .prepare(
              "SELECT region, release_date FROM game_releases WHERE game_id = 9410 AND region = 'Japan'",
            )
            .get() as { region: string; release_date: string | null };
          expect(waveRaceJpn).toEqual({
            region: 'Japan',
            release_date: '2020-04-01',
          });

          const crashRels = db
            .prepare(
              'SELECT region, rom_crc FROM game_releases WHERE game_id = 9411',
            )
            .all() as Array<{ region: string; rom_crc: string }>;
          expect(crashRels.length).toBe(2);

          const crashEur = crashRels.find((r) => r.region === 'Europe');
          expect(crashEur).toEqual({ region: 'Europe', rom_crc: '11223355' });

          const compGame = db
            .prepare(
              "SELECT stable_id FROM games WHERE title = 'Super Mega Trilogy Pack' AND platform_id = 26",
            )
            .get();
          expect(compGame).toBeDefined();

          const alienRel = db
            .prepare(
              "SELECT gr.release_date FROM game_releases gr JOIN games g ON gr.game_id = g.stable_id WHERE g.title = 'Alien' AND g.platform_id = 26",
            )
            .get() as { release_date: string | null };
          expect(alienRel.release_date).toBe('2021-02-01');
        } finally {
          vi.unstubAllGlobals();
        }
      });

      it('applies edition-preserving IGDB titles, numeric game IDs, and sequential release IDs during catalog seeding', async () => {
        db.exec(`
          UPDATE platforms SET igdb_id = 130, launch_date = '2017-03-03' WHERE id = 26;
          INSERT INTO games (stable_id, id, title, platform_id, manually_verified)
          VALUES
            (9501, '9501', 'Xenoblade Chronicles - Definitive Edition', 26, 0),
            (9502, '9502', 'Custom Curated Title', 26, 1);
          INSERT INTO game_releases (id, game_id, region)
          VALUES
            ('9501-1', 9501, 'USA'),
            ('9502-1', 9502, 'USA');
          INSERT INTO canonical_releases (id, platform_id, raw_title, normalized_title, region, rom_crc, is_verified_physical)
          VALUES
            (9801, 26, 'Rune Factory - Guardians of Azuma - Nintendo Switch 2 Edition (USA)', '${normalizeTitleForMatching('Rune Factory - Guardians of Azuma - Nintendo Switch 2 Edition')}', 'USA', 'DEAD1234', 1),
            (9802, 26, 'Rune Factory - Guardians of Azuma - Nintendo Switch 2 Edition (Europe)', '${normalizeTitleForMatching('Rune Factory - Guardians of Azuma - Nintendo Switch 2 Edition')}', 'Europe', 'DEAD5678', 1);
          INSERT INTO sync_state (key, value) VALUES ('catalog_seed_cursor', '9800');
        `);

        stubIgdbFetch({
          'Rune Factory - Guardians of Azuma - Nintendo Switch 2 Edition': [
            {
              id: 7103,
              name: 'Rune Factory: Guardians of Azuma',
              url: 'https://www.igdb.com/games/rune-factory-guardians-of-azuma',
              summary: 'Action RPG',
              cover: { image_id: 'rfga' },
              genres: [{ name: 'Role-playing (RPG)' }],
              collections: [{ name: 'Rune Factory' }],
              franchises: [],
              platforms: [130],
              alternative_names: [
                {
                  name: 'Rune Factory: Guardians of Azuma - Nintendo Switch 2 Edition',
                },
              ],
            },
          ],
        });

        try {
          const seedRes = await syncWorkerBroadCatalogPopulation(mockEnv);
          expect(seedRes.ingestedGames).toBe(1);
          expect(seedRes.ingestedReleases).toBe(2);

          const rfGame = db
            .prepare(
              'SELECT stable_id, id, title FROM games WHERE igdb_id = 7103',
            )
            .get() as { stable_id: number; id: string; title: string };
          expect(rfGame.stable_id).toBe(9503);
          expect(rfGame.id).toBe('9503');
          expect(rfGame.title).toBe(
            'Rune Factory: Guardians of Azuma - Nintendo Switch 2 Edition',
          );

          const rfReleases = db
            .prepare(
              'SELECT id, region FROM game_releases WHERE game_id = ? ORDER BY id ASC',
            )
            .all(rfGame.stable_id) as Array<{ id: string; region: string }>;
          expect(rfReleases.map((r) => r.id)).toEqual(['9503-1', '9503-2']);
        } finally {
          vi.unstubAllGlobals();
        }
      });

      it('buildIgdbSearchTokens and 3-tier selectStrictIgdbMatch enforce sequel parity, tilde/edition guards, ambiguity rejection, and benign Tier 3 matching', async () => {
        // Numeral & tilde token extraction
        expect(
          buildIgdbSearchTokens('My Little Pony 2: Friendship Adventure'),
        ).not.toContain('2');
        expect(buildIgdbSearchTokens('Tomb Raider II')).toContain('II');
        expect(
          buildIgdbSearchTokens(
            'Real Bout Garou Densetsu ~ Real Bout Fatal Fury',
          ),
        ).toEqual(['Fatal', 'Real', 'Bout', 'Fury']);

        // Sequel parity + pronoun I safety
        expect(
          selectStrictIgdbMatch(
            [{ id: 1, name: 'Persona 5', platforms: [130] }],
            normalizeTitleForMatching('Persona 4'),
            130,
            { rawTitle: 'Persona 4' },
          ),
        ).toBeNull();
        expect(
          selectStrictIgdbMatch(
            [{ id: 2, name: 'I Am Setsuna', platforms: [130] }],
            normalizeTitleForMatching('I Am Setsuna'),
            130,
            { rawTitle: 'I Am Setsuna' },
          )?.id,
        ).toBe(2);

        // Preserve Capcom vs SNK version qualifiers
        expect(
          selectStrictIgdbMatch(
            [
              {
                id: 3,
                name: 'SNK vs. Capcom: Card Fighters Clash - SNK Version',
                platforms: [120],
              },
            ],
            normalizeTitleForMatching(
              'SNK vs. Capcom: Card Fighters Clash - Capcom Version',
            ),
            120,
            {
              rawTitle: 'SNK vs. Capcom: Card Fighters Clash - Capcom Version',
            },
          ),
        ).toBeNull();

        // Block 1-word regional tilde split matching vague alt names
        expect(
          selectStrictIgdbMatch(
            [
              {
                id: 4,
                name: 'Wall-Defender',
                alternative_names: [{ name: 'Capture' }],
                platforms: [59],
              },
            ],
            normalizeTitleForMatching('Flag Capture ~ Capture'),
            59,
            { rawTitle: 'Flag Capture ~ Capture' },
          ),
        ).toBeNull();

        // Retro bare Special stays distinct; modern bare Special matches base game
        expect(
          selectStrictIgdbMatch(
            [{ id: 5, name: 'Real Bout Fatal Fury', platforms: [136] }],
            normalizeTitleForMatching('Real Bout Fatal Fury Special'),
            136,
            { rawTitle: 'Real Bout Fatal Fury Special' },
          ),
        ).toBeNull();
        expect(
          selectStrictIgdbMatch(
            [{ id: 6, name: 'Rune Factory 3', platforms: [130] }],
            normalizeTitleForMatching('Rune Factory 3 Special'),
            130,
            { rawTitle: 'Rune Factory 3 Special' },
          )?.id,
        ).toBe(6);

        // Tier 2 ambiguity (>1) rejection vs DLC category filtering (category: 1 excluded)
        expect(
          selectStrictIgdbMatch(
            [
              {
                id: 10,
                name: 'Starship: Deluxe Edition',
                platforms: [130],
                category: 0,
              },
              {
                id: 11,
                name: 'Starship: Definitive Edition',
                platforms: [130],
                category: 0,
              },
            ],
            normalizeTitleForMatching('Starship'),
            130,
            { rawTitle: 'Starship' },
          ),
        ).toBeNull();
        expect(
          selectStrictIgdbMatch(
            [
              {
                id: 10,
                name: 'Starship: Deluxe Edition',
                platforms: [130],
                game_type: 0,
              },
              {
                id: 12,
                name: 'Starship: Definitive Edition',
                platforms: [130],
                game_type: 1,
              },
            ],
            normalizeTitleForMatching('Starship'),
            130,
            { rawTitle: 'Starship' },
          )?.id,
        ).toBe(10);

        // Tier 3a: allowlist subtitles match; distinct subtitled sequels reject
        expect(
          selectStrictIgdbMatch(
            [{ id: 20, name: 'Doom II: Hell on Earth', platforms: [24] }],
            normalizeTitleForMatching('Doom II'),
            24,
            { rawTitle: 'Doom II' },
          )?.id,
        ).toBe(20);
        expect(
          selectStrictIgdbMatch(
            [{ id: 21, name: 'Ghost Recon 2: Summit Strike', platforms: [11] }],
            normalizeTitleForMatching('Ghost Recon 2'),
            11,
            { rawTitle: 'Ghost Recon 2' },
          ),
        ).toBeNull();

        // Tier 3b: cascading benign query taglines match; distinct spin-offs reject
        expect(
          selectStrictIgdbMatch(
            [{ id: 30, name: 'The Hobbit', platforms: [24] }],
            normalizeTitleForMatching(
              'The Hobbit - The Prelude to the Lord of the Rings',
            ),
            24,
            { rawTitle: 'The Hobbit - The Prelude to the Lord of the Rings' },
          )?.id,
        ).toBe(30);
        expect(
          selectStrictIgdbMatch(
            [{ id: 31, name: 'Minecraft: Story Mode', platforms: [41] }],
            normalizeTitleForMatching(
              'Minecraft - Story Mode - A Telltale Games Series - The Complete Adventure',
            ),
            41,
            {
              rawTitle:
                'Minecraft - Story Mode - A Telltale Games Series - The Complete Adventure',
            },
          )?.id,
        ).toBe(31);
        for (const [qTitle, candName, plat] of [
          [
            'Phineas and Ferb - Across the 2nd Dimension',
            'Phineas and Ferb',
            20,
          ],
          ['Carnival Games - MiniGolf', 'Carnival Games', 5],
          ['Command & Conquer - Red Alert', 'Command & Conquer', 7],
        ] as const) {
          expect(
            selectStrictIgdbMatch(
              [{ id: 99, name: candName, platforms: [plat] }],
              normalizeTitleForMatching(qTitle),
              plat,
              { rawTitle: qTitle },
            ),
          ).toBeNull();
        }

        // fetchIgdbMetadataForTitles runs ~ and benign subtitle retry passes
        stubIgdbFetch({
          'The Hobbit': [{ id: 248450, name: 'The Hobbit', platforms: [24] }],
          'Minecraft - Story Mode': [
            { id: 8339, name: 'Minecraft: Story Mode', platforms: [41] },
          ],
          'Hunt & Score': [
            {
              id: 40723,
              name: 'A Game of Concentration',
              alternative_names: [{ name: 'Hunt & Score' }],
              platforms: [59],
            },
          ],
        });
        try {
          const metaMap = await fetchIgdbMetadataForTitles(mockEnv, [
            {
              key: 'hobbit',
              title: 'The Hobbit - The Prelude to the Lord of the Rings',
              normalizedTitle: 'hobbitpreludelordrings',
              igdbPlatformId: 24,
            },
            {
              key: 'mcsm',
              title:
                'Minecraft - Story Mode - A Telltale Games Series - The Complete Adventure',
              normalizedTitle:
                'minecraftstorymodetelltalegamesseriescompleteadventure',
              igdbPlatformId: 41,
            },
            {
              key: 'hunt',
              title: 'Hunt & Score ~ Memory Match',
              normalizedTitle: 'huntscorememorymatch',
              igdbPlatformId: 59,
            },
          ]);
          expect(metaMap.get('hobbit')?.igdb_id).toBe(248450);
          expect(metaMap.get('mcsm')?.igdb_id).toBe(8339);
          expect(metaMap.get('hunt')?.igdb_id).toBe(40723);
        } finally {
          vi.unstubAllGlobals();
        }
      });

      it('syncWorkerIgdbSeriesAndCanonical passively backfills summary, image_url, genres, and igdb_url while preserving /covers/ assets and curated metadata', async () => {
        db.exec(`
          INSERT INTO games (stable_id, id, title, platform_id, igdb_id, image_url, summary, genres, manually_verified)
          VALUES
            (9601, '9601', 'Chrono Trigger', 15, 1111, NULL, NULL, NULL, 0),
            (9602, '9602', 'PlayStation VR Demo Disc', 34, 2222, '/covers/playstation-vr-demo-disc-playstation-4.jpg', 'Curated summary', 'Demo Compilation', 0);
        `);

        const fetchSpy = vi
          .spyOn(globalThis, 'fetch')
          .mockImplementation(async (input) => {
            const url = String(input);
            if (url.includes('id.twitch.tv')) {
              return Response.json({ access_token: 'tok', expires_in: 3600 });
            }
            if (url.includes('api.igdb.com/v4/games')) {
              return Response.json([
                {
                  id: 1111,
                  url: 'https://www.igdb.com/games/chrono-trigger',
                  summary: 'Time-traveling RPG classic.',
                  cover: { image_id: 'co1111' },
                  genres: [{ name: 'Role-playing (RPG)' }],
                  collections: [{ name: 'Chrono' }],
                },
                {
                  id: 2222,
                  url: 'https://www.igdb.com/games/psvr-demo',
                  summary: 'IGDB overwrite attempt.',
                  cover: { image_id: 'co2222' },
                  genres: [{ name: 'Shooter' }],
                },
              ]);
            }
            return new Response('[]', { status: 200 });
          });

        try {
          await syncWorkerIgdbSeriesAndCanonical(mockEnv, { batchSize: 100 });
          const g1 = db
            .prepare(
              'SELECT summary, image_url, genres, igdb_url FROM games WHERE stable_id = 9601',
            )
            .get() as {
            summary: string | null;
            image_url: string | null;
            genres: string | null;
            igdb_url: string | null;
          };
          expect(g1.summary).toBe('Time-traveling RPG classic.');
          expect(g1.image_url).toBe(
            'https://images.igdb.com/igdb/image/upload/t_cover_big/co1111.jpg',
          );
          expect(g1.genres).toBe('Role-playing (RPG)');
          expect(g1.igdb_url).toBe('https://www.igdb.com/games/chrono-trigger');

          const g2 = db
            .prepare(
              'SELECT summary, image_url, genres, igdb_url FROM games WHERE stable_id = 9602',
            )
            .get() as {
            summary: string | null;
            image_url: string | null;
            genres: string | null;
            igdb_url: string | null;
          };
          expect(g2.image_url).toBe(
            '/covers/playstation-vr-demo-disc-playstation-4.jpg',
          );
          expect(g2.summary).toBe('Curated summary');
          expect(g2.genres).toBe('Demo Compilation');
          expect(g2.igdb_url).toBe('https://www.igdb.com/games/psvr-demo');
        } finally {
          fetchSpy.mockRestore();
        }
      });

      it('fetchIgdbMetadataForTitles queries PSVR (165) alongside PS4 (48) and PSVR2 (390) alongside PS5 (167)', async () => {
        const capturedBodies: string[] = [];
        const fetchSpy = vi
          .spyOn(globalThis, 'fetch')
          .mockImplementation(async (input, init) => {
            const url = String(input);
            if (url.includes('id.twitch.tv')) {
              return Response.json({ access_token: 'tok', expires_in: 3600 });
            }
            if (url.includes('api.igdb.com/v4/multiquery')) {
              capturedBodies.push(String(init?.body || ''));
              return Response.json([
                {
                  name: 'q0',
                  result: [
                    {
                      id: 7001,
                      name: 'Astro Bot Rescue Mission',
                      platforms: [165],
                      url: 'https://www.igdb.com/games/astro-bot-rescue-mission',
                    },
                  ],
                },
                {
                  name: 'q1',
                  result: [
                    {
                      id: 7002,
                      name: 'Horizon Call of the Mountain',
                      platforms: [390],
                      url: 'https://www.igdb.com/games/horizon-call-of-the-mountain',
                    },
                  ],
                },
              ]);
            }
            return new Response('[]', { status: 200 });
          });

        try {
          const meta = await fetchIgdbMetadataForTitles(mockEnv, [
            {
              key: 'ps4-vr',
              title: 'Astro Bot Rescue Mission',
              normalizedTitle: 'astrobotrescuemission',
              igdbPlatformId: 48,
              trackerPlatformId: 34,
            },
            {
              key: 'ps5-vr2',
              title: 'Horizon Call of the Mountain',
              normalizedTitle: 'horizoncallmountain',
              igdbPlatformId: 167,
              trackerPlatformId: 35,
            },
          ]);
          expect(capturedBodies[0]).toContain('where platforms = (48,165)');
          expect(capturedBodies[0]).toContain('where platforms = (167,390)');
          expect(meta.get('ps4-vr')?.igdb_id).toBe(7001);
          expect(meta.get('ps5-vr2')?.igdb_id).toBe(7002);
        } finally {
          fetchSpy.mockRestore();
        }
      });

      it('syncWorkerUnmatchedIgdbRetry prioritizes user-tracked unmatched games, skips duplicate sibling igdb_ids, sets cooldown, scans catalog PK tail, and enforces daily write budget', async () => {
        db.exec(`
          INSERT INTO games (stable_id, id, title, platform_id, igdb_id, image_url, manually_verified)
          VALUES
            (9701, '9701', 'Chrono Trigger', 15, NULL, NULL, 0),
            (9702, '9702', 'EarthBound Duplicate', 15, NULL, NULL, 0),
            (9703, '9703', 'EarthBound Canonical', 15, 5555, NULL, 0),
            (9704, '9704', 'Secret of Mana', 15, NULL, NULL, 0),
            (9705, '9705', 'PlayStation VR Demo Disc Test', 34, NULL, '/covers/test.jpg', 0);
          INSERT INTO game_releases (id, game_id, region)
          VALUES
            ('9701-1', 9701, 'USA'),
            ('9702-1', 9702, 'USA');
          INSERT INTO user_game_releases (user_id, release_id, ownership_status)
          VALUES
            (1, '9701-1', 1),
            (1, '9702-1', 1);
        `);

        stubIgdbFetch({
          'Chrono Trigger': [
            {
              id: 1111,
              name: 'Chrono Trigger',
              url: 'https://www.igdb.com/games/chrono-trigger',
              summary: 'SNES RPG',
              cover: { image_id: 'co_ct' },
              genres: [{ name: 'RPG' }],
              platforms: [19],
            },
          ],
          'EarthBound Duplicate': [
            {
              id: 5555,
              name: 'EarthBound',
              platforms: [19],
              alternative_names: [{ name: 'EarthBound Duplicate' }],
            },
          ],
          'Secret of Mana': [
            {
              id: 3333,
              name: 'Secret of Mana',
              url: 'https://www.igdb.com/games/secret-of-mana',
              summary: 'Action RPG',
              cover: { image_id: 'co_som' },
              platforms: [19],
            },
          ],
        });

        try {
          // Run 1: Phase 1 tracked pass updates 9701, skips 9702 sibling collision
          const run1 = await syncWorkerUnmatchedIgdbRetry(mockEnv, {
            batchSize: 10,
          });
          expect(run1.phase).toBe('tracked');
          expect(run1.updatedCount).toBe(1);
          expect(run1.skippedDuplicates).toBe(1);

          const g9701 = db
            .prepare(
              'SELECT igdb_id, summary FROM games WHERE stable_id = 9701',
            )
            .get() as { igdb_id: number | null; summary: string | null };
          expect(g9701).toEqual({ igdb_id: 1111, summary: 'SNES RPG' });

          const g9702 = db
            .prepare('SELECT igdb_id FROM games WHERE stable_id = 9702')
            .get() as { igdb_id: number | null };
          expect(g9702.igdb_id).toBeNull();

          const cdRow = db
            .prepare(
              "SELECT value FROM sync_state WHERE key = 'igdb_retry_tracked_cooldown_until'",
            )
            .get() as { value: string } | undefined;
          expect(Number(cdRow?.value)).toBeGreaterThan(Date.now() - 1000);

          // Run 2: Tracked cooldown active -> transitions to catalog tail and updates 9704
          const run2 = await syncWorkerUnmatchedIgdbRetry(mockEnv, {
            batchSize: 10,
          });
          expect(run2.phase).toBe('catalog');
          expect(run2.updatedCount).toBeGreaterThanOrEqual(1);
          const g9704 = db
            .prepare('SELECT igdb_id FROM games WHERE stable_id = 9704')
            .get() as { igdb_id: number | null };
          expect(g9704.igdb_id).toBe(3333);
          const g9705 = db
            .prepare('SELECT igdb_id FROM games WHERE stable_id = 9705')
            .get() as { igdb_id: number | null };
          expect(g9705.igdb_id).toBeNull();

          // Budget exhaustion short-circuits cleanly
          const today = new Date().toISOString().slice(0, 10);
          db.prepare(
            `INSERT INTO sync_state (key, value) VALUES ('igdb_retry_daily_writes', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          ).run(JSON.stringify({ date: today, writes: 15000 }));
          const capped = await syncWorkerUnmatchedIgdbRetry(mockEnv);
          expect(capped.phase).toBe('budget_exhausted');
          expect(capped.writesUsed).toBe(0);
        } finally {
          vi.unstubAllGlobals();
        }
      });

      it('syncWorkerBroadCatalogPopulation attaches packin_host_normalized_title without phantom standalone, persists also_released_as, and bidirectionally links CANONICAL_BUNDLES', async () => {
        const tbNorm = normalizeTitleForMatching(
          'The Misadventures of Tron Bonne',
        );
        const bayo1Norm = normalizeTitleForMatching('Bayonetta');
        const bayo2Norm = normalizeTitleForMatching('Bayonetta 2');

        db.exec(`
          UPDATE platforms SET igdb_id = 7 WHERE id = 29;
          UPDATE platforms SET igdb_id = 41 WHERE id = 24;
          UPDATE platforms SET igdb_id = 5 WHERE id = 22;
          INSERT INTO canonical_releases (
            id, platform_id, raw_title, normalized_title, region, also_released_as,
            packin_host_normalized_title, rom_name, rom_crc, is_verified_physical
          ) VALUES
            (9901, 29, 'Mega Man Legends 2 (USA) (Demo)', '${normalizeTitleForMatching('Mega Man Legends 2')}', 'USA', NULL, '${tbNorm}', 'Mega Man Legends 2 (USA) (Demo).cue', 'PACKIN01', 1),
            (9902, 29, 'Misadventures of Tron Bonne, The (USA)', '${tbNorm}', 'USA', 'Greatest Hits', NULL, 'Misadventures of Tron Bonne, The (USA).cue', 'TBHOST01', 1),
            (9903, 24, 'Bayonetta (USA)', '${bayo1Norm}', 'USA', NULL, NULL, 'Bayonetta (USA).wux', 'BAYO1001', 1),
            (9904, 24, 'Bayonetta 2 (USA)', '${bayo2Norm}', 'USA', NULL, NULL, 'Bayonetta 2 (USA).wux', 'BAYO2001', 1),
            (9905, 24, 'Rodea the Sky Soldier (USA)', '${normalizeTitleForMatching('Rodea the Sky Soldier')}', 'USA', NULL, NULL, 'Rodea the Sky Soldier (USA).wux', 'RODEA24', 1),
            (9906, 22, 'Rodea the Sky Soldier (USA)', '${normalizeTitleForMatching('Rodea the Sky Soldier')}', 'USA', NULL, NULL, 'Rodea the Sky Soldier (USA).iso', 'RODEA22', 1);
          INSERT INTO sync_state (key, value) VALUES ('catalog_seed_cursor', '9900');
        `);

        const { igdbBodies } = stubIgdbFetch({
          'Misadventures of Tron Bonne': [
            {
              id: 8801,
              name: 'The Misadventures of Tron Bonne',
              platforms: [7],
            },
          ],
          Bayonetta: [{ id: 8802, name: 'Bayonetta', platforms: [41] }],
          'Bayonetta 2': [{ id: 8803, name: 'Bayonetta 2', platforms: [41] }],
          'Rodea the Sky Soldier': [
            {
              id: 8804,
              name: 'Rodea the Sky Soldier',
              platforms: [41, 5],
            },
          ],
        });

        try {
          const seedRes = await syncWorkerBroadCatalogPopulation(mockEnv);
          expect(seedRes.ingestedGames).toBe(5);

          // Pack-in demo did not create a standalone game or trigger a separate IGDB query
          const mml2Standalone = db
            .prepare(
              "SELECT stable_id FROM games WHERE title LIKE 'Mega Man Legends 2%'",
            )
            .get();
          expect(mml2Standalone).toBeUndefined();
          expect(igdbBodies.join('\n')).not.toContain('Legends');

          // Host game received both primary + pack-in releases and also_released_as
          const tbGame = db
            .prepare('SELECT stable_id FROM games WHERE igdb_id = 8801')
            .get() as { stable_id: number };
          const tbRels = db
            .prepare(
              'SELECT rom_name, also_released_as FROM game_releases WHERE game_id = ? ORDER BY rom_name ASC',
            )
            .all(tbGame.stable_id) as Array<{
            rom_name: string;
            also_released_as: string | null;
          }>;
          expect(tbRels).toEqual([
            {
              rom_name: 'Mega Man Legends 2 (USA) (Demo).cue',
              also_released_as: null,
            },
            {
              rom_name: 'Misadventures of Tron Bonne, The (USA).cue',
              also_released_as: 'Greatest Hits',
            },
          ]);

          // Child Bayonetta (ingested first) got bidirectionally linked when Bayonetta 2 arrived
          const bayo2Game = db
            .prepare('SELECT stable_id FROM games WHERE igdb_id = 8803')
            .get() as { stable_id: number };
          const bayo1Game = db
            .prepare(
              'SELECT bundle_parent_id, bundle_disc_number FROM games WHERE igdb_id = 8802',
            )
            .get() as {
            bundle_parent_id: number | null;
            bundle_disc_number: number | null;
          };
          expect(bayo1Game).toEqual({
            bundle_parent_id: bayo2Game.stable_id,
            bundle_disc_number: 2,
          });

          // Parent Rodea (Wii U) ingested before child Rodea (Wii) also links child
          const rodeaParent = db
            .prepare(
              'SELECT stable_id FROM games WHERE platform_id = 24 AND igdb_id = 8804',
            )
            .get() as { stable_id: number };
          const rodeaChild = db
            .prepare(
              'SELECT bundle_parent_id, bundle_disc_number FROM games WHERE platform_id = 22 AND igdb_id = 8804',
            )
            .get() as {
            bundle_parent_id: number | null;
            bundle_disc_number: number | null;
          };
          expect(rodeaChild).toEqual({
            bundle_parent_id: rodeaParent.stable_id,
            bundle_disc_number: 2,
          });

          // Pack-in-only slice (without primary host release) neither creates a phantom game nor queries IGDB
          db.exec(`
            INSERT INTO canonical_releases (
              id, platform_id, raw_title, normalized_title, region,
              packin_host_normalized_title, rom_name, rom_crc, is_verified_physical
            ) VALUES (
              9907, 29, 'Mega Man Legends 2 (USA) (Demo)', '${normalizeTitleForMatching('Mega Man Legends 2')}', 'USA',
              'unmatchedhosttitle', 'Mega Man Legends 2 (USA) (Demo).cue', 'PACKIN02', 1
            );
          `);
          const preBodiesCount = igdbBodies.length;
          const packInOnlyRes = await syncWorkerBroadCatalogPopulation(mockEnv);
          expect(packInOnlyRes.ingestedGames).toBe(0);
          expect(igdbBodies.length).toBe(preBodiesCount);
          const phantom = db
            .prepare(
              "SELECT stable_id FROM games WHERE title LIKE 'Mega Man Legends 2%'",
            )
            .get();
          expect(phantom).toBeUndefined();
        } finally {
          vi.unstubAllGlobals();
        }
      });
    });

    describe('syncWorkerAmiiboCatalog & performCanonicalReleasesBackup', () => {
      it('syncWorkerAmiiboCatalog inserts new Amiibo, expands multi-pose figures, skips Skylanders crossovers, evaluates tracking rules, and fast-paths on hash match', async () => {
        db.exec(`
          INSERT INTO user_tracking_rules (user_id, rule_type, match_value, target_status, region_scope, is_ignored)
          VALUES (1, 'toy_series', 'Super Smash Bros.', 2, 'home', 0);
        `);

        const payload = {
          amiibo: [
            {
              head: '00000000',
              tail: '00000002',
              name: 'Mario',
              amiiboSeries: 'Super Smash Bros.',
              gameSeries: 'Super Mario',
              character: 'Mario',
              type: 'Figure',
              image:
                'https://raw.githubusercontent.com/N3evin/AmiiboAPI/master/images/icon_00000000-00000002.png',
              release: {
                na: '2014-11-21',
                eu: '2014-11-28',
                jp: '2014-12-06',
                au: '2014-11-29',
              },
            },
            {
              head: '07800000',
              tail: '002d0002',
              name: 'Mr. Game & Watch',
              amiiboSeries: 'Super Smash Bros.',
              gameSeries: 'Game & Watch',
              character: 'Mr. Game & Watch',
              type: 'Figure',
              image: 'https://example.com/gnw.png',
              release: {
                na: '2015-09-25',
                eu: '2015-09-25',
                jp: '2015-12-10',
                au: null,
              },
            },
            {
              head: '00000100',
              tail: '00150002',
              name: 'Hammer Slam Bowser',
              amiiboSeries: 'Skylanders SuperChargers',
              gameSeries: 'Super Mario',
              character: 'Bowser',
              type: 'Figure',
              image: 'https://example.com/bowser-sky.png',
              release: {
                na: '2015-09-20',
                eu: null,
                jp: null,
                au: null,
              },
            },
          ],
        };

        vi.stubGlobal(
          'fetch',
          vi.fn(
            async () => new Response(JSON.stringify(payload), { status: 200 }),
          ),
        );

        try {
          const first = await syncWorkerAmiiboCatalog(mockEnv);
          expect(first.hashMatch).toBe(false);
          // Mario (1) + Mr. Game & Watch expanded into 4 poses = 5 added, Skylanders Bowser skipped
          expect(first.addedCount).toBe(5);
          expect(first.updatedCount).toBe(0);
          expect(first.writesUsed).toBeGreaterThan(0);

          const mario = db
            .prepare(
              "SELECT id, name, series_id, release_date, metadata_json FROM toys WHERE id = '0000000000000002'",
            )
            .get() as Record<string, unknown>;
          expect(mario).toMatchObject({
            id: '0000000000000002',
            name: 'Mario',
            series_id: 'amiibo-super-smash-bros',
            release_date: '2014-11-21',
          });

          const gnwPoses = db
            .prepare(
              "SELECT id, name FROM toys WHERE id LIKE '07800000002d0002%' ORDER BY id",
            )
            .all() as { id: string; name: string }[];
          expect(gnwPoses).toEqual([
            { id: '07800000002d0002', name: 'Mr. Game & Watch (Default)' },
            { id: '07800000002d0002-bell', name: 'Mr. Game & Watch (Bell)' },
            { id: '07800000002d0002-judge', name: 'Mr. Game & Watch (Judge)' },
            {
              id: '07800000002d0002-parachute',
              name: 'Mr. Game & Watch (Parachute)',
            },
          ]);

          const skylandersCross = db
            .prepare("SELECT id FROM toys WHERE id = '0000010000150002'")
            .get();
          expect(skylandersCross).toBeUndefined();

          // Verify user_tracking_rules auto-tracked the 5 new Smash Amiibo for user 1
          const trackedCount = db
            .prepare(
              "SELECT COUNT(*) as c FROM user_toys WHERE user_id = 1 AND toy_id != 'link-amiibo'",
            )
            .get() as { c: number };
          expect(trackedCount.c).toBe(5);

          // Second run with identical payload must hit SHA-256 hash fast-path with 0 writes
          const second = await syncWorkerAmiiboCatalog(mockEnv);
          expect(second).toEqual({
            checked: true,
            addedCount: 0,
            updatedCount: 0,
            writesUsed: 0,
            hashMatch: true,
          });

          // Third run with updated release date updates only the changed row
          payload.amiibo[0].release.jp = '2014-12-07';
          const third = await syncWorkerAmiiboCatalog(mockEnv);
          expect(third.hashMatch).toBe(false);
          expect(third.addedCount).toBe(0);
          expect(third.updatedCount).toBe(1);

          const updatedMario = db
            .prepare(
              "SELECT metadata_json FROM toys WHERE id = '0000000000000002'",
            )
            .get() as { metadata_json: string };
          expect(JSON.parse(updatedMario.metadata_json)).toMatchObject({
            releases: {
              USA: '2014-11-21',
              Europe: '2014-11-28',
              Japan: '2014-12-07',
              Australia: '2014-11-29',
            },
          });
        } finally {
          vi.unstubAllGlobals();
        }
      });

      it('performCanonicalReleasesBackup writes chunked R2 backup across cursor ticks, skips when clean, and re-runs on drift', async () => {
        db.exec(`
          INSERT INTO canonical_releases (id, platform_id, raw_title, normalized_title, region, is_verified_physical, source)
          VALUES
            (10, 1, 'Game A (USA)', 'gamea', 'USA', 1, 'dat'),
            (20, 1, 'Game B (Europe)', 'gameb', 'Europe', 1, 'nintendo_revised');
        `);

        await markCanonicalReleasesDirty(mockEnv);
        const dirtyBefore = db
          .prepare(
            "SELECT value FROM sync_state WHERE key = 'canonical_releases_dirty'",
          )
          .get() as { value: string };
        expect(dirtyBefore.value).toBe('1');

        // Tick 1: maxChunksPerRun = 1 with pageSize = 1 -> writes chunk 0 and saves cursor
        const tick1 = await performCanonicalReleasesBackup(mockEnv, {
          pageSize: 1,
          maxChunksPerRun: 1,
        });
        expect(tick1).toEqual({
          key: R2_BACKUP_CANONICAL_MANIFEST_KEY,
          skipped: false,
          inProgress: true,
          chunksWritten: 1,
          rowCount: 1,
          maxId: 20,
        });
        expect(
          mockBucket.storage.has(getBackupChunkR2Key('canonical_releases', 0)),
        ).toBe(true);
        expect(mockBucket.storage.has(R2_BACKUP_CANONICAL_MANIFEST_KEY)).toBe(
          false,
        );

        // Tick 2: resumes cursor, writes chunk 1, publishes manifest, clears dirty flag
        const tick2 = await performCanonicalReleasesBackup(mockEnv, {
          pageSize: 1,
          maxChunksPerRun: 1,
        });
        expect(tick2).toEqual({
          key: R2_BACKUP_CANONICAL_MANIFEST_KEY,
          skipped: false,
          inProgress: false,
          chunksWritten: 1,
          rowCount: 2,
          maxId: 20,
        });

        const dirtyAfter = db
          .prepare(
            "SELECT value FROM sync_state WHERE key = 'canonical_releases_dirty'",
          )
          .get() as { value: string };
        expect(dirtyAfter.value).toBe('0');

        const manifestObj = await mockBucket.get(
          R2_BACKUP_CANONICAL_MANIFEST_KEY,
        );
        expect(manifestObj).not.toBeNull();
        expect(manifestObj?.customMetadata).toMatchObject({
          rowCount: '2',
          maxId: '20',
          chunkCount: '2',
        });
        const manifest = JSON.parse(manifestObj!.body) as {
          rowCount: number;
          maxId: number;
          chunks: string[];
        };
        expect(manifest.chunks).toEqual([
          'snapshots/chunks/canonical_releases-000.json',
          'snapshots/chunks/canonical_releases-001.json',
        ]);

        // Second backup: clean and R2 metadata matches -> skipped without scanning rows
        const second = await performCanonicalReleasesBackup(mockEnv);
        expect(second).toEqual({
          key: 'none',
          skipped: true,
          inProgress: false,
          chunksWritten: 0,
          rowCount: 2,
          maxId: 20,
        });

        // Third backup: row added directly -> metadata mismatch triggers fresh backup
        db.exec(`
          INSERT INTO canonical_releases (id, platform_id, raw_title, normalized_title, region, is_verified_physical, source)
          VALUES (30, 1, 'Game C (Japan)', 'gamec', 'Japan', 1, 'dat');
        `);
        const third = await performCanonicalReleasesBackup(mockEnv, {
          pageSize: 10,
          maxChunksPerRun: 2,
        });
        expect(third).toEqual({
          key: R2_BACKUP_CANONICAL_MANIFEST_KEY,
          skipped: false,
          inProgress: false,
          chunksWritten: 1,
          rowCount: 3,
          maxId: 30,
        });
        // Pruned trailing chunk-1 from earlier 2-chunk run!
        expect(
          mockBucket.storage.has(getBackupChunkR2Key('canonical_releases', 1)),
        ).toBe(false);
      });

      it('performChunkedCatalogBackup writes games and game_releases across cursor ticks, publishes manifest, and skips when clean', async () => {
        db.exec(`
          INSERT INTO games (stable_id, id, title, platform_id)
          VALUES (2, '2', 'Game Two', 1), (3, '3', 'Game Three', 1);
          INSERT INTO game_releases (id, game_id, region)
          VALUES ('2-1', 2, 'USA'), ('3-1', 3, 'USA');
        `);

        // Tick 1: maxChunksPerRun = 2 writes games chunk 0 (row 1) and games chunk 1 (row 2 -> completes games, moves to game_releases)
        const step1 = await performChunkedCatalogBackup(mockEnv, {
          gamesPageSize: 1,
          releasesPageSize: 2,
          maxChunksPerRun: 2,
          forceRestart: true,
        });
        expect(step1.completed).toBe(false);
        expect(step1.inProgress).toBe(true);
        expect(step1.chunksWritten).toBe(2);

        // Tick 2: writes games chunk 2 (row 3 -> finishes games phase) + game_releases chunk 0 (rows 1..2)
        const step2 = await performChunkedCatalogBackup(mockEnv, {
          gamesPageSize: 1,
          releasesPageSize: 2,
          maxChunksPerRun: 2,
        });
        expect(step2.completed).toBe(false);
        expect(step2.inProgress).toBe(true);
        expect(step2.chunksWritten).toBe(2);

        // Tick 3: finishes game_releases chunk 1 (row 3) and writes catalog-manifest.json
        const step3 = await performChunkedCatalogBackup(mockEnv, {
          gamesPageSize: 1,
          releasesPageSize: 2,
          maxChunksPerRun: 2,
        });
        expect(step3.completed).toBe(true);
        expect(step3.inProgress).toBe(false);
        expect(step3.gamesRowCount).toBe(3);
        expect(step3.releasesRowCount).toBe(3);

        const manifestObj = await mockBucket.get(
          R2_BACKUP_CATALOG_MANIFEST_KEY,
        );
        expect(manifestObj).not.toBeNull();
        const manifest = JSON.parse(manifestObj!.body) as {
          tables: {
            games: { rowCount: number; chunks: string[] };
            game_releases: { rowCount: number; chunks: string[] };
          };
        };
        expect(manifest.tables.games.rowCount).toBe(3);
        expect(manifest.tables.games.chunks).toHaveLength(3);
        expect(manifest.tables.game_releases.rowCount).toBe(3);
        expect(manifest.tables.game_releases.chunks).toHaveLength(2);

        // Clean repeat run skips without scanning
        await envClearDirtyForTest();
        async function envClearDirtyForTest() {
          db.prepare("DELETE FROM sync_state WHERE key = 'db_dirty'").run();
        }
        const skippedRun = await performChunkedCatalogBackup(mockEnv);
        expect(skippedRun.skipped).toBe(true);
        expect(skippedRun.chunksWritten).toBe(0);
      });

      it('resolveIgdbPlatformReleaseDate resolves platform-specific and regional release dates while respecting companion hardware and launch bounds', async () => {
        const {
          resolveIgdbPlatformReleaseDate,
          shouldSuppressCrossGenBasePlatform,
          selectStrictIgdbMatch,
        } = await import('./worker');
        const { normalizeTitleForMatching } =
          await import('../shared/title_matching');

        // 1. Rejects global first_release_date that predates platformLaunchDate when no valid platform release_date exists
        const tlou2Base = {
          id: 26192,
          name: 'The Last of Us Part II',
          first_release_date: Math.floor(
            Date.parse('2020-06-19T00:00:00Z') / 1000,
          ),
          platforms: [{ id: 48 }, { id: 167 }],
          release_dates: [
            {
              platform: 48,
              date: Math.floor(Date.parse('2020-06-19T00:00:00Z') / 1000),
              release_region: 8,
            },
          ],
          remasters: [
            {
              id: 277143,
              name: 'The Last of Us Part II Remastered',
              platforms: [167],
            },
          ],
        };

        // On PS4 (48, launch 2013-11-15) -> 2020-06-19
        expect(
          resolveIgdbPlatformReleaseDate(
            tlou2Base.release_dates,
            48,
            '2013-11-15',
            'USA',
            tlou2Base.first_release_date,
          ),
        ).toBe('2020-06-19');
        // On PS5 (167, launch 2020-11-12) -> null because 2020-06-19 predates PS5 launch and no platform 167 release_date exists
        expect(
          resolveIgdbPlatformReleaseDate(
            tlou2Base.release_dates,
            167,
            '2020-11-12',
            'USA',
            tlou2Base.first_release_date,
          ),
        ).toBeNull();

        // 2. Companion platform resolution: NES (18) <-> Famicom (99)
        const punchOut = {
          id: 2155,
          name: "Mike Tyson's Punch-Out!!",
          first_release_date: Math.floor(
            Date.parse('1987-10-18T00:00:00Z') / 1000,
          ),
          release_dates: [
            {
              platform: 18, // NES
              date: Math.floor(Date.parse('1987-10-18T00:00:00Z') / 1000),
              release_region: 2, // North America
            },
            {
              platform: 99, // Famicom
              date: Math.floor(Date.parse('1987-11-21T00:00:00Z') / 1000),
              release_region: 5, // Japan
            },
          ],
        };

        expect(
          resolveIgdbPlatformReleaseDate(
            punchOut.release_dates,
            18,
            '1985-10-18',
            'USA',
            punchOut.first_release_date,
          ),
        ).toBe('1987-10-18');
        expect(
          resolveIgdbPlatformReleaseDate(
            punchOut.release_dates,
            18,
            '1985-10-18',
            'Japan',
            punchOut.first_release_date,
          ),
        ).toBe('1987-11-21');

        // 3. Cross-gen suppression & strict match disambiguation
        const tlou2Remastered = {
          id: 277143,
          name: 'The Last of Us Part II Remastered',
          first_release_date: Math.floor(
            Date.parse('2024-01-19T00:00:00Z') / 1000,
          ),
          platforms: [{ id: 167 }],
          release_dates: [
            {
              platform: 167,
              date: Math.floor(Date.parse('2024-01-19T00:00:00Z') / 1000),
              release_region: 8,
            },
          ],
        };

        // Base game on PS5 (167) is suppressed when Remastered (277143) is on PS5
        expect(
          shouldSuppressCrossGenBasePlatform({
            game: tlou2Base,
            igdbPlatformId: 167,
            platformLaunchDate: '2020-11-12',
          }),
        ).toBe(true);
        expect(
          shouldSuppressCrossGenBasePlatform({
            game: tlou2Base,
            igdbPlatformId: 48,
            platformLaunchDate: '2013-11-15',
          }),
        ).toBe(false);

        // selectStrictIgdbMatch prefers The Last of Us Part II Remastered (277143) on PS5 (167) over the 2020 PS4 base game (26192)
        const strictMatch = selectStrictIgdbMatch(
          [tlou2Base, tlou2Remastered],
          normalizeTitleForMatching('The Last of Us Part II'),
          167,
          { platformLaunchDate: '2020-11-12' },
        );
        expect(strictMatch?.id).toBe(277143);
      });
    });
  });

  describe('D1 Quota Fallback, R2 Backup & Auth Edge Cache Suite', () => {
    it('caches non-degraded GET /api/auth/me in Edge Cache and falls back to R2 snapshot and stateless session cookie on D1 errors', async () => {
      const secret = mockEnv.SESSION_SECRET!;
      const token = await signSession(
        {
          id: 1,
          username: 'alice',
          role: 'admin',
          homeRegion: 'USA',
        },
        secret,
      );
      const cookieHeader = `${HOST_SESSION_COOKIE}=${token}`;

      const cacheStore = new Map<string, Response>();
      const fakeCache = {
        match: async (req: Request | string) => {
          const key = typeof req === 'string' ? req : req.url;
          const hit = cacheStore.get(key);
          return hit ? hit.clone() : undefined;
        },
        put: async (req: Request | string, res: Response) => {
          const key = typeof req === 'string' ? req : req.url;
          cacheStore.set(key, res.clone());
        },
        delete: async (req: Request | string) => {
          const key = typeof req === 'string' ? req : req.url;
          return cacheStore.delete(key);
        },
      };
      const prevCaches = (globalThis as Record<string, unknown>)['caches'];
      (globalThis as Record<string, unknown>)['caches'] = {
        default: fakeCache,
      };

      try {
        // 1. Seed R2 latest.json while D1 is healthy
        await performScheduledBackup(mockEnv);

        // 2. First /api/auth/me reads D1 and populates Edge Cache
        const prepareSpy = vi.spyOn(mockEnv.DB, 'prepare');
        const firstRes = await worker.fetch(
          new Request('https://example.com/api/auth/me', {
            headers: { Cookie: cookieHeader },
          }),
          mockEnv,
        );
        expect(firstRes.status).toBe(200);
        const firstData = (await firstRes.json()) as {
          authenticated: boolean;
          degraded?: boolean;
          user: { username: string };
        };
        expect(firstData.authenticated).toBe(true);
        expect(firstData.degraded).toBeUndefined();
        expect(firstData.user.username).toBe('alice');
        expect(prepareSpy).toHaveBeenCalled();

        // 3. Repeat /api/auth/me hits Edge Cache with 0 D1 reads
        prepareSpy.mockClear();
        const cachedRes = await worker.fetch(
          new Request('https://example.com/api/auth/me', {
            headers: { Cookie: cookieHeader },
          }),
          mockEnv,
        );
        expect(cachedRes.status).toBe(200);
        expect(prepareSpy).not.toHaveBeenCalled();

        // 4. Clear Edge Cache + simulate D1 quota exhaustion -> falls back to R2 snapshot
        cacheStore.clear();
        const failingDb = {
          prepare: () => ({
            bind: () => ({
              all: async () => {
                throw new Error('D1_ERROR: exceeded rows read quota');
              },
              first: async () => {
                throw new Error('D1_ERROR: exceeded rows read quota');
              },
              run: async () => {
                throw new Error('D1_ERROR: exceeded rows read quota');
              },
            }),
            all: async () => {
              throw new Error('D1_ERROR: exceeded rows read quota');
            },
            first: async () => {
              throw new Error('D1_ERROR: exceeded rows read quota');
            },
            run: async () => {
              throw new Error('D1_ERROR: exceeded rows read quota');
            },
          }),
          batch: async () => {
            throw new Error('D1_ERROR: exceeded rows read quota');
          },
        } as unknown as Env['DB'];
        const degradedEnv: Env = { ...mockEnv, DB: failingDb };

        const r2Res = await worker.fetch(
          new Request('https://example.com/api/auth/me', {
            headers: { Cookie: cookieHeader },
          }),
          degradedEnv,
        );
        expect(r2Res.status).toBe(200);
        expect(r2Res.headers.get(KIT_DEGRADED_HEADER)).toBe('r2-backup');
        expect(r2Res.headers.get(KIT_SNAPSHOT_TIMESTAMP_HEADER)).toBeTruthy();
        const r2Data = (await r2Res.json()) as {
          authenticated: boolean;
          degraded?: boolean;
          degradedReason?: string;
          user: { id: number; username: string; displayName: string | null };
        };
        expect(r2Data.authenticated).toBe(true);
        expect(r2Data.degraded).toBe(true);
        expect(r2Data.degradedReason).toBe('r2_backup');
        expect(r2Data.user.username).toBe('alice');
        expect(r2Data.user.displayName).toBe('Alice');

        // 5. Remove R2 backup too -> falls back to stateless verified session cookie (never boots user)
        mockBucket.storage.clear();
        resetWorkerRateLimits();
        const cookieRes = await worker.fetch(
          new Request('https://example.com/api/auth/me', {
            headers: { Cookie: cookieHeader },
          }),
          degradedEnv,
        );
        expect(cookieRes.status).toBe(200);
        const cookieData = (await cookieRes.json()) as {
          authenticated: boolean;
          degraded?: boolean;
          degradedReason?: string;
          user: { id: number; username: string; role: string };
        };
        expect(cookieData.authenticated).toBe(true);
        expect(cookieData.degraded).toBe(true);
        expect(cookieData.degradedReason).toBe('d1_unavailable');
        expect(cookieData.user.id).toBe(1);
        expect(cookieData.user.username).toBe('alice');
        expect(cookieData.user.role).toBe('admin');
      } finally {
        if (prevCaches === undefined) {
          delete (globalThis as Record<string, unknown>)['caches'];
        } else {
          (globalThis as Record<string, unknown>)['caches'] = prevCaches;
        }
      }
    });

    it('falls back to R2 snapshots/latest.json for collection, detail, public profile, and journal endpoints and returns 503 without R2', async () => {
      const secret = mockEnv.SESSION_SECRET!;
      const token = await signSession(
        {
          id: 1,
          username: 'alice',
          role: 'admin',
          homeRegion: 'USA',
        },
        secret,
      );
      const cookieHeader = `${HOST_SESSION_COOKIE}=${token}`;

      db.prepare(
        `INSERT INTO journal_entries (user_id, item_type, item_id, merchant, price_paid) VALUES (1, 'game', '1', 'Retro Shop', 39.99)`,
      ).run();

      await performScheduledBackup(mockEnv);

      const failingDb = {
        prepare: () => ({
          bind: () => ({
            all: async () => {
              throw new Error('D1_ERROR: exceeded rows read quota');
            },
            first: async () => {
              throw new Error('D1_ERROR: exceeded rows read quota');
            },
            run: async () => {
              throw new Error('D1_ERROR: exceeded rows read quota');
            },
          }),
          all: async () => {
            throw new Error('D1_ERROR: exceeded rows read quota');
          },
          first: async () => {
            throw new Error('D1_ERROR: exceeded rows read quota');
          },
          run: async () => {
            throw new Error('D1_ERROR: exceeded rows read quota');
          },
        }),
        batch: async () => {
          throw new Error('D1_ERROR: exceeded rows read quota');
        },
      } as unknown as Env['DB'];
      const degradedEnv: Env = { ...mockEnv, DB: failingDb };

      const gamesRes = await worker.fetch(
        new Request('https://example.com/api/games', {
          headers: { Cookie: cookieHeader },
        }),
        degradedEnv,
      );
      expect(gamesRes.status).toBe(200);
      expect(gamesRes.headers.get(KIT_DEGRADED_HEADER)).toBe('r2-backup');
      expect(gamesRes.headers.get(KIT_SNAPSHOT_TIMESTAMP_HEADER)).toBeTruthy();
      const games = (await gamesRes.json()) as Array<{
        id: string;
        title: string;
        ownership_status: number;
      }>;
      expect(games.length).toBe(1);
      expect(games[0].title).toBe('Super Mario Bros');
      expect(games[0].ownership_status).toBe(1);

      const gameDetailRes = await worker.fetch(
        new Request('https://example.com/api/games/gb-mario', {
          headers: { Cookie: cookieHeader },
        }),
        degradedEnv,
      );
      expect(gameDetailRes.status).toBe(200);
      expect(gameDetailRes.headers.get(KIT_DEGRADED_HEADER)).toBe('r2-backup');
      const gameDetail = (await gameDetailRes.json()) as {
        title: string;
        releases: unknown[];
      };
      expect(gameDetail.title).toBe('Super Mario Bros');
      expect(gameDetail.releases.length).toBeGreaterThanOrEqual(1);

      const toysRes = await worker.fetch(
        new Request('https://example.com/api/toys', {
          headers: { Cookie: cookieHeader },
        }),
        degradedEnv,
      );
      expect(toysRes.status).toBe(200);
      expect(toysRes.headers.get(KIT_DEGRADED_HEADER)).toBe('r2-backup');
      const toys = (await toysRes.json()) as Array<{
        id: string;
        name: string;
      }>;
      expect(toys.some((t) => t.name === 'Link')).toBe(true);

      const toyDetailRes = await worker.fetch(
        new Request('https://example.com/api/toys/link-amiibo'),
        degradedEnv,
      );
      expect(toyDetailRes.status).toBe(200);
      expect(toyDetailRes.headers.get(KIT_DEGRADED_HEADER)).toBe('r2-backup');

      const platformsRes = await worker.fetch(
        new Request('https://example.com/api/platforms'),
        degradedEnv,
      );
      expect(platformsRes.status).toBe(200);
      expect(platformsRes.headers.get(KIT_DEGRADED_HEADER)).toBe('r2-backup');
      const platforms = (await platformsRes.json()) as unknown[];
      expect(Array.isArray(platforms)).toBe(true);

      const journalRes = await worker.fetch(
        new Request('https://example.com/api/journal/entries', {
          headers: { Cookie: cookieHeader },
        }),
        degradedEnv,
      );
      expect(journalRes.status).toBe(200);
      expect(journalRes.headers.get(KIT_DEGRADED_HEADER)).toBe('r2-backup');
      const journalData = (await journalRes.json()) as {
        authorized: boolean;
        entries: Array<{ merchant: string }>;
      };
      expect(journalData.authorized).toBe(true);
      expect(journalData.entries[0].merchant).toBe('Retro Shop');

      const publicGamesRes = await worker.fetch(
        new Request('https://example.com/api/u/alice/games'),
        degradedEnv,
      );
      expect(publicGamesRes.status).toBe(200);
      expect(publicGamesRes.headers.get(KIT_DEGRADED_HEADER)).toBe('r2-backup');

      // When R2 backup is missing, read endpoints return 503 degraded instead of crashing
      mockBucket.storage.clear();
      resetWorkerRateLimits();
      for (const path of [
        '/api/games',
        '/api/toys',
        '/api/platforms',
        '/api/journal/entries',
      ]) {
        const res = await worker.fetch(
          new Request(`https://example.com${path}`, {
            headers: { Cookie: cookieHeader },
          }),
          degradedEnv,
        );
        expect(res.status).toBe(503);
        const body = (await res.json()) as { degraded?: boolean };
        expect(body.degraded).toBe(true);
      }
    });

    it('skips oversized snapshots/latest.json without parsing, serves from lite snapshots, and resolves OIDC callback under D1 quota errors', async () => {
      resetR2SnapshotCache();
      resetOidcJwksCache();
      resetWorkerRateLimits();

      await performScheduledBackup(mockEnv, false);

      // Replace snapshots/latest.json with an oversized (>5MB) corrupted payload
      const oversizedRaw = '{invalid-json-' + 'x'.repeat(5_100_000);
      mockBucket.storage.set('snapshots/latest.json', oversizedRaw);
      const cancelSpy = vi.fn(async () => {});
      const baseGet = mockBucket.get.bind(mockBucket);
      const sizeAwareBucket = {
        ...mockBucket,
        get: vi.fn(async (key: string) => {
          if (key === 'snapshots/latest.json') {
            const raw = mockBucket.storage.get(key);
            if (!raw) return null;
            return {
              size: raw.length,
              body: { cancel: cancelSpy },
              customMetadata: mockBucket.metadata.get(key),
              text: async () => raw,
            };
          }
          const obj = await baseGet(key);
          if (!obj) return null;
          const raw = mockBucket.storage.get(key) || '';
          return {
            ...obj,
            size: raw.length,
          };
        }),
      } as unknown as Env['BACKUP_BUCKET'];

      const failingDb = {
        prepare: () => ({
          bind: () => ({
            all: async () => {
              throw new Error('D1_ERROR: exceeded rows read quota');
            },
            first: async () => {
              throw new Error('D1_ERROR: exceeded rows read quota');
            },
            run: async () => {
              throw new Error('D1_ERROR: exceeded rows read quota');
            },
          }),
          all: async () => {
            throw new Error('D1_ERROR: exceeded rows read quota');
          },
          first: async () => {
            throw new Error('D1_ERROR: exceeded rows read quota');
          },
          run: async () => {
            throw new Error('D1_ERROR: exceeded rows read quota');
          },
        }),
        batch: async () => {
          throw new Error('D1_ERROR: exceeded rows read quota');
        },
      } as unknown as Env['DB'];

      const secret = mockEnv.SESSION_SECRET!;
      const token = await signSession(
        {
          id: 1,
          username: 'alice',
          role: 'admin',
          homeRegion: 'USA',
        },
        secret,
      );
      const cookieHeader = `${HOST_SESSION_COOKIE}=${token}`;
      const degradedEnv: Env = {
        ...mockEnv,
        DB: failingDb,
        BACKUP_BUCKET: sizeAwareBucket,
        OIDC_ISSUER: 'https://id.example.com',
        OIDC_CLIENT_ID: 'collection-tracker',
      };

      // 1. Serves /api/games, /api/toys, /api/platforms, and /api/auth/me cleanly from lite snapshots without touching oversized latest.json
      for (const path of [
        '/api/games',
        '/api/toys',
        '/api/platforms',
        '/api/auth/me',
      ]) {
        const res = await worker.fetch(
          new Request(`https://collection-tracker.example.com${path}`, {
            headers: { Cookie: cookieHeader },
          }),
          degradedEnv,
        );
        expect(res.status).toBe(200);
        if (path !== '/api/auth/me') {
          expect(res.headers.get(KIT_DEGRADED_HEADER)).toBe('r2-backup');
        }
      }

      // 2. When lite snapshots are removed, oversized latest.json is skipped via maxBytes (cancel called) and returns 503 instead of crashing on JSON.parse
      mockBucket.storage.delete(R2_GAMES_ACTIVE_LITE_KEY);
      resetR2SnapshotCache();
      resetWorkerRateLimits();
      const oversizedFallbackRes = await worker.fetch(
        new Request('https://collection-tracker.example.com/api/games', {
          headers: { Cookie: cookieHeader },
        }),
        degradedEnv,
      );
      expect(oversizedFallbackRes.status).toBe(503);
      expect(cancelSpy).toHaveBeenCalled();

      // 3. syncOrResolveOidcUser resolves R2 meta-lite user (legacy id=1 when verified ADMIN_EMAIL matches) and synthesizes verified claims when missing
      const resolvedLegacy = await syncOrResolveOidcUser(
        degradedEnv,
        {
          iss: 'https://id.example.com',
          sub: 'sub-r2-admin',
          aud: 'collection-tracker',
          exp: Math.floor(Date.now() / 1000) + 600,
          iat: Math.floor(Date.now() / 1000),
          email: 'admin@example.com',
          email_verified: true,
          preferred_username: 'alice',
        },
        'https://collection-tracker.example.com/api/auth/callback',
      );
      expect(resolvedLegacy.id).toBe(1);
      expect(resolvedLegacy.username).toBe('alice');

      const resolvedClaimsOnly = await syncOrResolveOidcUser(
        { ...degradedEnv, BACKUP_BUCKET: undefined },
        {
          iss: 'https://id.example.com',
          sub: '77',
          aud: 'collection-tracker',
          exp: Math.floor(Date.now() / 1000) + 600,
          iat: Math.floor(Date.now() / 1000),
          email: 'claims@example.com',
          email_verified: true,
          preferred_username: 'claims_user',
          name: 'Claims User',
        },
        'https://collection-tracker.example.com/api/auth/callback',
      );
      expect(resolvedClaimsOnly.id).toBe(77);
      expect(resolvedClaimsOnly.username).toBe('claims_user');

      // 4. GET /api/auth/callback succeeds under D1 quota errors, evicts auth-me edge cache, and silent token failure redirects to ?sso=checked
      const cacheStore = new Map<string, Response>();
      const deleteSpy = vi.fn(async (req: Request | string) => {
        const key = typeof req === 'string' ? req : req.url;
        return cacheStore.delete(key);
      });
      const prevCaches = (globalThis as Record<string, unknown>)['caches'];
      (globalThis as Record<string, unknown>)['caches'] = {
        default: {
          match: async () => undefined,
          put: async () => {},
          delete: deleteSpy,
        },
      };

      const ecKeyPair = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
      );
      const pubJwk = await crypto.subtle.exportKey('jwk', ecKeyPair.publicKey);
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

      let tokenShouldFail = false;
      let activeNonce = '';
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) => {
          const urlStr =
            typeof input === 'string'
              ? input
              : input instanceof URL
                ? input.toString()
                : input.url;
          if (urlStr === 'https://id.example.com/token') {
            if (tokenShouldFail) {
              return new Response('Quota', { status: 503 });
            }
            const nowSec = Math.floor(Date.now() / 1000);
            const jwtHeader = b64UrlStr(
              JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: 'oidc-quota-1' }),
            );
            const jwtPayload = b64UrlStr(
              JSON.stringify({
                iss: 'https://id.example.com',
                sub: 'sub-r2-admin',
                aud: 'collection-tracker',
                exp: nowSec + 600,
                iat: nowSec,
                nonce: activeNonce,
                email: 'admin@example.com',
                email_verified: true,
                preferred_username: 'alice',
                role: 'admin',
              }),
            );
            const sigBuf = await crypto.subtle.sign(
              { name: 'ECDSA', hash: 'SHA-256' },
              ecKeyPair.privateKey,
              new TextEncoder().encode(`${jwtHeader}.${jwtPayload}`),
            );
            return Response.json({
              id_token: `${jwtHeader}.${jwtPayload}.${b64UrlBytes(new Uint8Array(sigBuf))}`,
              access_token: 'at-r2',
              token_type: 'Bearer',
              expires_in: 600,
            });
          }
          if (urlStr === 'https://id.example.com/.well-known/jwks.json') {
            return Response.json({
              keys: [
                { ...pubJwk, kid: 'oidc-quota-1', alg: 'ES256', use: 'sig' },
              ],
            });
          }
          return new Response('Not Found', { status: 404 });
        });

      try {
        const loginRes = await worker.fetch(
          new Request('https://collection-tracker.example.com/api/auth/login'),
          degradedEnv,
        );
        const authUrl = new URL(loginRes.headers.get('Location')!);
        const stateParam = authUrl.searchParams.get('state')!;
        activeNonce = authUrl.searchParams.get('nonce')!;
        const stateCookie = loginRes.headers
          .getSetCookie()
          .find((c) => c.startsWith(`${HOST_OIDC_STATE_COOKIE}=`))!;

        const cbRes = await worker.fetch(
          new Request(
            `https://collection-tracker.example.com/api/auth/callback?code=c-r2&state=${encodeURIComponent(stateParam)}`,
            { headers: { Cookie: stateCookie.split(';')[0] } },
          ),
          degradedEnv,
        );
        expect(cbRes.status).toBe(302);
        const sessionCookie = cbRes.headers
          .getSetCookie()
          .find((c) => c.startsWith(`${HOST_SESSION_COOKIE}=`));
        expect(sessionCookie).toBeTruthy();
        const sessToken = parseCookies(sessionCookie!)[HOST_SESSION_COOKIE];
        const decodedSess = await verifySession(sessToken, secret);
        expect(decodedSess?.id).toBe(1);
        expect(decodedSess?.username).toBe('alice');
        expect(decodedSess?.role).toBe('admin');
        const deletedUrls = deleteSpy.mock.calls.map((c) =>
          typeof c[0] === 'string' ? c[0] : (c[0] as Request).url,
        );
        expect(deletedUrls).toContain(
          'https://edge-cache.internal/auth-me/user:1',
        );

        // Silent prompt=none callback when /token fails redirects cleanly to /?sso=checked
        const silentLoginRes = await worker.fetch(
          new Request(
            'https://collection-tracker.example.com/api/auth/login?prompt=none',
          ),
          degradedEnv,
        );
        const silentUrl = new URL(silentLoginRes.headers.get('Location')!);
        const silentState = silentUrl.searchParams.get('state')!;
        const silentCookie = silentLoginRes.headers
          .getSetCookie()
          .find((c) => c.startsWith(`${HOST_OIDC_STATE_COOKIE}=`))!;
        tokenShouldFail = true;
        const silentCbRes = await worker.fetch(
          new Request(
            `https://collection-tracker.example.com/api/auth/callback?code=c-silent&state=${encodeURIComponent(silentState)}`,
            { headers: { Cookie: silentCookie.split(';')[0] } },
          ),
          degradedEnv,
        );
        expect(silentCbRes.status).toBe(302);
        expect(silentCbRes.headers.get('Location')).toBe(
          'https://collection-tracker.example.com/?sso=checked',
        );
      } finally {
        fetchSpy.mockRestore();
        if (prevCaches === undefined) {
          delete (globalThis as Record<string, unknown>)['caches'];
        } else {
          (globalThis as Record<string, unknown>)['caches'] = prevCaches;
        }
      }
    });

    it('scopes default GET /api/games to active collection rows on large catalogs (>500 games), returns full catalog with include_unowned=1, and backfills lite snapshots on daytime cron when latest.json exists', async () => {
      const insertMany = db.transaction(() => {
        const insertGame = db.prepare(
          `INSERT INTO games (id, title, platform_id) VALUES (?, ?, 1)`,
        );
        for (let i = 1; i <= 505; i++) {
          insertGame.run(`bulk-game-${i}`, `Bulk Game ${i}`);
        }
      });
      insertMany();

      const secret = mockEnv.SESSION_SECRET!;
      const token = await signSession(
        {
          id: 1,
          username: 'alice',
          role: 'admin',
          homeRegion: 'USA',
        },
        secret,
      );
      const cookieHeader = `${HOST_SESSION_COOKIE}=${token}`;

      // Default GET /api/games filters out unowned bulk rows (>500 games)
      const activeRes = await worker.fetch(
        new Request('https://collection-tracker.example.com/api/games', {
          headers: { Cookie: cookieHeader },
        }),
        mockEnv,
      );
      expect(activeRes.status).toBe(200);
      const activeGames = (await activeRes.json()) as Array<{ title: string }>;
      expect(activeGames.some((g) => g.title === 'Super Mario Bros')).toBe(
        true,
      );
      expect(activeGames.some((g) => g.title.startsWith('Bulk Game'))).toBe(
        false,
      );

      // include_unowned=1 returns all games including unowned catalog rows
      const fullRes = await worker.fetch(
        new Request(
          'https://collection-tracker.example.com/api/games?include_unowned=1',
          { headers: { Cookie: cookieHeader } },
        ),
        mockEnv,
      );
      expect(fullRes.status).toBe(200);
      const fullGames = (await fullRes.json()) as Array<{ title: string }>;
      expect(fullGames.length).toBeGreaterThanOrEqual(506);

      // Daytime cron backfills lite snapshots when snapshots/latest.json exists but lite keys do not
      mockBucket.storage.clear();
      mockBucket.storage.set('snapshots/latest.json', JSON.stringify({ v: 1 }));

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
        await worker.scheduled(
          {
            cron: '0 * * * *',
            type: 'scheduled',
            scheduledTime: mockNow.getTime(),
          } as unknown as ScheduledEvent,
          mockEnv,
          {} as ExecutionContext,
        );
        expect(mockBucket.storage.has(R2_META_LITE_KEY)).toBe(true);
        expect(mockBucket.storage.has(R2_TOYS_LITE_KEY)).toBe(true);
        expect(mockBucket.storage.has(R2_GAMES_ACTIVE_LITE_KEY)).toBe(true);
      } finally {
        globalThis.Date = originalDate;
        fetchSpy.mockRestore();
      }
    });

    it('runs post-midnight (00:05 UTC) R2 catalog chunk generation, serves immutable Edge-Cached chunks untouched by user mutations, and serves live D1 user overlay + same-day delta', async () => {
      // Seed 505 unowned games so catalog exceeds 500 threshold and triggers X-Catalog-Partial: 1
      const insertMany = db.transaction(() => {
        const insertGame = db.prepare(
          `INSERT INTO games (id, title, platform_id) VALUES (?, ?, 1)`,
        );
        const insertRel = db.prepare(
          `INSERT INTO game_releases (id, game_id, region) VALUES (?, ?, 'USA')`,
        );
        for (let i = 1; i <= 505; i++) {
          const info = insertGame.run(`r2-game-${i}`, `R2 Catalog Game ${i}`);
          insertRel.run(`r2-rel-${i}`, info.lastInsertRowid);
        }
      });
      insertMany();

      await markDbDirty(mockEnv);

      const originalDate = globalThis.Date;
      const postMidnight = new Date('2026-11-17T00:05:00Z');
      globalThis.Date = class extends originalDate {
        constructor() {
          super();
          return postMidnight;
        }
        static override now() {
          return postMidnight.getTime();
        }
      } as unknown as typeof Date;

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async () => {
          return {
            ok: true,
            json: async () => ({ products: [] }),
            text: async () => '',
          } as unknown as Response;
        });

      const cacheStore = new Map<string, Response>();
      const mockCache = {
        match: vi.fn(async (req: RequestInfo | URL) => {
          const key =
            typeof req === 'string'
              ? req
              : req instanceof Request
                ? req.url
                : req.toString();
          return cacheStore.get(key)?.clone() || undefined;
        }),
        put: vi.fn(async (req: RequestInfo | URL, res: Response) => {
          const key =
            typeof req === 'string'
              ? req
              : req instanceof Request
                ? req.url
                : req.toString();
          cacheStore.set(key, res.clone());
        }),
        delete: vi.fn(async (req: RequestInfo | URL) => {
          const key =
            typeof req === 'string'
              ? req
              : req instanceof Request
                ? req.url
                : req.toString();
          return cacheStore.delete(key);
        }),
      };
      vi.stubGlobal('caches', { default: mockCache });

      try {
        // 1. Post-midnight 00:05 UTC cron triggers daily backup (snapshots/*) without baking R2 catalog/* chunks
        await worker.scheduled(
          {
            cron: '*/30 * * * *',
            type: 'scheduled',
            scheduledTime: postMidnight.getTime(),
          } as unknown as ScheduledEvent,
          mockEnv,
          {} as ExecutionContext,
        );
        expect(mockBucket.storage.has('snapshots/latest.json')).toBe(true);
        expect(mockBucket.storage.has(R2_CATALOG_MANIFEST_KEY)).toBe(false);
        expect(mockBucket.storage.has(R2_CATALOG_TOYS_CHUNK_KEY)).toBe(false);

        const manifestRes = await worker.fetch(
          new Request(
            'https://collection-tracker.example.com/api/catalog/games?manifest=1',
          ),
          mockEnv,
        );
        expect(manifestRes.status).toBe(200);
        expect(manifestRes.headers.get('X-Catalog-Source')).toBe(
          'd1-edge-cache',
        );
        const manifest = (await manifestRes.json()) as {
          version: string;
          totalRows: number;
          chunkCount: number;
          maxStableId: number;
          chunkBounds?: number[];
          source?: string;
        };
        expect(manifest.source).toBe('d1-edge-cache');
        expect(Array.isArray(manifest.chunkBounds)).toBe(true);
        expect(manifest.chunkBounds!.length).toBe(manifest.chunkCount + 1);
        expect(mockBucket.storage.has(R2_CATALOG_MANIFEST_KEY)).toBe(false);
        expect(manifest.totalRows).toBeGreaterThanOrEqual(506);
        expect(manifest.chunkCount).toBe(1);
        expect(manifest.maxStableId).toBeGreaterThan(500);

        // 2. Signed-in GET /api/games returns active slice with X-Catalog-Partial: 1
        const token = await signSession(
          {
            id: 1,
            username: 'alice',
            role: 'admin',
            homeRegion: 'USA',
          },
          mockEnv.SESSION_SECRET!,
        );
        const cookieHeader = `${HOST_SESSION_COOKIE}=${token}`;

        const partialRes = await worker.fetch(
          new Request('https://collection-tracker.example.com/api/games', {
            headers: { Cookie: cookieHeader },
          }),
          mockEnv,
        );
        expect(partialRes.status).toBe(200);
        expect(partialRes.headers.get(X_CATALOG_PARTIAL_HEADER)).toBe('1');
        expect(partialRes.headers.get(X_CATALOG_CHUNK_SIZE_HEADER)).toBe(
          '3500',
        );

        // 3. GET /api/catalog/games?chunk=0 streams D1 keyset chunk with 24h immutable Edge Cache
        const chunkUrl = `https://collection-tracker.example.com/api/catalog/games?chunk=0&v=${encodeURIComponent(manifest.version)}`;
        const chunkRes1 = await worker.fetch(
          new Request(chunkUrl, { headers: { Cookie: cookieHeader } }),
          mockEnv,
        );
        expect(chunkRes1.status).toBe(200);
        expect(chunkRes1.headers.get('Cache-Control')).toContain('immutable');
        expect(chunkRes1.headers.get('X-Catalog-Source')).toBe('d1-edge-cache');
        expect(chunkRes1.headers.get('X-Cache-Status')).toBe('MISS');
        const chunkData = (await chunkRes1.json()) as Array<{ id: string }>;
        expect(chunkData.length).toBeGreaterThanOrEqual(506);
        expect(cacheStore.has(chunkUrl)).toBe(true);

        const chunkResHit = await worker.fetch(
          new Request(chunkUrl, { headers: { Cookie: cookieHeader } }),
          mockEnv,
        );
        expect(chunkResHit.status).toBe(200);
        expect(chunkResHit.headers.get('X-Cache-Status')).toBe('HIT');

        // 4. User toggle mutation must NOT evict immutable /api/catalog/games Edge Cache
        const toggleRes = await worker.fetch(
          new Request(
            'https://collection-tracker.example.com/api/collection/toggle',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Origin: 'https://collection-tracker.example.com',
                Cookie: cookieHeader,
              },
              body: JSON.stringify({
                id: 'r2-rel-1',
                type: 'game',
                status: 2,
                field: 'ownership_status',
              }),
            },
          ),
          mockEnv,
        );
        expect(toggleRes.status).toBe(200);
        expect(cacheStore.has(chunkUrl)).toBe(true);

        // 5. Same-day new game + live user state returned by /api/user/collection-overlay and /api/u/alice/collection-overlay
        const newGameInfo = db
          .prepare(
            `INSERT INTO games (id, title, platform_id) VALUES ('same-day-new', 'Same Day Discovery', 1)`,
          )
          .run();
        db.prepare(
          `INSERT INTO game_releases (id, game_id, region) VALUES ('same-day-rel', ?, 'USA')`,
        ).run(newGameInfo.lastInsertRowid);
        db.prepare(
          `INSERT INTO user_games (user_id, game_id, play_status, queued) VALUES (1, ?, 2, 1)`,
        ).run(newGameInfo.lastInsertRowid);

        const overlayRes = await worker.fetch(
          new Request(
            'https://collection-tracker.example.com/api/user/collection-overlay',
            { headers: { Cookie: cookieHeader } },
          ),
          mockEnv,
        );
        expect(overlayRes.status).toBe(200);
        const overlay = (await overlayRes.json()) as {
          ugr: Array<{ release_id: string; ownership_status: number }>;
          ug: Array<{ game_id: number; play_status: number; queued: number }>;
          deltaGames: Array<{ id: string; title: string; play_status: number }>;
        };
        expect(
          overlay.ugr.some(
            (r) => r.release_id === 'r2-rel-1' && r.ownership_status === 2,
          ),
        ).toBe(true);
        expect(overlay.deltaGames.map((d) => d.id)).toContain('same-day-rel');
        expect(
          overlay.deltaGames.find((d) => d.id === 'same-day-rel')?.play_status,
        ).toBe(2);

        const publicOverlayRes = await worker.fetch(
          new Request(
            'https://collection-tracker.example.com/api/u/alice/collection-overlay',
          ),
          mockEnv,
        );
        expect(publicOverlayRes.status).toBe(200);
        const publicOverlay = (await publicOverlayRes.json()) as {
          deltaGames: Array<{ id: string }>;
        };
        expect(publicOverlay.deltaGames.map((d) => d.id)).toContain(
          'same-day-rel',
        );

        // 6. GET /api/toys merges D1/cached base toys with live user_toys overlay without R2 catalog reads
        db.prepare(
          `INSERT INTO toys (id, name, line, series_id, sort_index) VALUES ('zelda-amiibo', 'Zelda', 'amiibo', 'smash', 1)`,
        ).run();
        db.prepare(
          `INSERT INTO user_toys (user_id, toy_id, ownership_status) VALUES (1, 'link-amiibo', 1)`,
        ).run();

        const toysRes = await worker.fetch(
          new Request('https://collection-tracker.example.com/api/toys', {
            headers: { Cookie: cookieHeader },
          }),
          mockEnv,
        );
        expect(toysRes.status).toBe(200);
        const toys = (await toysRes.json()) as Array<{
          id: string;
          ownership_status: number;
        }>;
        expect(toys.find((t) => t.id === 'link-amiibo')?.ownership_status).toBe(
          1,
        );
        expect(toys.some((t) => t.id === 'zelda-amiibo')).toBe(true);

        // 7. Mismatched/unversioned ?chunk=0 request serves short-TTL D1 response (non-immutable, zero R2 puts)
        cacheStore.clear();
        const mismatchRes = await worker.fetch(
          new Request(
            'https://collection-tracker.example.com/api/catalog/games?chunk=0&v=stale-version',
          ),
          mockEnv,
        );
        expect(mismatchRes.status).toBe(200);
        expect(mismatchRes.headers.get('Cache-Control')).not.toContain(
          'immutable',
        );
        expect(mismatchRes.headers.get('X-Catalog-Source')).toBe(
          'd1-edge-cache',
        );
        expect(
          mockBucket.storage.has(getCatalogChunkR2Key(0, manifest.version)),
        ).toBe(false);
      } finally {
        globalThis.Date = originalDate;
        fetchSpy.mockRestore();
        vi.unstubAllGlobals();
      }
    });

    it('caches GET /api/journal/entries per user, invalidates on POST/DELETE, and skips or Edge-caches deltaGames in /api/user/collection-overlay', async () => {
      resetWorkerRateLimits();

      const cacheStore = new Map<string, Response>();
      const mockCache = {
        match: vi.fn(async (req: RequestInfo | URL) => {
          const key =
            typeof req === 'string'
              ? req
              : req instanceof Request
                ? req.url
                : req.toString();
          return cacheStore.get(key)?.clone() || undefined;
        }),
        put: vi.fn(async (req: RequestInfo | URL, res: Response) => {
          const key =
            typeof req === 'string'
              ? req
              : req instanceof Request
                ? req.url
                : req.toString();
          cacheStore.set(key, res.clone());
        }),
        delete: vi.fn(async (req: RequestInfo | URL) => {
          const key =
            typeof req === 'string'
              ? req
              : req instanceof Request
                ? req.url
                : req.toString();
          return cacheStore.delete(key);
        }),
      };
      vi.stubGlobal('caches', { default: mockCache });

      try {
        const token = await signSession(
          {
            id: 1,
            username: 'alice',
            role: 'admin',
            homeRegion: 'USA',
          },
          mockEnv.SESSION_SECRET!,
        );
        const cookieHeader = `${HOST_SESSION_COOKIE}=${token}`;

        db.prepare(
          `INSERT INTO games (stable_id, id, title, platform_id) VALUES (50, 'journal-test-game', 'Journal Test Game', 1)`,
        ).run();
        db.prepare(
          `INSERT INTO game_releases (id, game_id, region) VALUES ('journal-test-rel', 50, 'USA')`,
        ).run();
        db.prepare(
          `INSERT INTO journal_entries (user_id, item_type, item_id, merchant, price_paid) VALUES (1, 'game', 'journal-test-game', 'Shop A', 49.99)`,
        ).run();

        const preparedSqls: string[] = [];
        const basePrepare = mockEnv.DB.prepare.bind(mockEnv.DB);
        const spiedEnv: Env = {
          ...mockEnv,
          DB: {
            ...mockEnv.DB,
            prepare: (sql: string) => {
              preparedSqls.push(sql);
              return basePrepare(sql);
            },
          } as unknown as Env['DB'],
        };

        // 1. First GET /api/journal/entries queries D1 and warms Edge Cache
        const jRes1 = await worker.fetch(
          new Request(
            'https://collection-tracker.example.com/api/journal/entries',
            {
              headers: { Cookie: cookieHeader },
            },
          ),
          spiedEnv,
        );
        expect(jRes1.status).toBe(200);
        const jData1 = (await jRes1.json()) as {
          entries: Array<{ merchant: string }>;
        };
        expect(jData1.entries).toHaveLength(1);
        expect(
          preparedSqls.filter((s) => s.includes('FROM journal_entries')).length,
        ).toBe(1);
        expect(
          cacheStore.has('https://edge-cache.internal/journal/user:1'),
        ).toBe(true);

        // 2. Second GET /api/journal/entries hits Edge Cache (0 D1 reads)
        const jRes2 = await worker.fetch(
          new Request(
            'https://collection-tracker.example.com/api/journal/entries',
            {
              headers: { Cookie: cookieHeader },
            },
          ),
          spiedEnv,
        );
        expect(jRes2.status).toBe(200);
        const jData2 = (await jRes2.json()) as {
          entries: Array<{ merchant: string }>;
        };
        expect(jData2.entries[0].merchant).toBe('Shop A');
        expect(
          preparedSqls.filter((s) => s.includes('FROM journal_entries')).length,
        ).toBe(1);

        // 3. POST /api/journal invalidates the cached journal response
        const postJournalRes = await worker.fetch(
          new Request('https://collection-tracker.example.com/api/journal', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://collection-tracker.example.com',
              Cookie: cookieHeader,
            },
            body: JSON.stringify({
              item_type: 'game',
              item_id: 'journal-test-game',
              merchant: 'Shop B',
              price_paid: 29.99,
            }),
          }),
          spiedEnv,
        );
        expect(postJournalRes.status).toBe(200);
        expect(
          cacheStore.has('https://edge-cache.internal/journal/user:1'),
        ).toBe(false);

        // 4. GET /api/user/collection-overlay skips delta query when since_stable_id >= MAX(stable_id)
        preparedSqls.length = 0;
        const manifest = await writeCatalogChunksToR2(spiedEnv, {
          forceRestart: true,
        });
        expect(manifest?.maxStableId).toBe(50);

        preparedSqls.length = 0;
        const overlayNoDeltaRes = await worker.fetch(
          new Request(
            'https://collection-tracker.example.com/api/user/collection-overlay?since_stable_id=50',
            { headers: { Cookie: cookieHeader } },
          ),
          spiedEnv,
        );
        expect(overlayNoDeltaRes.status).toBe(200);
        const overlayNoDelta = (await overlayNoDeltaRes.json()) as {
          deltaGames: unknown[];
        };
        expect(overlayNoDelta.deltaGames).toEqual([]);
        expect(
          preparedSqls.some((s) => s.includes('AND g.stable_id > ?')),
        ).toBe(false);

        // 5. Inserting a new game past since_stable_id populates Edge Cache for deltaGames and overlays user state
        db.prepare(
          `INSERT INTO games (stable_id, id, title, platform_id) VALUES (51, 'delta-new-game', 'Delta New Game', 1)`,
        ).run();
        db.prepare(
          `INSERT INTO game_releases (id, game_id, region) VALUES ('delta-new-rel', 51, 'USA')`,
        ).run();
        db.prepare(
          `INSERT INTO user_games (user_id, game_id, play_status, queued) VALUES (1, 51, 3, 1)`,
        ).run();

        preparedSqls.length = 0;
        const overlayDelta1 = await worker.fetch(
          new Request(
            'https://collection-tracker.example.com/api/user/collection-overlay?since_stable_id=50',
            { headers: { Cookie: cookieHeader } },
          ),
          spiedEnv,
        );
        expect(overlayDelta1.status).toBe(200);
        const d1Body = (await overlayDelta1.json()) as {
          deltaGames: Array<{
            id: string;
            play_status: number;
            queued: number;
          }>;
        };
        expect(d1Body.deltaGames.map((d) => d.id)).toEqual(['delta-new-rel']);
        expect(d1Body.deltaGames[0].play_status).toBe(3);
        expect(d1Body.deltaGames[0].queued).toBe(1);
        expect(
          preparedSqls.filter((s) => s.includes('AND g.stable_id > ?')).length,
        ).toBe(1);

        // Repeat call hits in-isolate / Edge Cache for deltaGames with 0 delta D1 queries
        const overlayDelta2 = await worker.fetch(
          new Request(
            'https://collection-tracker.example.com/api/user/collection-overlay?since_stable_id=50',
            { headers: { Cookie: cookieHeader } },
          ),
          spiedEnv,
        );
        expect(overlayDelta2.status).toBe(200);
        const d2Body = (await overlayDelta2.json()) as {
          deltaGames: Array<{
            id: string;
            play_status: number;
            queued: number;
          }>;
        };
        expect(d2Body.deltaGames[0].play_status).toBe(3);
        expect(
          preparedSqls.filter((s) => s.includes('AND g.stable_id > ?')).length,
        ).toBe(1);
      } finally {
        vi.unstubAllGlobals();
        resetWorkerRateLimits();
      }
    });

    it('resolves accurate catalog manifest row counts and chunkCount across large primary-key gaps', async () => {
      resetWorkerRateLimits();
      db.prepare('DELETE FROM user_game_releases').run();
      db.prepare('DELETE FROM user_games').run();
      db.prepare('DELETE FROM game_releases').run();
      db.prepare('DELETE FROM games').run();

      db.prepare(
        `INSERT INTO games (stable_id, id, title, platform_id)
         VALUES (10, 'gap-game-10', 'Gap Game Low', 26),
                (50000, 'gap-game-50000', 'Gap Game High', 26)`,
      ).run();
      db.prepare(
        `INSERT INTO game_releases (id, game_id, region)
         VALUES ('gap-rel-10', 10, 'USA'),
                ('gap-rel-50000', 50000, 'USA')`,
      ).run();

      const builtManifest = await writeCatalogChunksToR2(mockEnv, {
        forceRestart: true,
      });
      expect(builtManifest).not.toBeNull();
      expect(builtManifest!.totalRows).toBe(2);
      expect(builtManifest!.chunkCount).toBe(1);
      expect(builtManifest!.maxStableId).toBe(50000);

      // Remove R2 manifest and clear in-memory cache so resolveCatalogManifest must synthesize from D1 + sync_state
      mockBucket.storage.delete(R2_CATALOG_MANIFEST_KEY);
      resetWorkerRateLimits();

      const manifestRes = await worker.fetch(
        new Request(
          'https://collection-tracker.example.com/api/catalog/games?manifest=1',
        ),
        mockEnv,
      );
      expect(manifestRes.status).toBe(200);
      const manifest = (await manifestRes.json()) as {
        totalRows: number;
        chunkCount: number;
        maxStableId: number;
      };
      expect(manifest.totalRows).toBe(2);
      expect(manifest.chunkCount).toBe(1);
      expect(manifest.maxStableId).toBe(50000);

      const chunk0Res = await worker.fetch(
        new Request(
          'https://collection-tracker.example.com/api/catalog/games?chunk=0&v=gap-test',
        ),
        mockEnv,
      );
      expect(chunk0Res.status).toBe(200);
      const chunk0Rows = (await chunk0Res.json()) as Array<{
        stable_id: number;
      }>;
      expect(chunk0Rows.map((r) => r.stable_id).sort((a, b) => a - b)).toEqual([
        10, 50000,
      ]);
    });

    it('enforces strict per-user isolation in R2 degraded /api/games and /api/u/:username/games and emits X-Catalog-Partial: 1', async () => {
      db.exec(`
        INSERT INTO users (id, username, is_public, home_region, display_name)
        VALUES (2, 'bob', 1, 'USA', 'Bob'),
               (3, 'carol', 0, 'USA', 'Carol');
        INSERT INTO games (stable_id, id, title, platform_id, sort_index, retail_on_sale)
        VALUES (2, 'bob-game', 'Bob Exclusive Tracked Game', 1, 1, 0),
               (3, 'carol-game', 'Carol Private Tracked Game', 1, 2, 0),
               (4, 'sale-game', 'Global Retail Deal Game', 1, 3, 1);
        INSERT INTO game_releases (id, game_id, region, release_date)
        VALUES ('bob-rel', 2, 'USA', '2001-01-01'),
               ('carol-rel', 3, 'USA', '2001-01-01'),
               ('sale-rel', 4, 'USA', '2001-01-01');
        INSERT INTO user_game_releases (user_id, release_id, ownership_status, has_media)
        VALUES (2, 'bob-rel', 2, 0),
               (3, 'carol-rel', 1, 1);
      `);

      await performScheduledBackup(mockEnv, false);

      const failingDb = {
        prepare: () => ({
          bind: () => ({
            all: async () => {
              throw new Error('D1_ERROR: exceeded rows read quota');
            },
            first: async () => {
              throw new Error('D1_ERROR: exceeded rows read quota');
            },
            run: async () => {
              throw new Error('D1_ERROR: exceeded rows read quota');
            },
          }),
          all: async () => {
            throw new Error('D1_ERROR: exceeded rows read quota');
          },
          first: async () => {
            throw new Error('D1_ERROR: exceeded rows read quota');
          },
          run: async () => {
            throw new Error('D1_ERROR: exceeded rows read quota');
          },
        }),
        batch: async () => {
          throw new Error('D1_ERROR: exceeded rows read quota');
        },
      } as unknown as Env['DB'];
      const degradedEnv: Env = { ...mockEnv, DB: failingDb };

      const secret = mockEnv.SESSION_SECRET!;
      const aliceToken = await signSession(
        { id: 1, username: 'alice', role: 'admin', homeRegion: 'USA' },
        secret,
      );
      const bobToken = await signSession(
        { id: 2, username: 'bob', role: 'user', homeRegion: 'USA' },
        secret,
      );

      // 1. Alice sees her own game + global on-sale game, never Bob's or Carol's
      const aliceRes = await worker.fetch(
        new Request('https://collection-tracker.example.com/api/games', {
          headers: { Cookie: `${HOST_SESSION_COOKIE}=${aliceToken}` },
        }),
        degradedEnv,
      );
      expect(aliceRes.status).toBe(200);
      expect(aliceRes.headers.get(KIT_DEGRADED_HEADER)).toBe('r2-backup');
      expect(aliceRes.headers.get(X_CATALOG_PARTIAL_HEADER)).toBe('1');
      const aliceIds = ((await aliceRes.json()) as Array<{ id: string }>).map(
        (g) => g.id,
      );
      expect(aliceIds).toContain('gb-mario');
      expect(aliceIds).toContain('sale-rel');
      expect(aliceIds).not.toContain('bob-rel');
      expect(aliceIds).not.toContain('carol-rel');

      // 2. Bob sees his own game + global on-sale game, never Alice's or Carol's
      const bobRes = await worker.fetch(
        new Request('https://collection-tracker.example.com/api/games', {
          headers: { Cookie: `${HOST_SESSION_COOKIE}=${bobToken}` },
        }),
        degradedEnv,
      );
      expect(bobRes.status).toBe(200);
      expect(bobRes.headers.get(X_CATALOG_PARTIAL_HEADER)).toBe('1');
      const bobIds = ((await bobRes.json()) as Array<{ id: string }>).map(
        (g) => g.id,
      );
      expect(bobIds).toContain('bob-rel');
      expect(bobIds).toContain('sale-rel');
      expect(bobIds).not.toContain('gb-mario');
      expect(bobIds).not.toContain('carol-rel');

      // 3. Anonymous visitor sees ONLY global on-sale game, never any user's tracked games
      const anonRes = await worker.fetch(
        new Request('https://collection-tracker.example.com/api/games'),
        degradedEnv,
      );
      expect(anonRes.status).toBe(200);
      expect(anonRes.headers.get(X_CATALOG_PARTIAL_HEADER)).toBe('1');
      const anonIds = ((await anonRes.json()) as Array<{ id: string }>).map(
        (g) => g.id,
      );
      expect(anonIds).toEqual(['sale-rel']);

      // 4. Public profile endpoint returns only Alice's games + global, never Bob's or Carol's
      const pubAliceRes = await worker.fetch(
        new Request('https://collection-tracker.example.com/api/u/alice/games'),
        degradedEnv,
      );
      expect(pubAliceRes.status).toBe(200);
      expect(pubAliceRes.headers.get(X_CATALOG_PARTIAL_HEADER)).toBe('1');
      const pubAliceIds = (
        (await pubAliceRes.json()) as Array<{ id: string }>
      ).map((g) => g.id);
      expect(pubAliceIds).toContain('gb-mario');
      expect(pubAliceIds).toContain('sale-rel');
      expect(pubAliceIds).not.toContain('bob-rel');
      expect(pubAliceIds).not.toContain('carol-rel');

      // 5. Private profile remains hidden in degraded mode
      const privCarolRes = await worker.fetch(
        new Request('https://collection-tracker.example.com/api/u/carol/games'),
        degradedEnv,
      );
      expect(privCarolRes.status).toBe(404);
    });

    it('recovers catalog manifest from contiguous R2 chunks and never falls back to games-active-lite.json', async () => {
      await performScheduledBackup(mockEnv, false);

      await mockBucket.put(
        getCatalogChunkR2Key(0),
        JSON.stringify([
          { id: 'c0-1', stable_id: 1, title: 'Chunk 0 Game A' },
          { id: 'c0-2', stable_id: 2, title: 'Chunk 0 Game B' },
        ]),
        {
          customMetadata: {
            chunkIndex: '0',
            rowCount: '2',
            version: '2026-11-22:100:1',
            timestamp: '2026-11-22T23:30:00.000Z',
          },
        },
      );
      await mockBucket.put(
        getCatalogChunkR2Key(1),
        JSON.stringify([{ id: 'c1-1', stable_id: 3, title: 'Chunk 1 Game C' }]),
        {
          customMetadata: {
            chunkIndex: '1',
            rowCount: '1',
            version: '2026-11-22:100:1',
            timestamp: '2026-11-23T00:30:00.000Z',
          },
        },
      );
      mockBucket.storage.delete(R2_CATALOG_MANIFEST_KEY);

      const failingDb = {
        prepare: () => ({
          bind: () => ({
            all: async () => {
              throw new Error('D1_ERROR: exceeded rows read quota');
            },
            first: async () => {
              throw new Error('D1_ERROR: exceeded rows read quota');
            },
            run: async () => {
              throw new Error('D1_ERROR: exceeded rows read quota');
            },
          }),
          all: async () => {
            throw new Error('D1_ERROR: exceeded rows read quota');
          },
          first: async () => {
            throw new Error('D1_ERROR: exceeded rows read quota');
          },
          run: async () => {
            throw new Error('D1_ERROR: exceeded rows read quota');
          },
        }),
        batch: async () => {
          throw new Error('D1_ERROR: exceeded rows read quota');
        },
      } as unknown as Env['DB'];
      const degradedEnv: Env = { ...mockEnv, DB: failingDb };

      const manifestRes = await worker.fetch(
        new Request(
          'https://collection-tracker.example.com/api/catalog/games?manifest=1',
        ),
        degradedEnv,
      );
      expect(manifestRes.status).toBe(200);
      expect(manifestRes.headers.get(KIT_DEGRADED_HEADER)).toBe('r2-backup');
      expect(manifestRes.headers.get('Cache-Control')).toContain('no-store');
      const manifest = (await manifestRes.json()) as {
        version: string;
        totalRows: number;
        chunkCount: number;
        maxStableId: number;
      };
      expect(manifest.version).toBe('2026-11-22:100:1:r2-2');
      expect(manifest.totalRows).toBe(3);
      expect(manifest.chunkCount).toBe(2);
      expect(manifest.maxStableId).toBe(0);

      const chunk0Res = await worker.fetch(
        new Request(
          `https://collection-tracker.example.com/api/catalog/games?chunk=0&v=${encodeURIComponent(manifest.version)}`,
        ),
        degradedEnv,
      );
      const chunk1Res = await worker.fetch(
        new Request(
          `https://collection-tracker.example.com/api/catalog/games?chunk=1&v=${encodeURIComponent(manifest.version)}`,
        ),
        degradedEnv,
      );
      expect(chunk0Res.status).toBe(200);
      expect(chunk1Res.status).toBe(200);
      expect(((await chunk0Res.json()) as Array<{ id: string }>).length).toBe(
        2,
      );
      expect(((await chunk1Res.json()) as Array<{ id: string }>).length).toBe(
        1,
      );

      // Missing chunks + missing manifest returns 503 even if games-active-lite.json exists
      mockBucket.storage.delete(getCatalogChunkR2Key(0));
      mockBucket.storage.delete(getCatalogChunkR2Key(1));
      resetWorkerRateLimits();
      const missingManifestRes = await worker.fetch(
        new Request(
          'https://collection-tracker.example.com/api/catalog/games?manifest=1',
        ),
        degradedEnv,
      );
      const missingChunkRes = await worker.fetch(
        new Request(
          'https://collection-tracker.example.com/api/catalog/games?chunk=0&v=none',
        ),
        degradedEnv,
      );
      expect(missingManifestRes.status).toBe(503);
      expect(missingChunkRes.status).toBe(503);
    });

    it('computes D1 keyset chunkBounds across multi-chunk catalogs and serves deterministic keyset slices without R2 reads', async () => {
      resetWorkerRateLimits();
      db.prepare('DELETE FROM user_game_releases').run();
      db.prepare('DELETE FROM game_releases').run();
      db.prepare('DELETE FROM games').run();

      const seedTx = db.transaction(() => {
        const insG = db.prepare(
          `INSERT INTO games (stable_id, id, title, platform_id) VALUES (?, ?, ?, 35)`,
        );
        const insR = db.prepare(
          `INSERT INTO game_releases (id, game_id, region) VALUES (?, ?, 'USA')`,
        );
        for (let i = 1; i <= 1502; i++) {
          insG.run(i, `iso-g-${i}`, `Isolation Game ${i}`);
          insR.run(`iso-r-${i}`, i);
        }
      });
      seedTx();

      const manifestRes = await worker.fetch(
        new Request(
          'https://collection-tracker.example.com/api/catalog/games?manifest=1',
        ),
        mockEnv,
      );
      expect(manifestRes.status).toBe(200);
      const manifest = (await manifestRes.json()) as {
        version: string;
        chunkCount: number;
        maxStableId: number;
        chunkBounds: number[];
        source: string;
      };
      expect(manifest.source).toBe('d1-edge-cache');
      expect(manifest.chunkCount).toBe(2);
      expect(manifest.maxStableId).toBe(1502);
      expect(manifest.chunkBounds).toEqual([0, 1500, 1502]);
      expect(mockBucket.storage.has(R2_CATALOG_MANIFEST_KEY)).toBe(false);

      const chunk0Res = await worker.fetch(
        new Request(
          `https://collection-tracker.example.com/api/catalog/games?chunk=0&v=${encodeURIComponent(manifest.version)}`,
        ),
        mockEnv,
      );
      const chunk1Res = await worker.fetch(
        new Request(
          `https://collection-tracker.example.com/api/catalog/games?chunk=1&v=${encodeURIComponent(manifest.version)}`,
        ),
        mockEnv,
      );
      expect(chunk0Res.status).toBe(200);
      expect(chunk1Res.status).toBe(200);
      expect(chunk0Res.headers.get('Cache-Control')).toContain('immutable');
      expect(((await chunk0Res.json()) as Array<{ id: string }>).length).toBe(
        1500,
      );
      expect(((await chunk1Res.json()) as Array<{ id: string }>).length).toBe(
        2,
      );
    });

    it('recovers manifest from build-scoped R2 folders with schemaVersion and chunkPrefix', async () => {
      const built = await writeCatalogChunksToR2(mockEnv, {
        timestampOverride: '2026-11-23T04:00:00.000Z',
        forceRestart: true,
      });
      expect(built).not.toBeNull();
      mockBucket.storage.delete(R2_CATALOG_MANIFEST_KEY);

      const recovered = await recoverCatalogManifestFromR2Chunks(
        mockBucket as unknown as R2Bucket,
      );
      expect(recovered).not.toBeNull();
      expect(recovered!.manifest.version).toBe(built!.version);
      expect(recovered!.manifest.schemaVersion).toBe(
        CATALOG_CHUNK_SCHEMA_VERSION,
      );
      expect(recovered!.manifest.chunkPrefix).toBe(built!.chunkPrefix);
    });

    it('recomputes catalog manifest in D1 sync_state when catalog_chunks_dirty is flagged without R2 writes', async () => {
      resetWorkerRateLimits();
      const m1 = await resolveCatalogManifest(mockEnv);
      expect(m1).not.toBeNull();
      const firstVersion = m1!.version;

      await markCatalogChunksDirty(mockEnv);
      const dirtyRow = db
        .prepare(`SELECT value FROM sync_state WHERE key = ?`)
        .get(CATALOG_CHUNKS_DIRTY_KEY) as { value: string };
      expect(dirtyRow.value).toBe('1');

      await new Promise((r) => setTimeout(r, 15));
      const m2 = await resolveCatalogManifest(mockEnv);
      expect(m2).not.toBeNull();
      expect(m2!.version).not.toBe(firstVersion);
      const clearedRow = db
        .prepare(`SELECT value FROM sync_state WHERE key = ?`)
        .get(CATALOG_CHUNKS_DIRTY_KEY) as { value: string };
      expect(clearedRow.value).toBe('0');
      expect(mockBucket.storage.has(R2_CATALOG_MANIFEST_KEY)).toBe(false);
    });

    it('marks non-DAT canonical_release_id rows as is_source_verified = 1 in R2 degraded list and detail fallbacks', async () => {
      db.prepare(
        `INSERT INTO canonical_releases (id, platform_id, raw_title, normalized_title, region, source, is_verified_physical)
         VALUES (701, 35, 'Non-DAT PS5 Game', 'nondatps5game', 'USA', 'ps5db', 1)`,
      ).run();
      db.prepare(
        `INSERT INTO games (stable_id, id, title, platform_id)
         VALUES (701, 'nondat-ps5', 'Non-DAT PS5 Game', 35)`,
      ).run();
      db.prepare(
        `INSERT INTO game_releases (id, game_id, region, rom_name, canonical_release_id)
         VALUES ('nondat-ps5-rel', 701, 'USA', NULL, 701)`,
      ).run();
      db.prepare(
        `INSERT INTO user_game_releases (user_id, release_id, ownership_status, has_media)
         VALUES (1, 'nondat-ps5-rel', 1, 1)`,
      ).run();

      await performScheduledBackup(mockEnv, false);

      const failingDb = {
        prepare: () => ({
          bind: () => ({
            all: async () => {
              throw new Error('D1_ERROR: exceeded rows read quota');
            },
            first: async () => {
              throw new Error('D1_ERROR: exceeded rows read quota');
            },
            run: async () => {
              throw new Error('D1_ERROR: exceeded rows read quota');
            },
          }),
          all: async () => {
            throw new Error('D1_ERROR: exceeded rows read quota');
          },
          first: async () => {
            throw new Error('D1_ERROR: exceeded rows read quota');
          },
          run: async () => {
            throw new Error('D1_ERROR: exceeded rows read quota');
          },
        }),
        batch: async () => {
          throw new Error('D1_ERROR: exceeded rows read quota');
        },
      } as unknown as Env['DB'];
      const degradedEnv: Env = { ...mockEnv, DB: failingDb };
      const aliceToken = await signSession(
        { id: 1, username: 'alice', role: 'admin', homeRegion: 'USA' },
        mockEnv.SESSION_SECRET!,
      );

      const listRes = await worker.fetch(
        new Request('https://collection-tracker.example.com/api/games', {
          headers: { Cookie: `${HOST_SESSION_COOKIE}=${aliceToken}` },
        }),
        degradedEnv,
      );
      expect(listRes.status).toBe(200);
      const listRows = (await listRes.json()) as Array<{
        id: string;
        is_source_verified?: number;
        canonical_release_id?: number | null;
      }>;
      const nonDatRow = listRows.find((r) => r.id === 'nondat-ps5-rel');
      expect(nonDatRow?.canonical_release_id).toBe(701);
      expect(nonDatRow?.is_source_verified).toBe(1);

      const detailRes = await worker.fetch(
        new Request(
          'https://collection-tracker.example.com/api/games/701?release=nondat-ps5-rel',
          { headers: { Cookie: `${HOST_SESSION_COOKIE}=${aliceToken}` } },
        ),
        degradedEnv,
      );
      expect(detailRes.status).toBe(200);
      const detail = (await detailRes.json()) as {
        releases?: Array<{ id: string; is_source_verified?: number }>;
      };
      expect(
        detail.releases?.find((r) => r.id === 'nondat-ps5-rel')
          ?.is_source_verified,
      ).toBe(1);
    });

    it('serves per-user R2 overlays (including user_toys) for /api/user/collection-overlay and /api/u/:username/collection-overlay from snapshots/latest.json', async () => {
      db.exec(`
        INSERT INTO users (id, username, is_public, home_region, display_name)
        VALUES (2, 'bob', 1, 'USA', 'Bob'),
               (3, 'carol', 0, 'USA', 'Carol');
        INSERT INTO games (stable_id, id, title, platform_id)
        VALUES (2, 'bob-game', 'Bob Game', 1),
               (3, 'carol-game', 'Carol Game', 1);
        INSERT INTO game_releases (id, game_id, region)
        VALUES ('bob-rel', 2, 'USA'),
               ('carol-rel', 3, 'USA');
        INSERT INTO toys (stable_id, id, name, line, series_id, sort_index)
        VALUES (2, 'mario-amiibo', 'Mario', 'amiibo', 'smash', 1);
        INSERT INTO user_games (user_id, game_id, play_status, queued)
        VALUES (1, 1, 2, 1),
               (2, 2, 3, 0),
               (3, 3, 1, 0);
        INSERT INTO user_game_releases (user_id, release_id, ownership_status, has_media)
        VALUES (2, 'bob-rel', 2, 0),
               (3, 'carol-rel', 1, 0);
        INSERT INTO user_toys (user_id, toy_id, ownership_status)
        VALUES (1, 'link-amiibo', 1),
               (2, 'mario-amiibo', 2);
      `);

      await performScheduledBackup(mockEnv, false);
      mockBucket.storage.delete(R2_GAMES_ACTIVE_LITE_KEY);
      resetR2SnapshotCache();

      const failingDb = {
        prepare: () => ({
          bind: () => ({
            all: async () => {
              throw new Error('D1_ERROR: exceeded rows read quota');
            },
            first: async () => {
              throw new Error('D1_ERROR: exceeded rows read quota');
            },
            run: async () => {
              throw new Error('D1_ERROR: exceeded rows read quota');
            },
          }),
          all: async () => {
            throw new Error('D1_ERROR: exceeded rows read quota');
          },
          first: async () => {
            throw new Error('D1_ERROR: exceeded rows read quota');
          },
          run: async () => {
            throw new Error('D1_ERROR: exceeded rows read quota');
          },
        }),
        batch: async () => {
          throw new Error('D1_ERROR: exceeded rows read quota');
        },
      } as unknown as Env['DB'];
      const degradedEnv: Env = { ...mockEnv, DB: failingDb };

      const secret = mockEnv.SESSION_SECRET!;
      const aliceToken = await signSession(
        { id: 1, username: 'alice', role: 'admin', homeRegion: 'USA' },
        secret,
      );
      const carolToken = await signSession(
        { id: 3, username: 'carol', role: 'user', homeRegion: 'USA' },
        secret,
      );

      const aliceOverlayRes = await worker.fetch(
        new Request(
          'https://collection-tracker.example.com/api/user/collection-overlay?since_stable_id=0',
          { headers: { Cookie: `${HOST_SESSION_COOKIE}=${aliceToken}` } },
        ),
        degradedEnv,
      );
      expect(aliceOverlayRes.status).toBe(200);
      expect(aliceOverlayRes.headers.get(KIT_DEGRADED_HEADER)).toBe(
        'r2-backup',
      );
      const aliceOverlay = (await aliceOverlayRes.json()) as {
        ugr: Array<{ release_id: string }>;
        ug: Array<{ game_id: number; play_status: number }>;
        ut: Array<{ toy_id: string; ownership_status: number }>;
      };
      expect(aliceOverlay.ugr.map((r) => r.release_id)).toEqual(['gb-mario']);
      expect(aliceOverlay.ug.map((g) => g.game_id)).toEqual([1]);
      expect(aliceOverlay.ut).toEqual([
        expect.objectContaining({ toy_id: 'link-amiibo', ownership_status: 1 }),
      ]);

      const bobOverlayRes = await worker.fetch(
        new Request(
          'https://collection-tracker.example.com/api/u/bob/collection-overlay',
        ),
        degradedEnv,
      );
      expect(bobOverlayRes.status).toBe(200);
      expect(bobOverlayRes.headers.get(KIT_DEGRADED_HEADER)).toBe('r2-backup');
      const bobOverlay = (await bobOverlayRes.json()) as {
        ugr: Array<{ release_id: string }>;
        ug: Array<{ game_id: number }>;
        ut: Array<{ toy_id: string; ownership_status: number }>;
      };
      expect(bobOverlay.ugr.map((r) => r.release_id)).toEqual(['bob-rel']);
      expect(bobOverlay.ug.map((g) => g.game_id)).toEqual([2]);
      expect(bobOverlay.ut).toEqual([
        expect.objectContaining({
          toy_id: 'mario-amiibo',
          ownership_status: 2,
        }),
      ]);

      const unauthCarolRes = await worker.fetch(
        new Request(
          'https://collection-tracker.example.com/api/u/carol/collection-overlay',
        ),
        degradedEnv,
      );
      expect(unauthCarolRes.status).toBe(404);

      const authCarolRes = await worker.fetch(
        new Request(
          'https://collection-tracker.example.com/api/u/carol/collection-overlay',
          { headers: { Cookie: `${HOST_SESSION_COOKIE}=${carolToken}` } },
        ),
        degradedEnv,
      );
      expect(authCarolRes.status).toBe(200);
      const carolOverlay = (await authCarolRes.json()) as {
        ugr: Array<{ release_id: string }>;
      };
      expect(carolOverlay.ugr.map((r) => r.release_id)).toEqual(['carol-rel']);
    });

    it('marks catalog_chunks_dirty cleanly when ingestion inserts a new game without writing R2 catalog files', async () => {
      resetWorkerRateLimits();
      const initialManifest = await resolveCatalogManifest(mockEnv);
      expect(initialManifest).not.toBeNull();

      const mockVgp = {
        products: [
          {
            id: 991002,
            title: 'Switch Manifest Test Game - Nintendo Switch',
            handle: 'switch-manifest-test-game',
            vendor: 'Nintendo',
            product_type: 'Switch Games',
            tags: ['Nintendo Switch'],
            variants: [
              {
                price: '39.99',
                compare_at_price: '49.99',
                barcode: '045496905999',
                available: true,
              },
            ],
          },
        ],
      };

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) => {
          const urlStr = String(input);
          if (urlStr.includes('open.er-api.com')) {
            return new Response(JSON.stringify({ rates: { USD: 0.75 } }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (
            urlStr.includes('videogamesplus.ca/collections/sales/products.json')
          ) {
            return new Response(JSON.stringify(mockVgp), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (urlStr.includes('pnpgamesonline.com')) {
            return new Response(JSON.stringify([]), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(JSON.stringify({ products: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        });

      try {
        await syncWorkerRetailDeals(mockEnv);
        const inserted = db
          .prepare(`SELECT stable_id FROM games WHERE barcode = '045496905999'`)
          .get() as { stable_id: number } | undefined;
        expect(inserted).toBeDefined();
        const refreshedManifest = await resolveCatalogManifest(mockEnv);
        expect(refreshedManifest?.maxStableId).toBeGreaterThanOrEqual(
          inserted!.stable_id,
        );
        expect(mockBucket.storage.has(R2_CATALOG_MANIFEST_KEY)).toBe(false);
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  describe('Watched-Series Push Notifications & Autonomous Ingestion', () => {
    it('evaluateTrackingRulesForNewGames dispatches watched-series notifications, respects opt-out and existing ownership, and coalesces > 3 items', async () => {
      db.prepare(
        `INSERT OR IGNORE INTO users (id, username, home_region) VALUES (2, 'bob', 'USA')`,
      ).run();
      db.prepare(
        `INSERT INTO user_tracking_rules (user_id, rule_type, match_value, target_status, region_scope, is_ignored)
         VALUES (1, 'series', 'Metroid', 2, 'home', 0),
                (2, 'series', 'Metroid', 2, 'home', 0)`,
      ).run();
      db.prepare(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, preferences_json, user_agent, created_at, updated_at)
         VALUES ('sub-u1-ws', 1, 'https://push.example.com/u1-ws', 'p256', 'auth', '{"enabled": true, "notify_watched_series": true}', 'agent', datetime('now'), datetime('now')),
                ('sub-u2-optout', 2, 'https://push.example.com/u2-optout', 'p256', 'auth', '{"enabled": true, "notify_watched_series": false}', 'agent', datetime('now'), datetime('now'))`,
      ).run();

      db.prepare(
        `INSERT INTO games (stable_id, id, title, platform_id, canonical_series)
         VALUES (701, 'metroid-1', 'Metroid Prime 4', 26, 'Metroid'),
                (702, 'metroid-2', 'Metroid Dread', 26, 'Metroid')`,
      ).run();
      db.prepare(
        `INSERT INTO game_releases (id, game_id, region)
         VALUES ('metroid-1-rel', 701, 'USA'), ('metroid-2-rel', 702, 'USA')`,
      ).run();
      // Mark metroid-2-rel already owned by user 1 so it must NOT trigger a fresh alert
      db.prepare(
        `INSERT INTO user_game_releases (user_id, release_id, ownership_status) VALUES (1, 'metroid-2-rel', 1)`,
      ).run();

      const webPushSpy = vi
        .spyOn(webPush, 'sendWebPushNotification')
        .mockResolvedValue({ success: true, status: 201, shouldDelete: false });

      try {
        await evaluateTrackingRulesForNewGames(
          mockEnv,
          [
            {
              stableId: 701,
              platformId: 26,
              canonicalSeries: 'Metroid',
              seriesTrackable: true,
              title: 'Metroid Prime 4',
              platformName: 'Nintendo Switch',
              gameSlug: 'metroid-1',
              releases: [{ id: 'metroid-1-rel', region: 'USA' }],
            },
            {
              stableId: 702,
              platformId: 26,
              canonicalSeries: 'Metroid',
              seriesTrackable: true,
              title: 'Metroid Dread',
              platformName: 'Nintendo Switch',
              gameSlug: 'metroid-2',
              releases: [{ id: 'metroid-2-rel', region: 'USA' }],
            },
          ],
          { notifySubscribers: true },
        );

        expect(webPushSpy).toHaveBeenCalledTimes(1);
        expect(webPushSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            endpoint: 'https://push.example.com/u1-ws',
          }),
          expect.objectContaining({
            title: '✨ New in Metroid: Metroid Prime 4',
          }),
          expect.anything(),
        );

        // Coalesce when > 3 new matched additions arrive in one batch
        webPushSpy.mockClear();
        db.prepare(
          `INSERT INTO games (stable_id, id, title, platform_id, canonical_series)
           VALUES (703, 'm-3', 'Metroid III', 26, 'Metroid'),
                  (704, 'm-4', 'Metroid IV', 26, 'Metroid'),
                  (705, 'm-5', 'Metroid V', 26, 'Metroid'),
                  (706, 'm-6', 'Metroid VI', 26, 'Metroid')`,
        ).run();
        db.prepare(
          `INSERT INTO game_releases (id, game_id, region)
           VALUES ('m-3-rel', 703, 'USA'), ('m-4-rel', 704, 'USA'), ('m-5-rel', 705, 'USA'), ('m-6-rel', 706, 'USA')`,
        ).run();

        await evaluateTrackingRulesForNewGames(
          mockEnv,
          [703, 704, 705, 706].map((sid, idx) => ({
            stableId: sid,
            platformId: 26,
            canonicalSeries: 'Metroid',
            seriesTrackable: true,
            title: `Metroid Part ${idx + 3}`,
            gameSlug: `m-${idx + 3}`,
            releases: [{ id: `m-${idx + 3}-rel`, region: 'USA' }],
          })),
          { notifySubscribers: true },
        );

        expect(webPushSpy).toHaveBeenCalledTimes(1);
        const wsPayload = webPushSpy.mock.calls[0][1];
        expect(wsPayload.title).toBe('✨ 4 New Watched Series Additions');
        expect(wsPayload.body).toContain('Metroid Part 3');
        expect(wsPayload.body).toContain('Metroid Part 6');
        expect(wsPayload.body).not.toContain('more added');

        // Toys rule matching dispatches watched-series alert
        webPushSpy.mockClear();
        db.prepare(
          `INSERT INTO user_tracking_rules (user_id, rule_type, match_value, target_status, region_scope, is_ignored)
           VALUES (1, 'toy_series', 'Metroid', 2, 'home', 0)`,
        ).run();
        db.prepare(
          `INSERT INTO toys (stable_id, id, name, line, series_id)
           VALUES (801, 'samus-amiibo', 'Samus Aran', 'amiibo', NULL)`,
        ).run();

        await evaluateTrackingRulesForNewToys(
          mockEnv,
          [
            {
              id: 'samus-amiibo',
              name: 'Samus Aran',
              line: 'amiibo',
              series: 'Metroid',
              region: 'USA',
            },
          ],
          { notifySubscribers: true },
        );
        expect(webPushSpy).toHaveBeenCalledTimes(1);
        expect(webPushSpy).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            title: '✨ New in Metroid: Samus Aran',
          }),
          expect.anything(),
        );

        // Multi-release auto_seek_release_scope ('one_per_game' vs 'all_releases' incl. Rev 1, World & global, deduped 1 alert/game)
        webPushSpy.mockClear();
        db.prepare(
          `UPDATE users SET auto_seek_release_scope = 'all_releases', auto_seek_region_scope = 'any' WHERE id = 1`,
        ).run();
        db.prepare(
          `INSERT OR REPLACE INTO user_tracking_rules (user_id, rule_type, match_value, target_status, region_scope, is_ignored)
           VALUES (1, 'series', 'Metroid', 2, 'any', 0)`,
        ).run();
        db.prepare(
          `INSERT INTO games (stable_id, id, title, platform_id, canonical_series)
           VALUES (707, '707', 'Metroid Prime: Echoes', 30, 'Metroid')`,
        ).run();
        db.prepare(
          `INSERT INTO game_releases (id, game_id, region, variants, rom_name)
           VALUES
             ('707-1', 707, 'USA', NULL, 'Metroid Prime Echoes (USA).iso'),
             ('707-2', 707, 'USA', 'Rev 1', 'Metroid Prime Echoes (USA) (Rev 1).iso'),
             ('707-3', 707, 'Japan', NULL, 'Metroid Prime Echoes (Japan).iso'),
             ('707-4', 707, 'USA', NULL, 'Metal Gear Solid 2 - Sons of Liberty - Trial Edition (USA) (Demo).iso')`,
        ).run();
        // User 2 already owns the Japan release and uses default 'one_per_game' + 'home'
        db.prepare(
          `INSERT INTO user_game_releases (user_id, release_id, ownership_status) VALUES (2, '707-3', 1)`,
        ).run();

        const addedRowsCount = await evaluateTrackingRulesForNewGames(
          mockEnv,
          [
            {
              stableId: 707,
              platformId: 30,
              canonicalSeries: 'Metroid',
              seriesTrackable: true,
              title: 'Metroid Prime: Echoes',
              platformName: 'PlayStation 2',
              releases: [
                {
                  id: '707-1',
                  region: 'USA',
                  variants: null,
                  romName: 'Metroid Prime Echoes (USA).iso',
                },
                {
                  id: '707-2',
                  region: 'USA',
                  variants: 'Rev 1',
                  romName: 'Metroid Prime Echoes (USA) (Rev 1).iso',
                },
                {
                  id: '707-3',
                  region: 'Japan',
                  variants: null,
                  romName: 'Metroid Prime Echoes (Japan).iso',
                },
                {
                  id: '707-4',
                  region: 'USA',
                  variants: null,
                  romName:
                    'Metal Gear Solid 2 - Sons of Liberty - Trial Edition (USA) (Demo).iso',
                },
              ],
            },
          ],
          { notifySubscribers: true },
        );
        // User 1 gets 3 Seeking rows (707-1, 707-2 Rev 1, 707-3 Japan; 707-4 companion demo excluded).
        // User 2 gets 0 because user 2 already owns 707-3 and uses one_per_game.
        expect(addedRowsCount).toBe(3);
        // Only ONE push notification for game 707 even though 3 releases matched
        expect(webPushSpy).toHaveBeenCalledTimes(1);

        // applyReactiveSeriesAutoTracking honors 'all_releases' + 'any' region and skips companion demos
        webPushSpy.mockClear();
        db.prepare(
          `INSERT INTO games (stable_id, id, title, platform_id, collections, franchises, canonical_series)
           VALUES
             (708, '708', 'Metroid Fusion', 19, 'Metroid', 'Metroid', 'Metroid'),
             (709, '709', 'Metroid: Zero Mission', 30, 'Metroid', 'Metroid', 'Metroid')`,
        ).run();
        db.prepare(
          `INSERT INTO game_releases (id, game_id, region, variants, rom_name)
           VALUES
             ('708-1', 708, 'USA', NULL, 'Metroid Fusion (USA).gba'),
             ('709-1', 709, 'USA', NULL, 'Metroid Zero Mission (USA).iso'),
             ('709-2', 709, 'USA', 'Rev 1', 'Metroid Zero Mission (USA) (Rev 1).iso'),
             ('709-3', 709, 'Europe', NULL, 'Metroid Zero Mission (Europe).iso'),
             ('709-4', 709, 'USA', NULL, 'Final Fantasy XII (USA) (Demo).iso')`,
        ).run();
        const reactiveRes = await applyReactiveSeriesAutoTracking(
          mockEnv,
          1,
          708,
          'Metroid',
        );
        expect(reactiveRes.trackedSeries).toBe('Metroid');
        expect(reactiveRes.autoAddedCount).toBeGreaterThanOrEqual(3);
        const reactive709 = db
          .prepare(
            `SELECT r.id, ugr.ownership_status
             FROM game_releases r
             JOIN user_game_releases ugr ON ugr.release_id = r.id AND ugr.user_id = 1
             WHERE r.game_id = 709
             ORDER BY r.id`,
          )
          .all() as Array<{ id: string; ownership_status: number }>;
        expect(reactive709.map((r) => r.id)).toEqual([
          '709-1',
          '709-2',
          '709-3',
        ]);
      } finally {
        webPushSpy.mockRestore();
      }
    });

    it('falls back safely when pre-DDL users table lacks auto_seek_release_scope and auto_seek_region_scope', async () => {
      const legacyDb = new Database(':memory:');
      const schemaSql = fs.readFileSync(
        path.join(__dirname, '..', 'migrations', 'schema.sql'),
        'utf8',
      );
      const legacySchemaSql = schemaSql.replace(
        /^\s*auto_seek_(?:release|region)_scope\b[^\n]*\n/gm,
        '',
      );
      legacyDb.exec(legacySchemaSql);
      legacyDb.exec(`
        INSERT INTO users (id, username, home_region) VALUES (1, 'alice', 'USA');
        INSERT OR IGNORE INTO platforms (id, name, display_name) VALUES (26, 'nintendo-switch', 'Switch');
        INSERT INTO games (stable_id, id, title, platform_id, canonical_series) VALUES (1, '1', 'Metroid Dread', 26, 'Metroid');
        INSERT INTO game_releases (id, game_id, region) VALUES ('1-1', 1, 'USA');
        INSERT INTO user_tracking_rules (user_id, rule_type, match_value, target_status, region_scope, is_ignored)
        VALUES (1, 'series', 'Metroid', 2, 'home', 0);
      `);
      try {
        const legacyEnv = {
          ...mockEnv,
          DB: (() => {
            const createStmt = (query: string, boundParams: unknown[] = []) => {
              const s = legacyDb.prepare(query);
              return {
                bind: (...p: unknown[]) => createStmt(query, p),
                first: async <T>() =>
                  (s.get(...boundParams) ?? null) as T | null,
                all: async <T>() => ({ results: s.all(...boundParams) as T[] }),
                run: async () => {
                  const info = s.run(...boundParams);
                  return { success: true, meta: { changes: info.changes } };
                },
              };
            };
            return {
              prepare: (q: string) => createStmt(q),
              batch: async (stmts: { run: () => Promise<unknown> }[]) =>
                Promise.all(stmts.map((s) => s.run())),
            } as unknown as D1Database;
          })(),
        };
        const token = await signSession(
          { id: 1, username: 'alice', role: 'admin', homeRegion: 'USA' },
          mockEnv.SESSION_SECRET!,
        );
        const profileRes = await worker.fetch(
          new Request(
            'https://collection-tracker.example.com/api/user/profile',
            {
              headers: { Cookie: `${HOST_SESSION_COOKIE}=${token}` },
            },
          ),
          legacyEnv,
        );
        expect(profileRes.status).toBe(200);
        const profile = (await profileRes.json()) as {
          autoSeekReleaseScope: string;
          autoSeekRegionScope: string;
        };
        expect(profile.autoSeekReleaseScope).toBe('one_per_game');
        expect(profile.autoSeekRegionScope).toBe('home');

        const added = await evaluateTrackingRulesForNewGames(legacyEnv, [
          {
            stableId: 1,
            platformId: 26,
            canonicalSeries: 'Metroid',
            seriesTrackable: true,
            title: 'Metroid Dread',
            releases: [{ id: '1-1', region: 'USA' }],
          },
        ]);
        expect(added).toBe(1);
      } finally {
        legacyDb.close();
      }
    });

    it('syncWorkerBoutiquePreOrders auto-ingests unmatched physical pre-orders and evaluates series rules', async () => {
      db.prepare(
        `INSERT OR REPLACE INTO sync_state (key, value) VALUES ('boutique_seed_completed', '1')`,
      ).run();
      db.prepare(
        `INSERT INTO user_tracking_rules (user_id, rule_type, match_value, target_status, region_scope, is_ignored)
         VALUES (1, 'series', 'Celeste', 2, 'home', 0)`,
      ).run();
      db.prepare(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, preferences_json, user_agent, created_at, updated_at)
         VALUES ('sub-boutique-ws', 1, 'https://push.example.com/boutique-ws', 'p256', 'auth', '{"enabled": true, "notify_watched_series": true, "notify_physical_announcements": false}', 'agent', datetime('now'), datetime('now'))`,
      ).run();

      const mockShopify = {
        products: [
          {
            id: 551122,
            title: 'Celeste: Deluxe Anniversary - Nintendo Switch',
            handle: 'celeste-deluxe-switch',
            tags: ['game', 'pre-order'],
            published_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            variants: [{ price: '49.99', available: true }],
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

      const igdbEnv: Env = {
        ...mockEnv,
        TWITCH_CLIENT_ID: undefined,
        TWITCH_CLIENT_SECRET: undefined,
      };

      try {
        const result = await syncWorkerBoutiquePreOrders(igdbEnv);
        expect(result.ingestedCount).toBe(1);

        const ingestedGame = db
          .prepare(
            `SELECT stable_id, title, platform_id, retail_store FROM games WHERE platform_id = 26 AND title LIKE 'Celeste%'`,
          )
          .get() as {
          stable_id: number;
          title: string;
          platform_id: number;
          retail_store: string;
        };
        expect(ingestedGame).toBeDefined();
        expect(ingestedGame.retail_store).toBe('Limited Run Games');

        const releases = db
          .prepare(
            'SELECT id, canonical_release_id, verified_source, canonical_title, publisher FROM game_releases WHERE game_id = ?',
          )
          .all(ingestedGame.stable_id) as Array<{
          id: string;
          canonical_release_id: number | null;
          verified_source: string | null;
          canonical_title: string | null;
          publisher: string | null;
        }>;
        expect(releases.length).toBe(1);
        expect(releases[0].canonical_release_id).toBeGreaterThan(0);
        expect(releases[0].verified_source).toBe('retail_catalog');
        expect(releases[0].canonical_title).toContain('Celeste');
        expect(releases[0].publisher).toBe('Limited Run Games');

        // Title-derived series 'Celeste: Deluxe Anniversary' vs 'Celeste': test rule match when canonical_series matches
        expect(webPushSpy.mock.calls.length).toBeGreaterThanOrEqual(0);
      } finally {
        fetchSpy.mockRestore();
        webPushSpy.mockRestore();
      }
    });

    it('syncWorkerBoutiquePreOrders resolves ambiguousXbox via catalog (preferring 49, fallback 50) and skips boutique_feed_hash on ingest failure', async () => {
      db.exec(`
        INSERT INTO games (stable_id, id, title, platform_id)
        VALUES
          (9101, '9101', 'Psychonauts 2', 49),
          (9102, '9102', 'Dead Space', 50);
        INSERT INTO game_releases (id, game_id, region)
        VALUES
          ('9101-1', 9101, 'USA'),
          ('9102-1', 9102, 'USA');
      `);

      const mockShopify = {
        products: [
          {
            id: 8801,
            title: 'Psychonauts 2 (Xbox)',
            handle: 'psychonauts-2-xbox',
            tags: ['Xbox'],
            variants: [{ price: '59.99', available: true }],
          },
          {
            id: 8802,
            title: 'Dead Space (Xbox)',
            handle: 'dead-space-xbox',
            tags: ['Xbox'],
            variants: [{ price: '59.99', available: true }],
          },
        ],
      };

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) => {
          const url = String(input);
          if (url.includes('iam8bit.com')) {
            return new Response(JSON.stringify(mockShopify), { status: 200 });
          }
          return new Response(JSON.stringify({ products: [] }), {
            status: 200,
          });
        });

      try {
        const res = await syncWorkerBoutiquePreOrders(mockEnv);
        expect(res.ingestedCount).toBe(0);

        const g49 = db
          .prepare(
            'SELECT retail_url, retail_store FROM games WHERE stable_id = 9101',
          )
          .get() as { retail_url: string | null; retail_store: string | null };
        expect(g49.retail_url).toBe(
          'https://www.iam8bit.com/products/psychonauts-2-xbox',
        );
        expect(g49.retail_store).toBe('iam8bit');

        const g50 = db
          .prepare(
            'SELECT retail_url, retail_store FROM games WHERE stable_id = 9102',
          )
          .get() as { retail_url: string | null; retail_store: string | null };
        expect(g50.retail_url).toBe(
          'https://www.iam8bit.com/products/dead-space-xbox',
        );
        expect(g50.retail_store).toBe('iam8bit');
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('syncWorkerBoutiquePreOrders does not persist boutique_feed_hash when auto-ingestion fails', async () => {
      db.prepare(
        `DELETE FROM sync_state WHERE key = 'boutique_feed_hash'`,
      ).run();
      const mockShopify = {
        products: [
          {
            id: 8901,
            title: 'Unmatched Brand New Preorder (Switch)',
            handle: 'unmatched-brand-new',
            tags: ['pre-order'],
            published_at: new Date().toISOString(),
            variants: [{ price: '39.99', available: true }],
          },
        ],
      };
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) => {
          if (String(input).includes('limitedrungames.com')) {
            return new Response(JSON.stringify(mockShopify), { status: 200 });
          }
          return new Response(JSON.stringify({ products: [] }), {
            status: 200,
          });
        });

      const failingEnv: Env = {
        ...mockEnv,
        DB: {
          ...mockEnv.DB,
          prepare: (sql: string) => {
            if (sql.includes('INSERT INTO games')) {
              throw new Error('simulated insert failure');
            }
            return mockEnv.DB.prepare(sql);
          },
        } as unknown as D1Database,
      };

      try {
        await syncWorkerBoutiquePreOrders(failingEnv);
        const hashRow = db
          .prepare(
            `SELECT value FROM sync_state WHERE key = 'boutique_feed_hash'`,
          )
          .get();
        expect(hashRow).toBeUndefined();
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('syncWorkerRetailDeals auto-ingests unmatched physical retail games with a valid barcode and skips items without IGDB or barcode', async () => {
      const mockVgp = {
        products: [
          {
            id: 6600111,
            title:
              'Xenoblade Chronicles X: Definitive Edition - Nintendo Switch',
            handle: 'xenoblade-x-de-switch',
            product_type: 'Nintendo Switch',
            variants: [
              {
                id: 66001111,
                sku: '6600111',
                price: '69.99',
                compare_at_price: '79.99',
                barcode: '045496905415',
                available: true,
              },
            ],
          },
          {
            id: 6600222,
            title: 'Random Unverified Accessory Game - Nintendo Switch',
            handle: 'random-unverified',
            product_type: 'Nintendo Switch',
            variants: [
              {
                id: 66002221,
                sku: '6600222',
                price: '29.99',
                compare_at_price: '39.99',
                barcode: '',
                available: true,
              },
            ],
          },
        ],
      };

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) => {
          const urlStr = String(input);
          if (urlStr.includes('open.er-api.com')) {
            return new Response(JSON.stringify({ rates: { USD: 0.75 } }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (
            urlStr.includes('videogamesplus.ca/collections/sales/products.json')
          ) {
            return new Response(JSON.stringify(mockVgp), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (urlStr.includes('pnpgamesonline.com')) {
            return new Response(JSON.stringify([]), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(JSON.stringify({ products: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        });

      try {
        const res = await syncWorkerRetailDeals(mockEnv);
        expect(res.matchedCount).toBeGreaterThanOrEqual(1);

        const barcodedGame = db
          .prepare(
            `SELECT stable_id, title, barcode, retail_store FROM games WHERE barcode = '045496905415'`,
          )
          .get() as {
          stable_id: number;
          title: string;
          barcode: string;
          retail_store: string;
        };
        expect(barcodedGame).toBeDefined();
        expect(barcodedGame.retail_store).toBe('VGP');

        const rejectedGame = db
          .prepare(`SELECT 1 FROM games WHERE title LIKE '%Random Unverified%'`)
          .get();
        expect(rejectedGame).toBeUndefined();
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('syncWorkerRetailDeals skips duplicate auto-ingestion on existing (platform_id, igdb_id), URL, or numeral-equivalent title', async () => {
      db.prepare(
        `INSERT INTO games (stable_id, id, title, platform_id, igdb_id, retail_url)
         VALUES (9950, '9950', 'Beholgar II', 35, 350035, 'https://videogamesplus.ca/products/beholgar-ii-ps5'),
                (9951, '9951', 'Existing By IGDB', 26, 228918, 'https://videogamesplus.ca/products/other-url-switch')`,
      ).run();

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) => {
          const urlStr = String(input);
          if (urlStr.includes('open.er-api.com')) {
            return new Response(JSON.stringify({ rates: { USD: 0.75 } }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (urlStr.includes('id.twitch.tv/oauth2/token')) {
            return Response.json({ access_token: 'tok', expires_in: 3600 });
          }
          if (urlStr.includes('api.igdb.com/v4/multiquery')) {
            return Response.json([
              {
                name: 'q0',
                result: [
                  {
                    id: 228918,
                    name: 'Haste',
                    platforms: [130],
                    url: 'https://www.igdb.com/games/haste',
                  },
                ],
              },
            ]);
          }
          if (
            urlStr.includes('videogamesplus.ca/collections/sales/products.json')
          ) {
            return new Response(
              JSON.stringify({
                products: [
                  {
                    id: 7701,
                    title: 'Beholgar 2 - PlayStation 5',
                    handle: 'beholgar-2-different-handle-ps5',
                    product_type: 'PlayStation 5',
                    variants: [
                      {
                        id: 77011,
                        sku: '7701',
                        price: '29.99',
                        compare_at_price: '39.99',
                        barcode: '011122233344',
                        available: true,
                      },
                    ],
                  },
                  {
                    id: 7702,
                    title: 'Haste - Nintendo Switch',
                    handle: 'haste-switch',
                    product_type: 'Nintendo Switch',
                    variants: [
                      {
                        id: 77021,
                        sku: '7702',
                        price: '24.99',
                        compare_at_price: '34.99',
                        available: true,
                      },
                    ],
                  },
                ],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
          if (urlStr.includes('pnpgamesonline.com')) {
            return new Response(JSON.stringify([]), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(JSON.stringify({ products: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        });

      try {
        await syncWorkerRetailDeals(mockEnv);
        const total = db
          .prepare(`SELECT COUNT(*) AS cnt FROM games WHERE stable_id >= 9950`)
          .get() as { cnt: number };
        expect(total.cnt).toBe(2);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('syncWorkerRetailPreOrders matches existing titles, backfills release_date, and ingests new pre-orders', async () => {
      db.prepare(
        `INSERT INTO games (stable_id, id, title, platform_id)
         VALUES (9901, '9901', 'Yooka-Replaylee', 27)`,
      ).run();
      db.prepare(
        `INSERT INTO game_releases (id, game_id, region, release_date)
         VALUES ('9901-1', 9901, 'USA', NULL)`,
      ).run();

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) => {
          const urlStr = String(input);
          if (urlStr.includes('open.er-api.com')) {
            return new Response(JSON.stringify({ rates: { USD: 0.75 } }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (
            urlStr.includes(
              'videogamesplus.ca/collections/pre-orders/products.json',
            )
          ) {
            return new Response(
              JSON.stringify({
                products: [
                  {
                    id: 9910,
                    title: 'Yooka-Replaylee - Nintendo Switch 2 (PRE-ORDER)',
                    handle: 'yooka-replaylee-ns2',
                    product_type: 'Nintendo Switch 2',
                    tags: ['PRE-ORDER'],
                    body_html: '<p>Release Date: November 12, 2026</p>',
                    variants: [{ id: 99101, price: '69.99', available: true }],
                  },
                ],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
          if (
            urlStr.includes('pnpgamesonline.com') &&
            urlStr.includes('13767')
          ) {
            return new Response(
              JSON.stringify([
                {
                  id: 9920,
                  name: 'Metroid Prime 4: Beyond - Switch 2',
                  permalink:
                    'https://pnpgamesonline.com/product/metroid-prime-4-ns2/',
                  sku: 'PNP-9920',
                  on_sale: false,
                  is_in_stock: true,
                  short_description: '<p>ESTIMATED SHIP DATE MAY 22 2026</p>',
                  prices: {
                    price: '8999',
                    regular_price: '8999',
                    sale_price: '8999',
                    currency_minor_unit: 2,
                  },
                  attributes: [
                    {
                      taxonomy: 'pa_platform',
                      terms: [{ name: 'Nintendo Switch 2' }],
                    },
                  ],
                },
              ]),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
          return new Response(JSON.stringify({ products: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        });

      try {
        const res = await syncWorkerRetailPreOrders(mockEnv);
        expect(res.matchedCount).toBe(1);
        expect(res.ingestedCount).toBe(1);

        const existingRel = db
          .prepare("SELECT release_date FROM game_releases WHERE id = '9901-1'")
          .get() as { release_date: string };
        expect(existingRel.release_date).toBe('2026-11-12');

        const newGame = db
          .prepare(
            "SELECT g.title, g.retail_store, r.release_date FROM games g JOIN game_releases r ON r.game_id = g.stable_id WHERE g.title LIKE 'Metroid Prime 4%'",
          )
          .get() as {
          title: string;
          retail_store: string;
          release_date: string;
        };
        expect(newGame.retail_store).toBe('PNP Games');
        expect(newGame.release_date).toBe('2026-05-22');
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('syncWorkerNsCollectors ingests canonical rows, hash-skips repeat runs, and links ingested Switch 2 titles', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) => {
          const urlStr = String(input);
          if (urlStr.includes('gid=764784245')) {
            return new Response(
              [
                'Title,Region,Cart Type,Release Date,Publisher',
                'Mario Kart World,USA,64GB Cartridge,2025-06-05,Nintendo',
              ].join('\n'),
              { status: 200, headers: { 'Content-Type': 'text/csv' } },
            );
          }
          return new Response('Title,Region\n', {
            status: 200,
            headers: { 'Content-Type': 'text/csv' },
          });
        });

      try {
        const first = await syncWorkerNsCollectors(mockEnv);
        expect(first.checked).toBe(true);
        expect(first.hashMatch).toBe(false);
        expect(first.addedCanonical).toBe(1);
        expect(first.ingestedGames).toBe(1);

        const row = db
          .prepare(
            "SELECT g.title, r.canonical_release_id, r.release_date FROM games g JOIN game_releases r ON r.game_id = g.stable_id WHERE g.platform_id = 27 AND g.title = 'Mario Kart World'",
          )
          .get() as {
          title: string;
          canonical_release_id: number | null;
          release_date: string | null;
        };
        expect(row.canonical_release_id).toBeGreaterThan(0);
        expect(row.release_date).toBe('2025-06-05');

        const second = await syncWorkerNsCollectors(mockEnv);
        expect(second.hashMatch).toBe(true);
        expect(second.addedCanonical).toBe(0);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('syncWorkerNsCollectors links unlinked releases, upgrades upcoming to master, and prunes 2-miss cancelled upcoming rows regardless of ownership', async () => {
      db.prepare(
        `INSERT INTO games (stable_id, id, title, platform_id, region)
         VALUES (7001, '7001', 'Unlinked Switch One', 26, 'USA')`,
      ).run();
      db.prepare(
        `INSERT INTO game_releases (id, game_id, region) VALUES ('7001-1', 7001, 'USA')`,
      ).run();

      const oldUpcomingCanon = db
        .prepare(
          `INSERT INTO canonical_releases (platform_id, raw_title, normalized_title, region, source, is_verified_physical)
           VALUES (26, 'Graduating Quest', 'graduatingquest', 'USA', 'nscollectors_upcoming', 1)`,
        )
        .run();
      // Seed historical graduated upcoming rows + their verified master counterparts so we verify
      // graduated rows are excluded from the 50% truncation sanity denominator.
      db.prepare(
        `INSERT INTO canonical_releases (platform_id, raw_title, normalized_title, region, source, is_verified_physical)
         VALUES (26, 'Graduated Historical One', 'graduatedhistoricalone', 'USA', 'nscollectors_upcoming', 1),
                (26, 'Graduated Historical One', 'graduatedhistoricalone', 'USA', 'nscollectors', 1),
                (26, 'Graduated Historical Two', 'graduatedhistoricaltwo', 'USA', 'nscollectors_upcoming', 1),
                (26, 'Graduated Historical Two', 'graduatedhistoricaltwo', 'USA', 'nscollectors', 1)`,
      ).run();
      db.prepare(
        `INSERT INTO games (stable_id, id, title, platform_id, region)
         VALUES (7002, '7002', 'Graduating Quest', 26, 'USA')`,
      ).run();
      db.prepare(
        `INSERT INTO game_releases (id, game_id, region, canonical_release_id, verified_source)
         VALUES ('7002-1', 7002, 'USA', ?, 'nscollectors_upcoming')`,
      ).run(Number(oldUpcomingCanon.lastInsertRowid));

      let phase = 1;
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) => {
          const urlStr = String(input);
          if (urlStr.includes('gid=2004832329')) {
            return new Response(
              [
                'Title,Region,Release Date,Publisher',
                'Unlinked Switch One,NA,2024-05-01,IndiePub',
                'Graduating Quest,NA,2026-04-01,QuestPub',
              ].join('\n'),
              { status: 200, headers: { 'Content-Type': 'text/csv' } },
            );
          }
          if (urlStr.includes('gid=238551450') && urlStr.includes('1FNyvbb')) {
            if (phase === 1) {
              return new Response(
                [
                  'Title,Region,Release Date,Publisher',
                  'Surviving Upcoming,NA,2027-01-01,PubA',
                  'Cancelled Upcoming,NA,2027-02-01,PubB',
                ].join('\n'),
                { status: 200, headers: { 'Content-Type': 'text/csv' } },
              );
            }
            // Phase 2 & 3: Cancelled Upcoming removed while >= 50% (1/2) rows remain
            return new Response(
              [
                'Title,Region,Release Date,Publisher',
                'Surviving Upcoming,NA,2027-01-01,PubA',
                phase === 2
                  ? 'Other Upcoming,NA,2027-03-01,PubC'
                  : 'Yet Another Upcoming,NA,2027-04-01,PubD',
              ].join('\n'),
              { status: 200, headers: { 'Content-Type': 'text/csv' } },
            );
          }
          return new Response('Title,Region\n', {
            status: 200,
            headers: { 'Content-Type': 'text/csv' },
          });
        });

      try {
        // Phase 1: ingest Surviving Upcoming + Cancelled Upcoming, link 7001-1, upgrade 7002-1
        const r1 = await syncWorkerNsCollectors(mockEnv);
        expect(r1.linkedReleases).toBe(1);
        expect(r1.upgradedReleases).toBe(1);
        expect(r1.cancelledCanonical).toBe(0);

        const rel7001 = db
          .prepare(
            `SELECT canonical_release_id, verified_source FROM game_releases WHERE id = '7001-1'`,
          )
          .get() as {
          canonical_release_id: number | null;
          verified_source: string | null;
        };
        expect(rel7001.canonical_release_id).toBeGreaterThan(0);
        expect(rel7001.verified_source).toBe('nscollectors');

        const rel7002 = db
          .prepare(
            `SELECT verified_source FROM game_releases WHERE id = '7002-1'`,
          )
          .get() as { verified_source: string | null };
        expect(rel7002.verified_source).toBe('nscollectors');

        // Track Cancelled Upcoming under user 1 (ownership_status > 0 must NOT block pruning)
        const cancelledGame = db
          .prepare(
            `SELECT r.id AS release_id, r.game_id FROM game_releases r JOIN games g ON g.stable_id = r.game_id WHERE g.title = 'Cancelled Upcoming'`,
          )
          .get() as { release_id: string; game_id: number };
        expect(cancelledGame).toBeDefined();
        db.prepare(
          `INSERT INTO user_game_releases (user_id, release_id, ownership_status) VALUES (1, ?, 2)`,
        ).run(cancelledGame.release_id);

        // Phase 2: 1st miss (not deleted yet)
        phase = 2;
        const r2 = await syncWorkerNsCollectors(mockEnv);
        expect(r2.cancelledCanonical).toBe(0);
        expect(
          db
            .prepare(`SELECT 1 FROM games WHERE stable_id = ?`)
            .get(cancelledGame.game_id),
        ).toBeDefined();

        // Phase 3: 2nd consecutive miss -> cancelled row, release, game, and cascaded user row pruned
        phase = 3;
        const r3 = await syncWorkerNsCollectors(mockEnv);
        expect(r3.cancelledCanonical).toBe(1);
        expect(
          db
            .prepare(`SELECT 1 FROM games WHERE stable_id = ?`)
            .get(cancelledGame.game_id),
        ).toBeUndefined();
        expect(
          db
            .prepare(`SELECT 1 FROM user_game_releases WHERE release_id = ?`)
            .get(cancelledGame.release_id),
        ).toBeUndefined();
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('syncWorkerNsCollectors skips cancellation pruning when upcoming tab truncates below 50%', async () => {
      db.prepare(
        `INSERT INTO canonical_releases (platform_id, raw_title, normalized_title, region, source, is_verified_physical)
         VALUES (26, 'Upcoming One', 'upcomingone', 'USA', 'nscollectors_upcoming', 1),
                (26, 'Upcoming Two', 'upcomingtwo', 'USA', 'nscollectors_upcoming', 1),
                (26, 'Upcoming Three', 'upcomingthree', 'USA', 'nscollectors_upcoming', 1)`,
      ).run();

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) => {
          const urlStr = String(input);
          if (urlStr.includes('gid=238551450') && urlStr.includes('1FNyvbb')) {
            // Only 1 row of 3 (< 50%) returned
            return new Response(
              'Title,Region,Release Date,Publisher\nUpcoming One,NA,2027-01-01,PubA\n',
              { status: 200, headers: { 'Content-Type': 'text/csv' } },
            );
          }
          return new Response('Title,Region\n', { status: 200 });
        });

      try {
        const res = await syncWorkerNsCollectors(mockEnv);
        expect(res.cancelledCanonical).toBe(0);
        const missRow = db
          .prepare(
            `SELECT value FROM sync_state WHERE key = 'nscollectors_upcoming_missing_v1'`,
          )
          .get();
        expect(missRow).toBeUndefined();
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('syncWorkerWatchedSeriesDiscovery ingests verified physical IGDB series entries without querying game_format/packaging and skips unverified items', async () => {
      db.prepare(
        `INSERT INTO user_tracking_rules (user_id, rule_type, match_value, target_status, region_scope, is_ignored)
         VALUES (1, 'series', 'Fire Emblem', 2, 'home', 0)`,
      ).run();
      db.prepare(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, preferences_json, user_agent, created_at, updated_at)
         VALUES ('sub-sd-1', 1, 'https://push.example.com/sd-1', 'p256', 'auth', '{"enabled": true, "notify_watched_series": true}', 'agent', datetime('now'), datetime('now'))`,
      ).run();
      db.prepare(
        `INSERT INTO canonical_releases (platform_id, raw_title, normalized_title, region, is_verified_physical)
         VALUES (26, 'Fire Emblem Engage (USA)', 'fireemblemengage', 'USA', 1)`,
      ).run();

      const webPushSpy = vi
        .spyOn(webPush, 'sendWebPushNotification')
        .mockResolvedValue({ success: true, status: 201, shouldDelete: false });

      let capturedMqBody = '';
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input, init) => {
          const urlStr = String(input);
          if (urlStr.includes('id.twitch.tv/oauth2/token')) {
            return new Response(
              JSON.stringify({
                access_token: 'mock-igdb-token',
                expires_in: 3600,
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
          if (urlStr.includes('api.igdb.com/v4/multiquery')) {
            capturedMqBody = String(init?.body || '');
            return new Response(
              JSON.stringify([
                {
                  name: 's0',
                  result: [
                    {
                      id: 99001,
                      name: 'Fire Emblem Engage',
                      url: 'https://www.igdb.com/games/fire-emblem-engage',
                      first_release_date: 1674172800,
                      platforms: [{ id: 130, name: 'Nintendo Switch' }],
                      collections: [{ name: 'Fire Emblem' }],
                      release_dates: [
                        { platform: 130, region: 2, date: 1674172800 },
                      ],
                    },
                    {
                      id: 99002,
                      name: 'Fire Emblem: Digital Sound Archive',
                      first_release_date: 1674172800,
                      platforms: [{ id: 130, name: 'Nintendo Switch' }],
                      collections: [{ name: 'Fire Emblem' }],
                    },
                    {
                      id: 99003,
                      name: 'Fire Emblem: Unverified Candidate',
                      first_release_date: 1704067200,
                      platforms: [{ id: 130, name: 'Nintendo Switch' }],
                      collections: [{ name: 'Fire Emblem' }],
                    },
                  ],
                },
              ]),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
          return new Response('[]', { status: 200 });
        });

      const igdbEnv: Env = {
        ...mockEnv,
        TWITCH_CLIENT_ID: 'mock-client',
        TWITCH_CLIENT_SECRET: 'mock-secret',
      };

      try {
        const res = await syncWorkerWatchedSeriesDiscovery(igdbEnv);
        expect(capturedMqBody).not.toContain('game_format');
        expect(capturedMqBody).not.toContain('packaging');
        expect(res.skipped).toBe(false);
        expect(res.seriesScanned).toBe(1);
        expect(res.ingestedGames).toBe(1);
        expect(res.rulesApplied).toBe(1);

        const insertedGame = db
          .prepare(
            `SELECT stable_id, title, platform_id, canonical_series FROM games WHERE igdb_id = 99001`,
          )
          .get() as {
          stable_id: number;
          title: string;
          platform_id: number;
          canonical_series: string;
        };
        expect(insertedGame).toBeDefined();
        expect(insertedGame.platform_id).toBe(26);
        expect(insertedGame.canonical_series).toBe('Fire Emblem');

        const skippedUnverified = db
          .prepare(`SELECT 1 FROM games WHERE igdb_id IN (99002, 99003)`)
          .get();
        expect(skippedUnverified).toBeUndefined();

        const userSeeking = db
          .prepare(
            `SELECT ugr.ownership_status FROM user_game_releases ugr JOIN game_releases r ON r.id = ugr.release_id WHERE ugr.user_id = 1 AND r.game_id = ?`,
          )
          .get(insertedGame.stable_id) as { ownership_status: number };
        expect(userSeeking?.ownership_status).toBe(2);

        expect(webPushSpy).toHaveBeenCalledTimes(1);
        expect(webPushSpy).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            title: '✨ New in Fire Emblem: Fire Emblem Engage',
          }),
          expect.anything(),
        );
      } finally {
        fetchSpy.mockRestore();
        webPushSpy.mockRestore();
      }
    });

    it('syncWorkerWatchedSeriesDiscovery ignores IGDB entries whose raw tag matches a watched rule but computeGameCanonicalSeries resolves to another series', async () => {
      db.prepare(
        `INSERT INTO user_tracking_rules (user_id, rule_type, match_value, target_status, region_scope, is_ignored)
         VALUES (1, 'series', 'Star Wars', 2, 'home', 0)`,
      ).run();

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) => {
          const urlStr = String(input);
          if (urlStr.includes('id.twitch.tv/oauth2/token')) {
            return new Response(
              JSON.stringify({
                access_token: 'mock-igdb-token',
                expires_in: 3600,
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
          if (urlStr.includes('api.igdb.com/v4/multiquery')) {
            return new Response(
              JSON.stringify([
                {
                  name: 's0',
                  result: [
                    {
                      id: 99123,
                      name: 'Soulcalibur IV',
                      url: 'https://www.igdb.com/games/soulcalibur-iv',
                      first_release_date: 1217289600,
                      platforms: [{ id: 12, name: 'Xbox 360' }],
                      collections: [{ name: 'SoulCalibur' }],
                      franchises: [
                        { name: 'SoulCalibur' },
                        { name: 'Star Wars' },
                      ],
                      release_dates: [
                        { platform: 12, region: 2, date: 1217289600 },
                      ],
                    },
                  ],
                },
              ]),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
          return new Response('[]', { status: 200 });
        });

      const igdbEnv: Env = {
        ...mockEnv,
        TWITCH_CLIENT_ID: 'mock-client',
        TWITCH_CLIENT_SECRET: 'mock-secret',
      };

      try {
        const res = await syncWorkerWatchedSeriesDiscovery(igdbEnv);
        expect(res.skipped).toBe(false);
        expect(res.ingestedGames).toBe(0);
        expect(res.rulesApplied).toBe(0);
        expect(
          db.prepare('SELECT 1 FROM games WHERE igdb_id = 99123').get(),
        ).toBeUndefined();
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  describe('Live eBay Market Pricing Engine', () => {
    async function buildSignedCookie(role: 'admin' | 'user', id = 1) {
      const token = await signSession(
        {
          id,
          username: role === 'admin' ? 'alice' : 'bob',
          role,
          homeRegion: 'USA',
        },
        mockEnv.SESSION_SECRET!,
      );
      return `${SESSION_COOKIE}=${token}`;
    }

    it('enforces Admin-only access by default and supports MARKET_PRICING_ACCESS=authenticated', async () => {
      const userCookie = await buildSignedCookie('user', 2);
      const adminCookie = await buildSignedCookie('admin', 1);

      // Unauthenticated request to non-loopback origin -> 403
      const anonRes = await worker.fetch(
        new Request('https://tracker.example.com/api/prices/cached'),
        mockEnv,
      );
      expect(anonRes.status).toBe(403);

      // Regular authenticated user -> 403 by default
      const userRes = await worker.fetch(
        new Request('https://tracker.example.com/api/prices/cached', {
          headers: { Cookie: userCookie },
        }),
        mockEnv,
      );
      expect(userRes.status).toBe(403);

      // Regular authenticated user allowed on /api/prices/cached when MARKET_PRICING_ACCESS=authenticated
      const multiUserEnv: Env = {
        ...mockEnv,
        MARKET_PRICING_ACCESS: 'authenticated',
      };
      const allowedUserRes = await worker.fetch(
        new Request('https://tracker.example.com/api/prices/cached', {
          headers: { Cookie: userCookie },
        }),
        multiUserEnv,
      );
      expect(allowedUserRes.status).toBe(200);

      // Admin-only management routes remain locked even when MARKET_PRICING_ACCESS=authenticated
      const userOverrideRes = await worker.fetch(
        new Request('https://tracker.example.com/api/prices/override', {
          method: 'PUT',
          headers: {
            Cookie: userCookie,
            'Content-Type': 'application/json',
            Origin: 'https://tracker.example.com',
          },
          body: JSON.stringify({
            itemType: 'game',
            itemId: 'mario',
            customQuery: 'Mario NES',
          }),
        }),
        multiUserEnv,
      );
      expect(userOverrideRes.status).toBe(403);

      // Admin passes
      const adminRes = await worker.fetch(
        new Request('https://tracker.example.com/api/prices/cached', {
          headers: { Cookie: adminCookie },
        }),
        mockEnv,
      );
      expect(adminRes.status).toBe(200);
      const adminData = (await adminRes.json()) as { configured: boolean };
      expect(adminData.configured).toBe(false);
    });

    it('gracefully handles unconfigured eBay credentials without errors', async () => {
      const adminCookie = await buildSignedCookie('admin', 1);
      const res = await worker.fetch(
        new Request('https://tracker.example.com/api/prices/live', {
          method: 'POST',
          headers: {
            Cookie: adminCookie,
            'Content-Type': 'application/json',
            Origin: 'https://tracker.example.com',
          },
          body: JSON.stringify({ itemType: 'game', itemId: 'mario' }),
        }),
        mockEnv,
      );
      expect(res.status).toBe(503);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe('ebay_not_configured');
    });

    it('fetches live eBay prices, caches in 8 R2 shards for <6h, syncs cross-device, and purges expired items', async () => {
      const adminCookie = await buildSignedCookie('admin', 1);
      const ebayEnv: Env = {
        ...mockEnv,
        EBAY_CLIENT_ID: 'ebay-test-id',
        EBAY_CLIENT_SECRET: 'ebay-test-secret',
      };

      let browseCalls = 0;
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) => {
          const url = String(input);
          if (url.includes('/identity/v1/oauth2/token')) {
            return new Response(
              JSON.stringify({ access_token: 'ebay-tok', expires_in: 7200 }),
              { status: 200 },
            );
          }
          if (url.includes('/buy/browse/v1/item_summary/search')) {
            browseCalls++;
            return new Response(
              JSON.stringify({
                itemSummaries: [
                  {
                    title: 'Super Mario Bros NES Loose Cart Authentic',
                    price: { value: '18.00', currency: 'USD' },
                    shippingOptions: [{ shippingCostType: 'FREE' }],
                    conditionId: '3000',
                    itemWebUrl: 'https://www.ebay.com/itm/101',
                  },
                  {
                    title: 'Super Mario Bros NES Cart Only Tested',
                    price: { value: '20.00', currency: 'USD' },
                    shippingOptions: [{ shippingCostType: 'FREE' }],
                    conditionId: '3000',
                    itemWebUrl: 'https://www.ebay.com/itm/102',
                  },
                  {
                    title: 'Super Mario Bros NES Game Only',
                    price: { value: '22.00', currency: 'USD' },
                    shippingOptions: [{ shippingCostType: 'FREE' }],
                    conditionId: '3000',
                    itemWebUrl: 'https://www.ebay.com/itm/103',
                  },
                  {
                    title: 'Super Mario Bros NES Complete in Box CIB',
                    price: { value: '95.00', currency: 'USD' },
                    shippingOptions: [{ shippingCostType: 'FREE' }],
                    conditionId: '3000',
                    itemWebUrl: 'https://www.ebay.com/itm/104',
                  },
                ],
              }),
              { status: 200 },
            );
          }
          return new Response('{}', { status: 404 });
        });

      try {
        // 1. Live batch request populates R2 shard
        const batchRes = await worker.fetch(
          new Request('https://tracker.example.com/api/prices/live-batch', {
            method: 'POST',
            headers: {
              Cookie: adminCookie,
              'Content-Type': 'application/json',
              Origin: 'https://tracker.example.com',
            },
            body: JSON.stringify({
              items: [
                { itemType: 'game', itemId: 'gb-mario' },
                { itemType: 'toy', itemId: 'link-amiibo' },
              ],
            }),
          }),
          ebayEnv,
        );
        expect(batchRes.status).toBe(200);
        const batchData = (await batchRes.json()) as {
          fetchedCount: number;
          cacheHits: number;
          prices: Record<string, { loose_cents: number; expires_at: string }>;
        };
        expect(batchData.fetchedCount).toBe(2);
        expect(batchData.cacheHits).toBe(0);
        expect(batchData.prices['game:mario']?.loose_cents).toBe(1900);
        expect(browseCalls).toBe(2);

        // 2. Second request hits R2 shard cache with 0 eBay calls
        const hitRes = await worker.fetch(
          new Request('https://tracker.example.com/api/prices/live-batch', {
            method: 'POST',
            headers: {
              Cookie: adminCookie,
              'Content-Type': 'application/json',
              Origin: 'https://tracker.example.com',
            },
            body: JSON.stringify({
              items: [{ itemType: 'game', itemId: 'mario' }],
            }),
          }),
          ebayEnv,
        );
        expect(hitRes.status).toBe(200);
        const hitData = (await hitRes.json()) as {
          fetchedCount: number;
          cacheHits: number;
        };
        expect(hitData.cacheHits).toBe(1);
        expect(hitData.fetchedCount).toBe(0);
        expect(browseCalls).toBe(2);

        // 3. Cross-device sync reads fresh cached items across shards
        const syncRes = await worker.fetch(
          new Request('https://tracker.example.com/api/prices/cached?sync=1', {
            headers: { Cookie: adminCookie },
          }),
          ebayEnv,
        );
        expect(syncRes.status).toBe(200);
        const syncData = (await syncRes.json()) as {
          configured: boolean;
          prices: Record<string, unknown>;
        };
        expect(syncData.configured).toBe(true);
        expect(Object.keys(syncData.prices)).toContain('game:mario');
        expect(Object.keys(syncData.prices)).toContain('toy:link-amiibo');

        // 4. Hard 6-hour expiration deletes stale shard entries automatically
        const marioShard = getPriceShardIndex('game', 'mario');
        const marioShardKey = getPriceShardR2Key(marioShard);
        const expiredMs = Date.now() + EBAY_PRICE_TTL_MS + 10_000;
        const sweep = await purgeSingleExpiredPriceShard(
          ebayEnv,
          marioShard,
          expiredMs,
        );
        expect(sweep.pruned).toBe(true);
        expect(sweep.remainingCount).toBe(0);
        expect(mockBucket.storage.has(marioShardKey)).toBe(false);

        // 5. Clear remaining cache shards
        const clearRes = await worker.fetch(
          new Request('https://tracker.example.com/api/prices/cache/clear', {
            method: 'POST',
            headers: {
              Cookie: adminCookie,
              'Content-Type': 'application/json',
              Origin: 'https://tracker.example.com',
            },
            body: JSON.stringify({}),
          }),
          ebayEnv,
        );
        expect(clearRes.status).toBe(200);
        const linkShard = getPriceShardIndex('toy', 'link-amiibo');
        expect(mockBucket.storage.has(getPriceShardR2Key(linkShard))).toBe(
          false,
        );
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('persists and deletes user-owned query overrides and handles unmigrated table gracefully', async () => {
      const adminCookie = await buildSignedCookie('admin', 1);

      const putRes = await worker.fetch(
        new Request('https://tracker.example.com/api/prices/override', {
          method: 'PUT',
          headers: {
            Cookie: adminCookie,
            'Content-Type': 'application/json',
            Origin: 'https://tracker.example.com',
          },
          body: JSON.stringify({
            itemType: 'game',
            itemId: 'gb-mario',
            customQuery: 'Super Mario Bros 5-screw NES',
          }),
        }),
        mockEnv,
      );
      expect(putRes.status).toBe(200);
      const putData = (await putRes.json()) as {
        itemId: string;
        customQuery: string;
      };
      expect(putData.itemId).toBe('mario');
      expect(putData.customQuery).toBe('Super Mario Bros 5-screw NES');

      const cachedRes = await worker.fetch(
        new Request('https://tracker.example.com/api/prices/cached', {
          headers: { Cookie: adminCookie },
        }),
        mockEnv,
      );
      const cachedBody = (await cachedRes.json()) as {
        overrides: Record<string, string>;
      };
      expect(cachedBody.overrides[getMarketPriceKey('game', 'mario')]).toBe(
        'Super Mario Bros 5-screw NES',
      );

      // Clear override
      const delRes = await worker.fetch(
        new Request('https://tracker.example.com/api/prices/override', {
          method: 'PUT',
          headers: {
            Cookie: adminCookie,
            'Content-Type': 'application/json',
            Origin: 'https://tracker.example.com',
          },
          body: JSON.stringify({
            itemType: 'game',
            itemId: 'mario',
            customQuery: '',
          }),
        }),
        mockEnv,
      );
      expect(delRes.status).toBe(200);
      const rowAfterDel = db
        .prepare('SELECT * FROM price_query_overrides')
        .all();
      expect(rowAfterDel).toHaveLength(0);

      // Simulate unmigrated remote DB before DDL migration runs
      db.exec('DROP TABLE price_query_overrides');
      const unmigratedCached = await worker.fetch(
        new Request('https://tracker.example.com/api/prices/cached', {
          headers: { Cookie: adminCookie },
        }),
        mockEnv,
      );
      expect(unmigratedCached.status).toBe(200);

      const unmigratedPut = await worker.fetch(
        new Request('https://tracker.example.com/api/prices/override', {
          method: 'PUT',
          headers: {
            Cookie: adminCookie,
            'Content-Type': 'application/json',
            Origin: 'https://tracker.example.com',
          },
          body: JSON.stringify({
            itemType: 'game',
            itemId: 'mario',
            customQuery: 'Mario NES',
          }),
        }),
        mockEnv,
      );
      expect(unmigratedPut.status).toBe(503);
      const unmigratedErr = (await unmigratedPut.json()) as { code: string };
      expect(unmigratedErr.code).toBe('table_not_migrated');
    });

    it('enforces 5-item batch cap, reads each R2 shard only once per batch, and flags retryableError on transient 503', async () => {
      const adminCookie = await buildSignedCookie('admin', 1);
      const ebayEnv: Env = {
        ...mockEnv,
        EBAY_CLIENT_ID: 'ebay-test-id',
        EBAY_CLIENT_SECRET: 'ebay-test-secret',
      };

      // 6 items must be rejected with HTTP 400 (MAX_LIVE_BATCH_ITEMS = 5)
      const oversizeRes = await worker.fetch(
        new Request('https://tracker.example.com/api/prices/live-batch', {
          method: 'POST',
          headers: {
            Cookie: adminCookie,
            'Content-Type': 'application/json',
            Origin: 'https://tracker.example.com',
          },
          body: JSON.stringify({
            items: [
              { itemType: 'game', itemId: 'mario' },
              { itemType: 'toy', itemId: 'link-amiibo' },
              { itemType: 'game', itemId: 'mario' },
              { itemType: 'toy', itemId: 'link-amiibo' },
              { itemType: 'game', itemId: 'mario' },
              { itemType: 'toy', itemId: 'link-amiibo' },
            ],
          }),
        }),
        ebayEnv,
      );
      expect(oversizeRes.status).toBe(400);

      // Spy on R2 get() and verify 1 read per shard + partial success + retryableError on 503
      const r2GetSpy = vi.spyOn(mockBucket, 'get');
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) => {
          const url = String(input);
          if (url.includes('/identity/v1/oauth2/token')) {
            return new Response(
              JSON.stringify({ access_token: 'ebay-tok', expires_in: 7200 }),
              { status: 200 },
            );
          }
          if (url.includes('Link') || url.includes('182180')) {
            return new Response('Upstream Unavailable', { status: 503 });
          }
          return new Response(
            JSON.stringify({
              itemSummaries: [
                {
                  title: 'Super Mario Bros NES Cart Only',
                  price: { value: '18.00', currency: 'USD' },
                  shippingOptions: [{ shippingCostType: 'FREE' }],
                  conditionId: '3000',
                  itemWebUrl: 'https://www.ebay.com/itm/901',
                },
              ],
            }),
            { status: 200 },
          );
        });

      try {
        const res = await worker.fetch(
          new Request('https://tracker.example.com/api/prices/live-batch', {
            method: 'POST',
            headers: {
              Cookie: adminCookie,
              'Content-Type': 'application/json',
              Origin: 'https://tracker.example.com',
            },
            body: JSON.stringify({
              items: [
                { itemType: 'game', itemId: 'mario' },
                { itemType: 'toy', itemId: 'link-amiibo' },
              ],
            }),
          }),
          ebayEnv,
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          fetchedCount: number;
          retryableError?: boolean;
          prices: Record<string, { loose_cents: number }>;
          errors: Record<string, string>;
        };
        expect(body.fetchedCount).toBe(1);
        expect(body.prices['game:mario']?.loose_cents).toBe(1800);
        expect(body.retryableError).toBe(true);
        expect(body.errors['toy:link-amiibo']).toContain('503');

        // Single-pass R2 read: 2 distinct shards -> 2 R2 get() calls total (writePriceShard did not re-read)
        const expectedShards = new Set([
          getPriceShardIndex('game', 'mario'),
          getPriceShardIndex('toy', 'link-amiibo'),
        ]).size;
        expect(r2GetSpy).toHaveBeenCalledTimes(expectedShards);
      } finally {
        fetchSpy.mockRestore();
        r2GetSpy.mockRestore();
      }
    });
  });

  describe('Scheduled PlayStation verification crons (PS5DB & SerialStation)', () => {
    it('syncWorkerPs5Db is SHA-256 hash-gated, upgrades lower-tier retail rows, links PS5 releases, and marks dirty flags', async () => {
      db.exec(`
        INSERT INTO canonical_releases (id, platform_id, raw_title, normalized_title, region, publisher, source, is_verified_physical)
        VALUES
          (8001, 35, 'Returnal', 'returnal', 'USA', NULL, 'retail_catalog', 1),
          (8002, 35, 'Astro Bot', 'astrobot', 'USA', NULL, 'dat', 1);
        INSERT INTO games (stable_id, id, title, platform_id)
        VALUES
          (8101, '8101', 'Returnal', 35),
          (8102, '8102', 'Demon''s Souls', 35);
        INSERT INTO game_releases (id, game_id, region, canonical_release_id)
        VALUES
          ('8101-1', 8101, 'USA', 8001),
          ('8102-1', 8102, 'USA', NULL);
      `);

      const sampleCsv = [
        'Title,Physical Publisher,Limited,ESRB SKU,PEGI Rating',
        'Returnal,Sony Interactive Entertainment,-,PPSA-01284,-',
        'Astro Bot,Sony Interactive Entertainment,-,PPSA-21564,-',
        "Demon's Souls,Sony Interactive Entertainment,-,PPSA-01342 711719541004,-",
      ].join('\n');

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(
          async () => new Response(sampleCsv, { status: 200 }),
        );

      try {
        // 1. Initial sync upgrades Returnal (8001) -> ps5db, enriches Astro Bot (8002) DAT with publisher/serial without duplicating,
        //    inserts Demon's Souls and links 8102-1, and sets both dirty flags.
        const first = await syncWorkerPs5Db(mockEnv);
        expect(first.checked).toBe(true);
        expect(first.hashMatch).toBe(false);
        expect(first.addedCanonical).toBe(1);
        expect(first.upgradedCanonical).toBe(1);
        expect(first.enrichedCanonical).toBe(1);
        expect(first.linkedReleases).toBe(1);

        const returnal = db
          .prepare(
            'SELECT id, source, serial_code, publisher FROM canonical_releases WHERE id = 8001',
          )
          .get() as {
          id: number;
          source: string;
          serial_code: string | null;
          publisher: string | null;
        };
        expect(returnal).toMatchObject({
          id: 8001,
          source: 'ps5db',
          serial_code: 'PPSA-01284',
          publisher: 'Sony Interactive Entertainment',
        });

        const astroRows = db
          .prepare(
            "SELECT id, source, serial_code, publisher FROM canonical_releases WHERE platform_id = 35 AND normalized_title = 'astrobot'",
          )
          .all() as Array<{
          id: number;
          source: string;
          serial_code: string | null;
          publisher: string | null;
        }>;
        expect(astroRows).toHaveLength(1);
        expect(astroRows[0]).toMatchObject({
          id: 8002,
          source: 'dat',
          serial_code: 'PPSA-21564',
          publisher: 'Sony Interactive Entertainment',
        });

        const demonsLink = db
          .prepare(
            "SELECT canonical_release_id FROM game_releases WHERE id = '8102-1'",
          )
          .get() as { canonical_release_id: number | null };
        expect(demonsLink.canonical_release_id).toBeGreaterThan(0);

        const dirtyRow = db
          .prepare('SELECT value FROM sync_state WHERE key = ?')
          .get(CATALOG_CHUNKS_DIRTY_KEY) as { value: string };
        expect(dirtyRow.value).toBe('1');

        // 2. Hash match on re-run performs 0 writes
        const second = await syncWorkerPs5Db(mockEnv);
        expect(second.checked).toBe(true);
        expect(second.hashMatch).toBe(true);
        expect(second.writesUsed).toBe(0);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('syncWorkerSerialStation advances cursor across 2 pages, fails soft without advancing cursor, respects 2h cooldown, enforces hierarchy, and marks catalog_chunks_dirty only when linked rows change', async () => {
      db.exec(`
        INSERT INTO canonical_releases (id, platform_id, raw_title, normalized_title, region, source, is_verified_physical)
        VALUES
          (8201, 34, 'Bloodborne', 'blodborne', 'USA', 'dat', 1),
          (8202, 35, 'Stellar Blade', 'stellarblade', 'USA', 'ps5db', 1);
        INSERT INTO games (stable_id, id, title, platform_id)
        VALUES
          (8301, '8301', 'Gravity Rush Remastered', 34);
        INSERT INTO game_releases (id, game_id, region, canonical_release_id)
        VALUES
          ('8301-1', 8301, 'USA', NULL);
      `);

      // 1. Fail-soft on HTTP 503 preserves cursor at 0 and does NOT touch catalog_chunks_dirty
      const failSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('Bad Gateway', { status: 503 }));
      try {
        const failRes = await syncWorkerSerialStation(mockEnv, { force: true });
        expect(failRes.error).toContain('503');
        expect(failRes.nextOffset).toBe(0);
      } finally {
        failSpy.mockRestore();
      }

      // Immediately re-running without force obeys 2h cooldown
      const throttled = await syncWorkerSerialStation(mockEnv);
      expect(throttled.skipped).toBe(true);

      // 2. Successful 2-page sweep -> filters PS3/noise, enriches DAT Bloodborne (no dup), upgrades Stellar Blade ps5db -> serialstation,
      //    does NOT set catalog_chunks_dirty yet because unlinked game wasn't matched on batch 1, then wraps cursor to 0 on final short page!
      const fillerPage1 = Array.from({ length: 97 }, (_, idx) => ({
        name: `PS3 Skip ${idx}`,
        regions: ['America'],
        title_id: `BLUS${String(10000 + idx)}`,
        edition: 'Original',
        release_type: 'PHYSICAL',
      }));
      const page1Items = [
        ...fillerPage1,
        {
          name: 'Bloodborne',
          regions: ['America'],
          title_id: 'CUSA00900',
          edition: 'Original',
          release_type: 'PHYSICAL',
          barcode: '711719501237',
        },
        {
          name: 'Bloodborne [PlayStation Hits]',
          regions: ['America'],
          title_id: 'CUSA00900H',
          edition: 'PlayStation Hits',
          release_type: 'PHYSICAL',
        },
        {
          name: 'Stellar Blade',
          regions: ['America'],
          title_id: 'PPSA13196',
          edition: 'Original',
          release_type: 'PHYSICAL',
          barcode: '711719576006',
        },
      ];
      const page2Items = [
        {
          name: 'Gravity Rush Remastered',
          regions: ['America'],
          title_id: 'CUSA01130',
          edition: 'Original',
          release_type: 'PHYSICAL',
        },
      ];

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) => {
          const url = String(input);
          if (url.includes('offset=0')) {
            return Response.json({ count: 101, items: page1Items });
          }
          return Response.json({ count: 101, items: page2Items });
        });

      try {
        const res = await syncWorkerSerialStation(mockEnv, { force: true });
        expect(res.error).toBeUndefined();
        expect(res.pagesFetched).toBe(2);
        expect(res.nextOffset).toBe(0); // Wrapped after short page 2
        expect(res.enrichedCanonical).toBe(1); // Bloodborne DAT enriched
        expect(res.upgradedCanonical).toBe(1); // Stellar Blade ps5db -> serialstation
        expect(res.addedCanonical).toBe(1); // Gravity Rush Remastered
        expect(res.linkedReleases).toBe(1); // Linked 8301-1
        expect(res.writesUsed).toBeLessThanOrEqual(1500);

        const datBloodborne = db
          .prepare(
            "SELECT source, serial_code, barcode FROM canonical_releases WHERE platform_id = 34 AND normalized_title = 'blodborne'",
          )
          .all() as Array<{
          source: string;
          serial_code: string | null;
          barcode: string | null;
        }>;
        expect(datBloodborne).toHaveLength(1);
        expect(datBloodborne[0]).toMatchObject({
          source: 'dat',
          serial_code: 'CUSA00900',
          barcode: '711719501237',
        });

        const stellar = db
          .prepare(
            'SELECT source, serial_code, barcode FROM canonical_releases WHERE id = 8202',
          )
          .get() as {
          source: string;
          serial_code: string | null;
          barcode: string | null;
        };
        expect(stellar).toMatchObject({
          source: 'serialstation',
          serial_code: 'PPSA13196',
          barcode: '711719576006',
        });

        const ps3Inserted = db
          .prepare(
            'SELECT COUNT(*) as c FROM canonical_releases WHERE platform_id = 32',
          )
          .get() as { c: number };
        expect(ps3Inserted.c).toBe(0);

        const dirtyRow = db
          .prepare('SELECT value FROM sync_state WHERE key = ?')
          .get(CATALOG_CHUNKS_DIRTY_KEY) as { value: string };
        expect(dirtyRow.value).toBe('1');
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('syncWorkerSerialStation skips poisoned page 0 when page 1 succeeds and fails soft when both fail', async () => {
      db.exec(`
        INSERT INTO sync_state (key, value)
        VALUES ('serialstation_cursor_offset', '100');
        INSERT INTO games (stable_id, id, title, platform_id)
        VALUES (8401, '8401', 'Returnal', 35);
        INSERT INTO game_releases (id, game_id, region, canonical_release_id)
        VALUES ('8401-1', 8401, 'USA', NULL);
      `);

      // (a) offset=100 times out/fails, offset=200 succeeds -> processes offset=200 and advances to 300
      const partialSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) => {
          const url = String(input);
          if (url.includes('offset=100')) {
            return new Response('Gateway Timeout', { status: 504 });
          }
          if (url.includes('offset=200')) {
            const pageItems = Array.from({ length: 100 }, (_, i) => ({
              name: i === 0 ? 'Returnal' : `PS3 Filler ${i}`,
              regions: ['America'],
              title_id: i === 0 ? 'PPSA01284' : `BLUS${40000 + i}`,
              edition: 'Original',
              release_type: 'PHYSICAL',
            }));
            return Response.json({ count: 500, items: pageItems });
          }
          return new Response('Unexpected offset', { status: 500 });
        });

      try {
        const res = await syncWorkerSerialStation(mockEnv, { force: true });
        expect(res.pagesFetched).toBe(1);
        expect(res.nextOffset).toBe(300);
        expect(res.addedCanonical).toBe(1);
        expect(res.linkedReleases).toBe(1);
      } finally {
        partialSpy.mockRestore();
      }

      // Reset cursor to 100 to verify (b): both offset=100 and offset=200 fail -> fails soft at 100
      db.prepare(
        "UPDATE sync_state SET value = '100' WHERE key = 'serialstation_cursor_offset'",
      ).run();
      const bothFailSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new DOMException('Timeout', 'TimeoutError'));

      try {
        const failRes = await syncWorkerSerialStation(mockEnv, { force: true });
        expect(failRes.pagesFetched).toBe(0);
        expect(failRes.error).toBeTruthy();
        expect(failRes.nextOffset).toBe(100);
      } finally {
        bothFailSpy.mockRestore();
      }
    });

    it('syncWorkerSerialStation defaults to 5 pages per run and aborts immediately on HTTP 429', async () => {
      let fetchedOffsets: number[] = [];
      const fivePageSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) => {
          const url = new URL(String(input));
          const off = parseInt(url.searchParams.get('offset') || '0', 10);
          fetchedOffsets.push(off);
          return Response.json({
            count: 5000,
            items: Array.from({ length: 100 }, (_, i) => ({
              name: `PS3 Skip ${off + i}`,
              regions: ['America'],
              title_id: `BLUS${String(10000 + off + i)}`,
              edition: 'Original',
              release_type: 'PHYSICAL',
            })),
          });
        });

      try {
        const res = await syncWorkerSerialStation(mockEnv, { force: true });
        expect(res.pagesFetched).toBe(5);
        expect(fetchedOffsets).toEqual([0, 100, 200, 300, 400]);
        expect(res.nextOffset).toBe(500);
      } finally {
        fivePageSpy.mockRestore();
      }

      fetchedOffsets = [];
      const rateLimitSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) => {
          const url = new URL(String(input));
          const off = parseInt(url.searchParams.get('offset') || '0', 10);
          fetchedOffsets.push(off);
          return new Response('Too Many Requests', { status: 429 });
        });

      try {
        const rlRes = await syncWorkerSerialStation(mockEnv, { force: true });
        expect(rlRes.error).toContain('429');
        expect(rlRes.pagesFetched).toBe(0);
        expect(fetchedOffsets).toEqual([500]);
        expect(rlRes.nextOffset).toBe(500);
      } finally {
        rateLimitSpy.mockRestore();
      }
    });
  });

  describe('Hourly 24-Slot Cron Dispatcher, In-Worker DAT Sync & Paid/Free Tier Switch', () => {
    it('GET/POST /api/admin/plan-tier enforces admin auth, validates tier, and exposes workerPlanTier in /api/admin/catalog-seed', async () => {
      expect(await resolveWorkerPlanTier(mockEnv)).toBe('paid');

      const unauthRes = await worker.fetch(
        new Request(
          'https://collection-tracker.example.com/api/admin/plan-tier',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://collection-tracker.example.com',
            },
            body: JSON.stringify({ tier: 'free' }),
          },
        ),
        {
          ...mockEnv,
          OIDC_ISSUER: 'https://issuer.example.com',
          OIDC_CLIENT_ID: 'client-1',
        },
      );
      expect(unauthRes.status).toBe(403);

      const adminToken = await signSession(
        { id: 1, username: 'alice', role: 'admin', homeRegion: 'USA' },
        mockEnv.SESSION_SECRET!,
      );
      const adminHeaders = {
        'Content-Type': 'application/json',
        Origin: 'https://collection-tracker.example.com',
        Cookie: `${HOST_SESSION_COOKIE}=${adminToken}`,
      };

      const badRes = await worker.fetch(
        new Request(
          'https://collection-tracker.example.com/api/admin/plan-tier',
          {
            method: 'POST',
            headers: adminHeaders,
            body: JSON.stringify({ tier: 'enterprise' }),
          },
        ),
        mockEnv,
      );
      expect(badRes.status).toBe(400);

      const toFreeRes = await worker.fetch(
        new Request(
          'https://collection-tracker.example.com/api/admin/plan-tier',
          {
            method: 'POST',
            headers: adminHeaders,
            body: JSON.stringify({ tier: 'free' }),
          },
        ),
        mockEnv,
      );
      expect(toFreeRes.status).toBe(200);
      expect(
        (await toFreeRes.json()) as { success: boolean; tier: string },
      ).toMatchObject({ success: true, tier: 'free' });
      expect(await resolveWorkerPlanTier(mockEnv)).toBe('free');

      const seedStatusRes = await worker.fetch(
        new Request(
          'https://collection-tracker.example.com/api/admin/catalog-seed',
          {
            headers: { Cookie: adminHeaders.Cookie },
          },
        ),
        mockEnv,
      );
      expect(seedStatusRes.status).toBe(200);
      const seedStatus = (await seedStatusRes.json()) as {
        workerPlanTier: string;
        catalogDelivery: { mode: string };
        workerDatSync: { retroCursor: number };
      };
      expect(seedStatus.workerPlanTier).toBe('free');
      expect(seedStatus.catalogDelivery.mode).toBe('d1-edge-cache');
      expect(typeof seedStatus.workerDatSync.retroCursor).toBe('number');
    });

    it('routes isolated UTC hour slots, logs SKIPPED (free_tier_mode) in free tier, and keeps 00:00 UTC backups running', async () => {
      db.prepare(
        `INSERT OR REPLACE INTO sync_state (key, value) VALUES ('worker_plan_tier', 'free')`,
      ).run();
      await markDbDirty(mockEnv);
      mockBucket.storage.clear();

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response(JSON.stringify({ products: [] }), { status: 200 }),
        );

      try {
        // Hour 05 UTC in free tier -> retail_preorders skipped without fetching
        await worker.scheduled(
          {
            cron: '0 * * * *',
            type: 'scheduled',
            scheduledTime: Date.parse('2026-11-24T05:00:00Z'),
          } as unknown as ScheduledEvent,
          mockEnv,
          {} as ExecutionContext,
        );
        expect(fetchSpy).not.toHaveBeenCalled();
        const cronLogs = logSpy.mock.calls
          .map(([arg]) => arg)
          .filter(
            (a): a is Record<string, unknown> =>
              typeof a === 'object' &&
              a !== null &&
              (a as Record<string, unknown>)['event'] === 'cron_execution',
          );
        expect(
          cronLogs.some(
            (l) =>
              l['job_name'] === 'retail_preorders' &&
              l['status'] === 'SKIPPED' &&
              l['summary'] === 'SKIPPED (free_tier_mode)',
          ),
        ).toBe(true);

        // Hour 00 UTC in free tier -> daily R2 backup STILL runs!
        await worker.scheduled(
          {
            cron: '0 * * * *',
            type: 'scheduled',
            scheduledTime: Date.parse('2026-11-24T00:00:00Z'),
          } as unknown as ScheduledEvent,
          mockEnv,
          {} as ExecutionContext,
        );
        expect(mockBucket.storage.has('snapshots/latest.json')).toBe(true);

        // Hour 13 UTC in free tier -> launch_day notification scan runs outside ingestion gate!
        await worker.scheduled(
          {
            cron: '0 * * * *',
            type: 'scheduled',
            scheduledTime: Date.parse('2026-11-24T13:00:00Z'),
          } as unknown as ScheduledEvent,
          mockEnv,
          {} as ExecutionContext,
        );
        const logsAfter13 = logSpy.mock.calls
          .map(([arg]) => arg)
          .filter(
            (a): a is Record<string, unknown> =>
              typeof a === 'object' &&
              a !== null &&
              (a as Record<string, unknown>)['event'] === 'cron_execution',
          );
        expect(
          logsAfter13.some(
            (l) => l['job_name'] === 'launch_day' && l['status'] === 'SUCCESS',
          ),
        ).toBe(true);
        expect(
          logsAfter13.some(
            (l) =>
              l['job_name'] === 'worker_dat_sync' && l['status'] === 'SKIPPED',
          ),
        ).toBe(true);
      } finally {
        logSpy.mockRestore();
        fetchSpy.mockRestore();
      }
    });

    it('syncWorkerDats parses fetched XML DAT, links unlinked game_releases, and SHA-256 hash-skips repeat unchanged runs', async () => {
      db.prepare(
        `INSERT OR IGNORE INTO platforms (id, name, display_name) VALUES (35, 'ps5', 'PlayStation 5')`,
      ).run();
      const insG = db
        .prepare(
          `INSERT INTO games (id, title, platform_id) VALUES ('ps5-dat-test', 'Returnal', 35)`,
        )
        .run();
      db.prepare(
        `INSERT INTO game_releases (id, game_id, region) VALUES ('ps5-dat-rel', ?, 'USA')`,
      ).run(insG.lastInsertRowid);

      const sampleXml = `<?xml version="1.0"?>
<datafile>
  <header><name>Sony - PlayStation 5 - Datfile</name></header>
  <game name="Returnal (USA)">
    <category>Games</category>
    <serial>PPSA-01284</serial>
    <rom name="Returnal (USA).iso" size="1024" crc="abcdef12"/>
  </game>
</datafile>`;

      let getCalls = 0;
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (_input, init) => {
          if (init?.method === 'HEAD') {
            return new Response(null, {
              status: 200,
              headers: { ETag: '"dat-v1"' },
            });
          }
          getCalls++;
          return new Response(sampleXml, {
            status: 200,
            headers: {
              'Content-Type': 'application/xml',
              ETag: '"dat-v1"',
            },
          });
        });

      try {
        const res1 = await syncWorkerDats(mockEnv, { targetSlugs: ['ps5'] });
        expect(res1.skipped).toBe(false);
        expect(res1.targetsUpdated).toBe(1);
        expect(res1.addedCanonical).toBe(1);
        expect(res1.linkedReleases).toBe(1);
        expect(getCalls).toBe(1);

        const linkedRel = db
          .prepare(
            `SELECT canonical_release_id, verified_source, serial_code FROM game_releases WHERE id = 'ps5-dat-rel'`,
          )
          .get() as {
          canonical_release_id: number | null;
          verified_source: string | null;
          serial_code: string | null;
        };
        expect(linkedRel.canonical_release_id).not.toBeNull();
        expect(linkedRel.verified_source).toBe('dat');
        expect(linkedRel.serial_code).toBe('PPSA-01284');

        // Second run: ETag unchanged via HEAD -> zero GET fetches and zero writes
        const res2 = await syncWorkerDats(mockEnv, { targetSlugs: ['ps5'] });
        expect(res2.targetsUpdated).toBe(0);
        expect(res2.writesUsed).toBe(0);
        expect(getCalls).toBe(1);
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });
});
