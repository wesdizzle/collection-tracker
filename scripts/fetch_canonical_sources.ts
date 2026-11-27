/**
 * CANONICAL SOURCES FETCHER UTILITY
 *
 * Fetches official and community-maintained offline physical verification sources:
 * 1. Redump & No-Intro XML DAT files into `dats/`
 * 2. MAME Neo Geo AES (`hash/neogeo.xml`) into `data/sources/`
 * 3. r/NSCollectors Switch 1 & 2 CSV tabs into `data/sources/nscollectors/`
 * 4. Community PS5 Physical Database (PS5DB) CSV into `data/sources/ps5db.csv`
 * 5. SerialStation OpenAPI v1 PlayStation discs into `data/sources/serialstation_*.json`
 * 6. Retail & boutique back-catalogs + LGN announcements into `data/sources/retail_backcatalog.json`
 *
 * USAGE:
 *   npx tsx scripts/fetch_canonical_sources.ts [--source=dats,neogeo,nscollectors,ps5db,serialstation,retail]
 *   npm run sources:fetch
 *   npm run sources:update (Fetches latest sources and immediately runs synchronization)
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'node:os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { fetchNeoGeoSources } from './lib/sources/neogeo.js';
import { fetchNsCollectorsSources } from './lib/sources/nscollectors_sync.js';
import { fetchPs5DbSource } from './lib/sources/ps5db.js';
import { fetchSerialStationSources } from './lib/sources/serialstation.js';
import { fetchRetailBackCatalogSources } from './lib/sources/retail_backcatalog.js';

import {
  getRedumpInfoDatUrl,
  NO_INTRO_TARGETS,
  REDUMP_TARGETS,
  REDUMP_WIP_TARGETS,
  type NoIntroPlatformTarget,
  type RedumpPlatformTarget,
} from '../shared/dat_targets.js';
import { extractFirstMatchingZipEntry, isZipBuffer } from '../shared/zip.js';

export {
  NO_INTRO_TARGETS,
  REDUMP_TARGETS,
  REDUMP_WIP_TARGETS,
  type NoIntroPlatformTarget,
  type RedumpPlatformTarget,
};

export interface RedumpWipPlatformTarget extends RedumpPlatformTarget {
  canonicalFileName: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const datsDir = path.join(rootDir, 'dats');
const noIntroDir = path.join(datsDir, 'No-Intro');
const tempDir = path.join(rootDir, 'scripts', 'temp');

/**
 * Downloads a Redump DAT zip archive from redump.info and extracts it into destinationDir.
 */
