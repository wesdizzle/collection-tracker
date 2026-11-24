import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { auditSqlCost } from './d1_cost_guard.js';
import {
  computeGameReleasesWriteFactor,
  generateDenormalizeBackfill,
} from './generate_denormalize_backfill.js';

describe('generateDenormalizeBackfill', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'denorm-backfill-spec-'));
    dbPath = path.join(tmpDir, 'baseline.db');
    db = new Database(dbPath);
    const schemaSql = fs.readFileSync(
      path.resolve(process.cwd(), 'migrations', 'schema.sql'),
      'utf8',
    );
    db.exec(schemaSql);

    db.exec(`
      INSERT INTO games (stable_id, id, title, platform_id)
      VALUES
        (100, '100', 'Bloodborne', 34),
        (101, '101', 'Astro Bot', 35),
        (102, '102', 'Metroid Prime 4', 27),
        (103, '103', 'Orphaned Title', 34),
        (104, '104', 'Already Synced', 35),
        (105, '105', 'Special Publisher', 34);

      INSERT INTO canonical_releases (id, platform_id, raw_title, normalized_title, region, serial_code, publisher, source, is_verified_physical)
      VALUES
        (10, 34, 'Bloodborne', 'blodborne', 'USA', 'CUSA-00900', 'Sony Computer Entertainment', 'dat', 1),
        (11, 35, 'Astro Bot', 'astrobot', 'USA', 'PPSA-21564', 'Sony Interactive Entertainment', 'ps5db', 1),
        (12, 27, 'Metroid Prime 4: Beyond', 'metroidprime4beyond', 'USA', 'BEE-001', 'Nintendo', 'nintendo_revised', 1),
        (13, 35, 'Already Synced', 'alreadysynced', 'USA', 'PPSA-00001', 'Test Pub', 'ps5db', 1),
        (14, 34, 'Tom Clancy''s Ghost Recon', 'tomclancysghostrecon', 'USA', NULL, 'Ubisoft', 'serialstation', 1);

      INSERT INTO game_releases (id, game_id, region, canonical_release_id, verified_source, serial_code, canonical_title, publisher)
      VALUES
        ('100-1', 100, 'USA', 10, NULL, NULL, NULL, NULL),
        ('101-1', 101, 'USA', 11, NULL, NULL, NULL, NULL),
        ('102-1', 102, 'USA', 12, 'lgn', NULL, 'Old Title', NULL),
        ('103-1', 103, 'USA', NULL, 'retail_catalog', 'OLD-01', 'Stale Title', 'Old Pub'),
        ('104-1', 104, 'USA', 13, 'ps5db', 'PPSA-00001', 'Already Synced', 'Test Pub'),
        ('105-1', 105, 'USA', 14, NULL, NULL, NULL, NULL);
    `);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('computes 1+K=8 write factor on game_releases and chunks idempotent backfill SQL cleanly within D1 cost guard', () => {
    expect(computeGameReleasesWriteFactor(db)).toBe(8);

    const outDir = path.join(tmpDir, 'out');
    // 16 writes/chunk permits at most 2 rows/chunk at 8x factor
    const result = generateDenormalizeBackfill({
      db,
      outDir,
      prefix: '05_backfill_',
      maxWrites: 16,
    });

    expect(result.writeFactorPerRow).toBe(8);
    expect(result.totalBackfilledRows).toBe(4);
    expect(result.totalClearedRows).toBe(1);
    expect(result.totalCandidateRows).toBe(5);
    expect(result.totalEstimatedWrites).toBe(40);
    expect(result.chunkPaths.length).toBe(3);

    // Every generated chunk passes D1 cost guard against baseline (0 unindexed scans, <= 16 writes)
    for (const chunkPath of result.chunkPaths) {
      const report = auditSqlCost(chunkPath, 16, dbPath);
      expect(report.unindexedScans).toEqual([]);
      expect(report.isWithinBudget).toBe(true);
      expect(report.totalBillableWrites).toBeLessThanOrEqual(16);
    }

    // Apply all chunks sequentially to baseline DB
    for (const chunkPath of result.chunkPaths) {
      db.exec(fs.readFileSync(chunkPath, 'utf8'));
    }

    const clearedRow = db
      .prepare(
        "SELECT verified_source, serial_code, canonical_title, publisher FROM game_releases WHERE id = '103-1'",
      )
      .get();
    expect(clearedRow).toEqual({
      verified_source: null,
      serial_code: null,
      canonical_title: null,
      publisher: null,
    });

    const ghostRecon = db
      .prepare(
        "SELECT verified_source, serial_code, canonical_title, publisher FROM game_releases WHERE id = '105-1'",
      )
      .get();
    expect(ghostRecon).toEqual({
      verified_source: 'serialstation',
      serial_code: null,
      canonical_title: "Tom Clancy's Ghost Recon",
      publisher: 'Ubisoft',
    });

    // Re-running after backfill produces 0 rows (fully idempotent)
    const outDir2 = path.join(tmpDir, 'out2');
    const secondRun = generateDenormalizeBackfill({
      db,
      outDir: outDir2,
      prefix: '05_backfill_',
      maxWrites: 14,
    });
    expect(secondRun.totalCandidateRows).toBe(0);
    expect(secondRun.totalEstimatedWrites).toBe(0);
    expect(secondRun.chunkPaths).toEqual([]);
  });
});
