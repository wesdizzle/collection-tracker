-- Migration: 0003_release_medium_and_bundles.sql
-- Description: Release medium classification (physical vs. extracted ROM vs. digital) and multi-game bundle parent/child relations (D1 & SQLite compatible)

PRAGMA foreign_keys = OFF;

-- 1. Enhance games table with release medium and origin provenance
ALTER TABLE games ADD COLUMN release_medium TEXT DEFAULT 'physical_retail';
ALTER TABLE games ADD COLUMN origin_metadata TEXT;

-- 2. Enhance games table with multi-game / cross-platform single-box bundle relationships
ALTER TABLE games ADD COLUMN bundle_parent_id INTEGER REFERENCES games (stable_id) ON DELETE SET NULL;
ALTER TABLE games ADD COLUMN bundle_disc_number INTEGER;

-- 3. Create indices for high-performance filtering and bundle relationship retrieval
CREATE INDEX IF NOT EXISTS idx_games_release_medium ON games (release_medium);
CREATE INDEX IF NOT EXISTS idx_games_bundle_parent ON games (bundle_parent_id);

-- 4. Seed Canonical Multi-Game Box Bundles
-- Bayonetta (Wii U, Disc 2) included with Bayonetta 2 (Wii U)
INSERT OR IGNORE INTO games (
    id, title, series, canonical_series, platform_id,
    image_url, play_status, backup_status,
    bundle_parent_id, bundle_disc_number, release_medium, physical_status, verification_tier
)
SELECT 
    'bayonetta-wii-u-included',
    'Bayonetta',
    'Bayonetta',
    'Bayonetta',
    24,
    'https://images.igdb.com/igdb/image/upload/t_cover_big/co1x77.jpg',
    0,
    1,
    g.stable_id,
    2,
    'physical_retail',
    'verified_physical',
    1
FROM games g
WHERE g.platform_id = 24 AND (g.id = 'bayonetta-2-wii-u' OR g.title = 'Bayonetta 2')
LIMIT 1;

INSERT OR IGNORE INTO game_releases (
    id, game_id, region, variants, rom_name, rom_crc, backup_status, ownership_status, release_date, is_physical
)
SELECT 
    'bayonetta-wii-u-included-rel',
    cg.stable_id,
    'USA',
    'Disc 2',
    'Bayonetta (USA) (En,Ja,Fr,De,Es,It).iso',
    NULL,
    1,
    1,
    '2014-10-24',
    1
FROM games cg
WHERE cg.id = 'bayonetta-wii-u-included'
LIMIT 1;

-- Rodea the Sky Soldier (Wii, Bonus Disc) included with Rodea the Sky Soldier (Wii U)
INSERT OR IGNORE INTO games (
    id, title, series, canonical_series, platform_id,
    image_url, play_status, backup_status,
    bundle_parent_id, bundle_disc_number, release_medium, physical_status, verification_tier
)
SELECT 
    'rodea-the-sky-soldier-wii-included',
    'Rodea the Sky Soldier',
    'Rodea the Sky Soldier',
    'Rodea the Sky Soldier',
    22,
    'https://images.igdb.com/igdb/image/upload/t_cover_big/co2044.jpg',
    0,
    1,
    g.stable_id,
    2,
    'physical_retail',
    'verified_physical',
    1
FROM games g
WHERE g.platform_id = 24 AND (g.id = 'rodea-the-sky-soldier-wii-u' OR g.title = 'Rodea the Sky Soldier')
LIMIT 1;

INSERT OR IGNORE INTO game_releases (
    id, game_id, region, variants, rom_name, rom_crc, backup_status, ownership_status, release_date, is_physical
)
SELECT 
    'rodea-the-sky-soldier-wii-included-rel',
    cg.stable_id,
    'USA',
    'Bonus Disc',
    'Rodea the Sky Soldier (USA) (En,Ja,Fr,De).iso',
    NULL,
    1,
    1,
    '2015-11-10',
    1
FROM games cg
WHERE cg.id = 'rodea-the-sky-soldier-wii-included'
LIMIT 1;

-- Set bundle_disc_number = 1 for parent games
UPDATE games SET bundle_disc_number = 1 WHERE platform_id = 24 AND (id = 'bayonetta-2-wii-u' OR title = 'Bayonetta 2');
UPDATE games SET bundle_disc_number = 1 WHERE platform_id = 24 AND (id = 'rodea-the-sky-soldier-wii-u' OR title = 'Rodea the Sky Soldier');

-- 5. Seed Canonical Extracted Archival ROMs
INSERT OR IGNORE INTO games (
    id, title, series, canonical_series, platform_id,
    image_url, play_status, backup_status,
    release_medium, physical_status, verification_tier, origin_metadata
) VALUES (
    'earthbound-beginnings-nes',
    'EarthBound Beginnings',
    'EarthBound',
    'Mother',
    13,
    'https://images.igdb.com/igdb/image/upload/t_cover_big/co2043.jpg',
    0,
    1,
    'digital_extracted_rom',
    'digital_extracted_rom',
    3,
    '{"origin_type":"virtual_console","origin_platform":"Wii U","origin_channel":"Wii U Virtual Console / Nintendo Switch Online","origin_year":2015,"origin_package_title":"EarthBound Beginnings (Wii U Virtual Console)","target_hardware":"Nintendo Entertainment System","notes":"Official 1990 English localization released for the first time on Wii U Virtual Console in 2015."}'
);

INSERT OR IGNORE INTO game_releases (
    id, game_id, region, variants, rom_name, rom_crc, backup_status, ownership_status, release_date, is_physical
)
SELECT 
    'earthbound-beginnings-nes-rel',
    g.stable_id,
    'USA, Europe',
    'Virtual Console',
    'EarthBound Beginnings (USA, Europe) (Virtual Console).nes',
    NULL,
    1,
    1,
    '2015-06-14',
    0
FROM games g
WHERE g.id = 'earthbound-beginnings-nes'
LIMIT 1;

PRAGMA foreign_keys = ON;
