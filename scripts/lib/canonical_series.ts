/**
 * CANONICAL SERIES COMPUTATION LOGIC & HELPERS
 *
 * Provides deterministic rules and heuristics for mapping video game titles
 * and IGDB metadata (collections, franchises) to unified canonical series names.
 */

export interface GameMetadata {
  title: string;
  collections?: string;
  franchises?: string;
}

/**
 * Explicit title/tag redirects for localized names, spin-offs, and multi-game bundles.
 * Null values represent non-franchise or marketing collections that should be ignored.
 */
export const EXPLICIT_SPINOFF_REDIRECTS: Record<string, string | null> = {
  // Historical cross-IP renames and localized titles
  "Gargoyle's Quest": "Ghosts 'n Goblins",
  "Gargoyle's Quest II": "Ghosts 'n Goblins",
  "Demon's Crest": "Ghosts 'n Goblins",
  'Final Fantasy Legend': 'SaGa',
  'The Final Fantasy Legend': 'SaGa',
  'Final Fantasy Legend II': 'SaGa',
  'Final Fantasy Legend III': 'SaGa',
  'Romancing SaGa': 'SaGa',
  'Final Fantasy Adventure': 'Mana',
  'Harvest Moon (old)': 'Story of Seasons',
  'Harvest Moon GBC': 'Story of Seasons',
  'Harvest Moon (new)': 'Harvest Moon',
  "Snake's Revenge": 'Metal Gear',
  'Tetris Plus': 'Tetris',
  'The Typing of the Dead': 'The House of the Dead',
  'Typing of the Dead': 'The House of the Dead',
  'Kid Dracula': 'Castlevania',
  'Itadaki Street': 'Fortune Street',

  // Red Dead Redemption umbrella
  'Red Dead': 'Red Dead Redemption',
  'Red Dead Revolver': 'Red Dead Redemption',

  // Tomb Raider umbrella for Lara Croft
  'The Lara Croft Collection': 'Tomb Raider',
  'Lara Croft': 'Tomb Raider',

  // Donkey Kong spin-offs
  'Diddy Kong Racing DS': 'Donkey Kong',
  'Diddy Kong Racing': 'Donkey Kong',
  'DK: Jungle Climber': 'Donkey Kong',
  'DK: King of Swing': 'Donkey Kong',

  // Pokémon standalone spin-offs without "Pokémon" in title
  'Detective Pikachu': 'Pokémon',
  'Detective Pikachu Returns': 'Pokémon',
  PokéPark: 'Pokémon',

  // EarthBound Japanese Mother tags
  'EarthBound Beginnings': 'EarthBound',
  Mother: 'EarthBound',
  'Mother 1+2': 'EarthBound',

  // Multi-game compilations / special bundles
  'Child of Light: Ultimate Edition + Valiant Hearts: The Great War':
    'Child of Light + Valiant Hearts',
  'Heavy Rain & Beyond: Two Souls Collection':
    'Heavy Rain & Beyond: Two Souls Collection',
  'Heavy Rain & Beyond: Two Souls - Collection':
    'Heavy Rain & Beyond: Two Souls Collection',
  'Beyond: Two Souls': 'Beyond: Two Souls',
  'Anniversary Collection Arcade Classics': 'Konami Arcade Classics',
  'Arcade Classics': 'Konami Arcade Classics',
  'Triple Pack: Trials HD, Limbo, Splosion Man': 'Xbox Live Arcade',
  'Dead Cells: Return to Castlevania Edition': 'Dead Cells',

  // Super Scope
  'Super Scope': 'Super Scope 6',

  // Raving Rabbids franchise redirects
  Rabbids: 'Raving Rabbids',
  'Rabbids Invasion': 'Raving Rabbids',

  // Spyro the Dragon
  'Spyro: Season': 'Spyro the Dragon',

  // Spinoff naming prefixes and missing-metadata overrides
  'Super Bomberman': 'Bomberman',
  'Super Bomberman R': 'Bomberman',
  'Ms. Pac-Man': 'Pac-Man',
  'Captain Toad': 'Captain Toad',
  'Captain Toad: Treasure Tracker': 'Captain Toad',
  'Pokémon Colosseum Bonus Disc': 'Pokémon',
  'Bubsy 3D': 'Bubsy',
  'Bubsy 3D: Furbitten Planet': 'Bubsy',
  'RollerCoaster Tycoon Joyride': 'RollerCoaster Tycoon',
  'Far Cry Instincts': 'Far Cry',
  'Minecraft Dungeons': 'Minecraft',
  'Minecraft: Story Mode': 'Minecraft',
  'Classic NES Series: Excitebike': 'Excitebike',

  // Marketing, non-franchise, or hardware series that must be ignored (null)
  'PopCap Hits!': null,
  Skittles: null,
  'Nintendo Selects': null,
  'Classic Series': null,
  'NES Series': null,
  'Classic NES Series': null,
  'Famicom Mini': null,
  'NES Classics': null,
  'Mike Tyson': null,
  'Light Gun Series': null,
  'Robot Series': null,
  Amiibo: null,
  'Sega Ages': null,
  'Nintendo Sports': null,
  'Action Series': null,
  'Programmable Series': null,
  'Sports Series': null,
};

