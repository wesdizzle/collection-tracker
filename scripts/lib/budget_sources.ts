import * as fs from 'fs';
import * as path from 'path';
import { normalizeTitleForMatching } from '../../shared/title_matching.js';

export interface BudgetInductionRecord {
  title: string;
  normalizedTitle: string;
  platformId: number;
  budgetLabel: string;
  regionalInductionDates: {
    USA?: string | null;
    Europe?: string | null;
    Japan?: string | null;
    Australia?: string | null;
  };
}

const CACHE_DIR = path.join(process.cwd(), 'scripts', 'temp');
const BUDGET_CACHE_PATH = path.join(CACHE_DIR, 'budget_inductions_cache.json');

/**
 * Parses a MediaWiki date template or date string into ISO YYYY-MM-DD format.
 * Examples:
 * - "{{dts|2016|08|26}}" -> "2016-08-26"
 * - "{{Start date|2011|05|15}}" -> "2011-05-15"
 * - "August 26, 2016" -> "2016-08-26"
 */
export function parseWikiDate(raw: string): string | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  if (/unreleased|n\/a|tba|none|—|-/i.test(cleaned) && !/\d{4}/.test(cleaned)) {
    return null;
  }

  const dtsMatch = cleaned.match(
    /\{\{(?:dts|start date)[^}]*?\|(\d{4})\|(\d{1,2})\|(\d{1,2})/i,
  );
  if (dtsMatch) {
    const [, y, m, d] = dtsMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const monthNames: Record<string, string> = {
    january: '01',
    february: '02',
    march: '03',
    april: '04',
    may: '05',
    june: '06',
    july: '07',
    august: '08',
    september: '09',
    october: '10',
    november: '11',
    december: '12',
  };

  const dtsTextMatch = cleaned.match(
    /\{\{dts\|(\d{4})\|([A-Za-z]+)\|(\d{1,2})/i,
  );
  if (dtsTextMatch) {
    const [, y, mStr, d] = dtsTextMatch;
    const m = monthNames[mStr.toLowerCase()];
    if (m) {
      return `${y}-${m}-${d.padStart(2, '0')}`;
    }
  }

  const textDateMatch = cleaned.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (textDateMatch) {
    const [, mStr, d, y] = textDateMatch;
    const m = monthNames[mStr.toLowerCase()];
    if (m) {
      return `${y}-${m}-${d.padStart(2, '0')}`;
    }
  }

  const dmyMatch = cleaned.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (dmyMatch) {
    const [, d, mStr, y] = dmyMatch;
    const m = monthNames[mStr.toLowerCase()];
    if (m) {
      return `${y}-${m}-${d.padStart(2, '0')}`;
    }
  }

  const isoMatch = cleaned.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    return isoMatch[0];
  }

  return null;
}

/**
 * Cleans MediaWiki markup from a game title cell.
 */
export function cleanWikiTitle(raw: string): string {
  return raw
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/\{\{[^}]+\}\}/g, '')
    .replace(/^\s*!\s*scope="row"\s*\|\s*/i, '')
    .replace(/^\s*\|\s*/, '')
    .trim();
}

/**
 * Parses the Nintendo Selects Wikipedia wikitext for Nintendo 3DS, Wii U, and Wii tables.
 */
export function parseNintendoSelectsWikitext(
  wikitext: string,
): BudgetInductionRecord[] {
  const results: BudgetInductionRecord[] = [];

  const n3dsSectionMatch = wikitext.match(
    /===\s*Nintendo 3DS\s*===([\s\S]*?)(?:===|==\s*[^=])/i,
  );
  if (n3dsSectionMatch) {
    const section = n3dsSectionMatch[1];
    const rows = section.split(/\|-+/);
    for (const row of rows) {
      if (!row.includes('[[') && !row.includes("''")) continue;
      const cells = row
        .split(/\n\s*[|!]/)
        .map((c) => c.trim())
        .filter((c) => c.length > 0 && !c.startsWith('class='));

      if (cells.length >= 2) {
        const titleCell = cells[0].replace(/^scope="row"\s*\|\s*/i, '');
        const title = cleanWikiTitle(titleCell);
        if (!title || /^game$/i.test(title) || title.startsWith('!')) continue;

        const naDate = cells[1] ? parseWikiDate(cells[1]) : null;
        const euDate = cells[2] ? parseWikiDate(cells[2]) : null;
        const auDate = cells[3] ? parseWikiDate(cells[3]) : null;

        if (naDate || euDate || auDate) {
          results.push({
            title,
            normalizedTitle: normalizeTitleForMatching(title),
            platformId: 23, // Nintendo 3DS
            budgetLabel: 'Nintendo Selects',
            regionalInductionDates: {
              USA: naDate,
              Europe: euDate,
              Australia: auDate,
            },
          });
        }
      }
    }
  }

  return results;
}

