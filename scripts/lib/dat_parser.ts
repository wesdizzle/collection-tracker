/**
 * No-Intro & Redump XML DAT Parser
 *
 * This module uses 'fast-xml-parser' to parse DAT files and return
 * normalized structures representing physical releases (games) and their roms.
 */

import * as fs from 'fs';
import {
  type DatRom,
  type DatRelease,
  type DatFileContent,
  parseDatContent,
} from '../../shared/dat_parser.js';

export type { DatRom, DatRelease, DatFileContent };

/**
 * Parses a No-Intro or Redump DAT file (XML or CLRMamePro format) and returns normalized content.
 *
 * @param filePath Path to the XML or CLRMamePro DAT file.
 * @returns Parsed and normalized DAT file content.
 * @throws Error if the DAT file cannot be read, or if the format is invalid.
 */
export function parseDatFile(filePath: string): DatFileContent {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  return parseDatContent(fileContent, filePath);
}
