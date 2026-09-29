-- Migration: 0007_box_sets_and_edition_labels.sql
-- Description: Consolidates Redump multi-game box set revisions into IGDB Box Set entries, fixes 15 unbacked-up ownership-skewed revisions, applies Tier 2 subsequent-version budget badges, and adds Tier 3 also_released_as secondary edition provenance.

PRAGMA foreign_keys = OFF;

-- 1. Add secondary edition provenance column to game_releases
ALTER TABLE game_releases ADD COLUMN also_released_as TEXT;

-- 2. Reassign ownership_status = 1 on 15 unbacked-up (backup_status = 0) revision-skewed games to their Original (v01.00 / v01.01 / Rev 0) launch release
-- Ratchet & Clank Future: Tools of Destruction (PS3)
UPDATE game_releases SET ownership_status = 0, has_case = 0, has_manual = 0 WHERE id = 'ratchet-clank-future-tools-of-destruction-playstation-3-38c624a5';
UPDATE game_releases SET ownership_status = 1, has_case = 1, has_manual = 1 WHERE id = 'ratchet-clank-future-tools-of-destruction-playstation-3-63102f28';
-- Assassin's Creed III (PS3)
UPDATE game_releases SET ownership_status = 0, has_case = 0, has_manual = 0 WHERE id = 'assassin-s-creed-iii-playstation-3-981ad314';
UPDATE game_releases SET ownership_status = 1, has_case = 1, has_manual = 1 WHERE id = 'assassin-s-creed-iii-playstation-3-d8914ab1';
-- Metal Gear Solid 4: Guns of the Patriots (PS3)
UPDATE game_releases SET ownership_status = 0, has_case = 0, has_manual = 0 WHERE id = 'metal-gear-solid-4-guns-of-the-patriots-playstation-3-077dc66c';
UPDATE game_releases SET ownership_status = 1, has_case = 1, has_manual = 1 WHERE id = 'metal-gear-solid-4-guns-of-the-patriots-playstation-3-3ead034f';
-- Far Cry Compilation (PS3)
UPDATE game_releases SET ownership_status = 0, has_case = 0, has_manual = 0 WHERE id = 'far-cry-compilation-playstation-3-9c8278cd';
UPDATE game_releases SET ownership_status = 1, has_case = 1, has_manual = 1 WHERE id = 'far-cry-compilation-playstation-3-e85eb07c';
-- Dead Rising (Xbox 360)
UPDATE game_releases SET ownership_status = 0, has_case = 0, has_manual = 0 WHERE id = 'dead-rising-xbox-360-7f05c838';
UPDATE game_releases SET ownership_status = 1, has_case = 1, has_manual = 1 WHERE id = 'dead-rising-xbox-360-8f31a9ed';
-- Kinect Sports (Xbox 360)
UPDATE game_releases SET ownership_status = 0, has_case = 0, has_manual = 0 WHERE id = 'kinect-sports-xbox-360-232b1c8c';
UPDATE game_releases SET ownership_status = 1, has_case = 1, has_manual = 1 WHERE id = 'kinect-sports-xbox-360-fd4a5c8b';
-- Perfect Dark Zero (Xbox 360)
UPDATE game_releases SET ownership_status = 0, has_case = 0, has_manual = 0 WHERE id = 'perfect-dark-zero-xbox-360-51eb1e1e';
UPDATE game_releases SET ownership_status = 1, has_case = 1, has_manual = 1 WHERE id = 'perfect-dark-zero-xbox-360-d03c896f';
-- Call of Duty: Modern Warfare 3 (Xbox 360)
UPDATE game_releases SET ownership_status = 0, has_case = 0, has_manual = 0 WHERE id = 'call-of-duty-modern-warfare-3-xbox-360-5cafeea5';
UPDATE game_releases SET ownership_status = 1, has_case = 1, has_manual = 1 WHERE id = 'call-of-duty-modern-warfare-3-xbox-360-8021a551';
-- Viva Piñata: Party Animals (Xbox 360)
UPDATE game_releases SET ownership_status = 0, has_case = 0, has_manual = 0 WHERE id = 'viva-pi-ata-party-animals-xbox-360-7f4153b2';
UPDATE game_releases SET ownership_status = 1, has_case = 1, has_manual = 1 WHERE id = 'viva-pi-ata-party-animals-xbox-360-bb3fa9d4';
-- Kinect Sports Rivals (Xbox One)
UPDATE game_releases SET ownership_status = 0, has_case = 0, has_manual = 0 WHERE id = 'kinect-sports-rivals-xbox-one-209e7344';
UPDATE game_releases SET ownership_status = 1, has_case = 1, has_manual = 1 WHERE id = 'kinect-sports-rivals-xbox-one-d4e12912';
-- Wolfenstein: The New Order (Xbox One)
UPDATE game_releases SET ownership_status = 0, has_case = 0, has_manual = 0 WHERE id = 'wolfenstein-the-new-order-xbox-one-8e39f111';
UPDATE game_releases SET ownership_status = 1, has_case = 1, has_manual = 1 WHERE id = 'wolfenstein-the-new-order-xbox-one-a8daad63';
-- Ryse: Son of Rome (Xbox One)
UPDATE game_releases SET ownership_status = 0, has_case = 0, has_manual = 0 WHERE id = 'ryse-son-of-rome-xbox-one-1711bdae';
UPDATE game_releases SET ownership_status = 1, has_case = 1, has_manual = 1 WHERE id = 'ryse-son-of-rome-xbox-one-4a851e8e';
-- Plants vs. Zombies: Garden Warfare (Xbox One)
UPDATE game_releases SET ownership_status = 0, has_case = 0, has_manual = 0 WHERE id = 'plants-vs-zombies-garden-warfare-xbox-one-3651a9f5';
UPDATE game_releases SET ownership_status = 1, has_case = 1, has_manual = 1 WHERE id = 'plants-vs-zombies-garden-warfare-xbox-one-e734cf83';
-- Spyro Reignited Trilogy (PS4)
UPDATE game_releases SET ownership_status = 0, has_case = 0, has_manual = 0 WHERE id = 'spyro-reignited-trilogy-playstation-4-763d613d';
UPDATE game_releases SET ownership_status = 1, has_case = 1, has_manual = 1 WHERE id = 'spyro-reignited-trilogy-playstation-4-da25b0c2';
-- Wonder Boy: The Dragon's Trap (PS4)
UPDATE game_releases SET ownership_status = 0, has_case = 0, has_manual = 0 WHERE id = 'wonder-boy-the-dragon-s-trap-playstation-4-23f807e2';
UPDATE game_releases SET ownership_status = 1, has_case = 1, has_manual = 1 WHERE id = 'wonder-boy-the-dragon-s-trap-playstation-4-d9bcd571';
-- God of War Collection (PS3) — reassign from v02.00 (God of War Saga) to v01.00 (Original USA, Asia)
UPDATE game_releases SET ownership_status = 0, has_case = 0, has_manual = 0 WHERE id = 'god-of-war-collection-playstation-3-02245c63';
UPDATE game_releases SET ownership_status = 1, has_case = 1, has_manual = 1 WHERE id = 'god-of-war-collection-playstation-3-fb2dc4df';
-- God of War III (PS3) — reassign from v02.00 (God of War Saga / Greatest Hits) to v01.03 (Original USA, Canada)
UPDATE game_releases SET ownership_status = 0, has_case = 0, has_manual = 0 WHERE id = 'god-of-war-iii-playstation-3-d44f7b66';
UPDATE game_releases SET ownership_status = 1, has_case = 1, has_manual = 1 WHERE id = 'god-of-war-iii-playstation-3-fd2c01ed';

-- 3. Seed IGDB Multi-Game Box Sets and update PS3 Mass Effect (stable_id = 2518) in-place to Mass Effect Trilogy
UPDATE games
SET id = 'mass-effect-trilogy-playstation-3',
    title = 'Mass Effect Trilogy',
    igdb_id = 45181,
    igdb_url = 'https://www.igdb.com/games/mass-effect-trilogy',
    image_url = 'https://images.igdb.com/igdb/image/upload/t_cover_big/co4a7a.jpg',
    summary = 'Mass Effect Trilogy is a compilation of the first three Mass Effect games, a series of action role-playing games with third-person shooter combat. Players customize a central character, choose a class and abilities, and travel between star systems to explore planets, complete missions, and fight in squad-based encounters. Conversations use a dialogue system in which player choices shape relationships and how parts of the story unfold.',
    genres = 'Shooter, Role-playing (RPG), Adventure, Strategy'
WHERE stable_id = 2518;
UPDATE game_releases SET release_date = '2012-12-04' WHERE id IN ('mass-effect-playstation-3-aa5b218c', 'mass-effect-playstation-3-dace5598');

-- God of War Saga (Platform 32)
INSERT OR IGNORE INTO games (
    id, title, series, canonical_series, platform_id,
    image_url, play_status, backup_status, igdb_id, igdb_url,
    summary, genres, region, collections, franchises,
    release_medium, physical_status, verification_tier
) VALUES (
    'god-of-war-saga-playstation-3',
    'God of War Saga',
    'God of War',
    'God of War',
    32,
    'https://images.igdb.com/igdb/image/upload/t_cover_big/co2enc.jpg',
    0,
    0,
    23827,
    'https://www.igdb.com/games/god-of-war-saga',
    'The God of War Saga is a collection of five games from the God of War series, and is one of the first in Sony''s new line of PlayStation Collections.

- God of War
- God of War II
- God of War III
- God of War: Chains of Olympus
- God of War: Ghost of Sparta',
    'Hack and slash/Beat ''em up, Adventure',
    'NA',
    'God of War',
    'God of War',
    'physical_retail',
    'verified_physical',
    1
);
UPDATE game_releases
SET game_id = (SELECT stable_id FROM games WHERE id = 'god-of-war-saga-playstation-3'),
    variants = NULL,
    release_date = '2012-08-27'
WHERE id IN ('god-of-war-collection-playstation-3-02245c63', 'god-of-war-iii-playstation-3-d44f7b66');

-- Infamous Collection (Platform 32)
INSERT OR IGNORE INTO games (
    id, title, series, canonical_series, platform_id,
    image_url, play_status, backup_status, igdb_id, igdb_url,
    summary, genres, region, collections, franchises,
    release_medium, physical_status, verification_tier
) VALUES (
    'infamous-collection-playstation-3',
    'Infamous Collection',
    'Infamous',
    'Infamous',
    32,
    'https://images.igdb.com/igdb/image/upload/t_cover_big/co5rxs.jpg',
    0,
    0,
    23828,
    'https://www.igdb.com/games/infamous-collection',
    'Infamous Collection is a collection of Infamous, Infamous 2, and Infamous: Festival of Blood, bundled together as part of Sony''s line of PlayStation Collections for the PlayStation 3. The games feature the same features as their original releases. In addition to the games, the collection features bonus content, including extra missions, and additional character costumes, power ups and weapon styles.',
    'Hack and slash/Beat ''em up, Adventure, Platform, Shooter, Puzzle',
    'NA',
    'Infamous',
    'Infamous',
    'physical_retail',
    'verified_physical',
    1
);
UPDATE game_releases
SET game_id = (SELECT stable_id FROM games WHERE id = 'infamous-collection-playstation-3'),
    variants = NULL,
    release_date = '2012-08-28'
WHERE id IN ('infamous-playstation-3-bf628d43', 'infamous-2-playstation-3-581c29e5');

-- Assassin's Creed: Heritage Collection (Platform 32)
INSERT OR IGNORE INTO games (
    id, title, series, canonical_series, platform_id,
    image_url, play_status, backup_status, igdb_id, igdb_url,
    summary, genres, region, collections, franchises,
    release_medium, physical_status, verification_tier
) VALUES (
    'assassin-s-creed-heritage-collection-playstation-3',
    'Assassin''s Creed: Heritage Collection',
    'Assassin''s Creed',
    'Assassin''s Creed',
    32,
    'https://images.igdb.com/igdb/image/upload/t_cover_big/co4qz5.jpg',
    0,
    0,
    43015,
    'https://www.igdb.com/games/assassins-creed-heritage-collection',
    'Assassin''s Creed: Heritage Collection is a compilation consisting of the main games in the Assassin''s Creed series, similar to the previous Anthology bundle released in 2012; the Heritage Collection includes Assassin''s Creed, Assassin''s Creed II, Assassin''s Creed: Brotherhood, Assassin''s Creed: Revelations and Assassin''s Creed III.',
    'Adventure, Platform, Puzzle',
    'NA',
    'Assassin''s Creed, Assassin''s Creed II',
    'Assassin''s Creed',
    'physical_retail',
    'verified_physical',
    1
);
UPDATE game_releases
SET game_id = (SELECT stable_id FROM games WHERE id = 'assassin-s-creed-heritage-collection-playstation-3'),
    variants = NULL,
    release_date = '2013-11-07'
WHERE id IN ('assassin-s-creed-playstation-3-d57b6494', 'assassin-s-creed-playstation-3-3e3c943d');

-- Mass Effect Trilogy (Platform 48)
INSERT OR IGNORE INTO games (
    id, title, series, canonical_series, platform_id,
    image_url, play_status, backup_status, igdb_id, igdb_url,
    summary, genres, region, collections, franchises,
    release_medium, physical_status, verification_tier
) VALUES (
    'mass-effect-trilogy-xbox-360',
    'Mass Effect Trilogy',
    'Mass Effect',
    'Mass Effect',
    48,
    'https://images.igdb.com/igdb/image/upload/t_cover_big/co4a7a.jpg',
    0,
    0,
    45181,
    'https://www.igdb.com/games/mass-effect-trilogy',
    'Mass Effect Trilogy is a compilation of the first three Mass Effect games, a series of action role-playing games with third-person shooter combat. Players customize a central character, choose a class and abilities, and travel between star systems to explore planets, complete missions, and fight in squad-based encounters. Conversations use a dialogue system in which player choices shape relationships and how parts of the story unfold.',
    'Shooter, Role-playing (RPG), Adventure, Strategy',
    'NA',
    'Mass Effect',
    'Mass Effect',
    'physical_retail',
    'verified_physical',
    1
);
UPDATE game_releases
SET game_id = (SELECT stable_id FROM games WHERE id = 'mass-effect-trilogy-xbox-360'),
    variants = NULL,
    release_date = '2012-11-06'
WHERE id IN ('mass-effect-xbox-360-f2df4684', 'mass-effect-xbox-360-e79a9ba4', 'mass-effect-3-xbox-360-6e46d154', 'mass-effect-3-xbox-360-97a98ca1');

