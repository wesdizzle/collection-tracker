import { isTrueEditionOrRevisionVariant } from './source_format.js';

/**
 * @file title_matching.ts
 * @description Refined title normalization and matching utility library.
 * It maps and compares game titles from user collection databases against No-Intro/Redump DAT files.
 * It avoids alphabetical word scrambling, supports fractional title-slashes,
 * resolves subtitles, and handles parenthetical bonus disc collisions.
 */

/**
 * Normalizes a game title into a canonical string by lowercasing, converting
 * symbols, removing publisher prefixes/suffixes, and stripping ignored words
 * while maintaining the natural word order.
 *
 * @param title The game title to normalize.
 * @returns The normalized title string.
 */
export function normalizeTitleForMatching(
  title: string,
  skipAliases = false,
): string {
  let t = title.toLowerCase().trim();

  // Normalize Unicode curly apostrophes/quotes before stripping 's
  t = t.replace(/[\u2018\u2019\u201B\u2032`]/g, "'");

  // Strip apostrophe-s ('s) early so publisher/franchise prefixes are cleanly removed.
  // E.g. "Disney's DuckTales" -> "Disney DuckTales" -> "DuckTales"
  t = t.replace(/'s\b/g, '');

  t = t.replace(/&/g, 'and');

  // Normalize visual character substitutions like $ -> s (e.g. Game$! -> Games!)
  t = t.replace(/\$/g, 's');

  // Handle transliterations and macrons
  t = t.replace(/oo/g, 'o').replace(/uu/g, 'u');
  t = t.replace(/cch/g, 'tch');

  // Normalize common spelling discrepancies
  t = t.replace(/mega\s+man/g, 'megaman');
  t = t.replace(/pac\s+man/g, 'pacman');
  t = t.replace(/super\s+mario/g, 'supermario');

  // Remove publisher prefixes/suffixes and franchise specific prefixes
  t = t.replace(
    /\b(disney|sega|nintendo|sony|microsoft|capcom|konami|namco|square enix|square|enix|atari|ubisoft|ea|marvel|sid meiers?|tom clancys?|lego|nickelodeon|lara croft)s?\b/gi,
    '',
  );

  // Remove franchise specific suffixes like "the hedgehog"
  t = t.replace(/\bthe hedgehog\b/gi, '');

  // Normalize common special disc descriptors to "bonus disc"
  t = t.replace(/\b(tokusei|kakuchou|special)\s+disc\b/gi, 'bonus disc');

  // Normalize diacritics
  t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Strip non-alphanumeric characters but keep spaces for word splitting
  t = t.replace(/[^a-z0-9\s]/g, ' ');

  // Filter out trailing platform suffixes from database titles (e.g. "Plants vs. Zombies DS" -> "Plants vs. Zombies")
  t = t.replace(
    /\b(ds|gba|gbc|n64|nes|snes|ps3|ps2|ps1|wii|xbox|3ds)\b$/gi,
    '',
  );

  // Filter out common articles and prepositions
  t = t.replace(
    /\b(the|a|an|and|in|of|for|with|on|at|to|by|or|from|version|edition)\b/gi,
    '',
  );

  // Split into words, filter empty ones, and join preserving natural order
  const words = t.split(/\s+/).filter((w) => w.length > 0);
  const cleanTitle = words.join('');

  // Explicit overrides using clean alphanumeric keys to resolve colons, spaces, and other punctuation differences.
  const ALIASES: Record<string, string> = {
    anothercrabstreasure: 'anothercrabtreasure',
    earthboundbeginnings: 'mother',
    legendzeldaocarinatimelegendzeldaocarinatimemasterquesttwogamebonusdisc:
      'legendzeldaocarinatimemasterquest',
    legendzeldaocarinatimemasterquesttwogamebonusdisc:
      'legendzeldaocarinatimemasterquest',
    pokemoncolosseumbonusdisc: 'pokemoncolosseumbonusdisc',
    princepersiatrilogyhd: 'princepersiatrilogy',
    jakdaxtercollection: 'jakdaxtertrilogy',
    ratchetclankcollection: 'ratchetclanktrilogy',
    walkingdeadseasontwo: 'walkingdeadseasontwotelltalegamesseries',
    finalfantasyxx2hdremaster:
      'finalfantasyxfinalfantasyx2finalfantasyxx2hdremaster',
    sonicclassics: 'soniccompilation',
    n: 'nplus',
    lemmings3d: '3dlemmings',
    harvestmonnewbeginning: 'harvestmon3dnewbeginning',
    harvestmontaletwotowns: 'harvestmon3dtaletwotowns',
    bioshockinfinitecomplete: 'bioshockinfinitecompletebonuscontentdisc',
    watchmenendisnigh: 'watchmenendisnighparts12',
    classicscollection: 'classicscollectionvol1',
    metalgearsolidlegacycollection: 'metalgearsolidlegacycollection19872012',
    splintercelltrilogyhd: 'splintercelltrilogy',
    dragonlairtrilogy: 'donbluthpresentsdragonlairtrilogy',
    softwaretolworksstarwarschess: 'starwarschess',
    simcopter64: 'simcopter',
    tombraiderstarring: 'tombraider',
    bioniclegame: 'bionicle',
    grandtheftautoadvance: 'grandtheftauto',
    starwarsepisodeijedipowerbattles: 'starwarsjedipowerbattles',
    dissidia012finalfantasy: 'dissidia012duodecimfinalfantasy',
    harvestmonlostvalley: 'harvestmon3dlostvalley',
    metalgearghostbabel: 'metalgearsolid',
    wonderboyiiimonsterlair: 'monsterlair',
    raymanhodlumsrevenge: 'raymanhodlumrevenge',
    metalgearsolidspecialmissions: 'metalgearsolidvrmissions',
    okamizekkeiban: 'okamihd',
    xenosagaepisodeiijenseitsvongutundboese:
      'xenosagaepisodeiijenseitsvongutundbose',
    littlebigplanetplaystationvita: 'littlebigplanetpsvita',
    homeuniquehorroradventure: 'home',
    fireemblemthreehopes: 'fireemblemwarriorsthreehopes',
    nierautomataendyorha: 'nierautomata',
    anniversarycollectionarcadeclassics: 'arcadeclassicsanniversary',
    batmanenemywithintelltaleseries: 'batmanenemywithin',
    blastermasterzeroii: 'blastermasterzero2',
    childlightultimatevaliantheartsgreatwar:
      'childlightultimatevaliantheartsgreatwardoublepack',
    cryptnecrodancerswitch: 'cryptnecrodancer',
    finalfantasypixelremastercollection:
      'finalfantasyivipixelremastercollection',
    glover: 'gloverqubyteclassics',
    groundedfullyyoked: 'groundedfullyyolked',
    harvestmonlighthope: 'harvestmonlighthopespecial',
    megamanlegacycollection12: 'megamanlegacycollection',
    ninokuniwrathwhitewitchremastered: 'ninokuniwrathwhitewitch',
    octodaddadliestcatch: 'octodaddeadliestcatch',
    oddworldmunchoddysee: 'oddworldmunchoddysseyhd',
    oddworldnewntasty: 'oddworldabeoddyseenewntasty',
    pikmin12bundle: 'pikmin12',
    plantsvszombiesbattleneighborvillecomplete:
      'plantsvszombiesbattleneighborville',
    shantaeriskyrevengedirectorcut: 'shantaeriskyrevenge',
    baldurgatebaldurgateiienhancededitions: 'baldurgatebaldurgateii',
    overcokedgourmet: 'overcoked',
    pacmance2: 'pacmanchampionship2',
    insidelimbobundle: 'insidelimbo',
    limboinsidebundle: 'insidelimbo',
    megamanxlegacycollection12: 'megamanxlegacycollection',
  };

  if (
    !skipAliases &&
    Object.prototype.hasOwnProperty.call(ALIASES, cleanTitle)
  ) {
    return ALIASES[cleanTitle];
  }

  return cleanTitle;
}

/**
 * Evaluates whether a database game title matches a release title.
 * Uses alternative title splitting and various matching strategies:
 * 1. Exact normalized matches.
 * 2. Dash/colon segment splitting for subtitles and acronyms.
 * 3. Middle segment removal (e.g., GTA London Mission Pack).
 * 4. Special parenthetical alignment for Bonus Discs.
 *
 * @param gameTitle The database game title.
 * @param releaseTitle The clean release title from the DAT file (parentheticals stripped).
 * @param rawReleaseName The raw release name from the DAT file (parentheticals intact).
 * @param platformId Optional database platform ID to handle platform-specific title mappings.
 * @returns True if the titles are considered a match, false otherwise.
 */
export function titlesMatch(
  gameTitle: string,
  releaseTitle: string,
  rawReleaseName?: string,
  platformId?: number,
): boolean {
  const PRE_SPLIT_ALIASES: Record<string, string> = {
    'final fantasy x/x-2 hd remaster':
      'final fantasy x / final fantasy x-2 / final fantasy x x-2 hd remaster',
    'super mario all-stars: limited edition': 'super mario all-stars',
    "assassin's creed chronicles: trilogy pack": "assassin's creed chronicles",
    'the amazing spider-man vs. the kingpin':
      'spider-man / spider-man vs. the kingpin / the amazing spider-man vs. the kingpin',
    "x-men: gamesmaster's legacy": "x-men - gamemaster's legacy",
    'final fantasy anthology':
      'final fantasy anthology - final fantasy v / final fantasy anthology - final fantasy vi',
    'minecraft: story mode - the complete adventure':
      'minecraft - story mode - a telltale games series - the complete adventure / minecraft - story mode - the complete adventure',
    'minecraft: story mode - season two':
      'minecraft - story mode - season two - the telltale series / minecraft - story mode - season two',
    'bioshock infinite':
      'bioshock infinite / bioshock infinite - the complete edition - bonus content disc',
  };
  const gLower = gameTitle.toLowerCase().trim();
  if (platformId === 14 && gLower === 'the amazing spider-man 2') {
    gameTitle = 'spider-man 2';
  } else if (Object.prototype.hasOwnProperty.call(PRE_SPLIT_ALIASES, gLower)) {
    gameTitle = PRE_SPLIT_ALIASES[gLower];
  }

  const gameAlts = gameTitle
    .split(/(?<!\d)[~/](?!\d)/)
    .map((s) => s.trim())
    .filter(Boolean);

  // If the game title contains alternative delimiters, also include the full unsplit title
  // as a candidate. This is crucial for matching compilation releases (e.g., "Marble Madness / Klax").
  if (gameTitle.includes('/') || gameTitle.includes('~')) {
    gameAlts.push(gameTitle);
  }

  const releaseAlts = releaseTitle
    .split(/(?<!\d)[~/](?!\d)/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const gAlt of gameAlts) {
    for (const rAlt of releaseAlts) {
      if (matchAlternative(gAlt, rAlt, rawReleaseName)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Compares a single game alternative title against a single release alternative title.
 *
 * @param gTitle Individual alternative game title.
 * @param rAlt Individual alternative release title.
 * @param rawReleaseName Raw release name (including parentheticals).
 * @returns True if they match, false otherwise.
 */
function matchAlternative(
  gTitle: string,
  rAlt: string,
  rawReleaseName?: string,
): boolean {
  const rawLower = rawReleaseName ? rawReleaseName.toLowerCase() : '';
  const gameLower = gTitle.toLowerCase();
  const isZeldaMQ = gameLower.includes('master quest');

  const gNorm = normalizeTitleForMatching(gTitle);
  const rNorm = normalizeTitleForMatching(rAlt);

  // 1. Sequel / Season number check to prevent matching base games to sequels or vice-versa.
  const isCompilation =
    gTitle.includes('/') ||
    gTitle.includes('~') ||
    rAlt.includes('/') ||
    rAlt.includes('~') ||
    /\b\d+\s+games?\s+in\s+/i.test(gTitle) ||
    /\b\d+\s+games?\s+in\s+/i.test(rAlt) ||
    /\b\d+-in-\d+\b/i.test(gTitle) ||
    /\b\d+-in-\d+\b/i.test(rAlt);

  // Determine if the titles matched via an explicit alias mapping where their
  // base, unaliased titles differ. If so, we bypass the sequel check to allow
  // manual reconciliation overrides (e.g. matching SimCopter 64 to SimCopter).
  const baseG = normalizeTitleForMatching(gTitle, true);
  const baseR = normalizeTitleForMatching(rAlt, true);
  const matchedViaAlias = gNorm === rNorm && baseG !== baseR;

  if (!isZeldaMQ && !isCompilation && !matchedViaAlias) {
    const getNumberTokens = (str: string): Set<string> => {
      const tokens = new Set<string>();
      // Normalize hyphenated dimensions like "3-D" or "2-D" to "3d" / "2d" so they are not parsed as standalone numbers
      const lower = str.toLowerCase().replace(/\b(\d+)-d\b/g, '$1d');
      const wordNumbers = [
        'one',
        'two',
        'three',
        'four',
        'five',
        'six',
        'seven',
        'eight',
        'nine',
        'ten',
        'first',
        'second',
        'third',
        'fourth',
      ];
      for (const word of wordNumbers) {
        if (new RegExp(`\\b${word}\\b`).test(lower)) {
          tokens.add(word);
        }
      }
      const romanNumerals = [
        'ii',
        'iii',
        'iv',
        'v',
        'vi',
        'vii',
        'viii',
        'ix',
        'x',
      ];
      for (const rom of romanNumerals) {
        if (new RegExp(`\\b${rom}\\b`).test(lower)) {
          tokens.add(rom);
        }
      }
      const digits = lower.match(/\b\d+\b/g);
      if (digits) {
        for (const d of digits) {
          tokens.add(d);
        }
      }
      return tokens;
    };

    const canonicalNumber = (token: string): string => {
      const map: Record<string, string> = {
        one: '1',
        first: '1',
        two: '2',
        second: '2',
        ii: '2',
        three: '3',
        third: '3',
        iii: '3',
        four: '4',
        fourth: '4',
        iv: '4',
        five: '5',
        v: '5',
        six: '6',
        vi: '6',
        seven: '7',
        vii: '7',
        eight: '8',
        viii: '8',
        nine: '9',
        ix: '9',
        ten: '10',
        x: '10',
      };
      return map[token] || token;
    };

    const gameNums = new Set(
      Array.from(getNumberTokens(gTitle)).map(canonicalNumber),
    );
    const releaseNums = new Set(
      Array.from(getNumberTokens(rAlt)).map(canonicalNumber),
    );

    // Determine the highest sequel/season number >= 2 present in either title.
    // Since we bypass the sequel check for explicit aliases, we can safely check
    // all numeric indicators (including platform numbers like 64 or years like 1969/2005)
    // to block incorrect base-to-sequel or base-to-expansion matching.
    const allNums = new Set([...gameNums, ...releaseNums]);
    const sequelNums = Array.from(allNums).filter((n) => {
      const parsed = parseInt(n, 10);
      return !isNaN(parsed) && parsed >= 2;
    });

    for (const seqNum of sequelNums) {
      const gameHas = gameNums.has(seqNum);
      const releaseHas = releaseNums.has(seqNum);
      if (gameHas !== releaseHas) {
        return false; // Mismatch on a sequel/season number
      }
    }
  }

  // 2. Enforce boundary check to prevent matching a standalone Bonus Disc, Tutorial Disc,
  // Standalone Add-on Pack, or Expansion Kit to a main game (or vice versa).
  // Parenthetical `(Bonus Disc)`, `(Bonus DVD)`, `(Bonus Content Disc)`, or `(Un CD Bonus)`
  // on a matching base title ARE allowed (for 2-disc Limited/Collector's Editions), whereas
  // standalone-title bonus discs (e.g. "Pokemon Colosseum Bonus Disc") and standalone
  // add-on/pre-order/tutorial packs are blocked.
  if (!isZeldaMQ && !matchedViaAlias) {
    const rBaseLower = rAlt.toLowerCase();
    const hasStandaloneBonusTitle = (str: string): boolean =>
      str.includes('bonus disc') ||
      (str.includes('bonus') && str.includes('disc')) ||
      str.includes('tokusei disc') ||
      str.includes('kakuchou disc');

    const isAddOnOrPromoPack = (str: string): boolean =>
      str.includes('pre-order bonus') ||
      str.includes('tokusei disc') ||
      str.includes('kakuchou disc') ||
      str.includes('tutorial disc') ||
      str.includes('(tutorial)') ||
      str.includes('add-on pack') ||
      str.includes('add-on content pack') ||
      str.includes('add-on doppelpack') ||
      str.includes('pack de expansion') ||
      str.includes('extension de jeu') ||
      str.includes('expansion kit');

    const gameIsBonusEntry = hasStandaloneBonusTitle(gameLower);
    const relFullLower = rawLower || rBaseLower;

    if (gameIsBonusEntry) {
      // A standalone Bonus Disc game entry (e.g. "Pokémon Colosseum Bonus Disc") must only match a Bonus/Tokusei/Kakuchou disc release
      if (!hasStandaloneBonusTitle(relFullLower)) {
        return false;
      }
    } else {
      // A standard game entry must not match standalone-title bonus discs (e.g. "Pokemon Colosseum Bonus Disc" or "Pokemon Colosseum (USA) (Bonus Disc)") or add-on/promo packs
      if (
        hasStandaloneBonusTitle(rBaseLower) ||
        (relFullLower.includes('pokemon colosseum') &&
          hasStandaloneBonusTitle(relFullLower)) ||
        isAddOnOrPromoPack(relFullLower)
      ) {
        return false;
      }
    }
  }

  // 3. Enforce boundary check to prevent matching a LEGO game to a non-LEGO game (or vice versa).
  const isLegoGame = /\blego\b/i.test(gTitle);
  const isLegoRelease =
    /\blego\b/i.test(rAlt) ||
    (rawReleaseName && /\blego\b/i.test(rawReleaseName));
  if (isLegoGame !== !!isLegoRelease) {
    return false;
  }

  // Strategy 1: Exact match on normalized strings (including Japanese ou/ō romanization equivalence)
  if (
    gNorm === rNorm ||
    (gNorm.length >= 6 &&
      rNorm.length >= 6 &&
      gNorm.replace(/ou/g, 'o') === rNorm.replace(/ou/g, 'o'))
  ) {
    return true;
  }

  // Do not allow parenthetical bonus discs to fuzzy-match a different base title via dash/colon splitting
  if (
    !isZeldaMQ &&
    /\bbonus\s+(?:disc|dvd|cd)\b/i.test(rawLower) &&
    !/\bbonus\b/i.test(gameLower)
  ) {
    return false;
  }

  // Exclude Metal Gear Solid - Special Missions or VR Missions from matching base Metal Gear Solid
  if (
    gNorm === 'metalgearsolid' &&
    (rNorm.includes('specialmissions') || rNorm.includes('vrmissions'))
  ) {
    return false;
  }

  // Exclude distinct sequels, spin-offs, and separate editions from matching base games via dash/colon splitting
  const hasExactAndSubstring = (exact: string, sub: string) =>
    (gNorm === exact && rNorm.includes(sub)) ||
    (rNorm === exact && gNorm.includes(sub));

  if (
    hasExactAndSubstring('shovelknight', 'treasuretrove') ||
    hasExactAndSubstring('returncastlewolfenstein', 'tideswar') ||
    hasExactAndSubstring('returncastlewolfenstein', 'operationresurrection') ||
    hasExactAndSubstring('eldenring', 'nightreign') ||
    hasExactAndSubstring('untildawn', 'rushblod') ||
    hasExactAndSubstring('walkingdead', 'survivalinstinct') ||
    hasExactAndSubstring('minecraft', 'storymode') ||
    hasExactAndSubstring('pokemonranger', 'batonnage') ||
    hasExactAndSubstring('pokemonranger', 'hikarinokiseki') ||
    hasExactAndSubstring('pokemonranger', 'shadowsalamia') ||
    hasExactAndSubstring('pokemonranger', 'guardiansigns') ||
    hasExactAndSubstring('zoneenders', 'anubis') ||
    hasExactAndSubstring('zoneenders', '2ndrunner')
  ) {
    return false;
  }

  // Strategy 2: Dash/colon segmentation split for subtitles/acronyms
  // Checks segments of both release and game titles to allow base/subtitle matches in either direction.
  // We use space-dash-space (\s+-\s+) or colon (:) to split, avoiding breaking hyphens inside words (e.g. "All-Stars" or "358-2").
  // e.g. "Tomb Raider II - Starring Lara Croft" -> matches game "Tomb Raider II"
  // e.g. "Super Mario All-Stars: Limited Edition" -> matches release "Super Mario All-Stars"
  // e.g. "Assassin's Creed Chronicles: Trilogy Pack" -> matches release "Assassin's Creed Chronicles"
  const rSegments = rAlt
    .split(/(?:\s+-\s+|:)/)
    .map((s) => s.trim())
    .filter(Boolean);
  const rSegmentNorms = rSegments.map((s) => normalizeTitleForMatching(s));

  const gSegments = gTitle
    .split(/(?:\s+-\s+|:)/)
    .map((s) => s.trim())
    .filter(Boolean);
  const gSegmentNorms = gSegments.map((s) => normalizeTitleForMatching(s));

  const GENERIC_DESCRIPTOR_NORMS = new Set([
    'collection',
    'trilogy',
    'anthology',
    'pack',
    'bundle',
    'remastered',
    'edition',
    'bonus',
    'bonusdisc',
    'disc',
    'game',
    'saga',
    'compilation',
  ]);

  const isAcronymOf = (acronym: string, fullTitle: string): boolean => {
    const cleanAcro = acronym.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (cleanAcro.length < 2 || cleanAcro.length > 6) return false;
    const words = fullTitle.split(/\s+/).filter(Boolean);
    const initials = words.map((w) => w[0].toLowerCase()).join('');
    return initials === cleanAcro || initials.startsWith(cleanAcro);
  };

  const isDescriptorSegment = (
    segment: string,
    fullTitle?: string,
  ): boolean => {
    const norm = normalizeTitleForMatching(segment);
    if (!norm) return true;
    const lower = segment.toLowerCase().trim();
    if (fullTitle && isAcronymOf(segment, fullTitle)) {
      return true;
    }
    if (
      lower.includes('add-on') ||
      lower.includes('addon') ||
      lower.includes('expansion') ||
      lower.includes('extension de jeu') ||
      lower.includes('tutorial')
    ) {
      return false;
    }
    return (
      isTrueEditionOrRevisionVariant(lower) ||
      /^(?:starring\s+.*|kawasaki.*|\d+\s+games\s+in\s+.*|vol(?:ume)?\s*\d+|pack|trilogy\s*pack|collection|anthology|remaster(?:ed)?|hd(?:\s*remaster(?:ed)?)?|bonus\s*content.*|bonus\s*disc.*)$/i.test(
        lower,
      )
    );
  };

  // Case A: The release contains the full game title as one of its segments, and all remaining segments are edition/descriptor labels.
  if (
    !GENERIC_DESCRIPTOR_NORMS.has(gNorm) &&
    gNorm.length >= 4 &&
    rSegmentNorms.includes(gNorm)
  ) {
    const unMatchedSegments = rSegments.filter(
      (s) => normalizeTitleForMatching(s) !== gNorm,
    );
    if (unMatchedSegments.every((s) => isDescriptorSegment(s, gTitle))) {
      return true;
    }
  }

  // Strategy 2.5: Swapped segments matching (e.g. "Super Mario World: Super Mario Advance 2" vs "Super Mario Advance 2 - Super Mario World")
  // If both titles split into multiple segments, they match if they contain the exact same set of normalized segments in any order.
  if (gSegmentNorms.length > 1 && rSegmentNorms.length > 1) {
    const gSet = new Set(gSegmentNorms);
    const rSet = new Set(rSegmentNorms);
    if (gSet.size === rSet.size && Array.from(gSet).every((s) => rSet.has(s))) {
      return true;
    }
  }

  // Strategy 3: Middle segment removal
  // e.g. "Grand Theft Auto - Mission Pack 1 - London 1969" -> matches "Grand Theft Auto: London 1969"
  const segments = rAlt
    .split(/\s+-\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length > 2) {
    const endsStr = segments[0] + ' ' + segments[segments.length - 1];
    const endsNorm = normalizeTitleForMatching(endsStr);
    if (gNorm === endsNorm) {
      return true;
    }
  }

  // Strategy 4: Parenthetical inclusion checks (specifically for Bonus Discs/Special Discs)
  if (rawReleaseName) {
    const isSpecialDisc =
      rawLower.includes('bonus disc') ||
      rawLower.includes('tokusei disc') ||
      rawLower.includes('kakuchou disc');

    if (isSpecialDisc) {
      if (
        gTitle.toLowerCase().includes('bonus disc') ||
        gTitle.toLowerCase().includes('bonus')
      ) {
        // Strip clean regional codes to expose clean descriptor name
        const releaseWithBonus = cleanRawRegionCodes(rawLower);
        const rBonusNorm = normalizeTitleForMatching(releaseWithBonus);
        if (gNorm === rBonusNorm) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Evaluates whether a game matches a release title using either its primary title
 * or its IGDB regional `alternative_names` (e.g. "Biohazard" for "Resident Evil",
 * "Hoshi no Kirby" for "Kirby", "Dragon Quest" for "Dragon Warrior",
 * "Doubutsu no Mori" for "Animal Crossing").
 *
 * Enforces regional compatibility so Japanese-specific alternate titles only match
 * Japanese/Asian/World releases and never collide with Western releases of different games.
 */
export function gameMatchesReleaseWithAlternatives(
  gameTitle: string,
  releaseTitle: string,
  rawReleaseName?: string,
  platformId?: number,
  alternativeNames?: Array<{ name: string; comment?: string }>,
  releaseRegion?: string | null,
): boolean {
  if (titlesMatch(gameTitle, releaseTitle, rawReleaseName, platformId)) {
    return true;
  }

  if (!alternativeNames || alternativeNames.length === 0) {
    return false;
  }

  const effectiveRegion =
    `${releaseRegion || ''} ${rawReleaseName || ''}`.toLowerCase();
  const isJapanRelease = /\b(japan|jp|jpn|asia|world)\b/i.test(effectiveRegion);
  const isEuropeRelease =
    /\b(europe|eu|eur|uk|australia|germany|france|spain|italy|netherlands|sweden|scandinavia|world)\b/i.test(
      effectiveRegion,
    );
  const isRussiaRelease = /\b(russia|russian|ru|cis)\b/i.test(effectiveRegion);
  const isChinaRelease =
    /\b(china|chinese|taiwan|hong kong|asia|world)\b/i.test(effectiveRegion);
  const isKoreaRelease = /\b(korea|korean|kor|asia|world)\b/i.test(
    effectiveRegion,
  );

  const gLower = gameTitle.toLowerCase().trim();
  const NON_LATIN_SCRIPT_REGEX =
    /[\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Greek}\p{Script=Hebrew}\p{Script=Thai}]/u;
  const releaseHasNonLatin =
    NON_LATIN_SCRIPT_REGEX.test(releaseTitle) ||
    (rawReleaseName ? NON_LATIN_SCRIPT_REGEX.test(rawReleaseName) : false);

  for (const alt of alternativeNames) {
    if (!alt?.name) continue;
    const altName = alt.name.trim();

    // Require at least 4 Latin alphanumeric characters to avoid matching CJK-only strings or short acronyms (e.g. "RE2", "DQ3")
    const alphaNum = altName.replace(/[^a-zA-Z0-9]/g, '');
    if (alphaNum.length < 4) continue;

    const commentLower = (alt.comment || '').toLowerCase();
    if (
      commentLower.includes('acronym') ||
      commentLower.includes('abbreviation') ||
      commentLower.includes('working title')
    ) {
      continue;
    }

    // Special guard: "Super Mario Bros.: The Lost Levels" has Japanese title "Super Mario Bros. 2",
    // which must NEVER match the Western NES cartridge "Super Mario Bros. 2 (USA)".
    if (
      gLower.includes('lost levels') &&
      normalizeTitleForMatching(altName) === 'supermariobros2'
    ) {
      if (platformId !== 54 || !isJapanRelease) {
        continue;
      }
    }

    const isJapaneseComment =
      commentLower.includes('japanese') || commentLower.includes('japan');
    const isEuropeanComment =
      commentLower.includes('europe') ||
      commentLower.includes('pal') ||
      commentLower.includes('uk') ||
      commentLower.includes('australian') ||
      commentLower.includes('german') ||
      commentLower.includes('french') ||
      commentLower.includes('spanish') ||
      commentLower.includes('italian');
    const isRussianComment =
      commentLower.includes('russian') || commentLower.includes('russia');
    const isChineseComment =
      commentLower.includes('chinese') ||
      commentLower.includes('china') ||
      commentLower.includes('taiwan') ||
      commentLower.includes('hong kong');
    const isKoreanComment =
      commentLower.includes('korean') || commentLower.includes('korea');

    if (isJapaneseComment && !isJapanRelease) {
      continue;
    }
    if (isEuropeanComment && !isEuropeRelease) {
      continue;
    }
    if (isRussianComment && !isRussiaRelease) {
      continue;
    }
    if (isChineseComment && !isChinaRelease) {
      continue;
    }
    if (isKoreanComment && !isKoreaRelease) {
      continue;
    }

    // Non-Latin Subtitle Stripping Guard:
    // If an alternative name contains non-Latin scripts (Cyrillic, CJK, etc.) but the release contains
    // no non-Latin characters, normalizer would strip the non-Latin subtitle/segment and collapse it into
    // a base franchise title (e.g. "Tomb Raider: Последнее откровение" -> "tombraider").
    if (NON_LATIN_SCRIPT_REGEX.test(altName) && !releaseHasNonLatin) {
      continue;
    }

    if (titlesMatch(altName, releaseTitle, rawReleaseName, platformId)) {
      return true;
    }
  }

  return false;
}

const COMPILATION_OR_BUNDLE_RE =
  /\b(?:trilogy|quadrilogy|duology|collections?|antholog(?:y|ies)|essentials|superpack|double pack|dual pack|combo pack|box\s*set|\d+[- ]in[- ]1|\d+\s+games?\s+in\s+|all[- ]stars|classics|replay|archives|heritage|compilation)\b|\+|\//i;

/**
 * Identifies multi-game compilation packs, anthologies, or dual-game cartridges whose
 * releases can legitimately share ROM CRCs with standalone entries of the included titles.
 */
export function isCompilationOrBundleTitle(title: string): boolean {
  if (!title) return false;
  return COMPILATION_OR_BUNDLE_RE.test(title);
}

/**
 * Removes standard regional identifiers in parentheses from a raw release string.
 *
 * @param str The raw release name in lowercase.
 * @returns The string with standard regional parentheses removed.
 */
function cleanRawRegionCodes(str: string): string {
  return str
    .replace(
      /\((usa|europe|japan|germany|france|australia|italy|spain|canada|korea|world|uk|brazil|asia|en|fr|de|es|it|ja|nl)\)/g,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

const BOUTIQUE_CATALOG_PREFIX_RE =
  /^(?:LRG|SRG|SLG|RAG|FPG|PEG|Strictly Limited(?:\s+Games)?|Limited Run(?:\s+Games)?|Super Rare(?:\s+Games)?|Red Art(?:\s+Games)?|Special Reserve(?:\s+Games)?|Premium Edition(?:\s+Games)?(?:\s+Series\s+\d+)?)\s*#?\s*\d+(?:\s*(?:&|and|\/|-)\s*#?\s*\d+)?\s*[:-]?\s*/i;

/**
 * Strips leading boutique store catalog prefixes (e.g. "LRG #500: ",
 * "Limited Run #273: ", "SRG #120: ", "Limited Run #336 & #337: ").
 */
export function stripBoutiqueCatalogPrefix(
  title: string,
  options: { stripPreOrderPrefix?: boolean } = {},
): string {
  if (!title) return '';
  let out = title;
  if (options.stripPreOrderPrefix) {
    out = out.replace(/^\[?\s*pre-?order\s*\]?\s*[:-]?\s*/i, '');
  }
  return out
    .replace(/^BACKERS\s*[-:]\s*DE#\d+\s*[-:]?\s*/i, '')
    .replace(BOUTIQUE_CATALOG_PREFIX_RE, '')
    .trim();
}

const LGN_PIPE_PLATFORM_TOKEN =
  '(?:(?:Nintendo\\s+)?Switch(?:\\s+2)?|NSW2?|PlayStation\\s*[1-5]|PS[1-5]|PlayStation\\s*Vita|PS\\s*Vita|PSVR2?|Xbox\\s+Series\\s+[XS](?:[|/]S)?|Xbox\\s+One|3DS)';

/**
 * Strips trailing pipe-delimited platform lists emitted in news headlines
 * (e.g. "Game | PlayStation 5, , Xbox Series X|S") without stripping legitimate
 * multi-game bundle separators like "Game A | Game B".
 */
export function stripLgnPlatformPipeTrailer(title: string): string {
  if (!title) return '';
  return title
    .replace(
      new RegExp(
        `\\s*\\|(?:\\s*,|\\s*\\/|\\s*&|\\s+and\\b|\\s+)*(?:${LGN_PIPE_PLATFORM_TOKEN})(?:\\s*,|\\s*\\/|\\s*&|\\s+and\\b|\\s+|${LGN_PIPE_PLATFORM_TOKEN})*$`,
        'i',
      ),
      '',
    )
    .replace(/\s*\|\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const RETAIL_TRAILING_PLATFORM_PATTERN =
  '(?:(?:\\((?:PS[1-5]|PSV|PSVR2?|XB1|XSX|NSW2?)\\)\\s*)?(?:Sony\\s+PlayStation\\s*VR2?|PlayStation\\s*VR2|PSVR2|PlayStation\\s*VR|PSVR|Play(?:Station|sation)\\s*[12345]|PS[12345]|PlayStation\\s*Vita|PS\\s*Vita|Vita|PlayStation\\s*Portable|PSP|Nintendo\\s*Switch\\s*2?|Switch\\s*2?|NSW2?|Nintendo\\s*3DS|3DS|Nintendo\\s*DS|NDS|DS|Wii\\s*U|Nintendo\\s*Wii|Wii|Xbox\\s*Series\\s*[XS](?:\\|[XS])?|XSX|Xbox\\s*One|XB1|Xbox\\s*360|Sega\\s*Dreamcast|Dreamcast))';

const RETAIL_MERCH_ADDON_SUFFIX_RE =
  /\s*(?:\+\s*store\s+exclusive\b.*|\(\s*with\s+exclusive\b[^)]*\)|\s+(?:(?:collector['’]?s?\s+edition\s+)?plushie|special\s+book|book|yunomi\s+cup\s+(?:ce|le)|nendoroid\s+(?:ce|le))\s+bundle\b.*)$/i;

/**
 * Strips single-game storefront merchandise add-ons (e.g. "+ Store Exclusive Key Art Stand",
 * "(With Exclusive MTG FF Promo Card)", "Plushie Bundle", "Book Bundle") without rejecting
 * the underlying physical release so it matches and verifies the base game cleanly.
 */
export function stripMerchAddonSuffix(title: string): string {
  if (!title) return '';
  let out = title.trim();
  for (let i = 0; i < 3; i++) {
    const next = out.replace(RETAIL_MERCH_ADDON_SUFFIX_RE, '').trim();
    if (next === out) break;
    out = next;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Moves a trailing inverted English article (", The", ", A", ", An") to the front
 * so downstream edition extraction and IGDB lookup see natural word order.
 */
const INVERTED_ARTICLE_RE =
  /^(.{3,}?),\s+(The|A|An|Le|La|Les|L'|El|Los|Las|Un|Una|Der|Die|Das|Ein|Eine|Il|Lo|Gli)\s*$/i;

/**
 * Moves a trailing inverted catalog article (", The", ", A", ", An", ", Le", ", La",
 * ", El", ", Der", etc.) to the front so edition extraction and IGDB lookup see natural word order.
 */
export function normalizeInvertedArticle(title: string): string {
  const trimmed = (title || '').trim();
  const match = trimmed.match(INVERTED_ARTICLE_RE);
  if (!match) return trimmed;
  const stem = match[1].trim();
  const article = match[2];
  return article.endsWith("'") ? `${article}${stem}` : `${article} ${stem}`;
}

/**
 * Strips trailing preorder/ship-date notices and trailing retail platform
 * suffixes (including "Sony PlayStation VR" and store typos like "Playsation 5").
 */
export function stripRetailPreorderAndPlatformTrailer(title: string): string {
  if (!title) return '';
  let out = title
    .replace(/^BACKERS\s*-\s*DE#\d+\s*:\s*/i, '')
    .replace(/\s*\[PREMIUM\s+EDITION\s+GAMES\s+SERIES\s+\d+\]\s*/gi, ' ')
    .replace(/\s*\[SW\d+\]\s*/gi, ' ')
    .replace(/\s*-\s*XBOX\s+SMART\s*-\s*SERIES\s+X\s*&\s*XB1\b.*$/i, '')
    .replace(/\s*\((?:ASIM|Multi-Lan(?:guage|ugage))\)\s*/gi, ' ')
    .replace(
      /\s*(?:[-–—]\s*)?\bPRE-?ORDER(?:\s*[-–—]\s*ESTIMATED\s+SHIP\s+DATE\b.*)?$/i,
      '',
    )
    .replace(/\s*[-–—]?\s*ESTIMATED\s+SHIP\s+DATE\b.*$/i, '')
    .replace(
      new RegExp(
        `\\s*[-–—]\\s*${RETAIL_TRAILING_PLATFORM_PATTERN}(?:\\s*[/|]?\\s*${RETAIL_TRAILING_PLATFORM_PATTERN})*\\s*$`,
        'i',
      ),
      '',
    )
    .replace(
      new RegExp(`\\s*\\[${RETAIL_TRAILING_PLATFORM_PATTERN}\\]\\s*$`, 'i'),
      '',
    )
    .replace(
      new RegExp(`\\s*\\(${RETAIL_TRAILING_PLATFORM_PATTERN}\\)\\s*$`, 'i'),
      '',
    );
  out = stripMerchAddonSuffix(out);
  out = normalizeInvertedArticle(out);
  return out
    .replace(/\s*Standard Edition\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strips common edition suffixes, subtitles, and DLC add-on phrases from titles
 * so base releases can match their canonical cartridge dumps.
 */
const SHARED_EDITION_QUALIFIERS: readonly string[] = [
  'crewmate',
  'definitive',
  'deluxe',
  'ultra\\s+deluxe',
  'ultimate',
  'complete',
  'standard',
  'special',
  'steelbook',
  "collector'?s?",
  'anniversary',
  '\\d+(?:st|nd|rd|th)\\s+anniversary',
  'remastered',
  'legacy',
  'hd',
  'plus',
  'plortable',
  'archaeologist',
  'hero',
  'crafted',
  'ancestral',
  'the\\s+radical\\s+dreamers',
  'gourmet',
  'enhanced',
  'nintendo\\s+switch(?:\\s*2)?',
  '(?<!Nintendo\\s)Switch\\s*2',
  'xbox\\s*one',
  'deathinitive',
  'warmastered',
  'return\\s+to\\s+castlevania',
  'owltimate',
  'fully\\s+yoked',
  'tv',
  "the\\s+prince'?s?",
  'year\\s+(?:one|1)',
  "prisoner'?s?",
  'sunset',
  'trapezoid',
  'day\\s+(?:one|1)',
  'launch',
  'premium',
  'limited',
  'iam8bit\\s+exclusive',
  'playstation\\s+hits',
  'nintendo\\s+hits',
  "player'?s?\\s+choice",
  'greatest\\s+hits',
  'platinum\\s+hits',
  'nes',
];

const EXTRA_SPACE_EDITION_QUALIFIERS: readonly string[] = [
  ...SHARED_EDITION_QUALIFIERS,
  'retail',
  'royal',
  'next\\s+level',
  'gold',
  'platinum',
  'silver',
  'goty',
  'game\\s+of\\s+the\\s+year',
  'expanded',
  "director'?s?",
];

const SHARED_EDITION_GROUP = `(?:${SHARED_EDITION_QUALIFIERS.join('|')})`;
const EXTRA_SPACE_EDITION_GROUP = `(?:${EXTRA_SPACE_EDITION_QUALIFIERS.join('|')})`;

const DELIMITED_EDITION_STRIP_RE = new RegExp(
  `\\s*(?::|[-–—])\\s*${SHARED_EDITION_GROUP}\\s*editions?`,
  'gi',
);
const SPACE_EDITION_STRIP_RE = new RegExp(
  `\\s+${SHARED_EDITION_GROUP}\\s+editions?`,
  'gi',
);
const WRAPPER_EDITION_STRIP_RE = new RegExp(
  `\\s*(?:[:\\-–—|]\\s*)?${EXTRA_SPACE_EDITION_GROUP}\\s+editions?$`,
  'i',
);

const NON_ENGLISH_EDITION_RE =
  /\b(?:goldene|silberne|kristall|rote|blaue|gelbe|smaragd|rubin|saphir|feuerrote|blattgr(?:u|ü)ne|speciale|edici[oó]n|edizione|ausgabe|auflage)\b/i;

export function stripEditionSuffix(title: string): string {
  const norm = (title || '')
    .replace(/[\u2018\u2019\u201B\u2032`]/g, "'")
    .replace(
      /\s*\((?:retail|standard|limited|collector'?s?|deluxe|special)\s+editions?\)\s*$/i,
      '',
    );
  return norm
    .replace(DELIMITED_EDITION_STRIP_RE, '')
    .replace(SPACE_EDITION_STRIP_RE, '')
    .replace(
      /\s*(?:[,:\-–—]\s*)?\b(?:a|the)\s+telltale(?:\s+games)?\s+series\b/gi,
      '',
    )
    .replace(/:\s*(?:ultra\s+)?deluxe$/i, '')
    .replace(/\s*\+\s*the hidden treasure of area zero/gi, '')
    .replace(/\s*\+\s*booster course pass/gi, '')
    .replace(/\s*\+\s*expansion pass/gi, '')
    .replace(/\s*\+\s*star-crossed world/gi, '')
    .replace(/\s*\+\s*jamboree tv/gi, '')
    .replace(/\s*\+\s*arcade game series$/gi, '')
    .trim();
}

const SHEET_TYPO_FIXES: Array<[RegExp, string]> = [
  [/\bdot\s+hack\b/gi, '.hack'],
  [/\btelllate\b/gi, 'telltale'],
  [/\bantbos\b/gi, 'anthos'],
  [/\bgamemaster'?s\s+legacy\b/gi, "gamesmaster's legacy"],
  [/\bstrangers\s+wrath\b/gi, "stranger's wrath"],
  [/\bdirectors\s+cut\b/gi, "director's cut"],
  [/\bsmartrer\b/gi, 'smarter'],
  [/\bseriex\b/gi, 'series'],
  [/\bedtion\b/gi, 'edition'],
  [/\bachemist\b/gi, 'alchemist'],
  [/\bamasterasu\b/gi, 'amaterasu'],
  [/\bbridandine\b/gi, 'brigandine'],
  [/\bclive\s+baker'?s\b/gi, "clive barker's"],
  [/\blife\s+of\s+p\s*:/gi, 'lies of p:'],
  [/\borien\s+express\b/gi, 'orient express'],
  [/\baxle\s+city\b/gi, 'axel city'],
  [/\bakeaka\s+neogeo\b/gi, 'aca neogeo'],
  [/\btales\s+of\s+iron\b/gi, 'tails of iron'],
  [/\badventure\s+of\s+krypto\b/gi, 'adventures of krypto'],
  [
    /\blike\s+a\s+dragon\s+the\s+man\s+who\s+erased\s+his\s+name\b/gi,
    'like a dragon gaiden: the man who erased his name',
  ],
];

const DAT_PUBLISHER_PREFIX_RULES: readonly RegExp[] = [
  /^(?:famicom\s+mini(?:\s+series)?\s*\d*\s*[:-]\s*)/i,
  /^(?:classic\s+nes\s+series\s*[:-]\s*)/i,
  /^(?:simple\s+(?:1500|2000|2500|ds)\s+series(?:\s+vol\.?\s*\d+)?(?:\s+the\s+[^:-]+)?\s*[:-]\s*)/i,
  /^(?:superlite\s+(?:1500|2000)(?:\s+series)?\s*[:-]\s*)/i,
  /^(?:road\s*&\s*track\s+presents\s*[:-]\s*)/i,
  /^(?:hudson\s+selection\s+vol\.?\s*\d+\s*[:-]\s*)/i,
  /^(?:(?:konami|playstation)\s+the\s+best|psone\s+books|ea\s+best\s+selections|major\s+wave\s+series|value\s+1500)\s*[:-]\s*/i,
];

/**
 * Cleans store/feed framing, budget-reissue prefixes, and verified sheet typos
 * prior to IGDB querying and matching without altering base game semantics.
 */
export function cleanTitleForIgdbLookup(rawTitle: string): string {
  let out = (rawTitle || '')
    .replace(/[\u2018\u2019\u201B\u2032`]/g, "'")
    .replace(/[™®]/g, '')
    .trim();
  if (!out) return '';

  out = stripBoutiqueCatalogPrefix(out, { stripPreOrderPrefix: true });
  out = stripLgnPlatformPipeTrailer(out);
  out = stripRetailPreorderAndPlatformTrailer(out);

  for (const prefixRule of DAT_PUBLISHER_PREFIX_RULES) {
    out = out.replace(prefixRule, '');
  }

  for (const [rx, repl] of SHEET_TYPO_FIXES) {
    out = out.replace(rx, repl);
  }

  return out
    .replace(
      /\b(collection|trilogy|anthology)\s+(?:triple|double|twin)\s+pack\s*$/i,
      '$1',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Repeatedly strips stacked physical editions, remaster/remake wrappers, cuts,
 * and platform-edition suffixes (e.g. "...: Definitive Edition - Nintendo Switch 2 Edition")
 * down to the canonical IGDB base game title.
 *
 * By default (`allowBareSpecial = false`), bare trailing `"Special"` without `"Edition"`
 * or `" - Special"` is NOT stripped so retro sequels like "Real Bout Fatal Fury Special"
 * never collapse onto base "Real Bout Fatal Fury". Pass `allowBareSpecial: true` on
 * modern consoles / Tier 2 candidate wrappers (e.g. "Rune Factory 3 Special").
 */
export function stripIgdbEditionWrapper(
  title: string,
  options: { allowBareSpecial?: boolean } = {},
): string {
  let current = cleanTitleForIgdbLookup(title);
  if (!current) return '';

  for (let pass = 0; pass < 4; pass++) {
    const before = current;
    current = stripEditionSuffix(current);
    const splitEd = splitTitleEditionSuffix(current);
    if (
      splitEd &&
      splitEd.base.length >= 2 &&
      !splitEd.suffix.startsWith('+')
    ) {
      current = splitEd.base;
    }
    const structuralDelimitedEdition = current.match(
      /^(.{3,}?)\s*(?::|\s+[-–—]\s+)\s*((?:[^\s:\-–—]+\s+){0,3}[^\s:\-–—]+\s+Editions?)$/i,
    );
    if (
      structuralDelimitedEdition &&
      !NON_ENGLISH_EDITION_RE.test(structuralDelimitedEdition[2])
    ) {
      current = structuralDelimitedEdition[1].trim();
    }
    current = current
      .replace(
        /\s*\((?:retail|standard|limited|collector'?s?|deluxe|special)\s+editions?\)\s*$/i,
        '',
      )
      .replace(WRAPPER_EDITION_STRIP_RE, '')
      .replace(
        /\s*(?:[:\-–—|]\s*)?(?:The\s+)?(?:Final\s+Cut|Director'?s?\s+Cut|Extended\s+Cut|HD\s+Remaster(?:ed)?|Remastered|Remake|Game\s+of\s+the\s+Year|GOTY)$/i,
        '',
      )
      .replace(
        /\s*(?:(?:[:\-–—]\s*|\s+)SE\b)?\s*(?:[:\-–—]\s*|\s+)Complete$/i,
        '',
      )
      .replace(
        options.allowBareSpecial
          ? /\s*(?:[:\-–—]\s*|\s+)Special$/i
          : /\s*(?:[:\-–—]\s+)Special$/i,
        '',
      )
      .replace(/\s+HD$/i, '')
      .replace(/\s*[:\-–—|]\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (current === before || current.length < 2) break;
  }

  return current;
}

const ROMAN_SEQUEL_MAP: Record<string, string> = {
  ii: '2',
  iii: '3',
  iv: '4',
  vi: '6',
  vii: '7',
  viii: '8',
  ix: '9',
  xi: '11',
  xii: '12',
  xiii: '13',
  xiv: '14',
  xv: '15',
  xvi: '16',
  xvii: '17',
  xviii: '18',
  xix: '19',
  xx: '20',
};

export function normalizeSafeSequelNumerals(text: string): string {
  // Never rewrite leading "I" ("I Am Setsuna", "I, Robot") — only normalize "I" -> "1"
  // when preceded by an explicit sequential noun or at the end after a title word.
  let out = text
    .replace(/\b(episode|part|vol\.?|volume|chapter|act|no\.?)\s+i\b/gi, '$1 1')
    .replace(/\b([a-z]{3,})\s+i\s*$/gi, '$1 1');

  out = out.replace(
    /\b(ii|iii|iv|vi|vii|viii|ix|xi|xii|xiii|xiv|xv|xvi|xvii|xviii|xix|xx)\b/gi,
    (m) => ROMAN_SEQUEL_MAP[m.toLowerCase()] || m,
  );
  return out;
}

/**
 * Returns true if two titles have compatible ordered sequel numbers (e.g. "Final Fantasy VII"
 * and "Final Fantasy 7", or base "Persona 5" and "Persona 5 Royal"), and false when either
 * contains conflicting or extra sequel numbers ("Persona 4" vs "Persona 5", "Hades" vs "Hades II").
 */
export function areCanonicalTitlesSequelCompatible(
  titleA: string,
  titleB: string,
): boolean {
  const sigA = extractTitleSequelSignature(titleA);
  const sigB = extractTitleSequelSignature(titleB);
  if (sigA.length !== sigB.length) return false;
  return sigA.every((tok, idx) => tok === sigB[idx]);
}

/**
 * Builds ordered, deduplicated normalized keys for non-DAT canonical matching & linking:
 * exact normalized title, Roman/Arabic + Volume/Vol. normalized variant, and
 * edition-stripped base variants (Switch 2 Edition, Complete, Ultra Deluxe, etc.).
 */
export function buildCanonicalLinkerMatchKeys(title: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const addKey = (candidate: string | null | undefined) => {
    const trimmed = (candidate || '').trim();
    if (!trimmed) return;
    const direct = normalizeTitleForMatching(trimmed);
    if (direct && !seen.has(direct)) {
      seen.add(direct);
      keys.push(direct);
    }
    const numeralVol = normalizeTitleForMatching(
      normalizeSafeSequelNumerals(trimmed.replace(/\bvolume\b/gi, 'vol')),
    );
    if (numeralVol && !seen.has(numeralVol)) {
      seen.add(numeralVol);
      keys.push(numeralVol);
    }
  };

  addKey(title);
  const raw = title || '';
  const conservativeStrips: RegExp[] = [
    /[,:\-–—]?\s*\b(?:a|the)\s+telltale(?:\s+games)?\s+series\b/gi,
    /\s*(?:[:\-–—]\s*|\s+)(?:hd\s+)?remaster(?:ed)?$/i,
    /\s*\([^()]*\bcover\s+art\s*\)\s*$/i,
    /\s*(?:\((?:game|disc|cartridge|cart)\s+only\)|(?:[:\-–—]\s*|\s+)(?:game|disc|cartridge|cart)\s+only)\s*$/i,
    /\s*\([^()]{2,40}?\s+editions?\)\s*$/i,
    /\s*\[(?:retro|limited|collector'?s?|special|deluxe)\s+edition\]\s*$/i,
    /\s*(?:[:\-–—]\s*|\s+)trilogy\s+pack\s*$/i,
    /^(?:2\s+games\s+in\s+one!?|2\s+in\s+1\s+game\s+pack|2\s+game\s+bundle)\s*[-:]\s*/i,
    /\s+\b(?:premium|collector'?s?|treasure)\s+box\s*$/i,
  ];
  for (const rx of conservativeStrips) {
    const stripped = normalizeInvertedArticle(raw).replace(rx, '').trim();
    if (stripped && stripped !== raw && stripped.length >= 2) {
      addKey(stripped);
    }
  }
  const normalizedRaw = normalizeInvertedArticle(stripMerchAddonSuffix(raw));
  if (normalizedRaw && normalizedRaw !== raw) {
    addKey(normalizedRaw);
  }
  const splitEd = splitTitleEditionSuffix(normalizedRaw);
  if (splitEd && !splitEd.suffix.startsWith('+')) {
    addKey(splitEd.base);
  }
  addKey(stripEditionSuffix(normalizedRaw));
  addKey(stripIgdbEditionWrapper(normalizedRaw));

  return keys;
}

/**
 * Extracts ordered sequel numerals from a game title after filtering out platform
 * numbers (e.g. Switch 2, PS5, N64, 3DS, Xbox 360) and anniversary counts so
 * mismatched sequels ("Persona 4" vs "Persona 5") are strictly rejected.
 */
export function extractTitleSequelSignature(title: string): string[] {
  let s = cleanTitleForIgdbLookup(title).toLowerCase();
  if (!s) return [];

  // Strip parentheticals/brackets and platform designations that carry numbers
  s = s
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(
      /\b(?:nintendo\s+switch\s*2|switch\s*2|nsw2|play(?:station|sation)\s*[1-5]|ps[1-5]|psvr2?|3ds|n64|3do|64dd|xbox\s*360|simple\s+(?:1500|2000|2500)|superlite\s+(?:1500|2000))\b/gi,
      ' ',
    )
    .replace(/\b\d+(?:st|nd|rd|th)\s+anniversary\b/gi, ' ');

  s = normalizeSafeSequelNumerals(s);
  const tokens = s.match(/\b\d+\b/g) || [];
  return tokens.map((t) => String(parseInt(t, 10)));
}

/**
 * Enhanced title normalization specifically for IGDB candidate comparison.
 * Preserves DAT backward compatibility by leaving `normalizeTitleForMatching`
 * untouched while resolving safe Roman/Arabic numerals, mid-title platform tags,
 * apostrophe-s normalization, and preserving version/publisher qualifiers
 * ("Capcom Version" vs "SNK Version") so distinct editions never collide.
 */
export function normalizeForIgdbMatch(title: string): string {
  let t = cleanTitleForIgdbLookup(title);
  if (!t) return '';

  // Strip mid-title platform token directly before a subtitle delimiter ("Harvest Moon DS - ...")
  t = t
    .replace(
      /\b(?:ds|3ds|gba|gbc|n64|nes|snes|ps1|ps2|ps3|ps4|ps5|wii(?:\s+u)?|switch(?:\s+2)?|xbox)\s*(?=[:\-–—])/gi,
      ' ',
    )
    .toLowerCase();

  t = t
    .replace(/[\u2018\u2019\u201B\u2032`]/g, "'")
    .replace(/'s\b/gi, 's')
    .replace(/&/g, 'and')
    .replace(/\$/g, 's')
    .replace(/\bchapter\b/gi, 'ch')
    .replace(/oo/g, 'o')
    .replace(/uu/g, 'u')
    .replace(/cch/g, 'tch')
    .replace(/mega\s+man/g, 'megaman')
    .replace(/pac\s+man/g, 'pacman')
    .replace(/super\s+mario/g, 'supermario');

  t = normalizeSafeSequelNumerals(t);
  t = t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(ds|gba|gbc|n64|nes|snes|ps3|ps2|ps1|wii|xbox|3ds)\b$/gi, '')
    .replace(/\b(the|a|an|and|in|of|for|with|on|at|to|by|or|from)\b/gi, '');

  return t
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .join('');
}

export interface IgdbMatchVariant {
  title: string;
  isTildeHalf: boolean;
}

/**
 * Generates ordered, deduplicated title query/comparison variants for IGDB resolution:
 * cleaned full title, split dual-region ` ~ ` halves, edition-stripped base title,
 * and `A - B` <-> `B: A` subtitle-swapped variants.
 */
export function buildIgdbMatchVariants(
  rawTitle: string,
  options: { allowBareSpecial?: boolean; splitSlashAliases?: boolean } = {},
): string[] {
  return buildDetailedIgdbMatchVariants(rawTitle, options).map((v) => v.title);
}

/**
 * Variant generator preserving metadata on whether each candidate originated from
 * a ` ~ ` dual-region split so 1-word generic regional halves cannot match vague aliases.
 */
export function buildDetailedIgdbMatchVariants(
  rawTitle: string,
  options: { allowBareSpecial?: boolean; splitSlashAliases?: boolean } = {},
): IgdbMatchVariant[] {
  const variants: IgdbMatchVariant[] = [];
  const seen = new Set<string>();
  const add = (val: string, isTildeHalf: boolean) => {
    const trimmed = val.replace(/\s+/g, ' ').trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      variants.push({ title: trimmed, isTildeHalf });
    }
  };

  const cleaned = cleanTitleForIgdbLookup(rawTitle);
  if (!cleaned) return variants;

  const halves = cleaned
    .split(/\s+~\s+/)
    .map((h) => h.trim())
    .filter(Boolean);
  const hasTilde = halves.length > 1;

  add(cleaned, false);
  for (const half of halves) {
    add(half, hasTilde);
    if (/\bpes\s*\d{2,4}\b/i.test(half)) {
      add(
        half.replace(/\bpes\s*(\d{2,4})\b/gi, 'Pro Evolution Soccer $1'),
        hasTilde,
      );
    } else if (/\bpro\s+evolution\s+soccer\s+\d{2,4}\b/i.test(half)) {
      add(
        half.replace(/\bpro\s+evolution\s+soccer\s+(\d{2,4})\b/gi, 'PES $1'),
        hasTilde,
      );
    }
    if (options.splitSlashAliases && /\s+\/\s+/.test(half)) {
      for (const slashHalf of half.split(/\s+\/\s+/)) {
        const s = slashHalf.trim();
        if (s.length >= 3) add(s, true);
      }
    }
    const singleSplit = splitTitleEditionSuffix(half);
    if (singleSplit && !singleSplit.suffix.startsWith('+')) {
      add(singleSplit.base, hasTilde);
    }
    const singleStrip = stripEditionSuffix(half);
    if (singleStrip && singleStrip.length >= 2) {
      add(singleStrip, hasTilde);
    }
    const base = stripIgdbEditionWrapper(half, options);
    if (base && base.length >= 2) {
      add(base, hasTilde);
    }

    // Generate A - B <-> B: A swap for single-separator subtitled releases
    const sepMatch = half.match(/^([^:–—-]+?)\s*(?::|\s+[-–—]\s+)\s*(.+)$/);
    if (
      sepMatch &&
      !sepMatch[2].includes(' - ') &&
      !sepMatch[2].includes(': ')
    ) {
      const a = sepMatch[1].trim();
      const b = sepMatch[2].trim();
      if (a.length >= 3 && b.length >= 3) {
        add(`${b}: ${a}`, hasTilde);
      }
    }
  }

  return variants;
}

const PLUS_ADDON_KEYWORD_RE =
  /\b(?:pass|expansion|booster|treasure|world|tv|minions|fury|story|chapter|dlc|content|island|quest|season|pack|episode|adventure)\b/i;

const RETAIL_BRACKET_EDITION_RE =
  /\s*\[((?:Retro|Limited|Collector'?s?|Special|Deluxe)\s+Edition)\]\s*$/i;

const SPACE_EDITION_RE = new RegExp(
  `^(.{3,}?[^\\s:\\-–—])\\s+(${EXTRA_SPACE_EDITION_GROUP}\\s+Edition|(?:Premium|Collector'?s?|Treasure)\\s+Box)$`,
  'i',
);

const NAMED_EDITION_CUT_RE =
  /^(.{3,}?)(?:\s*[:\-–—]\s*|\s+)(Director'?s?\s+Cut|Extended\s+Cut|GOTY|Complete\s+Adventure|Expansion\s+Pass|Treasure\s+Trove|Connected|Tamriel\s+Unlimited|Remastered|HD\s+Remaster)$/i;

const RETAIL_PAREN_EDITION_RE =
  /\s*\(((?:Retail|Standard|Limited|Collector'?s?|Deluxe|Special)\s+Editions?)\)\s*$/i;

const PLATFORM_EDITION_ONLY_RE =
  /^(?:Nintendo\s+Switch(?:\s*2)?|Switch\s*2|Xbox\s*One)\s+Editions?$/i;

const STANDALONE_CONTENT_EDITION_RE =
  /^(?:Director'?s?\s+Cut|Extended\s+Cut|Remastered|HD\s+Remaster|Remake|Final\s+Cut|Complete\s+Adventure|Expansion\s+Pass|Treasure\s+Trove|Connected|Tamriel\s+Unlimited)$/i;

function splitTitleEditionSuffix(
  title: string,
): { base: string; suffix: string } | null {
  const trimmed = (title || '').trim();
  if (!trimmed) return null;

  // 1. Physical cart/disc DLC bundle suffix ("Pokemon Scarlet + The Hidden Treasure of Area Zero")
  const plusMatch = trimmed.match(/^(.{4,}?)\s+(\+\s+.+)$/);
  if (plusMatch) {
    const base = plusMatch[1].trim();
    const suffix = plusMatch[2].trim();
    if (
      !isCompilationOrBundleTitle(base) &&
      PLUS_ADDON_KEYWORD_RE.test(suffix)
    ) {
      return { base, suffix };
    }
  }

  // 2. Separator-delimited English "... Edition" ("Game: Special Edition", "... - Nintendo Switch 2 Edition")
  // vs space-delimited ("Sonic Racing: CrossWorlds Year 1 Edition"): if both match, prefer whichever leaves the longer base title.
  const sepEditionMatch = trimmed.match(
    /^(.{3,}?)\s*[:\-–—]\s*([^:\-–—]+\bEdition)$/i,
  );
  const spaceEditionMatch = trimmed.match(SPACE_EDITION_RE);
  if (
    spaceEditionMatch &&
    !NON_ENGLISH_EDITION_RE.test(spaceEditionMatch[2].trim()) &&
    (!sepEditionMatch ||
      spaceEditionMatch[1].trim().length > sepEditionMatch[1].trim().length)
  ) {
    return {
      base: spaceEditionMatch[1].trim(),
      suffix: spaceEditionMatch[2].trim(),
    };
  }
  if (sepEditionMatch) {
    const base = sepEditionMatch[1].trim();
    const suffix = sepEditionMatch[2].trim();
    if (
      suffix.split(/\s+/).length <= 6 &&
      !NON_ENGLISH_EDITION_RE.test(suffix)
    ) {
      return { base, suffix };
    }
  }
  if (spaceEditionMatch) {
    const base = spaceEditionMatch[1].trim();
    const suffix = spaceEditionMatch[2].trim();
    if (!NON_ENGLISH_EDITION_RE.test(suffix)) {
      return { base, suffix };
    }
  }

  // 4. Recognized physical edition/cut qualifiers without the word "Edition"
  const namedMatch = trimmed.match(NAMED_EDITION_CUT_RE);
  if (namedMatch) {
    const base = namedMatch[1].trim();
    const suffix = namedMatch[2].trim();
    if (base.length >= 3 && !NON_ENGLISH_EDITION_RE.test(suffix)) {
      return { base, suffix };
    }
  }

  return null;
}

/**
 * Extracts a trailing physical edition, DLC add-on, or platform-edition suffix
 * from a game title while ignoring localized non-English edition tags.
 */
export function extractEditionSuffix(title: string): string | null {
  return splitTitleEditionSuffix(title)?.suffix ?? null;
}

/**
 * Separates retail/packaging edition wrappers (e.g. `Year One Edition`, `Day One Edition`,
 * `Premium Edition`, `Collector's Edition`, `iam8bit Exclusive Edition`, `(Retail Edition)`)
 * from a canonical title so verification feeds attach editions via `game_releases.variants`
 * onto the base game rather than creating unlinked duplicate `games` rows.
 *
 * Preserves non-English titles (`Pokemon - Goldene Edition`), standalone platform editions
 * (`Nintendo Switch 2 Edition`), remasters/cuts (`Remastered`, `Director's Cut`), and `+` DLC.
 */
export function extractPhysicalEditionForVariant(rawTitle: string): {
  baseTitle: string;
  edition: string | null;
} {
  const preCleaned = stripRetailPreorderAndPlatformTrailer(
    (rawTitle || '').replace(/\s+/g, ' ').trim(),
  );
  if (!preCleaned) return { baseTitle: '', edition: null };

  // Strip trailing parenthetical retail marker such as "Sea of Stars: Sunset Edition (Retail Edition)"
  // or bracketed boutique edition marker such as "Alisa: Developer's Cut [RETRO EDITION]".
  let working = preCleaned;
  let bracketEdition: string | null = null;
  let parenEdition: string | null = null;
  const bracketEdMatch = working.match(RETAIL_BRACKET_EDITION_RE);
  if (bracketEdMatch) {
    const candidateBase = working.slice(0, bracketEdMatch.index).trim();
    if (
      candidateBase.length >= 3 &&
      !NON_ENGLISH_EDITION_RE.test(bracketEdMatch[1])
    ) {
      working = candidateBase;
      bracketEdition = bracketEdMatch[1]
        .trim()
        .toLowerCase()
        .replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
    }
  }
  const parenMatch = working.match(RETAIL_PAREN_EDITION_RE);
  if (parenMatch) {
    const candidateBase = working.slice(0, parenMatch.index).trim();
    if (
      candidateBase.length >= 3 &&
      !NON_ENGLISH_EDITION_RE.test(parenMatch[1])
    ) {
      working = candidateBase;
      parenEdition = parenMatch[1].trim();
    }
  }

  // Handle stacked Switch 2 wrapper after an inner packaging edition:
  // e.g. "Sonic Racing: CrossWorlds - Year One Edition Nintendo Switch 2 Edition"
  const stackedSw2Match = working.match(
    /^(.{3,}?)\s+((?:Nintendo\s+)?Switch\s+2\s+Edition)$/i,
  );
  if (stackedSw2Match) {
    const inner = stackedSw2Match[1].trim();
    const sw2Suffix = stackedSw2Match[2].trim();
    const innerSplit = splitTitleEditionSuffix(inner);
    if (
      innerSplit &&
      !innerSplit.suffix.startsWith('+') &&
      !PLATFORM_EDITION_ONLY_RE.test(innerSplit.suffix) &&
      !STANDALONE_CONTENT_EDITION_RE.test(innerSplit.suffix) &&
      !NON_ENGLISH_EDITION_RE.test(innerSplit.suffix)
    ) {
      const sep = innerSplit.base.includes(':') ? ' - ' : ' - ';
      return {
        baseTitle: `${innerSplit.base}${sep}${sw2Suffix}`,
        edition: innerSplit.suffix,
      };
    }
  }

  const split = splitTitleEditionSuffix(working);
  if (
    split &&
    !split.suffix.startsWith('+') &&
    !PLATFORM_EDITION_ONLY_RE.test(split.suffix) &&
    !STANDALONE_CONTENT_EDITION_RE.test(split.suffix) &&
    !NON_ENGLISH_EDITION_RE.test(split.suffix)
  ) {
    return {
      baseTitle: split.base,
      edition: bracketEdition
        ? `${split.suffix}, ${bracketEdition}`
        : split.suffix,
    };
  }

  const fallbackEdition = bracketEdition || parenEdition;
  if (fallbackEdition) {
    return {
      baseTitle: working,
      edition: fallbackEdition,
    };
  }

  return { baseTitle: preCleaned, edition: null };
}

const SINGLE_TITLE_AMPERSAND_GUARD_RE =
  /\b(?:ratchet\s*&\s*clank|mario\s*&\s*luigi|dungeons\s*&\s*dragons|sonic\s*&\s*knuckles|saints\s*(?:&|and)\s*sinners|krypto\s*(?:&|and)\s*ace|blood\s*&\s*truth|guns,\s*gore\s*&\s*cannoli|pocky\s*&\s*rocky|kane\s*&\s*lynch|sam\s*&\s*max|toejam\s*&\s*earl|banjo\s*(?:&|and)\s*kazooie|kameo\s*&\s*|pride\s*&\s*prejudice|law\s*&\s*order|fast\s*&\s*furious|rock\s*&\s*roll|hide\s*&\s*seek|search\s*&\s*rescue|cops\s*&\s*robbers|sword\s*&\s*shield|pen\s*&\s*paper|mount\s*&\s*blade|command\s*&\s*conquer|puzzles\s*&\s*dragons)\b/i;

/**
 * Extracts constituent single-game titles from genuine physical multi-game
 * cartridges/discs (e.g. "Sonic Mania + Team Sonic Racing", "Yakuza Kiwami 1+2",
 * "Star Wars Jedi Outcast/Jedi Academy", "Harvest Moon: The Lost Valley and Skytree Village").
 *
 * Returns `[]` unless `>= 2` clean constituent titles are confidently extracted so
 * single titles that naturally contain `&` or `and` (e.g. "Ratchet & Clank",
 * "Saints and Sinners", "Krypto & Ace") are never mis-split.
 */
export function parseComboCartConstituentTitles(title: string): string[] {
  const raw = (title || '')
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return [];

  // Do not split generic Trilogy/Collection/Anthology umbrella titles lacking explicit constituent names
  if (/\b(?:trilogy|quadrilogy|anthology)\b/i.test(raw) && !/[+/]/.test(raw)) {
    return [];
  }

  const hadExplicitComboPrefix =
    /^(?:\d+\s*(?:games?\s+in\s+(?:1|one)|in\s+(?:1|one)(?:\s+(?:game|super)\s+pack)?|game\s+(?:bundle|pack))!?|double\s+pack|triple\s+pack|dual\s+pack|twin\s+pack|.+?\s+bundle)(?:\s*[-:]\s*|\s+)/i.test(
      raw,
    );
  const body = raw
    .replace(
      /^(?:\d+\s*(?:games?\s+in\s+(?:1|one)|in\s+(?:1|one)(?:\s+(?:game|super)\s+pack)?|game\s+(?:bundle|pack))!?|double\s+pack|triple\s+pack|twin\s+pack|dual\s+pack)(?:\s*[-:]\s*|\s+)/i,
      '',
    )
    .replace(/^the\s+sims\s+4\s+bundle\s*[-:]\s*/i, '')
    .replace(/\s+(?:dual|double|triple|twin)\s+pack(?:\s+edition)?\s*$/i, '')
    .trim();

  // Handle physical cartridge+expansion bundles only when NOT clearly DLC unless named
  // Shorthand numbered pairs: "Yakuza Kiwami 1+2", "TOAPLAN Arcade Collection Volume 1 and 2"
  const numPair = body.match(/^(.{3,}?)\s+1\s*(?:\+|\/|&|\band\b)\s*2$/i);
  if (numPair) {
    const base = numPair[1].replace(/[-:]\s*$/, '').trim();
    if (base.length >= 3 && !/\bvolume$/i.test(base)) {
      return [base, `${base} 2`];
    }
  }

  const normalizeSplitParts = (parts: string[]): string[] => {
    const cleaned = parts.map((p) => p.trim()).filter((p) => p.length >= 2);
    if (cleaned.length < 2) return [];
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const part of cleaned) {
      const k = normalizeTitleForMatching(part);
      if (k && !seen.has(k)) {
        seen.add(k);
        deduped.push(part);
      }
    }
    return deduped.length >= 2 ? deduped : [];
  };

  // 1. Explicit " + " delimiter ("Sonic Mania + Team Sonic Racing")
  if (/\s+\+\s+/.test(body)) {
    const parts = body.split(/\s+\+\s+/);
    // Reject Pokémon/Mario Switch "+ Booster Course Pass / Expansion Pass" DLC add-ons
    if (
      parts.length >= 2 &&
      !PLUS_ADDON_KEYWORD_RE.test(parts[parts.length - 1])
    ) {
      // Handle leading number continuation like "Atari Recharged Collection 3 + 4"
      if (parts.length === 2 && /^\d+$/.test(parts[1].trim())) {
        const prefixNum = parts[0].trim().match(/^(.+?)\s+(\d+)$/);
        if (prefixNum) {
          return normalizeSplitParts([
            parts[0],
            `${prefixNum[1].trim()} ${parts[1].trim()}`,
          ]);
        }
      }
      return normalizeSplitParts(parts);
    }
  }

  // 2. Explicit slash delimiter with shared franchise prefix support
  // e.g. "Star Wars Jedi Outcast/Jedi Academy" -> ["Star Wars Jedi Outcast", "Star Wars Jedi Academy"]
  if (
    /\s*\/\s*/.test(body) &&
    !/\b(?:1\/2|2\/2|vol\s*\d+\/\d+|x\/x-?2)\b/i.test(body)
  ) {
    const slashParts = body.split(/\s*\/\s*/).map((s) => s.trim());
    if (
      slashParts.length >= 2 &&
      slashParts.length <= 4 &&
      slashParts.every((s) => s.length >= 4)
    ) {
      if (slashParts.length === 2) {
        const firstWords = slashParts[0].split(/\s+/);
        const secondWords = slashParts[1].split(/\s+/);
        if (firstWords.length >= 3 && secondWords.length >= 2) {
          const sharedColon = slashParts[0].match(/^([^:]{3,}):\s+(.+)$/);
          if (sharedColon && !slashParts[1].includes(':')) {
            return normalizeSplitParts([
              slashParts[0],
              `${sharedColon[1].trim()}: ${slashParts[1]}`,
            ]);
          }
          const brandMatch = slashParts[0].match(
            /^(Star\s+Wars|Super\s+Mario|Mega\s+Man|Final\s+Fantasy|Resident\s+Evil|Dragon\s+Quest|Harvest\s+Moon)\s+(.+)$/i,
          );
          if (
            brandMatch &&
            !slashParts[1].toLowerCase().startsWith(brandMatch[1].toLowerCase())
          ) {
            return normalizeSplitParts([
              slashParts[0],
              `${brandMatch[1]} ${slashParts[1]}`,
            ]);
          }
        }
      }
      return normalizeSplitParts(slashParts);
    }
  }

  // 3. Colon-prefixed shared franchise with "and" / "&":
  // e.g. "Harvest Moon: The Lost Valley and Skytree Village" -> ["Harvest Moon: The Lost Valley", "Harvest Moon: Skytree Village"]
  const colonIdx = body.indexOf(':');
  if (colonIdx > 2 && colonIdx < body.length - 6) {
    const prefix = body.slice(0, colonIdx).trim();
    const rest = body.slice(colonIdx + 1).trim();
    if (!SINGLE_TITLE_AMPERSAND_GUARD_RE.test(rest)) {
      const ampParts = rest.split(/\s+(?:&|and)\s+/i);
      if (
        ampParts.length === 2 &&
        ampParts[0].split(/\s+/).length >= 2 &&
        ampParts[1].split(/\s+/).length >= 2
      ) {
        return normalizeSplitParts([
          `${prefix}: ${ampParts[0].trim()}`,
          `${prefix}: ${ampParts[1].trim()}`,
        ]);
      }
    }
  }

  // 4. Explicit Bundle/Pack wrapper with " & " or " and "
  if (hadExplicitComboPrefix && /\s+(?:&|and)\s+/i.test(body)) {
    const idx = body.search(/\s+(?:&|and)\s+/i);
    if (idx > 2) {
      const left = body.slice(0, idx).trim();
      const right = body
        .slice(idx)
        .replace(/^\s*(?:&|and)\s+/i, '')
        .trim();
      if (left.length >= 3 && right.length >= 3) {
        return normalizeSplitParts([left, right]);
      }
    }
  }

  // 5. Standalone Xbox-style dual-game `&` compilation ("Forza Motorsport & Xbox Live Arcade")
  if (
    !SINGLE_TITLE_AMPERSAND_GUARD_RE.test(body) &&
    /\s+&\s+/.test(body) &&
    !/:\s*.*\s+&\s+/.test(body)
  ) {
    const parts = body.split(/\s+&\s+/);
    if (
      parts.length === 2 &&
      parts[0].trim().split(/\s+/).length >= 2 &&
      parts[1].trim().split(/\s+/).length >= 2
    ) {
      return normalizeSplitParts(parts);
    }
  }

  return [];
}

/**
 * Resolves a consistent parent `games.title` from a source/DAT title and an optional IGDB
 * canonical `name`, adopting IGDB's clean base typography while preserving distinct physical
 * editions, platform editions (e.g. Nintendo Switch 2 Edition), and DLC add-ons.
 */
export function resolveCanonicalDisplayTitle(
  sourceTitle: string,
  igdbName?: string | null,
): string {
  const srcClean = (sourceTitle || '').trim();
  const igdbClean = (igdbName || '').trim();
  if (!igdbClean) return srcClean;
  if (!srcClean) return igdbClean;

  const srcEd = splitTitleEditionSuffix(srcClean);
  if (!srcEd) {
    return igdbClean;
  }

  const igdbEd = splitTitleEditionSuffix(igdbClean);
  if (
    igdbEd &&
    normalizeTitleForMatching(srcEd.suffix) ===
      normalizeTitleForMatching(igdbEd.suffix)
  ) {
    return igdbClean;
  }

  const igdbBase = igdbEd ? igdbEd.base : igdbClean;
  if (igdbBase.toLowerCase().includes(srcEd.suffix.toLowerCase())) {
    return igdbClean;
  }

  if (srcEd.suffix.startsWith('+')) {
    return `${igdbBase} ${srcEd.suffix}`;
  }
  if (igdbBase.includes(':') || /[!?]$/.test(igdbBase)) {
    return `${igdbBase} - ${srcEd.suffix}`;
  }
  return `${igdbBase}: ${srcEd.suffix}`;
}
