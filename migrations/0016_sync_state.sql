-- Migration: 0016_sync_state.sql
-- Description: Creates a key-value sync_state table for tracking resilient background job cursors

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
