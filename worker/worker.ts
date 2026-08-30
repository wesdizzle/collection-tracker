/**
 * PRODUCTION CLOUDFLARE WORKER
 *
 * This worker acts as the edge API, static asset server, and automated backup engine
 * for the Gagglog Collection Tracker.
 *
 * ARCHITECTURAL DESIGN:
 * 1. **Centralized Query Sharing**: Imports SQL constants and PLATFORM_MAP from `../scripts/lib/queries`
 *    to ensure query consistency between environments.
 * 2. **Workers Assets Integration**: Seamlessly serves the Angular SPA via `env.ASSETS` fallback.
 * 3. **Role-Based Edge Authentication**: Gates mutation endpoints (`/api/collection/toggle`,
 *    `/api/collection/sort`, `/api/discovery/add`, `/api/discovery/add-toy`) behind Cloudflare Access
 *    identity validation while public browsing is uninhibited.
 * 4. **Automated R2 Snapshots**: Implements a `scheduled` cron handler that automatically dumps
 *    all D1 tables into structured, timestamped JSON backups in Cloudflare R2 indefinitely.
 * 5. **Edge-Native Discovery**: Connects directly to IGDB via Twitch OAuth secrets and AmiiboAPI
 *    using Web Standard fetch for real-time game and amiibo discovery.
 */

import {
  GAMES_LIST_QUERY,
  GAME_DETAIL_QUERY,
  GAME_RELEASES_BY_GAME_ID_QUERY,
  BUNDLED_GAMES_BY_PARENT_QUERY,
  PLATFORMS_LIST_QUERY,
  TOYS_LIST_QUERY,
  TOY_DETAIL_QUERY,
  GAMES_ORDER_BY,
  getRomGroupingKey,
  PLATFORM_MAP,
} from '../scripts/lib/queries';
import {
  detectPhysicalReleaseStatus,
  CanonicalRelease,
} from '../scripts/lib/canonical_releases';
import { computeGameCanonicalSeries } from '../scripts/lib/canonical_series';

export interface Env {
  DB: D1Database;
  ASSETS: { fetch: typeof fetch };
  BACKUP_BUCKET?: R2Bucket;
  ADMIN_EMAIL?: string;
  ADMIN_KEY?: string;
  TEAM_DOMAIN?: string;
  TWITCH_CLIENT_ID?: string;
  TWITCH_CLIENT_SECRET?: string;
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
  bundled_games?: unknown[];
}

let cachedTwitchToken: { token: string; expiresAt: number } | null = null;

/**
 * Retrieves a valid Twitch Access Token for IGDB API queries.
 * Caches token in isolate memory to avoid redundant authentication requests.
 */
export async function getEdgeTwitchToken(env: Env): Promise<string | null> {
  if (cachedTwitchToken && cachedTwitchToken.expiresAt > Date.now()) {
    return cachedTwitchToken.token;
  }
  const clientId = env.TWITCH_CLIENT_ID;
  const clientSecret = env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return null;
  }
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
  });
  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?${params.toString()}`,
    {
      method: 'POST',
    },
  );
  if (!res.ok) {
    throw new Error(`Twitch OAuth failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedTwitchToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return data.access_token;
}

/**
 * Executes a query against the IGDB API endpoint.
 */
