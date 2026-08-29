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
  "Gargoyle's Quest": "Ghosts 'n Goblins",
  "Gargoyle's Quest II": "Ghosts 'n Goblins",
  "Demon's Crest": "Ghosts 'n Goblins",
  'Final Fantasy Legend': 'SaGa',
  'The Final Fantasy Legend': 'SaGa',
  'Final Fantasy Legend II': 'SaGa',
  'Final Fantasy Legend III': 'SaGa',
  'Final Fantasy Adventure': 'Mana',
  'Harvest Moon (old)': 'Story of Seasons',
  'Harvest Moon': 'Story of Seasons',
  "Snake's Revenge": 'Metal Gear',
  'Tetris Plus': 'Tetris',
  'Detective Pikachu': 'Pokémon',
  'Detective Pikachu Returns': 'Pokémon',
  'Bubsy 3D: Furbitten Planet': 'Bubsy',
  'Bubsy 3D': 'Bubsy',
  'Rare Replay': 'Rare Replay',
  'Xbox Live Arcade Compilation Disc': 'Xbox Live Arcade',
  'The Orange Box': 'The Orange Box',
  'Heavy Rain & Beyond: Two Souls Collection':
    'Heavy Rain & Beyond: Two Souls Collection',
  'Heavy Rain & Beyond: Two Souls - Collection':
    'Heavy Rain & Beyond: Two Souls Collection',
  'Anniversary Collection Arcade Classics': 'Konami Arcade Classics',
  'Arcade Classics': 'Konami Arcade Classics',
  'The Typing of the Dead': 'The House of the Dead',
  'Typing of the Dead': 'The House of the Dead',
  'Kid Dracula': 'Castlevania',
  'Diddy Kong Racing DS': 'Donkey Kong',
  'Diddy Kong Racing': 'Donkey Kong',
  'DK: Jungle Climber': 'Donkey Kong',
  'DK: King of Swing': 'Donkey Kong',
  'Captain Toad: Treasure Tracker': 'Captain Toad',
  'Captain Toad': 'Captain Toad',
  'Gold Master Series': 'Gold Master Series',
  Skittles: null,
  'Nintendo Selects': null,
  'Classic Series': null,
  'NES Series': null,
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
  eccothedolphin: 'Ecco the Dolphin',
  dccomics: 'DC',
  dc: 'DC',
  marvel: 'Marvel',
  lego: 'LEGO',
  pokmon: 'Pokémon',
  pokemon: 'Pokémon',
  banjokazooie: 'Banjo-Kazooie',
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
];

/**
 * Strips non-alphanumeric characters and converts string to lowercase.
 */
