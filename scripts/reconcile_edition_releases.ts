import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import {
  titlesMatch,
  normalizeTitleForMatching,
} from './lib/title_matching.js';
import { cleanTitleWithoutParentheticals } from './lib/canonical_releases.js';
import { BOX_SET_DEFINITIONS } from './lib/special_labels.js';
import { matchesBoxSetDiscSpec } from './lib/queries.js';

interface CliArgs {
  dryRun: boolean;
  dbPath: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-n');
  const dbIndex = args.indexOf('--db');
  const dbPath =
    dbIndex !== -1 && args[dbIndex + 1]
      ? args[dbIndex + 1]
      : path.resolve('collection.sqlite');
  return { dryRun, dbPath };
}

function getDiffScore(candidateTitle: string, relTitle: string): number {
  const normG = normalizeTitleForMatching(candidateTitle);
  const normRel = normalizeTitleForMatching(relTitle);
  let diff = Math.abs(normG.length - normRel.length);

  const brandRegex =
    /^\s*['"]?(disney|sega|nintendo|sony|microsoft|capcom|konami|namco|square enix|square|enix|atari|ubisoft|ea|marvel|sid meiers?|tom clancys?|lego|nickelodeon|lara croft)s?\b/i;
  const gHasBrand = brandRegex.test(candidateTitle);
  const relHasBrand = brandRegex.test(relTitle);

  if (gHasBrand && !relHasBrand) diff += 1000;
  return diff;
}

export const BOX_SET_DISC_SEEDS = [
  // God of War Saga (PS3: 10003)
  {
    id: 'god-of-war-saga-playstation-3-02245c63',
    game_id: 10003,
    region: 'USA, Canada',
    also_released_as: 'God of War Collection',
    rom_name: 'God of War Collection (USA, Canada) (v02.00).iso',
    rom_crc: '02245c63',
  },
  {
    id: 'god-of-war-saga-playstation-3-d44f7b66',
    game_id: 10003,
    region: 'USA, Canada',
    also_released_as: 'God of War III, Greatest Hits',
    rom_name: 'God of War III (USA, Canada) (v02.00).iso',
    rom_crc: 'd44f7b66',
  },
  // Infamous Collection (PS3: 10004)
  {
    id: 'infamous-collection-playstation-3-bf628d43',
    game_id: 10004,
    region: 'USA, Canada',
    also_released_as: 'Infamous',
    rom_name: 'Infamous (USA, Canada) (En,Fr,Es) (v02.00).iso',
    rom_crc: 'bf628d43',
  },
  {
    id: 'infamous-collection-playstation-3-581c29e5',
    game_id: 10004,
    region: 'USA, Canada',
    also_released_as: 'Infamous 2',
    rom_name: 'Infamous 2 (USA, Canada) (En,Fr,Es,Pt) (v02.00).iso',
    rom_crc: '581c29e5',
  },
  // GTA The Trilogy (PS2: 10011, Xbox: 10012)
  {
    id: 'grand-theft-auto-the-trilogy-playstation-2-431c2b33',
    game_id: 10011,
    region: 'USA, Canada',
    also_released_as: 'Grand Theft Auto III',
    rom_name: 'Grand Theft Auto III (USA, Canada).iso',
    rom_crc: '431c2b33',
  },
  {
    id: 'grand-theft-auto-the-trilogy-xbox-48205a94',
    game_id: 10012,
    region: 'USA',
    also_released_as: 'Grand Theft Auto III',
    rom_name: 'Grand Theft Auto III (USA).iso',
    rom_crc: '48205a94',
  },
  {
    id: 'grand-theft-auto-the-trilogy-xbox-06ca09d6',
    game_id: 10012,
    region: 'Europe',
    also_released_as: 'Grand Theft Auto III',
    rom_name: 'Grand Theft Auto III (Europe) (En,Fr,De,Es,It).iso',
    rom_crc: '06ca09d6',
  },
  // Mass Effect Trilogy (PS3: 2518)
  {
    id: 'mass-effect-trilogy-playstation-3-2fa6821f',
    game_id: 2518,
    region: 'USA, Asia',
    also_released_as: 'Mass Effect 2',
    rom_name: 'Mass Effect 2 (USA, Asia) (En,Fr,De,Es,It,Ru).iso',
    rom_crc: '2fa6821f',
  },
  {
    id: 'mass-effect-trilogy-playstation-3-52e7e724',
    game_id: 2518,
    region: 'USA, Asia',
    also_released_as: 'Mass Effect 3',
    rom_name: 'Mass Effect 3 (USA, Asia) (En,Ja,Fr,De,Es,It,Pl,Ru).iso',
    rom_crc: '52e7e724',
  },
  {
    id: 'mass-effect-trilogy-playstation-3-15dd8584',
    game_id: 2518,
    region: 'Europe',
    also_released_as: 'Mass Effect 2',
    rom_name: 'Mass Effect 2 (Europe, Australia) (En,Fr,De,Es,It,Ru).iso',
    rom_crc: '15dd8584',
  },
  {
    id: 'mass-effect-trilogy-playstation-3-ff847606',
    game_id: 2518,
    region: 'Europe',
    also_released_as: 'Mass Effect 3',
    rom_name: 'Mass Effect 3 (Europe) (En,Ja,Fr,De,Es,It,Pl,Ru).iso',
    rom_crc: 'ff847606',
  },
  // Mass Effect Trilogy (Xbox 360: 10006)
  {
    id: 'mass-effect-trilogy-xbox-360-721a2fe8',
    game_id: 10006,
    region: 'USA, Europe',
    also_released_as: 'Mass Effect 2',
    rom_name: 'Mass Effect 2 (USA, Europe) (En,Es) (Disc 1).iso',
    rom_crc: '721a2fe8',
  },
  {
    id: 'mass-effect-trilogy-xbox-360-5929ffb4',
    game_id: 10006,
    region: 'USA, Europe',
    also_released_as: 'Mass Effect 2',
    rom_name: 'Mass Effect 2 (USA, Europe) (En,Es) (Disc 2).iso',
    rom_crc: '5929ffb4',
  },
  {
    id: 'mass-effect-trilogy-xbox-360-20b2108a',
    game_id: 10006,
    region: 'World',
    also_released_as: 'Mass Effect 3',
    rom_name: 'Mass Effect 3 (World) (En,Ja,Fr,De,Es,It,Pl,Ru) (Disc 1).iso',
    rom_crc: '20b2108a',
  },
  {
    id: 'mass-effect-trilogy-xbox-360-ec4d6981',
    game_id: 10006,
    region: 'World',
    also_released_as: 'Mass Effect 3',
    rom_name: 'Mass Effect 3 (World) (En,Ja,Fr,De,Es,It,Pl,Ru) (Disc 2).iso',
    rom_crc: 'ec4d6981',
  },
  // Assassin's Creed Heritage Collection (Xbox 360: 10010)
  {
    id: 'assassin-s-creed-heritage-collection-xbox-360-f3acd0e7',
    game_id: 10010,
    region: 'Europe',
    also_released_as: "Assassin's Creed",
    rom_name: "Assassin's Creed (USA, Europe) (En,Fr,De,Es,It) (Rev 1).iso",
    rom_crc: 'f3acd0e7',
  },
  {
    id: 'assassin-s-creed-heritage-collection-xbox-360-5f0b600d',
    game_id: 10010,
    region: 'Europe',
    also_released_as: "Assassin's Creed Brotherhood",
    rom_name:
      "Assassin's Creed - Brotherhood (USA, Europe) (En,Fr,De,Es,It,Nl,Pt,Sv,No,Da).iso",
    rom_crc: '5f0b600d',
  },
  {
    id: 'assassin-s-creed-heritage-collection-xbox-360-5e0fcfbb',
    game_id: 10010,
    region: 'Europe',
    also_released_as: "Assassin's Creed Revelations",
    rom_name:
      "Assassin's Creed - Revelations (USA, Europe) (En,Fr,De,Es,It,Nl,Pt,Sv,No,Da).iso",
    rom_crc: '5e0fcfbb',
  },
];

export function runReconciliation(options?: {
  dryRun?: boolean;
  dbPath?: string;
}): {
  deletesCount: number;
  updatesCount: number;
  preservedOwnedCount: number;
  sqlPath: string;
} {
  const { dryRun, dbPath } = options || parseArgs();

  console.log(`\n======================================================`);
  console.log(`Starting Edition & Sibling Release Reconciliation`);
  console.log(`Database: ${dbPath}`);
  console.log(
    `Dry Run:  ${dryRun ? 'YES (No DB changes will be applied)' : 'NO (Live DB will be modified)'}`,
  );
  console.log(`======================================================\n`);

  interface SharedReleaseRow {
    rom_crc: string | null;
    rom_name: string | null;
    platform_id: number;
    platform_name: string;
    game_count: number;
  }

  interface CanonicalReleaseRow {
    id: number;
    platform_id: number;
    rom_crc: string | null;
    rom_name: string | null;
  }

  interface CandidateReleaseRow {
    release_id: string;
    game_id: number;
    game_title: string;
    rom_name: string | null;
    rom_crc: string | null;
    region: string | null;
    ownership_status: number;
    backup_status: number;
    canonical_release_id: number | null;
  }

  const db = new Database(dbPath);

  // Find all game releases that appear under more than one game on the same platform
  const sharedReleases = db
    .prepare(
      `
    SELECT 
      gr.rom_crc,
      gr.rom_name,
      g.platform_id,
      p.name as platform_name,
      COUNT(DISTINCT gr.game_id) as game_count
    FROM game_releases gr
    JOIN games g ON gr.game_id = g.stable_id
    JOIN platforms p ON g.platform_id = p.id
    WHERE (gr.rom_crc IS NOT NULL AND gr.rom_crc != '')
       OR (gr.rom_name IS NOT NULL AND gr.rom_name != '')
    GROUP BY g.platform_id, COALESCE(gr.rom_crc, gr.rom_name)
    HAVING game_count > 1
  `,
    )
    .all() as SharedReleaseRow[];

  console.log(
    `Found ${sharedReleases.length} shared ROMs across multiple games on same platform.`,
  );

  // Pre-load canonical releases mapped by platform and CRC/name
  const canonicalList = db
    .prepare(
      `
    SELECT id, platform_id, rom_crc, rom_name
    FROM canonical_releases
    WHERE (rom_crc IS NOT NULL AND rom_crc != '')
       OR (rom_name IS NOT NULL AND rom_name != '')
  `,
    )
    .all() as CanonicalReleaseRow[];

  const canonicalByCrc = new Map<string, number>();
  const canonicalByName = new Map<string, number>();
  for (const cr of canonicalList) {
    if (cr.rom_crc)
      canonicalByCrc.set(`${cr.platform_id}:${cr.rom_crc}`, cr.id);
    if (cr.rom_name)
      canonicalByName.set(`${cr.platform_id}:${cr.rom_name}`, cr.id);
  }

  const deletes: Array<{
    releaseId: string;
    gameId: number;
    gameTitle: string;
    romName: string | null;
    romCrc: string | null;
    reason: string;
  }> = [];

  const canonicalUpdates: Array<{
    releaseId: string;
    gameId: number;
    gameTitle: string;
    romName: string | null;
    romCrc: string | null;
    canonicalId: number;
    oldCanonicalId: number | null;
  }> = [];

  const preservedOwned: Array<{
    releaseId: string;
    gameId: number;
    gameTitle: string;
    romName: string | null;
    romCrc: string | null;
    ownershipStatus: number;
    backupStatus: number;
  }> = [];

  for (const sr of sharedReleases) {
    const rows = db
      .prepare(
        `
      SELECT 
        gr.id as release_id,
        gr.game_id,
        g.title as game_title,
        gr.rom_name,
        gr.rom_crc,
        gr.region,
        gr.ownership_status,
        gr.backup_status,
        gr.canonical_release_id
      FROM game_releases gr
      JOIN games g ON gr.game_id = g.stable_id
      WHERE g.platform_id = ?
        AND (
          (gr.rom_crc = ? AND gr.rom_crc IS NOT NULL AND gr.rom_crc != '')
          OR (gr.rom_name = ? AND gr.rom_name IS NOT NULL AND gr.rom_name != '')
        )
    `,
      )
      .all(sr.platform_id, sr.rom_crc, sr.rom_name) as CandidateReleaseRow[];

    const rawTitle = (sr.rom_name || '').replace(/\.[a-zA-Z0-9]+$/, '');
    const cleanTitle = cleanTitleWithoutParentheticals(rawTitle);

    // Score candidate games
    const evaluated = rows.map((r) => {
      const matches = titlesMatch(
        r.game_title,
        cleanTitle,
        rawTitle,
        sr.platform_id,
      );
      const score = getDiffScore(r.game_title, cleanTitle);
      return { ...r, matches, score };
    });

    // Sort: matching games first, then lowest specificity difference score
    evaluated.sort((a, b) => {
      if (a.matches && !b.matches) return -1;
      if (!a.matches && b.matches) return 1;
      return a.score - b.score;
    });

    const best = evaluated[0];
    const secondBest = evaluated[1];

    const isDecisiveWinner =
      (best.matches && !secondBest.matches) ||
      (best.matches && secondBest.matches && best.score < secondBest.score);

    if (!isDecisiveWinner) {
      continue;
    }

    // Find correct canonical release ID for this ROM
    const targetCanonicalId =
      (sr.rom_crc && canonicalByCrc.get(`${sr.platform_id}:${sr.rom_crc}`)) ||
      (sr.rom_name && canonicalByName.get(`${sr.platform_id}:${sr.rom_name}`));

    if (targetCanonicalId && best.canonical_release_id !== targetCanonicalId) {
      canonicalUpdates.push({
        releaseId: best.release_id,
        gameId: best.game_id,
        gameTitle: best.game_title,
        romName: best.rom_name,
        romCrc: best.rom_crc,
        canonicalId: targetCanonicalId,
        oldCanonicalId: best.canonical_release_id,
      });
    }

    // Non-best candidates are processed for deletion
    const losers = evaluated.slice(1);
    for (const loser of losers) {
      const isOwned = loser.ownership_status > 0 || loser.backup_status > 0;
      if (isOwned) {
        preservedOwned.push({
          releaseId: loser.release_id,
          gameId: loser.game_id,
          gameTitle: loser.game_title,
          romName: loser.rom_name,
          romCrc: loser.rom_crc,
          ownershipStatus: loser.ownership_status,
          backupStatus: loser.backup_status,
        });
        continue;
      }

      // Check if loser is a legitimate Box Set companion disc defined in BOX_SET_DEFINITIONS
      const boxSet = BOX_SET_DEFINITIONS.find(
        (b) =>
          b.platformId === sr.platform_id &&
          b.boxSetDisplayTitle.toLowerCase() === loser.game_title.toLowerCase(),
      );
      if (
        boxSet &&
        boxSet.discs.some((spec) => matchesBoxSetDiscSpec(loser, spec))
      ) {
        // Legitimate companion disc in a multi-game box set! Do not delete!
        continue;
      }

      deletes.push({
        releaseId: loser.release_id,
        gameId: loser.game_id,
        gameTitle: loser.game_title,
        romName: loser.rom_name,
        romCrc: loser.rom_crc,
        reason: `Duplicate of better match on [${best.game_id}] "${best.game_title}"`,
      });
    }
  }

  console.log(
    `Identified ${deletes.length} duplicate unowned releases to prune.`,
  );
  console.log(
    `Identified ${canonicalUpdates.length} releases needing canonical_release_id link/correction.`,
  );
  console.log(
    `Preserved ${preservedOwned.length} releases with user ownership or backup status.`,
  );

  // Generate D1 Migration SQL File
  const tempDir = path.resolve('scripts/temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const sqlPath = path.join(tempDir, 'reconcile_edition_releases.sql');
  const sqlLines: string[] = [];

  sqlLines.push(
    `-- =====================================================================`,
  );
  sqlLines.push(`-- Migration: Reconcile Edition and Sibling Game Releases`);
  sqlLines.push(`-- Generated: ${new Date().toISOString()}`);
  sqlLines.push(
    `-- Purpose: Prune unowned cross-pollinated duplicate releases between`,
  );
  sqlLines.push(
    `--          base games and edition/sibling games, and link legitimate`,
  );
  sqlLines.push(`--          releases to their canonical_releases records.`);
  sqlLines.push(`-- Total Deletions: ${deletes.length}`);
  sqlLines.push(`-- Total Canonical ID Updates: ${canonicalUpdates.length}`);
  sqlLines.push(
    `-- Total Preserved Owned/Backed-Up Rows: ${preservedOwned.length}`,
  );
  sqlLines.push(
    `-- =====================================================================\n`,
  );

  sqlLines.push(
    `-- 1. Ensure Box Set companion discs are correctly seeded and re-homed`,
  );
  for (const s of BOX_SET_DISC_SEEDS) {
    const alsoEscaped = s.also_released_as.replace(/'/g, "''");
    const romNameEscaped = s.rom_name.replace(/'/g, "''");
    sqlLines.push(
      `INSERT OR IGNORE INTO game_releases (id, game_id, region, variants, also_released_as, rom_name, rom_crc, backup_status, ownership_status, has_case, has_manual) VALUES ('${s.id}', ${s.game_id}, '${s.region}', NULL, '${alsoEscaped}', '${romNameEscaped}', '${s.rom_crc}', 0, 0, 0, 0);`,
    );
  }

  sqlLines.push(
    `\n-- 2. Link legitimate releases to correct canonical_releases entries`,
  );
  for (const u of canonicalUpdates) {
    sqlLines.push(
      `UPDATE game_releases SET canonical_release_id = ${u.canonicalId} WHERE id = '${u.releaseId}';`,
    );
  }

  sqlLines.push(
    `\n-- 3. Prune unowned cross-pollinated duplicate game releases`,
  );
  for (const d of deletes) {
    // Safety guard in SQL: never delete if ownership_status > 0 or backup_status > 0
    sqlLines.push(
      `DELETE FROM game_releases WHERE id = '${d.releaseId}' AND ownership_status = 0 AND backup_status = 0;`,
    );
  }

  fs.writeFileSync(sqlPath, sqlLines.join('\n'), 'utf8');
  console.log(`\nGenerated D1 Migration SQL script: ${sqlPath}`);

  // Apply to SQLite if not dry-run
  if (!dryRun) {
    console.log(`\nApplying changes to SQLite database (${dbPath})...`);
    const applyTx = db.transaction(() => {
      const seedStmt = db.prepare(`
        INSERT OR IGNORE INTO game_releases (id, game_id, region, variants, also_released_as, rom_name, rom_crc, backup_status, ownership_status, has_case, has_manual)
        VALUES (?, ?, ?, NULL, ?, ?, ?, 0, 0, 0, 0)
      `);
      for (const s of BOX_SET_DISC_SEEDS) {
        seedStmt.run(
          s.id,
          s.game_id,
          s.region,
          s.also_released_as,
          s.rom_name,
          s.rom_crc,
        );
      }

      const updateStmt = db.prepare(
        `UPDATE game_releases SET canonical_release_id = ? WHERE id = ?`,
      );
      for (const u of canonicalUpdates) {
        updateStmt.run(u.canonicalId, u.releaseId);
      }

      const deleteStmt = db.prepare(
        `DELETE FROM game_releases WHERE id = ? AND ownership_status = 0 AND backup_status = 0`,
      );
      for (const d of deletes) {
        deleteStmt.run(d.releaseId);
      }
    });

    applyTx();
    console.log(
      `Successfully applied ${canonicalUpdates.length} updates and ${deletes.length} deletions to SQLite!`,
    );
  } else {
    console.log(`\n[DRY RUN] No modifications written to SQLite.`);
  }

  db.close();

  return {
    deletesCount: deletes.length,
    updatesCount: canonicalUpdates.length,
    preservedOwnedCount: preservedOwned.length,
    sqlPath,
  };
}

if (
  process.argv[1] &&
  process.argv[1].endsWith('reconcile_edition_releases.ts')
) {
  runReconciliation();
}
