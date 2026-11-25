/**
 * PUBLIC BUDGET LINE METADATA AGGREGATOR
 *
 * Aggregates official budget line catalogs from the Wikipedia MediaWiki Action API:
 * - Nintendo_Selects (Player's Choice, Nintendo Selects, Happy Price Selection / Minna no Osusume)
 * - Greatest_Hits_(PlayStation) (PlayStation Greatest Hits & PlayStation Hits)
 * - Essentials_(PlayStation) (PAL Platinum, Essentials, & PlayStation Hits)
 * - Platinum_Hits (Xbox / Xbox 360 Platinum Hits, Classics, Platinum Collection & Xbox One Greatest Hits)
 *
 * Deterministically determines whether a release is:
 * 1. 'budget_only' (variants = <Label>): Cartridge/edition was launched strictly on or after the date
 *    the title/base game was inducted into the budget line in that region (e.g., Animal Crossing:
 *    New Leaf - Welcome amiibo CTR-P-EAAE in USA, launched 2016-12-02 vs. NA Selects 2016-08-26).
 * 2. 'standard_and_budget' (also_released_as = <Label>): Cartridge/edition was sold at launch
 *    in standard packaging prior to the budget-line induction date (e.g., Banjo-Kazooie N64,
 *    Welcome amiibo CTR-P-EAAP in Europe launched 2016-11-25 vs. EU Selects 2018-06-29, or Greatest Hits).
 */

import { normalizeTitleForMatching } from '../../shared/title_matching.js';

export interface BudgetInductionRecord {
  title: string;
  normalizedTitle: string;
  platformId: number;
  budgetLabel: string;
  /**
   * Map of region ('USA', 'Europe', 'Australia', 'Japan', 'Korea', 'Asia')
   * to induction date ('YYYY-MM-DD', 'YYYY-MM', 'YYYY', or '' when known to
   * belong to the budget line in that region without an induction date).
   */
  regionalInductionDates: Record<string, string>;
}

export interface BudgetClassificationResult {
  isBudget: boolean;
  isBudgetOnly: boolean;
  budgetLabel: string | null;
  alsoReleasedAs: string | null;
  reason?: string;
}

const MONTH_MAP: Record<string, string> = {
  january: '01',
  jan: '01',
  february: '02',
  feb: '02',
  march: '03',
  mar: '03',
  april: '04',
  apr: '04',
  may: '05',
  june: '06',
  jun: '06',
  july: '07',
  jul: '07',
  august: '08',
  aug: '08',
  september: '09',
  sep: '09',
  sept: '09',
  october: '10',
  oct: '10',
  november: '11',
  nov: '11',
  december: '12',
  dec: '12',
};

// In-memory cache for parsed Wikipedia articles
let cachedBudgetRecords: BudgetInductionRecord[] | null = null;

export function clearBudgetRecordsCache(): void {
  cachedBudgetRecords = null;
}

/**
 * Strips MediaWiki refs, comments, and footnotes from a cell string.
 */
function stripWikiNoise(raw: string): string {
  return (raw || '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{efn\|[\s\S]*?\}\}/gi, '')
    .replace(/\{\{citation needed[^}]*\}\}/gi, '')
    .replace(/\{\{cn[^}]*\}\}/gi, '')
    .trim();
}

/**
 * Parses MediaWiki wikitext date templates ({{dts|2016|08|26}}) and prose dates
 * (e.g. "August 15, 1999", "15 August 1999", "October 1997", "1998") into
 * YYYY-MM-DD, YYYY-MM, or YYYY without inventing month/day precision.
 */