-- Far Cry Compilation (Platform 48)
INSERT OR IGNORE INTO games (
    id, title, series, canonical_series, platform_id,
    image_url, play_status, backup_status, igdb_id, igdb_url,
    summary, genres, region, collections, franchises,
    release_medium, physical_status, verification_tier
) VALUES (
    'far-cry-compilation-xbox-360',
    'Far Cry Compilation',
    'Far Cry',
    'Far Cry',
    48,
    'https://images.igdb.com/igdb/image/upload/t_cover_big/co62si.jpg',
    0,
    0,
    163874,
    'https://www.igdb.com/games/far-cry-compilation',
    'Far Cry Compilation is a collection of Far Cry games that includes Far Cry 2, Far Cry 3 and Far Cry 3: Blood Dragon. The compilation was created to celebrate the tenth anniversary of the Far Cry series and released only in North America.',
    'Shooter, Adventure',
    'NA',
    'Far Cry',
    'Far Cry',
    'physical_retail',
    'verified_physical',
    1
);
UPDATE game_releases
SET game_id = (SELECT stable_id FROM games WHERE id = 'far-cry-compilation-xbox-360'),
    variants = NULL,
    release_date = '2014-02-11'
WHERE id IN ('far-cry-3-xbox-360-a90d5743');

-- Call of Duty: The War Collection (Platform 48)
INSERT OR IGNORE INTO games (
    id, title, series, canonical_series, platform_id,
    image_url, play_status, backup_status, igdb_id, igdb_url,
    summary, genres, region, collections, franchises,
    release_medium, physical_status, verification_tier
) VALUES (
    'call-of-duty-the-war-collection-xbox-360',
    'Call of Duty: The War Collection',
    'Call of Duty',
    'Call of Duty',
    48,
    'https://images.igdb.com/igdb/image/upload/t_cover_big/co7xxf.jpg',
    0,
    0,
    292856,
    'https://www.igdb.com/games/call-of-duty-the-war-collection',
    'Call of Duty: The War Collection is a bundle pack of the games Call of Duty 2, Call of Duty 3, and Call of Duty: World at War. The bundle pack is only available for the Xbox 360.',
    'Shooter, Adventure',
    'NA',
    'Call of Duty',
    'Call of Duty',
    'physical_retail',
    'verified_physical',
    1
);
UPDATE game_releases
SET game_id = (SELECT stable_id FROM games WHERE id = 'call-of-duty-the-war-collection-xbox-360'),
    variants = NULL,
    release_date = '2010-06-08'
WHERE id IN ('call-of-duty-2-xbox-360-e67ae346');

-- Kinect Sports: Ultimate Collection (Platform 48)
INSERT OR IGNORE INTO games (
    id, title, series, canonical_series, platform_id,
    image_url, play_status, backup_status, igdb_id, igdb_url,
    summary, genres, region, collections, franchises,
    release_medium, physical_status, verification_tier
) VALUES (
    'kinect-sports-ultimate-collection-xbox-360',
    'Kinect Sports: Ultimate Collection',
    'Kinect Sports',
    'Kinect Sports',
    48,
    'https://images.igdb.com/igdb/image/upload/t_cover_big/co489z.jpg',
    0,
    0,
    47401,
    'https://www.igdb.com/games/kinect-sports-ultimate-collection',
    'Finally, you don''t have to choose! This ultimate collection has two best-selling Kinect games wrapped into one - putting 13 great sporting games at your fingertips.',
    'Sport',
    'NA',
    'Kinect Sports',
    NULL,
    'physical_retail',
    'verified_physical',
    1
);
UPDATE game_releases
SET game_id = (SELECT stable_id FROM games WHERE id = 'kinect-sports-ultimate-collection-xbox-360'),
    variants = NULL,
    release_date = '2012-10-18'
WHERE id IN ('kinect-sports-xbox-360-232b1c8c');

-- Assassin's Creed: Heritage Collection (Platform 48)
INSERT OR IGNORE INTO games (
    id, title, series, canonical_series, platform_id,
    image_url, play_status, backup_status, igdb_id, igdb_url,
    summary, genres, region, collections, franchises,
    release_medium, physical_status, verification_tier
) VALUES (
    'assassin-s-creed-heritage-collection-xbox-360',
    'Assassin''s Creed: Heritage Collection',
    'Assassin''s Creed',
    'Assassin''s Creed',
    48,
    'https://images.igdb.com/igdb/image/upload/t_cover_big/co4qz5.jpg',
    0,
    0,
    43015,
    'https://www.igdb.com/games/assassins-creed-heritage-collection',
    'Assassin''s Creed: Heritage Collection is a compilation consisting of the main games in the Assassin''s Creed series, including Assassin''s Creed, Assassin''s Creed II, Assassin''s Creed: Brotherhood, Assassin''s Creed: Revelations and Assassin''s Creed III.',
    'Adventure, Platform, Puzzle',
    'NA',
    'Assassin''s Creed, Assassin''s Creed II',
    'Assassin''s Creed',
    'physical_retail',
    'verified_physical',
    1
);
UPDATE game_releases
SET game_id = (SELECT stable_id FROM games WHERE id = 'assassin-s-creed-heritage-collection-xbox-360'),
    variants = NULL,
    release_date = '2013-11-07'
WHERE id IN ('assassin-s-creed-ii-xbox-360-e91e7289', 'assassin-s-creed-ii-xbox-360-62d6de69', 'assassin-s-creed-iii-xbox-360-6ee6ad2f', 'assassin-s-creed-iii-xbox-360-817ebc45', 'assassin-s-creed-iii-xbox-360-ac53527f', 'assassin-s-creed-iii-xbox-360-d483ee7e');

-- Grand Theft Auto: The Trilogy (Platform 30)
INSERT OR IGNORE INTO games (
    id, title, series, canonical_series, platform_id,
    image_url, play_status, backup_status, igdb_id, igdb_url,
    summary, genres, region, collections, franchises,
    release_medium, physical_status, verification_tier
) VALUES (
    'grand-theft-auto-the-trilogy-playstation-2',
    'Grand Theft Auto: The Trilogy',
    'Grand Theft Auto',
    'Grand Theft Auto',
    30,
    'https://images.igdb.com/igdb/image/upload/t_cover_big/co2ms5.jpg',
    0,
    0,
    5850,
    'https://www.igdb.com/games/grand-theft-auto-the-trilogy',
    'A bundle that contains the original trilogy from one of the most popular and critically acclaimed franchises in entertainment history.

- GTA III
- GTA Vice City
- GTA San Andreas',
    'Racing, Adventure, Shooter, Simulator, Arcade',
    'NA',
    'Grand Theft Auto',
    'Grand Theft Auto',
    'physical_retail',
    'verified_physical',
    1
);
UPDATE game_releases
SET game_id = (SELECT stable_id FROM games WHERE id = 'grand-theft-auto-the-trilogy-playstation-2'),
    variants = NULL,
    release_date = '2006-12-04'
WHERE id IN ('grand-theft-auto-vice-city-playstation-2-7d2bfcf4', 'grand-theft-auto-vice-city-playstation-2-b17ba0a2', 'grand-theft-auto-san-andreas-playstation-2-d43d36d5');

-- Grand Theft Auto: The Trilogy (Platform 47)
INSERT OR IGNORE INTO games (
    id, title, series, canonical_series, platform_id,
    image_url, play_status, backup_status, igdb_id, igdb_url,
    summary, genres, region, collections, franchises,
    release_medium, physical_status, verification_tier
) VALUES (
    'grand-theft-auto-the-trilogy-xbox',
    'Grand Theft Auto: The Trilogy',
    'Grand Theft Auto',
    'Grand Theft Auto',
    47,
    'https://images.igdb.com/igdb/image/upload/t_cover_big/co2ms5.jpg',
    0,
    0,
    5850,
    'https://www.igdb.com/games/grand-theft-auto-the-trilogy',
    'A bundle that contains the original trilogy from one of the most popular and critically acclaimed franchises in entertainment history.

- GTA III
- GTA Vice City
- GTA San Andreas',
    'Racing, Adventure, Shooter, Simulator, Arcade',
    'NA',
    'Grand Theft Auto',
    'Grand Theft Auto',
    'physical_retail',
    'verified_physical',
    1
);
UPDATE game_releases
SET game_id = (SELECT stable_id FROM games WHERE id = 'grand-theft-auto-the-trilogy-xbox'),
    variants = NULL,
    release_date = '2005-10-17'
WHERE id IN ('grand-theft-auto-vice-city-xbox-47a47b2b', 'grand-theft-auto-vice-city-xbox-17401073', 'grand-theft-auto-vice-city-xbox-27a5faa4', 'grand-theft-auto-san-andreas-xbox-df7590e6', 'grand-theft-auto-san-andreas-xbox-5ec3253b', 'grand-theft-auto-san-andreas-xbox-eb73734c');

-- Resident Evil: The Essentials (Platform 30)
INSERT OR IGNORE INTO games (
    id, title, series, canonical_series, platform_id,
    image_url, play_status, backup_status, igdb_id, igdb_url,
    summary, genres, region, collections, franchises,
    release_medium, physical_status, verification_tier
) VALUES (
    'resident-evil-the-essentials-playstation-2',
    'Resident Evil: The Essentials',
    'Resident Evil',
    'Resident Evil',
    30,
    'https://images.igdb.com/igdb/image/upload/t_cover_big/co2w7w.jpg',
    0,
    0,
    145057,
    'https://www.igdb.com/games/resident-evil-the-essentials',
    'Resident Evil: The Essentials is a box-set for the PlayStation 2, released in 2007. The set includes the following: Resident Evil CODE: Veronica X, Resident Evil Outbreak and Resident Evil 4.',
    'Shooter, Puzzle, Adventure',
    'NA',
    'Resident Evil, Resident Evil Outbreak',
    'Resident Evil',
    'physical_retail',
    'verified_physical',
    1
);
UPDATE game_releases
SET game_id = (SELECT stable_id FROM games WHERE id = 'resident-evil-the-essentials-playstation-2'),
    variants = NULL,
    release_date = '2007-09-04'
WHERE id IN ('resident-evil-outbreak-playstation-2-f3a36cc9');

-- Crash Bandicoot Action Pack (Platform 30)
INSERT OR IGNORE INTO games (
    id, title, series, canonical_series, platform_id,
    image_url, play_status, backup_status, igdb_id, igdb_url,
    summary, genres, region, collections, franchises,
    release_medium, physical_status, verification_tier
) VALUES (
    'crash-bandicoot-action-pack-playstation-2',
    'Crash Bandicoot Action Pack',
    'Crash Bandicoot',
    'Crash Bandicoot',
    30,
    'https://images.igdb.com/igdb/image/upload/t_cover_big/co5bgx.jpg',
    0,
    0,
    196663,
    'https://www.igdb.com/games/crash-bandicoot-action-pack',
    'Crash Bandicoot Action Pack is a bundle containing Crash Nitro Kart, Crash Twinsanity, and Crash Tag Team Racing.',
    'Platform',
    'NA',
    'Crash Bandicoot',
    'Crash Bandicoot',
    'physical_retail',
    'verified_physical',
    1
);
UPDATE game_releases
SET game_id = (SELECT stable_id FROM games WHERE id = 'crash-bandicoot-action-pack-playstation-2'),
    variants = NULL,
    release_date = '2007-06-12'
WHERE id IN ('crash-twinsanity-playstation-2-06c5bb4a');

-- 4. Re-home box-set discs into existing box-set games in collection.sqlite
-- Metal Gear Solid 4 (v02.00 / v02.01) -> Metal Gear Solid: The Legacy Collection (stable_id = 2523)
UPDATE game_releases
SET game_id = (SELECT stable_id FROM games WHERE id = 'metal-gear-solid-the-legacy-collection-playstation-3'),
    variants = NULL,
    release_date = '2013-07-09'
WHERE id IN (
    'metal-gear-solid-4-guns-of-the-patriots-playstation-3-077dc66c',
    'metal-gear-solid-4-guns-of-the-patriots-playstation-3-3ac34704',
    'metal-gear-solid-4-guns-of-the-patriots-playstation-3-66d466e1'
);
-- Remove obsolete Superseded tag from standalone Metal Gear Solid 4 (v01.01) releases
UPDATE game_releases
SET variants = 'v01.01'
WHERE id IN (
    'metal-gear-solid-4-guns-of-the-patriots-playstation-3-3ead034f',
    'metal-gear-solid-4-guns-of-the-patriots-playstation-3-709fffc8'
);
-- Normalize Killzone Trilogy (USA) Disc 1 variants to NULL so its disc subtitle is shown in disc_label rather than as a variant tag
UPDATE game_releases
SET variants = NULL
WHERE id = 'killzone-trilogy-playstation-3-160cfb0b';
-- Re-home mis-attached compilation discs from Assassin's Creed 1 (stable_id = 2352) to Ezio Trilogy (2357), Americas Collection (2359), and Revelations (2355)
UPDATE game_releases
SET game_id = (SELECT stable_id FROM games WHERE id = 'assassin-s-creed-ezio-trilogy-playstation-3'),
    release_date = '2012-11-13'
WHERE id = 'assassin-s-creed-playstation-3-029a6ef6';
UPDATE game_releases
SET game_id = (SELECT stable_id FROM games WHERE id = 'assassin-s-creed-the-americas-collection-playstation-3'),
    release_date = '2014-10-03'
WHERE id IN (
    'assassin-s-creed-playstation-3-dfa638ec',
    'assassin-s-creed-playstation-3-c8c8995e'
);
UPDATE game_releases
SET game_id = (SELECT stable_id FROM games WHERE id = 'assassin-s-creed-revelations-playstation-3'),
    variants = 'Special Edition'
WHERE id = 'assassin-s-creed-playstation-3-17d219f7';

