/**
 * PRODUCTION CLOUDFLARE WORKER
 *
 * This worker acts as the edge API, static asset server, and automated backup engine
 * for the Gagglog Collection Tracker.
 *
 * ARCHITECTURAL DESIGN:
 * 1. **Centralized Query Sharing**: Imports SQL constants from `../scripts/lib/queries`
 *    to ensure query consistency between environments.
 * 2. **Workers Assets Integration**: Seamlessly serves the Angular SPA via `env.ASSETS` fallback.
 * 3. **Role-Based Edge Authentication**: Gates mutation endpoints (`/api/collection/toggle`,
 *    `/api/collection/sort`, `/api/discovery/apply`) behind Cloudflare Access identity validation
 *    (`Cf-Access-Authenticated-User-Email` matching `env.ADMIN_EMAIL` or Cloudflare Access policy) while public browsing is uninhibited.
 * 4. **Automated R2 Snapshots**: Implements a `scheduled` cron handler that automatically dumps
 *    all D1 tables into structured, timestamped JSON backups in Cloudflare R2 indefinitely.
 */

import {
  GAMES_LIST_QUERY,
  GAME_DETAIL_QUERY,
  GAME_RELEASES_BY_GAME_ID_QUERY,
  PLATFORMS_LIST_QUERY,
  TOYS_LIST_QUERY,
  TOY_DETAIL_QUERY,
  GAMES_ORDER_BY,
  getRomGroupingKey,
} from '../scripts/lib/queries';

export interface Env {
  DB: D1Database;
  ASSETS: { fetch: typeof fetch };
  BACKUP_BUCKET?: R2Bucket;
  ADMIN_EMAIL?: string;
  ADMIN_KEY?: string;
}

interface DbGame {
  stable_id: number;
  id: string;
  region?: string | null;
  variants?: string | null;
  rom_name?: string | null;
  rom_crc?: string | null;
  backup_status?: number;
  ownership_status?: number;
  release_date?: string | null;
  releases?: unknown[];
}

/**
 * Validates whether the incoming request is authorized to execute mutation actions.
 * Supports Cloudflare Access (Cf-Access-Authenticated-User-Email header), custom admin key,
 * and localhost bypass during local testing.
 *
 * @param request The incoming HTTP Request
 * @param env Cloudflare worker environment bindings
 * @returns true if authorized, false otherwise
 */
export function isAuthorizedAdmin(request: Request, env: Env): boolean {
  const url = new URL(request.url);
  const isLocalDev =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '0.0.0.0';
  if (isLocalDev) return true;

  // 1. Direct header injected by Cloudflare Access when route is in Zero Trust
  let accessEmail = request.headers.get('Cf-Access-Authenticated-User-Email');

  // 2. Fallback: Parse CF_Authorization cookie from browser session
  if (!accessEmail) {
    const cookieHeader = request.headers.get('Cookie') || '';
    const cookies = Object.fromEntries(
      cookieHeader
        .split(';')
        .map((c) => {
          const idx = c.indexOf('=');
          if (idx === -1) return ['', ''];
          return [c.slice(0, idx).trim(), c.slice(idx + 1).trim()];
        })
        .filter(([k]) => !!k),
    );

    const jwt =
      cookies['CF_Authorization'] ||
      request.headers.get('Cf-Access-Jwt-Assertion');

    if (jwt && jwt.includes('.')) {
      try {
        const parts = jwt.split('.');
        if (parts.length >= 2) {
          let payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
          while (payloadBase64.length % 4 !== 0) {
            payloadBase64 += '=';
          }
          const decodedJson = atob(payloadBase64);
          const payload = JSON.parse(decodedJson) as {
            email?: string;
            sub?: string;
            exp?: number;
          };
          const now = Math.floor(Date.now() / 1000);
          const candidateEmail =
            payload.email ||
            (typeof payload.sub === 'string' && payload.sub.includes('@')
              ? payload.sub
              : undefined);
          if (payload.exp && payload.exp > now && candidateEmail) {
            accessEmail = candidateEmail;
          }
        }
      } catch (err) {
        console.warn(
          '[isAuthorizedAdmin] Failed to parse CF_Authorization cookie:',
          err,
        );
      }
    }
  }

  if (accessEmail) {
    if (env.ADMIN_EMAIL) {
      return accessEmail.toLowerCase() === env.ADMIN_EMAIL.toLowerCase();
    }
    // If ADMIN_EMAIL is not explicitly set, trust the Cloudflare Access authenticated email
    return true;
  }

  const adminKey = request.headers.get('x-admin-key');
  if (env.ADMIN_KEY && adminKey && adminKey === env.ADMIN_KEY) {
    return true;
  }

  return false;
}

