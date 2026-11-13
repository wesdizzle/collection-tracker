/**
 * NINTENDO SWITCH 1 & 2 COMMUNITY REVISIONS PARSER & MATCHER
 *
 * Ingests and normalizes the Nintendo Revised community Switch cartridge catalog
 * (Google Spreadsheet 1CEABCBrPv1tWf89hSZqUunK0JW-sQo8XpxuvZhdtHQs),
 * provides nxdumptool filename parsing, and matches backup dumps to exact cartridge revisions.
 *
 * Safe for execution across both Cloudflare Workers edge isolates and local Node runtimes.
 */

import { CanonicalRelease } from './canonical_releases.js';
import { normalizeTitleForMatching } from './title_matching.js';
import { extractRegions } from './source_format.js';

export const SWITCH_REVISIONS_SPREADSHEET_ID =
  '1CEABCBrPv1tWf89hSZqUunK0JW-sQo8XpxuvZhdtHQs';

export const SWITCH_REVISIONS_ATTRIBUTION_URL = `https://docs.google.com/spreadsheets/d/${SWITCH_REVISIONS_SPREADSHEET_ID}/edit?gid=0#gid=0`;

export interface SwitchSheetTabConfig {
  gid: string;
  name: string;
  platformId: number; // 26 = Switch, 27 = Switch 2
  isPastRevisions?: boolean;
}

export const SWITCH_SHEET_TABS: SwitchSheetTabConfig[] = [
  { gid: '0', name: 'S1: 1st Party Nintendo', platformId: 26 },
  { gid: '1882179329', name: 'S1: Third Party/Indies', platformId: 26 },
  {
    gid: '609274111',
    name: 'Past Revisions SW1',
    platformId: 26,
    isPastRevisions: true,
  },
  { gid: '561582322', name: 'S2: 1st Party Nintendo', platformId: 27 },
  { gid: '236361288', name: 'S2: Third Party/Indies', platformId: 27 },
  {
    gid: '1855432644',
    name: 'Past Revisions SW2',
    platformId: 27,
    isPastRevisions: true,
  },
];

/**
 * RFC 4180 compliant CSV parser.
 * Handles multiline fields, double-quote escaping (""), and varied CRLF / LF line endings.
 */
