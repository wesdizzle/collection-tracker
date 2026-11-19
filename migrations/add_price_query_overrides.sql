-- Migration: migrations/add_price_query_overrides.sql
-- Description: Stores user-authored eBay search query overrides (zero eBay content persisted).
-- Expected D1 billable row writes: 0 (pure DDL).

CREATE TABLE IF NOT EXISTS price_query_overrides (
    item_type TEXT NOT NULL CHECK (item_type IN ('game', 'toy')),
    item_id TEXT NOT NULL,
    custom_query TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (item_type, item_id)
) WITHOUT ROWID;
