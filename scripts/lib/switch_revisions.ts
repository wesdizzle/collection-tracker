/**
 * NINTENDO SWITCH 1 & 2 COMMUNITY REVISIONS PARSER & MATCHER
 *
 * Ingests and normalizes the Nintendo Revised community Switch cartridge catalog
 * (Google Spreadsheet 1CEABCBrPv1tWf89hSZqUunK0JW-sQo8XpxuvZhdtHQs),
 * provides nxdumptool filename parsing, and matches backup dumps to exact cartridge revisions.
 *
 * Safe for execution across both Cloudflare Workers edge isolates and local Node runtimes.
 */

import type Database from 'better-sqlite3';
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

export interface BaseGameMetadata {
  rawTitle: string;
  region: string | null;
  frontCartBase: string | null;
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
      if (norm && platMap && !platMap.has(norm)) {
        let frontBase: string | null = null;
        if (frontCartCode) {
          const match = frontCartCode.match(/^(L[A-Z]-[A-Z0-9]+)/i);
          if (match) frontBase = match[1].toUpperCase();
        }
        platMap.set(norm, {
          rawTitle: lastSeenGameName,
          region: normalizeSpreadsheetRegion(region),
          frontCartBase: frontBase,
        });
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

      // Look up base game from main tabs
      const norm = normalizeTitleForMatching(lastSeenGameName);
      const baseMeta = baseGamesByPlatform.get(tab.platformId)?.get(norm);

      parsedPastRows.push({
        gameName: baseMeta?.rawTitle || lastSeenGameName,
        revisionNum: pastRevNum,
        versionOnCart,
        downloadAvailable: 'No',
        downloadSize: 'N/A',
        region: baseMeta?.region || 'USA',
        frontCartCode: baseMeta?.frontCartBase
          ? `${baseMeta.frontCartBase}-USA`
          : '',
        comments,
        platformId: tab.platformId,
        isPastRevision: true,
      });
    }
  }

  // Combine and deduplicate
  const releasesMap = new Map<string, CanonicalRelease>();

  const processRow = (row: RawSpreadsheetRow) => {
    const cleanTitle = row.gameName.trim();
    const normalized = normalizeTitleForMatching(cleanTitle);
    if (!normalized) return;

    const normalizedRegion = normalizeSpreadsheetRegion(row.region) || 'World';
    const variant = formatSwitchRevisionVariant(
      row.revisionNum,
      row.versionOnCart,
      row.downloadAvailable,
      row.frontCartCode,
    );

    const serialCode = row.frontCartCode.trim()
      ? row.frontCartCode.trim()
      : null;

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
        publisher: null,
        source: 'nintendo_revised',
        is_verified_physical: 1,
      });
    } else {
      const existing = releasesMap.get(key)!;
      if (!existing.serial_code && serialCode) {
        existing.serial_code = serialCode;
      }
    }
  };

  for (const r of parsedMainRows) processRow(r);
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

    const versionSuffixMatch = rawTitlePart.match(/\s+(\d+(?:\.\d+)+)$/);
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
 * Resolves the best matching canonical release row from a list of candidate releases
 * for an nxdumptool backup dump.
 */
