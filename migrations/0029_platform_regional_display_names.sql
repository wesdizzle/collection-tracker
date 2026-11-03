-- Migration: 0029_platform_regional_display_names.sql
-- Description: Standardize regional platform display labels for Genesis / Mega Drive, TurboGrafx-16 / PC Engine, etc.

UPDATE platforms SET display_name = 'Genesis / Mega Drive' WHERE id = 37;
UPDATE platforms SET display_name = 'TurboGrafx-16 / PC Engine' WHERE id = 45;
UPDATE platforms SET display_name = 'TurboGrafx CD / PC Engine CD' WHERE id = 46;
UPDATE platforms SET display_name = 'Sega CD / Mega-CD' WHERE id = 39;
