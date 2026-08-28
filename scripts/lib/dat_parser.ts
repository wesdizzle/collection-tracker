/**
 * No-Intro & Redump XML DAT Parser
 *
 * This module uses 'fast-xml-parser' to parse DAT files and return
 * normalized structures representing physical releases (games) and their roms.
 */

import * as fs from 'fs';
import { XMLParser } from 'fast-xml-parser';

export interface DatRom {
  name: string;
  size: number;
  crc?: string;
  md5?: string;
  sha1?: string;
}

export interface DatRelease {
  name: string; // The game/release name in the DAT file
  roms: DatRom[];
}

export interface DatFileContent {
  platformName: string;
  releases: DatRelease[];
}

/**
 * Parses a No-Intro or Redump DAT file (XML or CLRMamePro format) and returns normalized content.
 *
 * @param filePath Path to the XML or CLRMamePro DAT file.
 * @returns Parsed and normalized DAT file content.
 * @throws Error if the DAT file cannot be read, or if the format is invalid.
 */
export function parseDatFile(filePath: string): DatFileContent {
  const fileContent = fs.readFileSync(filePath, 'utf-8');

  // Check if file is XML (<datafile>) or CLRMamePro plain text
  if (
    fileContent.includes('<datafile>') ||
    fileContent.trim().startsWith('<?xml')
  ) {
    return parseXmlDat(fileContent, filePath);
  } else if (
    fileContent.includes('clrmamepro') ||
    fileContent.includes('game (')
  ) {
    return parseClrMameProDat(fileContent);
  }

  throw new Error(
    `Invalid DAT file: ${filePath} is missing <datafile> root element and CLRMamePro header.`,
  );
}

function parseXmlDat(fileContent: string, filePath: string): DatFileContent {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: true,
    isArray: (name) => ['game', 'rom'].includes(name),
  });

  const parsed = parser.parse(fileContent);

  if (!parsed.datafile) {
    throw new Error(
      `Invalid DAT file: ${filePath} is missing <datafile> root element.`,
    );
  }

  const header = parsed.datafile.header || {};
  const platformName = header.name || 'Unknown Platform';
  const rawGames = parsed.datafile.game || [];

  const releases: DatRelease[] = [];
  const isUnofficialPattern =
    /\((unl|pirate|unlicensed|aftermarket|homebrew)\b/i;

  for (const rawGame of rawGames) {
    if (!rawGame.name) continue;
    const gameName = String(rawGame.name);

    // Filter out unofficial/pirate games at the release level
    if (isUnofficialPattern.test(gameName)) {
      continue;
    }

    const rawRoms = rawGame.rom || [];
    const roms: DatRom[] = [];

    for (const rawRom of rawRoms) {
      if (!rawRom.name) continue;
      const romName = String(rawRom.name);

      // Skip unofficial/pirate ROMs or byte-swapped N64 format (.v64)
      if (isUnofficialPattern.test(romName)) {
        continue;
      }
      if (romName.toLowerCase().endsWith('.v64')) {
        continue;
      }

      roms.push({
        name: romName,
        size: rawRom.size,
        crc: rawRom.crc ? String(rawRom.crc).toLowerCase() : undefined,
        md5: rawRom.md5 ? String(rawRom.md5).toLowerCase() : undefined,
        sha1: rawRom.sha1 ? String(rawRom.sha1).toLowerCase() : undefined,
      });
    }

    // Skip the release if it contains no valid ROMs after filtering
    if (roms.length === 0) {
      continue;
    }

    releases.push({
      name: gameName,
      roms,
    });
  }

  return {
    platformName,
    releases,
  };
}

function parseClrMameProDat(fileContent: string): DatFileContent {
  const isUnofficialPattern =
    /\((unl|pirate|unlicensed|aftermarket|homebrew)\b/i;

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
    if (isUnofficialPattern.test(gameName)) {
      continue;
    }

    const romMatches = block.matchAll(
      /rom\s*\(\s*name\s*"([^"]+)"(?:\s+size\s+(\d+))?(?:\s+crc\s+([a-f0-9]+))?(?:\s+md5\s+([a-f0-9]+))?(?:\s+sha1\s+([a-f0-9]+))?/gi,
    );

    const roms: DatRom[] = [];
    for (const match of romMatches) {
      const romName = match[1].trim();
      if (isUnofficialPattern.test(romName)) continue;
      if (romName.toLowerCase().endsWith('.v64')) continue;

      roms.push({
        name: romName,
        size: match[2] ? Number(match[2]) : 0,
        crc: match[3] ? match[3].toLowerCase() : undefined,
        md5: match[4] ? match[4].toLowerCase() : undefined,
        sha1: match[5] ? match[5].toLowerCase() : undefined,
      });
    }

    if (roms.length > 0) {
      releases.push({
        name: gameName,
        roms,
      });
    }
  }

  return { platformName, releases };
}
