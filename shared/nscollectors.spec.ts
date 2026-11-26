import { describe, it, expect } from 'vitest';
import {
  NSCOLLECTORS_TABS,
  getNsCollectorsCsvUrl,
  normalizeNsCollectorsDate,
  parseNsCollectorsCsv,
} from './nscollectors.js';

describe('r/NSCollectors Physical Release Parser', () => {
  it('exposes the 5 SW1 & SW2 spreadsheet tabs and CSV URLs', () => {
    expect(NSCOLLECTORS_TABS).toHaveLength(5);
    const sw2 = NSCOLLECTORS_TABS.find((t) => t.id === 'sw2_details')!;
    expect(getNsCollectorsCsvUrl(sw2.spreadsheetId, sw2.gid)).toContain(
      'gid=764784245',
    );
  });

  it('normalizes release dates while skipping placeholders', () => {
    expect(normalizeNsCollectorsDate('2026-06-05')).toBe('2026-06-05');
    expect(normalizeNsCollectorsDate('5/22/2026')).toBe('2026-05-22');
    expect(normalizeNsCollectorsDate('October 17, 2026')).toBe('2026-10-17');
    expect(normalizeNsCollectorsDate('12/31/2026')).toBeNull();
    expect(normalizeNsCollectorsDate('TBA')).toBeNull();
    expect(normalizeNsCollectorsDate('Q3 2026')).toBeNull();
  });

  it('parses banner-offset headers, Switch 2 Game-Key Cards, CIAB unverified flags, and upcoming releases', () => {
    const sw1Master = NSCOLLECTORS_TABS.find((t) => t.id === 'sw1_master')!;
    const sw1Ciab = NSCOLLECTORS_TABS.find((t) => t.id === 'sw1_ciab')!;
    const sw2Details = NSCOLLECTORS_TABS.find((t) => t.id === 'sw2_details')!;
    const sw2Upcoming = NSCOLLECTORS_TABS.find((t) => t.id === 'sw2_upcoming')!;

    const parsed = parseNsCollectorsCsv([
      {
        tab: sw1Master,
        csv: [
          'Title,Region,Release Date,Publisher',
          'Hollow Knight,USA / EUR,05/31/2019,Fangamer',
          'Metroid Dread,NA,2021-10-08,Nintendo',
          'Sonic Racing: CrossWorlds - Year One Edition,NA,2025-09-25,Sega',
        ].join('\n'),
      },
      {
        tab: sw1Ciab,
        csv: [
          'r/NSCollectors Code in a Box List',
          'Title,Region,Publisher',
          'Overwatch: Legendary Edition,USA,Blizzard',
        ].join('\n'),
      },
      {
        tab: sw2Details,
        csv: [
          'Game,Region,Cart Type,Release Date,Publisher',
          'Mario Kart World,USA,64GB Cartridge,June 5 2025,Nintendo',
          'Bravely Default Flying Fairy HD,USA,Game-Key Card,2025-06-05,Square Enix',
          'Sonic Racing: CrossWorlds - Year One Edition Nintendo Switch 2 Edition,USA,Game-Key Card,2025-12-04,Sega',
        ].join('\n'),
      },
      {
        tab: sw2Upcoming,
        csv: [
          'Game Title,Region,Release Date,Publisher',
          'Metroid Prime 4: Beyond,USA,2026-11-12,Nintendo',
        ].join('\n'),
      },
    ]);

    const hk = parsed.filter((e) => e.release.raw_title === 'Hollow Knight');
    expect(hk.map((e) => e.release.region).sort()).toEqual(['Europe', 'USA']);
    expect(hk[0].release.is_verified_physical).toBe(1);
    expect(hk[0].releaseDate).toBe('2019-05-31');

    const ciab = parsed.find((e) => e.release.source === 'nscollectors_ciab')!;
    expect(ciab.release.is_verified_physical).toBe(0);
    expect(ciab.release.variants).toBe('Code in a Box (Download Only)');

    const gkc = parsed.find((e) =>
      e.release.raw_title.includes('Bravely Default'),
    )!;
    expect(gkc.release.platform_id).toBe(27);
    expect(gkc.release.variants).toBe('Game-Key Card');
    expect(gkc.release.is_verified_physical).toBe(1);

    const upcoming = parsed.find(
      (e) => e.release.source === 'nscollectors_upcoming',
    )!;
    expect(upcoming.release.platform_id).toBe(27);
    expect(upcoming.release.is_verified_physical).toBe(1);
    expect(upcoming.releaseDate).toBe('2026-11-12');

    const sonicSw1 = parsed.find(
      (e) =>
        e.release.platform_id === 26 &&
        e.release.raw_title === 'Sonic Racing: CrossWorlds - Year One Edition',
    )!;
    expect(sonicSw1).toBeDefined();
    expect(sonicSw1.release.normalized_title).toBe('sonicracingcrossworlds');
    expect(sonicSw1.release.variants).toBe('Year One Edition');

    const sonicSw2 = parsed.find(
      (e) =>
        e.release.platform_id === 27 &&
        e.release.raw_title ===
          'Sonic Racing: CrossWorlds - Year One Edition Nintendo Switch 2 Edition',
    )!;
    expect(sonicSw2).toBeDefined();
    expect(sonicSw2.release.normalized_title).toBe(
      'sonicracingcrossworldsswitch2',
    );
    expect(sonicSw2.release.variants).toBe('Year One Edition, Game-Key Card');
  });
});