export async function downloadRedumpDat(
  target: RedumpPlatformTarget | RedumpWipPlatformTarget,
  destinationDir: string = datsDir,
): Promise<{
  success: boolean;
  fileName?: string;
  sizeBytes?: number;
  error?: string;
}> {
  const url = getRedumpInfoDatUrl(target.slug);

  const findExistingDat = () => {
    if (fs.existsSync(destinationDir)) {
      const existingFiles = fs.readdirSync(destinationDir);
      const existing = existingFiles.find((f) => target.pattern.test(f));
      if (existing) {
        const size = fs.statSync(path.join(destinationDir, existing)).size;
        return { success: true, fileName: existing, sizeBytes: size };
      }
    }
    return null;
  };

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'CollectionTracker/2.0 (DAT Synchronizer)',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const existing = findExistingDat();
      if (existing) return existing;

      return {
        success: false,
        error: `HTTP ${response.status} ${response.statusText}`,
      };
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 30 || !isZipBuffer(bytes)) {
      const existing = findExistingDat();
      if (existing) return existing;

      return {
        success: false,
        error: 'Downloaded response is not a valid Redump ZIP archive.',
      };
    }

    const entry = await extractFirstMatchingZipEntry(
      bytes,
      (name) => name.endsWith('.dat') || name.endsWith('.xml'),
    );
    const datFile = path.basename(entry.fileName);
    fs.mkdirSync(destinationDir, { recursive: true });
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

    fs.writeFileSync(finalDestination, entry.data);
    const size = fs.statSync(finalDestination).size;

    return { success: true, fileName: datFile, sizeBytes: size };
  } catch (err: unknown) {
    const existing = findExistingDat();
    if (existing) return existing;

    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
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
          fs.writeFileSync(dest, raw, 'utf8');
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

  if (target.name === 'PlayStation Vita') {
    const rawBaseName = target.remoteFileName.replace(/\.(?:xml|dat)$/i, '');
    const spludlowUrl = `https://data.spludlow.co.uk/no-intro/unofficial/${encodeURIComponent(rawBaseName)}.xml`;

    let xmlContent = '';

    // 1. Check if a local manual XML exists in datsDir
    const localXmlPath = path.join(datsDir, `${rawBaseName}.xml`);
    if (fs.existsSync(localXmlPath)) {
      try {
        xmlContent = fs.readFileSync(localXmlPath, 'utf8');
        fs.unlinkSync(localXmlPath);
      } catch {
        // ignore read error
      }
    }

    // 2. Fetch from Spludlow official No-Intro mirror if no local file was found
    if (!xmlContent) {
      try {
        const response = await fetch(spludlowUrl, {
          headers: {
            'User-Agent': 'CollectionTracker/2.0 (DAT Synchronizer)',
          },
        });
        if (response.ok) {
          xmlContent = await response.text();
        }
      } catch (fetchErr) {
        if (fs.existsSync(finalDestination)) {
          const size = fs.statSync(finalDestination).size;
          return { success: true, fileName: canonicalName, sizeBytes: size };
        }
        return {
          success: false,
          error: `Could not fetch from Spludlow mirror: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
        };
      }
    }

    if (!xmlContent || !xmlContent.includes('<datafile')) {
      if (fs.existsSync(finalDestination)) {
        const size = fs.statSync(finalDestination).size;
        return { success: true, fileName: canonicalName, sizeBytes: size };
      }
      return {
        success: false,
        error: `Failed to retrieve valid No-Intro XML for ${target.name}.`,
      };
    }

    // Remove any older conflicting files matching target.pattern in destinationDir
    if (fs.existsSync(destinationDir)) {
      const existingFiles = fs.readdirSync(destinationDir);
      for (const file of existingFiles) {
        if (file !== canonicalName && target.pattern.test(file)) {
          try {
            fs.unlinkSync(path.join(destinationDir, file));
          } catch {
            // ignore removal error
          }
        }
      }
    }

    fs.writeFileSync(finalDestination, xmlContent, 'utf8');
    const size = fs.statSync(finalDestination).size;
    return { success: true, fileName: canonicalName, sizeBytes: size };
  }

  if (target.manualOnly) {
    if (fs.existsSync(destinationDir)) {
      const existingFiles = fs.readdirSync(destinationDir);
      const existingFile = existingFiles.find((f) => target.pattern.test(f));
      if (existingFile) {
        const existingPath = path.join(destinationDir, existingFile);
        try {
          const head = fs
            .readFileSync(existingPath, { encoding: 'utf8', flag: 'r' })
            .substring(0, 500);
          if (
            head.includes('<datafile>') ||
            head.includes('clrmamepro') ||
            head.includes('game (')
          ) {
            if (existingFile !== canonicalName) {
              fs.renameSync(existingPath, finalDestination);
            }
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
          // Fall through to manual error
        }
      }
    }
    return {
      success: false,
      error: 'Manual DAT download required: place DAT in dats/No-Intro/',
    };
  }

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

  try {
    // 1. Try official Datomatic XML from Spludlow mirror
    const rawBaseName = (
      target.canonicalFileName || target.remoteFileName
    ).replace(/\.(?:xml|dat)$/i, '');
    const spludlowUrl = `https://data.spludlow.co.uk/no-intro/no-intro/${encodeURIComponent(rawBaseName)}.xml`;
    let text = '';

    try {
      const spludlowRes = await fetch(spludlowUrl, {
        headers: { 'User-Agent': 'CollectionTracker/2.0 (DAT Synchronizer)' },
        signal: AbortSignal.timeout(10000),
      });
      if (spludlowRes.ok) {
        const candidateText = await spludlowRes.text();
        if (
          candidateText.includes('<datafile>') ||
          candidateText.includes('<header>')
        ) {
          text = candidateText;
        }
      }
    } catch {
      // Fall through to libretro fallback
    }

    // 2. Fallback to libretro-database mirror if Spludlow is unreachable or missing
    if (!text) {
      const baseUrl =
        'https://raw.githubusercontent.com/libretro/libretro-database/master/metadat/no-intro/';
      const url = `${baseUrl}${encodeURIComponent(target.remoteFileName)}`;

      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'CollectionTracker/2.0 (DAT Synchronizer)',
          },
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
          return {
            success: false,
            error: `HTTP ${response.status} ${response.statusText}`,
          };
        }

        text = await response.text();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: msg };
      }
    }
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

    fs.writeFileSync(finalDestination, text, 'utf8');
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
  if (fs.existsSync(targetDatsDir) && fs.existsSync(targetNoIntroDir)) {
    // If any No-Intro DAT files were placed in root targetDatsDir, migrate them into targetNoIntroDir
    const rootFiles = fs
      .readdirSync(targetDatsDir)
      .filter((f) => f.endsWith('.dat') || f.endsWith('.xml'));
    for (const file of rootFiles) {
      const isNoIntro = NO_INTRO_TARGETS.some((t) => t.pattern.test(file));
      const isRedump =
        REDUMP_TARGETS.some((t) => t.pattern.test(file)) ||
        REDUMP_WIP_TARGETS.some((t) => t.pattern.test(file));
      if (isNoIntro && !isRedump) {
        const srcPath = path.join(targetDatsDir, file);
        const destPath = path.join(targetNoIntroDir, file);
        try {
          fs.renameSync(srcPath, destPath);
          renamedCount++;
        } catch {
          // Ignore rename error
        }
      }
    }
  }

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
    // Clean up legacy Switch DAT files since Switch physical releases are cataloged via Nintendo Revised spreadsheet
    const allNoIntroFiles = fs.readdirSync(targetNoIntroDir);
    for (const file of allNoIntroFiles) {
      if (/Nintendo\s*-\s*Nintendo\s*Switch/i.test(file)) {
        try {
          fs.unlinkSync(path.join(targetNoIntroDir, file));
          removedCount++;
        } catch {
          // Ignore unlink error
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
 * Synchronizes the clean canonical DAT files to an external directory (e.g. ~/Downloads/dats).
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
    .filter((f) => f.endsWith('.dat') || f.endsWith('.xml'));
  const destRootFiles = fs
    .readdirSync(destDir)
    .filter((f) => f.endsWith('.dat') || f.endsWith('.xml'));

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
    `\n📦 [1/3] Fetching Redump Optical Disc DATs (${REDUMP_TARGETS.length} targets)...`,
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
    `\n💿 [2/3] Fetching Modern & WIP Optical Disc DATs (${REDUMP_WIP_TARGETS.length} targets)...`,
  );
  for (const target of REDUMP_WIP_TARGETS) {
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
        source: 'Redump WIP',
        error: result.error || 'Unknown',
      });
    }
  }

  console.log(
    `\n🕹️ [3/3] Fetching No-Intro Cartridge & Digital DATs (${NO_INTRO_TARGETS.length} targets)...`,
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
      : path.join(os.homedir(), 'Downloads', 'dats'));
  if (fs.existsSync(externalDatsDir)) {
    const syncRes = syncCleanDatsToDirectory(datsDir, externalDatsDir);
    if (syncRes.copied > 0 || syncRes.deleted > 0) {
      console.log(
        `🔄 Synchronized to external DAT directory (${externalDatsDir}): ${syncRes.copied} updated, ${syncRes.deleted} cleaned.`,
      );
    }
  }

  const totalTargets =
    REDUMP_TARGETS.length + REDUMP_WIP_TARGETS.length + NO_INTRO_TARGETS.length;
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
    '\n👉 Next step: Run `npm run sources:sync` to parse & compile SQL seed for Cloudflare D1.\n',
  );
}

