/**
 * PURE DAT FORMAT & STRING MATCHING UTILITIES
 *
 * Lightweight, zero-dependency string extraction, region extraction, variant extraction,
 * and platform matching routines.
 *
 * Safe for execution across both Cloudflare Workers edge isolates and local Node runtimes.
 */

import { getCuratedReleaseTags } from './special_labels.js';

/**
 * Interface representing a platform database record.
 */
export interface PlatformRecord {
  id: number;
  name: string;
  display_name: string;
}

/**
 * Matches standard and localized numbered disc/side indicators:
 * e.g., "Disc 1", "Disco 2", "Disque 1", "Disk A", "Side B", "Disc 1 of 2".
 */
export const NUMBERED_DISC_REGEX =
  /^(?:disc|disco|disque|disk|side)\s+[a-zA-Z0-9]+(?:\s+of\s+[0-9]+|\s*[/\\\\]\s*[0-9]+)?$/i;

/**
 * Matches Japanese counting disc indicators: Ichi, Ni, San, Yon, Shi, Go.
 */
export const JP_DISC_REGEX = /^(?:ichi|ni|san|yon|shi|go)$/i;

/**
 * Recognized disc-role parentheticals that identify a disc's function within
 * a multi-disc retail box rather than a separate edition/variant.
 */
export const DISC_ROLE_INDICATORS = new Set<string>([
  'play disc',
  'data disc',
  'data installation disc',
  'installation disc',
  'install disc',
  'game disc',
  'key disc',
  'install',
  'play',
  'single player',
  'single-player',
  'multiplayer',
  'campaign',
  'campanha',
  'add-on disc',
  'add-on content disc',
  'expansion disk',
  'expansion disc',
  'additional content packs install disc',
  'zusaetzliche inhaltspacks installations-disc',
  'tsuika contents disc',
  'dlc installer',
  'voice over pack',
  'game',
  'bioshock-bioshock 2 disc',
  'bioshock infinite disc',
  'heavy rain',
  'beyond - two souls',
]);

/**
 * Checks if a parenthetical inner string is a disc/side or disc-role indicator.
 */
export function isDiscOrRoleIndicator(content: string): boolean {
  const normalized = content.toLowerCase().trim();
  if (NUMBERED_DISC_REGEX.test(normalized)) return true;
  if (JP_DISC_REGEX.test(normalized)) return true;
  if (DISC_ROLE_INDICATORS.has(normalized)) return true;
  return false;
}

const REGIONS_MAP: Record<string, string> = {
  usa: 'USA',
  europe: 'Europe',
  japan: 'Japan',
  world: 'World',
  asia: 'Asia',
  france: 'France',
  germany: 'Germany',
  australia: 'Australia',
  uk: 'UK',
  'united kingdom': 'UK',
  canada: 'Canada',
  korea: 'Korea',
  brazil: 'Brazil',
  spain: 'Spain',
  italy: 'Italy',
  netherlands: 'Netherlands',
  sweden: 'Sweden',
  russia: 'Russia',
  china: 'China',
  taiwan: 'Taiwan',
  portugal: 'Portugal',
  denmark: 'Denmark',
  norway: 'Norway',
  finland: 'Finland',
  'hong kong': 'Hong Kong',
  hongkong: 'Hong Kong',
  latam: 'Latin America',
  'latin america': 'Latin America',
  nz: 'New Zealand',
  'new zealand': 'New Zealand',
  scandinavia: 'Scandinavia',
  poland: 'Poland',
  austria: 'Austria',
  switzerland: 'Switzerland',
  ireland: 'Ireland',
  turkey: 'Turkey',
  'united arab emirates': 'United Arab Emirates',
  uae: 'United Arab Emirates',
  greece: 'Greece',
  'south africa': 'South Africa',
  india: 'India',
  mexico: 'Mexico',
  belgium: 'Belgium',
  israel: 'Israel',
  croatia: 'Croatia',
  czech: 'Czech Republic',
  hungary: 'Hungary',
  slovakia: 'Slovakia',
};

const RECOGNIZED_REGIONS = new Set<string>([
  ...Object.keys(REGIONS_MAP),
  'unknown',
]);

