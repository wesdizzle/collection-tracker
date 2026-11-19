import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import {
  computeSkylandersSortOrder,
  extractSkylandersNameParts,
  getSkylandersCategoryOrder,
  getSkylandersElement,
  type SkylandersToyInput,
} from './skylanders_sort.js';

interface SeedSkylanderRow extends SkylandersToyInput {
  sort_index: number;
}

describe('extractSkylandersNameParts', () => {
  it('extracts base names and chase variants without breaking compound names', () => {
    expect(extractSkylandersNameParts('Egg Bomber Air Strike', 1)).toEqual({
      baseName: 'Air Strike',
      variantName: 'Egg Bomber',
      poseName: '',
    });
    expect(extractSkylandersNameParts('Spring Ahead Dive Bomber', 2)).toEqual({
      baseName: 'Dive Bomber',
      variantName: 'Spring Ahead',
      poseName: '',
    });
    expect(extractSkylandersNameParts('Golden Hot Streak', 2)).toEqual({
      baseName: 'Hot Streak',
      variantName: 'Golden',
      poseName: '',
    });
    expect(extractSkylandersNameParts('Hard-Boiled Flarewolf', 1)).toEqual({
      baseName: 'Flarewolf',
      variantName: 'Hard-Boiled',
      poseName: '',
    });
    expect(extractSkylandersNameParts('Granite Crusher', 1)).toEqual({
      baseName: 'Crusher',
      variantName: 'Granite',
      poseName: '',
    });
    expect(extractSkylandersNameParts('Power Punch Pet Vac', 1)).toEqual({
      baseName: 'Pet Vac',
      variantName: 'Power Punch',
      poseName: '',
    });
    expect(extractSkylandersNameParts('Dark Golden Queen', 1)).toEqual({
      baseName: 'Golden Queen',
      variantName: 'Dark',
      poseName: '',
    });
    expect(extractSkylandersNameParts('Dark King Pen', 1)).toEqual({
      baseName: 'King Pen',
      variantName: 'Dark',
      poseName: '',
    });
    expect(extractSkylandersNameParts('Turbo Charge Donkey Kong', 1)).toEqual({
      baseName: 'Turbo Charge Donkey Kong',
      variantName: '',
      poseName: '',
    });
    expect(extractSkylandersNameParts('Gold Rusher', 2)).toEqual({
      baseName: 'Gold Rusher',
      variantName: '',
      poseName: '',
    });
    expect(extractSkylandersNameParts('Power Blue Gold Rusher', 2)).toEqual({
      baseName: 'Gold Rusher',
      variantName: 'Power Blue',
      poseName: '',
    });
    expect(extractSkylandersNameParts('Doom Stone', 1)).toEqual({
      baseName: 'Doom Stone',
      variantName: '',
      poseName: '',
    });
  });

  it('preserves Magic Items, Traps, and Creation Crystals except explicit variants', () => {
    expect(extractSkylandersNameParts('Platinum Treasure Chest', 5)).toEqual({
      baseName: 'Platinum Treasure Chest',
      variantName: '',
      poseName: '',
    });
    expect(extractSkylandersNameParts('Volcanic Vault', 5)).toEqual({
      baseName: 'Volcanic Vault',
      variantName: '',
      poseName: '',
    });
    expect(extractSkylandersNameParts('Golden Dragonfire Cannon', 5)).toEqual({
      baseName: 'Dragonfire Cannon',
      variantName: 'Golden',
      poseName: '',
    });
    expect(extractSkylandersNameParts('Legendary Hand of Fate', 5)).toEqual({
      baseName: 'Hand of Fate',
      variantName: 'Legendary',
      poseName: '',
    });
    expect(extractSkylandersNameParts('Bronze Mystery Chest', 5)).toEqual({
      baseName: 'Mystery Chest',
      variantName: 'Bronze',
      poseName: '',
    });
    expect(extractSkylandersNameParts('Gold Mystery Chest', 5)).toEqual({
      baseName: 'Mystery Chest',
      variantName: 'Gold',
      poseName: '',
    });
    expect(extractSkylandersNameParts('Silver Mystery Chest', 5)).toEqual({
      baseName: 'Mystery Chest',
      variantName: 'Silver',
      poseName: '',
    });
    expect(extractSkylandersNameParts('Dark Sword (Dark Dagger)', 4)).toEqual({
      baseName: 'Dark Sword (Dark Dagger)',
      variantName: '',
      poseName: '',
    });
    expect(extractSkylandersNameParts('Life Sword (Jade Blade)', 4)).toEqual({
      baseName: 'Life Sword (Jade Blade)',
      variantName: '',
      poseName: '',
    });
    expect(extractSkylandersNameParts('Dark Pyramid', 3)).toEqual({
      baseName: 'Dark Pyramid',
      variantName: '',
      poseName: '',
    });
  });

  it('separates repose and LightCore prefixes from chase/deco variants', () => {
    expect(extractSkylandersNameParts('LightCore Chill', 1)).toEqual({
      baseName: 'Chill',
      variantName: '',
      poseName: 'LightCore',
    });
    expect(extractSkylandersNameParts('Legendary LightCore Chill', 1)).toEqual({
      baseName: 'Chill',
      variantName: 'Legendary',
      poseName: 'LightCore',
    });
    expect(extractSkylandersNameParts('LightCore Grim Creeper', 1)).toEqual({
      baseName: 'Grim Creeper',
      variantName: '',
      poseName: 'LightCore',
    });
    expect(
      extractSkylandersNameParts('Legendary LightCore Grim Creeper', 1),
    ).toEqual({
      baseName: 'Grim Creeper',
      variantName: 'Legendary',
      poseName: 'LightCore',
    });
    expect(extractSkylandersNameParts('Ninja Stealth Elf', 1)).toEqual({
      baseName: 'Stealth Elf',
      variantName: '',
      poseName: 'Ninja',
    });
    expect(extractSkylandersNameParts('Dark Stealth Elf', 1)).toEqual({
      baseName: 'Stealth Elf',
      variantName: 'Dark',
      poseName: '',
    });
    expect(extractSkylandersNameParts('Mega Ram Spyro', 1)).toEqual({
      baseName: 'Spyro',
      variantName: '',
      poseName: 'Mega Ram',
    });
    expect(extractSkylandersNameParts('Dark Mega Ram Spyro', 1)).toEqual({
      baseName: 'Spyro',
      variantName: 'Dark',
      poseName: 'Mega Ram',
    });
    expect(extractSkylandersNameParts('LightCore Star Strike', 1)).toEqual({
      baseName: 'Star Strike',
      variantName: '',
      poseName: 'LightCore',
    });
    expect(
      extractSkylandersNameParts('Enchanted LightCore Star Strike', 1),
    ).toEqual({
      baseName: 'Star Strike',
      variantName: 'Enchanted',
      poseName: 'LightCore',
    });
  });
});