export const downloadAllCanonicalDats = runDatDownloads;

export type CanonicalSourceFilter =
  | 'dats'
  | 'neogeo'
  | 'nscollectors'
  | 'ps5db'
  | 'serialstation'
  | 'retail'
  | 'all';

const VALID_FETCH_SOURCES = new Set<CanonicalSourceFilter>([
  'dats',
  'neogeo',
  'nscollectors',
  'ps5db',
  'serialstation',
  'retail',
  'all',
]);

export function parseSourceFilterArg(raw?: string): CanonicalSourceFilter[] {
  if (!raw || !raw.trim()) return ['all'];
  const tokens = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0 || tokens.includes('all')) return ['all'];
  const resolved: CanonicalSourceFilter[] = [];
  for (const token of tokens) {
    if (!VALID_FETCH_SOURCES.has(token as CanonicalSourceFilter)) {
      throw new Error(
        `Unknown source "${token}". Valid values: dats, neogeo, nscollectors, ps5db, serialstation, retail, all`,
      );
    }
    if (!resolved.includes(token as CanonicalSourceFilter)) {
      resolved.push(token as CanonicalSourceFilter);
    }
  }
  return resolved;
}

export interface FetchCanonicalSourcesOptions {
  sources?: CanonicalSourceFilter[];
  sourcesDir?: string;
  maxPages?: number;
  fetchFn?: typeof fetch;
}

