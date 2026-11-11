/**
 * Canonical title, multi-disc, companion disc, and box-set grouping mappings
 * used by the collection list pipeline.
 */

export interface CompanionDiscPair {
  platformId: number;
  supersetStableId?: number;
  originalStableId?: number;
  supersetNormalizedTitle: string;
  originalNormalizedTitle: string;
  supersetRomMarker?: string;
  originalExcludeMarker?: string;
  excludedRegions?: string[];
}

/**
 * Pairs where a 2-disc GOTY/expanded release reuses the original 1-disc release
 * verbatim as Disc 1. Used so the GOTY release card requires BOTH Disc 1 (base game)
 * and Disc 2 (add-on/DLC) to be backed up before reporting backup_status = 1,
 * without altering ownership_status.
 */
export const COMPANION_DISC1_PAIRS: ReadonlyArray<CompanionDiscPair> = [
  {
    platformId: 48,
    supersetStableId: 3798,
    originalStableId: 3796,
    supersetNormalizedTitle: 'theelderscrollsivobliviongameoftheyearedition',
    originalNormalizedTitle: 'theelderscrollsivoblivion',
    originalExcludeMarker: 'collector',
    excludedRegions: ['japan', 'asia'],
  },
  {
    platformId: 48,
    supersetStableId: 3800,
    originalStableId: 3799,
    supersetNormalizedTitle: 'theelderscrollsvskyrimlegendaryedition',
    originalNormalizedTitle: 'theelderscrollsvskyrim',
    originalExcludeMarker: 'kinect sensor',
  },
  {
    platformId: 48,
    supersetStableId: 3808,
    originalStableId: 3808,
    supersetNormalizedTitle: 'fallout3gameoftheyearedition',
    originalNormalizedTitle: 'fallout3',
    supersetRomMarker: 'game of the year edition',
    originalExcludeMarker: 'add-on',
  },
  {
    platformId: 48,
    supersetStableId: 3785,
    originalStableId: 3784,
    supersetNormalizedTitle: 'dishonoredgameoftheyearedition',
    originalNormalizedTitle: 'dishonored',
  },
  {
    platformId: 48,
    supersetStableId: 3791,
    originalStableId: 3790,
    supersetNormalizedTitle: 'dragonageoriginsultimateedition',
    originalNormalizedTitle: 'dragonageorigins',
    originalExcludeMarker: 'tsuika contents',
    excludedRegions: ['japan'],
  },
  {
    platformId: 48,
    supersetStableId: 3732,
    originalStableId: 3731,
    supersetNormalizedTitle: 'borderlandsgameoftheyearedition',
    originalNormalizedTitle: 'borderlands',
    originalExcludeMarker: 'add-on',
    excludedRegions: ['japan'],
  },
  {
    platformId: 48,
    supersetStableId: 3734,
    originalStableId: 3733,
    supersetNormalizedTitle: 'borderlands2gameoftheyearedition',
    originalNormalizedTitle: 'borderlands2',
    originalExcludeMarker: 'add-on',
  },
  {
    platformId: 32,
    supersetStableId: 2373,
    originalStableId: 2372,
    supersetNormalizedTitle: 'borderlands2gameoftheyearedition',
    originalNormalizedTitle: 'borderlands2',
    originalExcludeMarker: 'add-on',
  },
  {
    platformId: 32,
    supersetStableId: 2463,
    originalStableId: 2462,
    supersetNormalizedTitle: 'killzonetrilogy',
    originalNormalizedTitle: 'killzone3',
  },
  {
    platformId: 48,
    originalStableId: 3809,
    supersetNormalizedTitle: 'falloutnewvegasultimateedition',
    originalNormalizedTitle: 'falloutnewvegas',
  },
  {
    platformId: 48,
    originalStableId: 3951,
    supersetNormalizedTitle: 'saintsrowthethirdthefullpackage',
    originalNormalizedTitle: 'saintsrowthethird',
  },
  {
    platformId: 48,
    originalStableId: 3866,
    supersetNormalizedTitle: 'mafiaii',
    originalNormalizedTitle: 'mafiaii',
    supersetRomMarker: 'add-on content disc',
    originalExcludeMarker: 'add-on content disc',
  },
  {
    platformId: 34,
    supersetNormalizedTitle: 'outlasttrinity',
    originalNormalizedTitle: 'outlastoutlastwhistleblower',
  },
  {
    platformId: 48,
    originalStableId: 3748,
    supersetNormalizedTitle: 'callofdutymodernwarfare2',
    originalNormalizedTitle: 'callofdutymodernwarfare2',
    supersetRomMarker: 'stimulus package',
    originalExcludeMarker: 'stimulus package',
  },
  {
    platformId: 20,
    supersetStableId: 692,
    originalStableId: 692,
    supersetNormalizedTitle: 'mariokartdoubledash',
    originalNormalizedTitle: 'mariokartdoubledash',
    supersetRomMarker: 'bonus disc',
    originalExcludeMarker: 'bonus disc',
  },
  {
    platformId: 20,
    supersetStableId: 718,
    originalStableId: 718,
    supersetNormalizedTitle: 'metroidprime2echoes',
    originalNormalizedTitle: 'metroidprime2echoes',
    supersetRomMarker: 'bonus disc',
    originalExcludeMarker: 'bonus disc',
  },
  {
    platformId: 20,
    supersetStableId: 748,
    originalStableId: 748,
    supersetNormalizedTitle: 'residentevil4',
    originalNormalizedTitle: 'residentevil4',
    supersetRomMarker: 'bonus disc',
    originalExcludeMarker: 'bonus disc',
  },
  {
    platformId: 29,
    supersetStableId: 1983,
    originalStableId: 1983,
    supersetNormalizedTitle: 'persona2eternalpunishment',
    originalNormalizedTitle: 'persona2eternalpunishment',
    supersetRomMarker: 'bonus disc',
    originalExcludeMarker: 'bonus disc',
  },
  {
    platformId: 29,
    supersetStableId: 1938,
    originalStableId: 1938,
    supersetNormalizedTitle: 'granturismo2',
    originalNormalizedTitle: 'granturismo2',
    supersetRomMarker: 'un cd bonus',
    originalExcludeMarker: 'un cd bonus',
  },
  {
    platformId: 30,
    supersetStableId: 2088,
    originalStableId: 2088,
    supersetNormalizedTitle: 'killzone',
    originalNormalizedTitle: 'killzone',
    supersetRomMarker: 'bonus disc',
    originalExcludeMarker: 'bonus disc',
  },
  {
    platformId: 47,
    supersetStableId: 3622,
    originalStableId: 3622,
    supersetNormalizedTitle: 'fable',
    originalNormalizedTitle: 'fable',
    supersetRomMarker: 'limited edition bonus dvd',
    originalExcludeMarker: 'bonus dvd',
  },
  {
    platformId: 47,
    supersetStableId: 3705,
    originalStableId: 3705,
    supersetNormalizedTitle: 'tomclancyssplintercell',
    originalNormalizedTitle: 'tomclancyssplintercell',
    supersetRomMarker: 'bonus disc',
    originalExcludeMarker: 'bonus disc',
  },
  {
    platformId: 48,
    supersetStableId: 3712,
    originalStableId: 3712,
    supersetNormalizedTitle: 'alanwake',
    originalNormalizedTitle: 'alanwake',
    supersetRomMarker: 'bonus disc',
    originalExcludeMarker: 'bonus disc',
  },
  {
    platformId: 48,
    supersetStableId: 3728,
    originalStableId: 3728,
    supersetNormalizedTitle:
      'bioshockinfinitethecompleteeditionbonuscontentdisc',
    originalNormalizedTitle: 'bioshockinfinite',
    supersetRomMarker: 'bonus content disc',
    originalExcludeMarker: 'bonus content disc',
  },
  {
    platformId: 48,
    supersetStableId: 3772,
    originalStableId: 3772,
    supersetNormalizedTitle: 'deadrising2',
    originalNormalizedTitle: 'deadrising2',
    supersetRomMarker: 'zombrex edition bonus disc',
    originalExcludeMarker: 'bonus disc',
  },
  {
    platformId: 48,
    supersetStableId: 3804,
    originalStableId: 3804,
    supersetNormalizedTitle: 'fableii',
    originalNormalizedTitle: 'fableii',
    supersetRomMarker: 'bonus disc',
    originalExcludeMarker: 'bonus disc',
  },
  {
    platformId: 48,
    supersetStableId: 3819,
    originalStableId: 3819,
    supersetNormalizedTitle: 'gearsofwar',
    originalNormalizedTitle: 'gearsofwar',
    supersetRomMarker: 'bonus disc',
    originalExcludeMarker: 'bonus disc',
  },
  {
    platformId: 48,
    supersetStableId: 3820,
    originalStableId: 3820,
    supersetNormalizedTitle: 'gearsofwar2',
    originalNormalizedTitle: 'gearsofwar2',
    supersetRomMarker: 'bonus disc',
    originalExcludeMarker: 'bonus disc',
  },
  {
    platformId: 48,
    supersetStableId: 3888,
    originalStableId: 3888,
    supersetNormalizedTitle: 'masseffect',
    originalNormalizedTitle: 'masseffect',
    supersetRomMarker: 'bonus disc',
    originalExcludeMarker: 'bonus disc',
  },
  {
    platformId: 48,
    supersetStableId: 3913,
    originalStableId: 3913,
    supersetNormalizedTitle: 'perfectdarkzero',
    originalNormalizedTitle: 'perfectdarkzero',
    supersetRomMarker: 'bonus disc',
    originalExcludeMarker: 'bonus disc',
  },
  {
    platformId: 48,
    supersetStableId: 3925,
    originalStableId: 3925,
    supersetNormalizedTitle: 'quake4',
    originalNormalizedTitle: 'quake4',
    supersetRomMarker: 'bonus disc',
    originalExcludeMarker: 'bonus disc',
  },
  {
    platformId: 48,
    supersetStableId: 3981,
    originalStableId: 3981,
    supersetNormalizedTitle: 'vivapinata',
    originalNormalizedTitle: 'vivapinata',
    supersetRomMarker: 'bonus disc',
    originalExcludeMarker: 'bonus disc',
  },
];

