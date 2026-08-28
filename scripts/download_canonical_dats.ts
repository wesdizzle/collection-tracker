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
    pattern: /Atari - 2600/i,
  },
  {
    name: 'Atari 5200',
    remoteFileName: 'Atari - 5200.dat',
    pattern: /Atari - 5200/i,
  },
  {
    name: 'Atari 7800',
    remoteFileName: 'Atari - 7800.dat',
    pattern: /Atari - 7800/i,
  },
  {
    name: 'Atari Lynx',
    remoteFileName: 'Atari - Lynx.dat',
    pattern: /Atari - Lynx/i,
  },
  {
    name: 'Atari Jaguar',
    remoteFileName: 'Atari - Jaguar.dat',
    pattern: /Atari - Jaguar/i,
  },
  {
    name: 'ColecoVision',
    remoteFileName: 'Coleco - ColecoVision.dat',
    pattern: /Coleco - ColecoVision/i,
  },
  {
    name: 'Intellivision',
    remoteFileName: 'Mattel - Intellivision.dat',
    pattern: /Mattel - Intellivision/i,
  },
  {
    name: 'Neo Geo Pocket',
    remoteFileName: 'SNK - Neo Geo Pocket.dat',
    pattern: /Neo Geo Pocket/i,
  },
  {
    name: 'Neo Geo Pocket Color',
    remoteFileName: 'SNK - Neo Geo Pocket Color.dat',
    pattern: /Neo Geo Pocket Color/i,
  },
  {
    name: 'Nintendo Entertainment System',
    remoteFileName: 'Nintendo - Nintendo Entertainment System.dat',
    pattern: /Nintendo Entertainment System/i,
  },
  {
    name: 'Super Nintendo Entertainment System',
    remoteFileName: 'Nintendo - Super Nintendo Entertainment System.dat',
    pattern: /Super Nintendo Entertainment System/i,
  },
  {
    name: 'Nintendo 64',
    remoteFileName: 'Nintendo - Nintendo 64.dat',
    pattern: /Nintendo 64/i,
  },
  {
    name: 'Game Boy',
    remoteFileName: 'Nintendo - Game Boy.dat',
    pattern: /Nintendo - Game Boy\./i,
  },
  {
    name: 'Game Boy Color',
    remoteFileName: 'Nintendo - Game Boy Color.dat',
    pattern: /Nintendo - Game Boy Color/i,
  },
  {
    name: 'Game Boy Advance',
    remoteFileName: 'Nintendo - Game Boy Advance.dat',
    pattern: /Nintendo - Game Boy Advance/i,
  },
  {
    name: 'Nintendo DS',
    remoteFileName: 'Nintendo - Nintendo DS.dat',
    pattern: /Nintendo - Nintendo DS\./i,
  },
  {
    name: 'Nintendo 3DS',
    remoteFileName: 'Nintendo - Nintendo 3DS.dat',
    pattern: /Nintendo - Nintendo 3DS\./i,
  },
  {
    name: 'New Nintendo 3DS',
    remoteFileName: 'Nintendo - New Nintendo 3DS.dat',
    pattern: /Nintendo - New Nintendo 3DS\./i,
  },
  {
    name: 'Virtual Boy',
    remoteFileName: 'Nintendo - Virtual Boy.dat',
    pattern: /Nintendo - Virtual Boy/i,
  },
  {
    name: 'Pokemon Mini',
    remoteFileName: 'Nintendo - Pokemon Mini.dat',
    pattern: /Pokemon Mini/i,
  },
  {
    name: 'Sega Master System',
    remoteFileName: 'Sega - Master System - Mark III.dat',
    pattern: /Master System/i,
  },
  {
    name: 'Sega Genesis / Mega Drive',
    remoteFileName: 'Sega - Mega Drive - Genesis.dat',
    pattern: /Mega Drive - Genesis/i,
  },
  {
    name: 'Sega Game Gear',
    remoteFileName: 'Sega - Game Gear.dat',
    pattern: /Game Gear/i,
  },
  { name: 'Sega Pico', remoteFileName: 'Sega - PICO.dat', pattern: /PICO/i },
  { name: 'Sega 32X', remoteFileName: 'Sega - 32X.dat', pattern: /32X/i },
  {
    name: 'TurboGrafx-16 / PC Engine',
    remoteFileName: 'NEC - PC Engine - TurboGrafx 16.dat',
    pattern: /TurboGrafx-16|TurboGrafx 16/i,
  },
  {
    name: 'Tiger Game.com',
    remoteFileName: 'Tiger - Game.com.dat',
    pattern: /Game\.com/i,
  },
  {
    name: 'WonderSwan',
    remoteFileName: 'Bandai - WonderSwan.dat',
    pattern: /WonderSwan\./i,
  },
  {
    name: 'WonderSwan Color',
    remoteFileName: 'Bandai - WonderSwan Color.dat',
    pattern: /WonderSwan Color/i,
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
 * Downloads a No-Intro DAT file from canonical mirror.
 */
export async function downloadNoIntroDat(
  target: NoIntroPlatformTarget,
  destinationDir: string = noIntroDir,
): Promise<{
  success: boolean;
  fileName?: string;
  sizeBytes?: number;
  error?: string;
}> {
  const baseUrl =
    'https://raw.githubusercontent.com/libretro/libretro-database/master/metadat/no-intro/';
  const url = `${baseUrl}${encodeURIComponent(target.remoteFileName)}`;
  const finalDestination = path.join(destinationDir, target.remoteFileName);

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
        if (file !== target.remoteFileName && target.pattern.test(file)) {
          try {
            fs.unlinkSync(path.join(destinationDir, file));
          } catch {
            // Ignore removal errors
          }
        }
      }
    }

    fs.writeFileSync(finalDestination, text, 'utf8');
    const size = fs.statSync(finalDestination).size;

    return { success: true, fileName: target.remoteFileName, sizeBytes: size };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
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
