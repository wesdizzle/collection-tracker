/**
 * PRODUCTION CLOUDFLARE WORKER (TS)
 * 
 * This worker serves the Collection Tracker API and handles the routing
 * for the web application's static assets and dynamic metadata.
 */

export interface Env {
  DB: D1Database;
  ASSETS: { fetch: typeof fetch };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      /**
       * API ENDPOINTS
       */

      // Endpoint: GET /api/games
      // Fetches games with optional platform filtering and complex regional-aware sorting.
      if (path === '/api/games') {
        const platformId = url.searchParams.get('platform');
        const params: string[] = [];
        let query = `
            SELECT g.*, 
                   COALESCE(pp.display_name, p.display_name) as display_name, 
                   COALESCE(pp.brand, p.brand) as brand, 
                   COALESCE(pp.launch_date, p.launch_date) as platform_launch_date, 
                   COALESCE(pp.image_url, p.image_url) as platform_logo
            FROM games g 
            LEFT JOIN platforms p ON g.platform_id = p.id
            LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
            WHERE 1=1
        `;

        if (platformId) {
          query += ' AND (g.platform_id = ? OR p.parent_platform_id = ?)';
          params.push(platformId, platformId);
        }

        /**
         * COMPLEX ORDERING LOGIC (Pass 8):
         * 1. Brand (Nintendo, Sony)
         * 2. Platform Launch Date (NES before SNES, grouped by parent)
         * 3. Canonical Series (Lexicographical, prefix-aware)
         * 4. Game Release Date
         */
        query += ` ORDER BY COALESCE(pp.launch_date, p.launch_date) ASC, 
                   COALESCE(p.parent_platform_id, p.id) ASC, 
                   CASE WHEN g.canonical_series COLLATE NOCASE LIKE 'the %' THEN SUBSTR(g.canonical_series, 5) WHEN g.canonical_series COLLATE NOCASE LIKE 'a %' THEN SUBSTR(g.canonical_series, 3) ELSE g.canonical_series END COLLATE NOCASE ASC,
                   g.release_date ASC`;

        const stmt = env.DB.prepare(query).bind(...params);
        const { results } = await stmt.all();
        return Response.json(results);
      }

      // Endpoint: GET /api/games/:id
      else if (path.startsWith('/api/games/')) {
        const id = path.split('/').pop();
        const query = `
            SELECT g.*, p.display_name, p.brand, p.launch_date as platform_launch_date, p.image_url as platform_logo
            FROM games g 
            LEFT JOIN platforms p ON g.platform_id = p.id 
            WHERE g.id = ?
        `;
        const game = await env.DB.prepare(query).bind(id).first();
        if (!game) return Response.json({ error: 'Not found' }, { status: 404 });
        return Response.json(game);
      }

      // Endpoint: GET /api/figures
      else if (path === '/api/figures') {
        const query = `
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
        const { results } = await env.DB.prepare(query).all();
        return Response.json(results);
      }

      // Endpoint: GET /api/platforms
      else if (path === '/api/platforms') {
        const query = `
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
        const { results } = await env.DB.prepare(query).all();
        return Response.json(results);
      }

      /**
       * FALLBACK: Serve from Static Assets
       * This leverages the [assets] binding defined in wrangler.toml (Workers Assets v3)
       */
      return env.ASSETS.fetch(request);

    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Internal Server Error';
      console.error('Worker Error:', errorMessage);
      return Response.json({ error: errorMessage }, { status: 500 });
    }
  }
};
