/**
 * BACKUP FILE SCANNER & RECONCILIATOR (TS)
 *
 * This script scans a user-specified backup directory recursively for
 * filenames matching the 'rom_name' field of games on their respective
 * platforms. Matches are updated in the SQLite database by setting
 * 'backup_status' to 1.
 *
 * SAFETY GUARANTEE:
 * - This script treats the backup folder as strictly READ-ONLY.
 * - It will never write, delete, rename, or modify any files or directories in the backup path.
 * - It will not perform hash calculations or decompress archives to avoid performance overhead.
 *
 * USAGE:
 * npm run scan-backups <path-to-backups>
 */

import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

interface PlatformRow {
  id: number;
  name: string;
  display_name: string | null;
  brand: string | null;
  launch_date: string | null;
  parent_platform_id: number | null;
}

interface ReleaseRow {
  id: string;
  game_id: number;
  title: string;
  rom_name: string;
  stable_id: number;
  region: string | null;
}

/**
 * Valid game file extensions to verify base-name matching.
 */
const GAME_EXTENSIONS = new Set([
  '.rvz',
  '.gcm',
  '.iso',
  '.wux',
  '.wud',
  '.chd',
  '.cso',
  '.pbp',
  '.bin',
  '.cue',
  '.md',
  '.gg',
  '.sms',
  '.a26',
  '.a52',
  '.a78',
  '.lnx',
  '.col',
  '.int',
  '.zip',
  '.7z',
  '.rar',
  '.gba',
  '.gbc',
  '.gb',
  '.nes',
  '.sfc',
  '.smc',
  '.nds',
  '.3ds',
  '.cci',
  '.cia',
  '.z64',
]);

/**
 * Standardizes platform names to facilitate mapping between folder names and database entries.
 *
 * @param name The platform name string.
 * @returns Cleaned alphanumeric lowercase platform string.
 */
