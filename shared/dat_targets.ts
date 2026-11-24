/**
 * SHARED CANONICAL DAT TARGETS (Redump via redump.info & No-Intro)
 *
 * Centralizes platform-to-DAT mappings so both local CLI scripts and Cloudflare
 * Worker crons fetch from the exact same upstream URLs and target definitions.
 */

export interface RedumpPlatformTarget {
  platformId: number;
  name: string;
  slug: string;
  redumpInfoSlug: string;
  pattern: RegExp;
  isModernWip?: boolean;
}

export interface NoIntroPlatformTarget {
  platformId: number;
  name: string;
  remoteFileName: string;
  canonicalFileName?: string;
  pattern: RegExp;
  manualOnly?: boolean;
}

export const REDUMP_INFO_SLUG_MAP: Record<string, string> = {
  '3do': '3DO',
  ajcd: 'AJCD',
  ngcd: 'NGCD',
  gc: 'GC',
  wii: 'WII',
  cdi: 'CDI',
  psx: 'PSX',
  ps2: 'PS2',
  psp: 'PSP',
  ps3: 'PS3',
  mcd: 'MCD',
  ss: 'SS',
  dc: 'DC',
  pce: 'PCE',
  xbox: 'XBOX',
  xbox360: 'XBOX360',
  wiiu: 'WIIU',
  ps4: 'PS4',
  ps5: 'PS5',
  xbone: 'XBOXONE',
  xsx: 'XBOXSX',
};

export function getRedumpInfoDatUrl(slug: string): string {
  const mapped = REDUMP_INFO_SLUG_MAP[slug.toLowerCase()] || slug.toUpperCase();
  return `https://redump.info/datfile/${encodeURIComponent(mapped)}`;
}

/**
 * Optical disc platforms sourced from Redump (standard public systems).
 */
export const REDUMP_TARGETS: RedumpPlatformTarget[] = [
  {
    platformId: 1,
    name: 'Panasonic 3DO',
    slug: '3do',
    redumpInfoSlug: '3DO',
    pattern: /3DO Interactive Multiplayer/i,
  },
  {
    platformId: 6,
    name: 'Atari Jaguar CD',
    slug: 'ajcd',
    redumpInfoSlug: 'AJCD',
    pattern: /Jaguar CD/i,
  },
  {
    platformId: 10,
    name: 'SNK Neo Geo CD',
    slug: 'ngcd',
    redumpInfoSlug: 'NGCD',
    pattern: /Neo Geo CD/i,
  },
  {
    platformId: 20,
    name: 'Nintendo GameCube',
    slug: 'gc',
    redumpInfoSlug: 'GC',
    pattern: /Nintendo - GameCube/i,
  },
  {
    platformId: 22,
    name: 'Nintendo Wii',
    slug: 'wii',
    redumpInfoSlug: 'WII',
    pattern: /Nintendo - Wii -/i,
  },
  {
    platformId: 28,
    name: 'Philips CD-i',
    slug: 'cdi',
    redumpInfoSlug: 'CDI',
    pattern: /Philips - CD-i/i,
  },
  {
    platformId: 29,
    name: 'Sony PlayStation',
    slug: 'psx',
    redumpInfoSlug: 'PSX',
    pattern: /Sony - PlayStation -/i,
  },
  {
    platformId: 30,
    name: 'Sony PlayStation 2',
    slug: 'ps2',
    redumpInfoSlug: 'PS2',
    pattern: /Sony - PlayStation 2 -/i,
  },
  {
    platformId: 31,
    name: 'Sony PlayStation Portable',
    slug: 'psp',
    redumpInfoSlug: 'PSP',
    pattern: /Sony - PlayStation Portable/i,
  },
  {
    platformId: 32,
    name: 'Sony PlayStation 3',
    slug: 'ps3',
    redumpInfoSlug: 'PS3',
    pattern: /Sony - PlayStation 3/i,
  },
  {
    platformId: 39,
    name: 'Sega CD',
    slug: 'mcd',
    redumpInfoSlug: 'MCD',
    pattern: /Mega CD & Sega CD/i,
  },
  {
    platformId: 42,
    name: 'Sega Saturn',
    slug: 'ss',
    redumpInfoSlug: 'SS',
    pattern: /Sega - Saturn/i,
  },
  {
    platformId: 43,
    name: 'Sega Dreamcast',
    slug: 'dc',
    redumpInfoSlug: 'DC',
    pattern: /Sega - Dreamcast/i,
  },
  {
    platformId: 46,
    name: 'TurboGrafx CD / PC Engine CD',
    slug: 'pce',
    redumpInfoSlug: 'PCE',
    pattern: /PC Engine CD & TurboGrafx CD/i,
  },
  {
    platformId: 47,
    name: 'Microsoft Xbox',
    slug: 'xbox',
    redumpInfoSlug: 'XBOX',
    pattern: /Microsoft - Xbox -/i,
  },
  {
    platformId: 48,
    name: 'Microsoft Xbox 360',
    slug: 'xbox360',
    redumpInfoSlug: 'XBOX360',
    pattern: /Microsoft - Xbox 360 -/i,
  },
];

