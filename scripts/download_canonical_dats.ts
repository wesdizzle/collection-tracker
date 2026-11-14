/**
 * CANONICAL DAT DOWNLOADER UTILITY
 *
 * Fetches official public DAT files from:
 * 1. Redump.org (publicly downloadable disc-based system DATs)
 * 2. Libretro Database (publicly synced No-Intro cartridge DATs + official PlayStation Vita DATs)
 *
 * Unpacks any ZIP archives natively in Node.js (without external dependencies)
 * and saves the resulting .dat / .xml files directly into `/dats/Redump` and `/dats/No-Intro`.
 *
 * Usage:
 *   npx tsx scripts/download_canonical_dats.ts
 *   npx tsx scripts/download_canonical_dats.ts --redump-only
 *   npx tsx scripts/download_canonical_dats.ts --no-intro-only
 *   npx tsx scripts/download_canonical_dats.ts --sync-dir="D:\Games\Dats"
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { fileURLToPath } from 'url';

export interface RedumpTarget {
  slug: string;
  name: string;
  platformId: number;
}

export interface NoIntroTarget {
  remoteFileName: string;
  name: string;
  platformId: number;
  repoBranchPath?: string;
  directUrl?: string;
  customLocalFileName?: string;
}

export const REDUMP_TARGETS: RedumpTarget[] = [
  { slug: '3do', name: '3DO Interactive Multiplayer', platformId: 1 },
  { slug: 'ajcd', name: 'Atari Jaguar CD', platformId: 40 },
  { slug: 'cdi', name: 'Philips CD-i', platformId: 45 },
  { slug: 'dc', name: 'Sega Dreamcast', platformId: 35 },
  { slug: 'gc', name: 'Nintendo GameCube', platformId: 20 },
  { slug: 'mcd', name: 'Sega Mega-CD / Sega CD', platformId: 39 },
  { slug: 'ngcd', name: 'SNK Neo Geo CD', platformId: 44 },
  { slug: 'pcecd', name: 'NEC PC Engine CD / TurboGrafx-CD', platformId: 46 },
  { slug: 'psx', name: 'Sony PlayStation', platformId: 29 },
  { slug: 'ps2', name: 'Sony PlayStation 2', platformId: 30 },
  { slug: 'ps3', name: 'Sony PlayStation 3', platformId: 32 },
  { slug: 'psp', name: 'Sony PlayStation Portable', platformId: 31 },
  { slug: 'ss', name: 'Sega Saturn', platformId: 34 },
  { slug: 'wii', name: 'Nintendo Wii', platformId: 22 },
  { slug: 'xbox', name: 'Microsoft Xbox', platformId: 53 },
  { slug: 'x360', name: 'Microsoft Xbox 360', platformId: 54 },
];

export const REDUMP_WIP_TARGETS: RedumpTarget[] = [
  { slug: 'wiiu', name: 'Nintendo Wii U', platformId: 24 },
  { slug: 'ps4', name: 'Sony PlayStation 4', platformId: 34 },
  { slug: 'ps5', name: 'Sony PlayStation 5', platformId: 50 },
  { slug: 'xbone', name: 'Microsoft Xbox One', platformId: 55 },
  { slug: 'xsx', name: 'Microsoft Xbox Series X', platformId: 56 },
];

export const NO_INTRO_TARGETS: NoIntroTarget[] = [
  {
    remoteFileName: 'Atari - 2600.dat',
    name: 'Atari 2600',
    platformId: 2,
    customLocalFileName: 'Atari - Atari 2600.dat',
  },
  {
    remoteFileName: 'Atari - 5200.dat',
    name: 'Atari 5200',
    platformId: 3,
    customLocalFileName: 'Atari - Atari 5200.dat',
  },
  {
    remoteFileName: 'Atari - 7800.dat',
    name: 'Atari 7800',
    platformId: 4,
    customLocalFileName: 'Atari - Atari 7800 (BIN).dat',
  },
  {
    remoteFileName: 'Atari - Jaguar.dat',
    name: 'Atari Jaguar',
    platformId: 6,
    customLocalFileName: 'Atari - Atari Jaguar (J64).dat',
  },
  {
    remoteFileName: 'Atari - Lynx.dat',
    name: 'Atari Lynx',
    platformId: 5,
    customLocalFileName: 'Atari - Atari Lynx (LNX).dat',
  },
  {
    remoteFileName: 'Coleco - ColecoVision.dat',
    name: 'ColecoVision',
    platformId: 7,
  },
  {
    remoteFileName: 'Mattel - Intellivision.dat',
    name: 'Intellivision',
    platformId: 8,
  },
  {
    remoteFileName: 'NEC - PC Engine - TurboGrafx 16.dat',
    name: 'TurboGrafx-16',
    platformId: 47,
    customLocalFileName: 'NEC - PC Engine - TurboGrafx-16.dat',
  },
  {
    remoteFileName: 'Nintendo - Family Computer Disk System.dat',
    name: 'Famicom Disk System',
    platformId: 12,
    customLocalFileName: 'Nintendo - Family Computer Disk System (FDS).dat',
  },
  {
    remoteFileName: 'Nintendo - Game Boy.dat',
    name: 'Game Boy',
    platformId: 14,
  },
  {
    remoteFileName: 'Nintendo - Game Boy Color.dat',
    name: 'Game Boy Color',
    platformId: 18,
  },
  {
    remoteFileName: 'Nintendo - Game Boy Advance.dat',
    name: 'Game Boy Advance',
    platformId: 19,
  },
  {
    remoteFileName: 'Nintendo - Nintendo 64.dat',
    name: 'Nintendo 64',
    platformId: 17,
    customLocalFileName: 'Nintendo - Nintendo 64 (BigEndian).dat',
  },
  {
    remoteFileName: 'Nintendo - Nintendo 64DD.dat',
    name: 'Nintendo 64DD',
    platformId: 48,
  },
  {
    remoteFileName: 'Nintendo - Nintendo DS.dat',
    name: 'Nintendo DS',
    platformId: 21,
    customLocalFileName: 'Nintendo - Nintendo DS (Decrypted).dat',
  },
  {
    remoteFileName: 'Nintendo - Nintendo DSi.dat',
    name: 'Nintendo DSi',
    platformId: 21,
    customLocalFileName: 'Nintendo - Nintendo DSi (Decrypted).dat',
  },
  {
    remoteFileName: 'Nintendo - Nintendo 3DS.dat',
    name: 'Nintendo 3DS',
    platformId: 23,
    customLocalFileName: 'Nintendo - Nintendo 3DS (Decrypted).dat',
  },
  {
    remoteFileName: 'Nintendo - New Nintendo 3DS.dat',
    name: 'New Nintendo 3DS',
    platformId: 25,
    customLocalFileName: 'Nintendo - New Nintendo 3DS (Decrypted).dat',
  },
  {
    remoteFileName: 'Nintendo - Nintendo Entertainment System.dat',
    name: 'NES / Famicom',
    platformId: 13,
    customLocalFileName:
      'Nintendo - Nintendo Entertainment System (Headered).dat',
  },
  {
    remoteFileName: 'Nintendo - Super Nintendo Entertainment System.dat',
    name: 'SNES / Super Famicom',
    platformId: 15,
  },
  {
    remoteFileName: 'Nintendo - Virtual Boy.dat',
    name: 'Virtual Boy',
    platformId: 16,
  },
  {
    remoteFileName: 'Sega - 32X.dat',
    name: 'Sega 32X',
    platformId: 41,
  },
  {
    remoteFileName: 'Sega - Game Gear.dat',
    name: 'Sega Game Gear',
    platformId: 38,
  },
  {
    remoteFileName: 'Sega - Master System - Mark III.dat',
    name: 'Sega Master System',
    platformId: 36,
  },
  {
    remoteFileName: 'Sega - Mega Drive - Genesis.dat',
    name: 'Sega Genesis',
    platformId: 37,
  },
  {
    remoteFileName: 'Sega - PICO.dat',
    name: 'Sega Pico',
    platformId: 49,
    customLocalFileName: 'Sega - Beena.dat',
  },
  {
    remoteFileName: 'SNK - Neo Geo Pocket.dat',
    name: 'Neo Geo Pocket',
    platformId: 9,
  },
  {
    remoteFileName: 'SNK - Neo Geo Pocket Color.dat',
    name: 'Neo Geo Pocket Color',
    platformId: 9,
  },
  {
    remoteFileName: 'Tiger - Game.com.dat',
    name: 'Game.com',
    platformId: 42,
  },
  {
    remoteFileName: 'Unofficial - Sony - PlayStation Vita (PSVgameSD).xml',
    name: 'PlayStation Vita',
    platformId: 33,
    directUrl:
      'https://data.spludlow.co.uk/no-intro/unofficial/Unofficial%20-%20Sony%20-%20PlayStation%20Vita%20(PSVgameSD).xml',
    customLocalFileName: 'Sony - PlayStation Vita (PSVgameSD).dat',
  },
];

/**
 * Extracts the first `.dat` or `.xml` file from an in-memory ZIP buffer using Node's native `zlib`.
 */
