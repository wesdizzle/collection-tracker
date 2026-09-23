import { Injectable, signal } from '@angular/core';

export interface GameyeExportGame {
  title: string;
  gameye_id: number;
  gameye_platform_id: number | null;
  platform_id: number;
  region: string | null;
  has_case: number;
  has_manual: number;
}

export interface GameyeExportToy {
  title: string;
  gameye_id: number;
  line: string;
}

export interface GameyeExportData {
  games: GameyeExportGame[];
  toys: GameyeExportToy[];
}

export const GAGGLOG_TO_GAMEYE_PLATFORM: Record<number, number> = {
  1: 21, // 3DO Interactive Multiplayer
  2: 21, // Atari 2600
  3: 25, // Atari 5200
  4: 26, // Atari 7800
  5: 26, // Atari Lynx
  6: 25, // Atari Jaguar
  7: 30, // ColecoVision
  8: 31, // Intellivision
  9: 30, // Neo Geo AES
  10: 31, // Neo Geo CD
  11: 33, // Neo Geo Pocket Color
  13: 7, // Nintendo Entertainment System
  14: 4, // Game Boy
  15: 6, // Super Nintendo Entertainment System
  16: 45, // Virtual Boy
  17: 3, // Nintendo 64
  18: 39, // Game Boy Color
  19: 5, // Game Boy Advance
  20: 2, // Nintendo GameCube
  21: 8, // Nintendo DS
  22: 9, // Wii
  23: 41, // Nintendo 3DS
  24: 36, // Wii U
  25: 41, // New Nintendo 3DS
  26: 97, // Nintendo Switch
  27: 178, // Nintendo Switch 2
  28: 44, // Philips CD-i
  29: 10, // PlayStation
  30: 11, // PlayStation 2
  31: 13, // PlayStation Portable
  32: 12, // PlayStation 3
  33: 37, // PlayStation Vita
  34: 46, // PlayStation 4
  35: 105, // PlayStation 5
  36: 34, // Sega Master System
  37: 18, // Sega Genesis
  38: 19, // Sega Game Gear
  39: 20, // Sega CD
  41: 32, // Sega 32X
  42: 17, // Sega Saturn
  43: 16, // Dreamcast
  45: 33, // TurboGrafx-16
  46: 81, // TurboGrafx CD
  47: 14, // Xbox
  48: 15, // Xbox 360
  49: 47, // Xbox One
  50: 106, // Xbox Series X
  51: 46, // PlayStation VR -> PS4 platform
  52: 105, // PlayStation VR2 -> PS5 platform
  53: 7, // Famicom -> NES platform
};

export const GAGGLOG_TO_GAMEYE_COUNTRY: Record<string, number> = {
  USA: 1,
  US: 1,
  'North America': 1,
  Europe: 15,
  EUR: 15,
  UK: 15,
  PAL: 15,
  Japan: 3,
  JPN: 3,
  World: 34,
};

export const GAMEYE_TOY_PLATFORMS: Record<string, number> = {
  Skylanders: 119,
  amiibo: 118,
  Starlink: 119,
};

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
 * Computes CRC-32 checksum for arbitrary binary data.
 */
export function computeCrc32(data: Uint8Array): number {
  let crc = -1;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ -1) >>> 0;
}

/**
 * Compresses data using standard Web API CompressionStream('deflate-raw').
 */
export async function deflateRawWeb(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw');
  const responsePromise = new Response(cs.readable).arrayBuffer();
  const writer = cs.writable.getWriter();
  await writer.write(data as unknown as BufferSource);
  await writer.close();
  const ab = await responsePromise;
  return new Uint8Array(ab);
}

/**
 * Builds a standard PKZIP archive containing a single file.
 */