/**
 * Dumps all tables from D1 and writes an immutable snapshot to Cloudflare R2.
 *
 * @param env Cloudflare worker environment bindings
 * @returns Summary object containing table counts and written snapshot key
 */
export async function performScheduledBackup(
  env: Env,
): Promise<{ key: string; rowCount: number }> {
  if (!env.BACKUP_BUCKET) {
    console.warn(
      '[WorkerBackup] BACKUP_BUCKET binding not configured. Skipping snapshot.',
    );
    return { key: 'none', rowCount: 0 };
  }

  const tables = [
    'platforms',
    'toy_series',
    'ignored_items',
    'games',
    'toys',
    'toy_game_compatibility',
    'game_releases',
  ];

  const backupData: Record<string, unknown[]> = {};
  let totalRows = 0;

  for (const table of tables) {
    try {
      const { results } = await env.DB.prepare(`SELECT * FROM ${table}`).all();
      backupData[table] = results || [];
      totalRows += (results || []).length;
    } catch (err) {
      console.error(`[WorkerBackup] Failed to dump table ${table}:`, err);
      backupData[table] = [];
    }
  }

  const now = new Date();
  const timestamp = now.toISOString();
  const dateStr = timestamp.slice(0, 10);

  const payload = JSON.stringify(
    {
      metadata: {
        timestamp,
        date: dateStr,
        version: 1,
        totalRows,
        tableCounts: Object.fromEntries(
          Object.entries(backupData).map(([tbl, rows]) => [tbl, rows.length]),
        ),
      },
      tables: backupData,
    },
    null,
    2,
  );

  const snapshotKey = `snapshots/backup-${dateStr}-${now.getTime()}.json`;
  const latestKey = 'snapshots/latest.json';

  await env.BACKUP_BUCKET.put(snapshotKey, payload, {
    httpMetadata: { contentType: 'application/json' },
  });

  await env.BACKUP_BUCKET.put(latestKey, payload, {
    httpMetadata: { contentType: 'application/json' },
  });

  console.log(
    `[WorkerBackup] Successfully saved daily snapshot ${snapshotKey} (${totalRows} rows)`,
  );

  return { key: snapshotKey, rowCount: totalRows };
}

