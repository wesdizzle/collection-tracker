import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { computeGameCanonicalSeries } from './canonical_series.js';

describe('Canonical Series Logic Integrity Suite', () => {
  it('should map explicit spinoffs and localization titles correctly', () => {
    assert.equal(
      computeGameCanonicalSeries({ title: "Gargoyle's Quest" }),
      "Ghosts 'n Goblins",
    );
    assert.equal(
      computeGameCanonicalSeries({ title: "Gargoyle's Quest II" }),
      "Ghosts 'n Goblins",
    );
    assert.equal(
      computeGameCanonicalSeries({ title: "Demon's Crest" }),
      "Ghosts 'n Goblins",
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'The Final Fantasy Legend' }),
      'SaGa',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Final Fantasy Legend II' }),
      'SaGa',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Final Fantasy Legend III' }),
      'SaGa',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Final Fantasy Adventure' }),
      'Mana',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Harvest Moon (old)' }),
      'Story of Seasons',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: "Snake's Revenge" }),
      'Metal Gear',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Tetris Plus' }),
      'Tetris',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Detective Pikachu' }),
      'Pokémon',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Bubsy 3D: Furbitten Planet' }),
      'Bubsy',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'The Typing of the Dead' }),
      'The House of the Dead',
    );
  });

  it('should assign compilations and multi-game packs to compilation titles', () => {
    assert.equal(
      computeGameCanonicalSeries({ title: 'Rare Replay' }),
      'Rare Replay',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Xbox Live Arcade Compilation Disc',
      }),
      'Xbox Live Arcade',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'The Orange Box' }),
      'The Orange Box',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Heavy Rain & Beyond: Two Souls - Collection',
      }),
      'Heavy Rain & Beyond: Two Souls Collection',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Namco Museum 64' }),
      'Namco Museum',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Dreamcast Collection' }),
      'Dreamcast Collection',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: "Sonic's Ultimate Genesis Collection",
      }),
      "Sonic's Ultimate Genesis Collection",
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'NES Remix Pack' }),
      'NES Remix',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Nintendo Land' }),
      'Nintendo Land',
    );
  });

  it('should strip author/creator prefixes', () => {
    assert.equal(
      computeGameCanonicalSeries({ title: "Sid Meier's Civilization" }),
      'Civilization',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: "Sid Meier's Civilization VI" }),
      'Civilization',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: "Tom Clancy's Splinter Cell" }),
      'Splinter Cell',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: "Tom Clancy's Ghost Recon" }),
      'Ghost Recon',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: "Tom Clancy's Rainbow Six" }),
      'Rainbow Six',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: "Tom Clancy's The Division" }),
      'The Division',
    );
  });

  it('should strip numbers and Roman numerals for series naming', () => {
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Pikmin 2',
        collections: 'Pikmin 2',
      }),
      'Pikmin',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Mega Man 8',
        collections: 'Mega Man 8',
      }),
      'Mega Man',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Quake III Arena' }),
      'Quake',
    );
    assert.equal(computeGameCanonicalSeries({ title: 'Quake II' }), 'Quake');
  });

  it('should consolidate Mario platformers and handle Mario spin-offs', () => {
    assert.equal(
      computeGameCanonicalSeries({ title: 'Super Mario Bros.' }),
      'Super Mario',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Super Mario Bros. 2' }),
      'Super Mario',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Super Mario Bros. 3' }),
      'Super Mario',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Super Mario World' }),
      'Super Mario',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Super Mario 64' }),
      'Super Mario',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: "Super Mario World 2: Yoshi's Island",
      }),
      'Yoshi',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: "Yoshi's Island: Super Mario Advance 3",
      }),
      'Yoshi',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Paper Mario: The Thousand-Year Door',
      }),
      'Paper Mario',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: "Luigi's Mansion" }),
      "Luigi's Mansion",
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Dr. Mario 64' }),
      'Dr. Mario',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Mario Kart 64' }),
      'Mario Kart',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Mario Party 2' }),
      'Mario Party',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Mario Golf' }),
      'Mario Golf',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Mario Tennis' }),
      'Mario Tennis',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Mario & Luigi: Superstar Saga' }),
      'Mario & Luigi',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Mario vs. Donkey Kong 2: March of the Minis',
      }),
      'Mario vs. Donkey Kong',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Mario Hoops 3-on-3',
        franchises: 'Mario,Yoshi,Donkey Kong',
      }),
      'Mario',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Mario Super Sluggers',
        franchises: 'Mario,Yoshi,Donkey Kong',
      }),
      'Mario',
    );
    assert.equal(computeGameCanonicalSeries({ title: 'Mario Paint' }), 'Mario');
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Super Smash Bros. Melee',
        franchises: 'Mario,Donkey Kong',
      }),
      'Super Smash Bros.',
    );
  });

  it('should handle Donkey Kong, Game & Watch, and guest character filtering', () => {
    assert.equal(
      computeGameCanonicalSeries({ title: 'Donkey Kong Country' }),
      'Donkey Kong',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Game & Watch Gallery 2' }),
      'Game & Watch Gallery',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Skylanders SuperChargers',
        franchises: 'Skylanders,Donkey Kong',
      }),
      'Skylanders',
    );
  });

  it('should handle Sims, Persona, LOTR, and Sonic sub-series', () => {
    assert.equal(
      computeGameCanonicalSeries({ title: 'MySims Kingdom' }),
      'MySims',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'SimCity 2000' }),
      'SimCity',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'The Sims 2' }),
      'The Sims',
    );
    assert.equal(computeGameCanonicalSeries({ title: 'SimCopter' }), 'Sim');
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Persona 5 Strikers',
        franchises: 'Shin Megami Tensei',
      }),
      'Persona',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'The Hobbit' }),
      'The Lord of the Rings',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Middle-earth: Shadow of Mordor' }),
      'The Lord of the Rings',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Sonic Riders' }),
      'Sonic the Hedgehog',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Sonic Rush' }),
      'Sonic the Hedgehog',
    );
  });

  it('should handle superhero and LEGO brand consolidations', () => {
    assert.equal(
      computeGameCanonicalSeries({ title: 'Batman: Return of the Joker' }),
      'DC',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Spider-Man 2' }),
      'Marvel',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'LEGO Star Wars' }),
      'LEGO',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: "Dragon Warrior Monsters 2: Cobi's Journey",
      }),
      'Dragon Quest',
    );
  });
});
