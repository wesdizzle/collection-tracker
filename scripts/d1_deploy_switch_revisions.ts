/**
 * CLOUDFLARE D1 SURGICAL SWITCH REVISIONS DEPLOYER
 *
 * Runs the single migration SQL file through the Pre-Flight D1 Cost Guard.
 * Enforces index-amplified write budget (1 + K) and EXPLAIN QUERY PLAN scan checks.
 *
 * USAGE:
 *   npx tsx scripts/d1_deploy_switch_revisions.ts [--confirm]
 */

import * as fs from 'fs';
import * as path from 'path';
import { runWithD1CostGuard } from './lib/d1_cost_guard.js';

async function main() {
  const confirm =
    process.argv.includes('--confirm') ||
    process.argv.includes('--yes') ||
    process.argv.includes('-y');

  const tempDir = path.resolve(process.cwd(), 'scripts', 'temp');
  const migrationSqlPath = path.join(tempDir, 'reconcile_and_revisions_d1.sql');

  if (!fs.existsSync(migrationSqlPath)) {
    console.error(
      `Error: Migration SQL file not found at ${migrationSqlPath}.`,
    );
    console.error(
      'Run scripts/sync_switch_revisions.ts first to generate the delta.',
    );
    process.exit(1);
  }

  // Cap at 12,000 billable row writes (~12% of daily quota)
  const MAX_WRITES_BUDGET = 12000;

  console.log(
    '🛡️ [D1 Deploy] Routing migration through Pre-Flight Cost Guard...',
  );
  runWithD1CostGuard({
    sqlFilePath: migrationSqlPath,
    maxWrites: MAX_WRITES_BUDGET,
    confirm,
    isDryRun: !confirm,
  });
}

main().catch((err) => {
  console.error('❌ Remote D1 migration failed:', err);
  process.exit(1);
});
