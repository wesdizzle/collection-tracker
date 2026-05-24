/**
 * Unit Tests for No-Intro & Redump XML DAT Parser
 *
 * This module contains test suites verifying XML parsing logic,
 * unofficial releases exclusion filters, byte-swapped N64 format filters,
 * and edge-case handling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseDatFile } from './dat_parser.js';

describe('DAT Parser', () => {
  const tempDir = path.join(process.cwd(), 'scripts', 'temp');
  const tempFilePath = path.join(tempDir, 'test_dat_file.dat');

  beforeEach(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  });

  it('should parse a No-Intro DAT file correctly', () => {
    const xml = `<?xml version="1.0"?>
<datafile>
    <header>
        <name>Nintendo - Game Boy</name>
        <description>Nintendo - Game Boy (Parent-Clone)</description>
    </header>
    <game name="Super Mario Land (World)">
        <description>Super Mario Land (World)</description>
        <rom name="Super Mario Land (World).gb" size="65536" crc="4616A6B2" md5="6d7c6b5b91b9f71c4c1a59b5d38865ea" sha1="d538e15467db5092a4e9b940989f66bbd58e3881"/>
    </game>
</datafile>`;

    fs.writeFileSync(tempFilePath, xml, 'utf-8');
    const result = parseDatFile(tempFilePath);

    expect(result.platformName).toBe('Nintendo - Game Boy');
    expect(result.releases).toHaveLength(1);
    expect(result.releases[0].name).toBe('Super Mario Land (World)');
    expect(result.releases[0].roms).toHaveLength(1);
    expect(result.releases[0].roms[0].name).toBe('Super Mario Land (World).gb');
    expect(result.releases[0].roms[0].size).toBe(65536);
    expect(result.releases[0].roms[0].crc).toBe('4616a6b2');
    expect(result.releases[0].roms[0].md5).toBe(
      '6d7c6b5b91b9f71c4c1a59b5d38865ea',
    );
    expect(result.releases[0].roms[0].sha1).toBe(
      'd538e15467db5092a4e9b940989f66bbd58e3881',
    );
  });

  it('should handle multiple games and multiple roms', () => {
    const xml = `<?xml version="1.0"?>
<datafile>
    <header>
        <name>Sega - Saturn</name>
    </header>
    <game name="Sonic R (USA)">
        <rom name="Sonic R (USA) (Track 1).bin" size="1000" crc="AAAA1111"/>
        <rom name="Sonic R (USA) (Track 2).bin" size="2000" crc="BBBB2222"/>
    </game>
    <game name="Nights into Dreams... (USA)">
        <rom name="Nights into Dreams... (USA).bin" size="5000" crc="CCCC3333"/>
    </game>
</datafile>`;

    fs.writeFileSync(tempFilePath, xml, 'utf-8');
    const result = parseDatFile(tempFilePath);

    expect(result.releases).toHaveLength(2);

    const sonic = result.releases[0];
    expect(sonic.name).toBe('Sonic R (USA)');
    expect(sonic.roms).toHaveLength(2);
    expect(sonic.roms[0].name).toBe('Sonic R (USA) (Track 1).bin');
    expect(sonic.roms[0].crc).toBe('aaaa1111');
    expect(sonic.roms[1].name).toBe('Sonic R (USA) (Track 2).bin');
    expect(sonic.roms[1].crc).toBe('bbbb2222');

    const nights = result.releases[1];
    expect(nights.name).toBe('Nights into Dreams... (USA)');
    expect(nights.roms).toHaveLength(1);
    expect(nights.roms[0].name).toBe('Nights into Dreams... (USA).bin');
    expect(nights.roms[0].crc).toBe('cccc3333');
  });

  it('should filter out unofficial and byte-swapped N64 ROM releases', () => {
    const xml = `<?xml version="1.0"?>
<datafile>
    <header>
        <name>Nintendo - Nintendo 64</name>
    </header>
    <game name="Pokemon Gold (Taiwan) (En) (Unl)">
        <rom name="Pokemon Gold (Taiwan) (En) (Unl).gbc" size="1000" crc="AAAA1111"/>
    </game>
    <game name="Super Mario 64 (USA)">
        <rom name="Super Mario 64 (USA).z64" size="2000" crc="BBBB2222"/>
    </game>
    <game name="Legend of Zelda, The - Ocarina of Time (USA) (Proto)">
        <rom name="Legend of Zelda, The - Ocarina of Time (USA) (Proto).v64" size="3000" crc="CCCC3333"/>
    </game>
    <game name="Turok - Dinosaur Hunter (USA) (Pirate)">
        <rom name="Turok - Dinosaur Hunter (USA) (Pirate).z64" size="4000" crc="DDDD4444"/>
    </game>
</datafile>`;

    fs.writeFileSync(tempFilePath, xml, 'utf-8');
    const result = parseDatFile(tempFilePath);

    // We expect only "Super Mario 64 (USA)" to remain.
    // - Pokemon Gold gets filtered out because of "(Unl)"
    // - Legend of Zelda gets filtered out because of ".v64" extension
    // - Turok gets filtered out because of "(Pirate)"
    expect(result.releases).toHaveLength(1);
    expect(result.releases[0].name).toBe('Super Mario 64 (USA)');
    expect(result.releases[0].roms[0].name).toBe('Super Mario 64 (USA).z64');
  });

  it('should throw error on invalid DAT file missing datafile root', () => {
    const xml = `<?xml version="1.0"?>
<invalid>
    <header><name>Invalid</name></header>
</invalid>`;
    fs.writeFileSync(tempFilePath, xml, 'utf-8');
    expect(() => parseDatFile(tempFilePath)).toThrow();
  });
});