function cleanPlatformName(name: string): string {
  return name
    .toLowerCase()
    .replace(
      /\b(nintendo|sony|sega|microsoft|philips|atari|tiger|snk|nec)\b/gi,
      '',
    )
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Resolves platform ID to an array of platform IDs that are scanned symmetrically.
 * Specifically, NES (13) and Famicom (53) are mapped together so cross-region
 * titles match correctly.
 *
 * @param platformId The database platform ID.
 * @returns Array of symmetrical platform IDs.
 */
function getScannedPlatformIds(platformId: number): number[] {
  if (platformId === 13 || platformId === 53) {
    return [13, 53];
  }
  return [platformId];
}

/**
 * Checks if a file is an ignored non-backup format or sidecar/save state.
 *
 * @param filename The filename to evaluate.
 * @returns True if the file should be ignored from scanning and unmatched alerts.
 */
function isIgnoredFile(filename: string): boolean {
  const lower = filename.toLowerCase();

  // Exact name matches
  if (lower === 'param.pbp' || lower === 'desktop.ini') {
    return true;
  }

  // Extension matches
  if (
    lower.endsWith('.sav') ||
    lower.endsWith('.srm') ||
    lower.endsWith('.edat') ||
    lower.endsWith('.xiso.iso')
  ) {
    return true;
  }

  // State files (e.g. .state, .state1, .state.auto)
  if (/\.state(\d+|\.auto)?$/i.test(lower)) {
    return true;
  }

  return false;
}

/**
 * Helper to split a filename into base title and extension.
 * Correctly handles double extensions like '.xiso.iso' by stripping both.
 * Also normalizes title format (like converting 'Title, The' to 'The Title').
 *
 * @param filename The base filename.
 * @returns Object containing the cleaned base name and the extension.
 */
function getGameFileParts(filename: string): { base: string; ext: string } {
  const lower = filename.toLowerCase();

  let ext: string;
  let base: string;
  if (lower.endsWith('.xiso.iso')) {
    ext = '.xiso.iso';
    base = filename.substring(0, filename.length - 9);
  } else {
    ext = path.parse(lower).ext;
    base = path.parse(filename).name;
  }

  // Clean parentheticals and brackets from the base title
  let baseTitle = base
    .replace(/\s*[([][^\])]*[)\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Handle ", The" suffix
  if (baseTitle.includes(', The')) {
    baseTitle = 'The ' + baseTitle.replace(', The', '');
  }

  return {
    base: baseTitle,
    ext: ext.toLowerCase(),
  };
}

/**
 * Splits a base title into individual segments based on delimiters (~, /, :, -).
 *
 * @param baseTitle The cleaned base title.
 * @returns Array of segment strings.
 */
function getTitleSegments(baseTitle: string): string[] {
  let normalized = baseTitle.replace(/\s+-\s+/g, '___SPLIT___');
  normalized = normalized.replace(/[~/:]/g, '___SPLIT___');
  return normalized
    .split('___SPLIT___')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Maps a subdirectory name to a database platform definition using name cleaning and fallbacks.
 *
 * @param subDirName Name of the directory.
 * @param dbPlatforms Array of platform records from the database.
 * @returns The matched platform database record, or null if no match is found.
 */
function findDbPlatform(
  subDirName: string,
  dbPlatforms: PlatformRow[],
): PlatformRow | null {
  const datClean = cleanPlatformName(subDirName);
  const lowerDat = subDirName.toLowerCase();

  // 1. Check explicit fallbacks first to catch specific cases.
  // Sort keys by length descending so that longer prefixes/substrings match first.
  const fallbacks: Record<string, string> = {
    'pc engine cd & turbografx cd': 'turbografx cd',
    'pc engine cd': 'turbografx cd',
    'turbografx cd': 'turbografx cd',
    'mega cd': 'sega cd',
    'sega cd': 'sega cd',
    'pc engine': 'turbografx-16',
    turbografx: 'turbografx-16',
    'super nintendo entertainment system':
      'super nintendo entertainment system',
    'nintendo entertainment system': 'nintendo entertainment system',
    megadrive: 'genesis',
    'mega drive': 'genesis',
    genesis: 'genesis',
    gameboy: 'game boy',
    'game boy color': 'game boy color',
    'game boy advance': 'game boy advance',
    'nintendo 64': 'nintendo 64',
    'nintendo ds': 'nintendo ds',
  };

  const sortedFallbackKeys = Object.keys(fallbacks).sort(
    (a, b) => b.length - a.length,
  );

  for (const key of sortedFallbackKeys) {
    const dbVal = fallbacks[key];
    if (lowerDat.includes(key)) {
      const matched = dbPlatforms.find((p) =>
        (p.display_name || p.name).toLowerCase().includes(dbVal),
      );
      if (matched) return matched;
    }
  }

  // 2. Try exact cleaned match
  for (const p of dbPlatforms) {
    const pClean = cleanPlatformName(p.display_name || p.name);
    if (pClean === datClean) {
      return p;
    }
  }

  // 3. Try substring match, but sort platforms by clean name length descending
  // so that longer names (like "xbox360", "xboxone") match before shorter names (like "xbox")
  const sortedPlatforms = [...dbPlatforms].sort((a, b) => {
    const cleanA = cleanPlatformName(a.display_name || a.name);
    const cleanB = cleanPlatformName(b.display_name || b.name);
    return cleanB.length - cleanA.length;
  });

  for (const p of sortedPlatforms) {
    const pClean = cleanPlatformName(p.display_name || p.name);
    // Ignore extremely short clean names (like "ds", "cd") for contains matching to avoid false matches
    if (pClean.length > 2) {
      if (datClean.includes(pClean) || pClean.includes(datClean)) {
        return p;
      }
    }
  }

  return null;
}

/**
 * Recursively scans a directory and retrieves all file paths.
 *
 * @param dir Path to the directory.
 * @returns An array of absolute file paths found.
 */
function getFilesRecursive(dir: string): string[] {
  let results: string[] = [];
  try {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat && stat.isDirectory()) {
        results = results.concat(getFilesRecursive(fullPath));
      } else {
        results.push(fullPath);
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${dir}:`, err);
  }
  return results;
}

/**
 * Normalizes a game title into a canonical alphabetic sorted token string.
 * Cleans common publisher names, prepositions, regional aliases (e.g. Earthbound Beginnings -> Mother),
 * transliterations (oo/uu -> o/u), and spelling discrepancies.
 *
 * @param title The game title.
 * @param useAliases True to apply regional title aliases, false to bypass them.
 * @returns Normalized token string.
 */
function normalizeTitleForMatching(
  title: string,
  useAliases: boolean = true,
): string {
  const ALIASES: Record<string, string> = Object.assign(Object.create(null), {
    'earthbound beginnings': 'mother',
  });

  let t = title.toLowerCase().trim();

  if (useAliases && ALIASES[t]) {
    t = ALIASES[t];
  }

  t = t.replace(/&/g, 'and');
  t = t.replace(/oo/g, 'o').replace(/uu/g, 'u');
  t = t.replace(/cch/g, 'tch');
  t = t.replace(/mega\s+man/g, 'megaman');
  t = t.replace(/pac\s+man/g, 'pacman');
  t = t.replace(/super\s+mario/g, 'supermario');

  t = t.replace(
    /\b(disney|sega|nintendo|sony|microsoft|capcom|konami|namco|square enix|square|enix|atari|ubisoft|ea|marvel|sid meiers?|tom clancys?|lego|nickelodeon)s?\b/gi,
    '',
  );
  t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  t = t.replace(/[^a-z0-9\s]/g, ' ');
  t = t.replace(
    /\b(the|a|an|and|in|of|for|with|on|at|to|by|or|from|version|edition)\b/gi,
    '',
  );

  const words = t
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .sort();
  return words.join('');
}

/**
 * Extracts regions from parenthetical markers in a filename.
 *
 * @param name The filename to parse.
 * @returns Mapped regions joined by a comma, or null if no regions are found.
 */
function extractRegions(name: string): string | null {
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
 * Normalizes region strings to handle common equivalent representations
 * (e.g. NA, USA, North America) when comparing game and release regions.
 *
 * @param region The region string to normalize.
 * @returns Array of normalized region parts.
 */
function normalizeRegion(region: string | null): string[] {
  if (!region) return [];
  return region
    .toLowerCase()
    .split(/[\s,]+/)
    .map((part) => {
      const p = part.trim();
      if (
        p === 'na' ||
        p === 'usa' ||
        p === 'us' ||
        p === 'northamerica' ||
        p === 'north america'
      ) {
        return 'usa';
      }
      if (p === 'jp' || p === 'jpn' || p === 'japan') {
        return 'japan';
      }
      if (p === 'eu' || p === 'eur' || p === 'europe') {
        return 'europe';
      }
      return p;
    })
    .filter(Boolean);
}

/**
 * Compares two region strings and determines if there is any overlap
 * after resolving regional equivalences and World compatibility.
 *
 * @param reg1 First region string.
 * @param reg2 Second region string.
 * @returns True if the regions match, false otherwise.
 */
function regionsMatch(reg1: string | null, reg2: string | null): boolean {
  if (!reg1 || !reg2) return false;
  const parts1 = normalizeRegion(reg1);
  const parts2 = normalizeRegion(reg2);
  if (parts1.includes('world') || parts2.includes('world')) {
    return true;
  }
  return parts1.some((p1) => parts2.includes(p1));
}

/**
 * Retrieves the base filename prior to the extension.
 * Correctly handles double extensions like '.xiso.iso' by stripping both.
 *
 * @param filename The full filename.
 * @returns The base filename string.
 */
function getBaseName(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xiso.iso')) {
    return filename.substring(0, filename.length - 9);
  }
  return path.parse(filename).name;
}

/**
 * Resolves the best physical release match for a given backup file.
 * Strict Mode: Only tolerates compressed extension differences. Base name must match exactly.
 *
 * @param filename The backup filename.
 * @param releases Array of physical database releases on the platform.
 * @returns The best matched release database record, or null.
 */
function findBestReleaseMatch(
  filename: string,
  releases: ReleaseRow[],
): ReleaseRow | null {
  const fileParts = getGameFileParts(filename);
  const fileBase = getBaseName(filename);
  const fileExt = fileParts.ext.toLowerCase();

  for (const r of releases) {
    const romParts = getGameFileParts(r.rom_name);
    const romBase = getBaseName(r.rom_name);
    const romExt = romParts.ext.toLowerCase();

    const baseMatches = fileBase === romBase;
    const extMatches =
      fileExt === romExt ||
      (GAME_EXTENSIONS.has(fileExt) && GAME_EXTENSIONS.has(romExt));

    if (baseMatches && extMatches) {
      return r;
    }
  }

  return null;
}

/**
 * Identifies a tolerant release match for alerting when base name mismatch occurs.
 *
 * @param filename The backup filename.
 * @param releases Array of physical database releases on the platform.
 * @returns The best tolerantly matched release database record, or null.
 */
function findTolerantReleaseMatch(
  filename: string,
  releases: ReleaseRow[],
): ReleaseRow | null {
  const fileParts = getGameFileParts(filename);
  const fileBase = getBaseName(filename).toLowerCase();
  const fileExt = fileParts.ext.toLowerCase();
  const fileRegion = extractRegions(filename);

  // 0. Case-insensitive exact base name match (flagging case differences)
  for (const r of releases) {
    const romBase = getBaseName(r.rom_name).toLowerCase();
    const romParts = getGameFileParts(r.rom_name);
    const romExt = romParts.ext.toLowerCase();
    if (
      fileBase === romBase &&
      GAME_EXTENSIONS.has(fileExt) &&
      GAME_EXTENSIONS.has(romExt)
    ) {
      return r;
    }
  }

  // 1. Cleaned base name match (without parentheticals) AND region match
  for (const r of releases) {
    const romParts = getGameFileParts(r.rom_name);
    const fileBaseClean = fileParts.base.toLowerCase();
    const romBaseClean = romParts.base.toLowerCase();
    const romExt = romParts.ext.toLowerCase();
    if (
      fileBaseClean === romBaseClean &&
      GAME_EXTENSIONS.has(fileExt) &&
      GAME_EXTENSIONS.has(romExt)
    ) {
      if (regionsMatch(fileRegion, r.region)) {
        return r;
      }
    }
  }

  // 2. Cleaned base name match (with alias/parenthetical stripping) AND region match
  for (const r of releases) {
    const romParts = getGameFileParts(r.rom_name);
    const fileBaseNorm = normalizeTitleForMatching(fileParts.base, true);
    const romBaseNorm = normalizeTitleForMatching(romParts.base, true);
    const romExt = romParts.ext.toLowerCase();
    if (
      fileBaseNorm === romBaseNorm &&
      GAME_EXTENSIONS.has(fileExt) &&
      GAME_EXTENSIONS.has(romExt)
    ) {
      if (regionsMatch(fileRegion, r.region)) {
        return r;
      }
    }
  }

  return null;
}

/**
 * Checks if a filename matches a Sonic & Knuckles lock-on combination warning exception.
 *
 * @param filename The backup file name.
 * @returns True if it's one of the lock-on combinations.
 */
function isSonicKnucklesException(filename: string): boolean {
  const nameLower = filename.toLowerCase();
  const exceptions = [
    'sonic & knuckles + sonic the hedgehog (usa, europe) (lock-on combination).md',
    'sonic & knuckles + sonic the hedgehog 2 (world) (rev a) (lock-on combination).md',
    'sonic & knuckles + sonic the hedgehog 3 (usa) (lock-on combination).md',
  ];
  return exceptions.includes(nameLower);
}

/**
 * Main execution method for the backup reconciliation process.
 *
 * @throws Error if database connection fails or input directory is invalid.
 */
function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Error: Please provide the path to your backup directory.');
    console.log('Usage: npx tsx scratch/scan_backups.ts <path-to-backups>');
    process.exit(1);
  }

  const backupDir = path.resolve(args[0]);
  if (!fs.existsSync(backupDir) || !fs.statSync(backupDir).isDirectory()) {
    console.error(`Error: The path "${backupDir}" is not a valid directory.`);
    process.exit(1);
  }

  console.log(`Starting backup scan on: ${backupDir}`);
  console.log(
    'Safety check: Backup folder is treated as strictly read-only.\n',
  );

  const db = new Database('collection.sqlite');

  console.log('Resetting existing backup status in database to 0...');
  db.prepare('UPDATE game_releases SET backup_status = 0').run();

  const dbPlatforms = db
    .prepare('SELECT * FROM platforms')
    .all() as PlatformRow[];

  // Read subdirectories in the backup directory
  const subDirs = fs.readdirSync(backupDir).filter((f) => {
    const fullPath = path.join(backupDir, f);
    return fs.statSync(fullPath).isDirectory();
  });

  if (subDirs.length === 0) {
    console.log('No platform subdirectories found in the backup directory.');
    return;
  }

  let totalScannedFiles = 0;
  let totalMatchedReleases = 0;
  const platformStats: Record<string, { scanned: number; matched: number }> =
    {};
  const baseNameMismatchAlerts: {
    file: string;
    game: string;
    rom: string;
    platform: string;
  }[] = [];

  for (const subDir of subDirs) {
    const dbPlatform = findDbPlatform(subDir, dbPlatforms);
    if (!dbPlatform) {
      console.warn(
        `[Platform Skip] Subdirectory "${subDir}" could not be mapped to any database platform.`,
      );
      continue;
    }

    const platformDisplayName = dbPlatform.display_name || dbPlatform.name;
    const subDirPath = path.join(backupDir, subDir);
    console.log(
      `Scanning [${platformDisplayName}] from subdirectory "${subDir}"...`,
    );

    const rawFiles = getFilesRecursive(subDirPath);

    // Filter ignored files and system directories
    const files = rawFiles.filter((f) => {
      const filename = path.basename(f);
      return !isIgnoredFile(filename);
    });

    if (!platformStats[platformDisplayName]) {
      platformStats[platformDisplayName] = { scanned: 0, matched: 0 };
    }
    platformStats[platformDisplayName].scanned += files.length;
    totalScannedFiles += files.length;

    if (files.length === 0) {
      console.log(
        `  No files found under "${subDir}" after filtering ignored files.`,
      );
      continue;
    }

    // Load game releases for this platform (NES/Famicom scanned symmetrically)
    const platformIds = getScannedPlatformIds(dbPlatform.id);
    const placeholders = platformIds.map(() => '?').join(',');

    const dbReleases = db
      .prepare(
        `
      SELECT r.id, r.game_id, g.title, r.rom_name, g.stable_id, r.region
      FROM game_releases r
      JOIN games g ON r.game_id = g.stable_id
      WHERE g.platform_id IN (${placeholders}) AND r.rom_name IS NOT NULL
    `,
      )
      .all(...platformIds) as {
      id: string;
      game_id: number;
      title: string;
      rom_name: string;
      stable_id: number;
      region: string | null;
    }[];

    // Load all games for this platform (for fallback title-matching verification)
    const platformGames = db
      .prepare(
        `
      SELECT stable_id, title 
      FROM games 
      WHERE platform_id IN (${placeholders})
    `,
      )
      .all(...platformIds) as { stable_id: number; title: string }[];

    // Build filename mapping to game records
    const matchesToUpdate: string[] = [];

    for (const file of files) {
      const filename = path.basename(file);
      if (isSonicKnucklesException(filename)) {
        console.log(
          `  [S&K Exception] Skipping unmatched alert for lock-on file: "${filename}"`,
        );
        continue;
      }

      const matched = findBestReleaseMatch(filename, dbReleases);
      if (matched) {
        console.log(
          `  [Match Found] "${filename}" -> "${matched.title}" (${matched.rom_name})`,
        );
        matchesToUpdate.push(matched.id);
        platformStats[platformDisplayName].matched++;
        totalMatchedReleases++;
      }
      const matchedRelease = !!matched;

      if (!matchedRelease) {
        const tolerantMatch = findTolerantReleaseMatch(filename, dbReleases);
        if (tolerantMatch) {
          console.warn(
            `  [ALERT: Base Name Mismatch] Backup file "${filename}" matches game "${tolerantMatch.title}" tolerantly but has differences prior to the extension. Target DB ROM name: "${tolerantMatch.rom_name}"`,
          );
          baseNameMismatchAlerts.push({
            file: filename,
            game: tolerantMatch.title,
            rom: tolerantMatch.rom_name,
            platform: platformDisplayName,
          });
        } else {
          // Fallback title matching: strip parentheticals & extension
          const fileParts = getGameFileParts(filename);
          const normFile = normalizeTitleForMatching(fileParts.base);
          const fileSegments = getTitleSegments(fileParts.base)
            .map((s) => normalizeTitleForMatching(s))
            .filter((s) => s.length >= 3);

          let matchedGameDirect = false;
          let matchedGameTitle = '';
          for (const game of platformGames) {
            const gameNorm = normalizeTitleForMatching(game.title);
            if (gameNorm === normFile || fileSegments.includes(gameNorm)) {
              matchedGameDirect = true;
              matchedGameTitle = game.title;
              break;
            }
          }

          if (matchedGameDirect) {
            console.warn(
              `  [Release Mismatch Warning] Backup file "${filename}" matched game "${matchedGameTitle}" but did not match any physical release in game_releases.`,
            );
          } else {
            console.error(
              `  [ALERT] Backup file "${filename}" on platform "${platformDisplayName}" does not correspond to any game in the database!`,
            );
          }
        }
      }
    }

    if (matchesToUpdate.length > 0) {
      const updateStmt = db.prepare(
        'UPDATE game_releases SET backup_status = 1 WHERE id = ?',
      );
      const transaction = db.transaction(() => {
        for (const releaseId of matchesToUpdate) {
          updateStmt.run(releaseId);
        }
      });
      transaction();
      console.log(
        `  Updated database: marked ${matchesToUpdate.length} release(s) as backed up.`,
      );
    } else {
      console.log('  No backup matches found.');
    }
  }

  // Display scan summary
  console.log('\n========================================');
  console.log('            SCAN SUMMARY');
  console.log('========================================');
  console.log(`Total files scanned: ${totalScannedFiles}`);
  console.log(`Total releases matched & updated: ${totalMatchedReleases}`);
  console.log('\nBreakdown by Platform:');
  for (const [platform, stats] of Object.entries(platformStats)) {
    console.log(`- ${platform}:`);
    console.log(`  Scanned: ${stats.scanned} files`);
    console.log(`  Matched: ${stats.matched} releases`);
  }
  console.log('========================================');

  // Write base name mismatch alerts report
  const alertsPath = path.join(
    process.cwd(),
    'scratch',
    'backup_base_name_mismatch_alerts.md',
  );
  console.log(`Writing base name mismatch alerts to: ${alertsPath}`);
  let alertMd = `# Backup Base Name Mismatch Alerts\n\n`;
  alertMd += `The following is a list of local backup files that match a database release tolerantly (by title or segments) but deviate in their base name prior to the extension. These backups were **not** marked as backed up in the database.\n\n`;
  alertMd += `To resolve these, rename the local backup file to match the database ROM name exactly (except for compressed extensions).\n\n`;
  alertMd += `| Platform | Backup Filename on Disk | Target Game Title | Target Database ROM Name |\n`;
  alertMd += `| --- | --- | --- | --- |\n`;

  for (const a of baseNameMismatchAlerts) {
    alertMd += `| ${a.platform} | ${a.file} | ${a.game} | ${a.rom} |\n`;
  }

  fs.writeFileSync(alertsPath, alertMd, 'utf-8');
  console.log(
    `Successfully generated ${baseNameMismatchAlerts.length} base name mismatch alert(s).`,
  );
}

main();