const RECOGNIZED_LANGUAGES = new Set<string>([
  'en',
  'fr',
  'de',
  'es',
  'it',
  'nl',
  'pt',
  'sv',
  'no',
  'da',
  'fi',
  'pl',
  'ru',
  'ja',
  'zh',
  'ko',
  'el',
  'tr',
  'uk',
  'ar',
  'he',
  'th',
  'vi',
  'cs',
  'hu',
  'hr',
  'sk',
  'ro',
  'hi',
  'bg',
  'ca',
  'sl',
  'is',
  'id',
  'lt',
  'lv',
  'et',
  'sr',
  'ms',
  'tl',
  'af',
  'eu',
  'gl',
  'hant',
  'hans',
  'zh-hant',
  'zh-hans',
  'pt-br',
  'pt-pt',
  'es-xl',
  'es-la',
  'es-es',
  'fr-ca',
  'en-gb',
  'en-us',
  'm1',
  'm2',
  'm3',
  'm4',
  'm5',
  'm6',
  'm7',
  'm8',
  'm9',
  'multi1',
  'multi2',
  'multi3',
  'multi4',
  'multi5',
  'multi6',
  'multi7',
  'multi8',
  'multi9',
  'english',
  'french',
  'german',
  'spanish',
  'italian',
  'dutch',
  'portuguese',
  'swedish',
  'norwegian',
  'danish',
  'finnish',
  'polish',
  'russian',
  'japanese',
  'chinese',
  'korean',
  'czech',
  'hungarian',
  'greek',
  'turkish',
  'arabic',
  'hebrew',
  'thai',
  'vietnamese',
  'croatian',
  'slovak',
  'romanian',
  'hindi',
  'bulgarian',
  'catalan',
  'slovenian',
  'icelandic',
  'indonesian',
]);

/**
 * Checks if a string content consists entirely of regions, languages, or disc indicators.
 * Used to separate variants from language/region/disc parentheticals.
 *
 * @param content Parenthetical inner content.
 * @returns True if it is a region, language, or disc, false otherwise.
 */
export function isRegionOrLanguageOrDisc(content: string): boolean {
  const normalized = content.toLowerCase().trim();
  if (!normalized) return true;

  if (isDiscOrRoleIndicator(normalized)) return true;
  if (RECOGNIZED_REGIONS.has(normalized)) return true;

  // First split by comma, slash, or plus to keep multi-word regions (e.g., "United Kingdom", "Latin America")
  // and hyphenated language tags (e.g., "Zh-Hant", "Pt-BR") intact.
  const commaSegments = normalized.split(/[,/+\\]+/);
  const allCommaSegmentsMatch = commaSegments.every((seg) => {
    const s = seg.trim();
    if (!s) return true;
    return RECOGNIZED_REGIONS.has(s) || RECOGNIZED_LANGUAGES.has(s);
  });
  if (allCommaSegmentsMatch) return true;

  // Fallback token split for space/hyphen-separated language/region lists
  const parts = normalized.split(/[\s,/\-\\+]+/);
  return parts.every((part) => {
    const p = part.trim();
    if (!p) return true;
    return RECOGNIZED_REGIONS.has(p) || RECOGNIZED_LANGUAGES.has(p);
  });
}

/**
 * Determines whether a parenthetical on a numbered multi-disc release is a true
 * edition/revision/hardware variant (returns true) vs. a per-disc content subtitle
 * like "(Red Dead Redemption Single Player)", "(Subsistence)", "(Dante)" (returns false).
 */
