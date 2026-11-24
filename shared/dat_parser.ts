/**
 * STREAMING NO-INTRO & REDUMP DAT PARSER (WORKER-SAFE)
 *
 * Parses XML (`<datafile>`) and CLRMamePro DAT contents sequentially without
 * building full-document DOM trees so large DATs (up to ~13 MB PSX Redump XML)
 * stay well inside Cloudflare Worker 128 MB isolate memory budgets.
 */

import { hasNonEnglishOnlyLanguageTag } from './source_format.js';

export interface DatRom {
  name: string;
  size: number;
  crc?: string;
  md5?: string;
  sha1?: string;
  serial?: string;
}

export interface DatRelease {
  name: string;
  roms: DatRom[];
  category?: string;
  publisher?: string;
  serial?: string;
}

export interface DatFileContent {
  platformName: string;
  releases: DatRelease[];
}

const UNOFFICIAL_RELEASE_RE =
  /\((unl|pirate|unlicensed|aftermarket|homebrew)\b/i;

function decodeXmlEntities(raw: string): string {
  if (!raw || !raw.includes('&')) return raw;
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
    });
}

function parseXmlAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(attrString)) !== null) {
    const val = match[2] !== undefined ? match[2] : (match[3] ?? '');
    attrs[match[1]] = decodeXmlEntities(val);
  }
  return attrs;
}

function extractFirstXmlTagText(
  block: string,
  tagName: string,
): string | undefined {
  const re = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const m = block.match(re);
  if (!m) return undefined;
  const trimmed = decodeXmlEntities(m[1]).trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Extracts the `<name>` or CLRMamePro `name "..."` header from a DAT file prefix.
 */
export function extractDatHeaderName(headText: string): string | null {
  const nameMatch =
    headText.match(/<name>([^<]+)<\/name>/i) ||
    headText.match(/clrmamepro\s*\(\s*name\s*"([^"]+)"/i) ||
    headText.match(/name\s*"([^"]+)"/i);
  return nameMatch ? decodeXmlEntities(nameMatch[1]).trim() : null;
}

/**
 * Parses a No-Intro or Redump DAT payload (XML or CLRMamePro) into normalized releases.
 */
export function parseDatContent(
  fileContent: string,
  sourceLabel = 'DAT',
): DatFileContent {
  if (
    fileContent.includes('<datafile') ||
    fileContent.trimStart().startsWith('<?xml')
  ) {
    return parseXmlDatStreaming(fileContent, sourceLabel);
  }
  if (fileContent.includes('clrmamepro') || fileContent.includes('game (')) {
    return parseClrMameProDat(fileContent);
  }

  throw new Error(
    `Invalid DAT file: ${sourceLabel} is missing <datafile> root element and CLRMamePro header.`,
  );
}

