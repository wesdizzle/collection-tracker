import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import {
  stripEditionSuffix,
  selectBestRegionalCandidate,
  reconcileGameReleasesWithCanonical,
} from './reconcile_releases.js';

describe('reconcile_releases', () => {
  describe('stripEditionSuffix', () => {
    it('should strip common edition markers', () => {
      expect(stripEditionSuffix('Dragon Quest XI S: Definitive Edition')).toBe(
        'Dragon Quest XI S',
      );
      expect(stripEditionSuffix('Among Us: Crewmate Edition')).toBe('Among Us');
      expect(
        stripEditionSuffix('Xenoblade Chronicles: Definitive Edition'),
      ).toBe('Xenoblade Chronicles');
      expect(
        stripEditionSuffix('Mario Kart 8 Deluxe + Booster Course Pass'),
      ).toBe('Mario Kart 8 Deluxe');
      expect(
        stripEditionSuffix(
          'Pokémon Scarlet + The Hidden Treasure of Area Zero',
        ),
      ).toBe('Pokémon Scarlet');
    });

    it('should preserve standard titles without edition markers', () => {
      expect(stripEditionSuffix("Yoku's Island Express")).toBe(
        "Yoku's Island Express",
      );
      expect(stripEditionSuffix('Super Mario Odyssey')).toBe(
        'Super Mario Odyssey',
      );
    });
  });

  describe('selectBestRegionalCandidate', () => {
    const candidates = [
      { id: 1, region: 'Japan', rom_name: 'Game (Japan).xci' },
      { id: 2, region: 'World', rom_name: 'Game (World).xci' },
      { id: 3, region: 'Europe', rom_name: 'Game (Europe).xci' },
    ];

    it('should match exact region', () => {
      const match = selectBestRegionalCandidate(candidates, 'Europe');
      expect(match.id).toBe(3);
    });

    it('should fall back to World for USA if USA not present', () => {
      const match = selectBestRegionalCandidate(candidates, 'USA');
      expect(match.id).toBe(2);
    });

    it('should fall back to first candidate if no region specified', () => {
      const match = selectBestRegionalCandidate(candidates, null);
      expect(match.id).toBe(1);
    });
  });

  describe('reconcileGameReleasesWithCanonical', () => {
    let db: Database.Database;
    const testSqlPath = path.resolve('scripts/temp/test_reconcile_output.sql');

    beforeEach(() => {
      db = new Database(':memory:');
      db.exec(`
        CREATE TABLE platforms (id INTEGER PRIMARY KEY, name TEXT, parent_platform_id INTEGER);
        CREATE TABLE games (stable_id INTEGER PRIMARY KEY, title TEXT, platform_id INTEGER);
        CREATE TABLE game_releases (
          id TEXT PRIMARY KEY,
          game_id INTEGER,
          region TEXT,
          variants TEXT,
          rom_name TEXT,
          rom_crc TEXT,
          canonical_release_id INTEGER
        );
        CREATE TABLE canonical_releases (
          id INTEGER PRIMARY KEY,
          platform_id INTEGER,
          raw_title TEXT,
          normalized_title TEXT,
          region TEXT,
          variants TEXT,
          rom_name TEXT,
          rom_crc TEXT,
          source TEXT
        );

        INSERT INTO platforms (id, name, parent_platform_id) VALUES (26, 'Nintendo Switch', NULL);
        INSERT INTO platforms (id, name, parent_platform_id) VALUES (34, 'PlayStation 4', NULL);
        INSERT INTO platforms (id, name, parent_platform_id) VALUES (51, 'PlayStation VR', 34);

        INSERT INTO games (stable_id, title, platform_id) VALUES (1873, 'Yoku''s Island Express', 26);
        INSERT INTO game_releases (id, game_id, region, variants, rom_name, rom_crc, canonical_release_id)
        VALUES ('1873-default', 1873, 'USA', NULL, NULL, NULL, NULL);

        INSERT INTO canonical_releases (id, platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, source)
        VALUES (762828, 26, 'Yoku''s Island Express', 'yokuislandexpress', 'World', NULL, 'Yoku''s Island Express (World).xci', 'a95adadb', 'dat');

        -- Child platform test data (PSVR game linking to PS4 Redump release)
        INSERT INTO games (stable_id, title, platform_id) VALUES (2739, 'Astro Bot: Rescue Mission', 51);
        INSERT INTO game_releases (id, game_id, region, variants, rom_name, rom_crc, canonical_release_id)
        VALUES ('2739-default', 2739, 'USA', NULL, NULL, NULL, NULL);

        INSERT INTO canonical_releases (id, platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, source)
        VALUES (889900, 34, 'Astro Bot - Rescue Mission', 'astrobotrescuemission', 'USA', NULL, 'Astro Bot - Rescue Mission (USA).iso', '0f563151', 'dat');
      `);
    });

    afterEach(() => {
      db.close();
      if (fs.existsSync(testSqlPath)) {
        fs.unlinkSync(testSqlPath);
      }
    });

    it('should reconcile missing rom_name and canonical_release_id in live mode', () => {
      const result = reconcileGameReleasesWithCanonical(db, {
        dryRun: false,
        sqlOutputPath: testSqlPath,
      });

      expect(result.reconciledCount).toBe(2);
      expect(result.updatesByPlatform[26]).toBe(1);
      expect(result.updatesByPlatform[51]).toBe(1);

      const updated = db
        .prepare('SELECT * FROM game_releases WHERE id = ?')
        .get('1873-default') as {
        canonical_release_id: number | null;
        rom_name: string | null;
        rom_crc: string | null;
      };
      expect(updated.canonical_release_id).toBe(762828);
      expect(updated.rom_name).toBe("Yoku's Island Express (World).xci");
      expect(updated.rom_crc).toBe('a95adadb');

      // Verify child platform (PSVR -> PS4) reconciled
      const psvrUpdated = db
        .prepare('SELECT * FROM game_releases WHERE id = ?')
        .get('2739-default') as {
        canonical_release_id: number | null;
        rom_name: string | null;
        rom_crc: string | null;
      };
      expect(psvrUpdated.canonical_release_id).toBe(889900);
      expect(psvrUpdated.rom_name).toBe('Astro Bot - Rescue Mission (USA).iso');
      expect(psvrUpdated.rom_crc).toBe('0f563151');

      expect(fs.existsSync(testSqlPath)).toBe(true);
      const sqlContent = fs.readFileSync(testSqlPath, 'utf8');
      expect(sqlContent).toContain(
        "UPDATE game_releases SET canonical_release_id = 762828, rom_name = 'Yoku''s Island Express (World).xci', rom_crc = 'a95adadb'",
      );
      expect(sqlContent).toContain(
        "UPDATE game_releases SET canonical_release_id = 889900, rom_name = 'Astro Bot - Rescue Mission (USA).iso', rom_crc = '0f563151'",
      );
    });

    it('should not modify database in dry-run mode', () => {
      const result = reconcileGameReleasesWithCanonical(db, {
        dryRun: true,
        sqlOutputPath: testSqlPath,
      });

      expect(result.reconciledCount).toBe(2);

      const notUpdated = db
        .prepare('SELECT * FROM game_releases WHERE id = ?')
        .get('1873-default') as {
        canonical_release_id: number | null;
        rom_name: string | null;
      };
      expect(notUpdated.canonical_release_id).toBeNull();
      expect(notUpdated.rom_name).toBeNull();
    });
  });
});
