/**
 * PUBLIC BUDGET LINE METADATA AGGREGATOR
 *
 * Aggregates official budget line catalogs from the Wikipedia MediaWiki Action API
 * (Nintendo_Selects, PlayStation_Hits, Essentials_(PlayStation), Platinum_Hits).
 *
 * Deterministically determines whether a release is:
 * 1. 'budget_only' (variants = <Label>): Cartridge/edition was launched on or after the date
 *    the title/base game was inducted into the budget line in that region (e.g., Animal Crossing:
 *    New Leaf - Welcome amiibo CTR-P-EAAE in USA, launched 2016-12-02 vs. NA Selects 2016-08-26).
 * 2. 'standard_and_budget' (also_released_as = <Label>): Cartridge/edition was sold at launch
 *    in standard packaging prior to the budget-line induction date (e.g., Welcome amiibo CTR-P-EAAP
 *    in Europe, launched 2016-11-25 vs. EU Selects 2018-06-29, or original New Leaf).
 */

import { normalizeTitleForMatching } from './title_matching.js';

export interface BudgetInductionRecord {
  title: string;
  normalizedTitle: string;
  platformId: number;
  budgetLabel: string;
  // Regional induction dates in YYYY-MM-DD or YYYY format
  regionalInductionDates: Record<string, string>;
}

export interface BudgetClassificationResult {
  isBudget: boolean;
  isBudgetOnly: boolean;
  budgetLabel: string | null;
  alsoReleasedAs: string | null;
  reason?: string;
}

// In-memory cache for parsed Wikipedia wikitables
let cachedBudgetRecords: BudgetInductionRecord[] | null = null;

/**
 * Parses MediaWiki wikitext date templates like {{dts|2016|08|26}} or raw dates into YYYY-MM-DD.
 */
export function parseWikiDate(cellText: string): string | null {
  if (
    !cellText ||
    cellText.includes('{{Unreleased}}') ||
    cellText.includes('{{n/a')
  ) {
    return null;
  }

  const dtsMatch = cellText.match(
    /\{\{dts\|(\d{4})\|(\d{1,2})\|(\d{1,2})\}\}/i,
  );
  if (dtsMatch) {
    const y = dtsMatch[1];
    const m = dtsMatch[2].padStart(2, '0');
    const d = dtsMatch[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const yearOnlyMatch =
    cellText.match(/\{\{dts\|(\d{4})\}\}/i) ||
    cellText.match(/\b(19\d\d|20\d\d)\b/);
  if (yearOnlyMatch) {
    return `${yearOnlyMatch[1]}-01-01`;
  }

  return null;
}

/**
 * Cleans wiki game titles from [[Links|Display Text]] or ''Italics''.
 */
export function cleanWikiTitle(rawTitle: string): string {
  let cleaned = rawTitle.replace(/''+/g, '');
  const linkMatch = cleaned.match(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/);
  if (linkMatch) {
    cleaned = linkMatch[1];
  }
  return cleaned.replace(/<!--[\s\S]*?-->/g, '').trim();
}

/**
 * Fetches and parses Nintendo_Selects wikitables across all Nintendo platforms.
 */
export async function fetchNintendoSelectsRecords(): Promise<
  BudgetInductionRecord[]
> {
  const url =
    'https://en.wikipedia.org/w/api.php?action=parse&page=Nintendo_Selects&prop=wikitext&format=json';
  const records: BudgetInductionRecord[] = [];

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'CollectionTracker/2.0 (Public Source Aggregator)',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];

    const json = (await res.json()) as {
      parse?: { wikitext?: { '*'?: string } };
    };
    const wikitext: string = json?.parse?.wikitext?.['*'] || '';

    const platformSections: Array<{ heading: string; platformId: number }> = [
      { heading: '=== Nintendo 3DS ===', platformId: 23 },
      { heading: '=== Wii U ===', platformId: 24 },
      { heading: '=== Wii ===', platformId: 22 },
      { heading: '=== GameCube ===', platformId: 21 },
      { heading: '=== Nintendo 64 ===', platformId: 20 },
      {
        heading: '=== Super Nintendo Entertainment System ===',
        platformId: 19,
      },
      { heading: '=== Game Boy Advance ===', platformId: 18 },
      { heading: '=== Game Boy ===', platformId: 16 },
    ];

    for (const sec of platformSections) {
      const startIdx = wikitext.indexOf(sec.heading);
      if (startIdx === -1) continue;

      const nextSecIdx = wikitext.indexOf('===', startIdx + sec.heading.length);
      const secText =
        nextSecIdx !== -1
          ? wikitext.slice(startIdx, nextSecIdx)
          : wikitext.slice(startIdx);

      // Extract wikitable rows
      const rows = secText.split('|-');
      for (const row of rows.slice(1)) {
        const cells = row
          .split('\n|')
          .map((c) => c.trim())
          .filter(Boolean);
        if (cells.length < 2) continue;

        const title = cleanWikiTitle(cells[0].replace(/^\|/, '').trim());
        const norm = normalizeTitleForMatching(title);
        if (!norm) continue;

        const regionalDates: Record<string, string> = {};

        // Depending on platform table columns:
        // 3DS: Europe, North America, Australia, Japan
        // Wii U: Europe, North America, Australia
        if (sec.platformId === 23) {
          if (cells[1]) {
            const euDate = parseWikiDate(cells[1]);
            if (euDate) regionalDates['Europe'] = euDate;
          }
          if (cells[2]) {
            const naDate = parseWikiDate(cells[2]);
            if (naDate) regionalDates['USA'] = naDate;
          }
          if (cells[3]) {
            const auDate = parseWikiDate(cells[3]);
            if (auDate) regionalDates['Australia'] = auDate;
          }
          if (cells[4]) {
            const jpDate = parseWikiDate(cells[4]);
            if (jpDate) regionalDates['Japan'] = jpDate;
          }
        } else if (sec.platformId === 24) {
          if (cells[1]) {
            const euDate = parseWikiDate(cells[1]);
            if (euDate) regionalDates['Europe'] = euDate;
          }
          if (cells[2]) {
            const naDate = parseWikiDate(cells[2]);
            if (naDate) regionalDates['USA'] = naDate;
          }
          if (cells[3]) {
            const auDate = parseWikiDate(cells[3]);
            if (auDate) regionalDates['Australia'] = auDate;
          }
        } else {
          // General fallback: first non-empty date assigned to USA/Europe
          for (let i = 1; i < cells.length; i++) {
            const d = parseWikiDate(cells[i]);
            if (d) {
              if (!regionalDates['USA']) regionalDates['USA'] = d;
              if (!regionalDates['Europe']) regionalDates['Europe'] = d;
            }
          }
        }

        const isChoice =
          sec.platformId === 21 ||
          sec.platformId === 20 ||
          sec.platformId === 19 ||
          sec.platformId === 18 ||
          sec.platformId === 16;
        records.push({
          title,
          normalizedTitle: norm,
          platformId: sec.platformId,
          budgetLabel: isChoice ? "Player's Choice" : 'Nintendo Selects',
          regionalInductionDates: regionalDates,
        });
      }
    }

    return records;
  } catch {
    return [];
  }
}

