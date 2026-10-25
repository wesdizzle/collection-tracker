/**
 * NINTENDO SWITCH & SWITCH 2 CANONICAL REVISIONS SYNC UTILITY
 *
 * Fetches the community Nintendo Revised cartridge revisions Google Spreadsheet
 * (Tabs: S1 1st Party, S1 3rd Party, Past Revisions SW1, S2 1st Party, S2 3rd Party, Past Revisions SW2),
 * removes any legacy 'dat' rows for Platforms 26 & 27 in canonical_releases,
 * performs a diff-only sync of canonical physical releases, and reconciles user collection entries.
 *
 * USAGE:
 *   npx tsx scripts/sync_switch_revisions.ts [--dry-run]
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { getLocalD1Path } from './lib/db.js';
import {
  fetchSwitchSpreadsheetTabs,
  parseSwitchRevisionsCsv,
  syncSwitchRevisionsToDatabase,
  SWITCH_REVISIONS_ATTRIBUTION_URL,
} from './lib/switch_revisions.js';

const dbPath = getLocalD1Path();
if (!fs.existsSync(dbPath)) {
  console.error(
    `[SyncSwitch] Error: Database not found at ${dbPath}. Run npm run db:init first.`,
  );
  process.exit(1);
}

const isDryRun = process.argv.includes('--dry-run');

async function main() {
  console.log(
    isDryRun
      ? '🔍 [SyncSwitch] DRY RUN: Fetching Nintendo Revised spreadsheet and analyzing changes...'
      : '🚀 [SyncSwitch] Fetching Nintendo Revised spreadsheet and syncing Switch 1 & 2 releases...',
  );
  console.log(`- Source: ${SWITCH_REVISIONS_ATTRIBUTION_URL}`);

  const startTime = Date.now();
  const db = new Database(dbPath);

  try {
    const tabContents = await fetchSwitchSpreadsheetTabs();
    console.log(
      `✅ Successfully fetched ${tabContents.length} spreadsheet tabs.`,
    );

    const canonicalReleases = parseSwitchRevisionsCsv(tabContents);
    console.log(
      `📦 Parsed ${canonicalReleases.length} canonical cartridge revision entries.`,
    );

    const result = syncSwitchRevisionsToDatabase(db, canonicalReleases, {
      dryRun: isDryRun,
      sqlOutputPath: path.join(
        process.cwd(),
        'scripts',
        'temp',
        'reconcile_switch_game_releases.sql',
      ),
    });

    if (!isDryRun && result.sqlContent && result.sqlPath) {
      const parentDir = path.dirname(result.sqlPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.writeFileSync(result.sqlPath, result.sqlContent, 'utf8');
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(
      '\n===============================================================',
    );
    console.log(
      isDryRun
        ? '📊 SWITCH REVISIONS SYNC SUMMARY (DRY RUN)'
        : '✅ SWITCH REVISIONS SYNCHRONIZATION COMPLETE',
    );
    console.log(
      '===============================================================',
    );
    console.log(`- Execution Time:                ${duration}s`);
    console.log(`- Purged Legacy DAT Rows:        ${result.purgedLegacyDat}`);
    console.log(`- New Canonical Revisions Added: ${result.addedCanonical}`);
    console.log(`- Canonical Revisions Updated:   ${result.updatedCanonical}`);
    console.log(`- Obsolete Revisions Deleted:    ${result.deletedCanonical}`);
    console.log(
      `- Collection Releases Linked:    ${result.reconciledReleases}`,
    );
    console.log(`- Missing Revisions Inserted:    ${result.insertedRevisions}`);
    console.log(`- Games Confirmed Physical:      ${result.verifiedGames}`);
    console.log(
      '===============================================================\n',
    );

    // Export surgical Cloudflare D1 migration SQL file preserving exact primary keys
    if (!isDryRun) {
      const tempDir = path.join(process.cwd(), 'scripts', 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      const migrationSqlPath = path.join(
        tempDir,
        'update_switch_revisions_d1.sql',
      );

      const allSyncedRows = db
        .prepare(
          `SELECT id, platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, serial_code, barcode, publisher, source, is_verified_physical
           FROM canonical_releases
           WHERE platform_id IN (26, 27)
           ORDER BY id ASC`,
        )
        .all() as Array<{
        id: number;
        platform_id: number;
        raw_title: string;
        normalized_title: string;
        region: string | null;
        variants: string | null;
        rom_name: string | null;
        rom_crc: string | null;
        serial_code: string | null;
        barcode: string | null;
        publisher: string | null;
        source: string;
        is_verified_physical: number;
      }>;

      const BATCH_SIZE = 250;
      let sqlBuffer = '-- Surgical Nintendo Switch Revisions D1 Migration\n';
      sqlBuffer += `-- Generated on: ${new Date().toISOString()}\n`;
      sqlBuffer += 'PRAGMA foreign_keys = OFF;\n\n';
      sqlBuffer +=
        '-- 1. Remove previous Switch canonical releases\nDELETE FROM canonical_releases WHERE platform_id IN (26, 27);\n\n';

      if (allSyncedRows.length > 0) {
        sqlBuffer +=
          '-- 2. Insert canonical releases with synchronized primary keys\n';
        for (let i = 0; i < allSyncedRows.length; i += BATCH_SIZE) {
          const batch = allSyncedRows.slice(i, i + BATCH_SIZE);
          sqlBuffer +=
            'INSERT INTO canonical_releases (id, platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, serial_code, barcode, publisher, source, is_verified_physical) VALUES\n';

          const valueRows = batch.map((r) => {
            const esc = (val: string | null | undefined) =>
              val !== null && val !== undefined
                ? `'${val.replace(/'/g, "''")}'`
                : 'NULL';
            return `  (${r.id}, ${r.platform_id}, ${esc(r.raw_title)}, ${esc(r.normalized_title)}, ${esc(r.region)}, ${esc(r.variants)}, ${esc(r.rom_name)}, ${esc(r.rom_crc)}, ${esc(r.serial_code)}, ${esc(r.barcode)}, ${esc(r.publisher)}, ${esc(r.source)}, ${r.is_verified_physical})`;
          });

          sqlBuffer += valueRows.join(',\n') + ';\n\n';
        }
      }

      sqlBuffer += 'PRAGMA foreign_keys = ON;\n';
      fs.writeFileSync(migrationSqlPath, sqlBuffer, 'utf8');

      const sizeMb = (fs.statSync(migrationSqlPath).size / 1024 / 1024).toFixed(
        2,
      );
      console.log(
        `📦 [SyncSwitch] Generated surgical D1 deployment SQL: scripts/temp/update_switch_revisions_d1.sql (${sizeMb} MB, ${allSyncedRows.length} rows)`,
      );
    }
  } catch (err) {
    console.error('❌ [SyncSwitch] Failed to sync Switch revisions:', err);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
