import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import {
  formatCoverageReport,
  generateCoverageReport,
} from './coverage_report.js';

describe('coverage_report', () => {
  it('computes per-platform verified %, Tier 1-4 breakdown, unmaterialized canonical titles, tracked summary, and Xbox gap near-matches', () => {
    const db = new Database(':memory:');
    try {
      const schemaSql = fs.readFileSync(
        path.resolve(process.cwd(), 'migrations', 'schema.sql'),
        'utf8',
      );
      db.exec(schemaSql);

      db.exec(`
        INSERT INTO users (id, username, is_public, home_region)
        VALUES (1, 'tester', 0, 'USA');

        INSERT INTO canonical_releases (id, platform_id, raw_title, normalized_title, region, rom_name, source, is_verified_physical)
        VALUES
          (1, 34, 'Bloodborne', 'blodborne', 'USA', 'Bloodborne (USA).iso', 'dat', 1),
          (2, 35, 'Astro Bot', 'astrobot', 'USA', NULL, 'serialstation', 1),
          (3, 35, 'Returnal', 'returnal', 'USA', NULL, 'ps5db', 1),
          (4, 35, 'Axiom Verge 2', 'axiomverge2', 'USA', NULL, 'retail_catalog', 1),
          (5, 35, 'Unmaterialized PS5 Exclusive', 'unmaterializedps5exclusive', 'USA', NULL, 'ps5db', 1),
          (6, 49, 'Halo Infinite', 'haloinfinite', 'USA', NULL, 'retail_catalog', 1),
          (7, 50, 'Starfield - Nintendo Switch 2 Edition', 'starfield', 'USA', NULL, 'retail_catalog', 1);

        INSERT INTO games (stable_id, id, title, platform_id, igdb_id, image_url)
        VALUES
          (101, '101', 'Bloodborne', 34, 1001, 'https://images.igdb.com/bloodborne.jpg'),
          (102, '102', 'Astro Bot', 35, 1002, 'https://images.igdb.com/astrobot.jpg'),
          (103, '103', 'Returnal', 35, 1003, 'https://images.igdb.com/returnal.jpg'),
          (104, '104', 'Axiom Verge 2', 35, 1004, 'https://images.igdb.com/av2.jpg'),
          (105, '105', 'Legacy ROM Only Game', 34, NULL, '/covers/legacy.jpg'),
          (106, '106', 'Halo Infinite', 49, NULL, NULL),
          (107, '107', 'Unverified Xbox One Game', 49, NULL, NULL),
          (108, '108', 'Starfield', 50, NULL, NULL),
          (109, '109', 'Returnal - Year One Edition', 35, NULL, NULL);

        INSERT INTO game_releases (id, game_id, region, rom_name, release_date, canonical_release_id)
        VALUES
          ('101-1', 101, 'USA', 'Bloodborne (USA).iso', '2015-03-24', 1),
          ('102-1', 102, 'USA', NULL, '2024-09-06', 2),
          ('103-1', 103, 'USA', NULL, '2021-04-30', 3),
          ('104-1', 104, 'USA', NULL, '2021-08-11', 4),
          ('105-1', 105, 'USA', 'Legacy.iso', '2000-01-01', NULL),
          ('106-1', 106, 'USA', NULL, NULL, NULL),
          ('107-1', 107, 'USA', NULL, NULL, NULL),
          ('108-1', 108, 'USA', NULL, NULL, NULL),
          ('109-1', 109, 'USA', NULL, NULL, NULL);

        INSERT INTO user_game_releases (user_id, release_id, ownership_status)
        VALUES
          (1, '101-1', 1),
          (1, '106-1', 2),
          (1, '109-1', 2);
      `);

      const report = generateCoverageReport(db);
      expect(report.overall.totalGames).toBe(9);
      expect(report.overall.totalReleases).toBe(9);
      expect(report.overall.verifiedReleases).toBe(5);
      expect(report.overall.unverifiedReleases).toBe(4);
      expect(report.overall.trackedTotalGames).toBe(3);
      expect(report.overall.trackedVerifiedReleases).toBe(1);
      expect(report.overall.trackedUnverifiedReleases).toBe(2);

      const ps4 = report.platforms.find((p) => p.platformId === 34)!;
      expect(ps4).toMatchObject({
        totalGames: 2,
        totalReleases: 2,
        verifiedCount: 2,
        tier1Count: 1,
        romOnlyCount: 1,
        verifiedPct: 100,
      });

      const ps5 = report.platforms.find((p) => p.platformId === 35)!;
      expect(ps5).toMatchObject({
        totalGames: 4,
        totalReleases: 4,
        verifiedCount: 3,
        tier2Count: 1,
        tier3Count: 1,
        tier4Count: 1,
        unmaterializedCanonicalTitles: 1,
      });

      const xb1 = report.xboxGaps.find((x) => x.platformId === 49)!;
      expect(xb1.unverifiedReleases).toBe(2);
      expect(xb1.trackedUnverifiedCount).toBe(1);
      expect(xb1.nearMatchesInCanonicalCount).toBe(1);
      expect(xb1.sampleUnverified[0]).toMatchObject({
        releaseId: '106-1',
        tracked: true,
        nearMatchTitle: 'Halo Infinite',
      });

      expect(report.igdbCoverage.overall).toMatchObject({
        totalGames: 9,
        exemptCuratedCount: 1,
        eligibleGames: 8,
        igdbLinkedCount: 4,
        comboLinkedCount: 0,
        missingIgdbCount: 4,
        missingArtCount: 4,
        missingDateCount: 4,
      });
      expect(report.igdbCoverage.modernWestern).toBeDefined();
      expect(report.igdbCoverage.usaEnglishWestern).toBeDefined();
      expect(report.igdbCoverage.duplicateSiblingCount).toBe(1);
      expect(report.igdbCoverage.trackedDuplicateSiblingCount).toBe(1);
      expect(report.igdbCoverage.sampleDuplicateSiblings[0]).toMatchObject({
        gameId: 109,
        siblingGameId: 103,
        siblingIgdbId: 1003,
        reason: 'title_or_edition_match',
      });

      const formatted = formatCoverageReport(report);
      expect(formatted).toContain('Overall Catalog Verification Coverage');
      expect(formatted).toContain(
        'Xbox One (49) & Xbox Series X (50) Gap Diagnosis',
      );
      expect(formatted).toContain(
        'IGDB Metadata Completeness & Duplicate Sibling Audit',
      );
    } finally {
      db.close();
    }
  });

  it('treats future non-CIAB releases as verified upcoming while leaving future CIAB releases unverified', () => {
    const db = new Database(':memory:');
    try {
      const schemaSql = fs.readFileSync(
        path.resolve(process.cwd(), 'migrations', 'schema.sql'),
        'utf8',
      );
      db.exec(schemaSql);
      db.exec(`
        INSERT INTO games (stable_id, id, title, platform_id)
        VALUES
          (201, '201', 'Romancing SaGa 3: Destinies United', 26),
          (202, '202', 'Future Code In A Box', 26);

        INSERT INTO canonical_releases (id, platform_id, raw_title, normalized_title, region, rom_name, source, is_verified_physical)
        VALUES
          (10, 26, 'Future Code In A Box', 'futurecodeinabox', 'USA', NULL, 'nscollectors_ciab', 0);

        INSERT INTO game_releases (id, game_id, region, release_date, variants, canonical_release_id)
        VALUES
          ('201-1', 201, 'USA', '2099-12-31', NULL, NULL),
          ('202-1', 202, 'USA', '2099-12-31', 'Code in a Box (Download Only)', 10);
      `);

      const report = generateCoverageReport(db);
      expect(report.overall.totalReleases).toBe(2);
      expect(report.overall.verifiedReleases).toBe(1);
      expect(report.overall.unverifiedReleases).toBe(1);
    } finally {
      db.close();
    }
  });
});
