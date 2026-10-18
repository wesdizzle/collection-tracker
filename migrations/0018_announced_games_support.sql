-- Migration: 0018_announced_games_support.sql
-- Description: Indexes for fast edge cron lookups of upcoming game releases and physical edition announcement tracking.

PRAGMA foreign_keys = OFF;

CREATE INDEX IF NOT EXISTS idx_game_releases_release_date ON game_releases (release_date);
CREATE INDEX IF NOT EXISTS idx_game_releases_ownership_status ON game_releases (ownership_status);
CREATE INDEX IF NOT EXISTS idx_games_physical_status ON games (physical_status);