export function resolveBestSwitchRevisionMatch(
  parsedDump: NxdumptoolParseResult,
  candidateReleases: CanonicalRelease[],
): CanonicalRelease | null {
  if (candidateReleases.length === 0) return null;
  if (candidateReleases.length === 1) return candidateReleases[0];

  // Prioritize community Nintendo Revised releases over unverified or placeholder sources
  const nintendoRevisedCandidates = candidateReleases.filter(
    (r) => r.source === 'nintendo_revised',
  );
  const activeCandidates =
    nintendoRevisedCandidates.length > 0
      ? nintendoRevisedCandidates
      : candidateReleases;

  const primarySegment = parsedDump.segments[0];
  if (!primarySegment) return activeCandidates[0];

  // Helper: extract version string from canonical variants (e.g. "Rev 001 (v1.1)" -> "1.1" or "v1.0.5/1.0.3" -> "1.0.5/1.0.3")
  const extractVersionFromVariant = (variant: string | null): string | null => {
    if (!variant) return null;
    const match = variant.match(/\(v([0-9./\s]+)\)/i);
    return match ? match[1].trim() : null;
  };

  // Helper: extract revision number from canonical variants (e.g. "Rev 001 (v1.1)" -> 1)
  const extractRevisionFromVariant = (
    variant: string | null,
  ): number | null => {
    if (!variant) return null;
    const match = variant.match(/Rev\s*(\d+)/i);
    return match ? parseInt(match[1], 10) : null;
  };

  // 1. If multi-game dump, check for slash-joined multi-versions (e.g. "1.0.5/1.0.3" matching segments)
  if (parsedDump.isMultiGame && parsedDump.segments.length > 1) {
    const dumpVers = parsedDump.segments
      .map((s) => normalizeVersionString(s.displayVersion))
      .filter((v): v is string => Boolean(v));
    for (const rel of activeCandidates) {
      const rawVer = extractVersionFromVariant(rel.variants);
      if (rawVer && rawVer.includes('/')) {
        const subVers = rawVer.split('/').map(normalizeVersionString);
        if (dumpVers.every((dv) => subVers.includes(dv))) {
          return rel;
        }
      }
    }
  }

  // 2. If dump has an explicit displayVersion (e.g., "1.1", "1.0.2", "1.1.100.3")
  if (primarySegment.displayVersion) {
    const targetNorm = normalizeVersionString(primarySegment.displayVersion);
    for (const rel of activeCandidates) {
      const candRaw = extractVersionFromVariant(rel.variants);
      if (!candRaw) continue;
      const subVers = candRaw.split('/').map(normalizeVersionString);
      if (subVers.includes(targetNorm)) {
        return rel;
      }
    }
  }

  // 3. If versionInt === 0 ([v0]), match base revision (Rev 000 / Rev 00 / lowest version)
  if (primarySegment.versionInt === 0) {
    const rev0 = activeCandidates.find((r) => {
      const rev = extractRevisionFromVariant(r.variants);
      return rev === 0;
    });
    if (rev0) return rev0;
  }

  // 4. If versionInt > 0, match patchLevel against Rev number
  if (primarySegment.patchLevel > 0) {
    const revMatch = activeCandidates.find((r) => {
      const rev = extractRevisionFromVariant(r.variants);
      return rev === primarySegment.patchLevel;
    });
    if (revMatch) return revMatch;
  }

  return activeCandidates[0];
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
  verifiedGames: number;
}

/**
 * Synchronizes parsed Switch canonical releases into a SQLite database with row-level diffing,
 * purges legacy 'dat' rows for Switch 1 & 2, and reconciles user collection entries.
 */
