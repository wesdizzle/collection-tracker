import { describe, it, expect } from 'vitest';
import {
  buildAmiiboCompatibilityEntries,
  buildSkylandersCompatibilityEntries,
  buildStarlinkCompatibilityEntries,
  ToyCompatibilityGameInput,
  ToyCompatibilityToyInput,
} from './toy_compatibility.js';

const MOCK_GAMES: ToyCompatibilityGameInput[] = [
  {
    stable_id: 1649,
    title: 'Super Mario Galaxy + Super Mario Galaxy 2',
    platform_id: 26,
  },
  { stable_id: 1650, title: 'Super Mario Odyssey', platform_id: 26 },
  { stable_id: 1885, title: 'Metroid Prime 4: Beyond', platform_id: 27 },
  {
    stable_id: 59624,
    title: 'Street Fighter 6: Years 1-2 - 2 Fighters Edition',
    platform_id: 27,
  },
  { stable_id: 1215, title: 'Fire Emblem Fates: Birthright', platform_id: 23 },
  { stable_id: 1216, title: 'Fire Emblem Fates: Conquest', platform_id: 23 },
  {
    stable_id: 1276,
    title: 'Metroid Prime: Federation Force',
    platform_id: 23,
  },
  { stable_id: 1351, title: "Poochy & Yoshi's Woolly World", platform_id: 23 },
  { stable_id: 9999, title: 'Street Fighter 6', platform_id: 35 },
  { stable_id: 1152, title: "Skylanders: Spyro's Adventure", platform_id: 22 },
  { stable_id: 1153, title: 'Skylanders: Giants', platform_id: 22 },
  { stable_id: 1154, title: 'Skylanders: Swap Force', platform_id: 22 },
  { stable_id: 1155, title: 'Skylanders: Trap Team', platform_id: 22 },
  { stable_id: 1328, title: 'Skylanders: Trap Team', platform_id: 23 },
  { stable_id: 1426, title: 'Skylanders: SuperChargers', platform_id: 24 },
  { stable_id: 3137, title: 'Skylanders: SuperChargers', platform_id: 34 },
  {
    stable_id: 1329,
    title: 'Skylanders: SuperChargers Racing',
    platform_id: 23,
  },
  { stable_id: 1427, title: 'Skylanders: Imaginators', platform_id: 24 },
  { stable_id: 1792, title: 'Skylanders: Imaginators', platform_id: 26 },
  { stable_id: 3138, title: 'Skylanders: Imaginators', platform_id: 34 },
  { stable_id: 1818, title: 'Starlink: Battle for Atlas', platform_id: 26 },
  { stable_id: 3167, title: 'Starlink: Battle for Atlas', platform_id: 34 },
  { stable_id: 4274, title: 'Starlink: Battle for Atlas', platform_id: 49 },
];

