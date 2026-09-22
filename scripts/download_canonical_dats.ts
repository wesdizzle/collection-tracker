/**
 * CANONICAL DAT DOWNLOADER UTILITY
 *
 * Automatically downloads and updates official, canonical DAT files for all tracked platforms:
 * 1. Redump (Optical Disc Systems): Fetches latest zip archives from http://redump.org/datfile/<slug>/
 *    and extracts canonical XML DATs into `dats/`.
 * 2. No-Intro (Cartridge & ROM Systems): Fetches latest canonical XML DATs from the master
 *    No-Intro daily mirror into `dats/No-Intro/`.
 *
 * USAGE:
 *   npx tsx scripts/download_canonical_dats.ts
 *   npm run dats:download
 *   npm run dats:update (Downloads latest DATs and immediately runs synchronization)
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const datsDir = path.join(rootDir, 'dats');
const noIntroDir = path.join(datsDir, 'No-Intro');
const tempDir = path.join(rootDir, 'scripts', 'temp');

export interface RedumpPlatformTarget {
  name: string;
  slug: string;
  pattern: RegExp;
}

export interface NoIntroPlatformTarget {
  name: string;
  remoteFileName: string;
  canonicalFileName?: string;
  pattern: RegExp;
}

/**
 * Optical disc platforms sourced from Redump.
 */
export const REDUMP_TARGETS: RedumpPlatformTarget[] = [
  {
    name: 'Panasonic 3DO',
    slug: '3do',
    pattern: /3DO Interactive Multiplayer/i,
  },
  { name: 'Atari Jaguar CD', slug: 'ajcd', pattern: /Jaguar CD/i },
  { name: 'SNK Neo Geo CD', slug: 'ngcd', pattern: /Neo Geo CD/i },
  { name: 'Nintendo GameCube', slug: 'gc', pattern: /Nintendo - GameCube/i },
  { name: 'Nintendo Wii', slug: 'wii', pattern: /Nintendo - Wii -/i },
  { name: 'Philips CD-i', slug: 'cdi', pattern: /Philips - CD-i/i },
  { name: 'Sony PlayStation', slug: 'psx', pattern: /Sony - PlayStation -/i },
  {
    name: 'Sony PlayStation 2',
    slug: 'ps2',
    pattern: /Sony - PlayStation 2 -/i,
  },
  {
    name: 'Sony PlayStation Portable',
    slug: 'psp',
    pattern: /Sony - PlayStation Portable/i,
  },
  { name: 'Sony PlayStation 3', slug: 'ps3', pattern: /Sony - PlayStation 3/i },
  { name: 'Sega CD', slug: 'mcd', pattern: /Mega CD & Sega CD/i },
  { name: 'Sega Saturn', slug: 'ss', pattern: /Sega - Saturn/i },
  { name: 'Sega Dreamcast', slug: 'dc', pattern: /Sega - Dreamcast/i },
  {
    name: 'TurboGrafx CD / PC Engine CD',
    slug: 'pce',
    pattern: /PC Engine CD & TurboGrafx CD/i,
  },
  { name: 'Microsoft Xbox', slug: 'xbox', pattern: /Microsoft - Xbox -/i },
  {
    name: 'Microsoft Xbox 360',
    slug: 'xbox360',
    pattern: /Microsoft - Xbox 360 -/i,
  },
];

/**
 * Cartridge and ROM platforms sourced from No-Intro.
 */
