-- Migration: 0024_platform_display_names_and_global_launch_dates.sql
-- Description: Update NES and SNES display labels to include Famicom/Super Famicom, and standardize platform launch dates to earliest global release dates.

-- Update NES and SNES Display Labels
UPDATE platforms SET display_name = 'Nintendo Entertainment System / Famicom' WHERE id = 13;
UPDATE platforms SET display_name = 'Super Nintendo Entertainment System / Super Famicom' WHERE id = 15;

-- Standardize Launch Dates to Earliest Regional Launch Date Globally
UPDATE platforms SET launch_date = '1983-07-15' WHERE id = 13; -- Famicom (JP)
UPDATE platforms SET launch_date = '1989-04-21' WHERE id = 14; -- Game Boy (JP)
UPDATE platforms SET launch_date = '1990-11-21' WHERE id = 15; -- Super Famicom (JP)
UPDATE platforms SET launch_date = '1995-07-21' WHERE id = 16; -- Virtual Boy (JP)
UPDATE platforms SET launch_date = '1996-06-23' WHERE id = 17; -- Nintendo 64 (JP)
UPDATE platforms SET launch_date = '1998-10-21' WHERE id = 18; -- Game Boy Color (JP)
UPDATE platforms SET launch_date = '2001-03-21' WHERE id = 19; -- Game Boy Advance (JP)
UPDATE platforms SET launch_date = '2001-09-14' WHERE id = 20; -- GameCube (JP)
UPDATE platforms SET launch_date = '2011-02-26' WHERE id = 23; -- Nintendo 3DS (JP)
UPDATE platforms SET launch_date = '2014-10-11' WHERE id = 25; -- New Nintendo 3DS (JP)
UPDATE platforms SET launch_date = '1994-09-09' WHERE id = 10; -- Neo Geo CD (JP)
UPDATE platforms SET launch_date = '1999-03-19' WHERE id = 11; -- Neo Geo Pocket Color (JP)
UPDATE platforms SET launch_date = '1994-12-03' WHERE id = 29; -- PlayStation (JP)
UPDATE platforms SET launch_date = '2000-03-04' WHERE id = 30; -- PlayStation 2 (JP)
UPDATE platforms SET launch_date = '2004-12-12' WHERE id = 31; -- PlayStation Portable (JP)
UPDATE platforms SET launch_date = '2006-11-11' WHERE id = 32; -- PlayStation 3 (JP)
UPDATE platforms SET launch_date = '2011-12-17' WHERE id = 33; -- PlayStation Vita (JP)
UPDATE platforms SET launch_date = '1985-10-20' WHERE id = 36; -- Sega Master System / Mark III (JP)
UPDATE platforms SET launch_date = '1988-10-29' WHERE id = 37; -- Sega Genesis / Mega Drive (JP)
UPDATE platforms SET launch_date = '1990-10-06' WHERE id = 38; -- Sega Game Gear (JP)
UPDATE platforms SET launch_date = '1991-12-12' WHERE id = 39; -- Sega CD / Mega-CD (JP)
UPDATE platforms SET launch_date = '1993-06-26' WHERE id = 40; -- Sega Pico (JP)
UPDATE platforms SET launch_date = '1994-11-22' WHERE id = 42; -- Sega Saturn (JP)
UPDATE platforms SET launch_date = '1998-11-27' WHERE id = 43; -- Dreamcast (JP)
UPDATE platforms SET launch_date = '1987-10-30' WHERE id = 45; -- TurboGrafx-16 / PC Engine (JP)
UPDATE platforms SET launch_date = '1988-12-04' WHERE id = 46; -- TurboGrafx CD / CD-ROM² (JP)
