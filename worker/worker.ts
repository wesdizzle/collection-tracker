/**
 * PRODUCTION CLOUDFLARE WORKER
 * 
 * This worker acts as the edge API and static asset server for the collection 
 * tracker. It provides a thin, highly performant layer over Cloudflare D1.
 * 
 * ARCHITECTURAL DESIGN:
 * 1. **Centralized Query Sharing**: Imports SQL constants from `../scripts/lib/queries` 
 *    to ensure that the local development server (better-sqlite3) and the 
 *    production edge (D1) share identical logic, preventing query drift.
 * 2. **Workers Assets Integration**: Implements a 'fallback-to-assets' pattern 
 *    using the `env.ASSETS` binding. This allows for a single deployment 
 *    target where the API and the Angular SPA coexist seamlessly.
 * 3. **Stateless Edge Computing**: Uses the D1 binding directly, avoiding the 
 *    need for a traditional backend server and ensuring global latency 
 *    optimization for metadata retrieval.
 * 4. **Regional-Awareness**: The `GAMES_ORDER_BY` logic (shared from queries) 
 *    is applied at the edge to ensure consistent cross-regional sorting for 
 *    international collectors.
 */

import { 
  GAMES_LIST_QUERY, 
  GAME_DETAIL_QUERY, 
  PLATFORMS_LIST_QUERY, 
  TOYS_LIST_QUERY, 
  TOY_DETAIL_QUERY,
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

      // Endpoint: GET /api/toys
      else if (path === '/api/toys') {
        const query = TOYS_LIST_QUERY;
        const { results } = await env.DB.prepare(query).all();
        return Response.json(results);
      }

      // Endpoint: GET /api/toys/:id
      else if (path.startsWith('/api/toys/')) {
        const id = path.split('/').pop();
        const query = TOY_DETAIL_QUERY;
        const toy = await env.DB.prepare(query).bind(id).first();
        if (!toy) return Response.json({ error: 'Not found' }, { status: 404 });
        return Response.json(toy);
      }

      // Endpoint: GET /api/platforms
      else if (path === '/api/platforms') {
        const query = PLATFORMS_LIST_QUERY;
        const { results } = await env.DB.prepare(query).all();
        return Response.json(results);
      }

      // Endpoint: POST /api/discovery/apply
      else if (request.method === 'POST' && path === '/api/discovery/apply') {
        const payload = await request.json() as { currentTitle: string, currentPlatform: string, selectedIgdbId: string | number, selectedName: string, selectedPlatform?: string, region?: string, summary?: string, imageUrl?: string };
        const { currentTitle, currentPlatform, selectedIgdbId, selectedName, selectedPlatform, region, summary, imageUrl } = payload;
        const isToy = selectedIgdbId.toString().startsWith('amiibo-');

        if (isToy) {
          const amiiboId = selectedIgdbId.toString().replace('amiibo-', '');
          // Note: In production worker, we use the metadata passed in the payload
          // because we don't necessarily have AmiiboAPI/IGDB auth secrets configured at the edge.
          await env.DB.prepare(`
            UPDATE toys 
            SET amiibo_id = ?, name = ?, region = ?, verified = 1, metadata_json = ?, image_url = COALESCE(?, image_url)
            WHERE name = ? AND line = 'amiibo'
          `).bind(amiiboId, selectedName, region || 'NA', JSON.stringify(payload), imageUrl || null, currentTitle).run();
        } else {
          const finalIgdbId = selectedIgdbId.toString().replace('igdb-', '');
          
          // Find the game
          const game = await env.DB.prepare(`
            SELECT g.stable_id FROM games g
            JOIN platforms p ON g.platform_id = p.id
            WHERE (g.title = ? OR g.title = ?) AND p.display_name = ?
          `).bind(currentTitle, selectedName, currentPlatform).first() as { stable_id: number } | null;

          if (game) {
            let finalPlatformId = null;
            if (selectedPlatform && selectedPlatform !== currentPlatform) {
              const platform = await env.DB.prepare('SELECT id FROM platforms WHERE display_name = ?').bind(selectedPlatform).first() as { id: number } | null;
              if (platform) finalPlatformId = platform.id;
            }

            const slugify = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            const newId = `${slugify(selectedName)}-${slugify(selectedPlatform || currentPlatform)}`;

            await env.DB.prepare(`
              UPDATE games 
              SET id = ?, title = ?, platform_id = COALESCE(?, platform_id), igdb_id = ?, region = ?, summary = ?, image_url = ?, genres = ?, verified = 1
              WHERE stable_id = ?
            `).bind(newId, selectedName, finalPlatformId, finalIgdbId, region || 'NA', summary || null, imageUrl || null, null, game.stable_id).run();
          }
        }

        return Response.json({ success: true });
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