export function syncSwitchRevisionsToDatabase(
  db: Database.Database,
  canonicalReleases: CanonicalRelease[],
  options: { dryRun?: boolean } = {},
): SwitchSyncResult {
  const isDryRun = options.dryRun ?? false;

  const targetPlatformIds = Array.from(
    new Set(canonicalReleases.map((r) => r.platform_id)),
  );
  if (targetPlatformIds.length === 0) {
    return {
      addedCanonical: 0,
      updatedCanonical: 0,
      deletedCanonical: 0,
      purgedLegacyDat: 0,
      reconciledReleases: 0,
      verifiedGames: 0,
    };
  }
  const targetIdsStr = targetPlatformIds.join(', ');

  let addedCanonical = 0;
  let updatedCanonical = 0;
  let deletedCanonical = 0;

  // 1. Purge legacy DAT source rows for target platform(s)
  const legacyDatCount = (
    db
      .prepare(
        `SELECT COUNT(*) as c FROM canonical_releases WHERE platform_id IN (${targetIdsStr}) AND source = 'dat'`,
      )
      .get() as { c: number }
  ).c;
  const purgedLegacyDat = legacyDatCount;

  if (!isDryRun && legacyDatCount > 0) {
    db.prepare(
      `
      UPDATE game_releases
      SET canonical_release_id = NULL
      WHERE canonical_release_id IN (
        SELECT id FROM canonical_releases WHERE platform_id IN (${targetIdsStr}) AND source = 'dat'
      )
    `,
    ).run();

    db.prepare(
      `DELETE FROM canonical_releases WHERE platform_id IN (${targetIdsStr}) AND source = 'dat'`,
    ).run();
  }

  // 2. Fetch existing 'nintendo_revised' rows to compute diff
  const existingRows = db
    .prepare(
      `SELECT id, platform_id, raw_title, normalized_title, region, variants, serial_code FROM canonical_releases WHERE platform_id IN (${targetIdsStr}) AND source = 'nintendo_revised'`,
    )
    .all() as Array<{
    id: number;
    platform_id: number;
    raw_title: string;
    normalized_title: string;
    region: string | null;
    variants: string | null;
    serial_code: string | null;
  }>;

  const existingMap = new Map<string, (typeof existingRows)[0]>();
  for (const row of existingRows) {
    const key = `${row.platform_id}::${row.normalized_title}::${row.region || 'World'}::${row.variants || 'Standard'}`;
    existingMap.set(key, row);
  }

  const incomingKeys = new Set<string>();

  const insertStmt = isDryRun
    ? null
    : db.prepare(`
    INSERT INTO canonical_releases (
      platform_id, raw_title, normalized_title, region, variants,
      rom_name, rom_crc, serial_code, barcode, publisher, source, is_verified_physical
    ) VALUES (
      ?, ?, ?, ?, ?,
      NULL, NULL, ?, NULL, NULL, 'nintendo_revised', 1
    )
  `);

  const updateStmt = isDryRun
    ? null
    : db.prepare(`
    UPDATE canonical_releases
    SET raw_title = ?, serial_code = ?
    WHERE id = ?
  `);

  const deleteStmt = isDryRun
    ? null
    : db.prepare('DELETE FROM canonical_releases WHERE id = ?');

  const executeDiff = () => {
    for (const rel of canonicalReleases) {
      const key = `${rel.platform_id}::${rel.normalized_title}::${rel.region || 'World'}::${rel.variants || 'Standard'}`;
      incomingKeys.add(key);

      const existing = existingMap.get(key);
      if (!existing) {
        if (insertStmt) {
          insertStmt.run(
            rel.platform_id,
            rel.raw_title,
            rel.normalized_title,
            rel.region || null,
            rel.variants || null,
            rel.serial_code || null,
          );
        }
        addedCanonical++;
      } else {
        if (
          existing.serial_code !== (rel.serial_code || null) ||
          existing.raw_title !== rel.raw_title
        ) {
          if (updateStmt) {
            updateStmt.run(rel.raw_title, rel.serial_code || null, existing.id);
          }
          updatedCanonical++;
        }
      }
    }

    // Delete obsolete canonical releases
    const deleteIds: number[] = [];
    for (const [key, existing] of existingMap.entries()) {
      if (!incomingKeys.has(key)) {
        deleteIds.push(existing.id);
        deletedCanonical++;
      }
    }

    if (deleteIds.length > 0 && deleteStmt) {
      for (const delId of deleteIds) {
        if (!isDryRun) {
          db.prepare(
            'UPDATE game_releases SET canonical_release_id = NULL WHERE canonical_release_id = ?',
          ).run(delId);
        }
        deleteStmt.run(delId);
      }
    }
  };

  if (!isDryRun) {
    db.transaction(executeDiff)();
  } else {
    executeDiff();
  }

  // 3. Reconcile collection games & game_releases for target platforms
  const reconcileResult = reconcileSwitchReleasesWithDatabase(db, {
    isDryRun,
    platformIds: targetPlatformIds,
  });
  const reconciledReleases = reconcileResult.reconciledReleases;
  const verifiedGames = reconcileResult.verifiedGames;

  return {
    addedCanonical,
    updatedCanonical,
    deletedCanonical,
    purgedLegacyDat,
    reconciledReleases,
    verifiedGames,
  };
}

/**
 * Reconciles user collection games and releases for Switch 1 (26) and Switch 2 (27).
 */