/**
 * Curated fallback & supplement table for cartridge budget inductions where
 * exact regional induction dates determine whether an updated ROM/packaging
 * revision was budget-only or dual standard+budget.
 */
export const CURATED_CARTRIDGE_BUDGET_RECORDS: BudgetInductionRecord[] = [
  {
    title: 'Animal Crossing: New Leaf',
    normalizedTitle: normalizeTitleForMatching('Animal Crossing: New Leaf'),
    platformId: 23,
    budgetLabel: 'Nintendo Selects',
    regionalInductionDates: {
      USA: '2016-08-26',
      Europe: '2018-06-29',
      Australia: '2018-06-29',
    },
  },
  {
    title: 'Animal Crossing: New Leaf - Welcome amiibo',
    normalizedTitle: normalizeTitleForMatching(
      'Animal Crossing: New Leaf - Welcome amiibo',
    ),
    platformId: 23,
    budgetLabel: 'Nintendo Selects',
    regionalInductionDates: {
      USA: '2016-08-26',
      Europe: '2018-06-29',
      Australia: '2018-06-29',
    },
  },
  {
    title: "Luigi's Mansion: Dark Moon",
    normalizedTitle: normalizeTitleForMatching("Luigi's Mansion: Dark Moon"),
    platformId: 23,
    budgetLabel: 'Nintendo Selects',
    regionalInductionDates: {
      USA: '2016-08-26',
      Europe: '2016-06-24',
    },
  },
  {
    title: 'The Legend of Zelda: Ocarina of Time 3D',
    normalizedTitle: normalizeTitleForMatching(
      'The Legend of Zelda: Ocarina of Time 3D',
    ),
    platformId: 23,
    budgetLabel: 'Nintendo Selects',
    regionalInductionDates: {
      USA: '2016-03-11',
      Europe: '2016-06-24',
    },
  },
  {
    title: 'The Legend of Zelda: A Link Between Worlds',
    normalizedTitle: normalizeTitleForMatching(
      'The Legend of Zelda: A Link Between Worlds',
    ),
    platformId: 23,
    budgetLabel: 'Nintendo Selects',
    regionalInductionDates: {
      USA: '2018-02-05',
      Europe: '2015-10-16',
    },
  },
  {
    title: 'Super Mario 3D Land',
    normalizedTitle: normalizeTitleForMatching('Super Mario 3D Land'),
    platformId: 23,
    budgetLabel: 'Nintendo Selects',
    regionalInductionDates: {
      USA: null,
      Europe: '2017-10-13',
      Australia: '2016-05-26',
    },
  },
  {
    title: 'Donkey Kong Country Returns 3D',
    normalizedTitle: normalizeTitleForMatching(
      'Donkey Kong Country Returns 3D',
    ),
    platformId: 23,
    budgetLabel: 'Nintendo Selects',
    regionalInductionDates: {
      USA: '2016-03-11',
      Europe: '2016-06-24',
    },
  },
  {
    title: 'Star Fox 64 3D',
    normalizedTitle: normalizeTitleForMatching('Star Fox 64 3D'),
    platformId: 23,
    budgetLabel: 'Nintendo Selects',
    regionalInductionDates: {
      USA: '2020-02-04',
      Europe: '2015-10-16',
    },
  },
  {
    title: 'Super Mario Maker for Nintendo 3DS',
    normalizedTitle: normalizeTitleForMatching(
      'Super Mario Maker for Nintendo 3DS',
    ),
    platformId: 23,
    budgetLabel: 'Nintendo Selects',
    regionalInductionDates: {
      USA: '2019-02-15',
      Europe: '2018-06-29',
    },
  },
  {
    title: 'Kirby: Triple Deluxe',
    normalizedTitle: normalizeTitleForMatching('Kirby: Triple Deluxe'),
    platformId: 23,
    budgetLabel: 'Nintendo Selects',
    regionalInductionDates: {
      USA: '2017-02-03',
      Europe: '2016-10-14',
    },
  },
  {
    title: "Yoshi's New Island",
    normalizedTitle: normalizeTitleForMatching("Yoshi's New Island"),
    platformId: 23,
    budgetLabel: 'Nintendo Selects',
    regionalInductionDates: {
      USA: '2016-03-11',
      Europe: '2015-10-16',
    },
  },
  {
    title: 'Mario Party: Island Tour',
    normalizedTitle: normalizeTitleForMatching('Mario Party: Island Tour'),
    platformId: 23,
    budgetLabel: 'Nintendo Selects',
    regionalInductionDates: {
      USA: '2016-03-11',
      Europe: '2015-10-16',
    },
  },
];

