-- Migration: 0004_performance_indexes.sql
-- Description: Performance indexes for high-frequency edge lookups and crawler mitigation

CREATE UNIQUE INDEX IF NOT EXISTS idx_games_id ON games (id);
CREATE INDEX IF NOT EXISTS idx_toys_amiibo_id ON toys (amiibo_id);
