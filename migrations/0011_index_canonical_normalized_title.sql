-- Migration: 0011_index_canonical_normalized_title.sql
-- Description: Adds a B-Tree index on canonical_releases(normalized_title) to eliminate full table scans during candidate verification in discovery and bulk matching.

CREATE INDEX IF NOT EXISTS idx_canonical_normalized_title ON canonical_releases (normalized_title);