export const NO_INTRO_TARGETS: NoIntroPlatformTarget[] = [
  {
    name: 'Atari 2600',
    remoteFileName: 'Atari - 2600.dat',
    canonicalFileName: 'Atari - Atari 2600.dat',
    pattern: /^Atari\s*-\s*(Atari\s*)?2600/i,
  },
  {
    name: 'Atari 5200',
    remoteFileName: 'Atari - 5200.dat',
    canonicalFileName: 'Atari - Atari 5200.dat',
    pattern: /^Atari\s*-\s*(Atari\s*)?5200/i,
  },
  {
    name: 'Atari 7800',
    remoteFileName: 'Atari - 7800.dat',
    canonicalFileName: 'Atari - Atari 7800 (BIN).dat',
    pattern: /^Atari\s*-\s*(Atari\s*)?7800/i,
  },
  {
    name: 'Atari Lynx',
    remoteFileName: 'Atari - Lynx.dat',
    canonicalFileName: 'Atari - Atari Lynx (LYX).dat',
    pattern: /^Atari\s*-\s*(Atari\s*)?Lynx/i,
  },
  {
    name: 'Atari Jaguar',
    remoteFileName: 'Atari - Jaguar.dat',
    canonicalFileName: 'Atari - Atari Jaguar (ROM).dat',
    pattern: /^Atari\s*-\s*(Atari\s*)?Jaguar/i,
  },
  {
    name: 'ColecoVision',
    remoteFileName: 'Coleco - ColecoVision.dat',
    canonicalFileName: 'Coleco - ColecoVision.dat',
    pattern: /^Coleco\s*-\s*ColecoVision/i,
  },
  {
    name: 'Intellivision',
    remoteFileName: 'Mattel - Intellivision.dat',
    canonicalFileName: 'Mattel - Intellivision.dat',
    pattern: /^Mattel\s*-\s*Intellivision/i,
  },
  {
    name: 'Neo Geo Pocket',
    remoteFileName: 'SNK - Neo Geo Pocket.dat',
    canonicalFileName: 'SNK - Neo Geo Pocket.dat',
    pattern: /^SNK\s*-\s*Neo Geo Pocket(?!\s*Color)/i,
  },
  {
    name: 'Neo Geo Pocket Color',
    remoteFileName: 'SNK - Neo Geo Pocket Color.dat',
    canonicalFileName: 'SNK - Neo Geo Pocket Color.dat',
    pattern: /^SNK\s*-\s*Neo Geo Pocket Color/i,
  },
  {
    name: 'Nintendo Entertainment System',
    remoteFileName: 'Nintendo - Nintendo Entertainment System.dat',
    canonicalFileName: 'Nintendo - Nintendo Entertainment System.dat',
    pattern: /^Nintendo\s*-\s*Nintendo Entertainment System/i,
  },
  {
    name: 'Super Nintendo Entertainment System',
    remoteFileName: 'Nintendo - Super Nintendo Entertainment System.dat',
    canonicalFileName: 'Nintendo - Super Nintendo Entertainment System.dat',
    pattern: /^Nintendo\s*-\s*Super Nintendo Entertainment System/i,
  },
  {
    name: 'Nintendo 64',
    remoteFileName: 'Nintendo - Nintendo 64.dat',
    canonicalFileName: 'Nintendo - Nintendo 64.dat',
    pattern: /^Nintendo\s*-\s*Nintendo 64/i,
  },
  {
    name: 'Game Boy',
    remoteFileName: 'Nintendo - Game Boy.dat',
    canonicalFileName: 'Nintendo - Game Boy.dat',
    pattern: /^Nintendo\s*-\s*Game Boy(?!\s*(Advance|Color))/i,
  },
  {
    name: 'Game Boy Color',
    remoteFileName: 'Nintendo - Game Boy Color.dat',
    canonicalFileName: 'Nintendo - Game Boy Color.dat',
    pattern: /^Nintendo\s*-\s*Game Boy Color/i,
  },
  {
    name: 'Game Boy Advance',
    remoteFileName: 'Nintendo - Game Boy Advance.dat',
    canonicalFileName: 'Nintendo - Game Boy Advance.dat',
    pattern: /^Nintendo\s*-\s*Game Boy Advance/i,
  },
  {
    name: 'Nintendo DS',
    remoteFileName: 'Nintendo - Nintendo DS.dat',
    canonicalFileName: 'Nintendo - Nintendo DS.dat',
    pattern: /^Nintendo\s*-\s*Nintendo DS(?!\w)/i,
  },
  {
    name: 'Nintendo 3DS',
    remoteFileName: 'Nintendo - Nintendo 3DS.dat',
    canonicalFileName: 'Nintendo - Nintendo 3DS.dat',
    pattern: /^Nintendo\s*-\s*Nintendo 3DS/i,
  },
  {
    name: 'New Nintendo 3DS',
    remoteFileName: 'Nintendo - New Nintendo 3DS.dat',
    canonicalFileName: 'Nintendo - New Nintendo 3DS.dat',
    pattern: /^Nintendo\s*-\s*New Nintendo 3DS/i,
  },
  {
    name: 'Virtual Boy',
    remoteFileName: 'Nintendo - Virtual Boy.dat',
    canonicalFileName: 'Nintendo - Virtual Boy.dat',
    pattern: /^Nintendo\s*-\s*Virtual Boy/i,
  },
  {
    name: 'Pokemon Mini',
    remoteFileName: 'Nintendo - Pokemon Mini.dat',
    canonicalFileName: 'Nintendo - Pokemon Mini.dat',
    pattern: /^Nintendo\s*-\s*Pokemon Mini/i,
  },
  {
    name: 'Sega Master System',
    remoteFileName: 'Sega - Master System - Mark III.dat',
    canonicalFileName: 'Sega - Master System - Mark III.dat',
    pattern: /^Sega\s*-\s*Master System/i,
  },
  {
    name: 'Sega Genesis / Mega Drive',
    remoteFileName: 'Sega - Mega Drive - Genesis.dat',
    canonicalFileName: 'Sega - Mega Drive - Genesis.dat',
    pattern: /^Sega\s*-\s*Mega Drive\s*-\s*Genesis/i,
  },
  {
    name: 'Sega Game Gear',
    remoteFileName: 'Sega - Game Gear.dat',
    canonicalFileName: 'Sega - Game Gear.dat',
    pattern: /^Sega\s*-\s*Game Gear/i,
  },
  {
    name: 'Sega Pico',
    remoteFileName: 'Sega - PICO.dat',
    canonicalFileName: 'Sega - PICO.dat',
    pattern: /^Sega\s*-\s*PICO/i,
  },
  {
    name: 'Sega 32X',
    remoteFileName: 'Sega - 32X.dat',
    canonicalFileName: 'Sega - 32X.dat',
    pattern: /^Sega\s*-\s*32X/i,
  },
  {
    name: 'TurboGrafx-16 / PC Engine',
    remoteFileName: 'NEC - PC Engine - TurboGrafx 16.dat',
    canonicalFileName: 'NEC - PC Engine - TurboGrafx 16.dat',
    pattern: /^NEC\s*-\s*PC Engine/i,
  },
  {
    name: 'Tiger Game.com',
    remoteFileName: 'Tiger - Game.com.dat',
    canonicalFileName: 'Tiger - Game.com.dat',
    pattern: /^Tiger\s*-\s*Game\.com/i,
  },
  {
    name: 'WonderSwan',
    remoteFileName: 'Bandai - WonderSwan.dat',
    canonicalFileName: 'Bandai - WonderSwan.dat',
    pattern: /^Bandai\s*-\s*WonderSwan(?!\s*Color)/i,
  },
  {
    name: 'WonderSwan Color',
    remoteFileName: 'Bandai - WonderSwan Color.dat',
    canonicalFileName: 'Bandai - WonderSwan Color.dat',
    pattern: /^Bandai\s*-\s*WonderSwan Color/i,
  },
];

