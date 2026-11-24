-- ============================================================================
-- CURATED STATIC RETAIL GAMES SEED (migrations/seed_curated_games.sql)
-- Description: Authoritative retail boxed releases that IGDB explicitly excludes
--   from its catalog (requiring bundled static cover art and curated metadata).
--
-- Included titles:
--   - PlayStation VR Demo Disc (PlayStation 4 / PSVR, 2016)
--   - PlayStation VR Demo Disc 2.0 (PlayStation 4 / PSVR, 2017)
--   - PlayStation VR Demo Disc 3 (PlayStation 4 / PSVR, 2019)
-- ============================================================================

-- 1. PlayStation VR Demo Disc (2016)
INSERT INTO games (title, platform_id, sort_index, image_url, summary, genres, region, canonical_series, manually_verified)
SELECT 'PlayStation VR Demo Disc', 34, 9001, '/covers/playstation-vr-demo-disc-playstation-4.jpg',
       'Official retail PlayStation VR headset bundle compilation featuring playable demos for launch PSVR titles including Driveclub VR, EVE: Valkyrie, Headmaster, Job Simulator, PlayStation VR Worlds, Rez Infinite, RIGS Mechanized Combat League, Thumper, and Tumble VR.',
       'Demo Compilation, Virtual Reality', 'USA', 'PlayStation VR Demo Disc', 1
WHERE NOT EXISTS (
  SELECT 1 FROM games WHERE title = 'PlayStation VR Demo Disc' COLLATE NOCASE AND platform_id = 34
);

UPDATE games
SET id = COALESCE(id, CAST(stable_id AS TEXT)),
    image_url = COALESCE(image_url, '/covers/playstation-vr-demo-disc-playstation-4.jpg'),
    summary = COALESCE(summary, 'Official retail PlayStation VR headset bundle compilation featuring playable demos for launch PSVR titles including Driveclub VR, EVE: Valkyrie, Headmaster, Job Simulator, PlayStation VR Worlds, Rez Infinite, RIGS Mechanized Combat League, Thumper, and Tumble VR.'),
    genres = COALESCE(genres, 'Demo Compilation, Virtual Reality'),
    region = COALESCE(region, 'USA'),
    canonical_series = COALESCE(canonical_series, 'PlayStation VR Demo Disc'),
    manually_verified = 1
WHERE title = 'PlayStation VR Demo Disc' COLLATE NOCASE
  AND platform_id = 34
  AND (
    id IS NULL OR
    image_url IS NULL OR
    summary IS NULL OR
    genres IS NULL OR
    region IS NULL OR
    canonical_series IS NULL OR
    COALESCE(manually_verified, 0) != 1
  );

INSERT INTO game_releases (id, game_id, region, rom_name, rom_crc, release_date, canonical_release_id)
SELECT CAST(g.stable_id AS TEXT) || '-1', g.stable_id, 'USA', 'PlayStation VR Demo Disc (USA).iso', '6742a37b', '2016-10-13',
       (SELECT cr.id FROM canonical_releases cr WHERE cr.platform_id = 34 AND cr.normalized_title = 'playstationvrdemodisc' AND cr.region = 'USA' LIMIT 1)
FROM games g
WHERE g.title = 'PlayStation VR Demo Disc' COLLATE NOCASE
  AND g.platform_id = 34
  AND NOT EXISTS (SELECT 1 FROM game_releases r WHERE r.game_id = g.stable_id AND r.region = 'USA')
  AND NOT EXISTS (SELECT 1 FROM game_releases r2 WHERE r2.id = CAST(g.stable_id AS TEXT) || '-1');

INSERT INTO game_releases (id, game_id, region, rom_name, rom_crc, release_date, canonical_release_id)
SELECT CAST(g.stable_id AS TEXT) || '-2', g.stable_id, 'Asia', 'PlayStation VR Demo Disc (Asia).iso', '168efcb7', NULL,
       (SELECT cr.id FROM canonical_releases cr WHERE cr.platform_id = 34 AND cr.normalized_title = 'playstationvrdemodisc' AND cr.region = 'Asia' LIMIT 1)
FROM games g
WHERE g.title = 'PlayStation VR Demo Disc' COLLATE NOCASE
  AND g.platform_id = 34
  AND NOT EXISTS (SELECT 1 FROM game_releases r WHERE r.game_id = g.stable_id AND r.region = 'Asia')
  AND NOT EXISTS (SELECT 1 FROM game_releases r2 WHERE r2.id = CAST(g.stable_id AS TEXT) || '-2');

INSERT INTO game_releases (id, game_id, region, rom_name, rom_crc, release_date, canonical_release_id)
SELECT CAST(g.stable_id AS TEXT) || '-3', g.stable_id, 'Europe', 'PlayStation VR Demo Disc (Europe).iso', '3ba25c3a', NULL,
       (SELECT cr.id FROM canonical_releases cr WHERE cr.platform_id = 34 AND cr.normalized_title = 'playstationvrdemodisc' AND cr.region = 'Europe' LIMIT 1)
FROM games g
WHERE g.title = 'PlayStation VR Demo Disc' COLLATE NOCASE
  AND g.platform_id = 34
  AND NOT EXISTS (SELECT 1 FROM game_releases r WHERE r.game_id = g.stable_id AND r.region = 'Europe')
  AND NOT EXISTS (SELECT 1 FROM game_releases r2 WHERE r2.id = CAST(g.stable_id AS TEXT) || '-3');

