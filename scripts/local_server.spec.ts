import { describe, it, expect, beforeEach, vi, type Mocked } from 'vitest';
import Database from 'better-sqlite3';
import { handleRequest } from './local_server';
import { EventEmitter } from 'events';
import axios from 'axios';

vi.mock('axios');
const mockedAxios = axios as Mocked<typeof axios>;

vi.mock('./lib/dat_cache.js', () => ({
  getPlatformDatReleases: vi.fn(() => [
    {
      name: 'Bloodborne (USA)',
      romName: 'Bloodborne (USA).bin',
      romCrc: '12345678',
      region: 'USA',
      variants: null,
      releaseDate: null,
    },
  ]),
}));

vi.mock('./lib/igdb.js', () => ({
  getGameById: vi.fn((id) =>
    Promise.resolve({
      id: `igdb-${id}`,
      name: 'Bloodborne',
      summary: 'A dark action RPG.',
      image_url: 'http://example.com/cover.png',
      platform: 'PlayStation 4',
      platforms: [{ id: 48, name: 'PlayStation 4' }],
      release_date: '2015-03-24',
      collections: 'Bloodborne Series',
      franchises: null,
      genres: 'Role-playing (RPG)',
    }),
  ),
  findGame: vi.fn((query) =>
    Promise.resolve([
      {
        id: query === 'Elden Ring' ? 'igdb-999' : 'igdb-101',
        name: query || 'Bloodborne',
        platform: 'PlayStation 4',
        platform_ids: [48],
        image_url: 'http://example.com/cover.png',
      },
    ]),
  ),
  getCollectionGames: vi.fn(() =>
    Promise.resolve([
      {
        id: 101,
        name: 'Bloodborne',
        platforms: [{ id: 48, name: 'PlayStation 4' }],
      },
    ]),
  ),
  getGamesByIds: vi.fn((ids) =>
    Promise.resolve(
      ids.map((id: number) => ({
        id: `igdb-${id}`,
        name: 'Bloodborne',
        summary: 'A dark action RPG.',
        image_url: 'http://example.com/cover.png',
        platforms: [{ id: 48, name: 'PlayStation 4' }],
        release_date: '2015-03-24',
        collections: 'Bloodborne Series',
        franchises: null,
        genres: 'Role-playing (RPG)',
      })),
    ),
  ),
  queryIGDB: vi.fn(() =>
    Promise.resolve([{ id: 202, name: 'Bloodborne Series' }]),
  ),
  PLATFORM_MAP: { 'PlayStation 4': 48, 'PlayStation VR': 165 },
}));

/**
 * UNIT TEST: Local Server API Logic
 *
 * Verifies that the Node.js standalone server correctly implements
 * the collection API using shared queries and handles platform hierarchy.
 */