/**
 * Downloads a Redump DAT zip archive and extracts it into the target directory.
 */
export async function downloadRedumpDat(
  target: RedumpPlatformTarget,
  destinationDir: string = datsDir,
): Promise<{
  success: boolean;
  fileName?: string;
  sizeBytes?: number;
  error?: string;
}> {
  const url = `http://redump.org/datfile/${target.slug}/`;
  const tempZipPath = path.join(tempDir, `redump_${target.slug}.zip`);
  const extractTempDir = path.join(tempDir, `extract_${target.slug}`);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'CollectionTracker/2.0 (DAT Synchronizer)',
      },
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status} ${response.statusText}`,
      };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 500) {
      return {
        success: false,
        error: 'Downloaded file is unexpectedly small / empty.',
      };
    }

    fs.writeFileSync(tempZipPath, buffer);

    if (fs.existsSync(extractTempDir)) {
      fs.rmSync(extractTempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(extractTempDir, { recursive: true });

    // Extract zip using system tar
    execSync(`tar -xf "${tempZipPath}" -C "${extractTempDir}"`);

    const extractedFiles = fs.readdirSync(extractTempDir);
    const datFile = extractedFiles.find(
      (f) => f.endsWith('.dat') || f.endsWith('.xml'),
    );

    if (!datFile) {
      return {
        success: false,
        error: 'No .dat or .xml file found in extracted archive.',
      };
    }

    const extractedFilePath = path.join(extractTempDir, datFile);
    const finalDestination = path.join(destinationDir, datFile);

    // Remove any older existing versions of this DAT in destinationDir
    const existingFiles = fs.readdirSync(destinationDir);
    for (const file of existingFiles) {
      if (file !== datFile && target.pattern.test(file)) {
        try {
          fs.unlinkSync(path.join(destinationDir, file));
        } catch {
          // Ignore removal errors
        }
      }
    }

    fs.copyFileSync(extractedFilePath, finalDestination);
    const size = fs.statSync(finalDestination).size;

    return { success: true, fileName: datFile, sizeBytes: size };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  } finally {
    // Cleanup temporary files
    if (fs.existsSync(tempZipPath)) {
      try {
        fs.unlinkSync(tempZipPath);
      } catch {
        // Ignore removal error
      }
    }
    if (fs.existsSync(extractTempDir)) {
      try {
        fs.rmSync(extractTempDir, { recursive: true, force: true });
      } catch {
        // Ignore removal error
      }
    }
  }
}

/**
 * Applies durable patches to canonical DAT content for verified hardware edge cases.
 *
 * NOTE: These patches serve as temporary bridges for known upstream DAT omissions or uncatalogued
 * physical hardware revisions. They may not be necessary in the future once upstream mirrors
 * (e.g. official Datomatic daily archives or libretro-database) natively include complete, unstripped
 * entries programmatically without manual intervention.
 *
 * Patches currently applied:
 * 1. Sonic & Knuckles (World): Restores the 2 MB standalone retail cartridge (CRC 0658F691)
 *    alongside the 256 KB lock-on pass-through (CRC 4DCFD55C).
 *    (May not be necessary if upstream DATs preserve both ROMs in multi-chip cartridges).
 * 2. Mega Man - The Wily Wars (World) (Retro-Bit): Adds the verified physical cartridge
 *    manufacturing run (CRC 92FD68E9, SHA1 17C07481AE7C8D69C38557A51F70E257BCE799EF) alongside
 *    the initial community dump (CRC 0831020B), accommodating factory header checksum variations (DA69 vs 4CD9).
 *    (May not be necessary if No-Intro catalogs this physical cartridge batch/revision in the future).
 */
export function applyCanonicalDatPatches(
  content: string,
  fileName: string,
): string {
  // ---------------------------------------------------------------------------
  // Atari Header Normalization
  // Ensure CLRMamePro and XML internal header names match official canonical names
  // so downstream tools like IGIR generate clean, unified platform folders.
  // ---------------------------------------------------------------------------
  content = content
    .replace(/name\s*"Atari - 2600"/g, 'name "Atari - Atari 2600"')
    .replace(
      /description\s*"Atari - 2600"/g,
      'description "Atari - Atari 2600"',
    )
    .replace(/<name>Atari - 2600<\/name>/g, '<name>Atari - Atari 2600</name>')
    .replace(
      /<description>Atari - 2600<\/description>/g,
      '<description>Atari - Atari 2600</description>',
    )
    .replace(/name\s*"Atari - 5200"/g, 'name "Atari - Atari 5200"')
    .replace(
      /description\s*"Atari - 5200"/g,
      'description "Atari - Atari 5200"',
    )
    .replace(/<name>Atari - 5200<\/name>/g, '<name>Atari - Atari 5200</name>')
    .replace(
      /<description>Atari - 5200<\/description>/g,
      '<description>Atari - Atari 5200</description>',
    )
    .replace(/name\s*"Atari - 7800"/g, 'name "Atari - Atari 7800 (BIN)"')
    .replace(
      /description\s*"Atari - 7800"/g,
      'description "Atari - Atari 7800 (BIN)"',
    )
    .replace(
      /<name>Atari - 7800<\/name>/g,
      '<name>Atari - Atari 7800 (BIN)</name>',
    )
    .replace(
      /<description>Atari - 7800<\/description>/g,
      '<description>Atari - Atari 7800 (BIN)</description>',
    )
    .replace(/name\s*"Atari - Jaguar"/g, 'name "Atari - Atari Jaguar (ROM)"')
    .replace(
      /description\s*"Atari - Jaguar"/g,
      'description "Atari - Atari Jaguar (ROM)"',
    )
    .replace(
      /<name>Atari - Jaguar<\/name>/g,
      '<name>Atari - Atari Jaguar (ROM)</name>',
    )
    .replace(
      /<description>Atari - Jaguar<\/description>/g,
      '<description>Atari - Atari Jaguar (ROM)</description>',
    )
    .replace(/name\s*"Atari - Lynx"/g, 'name "Atari - Atari Lynx (LYX)"')
    .replace(
      /description\s*"Atari - Lynx"/g,
      'description "Atari - Atari Lynx (LYX)"',
    )
    .replace(
      /<name>Atari - Lynx<\/name>/g,
      '<name>Atari - Atari Lynx (LYX)</name>',
    )
    .replace(
      /<description>Atari - Lynx<\/description>/g,
      '<description>Atari - Atari Lynx (LYX)</description>',
    );

  if (
    fileName === 'Sega - Mega Drive - Genesis.dat' ||
    fileName.includes('Genesis') ||
    fileName.includes('Mega Drive')
  ) {
    // -------------------------------------------------------------------------
    // Patch 1: Sonic & Knuckles (World) Standalone Cartridge (2 MB)
    // Upstream libretro-database trimmed this multi-chip cart to only the 256 KB
    // lock-on ROM. May be deprecated once upstream mirrors retain both chips.
    // -------------------------------------------------------------------------
    // If CLRMamePro format lacks the 2 MB retail cartridge CRC 0658F691:
    if (content.includes('4DCFD55C') && !content.includes('0658F691')) {
      const skPatternClr =
        /game\s*\(\s*name\s*"Sonic & Knuckles \(World\)"\s*rom\s*\(\s*name\s*"[^"]+"\s*size\s*262144\s*crc\s*4DCFD55C[^)]*\)\s*\)/i;
      if (skPatternClr.test(content)) {
        const replacementClr = `game (
\tname "Sonic & Knuckles (World)"
\tserial "MK-1563-00"
\trom ( name "Sonic & Knuckles (World).md" size 2097152 crc 0658F691 md5 4EA493EA4E9F6C9EBFCCBDB15110367E sha1 88D6499D874DCB5721FF58D76FE1B9AF811192E3 serial "MK-1563-00" )
)
game (
\tname "Sonic & Knuckles (World) (Lock-on)"
\tserial "MK-1563-00"
\trom ( name "Sonic & Knuckles (World) (Lock-on).bin" size 262144 crc 4DCFD55C md5 B4E76E416B887F4E7413BA76FA735F16 sha1 70429F1D80503A0632F603BF762FE0BBAA881D22 serial "MK-1563-00" )
)`;
        content = content.replace(skPatternClr, replacementClr);
      }
    }

    // If XML format lacks the 2 MB retail cartridge CRC 0658F691:
    if (
      content.includes('<datafile>') &&
      content.includes('4DCFD55C') &&
      !content.includes('0658F691')
    ) {
      const skPatternXml =
        /<game name="Sonic &amp; Knuckles \(World\)">[\s\S]*?<rom [^>]*crc="4DCFD55C"[^>]*\/>[\s\S]*?<\/game>/i;
      if (skPatternXml.test(content)) {
        const replacementXml = `<game name="Sonic &amp; Knuckles (World)">