export function extractDatFromZipBuffer(
  zipBuffer: Buffer,
): { fileName: string; content: Buffer } | null {
  let offset = 0;
  while (offset + 30 <= zipBuffer.length) {
    const signature = zipBuffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) {
      break;
    }

    const generalPurposeFlag = zipBuffer.readUInt16LE(offset + 6);
    const compressionMethod = zipBuffer.readUInt16LE(offset + 8);
    let compressedSize = zipBuffer.readUInt32LE(offset + 18);
    const fileNameLength = zipBuffer.readUInt16LE(offset + 26);
    const extraFieldLength = zipBuffer.readUInt16LE(offset + 28);

    const fileNameStart = offset + 30;
    const fileName = zipBuffer
      .subarray(fileNameStart, fileNameStart + fileNameLength)
      .toString('utf8');
    const dataStart = fileNameStart + fileNameLength + extraFieldLength;

    if ((generalPurposeFlag & 0x08) !== 0 && compressedSize === 0) {
      let eocdOffset = zipBuffer.length - 22;
      while (eocdOffset >= 0) {
        if (zipBuffer.readUInt32LE(eocdOffset) === 0x06054b50) {
          const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
          const cdEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
          let cdPos = cdOffset;
          for (let i = 0; i < cdEntries; i++) {
            if (zipBuffer.readUInt32LE(cdPos) !== 0x02014b50) break;
            const cdCompSize = zipBuffer.readUInt32LE(cdPos + 20);
            const cdNameLen = zipBuffer.readUInt16LE(cdPos + 28);
            const cdExtraLen = zipBuffer.readUInt16LE(cdPos + 30);
            const cdCommentLen = zipBuffer.readUInt16LE(cdPos + 32);
            const cdName = zipBuffer
              .subarray(cdPos + 46, cdPos + 46 + cdNameLen)
              .toString('utf8');
            if (cdName === fileName) {
              compressedSize = cdCompSize;
              break;
            }
            cdPos += 46 + cdNameLen + cdExtraLen + cdCommentLen;
          }
          break;
        }
        eocdOffset--;
      }
    }

    const compressedData = zipBuffer.subarray(
      dataStart,
      dataStart + compressedSize,
    );

    if (fileName.endsWith('.dat') || fileName.endsWith('.xml')) {
      if (compressionMethod === 0) {
        return { fileName: path.basename(fileName), content: compressedData };
      } else if (compressionMethod === 8) {
        const decompressed = zlib.inflateRawSync(compressedData);
        return { fileName: path.basename(fileName), content: decompressed };
      }
    }

    offset = dataStart + compressedSize;
  }

  return null;
}

