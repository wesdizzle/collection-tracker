/**
 * BEST BUY DEALS & CLEARANCE SYNC CLI
 *
 * Scans active video game sales and clearance events on Best Buy,
 * reconciles with local collection database, and flags transient discounts.
 *
 * USAGE:
 *   npm run sync:bestbuy
 *   npx tsx scripts/sync_bestbuy.ts
 */

import Database from 'better-sqlite3';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  fetchBestBuyDeals,
  matchBestBuyProduct,
  CandidateGame,
} from './lib/bestbuy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

// Load environment variables (.env and .dev.vars)
dotenv.config({ path: path.join(rootDir, '.env') });
if (fs.existsSync(path.join(rootDir, '.dev.vars'))) {
  const devVars = dotenv.parse(
    fs.readFileSync(path.join(rootDir, '.dev.vars')),
  );
  for (const [k, v] of Object.entries(devVars)) {
    if (!process.env[k]) process.env[k] = v;
  }
}

const apiKey = process.env['BESTBUY_API_KEY'];

if (!apiKey) {
  console.log(`
========================================================================
[BestBuySync] BESTBUY_API_KEY is not configured!
------------------------------------------------------------------------
To enable automated Best Buy clearance & sale tracking:
1. Register for a free API key at: https://developer.bestbuy.com
2. Add your key to .dev.vars or .env:
   BESTBUY_API_KEY=your_api_key_here
========================================================================
`);
  process.exit(0);
}

const dbPath = path.join(rootDir, 'collection.sqlite');
const db = new Database(dbPath);

async function run() {
  console.log('[BestBuySync] Connecting to Best Buy Developer API...');

  try {
    const products = await fetchBestBuyDeals(apiKey!);
    console.log(
      `[BestBuySync] Retrieved ${products.length} active video game deals from Best Buy.`,
    );

    if (products.length === 0) {
      console.log('[BestBuySync] No active deals found.');
      return;
    }

    // Load candidates from local DB (modern platforms: Switch, Switch 2, PS4, PS5, Xbox One, Xbox Series X)
    const candidates = db
      .prepare(
        `
      SELECT g.stable_id, g.title, g.platform_id, COALESCE(r.barcode, g.barcode) as barcode
      FROM games g
      LEFT JOIN game_releases r ON r.game_id = g.stable_id
      WHERE g.platform_id IN (26, 27, 34, 35, 49, 50)
    `,
      )
      .all() as CandidateGame[];

    console.log(
      `[BestBuySync] Loaded ${candidates.length} modern platform titles from database for matching.`,
    );

    // Reset previous Best Buy sales to not on sale
    db.prepare(
      `UPDATE games SET retail_on_sale = 0 WHERE retail_store = 'Best Buy'`,
    ).run();

    const updateStmt = db.prepare(`
      UPDATE games
      SET retail_price = ?,
          retail_regular_price = ?,
          retail_discount_pct = ?,
          retail_on_sale = 1,
          retail_store = 'Best Buy',
          retail_url = ?,
          retail_updated_at = ?
      WHERE stable_id = ?
    `);

    let matchedCount = 0;
    const nowIso = new Date().toISOString();

    const updateBatch = db.transaction(() => {
      for (const product of products) {
        const stableId = matchBestBuyProduct(product, candidates);
        if (stableId !== null) {
          matchedCount++;
          const salePriceCents = Math.round(product.salePrice * 100);
          const regularPriceCents = Math.round(product.regularPrice * 100);
          const discountPct = Math.round(Number(product.percentSavings) || 0);

          updateStmt.run(
            salePriceCents,
            regularPriceCents,
            discountPct,
            product.url,
            nowIso,
            stableId,
          );

          console.log(
            `  ✓ Matched: "${product.name}" -> $${product.salePrice} (Reg: $${product.regularPrice}, ${discountPct}% OFF)`,
          );
        }
      }
    });

    updateBatch();

    console.log(
      `\n✅ [BestBuySync] Complete! Successfully matched and updated ${matchedCount} deals in database.`,
    );
  } catch (err) {
    console.error('[BestBuySync] Failed to sync deals:', err);
    process.exit(1);
  } finally {
    db.close();
  }
}

run();
