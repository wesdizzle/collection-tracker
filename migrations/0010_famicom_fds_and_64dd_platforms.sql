-- Migration: 0010_famicom_fds_and_64dd_platforms.sql
-- Description: Merges Famicom under NES and adds Famicom Disk System and Nintendo 64DD to the platform catalog.

UPDATE platforms SET igdb_id = 99, parent_platform_id = 13 WHERE id = 53;

INSERT OR IGNORE INTO platforms (id, name, brand, launch_date, image_url, description, display_name, igdb_id, parent_platform_id) VALUES
  (54, 'Famicom Disk System', 'Nintendo', '1986-02-21', NULL, NULL, 'Famicom Disk System', 51, NULL),
  (55, 'Nintendo 64DD', 'Nintendo', '1999-12-01', NULL, NULL, 'Nintendo 64DD', 416, NULL);
