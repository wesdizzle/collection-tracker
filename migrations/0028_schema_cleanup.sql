-- Migration: 0028_schema_cleanup.sql
-- Description: Drop obsolete tables, redundant indexes, and redundant is_physical column

-- 1. Drop redundant secondary indexes
DROP INDEX IF EXISTS idx_games_bundle_parent_id;
DROP INDEX IF EXISTS idx_canonical_rom_crc;

-- 2. Drop obsolete legacy tables superseded by 'toys' and 'toy_series'
DROP TABLE IF EXISTS figures;
DROP TABLE IF EXISTS figure_series;

-- 3. Drop redundant is_physical column from game_releases (all items in collection are physical by definition)
ALTER TABLE game_releases DROP COLUMN is_physical;
