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
    });

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
    console.log(`- Games Confirmed Physical:      ${result.verifiedGames}`);
    console.log(
      '===============================================================\n',
    );
  } catch (err) {
    console.error('❌ [SyncSwitch] Failed to sync Switch revisions:', err);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
