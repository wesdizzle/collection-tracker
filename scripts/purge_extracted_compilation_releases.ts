/**
 * PURGE EXTRACTED COMPILATION RELEASES FROM PHYSICAL TRACKING
 *
 * Scans `game_releases` for ROM entries that were extracted from modern compilations,
 * digital services, or other hardware emulators (e.g. Super Mario Sunshine from Super Mario 3D All-Stars,
 * Animal Crossing NES minigame extracts, GameCube Zelda extracts on N64, Virtual Console extracts).
 *
 * Sets `is_physical = 0` on these records so they are treated as digital extracts
 * rather than phantom physical releases.
 *
 * Usage:
 *   npx tsx scripts/purge_extracted_compilation_releases.ts [--dry-run]
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getDatabase } from './lib/db.js';
import { isIgnoredFormatRelease } from './lib/dat_format.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const tempDir = path.join(rootDir, 'scripts', 'temp');

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

export function purgeExtractedCompilationReleases(isDryRun = false) {
  const db = getDatabase();
  console.log('=== Purge Extracted Compilation Releases ===\n');

  const candidates = db
    .prepare(
      `
    SELECT gr.id, gr.game_id, g.title, g.platform_id, p.name as platform_name,
           gr.variants, gr.rom_name, gr.rom_crc, gr.is_physical
    FROM game_releases gr
    JOIN games g ON gr.game_id = g.stable_id
    JOIN platforms p ON g.platform_id = p.id
    WHERE gr.is_physical = 1 AND gr.rom_name IS NOT NULL
  `,
    )
    .all() as Array<{
    id: string;
    game_id: number;
    title: string;
    platform_id: number;
    platform_name: string;
    variants: string | null;
    rom_name: string;
    rom_crc: string | null;
    is_physical: number;
  }>;

  const toDeclassify: typeof candidates = [];
  for (const c of candidates) {
    if (
      isIgnoredFormatRelease(
        c.variants || c.rom_name,
        c.rom_name,
        c.platform_id,
      )
    ) {
      toDeclassify.push(c);
    }
  }

  console.log(
    `Evaluated ${candidates.length} physical releases. Found ${toDeclassify.length} extracted compilation/digital releases to declassify.\n`,
  );

  const sqlStatements: string[] = [];
  const updateStmt = isDryRun
    ? null
    : db.prepare('UPDATE game_releases SET is_physical = 0 WHERE id = ?');

  for (const row of toDeclassify) {
    console.log(
      `  - [${row.platform_name}] "${row.title}" -> ${row.rom_name} (variant: ${row.variants || 'none'})`,
    );
    if (!isDryRun && updateStmt) {
      updateStmt.run(row.id);
    }
    sqlStatements.push(
      `UPDATE game_releases SET is_physical = 0 WHERE id = '${row.id.replace(/'/g, "''")}';`,
    );
  }

  const sqlFilePath = path.join(
    tempDir,
    'purge_extracted_compilation_releases.sql',
  );
  fs.writeFileSync(sqlFilePath, sqlStatements.join('\n'), 'utf8');

  console.log('\n=== Declassification Summary ===');
  console.log(
    `Releases declassified to is_physical = 0: ${toDeclassify.length}`,
  );
  console.log(
    `SQL statements generated:                 ${sqlStatements.length}`,
  );
  console.log(`SQL script saved to:                      ${sqlFilePath}`);
  console.log('================================\n');

  db.close();
  return {
    declassifiedCount: toDeclassify.length,
    sqlStatementsCount: sqlStatements.length,
    sqlFilePath,
  };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const isDryRun = process.argv.includes('--dry-run');
  purgeExtractedCompilationReleases(isDryRun);
}
