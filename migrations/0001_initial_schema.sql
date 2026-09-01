-- Migration: 0001_initial_schema.sql
-- Description: Canonical database schema and base reference catalog for Gagglog Collection Tracker (D1 & SQLite compatible)

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS platforms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    brand TEXT,
    launch_date DATE,
    image_url TEXT,
    description TEXT,
    display_name TEXT,
    igdb_id INTEGER,
    parent_platform_id INTEGER
);

CREATE TABLE IF NOT EXISTS toy_series (
    id TEXT PRIMARY KEY,
    line TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_index INTEGER,
    UNIQUE(line, name)
);

CREATE TABLE IF NOT EXISTS ignored_items (
    id TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS games (
    stable_id INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT,
    title TEXT NOT NULL,
    series TEXT,
    platform_id INTEGER,
    queued INTEGER DEFAULT 0,
    sort_index INTEGER,
    image_url TEXT,
    play_status INTEGER DEFAULT 0,
    backup_status INTEGER DEFAULT 0,
    igdb_id INTEGER,
    summary TEXT,
    genres TEXT,
    region TEXT,
    collections TEXT,
    franchises TEXT,
    canonical_series TEXT,
    pricecharting_url TEXT,
    manually_verified INTEGER DEFAULT 0,
    metadata_json TEXT,
    igdb_url TEXT,
    FOREIGN KEY (platform_id) REFERENCES platforms (id)
);

CREATE TABLE IF NOT EXISTS toys (
    stable_id INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT UNIQUE,
    name TEXT NOT NULL,
    line TEXT,
    series_id TEXT,
    release_date DATE,
    sort_index INTEGER,
    image_url TEXT,
    amiibo_id TEXT,
    metadata_json TEXT,
    verified BOOLEAN DEFAULT 0,
    scl_url TEXT,
    region TEXT,
    type TEXT,
    series TEXT,
    ownership_status INTEGER DEFAULT 0,
    FOREIGN KEY (series_id) REFERENCES toy_series (id)
);

CREATE TABLE IF NOT EXISTS toy_game_compatibility (
    toy_stable_id INTEGER,
    game_stable_id INTEGER,
    can_read BOOLEAN,
    can_write BOOLEAN,
    description TEXT,
    PRIMARY KEY (toy_stable_id, game_stable_id),
    FOREIGN KEY (toy_stable_id) REFERENCES toys (stable_id),
    FOREIGN KEY (game_stable_id) REFERENCES games (stable_id)
);

CREATE TABLE IF NOT EXISTS game_releases (
    id TEXT PRIMARY KEY,
    game_id INTEGER NOT NULL REFERENCES games (stable_id) ON DELETE CASCADE,
    region TEXT,
    variants TEXT,
    rom_name TEXT,
    rom_crc TEXT,
    backup_status INTEGER NOT NULL DEFAULT 0,
    ownership_status INTEGER NOT NULL DEFAULT 0,
    release_date TEXT
);

-- Indices for rapid edge retrieval & filtering
CREATE INDEX IF NOT EXISTS idx_games_platform_id ON games (platform_id);
CREATE INDEX IF NOT EXISTS idx_games_canonical_series ON games (canonical_series);
CREATE INDEX IF NOT EXISTS idx_game_releases_game_id ON game_releases (game_id);
CREATE INDEX IF NOT EXISTS idx_toys_series_id ON toys (series_id);
CREATE INDEX IF NOT EXISTS idx_toys_line ON toys (line);

-- Base Platform Seed Catalog
INSERT OR IGNORE INTO platforms (id, name, brand, launch_date, image_url, description, display_name, igdb_id, parent_platform_id) VALUES
  (1, '3DO Interactive Multiplayer', '3DO', '1993-10-04', NULL, NULL, '3DO Interactive Multiplayer', 50, NULL),
  (2, 'Atari 2600', 'Atari', '1977-09-11', NULL, NULL, 'Atari 2600', 59, NULL),
  (3, 'Atari 5200', 'Atari', '1982-01-01', NULL, NULL, 'Atari 5200', 66, NULL),
  (4, 'Atari 7800', 'Atari', '1986-05-01', NULL, NULL, 'Atari 7800', 60, NULL),
  (5, 'Atari Lynx', 'Atari', '1989-09-01', NULL, NULL, 'Atari Lynx', 61, NULL),
  (6, 'Atari Jaguar', 'Atari', '1993-11-23', NULL, NULL, 'Atari Jaguar', 62, NULL),
  (7, 'ColecoVision', 'Coleco', '1982-08-01', NULL, NULL, 'ColecoVision', 68, NULL),
  (8, 'Intellivision', 'Intellivision', '1979-01-01', NULL, NULL, 'Intellivision', 67, NULL),
  (9, 'Neo Geo AES', 'Neo Geo', '1991-07-01', NULL, NULL, 'Neo Geo AES', 80, NULL),
  (10, 'Neo Geo CD', 'Neo Geo', '1996-01-15', NULL, NULL, 'Neo Geo CD', 136, NULL),
  (11, 'Neo Geo Pocket Color', 'Neo Geo', '1999-08-06', NULL, NULL, 'Neo Geo Pocket Color', 120, NULL),
  (12, 'Neo Geo X', 'Neo Geo', '2012-12-18', NULL, NULL, 'Neo Geo X', 377, NULL),
  (13, 'Nintendo Entertainment System', 'Nintendo', '1985-10-18', NULL, NULL, 'Nintendo Entertainment System', 18, NULL),
  (14, 'Game Boy', 'Nintendo', '1989-07-31', NULL, NULL, 'Game Boy', 33, NULL),
  (15, 'Super Nintendo Entertainment System', 'Nintendo', '1991-08-23', NULL, NULL, 'Super Nintendo Entertainment System', 19, NULL),
  (16, 'Virtual Boy', 'Nintendo', '1995-08-14', NULL, NULL, 'Virtual Boy', 87, NULL),
  (17, 'Nintendo 64', 'Nintendo', '1996-09-29', NULL, NULL, 'Nintendo 64', 4, NULL),
  (18, 'Game Boy Color', 'Nintendo', '1998-11-18', NULL, NULL, 'Game Boy Color', 22, NULL),
  (19, 'Game Boy Advance', 'Nintendo', '2001-06-11', NULL, NULL, 'Game Boy Advance', 24, NULL),
  (20, 'Nintendo GameCube', 'Nintendo', '2001-11-18', NULL, NULL, 'Nintendo GameCube', 21, NULL),
  (21, 'Nintendo DS', 'Nintendo', '2004-11-21', NULL, NULL, 'Nintendo DS', 20, NULL),
  (22, 'Wii', 'Nintendo', '2006-11-19', NULL, NULL, 'Wii', 5, NULL),
  (23, 'Nintendo 3DS', 'Nintendo', '2011-03-27', NULL, NULL, 'Nintendo 3DS', 37, NULL),
  (24, 'Wii U', 'Nintendo', '2012-11-18', NULL, NULL, 'Wii U', 41, NULL),
  (25, 'New Nintendo 3DS', 'Nintendo', '2015-02-13', NULL, NULL, 'New Nintendo 3DS', 137, NULL),
  (26, 'Nintendo Switch', 'Nintendo', '2017-03-03', NULL, NULL, 'Nintendo Switch', 130, NULL),
  (27, 'Nintendo Switch 2', 'Nintendo', '2025-06-05', NULL, NULL, 'Nintendo Switch 2', 508, NULL),
  (28, 'Philips CD-i', 'Philips', '1991-12-03', NULL, NULL, 'Philips CD-i', 117, NULL),
  (29, 'PlayStation', 'PlayStation', '1995-09-09', NULL, NULL, 'PlayStation', 7, NULL),
  (30, 'PlayStation 2', 'PlayStation', '2000-10-26', NULL, NULL, 'PlayStation 2', 8, NULL),
  (31, 'PlayStation Portable', 'PlayStation', '2005-03-24', NULL, NULL, 'PlayStation Portable', 38, NULL),
  (32, 'PlayStation 3', 'PlayStation', '2006-11-17', NULL, NULL, 'PlayStation 3', 9, NULL),
  (33, 'PlayStation Vita', 'PlayStation', '2012-02-15', NULL, NULL, 'PlayStation Vita', 46, NULL),
  (34, 'PlayStation 4', 'PlayStation', '2013-11-15', NULL, NULL, 'PlayStation 4', 48, NULL),
  (35, 'PlayStation 5', 'PlayStation', '2020-11-12', NULL, NULL, 'PlayStation 5', 167, NULL),
  (36, 'Sega Master System', 'Sega', '1986-09-01', NULL, NULL, 'Sega Master System', 64, NULL),
  (37, 'Sega Genesis', 'Sega', '1989-08-14', NULL, NULL, 'Sega Genesis', 29, NULL),
  (38, 'Sega Game Gear', 'Sega', '1991-04-01', NULL, NULL, 'Sega Game Gear', 35, NULL),
  (39, 'Sega CD', 'Sega', '1992-10-15', NULL, NULL, 'Sega CD', 78, NULL),
  (40, 'Sega Pico', 'Sega', '1994-11-01', NULL, NULL, 'Sega Pico', 339, NULL),
  (41, 'Sega 32X', 'Sega', '1994-11-21', NULL, NULL, 'Sega 32X', 30, NULL),
  (42, 'Sega Saturn', 'Sega', '1995-05-11', NULL, NULL, 'Sega Saturn', 32, NULL),
  (43, 'Dreamcast', 'Sega', '1999-09-09', NULL, NULL, 'Dreamcast', 23, NULL),
  (44, 'Game.com', 'Tiger Electronics', '1997-08-01', NULL, NULL, 'Game.com', 379, NULL),
  (45, 'TurboGrafx-16', 'TurboGrafx', '1989-08-29', NULL, NULL, 'TurboGrafx-16', 86, NULL),
  (46, 'TurboGrafx CD', 'TurboGrafx', '1989-11-01', NULL, NULL, 'TurboGrafx CD', 150, NULL),
  (47, 'Xbox', 'Xbox', '2001-11-15', NULL, NULL, 'Xbox', 11, NULL),
  (48, 'Xbox 360', 'Xbox', '2005-11-22', NULL, NULL, 'Xbox 360', 12, NULL),
  (49, 'Xbox One', 'Xbox', '2013-11-22', NULL, NULL, 'Xbox One', 49, NULL),
  (50, 'Xbox Series X', 'Xbox', '2020-11-10', NULL, NULL, 'Xbox Series X', 169, NULL),
  (51, 'PlayStation VR', 'PlayStation', '2016-10-13', NULL, NULL, 'PlayStation VR', 165, 34),
  (52, 'PlayStation VR2', 'PlayStation', '2023-02-22', NULL, NULL, 'PlayStation VR2', 390, 35),
  (53, 'Famicom', 'Nintendo', '1983-07-15', NULL, NULL, 'Famicom', 18, NULL);

-- Base Toy Series Seed Catalog
INSERT OR IGNORE INTO toy_series (id, line, name, sort_index) VALUES
  ('amiibo-animal-crossing', 'amiibo', 'Animal Crossing', NULL),
  ('amiibo-chibi-robo', 'amiibo', 'Chibi-Robo', NULL),
  ('amiibo-dark-souls', 'amiibo', 'Dark Souls', NULL),
  ('amiibo-diablo', 'amiibo', 'Diablo', NULL),
  ('amiibo-donkey-kong', 'amiibo', 'Donkey Kong', NULL),
  ('amiibo-fire-emblem', 'amiibo', 'Fire Emblem', NULL),
  ('amiibo-kirby', 'amiibo', 'Kirby', NULL),
  ('amiibo-the-legend-of-zelda', 'amiibo', 'The Legend of Zelda', NULL),
  ('amiibo-mega-man', 'amiibo', 'Mega Man', NULL),
  ('amiibo-metroid', 'amiibo', 'Metroid', NULL),
  ('amiibo-monster-hunter', 'amiibo', 'Monster Hunter', NULL),
  ('amiibo-pikmin', 'amiibo', 'Pikmin', NULL),
  ('amiibo-pok-mon', 'amiibo', 'Pokémon', NULL),
  ('amiibo-shovel-knight', 'amiibo', 'Shovel Knight', NULL),
  ('amiibo-splatoon', 'amiibo', 'Splatoon', NULL),
  ('amiibo-street-fighter', 'amiibo', 'Street Fighter', NULL),
  ('amiibo-super-mario', 'amiibo', 'Super Mario', NULL),
  ('amiibo-super-mario-bros-30th-anniversary', 'amiibo', 'Super Mario Bros. 30th Anniversary', NULL),
  ('amiibo-super-smash-bros', 'amiibo', 'Super Smash Bros.', NULL),
  ('amiibo-xenoblade-chronicles', 'amiibo', 'Xenoblade Chronicles', NULL),
  ('amiibo-yoshi-s-wolly-world', 'amiibo', 'Yoshi''s Wolly World', NULL),
  ('skylanders-spyro-s-adventure', 'Skylanders', 'Spyro''s Adventure', 1),
  ('skylanders-giants', 'Skylanders', 'Giants', 2),
  ('skylanders-swap-force', 'Skylanders', 'Swap Force', 3),
  ('skylanders-trap-team', 'Skylanders', 'Trap Team', 4),
  ('skylanders-superchargers', 'Skylanders', 'SuperChargers', 5),
  ('skylanders-imaginators', 'Skylanders', 'Imaginators', 6),
  ('skylanders-eon-s-elite', 'Skylanders', 'Eon''s Elite', 100),
  ('starlink-battle-for-atlas', 'Starlink', 'Battle for Atlas', NULL),
  ('amiibo-mario-sports-superstars', 'amiibo', 'Mario Sports Superstars', NULL),
  ('amiibo-boxboy', 'amiibo', 'BoxBoy!', NULL),
  ('amiibo-yu-gi-oh', 'amiibo', 'Yu-Gi-Oh!', NULL),
  ('amiibo-super-nintendo-world', 'amiibo', 'Super Nintendo World', NULL),
  ('amiibo-kellogs', 'amiibo', 'Kellogs', NULL),
  ('amiibo-power-pros', 'amiibo', 'Power Pros', NULL),
  ('amiibo-pragmata', 'amiibo', 'Pragmata', NULL),
  ('amiibo-super-mario-bros', 'amiibo', 'Super Mario Bros.', NULL),
  ('amiibo-my-mario-wooden-blocks', 'amiibo', 'My Mario Wooden Blocks', NULL),
  ('amiibo-kirby-air-riders', 'amiibo', 'Kirby Air Riders', NULL),
  ('amiibo-pokemon', 'amiibo', 'Pokemon', NULL),
  ('amiibo-street-fighter-6', 'amiibo', 'Street Fighter 6', NULL);

PRAGMA foreign_keys = ON;
