/**
 * MULTI-RETAILER DEALS & CLEARANCE SYNC CLI (VGP, PNP GAMES, BEST BUY)
 *
 * Scans active physical video game sales and clearance events across:
 * - VideoGamesPlus (videogamesplus.ca - Shopify JSON API, no key required)
 * - PNP Games (pnpgamesonline.com - WooCommerce Store API v1, no key required)
 * - Best Buy (api.bestbuy.com - official Developer API when BESTBUY_API_KEY is set)
 *
 * Reconciles deals with the local collection database, converts CAD to USD,
 * picks the lowest price across retailers for each matched game, and flags
 * transient discounts.
 *
 * USAGE:
 *   npm run sync:bestbuy
 *   npx tsx scripts/sync_bestbuy.ts
 */

import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  fetchAllRetailDeals,
  matchBestBuyProduct,
  CandidateGame,
  RetailDealItem,
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
const syncRemote = process.argv.includes('--remote');

if (!apiKey) {
  console.log(
    '[RetailSync] Info: BESTBUY_API_KEY not set — syncing open retailer APIs (VGP & PNP Games).',
  );
}

const dbPath = path.join(rootDir, 'collection.sqlite');
const db = new Database(dbPath);

function escapeSqlString(str: string): string {
  return str.replace(/'/g, "''");
}

async function run() {
  console.log(
    '[RetailSync] Fetching live physical game deals (VGP, PNP Games' +
      (apiKey ? ', Best Buy' : '') +
      ')...',
  );

  try {
    const { deals, sources, cadToUsdRate } = await fetchAllRetailDeals({
      bestBuyApiKey: apiKey,
    });

    console.log(
      `[RetailSync] Retrieved ${deals.length} active deals (VGP: ${sources.vgp}, PNP Games: ${sources.pnp}, Best Buy: ${sources.bestbuy}) [CAD->USD: ${cadToUsdRate.toFixed(4)}].`,
    );

    if (deals.length === 0) {
      console.log('[RetailSync] No active deals found.');
      return;
    }

    const candidates = db
      .prepare(
        `
      SELECT g.stable_id, g.title, g.platform_id, COALESCE(r.barcode, g.barcode) as barcode
      FROM games g
      LEFT JOIN game_releases r ON r.game_id = g.stable_id
    `,
      )
      .all() as CandidateGame[];

    console.log(
      `[RetailSync] Loaded ${candidates.length} catalog releases for matching.`,
    );

    // Deduplicate matches by picking the lowest USD sale price per game
    const bestDealByGame = new Map<number, RetailDealItem>();
    for (const deal of deals) {
      const stableId = matchBestBuyProduct(deal, candidates);
      if (stableId !== null) {
        const existing = bestDealByGame.get(stableId);
        if (!existing || deal.salePrice < existing.salePrice) {
          bestDealByGame.set(stableId, deal);
        }
      }
    }

    // Reset previous retail sales flags before applying fresh state
    db.prepare(
      `UPDATE games SET retail_on_sale = 0 WHERE retail_store IN ('Best Buy', 'VGP', 'PNP Games')`,
    ).run();

    const updateStmt = db.prepare(`
      UPDATE games
      SET retail_price = ?,
          retail_regular_price = ?,
          retail_discount_pct = ?,
          retail_on_sale = 1,
          retail_store = ?,
          retail_url = ?,
          retail_updated_at = ?
      WHERE stable_id = ?
    `);

    const nowIso = new Date().toISOString();
    const remoteSqlStatements: string[] = [
      `UPDATE games SET retail_on_sale = 0 WHERE retail_store IN ('Best Buy', 'VGP', 'PNP Games');`,
    ];

    const updateBatch = db.transaction(() => {
      for (const [stableId, deal] of bestDealByGame.entries()) {
        const salePriceCents = Math.round(deal.salePrice * 100);
        const regularPriceCents = Math.round(deal.regularPrice * 100);
        const discountPct = Math.round(Number(deal.percentSavings) || 0);

        updateStmt.run(
          salePriceCents,
          regularPriceCents,
          discountPct,
          deal.store,
          deal.url,
          nowIso,
          stableId,
        );

        remoteSqlStatements.push(
          `UPDATE games SET retail_price=${salePriceCents}, retail_regular_price=${regularPriceCents}, retail_discount_pct=${discountPct}, retail_on_sale=1, retail_store='${escapeSqlString(deal.store)}', retail_url='${escapeSqlString(deal.url)}', retail_updated_at='${escapeSqlString(nowIso)}' WHERE stable_id=${stableId};`,
        );

        console.log(
          `  ✓ [${deal.store}] "${deal.name}" -> $${deal.salePrice.toFixed(2)} USD (Reg: $${deal.regularPrice.toFixed(2)}, ${discountPct}% OFF)`,
        );
      }
    });

    updateBatch();

    console.log(
      `\n✅ [RetailSync] Complete! Successfully matched and updated ${bestDealByGame.size} unique games on sale in local database.`,
    );

    if (syncRemote && remoteSqlStatements.length > 0) {
      console.log(
        `\n[RetailSync] Pushing ${bestDealByGame.size} matched deals to remote Cloudflare D1 (collection-db)...`,
      );
      const BATCH_SIZE = 20;
      for (let i = 0; i < remoteSqlStatements.length; i += BATCH_SIZE) {
        const batchSql = remoteSqlStatements
          .slice(i, i + BATCH_SIZE)
          .join(' ')
          .replace(/"/g, '\\"');
        execSync(
          `npx wrangler d1 execute collection-db --remote --command "${batchSql}"`,
          { stdio: 'inherit' },
        );
      }
      console.log(
        '✅ [RetailSync] Successfully synced active deals to remote Cloudflare D1!',
      );
    }
  } catch (err) {
    console.error('[RetailSync] Failed to sync deals:', err);
    process.exit(1);
  } finally {
    db.close();
  }
}

run();
