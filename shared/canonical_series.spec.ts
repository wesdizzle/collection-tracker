import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  computeGameCanonicalSeries,
  computeGameCanonicalSeriesWithSource,
} from './canonical_series.js';

describe('computeGameCanonicalSeriesWithSource', () => {
  it('classifies bare generic titles as title_fallback', () => {
    for (const title of ['Tennis', 'Golf', 'Baseball', 'Star Fox']) {
      assert.deepEqual(computeGameCanonicalSeriesWithSource({ title }), {
        series: title,
        source: 'title_fallback',
      });
    }
  });

  it('classifies IGDB-collection-backed series as metadata', () => {
    assert.deepEqual(
      computeGameCanonicalSeriesWithSource({
        title: 'Star Fox 64',
        collections: 'Star Fox',
        franchises: 'Star Fox',
      }),
      { series: 'Star Fox', source: 'metadata' },
    );
  });

  it('classifies hand-written franchise rules as curated and agrees with computeGameCanonicalSeries', () => {
    const game = { title: 'Super Mario Bros. 3' };
    const detailed = computeGameCanonicalSeriesWithSource(game);
    assert.equal(detailed.source, 'curated');
    assert.equal(detailed.series, computeGameCanonicalSeries(game));
  });
});

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
      computeGameCanonicalSeries({
        title: 'Antonblast',
        collections: 'Antonball',
      }),
      'Anton',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Antonball Deluxe',
      }),
      'Anton',
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
    assert.equal(
      computeGameCanonicalSeries({ title: 'Wolverine' }),
      'Wolverine',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Wolverine: Adamantium Rage',
        franchises: 'Marvel, X-Men, Wolverine',
      }),
      'Wolverine',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'X-Men Origins: Wolverine' }),
      'X-Men',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Silver Surfer',
        franchises: 'Silver Surfer, Marvel',
      }),
      'Silver Surfer',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Swamp Thing',
        franchises: 'Swamp Thing, DC Comics',
      }),
      'Swamp Thing',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Aquaman: Battle for Atlantis',
        franchises: 'Aquaman, DC Comics',
      }),
      'Aquaman',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Young Justice: Legacy',
        franchises: 'Young Justice, DC Comics',
      }),
      'Young Justice',
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

  it('should unify multi-volume compilations and ignore single included-game IGDB tags', () => {
    assert.equal(
      computeGameCanonicalSeries({
        title: 'PopCap Arcade Vol. 1',
        collections: 'PopCap Hits!, Bejeweled, Zuma, Feeding Frenzy',
      }),
      'PopCap Arcade',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'PopCap Arcade Vol. 2',
        collections: 'PopCap Arcade, Peggle, Feeding Frenzy',
      }),
      'PopCap Arcade',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Atari Recharged Collection 3',
        collections: "Yars' Revenge",
      }),
      'Atari Recharged Collection',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Atari Recharged Collection 4',
        collections: 'Missile Command',
      }),
      'Atari Recharged Collection',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Atari Flashback Classics',
        collections: "Yars' Revenge, Centipede, Gun Fight, Swordquest, Combat",
        franchises: 'Centipede',
      }),
      'Atari Flashback Classics',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Best of PlayStation Network Vol. 1',
        collections: 'Fat Princess',
      }),
      'Best of PlayStation Network',
    );
  });

  it('should disambiguate Rune Factory, classic Marvelous Story of Seasons, and post-split Natsume Harvest Moon', () => {
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Rune Factory 2: A Fantasy Harvest Moon',
        collections: 'Rune Factory',
        franchises: 'Harvest Moon, Story of Seasons, Rune Factory',
      }),
      'Rune Factory',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Harvest Moon 64',
        collections: 'Harvest Moon (old)',
        franchises: 'Harvest Moon, Story of Seasons',
      }),
      'Story of Seasons',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Harvest Moon: One World',
        collections: 'Harvest Moon (new)',
        franchises: 'Harvest Moon',
      }),
      'Harvest Moon',
    );
  });

  it('should guard primary series against guest franchise overrides and resolve Classic NES Series ports', () => {
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Skylanders: SuperChargers Racing',
        collections: 'Skylanders',
        franchises: 'Spyro the Dragon, Mario, Donkey Kong, Skylanders',
      }),
      'Skylanders',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Scribblenauts Mega Pack',
        collections: 'Scribblenauts',
        franchises: 'DC Comics, Justice League',
      }),
      'Scribblenauts',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Disney Infinity 3.0',
        collections: 'Disney Infinity',
        franchises: 'Star Wars, Marvel, Disney',
      }),
      'Disney Infinity',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Mario & Luigi: Paper Jam',
        collections: 'Paper Mario, Mario & Luigi',
        franchises: 'Mario',
      }),
      'Mario & Luigi',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Starlink: Battle for Atlas',
        franchises: 'Star Fox',
      }),
      'Starlink',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Dead Cells: Return to Castlevania Edition',
        franchises: 'Evil Dead, Castlevania',
      }),
      'Dead Cells',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Classic NES Series: The Legend of Zelda',
        collections: 'The Legend of Zelda, Classic NES Series',
        franchises: 'The Legend of Zelda',
      }),
      'The Legend of Zelda',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Classic NES Series: Ice Climber',
        collections: 'Classic NES Series',
      }),
      'Ice Climber',
    );
  });

  it('should unify sub-collections into parent franchises and preserve protected numbered titles and edge cases', () => {
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Xenoblade Chronicles X: Definitive Edition',
        collections: 'Xenoblade Chronicles',
        franchises: 'Xenoblade',
      }),
      'Xenoblade Chronicles',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Wolfenstein: The New Order',
        collections: 'Wolfenstein: The New Order, Wolfenstein',
        franchises: 'Wolfenstein',
      }),
      'Wolfenstein',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Kirby: Canvas Curse',
        collections: 'Kirby, Kirby: Canvas Curse',
        franchises: 'Kirby',
      }),
      'Kirby',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Castlevania: Dracula X',
        collections: 'Castlevania, Castlevania: Dracula X',
        franchises: 'Castlevania',
      }),
      'Castlevania',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Castlevania: Lords of Shadow',
        collections: 'Castlevania: Lords of Shadow, Castlevania',
        franchises: 'Castlevania',
      }),
      'Castlevania',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Minecraft Dungeons: Ultimate Edition',
        collections: 'Minecraft, Minecraft Dungeons',
      }),
      'Minecraft',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Ms. Pac-Man',
        collections: 'Ms. Pac-Man',
        franchises: 'Pac-Man',
      }),
      'Pac-Man',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Space Channel 5: Part 2',
        collections: 'Space Channel 5',
      }),
      'Space Channel 5',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'The Wonderful 101: Remastered',
      }),
      'The Wonderful 101',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Super Scope 6',
        collections: 'Super Scope',
      }),
      'Super Scope 6',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Ghost of Tsushima',
        collections: 'Ghost',
      }),
      'Ghost of Tsushima',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Beyond: Two Souls',
      }),
      'Beyond: Two Souls',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Hyper Light Drifter',
        collections: 'Hyper Light',
      }),
      'Hyper Light Drifter',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Nights: Journey of Dreams',
        collections: 'Nights',
        franchises: 'Nights into Dreams',
      }),
      'Nights into Dreams',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Viva Piñata',
        collections: 'Viva Pinata',
      }),
      'Viva Piñata',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: "Mike Tyson's Punch-Out!!",
        collections: 'Punch-Out!!',
        franchises: 'Punch-Out!!, Mike Tyson',
      }),
      'Punch-Out!!',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: "Disney's DuckTales",
        collections: 'DuckTales',
        franchises: 'DuckTales, Disney, Donald Duck',
      }),
      'DuckTales',
    );
  });

  it('should disambiguate multi-franchise crossovers and protect standalone titles from umbrella hijacking', () => {
    assert.equal(
      computeGameCanonicalSeries({
        title: 'PlayStation Move Heroes',
        franchises: 'Ratchet & Clank, Jak and Daxter, Sly Cooper',
      }),
      'PlayStation Move Heroes',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'The Wolf Among Us',
        franchises: 'Fables, DC Comics',
        collections: 'The Wolf Among Us',
      }),
      'The Wolf Among Us',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Hometown Story',
        franchises: 'Harvest Moon, Story of Seasons',
      }),
      'Hometown Story',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Innocent Life: A Futuristic Harvest Moon',
        franchises: 'Harvest Moon, Story of Seasons',
        collections: 'Harvest Moon (old)',
      }),
      'Story of Seasons',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Castlevania: Lords of Shadow',
        franchises: 'Castlevania',
        collections: 'Castlevania: Lords of Shadow',
      }),
      'Castlevania',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Wolfenstein: The New Order',
        franchises: 'Wolfenstein',
        collections: 'Wolfenstein: The New Order',
      }),
      'Wolfenstein',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Bloodstained: Curse of the Moon',
        franchises: 'Bloodstained',
        collections: 'Bloodstained: Curse of the Moon',
      }),
      'Bloodstained',
    );
  });

  it('should not collide with Object.prototype keys such as constructor', () => {
    assert.equal(
      computeGameCanonicalSeries({ title: 'Constructor' }),
      'Constructor',
    );
    assert.deepEqual(
      computeGameCanonicalSeriesWithSource({ title: 'Constructor' }),
      { series: 'Constructor', source: 'title_fallback' },
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Constructor',
        collections: 'Constructor',
      }),
      'Constructor',
    );
    assert.equal(computeGameCanonicalSeries({ title: 'toString' }), 'toString');
  });

  it('demotes studio/network/creator umbrellas so Disney, Pixar, DreamWorks, and Nickelodeon games resolve to individual IPs', () => {
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Disney Infinity: 2.0',
        franchises: 'Disney, Marvel',
      }),
      'Disney Infinity',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Disney-Pixar Ratatouille',
        franchises: 'Disney, Pixar, Ratatouille',
      }),
      'Ratatouille',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Disney-Pixar Up',
        franchises: 'Up, Disney, Pixar',
      }),
      'Up',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Disney-Pixar Brave',
        franchises: 'Disney, Brave, Pixar',
      }),
      'Brave',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Disney-Pixar Cars 2',
        collections: 'Cars',
        franchises: 'Disney, Pixar, Cars',
      }),
      'Cars',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Disney Planes',
        franchises: 'Disney, Planes',
      }),
      'Planes',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Disney Tangled',
        franchises: 'Tangled, Disney',
      }),
      'Tangled',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Disney Magical World 2',
        collections: 'Disney Magical World',
        franchises: 'Disney',
      }),
      'Disney Magical World',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Disney Princess',
        collections: 'Disney Princess',
        franchises: 'Disney',
      }),
      'Disney Princess',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Disney Sing It',
        collections: 'Disney Sing It',
        franchises: 'Disney',
      }),
      'Disney Sing It',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Disney Club Penguin - Game Day!',
        collections: 'Club Penguin',
        franchises: 'Disney, Club Penguin',
      }),
      'Club Penguin',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'TaleSpin',
        franchises: 'Disney',
      }),
      'TaleSpin',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: "Disney's The Emperor's New Groove",
        franchises: 'Disney',
      }),
      "The Emperor's New Groove",
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: "Disney's Party",
        franchises: 'Disney, Mickey Mouse',
      }),
      'Mickey Mouse',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Disney Illusion Island',
        franchises: 'Disney, Mickey Mouse, Donald Duck, Goofy',
      }),
      'Disney Illusion Island',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'DreamWorks How to Train Your Dragon 2',
      }),
      'How to Train Your Dragon',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Nickelodeon SpongeBob SquarePants - Battle for Bikini Bottom',
      }),
      'SpongeBob SquarePants - Battle for Bikini Bottom',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Nickelodeon Kart Racers',
        collections: 'Nickelodeon',
        franchises: 'Spongebob Squarepants, Teenage Mutant Ninja Turtles',
      }),
      'Nickelodeon Kart Racers',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: "Tom Clancy's EndWar",
        franchises: 'Tom Clancy’s',
      }),
      'EndWar',
    );
  });

  it('splits sports leagues into actual game franchises while keeping Star Wars unified', () => {
    assert.equal(
      computeGameCanonicalSeries({
        title: 'NBA 2K2',
        collections: 'NBA 2K',
        franchises: 'NBA',
      }),
      'NBA 2K',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'NBA Live 96',
        collections: 'NBA Live',
        franchises: 'NBA',
      }),
      'NBA Live',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'MLB The Show 16',
        collections: 'MLB: The Show',
        franchises: 'MLB',
      }),
      'MLB: The Show',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'NHL 95',
        collections: 'EA Sports NHL',
        franchises: 'NHL, NHLPA',
      }),
      'EA Sports NHL',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'World Series Baseball',
        collections: 'SEGA SPORTS',
        franchises: 'MLB',
      }),
      'World Series Baseball',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: "Nigel Mansell's World Championship Racing",
        franchises: 'Formula 1',
      }),
      "Nigel Mansell's World Championship Racing",
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Formula One 2001',
        collections: 'F1',
        franchises: 'Formula 1',
      }),
      'F1',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Super Star Wars: Return of the Jedi',
        collections: 'Super Star Wars',
        franchises: 'Star Wars',
      }),
      'Star Wars',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Vader Immortal: A Star Wars VR Series',
        collections: 'Vader Immortal',
        franchises: 'Star Wars',
      }),
      'Star Wars',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Angry Birds Star Wars',
        collections: 'Angry Birds',
        franchises: 'Angry Birds, Star Wars',
      }),
      'Angry Birds',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Soulcalibur IV',
        collections: 'SoulCalibur',
        franchises: 'SoulCalibur, Star Wars',
      }),
      'SoulCalibur',
    );
  });

  it('prevents curated substring false positives across Persona, Sim, Yoshi, Mario, Hulk, Marvel, DC, Sonic, and LEGO', () => {
    assert.equal(
      computeGameCanonicalSeries({ title: 'Personal Trainer - Cooking' }),
      'Personal Trainer - Cooking',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Kochkurs - Was Wollen Wir Heute Kochen',
        collections: 'Personal Trainer, Touch! Generations',
      }),
      'Personal Trainer',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Simple DS Series Vol. 1' }),
      'Simple DS Series',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Simon the Sorcerer Origins',
        collections: 'Simon the Sorcerer',
      }),
      'Simon the Sorcerer',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Catz',
        collections: 'Petz, Nakayoshi Pet, Nakayoshi',
      }),
      'Catz',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Catz',
        collections: 'Petz',
      }),
      'Petz',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Mario Andretti Racing' }),
      'Mario Andretti Racing',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Mario Lemieux Hockey' }),
      'Mario Lemieux Hockey',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'SSX on Tour with Mario',
        collections: 'SSX',
        franchises: 'Mario',
      }),
      'SSX',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Mario Power Tennis' }),
      'Mario Tennis',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Mario Smash Football',
        collections: 'Mario Strikers, Super Mario',
        franchises: 'Mario Bros., Mario',
      }),
      'Mario Strikers',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'マリオバスケ 3on3',
        collections: 'Super Mario, Mario Sports',
        franchises: 'Mario, Final Fantasy, Donkey Kong, Yoshi, Wario',
      }),
      'Super Mario',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Space Hulk - Vengeance of the Blood Angels',
      }),
      'Space Hulk - Vengeance of the Blood Angels',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: "Hulk Hogan's Main Event" }),
      "Hulk Hogan's Main Event",
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Marvel Land' }),
      'Marvel Land',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Marvelous - Mouhitotsu no Takara-jima',
      }),
      'Marvelous - Mouhitotsu no Takara-jima',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Constantine',
        collections: 'DC Universe',
        franchises: 'DC Comics',
      }),
      'Constantine',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Sgt. Rock: On the Frontline',
        collections: 'DC Universe',
        franchises: 'DC Comics',
      }),
      'Sgt. Rock',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Sonic Wings',
        collections: 'Aero Fighters',
      }),
      'Aero Fighters',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Sonic Spike - World Championship Beach Volleyball',
      }),
      'Sonic Spike - World Championship Beach Volleyball',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'LEGO Horizon Adventures',
        collections: 'Horizon',
        franchises: 'Horizon, LEGO',
      }),
      'LEGO Horizon',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'PS4 IDU - 2017 Spring Refresh - LEGO Dimensions',
      }),
      'PS4 IDU - 2017 Spring Refresh - LEGO Dimensions',
    );
  });

  it('handles comma-containing IGDB tags, trailing connectors, scoring ties, standalone colon titles, and label ignores', () => {
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Warhammer 40,000: Boltgun',
        collections: 'Warhammer 40,000',
        franchises: 'Warhammer 40,000, Warhammer',
      }),
      'Warhammer 40,000',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Monsters, Inc. Scream Arena',
        franchises: 'Monsters, Inc., Pixar',
      }),
      'Monsters, Inc.',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Ed, Edd n Eddy: The Mis-Edventures',
        franchises: 'Cartoon Network, Ed, Edd n Eddy',
      }),
      'Ed, Edd n Eddy',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: "Tony Hawk's Pro Skater 3 + 4" }),
      "Tony Hawk's Pro Skater 3 + 4",
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'La-Mulana 1 & 2' }),
      'La-Mulana 1 & 2',
    );
    assert.equal(
      computeGameCanonicalSeries({ title: 'Troll and I' }),
      'Troll and I',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Gunvolt Chronicles: Luminous Avenger iX',
        collections: 'Gunvolt Chronicles: Luminous Avenger iX',
      }),
      'Gunvolt Chronicles: Luminous Avenger iX',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Ben 10: Galactic Racing',
        franchises: 'Ben 10',
      }),
      'Ben 10',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Excite Bike',
        collections: 'Excitebike',
        franchises: 'Excite',
      }),
      'Excitebike',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Boom Street',
        collections: 'Itadaki Street',
        franchises: 'Mario, Dragon Quest',
      }),
      'Fortune Street',
    );
    assert.deepEqual(
      computeGameCanonicalSeriesWithSource({ title: 'Anno: Mutationem' }),
      { series: 'Anno: Mutationem', source: 'title_fallback' },
    );
    assert.deepEqual(
      computeGameCanonicalSeriesWithSource({ title: 'Murdered: Soul Suspect' }),
      { series: 'Murdered: Soul Suspect', source: 'title_fallback' },
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Wii Music',
        collections: 'Wii',
      }),
      'Wii Music',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Pinball Dreams',
        collections: 'Pinball',
      }),
      'Pinball Dreams',
    );
    assert.equal(
      computeGameCanonicalSeries({
        title: 'Dirt 2',
        collections: 'Dirt',
      }),
      'DiRT',
    );
  });
});
