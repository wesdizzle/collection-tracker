/**
 * @file title_matching.spec.ts
 * @description Unit tests for title_matching.ts.
 */

import { describe, it, expect } from 'vitest';
import { normalizeTitleForMatching, titlesMatch } from './title_matching.js';

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

  it('should strip franchise suffixes like "the hedgehog"', () => {
    expect(normalizeTitleForMatching('Sonic the Hedgehog Chaos')).toBe(
      'sonicchaos',
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
  });
});

describe('Title Matching Strategies', () => {
  it('should match exact normalized titles (Strategy 1)', () => {
    expect(titlesMatch('Tomb Raider', 'Tomb Raider')).toBe(true);
    expect(titlesMatch('Sonic Spinball', 'Sega Sonic Spinball')).toBe(true);
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
    // Return to Castle Wolfenstein
    expect(
      titlesMatch(
        'Return to Castle Wolfenstein',
        'Return to Castle Wolfenstein - Tides of War',
      ),
    ).toBe(true);
    // Game title has subtitle, release is base (Super Mario All-Stars)
    expect(
      titlesMatch(
        'Super Mario All-Stars: Limited Edition',
        'Super Mario All-Stars',
      ),
    ).toBe(true);
    // Game title has subtitle, release is base (Assassin's Creed Chronicles)
    expect(
      titlesMatch(
        "Assassin's Creed Chronicles: Trilogy Pack",
        "Assassin's Creed Chronicles",
      ),
    ).toBe(true);
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

    // Shovel Knight: Treasure Trove alias matching
    expect(
      titlesMatch(
        'Shovel Knight: Treasure Trove',
        'Shovel Knight',
        'Shovel Knight (USA)',
      ),
    ).toBe(true);
    expect(
      titlesMatch(
        'Shovel Knight: Treasure Trove',
        'Shovel Knight',
        'Shovel Knight (Europe) (En,Fr,De,Es,It)',
      ),
    ).toBe(true);
  });
});