export function parseWikiDate(cellText: string): string | null {
  const cleaned = stripWikiNoise(cellText);
  if (
    !cleaned ||
    /\{\{\s*Unreleased/i.test(cleaned) ||
    /\{\{\s*n\/a/i.test(cleaned) ||
    /unknown/i.test(cleaned) ||
    /^(?:—|–|-|TBA)$/i.test(cleaned)
  ) {
    return null;
  }

  const dtsFullMatch = cleaned.match(
    /\{\{dts\|(\d{4})\|(\d{1,2})\|(\d{1,2})[^}]*\}\}/i,
  );
  if (dtsFullMatch) {
    return `${dtsFullMatch[1]}-${dtsFullMatch[2].padStart(2, '0')}-${dtsFullMatch[3].padStart(2, '0')}`;
  }

  const dtsMonthMatch = cleaned.match(
    /\{\{dts\|(\d{4})\|(\d{1,2})(?:\|[^}]*)?\}\}/i,
  );
  if (dtsMonthMatch) {
    return `${dtsMonthMatch[1]}-${dtsMonthMatch[2].padStart(2, '0')}`;
  }

  const dtsYearMatch = cleaned.match(/\{\{dts\|(\d{4})(?:\|[^}]*)?\}\}/i);
  if (dtsYearMatch) {
    return dtsYearMatch[1];
  }

  const isoMatch = cleaned.match(/\b((?:19|20)\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const mdyMatch = cleaned.match(
    /\b([A-Za-z]+)\s+(\d{1,2}),?\s+((?:19|20)\d{2})\b/,
  );
  if (mdyMatch) {
    const month = MONTH_MAP[mdyMatch[1].toLowerCase()];
    if (month) {
      return `${mdyMatch[3]}-${month}-${mdyMatch[2].padStart(2, '0')}`;
    }
  }

  const dmyMatch = cleaned.match(
    /\b(\d{1,2})\s+([A-Za-z]+)\s+((?:19|20)\d{2})\b/,
  );
  if (dmyMatch) {
    const month = MONTH_MAP[dmyMatch[2].toLowerCase()];
    if (month) {
      return `${dmyMatch[3]}-${month}-${dmyMatch[1].padStart(2, '0')}`;
    }
  }

  const myMatch = cleaned.match(/\b([A-Za-z]+)\s+((?:19|20)\d{2})\b/);
  if (myMatch) {
    const month = MONTH_MAP[myMatch[1].toLowerCase()];
    if (month) {
      return `${myMatch[2]}-${month}`;
    }
  }

  const yearOnlyMatch = cleaned.match(/\b((?:19|20)\d{2})\b/);
  if (yearOnlyMatch) {
    return yearOnlyMatch[1];
  }

  return null;
}

/**
 * Cleans wiki game titles from [[Links|Display Text]], ''Italics'', trailing refs, and footnotes.
 */
export function cleanWikiTitle(rawTitle: string): string {
  let cleaned = stripWikiNoise(rawTitle).replace(/''+/g, '');
  cleaned = cleaned.replace(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/g, '$1');
  return cleaned.replace(/\s+/g, ' ').trim();
}

function splitRowCells(row: string): string[] {
  const lines = row
    .split('\n')
    .map((l) => l.trim())
    .filter(
      (l) => l.startsWith('|') && !l.startsWith('|-') && !l.startsWith('|}'),
    );
  const cells: string[] = [];
  for (const line of lines) {
    const body = line.replace(/^\|+/, '');
    if (body.includes('||')) {
      for (const part of body.split('||')) {
        cells.push(part.trim());
      }
    } else {
      cells.push(body.trim());
    }
  }
  return cells;
}

function mapRegionHeader(headerCell: string): string | null {
  const lower = cleanWikiTitle(headerCell).toLowerCase();
  if (lower.includes('north america') || lower === 'na' || lower === 'ntsc-u') {
    return 'USA';
  }
  if (lower.includes('europe') || lower === 'pal') return 'Europe';
  if (lower.includes('australia') || lower.includes('oceania')) {
    return 'Australia';
  }
  if (lower.includes('japan') || lower === 'ntsc-j') return 'Japan';
  if (lower.includes('korea')) return 'Korea';
  if (lower.includes('asia')) return 'Asia';
  return null;
}

function extractHeadingSlices(
  wikitext: string,
  levelRegex: RegExp,
): Array<{ heading: string; body: string }> {
  const lines = wikitext.split(/\r?\n/);
  const slices: Array<{ heading: string; body: string }> = [];
  let currentHeading: string | null = null;
  let buf: string[] = [];
  for (const line of lines) {
    const m = line.match(levelRegex);
    if (m) {
      if (currentHeading !== null) {
        slices.push({ heading: currentHeading, body: buf.join('\n') });
      }
      currentHeading = cleanWikiTitle(m[1]).toLowerCase();
      buf = [];
    } else if (currentHeading !== null) {
      buf.push(line);
    }
  }
  if (currentHeading !== null) {
    slices.push({ heading: currentHeading, body: buf.join('\n') });
  }
  return slices;
}

function addBudgetRecord(
  outMap: Map<string, BudgetInductionRecord>,
  title: string,
  platformId: number,
  budgetLabel: string,
  regionalDates: Record<string, string>,
): void {
  const norm = normalizeTitleForMatching(title);
  if (!norm || norm.length < 2) return;
  const regions = Object.keys(regionalDates);
  if (regions.length === 0) return;

  const key = `${platformId}::${budgetLabel.toLowerCase()}::${norm}`;
  const existing = outMap.get(key);
  if (!existing) {
    outMap.set(key, {
      title,
      normalizedTitle: norm,
      platformId,
      budgetLabel,
      regionalInductionDates: { ...regionalDates },
    });
    return;
  }
  for (const [reg, dt] of Object.entries(regionalDates)) {
    const prev = existing.regionalInductionDates[reg];
    if (prev === undefined || (prev === '' && dt !== '')) {
      existing.regionalInductionDates[reg] = dt;
    }
  }
}

function parseBulletEntries(
  sectionBody: string,
  defaultRegions: string[],
): Array<{ title: string; regionalDates: Record<string, string> }> {
  const results: Array<{
    title: string;
    regionalDates: Record<string, string>;
  }> = [];
  for (const rawLine of sectionBody.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('*') || line.startsWith('**')) continue;
    const content = stripWikiNoise(line.replace(/^\*+\s*/, ''))
      .replace(/''+/g, '')
      .trim();
    if (!content) continue;

    // Split "Game A / Game B" combos (e.g., Pac-Man World 2 / Pac-Man Vs.)
    const segments = content.includes(' / ')
      ? content.split(/\s+\/\s+/)
      : [content];

    for (let seg of segments) {
      // Extract trailing date in parens if any, e.g. "(February 9, 1998)"
      let parsedDate = '';
      const trailingParenMatch = seg.match(/\(([^()]+)\)\s*$/);
      let regions = [...defaultRegions];

      if (trailingParenMatch) {
        const inner = trailingParenMatch[1].trim();
        const maybeDate = parseWikiDate(inner);
        if (maybeDate) {
          parsedDate = maybeDate;
          seg = seg.slice(0, trailingParenMatch.index).trim();
        } else if (/\bonly\b/i.test(inner)) {
          const lowerInner = inner.toLowerCase();
          const scoped: string[] = [];
          if (
            lowerInner.includes('north america') ||
            /\bus\b/.test(lowerInner)
          ) {
            scoped.push('USA');
          }
          if (lowerInner.includes('europe') || lowerInner.includes('pal')) {
            scoped.push('Europe');
          }
          if (
            lowerInner.includes('australia') ||
            lowerInner.includes('oceania')
          ) {
            scoped.push('Australia');
          }
          if (lowerInner.includes('japan')) scoped.push('Japan');
          if (lowerInner.includes('asia')) scoped.push('Asia');
          if (scoped.length > 0) regions = scoped;
          seg = seg.slice(0, trailingParenMatch.index).trim();
        }
      }

      // Skip obvious cross-game slash bundles or prose annotations
      const cleanedTitle = cleanWikiTitle(seg).replace(
        /\s*\([^)]*edition[^)]*\)$/i,
        (m) => m,
      );
      if (!cleanedTitle || /^list of /i.test(cleanedTitle)) continue;

      const regionalDates: Record<string, string> = {};
      for (const r of regions) {
        regionalDates[r] = parsedDate;
      }
      results.push({ title: cleanedTitle, regionalDates });
    }
  }
  return results;
}

