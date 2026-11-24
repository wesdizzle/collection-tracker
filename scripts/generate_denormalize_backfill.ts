import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  isSecondaryIndexOrigin,
  isTableWithoutRowid,
} from '@wesdizzle/app-kit/scripts';

export interface DenormalizeBackfillOptions {
  dbPath?: string;
  db?: Database.Database;
  outDir: string;
  prefix?: string;
  maxWrites?: number;
}

export interface DenormalizeBackfillResult {
  totalCandidateRows: number;
  totalBackfilledRows: number;
  totalClearedRows: number;
  writeFactorPerRow: number;
  totalEstimatedWrites: number;
  chunkPaths: string[];
}

interface BackfillCandidateRow {
  id: string;
  canonical_release_id: number | null;
  cr_id: number | null;
  target_source: string | null;
  target_serial: string | null;
  target_title: string | null;
  target_publisher: string | null;
  needs_clear: number;
}

function escapeSql(value: string | null | undefined): string {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Computes the Cloudflare D1 write amplification factor (1 + K) for
 * `game_releases`, accounting for both `origin = 'pk'` (rowid tables)
 * and explicit/unique secondary indexes.
 */
export function computeGameReleasesWriteFactor(db: Database.Database): number {
  const withoutRowid = isTableWithoutRowid(db, 'game_releases');
  const indexes = db
    .prepare('PRAGMA index_list("game_releases")')
    .all() as Array<{
    name: string;
    unique: number;
    origin: string;
    partial: number;
  }>;
  const secondaryCount = indexes.filter((idx) =>
    isSecondaryIndexOrigin(idx.origin, withoutRowid),
  ).length;
  return 1 + secondaryCount;
}

/**
 * Generates idempotent, primary-key-indexed, write-budgeted SQL chunks to
 * backfill `verified_source`, `serial_code`, `canonical_title`, and `publisher`
 * on `game_releases` from `canonical_releases`.
 */
export function generateDenormalizeBackfill(
  options: DenormalizeBackfillOptions,
): DenormalizeBackfillResult {
  const maxWrites = options.maxWrites ?? 45000;
  const prefix = options.prefix ?? 'backfill_denormalize_';
  const dbPath =
    options.dbPath ?? path.resolve(process.cwd(), 'data', 'remote_baseline.db');

  const ownsDb = !options.db;
  const db = options.db ?? new Database(dbPath, { readonly: true });

  try {
    const grCols = new Set(
      (db.pragma('table_info("game_releases")') as Array<{ name: string }>).map(
        (c) => c.name,
      ),
    );
    const requiredCols = [
      'verified_source',
      'serial_code',
      'canonical_title',
      'publisher',
    ];
    const missingCols = requiredCols.filter((c) => !grCols.has(c));
    if (missingCols.length > 0) {
      throw new Error(
        `game_releases is missing Stage A columns (${missingCols.join(', ')}). Apply schema migration first.`,
      );
    }

    const writeFactorPerRow = computeGameReleasesWriteFactor(db);
    if (maxWrites < writeFactorPerRow) {
      throw new Error(
        `maxWrites (${maxWrites}) is smaller than per-row write factor (${writeFactorPerRow}) for game_releases.`,
      );
    }

    const candidates = db
      .prepare(
        `SELECT gr.id,
                gr.canonical_release_id,
                cr.id AS cr_id,
                cr.source AS target_source,
                cr.serial_code AS target_serial,
                cr.raw_title AS target_title,
                cr.publisher AS target_publisher,
                CASE
                  WHEN gr.canonical_release_id IS NULL OR cr.id IS NULL THEN 1
                  ELSE 0
                END AS needs_clear
         FROM game_releases gr
         LEFT JOIN canonical_releases cr ON cr.id = gr.canonical_release_id
         WHERE (
           gr.canonical_release_id IS NOT NULL
           AND cr.id IS NOT NULL
           AND (
             gr.verified_source IS NOT cr.source
             OR gr.serial_code IS NOT cr.serial_code
             OR gr.canonical_title IS NOT cr.raw_title
             OR gr.publisher IS NOT cr.publisher
           )
         ) OR (
           (gr.canonical_release_id IS NULL OR cr.id IS NULL)
           AND (
             gr.verified_source IS NOT NULL
             OR gr.serial_code IS NOT NULL
             OR gr.canonical_title IS NOT NULL
             OR gr.publisher IS NOT NULL
           )
         )
         ORDER BY gr.id ASC`,
      )
      .all() as BackfillCandidateRow[];

    const statements: string[] = [];
    let totalBackfilledRows = 0;
    let totalClearedRows = 0;

    for (const row of candidates) {
      if (row.needs_clear === 1) {
        totalClearedRows++;
        statements.push(
          `UPDATE game_releases SET verified_source = NULL, serial_code = NULL, canonical_title = NULL, publisher = NULL WHERE id = ${escapeSql(row.id)} AND (verified_source IS NOT NULL OR serial_code IS NOT NULL OR canonical_title IS NOT NULL OR publisher IS NOT NULL);`,
        );
      } else {
        totalBackfilledRows++;
        const srcSql = escapeSql(row.target_source);
        const serSql = escapeSql(row.target_serial);
        const titleSql = escapeSql(row.target_title);
        const pubSql = escapeSql(row.target_publisher);
        statements.push(
          `UPDATE game_releases SET verified_source = ${srcSql}, serial_code = ${serSql}, canonical_title = ${titleSql}, publisher = ${pubSql} WHERE id = ${escapeSql(row.id)} AND (verified_source IS NOT ${srcSql} OR serial_code IS NOT ${serSql} OR canonical_title IS NOT ${titleSql} OR publisher IS NOT ${pubSql});`,
        );
      }
    }

    fs.mkdirSync(options.outDir, { recursive: true });
    const rowsPerChunk = Math.max(1, Math.floor(maxWrites / writeFactorPerRow));
    const chunkPaths: string[] = [];

    for (
      let offset = 0, chunkIndex = 1;
      offset < statements.length;
      offset += rowsPerChunk, chunkIndex++
    ) {
      const slice = statements.slice(offset, offset + rowsPerChunk);
      const estWrites = slice.length * writeFactorPerRow;
      const chunkPath = path.join(
        options.outDir,
        `${prefix}part_${String(chunkIndex).padStart(2, '0')}.sql`,
      );
      const header = [
        '-- Generated by scripts/generate_denormalize_backfill.ts',
        `-- Chunk ${chunkIndex}: rows=${slice.length}, write_factor=${writeFactorPerRow}, estimated_writes=${estWrites}`,
        '',
      ];
      fs.writeFileSync(chunkPath, [...header, ...slice, ''].join('\n'), 'utf8');
      chunkPaths.push(chunkPath);
    }

    const totalEstimatedWrites = candidates.length * writeFactorPerRow;
    return {
      totalCandidateRows: candidates.length,
      totalBackfilledRows,
      totalClearedRows,
      writeFactorPerRow,
      totalEstimatedWrites,
      chunkPaths,
    };
  } finally {
    if (ownsDb) {
      db.close();
    }
  }
}

function parseCliArgs(argv: string[]): {
  dbPath: string;
  outDir: string;
  prefix: string;
  maxWrites: number;
} {
  let dbPath = path.resolve(process.cwd(), 'data', 'remote_baseline.db');
  let outDir = path.resolve(process.cwd(), 'scripts', 'temp');
  let prefix = 'backfill_denormalize_';
  let maxWrites = 45000;

  for (const arg of argv) {
    if (arg.startsWith('--db=')) {
      dbPath = path.resolve(arg.slice(5));
    } else if (arg.startsWith('--out-dir=')) {
      outDir = path.resolve(arg.slice(10));
    } else if (arg.startsWith('--prefix=')) {
      prefix = arg.slice(9);
    } else if (arg.startsWith('--max-writes=')) {
      const parsed = Number(arg.slice(13));
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid --max-writes value: ${arg.slice(13)}`);
      }
      maxWrites = Math.floor(parsed);
    }
  }

  return { dbPath, outDir, prefix, maxWrites };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    const cli = parseCliArgs(process.argv.slice(2));
    const res = generateDenormalizeBackfill(cli);
    console.log(
      `[DenormBackfill] factor=${res.writeFactorPerRow}x, backfill=${res.totalBackfilledRows}, clear=${res.totalClearedRows}, total_rows=${res.totalCandidateRows}, est_writes=${res.totalEstimatedWrites}, chunks=${res.chunkPaths.length}`,
    );
    for (const p of res.chunkPaths) {
      console.log(`  - ${p}`);
    }
  } catch (err) {
    console.error('[DenormBackfill] Fatal error:', err);
    process.exit(1);
  }
}