const SONIC_AND_KNUCKLES_STANDALONE_CRC = '0658F691';
const SONIC_AND_KNUCKLES_STANDALONE_MD5 = '4AC75A7AFE9A3FBF0143D32BDEEEFEAC';
const SONIC_AND_KNUCKLES_STANDALONE_SHA1 =
  'A0A0D7EAF0ECEF5CCFFEC8ACDB1A57CA6236AAAF';
const SONIC_AND_KNUCKLES_STANDALONE_SIZE = 2097152;

const WILY_WARS_RETROBIT_ALT_CRC = '92FD68E9';
const WILY_WARS_RETROBIT_ALT_MD5 = 'CEBF7E314541DF96A7398290DA2DD710';
const WILY_WARS_RETROBIT_ALT_SHA1 = '17C07481AE7C8D69C38557A51F70E257BCE799EF';
const WILY_WARS_RETROBIT_ALT_SIZE = 2097152;

const HEADER_NAME_PATCHES: Record<string, string> = {
  'Atari - 2600': 'Atari - Atari 2600',
  'Atari - 5200': 'Atari - Atari 5200',
  'Atari - 7800': 'Atari - Atari 7800 (BIN)',
  'Atari - Jaguar': 'Atari - Atari Jaguar (J64)',
  'Atari - Lynx': 'Atari - Atari Lynx (LNX)',
  'NEC - PC Engine - TurboGrafx 16': 'NEC - PC Engine - TurboGrafx-16',
  'Nintendo - Family Computer Disk System':
    'Nintendo - Family Computer Disk System (FDS)',
  'Nintendo - Nintendo 64': 'Nintendo - Nintendo 64 (BigEndian)',
  'Nintendo - Nintendo DS': 'Nintendo - Nintendo DS (Decrypted)',
  'Nintendo - Nintendo DSi': 'Nintendo - Nintendo DSi (Decrypted)',
  'Nintendo - Nintendo 3DS': 'Nintendo - Nintendo 3DS (Decrypted)',
  'Nintendo - New Nintendo 3DS': 'Nintendo - New Nintendo 3DS (Decrypted)',
  'Nintendo - Nintendo Entertainment System':
    'Nintendo - Nintendo Entertainment System (Headered)',
  'Sega - PICO': 'Sega - Beena',
};

/**
 * Applies deterministic local post-processing patches to downloaded DAT content.
 */