-- 5. Apply Tier 2 prominent primary budget badges to subsequent-version budget-exclusive releases
UPDATE game_releases SET variants = 'v02.00, Essentials' WHERE id = 'assassin-s-creed-iii-playstation-3-26cb9721';
UPDATE game_releases SET variants = 'v03.01, Essentials' WHERE id = 'lego-harry-potter-years-1-4-playstation-3-3b876f19';
UPDATE game_releases SET variants = 'v02.00, Essentials, Platinum' WHERE id = 'assassin-s-creed-brotherhood-playstation-3-d8551c41';
UPDATE game_releases SET variants = 'v02.00, Greatest Hits' WHERE id = 'assassin-s-creed-iii-playstation-3-981ad314';
UPDATE game_releases SET variants = 'v02.00, Greatest Hits' WHERE id = 'ratchet-clank-future-tools-of-destruction-playstation-3-38c624a5';
UPDATE game_releases SET variants = 'v02.00, PlayStation 3 the Best' WHERE id = 'bayonetta-playstation-3-a011b01d';
UPDATE game_releases SET variants = 'v02.00, Ubi the Best' WHERE id = 'assassin-s-creed-iii-playstation-3-a4d167e9';
UPDATE game_releases SET variants = 'Rev 1, Xbox Classics' WHERE id = 'fable-ii-xbox-360-d62a1750';
UPDATE game_releases SET variants = 'Rev 2, Xbox Classics' WHERE id = 'fable-ii-xbox-360-397f70ab';
UPDATE game_releases SET variants = 'Rev 1, Xbox Classics' WHERE id = 'kameo-elements-of-power-xbox-360-814cd92e';
UPDATE game_releases SET variants = 'Rev 2, Xbox Classics' WHERE id = 'fable-ii-xbox-360-4bfe56b9';
UPDATE game_releases SET variants = 'Rev 1, Xbox Classics, Platinum Hits' WHERE id = 'lego-star-wars-the-complete-saga-xbox-360-71735925';
UPDATE game_releases SET variants = 'Rev 2, Xbox Classics, Platinum Hits' WHERE id = 'fable-ii-xbox-360-8a52c9e7';
UPDATE game_releases SET variants = 'Rev 1, Platinum Hits' WHERE id = 'dark-souls-xbox-360-73890456';
UPDATE game_releases SET variants = 'Rev 1, Platinum Hits' WHERE id = 'lego-harry-potter-years-1-4-xbox-360-a7b9b382';
UPDATE game_releases SET variants = 'Rev 1, Platinum Hits' WHERE id = 'perfect-dark-zero-xbox-360-51eb1e1e';
UPDATE game_releases SET variants = 'v1.01, Greatest Hits' WHERE id = 'crash-bandicoot-the-wrath-of-cortex-playstation-2-1a0009b6';
UPDATE game_releases SET variants = 'v2.01, Greatest Hits' WHERE id = 'jak-ii-playstation-2-25c094e4';
UPDATE game_releases SET variants = 'v2.00, Greatest Hits' WHERE id = 'jak-x-combat-racing-playstation-2-4437d041';
UPDATE game_releases SET variants = 'v2.00, Greatest Hits' WHERE id = 'lego-star-wars-the-video-game-playstation-2-c60f83a2';
UPDATE game_releases SET variants = 'v2.00, Greatest Hits' WHERE id = 'ratchet-clank-going-commando-playstation-2-98197b41';
UPDATE game_releases SET variants = 'v2.01, Greatest Hits' WHERE id = 'spider-man-playstation-2-fbcae186';
UPDATE game_releases SET variants = 'v2.00, Greatest Hits' WHERE id = 'spider-man-3-playstation-2-b6d9e603';
UPDATE game_releases SET variants = 'v2.00, Greatest Hits' WHERE id = 'star-wars-battlefront-ii-playstation-2-2cd6fa31';
UPDATE game_releases SET variants = 'v2.01, Greatest Hits' WHERE id = 'star-wars-battlefront-ii-playstation-2-ae403115';
UPDATE game_releases SET variants = 'v2.01, Platinum' WHERE id = 'crash-bandicoot-the-wrath-of-cortex-playstation-2-a884acbd';
UPDATE game_releases SET variants = 'v3.03, Platinum' WHERE id = 'eyetoy-play-2-playstation-2-8e9d4a3e';
UPDATE game_releases SET variants = 'v2.01, Platinum' WHERE id = 'spider-man-playstation-2-f89b9d3d';
UPDATE game_releases SET variants = 'Rev 1, Hudson the Best' WHERE id = 'bomberman-land-wii-cf7bb8e8';
UPDATE game_releases SET variants = 'Rev 1, Nintendo Selects' WHERE id = 'animal-crossing-city-folk-wii-90f2a29f';
UPDATE game_releases SET variants = 'Rev 1, Nintendo Selects' WHERE id = 'wii-sports-resort-wii-c6628cc4';
UPDATE game_releases SET variants = 'Rev 1, Player''s Choice' WHERE id = 'crash-bandicoot-the-wrath-of-cortex-nintendo-gamecube-4c383054';
UPDATE game_releases SET variants = 'Rev 1, Player''s Choice' WHERE id = 'luigi-s-mansion-nintendo-gamecube-9a75e03a';
UPDATE game_releases SET variants = 'Rev 2, Player''s Choice' WHERE id = 'mario-party-4-nintendo-gamecube-fad57787';
UPDATE game_releases SET variants = 'Rev 1, Xbox Classics' WHERE id = 'spider-man-nintendo-gamecube-cd46590a';
UPDATE game_releases SET variants = 'Rev 1, Platinum Hits' WHERE id = 'spider-man-nintendo-gamecube-f3fed5be';
UPDATE game_releases SET variants = 'Rev 1, Player''s Choice' WHERE id = 'star-fox-adventures-nintendo-gamecube-477bf336';
UPDATE game_releases SET variants = 'Rev 1, Xbox Classics' WHERE id = 'spider-man-xbox-65f62c88';
UPDATE game_releases SET variants = 'Rev 1, Xbox Classics' WHERE id = 'spider-man-xbox-b5f72a6f';
UPDATE game_releases SET variants = 'Rev 1, Platinum Hits' WHERE id = 'blinx-the-time-sweeper-xbox-bb4bd681';
UPDATE game_releases SET variants = 'Rev 1, Platinum Hits' WHERE id = 'spider-man-xbox-88e4b09c';
UPDATE game_releases SET variants = 'Rev 1, Platinum Hits' WHERE id = 'star-wars-battlefront-ii-xbox-282abbcb';
UPDATE game_releases SET variants = 'Rev 1, Platinum Hits' WHERE id = 'star-wars-knights-of-the-old-republic-xbox-90728b00';
UPDATE game_releases SET variants = 'Rev 2, Platinum Hits' WHERE id = 'halo-combat-evolved-xbox-013986d0';
UPDATE game_releases SET variants = 'v2.00, Greatest Hits' WHERE id = 'metal-gear-solid-peace-walker-playstation-portable-a3437f3f';
UPDATE game_releases SET variants = 'v1.03, PSP the Best' WHERE id = 'metal-gear-solid-peace-walker-playstation-portable-0f932bf0';
UPDATE game_releases SET variants = 'Rev 1, Greatest Hits' WHERE id = 'final-fantasy-anthology-playstation-1b46a9b0';
UPDATE game_releases SET variants = 'Rev 1, Greatest Hits' WHERE id = 'final-fantasy-anthology-playstation-c1c8570d';
UPDATE game_releases SET variants = 'Rev 1, Greatest Hits' WHERE id = 'final-fantasy-ix-playstation-6f8e0fd1';
UPDATE game_releases SET variants = 'Rev 1, Greatest Hits' WHERE id = 'final-fantasy-ix-playstation-8424476c';
UPDATE game_releases SET variants = 'Rev 1, Greatest Hits' WHERE id = 'final-fantasy-ix-playstation-dd427f07';
UPDATE game_releases SET variants = 'Rev 1, Greatest Hits' WHERE id = 'final-fantasy-ix-playstation-8801d057';
UPDATE game_releases SET variants = 'Rev 1, Greatest Hits' WHERE id = 'namco-museum-vol-1-playstation-b5c42f6c';
UPDATE game_releases SET variants = 'Rev 2, Greatest Hits' WHERE id = 'oddworld-abe-s-oddysee-playstation-90365815';
UPDATE game_releases SET variants = 'Rev 2, Greatest Hits' WHERE id = 'tomb-raider-playstation-a7802454';
UPDATE game_releases SET variants = 'Rev 3, Greatest Hits' WHERE id = 'tomb-raider-playstation-6a641d68';
UPDATE game_releases SET variants = 'Rev 4, Greatest Hits' WHERE id = 'tomb-raider-playstation-664bb81f';
UPDATE game_releases SET variants = 'Rev 5, Greatest Hits' WHERE id = 'tomb-raider-playstation-abaf8123';
UPDATE game_releases SET variants = 'Rev 1, Greatest Hits' WHERE id = 'tomb-raider-ii-playstation-a21023be';
UPDATE game_releases SET variants = 'Rev 2, Greatest Hits' WHERE id = 'tomb-raider-ii-playstation-5309414';
UPDATE game_releases SET variants = 'Rev 1, Greatest Hits' WHERE id = 'tomb-raider-iii-adventures-of-lara-croft-playstation-5bb81f5c';
UPDATE game_releases SET variants = 'Rev 6, Greatest Hits' WHERE id = 'tomb-raider-playstation-26f2cc26';
UPDATE game_releases SET variants = 'Rev 3, Greatest Hits' WHERE id = 'tomb-raider-ii-playstation-67d0f972';
UPDATE game_releases SET variants = 'Rev 2, Greatest Hits' WHERE id = 'tomb-raider-iii-adventures-of-lara-croft-playstation-5ae5398d';
UPDATE game_releases SET variants = 'Rev 1, EDC, Platinum' WHERE id = 'tomb-raider-iii-adventures-of-lara-croft-playstation-3dcd9116';
UPDATE game_releases SET variants = 'Rev 1, Platinum' WHERE id = 'tomb-raider-iii-adventures-of-lara-croft-playstation-78298d04';
UPDATE game_releases SET variants = 'Rev 1, PlayStation the Best' WHERE id = 'tales-of-destiny-playstation-75380219';
UPDATE game_releases SET variants = 'Rev 1, PlayStation the Best for Family' WHERE id = 'bomberman-world-playstation-d73cf20a';
UPDATE game_releases SET variants = 'PlayStation the Best, Rev 1, PSone Books' WHERE id = 'king-s-field-ii-playstation-f818c20a';
UPDATE game_releases SET variants = 'Rev 2, PSone Books, Konami the Best' WHERE id = 'silent-hill-playstation-e553a955';

