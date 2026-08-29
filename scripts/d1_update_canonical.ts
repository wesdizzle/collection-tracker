/**
 * CLOUDFLARE D1 CANONICAL SERIES DEPLOYER & VERIFIER
 *
 * Deploys the surgical `update_canonical_series.sql` migration to remote Cloudflare D1
 * and immediately triggers the sentinel smoke test to verify all updates.
 *
 * USAGE:
 *   ALLOW_REMOTE_DEPLOY=true npx tsx scripts/d1_update_canonical.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { runD1SmokeTest } from './d1_smoke_test.js';

const sqlPath = path.resolve(process.cwd(), 'update_canonical_series.sql');

async function deployCanonicalSeriesToD1() {
  console.log('=== Cloudflare D1 Canonical Series Migration Pipeline ===\n');

  // Pre-flight check 1: SQL migration file exists and is non-empty
  if (!fs.existsSync(sqlPath) || fs.statSync(sqlPath).size === 0) {
    console.error(
      '❌ Error: update_canonical_series.sql is missing or empty.\n' +
        'Please run `npx tsx scripts/compute_canonical_series.ts` first to generate it.',
    );
    process.exit(1);
  }

  // Pre-flight check 2: Safety guard (supports env var or CLI flags --yes / --confirm)
  const isConfirmed =
    process.env['ALLOW_REMOTE_DEPLOY'] === 'true' ||
    process.argv.includes('--yes') ||
    process.argv.includes('--confirm') ||
    process.argv.includes('-y');

  if (!isConfirmed) {
    console.error(
      '\x1b[31m[D1Deploy] Error: Direct migration to remote Cloudflare D1 requires confirmation.\x1b[0m\n\n' +
        'To apply this migration, run:\n' +
        '  \x1b[36mnpm run d1:update-canonical -- --yes\x1b[0m\n\n' +
        'Or set the environment variable in PowerShell:\n' +
        '  \x1b[33m$env:ALLOW_REMOTE_DEPLOY="true"; npm run d1:update-canonical\x1b[0m\n',
    );
    process.exit(1);
  }

  const sqlContent = fs.readFileSync(sqlPath, 'utf8');
  const statementCount = (sqlContent.match(/UPDATE games SET/g) || []).length;
  console.log(
    `[D1Deploy] Applying ${statementCount} surgical update statement(s) to remote D1 (collection-db)...`,
  );

  try {
    execSync(
      `wrangler d1 execute collection-db --remote --file=update_canonical_series.sql`,
      {
        stdio: 'inherit',
        shell: true as unknown as string,
      },
    );
    console.log(
      '\n✅ Successfully executed SQL migration on remote Cloudflare D1!',
    );
  } catch (err) {
    console.error(
      '\n❌ [D1Deploy] Failed to execute SQL migration on Cloudflare D1:',
      err,
    );
    process.exit(1);
  }

  // Automatically trigger smoke test
  console.log('\n[D1Deploy] Triggering post-migration smoke test...');
  await runD1SmokeTest(true);
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  deployCanonicalSeriesToD1().catch((err) => {
    console.error('Fatal error during D1 deployment:', err);
    process.exit(1);
  });
}
