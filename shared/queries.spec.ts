import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import {
  D1_MAX_COMPOUND_SELECT_TERMS,
  getMaxCompoundSelectTerms,
} from '../scripts/d1_cost_guard.js';
import {
  resolveLocalizedReleaseTitle,
  buildTargetedCompanionByCrcBatchQuery,
  buildCatalogGamesChunkQuery,
  buildCatalogDeltaGamesQuery,
  buildGamesListQuery,
  buildGameDetailQuery,
  getGameDetailQueryParams,
  buildGameReleasesByGameIdQuery,
  buildTargetedCompanionByIgdbIdQuery,
  buildTargetedCompanionByVersionParentQuery,
  buildVersionParentChildrenCompanionQuery,
  enrichGameDetailWithCompanionsAndVouchers,
  ACTIVE_GAMES_LIST_WHERE_CLAUSE,
  ACTIVE_GAMES_PUBLIC_WHERE_CLAUSE,
  CATALOG_GAMES_CHUNK_BOUND_QUERY,
  CATALOG_GAMES_CHUNK_SIZE,
  CATALOG_GAMES_PER_CHUNK,
  CATALOG_MAX_GAME_STABLE_ID_QUERY,
  CATALOG_MAX_TOY_STABLE_ID_QUERY,
  GAMES_HAS_MANY_ROWS_QUERY,
  USER_GAME_RELEASES_OVERLAY_QUERY,
  USER_GAMES_OVERLAY_QUERY,
  USER_TOYS_OVERLAY_QUERY,
  TOYS_DELTA_LIST_QUERY,
  enrichAndStripGameListRow,
  postProcessGameListRows,
  postProcessToyListRows,
} from './queries.js';

