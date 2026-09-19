/**
 * SMART OWNERSHIP & BACKUP RECONCILIATION SCRIPT
 *
 * Reconciles collection ownership discrepancies with backup reality:
 * 1. Inserts missing canonical retail releases (e.g. SNES Wolfenstein 3-D) and corrects misassigned beta ownership.
 * 2. Propagates ownership across companion discs in multi-disc box sets (e.g. MGS 3 Subsistence, Chrono Cross, FF IX).
 * 3. Reconciles single-disc version skew (e.g. GTA San Andreas v1.03 -> v3.00) where the backed-up retail release is the actual owned version.
 * 4. Outputs a surgical Cloudflare D1 migration script to `scripts/temp/reconcile_ownership.sql`.
 *
 * USAGE:
 *   npx tsx scripts/reconcile_ownership_and_backups.ts [--dry-run]
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { hasDiscIndicator } from './lib/queries.js';

interface ReleaseRow {
  id: string;
  game_id: number;
  region: string | null;
  variants: string | null;
  rom_name: string | null;
  rom_crc: string | null;
  backup_status: number;
  ownership_status: number;
  release_date: string | null;
  canonical_release_id: number | null;
  is_physical: number;
}

interface GameRow {
  stable_id: number;
  id: string;
  title: string;
  platform_id: number;
  backup_status: number;
  ownership_status: number;
}

export function runReconciliation(
  options: { dryRun?: boolean; dbPath?: string } = {},
) {
  const isDryRun = options.dryRun ?? process.argv.includes('--dry-run');
  const dbFile =
    options.dbPath ?? path.resolve(process.cwd(), 'collection.sqlite');

  console.log('=== Smart Ownership & Backup Reconciliation ===');
  console.log(
    `Mode: ${isDryRun ? 'DRY-RUN (No changes applied)' : 'LIVE (Applying changes to SQLite)'}`,
  );
  console.log(`Database: ${dbFile}\n`);

  const db = new Database(dbFile);
  const sqlStatements: string[] = [
    '-- Surgical Ownership & Backup Reconciliation for Cloudflare D1',
    `-- Generated on: ${new Date().toISOString()}`,
    '',
    'PRAGMA foreign_keys = OFF;',
    '',
  ];

  let totalChanges = 0;

  // =========================================================================
  // STEP 1: Fix SNES Wolfenstein 3D (Game 315) Missing Retail Release
  // =========================================================================
  console.log('--- Step 1: Checking SNES Wolfenstein 3D Retail Release ---');
  const snesWolfGame = db
    .prepare(
      "SELECT * FROM games WHERE platform_id = 15 AND title LIKE '%Wolfenstein%'",
    )
    .get() as GameRow | undefined;

  if (snesWolfGame) {
    const existingRetail = db
      .prepare(
        "SELECT * FROM game_releases WHERE game_id = ? AND rom_name LIKE 'Wolfenstein 3-D (USA)%'",
      )
      .get(snesWolfGame.stable_id) as ReleaseRow | undefined;

    if (!existingRetail) {
      console.log(
        `  [SNES Wolfenstein] Missing retail USA release for Game ${snesWolfGame.stable_id}. Inserting...`,
      );
      const newReleaseId =
        'wolfenstein-3-d-super-nintendo-entertainment-system-568375';
      const insertSql = `INSERT OR IGNORE INTO game_releases (
  id, game_id, region, variants, rom_name, rom_crc, backup_status, ownership_status,
  release_date, canonical_release_id, barcode, is_physical
) VALUES (
  '${newReleaseId}', ${snesWolfGame.stable_id}, 'USA', NULL, 'Wolfenstein 3-D (USA).sfc',
  NULL, 0, 1, NULL, 568375, NULL, 1
);`;

      // Clear ownership from Beta 2 if it was marked owned
      const unmarkBetaSql = `UPDATE game_releases SET ownership_status = 0 WHERE game_id = ${snesWolfGame.stable_id} AND variants LIKE '%Beta 2%';`;

      if (!isDryRun) {
        db.prepare(
          `
          INSERT OR IGNORE INTO game_releases (
            id, game_id, region, variants, rom_name, rom_crc, backup_status, ownership_status,
            release_date, canonical_release_id, barcode, is_physical
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        ).run(
          newReleaseId,
          snesWolfGame.stable_id,
          'USA',
          null,
          'Wolfenstein 3-D (USA).sfc',
          null,
          0,
          1,
          null,
          568375,
          null,
          1,
        );

        db.prepare(
          "UPDATE game_releases SET ownership_status = 0 WHERE game_id = ? AND variants LIKE '%Beta 2%'",
        ).run(snesWolfGame.stable_id);
      }

      sqlStatements.push(
        '-- Step 1: Add SNES Wolfenstein 3-D USA Retail Release',
      );
      sqlStatements.push(insertSql);
      sqlStatements.push(unmarkBetaSql);
      sqlStatements.push('');
      totalChanges++;
      console.log(
        '  -> Inserted Wolfenstein 3-D (USA).sfc with owned=1, set Beta 2 owned=0.',
      );
    } else {
      console.log('  -> Retail release already exists.');
    }
  } else {
    console.log('  -> SNES Wolfenstein game not found.');
  }

  // =========================================================================
  // STEP 2: Multi-Disc Box Set Ownership Propagation
  // =========================================================================
  console.log('\n--- Step 2: Propagating Ownership Across Multi-Disc Sets ---');
  const allReleases = db
    .prepare(
      'SELECT * FROM game_releases WHERE is_physical = 1 AND rom_name IS NOT NULL',
    )
    .all() as ReleaseRow[];

  function getMultiDiscEditionKey(
    romName: string | null | undefined,
    gameId: number,
    region: string | null,
  ): string {
    if (!romName) return '';
    let s = romName.toLowerCase().trim();
    // Strip file extension
    s = s.replace(/\.[a-z0-9]{1,5}$/i, '');
    // Strip (Disc N)
    s = s.replace(
      /[-_\s]*\(?Disc\s+[a-zA-Z0-9]+(?:\s+of\s+[0-9]+|\s*[/\\\\]\s*[0-9]+)?\)?/gi,
      '',
    );
    // Strip disc subtitles (e.g. Subsistence, Persistence, Existence, Campaign) while preserving revisions and regions
    s = s.replace(/\s*\((?!(?:rev|v\d|beta|demo)\b)[^)]+\)/gi, (match) => {
      const mLower = match.toLowerCase();
      if (
        mLower.includes('usa') ||
        mLower.includes('japan') ||
        mLower.includes('europe') ||
        mLower.includes('world') ||
        mLower.includes('canada') ||
        mLower.includes('germany') ||
        mLower.includes('france') ||
        mLower.includes('spain') ||
        mLower.includes('italy') ||
        mLower.includes('en,') ||
        mLower.includes('limited') ||
        mLower.includes('special') ||
        mLower.includes('collector')
      ) {
        return match;
      }
      return '';
    });
    // Strip Japanese counting indicators
    s = s.replace(/[-_\s]*\((?:ichi|ni|san|yon|shi|go)\)/gi, '');
    // Normalize whitespace
    s = s.replace(/\s+/g, ' ').trim();
    return `${gameId}|${region || 'unknown'}|${s}`;
  }

  // Group releases by game_id and multi-disc edition key
  const multiDiscGroups: Record<string, ReleaseRow[]> = {};
  for (const r of allReleases) {
    if (r.rom_name && hasDiscIndicator(r.rom_name)) {
      const groupKey = getMultiDiscEditionKey(r.rom_name, r.game_id, r.region);
      if (!multiDiscGroups[groupKey]) {
        multiDiscGroups[groupKey] = [];
      }
      multiDiscGroups[groupKey].push(r);
    }
  }

  let multiDiscUpdates = 0;
  for (const [key, releases] of Object.entries(multiDiscGroups)) {
    if (releases.length <= 1) continue;

    const hasOwned = releases.some((r) => r.ownership_status === 1);
    const unownedDiscs = releases.filter((r) => r.ownership_status === 0);

    if (hasOwned && unownedDiscs.length > 0) {
      console.log(`  [Multi-Disc Box Set] Group: ${key}`);
      for (const disc of unownedDiscs) {
        console.log(
          `    -> Setting owned=1 on "${disc.rom_name}" (id: ${disc.id})`,
        );
        if (!isDryRun) {
          db.prepare(
            'UPDATE game_releases SET ownership_status = 1 WHERE id = ?',
          ).run(disc.id);
        }
        sqlStatements.push(
          `UPDATE game_releases SET ownership_status = 1 WHERE id = '${disc.id}';`,
        );
        multiDiscUpdates++;
        totalChanges++;
      }
    }
  }
  console.log(
    `  Propagated ownership across ${multiDiscUpdates} companion disc(s).`,
  );

  // =========================================================================
  // STEP 3: Reconcile Single-Disc 1-to-1 Version Skew
  // =========================================================================
  console.log(
    '\n--- Step 3: Reconciling Single-Disc Version Skew (Backup -> Owned) ---',
  );
  // Find all games that have at least 1 owned release and at least 1 backed-up release
  const gamesWithSkew = db
    .prepare(
      `
    SELECT DISTINCT g.stable_id, g.title, g.platform_id
    FROM games g
    JOIN game_releases r1 ON g.stable_id = r1.game_id AND r1.ownership_status = 1
    JOIN game_releases r2 ON g.stable_id = r2.game_id AND r2.backup_status = 1
  `,
    )
    .all() as { stable_id: number; title: string; platform_id: number }[];

  let versionShiftCount = 0;
  for (const g of gamesWithSkew) {
    const gameRels = db
      .prepare(
        'SELECT * FROM game_releases WHERE game_id = ? AND is_physical = 1',
      )
      .all(g.stable_id) as ReleaseRow[];

    // Exclude multi-disc releases from version skew realignment (handled in Step 2)
    const singleDiscRels = gameRels.filter(
      (r) => !hasDiscIndicator(r.rom_name),
    );
    if (singleDiscRels.length === 0) continue;

    const ownedRels = singleDiscRels.filter((r) => r.ownership_status === 1);
    const backedUpRels = singleDiscRels.filter((r) => r.backup_status === 1);

    // If exactly 1 owned release that is NOT backed up,
    // and exactly 1 backed up release that is NOT owned (e.g. GTA San Andreas v1.03 -> v3.00)
    if (
      ownedRels.length === 1 &&
      backedUpRels.length === 1 &&
      ownedRels[0].id !== backedUpRels[0].id &&
      ownedRels[0].backup_status === 0 &&
      backedUpRels[0].ownership_status === 0
    ) {
      const oldOwned = ownedRels[0];
      const newOwned = backedUpRels[0];

      // Ensure neither is a demo/beta/mini-console (mini console ROMs shouldn't steal physical cartridge ownership)
      const isOldBetaOrDemo = Boolean(
        oldOwned.variants?.match(/beta|demo|mini|virtual console/i),
      );
      const isNewBetaOrDemo = Boolean(
        newOwned.variants?.match(/beta|demo|mini|virtual console/i),
      );

      if (!isOldBetaOrDemo && !isNewBetaOrDemo) {
        console.log(`  [Version Skew] Game ${g.stable_id} "${g.title}":`);
        console.log(
          `    Shift ownership: "${oldOwned.rom_name}" (owned=1, backup=0) -> "${newOwned.rom_name}" (owned=0, backup=1)`,
        );

        if (!isDryRun) {
          db.prepare(
            'UPDATE game_releases SET ownership_status = 0 WHERE id = ?',
          ).run(oldOwned.id);
          db.prepare(
            'UPDATE game_releases SET ownership_status = 1 WHERE id = ?',
          ).run(newOwned.id);
        }

        sqlStatements.push(`-- Version shift for ${g.title}`);
        sqlStatements.push(
          `UPDATE game_releases SET ownership_status = 0 WHERE id = '${oldOwned.id}';`,
        );
        sqlStatements.push(
          `UPDATE game_releases SET ownership_status = 1 WHERE id = '${newOwned.id}';`,
        );
        versionShiftCount++;
        totalChanges++;
      }
    }
  }
  console.log(
    `  Shifted ownership for ${versionShiftCount} version-skewed game(s).`,
  );

  // =========================================================================
  // STEP 4: Synchronize games table rollups
  // =========================================================================
  console.log('\n--- Step 4: Synchronizing games table rollups ---');
  if (!isDryRun) {
    db.prepare(
      `
      UPDATE games SET backup_status = (
        SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END
        FROM game_releases WHERE game_id = games.stable_id AND backup_status = 1
      )
    `,
    ).run();
  }

  sqlStatements.push('-- Step 4: Synchronize games rollups');
  sqlStatements.push(`UPDATE games SET backup_status = (
  SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END
  FROM game_releases WHERE game_id = games.stable_id AND backup_status = 1
);`);
  sqlStatements.push('');
  sqlStatements.push('PRAGMA foreign_keys = ON;');
  sqlStatements.push('');

  // =========================================================================
  // STEP 5: Write Cloudflare D1 Migration Script to scripts/temp/
  // =========================================================================
  const tempDir = path.resolve(process.cwd(), 'scripts', 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  const migrationPath = path.resolve(tempDir, 'reconcile_ownership.sql');
  fs.writeFileSync(migrationPath, sqlStatements.join('\n'), 'utf8');
  console.log(`\n✅ Generated Cloudflare D1 migration: ${migrationPath}`);
  console.log(`Total reconciliation operations: ${totalChanges}`);

  return { totalChanges, migrationPath };
}

import { fileURLToPath } from 'url';
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runReconciliation();
}
