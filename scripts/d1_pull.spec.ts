import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { hydrateTableFromChunkFiles } from './d1_pull.js';
import { SCHEMA_SQL_PATH } from './d1_cost_guard.js';

describe('d1_pull chunked R2 hydration', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'd1-pull-spec-'));
    dbPath = path.join(tempDir, 'test.sqlite');
    const db = new Database(dbPath);
    db.exec(fs.readFileSync(SCHEMA_SQL_PATH, 'utf8'));
    db.close();
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('hydrates games, game_releases, and canonical_releases across multi-chunk JSON files while preserving user overlays', () => {
    const seedDb = new Database(dbPath);
    seedDb.exec(`
      INSERT INTO users (id, username, home_region) VALUES (1, 'alice', 'USA');
      INSERT INTO games (stable_id, id, title, platform_id) VALUES (999, 'stale', 'Stale Game', 1);
    `);
    seedDb.close();

    const gamesChunk0 = path.join(tempDir, 'games-000.json');
    const gamesChunk1 = path.join(tempDir, 'games-001.json');
    const relChunk0 = path.join(tempDir, 'game_releases-000.json');
    const canonChunk0 = path.join(tempDir, 'canonical_releases-000.json');
    const canonChunk1 = path.join(tempDir, 'canonical_releases-001.json');

    fs.writeFileSync(
      gamesChunk0,
      JSON.stringify({
        table: 'games',
        chunkIndex: 0,
        rowCount: 1,
        rows: [
          {
            stable_id: 101,
            id: '101',
            title: 'Super Metroid',
            platform_id: 15,
            region: 'USA',
          },
        ],
      }),
      'utf8',
    );
    fs.writeFileSync(
      gamesChunk1,
      JSON.stringify({
        table: 'games',
        chunkIndex: 1,
        rowCount: 1,
        rows: [
          {
            stable_id: 102,
            id: '102',
            title: 'Chrono Trigger',
            platform_id: 15,
            region: 'USA',
          },
        ],
      }),
      'utf8',
    );
    fs.writeFileSync(
      relChunk0,
      JSON.stringify({
        table: 'game_releases',
        chunkIndex: 0,
        rowCount: 2,
        rows: [
          { id: '101-1', game_id: 101, region: 'USA' },
          { id: '102-1', game_id: 102, region: 'USA' },
        ],
      }),
      'utf8',
    );
    fs.writeFileSync(
      canonChunk0,
      JSON.stringify({
        table: 'canonical_releases',
        chunkIndex: 0,
        rowCount: 1,
        rows: [
          {
            id: 1,
            platform_id: 15,
            raw_title: 'Super Metroid (USA)',
            normalized_title: 'supermetroid',
            region: 'USA',
            source: 'dat',
            is_verified_physical: 1,
          },
        ],
      }),
      'utf8',
    );
    fs.writeFileSync(
      canonChunk1,
      JSON.stringify({
        table: 'canonical_releases',
        chunkIndex: 1,
        rowCount: 1,
        rows: [
          {
            id: 2,
            platform_id: 15,
            raw_title: 'Chrono Trigger (USA)',
            normalized_title: 'chronotrigger',
            region: 'USA',
            source: 'dat',
            is_verified_physical: 1,
          },
        ],
      }),
      'utf8',
    );

    expect(
      hydrateTableFromChunkFiles(dbPath, 'games', [gamesChunk0, gamesChunk1]),
    ).toBe(2);
    expect(
      hydrateTableFromChunkFiles(dbPath, 'game_releases', [relChunk0]),
    ).toBe(2);
    expect(
      hydrateTableFromChunkFiles(dbPath, 'canonical_releases', [
        canonChunk0,
        canonChunk1,
      ]),
    ).toBe(2);

    const verifyDb = new Database(dbPath, { readonly: true });
    try {
      const games = verifyDb
        .prepare('SELECT stable_id, title FROM games ORDER BY stable_id ASC')
        .all();
      expect(games).toEqual([
        { stable_id: 101, title: 'Super Metroid' },
        { stable_id: 102, title: 'Chrono Trigger' },
      ]);
      const relCount = (
        verifyDb.prepare('SELECT COUNT(*) AS c FROM game_releases').get() as {
          c: number;
        }
      ).c;
      const canonCount = (
        verifyDb
          .prepare('SELECT COUNT(*) AS c FROM canonical_releases')
          .get() as { c: number }
      ).c;
      expect(relCount).toBe(2);
      expect(canonCount).toBe(2);
      expect(verifyDb.pragma('integrity_check')).toEqual([
        { integrity_check: 'ok' },
      ]);
    } finally {
      verifyDb.close();
    }
  });

  it('rejects unsafe table identifiers', () => {
    expect(() =>
      hydrateTableFromChunkFiles(dbPath, 'games; DROP TABLE users;', []),
    ).toThrow(/Unsafe table identifier/);
  });
});
