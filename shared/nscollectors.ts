/**
 * R/NSCOLLECTORS COMMUNITY PHYSICAL RELEASE PARSER
 *
 * Parses CSV exports from the community-maintained r/NSCollectors Switch 1 & Switch 2
 * physical release Google Sheets:
 * - SW1 Master Sheet (`nscollectors`, is_verified_physical = 1)
 * - SW1 Upcoming Releases (`nscollectors_upcoming`, is_verified_physical = 1)
 * - SW1 Code in a Box (`nscollectors_ciab`, is_verified_physical = 0)
 * - SW2 Physical Details (`nscollectors`, is_verified_physical = 1, Game-Key Card tagged)
 * - SW2 Upcoming Releases (`nscollectors_upcoming`, is_verified_physical = 1)
 */

import { CanonicalRelease } from './canonical_releases.js';
import {
  normalizeSpreadsheetRegion,
  parseCsvRows,
} from './switch_revisions.js';
import { normalizeTitleForMatching } from './title_matching.js';

export type NsCollectorsSourceType =
  | 'nscollectors'
  | 'nscollectors_upcoming'
  | 'nscollectors_ciab';

export interface NsCollectorsTabConfig {
  id:
    | 'sw1_master'
    | 'sw1_upcoming'
    | 'sw1_ciab'
    | 'sw2_details'
    | 'sw2_upcoming';
  name: string;
  spreadsheetId: string;
  gid: string;
  platformId: 26 | 27;
  source: NsCollectorsSourceType;
  isVerifiedPhysical: 0 | 1;
}

export interface NsCollectorsParsedEntry {
  release: CanonicalRelease;
  releaseDate: string | null;
}

export const SW1_SHEET_ID = '1FNyvbbU64Pb9lheg28gC_5fMalIYJ0aD763T7M1QqF0';
export const SW2_SHEET_ID = '1LEIJUOanvkKq9kv1fSOnD40GdE1Jt5LzSYsg8yAPmb8';

export const NSCOLLECTORS_TABS: NsCollectorsTabConfig[] = [
  {
    id: 'sw1_master',
    name: 'SW1 Master Physical List',
    spreadsheetId: SW1_SHEET_ID,
    gid: '2004832329',
    platformId: 26,
    source: 'nscollectors',
    isVerifiedPhysical: 1,
  },
  {
    id: 'sw1_upcoming',
    name: 'SW1 Upcoming Physical Releases',
    spreadsheetId: SW1_SHEET_ID,
    gid: '238551450',
    platformId: 26,
    source: 'nscollectors_upcoming',
    isVerifiedPhysical: 1,
  },
  {
    id: 'sw1_ciab',
    name: 'SW1 Code in a Box',
    spreadsheetId: SW1_SHEET_ID,
    gid: '1406641930',
    platformId: 26,
    source: 'nscollectors_ciab',
    isVerifiedPhysical: 0,
  },
  {
    id: 'sw2_details',
    name: 'SW2 Physical Release Details',
    spreadsheetId: SW2_SHEET_ID,
    gid: '764784245',
    platformId: 27,
    source: 'nscollectors',
    isVerifiedPhysical: 1,
  },
  {
    id: 'sw2_upcoming',
    name: 'SW2 Upcoming Physical Releases',
    spreadsheetId: SW2_SHEET_ID,
    gid: '238551450',
    platformId: 27,
    source: 'nscollectors_upcoming',
    isVerifiedPhysical: 1,
  },
];

export function getNsCollectorsCsvUrl(
  spreadsheetId: string,
  gid: string,
): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
}

const MONTH_NAME_MAP: Record<string, string> = {
  jan: '01',
  january: '01',
  feb: '02',
  february: '02',
  mar: '03',
  march: '03',
  apr: '04',
  april: '04',
  may: '05',
  jun: '06',
  june: '06',
  jul: '07',
  july: '07',
  aug: '08',
  august: '08',
  sep: '09',
  sept: '09',
  september: '09',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  dec: '12',
  december: '12',
};

/**
 * Parses common Google Sheets release dates into YYYY-MM-DD.
 * Returns null for TBA, Q1-Q4, year-only placeholders, or Dec 31 placeholders.
 */
export function normalizeNsCollectorsDate(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (
    !trimmed ||
    /^(tba|tbd|n\/a|unknown|coming\s+soon|q[1-4]\s+\d{4}|\d{4})$/i.test(trimmed)
  ) {
    return null;
  }

  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);
    if (
      year >= 2017 &&
      year <= 2035 &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      if (month === 12 && day === 31) return null;
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return null;
  }

  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const month = parseInt(slashMatch[1], 10);
    const day = parseInt(slashMatch[2], 10);
    let year = parseInt(slashMatch[3], 10);
    if (year < 100) year += 2000;
    if (
      year >= 2017 &&
      year <= 2035 &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      if (month === 12 && day === 31) return null;
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return null;
  }

  const namedMatch = trimmed.match(
    /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})$/i,
  );
  if (namedMatch) {
    const month = MONTH_NAME_MAP[namedMatch[1].toLowerCase()];
    const day = parseInt(namedMatch[2], 10);
    const year = parseInt(namedMatch[3], 10);
    if (month && day >= 1 && day <= 31 && year >= 2017 && year <= 2035) {
      if (month === '12' && day === 31) return null;
      return `${year}-${month}-${String(day).padStart(2, '0')}`;
    }
  }

  return null;
}

