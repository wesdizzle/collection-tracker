interface Env {
    DB: any;
}

export const onRequest: PagesFunction<Env> = async (context) => {
    try {
        const url = new URL(context.request.url);
        const platform = url.searchParams.get('platform');
        
        let query = `
            SELECT g.*, p.brand, p.launch_date as platform_launch_date 
            FROM games g 
            LEFT JOIN platforms p ON g.platform = p.name 
            WHERE 1=1
        `;
        const params = [];
        
        if (platform) {
            query += ` AND g.platform = ?`;
            params.push(platform);
        }
        
        query += ` ORDER BY p.brand COLLATE NOCASE ASC, p.launch_date ASC, g.platform COLLATE NOCASE ASC, 
                   CASE WHEN COALESCE(g.series, g.title) COLLATE NOCASE LIKE 'the %' THEN SUBSTR(COALESCE(g.series, g.title), 5) WHEN COALESCE(g.series, g.title) COLLATE NOCASE LIKE 'a %' THEN SUBSTR(COALESCE(g.series, g.title), 3) ELSE COALESCE(g.series, g.title) END COLLATE NOCASE ASC, 
                   g.release_date IS NULL ASC, g.release_date ASC, g.sort_index IS NULL ASC, g.sort_index ASC, 
                   CASE WHEN g.title COLLATE NOCASE LIKE 'the %' THEN SUBSTR(g.title, 5) WHEN g.title COLLATE NOCASE LIKE 'a %' THEN SUBSTR(g.title, 3) ELSE g.title END COLLATE NOCASE ASC`;
        
        const stmt = context.env.DB.prepare(query).bind(...params);
        const { results } = await stmt.all();
        
        return Response.json(results);
    } catch (e) {
        return Response.json({ error: e.message }, { status: 500 });
    }
};
