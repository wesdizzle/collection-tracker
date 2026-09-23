/**
 * GAMEYE .GED BACKUP EXPORTER
 *
 * Generates a GAMEYE Restore Point archive (.ged file) containing an
 * ownership SQLite database with all owned games and toys mapped to
 * GAMEYE catalog IDs and completeness masks.
 *
 * Archive layout:
 *   YYYY_MM_DD_gagglog_export.ged (ZIP archive)
 *     └── ownership_database.db   (SQLite database with ownership table)
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { crc32, deflateRawSync } from 'node:zlib';
import Database from 'better-sqlite3';
import {
  GAGGLOG_TO_GAMEYE_PLATFORM,
  GAGGLOG_TO_GAMEYE_COUNTRY,
  GAMEYE_TOY_PLATFORMS,
} from './gameye.js';

export interface ExportResult {
  buffer: Buffer;
  filename: string;
  gamesCount: number;
  toysCount: number;
  totalCount: number;
}

/**
 * Computes GAMEYE ownership mask from case and manual flags.
 * 1 = Loose, 3 = Manual Only, 5 = Boxed Only, 7 = Complete in Box (CIB).
 */
export function computeGameOwnershipMask(
  hasCase: number | boolean,
  hasManual: number | boolean,
): number {
  const c = Boolean(hasCase);
  const m = Boolean(hasManual);
  if (c && m) return 7;
  if (c && !m) return 5;
  if (!c && m) return 3;
  return 1;
}

/**
 * Creates an in-memory SQLite database matching the official GAMEYE Restore Point schema.
 */
