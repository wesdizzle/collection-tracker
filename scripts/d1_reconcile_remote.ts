/**
 * REMOTE CLOUDFLARE D1 EDITION & SIBLING RECONCILIATION DEPLOYER
 *
 * Executes the surgical reconciliation migration on remote Cloudflare D1 (collection-db),
 * ensuring minimum writes by applying conditional guards on updates and batching statements
 * in safe <= 8KB chunks.
 *
 * USAGE:
 *   npx tsx scripts/d1_reconcile_remote.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { BOX_SET_DISC_SEEDS } from './reconcile_edition_releases.js';

const tempDir = path.resolve('scripts/temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// 1. Read existing reconcile_edition_releases.sql
const sqlPath = path.join(tempDir, 'reconcile_edition_releases.sql');
if (!fs.existsSync(sqlPath)) {
  console.error(
    `Error: ${sqlPath} not found. Run scripts/reconcile_edition_releases.ts first.`,
  );
  process.exit(1);
}

const rawContent = fs.readFileSync(sqlPath, 'utf8');
const lines = rawContent.split('\n').map((l) => l.trim());

// 2. Prepare write-minimized statements
const statements: string[] = [];

// Phase 1: Box Set Seed Records
for (const s of BOX_SET_DISC_SEEDS) {
  const alsoEscaped = s.also_released_as.replace(/'/g, "''");
  const romNameEscaped = s.rom_name.replace(/'/g, "''");
  statements.push(
    `INSERT OR IGNORE INTO game_releases (id, game_id, region, variants, also_released_as, rom_name, rom_crc, backup_status, ownership_status, has_case, has_manual) VALUES ('${s.id}', ${s.game_id}, '${s.region}', NULL, '${alsoEscaped}', '${romNameEscaped}', '${s.rom_crc}', 0, 0, 0, 0);`,
  );
}

// Phase 2: Canonical ID updates with write-minimizing condition
for (const line of lines) {
  const m = line.match(
    /^UPDATE game_releases SET canonical_release_id = (\d+) WHERE id = '([^']+)';$/,
  );
  if (m) {
    const canonicalId = m[1];
    const relId = m[2];
    // Only write if not already set to this value
    statements.push(
      `UPDATE game_releases SET canonical_release_id = ${canonicalId} WHERE id = '${relId}' AND (canonical_release_id IS NULL OR canonical_release_id != ${canonicalId});`,
    );
  }
}

// Phase 3: Prune unowned duplicates
for (const line of lines) {
  const m = line.match(
    /^DELETE FROM game_releases WHERE id = '([^']+)' AND ownership_status = 0 AND backup_status = 0;$/,
  );
  if (m) {
    const relId = m[1];
    statements.push(
      `DELETE FROM game_releases WHERE id = '${relId}' AND ownership_status = 0 AND backup_status = 0;`,
    );
  }
}

console.log(`=== Remote Cloudflare D1 Edition Reconciliation ===\n`);
console.log(`Total Statements Prepared: ${statements.length}`);
console.log(`  - Box set seeds:   ${BOX_SET_DISC_SEEDS.length}`);
console.log(
  `  - Canonical updates: ${lines.filter((l) => l.startsWith('UPDATE ')).length}`,
);
console.log(
  `  - Duplicate deletes: ${lines.filter((l) => l.startsWith('DELETE ')).length}\n`,
);

// 3. Group statements into chunks <= 7500 bytes (to comply with Wrangler 8KB payload limit)
const MAX_CHUNK_BYTES = 7500;
const chunks: string[] = [];
let currentChunk: string[] = [];
let currentSize = 0;

for (const stmt of statements) {
  if (
    currentSize + stmt.length + 1 > MAX_CHUNK_BYTES &&
    currentChunk.length > 0
  ) {
    chunks.push(currentChunk.join('\n'));
    currentChunk = [stmt];
    currentSize = stmt.length;
  } else {
    currentChunk.push(stmt);
    currentSize += stmt.length + 1;
  }
}
if (currentChunk.length > 0) {
  chunks.push(currentChunk.join('\n'));
}

console.log(`Executing in ${chunks.length} safe batch chunk(s)...\n`);

const tempChunkFile = path.join(tempDir, '_temp_d1_reconcile_chunk.sql');

try {
  for (let i = 0; i < chunks.length; i++) {
    process.stdout.write(`Applying batch ${i + 1}/${chunks.length}... `);
    fs.writeFileSync(tempChunkFile, chunks[i], 'utf8');

    const cmd = `wrangler d1 execute collection-db --remote --file=scripts/temp/_temp_d1_reconcile_chunk.sql`;
    execSync(cmd, { stdio: 'pipe' });

    if (fs.existsSync(tempChunkFile)) {
      fs.unlinkSync(tempChunkFile);
    }
    console.log(`OK`);
  }

  console.log(
    `\nAll ${chunks.length} batches successfully applied to remote Cloudflare D1!`,
  );
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\nExecution error during batch deployment:`, msg);
  if (fs.existsSync(tempChunkFile)) fs.unlinkSync(tempChunkFile);
  process.exit(1);
}
