import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseDatFile } from './dat_parser.js';

describe('DAT Parser', () => {
  let tempDir: string;
  let xmlPath: string;
  let clrPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dat-parser-test-'));
    xmlPath = path.join(tempDir, 'test.xml');
    clrPath = path.join(tempDir, 'test.dat');
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should parse XML DAT files and preserve leading zeros on hex CRCs', () => {
    const xml = `<?xml version="1.0"?>
<datafile>
  <header>
    <name>Nintendo - Game Boy</name>
  </header>
  <game name="Super Mario Land (World)">
    <description>Super Mario Land (World)</description>
    <rom name="Super Mario Land (World).gb" size="65536" crc="01234567" />
  </game>
  <game name="Bootleg Game (Unl)">
    <description>Bootleg Game (Unl)</description>
    <rom name="Bootleg.gb" size="32768" crc="89abcdef" />
  </game>
</datafile>`;
    fs.writeFileSync(xmlPath, xml, 'utf-8');

    const result = parseDatFile(xmlPath);
    expect(result).not.toBeNull();
    expect(result?.platformName).toBe('Nintendo - Game Boy');
    expect(result?.releases).toHaveLength(1);
    expect(result?.releases[0].name).toBe('Super Mario Land (World)');
    expect(result?.releases[0].romCrc).toBe('01234567');
  });

  it('should parse CLRMamePro DAT files accurately', () => {
    const clr = `clrmamepro (
  name "Sega - Mega Drive - Genesis"
  description "Sega - Mega Drive - Genesis"
)

game (
  name "Sonic The Hedgehog (USA, Europe)"
  description "Sonic The Hedgehog (USA, Europe)"
  rom ( name "Sonic The Hedgehog (USA, Europe).md" size 524288 crc 00abcdef md5 123456 )
)
`;
    fs.writeFileSync(clrPath, clr, 'utf-8');

    const result = parseDatFile(clrPath);
    expect(result).not.toBeNull();
    expect(result?.platformName).toBe('Sega - Mega Drive - Genesis');
    expect(result?.releases).toHaveLength(1);
    expect(result?.releases[0].name).toBe('Sonic The Hedgehog (USA, Europe)');
    expect(result?.releases[0].romCrc).toBe('00abcdef');
  });
});
