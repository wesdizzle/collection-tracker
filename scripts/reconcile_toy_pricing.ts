/**
 * RECONCILE TOY PRICING & CHASE VARIANT CORRECTION
 *
 * Re-evaluates toy prices against GAMEYE to correct corrupted chase variant matches
 * (e.g. Camo Fruit Punch at $450.00 -> Camo Spyro's Adventure at $9.16) and stale prices.
 *
 * USAGE:
 *   Dry run:
 *     npx tsx scripts/reconcile_toy_pricing.ts --dry-run
 *
 *   Local update:
 *     npx tsx scripts/reconcile_toy_pricing.ts
 */

import Database from 'better-sqlite3';
import { getLocalD1Path } from './lib/db';
import { searchGameyeToy } from './lib/gameye';

interface ToyRow {
  stable_id: number;
  id: string;
  name: string;
  line: string;
  series_id: string | null;
  type: string | null;
  gameye_id: number | null;
  price_loose: number | null;
  price_cib: number | null;
  price_new: number | null;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  const db = new Database(getLocalD1Path());

  console.log('=== Reconciling Toy Pricing & Correcting Chase Variants ===\n');

  const toys = db
    .prepare(
      `
    SELECT stable_id, id, name, line, series_id, type, gameye_id, price_loose, price_cib, price_new
    FROM toys
    WHERE ownership_status > 0 OR gameye_id IS NOT NULL OR price_loose IS NOT NULL
  `,
    )
    .all() as ToyRow[];

  console.log(`Found ${toys.length} toys to evaluate...\n`);

  const updateStmt = db.prepare(`
    UPDATE toys
    SET gameye_id = ?,
        price_loose = ?,
        price_cib = ?,
        price_new = ?,
        price_updated_at = datetime('now')
    WHERE stable_id = ?
  `);

  let updatedCount = 0;
  let correctedChaseCount = 0;

  for (let i = 0; i < toys.length; i++) {
    const toy = toys[i];
    const match = await searchGameyeToy(toy.name, toy.line, {
      seriesId: toy.series_id,
      toyType: toy.type,
    });

    await delay(100);

    if (!match) continue;

    const looseChanged = match.price_loose !== toy.price_loose;
    const idChanged = match.gameye_id !== toy.gameye_id;

    if (looseChanged || idChanged) {
      const oldLooseStr =
        toy.price_loose !== null
          ? `$${(toy.price_loose / 100).toFixed(2)}`
          : 'N/A';
      const newLooseStr =
        match.price_loose !== null
          ? `$${(match.price_loose / 100).toFixed(2)}`
          : 'N/A';

      const isLargeDrop =
        (toy.price_loose || 0) > 3000 && (match.price_loose || 0) < 1500;
      if (isLargeDrop) {
        correctedChaseCount++;
        console.log(
          `🚨 Corrected Chase Mismatch: [${toy.line}] "${toy.name}" (${toy.series_id})`,
        );
        console.log(
          `   gameye_id: ${toy.gameye_id} -> ${match.gameye_id} ("${match.title}")`,
        );
        console.log(`   Price: ${oldLooseStr} -> ${newLooseStr}\n`);
      } else {
        console.log(
          `✓ Updated: [${toy.line}] "${toy.name}": Loose ${oldLooseStr} -> ${newLooseStr} (ID: ${match.gameye_id})`,
        );
      }

      if (!isDryRun) {
        updateStmt.run(
          match.gameye_id,
          match.price_loose,
          match.price_cib,
          match.price_new,
          toy.stable_id,
        );
      }
      updatedCount++;
    }
  }

  console.log(`\nReconciliation Finished!`);
  console.log(`Total evaluated: ${toys.length}`);
  console.log(`Total updated: ${updatedCount}`);
  console.log(
    `High-value / Chase mismatches corrected: ${correctedChaseCount}`,
  );
  if (isDryRun) {
    console.log(`[DRY RUN] No database changes written.`);
  }
}

main().catch((err) => {
  console.error('Fatal error reconciling toy pricing:', err);
  process.exit(1);
});