export function isTrueEditionOrRevisionVariant(content: string): boolean {
  const lower = content.toLowerCase().trim();

  // 1. Revisions, versions, firmware, and Sony/Nintendo serial/build codes
  if (
    /^(?:rev\s*[a-z0-9.]+|v\d+(?:\.\d+)*[a-z]?|alt(?:\s+\d+)?|fw\d+(?:\.\d+)*|cusa-\d+|second printing)$/i.test(
      lower,
    )
  ) {
    return true;
  }

  // 2. Pre-release, demo, prototype, sample, kiosk
  if (
    /\b(?:beta|proto|prototype|demo|kiosk|sample|promo|taikenban)\b/i.test(
      lower,
    )
  ) {
    return true;
  }

  // 3. Recognized retail editions, budget lines, hardware enhancements, or compilations
  if (
    /\b(?:limited edition|collector'?s edition|special edition|deluxe|gold edition|day one edition|complete edition|game of the year|goty|greatest hits|platinum|playstation.*the best|rockstar classics|classic|essentials|nintendo selects|player'?s choice|new play control|shindou|genteiban|shokai|tokubetsu|premium|bundle|walmart|gamestop|best buy|target|amazon|edc|sgb|gb compatible|ndsi|virtual console|switch online|lodgenet|sega channel|e-reader|retro-bit|iam8bit|limited run|rerel|reprint)\b/i.test(
      lower,
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Extracts region codes from a release title.
 *
 * @param name The raw release name containing parentheses.
 * @returns Comma-separated region string or null.
 */
export function extractRegions(name: string): string | null {
  if (!name) return null;

  // Normalize cross-region companion Disc 2s that share a retail box with a single-region Disc 1
  const nameLower = name.toLowerCase();
  if (nameLower.startsWith('halo 3 - odst')) {
    if (nameLower.includes('(usa, brazil)') && nameLower.includes('(disc 2)')) {
      return 'USA';
    }
    if (
      nameLower.includes('(europe, asia)') &&
      nameLower.includes('(disc 2)')
    ) {
      return 'Europe, Australia';
    }
  }
  if (
    nameLower.startsWith('resident evil 6') &&
    nameLower.includes('(usa, europe)') &&
    nameLower.includes('(disc 2)') &&
    nameLower.includes('(voice over pack)')
  ) {
    return 'World';
  }

  const found: string[] = [];
  const parentheticalMatches = name.match(/\(([^)]+)\)/g);
  if (parentheticalMatches) {
    for (const match of parentheticalMatches) {
      const content = match.slice(1, -1);
      // Split by comma or slash first to preserve multi-word regions like "United Kingdom", "Latin America", "Hong Kong"
      const segments = content.split(/[,/]+/);
      for (const seg of segments) {
        const cleanSeg = seg.trim().toLowerCase();
        if (REGIONS_MAP[cleanSeg]) {
          const mapped = REGIONS_MAP[cleanSeg];
          if (!found.includes(mapped)) {
            found.push(mapped);
          }
          continue;
        }
        // Fallback: split by whitespace if segment wasn't a multi-word region
        const parts = cleanSeg.split(/\s+/);
        for (const part of parts) {
          const cleanPart = part.trim().toLowerCase();
          if (REGIONS_MAP[cleanPart]) {
            const mapped = REGIONS_MAP[cleanPart];
            if (!found.includes(mapped)) {
              found.push(mapped);
            }
          }
        }
      }
    }
  }
  return found.length > 0 ? found.join(', ') : null;
}

/**
 * Extracts variant indicators (such as 'Beta', 'Proto', 'Rev 1', 'Greatest Hits',
 * 'Nintendo Selects', 'Superseded') from a release title while ignoring regions,
 * languages, disc indicators, and per-disc subtitles on multi-disc sets.
 *
 * @param name Raw release name containing parenthetical variants.
 * @param platformId Optional platform ID for curated special-label and superseded lookups.
 * @returns Comma-separated list of variants, or null.
 */
export function extractVariants(
  name: string,
  platformId?: number,
): string | null {
  if (!name) return null;

  const found: string[] = [];
  const parentheticalMatches = name.match(/\(([^)]+)\)/g);

  // Check if this release is a numbered multi-disc entry (e.g. (Disc 1), (Disco 2), (Disque 1))
  const hasNumberedDisc = Boolean(
    parentheticalMatches?.some((m) => {
      const inner = m.slice(1, -1).trim();
      return NUMBERED_DISC_REGEX.test(inner) || JP_DISC_REGEX.test(inner);
    }),
  );

  const isDateToken = (token: string): boolean =>
    /^(?:19|20)\d{2}(?:[-./]\d{1,2}(?:[-./]\d{1,2}(?:[T\s_-][0-9a-z:.]+)?)?)?$/i.test(
      token.trim(),
    ) || /^\d{1,2}[-./]\d{1,2}[-./](?:19|20)\d{2}$/.test(token.trim());

  if (parentheticalMatches) {
    for (const match of parentheticalMatches) {
      const rawContent = match.slice(1, -1).trim();
      if (!isRegionOrLanguageOrDisc(rawContent)) {
        // Ignore pure build dates and timestamps on Beta/Proto/Demo/Debug ROMs (e.g. "1998-07-16", "2006-12-14 17.05")
        if (isDateToken(rawContent)) {
          continue;
        }
        // Strip comma-separated build dates inside compound parentheticals (e.g. "Climax, 2004-05-31" -> "Climax")
        const content = rawContent
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s && !isDateToken(s))
          .join(', ');
        if (!content) {
          continue;
        }
        // If this is a numbered multi-disc release, ignore per-disc content subtitles
        // (e.g. "(Red Dead Redemption Single Player)", "(Undead Nightmare and Multiplayer)",
        // "(Subsistence)", "(Persistence)", "(Existence)", "(Dante)", "(Lucia)")
        if (hasNumberedDisc && !isTrueEditionOrRevisionVariant(content)) {
          continue;
        }
        // Special case for MGS3 Subsistence Disc 3 where "(Limited Edition)" or "(Shokai Seisanban)"
        // was only tagged on Disc 3 in Redump
        if (
          hasNumberedDisc &&
          name.toLowerCase().startsWith('metal gear solid 3 - subsistence') &&
          /^(?:limited edition|shokai seisanban)$/i.test(content)
        ) {
          continue;
        }
        if (!found.includes(content)) {
          found.push(content);
        }
      }
    }
  }

  // Append curated special-label tags (e.g. Nintendo Selects, Platinum Hits, Greatest Hits,
  // New Play Control!, Player's Choice, Essentials, Classic NES Series) and Superseded tag
  const regionStr = extractRegions(name);
  const curatedTags = getCuratedReleaseTags(name, regionStr, platformId);
  for (const tag of curatedTags) {
    if (
      !found.some((existing) => existing.toLowerCase() === tag.toLowerCase())
    ) {
      found.push(tag);
    }
  }

  return found.length > 0 ? found.join(', ') : null;
}

