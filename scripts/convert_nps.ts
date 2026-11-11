/**
 * NOPAYSTATION (NPS) TSV TO CANONICAL NO-INTRO DAT CONVERTER
 *
 * Converts PlayStation Vita game releases from NoPayStation TSV (`PSV_GAMES.tsv`)
 * into standard canonical Logiqx XML format (`dats/No-Intro/Sony - PlayStation Vita.dat`).
 *
 * Key Operations:
 * 1. Parses TSV rows into structured PlayStation Vita releases.
 * 2. Normalizes region codes (US -> USA, EU -> Europe, JP -> Japan, ASIA -> Asia, INT -> World).
 * 3. Cleans firmware requirement tags (e.g. "(3.61+!)", "[3.65]") and unneeded bracketed tags.
 * 4. Extracts official Sony Title IDs (e.g. PCSE00651 -> PCSE-00651) as serial attributes.
 * 5. Normalizes ROM names to preferred .zip archives (disallowing .psv and .vpk).
 * 6. Guarantees unique release titles with (Alt) suffixes on collisions.
 * 7. Emits standard Logiqx XML compliant with fast-xml-parser and canonical synchronization routines.
 *
 * USAGE:
 *   npx tsx scripts/convert_nps.ts [path/to/PSV_GAMES.tsv]
 *   npm run dats:convert-nps
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

export const NPS_REGION_MAP: Record<string, string> = {
  US: 'USA',
  EU: 'Europe',
  JP: 'Japan',
  ASIA: 'Asia',
  INT: 'World',
  UNKNOWN: 'World',
};

export const NPS_TITLE_PUNCTUATION_FIXES: Array<[RegExp, string]> = [
  [/\bAssassins Creed\b/gi, "Assassin's Creed"],
  [/\bTom Clancys\b/gi, "Tom Clancy's"],
  [/\bOddworld - Munchs\b/gi, "Oddworld - Munch's"],
  [/\bOddworld - New n Tasty\b/gi, "Oddworld - New 'n' Tasty"],
  [/\bDirectors Cut\b/gi, "Director's Cut"],
  [/\bCollectors Edition\b/gi, "Collector's Edition"],
  [/\bDont Starve\b/gi, "Don't Starve"],
  [/\bIts About Time\b/gi, "It's About Time"],
];

export interface NpsRawRelease {
  titleId: string;
  region: string;
  name: string;
  pkgLink?: string;
  zrif?: string;
  contentId?: string;
  lastModDate?: string;
  originalName?: string;
  fileSize?: string | number;
  sha256?: string;
  requiredFw?: string;
  appVersion?: string;
}

export function escapeXml(unsafe: string | null | undefined): string {
  if (!unsafe) return '';
  return String(unsafe).replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case "'":
        return '&apos;';
      case '"':
        return '&quot;';
      default:
        return c;
    }
  });
}

/**
 * Formats a Sony Title ID (e.g. PCSE00651) into canonical hyphenated serial code (PCSE-00651).
 */
export function formatSonySerial(titleId: string): string {
  const clean = titleId.trim().toUpperCase();
  if (/^[A-Z]{4}\d{5}$/.test(clean)) {
    return `${clean.slice(0, 4)}-${clean.slice(4)}`;
  }
  return clean;
}

/**
 * Converts a single NoPayStation release title into a standardized canonical title and region.
 */