describe('computeSkylandersSortOrder', () => {
  it('places Trap Shadow in Category 1 SWAP Force Magic rather than Traps', () => {
    const items: SkylandersToyInput[] = [
      {
        id: 'tower-of-time',
        name: 'Tower of Time',
        series_id: 'skylanders-swap-force',
        type: 'Magic Item',
        metadata_json: null,
      },
      {
        id: 'trap-shadow',
        name: 'Trap Shadow',
        series_id: 'skylanders-swap-force',
        type: 'SWAP Force',
        metadata_json: JSON.stringify({ element: 'Magic' }),
      },
      {
        id: 'wash-buckler',
        name: 'Wash Buckler',
        series_id: 'skylanders-swap-force',
        type: 'SWAP Force',
        metadata_json: JSON.stringify({ element: 'Water' }),
      },
      {
        id: 'hoot-loop',
        name: 'Hoot Loop',
        series_id: 'skylanders-swap-force',
        type: 'SWAP Force',
        metadata_json: JSON.stringify({ element: 'Magic' }),
      },
    ];

    const trapShadowElem = getSkylandersElement(items[1]);
    expect(getSkylandersCategoryOrder(items[1], trapShadowElem)).toBe(1);

    const sorted = computeSkylandersSortOrder(items);
    expect(sorted.map((s) => s.toy.name)).toEqual([
      'Wash Buckler',
      'Hoot Loop',
      'Trap Shadow',
      'Tower of Time',
    ]);
  });

  it('orders elements in canonical Portal of Power clockwise sequence with Kaos last', () => {
    const elements = [
      'Dark',
      'Tech',
      'Water',
      'Kaos',
      'Earth',
      'Air',
      'Light',
      'Magic',
      'Fire',
      'Undead',
      'Life',
    ];
    const items: SkylandersToyInput[] = elements.map((el) => ({
      id: el.toLowerCase(),
      name: `${el} Figure`,
      series_id: 'skylanders-imaginators',
      type: 'Sensei',
      metadata_json: JSON.stringify({ element: el }),
    }));

    const sorted = computeSkylandersSortOrder(items);
    expect(sorted.map((s) => s.toy.name)).toEqual([
      'Air Figure',
      'Life Figure',
      'Undead Figure',
      'Earth Figure',
      'Fire Figure',
      'Water Figure',
      'Magic Figure',
      'Tech Figure',
      'Light Figure',
      'Dark Figure',
      'Kaos Figure',
    ]);
  });

  it('defensively corrects Fire Acorn Creation Crystal element prefix when metadata is corrupted', () => {
    const items: SkylandersToyInput[] = [
      {
        id: 'fire-acorn',
        name: 'Fire Acorn',
        series_id: 'skylanders-imaginators',
        type: 'Creation Crystal',
        metadata_json: JSON.stringify({ element: 'Air' }),
      },
      {
        id: 'air-lantern',
        name: 'Air Lantern',
        series_id: 'skylanders-imaginators',
        type: 'Creation Crystal',
        metadata_json: JSON.stringify({ element: 'Air' }),
      },
      {
        id: 'fire-reactor',
        name: 'Fire Reactor',
        series_id: 'skylanders-imaginators',
        type: 'Creation Crystal',
        metadata_json: JSON.stringify({ element: 'Fire' }),
      },
    ];

    expect(getSkylandersElement(items[0])).toBe('fire');
    const sorted = computeSkylandersSortOrder(items);
    expect(sorted.map((s) => s.toy.name)).toEqual([
      'Air Lantern',
      'Fire Acorn',
      'Fire Reactor',
    ]);
  });

  it('sorts Gimmick -> Standard/LightCore -> Mini/Sidekick within the same element', () => {
    const items: SkylandersToyInput[] = [
      {
        id: 'sidekick-terrabite',
        name: 'Sidekick Terrabite',
        series_id: 'skylanders-trap-team',
        type: 'Mini',
        metadata_json: JSON.stringify({ element: 'Earth' }),
      },
      {
        id: 'prism-break-lc',
        name: 'Prism Break LightCore',
        series_id: 'skylanders-trap-team',
        type: 'LightCore',
        metadata_json: JSON.stringify({ element: 'Earth' }),
      },
      {
        id: 'bash-s2',
        name: 'Bash (Series 2)',
        series_id: 'skylanders-trap-team',
        type: 'Series 2',
        metadata_json: JSON.stringify({ element: 'Earth' }),
      },
      {
        id: 'wallop',
        name: 'Wallop',
        series_id: 'skylanders-trap-team',
        type: 'Trap Master',
        metadata_json: JSON.stringify({ element: 'Earth' }),
      },
    ];

    const sorted = computeSkylandersSortOrder(items);
    expect(sorted.map((s) => s.toy.name)).toEqual([
      'Wallop',
      'Bash (Series 2)',
      'Prism Break LightCore',
      'Sidekick Terrabite',
    ]);
  });
});