export const COMPILATION_DISC_SUBTITLES: Record<string, ReadonlySet<string>> = {
  'batman - return to arkham': new Set(['arkham asylum', 'arkham city']),
  'bioshock - the collection': new Set([
    'bioshock-bioshock 2 disc',
    'bioshock infinite disc',
  ]),
  'bioshock - ultimate rapture edition': new Set([
    'bioshock - bonus content',
    'bioshock 2 - bonus content',
  ]),
  'heavy rain & beyond - two souls collection': new Set([
    'heavy rain',
    'beyond - two souls',
  ]),
};

export const BOX_SET_ROM_GROUPING_MAP: Record<string, string> = {
  // 1. God of War Saga (PS3, USA)
  'god of war collection (usa) (v02.00)': 'multi:god of war saga (usa)',
  'god of war collection (usa, canada) (v02.00)': 'multi:god of war saga (usa)',
  'god of war iii (usa) (v02.00)': 'multi:god of war saga (usa)',
  'god of war iii (usa, canada) (v02.00)': 'multi:god of war saga (usa)',

  // 2. Infamous Collection (PS3, USA)
  'infamous (usa) (en,fr,es) (v02.00)': 'multi:infamous collection (usa)',
  'infamous (usa, canada) (en,fr,es) (v02.00)':
    'multi:infamous collection (usa)',
  'infamous 2 (usa) (en,fr,es,pt) (v02.00)': 'multi:infamous collection (usa)',
  'infamous 2 (usa, canada) (en,fr,es,pt) (v02.00)':
    'multi:infamous collection (usa)',

  // 3. Killzone Trilogy (PS3, USA)
  'killzone trilogy (usa) (killzone + killzone 2)':
    'multi:killzone trilogy (usa)',
  'killzone 3 (usa, brazil) (en,ja,fr,de,es,it,nl,pt,sv,no,da,fi,zh,ko,pl,ru,tr)':
    'multi:killzone trilogy (usa)',

  // 4. Metal Gear Solid: The Legacy Collection (PS3, USA / Europe / Japan)
  'metal gear solid - the legacy collection 1987-2012 (usa) (en,fr,es) (disc 2)':
    'multi:metal gear solid - the legacy collection 1987-2012 (usa)',
  'metal gear solid 4 - guns of the patriots (usa) (en,fr,de,es,it) (v02.00)':
    'multi:metal gear solid - the legacy collection 1987-2012 (usa)',
  'metal gear solid - the legacy collection 1987-2012 (europe) (en,fr,de,es,it) (disc 2)':
    'multi:metal gear solid - the legacy collection 1987-2012 (europe)',
  'metal gear solid 4 - guns of the patriots (europe) (en,fr,de,es,it) (v02.00)':
    'multi:metal gear solid - the legacy collection 1987-2012 (europe)',
  'metal gear solid - the legacy collection 1987-2012 (japan) (disc 1)':
    'multi:metal gear solid - the legacy collection 1987-2012 (japan)',
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

  // 6. Mass Effect Trilogy (Xbox 360, USA & Italy)
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
    'multi:grand theft auto - the trilogy (usa) (v4.00)',
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

  // 10. BioShock: Ultimate Rapture Edition (Xbox 360, USA / Europe)
  'bioshock - ultimate rapture edition (usa) (en,fr,de,es,it) (bioshock - bonus content)':
    'multi:bioshock - ultimate rapture edition (usa)',
  'bioshock - ultimate rapture edition (usa) (en,fr,de,es,it) (bioshock 2 - bonus content)':
    'multi:bioshock - ultimate rapture edition (usa)',
  'bioshock - ultimate rapture edition (usa, europe) (bioshock - bonus content)':
    'multi:bioshock - ultimate rapture edition (usa, europe)',
  'bioshock - ultimate rapture edition (usa, europe) (bioshock 2 - bonus content)':
    'multi:bioshock - ultimate rapture edition (usa, europe)',
};

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

