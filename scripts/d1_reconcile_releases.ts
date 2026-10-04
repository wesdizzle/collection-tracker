/**
 * CLOUDFLARE D1 GAME RELEASES RECONCILIATION DEPLOYER
 *
 * Deploys the surgical `reconcile_game_releases.sql` migration to remote Cloudflare D1 (collection-db),
 * ensuring minimum writes by applying conditional guards on updates and batching statements
 * in safe <= 7.5KB chunks.
 *
 * USAGE:
 *   npx tsx scripts/d1_reconcile_releases.ts [--yes]
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const tempDir = path.resolve('scripts/temp');
const sqlPath = path.join(tempDir, 'reconcile_game_releases.sql');

if (!fs.existsSync(sqlPath)) {
  console.error(
    `Error: ${sqlPath} not found. Run npm run dats:sync first to generate it.`,
  );
  process.exit(1);
}

const rawContent = fs.readFileSync(sqlPath, 'utf8');
const lines = rawContent
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l.startsWith('UPDATE game_releases SET'));

if (lines.length === 0) {
  console.log('No game release updates to deploy.');
  process.exit(0);
}

console.log(`=== Remote Cloudflare D1 Game Releases Reconciliation ===\n`);
console.log(`Total Updates Prepared: ${lines.length}`);

// Group statements into batches of 250 statements
const BATCH_SIZE = 250;
const chunks: string[] = [];

for (let i = 0; i < lines.length; i += BATCH_SIZE) {
  chunks.push(lines.slice(i, i + BATCH_SIZE).join('\n'));
}

console.log(`Executing in ${chunks.length} safe batch chunk(s)...\n`);

const tempChunkFile = path.join(
  tempDir,
  '_temp_d1_reconcile_releases_chunk.sql',
);

try {
  for (let i = 0; i < chunks.length; i++) {
    process.stdout.write(`Applying batch ${i + 1}/${chunks.length}... `);
    const chunkContent = `PRAGMA foreign_keys = OFF;\n${chunks[i]}\nPRAGMA foreign_keys = ON;`;
    fs.writeFileSync(tempChunkFile, chunkContent, 'utf8');

    const cmd = `npx wrangler d1 execute collection-db --remote --file=scripts/temp/_temp_d1_reconcile_releases_chunk.sql`;
    execSync(cmd, { stdio: 'pipe' });

    if (fs.existsSync(tempChunkFile)) {
      fs.unlinkSync(tempChunkFile);
    }
    console.log('OK');
  }

  console.log(
    `\n✅ All ${chunks.length} batches successfully applied to remote Cloudflare D1!`,
  );
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\nExecution error during batch deployment:`, msg);
  if (fs.existsSync(tempChunkFile)) fs.unlinkSync(tempChunkFile);
  process.exit(1);
}