export default {
  /**
   * Main fetch router handling edge API requests and falling back to static SPA assets.
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers':
            'Content-Type, Authorization, Cf-Access-Authenticated-User-Email, Cf-Access-Jwt-Assertion',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    try {
      /**
       * PUBLIC READ-ONLY API ENDPOINTS
       */

      // Endpoint: GET /api/games
      if (path === '/api/games') {
        const platformId = url.searchParams.get('platform');
        const params: string[] = [];
        let query = GAMES_LIST_QUERY;

        if (platformId) {
          query += ' AND (g.platform_id = ? OR p.parent_platform_id = ?)';
          params.push(platformId, platformId);
        }

        query += GAMES_ORDER_BY;

        const { results } = await env.DB.prepare(query)
          .bind(...params)
          .all();
        return Response.json(results);
      }

      // Endpoint: GET /api/games/:id
      else if (path.startsWith('/api/games/')) {
        const id = path.split('/').pop();
        const query = GAME_DETAIL_QUERY;
        let game = (await env.DB.prepare(query)
          .bind(id, id)
          .first()) as DbGame | null;
        if (!game) {
          const gameBySlug = (await env.DB.prepare(
            `
            SELECT g.id as game_id, g.stable_id, COALESCE(r.id, g.id) as id
            FROM games g
            LEFT JOIN game_releases r ON g.stable_id = r.game_id
            WHERE g.id = ?
            LIMIT 1
          `,
          )
            .bind(id)
            .first()) as { id: string } | null;

          if (gameBySlug) {
            game = (await env.DB.prepare(query)
              .bind(gameBySlug.id, gameBySlug.id)
              .first()) as DbGame | null;
          }
        }

        if (!game)
          return Response.json({ error: 'Not found' }, { status: 404 });

        if (game.rom_name) {
          const { results } = await env.DB.prepare(
            GAME_RELEASES_BY_GAME_ID_QUERY,
          )
            .bind(game.stable_id, game.region, game.variants)
            .all();
          const targetKey = getRomGroupingKey(game.rom_name);
          const typedResults = (results || []) as {
            rom_name?: string | null;
          }[];
          game.releases = typedResults.filter(
            (r) => getRomGroupingKey(r.rom_name) === targetKey,
          );
        } else {
          game.releases = [
            {
              id: game.id,
              game_id: game.stable_id,
              region: game.region || null,
              variants: game.variants || null,
              rom_name: game.rom_name || null,
              rom_crc: game.rom_crc || null,
              backup_status: game.backup_status || 0,
              ownership_status: game.ownership_status || 0,
              release_date: game.release_date || null,
            },
          ];
        }

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

      // Endpoint: GET /api/discovery
      else if (path === '/api/discovery') {
        return Response.json([]);
      }

      // Endpoint: GET /api/admin/login or GET /admin/login or /cdn-cgi/access/authorized
      // Provides a direct browser navigation entry point to trigger Cloudflare Access login
      else if (
        path === '/api/admin/login' ||
        path === '/admin/login' ||
        path.startsWith('/cdn-cgi/access/authorized')
      ) {
        return new Response(
          `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Admin Authenticated</title>
  <meta http-equiv="refresh" content="0; url=/collection/games">
</head>
<body style="background:#130b24;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
  <p>Authenticated. Redirecting to collection...</p>
  <script>window.location.replace('/collection/games');</script>
</body>
</html>`,
          {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-store, no-cache, must-revalidate',
            },
          },
        );
      }

      // Endpoint: GET /api/admin/me
      else if (path === '/api/admin/me') {
        const accessEmail = request.headers.get(
          'Cf-Access-Authenticated-User-Email',
        );
        const cookieHeader = request.headers.get('Cookie') || '';
        const hasCookie = cookieHeader.includes('CF_Authorization');
        const authorized = isAuthorizedAdmin(request, env);
        return Response.json({
          authenticated: authorized,
          authorized,
          hasCookie,
          email:
            accessEmail || (authorized ? env.ADMIN_EMAIL || 'admin' : null),
        });
      }

      /**
       * AUTHENTICATED MUTATION ENDPOINTS
       */

      // Endpoint: POST /api/collection/toggle
      else if (request.method === 'POST' && path === '/api/collection/toggle') {
        if (!isAuthorizedAdmin(request, env)) {
          return Response.json(
            { error: 'Unauthorized: Admin authentication required.' },
            { status: 403 },
          );
        }

        const body = (await request.json()) as {
          id: string;
          type: 'game' | 'toy';
          status: number;
          field?: string;
        };
        const { id, type, status, field = 'ownership_status' } = body;

        const allowedFields = [
          'ownership_status',
          'play_status',
          'backup_status',
        ];
        if (!allowedFields.includes(field)) {
          return Response.json(
            { error: `Invalid field: ${field}` },
            { status: 400 },
          );
        }

        if (type === 'game') {
          if (field === 'play_status') {
            let stableId: number | null = null;
            const release = (await env.DB.prepare(
              'SELECT game_id FROM game_releases WHERE id = ?',
            )
              .bind(id)
              .first()) as { game_id: number } | null;
            if (release) {
              stableId = release.game_id;
            } else {
              const game = (await env.DB.prepare(
                'SELECT stable_id FROM games WHERE id = ?',
              )
                .bind(id)
                .first()) as { stable_id: number } | null;
              if (game) stableId = game.stable_id;
            }

            if (stableId === null) {
              return Response.json(
                { error: `Could not find game/release with ID: ${id}` },
                { status: 404 },
              );
            }

            await env.DB.prepare(
              'UPDATE games SET play_status = ? WHERE stable_id = ?',
            )
              .bind(status, stableId)
              .run();
          } else {
            // ownership_status or backup_status on game_releases
            const release = (await env.DB.prepare(
              'SELECT game_id, region, variants, rom_name FROM game_releases WHERE id = ?',
            )
              .bind(id)
              .first()) as {
              game_id: number;
              region: string | null;
              variants: string | null;
              rom_name: string | null;
            } | null;

            if (release) {
              if (field === 'ownership_status') {
                const { results: allReleases } = await env.DB.prepare(
                  'SELECT id, region, variants, rom_name FROM game_releases WHERE game_id = ?',
                )
                  .bind(release.game_id)
                  .all();

                const targetKey = getRomGroupingKey(release.rom_name);
                const typedReleases = (allReleases || []) as {
                  id: string;
                  region: string | null;
                  variants: string | null;
                  rom_name: string | null;
                }[];

                const matchingReleases = typedReleases.filter(
                  (r) =>
                    r.region === release.region &&
                    r.variants === release.variants &&
                    getRomGroupingKey(r.rom_name) === targetKey,
                );

                const statements = matchingReleases.map((r) =>
                  env.DB.prepare(
                    'UPDATE game_releases SET ownership_status = ? WHERE id = ?',
                  ).bind(status, r.id),
                );
                if (statements.length > 0) {
                  await env.DB.batch(statements);
                }
              } else {
                await env.DB.prepare(
                  `UPDATE game_releases SET ${field} = ? WHERE id = ?`,
                )
                  .bind(status, id)
                  .run();
              }
            } else {
              const game = (await env.DB.prepare(
                'SELECT stable_id, region FROM games WHERE id = ?',
              )
                .bind(id)
                .first()) as {
                stable_id: number;
                region: string | null;
              } | null;

              if (!game) {
                return Response.json(
                  { error: `Game or Release not found: ${id}` },
                  { status: 404 },
                );
              }

              const { results: releases } = await env.DB.prepare(
                'SELECT id FROM game_releases WHERE game_id = ? ORDER BY id ASC',
              )
                .bind(game.stable_id)
                .all();

              const typedReleases = (releases || []) as { id: string }[];
              if (typedReleases.length > 0) {
                if (field === 'ownership_status') {
                  const statements = typedReleases.map((r) =>
                    env.DB.prepare(
                      'UPDATE game_releases SET ownership_status = ? WHERE id = ?',
                    ).bind(status, r.id),
                  );
                  await env.DB.batch(statements);
                } else {
                  await env.DB.prepare(
                    `UPDATE game_releases SET ${field} = ? WHERE id = ?`,
                  )
                    .bind(status, typedReleases[0].id)
                    .run();
                }
              } else {
                const releaseId = `${id}-default`;
                await env.DB.prepare(
                  `INSERT INTO game_releases (id, game_id, region, variants, rom_name, rom_crc, backup_status, ownership_status)
                   VALUES (?, ?, ?, NULL, NULL, NULL, 0, 0)`,
                )
                  .bind(releaseId, game.stable_id, game.region)
                  .run();

                await env.DB.prepare(
                  `UPDATE game_releases SET ${field} = ? WHERE id = ?`,
                )
                  .bind(status, releaseId)
                  .run();
              }
            }
          }
        } else {
          // Toys update
          await env.DB.prepare(`UPDATE toys SET ${field} = ? WHERE id = ?`)
            .bind(status, id)
            .run();
        }

        return Response.json({ success: true });
      }

      // Endpoint: POST /api/collection/sort
      else if (request.method === 'POST' && path === '/api/collection/sort') {
        if (!isAuthorizedAdmin(request, env)) {
          return Response.json(
            { error: 'Unauthorized: Admin authentication required.' },
            { status: 403 },
          );
        }

        const body = (await request.json()) as {
          id: string;
          type: 'game' | 'toy';
          sort_index: number;
        };
        const { id, type, sort_index } = body;

        if (type === 'game') {
          let stableId: number | null = null;
          const release = (await env.DB.prepare(
            'SELECT game_id FROM game_releases WHERE id = ?',
          )
            .bind(id)
            .first()) as { game_id: number } | null;
          if (release) {
            stableId = release.game_id;
          } else {
            const game = (await env.DB.prepare(
              'SELECT stable_id FROM games WHERE id = ?',
            )
              .bind(id)
              .first()) as { stable_id: number } | null;
            if (game) stableId = game.stable_id;
          }

          if (stableId === null) {
            return Response.json(
              { error: `Could not find game/release with ID: ${id}` },
              { status: 404 },
            );
          }

          await env.DB.prepare(
            'UPDATE games SET sort_index = ? WHERE stable_id = ?',
          )
            .bind(sort_index, stableId)
            .run();
        } else {
          await env.DB.prepare('UPDATE toys SET sort_index = ? WHERE id = ?')
            .bind(sort_index, id)
            .run();
        }

        return Response.json({ success: true });
      }

      // Endpoint: POST /api/discovery/apply
      else if (request.method === 'POST' && path === '/api/discovery/apply') {
        if (!isAuthorizedAdmin(request, env)) {
          return Response.json(
            { error: 'Unauthorized: Admin authentication required.' },
            { status: 403 },
          );
        }

        const payload = (await request.json()) as {
          currentTitle: string;
          currentPlatform: string;
          selectedIgdbId: string | number;
          selectedName: string;
          selectedPlatform?: string;
          region?: string;
          summary?: string;
          imageUrl?: string;
        };
        const {
          currentTitle,
          currentPlatform,
          selectedIgdbId,
          selectedName,
          selectedPlatform,
          region,
          summary,
          imageUrl,
        } = payload;
        const isToy = selectedIgdbId.toString().startsWith('amiibo-');

        if (isToy) {
          const amiiboId = selectedIgdbId.toString().replace('amiibo-', '');
          await env.DB.prepare(
            `
            UPDATE toys 
            SET amiibo_id = ?, name = ?, region = ?, verified = 1, metadata_json = ?, image_url = COALESCE(?, image_url)
            WHERE name = ? AND line = 'amiibo'
          `,
          )
            .bind(
              amiiboId,
              selectedName,
              region || 'NA',
              JSON.stringify(payload),
              imageUrl || null,
              currentTitle,
            )
            .run();
        } else {
          const finalIgdbId = selectedIgdbId.toString().replace('igdb-', '');

          const game = (await env.DB.prepare(
            `
            SELECT g.stable_id FROM games g
            JOIN platforms p ON g.platform_id = p.id
            WHERE (g.title = ? OR g.title = ?) AND p.display_name = ?
          `,
          )
            .bind(currentTitle, selectedName, currentPlatform)
            .first()) as { stable_id: number } | null;

          if (game) {
            let finalPlatformId = null;
            if (selectedPlatform && selectedPlatform !== currentPlatform) {
              const platform = (await env.DB.prepare(
                'SELECT id FROM platforms WHERE display_name = ?',
              )
                .bind(selectedPlatform)
                .first()) as { id: number } | null;
              if (platform) finalPlatformId = platform.id;
            }

            const slugify = (s: string) =>
              (s || '')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '');
            const newId = `${slugify(selectedName)}-${slugify(selectedPlatform || currentPlatform)}`;

            await env.DB.prepare(
              `
              UPDATE games 
              SET id = ?, title = ?, platform_id = COALESCE(?, platform_id), igdb_id = ?, region = ?, summary = ?, image_url = ?, genres = ?, manually_verified = 1
              WHERE stable_id = ?
            `,
            )
              .bind(
                newId,
                selectedName,
                finalPlatformId,
                finalIgdbId,
                region || 'NA',
                summary || null,
                imageUrl || null,
                null,
                game.stable_id,
              )
              .run();
          }
        }

        return Response.json({ success: true });
      }

      /**
       * FALLBACK: Serve from Static Assets
       */
      return env.ASSETS.fetch(request);
    } catch (e: unknown) {
      const errorMessage =
        e instanceof Error ? e.message : 'Internal Server Error';
      console.error('Worker Error:', errorMessage);
      return Response.json({ error: errorMessage }, { status: 500 });
    }
  },

  /**
   * Scheduled cron event handler invoked by Cloudflare to generate daily R2 backups.
   */
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    console.log('[WorkerCron] Executing scheduled daily snapshot backup...');
    await performScheduledBackup(env);
  },
};