export function applyCanonicalDatPatches(
  content: string,
  fileName: string,
): string {
  let patched = content;

  for (const [rawHeader, canonicalHeader] of Object.entries(
    HEADER_NAME_PATCHES,
  )) {
    const escapedRaw = rawHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    patched = patched.replace(
      new RegExp(`(<name>)${escapedRaw}(<\\/name>)`, 'g'),
      `$1${canonicalHeader}$2`,
    );
    patched = patched.replace(
      new RegExp(`(<description>)${escapedRaw}(<\\/description>)`, 'g'),
      `$1${canonicalHeader}$2`,
    );
    patched = patched.replace(
      new RegExp(`(clrmamepro\\s*\\([\\s\\S]*?name\\s+")${escapedRaw}(")`, 'g'),
      `$1${canonicalHeader}$2`,
    );
    patched = patched.replace(
      new RegExp(
        `(clrmamepro\\s*\\([\\s\\S]*?description\\s+")${escapedRaw}(")`,
        'g',
      ),
      `$1${canonicalHeader}$2`,
    );
  }

  const isGenesis =
    fileName.includes('Mega Drive - Genesis') ||
    patched.includes('Sega - Mega Drive - Genesis');
  if (!isGenesis) {
    return patched;
  }

  if (!patched.toUpperCase().includes(SONIC_AND_KNUCKLES_STANDALONE_CRC)) {
    if (patched.includes('<datafile')) {
      patched = patched.replace(
        /<game\s+name="Sonic &amp; Knuckles \(World\)"([^>]*)>([\s\S]*?)<\/game>/,
        (match, attrs, body) => {
          const renamedLockOn = `<game name="Sonic &amp; Knuckles (World) (Lock-on)"${attrs}>${body.replace(
            /<description>Sonic &amp; Knuckles \(World\)<\/description>/,
            '<description>Sonic &amp; Knuckles (World) (Lock-on)</description>',
          )}</game>`;

          const standaloneEntry = `\n\t<game name="Sonic &amp; Knuckles (World)">
\t\t<description>Sonic &amp; Knuckles (World)</description>
\t\t<rom name="Sonic &amp; Knuckles (World).md" size="${SONIC_AND_KNUCKLES_STANDALONE_SIZE}" crc="${SONIC_AND_KNUCKLES_STANDALONE_CRC}" md5="${SONIC_AND_KNUCKLES_STANDALONE_MD5}" sha1="${SONIC_AND_KNUCKLES_STANDALONE_SHA1}"/>
\t</game>`;

          return renamedLockOn + standaloneEntry;
        },
      );
    } else if (patched.includes('clrmamepro (')) {
      patched = patched.replace(
        /game\s*\(\s*name\s+"Sonic & Knuckles \(World\)"([\s\S]*?\n\))/,
        (match, body) => {
          const renamedLockOn = `game (\n\tname "Sonic & Knuckles (World) (Lock-on)"${body.replace(
            /description\s+"Sonic & Knuckles \(World\)"/,
            'description "Sonic & Knuckles (World) (Lock-on)"',
          )}`;

          const standaloneEntry = `\n\ngame (
\tname "Sonic & Knuckles (World)"
\tdescription "Sonic & Knuckles (World)"
\trom ( name "Sonic & Knuckles (World).md" size ${SONIC_AND_KNUCKLES_STANDALONE_SIZE} crc ${SONIC_AND_KNUCKLES_STANDALONE_CRC} md5 ${SONIC_AND_KNUCKLES_STANDALONE_MD5} sha1 ${SONIC_AND_KNUCKLES_STANDALONE_SHA1} )
)`;

          return renamedLockOn + standaloneEntry;
        },
      );
    }
  }

  if (!patched.toUpperCase().includes(WILY_WARS_RETROBIT_ALT_CRC)) {
    if (patched.includes('<datafile')) {
      patched = patched.replace(
        /<game\s+name="Mega Man - The Wily Wars \(World\) \(Retro-Bit\)"([^>]*)>([\s\S]*?)<\/game>/,
        (match) => {
          const altEntry = `\n\t<game name="Mega Man - The Wily Wars (World) (Retro-Bit) (Alt)">
\t\t<description>Mega Man - The Wily Wars (World) (Retro-Bit) (Alt)</description>
\t\t<rom name="Mega Man - The Wily Wars (World) (Retro-Bit) (Alt).md" size="${WILY_WARS_RETROBIT_ALT_SIZE}" crc="${WILY_WARS_RETROBIT_ALT_CRC}" md5="${WILY_WARS_RETROBIT_ALT_MD5}" sha1="${WILY_WARS_RETROBIT_ALT_SHA1}" serial="T-12053-00"/>
\t</game>`;
          return match + altEntry;
        },
      );
    } else if (patched.includes('clrmamepro (')) {
      patched = patched.replace(
        /game\s*\(\s*name\s+"Mega Man - The Wily Wars \(World\) \(Retro-Bit\)"[\s\S]*?\n\)/,
        (match) => {
          const altEntry = `\n\ngame (
\tname "Mega Man - The Wily Wars (World) (Retro-Bit) (Alt)"
\tdescription "Mega Man - The Wily Wars (World) (Retro-Bit) (Alt)"
\tserial "T-12053-00"
\trom ( name "Mega Man - The Wily Wars (World) (Retro-Bit) (Alt).md" size ${WILY_WARS_RETROBIT_ALT_SIZE} crc ${WILY_WARS_RETROBIT_ALT_CRC} md5 ${WILY_WARS_RETROBIT_ALT_MD5} sha1 ${WILY_WARS_RETROBIT_ALT_SHA1} serial "T-12053-00" )
)`;
          return match + altEntry;
        },
      );
    }
  }

  return patched;
}

/**
 * Downloads a single Redump DAT ZIP, extracts the `.dat` file, removes older
 * Redump DAT files for the same system prefix, and saves the new `.dat`.
 */
export async function downloadRedumpDat(
  target: RedumpTarget,
  destDir: string,
): Promise<{
  slug: string;
  success: boolean;
  fileName?: string;
  error?: string;
}> {
  const url = `http://redump.org/datfile/${target.slug}/`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'CollectionTracker-DatSync/1.0',
      },
    });

    if (!res.ok) {
      const existingFiles = fs.existsSync(destDir)
        ? fs.readdirSync(destDir)
        : [];
      const prefixMap: Record<string, string> = {
        wiiu: 'Nintendo - Wii U - Datfile',
        ps4: 'Sony - PlayStation 4 - Datfile',
        ps5: 'Sony - PlayStation 5 - Datfile',
        xbone: 'Microsoft - Xbox One - Datfile',
        xsx: 'Microsoft - Xbox Series X - Datfile',
      };
      const expectedPrefix = prefixMap[target.slug];
      if (expectedPrefix) {
        const cached = existingFiles.find(
          (f) => f.startsWith(expectedPrefix) && f.endsWith('.dat'),
        );
        if (cached) {
          return {
            slug: target.slug,
            success: true,
            fileName: cached,
          };
        }
      }
      return {
        slug: target.slug,
        success: false,
        error: `HTTP ${res.status} ${res.statusText}`,
      };
    }

    const arrayBuf = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuf);

    if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) {
      const extracted = extractDatFromZipBuffer(buf);
      if (!extracted) {
        return {
          slug: target.slug,
          success: false,
          error: 'No .dat or .xml entry found inside Redump ZIP archive.',
        };
      }

      const prefixMatch = extracted.fileName.match(/^(.*?\s-\sDatfile)\s*\(/i);
      if (prefixMatch && fs.existsSync(destDir)) {
        const systemPrefix = prefixMatch[1].toLowerCase();
        for (const existing of fs.readdirSync(destDir)) {
          if (
            existing.toLowerCase().startsWith(systemPrefix) &&
            existing !== extracted.fileName &&
            (existing.endsWith('.dat') || existing.endsWith('.xml'))
          ) {
            try {
              fs.unlinkSync(path.join(destDir, existing));
            } catch {
              // Ignore unlink errors
            }
          }
        }
      }

      const outPath = path.join(destDir, extracted.fileName);
      fs.writeFileSync(outPath, extracted.content);
      return {
        slug: target.slug,
        success: true,
        fileName: extracted.fileName,
      };
    }

    const text = buf.toString('utf8');
    if (text.includes('<datafile') || text.includes('clrmamepro (')) {
      const fileName = `Redump - ${target.name}.dat`;
      fs.writeFileSync(path.join(destDir, fileName), buf);
      return { slug: target.slug, success: true, fileName };
    }

    return {
      slug: target.slug,
      success: false,
      error: 'Response was neither a valid ZIP nor a DAT file.',
    };
  } catch (err) {
    return {
      slug: target.slug,
      success: false,
      error: (err as Error).message,
    };
  }
}