const DEFAULT_NINTENDO_COLUMNS: Record<number, string[]> = {
  23: ['Europe', 'USA', 'Australia', 'Japan'],
  24: ['Europe', 'USA', 'Australia'],
  22: ['Europe', 'USA', 'Australia', 'Korea'],
  17: ['Europe', 'USA'],
  15: ['Europe', 'USA'],
  19: ['USA', 'Japan'],
};

/**
 * Parses Nintendo_Selects wikitext (testable offline with fixture strings).
 */
export function parseNintendoSelectsWikitext(
  wikitext: string,
): BudgetInductionRecord[] {
  const out = new Map<string, BudgetInductionRecord>();
  const sections = extractHeadingSlices(wikitext, /^===\s*([^=].*?)\s*===$/);

  const headingToPlatform: Array<{
    match: RegExp;
    platformId: number;
    label: string;
  }> = [
    { match: /^nintendo 3ds$/i, platformId: 23, label: 'Nintendo Selects' },
    { match: /^wii u$/i, platformId: 24, label: 'Nintendo Selects' },
    { match: /^wii$/i, platformId: 22, label: 'Nintendo Selects' },
    { match: /^gamecube$/i, platformId: 20, label: "Player's Choice" },
    { match: /^nintendo 64$/i, platformId: 17, label: "Player's Choice" },
    {
      match: /^super nintendo entertainment system$/i,
      platformId: 15,
      label: "Player's Choice",
    },
    { match: /^game boy advance$/i, platformId: 19, label: "Player's Choice" },
    { match: /^game boy$/i, platformId: 14, label: "Player's Choice" },
  ];

  for (const sec of sections) {
    const cfg = headingToPlatform.find((h) => h.match.test(sec.heading));
    if (!cfg) continue;

    // 1. Parse wikitables if present in this platform section
    const tableBlocks = sec.body.match(/\{\|[\s\S]*?\|\}/g) || [];
    for (const block of tableBlocks) {
      const rows = block.split(/\r?\n\|-/);
      let columnRegions: string[] | null = null;

      for (const row of rows) {
        const headerMatches = row
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.startsWith('!'));

        if (
          headerMatches.length > 0 &&
          !row.includes("| ''") &&
          !row.includes("|''")
        ) {
          const parsedCols: string[] = [];
          for (const h of headerMatches) {
            const cellBody = h.replace(/^!+\s*/, '');
            const labelPart = cellBody.includes('|')
              ? cellBody.split('|').slice(1).join('|')
              : cellBody;
            const mapped = mapRegionHeader(labelPart);
            if (mapped) parsedCols.push(mapped);
          }
          if (parsedCols.length > 0) {
            columnRegions = parsedCols;
          }
          continue;
        }

        const cells = splitRowCells(row);
        if (cells.length < 2) continue;

        const title = cleanWikiTitle(cells[0]);
        if (!title) continue;

        const colLayout =
          columnRegions && columnRegions.length > 0
            ? columnRegions
            : DEFAULT_NINTENDO_COLUMNS[cfg.platformId] || [];

        const regionalDates: Record<string, string> = {};
        for (let i = 1; i < cells.length; i++) {
          const regionName = colLayout[i - 1];
          if (!regionName) continue;
          const dt = parseWikiDate(cells[i]);
          if (dt) {
            regionalDates[regionName] = dt;
          }
        }

        addBudgetRecord(out, title, cfg.platformId, cfg.label, regionalDates);
      }
    }

    // 2. Parse bulleted lists (GameCube, Game Boy, or Wii Japan bullet list)
    if (cfg.platformId === 20) {
      for (const entry of parseBulletEntries(sec.body, ['USA', 'Europe'])) {
        addBudgetRecord(
          out,
          entry.title,
          cfg.platformId,
          cfg.label,
          entry.regionalDates,
        );
      }
    } else if (cfg.platformId === 14) {
      for (const entry of parseBulletEntries(sec.body, ['USA'])) {
        addBudgetRecord(
          out,
          entry.title,
          cfg.platformId,
          cfg.label,
          entry.regionalDates,
        );
      }
    } else if (cfg.platformId === 22) {
      // Wii includes a Japanese Minna no Osusume Selection bullet list outside the wikitable
      const bodyWithoutTables = sec.body.replace(/\{\|[\s\S]*?\|\}/g, '');
      for (const entry of parseBulletEntries(bodyWithoutTables, ['Japan'])) {
        addBudgetRecord(
          out,
          entry.title,
          cfg.platformId,
          cfg.label,
          entry.regionalDates,
        );
      }
    }
  }

  return Array.from(out.values());
}

