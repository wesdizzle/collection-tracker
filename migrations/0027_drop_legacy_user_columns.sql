-- Migration: 0027_drop_legacy_user_columns.sql
-- Description: Drops legacy single-user personal-state columns and obsolete secondary indexes
-- from shared catalog tables (game_releases, games, toys) now that per-user state is stored
-- in user_game_releases, user_games, and user_toys.

-- 1. Indexes that reference the columns being dropped (SQLite refuses DROP COLUMN otherwise).
DROP INDEX IF EXISTS idx_game_releases_owned_game;
DROP INDEX IF EXISTS idx_game_releases_ownership_game_id;
DROP INDEX IF EXISTS idx_game_releases_ownership_status;
DROP INDEX IF EXISTS idx_game_releases_backup_status;

-- 2. game_releases personal state -> user_game_releases
ALTER TABLE game_releases DROP COLUMN ownership_status;
ALTER TABLE game_releases DROP COLUMN backup_status;
ALTER TABLE game_releases DROP COLUMN has_case;
ALTER TABLE game_releases DROP COLUMN has_manual;

-- 3. games personal state -> user_games (sort_index remains: admin-curated catalog order)
ALTER TABLE games DROP COLUMN play_status;
ALTER TABLE games DROP COLUMN queued;

-- 4. toys personal state -> user_toys (sort_index remains: catalog order)
ALTER TABLE toys DROP COLUMN ownership_status;