-- 2. PlayStation VR Demo Disc 2.0 (2017)
INSERT INTO games (title, platform_id, sort_index, image_url, summary, genres, region, canonical_series, manually_verified)
SELECT 'PlayStation VR Demo Disc 2.0', 34, 9002, '/covers/playstation-vr-demo-disc-2-playstation-4.jpg',
       'Official retail PlayStation VR headset bundle compilation featuring playable demos for Battlezone, Dino Frontier, EVE: Valkyrie - Warzone, Fantastic Contraption, Job Simulator, Moss, Raw Data, Rez Infinite, Ring Racers, Starblood Arena, The Persistence, Thumper, and Tiny Trax.',
       'Demo Compilation, Virtual Reality', 'USA', 'PlayStation VR Demo Disc', 1
WHERE NOT EXISTS (
  SELECT 1 FROM games WHERE title = 'PlayStation VR Demo Disc 2.0' COLLATE NOCASE AND platform_id = 34
);

UPDATE games
SET id = COALESCE(id, CAST(stable_id AS TEXT)),
    image_url = COALESCE(image_url, '/covers/playstation-vr-demo-disc-2-playstation-4.jpg'),
    summary = COALESCE(summary, 'Official retail PlayStation VR headset bundle compilation featuring playable demos for Battlezone, Dino Frontier, EVE: Valkyrie - Warzone, Fantastic Contraption, Job Simulator, Moss, Raw Data, Rez Infinite, Ring Racers, Starblood Arena, The Persistence, Thumper, and Tiny Trax.'),
    genres = COALESCE(genres, 'Demo Compilation, Virtual Reality'),
    region = COALESCE(region, 'USA'),
    canonical_series = COALESCE(canonical_series, 'PlayStation VR Demo Disc'),
    manually_verified = 1
WHERE title = 'PlayStation VR Demo Disc 2.0' COLLATE NOCASE
  AND platform_id = 34
  AND (
    id IS NULL OR
    image_url IS NULL OR
    summary IS NULL OR
    genres IS NULL OR
    region IS NULL OR
    canonical_series IS NULL OR
    COALESCE(manually_verified, 0) != 1
  );

INSERT INTO game_releases (id, game_id, region, rom_name, rom_crc, release_date, canonical_release_id)
SELECT CAST(g.stable_id AS TEXT) || '-1', g.stable_id, 'USA', 'PlayStation VR Demo Disc 2.0 (USA).iso', '6c5cb267', '2017-10-10',
       (SELECT cr.id FROM canonical_releases cr WHERE cr.platform_id = 34 AND cr.normalized_title = 'playstationvrdemodisc20' AND cr.region = 'USA' LIMIT 1)
FROM games g
WHERE g.title = 'PlayStation VR Demo Disc 2.0' COLLATE NOCASE
  AND g.platform_id = 34
  AND NOT EXISTS (SELECT 1 FROM game_releases r WHERE r.game_id = g.stable_id AND r.region = 'USA')
  AND NOT EXISTS (SELECT 1 FROM game_releases r2 WHERE r2.id = CAST(g.stable_id AS TEXT) || '-1');

-- 3. PlayStation VR Demo Disc 3 (2019)
INSERT INTO games (title, platform_id, sort_index, image_url, summary, genres, region, canonical_series, manually_verified)
SELECT 'PlayStation VR Demo Disc 3', 34, 9003, '/covers/playstation-vr-demo-disc-3-playstation-4.jpg',
       'Official retail PlayStation VR headset bundle compilation featuring playable demos for Astro Bot Rescue Mission, Battlezone, Headmaster, Job Simulator, Kitchen (Resident Evil 7), Moss, Superhot VR, The Persistence, and Thumper.',
       'Demo Compilation, Virtual Reality', 'USA', 'PlayStation VR Demo Disc', 1
WHERE NOT EXISTS (
  SELECT 1 FROM games WHERE title = 'PlayStation VR Demo Disc 3' COLLATE NOCASE AND platform_id = 34
);

UPDATE games
SET id = COALESCE(id, CAST(stable_id AS TEXT)),
    image_url = COALESCE(image_url, '/covers/playstation-vr-demo-disc-3-playstation-4.jpg'),
    summary = COALESCE(summary, 'Official retail PlayStation VR headset bundle compilation featuring playable demos for Astro Bot Rescue Mission, Battlezone, Headmaster, Job Simulator, Kitchen (Resident Evil 7), Moss, Superhot VR, The Persistence, and Thumper.'),
    genres = COALESCE(genres, 'Demo Compilation, Virtual Reality'),
    region = COALESCE(region, 'USA'),
    canonical_series = COALESCE(canonical_series, 'PlayStation VR Demo Disc'),
    manually_verified = 1
WHERE title = 'PlayStation VR Demo Disc 3' COLLATE NOCASE
  AND platform_id = 34
  AND (
    id IS NULL OR
    image_url IS NULL OR
    summary IS NULL OR
    genres IS NULL OR
    region IS NULL OR
    canonical_series IS NULL OR
    COALESCE(manually_verified, 0) != 1
  );

INSERT INTO game_releases (id, game_id, region, rom_name, rom_crc, release_date, canonical_release_id)
SELECT CAST(g.stable_id AS TEXT) || '-1', g.stable_id, 'USA', 'PlayStation VR Demo Disc 3 (USA).iso', 'cfb9a7ba', '2019-01-22',
       (SELECT cr.id FROM canonical_releases cr WHERE cr.platform_id = 34 AND cr.normalized_title = 'playstationvrdemodisc3' AND cr.region = 'USA' LIMIT 1)
FROM games g
WHERE g.title = 'PlayStation VR Demo Disc 3' COLLATE NOCASE
  AND g.platform_id = 34
  AND NOT EXISTS (SELECT 1 FROM game_releases r WHERE r.game_id = g.stable_id AND r.region = 'USA')
  AND NOT EXISTS (SELECT 1 FROM game_releases r2 WHERE r2.id = CAST(g.stable_id AS TEXT) || '-1');
