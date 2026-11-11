import { describe, it, expect } from 'vitest';
import {
  resolveLocalizedReleaseTitle,
  buildTargetedCompanionByCrcBatchQuery,
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
      origin_metadata: '{"raw":true}',
    };
    enrichAndStripGameListRow(row, 'USA');
    expect(row['title']).toBe('サルゲッチュ');
    expect(row['searchableNames']).toContain(
      'Ape Escape: La Invasión de los Monos',
    );
    expect(row['metadata_json']).toBeUndefined();
    expect(row['origin_metadata']).toBeUndefined();
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
        backup_status: 0,
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
        backup_status: 1,
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
        backup_status: 1,
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
});
