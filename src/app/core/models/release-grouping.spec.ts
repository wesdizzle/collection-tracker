import '../../../test-setup';
import { describe, it, expect } from 'vitest';
import {
  CatalogMediaRow,
  OwnershipStatus,
  PlayStatus,
  getMissingMediaCount,
  getOwnedMediaCount,
  getReleaseMediaItems,
  getTotalMediaCount,
  isMultiMediaRelease,
} from './collection.models';
import {
  deduplicateOwnedPlatformGames,
  extractMediaLabel,
  groupCatalogMediaIntoReleases,
} from './release-grouping';

function makeRow(overrides: Partial<CatalogMediaRow> = {}): CatalogMediaRow {
  return {
    stable_id: 1,
    id: 'game-rel-1',
    game_id: 'sample-game',
    title: 'Sample Game',
    series: 'Sample',
    canonical_series: 'Sample',
    platform: 'PlayStation',
    platform_id: 29,
    region: 'USA',
    ownership_status: OwnershipStatus.Owned,
    play_status: PlayStatus.Unplayed,
    has_media: 0,
    ...overrides,
  };
}

describe('release-grouping & ReleaseMediaItem helpers', () => {
  it('extracts human-readable disc/variant labels with fallback indexing', () => {
    expect(extractMediaLabel('Final Fantasy VII (USA) (Disc 2).cue', 1)).toBe(
      'Disc 2',
    );
    expect(
      extractMediaLabel(
        'Grand Theft Auto V (USA) (Install Disc) (Disc 1).iso',
        0,
      ),
    ).toBe('Install Disc · Disc 1');
    expect(extractMediaLabel('', 0, 'Bonus Disc')).toBe('Bonus Disc');
    expect(extractMediaLabel('Super Mario World (USA).sfc', 2)).toBe('Disc 3');
  });

  it('provides single-media fallback and count helpers for ungrouped rows', () => {
    const singleRow = makeRow({
      id: 'smw-snes',
      platform: 'Super Nintendo Entertainment System',
      platform_id: 15,
      rom_name: 'Super Mario World (USA).sfc',
      has_media: 1,
    });

    const items = getReleaseMediaItems(singleRow);
    expect(items).toEqual([
      {
        id: 'smw-snes',
        label: 'Cart',
        hasMedia: 1,
        romName: 'Super Mario World (USA).sfc',
        romCrc: null,
      },
    ]);
    expect(getOwnedMediaCount(singleRow)).toBe(1);
    expect(getTotalMediaCount(singleRow)).toBe(1);
    expect(getMissingMediaCount(singleRow)).toBe(0);
    expect(isMultiMediaRelease(singleRow)).toBe(false);
  });

  it('groups multi-disc SKUs separately per region, aggregates status, and folds pack-in demos', () => {
    const rows: CatalogMediaRow[] = [
      makeRow({
        stable_id: 10,
        id: 'ff7-usa-d1',
        game_id: 'ff7-ps1',
        title: 'Final Fantasy VII',
        rom_name: 'Final Fantasy VII (USA) (Disc 1).cue',
        has_media: 1,
      }),
      makeRow({
        stable_id: 10,
        id: 'ff7-usa-d2',
        game_id: 'ff7-ps1',
        title: 'Final Fantasy VII',
        rom_name: 'Final Fantasy VII (USA) (Disc 2).cue',
        has_media: 0,
      }),
      makeRow({
        stable_id: 10,
        id: 'ff7-jpn-d1',
        game_id: 'ff7-ps1',
        title: 'Final Fantasy VII',
        region: 'Japan',
        rom_name: 'Final Fantasy VII (Japan) (Disc 1).cue',
        has_media: 1,
      }),
      makeRow({
        stable_id: 11,
        id: 'tron-bonne-host',
        game_id: 'tron-bonne-ps1',
        title: 'The Misadventures of Tron Bonne',
        rom_name: 'Misadventures of Tron Bonne, The (USA).cue',
        has_media: 1,
      }),
      makeRow({
        stable_id: 11,
        id: 'tron-bonne-demo',
        game_id: 'tron-bonne-ps1',
        title: 'The Misadventures of Tron Bonne',
        rom_name: 'Mega Man Legends 2 (USA) (Demo).cue',
        has_media: 0,
      }),
    ];

    const releases = groupCatalogMediaIntoReleases(rows);
    expect(releases).toHaveLength(3);

    const ff7Usa = releases.find((r) => r.id === 'ff7-usa-d1')!;
    expect(isMultiMediaRelease(ff7Usa)).toBe(true);
    expect(ff7Usa.mediaItems.map((m) => m.id)).toEqual([
      'ff7-usa-d1',
      'ff7-usa-d2',
    ]);
    expect(ff7Usa.mediaItems.map((m) => m.label)).toEqual(['Disc 1', 'Disc 2']);
    expect(getOwnedMediaCount(ff7Usa)).toBe(1);
    expect(getMissingMediaCount(ff7Usa)).toBe(1);
    expect(ff7Usa.has_media).toBe(0);

    const tronBonne = releases.find((r) => r.id === 'tron-bonne-host')!;
    expect(tronBonne.mediaItems.map((m) => m.id)).toEqual([
      'tron-bonne-host',
      'tron-bonne-demo',
    ]);
    expect(tronBonne.has_media).toBe(0);
  });

  it('prepends companion GOTY Disc 1 with aligned romName, crc, label, and isCompanionBase flag', () => {
    const rows: CatalogMediaRow[] = [
      makeRow({
        stable_id: 3796,
        id: 'oblivion-base-usa',
        game_id: 'oblivion-360',
        title: 'The Elder Scrolls IV: Oblivion',
        platform: 'Xbox 360',
        platform_id: 48,
        region: 'USA',
        rom_name: 'Elder Scrolls IV, The - Oblivion (USA).iso',
        rom_crc: 'abc12345',
        has_media: 1,
      }),
      makeRow({
        stable_id: 3798,
        id: 'oblivion-goty-usa',
        game_id: 'oblivion-goty-360',
        title: 'The Elder Scrolls IV: Oblivion - Game of the Year Edition',
        platform: 'Xbox 360',
        platform_id: 48,
        region: 'USA',
        rom_name:
          'Elder Scrolls IV, The - Oblivion - Game of the Year Edition (USA) (Disc 2).iso',
        rom_crc: 'def67890',
        has_media: 0,
      }),
    ];

    const releases = groupCatalogMediaIntoReleases(rows);
    const goty = releases.find((r) => r.id === 'oblivion-goty-usa')!;
    expect(goty.mediaItems).toEqual([
      {
        id: 'oblivion-base-usa',
        label: 'Disc 1 (Base Release)',
        hasMedia: 1,
        romName: 'Elder Scrolls IV, The - Oblivion (USA).iso',
        romCrc: 'abc12345',
        isCompanionBase: true,
      },
      {
        id: 'oblivion-goty-usa',
        label: 'Disc 2',
        hasMedia: 0,
        romName:
          'Elder Scrolls IV, The - Oblivion - Game of the Year Edition (USA) (Disc 2).iso',
        romCrc: 'def67890',
      },
    ]);
    expect(goty.has_media).toBe(0);
  });

  it('deduplicates owned rows down to distinct Platform Games', () => {
    const distinct = deduplicateOwnedPlatformGames([
      makeRow({ stable_id: 1, id: 'ff7-d1', game_id: 'ff7-ps1' }),
      makeRow({ stable_id: 1, id: 'ff7-d2', game_id: 'ff7-ps1' }),
      makeRow({ stable_id: 2, id: 'mgs-d1', game_id: 'mgs-ps1' }),
    ]);
    expect(distinct.map((d) => d.game_id)).toEqual(['ff7-ps1', 'mgs-ps1']);
  });
});
