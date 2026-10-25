/**
 * CLOUDFLARE D1 SURGICAL & FRUGAL SWITCH REVISIONS DEPLOYER
 *
 * Applies delta SQL (missing revisions, verified source relinking, curly apostrophe normalization,
 * non-physical removals, and Batman disc links) to remote Cloudflare D1 without wiping canonical_releases.
 *
 * Estimated Cost: ~306 row writes (<0.35% of daily free tier quota).
 *
 * USAGE:
 *   npx tsx scripts/d1_deploy_switch_revisions.ts --yes
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { runD1SmokeTest } from './d1_smoke_test.js';

async function main() {
  const isConfirmed =
    process.env['ALLOW_REMOTE_DEPLOY'] === 'true' ||
    process.argv.includes('--yes') ||
    process.argv.includes('--confirm') ||
    process.argv.includes('-y');

  if (!isConfirmed) {
    console.error(
      'Error: Deployment to remote Cloudflare D1 requires --yes flag.',
    );
    process.exit(1);
  }

  const tempDir = path.resolve(process.cwd(), 'scripts', 'temp');
  const migrationSqlPath = path.join(tempDir, 'frugal_d1_migration.sql');
  const backupSqlPath = path.join(tempDir, 'update_backup_status.sql');

  if (!fs.existsSync(migrationSqlPath)) {
    console.error(
      `Error: Migration SQL file not found at ${migrationSqlPath}.`,
    );
    process.exit(1);
  }

  const migrationSql = fs.readFileSync(migrationSqlPath, 'utf8');
  const statementCount = migrationSql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean).length;

  console.log('🚀 [D1 Switch Deploy] Starting surgical remote D1 migration...');
  console.log(`- Target File: ${migrationSqlPath}`);
  console.log(`- Total Statements: ${statementCount}`);
  console.log(
    `- Expected Billable Row Writes: ~${statementCount} (<0.35% of daily quota)`,
  );

  // 1. Apply surgical migration SQL
  console.log('  1/3 Applying delta migration SQL on remote D1...');
  const relMigrationPath = path.relative(process.cwd(), migrationSqlPath);
  execSync(
    `npx wrangler d1 execute collection-db --remote --file="${relMigrationPath}"`,
    { stdio: 'inherit' },
  );

  // 2. Apply any pending backup status updates if present
  if (fs.existsSync(backupSqlPath)) {
    console.log('  2/3 Applying backup status updates on remote D1...');
    const relBackupPath = path.relative(process.cwd(), backupSqlPath);
    execSync(
      `npx wrangler d1 execute collection-db --remote --file="${relBackupPath}"`,
      { stdio: 'inherit' },
    );
  } else {
    console.log('  2/3 No separate backup update SQL found (skipped).');
  }

  // 3. Invalidate Cloudflare Worker Edge Cache
  console.log('  3/3 Invalidating Worker Edge Cache (/api/games?bust=1)...');
  try {
    const res = await fetch('https://games.wesley-miller.com/api/games?bust=1');
    console.log(
      `    Edge cache purge response: ${res.status} ${res.statusText}`,
    );
  } catch (err) {
    console.warn(
      '    Notice: Worker edge cache purge request failed (will refresh naturally):',
      err,
    );
  }

  // 4. Run remote smoke test
  console.log('  4/4 Running remote D1 smoke test...');
  await runD1SmokeTest();

  console.log(
    '✅ Remote Cloudflare D1 migration completed successfully with minimal quota consumption!',
  );
}

main().catch((err) => {
  console.error('❌ Remote D1 migration failed:', err);
  process.exit(1);
});