/**
 * Downloads a single No-Intro DAT file from Libretro Database (or direct mirror URL) and saves it to `destDir`.
 */
export async function downloadNoIntroDat(
  target: NoIntroTarget,
  destDir: string,
): Promise<{
  name: string;
  success: boolean;
  fileName?: string;
  error?: string;
}> {
  const localFileName = target.customLocalFileName || target.remoteFileName;
  const branchPath = target.repoBranchPath || 'metadat/no-intro';
  const encodedFile = encodeURIComponent(target.remoteFileName);
  const url =
    target.directUrl ||
    `https://raw.githubusercontent.com/libretro/libretro-database/master/${branchPath}/${encodedFile}`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'CollectionTracker-DatSync/1.0',
      },
    });

    if (!res.ok) {
      const existingPath = path.join(destDir, localFileName);
      if (target.directUrl && fs.existsSync(existingPath)) {
        return {
          name: target.name,
          success: true,
          fileName: localFileName,
        };
      }
      return {
        name: target.name,
        success: false,
        error: `HTTP ${res.status} ${res.statusText}`,
      };
    }

    const content = await res.text();
    if (!content.includes('<datafile') && !content.includes('clrmamepro (')) {
      return {
        name: target.name,
        success: false,
        error: 'Downloaded content is not a valid No-Intro datafile.',
      };
    }

    const patchedContent = applyCanonicalDatPatches(content, localFileName);
    const outPath = path.join(destDir, localFileName);
    fs.writeFileSync(outPath, patchedContent, 'utf8');
    return {
      name: target.name,
      success: true,
      fileName: localFileName,
    };
  } catch (err) {
    const existingPath = path.join(destDir, localFileName);
    if (target.directUrl && fs.existsSync(existingPath)) {
      return {
        name: target.name,
        success: true,
        fileName: localFileName,
      };
    }
    return {
      name: target.name,
      success: false,
      error: (err as Error).message,
    };
  }
}

function getCanonicalKeyForDatFile(fileName: string): string | null {
  const base = fileName
    .replace(/\.(dat|xml)$/i, '')
    .replace(/\s*\(\d{8}-\d{6}\)\s*$/i, '')
    .replace(/\s*-\s*Datfile\s*\(\d+\)\s*$/i, '')
    .replace(/^Unofficial\s*-\s*/i, '')
    .replace(/^Non-Redump\s*-\s*/i, '')
    .trim();

  const lower = base.toLowerCase();

  if (
    lower.startsWith('atari - 2600') ||
    lower.startsWith('atari - atari 2600')
  )
    return 'no-intro:atari-2600';
  if (
    lower.startsWith('atari - 5200') ||
    lower.startsWith('atari - atari 5200')
  )
    return 'no-intro:atari-5200';
  if (
    lower.startsWith('atari - 7800') ||
    lower.startsWith('atari - atari 7800')
  )
    return 'no-intro:atari-7800';
  if (lower.startsWith('atari - jaguar') && !lower.includes('jaguar cd'))
    return 'no-intro:atari-jaguar';
  if (lower.startsWith('atari - atari jaguar')) return 'no-intro:atari-jaguar';
  if (
    lower.startsWith('atari - lynx') ||
    lower.startsWith('atari - atari lynx')
  )
    return 'no-intro:atari-lynx';
  if (lower.startsWith('coleco - colecovision')) return 'no-intro:colecovision';
  if (lower.startsWith('mattel - intellivision'))
    return 'no-intro:intellivision';
  if (lower.startsWith('nec - pc engine - turbografx')) return 'no-intro:tg16';
  if (lower.startsWith('nintendo - family computer disk system'))
    return 'no-intro:fds';
  if (lower === 'nintendo - game boy') return 'no-intro:gb';
  if (lower.startsWith('nintendo - game boy color')) return 'no-intro:gbc';
  if (lower.startsWith('nintendo - game boy advance')) return 'no-intro:gba';
  if (lower.startsWith('nintendo - nintendo 64dd')) return 'no-intro:n64dd';
  if (lower.startsWith('nintendo - nintendo 64')) return 'no-intro:n64';
  if (lower.startsWith('nintendo - nintendo dsi')) return 'no-intro:ndsi';
  if (lower.startsWith('nintendo - nintendo ds')) return 'no-intro:nds';
  if (lower.startsWith('nintendo - new nintendo 3ds')) return 'no-intro:nn3ds';
  if (lower.startsWith('nintendo - nintendo 3ds')) return 'no-intro:n3ds';
  if (lower.startsWith('nintendo - nintendo entertainment system'))
    return 'no-intro:nes';
  if (lower.startsWith('nintendo - super nintendo entertainment system'))
    return 'no-intro:snes';
  if (lower.startsWith('nintendo - virtual boy')) return 'no-intro:vb';
  if (lower.startsWith('sega - 32x')) return 'no-intro:32x';
  if (lower.startsWith('sega - game gear')) return 'no-intro:gg';
  if (lower.startsWith('sega - master system - mark iii'))
    return 'no-intro:sms';
  if (lower.startsWith('sega - mega drive - genesis'))
    return 'no-intro:genesis';
  if (lower.startsWith('sega - pico') || lower.startsWith('sega - beena'))
    return 'no-intro:pico';
  if (lower === 'snk - neo geo pocket') return 'no-intro:ngp';
  if (lower.startsWith('snk - neo geo pocket color')) return 'no-intro:ngpc';
  if (lower.startsWith('tiger - game.com')) return 'no-intro:gamecom';
  if (lower.startsWith('sony - playstation vita (psvgamesd)'))
    return 'no-intro:psv-sd';
  if (lower.startsWith('sony - playstation vita')) return 'no-intro:psv-extra';

  if (lower.startsWith('panasonic - 3do')) return 'redump:3do';
  if (lower.startsWith('atari - jaguar cd')) return 'redump:ajcd';
  if (lower.startsWith('philips - cd-i')) return 'redump:cdi';
  if (lower.startsWith('sega - dreamcast')) return 'redump:dc';
  if (lower.startsWith('nintendo - gamecube')) return 'redump:gc';
  if (lower.startsWith('sega - mega-cd') || lower.startsWith('sega - sega cd'))
    return 'redump:mcd';
  if (lower.startsWith('snk - neo geo cd')) return 'redump:ngcd';
  if (lower.startsWith('nec - pc engine cd')) return 'redump:pcecd';
  if (lower === 'sony - playstation') return 'redump:psx';
  if (lower.startsWith('sony - playstation 2')) return 'redump:ps2';
  if (lower.startsWith('sony - playstation 3')) return 'redump:ps3';
  if (lower.startsWith('sony - playstation 4')) return 'redump:ps4';
  if (lower.startsWith('sony - playstation 5')) return 'redump:ps5';
  if (lower.startsWith('sony - playstation portable')) return 'redump:psp';
  if (lower.startsWith('sega - saturn')) return 'redump:ss';
  if (lower === 'nintendo - wii') return 'redump:wii';
  if (lower.startsWith('nintendo - wii u')) return 'redump:wiiu';
  if (lower === 'microsoft - xbox') return 'redump:xbox';
  if (lower.startsWith('microsoft - xbox 360')) return 'redump:x360';
  if (lower.startsWith('microsoft - xbox one')) return 'redump:xbone';
  if (lower.startsWith('microsoft - xbox series')) return 'redump:xsx';

  return null;
}

