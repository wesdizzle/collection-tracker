/**
 * SPECIAL LABEL & SUPERSEDED RELEASE REGISTRY
 *
 * 1. Catalogs games and editions that were exclusively released under a console
 *    manufacturer's budget/re-release line in a given territory (e.g. Nintendo Selects,
 *    Platinum Hits, Greatest Hits, Player's Choice, Xbox Classics, Platinum,
 *    New Play Control!, Essentials, Classic NES Series) where Redump/No-Intro DAT
 *    files omit the packaging banner from the ROM filename.
 *
 * 2. Catalogs all 14 platform-title pairs across the 52 Redump/No-Intro DAT files
 *    where an original 1-disc release {D1} is reused verbatim as Disc 1 inside a
 *    later 2-disc GOTY/expanded release {D1, D2} (so Redump omits duplicating D1
 *    under the expanded title). Marks those original releases with the "Superseded"
 *    tag and provides lookup metadata to link shared Disc 1 backups bidirectionally.
 *
 * Safe for execution across both Cloudflare Workers edge isolates and local Node runtimes.
 */

export interface SpecialLabelProvenanceRule {
  /** Normalized base title (lowercase alphanumeric) without parentheticals */
  normalizedTitle: string;
  /** Applicable platform IDs (e.g. 22 = Wii, 29 = PS1, 30 = PS2, 32 = PS3, 47 = Xbox, 48 = Xbox 360, 20 = GameCube) */
  platformIds: number[];
  /** Specific label tag to assign (e.g. 'Nintendo Selects', 'Platinum Hits', 'Greatest Hits') */
  label: string;
  /** Optional region tokens (lowercase) that must match at least one region in the release */
  regions?: string[];
  /** Optional region tokens (lowercase) that must NOT be present */
  excludeRegions?: string[];
  /** Optional substring/token (lowercase) required in raw DAT name or existing variants (e.g. 'rev 1', 'v2.01', 'special edition') */
  requireRawToken?: string;
  /** Optional substring/token (lowercase) that must NOT appear in the raw DAT name (e.g. 'demo', 'beta', 'promo') */
  excludeRawToken?: string;
  /** Historical release date of the special-label version */
  releaseDate: string;
  /** Product serial number or Redump revision identifier */
  serialOrRevision: string;
  /** Historical explanation of why this release only exists under the special label */
  rationale: string;
  /** Primary verification sources */
  sources: string[];
}

export interface SupersededReleasePair {
  /** Platform ID (48 = Xbox 360, 32 = PS3, 34 = PS4) */
  platformId: number;
  /** Normalized base title of the original 1-disc release {D1} */
  originalNormalizedTitle: string;
  /** Display title of the original release */
  originalDisplayTitle: string;
  /** Optional known stable_id of the original game in collection.sqlite */
  originalStableId?: number;
  /** Normalized base title of the superseding 2-disc expanded release {D1, D2} */
  supersetNormalizedTitle: string;
  /** Display title of the superseding expanded release */
  supersetDisplayTitle: string;
  /** Optional known stable_id of the superseding game in collection.sqlite */
  supersetStableId?: number;
  /** Lowercase substring that distinguishes the superset ROM when both share a game_id (e.g. Fallout 3 GOTY, Mafia II Add-On) */
  supersetRomMarker?: string;
  /** Lowercase substring that must NOT appear in the original ROM (e.g. 'add-on', 'bonus disc', 'game of the year') */
  originalExcludeMarker?: string;
  /** Regions (lowercase) where the original release is a strict 1-disc subset of the expanded release */
  applicableRegions: string[];
  /** Regions (lowercase) explicitly excluded (e.g. 'japan' for Oblivion GOTY which was a single-disc build) */
  excludedRegions?: string[];
}

/**
 * Normalizes a release title or ROM filename for rule matching by stripping
 * file extensions, parentheticals, brackets, articles, and non-alphanumeric characters.
 */
