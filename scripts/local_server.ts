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
  IGDBGame,
} from './lib/igdb.js';
import { PlatformRecord } from './lib/dat_cache.js';
import {
  detectPhysicalReleaseStatus,
  isPlatformDatComplete,
  CanonicalRelease,
} from './lib/canonical_releases.js';
import { normalizeTitleForMatching } from './lib/title_matching.js';
import { findVerifiedRegionalPhysicalReleases } from './lib/gameye.js';
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
  TARGETED_COMPANION_BY_CRC_QUERY,
  TARGETED_COMPANION_BY_GAME_ID_QUERY,
  TARGETED_COMPANION_BY_TITLE_QUERY,
  getRelatedGameIdsForCompanion,
  getRelatedGameTitlesForCompanion,
  CompanionDiscCandidateRow,
  enrichGameDetailWithCompanionsAndVouchers,
  resolveRegionalCoverUrl,
} from './lib/queries.js';
import {
  fetchAllRetailDeals,
  matchBestBuyProduct,
  CandidateGame,
  RetailDealItem,
} from './lib/bestbuy.js';

import { getDatabase } from './lib/db.js';
import {
  DEFAULT_VAPID_PUBLIC_KEY,
  sendWebPushNotification,
} from '../worker/web_push.js';

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
                ? 'USA'
                : a.release?.jp
                  ? 'Japan'
                  : a.release?.eu
                    ? 'Europe'
                    : 'USA',
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
            toy.region || 'USA',
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
            'has_case',
            'has_manual',
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
              // ownership_status, has_case, has_manual, or backup_status: update game_releases table
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
                if (
                  field === 'ownership_status' ||
                  field === 'has_case' ||
                  field === 'has_manual'
                ) {
                  // We update all releases in the same group (matching region, variants, and base rom name group)
                  // because ownership and completeness are logically release-wide settings rather than disc-level.
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
                    `UPDATE game_releases SET ${field} = ? WHERE id = ?`,
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
                  if (
                    field === 'ownership_status' ||
                    field === 'has_case' ||
                    field === 'has_manual'
                  ) {
                    // Update all releases of this game
                    const updateStmt = db.prepare(
                      `UPDATE game_releases SET ${field} = ? WHERE id = ?`,
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
                    INSERT INTO game_releases (id, game_id, region, variants, rom_name, rom_crc, backup_status, ownership_status, has_case, has_manual)
                    VALUES (?, ?, ?, NULL, NULL, NULL, 0, 0, 0, 0)
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
        // Map regional/VR IGDB platform IDs to unified parent local platforms
        const nesLocalId = igdbToLocalPlatform.get(18);
        if (nesLocalId) igdbToLocalPlatform.set(99, nesLocalId);
        const snesLocalId = igdbToLocalPlatform.get(19);
        if (snesLocalId) igdbToLocalPlatform.set(58, snesLocalId);
        const ps4LocalId = igdbToLocalPlatform.get(48);
        if (ps4LocalId) igdbToLocalPlatform.set(165, ps4LocalId);
        const ps5LocalId = igdbToLocalPlatform.get(167);
        if (ps5LocalId) igdbToLocalPlatform.set(390, ps5LocalId);

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
            existingSet.add(
              `norm-${normalizeTitleForMatching(g.title)}-${g.platform_id}`,
            );
          }
        });

        const filteredMatches = (matches || [])
          .map((m) => {
            const cleanTitle = (m.name || '')
              .toLowerCase()
              .replace(/[^a-z0-9]/g, '');
            const normTitle = normalizeTitleForMatching(m.name || '');
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
                    existingSet.has(`title-${cleanTitle}-${localPid}`) ||
                    existingSet.has(`norm-${normTitle}-${localPid}`);
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
              alternativeNames: m.alternative_names,
              firstReleaseDate: m.release_date || null,
              platformLaunchDate: chosenPlatformRow?.launch_date || null,
              igdbCategory:
                m.game_type ?? (m as unknown as { category?: number }).category,
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

        let canonicalRows = db
          .prepare(
            `SELECT id, platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, serial_code, barcode, publisher, is_verified_physical
             FROM canonical_releases WHERE platform_id = ?`,
          )
          .all(localPid) as CanonicalRelease[];

        if (!isPlatformDatComplete(localPid) && !process.env['VITEST']) {
          const verifiedRegional = await findVerifiedRegionalPhysicalReleases(
            game.name,
            localPid,
            game.alternative_names,
          );
          if (verifiedRegional.length > 0) {
            const findStmt = db.prepare(
              `SELECT id FROM canonical_releases WHERE platform_id = ? AND normalized_title = ? AND region = ? LIMIT 1`,
            );
            const insertStmt = db.prepare(
              `INSERT INTO canonical_releases (platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, serial_code, barcode, publisher, source, is_verified_physical)
               VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, 'gameye_vgpc', 1)`,
            );
            let insertedAny = false;
            for (const vr of verifiedRegional) {
              const norm = normalizeTitleForMatching(vr.clean_title);
              const existingRow = findStmt.get(localPid, norm, vr.region);
              if (!existingRow) {
                insertStmt.run(localPid, vr.clean_title, norm, vr.region);
                insertedAny = true;
              }
            }
            if (insertedAny) {
              canonicalRows = db
                .prepare(
                  `SELECT id, platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, serial_code, barcode, publisher, is_verified_physical
                   FROM canonical_releases WHERE platform_id = ?`,
                )
                .all(localPid) as CanonicalRelease[];
            }
          }
        }

        const verification = detectPhysicalReleaseStatus({
          platformId: localPid,
          gameTitle: game.name,
          alternativeNames: game.alternative_names,
          firstReleaseDate: game.release_date || null,
          platformLaunchDate: platformRow?.launch_date || null,
          igdbCategory:
            game.game_type ??
            (game as unknown as { category?: number }).category,
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
          image_url:
            resolveRegionalCoverUrl(
              { game_localizations: game.game_localizations },
              mr.region,
            ) || null,
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

          const normalizeRegionStr = (r: string | null | undefined): string => {
            if (!r) return 'USA';
            if (r === 'NA') return 'USA';
            if (r === 'JP') return 'Japan';
            if (r === 'EU') return 'Europe';
            return r;
          };
          const gameRegion = normalizeRegionStr(
            game.region || (releases && releases[0]?.region),
          );

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
              gameRegion,
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
                  rel.region ? normalizeRegionStr(rel.region) : null,
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
                gameRegion,
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
            url.searchParams.get('filterDigital') === 'true' ||
            url.searchParams.get('hideDigital') === 'true';

          const specificSeries = url.searchParams.get('series');
          const offsetParam = url.searchParams.get('offset');
          const limitParam = url.searchParams.get('limit');
          const isPaged = offsetParam !== null;
          const offset = offsetParam
            ? Math.max(0, parseInt(offsetParam, 10))
            : 0;
          const limit = limitParam
            ? Math.min(40, Math.max(1, parseInt(limitParam, 10)))
            : 30;

          let seriesNames: string[] = [];
          let totalSeriesCount = 0;

          if (specificSeries && specificSeries.trim()) {
            seriesNames = [specificSeries.trim()];
            totalSeriesCount = 1;
          } else {
            const allSeriesRows = db
              .prepare(
                `SELECT canonical_series, COUNT(*) as c FROM games
                 WHERE canonical_series IS NOT NULL AND canonical_series != ''
                 GROUP BY canonical_series
                 ORDER BY c DESC, canonical_series ASC`,
              )
              .all() as Array<{ canonical_series: string }>;

            const allSeries = (allSeriesRows || [])
              .map((r) => r.canonical_series)
              .filter(Boolean);

            totalSeriesCount = allSeries.length;

            if (isPaged) {
              seriesNames = allSeries.slice(offset, offset + limit);
            } else {
              seriesNames = allSeries.slice(0, 30);
            }
          }

          if (seriesNames.length === 0) {
            res.setHeader('Content-Type', 'application/json');
            if (isPaged) {
              res.end(
                JSON.stringify({
                  suggestions: [],
                  offset,
                  limit,
                  totalSeries: totalSeriesCount,
                  hasMore: false,
                }),
              );
            } else {
              res.end(JSON.stringify([]));
            }
            return;
          }

          const platColumns = db
            .prepare('PRAGMA table_info(platforms)')
            .all() as Array<{ name: string }>;
          const hasParentPlatformCol = platColumns.some(
            (c) => c.name === 'parent_platform_id',
          );

          const dbPlatforms = db
            .prepare(
              hasParentPlatformCol
                ? 'SELECT id, name, display_name, launch_date, parent_platform_id FROM platforms'
                : 'SELECT id, name, display_name, launch_date FROM platforms',
            )
            .all() as Array<
            PlatformRecord & {
              launch_date?: string | null;
              parent_platform_id?: number | null;
            }
          >;

          const trackedIgdbPlatformIds = new Set<number>();
          const igdbToLocalPlatformId: Record<number, number> = {};
          const igdbToLocalPlatformName: Record<number, string> = {};

          for (const p of dbPlatforms) {
            if (p.parent_platform_id) continue;
            const igdbPid =
              PLATFORM_MAP[p.display_name] || PLATFORM_MAP[p.name];
            if (igdbPid) {
              trackedIgdbPlatformIds.add(igdbPid);
              igdbToLocalPlatformId[igdbPid] = p.id;
              igdbToLocalPlatformName[igdbPid] = p.display_name || p.name;
            }
          }

          // Map regional/VR IGDB platform IDs to unified parent local platforms
          if (igdbToLocalPlatformId[18]) {
            trackedIgdbPlatformIds.add(99);
            igdbToLocalPlatformId[99] = igdbToLocalPlatformId[18];
            igdbToLocalPlatformName[99] = igdbToLocalPlatformName[18];
          }
          if (igdbToLocalPlatformId[19]) {
            trackedIgdbPlatformIds.add(58);
            igdbToLocalPlatformId[58] = igdbToLocalPlatformId[19];
            igdbToLocalPlatformName[58] = igdbToLocalPlatformName[19];
          }
          if (igdbToLocalPlatformId[48]) {
            trackedIgdbPlatformIds.add(165);
            igdbToLocalPlatformId[165] = igdbToLocalPlatformId[48];
            igdbToLocalPlatformName[165] = igdbToLocalPlatformName[48];
          }
          if (igdbToLocalPlatformId[167]) {
            trackedIgdbPlatformIds.add(390);
            igdbToLocalPlatformId[390] = igdbToLocalPlatformId[167];
            igdbToLocalPlatformName[390] = igdbToLocalPlatformName[167];
          }

          const parentMap = new Map<number, number>();
          for (const p of dbPlatforms) {
            if (p.parent_platform_id) {
              parentMap.set(p.id, p.parent_platform_id);
            }
          }

          const existingGames = db
            .prepare('SELECT igdb_id, platform_id, title FROM games')
            .all() as Array<{
            igdb_id: number | null;
            platform_id: number;
            title: string | null;
          }>;
          const ownedKeys = new Set<string>();
          for (const g of existingGames) {
            const effPid = parentMap.get(g.platform_id) || g.platform_id;
            if (g.igdb_id) {
              ownedKeys.add(`igdb:${g.igdb_id}:${effPid}`);
            }
            if (g.title) {
              ownedKeys.add(
                `raw:${g.title.toLowerCase().replace(/[^a-z0-9]/g, '')}:${effPid}`,
              );
              ownedKeys.add(
                `norm:${normalizeTitleForMatching(g.title)}:${effPid}`,
              );
            }
          }

          const canonicalRows = db
            .prepare(
              `SELECT id, platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, serial_code, barcode, publisher, is_verified_physical
               FROM canonical_releases`,
            )
            .all() as CanonicalRelease[];

          const scanResults: unknown[] = [];

          if (process.env['VITEST']) {
            const gameIdToPlatforms = new Map<number, Set<number>>();
            for (const seriesName of seriesNames) {
              const collections = (await queryIGDB(
                'collections',
                `fields id, name; search "${seriesName.replace(/"/g, '')}"; limit 3;`,
              )) as { id: number; name: string }[];

              for (const col of collections || []) {
                if (
                  col.name.toLowerCase().includes(seriesName.toLowerCase()) ||
                  seriesName.toLowerCase().includes(col.name.toLowerCase())
                ) {
                  const collectionGames = await getCollectionGames(col.id);
                  for (const game of collectionGames) {
                    const gamePlatforms = game.platforms || [];
                    const matchingPlatforms = gamePlatforms.filter((p) => {
                      const localPid = igdbToLocalPlatformId[p.id];
                      return (
                        localPid &&
                        !ownedKeys.has(`igdb:${game.id}:${localPid}`)
                      );
                    });

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
              const hydratedGames = await getGamesByIds(uniqueGameIds);
              const emittedKeys = new Set<string>();

              for (const game of hydratedGames) {
                const numericId = Number(game.id.replace('igdb-', ''));
                const platformIds = Array.from(
                  gameIdToPlatforms.get(numericId) || [],
                );

                for (const igdbPlatformId of platformIds) {
                  const localPlatformId = igdbToLocalPlatformId[igdbPlatformId];
                  const platformName = igdbToLocalPlatformName[igdbPlatformId];
                  if (!localPlatformId) continue;

                  const emitKey = `${numericId}:${localPlatformId}`;
                  if (emittedKeys.has(emitKey)) continue;

                  if (ownedKeys.has(`igdb:${numericId}:${localPlatformId}`)) {
                    continue;
                  }
                  emittedKeys.add(emitKey);

                  const localPlatformRow = dbPlatforms.find(
                    (p) => p.id === localPlatformId,
                  );

                  const verification = detectPhysicalReleaseStatus({
                    platformId: localPlatformId,
                    gameTitle: game.name,
                    alternativeNames: game.alternative_names,
                    firstReleaseDate: game.release_date || null,
                    platformLaunchDate: localPlatformRow?.launch_date || null,
                    igdbCategory:
                      game.game_type ??
                      (game as unknown as { category?: number }).category,
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
                    region: game.region || 'USA',
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
          } else {
            const SERIES_PER_BLOCK = 15;
            const BLOCKS_PER_MULTIQUERY = 10;
            const seriesBlocks: string[][] = [];
            for (let i = 0; i < seriesNames.length; i += SERIES_PER_BLOCK) {
              seriesBlocks.push(seriesNames.slice(i, i + SERIES_PER_BLOCK));
            }

            const emittedKeys = new Set<string>();
            const igdbFields =
              'id, name, cover.url, first_release_date, summary, genres.name, url, collections.name, franchises.name, platforms.id, platforms.name, category, game_type, alternative_names.name, alternative_names.comment, game_localizations.name, game_localizations.region, game_localizations.cover.url, release_dates.platform, release_dates.region, release_dates.date, involved_companies.company.name, involved_companies.publisher';

            for (
              let b = 0;
              b < seriesBlocks.length;
              b += BLOCKS_PER_MULTIQUERY
            ) {
              const group = seriesBlocks.slice(b, b + BLOCKS_PER_MULTIQUERY);
              const multiqueryBody = group
                .map((names, idx) => {
                  const quoted = names
                    .map((n) => `"${n.replace(/["\\]/g, '')}"`)
                    .join(',');
                  return `query games "b${idx}" { fields ${igdbFields}; where collections.name = (${quoted}) | franchises.name = (${quoted}); limit 500; };`;
                })
                .join('\n');

              const mqResult = (await queryIGDB(
                'multiquery',
                multiqueryBody,
              )) as Array<{ name: string; result?: IGDBGame[] }>;

              for (const block of mqResult || []) {
                for (const g of block.result || []) {
                  if (!g.platforms) continue;
                  for (const plat of g.platforms) {
                    const localPlatformId = igdbToLocalPlatformId[plat.id];
                    const platformName = igdbToLocalPlatformName[plat.id];
                    if (!localPlatformId) continue;

                    const emitKey = `${g.id}:${localPlatformId}`;
                    if (emittedKeys.has(emitKey)) continue;

                    const rawKey = `raw:${(g.name || '').toLowerCase().replace(/[^a-z0-9]/g, '')}:${localPlatformId}`;
                    const normKey = `norm:${normalizeTitleForMatching(g.name || '')}:${localPlatformId}`;
                    if (
                      ownedKeys.has(`igdb:${g.id}:${localPlatformId}`) ||
                      ownedKeys.has(rawKey) ||
                      ownedKeys.has(normKey)
                    ) {
                      continue;
                    }
                    emittedKeys.add(emitKey);

                    const localPlatformRow = dbPlatforms.find(
                      (p) => p.id === localPlatformId,
                    );
                    const publisherName =
                      (
                        g as unknown as {
                          involved_companies?: Array<{
                            company?: { name: string };
                            publisher?: boolean;
                          }>;
                        }
                      ).involved_companies?.find((ic) => ic.publisher)?.company
                        ?.name || null;

                    const verification = detectPhysicalReleaseStatus({
                      platformId: localPlatformId,
                      gameTitle: g.name,
                      alternativeNames: g.alternative_names,
                      firstReleaseDate: g.first_release_date || null,
                      platformLaunchDate: localPlatformRow?.launch_date || null,
                      publisher: publisherName,
                      igdbCategory: g.game_type ?? g.category,
                      canonicalReleases: canonicalRows,
                    });

                    if (
                      filterDigital &&
                      verification.physical_status === 'digital_only'
                    ) {
                      continue;
                    }

                    let imageUrl: string | null = null;
                    if (g.cover?.url) {
                      imageUrl = g.cover.url.startsWith('//')
                        ? `https:${g.cover.url}`
                        : g.cover.url;
                      imageUrl = imageUrl.replace('/t_thumb/', '/t_cover_big/');
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
                        image_url:
                          resolveRegionalCoverUrl(
                            { game_localizations: g.game_localizations },
                            mr.region,
                          ) || null,
                      }));

                    const releaseDateStr = g.first_release_date
                      ? new Date(g.first_release_date * 1000)
                          .toISOString()
                          .split('T')[0]
                      : null;

                    scanResults.push({
                      id: `igdb-${g.id}`,
                      title: g.name,
                      summary: g.summary || null,
                      image_url: imageUrl,
                      platform: platformName,
                      platform_id: localPlatformId,
                      genres: g.genres?.map((ge) => ge.name).join(', ') || null,
                      collections:
                        g.collections?.map((c) => c.name).join(', ') || null,
                      franchises:
                        g.franchises?.map((f) => f.name).join(', ') || null,
                      region:
                        verification.physical_regions.length === 1 &&
                        verification.physical_regions[0] === 'Japan'
                          ? 'Japan'
                          : 'USA',
                      release_date: releaseDateStr,
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
            }
          }

          res.setHeader('Content-Type', 'application/json');
          if (isPaged) {
            res.end(
              JSON.stringify({
                suggestions: scanResults,
                offset,
                limit,
                totalSeries: totalSeriesCount,
                hasMore: offset + limit < totalSeriesCount,
              }),
            );
          } else {
            res.end(JSON.stringify(scanResults));
          }
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
        const platformId =
          url.searchParams.get('platform') ||
          url.searchParams.get('platform_id');
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
        const game = db.prepare(query).get(id, id, id) as
          | (Record<string, unknown> & {
              releases?: Array<Record<string, unknown>>;
              rom_name?: string | null;
              rom_crc?: string | null;
              stable_id?: number;
              title?: string;
              platform_id?: number;
              region?: string | null;
              variants?: string | null;
              id?: string;
              backup_status?: number;
              ownership_status?: number;
              release_date?: string | null;
            })
          | undefined;

        if (!game) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'Not found' }));
        } else {
          if (game.rom_name) {
            const releases = db
              .prepare(GAME_RELEASES_BY_GAME_ID_QUERY)
              .all(game.stable_id, game.region, game.variants) as Array<
              Record<string, unknown> & { rom_name: string | null }
            >;
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

          if (game.platform_id) {
            const candidateReleases: CompanionDiscCandidateRow[] = [];
            const seenCandidateIds = new Set<string>();

            // 1. Target companion releases by rom_crc across all releases in this game
            const releasesToCheck =
              game.releases && game.releases.length > 0
                ? game.releases
                : [game];
            for (const rel of releasesToCheck) {
              const relCrc = (rel['rom_crc'] as string | null) || null;
              const relId = (rel['id'] as string | null) || null;
              if (relCrc) {
                const rows = db
                  .prepare(TARGETED_COMPANION_BY_CRC_QUERY)
                  .all(relCrc, relId || '') as CompanionDiscCandidateRow[];
                for (const r of rows) {
                  if (!seenCandidateIds.has(r.id)) {
                    seenCandidateIds.add(r.id);
                    candidateReleases.push(r);
                  }
                }
              }
            }

            // 2. Target companion releases by related game IDs (e.g. Superseded pairs)
            const relatedIds = getRelatedGameIdsForCompanion(game);
            for (const relStableId of relatedIds) {
              const rows = db
                .prepare(TARGETED_COMPANION_BY_GAME_ID_QUERY)
                .all(relStableId) as CompanionDiscCandidateRow[];
              for (const r of rows) {
                if (!seenCandidateIds.has(r.id)) {
                  seenCandidateIds.add(r.id);
                  candidateReleases.push(r);
                }
              }
            }

            // 3. Target companion releases by related game titles (e.g. Box sets and standalone counterparts)
            const relatedTitles = getRelatedGameTitlesForCompanion(game);
            for (const title of relatedTitles) {
              const rows = db
                .prepare(TARGETED_COMPANION_BY_TITLE_QUERY)
                .all(game.platform_id, title) as CompanionDiscCandidateRow[];
              for (const r of rows) {
                if (!seenCandidateIds.has(r.id)) {
                  seenCandidateIds.add(r.id);
                  candidateReleases.push(r);
                }
              }
            }

            enrichGameDetailWithCompanionsAndVouchers(game, candidateReleases);
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

      // POST /api/retail/sync-deals
      else if (req.method === 'POST' && pathname === '/api/retail/sync-deals') {
        try {
          const apiKey = process.env['BESTBUY_API_KEY'];
          const { deals, sources } = await fetchAllRetailDeals({
            bestBuyApiKey: apiKey,
          });
          const candidates = db
            .prepare(
              `SELECT g.stable_id, g.title, g.platform_id, COALESCE(r.barcode, g.barcode) as barcode
               FROM games g
               LEFT JOIN game_releases r ON r.game_id = g.stable_id`,
            )
            .all() as CandidateGame[];

          const bestDealByGame = new Map<number, RetailDealItem>();
          for (const deal of deals) {
            const stableId = matchBestBuyProduct(deal, candidates);
            if (stableId !== null) {
              const existing = bestDealByGame.get(stableId);
              if (!existing || deal.salePrice < existing.salePrice) {
                bestDealByGame.set(stableId, deal);
              }
            }
          }

          db.prepare(
            `UPDATE games SET retail_on_sale = 0 WHERE retail_store IN ('Best Buy', 'VGP', 'PNP Games')`,
          ).run();

          const updateStmt = db.prepare(`
            UPDATE games
            SET retail_price = ?,
                retail_regular_price = ?,
                retail_discount_pct = ?,
                retail_on_sale = 1,
                retail_store = ?,
                retail_url = ?,
                retail_updated_at = ?
            WHERE stable_id = ?
          `);

          const nowIso = new Date().toISOString();

          const batch = db.transaction(() => {
            for (const [stableId, deal] of bestDealByGame.entries()) {
              updateStmt.run(
                Math.round(deal.salePrice * 100),
                Math.round(deal.regularPrice * 100),
                Math.round(Number(deal.percentSavings) || 0),
                deal.store,
                deal.url,
                nowIso,
                stableId,
              );
            }
          });
          batch();

          res.end(
            JSON.stringify({
              success: true,
              matchedCount: bestDealByGame.size,
              totalDeals: deals.length,
              sources,
            }),
          );
        } catch (syncErr: unknown) {
          const msg =
            syncErr instanceof Error ? syncErr.message : String(syncErr);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: msg }));
        }
      }

      // GET /api/config
      else if (req.method === 'GET' && pathname === '/api/config') {
        const appName = process.env['APP_NAME'] || 'Collection Tracker';
        const shortName =
          process.env['APP_SHORT_NAME'] || process.env['APP_NAME'] || 'Tracker';
        const tagline =
          process.env['APP_TAGLINE'] ||
          'Physical Game & Toy Collection Tracker';
        const authorName = process.env['APP_AUTHOR'] || appName;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            appName,
            shortName,
            tagline,
            authorName,
            logoUrl: '/favicon.svg',
          }),
        );
      }

      // GET /manifest.webmanifest
      else if (req.method === 'GET' && pathname === '/manifest.webmanifest') {
        const appName = process.env['APP_NAME'] || 'Collection Tracker';
        const shortName =
          process.env['APP_SHORT_NAME'] || process.env['APP_NAME'] || 'Tracker';
        res.setHeader(
          'Content-Type',
          'application/manifest+json; charset=utf-8',
        );
        res.end(
          JSON.stringify({
            name: appName,
            short_name: shortName,
            start_url: '/',
            display: 'standalone',
            background_color: '#121214',
            theme_color: '#121214',
            icons: [
              {
                src: '/favicon.svg',
                sizes: 'any',
                type: 'image/svg+xml',
                purpose: 'any',
              },
              {
                src: '/icons/icon-192.png',
                sizes: '192x192',
                type: 'image/png',
                purpose: 'any',
              },
              {
                src: '/icons/icon-512.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'any',
              },
              {
                src: '/icons/icon-maskable-512.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'maskable',
              },
              {
                src: '/icons/badge-96.png',
                sizes: '96x96',
                type: 'image/png',
                purpose: 'monochrome',
              },
            ],
          }),
        );
      }

      // GET /api/notifications/vapid-public-key
      else if (
        req.method === 'GET' &&
        pathname === '/api/notifications/vapid-public-key'
      ) {
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            publicKey:
              process.env['VAPID_PUBLIC_KEY'] || DEFAULT_VAPID_PUBLIC_KEY,
          }),
        );
      }

      // POST /api/notifications/subscribe
      else if (
        req.method === 'POST' &&
        pathname === '/api/notifications/subscribe'
      ) {
        try {
          const body = await new Promise<string>((resolve, reject) => {
            let data = '';
            req.on('data', (chunk) => (data += chunk));
            req.on('end', () => resolve(data));
            req.on('error', (err) => reject(err));
          });

          const payload = JSON.parse(body);
          if (
            !payload?.endpoint ||
            !payload?.keys?.p256dh ||
            !payload?.keys?.auth
          ) {
            res.statusCode = 400;
            res.end(
              JSON.stringify({
                error:
                  'Invalid payload: endpoint and keys (p256dh, auth) are required.',
              }),
            );
            return;
          }

          const id = crypto.randomUUID();
          const nowIso = new Date().toISOString();
          const userAgent = req.headers['user-agent'] || null;
          const prefsJson = JSON.stringify(payload.preferences || {});

          db.prepare(
            `INSERT INTO push_subscriptions (
               id, endpoint, p256dh, auth, preferences_json, user_agent, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(endpoint) DO UPDATE SET
               p256dh = excluded.p256dh,
               auth = excluded.auth,
               preferences_json = excluded.preferences_json,
               user_agent = excluded.user_agent,
               updated_at = excluded.updated_at`,
          ).run(
            id,
            payload.endpoint,
            payload.keys.p256dh,
            payload.keys.auth,
            prefsJson,
            userAgent,
            nowIso,
            nowIso,
          );

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true, id }));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: msg }));
        }
      }

      // PUT /api/notifications/preferences
      else if (
        req.method === 'PUT' &&
        pathname === '/api/notifications/preferences'
      ) {
        try {
          const body = await new Promise<string>((resolve, reject) => {
            let data = '';
            req.on('data', (chunk) => (data += chunk));
            req.on('end', () => resolve(data));
            req.on('error', (err) => reject(err));
          });

          const payload = JSON.parse(body);
          if (!payload?.endpoint || !payload?.preferences) {
            res.statusCode = 400;
            res.end(
              JSON.stringify({
                error: 'Invalid payload: endpoint and preferences required.',
              }),
            );
            return;
          }

          const nowIso = new Date().toISOString();
          const prefsJson = JSON.stringify(payload.preferences);

          db.prepare(
            `UPDATE push_subscriptions
             SET preferences_json = ?, updated_at = ?
             WHERE endpoint = ?`,
          ).run(prefsJson, nowIso, payload.endpoint);

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true }));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: msg }));
        }
      }

      // POST /api/notifications/unsubscribe
      else if (
        req.method === 'POST' &&
        pathname === '/api/notifications/unsubscribe'
      ) {
        try {
          const body = await new Promise<string>((resolve, reject) => {
            let data = '';
            req.on('data', (chunk) => (data += chunk));
            req.on('end', () => resolve(data));
            req.on('error', (err) => reject(err));
          });

          const { endpoint } = JSON.parse(body);
          if (!endpoint) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Endpoint is required.' }));
            return;
          }

          db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(
            endpoint,
          );

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true }));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: msg }));
        }
      }

      // POST /api/notifications/test
      else if (
        req.method === 'POST' &&
        pathname === '/api/notifications/test'
      ) {
        try {
          const body = await new Promise<string>((resolve, reject) => {
            let data = '';
            req.on('data', (chunk) => (data += chunk));
            req.on('end', () => resolve(data));
            req.on('error', (err) => reject(err));
          });

          const { endpoint } = JSON.parse(body);
          if (!endpoint) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Endpoint is required.' }));
            return;
          }

          const sub = db
            .prepare(
              'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE endpoint = ?',
            )
            .get(endpoint) as
            | { endpoint: string; p256dh: string; auth: string }
            | undefined;

          if (!sub) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Subscription not found.' }));
            return;
          }

          const result = await sendWebPushNotification(
            sub,
            {
              title: '🔔 Deal Alerts Active',
              body: 'Push notifications are successfully configured for your device!',
              icon: '/icons/icon-192.png',
              badge: '/icons/badge-96.png',
              data: { url: '/' },
            },
            {
              publicKey: process.env['VAPID_PUBLIC_KEY'],
            },
          );

          if (result.shouldDelete) {
            db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(
              endpoint,
            );
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: msg }));
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

// Only start the server if this file is run directly
import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = getDatabase();
  const server = http.createServer(handleRequest(db));
  server.listen(PORT, () => {
    console.log(
      `Standalone Local API Server running at http://localhost:${PORT}`,
    );
  });
}
