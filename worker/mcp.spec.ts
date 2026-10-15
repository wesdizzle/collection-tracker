import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { handleMcpRequest, McpEnv, MCP_TOOLS } from './mcp';
import worker, { Env } from './worker';

interface TestJsonRpcResponse {
  jsonrpc: string;
  id: string | number | null;
  result?: {
    protocolVersion?: string;
    capabilities?: { tools?: unknown };
    serverInfo?: { name: string; version: string };
    tools?: Array<{ name: string; description: string }>;
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface TestGetStatusResponse {
  status: string;
  protocol: string;
  version: string;
  server: string;
  app: string;
  tools_count: number;
  tools: Array<{ name: string; description: string }>;
}

interface ParsedOwnershipResponse {
  owned: boolean;
  title: string;
  platform: string;
  url: string;
  message?: string;
  owned_releases?: Array<{
    region: string | null;
    variants: string | null;
    owned: boolean;
    backed_up: boolean;
    completeness: string;
    estimated_value: string | null;
  }>;
  all_catalog_releases?: unknown[];
  other_matches?: Array<{
    title: string;
    platform: string;
    owned: boolean;
    url: string;
  }>;
}

interface ParsedSearchResponse {
  count: number;
  limit: number;
  games: Array<{
    id: string;
    title: string;
    platform: string;
    series: string | null;
    owned: boolean;
    backed_up: boolean;
    release_date: string | null;
    estimated_value: string | null;
    url: string;
  }>;
}

interface ParsedGameDetailResponse {
  id: string;
  title: string;
  platform: string;
  summary: string | null;
  pricing: { loose: string | null; cib: string | null; new: string | null };
  releases: Array<{
    id: string;
    rom_name: string | null;
    completeness: string;
  }>;
  url: string;
}

interface ParsedToyResponse {
  owned: boolean;
  name: string;
  line: string;
  series: string | null;
  type: string;
  release_date: string | null;
  url: string;
}

interface ParsedStatsResponse {
  platform: string;
  total_games_tracked: number;
  owned_games_count: number;
  backed_up_games_count: number;
  missing_backup_count: number;
  backup_completion_pct: string;
  total_toys_owned: number;
  total_estimated_value_usd: string | null;
  top_platforms: Array<{ platform: string; owned_count: number }>;
}

interface ParsedPlatformsResponse {
  count: number;
  platforms: Array<{
    id: number;
    name: string;
    brand: string | null;
    owned_games: number;
  }>;
}

interface ParsedDealsResponse {
  deals_count: number;
  min_discount_pct: number;
  deals: Array<{
    title: string;
    platform: string;
    store: string | null;
    store_url: string | null;
    collection_url: string;
    already_owned: boolean;
  }>;
}

describe('Model Context Protocol (MCP) Server', () => {
  let db: Database.Database;
  let mockDb: D1Database;
  let mockEnv: McpEnv & Env;

  beforeEach(() => {
    db = new Database(':memory:');

    // Create minimal schema matching canonical database
    db.exec(`
      CREATE TABLE platforms (
        id INTEGER PRIMARY KEY,
        name TEXT UNIQUE,
        display_name TEXT,
        brand TEXT,
        launch_date DATE,
        parent_platform_id INTEGER
      );

      CREATE TABLE games (
        stable_id INTEGER PRIMARY KEY,
        id TEXT UNIQUE,
        title TEXT COLLATE NOCASE,
        series TEXT,
        canonical_series TEXT,
        platform_id INTEGER,
        summary TEXT,
        genres TEXT,
        franchises TEXT,
        igdb_url TEXT,
        barcode TEXT,
        region TEXT,
        physical_status TEXT DEFAULT 'unverified',
        release_medium TEXT DEFAULT 'physical_retail',
        price_loose INTEGER,
        price_cib INTEGER,
        price_new INTEGER,
        retail_on_sale INTEGER DEFAULT 0,
        retail_store TEXT,
        retail_price INTEGER,
        retail_regular_price INTEGER,
        retail_discount_pct INTEGER,
        retail_url TEXT,
        bundle_parent_id INTEGER,
        bundle_disc_number INTEGER
      );

      CREATE TABLE game_releases (
        id TEXT PRIMARY KEY,
        game_id INTEGER NOT NULL REFERENCES games(stable_id),
        region TEXT,
        variants TEXT,
        rom_name TEXT,
        rom_crc TEXT,
        backup_status INTEGER NOT NULL DEFAULT 0,
        ownership_status INTEGER NOT NULL DEFAULT 0,
        release_date DATE,
        has_case INTEGER NOT NULL DEFAULT 0,
        has_manual INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE toy_series (
        id TEXT PRIMARY KEY,
        name TEXT,
        line TEXT,
        sort_index INTEGER
      );

      CREATE TABLE toys (
        stable_id INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE,
        name TEXT NOT NULL COLLATE NOCASE,
        line TEXT NOT NULL,
        series_id TEXT,
        series TEXT,
        type TEXT,
        release_date DATE,
        ownership_status INTEGER DEFAULT 0,
        amiibo_id TEXT
      );

      -- B-Tree indexes matching migration 0015
      CREATE INDEX idx_games_title_nocase ON games (title COLLATE NOCASE);
      CREATE INDEX idx_toys_name_nocase ON toys (name COLLATE NOCASE);

      -- Seed Platforms
      INSERT INTO platforms (id, name, display_name, brand, launch_date, parent_platform_id) VALUES
        (15, 'Wii', 'Wii', 'Nintendo', '2006-11-19', NULL),
        (48, 'PlayStation 4', 'PlayStation 4', 'Sony', '2013-11-15', NULL),
        (165, 'PlayStation VR', 'PlayStation VR', 'Sony', '2016-10-13', 48);

      -- Seed Games & Releases
      -- 1. Super Mario Galaxy (Wii, Owned, CIB, Backed Up)
      INSERT INTO games (stable_id, id, title, series, canonical_series, platform_id, price_loose, price_cib, summary)
      VALUES (1, 'super-mario-galaxy-wii', 'Super Mario Galaxy', 'Mario', 'Super Mario', 15, 1200, 1550, 'Mario in space.');

      INSERT INTO game_releases (id, game_id, region, variants, backup_status, ownership_status, has_case, has_manual, rom_name)
      VALUES ('smg-us', 1, 'USA, Canada', NULL, 1, 1, 1, 1, 'Super Mario Galaxy (USA).iso');

      -- 2. Beat Saber (PSVR under PS4, Owned, Digital, Missing Backup)
      INSERT INTO games (stable_id, id, title, series, platform_id, release_medium)
      VALUES (2, 'beat-saber-ps4', 'Beat Saber', 'Beat Saber', 165, 'digital');

      INSERT INTO game_releases (id, game_id, region, backup_status, ownership_status)
      VALUES ('bs-us', 2, 'USA', 0, 1);

      -- 3. Unowned Game on Sale
      INSERT INTO games (
        stable_id, id, title, platform_id, retail_on_sale, retail_store,
        retail_price, retail_regular_price, retail_discount_pct, retail_url
      ) VALUES (
        3, 'metroid-prime-4-switch', 'Metroid Prime 4: Beyond', 15, 1, 'Best Buy',
        4999, 6999, 28, 'https://bestbuy.com/metroid'
      );

      -- Seed Toys
      INSERT INTO toy_series (id, name, line) VALUES ('zelda', 'The Legend of Zelda', 'amiibo');
      INSERT INTO toys (stable_id, id, name, line, series_id, series, type, release_date, ownership_status)
      VALUES (1, 'wolf-link-amiibo', 'Wolf Link', 'amiibo', 'zelda', 'The Legend of Zelda', 'Figure', '2016-03-04', 1);
    `);

    // D1 Mock wrapping SQLite
    mockDb = {
      prepare: (query: string) => ({
        bind: (...params: (string | number | null)[]) => ({
          all: async () => ({ results: db.prepare(query).all(...params) }),
          first: async () => db.prepare(query).get(...params) || null,
          run: async () => {
            db.prepare(query).run(...params);
            return { success: true };
          },
        }),
        all: async () => ({ results: db.prepare(query).all() }),
        first: async () => db.prepare(query).get() || null,
        run: async () => {
          db.prepare(query).run();
          return { success: true };
        },
      }),
    } as unknown as D1Database;

    mockEnv = {
      DB: mockDb,
      ASSETS: {
        fetch: async () => new Response('Asset Fallback', { status: 404 }),
      },
      APP_NAME: 'Collection Tracker Test',
    };
  });

  it('handles CORS OPTIONS preflight', async () => {
    const req = new Request('https://tracker.test/mcp', { method: 'OPTIONS' });
    const res = await handleMcpRequest(req, mockEnv);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain(
      'Mcp-Session-Id',
    );
  });

  it('handles GET /mcp informational status check', async () => {
    const req = new Request('https://tracker.test/mcp', { method: 'GET' });
    const res = await handleMcpRequest(req, mockEnv);
    expect(res.status).toBe(200);
    const data = (await res.json()) as TestGetStatusResponse;
    expect(data.status).toBe('ok');
    expect(data.tools_count).toBe(MCP_TOOLS.length);
    expect(data.tools).toBeDefined();
  });

  it('handles MCP initialize handshake', async () => {
    const req = new Request('https://tracker.test/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05' },
      }),
    });
    const res = await handleMcpRequest(req, mockEnv);
    expect(res.status).toBe(200);
    const data = (await res.json()) as TestJsonRpcResponse;
    expect(data.jsonrpc).toBe('2.0');
    expect(data.id).toBe(1);
    expect(data.result?.serverInfo?.name).toBe('collection-tracker-mcp');
    expect(data.result?.capabilities?.tools).toBeDefined();
  });

  it('handles MCP tools/list discovery', async () => {
    const req = new Request('https://tracker.test/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      }),
    });
    const res = await handleMcpRequest(req, mockEnv);
    const data = (await res.json()) as TestJsonRpcResponse;
    expect(data.id).toBe(2);
    expect(data.result?.tools?.length).toBe(8);
    const toolNames = (data.result?.tools || []).map((t) => t.name);
    expect(toolNames).toContain('check_game_ownership');
    expect(toolNames).toContain('search_collection');
    expect(toolNames).toContain('get_game_details');
    expect(toolNames).toContain('check_toy_ownership');
    expect(toolNames).toContain('search_toys');
    expect(toolNames).toContain('get_collection_stats');
    expect(toolNames).toContain('get_platforms');
    expect(toolNames).toContain('get_active_deals');
  });

  describe('Tool 1: check_game_ownership', () => {
    it('returns ownership status, completeness, value, and web URL for owned game', async () => {
      const req = new Request('https://tracker.test/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 10,
          method: 'tools/call',
          params: {
            name: 'check_game_ownership',
            arguments: { title: 'Super Mario Galaxy', platform: 'Wii' },
          },
        }),
      });
      const res = await handleMcpRequest(req, mockEnv);
      const data = (await res.json()) as TestJsonRpcResponse;
      expect(data.result?.isError).toBe(false);

      const parsed = JSON.parse(
        data.result?.content?.[0]?.text || '{}',
      ) as ParsedOwnershipResponse;
      expect(parsed.owned).toBe(true);
      expect(parsed.title).toBe('Super Mario Galaxy');
      expect(parsed.platform).toBe('Wii');
      expect(parsed.url).toBe(
        'https://tracker.test/collection/games/super-mario-galaxy-wii',
      );
      expect(parsed.owned_releases?.length).toBe(1);
      expect(parsed.owned_releases?.[0]?.completeness).toBe(
        'CIB (Complete in Box)',
      );
      expect(parsed.owned_releases?.[0]?.estimated_value).toBe('$15.50');
      expect(parsed.owned_releases?.[0]?.backed_up).toBe(true);
    });

    it('subsumes child platforms into parent platform (PSVR -> PlayStation 4)', async () => {
      const req = new Request('https://tracker.test/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 11,
          method: 'tools/call',
          params: {
            name: 'check_game_ownership',
            arguments: { title: 'Beat Saber', platform: 'PS4' },
          },
        }),
      });
      const res = await handleMcpRequest(req, mockEnv);
      const data = (await res.json()) as TestJsonRpcResponse;
      const parsed = JSON.parse(
        data.result?.content?.[0]?.text || '{}',
      ) as ParsedOwnershipResponse;
      expect(parsed.owned).toBe(true);
      expect(parsed.title).toBe('Beat Saber');
      expect(parsed.platform).toBe('PlayStation 4');
      expect(parsed.owned_releases?.[0]?.completeness).toBe('Digital');
    });

    it('returns owned: false when game is not in collection', async () => {
      const req = new Request('https://tracker.test/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 12,
          method: 'tools/call',
          params: {
            name: 'check_game_ownership',
            arguments: { title: 'Nonexistent Game 9000' },
          },
        }),
      });
      const res = await handleMcpRequest(req, mockEnv);
      const data = (await res.json()) as TestJsonRpcResponse;
      const parsed = JSON.parse(
        data.result?.content?.[0]?.text || '{}',
      ) as ParsedOwnershipResponse;
      expect(parsed.owned).toBe(false);
      expect(parsed.message).toContain('No matching game found');
    });
  });

  describe('Tool 2: search_collection', () => {
    it('searches games and returns items with web detail links', async () => {
      const req = new Request('https://tracker.test/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 20,
          method: 'tools/call',
          params: {
            name: 'search_collection',
            arguments: { query: 'Mario' },
          },
        }),
      });
      const res = await handleMcpRequest(req, mockEnv);
      const data = (await res.json()) as TestJsonRpcResponse;
      const parsed = JSON.parse(
        data.result?.content?.[0]?.text || '{}',
      ) as ParsedSearchResponse;
      expect(parsed.count).toBe(1);
      expect(parsed.games[0]?.title).toBe('Super Mario Galaxy');
      expect(parsed.games[0]?.url).toBe(
        'https://tracker.test/collection/games/super-mario-galaxy-wii',
      );
      expect(parsed.games[0]?.estimated_value).toBe('$15.50');
    });
  });

  describe('Tool 3: get_game_details', () => {
    it('returns full media breakdown, prices, and IGDB summary', async () => {
      const req = new Request('https://tracker.test/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 30,
          method: 'tools/call',
          params: {
            name: 'get_game_details',
            arguments: { id: 'super-mario-galaxy-wii' },
          },
        }),
      });
      const res = await handleMcpRequest(req, mockEnv);
      const data = (await res.json()) as TestJsonRpcResponse;
      const parsed = JSON.parse(
        data.result?.content?.[0]?.text || '{}',
      ) as ParsedGameDetailResponse;
      expect(parsed.title).toBe('Super Mario Galaxy');
      expect(parsed.summary).toBe('Mario in space.');
      expect(parsed.pricing.cib).toBe('$15.50');
      expect(parsed.pricing.loose).toBe('$12.00');
      expect(parsed.releases.length).toBe(1);
      expect(parsed.releases[0]?.rom_name).toBe('Super Mario Galaxy (USA).iso');
      expect(parsed.url).toBe(
        'https://tracker.test/collection/games/super-mario-galaxy-wii',
      );
    });
  });

  describe('Tool 4 & 5: check_toy_ownership and search_toys', () => {
    it('verifies amiibo ownership and returns web detail URL', async () => {
      const req = new Request('https://tracker.test/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 40,
          method: 'tools/call',
          params: {
            name: 'check_toy_ownership',
            arguments: { name: 'Wolf Link' },
          },
        }),
      });
      const res = await handleMcpRequest(req, mockEnv);
      const data = (await res.json()) as TestJsonRpcResponse;
      const parsed = JSON.parse(
        data.result?.content?.[0]?.text || '{}',
      ) as ParsedToyResponse;
      expect(parsed.owned).toBe(true);
      expect(parsed.name).toBe('Wolf Link');
      expect(parsed.line).toBe('amiibo');
      expect(parsed.series).toBe('The Legend of Zelda');
      expect(parsed.url).toBe(
        'https://tracker.test/collection/toys/wolf-link-amiibo',
      );
    });
  });

  describe('Tool 6: get_collection_stats', () => {
    it('calculates totals, backup percentage, and estimated collection value', async () => {
      const req = new Request('https://tracker.test/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 50,
          method: 'tools/call',
          params: {
            name: 'get_collection_stats',
            arguments: {},
          },
        }),
      });
      const res = await handleMcpRequest(req, mockEnv);
      const data = (await res.json()) as TestJsonRpcResponse;
      const parsed = JSON.parse(
        data.result?.content?.[0]?.text || '{}',
      ) as ParsedStatsResponse;
      expect(parsed.total_games_tracked).toBe(3);
      expect(parsed.owned_games_count).toBe(2);
      expect(parsed.backed_up_games_count).toBe(1);
      expect(parsed.missing_backup_count).toBe(1);
      expect(parsed.backup_completion_pct).toBe('50.0%');
      expect(parsed.total_toys_owned).toBe(1);
      expect(parsed.total_estimated_value_usd).toBe('$15.50');
      expect(parsed.top_platforms.length).toBeGreaterThan(0);
    });
  });

  describe('Tool 7: get_platforms', () => {
    it('returns parent platforms with child platforms subsumed', async () => {
      const req = new Request('https://tracker.test/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 60,
          method: 'tools/call',
          params: {
            name: 'get_platforms',
            arguments: {},
          },
        }),
      });
      const res = await handleMcpRequest(req, mockEnv);
      const data = (await res.json()) as TestJsonRpcResponse;
      const parsed = JSON.parse(
        data.result?.content?.[0]?.text || '{}',
      ) as ParsedPlatformsResponse;
      expect(parsed.count).toBe(2); // Wii and PS4 (PSVR is child)
      const platformNames = parsed.platforms.map((p) => p.name);
      expect(platformNames).toContain('Wii');
      expect(platformNames).toContain('PlayStation 4');
      expect(platformNames).not.toContain('PlayStation VR');
    });
  });

  describe('Tool 8: get_active_deals', () => {
    it('returns current retail deals with store and collection URLs', async () => {
      const req = new Request('https://tracker.test/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 70,
          method: 'tools/call',
          params: {
            name: 'get_active_deals',
            arguments: { min_discount_pct: 20 },
          },
        }),
      });
      const res = await handleMcpRequest(req, mockEnv);
      const data = (await res.json()) as TestJsonRpcResponse;
      const parsed = JSON.parse(
        data.result?.content?.[0]?.text || '{}',
      ) as ParsedDealsResponse;
      expect(parsed.deals_count).toBe(1);
      expect(parsed.deals[0]?.title).toBe('Metroid Prime 4: Beyond');
      expect(parsed.deals[0]?.store).toBe('Best Buy');
      expect(parsed.deals[0]?.store_url).toBe('https://bestbuy.com/metroid');
      expect(parsed.deals[0]?.collection_url).toBe(
        'https://tracker.test/collection/games/metroid-prime-4-switch',
      );
      expect(parsed.deals[0]?.already_owned).toBe(false);
    });
  });

  describe('Authentication Key Protection', () => {
    it('allows public access when MCP_AUTH_KEY is not set', async () => {
      const req = new Request('https://tracker.test/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 80, method: 'ping' }),
      });
      const res = await handleMcpRequest(req, mockEnv);
      expect(res.status).toBe(200);
    });

    it('rejects unauthenticated requests when MCP_AUTH_KEY is configured', async () => {
      const authedEnv = { ...mockEnv, MCP_AUTH_KEY: 'secret-token-123' };
      const req = new Request('https://tracker.test/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 81, method: 'ping' }),
      });
      const res = await handleMcpRequest(req, authedEnv);
      expect(res.status).toBe(401);
      const data = (await res.json()) as TestJsonRpcResponse;
      expect(data.error?.code).toBe(-32000);
    });

    it('accepts valid Bearer token when MCP_AUTH_KEY is configured', async () => {
      const authedEnv = { ...mockEnv, MCP_AUTH_KEY: 'secret-token-123' };
      const req = new Request('https://tracker.test/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer secret-token-123',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 82, method: 'ping' }),
      });
      const res = await handleMcpRequest(req, authedEnv);
      expect(res.status).toBe(200);
    });

    it('accepts valid ?token= parameter when MCP_AUTH_KEY is configured', async () => {
      const authedEnv = { ...mockEnv, MCP_AUTH_KEY: 'secret-token-123' };
      const req = new Request(
        'https://tracker.test/mcp?token=secret-token-123',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 83, method: 'ping' }),
        },
      );
      const res = await handleMcpRequest(req, authedEnv);
      expect(res.status).toBe(200);
    });
  });

  describe('Integration with worker.fetch', () => {
    it('routes /mcp directly in worker.fetch', async () => {
      const req = new Request('https://tracker.test/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 90, method: 'ping' }),
      });
      const res = await worker.fetch(req, mockEnv);
      expect(res.status).toBe(200);
      const data = (await res.json()) as TestJsonRpcResponse;
      expect(data.id).toBe(90);
    });

    it('routes /api/mcp directly in worker.fetch', async () => {
      const req = new Request('https://tracker.test/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 91, method: 'ping' }),
      });
      const res = await worker.fetch(req, mockEnv);
      expect(res.status).toBe(200);
      const data = (await res.json()) as TestJsonRpcResponse;
      expect(data.id).toBe(91);
    });
  });
});
