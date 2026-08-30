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
    assert.equal(
      computeGameCanonicalSeries({ title: 'Kid Dracula' }),
      'Castlevania',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'DK: Jungle Climber' }),
      'Donkey Kong',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Sonic & Sega All-Stars Racing with Banjo-Kazooie',
        franchises: 'Sonic The Hedgehog, Banjo & Kazooie',
      }),
      'Sonic the Hedgehog',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Banjo-Tooie',
        franchises: 'Banjo & Kazooie',
      }),
      'Banjo-Kazooie',
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
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Llamasoft: The Jeff Minter Story',
        collections: 'Gold Master Series, Gridrunner',
      }),
      'Gold Master Series',
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

  it('should strip numbers and Roman numerals for series naming while protecting core numbered IPs', () => {
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
    assert.equal(
      computeGameCanonicalSeries({ title: 'Final Fantasy XII' }),
      'Final Fantasy',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Dragon Quest XI' }),
      'Dragon Quest',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Mighty No. 9' }),
      'Mighty No. 9',
    );
    assert.equal(computeGameCanonicalSeries({ title: 'Area 51' }), 'Area 51');
    assert.equal(
      computeGameCanonicalSeries({ title: 'Cyberpunk 2077' }),
      'Cyberpunk 2077',
    );
    assert.equal(computeGameCanonicalSeries({ title: '1942' }), '1942');
  });

  it('should consolidate Mario platformers and handle Mario spin-offs with WarioWare and sports precision', () => {
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
      computeGameCanonicalSeries({ title: 'Mario Strikers Charged' }),
      'Mario Strikers',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Mario Super Sluggers' }),
      'Mario Baseball',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'WarioWare: Smooth Moves' }),
      'WarioWare',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Wario Land 4' }),
      'Wario',
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
    assert.equal(computeGameCanonicalSeries({ title: 'Mario Paint' }), 'Mario');
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Super Smash Bros. Melee',
        franchises: 'Mario,Donkey Kong',
      }),
      'Super Smash Bros.',
    );
  });

  it('should handle Donkey Kong and Game & Watch with correct precedence over Mario crossover tags', () => {
    assert.equal(
      computeGameCanonicalSeries({ title: 'Donkey Kong Country' }),
      'Donkey Kong',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Game & Watch Gallery',
        franchises: 'Mario, Yoshi, Donkey Kong',
      }),
      'Game & Watch',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Game & Watch Gallery 2',
        franchises: 'Mario, Donkey Kong, Yoshi',
      }),
      'Game & Watch',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Game & Watch Collection',
        franchises: 'Donkey Kong, Mario',
      }),
      'Game & Watch',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Skylanders SuperChargers',
        franchises: 'Skylanders,Donkey Kong',
      }),
      'Skylanders',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Crash Nitro Kart',
        collections: 'Crash Racing',
        franchises: 'Crash Bandicoot, Spyro the Dragon',
      }),
      'Crash Bandicoot',
    );
  });

  it('should split superheroes into hero/team series and partition LEGO themes', () => {
    assert.equal(
      computeGameCanonicalSeries({ title: 'Batman: Return of the Joker' }),
      'Batman',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Batman: Arkham City' }),
      'Batman',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Superman: Shadow of Apokolips' }),
      'Superman',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Injustice 2' }),
      'Injustice',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Spider-Man 2' }),
      'Spider-Man',
    );
    assert.equal(computeGameCanonicalSeries({ title: 'Wolverine' }), 'X-Men');
    assert.equal(
      computeGameCanonicalSeries({ title: 'X-Men Origins: Wolverine' }),
      'X-Men',
    );
    assert.equal(computeGameCanonicalSeries({ title: 'Iron Man' }), 'Iron Man');
    assert.equal(
      computeGameCanonicalSeries({ title: 'Marvel: Ultimate Alliance' }),
      'Marvel',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'DC Universe Online' }),
      'DC',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'LEGO Star Wars II: The Original Trilogy',
      }),
      'LEGO Star Wars',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'LEGO Batman: The Videogame' }),
      'LEGO Batman',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'LEGO Marvel Super Heroes' }),
      'LEGO Marvel',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'LEGO Harry Potter: Years 1-4' }),
      'LEGO Harry Potter',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Bionicle Heroes' }),
      'Bionicle',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'LEGO Island' }),
      'LEGO Island',
    );
  });

  it('should handle dedicated multi-franchise crossovers and Musou host universes', () => {
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Marvel vs. Capcom 2: New Age of Heroes',
      }),
      'Marvel vs. Capcom',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Mario & Sonic at the Rio 2016 Olympic Games',
      }),
      'Mario & Sonic at the Olympic Games',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Mortal Kombat vs. DC Universe',
      }),
      'Mortal Kombat vs. DC Universe',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Puyo Puyo Tetris 2',
      }),
      'Puyo Puyo Tetris',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Capcom vs. SNK 2',
      }),
      'Capcom vs. SNK',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Street Fighter X Tekken',
      }),
      'Street Fighter X Tekken',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Hyrule Warriors: Definitive Edition',
        franchises: 'The Legend of Zelda, Musou',
      }),
      'The Legend of Zelda',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Dragon Quest Heroes II',
        franchises: 'Dragon Quest, Musou',
      }),
      'Dragon Quest',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Fire Emblem Warriors: Three Hopes',
      }),
      'Fire Emblem',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Yakuza 0',
      }),
      'Like a Dragon',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Judgment',
      }),
      'Like a Dragon',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Lost Judgment',
      }),
      'Like a Dragon',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Castlevania Judgment',
        franchises: 'Castlevania',
      }),
      'Castlevania',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Gears of War: Judgment',
        franchises: 'Gears of War',
      }),
      'Gears of War',
    );
  });

  it('should handle Sims, Persona, LOTR, and Sonic sub-series with casing normalization', () => {
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
        franchises: 'Shin Megami Tensei, Musou',
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
      computeGameCanonicalSeries({
        title: 'Tails and the Music Maker',
        franchises: 'Sonic The Hedgehog',
      }),
      'Sonic the Hedgehog',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Watch Dogs 2',
        franchises: 'Watch_Dogs',
      }),
      'Watch Dogs',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'EarthBound',
        franchises: 'Earthbound',
      }),
      'EarthBound',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'EarthBound Beginnings',
      }),
      'EarthBound',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Mother',
      }),
      'EarthBound',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Mother 1+2',
      }),
      'EarthBound',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Mother 3',
        franchises: 'Earthbound',
      }),
      'EarthBound',
    );
  });
});