export function reconcileSwitchReleasesWithDatabase(
  db: Database.Database,
  options: { isDryRun?: boolean; platformIds?: number[] } = {},
): { reconciledReleases: number; verifiedGames: number } {
  const isDryRun = options.isDryRun ?? false;
  const targetPlatformIds = options.platformIds ?? [26, 27];
  const targetIdsStr = targetPlatformIds.join(', ');
  let reconciledReleases = 0;
  let verifiedGames = 0;

  const games = db
    .prepare(
      `SELECT stable_id, id, title, region, platform_id, physical_status
       FROM games
       WHERE platform_id IN (${targetIdsStr})`,
    )
    .all() as Array<{
    stable_id: number;
    id: string;
    title: string;
    region: string | null;
    platform_id: number;
    physical_status: string | null;
  }>;

  const canonicalRows = db
    .prepare(
      `SELECT id, platform_id, raw_title, normalized_title, region, variants, serial_code
       FROM canonical_releases
       WHERE platform_id IN (${targetIdsStr}) AND source = 'nintendo_revised'`,
    )
    .all() as Array<{
    id: number;
    platform_id: number;
    raw_title: string;
    normalized_title: string;
    region: string | null;
    variants: string | null;
    serial_code: string | null;
  }>;

  // Group canonical rows by platform_id -> normalized_title -> list
  const canonicalByPlatformNorm = new Map<
    number,
    Map<string, typeof canonicalRows>
  >();
  for (const cr of canonicalRows) {
    if (!canonicalByPlatformNorm.has(cr.platform_id)) {
      canonicalByPlatformNorm.set(cr.platform_id, new Map());
    }
    const platMap = canonicalByPlatformNorm.get(cr.platform_id)!;
    if (!platMap.has(cr.normalized_title)) {
      platMap.set(cr.normalized_title, []);
    }
    platMap.get(cr.normalized_title)!.push(cr);
  }

  const updateGameStatusStmt = isDryRun
    ? null
    : db.prepare(`
    UPDATE games
    SET physical_status = 'verified_physical', verification_tier = 1
    WHERE stable_id = ?
  `);

  const updateReleaseStmt = isDryRun
    ? null
    : db.prepare(`
    UPDATE game_releases
    SET canonical_release_id = ?, is_physical = 1
    WHERE id = ?
  `);

  const updateReleaseVariantStmt = isDryRun
    ? null
    : db.prepare(`
    UPDATE game_releases
    SET canonical_release_id = ?, variants = ?, is_physical = 1
    WHERE id = ?
  `);

  for (const game of games) {
    const norm = normalizeTitleForMatching(game.title);
    const platMap = canonicalByPlatformNorm.get(game.platform_id);
    const matches = platMap?.get(norm) || [];

    if (matches.length > 0) {
      if (game.physical_status !== 'verified_physical') {
        if (updateGameStatusStmt) {
          updateGameStatusStmt.run(game.stable_id);
        }
        verifiedGames++;
      }

      // Check existing game releases
      const releases = db
        .prepare(
          `SELECT id, region, variants, rom_name, canonical_release_id
           FROM game_releases
           WHERE game_id = ?`,
        )
        .all(game.stable_id) as Array<{
        id: string;
        region: string | null;
        variants: string | null;
        rom_name: string | null;
        canonical_release_id: number | null;
      }>;

      // Select default base revision candidate (prefer Rev 000 / lowest revision in game's region)
      const targetRegion = (game.region || 'USA').toLowerCase();
      const regionalMatches = matches.filter(
        (m) =>
          !m.region ||
          m.region.toLowerCase().includes(targetRegion) ||
          targetRegion.includes(m.region.toLowerCase()) ||
          m.region.toLowerCase() === 'world',
      );
      const candidates = regionalMatches.length > 0 ? regionalMatches : matches;

      // Prefer base revision (Rev 000 / Rev 00) for unpinned releases
      const baseRevCandidate =
        candidates.find((c) => /Rev\s*0+0\b/i.test(c.variants || '')) ||
        candidates[0];

      for (const rel of releases) {
        // If release has rom_name, it may already be pinned by backup scanner
        if (!rel.canonical_release_id && baseRevCandidate) {
          if (!rel.variants || rel.variants.trim() === '') {
            if (updateReleaseVariantStmt) {
              updateReleaseVariantStmt.run(
                baseRevCandidate.id,
                baseRevCandidate.variants,
                rel.id,
              );
            }
          } else {
            if (updateReleaseStmt) {
              updateReleaseStmt.run(baseRevCandidate.id, rel.id);
            }
          }
          reconciledReleases++;
        }
      }
    }
  }

  return { reconciledReleases, verifiedGames };
}
