-- Migration: 0007_box_sets_and_edition_labels.sql
-- Description: Adds also_released_as column to game_releases for tracking multi-edition physical releases.

ALTER TABLE game_releases ADD COLUMN also_released_as TEXT;
