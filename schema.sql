DROP TABLE IF EXISTS figures;
DROP TABLE IF EXISTS figure_series;
DROP TABLE IF EXISTS games;
DROP TABLE IF EXISTS platforms;

CREATE TABLE platforms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    brand TEXT,
    launch_date DATE,
    image_url TEXT,
    description TEXT
);

CREATE TABLE games (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    series TEXT,
    release_date DATE,
    platform TEXT,
    owned BOOLEAN,
    queued BOOLEAN,
    sort_index INTEGER,
    image_url TEXT,
    FOREIGN KEY(platform) REFERENCES platforms(name)
);

CREATE TABLE figure_series (
    id TEXT PRIMARY KEY,
    line TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_index INTEGER,
    UNIQUE(line, name)
);

CREATE TABLE figures (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    line TEXT,
    series_id TEXT,
    release_date DATE,
    sort_index INTEGER,
    owned BOOLEAN,
    image_url TEXT,
    FOREIGN KEY(series_id) REFERENCES figure_series(id)
);
