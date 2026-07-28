/**
 * CANONICAL SERIES COMPUTATION LOGIC & HELPERS
 */

export interface GameMetadata {
  title: string;
  collections?: string;
  franchises?: string;
}

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

export function normalize(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function stripCreatorPrefix(s: string): string {
  return s
    .replace(/^Sid Meier's\s+/i, '')
    .replace(/^Tom Clancy's\s+/i, '')
    .replace(/^American McGee's\s+/i, '')
    .replace(/^Will Wright's\s+/i, '')
    .replace(/^Clive Barker's\s+/i, '')
    .replace(/^Peter Molyneux's\s+/i, '');
}

export function stripTrailingNumbers(s: string): string {
  return s
    .replace(/\s+\d+$/i, '')
    .replace(/\s+II$/i, '')
    .replace(/\s+III$/i, '')
    .replace(/\s+IV$/i, '')
    .replace(/\s+V$/i, '')
    .replace(/\s+VI$/i, '')
    .replace(/\s+VII$/i, '')
    .replace(/\s+VIII$/i, '')
    .replace(/\s+IX$/i, '')
    .replace(/\s+X$/i, '')
    .trim();
}

export function computeGameCanonicalSeries(game: GameMetadata): string {
  const titleLower = game.title.toLowerCase();

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

  // STEP 2: MULTI-FRANCHISE COMPILATIONS
  if (
    titleLower.includes('namco museum') ||
    titleLower.includes('dreamcast collection') ||
    titleLower.includes("sonic's ultimate genesis collection") ||
    titleLower.includes('nes remix') ||
    titleLower.includes('nintendo land')
  ) {
    if (titleLower.includes('namco museum')) return 'Namco Museum';
    if (titleLower.includes('dreamcast collection'))
      return 'Dreamcast Collection';
    if (titleLower.includes("sonic's ultimate genesis collection"))
      return "Sonic's Ultimate Genesis Collection";
    if (titleLower.includes('nes remix')) return 'NES Remix';
    if (titleLower.includes('nintendo land')) return 'Nintendo Land';
  }

  // STEP 3: SUPER SMASH BROS
  if (
    titleLower.includes('smash bros') ||
    titleLower.includes('super smash bros')
  ) {
    return 'Super Smash Bros.';
  }

  // STEP 4: DRAGON QUEST / MONSTERS
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

  // STEP 5: QUAKE
  if (titleLower.startsWith('quake')) {
    return 'Quake';
  }

  // STEP 6: CIVILIZATION
  if (titleLower.includes('civilization')) {
    return 'Civilization';
  }

  // STEP 7: LEGO
  if (
    titleLower.includes('lego') ||
    seriesRaw.some((s) => normalize(s) === 'lego') ||
    franchisesRaw.some((f) => normalize(f) === 'lego')
  ) {
    return 'LEGO';
  }

  // STEP 8: PERSONA
  if (
    titleLower.includes('persona') ||
    seriesRaw.some((s) => normalize(s).includes('persona')) ||
    franchisesRaw.some((f) => normalize(f).includes('persona'))
  ) {
    return 'Persona';
  }

  // STEP 9: LORD OF THE RINGS / MIDDLE-EARTH
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

  // STEP 10: SONIC RIDERS & SONIC RUSH & SONIC
  if (
    titleLower.includes('sonic riders') ||
    titleLower.includes('sonic rush') ||
    titleLower.includes('sonic the hedgehog') ||
    titleLower.startsWith('sonic ')
  ) {
    return 'Sonic the Hedgehog';
  }

  // STEP 11: SUPERHERO BRAND UMBRELLA (Marvel / DC)
  const isMarvel =
    titleLower.includes('marvel') ||
    titleLower.includes('spider-man') ||
    titleLower.includes('spiderman') ||
    titleLower.includes('x-men') ||
    titleLower.includes('iron man') ||
    titleLower.includes('punisher') ||
    titleLower.includes('avengers') ||
    franchisesRaw.some((f) => normalize(f) === 'marvel') ||
    seriesRaw.some((s) => normalize(s) === 'marvel');

  const isDC =
    titleLower.includes('dc universe') ||
    titleLower.includes('batman') ||
    titleLower.includes('superman') ||
    titleLower.includes('justice league') ||
    franchisesRaw.some(
      (f) => normalize(f) === 'dc' || normalize(f) === 'dcuniverse',
    );

  if (isMarvel) return 'Marvel';
  if (isDC) return 'DC';

  // STEP 12: MARIO UNIVERSE
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
      titleLower.includes('yoshi') ||
      (franchisesRaw.some((f) => normalize(f) === 'yoshi') &&
        !titleLower.includes('mario'))
    )
      return 'Yoshi';
    if (
      titleLower.includes('wario') ||
      (franchisesRaw.some((f) => normalize(f) === 'wario') &&
        !titleLower.includes('mario'))
    )
      return 'Wario';
    if (
      titleLower.includes('mario paint') ||
      titleLower.includes("mario's picross") ||
      titleLower.includes('mario clash') ||
      titleLower.includes('mario is missing') ||
      titleLower.includes("mario's time machine") ||
      titleLower.includes('mario hoops') ||
      titleLower.includes('mario super sluggers')
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

  // STEP 13: DONKEY KONG & GAME & WATCH
  if (
    titleLower.includes('game & watch gallery') ||
    seriesRaw.some((s) => normalize(s) === 'gamewatchgallery')
  ) {
    return 'Game & Watch Gallery';
  }
  if (
    titleLower.includes('game & watch') ||
    seriesRaw.some((s) => normalize(s) === 'gamewatch')
  ) {
    return 'Game & Watch';
  }
  if (
    titleLower.includes('donkey kong') ||
    (seriesRaw.some((s) => normalize(s).includes('donkeykong')) &&
      !titleLower.includes('mario'))
  ) {
    return 'Donkey Kong';
  }

  // STEP 14: TOM CLANCY
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

  // STEP 15: SIMS
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

  // STEP 16: DYNAMIC CANDIDATE SCORING WITH NUMBER STRIPPING
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
      if (normTitle.includes(normCand)) score += 6;

      return { item: cand, score };
    });

    scores.sort((a, b) => b.score - a.score);
    if (scores.length > 0 && scores[0].score > 0) {
      return scores[0].item;
    }
  }

  // FALLBACK
  const prefix = stripTrailingNumbers(
    stripCreatorPrefix(game.title.split(':')[0].trim()),
  );
  return prefix;
}
