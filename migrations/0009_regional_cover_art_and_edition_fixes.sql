-- Migration: 0009_regional_cover_art_and_edition_fixes.sql
-- Description: Adds image_url column to game_releases for regional cover art overrides.

ALTER TABLE game_releases ADD COLUMN image_url TEXT;
