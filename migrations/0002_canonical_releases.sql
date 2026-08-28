-- Migration: 0002_canonical_releases.sql
-- Description: Canonical physical release signatures and physical verification tracking (D1 & SQLite compatible)

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS canonical_releases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform_id INTEGER NOT NULL,
    raw_title TEXT NOT NULL,
    normalized_title TEXT NOT NULL,
    region TEXT,
    variants TEXT,
    rom_name TEXT,
    rom_crc TEXT,
    serial_code TEXT,
    barcode TEXT,
    publisher TEXT,
    source TEXT NOT NULL DEFAULT 'dat',
    is_verified_physical INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (platform_id) REFERENCES platforms (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_canonical_platform_norm ON canonical_releases (platform_id, normalized_title);
CREATE INDEX IF NOT EXISTS idx_canonical_crc ON canonical_releases (rom_crc);
CREATE INDEX IF NOT EXISTS idx_canonical_serial ON canonical_releases (serial_code);

-- Enhance games table with physical verification metadata
ALTER TABLE games ADD COLUMN physical_status TEXT DEFAULT 'unverified';
ALTER TABLE games ADD COLUMN verification_tier INTEGER DEFAULT 0;
ALTER TABLE games ADD COLUMN barcode TEXT;

-- Enhance game_releases table
ALTER TABLE game_releases ADD COLUMN canonical_release_id INTEGER REFERENCES canonical_releases (id);
ALTER TABLE game_releases ADD COLUMN barcode TEXT;
ALTER TABLE game_releases ADD COLUMN is_physical INTEGER DEFAULT 1;

PRAGMA foreign_keys = ON;
