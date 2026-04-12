interface Env {
    DB: any;
}

export const onRequest: PagesFunction<Env> = async (context) => {
    try {
        let query = `
            SELECT f.*, fs.line as series_line, fs.name as series_name, fs.sort_index as series_index
            FROM figures f
            LEFT JOIN figure_series fs ON f.series_id = fs.id
            ORDER BY 
                     CASE WHEN fs.line COLLATE NOCASE LIKE 'the %' THEN SUBSTR(fs.line, 5) WHEN fs.line COLLATE NOCASE LIKE 'a %' THEN SUBSTR(fs.line, 3) ELSE fs.line END COLLATE NOCASE ASC, 
                     fs.sort_index IS NULL ASC, fs.sort_index ASC, 
                     CASE WHEN fs.name COLLATE NOCASE LIKE 'the %' THEN SUBSTR(fs.name, 5) WHEN fs.name COLLATE NOCASE LIKE 'a %' THEN SUBSTR(fs.name, 3) ELSE fs.name END COLLATE NOCASE ASC, 
                     f.release_date IS NULL ASC, f.release_date ASC, 
                     f.sort_index IS NULL ASC, f.sort_index ASC, 
                     CASE WHEN f.name COLLATE NOCASE LIKE 'the %' THEN SUBSTR(f.name, 5) WHEN f.name COLLATE NOCASE LIKE 'a %' THEN SUBSTR(f.name, 3) ELSE f.name END COLLATE NOCASE ASC
        `;
        const stmt = context.env.DB.prepare(query);
        const { results } = await stmt.all();
        
        return Response.json(results);
    } catch (e) {
        return Response.json({ error: e.message }, { status: 500 });
    }
};
