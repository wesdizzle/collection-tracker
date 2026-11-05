/**
 * CLOUDFLARE D1 GAME RELEASES RECONCILIATION DEPLOYER
 *
 * Deploys the surgical `reconcile_game_releases.sql` migration to remote Cloudflare D1 (collection-db)
 * through the Pre-Flight Cost Guard (`scripts/lib/d1_cost_guard.ts`), preserving all game_releases,
 * user_game_releases, and games physical_status graduation updates and enforcing explicit
 * `--confirm` or `--yes` confirmation before remote execution.
 *
 * USAGE:
 *   npx tsx scripts/d1_reconcile_releases.ts [--max-writes=<N>] [--confirm | --yes]
 */

import * as fs from 'fs';
import * as path from 'path';
import { runWithD1CostGuard } from './lib/d1_cost_guard.js';

const tempDir = path.resolve('scripts/temp');
const sqlPath = path.join(tempDir, 'reconcile_game_releases.sql');

if (!fs.existsSync(sqlPath)) {
  console.error(
    `Error: ${sqlPath} not found. Run npm run sources:sync first to generate it.`,
  );
  process.exit(1);
}

const rawContent = fs.readFileSync(sqlPath, 'utf8');
const lines = rawContent
  .split('\n')
  .map((l) => l.trim())
  .filter(
    (l) =>
      l.startsWith('UPDATE game_releases SET') ||
      l.startsWith('UPDATE user_game_releases SET') ||
      l.startsWith('UPDATE games SET') ||
      l.startsWith('INSERT OR IGNORE INTO game_releases'),
  );

if (lines.length === 0) {
  console.log('No game release updates to deploy.');
  process.exit(0);
}

const confirm =
  process.argv.includes('--confirm') || process.argv.includes('--yes');
const maxWritesArg = process.argv.find((a) => a.startsWith('--max-writes='));
const maxWrites = maxWritesArg ? parseInt(maxWritesArg.slice(13), 10) : 25000;

console.log(`=== Remote Cloudflare D1 Game Releases Reconciliation ===\n`);
console.log(`Total Statements Prepared: ${lines.length}`);

const deploySqlPath = path.join(
  tempDir,
  '_d1_reconcile_releases_validated.sql',
);

try {
  const fullSql = [
    'PRAGMA foreign_keys = OFF;',
    ...lines,
    'PRAGMA foreign_keys = ON;',
    '',
  ].join('\n');
  fs.writeFileSync(deploySqlPath, fullSql, 'utf8');

  runWithD1CostGuard({
    sqlFilePath: deploySqlPath,
    maxWrites,
    confirm,
    isDryRun: !confirm,
  });
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\nExecution error during reconciliation deployment:`, msg);
  process.exit(1);
} finally {
  if (fs.existsSync(deploySqlPath)) {
    fs.unlinkSync(deploySqlPath);
  }
}