export function buildGameyeOwnershipDatabase(sourceDb: Database.Database): {
  targetDb: Database.Database;
  gamesCount: number;
  toysCount: number;
} {
  const targetDb = new Database(':memory:');

  // 1. Initialize GAMEYE tables
  targetDb.exec(`
    CREATE TABLE android_metadata (locale TEXT);
    INSERT INTO android_metadata VALUES ('en_US');

    CREATE TABLE version(version integer primary key);
    INSERT INTO version (version) VALUES (8),(9),(10),(11),(12),(13),(14),(15),(16),(17),(18),(19),(20);

    CREATE TABLE server_sync(
      id INTEGER PRIMARY KEY,
      latest_server_edit_id INTEGER NOT NULL,
      collection_id INTEGER NOT NULL,
      UNIQUE(collection_id)
    );
    INSERT INTO server_sync (id, latest_server_edit_id, collection_id) VALUES (1, 0, 1);

    CREATE TABLE pending_sync_data(
      id INTEGER PRIMARY KEY,
      table_name TEXT NOT NULL,
      column_name TEXT NOT NULL,
      value TEXT,
      collection_id INTEGER NOT NULL,
      generation_id INTEGER NOT NULL,
      uuid TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at INT NOT NULL,
      force INTEGER,
      server_value TEXT,
      server_generation_id INTEGER,
      conflicted_check_at INTEGER
    );

    CREATE TABLE ownership(
      id INTEGER PRIMARY KEY,
      item_id integer,
      platform_id integer,
      country_id integer,
      ownership_mask integer,
      item_quality real,
      manual_quality real,
      box_quality real,
      paid INT,
      sold INT,
      note TEXT,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      category_id integer,
      user_record_type integer,
      title text,
      uuid TEXT NOT NULL,
      generation_id INT NOT NULL DEFAULT 0,
      collection_id INT NOT NULL DEFAULT 1,
      other_quality REAL,
      UNIQUE(uuid)
    );

    CREATE TABLE backlog(
      id INTEGER PRIMARY KEY,
      play_status_id INTEGER NOT NULL,
      start_date_seconds INTEGER,
      end_date_seconds INTEGER,
      duration_seconds INTEGER,
      note TEXT,
      item_id INTEGER NOT NULL,
      platform_id INTEGER NOT NULL,
      country_id INTEGER,
      uuid TEXT NOT NULL,
      generation_id INT NOT NULL DEFAULT 0,
      collection_id INT NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      created_at_seconds INT NOT NULL,
      updated_at_seconds INTEGER NOT NULL,
      UNIQUE(uuid)
    );

    CREATE TABLE "owned_items_tags" (
      ownership_uuid TEXT NOT NULL,
      tag_uuid TEXT NOT NULL,
      FOREIGN KEY(ownership_uuid) REFERENCES ownership(uuid) ON DELETE CASCADE,
      FOREIGN KEY(tag_uuid) REFERENCES tags(uuid) ON DELETE CASCADE,
      UNIQUE(ownership_uuid, tag_uuid)
    );

    CREATE TABLE account(uuid TEXT PRIMARY KEY);

    CREATE TABLE "tags"(
      tag_id integer primary key,
      tag text NOT NULL,
      color_id integer NOT NULL,
      uuid TEXT NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      generation_id INT NOT NULL DEFAULT 0,
      collection_id INT NOT NULL DEFAULT 1,
      UNIQUE(uuid)
    );
  `);

  const insertOwnershipStmt = targetDb.prepare(`
    INSERT INTO ownership (
      id, item_id, platform_id, country_id, ownership_mask,
      item_quality, manual_quality, box_quality, paid, sold, note,
      created_at, updated_at, category_id, user_record_type,
      title, uuid, generation_id, collection_id, other_quality
    ) VALUES (
      ?, ?, ?, ?, ?,
      NULL, 0, 0, NULL, NULL, NULL,
      ?, ?, ?, 0,
      ?, ?, 0, 1, NULL
    )
  `);

  const nowSeconds = Math.floor(Date.now() / 1000);
  let recordId = 1;

  // 2. Query and Insert Games
  const ownedGames = sourceDb
    .prepare(
      `
    SELECT
      g.title,
      g.gameye_id,
      g.gameye_platform_id,
      g.platform_id,
      COALESCE(r.region, g.region) as region,
      COALESCE(r.has_case, 0) as has_case,
      COALESCE(r.has_manual, 0) as has_manual
    FROM games g
    JOIN game_releases r ON r.game_id = g.stable_id
    WHERE r.ownership_status > 0
      AND g.gameye_id IS NOT NULL
  `,
    )
    .all() as {
    title: string;
    gameye_id: number;
    gameye_platform_id: number | null;
    platform_id: number;
    region: string | null;
    has_case: number;
    has_manual: number;
  }[];

  for (const game of ownedGames) {
    const platformId =
      game.gameye_platform_id ||
      GAGGLOG_TO_GAMEYE_PLATFORM[game.platform_id] ||
      0;
    const countryId = game.region
      ? GAGGLOG_TO_GAMEYE_COUNTRY[game.region] || 1
      : 1;
    const mask = computeGameOwnershipMask(game.has_case, game.has_manual);

    insertOwnershipStmt.run(
      recordId++,
      game.gameye_id,
      platformId,
      countryId,
      mask,
      nowSeconds,
      nowSeconds,
      0, // category_id = 0 for games
      game.title,
      randomUUID(),
    );
  }

  // 3. Query and Insert Toys
  const ownedToys = sourceDb
    .prepare(
      `
    SELECT
      t.name,
      t.line,
      t.gameye_id
    FROM toys t
    WHERE t.ownership_status > 0
      AND t.gameye_id IS NOT NULL
  `,
    )
    .all() as {
    name: string;
    line: string;
    gameye_id: number;
  }[];

  for (const toy of ownedToys) {
    let platformId = GAMEYE_TOY_PLATFORMS[toy.line] || 119;
    if (toy.line.toLowerCase() === 'starlink') {
      platformId = 143;
    }

    insertOwnershipStmt.run(
      recordId++,
      toy.gameye_id,
      platformId,
      null, // country_id is null for toys
      1, // toys are always loose (mask = 1)
      nowSeconds,
      nowSeconds,
      3, // category_id = 3 for toys-to-life
      toy.name,
      randomUUID(),
    );
  }

  // 4. Create standard GAMEYE indices
  targetDb.exec(`
    CREATE INDEX ownership_item_id_idx ON ownership (item_id);
    CREATE INDEX ownership_category_id_idx ON ownership (category_id);
    CREATE INDEX ownership_user_record_type_idx ON ownership (user_record_type);
    CREATE INDEX ownership_created_at_idx ON ownership (created_at);
    CREATE INDEX ownership_updated_at_idx ON ownership (updated_at);
    CREATE INDEX ownership_uuid_idx ON ownership (uuid);
    CREATE INDEX ownership_category_id_user_record_type_idx ON ownership (category_id,user_record_type);
    CREATE INDEX backlog_item_id_idx ON backlog (item_id);
    CREATE INDEX backlog_play_status_id_idx ON backlog (play_status_id);
    CREATE INDEX backlog_updated_at_seconds_idx ON backlog (updated_at_seconds);
    CREATE INDEX backlog_uuid_idx ON backlog (uuid);
  `);

  return {
    targetDb,
    gamesCount: ownedGames.length,
    toysCount: ownedToys.length,
  };
}

