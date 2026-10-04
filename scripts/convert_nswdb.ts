/**
 * NSWDB XML TO CANONICAL NO-INTRO DAT CONVERTER
 *
 * Converts physical Nintendo Switch cartridge releases from NSWDB XML (`NSWreleases.xml`)
 * into standard canonical Logiqx XML format (`dats/No-Intro/Nintendo - Nintendo Switch.dat`).
 *
 * Key Operations:
 * 1. Filters strictly to Type 1 (physical retail cartridges) while excluding eShop (Type 4) and DLC (Type 3).
 * 2. Normalizes 3-letter NSWDB region codes (WLD -> World, EUR -> Europe, JPN -> Japan, etc.).
 * 3. Normalizes bracketed revisions and editions ([Rev 1.0.0], [Deluxe Edition]) into standard parentheticals.
 * 4. Extracts official cartridge serial codes (LA-H-xxxxx) and 8-character CRC32 checksums.
 * 5. Emits standard Logiqx XML compliant with fast-xml-parser and canonical synchronization routines.
 *
 * USAGE:
 *   npx tsx scripts/convert_nswdb.ts [path/to/NSWreleases.xml]
 *   npm run dats:convert-nswdb
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { XMLParser } from 'fast-xml-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

export const NSWDB_REGION_MAP: Record<string, string> = {
  WLD: 'World',
  USA: 'USA',
  EUR: 'Europe',
  JPN: 'Japan',
  KOR: 'Korea',
  GER: 'Germany',
  UKV: 'UK',
  SPA: 'Spain',
  CHN: 'China',
  FRA: 'France',
  TWN: 'Taiwan',
  RUS: 'Russia',
};

export const NSWDB_PUNCTUATION_FIXES: Array<[RegExp, string]> = [
  [/\bAssassins Creed\b/gi, "Assassin's Creed"],
  [/\bYoshis Crafted World\b/gi, "Yoshi's Crafted World"],
  [/\bLuigis Mansion\b/gi, "Luigi's Mansion"],
  [/\bKirbys Return to Dream Land\b/gi, "Kirby's Return to Dream Land"],
  [/\bBowsers Fury\b/gi, "Bowser's Fury"],
  [/\bBaldurs Gate\b/gi, "Baldur's Gate"],
  [/\bSid Meiers\b/gi, "Sid Meier's"],
  [/\bFive Nights at Freddys\b/gi, "Five Nights at Freddy's"],
  [/\bNobunagas Ambition\b/gi, "Nobunaga's Ambition"],
  [/\bJoJos Bizarre Adventure\b/gi, "JoJo's Bizarre Adventure"],
  [/\bAlwas Collection\b/gi, "Alwa's Collection"],
  [/\bAlwas Awakening\b/gi, "Alwa's Awakening"],
  [/\bAlwas Legacy\b/gi, "Alwa's Legacy"],
  [/\bBlueys Quest\b/gi, "Bluey's Quest"],
  [/\bCabelas\b/gi, "Cabela's"],
  [/\bYokus Island Express\b/gi, "Yoku's Island Express"],
  [/\bLuckys Tale\b/gi, "Lucky's Tale"],
  [/\bRiskys Revenge\b/gi, "Risky's Revenge"],
  [/\bPirates Curse\b/gi, "Pirate's Curse"],
  [/\bDragons Trap\b/gi, "Dragon's Trap"],
  [/\bDragons Dogma\b/gi, "Dragon's Dogma"],
  [/\bDragons Lair\b/gi, "Dragon's Lair"],
  [/\bDevils Dare\b/gi, "Devil's Dare"],
  [/\bMonsters Expedition\b/gi, "Monster's Expedition"],
  [/\bAmericas Greatest Game Shows\b/gi, "America's Greatest Game Shows"],
  [/\bTom Clancys\b/gi, "Tom Clancy's"],
  [/\bSenuas Sacrifice\b/gi, "Senua's Sacrifice"],
  [/\bHellblade - Senuas\b/gi, "Hellblade - Senua's"],
  [/\bOddworld - Munchs\b/gi, "Oddworld - Munch's"],
  [/\bOddworld - New n Tasty\b/gi, "Oddworld - New 'n' Tasty"],
  [/\bDirectors Cut\b/gi, "Director's Cut"],
  [/\bPrinces Edition\b/gi, "Prince's Edition"],
  [/\bCollectors Edition\b/gi, "Collector's Edition"],
  [/\bLets Go, Pikachu\b/gi, "Let's Go, Pikachu"],
  [/\bLets Go, Eevee\b/gi, "Let's Go, Eevee"],
  [/\bDont Starve\b/gi, "Don't Starve"],
  [/\bIts About Time\b/gi, "It's About Time"],
];

export interface NswdbRawRelease {
  id?: string | number;
  name?: string;
  publisher?: string;
  region?: string;
  languages?: string;
  group?: string;
  imagesize?: string | number;
  serial?: string;
  titleid?: string;
  imgcrc?: string;
  idcrc?: string;
  filename?: string;
  releasename?: string;
  trimmedsize?: string | number;
  firmware?: string;
  type?: string | number;
  card?: string;
  notes?: string;
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
 * Converts a single NSWDB release into a standardized title, variants, and region.
 */