interface NsCollectorsColIndices {
  headerRowIdx: number;
  titleCol: number;
  regionCol: number;
  dateCol: number;
  publisherCol: number;
  formatCol: number;
}

function locateColumns(rows: string[][]): NsCollectorsColIndices | null {
  const maxHeaderScan = Math.min(rows.length, 6);
  for (let r = 0; r < maxHeaderScan; r++) {
    const cells = rows[r].map((c) => c.trim().toLowerCase());
    const titleCol = cells.findIndex((c) =>
      /^(?:game\s*)?(?:title|name)$|^game$/.test(c),
    );
    if (titleCol === -1) continue;

    const regionCol = cells.findIndex((c) => /\bregion\b/.test(c));
    const dateCol = cells.findIndex((c) =>
      /\b(?:release\s*)?date\b|\breleased\b|\bwindow\b/.test(c),
    );
    const publisherCol = cells.findIndex((c) => /\bpublisher\b/.test(c));
    const formatCol = cells.findIndex((c) =>
      /\b(cart(?:ridge)?\s*(?:type|format|size)?|game[\s-]?key|format|type|edition|distribution|notes)\b/.test(
        c,
      ),
    );

    return {
      headerRowIdx: r,
      titleCol,
      regionCol,
      dateCol,
      publisherCol,
      formatCol,
    };
  }
  return null;
}

function cleanNsCollectorsTitle(rawTitle: string): string {
  return rawTitle
    .replace(/\s*\*+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeNsCollectorsRegionToken(rawRegion: string): string[] {
  if (!rawRegion) return ['World'];
  const mapped = normalizeSpreadsheetRegion(rawRegion);
  if (mapped) {
    const tokens = mapped
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (tokens.length > 0) return tokens;
  }

  const fallback = rawRegion.trim().toUpperCase();
  if (fallback === 'NA' || fallback === 'US') return ['USA'];
  if (fallback === 'EU' || fallback === 'PAL' || fallback === 'UK') {
    return ['Europe'];
  }
  if (fallback === 'JP' || fallback === 'JPN') return ['Japan'];
  if (fallback === 'AS' || fallback === 'ASIA ENGLISH' || fallback === 'MSE') {
    return ['Asia'];
  }
  if (fallback === 'AU' || fallback === 'AUS') return ['Australia'];
  return ['World'];
}

/**
 * Parses CSV payloads from r/NSCollectors Switch 1 & 2 spreadsheets into
 * deduplicated canonical release records + optional parsed release dates.
 */
export function parseNsCollectorsCsv(
  tabs: Array<{ tab: NsCollectorsTabConfig; csv: string }>,
): NsCollectorsParsedEntry[] {
  const entriesByKey = new Map<string, NsCollectorsParsedEntry>();

  for (const { tab, csv } of tabs) {
    if (!csv || !csv.trim()) continue;
    const rows = parseCsvRows(csv);
    const cols = locateColumns(rows);
    if (!cols) continue;

    for (let r = cols.headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      const rawTitle = cleanNsCollectorsTitle(row[cols.titleCol] || '');
      if (!rawTitle) continue;
      if (/^(total|count|legend|key|last updated)/i.test(rawTitle)) continue;

      const normTitle = normalizeTitleForMatching(rawTitle);
      if (!normTitle) continue;

      const rawRegion =
        cols.regionCol >= 0 ? (row[cols.regionCol] || '').trim() : '';
      const regions = normalizeNsCollectorsRegionToken(rawRegion);

      const rawDate = cols.dateCol >= 0 ? (row[cols.dateCol] || '').trim() : '';
      const releaseDate = normalizeNsCollectorsDate(rawDate);

      const publisher =
        cols.publisherCol >= 0
          ? (row[cols.publisherCol] || '').trim() || null
          : null;

      const rawFormat =
        cols.formatCol >= 0 ? (row[cols.formatCol] || '').trim() : '';
      let variants: string | null = null;
      if (tab.source === 'nscollectors_ciab') {
        variants = 'Code in a Box (Download Only)';
      } else if (
        tab.platformId === 27 &&
        /\b(game[\s-]?key\s*card|key\s*card|gkc)\b/i.test(
          `${rawFormat} ${row.join(' ')}`,
        )
      ) {
        variants = 'Game-Key Card';
      }

      for (const region of regions) {
        const dedupKey = `${tab.platformId}::${normTitle}::${region}::${tab.source}::${variants || ''}`;
        const existing = entriesByKey.get(dedupKey);
        if (!existing) {
          entriesByKey.set(dedupKey, {
            release: {
              platform_id: tab.platformId,
              raw_title: rawTitle,
              normalized_title: normTitle,
              region,
              variants,
              rom_name: null,
              rom_crc: null,
              serial_code: null,
              publisher,
              source: tab.source,
              is_verified_physical: tab.isVerifiedPhysical,
            },
            releaseDate,
          });
        } else if (!existing.releaseDate && releaseDate) {
          existing.releaseDate = releaseDate;
        }
      }
    }
  }

  return Array.from(entriesByKey.values());
}