describe('shared/toy_compatibility', () => {
  it('maps amiibo to Nintendo consoles only, resolves physical aliases, expands multi-pose figures, and includes Bowser/DK hybrids', () => {
    const toys: ToyCompatibilityToyInput[] = [
      {
        stable_id: 1,
        id: '0000000000000002',
        name: 'Mario',
        line: 'amiibo',
        amiibo_id: '0000000000000002',
      },
      {
        stable_id: 2,
        id: '07800000002d0002',
        name: 'Mr. Game & Watch (Default)',
        line: 'amiibo',
        amiibo_id: '07800000002d0002',
      },
      {
        stable_id: 3,
        id: '07800000002d0002-bell',
        name: 'Mr. Game & Watch (Bell)',
        line: 'amiibo',
        amiibo_id: '07800000002d0002',
      },
      {
        stable_id: 595,
        id: 'sky-595',
        name: 'Hammer Slam Bowser',
        line: 'Skylanders',
        series: '5',
        type: 'SuperCharger',
      },
      {
        stable_id: 596,
        id: 'sky-596',
        name: 'Dark Hammer Slam Bowser',
        line: 'Skylanders',
        series: '5',
        type: 'SuperCharger',
      },
    ];

    const entries = buildAmiiboCompatibilityEntries(
      [
        {
          head: '00000000',
          tail: '00000002',
          name: 'Mario',
          games3DS: [
            {
              gameName: 'Fire Emblem Fates',
              amiiboUsage: [{ Usage: 'Bonus accessory', write: false }],
            },
            {
              gameName: 'Metroid Prime: Blast Ball',
              amiiboUsage: [{ Usage: 'Mario Paintjob', write: false }],
            },
            {
              gameName: "Yoshi's Woolly World",
              amiiboUsage: [{ Usage: 'Mario Yoshi pattern', write: false }],
            },
          ],
          gamesSwitch: [
            {
              gameName: 'Super Mario Galaxy',
              amiiboUsage: [{ Usage: '1-Up Mushroom', write: false }],
            },
            {
              gameName: 'Super Mario Galaxy 2',
              amiiboUsage: [{ Usage: '1-Up Mushroom + Coin', write: false }],
            },
          ],
          gamesSwitch2: [
            {
              gameName: 'Metroid Prime 4: Beyond – Nintendo Switch 2 Edition',
              amiiboUsage: [{ Usage: 'Suit unlock', write: false }],
            },
            {
              gameName: 'Street Fighter 6',
              amiiboUsage: [{ Usage: 'Fighter item', write: false }],
            },
          ],
        },
        {
          head: '07800000',
          tail: '002d0002',
          name: 'Mr. Game & Watch',
          gamesSwitch: [
            {
              gameName: 'Super Mario Odyssey',
              amiiboUsage: [{ Usage: 'Power Moon hint', write: true }],
            },
          ],
        },
        {
          head: '0005ff00',
          tail: '023a0702',
          name: 'Hammer Slam Bowser',
          amiiboSeries: 'Skylanders',
          gamesSwitch: [
            {
              gameName: 'Super Mario Odyssey',
              amiiboUsage: [{ Usage: 'Wedding outfit unlock', write: false }],
            },
          ],
        },
      ],
      toys,
      MOCK_GAMES,
    );

    expect(
      entries.some((e) => e.toy_stable_id === 1 && e.game_stable_id === 9999),
    ).toBe(false);
    expect(
      entries.some((e) => e.toy_stable_id === 1 && e.game_stable_id === 59624),
    ).toBe(true);
    expect(
      entries.some((e) => e.toy_stable_id === 1 && e.game_stable_id === 1885),
    ).toBe(true);
    expect(
      entries.some((e) => e.toy_stable_id === 1 && e.game_stable_id === 1215),
    ).toBe(true);
    expect(
      entries.some((e) => e.toy_stable_id === 1 && e.game_stable_id === 1216),
    ).toBe(true);

    const galaxy = entries.find(
      (e) => e.toy_stable_id === 1 && e.game_stable_id === 1649,
    );
    expect(galaxy?.description).toContain('1-Up Mushroom + Coin');

    expect(
      entries.find((e) => e.toy_stable_id === 2 && e.game_stable_id === 1650)
        ?.can_write,
    ).toBe(1);
    expect(
      entries.find((e) => e.toy_stable_id === 3 && e.game_stable_id === 1650)
        ?.can_write,
    ).toBe(1);

    expect(
      entries.find((e) => e.toy_stable_id === 595 && e.game_stable_id === 1650)
        ?.description,
    ).toContain('amiibo mode:');
    expect(
      entries.find((e) => e.toy_stable_id === 596 && e.game_stable_id === 1650)
        ?.description,
    ).toContain('amiibo mode:');
  });

  it('enforces Skylanders forward/backward repose rules, Traps/Vehicles restrictions, Sidekicks, and Nintendo hybrids', () => {
    const toys: ToyCompatibilityToyInput[] = [
      {
        stable_id: 241,
        id: 's-bash',
        name: 'Bash',
        line: 'Skylanders',
        series: '1',
        type: 'Series 1',
      },
      {
        stable_id: 299,
        id: 's-bash2',
        name: 'Series 2 Bash',
        line: 'Skylanders',
        series: '2',
        type: 'Series 2',
      },
      {
        stable_id: 504,
        id: 's-terrabite',
        name: 'Terrabite',
        line: 'Skylanders',
        series: '4',
        type: 'Mini',
      },
      {
        stable_id: 536,
        id: 's-trap',
        name: 'Water Log Holder',
        line: 'Skylanders',
        series: '4',
        type: 'Trap',
      },
      {
        stable_id: 595,
        id: 's-bowser',
        name: 'Hammer Slam Bowser',
        line: 'Skylanders',
        series: '5',
        type: 'SuperCharger',
      },
      {
        stable_id: 627,
        id: 's-clown',
        name: 'Clown Cruiser',
        line: 'Skylanders',
        series: '5',
        type: 'Vehicle',
      },
      {
        stable_id: 678,
        id: 's-sensei',
        name: 'Crash Bandicoot',
        line: 'Skylanders',
        series: '6',
        type: 'Sensei',
      },
    ];

    const entries = buildSkylandersCompatibilityEntries(toys, MOCK_GAMES);

    const s2BashSsa = entries.find(
      (e) => e.toy_stable_id === 299 && e.game_stable_id === 1152,
    );
    expect(s2BashSsa).toBeTruthy();
    expect(s2BashSsa?.description).toContain('without newer Wow Pow upgrade');

    expect(
      entries.find((e) => e.toy_stable_id === 504 && e.game_stable_id === 1152)
        ?.description,
    ).toContain('Sidekick');
    expect(
      entries.find((e) => e.toy_stable_id === 504 && e.game_stable_id === 1155)
        ?.description,
    ).toContain('Mini');

    expect(
      entries.some((e) => e.toy_stable_id === 536 && e.game_stable_id === 1155),
    ).toBe(true);
    expect(
      entries.some((e) => e.toy_stable_id === 536 && e.game_stable_id === 1328),
    ).toBe(false);
    expect(
      entries.some((e) => e.toy_stable_id === 536 && e.game_stable_id === 1329),
    ).toBe(false);
    expect(
      entries.some((e) => e.toy_stable_id === 536 && e.game_stable_id === 1792),
    ).toBe(false);
    expect(
      entries.some((e) => e.toy_stable_id === 536 && e.game_stable_id === 3138),
    ).toBe(true);

    expect(
      entries.some((e) => e.toy_stable_id === 595 && e.game_stable_id === 1426),
    ).toBe(true);
    expect(
      entries.some((e) => e.toy_stable_id === 595 && e.game_stable_id === 1792),
    ).toBe(true);
    expect(
      entries.some((e) => e.toy_stable_id === 595 && e.game_stable_id === 3137),
    ).toBe(false);

    expect(
      entries.some((e) => e.toy_stable_id === 627 && e.game_stable_id === 1427),
    ).toBe(true);
    expect(
      entries.some((e) => e.toy_stable_id === 627 && e.game_stable_id === 1792),
    ).toBe(false);
    expect(
      entries.some((e) => e.toy_stable_id === 627 && e.game_stable_id === 3137),
    ).toBe(false);

    expect(
      entries.some((e) => e.toy_stable_id === 678 && e.game_stable_id === 1426),
    ).toBe(false);
    expect(
      entries.some((e) => e.toy_stable_id === 678 && e.game_stable_id === 1792),
    ).toBe(true);
  });

  it('scopes Star Fox Starlink toys to Switch while allowing all others on Switch, PS4, and Xbox One', () => {
    const toys: ToyCompatibilityToyInput[] = [
      {
        stable_id: 755,
        id: 'sl-fox',
        name: 'Fox McCloud',
        line: 'Starlink',
        type: 'Pilot',
      },
      {
        stable_id: 756,
        id: 'sl-arwing',
        name: 'Arwing',
        line: 'Starlink',
        type: 'Starship',
      },
      {
        stable_id: 757,
        id: 'sl-mason',
        name: 'Mason Rana',
        line: 'Starlink',
        type: 'Pilot',
      },
    ];
    const entries = buildStarlinkCompatibilityEntries(toys, MOCK_GAMES);
    expect(
      entries
        .filter((e) => e.toy_stable_id === 755)
        .map((e) => e.game_stable_id),
    ).toEqual([1818]);
    expect(
      entries
        .filter((e) => e.toy_stable_id === 756)
        .map((e) => e.game_stable_id),
    ).toEqual([1818]);
    expect(
      entries
        .filter((e) => e.toy_stable_id === 757)
        .map((e) => e.game_stable_id),
    ).toEqual([1818, 3167, 4274]);
  });
});