/**
 * Extracts a human-readable per-disc label (e.g., "Disc 1 • Red Dead Redemption Single Player",
 * "Play Disc", "Add-On Disc") from a ROM filename for display in the detail view.
 */
export function extractDiscLabel(
  romName: string | null | undefined,
): string | null {
  if (!romName) return null;
  const parentheticalMatches = romName.match(/\(([^)]+)\)/g);
  if (!parentheticalMatches) return null;

  let discNumberPart: string | null = null;
  let subtitlePart: string | null = null;

  for (const match of parentheticalMatches) {
    const content = match.slice(1, -1).trim();
    const lower = content.toLowerCase();
    if (NUMBERED_DISC_REGEX.test(lower)) {
      discNumberPart = content;
    } else if (DISC_ROLE_INDICATORS.has(lower)) {
      subtitlePart = content;
    } else if (
      discNumberPart &&
      !isRegionOrLanguageOrDisc(content) &&
      !isTrueEditionOrRevisionVariant(content)
    ) {
      subtitlePart = content;
    }
  }

  if (discNumberPart && subtitlePart) {
    return `${discNumberPart} — ${subtitlePart}`;
  }
  return discNumberPart || subtitlePart || null;
}

/**
 * Determines whether a release or ROM should be ignored based on global or platform-specific rules.
 *
 * @param releaseName The clean release title.
 * @param romName The ROM filename.
 * @param platformId The platform ID.
 * @returns True if the release is ignored, false otherwise.
 */
export function isIgnoredFormatRelease(
  releaseName: string,
  romName: string,
  platformId?: number,
): boolean {
  const romLower = romName.toLowerCase();
  const lastDot = romLower.lastIndexOf('.');
  const ext = lastDot !== -1 ? romLower.substring(lastDot) : '';

  const badExtensions = [
    '.tmd',
    '.tik',
    '.cert',
    '.app',
    '.cetk',
    '.pkg',
    '.unh',
  ];
  if (badExtensions.includes(ext)) return true;

  if (platformId === 33 && ext !== '.psv') {
    return true;
  }

  if (romLower.startsWith('tmd.')) return true;

  return false;
}

/**
 * Maps a platform name from a DAT file header to a database platform definition.
 * Uses explicit string fallbacks followed by exact and substring matching.
 *
 * @param datPlatformName Platform name declared in the DAT file header.
 * @param targetPlatform The database platform record we are trying to match.
 * @returns True if the DAT platform maps to the target platform, false otherwise.
 */
