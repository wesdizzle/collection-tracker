/**
 * PRODUCTION CLOUDFLARE WORKER (TS)
 * 
 * This worker serves the Collection Tracker API and handles the routing
 * for the web application's static assets and dynamic metadata.
 */

import { 
  GAMES_LIST_QUERY, 
  GAME_DETAIL_QUERY, 
  PLATFORMS_LIST_QUERY, 
  FIGURES_LIST_QUERY, 
  FIGURE_DETAIL_QUERY,
  GAMES_ORDER_BY 
} from '../scripts/lib/queries';

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
        let query = GAMES_LIST_QUERY;

        if (platformId) {
          query += ' AND (g.platform_id = ? OR p.parent_platform_id = ?)';
          params.push(platformId, platformId);
        }

        query += GAMES_ORDER_BY;

        const { results } = await env.DB.prepare(query).bind(...params).all();
        return Response.json(results);
      }

      // Endpoint: GET /api/games/:id
      else if (path.startsWith('/api/games/')) {
        const id = path.split('/').pop();
        const query = GAME_DETAIL_QUERY;
        const game = await env.DB.prepare(query).bind(id).first();
        if (!game) return Response.json({ error: 'Not found' }, { status: 404 });
        return Response.json(game);
      }

      // Endpoint: GET /api/figures
      else if (path === '/api/figures') {
        const query = FIGURES_LIST_QUERY;
        const { results } = await env.DB.prepare(query).all();
        return Response.json(results);
      }

      // Endpoint: GET /api/figures/:id
      else if (path.startsWith('/api/figures/')) {
        const id = path.split('/').pop();
        const query = FIGURE_DETAIL_QUERY;
        const figure = await env.DB.prepare(query).bind(id).first();
        if (!figure) return Response.json({ error: 'Not found' }, { status: 404 });
        return Response.json(figure);
      }

      // Endpoint: GET /api/platforms
      else if (path === '/api/platforms') {
        const query = PLATFORMS_LIST_QUERY;
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