const CANONICAL_NO_INTRO_FILENAMES: Record<string, string> = {
  'no-intro:atari-2600': 'Atari - Atari 2600.dat',
  'no-intro:atari-5200': 'Atari - Atari 5200.dat',
  'no-intro:atari-7800': 'Atari - Atari 7800 (BIN).dat',
  'no-intro:atari-jaguar': 'Atari - Atari Jaguar (J64).dat',
  'no-intro:atari-lynx': 'Atari - Atari Lynx (LNX).dat',
  'no-intro:colecovision': 'Coleco - ColecoVision.dat',
  'no-intro:intellivision': 'Mattel - Intellivision.dat',
  'no-intro:tg16': 'NEC - PC Engine - TurboGrafx-16.dat',
  'no-intro:fds': 'Nintendo - Family Computer Disk System (FDS).dat',
  'no-intro:gb': 'Nintendo - Game Boy.dat',
  'no-intro:gbc': 'Nintendo - Game Boy Color.dat',
  'no-intro:gba': 'Nintendo - Game Boy Advance.dat',
  'no-intro:n64': 'Nintendo - Nintendo 64 (BigEndian).dat',
  'no-intro:n64dd': 'Nintendo - Nintendo 64DD.dat',
  'no-intro:nds': 'Nintendo - Nintendo DS (Decrypted).dat',
  'no-intro:ndsi': 'Nintendo - Nintendo DSi (Decrypted).dat',
  'no-intro:n3ds': 'Nintendo - Nintendo 3DS (Decrypted).dat',
  'no-intro:nn3ds': 'Nintendo - New Nintendo 3DS (Decrypted).dat',
  'no-intro:nes': 'Nintendo - Nintendo Entertainment System (Headered).dat',
  'no-intro:snes': 'Nintendo - Super Nintendo Entertainment System.dat',
  'no-intro:vb': 'Nintendo - Virtual Boy.dat',
  'no-intro:32x': 'Sega - 32X.dat',
  'no-intro:gg': 'Sega - Game Gear.dat',
  'no-intro:sms': 'Sega - Master System - Mark III.dat',
  'no-intro:genesis': 'Sega - Mega Drive - Genesis.dat',
  'no-intro:pico': 'Sega - Beena.dat',
  'no-intro:ngp': 'SNK - Neo Geo Pocket.dat',
  'no-intro:ngpc': 'SNK - Neo Geo Pocket Color.dat',
  'no-intro:gamecom': 'Tiger - Game.com.dat',
  'no-intro:psv-sd': 'Sony - PlayStation Vita (PSVgameSD).dat',
};

function scoreDatFileQuality(filePath: string, fileName: string): number {
  let score = 0;
  try {
    const head = fs.readFileSync(filePath, 'utf8').slice(0, 1000);
    if (head.includes('datomatic.no-intro.org')) score += 100;
    else if (head.includes('<datafile')) score += 50;
  } catch {
    return -1;
  }

  const tsMatch = fileName.match(/\((\d{8})-(\d{6})\)/);
  if (tsMatch) {
    score += parseInt(tsMatch[1], 10) / 100000000;
  }
  const redumpVerMatch = fileName.match(/Datfile\s*\((\d+)\)/i);
  if (redumpVerMatch) {
    score += parseInt(redumpVerMatch[1], 10) / 100000;
  }
  return score;
}

