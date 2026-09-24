-- Migration: 0006_retail_deal_tracking.sql
-- Description: Adds retail deal and price tracking columns to games table for transient sales and clearance.

ALTER TABLE games ADD COLUMN retail_price INTEGER;
ALTER TABLE games ADD COLUMN retail_regular_price INTEGER;
ALTER TABLE games ADD COLUMN retail_discount_pct INTEGER;
ALTER TABLE games ADD COLUMN retail_on_sale INTEGER NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN retail_store TEXT;
ALTER TABLE games ADD COLUMN retail_url TEXT;
ALTER TABLE games ADD COLUMN retail_updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_games_retail_on_sale ON games (retail_on_sale);
