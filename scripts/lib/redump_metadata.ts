/**
 * REDUMP.ORG PUBLIC METADATA AGGREGATOR
 *
 * Aggregates live metadata from Redump's public web tables and disc pages:
 * 1. Disc Editions: Classifies 'budget_only' (variants) vs. 'standard_and_budget' (also_released_as)
 *    and detects multi-game box set constituent discs.
 * 2. Pack-in Demos & Bonus Discs: Parses HTML cross-links in Redump's 'Comments' table
 *    (e.g., 'Includes <a href=/disc/13075/>Mega Man Legends 2 (USA) (Demo)</a>').
 * 3. Physical Disc Serials & Barcodes: Sourced directly from Redump disc tables.
 *
 * All logic operates dynamically over Redump's public HTTP endpoints without hardcoded catalog maps.
 */

export const REDUMP_SYSTEM_SLUGS: Record<number, string> = {
  21: 'gc', // Nintendo GameCube
  22: 'wii', // Nintendo Wii
  24: 'wiiu', // Nintendo Wii U (WIP)
  28: 'dc', // Sega Dreamcast
  29: 'psx', // Sony PlayStation
  30: 'ps2', // Sony PlayStation 2
  31: 'ps3', // Sony PlayStation 3
  32: 'psp', // Sony PlayStation Portable
  34: 'ps4', // Sony PlayStation 4 (WIP)
  36: 'xbox', // Microsoft Xbox
  37: 'xbox360', // Microsoft Xbox 360
  38: 'xbone', // Microsoft Xbox One (WIP)
  40: 'ss', // Sega Saturn
  41: 'mcd', // Sega CD
  43: '3do', // Panasonic 3DO
  44: 'ajcd', // Atari Jaguar CD
  45: 'ngcd', // SNK Neo Geo CD
  46: 'cdi', // Philips CD-i
  47: 'pce', // PC Engine CD & TurboGrafx CD
};

export interface RedumpDiscSummary {
  discId: number;
  region: string;
  title: string;
  subtitle?: string;
  system: string;
  version?: string;
  edition: string;
  serial?: string;
}

export interface RedumpDiscDetails {
  discId: number;
  title: string;
  edition: string;
  serial?: string;
  barcode?: string;
  romName?: string;
  romCrc?: string;
  bundledDiscIds: number[];
  bundledDiscNames: string[];
  hostDiscId?: number;
  hostDiscName?: string;
}

export interface EditionClassification {
  isBudgetOnly: boolean;
  primaryBudgetLabel?: string;
  alsoReleasedAs?: string;
  boxSetEdition?: string;
}

const BUDGET_LINE_TOKENS = [
  "player's choice",
  'players choice',
  'greatest hits',
  'nintendo selects',
  'platinum hits',
  'best of platinum hits',
  'classics',
  'best of classics',
  'platinum',
  'essentials',
  'playstation 3 the best',
  'playstation 2 the best',
  'playstation the best',
  'psone books',
  'bighit series',
  'satakore',
  'drekore',
  'sega all stars',
  'ea best hits',
];

/**
 * Classifies Redump's raw Edition string into deterministic catalog flags.
 */
export function classifyRedumpEdition(
  rawEdition: string | null | undefined,
): EditionClassification {
  if (!rawEdition) {
    return { isBudgetOnly: false };
  }

  const tokens = rawEdition
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const hasOriginal = tokens.some((t) => t.toLowerCase() === 'original');
  const foundBudgetTokens: string[] = [];
  let boxSetEdition: string | undefined;

  for (const token of tokens) {
    const tLower = token.toLowerCase();
    const matchedBudget = BUDGET_LINE_TOKENS.find(
      (b) => tLower === b || tLower.startsWith(b),
    );
    if (matchedBudget) {
      foundBudgetTokens.push(token);
    } else if (
      tLower !== 'original' &&
      tLower !== 'rerelease' &&
      tLower !== 'demo' &&
      tLower !== 'beta'
    ) {
      // Possible box set title or special edition tag
      if (!boxSetEdition && token.length > 3) {
        boxSetEdition = token;
      }
    }
  }

  if (foundBudgetTokens.length > 0) {
    const canonicalBudgetLabel = foundBudgetTokens[0];
    if (hasOriginal) {
      return {
        isBudgetOnly: false,
        alsoReleasedAs: canonicalBudgetLabel,
        boxSetEdition,
      };
    } else {
      return {
        isBudgetOnly: true,
        primaryBudgetLabel: canonicalBudgetLabel,
        boxSetEdition,
      };
    }
  }

  return {
    isBudgetOnly: false,
    boxSetEdition,
  };
}

/**
 * Fetches and parses Redump quicksearch results for a given system and game query.
 */
export async function searchRedumpDiscs(
  platformId: number,
  query: string,
): Promise<RedumpDiscSummary[]> {
  const slug = REDUMP_SYSTEM_SLUGS[platformId];
  if (!slug) return [];

  const cleanQuery = query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const url = `http://redump.org/discs/system/${slug}/quicksearch/${encodeURIComponent(cleanQuery)}/`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'CollectionTracker/2.0 (Public Source Aggregator)',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return [];
    const html = await res.text();
    return parseRedumpDiscTableHtml(html, slug);
  } catch {
    return [];
  }
}

/**
 * Parses Redump's <table class="games"> HTML into structured summary objects.
 */