/**
 * Modern / active Redump optical disc platforms served directly by redump.info.
 */
export const REDUMP_WIP_TARGETS: Array<
  RedumpPlatformTarget & { canonicalFileName: string }
> = [
  {
    platformId: 24,
    name: 'Nintendo Wii U',
    slug: 'wiiu',
    redumpInfoSlug: 'WIIU',
    canonicalFileName: 'Nintendo - Wii U.dat',
    pattern: /^Nintendo\s*-\s*Wii U/i,
    isModernWip: true,
  },
  {
    platformId: 34,
    name: 'Sony PlayStation 4',
    slug: 'ps4',
    redumpInfoSlug: 'PS4',
    canonicalFileName: 'Sony - PlayStation 4.dat',
    pattern: /^Sony\s*-\s*PlayStation 4/i,
    isModernWip: true,
  },
  {
    platformId: 35,
    name: 'Sony PlayStation 5',
    slug: 'ps5',
    redumpInfoSlug: 'PS5',
    canonicalFileName: 'Sony - PlayStation 5.dat',
    pattern: /^Sony\s*-\s*PlayStation 5/i,
    isModernWip: true,
  },
  {
    platformId: 49,
    name: 'Microsoft Xbox One',
    slug: 'xbone',
    redumpInfoSlug: 'XBOXONE',
    canonicalFileName: 'Microsoft - Xbox One.dat',
    pattern: /^Microsoft\s*-\s*Xbox One/i,
    isModernWip: true,
  },
  {
    platformId: 50,
    name: 'Microsoft Xbox Series X',
    slug: 'xsx',
    redumpInfoSlug: 'XBOXSX',
    canonicalFileName: 'Microsoft - Xbox Series X.dat',
    pattern: /^Microsoft\s*-\s*Xbox Series X/i,
    isModernWip: true,
  },
];

/**
 * Cartridge and ROM platforms sourced from No-Intro / Spludlow / Libretro.
 */