/**
 * Deduplicates, prunes untracked platforms, and normalizes filenames inside a DAT directory.
 */
export function pruneAndDeduplicateDats(datsRootDir: string): {
  removedCount: number;
  renamedCount: number;
  keptCount: number;
} {
  let removedCount = 0;
  let renamedCount = 0;
  let keptCount = 0;

  const noIntroDir = path.join(datsRootDir, 'No-Intro');
  const redumpDir = path.join(datsRootDir, 'Redump');

  if (fs.existsSync(datsRootDir)) {
    for (const rootEntry of fs.readdirSync(datsRootDir, {
      withFileTypes: true,
    })) {
      if (rootEntry.isFile() && /\.(dat|xml)$/i.test(rootEntry.name)) {
        const fullRootPath = path.join(datsRootDir, rootEntry.name);
        const key = getCanonicalKeyForDatFile(rootEntry.name);
        if (key?.startsWith('no-intro:')) {
          fs.mkdirSync(noIntroDir, { recursive: true });
          const targetSubPath = path.join(noIntroDir, rootEntry.name);
          if (!fs.existsSync(targetSubPath)) {
            fs.renameSync(fullRootPath, targetSubPath);
          } else {
            fs.unlinkSync(fullRootPath);
            removedCount++;
          }
        } else if (key?.startsWith('redump:')) {
          fs.mkdirSync(redumpDir, { recursive: true });
          const targetSubPath = path.join(redumpDir, rootEntry.name);
          if (!fs.existsSync(targetSubPath)) {
            fs.renameSync(fullRootPath, targetSubPath);
          } else {
            fs.unlinkSync(fullRootPath);
            removedCount++;
          }
        } else {
          fs.unlinkSync(fullRootPath);
          removedCount++;
        }
      }
    }
  }

  for (const subDir of [noIntroDir, redumpDir]) {
    if (!fs.existsSync(subDir)) continue;

    for (const entry of fs.readdirSync(subDir, { withFileTypes: true })) {
      const fullPath = path.join(subDir, entry.name);
      if (entry.isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true });
        removedCount++;
      } else if (!entry.name.endsWith('.dat') && !entry.name.endsWith('.xml')) {
        fs.unlinkSync(fullPath);
        removedCount++;
      }
    }

    const groups = new Map<
      string,
      { fileName: string; fullPath: string; score: number }[]
    >();
    for (const fileName of fs.readdirSync(subDir)) {
      const fullPath = path.join(subDir, fileName);
      const key = getCanonicalKeyForDatFile(fileName);
      if (!key) {
        fs.unlinkSync(fullPath);
        removedCount++;
        continue;
      }

      if (key === 'no-intro:psv-extra') {
        const keepVitaExtras = [
          'Non-Redump - Sony - PlayStation Vita (20260402-123143).dat',
          'Sony - PlayStation Vita (Black Fin) (20250929-143154).dat',
          'Sony - PlayStation Vita (PSN) (Content) (20260405-145718).dat',
        ];
        if (!keepVitaExtras.includes(fileName)) {
          fs.unlinkSync(fullPath);
          removedCount++;
        } else {
          keptCount++;
        }
        continue;
      }

      const score = scoreDatFileQuality(fullPath, fileName);
      const list = groups.get(key) || [];
      list.push({ fileName, fullPath, score });
      groups.set(key, list);
    }

    for (const [key, candidates] of groups.entries()) {
      candidates.sort((a, b) => b.score - a.score);
      const winner = candidates[0];

      for (let i = 1; i < candidates.length; i++) {
        try {
          fs.unlinkSync(candidates[i].fullPath);
          removedCount++;
        } catch {
          // Ignore unlink error
        }
      }

      const rawContent = fs.readFileSync(winner.fullPath, 'utf8');
      const patchedContent = applyCanonicalDatPatches(
        rawContent,
        winner.fileName,
      );
      if (patchedContent !== rawContent) {
        fs.writeFileSync(winner.fullPath, patchedContent, 'utf8');
      }

      const canonicalName = CANONICAL_NO_INTRO_FILENAMES[key];
      if (canonicalName && winner.fileName !== canonicalName) {
        const targetPath = path.join(subDir, canonicalName);
        fs.renameSync(winner.fullPath, targetPath);
        renamedCount++;
      }
      keptCount++;
    }
  }

  return { removedCount, renamedCount, keptCount };
}

/**
 * Mirrors the clean, deduplicated DAT files from `sourceDatsDir` into `targetDatsDir`.
 */
export function syncCleanDatsToDirectory(
  sourceDatsDir: string,
  targetDatsDir: string,
): { copied: number; deleted: number } {
  let copied = 0;
  let deleted = 0;

  for (const sub of ['No-Intro', 'Redump']) {
    const srcSub = path.join(sourceDatsDir, sub);
    const dstSub = path.join(targetDatsDir, sub);
    if (!fs.existsSync(srcSub)) continue;
    fs.mkdirSync(dstSub, { recursive: true });

    const srcFiles = new Set(fs.readdirSync(srcSub));

    for (const dstEntry of fs.readdirSync(dstSub, { withFileTypes: true })) {
      const dstPath = path.join(dstSub, dstEntry.name);
      if (dstEntry.isDirectory()) {
        fs.rmSync(dstPath, { recursive: true, force: true });
        deleted++;
      } else if (!srcFiles.has(dstEntry.name)) {
        fs.unlinkSync(dstPath);
        deleted++;
      }
    }

    for (const fileName of srcFiles) {
      const srcPath = path.join(srcSub, fileName);
      const dstPath = path.join(dstSub, fileName);
      fs.copyFileSync(srcPath, dstPath);
      copied++;
    }
  }

  return { copied, deleted };
}