describe('Local Server API Logic', () => {
  let mockDb: Database.Database;

  interface ToyRow {
    id: number;
    name: string;
    line: string;
    series: string;
    amiibo_id: string | null;
    verified: number;
  }

  beforeEach(() => {
    // Setup in-memory DB
    mockDb = new Database(':memory:');
    mockDb.exec(`
            CREATE TABLE platforms (
                id INTEGER PRIMARY KEY, 
                name TEXT,
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
                owned BOOLEAN,
                sort_index INTEGER,
                queued BOOLEAN,
                image_url TEXT,
                play_status TEXT,
                backup_status INTEGER DEFAULT 0,
                igdb_id INTEGER,
                igdb_url TEXT,
                summary TEXT,
                genres TEXT,
                collections TEXT,
                franchises TEXT,
                manually_verified BOOLEAN,
                metadata_json TEXT,
                region TEXT,
                physical_status TEXT DEFAULT 'unverified',
                verification_tier INTEGER DEFAULT 0,
                barcode TEXT,
                release_medium TEXT DEFAULT 'physical_retail',
                origin_metadata TEXT,
                bundle_parent_id INTEGER,
                bundle_disc_number INTEGER
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
                release_date DATE,
                canonical_release_id INTEGER,
                barcode TEXT,
                is_physical INTEGER DEFAULT 1
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
                details TEXT
            );
        `);

    // Seed data
    mockDb
      .prepare(
        'INSERT INTO platforms (id, name, display_name, brand, launch_date, parent_platform_id) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(34, 'PlayStation 4', 'PlayStation 4', 'Sony', '2013-11-15', null);
    mockDb
      .prepare(
        'INSERT INTO platforms (id, name, display_name, brand, launch_date, parent_platform_id) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(51, 'PlayStation VR', 'PlayStation VR', 'Sony', '2016-10-13', 34);
    mockDb
      .prepare(
        'INSERT INTO games (stable_id, id, title, platform_id) VALUES (?, ?, ?, ?)',
      )
      .run(1, 'game-1', 'Bloodborne', 34);
    mockDb
      .prepare(
        'INSERT INTO game_releases (id, game_id, region, variants, rom_name, rom_crc, backup_status, ownership_status, release_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run('game-1', 1, 'USA', null, null, null, 0, 1, '2015-03-24');

    mockDb
      .prepare(
        'INSERT INTO games (stable_id, id, title, platform_id) VALUES (?, ?, ?, ?)',
      )
      .run(2, 'game-2', 'PSVR Demo Disc', 51);
    mockDb
      .prepare(
        'INSERT INTO game_releases (id, game_id, region, variants, rom_name, rom_crc, backup_status, ownership_status, release_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run('game-2', 2, 'USA', null, null, null, 0, 1, '2016-10-13');
  });

  /**
   * Helper to mock Node.js req/res objects for testing request handlers.
   *
   * @param url - The target endpoint URL for the mock request.
   * @param method - The HTTP request method (e.g. 'GET', 'POST').
   * @returns An object containing the mocked Request and Response instances.
   * @throws None.
   */
  const createMocks = (url: string, method = 'GET') => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = new EventEmitter() as any;
    req.url = url;
    req.method = method;
    req.headers = {};

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = new EventEmitter() as any;
    res.setHeader = vi.fn();
    res.end = vi.fn();
    res.statusCode = 200;

    return { req, res };
  };

  /**
   * Helper to mock Node.js req/res objects specifically for endpoints requiring request bodies.
   * Emits request body payload asynchronously in the next tick to simulate HTTP body reception.
   */
  const createDiscoveryMocks = (url: string, method = 'POST', body = {}) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = new EventEmitter() as any;
    req.url = url;
    req.method = method;
    req.headers = { 'content-type': 'application/json' };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = new EventEmitter() as any;
    res.setHeader = vi.fn();
    res.end = vi.fn();
    res.statusCode = 200;

    process.nextTick(() => {
      req.emit('data', Buffer.from(JSON.stringify(body)));
      req.emit('end');
    });

    return { req, res };
  };

  it('should return games list with normalized platform info', async () => {
    const { req, res } = createMocks('/api/games');
    const handler = handleRequest(mockDb);

    await handler(req, res);

    expect(res.end).toHaveBeenCalled();
    const output = JSON.parse(res.end.mock.calls[0][0]);

    // Both games should be returned
    expect(output.length).toBe(2);

    // PSVR game should have PS4 info coalesced
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const psvrGame = output.find((g: any) => g.platform_id === 51);
    expect(psvrGame.display_name).toBe('PlayStation 4'); // Coalesced from parent
    expect(psvrGame.parent_platform_id).toBe(34);
  });

  it('should filter games by parent platform (including child platforms)', async () => {
    const { req, res } = createMocks('/api/games?platform=34'); // Filter by PS4
    const handler = handleRequest(mockDb);

    await handler(req, res);

    const output = JSON.parse(res.end.mock.calls[0][0]);

    // Should include both PS4 game and PSVR game
    expect(output.length).toBe(2);
    expect(
      output.every(
        (g: { platform_id: number; parent_platform_id: number | null }) =>
          g.platform_id === 34 || g.parent_platform_id === 34,
      ),
    ).toBe(true);
  });

  it('should return game detail with normalized platform info', async () => {
    const { req, res } = createMocks('/api/games/game-2'); // The PSVR game
    const handler = handleRequest(mockDb);

    await handler(req, res);

    const output = JSON.parse(res.end.mock.calls[0][0]);

    expect(output.title).toBe('PSVR Demo Disc');
    expect(output.display_name).toBe('PlayStation 4'); // Coalesced
    expect(output.platform_launch_date).toBe('2013-11-15'); // PS4 launch date
  });

  it('should list platforms excluding children', async () => {
    const { req, res } = createMocks('/api/platforms');
    const handler = handleRequest(mockDb);

    await handler(req, res);

    const output = JSON.parse(res.end.mock.calls[0][0]);

    // Should only have PS4, not PSVR
    expect(output.length).toBe(1);
    expect(output[0].id).toBe(34);
    expect(output[0].parent_platform_id).toBeNull();
  });

  describe('Discovery Amiibo & Toy Ingestion Logic', () => {
    it('should scan amiibo and return missing items', async () => {
      mockDb
        .prepare(
          'INSERT INTO toys (id, name, line, series, amiibo_id) VALUES (?, ?, ?, ?, ?)',
        )
        .run(
          'amiibo-mario',
          'Mario',
          'amiibo',
          'Super Mario',
          '0000000000000002',
        );

      mockedAxios.get.mockResolvedValue({
        data: {
          amiibo: [
            {
              head: '00000000',
              tail: '00000002',
              name: 'Mario',
              type: 'Figure',
              image: 'http://example.com/mario.png',
              gameSeries: 'Super Mario',
              amiiboSeries: 'Super Mario',
            },
            {
              head: '01030000',
              tail: '003f0502',
              name: 'Zelda - TOTK',
              type: 'Figure',
              image: 'http://example.com/zelda.png',
              gameSeries: 'The Legend of Zelda',
              amiiboSeries: 'The Legend of Zelda',
              release: { na: '2023-11-03' },
            },
          ],
        },
      });

      const { req, res } = createDiscoveryMocks(
        '/api/discovery/scan-amiibo',
        'GET',
      );
      const handler = handleRequest(mockDb);

      await handler(req, res);

      expect(res.end).toHaveBeenCalled();
      const output = JSON.parse(res.end.mock.calls[0][0]);
      expect(output.length).toBe(1);
      expect(output[0].name).toBe('Zelda - TOTK');
      expect(output[0].amiibo_id).toBe('01030000003f0502');
    });

    it('should ingest a new toy via /api/discovery/add-toy', async () => {
      const payload = {
        name: 'Zelda - TOTK',
        line: 'amiibo',
        series_name: 'The Legend of Zelda',
        amiibo_id: '01030000003f0502',
        type: 'Figure',
        image_url: 'http://example.com/zelda.png',
        ownership_status: 1,
      };

      const { req, res } = createDiscoveryMocks(
        '/api/discovery/add-toy',
        'POST',
        payload,
      );
      const handler = handleRequest(mockDb);

      await handler(req, res);

      expect(res.end).toHaveBeenCalled();
      const output = JSON.parse(res.end.mock.calls[0][0]);
      expect(output.success).toBe(true);

      const inserted = mockDb
        .prepare("SELECT * FROM toys WHERE amiibo_id = '01030000003f0502'")
        .get() as ToyRow;
      expect(inserted).toBeDefined();
      expect(inserted.name).toBe('Zelda - TOTK');
      expect(inserted.verified).toBe(1);
    });
  });

  describe('Collection Toggle Logic', () => {
    beforeEach(() => {
      // Seed a multi-disc game
      mockDb
        .prepare(
          'INSERT INTO games (stable_id, id, title, platform_id, region) VALUES (?, ?, ?, ?, ?)',
        )
        .run(10, 'mgs-ps1', 'Metal Gear Solid', 34, 'USA');

      mockDb
        .prepare(
          'INSERT INTO game_releases (id, game_id, region, variants, rom_name, rom_crc, backup_status, ownership_status, release_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'mgs-disc1',
          10,
          'USA',
          null,
          'Metal Gear Solid (USA) (Disc 1).cue',
          null,
          0,
          0,
          '1998-09-03',
        );

      mockDb
        .prepare(
          'INSERT INTO game_releases (id, game_id, region, variants, rom_name, rom_crc, backup_status, ownership_status, release_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'mgs-disc2',
          10,
          'USA',
          null,
          'Metal Gear Solid (USA) (Disc 2).cue',
          null,
          0,
          0,
          '1998-09-03',
        );
    });

    it('should update ownership_status for all discs in the same release group', async () => {
      const payload = {
        id: 'mgs-disc1',
        type: 'game',
        status: 1,
        field: 'ownership_status',
      };

      const { req, res } = createDiscoveryMocks(
        '/api/collection/toggle',
        'POST',
        payload,
      );
      const handler = handleRequest(mockDb);

      await handler(req, res);

      const disc1 = mockDb
        .prepare(
          "SELECT ownership_status FROM game_releases WHERE id = 'mgs-disc1'",
        )
        .get() as { ownership_status: number };
      const disc2 = mockDb
        .prepare(
          "SELECT ownership_status FROM game_releases WHERE id = 'mgs-disc2'",
        )
        .get() as { ownership_status: number };

      expect(disc1.ownership_status).toBe(1);
      expect(disc2.ownership_status).toBe(1);
    });

    it('should update backup_status individually for only the target release/disc', async () => {
      const payload = {
        id: 'mgs-disc1',
        type: 'game',
        status: 1,
        field: 'backup_status',
      };

      const { req, res } = createDiscoveryMocks(
        '/api/collection/toggle',
        'POST',
        payload,
      );
      const handler = handleRequest(mockDb);

      await handler(req, res);

      const disc1 = mockDb
        .prepare(
          "SELECT backup_status FROM game_releases WHERE id = 'mgs-disc1'",
        )
        .get() as { backup_status: number };
      const disc2 = mockDb
        .prepare(
          "SELECT backup_status FROM game_releases WHERE id = 'mgs-disc2'",
        )
        .get() as { backup_status: number };

      expect(disc1.backup_status).toBe(1);
      expect(disc2.backup_status).toBe(0);
    });

    it('should update play_status on the games table', async () => {
      const payload = {
        id: 'mgs-disc1',
        type: 'game',
        status: 2, // Playing
        field: 'play_status',
      };

      const { req, res } = createDiscoveryMocks(
        '/api/collection/toggle',
        'POST',
        payload,
      );
      const handler = handleRequest(mockDb);

      await handler(req, res);

      const game = mockDb
        .prepare('SELECT play_status FROM games WHERE stable_id = 10')
        .get() as { play_status: string | number };

      expect(Number(game.play_status)).toBe(2);
    });
  });

  describe('Ingestion and Discovery Endpoints', () => {
    it('should search games on IGDB via /api/discovery/search', async () => {
      const { req, res } = createMocks(
        '/api/discovery/search?query=Elden+Ring&platformId=34',
      );
      const handler = handleRequest(mockDb);
      await handler(req, res);
      expect(res.end).toHaveBeenCalled();
      const output = JSON.parse(res.end.mock.calls[0][0]);
      expect(output).toHaveLength(1);
      expect(output[0].name).toBe('Elden Ring');
    });

    it('should filter out already collected games in /api/discovery/search', async () => {
      const { req, res } = createMocks(
        '/api/discovery/search?query=Bloodborne&platformId=34',
      );
      const handler = handleRequest(mockDb);
      await handler(req, res);
      expect(res.end).toHaveBeenCalled();
      const output = JSON.parse(res.end.mock.calls[0][0]);
      expect(output).toHaveLength(0);
    });

    it('should get matches and details via /api/discovery/matches', async () => {
      mockDb
        .prepare(
          `
          INSERT INTO canonical_releases (platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, source, is_verified_physical)
          VALUES (34, 'Bloodborne', 'bloodborne', 'USA', NULL, 'Bloodborne (USA).bin', '12345678', 'dat', 1)
        `,
        )
        .run();

      const { req, res } = createMocks(
        '/api/discovery/matches?igdbId=101&platformId=34',
      );
      const handler = handleRequest(mockDb);
      await handler(req, res);
      expect(res.end).toHaveBeenCalled();
      const output = JSON.parse(res.end.mock.calls[0][0]);
      expect(output.game.name).toBe('Bloodborne');
      expect(output.matchedReleases).toHaveLength(1);
      expect(output.matchedReleases[0].name).toBe('Bloodborne');
      expect(output.physical_status).toBe('verified_physical');
    });

    it('should transactionally add a game and releases via /api/discovery/add', async () => {
      const payload = {
        game: {
          title: 'Bloodborne II',
          platform_id: 34,
          igdb_id: 102,
          igdb_url: 'http://example.com/bloodborne2',
          summary: 'A sequel.',
          genres: 'RPG',
          region: 'USA',
          image_url: 'http://example.com/cover.png',
        },
        releases: [
          {
            region: 'USA',
            variants: null,
            rom_name: 'Bloodborne (USA).bin',
            rom_crc: '12345678',
            ownership_status: 1,
            backup_status: 0,
            release_date: '2015-03-24',
          },
        ],
      };
      const { req, res } = createDiscoveryMocks(
        '/api/discovery/add',
        'POST',
        payload,
      );
      const handler = handleRequest(mockDb);
      await handler(req, res);
      expect(res.end).toHaveBeenCalled();
      const output = JSON.parse(res.end.mock.calls[0][0]);
      expect(output.success).toBe(true);

      const dbGame = mockDb
        .prepare("SELECT * FROM games WHERE id = 'bloodborne-ii-playstation-4'")
        .get() as { stable_id: number; title: string } | undefined;
      expect(dbGame).toBeDefined();
      expect(dbGame!.title).toBe('Bloodborne II');

      // Verify inserted release
      const dbRelease = mockDb
        .prepare('SELECT * FROM game_releases WHERE game_id = ?')
        .get(dbGame!.stable_id) as { rom_name: string } | undefined;
      expect(dbRelease).toBeDefined();
      expect(dbRelease!.rom_name).toBe('Bloodborne (USA).bin');
    });

    it('should scan for missing series games via /api/discovery/scan-series', async () => {
      // Seed a game with canonical_series 'Bloodborne Series'
      mockDb
        .prepare(
          "UPDATE games SET canonical_series = 'Bloodborne Series' WHERE stable_id = 1",
        )
        .run();

      const { req, res } = createMocks('/api/discovery/scan-series');
      const handler = handleRequest(mockDb);
      await handler(req, res);
      expect(res.end).toHaveBeenCalled();
      const output = JSON.parse(res.end.mock.calls[0][0]);
      console.log('--- SCAN-SERIES DEBUG OUTPUT ---', output);
      expect(output.length).toBeGreaterThan(0);
      expect(output[0].title).toBe('Bloodborne');
      expect(output[0].releases).toBeDefined();
    });
  });
});
