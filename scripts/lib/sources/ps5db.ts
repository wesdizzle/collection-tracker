/**
 * COMMUNITY PS5 PHYSICAL DATABASE (PS5DB) SOURCE ADAPTER
 *
 * Fetches and parses the community-maintained PlayStation 5 physical release
 * Google Sheet (`platform_id = 35`, `source = 'ps5db'`).
 */

import * as fs from 'fs';
import * as path from 'path';
import { CanonicalRelease } from '../../../shared/canonical_releases.js';
import { parseCsvRows } from '../../../shared/switch_revisions.js';
import { normalizeTitleForMatching } from '../../../shared/title_matching.js';

export const PS5DB_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1LNoL9HTVyLutj9T_bWNM54qkyrPGV1tSkiTBJAus-cE/export?format=csv';

const NON_VALUE_REGEX = /^(?:-|n\/a|none|no|false|unknown|tbd|\?)$/i;

function isPresentCell(value: string | undefined): boolean {
  const trimmed = (value || '').trim();
  return Boolean(trimmed) && !NON_VALUE_REGEX.test(trimmed);
}

/**
 * Parses PS5DB CSV content into deduplicated PlayStation 5 CanonicalRelease rows.
 */
export function parsePs5DbCsv(csv: string): CanonicalRelease[] {
  if (!csv || !csv.trim()) return [];
  const rows = parseCsvRows(csv);
  if (rows.length < 2) return [];

  let headerIdx = -1;
  let titleCol = -1;
  let gamePubCol = -1;
  let physPubCol = -1;
  let limitedCol = -1;
  let esrbCol = -1;
  let pegiCol = -1;

  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const lower = rows[i].map((c) => c.trim().toLowerCase());
    const tCol = lower.findIndex((c) => c === 'title' || c === 'game');
    if (tCol >= 0) {
      headerIdx = i;
      titleCol = tCol;
      physPubCol = lower.findIndex((c) => c === 'physical publisher');
      gamePubCol = lower.findIndex(
        (c) => c === 'game publisher' || c === 'publisher',
      );
      limitedCol = lower.findIndex(
        (c) => c === 'limited' || c === 'limited print',
      );
      esrbCol = lower.findIndex((c) => c.includes('esrb'));
      pegiCol = lower.findIndex((c) => c.includes('pegi'));
      break;
    }
  }

  if (headerIdx < 0 || titleCol < 0) return [];

  const results: CanonicalRelease[] = [];
  const seenKeys = new Set<string>();

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const rawTitle = (row[titleCol] || '').replace(/\s+/g, ' ').trim();
    if (!rawTitle || /^(total|count|legend|last updated)/i.test(rawTitle)) {
      continue;
    }

    const normTitle = normalizeTitleForMatching(rawTitle);
    if (!normTitle) continue;

    const esrbVal = esrbCol >= 0 ? (row[esrbCol] || '').trim() : '';
    const pegiVal = pegiCol >= 0 ? (row[pegiCol] || '').trim() : '';
    const hasEsrb = isPresentCell(esrbVal);
    const hasPegi = isPresentCell(pegiVal);
    const region =
      hasEsrb && hasPegi
        ? 'USA, Europe'
        : hasEsrb
          ? 'USA'
          : hasPegi
            ? 'Europe'
            : 'World';

    const limitedRaw = limitedCol >= 0 ? (row[limitedCol] || '').trim() : '';
    const variants =
      isPresentCell(limitedRaw) && !/^standard$/i.test(limitedRaw)
        ? 'Limited Print'
        : null;

    const dedupKey = `${normTitle}::${region}::${variants || ''}`;
    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);

    const physPub = physPubCol >= 0 ? (row[physPubCol] || '').trim() : '';
    const gamePub = gamePubCol >= 0 ? (row[gamePubCol] || '').trim() : '';
    const publisher = (isPresentCell(physPub) ? physPub : gamePub) || null;

    const skuMatch = esrbVal.match(/\b([A-Z]{4}[- ]?\d{5})\b/i);
    const serialCode = skuMatch
      ? skuMatch[1].replace(/\s+/g, '').toUpperCase()
      : null;
    const barcodeMatch = esrbVal.match(/\b(\d{12,13})\b/);
    const barcode = barcodeMatch ? barcodeMatch[1] : null;

    results.push({
      platform_id: 35,
      raw_title: rawTitle,
      normalized_title: normTitle,
      region,
      variants,
      rom_name: null,
      rom_crc: null,
      serial_code: serialCode,
      barcode,
      publisher,
      source: 'ps5db',
      is_verified_physical: 1,
    });
  }

  return results;
}

export async function fetchPs5DbSource(
  sourcesDir: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ savedPath: string; bytes: number; count: number }> {
  fs.mkdirSync(sourcesDir, { recursive: true });
  const res = await fetchFn(PS5DB_CSV_URL, {
    headers: {
      'User-Agent': 'CollectionTracker/2.0 (Ps5DbSourceFetch)',
      Accept: 'text/csv,text/plain,*/*',
    },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch PS5DB CSV (${res.status} ${res.statusText})`,
    );
  }
  const csv = await res.text();
  if (!csv.includes('Title')) {
    throw new Error('Invalid PS5DB CSV response: missing Title header');
  }
  const savedPath = path.join(sourcesDir, 'ps5db.csv');
  fs.writeFileSync(savedPath, csv, 'utf8');
  return {
    savedPath,
    bytes: Buffer.byteLength(csv, 'utf8'),
    count: parsePs5DbCsv(csv).length,
  };
}

export function loadPs5DbReleases(sourcesDir: string): CanonicalRelease[] {
  const filePath = path.join(sourcesDir, 'ps5db.csv');
  if (!fs.existsSync(filePath)) return [];
  return parsePs5DbCsv(fs.readFileSync(filePath, 'utf8'));
}
