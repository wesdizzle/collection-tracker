import * as fs from 'fs';

export interface DatRelease {
  name: string;
  description: string;
  romName?: string;
  romCrc?: string;
  region?: string | null;
  variants?: string | null;
}

export interface ParsedDat {
  platformName: string;
  releases: DatRelease[];
}

function decodeXmlEntities(str: string): string {
  if (!str.includes('&')) return str;
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, dec: string) =>
      String.fromCodePoint(parseInt(dec, 10)),
    )
    .replace(/&amp;/g, '&');
}

function extractXmlAttribute(
  tag: string,
  attrName: string,
): string | undefined {
  const regex = new RegExp(`\\b${attrName}\\s*=\\s*"([^"]*)"`, 'i');
  const match = regex.exec(tag);
  if (match) return decodeXmlEntities(match[1]);
  const singleQuoteRegex = new RegExp(`\\b${attrName}\\s*=\\s*'([^']*)'`, 'i');
  const singleMatch = singleQuoteRegex.exec(tag);
  if (singleMatch) return decodeXmlEntities(singleMatch[1]);
  return undefined;
}

function extractXmlTagText(block: string, tagName: string): string | undefined {
  const regex = new RegExp(
    `<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`,
    'i',
  );
  const match = regex.exec(block);
  return match ? decodeXmlEntities(match[1].trim()) : undefined;
}

/**
 * Parses a standard No-Intro / Redump XML or CLRMamePro DAT file without external XML dependencies.
 */
export function parseDatFile(filePath: string): ParsedDat | null {
  const content = fs.readFileSync(filePath, 'utf-8');
  const headSlice = content.slice(0, 1000);

  if (headSlice.includes('<datafile') || headSlice.includes('<?xml')) {
    const headerBlock = extractXmlTagText(content, 'header') || '';
    const platformName =
      extractXmlTagText(headerBlock, 'name') ||
      extractXmlTagText(headerBlock, 'description') ||
      'Unknown';

    const releases: DatRelease[] = [];
    const entryRegex = /<(game|machine)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let match: RegExpExecArray | null;

    while ((match = entryRegex.exec(content)) !== null) {
      const openAttrs = match[2];
      const innerBlock = match[3];
      const attrName = extractXmlAttribute(openAttrs, 'name');
      const descText = extractXmlTagText(innerBlock, 'description');
      const gameName = attrName || descText;
      if (!gameName) continue;

      if (/\((unl|pirate|unlicensed|aftermarket|homebrew)\)/i.test(gameName)) {
        continue;
      }

      const roms: { name: string; crc?: string; size: string }[] = [];
      const romRegex = /<rom\b([^>]*?)\/?>/gi;
      let romMatch: RegExpExecArray | null;
      while ((romMatch = romRegex.exec(innerBlock)) !== null) {
        const romAttrs = romMatch[1];
        const rName = extractXmlAttribute(romAttrs, 'name');
        if (!rName) continue;
        const rCrc = extractXmlAttribute(romAttrs, 'crc');
        const rSize = extractXmlAttribute(romAttrs, 'size') || '0';
        roms.push({ name: rName, crc: rCrc, size: rSize });
      }

      let romName: string | undefined;
      let romCrc: string | undefined;
      if (roms.length > 0) {
        const validRoms = roms.filter(
          (r) => !/\.(cue|txt|xml|jpg|png)$/i.test(r.name),
        );
        const primaryRom =
          validRoms.length > 0
            ? validRoms.reduce((prev, curr) =>
                parseInt(curr.size || '0', 10) > parseInt(prev.size || '0', 10)
                  ? curr
                  : prev,
              )
            : roms[0];
        romName = primaryRom.name;
        romCrc =
          primaryRom.crc !== undefined ? String(primaryRom.crc) : undefined;
      }

      if (romName && /\.v64$/i.test(romName)) {
        continue;
      }

      releases.push({
        name: gameName,
        description: descText || gameName,
        romName,
        romCrc,
      });
    }

    return { platformName, releases };
  } else if (headSlice.includes('clrmamepro (')) {
    let platformName = 'Unknown';
    const headerMatch = content.match(
      /clrmamepro\s*\([\s\S]*?name\s+"([^"]+)"[\s\S]*?\)/,
    );
    if (headerMatch) {
      platformName = headerMatch[1];
    }

    const releases: DatRelease[] = [];
    const gameBlocks = content.split(/\bgame\s*\(/);
    for (let i = 1; i < gameBlocks.length; i++) {
      const block = gameBlocks[i];
      const nameMatch = block.match(/name\s+"([^"]+)"/);
      if (nameMatch) {
        const gameName = nameMatch[1];
        if (
          /\((unl|pirate|unlicensed|aftermarket|homebrew)\)/i.test(gameName)
        ) {
          continue;
        }
        const descMatch = block.match(/description\s+"([^"]+)"/);

        let romName: string | undefined;
        let romCrc: string | undefined;
        const romMatch = block.match(/rom\s*\(\s*name\s+"([^"]+)"([^)]+)\)/);
        if (romMatch) {
          romName = romMatch[1];
          const romDetails = romMatch[2];
          const crcMatch = romDetails.match(/crc\s+([0-9a-fA-F]+)/);
          if (crcMatch) {
            romCrc = crcMatch[1];
          }
        }

        if (romName && /\.v64$/i.test(romName)) {
          continue;
        }

        releases.push({
          name: gameName,
          description: descMatch ? descMatch[1] : gameName,
          romName,
          romCrc,
        });
      }
    }
    return { platformName, releases };
  }

  return null;
}
