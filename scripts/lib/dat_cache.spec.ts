/**
 * @file dat_cache.spec.ts
 * @description Unit tests for the platform-level DAT release caching layer.
 * Validates platform string matching, region/variant parsing, and JSON cache serialization.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import {
  isPlatformMatch,
  extractRegions,
  extractVariants,
  isIgnoredFormatRelease,
  getPlatformDatReleases,
} from './dat_cache.js';

describe('DAT Cache', () => {
  let mockDb: Database.Database;
  const tempDir = path.join(process.cwd(), 'scripts', 'temp');
  const datsDir = path.join(process.cwd(), 'dats');
  const testDatPath = path.join(
    datsDir,
    'Nintendo - Game Boy Advance - Datfile (Test).xml',
  );

  beforeEach(() => {
    // Set up in-memory database for testing platforms
    mockDb = new Database(':memory:');
    mockDb.exec(`
      CREATE TABLE platforms (
        id INTEGER PRIMARY KEY,
        name TEXT,
        display_name TEXT
      );
    `);

    // Ensure the directories exist
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    if (!fs.existsSync(datsDir)) {
      fs.mkdirSync(datsDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up created files
    if (fs.existsSync(testDatPath)) {
      fs.unlinkSync(testDatPath);
    }
    const cacheFile = path.join(tempDir, 'dat_cache_24.json');
    if (fs.existsSync(cacheFile)) {
      fs.unlinkSync(cacheFile);
    }
    mockDb.close();
  });

  describe('isPlatformMatch', () => {
    it('should match standard platform names exactly or by cleaned name', () => {
      const platform = {
        id: 24,
        name: 'Game Boy Advance',
        display_name: 'Game Boy Advance',
      };
      expect(isPlatformMatch('Nintendo - Game Boy Advance', platform)).toBe(
        true,
      );
      expect(isPlatformMatch('Game Boy Advance (Parent-Clone)', platform)).toBe(
        true,
      );
    });

    it('should handle custom mapping overrides correctly', () => {
      const gbaPlatform = {
        id: 24,
        name: 'Game Boy Advance',
        display_name: 'Game Boy Advance',
      };
      expect(isPlatformMatch('Nintendo - Game Boy Advance', gbaPlatform)).toBe(
        true,
      );

      const genesisPlatform = {
        id: 29,
        name: 'Sega Genesis',
        display_name: 'Sega Genesis',
      };
      expect(
        isPlatformMatch('Sega - Mega Drive - Genesis', genesisPlatform),
      ).toBe(true);
    });

    it('should return false for mismatched platforms', () => {
      const platform = {
        id: 24,
        name: 'Game Boy Advance',
        display_name: 'Game Boy Advance',
      };
      expect(isPlatformMatch('Nintendo - Game Boy Color', platform)).toBe(
        false,
      );
    });
  });

  describe('extractRegions', () => {
    it('should parse USA and Europe region codes correctly', () => {
      expect(
        extractRegions('Sonic Advance (USA, Europe) (En,Fr,De,Es,It)'),
      ).toBe('USA, Europe');
      expect(extractRegions('Pokemon Ruby (Japan)')).toBe('Japan');
    });

    it('should return null if no region matches are found', () => {
      expect(extractRegions('Custom Homebrew Game (Demo)')).toBeNull();
    });
  });

  describe('extractVariants', () => {
    it('should parse revision and beta variants correctly', () => {
      expect(extractVariants('Super Mario Advance (USA) (Rev 1)')).toBe(
        'Rev 1',
      );
      expect(extractVariants('Metroid Fusion (USA) (Beta)')).toBe('Beta');
    });

    it('should filter out languages and regions from variant extraction', () => {
      expect(extractVariants('Sonic Advance (USA) (En,Fr,De)')).toBeNull();
    });
  });

  describe('isIgnoredFormatRelease', () => {
    it('should ignore blacklisted extensions', () => {
      expect(isIgnoredFormatRelease('Game', 'game.pkg')).toBe(true);
      expect(isIgnoredFormatRelease('Game', 'game.unh')).toBe(true);
      expect(isIgnoredFormatRelease('Game', 'game.gba')).toBe(false);
    });

    it('should enforce Vita .psv constraint on platform 33', () => {
      expect(isIgnoredFormatRelease('Game', 'game.bin', 33)).toBe(true);
      expect(isIgnoredFormatRelease('Game', 'game.psv', 33)).toBe(false);
    });
  });

  describe('getPlatformDatReleases', () => {
    it('should load XML DAT and generate JSON cache on demand', () => {
      // 1. Seed the GBA platform in mock database
      mockDb
        .prepare(
          'INSERT INTO platforms (id, name, display_name) VALUES (?, ?, ?)',
        )
        .run(24, 'Game Boy Advance', 'Game Boy Advance');

      // 2. Create a mock GBA XML DAT file
      const xmlContent = `<?xml version="1.0"?>
<datafile>
    <header>
        <name>Nintendo - Game Boy Advance</name>
        <description>Nintendo - Game Boy Advance (Parent-Clone)</description>
    </header>
    <game name="Super Mario Advance (USA, Europe)">
        <description>Super Mario Advance (USA, Europe)</description>
        <rom name="Super Mario Advance (USA, Europe).gba" size="4194304" crc="1234abcd"/>
    </game>
</datafile>`;
      fs.writeFileSync(testDatPath, xmlContent, 'utf-8');

      // 3. Trigger cache retrieval/compilation
      const releases = getPlatformDatReleases(mockDb, 24);

      expect(releases).toHaveLength(1);
      expect(releases[0].name).toBe('Super Mario Advance (USA, Europe)');
      expect(releases[0].romName).toBe('Super Mario Advance (USA, Europe).gba');
      expect(releases[0].romCrc).toBe('1234abcd');
      expect(releases[0].region).toBe('USA, Europe');

      // 4. Verify that the JSON cache file was generated
      const cacheFile = path.join(tempDir, 'dat_cache_24.json');
      expect(fs.existsSync(cacheFile)).toBe(true);

      const cachedRaw = fs.readFileSync(cacheFile, 'utf8');
      const cachedData = JSON.parse(cachedRaw);
      expect(cachedData).toHaveLength(1);
      expect(cachedData[0].name).toBe('Super Mario Advance (USA, Europe)');
    });
  });
});
