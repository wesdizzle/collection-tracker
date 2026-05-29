/**
 * LOCAL DEVELOPMENT API & DISCOVERY SERVER (TS)
 *
 * This server serves as the backend for the local development environment.
 * It directly queries the 'collection.sqlite' source-of-truth database.
 *
 * It handles:
 * 1. Collection API: Games, Toys, and Platforms (mirroring worker/worker.ts)
 * 2. Discovery API: Reading and applying scraping reconciliation reports.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import { getGameById, PLATFORM_MAP } from './lib/igdb.js';
import { parseDiscoveryReport } from './lib/discovery.js';
import type { ApplyPayload } from './lib/discovery.js';
import {
  GAMES_LIST_QUERY,
  GAME_DETAIL_QUERY,
  GAME_RELEASES_BY_GAME_ID_QUERY,
  PLATFORMS_LIST_QUERY,
  TOYS_LIST_QUERY,
  TOY_DETAIL_QUERY,
  GAMES_ORDER_BY,
  getRomGroupingKey,
} from './lib/queries.js';

// Source of truth local database
const db = new Database('collection.sqlite');
const PORT = 3000;

/**
 * CORE REQUEST HANDLER
 * Extracted for unit testing with dependency injection (db).
 */
export const handleRequest =
  (db: Database.Database) =>
  async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);
    const pathname = url.pathname;

    // Enable cross-origin requests for the frontend (running on Port 4200)
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle Pre-flight options
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      /**
       * ROUTE: GET /api/discovery
       */
      if (req.method === 'GET' && pathname === '/api/discovery') {
        const reportPath = path.join(process.cwd(), 'discovery_report.md');
        if (!fs.existsSync(reportPath)) {
          res.end(JSON.stringify([]));
          return;
        }

        const content = fs.readFileSync(reportPath, 'utf8');
        const discoveryItems = parseDiscoveryReport(content);
        res.end(JSON.stringify(discoveryItems));
      } else if (req.method === 'POST' && pathname === '/api/discovery/apply') {
        /**
         * ROUTE: POST /api/discovery/apply
         */
        let currentTitle = '';
        let currentPlatform = '';
        let currentLine = '';
        let currentSeries = '';
        let isToy = false;

        try {
          const body = await new Promise<string>((resolve, reject) => {
            let data = '';
            req.on('data', (chunk) => (data += chunk));
            req.on('end', () => resolve(data));
            req.on('error', (err) => reject(err));
          });

          const payload: ApplyPayload = JSON.parse(body);
          currentTitle = payload.currentTitle;
          currentPlatform = payload.currentPlatform;
          currentLine = payload.currentLine || '';
          currentSeries = payload.currentSeries || '';
          const { selectedIgdbId, selectedName, selectedPlatform, region } =
            payload;
          isToy = selectedIgdbId.toString().startsWith('amiibo-');

          if (isToy) {
            const amiiboId = selectedIgdbId.toString().replace('amiibo-', '');
            try {
              const apiUrl = `https://amiiboapi.org/api/amiibo/?id=${amiiboId}`;
              console.log(`Fetching amiibo metadata: ${apiUrl}`);
              const response = await axios.get(apiUrl, { timeout: 10000 });
              const a = response.data.amiibo;

              if (!a) {
                throw new Error(
                  `Amiibo API returned no results for ID: ${amiiboId}`,
                );
              }
              // Determine primary region and date
              let releaseDate = a.release?.na;
              let finalRegion = region || 'NA';

              if (!releaseDate && a.release) {
                if (a.release.jp) {
                  releaseDate = a.release.jp;
                  finalRegion = 'JP';
                } else if (a.release.eu) {
                  releaseDate = a.release.eu;
                  finalRegion = 'EU';
                } else if (a.release.au) {
                  releaseDate = a.release.au;
                  finalRegion = 'AU';
                }
              }

              const effectiveSeries =
                a.amiiboSeries === 'Others' ? a.gameSeries : a.amiiboSeries;

              db.prepare(
                `
                            UPDATE toys 
                            SET amiibo_id = ?, name = ?, type = ?, image_url = ?, series = ?, region = ?, release_date = ?, verified = 1, metadata_json = ?
                            WHERE name = ? AND series = ? AND line = 'amiibo'
                        `,
              ).run(
                amiiboId,
                a.name,
                a.type,
                a.image,
                effectiveSeries,
                finalRegion,
                releaseDate || null,
                JSON.stringify(a),
                currentTitle,
                currentSeries,
              );

              console.log(
                `Matched Toy: ${currentTitle} -> ${a.name} [ID: ${amiiboId}]`,
              );
            } catch (apiErr: unknown) {
              console.error(
                `Amiibo API fetch failed for ID ${amiiboId}:`,
                apiErr,
              );
              const apiErrMsg =
                apiErr instanceof Error ? apiErr.message : 'Unknown error';
              // Throw specific error format so frontend displays it cleanly
              throw new Error(`Failed to fetch amiibo metadata: ${apiErrMsg}`, {
                cause: apiErr,
              });
            }
          } else {
            // 1. Fetch Full Metadata from IGDB
            let summary: string | null = null;
            let imageUrl: string | null = null;
            let genres: string | null = null;
            let finalName = selectedName;
            const finalIgdbId = selectedIgdbId.toString().replace('igdb-', '');

            try {
              const igdbPlatformId =
                PLATFORM_MAP[selectedPlatform || currentPlatform];
              const igdbData = await getGameById(
                Number(finalIgdbId),
                igdbPlatformId,
              );

              if (igdbData) {
                summary = igdbData.summary || null;
                imageUrl = igdbData.image_url || null;
                genres = igdbData.genres || null;
                finalName = igdbData.name; // Use canonical name from IGDB
              }
            } catch (igdbErr) {
              console.error(
                'Failed to fetch rich metadata from IGDB:',
                igdbErr,
              );
            }

            // 2. Update the Local SQLite Source-of-Truth
            const game = db
              .prepare(
                `
                        SELECT g.id FROM games g
                        JOIN platforms p ON g.platform_id = p.id
                        WHERE (g.title = ? OR g.title = ?) AND p.display_name = ?
                    `,
              )
              .get(currentTitle, finalName, currentPlatform) as
              | { id: number }
              | undefined;

            if (game) {
              let finalPlatformId = null;
              if (selectedPlatform && selectedPlatform !== currentPlatform) {
                const platform = db
                  .prepare('SELECT id FROM platforms WHERE display_name = ?')
                  .get(selectedPlatform) as { id: number } | undefined;
                if (platform) {
                  finalPlatformId = platform.id;
                }
              }

              const slugify = (s: string) =>
                (s || '')
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, '-')
                  .replace(/^-+|-+$/g, '');
              const newId = `${slugify(finalName)}-${slugify(selectedPlatform || currentPlatform)}`;

              db.prepare(
                `
                            UPDATE games 
                            SET id = ?, title = ?, platform_id = COALESCE(?, platform_id), igdb_id = ?, region = ?, summary = ?, image_url = ?, genres = ? 
                            WHERE id = ?
                        `,
              ).run(
                newId,
                finalName,
                finalPlatformId,
                finalIgdbId,
                region || 'NA',
                summary,
                imageUrl,
                genres,
                game.id,
              );

              console.log(
                `Matched Game: ${currentTitle} (${currentPlatform}) -> ${finalName} (${selectedPlatform || currentPlatform}) [ID: ${finalIgdbId}]`,
              );
            }
          }
        } catch (err: unknown) {
          console.error('Discovery Apply failed:', err);
          const error = err instanceof Error ? err : new Error('Unknown error');
          res.statusCode = 500;
          res.end(
            JSON.stringify({
              error:
                error.message || 'Internal server error during discovery apply',
              details: error.stack,
            }),
          );
          return;
        }

        // Sync to Local D1 Instance (Skip in tests)
        if (!process.env['VITEST']) {
          try {
            const syncCmd =
              process.platform === 'win32'
                ? 'npm.cmd run sync-db'
                : 'npm run sync-db';
            execSync(syncCmd, { stdio: 'inherit' });
          } catch (syncErr) {
            console.error('D1 Sync Error:', syncErr);
          }
        }

        // Force Checkpoint
        try {
          db.pragma('wal_checkpoint(FULL)');
        } catch (checkpointErr) {
          console.error('Checkpoint Error:', checkpointErr);
        }

        // 3. Update Discovery Report (Remove matched item) - Skip in tests
        if (!process.env['VITEST']) {
          try {
            const reportPath = path.join(process.cwd(), 'discovery_report.md');
            if (fs.existsSync(reportPath)) {
              const content = fs.readFileSync(reportPath, 'utf8');
              const sections = content.split('\n### ');

              // Keep the first section (header) and filter out the matched one
              const header = sections[0];
              const remainingSections = sections.slice(1).filter((section) => {
                const headerLine = section.split('\n')[0].trim();
                let targetHeader = isToy
                  ? `${currentTitle} (amiibo)`
                  : `${currentTitle} (${currentPlatform})`;

                // If we have metadata, use the rich header format
                if (currentLine && currentSeries) {
                  targetHeader = `${currentTitle} (${currentPlatform}) | Line: ${currentLine} | Series: ${currentSeries}`;
                }

                return headerLine !== targetHeader.trim();
              });

              const newContent = [header, ...remainingSections].join('\n### ');
              fs.writeFileSync(reportPath, newContent, 'utf8');
              console.log('Updated discovery_report.md');
            }
          } catch (reportErr) {
            console.error('Report Update Error:', reportErr);
          }
        }

        res.end(JSON.stringify({ success: true }));
      } else if (
        req.method === 'POST' &&
        pathname === '/api/collection/toggle'
      ) {
        /**
         * ROUTE: POST /api/collection/toggle
         */
        try {
          const body = await new Promise<string>((resolve, reject) => {
            let data = '';
            req.on('data', (chunk) => (data += chunk));
            req.on('end', () => resolve(data));
            req.on('error', (err) => reject(err));
          });

          const {
            id,
            type,
            status,
            field = 'ownership_status',
          } = JSON.parse(body);

          const allowedFields = [
            'ownership_status',
            'play_status',
            'backup_status',
          ];
          if (!allowedFields.includes(field)) {
            throw new Error(`Invalid field: ${field}`);
          }

          if (type === 'game') {
            if (field === 'play_status') {
              // play_status: update games table
              let stableId: number | null = null;
              const release = db
                .prepare('SELECT game_id FROM game_releases WHERE id = ?')
                .get(id) as { game_id: number } | undefined;
              if (release) {
                stableId = release.game_id;
              } else {
                const game = db
                  .prepare('SELECT stable_id FROM games WHERE id = ?')
                  .get(id) as { stable_id: number } | undefined;
                if (game) {
                  stableId = game.stable_id;
                }
              }
              if (stableId === null) {
                throw new Error(`Could not find game/release with ID: ${id}`);
              }
              db.prepare(
                'UPDATE games SET play_status = ? WHERE stable_id = ?',
              ).run(status, stableId);
            } else {
              // ownership_status or backup_status: update game_releases table
              const release = db
                .prepare(
                  'SELECT game_id, region, variants, rom_name FROM game_releases WHERE id = ?',
                )
                .get(id) as
                | {
                    game_id: number;
                    region: string | null;
                    variants: string | null;
                    rom_name: string | null;
                  }
                | undefined;

              if (release) {
                if (field === 'ownership_status') {
                  // We update all releases in the same group (matching region, variants, and base rom name group)
                  // because ownership status is logically a release-wide setting rather than disc-level.
                  // This prevents multi-disc games from remaining partially owned/unowned when only a single disc ID is toggled.
                  const allReleases = db
                    .prepare(
                      'SELECT id, region, variants, rom_name FROM game_releases WHERE game_id = ?',
                    )
                    .all(release.game_id) as {
                    id: string;
                    region: string | null;
                    variants: string | null;
                    rom_name: string | null;
                  }[];

                  const targetKey = getRomGroupingKey(release.rom_name);
                  const matchingReleases = allReleases.filter(
                    (r) =>
                      r.region === release.region &&
                      r.variants === release.variants &&
                      getRomGroupingKey(r.rom_name) === targetKey,
                  );

                  const updateStmt = db.prepare(
                    `UPDATE game_releases SET ownership_status = ? WHERE id = ?`,
                  );
                  db.transaction(() => {
                    for (const r of matchingReleases) {
                      updateStmt.run(status, r.id);
                    }
                  })();
                } else {
                  // backup_status: update only the specific targeted disc release to allow individual tracking
                  db.prepare(
                    `UPDATE game_releases SET ${field} = ? WHERE id = ?`,
                  ).run(status, id);
                }
              } else {
                // Not a release ID; find game first by game ID
                const game = db
                  .prepare('SELECT stable_id, region FROM games WHERE id = ?')
                  .get(id) as
                  | { stable_id: number; region: string | null }
                  | undefined;
                if (!game) {
                  throw new Error(`Game or Release not found: ${id}`);
                }

                // First, check if there's already a release for this game. If so, update.
                const releases = db
                  .prepare(
                    'SELECT id FROM game_releases WHERE game_id = ? ORDER BY id ASC',
                  )
                  .all(game.stable_id) as { id: string }[];
                if (releases.length > 0) {
                  if (field === 'ownership_status') {
                    // Update all releases of this game
                    const updateStmt = db.prepare(
                      `UPDATE game_releases SET ownership_status = ? WHERE id = ?`,
                    );
                    db.transaction(() => {
                      for (const r of releases) {
                        updateStmt.run(status, r.id);
                      }
                    })();
                  } else {
                    db.prepare(
                      `UPDATE game_releases SET ${field} = ? WHERE id = ?`,
                    ).run(status, releases[0].id);
                  }
                } else {
                  // Create default virtual release if it somehow doesn't exist
                  const releaseId = `${id}-default`;
                  db.prepare(
                    `
                    INSERT INTO game_releases (id, game_id, region, variants, rom_name, rom_crc, backup_status, ownership_status)
                    VALUES (?, ?, ?, NULL, NULL, NULL, 0, 0)
                  `,
                  ).run(releaseId, game.stable_id, game.region);
                  db.prepare(
                    `UPDATE game_releases SET ${field} = ? WHERE id = ?`,
                  ).run(status, releaseId);
                }
              }
            }
            console.log(`Updated game status: ${id} -> ${field}=${status}`);
          } else {
            // Toys update
            db.prepare(`UPDATE toys SET ${field} = ? WHERE id = ?`).run(
              status,
              id,
            );
            console.log(`Updated toy status: ${id} -> ${field}=${status}`);
          }

          // Sync to Local D1 Instance
          if (!process.env['VITEST']) {
            try {
              const syncCmd =
                process.platform === 'win32'
                  ? 'npm.cmd run sync-db'
                  : 'npm run sync-db';
              execSync(syncCmd, { stdio: 'inherit' });
            } catch (syncErr) {
              console.error('D1 Sync Error:', syncErr);
            }
          }

          res.end(JSON.stringify({ success: true }));
        } catch (err: unknown) {
          console.error('Toggle status failed:', err);
          const error = err instanceof Error ? err : new Error('Unknown error');
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message }));
        }
      } else if (req.method === 'POST' && pathname === '/api/collection/sort') {
        /**
         * ROUTE: POST /api/collection/sort
         */
        try {
          const body = await new Promise<string>((resolve, reject) => {
            let data = '';
            req.on('data', (chunk) => (data += chunk));
            req.on('end', () => resolve(data));
            req.on('error', (err) => reject(err));
          });

          const { id, type, sort_index } = JSON.parse(body);
          if (type === 'game') {
            let stableId: number | null = null;
            const release = db
              .prepare('SELECT game_id FROM game_releases WHERE id = ?')
              .get(id) as { game_id: number } | undefined;
            if (release) {
              stableId = release.game_id;
            } else {
              const game = db
                .prepare('SELECT stable_id FROM games WHERE id = ?')
                .get(id) as { stable_id: number } | undefined;
              if (game) {
                stableId = game.stable_id;
              }
            }
            if (stableId === null) {
              throw new Error(`Could not find game/release with ID: ${id}`);
            }
            db.prepare(
              'UPDATE games SET sort_index = ? WHERE stable_id = ?',
            ).run(sort_index, stableId);
            console.log(
              `Updated game sort_index: ${id} (stable_id: ${stableId}) -> sort_index=${sort_index}`,
            );
          } else {
            db.prepare('UPDATE toys SET sort_index = ? WHERE id = ?').run(
              sort_index,
              id,
            );
            console.log(
              `Updated toy sort_index: ${id} -> sort_index=${sort_index}`,
            );
          }

          // Sync to Local D1 Instance
          if (!process.env['VITEST']) {
            try {
              const syncCmd =
                process.platform === 'win32'
                  ? 'npm.cmd run sync-db'
                  : 'npm run sync-db';
              execSync(syncCmd, { stdio: 'inherit' });
            } catch (syncErr) {
              console.error('D1 Sync Error:', syncErr);
            }
          }

          res.end(JSON.stringify({ success: true }));
        } catch (err: unknown) {
          console.error('Update sort index failed:', err);
          const error = err instanceof Error ? err : new Error('Unknown error');
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message }));
        }
      }

      /**
       * STANDALONE COLLECTION API HANDLERS
       * (Migrated from worker/worker.ts to ensure stability during local dev)
       */

      // GET /api/platforms
      else if (req.method === 'GET' && pathname === '/api/platforms') {
        const query = PLATFORMS_LIST_QUERY;
        const platforms = db.prepare(query).all();
        res.end(JSON.stringify(platforms));
      }

      // GET /api/games
      else if (req.method === 'GET' && pathname === '/api/games') {
        const platformId = url.searchParams.get('platform');
        const params: unknown[] = [];
        let query = GAMES_LIST_QUERY;

        if (platformId) {
          query += ' AND (g.platform_id = ? OR p.parent_platform_id = ?)';
          params.push(platformId, platformId);
        }

        query += GAMES_ORDER_BY;

        const games = db.prepare(query).all(...params);
        res.end(JSON.stringify(games));
      } else if (req.method === 'GET' && pathname.startsWith('/api/games/')) {
        const id = pathname.split('/').pop();
        const query = GAME_DETAIL_QUERY;
        let game = db.prepare(query).get(id, id) as
          | (Record<string, unknown> & {
              releases?: unknown[];
              rom_name?: string | null;
              rom_crc?: string | null;
              stable_id?: number;
              region?: string | null;
              variants?: string | null;
              id?: string;
              backup_status?: number;
              ownership_status?: number;
              release_date?: string | null;
            })
          | undefined;
        if (!game) {
          // Try to load by game ID directly (e.g. if we navigated using the game slug)
          const gameBySlug = db
            .prepare(
              `
            SELECT g.id as game_id, g.stable_id, COALESCE(r.id, g.id) as id
            FROM games g
            LEFT JOIN game_releases r ON g.stable_id = r.game_id
            WHERE g.id = ?
            LIMIT 1
          `,
            )
            .get(id) as { id: string } | undefined;

          if (gameBySlug) {
            game = db
              .prepare(query)
              .get(gameBySlug.id, gameBySlug.id) as typeof game;
          }
        }

        if (!game) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'Not found' }));
        } else {
          if (game.rom_name) {
            const releases = db
              .prepare(GAME_RELEASES_BY_GAME_ID_QUERY)
              .all(game.stable_id, game.region, game.variants) as {
              rom_name: string | null;
            }[];
            const targetKey = getRomGroupingKey(game.rom_name);
            game.releases = releases.filter(
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
          res.end(JSON.stringify(game));
        }
      }

      // GET /api/toys
      else if (req.method === 'GET' && pathname === '/api/toys') {
        const query = TOYS_LIST_QUERY;
        const toys = db.prepare(query).all();
        res.end(JSON.stringify(toys));
      }

      // GET /api/toys/:id
      else if (req.method === 'GET' && pathname.startsWith('/api/toys/')) {
        const id = pathname.split('/').pop();
        const query = TOY_DETAIL_QUERY;
        const toy = db.prepare(query).get(id);
        if (!toy) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'Not found' }));
        } else {
          res.end(JSON.stringify(toy));
        }
      }

      // Default fallback
      else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (err) {
      console.error('Server Error:', err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
  };

const server = http.createServer(handleRequest(db));

// Only start the server if this file is run directly
import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => {
    console.log(
      `Standalone Local API Server running at http://localhost:${PORT}`,
    );
  });
}