export function normalize(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Strips known creator prefixes from game titles or tags.
 */
export function stripCreatorPrefix(s: string): string {
  return s
    .replace(/^Sid Meier's\s+/i, '')
    .replace(/^Tom Clancy's\s+/i, '')
    .replace(/^American McGee's\s+/i, '')
    .replace(/^Will Wright's\s+/i, '')
    .replace(/^Clive Barker's\s+/i, '')
    .replace(/^Peter Molyneux's\s+/i, '');
}

/**
 * Strips trailing sequel digits or Roman numerals up to XVI (16) while preserving
 * protected titles whose numbers are integral to the franchise name.
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

  // Strip Roman numerals up to XVI (16)
  const romanPattern =
    /\s+(XVI|XV|XIV|XIII|XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)$/i;
  let result = sClean.replace(romanPattern, '');

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
  const titleLower = (game.title || '').toLowerCase();

  const cleanTag = (t: string) =>
    stripCreatorPrefix(t.replace(/\([^)]*\)/g, '').trim());

  const seriesRaw = (game.collections || '')
    .split(',')
    .map((s: string) => cleanTag(s))
    .filter((s) => s && EXPLICIT_SPINOFF_REDIRECTS[s] !== null);
  const franchisesRaw = (game.franchises || '')
    .split(',')
    .map((s: string) => cleanTag(s))
    .filter((s) => s && EXPLICIT_SPINOFF_REDIRECTS[s] !== null);

  // STEP 1: EXPLICIT REDIRECTS
  for (const item of [game.title, ...seriesRaw, ...franchisesRaw]) {
    if (EXPLICIT_SPINOFF_REDIRECTS[item] !== undefined) {
      const redir = EXPLICIT_SPINOFF_REDIRECTS[item];
      if (redir !== null) return redir;
    }
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

  // STEP 5: SUPERHERO HERO-SPECIFIC SPLIT (Marvel & DC)
  // DC Heroes
  if (
    titleLower.includes('batman') ||
    seriesRaw.some((s) => normalize(s).includes('batman'))
  )
    return 'Batman';
  if (
    titleLower.includes('superman') ||
    seriesRaw.some((s) => normalize(s).includes('superman'))
  )
    return 'Superman';
  if (
    titleLower.includes('injustice') ||
    seriesRaw.some((s) => normalize(s).includes('injustice'))
  )
    return 'Injustice';
  if (titleLower.includes('suicide squad')) return 'Suicide Squad';
  if (titleLower.includes('green lantern')) return 'Green Lantern';
  if (titleLower.includes('the flash') || titleLower.startsWith('flash'))
    return 'The Flash';
  if (titleLower.includes('wonder woman')) return 'Wonder Woman';
  if (titleLower.includes('teen titans')) return 'Teen Titans';
  if (titleLower.includes('watchmen')) return 'Watchmen';
  if (titleLower.includes('catwoman')) return 'Catwoman';
  if (titleLower.includes('justice league')) return 'Justice League';
  if (
    titleLower.includes('dc universe') ||
    franchisesRaw.some((f) =>
      ['dc', 'dccomics', 'dcuniverse'].includes(normalize(f)),
    )
  )
    return 'DC';

  // Marvel Heroes
  if (
    titleLower.includes('spider-man') ||
    titleLower.includes('spiderman') ||
    titleLower.includes('venom') ||
    seriesRaw.some((s) => normalize(s).includes('spiderman'))
  )
    return 'Spider-Man';
  if (
    titleLower.includes('x-men') ||
    titleLower.includes('wolverine') ||
    seriesRaw.some((s) => normalize(s).includes('xmen'))
  )
    return 'X-Men';
  if (
    titleLower.includes('iron man') ||
    seriesRaw.some((s) => normalize(s).includes('ironman'))
  )
    return 'Iron Man';
  if (titleLower.includes('captain america')) return 'Captain America';
  if (
    titleLower.includes('thor') &&
    (titleLower.includes('god of thunder') || titleLower.includes('marvel'))
  )
    return 'Thor';
  if (titleLower.includes('hulk') || titleLower.includes('incredible hulk'))
    return 'Hulk';
  if (
    titleLower.includes('avengers') ||
    seriesRaw.some((s) => normalize(s).includes('avengers'))
  )
    return 'The Avengers';
  if (titleLower.includes('deadpool')) return 'Deadpool';
  if (titleLower.includes('guardians of the galaxy'))
    return 'Guardians of the Galaxy';
  if (titleLower.includes('punisher')) return 'The Punisher';
  if (titleLower.includes('fantastic four')) return 'Fantastic Four';
  if (titleLower.includes('daredevil')) return 'Daredevil';
  if (
    titleLower.includes('blade') &&
    (titleLower.includes('vampire') ||
      titleLower.includes('marvel') ||
      franchisesRaw.some((f) => normalize(f) === 'marvel'))
  )
    return 'Blade';
  if (titleLower.includes('ghost rider')) return 'Ghost Rider';
  if (
    titleLower.includes('marvel') ||
    franchisesRaw.some((f) => normalize(f) === 'marvel') ||
    seriesRaw.some((s) => normalize(s) === 'marvel')
  )
    return 'Marvel';

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
    franchisesRaw.some((f) =>
      ['mario', 'luigi', 'yoshi', 'wario'].includes(normalize(f)),
    );

  if (isMarioUniverse) {
    if (titleLower.includes('dr. mario') || titleLower.includes('dr mario'))
      return 'Dr. Mario';
    if (
      titleLower.includes('mario vs. donkey kong') ||
      titleLower.includes('mario vs donkey kong')
    )
      return 'Mario vs. Donkey Kong';
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
      titleLower.includes('mario & luigi') ||
      seriesRaw.some((s) => normalize(s) === 'marioandluigi')
    )
      return 'Mario & Luigi';
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
  const candidates = Array.from(new Set([...seriesRaw, ...franchisesRaw])).map(
    (c) => stripTrailingNumbers(c),
  );

  if (candidates.length > 0) {
    const scores = candidates.map((cand) => {
      let score = 0;
      const normCand = normalize(cand);
      const normTitle = normalize(game.title);

      const isCollection = seriesRaw.some(
        (x) => normalize(stripTrailingNumbers(x)) === normCand,
      );
      const isFranchise = franchisesRaw.some(
        (x) => normalize(stripTrailingNumbers(x)) === normCand,
      );

      if (isFranchise) score += 5;
      if (isCollection) score += 3;

      // Exact match or prefix match bonus
      if (normTitle === normCand || normTitle.startsWith(normCand)) {
        score += 20;
      } else if (normCand && normTitle.includes(normCand)) {
        score += 6 + Math.min(normCand.length, 10);
      }

      // First token match boost (e.g. "Crash" in "Crash Nitro Kart" matching first word of "Crash Bandicoot")
      const candFirstWord = (cand.split(/\s+/)[0] || '').toLowerCase();
      const titleFirstWord = (game.title.split(/\s+/)[0] || '').toLowerCase();
      if (candFirstWord.length >= 3 && candFirstWord === titleFirstWord) {
        score += 12;
      }

      return { item: cand, score };
    });

    scores.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.item.length - a.item.length;
    });

    if (scores.length > 0 && scores[0].score > 0) {
      const winner = scores[0].item;
      const normWinner = normalize(winner);
      if (CANONICAL_NAME_MAP[normWinner]) {
        return CANONICAL_NAME_MAP[normWinner];
      }
      return winner;
    }
  }

  // FALLBACK
  const prefix = stripTrailingNumbers(
    stripCreatorPrefix(game.title.split(':')[0].trim()),
  );
  const normPrefix = normalize(prefix);
  if (CANONICAL_NAME_MAP[normPrefix]) {
    return CANONICAL_NAME_MAP[normPrefix];
  }
  return prefix;
}