export function normalizeNswdbTitle(
  rawName: string,
  rawRegion?: string,
): {
  fullName: string;
  cleanTitle: string;
  region: string;
  variants: string[];
} {
  const region =
    (rawRegion && NSWDB_REGION_MAP[rawRegion.trim().toUpperCase()]) ||
    rawRegion?.trim() ||
    'World';

  let cleanTitle = rawName.trim();
  const variants: string[] = [];

  // Extract kiosk/demo tags e.g. *KIOSK* -> Demo
  if (/\*KIOSK\*/i.test(cleanTitle)) {
    cleanTitle = cleanTitle.replace(/\*KIOSK\*/gi, '').trim();
    variants.push('Demo');
  }
  if (/\*DLC\*/i.test(cleanTitle)) {
    cleanTitle = cleanTitle.replace(/\*DLC\*/gi, '').trim();
    variants.push('DLC');
  }

  // Extract bracketed metadata: e.g. [Rev 1.0.0], [Deluxe Edition], [Definitive Edition]
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

  // Extract parenthetical revisions: e.g. (rev001), (Rev 1)
  const parenRevMatches = cleanTitle.match(/\((rev\s*.*?)\)/i);
  if (parenRevMatches) {
    cleanTitle = cleanTitle.replace(parenRevMatches[0], '').trim();
    const inner = parenRevMatches[1].trim();
    if (inner && !variants.includes(inner)) {
      variants.push(inner);
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

  // Apply known punctuation and apostrophe fixes for dumper omissions
  for (const [pattern, replacement] of NSWDB_PUNCTUATION_FIXES) {
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

  return { fullName, cleanTitle, region, variants };
}

/**
 * Converts NSWDB XML content into standard Logiqx XML DAT format.
 */
export function convertNswdbXmlToLogiqxDat(xmlContent: string): {
  datContent: string;
  totalParsed: number;
  physicalCount: number;
  validCrcCount: number;
} {
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: true,
    isArray: (name) => name === 'release',
  });

  const parsed = parser.parse(xmlContent);
  if (!parsed || !parsed.releases || !Array.isArray(parsed.releases.release)) {
    throw new Error(
      'Invalid NSWDB XML: missing root <releases> element or <release> array.',
    );
  }

  const allReleases: NswdbRawRelease[] = parsed.releases.release;
  const totalParsed = allReleases.length;

  // Filter strictly to Type 1 (Physical Retail Cartridges)
  const physicalReleases = allReleases.filter(
    (r) => String(r.type ?? '').trim() === '1',
  );
  const physicalCount = physicalReleases.length;

  let validCrcCount = 0;

  let datXml = '<?xml version="1.0"?>\n';
  datXml += '<datafile>\n';
  datXml += '\t<header>\n';
  datXml += '\t\t<name>Nintendo - Nintendo Switch</name>\n';
  datXml +=
    '\t\t<description>Nintendo - Nintendo Switch (NSWDB Physical Releases)</description>\n';
  datXml += '\t\t<version>2026</version>\n';
  datXml += '\t\t<homepage>http://nswdb.com/</homepage>\n';
  datXml += '\t</header>\n';

  for (const rel of physicalReleases) {
    if (!rel.name) continue;

    const { fullName } = normalizeNswdbTitle(rel.name, rel.region);
    const publisher = rel.publisher ? String(rel.publisher).trim() : null;
    const serial = rel.serial ? String(rel.serial).trim() : null;
    const rawCrc = rel.imgcrc ? String(rel.imgcrc).trim().toLowerCase() : '';
    const crc = /^[0-9a-f]{8}$/.test(rawCrc) ? rawCrc : null;
    if (crc) validCrcCount++;

    const size = rel.trimmedsize ? String(rel.trimmedsize).trim() : '0';
    const romName = `${fullName}.xci`;

    datXml += `\t<game name="${escapeXml(fullName)}">\n`;
    datXml += `\t\t<description>${escapeXml(fullName)}</description>\n`;
    if (publisher) {
      datXml += `\t\t<publisher>${escapeXml(publisher)}</publisher>\n`;
    }

    datXml += `\t\t<rom name="${escapeXml(romName)}" size="${size}"`;
    if (crc) {
      datXml += ` crc="${crc}"`;
    }
    if (serial) {
      datXml += ` serial="${escapeXml(serial)}"`;
    }
    datXml += '/>\n';
    datXml += '\t</game>\n';
  }

  datXml += '</datafile>\n';

  return {
    datContent: datXml,
    totalParsed,
    physicalCount,
    validCrcCount,
  };
}

/**
 * Main execution CLI script.
 */
export function runNswdbConversion(
  customSourcePath?: string,
  customDestPath?: string,
): { destPath: string; physicalCount: number } {
  console.log(
    '===============================================================',
  );
  console.log('🔄 NSWDB TO CANONICAL NO-INTRO DAT CONVERTER');
  console.log(
    '===============================================================',
  );

  const sourcePath =
    customSourcePath ||
    process.argv[2] ||
    path.join(rootDir, 'dats', 'NSWreleases.xml');

  const destPath =
    customDestPath ||
    path.join(rootDir, 'dats', 'No-Intro', 'Nintendo - Nintendo Switch.dat');

  if (!fs.existsSync(sourcePath)) {
    console.error(
      `❌ Error: Source NSWDB XML file not found at: ${sourcePath}`,
    );
    console.error(
      'Please ensure NSWreleases.xml is saved in the dats/ directory.',
    );
    process.exit(1);
  }

  console.log(`📂 Reading NSWDB source: ${path.relative(rootDir, sourcePath)}`);
  const rawXml = fs.readFileSync(sourcePath, 'utf8');

  const result = convertNswdbXmlToLogiqxDat(rawXml);

  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  fs.writeFileSync(destPath, result.datContent, 'utf8');
  const sizeMb = (fs.statSync(destPath).size / 1024 / 1024).toFixed(2);

  console.log(`✅ Conversion successful!`);
  console.log(
    `- Total raw releases parsed:      ${result.totalParsed.toLocaleString()}`,
  );
  console.log(
    `- Physical retail cartridges (Type 1): ${result.physicalCount.toLocaleString()}`,
  );
  console.log(
    `- Verified CRC32 checksums:       ${result.validCrcCount.toLocaleString()}`,
  );
  console.log(
    `- Output DAT:                     ${path.relative(rootDir, destPath)} (${sizeMb} MB)`,
  );
  console.log(
    '===============================================================\n',
  );

  return { destPath, physicalCount: result.physicalCount };
}

// Direct invocation guard
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runNswdbConversion();
}
