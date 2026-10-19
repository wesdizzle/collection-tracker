-- Migration: 0020_price_updated_at_indexes.sql
-- Description: Indexes price_updated_at on games and toys to eliminate full table scans during 5-minute rolling valuation refreshes.

CREATE INDEX IF NOT EXISTS idx_toys_price_updated ON toys(price_updated_at);
CREATE INDEX IF NOT EXISTS idx_games_price_updated ON games(price_updated_at);
