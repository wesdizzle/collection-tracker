import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { inflateRawSync } from 'node:zlib';
import {
  computeGameOwnershipMask,
  formatExportFilename,
  buildGameyeOwnershipDatabase,
  zipOwnershipDatabase,
  exportGed,
} from './ged_exporter.js';

describe('GAMEYE .GED Exporter', () => {
  describe('computeGameOwnershipMask', () => {
    it('should return 1 for loose games (no case, no manual)', () => {
      expect(computeGameOwnershipMask(0, 0)).toBe(1);
      expect(computeGameOwnershipMask(false, false)).toBe(1);
    });

    it('should return 3 for manual only (no case, has manual)', () => {
      expect(computeGameOwnershipMask(0, 1)).toBe(3);
      expect(computeGameOwnershipMask(false, true)).toBe(3);
    });

    it('should return 5 for box only (has case, no manual)', () => {
      expect(computeGameOwnershipMask(1, 0)).toBe(5);
      expect(computeGameOwnershipMask(true, false)).toBe(5);
    });

    it('should return 7 for complete in box (has case, has manual)', () => {
      expect(computeGameOwnershipMask(1, 1)).toBe(7);
      expect(computeGameOwnershipMask(true, true)).toBe(7);
    });
  });

  describe('formatExportFilename', () => {
    it('should format date with YYYY_MM_DD_gagglog_export.ged', () => {
      const fixedDate = new Date(2026, 8, 22); // Note: Month is 0-indexed, 8 = September
      expect(formatExportFilename(fixedDate)).toBe(
        '2026_09_22_gagglog_export.ged',
      );
    });
  });

  describe('buildGameyeOwnershipDatabase', () => {
    function createMockGagglogDb(): Database.Database {
      const db = new Database(':memory:');
      db.exec(`
        CREATE TABLE games (
          stable_id INTEGER PRIMARY KEY,
          id TEXT,
          title TEXT,
          platform_id INTEGER,
          region TEXT,
          gameye_id INTEGER,
          gameye_platform_id INTEGER,
          play_status INTEGER DEFAULT 0,
          backup_status INTEGER DEFAULT 0
        );

        CREATE TABLE game_releases (
          id TEXT PRIMARY KEY,
          game_id INTEGER,
          region TEXT,
          ownership_status INTEGER DEFAULT 0,
          backup_status INTEGER DEFAULT 0,
          has_case INTEGER DEFAULT 0,
          has_manual INTEGER DEFAULT 0
        );

        CREATE TABLE toys (
          stable_id INTEGER PRIMARY KEY,
          name TEXT,
          line TEXT,
          gameye_id INTEGER,
          ownership_status INTEGER DEFAULT 0
        );
      `);

      // Seed games
      // 1. CIB Game (PS2 = platform 30 -> GAMEYE 11)
      db.prepare(
        `
        INSERT INTO games (stable_id, id, title, platform_id, region, gameye_id, gameye_platform_id)
        VALUES (1, 'jak-ps2', 'Jak and Daxter', 30, 'USA', 4525, 11)
      `,
      ).run();
      db.prepare(
        `
        INSERT INTO game_releases (id, game_id, region, ownership_status, has_case, has_manual)
        VALUES ('rel-1', 1, 'USA', 1, 1, 1)
      `,
      ).run();

      // 2. Loose Game (N64 = platform 17 -> GAMEYE 3)
      db.prepare(
        `
        INSERT INTO games (stable_id, id, title, platform_id, region, gameye_id, gameye_platform_id)
        VALUES (2, 'mario64', 'Super Mario 64', 17, 'USA', 1234, 3)
      `,
      ).run();
      db.prepare(
        `
        INSERT INTO game_releases (id, game_id, region, ownership_status, has_case, has_manual)
        VALUES ('rel-2', 2, 'USA', 1, 0, 0)
      `,
      ).run();

      // 3. Unowned Game (Should NOT be exported)
      db.prepare(
        `
        INSERT INTO games (stable_id, id, title, platform_id, region, gameye_id, gameye_platform_id)
        VALUES (3, 'unowned', 'Unowned Game', 17, 'USA', 9999, 3)
      `,
      ).run();
      db.prepare(
        `
        INSERT INTO game_releases (id, game_id, region, ownership_status, has_case, has_manual)
        VALUES ('rel-3', 3, 'USA', 0, 0, 0)
      `,
      ).run();

      // Seed toys
      // 1. Owned Skylander
      db.prepare(
        `
        INSERT INTO toys (stable_id, name, line, gameye_id, ownership_status)
        VALUES (1, 'Spyro', 'Skylanders', 55555, 1)
      `,
      ).run();

      // 2. Owned amiibo
      db.prepare(
        `
        INSERT INTO toys (stable_id, name, line, gameye_id, ownership_status)
        VALUES (2, 'Mario', 'amiibo', 66666, 1)
      `,
      ).run();

      // 3. Unowned Toy (Should NOT be exported)
      db.prepare(
        `
        INSERT INTO toys (stable_id, name, line, gameye_id, ownership_status)
        VALUES (3, 'Bowser', 'amiibo', 77777, 0)
      `,
      ).run();

      return db;
    }

    it('should generate valid GAMEYE database tables and insert owned items', () => {
      const sourceDb = createMockGagglogDb();
      const { targetDb, gamesCount, toysCount } =
        buildGameyeOwnershipDatabase(sourceDb);

      expect(gamesCount).toBe(2);
      expect(toysCount).toBe(2);

      // Verify metadata tables
      const meta = targetDb
        .prepare('SELECT locale FROM android_metadata')
        .get() as { locale: string };
      expect(meta.locale).toBe('en_US');

      const versions = targetDb
        .prepare('SELECT count(*) as c FROM version')
        .get() as {
        c: number;
      };
      expect(versions.c).toBeGreaterThanOrEqual(13);

      // Verify games in ownership table
      const rows = targetDb
        .prepare('SELECT * FROM ownership ORDER BY id ASC')
        .all() as {
        id: number;
        item_id: number;
        platform_id: number;
        country_id: number | null;
        ownership_mask: number;
        category_id: number;
        title: string;
        uuid: string;
      }[];

      expect(rows).toHaveLength(4);

      // Game 1: CIB (mask 7)
      expect(rows[0].item_id).toBe(4525);
      expect(rows[0].platform_id).toBe(11);
      expect(rows[0].country_id).toBe(1);
      expect(rows[0].ownership_mask).toBe(7);
      expect(rows[0].category_id).toBe(0);
      expect(rows[0].title).toBe('Jak and Daxter');
      expect(rows[0].uuid).toBeDefined();

      // Game 2: Loose (mask 1)
      expect(rows[1].item_id).toBe(1234);
      expect(rows[1].platform_id).toBe(3);
      expect(rows[1].country_id).toBe(1);
      expect(rows[1].ownership_mask).toBe(1);
      expect(rows[1].category_id).toBe(0);
      expect(rows[1].title).toBe('Super Mario 64');

      // Toy 1: Skylander (category 3, mask 1, platform 119)
      expect(rows[2].item_id).toBe(55555);
      expect(rows[2].platform_id).toBe(119);
      expect(rows[2].country_id).toBeNull();
      expect(rows[2].ownership_mask).toBe(1);
      expect(rows[2].category_id).toBe(3);
      expect(rows[2].title).toBe('Spyro');

      // Toy 2: amiibo (category 3, mask 1, platform 118)
      expect(rows[3].item_id).toBe(66666);
      expect(rows[3].platform_id).toBe(118);
      expect(rows[3].country_id).toBeNull();
      expect(rows[3].ownership_mask).toBe(1);
      expect(rows[3].category_id).toBe(3);
      expect(rows[3].title).toBe('Mario');

      targetDb.close();
    });
  });

  describe('exportGed & zip packaging', () => {
    it('should directly compress a database buffer into a zip buffer', () => {
      const dummyBuffer = Buffer.from('SQLite format 3\0');
      const zip = zipOwnershipDatabase(dummyBuffer);
      expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    });

    it('should create a valid zip archive containing ownership_database.db', () => {
      const sourceDb = new Database(':memory:');
      sourceDb.exec(`
        CREATE TABLE games (
          stable_id INTEGER PRIMARY KEY,
          id TEXT,
          title TEXT,
          platform_id INTEGER,
          region TEXT,
          gameye_id INTEGER,
          gameye_platform_id INTEGER,
          play_status INTEGER DEFAULT 0,
          backup_status INTEGER DEFAULT 0
        );
        CREATE TABLE game_releases (
          id TEXT PRIMARY KEY,
          game_id INTEGER,
          region TEXT,
          ownership_status INTEGER DEFAULT 0,
          backup_status INTEGER DEFAULT 0,
          has_case INTEGER DEFAULT 0,
          has_manual INTEGER DEFAULT 0
        );
        CREATE TABLE toys (
          stable_id INTEGER PRIMARY KEY,
          name TEXT,
          line TEXT,
          gameye_id INTEGER,
          ownership_status INTEGER DEFAULT 0
        );

        INSERT INTO games VALUES (1, 'g1', 'Test Game', 30, 'USA', 999, 11, 0, 0);
        INSERT INTO game_releases VALUES ('r1', 1, 'USA', 1, 0, 1, 1);
      `);

      const exportResult = exportGed(sourceDb);
      expect(exportResult.gamesCount).toBe(1);
      expect(exportResult.toysCount).toBe(0);
      expect(exportResult.totalCount).toBe(1);
      expect(exportResult.filename).toContain('_gagglog_export.ged');
      expect(exportResult.buffer.length).toBeGreaterThan(100);

      // Verify ZIP magic bytes (PK\x03\x04 = 0x04034b50)
      expect(exportResult.buffer.readUInt32LE(0)).toBe(0x04034b50);

      // Parse the local header to extract the SQLite database
      const filenameLength = exportResult.buffer.readUInt16LE(26);
      const extraLength = exportResult.buffer.readUInt16LE(28);
      const compressedSize = exportResult.buffer.readUInt32LE(18);

      const filename = exportResult.buffer.toString(
        'utf8',
        30,
        30 + filenameLength,
      );
      expect(filename).toBe('ownership_database.db');

      const fileDataOffset = 30 + filenameLength + extraLength;
      const compressedData = exportResult.buffer.subarray(
        fileDataOffset,
        fileDataOffset + compressedSize,
      );
      const decompressedDb = inflateRawSync(compressedData);

      // Open extracted buffer with better-sqlite3 and verify contents
      const extractedDb = new Database(decompressedDb);
      const rows = extractedDb
        .prepare('SELECT title, item_id, ownership_mask FROM ownership')
        .all() as { title: string; item_id: number; ownership_mask: number }[];

      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe('Test Game');
      expect(rows[0].item_id).toBe(999);
      expect(rows[0].ownership_mask).toBe(7);

      extractedDb.close();
      sourceDb.close();
    });
  });
});
