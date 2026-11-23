/**
 * Unit Tests for Multi-Source Canonical Synchronization Utility
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import {
  parseSyncSourceFilterArg,
  syncCanonicalSources,
} from './sync_canonical_sources.js';

describe('syncCanonicalSources (Multi-Source Adapter Integration)', () => {
  let tmpDir: string;
  let sourcesDir: string;
  let dbPath: string;
  let sqlOutputPath: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-sources-spec-'));
    sourcesDir = path.join(tmpDir, 'sources');
    dbPath = path.join(tmpDir, 'test.db');
    sqlOutputPath = path.join(tmpDir, 'seed.sql');
    fs.mkdirSync(sourcesDir, { recursive: true });

    db = new Database(dbPath);
    const schemaSql = fs.readFileSync(
      path.resolve(process.cwd(), 'migrations', 'schema.sql'),
      'utf8',
    );
    db.exec(schemaSql);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('syncs non-DAT adapters selectively, skips unfetched sources without deleting, links game_releases, and stays idempotent', async () => {
    expect(parseSyncSourceFilterArg('ps5db,nscollectors')).toEqual([
      'ps5db',
      'nscollectors',
    ]);
    expect(() => parseSyncSourceFilterArg('unknown_src')).toThrow(
      /Unknown sync source/,
    );

    // Seed PS5DB + r/NSCollectors CSV files into isolated sourcesDir
    fs.writeFileSync(
      path.join(sourcesDir, 'ps5db.csv'),
      [
        'Title,Developer,Game Publisher,Physical Publisher,Limited,ESRB SKU,PEGI Rating',
        'Astro Bot,Team Asobi,Sony,Sony Interactive Entertainment,-,PPSA-21564,PEGI 7',
      ].join('\n'),
      'utf8',
    );

    const nsDir = path.join(sourcesDir, 'nscollectors');
    fs.mkdirSync(nsDir, { recursive: true });
    fs.writeFileSync(
      path.join(nsDir, 'sw1_master.csv'),
      'Title,Publisher,Region,Release Date\nMetroid Dread,Nintendo,NA,Oct 8 2021\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(nsDir, 'sw1_ciab.csv'),
      'Title,Publisher,Region\nOverwatch,Blizzard,NA\n',
      'utf8',
    );

    // Pre-existing serialstation row should NOT be deleted when serialstation artifact is missing
    db.exec(`
      INSERT INTO canonical_releases (platform_id, raw_title, normalized_title, region, serial_code, source, is_verified_physical)
      VALUES (34, 'Bloodborne', 'bloodborne', 'USA', 'CUSA00900', 'serialstation', 1);
      INSERT INTO games (stable_id, id, title, platform_id)
      VALUES (1001, '1001', 'Astro Bot', 35);
      INSERT INTO game_releases (id, game_id, region)
      VALUES ('1001-1', 1001, 'USA');
    `);

    // 1. Dry-run leaves DB untouched while reporting planned inserts and links
    const drySummary = await syncCanonicalSources({
      db,
      sources: ['ps5db', 'nscollectors', 'serialstation'],
      sourcesDir,
      dryRun: true,
      skipReconcile: true,
      sqlOutputPath,
    });
    expect(drySummary.insertedCount).toBe(3);
    expect(drySummary.deletedCount).toBe(0);
    expect(drySummary.linkedNonDatReleases).toBe(1);
    const countAfterDry = (
      db.prepare('SELECT COUNT(*) as c FROM canonical_releases').get() as {
        c: number;
      }
    ).c;
    expect(countAfterDry).toBe(1);

    // 2. Real sync applies inserts, preserves existing serialstation row, and links Astro Bot release
    const summary = await syncCanonicalSources({
      db,
      sources: ['ps5db', 'nscollectors', 'serialstation'],
      sourcesDir,
      dryRun: false,
      skipReconcile: true,
      sqlOutputPath,
    });
    expect(summary.insertedCount).toBe(3);
    expect(summary.updatedCount).toBe(0);
    expect(summary.deletedCount).toBe(0);
    expect(summary.linkedNonDatReleases).toBe(1);

    const linkedRel = db
      .prepare(
        "SELECT canonical_release_id FROM game_releases WHERE id = '1001-1'",
      )
      .get() as { canonical_release_id: number | null };
    expect(linkedRel.canonical_release_id).toBeGreaterThan(0);

    const ciabRow = db
      .prepare(
        "SELECT is_verified_physical, variants FROM canonical_releases WHERE source = 'nscollectors_ciab'",
      )
      .get() as { is_verified_physical: number; variants: string };
    expect(ciabRow.is_verified_physical).toBe(0);
    expect(ciabRow.variants).toContain('Code in a Box');

    // 3. Re-running is completely idempotent (0 writes)
    const rerun = await syncCanonicalSources({
      db,
      sources: ['ps5db', 'nscollectors', 'serialstation'],
      sourcesDir,
      dryRun: false,
      skipReconcile: true,
      sqlOutputPath,
    });
    expect(rerun.insertedCount).toBe(0);
    expect(rerun.updatedCount).toBe(0);
    expect(rerun.deletedCount).toBe(0);
    expect(rerun.linkedNonDatReleases).toBe(0);
  });

  it('filters ignored Redump <category> releases and routes PSVR Demo Discs from PS4 (34) DAT onto PSVR (51)', async () => {
    const datsDir = path.join(tmpDir, 'dats');
    fs.mkdirSync(datsDir, { recursive: true });
    fs.writeFileSync(
      path.join(datsDir, 'Sony - PlayStation 4.dat'),
      `<?xml version="1.0"?>
<datafile>
  <header>
    <name>Sony - PlayStation 4</name>
  </header>
  <game name="Bloodborne (USA)">
    <category>Games</category>
    <rom name="Bloodborne (USA).iso" size="1000" crc="aa112233"/>
  </game>
  <game name="Some Promotional Demo (USA)">
    <category>Demos</category>
    <rom name="Some Promotional Demo (USA).iso" size="1000" crc="bb112233"/>
  </game>
  <game name="PlayStation VR Demo Disc (USA)">
    <category>Demos</category>
    <rom name="PlayStation VR Demo Disc (USA).iso" size="1000" crc="6742a37b"/>
  </game>
  <game name="PlayStation VR Demo Disc 2.0 (USA)">
    <category>Demos</category>
    <rom name="PlayStation VR Demo Disc 2.0 (USA).iso" size="1000" crc="6c5cb267"/>
  </game>
</datafile>`,
      'utf8',
    );

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 })),
    );

    try {
      await syncCanonicalSources({
        db,
        sources: ['dats'],
        sourcesDir,
        dryRun: false,
        skipReconcile: true,
        sqlOutputPath,
      });

      const rows = db
        .prepare(
          'SELECT platform_id, raw_title FROM canonical_releases ORDER BY platform_id ASC, raw_title ASC',
        )
        .all() as Array<{ platform_id: number; raw_title: string }>;

      expect(rows).toEqual([
        { platform_id: 34, raw_title: 'Bloodborne' },
        { platform_id: 51, raw_title: 'PlayStation VR Demo Disc' },
        { platform_id: 51, raw_title: 'PlayStation VR Demo Disc 2.0' },
      ]);
    } finally {
      cwdSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
