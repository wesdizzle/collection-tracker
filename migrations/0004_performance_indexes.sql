-- Migration: 0004_performance_indexes.sql
-- Description: Performance indexes for high-frequency edge lookups, join queries, and crawler mitigation

CREATE UNIQUE INDEX IF NOT EXISTS idx_games_id ON games (id);
CREATE INDEX IF NOT EXISTS idx_games_platform_id ON games (platform_id);
CREATE INDEX IF NOT EXISTS idx_games_canonical_series ON games (canonical_series);
CREATE INDEX IF NOT EXISTS idx_games_bundle_parent_id ON games (bundle_parent_id);

CREATE INDEX IF NOT EXISTS idx_game_releases_game_id ON game_releases (game_id);
CREATE INDEX IF NOT EXISTS idx_game_releases_rom_name ON game_releases (rom_name);
CREATE INDEX IF NOT EXISTS idx_game_releases_backup_status ON game_releases (backup_status);

CREATE INDEX IF NOT EXISTS idx_toys_series_id ON toys (series_id);
CREATE INDEX IF NOT EXISTS idx_toys_line ON toys (line);
CREATE INDEX IF NOT EXISTS idx_toys_amiibo_id ON toys (amiibo_id);
