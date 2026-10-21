-- Migration 0023: Platform 0 ('No Platform') and Physical-First Cleanup

-- 1. Seed virtual platform 0 for untracked console/wishlist titles
INSERT OR IGNORE INTO platforms (id, name, display_name, brand, launch_date)
VALUES (0, 'No Platform', 'No Platform', 'Other', NULL);

-- 2. Migrate legacy physical statuses to clean unified values
UPDATE games SET physical_status = 'not_yet_physical' WHERE physical_status IN ('physical_pending', 'digital_only', 'digital_extracted_rom');
UPDATE games SET physical_status = 'likely_physical' WHERE physical_status = 'announced_unreleased';

-- 3. Remove EarthBound Beginnings digital entry so collection is physical-first
DELETE FROM game_releases WHERE game_id IN (SELECT stable_id FROM games WHERE id = 'earthbound-beginnings-nes');
DELETE FROM games WHERE id = 'earthbound-beginnings-nes';
