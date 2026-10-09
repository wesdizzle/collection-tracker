-- Migration: 0014_index_game_releases_canonical_release_id
-- Description: Index the game_releases.canonical_release_id foreign key.
--
-- Without this index, every DELETE (or PK update) on canonical_releases forces
-- SQLite's foreign key check to full-scan game_releases. On 2026-10-09 a
-- 3,714-row purge of canonical_releases read ~45M rows on remote D1 this way
-- (~12k game_releases rows scanned per deleted row), exhausting the daily
-- read quota. With the index, each check is a single index lookup.
--
-- Remote cost: one-time ~N row writes, where N = rows in game_releases (~12k).

CREATE INDEX IF NOT EXISTS idx_game_releases_canonical_release_id ON game_releases (canonical_release_id);
