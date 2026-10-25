/**
 * CLOUDFLARE D1 SWITCH REVISIONS DEPLOYER
 *
 * Safely applies updated canonical releases and backup statuses for Switch 1 & 2 to remote Cloudflare D1.
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
  const revisionsSqlPath = path.join(tempDir, 'update_switch_revisions_d1.sql');
  const reconcileSqlPath = path.join(
    tempDir,
    'reconcile_switch_game_releases.sql',
  );
  const backupSqlPath = path.join(tempDir, 'update_backup_status.sql');

  if (!fs.existsSync(revisionsSqlPath) || !fs.existsSync(backupSqlPath)) {
    console.error('Error: Required SQL files in scripts/temp/ are missing.');
    process.exit(1);
  }

  console.log('🚀 [D1 Switch Deploy] Starting remote D1 migration...');

  // 1. Delete previous Switch canonical releases
  console.log(
    '  1/4 Deleting obsolete Switch canonical releases on remote D1...',
  );
  const deleteSqlPath = path.join(tempDir, 'delete_switch_canonical.sql');
  fs.writeFileSync(
    deleteSqlPath,
    'PRAGMA foreign_keys = OFF;\nDELETE FROM canonical_releases WHERE platform_id IN (26, 27);\nPRAGMA foreign_keys = ON;\n',
    'utf8',
  );
  try {
    execSync(
      `npx wrangler d1 execute collection-db --remote --file="${path.relative(process.cwd(), deleteSqlPath)}"`,
      { stdio: 'inherit' },
    );
  } finally {
    if (fs.existsSync(deleteSqlPath)) fs.unlinkSync(deleteSqlPath);
  }

  // 2. Apply canonical releases in safe ~300 KB chunks
  console.log('  2/4 Chunking and uploading canonical releases...');
  const revisionsSql = fs.readFileSync(revisionsSqlPath, 'utf8');
  const insertStatements = revisionsSql
    .split(/;\s*\n\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.startsWith('INSERT INTO canonical_releases'));

  const CHUNK_SIZE = 7;
  const chunkFiles: string[] = [];
  for (let i = 0; i < insertStatements.length; i += CHUNK_SIZE) {
    const chunkStatements = insertStatements.slice(i, i + CHUNK_SIZE);
    const chunkPath = path.join(
      tempDir,
      `switch_canonical_chunk_${Math.floor(i / CHUNK_SIZE) + 1}.sql`,
    );
    const chunkContent = `PRAGMA foreign_keys = OFF;\n\n${chunkStatements.join(';\n\n')};\n\nPRAGMA foreign_keys = ON;\n`;
    fs.writeFileSync(chunkPath, chunkContent, 'utf8');
    chunkFiles.push(chunkPath);
  }

  try {
    for (let i = 0; i < chunkFiles.length; i++) {
      const file = chunkFiles[i];
      const relPath = path.relative(process.cwd(), file);
      console.log(
        `    Uploading chunk ${i + 1}/${chunkFiles.length} (${relPath})...`,
      );
      execSync(
        `npx wrangler d1 execute collection-db --remote --file="${relPath}"`,
        { stdio: 'inherit' },
      );
    }
  } finally {
    for (const file of chunkFiles) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  }

  // 3. Apply collection game_releases reconciliation (inserting missing revisions and relinking canonical IDs)
  if (fs.existsSync(reconcileSqlPath)) {
    console.log(
      '  3/5 Applying Switch game_releases reconciliation on remote D1...',
    );
    const relReconcilePath = path.relative(process.cwd(), reconcileSqlPath);
    execSync(
      `npx wrangler d1 execute collection-db --remote --file="${relReconcilePath}"`,
      { stdio: 'inherit' },
    );
  }

  // 4. Apply backup status, nxdumptool filenames, and null rom_crc updates
  console.log(
    '  4/5 Applying backup scan updates and clearing Switch rom_crc on remote D1...',
  );
  const relBackupPath = path.relative(process.cwd(), backupSqlPath);
  execSync(
    `npx wrangler d1 execute collection-db --remote --file="${relBackupPath}"`,
    { stdio: 'inherit' },
  );

  // 5. Run remote smoke test
  console.log('  5/5 Running remote D1 smoke test...');
  await runD1SmokeTest();

  console.log('✅ Remote Cloudflare D1 migration completed successfully!');
}

main().catch((err) => {
  console.error('❌ Remote D1 migration failed:', err);
  process.exit(1);
});
