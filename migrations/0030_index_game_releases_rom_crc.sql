-- Add partial index on game_releases(rom_crc) to eliminate full-table scans on companion disc lookups
CREATE INDEX IF NOT EXISTS idx_game_releases_rom_crc
ON game_releases(rom_crc)
WHERE rom_crc IS NOT NULL AND rom_crc != '';

-- Drop unread price_updated_at indexes (superseded by stable_id cursor pagination)
DROP INDEX IF EXISTS idx_games_price_updated_at;
DROP INDEX IF EXISTS idx_toys_price_updated_at;
