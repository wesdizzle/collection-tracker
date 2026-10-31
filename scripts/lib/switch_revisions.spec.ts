import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import {
  parseCsvRows,
  normalizeSpreadsheetRegion,
  formatSwitchRevisionVariant,
  parseSwitchRevisionsCsv,
  parseNxdumptoolFilename,
  resolveBestSwitchRevisionMatch,
  reconcileSwitchReleasesWithDatabase,
  SwitchSheetTabConfig,
} from './switch_revisions.js';
import { CanonicalRelease } from './canonical_releases.js';

describe('Switch Revisions & nxdumptool Matching Engine', () => {
  describe('parseCsvRows', () => {
    it('should correctly parse standard, quoted, and multiline CSV lines', () => {
      const csv = `Game Name,Revision #,Version on Cart,Download Available?\n1-2-Switch,001,1.1.0,No\n"Bayonetta 2",000,1.0,Yes*\n"Line 1\nLine 2",000,1.0,No`;
      const rows = parseCsvRows(csv);
      expect(rows).toHaveLength(4);
      expect(rows[1][0]).toBe('1-2-Switch');
      expect(rows[1][1]).toBe('001');
      expect(rows[2][0]).toBe('Bayonetta 2');
      expect(rows[3][0]).toBe('Line 1\nLine 2');
    });
  });

  describe('normalizeSpreadsheetRegion', () => {
    it('should map regional tokens to standard names', () => {
      expect(normalizeSpreadsheetRegion('USA')).toBe('USA');
      expect(normalizeSpreadsheetRegion('EUR')).toBe('Europe');
      expect(normalizeSpreadsheetRegion('JPN')).toBe('Japan');
      expect(normalizeSpreadsheetRegion('AUS')).toBe('Australia');
      expect(normalizeSpreadsheetRegion('USA, EUR')).toBe('USA, Europe');
      expect(normalizeSpreadsheetRegion('MSE')).toBe('Asia');
      expect(normalizeSpreadsheetRegion('N/A')).toBeNull();
    });
  });

  describe('formatSwitchRevisionVariant', () => {
    it('should format standard cartridge revision strings', () => {
      expect(
        formatSwitchRevisionVariant('001', '1.1.0', 'No', 'LA-H-AACCA-USA'),
      ).toBe('Rev 001 (v1.1.0)');
      expect(
        formatSwitchRevisionVariant('000', '1.0', 'Yes*', 'LA-H-AE98A-USA'),
      ).toBe('Rev 000 (v1.0)');
    });

    it('should detect Game Key Cards on Switch 2', () => {
      expect(formatSwitchRevisionVariant('-', '-', 'Key', 'LP-AAACA-USA')).toBe(
        'Game Key Card',
      );
    });
  });

  describe('parseSwitchRevisionsCsv with Past Revisions Inheritance', () => {
    it('should parse main tabs and assign World to undocumented past revisions without regional expansion', () => {
      const mainTab: SwitchSheetTabConfig = {
        gid: '0',
        name: 'S1: 1st Party Nintendo',
        platformId: 26,
      };
      const mainCsv = `Game Name,Revision #,Version on Cart,Download Available?,Download Size,Regions,Front Cart Code,Additional Comments,Last Checked\n1-2-Switch,001,1.1.0,No,N/A,USA,LA-H-AACCA-USA,Complete on cart,30/05/2024\n1-2-Switch,001,1.1.0,No,N/A,EUR,LA-H-AACCA-EUR,Complete on cart,30/05/2024\nAnimal Crossing: New Horizons,009,1.8.0,No,N/A,USA,LA-H-ALACA-USA,Complete,30/05/2024`;

      const pastTab: SwitchSheetTabConfig = {
        gid: '609274111',
        name: 'Past Revisions SW1',
        platformId: 26,
        isPastRevisions: true,
      };
      const pastCsv = `Game Name,Past Revision #,Version on Cart,Additional Comments\n1-2-Switch,000,1.0.0,Base print\nAnimal Crossing: New Horizons,000,1.0.0,Base\n,001,1.1.0,Patch 1\n,004,1.2.0,EUR COPIES ONLY`;

      const releases = parseSwitchRevisionsCsv([
        { tab: mainTab, csv: mainCsv },
        { tab: pastTab, csv: pastCsv },
      ]);

      // 1-2-Switch: Rev 001 for USA and Europe, Rev 000 tagged 'World' without fabricated regional expansion
      const oneTwoSwitchRevs = releases.filter(
        (r) => r.raw_title === '1-2-Switch',
      );
      expect(oneTwoSwitchRevs).toHaveLength(3);
      const rev000World = oneTwoSwitchRevs.find(
        (r) => r.variants === 'Rev 000 (v1.0.0)',
      );
      expect(rev000World).toBeTruthy();
      expect(rev000World?.region).toBe('World');
      expect(rev000World?.publisher).toBe('Base print');

      // Animal Crossing:
      // Rev 009 (USA, LA-H-ALACA-USA)
      // Rev 000 (World - no explicit region)
      // Rev 001 (World - undocumented reprint)
      // Rev 004 (Europe - explicit "EUR COPIES ONLY")
      const acRevs = releases.filter(
        (r) => r.raw_title === 'Animal Crossing: New Horizons',
      );
      expect(acRevs).toHaveLength(4);

      const acRev0 = acRevs.find((r) => r.variants === 'Rev 000 (v1.0.0)');
      expect(acRev0?.region).toBe('World');
      expect(acRev0?.publisher).toBe('Base');

      const acRev1 = acRevs.find((r) => r.variants === 'Rev 001 (v1.1.0)');
      expect(acRev1?.region).toBe('World');
      expect(acRev1?.publisher).toBe('Patch 1');

      const acRev4 = acRevs.find((r) => r.variants === 'Rev 004 (v1.2.0)');
      expect(acRev4?.region).toBe('Europe');
      expect(acRev4?.publisher).toBe('EUR COPIES ONLY');
    });
  });

  describe('parseNxdumptoolFilename', () => {
    it('should parse base v0 dumps and strip dump flags', () => {
      const parsed = parseNxdumptoolFilename(
        '1-2-Switch [01000320000CC000][v0] [NKA][NC][NT].xci',
      );
      expect(parsed.isNxdumptool).toBe(true);
      expect(parsed.segments).toHaveLength(1);
      expect(parsed.segments[0].cleanTitle).toBe('1-2-Switch');
      expect(parsed.segments[0].titleId).toBe('01000320000CC000');
      expect(parsed.segments[0].versionInt).toBe(0);
      expect(parsed.segments[0].patchLevel).toBe(0);
      expect(parsed.segments[0].displayVersion).toBeNull();
      expect(parsed.dumpFlags).toEqual(['[NKA]', '[NC]', '[NT]']);
    });

    it('should replace underscores with colons for normalized matching', () => {
      const parsed = parseNxdumptoolFilename(
        'Animal Crossing_ New Horizons [01006F8002326000][v0] [NKA][NC][NT].xci',
      );
      expect(parsed.segments[0].cleanTitle).toBe(
        'Animal Crossing: New Horizons',
      );
    });

    it('should extract display versions and patch levels for updated cartridges', () => {
      const parsed = parseNxdumptoolFilename(
        'Bayonetta 1.1 [010076F0049A2000][v65536] [NKA][NC][NT].xci',
      );
      expect(parsed.segments[0].cleanTitle).toBe('Bayonetta');
      expect(parsed.segments[0].displayVersion).toBe('1.1');
      expect(parsed.segments[0].versionInt).toBe(65536);
      expect(parsed.segments[0].patchLevel).toBe(1);
    });

    it('should parse multi-game cartridge dumps', () => {
      const parsed = parseNxdumptoolFilename(
        '20XX 1.1.1 [0100749009844000][v327680] + 30XX 1.3.6 [010059B017F9E000][v851968] [NKA][NC][NT].xci',
      );
      expect(parsed.isNxdumptool).toBe(true);
      expect(parsed.isMultiGame).toBe(true);
      expect(parsed.segments).toHaveLength(2);
      expect(parsed.segments[0].cleanTitle).toBe('20XX');
      expect(parsed.segments[0].displayVersion).toBe('1.1.1');
      expect(parsed.segments[1].cleanTitle).toBe('30XX');
      expect(parsed.segments[1].displayVersion).toBe('1.3.6');
      expect(parsed.compositeTitle).toBe('20XX + 30XX');
    });
  });

  describe('resolveBestSwitchRevisionMatch', () => {
    const mockReleases: CanonicalRelease[] = [
      {
        platform_id: 26,
        raw_title: 'Bayonetta',
        normalized_title: 'bayonetta',
        region: 'USA',
        variants: 'Rev 000 (v1.0)',
        rom_name: null,
        rom_crc: null,
        serial_code: 'LA-H-AE98A-USA',
        source: 'nintendo_revised',
        is_verified_physical: 1,
      },
      {
        platform_id: 26,
        raw_title: 'Bayonetta',
        normalized_title: 'bayonetta',
        region: 'USA',
        variants: 'Rev 001 (v1.1)',
        rom_name: null,
        rom_crc: null,
        serial_code: 'LA-H-AE98A-USA',
        source: 'nintendo_revised',
        is_verified_physical: 1,
      },
    ];

    it('should match Rev 001 when backup filename has display version 1.1 / v65536', () => {
      const parsed = parseNxdumptoolFilename(
        'Bayonetta 1.1 [010076F0049A2000][v65536] [NKA][NC][NT].xci',
      );
      const match = resolveBestSwitchRevisionMatch(parsed, mockReleases);
      expect(match?.variants).toBe('Rev 001 (v1.1)');
    });

    it('should match Rev 000 when backup filename is v0', () => {
      const parsed = parseNxdumptoolFilename(
        'Bayonetta [010076F0049A2000][v0] [NKA][NC][NT].xci',
      );
      const match = resolveBestSwitchRevisionMatch(parsed, mockReleases);
      expect(match?.variants).toBe('Rev 000 (v1.0)');
    });
  });

  describe('reconcileSwitchReleasesWithDatabase', () => {
    it('should relink dangling canonical IDs and insert missing past revisions', () => {
      const db = new Database(':memory:');
      db.exec(`
        CREATE TABLE games (
          stable_id INTEGER PRIMARY KEY AUTOINCREMENT,
          id TEXT,
          title TEXT NOT NULL,
          region TEXT,
          platform_id INTEGER,
          physical_status TEXT DEFAULT 'unverified',
          verification_tier INTEGER DEFAULT 0
        );

        CREATE TABLE canonical_releases (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          platform_id INTEGER NOT NULL,
          raw_title TEXT NOT NULL,
          normalized_title TEXT NOT NULL,
          region TEXT,
          variants TEXT,
          rom_name TEXT,
          rom_crc TEXT,
          serial_code TEXT,
          barcode TEXT,
          publisher TEXT,
          source TEXT NOT NULL DEFAULT 'nintendo_revised',
          is_verified_physical INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE game_releases (
          id TEXT PRIMARY KEY,
          game_id INTEGER NOT NULL,
          canonical_release_id INTEGER,
          region TEXT,
          variants TEXT,
          rom_name TEXT,
          rom_crc TEXT,
          release_date TEXT
        );

        CREATE TABLE user_game_releases (
          user_id INTEGER NOT NULL,
          release_id TEXT NOT NULL,
          ownership_status INTEGER NOT NULL DEFAULT 0,
          backup_status INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, release_id)
        );
      `);

      // Seed game
      db.prepare(
        "INSERT INTO games (stable_id, id, title, region, platform_id) VALUES (1, 'super-mario-odyssey', 'Super Mario Odyssey', 'USA', 26)",
      ).run();

      // Seed existing launch release with dangling canonical_release_id (old deleted DAT ID 999999)
      db.prepare(
        "INSERT INTO game_releases (id, game_id, canonical_release_id, region, variants) VALUES ('odyssey-launch', 1, 999999, 'USA', NULL)",
      ).run();

      // Seed canonical releases: Rev 000, Rev 001, Rev 002, Rev 003
      db.prepare(
        `
        INSERT INTO canonical_releases (id, platform_id, raw_title, normalized_title, region, variants, serial_code, publisher) VALUES
        (101, 26, 'Super Mario Odyssey', 'supermarioodyssey', 'USA', 'Rev 000 (v1.0.0)', 'LA-H-AAACA-USA', 'Has complete revision: Rev 003'),
        (102, 26, 'Super Mario Odyssey', 'supermarioodyssey', 'World', 'Rev 001 (v1.0.1)', NULL, NULL),
        (103, 26, 'Super Mario Odyssey', 'supermarioodyssey', 'World', 'Rev 002 (v1.1.0)', NULL, NULL),
        (104, 26, 'Super Mario Odyssey', 'supermarioodyssey', 'USA', 'Rev 003 (v1.3.0)', 'LA-H-AAACA-USA', 'Complete on cart for Switch 1');
      `,
      ).run();

      const result = reconcileSwitchReleasesWithDatabase(db, {
        platformIds: [26],
      });

      expect(result.verifiedGames).toBe(1);
      expect(result.reconciledReleases).toBe(1); // Relinked dangling launch cart
      expect(result.insertedRevisions).toBe(3); // Inserted Rev 001, Rev 002, Rev 003

      // Verify launch release was relinked to Rev 000
      const launch = db
        .prepare("SELECT * FROM game_releases WHERE id = 'odyssey-launch'")
        .get() as { canonical_release_id: number; variants: string | null };
      expect(launch.canonical_release_id).toBe(101);
      expect(launch.variants).toBe('Rev 000 (v1.0.0)');

      // Verify all 4 releases are now in game_releases
      const allRels = db
        .prepare(
          'SELECT id, variants, canonical_release_id FROM game_releases WHERE game_id = 1 ORDER BY variants ASC',
        )
        .all() as Array<{
        id: string;
        variants: string | null;
        canonical_release_id: number;
      }>;
      expect(allRels).toHaveLength(4);
      expect(allRels.map((r) => r.variants)).toEqual([
        'Rev 000 (v1.0.0)',
        'Rev 001 (v1.0.1)',
        'Rev 002 (v1.1.0)',
        'Rev 003 (v1.3.0)',
      ]);
    });

    it('should synchronize release region with canonical Nintendo Revised region and default unlinked to World', () => {
      const db = new Database(':memory:');
      db.exec(`
        CREATE TABLE games (
          stable_id INTEGER PRIMARY KEY AUTOINCREMENT,
          id TEXT,
          title TEXT NOT NULL,
          region TEXT,
          platform_id INTEGER,
          physical_status TEXT DEFAULT 'unverified',
          verification_tier INTEGER DEFAULT 0
        );

        CREATE TABLE canonical_releases (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          platform_id INTEGER NOT NULL,
          raw_title TEXT NOT NULL,
          normalized_title TEXT NOT NULL,
          region TEXT,
          variants TEXT,
          rom_name TEXT,
          rom_crc TEXT,
          serial_code TEXT,
          barcode TEXT,
          publisher TEXT,
          source TEXT NOT NULL DEFAULT 'nintendo_revised',
          is_verified_physical INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE game_releases (
          id TEXT PRIMARY KEY,
          game_id INTEGER NOT NULL,
          canonical_release_id INTEGER,
          region TEXT,
          variants TEXT,
          rom_name TEXT,
          rom_crc TEXT,
          release_date TEXT
        );

        CREATE TABLE user_game_releases (
          user_id INTEGER NOT NULL,
          release_id TEXT NOT NULL,
          ownership_status INTEGER NOT NULL DEFAULT 0,
          backup_status INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, release_id)
        );
      `);

      // Seed 2 games: Game 1 has European cartridge in Nintendo Revised, Game 2 has no Nintendo Revised entries
      db.prepare(
        "INSERT INTO games (stable_id, id, title, region, platform_id) VALUES (1, 'bloodstained', 'Bloodstained', 'USA', 26), (2, 'untracked-game', 'Untracked Game', 'USA', 26)",
      ).run();

      // Seed existing releases originally defaulted to 'USA'
      db.prepare(
        "INSERT INTO game_releases (id, game_id, canonical_release_id, region, variants) VALUES ('bloodstained-rel', 1, NULL, 'USA', NULL), ('untracked-rel', 2, NULL, 'USA', NULL)",
      ).run();

      // Seed canonical release for Bloodstained with Europe region
      db.prepare(
        `
        INSERT INTO canonical_releases (id, platform_id, raw_title, normalized_title, region, variants, serial_code)
        VALUES (201, 26, 'Bloodstained', 'bloodstained', 'Europe', 'Rev 000 (v1.0.0)', 'LA-H-AB4PA-EUR');
      `,
      ).run();

      reconcileSwitchReleasesWithDatabase(db, {
        platformIds: [26],
      });

      const rel1 = db
        .prepare("SELECT * FROM game_releases WHERE id = 'bloodstained-rel'")
        .get() as { region: string; canonical_release_id: number };
      expect(rel1.canonical_release_id).toBe(201);
      expect(rel1.region).toBe('Europe');

      const rel2 = db
        .prepare("SELECT * FROM game_releases WHERE id = 'untracked-rel'")
        .get() as { region: string; canonical_release_id: number | null };
      expect(rel2.canonical_release_id).toBeNull();
      expect(rel2.region).toBe('World');
    });
  });
});