export function parseRedumpDiscTableHtml(
  html: string,
  systemSlug: string,
): RedumpDiscSummary[] {
  const summaries: RedumpDiscSummary[] = [];
  const rowRegex = /<tr><td class="align-center">[\s\S]*?<\/tr>/g;
  const rows = html.match(rowRegex) || [];

  for (const row of rows) {
    // Extract disc URL & ID
    const discMatch = row.match(/<a href="\/disc\/(\d+)\/">([^<]+)<\/a>/i);
    if (!discMatch) continue;
    const discId = parseInt(discMatch[1], 10);
    const title = discMatch[2].trim();

    // Extract subtitle / alternate title if present
    const subtitleMatch = row.match(/<span class="small">([^<]+)<\/span>/i);
    const subtitle = subtitleMatch ? subtitleMatch[1].trim() : undefined;

    // Extract Region
    const regionMatch = row.match(
      /<img src="\/images\/regions\/[^"]+" alt="([^"]+)"/i,
    );
    const region = regionMatch ? regionMatch[1].trim() : 'World';

    // Extract Version
    const cols = row.split('</td>');
    let version: string | undefined;
    let edition = 'Original';
    let serial: string | undefined;

    if (cols.length >= 7) {
      const vText = cols[3].replace(/<[^>]+>/g, '').trim();
      if (vText) version = vText;

      const eText = cols[4].replace(/<[^>]+>/g, '').trim();
      if (eText) edition = eText;

      const sText = cols[6]
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .trim();
      if (sText) serial = sText;
    }

    summaries.push({
      discId,
      region,
      title,
      subtitle,
      system: systemSlug,
      version,
      edition,
      serial,
    });
  }

  return summaries;
}

/**
 * Fetches full Redump disc page and /sfv/ details, including pack-in links and exact ROM names.
 */
export async function fetchRedumpDiscDetails(
  discId: number,
): Promise<RedumpDiscDetails | null> {
  const pageUrl = `http://redump.org/disc/${discId}/`;
  const sfvUrl = `http://redump.org/disc/${discId}/sfv/`;

  try {
    const [pageRes, sfvRes] = await Promise.all([
      fetch(pageUrl, {
        headers: {
          'User-Agent': 'CollectionTracker/2.0 (Public Source Aggregator)',
        },
        signal: AbortSignal.timeout(8000),
      }),
      fetch(sfvUrl, {
        headers: {
          'User-Agent': 'CollectionTracker/2.0 (Public Source Aggregator)',
        },
        signal: AbortSignal.timeout(8000),
      }),
    ]);

    if (!pageRes.ok) return null;
    const html = await pageRes.text();

    // Title
    const titleMatch = html.match(/<h1>([^<]+)<\/h1>/i);
    const title = titleMatch ? titleMatch[1].trim() : 'Unknown';

    // Edition
    const editionMatch = html.match(
      /<tr><th>Edition<\/th><td>([\s\S]*?)<\/td><\/tr>/i,
    );
    const edition = editionMatch
      ? editionMatch[1].replace(/<[^>]+>/g, '').trim()
      : 'Original';

    // Serial
    const serialMatch = html.match(
      /<tr><th>Serial<\/th><td>([\s\S]*?)<\/td><\/tr>/i,
    );
    const serial = serialMatch
      ? serialMatch[1]
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .trim()
      : undefined;

    // Barcode
    const barcodeMatch = html.match(
      /<tr><th>Barcode<\/th><\/tr><tr><td>([\s\S]*?)<\/td><\/tr>/i,
    );
    const barcode = barcodeMatch
      ? barcodeMatch[1].replace(/<[^>]+>/g, '').trim()
      : undefined;

    // SFV parsing (ROM name and CRC)
    let romName: string | undefined;
    let romCrc: string | undefined;

    if (sfvRes.ok) {
      const sfvText = (await sfvRes.text()).trim();
      const lines = sfvText
        .split('\n')
        .filter((l) => l.trim() && !l.startsWith(';'));
      if (lines.length > 0) {
        // Last line or matching cue/iso line
        const targetLine =
          lines.find((l) =>
            /\.(cue|iso|bin)$/i.test(l.trim().split(/\s+/)[0]),
          ) || lines[lines.length - 1];
        const parts = targetLine.trim().split(/\s+/);
        if (parts.length >= 2) {
          romName = parts.slice(0, parts.length - 1).join(' ');
          romCrc = parts[parts.length - 1].toLowerCase();
        }
      }
    }

    // Parse Comments for bundled demo / host links
    const commentsMatch = html.match(
      /<tr><th>Comments<\/th><\/tr><tr><td>([\s\S]*?)<\/td><\/tr>/i,
    );
    const bundledDiscIds: number[] = [];
    const bundledDiscNames: string[] = [];
    let hostDiscId: number | undefined;
    let hostDiscName: string | undefined;

    if (commentsMatch) {
      const cHtml = commentsMatch[1];
      // 1. Pack-ins hosted on this game: "Includes ... <a href=/disc/13075/>Mega Man Legends 2 (USA) (Demo)</a>"
      const includesMatches = [
        ...cHtml.matchAll(
          /(?:Includes|bonus disc)[^<]*<a href=["']?\/disc\/(\d+)\/?["']?[^>]*>([^<]+)<\/a>/gi,
        ),
      ];
      for (const m of includesMatches) {
        bundledDiscIds.push(parseInt(m[1], 10));
        bundledDiscNames.push(m[2].trim());
      }

      // 2. Host game of this demo: "Bundled with <a href=/disc/13074/>Misadventures of Tron Bonne, The (USA)</a>"
      const hostMatch = cHtml.match(
        /Bundled with[^<]*<a href=["']?\/disc\/(\d+)\/?["']?[^>]*>([^<]+)<\/a>/i,
      );
      if (hostMatch) {
        hostDiscId = parseInt(hostMatch[1], 10);
        hostDiscName = hostMatch[2].trim();
      }
    }

    return {
      discId,
      title,
      edition,
      serial,
      barcode,
      romName,
      romCrc,
      bundledDiscIds,
      bundledDiscNames,
      hostDiscId,
      hostDiscName,
    };
  } catch {
    return null;
  }
}
