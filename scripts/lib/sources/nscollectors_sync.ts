/**
 * R/NSCOLLECTORS OFFLINE SOURCE ADAPTER
 *
 * Fetches all 5 Switch 1 & Switch 2 CSV tabs from the community-maintained
 * r/NSCollectors physical release spreadsheets into `data/sources/nscollectors/`
 * and loads them into CanonicalRelease records via `shared/nscollectors.ts`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CanonicalRelease } from '../../../shared/canonical_releases.js';
import {
  getNsCollectorsCsvUrl,
  NSCOLLECTORS_TABS,
  NsCollectorsParsedEntry,
  NsCollectorsTabConfig,
  parseNsCollectorsCsv,
} from '../../../shared/nscollectors.js';

export async function fetchNsCollectorsSources(
  sourcesDir: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ tabsFetched: number; totalEntries: number; outDir: string }> {
  const outDir = path.join(sourcesDir, 'nscollectors');
  fs.mkdirSync(outDir, { recursive: true });

  const fetchedTabs: Array<{ tab: NsCollectorsTabConfig; csv: string }> = [];
  for (const tab of NSCOLLECTORS_TABS) {
    const url = getNsCollectorsCsvUrl(tab.spreadsheetId, tab.gid);
    const res = await fetchFn(url, {
      headers: {
        'User-Agent': 'CollectionTracker/2.0 (NsCollectorsSourceFetch)',
        Accept: 'text/csv,text/plain,*/*',
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      throw new Error(
        `Failed to fetch r/NSCollectors tab ${tab.id} (${res.status} ${res.statusText})`,
      );
    }
    const csv = await res.text();
    if (!csv.trim()) {
      throw new Error(`Empty CSV payload for r/NSCollectors tab ${tab.id}`);
    }
    fs.writeFileSync(path.join(outDir, `${tab.id}.csv`), csv, 'utf8');
    fetchedTabs.push({ tab, csv });
  }

  const parsed = parseNsCollectorsCsv(fetchedTabs);
  return {
    tabsFetched: fetchedTabs.length,
    totalEntries: parsed.length,
    outDir,
  };
}

export function loadNsCollectorsReleases(sourcesDir: string): {
  entries: NsCollectorsParsedEntry[];
  releases: CanonicalRelease[];
} {
  const dir = path.join(sourcesDir, 'nscollectors');
  if (!fs.existsSync(dir)) {
    return { entries: [], releases: [] };
  }

  const tabs: Array<{ tab: NsCollectorsTabConfig; csv: string }> = [];
  for (const tab of NSCOLLECTORS_TABS) {
    const filePath = path.join(dir, `${tab.id}.csv`);
    if (fs.existsSync(filePath)) {
      tabs.push({ tab, csv: fs.readFileSync(filePath, 'utf8') });
    }
  }

  const entries = parseNsCollectorsCsv(tabs);
  return {
    entries,
    releases: entries.map((e) => e.release),
  };
}