describe('resolveLocalizedReleaseTitle', () => {
  const apeEscapeMetadata = JSON.stringify({
    game_localizations: [
      { region: 3, name: 'サルゲッチュ' },
      { region: 4, name: 'Ape Escape' },
    ],
    alternative_names: [
      { comment: 'Japanese title', name: 'サルゲッチュ' },
      {
        comment: 'Spanish title',
        name: 'Ape Escape: La Invasión de los Monos',
      },
      { comment: 'Japanese title (romanized)', name: 'Saru Get You' },
    ],
  });

  it('resolves native Japanese Katakana title for Japan releases', () => {
    const title = resolveLocalizedReleaseTitle(
      'Ape Escape',
      'Japan',
      apeEscapeMetadata,
      'Saru! Get You!',
    );
    expect(title).toBe('サルゲッチュ');
  });

  it('resolves native Japanese Katakana title for Japan, Asia releases', () => {
    const title = resolveLocalizedReleaseTitle(
      'Ape Escape',
      'Japan, Asia',
      apeEscapeMetadata,
      'Saru! Get You!',
    );
    expect(title).toBe('サルゲッチュ');
  });

  it('resolves Spanish localized title from alternative_names for Spain releases', () => {
    const title = resolveLocalizedReleaseTitle(
      'Ape Escape',
      'Spain',
      apeEscapeMetadata,
      'Ape Escape - La Invasion de los Monos',
    );
    expect(title).toBe('Ape Escape: La Invasión de los Monos');
  });

  it('resolves European title from game_localizations for Europe releases', () => {
    const title = resolveLocalizedReleaseTitle(
      'Ape Escape',
      'Europe',
      apeEscapeMetadata,
      'Ape Escape',
    );
    expect(title).toBe('Ape Escape');
  });

  it('defaults to English gameTitle for USA releases', () => {
    const title = resolveLocalizedReleaseTitle(
      'Ape Escape',
      'USA',
      apeEscapeMetadata,
      'Ape Escape',
    );
    expect(title).toBe('Ape Escape');
  });

  it('resolves native Korean Hangul title when present', () => {
    const koreanMetadata = JSON.stringify({
      game_localizations: [{ region: 2, name: '사루겟츄' }],
      alternative_names: [{ comment: 'Korean title', name: '사루겟츄' }],
    });
    const title = resolveLocalizedReleaseTitle(
      'Ape Escape',
      'Korea',
      koreanMetadata,
      'Ape Escape',
    );
    expect(title).toBe('사루겟츄');
  });

  it('falls back to canonicalTitle when metadata_json is null or missing localized title', () => {
    const title = resolveLocalizedReleaseTitle(
      'Resident Evil 3: Nemesis',
      'Japan',
      null,
      'Biohazard 3 - Last Escape',
    );
    expect(title).toBe('Biohazard 3 - Last Escape');
  });

  it('falls back to gameTitle when canonicalTitle matches gameTitle or is empty', () => {
    const title = resolveLocalizedReleaseTitle(
      'Super Mario 64',
      'USA',
      null,
      'Super Mario 64',
    );
    expect(title).toBe('Super Mario 64');
  });

  it('handles invalid metadata_json gracefully without throwing', () => {
    const title = resolveLocalizedReleaseTitle(
      'Ape Escape',
      'Japan',
      '{ invalid json',
      'Saru! Get You!',
    );
    expect(title).toBe('Saru! Get You!');
  });

  it('prefers local language for multi-region releases containing (Japan, USA)', () => {
    const breakoutMetadata = JSON.stringify({
      alternative_names: [
        { comment: 'Japanese title', name: 'テイーテイーブロック' },
        { comment: 'Japanese title (romanized)', name: 'TT Block' },
      ],
    });
    const withCanonical = resolveLocalizedReleaseTitle(
      'Breakout',
      'Japan, USA',
      breakoutMetadata,
      'Breakout ~ Breakaway IV',
    );
    expect(withCanonical).toBe('Breakout ~ Breakaway IV');

    const base = resolveLocalizedReleaseTitle(
      'Breakout',
      'Japan, USA',
      breakoutMetadata,
      'Breakout',
    );
    expect(base).toBe('Breakout');
  });

  it('prefers local language over Japanese for Ape Escape on Japan, USA releases', () => {
    const title = resolveLocalizedReleaseTitle(
      'Ape Escape',
      'Japan, USA',
      apeEscapeMetadata,
      'Ape Escape',
    );
    expect(title).toBe('Ape Escape');
  });

  it('builds a batch CRC companion query with placeholders', () => {
    const qAnon = buildTargetedCompanionByCrcBatchQuery(null, 3);
    expect(qAnon).toContain('WHERE r.rom_crc IN (?, ?, ?)');
    expect(qAnon).not.toContain('user_game_releases');

    const qUser = buildTargetedCompanionByCrcBatchQuery(7, 2);
    expect(qUser).toContain('WHERE r.rom_crc IN (?, ?)');
    expect(qUser).toContain('user_game_releases');
  });

  it('enriches localized title, extracts searchableNames, and strips bulky metadata fields on list rows', () => {
    const row: Record<string, unknown> = {
      title: 'Ape Escape',
      base_title: 'Ape Escape',
      raw_title: 'Saru! Get You!',
      region: 'Japan',
      metadata_json: apeEscapeMetadata,
    };
    enrichAndStripGameListRow(row, 'USA');
    expect(row['title']).toBe('サルゲッチュ');
    expect(row['searchableNames']).toContain(
      'Ape Escape: La Invasión de los Monos',
    );
    expect(row['metadata_json']).toBeUndefined();
    expect(row['raw_title']).toBeUndefined();
  });

  it('postProcessGameListRows resolves sibling fallback release_date and sorts matching GAMES_ORDER_BY', () => {
    const rows: Record<string, unknown>[] = [
      {
        id: 'rel-b',
        stable_id: 10,
        title: 'Zelda',
        base_title: 'Zelda',
        canonical_series: 'The Legend of Zelda',
        release_date: null,
        platform_id: 19,
        ownership_status: 1,
        has_media: 0,
      },
      {
        id: 'rel-a',
        stable_id: 10,
        title: 'Zelda',
        base_title: 'Zelda',
        canonical_series: 'The Legend of Zelda',
        release_date: '1991-11-21',
        platform_id: 19,
        ownership_status: 1,
        has_media: 1,
      },
      {
        id: 'rel-c',
        stable_id: 20,
        title: 'Metroid',
        base_title: 'Metroid',
        canonical_series: 'Metroid',
        release_date: '1986-08-06',
        platform_id: 18,
        ownership_status: 1,
        has_media: 1,
      },
    ];

    postProcessGameListRows(rows, 'USA');

    // Metroid comes before The Legend of Zelda by canonical_series
    expect(rows.map((r) => r['id'])).toEqual(['rel-c', 'rel-a', 'rel-b']);
    // Sibling release_date fallback populated on rel-b from rel-a (same stable_id 10)
    expect(rows[2]['release_date']).toBe('1991-11-21');
  });

  it('postProcessToyListRows sorts toys by canonical series, line, sort_index, release_date, and name', () => {
    const rows: Record<string, unknown>[] = [
      {
        id: 'toy-2',
        name: 'Bowser',
        line: 'amiibo',
        canonical_series: 'Super Mario',
        sort_index: 2,
        release_date: '2015-03-20',
      },
      {
        id: 'toy-1',
        name: 'Mario',
        line: 'amiibo',
        canonical_series: 'Super Mario',
        sort_index: 1,
        release_date: '2014-11-21',
      },
      {
        id: 'toy-3',
        name: 'Spyro',
        line: 'Skylanders',
        canonical_series: 'Spyro the Dragon',
        sort_index: null,
        release_date: '2011-10-16',
      },
    ];

    postProcessToyListRows(rows);

    expect(rows.map((r) => r['id'])).toEqual(['toy-1', 'toy-2', 'toy-3']);
  });

  it('builds indexed catalog chunk, same-day delta, and per-user overlay queries', () => {
    expect(CATALOG_GAMES_CHUNK_SIZE).toBe(3500);
    expect(CATALOG_GAMES_PER_CHUNK).toBe(1500);

    const db = new Database(':memory:');
    try {
      const schemaSql = fs.readFileSync(
        path.join(process.cwd(), 'migrations', 'schema.sql'),
        'utf-8',
      );
      db.exec(schemaSql);

      db.prepare(
        `INSERT INTO users (id, username, home_region) VALUES (1, 'alice', 'USA')`,
      ).run();
      db.prepare(
        `INSERT INTO games (stable_id, id, title, platform_id) VALUES
         (1, 'g1', 'Game One', 13),
         (2, 'g2', 'Game Two', 13),
         (3, 'g3', 'Game Three', 13)`,
      ).run();
      db.prepare(
        `INSERT INTO game_releases (id, game_id, region) VALUES
         ('r1', 1, 'USA'),
         ('r2', 2, 'USA'),
         ('r3', 3, 'USA')`,
      ).run();
      db.prepare(
        `INSERT INTO user_game_releases (user_id, release_id, ownership_status, has_media, has_case, has_manual)
         VALUES (1, 'r1', 1, 1, 1, 0), (1, 'r2', 0, 0, 0, 0)`,
      ).run();
      db.prepare(
        `INSERT INTO user_games (user_id, game_id, play_status, queued)
         VALUES (1, 1, 2, 1), (1, 2, 0, 0)`,
      ).run();
      db.prepare(
        `INSERT INTO toys (stable_id, id, name, line) VALUES
         (1, 't1', 'Mario', 'amiibo'),
         (2, 't2', 'Link', 'amiibo')`,
      ).run();
      db.prepare(
        `INSERT INTO user_toys (user_id, toy_id, ownership_status) VALUES (1, 't1', 1), (1, 't2', 0)`,
      ).run();

      const maxGameRow = db.prepare(CATALOG_MAX_GAME_STABLE_ID_QUERY).get() as {
        max_stable_id: number;
      };
      expect(maxGameRow.max_stable_id).toBe(3);
      const maxToyRow = db.prepare(CATALOG_MAX_TOY_STABLE_ID_QUERY).get() as {
        max_stable_id: number;
      };
      expect(maxToyRow.max_stable_id).toBe(2);
      const hasManyRow = db.prepare(GAMES_HAS_MANY_ROWS_QUERY).get() as {
        cnt: number;
      };
      expect(hasManyRow.cnt).toBe(3);

      const bound1 = db.prepare(CATALOG_GAMES_CHUNK_BOUND_QUERY).get(0, 2) as {
        end_stable_id: number;
      };
      expect(bound1.end_stable_id).toBe(2);
      const chunkSql = buildCatalogGamesChunkQuery();
      const page1 = db.prepare(chunkSql).all(0, bound1.end_stable_id) as Array<{
        id: string;
      }>;
      const bound2 = db
        .prepare(CATALOG_GAMES_CHUNK_BOUND_QUERY)
        .get(bound1.end_stable_id, 2) as {
        end_stable_id: number;
      };
      expect(bound2.end_stable_id).toBe(3);
      const page2 = db
        .prepare(chunkSql)
        .all(bound1.end_stable_id, bound2.end_stable_id) as Array<{
        id: string;
      }>;
      expect(page1.map((r) => r.id)).toEqual(['r1', 'r2']);
      expect(page2.map((r) => r.id)).toEqual(['r3']);

      const chunkPlan = db
        .prepare(`EXPLAIN QUERY PLAN ${chunkSql}`)
        .all(0, 2) as Array<{ detail: string }>;
      expect(
        chunkPlan.some((p) =>
          p.detail.includes('SEARCH g USING INTEGER PRIMARY KEY'),
        ),
      ).toBe(true);
      expect(chunkPlan.some((p) => p.detail.startsWith('SCAN '))).toBe(false);

      const activeAuthSql = `${buildGamesListQuery(1)} ${ACTIVE_GAMES_LIST_WHERE_CLAUSE}`;
      expect(
        getMaxCompoundSelectTerms(ACTIVE_GAMES_LIST_WHERE_CLAUSE),
      ).toBeLessThanOrEqual(4);
      expect(
        getMaxCompoundSelectTerms(ACTIVE_GAMES_LIST_WHERE_CLAUSE),
      ).toBeLessThan(D1_MAX_COMPOUND_SELECT_TERMS);
      const activeAuthRows = db
        .prepare(activeAuthSql)
        .all(1, 1, 1, 1) as Array<{
        id: string;
      }>;
      expect(activeAuthRows.map((r) => r.id)).toEqual(['r1']);
      const activeAuthPlan = db
        .prepare(`EXPLAIN QUERY PLAN ${activeAuthSql}`)
        .all(1, 1, 1, 1) as Array<{ detail: string }>;
      expect(
        activeAuthPlan.some((p) =>
          p.detail.includes('SEARCH g USING INTEGER PRIMARY KEY'),
        ),
      ).toBe(true);
      expect(activeAuthPlan.some((p) => p.detail === 'SCAN g')).toBe(false);

      const activePublicSql = `${buildGamesListQuery(null)} ${ACTIVE_GAMES_PUBLIC_WHERE_CLAUSE}`;
      expect(
        getMaxCompoundSelectTerms(ACTIVE_GAMES_PUBLIC_WHERE_CLAUSE),
      ).toBeLessThanOrEqual(4);
      expect(
        getMaxCompoundSelectTerms(ACTIVE_GAMES_PUBLIC_WHERE_CLAUSE),
      ).toBeLessThan(D1_MAX_COMPOUND_SELECT_TERMS);
      const activePublicPlan = db
        .prepare(`EXPLAIN QUERY PLAN ${activePublicSql}`)
        .all() as Array<{ detail: string }>;
      expect(
        activePublicPlan.some((p) =>
          p.detail.includes('SEARCH g USING INTEGER PRIMARY KEY'),
        ),
      ).toBe(true);
      expect(activePublicPlan.some((p) => p.detail === 'SCAN g')).toBe(false);

      const deltaSql = buildCatalogDeltaGamesQuery(1);
      const deltaRows = db.prepare(deltaSql).all(1, 1, 2) as Array<{
        id: string;
        stable_id: number;
      }>;
      expect(deltaRows.map((r) => r.id)).toEqual(['r3']);

      const deltaPlan = db
        .prepare(`EXPLAIN QUERY PLAN ${deltaSql}`)
        .all(1, 1, 2) as Array<{ detail: string }>;
      expect(
        deltaPlan.some((p) => p.detail.includes('INTEGER PRIMARY KEY')),
      ).toBe(true);

      const ugrRows = db
        .prepare(USER_GAME_RELEASES_OVERLAY_QUERY)
        .all(1) as Array<{ release_id: string; ownership_status: number }>;
      expect(ugrRows).toEqual([
        {
          release_id: 'r1',
          ownership_status: 1,
          has_media: 1,
          has_case: 1,
          has_manual: 0,
        },
      ]);

      const ugRows = db.prepare(USER_GAMES_OVERLAY_QUERY).all(1) as Array<{
        game_id: number;
        play_status: number;
        queued: number;
      }>;
      expect(ugRows).toEqual([{ game_id: 1, play_status: 2, queued: 1 }]);

      const utRows = db.prepare(USER_TOYS_OVERLAY_QUERY).all(1) as Array<{
        toy_id: string;
        ownership_status: number;
      }>;
      expect(utRows).toEqual([{ toy_id: 't1', ownership_status: 1 }]);

      const deltaToys = db.prepare(TOYS_DELTA_LIST_QUERY).all(1) as Array<{
        id: string;
      }>;
      expect(deltaToys.map((t) => t.id)).toEqual(['t2']);
    } finally {
      db.close();
    }
  });

  it('Stage B runtime queries read denormalized release columns without joining canonical_releases', () => {
    const queriesToCheck = [
      buildGamesListQuery(null),
      buildGamesListQuery(1),
      buildGameDetailQuery(null),
      buildGameDetailQuery(1),
      buildGameReleasesByGameIdQuery(null),
      buildGameReleasesByGameIdQuery(1),
    ];

    for (const sql of queriesToCheck) {
      expect(sql).toContain('r.verified_source');
      expect(sql).not.toMatch(/\bJOIN\s+canonical_releases\b/i);
    }

    const schemaPath = path.join(process.cwd(), 'migrations', 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
    const db = new Database(':memory:');

    try {
      db.exec(schemaSql);
      db.prepare(
        `INSERT INTO canonical_releases (id, platform_id, raw_title, normalized_title, serial_code, publisher, source)
         VALUES (999, 13, 'Legacy Canonical Title', 'legacy canonical title', 'LEGACY-000', 'Legacy Pub', 'igdb')`,
      ).run();
      db.prepare(
        `INSERT INTO games (id, stable_id, title, platform_id) VALUES ('1', 1, 'Demo Game Base', 13)`,
      ).run();
      db.prepare(
        `INSERT INTO game_releases (id, game_id, region, canonical_release_id, verified_source, serial_code, canonical_title, publisher)
         VALUES ('r1', 1, 'USA', 999, 'dat', 'SLUS-001', 'Demo Game Canonical', 'Demo Pub')`,
      ).run();

      const listPlan = db
        .prepare(`EXPLAIN QUERY PLAN ${buildGamesListQuery(null)}`)
        .all() as Array<{ detail: string }>;
      expect(
        listPlan.some((p) => p.detail.includes('canonical_releases')),
      ).toBe(false);

      const listRow = db
        .prepare(`${buildGamesListQuery(null)} AND g.stable_id = 1`)
        .get() as Record<string, unknown>;
      expect(listRow['source']).toBe('dat');
      expect(listRow['is_source_verified']).toBe(1);
      expect(listRow['serial_code']).toBe('SLUS-001');
      expect(listRow['raw_title']).toBe('Demo Game Canonical');
      expect(listRow['title']).toBe('Demo Game Canonical');

      const detailParams = getGameDetailQueryParams('1', null, 'r1');
      const detailPlan = db
        .prepare(`EXPLAIN QUERY PLAN ${buildGameDetailQuery(null)}`)
        .all(...detailParams) as Array<{ detail: string }>;
      expect(
        detailPlan.some((p) => p.detail.includes('canonical_releases')),
      ).toBe(false);

      const detailRow = db
        .prepare(buildGameDetailQuery(null))
        .get(...detailParams) as Record<string, unknown>;
      expect(detailRow['source']).toBe('dat');
      expect(detailRow['is_source_verified']).toBe(1);
      expect(detailRow['serial_code']).toBe('SLUS-001');
      expect(detailRow['title']).toBe('Demo Game Canonical');

      const releasesPlan = db
        .prepare(`EXPLAIN QUERY PLAN ${buildGameReleasesByGameIdQuery(null)}`)
        .all(1, 'USA') as Array<{ detail: string }>;
      expect(
        releasesPlan.some((p) => p.detail.includes('canonical_releases')),
      ).toBe(false);

      const releasesRow = db
        .prepare(buildGameReleasesByGameIdQuery(null))
        .get(1, 'USA') as Record<string, unknown>;
      expect(releasesRow['source']).toBe('dat');
      expect(releasesRow['is_source_verified']).toBe(1);
      expect(releasesRow['serial_code']).toBe('SLUS-001');
      expect(releasesRow['title']).toBe('Demo Game Canonical');
      expect(releasesRow['comments']).toBe('Demo Pub');

      // Phase 5 Category B bidirectional version_parent companion queries remain index-backed
      db.exec(`
        INSERT INTO games (id, stable_id, title, platform_id, igdb_id, canonical_series, metadata_json)
        VALUES
          ('10', 10, 'Bloodstained: Ritual of the Night', 26, 10760, 'Bloodstained', NULL),
          ('11', 11, 'Bloodstained: Ritual of the Night - Complete Edition', 26, 381623, 'Bloodstained', '{"version_parent_igdb_id":10760,"version_title":"Complete Edition"}');
        INSERT INTO game_releases (id, game_id, region)
        VALUES ('10-1', 10, 'USA'), ('11-1', 11, 'USA');
      `);

      const byIgdbPlan = db
        .prepare(
          `EXPLAIN QUERY PLAN ${buildTargetedCompanionByIgdbIdQuery(null)}`,
        )
        .all(10760, 26) as Array<{ detail: string }>;
      expect(
        byIgdbPlan.some((p) => /\bSCAN\s+(?:games|g)\b/i.test(p.detail)),
      ).toBe(false);

      const childrenTitlePlan = db
        .prepare(
          `EXPLAIN QUERY PLAN ${buildVersionParentChildrenCompanionQuery(null, false)}`,
        )
        .all(
          'bloodstained: ritual of the night',
          'bloodstained: ritual of the night\uffff',
          26,
        ) as Array<{ detail: string }>;
      expect(
        childrenTitlePlan.some((p) => /\bSCAN\s+(?:games|g)\b/i.test(p.detail)),
      ).toBe(false);

      const childrenSeriesPlan = db
        .prepare(
          `EXPLAIN QUERY PLAN ${buildVersionParentChildrenCompanionQuery(null, true)}`,
        )
        .all('Bloodstained', 26) as Array<{ detail: string }>;
      expect(
        childrenSeriesPlan.some((p) =>
          /\bSCAN\s+(?:games|g)\b/i.test(p.detail),
        ),
      ).toBe(false);

      const parentRows = db
        .prepare(buildTargetedCompanionByIgdbIdQuery(null))
        .all(10760, 26) as Array<Record<string, unknown>>;
      const childGameObj = {
        id: '11',
        stable_id: 11,
        title: 'Bloodstained: Ritual of the Night - Complete Edition',
        platform_id: 26,
        igdb_id: 381623,
        metadata_json:
          '{"version_parent_igdb_id":10760,"version_title":"Complete Edition"}',
        region: 'USA',
        releases: [{ id: '11-1', region: 'USA' }],
      };
      enrichGameDetailWithCompanionsAndVouchers(
        childGameObj,
        parentRows as unknown as Parameters<
          typeof enrichGameDetailWithCompanionsAndVouchers
        >[1],
      );
      expect(
        (
          childGameObj as {
            shared_media_releases?: Array<{
              stable_id?: number;
              title: string;
            }>;
          }
        ).shared_media_releases,
      ).toEqual([
        expect.objectContaining({
          stable_id: 10,
          title: 'Bloodstained: Ritual of the Night (Base Release)',
        }),
      ]);

      const childRows = db
        .prepare(buildVersionParentChildrenCompanionQuery(null, false))
        .all(
          'bloodstained: ritual of the night',
          'bloodstained: ritual of the night\uffff',
          26,
        ) as Array<Record<string, unknown>>;
      const parentGameObj = {
        id: '10',
        stable_id: 10,
        title: 'Bloodstained: Ritual of the Night',
        platform_id: 26,
        igdb_id: 10760,
        metadata_json: null,
        region: 'USA',
        releases: [{ id: '10-1', region: 'USA' }],
      };
      enrichGameDetailWithCompanionsAndVouchers(
        parentGameObj,
        childRows as unknown as Parameters<
          typeof enrichGameDetailWithCompanionsAndVouchers
        >[1],
      );
      expect(
        (
          parentGameObj as {
            shared_media_releases?: Array<{
              stable_id?: number;
              title: string;
            }>;
          }
        ).shared_media_releases,
      ).toEqual([
        expect.objectContaining({
          stable_id: 11,
          title: 'Bloodstained: Ritual of the Night - Complete Edition',
        }),
      ]);

      // Column-backed version_parent_igdb_id / version_title (no metadata_json required)
      db.exec(`
        INSERT INTO games (id, stable_id, title, platform_id, igdb_id, version_parent_igdb_id, version_title, canonical_series, metadata_json)
        VALUES
          ('12', 12, 'Bloodstained: Ritual of the Night - Deluxe On-Media', 26, 381624, 10760, 'Deluxe On-Media', 'Bloodstained', NULL);
        INSERT INTO game_releases (id, game_id, region)
        VALUES ('12-1', 12, 'USA');
      `);
      const indexedVpPlan = db
        .prepare(
          `EXPLAIN QUERY PLAN ${buildTargetedCompanionByVersionParentQuery(null)}`,
        )
        .all(10760, 26) as Array<{ detail: string }>;
      expect(
        indexedVpPlan.some((p) =>
          p.detail.includes('idx_games_version_parent_igdb_id'),
        ),
      ).toBe(true);
      const indexedVpRows = db
        .prepare(buildTargetedCompanionByVersionParentQuery(null))
        .all(10760, 26) as Array<Record<string, unknown>>;
      const colParentObj = {
        id: '10',
        stable_id: 10,
        title: 'Bloodstained: Ritual of the Night',
        platform_id: 26,
        igdb_id: 10760,
        metadata_json: null,
        region: 'USA',
        releases: [{ id: '10-1', region: 'USA' }],
      };
      enrichGameDetailWithCompanionsAndVouchers(
        colParentObj,
        indexedVpRows as unknown as Parameters<
          typeof enrichGameDetailWithCompanionsAndVouchers
        >[1],
      );
      expect(
        (
          colParentObj as {
            shared_media_releases?: Array<{
              stable_id?: number;
              title: string;
            }>;
          }
        ).shared_media_releases,
      ).toEqual([
        expect.objectContaining({
          stable_id: 12,
          title: 'Bloodstained: Ritual of the Night - Deluxe On-Media',
        }),
      ]);
    } finally {
      db.close();
    }
  });
});
