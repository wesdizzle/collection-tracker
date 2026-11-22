/**
 * Unit Tests for Fast-Track Backfill & Self-Healing Runner
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import {
  parseFastTrackStage,
  runFastTrackBackfill,
} from './fast_track_backfill.js';
import { normalizeTitleForMatching } from '../shared/title_matching.js';

describe('fast_track_backfill', () => {
  let tmpDir: string;
  let dbPath: string;
  let outDir: string;
  let cachePath: string;
  let schemaSql: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fast-track-spec-'));
    dbPath = path.join(tmpDir, 'test.db');
    outDir = path.join(tmpDir, 'sql_chunks');
    cachePath = path.join(tmpDir, 'igdb_cache.json');
    schemaSql = fs.readFileSync(
      path.resolve(process.cwd(), 'migrations', 'schema.sql'),
      'utf8',
    );
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function createTestDb(): Database.Database {
    const db = new Database(dbPath);
    db.exec(schemaSql);
    return db;
  }

  function buildMockIgdbFetch(counters: { calls: number }): typeof fetch {
    return (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('id.twitch.tv/oauth2/token')) {
        return new Response(
          JSON.stringify({ access_token: 'mock-token', expires_in: 3600 }),
          { status: 200 },
        );
      }
      counters.calls++;
      const bodyStr = String(init?.body || '');

      if (url.includes('api.igdb.com/v4/multiquery')) {
        if (bodyStr.includes('collections.name ~ *')) {
          return new Response(
            JSON.stringify([
              {
                name: 's0',
                result: [
                  {
                    id: 99001,
                    name: 'Fire Emblem Engage',
                    url: 'https://www.igdb.com/games/fire-emblem-engage',
                    summary: 'Tactical RPG.',
                    first_release_date: 1674172800,
                    platforms: [{ id: 130, name: 'Nintendo Switch' }],
                    collections: [{ name: 'Fire Emblem' }],
                    release_dates: [
                      { platform: 130, region: 2, date: 1674172800 },
                    ],
                    game_format: 1,
                  },
                  {
                    id: 99002,
                    name: 'Fire Emblem: Digital Sound Archive',
                    first_release_date: 1674172800,
                    platforms: [{ id: 130, name: 'Nintendo Switch' }],
                    collections: [{ name: 'Fire Emblem' }],
                    game_format: 2,
                  },
                ],
              },
            ]),
            { status: 200 },
          );
        }

        const results: Array<{ name: string; result: unknown[] }> = [];
        const lines = bodyStr.split('\n');
        for (const line of lines) {
          const nameMatch = line.match(/query games "(q\d+)"/);
          if (!nameMatch) continue;
          const qName = nameMatch[1];
          if (line.includes('Metroid') && line.includes('Dread')) {
            results.push({
              name: qName,
              result: [
                {
                  id: 70001,
                  name: 'Metroid Dread',
                  url: 'https://www.igdb.com/games/metroid-dread',
                  summary: 'Samus returns.',
                  first_release_date: 1633651200,
                  cover: { image_id: 'mdread' },
                  genres: [{ name: 'Platform' }],
                  collections: [{ name: 'Metroid' }],
                  platforms: [130],
                  release_dates: [
                    { platform: 130, region: 2, date: 1633651200 },
                  ],
                },
              ],
            });
          } else if (line.includes('Fire') && line.includes('Engage')) {
            results.push({
              name: qName,
              result: [
                {
                  id: 99001,
                  name: 'Fire Emblem Engage',
                  url: 'https://www.igdb.com/games/fire-emblem-engage',
                  summary: 'Tactical RPG.',
                  first_release_date: 1674172800,
                  platforms: [130],
                  collections: [{ name: 'Fire Emblem' }],
                  release_dates: [
                    { platform: 130, region: 2, date: 1674172800 },
                  ],
                },
              ],
            });
          } else if (line.includes('Chrono') && line.includes('Trigger')) {
            results.push({
              name: qName,
              result: [
                {
                  id: 70002,
                  name: 'Chrono Trigger',
                  url: 'https://www.igdb.com/games/chrono-trigger',
                  summary: 'Time-travel RPG.',
                  first_release_date: 794880000,
                  cover: { image_id: 'ctrigger' },
                  genres: [{ name: 'Role-playing (RPG)' }],
                  collections: [{ name: 'Chrono' }],
                  platforms: [19],
                  release_dates: [{ platform: 19, region: 2, date: 794880000 }],
                },
              ],
            });
          } else {
            results.push({ name: qName, result: [] });
          }
        }
        return new Response(JSON.stringify(results), { status: 200 });
      }

      if (url.includes('api.igdb.com/v4/games')) {
        return new Response(
          JSON.stringify([
            {
              id: 80001,
              name: 'Zelda Refreshed Game',
              url: 'https://www.igdb.com/games/zelda-refreshed',
              summary: 'Already summarized.',
              genres: [{ name: 'Adventure' }],
              collections: [{ name: 'The Legend of Zelda' }],
              franchises: [{ name: 'The Legend of Zelda' }],
              first_release_date: 1488499200,
              platforms: [130],
              release_dates: [{ platform: 130, region: 2, date: 1488499200 }],
            },
            {
              id: 80002,
              name: 'Unchanged Mario Game',
              collections: [{ name: 'Super Mario' }],
              franchises: [{ name: 'Super Mario' }],
              summary: 'Unchanged.',
              genres: [{ name: 'Platform' }],
              image_url: 'https://images.igdb.com/unchanged.jpg',
              cover: { image_id: 'mario_same' },
              platforms: [130],
            },
          ]),
          { status: 200 },
        );
      }

      return new Response('[]', { status: 200 });
    }) as typeof fetch;
  }

  it('validates stage parsing and executes all stages with dry-run SQL replayability, chunk splitting, dedup, silent rules, and IGDB disk cache reuse', async () => {
    expect(parseFastTrackStage(undefined)).toBe('all');
    expect(parseFastTrackStage('seed')).toBe('seed');
    expect(() => parseFastTrackStage('invalid')).toThrow(/Invalid --stage/);

    const db = createTestDb();
    try {
      db.exec(`
        INSERT INTO users (id, username, home_region)
        VALUES (1, 'collector', 'USA');
        INSERT INTO user_tracking_rules (user_id, rule_type, match_value, target_status, region_scope, is_ignored)
        VALUES
          (1, 'series', 'Metroid', 2, 'home', 0),
          (1, 'series', 'Fire Emblem', 2, 'home', 0);

        -- Existing bare game for igdb-backfill (Chrono Trigger SNES id=15)
        INSERT INTO games (stable_id, id, title, platform_id, region)
        VALUES (10, '10', 'Chrono Trigger', 15, 'USA');
        INSERT INTO game_releases (id, game_id, region)
        VALUES ('10-1', 10, 'USA');

        -- Existing enriched game whose series needs rolling self-heal + null release_date backfill
        INSERT INTO games (stable_id, id, title, platform_id, region, igdb_id, summary, genres, collections, canonical_series)
        VALUES (11, '11', 'Zelda Refreshed Game', 26, 'USA', 80001, 'Already summarized.', 'Adventure', 'Old Series', 'Old Series');
        INSERT INTO game_releases (id, game_id, region, release_date)
        VALUES ('11-1', 11, 'USA', NULL);

        -- Existing compilation (must NOT be suppressed by same CRC check)
        INSERT INTO games (stable_id, id, title, platform_id, region)
        VALUES (12, '12', 'Super Mario All-Stars Collection', 15, 'USA');
        INSERT INTO game_releases (id, game_id, region, rom_crc)
        VALUES ('12-1', 12, 'USA', 'deadbeef');

        -- Existing game matching canonicalMetroid CRC duplicate (must dedup and NOT insert duplicate game)
        INSERT INTO games (stable_id, id, title, platform_id, region)
        VALUES (13, '13', 'Existing Duplicate Game', 26, 'USA');
        INSERT INTO game_releases (id, game_id, region, rom_crc)
        VALUES ('13-1', 13, 'USA', 'cafebabe');

        -- Canonical releases for seed & series-discovery
        INSERT INTO canonical_releases (id, platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, serial_code, source, is_verified_physical)
        VALUES
          (101, 26, 'Metroid Dread: Special Edition (USA)', '${normalizeTitleForMatching('Metroid Dread: Special Edition')}', 'USA', 'Special Edition', NULL, NULL, 'LA-H-AYL8A-USA', 'nintendo_revised', 1),
          (102, 26, 'Metroid Dread: Special Edition (Europe)', '${normalizeTitleForMatching('Metroid Dread: Special Edition')}', 'Europe', 'Special Edition', NULL, NULL, 'LA-H-AYL8A-EUR', 'nintendo_revised', 1),
          (103, 26, 'Duplicate CRC Variant', '${normalizeTitleForMatching('Duplicate CRC Variant')}', 'USA', NULL, 'dup.xci', 'CAFEBABE', NULL, 'dat', 1),
          (104, 26, 'World Placeholder Only', '${normalizeTitleForMatching('World Placeholder Only')}', 'World', NULL, NULL, NULL, NULL, 'nintendo_revised', 1),
          (105, 26, 'Fire Emblem Engage (USA)', '${normalizeTitleForMatching('Fire Emblem Engage')}', 'USA', NULL, NULL, NULL, 'LA-H-AYFNA-USA', 'nintendo_revised', 1);
      `);
    } finally {
      db.close();
    }

    const baselineCopyPath = path.join(tmpDir, 'baseline_copy.db');
    fs.copyFileSync(dbPath, baselineCopyPath);

    const netCounters = { calls: 0 };
    const mockFetch = buildMockIgdbFetch(netCounters);

    // 1. Run all stages in dry-run with small maxChunkWrites to force chunk splitting
    const drySummary = await runFastTrackBackfill({
      stage: 'all',
      dbPath,
      outDir,
      dryRun: true,
      maxChunkWrites: 120,
      igdbCachePath: cachePath,
      delayMs: 0,
      fetchFn: mockFetch,
      twitchClientId: 'mock-id',
      twitchClientSecret: 'mock-secret',
    });

    expect(drySummary.seed.insertedGames).toBe(2); // Metroid Dread Special Edition + Fire Emblem Engage
    expect(drySummary.seed.insertedReleases).toBe(3); // 2 Metroid regions + 1 Fire Emblem (dup CRC on game 13 skipped)
    expect(drySummary.seed.rulesApplied).toBe(2); // Metroid Dread USA + Fire Emblem Engage USA
    expect(drySummary.igdbBackfill.matchedGames).toBe(1); // Chrono Trigger
    expect(drySummary.igdbBackfill.updatedReleaseDates).toBe(1);
    expect(drySummary.rolling.updatedGames).toBe(1); // Zelda Refreshed Game
    expect(drySummary.rolling.updatedReleaseDates).toBe(1);
    expect(drySummary.seriesDiscovery.seriesScanned).toBe(2);
    // Fire Emblem Engage was already seeded in Stage 1, and Digital Sound Archive is filtered out by game_format=2
    expect(drySummary.seriesDiscovery.insertedGames).toBe(0);
    expect(drySummary.chunkFiles.length).toBeGreaterThanOrEqual(4);
    expect(fs.existsSync(cachePath)).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'manifest.json'))).toBe(true);
    expect(netCounters.calls).toBeGreaterThan(0);

    // Verify local SQLite DB was NOT mutated during dry-run
    const dryCheckDb = new Database(dbPath, { readonly: true });
    const countAfterDry = (
      dryCheckDb.prepare('SELECT COUNT(*) as c FROM games').get() as {
        c: number;
      }
    ).c;
    dryCheckDb.close();
    expect(countAfterDry).toBe(4);

    // Verify all emitted SQL chunks contain ZERO legacy column references and replay cleanly
    const replayDb = new Database(baselineCopyPath);
    replayDb.pragma('foreign_keys = ON');
    for (const chunkFile of drySummary.chunkFiles) {
      const sql = fs.readFileSync(chunkFile, 'utf8');
      expect(sql).not.toMatch(
        /\b(physical_status|verification_tier|release_medium|origin_metadata)\b/,
      );
      replayDb.exec(sql);
    }

    // Check numeric ID invariant and edition preservation on replayed DB
    const metroid = replayDb
      .prepare(
        "SELECT stable_id, id, title, igdb_id, canonical_series FROM games WHERE title LIKE 'Metroid Dread%'",
      )
      .get() as {
      stable_id: number;
      id: string;
      title: string;
      igdb_id: number;
      canonical_series: string;
    };
    expect(metroid).toBeDefined();
    expect(metroid.id).toBe(String(metroid.stable_id));
    expect(metroid.title).toContain('Special Edition');
    expect(metroid.igdb_id).toBe(70001);
    expect(metroid.canonical_series).toBe('Metroid');

    const metroidRels = replayDb
      .prepare(
        'SELECT id, region FROM game_releases WHERE game_id = ? ORDER BY id',
      )
      .all(metroid.stable_id) as Array<{ id: string; region: string }>;
    expect(metroidRels.map((r) => r.id)).toEqual([
      `${metroid.stable_id}-1`,
      `${metroid.stable_id}-2`,
    ]);

    // Check silent tracking rule application (Metroid USA marked Seeking = 2, Europe NOT auto-tracked under home scope)
    const ugrRows = replayDb
      .prepare(
        'SELECT release_id, ownership_status FROM user_game_releases WHERE user_id = 1',
      )
      .all() as Array<{ release_id: string; ownership_status: number }>;
    expect(ugrRows).toContainEqual({
      release_id: `${metroid.stable_id}-1`,
      ownership_status: 2,
    });
    expect(ugrRows.some((r) => r.release_id === `${metroid.stable_id}-2`)).toBe(
      false,
    );

    // Check cursor advancement & rolling self-heal
    const cursorRow = replayDb
      .prepare("SELECT value FROM sync_state WHERE key = 'catalog_seed_cursor'")
      .get() as { value: string };
    expect(cursorRow.value).toBe('105');

    const zelda = replayDb
      .prepare('SELECT canonical_series FROM games WHERE stable_id = 11')
      .get() as { canonical_series: string };
    expect(zelda.canonical_series).toBe('The Legend of Zelda');

    const zeldaRel = replayDb
      .prepare("SELECT release_date FROM game_releases WHERE id = '11-1'")
      .get() as { release_date: string | null };
    expect(zeldaRel.release_date).toBe('2017-03-03');
    replayDb.close();

    // 2. Re-run in live mode against a fresh copy with pre-warmed disk cache:
    // verify IGDB cache eliminates network requests & series-discovery inserts unseen series entry!
    const outDir2 = path.join(tmpDir, 'sql_chunks_2');
    const netCallsBeforeSecondRun = netCounters.calls;
    const db2 = new Database(dbPath);
    db2.exec('DELETE FROM canonical_releases WHERE id = 105;'); // Keep Fire Emblem Engage out of seed so series-discovery finds it!
    db2.close();

    const liveSummary = await runFastTrackBackfill({
      stage: 'all',
      dbPath,
      outDir: outDir2,
      dryRun: false,
      igdbCachePath: cachePath,
      delayMs: 0,
      fetchFn: mockFetch,
      twitchClientId: 'mock-id',
      twitchClientSecret: 'mock-secret',
    });

    expect(netCounters.calls).toBe(netCallsBeforeSecondRun);
    expect(liveSummary.igdbCacheHits).toBeGreaterThanOrEqual(4);
    expect(liveSummary.igdbNetworkCalls).toBe(0);
    expect(liveSummary.seriesDiscovery.insertedGames).toBe(1); // Fire Emblem Engage discovered!
    expect(liveSummary.seriesDiscovery.rulesApplied).toBe(1);

    // 3. Re-running rolling stage on unchanged live DB emits zero game UPDATEs
    const rollingOnlyOut = path.join(tmpDir, 'sql_rolling_noop');
    const noopSummary = await runFastTrackBackfill({
      stage: 'rolling',
      dbPath,
      outDir: rollingOnlyOut,
      dryRun: false,
      igdbCachePath: cachePath,
      delayMs: 0,
      fetchFn: mockFetch,
      twitchClientId: 'mock-id',
      twitchClientSecret: 'mock-secret',
    });
    expect(noopSummary.rolling.updatedGames).toBe(0);
    expect(noopSummary.rolling.updatedReleaseDates).toBe(0);
  });
});
