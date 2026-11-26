/**
 * TOY-GAME COMPATIBILITY SYNC UTILITY
 *
 * Computes deterministic `toy_game_compatibility` rows across amiibo (via AmiiboAPI `?showusage`),
 * Skylanders, and Starlink, and either applies them locally or emits chunked, idempotent SQL deltas
 * for D1 Cost Guard verification & deployment.
 *
 * Usage:
 *   npx tsx scripts/sync_toy_compatibility.ts [--dry-run] [--apply-local] [--split] [--sql-dir=<dir>]
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getLocalDatabase } from './lib/db.js';
import {
  AmiiboApiUsageItem,
  buildAmiiboCompatibilityEntries,
  buildSkylandersCompatibilityEntries,
  buildStarlinkCompatibilityEntries,
  ToyCompatibilityGameInput,
  ToyCompatibilityToyInput,
  ToyGameCompatibilityRow,
} from '../shared/toy_compatibility.js';

export interface SyncToyCompatibilityOptions {
  db?: Database.Database;
  applyLocal?: boolean;
  dryRun?: boolean;
  sqlDir?: string;
  split?: boolean;
  amiiboItems?: AmiiboApiUsageItem[];
}

export interface SyncToyCompatibilityResult {
  amiiboStarlinkRows: number;
  skylandersRows: number;
  totalRows: number;
  sqlPaths: string[];
}

function sqlVal(v: string | number | null): string {
  if (v === null) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${v.replace(/'/g, "''")}'`;
}

export function buildCompatibilityUpsertSqlStatements(
  rows: ToyGameCompatibilityRow[],
  headerComment: string,
  batchSize = 200,
): string[] {
  const lines: string[] = [
    `-- ${headerComment}`,
    `-- Total rows: ${rows.length}`,
    '',
  ];
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const values = chunk
      .map(
        (r) =>
          `  (${r.toy_stable_id}, ${r.game_stable_id}, ${r.can_read}, ${r.can_write}, ${sqlVal(r.description)})`,
      )
      .join(',\n');
    lines.push(
      `INSERT INTO toy_game_compatibility (toy_stable_id, game_stable_id, can_read, can_write, description)\nVALUES\n${values}\nON CONFLICT(toy_stable_id, game_stable_id) DO UPDATE SET\n  can_read = excluded.can_read,\n  can_write = excluded.can_write,\n  description = excluded.description\nWHERE toy_game_compatibility.can_read IS NOT excluded.can_read\n   OR toy_game_compatibility.can_write IS NOT excluded.can_write\n   OR toy_game_compatibility.description IS NOT excluded.description;`,
      '',
    );
  }
  return lines;
}

export async function fetchAmiiboApiUsageItems(): Promise<
  AmiiboApiUsageItem[]
> {
  const res = await fetch('https://amiiboapi.org/api/amiibo/?showusage', {
    headers: { 'User-Agent': 'CollectionTracker/2.0 (Compatibility Sync)' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    throw new Error(`AmiiboAPI ?showusage failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { amiibo?: AmiiboApiUsageItem[] };
  return Array.isArray(data?.amiibo) ? data.amiibo : [];
}

export async function syncToyCompatibility(
  options: SyncToyCompatibilityOptions = {},
): Promise<SyncToyCompatibilityResult> {
  const ownDb = !options.db;
  const db = options.db || getLocalDatabase();
  const sqlDir = options.sqlDir || path.join(process.cwd(), 'scripts', 'temp');

  try {
    const toys = db
      .prepare(
        `SELECT stable_id, id, name, line, series, type, amiibo_id, metadata_json
         FROM toys
         ORDER BY stable_id ASC`,
      )
      .all() as ToyCompatibilityToyInput[];

    const games = db
      .prepare(
        `SELECT stable_id, title, platform_id
         FROM games
         WHERE platform_id IN (22, 23, 24, 25, 26, 27, 32, 34, 48, 49)
         ORDER BY stable_id ASC`,
      )
      .all() as ToyCompatibilityGameInput[];

    const amiiboItems =
      options.amiiboItems ?? (await fetchAmiiboApiUsageItems().catch(() => []));

    const amiiboRows = buildAmiiboCompatibilityEntries(
      amiiboItems,
      toys,
      games,
    );
    const starlinkRows = buildStarlinkCompatibilityEntries(toys, games);
    const skylandersRows = buildSkylandersCompatibilityEntries(toys, games);

    const mergedAmiiboStarlinkMap = new Map<string, ToyGameCompatibilityRow>();
    for (const r of [...amiiboRows, ...starlinkRows]) {
      mergedAmiiboStarlinkMap.set(`${r.toy_stable_id}:${r.game_stable_id}`, r);
    }
    const amiiboStarlinkRows = Array.from(mergedAmiiboStarlinkMap.values());

    const sqlPaths: string[] = [];
    if (!options.dryRun) {
      fs.mkdirSync(sqlDir, { recursive: true });
      if (options.split) {
        const p1 = path.join(sqlDir, 'seed_toy_compat_amiibo_starlink.sql');
        const p2 = path.join(sqlDir, 'seed_toy_compat_skylanders.sql');
        fs.writeFileSync(
          p1,
          buildCompatibilityUpsertSqlStatements(
            amiiboStarlinkRows,
            'Generated amiibo & Starlink compatibility rows',
          ).join('\n'),
          'utf8',
        );
        fs.writeFileSync(
          p2,
          buildCompatibilityUpsertSqlStatements(
            skylandersRows,
            'Generated Skylanders compatibility rows',
          ).join('\n'),
          'utf8',
        );
        sqlPaths.push(p1, p2);
      } else {
        const pAll = path.join(sqlDir, 'seed_toy_compatibility.sql');
        fs.writeFileSync(
          pAll,
          buildCompatibilityUpsertSqlStatements(
            [...amiiboStarlinkRows, ...skylandersRows],
            'Generated toy_game_compatibility seed rows',
          ).join('\n'),
          'utf8',
        );
        sqlPaths.push(pAll);
      }
    }

    if (options.applyLocal) {
      const upsert = db.prepare(
        `INSERT INTO toy_game_compatibility (toy_stable_id, game_stable_id, can_read, can_write, description)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(toy_stable_id, game_stable_id) DO UPDATE SET
           can_read = excluded.can_read,
           can_write = excluded.can_write,
           description = excluded.description
         WHERE toy_game_compatibility.can_read IS NOT excluded.can_read
            OR toy_game_compatibility.can_write IS NOT excluded.can_write
            OR toy_game_compatibility.description IS NOT excluded.description`,
      );
      const tx = db.transaction((allRows: ToyGameCompatibilityRow[]) => {
        for (const r of allRows) {
          upsert.run(
            r.toy_stable_id,
            r.game_stable_id,
            r.can_read,
            r.can_write,
            r.description,
          );
        }
      });
      tx([...amiiboStarlinkRows, ...skylandersRows]);
    }

    return {
      amiiboStarlinkRows: amiiboStarlinkRows.length,
      skylandersRows: skylandersRows.length,
      totalRows: amiiboStarlinkRows.length + skylandersRows.length,
      sqlPaths,
    };
  } finally {
    if (ownDb) db.close();
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const applyLocal = args.includes('--apply-local');
  const split = args.includes('--split');
  const sqlDirArg = args.find((a) => a.startsWith('--sql-dir='));
  const sqlDir = sqlDirArg ? sqlDirArg.slice(10) : undefined;

  syncToyCompatibility({ dryRun, applyLocal, split, sqlDir })
    .then((res) => {
      console.log(
        `[sync-toy-compatibility] amiibo+Starlink=${res.amiiboStarlinkRows}, Skylanders=${res.skylandersRows}, total=${res.totalRows}`,
      );
      for (const p of res.sqlPaths) {
        console.log(`  SQL: ${p}`);
      }
    })
    .catch((err) => {
      console.error('[sync-toy-compatibility] Fatal:', err);
      process.exit(1);
    });
}