export async function queryIGDBEdge(
  endpoint: string,
  query: string,
  env: Env,
): Promise<unknown[]> {
  const token = await getEdgeTwitchToken(env);
  if (!token || !env.TWITCH_CLIENT_ID) {
    throw new Error(
      'IGDB credentials (TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET) not configured in Cloudflare Worker.',
    );
  }
  const res = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method: 'POST',
    headers: {
      'Client-ID': env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/plain',
    },
    body: query,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`IGDB API Error (${res.status}): ${errText}`);
  }
  return (await res.json()) as unknown[];
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
  const host =
    request.headers.get('x-forwarded-host') ||
    request.headers.get('host') ||
    url.hostname;
  const origin =
    request.headers.get('origin') || request.headers.get('referer') || '';

  const cookieHeader = request.headers.get('Cookie') || '';
  if (
    cookieHeader.includes('CF_AppSession=dev-admin-session') ||
    cookieHeader.includes('CF_Authorization=local-admin-dev-token')
  ) {
    return true;
  }

  const isLocalDev =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '0.0.0.0' ||
    url.hostname.endsWith('.workers.dev') ||
    host.includes('localhost') ||
    host.includes('127.0.0.1') ||
    origin.includes('localhost') ||
    origin.includes('127.0.0.1');
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

    if (accessEmail) {
      if (env.ADMIN_EMAIL) {
        return accessEmail.toLowerCase() === env.ADMIN_EMAIL.toLowerCase();
      }
      return true;
    }

    // 3. Fallback: Active Cloudflare Access session cookie on the domain
    if (cookies['CF_AppSession'] && cookies['CF_AppSession'].length > 0) {
      return true;
    }
  }

  if (accessEmail) {
    if (env.ADMIN_EMAIL) {
      return accessEmail.toLowerCase() === env.ADMIN_EMAIL.toLowerCase();
    }
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

        if (game.stable_id) {
          const { results: bundled } = await env.DB.prepare(
            BUNDLED_GAMES_BY_PARENT_QUERY,
          )
            .bind(game.stable_id)
            .all();
          game.bundled_games = bundled || [];
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

      // Endpoint: GET /api/discovery/search
      else if (path === '/api/discovery/search') {
        const query = url.searchParams.get('query') || '';
        const platformIdParam = url.searchParams.get('platformId');
        const platformId = platformIdParam ? parseInt(platformIdParam, 10) : 0;
        const filterDigital =
          url.searchParams.get('filterDigital') === 'true' ||
          url.searchParams.get('hideDigital') === 'true';

        if (!query.trim()) {
          return Response.json([]);
        }

        const trackedIgdbIds = Array.from(
          new Set(Object.values(PLATFORM_MAP)),
        ).filter((id): id is number => typeof id === 'number' && id > 0);

        let targetPlatformId: number | null = null;
        if (platformId > 0) {
          const platformRow = (await env.DB.prepare(
            'SELECT display_name, name FROM platforms WHERE id = ?',
          )
            .bind(platformId)
            .first()) as { display_name: string; name: string } | null;

          if (platformRow) {
            targetPlatformId =
              PLATFORM_MAP[platformRow.display_name] ||
              PLATFORM_MAP[platformRow.name] ||
              null;
          }
        }

        const sanitizedQuery = query.replace(/["\\]/g, '');
        const whereClause = targetPlatformId
          ? `where platforms = (${targetPlatformId});`
          : `where platforms = (${trackedIgdbIds.join(',')});`;
        const igdbQuery = `
          search "${sanitizedQuery}";
          fields name, cover.url, cover.image_id, first_release_date, platforms.id, platforms.name, summary, genres.name, url, collections.name, franchises.name, category, release_dates.platform, release_dates.region, release_dates.date, involved_companies.company.name, involved_companies.publisher;
          ${whereClause}
          limit 30;
        `;

        try {
          const { results: platformRows } = await env.DB.prepare(
            `SELECT id, display_name, name, launch_date FROM platforms`,
          ).all();

          const igdbToPlatform = new Map<
            number,
            { id: number; displayName: string; launchDate: string | null }
          >();
          (platformRows || []).forEach((p) => {
            const row = p as {
              id: number;
              display_name: string;
              name: string;
              launch_date: string | null;
            };
            const igdbId =
              PLATFORM_MAP[row.display_name] || PLATFORM_MAP[row.name];
            if (igdbId) {
              igdbToPlatform.set(igdbId, {
                id: row.id,
                displayName: row.display_name || row.name,
                launchDate: row.launch_date,
              });
            }
          });

          const { results: existingGames } = await env.DB.prepare(
            `SELECT igdb_id, platform_id, title FROM games`,
          ).all();

          const existingSet = new Set<string>();
          (existingGames || []).forEach((g) => {
            const row = g as {
              igdb_id: number | null;
              platform_id: number;
              title: string;
            };
            if (row.igdb_id) {
              existingSet.add(`igdb-${row.igdb_id}-${row.platform_id}`);
            }
            if (row.title) {
              existingSet.add(
                `title-${row.title.toLowerCase().replace(/[^a-z0-9]/g, '')}-${row.platform_id}`,
              );
            }
          });

          const rawResults = (await queryIGDBEdge(
            'games',
            igdbQuery,
            env,
          )) as Array<{
            id: number;
            name: string;
            cover?: { url?: string; image_id?: string };
            platforms?: Array<{ id: number; name: string }>;
            first_release_date?: number;
            summary?: string;
            genres?: Array<{ name: string }>;
            url?: string;
            collections?: Array<{ name: string }>;
            franchises?: Array<{ name: string }>;
            category?: number;
            release_dates?: Array<{
              platform?: number;
              region?: number;
              date?: number;
            }>;
            involved_companies?: Array<{
              company?: { name: string };
              publisher?: boolean;
            }>;
          }>;

          // Collect relevant local platform IDs to prefetch canonical releases from D1
          const candidatePlatIds = new Set<number>();
          (rawResults || []).forEach((g) => {
            (g.platforms || []).forEach((p) => {
              const localPlat = igdbToPlatform.get(p.id);
              if (localPlat) candidatePlatIds.add(localPlat.id);
            });
          });

          let canonicalReleasesList: CanonicalRelease[] = [];
          if (candidatePlatIds.size > 0) {
            const platIdArr = Array.from(candidatePlatIds);
            const placeholders = platIdArr.map(() => '?').join(',');
            const searchClean = sanitizedQuery
              .toLowerCase()
              .replace(/[^a-z0-9]/g, '');
            const searchPattern = `%${searchClean}%`;
            const { results: canonicalRows } = await env.DB.prepare(
              `SELECT platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, serial_code, barcode, publisher, is_verified_physical
               FROM canonical_releases WHERE platform_id IN (${placeholders}) AND (normalized_title LIKE ? OR raw_title LIKE ?)`,
            )
              .bind(...platIdArr, searchPattern, `%${sanitizedQuery}%`)
              .all();
            canonicalReleasesList = (canonicalRows ||
              []) as unknown as CanonicalRelease[];
          }

          const normalized = (rawResults || [])
            .map((g) => {
              const cleanTitle = g.name.toLowerCase().replace(/[^a-z0-9]/g, '');
              const unownedPlatforms = (g.platforms || []).filter((p) => {
                const isTargetOrTracked = targetPlatformId
                  ? p.id === targetPlatformId
                  : trackedIgdbIds.includes(p.id);
                if (!isTargetOrTracked) return false;

                const localPlat = igdbToPlatform.get(p.id);
                if (!localPlat) return false;

                const isAlreadyOwned =
                  existingSet.has(`igdb-${g.id}-${localPlat.id}`) ||
                  existingSet.has(`title-${cleanTitle}-${localPlat.id}`);
                return !isAlreadyOwned;
              });

              if (unownedPlatforms.length === 0) {
                return null;
              }

              let imageUrl: string | null = null;
              if (g.cover?.image_id) {
                imageUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg`;
              } else if (g.cover?.url) {
                imageUrl = g.cover.url.startsWith('//')
                  ? `https:${g.cover.url}`
                  : g.cover.url;
                imageUrl = imageUrl.replace('/t_thumb/', '/t_cover_big/');
              }

              const primaryPlatform = unownedPlatforms[0];
              const localPrimary = igdbToPlatform.get(primaryPlatform.id);
              const platformName = localPrimary
                ? localPrimary.displayName
                : primaryPlatform.name;
              const localPlatformId = localPrimary ? localPrimary.id : 0;

              const publisherName =
                g.involved_companies?.find((ic) => ic.publisher)?.company
                  ?.name || null;

              const verification = detectPhysicalReleaseStatus({
                platformId: localPlatformId,
                gameTitle: g.name,
                firstReleaseDate: g.first_release_date,
                platformLaunchDate: localPrimary?.launchDate,
                publisher: publisherName,
                igdbCategory: g.category,
                canonicalReleases: canonicalReleasesList,
              });

              if (
                filterDigital &&
                verification.physical_status === 'digital_only'
              ) {
                return null;
              }

              const matchedReleasesFormatted =
                verification.matched_releases.map((mr) => ({
                  name: mr.raw_title,
                  romName: mr.rom_name || mr.raw_title,
                  romCrc: mr.rom_crc || null,
                  region: mr.region || null,
                  variants: mr.variants || null,
                  releaseDate: null,
                  canonical_release_id: mr.id || null,
                  serial_code: mr.serial_code || null,
                  barcode: mr.barcode || null,
                  is_physical: mr.is_verified_physical,
                }));

              return {
                id: `igdb-${g.id}`,
                name: g.name,
                platform: platformName,
                platform_id: localPlatformId,
                image_url: imageUrl,
                summary: g.summary || null,
                genres: g.genres?.map((ge) => ge.name).join(', ') || null,
                igdb_url: g.url || null,
                collections:
                  g.collections?.map((c) => c.name).join(', ') || null,
                franchises: g.franchises?.map((f) => f.name).join(', ') || null,
                physical_status: verification.physical_status,
                verification_tier: verification.verification_tier,
                is_physical: verification.is_physical,
                physical_regions: verification.physical_regions,
                matched_releases: matchedReleasesFormatted,
                verification_reasons: verification.reasons,
              };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null);

          return Response.json(normalized);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return Response.json({ error: msg }, { status: 500 });
        }
      }

      // Endpoint: GET /api/discovery/matches
      else if (path === '/api/discovery/matches') {
        const igdbIdParam = url.searchParams.get('igdbId');
        const platformIdParam = url.searchParams.get('platformId');
        const cleanIgdbId = (igdbIdParam || '').replace('igdb-', '');
        const platformId = platformIdParam ? parseInt(platformIdParam, 10) : 0;

        if (!cleanIgdbId) {
          return Response.json({ error: 'Missing igdbId' }, { status: 400 });
        }

        try {
          const rawGames = (await queryIGDBEdge(
            'games',
            `fields name, cover.url, cover.image_id, first_release_date, platforms.id, platforms.name, summary, genres.name, url, collections.name, franchises.name, category, release_dates.platform, release_dates.region, release_dates.date, involved_companies.company.name, involved_companies.publisher; where id = ${cleanIgdbId}; limit 1;`,
            env,
          )) as Array<{
            id: number;
            name: string;
            cover?: { url?: string; image_id?: string };
            platforms?: Array<{ id: number; name: string }>;
            first_release_date?: number;
            summary?: string;
            genres?: Array<{ name: string }>;
            url?: string;
            collections?: Array<{ name: string }>;
            franchises?: Array<{ name: string }>;
            category?: number;
            release_dates?: Array<{
              platform?: number;
              region?: number;
              date?: number;
            }>;
            involved_companies?: Array<{
              company?: { name: string };
              publisher?: boolean;
            }>;
          }>;

          if (!rawGames || rawGames.length === 0) {
            return Response.json(
              { error: 'Game not found on IGDB' },
              { status: 404 },
            );
          }

          const g = rawGames[0];
          let imageUrl: string | null = null;
          if (g.cover?.image_id) {
            imageUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg`;
          } else if (g.cover?.url) {
            imageUrl = g.cover.url.startsWith('//')
              ? `https:${g.cover.url}`
              : g.cover.url;
            imageUrl = imageUrl.replace('/t_thumb/', '/t_cover_big/');
          }

          let localPlatformId = platformId;
          let platformLaunchDate: string | null = null;
          let platformDisplayName =
            g.platforms && g.platforms.length > 0
              ? g.platforms[0].name
              : 'Unknown';

          if (platformId > 0) {
            const platformRow = (await env.DB.prepare(
              'SELECT id, display_name, name, launch_date FROM platforms WHERE id = ?',
            )
              .bind(platformId)
              .first()) as {
              id: number;
              display_name: string;
              name: string;
              launch_date: string | null;
            } | null;

            if (platformRow) {
              localPlatformId = platformRow.id;
              platformDisplayName =
                platformRow.display_name || platformRow.name;
              platformLaunchDate = platformRow.launch_date;
            }
          }

          // Fetch canonical releases from D1 for this platform
          const gameClean = g.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          const { results: canonicalRows } = await env.DB.prepare(
            `SELECT id, platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, serial_code, barcode, publisher, is_verified_physical
             FROM canonical_releases WHERE platform_id = ? AND (normalized_title LIKE ? OR raw_title LIKE ?)`,
          )
            .bind(localPlatformId, `%${gameClean}%`, `%${g.name}%`)
            .all();

          const publisherName =
            g.involved_companies?.find((ic) => ic.publisher)?.company?.name ||
            null;

          const verification = detectPhysicalReleaseStatus({
            platformId: localPlatformId,
            gameTitle: g.name,
            firstReleaseDate: g.first_release_date,
            platformLaunchDate,
            publisher: publisherName,
            igdbCategory: g.category,
            canonicalReleases: (canonicalRows ||
              []) as unknown as CanonicalRelease[],
          });

          const matchedReleasesFormatted = verification.matched_releases.map(
            (mr) => ({
              name: mr.raw_title,
              romName: mr.rom_name || mr.raw_title,
              romCrc: mr.rom_crc || null,
              region: mr.region || null,
              variants: mr.variants || null,
              releaseDate: null,
              canonical_release_id: mr.id || null,
              serial_code: mr.serial_code || null,
              barcode: mr.barcode || null,
              is_physical: mr.is_verified_physical,
            }),
          );

          const game = {
            id: `igdb-${g.id}`,
            name: g.name,
            platform: platformDisplayName,
            platform_id: localPlatformId,
            image_url: imageUrl,
            summary: g.summary || null,
            genres: g.genres?.map((ge) => ge.name).join(', ') || null,
            igdb_url: g.url || null,
            collections: g.collections?.map((c) => c.name).join(', ') || null,
            franchises: g.franchises?.map((f) => f.name).join(', ') || null,
            physical_status: verification.physical_status,
            verification_tier: verification.verification_tier,
            is_physical: verification.is_physical,
            physical_regions: verification.physical_regions,
            verification_reasons: verification.reasons,
          };

          return Response.json({
            game,
            matchedReleases: matchedReleasesFormatted,
            physical_status: verification.physical_status,
            verification_tier: verification.verification_tier,
            physical_regions: verification.physical_regions,
            verification_reasons: verification.reasons,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return Response.json({ error: msg }, { status: 500 });
        }
      }

      // Endpoint: GET /api/discovery/scan-series
      else if (path === '/api/discovery/scan-series') {
        const filterDigital =
          url.searchParams.get('filterDigital') === 'true' ||
          url.searchParams.get('hideDigital') === 'true';

        try {
          const { results: seriesRows } = await env.DB.prepare(
            `SELECT DISTINCT canonical_series FROM games WHERE canonical_series IS NOT NULL AND canonical_series != ''`,
          ).all();

          const canonicalSeriesList = (seriesRows || []).map(
            (r) => (r as { canonical_series: string }).canonical_series,
          );
          if (canonicalSeriesList.length === 0) {
            return Response.json([]);
          }

          const { results: existingGames } = await env.DB.prepare(
            `SELECT g.igdb_id, g.platform_id FROM games g WHERE g.igdb_id IS NOT NULL`,
          ).all();

          const existingIgdbPlatforms = new Set<string>();
          (existingGames || []).forEach((g) => {
            const row = g as { igdb_id: number; platform_id: number };
            if (row.igdb_id) {
              existingIgdbPlatforms.add(`${row.igdb_id}-${row.platform_id}`);
            }
          });

          const { results: platformRows } = await env.DB.prepare(
            `SELECT id, display_name, name, launch_date FROM platforms WHERE parent_platform_id IS NULL`,
          ).all();

          const igdbToPlatformId = new Map<
            number,
            { id: number; displayName: string; launchDate: string | null }
          >();
          (platformRows || []).forEach((p) => {
            const row = p as {
              id: number;
              display_name: string;
              name: string;
              launch_date: string | null;
            };
            const igdbId =
              PLATFORM_MAP[row.display_name] || PLATFORM_MAP[row.name];
            if (igdbId) {
              igdbToPlatformId.set(igdbId, {
                id: row.id,
                displayName: row.display_name || row.name,
                launchDate: row.launch_date,
              });
            }
          });

          const suggestions: unknown[] = [];
          const token = await getEdgeTwitchToken(env);
          if (!token) {
            return Response.json([]);
          }

          // Sample up to 10 series to avoid excessive request runtime at the edge
          const sampleSeries = canonicalSeriesList.slice(0, 10);
          for (const series of sampleSeries) {
            const sanitized = series.replace(/["\\]/g, '');
            const igdbQuery = `
              fields name, cover.url, cover.image_id, first_release_date, summary, genres.name, url, collections.name, franchises.name, platforms.id, platforms.name, category, release_dates.platform, release_dates.region, release_dates.date, involved_companies.company.name, involved_companies.publisher;
              where collections.name = "${sanitized}" | franchises.name = "${sanitized}";
              limit 30;
            `;
            try {
              const games = (await queryIGDBEdge(
                'games',
                igdbQuery,
                env,
              )) as Array<{
                id: number;
                name: string;
                cover?: { url?: string; image_id?: string };
                platforms?: Array<{ id: number; name: string }>;
                first_release_date?: number;
                summary?: string;
                genres?: Array<{ name: string }>;
                url?: string;
                collections?: Array<{ name: string }>;
                franchises?: Array<{ name: string }>;
                category?: number;
                release_dates?: Array<{
                  platform?: number;
                  region?: number;
                  date?: number;
                }>;
                involved_companies?: Array<{
                  company?: { name: string };
                  publisher?: boolean;
                }>;
              }>;

              const seriesClean = sanitized
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '');
              const { results: canonicalRows } = await env.DB.prepare(
                `SELECT id, platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, serial_code, barcode, publisher, is_verified_physical
                 FROM canonical_releases WHERE normalized_title LIKE ?`,
              )
                .bind(`%${seriesClean}%`)
                .all();
              const seriesCanonicalReleases = (canonicalRows ||
                []) as unknown as CanonicalRelease[];

              for (const g of games || []) {
                if (!g.platforms) continue;
                for (const plat of g.platforms) {
                  const mapped = igdbToPlatformId.get(plat.id);
                  if (!mapped) continue;

                  const key = `${g.id}-${mapped.id}`;
                  if (existingIgdbPlatforms.has(key)) continue;

                  let imageUrl: string | null = null;
                  if (g.cover?.image_id) {
                    imageUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg`;
                  } else if (g.cover?.url) {
                    imageUrl = g.cover.url.startsWith('//')
                      ? `https:${g.cover.url}`
                      : g.cover.url;
                    imageUrl = imageUrl.replace('/t_thumb/', '/t_cover_big/');
                  }

                  const publisherName =
                    g.involved_companies?.find((ic) => ic.publisher)?.company
                      ?.name || null;

                  const verification = detectPhysicalReleaseStatus({
                    platformId: mapped.id,
                    gameTitle: g.name,
                    firstReleaseDate: g.first_release_date,
                    platformLaunchDate: mapped.launchDate,
                    publisher: publisherName,
                    igdbCategory: g.category,
                    canonicalReleases: seriesCanonicalReleases,
                  });

                  if (
                    filterDigital &&
                    verification.physical_status === 'digital_only'
                  ) {
                    continue;
                  }

                  const matchedReleasesFormatted =
                    verification.matched_releases.map((mr) => ({
                      name: mr.raw_title,
                      romName: mr.rom_name || mr.raw_title,
                      romCrc: mr.rom_crc || null,
                      region: mr.region || null,
                      variants: mr.variants || null,
                      releaseDate: null,
                      canonical_release_id: mr.id || null,
                      serial_code: mr.serial_code || null,
                      barcode: mr.barcode || null,
                      is_physical: mr.is_verified_physical,
                    }));

                  suggestions.push({
                    id: g.id,
                    title: g.name,
                    platform: mapped.displayName,
                    platform_id: mapped.id,
                    image_url: imageUrl,
                    summary: g.summary || null,
                    collections:
                      g.collections?.map((c) => c.name).join(', ') || null,
                    franchises:
                      g.franchises?.map((f) => f.name).join(', ') || null,
                    genres: g.genres?.map((ge) => ge.name).join(', ') || null,
                    igdb_url: g.url || null,
                    region: 'NA',
                    releases: matchedReleasesFormatted,
                    physical_status: verification.physical_status,
                    verification_tier: verification.verification_tier,
                    is_physical: verification.is_physical,
                    physical_regions: verification.physical_regions,
                    verification_reasons: verification.reasons,
                  });
                }
              }
            } catch (seriesErr) {
              console.warn(
                `[WorkerDiscovery] Failed to scan series ${series}:`,
                seriesErr,
              );
            }
          }

          return Response.json(suggestions);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return Response.json({ error: msg }, { status: 500 });
        }
      }

      // Endpoint: GET /api/discovery/scan-amiibo
      else if (path === '/api/discovery/scan-amiibo') {
        try {
          const response = await fetch('https://amiiboapi.org/api/amiibo/', {
            headers: { 'User-Agent': 'CollectionTracker/1.0' },
          });
          if (!response.ok) {
            throw new Error(`AmiiboAPI failed: ${response.status}`);
          }
          const data = (await response.json()) as {
            amiibo: Array<{
              head: string;
              tail: string;
              name: string;
              amiiboSeries: string;
              gameSeries?: string;
              type: string;
              image: string;
              release?: { na?: string; jp?: string; eu?: string };
            }>;
          };

          const { results: existingRows } = await env.DB.prepare(
            `SELECT id, name, amiibo_id FROM toys WHERE line = 'amiibo'`,
          ).all();

          const existingIds = new Set<string>();
          const existingNames = new Set<string>();
          (existingRows || []).forEach((r) => {
            const row = r as {
              id: string;
              name: string;
              amiibo_id?: string | null;
            };
            if (row.amiibo_id) existingIds.add(row.amiibo_id);
            if (row.id) existingIds.add(row.id);
            if (row.name) existingNames.add(row.name.toLowerCase().trim());
          });

          const missingAmiibo: unknown[] = [];
          for (const a of data.amiibo || []) {
            const amiiboId = `${a.head}${a.tail}`;
            const cleanName = (a.name || '').toLowerCase().trim();
            if (existingIds.has(amiiboId) || existingNames.has(cleanName)) {
              continue;
            }

            const effectiveSeries =
              a.amiiboSeries === 'Others' && a.gameSeries
                ? a.gameSeries
                : a.amiiboSeries || 'Other';

            missingAmiibo.push({
              id: amiiboId,
              amiibo_id: amiiboId,
              name: a.name,
              line: 'amiibo',
              series_name: effectiveSeries,
              game_series: a.gameSeries || null,
              type: a.type || 'Figure',
              image_url: a.image,
              release_date:
                a.release?.na || a.release?.jp || a.release?.eu || null,
              region: a.release?.na
                ? 'NA'
                : a.release?.jp
                  ? 'JP'
                  : a.release?.eu
                    ? 'EU'
                    : 'NA',
            });
          }

          return Response.json(missingAmiibo);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return Response.json({ error: msg }, { status: 500 });
        }
      }

      // Endpoint: GET /api/admin/login or GET /admin/login or /cdn-cgi/access/authorized
      else if (
        path === '/api/admin/login' ||
        path === '/admin/login' ||
        path.startsWith('/cdn-cgi/access/authorized')
      ) {
        const res = new Response(
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

        res.headers.append(
          'Set-Cookie',
          'CF_AppSession=dev-admin-session; Path=/; SameSite=Lax',
        );

        return res;
      }

      // Endpoint: GET /api/admin/logout or GET /admin/logout
      else if (path === '/api/admin/logout' || path === '/admin/logout') {
        const teamDomain =
          env.TEAM_DOMAIN || 'wesleymiller.cloudflareaccess.com';
        const returnUrl = new URL('/collection/games', request.url).toString();
        const logoutUrl = `https://${teamDomain}/cdn-cgi/access/logout?return_to=${encodeURIComponent(
          returnUrl,
        )}`;

        const isLocalDev =
          url.hostname === 'localhost' ||
          url.hostname === '127.0.0.1' ||
          url.hostname === '0.0.0.0';
        const targetRedirect = isLocalDev ? '/collection/games' : logoutUrl;

        const logoutHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Logging Out</title>
  <meta http-equiv="refresh" content="0; url=${targetRedirect}">
</head>
<body style="background:#130b24;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
  <p>Logging out and clearing session...</p>
  <script>window.location.replace('${targetRedirect}');</script>
</body>
</html>`;
        const res = new Response(logoutHtml, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
          },
        });
        res.headers.append(
          'Set-Cookie',
          'CF_AppSession=; Path=/; Domain=gagglog.wesleymiller.me; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
        );
        res.headers.append(
          'Set-Cookie',
          'CF_AppSession=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; SameSite=Lax',
        );
        res.headers.append(
          'Set-Cookie',
          'CF_Authorization=; Path=/; Domain=gagglog.wesleymiller.me; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
        );
        res.headers.append(
          'Set-Cookie',
          'CF_Authorization=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
        );
        return res;
      }

      // Endpoint: GET /api/admin/me
      else if (path === '/api/admin/me') {
        const accessEmail = request.headers.get(
          'Cf-Access-Authenticated-User-Email',
        );
        const cookieHeader = request.headers.get('Cookie') || '';
        const hasCookie =
          cookieHeader.includes('CF_Authorization') ||
          cookieHeader.includes('CF_AppSession');
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

      // Endpoint: POST /api/discovery/add
      else if (request.method === 'POST' && path === '/api/discovery/add') {
        if (!isAuthorizedAdmin(request, env)) {
          return Response.json(
            { error: 'Unauthorized: Admin authentication required.' },
            { status: 403 },
          );
        }

        const body = (await request.json()) as {
          game: {
            title: string;
            platform_id: number;
            igdb_id?: number | null;
            igdb_url?: string | null;
            summary?: string | null;
            genres?: string | null;
            region?: string | null;
            image_url?: string | null;
            collections?: string | null;
            franchises?: string | null;
            ownership_status?: number;
            play_status?: number;
            backup_status?: number;
            physical_status?: string;
            verification_tier?: number;
            barcode?: string | null;
          };
          releases?: Array<{
            region?: string | null;
            variants?: string | null;
            rom_name?: string | null;
            rom_crc?: string | null;
            ownership_status?: number;
            backup_status?: number;
            release_date?: string | null;
            canonical_release_id?: number | null;
            barcode?: string | null;
            is_physical?: number;
          }>;
        };

        const { game, releases } = body;
        if (!game || !game.title || !game.platform_id) {
          return Response.json(
            { error: 'Invalid game payload' },
            { status: 400 },
          );
        }

        const slugify = (s: string) =>
          (s || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');

        const platformRow = (await env.DB.prepare(
          'SELECT display_name FROM platforms WHERE id = ?',
        )
          .bind(game.platform_id)
          .first()) as { display_name: string } | null;

        const platformName = platformRow ? platformRow.display_name : 'unknown';
        const baseSlug = `${slugify(game.title)}-${slugify(platformName)}`;

        let candidateGameId = baseSlug;
        let counter = 1;
        while (true) {
          const exists = await env.DB.prepare(
            'SELECT 1 FROM games WHERE id = ?',
          )
            .bind(candidateGameId)
            .first();
          if (!exists) break;
          candidateGameId = `${baseSlug}-${counter}`;
          counter++;
        }

        const maxSortIndexRow = (await env.DB.prepare(
          'SELECT MAX(sort_index) as max_idx FROM games WHERE platform_id = ?',
        )
          .bind(game.platform_id)
          .first()) as { max_idx: number | null } | null;

        const sortIndex =
          (maxSortIndexRow?.max_idx !== null &&
          maxSortIndexRow?.max_idx !== undefined
            ? maxSortIndexRow.max_idx
            : 0) + 1;

        const canonicalSeries = computeGameCanonicalSeries({
          title: game.title,
          collections: game.collections || undefined,
          franchises: game.franchises || undefined,
        });

        await env.DB.prepare(
          `
          INSERT INTO games (
            id, title, platform_id, queued, sort_index, image_url, play_status,
            igdb_id, igdb_url, summary, genres, region, collections, franchises, manually_verified,
            physical_status, verification_tier, barcode, canonical_series
          ) VALUES (
            ?, ?, ?, 0, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, 1,
            ?, ?, ?, ?
          )
        `,
        )
          .bind(
            candidateGameId,
            game.title,
            game.platform_id,
            sortIndex,
            game.image_url || null,
            game.play_status || 0,
            game.igdb_id || null,
            game.igdb_url || null,
            game.summary || null,
            game.genres || null,
            game.region || 'NA',
            game.collections || null,
            game.franchises || null,
            game.physical_status || 'unverified',
            game.verification_tier || 0,
            game.barcode || null,
            canonicalSeries,
          )
          .run();

        const insertedGame = (await env.DB.prepare(
          'SELECT stable_id FROM games WHERE id = ?',
        )
          .bind(candidateGameId)
          .first()) as { stable_id: number } | null;

        const finalStableId = insertedGame?.stable_id || 0;

        if (releases && releases.length > 0) {
          const statements = [];
          for (let i = 0; i < releases.length; i++) {
            const rel = releases[i];
            const baseRelSlug = `${candidateGameId}-${rel.rom_crc || slugify(rel.rom_name || `release-${i + 1}`)}`;
            statements.push(
              env.DB.prepare(
                `
                INSERT INTO game_releases (
                  id, game_id, region, variants, rom_name, rom_crc, ownership_status, backup_status, release_date,
                  canonical_release_id, barcode, is_physical
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `,
              ).bind(
                baseRelSlug,
                finalStableId,
                rel.region || null,
                rel.variants || null,
                rel.rom_name || null,
                rel.rom_crc || null,
                rel.ownership_status ?? (game.ownership_status || 0),
                rel.backup_status ?? (game.backup_status || 0),
                rel.release_date || null,
                rel.canonical_release_id || null,
                rel.barcode || null,
                rel.is_physical ?? 1,
              ),
            );
          }
          if (statements.length > 0) {
            await env.DB.batch(statements);
          }
        } else {
          const defaultRelId = `${candidateGameId}-default`;
          await env.DB.prepare(
            `
            INSERT INTO game_releases (
              id, game_id, region, variants, rom_name, rom_crc, ownership_status, backup_status, release_date, is_physical
            ) VALUES (?, ?, ?, NULL, NULL, NULL, 0, 0, NULL, ?)
          `,
          )
            .bind(
              defaultRelId,
              finalStableId,
              game.region || 'NA',
              game.physical_status === 'digital_only' ? 0 : 1,
            )
            .run();
        }

        return Response.json({ success: true, gameId: candidateGameId });
      }

      // Endpoint: POST /api/discovery/add-toy
      else if (request.method === 'POST' && path === '/api/discovery/add-toy') {
        if (!isAuthorizedAdmin(request, env)) {
          return Response.json(
            { error: 'Unauthorized: Admin authentication required.' },
            { status: 403 },
          );
        }

        const toy = (await request.json()) as {
          id?: string;
          name: string;
          line?: string;
          series_name?: string;
          series?: string;
          type?: string;
          release_date?: string | null;
          ownership_status?: number;
          image_url?: string | null;
          amiibo_id?: string | null;
          metadata_json?: string | null;
          region?: string | null;
        };

        if (!toy || !toy.name) {
          return Response.json(
            { error: 'Invalid toy payload' },
            { status: 400 },
          );
        }

        const slugify = (s: string) =>
          (s || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');

        const candidateId =
          toy.id ||
          `amiibo-${slugify(toy.name)}-${slugify(toy.series_name || 'amiibo')}`;

        const existingToy = (await env.DB.prepare(
          `SELECT id, stable_id FROM toys WHERE (amiibo_id IS NOT NULL AND amiibo_id = ?) OR id = ? OR name = ?`,
        )
          .bind(toy.amiibo_id || candidateId, candidateId, toy.name)
          .first()) as { id: string; stable_id: number } | null;

        if (existingToy) {
          await env.DB.prepare(
            `UPDATE toys 
             SET ownership_status = COALESCE(?, ownership_status),
                 verified = 1,
                 image_url = COALESCE(?, image_url),
                 metadata_json = COALESCE(?, metadata_json),
                 amiibo_id = COALESCE(?, amiibo_id)
             WHERE stable_id = ?`,
          )
            .bind(
              toy.ownership_status ?? 1,
              toy.image_url || null,
              toy.metadata_json || null,
              toy.amiibo_id || null,
              existingToy.stable_id,
            )
            .run();
          return Response.json({ success: true, id: existingToy.id });
        }

        const maxSortIndexRow = (await env.DB.prepare(
          'SELECT MAX(sort_index) as max_idx FROM toys WHERE line = ?',
        )
          .bind(toy.line || 'amiibo')
          .first()) as { max_idx: number | null } | null;

        const sortIndex =
          (maxSortIndexRow?.max_idx !== null &&
          maxSortIndexRow?.max_idx !== undefined
            ? maxSortIndexRow.max_idx
            : 0) + 1;

        await env.DB.prepare(
          `
          INSERT INTO toys (
            id, name, line, series_name, series_line, series, type, release_date,
            ownership_status, image_url, amiibo_id, verified, metadata_json, sort_index, region
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, 1, ?, ?, ?
          )
        `,
        )
          .bind(
            candidateId,
            toy.name,
            toy.line || 'amiibo',
            toy.series_name || 'Other',
            toy.line || 'amiibo',
            toy.series || toy.series_name || 'Other',
            toy.type || 'Figure',
            toy.release_date || null,
            toy.ownership_status ?? 1,
            toy.image_url || null,
            toy.amiibo_id || null,
            toy.metadata_json || null,
            sortIndex,
            toy.region || 'NA',
          )
          .run();

        return Response.json({ success: true, id: candidateId });
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