\t<description>Sonic &amp; Knuckles (World)</description>
\t<rom name="Sonic &amp; Knuckles (World).md" size="2097152" crc="0658F691" md5="4EA493EA4E9F6C9EBFCCBDB15110367E" sha1="88D6499D874DCB5721FF58D76FE1B9AF811192E3" serial="MK-1563-00"/>
</game>
<game name="Sonic &amp; Knuckles (World) (Lock-on)">
\t<description>Sonic &amp; Knuckles (World) (Lock-on)</description>
\t<rom name="Sonic &amp; Knuckles (World) (Lock-on).bin" size="262144" crc="4DCFD55C" md5="B4E76E416B887F4E7413BA76FA735F16" sha1="70429F1D80503A0632F603BF762FE0BBAA881D22" serial="MK-1563-00"/>
</game>`;
        content = content.replace(skPatternXml, replacementXml);
      }
    }

    // -------------------------------------------------------------------------
    // Patch 2: Mega Man - The Wily Wars (World) (Retro-Bit) Physical Revision
    // Factory PCB runs carry header checksum DA69 and tile table data yielding
    // CRC 92FD68E9. May be deprecated once No-Intro catalogs this physical revision.
    // -------------------------------------------------------------------------
    // If CLRMamePro format lacks the physical cartridge revision CRC 92FD68E9:
    if (content.includes('0831020B') && !content.includes('92FD68E9')) {
      const wwPatternClr =
        /game\s*\(\s*name\s*"Mega Man - The Wily Wars \(World\) \(Retro-Bit\)"[\s\S]*?rom\s*\(\s*name\s*"[^"]+"\s*size\s*2097152\s*crc\s*0831020B[^)]*\)\s*\)/i;
      if (wwPatternClr.test(content)) {
        const replacementClr = `game (
\tname "Mega Man - The Wily Wars (World) (Retro-Bit)"
\tserial "T-12053-00"
\trom ( name "Mega Man - The Wily Wars (World) (Retro-Bit).md" size 2097152 crc 0831020B md5 FB4FC95CE806265417BB44EEC2ACA488 sha1 617BC1EE5F31F4215CF47C5337FA7CA0BCEB6A45 serial "T-12053-00" )
)
game (
\tname "Mega Man - The Wily Wars (World) (Retro-Bit) (Alt)"
\tserial "T-12053-00"
\trom ( name "Mega Man - The Wily Wars (World) (Retro-Bit).md" size 2097152 crc 92FD68E9 md5 523074BADEA911E4BAE839066027E5B7 sha1 17C07481AE7C8D69C38557A51F70E257BCE799EF serial "T-12053-00" )
)`;
        content = content.replace(wwPatternClr, replacementClr);
      }
    }

    // If XML format lacks the physical cartridge revision CRC 92FD68E9:
    if (
      content.includes('<datafile>') &&
      content.includes('0831020B') &&
      !content.includes('92FD68E9')
    ) {
      const wwPatternXml =
        /<game name="Mega Man - The Wily Wars \(World\) \(Retro-Bit\)">[\s\S]*?<rom [^>]*crc="0831020B"[^>]*\/>[\s\S]*?<\/game>/i;
      if (wwPatternXml.test(content)) {
        const replacementXml = `<game name="Mega Man - The Wily Wars (World) (Retro-Bit)">