export async function fetchCanonicalSources(
  options: FetchCanonicalSourcesOptions = {},
): Promise<{
  fetchedSources: string[];
  sourcesDir: string;
}> {
  const sourcesDir =
    options.sourcesDir || path.join(rootDir, 'data', 'sources');
  fs.mkdirSync(sourcesDir, { recursive: true });
  const selected = new Set<CanonicalSourceFilter>(
    options.sources && options.sources.length > 0 ? options.sources : ['all'],
  );
  const runAll = selected.has('all');
  const fetchFn = options.fetchFn ?? fetch;
  const fetchedSources: string[] = [];

  if (runAll || selected.has('dats')) {
    await runDatDownloads();
    fetchedSources.push('dats');
  }

  if (runAll || selected.has('neogeo')) {
    const res = await fetchNeoGeoSources(sourcesDir, fetchFn);
    console.log(
      `🕹️ [Neo Geo] Saved MAME neogeo.xml (${(res.bytes / 1024).toFixed(0)} KB, ${res.aesCount} AES titles)`,
    );
    fetchedSources.push('neogeo');
  }

  if (runAll || selected.has('nscollectors')) {
    const res = await fetchNsCollectorsSources(sourcesDir, fetchFn);
    console.log(
      `📋 [r/NSCollectors] Saved ${res.tabsFetched} CSV tabs (${res.totalEntries} Switch physical records)`,
    );
    fetchedSources.push('nscollectors');
  }

  if (runAll || selected.has('ps5db')) {
    const res = await fetchPs5DbSource(sourcesDir, fetchFn);
    console.log(
      `💿 [PS5DB] Saved ps5db.csv (${(res.bytes / 1024).toFixed(0)} KB, ${res.count} PS5 titles)`,
    );
    fetchedSources.push('ps5db');
  }

  if (runAll || selected.has('serialstation')) {
    const res = await fetchSerialStationSources(sourcesDir, {
      maxPages: options.maxPages,
      fetchFn,
    });
    console.log(
      `🎫 [SerialStation] Saved ${res.releasesCount} physical releases & ${res.tmdbCount} TMDB masters (${res.parsedCount} normalized)`,
    );
    fetchedSources.push('serialstation');
  }

  if (runAll || selected.has('retail')) {
    const res = await fetchRetailBackCatalogSources(sourcesDir, {
      maxPages: options.maxPages,
      fetchFn,
    });
    console.log(
      `🛍️ [Retail/LGN] Saved retail_backcatalog.json (${res.totalParsed} catalog & announcement entries)`,
    );
    fetchedSources.push('retail');
  }

  return { fetchedSources, sourcesDir };
}

// Execute directly if run as a CLI script
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Canonical Offline Sources Fetcher

Usage:
  npx tsx scripts/fetch_canonical_sources.ts [options]

Options:
  --source=<list>       Comma-separated sources: dats,neogeo,nscollectors,ps5db,serialstation,retail,all (default: all)
  --sources-dir=<path>  Directory for fetched non-DAT artifacts (default: data/sources)
  --max-pages=<N>       Optional pagination cap for SerialStation & retail catalogs
  --help, -h            Show this help message
`);
    process.exit(0);
  }
  const sourceArg = args.find((a) => a.startsWith('--source='))?.split('=')[1];
  const sourcesDirArg = args
    .find((a) => a.startsWith('--sources-dir='))
    ?.split('=')[1];
  const maxPagesArg = args
    .find((a) => a.startsWith('--max-pages='))
    ?.split('=')[1];
  const maxPages = maxPagesArg ? parseInt(maxPagesArg, 10) : undefined;

  fetchCanonicalSources({
    sources: parseSourceFilterArg(sourceArg),
    sourcesDir: sourcesDirArg ? path.resolve(sourcesDirArg) : undefined,
    maxPages: maxPages && Number.isFinite(maxPages) ? maxPages : undefined,
  }).catch((err) => {
    console.error('[SourceFetcher] Fatal execution error:', err);
    process.exit(1);
  });
}
