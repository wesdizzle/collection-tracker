-- Migration: 0021_cron_performance_indexes.sql
-- Description: Composite index on game_releases for ownership and game_id lookups to eliminate table scans during cron execution.

CREATE INDEX IF NOT EXISTS idx_game_releases_owned_game ON game_releases (ownership_status, game_id);