/**
 * Parses Greatest_Hits_(PlayStation) wikitext.
 */
export function parsePlayStationGreatestHitsWikitext(
  wikitext: string,
): BudgetInductionRecord[] {
  const out = new Map<string, BudgetInductionRecord>();
  const sections = extractHeadingSlices(wikitext, /^===\s*([^=].*?)\s*===$/);

  const mapHeading = (
    heading: string,
  ): { platformId: number; label: string; regions: string[] } | null => {
    if (heading === 'playstation') {
      return { platformId: 29, label: 'Greatest Hits', regions: ['USA'] };
    }
    if (heading === 'playstation 2') {
      return { platformId: 30, label: 'Greatest Hits', regions: ['USA'] };
    }
    if (heading === 'playstation portable') {
      return { platformId: 31, label: 'Greatest Hits', regions: ['USA'] };
    }
    if (heading === 'playstation 3') {
      return { platformId: 32, label: 'Greatest Hits', regions: ['USA'] };
    }
    if (heading === 'playstation 4') {
      return {
        platformId: 34,
        label: 'PlayStation Hits',
        regions: ['USA', 'Europe', 'Australia', 'Asia'],
      };
    }
    return null;
  };

  for (const sec of sections) {
    const cfg = mapHeading(sec.heading);
    if (!cfg) continue;
    for (const entry of parseBulletEntries(sec.body, cfg.regions)) {
      addBudgetRecord(
        out,
        entry.title,
        cfg.platformId,
        cfg.label,
        entry.regionalDates,
      );
    }
  }
  return Array.from(out.values());
}