export async function createZipArchive(
  filename: string,
  content: Uint8Array,
): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const nameBytes = enc.encode(filename);
  const compressed = await deflateRawWeb(content);
  const crc = computeCrc32(content);

  const localLen = 30 + nameBytes.length + compressed.length;
  const cdLen = 46 + nameBytes.length;
  const totalLen = localLen + cdLen + 22;

  const out = new Uint8Array(totalLen);
  const v = new DataView(out.buffer);

  // 1. Local File Header
  v.setUint32(0, 0x04034b50, true);
  v.setUint16(4, 20, true);
  v.setUint16(6, 0, true);
  v.setUint16(8, 8, true); // Compression: Deflate
  v.setUint16(10, 0, true);
  v.setUint16(12, 0, true);
  v.setUint32(14, crc, true);
  v.setUint32(18, compressed.length, true);
  v.setUint32(22, content.length, true);
  v.setUint16(26, nameBytes.length, true);
  v.setUint16(28, 0, true);
  out.set(nameBytes, 30);
  out.set(compressed, 30 + nameBytes.length);

  // 2. Central Directory Header
  const cdStart = localLen;
  v.setUint32(cdStart, 0x02014b50, true);
  v.setUint16(cdStart + 4, 20, true);
  v.setUint16(cdStart + 6, 20, true);
  v.setUint16(cdStart + 8, 0, true);
  v.setUint16(cdStart + 10, 8, true);
  v.setUint16(cdStart + 12, 0, true);
  v.setUint16(cdStart + 14, 0, true);
  v.setUint32(cdStart + 16, crc, true);
  v.setUint32(cdStart + 20, compressed.length, true);
  v.setUint32(cdStart + 24, content.length, true);
  v.setUint16(cdStart + 28, nameBytes.length, true);
  v.setUint16(cdStart + 30, 0, true);
  v.setUint16(cdStart + 32, 0, true);
  v.setUint16(cdStart + 34, 0, true);
  v.setUint16(cdStart + 36, 0, true);
  v.setUint32(cdStart + 38, 0, true);
  v.setUint32(cdStart + 42, 0, true); // Offset of local header
  out.set(nameBytes, cdStart + 46);

  // 3. End of Central Directory (EOCD)
  const eocdStart = cdStart + cdLen;
  v.setUint32(eocdStart, 0x06054b50, true);
  v.setUint16(eocdStart + 4, 0, true);
  v.setUint16(eocdStart + 6, 0, true);
  v.setUint16(eocdStart + 8, 1, true); // Total entries on this disk
  v.setUint16(eocdStart + 10, 1, true); // Total entries overall
  v.setUint32(eocdStart + 12, cdLen, true);
  v.setUint32(eocdStart + 16, localLen, true);
  v.setUint16(eocdStart + 20, 0, true);

  return out;
}

@Injectable({
  providedIn: 'root',
})
export class GameyeExportService {
  readonly exporting = signal<boolean>(false);

  /**
   * Generates a date-formatted GAMEYE restore point filename.
   */
  formatFilename(date: Date = new Date()): string {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}_${mm}_${dd}_gagglog_export.ged`;
  }

  /**
   * Builds the GAMEYE ownership SQLite database in memory using sql.js.
   */
  async buildSqliteDatabase(data: GameyeExportData): Promise<Uint8Array> {
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs({
      locateFile: (file: string) =>
        typeof window !== 'undefined' ? `/${file}` : `./public/${file}`,
    });

    const db = new SQL.Database();

    db.run(`
      CREATE TABLE android_metadata (locale TEXT);
      INSERT INTO android_metadata VALUES ('en_US');

      CREATE TABLE version (id INTEGER PRIMARY KEY AUTOINCREMENT, version INTEGER NOT NULL);
      INSERT INTO version VALUES(1, 1);
      INSERT INTO version VALUES(2, 2);
      INSERT INTO version VALUES(3, 3);
      INSERT INTO version VALUES(4, 4);
      INSERT INTO version VALUES(5, 5);
      INSERT INTO version VALUES(6, 6);
      INSERT INTO version VALUES(7, 7);
      INSERT INTO version VALUES(8, 8);
      INSERT INTO version VALUES(9, 9);
      INSERT INTO version VALUES(10, 10);
      INSERT INTO version VALUES(11, 11);
      INSERT INTO version VALUES(12, 12);
      INSERT INTO version VALUES(13, 13);

      CREATE TABLE ownership (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        platform_id INTEGER NOT NULL,
        country_id INTEGER,
        ownership_mask INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        category_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        uuid TEXT NOT NULL,
        user_record_type INTEGER NOT NULL DEFAULT 0,
        manual_price INTEGER,
        condition INTEGER,
        deleted INTEGER NOT NULL DEFAULT 0,
        tags TEXT
      );

      CREATE TABLE deleted_ownership (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT NOT NULL,
        deleted_at INTEGER NOT NULL
      );