export function parseCsvRows(csvContent: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let insideQuotes = false;
  const len = csvContent.length;

  for (let i = 0; i < len; i++) {
    const char = csvContent[i];

    if (insideQuotes) {
      if (char === '"') {
        if (i + 1 < len && csvContent[i + 1] === '"') {
          currentField += '"';
          i++; // Skip escaped quote
        } else {
          insideQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentField);
        currentField = '';
      } else if (char === '\r') {
        if (i + 1 < len && csvContent[i + 1] === '\n') {
          i++;
        }
        currentRow.push(currentField);
        currentField = '';
        if (
          currentRow.length > 0 &&
          currentRow.some((c) => c.trim().length > 0)
        ) {
          rows.push(currentRow);
        }
        currentRow = [];
      } else if (char === '\n') {
        currentRow.push(currentField);
        currentField = '';
        if (
          currentRow.length > 0 &&
          currentRow.some((c) => c.trim().length > 0)
        ) {
          rows.push(currentRow);
        }
        currentRow = [];
      } else {
        currentField += char;
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    if (currentRow.some((c) => c.trim().length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/**
 * Maps spreadsheet region tokens to standard canonical regions.
 */
export function normalizeSpreadsheetRegion(
  rawRegion: string | null | undefined,
): string | null {
  if (!rawRegion) return null;
  const cleaned = rawRegion.trim();
  if (!cleaned || cleaned === '-' || cleaned.toLowerCase() === 'n/a')
    return null;

  const tokens = cleaned
    .split(/[,/]+/)
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

  const mapped = new Set<string>();
  for (const token of tokens) {
    switch (token) {
      case 'USA':
      case 'NA':
      case 'US':
        mapped.add('USA');
        break;
      case 'EUR':
      case 'EU':
      case 'PAL':
        mapped.add('Europe');
        break;
      case 'JPN':
      case 'JP':
        mapped.add('Japan');
        break;
      case 'AUS':
      case 'AU':
        mapped.add('Australia');
        break;
      case 'KOR':
      case 'KR':
        mapped.add('Korea');
        break;
      case 'MSE':
      case 'ASI':
      case 'CHT':
      case 'CHN':
      case 'ASIA':
        mapped.add('Asia');
        break;
      case 'WORLD':
      case 'WW':
        mapped.add('World');
        break;
      default: {
        const fallback = extractRegions(`(${token})`);
        if (fallback) {
          fallback.split(',').forEach((r) => mapped.add(r.trim()));
        } else {
          mapped.add(token);
        }
        break;
      }
    }
  }

  return mapped.size > 0 ? Array.from(mapped).join(', ') : null;
}

export interface RawSpreadsheetRow {
  gameName: string;
  revisionNum: string;
  versionOnCart: string;
  downloadAvailable: string;
  downloadSize: string;
  region: string;
  frontCartCode: string;
  comments: string;
  platformId: number;
  isPastRevision: boolean;
}

export interface BaseGameRegionInfo {
  frontCartCode: string | null;
}

export interface BaseGameMetadata {
  rawTitle: string;
  regions: Map<string, BaseGameRegionInfo>;
}

/**
 * Known title discrepancies in the "Past Revisions SW1" spreadsheet tab where
 * editors used shorthand titles, word transpositions, or edition suffixes that
 * differ from the main-tab game title.
 */
export const PAST_REVISION_TITLE_ALIASES: Record<string, string> = {
  [normalizeTitleForMatching(
    'Dragon Quest XI: Echoes of an Elusive Age - Definitive Edition',
  )]: normalizeTitleForMatching('Dragon Quest XI S: Echoes of an Elusive Age'),
  [normalizeTitleForMatching('Hotline Miami 1 and 2')]:
    normalizeTitleForMatching('Hotline Miami Collection'),
  [normalizeTitleForMatching("Luigi's Mansion")]:
    normalizeTitleForMatching("Luigi's Mansion 3"),
  [normalizeTitleForMatching('Mario Kart Deluxe 8 + Booster Course Pass')]:
    normalizeTitleForMatching('Mario Kart 8 Deluxe + Booster Course Pass'),
  [normalizeTitleForMatching('Monster Boy and the Cursed Kingdom (USA)')]:
    normalizeTitleForMatching('Monster Boy and the Cursed Kingdom'),
  [normalizeTitleForMatching('Monster Boy and the Cursed Kingdom (KOR)')]:
    normalizeTitleForMatching('Monster Boy and the Cursed Kingdom'),
  [normalizeTitleForMatching('Pikmin 3')]:
    normalizeTitleForMatching('Pikmin 3 Deluxe'),
  [normalizeTitleForMatching('Shovel Knight')]: normalizeTitleForMatching(
    'Shovel Knight: Treasure Trove',
  ),
};

export interface ImpliedPastRevision {
  rawTitle: string;
  revisionNum: string;
  versionOnCart: string;
  comments: string;
}

/**
 * Retail Switch games where all regional rows on the main spreadsheet tab were
 * updated to Rev 001+ and editors omitted the base Rev 000 launch print from
 * the "Past Revisions SW1" tab.
 */
export const SWITCH_IMPLIED_PAST_REVISIONS: ImpliedPastRevision[] = [
  {
    rawTitle: 'Donkey Kong Country: Tropical Freeze',
    revisionNum: '000',
    versionOnCart: '1.0.0',
    comments: 'Implied base print (overwritten on main tab by Rev 001)',
  },
  {
    rawTitle: "Dr. Kawashima's Brain Training for Nintendo Switch",
    revisionNum: '000',
    versionOnCart: '1.0.0',
    comments: 'Implied base print (overwritten on main tab)',
  },
  {
    rawTitle: 'Miitopia',
    revisionNum: '000',
    versionOnCart: '1.0.0',
    comments: 'Implied base print (overwritten on main tab)',
  },
  {
    rawTitle: 'Pikmin 4',
    revisionNum: '000',
    versionOnCart: '1.0.0',
    comments: 'Implied base print (overwritten on main tab)',
  },
  {
    rawTitle: 'Pokémon Mystery Dungeon: Rescue Team DX',
    revisionNum: '000',
    versionOnCart: '1.0.0',
    comments: 'Implied base print (overwritten on main tab)',
  },
  {
    rawTitle: 'Super Mario Party Jamboree',
    revisionNum: '000',
    versionOnCart: '1.0.0',
    comments: 'Implied base print (overwritten on main tab)',
  },
  {
    rawTitle: 'Xenoblade Chronicles X : Definitive Edition',
    revisionNum: '000',
    versionOnCart: '1.0.0',
    comments: 'Implied base print (overwritten on main tab)',
  },
  {
    rawTitle: 'Kingdom Hearts: Melody of Memory',
    revisionNum: '000',
    versionOnCart: '1.00',
    comments: 'Implied base print (overwritten on main tab)',
  },
  {
    rawTitle: 'Minecraft',
    revisionNum: '000',
    versionOnCart: '1.0.0',
    comments: 'Implied base print (overwritten on main tab)',
  },
  {
    rawTitle: 'Terraria',
    revisionNum: '000',
    versionOnCart: '1.0',
    comments: 'Implied base print (overwritten on main tab)',
  },
  {
    rawTitle: 'Doki Doki Literature Club Plus!',
    revisionNum: '000',
    versionOnCart: '1.0.2',
    comments: 'Implied base print (overwritten on main tab)',
  },
  {
    rawTitle: 'Spiritfarer',
    revisionNum: '000',
    versionOnCart: '1.8',
    comments: 'Implied base print (overwritten on main tab)',
  },
  {
    rawTitle: 'Stray',
    revisionNum: '000',
    versionOnCart: '1.0.2',
    comments: 'Implied base print (overwritten on main tab)',
  },
];

/**
 * Extracts the 5-character Nintendo Switch master ROM product code (e.g. "AB4PA" from
 * "LA-H-AB4PA-USA" or "LB-AAYYA-USA-0"). Regions sharing the exact same 5-character code
 * share the same master ROM build family.
 */
export function extractSwitchProductCode5(
  serialCode: string | null | undefined,
): string | null {
  if (!serialCode) return null;
  const match = serialCode
    .trim()
    .toUpperCase()
    .match(/^L[A-Z]-(?:H-)?([A-Z0-9]{5})\b/);
  return match ? match[1] : null;
}

/**
 * Checks whether a spreadsheet comment explicitly notes that a higher revision (001/002/003)
 * was the initial physical cartridge print run (so no Rev 000 physical cartridge existed).
 */
export function isLaunchPrintHigherRevisionComment(
  comments: string | null | undefined,
): boolean {
  if (!comments) return false;
  return /revision\s+00[1-9]\s+is\s+(?:probably\s+)?the\s+only\s+one\s+available|cartridges\s+from\s+the\s+launch\s+print\s+are\s+00[1-9]|only\s+revised\s+cartridge\s+00[1-9]/i.test(
    comments,
  );
}

/**
 * Detects explicit regional indicators from comments or game titles in Past Revisions rows.
 */
export function detectExplicitPastRevisionRegions(
  comments: string,
  rawTitle: string,
): string[] | null {
  const combined = `${rawTitle} ${comments}`.toUpperCase();
  if (
    combined.includes('EUR COPIES ONLY') ||
    combined.includes('EUROPE ONLY') ||
    combined.includes('SRG RELEASE') ||
    combined.includes('SUPER RARE GAMES') ||
    /\(EUR\)/i.test(rawTitle)
  ) {
    return ['Europe'];
  }
  if (
    combined.includes('JPN COPIES ONLY') ||
    combined.includes('JAPAN ONLY') ||
    /\(JPN\)/i.test(rawTitle)
  ) {
    return ['Japan'];
  }
  if (
    combined.includes('USA COPIES ONLY') ||
    combined.includes('US COPIES ONLY') ||
    combined.includes('LRG RELEASE') ||
    combined.includes('LIMITED RUN') ||
    /\(USA\)/i.test(rawTitle)
  ) {
    return ['USA'];
  }
  if (
    combined.includes('KOR COPIES ONLY') ||
    combined.includes('KOREA ONLY') ||
    /\(KOR\)/i.test(rawTitle)
  ) {
    return ['Korea'];
  }
  if (
    combined.includes('ASIA COPIES ONLY') ||
    combined.includes('ASIA ONLY') ||
    /\(ASI(?:A)?\)/i.test(rawTitle)
  ) {
    return ['Asia'];
  }
  const titleRegion = extractRegions(rawTitle);
  if (titleRegion) {
    const tokens = titleRegion
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (tokens.length > 0) return tokens;
  }
  return null;
}

/**
 * Normalizes and formats the variant field for a Switch revision canonical release.
 */
export function formatSwitchRevisionVariant(
  revisionNum: string,
  versionOnCart: string,
  downloadAvailable: string,
  frontCartCode: string,
): string {
  const isKeyCard =
    downloadAvailable.trim().toLowerCase() === 'key' ||
    frontCartCode.trim().toUpperCase().startsWith('LP-') ||
    revisionNum.trim() === '-';

  if (isKeyCard) {
    return 'Game Key Card';
  }

  const cleanRev = revisionNum.trim();
  const cleanVer = versionOnCart.trim();

  const formattedRev = cleanRev && cleanRev !== '-' ? `Rev ${cleanRev}` : '';
  const formattedVer =
    cleanVer && cleanVer !== '-' ? `v${cleanVer.replace(/^v/i, '')}` : '';

  if (formattedRev && formattedVer) {
    return `${formattedRev} (${formattedVer})`;
  }
  if (formattedRev) return formattedRev;
  if (formattedVer) return formattedVer;
  return 'Standard';
}

/**
 * Parses all 6 spreadsheet tabs CSV content into canonical releases.
 * Handles continuation row game names and Past Revisions metadata inheritance.
 */
export function parseSwitchRevisionsCsv(
  tabContents: Array<{ tab: SwitchSheetTabConfig; csv: string }>,
): CanonicalRelease[] {
  const baseGamesByPlatform = new Map<number, Map<string, BaseGameMetadata>>();
  baseGamesByPlatform.set(26, new Map());
  baseGamesByPlatform.set(27, new Map());

  const parsedMainRows: RawSpreadsheetRow[] = [];
  const parsedPastRows: RawSpreadsheetRow[] = [];

  // Pass 1: Parse main tabs (gid=0, 1882179329, 561582322, 236361288)
  for (const { tab, csv } of tabContents) {
    if (tab.isPastRevisions) continue;

    const rows = parseCsvRows(csv);
    if (rows.length <= 1) continue;

    let lastSeenGameName = '';

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const rawName = (row[0] || '').trim();
      if (rawName) {
        lastSeenGameName = rawName;
      }
      if (!lastSeenGameName) continue;

      const revisionNum = (row[1] || '').trim();
      const versionOnCart = (row[2] || '').trim();
      const downloadAvailable = (row[3] || '').trim();
      const downloadSize = (row[4] || '').trim();
      const region = (row[5] || '').trim();
      const frontCartCode = (row[6] || '').trim();
      const comments = (row[7] || '').trim();

      const parsed: RawSpreadsheetRow = {
        gameName: lastSeenGameName,
        revisionNum,
        versionOnCart,
        downloadAvailable,
        downloadSize,
        region,
        frontCartCode,
        comments,
        platformId: tab.platformId,
        isPastRevision: false,
      };

      parsedMainRows.push(parsed);

      // Record base game metadata for Past Revisions inheritance
      const norm = normalizeTitleForMatching(lastSeenGameName);
      const platMap = baseGamesByPlatform.get(tab.platformId);
      if (norm && platMap) {
        let meta = platMap.get(norm);
        if (!meta) {
          meta = {
            rawTitle: lastSeenGameName,
            regions: new Map<string, BaseGameRegionInfo>(),
          };
          platMap.set(norm, meta);
        }
        const normReg = normalizeSpreadsheetRegion(region);
        if (normReg) {
          const regTokens = normReg
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          for (const reg of regTokens) {
            if (!meta.regions.has(reg)) {
              meta.regions.set(reg, {
                frontCartCode: frontCartCode || null,
              });
            } else if (frontCartCode && !meta.regions.get(reg)!.frontCartCode) {
              meta.regions.get(reg)!.frontCartCode = frontCartCode;
            }
          }
        }
      }
    }
  }

  // Pass 1b: Main-tab comment expansion & shared 5-character product code base-revision propagation
  const mainRowsByGameKey = new Map<string, RawSpreadsheetRow[]>();
  for (const row of parsedMainRows) {
    const norm = normalizeTitleForMatching(row.gameName);
    if (!norm) continue;
    const gKey = `${row.platformId}::${norm}`;
    let list = mainRowsByGameKey.get(gKey);
    if (!list) {
      list = [];
      mainRowsByGameKey.set(gKey, list);
    }
    list.push(row);
  }

  const synthesizedMainRows: RawSpreadsheetRow[] = [];
  for (const gameRows of mainRowsByGameKey.values()) {
    // 1. Comment: "Revisions 000 and 001 are identical" (e.g., Dungeon Encounters)
    for (const row of gameRows) {
      if (
        /^0*1$/.test(row.revisionNum) &&
        /revisions?\s+000\s+and\s+001\s+are\s+identical/i.test(row.comments)
      ) {
        synthesizedMainRows.push({
          ...row,
          revisionNum: row.revisionNum.length === 2 ? '00' : '000',
          isPastRevision: true,
        });
      }
    }

    // 2. Group rows by 5-character Nintendo product code (e.g. AB4PA in LA-H-AB4PA-EUR / LA-H-AB4PA-USA)
    const rowsByCode5 = new Map<
      string,
      Array<{ row: RawSpreadsheetRow; revInt: number }>
    >();
    for (const row of gameRows) {
      const code5 = extractSwitchProductCode5(row.frontCartCode);
      if (!code5 || !/^\d+$/.test(row.revisionNum)) continue;
      const revInt = parseInt(row.revisionNum, 10);
      let group = rowsByCode5.get(code5);
      if (!group) {
        group = [];
        rowsByCode5.set(code5, group);
      }
      group.push({ row, revInt });
    }

    for (const group of rowsByCode5.values()) {
      if (group.length < 2) continue;

      // Comment: "This includes 000 and 001 cartridges" (e.g., Bloodstained EUR row)
      const rev1Entry = group.find((g) => g.revInt === 1);
      if (rev1Entry) {
        for (const { row, revInt } of group) {
          if (
            revInt === 0 &&
            /includes\s+000\s+and\s+001\s+cartridges/i.test(row.comments)
          ) {
            synthesizedMainRows.push({
              ...row,
              revisionNum: rev1Entry.row.revisionNum,
              versionOnCart: rev1Entry.row.versionOnCart,
            });
          }
        }
      }

      // Find minimum numeric revision in this 5-character product code family
      let minEntry = group[0];
      for (const entry of group) {
        if (entry.revInt < minEntry.revInt) {
          minEntry = entry;
        }
      }

      // Only propagate when the minimum revision is not restricted to a single region
      if (
        detectExplicitPastRevisionRegions(minEntry.row.comments, '') !== null ||
        /only\s+has\s+000/i.test(minEntry.row.comments)
      ) {
        continue;
      }

      // Propagate base revision to sibling regions in the exact same 5-char product code family
      // that only list a strictly higher revision on the main tab
      const minRevByRegion = new Map<string, number>();
      for (const { row, revInt } of group) {
        const normReg =
          normalizeSpreadsheetRegion(row.region) || row.region || 'World';
        const prev = minRevByRegion.get(normReg);
        if (prev === undefined || revInt < prev) {
          minRevByRegion.set(normReg, revInt);
        }
      }

      for (const { row } of group) {
        const normReg =
          normalizeSpreadsheetRegion(row.region) || row.region || 'World';
        const regionLowest = minRevByRegion.get(normReg);
        if (
          regionLowest !== undefined &&
          regionLowest > minEntry.revInt &&
          !isLaunchPrintHigherRevisionComment(row.comments)
        ) {
          synthesizedMainRows.push({
            ...row,
            revisionNum: minEntry.row.revisionNum,
            versionOnCart: minEntry.row.versionOnCart,
            downloadAvailable: minEntry.row.downloadAvailable,
            downloadSize: minEntry.row.downloadSize,
            isPastRevision: true,
          });
          // Mark region as having minEntry.revInt so we only synthesize once per region
          minRevByRegion.set(normReg, minEntry.revInt);
        }
      }
    }
  }

  // Pass 2: Parse Past Revisions tabs (SW1 gid=609274111, SW2 gid=1855432644)
  for (const { tab, csv } of tabContents) {
    if (!tab.isPastRevisions) continue;

    const rows = parseCsvRows(csv);
    if (rows.length <= 1) continue;

    let lastSeenGameName = '';

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const rawName = (row[0] || '').trim();
      if (rawName) {
        lastSeenGameName = rawName;
      }
      if (!lastSeenGameName) continue;

      const pastRevNum = (row[1] || '').trim();
      const versionOnCart = (row[2] || '').trim();
      const comments = (row[3] || '').trim();

      // Look up base game from main tabs (supporting known Past Revisions title aliases & region suffixes)
      const rawNorm = normalizeTitleForMatching(lastSeenGameName);
      const strippedTitle = lastSeenGameName
        .replace(/\s*\((?:USA|EUR|JPN|KOR|ASI|ASIA|AUS|WORLD)\)\s*$/i, '')
        .trim();
      const strippedNorm = normalizeTitleForMatching(strippedTitle);
      const resolvedNorm =
        PAST_REVISION_TITLE_ALIASES[rawNorm] ||
        PAST_REVISION_TITLE_ALIASES[strippedNorm] ||
        strippedNorm ||
        rawNorm;
      const wasAliasResolved =
        Boolean(PAST_REVISION_TITLE_ALIASES[rawNorm]) ||
        Boolean(PAST_REVISION_TITLE_ALIASES[strippedNorm]);

      const baseMeta = baseGamesByPlatform
        .get(tab.platformId)
        ?.get(resolvedNorm);
      const explicitRegions = detectExplicitPastRevisionRegions(
        comments,
        lastSeenGameName,
      );
      const cleanRevNum = pastRevNum.trim();
      const gameName = baseMeta?.rawTitle || strippedTitle || lastSeenGameName;

      if (explicitRegions && explicitRegions.length > 0) {
        for (const reg of explicitRegions) {
          parsedPastRows.push({
            gameName,
            revisionNum: cleanRevNum,
            versionOnCart,
            downloadAvailable: 'No',
            downloadSize: 'N/A',
            region: reg,
            frontCartCode: baseMeta?.regions.get(reg)?.frontCartCode || '',
            comments,
            platformId: tab.platformId,
            isPastRevision: true,
          });
        }
      } else {
        parsedPastRows.push({
          gameName,
          revisionNum: cleanRevNum,
          versionOnCart,
          downloadAvailable: 'No',
          downloadSize: 'N/A',
          region: 'World',
          frontCartCode: '',
          comments,
          platformId: tab.platformId,
          isPastRevision: true,
        });

        // When recovering a dropped Past Revisions row via PAST_REVISION_TITLE_ALIASES,
        // also materialize regional rows across the base game's cataloged regions.
        if (wasAliasResolved && baseMeta && baseMeta.regions.size > 0) {
          for (const [reg, regInfo] of baseMeta.regions.entries()) {
            parsedPastRows.push({
              gameName,
              revisionNum: cleanRevNum,
              versionOnCart,
              downloadAvailable: 'No',
              downloadSize: 'N/A',
              region: reg,
              frontCartCode: regInfo.frontCartCode || '',
              comments,
              platformId: tab.platformId,
              isPastRevision: true,
            });
          }
        }
      }
    }
  }

  // Pass 3: Apply curated SWITCH_IMPLIED_PAST_REVISIONS for retail games whose base Rev 000
  // rows were overwritten across all regions on the main tab and omitted from Past Revisions
  const sw1BaseGames = baseGamesByPlatform.get(26);
  if (sw1BaseGames && sw1BaseGames.size > 0) {
    for (const implied of SWITCH_IMPLIED_PAST_REVISIONS) {
      const norm = normalizeTitleForMatching(implied.rawTitle);
      const baseMeta = sw1BaseGames.get(norm);
      if (!baseMeta || baseMeta.regions.size === 0) continue;

      for (const [reg, regInfo] of baseMeta.regions.entries()) {
        parsedPastRows.push({
          gameName: baseMeta.rawTitle,
          revisionNum: implied.revisionNum,
          versionOnCart: implied.versionOnCart,
          downloadAvailable: 'No',
          downloadSize: 'N/A',
          region: reg,
          frontCartCode: regInfo.frontCartCode || '',
          comments: implied.comments,
          platformId: 26,
          isPastRevision: true,
        });
      }
    }
  }

  // Combine and deduplicate
  const releasesMap = new Map<string, CanonicalRelease>();

  const processRow = (row: RawSpreadsheetRow) => {
    const cleanTitle = row.gameName.trim();
    const normalized = normalizeTitleForMatching(cleanTitle);
    if (!normalized) return;

    const normalizedRegion =
      normalizeSpreadsheetRegion(row.region) || row.region || 'World';
    const variant = formatSwitchRevisionVariant(
      row.revisionNum,
      row.versionOnCart,
      row.downloadAvailable,
      row.frontCartCode,
    );

    const serialCode = row.frontCartCode.trim()
      ? row.frontCartCode.trim()
      : null;

    const comments = row.comments.trim() ? row.comments.trim() : null;

    // Grouping key: platformId + normalizedTitle + region + variant
    const key = `${row.platformId}::${normalized}::${normalizedRegion}::${variant}`;

    if (!releasesMap.has(key)) {
      releasesMap.set(key, {
        platform_id: row.platformId,
        raw_title: cleanTitle,
        normalized_title: normalized,
        region: normalizedRegion,
        variants: variant,
        rom_name: null,
        rom_crc: null,
        serial_code: serialCode,
        barcode: null,
        publisher: comments,
        source: 'nintendo_revised',
        is_verified_physical: 1,
      });
    } else {
      const existing = releasesMap.get(key)!;
      if (!existing.serial_code && serialCode) {
        existing.serial_code = serialCode;
      }
      if (!existing.publisher && comments) {
        existing.publisher = comments;
      }
    }
  };

  for (const r of parsedMainRows) processRow(r);
  for (const r of synthesizedMainRows) processRow(r);
  for (const r of parsedPastRows) processRow(r);

  return Array.from(releasesMap.values());
}

/**
 * Represents a single game segment inside an nxdumptool backup filename.
 */
export interface NxdumptoolGameSegment {
  rawTitle: string;
  cleanTitle: string;
  displayVersion: string | null;
  titleId: string;
  versionInt: number;
  patchLevel: number;
}

/**
 * Result of parsing an nxdumptool filename.
 */
export interface NxdumptoolParseResult {
  isNxdumptool: boolean;
  segments: NxdumptoolGameSegment[];
  compositeTitle: string;
  isMultiGame: boolean;
  dumpFlags: string[];
}

/**
 * Normalizes title strings from nxdumptool dumps where forbidden path characters
 * (such as ':' or '/') are replaced by underscores.
 */
export function normalizeNxdumptoolTitle(title: string): string {
  return title.replace(/_/g, ': ').replace(/\s+/g, ' ').trim();
}

/**
 * Parses an nxdumptool default backup filename.
 *
 * Supported formats:
 * - Single game (v0):
 *   `1-2-Switch [01000320000CC000][v0] [NKA][NC][NT].xci`
 *   `Animal Crossing_ New Horizons [01006F8002326000][v0] [NKA][NC][NT].xci`
 * - Single game with cart revision (display version before TitleID):
 *   `Bayonetta 1.1 [010076F0049A2000][v65536] [NKA][NC][NT].xci`
 *   `ANIMAL WELL 1.0.2 [010020D01AD24000][v131072] [NKA][NC][NT].xci`
 *   `Among Us 2021.9.14 [0100B0C013912000][v917504] [NKA][NC][NT].xci`
 * - Multi-game cart (+ separated):
 *   `20XX 1.1.1 [0100749009844000][v327680] + 30XX 1.3.6 [010059B017F9E000][v851968] [NKA][NC][NT].xci`
 */
export function parseNxdumptoolFilename(
  fileName: string,
): NxdumptoolParseResult {
  const baseName = fileName.replace(/\.(?:xci|nsp)$/i, '').trim();

  // Extract trailing dump flags like [NKA][NC][NT], (ISD), (CT)
  const dumpFlags: string[] = [];
  const flagRegex = /\s*(\[[A-Z0-9\s]+\]|\([A-Z0-9\s]+\))$/i;
  let remaining = baseName;

  while (true) {
    const match = remaining.match(flagRegex);
    if (!match) break;
    const token = match[1].trim();
    // Do not strip TitleID [0100...] or version [v0] as dump flags
    if (/^\[0100[0-9A-F]{12}\]$/i.test(token) || /^\[v\d+\]$/i.test(token)) {
      break;
    }
    dumpFlags.unshift(token);
    remaining = remaining.substring(0, match.index).trim();
  }

  // Check if remaining contains nxdumptool segment pattern: <Title> [<16-hex TitleID>][v<int>]
  const segmentRegex = /(.*?)\s*\[(0100[0-9A-Fa-f]{12})\]\[v(\d+)\]/g;
  const segments: NxdumptoolGameSegment[] = [];

  let match: RegExpExecArray | null;
  while ((match = segmentRegex.exec(remaining)) !== null) {
    let rawTitlePart = match[1].trim();
    const titleId = match[2].toUpperCase();
    const versionInt = parseInt(match[3], 10);
    const patchLevel = Math.round(versionInt / 65536);

    // If leading '+' present from previous multi-game segment, strip it
    rawTitlePart = rawTitlePart.replace(/^\+\s*/, '').trim();

    // Check if a display version is attached to the title (e.g. "Bayonetta 1.1" or "ANIMAL WELL 1.0.2")
    // Version pattern: space followed by digits/dots or date format (e.g., 2021.9.14)
    let displayVersion: string | null = null;
    let titleWithoutVersion = rawTitlePart;

    const versionSuffixMatch = rawTitlePart.match(
      /\s+v?(\d+(?:\.\d+)+[a-z0-9_-]*)$/i,
    );
    if (versionSuffixMatch) {
      displayVersion = versionSuffixMatch[1];
      titleWithoutVersion = rawTitlePart
        .substring(0, versionSuffixMatch.index)
        .trim();
    }

    const cleanTitle = normalizeNxdumptoolTitle(titleWithoutVersion);

    segments.push({
      rawTitle: rawTitlePart,
      cleanTitle,
      displayVersion,
      titleId,
      versionInt,
      patchLevel,
    });
  }

  if (segments.length === 0) {
    return {
      isNxdumptool: false,
      segments: [],
      compositeTitle: baseName,
      isMultiGame: false,
      dumpFlags,
    };
  }

  const isMultiGame = segments.length > 1;
  const compositeTitle = segments.map((s) => s.cleanTitle).join(' + ');

  return {
    isNxdumptool: true,
    segments,
    compositeTitle,
    isMultiGame,
    dumpFlags,
  };
}

/**
 * Normalizes a version string by stripping leading 'v' and trailing zero segments
 * so that '1.1', '1.1.0', and 'v1.1.0.0' are treated as identical.
 */
export function normalizeVersionString(
  ver: string | null | undefined,
): string | null {
  if (!ver) return null;
  const cleaned = ver.trim().replace(/^v/i, '');
  if (!cleaned) return null;
  const parts = cleaned.split('.').map((p) => parseInt(p, 10));
  if (parts.some((n) => isNaN(n))) return cleaned.toLowerCase();
  while (parts.length > 1 && parts[parts.length - 1] === 0) {
    parts.pop();
  }
  return parts.join('.');
}

/**
 * Extracts the raw version string from canonical variants (e.g. "Rev 001 (v1.1)" -> "1.1",
 * "Rev 000 (v1.0.0, 1.0.0)" -> "1.0.0, 1.0.0", or "Rev 1.0.2795" -> "1.0.2795").
 */
export function extractVersionFromVariant(
  variant: string | null | undefined,
): string | null {
  if (!variant) return null;
  const parenMatch = variant.match(/\(v([^)?]+)\)/i);
  if (parenMatch) return parenMatch[1].trim();
  const revVerMatch = variant.match(/\bRev\s+([0-9]+\.[0-9][0-9a-z.,_/\s-]*)/i);
  if (revVerMatch) {
    return revVerMatch[1].replace(/,\s*rev\s*\d+.*$/i, '').trim();
  }
  const bareVerMatch = variant.trim().match(/^v([0-9][0-9a-z._/-]*)$/i);
  return bareVerMatch ? bareVerMatch[1].trim() : null;
}

/**
 * Splits a raw multi-game variant version string on `/` or `,`, strips `1:`, `2:` prefixes,
 * and normalizes each constituent version string.
 */
export function splitVariantVersions(
  rawVer: string | null | undefined,
): string[] {
  if (!rawVer) return [];
  return rawVer
    .split(/[/,]/)
    .map((part) => part.replace(/^\s*\d+\s*:\s*/, '').trim())
    .map((part) => normalizeVersionString(part))
    .filter((v): v is string => Boolean(v));
}

/**
 * Extracts the integer revision number from canonical variants (e.g. "Rev 001 (v1.1)" -> 1,
 * "Rev 1.4.0, rev002" -> 2, ignoring dotted versions like "Rev 1.0.2795").
 */
export function extractRevisionFromVariant(
  variant: string | null | undefined,
): number | null {
  if (!variant) return null;
  const match = variant.match(/\bRev\s*(\d+)(?![.\d])/i);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Resolves the best matching canonical release row from a list of candidate releases
 * for an nxdumptool backup dump.
 */
export function resolveBestSwitchRevisionMatch(
  parsedDump: NxdumptoolParseResult,
  candidateReleases: CanonicalRelease[],
  preferredRegion?: string | null,
): CanonicalRelease | null {
  if (candidateReleases.length === 0) return null;
  if (candidateReleases.length === 1) return candidateReleases[0];

  // Helper: prefer regional match if multiple candidates match the same revision/version
  const matchPreferred = (candidates: CanonicalRelease[]) => {
    if (!preferredRegion || candidates.length <= 1)
      return candidates[0] || null;
    const cleanPref = preferredRegion.trim().toLowerCase();
    const regional = candidates.find(
      (c) =>
        c.region &&
        (c.region.toLowerCase().includes(cleanPref) ||
          cleanPref.includes(c.region.toLowerCase())),
    );
    return (
      regional ||
      candidates.find((c) => c.region?.toLowerCase() === 'world') ||
      candidates[0]
    );
  };

  // Prioritize community Nintendo Revised releases over unverified or placeholder sources
  const nintendoRevisedCandidates = candidateReleases.filter(
    (r) => r.source === 'nintendo_revised',
  );
  const activeCandidates =
    nintendoRevisedCandidates.length > 0
      ? nintendoRevisedCandidates
      : candidateReleases;

  const primarySegment = parsedDump.segments[0];
  if (!primarySegment) return matchPreferred(activeCandidates);

  // 1. If multi-game dump, check for slash- or comma-joined multi-versions (e.g. "1.0.5/1.0.3" or "1.1.1, 1.3.6" matching segments)
  if (parsedDump.isMultiGame && parsedDump.segments.length > 1) {
    const dumpVers = parsedDump.segments
      .map((s) => normalizeVersionString(s.displayVersion))
      .filter((v): v is string => Boolean(v));
    if (dumpVers.length > 0) {
      const multiCandidates = activeCandidates.filter((rel) => {
        const subVers = splitVariantVersions(
          extractVersionFromVariant(rel.variants),
        );
        return (
          subVers.length > 1 && dumpVers.every((dv) => subVers.includes(dv))
        );
      });
      if (multiCandidates.length > 0) return matchPreferred(multiCandidates);
    }
  }

  // 2. If dump has an explicit displayVersion (e.g., "1.1", "1.0.2", "1.1.100.3")
  if (primarySegment.displayVersion) {
    const targetNorm = normalizeVersionString(primarySegment.displayVersion);
    if (targetNorm) {
      const verCandidates = activeCandidates.filter((rel) => {
        const subVers = splitVariantVersions(
          extractVersionFromVariant(rel.variants),
        );
        return subVers.includes(targetNorm);
      });
      if (verCandidates.length > 0) return matchPreferred(verCandidates);
    }
  }

  // 3. If versionInt === 0 ([v0]), match base revision (Rev 000 / Rev 00 / lowest version)
  if (primarySegment.versionInt === 0) {
    const rev0Candidates = activeCandidates.filter((r) => {
      const rev = extractRevisionFromVariant(r.variants);
      return rev === 0;
    });
    if (rev0Candidates.length > 0) return matchPreferred(rev0Candidates);
  }

  // 4. If versionInt > 0, match patchLevel against Rev number only when displayVersion is absent
  // or when no candidate has a parseable version string
  const anyCandidateHasVersion = activeCandidates.some(
    (r) => extractVersionFromVariant(r.variants) !== null,
  );
  if (
    primarySegment.patchLevel > 0 &&
    (!primarySegment.displayVersion || !anyCandidateHasVersion)
  ) {
    const revCandidates = activeCandidates.filter((r) => {
      const rev = extractRevisionFromVariant(r.variants);
      return rev === primarySegment.patchLevel;
    });
    if (revCandidates.length > 0) return matchPreferred(revCandidates);
  }

  return matchPreferred(activeCandidates);
}

/**
 * Fetches all 6 spreadsheet tabs CSV text via standard Google Sheets export URLs.
 */
export async function fetchSwitchSpreadsheetTabs(): Promise<
  Array<{ tab: SwitchSheetTabConfig; csv: string }>
> {
  const results: Array<{ tab: SwitchSheetTabConfig; csv: string }> = [];

  for (const tab of SWITCH_SHEET_TABS) {
    const url = `https://docs.google.com/spreadsheets/d/${SWITCH_REVISIONS_SPREADSHEET_ID}/export?format=csv&gid=${tab.gid}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch Switch sheet tab "${tab.name}" (gid=${tab.gid}): ${response.status} ${response.statusText}`,
      );
    }

    const csv = await response.text();
    results.push({ tab, csv });
  }

  return results;
}

export interface SwitchSyncResult {
  addedCanonical: number;
  updatedCanonical: number;
  deletedCanonical: number;
  purgedLegacyDat: number;
  reconciledReleases: number;
  insertedRevisions: number;
  verifiedGames: number;
  sqlPath?: string;
  sqlContent?: string;
}
