/**
 * Unit Tests for Canonical Sources Fetcher Utility
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  REDUMP_TARGETS,
  REDUMP_WIP_TARGETS,
  NO_INTRO_TARGETS,
  downloadRedumpDat,
  downloadNoIntroDat,
  pruneAndDeduplicateDats,
  syncCleanDatsToDirectory,
  parseSourceFilterArg,
  fetchCanonicalSources,
} from './fetch_canonical_sources.js';

describe('Canonical Sources Fetcher', () => {
  let tempTestDir: string;

  beforeEach(() => {
    tempTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-sources-spec-'));
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
    expect(noIntroFiles).not.toContain('Nintendo - Nintendo Switch.dat');
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

  it('should not include Nintendo Switch in DAT download targets since it uses Nintendo Revised spreadsheet', () => {
    const switchTarget = NO_INTRO_TARGETS.find(
      (t) => t.name === 'Nintendo Switch',
    );
    expect(switchTarget).toBeUndefined();
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

  it('should reject HTML responses and extract zipped redump.info DAT archives cleanly', async () => {
    const htmlFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        new TextEncoder().encode('<html>System does not exist</html>').buffer,
    });
    vi.stubGlobal('fetch', htmlFetch);

    const xboneTarget = REDUMP_WIP_TARGETS.find((t) => t.slug === 'xbone')!;
    const htmlRes = await downloadRedumpDat(xboneTarget, tempTestDir);
    expect(htmlRes.success).toBe(false);
    expect(htmlFetch).toHaveBeenCalledWith(
      'https://redump.info/datfile/XBOXONE',
      expect.any(Object),
    );

    // Test real deflated ZIP extraction from redump.info
    const xmlText =
      '<datafile><header><name>Microsoft - Xbox One</name></header><game name="Tunic (USA)"><rom name="Tunic (USA).iso" size="1024" crc="11223344"/></game></datafile>';
    const raw = new TextEncoder().encode(xmlText);
    const deflated = new Uint8Array(
      await new Response(
        new Blob([raw])
          .stream()
          .pipeThrough(new CompressionStream('deflate-raw')),
      ).arrayBuffer(),
    );
    const entryName = new TextEncoder().encode(
      'Microsoft - Xbox One - Datfile (1210).dat',
    );
    const out: number[] = [];
    const u16 = (v: number) => out.push(v & 0xff, (v >> 8) & 0xff);
    const u32 = (v: number) =>
      out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
    u32(0x04034b50);
    u16(20);
    u16(0);
    u16(8);
    u16(0);
    u16(0);
    u32(0);
    u32(deflated.length);
    u32(raw.length);
    u16(entryName.length);
    u16(0);
    out.push(...entryName, ...deflated);
    const cdStart = out.length;
    u32(0x02014b50);
    u16(20);
    u16(20);
    u16(0);
    u16(8);
    u16(0);
    u16(0);
    u32(0);
    u32(deflated.length);
    u32(raw.length);
    u16(entryName.length);
    u16(0);
    u16(0);
    u16(0);
    u16(0);
    u32(0);
    u32(0);
    out.push(...entryName);
    const cdSize = out.length - cdStart;
    u32(0x06054b50);
    u16(0);
    u16(0);
    u16(1);
    u16(1);
    u32(cdSize);
    u32(cdStart);
    u16(0);
    const zipBuf = new Uint8Array(out);

    const zipFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => zipBuf.buffer,
    });
    vi.stubGlobal('fetch', zipFetch);

    const okRes = await downloadRedumpDat(xboneTarget, tempTestDir);
    expect(okRes.success).toBe(true);
    expect(okRes.fileName).toBe('Microsoft - Xbox One - Datfile (1210).dat');
    expect(
      fs.readFileSync(path.join(tempTestDir, okRes.fileName!), 'utf8'),
    ).toContain('Tunic (USA)');
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

  it('should fetch and save canonical PlayStation Vita PSVgameSD releases directly from mirror', async () => {
    const mockVitaXml = `<?xml version="1.0"?>
<datafile>
  <header>
    <name>Unofficial - Sony - PlayStation Vita (PSVgameSD)</name>
  </header>
  <game name="Persona 4 Golden (USA)" id="z100">
    <description>Persona 4 Golden (USA)</description>
    <game_id>PCSE00120</game_id>
    <rom name="Persona 4 Golden (USA).psv" size="3300000000" crc="12345678" serial="PCSE-00120"/>
  </game>
</datafile>`;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => mockVitaXml,
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
    expect(content).toContain('Persona 4 Golden (USA)');
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
      '<datafile><game name="Pre-existing Vita Game"/></datafile>',
      'utf8',
    );

    const result = await downloadNoIntroDat(vitaTarget, tempTestDir);
    expect(result.success).toBe(true);
    expect(result.fileName).toBe('Sony - PlayStation Vita (PSVgameSD).dat');
    expect(fs.existsSync(preExistingPath)).toBe(true);
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

    it('should clean up legacy Nintendo Switch DAT files and migrate loose files from root dats dir', () => {
      const testNoIntro = path.join(tempTestDir, 'No-Intro');
      fs.mkdirSync(testNoIntro, { recursive: true });

      // Place a legacy Switch DAT directly in No-Intro
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
      expect(result.removedCount).toBeGreaterThanOrEqual(1);

      // Verify loose file was migrated into No-Intro
      expect(
        fs.existsSync(path.join(tempTestDir, 'Nintendo - Game Boy.dat')),
      ).toBe(false);
      expect(
        fs.existsSync(path.join(testNoIntro, 'Nintendo - Game Boy.dat')),
      ).toBe(true);

      // Verify legacy Switch file was pruned
      expect(
        fs.existsSync(path.join(testNoIntro, 'Nintendo - Nintendo Switch.dat')),
      ).toBe(false);
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

  describe('parseSourceFilterArg & fetchCanonicalSources selective fetching', () => {
    it('parses --source filters and selectively fetches non-DAT adapters into isolated sourcesDir', async () => {
      expect(parseSourceFilterArg(undefined)).toEqual(['all']);
      expect(parseSourceFilterArg('nscollectors,ps5db')).toEqual([
        'nscollectors',
        'ps5db',
      ]);
      expect(() => parseSourceFilterArg('bogus')).toThrow(/Unknown source/);

      const mockFetch = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('neogeo.xml')) {
          return new Response(
            '<?xml version="1.0"?><softwarelist name="neogeo"><software name="nam1975"><description>NAM-1975 (NGM-001 ~ NGH-001)</description><publisher>SNK</publisher><sharedfeat name="release" value="MVS,AES" /></software></softwarelist>',
            { status: 200 },
          );
        }
        return new Response(
          'Title,Game Publisher,Physical Publisher,ESRB SKU\nAstro Bot,Sony Interactive Entertainment,Sony Interactive Entertainment,PPSA-21564\n',
          { status: 200 },
        );
      });

      const res = await fetchCanonicalSources({
        sources: parseSourceFilterArg('neogeo,ps5db'),
        sourcesDir: tempTestDir,
        fetchFn: mockFetch as typeof fetch,
      });

      expect(res.fetchedSources).toEqual(['neogeo', 'ps5db']);
      expect(fs.existsSync(path.join(tempTestDir, 'neogeo.xml'))).toBe(true);
      expect(fs.existsSync(path.join(tempTestDir, 'ps5db.csv'))).toBe(true);
    });
  });
});