\t<description>Mega Man - The Wily Wars (World) (Retro-Bit)</description>
\t<rom name="Mega Man - The Wily Wars (World) (Retro-Bit).md" size="2097152" crc="0831020B" md5="FB4FC95CE806265417BB44EEC2ACA488" sha1="617BC1EE5F31F4215CF47C5337FA7CA0BCEB6A45" serial="T-12053-00"/>
</game>
<game name="Mega Man - The Wily Wars (World) (Retro-Bit) (Alt)">
\t<description>Mega Man - The Wily Wars (World) (Retro-Bit) (Alt)</description>
\t<rom name="Mega Man - The Wily Wars (World) (Retro-Bit).md" size="2097152" crc="92FD68E9" md5="523074BADEA911E4BAE839066027E5B7" sha1="17C07481AE7C8D69C38557A51F70E257BCE799EF" serial="T-12053-00"/>
</game>`;
        content = content.replace(wwPatternXml, replacementXml);
      }
    }
  }

  return content;
}

/**
 * Automatically detects and imports official Datomatic XML zip archives if downloaded by the user
 * and placed into `dats/` or `scripts/temp/`.
 * Strictly limits extraction to tracked platforms in NO_INTRO_TARGETS and writes canonical filenames.
 */
export function importLocalDatomaticArchives(
  searchDirs: string[] = [tempDir, datsDir],
  destinationDir: string = noIntroDir,
): number {
  let importedCount = 0;
  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    const zips = fs
      .readdirSync(dir)
      .filter(
        (f) =>
          f.toLowerCase().endsWith('.zip') &&
          (f.toLowerCase().includes('nointro') ||
            f.toLowerCase().includes('daily') ||
            f.toLowerCase().includes('datomatic')),
      );

    for (const zip of zips) {
      const zipPath = path.join(dir, zip);
      const extractDir = path.join(
        tempDir,
        `extract_manual_${path.basename(zip, '.zip')}`,
      );
      try {
        if (!fs.existsSync(extractDir)) {
          fs.mkdirSync(extractDir, { recursive: true });
        }
        execSync(`tar -xf "${zipPath}" -C "${extractDir}"`);
        const extracted = fs.readdirSync(extractDir);
        for (const file of extracted) {
          if (!file.endsWith('.dat') && !file.endsWith('.xml')) continue;

          // Strictly filter to tracked platforms in NO_INTRO_TARGETS
          const target = NO_INTRO_TARGETS.find((t) => t.pattern.test(file));
          if (!target) {
            continue;
          }

          const raw = fs.readFileSync(path.join(extractDir, file), 'utf8');
          const canonicalName =
            target.canonicalFileName || target.remoteFileName;
          const patched = applyCanonicalDatPatches(raw, canonicalName);

          // Clean up any older/competing versions in destinationDir
          if (fs.existsSync(destinationDir)) {
            const existingFiles = fs.readdirSync(destinationDir);
            for (const existing of existingFiles) {
              if (existing !== canonicalName && target.pattern.test(existing)) {
                try {
                  fs.unlinkSync(path.join(destinationDir, existing));
                } catch {
                  // Ignore removal errors
                }
              }
            }
          }

          const dest = path.join(destinationDir, canonicalName);
          fs.writeFileSync(dest, patched, 'utf8');
          importedCount++;
        }
        fs.rmSync(extractDir, { recursive: true, force: true });
      } catch (err) {
        console.warn(
          `[DAT-Downloader] Could not extract manual archive ${zip}:`,
          err,
        );
      }
    }
  }
  return importedCount;
}

/**
 * Downloads a No-Intro DAT file from canonical mirror.
 * Preserves high-fidelity official Datomatic XML files if already present locally.
 */
export async function downloadNoIntroDat(
  target: NoIntroPlatformTarget,
  destinationDir: string = noIntroDir,
  options: { forceOverwriteXml?: boolean } = {},
): Promise<{
  success: boolean;
  fileName?: string;
  sizeBytes?: number;
  error?: string;
}> {
  const canonicalName = target.canonicalFileName || target.remoteFileName;
  const finalDestination = path.join(destinationDir, canonicalName);

  // If an official Datomatic XML datafile already exists locally for this target,
  // preserve it instead of replacing it with a lower-fidelity clrmamepro mirror from libretro
  // unless forceOverwriteXml is true.
  if (!options.forceOverwriteXml && fs.existsSync(destinationDir)) {
    const existingFiles = fs.readdirSync(destinationDir);
    const existingFile = existingFiles.find((f) => target.pattern.test(f));
    if (existingFile) {
      const existingPath = path.join(destinationDir, existingFile);
      try {
        const head = fs
          .readFileSync(existingPath, { encoding: 'utf8', flag: 'r' })
          .substring(0, 500);
        if (
          head.includes('<datafile>') &&
          (head.includes('datomatic.no-intro.org') ||
            head.includes('schema_nointro_datfile'))
        ) {
          // Canonical Datomatic XML is already present
          if (existingFile !== canonicalName) {
            fs.renameSync(existingPath, finalDestination);
          }
          // Remove any other duplicate files matching target.pattern
          for (const other of existingFiles) {
            if (
              other !== existingFile &&
              other !== canonicalName &&
              target.pattern.test(other)
            ) {
              try {
                fs.unlinkSync(path.join(destinationDir, other));
              } catch {
                // Ignore removal error
              }
            }
          }
          const size = fs.statSync(finalDestination).size;
          return { success: true, fileName: canonicalName, sizeBytes: size };
        }
      } catch {
        // Fall through to download if reading failed
      }
    }
  }

  const baseUrl =
    'https://raw.githubusercontent.com/libretro/libretro-database/master/metadat/no-intro/';
  const url = `${baseUrl}${encodeURIComponent(target.remoteFileName)}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'CollectionTracker/2.0 (DAT Synchronizer)',
      },
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status} ${response.statusText}`,
      };
    }

    const text = await response.text();
    if (
      !text ||
      text.length < 200 ||
      (!text.includes('<datafile>') &&
        !text.includes('clrmamepro') &&
        !text.includes('game ('))
    ) {
      return {
        success: false,
        error: 'Downloaded content is not a valid No-Intro datafile.',
      };
    }

    // Remove any older existing versions of this DAT in destinationDir
    if (fs.existsSync(destinationDir)) {
      const existingFiles = fs.readdirSync(destinationDir);
      for (const file of existingFiles) {
        if (file !== canonicalName && target.pattern.test(file)) {
          try {
            fs.unlinkSync(path.join(destinationDir, file));
          } catch {
            // Ignore removal errors
          }
        }
      }
    }

    const patchedText = applyCanonicalDatPatches(text, canonicalName);
    fs.writeFileSync(finalDestination, patchedText, 'utf8');
    const size = fs.statSync(finalDestination).size;

    return { success: true, fileName: canonicalName, sizeBytes: size };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

/**
 * Deduplicates and prunes any untracked or duplicate DAT files in a given directory,
 * ensuring strict 1 Platform = 1 Canonical DAT compliance.
 */
export function pruneAndDeduplicateDats(targetDatsDir: string = datsDir): {
  removedCount: number;
  renamedCount: number;
} {
  let removedCount = 0;
  let renamedCount = 0;

  const targetNoIntroDir = path.join(targetDatsDir, 'No-Intro');
  if (fs.existsSync(targetNoIntroDir)) {
    // Remove unwanted subdirectories if any (e.g. Non-Redump, Source Code, Unofficial)
    const subItems = fs.readdirSync(targetNoIntroDir);
    for (const item of subItems) {
      const fullPath = path.join(targetNoIntroDir, item);
      if (fs.statSync(fullPath).isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true });
        removedCount++;
      }
    }

    const files = fs
      .readdirSync(targetNoIntroDir)
      .filter((f) => f.endsWith('.dat') || f.endsWith('.xml'));

    // Check for untracked files
    for (const file of files) {
      const match = NO_INTRO_TARGETS.find((t) => t.pattern.test(file));
      if (!match) {
        try {
          fs.unlinkSync(path.join(targetNoIntroDir, file));
          removedCount++;
        } catch {
          // Ignore unlink error
        }
      }
    }

    // Deduplicate tracked files
    for (const target of NO_INTRO_TARGETS) {
      const canonicalName = target.canonicalFileName || target.remoteFileName;
      const matchingFiles = fs
        .readdirSync(targetNoIntroDir)
        .filter((f) => target.pattern.test(f));

      if (matchingFiles.length === 0) continue;

      if (matchingFiles.length === 1 && matchingFiles[0] === canonicalName) {
        continue;
      }

      // Pick best file to keep: prefer official XML, then larger size, then canonicalName
      let bestFile = matchingFiles[0];
      let bestScore = -1;

      for (const file of matchingFiles) {
        let score = 0;
        const filePath = path.join(targetNoIntroDir, file);
        try {
          const content = fs.readFileSync(filePath, 'utf8').substring(0, 500);
          if (content.includes('<datafile>')) score += 100;
          if (
            content.includes('datomatic.no-intro.org') ||
            content.includes('schema_nointro_datfile')
          ) {
            score += 50;
          }
        } catch {
          // Ignore read error
        }
        if (file === canonicalName) score += 10;
        score += Math.min(fs.statSync(filePath).size / 1024, 20);

        if (score > bestScore) {
          bestScore = score;
          bestFile = file;
        }
      }

      for (const file of matchingFiles) {
        if (file !== bestFile) {
          try {
            fs.unlinkSync(path.join(targetNoIntroDir, file));
            removedCount++;
          } catch {
            // Ignore unlink error
          }
        }
      }

      if (bestFile !== canonicalName) {
        const srcPath = path.join(targetNoIntroDir, bestFile);
        const destPath = path.join(targetNoIntroDir, canonicalName);
        try {
          fs.renameSync(srcPath, destPath);
          renamedCount++;
        } catch {
          // Ignore rename error
        }
      }
    }
  }

  // Remove unwanted directories in root targetDatsDir
  if (fs.existsSync(targetDatsDir)) {
    const rootItems = fs.readdirSync(targetDatsDir);
    const unwantedDirs = ['Non-Redump', 'Source Code', 'Unofficial'];
    for (const item of rootItems) {
      const fullPath = path.join(targetDatsDir, item);
      if (fs.statSync(fullPath).isDirectory() && unwantedDirs.includes(item)) {
        fs.rmSync(fullPath, { recursive: true, force: true });
        removedCount++;
      }
    }
  }

  return { removedCount, renamedCount };
}

/**
 * Synchronizes the clean canonical DAT files to an external directory (e.g. C:\Users\wesdi\Downloads\dats).
 */
export function syncCleanDatsToDirectory(
  sourceDir: string,
  destDir: string,
): { copied: number; deleted: number } {
  if (!fs.existsSync(destDir)) return { copied: 0, deleted: 0 };
  let copied = 0;
  let deleted = 0;

  // Sync root Redump DAT files
  const sourceRootFiles = fs
    .readdirSync(sourceDir)
    .filter(
      (f) => f.endsWith('.dat') || f.endsWith('.xml') || f === 'index.txt',
    );
  const destRootFiles = fs
    .readdirSync(destDir)
    .filter(
      (f) => f.endsWith('.dat') || f.endsWith('.xml') || f === 'index.txt',
    );

  for (const file of sourceRootFiles) {
    const src = path.join(sourceDir, file);
    const dst = path.join(destDir, file);
    if (
      !fs.existsSync(dst) ||
      fs.statSync(src).size !== fs.statSync(dst).size
    ) {
      fs.copyFileSync(src, dst);
      copied++;
    }
  }
  for (const file of destRootFiles) {
    if (!sourceRootFiles.includes(file)) {
      try {
        fs.unlinkSync(path.join(destDir, file));
        deleted++;
      } catch {
        // Ignore unlink error
      }
    }
  }

  // Sync No-Intro
  const sourceNoIntro = path.join(sourceDir, 'No-Intro');
  const destNoIntro = path.join(destDir, 'No-Intro');
  if (fs.existsSync(sourceNoIntro)) {
    if (!fs.existsSync(destNoIntro)) {
      fs.mkdirSync(destNoIntro, { recursive: true });
    }
    const srcNoIntroFiles = fs
      .readdirSync(sourceNoIntro)
      .filter((f) => f.endsWith('.dat') || f.endsWith('.xml'));
    const dstNoIntroFiles = fs
      .readdirSync(destNoIntro)
      .filter((f) => f.endsWith('.dat') || f.endsWith('.xml'));

    for (const file of srcNoIntroFiles) {
      const src = path.join(sourceNoIntro, file);
      const dst = path.join(destNoIntro, file);
      if (
        !fs.existsSync(dst) ||
        fs.statSync(src).size !== fs.statSync(dst).size
      ) {
        fs.copyFileSync(src, dst);
        copied++;
      }
    }
    for (const file of dstNoIntroFiles) {
      if (!srcNoIntroFiles.includes(file)) {
        try {
          fs.unlinkSync(path.join(destNoIntro, file));
          deleted++;
        } catch {
          // Ignore unlink error
        }
      }
    }
  }

  // Prune any unwanted directories in destDir
  for (const unwanted of ['Non-Redump', 'Source Code', 'Unofficial']) {
    const unwantedPath = path.join(destDir, unwanted);
    if (fs.existsSync(unwantedPath)) {
      try {
        fs.rmSync(unwantedPath, { recursive: true, force: true });
        deleted++;
      } catch {
        // Ignore rmdir error
      }
    }
  }

  return { copied, deleted };
}

/**
 * Main execution routine.
 */
export async function runDatDownloads() {
  console.log(
    '===============================================================',
  );
  console.log('🌐 CANONICAL DAT DOWNLOADER (Redump & No-Intro)');
  console.log(
    '===============================================================',
  );

  if (!fs.existsSync(datsDir)) {
    fs.mkdirSync(datsDir, { recursive: true });
  }
  if (!fs.existsSync(noIntroDir)) {
    fs.mkdirSync(noIntroDir, { recursive: true });
  }
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Pre-download prune: ensure clean baseline without duplicate DAT variants
  pruneAndDeduplicateDats(datsDir);

  const localImported = importLocalDatomaticArchives();
  if (localImported > 0) {
    console.log(
      `📥 Imported ${localImported} DAT files from local Datomatic archives.`,
    );
  }

  let successCount = 0;
  let totalBytes = 0;
  const errors: Array<{ platform: string; source: string; error: string }> = [];

  console.log(
    `\n📦 [1/2] Fetching Redump Optical Disc DATs (${REDUMP_TARGETS.length} targets)...`,
  );
  for (const target of REDUMP_TARGETS) {
    process.stdout.write(`  - ${target.name.padEnd(35)} `);
    const result = await downloadRedumpDat(target);
    if (result.success && result.fileName && result.sizeBytes) {
      successCount++;
      totalBytes += result.sizeBytes;
      console.log(
        `✅ OK (${(result.sizeBytes / 1024).toFixed(0)} KB) -> ${result.fileName}`,
      );
    } else {
      console.log(`⚠️ FAILED: ${result.error}`);
      errors.push({
        platform: target.name,
        source: 'Redump',
        error: result.error || 'Unknown',
      });
    }
  }

  console.log(
    `\n🕹️ [2/2] Fetching No-Intro Cartridge DATs (${NO_INTRO_TARGETS.length} targets)...`,
  );
  for (const target of NO_INTRO_TARGETS) {
    process.stdout.write(`  - ${target.name.padEnd(35)} `);
    const result = await downloadNoIntroDat(target);
    if (result.success && result.fileName && result.sizeBytes) {
      successCount++;
      totalBytes += result.sizeBytes;
      console.log(
        `✅ OK (${(result.sizeBytes / 1024).toFixed(0)} KB) -> ${result.fileName}`,
      );
    } else {
      console.log(`⚠️ FAILED: ${result.error}`);
      errors.push({
        platform: target.name,
        source: 'No-Intro',
        error: result.error || 'Unknown',
      });
    }
  }

  // Post-download prune: ensure strict 1 Platform = 1 Canonical DAT compliance
  const pruneResult = pruneAndDeduplicateDats(datsDir);
  if (pruneResult.removedCount > 0 || pruneResult.renamedCount > 0) {
    console.log(
      `🧹 Pruned ${pruneResult.removedCount} obsolete/duplicate DATs, normalized ${pruneResult.renamedCount} filenames.`,
    );
  }

  // Synchronize to external downloads directory if present
  const externalDatsDir =
    process.env['EXTERNAL_DATS_DIR'] ||
    (process.env['USERPROFILE']
      ? path.join(process.env['USERPROFILE'], 'Downloads', 'dats')
      : path.join('C:', 'Users', 'wesdi', 'Downloads', 'dats'));
  if (fs.existsSync(externalDatsDir)) {
    const syncRes = syncCleanDatsToDirectory(datsDir, externalDatsDir);
    if (syncRes.copied > 0 || syncRes.deleted > 0) {
      console.log(
        `🔄 Synchronized to external DAT directory (${externalDatsDir}): ${syncRes.copied} updated, ${syncRes.deleted} cleaned.`,
      );
    }
  }

  const totalTargets = REDUMP_TARGETS.length + NO_INTRO_TARGETS.length;
  console.log(
    '\n===============================================================',
  );
  console.log('🎉 CANONICAL DAT DOWNLOAD COMPLETE');
  console.log(
    '===============================================================',
  );
  console.log(
    `- Successfully updated: ${successCount} / ${totalTargets} platform DATs`,
  );
  console.log(
    `- Total DAT content size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`,
  );
  if (errors.length > 0) {
    console.log(
      `- Warnings / Failures: ${errors.length} (Existing local DAT files retained)`,
    );
  }
  console.log(
    '\n👉 Next step: Run `npm run dats:sync` to parse & compile SQL seed for Cloudflare D1.\n',
  );
}

// Execute directly if run as a CLI script
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runDatDownloads().catch((err) => {
    console.error('[DatDownloader] Fatal execution error:', err);
    process.exit(1);
  });
}