export function isCompilationDiscSubtitle(
  content: string,
  fullReleaseName?: string | null,
): boolean {
  if (!fullReleaseName) return false;
  const normContent = content.toLowerCase().trim();
  const normRelease = fullReleaseName.toLowerCase().trim();
  for (const [prefix, subtitles] of Object.entries(
    COMPILATION_DISC_SUBTITLES,
  )) {
    if (normRelease.startsWith(prefix) && subtitles.has(normContent)) {
      return true;
    }
  }
  return false;
}

export function hasDiscIndicator(filename: string | null | undefined): boolean {
  if (!filename) {
    return false;
  }
  const numberedDiscRegex =
    /[-_\s]*\((?:disc|disco|disque|disk|side)\s+[a-zA-Z0-9]+(?:\s+of\s+[0-9]+|\s*[/\\]\s*[0-9]+)?(?:\s*[-:]\s*[^)]+)?\)/i;
  if (numberedDiscRegex.test(filename)) return true;

  const bareDiscRegex =
    /[-_\s]+(?:disc|disco|disque|disk)\s+[a-zA-Z0-9]+(?:\s+of\s+[0-9]+)?\b/i;
  if (bareDiscRegex.test(filename)) return true;

  const roleDiscRegex =
    /\((?:play\s+disc|data\s+disc|data\s+installation\s+disc|installation\s+disc|install\s+disc|game\s+disc|key\s+disc|install|play|single\s+player|single-player|single\s+player\s+disc|multiplayer|multiplayer\s+disc|campaign|campaign\s+disc|campanha|cinematics\s+disc|movie\s+disc|soundtrack\s+disc|add-on\s+disc|add-on\s+content\s+disc|additional\s+content\s+packs\s+install\s+disc|expansion\s+disk|expansion\s+disc|voice\s+over\s+pack|dlc\s+installer|tsuika\s+contents\s+disc)\)/i;
  if (roleDiscRegex.test(filename)) return true;

  const parentheticals = filename.match(/\(([^)]+)\)/g);
  if (parentheticals) {
    for (const m of parentheticals) {
      const inner = m.slice(1, -1).trim();
      if (isCompilationDiscSubtitle(inner, filename)) {
        return true;
      }
    }
  }
  return false;
}