/**
 * Parses Essentials_(PlayStation) (Platinum Range & Essentials & PAL PS4 Hits) wikitext.
 */
export function parsePlayStationEssentialsWikitext(
  wikitext: string,
): BudgetInductionRecord[] {
  const out = new Map<string, BudgetInductionRecord>();
  const majorSections = extractHeadingSlices(wikitext, /^==\s*([^=].*?)\s*==$/);

  for (const major of majorSections) {
    let defaultLabel: string | null = null;
    if (major.heading.includes('platinum')) defaultLabel = 'Platinum';
    else if (major.heading.includes('essentials')) defaultLabel = 'Essentials';
    else if (major.heading.includes('playstation hits')) {
      defaultLabel = 'PlayStation Hits';
    }
    if (!defaultLabel) continue;

    const subSections = extractHeadingSlices(
      major.body,
      /^===\s*([^=].*?)\s*===$/,
    );
    for (const sub of subSections) {
      let platformId: number | null = null;
      if (sub.heading.includes('playstation 2')) platformId = 30;
      else if (sub.heading.includes('playstation 3')) platformId = 32;
      else if (sub.heading.includes('playstation 4')) platformId = 34;
      else if (sub.heading.includes('playstation portable')) platformId = 31;
      else if (sub.heading.includes('playstation')) platformId = 29;
      if (!platformId) continue;

      for (const entry of parseBulletEntries(sub.body, [
        'Europe',
        'Australia',
      ])) {
        addBudgetRecord(
          out,
          entry.title,
          platformId,
          defaultLabel,
          entry.regionalDates,
        );
      }
    }
  }

  return Array.from(out.values());
}

/**
 * Parses Platinum_Hits (Xbox, Xbox 360, Xbox One budget lines) wikitext.
 */
export function parseXboxBudgetWikitext(
  wikitext: string,
): BudgetInductionRecord[] {
  const out = new Map<string, BudgetInductionRecord>();
  const majorSections = extractHeadingSlices(wikitext, /^==\s*([^=].*?)\s*==$/);

  for (const major of majorSections) {
    let platformId: number | null = null;
    if (major.heading.includes('original xbox')) platformId = 47;
    else if (major.heading.includes('xbox 360')) platformId = 48;
    else if (major.heading.includes('xbox one')) platformId = 49;
    if (!platformId) continue;

    const subSections = extractHeadingSlices(
      major.body,
      /^===\s*([^=].*?)\s*===$/,
    );
    for (const sub of subSections) {
      let label = 'Platinum Hits';
      let regions: string[] = ['USA'];

      if (sub.heading.includes('classics')) {
        label = 'Xbox Classics';
        regions = ['Europe', 'Australia'];
      } else if (sub.heading.includes('platinum collection')) {
        label = 'Platinum Collection';
        regions = ['Japan'];
      } else if (sub.heading.includes('greatest hits')) {
        label = 'Greatest Hits';
        regions = ['USA'];
      } else if (sub.heading.includes('platinum')) {
        label = 'Platinum Hits';
        regions = ['USA'];
      }

      for (const entry of parseBulletEntries(sub.body, regions)) {
        addBudgetRecord(
          out,
          entry.title,
          platformId,
          label,
          entry.regionalDates,
        );
      }
    }
  }

  return Array.from(out.values());
}

