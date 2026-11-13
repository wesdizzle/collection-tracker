/**
 * REMOTE D1 SCHEMA DRIFT CHECK (read-only)
 *
 * Compares the tables and indexes defined in `migrations/schema.sql` against the live
 * remote D1 `sqlite_master` (~100 row reads, 0 writes). Local clones, query plans, and
 * `d1:cost-guard` are all built from `schema.sql`, so any drift means local pre-flight
 * results may not reflect remote cost (e.g. a missing FK index turns an indexed DELETE
 * into a full table scan).
 *
 * The real database ID is read from `.dev.vars` (D1_DATABASE_ID) and injected into a
 * temporary wrangler config that is always deleted afterwards; no IDs are written to
 * tracked files.
 *
 * USAGE:
 *   npx tsx scripts/d1_schema_drift.ts          # exits 1 if remote is missing objects
 *   npx tsx scripts/d1_schema_drift.ts --report # always exits 0
 */

import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const rootDir = process.cwd();
const reportOnly = process.argv.includes('--report');

// Objects that legitimately exist only on one side
const IGNORED = new Set(['d1_migrations', 'sqlite_sequence']);

/**
 * Known, deliberately accepted drift. Creating these remotely costs one billable write per
 * canonical_releases row (very large table), and seeding works via idx_canonical_normalized_title.
 * Reported as warnings, not failures.
 */
const ACCEPTED_MISSING = new Set([
  'index:idx_canonical_crc',
  'index:idx_canonical_platform_norm',
  'index:idx_canonical_serial',
]);
const isIgnored = (name: string) =>
  IGNORED.has(name) ||
  name.startsWith('sqlite_autoindex_') ||
  name.startsWith('_cf_');

type SchemaObject = { type: string; name: string; tbl_name: string };

function expectedObjects(): SchemaObject[] {
  const db = new Database(':memory:');
  try {
    db.exec(
      fs.readFileSync(path.join(rootDir, 'migrations', 'schema.sql'), 'utf8'),
    );
    return (
      db
        .prepare(
          `SELECT type, name, tbl_name FROM sqlite_master WHERE type IN ('table', 'index', 'trigger', 'view')`,
        )
        .all() as SchemaObject[]
    ).filter((o) => !isIgnored(o.name));
  } finally {
    db.close();
  }
}

function readDatabaseId(): string {
  const devVarsPath = path.join(rootDir, '.dev.vars');
  if (!fs.existsSync(devVarsPath)) {
    throw new Error('.dev.vars not found (needed for D1_DATABASE_ID).');
  }
  const match = fs
    .readFileSync(devVarsPath, 'utf8')
    .match(/^D1_DATABASE_ID\s*=\s*["']?([^"'\r\n]+)["']?/m);
  if (!match) throw new Error('D1_DATABASE_ID not found in .dev.vars.');
  return match[1].trim();
}

function remoteObjects(): SchemaObject[] {
  const tomlPath = path.join(rootDir, 'wrangler.toml');
  const tempToml = path.join(
    rootDir,
    'scripts',
    'temp',
    `_wrangler_drift_${process.pid}.toml`,
  );
  fs.mkdirSync(path.dirname(tempToml), { recursive: true });
  try {
    fs.writeFileSync(
      tempToml,
      fs
        .readFileSync(tomlPath, 'utf8')
        .replace('local-dev-db', readDatabaseId()),
      'utf8',
    );
    const sql = `SELECT type, name, tbl_name FROM sqlite_master WHERE type IN ('table','index','trigger','view')`;
    const out = execSync(
      `npx wrangler d1 execute collection-db --remote -c "${tempToml}" --json --command "${sql}"`,
      { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const parsed = JSON.parse(out) as Array<{
      results: SchemaObject[];
      meta?: { rows_read?: number };
    }>;
    console.log(
      `[d1-schema-drift] Remote sqlite_master read (${parsed[0].meta?.rows_read ?? '?'} rows read, 0 writes).`,
    );
    return parsed[0].results.filter((o) => !isIgnored(o.name));
  } finally {
    if (fs.existsSync(tempToml)) fs.unlinkSync(tempToml);
  }
}

function main() {
  const expected = expectedObjects();
  const remote = remoteObjects();
  const key = (o: SchemaObject) => `${o.type}:${o.name}`;
  const remoteKeys = new Set(remote.map(key));
  const expectedKeys = new Set(expected.map(key));

  const missingAll = expected.filter((o) => !remoteKeys.has(key(o)));
  const accepted = missingAll.filter((o) => ACCEPTED_MISSING.has(key(o)));
  const missing = missingAll.filter((o) => !ACCEPTED_MISSING.has(key(o)));
  const extra = remote.filter((o) => !expectedKeys.has(key(o)));

  for (const o of accepted) {
    console.log(
      `[d1-schema-drift] ℹ️  Accepted drift (missing on remote by design): ${o.type} ${o.name} (on ${o.tbl_name})`,
    );
  }
  if (missing.length === 0 && extra.length === 0) {
    console.log(
      '[d1-schema-drift] ✅ Remote D1 matches migrations/schema.sql (apart from accepted drift).',
    );
    return;
  }
  for (const o of missing) {
    console.log(
      `[d1-schema-drift] ❌ MISSING on remote: ${o.type} ${o.name} (on ${o.tbl_name})`,
    );
  }
  for (const o of extra) {
    console.log(
      `[d1-schema-drift] ⚠️  EXTRA on remote (not in schema.sql): ${o.type} ${o.name} (on ${o.tbl_name})`,
    );
  }
  if (missing.length > 0 && !reportOnly) {
    console.log(
      '[d1-schema-drift] Local plans/cost estimates may understate remote cost until drift is resolved.',
    );
    process.exit(1);
  }
}

main();
