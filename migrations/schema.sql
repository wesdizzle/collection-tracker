-- Canonical Schema: migrations/schema.sql
-- Description: Declarative database schema, indexes, and base reference catalog (platforms and toy_series).

PRAGMA foreign_keys = ON;

-- ============================================================================
-- 1. CORE CATALOG & REFERENCE TABLES
-- ============================================================================

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
    UNIQUE (line, name)
);

CREATE TABLE IF NOT EXISTS games (
    stable_id INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT,
    title TEXT NOT NULL,
    series TEXT,
    platform_id INTEGER,
    sort_index INTEGER,
    image_url TEXT,
    igdb_id INTEGER,
    summary TEXT,
    genres TEXT,
    region TEXT,
    collections TEXT,
    franchises TEXT,
    canonical_series TEXT,
    manually_verified INTEGER DEFAULT 0,
    metadata_json TEXT,
    igdb_url TEXT,
    physical_status TEXT DEFAULT 'unverified',
    verification_tier INTEGER DEFAULT 0,
    barcode TEXT,
    release_medium TEXT DEFAULT 'physical_retail',
    origin_metadata TEXT,
    bundle_parent_id INTEGER REFERENCES games (stable_id) ON DELETE SET NULL,
    bundle_disc_number INTEGER,
    retail_price INTEGER,
    retail_regular_price INTEGER,
    retail_discount_pct INTEGER,
    retail_on_sale INTEGER NOT NULL DEFAULT 0,
    retail_store TEXT,
    retail_url TEXT,
    retail_updated_at TEXT,
    FOREIGN KEY (platform_id) REFERENCES platforms (id)
);