async function fetchWikipediaPageWikitext(pageTitle: string): Promise<string> {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(pageTitle)}&prop=wikitext&redirects=1&format=json`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'CollectionTracker/2.0 (Public Source Aggregator)',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return '';
  const json = (await res.json()) as {
    parse?: { wikitext?: { '*'?: string } };
  };
  return json?.parse?.wikitext?.['*'] || '';
}

/**
 * Fetches and parses Nintendo_Selects wikitables across all Nintendo platforms.
 */
export async function fetchNintendoSelectsRecords(): Promise<
  BudgetInductionRecord[]
> {
  try {
    const wikitext = await fetchWikipediaPageWikitext('Nintendo_Selects');
    return wikitext ? parseNintendoSelectsWikitext(wikitext) : [];
  } catch {
    return [];
  }
}

/**
 * Fetches and parses PlayStation budget lines (Greatest Hits, Platinum, Essentials, PlayStation Hits).
 */
export async function fetchPlayStationBudgetRecords(): Promise<
  BudgetInductionRecord[]
> {
  try {
    const [ghWikitext, essWikitext] = await Promise.all([
      fetchWikipediaPageWikitext('Greatest_Hits_(PlayStation)'),
      fetchWikipediaPageWikitext('Essentials_(PlayStation)'),
    ]);
    return [
      ...(ghWikitext ? parsePlayStationGreatestHitsWikitext(ghWikitext) : []),
      ...(essWikitext ? parsePlayStationEssentialsWikitext(essWikitext) : []),
    ];
  } catch {
    return [];
  }
}

/**
 * Fetches and parses Xbox budget lines (Platinum Hits, Xbox Classics, Platinum Collection, Greatest Hits).
 */
export async function fetchXboxBudgetRecords(): Promise<
  BudgetInductionRecord[]
> {
  try {
    const wikitext = await fetchWikipediaPageWikitext('Platinum_Hits');
    return wikitext ? parseXboxBudgetWikitext(wikitext) : [];
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

  const [nintendoRecords, playstationRecords, xboxRecords] = await Promise.all([
    fetchNintendoSelectsRecords(),
    fetchPlayStationBudgetRecords(),
    fetchXboxBudgetRecords(),
  ]);
  cachedBudgetRecords = [
    ...nintendoRecords,
    ...playstationRecords,
    ...xboxRecords,
  ];
  return cachedBudgetRecords;
}

/**
 * Maps a raw database region string (e.g. "USA, Canada", "Europe, Australia")
 * to canonical budget record region keys without cross-region pollution
 * (Japan/Korea never fall back to USA/Europe).
 */
export function resolveBudgetRegionsForRelease(
  region: string | null | undefined,
): string[] {
  const tokens = (region || 'USA')
    .toLowerCase()
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const mapped: string[] = [];
  const add = (key: string) => {
    if (!mapped.includes(key)) mapped.push(key);
  };

  for (const tok of tokens) {
    if (tok === 'usa' || tok === 'canada' || tok === 'north america') {
      add('USA');
    } else if (
      tok === 'europe' ||
      tok === 'pal' ||
      tok === 'uk' ||
      tok === 'united kingdom' ||
      tok === 'france' ||
      tok === 'germany' ||
      tok === 'italy' ||
      tok === 'spain' ||
      tok === 'netherlands' ||
      tok === 'sweden' ||
      tok === 'norway' ||
      tok === 'denmark' ||
      tok === 'finland' ||
      tok === 'portugal' ||
      tok === 'scandinavia' ||
      tok === 'nordic'
    ) {
      add('Europe');
    } else if (tok === 'australia' || tok === 'new zealand') {
      add('Australia');
      add('Europe');
    } else if (tok === 'japan') {
      add('Japan');
    } else if (tok === 'korea' || tok === 'south korea') {
      add('Korea');
    } else if (tok === 'asia' || tok === 'taiwan' || tok === 'hong kong') {
      add('Asia');
    } else if (tok === 'world') {
      add('USA');
      add('Europe');
    }
  }

  return mapped.length > 0 ? mapped : [];
}

function stripUpdatedEditionForBudgetMatch(rawTitle: string): string {
  return rawTitle
    .replace(/\s*[-:]\s*welcome\s*amiibo\b/gi, '')
    .replace(
      /\s*[-:]\s*(?:deluxe|complete\s+edition|game\s+of\s+the\s+year(?:\s+edition)?|goty|director'?s\s+cut)\b/gi,
      '',
    )
    .trim();
}

function isStrictlyAfterOrOnInduction(
  physicalReleaseDate: string | null | undefined,
  inductionDate: string,
): boolean {
  if (!inductionDate || !physicalReleaseDate) return false;
  const relDate = physicalReleaseDate.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(relDate)) {
    return false;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(inductionDate)) {
    return relDate >= inductionDate;
  }
  if (/^\d{4}-\d{2}$/.test(inductionDate)) {
    return relDate.slice(0, 7) > inductionDate;
  }
  if (/^\d{4}$/.test(inductionDate)) {
    // Only mark budget_only when release year is strictly later than a year-only induction
    return relDate.slice(0, 4) > inductionDate;
  }
  return false;
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
  const baseNormTitle = params.isUpdatedEdition
    ? normalizeTitleForMatching(
        stripUpdatedEditionForBudgetMatch(params.gameTitle),
      )
    : normTitle;

  const exactMatches = records.filter(
    (r) =>
      r.platformId === params.platformId && r.normalizedTitle === normTitle,
  );
  const matches =
    exactMatches.length > 0
      ? exactMatches
      : params.isUpdatedEdition && baseNormTitle && baseNormTitle !== normTitle
        ? records.filter(
            (r) =>
              r.platformId === params.platformId &&
              r.normalizedTitle === baseNormTitle,
          )
        : [];

  if (matches.length === 0) {
    return {
      isBudget: false,
      isBudgetOnly: false,
      budgetLabel: null,
      alsoReleasedAs: null,
    };
  }

  const targetRegions = resolveBudgetRegionsForRelease(params.region);
  if (targetRegions.length === 0) {
    return {
      isBudget: false,
      isBudgetOnly: false,
      budgetLabel: null,
      alsoReleasedAs: null,
    };
  }

  const budgetOnlyLabels: string[] = [];
  const alsoReleasedLabels: string[] = [];
  const reasons: string[] = [];

  for (const match of matches) {
    let matchedRegionKey: string | null = null;
    let inductionDate: string | undefined;
    for (const reg of targetRegions) {
      if (
        Object.prototype.hasOwnProperty.call(match.regionalInductionDates, reg)
      ) {
        matchedRegionKey = reg;
        inductionDate = match.regionalInductionDates[reg];
        break;
      }
    }
    if (matchedRegionKey === null || inductionDate === undefined) {
      continue;
    }

    if (
      inductionDate &&
      isStrictlyAfterOrOnInduction(params.physicalReleaseDate, inductionDate)
    ) {
      if (!budgetOnlyLabels.includes(match.budgetLabel)) {
        budgetOnlyLabels.push(match.budgetLabel);
      }
      reasons.push(
        `Release ${params.physicalReleaseDate} >= induction ${inductionDate} (${matchedRegionKey})`,
      );
    } else {
      if (!alsoReleasedLabels.includes(match.budgetLabel)) {
        alsoReleasedLabels.push(match.budgetLabel);
      }
      reasons.push(
        inductionDate
          ? `Release ${params.physicalReleaseDate || 'unknown'} < induction ${inductionDate} (${matchedRegionKey})`
          : `Standard release later inducted into ${match.budgetLabel} (${matchedRegionKey})`,
      );
    }
  }

  if (budgetOnlyLabels.length === 0 && alsoReleasedLabels.length === 0) {
    return {
      isBudget: false,
      isBudgetOnly: false,
      budgetLabel: null,
      alsoReleasedAs: null,
    };
  }

  if (budgetOnlyLabels.length > 0) {
    return {
      isBudget: true,
      isBudgetOnly: true,
      budgetLabel: budgetOnlyLabels.join(', '),
      alsoReleasedAs:
        alsoReleasedLabels.length > 0 ? alsoReleasedLabels.join(', ') : null,
      reason: reasons.join('; '),
    };
  }

  return {
    isBudget: true,
    isBudgetOnly: false,
    budgetLabel: null,
    alsoReleasedAs: alsoReleasedLabels.join(', '),
    reason: reasons.join('; '),
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
