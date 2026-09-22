-- Migration: 0005_completeness_and_gameye_pricing.sql
-- Description: Adds completeness columns (has_case, has_manual) to game_releases, and GAMEYE/PriceCharting columns to games and toys.

ALTER TABLE game_releases ADD COLUMN has_case INTEGER NOT NULL DEFAULT 0;
ALTER TABLE game_releases ADD COLUMN has_manual INTEGER NOT NULL DEFAULT 0;

ALTER TABLE games ADD COLUMN gameye_id INTEGER;
ALTER TABLE games ADD COLUMN gameye_platform_id INTEGER;
ALTER TABLE games ADD COLUMN price_loose INTEGER;
ALTER TABLE games ADD COLUMN price_cib INTEGER;
ALTER TABLE games ADD COLUMN price_new INTEGER;
ALTER TABLE games ADD COLUMN price_updated_at TEXT;

ALTER TABLE toys ADD COLUMN gameye_id INTEGER;
ALTER TABLE toys ADD COLUMN price_loose INTEGER;
ALTER TABLE toys ADD COLUMN price_cib INTEGER;
ALTER TABLE toys ADD COLUMN price_new INTEGER;
ALTER TABLE toys ADD COLUMN price_updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_games_gameye_id ON games (gameye_id);
CREATE INDEX IF NOT EXISTS idx_toys_gameye_id ON toys (gameye_id);