CREATE TABLE IF NOT EXISTS canonical_releases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform_id INTEGER NOT NULL,
    raw_title TEXT NOT NULL,
    normalized_title TEXT NOT NULL,
    region TEXT,
    variants TEXT,
    rom_name TEXT,
    rom_crc TEXT,
    serial_code TEXT,
    barcode TEXT,
    publisher TEXT,
    source TEXT NOT NULL DEFAULT 'dat',
    is_verified_physical INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    also_released_as TEXT,
    packin_host_normalized_title TEXT,
    redump_disc_id INTEGER,
    FOREIGN KEY (platform_id) REFERENCES platforms (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS game_releases (
    id TEXT PRIMARY KEY,
    game_id INTEGER NOT NULL REFERENCES games (stable_id) ON DELETE CASCADE,
    region TEXT,
    variants TEXT,
    rom_name TEXT,
    rom_crc TEXT,
    release_date TEXT,
    canonical_release_id INTEGER REFERENCES canonical_releases (id),
    barcode TEXT,
    also_released_as TEXT,
    image_url TEXT
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

CREATE TABLE IF NOT EXISTS ignored_items (
    id TEXT PRIMARY KEY
);

-- ============================================================================
-- 2. MULTI-USER, JOURNAL, PUSH & OBSERVABILITY TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    oidc_sub TEXT,
    is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
    home_region TEXT NOT NULL DEFAULT 'USA',
    display_name TEXT,
    bio TEXT,
    auto_track_series_on_add INTEGER NOT NULL DEFAULT 1 CHECK (auto_track_series_on_add IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_tracking_rules (
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    rule_type TEXT NOT NULL CHECK (rule_type IN ('series', 'platform', 'toy_line', 'toy_series')),
    match_value TEXT NOT NULL,
    target_status INTEGER NOT NULL DEFAULT 2,
    region_scope TEXT NOT NULL DEFAULT 'home' CHECK (region_scope IN ('home', 'any')),
    is_ignored INTEGER NOT NULL DEFAULT 0 CHECK (is_ignored IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, rule_type, match_value)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS user_game_releases (
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    release_id TEXT NOT NULL REFERENCES game_releases (id) ON DELETE CASCADE,
    ownership_status INTEGER NOT NULL DEFAULT 0,
    backup_status INTEGER NOT NULL DEFAULT 0,
    has_case INTEGER NOT NULL DEFAULT 0,
    has_manual INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, release_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS user_games (
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    game_id INTEGER NOT NULL REFERENCES games (stable_id) ON DELETE CASCADE,
    play_status INTEGER NOT NULL DEFAULT 0,
    queued INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, game_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS user_toys (
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    toy_id TEXT NOT NULL REFERENCES toys (id) ON DELETE CASCADE,
    ownership_status INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, toy_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS journal_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    item_type TEXT NOT NULL CHECK (item_type IN ('game', 'toy')),
    item_id TEXT NOT NULL,
    purchase_date TEXT,
    is_approximate_date INTEGER NOT NULL DEFAULT 0 CHECK (is_approximate_date IN (0, 1)),
    price_paid REAL,
    merchant TEXT,
    gifted_by TEXT,
    receipt_url TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, item_type, item_id)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    preferences_json TEXT NOT NULL DEFAULT '{}',
    user_agent TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cron_execution_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_name TEXT NOT NULL,
    status TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    summary TEXT,
    details_json TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 3. INDEXES
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oidc_sub ON users(oidc_sub) WHERE oidc_sub IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_games_id ON games (id);
CREATE INDEX IF NOT EXISTS idx_games_igdb_id ON games(igdb_id) WHERE igdb_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_games_platform_id ON games (platform_id);
CREATE INDEX IF NOT EXISTS idx_games_canonical_series ON games (canonical_series);
CREATE INDEX IF NOT EXISTS idx_games_bundle_parent ON games (bundle_parent_id);
CREATE INDEX IF NOT EXISTS idx_games_physical_status ON games (physical_status);
CREATE INDEX IF NOT EXISTS idx_games_retail_on_sale ON games (retail_on_sale);
CREATE INDEX IF NOT EXISTS idx_games_title_nocase ON games (title COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_canonical_normalized_title ON canonical_releases (normalized_title);
CREATE INDEX IF NOT EXISTS idx_canonical_platform_norm ON canonical_releases (platform_id, normalized_title);
CREATE INDEX IF NOT EXISTS idx_canonical_releases_packin_host
    ON canonical_releases (platform_id, packin_host_normalized_title)
    WHERE packin_host_normalized_title IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_canonical_rom_name ON canonical_releases (rom_name);

CREATE INDEX IF NOT EXISTS idx_game_releases_canonical_release_id ON game_releases (canonical_release_id);
CREATE INDEX IF NOT EXISTS idx_game_releases_game_id ON game_releases (game_id);
CREATE INDEX IF NOT EXISTS idx_game_releases_release_date ON game_releases (release_date);
CREATE INDEX IF NOT EXISTS idx_game_releases_rom_crc
    ON game_releases (rom_crc)
    WHERE rom_crc IS NOT NULL AND rom_crc != '';
CREATE INDEX IF NOT EXISTS idx_game_releases_rom_name ON game_releases (rom_name);

CREATE INDEX IF NOT EXISTS idx_toys_amiibo_id ON toys (amiibo_id);
CREATE INDEX IF NOT EXISTS idx_toys_line ON toys (line);
CREATE INDEX IF NOT EXISTS idx_toys_name_nocase ON toys (name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_toys_series_id ON toys (series_id);

CREATE INDEX IF NOT EXISTS idx_ugr_release ON user_game_releases (release_id);
CREATE INDEX IF NOT EXISTS idx_ug_game ON user_games (game_id);
CREATE INDEX IF NOT EXISTS idx_ut_toy ON user_toys (toy_id);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_cron_logs_job_date ON cron_execution_logs (job_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_logs_created_at ON cron_execution_logs(created_at);

-- ============================================================================
-- 4. BASE REFERENCE CATALOG (PLATFORMS & TOY SERIES)
-- ============================================================================

INSERT OR IGNORE INTO platforms (id, name, brand, launch_date, image_url, description, display_name, igdb_id, parent_platform_id) VALUES
  (0, 'No Platform', 'Other', NULL, NULL, NULL, 'No Platform', NULL, NULL),
  (1, '3DO Interactive Multiplayer', '3DO', '1993-10-04', NULL, NULL, '3DO Interactive Multiplayer', 50, NULL),
  (2, 'Atari 2600', 'Atari', '1977-09-11', NULL, NULL, 'Atari 2600', 59, NULL),
  (3, 'Atari 5200', 'Atari', '1982-01-01', NULL, NULL, 'Atari 5200', 66, NULL),
  (4, 'Atari 7800', 'Atari', '1986-05-01', NULL, NULL, 'Atari 7800', 60, NULL),
  (5, 'Atari Lynx', 'Atari', '1989-09-01', NULL, NULL, 'Atari Lynx', 61, NULL),
  (6, 'Atari Jaguar', 'Atari', '1993-11-23', NULL, NULL, 'Atari Jaguar', 62, NULL),
  (7, 'ColecoVision', 'Coleco', '1982-08-01', NULL, NULL, 'ColecoVision', 68, NULL),
  (8, 'Intellivision', 'Intellivision', '1979-01-01', NULL, NULL, 'Intellivision', 67, NULL),
  (9, 'Neo Geo AES', 'Neo Geo', '1991-07-01', NULL, NULL, 'Neo Geo AES', 80, NULL),
  (10, 'Neo Geo CD', 'Neo Geo', '1994-09-09', NULL, NULL, 'Neo Geo CD', 136, NULL),
  (11, 'Neo Geo Pocket Color', 'Neo Geo', '1999-03-19', NULL, NULL, 'Neo Geo Pocket Color', 120, NULL),
  (12, 'Neo Geo X', 'Neo Geo', '2012-12-18', NULL, NULL, 'Neo Geo X', 377, NULL),
  (13, 'Nintendo Entertainment System', 'Nintendo', '1983-07-15', NULL, NULL, 'Nintendo Entertainment System / Famicom', 18, NULL),
  (14, 'Game Boy', 'Nintendo', '1989-04-21', NULL, NULL, 'Game Boy', 33, NULL),
  (15, 'Super Nintendo Entertainment System', 'Nintendo', '1990-11-21', NULL, NULL, 'Super Nintendo Entertainment System / Super Famicom', 19, NULL),
  (16, 'Virtual Boy', 'Nintendo', '1995-07-21', NULL, NULL, 'Virtual Boy', 87, NULL),
  (17, 'Nintendo 64', 'Nintendo', '1996-06-23', NULL, NULL, 'Nintendo 64', 4, NULL),
  (18, 'Game Boy Color', 'Nintendo', '1998-10-21', NULL, NULL, 'Game Boy Color', 22, NULL),
  (19, 'Game Boy Advance', 'Nintendo', '2001-03-21', NULL, NULL, 'Game Boy Advance', 24, NULL),
  (20, 'Nintendo GameCube', 'Nintendo', '2001-09-14', NULL, NULL, 'Nintendo GameCube', 21, NULL),
  (21, 'Nintendo DS', 'Nintendo', '2004-11-21', NULL, NULL, 'Nintendo DS', 20, NULL),
  (22, 'Wii', 'Nintendo', '2006-11-19', NULL, NULL, 'Wii', 5, NULL),
  (23, 'Nintendo 3DS', 'Nintendo', '2011-02-26', NULL, NULL, 'Nintendo 3DS', 37, NULL),
  (24, 'Wii U', 'Nintendo', '2012-11-18', NULL, NULL, 'Wii U', 41, NULL),
  (25, 'New Nintendo 3DS', 'Nintendo', '2014-10-11', NULL, NULL, 'New Nintendo 3DS', 137, NULL),
  (26, 'Nintendo Switch', 'Nintendo', '2017-03-03', NULL, NULL, 'Nintendo Switch', 130, NULL),
  (27, 'Nintendo Switch 2', 'Nintendo', '2025-06-05', NULL, NULL, 'Nintendo Switch 2', 508, NULL),
  (28, 'Philips CD-i', 'Philips', '1991-12-03', NULL, NULL, 'Philips CD-i', 117, NULL),
  (29, 'PlayStation', 'PlayStation', '1994-12-03', NULL, NULL, 'PlayStation', 7, NULL),
  (30, 'PlayStation 2', 'PlayStation', '2000-03-04', NULL, NULL, 'PlayStation 2', 8, NULL),
  (31, 'PlayStation Portable', 'PlayStation', '2004-12-12', NULL, NULL, 'PlayStation Portable', 38, NULL),
  (32, 'PlayStation 3', 'PlayStation', '2006-11-11', NULL, NULL, 'PlayStation 3', 9, NULL),
  (33, 'PlayStation Vita', 'PlayStation', '2011-12-17', NULL, NULL, 'PlayStation Vita', 46, NULL),
  (34, 'PlayStation 4', 'PlayStation', '2013-11-15', NULL, NULL, 'PlayStation 4', 48, NULL),
  (35, 'PlayStation 5', 'PlayStation', '2020-11-12', NULL, NULL, 'PlayStation 5', 167, NULL),
  (36, 'Sega Master System', 'Sega', '1985-10-20', NULL, NULL, 'Sega Master System', 64, NULL),
  (37, 'Sega Genesis', 'Sega', '1988-10-29', NULL, NULL, 'Genesis / Mega Drive', 29, NULL),
  (38, 'Sega Game Gear', 'Sega', '1990-10-06', NULL, NULL, 'Sega Game Gear', 35, NULL),
  (39, 'Sega CD', 'Sega', '1991-12-12', NULL, NULL, 'Sega CD / Mega-CD', 78, NULL),
  (40, 'Sega Pico', 'Sega', '1993-06-26', NULL, NULL, 'Sega Pico', 339, NULL),
  (41, 'Sega 32X', 'Sega', '1994-11-21', NULL, NULL, 'Sega 32X', 30, NULL),
  (42, 'Sega Saturn', 'Sega', '1994-11-22', NULL, NULL, 'Sega Saturn', 32, NULL),
  (43, 'Dreamcast', 'Sega', '1998-11-27', NULL, NULL, 'Dreamcast', 23, NULL),
  (44, 'Game.com', 'Tiger Electronics', '1997-08-01', NULL, NULL, 'Game.com', 379, NULL),
  (45, 'TurboGrafx-16', 'TurboGrafx', '1987-10-30', NULL, NULL, 'TurboGrafx-16 / PC Engine', 86, NULL),
  (46, 'TurboGrafx CD', 'TurboGrafx', '1988-12-04', NULL, NULL, 'TurboGrafx CD / PC Engine CD', 150, NULL),
  (47, 'Xbox', 'Xbox', '2001-11-15', NULL, NULL, 'Xbox', 11, NULL),
  (48, 'Xbox 360', 'Xbox', '2005-11-22', NULL, NULL, 'Xbox 360', 12, NULL),
  (49, 'Xbox One', 'Xbox', '2013-11-22', NULL, NULL, 'Xbox One', 49, NULL),
  (50, 'Xbox Series X', 'Xbox', '2020-11-10', NULL, NULL, 'Xbox Series X', 169, NULL),
  (51, 'PlayStation VR', 'PlayStation', '2016-10-13', NULL, NULL, 'PlayStation VR', 165, 34),
  (52, 'PlayStation VR2', 'PlayStation', '2023-02-22', NULL, NULL, 'PlayStation VR2', 390, 35),
  (53, 'Famicom', 'Nintendo', '1983-07-15', NULL, NULL, 'Famicom', 99, 13),
  (54, 'Famicom Disk System', 'Nintendo', '1986-02-21', NULL, NULL, 'Famicom Disk System', 51, NULL),
  (55, 'Nintendo 64DD', 'Nintendo', '1999-12-01', NULL, NULL, 'Nintendo 64DD', 416, NULL);

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