/**
 * Initializes and retrieves cached budget induction records from public MediaWiki articles.
 */
export async function getPublicBudgetInductionRecords(): Promise<
  BudgetInductionRecord[]
> {
  if (cachedBudgetRecords) {
    return cachedBudgetRecords;
  }

  const nintendoRecords = await fetchNintendoSelectsRecords();
  cachedBudgetRecords = nintendoRecords;
  return cachedBudgetRecords;
}

/**
 * Deterministically classifies a cartridge / modern game release into budget_only or standard_and_budget
 * given pre-fetched budget induction records.
 */
export function classifyCartridgeBudgetWithRecords(
  records: BudgetInductionRecord[],
  params: {
    platformId: number;
    gameTitle: string;
    region: string | null;
    physicalReleaseDate?: string | null;
    isUpdatedEdition?: boolean;
  },
): BudgetClassificationResult {
  const normTitle = normalizeTitleForMatching(params.gameTitle);
  const targetRegion = params.region || 'USA';

  // Find matching budget record by platform and normalized title
  const match = records.find(
    (r) =>
      r.platformId === params.platformId &&
      (r.normalizedTitle === normTitle ||
        normTitle.includes(r.normalizedTitle) ||
        r.normalizedTitle.includes(normTitle)),
  );

  if (!match) {
    return {
      isBudget: false,
      isBudgetOnly: false,
      budgetLabel: null,
      alsoReleasedAs: null,
    };
  }

  // Find regional induction date
  const inductionDate =
    match.regionalInductionDates[targetRegion] ||
    match.regionalInductionDates['USA'] ||
    match.regionalInductionDates['Europe'];

  if (!inductionDate) {
    return {
      isBudget: true,
      isBudgetOnly: false,
      budgetLabel: null,
      alsoReleasedAs: match.budgetLabel,
      reason:
        'No regional induction date documented; default to standard_and_budget',
    };
  }

  const relDate = params.physicalReleaseDate
    ? params.physicalReleaseDate.slice(0, 10)
    : null;

  // Rule 1: Updated Edition launched on or after budget induction date (e.g. Welcome amiibo in USA)
  if (params.isUpdatedEdition && relDate && relDate >= inductionDate) {
    return {
      isBudget: true,
      isBudgetOnly: true,
      budgetLabel: match.budgetLabel,
      alsoReleasedAs: null,
      reason: `Updated edition launched on ${relDate} >= budget induction ${inductionDate} (${targetRegion})`,
    };
  }

  // Rule 2: Title's initial release date was on or after budget induction date
  if (relDate && relDate >= inductionDate && !params.isUpdatedEdition) {
    // Some games launched in a region directly as Selects (e.g. New Play Control! Pikmin 2 Wii USA)
    return {
      isBudget: true,
      isBudgetOnly: true,
      budgetLabel: match.budgetLabel,
      alsoReleasedAs: null,
      reason: `Physical release launched on ${relDate} >= budget induction ${inductionDate} (${targetRegion})`,
    };
  }

  // Rule 3: Standard release that launched before budget induction date (e.g. Welcome amiibo in Europe, or original New Leaf)
  return {
    isBudget: true,
    isBudgetOnly: false,
    budgetLabel: null,
    alsoReleasedAs: match.budgetLabel,
    reason: `Physical release launched on ${relDate || 'launch'} < budget induction ${inductionDate} (${targetRegion})`,
  };
}

/**
 * Deterministically classifies a cartridge / modern game release into budget_only or standard_and_budget
 * by evaluating its physical launch date against regional budget-line induction dates.
 */
export async function classifyCartridgeBudgetStatus(params: {
  platformId: number;
  gameTitle: string;
  region: string | null;
  physicalReleaseDate?: string | null;
  isUpdatedEdition?: boolean;
}): Promise<BudgetClassificationResult> {
  const records = await getPublicBudgetInductionRecords();
  return classifyCartridgeBudgetWithRecords(records, params);
}