/**
 * Compresses an SQLite database buffer into a standard ZIP archive containing 'ownership_database.db'.
 */
export function zipOwnershipDatabase(dbBuffer: Buffer): Buffer {
  const filename = 'ownership_database.db';
  const nameBuf = Buffer.from(filename, 'utf8');
  const compressed = deflateRawSync(dbBuffer);
  const crc = crc32(dbBuffer);

  // Local file header (30 bytes + filename)
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0); // Local header signature
  localHeader.writeUInt16LE(20, 4); // Min version (2.0)
  localHeader.writeUInt16LE(0, 6); // Flags
  localHeader.writeUInt16LE(8, 8); // Compression: DEFLATE
  localHeader.writeUInt16LE(0, 10); // Last mod time
  localHeader.writeUInt16LE(0, 12); // Last mod date
  localHeader.writeUInt32LE(crc, 14); // CRC-32
  localHeader.writeUInt32LE(compressed.length, 18); // Compressed size
  localHeader.writeUInt32LE(dbBuffer.length, 22); // Uncompressed size
  localHeader.writeUInt16LE(nameBuf.length, 26); // Filename length
  localHeader.writeUInt16LE(0, 28); // Extra field length

  const localRecord = Buffer.concat([localHeader, nameBuf, compressed]);

  // Central directory header (46 bytes + filename)
  const cdHeader = Buffer.alloc(46);
  cdHeader.writeUInt32LE(0x02014b50, 0); // Central directory signature
  cdHeader.writeUInt16LE(20, 4); // Version made by
  cdHeader.writeUInt16LE(20, 6); // Min version
  cdHeader.writeUInt16LE(0, 8); // Flags
  cdHeader.writeUInt16LE(8, 10); // Compression: DEFLATE
  cdHeader.writeUInt16LE(0, 12); // Last mod time
  cdHeader.writeUInt16LE(0, 14); // Last mod date
  cdHeader.writeUInt32LE(crc, 16); // CRC-32
  cdHeader.writeUInt32LE(compressed.length, 20); // Compressed size
  cdHeader.writeUInt32LE(dbBuffer.length, 24); // Uncompressed size
  cdHeader.writeUInt16LE(nameBuf.length, 28); // Filename length
  cdHeader.writeUInt16LE(0, 30); // Extra field length
  cdHeader.writeUInt16LE(0, 32); // Comment length
  cdHeader.writeUInt16LE(0, 34); // Disk number start
  cdHeader.writeUInt16LE(0, 36); // Internal file attributes
  cdHeader.writeUInt32LE(0, 38); // External file attributes
  cdHeader.writeUInt32LE(0, 42); // Relative offset of local header

  const cdRecord = Buffer.concat([cdHeader, nameBuf]);

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // Disk number
  eocd.writeUInt16LE(0, 6); // Disk with central directory
  eocd.writeUInt16LE(1, 8); // Number of records on this disk
  eocd.writeUInt16LE(1, 10); // Total number of records
  eocd.writeUInt32LE(cdRecord.length, 12); // Size of central directory
  eocd.writeUInt32LE(localRecord.length, 16); // Offset of central directory
  eocd.writeUInt16LE(0, 20); // Comment length

  return Buffer.concat([localRecord, cdRecord, eocd]);
}

/**
 * Formats standard backup export filename: YYYY_MM_DD_gagglog_export.ged
 */
export function formatExportFilename(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}_${mm}_${dd}_gagglog_export.ged`;
}

/**
 * Exports all owned games and toys into a GAMEYE .ged backup archive.
 */
export function exportGed(
  sourceDb: Database.Database,
  outputPath?: string,
): ExportResult {
  const { targetDb, gamesCount, toysCount } =
    buildGameyeOwnershipDatabase(sourceDb);
  const dbBuffer = targetDb.serialize();
  targetDb.close();

  const zipBuffer = zipOwnershipDatabase(dbBuffer);
  const filename = formatExportFilename();

  if (outputPath) {
    fs.writeFileSync(outputPath, zipBuffer);
  }

  return {
    buffer: zipBuffer,
    filename,
    gamesCount,
    toysCount,
    totalCount: gamesCount + toysCount,
  };
}
