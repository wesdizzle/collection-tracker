-- Migration: 0012_canonical_indexes.sql
-- Description: Adds B-Tree indexes on canonical_releases(rom_name, rom_crc) to eliminate full-table scan read amplification during candidate verification and release matching.

CREATE INDEX IF NOT EXISTS idx_canonical_rom_name ON canonical_releases (rom_name);
CREATE INDEX IF NOT EXISTS idx_canonical_rom_crc ON canonical_releases (rom_crc);
