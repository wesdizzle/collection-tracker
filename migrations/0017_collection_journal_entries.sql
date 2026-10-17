-- Migration: 0017_collection_journal_entries.sql
-- Description: Creates the journal_entries table for tracking private acquisition provenance, cost basis, merchant attribution, and receipt verification URLs.

CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_type TEXT NOT NULL CHECK(item_type IN ('game', 'toy')),
  item_id TEXT NOT NULL,
  purchase_date TEXT,
  is_approximate_date INTEGER NOT NULL DEFAULT 0 CHECK(is_approximate_date IN (0, 1)),
  price_paid REAL,
  merchant TEXT,
  gifted_by TEXT,
  receipt_url TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(item_type, item_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_item ON journal_entries(item_type, item_id);
CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_entries(purchase_date);
