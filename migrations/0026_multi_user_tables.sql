-- Migration: 0026_multi_user_tables.sql
-- Description: Multi-user support. Creates the users table and sparse per-user state tables
-- (user_game_releases, user_games, user_toys), rebuilds journal_entries and push_subscriptions
-- with a user_id owner column, seeds User #1 and copies active single-user collection state.
--
-- Catalog tables (games, game_releases, toys) are not modified here. Their legacy personal columns
-- are dropped separately in migration 0027.

PRAGMA foreign_keys = OFF;

-- 1. Users
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
    home_region TEXT NOT NULL DEFAULT 'USA',
    display_name TEXT,
    bio TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Per-user physical release state. Sparse: a missing row means all-default (unowned, no backup).
CREATE TABLE IF NOT EXISTS user_game_releases (
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    release_id TEXT NOT NULL REFERENCES game_releases (id) ON DELETE CASCADE,
    ownership_status INTEGER NOT NULL DEFAULT 0,
    backup_status INTEGER NOT NULL DEFAULT 0,
    has_case INTEGER NOT NULL DEFAULT 0,
    has_manual INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, release_id)
) WITHOUT ROWID;

-- PK (user_id, release_id) serves all per-user list joins. idx_ugr_release covers cron
-- "owned by anyone" lookups and FK cascade checks when catalog releases are deleted.
CREATE INDEX IF NOT EXISTS idx_ugr_release ON user_game_releases (release_id);

-- 3. Per-user title state (play status / legacy queued flag).
CREATE TABLE IF NOT EXISTS user_games (
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    game_id INTEGER NOT NULL REFERENCES games (stable_id) ON DELETE CASCADE,
    play_status INTEGER NOT NULL DEFAULT 0,
    queued INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, game_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_ug_game ON user_games (game_id);

-- 4. Per-user toy state.
CREATE TABLE IF NOT EXISTS user_toys (
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    toy_id TEXT NOT NULL REFERENCES toys (id) ON DELETE CASCADE,
    ownership_status INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, toy_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_ut_toy ON user_toys (toy_id);

-- 5. Seed User #1 (admin) and make the existing collection public at /u/wesley.
INSERT OR IGNORE INTO users (id, email, username, role, is_public, home_region, display_name)
VALUES (1, '__ADMIN_EMAIL__', 'wesley', 'admin', 1, 'USA', 'Wesley');

-- 6. Copy existing single-user state to User #1 (sparse: non-default rows only).
INSERT OR IGNORE INTO user_game_releases (user_id, release_id, ownership_status, backup_status, has_case, has_manual)
SELECT 1, id, ownership_status, backup_status, COALESCE(has_case, 0), COALESCE(has_manual, 0)
FROM game_releases
WHERE ownership_status <> 0 OR backup_status <> 0 OR COALESCE(has_case, 0) <> 0 OR COALESCE(has_manual, 0) <> 0;

INSERT OR IGNORE INTO user_games (user_id, game_id, play_status, queued)
SELECT 1, stable_id, COALESCE(play_status, 0), COALESCE(queued, 0)
FROM games
WHERE COALESCE(play_status, 0) <> 0 OR COALESCE(queued, 0) <> 0;

INSERT OR IGNORE INTO user_toys (user_id, toy_id, ownership_status)
SELECT 1, id, ownership_status
FROM toys
WHERE id IS NOT NULL AND ownership_status <> 0;

-- 7. Rebuild journal_entries with a per-user uniqueness constraint.
CREATE TABLE journal_entries_v2 (
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

INSERT INTO journal_entries_v2 (
    id, user_id, item_type, item_id, purchase_date, is_approximate_date, price_paid,
    merchant, gifted_by, receipt_url, notes, created_at, updated_at
)
SELECT id, 1, item_type, item_id, purchase_date, is_approximate_date, price_paid,
       merchant, gifted_by, receipt_url, notes, created_at, updated_at
FROM journal_entries;

DROP TABLE journal_entries;
ALTER TABLE journal_entries_v2 RENAME TO journal_entries;
-- UNIQUE (user_id, item_type, item_id) autoindex serves per-user point lookups and per-user scans.

-- 8. Rebuild push_subscriptions with an owning user.
CREATE TABLE push_subscriptions_v2 (
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

INSERT INTO push_subscriptions_v2 (id, user_id, endpoint, p256dh, auth, preferences_json, user_agent, created_at, updated_at)
SELECT id, 1, endpoint, p256dh, auth, preferences_json, user_agent, created_at, updated_at
FROM push_subscriptions;

DROP TABLE push_subscriptions;
ALTER TABLE push_subscriptions_v2 RENAME TO push_subscriptions;
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions (user_id);

PRAGMA foreign_keys = ON;
