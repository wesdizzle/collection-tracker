/**
 * PURGE EXTRACTED COMPILATION RELEASES FROM PHYSICAL TRACKING
 *
 * Scans `game_releases` for ROM entries that were extracted from modern compilations,
 * digital services, or other hardware emulators (e.g. Super Mario Sunshine from Super Mario 3D All-Stars,
 * Animal Crossing NES minigame extracts, GameCube Zelda extracts on N64, Virtual Console extracts).
 *
 * Deletes these records from game_releases so digital extracts are not tracked as physical releases.
 *
 * Usage:
 *   npx tsx scripts/purge_extracted_compilation_releases.ts [--dry-run]
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getDatabase } from './lib/db.js';
import { isIgnoredFormatRelease } from './lib/source_format.js';

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
           gr.variants, gr.rom_name, gr.rom_crc
    FROM game_releases gr
    JOIN games g ON gr.game_id = g.stable_id
    JOIN platforms p ON g.platform_id = p.id
    WHERE gr.rom_name IS NOT NULL
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
  }>;

  const toDelete: typeof candidates = [];
  for (const c of candidates) {
    if (
      isIgnoredFormatRelease(
        c.variants || c.rom_name,
        c.rom_name,
        c.platform_id,
      )
    ) {
      toDelete.push(c);
    }
  }

  console.log(
    `Evaluated ${candidates.length} releases. Found ${toDelete.length} extracted compilation/digital releases to purge.\n`,
  );

  const sqlStatements: string[] = [];
  const deleteStmt = isDryRun
    ? null
    : db.prepare('DELETE FROM game_releases WHERE id = ?');

  for (const row of toDelete) {
    console.log(
      `  - [${row.platform_name}] "${row.title}" -> ${row.rom_name} (variant: ${row.variants || 'none'})`,
    );
    if (!isDryRun && deleteStmt) {
      deleteStmt.run(row.id);
    }
    sqlStatements.push(
      `DELETE FROM game_releases WHERE id = '${row.id.replace(/'/g, "''")}';`,
    );
  }

  const sqlFilePath = path.join(
    tempDir,
    'purge_extracted_compilation_releases.sql',
  );
  fs.writeFileSync(sqlFilePath, sqlStatements.join('\n'), 'utf8');

  console.log('\n=== Purge Summary ===');
  console.log(`Releases purged:                          ${toDelete.length}`);
  console.log(
    `SQL statements generated:                 ${sqlStatements.length}`,
  );
  console.log(`SQL script saved to:                      ${sqlFilePath}`);
  console.log('================================\n');

  db.close();
  return {
    declassifiedCount: toDelete.length,
    sqlStatementsCount: sqlStatements.length,
    sqlFilePath,
  };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const isDryRun = process.argv.includes('--dry-run');
  purgeExtractedCompilationReleases(isDryRun);
}
