import { describe, it, expect } from 'vitest';
import { extractDatHeaderName, parseDatContent } from './dat_parser.js';

describe('shared/dat_parser (streaming DAT parser)', () => {
  it('parses XML DAT releases, attributes, entities, and preserves leading-zero CRCs', () => {
    const xml = `<?xml version="1.0"?>
<datafile>
  <header>
    <name>Sony - PlayStation 4</name>
    <url>https://redump.org/</url>
  </header>
  <game name="Doom &amp; Quake &amp; Wolfenstein (USA)">
    <category>Games</category>
    <publisher>Bethesda</publisher>
    <serial>CUSA-12345</serial>
    <rom name="Doom &amp; Quake &amp; Wolfenstein (USA).iso" size="1048576" crc="07436316" md5="abcd" sha1="ef01" serial="CUSA-12345"/>
  </game>
  <game name="Device (USA)" isdevice="yes">
    <rom name="dev.iso" size="100" crc="11112222"/>
  </game>
</datafile>`;

    const parsed = parseDatContent(xml, 'ps4.dat');
    expect(parsed.platformName).toBe('Sony - PlayStation 4');
    expect(parsed.releases).toHaveLength(1);
    expect(parsed.releases[0].name).toBe('Doom & Quake & Wolfenstein (USA)');
    expect(parsed.releases[0].category).toBe('Games');
    expect(parsed.releases[0].publisher).toBe('Bethesda');
    expect(parsed.releases[0].serial).toBe('CUSA-12345');
    expect(parsed.releases[0].roms[0].crc).toBe('07436316');
    expect(parsed.releases[0].roms[0].serial).toBe('CUSA-12345');
  });

  it('sorts Datomatic No-Intro archive XMLs preferring English-inclusive releases first', () => {
    const xml = `<?xml version="1.0"?>
<datafile>
  <header>
    <name>Nintendo - Game Boy Advance</name>
    <url>https://datomatic.no-intro.org/</url>
  </header>
  <game name="Zelda (Japan)" archive="10">
    <rom name="Zelda (Japan).gba" size="1000" crc="aaaaaaaa"/>
  </game>
  <game name="Advance Wars (Fr)" archive="11">
    <rom name="Advance Wars (Fr).gba" size="1000" crc="bbbbbbbb"/>
  </game>
  <game name="Metroid Fusion (USA)" archive="12">
    <rom name="Metroid Fusion (USA).gba" size="1000" crc="cccccccc"/>
  </game>
</datafile>`;

    const parsed = parseDatContent(xml);
    expect(parsed.releases.map((r) => r.name)).toEqual([
      'Metroid Fusion (USA)',
      'Zelda (Japan)',
      'Advance Wars (Fr)',
    ]);
  });

  it('handles large streaming XML payloads linearly without stack or DOM failures', () => {
    const chunks: string[] = [
      '<?xml version="1.0"?><datafile><header><name>Sony - PlayStation</name></header>',
    ];
    for (let i = 0; i < 12000; i++) {
      chunks.push(
        `<game name="Game ${i} (USA)"><rom name="Game ${i} (USA).bin" size="1024" crc="0000${i.toString(16).padStart(4, '0')}"/></game>`,
      );
    }
    chunks.push('</datafile>');
    const parsed = parseDatContent(chunks.join('\n'));
    expect(parsed.releases).toHaveLength(12000);
    expect(parsed.releases[11999].name).toBe('Game 11999 (USA)');
  });

  it('extracts DAT header names cleanly from XML and CLRMamePro headers', () => {
    expect(
      extractDatHeaderName(
        '<datafile><header><name>Atari - Atari Jaguar (ROM)</name></header>',
      ),
    ).toBe('Atari - Atari Jaguar (ROM)');
    expect(
      extractDatHeaderName(
        'clrmamepro (\n\tname "Sega - Mega Drive - Genesis"\n)',
      ),
    ).toBe('Sega - Mega Drive - Genesis');
  });
});
