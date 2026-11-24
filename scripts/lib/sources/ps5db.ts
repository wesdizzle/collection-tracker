/**
 * COMMUNITY PS5 PHYSICAL DATABASE (PS5DB) SOURCE ADAPTER
 *
 * Fetches the community-maintained PlayStation 5 physical release Google Sheet
 * into `data/sources/ps5db.csv` and re-exports shared parser helpers.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CanonicalRelease } from '../../../shared/canonical_releases.js';
import { PS5DB_CSV_URL, parsePs5DbCsv } from '../../../shared/ps5db.js';

export { PS5DB_CSV_URL, parsePs5DbCsv };

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
