/**
 * PURE DAT FORMAT & STRING MATCHING UTILITIES
 *
 * Lightweight, zero-dependency string extraction, region extraction, variant extraction,
 * and platform matching routines.
 *
 * Safe for execution across both Cloudflare Workers edge isolates and local Node runtimes.
 */

/**
 * Interface representing a platform database record.
 */
export interface PlatformRecord {
  id: number;
  name: string;
  display_name: string;
}

/**
 * Checks if a string content consists entirely of regions, languages, or disc indicators.
 * Used to separate variants from language/region parentheticals.
 *
 * @param content Parenthetical inner content.
 * @returns True if it is a region, language, or disc, false otherwise.
 */
export function isRegionOrLanguageOrDisc(content: string): boolean {
  const normalized = content.toLowerCase().trim();

  const discRegex =
    /^(?:disc|side)\s+[a-zA-Z0-9]+(?:\s+of\s+[0-9]+|\s*[/\\\\]\s*[0-9]+)?$/i;
  if (discRegex.test(normalized)) return true;

  const jpDiscRegex = /^(?:ichi|ni|san|yon|shi|go)$/i;
  if (jpDiscRegex.test(normalized)) return true;

  const regions = new Set([
    'usa',
    'europe',
    'japan',
    'world',
    'asia',
    'france',
    'germany',
    'australia',
    'uk',
    'canada',
    'korea',
    'brazil',
    'spain',
    'italy',
    'netherlands',
    'sweden',
    'russia',
    'china',
    'taiwan',
    'portugal',
    'denmark',
    'norway',
    'finland',
    'hong kong',
    'hongkong',
    'latam',
    'nz',
    'new zealand',
  ]);

  const languages = new Set([
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
  ]);

  const parts = normalized.split(/[\s,/\-\\+]+/);
  return parts.every((part) => {
    const p = part.trim();
    if (!p) return true;
    return regions.has(p) || languages.has(p);
  });
}

/**
 * Extracts region codes from a release title.
 *
 * @param name The raw release name containing parentheses.
 * @returns Comma-separated region string or null.
 */
export function extractRegions(name: string): string | null {
  const regionsMap: Record<string, string> = {
    usa: 'USA',
    europe: 'Europe',
    japan: 'Japan',
    world: 'World',
    asia: 'Asia',
    france: 'France',
    germany: 'Germany',
    australia: 'Australia',
    uk: 'UK',
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
  };

  const found: string[] = [];
  const parentheticalMatches = name.match(/\(([^)]+)\)/g);
  if (parentheticalMatches) {
    for (const match of parentheticalMatches) {
      const content = match.slice(1, -1);
      const parts = content.split(/[\s,]+/);
      for (const part of parts) {
        const cleanPart = part.trim().toLowerCase();
        if (regionsMap[cleanPart]) {
          const mapped = regionsMap[cleanPart];
          if (!found.includes(mapped)) {
            found.push(mapped);
          }
        }
      }
    }
  }
  return found.length > 0 ? found.join(', ') : null;
}

/**
 * Extracts variant indicators (such as 'Beta', 'Proto', 'Rev 1') from a release title.
 *
 * @param name Raw release name containing parenthetical variants.
 * @returns Comma-separated list of variants, or null.
 */
export function extractVariants(name: string): string | null {
  const found: string[] = [];
  const parentheticalMatches = name.match(/\(([^)]+)\)/g);
  if (parentheticalMatches) {
    for (const match of parentheticalMatches) {
      const content = match.slice(1, -1).trim();
      if (!isRegionOrLanguageOrDisc(content)) {
        if (!found.includes(content)) {
          found.push(content);
        }
      }
    }
  }
  return found.length > 0 ? found.join(', ') : null;
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
