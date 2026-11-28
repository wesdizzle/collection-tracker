/**
 * @file title_matching.spec.ts
 * @description Unit tests for title_matching.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeTitleForMatching,
  normalizeForIgdbMatch,
  normalizeInvertedArticle,
  cleanTitleForIgdbLookup,
  stripIgdbEditionWrapper,
  extractTitleSequelSignature,
  buildIgdbMatchVariants,
  buildDetailedIgdbMatchVariants,
  titlesMatch,
  gameMatchesReleaseWithAlternatives,
  isCompilationOrBundleTitle,
  extractEditionSuffix,
  extractPhysicalEditionForVariant,
  resolveCanonicalDisplayTitle,
  areCanonicalTitlesSequelCompatible,
  buildCanonicalLinkerMatchKeys,
  buildStructuralTitleCandidates,
  parseComboCartConstituentTitles,
} from './title_matching.js';

describe('Title Normalization', () => {
  it('should normalize basic titles correctly', () => {
    expect(normalizeTitleForMatching('Super Mario World')).toBe(
      'supermarioworld',
    );
    expect(normalizeTitleForMatching('Tomb Raider II')).toBe('tombraiderii');
  });

  it('should remove common articles and publisher prefixes', () => {
    // "Sega" publisher prefix and "the" article removed
    expect(normalizeTitleForMatching('Sega Sonic the Hedgehog: Spinball')).toBe(
      'sonicspinball',
    );
    expect(normalizeTitleForMatching('Sega Sonic Spinball')).toBe(
      'sonicspinball',
    );
  });

  it('preserves differentiating franchise nouns like "lego" and "the hedgehog" while redirecting exact Spinball/Chaos DAT naming', () => {
    // Exact historical DAT redirects handle Spinball/Chaos while other "the hedgehog" titles keep their tokens
    expect(normalizeTitleForMatching('Sega Sonic the Hedgehog: Spinball')).toBe(
      'sonicspinball',
    );
    expect(normalizeTitleForMatching('Sonic the Hedgehog Chaos')).toBe(
      'sonicchaos',
    );
    expect(normalizeTitleForMatching('Shadow the Hedgehog')).toBe(
      'shadowhedgehog',
    );
    expect(normalizeTitleForMatching("LEGO Marvel's Avengers")).not.toBe(
      normalizeTitleForMatching("Marvel's Avengers"),
    );
  });

  it('should handle Macrons and transliterations', () => {
    expect(normalizeTitleForMatching('Pokémon Colosseum')).toBe(
      'pokemoncolosseum',
    );
  });

  it('should resolve explicit overrides', () => {
    expect(
      normalizeTitleForMatching(
        'The Legend of Zelda: Ocarina of Time + The Legend of Zelda: Ocarina of Time - Master Quest: Two-game Bonus Disc!',
      ),
    ).toBe('legendzeldaocarinatimemasterquest');
    expect(normalizeTitleForMatching('Fire Emblem - Three Hopes')).toBe(
      'fireemblemwarriorsthreehopes',
    );
  });
});

describe('Title Matching Strategies', () => {
  it('should match exact normalized titles (Strategy 1)', () => {
    expect(titlesMatch('Tomb Raider', 'Tomb Raider')).toBe(true);
    expect(titlesMatch('Sonic Spinball', 'Sega Sonic Spinball')).toBe(true);
  });

  it('should match hyphenated dimensions like Wolfenstein 3D to Wolfenstein 3-D', () => {
    expect(titlesMatch('Wolfenstein 3D', 'Wolfenstein 3-D')).toBe(true);
    expect(titlesMatch('Wolfenstein 3-D', 'Wolfenstein 3D')).toBe(true);
  });

  it('should split on slash alternatives but NOT fraction slashes like 358/2', () => {
    // Should split on slash for actual alternatives
    expect(
      titlesMatch(
        'Sonic Spinball / Sonic the Hedgehog Spinball',
        'Sonic Spinball',
      ),
    ).toBe(true);
    // Should NOT split fraction slashes in Kingdom Hearts 358/2 Days
    expect(
      titlesMatch('Kingdom Hearts 358/2 Days', 'Kingdom Hearts - 358-2 Days'),
    ).toBe(true);
  });

  it('should match subtitles via dash/colon splitting (Strategy 2)', () => {
    // Tomb Raider II
    expect(
      titlesMatch('Tomb Raider II', 'Tomb Raider II - Starring Lara Croft'),
    ).toBe(true);
    // Wave Race 64
    expect(titlesMatch('Wave Race 64', 'Wave Race 64 - Kawasaki Jet Ski')).toBe(
      true,
    );
    // Jet Set Radio Future (with acronym prefix)
    expect(
      titlesMatch('Jet Set Radio Future', 'JSRF - Jet Set Radio Future'),
    ).toBe(true);
    // Return to Castle Wolfenstein: Tides of War matches dash/colon subtitle
    expect(
      titlesMatch(
        'Return to Castle Wolfenstein: Tides of War',
        'Return to Castle Wolfenstein - Tides of War',
      ),
    ).toBe(true);
    // Removed edition/bundle-collapsing pre-split aliases must NOT collapse blindly in bare titlesMatch
    expect(
      titlesMatch(
        'Super Mario All-Stars: Limited Edition',
        'Super Mario All-Stars',
      ),
    ).toBe(false);
    expect(
      titlesMatch(
        "Assassin's Creed Chronicles: Trilogy Pack",
        "Assassin's Creed Chronicles",
      ),
    ).toBe(false);
    // Prince of Persia Trilogy HD override
    expect(
      titlesMatch('Prince of Persia Trilogy HD', 'Prince of Persia Trilogy'),
    ).toBe(true);
    // Jak and Daxter / Ratchet & Clank collection vs trilogy mapping
    expect(
      titlesMatch('Jak and Daxter Collection', 'Jak and Daxter Trilogy'),
    ).toBe(true);
    expect(
      titlesMatch('Ratchet & Clank Collection', 'Ratchet & Clank Trilogy'),
    ).toBe(true);
    // Walking Dead Season Two alias matching
    expect(
      titlesMatch(
        'The Walking Dead: Season Two',
        'Walking Dead, The - Season Two - A Telltale Games Series',
        'Walking Dead, The - Season Two - A Telltale Games Series (USA)',
      ),
    ).toBe(true);

    // GBA Super Mario Advance 2 and 3 swapped segment matching
    expect(
      titlesMatch(
        'Super Mario World: Super Mario Advance 2',
        'Super Mario Advance 2 - Super Mario World',
      ),
    ).toBe(true);
    expect(
      titlesMatch(
        "Yoshi's Island: Super Mario Advance 3",
        "Super Mario Advance 3 - Yoshi's Island",
      ),
    ).toBe(true);

    // Edition-collapsing redirects removed: distinct editions and LEGO/non-LEGO titles remain separate
    expect(
      titlesMatch(
        'NieR: Automata',
        'NieR - Automata - The End of YoRHa Edition',
      ),
    ).toBe(false);
    expect(titlesMatch('Overcooked: Gourmet Edition', 'Overcooked!')).toBe(
      false,
    );
    expect(titlesMatch("LEGO Marvel's Avengers", "Marvel's Avengers")).toBe(
      false,
    );
  });

  it('should prevent edition games from matching base releases without that edition', () => {
    // Three Hopes vs Warriors
    expect(
      titlesMatch('Fire Emblem Warriors: Three Hopes', 'Fire Emblem Warriors'),
    ).toBe(false);
    expect(
      titlesMatch(
        'Fire Emblem Warriors: Three Hopes',
        'Fire Emblem - Three Hopes',
      ),
    ).toBe(true);

    // LittleBigPlanet 2
    expect(
      titlesMatch('LittleBigPlanet 2: Special Edition', 'LittleBigPlanet 2'),
    ).toBe(false);
    expect(
      titlesMatch(
        'LittleBigPlanet 2: Special Edition',
        'LittleBigPlanet 2 - Special Edition',
      ),
    ).toBe(true);

    // Dishonored
    expect(
      titlesMatch('Dishonored: Game of the Year Edition', 'Dishonored'),
    ).toBe(false);
    expect(
      titlesMatch(
        'Dishonored: Game of the Year Edition',
        'Dishonored - Game of the Year Edition',
      ),
    ).toBe(true);

    // Resident Evil Director's Cut
    expect(titlesMatch("Resident Evil: Director's Cut", 'Resident Evil')).toBe(
      false,
    );
    expect(
      titlesMatch(
        "Resident Evil: Director's Cut",
        "Resident Evil - Director's Cut",
      ),
    ).toBe(true);

    // Metal Gear Solid 2 Substance
    expect(
      titlesMatch(
        'Metal Gear Solid 2: Substance',
        'Metal Gear Solid 2 - Sons of Liberty',
      ),
    ).toBe(false);
    expect(
      titlesMatch(
        'Metal Gear Solid 2: Substance',
        'Metal Gear Solid 2 - Substance',
      ),
    ).toBe(true);
  });

  it('should match by removing middle segments like "Mission Pack 1" (Strategy 3)', () => {
    expect(
      titlesMatch(
        'Grand Theft Auto: London 1969',
        'Grand Theft Auto - Mission Pack 1 - London 1969',
      ),
    ).toBe(true);
  });

  it('should match and resolve bonus discs using parenthetical matches (Strategy 4)', () => {
    // "Pokémon Colosseum Bonus Disc" matches "Pokemon Colosseum (USA) (Bonus Disc)"
    expect(
      titlesMatch(
        'Pokémon Colosseum Bonus Disc',
        'Pokemon Colosseum',
        'Pokemon Colosseum (USA) (Bonus Disc)',
      ),
    ).toBe(true);

    // "Pokémon Colosseum Bonus Disc" matches Japanese "Tokusei Disc" and "Kakuchou Disc"
    expect(
      titlesMatch(
        'Pokémon Colosseum Bonus Disc',
        'Pokemon Colosseum',
        'Pokemon Colosseum - Nintendo Tokusei Disc (Japan)',
      ),
    ).toBe(true);

    expect(
      titlesMatch(
        'Pokémon Colosseum Bonus Disc',
        'Pokemon Colosseum',
        'Pokemon Colosseum - Kakuchou Disc (Japan)',
      ),
    ).toBe(true);

    // Main "Pokémon Colosseum" game should NOT match the "Bonus Disc" release
    expect(
      titlesMatch(
        'Pokémon Colosseum',
        'Pokemon Colosseum',
        'Pokemon Colosseum (USA) (Bonus Disc)',
      ),
    ).toBe(false);

    // Main "Pokémon Colosseum" game matches the standard release
    expect(
      titlesMatch(
        'Pokémon Colosseum',
        'Pokemon Colosseum',
        'Pokemon Colosseum (USA)',
      ),
    ).toBe(true);

    // Zelda Master Quest should match even though the release title doesn't contain "Bonus Disc"
    expect(
      titlesMatch(
        'The Legend of Zelda: Ocarina of Time + The Legend of Zelda: Ocarina of Time - Master Quest: Two-game Bonus Disc!',
        'Legend of Zelda, The - Ocarina of Time & Master Quest',
        'Legend of Zelda, The - Ocarina of Time & Master Quest (USA, Canada)',
      ),
    ).toBe(true);
  });

  it('should prevent prefix/segment collisions and match compilation aliases correctly', () => {
    // GTA London vs Base GTA
    expect(
      titlesMatch(
        'Grand Theft Auto',
        'Grand Theft Auto - Mission Pack 1 - London 1969',
        'Grand Theft Auto - Mission Pack 1 - London 1969 (USA)',
      ),
    ).toBe(false);
    expect(
      titlesMatch(
        'Grand Theft Auto: London 1969',
        'Grand Theft Auto - Mission Pack 1 - London 1969',
        'Grand Theft Auto - Mission Pack 1 - London 1969 (USA)',
      ),
    ).toBe(true);
    expect(
      titlesMatch(
        'Grand Theft Auto: London 1969',
        'Grand Theft Auto',
        'Grand Theft Auto (USA)',
      ),
    ).toBe(false);

    // Prince of Persia Trilogy vs Base
    expect(
      titlesMatch(
        'Prince of Persia',
        'Prince of Persia Trilogy',
        'Prince of Persia Trilogy (USA)',
      ),
    ).toBe(false);
    expect(
      titlesMatch(
        'Prince of Persia Trilogy HD',
        'Prince of Persia Trilogy',
        'Prince of Persia Trilogy (USA)',
      ),
    ).toBe(true);
    expect(
      titlesMatch(
        'Prince of Persia Trilogy HD',
        'Prince of Persia',
        'Prince of Persia (USA)',
      ),
    ).toBe(false);

    // Oddworld Stranger vs Munch vs New n Tasty
    expect(
      titlesMatch(
        "Oddworld: Stranger's Wrath HD",
        "Oddworld - Munch's Oddysee HD",
        "Oddworld - Munch's Oddysee HD (USA)",
      ),
    ).toBe(false);
    expect(
      titlesMatch(
        "Oddworld: Munch's Oddysee HD",
        "Oddworld - Munch's Oddysee HD",
        "Oddworld - Munch's Oddysee HD (USA)",
      ),
    ).toBe(true);
    expect(
      titlesMatch(
        "Oddworld: Munch's Oddysee HD",
        "Oddworld - Stranger's Wrath HD",
        "Oddworld - Stranger's Wrath HD (USA)",
      ),
    ).toBe(false);

    // Final Fantasy X/X-2 HD Remaster compilation alias
    expect(
      titlesMatch(
        'Final Fantasy X/X-2 HD Remaster',
        'Final Fantasy X X-2 HD Remaster',
        'Final Fantasy X X-2 HD Remaster (USA)',
      ),
    ).toBe(true);
    expect(
      titlesMatch(
        'Final Fantasy X/X-2 HD Remaster',
        'Final Fantasy X - HD Remaster',
        'Final Fantasy X - HD Remaster (Europe)',
      ),
    ).toBe(true);
    expect(
      titlesMatch(
        'Final Fantasy X/X-2 HD Remaster',
        'Final Fantasy X-2 - HD Remaster',
        'Final Fantasy X-2 - HD Remaster (Europe)',
      ),
    ).toBe(true);
    expect(
      titlesMatch(
        'Final Fantasy X/X-2 HD Remaster',
        'Final Fantasy XIII',
        'Final Fantasy XIII (USA)',
      ),
    ).toBe(false);

    // LEGO Ninjago Nindroids vs Shadow of Ronin
    expect(
      titlesMatch(
        'LEGO Ninjago: Nindroids',
        'LEGO Ninjago - Nindroids',
        'LEGO Ninjago - Nindroids (USA)',
      ),
    ).toBe(true);
    expect(
      titlesMatch(
        'LEGO Ninjago: Nindroids',
        'LEGO Ninjago - Shadow of Ronin',
        'LEGO Ninjago - Shadow of Ronin (USA)',
      ),
    ).toBe(false);

    // Shovel Knight vs Shovel Knight: Treasure Trove separation
    expect(
      titlesMatch(
        'Shovel Knight: Treasure Trove',
        'Shovel Knight',
        'Shovel Knight (USA)',
      ),
    ).toBe(false);
    expect(
      titlesMatch(
        'Shovel Knight',
        'Shovel Knight - Treasure Trove',
        'Shovel Knight - Treasure Trove (USA)',
      ),
    ).toBe(false);
    expect(
      titlesMatch(
        'Shovel Knight: Treasure Trove',
        'Shovel Knight - Treasure Trove',
        'Shovel Knight - Treasure Trove (USA)',
      ),
    ).toBe(true);
  });

  it('should match newly reconciled older platform edge cases (approved in implementation plan)', () => {
    // Apostrophe-s stripping check
    expect(titlesMatch("Disney's DuckTales", 'DuckTales')).toBe(true);
    expect(titlesMatch("Sid Meier's Civilization II", 'Civilization II')).toBe(
      true,
    );

    // Lara Croft prefix removal
    expect(
      titlesMatch('Tomb Raider: Legend', 'Lara Croft Tomb Raider - Legend'),
    ).toBe(true);

    // Character normalization (dollar sign to s)
    expect(
      titlesMatch(
        'WarioWare, Inc.: Mega Party Games!',
        'WarioWare, Inc. - Mega Party Game$!',
      ),
    ).toBe(true);

    // Trailing platform suffix stripping
    expect(titlesMatch('Plants vs. Zombies DS', 'Plants vs. Zombies')).toBe(
      true,
    );

    // Aliases
    expect(titlesMatch('N+', 'N Plus')).toBe(true);
    expect(titlesMatch('Lemmings 3D', '3D Lemmings')).toBe(true);
    expect(titlesMatch('Sonic Classics', 'Sonic Compilation')).toBe(true);

    // Compilation split logic matching
    expect(
      titlesMatch(
        'Marble Madness / Klax',
        '2 Games in One! - Marble Madness + Klax',
      ),
    ).toBe(true);

    // Newly reconciled older platform edge cases
    expect(
      titlesMatch('The Amazing Spider-Man vs. The Kingpin', 'Spider-Man'),
    ).toBe(true);
    expect(
      titlesMatch(
        'The Amazing Spider-Man vs. The Kingpin',
        'Spider-Man vs. The Kingpin',
      ),
    ).toBe(true);
    expect(
      titlesMatch('The Amazing Spider-Man 2', 'Spider-Man 2', undefined, 14),
    ).toBe(true); // Game Boy specific mapping
    expect(titlesMatch('The Amazing Spider-Man 2', 'Spider-Man 2')).toBe(false); // Should not match globally anymore
    expect(
      titlesMatch('The Amazing Spider-Man 2', 'Amazing Spider-Man 2, The'),
    ).toBe(true); // Matches on other platforms
    expect(
      titlesMatch("X-Men: Gamesmaster's Legacy", "X-Men - Gamemaster's Legacy"),
    ).toBe(true);
    expect(
      titlesMatch(
        'Star Wars Chess',
        "Software Toolworks' Star Wars Chess, The",
      ),
    ).toBe(true);
    expect(
      titlesMatch(
        'Final Fantasy Anthology',
        'Final Fantasy Anthology - Final Fantasy V',
      ),
    ).toBe(true);
    expect(
      titlesMatch(
        'Final Fantasy Anthology',
        'Final Fantasy Anthology - Final Fantasy VI',
      ),
    ).toBe(true);
    expect(titlesMatch('SimCopter', 'SimCopter 64')).toBe(true);
    expect(titlesMatch('Tomb Raider Starring Lara Croft', 'Tomb Raider')).toBe(
      true,
    );
    expect(titlesMatch('Bionicle: The Game', 'Bionicle')).toBe(true);
    expect(titlesMatch('Grand Theft Auto Advance', 'Grand Theft Auto')).toBe(
      true,
    );
    expect(
      titlesMatch(
        "Space Channel 5: Ulala's Cosmic Attack",
        "Space Channel 5 - Ulala's Cosmic Attack",
      ),
    ).toBe(true);
    expect(
      titlesMatch(
        'Space Channel 5 Special Edition',
        "Space Channel 5 - Ulala's Cosmic Attack",
      ),
    ).toBe(false);
    expect(
      titlesMatch(
        'Star Wars: Episode I - Jedi Power Battles',
        'Star Wars - Jedi Power Battles',
      ),
    ).toBe(true);
    expect(
      titlesMatch(
        'Capcom Classics Collection',
        'Capcom Classics Collection Vol. 1',
      ),
    ).toBe(true);
    expect(
      titlesMatch(
        'Dissidia 012 Final Fantasy',
        'Dissidia 012 - Duodecim Final Fantasy',
      ),
    ).toBe(true);
    expect(
      titlesMatch(
        'Minecraft: Story Mode - Season Two',
        'Minecraft - Story Mode - Season Two - The Telltale Series',
      ),
    ).toBe(true);
    expect(
      titlesMatch(
        'Minecraft: Story Mode - The Complete Adventure',
        'Minecraft - Story Mode - A Telltale Games Series - The Complete Adventure',
      ),
    ).toBe(true);
    expect(
      titlesMatch(
        'Minecraft',
        'Minecraft - Story Mode - A Telltale Games Series - Season Pass Disc',
      ),
    ).toBe(false);
    expect(titlesMatch('Elden Ring', 'Elden Ring - Nightreign')).toBe(false);
    expect(titlesMatch('Until Dawn', 'Until Dawn - Rush of Blood')).toBe(false);
    expect(
      titlesMatch('The Walking Dead', 'The Walking Dead - Survival Instinct'),
    ).toBe(false);
    expect(titlesMatch('Pokémon Ranger', 'Pokemon Ranger - Batonnage')).toBe(
      false,
    );
    expect(
      titlesMatch('Pokémon Ranger', 'Pokemon Ranger - Hikari no Kiseki'),
    ).toBe(false);
    expect(
      titlesMatch(
        'BioShock Infinite: The Complete Edition',
        'BioShock Infinite - The Complete Edition - Bonus Content Disc',
      ),
    ).toBe(true);
    expect(
      titlesMatch(
        "Dragon's Lair Trilogy",
        "Don Bluth Presents Dragon's Lair Trilogy",
      ),
    ).toBe(true);
    expect(
      titlesMatch(
        'Harvest Moon: A New Beginning',
        'Harvest Moon 3D - A New Beginning',
      ),
    ).toBe(true);
    expect(
      titlesMatch(
        'Harvest Moon: The Tale of Two Towns',
        'Harvest Moon 3D - The Tale of Two Towns',
      ),
    ).toBe(true);
    expect(
      titlesMatch(
        'Harvest Moon: The Lost Valley',
        'Harvest Moon 3D - The Lost Valley',
      ),
    ).toBe(true);
    expect(titlesMatch('Metal Gear: Ghost Babel', 'Metal Gear Solid')).toBe(
      true,
    );
    expect(titlesMatch('Wonder Boy III: Monster Lair', 'Monster Lair')).toBe(
      true,
    );
    expect(
      titlesMatch("Rayman: Hoodlums' Revenge", "Rayman - Hoodlum's Revenge"),
    ).toBe(true);
    expect(
      titlesMatch(
        'Metal Gear Solid - Special Missions',
        'Metal Gear Solid: VR Missions',
      ),
    ).toBe(true);
    expect(
      titlesMatch('Metal Gear Solid', 'Metal Gear Solid - Special Missions'),
    ).toBe(false);
    expect(titlesMatch('Ōkami HD', 'Ookami - Zekkeiban')).toBe(true);
    expect(titlesMatch('Tales of Graces f', 'Tales of Graces f')).toBe(true);
    expect(titlesMatch('Tales of Graces', 'Tales of Graces f')).toBe(false);
    expect(
      titlesMatch(
        'Xenosaga Episode II: Jenseits von Gut und Böse',
        'Xenosaga Episode II - Jenseits von Gut und Boese',
      ),
    ).toBe(true);
  });

  it('should match regional alternative_names with strict regional safety guards', () => {
    // Resident Evil -> Biohazard (Japan)
    expect(
      gameMatchesReleaseWithAlternatives(
        'Resident Evil',
        'Biohazard',
        'Biohazard (Japan)',
        20,
        [{ name: 'Biohazard', comment: 'Japanese title - romanization' }],
        'Japan',
      ),
    ).toBe(true);

    // Japanese title comment should NOT match a USA release
    expect(
      gameMatchesReleaseWithAlternatives(
        'Resident Evil',
        'Biohazard',
        'Biohazard (USA)',
        20,
        [{ name: 'Biohazard', comment: 'Japanese title - romanization' }],
        'USA',
      ),
    ).toBe(false);

    // Dragon Warrior -> Dragon Quest (Japan)
    expect(
      gameMatchesReleaseWithAlternatives(
        'Dragon Warrior',
        'Dragon Quest',
        'Dragon Quest (Japan)',
        13,
        [{ name: 'Dragon Quest', comment: 'Japanese title - romanization' }],
        'Japan',
      ),
    ).toBe(true);

    // Animal Crossing -> Dōbutsu no Mori / Doubutsu no Mori on N64DD (ou/ō equivalence)
    expect(
      gameMatchesReleaseWithAlternatives(
        'Animal Crossing',
        'Doubutsu no Mori',
        'Doubutsu no Mori (Japan)',
        55,
        [{ name: 'Dōbutsu no Mori', comment: 'Japanese title' }],
        'Japan',
      ),
    ).toBe(true);

    // Super Mario Bros.: The Lost Levels -> Super Mario Bros. 2 on Famicom Disk System (54) ONLY
    expect(
      gameMatchesReleaseWithAlternatives(
        'Super Mario Bros.: The Lost Levels',
        'Super Mario Bros. 2',
        'Super Mario Bros. 2 (Japan)',
        54,
        [{ name: 'Super Mario Bros. 2', comment: 'Japanese title' }],
        'Japan',
      ),
    ).toBe(true);

    // Must NEVER match Western NES Super Mario Bros. 2 (USA) on NES (13)
    expect(
      gameMatchesReleaseWithAlternatives(
        'Super Mario Bros.: The Lost Levels',
        'Super Mario Bros. 2',
        'Super Mario Bros. 2 (USA)',
        13,
        [{ name: 'Super Mario Bros. 2', comment: 'Japanese title' }],
        'USA',
      ),
    ).toBe(false);

    // Cross-franchise generic segment matches must be rejected
    expect(
      titlesMatch(
        'BioShock: The Collection',
        'LEGO Marvel Collection',
        'LEGO Marvel Collection (USA)',
        34,
      ),
    ).toBe(false);

    // Franchise sequel vs base game segmentation must be rejected
    expect(
      titlesMatch(
        "Assassin's Creed: Brotherhood",
        "Assassin's Creed",
        "Assassin's Creed (USA)",
        48,
      ),
    ).toBe(false);

    expect(
      titlesMatch(
        "Assassin's Creed",
        "Assassin's Creed - Revelations",
        "Assassin's Creed - Revelations (USA)",
        48,
      ),
    ).toBe(false);

    // Valid edition/descriptor segmentation must continue to match
    expect(
      titlesMatch(
        'Tomb Raider II',
        'Tomb Raider II - Starring Lara Croft',
        'Tomb Raider II - Starring Lara Croft (USA)',
        7,
      ),
    ).toBe(true);

    expect(
      titlesMatch(
        'Super Mario All-Stars: Limited Edition',
        'Super Mario All-Stars',
        'Super Mario All-Stars (USA)',
        14,
      ),
    ).toBe(false);

    expect(
      titlesMatch(
        "Assassin's Creed Chronicles",
        "Assassin's Creed Chronicles: Trilogy Pack",
        "Assassin's Creed Chronicles (USA)",
        49,
      ),
    ).toBe(true);

    // Standalone add-on packs, tutorial discs, expansion kits, and cross-leaked bonus discs must never match base games
    expect(
      titlesMatch(
        'Fallout 3',
        'Fallout 3 - Game Add-On Pack - The Pitt and Operation - Anchorage',
        'Fallout 3 - Game Add-On Pack - The Pitt and Operation - Anchorage (USA, Europe).iso',
        48,
      ),
    ).toBe(false);

    expect(
      titlesMatch(
        'Borderlands 2',
        'Borderlands 2 - Add-On Content Pack',
        'Borderlands 2 - Add-On Content Pack (USA).iso',
        48,
      ),
    ).toBe(false);

    expect(
      titlesMatch(
        'Viva Piñata',
        'Viva Pinata',
        'Viva Pinata (USA) (Tutorial).iso',
        48,
      ),
    ).toBe(false);

    expect(
      titlesMatch(
        'F-Zero X',
        'F-Zero X - Expansion Kit',
        'F-Zero X - Expansion Kit (Japan).ndd',
        4,
      ),
    ).toBe(false);

    expect(
      titlesMatch(
        "Tom Clancy's Splinter Cell: Pandora Tomorrow",
        "Tom Clancy's Splinter Cell",
        "Tom Clancy's Splinter Cell (Europe) (Bonus Disc).iso",
        47,
      ),
    ).toBe(false);

    expect(
      titlesMatch(
        'Gears of War: Judgment',
        'Gears of War',
        'Gears of War (USA) (Bonus Disc).iso',
        48,
      ),
    ).toBe(false);

    expect(
      titlesMatch('LEGO Rock Band', 'Rock Band', 'Rock Band (USA).iso', 48),
    ).toBe(false);

    expect(
      titlesMatch(
        'Far Cry 3',
        'Far Cry 3 - Blood Dragon',
        'Far Cry 3 - Blood Dragon (USA).iso',
        48,
      ),
    ).toBe(false);

    // Same-game 2-disc Bonus Editions match their own parent game
    expect(
      titlesMatch(
        "Tom Clancy's Splinter Cell",
        "Tom Clancy's Splinter Cell",
        "Tom Clancy's Splinter Cell (Europe) (Bonus Disc).iso",
        47,
      ),
    ).toBe(true);
    expect(
      titlesMatch(
        'Alan Wake',
        'Alan Wake',
        'Alan Wake (USA, Europe) (En,Ja,Fr,De,Es,It,Zh,Ko,Pl,Ru) (Bonus Disc).iso',
        48,
      ),
    ).toBe(true);
    expect(
      titlesMatch(
        'Mario Kart: Double Dash!!',
        'Mario Kart - Double Dash!!',
        'Mario Kart - Double Dash!! (USA) (Bonus Disc).iso',
        20,
      ),
    ).toBe(true);
    expect(
      titlesMatch(
        'BioShock Infinite: The Complete Edition',
        'BioShock Infinite - The Complete Edition - Bonus Content Disc',
        'BioShock Infinite - The Complete Edition - Bonus Content Disc (USA, Europe).iso',
        48,
      ),
    ).toBe(true);
    expect(
      titlesMatch(
        'BioShock Infinite',
        'BioShock Infinite - The Complete Edition - Bonus Content Disc',
        'BioShock Infinite - The Complete Edition - Bonus Content Disc (USA, Europe).iso',
        48,
      ),
    ).toBe(false);

    // Standalone-title bonus discs and pre-order promo discs remain blocked from matching base game
    expect(
      titlesMatch(
        'Pokémon Colosseum',
        'Pokemon Colosseum Bonus Disc',
        'Pokemon Colosseum Bonus Disc (USA).iso',
        20,
      ),
    ).toBe(false);
    expect(
      titlesMatch(
        'Mass Effect',
        'Mass Effect',
        'Mass Effect (USA) (Pre-Order Bonus Disc).iso',
        48,
      ),
    ).toBe(false);

    // Zone of the Enders 1 must not match Anubis / The 2nd Runner
    expect(
      titlesMatch(
        'Zone of the Enders',
        'Anubis - Zone of the Enders',
        'Anubis - Zone of the Enders (Japan).iso',
        30,
      ),
    ).toBe(false);
  });

  describe('Non-Latin Subtitle and Regional Alternative Names Guard', () => {
    it('prevents non-Latin subtitles from stripping down to base franchise names', () => {
      // Tomb Raider: The Last Revelation (IV) with Russian subtitle must not match 2013 reboot Tomb Raider on PS3
      const altIV = [
        { comment: 'Russian title', name: 'Tomb Raider: Последнее откровение' },
      ];
      expect(
        gameMatchesReleaseWithAlternatives(
          'Tomb Raider: The Last Revelation',
          'Tomb Raider',
          'Tomb Raider (USA).iso',
          32,
          altIV,
          'USA',
        ),
      ).toBe(false);

      // Even if tested against a Russian release of the 2013 reboot, non-Latin subtitle stripping guard prevents the collision
      expect(
        gameMatchesReleaseWithAlternatives(
          'Tomb Raider: The Last Revelation',
          'Tomb Raider',
          'Tomb Raider (Russia).iso',
          32,
          altIV,
          'Russia',
        ),
      ).toBe(false);

      // Tomb Raider: Chronicles (V) with Russian subtitle
      const altChronicles = [
        { comment: 'Russian title', name: 'Tomb Raider: Хроники' },
      ];
      expect(
        gameMatchesReleaseWithAlternatives(
          'Tomb Raider: Chronicles',
          'Tomb Raider',
          'Tomb Raider (USA).iso',
          32,
          altChronicles,
          'USA',
        ),
      ).toBe(false);

      // Tomb Raider: Legend with Russian subtitle
      const altLegend = [
        { comment: 'Russian title', name: 'Tomb Raider - Легенда' },
      ];
      expect(
        gameMatchesReleaseWithAlternatives(
          'Tomb Raider: Legend',
          'Tomb Raider',
          'Tomb Raider (USA).iso',
          32,
          altLegend,
          'USA',
        ),
      ).toBe(false);

      // Valid matches must continue to work normally
      expect(
        gameMatchesReleaseWithAlternatives(
          'Tomb Raider: The Last Revelation',
          'Tomb Raider - The Last Revelation',
          'Tomb Raider - The Last Revelation (USA).bin',
          29,
          altIV,
          'USA',
        ),
      ).toBe(true);

      expect(
        gameMatchesReleaseWithAlternatives(
          'Resident Evil',
          'Biohazard',
          'Biohazard (Japan).bin',
          29,
          [{ name: 'Biohazard', comment: 'Japanese title' }],
          'Japan',
        ),
      ).toBe(true);
    });

    it('enforces Chinese and Korean regional comment guards', () => {
      // Game title and release title do not match directly (Rockman vs Mega Man)
      // A Chinese or Korean alternative title must not match a USA release
      const altChinese = [{ comment: 'Chinese title', name: 'Mega Man' }];
      expect(
        gameMatchesReleaseWithAlternatives(
          'Rockman',
          'Mega Man',
          'Mega Man (USA).nes',
          13,
          altChinese,
          'USA',
        ),
      ).toBe(false);

      // But should match an Asia/China release
      expect(
        gameMatchesReleaseWithAlternatives(
          'Rockman',
          'Mega Man',
          'Mega Man (Asia).nes',
          13,
          altChinese,
          'Asia',
        ),
      ).toBe(true);

      const altKorean = [{ comment: 'Korean title', name: 'Mega Man' }];
      expect(
        gameMatchesReleaseWithAlternatives(
          'Rockman',
          'Mega Man',
          'Mega Man (USA).nes',
          13,
          altKorean,
          'USA',
        ),
      ).toBe(false);

      // But should match Korea release
      expect(
        gameMatchesReleaseWithAlternatives(
          'Rockman',
          'Mega Man',
          'Mega Man (Korea).nes',
          13,
          altKorean,
          'Korea',
        ),
      ).toBe(true);
    });
  });

  describe('isCompilationOrBundleTitle', () => {
    it('returns true for compilations, trilogies, box sets, multi-in-1 carts, and combo titles', () => {
      expect(
        isCompilationOrBundleTitle(
          'Crash Superpack - Crash Bandicoot 2 - N-Tranced + Crash Nitro Kart',
        ),
      ).toBe(true);
      expect(isCompilationOrBundleTitle('Grand Theft Auto: The Trilogy')).toBe(
        true,
      );
      expect(isCompilationOrBundleTitle('Mass Effect Trilogy')).toBe(true);
      expect(isCompilationOrBundleTitle('Box Set Vol 1')).toBe(true);
      expect(isCompilationOrBundleTitle('2-in-1 Fun Pack')).toBe(true);
      expect(isCompilationOrBundleTitle('Game A / Game B')).toBe(true);
    });

    it('returns false for standalone titles including No-Intro alternate separator ~', () => {
      expect(isCompilationOrBundleTitle('Wave Race 64')).toBe(false);
      expect(isCompilationOrBundleTitle('Combat ~ Tank-Plus')).toBe(false);
      expect(isCompilationOrBundleTitle("Marvel's Avengers")).toBe(false);
      expect(isCompilationOrBundleTitle('LEGO Batman')).toBe(false);
    });
  });

  describe('extractEditionSuffix & resolveCanonicalDisplayTitle', () => {
    it('adopts IGDB canonical typography and strips box-art taglines when no edition suffix is present', () => {
      expect(
        resolveCanonicalDisplayTitle(
          "Oddworld - Munch's Oddysee",
          "Oddworld: Munch's Oddysee",
        ),
      ).toBe("Oddworld: Munch's Oddysee");
      expect(
        resolveCanonicalDisplayTitle('Driver - You Are the Wheelman', 'Driver'),
      ).toBe('Driver');
    });

    it('preserves physical Switch 2, GOTY, DLC +, and re-release editions on top of IGDB base names', () => {
      expect(
        extractEditionSuffix(
          'Rune Factory: Guardians of Azuma - Nintendo Switch 2 Edition',
        ),
      ).toBe('Nintendo Switch 2 Edition');
      expect(
        resolveCanonicalDisplayTitle(
          'Rune Factory: Guardians of Azuma - Nintendo Switch 2 Edition',
          'Rune Factory: Guardians of Azuma',
        ),
      ).toBe('Rune Factory: Guardians of Azuma - Nintendo Switch 2 Edition');

      expect(
        resolveCanonicalDisplayTitle(
          'Dishonored: Game of the Year Edition',
          'Dishonored: Definitive Edition',
        ),
      ).toBe('Dishonored: Game of the Year Edition');

      expect(
        resolveCanonicalDisplayTitle(
          'Pokemon Scarlet + The Hidden Treasure of Area Zero',
          'Pokémon Scarlet',
        ),
      ).toBe('Pokémon Scarlet + The Hidden Treasure of Area Zero');

      expect(
        resolveCanonicalDisplayTitle(
          'Croc Legend of the Gobbos Platinum Edition',
          'Croc: Legend of the Gobbos',
        ),
      ).toBe('Croc: Legend of the Gobbos - Platinum Edition');

      expect(
        resolveCanonicalDisplayTitle(
          'Shovel Knight: Treasure Trove',
          'Shovel Knight',
        ),
      ).toBe('Shovel Knight: Treasure Trove');

      expect(
        resolveCanonicalDisplayTitle(
          'Tetris Effect: Connected',
          'Tetris Effect',
        ),
      ).toBe('Tetris Effect: Connected');

      expect(
        resolveCanonicalDisplayTitle(
          'The Elder Scrolls Online: Tamriel Unlimited',
          'The Elder Scrolls Online',
        ),
      ).toBe('The Elder Scrolls Online: Tamriel Unlimited');

      expect(
        resolveCanonicalDisplayTitle(
          'Tomb Raider IV-VI Remastered',
          'Tomb Raider IV•V•VI Remastered',
        ),
      ).toBe('Tomb Raider IV•V•VI Remastered');
    });

    it('ignores localized non-English edition markers so regional dumps normalize cleanly to IGDB English titles', () => {
      expect(extractEditionSuffix('Pokemon - Goldene Edition')).toBeNull();
      expect(
        resolveCanonicalDisplayTitle(
          'Pokemon - Goldene Edition',
          'Pokémon Gold Version',
        ),
      ).toBe('Pokémon Gold Version');
    });
  });

  describe('IGDB Title Cleaning, Sequel Parity & Variant Matching', () => {
    it('cleans boutique prefixes, retail pre-order trailers, budget series prefixes, and verified typos', () => {
      expect(
        cleanTitleForIgdbLookup(
          'Limited Run #273: Astonishia Story - Playsation 5 PREORDER - ESTIMATED SHIP DATE FEB 11 2027',
        ),
      ).toBe('Astonishia Story');
      expect(cleanTitleForIgdbLookup('Classic NES Series: Metroid')).toBe(
        'Metroid',
      );
      expect(
        cleanTitleForIgdbLookup('Harvest Moon: The Winds of Antbos Complete'),
      ).toBe('Harvest Moon: The Winds of anthos Complete');
      expect(
        cleanTitleForIgdbLookup('Like a Dragon The Man Who Erased His Name'),
      ).toBe('like a dragon gaiden: the man who erased his name');
    });

    it('strips stacked physical edition wrappers without collapsing retro bare Special sequels', () => {
      expect(
        stripIgdbEditionWrapper(
          'Xenoblade Chronicles X: Definitive Edition - Nintendo Switch 2 Edition',
        ),
      ).toBe('Xenoblade Chronicles X');

      expect(stripIgdbEditionWrapper('Real Bout Fatal Fury Special')).toBe(
        'Real Bout Fatal Fury Special',
      );
      expect(
        stripIgdbEditionWrapper('Rune Factory 3 Special', {
          allowBareSpecial: true,
        }),
      ).toBe('Rune Factory 3');
    });

    it('enforces sequel numeral parity while ignoring platform version numbers and leading pronoun I', () => {
      expect(extractTitleSequelSignature('Persona 4')).toEqual(['4']);
      expect(extractTitleSequelSignature('Persona 5')).toEqual(['5']);
      expect(
        extractTitleSequelSignature('Super Mario World II - Nintendo Switch 2'),
      ).toEqual(['2']);
      expect(
        extractTitleSequelSignature('Metroid Prime 4 - PlayStation 5 PS5'),
      ).toEqual(['4']);
      expect(extractTitleSequelSignature('Xbox 360 Controller Demo')).toEqual(
        [],
      );
      expect(extractTitleSequelSignature('I Am Setsuna')).toEqual([]);
    });

    it('preserves distinct version qualifiers in normalizeForIgdbMatch and marks tilde split variants', () => {
      expect(
        normalizeForIgdbMatch(
          'SNK vs. Capcom: Card Fighters Clash - Capcom Version',
        ),
      ).not.toBe(
        normalizeForIgdbMatch(
          'SNK vs. Capcom: Card Fighters Clash - SNK Version',
        ),
      );
      expect(normalizeForIgdbMatch('Harvest Moon DS: Sunshine Islands')).toBe(
        normalizeForIgdbMatch('Harvest Moon: Sunshine Islands'),
      );

      expect(buildIgdbMatchVariants('Shifting Gears - Road Trip')).toContain(
        'Road Trip: Shifting Gears',
      );
      const detailed = buildDetailedIgdbMatchVariants('Flag Capture ~ Capture');
      expect(detailed.some((v) => v.title === 'Capture' && v.isTildeHalf)).toBe(
        true,
      );
    });

    it('builds Roman/Arabic and edition match keys while blocking cross-sequel matches', () => {
      expect(
        areCanonicalTitlesSequelCompatible(
          'Final Fantasy VII',
          'Final Fantasy 7',
        ),
      ).toBe(true);
      expect(areCanonicalTitlesSequelCompatible('Persona 4', 'Persona 5')).toBe(
        false,
      );
      expect(areCanonicalTitlesSequelCompatible('Hades', 'Hades II')).toBe(
        false,
      );

      const ffKeys = buildCanonicalLinkerMatchKeys('Final Fantasy VII');
      expect(ffKeys).toContain('finalfantasy7');

      const volKeys = buildCanonicalLinkerMatchKeys('Shantae Volume I');
      expect(volKeys).toContain('shantaevol1');

      const sw2Keys = buildCanonicalLinkerMatchKeys(
        'Metroid Prime 4: Beyond - Nintendo Switch 2 Edition',
      );
      expect(sw2Keys).toContain('metroidprime4beyond');

      expect(
        buildCanonicalLinkerMatchKeys('Resident Evil 5 Remastered'),
      ).toContain('residentevil5');
      expect(
        buildCanonicalLinkerMatchKeys('Minecraft - Xbox One Edition'),
      ).toContain('minecraft');
      expect(
        buildCanonicalLinkerMatchKeys(
          "Baldur's Gate and Baldur's Gate II: Enhanced Editions",
        ),
      ).toContain('baldurgatebaldurgateii');
      expect(
        buildCanonicalLinkerMatchKeys('Overcooked: Gourmet Edition'),
      ).toContain('overcoked');
      expect(buildCanonicalLinkerMatchKeys('Pac-Man CE 2')).toContain(
        'pacmanchampionship2',
      );
      expect(buildCanonicalLinkerMatchKeys('Inside & Limbo Bundle')).toContain(
        'insidelimbo',
      );
      const mmx12Keys = buildCanonicalLinkerMatchKeys(
        'Mega Man X: Legacy Collection 1+2',
      );
      expect(mmx12Keys).toContain('megamanxlegacycollection12');
      expect(mmx12Keys).not.toContain('megamanxlegacycollection');
      expect(
        buildCanonicalLinkerMatchKeys('Persona 5 Royal: Steelbook Edition'),
      ).toContain('persona5royal');
      // Delimited editions strip locally onto the base key without blind single-word peeling
      expect(
        buildCanonicalLinkerMatchKeys('Shantae: Half-Genie Hero Edition'),
      ).toContain('shantae');
      // Distinct colon-subtitled entries with trailing editions never collapse onto bare franchise keys (#59630 vs #59631)
      const tmntSplinteredKeys = buildCanonicalLinkerMatchKeys(
        'Teenage Mutant Ninja Turtles: Splintered Fate Legendary Edition Nintendo Switch 2 Edition',
      );
      const tmntWrathKeys = buildCanonicalLinkerMatchKeys(
        'Teenage Mutant Ninja Turtles: Wrath of the Mutants Ninja Edition',
      );
      expect(tmntSplinteredKeys).not.toContain('teenagemutantninjaturtles');
      expect(tmntWrathKeys).not.toContain('teenagemutantninjaturtles');
      expect(tmntSplinteredKeys.some((k) => tmntWrathKeys.includes(k))).toBe(
        false,
      );
      expect(
        buildCanonicalLinkerMatchKeys("Yoshi's Crafted Edition"),
      ).not.toContain('yoshi');
      expect(
        buildDetailedIgdbMatchVariants("Yoshi's Crafted Edition").map(
          (v) => v.title,
        ),
      ).toContain("Yoshi's");
      expect(
        buildCanonicalLinkerMatchKeys(
          'Pac-Man Championship Edition 2 + Arcade Game Series',
        ),
      ).toContain('pacmanchampionship2');
      expect(
        buildCanonicalLinkerMatchKeys('Gradius Origins (Gradius 2 Cover Art)'),
      ).toContain('gradiusorigins');
      expect(
        buildCanonicalLinkerMatchKeys('Disney Infinity 2.0 (Game Only)'),
      ).toEqual(
        expect.arrayContaining(
          buildCanonicalLinkerMatchKeys('Disney Infinity: 2.0'),
        ),
      );
      expect(
        buildCanonicalLinkerMatchKeys('Skylanders - SuperChargers - Game Only'),
      ).toContain('skylanderssuperchargers');
      expect(
        buildCanonicalLinkerMatchKeys(
          'Shantae: Half-Genie Hero (Risky Beats Edition)',
        ),
      ).toContain('shantaehalfgeniehero');
      expect(
        buildCanonicalLinkerMatchKeys(
          "Assassin's Creed Chronicles: Trilogy Pack",
        ),
      ).toContain('assassincreedchronicles');
      expect(
        areCanonicalTitlesSequelCompatible(
          'Gradius Origins',
          'Gradius Origins (Gradius 2 Cover Art)',
        ),
      ).toBe(true);
      expect(
        areCanonicalTitlesSequelCompatible(
          'Persona 4',
          'Persona 5 (Royal Edition)',
        ),
      ).toBe(false);
    });

    it('extracts physical retail/packaging editions for variants while protecting non-English, platform-only, and retro Special titles', () => {
      expect(
        extractPhysicalEditionForVariant(
          'Sonic Racing: CrossWorlds - Year One Edition',
        ),
      ).toEqual({
        baseTitle: 'Sonic Racing: CrossWorlds',
        edition: 'Year One Edition',
      });

      expect(
        extractPhysicalEditionForVariant(
          'Sonic Racing: CrossWorlds - Year One Edition Nintendo Switch 2 Edition',
        ),
      ).toEqual({
        baseTitle: 'Sonic Racing: CrossWorlds - Nintendo Switch 2 Edition',
        edition: 'Year One Edition',
      });

      expect(
        extractPhysicalEditionForVariant(
          'Sonic Racing: CrossWorlds Year 1 Edition',
        ),
      ).toEqual({
        baseTitle: 'Sonic Racing: CrossWorlds',
        edition: 'Year 1 Edition',
      });

      expect(
        extractPhysicalEditionForVariant(
          'Final Fantasy VII: Revelation Day One Edition',
        ),
      ).toEqual({
        baseTitle: 'Final Fantasy VII: Revelation',
        edition: 'Day One Edition',
      });

      expect(
        extractPhysicalEditionForVariant(
          'Sea of Stars: Sunset Edition (Retail Edition)',
        ),
      ).toEqual({
        baseTitle: 'Sea of Stars',
        edition: 'Sunset Edition',
      });

      expect(
        extractPhysicalEditionForVariant(
          'Disco Elysium: The Final Cut - iam8bit Exclusive Edition',
        ),
      ).toEqual({
        baseTitle: 'Disco Elysium: The Final Cut',
        edition: 'iam8bit Exclusive Edition',
      });

      expect(
        extractPhysicalEditionForVariant(
          "Assassin's Creed IV: Black Flag - PlayStation Hits Edition",
        ),
      ).toEqual({
        baseTitle: "Assassin's Creed IV: Black Flag",
        edition: 'PlayStation Hits Edition',
      });

      expect(
        extractPhysicalEditionForVariant(
          'Animal Crossing: New Horizons - Nintendo Switch 2 Edition',
        ),
      ).toEqual({
        baseTitle: 'Animal Crossing: New Horizons - Nintendo Switch 2 Edition',
        edition: null,
      });

      expect(
        extractPhysicalEditionForVariant('Pokemon - Goldene Edition'),
      ).toEqual({
        baseTitle: 'Pokemon - Goldene Edition',
        edition: null,
      });

      expect(
        extractPhysicalEditionForVariant('Real Bout Fatal Fury Special'),
      ).toEqual({
        baseTitle: 'Real Bout Fatal Fury Special',
        edition: null,
      });

      expect(
        extractPhysicalEditionForVariant(
          "Alisa: Developer's Cut [RETRO EDITION] [PREMIUM EDITION GAMES SERIES 10]",
        ),
      ).toEqual({
        baseTitle: "Alisa: Developer's Cut",
        edition: 'Retro Edition',
      });

      expect(
        extractPhysicalEditionForVariant(
          'BACKERS - DE#9: Chained Echoes Complete Edition',
        ),
      ).toEqual({
        baseTitle: 'Chained Echoes',
        edition: 'Complete Edition',
      });

      expect(
        extractPhysicalEditionForVariant(
          'Elder Scrolls IV: Oblivion Remaster - Deluxe Edition, The',
        ),
      ).toEqual({
        baseTitle: 'The Elder Scrolls IV: Oblivion Remaster',
        edition: 'Deluxe Edition',
      });

      expect(
        extractPhysicalEditionForVariant(
          'Bubble Bobble 4 Friends Plushie Bundle',
        ),
      ).toEqual({
        baseTitle: 'Bubble Bobble 4 Friends',
        edition: null,
      });

      expect(
        extractPhysicalEditionForVariant(
          'Final Fantasy VII Revelation Deluxe Edition (With Exclusive MTG FF Promo Card)',
        ),
      ).toEqual({
        baseTitle: 'Final Fantasy VII Revelation',
        edition: 'Deluxe Edition',
      });

      expect(
        extractPhysicalEditionForVariant(
          'Astonishia Story + Store Exclusive Key Art Stand',
        ),
      ).toEqual({
        baseTitle: 'Astonishia Story',
        edition: null,
      });

      expect(
        buildCanonicalLinkerMatchKeys(
          '2 Games in One! - Dr. Mario + Puzzle League',
        ),
      ).toContain('drmariopuzzleleague');
    });

    it('parses physical multi-game combo cart constituent titles without splitting single games containing ampersands', () => {
      expect(
        parseComboCartConstituentTitles('Sonic Mania + Team Sonic Racing'),
      ).toEqual(['Sonic Mania', 'Team Sonic Racing']);
      expect(parseComboCartConstituentTitles('Yakuza Kiwami 1+2')).toEqual([
        'Yakuza Kiwami',
        'Yakuza Kiwami 2',
      ]);
      expect(
        parseComboCartConstituentTitles('Star Wars Jedi Outcast/Jedi Academy'),
      ).toEqual(['Star Wars Jedi Outcast', 'Star Wars Jedi Academy']);
      expect(
        parseComboCartConstituentTitles(
          'Harvest Moon: The Lost Valley and Skytree Village',
        ),
      ).toEqual([
        'Harvest Moon: The Lost Valley',
        'Harvest Moon: Skytree Village',
      ]);
      expect(
        parseComboCartConstituentTitles(
          "2 in 1 Game Pack - Spider-Man - Mysterio's Menace + X2 - Wolverine's Revenge",
        ),
      ).toEqual(["Spider-Man - Mysterio's Menace", "X2 - Wolverine's Revenge"]);
      expect(
        parseComboCartConstituentTitles(
          '2 Games in 1! Sonic Advance + Sonic Battle',
        ),
      ).toEqual(['Sonic Advance', 'Sonic Battle']);
      expect(
        parseComboCartConstituentTitles(
          '3 in 1 Super Pack - Game Alpha / Game Beta / Game Gamma',
        ),
      ).toEqual(['Game Alpha', 'Game Beta', 'Game Gamma']);
      expect(normalizeInvertedArticle('Petit Prince, Le')).toBe(
        'Le Petit Prince',
      );
      expect(cleanTitleForIgdbLookup('SRG #120: Lil Gator Game')).toBe(
        'Lil Gator Game',
      );
      expect(
        cleanTitleForIgdbLookup(
          'Switch Limited Run #131: There Is No Game: Wrong Dimension',
        ),
      ).toBe('There Is No Game: Wrong Dimension');
      expect(
        buildDetailedIgdbMatchVariants(
          'Teenage Mutant Ninja Turtles: Splintered Fate Legendary Edition Nintendo Switch 2 Edition',
        ).map((v) => v.title),
      ).toContain('Teenage Mutant Ninja Turtles: Splintered Fate');
      expect(
        cleanTitleForIgdbLookup('BATMAN ARKHAM COLLECTION TRIPLE PACK'),
      ).toBe('BATMAN ARKHAM COLLECTION');
      expect(stripIgdbEditionWrapper("Death's Door: Brigadier Edition")).toBe(
        "Death's Door",
      );
      expect(
        normalizeForIgdbMatch('The Walking Dead: Saints and Sinners Chapter 2'),
      ).toBe(
        normalizeForIgdbMatch('The Walking Dead: Saints & Sinners - Ch 2'),
      );

      // Negative guards: single titles with natural '&' or 'and'
      expect(
        parseComboCartConstituentTitles(
          'DC League of Super-Pets: Adventure of Krypto & Ace',
        ),
      ).toEqual([]);
      expect(
        parseComboCartConstituentTitles(
          'The Walking Dead: Saints and Sinners Chapter 2',
        ),
      ).toEqual([]);
      expect(parseComboCartConstituentTitles('Ratchet & Clank')).toEqual([]);
      expect(parseComboCartConstituentTitles('Sonic & Knuckles')).toEqual([]);
    });

    it('handles structural storefront candidates, generic edition wrappers, quotes, and expanded combo patterns', () => {
      expect(
        buildStructuralTitleCandidates(
          'Fire Emblem Warriors - 3DS [ONLY WORKS ON NEW 3DS & 2DS SYSTEMS]',
        ),
      ).toContain('Fire Emblem Warriors');
      expect(
        buildStructuralTitleCandidates(
          'Pokemon Moon [LIMIT 1 PER HOUSEHOLD] - 3DS',
        ),
      ).toContain('Pokemon Moon');
      expect(
        buildStructuralTitleCandidates('UNDER NIGHT IN-BIRTH II [Sys:Celes]'),
      ).toEqual([
        'UNDER NIGHT IN-BIRTH II [Sys:Celes]',
        'UNDER NIGHT IN-BIRTH II',
      ]);
      expect(buildStructuralTitleCandidates('D+Vine[Luv]')[0]).toBe(
        'D+Vine[Luv]',
      );
      expect(
        buildStructuralTitleCandidates("ONLINE EXCLUSIVE EDTION: 7'scarlet"),
      ).toContain("7'scarlet");
      expect(
        buildStructuralTitleCandidates('Metroid Prime - Best Buy Exclusive'),
      ).toContain('Metroid Prime');
      expect(
        buildStructuralTitleCandidates('Star Ocean - Game [UNBOXING]'),
      ).toContain('Star Ocean');
      // Local structural extraction does NOT blindly peel arbitrary unseparated word+Edition phrases
      expect(buildStructuralTitleCandidates('OFF Bad Human Edition')).toEqual([
        'OFF Bad Human Edition',
      ]);
      expect(
        buildStructuralTitleCandidates(
          'Bubsy in: The Purrfect Collection Im-paw-sible Edition',
        ),
      ).toEqual(['Bubsy in: The Purrfect Collection Im-paw-sible Edition']);
      expect(
        buildDetailedIgdbMatchVariants(
          'Bubsy in: The Purrfect Collection Im-paw-sible Edition',
        ).map((v) => v.title),
      ).toContain('Bubsy in: The Purrfect Collection');
      expect(
        buildDetailedIgdbMatchVariants('Super Soccer Tournament Edition').map(
          (v) => v.title,
        ),
      ).not.toContain('Super Soccer');
      expect(
        extractPhysicalEditionForVariant(
          'Untitled Goose Game - "Lovely Edition"',
        ),
      ).toEqual({
        baseTitle: 'Untitled Goose Game',
        edition: 'Lovely Edition',
      });
      expect(
        extractPhysicalEditionForVariant(
          'Sonic Frontiers - Day Zero Edition [Best Buy Exclusive]',
        ),
      ).toEqual({
        baseTitle: 'Sonic Frontiers',
        edition: 'Day Zero Edition',
      });

      expect(
        parseComboCartConstituentTitles(
          'Giana Sisters 1&2 Complete Edition (Switch)',
        ),
      ).toEqual(['Giana Sisters', 'Giana Sisters 2']);
      expect(
        parseComboCartConstituentTitles(
          'Athena 1+2 Helion Collection [Limited Edition]',
        ),
      ).toEqual(['Athena', 'Athena 2']);
      expect(
        parseComboCartConstituentTitles('Trine 1, 2, & 3 Collection'),
      ).toEqual(['Trine', 'Trine 2', 'Trine 3']);
      expect(
        parseComboCartConstituentTitles(
          'COGEN: Sword of Rewind & Gunvolt Chronicles: Luminous Avenger iX 2 Double Pack',
        ),
      ).toEqual([
        'COGEN: Sword of Rewind',
        'Gunvolt Chronicles: Luminous Avenger iX 2',
      ]);
      expect(
        parseComboCartConstituentTitles(
          'Shin chan: "Me and the Professor on Summer Vacation" & "Shiro of Coal Town" Double Pack',
        ),
      ).toEqual([
        'Shin chan: Me and the Professor on Summer Vacation',
        'Shin chan: Shiro of Coal Town',
      ]);
    });
  });
});
