-- Migration: 0025_canonical_edition_and_packin_provenance.sql
-- Description: Add also_released_as, packin_host_normalized_title, and redump_disc_id to canonical_releases.

ALTER TABLE canonical_releases ADD COLUMN also_released_as TEXT;
ALTER TABLE canonical_releases ADD COLUMN packin_host_normalized_title TEXT;
ALTER TABLE canonical_releases ADD COLUMN redump_disc_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_canonical_releases_packin_host
  ON canonical_releases(platform_id, packin_host_normalized_title)
  WHERE packin_host_normalized_title IS NOT NULL;
