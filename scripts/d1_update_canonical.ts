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

  const rawStatements = sqlContent
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('UPDATE games SET'));

  // Group statements into chunks <= 8KB to avoid Wrangler /import endpoint authentication error
  const MAX_CHUNK_BYTES = 8000;
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentSize = 0;

  for (const stmt of rawStatements) {
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

  console.log(
    `[D1Deploy] Executing in ${chunks.length} safe batch chunk(s)...`,
  );

  const tempDir = path.resolve(process.cwd(), 'scripts', 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  const tempChunkPath = path.resolve(tempDir, '_temp_d1_canonical_chunk.sql');

  try {
    for (let i = 0; i < chunks.length; i++) {
      console.log(`[D1Deploy] Applying batch ${i + 1}/${chunks.length}...`);
      fs.writeFileSync(tempChunkPath, chunks[i], 'utf8');
      execSync(
        `wrangler d1 execute collection-db --remote --file=scripts/temp/_temp_d1_canonical_chunk.sql`,
        {
          stdio: 'inherit',
          shell: true as unknown as string,
        },
      );
      if (fs.existsSync(tempChunkPath)) {
        fs.unlinkSync(tempChunkPath);
      }
    }
    console.log(
      '\n✅ Successfully executed SQL migration on remote Cloudflare D1!',
    );
  } catch (err) {
    if (fs.existsSync(tempChunkPath)) {
      fs.unlinkSync(tempChunkPath);
    }
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
