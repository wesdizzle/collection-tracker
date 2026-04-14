import { D1Database } from '@cloudflare/workers-types';

export interface Env {
  DB: D1Database;
  ASSETS: { fetch: (req: Request | string) => Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/api/games') {
        const platformId = url.searchParams.get('platform_id');
        let query = `
            SELECT g.*, p.display_name, p.brand, p.launch_date as platform_launch_date 
            FROM games g 
            LEFT JOIN platforms p ON g.platform_id = p.id 
            WHERE 1=1
        `;
        const params: any[] = [];
        if (platformId) {
            // Include children (accessories) if the selected platform is a parent
            query += ` AND (g.platform_id = ? OR p.parent_platform_id = ?)`;
            params.push(platformId, platformId);
        }
        query += ` ORDER BY p.brand COLLATE NOCASE ASC, COALESCE(p.parent_platform_id, p.id) ASC, p.launch_date ASC, g.platform_id ASC, 
                   CASE WHEN COALESCE(g.series, g.title) COLLATE NOCASE LIKE 'the %' THEN SUBSTR(COALESCE(g.series, g.title), 5) WHEN COALESCE(g.series, g.title) COLLATE NOCASE LIKE 'a %' THEN SUBSTR(COALESCE(g.series, g.title), 3) ELSE COALESCE(g.series, g.title) END COLLATE NOCASE ASC, 
                   g.release_date IS NULL ASC, g.release_date ASC, g.sort_index IS NULL ASC, g.sort_index ASC, 
                   CASE WHEN g.title COLLATE NOCASE LIKE 'the %' THEN SUBSTR(g.title, 5) WHEN g.title COLLATE NOCASE LIKE 'a %' THEN SUBSTR(g.title, 3) ELSE g.title END COLLATE NOCASE ASC`;
        
        const stmt = env.DB.prepare(query).bind(...params);
        const { results } = await stmt.all();
        return Response.json(results);
      }
      
      else if (path.startsWith('/api/games/')) {
        const id = path.split('/').pop();
        const query = `
            SELECT g.*, p.display_name, p.brand, p.launch_date as platform_launch_date 
            FROM games g 
            LEFT JOIN platforms p ON g.platform_id = p.id 
            WHERE g.id = ?
        `;
        const stmt = env.DB.prepare(query).bind(id);
        const game = await stmt.first();
        if (!game) return Response.json({ error: 'Not found' }, { status: 404 });
        return Response.json(game);
      }
      
      else if (path === '/api/figures') {
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
        const stmt = env.DB.prepare(query);
        const { results } = await stmt.all();
        return Response.json(results);
      }
      
      else if (path.startsWith('/api/figures/')) {
        const id = path.split('/').pop();
        const query = `
            SELECT f.*, fs.line as series_line, fs.name as series_name, fs.sort_index as series_index
            FROM figures f
            LEFT JOIN figure_series fs ON f.series_id = fs.id
            WHERE f.id = ?
        `;
        const stmt = env.DB.prepare(query).bind(id);
        const figure = await stmt.first();
        if (!figure) return Response.json({ error: 'Not found' }, { status: 404 });
        return Response.json(figure);
      }
      
      else if (path === '/api/platforms') {
        const query = `
          SELECT p.* FROM platforms p 
          WHERE EXISTS (
            SELECT 1 FROM games g 
            WHERE g.platform_id = p.id 
            OR g.platform_id IN (SELECT id FROM platforms WHERE parent_platform_id = p.id)
          )
          ORDER BY brand ASC, COALESCE(parent_platform_id, id) ASC, launch_date ASC
        `;
        const stmt = env.DB.prepare(query);
        const { results } = await stmt.all();
        return Response.json(results);
      }

      // Non-API Routes: Serve from Static Assets
      // This implicitly proxies exactly what Cloudflare Pages did for the Angular SPA!
      return env.ASSETS.fetch(request);

    } catch (e: any) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }
};
