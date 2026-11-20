-- Migration: migrations/pivot_media_ownership.sql
-- Description: Rename user_game_releases.backup_status -> has_media and add users.track_individual_media preference.
-- Expected D1 billable row writes: ~5 total (metadata-only DDL + backfill for users with tracked media).

ALTER TABLE user_game_releases RENAME COLUMN backup_status TO has_media;

ALTER TABLE users
  ADD COLUMN track_individual_media INTEGER NOT NULL DEFAULT 0 CHECK (track_individual_media IN (0, 1));

UPDATE users
SET track_individual_media = 1
WHERE track_individual_media = 0
  AND EXISTS (
    SELECT 1
    FROM user_game_releases ugr
    WHERE ugr.user_id = users.id
      AND ugr.has_media > 0
  );
