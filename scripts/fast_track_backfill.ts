/**
 * FAST-TRACK BACKFILL & SELF-HEALING LOCAL RUNNER
 *
 * Designed for temporarily elevated Cloudflare Paid Tier D1 write quota (or
 * unlimited local SQLite execution). Reuses pure production matching, title
 * resolution, series classification, and admission-gate logic to execute
 * backlogs locally with persistent IGDB disk caching and emit chunked,
 * idempotent SQL files bounded by `--max-chunk-writes` (default: 45,000 D1
 * billable writes per chunk).
 *
 * STAGES:
 *   - `seed`:             Promote unseeded verified `canonical_releases` past `catalog_seed_cursor`
 *   - `igdb-backfill`:    Match bare games (`igdb_id IS NULL AND summary IS NULL AND image_url IS NULL`)
 *   - `rolling`:          Diff-guarded IGDB metadata/series refresh + passive NULL release_date backfill + silent rule heal
 *   - `series-discovery`: Discover physical IGDB titles for active watched series rules silently (no push)
 *   - `all`:              Runs `seed` -> `igdb-backfill` -> `rolling` -> `series-discovery` sequentially
 *
 * USAGE:
 *   npx tsx scripts/fast_track_backfill.ts --stage=all --dry-run
 *   npx tsx scripts/fast_track_backfill.ts --stage=seed --max-chunk-writes=45000
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  CanonicalRelease,
  detectPhysicalReleaseStatus,
} from '../shared/canonical_releases.js';
import { computeGameCanonicalSeries } from '../shared/canonical_series.js';
import { isOfficialIGDBGame } from '../shared/queries.js';
import {
  normalizeTitleForMatching,
  isCompilationOrBundleTitle,
  resolveCanonicalDisplayTitle,
} from '../shared/title_matching.js';
import {
  isIgnoredFormatRelease,
  isPackInCompanionDemoRom,
  isRegionMatchingHome,
} from '../shared/source_format.js';
import {
  buildIgdbSearchTokens,
  cleanCanonicalDisplayTitle,
  extractIgdbPlatformIds,
  getIgdbCompanionPlatformIds,
  isSeriesTrackable,
  resolveIgdbPlatformReleaseDate,
  selectStrictIgdbMatch,
  shouldSuppressCrossGenBasePlatform,
} from '../worker/worker.js';
import { getLocalDatabase } from './lib/db.js';
import { stripEditionSuffix } from './lib/reconcile_releases.js';

export type FastTrackStage =
  | 'seed'
  | 'igdb-backfill'
  | 'rolling'
  | 'series-discovery'
  | 'all';

export interface FastTrackOptions {
  stage?: FastTrackStage;
  dbPath?: string;
  db?: Database.Database;
  outDir?: string;
  dryRun?: boolean;
  maxChunkWrites?: number;
  igdbCachePath?: string;
  limit?: number;
  delayMs?: number;
  fetchFn?: typeof fetch;
  twitchClientId?: string;
  twitchClientSecret?: string;
}

export interface FastTrackSummary {
  stage: FastTrackStage;
  dryRun: boolean;
  outDir: string;
  chunkFiles: string[];
  totalEstimatedWrites: number;
  igdbCacheHits: number;
  igdbNetworkCalls: number;
  seed: {
    cursor: number;
    scannedGroups: number;
    insertedGames: number;
    insertedReleases: number;
    rulesApplied: number;
  };
  igdbBackfill: {
    scannedGames: number;
    matchedGames: number;
    updatedReleaseDates: number;
    rulesApplied: number;
  };
  rolling: {
    scannedGames: number;
    updatedGames: number;
    updatedReleaseDates: number;
    rulesApplied: number;
  };
  seriesDiscovery: {
    seriesScanned: number;
    insertedGames: number;
    insertedReleases: number;
    rulesApplied: number;
  };
}

export interface IgdbCandidateRecord {
  id: number;
  name?: string;
  url?: string;
  summary?: string;
  first_release_date?: number;
  cover?: { image_id?: string; url?: string };
  genres?: Array<{ name: string }>;
  collections?: Array<{ name: string }>;
  franchises?: Array<{ name: string }>;
  platforms?: Array<number | { id: number; name?: string }>;
  alternative_names?: Array<{ name: string; comment?: string }>;
  game_localizations?: Array<{ name: string; region?: number }>;
  release_dates?: Array<{
    platform?: number;
    region?: number;
    release_region?: number;
    date?: number;
  }>;
  remasters?: Array<
    | number
    | { id: number; name?: string; platforms?: Array<number | { id: number }> }
  >;
  expanded_games?: Array<
    | number
    | { id: number; name?: string; platforms?: Array<number | { id: number }> }
  >;
  ports?: Array<
    | number
    | { id: number; name?: string; platforms?: Array<number | { id: number }> }
  >;
  category?: number;
  game_type?: number;
  game_format?: number | string | { id?: number; name?: string };
  packaging?: number | { id?: number };
  involved_companies?: Array<{
    company?: { name: string };
    publisher?: boolean;
  }>;
}

interface IgdbMetaNormalized {
  igdb_id: number;
  name: string | null;
  igdb_url: string | null;
  image_url: string | null;
  summary: string | null;
  genres: string | null;
  collections: string | null;
  franchises: string | null;
  first_release_date: number | null;
  release_dates: NonNullable<IgdbCandidateRecord['release_dates']>;
  metadata_json: string | null;
}

interface IgdbDiskCache {
  titles: Record<string, IgdbCandidateRecord | null>;
  byId: Record<string, IgdbCandidateRecord | null>;
  series: Record<string, IgdbCandidateRecord[]>;
}

interface PlatformMeta {
  id: number;
  name: string;
  displayName: string;
  igdbId: number | null;
  launchDate: string | null;
  parentPlatformId: number | null;
}

interface GameStateRecord {
  stable_id: number;
  id: string;
  title: string;
  platform_id: number;
  region: string | null;
  igdb_id: number | null;
  igdb_url: string | null;
  image_url: string | null;
  summary: string | null;
  genres: string | null;
  collections: string | null;
  franchises: string | null;
  canonical_series: string | null;
  metadata_json: string | null;
  bundle_parent_id: number | null;
}

interface ReleaseStateRecord {
  id: string;
  game_id: number;
  region: string | null;
  variants: string | null;
  rom_name: string | null;
  rom_crc: string | null;
  release_date: string | null;
  canonical_release_id: number | null;
}

interface TrackingRuleRow {
  user_id: number;
  rule_type: string;
  match_value: string;
  target_status: number;
  region_scope: string;
  home_region: string;
  auto_seek_release_scope: 'one_per_game' | 'all_releases';
}

interface WeightedStatement {
  sql: string;
  writes: number;
}

const VALID_STAGES = new Set<FastTrackStage>([
  'seed',
  'igdb-backfill',
  'rolling',
  'series-discovery',
  'all',
]);

export function parseFastTrackStage(raw?: string): FastTrackStage {
  const val = (raw || 'all').trim().toLowerCase() as FastTrackStage;
  if (!VALID_STAGES.has(val)) {
    throw new Error(
      `Invalid --stage="${raw}". Expected: seed, igdb-backfill, rolling, series-discovery, or all`,
    );
  }
  return val;
}

function escapeSql(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  return `'${String(val).replace(/'/g, "''")}'`;
}

function sanitizeSearchTerm(raw: string): string {
  return (raw || '').replace(/["\\]/g, '').trim();
}

function toNormalizedIgdbMeta(c: IgdbCandidateRecord): IgdbMetaNormalized {
  let imageUrl: string | null = null;
  if (c.cover?.image_id) {
    imageUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${c.cover.image_id}.jpg`;
  } else if (c.cover?.url) {
    imageUrl = (
      c.cover.url.startsWith('//') ? `https:${c.cover.url}` : c.cover.url
    ).replace('/t_thumb/', '/t_cover_big/');
  }
  const hasLocalized =
    (c.game_localizations && c.game_localizations.length > 0) ||
    (c.alternative_names && c.alternative_names.length > 0);
  return {
    igdb_id: c.id,
    name: c.name?.trim() || null,
    igdb_url: c.url || null,
    image_url: imageUrl,
    summary: c.summary || null,
    genres: c.genres?.map((g) => g.name).join(', ') || null,
    collections: c.collections?.map((x) => x.name).join(', ') || null,
    franchises: c.franchises?.map((x) => x.name).join(', ') || null,
    first_release_date: c.first_release_date ?? null,
    release_dates: c.release_dates || [],
    metadata_json: hasLocalized
      ? JSON.stringify({
          game_localizations: c.game_localizations || [],
          alternative_names: c.alternative_names || [],
        })
      : null,
  };
}

function loadTwitchCredentialsFromDevVars(): {
  clientId?: string;
  clientSecret?: string;
} {
  const devVarsPath = path.join(process.cwd(), '.dev.vars');
  if (!fs.existsSync(devVarsPath)) return {};
  const lines = fs.readFileSync(devVarsPath, 'utf8').split(/\r?\n/);
  let clientId: string | undefined;
  let clientSecret: string | undefined;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const k = trimmed.slice(0, eqIdx).trim();
    const v = trimmed
      .slice(eqIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (k === 'TWITCH_CLIENT_ID' && v) clientId = v;
    if (k === 'TWITCH_CLIENT_SECRET' && v) clientSecret = v;
  }
  return { clientId, clientSecret };
}

class IgdbClientWithDiskCache {
  private cache: IgdbDiskCache = { titles: {}, byId: {}, series: {} };
  private dirtyCount = 0;
  private accessToken: string | null = null;
  public cacheHits = 0;
  public networkCalls = 0;

  constructor(
    private readonly cachePath: string,
    private readonly fetchFn: typeof fetch,
    private readonly delayMs: number,
    private readonly clientId?: string,
    private readonly clientSecret?: string,
  ) {
    if (fs.existsSync(cachePath)) {
      try {
        const parsed = JSON.parse(
          fs.readFileSync(cachePath, 'utf8'),
        ) as Partial<IgdbDiskCache>;
        this.cache = {
          titles: parsed.titles || {},
          byId: parsed.byId || {},
          series: parsed.series || {},
        };
      } catch {
        // Ignore corrupt cache and start clean
      }
    }
  }

  flushCache(): void {
    if (this.dirtyCount === 0 && fs.existsSync(this.cachePath)) return;
    fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
    fs.writeFileSync(this.cachePath, JSON.stringify(this.cache), 'utf8');
    this.dirtyCount = 0;
  }

  private async ensureToken(): Promise<string | null> {
    if (this.accessToken) return this.accessToken;
    if (!this.clientId || !this.clientSecret) return null;

    const url = `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(this.clientId)}&client_secret=${encodeURIComponent(this.clientSecret)}&grant_type=client_credentials`;
    const res = await this.fetchFn(url, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string };
    this.accessToken = data.access_token || null;
    return this.accessToken;
  }

  private async postIgdb(
    endpoint: 'games' | 'multiquery',
    body: string,
  ): Promise<unknown> {
    const token = await this.ensureToken();
    if (!token || !this.clientId) return null;

    for (let attempt = 0; attempt <= 3; attempt++) {
      if (this.delayMs > 0) {
        await new Promise((r) => setTimeout(r, this.delayMs));
      }
      this.networkCalls++;
      const res = await this.fetchFn(`https://api.igdb.com/v4/${endpoint}`, {
        method: 'POST',
        headers: {
          'Client-ID': this.clientId,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'text/plain',
        },
        body,
        signal: AbortSignal.timeout(25000),
      });
      if (res.status === 429 && attempt < 3) {
        await new Promise((r) =>
          setTimeout(r, Math.max(500, (attempt + 1) * 1000)),
        );
        continue;
      }
      if (!res.ok) return null;
      return res.json();
    }
    return null;
  }

  async resolveTitles(
    items: Array<{
      key: string;
      title: string;
      normalizedTitle: string;
      igdbPlatformId: number | null;
      platformLaunchDate?: string | null;
    }>,
  ): Promise<Map<string, IgdbMetaNormalized>> {
    const out = new Map<string, IgdbMetaNormalized>();
    const toFetch: typeof items = [];

    for (const item of items) {
      if (!item.igdbPlatformId || !item.normalizedTitle) continue;
      const cacheKey = `${item.igdbPlatformId}::${item.normalizedTitle}`;
      if (Object.prototype.hasOwnProperty.call(this.cache.titles, cacheKey)) {
        this.cacheHits++;
        const cached = this.cache.titles[cacheKey];
        if (cached) out.set(item.key, toNormalizedIgdbMeta(cached));
      } else {
        toFetch.push(item);
      }
    }

    const CHUNK = 10;
    for (let i = 0; i < toFetch.length; i += CHUNK) {
      const slice = toFetch.slice(i, i + CHUNK);
      const validSlice = slice.filter(
        (s) => buildIgdbSearchTokens(s.title).length > 0,
      );
      if (validSlice.length === 0) continue;

      const body = validSlice
        .map((item, idx) => {
          const tokens = buildIgdbSearchTokens(item.title);
          const pIds = getIgdbCompanionPlatformIds(
            item.igdbPlatformId as number,
          ).join(',');
          const clause = (field: string) =>
            tokens.length === 1
              ? `${field} ~ *"${tokens[0]}"*`
              : `(${tokens.map((t) => `${field} ~ *"${t}"*`).join(' & ')})`;
          return `query games "q${idx}" { fields id, name, url, summary, first_release_date, cover.image_id, cover.url, genres.name, collections.name, franchises.name, platforms, alternative_names.name, alternative_names.comment, game_localizations.name, game_localizations.region, release_dates.platform, release_dates.region, release_dates.release_region, release_dates.date, remasters.id, remasters.name, remasters.platforms, expanded_games.id, expanded_games.name, expanded_games.platforms, ports.id, ports.name, ports.platforms; where platforms = (${pIds}) & (${clause('name')} | ${clause('alternative_names.name')} | ${clause('game_localizations.name')}); sort id asc; limit 50; };`;
        })
        .join('\n');

      const res = (await this.postIgdb('multiquery', body)) as Array<{
        name: string;
        result?: IgdbCandidateRecord[];
      }> | null;
      if (!res) continue;

      const resolvedIdx = new Set<number>();
      for (const entry of res) {
        const idx = parseInt((entry.name || '').replace(/^q/, ''), 10);
        const item = Number.isFinite(idx) ? validSlice[idx] : undefined;
        if (!item) continue;
        resolvedIdx.add(idx);
        const cacheKey = `${item.igdbPlatformId}::${item.normalizedTitle}`;
        const matched = selectStrictIgdbMatch(
          entry.result || [],
          item.normalizedTitle,
          item.igdbPlatformId as number,
          { platformLaunchDate: item.platformLaunchDate },
        ) as IgdbCandidateRecord | null;
        this.cache.titles[cacheKey] = matched || null;
        this.dirtyCount++;
        if (matched) {
          this.cache.byId[String(matched.id)] = matched;
          out.set(item.key, toNormalizedIgdbMeta(matched));
        }
      }
      for (let idx = 0; idx < validSlice.length; idx++) {
        if (!resolvedIdx.has(idx)) {
          const item = validSlice[idx];
          this.cache.titles[`${item.igdbPlatformId}::${item.normalizedTitle}`] =
            null;
          this.dirtyCount++;
        }
      }
      if (this.dirtyCount >= 20) this.flushCache();
      const batchNum = Math.floor(i / CHUNK) + 1;
      const totalBatches = Math.ceil(toFetch.length / CHUNK);
      if (batchNum === 1 || batchNum % 25 === 0 || batchNum === totalBatches) {
        console.log(
          `[FastTrack:IGDB] resolveTitles batch ${batchNum}/${totalBatches} (network=${this.networkCalls}, cacheHits=${this.cacheHits})`,
        );
      }
    }

    return out;
  }

  async resolveByIds(ids: number[]): Promise<Map<number, IgdbCandidateRecord>> {
    const out = new Map<number, IgdbCandidateRecord>();
    const missing: number[] = [];

    for (const id of ids) {
      const key = String(id);
      if (Object.prototype.hasOwnProperty.call(this.cache.byId, key)) {
        this.cacheHits++;
        const cached = this.cache.byId[key];
        if (cached) out.set(id, cached);
      } else {
        missing.push(id);
      }
    }

    const CHUNK = 50;
    for (let i = 0; i < missing.length; i += CHUNK) {
      const slice = missing.slice(i, i + CHUNK);
      const body = `fields id, name, url, summary, first_release_date, cover.image_id, cover.url, genres.name, collections.name, franchises.name, platforms, alternative_names.name, alternative_names.comment, game_localizations.name, game_localizations.region, release_dates.platform, release_dates.region, release_dates.release_region, release_dates.date; where id = (${slice.join(',')}); limit ${slice.length};`;
      const res = (await this.postIgdb('games', body)) as
        | IgdbCandidateRecord[]
        | null;
      if (!res) continue;

      const foundIds = new Set<number>();
      for (const c of res) {
        if (!c || !c.id) continue;
        foundIds.add(c.id);
        this.cache.byId[String(c.id)] = c;
        this.dirtyCount++;
        out.set(c.id, c);
      }
      for (const id of slice) {
        if (!foundIds.has(id)) {
          this.cache.byId[String(id)] = null;
          this.dirtyCount++;
        }
      }
      if (this.dirtyCount >= 20) this.flushCache();
      const batchNum = Math.floor(i / CHUNK) + 1;
      const totalBatches = Math.ceil(missing.length / CHUNK);
      if (batchNum === 1 || batchNum % 25 === 0 || batchNum === totalBatches) {
        console.log(
          `[FastTrack:IGDB] resolveByIds batch ${batchNum}/${totalBatches} (network=${this.networkCalls}, cacheHits=${this.cacheHits})`,
        );
      }
    }

    return out;
  }

  async resolveSeriesCandidates(
    seriesNames: string[],
    trackedIgdbIds: number[],
  ): Promise<Map<string, IgdbCandidateRecord[]>> {
    const out = new Map<string, IgdbCandidateRecord[]>();
    const missing: string[] = [];

    for (const name of seriesNames) {
      const key = name.trim().toLowerCase();
      if (Object.prototype.hasOwnProperty.call(this.cache.series, key)) {
        this.cacheHits++;
        out.set(name, this.cache.series[key] || []);
      } else {
        missing.push(name);
      }
    }

    if (missing.length > 0 && trackedIgdbIds.length > 0) {
      const platformList = trackedIgdbIds.join(',');
      const CHUNK = 10;
      for (let i = 0; i < missing.length; i += CHUNK) {
        const slice = missing.slice(i, i + CHUNK);
        const body = slice
          .map((seriesName, idx) => {
            const term = sanitizeSearchTerm(seriesName);
            return `query games "s${idx}" { fields name, cover.url, cover.image_id, first_release_date, platforms.id, platforms.name, summary, genres.name, url, collections.name, franchises.name, category, game_type, game_format, packaging, alternative_names.name, alternative_names.comment, game_localizations.name, game_localizations.region, release_dates.platform, release_dates.region, release_dates.release_region, release_dates.date, remasters.id, remasters.name, remasters.platforms, expanded_games.id, expanded_games.name, expanded_games.platforms, ports.id, ports.name, ports.platforms, involved_companies.company.name, involved_companies.publisher; where (collections.name ~ *"${term}"* | franchises.name ~ *"${term}"*) & platforms = (${platformList}); sort first_release_date desc; limit 50; };`;
          })
          .join('\n');

        const res = (await this.postIgdb('multiquery', body)) as Array<{
          name: string;
          result?: IgdbCandidateRecord[];
        }> | null;
        if (!res) continue;

        const resolvedIdx = new Set<number>();
        for (const entry of res) {
          const idx = parseInt((entry.name || '').replace(/^s/, ''), 10);
          const seriesName = Number.isFinite(idx) ? slice[idx] : undefined;
          if (!seriesName) continue;
          resolvedIdx.add(idx);
          const list = entry.result || [];
          this.cache.series[seriesName.trim().toLowerCase()] = list;
          this.dirtyCount++;
          out.set(seriesName, list);
        }
        for (let idx = 0; idx < slice.length; idx++) {
          if (!resolvedIdx.has(idx)) {
            const seriesName = slice[idx];
            this.cache.series[seriesName.trim().toLowerCase()] = [];
            this.dirtyCount++;
            out.set(seriesName, []);
          }
        }
        if (this.dirtyCount >= 20) this.flushCache();
        const batchNum = Math.floor(i / CHUNK) + 1;
        const totalBatches = Math.ceil(missing.length / CHUNK);
        if (
          batchNum === 1 ||
          batchNum % 25 === 0 ||
          batchNum === totalBatches
        ) {
          console.log(
            `[FastTrack:IGDB] resolveSeriesCandidates batch ${batchNum}/${totalBatches} (network=${this.networkCalls}, cacheHits=${this.cacheHits})`,
          );
        }
      }
    }

    return out;
  }
}

class ChunkedSqlWriter {
  public readonly chunkFiles: string[] = [];
  public totalEstimatedWrites = 0;
  private buffer: WeightedStatement[] = [];
  private bufferWrites = 0;
  private stageChunkIndex = 0;
  private activeStage = '';
  public readonly manifestEntries: Array<{
    stage: string;
    file: string;
    statements: number;
    estimatedWrites: number;
  }> = [];

  constructor(
    private readonly outDir: string,
    private readonly maxChunkWrites: number,
  ) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  startStage(stage: string): void {
    this.flush();
    this.activeStage = stage;
    this.stageChunkIndex = 0;
  }

  writeGroup(statements: WeightedStatement[]): void {
    if (statements.length === 0) return;
    const groupWrites = statements.reduce((acc, s) => acc + s.writes, 0);
    if (
      this.buffer.length > 0 &&
      this.bufferWrites + groupWrites > this.maxChunkWrites
    ) {
      this.flush();
    }
    this.buffer.push(...statements);
    this.bufferWrites += groupWrites;
    this.totalEstimatedWrites += groupWrites;
  }

  flush(): void {
    if (this.buffer.length === 0 || !this.activeStage) return;
    this.stageChunkIndex++;
    const fileName = `${this.activeStage}_chunk_${String(this.stageChunkIndex).padStart(3, '0')}.sql`;
    const filePath = path.join(this.outDir, fileName);
    const header = [
      `-- Fast-Track Backfill SQL (${this.activeStage} chunk ${this.stageChunkIndex}, estimated D1 writes: ${this.bufferWrites})`,
      '',
    ];
    fs.writeFileSync(
      filePath,
      [...header, ...this.buffer.map((s) => s.sql), ''].join('\n'),
      'utf8',
    );
    this.chunkFiles.push(filePath);
    console.log(
      `[FastTrack] Wrote ${fileName} (${this.buffer.length} stmts, ${this.bufferWrites} est D1 writes)`,
    );
    this.manifestEntries.push({
      stage: this.activeStage,
      file: fileName,
      statements: this.buffer.length,
      estimatedWrites: this.bufferWrites,
    });
    this.buffer = [];
    this.bufferWrites = 0;
  }

  writeManifest(summary: FastTrackSummary): void {
    const manifestPath = path.join(this.outDir, 'manifest.json');
    fs.writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          maxChunkWrites: this.maxChunkWrites,
          totalEstimatedWrites: this.totalEstimatedWrites,
          chunks: this.manifestEntries,
          summary,
        },
        null,
        2,
      ),
      'utf8',
    );
  }
}

function nextSeqRelId(gameId: number, usedRelIds: Set<string>): string {
  let maxSeq = 0;
  const prefix = `${gameId}-`;
  for (const id of usedRelIds) {
    if (!id.startsWith(prefix)) continue;
    const suffix = id.slice(prefix.length);
    if (/^\d+$/.test(suffix)) {
      const n = parseInt(suffix, 10);
      if (n > maxSeq) maxSeq = n;
    }
  }
  let seq = maxSeq + 1;
  while (usedRelIds.has(`${gameId}-${seq}`)) {
    seq++;
  }
  const nextId = `${gameId}-${seq}`;
  usedRelIds.add(nextId);
  return nextId;
}

export async function runFastTrackBackfill(
  options: FastTrackOptions = {},
): Promise<FastTrackSummary> {
  const stage: FastTrackStage = options.stage ?? 'all';
  const dryRun = Boolean(options.dryRun);
  const maxChunkWrites = Math.max(100, options.maxChunkWrites ?? 45000);
  const outDir =
    options.outDir || path.join(process.cwd(), 'scripts', 'temp', 'fast_track');
  const igdbCachePath =
    options.igdbCachePath ||
    path.join(process.cwd(), 'data', 'igdb_fast_track_cache.json');
  const ownDb = !options.db;
  const db =
    options.db ||
    (options.dbPath ? new Database(options.dbPath) : getLocalDatabase());

  const devCreds = loadTwitchCredentialsFromDevVars();
  const clientId =
    options.twitchClientId ||
    process.env['TWITCH_CLIENT_ID'] ||
    devCreds.clientId;
  const clientSecret =
    options.twitchClientSecret ||
    process.env['TWITCH_CLIENT_SECRET'] ||
    devCreds.clientSecret;

  const igdbClient = new IgdbClientWithDiskCache(
    igdbCachePath,
    options.fetchFn ?? fetch,
    options.delayMs ?? (options.fetchFn ? 0 : 260),
    clientId,
    clientSecret,
  );
  const writer = new ChunkedSqlWriter(outDir, maxChunkWrites);

  const summary: FastTrackSummary = {
    stage,
    dryRun,
    outDir,
    chunkFiles: writer.chunkFiles,
    totalEstimatedWrites: 0,
    igdbCacheHits: 0,
    igdbNetworkCalls: 0,
    seed: {
      cursor: 0,
      scannedGroups: 0,
      insertedGames: 0,
      insertedReleases: 0,
      rulesApplied: 0,
    },
    igdbBackfill: {
      scannedGames: 0,
      matchedGames: 0,
      updatedReleaseDates: 0,
      rulesApplied: 0,
    },
    rolling: {
      scannedGames: 0,
      updatedGames: 0,
      updatedReleaseDates: 0,
      rulesApplied: 0,
    },
    seriesDiscovery: {
      seriesScanned: 0,
      insertedGames: 0,
      insertedReleases: 0,
      rulesApplied: 0,
    },
  };

  try {
    // Load base reference data & in-memory catalog mirrors so multi-stage dry-runs stay consistent
    const platformRows = db
      .prepare(
        'SELECT id, name, display_name, igdb_id, launch_date, parent_platform_id FROM platforms ORDER BY id ASC',
      )
      .all() as Array<{
      id: number;
      name: string;
      display_name: string | null;
      igdb_id: number | null;
      launch_date: string | null;
      parent_platform_id: number | null;
    }>;

    const platformById = new Map<number, PlatformMeta>();
    const platformByIgdbId = new Map<number, PlatformMeta[]>();
    for (const p of platformRows) {
      const meta: PlatformMeta = {
        id: p.id,
        name: p.name,
        displayName: p.display_name || p.name,
        igdbId: p.igdb_id ?? null,
        launchDate: p.launch_date ?? null,
        parentPlatformId: p.parent_platform_id ?? null,
      };
      platformById.set(p.id, meta);
      if (meta.igdbId && meta.igdbId > 0) {
        const list = platformByIgdbId.get(meta.igdbId) || [];
        list.push(meta);
        platformByIgdbId.set(meta.igdbId, list);
      }
    }

    const gamesRows = db
      .prepare(
        `SELECT stable_id, id, title, platform_id, region, igdb_id, igdb_url, image_url,
                summary, genres, collections, franchises, canonical_series, metadata_json, bundle_parent_id
         FROM games
         ORDER BY stable_id ASC`,
      )
      .all() as GameStateRecord[];

    const gameByStableId = new Map<number, GameStateRecord>();
    const gameByPlatNorm = new Map<string, GameStateRecord>();
    const gameByPlatIgdb = new Map<string, GameStateRecord>();
    const gameByPlatCrc = new Map<string, GameStateRecord>();
    const maxSortByPlatform = new Map<number, number>();
    let maxStableId = 0;

    const sortRows = db
      .prepare(
        'SELECT platform_id, COALESCE(MAX(sort_index), 1000) as max_sort FROM games GROUP BY platform_id',
      )
      .all() as Array<{ platform_id: number; max_sort: number }>;
    for (const sr of sortRows) {
      maxSortByPlatform.set(sr.platform_id, sr.max_sort);
    }

    const registerGameInMemory = (g: GameStateRecord) => {
      if (g.stable_id > maxStableId) maxStableId = g.stable_id;
      gameByStableId.set(g.stable_id, g);
      if (g.igdb_id && g.igdb_id > 0) {
        const k = `${g.platform_id}::${g.igdb_id}`;
        if (!gameByPlatIgdb.has(k)) gameByPlatIgdb.set(k, g);
      }
      const stripped = normalizeTitleForMatching(stripEditionSuffix(g.title));
      if (stripped && !gameByPlatNorm.has(`${g.platform_id}::${stripped}`)) {
        gameByPlatNorm.set(`${g.platform_id}::${stripped}`, g);
      }
      const norm = normalizeTitleForMatching(g.title);
      if (norm) {
        gameByPlatNorm.set(`${g.platform_id}::${norm}`, g);
      }
    };

    for (const g of gamesRows) {
      registerGameInMemory(g);
    }

    const releaseRows = db
      .prepare(
        'SELECT id, game_id, region, variants, rom_name, rom_crc, release_date, canonical_release_id FROM game_releases',
      )
      .all() as ReleaseStateRecord[];
    const releasesByGameId = new Map<number, ReleaseStateRecord[]>();
    const releaseIdsByGameId = new Map<number, Set<string>>();
    const releaseToGameId = new Map<string, number>();

    for (const r of releaseRows) {
      releaseToGameId.set(r.id, r.game_id);
      const list = releasesByGameId.get(r.game_id) || [];
      list.push(r);
      releasesByGameId.set(r.game_id, list);

      const idSet = releaseIdsByGameId.get(r.game_id) || new Set<string>();
      idSet.add(r.id);
      releaseIdsByGameId.set(r.game_id, idSet);

      if (r.rom_crc) {
        const owner = gameByStableId.get(r.game_id);
        if (
          owner &&
          owner.bundle_parent_id == null &&
          !isCompilationOrBundleTitle(owner.title)
        ) {
          const crcKey = `${owner.platform_id}::${r.rom_crc.trim().toUpperCase()}`;
          if (!gameByPlatCrc.has(crcKey)) {
            gameByPlatCrc.set(crcKey, owner);
          }
        }
      }
    }

    // Load active tracking rules + existing user_game_releases keys (silent application: zero push notifications)
    let trackingRules: TrackingRuleRow[] = [];
    const existingTrackedPairs = new Set<string>();
    const existingTrackedGames = new Set<string>();
    try {
      const hasUsersTable = Boolean(
        db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'",
          )
          .get(),
      );
      if (hasUsersTable) {
        try {
          trackingRules = db
            .prepare(
              `SELECT utr.user_id, utr.rule_type, utr.match_value, utr.target_status,
                      COALESCE(utr.region_scope, 'home') as region_scope,
                      COALESCE(u.home_region, 'USA') as home_region,
                      COALESCE(u.auto_seek_release_scope, 'one_per_game') as auto_seek_release_scope
               FROM user_tracking_rules utr
               LEFT JOIN users u ON u.id = utr.user_id
               WHERE utr.is_ignored = 0`,
            )
            .all() as TrackingRuleRow[];
        } catch {
          const fallbackRules = db
            .prepare(
              `SELECT utr.user_id, utr.rule_type, utr.match_value, utr.target_status,
                      COALESCE(utr.region_scope, 'home') as region_scope,
                      COALESCE(u.home_region, 'USA') as home_region
               FROM user_tracking_rules utr
               LEFT JOIN users u ON u.id = utr.user_id
               WHERE utr.is_ignored = 0`,
            )
            .all() as Array<Omit<TrackingRuleRow, 'auto_seek_release_scope'>>;
          trackingRules = fallbackRules.map((r) => ({
            ...r,
            auto_seek_release_scope: 'one_per_game',
          }));
        }
      } else {
        const fallbackRules = db
          .prepare(
            `SELECT user_id, rule_type, match_value, target_status,
                    COALESCE(region_scope, 'home') as region_scope,
                    'USA' as home_region
             FROM user_tracking_rules
             WHERE is_ignored = 0`,
          )
          .all() as Array<Omit<TrackingRuleRow, 'auto_seek_release_scope'>>;
        trackingRules = fallbackRules.map((r) => ({
          ...r,
          auto_seek_release_scope: 'one_per_game',
        }));
      }

      const ugrRows = db
        .prepare(
          'SELECT user_id, release_id, COALESCE(ownership_status, 0) as ownership_status FROM user_game_releases',
        )
        .all() as Array<{
        user_id: number;
        release_id: string;
        ownership_status: number;
      }>;
      for (const ugr of ugrRows) {
        existingTrackedPairs.add(`${ugr.user_id}::${ugr.release_id}`);
        if (ugr.ownership_status > 0) {
          const gid = releaseToGameId.get(ugr.release_id);
          if (gid !== undefined) {
            existingTrackedGames.add(`${ugr.user_id}::${gid}`);
          }
        }
      }
    } catch {
      // Optional tables may not exist in minimal test fixtures
    }

    const buildSilentRuleStatements = (params: {
      stableId: number;
      platformId: number;
      canonicalSeries: string;
      seriesTrackable: boolean;
      releases: Array<{
        id: string;
        region: string | null;
        variants?: string | null;
        rom_name?: string | null;
      }>;
    }): { stmts: WeightedStatement[]; count: number } => {
      if (trackingRules.length === 0 || params.releases.length === 0) {
        return { stmts: [], count: 0 };
      }
      const stmts: WeightedStatement[] = [];
      let count = 0;
      const seriesLower = params.canonicalSeries.trim().toLowerCase();

      for (const rule of trackingRules) {
        const matchesPlatform =
          rule.rule_type === 'platform' &&
          Number(rule.match_value) === params.platformId;
        const matchesSeries =
          rule.rule_type === 'series' &&
          params.seriesTrackable &&
          seriesLower !== '' &&
          rule.match_value.trim().toLowerCase() === seriesLower;
        if (!matchesPlatform && !matchesSeries) continue;

        const targetStatus =
          rule.target_status === 4 ? 4 : rule.target_status === 3 ? 3 : 2;
        const userGameKey = `${rule.user_id}::${params.stableId}`;
        const releaseScope =
          rule.auto_seek_release_scope === 'all_releases'
            ? 'all_releases'
            : 'one_per_game';

        const matchingRels = params.releases.filter((rel) => {
          if (isPackInCompanionDemoRom(params.platformId, rel.rom_name)) {
            return false;
          }
          return (
            rule.region_scope === 'any' ||
            isRegionMatchingHome(rel.region, rule.home_region)
          );
        });
        if (matchingRels.length === 0) continue;

        if (releaseScope === 'one_per_game') {
          if (existingTrackedGames.has(userGameKey)) continue;
          const sorted = [...matchingRels].sort(
            (a, b) =>
              (a.variants && a.variants.trim() ? 1 : 0) -
              (b.variants && b.variants.trim() ? 1 : 0),
          );
          const chosen = sorted[0];
          const pairKey = `${rule.user_id}::${chosen.id}`;
          if (existingTrackedPairs.has(pairKey)) continue;
          existingTrackedPairs.add(pairKey);
          existingTrackedGames.add(userGameKey);

          stmts.push({
            sql: `INSERT OR IGNORE INTO user_game_releases (user_id, release_id, ownership_status) VALUES (${rule.user_id}, ${escapeSql(chosen.id)}, ${targetStatus});`,
            writes: 2,
          });
          count++;
        } else {
          for (const rel of matchingRels) {
            const pairKey = `${rule.user_id}::${rel.id}`;
            if (existingTrackedPairs.has(pairKey)) continue;
            existingTrackedPairs.add(pairKey);
            existingTrackedGames.add(userGameKey);

            stmts.push({
              sql: `INSERT OR IGNORE INTO user_game_releases (user_id, release_id, ownership_status) VALUES (${rule.user_id}, ${escapeSql(rel.id)}, ${targetStatus});`,
              writes: 2,
            });
            count++;
          }
        }
      }
      return { stmts, count };
    };

    const runGroupWithOptionalLive = (stmts: WeightedStatement[]) => {
      writer.writeGroup(stmts);
      if (!dryRun && stmts.length > 0) {
        const tx = db.transaction(() => {
          for (const s of stmts) {
            db.exec(s.sql);
          }
        });
        tx();
      }
    };

    // =========================================================================
    // STAGE 1: CANONICAL SEED TAILER BACKLOG
    // =========================================================================
    if (stage === 'seed' || stage === 'all') {
      writer.startStage('seed');
      console.log('[FastTrack] Stage 1/4 (seed): starting...');
      const cursorRow = db
        .prepare(
          "SELECT value FROM sync_state WHERE key = 'catalog_seed_cursor'",
        )
        .get() as { value: string } | undefined;
      const initialCursor = Math.max(
        0,
        parseInt(cursorRow?.value || '0', 10) || 0,
      );
      summary.seed.cursor = initialCursor;

      const limitClause = options.limit
        ? `LIMIT ${Math.max(1, options.limit)}`
        : '';
      const sliceRows = db
        .prepare(
          `SELECT id, platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, serial_code
           FROM canonical_releases
           WHERE id > ?
             AND is_verified_physical = 1
             AND NOT (COALESCE(source, '') = 'nintendo_revised' AND (region = 'World' OR region IS NULL) AND serial_code IS NULL)
           ORDER BY id ASC
           ${limitClause}`,
        )
        .all(initialCursor) as Array<{
        id: number;
        platform_id: number;
        raw_title: string;
        normalized_title: string;
        region: string | null;
        variants: string | null;
        rom_name: string | null;
        rom_crc: string | null;
        serial_code: string | null;
      }>;

      const groupsMap = new Map<
        string,
        {
          platform_id: number;
          normalized_title: string;
          raw_title: string;
          maxSliceId: number;
        }
      >();
      let maxSeenCanonicalId = initialCursor;

      for (const row of sliceRows) {
        if (row.id > maxSeenCanonicalId) maxSeenCanonicalId = row.id;
        if (
          isIgnoredFormatRelease(
            row.raw_title,
            row.rom_name || '',
            row.platform_id,
          )
        ) {
          continue;
        }
        const key = `${row.platform_id}::${row.normalized_title}`;
        const existing = groupsMap.get(key);
        if (!existing) {
          groupsMap.set(key, {
            platform_id: row.platform_id,
            normalized_title: row.normalized_title,
            raw_title: row.raw_title,
            maxSliceId: row.id,
          });
        } else if (row.id > existing.maxSliceId) {
          existing.maxSliceId = row.id;
        }
      }
      summary.seed.scannedGroups = groupsMap.size;

      // Batch-fetch IGDB metadata up front for groups not yet matched by title
      const igdbQueries: Array<{
        key: string;
        title: string;
        normalizedTitle: string;
        igdbPlatformId: number | null;
        platformLaunchDate?: string | null;
      }> = [];
      for (const [key, group] of groupsMap) {
        if (gameByPlatNorm.has(key)) continue;
        const cleanTitle = cleanCanonicalDisplayTitle(group.raw_title);
        const pMeta = platformById.get(group.platform_id);
        igdbQueries.push({
          key,
          title: cleanTitle,
          normalizedTitle: normalizeTitleForMatching(cleanTitle),
          igdbPlatformId: pMeta?.igdbId ?? null,
          platformLaunchDate: pMeta?.launchDate ?? null,
        });
      }
      const igdbMetaMap = await igdbClient.resolveTitles(igdbQueries);
      const editionFallbackQueries = igdbQueries
        .filter((q) => !igdbMetaMap.has(q.key))
        .map((q) => {
          const stripped = stripEditionSuffix(q.title);
          return {
            ...q,
            title: stripped,
            normalizedTitle: normalizeTitleForMatching(stripped),
          };
        })
        .filter((q, idx, arr) => {
          const orig = igdbQueries.find((o) => o.key === q.key);
          return Boolean(
            q.normalizedTitle &&
            orig &&
            q.normalizedTitle !== orig.normalizedTitle &&
            arr.findIndex((x) => x.key === q.key) === idx,
          );
        });
      if (editionFallbackQueries.length > 0) {
        const fbMap = await igdbClient.resolveTitles(editionFallbackQueries);
        for (const [k, v] of fbMap) {
          igdbMetaMap.set(k, v);
        }
      }

      const selectGroupSiblingsStmt = db.prepare(
        `SELECT id, raw_title, region, variants, rom_name, rom_crc, serial_code
         FROM canonical_releases
         WHERE platform_id = ?
           AND normalized_title = ?
           AND is_verified_physical = 1
           AND NOT (COALESCE(source, '') = 'nintendo_revised' AND (region = 'World' OR region IS NULL) AND serial_code IS NULL)
         ORDER BY id ASC`,
      );

      for (const [groupKey, group] of groupsMap) {
        const siblings = (
          selectGroupSiblingsStmt.all(
            group.platform_id,
            group.normalized_title,
          ) as typeof sliceRows
        ).filter(
          (r) =>
            !isIgnoredFormatRelease(
              r.raw_title,
              r.rom_name || '',
              group.platform_id,
            ),
        );
        if (siblings.length === 0) continue;

        const igdbMeta = igdbMetaMap.get(groupKey) || null;
        let existingGame = gameByPlatNorm.get(groupKey) || null;
        if (!existingGame && igdbMeta?.igdb_id) {
          existingGame =
            gameByPlatIgdb.get(`${group.platform_id}::${igdbMeta.igdb_id}`) ||
            null;
        }
        if (!existingGame && !isCompilationOrBundleTitle(group.raw_title)) {
          for (const cr of siblings) {
            const crcUpper = (cr.rom_crc || '').trim().toUpperCase();
            if (!crcUpper) continue;
            const crcMatch = gameByPlatCrc.get(
              `${group.platform_id}::${crcUpper}`,
            );
            if (
              crcMatch &&
              (!igdbMeta?.igdb_id ||
                !crcMatch.igdb_id ||
                igdbMeta.igdb_id === crcMatch.igdb_id)
            ) {
              existingGame = crcMatch;
              break;
            }
          }
        }

        const pMeta = platformById.get(group.platform_id);

        if (existingGame) {
          const existingRels =
            releasesByGameId.get(existingGame.stable_id) || [];
          const existingCanonIds = new Set(
            existingRels
              .map((r) => r.canonical_release_id)
              .filter((id): id is number => id != null),
          );
          const existingRegVarKeys = new Set(
            existingRels.map(
              (r) =>
                `${(r.region || '').trim()}::${(r.variants || 'Standard').trim()}`,
            ),
          );
          const existingCrcs = new Set(
            existingRels
              .map((r) => (r.rom_crc || '').trim().toUpperCase())
              .filter(Boolean),
          );

          const toAttach = siblings.filter((cr) => {
            if (cr.id <= initialCursor) return false;
            if (existingCanonIds.has(cr.id)) return false;
            const crcUpper = (cr.rom_crc || '').trim().toUpperCase();
            if (crcUpper && existingCrcs.has(crcUpper)) return false;
            const reg = (cr.region || 'USA').trim();
            const v = (cr.variants || 'Standard').trim();
            if (existingRegVarKeys.has(`${reg}::${v}`)) return false;
            return true;
          });

          if (toAttach.length > 0) {
            const usedIds =
              releaseIdsByGameId.get(existingGame.stable_id) || new Set();
            releaseIdsByGameId.set(existingGame.stable_id, usedIds);
            const stmts: WeightedStatement[] = [];
            const addedForRules: Array<{
              id: string;
              region: string | null;
              variants?: string | null;
              rom_name?: string | null;
            }> = [];

            for (const cr of toAttach) {
              const relId = nextSeqRelId(existingGame.stable_id, usedIds);
              const reg = cr.region || 'USA';
              const relDate = igdbMeta
                ? resolveIgdbPlatformReleaseDate(
                    igdbMeta.release_dates,
                    pMeta?.igdbId ?? null,
                    pMeta?.launchDate ?? null,
                    reg,
                    igdbMeta.first_release_date,
                  )
                : null;
              stmts.push({
                sql: `INSERT INTO game_releases (id, game_id, region, variants, rom_name, rom_crc, release_date, canonical_release_id) VALUES (${escapeSql(relId)}, ${existingGame.stable_id}, ${escapeSql(reg)}, ${escapeSql(cr.variants || null)}, ${escapeSql(cr.rom_name || null)}, ${escapeSql(cr.rom_crc || null)}, ${escapeSql(relDate)}, ${cr.id}) ON CONFLICT(id) DO NOTHING;`,
                writes: 7,
              });
              const relMem: ReleaseStateRecord = {
                id: relId,
                game_id: existingGame.stable_id,
                region: reg,
                variants: cr.variants || null,
                rom_name: cr.rom_name || null,
                rom_crc: cr.rom_crc || null,
                release_date: relDate,
                canonical_release_id: cr.id,
              };
              existingRels.push(relMem);
              addedForRules.push({
                id: relId,
                region: reg,
                variants: cr.variants || null,
                rom_name: cr.rom_name || null,
              });
              summary.seed.insertedReleases++;
            }
            releasesByGameId.set(existingGame.stable_id, existingRels);

            const series =
              existingGame.canonical_series ||
              computeGameCanonicalSeries({
                title: existingGame.title,
                collections: existingGame.collections ?? undefined,
                franchises: existingGame.franchises ?? undefined,
              });
            const ruleRes = buildSilentRuleStatements({
              stableId: existingGame.stable_id,
              platformId: existingGame.platform_id,
              canonicalSeries: series,
              seriesTrackable: isSeriesTrackable({
                title: existingGame.title,
                collections: existingGame.collections,
                franchises: existingGame.franchises,
              }),
              releases: addedForRules,
            });
            stmts.push(...ruleRes.stmts);
            summary.seed.rulesApplied += ruleRes.count;
            runGroupWithOptionalLive(stmts);
          }
          continue;
        }

        // Insert new catalog game with numeric stable_id & id = String(stableId)
        const preferredRel =
          siblings.find(
            (r) =>
              r.region === 'USA' ||
              r.region === 'World' ||
              (r.region && r.region.includes('USA')),
          ) || siblings[0];
        const sourceTitle = cleanCanonicalDisplayTitle(
          preferredRel.raw_title || group.raw_title,
        );
        const displayTitle = resolveCanonicalDisplayTitle(
          sourceTitle,
          igdbMeta?.name,
        );
        const canonicalSeries = computeGameCanonicalSeries({
          title: displayTitle,
          collections: igdbMeta?.collections ?? undefined,
          franchises: igdbMeta?.franchises ?? undefined,
        });
        const gameRegion = preferredRel.region || 'USA';
        const nextSort = (maxSortByPlatform.get(group.platform_id) ?? 1000) + 1;
        maxSortByPlatform.set(group.platform_id, nextSort);

        maxStableId++;
        const stableId = maxStableId;
        const gameSlugId = String(stableId);
        const gameWrites = igdbMeta?.igdb_id ? 8 : 7;

        const stmts: WeightedStatement[] = [
          {
            sql: `INSERT INTO games (stable_id, id, title, platform_id, region, sort_index, igdb_id, igdb_url, image_url, summary, genres, collections, franchises, canonical_series, metadata_json) VALUES (${stableId}, ${escapeSql(gameSlugId)}, ${escapeSql(displayTitle)}, ${group.platform_id}, ${escapeSql(gameRegion)}, ${nextSort}, ${igdbMeta?.igdb_id ?? 'NULL'}, ${escapeSql(igdbMeta?.igdb_url ?? null)}, ${escapeSql(igdbMeta?.image_url ?? null)}, ${escapeSql(igdbMeta?.summary ?? null)}, ${escapeSql(igdbMeta?.genres ?? null)}, ${escapeSql(igdbMeta?.collections ?? null)}, ${escapeSql(igdbMeta?.franchises ?? null)}, ${escapeSql(canonicalSeries || null)}, ${escapeSql(igdbMeta?.metadata_json ?? null)}) ON CONFLICT(stable_id) DO NOTHING;`,
            writes: gameWrites,
          },
        ];

        const newGameMem: GameStateRecord = {
          stable_id: stableId,
          id: gameSlugId,
          title: displayTitle,
          platform_id: group.platform_id,
          region: gameRegion,
          igdb_id: igdbMeta?.igdb_id ?? null,
          igdb_url: igdbMeta?.igdb_url ?? null,
          image_url: igdbMeta?.image_url ?? null,
          summary: igdbMeta?.summary ?? null,
          genres: igdbMeta?.genres ?? null,
          collections: igdbMeta?.collections ?? null,
          franchises: igdbMeta?.franchises ?? null,
          canonical_series: canonicalSeries || null,
          metadata_json: igdbMeta?.metadata_json ?? null,
          bundle_parent_id: null,
        };
        registerGameInMemory(newGameMem);

        const usedIds = new Set<string>();
        const relMemList: ReleaseStateRecord[] = [];
        const addedForRules: Array<{
          id: string;
          region: string | null;
          variants?: string | null;
          rom_name?: string | null;
        }> = [];
        for (const cr of siblings) {
          const relId = nextSeqRelId(stableId, usedIds);
          const reg = cr.region || 'USA';
          const relDate = igdbMeta
            ? resolveIgdbPlatformReleaseDate(
                igdbMeta.release_dates,
                pMeta?.igdbId ?? null,
                pMeta?.launchDate ?? null,
                reg,
                igdbMeta.first_release_date,
              )
            : null;
          stmts.push({
            sql: `INSERT INTO game_releases (id, game_id, region, variants, rom_name, rom_crc, release_date, canonical_release_id) VALUES (${escapeSql(relId)}, ${stableId}, ${escapeSql(reg)}, ${escapeSql(cr.variants || null)}, ${escapeSql(cr.rom_name || null)}, ${escapeSql(cr.rom_crc || null)}, ${escapeSql(relDate)}, ${cr.id}) ON CONFLICT(id) DO NOTHING;`,
            writes: 7,
          });
          relMemList.push({
            id: relId,
            game_id: stableId,
            region: reg,
            variants: cr.variants || null,
            rom_name: cr.rom_name || null,
            rom_crc: cr.rom_crc || null,
            release_date: relDate,
            canonical_release_id: cr.id,
          });
          if (
            cr.rom_crc &&
            !isCompilationOrBundleTitle(displayTitle) &&
            !gameByPlatCrc.has(
              `${group.platform_id}::${cr.rom_crc.trim().toUpperCase()}`,
            )
          ) {
            gameByPlatCrc.set(
              `${group.platform_id}::${cr.rom_crc.trim().toUpperCase()}`,
              newGameMem,
            );
          }
          addedForRules.push({
            id: relId,
            region: reg,
            variants: cr.variants || null,
            rom_name: cr.rom_name || null,
          });
          summary.seed.insertedReleases++;
        }
        releaseIdsByGameId.set(stableId, usedIds);
        releasesByGameId.set(stableId, relMemList);

        const ruleRes = buildSilentRuleStatements({
          stableId,
          platformId: group.platform_id,
          canonicalSeries,
          seriesTrackable: isSeriesTrackable({
            title: displayTitle,
            collections: igdbMeta?.collections ?? null,
            franchises: igdbMeta?.franchises ?? null,
          }),
          releases: addedForRules,
        });
        stmts.push(...ruleRes.stmts);
        summary.seed.rulesApplied += ruleRes.count;

        runGroupWithOptionalLive(stmts);
        summary.seed.insertedGames++;
      }

      if (maxSeenCanonicalId > initialCursor) {
        summary.seed.cursor = maxSeenCanonicalId;
        runGroupWithOptionalLive([
          {
            sql: `INSERT INTO sync_state (key, value, updated_at) VALUES ('catalog_seed_cursor', ${escapeSql(String(maxSeenCanonicalId))}, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP;`,
            writes: 1,
          },
        ]);
      }
      writer.flush();
    }

    // =========================================================================
    // STAGE 2: BARE GAMES IGDB METADATA BACKFILL
    // =========================================================================
    if (stage === 'igdb-backfill' || stage === 'all') {
      writer.startStage('igdb_backfill');
      console.log('[FastTrack] Stage 2/4 (igdb-backfill): starting...');
      const bareGames = Array.from(gameByStableId.values())
        .filter(
          (g) =>
            g.igdb_id == null &&
            g.summary == null &&
            g.image_url == null &&
            g.bundle_parent_id == null,
        )
        .sort((a, b) => a.stable_id - b.stable_id);
      const slicedBare = options.limit
        ? bareGames.slice(0, Math.max(1, options.limit))
        : bareGames;
      summary.igdbBackfill.scannedGames = slicedBare.length;

      const lookupItems = slicedBare.map((g) => {
        const pMeta = platformById.get(g.platform_id);
        return {
          key: String(g.stable_id),
          title: g.title,
          normalizedTitle: normalizeTitleForMatching(g.title),
          igdbPlatformId: pMeta?.igdbId ?? null,
          platformLaunchDate: pMeta?.launchDate ?? null,
        };
      });
      const resolvedMap = await igdbClient.resolveTitles(lookupItems);

      for (const g of slicedBare) {
        const meta = resolvedMap.get(String(g.stable_id));
        if (!meta) continue;
        summary.igdbBackfill.matchedGames++;

        const nextTitle = resolveCanonicalDisplayTitle(g.title, meta.name);
        const series = computeGameCanonicalSeries({
          title: nextTitle,
          collections: meta.collections ?? undefined,
          franchises: meta.franchises ?? undefined,
        });

        const stmts: WeightedStatement[] = [
          {
            sql: `UPDATE games SET igdb_id = ${meta.igdb_id}, title = ${escapeSql(nextTitle)}, igdb_url = ${escapeSql(meta.igdb_url)}, image_url = COALESCE(image_url, ${escapeSql(meta.image_url)}), summary = COALESCE(summary, ${escapeSql(meta.summary)}), genres = COALESCE(genres, ${escapeSql(meta.genres)}), collections = ${escapeSql(meta.collections)}, franchises = ${escapeSql(meta.franchises)}, canonical_series = ${escapeSql(series || null)}, metadata_json = COALESCE(metadata_json, ${escapeSql(meta.metadata_json)}) WHERE stable_id = ${g.stable_id} AND igdb_id IS NULL;`,
            writes: 8,
          },
        ];

        g.igdb_id = meta.igdb_id;
        g.title = nextTitle;
        g.igdb_url = meta.igdb_url;
        g.image_url = g.image_url ?? meta.image_url;
        g.summary = g.summary ?? meta.summary;
        g.genres = g.genres ?? meta.genres;
        g.collections = meta.collections;
        g.franchises = meta.franchises;
        g.canonical_series = series || null;
        g.metadata_json = g.metadata_json ?? meta.metadata_json;
        registerGameInMemory(g);

        const pMeta = platformById.get(g.platform_id);
        const rels = releasesByGameId.get(g.stable_id) || [];
        for (const r of rels) {
          if (r.release_date) continue;
          const resolvedDate = resolveIgdbPlatformReleaseDate(
            meta.release_dates,
            pMeta?.igdbId ?? null,
            pMeta?.launchDate ?? null,
            r.region || g.region || 'USA',
            meta.first_release_date,
          );
          if (resolvedDate) {
            r.release_date = resolvedDate;
            stmts.push({
              sql: `UPDATE game_releases SET release_date = ${escapeSql(resolvedDate)} WHERE id = ${escapeSql(r.id)} AND release_date IS NULL;`,
              writes: 7,
            });
            summary.igdbBackfill.updatedReleaseDates++;
          }
        }

        const ruleRes = buildSilentRuleStatements({
          stableId: g.stable_id,
          platformId: g.platform_id,
          canonicalSeries: series,
          seriesTrackable: isSeriesTrackable({
            title: nextTitle,
            collections: g.collections,
            franchises: g.franchises,
          }),
          releases: rels.map((r) => ({
            id: r.id,
            region: r.region,
            variants: r.variants,
            rom_name: r.rom_name,
          })),
        });
        stmts.push(...ruleRes.stmts);
        summary.igdbBackfill.rulesApplied += ruleRes.count;

        runGroupWithOptionalLive(stmts);
      }
      writer.flush();
    }

    // =========================================================================
    // STAGE 3: ROLLING IGDB METADATA & RULE SELF-HEAL
    // =========================================================================
    if (stage === 'rolling' || stage === 'all') {
      writer.startStage('rolling');
      console.log('[FastTrack] Stage 3/4 (rolling): starting...');
      const enrichedGames = Array.from(gameByStableId.values())
        .filter((g) => g.igdb_id != null && g.igdb_id > 0)
        .sort((a, b) => a.stable_id - b.stable_id);
      const sliced = options.limit
        ? enrichedGames.slice(0, Math.max(1, options.limit))
        : enrichedGames;
      summary.rolling.scannedGames = sliced.length;

      const igdbIds = Array.from(
        new Set(sliced.map((g) => g.igdb_id as number)),
      );
      const igdbMap = await igdbClient.resolveByIds(igdbIds);

      for (const g of sliced) {
        const candidate = igdbMap.get(g.igdb_id as number);
        if (!candidate) continue;
        const meta = toNormalizedIgdbMeta(candidate);

        const nextCollections = meta.collections;
        const nextFranchises = meta.franchises;
        const nextSeries = computeGameCanonicalSeries({
          title: g.title,
          collections: nextCollections ?? undefined,
          franchises: nextFranchises ?? undefined,
        });
        const nextImage = g.image_url || meta.image_url;
        const nextSummary = g.summary || meta.summary;
        const nextGenres = g.genres || meta.genres;
        const nextMetaJson = g.metadata_json || meta.metadata_json;

        const hasGameDiff =
          (g.collections ?? null) !== (nextCollections ?? null) ||
          (g.franchises ?? null) !== (nextFranchises ?? null) ||
          (g.canonical_series ?? null) !== (nextSeries || null) ||
          (g.image_url ?? null) !== (nextImage ?? null) ||
          (g.summary ?? null) !== (nextSummary ?? null) ||
          (g.genres ?? null) !== (nextGenres ?? null) ||
          (g.metadata_json ?? null) !== (nextMetaJson ?? null);

        const stmts: WeightedStatement[] = [];
        if (hasGameDiff) {
          stmts.push({
            sql: `UPDATE games SET collections = ${escapeSql(nextCollections)}, franchises = ${escapeSql(nextFranchises)}, canonical_series = ${escapeSql(nextSeries || null)}, image_url = COALESCE(image_url, ${escapeSql(meta.image_url)}), summary = COALESCE(summary, ${escapeSql(meta.summary)}), genres = COALESCE(genres, ${escapeSql(meta.genres)}), metadata_json = COALESCE(metadata_json, ${escapeSql(meta.metadata_json)}) WHERE stable_id = ${g.stable_id};`,
            writes: 8,
          });
          g.collections = nextCollections;
          g.franchises = nextFranchises;
          g.canonical_series = nextSeries || null;
          g.image_url = nextImage;
          g.summary = nextSummary;
          g.genres = nextGenres;
          g.metadata_json = nextMetaJson;
          summary.rolling.updatedGames++;
        }

        const pMeta = platformById.get(g.platform_id);
        const rels = releasesByGameId.get(g.stable_id) || [];
        for (const r of rels) {
          if (r.release_date) continue;
          const resolvedDate = resolveIgdbPlatformReleaseDate(
            meta.release_dates,
            pMeta?.igdbId ?? null,
            pMeta?.launchDate ?? null,
            r.region || g.region || 'USA',
            meta.first_release_date,
          );
          if (resolvedDate) {
            r.release_date = resolvedDate;
            stmts.push({
              sql: `UPDATE game_releases SET release_date = ${escapeSql(resolvedDate)} WHERE id = ${escapeSql(r.id)} AND release_date IS NULL;`,
              writes: 7,
            });
            summary.rolling.updatedReleaseDates++;
          }
        }

        const ruleRes = buildSilentRuleStatements({
          stableId: g.stable_id,
          platformId: g.platform_id,
          canonicalSeries: nextSeries,
          seriesTrackable: isSeriesTrackable({
            title: g.title,
            collections: nextCollections,
            franchises: nextFranchises,
          }),
          releases: rels.map((r) => ({
            id: r.id,
            region: r.region,
            variants: r.variants,
            rom_name: r.rom_name,
          })),
        });
        stmts.push(...ruleRes.stmts);
        summary.rolling.rulesApplied += ruleRes.count;

        if (stmts.length > 0) {
          runGroupWithOptionalLive(stmts);
        }
      }

      const rollingStats = JSON.stringify({
        refreshedTotal: summary.rolling.scannedGames,
        updatedTotal: summary.rolling.updatedGames,
        selfHealedRulesTotal: summary.rolling.rulesApplied,
        lastRunAt: new Date().toISOString(),
      });
      runGroupWithOptionalLive([
        {
          sql: `INSERT INTO sync_state (key, value, updated_at) VALUES ('igdb_sync_offset', '0', CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP;`,
          writes: 1,
        },
        {
          sql: `INSERT INTO sync_state (key, value, updated_at) VALUES ('igdb_rolling_stats', ${escapeSql(rollingStats)}, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP;`,
          writes: 1,
        },
      ]);
      writer.flush();
    }

    // =========================================================================
    // STAGE 4: SILENT WATCHED-SERIES DISCOVERY BACKLOG
    // =========================================================================
    if (stage === 'series-discovery' || stage === 'all') {
      writer.startStage('series_discovery');
      console.log('[FastTrack] Stage 4/4 (series-discovery): starting...');
      const distinctSeries = Array.from(
        new Set(
          trackingRules
            .filter((r) => r.rule_type === 'series' && r.match_value.trim())
            .map((r) => r.match_value.trim()),
        ),
      ).sort((a, b) => a.localeCompare(b));

      const seriesSlice = options.limit
        ? distinctSeries.slice(0, Math.max(1, options.limit))
        : distinctSeries;
      summary.seriesDiscovery.seriesScanned = seriesSlice.length;

      const trackedIgdbIds = Array.from(platformByIgdbId.keys());
      if (seriesSlice.length > 0 && trackedIgdbIds.length > 0) {
        const seriesResults = await igdbClient.resolveSeriesCandidates(
          seriesSlice,
          trackedIgdbIds,
        );

        // Load verified canonical lookup for physical status admission gate
        const canonicalByPlatNorm = new Map<string, CanonicalRelease[]>();
        const canRows = db
          .prepare(
            `SELECT id, platform_id, raw_title, normalized_title, region, variants, rom_name, rom_crc, serial_code, barcode, publisher, source, is_verified_physical
             FROM canonical_releases`,
          )
          .all() as CanonicalRelease[];
        for (const cr of canRows) {
          const k = `${cr.platform_id}::${cr.normalized_title}`;
          const list = canonicalByPlatNorm.get(k) || [];
          list.push(cr);
          canonicalByPlatNorm.set(k, list);
        }

        for (const seriesName of seriesSlice) {
          const seriesLower = seriesName.toLowerCase();
          const cands = seriesResults.get(seriesName) || [];
          for (const game of cands) {
            if (!game || !game.id || !game.name || !isOfficialIGDBGame(game)) {
              continue;
            }
            const collectionsStr =
              game.collections?.map((c) => c.name).join(', ') || undefined;
            const franchisesStr =
              game.franchises?.map((f) => f.name).join(', ') || undefined;
            const computedSeries = computeGameCanonicalSeries({
              title: game.name,
              collections: collectionsStr,
              franchises: franchisesStr,
            });
            if (computedSeries.toLowerCase() !== seriesLower) continue;

            const numericGameFormat =
              typeof game.game_format === 'number'
                ? game.game_format
                : typeof game.game_format === 'object'
                  ? game.game_format?.id
                  : undefined;
            if (numericGameFormat === 2) continue;

            const igdbGameFormatStr =
              typeof game.game_format === 'string'
                ? game.game_format
                : typeof game.game_format === 'object' && game.game_format?.name
                  ? game.game_format.name
                  : numericGameFormat === 1
                    ? 'physical'
                    : null;
            const igdbPackagingVal =
              typeof game.packaging === 'number'
                ? game.packaging
                : (game.packaging?.id ?? null);
            const publisher =
              game.involved_companies
                ?.filter((ic) => ic.publisher && ic.company?.name)
                .map((ic) => ic.company!.name)
                .join(', ') || null;

            const titleNorm = normalizeTitleForMatching(game.name);
            const igdbMeta = toNormalizedIgdbMeta(game);
            const gamePlatIds = extractIgdbPlatformIds(game.platforms);

            for (const igdbPid of gamePlatIds) {
              const localPlats = platformByIgdbId.get(igdbPid) || [];
              for (const localPlat of localPlats) {
                if (
                  gameByPlatIgdb.has(`${localPlat.id}::${game.id}`) ||
                  (titleNorm &&
                    gameByPlatNorm.has(`${localPlat.id}::${titleNorm}`))
                ) {
                  continue;
                }

                const candidateCanonicals =
                  canonicalByPlatNorm.get(`${localPlat.id}::${titleNorm}`) ||
                  [];

                const detection = detectPhysicalReleaseStatus({
                  gameTitle: game.name,
                  platformId: localPlat.id,
                  parentPlatformId: localPlat.parentPlatformId,
                  alternativeNames: game.alternative_names,
                  firstReleaseDate: game.first_release_date,
                  platformLaunchDate: localPlat.launchDate,
                  publisher,
                  igdbCategory: game.game_type ?? game.category,
                  igdbPackaging: igdbPackagingVal,
                  igdbGameFormat: igdbGameFormatStr,
                  canonicalReleases: candidateCanonicals,
                });

                if (
                  detection.physical_status !== 'verified_physical' &&
                  detection.physical_status !== 'likely_physical'
                ) {
                  continue;
                }

                const isSuppressed = shouldSuppressCrossGenBasePlatform({
                  game: {
                    id: game.id,
                    name: game.name,
                    first_release_date: game.first_release_date,
                    remasters: (game.remasters || []).filter(
                      (
                        r,
                      ): r is {
                        id: number;
                        name?: string;
                        platforms?: Array<number | { id: number }>;
                      } => typeof r === 'object' && r !== null,
                    ),
                    expanded_games: (game.expanded_games || []).filter(
                      (
                        r,
                      ): r is {
                        id: number;
                        name?: string;
                        platforms?: Array<number | { id: number }>;
                      } => typeof r === 'object' && r !== null,
                    ),
                    ports: (game.ports || []).filter(
                      (
                        r,
                      ): r is {
                        id: number;
                        name?: string;
                        platforms?: Array<number | { id: number }>;
                      } => typeof r === 'object' && r !== null,
                    ),
                  },
                  igdbPlatformId: igdbPid,
                  platformLaunchDate: localPlat.launchDate,
                  isBaseVerifiedPhysicalOnPlatform:
                    detection.physical_status === 'verified_physical',
                  isRelatedIgdbIdOwnedOnPlatform: () => false,
                });
                if (isSuppressed) continue;

                const platReleaseDate = resolveIgdbPlatformReleaseDate(
                  game.release_dates,
                  igdbPid,
                  localPlat.launchDate,
                  'USA',
                  game.first_release_date,
                );

                const nextSort =
                  (maxSortByPlatform.get(localPlat.id) ?? 1000) + 1;
                maxSortByPlatform.set(localPlat.id, nextSort);

                maxStableId++;
                const stableId = maxStableId;
                const gameSlugId = String(stableId);

                const stmts: WeightedStatement[] = [
                  {
                    sql: `INSERT INTO games (stable_id, id, title, platform_id, region, sort_index, igdb_id, igdb_url, image_url, summary, genres, collections, franchises, canonical_series, metadata_json) VALUES (${stableId}, ${escapeSql(gameSlugId)}, ${escapeSql(game.name)}, ${localPlat.id}, 'USA', ${nextSort}, ${igdbMeta.igdb_id}, ${escapeSql(igdbMeta.igdb_url)}, ${escapeSql(igdbMeta.image_url)}, ${escapeSql(igdbMeta.summary)}, ${escapeSql(igdbMeta.genres)}, ${escapeSql(igdbMeta.collections)}, ${escapeSql(igdbMeta.franchises)}, ${escapeSql(computedSeries || null)}, ${escapeSql(igdbMeta.metadata_json)}) ON CONFLICT(stable_id) DO NOTHING;`,
                    writes: 8,
                  },
                ];

                const usedIds = new Set<string>();
                const addedForRules: Array<{
                  id: string;
                  region: string | null;
                  variants?: string | null;
                  rom_name?: string | null;
                }> = [];
                const relMemList: ReleaseStateRecord[] = [];
                const matchedCrs = detection.matched_releases;
                if (matchedCrs.length > 0) {
                  for (const cr of matchedCrs) {
                    const relId = nextSeqRelId(stableId, usedIds);
                    const reg = cr.region || 'USA';
                    stmts.push({
                      sql: `INSERT INTO game_releases (id, game_id, region, variants, rom_name, rom_crc, release_date, canonical_release_id) VALUES (${escapeSql(relId)}, ${stableId}, ${escapeSql(reg)}, ${escapeSql(cr.variants || null)}, ${escapeSql(cr.rom_name || null)}, ${escapeSql(cr.rom_crc || null)}, ${escapeSql(platReleaseDate)}, ${cr.id ?? 'NULL'}) ON CONFLICT(id) DO NOTHING;`,
                      writes: 7,
                    });
                    relMemList.push({
                      id: relId,
                      game_id: stableId,
                      region: reg,
                      variants: cr.variants || null,
                      rom_name: cr.rom_name || null,
                      rom_crc: cr.rom_crc || null,
                      release_date: platReleaseDate,
                      canonical_release_id: cr.id ?? null,
                    });
                    addedForRules.push({
                      id: relId,
                      region: reg,
                      variants: cr.variants || null,
                      rom_name: cr.rom_name || null,
                    });
                    summary.seriesDiscovery.insertedReleases++;
                  }
                } else {
                  const relId = nextSeqRelId(stableId, usedIds);
                  stmts.push({
                    sql: `INSERT INTO game_releases (id, game_id, region, variants, release_date) VALUES (${escapeSql(relId)}, ${stableId}, 'USA', 'Standard Edition', ${escapeSql(platReleaseDate)}) ON CONFLICT(id) DO NOTHING;`,
                    writes: 7,
                  });
                  relMemList.push({
                    id: relId,
                    game_id: stableId,
                    region: 'USA',
                    variants: 'Standard Edition',
                    rom_name: null,
                    rom_crc: null,
                    release_date: platReleaseDate,
                    canonical_release_id: null,
                  });
                  addedForRules.push({
                    id: relId,
                    region: 'USA',
                    variants: 'Standard Edition',
                    rom_name: null,
                  });
                  summary.seriesDiscovery.insertedReleases++;
                }

                const ruleRes = buildSilentRuleStatements({
                  stableId,
                  platformId: localPlat.id,
                  canonicalSeries: computedSeries,
                  seriesTrackable: isSeriesTrackable({
                    title: game.name,
                    collections: igdbMeta.collections,
                    franchises: igdbMeta.franchises,
                  }),
                  releases: addedForRules,
                });
                stmts.push(...ruleRes.stmts);
                summary.seriesDiscovery.rulesApplied += ruleRes.count;

                registerGameInMemory({
                  stable_id: stableId,
                  id: gameSlugId,
                  title: game.name,
                  platform_id: localPlat.id,
                  region: 'USA',
                  igdb_id: igdbMeta.igdb_id,
                  igdb_url: igdbMeta.igdb_url,
                  image_url: igdbMeta.image_url,
                  summary: igdbMeta.summary,
                  genres: igdbMeta.genres,
                  collections: igdbMeta.collections,
                  franchises: igdbMeta.franchises,
                  canonical_series: computedSeries || null,
                  metadata_json: igdbMeta.metadata_json,
                  bundle_parent_id: null,
                });
                releaseIdsByGameId.set(stableId, usedIds);
                releasesByGameId.set(stableId, relMemList);

                runGroupWithOptionalLive(stmts);
                summary.seriesDiscovery.insertedGames++;
              }
            }
          }
        }
      }

      const discoveryStats = JSON.stringify({
        seriesScannedTotal: summary.seriesDiscovery.seriesScanned,
        discoveredGamesTotal: summary.seriesDiscovery.insertedGames,
        lastRunAt: new Date().toISOString(),
      });
      runGroupWithOptionalLive([
        {
          sql: `INSERT INTO sync_state (key, value, updated_at) VALUES ('watched_series_discovery_cursor', '0', CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP;`,
          writes: 1,
        },
        {
          sql: `INSERT INTO sync_state (key, value, updated_at) VALUES ('watched_series_discovery_stats', ${escapeSql(discoveryStats)}, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP;`,
          writes: 1,
        },
      ]);
      writer.flush();
    }

    writer.flush();
    summary.totalEstimatedWrites = writer.totalEstimatedWrites;
    summary.igdbCacheHits = igdbClient.cacheHits;
    summary.igdbNetworkCalls = igdbClient.networkCalls;
    writer.writeManifest(summary);

    return summary;
  } finally {
    igdbClient.flushCache();
    if (ownDb) {
      db.close();
    }
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Fast-Track Backfill & Self-Healing Runner

Usage:
  npx tsx scripts/fast_track_backfill.ts [options]

Options:
  --stage=<name>             seed | igdb-backfill | rolling | series-discovery | all (default: all)
  --db=<path>                SQLite database path (default: auto-detected local DB)
  --out-dir=<path>           Directory for chunked SQL & manifest.json (default: scripts/temp/fast_track)
  --dry-run                  Simulate stages and emit chunked SQL without mutating local SQLite DB
  --max-chunk-writes=<N>     Max D1 billable 1+K writes per SQL chunk (default: 45000)
  --igdb-cache=<path>        Persistent IGDB JSON cache file (default: data/igdb_fast_track_cache.json)
  --limit=<N>                Optional per-stage cap on scanned rows/series
  --help, -h                 Show usage information
`);
    process.exit(0);
  }

  const stageArg = args.find((a) => a.startsWith('--stage='))?.split('=')[1];
  const dbArg = args.find((a) => a.startsWith('--db='))?.split('=')[1];
  const outDirArg = args.find((a) => a.startsWith('--out-dir='))?.split('=')[1];
  const maxWritesArg = args
    .find((a) => a.startsWith('--max-chunk-writes='))
    ?.split('=')[1];
  const igdbCacheArg = args
    .find((a) => a.startsWith('--igdb-cache='))
    ?.split('=')[1];
  const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1];

  runFastTrackBackfill({
    stage: parseFastTrackStage(stageArg),
    dbPath: dbArg ? path.resolve(dbArg) : undefined,
    outDir: outDirArg ? path.resolve(outDirArg) : undefined,
    dryRun: args.includes('--dry-run'),
    maxChunkWrites: maxWritesArg ? parseInt(maxWritesArg, 10) : undefined,
    igdbCachePath: igdbCacheArg ? path.resolve(igdbCacheArg) : undefined,
    limit: limitArg ? parseInt(limitArg, 10) : undefined,
  })
    .then((res) => {
      console.log('\n✅ FAST-TRACK BACKFILL COMPLETE');
      console.log(JSON.stringify(res, null, 2));
    })
    .catch((err) => {
      console.error('Fatal fast-track backfill error:', err);
      process.exit(1);
    });
}
