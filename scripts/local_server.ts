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
import axios from 'axios';
import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import {
  PLATFORM_MAP,
  findGame,
  getGameById,
  getCollectionGames,
  queryIGDB,
  getGamesByIds,
} from './lib/igdb.js';
import { PlatformRecord } from './lib/dat_cache.js';
import {
  detectPhysicalReleaseStatus,
  CanonicalRelease,
} from './lib/canonical_releases.js';
import { computeGameCanonicalSeries } from './lib/canonical_series.js';
import { recomputeCanonicalSeries } from './compute_canonical_series.js';
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
       * ROUTE: GET /api/discovery/scan-amiibo
       */
      if (req.method === 'GET' && pathname === '/api/discovery/scan-amiibo') {
        try {
          const response = await axios.get(
            'https://amiiboapi.org/api/amiibo/',
            {
              headers: { 'User-Agent': 'CollectionTracker/1.0' },
              timeout: 10000,
            },
          );
          const data = response.data as {
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

          const existingRows = db
            .prepare(
              `SELECT id, name, amiibo_id FROM toys WHERE line = 'amiibo'`,
            )
            .all() as { id: string; name: string; amiibo_id?: string | null }[];

          const existingIds = new Set<string>();
          const existingNames = new Set<string>();
          existingRows.forEach((r) => {
            if (r.amiibo_id) existingIds.add(r.amiibo_id);
            if (r.id) existingIds.add(r.id);
            if (r.name) existingNames.add(r.name.toLowerCase().trim());
          });

          const missingAmiibo: unknown[] = [];
          for (const a of data.amiibo || []) {
            const amiiboId = `${a.head}${a.tail}`;
            const cleanName = (a.name || '').toLowerCase().trim();
            const lowerSeries = (a.amiiboSeries || '').toLowerCase();
            const lowerGame = (a.gameSeries || '').toLowerCase();
            if (
              lowerSeries.includes('skylanders') ||
              lowerGame.includes('skylanders') ||
              cleanName.includes('hammer slam bowser') ||
              cleanName.includes('turbo charge donkey kong')
            ) {
              continue;
            }

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

          res.end(JSON.stringify(missingAmiibo));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: msg }));
        }
      } else if (
        req.method === 'POST' &&
        pathname === '/api/discovery/add-toy'
      ) {
        /**
         * ROUTE: POST /api/discovery/add-toy
         */
        try {
          const body = await new Promise<string>((resolve, reject) => {
            let data = '';
            req.on('data', (chunk) => (data += chunk));
            req.on('end', () => resolve(data));
            req.on('error', (err) => reject(err));
          });

          const toy = JSON.parse(body);
          if (!toy || !toy.name) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Invalid toy payload' }));
            return;
          }

          const slugify = (s: string) =>
            (s || '')
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '');

          const candidateId =
            toy.id ||
            `amiibo-${slugify(toy.name)}-${slugify(toy.series_name || 'amiibo')}`;

          const existingToy = db
            .prepare(
              `SELECT id, stable_id FROM toys WHERE (amiibo_id IS NOT NULL AND amiibo_id = ?) OR id = ? OR name = ?`,
            )
            .get(toy.amiibo_id || candidateId, candidateId, toy.name) as
            | { id: string; stable_id: number }
            | undefined;

          if (existingToy) {
            db.prepare(
              `UPDATE toys 
               SET ownership_status = COALESCE(?, ownership_status),
                   verified = 1,
                   image_url = COALESCE(?, image_url),
                   metadata_json = COALESCE(?, metadata_json),
                   amiibo_id = COALESCE(?, amiibo_id)
               WHERE stable_id = ?`,
            ).run(
              toy.ownership_status ?? 1,
              toy.image_url || null,
              toy.metadata_json || null,
              toy.amiibo_id || null,
              existingToy.stable_id,
            );
            res.end(JSON.stringify({ success: true, id: existingToy.id }));
            return;
          }

          const maxSortIndexRow = db
            .prepare(
              'SELECT MAX(sort_index) as max_idx FROM toys WHERE line = ?',
            )
            .get(toy.line || 'amiibo') as { max_idx: number | null };

          const sortIndex =
            (maxSortIndexRow?.max_idx !== null &&
            maxSortIndexRow?.max_idx !== undefined
              ? maxSortIndexRow.max_idx
              : 0) + 1;

          db.prepare(
            `
            INSERT INTO toys (
              id, name, line, series_name, series_line, series, type, release_date,
              ownership_status, image_url, amiibo_id, verified, metadata_json, sort_index, region
            ) VALUES (
              ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, 1, ?, ?, ?
            )
          `,
          ).run(
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
          );

          res.end(JSON.stringify({ success: true, id: candidateId }));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: msg }));
        }
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
      } else if (req.method === 'GET' && pathname === '/api/discovery/search') {
        /**
         * ROUTE: GET /api/discovery/search
         */
        const query = url.searchParams.get('query');
        const platformId = url.searchParams.get('platformId');
        if (!query) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Query parameter is required' }));
          return;
        }
        const localPid = Number(platformId || 0);
        let igdbPlatformId = 0;
        if (localPid) {
          const plat = db
            .prepare('SELECT name, display_name FROM platforms WHERE id = ?')
            .get(localPid) as
            | { name: string; display_name: string }
            | undefined;
          if (plat) {
            igdbPlatformId =
              PLATFORM_MAP[plat.display_name] || PLATFORM_MAP[plat.name] || 0;
          }
        }
        const matches = await findGame(query, igdbPlatformId);

        const filterDigital = url.searchParams.get('filterDigital') === 'true';
        const platformRows = db
          .prepare('SELECT id, display_name, name, launch_date FROM platforms')
          .all() as Array<{
          id: number;
          display_name: string;
          name: string;
          launch_date: string | null;
        }>;
        const platformMapById = new Map<
          number,
          {
            id: number;
            display_name: string;
            name: string;
            launch_date: string | null;
          }
        >();
        const igdbToLocalPlatform = new Map<number, number>();
        platformRows.forEach((p) => {
          platformMapById.set(p.id, p);
          const igdbId = PLATFORM_MAP[p.display_name] || PLATFORM_MAP[p.name];
          if (igdbId) {
            igdbToLocalPlatform.set(igdbId, p.id);
          }
        });

        const canonicalRows = db
          .prepare(
            `SELECT id, platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, serial_code, barcode, publisher, is_verified_physical
             FROM canonical_releases`,
          )
          .all() as CanonicalRelease[];

        const existing = db
          .prepare('SELECT igdb_id, platform_id, title FROM games')
          .all() as Array<{
          igdb_id: number | null;
          platform_id: number;
          title: string;
        }>;
        const existingSet = new Set<string>();
        existing.forEach((g) => {
          if (g.igdb_id) existingSet.add(`igdb-${g.igdb_id}-${g.platform_id}`);
          if (g.title) {
            existingSet.add(
              `title-${g.title.toLowerCase().replace(/[^a-z0-9]/g, '')}-${g.platform_id}`,
            );
          }
        });

        const filteredMatches = (matches || [])
          .map((m) => {
            const cleanTitle = (m.name || '')
              .toLowerCase()
              .replace(/[^a-z0-9]/g, '');
            const cleanIgdbId = Number(m.id.toString().replace('igdb-', ''));

            // Collect all candidate local platform IDs
            const targetPlatformIds = new Set<number>();

            if (Array.isArray(m.platform_ids)) {
              for (const pid of m.platform_ids) {
                const localPid = igdbToLocalPlatform.get(pid);
                if (localPid) targetPlatformIds.add(localPid);
              }
            }

            if (Array.isArray(m.platforms)) {
              for (const p of m.platforms) {
                if (typeof p.id === 'number') {
                  const localPid = igdbToLocalPlatform.get(p.id);
                  if (localPid) targetPlatformIds.add(localPid);
                }
              }
            }

            if (m.platform) {
              const igdbPid = PLATFORM_MAP[m.platform];
              if (igdbPid) {
                const localPid = igdbToLocalPlatform.get(igdbPid);
                if (localPid) targetPlatformIds.add(localPid);
              }
              const directMatch = platformRows.find(
                (p) =>
                  (p.display_name &&
                    p.display_name.toLowerCase() ===
                      m.platform.toLowerCase()) ||
                  (p.name && p.name.toLowerCase() === m.platform.toLowerCase()),
              );
              if (directMatch) {
                targetPlatformIds.add(directMatch.id);
              }
            }

            if (targetPlatformIds.size === 0) {
              const isOwnedGlobally = Array.from(existingSet).some((key) =>
                key.startsWith(`igdb-${cleanIgdbId}-`),
              );
              if (isOwnedGlobally) return null;
            } else {
              const hasUnowned = Array.from(targetPlatformIds).some(
                (localPid) => {
                  const isOwned =
                    existingSet.has(`igdb-${cleanIgdbId}-${localPid}`) ||
                    existingSet.has(`title-${cleanTitle}-${localPid}`);
                  return !isOwned;
                },
              );
              if (!hasUnowned) return null;
            }

            const chosenLocalPid =
              localPid || Array.from(targetPlatformIds)[0] || 0;
            const chosenPlatformRow = chosenLocalPid
              ? platformMapById.get(chosenLocalPid)
              : undefined;

            const verification = detectPhysicalReleaseStatus({
              platformId: chosenLocalPid,
              gameTitle: m.name,
              firstReleaseDate: m.release_date || null,
              platformLaunchDate: chosenPlatformRow?.launch_date || null,
              igdbCategory: (m as unknown as { category?: number }).category,
              canonicalReleases: canonicalRows,
            });

            if (
              filterDigital &&
              verification.physical_status === 'digital_only'
            ) {
              return null;
            }

            return {
              ...m,
              physical_status: verification.physical_status,
              verification_tier: verification.verification_tier,
              is_physical: verification.is_physical,
              physical_regions: verification.physical_regions,
              verification_reasons: verification.reasons,
              matched_releases: verification.matched_releases,
            };
          })
          .filter(Boolean);

        res.end(JSON.stringify(filteredMatches));
      } else if (
        /**
         * ROUTE: GET /api/discovery/matches
         */
        req.method === 'GET' &&
        pathname === '/api/discovery/matches'
      ) {
        const igdbId = url.searchParams.get('igdbId');
        const platformId = url.searchParams.get('platformId');
        if (!igdbId || !platformId) {
          res.statusCode = 400;
          res.end(
            JSON.stringify({
              error: 'igdbId and platformId parameters are required',
            }),
          );
          return;
        }
        const localPid = Number(platformId);
        let igdbPlatformId = 0;
        const plat = db
          .prepare('SELECT name, display_name FROM platforms WHERE id = ?')
          .get(localPid) as { name: string; display_name: string } | undefined;
        if (plat) {
          igdbPlatformId =
            PLATFORM_MAP[plat.display_name] || PLATFORM_MAP[plat.name] || 0;
        }
        const cleanIgdbId = igdbId.replace('igdb-', '');
        const game = await getGameById(Number(cleanIgdbId), igdbPlatformId);
        if (!game) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'Game not found on IGDB' }));
          return;
        }

        const platformRow = db
          .prepare('SELECT launch_date FROM platforms WHERE id = ?')
          .get(localPid) as { launch_date: string | null } | undefined;

        const canonicalRows = db
          .prepare(
            `SELECT id, platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, serial_code, barcode, publisher, is_verified_physical
             FROM canonical_releases WHERE platform_id = ?`,
          )
          .all(localPid) as CanonicalRelease[];

        const verification = detectPhysicalReleaseStatus({
          platformId: localPid,
          gameTitle: game.name,
          firstReleaseDate: game.release_date || null,
          platformLaunchDate: platformRow?.launch_date || null,
          igdbCategory: (game as unknown as { category?: number }).category,
          canonicalReleases: canonicalRows,
        });

        const matchedReleases = verification.matched_releases.map((mr) => ({
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

        res.end(
          JSON.stringify({
            game: {
              ...game,
              physical_status: verification.physical_status,
              verification_tier: verification.verification_tier,
              is_physical: verification.is_physical,
              physical_regions: verification.physical_regions,
              verification_reasons: verification.reasons,
            },
            matchedReleases,
            physical_status: verification.physical_status,
            verification_tier: verification.verification_tier,
            physical_regions: verification.physical_regions,
            verification_reasons: verification.reasons,
          }),
        );
      } else if (req.method === 'POST' && pathname === '/api/discovery/add') {
        /**
         * ROUTE: POST /api/discovery/add
         */
        try {
          const body = await new Promise<string>((resolve, reject) => {
            let data = '';
            req.on('data', (chunk) => (data += chunk));
            req.on('end', () => resolve(data));
            req.on('error', (err) => reject(err));
          });

          const { game, releases } = JSON.parse(body);
          if (!game || !game.title || !game.platform_id) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Invalid game payload' }));
            return;
          }

          const slugify = (s: string) =>
            (s || '')
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '');

          // Helper to generate a unique game slug
          const generateUniqueSlug = (baseId: string) => {
            let candidate = baseId;
            let counter = 1;
            const checkStmt = db.prepare('SELECT 1 FROM games WHERE id = ?');
            while (true) {
              const exists = checkStmt.get(candidate);
              if (!exists) return candidate;
              candidate = `${baseId}-${counter}`;
              counter++;
            }
          };

          // Helper to generate a unique release ID slug
          const generateUniqueReleaseId = (baseId: string) => {
            let candidate = baseId;
            let counter = 1;
            const checkStmt = db.prepare(
              'SELECT 1 FROM game_releases WHERE id = ?',
            );
            while (true) {
              const exists = checkStmt.get(candidate);
              if (!exists) return candidate;
              candidate = `${baseId}-${counter}`;
              counter++;
            }
          };

          const platformRow = db
            .prepare('SELECT display_name FROM platforms WHERE id = ?')
            .get(game.platform_id) as { display_name: string } | undefined;
          const platformName = platformRow
            ? platformRow.display_name
            : 'Unknown';

          const baseSlug = `${slugify(game.title)}-${slugify(platformName)}`;
          const newGameId = generateUniqueSlug(baseSlug);

          const maxSortIndexRow = db
            .prepare(
              'SELECT MAX(sort_index) as max_idx FROM games WHERE platform_id = ?',
            )
            .get(game.platform_id) as { max_idx: number | null };
          const sortIndex =
            (maxSortIndexRow.max_idx !== null ? maxSortIndexRow.max_idx : 0) +
            1;

          const canonicalSeries = computeGameCanonicalSeries({
            title: game.title,
            collections: game.collections || undefined,
            franchises: game.franchises || undefined,
          });

          let stableId: number;
          db.transaction(() => {
            const insertGame = db.prepare(`
              INSERT INTO games (
                id, title, platform_id, queued, sort_index, image_url, play_status,
                igdb_id, igdb_url, summary, genres, region, collections, franchises, manually_verified,
                physical_status, verification_tier, barcode, canonical_series
              ) VALUES (
                ?, ?, ?, 0, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, 1,
                ?, ?, ?, ?
              )
            `);

            const result = insertGame.run(
              newGameId,
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
            );

            stableId = Number(result.lastInsertRowid);

            if (releases && releases.length > 0) {
              const insertRelease = db.prepare(`
                INSERT INTO game_releases (
                  id, game_id, region, variants, rom_name, rom_crc, ownership_status, backup_status, release_date,
                  canonical_release_id, barcode, is_physical
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `);

              for (const rel of releases) {
                const baseRelSlug = `${newGameId}-${rel.rom_crc || slugify(rel.rom_name || 'release')}`;
                const uniqueRelId = generateUniqueReleaseId(baseRelSlug);

                insertRelease.run(
                  uniqueRelId,
                  stableId,
                  rel.region || null,
                  rel.variants || null,
                  rel.rom_name || null,
                  rel.rom_crc || null,
                  rel.ownership_status || 0,
                  rel.backup_status || 0,
                  rel.release_date || null,
                  rel.canonical_release_id || null,
                  rel.barcode || null,
                  rel.is_physical ?? 1,
                );
              }
            } else {
              const virtualId = `${stableId}-default`;
              db.prepare(
                `
                INSERT INTO game_releases (
                  id, game_id, region, variants, rom_name, rom_crc, ownership_status, backup_status, release_date, is_physical
                ) VALUES (?, ?, ?, NULL, NULL, NULL, 0, 0, NULL, ?)
              `,
              ).run(
                virtualId,
                stableId,
                game.region || 'NA',
                game.physical_status === 'digital_only' ? 0 : 1,
              );
            }
          })();

          // Recompute Canonical Series and Sync to Local D1
          if (!process.env['VITEST']) {
            await recomputeCanonicalSeries();
          }

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

          try {
            db.pragma('wal_checkpoint(FULL)');
          } catch (checkpointErr) {
            console.error('Checkpoint Error:', checkpointErr);
          }

          res.end(JSON.stringify({ success: true, gameId: newGameId }));
        } catch (err: unknown) {
          console.error('Add game failed:', err);
          const error = err instanceof Error ? err : new Error('Unknown error');
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message }));
        }
      } else if (
        /**
         * ROUTE: GET /api/discovery/scan-series
         */
        req.method === 'GET' &&
        pathname === '/api/discovery/scan-series'
      ) {
        try {
          const filterDigital =
            url.searchParams.get('filterDigital') === 'true';

          const seriesRows = db
            .prepare(
              `
            SELECT DISTINCT canonical_series FROM games
            WHERE canonical_series IS NOT NULL AND canonical_series != ''
          `,
            )
            .all() as { canonical_series: string }[];
          const seriesNames = seriesRows.map((r) => r.canonical_series);

          const dbPlatforms = db
            .prepare(
              'SELECT id, name, display_name, launch_date FROM platforms',
            )
            .all() as Array<PlatformRecord & { launch_date?: string | null }>;
          const trackedIgdbPlatformIds = new Set<number>();
          const igdbToLocalPlatformId: Record<number, number> = {};
          const igdbToLocalPlatformName: Record<number, string> = {};

          for (const p of dbPlatforms) {
            const igdbPid =
              PLATFORM_MAP[p.display_name] || PLATFORM_MAP[p.name];
            if (igdbPid) {
              trackedIgdbPlatformIds.add(igdbPid);
              igdbToLocalPlatformId[igdbPid] = p.id;
              igdbToLocalPlatformName[igdbPid] = p.display_name || p.name;
            }
          }

          const trackedGames = db
            .prepare('SELECT igdb_id FROM games WHERE igdb_id IS NOT NULL')
            .all() as { igdb_id: number }[];
          const trackedIgdbIds = new Set(trackedGames.map((g) => g.igdb_id));

          const canonicalRows = db
            .prepare(
              `SELECT id, platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, serial_code, barcode, publisher, is_verified_physical
               FROM canonical_releases`,
            )
            .all() as CanonicalRelease[];

          const scanResults: unknown[] = [];
          const gameIdToPlatforms = new Map<number, Set<number>>();

          for (const seriesName of seriesNames) {
            console.log(
              `[Series-Scan] Searching collections on IGDB for series: "${seriesName}"`,
            );
            const collections = (await queryIGDB(
              'collections',
              `fields id, name; search "${seriesName.replace(/"/g, '')}"; limit 3;`,
            )) as { id: number; name: string }[];

            for (const col of collections) {
              if (
                col.name.toLowerCase().includes(seriesName.toLowerCase()) ||
                seriesName.toLowerCase().includes(col.name.toLowerCase())
              ) {
                const collectionGames = await getCollectionGames(col.id);
                for (const game of collectionGames) {
                  if (trackedIgdbIds.has(game.id)) continue;

                  const gamePlatforms = game.platforms || [];
                  const matchingPlatforms = gamePlatforms.filter((p) =>
                    trackedIgdbPlatformIds.has(p.id),
                  );

                  if (matchingPlatforms.length > 0) {
                    if (!gameIdToPlatforms.has(game.id)) {
                      gameIdToPlatforms.set(game.id, new Set());
                    }
                    const platformsSet = gameIdToPlatforms.get(game.id)!;
                    for (const mp of matchingPlatforms) {
                      platformsSet.add(mp.id);
                    }
                  }
                }
              }
            }
          }

          const uniqueGameIds = Array.from(gameIdToPlatforms.keys());
          if (uniqueGameIds.length > 0) {
            console.log(
              `[Series-Scan] Hydrating metadata for ${uniqueGameIds.length} missing games...`,
            );
            const hydratedGames = await getGamesByIds(uniqueGameIds);

            for (const game of hydratedGames) {
              const numericId = Number(game.id.replace('igdb-', ''));
              const platformIds = Array.from(
                gameIdToPlatforms.get(numericId) || [],
              );

              for (const igdbPlatformId of platformIds) {
                const localPlatformId = igdbToLocalPlatformId[igdbPlatformId];
                const platformName = igdbToLocalPlatformName[igdbPlatformId];
                const localPlatformRow = dbPlatforms.find(
                  (p) => p.id === localPlatformId,
                );

                const verification = detectPhysicalReleaseStatus({
                  platformId: localPlatformId,
                  gameTitle: game.name,
                  firstReleaseDate: game.release_date || null,
                  platformLaunchDate: localPlatformRow?.launch_date || null,
                  igdbCategory: (game as unknown as { category?: number })
                    .category,
                  canonicalReleases: canonicalRows,
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

                scanResults.push({
                  id: game.id,
                  title: game.name,
                  summary: game.summary || null,
                  image_url: game.image_url || null,
                  platform: platformName,
                  platform_id: localPlatformId,
                  genres: game.genres || null,
                  collections: game.collections || null,
                  franchises: game.franchises || null,
                  region: game.region || 'NA',
                  release_date: game.release_date || null,
                  releases: matchedReleasesFormatted,
                  physical_status: verification.physical_status,
                  verification_tier: verification.verification_tier,
                  is_physical: verification.is_physical,
                  physical_regions: verification.physical_regions,
                  verification_reasons: verification.reasons,
                });
              }
            }
          }

          res.end(JSON.stringify(scanResults));
        } catch (err: unknown) {
          console.error('Scan series failed:', err);
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

          if (game.stable_id) {
            const bundled = db
              .prepare(BUNDLED_GAMES_BY_PARENT_QUERY)
              .all(game.stable_id);
            game['bundled_games'] = bundled;
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
