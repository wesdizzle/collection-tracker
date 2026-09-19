/**
 * CLOUDFLARE D1 BACKUP STATUS DEPLOYER & VERIFIER
 *
 * Deploys the surgical `update_backup_status.sql` migration to remote Cloudflare D1
 * and triggers post-migration verification.
 *
 * USAGE:
 *   npm run d1:update-backups -- --yes
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { runD1SmokeTest } from './d1_smoke_test.js';

const fileArg =
  process.argv.find((a) => a.startsWith('--file='))?.split('=')[1] ||
  (process.argv.indexOf('--file') !== -1
    ? process.argv[process.argv.indexOf('--file') + 1]
    : undefined);

const sqlPath = fileArg
  ? path.resolve(process.cwd(), fileArg)
  : path.resolve(process.cwd(), 'scripts', 'temp', 'update_backup_status.sql');

export async function deployBackupStatusToD1() {
  console.log('=== Cloudflare D1 Backup Status Migration Pipeline ===\n');

  // Pre-flight check 1: SQL migration file exists and is non-empty
  if (!fs.existsSync(sqlPath) || fs.statSync(sqlPath).size === 0) {
    console.error(
      '❌ Error: update_backup_status.sql is missing or empty.\n' +
        'Please run `npm run scan-backups <path-to-backups>` first to generate it.',
    );
    process.exit(1);
  }

  // Pre-flight check 2: Safety guard (supports env var or CLI flags --yes / --confirm / -y)
  const isConfirmed =
    process.env['ALLOW_REMOTE_DEPLOY'] === 'true' ||
    process.argv.includes('--yes') ||
    process.argv.includes('--confirm') ||
    process.argv.includes('-y');

  if (!isConfirmed) {
    console.error(
      '\x1b[31m[D1Deploy] Error: Direct migration to remote Cloudflare D1 requires confirmation.\x1b[0m\n\n' +
        'To apply this migration, run:\n' +
        '  \x1b[36mnpm run d1:update-backups -- --yes\x1b[0m\n\n' +
        'Or set the environment variable in PowerShell:\n' +
        '  \x1b[33m$env:ALLOW_REMOTE_DEPLOY="true"; npm run d1:update-backups\x1b[0m\n',
    );
    process.exit(1);
  }

  const sqlContent = fs.readFileSync(sqlPath, 'utf8');
  const statementCount = (sqlContent.match(/(?:UPDATE|INSERT)/g) || []).length;
  console.log(
    `[D1Deploy] Applying ${statementCount} surgical statement(s) from ${path.basename(sqlPath)} to remote D1 (collection-db)...`,
  );

  const rawStatements = sqlContent
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s + ';');

  // Group statements into chunks <= 12KB to avoid Wrangler /import endpoint authentication error
  const MAX_CHUNK_BYTES = 12000;
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentSize = 0;

  for (const stmt of rawStatements) {
    if (
      currentSize + stmt.length > MAX_CHUNK_BYTES &&
      currentChunk.length > 0
    ) {
      chunks.push(currentChunk.join('\n\n'));
      currentChunk = [stmt];
      currentSize = stmt.length;
    } else {
      currentChunk.push(stmt);
      currentSize += stmt.length;
    }
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n\n'));
  }

  console.log(
    `[D1Deploy] Executing in ${chunks.length} safe batch chunk(s)...`,
  );

  const tempDir = path.resolve(process.cwd(), 'scripts', 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  const tempChunkPath = path.resolve(tempDir, '_temp_d1_chunk.sql');

  try {
    for (let i = 0; i < chunks.length; i++) {
      console.log(`[D1Deploy] Applying batch ${i + 1}/${chunks.length}...`);
      fs.writeFileSync(tempChunkPath, chunks[i], 'utf8');
      execSync(
        `wrangler d1 execute collection-db --remote --file=scripts/temp/_temp_d1_chunk.sql`,
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

    // Clean up temporary migration file after successful application
    if (fs.existsSync(sqlPath)) {
      fs.unlinkSync(sqlPath);
      console.log(
        `🧹 Cleaned up temporary migration file: ${path.basename(sqlPath)}`,
      );
    }
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
  try {
    await runD1SmokeTest(true);
  } catch {
    console.warn(
      '\n⚠️ [D1Deploy] Post-migration smoke test encountered an issue (e.g. daily row read limit reached), but the backup migration has already been successfully committed to remote Cloudflare D1.',
    );
  }
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith('d1_update_backups.ts') ||
    process.argv[1].endsWith('d1_update_backups.js'))
) {
  deployBackupStatusToD1().catch((err) => {
    console.error('Fatal error during D1 deployment:', err);
    process.exit(1);
  });
}