export function normalizeNpsTitle(
  rawName: string,
  rawRegion?: string,
  titleId?: string,
): {
  fullName: string;
  cleanTitle: string;
  region: string;
  serial: string;
  variants: string[];
} {
  const region =
    (rawRegion && NPS_REGION_MAP[rawRegion.trim().toUpperCase()]) ||
    rawRegion?.trim() ||
    'World';

  const serial = titleId ? formatSonySerial(titleId) : '';

  let cleanTitle = rawName.trim();
  const variants: string[] = [];

  // Strip firmware requirement tags like (3.61+!), (3.60), [3.65], [3.67], etc.
  cleanTitle = cleanTitle.replace(
    /\s*\((?:3\.\d{2}[+!]?|COMPACK|MaiDump|Vitamin)[^)]*\)/gi,
    '',
  );
  cleanTitle = cleanTitle.replace(/\s*\[3\.\d{2}\]/gi, '');

  // Extract kiosk/demo tags e.g. (Demo), [Demo], (Trial)
  if (/\b(?:kiosk|demo|trial)\b/i.test(cleanTitle)) {
    const demoMatch = cleanTitle.match(/\((?:demo|kiosk|trial)\)/i);
    if (demoMatch) {
      cleanTitle = cleanTitle.replace(demoMatch[0], '').trim();
      variants.push('Demo');
    }
  }

  // Extract bracketed metadata e.g. [Realta Nua], [reve parfait]
  const bracketMatches = cleanTitle.match(/\[(.*?)\]/g);
  if (bracketMatches) {
    for (const b of bracketMatches) {
      cleanTitle = cleanTitle.replace(b, '').trim();
      const inner = b.slice(1, -1).trim();
      if (inner && !variants.includes(inner)) {
        variants.push(inner);
      }
    }
  }

  // Extract parenthetical editions e.g. (Limited Edition)
  const parenEditionMatches = cleanTitle.match(
    /\(([^)]*(?:edition|version|remaster)[^)]*)\)/gi,
  );
  if (parenEditionMatches) {
    for (const p of parenEditionMatches) {
      cleanTitle = cleanTitle.replace(p, '').trim();
      const inner = p.slice(1, -1).trim();
      if (inner && !variants.includes(inner)) {
        variants.push(inner);
      }
    }
  }

  // Sanitize colons: replace with " - " (standard No-Intro / Windows filesystem safe)
  cleanTitle = cleanTitle.replace(/\s*:\s*/g, ' - ');

  // Sanitize slashes: replace "//" or "/" with " - " or "-"
  cleanTitle = cleanTitle.replace(/\s*\/\/\s*/g, ' - ');
  cleanTitle = cleanTitle.replace(/\s*\/\s*/g, ' - ');
  cleanTitle = cleanTitle.replace(/[/\\]/g, '-');

  // Sanitize asterisks, question marks, quotes, pipe, angle brackets
  cleanTitle = cleanTitle.replace(/\*/g, ' ');
  cleanTitle = cleanTitle.replace(/\?/g, '');
  cleanTitle = cleanTitle.replace(/["<>|]/g, '');

  // Normalize duplicate hyphens and spaces
  cleanTitle = cleanTitle.replace(/\s+-\s+-\s+/g, ' - ');
  cleanTitle = cleanTitle.replace(/\s*-\s*-\s*/g, ' - ');
  cleanTitle = cleanTitle.replace(/\s{2,}/g, ' ').trim();

  // Clean trailing punctuation or hyphens
  cleanTitle = cleanTitle.replace(/\s*-\s*$/, '').trim();

  // Apply known punctuation fixes
  for (const [pattern, replacement] of NPS_TITLE_PUNCTUATION_FIXES) {
    cleanTitle = cleanTitle.replace(pattern, replacement);
  }

  // Assemble full canonical title: Title (Region) (Variant 1) (Variant 2)
  let fullName = cleanTitle;
  if (!fullName.toLowerCase().includes(`(${region.toLowerCase()})`)) {
    fullName += ` (${region})`;
  }

  for (const v of variants) {
    if (!fullName.toLowerCase().includes(`(${v.toLowerCase()})`)) {
      fullName += ` (${v})`;
    }
  }

  return { fullName, cleanTitle, region, serial, variants };
}

/**
 * Converts NoPayStation TSV content into standard Logiqx XML DAT format.
 */
export function convertNpsTsvToLogiqxDat(
  tsvContent: string,
  options?: { platformName?: string; description?: string },
): {
  datContent: string;
  totalParsed: number;
  uniqueCount: number;
} {
  const platformName = options?.platformName || 'Sony - PlayStation Vita';
  const description =
    options?.description || `${platformName} (NoPayStation Canonical Releases)`;
  const lines = tsvContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0 || !lines[0].includes('Title ID')) {
    throw new Error(
      'Invalid NoPayStation TSV: missing header row with Title ID.',
    );
  }

  const rawReleases: NpsRawRelease[] = [];
  // Parse rows (skipping header)
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    if (cols.length < 3) continue;

    const titleId = cols[0]?.trim();
    const region = cols[1]?.trim();
    const name = cols[2]?.trim();

    if (!titleId || !name) continue;

    // Filter to valid Sony PlayStation Vita Title IDs (e.g. PCSA-PCSH, or NPXS system apps)
    if (!/^[A-Z]{4}\d{5}$/i.test(titleId) && !/^NPXS\d{5}$/i.test(titleId)) {
      continue;
    }

    rawReleases.push({
      titleId,
      region,
      name,
      pkgLink: cols[3]?.trim(),
      zrif: cols[4]?.trim(),
      contentId: cols[5]?.trim(),
      lastModDate: cols[6]?.trim(),
      originalName: cols[7]?.trim(),
      fileSize: cols[8]?.trim(),
      sha256: cols[9]?.trim(),
      requiredFw: cols[10]?.trim(),
      appVersion: cols[11]?.trim(),
    });
  }

  const totalParsed = rawReleases.length;

  // Deduplicate by Title ID: if multiple entries have the same Title ID, choose the best one
  const byTitleId = new Map<string, NpsRawRelease>();
  for (const rel of rawReleases) {
    const key = rel.titleId.toUpperCase();
    if (!byTitleId.has(key)) {
      byTitleId.set(key, rel);
    } else {
      const existing = byTitleId.get(key)!;
      // Prefer release with valid zrif license or higher app version
      if (!existing.zrif && rel.zrif) {
        byTitleId.set(key, rel);
      }
    }
  }

  // Track used release names to ensure complete uniqueness across games
  const usedGameNames = new Map<string, number>();

  let datXml = '<?xml version="1.0"?>\n';
  datXml += '<datafile>\n';
  datXml += '\t<header>\n';
  datXml += `\t\t<name>${escapeXml(platformName)}</name>\n`;
  datXml += `\t\t<description>${escapeXml(description)}</description>\n`;
  datXml += '\t\t<version>2026</version>\n';
  datXml += '\t\t<homepage>http://nopaystation.com/</homepage>\n';
  datXml += '\t</header>\n';

  let uniqueCount = 0;

  for (const rel of byTitleId.values()) {
    const { fullName: baseFullName, serial } = normalizeNpsTitle(
      rel.name,
      rel.region,
      rel.titleId,
    );

    let fullName = baseFullName;
    const currentCount = usedGameNames.get(fullName) || 0;
    if (currentCount > 0) {
      // Suffix (Alt) or (Alt 2) to disambiguate identical titles
      const altSuffix =
        currentCount === 1 ? ' (Alt)' : ` (Alt ${currentCount})`;
      // Insert altSuffix before the trailing parenthetical if present or append
      const parenMatch = fullName.match(/\s*\(([^)]+)\)$/);
      if (parenMatch) {
        fullName = `${fullName.slice(0, parenMatch.index)}${altSuffix} (${parenMatch[1]})`;
      } else {
        fullName = `${fullName}${altSuffix}`;
      }
    }
    usedGameNames.set(baseFullName, currentCount + 1);

    const size = rel.fileSize ? String(rel.fileSize).trim() : '0';
    const sha256 =
      rel.sha256 && /^[0-9a-f]{64}$/i.test(rel.sha256)
        ? rel.sha256.toLowerCase()
        : null;
    const romName = `${fullName}.zip`;

    datXml += `\t<game name="${escapeXml(fullName)}" serial="${escapeXml(serial)}">\n`;
    datXml += `\t\t<description>${escapeXml(fullName)}</description>\n`;
    datXml += `\t\t<rom name="${escapeXml(romName)}" size="${size}" serial="${escapeXml(serial)}"`;
    if (sha256) {
      datXml += ` sha256="${sha256}"`;
    }
    datXml += '/>\n';
    datXml += '\t</game>\n';
    uniqueCount++;
  }

  datXml += '</datafile>\n';

  return {
    datContent: datXml,
    totalParsed,
    uniqueCount,
  };
}

