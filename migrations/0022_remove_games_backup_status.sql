-- Migration: Remove redundant backup_status column from games table
-- Single source of truth for backups is game_releases.backup_status
ALTER TABLE games DROP COLUMN backup_status;