export const NO_INTRO_TARGETS: NoIntroPlatformTarget[] = [
  {
    platformId: 2,
    name: 'Atari 2600',
    remoteFileName: 'Atari - 2600.dat',
    canonicalFileName: 'Atari - Atari 2600.dat',
    pattern: /^Atari\s*-\s*(Atari\s*)?2600/i,
  },
  {
    platformId: 3,
    name: 'Atari 5200',
    remoteFileName: 'Atari - 5200.dat',
    canonicalFileName: 'Atari - Atari 5200.dat',
    pattern: /^Atari\s*-\s*(Atari\s*)?5200/i,
  },
  {
    platformId: 4,
    name: 'Atari 7800',
    remoteFileName: 'Atari - 7800.dat',
    canonicalFileName: 'Atari - Atari 7800 (BIN).dat',
    pattern: /^Atari\s*-\s*(Atari\s*)?7800/i,
  },
  {
    platformId: 5,
    name: 'Atari Lynx',
    remoteFileName: 'Atari - Lynx.dat',
    canonicalFileName: 'Atari - Atari Lynx (LYX).dat',
    pattern: /^Atari\s*-\s*(Atari\s*)?Lynx/i,
  },
  {
    platformId: 6,
    name: 'Atari Jaguar',
    remoteFileName: 'Atari - Jaguar.dat',
    canonicalFileName: 'Atari - Atari Jaguar (ROM).dat',
    pattern: /^Atari\s*-\s*(Atari\s*)?Jaguar(?!\s*CD)/i,
  },
  {
    platformId: 7,
    name: 'ColecoVision',
    remoteFileName: 'Coleco - ColecoVision.dat',
    canonicalFileName: 'Coleco - ColecoVision.dat',
    pattern: /^Coleco\s*-\s*ColecoVision/i,
  },
  {
    platformId: 8,
    name: 'Intellivision',
    remoteFileName: 'Mattel - Intellivision.dat',
    canonicalFileName: 'Mattel - Intellivision.dat',
    pattern: /^Mattel\s*-\s*Intellivision/i,
  },
  {
    platformId: 11,
    name: 'Neo Geo Pocket',
    remoteFileName: 'SNK - Neo Geo Pocket.dat',
    canonicalFileName: 'SNK - Neo Geo Pocket.dat',
    pattern: /^SNK\s*-\s*Neo Geo Pocket(?!\s*Color)/i,
  },
  {
    platformId: 11,
    name: 'Neo Geo Pocket Color',
    remoteFileName: 'SNK - Neo Geo Pocket Color.dat',
    canonicalFileName: 'SNK - Neo Geo Pocket Color.dat',
    pattern: /^SNK\s*-\s*Neo Geo Pocket Color/i,
  },
  {
    platformId: 13,
    name: 'Nintendo Entertainment System',
    remoteFileName: 'Nintendo - Nintendo Entertainment System.dat',
    canonicalFileName: 'Nintendo - Nintendo Entertainment System.dat',
    pattern: /^Nintendo\s*-\s*Nintendo Entertainment System/i,
  },
  {
    platformId: 54,
    name: 'Famicom Disk System',
    remoteFileName: 'Nintendo - Family Computer Disk System.dat',
    canonicalFileName: 'Nintendo - Family Computer Disk System.dat',
    pattern: /^Nintendo\s*-\s*Family Computer Disk System/i,
  },
  {
    platformId: 15,
    name: 'Super Nintendo Entertainment System',
    remoteFileName: 'Nintendo - Super Nintendo Entertainment System.dat',
    canonicalFileName: 'Nintendo - Super Nintendo Entertainment System.dat',
    pattern: /^Nintendo\s*-\s*Super Nintendo Entertainment System/i,
  },
  {
    platformId: 17,
    name: 'Nintendo 64',
    remoteFileName: 'Nintendo - Nintendo 64.dat',
    canonicalFileName: 'Nintendo - Nintendo 64.dat',
    pattern: /^Nintendo\s*-\s*Nintendo 64(?!\s*DD)/i,
  },
  {
    platformId: 55,
    name: 'Nintendo 64DD',
    remoteFileName: 'Nintendo - Nintendo 64DD.dat',
    canonicalFileName: 'Nintendo - Nintendo 64DD.dat',
    pattern: /^Nintendo\s*-\s*Nintendo 64DD/i,
  },
  {
    platformId: 14,
    name: 'Game Boy',
    remoteFileName: 'Nintendo - Game Boy.dat',
    canonicalFileName: 'Nintendo - Game Boy.dat',
    pattern: /^Nintendo\s*-\s*Game Boy(?!\s*(Advance|Color))/i,
  },
  {
    platformId: 18,
    name: 'Game Boy Color',
    remoteFileName: 'Nintendo - Game Boy Color.dat',
    canonicalFileName: 'Nintendo - Game Boy Color.dat',
    pattern: /^Nintendo\s*-\s*Game Boy Color/i,
  },
  {
    platformId: 19,
    name: 'Game Boy Advance',
    remoteFileName: 'Nintendo - Game Boy Advance.dat',
    canonicalFileName: 'Nintendo - Game Boy Advance.dat',
    pattern: /^Nintendo\s*-\s*Game Boy Advance/i,
  },
  {
    platformId: 21,
    name: 'Nintendo DS',
    remoteFileName: 'Nintendo - Nintendo DS.dat',
    canonicalFileName: 'Nintendo - Nintendo DS.dat',
    pattern: /^Nintendo\s*-\s*Nintendo DS(?!\w)/i,
  },
  {
    platformId: 23,
    name: 'Nintendo 3DS',
    remoteFileName: 'Nintendo - Nintendo 3DS.dat',
    canonicalFileName: 'Nintendo - Nintendo 3DS.dat',
    pattern: /^Nintendo\s*-\s*Nintendo 3DS/i,
  },
  {
    platformId: 25,
    name: 'New Nintendo 3DS',
    remoteFileName: 'Nintendo - New Nintendo 3DS.dat',
    canonicalFileName: 'Nintendo - New Nintendo 3DS.dat',
    pattern: /^Nintendo\s*-\s*New Nintendo 3DS/i,
  },
  {
    platformId: 16,
    name: 'Virtual Boy',
    remoteFileName: 'Nintendo - Virtual Boy.dat',
    canonicalFileName: 'Nintendo - Virtual Boy.dat',
    pattern: /^Nintendo\s*-\s*Virtual Boy/i,
  },
  {
    platformId: 44,
    name: 'Pokemon Mini',
    remoteFileName: 'Nintendo - Pokemon Mini.dat',
    canonicalFileName: 'Nintendo - Pokemon Mini.dat',
    pattern: /^Nintendo\s*-\s*Pokemon Mini/i,
  },
  {
    platformId: 33,
    name: 'PlayStation Vita',
    remoteFileName: 'Unofficial - Sony - PlayStation Vita (PSVgameSD).xml',
    canonicalFileName: 'Sony - PlayStation Vita (PSVgameSD).dat',
    pattern: /^(?:Unofficial\s*-\s*)?Sony\s*-\s*PlayStation Vita/i,
  },
  {
    platformId: 36,
    name: 'Sega Master System',
    remoteFileName: 'Sega - Master System - Mark III.dat',
    canonicalFileName: 'Sega - Master System - Mark III.dat',
    pattern: /^Sega\s*-\s*Master System/i,
  },
  {
    platformId: 37,
    name: 'Sega Genesis / Mega Drive',
    remoteFileName: 'Sega - Mega Drive - Genesis.dat',
    canonicalFileName: 'Sega - Mega Drive - Genesis.dat',
    pattern: /^Sega\s*-\s*Mega Drive\s*-\s*Genesis/i,
  },
  {
    platformId: 38,
    name: 'Sega Game Gear',
    remoteFileName: 'Sega - Game Gear.dat',
    canonicalFileName: 'Sega - Game Gear.dat',
    pattern: /^Sega\s*-\s*Game Gear/i,
  },
  {
    platformId: 40,
    name: 'Sega Pico',
    remoteFileName: 'Sega - PICO.dat',
    canonicalFileName: 'Sega - PICO.dat',
    pattern: /^Sega\s*-\s*PICO/i,
  },
  {
    platformId: 41,
    name: 'Sega 32X',
    remoteFileName: 'Sega - 32X.dat',
    canonicalFileName: 'Sega - 32X.dat',
    pattern: /^Sega\s*-\s*32X/i,
  },
  {
    platformId: 45,
    name: 'TurboGrafx-16 / PC Engine',
    remoteFileName: 'NEC - PC Engine - TurboGrafx 16.dat',
    canonicalFileName: 'NEC - PC Engine - TurboGrafx 16.dat',
    pattern: /^NEC\s*-\s*PC Engine/i,
  },
  {
    platformId: 44,
    name: 'Tiger Game.com',
    remoteFileName: 'Tiger - Game.com.dat',
    canonicalFileName: 'Tiger - Game.com.dat',
    pattern: /^Tiger\s*-\s*Game\.com/i,
  },
  {
    platformId: 44,
    name: 'WonderSwan',
    remoteFileName: 'Bandai - WonderSwan.dat',
    canonicalFileName: 'Bandai - WonderSwan.dat',
    pattern: /^Bandai\s*-\s*WonderSwan(?!\s*Color)/i,
  },
  {
    platformId: 44,
    name: 'WonderSwan Color',
    remoteFileName: 'Bandai - WonderSwan Color.dat',
    canonicalFileName: 'Bandai - WonderSwan Color.dat',
    pattern: /^Bandai\s*-\s*WonderSwan Color/i,
  },
];
