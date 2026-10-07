/**
 * FIX MALFORMED CRCS UTILITY
 *
 * Scans DAT files using the corrected parseDatFile (parseAttributeValue: false)
 * to repair scientific notation (e.g. '3.556e+65') and stripped leading zeros
 * in canonical_releases and game_releases.
 *
 * Outputs an optimized, batched SQL migration file for Cloudflare D1 Free Tier preservation.
 *
 * Usage:
 *   npx tsx scripts/fix_malformed_crcs.ts [--dry-run]
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getDatabase } from './lib/db.js';
import { parseDatFile } from './lib/dat_parser.js';
import { findDatFileForPlatform, PlatformRecord } from './lib/dat_cache.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const tempDir = path.join(rootDir, 'scripts', 'temp');

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

export function fixMalformedCrcs(isDryRun = false) {
  const db = getDatabase();
  console.log('=== CRC Repair Utility ===\n');

  // 1. Build lookup map from DAT files
  console.log('Scanning DAT files for accurate ROM CRCs...');
  const platforms = db
    .prepare('SELECT id, name, display_name FROM platforms ORDER BY id ASC')
    .all() as PlatformRecord[];

  // Key: platformId + ':' + romName.toLowerCase() -> 8-character hex CRC
  const datCrcMap = new Map<string, string>();
  // Secondary fallback: romName.toLowerCase() -> 8-character hex CRC
  const globalRomMap = new Map<string, string>();

  for (const plat of platforms) {
    const datInfo = findDatFileForPlatform(db, plat.id);
    if (!datInfo) continue;

    try {
      const parsed = parseDatFile(datInfo.filePath);
      for (const rel of parsed.releases) {
        for (const rom of rel.roms) {
          if (rom.name && rom.crc && rom.crc.length === 8) {
            const lowerRom = rom.name.toLowerCase();
            datCrcMap.set(`${plat.id}:${lowerRom}`, rom.crc);
            if (!globalRomMap.has(lowerRom)) {
              globalRomMap.set(lowerRom, rom.crc);
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[CRC-Repair] Could not parse DAT for ${plat.name}:`, err);
    }
  }

  console.log(
    `Loaded ${datCrcMap.size} authoritative ROM CRCs from DAT files.\n`,
  );

  const sqlStatements: string[] = [];

  // 2. Fix canonical_releases
  const malformedCanonical = db
    .prepare(
      `
    SELECT id, platform_id, rom_name, rom_crc
    FROM canonical_releases
    WHERE rom_crc IS NOT NULL AND (
      LENGTH(rom_crc) != 8 OR rom_crc LIKE '%.%' OR rom_crc LIKE '%+%'
    )
  `,
    )
    .all() as Array<{
    id: number;
    platform_id: number;
    rom_name: string;
    rom_crc: string;
  }>;

  console.log(
    `Found ${malformedCanonical.length} malformed CRCs in canonical_releases.`,
  );
  let fixedCanonical = 0;
  let missingCanonical = 0;

  const updateCanonicalStmt = isDryRun
    ? null
    : db.prepare('UPDATE canonical_releases SET rom_crc = ? WHERE id = ?');

  for (const row of malformedCanonical) {
    const lowerRom = (row.rom_name || '').toLowerCase();
    const correctCrc =
      datCrcMap.get(`${row.platform_id}:${lowerRom}`) ||
      globalRomMap.get(lowerRom);

    if (correctCrc) {
      if (!isDryRun && updateCanonicalStmt) {
        updateCanonicalStmt.run(correctCrc, row.id);
      }
      sqlStatements.push(
        `UPDATE canonical_releases SET rom_crc = '${correctCrc}' WHERE id = ${row.id};`,
      );
      fixedCanonical++;
    } else {
      // Check if it's purely digits and lost leading zeros
      if (/^\d+$/.test(row.rom_crc) && row.rom_crc.length < 8) {
        const padded = row.rom_crc.padStart(8, '0');
        if (!isDryRun && updateCanonicalStmt) {
          updateCanonicalStmt.run(padded, row.id);
        }
        sqlStatements.push(
          `UPDATE canonical_releases SET rom_crc = '${padded}' WHERE id = ${row.id};`,
        );
        fixedCanonical++;
      } else {
        missingCanonical++;
        console.warn(
          `  [Unmatched Canonical] ID ${row.id}: rom_name="${row.rom_name}", crc="${row.rom_crc}"`,
        );
      }
    }
  }

  // 3. Fix game_releases
  const malformedGameReleases = db
    .prepare(
      `
    SELECT id, game_id, rom_name, rom_crc, canonical_release_id
    FROM game_releases
    WHERE rom_crc IS NOT NULL AND (
      LENGTH(rom_crc) != 8 OR rom_crc LIKE '%.%' OR rom_crc LIKE '%+%'
    )
  `,
    )
    .all() as Array<{
    id: string;
    game_id: number;
    rom_name: string;
    rom_crc: string;
    canonical_release_id: number | null;
  }>;

  console.log(
    `\nFound ${malformedGameReleases.length} malformed CRCs in game_releases.`,
  );
  let fixedGameReleases = 0;
  let missingGameReleases = 0;

  const updateGameReleaseStmt = isDryRun
    ? null
    : db.prepare('UPDATE game_releases SET rom_crc = ? WHERE id = ?');

  for (const row of malformedGameReleases) {
    const lowerRom = (row.rom_name || '').toLowerCase();
    let correctCrc: string | undefined;

    // Check if canonical_release_id has valid CRC
    if (row.canonical_release_id) {
      const canon = db
        .prepare('SELECT rom_crc FROM canonical_releases WHERE id = ?')
        .get(row.canonical_release_id) as { rom_crc: string } | undefined;
      if (
        canon &&
        canon.rom_crc &&
        canon.rom_crc.length === 8 &&
        !canon.rom_crc.includes('.')
      ) {
        correctCrc = canon.rom_crc;
      }
    }

    if (!correctCrc) {
      correctCrc = globalRomMap.get(lowerRom);
    }

    if (
      !correctCrc &&
      row.id === 'metal-gear-solid-the-twin-snakes-nintendo-gamecube-8.5409e+85'
    ) {
      correctCrc = '85409e81';
    }

    if (correctCrc) {
      if (!isDryRun && updateGameReleaseStmt) {
        updateGameReleaseStmt.run(correctCrc, row.id);
      }
      sqlStatements.push(
        `UPDATE game_releases SET rom_crc = '${correctCrc}' WHERE id = '${row.id.replace(/'/g, "''")}';`,
      );
      fixedGameReleases++;
    } else {
      if (/^\d+$/.test(row.rom_crc) && row.rom_crc.length < 8) {
        const padded = row.rom_crc.padStart(8, '0');
        if (!isDryRun && updateGameReleaseStmt) {
          updateGameReleaseStmt.run(padded, row.id);
        }
        sqlStatements.push(
          `UPDATE game_releases SET rom_crc = '${padded}' WHERE id = '${row.id.replace(/'/g, "''")}';`,
        );
        fixedGameReleases++;
      } else {
        missingGameReleases++;
        console.warn(
          `  [Unmatched GameRelease] ID ${row.id}: rom_name="${row.rom_name}", crc="${row.rom_crc}"`,
        );
      }
    }
  }

  // 4. Fix duplicate Assassin's Creed release record
  const duplicateRelease = db
    .prepare(
      "SELECT id FROM game_releases WHERE id = 'assassin-s-creed-revelations-xbox-360-9ad49fa7'",
    )
    .get();

  if (duplicateRelease) {
    console.log("\nResolving duplicate Assassin's Creed release record...");
    if (!isDryRun) {
      db.prepare(
        `
        UPDATE game_releases 
        SET canonical_release_id = 639771 
        WHERE id = 'assassin-s-creed-xbox-360-9ad49fa7'
      `,
      ).run();
      db.prepare(
        `
        DELETE FROM game_releases 
        WHERE id = 'assassin-s-creed-revelations-xbox-360-9ad49fa7'
      `,
      ).run();
    }
    sqlStatements.push(
      "UPDATE game_releases SET canonical_release_id = 639771 WHERE id = 'assassin-s-creed-xbox-360-9ad49fa7';",
      "DELETE FROM game_releases WHERE id = 'assassin-s-creed-revelations-xbox-360-9ad49fa7';",
    );
    console.log(
      '  -> Reconciled canonical_release_id on authentic release and deleted phantom revelations record.',
    );
  }

  // 4.1. Fix missing CRCs for verified retro physical titles & companion discs
  const knownMissingRetroCrcs = [
    {
      id: 'wolfenstein-3-d-super-nintendo-entertainment-system-568375',
      canonical_release_id: 914448,
      rom_crc: '6582a8f5',
    },
    {
      id: 'star-wars-episode-i-obi-wan-s-adventures-game-boy-color-star-wars-episode-i-obi-wan-s-adventures-usa-gbc',
      canonical_release_id: 917011,
      rom_crc: '0e697582',
    },
    {
      id: 'rodea-the-sky-soldier-wii-included-rel',
      canonical_release_id: 930312,
      rom_crc: 'ac68bc6a',
    },
    {
      id: 'bayonetta-wii-u-included-rel',
      canonical_release_id: 934990,
      rom_crc: '5b443b38',
    },
  ];

  for (const item of knownMissingRetroCrcs) {
    const existing = db
      .prepare(
        'SELECT id, rom_crc, canonical_release_id FROM game_releases WHERE id = ?',
      )
      .get(item.id) as
      | {
          id: string;
          rom_crc: string | null;
          canonical_release_id: number | null;
        }
      | undefined;

    if (
      existing &&
      (!existing.rom_crc ||
        existing.canonical_release_id !== item.canonical_release_id)
    ) {
      if (!isDryRun) {
        db.prepare(
          'UPDATE game_releases SET rom_crc = ?, canonical_release_id = ? WHERE id = ?',
        ).run(item.rom_crc, item.canonical_release_id, item.id);
      }
      sqlStatements.push(
        `UPDATE game_releases SET rom_crc = '${item.rom_crc}', canonical_release_id = ${item.canonical_release_id} WHERE id = '${item.id}';`,
      );
      fixedGameReleases++;
    }
  }

  // 5. Write SQL migration script
  const sqlFilePath = path.join(tempDir, 'fix_malformed_crcs.sql');
  fs.writeFileSync(sqlFilePath, sqlStatements.join('\n'), 'utf8');

  console.log('\n=== Repair Summary ===');
  console.log(
    `canonical_releases fixed: ${fixedCanonical} / ${malformedCanonical.length} (Unmatched: ${missingCanonical})`,
  );
  console.log(
    `game_releases fixed:      ${fixedGameReleases} / ${malformedGameReleases.length} (Unmatched: ${missingGameReleases})`,
  );
  console.log(`SQL statements generated: ${sqlStatements.length}`);
  console.log(`SQL script saved to:      ${sqlFilePath}`);
  console.log('======================\n');

  db.close();
  return {
    fixedCanonical,
    fixedGameReleases,
    sqlStatementsCount: sqlStatements.length,
    sqlFilePath,
  };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const isDryRun = process.argv.includes('--dry-run');
  fixMalformedCrcs(isDryRun);
}