/**
 * Main execution CLI script.
 */
export async function runNpsConversion(
  customSourcePath?: string,
  customDestPath?: string,
  customPlatform?: 'vita' | 'ps4',
): Promise<{ destPath: string; uniqueCount: number }> {
  console.log(
    '===============================================================',
  );
  console.log('🔄 NOPAYSTATION (NPS) TO CANONICAL NO-INTRO DAT CONVERTER');
  console.log(
    '===============================================================',
  );

  const platformArg =
    customPlatform ||
    (process.argv.includes('--platform=ps4') ? 'ps4' : 'vita');

  const isPs4 = platformArg === 'ps4';
  const defaultTsvName = isPs4 ? 'PS4_GAMES.tsv' : 'PSV_GAMES.tsv';
  const defaultDatName = isPs4
    ? 'Sony - PlayStation 4.dat'
    : 'Sony - PlayStation Vita.dat';
  const platformName = isPs4
    ? 'Sony - PlayStation 4'
    : 'Sony - PlayStation Vita';

  const sourcePath =
    customSourcePath ||
    process.argv[2] ||
    path.join(rootDir, 'dats', defaultTsvName);

  const destPath =
    customDestPath ||
    process.argv[3] ||
    path.join(rootDir, 'dats', 'No-Intro', defaultDatName);

  let tsvContent: string;

  if (fs.existsSync(sourcePath)) {
    console.log(
      `[NPS-Converter] Reading local TSV file: ${path.relative(rootDir, sourcePath)}`,
    );
    tsvContent = fs.readFileSync(sourcePath, 'utf8');
  } else {
    console.log(
      '[NPS-Converter] Local TSV not found. Downloading live from nopaystation.com...',
    );
    const url = `http://nopaystation.com/tsv/${defaultTsvName}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'CollectionTracker/2.0 (DAT Synchronizer)',
      },
    });
    if (!response.ok) {
      throw new Error(
        `Failed to download TSV: HTTP ${response.status} ${response.statusText}`,
      );
    }
    tsvContent = await response.text();
    console.log(
      `[NPS-Converter] Downloaded ${(tsvContent.length / 1024).toFixed(1)} KB from ${url}`,
    );
  }

  console.log(
    `[NPS-Converter] Converting TSV content to Logiqx XML (${platformName})...`,
  );
  const { datContent, totalParsed, uniqueCount } = convertNpsTsvToLogiqxDat(
    tsvContent,
    { platformName },
  );

  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  fs.writeFileSync(destPath, datContent, 'utf8');
  const sizeMb = (fs.statSync(destPath).size / (1024 * 1024)).toFixed(2);

  console.log(
    '===============================================================',
  );
  console.log(
    `✅ Conversion complete: ${uniqueCount} canonical ${platformName} releases generated.`,
  );
  console.log(
    `   (Parsed: ${totalParsed} total rows, XML file: ${destPath} [${sizeMb} MB])`,
  );
  console.log(
    '===============================================================',
  );

  return { destPath, uniqueCount };
}

// Auto-run when executed directly via CLI
if (process.argv[1] && process.argv[1].endsWith('convert_nps.ts')) {
  runNpsConversion().catch((err) => {
    console.error('❌ NPS conversion failed:', err);
    process.exit(1);
  });
}