export function isPlatformMatch(
  datPlatformName: string,
  targetPlatform: PlatformRecord,
): boolean {
  const normalize = (s: string) =>
    s
      .replace(/&amp;/gi, ' and ')
      .replace(/&/g, ' and ')
      .replace(/\(parent-clone\)/gi, '')
      .replace(/parent-clone/gi, '')
      .toLowerCase()
      .replace(
        /\b(nintendo|sony|sega|microsoft|philips|atari|tiger|snk|nec|panasonic|mattel|coleco|bandai|casio|commodore|fujitsu|interton|pce|tg16|interactive multimedia system|interactive multiplayer|interactive multimedia|video computer system|mark iii|bigendian|byteswapped|headered|headerless|decrypted|encrypted|bin|lyx|a78|j64|jag|abs|cof|rom|psvgamesd|blackfinpsv|nonpdrm|parentclone|parent clone)\b/gi,
        '',
      )
      .replace(/[^a-z0-9]/g, '');

  const datClean = normalize(datPlatformName);
  const targetClean = normalize(
    targetPlatform.display_name || targetPlatform.name,
  );

  // Exact match on normalized names
  if (datClean && targetClean && datClean === targetClean) {
    return true;
  }

  // Mega Drive / Genesis combined DAT header match
  if (
    datClean === 'megadrivegenesis' &&
    (targetClean === 'genesis' || targetClean === 'megadrive')
  ) {
    return true;
  }

  // Explicit mappings from DAT headers/names to database platform IDs
  const explicitPlatformMap: Record<string, number> = {
    // Disc systems (Redump)
    '3do': 1,
    '3dointeractivemultiplayer': 1,
    jaguarcd: 6,
    neogeocd: 10,
    gamecube: 20,
    nintendogamecube: 20,
    wii: 22,
    wiiu: 24,
    cdi: 28,
    philipscdi: 28,
    playstation: 29,
    playstation2: 30,
    playstationportable: 31,
    psp: 31,
    playstation3: 32,
    playstationvita: 33,
    psvita: 33,
    playstation4: 34,
    playstation5: 35,
    segacd: 39,
    megacd: 39,
    megacdandcd: 39,
    megacdcd: 39,
    megacdandsegacd: 39,
    megacdsegacd: 39,
    saturn: 42,
    segasaturn: 42,
    dreamcast: 43,
    pcenginecd: 46,
    turbografxcd: 46,
    pcenginecdandturbografxcd: 46,
    pcenginecdturbografxcd: 46,
    xbox: 47,
    xbox360: 48,
    xboxone: 49,
    xboxseriesx: 50,
    xboxseries: 50,

    // Cartridge systems (No-Intro)
    atari2600: 2,
    '2600': 2,
    atari5200: 3,
    '5200': 3,
    atari7800: 4,
    '7800': 4,
    lynx: 5,
    atarilynx: 5,
    jaguar: 6,
    atarijaguar: 6,
    colecovision: 7,
    intellivision: 8,
    neogeoaes: 9,
    neogeopocketcolor: 11,
    neogeopocket: 11,
    'entertainment system': 13,
    entertainmentsystem: 13,
    nintendoentertainmentsystem: 13,
    nes: 13,
    gameboy: 14,
    superentertainmentsystem: 15,
    supernintendoentertainmentsystem: 15,
    snes: 15,
    virtualboy: 16,
    '64': 17,
    nintendo64: 17,
    n64: 17,
    gameboycolor: 18,
    gbc: 18,
    gameboyadvance: 19,
    gba: 19,
    ds: 21,
    nintendods: 21,
    '3ds': 23,
    nintendo3ds: 23,
    new3ds: 25,
    newnintendo3ds: 25,
    switch: 26,
    nintendoswitch: 26,
    mastersystem: 36,
    genesis: 37,
    megadrive: 37,
    megadrivegenesis: 37,
    gamegear: 38,
    pico: 40,
    '32x': 41,
    gamecom: 44,
    turbografx16: 45,
    pcengine: 45,
    pcengineturbografx16: 45,
    famicom: 53,
  };

  const matchedId = explicitPlatformMap[datClean];
  if (matchedId && matchedId === targetPlatform.id) {
    return true;
  }

  return false;
}
