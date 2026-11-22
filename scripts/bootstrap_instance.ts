/**
 * NEW INSTANCE BOOTSTRAP & MAINTENANCE ORCHESTRATOR
 *
 * Initializes a new Collection Tracker instance locally (and optionally prepares/pushes
 * budget-bounded remote D1 bootstrap phases) while respecting Cloudflare Free Tier limits.
 *
 * What runs in the production Worker automatically after deploy:
 *   - Nintendo Switch physical catalog & cartridge revisions (`syncWorkerSwitchRevisions`)
 *   - Amiibo figure & card catalog (`syncWorkerAmiiboCatalog`)
 *   - Limited-print & retail feeds (`syncWorkerBoutiquePreOrders` + `syncWorkerRetailPreOrders` + `syncWorkerNsCollectors`)
 *   - Steady-state canonical tailer & rolling IGDB maintenance (`syncWorkerBroadCatalogPopulation` + `syncWorkerIgdbSeriesAndCanonical`)
 *   - Daily diff-guarded R2 snapshots (`performScheduledBackup` + `performCanonicalReleasesBackup`)
 *
 * What this local bootstrap script seeds:
 *   1. Declarative schema + 55 platforms + 41 toy_series (`migrations/schema.sql`)
 *   2. 547 permanently retired Skylanders & Starlink toys (`migrations/seed_retired_toys.sql`)
 *   3. Canonical DATs & offline verification sources (`dats/`, `data/sources/` -> `canonical_releases`)
 *
 * Usage:
 *   npm run db:bootstrap
 *   npm run db:bootstrap -- --download-dats
 *   npm run db:bootstrap -- --remote --phase=schema
 *   npm run db:bootstrap -- --remote --phase=retired-toys
 *   npm run db:bootstrap -- --remote --phase=dats --platform=19 --max-writes=50000
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { resolveLocalDatabasePath } from './lib/db.js';
import { downloadAllCanonicalDats } from './fetch_canonical_sources.js';
import { syncCanonicalSources } from './sync_canonical_sources.js';
import { runWithD1CostGuard } from './d1_cost_guard.js';

export interface BootstrapOptions {
  rootDir?: string;
  dbPath?: string;
  downloadDats?: boolean;
  skipDatsSync?: boolean;
  remote?: boolean;
  phase?: 'all' | 'schema' | 'retired-toys' | 'dats';
  platformId?: number;
  maxWrites?: number;
}

export interface BootstrapResult {
  dbPath: string;
  platformsCount: number;
  toySeriesCount: number;
  retiredToysCount: number;
  canonicalReleasesCount: number;
}

function hasAnyDatFiles(datsDir: string): boolean {
  if (!fs.existsSync(datsDir)) return false;
  for (const sub of ['No-Intro', 'Redump', '']) {
    const dir = sub ? path.join(datsDir, sub) : datsDir;
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (
        entry.isFile() &&
        (entry.name.endsWith('.dat') || entry.name.endsWith('.xml'))
      ) {
        return true;
      }
    }
  }
  return false;
}

export async function bootstrapInstance(
  options: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const rootDir = options.rootDir || process.cwd();
  const schemaPath = path.join(rootDir, 'migrations', 'schema.sql');
  const retiredToysPath = path.join(
    rootDir,
    'migrations',
    'seed_retired_toys.sql',
  );
  const datsDir = path.join(rootDir, 'dats');

  let dbPath = options.dbPath;
  if (!dbPath) {
    try {
      dbPath = resolveLocalDatabasePath(rootDir);
    } catch {
      const dataDir = path.join(rootDir, 'data');
      fs.mkdirSync(dataDir, { recursive: true });
      dbPath = path.join(dataDir, 'remote_baseline.db');
    }
  }

  console.log(`=== Bootstrapping Local Instance Database (${dbPath}) ===`);
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  try {
    const phase = options.phase || 'all';

    if (phase === 'all' || phase === 'schema') {
      console.log('1. Applying declarative schema (migrations/schema.sql)...');
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      db.exec(schemaSql);
      if (options.remote && phase === 'schema') {
        runWithD1CostGuard({
          sqlFilePath: schemaPath,
          maxWrites: options.maxWrites ?? 5000,
          confirm: true,
          isDryRun: false,
        });
      }
    }

    if (
      (phase === 'all' || phase === 'retired-toys') &&
      fs.existsSync(retiredToysPath)
    ) {
      console.log(
        '2. Seeding 547 permanently retired Skylanders & Starlink toys (migrations/seed_retired_toys.sql)...',
      );
      const retiredSql = fs.readFileSync(retiredToysPath, 'utf8');
      db.exec(retiredSql);
      if (options.remote && phase === 'retired-toys') {
        runWithD1CostGuard({
          sqlFilePath: retiredToysPath,
          maxWrites: options.maxWrites ?? 5000,
          confirm: true,
          isDryRun: false,
        });
      }
    }

    if ((phase === 'all' || phase === 'dats') && !options.skipDatsSync) {
      if (options.downloadDats || !hasAnyDatFiles(datsDir)) {
        console.log('3. Downloading canonical Redump & No-Intro DAT files...');
        await downloadAllCanonicalDats();
      }
      if (hasAnyDatFiles(datsDir)) {
        console.log(
          '4. Synchronizing canonical physical releases from DATs...',
        );
        await syncCanonicalSources({
          db,
          targetPlatformId: options.platformId,
          pushRemote: Boolean(options.remote && phase === 'dats'),
          maxWrites: options.maxWrites ?? 50000,
        });
      }
    }

    const platformsCount = (
      db.prepare('SELECT COUNT(*) as c FROM platforms WHERE id != 0').get() as {
        c: number;
      }
    ).c;
    const toySeriesCount = (
      db.prepare('SELECT COUNT(*) as c FROM toy_series').get() as { c: number }
    ).c;
    const retiredToysCount = (
      db
        .prepare(
          "SELECT COUNT(*) as c FROM toys WHERE line IN ('Skylanders', 'Starlink')",
        )
        .get() as { c: number }
    ).c;
    const canonicalReleasesCount = (
      db.prepare('SELECT COUNT(*) as c FROM canonical_releases').get() as {
        c: number;
      }
    ).c;

    console.log('\n=== Instance Bootstrap Summary ===');
    console.log(`  Platforms:          ${platformsCount}`);
    console.log(`  Toy Series:         ${toySeriesCount}`);
    console.log(`  Retired Toys:       ${retiredToysCount}`);
    console.log(`  Canonical Releases: ${canonicalReleasesCount}`);

    return {
      dbPath,
      platformsCount,
      toySeriesCount,
      retiredToysCount,
      canonicalReleasesCount,
    };
  } finally {
    db.close();
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const args = process.argv.slice(2);
  const downloadDats = args.includes('--download-dats');
  const skipDatsSync = args.includes('--skip-dats');
  const remote = args.includes('--remote');
  const phaseArg = args
    .find((a) => a.startsWith('--phase='))
    ?.split('=')[1] as BootstrapOptions['phase'];
  const platformArg = args.find((a) => a.startsWith('--platform='));
  const platformId = platformArg
    ? parseInt(platformArg.split('=')[1], 10)
    : undefined;
  const maxWritesArg = args.find((a) => a.startsWith('--max-writes='));
  const maxWrites = maxWritesArg
    ? parseInt(maxWritesArg.split('=')[1], 10)
    : 50000;

  bootstrapInstance({
    downloadDats,
    skipDatsSync,
    remote,
    phase: phaseArg,
    platformId,
    maxWrites,
  }).catch((err) => {
    console.error('Fatal error bootstrapping instance:', err);
    process.exit(1);
  });
}