describe('migrations/seed_retired_toys.sql Skylanders integrity', () => {
  it('matches computeSkylandersSortOrder across all 512 Skylanders with zero drift', () => {
    const rootDir = process.cwd();
    const schemaSql = fs.readFileSync(
      path.join(rootDir, 'migrations', 'schema.sql'),
      'utf8',
    );
    const seedSql = fs.readFileSync(
      path.join(rootDir, 'migrations', 'seed_retired_toys.sql'),
      'utf8',
    );

    const db = new Database(':memory:');
    db.exec(schemaSql);
    db.exec(seedSql);

    const rows = db
      .prepare(
        `SELECT t.id, t.name, t.series_id, t.series, t.type, t.metadata_json,
                t.sort_index, ts.sort_index AS series_sort_index
         FROM toys t
         LEFT JOIN toy_series ts ON t.series_id = ts.id
         WHERE t.line = 'Skylanders'
         ORDER BY t.sort_index ASC`,
      )
      .all() as SeedSkylanderRow[];
    db.close();

    expect(rows).toHaveLength(512);

    const computed = computeSkylandersSortOrder(rows);
    for (const entry of computed) {
      expect(entry.toy.sort_index).toBe(entry.sortIndex);
    }

    const byId = new Map(computed.map((e) => [e.toy.id, e]));
    const sortOf = (id: string) => {
      const entry = byId.get(id);
      if (!entry) {
        throw new Error(`Missing expected Skylander ID: ${id}`);
      }
      return entry.sortIndex;
    };

    // Metadata integrity for Fire Acorn & Kaos Trap
    const fireAcorn = byId.get('fire-acorn-skylanders-imaginators-717')!;
    expect(
      (JSON.parse(fireAcorn.toy.metadata_json || '{}') as { element?: string })
        .element,
    ).toBe('Fire');
    const kaosTrap = byId.get('kaos-trap-skylanders-trap-team-587')!;
    expect(
      (JSON.parse(kaosTrap.toy.metadata_json || '{}') as { element?: string })
        .element,
    ).toBe('Kaos');

    // Trap Shadow sits in SWAP Force Magic right after Hoot Loop / Enchanted Hoot Loop, before Dune Bug
    const trapShadow = byId.get('trap-shadow-skylanders-swap-force-403')!;
    expect(trapShadow.categoryOrder).toBe(1);
    expect(trapShadow.element).toBe('magic');
    expect(sortOf('trap-shadow-skylanders-swap-force-403')).toBe(
      sortOf('enchanted-hoot-loop-skylanders-swap-force-402') + 1,
    );
    expect(sortOf('trap-shadow-skylanders-swap-force-403')).toBeLessThan(
      sortOf('dune-bug-skylanders-swap-force-407'),
    );
    expect(sortOf('trap-shadow-skylanders-swap-force-403')).toBeLessThan(
      sortOf('arkeyan-crossbow-skylanders-swap-force-443'),
    );

    // Base-before-variant assertions
    expect(sortOf('lightcore-chill-skylanders-giants-305')).toBeLessThan(
      sortOf('legendary-lightcore-chill-skylanders-giants-306'),
    );
    expect(
      sortOf('lightcore-grim-creeper-skylanders-swap-force-426'),
    ).toBeLessThan(
      sortOf('legendary-lightcore-grim-creeper-skylanders-swap-force-427'),
    );
    expect(sortOf('ninja-stealth-elf-skylanders-swap-force-398')).toBeLessThan(
      sortOf('dark-stealth-elf-skylanders-swap-force-399'),
    );
    expect(sortOf('mega-ram-spyro-skylanders-swap-force-409')).toBeLessThan(
      sortOf('dark-mega-ram-spyro-skylanders-swap-force-410'),
    );
    expect(sortOf('hot-streak-skylanders-superchargers-630')).toBeLessThan(
      sortOf('golden-hot-streak-skylanders-superchargers-633'),
    );
    expect(sortOf('golden-queen-skylanders-imaginators-664')).toBeLessThan(
      sortOf('dark-golden-queen-skylanders-imaginators-665'),
    );
    expect(sortOf('air-strike-skylanders-imaginators-662')).toBeLessThan(
      sortOf('egg-bomber-air-strike-skylanders-imaginators-663'),
    );
    expect(sortOf('dive-bomber-skylanders-superchargers-648')).toBeLessThan(
      sortOf('spring-ahead-dive-bomber-skylanders-superchargers-649'),
    );
  });
});