-- 6. Populate Tier 3 also_released_as secondary edition provenance on shared Original + Budget/Box-Set disc masters
UPDATE game_releases SET also_released_as = 'Essentials' WHERE id IN ('rayman-origins-playstation-3-4587e810', 'rayman-origins-playstation-3-b7694386', 'assassin-s-creed-brotherhood-playstation-3-1cfef3df', 'dark-souls-playstation-3-a7f321c9', 'dishonored-definitive-edition-playstation-3-cfb150c5', 'dishonored-definitive-edition-playstation-3-379dee28', 'dishonored-definitive-edition-playstation-3-ca23a7dd', 'fallout-3-playstation-3-a9c03531', 'fallout-3-playstation-3-48eff846', 'far-cry-3-playstation-3-db4a3827', 'god-of-war-iii-playstation-3-e89319e4', 'grand-theft-auto-episodes-from-liberty-city-playstation-3-75b2af4d', 'infamous-2-playstation-3-34e24317', 'kingdom-hearts-hd-2-5-remix-playstation-3-fd21cad2', 'lego-batman-3-beyond-gotham-playstation-3-a099b5b6', 'lego-harry-potter-years-5-7-playstation-3-ba30969a', 'lego-harry-potter-years-5-7-playstation-3-941f67b9', 'lego-indiana-jones-2-the-adventure-continues-playstation-3-b211324a', 'lego-indiana-jones-the-original-adventures-playstation-3-6d70de48', 'lego-marvel-super-heroes-playstation-3-1c9f1737', 'lego-pirates-of-the-caribbean-the-video-game-playstation-3-105f114f', 'lego-pirates-of-the-caribbean-the-video-game-playstation-3-b7dc7137', 'lego-star-wars-iii-the-clone-wars-playstation-3-969d9b07', 'lego-star-wars-the-complete-saga-playstation-3-99bf8951', 'lego-the-lord-of-the-rings-playstation-3-f6f4ad58', 'mortal-kombat-vs-dc-universe-playstation-3-df37efd4', 'ni-no-kuni-wrath-of-the-white-witch-playstation-3-d4087389', 'portal-2-playstation-3-fbc620f5', 'rayman-legends-playstation-3-0dc1a36a', 'rayman-legends-playstation-3-22850394', 'red-dead-redemption-game-of-the-year-edition-playstation-3-e54eb843', 'resident-evil-5-gold-edition-playstation-3-c76f28fb', 'resistance-3-playstation-3-815a362c', 'sonic-sega-all-stars-racing-playstation-3-f19bb918', 'star-wars-the-force-unleashed-ii-playstation-3-f172d3e5', 'tomb-raider-underworld-playstation-3-7238af2c', 'lego-batman-2-dc-super-heroes-playstation-3-4c62754c', 'littlebigplanet-playstation-3-8df6da9a', 'littlebigplanet-karting-playstation-3-e669d56f', 'sports-champions-playstation-3-78c6e92f', 'sports-champions-2-playstation-3-b64224af', 'prince-of-persia-the-forgotten-sands-playstation-3-e32a3129', 'prince-of-persia-the-forgotten-sands-playstation-3-88a1f995');
UPDATE game_releases SET also_released_as = 'Essentials, Bundled Software' WHERE id IN ('assassin-s-creed-iii-playstation-3-f9589161', 'assassin-s-creed-iii-playstation-3-43eae9e3');
UPDATE game_releases SET also_released_as = 'Essentials, Special Edition' WHERE id IN ('assassin-s-creed-iv-black-flag-playstation-3-212281a7', 'assassin-s-creed-iv-black-flag-playstation-3-3626d118', 'assassin-s-creed-iv-black-flag-playstation-3-04de3244', 'resistance-3-playstation-3-aac579d9', 'uncharted-3-drake-s-deception-playstation-3-6e136b47');
UPDATE game_releases SET also_released_as = 'Essentials, Special''noe izdanie' WHERE id IN ('driver-san-francisco-playstation-3-7e5e6fe5', 'driver-san-francisco-playstation-3-81ada49a');
UPDATE game_releases SET also_released_as = 'EA Best Hits' WHERE id IN ('crysis-3-playstation-3-a050e302', 'star-wars-battlefront-playstation-2-bbc14ab6', 'star-wars-starfighter-playstation-2-66696f22');
UPDATE game_releases SET also_released_as = 'Essentials, Classics HD: Essentials, God of War: Complete Collection' WHERE id IN ('god-of-war-collection-playstation-3-0149d765');
UPDATE game_releases SET also_released_as = 'Essentials, Collector''s Edition' WHERE id IN ('batman-arkham-city-playstation-3-e47a9b55', 'sonic-generations-playstation-3-52a3335f', 'devil-may-cry-4-playstation-3-e518febc');
UPDATE game_releases SET also_released_as = 'Essentials, Game of the Year Edition' WHERE id IN ('tomb-raider-playstation-3-b1b77743', 'tomb-raider-playstation-3-5fe8bcec');
UPDATE game_releases SET also_released_as = 'Essentials, Limited Edition' WHERE id IN ('deus-ex-human-revolution-playstation-3-43458b18', 'final-fantasy-x-x-2-hd-remaster-playstation-3-8eaba5d3', 'kingdom-hearts-hd-1-5-remix-playstation-3-7aa84a6a', 'sonic-all-stars-racing-transformed-playstation-3-50bb098a');
UPDATE game_releases SET also_released_as = 'Essentials, Platinum: The Best of PlayStation 3' WHERE id IN ('assassin-s-creed-playstation-3-1c19e745', 'heavy-rain-playstation-3-3fd4356f', 'heavy-rain-playstation-3-d655f16e', 'heavy-rain-playstation-3-cce8b555', 'resistance-fall-of-man-playstation-3-c81767c9', 'assassin-s-creed-playstation-3-454dbbcb', 'assassin-s-creed-playstation-3-2126eea1', 'far-cry-2-playstation-3-65d8f66d', 'far-cry-2-playstation-3-fbffe49a', 'uncharted-drake-s-fortune-playstation-3-cc9ec754');
UPDATE game_releases SET also_released_as = 'Essentials, Platinum: The Best of PlayStation 3, Special Edition' WHERE id IN ('assassin-s-creed-revelations-playstation-3-e145d84f', 'assassin-s-creed-revelations-playstation-3-9.826e+95', 'assassin-s-creed-revelations-playstation-3-af6c9714', 'assassin-s-creed-revelations-playstation-3-601dc701');
UPDATE game_releases SET also_released_as = 'Essentials, Platinum: The Best of PlayStation 3, Limited Collector''s Edition' WHERE id IN ('final-fantasy-xiii-playstation-3-33710');
UPDATE game_releases SET also_released_as = 'Essentials, Platinum: The Best of PlayStation 3, Limited Edition Collector''s Box' WHERE id IN ('uncharted-2-among-thieves-playstation-3-d46de010', 'uncharted-2-among-thieves-playstation-3-24d8cfe5', 'littlebigplanet-2-playstation-3-e4f7de21');
UPDATE game_releases SET also_released_as = 'Essentials, Platinum: The Best of PlayStation 3, God of War: Complete Collection' WHERE id IN ('god-of-war-iii-playstation-3-450a6655');
UPDATE game_releases SET also_released_as = 'Essentials, Platinum: The Best of PlayStation 3, Limited Edition Collector''s Box, Killzone Trilogy' WHERE id IN ('killzone-2-playstation-3-d8726664');
UPDATE game_releases SET also_released_as = 'Essentials, Platinum: The Best of PlayStation 3, Review Code' WHERE id IN ('heavenly-sword-playstation-3-7b040ffe');
UPDATE game_releases SET also_released_as = 'Mass Effect Trilogy' WHERE id IN ('mass-effect-3-playstation-3-ff847606', 'mass-effect-2-xbox-360-721a2fe8', 'mass-effect-2-xbox-360-5929ffb4', 'mass-effect-2-playstation-3-2fa6821f', 'mass-effect-2-playstation-3-15dd8584', 'mass-effect-3-playstation-3-52e7e724', 'mass-effect-3-xbox-360-20b2108a', 'mass-effect-3-xbox-360-ec4d6981');
UPDATE game_releases SET also_released_as = 'Essentials, Steelbook' WHERE id IN ('resident-evil-6-playstation-3-6cfd5ee6');
UPDATE game_releases SET also_released_as = 'Greatest Hits' WHERE id IN ('assassin-s-creed-playstation-3-132058d5', 'assassin-s-creed-ii-playstation-3-5a66dd73', 'assassin-s-creed-revelations-playstation-3-e9a617e1', 'bioshock-2-playstation-3-99d1f612', 'borderlands-playstation-3-6ac8fe09', 'dark-souls-ii-scholar-of-the-first-sin-playstation-3-8fe144fc', 'darksiders-playstation-3-4df11bfc', 'dead-rising-2-playstation-3-e1401069', 'dead-space-playstation-3-80c634cc', 'dead-space-2-playstation-3-0db09625', 'devil-may-cry-4-playstation-3-b8b37739', 'dishonored-playstation-3-95b53cb6', 'dishonored-definitive-edition-playstation-3-5e6333b8', 'final-fantasy-xiii-playstation-3-bf883f4e', 'god-of-war-collection-playstation-3-fb2dc4df', 'grand-theft-auto-episodes-from-liberty-city-playstation-3-53dbe74f', 'kingdom-hearts-hd-2-5-remix-playstation-3-18f3ddd3', 'lego-batman-2-dc-super-heroes-playstation-3-81d1c9c5', 'lego-batman-3-beyond-gotham-playstation-3-8d748562', 'lego-indiana-jones-2-the-adventure-continues-playstation-3-d54fbfee', 'lego-indiana-jones-the-original-adventures-playstation-3-cee03ab5', 'lego-marvel-super-heroes-playstation-3-8afbfdb9', 'lego-star-wars-iii-the-clone-wars-playstation-3-7ae73e5b', 'lego-star-wars-the-complete-saga-playstation-3-992155c4', 'lego-the-lord-of-the-rings-playstation-3-be797c5e', 'littlebigplanet-game-of-the-year-edition-playstation-3-7777508c', 'mortal-kombat-vs-dc-universe-playstation-3-ea54814d', 'ratchet-clank-future-a-crack-in-time-playstation-3-8cd4d045', 'red-dead-redemption-game-of-the-year-edition-playstation-3-4f11d75f', 'sonic-generations-playstation-3-814a5f03', 'sonic-s-ultimate-genesis-collection-playstation-3-cb47cf69', 'star-wars-the-force-unleashed-playstation-3-2fd483aa', 'star-wars-the-force-unleashed-ii-playstation-3-8cc91ff6', 'watch-dogs-playstation-3-fd878473', 'dark-cloud-playstation-2-fe4adb70', 'dirge-of-cerberus-final-fantasy-vii-playstation-2-5ab0e4ab', 'fantastic-4-playstation-2-bc1fd886', 'final-fantasy-x-playstation-2-9ad80720', 'final-fantasy-x-2-playstation-2-874b3062', 'god-of-war-playstation-2-5876350000', 'god-of-war-ii-playstation-2-e271930d', 'jak-3-playstation-2-a13baf4e', 'jak-and-daxter-the-precursor-legacy-playstation-2-d2fe8c79', 'jak-and-daxter-the-precursor-legacy-playstation-2-0f9d19af', 'killzone-playstation-2-c15a46ee', 'kingdom-hearts-playstation-2-d231ed24', 'kingdom-hearts-ii-playstation-2-480fff02', 'kingdom-hearts-re-chain-of-memories-playstation-2-5b63fffb', 'lego-indiana-jones-the-original-adventures-playstation-2-8046ae6b', 'lego-star-wars-ii-the-original-trilogy-playstation-2-b05f93ad');
UPDATE game_releases SET also_released_as = 'Greatest Hits' WHERE id IN ('max-payne-playstation-2-67276680', 'metal-gear-solid-2-sons-of-liberty-playstation-2-576e3d2c', 'namco-museum-playstation-2-13cdaff3', 'onimusha-warlords-playstation-2-f8ff73be', 'prince-of-persia-the-sands-of-time-playstation-2-d9e52d16', 'prince-of-persia-the-two-thrones-playstation-2-7b53e8cb', 'ratchet-clank-playstation-2-960318d0', 'ratchet-deadlocked-playstation-2-66eb35f4', 'red-dead-revolver-playstation-2-adb54266', 'shadow-of-the-colossus-playstation-2-2ed81371', 'shadow-the-hedgehog-playstation-2-9aaef11d', 'sly-2-band-of-thieves-playstation-2-32dc7bc5', 'sly-3-honor-among-thieves-playstation-2-0a9386cf', 'sly-cooper-and-the-thievius-raccoonus-playstation-2-046bbcec', 'sonic-heroes-playstation-2-62ba7ff1', 'sonic-mega-collection-plus-playstation-2-cd10bf95', 'sonic-riders-playstation-2-9a74eb18', 'spider-man-2-playstation-2-b402c582', 'spyro-enter-the-dragonfly-playstation-2-d05c1e82', 'star-wars-battlefront-playstation-2-12a56268', 'star-wars-bounty-hunter-playstation-2-c3b176b2', 'star-wars-episode-iii-revenge-of-the-sith-playstation-2-0aaf301d', 'star-wars-the-force-unleashed-playstation-2-d26ed695', 'x-men-legends-playstation-2-8b289a67', 'castlevania-the-dracula-x-chronicles-playstation-portable-26316f37', 'crisis-core-final-fantasy-vii-playstation-portable-4c7e2442', 'final-fantasy-tactics-the-war-of-the-lions-playstation-portable-0d6a3d9f', 'grand-theft-auto-liberty-city-stories-playstation-portable-b78703cc', 'grand-theft-auto-vice-city-stories-playstation-portable-f705a610', 'lego-batman-the-videogame-playstation-portable-b0e191b3', 'lego-indiana-jones-the-original-adventures-playstation-portable-c4059a1e', 'lego-star-wars-ii-the-original-trilogy-playstation-portable-ab24aaf4', 'marvel-ultimate-alliance-playstation-portable-4bec498d', 'sonic-rivals-playstation-portable-a7556f70', 'star-wars-battlefront-ii-playstation-portable-65017578', 'star-wars-battlefront-renegade-squadron-playstation-portable-f050b8f7', 'star-wars-the-force-unleashed-playstation-portable-8f1ef50e', 'ape-escape-playstation-8e306ae4', 'castlevania-symphony-of-the-night-playstation-8b07c1cc', 'chrono-cross-playstation-a30b6a07', 'chrono-cross-playstation-a2564cd6', 'crash-bandicoot-playstation-7420271e', 'crash-bandicoot-2-cortex-strikes-back-playstation-70106695', 'croc-legend-of-the-gobbos-playstation-7a934eb1', 'doom-playstation-6309650', 'final-fantasy-chronicles-playstation-bf7ca046', 'final-fantasy-ix-playstation-905a4c0c', 'final-fantasy-ix-playstation-91076add', 'final-fantasy-ix-playstation-271c8aad', 'final-fantasy-ix-playstation-93bd277f');
UPDATE game_releases SET also_released_as = 'Greatest Hits' WHERE id IN ('final-fantasy-origins-playstation-79a2853a', 'final-fantasy-tactics-playstation-b347a10b', 'final-fantasy-vii-playstation-07a7324d', 'final-fantasy-vii-playstation-06fa149c', 'final-fantasy-vii-playstation-b0e1f4ec', 'final-fantasy-viii-playstation-0ae78843', 'final-fantasy-viii-playstation-0bbaae92', 'final-fantasy-viii-playstation-bda14ee2', 'final-fantasy-viii-playstation-0900e330', 'mega-man-legends-playstation-9e88194d', 'mega-man-x4-playstation-46f5d659', 'namco-museum-vol-1-playstation-3eddc5af', 'namco-museum-vol-3-playstation-cb173e1f', 'oddworld-abe-s-oddysee-playstation-916b7ec4', 'pac-man-world-playstation-5960e3dc', 'rayman-playstation-7d2ed939', 'rayman-playstation-cfbfd80b', 'resident-evil-2-dual-shock-ver-playstation-93a8f1ce', 'resident-evil-2-dual-shock-ver-playstation-75047a55', 'resident-evil-3-nemesis-playstation-c02eab3a', 'silent-hill-playstation-11b5eb7b', 'silent-hill-playstation-1c72b17e', 'spider-man-playstation-5b840d78', 'spider-man-2-enter-electro-playstation-31dd0943', 'star-wars-dark-forces-playstation-ba73d6e7', 'star-wars-episode-i-jedi-power-battles-playstation-27610b57', 'star-wars-episode-i-the-phantom-menace-playstation-36698331', 'star-wars-rebel-assault-ii-the-hidden-empire-playstation-7ec2acce', 'star-wars-rebel-assault-ii-the-hidden-empire-playstation-7f9f8a1f', 'tetris-plus-playstation-cd18c97a', 'tomb-raider-ii-playstation-3bb0d87d', 'tomb-raider-the-last-revelation-playstation-380f97e4', 'vagrant-story-playstation-4938b87b', 'warhawk-playstation-b0c86d74', 'x-men-mutant-academy-playstation-78abd8bb', 'x-men-mutant-academy-playstation-8ba8896b', 'xenogears-playstation-866e2dbb', 'xenogears-playstation-87330b6a', 'fallout-3-playstation-3-618250cd', 'fallout-3-playstation-3-0de247ea', 'fallout-3-playstation-3-49434a12', 'star-wars-starfighter-playstation-2-9ebeadad', 'god-of-war-iii-playstation-3-d44f7b66', 'metal-gear-solid-4-guns-of-the-patriots-playstation-3-077dc66c');
UPDATE game_releases SET also_released_as = 'Greatest Hits, Collector''s Edition' WHERE id IN ('ninja-gaiden-sigma-playstation-3-7b7e2582', 'resident-evil-5-playstation-3-5572cc9e', 'final-fantasy-xii-playstation-2-bea84100', 'crash-team-racing-playstation-c358fba2');
UPDATE game_releases SET also_released_as = 'Greatest Hits, Collector''s Edition, Resistance Collection' WHERE id IN ('resistance-2-playstation-3-fc72307d');
UPDATE game_releases SET also_released_as = 'Greatest Hits, Combo Pack' WHERE id IN ('lego-harry-potter-years-1-4-playstation-3-fb7d78c8');
UPDATE game_releases SET also_released_as = 'Greatest Hits, Deluxe Edition' WHERE id IN ('demon-s-souls-playstation-3-eb51fbeb');
UPDATE game_releases SET also_released_as = 'Greatest Hits, Game of the Year Edition' WHERE id IN ('tomb-raider-playstation-3-b265f276');
UPDATE game_releases SET also_released_as = 'Greatest Hits, Greatest Hits (Bundled with PlayStation 3), Uncharted Dual Pack' WHERE id IN ('uncharted-drake-s-fortune-playstation-3-9eabb745');
UPDATE game_releases SET also_released_as = 'Greatest Hits, Limited Edition' WHERE id IN ('dark-souls-playstation-3-928348b2', 'kingdom-hearts-hd-1-5-remix-playstation-3-a56b8657');
UPDATE game_releases SET also_released_as = 'Greatest Hits, Limited Edition, PS3 System Bundle' WHERE id IN ('metal-gear-solid-4-guns-of-the-patriots-playstation-3-3ead034f');
UPDATE game_releases SET also_released_as = 'Greatest Hits, PlayStation 3 the Best, Collector''s Edition (GameStop)' WHERE id IN ('assassin-s-creed-brotherhood-playstation-3-e12bd166');
UPDATE game_releases SET also_released_as = 'Greatest Hits, PlayStation 3 the Best, Limited Edition' WHERE id IN ('prince-of-persia-playstation-3-1bb7fb2a');
UPDATE game_releases SET also_released_as = 'Greatest Hits, PS3 Console Bundle' WHERE id IN ('infamous-playstation-3-62a1db29');
UPDATE game_releases SET also_released_as = 'Greatest Hits, Resident Evil 6 Anthology' WHERE id IN ('resident-evil-6-playstation-3-8ae152fc');
UPDATE game_releases SET also_released_as = 'Greatest Hits, Resistance Collection' WHERE id IN ('resistance-fall-of-man-playstation-3-fcad0730');
UPDATE game_releases SET also_released_as = 'Platinum' WHERE id IN ('star-wars-the-force-unleashed-playstation-3-cd456b20', 'final-fantasy-x-2-playstation-2-7333408d', 'final-fantasy-x-2-playstation-2-70fcdd97', 'final-fantasy-x-2-playstation-2-2d30d6d7', 'grand-theft-auto-iii-playstation-2-11d25d47', 'grand-theft-auto-san-andreas-playstation-2-21846100000', 'grand-theft-auto-vice-city-playstation-2-91ffcc79', 'grand-theft-auto-vice-city-playstation-2-31db9dfe', 'grand-theft-auto-vice-city-stories-playstation-2-456b2d6d', 'jak-and-daxter-the-precursor-legacy-playstation-2-e7c6e94b', 'jak-x-combat-racing-playstation-2-f3ea9121', 'kingdom-hearts-ii-playstation-2-8c8b05d1', 'tomb-raider-the-angel-of-darkness-playstation-2-440c94fc', 'max-payne-playstation-2-c49c786a', 'max-payne-playstation-2-c6352275', 'max-payne-2-the-fall-of-max-payne-playstation-2-893b28c2', 'max-payne-2-the-fall-of-max-payne-playstation-2-3a0b677d', 'onimusha-warlords-playstation-2-dfe6b569', 'ratchet-clank-playstation-2-e417c4b2', 'rayman-raving-rabbids-playstation-2-69a9e131', 'resident-evil-outbreak-playstation-2-6ce5e8c5', 'shadow-the-hedgehog-playstation-2-8be50ae9', 'spider-man-2-playstation-2-67539f9b', 'spyro-a-hero-s-tail-playstation-2-91b80e25', 'spyro-enter-the-dragonfly-playstation-2-6c3aafd5', 'star-wars-battlefront-playstation-2-d7c5e038', 'star-wars-starfighter-playstation-2-f47ad799', 'tom-clancy-s-splinter-cell-playstation-2-4c33ad25', 'tom-clancy-s-splinter-cell-chaos-theory-playstation-2-a852e636', 'eyetoy-groove-playstation-2-cd16ce5a', 'final-fantasy-x-playstation-2-0391ee03', 'crash-bandicoot-playstation-c3cadfa3', 'crash-bash-playstation-f37592f3', 'crash-team-racing-playstation-44a2ba2d', 'crash-team-racing-playstation-19468cb0', 'doom-playstation-bd64fd7c', 'doom-playstation-aa23f6c3', 'doom-playstation-30ff911b', 'final-fantasy-ix-playstation-f0f30ff9', 'final-fantasy-ix-playstation-f1ae2928', 'final-fantasy-ix-playstation-47b5c958', 'final-fantasy-ix-playstation-f314648a', 'final-fantasy-ix-playstation-422234c3', 'final-fantasy-ix-playstation-437f1212', 'final-fantasy-ix-playstation-f564f262', 'final-fantasy-ix-playstation-41c55fb0', 'final-fantasy-ix-playstation-4cd2dde8', 'final-fantasy-ix-playstation-4d8ffb39', 'final-fantasy-ix-playstation-fb941b49', 'final-fantasy-ix-playstation-4f35b69b');
UPDATE game_releases SET also_released_as = 'Platinum' WHERE id IN ('final-fantasy-ix-playstation-9756ec3d', 'final-fantasy-ix-playstation-960bcaec', 'final-fantasy-ix-playstation-20102a9c', 'final-fantasy-ix-playstation-94b1874e', 'final-fantasy-ix-playstation-0b1c518b', 'final-fantasy-ix-playstation-0a41775a', 'final-fantasy-ix-playstation-bc5a972a', 'final-fantasy-ix-playstation-08fb3af8', 'final-fantasy-vii-playstation-c64eedb0', 'final-fantasy-vii-playstation-c713cb61', 'final-fantasy-vii-playstation-71082b11', 'final-fantasy-vii-playstation-749fd68a', 'final-fantasy-vii-playstation-75c2f05b', 'final-fantasy-vii-playstation-c3d9102b', 'final-fantasy-vii-playstation-43e4993e', 'final-fantasy-vii-playstation-42b9bfef', 'final-fantasy-vii-playstation-f4a25f9f', 'final-fantasy-viii-playstation-57ad2286', 'final-fantasy-viii-playstation-56f00457', 'final-fantasy-viii-playstation-e0ebe427', 'final-fantasy-viii-playstation-544a49f5', 'final-fantasy-viii-playstation-e53aa673', 'final-fantasy-viii-playstation-e46780a2', 'final-fantasy-viii-playstation-527c60d2', 'final-fantasy-viii-playstation-e6ddcd00', 'grand-theft-auto-playstation-646517a2', 'grand-theft-auto-playstation-894cb86d', 'metal-gear-solid-playstation-18927a1c', 'metal-gear-solid-playstation-19cf5ccd', 'oddworld-abe-s-exoddus-playstation-865cdeb9', 'oddworld-abe-s-exoddus-playstation-8701f868', 'oddworld-abe-s-exoddus-playstation-e4c63c7d', 'oddworld-abe-s-exoddus-playstation-e59b1aac', 'resident-evil-playstation-064e6957', 'resident-evil-playstation-921d00b0', 'resident-evil-2-playstation-3bfbb9b9', 'resident-evil-2-playstation-6e1ba215', 'resident-evil-2-playstation-f4b5f8f8', 'resident-evil-2-playstation-4e62120f', 'silent-hill-playstation-2cd3daf1', 'spider-man-playstation-173345dc', 'spider-man-2-enter-electro-playstation-7efa809a', 'spyro-year-of-the-dragon-playstation-f9667a67', 'star-wars-rebel-assault-ii-the-hidden-empire-playstation-7ad6436b', 'star-wars-rebel-assault-ii-the-hidden-empire-playstation-7b8b65ba', 'tomb-raider-playstation-2fb83265', 'tomb-raider-playstation-502c9f28', 'tomb-raider-playstation-a150ff4b', 'tomb-raider-ii-playstation-bbb0d387', 'tomb-raider-ii-playstation-22bcefdb');
UPDATE game_releases SET also_released_as = 'Platinum' WHERE id IN ('tomb-raider-ii-playstation-77e511b9', 'tomb-raider-iii-adventures-of-lara-croft-playstation-751f23d4', 'tomb-raider-iii-adventures-of-lara-croft-playstation-69f72d9c', 'spider-man-2-enter-electro-playstation-5f3157dd', 'spyro-the-dragon-playstation-d3012652', 'kingdom-hearts-playstation-2-10cedd41', 'max-payne-2-the-fall-of-max-payne-playstation-2-9138dbf7', 'spider-man-playstation-2-a9aa7257', 'spider-man-playstation-2-004e9861', 'kingdom-hearts-playstation-2-8a48f004', 'ape-escape-playstation-57dfb143', 'oddworld-abe-s-oddysee-playstation-4f382c22', 'spider-man-playstation-313bf4d9', 'spider-man-playstation-251f1640', 'spider-man-playstation-785be798', 'tomb-raider-chronicles-playstation-3afddb43');
UPDATE game_releases SET also_released_as = 'Platinum: The Best of PlayStation 3' WHERE id IN ('batman-arkham-asylum-playstation-3-a610dabe', 'dead-space-2-playstation-3-89df0e24', 'dead-space-2-playstation-3-f5e0ff15', 'grand-theft-auto-iv-playstation-3-016113c2', 'prototype-playstation-3-b79ad2ac', 'uncharted-2-among-thieves-playstation-3-f69d645a', 'metal-gear-solid-4-guns-of-the-patriots-playstation-3-709fffc8', 'ratchet-clank-all-4-one-playstation-3-c91329ce', 'assassin-s-creed-playstation-3-e79f2d68', 'assassin-s-creed-ii-playstation-3-203e9db0');
UPDATE game_releases SET also_released_as = 'Platinum: The Best of PlayStation 3, Game of the Year Edition' WHERE id IN ('borderlands-playstation-3-dc27f34c');
UPDATE game_releases SET also_released_as = 'Platinum: The Best of PlayStation 3, Special Edition' WHERE id IN ('infamous-playstation-3-b9335b80', 'infamous-2-playstation-3-4c298e55');
UPDATE game_releases SET also_released_as = 'Platinum: The Best of PlayStation 3, Steelbook' WHERE id IN ('resident-evil-5-playstation-3-c20f937a');
UPDATE game_releases SET also_released_as = 'PlayStation 3 the Best' WHERE id IN ('assassin-s-creed-playstation-3-e044e16f', 'assassin-s-creed-iii-playstation-3-62e373f0', 'dead-rising-2-playstation-3-cb633efa', 'demon-s-souls-playstation-3-fd0cb346', 'demon-s-souls-playstation-3-61188292', 'dragon-age-origins-playstation-3-ed05c472', 'driver-san-francisco-playstation-3-f0b8a9e2', 'fallout-3-playstation-3-fccc2d41', 'god-of-war-iii-playstation-3-f63b9414', 'grand-theft-auto-iv-playstation-3-360f431e', 'infamous-2-playstation-3-63fb6dbc', 'killzone-2-playstation-3-dab1d5e8', 'littlebigplanet-2-playstation-3-2fcdd489', 'metal-gear-solid-4-guns-of-the-patriots-playstation-3-6e5b5da9', 'resistance-2-playstation-3-acce29db', 'resistance-fall-of-man-playstation-3-38c04d78', 'fallout-3-playstation-3-e566e13e', 'metal-gear-solid-4-guns-of-the-patriots-playstation-3-66d466e1');
UPDATE game_releases SET also_released_as = 'PlayStation 3 the Best, BigHit Series, Dual Pack' WHERE id IN ('uncharted-drake-s-fortune-playstation-3-1b3a8747');
UPDATE game_releases SET also_released_as = 'PlayStation 3 the Best, Bundled with DualShock 3, Bundled with PlayStation 3: Dream Box' WHERE id IN ('littlebigplanet-playstation-3-9e95112f');
UPDATE game_releases SET also_released_as = 'PlayStation 3 the Best, Bundled with PlayStation 3: X Edition' WHERE id IN ('tales-of-xillia-playstation-3-ab813e06');
UPDATE game_releases SET also_released_as = 'PlayStation 3 the Best, God of War Trilogy' WHERE id IN ('god-of-war-iii-playstation-3-15cd10b0');
UPDATE game_releases SET also_released_as = 'PlayStation 3 the Best, PlayStation 3 the Best (Reprint)' WHERE id IN ('devil-may-cry-4-playstation-3-4d7a70e4', 'kami-hd-playstation-3-c0aa826e', 'ratchet-clank-future-a-crack-in-time-playstation-3-f8db1bd8');
UPDATE game_releases SET also_released_as = 'PlayStation 3 the Best, Shokai Seisanban, Premium Pack (Bundled with PlayStation 3)' WHERE id IN ('metal-gear-solid-4-guns-of-the-patriots-playstation-3-e24aba77');
UPDATE game_releases SET also_released_as = 'Spike the Best' WHERE id IN ('bioshock-playstation-3-113ffb11', 'bioshock-playstation-3-300cb4a5', 'tomb-raider-legend-playstation-2-66226686', 'tomb-raider-anniversary-playstation-portable-55ee2c4d');
UPDATE game_releases SET also_released_as = 'Ubi the Best' WHERE id IN ('assassin-s-creed-iv-black-flag-playstation-3-6387046f', 'assassin-s-creed-playstation-3-c8c8995e', 'assassin-s-creed-rogue-playstation-3-98c8220b', 'far-cry-3-playstation-3-b86e82b7', 'far-cry-4-playstation-3-5e4d7db9', 'assassin-s-creed-bloodlines-playstation-portable-f4ed0a50');
UPDATE game_releases SET also_released_as = 'Xbox Classics, Hunter Edition' WHERE id IN ('crysis-3-xbox-360-6794029b');
UPDATE game_releases SET also_released_as = 'Xbox Classics, Limited Edition' WHERE id IN ('crysis-2-xbox-360-d69b944b', 'crysis-2-xbox-360-cbd6d49f', 'perfect-dark-zero-xbox-360-57a5b16e');
UPDATE game_releases SET also_released_as = 'Xbox Classics, Steelbook' WHERE id IN ('bioshock-xbox-360-402a6b7f');
UPDATE game_releases SET also_released_as = 'Démo "Périlleuse Escalade", Xbox Classics' WHERE id IN ('call-of-duty-modern-warfare-2-xbox-360-158402fb');
UPDATE game_releases SET also_released_as = 'Xbox Classics' WHERE id IN ('assassin-s-creed-rogue-xbox-360-321a1b0c', 'call-of-duty-modern-warfare-2-xbox-360-e8229d6c', 'crackdown-xbox-360-178541d8', 'dead-rising-xbox-360-fb4506ed', 'grand-theft-auto-iv-xbox-360-7e0fc6bf', 'halo-wars-xbox-360-81f892e4', 'lego-harry-potter-years-5-7-xbox-360-eaef3297', 'lego-harry-potter-years-5-7-xbox-360-29e04121', 'lego-pirates-of-the-caribbean-the-video-game-xbox-360-ea96f33d', 'mass-effect-xbox-360-c6d25c67', 'mass-effect-xbox-360-f3b36f4e', 'mass-effect-xbox-360-bcfaa18e', 'perfect-dark-zero-xbox-360-9c21ca1c', 'perfect-dark-zero-xbox-360-be6db04c', 'sonic-sega-all-stars-racing-with-banjo-kazooie-xbox-360-2df57670', 'tomb-raider-underworld-xbox-360-c9fcaa66', 'tom-clancy-s-splinter-cell-xbox-47a074f9', 'crash-bandicoot-the-wrath-of-cortex-xbox-e86ebeb8', 'halo-2-xbox-09f4e966', 'lego-star-wars-the-video-game-xbox-1fe5826f', 'oddworld-munch-s-oddysee-xbox-9a70573e', 'prince-of-persia-warrior-within-xbox-25fcd6bf', 'sonic-heroes-xbox-3caa261a', 'sonic-mega-collection-plus-xbox-eefc442c', 'star-wars-knights-of-the-old-republic-xbox-bf694156', 'assassin-s-creed-xbox-360-89c1f935', 'assassin-s-creed-ii-xbox-360-2cce3dd2', 'assassin-s-creed-brotherhood-xbox-360-d49b1955', 'call-of-duty-4-modern-warfare-xbox-360-55701cb1', 'call-of-duty-modern-warfare-2-xbox-360-28b2b75f', 'dead-space-2-xbox-360-4a58b541', 'dead-space-2-xbox-360-160eb327', 'dead-space-2-xbox-360-3325087d', 'dead-space-2-xbox-360-2da749a0', 'dishonored-definitive-edition-xbox-360-8a0dd17a', 'dishonored-definitive-edition-xbox-360-5d78df5f', 'dishonored-definitive-edition-xbox-360-7bcdd126', 'halo-wars-xbox-360-71553826', 'mass-effect-xbox-360-7e29f2b1', 'rayman-legends-xbox-360-8e469f4c', 'ninja-gaiden-black-xbox-d9ab0cb0', 'spider-man-2-xbox-0d0c5557', 'grand-theft-auto-san-andreas-xbox-5ec3253b', 'assassin-s-creed-ii-xbox-360-e91e7289', 'assassin-s-creed-ii-xbox-360-62d6de69');
UPDATE game_releases SET also_released_as = 'Xbox Classics, Augmented Edition, Nordic Edition, Ultimate Stealth Triple Pack' WHERE id IN ('deus-ex-human-revolution-xbox-360-0f6a65a0');
UPDATE game_releases SET also_released_as = 'Xbox Classics, Bioware Signature Edition' WHERE id IN ('dragon-age-ii-xbox-360-d79f0f19');
UPDATE game_releases SET also_released_as = 'Xbox Classics, Bundle Copy' WHERE id IN ('halo-3-xbox-360-a4ff7257');
UPDATE game_releases SET also_released_as = 'Xbox Classics, Bundled with Marvel Animation 2013 Bonus Disc' WHERE id IN ('lego-marvel-super-heroes-xbox-360-0383bacf');
UPDATE game_releases SET also_released_as = 'Xbox Classics, Classics (Reprint)' WHERE id IN ('lego-pirates-of-the-caribbean-the-video-game-xbox-360-f67e94b9');
UPDATE game_releases SET also_released_as = 'Xbox Classics, Classics: Best Sellers, Grand Theft Auto IV & Episodes from Liberty City: The Complete Edition' WHERE id IN ('grand-theft-auto-iv-xbox-360-1ef875e2');
UPDATE game_releases SET also_released_as = 'Xbox Classics, Family Hits' WHERE id IN ('lego-star-wars-ii-the-original-trilogy-xbox-360-705a6724');
UPDATE game_releases SET also_released_as = 'Platinum Hits, Xbox Classics, Far Cry Compilation' WHERE id IN ('far-cry-3-xbox-360-1ac27c21', 'far-cry-2-xbox-360-d8ae3c58');
UPDATE game_releases SET also_released_as = 'Xbox Classics, Game of the Year Edition' WHERE id IN ('call-of-duty-2-xbox-360-89b01407');
UPDATE game_releases SET also_released_as = 'Xbox Classics, Game of the Year Edition, Game of the Year Edition (Classics), Borderlands Triple Pack' WHERE id IN ('borderlands-xbox-360-0a6a1c3f');
UPDATE game_releases SET also_released_as = 'Xbox Classics, Legendary Edition, Bundled with Xbox 360, Bundled with Fable II: Game of the Year Edition, Bundled with Project Gotham Racing 4, Bundled with Halo 3: ODST' WHERE id IN ('halo-3-xbox-360-c2e8cda5');
UPDATE game_releases SET also_released_as = 'Xbox Classics, Limited Edition, Game of the Year Edition' WHERE id IN ('gears-of-war-2-xbox-360-7f3ef73c');
UPDATE game_releases SET also_released_as = 'Xbox Classics, Platinum Hits' WHERE id IN ('lego-star-wars-iii-the-clone-wars-xbox-360-c18fbe12', 'portal-2-xbox-360-ae6ac468', 'star-wars-battlefront-xbox-8b8eb779');
UPDATE game_releases SET also_released_as = 'Xbox Classics, Platinum Hits, Assassin''s Creed: Heritage Collection' WHERE id IN ('assassin-s-creed-xbox-360-f3acd0e7');
UPDATE game_releases SET also_released_as = 'Xbox Classics, Platinum Hits, Bundle Copy, Gears of War Triple Pack' WHERE id IN ('gears-of-war-xbox-360-cfcf98d5');
UPDATE game_releases SET also_released_as = 'Xbox Classics, Platinum Hits, Call of Duty: Modern Warfare Collection, Call of Duty: Modern Warfare Trilogy, Game of the Year Edition, Plays on Xbox One (Greatest Hits)' WHERE id IN ('call-of-duty-4-modern-warfare-xbox-360-47abcac5');
UPDATE game_releases SET also_released_as = 'Xbox Classics, Platinum Hits, Limited Collector''s Edition' WHERE id IN ('mass-effect-xbox-360-2247165b');
UPDATE game_releases SET also_released_as = 'Xbox Classics, Platinum Hits, Limited Edition, Legendary Edition' WHERE id IN ('halo-3-xbox-360-3e97d574');
UPDATE game_releases SET also_released_as = 'Xbox Classics, Platinum Hits, Assassin''s Creed: Ezio Trilogy, Assassin''s Creed: Heritage Collection, Da Vinci Edition, Not for Resale' WHERE id IN ('assassin-s-creed-brotherhood-xbox-360-5f0b600d');
UPDATE game_releases SET also_released_as = 'Xbox Classics, Platinum Hits, Steelbook, 2K Essentials Collection, BioShock & The Elder Scrolls IV: Oblivion Bundle, Ultimate Rapture Edition' WHERE id IN ('bioshock-xbox-360-90d29d82');
UPDATE game_releases SET also_released_as = 'Xbox Classics, Special Edition' WHERE id IN ('assassin-s-creed-revelations-xbox-360-a5bd8a55');
UPDATE game_releases SET also_released_as = 'Xbox Classics, Xbox 360 Console Bundle (Halo Wars + Fable II), Xbox 360 Console Bundle (Halo Wars + Halo 3)' WHERE id IN ('halo-wars-xbox-360-68cde184');
UPDATE game_releases SET also_released_as = 'Platinum Family Hits, Children''s Miracle Network Games Bundle' WHERE id IN ('sonic-the-hedgehog-xbox-360-0e501eec');
UPDATE game_releases SET also_released_as = 'Platinum Hits' WHERE id IN ('bioshock-xbox-360-f01a7bdb', 'dead-space-2-xbox-360-5fd0f671', 'dead-space-2-xbox-360-d582d640', 'fallout-3-xbox-360-620ae7bf', 'fallout-3-xbox-360-8d87bc87', 'halo-wars-xbox-360-8213acd7', 'kameo-elements-of-power-xbox-360-2ae73ba8', 'lego-batman-2-dc-super-heroes-xbox-360-a1392123', 'lego-indiana-jones-2-the-adventure-continues-xbox-360-4a870a0d', 'plants-vs-zombies-xbox-360-3ef34bda', 'plants-vs-zombies-garden-warfare-xbox-360-97323d95', 'red-dead-redemption-undead-nightmare-xbox-360-ec74f81a', 'sonic-unleashed-xbox-360-ea27d841', 'star-wars-the-force-unleashed-xbox-360-e9c02ba9', 'star-wars-the-force-unleashed-ii-xbox-360-0a366d7d', 'call-of-duty-finest-hour-xbox-4f3c930a', 'oddworld-munch-s-oddysee-xbox-818951c4', 'prince-of-persia-the-sands-of-time-xbox-91945520', 'star-wars-episode-iii-revenge-of-the-sith-xbox-7af527e6', 'star-wars-knights-of-the-old-republic-ii-the-sith-lords-xbox-30b219bb', 'star-wars-obi-wan-xbox-1fce5a5b', 'star-wars-republic-commando-xbox-cc5bacaf', 'star-wars-starfighter-special-edition-xbox-09c50f85', 'tom-clancy-s-splinter-cell-chaos-theory-xbox-4827edcb', 'assassin-s-creed-brotherhood-xbox-360-d5d1ec30', 'dead-rising-xbox-360-9d395c8d', 'sonic-s-ultimate-genesis-collection-xbox-360-1dccb0ab', 'pac-man-world-2-xbox-341f8e18', 'grand-theft-auto-vice-city-xbox-47a47b2b', 'grand-theft-auto-san-andreas-xbox-df7590e6');
UPDATE game_releases SET also_released_as = 'Platinum Hits, Assassin''s Creed: Ezio Trilogy, Bundled with Bonus Content Disc' WHERE id IN ('assassin-s-creed-ii-xbox-360-f4de84c6');
UPDATE game_releases SET also_released_as = 'Platinum Hits, Borderlands Triple Pack, 2K Essentials Collection, Game of the Year, Game of the Year (Platinum Hits), Game of the Year (Classics)' WHERE id IN ('borderlands-xbox-360-b18f4035');
UPDATE game_releases SET also_released_as = 'Platinum Hits, Bundled with Xbox 360' WHERE id IN ('banjo-kazooie-nuts-bolts-xbox-360-32fe9ef7', 'lego-indiana-jones-the-original-adventures-xbox-360-ff2f0899');
UPDATE game_releases SET also_released_as = 'Platinum Hits, Bundled with Xbox 360, Bundle Copy (2 Games), Plays on Xbox One & Xbox 360' WHERE id IN ('lego-batman-the-videogame-xbox-360-a5079c13');
UPDATE game_releases SET also_released_as = 'Platinum Hits, Èdition Collector' WHERE id IN ('terraria-xbox-360-911e4c82');
UPDATE game_releases SET also_released_as = 'Platinum Hits, Game of the Year Edition: Platinum Hits (Disc 1), Collector''s Edition, Fallout 3 & Oblivion Double Pack, Game of the Year Edition' WHERE id IN ('fallout-3-xbox-360-9e679170');
UPDATE game_releases SET also_released_as = 'Platinum Hits, Grand Theft Auto IV & Episodes from Liberty City: The Complete Edition' WHERE id IN ('grand-theft-auto-iv-xbox-360-0a7d0e28');
UPDATE game_releases SET also_released_as = 'Platinum Hits, Halo Origins Bundle' WHERE id IN ('halo-combat-evolved-anniversary-xbox-360-ef46efe3');
UPDATE game_releases SET also_released_as = 'Platinum Hits, Capcom Essentials, Triple Pack' WHERE id IN ('devil-may-cry-4-xbox-360-95d09fc8');
UPDATE game_releases SET also_released_as = 'Platinum Hits, Xbox Classics, Call of Duty: The War Collection' WHERE id IN ('call-of-duty-3-xbox-360-6d458596', 'call-of-duty-world-at-war-xbox-360-6f49101e');
UPDATE game_releases SET also_released_as = 'Platinum Hits, Triple Pack' WHERE id IN ('dead-rising-xbox-360-7b48649c');
UPDATE game_releases SET also_released_as = 'Collector''s Edition, Platinum, Platinum: The Best of PlayStation 2, Bundled with PS2, Review' WHERE id IN ('killzone-playstation-2-40e45256');
UPDATE game_releases SET also_released_as = 'Daini-kai Metal Gear Solid-sai Hakkou Kinen, PlayStation 2 the Best, Mega Hits!, Konami Dendou Selection, Metal Gear 20th Anniversary, Metal Gear 20th Anniversary: Metal Gear Solid Collection' WHERE id IN ('metal-gear-solid-2-sons-of-liberty-playstation-2-1a666253');
UPDATE game_releases SET also_released_as = 'Greatest Hits, 5th Anniversary Collection' WHERE id IN ('devil-may-cry-playstation-2-01e8eac9', 'devil-may-cry-2-playstation-2-4fb239fa', 'devil-may-cry-2-playstation-2-75a95355');
UPDATE game_releases SET also_released_as = 'Greatest Hits, Crash Bandicoot Action Pack' WHERE id IN ('crash-nitro-kart-playstation-2-1b188942', 'crash-tag-team-racing-playstation-2-d8b2aa1c');
UPDATE game_releases SET also_released_as = 'Greatest Hits, Bundled with PS2' WHERE id IN ('lego-batman-the-videogame-playstation-2-aa44b03d');
UPDATE game_releases SET also_released_as = 'Greatest Hits, Grand Theft Auto: Double Pack, Grand Theft Auto: The Trilogy' WHERE id IN ('grand-theft-auto-iii-playstation-2-431c2b33');
UPDATE game_releases SET also_released_as = 'Greatest Hits, Resident Evil: The Essentials' WHERE id IN ('resident-evil-4-playstation-2-12c8b35c');
UPDATE game_releases SET also_released_as = 'Greatest Hits, Resident Evil: The Essentials, 5th Anniversary' WHERE id IN ('resident-evil-code-veronica-x-playstation-2-f979efa5');
UPDATE game_releases SET also_released_as = 'Konami the Best, Konami Dendou Selection' WHERE id IN ('silent-hill-2-playstation-2-c0bca7c2', 'silent-hill-3-playstation-2-bfe98c8e', 'silent-hill-4-the-room-playstation-2-b23dc272');
UPDATE game_releases SET also_released_as = 'Platinum, Bundled with PS2' WHERE id IN ('final-fantasy-x-playstation-2-c2c61f23');
UPDATE game_releases SET also_released_as = 'Platinum, Bundled with Sony PlayStation 2' WHERE id IN ('metal-gear-solid-2-sons-of-liberty-playstation-2-652a3e76');
UPDATE game_releases SET also_released_as = 'Platinum, Crash Bandicoot Action Pack' WHERE id IN ('crash-nitro-kart-playstation-2-bace805f');
UPDATE game_releases SET also_released_as = 'Platinum, Double Pack' WHERE id IN ('grand-theft-auto-iii-playstation-2-1582e336', 'grand-theft-auto-vice-city-playstation-2-5c222a03');
UPDATE game_releases SET also_released_as = 'Platinum, Grand Theft Auto: The Trilogy' WHERE id IN ('grand-theft-auto-vice-city-playstation-2-60da431a');
UPDATE game_releases SET also_released_as = 'Platinum, Platinum Rerelease' WHERE id IN ('star-wars-battlefront-ii-playstation-2-02da454b');
UPDATE game_releases SET also_released_as = 'Platinum, Platinum: The Best of PlayStation 2' WHERE id IN ('final-fantasy-xii-playstation-2-87124d6a', 'god-of-war-playstation-2-a567869c', 'grand-theft-auto-san-andreas-playstation-2-13a51f88', 'jak-ii-playstation-2-c0c0730d', 'kingdom-hearts-playstation-2-a5034ea8', 'lego-star-wars-the-video-game-playstation-2-18a4f99d', 'resident-evil-code-veronica-x-playstation-2-31f6a4d5', 'sonic-heroes-playstation-2-6b5db818', 'tom-clancy-s-splinter-cell-pandora-tomorrow-playstation-2-8b204c26', 'killzone-playstation-2-ba39ff03');
UPDATE game_releases SET also_released_as = 'Platinum, Platinum: The Best of PlayStation 2, Bundled with EyeToy Camera, Press Disc' WHERE id IN ('eyetoy-play-playstation-2-4668eb4f');
UPDATE game_releases SET also_released_as = 'Platinum, Platinum: The Best of PlayStation 2, Limited Edition' WHERE id IN ('resident-evil-4-playstation-2-23089a94');
UPDATE game_releases SET also_released_as = 'Platinum, Platinum: The Best of PlayStation 2, Prince of Persia Trilogy' WHERE id IN ('prince-of-persia-warrior-within-playstation-2-605f620d');
UPDATE game_releases SET also_released_as = 'Platinum, Platinum: The Best of PlayStation 2, Bundled with PS2, Rerelease' WHERE id IN ('final-fantasy-x-playstation-2-6d78a9ff');
UPDATE game_releases SET also_released_as = 'Platinum, Platinum: The Best of PlayStation 2, Crash Bandicoot Action Pack' WHERE id IN ('crash-tag-team-racing-playstation-2-e5a1b3e4');
UPDATE game_releases SET also_released_as = 'Platinum, Platinum: The Best of PlayStation 2, PS2 Console Bundle' WHERE id IN ('jak-3-playstation-2-8bbf28fb');
UPDATE game_releases SET also_released_as = 'Platinum, Platinum: The Best of PlayStation 2, Rayman 10th Anniversary - 3 Title Pack Limited Edition, Rayman 10th Anniversary - Limited Edition' WHERE id IN ('rayman-3-hoodlum-havoc-playstation-2-fcf2a758');
UPDATE game_releases SET also_released_as = 'Platinum, Platinum: The Best of PlayStation 2, Special Edition' WHERE id IN ('god-of-war-ii-playstation-2-e685fce4');
UPDATE game_releases SET also_released_as = 'Platinum, Prince of Persia Trilogy' WHERE id IN ('prince-of-persia-the-sands-of-time-playstation-2-7f576c4a', 'prince-of-persia-the-two-thrones-playstation-2-ca4b6477');
UPDATE game_releases SET also_released_as = 'Platinum, Monster Edition' WHERE id IN ('crash-of-the-titans-playstation-2-3706f648');
UPDATE game_releases SET also_released_as = 'Platinum, Reprint' WHERE id IN ('final-fantasy-x-playstation-2-5a0b02bc');
UPDATE game_releases SET also_released_as = 'Platinum, Rerelease' WHERE id IN ('devil-may-cry-playstation-2-1e2cb571');
UPDATE game_releases SET also_released_as = 'Platinum: The Best of PlayStation 2' WHERE id IN ('final-fantasy-x-2-playstation-2-46fe9e96', 'grand-theft-auto-liberty-city-stories-playstation-2-f8a6c4dc', 'grand-theft-auto-vice-city-stories-playstation-2-c1a2e7e6', 'tomb-raider-legend-playstation-2-77bf8235', 'lego-indiana-jones-the-original-adventures-playstation-2-597f3438', 'lego-star-wars-ii-the-original-trilogy-playstation-2-3f3d0413', 'max-payne-2-the-fall-of-max-payne-playstation-2-9e1bf6cb', 'metal-gear-solid-2-sons-of-liberty-playstation-2-14dce0d0', 'sonic-mega-collection-plus-playstation-2-4f121840', 'spider-man-2-playstation-2-03d1ab8c', 'star-wars-battlefront-playstation-2-58c7f4fb', 'star-wars-battlefront-ii-playstation-2-61202103', 'star-wars-episode-iii-revenge-of-the-sith-playstation-2-1b7d619a', 'star-wars-the-force-unleashed-playstation-2-0146ad44', 'tom-clancy-s-splinter-cell-double-agent-playstation-2-78801aef', 'tom-clancy-s-splinter-cell-double-agent-playstation-2-cdd42f5e');
UPDATE game_releases SET also_released_as = 'Platinum: The Best of PlayStation 2, Collectors Edition' WHERE id IN ('tomb-raider-anniversary-playstation-2-334af305');
UPDATE game_releases SET also_released_as = 'Platinum: The Best of PlayStation 2, Crash Bandicoot Action Pack' WHERE id IN ('crash-twinsanity-playstation-2-9055a7bc');
UPDATE game_releases SET also_released_as = 'Platinum: The Best of PlayStation 2, Steelbook' WHERE id IN ('metal-gear-solid-3-snake-eater-playstation-2-6ecb049a');
UPDATE game_releases SET also_released_as = 'PlayStation 2 the Best' WHERE id IN ('dark-cloud-playstation-2-5b52125d', 'ico-playstation-2-9a7ba614', 'maximo-ghosts-to-glory-playstation-2-6a05742c', 'kami-playstation-2-d8cf1821', 'persona-3-fes-playstation-2-1ca4f6ba', 'persona-3-fes-playstation-2-3d10fea9', 'space-channel-5-part-2-playstation-2-390cbbe9', 'tales-of-legendia-playstation-2-3c0ed8ac', 'tales-of-the-abyss-playstation-2-2579b644', 'xenosaga-episode-i-der-wille-zur-macht-playstation-2-380bf6d2', 'xenosaga-episode-i-der-wille-zur-macht-playstation-2-508423b4', 'xenosaga-episode-ii-jenseits-von-gut-und-b-se-playstation-2-398eaef1', 'xenosaga-episode-ii-jenseits-von-gut-und-b-se-playstation-2-0f55c58f', 'zone-of-the-enders-playstation-2-730cfcce');
UPDATE game_releases SET also_released_as = 'PlayStation 2 the Best Reprint' WHERE id IN ('ico-playstation-2-debf4be4');
UPDATE game_releases SET also_released_as = 'PlayStation 2 the Best Reprint, PlayStation 2 the Best' WHERE id IN ('ico-playstation-2-3f32c976');
UPDATE game_releases SET also_released_as = 'PlayStation 2 the Best, Bundled with PlayStation 2, PlayStation 2 the Best Reprint' WHERE id IN ('ratchet-clank-playstation-2-24ecbbcb');
UPDATE game_releases SET also_released_as = 'PlayStation 2 the Best, Konami Dendou Selection' WHERE id IN ('metal-gear-solid-2-substance-playstation-2-46c18a0f');
UPDATE game_releases SET also_released_as = 'PlayStation 2 the Best, Konamistyle Genteiban' WHERE id IN ('persona-4-playstation-2-92f102fa');
UPDATE game_releases SET also_released_as = 'PlayStation 2 the Best, Mega Hits!' WHERE id IN ('devil-may-cry-playstation-2-26bd009f');
UPDATE game_releases SET also_released_as = 'PlayStation 2 the Best, Mega Hits!, Konami Dendou Selection, Metal Gear 20th Anniversary, Metal Gear 20th Anniversary: Metal Gear Solid Collection' WHERE id IN ('metal-gear-solid-2-sons-of-liberty-playstation-2-85ba5e18', 'metal-gear-solid-2-sons-of-liberty-playstation-2-aec1deca');
UPDATE game_releases SET also_released_as = 'PlayStation 2 the Best, Mega Hits!, Konami Dendou Selection, Metal Gear 20th Anniversary, Metal Gear 20th Anniversary: Metal Gear Solid Collection, Premium Package' WHERE id IN ('metal-gear-solid-2-sons-of-liberty-playstation-2-d94f64fb');
UPDATE game_releases SET also_released_as = 'PlayStation 2 the Best, PlayStation 2 the Best Reprint' WHERE id IN ('katamari-damacy-playstation-2-f44d3e03');
UPDATE game_releases SET also_released_as = 'PlayStation 2 the Best, Special Package' WHERE id IN ('rez-playstation-2-2d53f0db');
UPDATE game_releases SET also_released_as = 'Nintendo Selects, Bundled with Nintendo Wii' WHERE id IN ('wii-sports-wii-87bded9d', 'wii-sports-wii-7335fb54', 'new-super-mario-bros-wii-wii-2a9344fb');
UPDATE game_releases SET also_released_as = 'Nintendo Selects, Bundled with Wii Wheel' WHERE id IN ('mario-kart-wii-wii-8b41999f', 'mario-kart-wii-wii-3a70d78b');
UPDATE game_releases SET also_released_as = 'Nintendo Selects' WHERE id IN ('donkey-kong-country-returns-wii-a1c33316', 'donkey-kong-country-returns-wii-063ded8d', 'mario-party-8-wii-dfe8361a', 'mario-party-9-wii-15f44aaf', 'mario-power-tennis-wii-5532686d', 'mario-power-tennis-wii-8e838298', 'mario-strikers-charged-wii-99814bef', 'mario-super-sluggers-wii-c4adc0a0', 'punch-out-wii-513a489c', 'rayman-raving-rabbids-wii-4ff8e3e3', 'super-mario-all-stars-limited-edition-wii-a2e7380d', 'super-mario-galaxy-wii-0aeffd47', 'super-mario-galaxy-wii-1047de4c', 'super-mario-galaxy-2-wii-4637269', 'super-mario-galaxy-2-wii-fbc19306', 'super-paper-mario-wii-ad00ca01', 'super-paper-mario-wii-69f55eed', 'super-smash-bros-brawl-wii-cb762c85', 'warioware-smooth-moves-wii-e9482d2d', 'wii-party-wii-3a519fe4');
UPDATE game_releases SET also_released_as = 'Nintendo Selects, Bundled with Wii MotionPlus' WHERE id IN ('wii-sports-resort-wii-18b07bb0');
UPDATE game_releases SET also_released_as = 'Hudson the Best' WHERE id IN ('bomberman-generation-nintendo-gamecube-b4c2505d', 'bomberman-jetters-nintendo-gamecube-cd233d37', 'bomberman-party-edition-playstation-89e8d053');
UPDATE game_releases SET also_released_as = 'Player''s Choice' WHERE id IN ('crash-bandicoot-the-wrath-of-cortex-nintendo-gamecube-adcc7698', 'f-zero-gx-nintendo-gamecube-7065fd23', 'f-zero-gx-nintendo-gamecube-3186fcbe', 'harvest-moon-a-wonderful-life-nintendo-gamecube-d5c265c1', 'harvest-moon-magical-melody-nintendo-gamecube-02778d03', 'lego-star-wars-ii-the-original-trilogy-nintendo-gamecube-cea162cd', 'lego-star-wars-the-video-game-nintendo-gamecube-8416d40e', 'luigi-s-mansion-nintendo-gamecube-0b0c339d', 'mario-golf-toadstool-tour-nintendo-gamecube-126a6db1', 'mario-party-5-nintendo-gamecube-afc58f78', 'metal-gear-solid-the-twin-snakes-nintendo-gamecube-02ab12f2', 'metal-gear-solid-the-twin-snakes-nintendo-gamecube-ff7bcd0a', 'pac-man-fever-nintendo-gamecube-2e6425f3', 'pac-man-world-2-nintendo-gamecube-3e95583a', 'pikmin-nintendo-gamecube-07ae1f8b', 'pikmin-nintendo-gamecube-5c680247', 'pikmin-2-nintendo-gamecube-3541416b', 'prince-of-persia-the-sands-of-time-nintendo-gamecube-17e54b61', 'rayman-3-hoodlum-havoc-nintendo-gamecube-7337e8c2', 'resident-evil-nintendo-gamecube-24519740', 'resident-evil-nintendo-gamecube-8e5597c1', 'resident-evil-4-nintendo-gamecube-f5c51b40', 'resident-evil-4-nintendo-gamecube-6c83a5ff', 'resident-evil-zero-nintendo-gamecube-bcc348bf', 'resident-evil-zero-nintendo-gamecube-4daf0830', 'sonic-adventure-2-battle-nintendo-gamecube-c576b909', 'sonic-adventure-2-battle-nintendo-gamecube-024f4f8f', 'sonic-adventure-dx-director-s-cut-nintendo-gamecube-9ba7f3af', 'sonic-adventure-dx-director-s-cut-nintendo-gamecube-f4e4e141', 'sonic-gems-collection-nintendo-gamecube-fff7ec04', 'sonic-heroes-nintendo-gamecube-c27a3cac', 'sonic-heroes-nintendo-gamecube-48ce3c79', 'sonic-mega-collection-nintendo-gamecube-9aa972fc', 'sonic-mega-collection-nintendo-gamecube-01b52739', 'sonic-riders-nintendo-gamecube-1dabe6ee', 'spider-man-2-nintendo-gamecube-f4c10a62', 'spyro-a-hero-s-tail-nintendo-gamecube-57708149', 'spyro-enter-the-dragonfly-nintendo-gamecube-c413de23', 'spyro-enter-the-dragonfly-nintendo-gamecube-0956a8df', 'star-fox-adventures-nintendo-gamecube-3cd4be1c', 'star-wars-rogue-squadron-ii-rogue-leader-nintendo-gamecube-e9d4823d', 'star-wars-the-clone-wars-nintendo-gamecube-8d24a2c1', 'super-mario-sunshine-nintendo-gamecube-4c1d3641', 'super-mario-sunshine-nintendo-gamecube-771ad977', 'super-monkey-ball-nintendo-gamecube-7726c879', 'super-monkey-ball-2-nintendo-gamecube-2f726b39', 'super-monkey-ball-2-nintendo-gamecube-c54e40e8', 'super-smash-bros-melee-nintendo-gamecube-0fd01424', 'tales-of-symphonia-nintendo-gamecube-7fe3b9f7', 'tales-of-symphonia-nintendo-gamecube-a65645eb');
UPDATE game_releases SET also_released_as = 'Player''s Choice' WHERE id IN ('viewtiful-joe-nintendo-gamecube-121a9a8e', 'wario-world-nintendo-gamecube-6a9546aa', 'super-smash-bros-melee-nintendo-gamecube-5365c84b', 'animal-crossing-nintendo-gamecube-7be72542');
UPDATE game_releases SET also_released_as = 'Player''s Choice (Best Seller)' WHERE id IN ('kirby-air-ride-nintendo-gamecube-f1a3e7a2', 'paper-mario-the-thousand-year-door-nintendo-gamecube-5a682160');
UPDATE game_releases SET also_released_as = 'Player''s Choice, Bundled with GameCube' WHERE id IN ('mario-kart-double-dash-nintendo-gamecube-a211edb6', 'metroid-prime-nintendo-gamecube-aed8bc02', 'metroid-prime-nintendo-gamecube-61592372');
UPDATE game_releases SET also_released_as = 'Player''s Choice, Exclusive Target Bullseye Tour Included!' WHERE id IN ('mario-golf-toadstool-tour-nintendo-gamecube-38a86294');
UPDATE game_releases SET also_released_as = 'Player''s Choice, Player''s Choice (Best Seller)' WHERE id IN ('star-fox-assault-nintendo-gamecube-07166d23');
UPDATE game_releases SET also_released_as = 'Xbox Classics, Bundled with Xbox' WHERE id IN ('halo-combat-evolved-xbox-3af4ca68', 'halo-combat-evolved-xbox-aed20294', 'halo-combat-evolved-xbox-e00bc08b');
UPDATE game_releases SET also_released_as = 'Xbox Classics, Limited Collector''s Edition' WHERE id IN ('halo-2-xbox-51838b47');
UPDATE game_releases SET also_released_as = 'Xbox Classics, Platinum Hits, World Collection' WHERE id IN ('return-to-castle-wolfenstein-xbox-54d22294');
UPDATE game_releases SET also_released_as = 'Platinum Family Hits' WHERE id IN ('lego-star-wars-ii-the-original-trilogy-xbox-76519cf5', 'lego-star-wars-the-video-game-xbox-35c71f37', 'sonic-heroes-xbox-e5aaff97');
UPDATE game_releases SET also_released_as = 'Platinum Hits, Best of Platinum Hits' WHERE id IN ('tom-clancy-s-splinter-cell-pandora-tomorrow-xbox-20e895f0');
UPDATE game_releases SET also_released_as = 'Platinum Hits, Tom Clancy''s Classic Trilogy' WHERE id IN ('tom-clancy-s-splinter-cell-xbox-6ef5be41');
UPDATE game_releases SET also_released_as = 'Favorites' WHERE id IN ('ape-escape-on-the-loose-playstation-portable-b86783da', 'spider-man-3-playstation-portable-ad00100e', 'spider-man-3-playstation-portable-b442af18');
UPDATE game_releases SET also_released_as = 'Greatest Hits, Bundled with PSP' WHERE id IN ('god-of-war-chains-of-olympus-playstation-portable-b9b62ab0', 'metal-gear-solid-peace-walker-playstation-portable-1a2c5ca5');
UPDATE game_releases SET also_released_as = 'Greatest Hits, Secret Agent Clank + Daxter UMD Dual Pack' WHERE id IN ('daxter-playstation-portable-0af9efdc', 'secret-agent-clank-playstation-portable-6c9417ab');
UPDATE game_releases SET also_released_as = 'Konami the Best' WHERE id IN ('metal-gear-acid-playstation-portable-2f2f8398');
UPDATE game_releases SET also_released_as = 'Platinum: The Best of PSP' WHERE id IN ('crisis-core-final-fantasy-vii-playstation-portable-4f6de18c', 'crisis-core-final-fantasy-vii-playstation-portable-ecb4df96', 'grand-theft-auto-liberty-city-stories-playstation-portable-7a884c02', 'grand-theft-auto-liberty-city-stories-playstation-portable-d0a1c0f5', 'lego-star-wars-ii-the-original-trilogy-playstation-portable-938650f8', 'prince-of-persia-rival-swords-playstation-portable-5f6b7645', 'grand-theft-auto-vice-city-stories-playstation-portable-b44ac795', 'lemmings-playstation-portable-11bd71f4', 'star-wars-the-force-unleashed-playstation-portable-556834ce', 'star-wars-the-force-unleashed-playstation-portable-eb3881b3', 'crash-tag-team-racing-playstation-portable-4ac96d6e', 'crash-tag-team-racing-playstation-portable-13ca0e02');
UPDATE game_releases SET also_released_as = 'PSP Essentials, Platinum: The Best of PSP' WHERE id IN ('crash-tag-team-racing-playstation-portable-dfb63b73', 'god-of-war-chains-of-olympus-playstation-portable-4704d399', 'killzone-liberation-playstation-portable-57f4d17f', 'tomb-raider-legend-playstation-portable-09d3414b', 'lego-indiana-jones-the-original-adventures-playstation-portable-a7ef30f6', 'medievil-resurrection-playstation-portable-88060384', 'sonic-rivals-playstation-portable-dcbc235d', 'sonic-rivals-2-playstation-portable-a994a3f0', 'star-wars-battlefront-ii-playstation-portable-e767aa58', 'daxter-playstation-portable-a802cf6e', 'jak-and-daxter-the-lost-frontier-playstation-portable-39de4b84', 'jak-and-daxter-the-lost-frontier-playstation-portable-ec826df6', 'ratchet-clank-size-matters-playstation-portable-8981e31f', 'secret-agent-clank-playstation-portable-b6b8bad8');
UPDATE game_releases SET also_released_as = 'PSP Essentials, Platinum: The Best of PSP, Bundle "LocoRoco" Edition' WHERE id IN ('locoroco-playstation-portable-33d54b2d');
UPDATE game_releases SET also_released_as = 'PSP Essentials, Platinum: The Best of PSP, Bundled with PSP Console' WHERE id IN ('littlebigplanet-playstation-portable-b77301e8');
UPDATE game_releases SET also_released_as = 'PSP the Best' WHERE id IN ('locoroco-playstation-portable-1bb09451', 'locoroco-playstation-portable-63de70f2', 'metal-gear-solid-peace-walker-playstation-portable-06033d6c', 'patapon-playstation-portable-1a4fd1d2', 'persona-3-portable-playstation-portable-85d186df');
UPDATE game_releases SET also_released_as = 'PSP the Best, Konami Dendou Selection' WHERE id IN ('metal-gear-solid-portable-ops-playstation-portable-32bdcc8c');
UPDATE game_releases SET also_released_as = 'PSP the Best, PSP the Best (Rerelease)' WHERE id IN ('patapon-2-playstation-portable-75a4f0ca');
UPDATE game_releases SET also_released_as = 'UMD Dual Pack, Favorites' WHERE id IN ('monster-hunter-freedom-unite-playstation-portable-7fded7ad');
UPDATE game_releases SET also_released_as = 'Platinum: The Best of PSP, Limited Edition' WHERE id IN ('crisis-core-final-fantasy-vii-playstation-portable-1d800575');
UPDATE game_releases SET also_released_as = 'Greatest Hits, Anniversary Collector''s Edition, Anniversary Edition' WHERE id IN ('mega-man-8-playstation-7d2dc696');
UPDATE game_releases SET also_released_as = 'Eidos Ricochet: Value Series, Platinum, Eidos Ricochet' WHERE id IN ('tomb-raider-playstation-2632f6df', 'tomb-raider-playstation-061acdc9');
UPDATE game_releases SET also_released_as = 'Greatest Hits, Collectors'' Edition' WHERE id IN ('crash-bandicoot-warped-playstation-727bf739', 'crash-bash-playstation-56846228', 'grand-theft-auto-2-playstation-061cb66c', 'spyro-2-ripto-s-rage-playstation-fe1cd9e3', 'spyro-the-dragon-playstation-639d58e5', 'spyro-year-of-the-dragon-playstation-e836cd9e');
UPDATE game_releases SET also_released_as = 'Greatest Hits, Director''s Cut, Collectors'' Edition' WHERE id IN ('grand-theft-auto-playstation-e415f405');
UPDATE game_releases SET also_released_as = 'Greatest Hits, Metal Gear Solid: The Essential Collection' WHERE id IN ('metal-gear-solid-playstation-f2ac185c', 'metal-gear-solid-playstation-1906500');
UPDATE game_releases SET also_released_as = 'Konami the Best, PSone Books' WHERE id IN ('metal-gear-solid-playstation-67125893', 'metal-gear-solid-playstation-664f7e42');
UPDATE game_releases SET also_released_as = 'Platinum, Reprint, 2 Games' WHERE id IN ('rayman-playstation-f6a7b2bd', 'rayman-playstation-484772d8');
UPDATE game_releases SET also_released_as = 'Platinum, 2 Games' WHERE id IN ('rayman-2-the-great-escape-playstation-b6f065df', 'rayman-2-the-great-escape-playstation-f322166c');
UPDATE game_releases SET also_released_as = 'Platinum, Best of Infogrames: Value Series, Best of Infogrames: Adventure' WHERE id IN ('oddworld-abe-s-oddysee-playstation-555098bf');
UPDATE game_releases SET also_released_as = 'Platinum, Bundle' WHERE id IN ('ape-escape-playstation-058a8e68');
UPDATE game_releases SET also_released_as = 'Platinum, EA Classics: Value Series' WHERE id IN ('croc-legend-of-the-gobbos-playstation-d1ca7133');
UPDATE game_releases SET also_released_as = 'Platinum, Eidos Classic Edition' WHERE id IN ('tomb-raider-iii-adventures-of-lara-croft-playstation-a618a0a7');
UPDATE game_releases SET also_released_as = 'Platinum, Eidos Ricochet' WHERE id IN ('tomb-raider-ii-playstation-29e94636', 'tomb-raider-ii-playstation-a75a1b69');
UPDATE game_releases SET also_released_as = 'Platinum, Rental' WHERE id IN ('medievil-playstation-c3bde271', 'crash-bandicoot-2-cortex-strikes-back-playstation-3f70cad3');
UPDATE game_releases SET also_released_as = 'Platinum, White Label, White Label: Value Series' WHERE id IN ('resident-evil-playstation-2046d852', 'resident-evil-playstation-1603a21a');
UPDATE game_releases SET also_released_as = 'PlayStation the Best' WHERE id IN ('namco-museum-vol-1-playstation-b875076a', 'namco-museum-vol-3-playstation-390b58ce', 'namco-museum-vol-4-playstation-de7ca55c', 'namco-museum-vol-5-playstation-0b79d920', 'tetris-plus-playstation-f23e5b3c');
UPDATE game_releases SET also_released_as = 'PlayStation the Best for Family, PSone Books' WHERE id IN ('bomberman-fantasy-race-playstation-f3f40c8e');
UPDATE game_releases SET also_released_as = 'PSone Books, Chocobo Collection: Happy 10th Anniversary!' WHERE id IN ('chocobo-racing-playstation-faed70f5');
UPDATE game_releases SET also_released_as = 'PSone Books, King''s Field: Dark Side Box 1994-2007' WHERE id IN ('king-s-field-playstation-fa382fbc');
UPDATE game_releases SET also_released_as = 'PSone Books, PlayStation the Best for Family' WHERE id IN ('crash-bandicoot-playstation-db51cb50');
UPDATE game_releases SET also_released_as = 'PSone Books, Ultimate Hits' WHERE id IN ('saga-frontier-playstation-ea8e33d6');
UPDATE game_releases SET also_released_as = 'Square Millennium Collection, PSone Books, Ultimate Hits' WHERE id IN ('chrono-cross-playstation-62971f7c', 'chrono-cross-playstation-63ca39ad', 'final-fantasy-tactics-playstation-348152f5');
UPDATE game_releases SET also_released_as = 'Square Millennium Collection: Wong Fei Fong Edition, PSone Books' WHERE id IN ('xenogears-playstation-7fe76aed');
UPDATE game_releases SET also_released_as = 'Sega All Stars' WHERE id IN ('marvel-vs-capcom-clash-of-super-heroes-dreamcast-f37f12f5');
UPDATE game_releases SET also_released_as = 'Satakore' WHERE id IN ('saturn-bomberman-sega-saturn-4db74588', 'saturn-bomberman-sega-saturn-2339db5b');
UPDATE game_releases SET also_released_as = 'Satakore, Tokubetsu Genteiban' WHERE id IN ('nights-into-dreams-sega-saturn-3674a53e');
UPDATE game_releases SET also_released_as = 'PlayStation 3 the Best, BigHit Series' WHERE id IN ('infamous-playstation-3-2d5fd278');
UPDATE game_releases SET also_released_as = 'Xbox Classics, Assassin''s Creed: Ezio Trilogy, Assassin''s Creed: Heritage Collection, Signature Edition, Special Edition' WHERE id IN ('assassin-s-creed-revelations-xbox-360-5e0fcfbb');
UPDATE game_releases SET also_released_as = 'Platinum Hits, Crash Superpack (Platinum Family Hits)' WHERE id IN ('crash-bandicoot-the-wrath-of-cortex-xbox-fa324b15');
UPDATE game_releases SET also_released_as = 'Greatest Hits, Special Edition, Grand Theft Auto: The Trilogy' WHERE id IN ('grand-theft-auto-san-andreas-playstation-2-f3884e41');
UPDATE game_releases SET also_released_as = 'Greatest Hits, Pac-Man Power Pack' WHERE id IN ('pac-man-world-2-playstation-2-8ad2c3f1');
UPDATE game_releases SET also_released_as = 'Pac-Man Power Pack' WHERE id IN ('pac-man-world-3-playstation-2-4cb3531f', 'pac-man-world-rally-playstation-2-f623ea64');
UPDATE game_releases SET also_released_as = 'Killzone Trilogy' WHERE id IN ('killzone-3-playstation-3-b13dce2e');
UPDATE game_releases SET also_released_as = 'Kinect Sports: Ultimate Collection' WHERE id IN ('kinect-sports-season-two-xbox-360-5f4e412a');
UPDATE game_releases SET also_released_as = 'Grand Theft Auto: Double Pack, Grand Theft Auto: The Trilogy' WHERE id IN ('grand-theft-auto-iii-xbox-48205a94', 'grand-theft-auto-iii-xbox-a5bdba0f');
UPDATE game_releases SET also_released_as = 'Xbox Classics, Grand Theft Auto: Double Pack, Grand Theft Auto: The Trilogy' WHERE id IN ('grand-theft-auto-iii-xbox-06ca09d6', 'grand-theft-auto-iii-xbox-e51907a9', 'grand-theft-auto-vice-city-xbox-4e4d7adc');
UPDATE game_releases SET also_released_as = 'Grand Theft Auto: Double Pack' WHERE id IN ('grand-theft-auto-iii-xbox-4a82182f', 'grand-theft-auto-vice-city-xbox-34903733', 'grand-theft-auto-vice-city-xbox-2d7cafef', 'grand-theft-auto-vice-city-xbox-db3da117', 'grand-theft-auto-vice-city-xbox-dd14f681');
UPDATE game_releases SET also_released_as = 'Platinum, Metal Gear 25th Anniversary' WHERE id IN ('metal-gear-solid-4-guns-of-the-patriots-playstation-3-3ac34704');
UPDATE game_releases SET also_released_as = 'Game of the Year Edition, Platinum Hits' WHERE id IN ('call-of-duty-2-xbox-360-e67ae346');
UPDATE game_releases SET also_released_as = 'Platinum Collection' WHERE id IN ('kinect-sports-xbox-360-232b1c8c');
UPDATE game_releases SET also_released_as = 'Greatest Hits, Grand Theft Auto: Double Pack' WHERE id IN ('grand-theft-auto-vice-city-playstation-2-7d2bfcf4');
UPDATE game_releases SET also_released_as = 'Xbox Classics, Washington Edition' WHERE id IN ('assassin-s-creed-iii-xbox-360-6ee6ad2f', 'assassin-s-creed-iii-xbox-360-817ebc45', 'assassin-s-creed-iii-xbox-360-ac53527f', 'assassin-s-creed-iii-xbox-360-d483ee7e');

PRAGMA foreign_keys = ON;