/**
 * Fetches and aggregates public budget induction lists from Wikipedia APIs,
 * merging with curated cartridge records. Caches locally to avoid rate-limiting.
 */
export async function fetchAllPublicBudgetInductions(
  forceRefresh = false,
): Promise<BudgetInductionRecord[]> {
  if (!forceRefresh && fs.existsSync(BUDGET_CACHE_PATH)) {
    try {
      const cached = JSON.parse(
        fs.readFileSync(BUDGET_CACHE_PATH, 'utf8'),
      ) as BudgetInductionRecord[];
      if (Array.isArray(cached) && cached.length > 0) {
        return cached;
      }
    } catch {
      // Rebuild cache on error
    }
  }

  const recordMap = new Map<string, BudgetInductionRecord>();
  for (const rec of CURATED_CARTRIDGE_BUDGET_RECORDS) {
    recordMap.set(`${rec.platformId}:${rec.normalizedTitle}`, rec);
  }

  try {
    const url =
      'https://en.wikipedia.org/w/api.php?action=parse&page=Nintendo_Selects&prop=wikitext&format=json';
    const resp = await fetch(url, {
      headers: {
        'User-Agent':
          'CollectionTracker/1.0 (https://github.com/wesdizzle/collection-tracker)',
      },
    });
    if (resp.ok) {
      const data = (await resp.json()) as {
        parse?: { wikitext?: { '*'?: string } };
      };
      const wikitext = data.parse?.wikitext?.['*'];
      if (wikitext) {
        const parsed = parseNintendoSelectsWikitext(wikitext);
        for (const rec of parsed) {
          const key = `${rec.platformId}:${rec.normalizedTitle}`;
          if (!recordMap.has(key)) {
            recordMap.set(key, rec);
          }
        }
      }
    }
  } catch {
    // Gracefully fallback to curated records if offline
  }

  const allRecords = Array.from(recordMap.values());
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  fs.writeFileSync(
    BUDGET_CACHE_PATH,
    JSON.stringify(allRecords, null, 2),
    'utf8',
  );
  return allRecords;
}

/**
 * Determines whether a specific regional cartridge release is:
 * - `budget_only`: The game or updated edition (e.g. Welcome amiibo in USA) launched
 *   after or simultaneous with the base game's budget induction in that region.
 * - `standard_and_budget`: The game launched as a standard retail release first,
 *   and was later inducted into a budget line in that region (`also_released_as`).
 */
export function classifyCartridgeBudgetWithRecords(
  records: BudgetInductionRecord[],
  params: {
    platformId: number;
    gameTitle: string;
    region: string;
    physicalReleaseDate?: string | null;
    isUpdatedEdition?: boolean;
  },
): {
  isBudget: boolean;
  isBudgetOnly: boolean;
  budgetLabel: string | null;
  alsoReleasedAs: string | null;
} {
  const normTitle = normalizeTitleForMatching(params.gameTitle);
  const baseNormTitle = normalizeTitleForMatching(
    params.gameTitle
      .replace(/\s*[-:]\s*Welcome amiibo/i, '')
      .replace(/\s*\(Welcome amiibo\)/i, ''),
  );

  const matched = records.find(
    (r) =>
      r.platformId === params.platformId &&
      (r.normalizedTitle === normTitle || r.normalizedTitle === baseNormTitle),
  );

  if (!matched) {
    return {
      isBudget: false,
      isBudgetOnly: false,
      budgetLabel: null,
      alsoReleasedAs: null,
    };
  }

  const regionKey = params.region.includes('USA')
    ? 'USA'
    : params.region.includes('Europe')
      ? 'Europe'
      : params.region.includes('Australia')
        ? 'Australia'
        : params.region.includes('Japan')
          ? 'Japan'
          : null;

  if (!regionKey) {
    return {
      isBudget: false,
      isBudgetOnly: false,
      budgetLabel: null,
      alsoReleasedAs: null,
    };
  }

  const inductionDate = matched.regionalInductionDates[regionKey];
  if (!inductionDate) {
    return {
      isBudget: false,
      isBudgetOnly: false,
      budgetLabel: null,
      alsoReleasedAs: null,
    };
  }

  if (
    params.isUpdatedEdition &&
    params.physicalReleaseDate &&
    params.physicalReleaseDate >= inductionDate
  ) {
    return {
      isBudget: true,
      isBudgetOnly: true,
      budgetLabel: matched.budgetLabel,
      alsoReleasedAs: null,
    };
  }

  return {
    isBudget: true,
    isBudgetOnly: false,
    budgetLabel: matched.budgetLabel,
    alsoReleasedAs: matched.budgetLabel,
  };
}
