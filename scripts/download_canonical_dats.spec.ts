/**
 * Unit Tests for Canonical DAT Downloader Utility
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  REDUMP_TARGETS,
  NO_INTRO_TARGETS,
  downloadNoIntroDat,
  applyCanonicalDatPatches,
  pruneAndDeduplicateDats,
  syncCleanDatsToDirectory,
} from './download_canonical_dats.js';

describe('Canonical DAT Downloader', () => {
  const tempTestDir = path.join(process.cwd(), 'scripts', 'temp', 'test_dats');

  beforeEach(() => {
    if (!fs.existsSync(tempTestDir)) {
      fs.mkdirSync(tempTestDir, { recursive: true });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(tempTestDir)) {
      try {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
      } catch {
        // Ignore test directory cleanup error
      }
    }
  });

  it('should define comprehensive targets for all major tracked platforms', () => {
    expect(REDUMP_TARGETS.length).toBeGreaterThanOrEqual(15);
    expect(NO_INTRO_TARGETS.length).toBeGreaterThanOrEqual(25);

    // Verify key platforms exist in targets
    const redumpSlugs = REDUMP_TARGETS.map((t) => t.slug);
    expect(redumpSlugs).toContain('psx');
    expect(redumpSlugs).toContain('ps2');
    expect(redumpSlugs).toContain('gc');
    expect(redumpSlugs).toContain('wii');
    expect(redumpSlugs).toContain('xbox');

    const noIntroFiles = NO_INTRO_TARGETS.map((t) => t.remoteFileName);
    expect(noIntroFiles).toContain('Nintendo - Game Boy Advance.dat');
    expect(noIntroFiles).toContain('Nintendo - Nintendo 64.dat');
    expect(noIntroFiles).toContain('Sega - Mega Drive - Genesis.dat');
  });

  it('should download and save a valid No-Intro XML DAT file', async () => {
    const mockXml = `<?xml version="1.0"?>
<datafile>
    <header>
        <name>Nintendo - Game Boy Advance</name>
        <description>Nintendo - Game Boy Advance (Parent-Clone)</description>
    </header>
    <game name="Metroid Fusion (USA)">
        <description>Metroid Fusion (USA)</description>
        <rom name="Metroid Fusion (USA).gba" size="8388608" crc="d50041da"/>
    </game>
</datafile>`;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => mockXml,
    });
    vi.stubGlobal('fetch', mockFetch);

    const target = NO_INTRO_TARGETS.find((t) =>
      t.remoteFileName.includes('Game Boy Advance'),
    )!;
    const result = await downloadNoIntroDat(target, tempTestDir);

    expect(result.success).toBe(true);
    expect(result.fileName).toBe('Nintendo - Game Boy Advance.dat');
    const savedPath = path.join(tempTestDir, result.fileName!);
    expect(fs.existsSync(savedPath)).toBe(true);
    expect(fs.readFileSync(savedPath, 'utf8')).toContain(
      'Metroid Fusion (USA)',
    );
  });

  it('should reject invalid or non-datafile responses gracefully', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<html><body>404 Not Found</body></html>',
    });
    vi.stubGlobal('fetch', mockFetch);

    const target = NO_INTRO_TARGETS[0];
    const result = await downloadNoIntroDat(target, tempTestDir);

    expect(result.success).toBe(false);
    expect(result.error).toContain('not a valid No-Intro datafile');
  });

  it('should handle HTTP error responses gracefully without throwing', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    });
    vi.stubGlobal('fetch', mockFetch);

    const target = NO_INTRO_TARGETS[0];
    const result = await downloadNoIntroDat(target, tempTestDir);

    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 503 Service Unavailable');
  });

  describe('applyCanonicalDatPatches', () => {
    it('should enrich CLRMamePro Sega Genesis DAT with the 2 MB standalone Sonic & Knuckles entry', () => {
      const input = `clrmamepro (
\tname "Sega - Mega Drive - Genesis"
)
game (
\tname "Sonic & Knuckles (World)"
\trom ( name "Sonic & Knuckles (World) (Lock-on).bin" size 262144 crc 4DCFD55C md5 B4E76E416B887F4E7413BA76FA735F16 sha1 70429F1D80503A0632F603BF762FE0BBAA881D22 )
)`;

      const output = applyCanonicalDatPatches(
        input,
        'Sega - Mega Drive - Genesis.dat',
      );

      expect(output).toContain('0658F691');
      expect(output).toContain('Sonic & Knuckles (World).md');
      expect(output).toContain('size 2097152');
      expect(output).toContain('Sonic & Knuckles (World) (Lock-on)');
      expect(output).toContain('4DCFD55C');
    });

    it('should enrich XML Sega Genesis DAT with the 2 MB standalone Sonic & Knuckles entry', () => {
      const input = `<datafile>
\t<game name="Sonic &amp; Knuckles (World)">
\t\t<rom name="Sonic &amp; Knuckles (World) (Lock-on).bin" size="262144" crc="4DCFD55C"/>
\t</game>
</datafile>`;

      const output = applyCanonicalDatPatches(
        input,
        'Sega - Mega Drive - Genesis.dat',
      );

      expect(output).toContain('0658F691');
      expect(output).toContain('Sonic &amp; Knuckles (World)');
      expect(output).toContain('Sonic &amp; Knuckles (World) (Lock-on)');
    });

    it('should enrich CLRMamePro Sega Genesis DAT with the physical Mega Man Wily Wars Retro-Bit dump', () => {
      const input = `clrmamepro (
\tname "Sega - Mega Drive - Genesis"
)
game (
\tname "Mega Man - The Wily Wars (World) (Retro-Bit)"
\tserial "T-12053-00"
\trom ( name "Mega Man - The Wily Wars (World) (Retro-Bit).md" size 2097152 crc 0831020B md5 FB4FC95CE806265417BB44EEC2ACA488 sha1 617BC1EE5F31F4215CF47C5337FA7CA0BCEB6A45 serial "T-12053-00" )
)`;

      const output = applyCanonicalDatPatches(
        input,
        'Sega - Mega Drive - Genesis.dat',
      );

      expect(output).toContain('0831020B');
      expect(output).toContain('92FD68E9');
      expect(output).toContain(
        'Mega Man - The Wily Wars (World) (Retro-Bit) (Alt)',
      );
      expect(output).toContain('17C07481AE7C8D69C38557A51F70E257BCE799EF');
    });

    it('should enrich XML Sega Genesis DAT with the physical Mega Man Wily Wars Retro-Bit dump', () => {
      const input = `<datafile>
\t<game name="Mega Man - The Wily Wars (World) (Retro-Bit)">
\t\t<rom name="Mega Man - The Wily Wars (World) (Retro-Bit).md" size="2097152" crc="0831020B"/>
\t</game>
</datafile>`;

      const output = applyCanonicalDatPatches(
        input,
        'Sega - Mega Drive - Genesis.dat',
      );

      expect(output).toContain('0831020B');
      expect(output).toContain('92FD68E9');
      expect(output).toContain(
        'Mega Man - The Wily Wars (World) (Retro-Bit) (Alt)',
      );
    });

    it('should normalize Atari platform headers so downstream IGIR creates canonical directories', () => {
      const clrInput = `clrmamepro (
\tname "Atari - 2600"
\tdescription "Atari - 2600"
)`;
      const clrOutput = applyCanonicalDatPatches(clrInput, 'Atari - 2600.dat');
      expect(clrOutput).toContain('name "Atari - Atari 2600"');
      expect(clrOutput).toContain('description "Atari - Atari 2600"');

      const xmlInput = `<datafile>
\t<header>
\t\t<name>Atari - 2600</name>
\t\t<description>Atari - 2600</description>
\t</header>
</datafile>`;
      const xmlOutput = applyCanonicalDatPatches(xmlInput, 'Atari - 2600.dat');
      expect(xmlOutput).toContain('<name>Atari - Atari 2600</name>');
      expect(xmlOutput).toContain(
        '<description>Atari - Atari 2600</description>',
      );

      const a78Xml = `<datafile><header><name>Atari - 7800</name></header></datafile>`;
      expect(applyCanonicalDatPatches(a78Xml, 'Atari - 7800.dat')).toContain(
        '<name>Atari - Atari 7800 (BIN)</name>',
      );
    });

    it('should leave unrelated platforms or already patched DATs intact', () => {
      const input = `game (
\tname "Metroid Fusion (USA)"
\trom ( name "Metroid Fusion (USA).gba" size 8388608 crc D50041DA )
)`;
      const output = applyCanonicalDatPatches(
        input,
        'Nintendo - Game Boy Advance.dat',
      );
      expect(output).toBe(input);
    });
  });

  describe('pruneAndDeduplicateDats', () => {
    it('should eliminate duplicate DATs, preserve official XML, and normalize filenames', () => {
      const testNoIntro = path.join(tempTestDir, 'No-Intro');
      fs.mkdirSync(testNoIntro, { recursive: true });

      // Create duplicate Atari 2600 files:
      // 1. Lower quality clrmamepro
      fs.writeFileSync(
        path.join(testNoIntro, 'Atari - 2600.dat'),
        'clrmamepro ( name "Atari - 2600" )',
        'utf8',
      );
      // 2. High quality Datomatic XML with timestamp in filename
      fs.writeFileSync(
        path.join(testNoIntro, 'Atari - Atari 2600 (20260517-054406).dat'),
        '<?xml version="1.0"?><datafile xmlns:xsi="https://datomatic.no-intro.org"><header><name>Atari - Atari 2600</name></header></datafile>',
        'utf8',
      );
      // 3. Untracked platform that should be pruned
      fs.writeFileSync(
        path.join(testNoIntro, 'Casio - PV-1000.dat'),
        'clrmamepro ( name "Casio - PV-1000" )',
        'utf8',
      );
      // 4. Unwanted subfolder
      const unwantedSubdir = path.join(testNoIntro, 'Source Code');
      fs.mkdirSync(unwantedSubdir, { recursive: true });

      const result = pruneAndDeduplicateDats(tempTestDir);

      expect(result.removedCount).toBeGreaterThanOrEqual(2);
      const remainingFiles = fs.readdirSync(testNoIntro);
      expect(remainingFiles).toEqual(['Atari - Atari 2600.dat']);
      expect(fs.existsSync(unwantedSubdir)).toBe(false);

      const savedContent = fs.readFileSync(
        path.join(testNoIntro, 'Atari - Atari 2600.dat'),
        'utf8',
      );
      expect(savedContent).toContain('datomatic.no-intro.org');
    });
  });

  describe('syncCleanDatsToDirectory', () => {
    it('should mirror canonical files and clean obsolete/duplicate files in destination', () => {
      const srcDir = path.join(tempTestDir, 'src');
      const dstDir = path.join(tempTestDir, 'dst');
      const srcNoIntro = path.join(srcDir, 'No-Intro');
      const dstNoIntro = path.join(dstDir, 'No-Intro');

      fs.mkdirSync(srcNoIntro, { recursive: true });
      fs.mkdirSync(dstNoIntro, { recursive: true });

      // Source has 1 canonical DAT
      fs.writeFileSync(
        path.join(srcNoIntro, 'Nintendo - Game Boy.dat'),
        '<datafile><header><name>Nintendo - Game Boy</name></header></datafile>',
        'utf8',
      );

      // Destination has obsolete duplicate
      fs.writeFileSync(
        path.join(dstNoIntro, 'Nintendo - Game Boy (Old).dat'),
        'obsolete',
        'utf8',
      );

      const syncResult = syncCleanDatsToDirectory(srcDir, dstDir);

      expect(syncResult.copied).toBe(1);
      expect(syncResult.deleted).toBe(1);

      const dstFiles = fs.readdirSync(dstNoIntro);
      expect(dstFiles).toEqual(['Nintendo - Game Boy.dat']);
    });
  });
});