/**
 * Authoritative casing and formatting lookup table.
 */
export const CANONICAL_NAME_MAP: Record<string, string> = {
  sonicthehedgehog: 'Sonic the Hedgehog',
  watchdogs: 'Watch Dogs',
  earthbound: 'EarthBound',
  mother: 'EarthBound',
  earthboundbeginnings: 'EarthBound',
  eccothedolphin: 'Ecco the Dolphin',
  dccomics: 'DC',
  dc: 'DC',
  marvel: 'Marvel',
  lego: 'LEGO',
  pokmon: 'Pokémon',
  pokemon: 'Pokémon',
  banjokazooie: 'Banjo-Kazooie',
  vivapinata: 'Viva Piñata',
  xenoblade: 'Xenoblade Chronicles',
  xenobladechronicles: 'Xenoblade Chronicles',
  nights: 'Nights into Dreams',
  nightsintodreams: 'Nights into Dreams',
  hyperlight: 'Hyper Light Drifter',
  hyperlightdrifter: 'Hyper Light Drifter',
};

/**
 * Titles with numbers integral to the IP that must not have trailing digits stripped.
 */
export const PROTECTED_NUMBERED_TITLES: string[] = [
  'Mighty No. 9',
  'Area 51',
  'Cyberpunk 2077',
  '1942',
  '1943',
  '1944',
  '1080 Snowboarding',
  '1080 Avalanche',
  'Q.U.B.E.',
  'Q.U.B.E. 2',
  'BFG 9000',
  'Space Channel 5',
  'The Wonderful 101',
  'Super Scope 6',
  'Castlevania: Dracula X',
];

/**
 * Strips non-alphanumeric characters and converts string to lowercase.
 */
