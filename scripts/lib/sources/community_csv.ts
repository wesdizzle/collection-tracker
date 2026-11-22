/**
 * COMMUNITY DROP-IN CSV SOURCE ADAPTER
 *
 * Reads optional user-supplied CSV files placed in `data/sources/community/*.csv`
 * (for example TrueAchievements physical lists, r/XboxCollectors sheets, or personal
 * curator exports) and normalizes them into `CanonicalRelease` rows with
 * `source = 'community_csv'`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CanonicalRelease } from '../../../shared/canonical_releases.js';
import {
  normalizeSpreadsheetRegion,
  parseCsvRows,
} from '../../../shared/switch_revisions.js';
import { normalizeTitleForMatching } from '../../../shared/title_matching.js';

export interface CommunityPlatformEntry {
  id: number;
  name: string;
  display_name?: string | null;
}

const PLATFORM_ALIAS_MAP: Record<string, number> = {
  '3do': 1,
  'atari 2600': 2,
  'atari 5200': 3,
  'atari 7800': 4,
  'atari lynx': 5,
  'atari jaguar': 6,
  colecovision: 7,
  intellivision: 8,
  'neo geo aes': 9,
  'neo geo cd': 10,
  'neo geo pocket color': 11,
  'neo geo x': 12,
  nes: 13,
  famicom: 53,
  gb: 14,
  'game boy': 14,
  snes: 15,
  'super famicom': 15,
  'virtual boy': 16,
  n64: 17,
  'nintendo 64': 17,
  gbc: 18,
  'game boy color': 18,
  gba: 19,
  'game boy advance': 19,
  gc: 20,
  gamecube: 20,
  'nintendo gamecube': 20,
  ds: 21,
  nds: 21,
  'nintendo ds': 21,
  wii: 22,
  '3ds': 23,
  'nintendo 3ds': 23,
  'wii u': 24,
  wiiu: 24,
  'new 3ds': 25,
  'new nintendo 3ds': 25,
  switch: 26,
  'nintendo switch': 26,
  nsw: 26,
  'switch 2': 27,
  'nintendo switch 2': 27,
  nsw2: 27,
  'cd-i': 28,
  ps1: 29,
  psx: 29,
  playstation: 29,
  ps2: 30,
  'playstation 2': 30,
  psp: 31,
  'playstation portable': 31,
  ps3: 32,
  'playstation 3': 32,
  vita: 33,
  'ps vita': 33,
  'playstation vita': 33,
  ps4: 34,
  'playstation 4': 34,
  ps5: 35,
  'playstation 5': 35,
  'master system': 36,
  'sega master system': 36,
  genesis: 37,
  'mega drive': 37,
  'sega genesis': 37,
  'game gear': 38,
  'sega cd': 39,
  'mega cd': 39,
  'sega 32x': 41,
  '32x': 41,
  saturn: 42,
  'sega saturn': 42,
  dreamcast: 43,
  turbografx: 45,
  'turbografx-16': 45,
  'pc engine': 45,
  'turbografx cd': 46,
  xbox: 47,
  'xbox 360': 48,
  x360: 48,
  'xbox one': 49,
  xb1: 49,
  'xbox series x': 50,
  'xbox series x|s': 50,
  'xbox series x/s': 50,
  'xbox series s|x': 50,
  xsx: 50,
  psvr: 51,
  'playstation vr': 51,
  psvr2: 52,
  'playstation vr2': 52,
  fds: 54,
  'famicom disk system': 54,
  '64dd': 55,
  'nintendo 64dd': 55,
};

function resolveCommunityPlatformId(
  rawPlatform: string,
  platforms: CommunityPlatformEntry[],
): number | null {
  const trimmed = (rawPlatform || '').trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    return num > 0 ? num : null;
  }

  const lower = trimmed.toLowerCase();
  if (PLATFORM_ALIAS_MAP[lower] !== undefined) {
    return PLATFORM_ALIAS_MAP[lower];
  }

  for (const p of platforms) {
    if (
      p.name.toLowerCase() === lower ||
      (p.display_name && p.display_name.toLowerCase() === lower)
    ) {
      return p.id;
    }
  }

  return null;
}

export function parseCommunityCsv(
  csv: string,
  platforms: CommunityPlatformEntry[] = [],
  defaultPlatformName = '',
): CanonicalRelease[] {
  if (!csv || !csv.trim()) return [];
  const rows = parseCsvRows(csv);
  if (rows.length < 2) return [];

  const headerLower = rows[0].map((c) => c.trim().toLowerCase());
  const titleCol = headerLower.findIndex((h) =>
    ['title', 'game', 'name', 'game title'].includes(h),
  );
  const platformCol = headerLower.findIndex((h) =>
    ['platform', 'system', 'console', 'platform_id'].includes(h),
  );
  if (titleCol < 0) return [];

  const regionCol = headerLower.findIndex(
    (h) => h === 'region' || h === 'regions',
  );
  const barcodeCol = headerLower.findIndex((h) =>
    ['barcode', 'upc', 'ean'].includes(h),
  );
  const serialCol = headerLower.findIndex((h) =>
    ['serial', 'serial_code', 'title id', 'title_id', 'sku'].includes(h),
  );
  const pubCol = headerLower.findIndex((h) =>
    ['publisher', 'physical publisher'].includes(h),
  );
  const variantsCol = headerLower.findIndex((h) =>
    ['variants', 'variant', 'edition'].includes(h),
  );

  const results: CanonicalRelease[] = [];
  const seenKeys = new Set<string>();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const rawTitle = (row[titleCol] || '').replace(/\s+/g, ' ').trim();
    const normTitle = normalizeTitleForMatching(rawTitle);
    if (!rawTitle || !normTitle) continue;

    const rawPlat =
      platformCol >= 0 ? (row[platformCol] || '').trim() : defaultPlatformName;
    const platformId = resolveCommunityPlatformId(rawPlat, platforms);
    if (!platformId) continue;

    const rawRegion = regionCol >= 0 ? (row[regionCol] || '').trim() : '';
    const region =
      normalizeSpreadsheetRegion(rawRegion) || rawRegion || 'World';
    const barcode =
      barcodeCol >= 0 ? (row[barcodeCol] || '').trim() || null : null;
    const serialCode =
      serialCol >= 0 ? (row[serialCol] || '').trim() || null : null;
    const publisher = pubCol >= 0 ? (row[pubCol] || '').trim() || null : null;
    const variants =
      variantsCol >= 0 ? (row[variantsCol] || '').trim() || null : null;

    const dedupKey = `${platformId}::${normTitle}::${region}::${variants || ''}::${serialCode || ''}`;
    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);

    results.push({
      platform_id: platformId,
      raw_title: rawTitle,
      normalized_title: normTitle,
      region,
      variants,
      rom_name: null,
      rom_crc: null,
      serial_code: serialCode,
      barcode,
      publisher,
      source: 'community_csv',
      is_verified_physical: 1,
    });
  }

  return results;
}

export function loadCommunityCsvReleases(
  sourcesDir: string,
  platforms: CommunityPlatformEntry[] = [],
): CanonicalRelease[] {
  const dir = path.join(sourcesDir, 'community');
  if (!fs.existsSync(dir)) return [];

  const all: CanonicalRelease[] = [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.csv'))
    .sort();

  for (const file of files) {
    const csv = fs.readFileSync(path.join(dir, file), 'utf8');
    const inferredPlatform = path.basename(file, path.extname(file));
    all.push(...parseCommunityCsv(csv, platforms, inferredPlatform));
  }
  return all;
}
