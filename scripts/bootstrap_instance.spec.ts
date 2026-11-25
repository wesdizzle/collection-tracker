import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { bootstrapInstance } from './bootstrap_instance.js';
import { hydrateCanonicalReleasesFromSnapshotFile } from './d1_pull.js';

describe('bootstrapInstance & hydrateCanonicalReleasesFromSnapshotFile', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-spec-'));
    dbPath = path.join(tempDir, 'instance.db');
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('bootstraps schema, platforms, toy_series, and 547 retired toys into a fresh SQLite database', async () => {
    const result = await bootstrapInstance({
      dbPath,
      skipDatsSync: true,
    });

    expect(result.platformsCount).toBe(53);
    expect(result.toySeriesCount).toBe(41);
    expect(result.retiredToysCount).toBe(547);
    expect(result.curatedGamesCount).toBe(3);

    const db = new Database(dbPath, { readonly: true });
    const skylanders = (
      db
        .prepare("SELECT COUNT(*) as c FROM toys WHERE line = 'Skylanders'")
        .get() as { c: number }
    ).c;
    const starlink = (
      db
        .prepare("SELECT COUNT(*) as c FROM toys WHERE line = 'Starlink'")
        .get() as { c: number }
    ).c;
    const curatedPsvr = db
      .prepare(
        "SELECT title, platform_id, image_url, manually_verified FROM games WHERE platform_id = 34 AND title LIKE 'PlayStation VR Demo Disc%' ORDER BY title ASC",
      )
      .all() as Array<{
      title: string;
      platform_id: number;
      image_url: string;
      manually_verified: number;
    }>;
    db.close();

    expect(skylanders).toBe(512);
    expect(starlink).toBe(35);
    expect(curatedPsvr).toHaveLength(3);
    for (const row of curatedPsvr) {
      expect(row.platform_id).toBe(34);
      expect(row.image_url).toMatch(/^\/covers\/playstation-vr-demo-disc/);
      expect(row.manually_verified).toBe(0);
    }

    // Re-running curated-games phase stays idempotent
    const rerun = await bootstrapInstance({
      dbPath,
      phase: 'curated-games',
      skipDatsSync: true,
    });
    expect(rerun.curatedGamesCount).toBe(3);
  });

  it('hydrates canonical_releases from a companion R2 snapshot JSON file into local SQLite', async () => {
    await bootstrapInstance({
      dbPath,
      skipDatsSync: true,
    });

    const snapshotPath = path.join(tempDir, 'canonical_releases.json');
    const mockSnapshot = {
      timestamp: '2026-11-14T23:30:00.000Z',
      version: '1.0',
      metadata: {
        rowCount: 2,
        maxId: 102,
      },
      tables: {
        canonical_releases: [
          {
            id: 101,
            platform_id: 14,
            raw_title: 'Tetris (World)',
            normalized_title: 'tetris',
            region: 'World',
            variants: null,
            rom_name: 'Tetris (World).gb',
            rom_crc: '46df91ad',
            source: 'dat',
            is_verified_physical: 1,
          },
          {
            id: 102,
            platform_id: 26,
            raw_title: 'Super Mario Odyssey',
            normalized_title: 'supermarioodyssey',
            region: 'World',
            variants: '000',
            rom_name: null,
            rom_crc: null,
            serial_code: 'LA-H-AAACA',
            source: 'nintendo_revised',
            is_verified_physical: 1,
          },
        ],
      },
    };
    fs.writeFileSync(snapshotPath, JSON.stringify(mockSnapshot), 'utf8');

    const hydratedCount = hydrateCanonicalReleasesFromSnapshotFile(
      dbPath,
      snapshotPath,
    );
    expect(hydratedCount).toBe(2);

    const db = new Database(dbPath, { readonly: true });
    const rows = db
      .prepare(
        'SELECT id, raw_title, source FROM canonical_releases ORDER BY id',
      )
      .all();
    db.close();

    expect(rows).toEqual([
      { id: 101, raw_title: 'Tetris (World)', source: 'dat' },
      { id: 102, raw_title: 'Super Mario Odyssey', source: 'nintendo_revised' },
    ]);
  });
});
