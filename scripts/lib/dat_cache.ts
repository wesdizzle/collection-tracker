import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { parseDatFile, DatRelease } from './dat_parser.js';
import {
  PlatformRecord,
  isPlatformMatch,
  extractRegions,
  extractVariants,
  isIgnoredFormatRelease,
  isRegionOrLanguageOrDisc,
} from '../../shared/source_format.js';

export type { PlatformRecord };
export {
  isPlatformMatch,
  extractRegions,
  extractVariants,
  isIgnoredFormatRelease,
  isRegionOrLanguageOrDisc,
};

export interface DatCacheOptions {
  datsDir?: string;
  cacheDir?: string;
}

function getAllDatFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  let results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(getAllDatFiles(fullPath));
    } else if (entry.name.endsWith('.dat') || entry.name.endsWith('.xml')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Ensures that all available DAT files in `/dats` have been parsed and cached into `scripts/temp/dat_cache_<platformId>.json`.
 */
export function ensureAllDatCaches(
  db: Database.Database,
  forceRefresh = false,
  options: DatCacheOptions = {},
): void {
  const tempDir =
    options.cacheDir || path.join(process.cwd(), 'scripts', 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const datsDir = options.datsDir || path.join(process.cwd(), 'dats');
  const files = getAllDatFiles(datsDir);
  if (files.length === 0) return;

  const platforms = db
    .prepare('SELECT id, name, display_name FROM platforms')
    .all() as PlatformRecord[];

  if (!forceRefresh) {
    const existingCaches = fs
      .readdirSync(tempDir)
      .filter((f) => f.startsWith('dat_cache_') && f.endsWith('.json'));
    if (existingCaches.length > 0) {
      let newestDatMtime = 0;
      for (const file of files) {
        const stat = fs.statSync(file);
        if (stat.mtimeMs > newestDatMtime) newestDatMtime = stat.mtimeMs;
      }

      let oldestCacheMtime = Infinity;
      for (const cacheFile of existingCaches) {
        const stat = fs.statSync(path.join(tempDir, cacheFile));
        if (stat.mtimeMs < oldestCacheMtime) oldestCacheMtime = stat.mtimeMs;
      }

      if (oldestCacheMtime >= newestDatMtime) {
        return;
      }
    }
  }

  console.log('Building JSON caches from DAT files in /dats...');
  const platformReleases = new Map<number, DatRelease[]>();

  for (const file of files) {
    const parsed = parseDatFile(file);
    if (!parsed) continue;

    const matchedPlatform = platforms.find((p) =>
      isPlatformMatch(parsed.platformName, p),
    );
    if (!matchedPlatform) continue;

    if (!platformReleases.has(matchedPlatform.id)) {
      platformReleases.set(matchedPlatform.id, []);
    }

    const list = platformReleases.get(matchedPlatform.id)!;
    for (const rel of parsed.releases) {
      if (
        isIgnoredFormatRelease(rel.name, rel.romName || '', matchedPlatform.id)
      ) {
        continue;
      }
      rel.region = extractRegions(rel.name);
      rel.variants = extractVariants(rel.name);
      list.push(rel);
    }
  }

  for (const [platId, releases] of platformReleases.entries()) {
    const cachePath = path.join(tempDir, `dat_cache_${platId}.json`);
    fs.writeFileSync(cachePath, JSON.stringify(releases, null, 2), 'utf8');
  }
}

/**
 * Loads the cached DAT releases for a specific platform ID.
 */
export function getPlatformDatReleases(
  db: Database.Database,
  platformId: number,
  forceRefresh = false,
  options: DatCacheOptions = {},
): DatRelease[] {
  ensureAllDatCaches(db, forceRefresh, options);
  const tempDir =
    options.cacheDir || path.join(process.cwd(), 'scripts', 'temp');
  const cachePath = path.join(tempDir, `dat_cache_${platformId}.json`);
  if (!fs.existsSync(cachePath)) {
    return [];
  }
  const raw = fs.readFileSync(cachePath, 'utf8');
  return JSON.parse(raw) as DatRelease[];
}