      CREATE TABLE gameye_cloud_database_version (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version INTEGER NOT NULL
      );
      INSERT INTO gameye_cloud_database_version VALUES(1, 1);

      CREATE TABLE custom_item (id INTEGER PRIMARY KEY AUTOINCREMENT);
      CREATE TABLE note (id INTEGER PRIMARY KEY AUTOINCREMENT);
      CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT);
      CREATE TABLE tag_map (id INTEGER PRIMARY KEY AUTOINCREMENT);
      CREATE TABLE points (id INTEGER PRIMARY KEY AUTOINCREMENT);
      CREATE TABLE user_profile (id INTEGER PRIMARY KEY AUTOINCREMENT);
      CREATE TABLE wishlist (id INTEGER PRIMARY KEY AUTOINCREMENT);
      CREATE TABLE record_item_map (id INTEGER PRIMARY KEY AUTOINCREMENT);
      CREATE TABLE deleted_record_item_map (id INTEGER PRIMARY KEY AUTOINCREMENT);
      CREATE TABLE receipt (id INTEGER PRIMARY KEY AUTOINCREMENT);

      CREATE TABLE backlog (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        platform_id INTEGER NOT NULL,
        country_id INTEGER,
        category_id INTEGER NOT NULL,
        play_status_id INTEGER NOT NULL,
        created_at_seconds INTEGER NOT NULL,
        updated_at_seconds INTEGER NOT NULL,
        title TEXT NOT NULL,
        uuid TEXT NOT NULL
      );
    `);

    const nowSeconds = Math.floor(Date.now() / 1000);
    let recordId = 1;

    db.run('BEGIN TRANSACTION;');

    const insertStmt = db.prepare(`
      INSERT INTO ownership (
        id, item_id, platform_id, country_id, ownership_mask,
        created_at, updated_at, category_id, title, uuid,
        user_record_type, deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
    `);

    // Insert owned games
    for (const game of data.games) {
      const platformId =
        game.gameye_platform_id ||
        GAGGLOG_TO_GAMEYE_PLATFORM[game.platform_id] ||
        0;
      const countryId = game.region
        ? GAGGLOG_TO_GAMEYE_COUNTRY[game.region] || 1
        : 1;
      const mask = computeGameOwnershipMask(game.has_case, game.has_manual);
      const uuid = crypto.randomUUID();

      insertStmt.run([
        recordId++,
        game.gameye_id,
        platformId,
        countryId,
        mask,
        nowSeconds,
        nowSeconds,
        0, // category_id = 0 for games
        game.title,
        uuid,
      ]);
    }

    // Insert owned toys
    for (const toy of data.toys) {
      let platformId = GAMEYE_TOY_PLATFORMS[toy.line] || 119;
      if (toy.line.toLowerCase() === 'starlink') {
        platformId = 143;
      }
      const uuid = crypto.randomUUID();

      insertStmt.run([
        recordId++,
        toy.gameye_id,
        platformId,
        null,
        1, // toys always loose
        nowSeconds,
        nowSeconds,
        3, // category_id = 3 for toys-to-life
        toy.title,
        uuid,
      ]);
    }

    insertStmt.free();
    db.run('COMMIT;');

    // Indices matching canonical GAMEYE layout
    db.run(`
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

    const sqliteBuffer = db.export();
    db.close();

    return sqliteBuffer;
  }

  /**
   * Main export method: fetches live data from edge API, builds GED archive,
   * and triggers direct browser download.
   */
  async exportToGameye(): Promise<void> {
    if (this.exporting()) return;
    this.exporting.set(true);

    try {
      const response = await fetch('/api/export/gameye-data');
      if (!response.ok) {
        throw new Error(
          `Failed to fetch GAMEYE export data: ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as GameyeExportData;
      const sqliteBuffer = await this.buildSqliteDatabase(data);
      const zipBytes = await createZipArchive(
        'ownership_database.db',
        sqliteBuffer,
      );

      const filename = this.formatFilename();
      const blob = new Blob([zipBytes as BlobPart], {
        type: 'application/octet-stream',
      });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      console.error('GAMEYE export failed:', err);
      alert('Failed to generate GAMEYE export. Please try again.');
    } finally {
      this.exporting.set(false);
    }
  }
}
