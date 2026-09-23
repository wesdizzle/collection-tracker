/**
 * GAMEYE EXPORT CLI TOOL
 *
 * Usage:
 *   npx tsx scripts/export_gameye.ts [--output <path>] [--upload]
 *   npm run export:gameye
 */

import { execSync } from 'node:child_process';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { exportGed, formatExportFilename } from './lib/ged_exporter.js';

function run(): void {
  console.log('--- GAMEYE Backup Export Tool ---');

  const db = new Database('collection.sqlite');
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--output');
  let outputPath: string;

  if (outIdx !== -1 && args[outIdx + 1]) {
    outputPath = path.resolve(args[outIdx + 1]);
  } else {
    outputPath = path.resolve(process.cwd(), formatExportFilename());
  }

  const result = exportGed(db, outputPath);
  const sizeKb = (result.buffer.length / 1024).toFixed(1);

  console.log(`Export complete!`);
  console.log(`File: ${outputPath} (${sizeKb} KB)`);
  console.log(`Games exported: ${result.gamesCount}`);
  console.log(`Toys exported:  ${result.toysCount}`);
  console.log(`Total records:  ${result.totalCount}`);

  if (args.includes('--upload')) {
    console.log(
      '\nUploading export to Cloudflare R2 (collection-backups/gameye/latest_export.ged)...',
    );
    try {
      execSync(
        `npx wrangler r2 object put collection-backups/gameye/latest_export.ged --file "${outputPath}" --remote`,
        { stdio: 'inherit' },
      );
      console.log('Successfully uploaded latest export to Cloudflare R2!');
    } catch (e) {
      console.error('Failed to upload export to Cloudflare R2:', e);
    }
  }

  db.close();
}

run();
