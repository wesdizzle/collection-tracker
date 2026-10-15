-- Migration: 0015_index_titles_for_mcp.sql
-- Description: Adds case-insensitive B-Tree indexes on games(title) and toys(name) to enable sub-millisecond point lookups without table scans

CREATE INDEX IF NOT EXISTS idx_games_title_nocase ON games (title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_toys_name_nocase ON toys (name COLLATE NOCASE);
