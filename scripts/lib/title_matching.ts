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
    princepersia3d: 'princepersiaarabiannights',
    lemmings3d: '3dlemmings',
    harvestmonnewbeginning: 'harvestmon3dnewbeginning',
    harvestmontaletwotowns: 'harvestmon3dtaletwotowns',
    spacechannel5special: 'spacechannel5ulalacosmicattack',
    dishonoreddefinitive: 'dishonoredgameyear',
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
  };

  // If skipAliases is true, we bypass the explicit alias lookup.
  // This allows comparing the raw un-aliased base titles for boundary checks.
  if (!skipAliases && cleanTitle in ALIASES) {
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
    // Wii U's physical release in dats is named "Shovel Knight" but owned title is "Shovel Knight: Treasure Trove"
    'shovel knight: treasure trove': 'shovel knight',
    'the amazing spider-man vs. the kingpin':
      'spider-man / spider-man vs. the kingpin / the amazing spider-man vs. the kingpin',
    "x-men: gamesmaster's legacy": "x-men - gamemaster's legacy",
    'final fantasy anthology':
      'final fantasy anthology - final fantasy v / final fantasy anthology - final fantasy vi',
    'minecraft: story mode - the complete adventure':
      'minecraft - story mode - a telltale games series - the complete adventure / minecraft - story mode - the complete adventure',
    'minecraft: story mode - season two':
      'minecraft - story mode - season two - the telltale series / minecraft - story mode - season two',
  };
  const gLower = gameTitle.toLowerCase().trim();
  if (platformId === 14 && gLower === 'the amazing spider-man 2') {
    gameTitle = 'spider-man 2';
  } else if (gLower in PRE_SPLIT_ALIASES) {
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
      const lower = str.toLowerCase();
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

  // 2. Enforce boundary check to prevent matching a Bonus Disc to a main game (or vice versa).
  // We only bypass this check for Master Quest/Zelda bonus discs, or when the titles match
  // via an explicit alias (where their un-aliased base titles differ).
  if (!isZeldaMQ) {
    const isReleaseSpecial =
      rawLower.includes('bonus disc') ||
      (rawLower.includes('bonus') && rawLower.includes('disc')) ||
      rawLower.includes('tokusei disc') ||
      rawLower.includes('kakuchou disc');

    const isGameSpecial =
      gameLower.includes('bonus disc') ||
      (gameLower.includes('bonus') && gameLower.includes('disc')) ||
      gameLower.includes('tokusei disc') ||
      gameLower.includes('kakuchou disc');

    if (isReleaseSpecial !== isGameSpecial) {
      const baseG = normalizeTitleForMatching(gTitle, true);
      const baseR = normalizeTitleForMatching(rAlt, true);
      // If their base unaliased titles are the same, they represent the same core game title
      // but different disc types, so they must not be matched.
      if (baseG === baseR) {
        return false;
      }
    }
  }

  // Strategy 1: Exact match on normalized strings
  if (gNorm === rNorm) {
    return true;
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

  if (rSegmentNorms.includes(gNorm) || gSegmentNorms.includes(rNorm)) {
    return true;
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