export function normalizeForLabelMatch(name: string): string {
  let clean = name
    .replace(/\.(?:xiso\.iso|[a-z0-9]{2,4})$/i, '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s*\[[^\]]*\]/g, '')
    .trim();
  clean = clean.replace(
    /(^|\s-\s)([^,-]+),\s*(the|a|an)(?=\s*(?:-|:|$))/gi,
    '$1$3 $2',
  );
  return clean
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&amp;/g, 'and')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Curated registry of releases that were exclusively sold under a budget or
 * special re-release label in a specific territory, with full provenance.
 */
export const SPECIAL_LABEL_EXCLUSIVES: SpecialLabelProvenanceRule[] = [
  // ---------------------------------------------------------------------------
  // Wii: Nintendo Selects & New Play Control! (Platform 22)
  // ---------------------------------------------------------------------------
  {
    normalizedTitle: 'pikmin2',
    platformIds: [22],
    label: 'Nintendo Selects',
    regions: ['usa'],
    releaseDate: '2012-06-10',
    serialOrRevision: 'RVL-R2WE-USA',
    rationale:
      'Skipped North America during the 2009 New Play Control! wave and launched in NA exclusively under the Nintendo Selects banner.',
    sources: [
      'https://www.mariowiki.com/Pikmin_2_(New_Play_Control!)',
      'https://en.wikipedia.org/wiki/Nintendo_Selects',
      'http://redump.org/',
    ],
  },

  // ---------------------------------------------------------------------------
  // Original Xbox: Platinum Hits & Xbox Classics (Platform 47)
  // ---------------------------------------------------------------------------
  {
    normalizedTitle: 'fablethelostchapters',
    platformIds: [47],
    label: 'Platinum Hits',
    regions: ['usa'],
    releaseDate: '2006-03-20',
    serialOrRevision: 'MS-082 (Platinum Hits)',
    rationale:
      'The expanded Xbox console edition of Fable: The Lost Chapters was published by Microsoft Game Studios exclusively under the Platinum Hits budget banner in North America.',
    sources: [
      'https://en.wikipedia.org/wiki/Fable_(2004_video_game)#The_Lost_Chapters',
      'https://www.gamespot.com/articles/fable-the-lost-chapters-coming-to-xbox/1100-6142312/',
    ],
  },
  {
    normalizedTitle: 'fablethelostchapters',
    platformIds: [47],
    label: 'Xbox Classics',
    regions: ['europe', 'germany', 'italy', 'spain', 'france', 'uk'],
    releaseDate: '2006-03-31',
    serialOrRevision: 'PAL Xbox Classics',
    rationale:
      'Released in PAL territories exclusively under the Xbox Classics budget label.',
    sources: [
      'https://en.wikipedia.org/wiki/Fable_(2004_video_game)#The_Lost_Chapters',
    ],
  },
  {
    normalizedTitle: 'midnightclub3dubeditionremix',
    platformIds: [47],
    label: 'Platinum Hits',
    regions: ['usa'],
    releaseDate: '2006-03-13',
    serialOrRevision: 'TT-045 (Platinum Hits)',
    rationale:
      'Expanded Remix edition (adding Tokyo and 24 vehicles) launched exclusively under the Platinum Hits line on Xbox in North America.',
    sources: ['https://en.wikipedia.org/wiki/Midnight_Club_3:_DUB_Edition'],
  },
  {
    normalizedTitle: 'midnightclub3dubeditionremix',
    platformIds: [47],
    label: 'Xbox Classics',
    regions: ['europe', 'uk', 'france', 'germany'],
    releaseDate: '2006-03-17',
    serialOrRevision: 'PAL Xbox Classics',
    rationale:
      'Expanded Remix edition launched exclusively under the Xbox Classics line in PAL territories.',
    sources: ['https://en.wikipedia.org/wiki/Midnight_Club_3:_DUB_Edition'],
  },

  // ---------------------------------------------------------------------------
  // PlayStation 1: Greatest Hits Exclusives (Platform 29)
  // ---------------------------------------------------------------------------
  {
    normalizedTitle: 'residentevildirectorscutdualshockver',
    platformIds: [29],
    label: 'Greatest Hits',
    regions: ['usa'],
    releaseDate: '1998-09-14',
    serialOrRevision: 'SLUS-00747',
    rationale:
      "Released in North America exclusively in green Greatest Hits packaging to replace the 1997 black-label Director's Cut (SLUS-00551), adding DualShock support and the orchestral soundtrack.",
    sources: [
      'https://psxdatacenter.com/games/U/R/SLUS-00747.html',
      'https://www.ign.com/articles/1998/09/15/resident-evil-directors-cut-dual-shock-version',
    ],
  },
  {
    normalizedTitle: 'jetmoto2',
    platformIds: [29],
    label: 'Greatest Hits',
    regions: ['usa'],
    requireRawToken: 'rev 1',
    releaseDate: '1998-08-01',
    serialOrRevision: 'SCUS-94167 (Rev 1 / Championship Edition)',
    rationale:
      'Jet Moto 2: Championship Edition (reworked 30fps engine, 4-racer cap, unlocked Jet Moto 1 tracks) was issued exclusively as the Greatest Hits pressing (Rev 1 in Redump) under serial SCUS-94167.',
    sources: [
      'https://psxdatacenter.com/games/U/J/SCUS-94167.html',
      'https://en.wikipedia.org/wiki/Jet_Moto_2',
      'http://redump.org/disc/1535/',
    ],
  },
  {
    normalizedTitle: 'thelostworldjurassicpark',
    platformIds: [29],
    label: 'Greatest Hits',
    regions: ['usa'],
    requireRawToken: 'rev 1',
    releaseDate: '1998-09-01',
    serialOrRevision: 'SLUS-00515 (Rev 1 / Special Edition)',
    rationale:
      'The Lost World: Jurassic Park - Special Edition (adding new levels and difficulty adjustments) was released exclusively as the Greatest Hits pressing (Rev 1 in Redump).',
    sources: [
      'https://psxdatacenter.com/games/U/T/SLUS-00515.html',
      'http://redump.org/',
    ],
  },

  // ---------------------------------------------------------------------------
  // PlayStation 2: Greatest Hits & Platinum Exclusives (Platform 30)
  // ---------------------------------------------------------------------------
  {
    normalizedTitle: 'silenthill2',
    platformIds: [30],
    label: 'Greatest Hits',
    regions: ['usa'],
    requireRawToken: 'v2.01',
    releaseDate: '2002-11-19',
    serialOrRevision: 'SLUS-20228GH (v2.01)',
    rationale:
      'The expanded PS2 build (v2.01) adding the "Born from a Wish" Maria sub-scenario and UFO ending from Xbox Restless Dreams was released in North America exclusively under the Greatest Hits label.',
    sources: [
      'https://psxdatacenter.com/psx2/games2/SLUS-20228.html',
      'https://www.silenthillmemories.net/sh2/versions_en.htm',
      'http://redump.org/',
    ],
  },
  {
    normalizedTitle: 'silenthill2directorscut',
    platformIds: [30],
    label: 'Platinum',
    regions: ['europe', 'uk', 'france', 'germany', 'italy', 'spain'],
    releaseDate: '2003-02-28',
    serialOrRevision: 'SLES-51156',
    rationale:
      'European expanded edition ("Director\'s Cut" containing Born from a Wish) was released under Sony Europe\'s Platinum budget line.',
    sources: ['https://www.silenthillmemories.net/sh2/versions_en.htm'],
  },
  {
    normalizedTitle: 'virtuafighter4evolution',
    platformIds: [30],
    label: 'Greatest Hits',
    regions: ['usa'],
    releaseDate: '2003-08-13',
    serialOrRevision: 'SLUS-20616',
    rationale:
      'Launched in North America at $19.99 exclusively in Greatest Hits packaging despite being an expanded standalone update to Virtua Fighter 4; no black-label NA release exists.',
    sources: [
      'https://psxdatacenter.com/psx2/games2/SLUS-20616.html',
      'https://en.wikipedia.org/wiki/Virtua_Fighter_4#Virtua_Fighter_4:_Evolution',
    ],
  },
  {
    normalizedTitle: 'midnightclub3dubeditionremix',
    platformIds: [30],
    label: 'Greatest Hits',
    regions: ['usa'],
    releaseDate: '2006-03-13',
    serialOrRevision: 'SLUS-21355GH',
    rationale:
      'Expanded Remix edition launched exclusively under the Greatest Hits banner on PlayStation 2 in North America.',
    sources: [
      'https://psxdatacenter.com/psx2/games2/SLUS-21355.html',
      'https://en.wikipedia.org/wiki/Midnight_Club_3:_DUB_Edition',
    ],
  },
  {
    normalizedTitle: 'midnightclub3dubeditionremix',
    platformIds: [30],
    label: 'Platinum',
    regions: ['europe', 'uk', 'france', 'germany', 'australia'],
    releaseDate: '2006-03-17',
    serialOrRevision: 'SLES-53995',
    rationale:
      'Expanded Remix edition launched exclusively under the Platinum range in PAL territories.',
    sources: ['https://en.wikipedia.org/wiki/Midnight_Club_3:_DUB_Edition'],
  },
  {
    normalizedTitle: 'callofduty3',
    platformIds: [30],
    label: 'Greatest Hits',
    regions: ['usa'],
    requireRawToken: 'special edition',
    releaseDate: '2007-08-17',
    serialOrRevision: 'SLUS-21426GH',
    rationale:
      'Call of Duty 3: Special Edition (including the bonus documentary DVD) was released in North America under the Greatest Hits banner.',
    sources: ['https://www.gamespot.com/games/call-of-duty-3/'],
  },

  // ---------------------------------------------------------------------------
  // PlayStation 3 & Xbox 360: Greatest Hits / Platinum Hits Exclusives (32, 48)
  // ---------------------------------------------------------------------------
  {
    normalizedTitle: 'midnightclublosangelescompleteedition',
    platformIds: [32],
    label: 'Greatest Hits',
    regions: ['usa'],
    releaseDate: '2009-10-28',
    serialOrRevision: 'BLUS-30442',
    rationale:
      'Complete Edition (bundling South Central and all DLC on-disc) was released exclusively under the PS3 Greatest Hits banner in North America.',
    sources: [
      'https://en.wikipedia.org/wiki/Midnight_Club:_Los_Angeles',
      'https://serialstation.com/titles/BLUS/30442',
    ],
  },
  {
    normalizedTitle: 'midnightclublosangelescompleteedition',
    platformIds: [32],
    label: 'Platinum',
    regions: ['europe', 'uk', 'australia'],
    releaseDate: '2009-10-30',
    serialOrRevision: 'BLES-00757',
    rationale:
      'Complete Edition was released exclusively under the PS3 Platinum range in PAL territories.',
    sources: ['https://en.wikipedia.org/wiki/Midnight_Club:_Los_Angeles'],
  },
  {
    normalizedTitle: 'midnightclublosangelescompleteedition',
    platformIds: [48],
    label: 'Platinum Hits',
    regions: ['usa'],
    releaseDate: '2009-10-12',
    serialOrRevision: 'Xbox 360 Platinum Hits',
    rationale:
      'Complete Edition was released exclusively under the Xbox 360 Platinum Hits banner in North America.',
    sources: ['https://en.wikipedia.org/wiki/Midnight_Club:_Los_Angeles'],
  },
  {
    normalizedTitle: 'midnightclublosangelescompleteedition',
    platformIds: [48],
    label: 'Classics',
    regions: ['europe', 'uk', 'australia'],
    releaseDate: '2009-10-16',
    serialOrRevision: 'Xbox 360 Classics',
    rationale:
      'Complete Edition was released under the Xbox 360 Classics banner in PAL territories.',
    sources: ['https://en.wikipedia.org/wiki/Midnight_Club:_Los_Angeles'],
  },
  {
    normalizedTitle: 'lostplanetextremeconditioncoloniesedition',
    platformIds: [48],
    label: 'Platinum Hits',
    regions: ['usa', 'world'],
    releaseDate: '2008-05-27',
    serialOrRevision: 'Xbox 360 Platinum Hits',
    rationale:
      'Expanded Colonies Edition was released at budget pricing under the Xbox 360 Platinum Hits banner in North America.',
    sources: ['https://en.wikipedia.org/wiki/Lost_Planet:_Extreme_Condition'],
  },

  // ---------------------------------------------------------------------------
  // Nintendo GameCube: Player's Choice Exclusives (Platform 20)
  // ---------------------------------------------------------------------------
  {
    normalizedTitle: 'pacmanvs',
    platformIds: [20],
    label: "Player's Choice",
    regions: ['usa'],
    releaseDate: '2003-12-02',
    serialOrRevision: 'DOL-PRJE-USA',
    rationale:
      "Outside of cardboard-sleeve pre-order promos, Pac-Man Vs. was only sold in a standard GameCube retail case in North America as Disc 2 of the Pac-Man Vs. / Pac-Man World 2 Player's Choice bundle.",
    sources: [
      'https://en.wikipedia.org/wiki/Pac-Man_Vs.',
      'http://redump.org/',
    ],
  },
];

/**
 * Complete registry of all 14 platform-title pairs across the 52 Redump/No-Intro DATs
 * where an original 1-disc release {D1} is a strict physical disc subset of—and thus
 * superseded for archival backup purposes by—a subsequent 2-disc expanded release {D1, D2}.
 */
export const SUPERSEDED_RELEASE_PAIRS: SupersededReleasePair[] = [
  {
    platformId: 48, // Xbox 360
    originalNormalizedTitle: 'theelderscrollsivoblivion',
    originalDisplayTitle: 'The Elder Scrolls IV: Oblivion',
    originalStableId: 3796,
    supersetNormalizedTitle: 'theelderscrollsivobliviongameoftheyearedition',
    supersetDisplayTitle:
      'The Elder Scrolls IV: Oblivion - Game of the Year Edition',
    supersetStableId: 3798,
    originalExcludeMarker: 'collector',
    applicableRegions: [
      'usa',
      'europe',
      'germany',
      'italy',
      'france',
      'spain',
      'uk',
    ],
    excludedRegions: ['japan', 'asia'],
  },
  {
    platformId: 48, // Xbox 360
    originalNormalizedTitle: 'theelderscrollsvskyrim',
    originalDisplayTitle: 'The Elder Scrolls V: Skyrim',
    originalStableId: 3799,
    supersetNormalizedTitle: 'theelderscrollsvskyrimlegendaryedition',
    supersetDisplayTitle: 'The Elder Scrolls V: Skyrim - Legendary Edition',
    supersetStableId: 3800,
    originalExcludeMarker: 'kinect sensor',
    applicableRegions: [
      'world',
      'usa',
      'europe',
      'germany',
      'france',
      'italy',
      'spain',
      'japan',
    ],
  },
  {
    platformId: 48, // Xbox 360
    originalNormalizedTitle: 'fallout3',
    originalDisplayTitle: 'Fallout 3',
    originalStableId: 3808,
    supersetNormalizedTitle: 'fallout3gameoftheyearedition',
    supersetDisplayTitle: 'Fallout 3 - Game of the Year Edition',
    supersetStableId: 3808,
    supersetRomMarker: 'game of the year edition',
    originalExcludeMarker: 'add-on',
    applicableRegions: [
      'usa',
      'europe',
      'germany',
      'france',
      'italy',
      'spain',
      'japan',
      'austria',
      'switzerland',
    ],
  },
  {
    platformId: 48, // Xbox 360
    originalNormalizedTitle: 'dishonored',
    originalDisplayTitle: 'Dishonored',
    originalStableId: 3784,
    supersetNormalizedTitle: 'dishonoredgameoftheyearedition',
    supersetDisplayTitle: 'Dishonored: Definitive Edition',
    supersetStableId: 3785,
    applicableRegions: ['usa', 'europe', 'japan'],
  },
  {
    platformId: 48, // Xbox 360
    originalNormalizedTitle: 'dragonageorigins',
    originalDisplayTitle: 'Dragon Age: Origins',
    originalStableId: 3790,
    supersetNormalizedTitle: 'dragonageoriginsultimateedition',
    supersetDisplayTitle: 'Dragon Age: Origins - Ultimate Edition',
    supersetStableId: 3791,
    originalExcludeMarker: 'tsuika contents',
    applicableRegions: ['world', 'usa', 'europe', 'germany', 'france'],
    excludedRegions: ['japan'],
  },
  {
    platformId: 48, // Xbox 360
    originalNormalizedTitle: 'borderlands',
    originalDisplayTitle: 'Borderlands',
    originalStableId: 3731,
    supersetNormalizedTitle: 'borderlandsgameoftheyearedition',
    supersetDisplayTitle: 'Borderlands: Game of the Year Edition',
    supersetStableId: 3732,
    originalExcludeMarker: 'add-on',
    applicableRegions: ['world', 'usa', 'europe', 'germany'],
    excludedRegions: ['japan'],
  },
  {
    platformId: 48, // Xbox 360
    originalNormalizedTitle: 'borderlands2',
    originalDisplayTitle: 'Borderlands 2',
    originalStableId: 3733,
    supersetNormalizedTitle: 'borderlands2gameoftheyearedition',
    supersetDisplayTitle: 'Borderlands 2: Game of the Year Edition',
    supersetStableId: 3734,
    originalExcludeMarker: 'add-on',
    applicableRegions: ['world', 'usa', 'europe'],
  },
  {
    platformId: 32, // PlayStation 3
    originalNormalizedTitle: 'borderlands2',
    originalDisplayTitle: 'Borderlands 2',
    originalStableId: 2372,
    supersetNormalizedTitle: 'borderlands2gameoftheyearedition',
    supersetDisplayTitle: 'Borderlands 2: Game of the Year Edition',
    supersetStableId: 2373,
    originalExcludeMarker: 'add-on',
    applicableRegions: ['usa', 'europe', 'japan'],
  },
  {
    platformId: 48, // Xbox 360
    originalNormalizedTitle: 'falloutnewvegas',
    originalDisplayTitle: 'Fallout: New Vegas',
    originalStableId: 3809,
    supersetNormalizedTitle: 'falloutnewvegasultimateedition',
    supersetDisplayTitle: 'Fallout: New Vegas - Ultimate Edition',
    applicableRegions: [
      'usa',
      'europe',
      'germany',
      'france',
      'italy',
      'spain',
      'japan',
    ],
  },
  {
    platformId: 48, // Xbox 360
    originalNormalizedTitle: 'saintsrowthethird',
    originalDisplayTitle: 'Saints Row: The Third',
    originalStableId: 3951,
    supersetNormalizedTitle: 'saintsrowthethirdthefullpackage',
    supersetDisplayTitle: 'Saints Row: The Third - The Full Package',
    applicableRegions: ['world', 'usa', 'europe', 'germany', 'japan'],
  },
  {
    platformId: 48, // Xbox 360
    originalNormalizedTitle: 'mafiaii',
    originalDisplayTitle: 'Mafia II',
    originalStableId: 3866,
    supersetNormalizedTitle: 'mafiaii',
    supersetDisplayTitle: 'Mafia II (Platinum Hits / Classics 2-Disc Edition)',
    supersetRomMarker: 'add-on content disc',
    originalExcludeMarker: 'add-on content disc',
    applicableRegions: ['world', 'usa', 'europe'],
  },
  {
    platformId: 34, // PlayStation 4
    originalNormalizedTitle: 'outlastoutlastwhistleblower',
    originalDisplayTitle: 'Outlast + Outlast: Whistleblower',
    supersetNormalizedTitle: 'outlasttrinity',
    supersetDisplayTitle: 'Outlast Trinity',
    applicableRegions: ['europe'],
  },
  {
    platformId: 48, // Xbox 360
    originalNormalizedTitle: 'callofdutymodernwarfare2',
    originalDisplayTitle: 'Call of Duty: Modern Warfare 2',
    originalStableId: 3748,
    supersetNormalizedTitle: 'callofdutymodernwarfare2',
    supersetDisplayTitle: 'Call of Duty: Modern Warfare 2 (Stimulus Package)',
    supersetRomMarker: 'stimulus package',
    originalExcludeMarker: 'stimulus package',
    applicableRegions: ['australia', 'europe'],
  },
];

/**
 * Evaluates a DAT release name and returns any applicable special-label tags
 * (e.g. 'Nintendo Selects', 'Platinum Hits', 'Greatest Hits', 'New Play Control!',
 * 'Player\'s Choice', 'Essentials', 'Classic NES Series') and 'Superseded' status.
 */

/**
 * Subsequent-version disc revisions (Rev 1+, v1.01+, v2.00+, v02.00+, etc.)
 * that were exclusively pressed for a console manufacturer's or publisher's
 * budget line (never released in Black Label Original packaging) and are not
 * consolidated into a multi-game box set.
 * Keyed by lowercase ROM filename without file extension.
 */
export const SUBSEQUENT_VERSION_BUDGET_EXCLUSIVES: Record<string, string[]> = {
  "assassin's creed iii (australia) (v02.00)": ['Essentials'],
  'lego harry potter - years 1-4 (europe) (en,fr,de,es,it,da) (v03.01)': [
    'Essentials',
  ],
  "assassin's creed - brotherhood (europe) (en,fr,de,es,it,nl,pt,sv,no,da) (v02.00)":
    ['Essentials', 'Platinum'],
  "assassin's creed iii (usa) (en,fr,es,pt) (v02.00)": ['Greatest Hits'],
  'bioshock infinite (usa) (en,fr,de,es,it,pt) (greatest hits)': [
    'Greatest Hits',
  ],
  'ratchet & clank future - tools of destruction (usa) (en,ja,fr,de,es,it,nl,pt,sv,no,da,fi,zh,ko) (v02.00)':
    ['Greatest Hits'],
  'bayonetta (japan, korea) (en,ja,fr,de,es,it) (v02.00)': [
    'PlayStation 3 the Best',
  ],
  "assassin's creed iii (japan) (en,ja,zh,ko) (v02.00)": ['Ubi the Best'],
  'fable ii (russia) (rev 1)': ['Xbox Classics'],
  'fable ii (russia) (rev 2)': ['Xbox Classics'],
  'kameo - elements of power (europe) (en,ja,fr,de,es,it,zh,ko) (rev 1)': [
    'Xbox Classics',
  ],
  'fable ii (germany) (rev 2)': ['Xbox Classics'],
  'lego star wars - the complete saga (usa, europe) (en,fr,de,es,it,da) (rev 1)':
    ['Xbox Classics', 'Platinum Hits'],
  'fable ii (usa, europe) (en,zh,ko,pl,cs,hu,sk) (rev 2)': [
    'Xbox Classics',
    'Platinum Hits',
  ],
  'dark souls (usa) (en,fr,es) (rev 1)': ['Platinum Hits'],
  'lego harry potter - years 1-4 (usa) (en,fr,de,es,it,da) (rev 1)': [
    'Platinum Hits',
  ],
  'perfect dark zero (usa) (en,fr,es) (rev 1)': ['Platinum Hits'],
  'crash bandicoot - the wrath of cortex (usa) (v1.01)': ['Greatest Hits'],
  'jak ii (usa) (en,ja,fr,de,es,it,ko) (v2.01)': ['Greatest Hits'],
  'jak x - combat racing (usa) (en,fr,de,es,it,pt,ru) (v2.00)': [
    'Greatest Hits',
  ],
  'lego star wars - the video game (usa) (v2.00)': ['Greatest Hits'],
  'ratchet & clank - going commando (usa) (v2.00)': ['Greatest Hits'],
  'silent hill 2 (usa) (en,ja,fr,de,es,it) (v2.01)': ['Greatest Hits'],
  'spider-man (usa) (v2.01)': ['Greatest Hits'],
  'spider-man 3 (usa) (v2.00)': ['Greatest Hits'],
  'star wars - battlefront ii (usa) (v2.00)': ['Greatest Hits'],
  'star wars - battlefront ii (usa) (v2.01)': ['Greatest Hits'],
  'crash bandicoot - the wrath of cortex (europe) (en,fr,de,es,it,nl) (v2.01)':
    ['Platinum'],
  'eyetoy - play 2 (europe) (en,fr,de,es,it,nl,pt,sv,no,da,fi,el) (v3.03)': [
    'Platinum',
  ],
  'spider-man (spain) (v2.01)': ['Platinum'],
  'bomberman land wii (japan) (rev 1)': ['Hudson the Best'],
  'animal crossing - city folk (usa, asia) (en,fr,es) (rev 1)': [
    'Nintendo Selects',
  ],
  'wii sports resort (europe) (en,fr,de,es,it) (rev 1)': ['Nintendo Selects'],
  'crash bandicoot - the wrath of cortex (europe) (en,fr,de,es,it,nl) (rev 1)':
    ["Player's Choice"],
  "luigi's mansion (europe) (en,fr,de,es,it) (rev 1)": ["Player's Choice"],
  'mario party 4 (europe) (en,fr,de,es,it) (rev 2)': ["Player's Choice"],
  'spider-man (europe) (rev 1)': ['Xbox Classics'],
  'spider-man (usa) (rev 1)': ['Platinum Hits'],
  'star fox adventures (usa) (rev 1)': ["Player's Choice"],
  'spider-man (germany) (rev 1)': ['Xbox Classics'],
  'blinx - the time sweeper (usa) (en,ja) (rev 1)': ['Platinum Hits'],
  'star wars - battlefront ii (usa) (en,es,it) (rev 1)': ['Platinum Hits'],
  'star wars - knights of the old republic (usa) (rev 1)': ['Platinum Hits'],
  'halo - combat evolved (usa) (rev 2)': ['Platinum Hits'],
  'metal gear solid - peace walker (usa) (en,fr,es) (v2.00)': ['Greatest Hits'],
  'metal gear solid - peace walker (japan) (v1.03)': ['PSP the Best'],
  'final fantasy anthology - final fantasy v (usa) (rev 1)': ['Greatest Hits'],
  'final fantasy anthology - final fantasy vi (usa) (rev 1)': ['Greatest Hits'],
  'final fantasy ix (usa, canada) (disc 1) (rev 1)': ['Greatest Hits'],
  'final fantasy ix (usa, canada) (disc 2) (rev 1)': ['Greatest Hits'],
  'final fantasy ix (usa, canada) (disc 3) (rev 1)': ['Greatest Hits'],
  'final fantasy ix (usa, canada) (disc 4) (rev 1)': ['Greatest Hits'],
  'namco museum vol. 1 (usa) (rev 1)': ['Greatest Hits'],
  "oddworld - abe's oddysee (usa) (rev 2)": ['Greatest Hits'],
  'tomb raider (usa) (rev 2)': ['Greatest Hits'],
  'tomb raider (usa) (rev 3)': ['Greatest Hits'],
  'tomb raider (usa) (rev 4)': ['Greatest Hits'],
  'tomb raider (usa) (rev 5)': ['Greatest Hits'],
  'tomb raider ii - starring lara croft (usa) (rev 1)': ['Greatest Hits'],
  'tomb raider ii - starring lara croft (usa) (rev 2)': ['Greatest Hits'],
  'tomb raider iii - adventures of lara croft (usa) (rev 1)': ['Greatest Hits'],
  'tomb raider (usa) (rev 6)': ['Greatest Hits'],
  'tomb raider ii - starring lara croft (usa) (rev 3)': ['Greatest Hits'],
  'tomb raider iii - adventures of lara croft (usa) (rev 2)': ['Greatest Hits'],
  'tomb raider iii - adventures of lara croft (europe) (rev 1) (edc)': [
    'Platinum',
  ],
  'tomb raider iii - adventures of lara croft (europe) (rev 1)': ['Platinum'],
  "king's field ii (japan) (playstation the best)": ['PlayStation the Best'],
  'tales of destiny (japan) (rev 1)': ['PlayStation the Best'],
  'bomberman world (japan) (rev 1)': ['PlayStation the Best for Family'],
  "king's field ii (japan) (playstation the best) (rev 1)": [
    'PlayStation the Best',
    'PSone Books',
  ],
  'silent hill (japan) (rev 2)': ['PSone Books', 'Konami the Best'],
  'elder scrolls iv, the - oblivion - game of the year edition (japan) (v02.00)':
    ['PlayStation 3 the Best'],
  'elder scrolls v, the - skyrim (japan) (v02.00)': ['PlayStation 3 the Best'],
  'elder scrolls iv, the - oblivion - game of the year edition (usa) (disc 2) (rev 1)':
    ['Platinum Hits'],
  'elder scrolls iv, the - oblivion (usa) (rev 3)': ['Platinum Hits'],
  'sims 2, the - pets (europe, australia) (en,fr,de,es,it,nl,sv,no,da,fi,pl) (v2.00)':
    ['Platinum'],
};

/**
 * Maps re-homed multi-disc box set ROM filenames (lowercase, without extension)
 * to a shared regional multi-disc grouping key so constituent discs with different
 * base game titles merge into a single release card per box set and region.
 */
export const BOX_SET_ROM_GROUPING_MAP: Record<string, string> = {
  // 1. God of War Saga (PS3, USA)
  'god of war collection (usa) (v02.00)': 'multi:god of war saga (usa)',
  'god of war iii (usa) (v02.00)': 'multi:god of war saga (usa)',

  // 2. Infamous Collection (PS3, USA)
  'infamous (usa) (en,fr,es) (v02.00)': 'multi:infamous collection (usa)',
  'infamous 2 (usa) (en,fr,es,pt) (v02.00)': 'multi:infamous collection (usa)',

  // 3. Killzone Trilogy (PS3, USA)
  'killzone trilogy (usa) (killzone + killzone 2)':
    'multi:killzone trilogy (usa)',
  'killzone 3 (usa, brazil) (en,ja,fr,de,es,it,nl,pt,sv,no,da,fi,zh,ko,pl,ru,tr)':
    'multi:killzone trilogy (usa)',

  // 4. Metal Gear Solid: The Legacy Collection (PS3, USA / Europe / Japan)
  'metal gear solid 4 - guns of the patriots (usa) (en,fr,de,es,it) (v02.00)':
    'multi:metal gear solid - the legacy collection 1987-2012 (usa)',
  'metal gear solid 4 - guns of the patriots (europe) (en,fr,de,es,it) (v02.00)':
    'multi:metal gear solid - the legacy collection 1987-2012 (europe)',
  'metal gear solid 4 - guns of the patriots (japan) (v02.01)':
    'multi:metal gear solid - the legacy collection 1987-2012 (japan)',

  // 5. Mass Effect Trilogy (PS3, USA & Europe)
  'mass effect (usa, asia) (en,fr,es)': 'multi:mass effect trilogy (usa)',
  'mass effect 2 (usa, asia) (en,fr,de,es,it,ru)':
    'multi:mass effect trilogy (usa)',
  'mass effect 3 (usa, asia) (en,ja,fr,de,es,it,pl,ru)':
    'multi:mass effect trilogy (usa)',
  'mass effect (europe) (en,fr,de,es,it)': 'multi:mass effect trilogy (europe)',
  'mass effect 2 (europe, australia) (en,fr,de,es,it,ru)':
    'multi:mass effect trilogy (europe)',
  'mass effect 3 (europe) (en,ja,fr,de,es,it,pl,ru)':
    'multi:mass effect trilogy (europe)',

  // 6. Mass Effect Trilogy (Xbox 360, Italy & USA)
  'mass effect (usa, europe) (en,es,pl) (rev 1)':
    'multi:mass effect trilogy (usa)',
  'mass effect 2 (usa, europe) (en,es) (disc 1)':
    'multi:mass effect trilogy (usa)',
  'mass effect 2 (usa, europe) (en,es) (disc 2)':
    'multi:mass effect trilogy (usa)',
  'mass effect 3 (world) (en,ja,fr,de,es,it,pl,ru) (disc 1)':
    'multi:mass effect trilogy (usa)',
  'mass effect 3 (world) (en,ja,fr,de,es,it,pl,ru) (disc 2)':
    'multi:mass effect trilogy (usa)',
  'mass effect (italy) (rev 1)': 'multi:mass effect trilogy (italy)',
  'mass effect 3 (italy) (en,ja,fr,de,es,it,pl,ru) (disc 1) (rev 1)':
    'multi:mass effect trilogy (italy)',
  'mass effect 3 (italy) (en,ja,fr,de,es,it,pl,ru) (disc 2) (rev 1)':
    'multi:mass effect trilogy (italy)',

  // 7. Assassin's Creed: Heritage Collection (Xbox 360, Europe)
  "assassin's creed (usa, europe) (en,fr,de,es,it) (rev 1)":
    "multi:assassin's creed - heritage collection (europe)",
  "assassin's creed - brotherhood (usa, europe) (en,fr,de,es,it,nl,pt,sv,no,da)":
    "multi:assassin's creed - heritage collection (europe)",
  "assassin's creed - revelations (usa, europe) (en,fr,de,es,it,nl,pt,sv,no,da)":
    "multi:assassin's creed - heritage collection (europe)",
  "assassin's creed ii - game of the year edition (europe) (en,fr,de,es,it,nl,sv,no,da)":
    "multi:assassin's creed - heritage collection (europe)",
  "assassin's creed iii (europe) (en,fr,de,es,it,nl,pt,sv,no,da,fi) (disc 1) (rev 1)":
    "multi:assassin's creed - heritage collection (europe)",
  "assassin's creed iii (europe) (en,fr,de,es,it,nl,pt,sv,no,da,fi) (disc 2) (rev 1)":
    "multi:assassin's creed - heritage collection (europe)",
  "assassin's creed ii - game of the year edition (europe) (it,pl,ru)":
    "multi:assassin's creed - heritage collection (europe) (pl,ru)",
  "assassin's creed iii (europe) (pl,ru,cs,hu) (disc 1) (rev 1)":
    "multi:assassin's creed - heritage collection (europe) (pl,ru)",
  "assassin's creed iii (europe) (pl,ru,cs,hu) (disc 2) (rev 1)":
    "multi:assassin's creed - heritage collection (europe) (pl,ru)",

  // 8. Grand Theft Auto: The Trilogy (PS2, USA)
  'grand theft auto iii (usa, canada)':
    'multi:grand theft auto - the trilogy (usa)',
  'grand theft auto - vice city (usa, canada) (v3.00)':
    'multi:grand theft auto - the trilogy (usa)',
  'grand theft auto - vice city (usa) (v4.00)':
    'multi:grand theft auto - the trilogy (usa)',
  'grand theft auto - san andreas (usa) (v3.00) (rev 1)':
    'multi:grand theft auto - the trilogy (usa)',

  // 9. Grand Theft Auto: The Trilogy (Xbox, USA / Europe)
  'grand theft auto iii (usa)': 'multi:grand theft auto - the trilogy (usa)',
  'grand theft auto - vice city (usa) (rev 1)':
    'multi:grand theft auto - the trilogy (usa)',
  'grand theft auto - san andreas (usa) (en,es) (rev 1)':
    'multi:grand theft auto - the trilogy (usa)',
  'grand theft auto iii (europe) (en,fr,de,es,it)':
    'multi:grand theft auto - the trilogy (europe)',
  'grand theft auto - vice city (europe) (en,fr,es,it) (rev 1)':
    'multi:grand theft auto - the trilogy (europe)',
  'grand theft auto - san andreas (europe) (en,fr,de,es,it) (rev 1)':
    'multi:grand theft auto - the trilogy (europe)',
};

/**
 * Explicit human-readable per-disc labels for box-set discs (keyed by lowercase
 * ROM filename without extension).
 */
export const BOX_SET_DISC_LABELS: Record<string, string> = {
  // God of War Saga (PS3)
  'god of war collection (usa) (v02.00)':
    'Disc 1 — God of War Collection (v02.00)',
  'god of war iii (usa) (v02.00)': 'Disc 2 — God of War III (v02.00)',

  // Infamous Collection (PS3)
  'infamous (usa) (en,fr,es) (v02.00)': 'Disc 1 — Infamous (v02.00)',
  'infamous 2 (usa) (en,fr,es,pt) (v02.00)': 'Disc 2 — Infamous 2 (v02.00)',

  // Killzone Trilogy (PS3)
  'killzone trilogy (usa) (killzone + killzone 2)':
    'Disc 1 — Killzone + Killzone 2',

  // Metal Gear Solid: The Legacy Collection (PS3)
  'metal gear solid 4 - guns of the patriots (usa) (en,fr,de,es,it) (v02.00)':
    'Disc 1 — Metal Gear Solid 4: Guns of the Patriots (v02.00)',
  'metal gear solid - the legacy collection 1987-2012 (usa) (en,fr,es) (disc 2)':
    'Disc 2 — MGS2 + MGS3 + Peace Walker HD',
  'metal gear solid 4 - guns of the patriots (europe) (en,fr,de,es,it) (v02.00)':
    'Disc 1 — Metal Gear Solid 4: Guns of the Patriots (v02.00)',
  'metal gear solid - the legacy collection 1987-2012 (europe) (en,fr,de,es,it) (disc 2)':
    'Disc 2 — MGS2 + MGS3 + Peace Walker HD',
  'metal gear solid - the legacy collection 1987-2012 (japan) (disc 1)':
    'Disc 1 — MGS2 + MGS3 + Peace Walker HD',
  'metal gear solid 4 - guns of the patriots (japan) (v02.01)':
    'Disc 2 — Metal Gear Solid 4: Guns of the Patriots (v02.01)',

  // Mass Effect Trilogy (PS3 & Xbox 360)
  'mass effect (usa, asia) (en,fr,es)': 'Disc 1 — Mass Effect',
  'mass effect (europe) (en,fr,de,es,it)': 'Disc 1 — Mass Effect',
  'mass effect (usa, europe) (en,es,pl) (rev 1)':
    'Disc 1 — Mass Effect (Rev 1)',
  'mass effect (italy) (rev 1)': 'Disc 1 — Mass Effect (Rev 1)',
  'mass effect 3 (italy) (en,ja,fr,de,es,it,pl,ru) (disc 1) (rev 1)':
    'Disc 4 — Mass Effect 3 (Disc 1) (Rev 1)',
  'mass effect 3 (italy) (en,ja,fr,de,es,it,pl,ru) (disc 2) (rev 1)':
    'Disc 5 — Mass Effect 3 (Disc 2) (Rev 1)',

  // Far Cry Compilation (Xbox 360)
  'far cry 3 - blood dragon (usa) (en,fr,de,es,it,nl,pt,ru)':
    'Disc 3 — Far Cry 3: Blood Dragon',

  // Call of Duty: The War Collection (Xbox 360)
  'call of duty 2 (usa) (rev 1)': 'Disc 1 — Call of Duty 2 (Rev 1)',

  // Kinect Sports: Ultimate Collection (Xbox 360)
  'kinect sports (world) (en,ja,fr,de,es,it,nl,pt,zh,ko,pl,ru) (rev 1)':
    'Disc 1 — Kinect Sports (Rev 1)',

  // Assassin's Creed: Heritage Collection (Xbox 360)
  "assassin's creed ii - game of the year edition (europe) (en,fr,de,es,it,nl,sv,no,da)":
    "Disc 2 — Assassin's Creed II (GOTY)",
  "assassin's creed ii - game of the year edition (europe) (it,pl,ru)":
    "Disc 2 — Assassin's Creed II (GOTY)",
  "assassin's creed iii (europe) (en,fr,de,es,it,nl,pt,sv,no,da,fi) (disc 1) (rev 1)":
    "Disc 5 — Assassin's Creed III (Disc 1) (Rev 1)",
  "assassin's creed iii (europe) (en,fr,de,es,it,nl,pt,sv,no,da,fi) (disc 2) (rev 1)":
    "Disc 6 — Assassin's Creed III (Disc 2) (Rev 1)",
  "assassin's creed iii (europe) (pl,ru,cs,hu) (disc 1) (rev 1)":
    "Disc 5 — Assassin's Creed III (Disc 1) (Rev 1)",
  "assassin's creed iii (europe) (pl,ru,cs,hu) (disc 2) (rev 1)":
    "Disc 6 — Assassin's Creed III (Disc 2) (Rev 1)",

  // Grand Theft Auto: The Trilogy (PS2 & Xbox)
  'grand theft auto - vice city (usa, canada) (v3.00)':
    'Disc 2 — Grand Theft Auto: Vice City (v3.00)',
  'grand theft auto - vice city (usa) (v4.00)':
    'Disc 2 — Grand Theft Auto: Vice City (v4.00)',
  'grand theft auto - san andreas (usa) (v3.00) (rev 1)':
    'Disc 3 — Grand Theft Auto: San Andreas (v3.00, Rev 1)',
  'grand theft auto - vice city (usa) (rev 1)':
    'Disc 2 — Grand Theft Auto: Vice City (Rev 1)',
  'grand theft auto - vice city (europe) (en,fr,es,it) (rev 1)':
    'Disc 2 — Grand Theft Auto: Vice City (Rev 1)',
  'grand theft auto - vice city (australia) (rev 1)':
    'Disc 2 — Grand Theft Auto: Vice City (Rev 1)',
  'grand theft auto - san andreas (usa) (en,es) (rev 1)':
    'Disc 3 — Grand Theft Auto: San Andreas (Rev 1)',
  'grand theft auto - san andreas (europe) (en,fr,de,es,it) (rev 1)':
    'Disc 3 — Grand Theft Auto: San Andreas (Rev 1)',
  'grand theft auto - san andreas (germany) (rev 1)':
    'Disc 3 — Grand Theft Auto: San Andreas (Rev 1)',

  // Resident Evil: The Essentials (PS2)
  'resident evil - outbreak (usa) (v2.00)':
    'Disc 2 — Resident Evil Outbreak (v2.00)',

  // Crash Bandicoot Action Pack (PS2)
  'crash twinsanity (usa) (v2.00)': 'Disc 2 — Crash Twinsanity (v2.00)',

  // Retail Pack-In Bonus Discs
  'mega man legends 2 (usa) (demo)': 'Bonus Disc — Mega Man Legends 2 Demo',
};

export interface RetailPackInDiscSpec {
  /** Lowercase regex pattern matching the raw Redump/No-Intro ROM name (without extension) */
  romPattern: RegExp;
  /** Normalized title of the host retail game (lowercase alphanumeric) */
  hostGameNormTitle: string;
  /** Display title of the host retail game */
  hostGameDisplayTitle: string;
  /** Host game platform ID (e.g. 29 = PlayStation) */
  hostPlatformId: number;
  /** Explicit disc label in the host release */
  discLabel: string;
  /** Standalone companion game slug for cross-linking */
  companionGameSlug: string;
  /** Standalone companion game display title */
  companionGameTitle: string;
  /** Retail packaging provenance note */
  rationale: string;
}

export const RETAIL_PACKIN_DISCS: RetailPackInDiscSpec[] = [
  {
    romPattern: /^mega man legends 2.*\(demo\)/i,
    hostGameNormTitle: 'themisadventuresoftronbonne',
    hostGameDisplayTitle: 'The Misadventures of Tron Bonne',
    hostPlatformId: 29, // PlayStation
    discLabel: 'Bonus Disc — Mega Man Legends 2 Demo',
    companionGameSlug: 'mega-man-legends-2-playstation',
    companionGameTitle: 'Mega Man Legends 2',
    rationale:
      'Included as a physical bonus demo CD-ROM inside the North American retail jewel case of The Misadventures of Tron Bonne (SLUS-90087).',
  },
];

/**
 * Checks whether a ROM filename corresponds to a recognized commercial retail pack-in disc.
 */
export function findRetailPackInDisc(
  romName: string | null | undefined,
): RetailPackInDiscSpec | null {
  if (!romName) return null;
  const clean = romName
    .replace(/\.(?:xiso\.iso|[a-z0-9]{2,4})$/i, '')
    .trim()
    .toLowerCase();
  for (const spec of RETAIL_PACKIN_DISCS) {
    if (spec.romPattern.test(clean)) {
      return spec;
    }
  }
  return null;
}

export interface BoxSetCompanionSpec {
  /** Human-readable disc label in the box set (e.g. 'Disc 2 — Killzone 3') */
  discLabel: string;
  /** Normalized base title of the standalone game */
  standaloneNormTitle: string;
  /** Display title of the standalone game */
  standaloneDisplayTitle: string;
  /** Whether this disc is a virtual companion disc kept on the standalone game (true) or a re-homed disc already in the box set (false) */
  isVirtualCompanion: boolean;
  /** Optional substring required in the candidate companion ROM filename (e.g. '(disc 1)', '(v3.00)') */
  companionRomFilter?: string;
}

export interface BoxSetDefinition {
  /** Platform ID (32 = PS3, 48 = Xbox 360, 30 = PS2, 47 = Xbox) */
  platformId: number;
  /** Box set normalized title */
  boxSetNormTitle: string;
  /** Box set display title */
  boxSetDisplayTitle: string;
  /** Discs belonging to this box set (for companion disc injection and standalone cross-linking) */
  discs: BoxSetCompanionSpec[];
  /** Primary Redump / publisher product serial numbers */
  serials?: string[];
  /** Retail packaging provenance, novel disc presence, and voucher pack-in notes */
  rationale?: string;
  /** Verification source URLs (Redump, Wikipedia, MobyGames, etc.) */
  sources?: string[];
}

export const BOX_SET_DEFINITIONS: BoxSetDefinition[] = [
  {
    platformId: 32,
    boxSetNormTitle: 'godofwarsaga',
    boxSetDisplayTitle: 'God of War Saga',
    serials: ['BCUS-98481', 'BCUS-98482'],
    rationale:
      'Contains physical Blu-ray discs for God of War Collection (v02.00) and God of War III (v02.00), both unique to this box set. God of War: Origins Collection was included exclusively via a paper PSN voucher code.',
    sources: [
      'http://redump.org/disc/29815/',
      'http://redump.org/disc/29816/',
      'https://en.wikipedia.org/wiki/God_of_War_(franchise)#Collections_and_remasters',
    ],
    discs: [
      {
        discLabel: 'Disc 1 — God of War Collection (v02.00)',
        standaloneNormTitle: 'godofwarcollection',
        standaloneDisplayTitle: 'God of War Collection',
        isVirtualCompanion: false,
      },
      {
        discLabel: 'Disc 2 — God of War III (v02.00)',
        standaloneNormTitle: 'godofwariii',
        standaloneDisplayTitle: 'God of War III',
        isVirtualCompanion: false,
      },
    ],
  },
  {
    platformId: 32,
    boxSetNormTitle: 'infamouscollection',
    boxSetDisplayTitle: 'Infamous Collection',
    serials: ['BCUS-98483', 'BCUS-98484'],
    rationale:
      'Contains physical Blu-ray discs for Infamous (v02.00) and Infamous 2 (v02.00), both unique to this box set. Infamous: Festival of Blood was included via a paper PSN voucher code.',
    sources: [
      'http://redump.org/disc/29819/',
      'http://redump.org/disc/29820/',
      'https://en.wikipedia.org/wiki/Infamous_(video_game)#Collections',
    ],
    discs: [
      {
        discLabel: 'Disc 1 — Infamous (v02.00)',
        standaloneNormTitle: 'infamous',
        standaloneDisplayTitle: 'Infamous',
        isVirtualCompanion: false,
      },
      {
        discLabel: 'Disc 2 — Infamous 2 (v02.00)',
        standaloneNormTitle: 'infamous2',
        standaloneDisplayTitle: 'Infamous 2',
        isVirtualCompanion: false,
      },
    ],
  },
  {
    platformId: 32,
    boxSetNormTitle: 'killzonetrilogy',
    boxSetDisplayTitle: 'Killzone Trilogy',
    serials: ['BCUS-98379', 'BCUS-98380'],
    rationale:
      'Disc 1 is a unique physical Blu-ray disc combining the Killzone 1 HD remaster with Killzone 2; Disc 2 contains Killzone 3.',
    sources: [
      'http://redump.org/disc/30777/',
      'http://redump.org/disc/30778/',
      'https://en.wikipedia.org/wiki/Killzone_(series)#Killzone_Trilogy',
    ],
    discs: [
      {
        discLabel: 'Disc 1 — Killzone + Killzone 2',
        standaloneNormTitle: 'killzone2',
        standaloneDisplayTitle: 'Killzone 2',
        isVirtualCompanion: false,
      },
      {
        discLabel: 'Disc 2 — Killzone 3',
        standaloneNormTitle: 'killzone3',
        standaloneDisplayTitle: 'Killzone 3',
        isVirtualCompanion: false,
      },
    ],
  },
  {
    platformId: 32,
    boxSetNormTitle: 'metalgearsolidthelegacycollection',
    boxSetDisplayTitle: 'Metal Gear Solid: The Legacy Collection',
    serials: ['BLUS-31197', 'BLUS-31198'],
    rationale:
      'Disc 1 is MGS4 (v02.00) featuring Trophy support pre-patched on disc; Disc 2 is MGS HD Collection (MGS2, MGS3, Peace Walker). MGS1 and VR Missions were included via paper PSN voucher codes.',
    sources: [
      'http://redump.org/disc/33502/',
      'http://redump.org/disc/33503/',
      'https://en.wikipedia.org/wiki/Metal_Gear_Solid:_The_Legacy_Collection',
    ],
    discs: [
      {
        discLabel: 'Disc 1 — Metal Gear Solid 4: Guns of the Patriots (v02.00)',
        standaloneNormTitle: 'metalgearsolid4gunsofthepatriots',
        standaloneDisplayTitle: 'Metal Gear Solid 4: Guns of the Patriots',
        isVirtualCompanion: false,
      },
      {
        discLabel: 'Disc 2 — MGS2 + MGS3 + Peace Walker HD',
        standaloneNormTitle: 'metalgearsolidhdcollection',
        standaloneDisplayTitle: 'Metal Gear Solid HD Collection',
        isVirtualCompanion: false,
      },
    ],
  },
  {
    platformId: 32,
    boxSetNormTitle: 'masseffecttrilogy',
    boxSetDisplayTitle: 'Mass Effect Trilogy',
    serials: ['BLUS-31109', 'BLUS-31110', 'BLUS-31111'],
    rationale:
      'First and only physical Blu-ray release of the original Mass Effect on PS3 (standalone ME1 on PS3 was digital-only). Discs 2 and 3 contain ME2 and ME3.',
    sources: [
      'http://redump.org/disc/30971/',
      'http://redump.org/disc/30972/',
      'http://redump.org/disc/30973/',
      'https://en.wikipedia.org/wiki/Mass_Effect_(video_game)#Release',
    ],
    discs: [
      {
        discLabel: 'Disc 1 — Mass Effect',
        standaloneNormTitle: 'masseffect',
        standaloneDisplayTitle: 'Mass Effect',
        isVirtualCompanion: false,
      },
      {
        discLabel: 'Disc 2 — Mass Effect 2',
        standaloneNormTitle: 'masseffect2',
        standaloneDisplayTitle: 'Mass Effect 2',
        isVirtualCompanion: false,
      },
      {
        discLabel: 'Disc 3 — Mass Effect 3',
        standaloneNormTitle: 'masseffect3',
        standaloneDisplayTitle: 'Mass Effect 3',
        isVirtualCompanion: false,
      },
    ],
  },
  {
    platformId: 48,
    boxSetNormTitle: 'masseffecttrilogy',
    boxSetDisplayTitle: 'Mass Effect Trilogy',
    serials: [
      'X18-42220-01',
      'X18-42222-01',
      'X18-42223-01',
      'X18-42224-01',
      'X18-42225-01',
    ],
    rationale:
      '5-disc collection containing Mass Effect (Rev 1), Mass Effect 2 (Discs 1 & 2), and Mass Effect 3 (Discs 1 & 2).',
    sources: [
      'http://redump.org/disc/43818/',
      'http://redump.org/disc/36195/',
      'http://redump.org/disc/36196/',
      'http://redump.org/disc/40049/',
      'http://redump.org/disc/40050/',
    ],
    discs: [
      {
        discLabel: 'Disc 1 — Mass Effect (Rev 1)',
        standaloneNormTitle: 'masseffect',
        standaloneDisplayTitle: 'Mass Effect',
        isVirtualCompanion: false,
      },
      {
        discLabel: 'Disc 2 — Mass Effect 2 (Disc 1)',
        standaloneNormTitle: 'masseffect2',
        standaloneDisplayTitle: 'Mass Effect 2',
        isVirtualCompanion: false,
        companionRomFilter: '(disc 1)',
      },
      {
        discLabel: 'Disc 3 — Mass Effect 2 (Disc 2)',
        standaloneNormTitle: 'masseffect2',
        standaloneDisplayTitle: 'Mass Effect 2',
        isVirtualCompanion: false,
        companionRomFilter: '(disc 2)',
      },
      {
        discLabel: 'Disc 4 — Mass Effect 3 (Disc 1)',
        standaloneNormTitle: 'masseffect3',
        standaloneDisplayTitle: 'Mass Effect 3',
        isVirtualCompanion: false,
        companionRomFilter: '(disc 1)',
      },
      {
        discLabel: 'Disc 5 — Mass Effect 3 (Disc 2)',
        standaloneNormTitle: 'masseffect3',
        standaloneDisplayTitle: 'Mass Effect 3',
        isVirtualCompanion: false,
        companionRomFilter: '(disc 2)',
      },
    ],
  },
  {
    platformId: 48,
    boxSetNormTitle: 'farcrycompilation',
    boxSetDisplayTitle: 'Far Cry Compilation',
    rationale:
      'Packaged collection of Far Cry 2 and Far Cry 3 on separate physical DVDs. Far Cry 3: Blood Dragon was included via an Xbox Live Arcade voucher.',
    sources: [
      'https://www.mobygames.com/game/65004/far-cry-the-wild-expedition/',
      'https://en.wikipedia.org/wiki/Far_Cry#Compilations',
    ],
    discs: [
      {
        discLabel: 'Disc 1 — Far Cry 2',
        standaloneNormTitle: 'farcry2',
        standaloneDisplayTitle: 'Far Cry 2',
        isVirtualCompanion: true,
      },
      {
        discLabel: 'Disc 2 — Far Cry 3',
        standaloneNormTitle: 'farcry3',
        standaloneDisplayTitle: 'Far Cry 3',
        isVirtualCompanion: true,
      },
    ],
  },
  {
    platformId: 48,
    boxSetNormTitle: 'callofdutythewarcollection',
    boxSetDisplayTitle: 'Call of Duty: The War Collection',
    serials: ['84144.101.US'],
    rationale:
      '3-disc retail box set containing Call of Duty 2 (Rev 1, unique pressing for this collection), Call of Duty 3, and Call of Duty: World at War.',
    sources: [
      'http://redump.org/disc/35384/',
      'https://www.mobygames.com/game/47413/call-of-duty-the-war-collection/',
    ],
    discs: [
      {
        discLabel: 'Disc 1 — Call of Duty 2 (Rev 1)',
        standaloneNormTitle: 'callofduty2',
        standaloneDisplayTitle: 'Call of Duty 2',
        isVirtualCompanion: false,
      },
      {
        discLabel: 'Disc 2 — Call of Duty 3',
        standaloneNormTitle: 'callofduty3',
        standaloneDisplayTitle: 'Call of Duty 3',
        isVirtualCompanion: true,
      },
      {
        discLabel: 'Disc 3 — Call of Duty: World at War',
        standaloneNormTitle: 'callofdutyworldatwar',
        standaloneDisplayTitle: 'Call of Duty: World at War',
        isVirtualCompanion: true,
      },
    ],
  },
  {
    platformId: 48,
    boxSetNormTitle: 'kinectsportsultimatecollection',
    boxSetDisplayTitle: 'Kinect Sports: Ultimate Collection',
    serials: ['X18-42721-01', 'X18-40484-01'],
    rationale:
      '2-disc retail collection containing Kinect Sports (Rev 1, unique pressing for this collection) and Kinect Sports: Season Two.',
    sources: [
      'http://redump.org/disc/42721/',
      'https://www.mobygames.com/game/65005/kinect-sports-ultimate-collection/',
    ],
    discs: [
      {
        discLabel: 'Disc 1 — Kinect Sports (Rev 1)',
        standaloneNormTitle: 'kinectsports',
        standaloneDisplayTitle: 'Kinect Sports',
        isVirtualCompanion: false,
      },
      {
        discLabel: 'Disc 2 — Kinect Sports: Season Two',
        standaloneNormTitle: 'kinectsportsseasontwo',
        standaloneDisplayTitle: 'Kinect Sports: Season Two',
        isVirtualCompanion: true,
      },
    ],
  },
  {
    platformId: 48,
    boxSetNormTitle: 'assassinscreedheritagecollection',
    boxSetDisplayTitle: "Assassin's Creed: Heritage Collection",
    serials: ['3307215743477'],
    rationale:
      "5-disc European collection containing Assassin's Creed (Rev 1), Assassin's Creed II (GOTY), Brotherhood, Revelations, and Assassin's Creed III (Disc 1 Rev 1).",
    sources: [
      'http://redump.org/disc/43763/',
      'https://www.mobygames.com/game/65006/assassins-creed-heritage-collection/',
    ],
    discs: [
      {
        discLabel: "Disc 1 — Assassin's Creed",
        standaloneNormTitle: 'assassinscreed',
        standaloneDisplayTitle: "Assassin's Creed",
        isVirtualCompanion: false,
      },
      {
        discLabel: "Disc 2 — Assassin's Creed II (GOTY)",
        standaloneNormTitle: 'assassinscreedii',
        standaloneDisplayTitle: "Assassin's Creed II",
        isVirtualCompanion: false,
      },
      {
        discLabel: "Disc 3 — Assassin's Creed: Brotherhood",
        standaloneNormTitle: 'assassinscreedbrotherhood',
        standaloneDisplayTitle: "Assassin's Creed Brotherhood",
        isVirtualCompanion: false,
      },
      {
        discLabel: "Disc 4 — Assassin's Creed: Revelations",
        standaloneNormTitle: 'assassinscreedrevelations',
        standaloneDisplayTitle: "Assassin's Creed Revelations",
        isVirtualCompanion: false,
      },
      {
        discLabel: "Disc 5 — Assassin's Creed III (Disc 1) (Rev 1)",
        standaloneNormTitle: 'assassinscreediii',
        standaloneDisplayTitle: "Assassin's Creed III",
        isVirtualCompanion: false,
      },
    ],
  },
  {
    platformId: 30,
    boxSetNormTitle: 'grandtheftautothetrilogy',
    boxSetDisplayTitle: 'Grand Theft Auto: The Trilogy',
    serials: ['SLUS-20062', 'SLUS-20552', 'SLUS-20946'],
    rationale:
      '3-disc collection containing GTA III, GTA: Vice City, and a revised GTA: San Andreas (v3.00) pressing created specifically for the Trilogy release.',
    sources: [
      'http://redump.org/disc/2199/',
      'https://en.wikipedia.org/wiki/Grand_Theft_Auto:_The_Trilogy',
    ],
    discs: [
      {
        discLabel: 'Disc 1 — Grand Theft Auto III',
        standaloneNormTitle: 'grandtheftautoiii',
        standaloneDisplayTitle: 'Grand Theft Auto III',
        isVirtualCompanion: false,
      },
      {
        discLabel: 'Disc 2 — Grand Theft Auto: Vice City',
        standaloneNormTitle: 'grandtheftautovicecity',
        standaloneDisplayTitle: 'Grand Theft Auto: Vice City',
        isVirtualCompanion: false,
      },
      {
        discLabel: 'Disc 3 — Grand Theft Auto: San Andreas (v3.00)',
        standaloneNormTitle: 'grandtheftautosanandreas',
        standaloneDisplayTitle: 'Grand Theft Auto: San Andreas',
        isVirtualCompanion: false,
        companionRomFilter: '(v3.00)',
      },
    ],
  },
  {
    platformId: 47,
    boxSetNormTitle: 'grandtheftautothetrilogy',
    boxSetDisplayTitle: 'Grand Theft Auto: The Trilogy',
    rationale:
      '3-disc Xbox collection containing GTA III, GTA: Vice City (Rev 1), and GTA: San Andreas (Rev 1).',
    sources: [
      'http://redump.org/disc/28989/',
      'http://redump.org/disc/28990/',
      'http://redump.org/disc/28991/',
      'https://en.wikipedia.org/wiki/Grand_Theft_Auto:_The_Trilogy',
    ],
    discs: [
      {
        discLabel: 'Disc 1 — Grand Theft Auto III',
        standaloneNormTitle: 'grandtheftautoiii',
        standaloneDisplayTitle: 'Grand Theft Auto III',
        isVirtualCompanion: false,
      },
      {
        discLabel: 'Disc 2 — Grand Theft Auto: Vice City (Rev 1)',
        standaloneNormTitle: 'grandtheftautovicecity',
        standaloneDisplayTitle: 'Grand Theft Auto: Vice City',
        isVirtualCompanion: false,
      },
      {
        discLabel: 'Disc 3 — Grand Theft Auto: San Andreas (Rev 1)',
        standaloneNormTitle: 'grandtheftautosanandreas',
        standaloneDisplayTitle: 'Grand Theft Auto: San Andreas',
        isVirtualCompanion: false,
      },
    ],
  },
  {
    platformId: 30,
    boxSetNormTitle: 'residenteviltheessentials',
    boxSetDisplayTitle: 'Resident Evil: The Essentials',
    serials: ['SLUS-20184', 'SLUS-20708', 'SLUS-21134'],
    rationale:
      '3-disc collection containing Resident Evil Code: Veronica X, Resident Evil Outbreak (v2.00, revised pressing created for Essentials), and Resident Evil 4.',
    sources: [
      'http://redump.org/disc/2447/',
      'https://www.mobygames.com/game/27532/resident-evil-the-essentials/',
    ],
    discs: [
      {
        discLabel: 'Disc 1 — Resident Evil Code: Veronica X',
        standaloneNormTitle: 'residentevilcodeveronicax',
        standaloneDisplayTitle: 'Resident Evil Code: Veronica X',
        isVirtualCompanion: true,
      },
      {
        discLabel: 'Disc 2 — Resident Evil Outbreak (v2.00)',
        standaloneNormTitle: 'residenteviloutbreak',
        standaloneDisplayTitle: 'Resident Evil Outbreak',
        isVirtualCompanion: false,
      },
      {
        discLabel: 'Disc 3 — Resident Evil 4',
        standaloneNormTitle: 'residentevil4',
        standaloneDisplayTitle: 'Resident Evil 4',
        isVirtualCompanion: true,
      },
    ],
  },
  {
    platformId: 30,
    boxSetNormTitle: 'crashbandicootactionpack',
    boxSetDisplayTitle: 'Crash Bandicoot Action Pack',
    serials: ['SLUS-20649', 'SLUS-20909', 'SLUS-21147'],
    rationale:
      '3-disc collection containing Crash Nitro Kart, Crash Twinsanity (v2.00, revised pressing created for Action Pack), and Crash Tag Team Racing.',
    sources: [
      'http://redump.org/disc/2242/',
      'https://www.mobygames.com/game/27533/crash-bandicoot-action-pack/',
    ],
    discs: [
      {
        discLabel: 'Disc 1 — Crash Nitro Kart',
        standaloneNormTitle: 'crashnitrokart',
        standaloneDisplayTitle: 'Crash Nitro Kart',
        isVirtualCompanion: true,
      },
      {
        discLabel: 'Disc 2 — Crash Twinsanity (v2.00)',
        standaloneNormTitle: 'crashtwinsanity',
        standaloneDisplayTitle: 'Crash Twinsanity',
        isVirtualCompanion: false,
      },
      {
        discLabel: 'Disc 3 — Crash Tag Team Racing',
        standaloneNormTitle: 'crashtagteamracing',
        standaloneDisplayTitle: 'Crash Tag Team Racing',
        isVirtualCompanion: true,
      },
    ],
  },
];

export function getCuratedReleaseTags(
  rawName: string,
  regionStr: string | null,
  platformId?: number,
): string[] {
  const tags: string[] = [];
  if (!rawName) return tags;

  const rawLower = rawName.toLowerCase();

  // Never apply retail budget/superseded tags to betas, demos, prototypes, or title updates
  if (
    /\b(beta|proto|prototype|demo|kiosk|sample|promo|taikenban|title update)\b/i.test(
      rawLower,
    ) ||
    rawLower.startsWith('tu_')
  ) {
    return tags;
  }

  const normTitle = normalizeForLabelMatch(rawName);
  const regionTokens = (regionStr || '')
    .toLowerCase()
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);

  // 2a. Subsequent-version budget-exclusive pressings (exact ROM match without extension)
  const rawWithoutExt = rawLower
    .replace(/\.(?:xiso\.iso|[a-z0-9]{2,4})$/i, '')
    .trim();
  const subseqLabels = SUBSEQUENT_VERSION_BUDGET_EXCLUSIVES[rawWithoutExt];
  if (subseqLabels) {
    for (const lbl of subseqLabels) {
      if (!tags.includes(lbl)) {
        tags.push(lbl);
      }
    }
  }

  // 2b. Curated Special-Label Exclusives
  for (const rule of SPECIAL_LABEL_EXCLUSIVES) {
    if (rule.normalizedTitle !== normTitle) continue;
    if (platformId !== undefined && !rule.platformIds.includes(platformId)) {
      continue;
    }
    if (rule.excludeRawToken && rawLower.includes(rule.excludeRawToken)) {
      continue;
    }
    if (rule.requireRawToken && !rawLower.includes(rule.requireRawToken)) {
      continue;
    }
    if (rule.excludeRegions && rule.excludeRegions.length > 0) {
      if (regionTokens.some((r) => rule.excludeRegions!.includes(r))) {
        continue;
      }
    }
    if (rule.regions && rule.regions.length > 0) {
      if (!regionTokens.some((r) => rule.regions!.includes(r))) {
        continue;
      }
    }
    if (!tags.includes(rule.label)) {
      tags.push(rule.label);
    }
  }

  // 3. Superseded Original Releases (strict 1-disc subsets of later 2-disc GOTY/expanded sets)
  for (const pair of SUPERSEDED_RELEASE_PAIRS) {
    if (platformId !== undefined && pair.platformId !== platformId) {
      continue;
    }
    if (pair.originalNormalizedTitle !== normTitle) {
      continue;
    }
    if (pair.supersetRomMarker && rawLower.includes(pair.supersetRomMarker)) {
      continue;
    }
    if (
      pair.originalExcludeMarker &&
      rawLower.includes(pair.originalExcludeMarker)
    ) {
      continue;
    }
    if (pair.excludedRegions && pair.excludedRegions.length > 0) {
      if (regionTokens.some((r) => pair.excludedRegions!.includes(r))) {
        continue;
      }
    }
    if (pair.applicableRegions.length > 0) {
      if (!regionTokens.some((r) => pair.applicableRegions.includes(r))) {
        continue;
      }
    }
    if (!tags.includes('Superseded')) {
      tags.push('Superseded');
    }
  }

  return tags;
}