export function normalize(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Strips known creator and classic reissue prefixes from game titles or tags.
 */
export function stripCreatorPrefix(s: string): string {
  return s
    .replace(/^Sid Meier's\s+/i, '')
    .replace(/^Tom Clancy's\s+/i, '')
    .replace(/^American McGee's\s+/i, '')
    .replace(/^Will Wright's\s+/i, '')
    .replace(/^Clive Barker's\s+/i, '')
    .replace(/^Peter Molyneux's\s+/i, '')
    .replace(/^Mike Tyson's\s+/i, '')
    .replace(/^Disney's\s+/i, '')
    .replace(/^Classic NES Series:\s+/i, '');
}

/**
 * Strips trailing volume/part/episode markers and sequel digits or Roman numerals up to XVI (16)
 * while preserving protected titles whose numbers are integral to the franchise name.
 */
export function stripTrailingNumbers(s: string): string {
  const sClean = s.trim();

  for (const prot of PROTECTED_NUMBERED_TITLES) {
    if (
      sClean.toLowerCase() === prot.toLowerCase() ||
      sClean.toLowerCase().startsWith(prot.toLowerCase() + ':')
    ) {
      return prot;
    }
  }

  // Strip trailing Vol. / Volume / Part / Episode suffixes first
  let result = sClean.replace(
    /\s*(?:-|:)?\s*\b(?:Vol\.?|Volume|Part|Episode)\s+(?:XVI|XV|XIV|XIII|XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I|\d+)$/i,
    '',
  );

  // Strip Roman numerals up to XVI (16)
  const romanPattern =
    /\s+(XVI|XV|XIV|XIII|XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)$/i;
  result = result.replace(romanPattern, '');

  // Strip Arabic numbers only if not preceded by protected prefixes
  if (!/\b(No\.|Area|Cyberpunk)\s+\d+$/i.test(result)) {
    result = result.replace(/\s+\d+$/i, '');
  }

  return result.trim();
}

/**
 * Computes the canonical series name for a given game using hierarchical rules and scoring.
 *
 * @param game Metadata containing title and optional IGDB collections/franchises tags
 * @returns The resolved canonical series name
 */
export function computeGameCanonicalSeries(game: GameMetadata): string {
  const cleanTitle = stripCreatorPrefix(game.title || '');
  const titleLower = cleanTitle.toLowerCase();
  const rawCollections = (game.collections || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const cleanTag = (t: string) =>
    stripCreatorPrefix(t.replace(/\([^)]*\)/g, '').trim());

  const seriesRaw = rawCollections
    .filter((s) => EXPLICIT_SPINOFF_REDIRECTS[s] !== null)
    .map((s: string) =>
      EXPLICIT_SPINOFF_REDIRECTS[s] !== undefined ? s : cleanTag(s),
    )
    .filter((s) => s && EXPLICIT_SPINOFF_REDIRECTS[s] !== null);
  const franchisesRaw = (game.franchises || '')
    .split(',')
    .map((s: string) => cleanTag(s))
    .filter((s) => s && EXPLICIT_SPINOFF_REDIRECTS[s] !== null);

  // STEP 1A: RUNE FACTORY & HARVEST MOON / STORY OF SEASONS DISAMBIGUATION
  if (titleLower.startsWith('rune factory')) {
    return 'Rune Factory';
  }
  const isHarvestMoonOrStoryOfSeasonsTitle =
    titleLower.includes('harvest moon') ||
    titleLower.includes('story of seasons');
  if (isHarvestMoonOrStoryOfSeasonsTitle) {
    const hasHarvestMoonNew = rawCollections.some(
      (c) => c.toLowerCase() === 'harvest moon (new)',
    );
    const hasHarvestMoonOld = rawCollections.some((c) =>
      ['harvest moon (old)', 'harvest moon gbc'].includes(c.toLowerCase()),
    );
    const hasStoryOfSeasonsFranchise = franchisesRaw.some(
      (f) => normalize(f) === 'storyofseasons',
    );
    if (hasHarvestMoonNew && !hasStoryOfSeasonsFranchise) {
      return 'Harvest Moon';
    }
    if (hasHarvestMoonOld || hasStoryOfSeasonsFranchise) {
      return 'Story of Seasons';
    }
    if (
      titleLower.startsWith('harvest moon') &&
      titleLower !== 'harvest moon (old)'
    ) {
      return 'Harvest Moon';
    }
  }

  // STEP 1B: EXPLICIT TITLE REDIRECTS
  if (EXPLICIT_SPINOFF_REDIRECTS[game.title] !== undefined) {
    const redir = EXPLICIT_SPINOFF_REDIRECTS[game.title];
    if (redir !== null) return redir;
  }
  if (EXPLICIT_SPINOFF_REDIRECTS[cleanTitle] !== undefined) {
    const redir = EXPLICIT_SPINOFF_REDIRECTS[cleanTitle];
    if (redir !== null) return redir;
  }
  if (titleLower.includes('xenoblade')) {
    return 'Xenoblade Chronicles';
  }
  if (titleLower.startsWith('ghost of tsushima')) {
    return 'Ghost of Tsushima';
  }
  if (titleLower.startsWith('disney infinity')) {
    return 'Disney';
  }
  if (titleLower.startsWith('scribblenauts')) {
    return 'Scribblenauts';
  }
  if (titleLower.startsWith('skylanders')) {
    return 'Skylanders';
  }

  // STEP 2: MULTI-FRANCHISE COMPILATIONS & ARCADE PACKS
  if (
    titleLower.includes('namco museum') ||
    titleLower.includes('dreamcast collection') ||
    titleLower.includes("sonic's ultimate genesis collection") ||
    titleLower.includes('nes remix') ||
    titleLower.includes('nintendo land') ||
    titleLower.includes('sega 3d classics') ||
    titleLower.includes('llamasoft: the jeff minter story') ||
    seriesRaw.some((s) => normalize(s) === 'goldmasterseries') ||
    titleLower.includes('xbox live arcade')
  ) {
    if (titleLower.includes('namco museum')) return 'Namco Museum';
    if (titleLower.includes('dreamcast collection'))
      return 'Dreamcast Collection';
    if (titleLower.includes("sonic's ultimate genesis collection"))
      return "Sonic's Ultimate Genesis Collection";
    if (titleLower.includes('nes remix')) return 'NES Remix';
    if (titleLower.includes('nintendo land')) return 'Nintendo Land';
    if (titleLower.includes('sega 3d classics'))
      return 'SEGA 3D Classics Collection';
    if (
      titleLower.includes('llamasoft: the jeff minter story') ||
      seriesRaw.some((s) => normalize(s) === 'goldmasterseries')
    )
      return 'Gold Master Series';
    if (titleLower.includes('xbox live arcade')) return 'Xbox Live Arcade';
  }

  // STEP 3: SPECIFIC MULTI-FRANCHISE CROSSOVERS ("VERSUS" & OLYMPIC)
  if (titleLower.includes('mario & sonic')) {
    return 'Mario & Sonic at the Olympic Games';
  }
  if (
    titleLower.includes('marvel vs. capcom') ||
    titleLower.includes('marvel super heroes vs. street fighter') ||
    titleLower.includes('x-men vs. street fighter') ||
    seriesRaw.some((s) => normalize(s).includes('marvelvscapcom'))
  ) {
    return 'Marvel vs. Capcom';
  }
  if (
    titleLower.includes('capcom vs. snk') ||
    titleLower.includes('snk vs. capcom')
  ) {
    return 'Capcom vs. SNK';
  }
  if (
    titleLower.includes('street fighter x tekken') ||
    titleLower.includes('tekken x street fighter')
  ) {
    return 'Street Fighter X Tekken';
  }
  if (
    titleLower.includes('mortal kombat vs. dc universe') ||
    titleLower.includes('mortal kombat vs dc universe')
  ) {
    return 'Mortal Kombat vs. DC Universe';
  }
  if (titleLower.includes('puyo puyo tetris')) {
    return 'Puyo Puyo Tetris';
  }
  if (titleLower.includes('professor layton vs. phoenix wright')) {
    return 'Professor Layton vs. Phoenix Wright: Ace Attorney';
  }
  if (
    titleLower.includes('smash bros') ||
    titleLower.includes('super smash bros')
  ) {
    return 'Super Smash Bros.';
  }

  // STEP 4: LEGO SUB-THEMES & BIONICLE
  if (
    titleLower.includes('lego') ||
    titleLower.includes('bionicle') ||
    seriesRaw.some(
      (s) => normalize(s).includes('lego') || normalize(s).includes('bionicle'),
    ) ||
    franchisesRaw.some(
      (f) => normalize(f).includes('lego') || normalize(f).includes('bionicle'),
    )
  ) {
    if (titleLower.includes('star wars')) return 'LEGO Star Wars';
    if (
      titleLower.includes('batman') ||
      titleLower.includes('dc super heroes') ||
      titleLower.includes('dc super-villains')
    )
      return 'LEGO Batman';
    if (titleLower.includes('marvel') || titleLower.includes('avengers'))
      return 'LEGO Marvel';
    if (titleLower.includes('harry potter')) return 'LEGO Harry Potter';
    if (titleLower.includes('indiana jones')) return 'LEGO Indiana Jones';
    if (
      titleLower.includes('lord of the rings') ||
      titleLower.includes('the hobbit')
    )
      return 'LEGO The Lord of the Rings';
    if (titleLower.includes('jurassic')) return 'LEGO Jurassic World';
    if (titleLower.includes('pirates of the caribbean'))
      return 'LEGO Pirates of the Caribbean';
    if (
      titleLower.includes('ninjago') ||
      seriesRaw.some((s) => normalize(s).includes('ninjago'))
    )
      return 'LEGO Ninjago';
    if (
      titleLower.includes('bionicle') ||
      seriesRaw.some((s) => normalize(s).includes('bionicle'))
    )
      return 'Bionicle';
    if (
      titleLower.includes('city undercover') ||
      titleLower.includes('lego city')
    )
      return 'LEGO City';
    if (titleLower.includes('the incredibles')) return 'LEGO The Incredibles';
    if (titleLower.includes('movie')) return 'The LEGO Movie';
    if (titleLower.includes('racers')) return 'LEGO Racers';
    if (titleLower.includes('island')) return 'LEGO Island';
    return 'LEGO';
  }

  // STEP 5: GENERALIZED SUPERHERO HERO & TEAM RESOLUTION (Marvel & DC)
  const isDC =
    franchisesRaw.some((f) =>
      ['dc', 'dccomics', 'dcuniverse'].includes(normalize(f)),
    ) ||
    seriesRaw.some((s) =>
      ['dc', 'dccomics', 'dcuniverse'].includes(normalize(s)),
    ) ||
    titleLower.startsWith('dc ') ||
    titleLower.includes('dc universe');

  const isMarvel =
    franchisesRaw.some((f) => normalize(f) === 'marvel') ||
    seriesRaw.some((s) => normalize(s) === 'marvel') ||
    titleLower.startsWith('marvel');

  const SUPERHERO_PATTERNS: Array<{ pattern: RegExp; series: string }> = [
    // DC
    { pattern: /\bbatman\b/i, series: 'Batman' },
    { pattern: /\bsuperman\b/i, series: 'Superman' },
    { pattern: /\bjustice league\b/i, series: 'Justice League' },
    { pattern: /\binjustice\b/i, series: 'Injustice' },
    { pattern: /\bsuicide squad\b/i, series: 'Suicide Squad' },
    { pattern: /\bgreen lantern\b/i, series: 'Green Lantern' },
    { pattern: /\bthe flash\b/i, series: 'The Flash' },
    { pattern: /\bwonder woman\b/i, series: 'Wonder Woman' },
    { pattern: /\bteen titans\b/i, series: 'Teen Titans' },
    { pattern: /\bwatchmen\b/i, series: 'Watchmen' },
    { pattern: /\bcatwoman\b/i, series: 'Catwoman' },

    // Marvel
    { pattern: /\b(?:spider-man|spiderman)\b/i, series: 'Spider-Man' },
    { pattern: /\bvenom\b/i, series: 'Spider-Man' },
    { pattern: /\bx-men\b/i, series: 'X-Men' },
    { pattern: /\bwolverine\b/i, series: 'Wolverine' },
    { pattern: /\biron man\b/i, series: 'Iron Man' },
    { pattern: /\bcaptain america\b/i, series: 'Captain America' },
    { pattern: /\b(?:the )?avengers\b/i, series: 'The Avengers' },
    { pattern: /\bdeadpool\b/i, series: 'Deadpool' },
    {
      pattern: /\bguardians of the galaxy\b/i,
      series: 'Guardians of the Galaxy',
    },
    { pattern: /\bpunisher\b/i, series: 'The Punisher' },
    { pattern: /\bfantastic (?:four|4)\b/i, series: 'Fantastic Four' },
    { pattern: /\bdaredevil\b/i, series: 'Daredevil' },
    { pattern: /\bghost rider\b/i, series: 'Ghost Rider' },
    { pattern: /\bhulk\b/i, series: 'Hulk' },
  ];

  // Specific contextual superhero rules
  if (
    titleLower.includes('blade') &&
    (titleLower.includes('marvel') ||
      titleLower.includes('vampire') ||
      isMarvel)
  ) {
    return 'Blade';
  }
  if (
    titleLower.includes('thor') &&
    (titleLower.includes('marvel') ||
      titleLower.includes('god of thunder') ||
      isMarvel)
  ) {
    return 'Thor';
  }

  // Precedence for X2 titles
  if (titleLower.startsWith('x2:')) {
    return 'X-Men';
  }

  // Check known superhero patterns against the title, picking the one appearing first
  const matchedHeroes: Array<{ series: string; index: number }> = [];
  for (const { pattern, series } of SUPERHERO_PATTERNS) {
    const match = pattern.exec(cleanTitle);
    if (match) {
      matchedHeroes.push({ series, index: match.index });
    }
  }
  if (matchedHeroes.length > 0) {
    matchedHeroes.sort((a, b) => a.index - b.index);
    return matchedHeroes[0].series;
  }

  // If game has DC or Marvel brand tags, check for hero/team tags
  if (isDC || isMarvel) {
    const COMIC_BRAND_NORMS = new Set([
      'marvel',
      'dc',
      'dccomics',
      'dcuniverse',
      'marvelcinematicuniverse',
    ]);
    const specificFranchises = franchisesRaw.filter(
      (f) => !COMIC_BRAND_NORMS.has(normalize(f)),
    );

    // Check if title contains any specific character/team franchise tag
    for (const f of specificFranchises) {
      const nf = normalize(f);
      if (nf && normalize(cleanTitle).includes(nf)) {
        return CANONICAL_NAME_MAP[nf] || f;
      }
    }

    // If only one specific non-brand franchise exists (e.g. Silver Surfer or Swamp Thing)
    if (specificFranchises.length === 1) {
      const f = specificFranchises[0];
      if (normalize(f) !== 'fables') {
        return CANONICAL_NAME_MAP[normalize(f)] || f;
      }
    }

    // True ensemble titles or explicit brand games
    if (
      isMarvel &&
      (titleLower.includes('marvel') ||
        franchisesRaw.some((f) => normalize(f) === 'marvel'))
    ) {
      return 'Marvel';
    }
    if (isDC && (titleLower.includes('dc') || titleLower.includes('justice'))) {
      return 'DC';
    }
  }

  // STEP 6: MUSOU / WARRIORS CROSSOVER HOST UNIVERSES
  if (
    titleLower.includes('hyrule warriors') ||
    titleLower.includes('age of calamity')
  )
    return 'The Legend of Zelda';
  if (
    titleLower.includes('fire emblem warriors') ||
    titleLower.includes('three hopes')
  )
    return 'Fire Emblem';
  if (titleLower.includes('dragon quest heroes')) return 'Dragon Quest';
  if (titleLower.includes('persona 5 strikers')) return 'Persona';
  if (
    titleLower.includes('one piece: pirate warriors') ||
    titleLower.includes('pirate warriors')
  )
    return 'One Piece';
  if (titleLower.includes('berserk and the band of the hawk')) return 'Berserk';
  if (
    titleLower.includes('dynasty warriors') ||
    seriesRaw.some((s) => normalize(s).includes('dynastywarriors'))
  )
    return 'Dynasty Warriors';
  if (
    titleLower.includes('samurai warriors') ||
    seriesRaw.some((s) => normalize(s).includes('samuraiwarriors'))
  )
    return 'Samurai Warriors';
  if (
    titleLower.includes('warriors orochi') ||
    seriesRaw.some((s) => normalize(s).includes('warriorsorochi'))
  )
    return 'Warriors Orochi';

  // STEP 7: YAKUZA / LIKE A DRAGON
  const isJudgment =
    titleLower === 'judgment' ||
    titleLower.startsWith('judgment:') ||
    titleLower.includes('lost judgment');

  if (
    titleLower.includes('yakuza') ||
    titleLower.includes('like a dragon') ||
    isJudgment ||
    franchisesRaw.some((f) =>
      ['yakuza', 'likeadragon', 'judgment'].includes(normalize(f)),
    ) ||
    seriesRaw.some((s) =>
      ['yakuza', 'likeadragon', 'judgment'].includes(normalize(s)),
    )
  ) {
    return 'Like a Dragon';
  }

  // STEP 8: GAME & WATCH & DONKEY KONG (Before Mario, excluding Mario vs. Donkey Kong)
  if (
    titleLower.includes('game & watch') ||
    seriesRaw.some((s) => normalize(s).includes('gamewatch'))
  ) {
    return 'Game & Watch';
  }
  if (
    !titleLower.includes('mario vs') &&
    (titleLower.includes('donkey kong') ||
      titleLower.includes('diddy kong') ||
      (seriesRaw.some((s) => normalize(s).includes('donkeykong')) &&
        !titleLower.includes('mario')))
  ) {
    return 'Donkey Kong';
  }

  // STEP 9: MARIO UNIVERSE & SUB-SERIES
  const isMarioUniverse =
    titleLower.includes('mario') ||
    titleLower.includes('luigi') ||
    titleLower.includes('yoshi') ||
    titleLower.includes('wario') ||
    titleLower.includes('princess peach') ||
    seriesRaw.some((s) => {
      const ns = normalize(s);
      return (
        ns.includes('mario') ||
        ns.includes('luigi') ||
        ns.includes('yoshi') ||
        ns.includes('wario')
      );
    });

  if (isMarioUniverse) {
    if (titleLower.includes('dr. mario') || titleLower.includes('dr mario'))
      return 'Dr. Mario';
    if (
      titleLower.includes('mario vs. donkey kong') ||
      titleLower.includes('mario vs donkey kong')
    )
      return 'Mario vs. Donkey Kong';
    if (
      titleLower.includes('mario & luigi') ||
      (!titleLower.includes('paper mario') &&
        seriesRaw.some((s) => normalize(s) === 'marioandluigi'))
    )
      return 'Mario & Luigi';
    if (
      titleLower.includes('mario kart') ||
      seriesRaw.some((s) => normalize(s) === 'mariokart')
    )
      return 'Mario Kart';
    if (
      titleLower.includes('paper mario') ||
      seriesRaw.some((s) => normalize(s) === 'papermario')
    )
      return 'Paper Mario';
    if (
      titleLower.includes("luigi's mansion") ||
      seriesRaw.some((s) => normalize(s) === 'luigismansion')
    )
      return "Luigi's Mansion";
    if (
      titleLower.includes('mario party') ||
      seriesRaw.some((s) => normalize(s) === 'marioparty')
    )
      return 'Mario Party';
    if (
      titleLower.includes('mario golf') ||
      seriesRaw.some((s) => normalize(s) === 'mariogolf')
    )
      return 'Mario Golf';
    if (
      titleLower.includes('mario tennis') ||
      seriesRaw.some((s) => normalize(s) === 'mariotennis')
    )
      return 'Mario Tennis';
    if (
      titleLower.includes('mario strikers') ||
      titleLower.includes('super mario strikers')
    )
      return 'Mario Strikers';
    if (
      titleLower.includes('mario superstar baseball') ||
      titleLower.includes('mario super sluggers')
    )
      return 'Mario Baseball';
    if (
      titleLower.includes('warioware') ||
      titleLower.includes('wario ware') ||
      seriesRaw.some((s) => normalize(s) === 'warioware')
    )
      return 'WarioWare';
    if (
      titleLower.includes('wario') ||
      (franchisesRaw.some((f) => normalize(f) === 'wario') &&
        !titleLower.includes('mario'))
    )
      return 'Wario';
    if (
      titleLower.includes('yoshi') ||
      (franchisesRaw.some((f) => normalize(f) === 'yoshi') &&
        !titleLower.includes('mario'))
    )
      return 'Yoshi';
    if (
      titleLower.includes('mario paint') ||
      titleLower.includes("mario's picross") ||
      titleLower.includes('mario clash') ||
      titleLower.includes('mario is missing') ||
      titleLower.includes("mario's time machine") ||
      titleLower.includes('mario hoops') ||
      titleLower.includes('mario sports mix') ||
      titleLower.includes('mario pinball')
    ) {
      return 'Mario';
    }
    if (
      titleLower.includes('super mario') ||
      seriesRaw.some((s) => normalize(s).includes('supermario'))
    ) {
      return 'Super Mario';
    }
    return 'Mario';
  }

  // STEP 10: DRAGON QUEST / MONSTERS
  if (
    titleLower.includes('dragon warrior') ||
    titleLower.includes('dragon quest') ||
    seriesRaw.some(
      (s) =>
        normalize(s).includes('dragonquest') ||
        normalize(s).includes('dragonwarrior'),
    )
  ) {
    return 'Dragon Quest';
  }

  // STEP 11: QUAKE
  if (titleLower.startsWith('quake')) {
    return 'Quake';
  }

  // STEP 12: CIVILIZATION
  if (titleLower.includes('civilization')) {
    return 'Civilization';
  }

  // STEP 13: PERSONA
  if (
    titleLower.includes('persona') ||
    seriesRaw.some((s) => normalize(s).includes('persona')) ||
    franchisesRaw.some((f) => normalize(f).includes('persona'))
  ) {
    return 'Persona';
  }

  // STEP 14: LORD OF THE RINGS / MIDDLE-EARTH
  if (
    titleLower.includes('lord of the rings') ||
    titleLower.includes('hobbit') ||
    titleLower.includes('middle-earth') ||
    titleLower.includes('middle earth') ||
    titleLower.includes('shadow of mordor') ||
    titleLower.includes('shadow of war') ||
    seriesRaw.some(
      (s) =>
        normalize(s).includes('lordoftherings') ||
        normalize(s).includes('middleearth'),
    )
  ) {
    return 'The Lord of the Rings';
  }

  // STEP 15: SONIC
  if (
    titleLower.includes('sonic riders') ||
    titleLower.includes('sonic rush') ||
    titleLower.includes('sonic the hedgehog') ||
    titleLower.includes('sonic adventure') ||
    titleLower.includes('sonic advance') ||
    titleLower.includes('sonic colors') ||
    titleLower.includes('sonic generations') ||
    titleLower.includes('sonic boom') ||
    titleLower.includes('sonic forces') ||
    titleLower.includes('sonic lost world') ||
    titleLower.includes('sonic heroes') ||
    titleLower.includes('sonic unleashed') ||
    titleLower.includes('sonic mania') ||
    titleLower.includes('sonic frontiers') ||
    titleLower.includes('team sonic racing') ||
    titleLower.includes('shadow the hedgehog') ||
    titleLower.includes('tails and the music maker') ||
    titleLower.startsWith('sonic ')
  ) {
    return 'Sonic the Hedgehog';
  }

  // STEP 16: TOM CLANCY
  if (
    titleLower.includes('splinter cell') ||
    seriesRaw.some((s) => normalize(s).includes('splintercell'))
  )
    return 'Splinter Cell';
  if (
    titleLower.includes('ghost recon') ||
    seriesRaw.some((s) => normalize(s).includes('ghostrecon'))
  )
    return 'Ghost Recon';
  if (
    titleLower.includes('rainbow six') ||
    seriesRaw.some((s) => normalize(s).includes('rainbowsix'))
  )
    return 'Rainbow Six';
  if (
    titleLower.includes('the division') ||
    seriesRaw.some((s) => normalize(s).includes('thedivision'))
  )
    return 'The Division';

  // STEP 17: SIMS
  if (titleLower.startsWith('mysims') || titleLower.includes('mysims'))
    return 'MySims';
  if (titleLower.includes('simcity')) return 'SimCity';
  if (titleLower.startsWith('the sims') || titleLower.includes('the sims'))
    return 'The Sims';
  if (
    titleLower.startsWith('sim') ||
    seriesRaw.some((s) => normalize(s) === 'sim') ||
    franchisesRaw.some((f) => normalize(f) === 'sim')
  ) {
    return 'Sim';
  }

  // STEP 18: DYNAMIC CANDIDATE SCORING (Length-Weighted, Token-Boosted, Authority-Normalized)
  const resolvedSeriesRaw = seriesRaw.map(
    (s) => (EXPLICIT_SPINOFF_REDIRECTS[s] as string) || s,
  );
  const resolvedFranchisesRaw = franchisesRaw
    .map((f) => (EXPLICIT_SPINOFF_REDIRECTS[f] as string) || f)
    .filter((f) => {
      // Prevent cameo-only Mario/Star Fox/Castlevania franchise tags from applying when no collection is present and title doesn't match
      const nf = normalize(f);
      if (
        ['mario', 'starfox', 'evildead'].includes(nf) &&
        !titleLower.includes(f.toLowerCase())
      ) {
        return false;
      }
      return true;
    });

  // Consolidate candidate sub-collections to parent franchise
  const consolidatedSeriesRaw = resolvedSeriesRaw.map((s) => {
    const ns = normalize(s);
    if (!resolvedFranchisesRaw.some((f) => normalize(f) === ns)) {
      for (const f of resolvedFranchisesRaw) {
        const sLower = s.toLowerCase();
        const fLower = f.toLowerCase();
        const isSubCollection =
          sLower.startsWith(fLower + ':') ||
          sLower.startsWith(fLower + ' -') ||
          sLower.startsWith(fLower + ' ') ||
          sLower.startsWith(fLower + "'s ") ||
          sLower.startsWith(fLower + '’s ');
        if (isSubCollection) {
          return f;
        }
      }
    }
    return s;
  });

  const candidates = Array.from(
    new Set([...consolidatedSeriesRaw, ...resolvedFranchisesRaw]),
  ).map((c) => stripTrailingNumbers(c));

  const isCompilationOrVolumeTitle =
    /\b(collection|classics|anthology|compilation|mega pack|triple pack|double pack|combo pack|bundle|best of|vol\.?|volume)\b/i.test(
      cleanTitle,
    );
  const normTitle = normalize(cleanTitle);
  const STOP_WORDS = new Set([
    'the',
    'and',
    'for',
    'vol',
    'volume',
    'collection',
    'classics',
    'classic',
    'anthology',
    'compilation',
    'pack',
    'mega',
    'triple',
    'double',
    'combo',
    'bundle',
    'best',
    'edition',
    'series',
  ]);
  const titleSignificantWords = new Set(
    cleanTitle
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w)),
  );

  if (candidates.length > 0) {
    const scores = candidates.map((cand) => {
      let score = 0;
      const normCand = normalize(cand);

      const isCollection = consolidatedSeriesRaw.some(
        (x) => normalize(stripTrailingNumbers(x)) === normCand,
      );
      const isFranchise = resolvedFranchisesRaw.some(
        (x) => normalize(stripTrailingNumbers(x)) === normCand,
      );

      const isExact = Boolean(normCand) && normTitle === normCand;
      const isPrefix =
        Boolean(normCand) && !isExact && normTitle.startsWith(normCand);
      const isSubstring =
        Boolean(normCand) &&
        !isExact &&
        !isPrefix &&
        normTitle.includes(normCand);
      const candWords = cand
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
      const sharesSignificantWord = candWords.some((w) =>
        titleSignificantWords.has(w),
      );

      if (
        isCompilationOrVolumeTitle &&
        !isExact &&
        !isPrefix &&
        !isSubstring &&
        !sharesSignificantWord
      ) {
        return { item: cand, score: 0 };
      }

      if (isFranchise) score += 5;
      if (isCollection) score += 3;

      // Exact match or prefix match bonus
      if (isExact) {
        score += 25;
      } else if (isPrefix) {
        score += 20;
      } else if (isSubstring) {
        score += 6 + Math.min(normCand.length, 10);
      }

      // First token match boost (e.g. "Crash" in "Crash Nitro Kart" matching first word of "Crash Bandicoot")
      const candFirstWord = (cand.split(/\s+/)[0] || '').toLowerCase();
      const titleFirstWord = (cleanTitle.split(/\s+/)[0] || '').toLowerCase();
      const hasFirstWordMatch =
        !isCompilationOrVolumeTitle &&
        candFirstWord.length >= 3 &&
        candFirstWord === titleFirstWord;
      if (hasFirstWordMatch) {
        score += 12;
      }

      const hasAnyTitleMatch =
        isExact ||
        isPrefix ||
        isSubstring ||
        sharesSignificantWord ||
        hasFirstWordMatch;

      return { item: cand, score, hasAnyTitleMatch };
    });

    const maxScore = Math.max(...scores.map((s) => s.score));
    const topScorers = scores.filter((s) => s.score === maxScore);
    const distinctTopNorm = new Set(topScorers.map((s) => normalize(s.item)));

    // When multiple distinct candidates compete with no title match (e.g. crossover games with multiple franchises like PlayStation Move Heroes),
    // do not pick one arbitrarily via string-length tie-breaker.
    if (
      maxScore <= 8 &&
      distinctTopNorm.size > 1 &&
      !topScorers[0].hasAnyTitleMatch
    ) {
      // Disqualify: competing candidates share no title match. Fall through to title fallback.
    } else {
      scores.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.item.length - a.item.length;
      });

      if (scores.length > 0 && scores[0].score > 0) {
        const winner = scores[0].item;
        if (EXPLICIT_SPINOFF_REDIRECTS[winner]) {
          return EXPLICIT_SPINOFF_REDIRECTS[winner] as string;
        }
        const normWinner = normalize(winner);
        if (CANONICAL_NAME_MAP[normWinner]) {
          return CANONICAL_NAME_MAP[normWinner];
        }
        return winner;
      }
    }
  }

  // FALLBACK
  const prefix = stripTrailingNumbers(
    stripCreatorPrefix(cleanTitle.split(':')[0].trim()),
  );
  if (EXPLICIT_SPINOFF_REDIRECTS[prefix]) {
    return EXPLICIT_SPINOFF_REDIRECTS[prefix] as string;
  }
  const normPrefix = normalize(prefix);
  if (CANONICAL_NAME_MAP[normPrefix]) {
    return CANONICAL_NAME_MAP[normPrefix];
  }
  return prefix;
}