/**
 * Downloads all configured Redump and No-Intro DATs into `/dats/Redump` and `/dats/No-Intro`.
 */
export async function downloadAllCanonicalDats(options?: {
  redumpOnly?: boolean;
  noIntroOnly?: boolean;
  datsRootDir?: string;
  externalSyncDir?: string;
}): Promise<{
  redumpSucceeded: number;
  redumpFailed: number;
  noIntroSucceeded: number;
  noIntroFailed: number;
}> {
  const rootDir = options?.datsRootDir || path.join(process.cwd(), 'dats');
  const redumpDir = path.join(rootDir, 'Redump');
  const noIntroDir = path.join(rootDir, 'No-Intro');

  fs.mkdirSync(redumpDir, { recursive: true });
  fs.mkdirSync(noIntroDir, { recursive: true });

  let redumpSucceeded = 0;
  let redumpFailed = 0;
  let noIntroSucceeded = 0;
  let noIntroFailed = 0;

  if (!options?.noIntroOnly) {
    console.log(
      `\n=== Downloading ${REDUMP_TARGETS.length} Official Redump Disc DATs ===`,
    );
    for (const target of REDUMP_TARGETS) {
      process.stdout.write(`  Fetching Redump [${target.name}]... `);
      const res = await downloadRedumpDat(target, redumpDir);
      if (res.success) {
        redumpSucceeded++;
        console.log(`✅ Saved ${res.fileName}`);
      } else {
        redumpFailed++;
        console.log(`⚠️ Skipped (${res.error})`);
      }
    }

    console.log(
      `\n=== Checking ${REDUMP_WIP_TARGETS.length} Modern Optical Disc Platforms (Wii U, PS4, PS5, Xbox One, Series X) ===`,
    );
    for (const target of REDUMP_WIP_TARGETS) {
      process.stdout.write(`  Checking Redump [${target.name}]... `);
      const res = await downloadRedumpDat(target, redumpDir);
      if (res.success) {
        redumpSucceeded++;
        console.log(`✅ Ready (${res.fileName})`);
      } else {
        console.log(
          `ℹ️ Public Redump DAT restricted (${res.error}); using local DAT / curated serial catalog.`,
        );
      }
    }
  }

  if (!options?.redumpOnly) {
    console.log(
      `\n=== Downloading ${NO_INTRO_TARGETS.length} Public No-Intro Cartridge DATs ===`,
    );
    for (const target of NO_INTRO_TARGETS) {
      process.stdout.write(`  Fetching No-Intro [${target.name}]... `);
      const res = await downloadNoIntroDat(target, noIntroDir);
      if (res.success) {
        noIntroSucceeded++;
        console.log(`✅ Saved ${res.fileName}`);
      } else {
        noIntroFailed++;
        console.log(`⚠️ Skipped (${res.error})`);
      }
    }
  }

  console.log('\n=== Pruning & Deduplicating DAT Directory ===');
  const pruneRes = pruneAndDeduplicateDats(rootDir);
  console.log(
    `  Kept ${pruneRes.keptCount} canonical DATs, removed ${pruneRes.removedCount} duplicates/untracked files, normalized ${pruneRes.renamedCount} filenames.`,
  );

  const externalDir =
    options?.externalSyncDir ||
    (fs.existsSync('D:\\Games\\Dats') ? 'D:\\Games\\Dats' : undefined);
  if (externalDir) {
    console.log(`\n=== Mirroring Clean DATs to ${externalDir} ===`);
    const syncRes = syncCleanDatsToDirectory(rootDir, externalDir);
    console.log(
      `  Synced ${syncRes.copied} canonical DATs to ${externalDir} (removed ${syncRes.deleted} obsolete/duplicate files).`,
    );
  }

  const tempDir = path.join(process.cwd(), 'scripts', 'temp');
  if (fs.existsSync(tempDir)) {
    for (const f of fs.readdirSync(tempDir)) {
      if (f.startsWith('dat_cache_') && f.endsWith('.json')) {
        try {
          fs.unlinkSync(path.join(tempDir, f));
        } catch {
          // Ignore cache unlink errors
        }
      }
    }
  }

  return {
    redumpSucceeded,
    redumpFailed,
    noIntroSucceeded,
    noIntroFailed,
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const args = process.argv.slice(2);
  const redumpOnly = args.includes('--redump-only');
  const noIntroOnly = args.includes('--no-intro-only');
  const syncDirArg = args
    .find((a) => a.startsWith('--sync-dir='))
    ?.split('=')[1];

  downloadAllCanonicalDats({
    redumpOnly,
    noIntroOnly,
    externalSyncDir: syncDirArg,
  })
    .then((summary) => {
      console.log('\n=== DAT Download Summary ===');
      if (!noIntroOnly) {
        console.log(
          `  Redump:   ${summary.redumpSucceeded} succeeded, ${summary.redumpFailed} failed`,
        );
      }
      if (!redumpOnly) {
        console.log(
          `  No-Intro: ${summary.noIntroSucceeded} succeeded, ${summary.noIntroFailed} failed`,
        );
      }
    })
    .catch((err) => {
      console.error('Fatal error downloading DATs:', err);
      process.exit(1);
    });
}