export interface VoucherBundleDefinition {
  /** Target platform ID (e.g. 33 = Vita, 26 = Switch) */
  platformId: number;
  /** Display title of the parent physical package */
  parentDisplayTitle: string;
  /** Normalized match title for the parent physical release */
  parentNormalizedTitle: string;
  /** Optional title aliases or variations */
  aliases?: string[];
  /** Titles of companion games included exclusively via digital voucher code */
  voucherTitles: string[];
  /** User-facing explanation of the physical vs voucher contents */
  note: string;
}

/**
 * Curated registry of multi-game retail packages where companion titles were
 * distributed exclusively via single-use digital download voucher codes rather than on physical media.
 * Vouchers are tracked purely as informational metadata on the physical parent release.
 * They carry zero backup expectations and never penalize collection completion stats.
 */
export const CANONICAL_VOUCHER_BUNDLES: VoucherBundleDefinition[] = [
  {
    platformId: 33, // Vita
    parentDisplayTitle: 'Final Fantasy X / X-2 HD Remaster',
    parentNormalizedTitle: normalizeForLabelMatch(
      'Final Fantasy X / X-2 HD Remaster',
    ),
    aliases: [
      normalizeForLabelMatch('Final Fantasy X/X-2 HD Remaster'),
      normalizeForLabelMatch(
        'Final Fantasy X and Final Fantasy X-2 HD Remaster',
      ),
    ],
    voucherTitles: ['Final Fantasy X-2 HD Remaster'],
    note: 'Original retail release contained Final Fantasy X HD Remaster on game card, plus a digital download voucher for Final Fantasy X-2 HD Remaster.',
  },
  {
    platformId: 33, // Vita
    parentDisplayTitle: 'The Sly Collection',
    parentNormalizedTitle: normalizeForLabelMatch('The Sly Collection'),
    aliases: [normalizeForLabelMatch('Sly Collection')],
    voucherTitles: ['Sly 3: Honor Among Thieves'],
    note: 'Original retail release contained Sly 1 and Sly 2 on game card, plus a digital download voucher for Sly 3: Honor Among Thieves.',
  },
  {
    platformId: 26, // Switch
    parentDisplayTitle: 'Mega Man Legacy Collection 1 + 2',
    parentNormalizedTitle: normalizeForLabelMatch(
      'Mega Man Legacy Collection 1 + 2',
    ),
    aliases: [
      normalizeForLabelMatch('Mega Man Legacy Collection 1 and 2'),
      normalizeForLabelMatch('Mega Man Legacy Collection 1 & 2'),
    ],
    voucherTitles: ['Mega Man Legacy Collection 2'],
    note: 'Original retail release contained Mega Man Legacy Collection on cartridge, plus a digital download voucher for Mega Man Legacy Collection 2.',
  },
  {
    platformId: 26, // Switch
    parentDisplayTitle: 'Resident Evil: Triple Pack',
    parentNormalizedTitle: normalizeForLabelMatch('Resident Evil: Triple Pack'),
    aliases: [normalizeForLabelMatch('Resident Evil Triple Pack')],
    voucherTitles: ['Resident Evil 5', 'Resident Evil 6'],
    note: 'Original retail release contained Resident Evil 4 on cartridge, plus digital download vouchers for Resident Evil 5 and Resident Evil 6.',
  },
  {
    platformId: 26, // Switch
    parentDisplayTitle: 'Resident Evil Revelations Collection',
    parentNormalizedTitle: normalizeForLabelMatch(
      'Resident Evil Revelations Collection',
    ),
    aliases: [normalizeForLabelMatch('Resident Evil: Revelations Collection')],
    voucherTitles: ['Resident Evil Revelations 2'],
    note: 'Original retail release contained Resident Evil Revelations on cartridge, plus a digital download voucher for Resident Evil Revelations 2.',
  },
  {
    platformId: 26, // Switch
    parentDisplayTitle: 'Bayonetta 2',
    parentNormalizedTitle: normalizeForLabelMatch('Bayonetta 2'),
    aliases: [],
    voucherTitles: ['Bayonetta'],
    note: 'Original standard retail release included a digital download voucher for the original Bayonetta.',
  },
  {
    platformId: 26, // Switch
    parentDisplayTitle: 'Borderlands Legendary Collection',
    parentNormalizedTitle: normalizeForLabelMatch(
      'Borderlands Legendary Collection',
    ),
    aliases: [],
    voucherTitles: ['Borderlands 2', 'Borderlands: The Pre-Sequel'],
    note: 'Original retail release contained Borderlands: Game of the Year Edition on cartridge, plus digital download vouchers for Borderlands 2 and Borderlands: The Pre-Sequel.',
  },
  {
    platformId: 26, // Switch
    parentDisplayTitle: 'Batman: Arkham Trilogy',
    parentNormalizedTitle: normalizeForLabelMatch('Batman: Arkham Trilogy'),
    aliases: [normalizeForLabelMatch('Batman Arkham Trilogy')],
    voucherTitles: ['Batman: Arkham City', 'Batman: Arkham Knight'],
    note: 'Original retail release contained Batman: Arkham Asylum on cartridge, plus digital download vouchers for Batman: Arkham City and Batman: Arkham Knight.',
  },
];