export function stripDiscIndicator(
  filename: string | null | undefined,
): string {
  if (!filename) {
    return '';
  }

  const lastDot = filename.lastIndexOf('.');
  let base = lastDot !== -1 ? filename.slice(0, lastDot) : filename;
  const baseLower = base.toLowerCase();

  // Normalize cross-region companion Disc 2s that share a retail box with a single-region Disc 1
  if (baseLower.startsWith('halo 3 - odst')) {
    base = base
      .replace(/\(usa,\s*brazil\)/gi, '(USA)')
      .replace(/\(europe,\s*asia\)/gi, '(Europe, Australia)');
  }

  const hasNumberedDisc =
    /[-_\s]*\((?:disc|disco|disque|disk|side)\s+[a-zA-Z0-9]+(?:\s+of\s+[0-9]+|\s*[/\\]\s*[0-9]+)?(?:\s*[-:]\s*[^)]+)?\)/i.test(
      base,
    );

  base = base.replace(
    /[-_\s]*\((?:disc|disco|disque|disk|side)\s+[a-zA-Z0-9]+(?:\s+of\s+[0-9]+|\s*[/\\]\s*[0-9]+)?(?:\s*[-:]\s*[^)]+)?\)/gi,
    '',
  );
  base = base.replace(
    /[-_\s]+(?:disc|disco|disque|disk)\s+[a-zA-Z0-9]+(?:\s+of\s+[0-9]+)?\b/gi,
    '',
  );

  // Strip role-based disc parentheticals
  base = base.replace(
    /[-_\s]*\((?:play\s+disc|data\s+disc|data\s+installation\s+disc|installation\s+disc|install\s+disc|game\s+disc|key\s+disc|install|play|single\s+player|single-player|single\s+player\s+disc|multiplayer|multiplayer\s+disc|campaign|campaign\s+disc|campanha|cinematics\s+disc|movie\s+disc|soundtrack\s+disc|add-on\s+disc|add-on\s+content\s+disc|additional\s+content\s+packs\s+install\s+disc|expansion\s+disk|expansion\s+disc|voice\s+over\s+pack|dlc\s+installer|tsuika\s+contents\s+disc)\)/gi,
    '',
  );

  // Strip compilation-scoped disc subtitles
  base = base.replace(/[-_\s]*\(([^)]+)\)/g, (full, inner: string) => {
    if (isCompilationDiscSubtitle(inner, filename)) {
      return '';
    }
    return full;
  });

  // Strip Japanese parenthetical counting indicators (e.g. "Ichi", "Ni" etc.) when used alongside or as disc indicators
  base = base.replace(/[-_\s]*\((?:ichi|ni|san|yon|shi|go)\)/gi, '');

  // If the ROM had a numbered (Disc N) marker, also strip per-disc content subtitles
  if (hasNumberedDisc) {
    base = base.replace(/\(([^)]+)\)/g, (full, inner: string) => {
      const t = inner.trim().toLowerCase();
      if (
        baseLower.startsWith('metal gear solid 3 - subsistence') &&
        /^(?:limited edition|shokai seisanban)$/i.test(t)
      ) {
        return '';
      }
      if (
        /^(?:usa|japan|europe|world|asia|korea|china|taiwan|australia|brazil|canada|france|germany|italy|spain|netherlands|sweden|norway|denmark|finland|russia|poland|portugal|greece|turkey|india|south africa|latin america|united kingdom|scandinavia|united arab emirates|austria|switzerland|ireland|hong kong|mexico|new zealand|unknown)(?:\s*,\s*[a-z\s]+)*$/i.test(
          t,
        )
      ) {
        return full;
      }
      if (
        /^[a-z]{2,3}(?:-[a-z]{2,4})?(?:,[a-z]{2,3}(?:-[a-z]{2,4})?)*$/i.test(t)
      ) {
        return full;
      }
      if (
        /^(?:rev\s*[a-z0-9.]+|v[0-9]+(?:\.[0-9a-z]+)*|alt(?:\s+[0-9]+)?|edc|no\s+edc|limited\s+edition|collector's\s+edition|special\s+edition|game\s+of\s+the\s+year\s+edition|complete\s+edition|gold\s+edition|platinum\s+hits|greatest\s+hits|black\s+label|nintendo\s+selects|player's\s+choice)$/i.test(
          t,
        )
      ) {
        return full;
      }
      return '';
    });
  }

  base = base.replace(/\s+/g, ' ').trim();
  base = base.replace(/[-_]$/, '').trim();

  return base.toLowerCase();
}

export function getRomGroupingKey(filename: string | null | undefined): string {
  if (!filename) {
    return '';
  }
  const lastDot = filename.lastIndexOf('.');
  const base = (
    lastDot !== -1 ? filename.slice(0, lastDot) : filename
  ).toLowerCase();
  if (BOX_SET_ROM_GROUPING_MAP[base]) {
    return BOX_SET_ROM_GROUPING_MAP[base];
  }
  if (hasDiscIndicator(filename)) {
    return `multi:${stripDiscIndicator(filename)}`;
  }
  return `single:${base}`;
}
