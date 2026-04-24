/**
 * SHARED SQL QUERIES
 * 
 * These templates are used by both the Cloudflare Worker (D1) and the 
 * Local API Server (better-sqlite3). Centralizing these prevents 
 * logic drift between production and development environments.
 */

export const GAMES_LIST_QUERY = `
    SELECT g.*, 
           COALESCE(pp.display_name, p.display_name) as display_name, 
           COALESCE(pp.brand, p.brand) as brand, 
           COALESCE(pp.launch_date, p.launch_date) as platform_launch_date, 
           COALESCE(pp.image_url, p.image_url) as platform_logo,
           p.parent_platform_id
    FROM games g 
    LEFT JOIN platforms p ON g.platform_id = p.id
    LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
    WHERE 1=1
`;

export const GAME_DETAIL_QUERY = `
    SELECT g.*, 
           COALESCE(pp.display_name, p.display_name) as display_name, 
           COALESCE(pp.brand, p.brand) as brand, 
           COALESCE(pp.launch_date, p.launch_date) as platform_launch_date, 
           COALESCE(pp.image_url, p.image_url) as platform_logo,
           p.parent_platform_id
    FROM games g 
    LEFT JOIN platforms p ON g.platform_id = p.id 
    LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
    WHERE g.id = ?
`;

export const PLATFORMS_LIST_QUERY = `
    SELECT p.* FROM platforms p 
    LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
    WHERE EXISTS (
        SELECT 1 FROM games g 
        WHERE g.platform_id = p.id 
        OR g.platform_id IN (SELECT id FROM platforms WHERE parent_platform_id = p.id)
    )
    AND p.parent_platform_id IS NULL
    ORDER BY COALESCE(pp.launch_date, p.launch_date) ASC, COALESCE(p.parent_platform_id, p.id) ASC
`;

export const TOYS_LIST_QUERY = `
    SELECT f.*, fs.line as series_line, fs.name as series_name, fs.sort_index as series_index
    FROM toys f
    LEFT JOIN toy_series fs ON f.series_id = fs.id
    ORDER BY 
             CASE WHEN fs.line COLLATE NOCASE LIKE 'the %' THEN SUBSTR(fs.line, 5) WHEN fs.line COLLATE NOCASE LIKE 'a %' THEN SUBSTR(fs.line, 3) ELSE fs.line END COLLATE NOCASE ASC, 
             fs.sort_index IS NULL ASC, fs.sort_index ASC, 
             CASE WHEN fs.name COLLATE NOCASE LIKE 'the %' THEN SUBSTR(fs.name, 5) WHEN fs.name COLLATE NOCASE LIKE 'a %' THEN SUBSTR(fs.name, 3) ELSE fs.name END COLLATE NOCASE ASC, 
             f.release_date IS NULL ASC, f.release_date ASC, 
             f.sort_index IS NULL ASC, f.sort_index ASC, 
             CASE WHEN f.name COLLATE NOCASE LIKE 'the %' THEN SUBSTR(f.name, 5) WHEN f.name COLLATE NOCASE LIKE 'a %' THEN SUBSTR(f.name, 3) ELSE f.name END COLLATE NOCASE ASC
`;

export const TOY_DETAIL_QUERY = `
    SELECT f.*, fs.line as series_line, fs.name as series_name, fs.sort_index as series_index
    FROM toys f
    LEFT JOIN toy_series fs ON f.series_id = fs.id
    WHERE f.id = ?
`;

/**
 * Common Sorters and Filters can also be added here if they share SQL syntax.
 */
export const GAMES_ORDER_BY = `
    ORDER BY COALESCE(pp.launch_date, p.launch_date) ASC, 
             COALESCE(p.parent_platform_id, p.id) ASC, 
             g.platform_id ASC, 
             CASE WHEN COALESCE(g.canonical_series, g.title) COLLATE NOCASE LIKE 'the %' THEN SUBSTR(COALESCE(g.canonical_series, g.title), 5) WHEN COALESCE(g.canonical_series, g.title) COLLATE NOCASE LIKE 'a %' THEN SUBSTR(COALESCE(g.canonical_series, g.title), 3) ELSE COALESCE(g.canonical_series, g.title) END COLLATE NOCASE ASC, 
             g.release_date IS NULL ASC, g.release_date ASC, g.sort_index IS NULL ASC, g.sort_index ASC, 
             CASE WHEN g.title COLLATE NOCASE LIKE 'the %' THEN SUBSTR(g.title, 5) WHEN g.title COLLATE NOCASE LIKE 'a %' THEN SUBSTR(g.title, 3) ELSE g.title END COLLATE NOCASE ASC
`;
