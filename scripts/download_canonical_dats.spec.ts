/**
 * Unit Tests for Canonical DAT Downloader Utility
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  REDUMP_TARGETS,
  REDUMP_WIP_TARGETS,
  NO_INTRO_TARGETS,
  downloadRedumpDat,
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
    expect(noIntroFiles).toContain('Nintendo - Nintendo Switch.dat');
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

  it('should automatically fetch, convert, and save Nintendo Switch XML from NSWDB into Logiqx DAT', async () => {
    const mockNswdbXml = `<?xml version="1.0"?>
<releases>
  <release>
    <id>1</id>
    <name>The Legend of Zelda: Breath of the Wild</name>
    <publisher>Nintendo</publisher>
    <region>WLD</region>
    <serial>LA-H-AAAAA</serial>
    <imgcrc>5DD119C1</imgcrc>
    <trimmedsize>14880118272</trimmedsize>
    <type>1</type>
  </release>
</releases>`;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => mockNswdbXml,
    });
    vi.stubGlobal('fetch', mockFetch);

    const switchTarget = NO_INTRO_TARGETS.find(
      (t) => t.name === 'Nintendo Switch',
    )!;
    expect(switchTarget).toBeDefined();

    const result = await downloadNoIntroDat(switchTarget, tempTestDir);
    expect(result.success).toBe(true);
    expect(result.fileName).toBe('Nintendo - Nintendo Switch.dat');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://nswdb.com/xml.php',
      expect.any(Object),
    );

    const savedPath = path.join(tempTestDir, result.fileName!);
    expect(fs.existsSync(savedPath)).toBe(true);
    const content = fs.readFileSync(savedPath, 'utf8');
    expect(content).toContain('<datafile>');
    expect(content).toContain(
      '<game name="The Legend of Zelda - Breath of the Wild (World)">',
    );
  });

  it('should preserve existing Nintendo Switch DAT if network request fails', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    vi.stubGlobal('fetch', mockFetch);

    const switchTarget = NO_INTRO_TARGETS.find(
      (t) => t.name === 'Nintendo Switch',
    )!;

    // Simulate pre-existing Switch DAT file
    const preExistingPath = path.join(
      tempTestDir,
      'Nintendo - Nintendo Switch.dat',
    );
    fs.writeFileSync(
      preExistingPath,
      '<datafile><game name="Pre-existing Game (World)"/></datafile>',
      'utf8',
    );

    const result = await downloadNoIntroDat(switchTarget, tempTestDir);
    expect(result.success).toBe(true);
    expect(result.fileName).toBe('Nintendo - Nintendo Switch.dat');
    expect(fs.existsSync(preExistingPath)).toBe(true);
  });

  it('should fetch and save canonical PlayStation Vita PSVgameSD releases directly from mirror', async () => {
    const mockPsvXml = `<?xml version="1.0"?>
<datafile>
  <header>
    <name>Unofficial - Sony - PlayStation Vita (PSVgameSD)</name>
  </header>
  <game name="Assassin's Creed III - Liberation (USA)" id="z043">
    <description>Assassin's Creed III - Liberation (USA)</description>
    <game_id>PCSE00053</game_id>
    <rom name="Assassin's Creed III - Liberation (USA).psv" size="3791650816" crc="06fed7b3" serial="PCSE-00053"/>
  </game>
</datafile>`;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => mockPsvXml,
    });
    vi.stubGlobal('fetch', mockFetch);

    const vitaTarget = NO_INTRO_TARGETS.find(
      (t) => t.name === 'PlayStation Vita',
    )!;
    expect(vitaTarget).toBeDefined();

    const result = await downloadNoIntroDat(vitaTarget, tempTestDir);
    expect(result.success).toBe(true);
    expect(result.fileName).toBe('Sony - PlayStation Vita (PSVgameSD).dat');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://data.spludlow.co.uk/no-intro/unofficial/Unofficial%20-%20Sony%20-%20PlayStation%20Vita%20(PSVgameSD).xml',
      expect.any(Object),
    );

    const savedPath = path.join(tempTestDir, result.fileName!);
    expect(fs.existsSync(savedPath)).toBe(true);
    const content = fs.readFileSync(savedPath, 'utf8');
    expect(content).toContain('<datafile>');
    expect(content).toContain("Assassin's Creed III - Liberation (USA)");
    expect(content).toContain(
      'rom name="Assassin\'s Creed III - Liberation (USA).psv"',
    );
    expect(content).toContain('crc="06fed7b3"');
  });

  it('should preserve existing PlayStation Vita DAT if network request fails', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    vi.stubGlobal('fetch', mockFetch);

    const vitaTarget = NO_INTRO_TARGETS.find(
      (t) => t.name === 'PlayStation Vita',
    )!;

    const preExistingPath = path.join(
      tempTestDir,
      'Sony - PlayStation Vita (PSVgameSD).dat',
    );
    fs.writeFileSync(
      preExistingPath,
      '<datafile><game name="Pre-existing Vita Game (USA)"><rom name="Pre-existing.psv" crc="12345678"/></game></datafile>',
      'utf8',
    );

    const result = await downloadNoIntroDat(vitaTarget, tempTestDir);
    expect(result.success).toBe(true);
    expect(result.fileName).toBe('Sony - PlayStation Vita (PSVgameSD).dat');
    expect(fs.existsSync(preExistingPath)).toBe(true);
  });

  it('should define REDUMP_WIP_TARGETS for all modern optical disc consoles', () => {
    expect(REDUMP_WIP_TARGETS.length).toBe(5);
    const slugs = REDUMP_WIP_TARGETS.map((t) => t.slug);
    expect(slugs).toContain('wiiu');
    expect(slugs).toContain('ps4');
    expect(slugs).toContain('ps5');
    expect(slugs).toContain('xbone');
    expect(slugs).toContain('xsx');
  });

  it('should preserve existing local DAT file when Redump returns 404 for WIP platform', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });
    vi.stubGlobal('fetch', mockFetch);

    const wiiuTarget = REDUMP_WIP_TARGETS.find((t) => t.slug === 'wiiu')!;
    const preExistingPath = path.join(
      tempTestDir,
      'Nintendo - Wii U - Datfile (541).dat',
    );
    fs.writeFileSync(
      preExistingPath,
      '<datafile><game name="Pre-existing Wii U Game"/></datafile>',
      'utf8',
    );

    const result = await downloadRedumpDat(wiiuTarget, tempTestDir);
    expect(result.success).toBe(true);
    expect(result.fileName).toBe('Nintendo - Wii U - Datfile (541).dat');
  });

  it('should fetch and save canonical PlayStation Vita NoNpDrm releases directly from mirror', async () => {
    const mockNonpdrmXml = `<?xml version="1.0"?>
<datafile>
  <header>
    <name>Unofficial - Sony - PlayStation Vita (NoNpDrm)</name>
  </header>
  <game name="Bloodstained - Curse of the Moon (USA)" id="z100">
    <description>Bloodstained - Curse of the Moon (USA)</description>
    <game_id>PCSE01270</game_id>
    <rom name="PCSE01270\\\\eboot.bin" size="5000000" crc="aabbccdd" serial="PCSE-01270"/>
  </game>
</datafile>`;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => mockNonpdrmXml,
    });
    vi.stubGlobal('fetch', mockFetch);

    const nonpdrmTarget = NO_INTRO_TARGETS.find(
      (t) => t.name === 'PlayStation Vita (NoNpDrm)',
    )!;
    expect(nonpdrmTarget).toBeDefined();

    const result = await downloadNoIntroDat(nonpdrmTarget, tempTestDir);
    expect(result.success).toBe(true);
    expect(result.fileName).toBe('Sony - PlayStation Vita (NoNpDrm).dat');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://data.spludlow.co.uk/no-intro/unofficial/Unofficial%20-%20Sony%20-%20PlayStation%20Vita%20(NoNpDrm).xml',
      expect.any(Object),
    );

    const savedPath = path.join(tempTestDir, result.fileName!);
    expect(fs.existsSync(savedPath)).toBe(true);
    const content = fs.readFileSync(savedPath, 'utf8');
    expect(content).toContain('<datafile>');
    expect(content).toContain('Bloodstained - Curse of the Moon (USA)');
  });

  it('should preserve existing PlayStation Vita NoNpDrm DAT if network request fails', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    vi.stubGlobal('fetch', mockFetch);

    const nonpdrmTarget = NO_INTRO_TARGETS.find(
      (t) => t.name === 'PlayStation Vita (NoNpDrm)',
    )!;
    const preExistingPath = path.join(
      tempTestDir,
      'Sony - PlayStation Vita (NoNpDrm).dat',
    );
    fs.writeFileSync(
      preExistingPath,
      '<datafile><game name="Pre-existing NoNpDrm Game"/></datafile>',
      'utf8',
    );

    const result = await downloadNoIntroDat(nonpdrmTarget, tempTestDir);
    expect(result.success).toBe(true);
    expect(result.fileName).toBe('Sony - PlayStation Vita (NoNpDrm).dat');
    expect(fs.existsSync(preExistingPath)).toBe(true);
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

    it('should preserve Nintendo Switch DAT files and migrate loose files from root dats dir', () => {
      const testNoIntro = path.join(tempTestDir, 'No-Intro');
      fs.mkdirSync(testNoIntro, { recursive: true });

      // Place a manual Switch DAT directly in No-Intro
      fs.writeFileSync(
        path.join(
          testNoIntro,
          'Nintendo - Nintendo Switch (20260401-120000).dat',
        ),
        'clrmamepro ( name "Nintendo - Nintendo Switch" )',
        'utf8',
      );

      // Place a loose No-Intro DAT in the root dats directory
      fs.writeFileSync(
        path.join(tempTestDir, 'Nintendo - Game Boy.dat'),
        'clrmamepro ( name "Nintendo - Game Boy" )',
        'utf8',
      );

      const result = pruneAndDeduplicateDats(tempTestDir);
      expect(result.renamedCount).toBeGreaterThanOrEqual(1);

      // Verify loose file was migrated into No-Intro
      expect(
        fs.existsSync(path.join(tempTestDir, 'Nintendo - Game Boy.dat')),
      ).toBe(false);
      expect(
        fs.existsSync(path.join(testNoIntro, 'Nintendo - Game Boy.dat')),
      ).toBe(true);

      // Verify Switch file was NOT pruned, but rather normalized to canonical name
      expect(
        fs.existsSync(path.join(testNoIntro, 'Nintendo - Nintendo Switch.dat')),
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(
            testNoIntro,
            'Nintendo - Nintendo Switch (20260401-120000).dat',
          ),
        ),
      ).toBe(false);
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