function parseXmlDatStreaming(
  fileContent: string,
  sourceLabel: string,
): DatFileContent {
  if (!fileContent.includes('<datafile')) {
    throw new Error(
      `Invalid DAT file: ${sourceLabel} is missing <datafile> root element.`,
    );
  }

  let platformName = 'Unknown Platform';
  let headerUrl = '';
  const headerStart = fileContent.indexOf('<header>');
  if (headerStart === -1) {
    const altHeaderStart = fileContent.indexOf('<header ');
    if (altHeaderStart !== -1) {
      const headerEnd = fileContent.indexOf('</header>', altHeaderStart);
      if (headerEnd !== -1) {
        const headerBlock = fileContent.slice(altHeaderStart, headerEnd + 9);
        platformName =
          extractFirstXmlTagText(headerBlock, 'name') || 'Unknown Platform';
        headerUrl = extractFirstXmlTagText(headerBlock, 'url') || '';
      }
    }
  } else {
    const headerEnd = fileContent.indexOf('</header>', headerStart);
    if (headerEnd !== -1) {
      const headerBlock = fileContent.slice(headerStart, headerEnd + 9);
      platformName =
        extractFirstXmlTagText(headerBlock, 'name') || 'Unknown Platform';
      headerUrl = extractFirstXmlTagText(headerBlock, 'url') || '';
    }
  }

  const releases: DatRelease[] = [];
  let hasArchiveAttr = false;
  let searchPos = 0;

  while (true) {
    const gameStart = fileContent.indexOf('<game', searchPos);
    if (gameStart === -1) break;

    const afterTagChar = fileContent[gameStart + 5];
    if (
      afterTagChar &&
      afterTagChar !== ' ' &&
      afterTagChar !== '\t' &&
      afterTagChar !== '\r' &&
      afterTagChar !== '\n' &&
      afterTagChar !== '>'
    ) {
      searchPos = gameStart + 5;
      continue;
    }

    const openEnd = fileContent.indexOf('>', gameStart + 5);
    if (openEnd === -1) break;

    const isSelfClosing = fileContent[openEnd - 1] === '/';
    let gameEnd = openEnd + 1;
    let innerContent = '';

    if (!isSelfClosing) {
      const closeStart = fileContent.indexOf('</game>', openEnd + 1);
      if (closeStart === -1) {
        searchPos = openEnd + 1;
        continue;
      }
      innerContent = fileContent.slice(openEnd + 1, closeStart);
      gameEnd = closeStart + 7;
    }

    searchPos = gameEnd;

    const openAttrText = fileContent.slice(
      gameStart + 5,
      isSelfClosing ? openEnd - 1 : openEnd,
    );
    const gameAttrs = parseXmlAttributes(openAttrText);
    if (!hasArchiveAttr && gameAttrs['archive'] !== undefined) {
      hasArchiveAttr = true;
    }

    const gameName = gameAttrs['name'];
    if (!gameName) continue;
    if (
      gameAttrs['isbios'] === 'yes' ||
      gameAttrs['isdevice'] === 'yes' ||
      gameAttrs['ismechanical'] === 'yes'
    ) {
      continue;
    }
    if (gameName.includes('[BIOS]') || UNOFFICIAL_RELEASE_RE.test(gameName)) {
      continue;
    }

    if (!innerContent) continue;

    const roms: DatRom[] = [];
    const romRe = /<rom\b([^>]*?)\/?>/gi;
    let romMatch: RegExpExecArray | null;
    while ((romMatch = romRe.exec(innerContent)) !== null) {
      const rawRom = parseXmlAttributes(romMatch[1]);
      const romName = rawRom['name'];
      if (!romName) continue;
      if (UNOFFICIAL_RELEASE_RE.test(romName)) continue;
      if (romName.toLowerCase().endsWith('.v64')) continue;

      roms.push({
        name: romName,
        size: Number(rawRom['size']) || 0,
        crc: rawRom['crc'] ? rawRom['crc'].toLowerCase().trim() : undefined,
        md5: rawRom['md5'] ? rawRom['md5'].toLowerCase().trim() : undefined,
        sha1: rawRom['sha1'] ? rawRom['sha1'].toLowerCase().trim() : undefined,
        serial: rawRom['serial'] ? rawRom['serial'].trim() : undefined,
      });
    }

    if (roms.length === 0) continue;

    const category = extractFirstXmlTagText(innerContent, 'category');
    const publisher = extractFirstXmlTagText(innerContent, 'publisher');
    const serial = extractFirstXmlTagText(innerContent, 'serial');

    releases.push({
      name: gameName,
      roms,
      category,
      publisher,
      serial,
    });
  }

  const isNoIntroArchiveXml =
    headerUrl.toLowerCase().includes('no-intro') || hasArchiveAttr;
  if (isNoIntroArchiveXml) {
    releases.sort((a, b) => {
      const aNonEn = hasNonEnglishOnlyLanguageTag(a.name) ? 1 : 0;
      const bNonEn = hasNonEnglishOnlyLanguageTag(b.name) ? 1 : 0;
      if (aNonEn !== bNonEn) return aNonEn - bNonEn;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
  }

  return {
    platformName,
    releases,
  };
}

function parseClrMameProDat(fileContent: string): DatFileContent {
  let platformName = 'Unknown Platform';
  const headerMatch = fileContent.match(/clrmamepro\s*\(\s*name\s*"([^"]+)"/i);
  if (headerMatch) {
    platformName = headerMatch[1];
  }

  const releases: DatRelease[] = [];
  const gameBlocks = fileContent.split(/(?=game\s*\()/gi);

  for (const block of gameBlocks) {
    const nameMatch = block.match(/name\s*"([^"]+)"/i);
    if (!nameMatch) continue;

    const gameName = nameMatch[1].trim();
    if (gameName.includes('[BIOS]') || UNOFFICIAL_RELEASE_RE.test(gameName)) {
      continue;
    }

    const gameSerialMatch = block.match(/(?:^|\n|\r)\s*serial\s*"([^"]+)"/i);
    const gameSerial = gameSerialMatch ? gameSerialMatch[1].trim() : undefined;
    const gameCategoryMatch = block.match(
      /(?:^|\n|\r)\s*category\s+"([^"]+)"/i,
    );
    const gameCategory = gameCategoryMatch
      ? gameCategoryMatch[1].trim()
      : undefined;

    const romMatches = block.matchAll(
      /rom\s*\(\s*name\s*"([^"]+)"(?:\s+size\s+(\d+))?(?:\s+crc\s+([a-f0-9]+))?(?:\s+md5\s+([a-f0-9]+))?(?:\s+sha1\s+([a-f0-9]+))?(?:[^)]*serial\s*"([^"]+)")?/gi,
    );

    const roms: DatRom[] = [];
    for (const match of romMatches) {
      const romName = match[1].trim();
      if (UNOFFICIAL_RELEASE_RE.test(romName)) continue;
      if (romName.toLowerCase().endsWith('.v64')) continue;

      roms.push({
        name: romName,
        size: match[2] ? Number(match[2]) : 0,
        crc: match[3] ? match[3].toLowerCase() : undefined,
        md5: match[4] ? match[4].toLowerCase() : undefined,
        sha1: match[5] ? match[5].toLowerCase() : undefined,
        serial: match[6] ? match[6].trim() : undefined,
      });
    }

    if (roms.length > 0) {
      releases.push({
        name: gameName,
        roms,
        category: gameCategory,
        serial: gameSerial,
      });
    }
  }

  return { platformName, releases };
}
