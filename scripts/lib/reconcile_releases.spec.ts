import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  stripEditionSuffix,
  selectBestRegionalCandidate,
  reconcileGameReleasesWithCanonical,
  auditAndRepairCorruptedRoms,
} from './reconcile_releases.js';
import { auditSqlCost } from '../d1_cost_guard.js';
import { normalizeTitleForMatching } from '../../shared/title_matching.js';

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
      expect(match?.id).toBe(3);
    });

    it('should fall back to World for USA if USA not present', () => {
      const match = selectBestRegionalCandidate(candidates, 'USA');
      expect(match?.id).toBe(2);
    });

    it('should fall back to first candidate if no region specified', () => {
      const match = selectBestRegionalCandidate(candidates, null);
      expect(match?.id).toBe(1);
    });

    it('should return null when targetRegion has no compatible regional overlap or World fallback', () => {
      const jpOnly = [{ id: 1, region: 'Japan', rom_name: 'Game (Japan).xci' }];
      expect(selectBestRegionalCandidate(jpOnly, 'USA')).toBeNull();
      expect(selectBestRegionalCandidate(jpOnly, 'Europe')).toBeNull();
    });
  });

  describe('reconcileGameReleasesWithCanonical', () => {
    let db: Database.Database;
    const testSqlPath = path.join(os.tmpdir(), 'test_reconcile_output.sql');

    beforeEach(() => {
      db = new Database(':memory:');
      db.exec(`
        CREATE TABLE platforms (id INTEGER PRIMARY KEY, name TEXT, parent_platform_id INTEGER);
        CREATE TABLE games (stable_id INTEGER PRIMARY KEY, id TEXT, title TEXT, platform_id INTEGER);
        CREATE TABLE game_releases (
          id TEXT PRIMARY KEY,
          game_id INTEGER,
          region TEXT,
          variants TEXT,
          also_released_as TEXT,
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
          also_released_as TEXT,
          packin_host_normalized_title TEXT,
          redump_disc_id INTEGER,
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
        .prepare('SELECT * FROM game_releases WHERE game_id = ?')
        .get(1873) as {
        id: string;
        canonical_release_id: number | null;
        rom_name: string | null;
        rom_crc: string | null;
      };
      expect(updated.id).toBe('1873-default');
      expect(updated.canonical_release_id).toBe(762828);
      expect(updated.rom_name).toBe("Yoku's Island Express (World).xci");
      expect(updated.rom_crc).toBe('a95adadb');

      // Verify child platform (PSVR -> PS4) reconciled while keeping release ID immutable
      const psvrUpdated = db
        .prepare('SELECT * FROM game_releases WHERE game_id = ?')
        .get(2739) as {
        id: string;
        canonical_release_id: number | null;
        rom_name: string | null;
        rom_crc: string | null;
      };
      expect(psvrUpdated.id).toBe('2739-default');
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

    it('should strictly reject matching base title when subtitle indicates a sequel or distinct game', () => {
      db.exec(`
        INSERT INTO games (stable_id, title, platform_id) VALUES (1571, 'Fire Emblem Warriors: Three Hopes', 26);
        INSERT INTO game_releases (id, game_id, region, variants, rom_name, rom_crc, canonical_release_id)
        VALUES ('1571-default', 1571, 'USA', NULL, NULL, NULL, NULL);

        INSERT INTO canonical_releases (id, platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, source)
        VALUES (999001, 26, 'Fire Emblem Warriors', 'fireemblemwarriors', 'World', NULL, 'Fire Emblem Warriors (World).xci', '1f09fa41', 'dat');
      `);

      reconcileGameReleasesWithCanonical(db, {
        dryRun: false,
        platformId: 26,
      });

      const threeHopes = db
        .prepare(
          'SELECT canonical_release_id, rom_name FROM game_releases WHERE id = ?',
        )
        .get('1571-default') as {
        canonical_release_id: number | null;
        rom_name: string | null;
      };

      expect(threeHopes.canonical_release_id).toBeNull();
      expect(threeHopes.rom_name).toBeNull();
    });

    it('should match upstream catalog variants via canonical alias', () => {
      db.exec(`
        INSERT INTO games (stable_id, title, platform_id) VALUES (1572, 'Fire Emblem Warriors: Three Hopes', 26);
        INSERT INTO game_releases (id, game_id, region, variants, rom_name, rom_crc, canonical_release_id)
        VALUES ('1572-default', 1572, 'USA', NULL, NULL, NULL, NULL);

        INSERT INTO canonical_releases (id, platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, source)
        VALUES (999002, 26, 'Fire Emblem - Three Hopes', 'fireemblemwarriorsthreehopes', 'USA', NULL, 'Fire Emblem - Three Hopes (USA).xci', 'b1765d12', 'dat');
      `);

      reconcileGameReleasesWithCanonical(db, {
        dryRun: false,
        platformId: 26,
      });

      const threeHopes = db
        .prepare(
          'SELECT id, canonical_release_id, rom_name FROM game_releases WHERE game_id = ?',
        )
        .get(1572) as {
        id: string;
        canonical_release_id: number | null;
        rom_name: string | null;
      };

      expect(threeHopes.id).toBe('1572-default');
      expect(threeHopes.canonical_release_id).toBe(999002);
      expect(threeHopes.rom_name).toBe('Fire Emblem - Three Hopes (USA).xci');
    });

    it('should preserve release IDs and user_game_releases links without CRC-based PK renames', () => {
      db.exec(`
        CREATE TABLE user_game_releases (
          user_id INTEGER,
          release_id TEXT,
          game_id INTEGER,
          status TEXT,
          PRIMARY KEY (user_id, release_id)
        );
        INSERT INTO user_game_releases (user_id, release_id, game_id, status)
        VALUES (1, '1873-default', 1873, 'owned');
      `);

      reconcileGameReleasesWithCanonical(db, {
        dryRun: false,
        sqlOutputPath: testSqlPath,
      });

      const userRel = db
        .prepare('SELECT release_id FROM user_game_releases WHERE game_id = ?')
        .get(1873) as { release_id: string };
      expect(userRel.release_id).toBe('1873-default');

      const sqlContent = fs.readFileSync(testSqlPath, 'utf8');
      expect(sqlContent).not.toContain('1873-a95adadb');
      expect(sqlContent).toContain(
        "UPDATE game_releases SET canonical_release_id = 762828, rom_name = 'Yoku''s Island Express (World).xci', rom_crc = 'a95adadb'",
      );
    });

    it('should reject relinking an unlinked release when the matched canonical ROM belongs to a mismatched title such as LEGO Marvel Avengers vs Marvel Avengers', () => {
      db.exec(`
        INSERT INTO games (stable_id, title, platform_id)
        VALUES (3002, 'Marvel''s Avengers', 34);
        INSERT INTO game_releases (id, game_id, region, variants, rom_name, rom_crc, canonical_release_id)
        VALUES ('3002-bad', 3002, 'USA', NULL, 'LEGO Marvel''s Avengers (USA).iso', 'deadbeef', NULL);
        INSERT INTO canonical_releases (id, platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, source)
        VALUES (888001, 34, 'LEGO Marvel''s Avengers', 'legomarvelsavengers', 'USA', NULL, 'LEGO Marvel''s Avengers (USA).iso', 'deadbeef', 'dat');
      `);

      reconcileGameReleasesWithCanonical(db, {
        dryRun: false,
        platformId: 34,
        sqlOutputPath: testSqlPath,
      });

      const rel = db
        .prepare('SELECT canonical_release_id FROM game_releases WHERE id = ?')
        .get('3002-bad') as { canonical_release_id: number | null };
      expect(rel.canonical_release_id).toBeNull();
    });
  });

  describe('auditAndRepairCorruptedRoms', () => {
    it('flags cross-IGDB CRC collisions and LEGO/wrong-game ROMs, repairs or clears only the invalid holder, preserves compilations and localized ROMs, and passes auditSqlCost with zero scans', () => {
      const tmpBaselinePath = path.join(
        os.tmpdir(),
        `test_repair_rom_baseline_${Date.now()}.db`,
      );
      const tmpSqlPath = path.join(
        os.tmpdir(),
        `test_repair_rom_sql_${Date.now()}.sql`,
      );

      const db = new Database(tmpBaselinePath);
      const schemaSql = fs.readFileSync(
        path.resolve(process.cwd(), 'migrations', 'schema.sql'),
        'utf8',
      );
      db.exec(schemaSql);
      db.exec(`
        INSERT INTO games (stable_id, id, title, platform_id, igdb_id)
        VALUES
          (3002, 'marvels-avengers-ps4', 'Marvel''s Avengers', 34, 111001),
          (4169, 'lego-marvels-avengers-ps4', 'LEGO Marvel''s Avengers', 34, 111002),
          (2471, 'lego-batman-ps3', 'LEGO Batman: The Videogame', 32, 222001),
          (3846, 'batman-arkham-city-ps3', 'Batman: Arkham City', 32, 222002),
          (5001, 'gta-trilogy-ps2', 'Grand Theft Auto: The Trilogy', 30, 333001),
          (5002, 'gta-iii-ps2', 'Grand Theft Auto III', 30, 333002),
          (509, 'fire-emblem-gba', 'Fire Emblem', 19, 444001),
          (510, 'pokemon-gold-gbc', 'Pokémon Gold Version', 18, 555001),
          (6001, 'crash-action-pack-ps2', 'Crash Bandicoot Action Pack', 30, 666001),
          (6002, 'crash-twinsanity-ps2', 'Crash Twinsanity', 30, 666002),
          (6003, 'dq8-ps2', 'Dragon Quest VIII: Journey of the Cursed King', 30, 666003),
          (6004, 'ff12-ps2', 'Final Fantasy XII', 30, 666004),
          (6005, 'batman-arkham-goty-ps3', 'Batman: Arkham City', 32, 666005);

        INSERT INTO canonical_releases (id, platform_id, raw_title, normalized_title, region, rom_name, rom_crc, is_verified_physical, source)
        VALUES
          (9001, 34, 'LEGO Marvel''s Avengers', '${normalizeTitleForMatching("LEGO Marvel's Avengers")}', 'USA', 'LEGO Marvel''s Avengers (USA).iso', 'aaaabbbb', 1, 'redump'),
          (9002, 34, 'Marvel''s Avengers', '${normalizeTitleForMatching("Marvel's Avengers")}', 'USA', 'Marvel''s Avengers (USA).iso', '11112222', 1, 'redump'),
          (9003, 32, 'Batman: Arkham City', '${normalizeTitleForMatching('Batman: Arkham City')}', 'USA', 'Batman - Arkham City (USA).iso', 'ccccdddd', 1, 'redump'),
          (9004, 30, 'Grand Theft Auto III', '${normalizeTitleForMatching('Grand Theft Auto III')}', 'USA', 'Grand Theft Auto III (USA).iso', 'eeeeffff', 1, 'redump'),
          (9005, 19, 'Fire Emblem - Rekka no Ken', '${normalizeTitleForMatching('Fire Emblem - Rekka no Ken')}', 'Japan', 'Fire Emblem - Rekka no Ken (Japan).gba', '12345678', 1, 'no-intro'),
          (9006, 18, 'Pokemon - Goldene Edition', '${normalizeTitleForMatching('Pokemon - Goldene Edition')}', 'Germany', 'Pokemon - Goldene Edition (Germany).gbc', '87654321', 1, 'no-intro'),
          (9007, 30, 'Crash Twinsanity', '${normalizeTitleForMatching('Crash Twinsanity')}', 'USA', 'Crash Twinsanity (USA) (v2.00).iso', '06c5bb4a', 1, 'redump'),
          (9008, 30, 'Final Fantasy XII', '${normalizeTitleForMatching('Final Fantasy XII')}', 'USA', 'Final Fantasy XII (USA) (Demo).iso', '99990000', 1, 'redump'),
          (9009, 32, 'Batman: Arkham City - Game of the Year Edition', '${normalizeTitleForMatching('Batman: Arkham City')}', 'USA', 'Batman - Arkham City - Game of the Year Edition (USA).iso', '033a0e50', 1, 'redump');

        INSERT INTO game_releases (id, game_id, region, canonical_release_id, rom_name, rom_crc)
        VALUES
          -- Cross-IGDB collision: Marvel's Avengers wrongly got LEGO Marvel's Avengers ISO, but valid canonical exists (repaired)
          ('3002-wrong', 3002, 'USA', 9001, 'LEGO Marvel''s Avengers (USA).iso', 'aaaabbbb'),
          -- Valid holder of aaaabbbb (untouched)
          ('4169-valid', 4169, 'USA', 9001, 'LEGO Marvel''s Avengers (USA).iso', 'aaaabbbb'),
          -- Cross-IGDB collision: LEGO Batman wrongly got Arkham City ISO, no canonical replacement (cleared)
          ('2471-wrong', 2471, 'USA', 9003, 'Batman - Arkham City (USA).iso', 'ccccdddd'),
          -- Valid holder of ccccdddd (untouched)
          ('3846-valid', 3846, 'USA', 9003, 'Batman - Arkham City (USA).iso', 'ccccdddd'),
          -- Compilation sharing eeeeffff with standalone GTA III (must preserve both)
          ('5001-comp', 5001, 'USA', 9004, 'Grand Theft Auto III (USA).iso', 'eeeeffff'),
          ('5002-base', 5002, 'USA', 9004, 'Grand Theft Auto III (USA).iso', 'eeeeffff'),
          -- Non-English localized releases (must preserve both)
          ('509-jpn', 509, 'Japan', 9005, 'Fire Emblem - Rekka no Ken (Japan).gba', '12345678'),
          ('510-ger', 510, 'Germany', 9006, 'Pokemon - Goldene Edition (Germany).gbc', '87654321'),
          -- Action Pack sharing Crash Twinsanity disc (must preserve)
          ('6001-pack', 6001, 'USA', 9007, 'Crash Twinsanity (USA) (v2.00).iso', '06c5bb4a'),
          ('6002-base', 6002, 'USA', 9007, 'Crash Twinsanity (USA) (v2.00).iso', '06c5bb4a'),
          -- Pack-in Demo disc (must preserve)
          ('6003-demo', 6003, 'USA', 9008, 'Final Fantasy XII (USA) (Demo).iso', '99990000'),
          ('6004-demo', 6004, 'USA', 9008, 'Final Fantasy XII (USA) (Demo).iso', '99990000'),
          -- Same-game GOTY shared disc (must preserve)
          ('6005-goty', 6005, 'USA', 9009, 'Batman - Arkham City - Game of the Year Edition (USA).iso', '033a0e50');
      `);

      try {
        const dryRes = auditAndRepairCorruptedRoms(db, {
          dryRun: true,
          sqlOutputPath: tmpSqlPath,
        });
        expect(dryRes.flagged.length).toBe(2);
        expect(dryRes.repairedCount).toBe(1);
        expect(dryRes.clearedCount).toBe(1);

        const repairedItem = dryRes.flagged.find(
          (f) => f.releaseId === '3002-wrong',
        );
        expect(repairedItem?.action).toBe('repaired');
        expect(repairedItem?.newCanonicalReleaseId).toBe(9002);
        expect(repairedItem?.newRomName).toBe("Marvel's Avengers (USA).iso");
        expect(repairedItem?.newRomCrc).toBe('11112222');

        const clearedItem = dryRes.flagged.find(
          (f) => f.releaseId === '2471-wrong',
        );
        expect(clearedItem?.action).toBe('cleared');
        expect(clearedItem?.newRomName).toBeNull();
        expect(clearedItem?.newRomCrc).toBeNull();

        // Audit SQL cost BEFORE applying to baseline DB
        const costReport = auditSqlCost(tmpSqlPath, 5000, tmpBaselinePath);
        expect(costReport.unindexedScans.length).toBe(0);
        expect(costReport.isWithinBudget).toBe(true);

        // Apply non-dry-run and confirm valid holders/compilations/localized rows remain untouched
        const applied = auditAndRepairCorruptedRoms(db, {
          dryRun: false,
        });
        expect(applied.flagged.length).toBe(2);

        const avengersRow = db
          .prepare(
            "SELECT canonical_release_id, rom_name, rom_crc FROM game_releases WHERE id = '3002-wrong'",
          )
          .get() as {
          canonical_release_id: number | null;
          rom_name: string | null;
          rom_crc: string | null;
        };
        expect(avengersRow).toEqual({
          canonical_release_id: 9002,
          rom_name: "Marvel's Avengers (USA).iso",
          rom_crc: '11112222',
        });

        const legoBatmanRow = db
          .prepare(
            "SELECT canonical_release_id, rom_name, rom_crc FROM game_releases WHERE id = '2471-wrong'",
          )
          .get() as {
          canonical_release_id: number | null;
          rom_name: string | null;
          rom_crc: string | null;
        };
        expect(legoBatmanRow).toEqual({
          canonical_release_id: null,
          rom_name: null,
          rom_crc: null,
        });

        const feRow = db
          .prepare("SELECT rom_name FROM game_releases WHERE id = '509-jpn'")
          .get() as { rom_name: string };
        expect(feRow.rom_name).toBe('Fire Emblem - Rekka no Ken (Japan).gba');

        const pkRow = db
          .prepare("SELECT rom_name FROM game_releases WHERE id = '510-ger'")
          .get() as { rom_name: string };
        expect(pkRow.rom_name).toBe('Pokemon - Goldene Edition (Germany).gbc');
      } finally {
        db.close();
        if (fs.existsSync(tmpBaselinePath)) fs.unlinkSync(tmpBaselinePath);
        if (fs.existsSync(tmpSqlPath)) fs.unlinkSync(tmpSqlPath);
      }
    });
  });

  describe('auditSqlCost (D1 Cost Guard)', () => {
    it('accounts for CREATE INDEX N-row B-Tree population and INSERT OR REPLACE 2*(1+K) amplification', () => {
      const tmpBaselinePath = path.join(
        os.tmpdir(),
        `test_cost_guard_baseline_${Date.now()}.db`,
      );
      const tmpSqlPath = path.join(
        os.tmpdir(),
        `test_cost_guard_${Date.now()}.sql`,
      );
      const db = new Database(tmpBaselinePath);
      db.exec(`
        CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, category TEXT);
        CREATE INDEX idx_items_name ON items(name);
        INSERT INTO items (id, name, category) VALUES (1, 'A', 'X'), (2, 'B', 'Y'), (3, 'C', 'Z');
      `);
      db.close();

      fs.writeFileSync(
        tmpSqlPath,
        `
        CREATE INDEX idx_items_category ON items(category);
        INSERT OR REPLACE INTO items (id, name, category) VALUES (1, 'A2', 'X2');
      `,
        'utf8',
      );

      try {
        const report = auditSqlCost(tmpSqlPath, 5000, tmpBaselinePath);
        // CREATE INDEX on 3 existing rows = 3 billable writes, and K becomes 2 (idx_items_name + idx_items_category).
        // INSERT OR REPLACE of existing row id=1 incurs 2 * (1 + K) = 2 * (1 + 2) = 6 billable writes.
        expect(report.tableBreakdown['items']?.rowsChanged).toBe(5);
        expect(report.tableBreakdown['items']?.billableWrites).toBe(9);
        expect(report.totalBillableWrites).toBe(9);
        expect(report.isWithinBudget).toBe(true);
      } finally {
        if (fs.existsSync(tmpBaselinePath)) fs.unlinkSync(tmpBaselinePath);
        if (fs.existsSync(tmpSqlPath)) fs.unlinkSync(tmpSqlPath);
      }
    });
  });

  describe('reconcileGameReleasesWithCanonical chunked SQL output', () => {
    it('partitions emitted SQL into bounded chunk files when maxBatchWrites is set', () => {
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'reconcile-chunks-'),
      );
      const dbPath = path.join(tmpDir, 'test.db');
      const sqlOut = path.join(tmpDir, 'reconcile.sql');
      const db = new Database(dbPath);
      const schemaSql = fs.readFileSync(
        path.resolve(process.cwd(), 'migrations', 'schema.sql'),
        'utf8',
      );
      db.exec(schemaSql);
      db.exec(`
        INSERT INTO games (stable_id, id, title, platform_id) VALUES
          (101, '101', 'Chrono Trigger', 15),
          (102, '102', 'Super Metroid', 15),
          (103, '103', 'EarthBound', 15);
        INSERT INTO game_releases (id, game_id, region) VALUES
          ('101-1', 101, 'USA'),
          ('102-1', 102, 'USA'),
          ('103-1', 103, 'USA');
        INSERT INTO canonical_releases (id, platform_id, raw_title, normalized_title, region, rom_name, rom_crc, source, is_verified_physical) VALUES
          (501, 15, 'Chrono Trigger (USA)', '${normalizeTitleForMatching('Chrono Trigger')}', 'USA', 'Chrono Trigger (USA).sfc', '1111aaaa', 'dat', 1),
          (502, 15, 'Super Metroid (Japan, USA)', '${normalizeTitleForMatching('Super Metroid')}', 'USA', 'Super Metroid (Japan, USA).sfc', '2222bbbb', 'dat', 1),
          (503, 15, 'EarthBound (USA)', '${normalizeTitleForMatching('EarthBound')}', 'USA', 'EarthBound (USA).sfc', '3333cccc', 'dat', 1);
      `);

      try {
        const res = reconcileGameReleasesWithCanonical(db, {
          sqlOutputPath: sqlOut,
          maxBatchWrites: 10,
        });
        expect(res.reconciledCount).toBe(3);
        expect(res.chunkSqlPaths?.length).toBeGreaterThanOrEqual(2);
        for (const chunkPath of res.chunkSqlPaths || []) {
          expect(fs.existsSync(chunkPath)).toBe(true);
          const content = fs.readFileSync(chunkPath, 'utf8');
          expect(content).not.toContain('physical_status');
        }
      } finally {
        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
