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
  if (/,\s*the$/i.test(clean)) {
    clean = 'the ' + clean.replace(/,\s*the$/i, '');
  } else if (clean.toLowerCase().includes(', the - ')) {
    clean = 'the ' + clean.replace(/,\s*the\s*-\s*/i, ' - ');
  }
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
  {
    normalizedTitle: 'pikmin2',
    platformIds: [22],
    label: 'New Play Control!',
    regions: ['europe', 'australia', 'japan'],
    releaseDate: '2009-03-12',
    serialOrRevision: 'RVL-R2WJ-JPN / RVL-R2WP-EUR',
    rationale:
      'Released on Wii in Japan, Europe, and Australia under the New Play Control! (Asobi Kataensaku) widescreen/pointer-control port line.',
    sources: [
      'https://www.mariowiki.com/Pikmin_2_(New_Play_Control!)',
      'https://en.wikipedia.org/wiki/New_Play_Control!',
    ],
  },
  {
    normalizedTitle: 'pikmin',
    platformIds: [22],
    label: 'New Play Control!',
    regions: ['usa', 'europe', 'australia', 'japan', 'korea'],
    releaseDate: '2008-12-25',
    serialOrRevision: 'RVL-R9IE-USA / RVL-R9IP-EUR / RVL-R9IJ-JPN',
    rationale:
      'Wii port of the GameCube original released exclusively under the New Play Control! line.',
    sources: ['https://en.wikipedia.org/wiki/New_Play_Control!'],
  },
  {
    normalizedTitle: 'mariopowertennis',
    platformIds: [22],
    label: 'New Play Control!',
    regions: ['usa', 'europe', 'australia', 'japan'],
    releaseDate: '2009-03-09',
    serialOrRevision: 'RVL-RMAJ-JPN / RVL-RMAE-USA / RVL-RMAP-EUR',
    rationale:
      'Wii port of Mario Power Tennis launched under the New Play Control! banner in 2009 (and later reprinted as Nintendo Selects in 2012).',
    sources: [
      'https://www.mariowiki.com/New_Play_Control!_Mario_Power_Tennis',
      'https://en.wikipedia.org/wiki/New_Play_Control!',
    ],
  },
  {
    normalizedTitle: 'donkeykongjunglebeat',
    platformIds: [22],
    label: 'New Play Control!',
    regions: ['usa', 'europe', 'australia', 'japan'],
    releaseDate: '2008-12-11',
    serialOrRevision: 'RVL-R49J-JPN / RVL-R49E-USA / RVL-R49P-EUR',
    rationale:
      'Wii port of Donkey Kong Jungle Beat released exclusively under the New Play Control! banner.',
    sources: ['https://en.wikipedia.org/wiki/New_Play_Control!'],
  },
  {
    normalizedTitle: 'chibirobo',
    platformIds: [22],
    label: 'New Play Control!',
    regions: ['japan'],
    releaseDate: '2009-06-11',
    serialOrRevision: 'RVL-R24J-JPN',
    rationale:
      'Wii port of Chibi-Robo! released exclusively in Japan under the New Play Control! (Asobi Kataensaku) line.',
    sources: ['https://en.wikipedia.org/wiki/New_Play_Control!'],
  },
  {
    normalizedTitle: 'metroidprime',
    platformIds: [22],
    label: 'New Play Control!',
    regions: ['japan'],
    releaseDate: '2009-02-19',
    serialOrRevision: 'RVL-R3IJ-JPN',
    rationale:
      'Standalone Wii port of Metroid Prime released in Japan under the New Play Control! line.',
    sources: ['https://en.wikipedia.org/wiki/New_Play_Control!'],
  },
  {
    normalizedTitle: 'metroidprime2darkechoes',
    platformIds: [22],
    label: 'New Play Control!',
    regions: ['japan'],
    releaseDate: '2009-06-11',
    serialOrRevision: 'RVL-R32J-JPN',
    rationale:
      'Standalone Wii port of Metroid Prime 2 released in Japan under the New Play Control! line.',
    sources: ['https://en.wikipedia.org/wiki/New_Play_Control!'],
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
    platformId: 32, // PlayStation 3
    originalNormalizedTitle: 'metalgearsolid4gunsofthepatriots',
    originalDisplayTitle: 'Metal Gear Solid 4: Guns of the Patriots',
    originalStableId: 2520,
    supersetNormalizedTitle: 'metalgearsolidthelegacycollection19872012',
    supersetDisplayTitle: 'Metal Gear Solid: The Legacy Collection',
    supersetStableId: 2523,
    applicableRegions: ['usa', 'canada', 'europe'],
    excludedRegions: ['japan', 'asia', 'korea'],
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

  // 1. Title-embedded special labels (hyphenated or prefix-based in Redump/No-Intro)
  if (/-\s*essentials(?:\s+edition)?\b/i.test(rawName)) {
    tags.push('Essentials');
  }
  if (/^classic nes series\s*-/i.test(rawName)) {
    tags.push('Classic NES Series');
  } else if (/^nes classics\s*-/i.test(rawName)) {
    tags.push('NES Classics');
  } else if (/^famicom mini\b/i.test(rawName)) {
    tags.push('Famicom Mini');
  }

  const normTitle = normalizeForLabelMatch(rawName);
  const regionTokens = (regionStr || '')
    .toLowerCase()
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);

  // 2. Curated Special-Label Exclusives
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
