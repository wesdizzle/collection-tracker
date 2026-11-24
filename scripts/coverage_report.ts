/**
 * LOCAL PLATFORM COVERAGE & COMPLETENESS REPORT
 *
 * Read-only local SQLite audit (`0` Cloudflare D1 reads/writes) reporting per-platform
 * catalog verification coverage, Tier 1–4 breakdown, unmaterialized canonical titles,
 * user-tracked verification status, and Xbox One (49) / Series X (50) gap diagnosis.
 *
 * USAGE:
 *   npm run coverage:report -- [--db=<path>] [--json]
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getCanonicalSourceTier } from '../shared/canonical_releases.js';
import {
  areCanonicalTitlesSequelCompatible,
  buildCanonicalLinkerMatchKeys,
  normalizeTitleForMatching,
} from '../shared/title_matching.js';

export interface PlatformCoverageRow {
  platformId: number;
  displayName: string;
  totalGames: number;
  totalReleases: number;
  verifiedCount: number;
  unverifiedCount: number;
  verifiedPct: number;
  tier1Count: number;
  tier2Count: number;
  tier3Count: number;
  tier4Count: number;
  romOnlyCount: number;
  unmaterializedCanonicalTitles: number;
}

export interface XboxGapSample {
  releaseId: string;
  gameId: number;
  title: string;
  region: string | null;
  tracked: boolean;
  nearMatchTitle: string | null;
  nearMatchSource: string | null;
  nearMatchRegion: string | null;
}

export interface XboxPlatformGapReport {
  platformId: number;
  displayName: string;
  totalGames: number;
  totalReleases: number;
  verifiedReleases: number;
  unverifiedReleases: number;
  trackedUnverifiedCount: number;
  nearMatchesInCanonicalCount: number;
  sampleUnverified: XboxGapSample[];
}

export interface CoverageReport {
  overall: {
    totalGames: number;
    totalReleases: number;
    verifiedReleases: number;
    unverifiedReleases: number;
    verifiedPct: number;
    trackedTotalGames: number;
    trackedTotalReleases: number;
    trackedVerifiedReleases: number;
    trackedUnverifiedReleases: number;
    trackedVerifiedPct: number;
  };
  platforms: PlatformCoverageRow[];
  xboxGaps: XboxPlatformGapReport[];
}

function roundPct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function generateCoverageReport(db: Database.Database): CoverageReport {
  const grColumns = (
    db.pragma('table_info(game_releases)') as Array<{ name: string }>
  ).map((c) => c.name);
  const hasDenormalizedSource = grColumns.includes('verified_source');
  const sourceSelectExpr = hasDenormalizedSource
    ? 'COALESCE(r.verified_source, cr.source)'
    : 'cr.source';

  const platformRows = db
    .prepare(
      'SELECT id, COALESCE(display_name, name) AS display_name FROM platforms ORDER BY id ASC',
    )
    .all() as Array<{ id: number; display_name: string }>;

  const gameRows = db
    .prepare('SELECT stable_id, title, platform_id FROM games')
    .all() as Array<{ stable_id: number; title: string; platform_id: number }>;

  const releaseRows = db
    .prepare(
      `SELECT r.id AS release_id,
              r.game_id,
              g.title AS game_title,
              g.platform_id,
              r.region,
              r.rom_name,
              r.canonical_release_id,
              ${sourceSelectExpr} AS effective_source,
              CASE WHEN EXISTS (
                SELECT 1 FROM user_game_releases ugr
                WHERE ugr.release_id = r.id AND ugr.ownership_status > 0
              ) THEN 1 ELSE 0 END AS is_tracked
       FROM game_releases r
       JOIN games g ON g.stable_id = r.game_id
       LEFT JOIN canonical_releases cr ON cr.id = r.canonical_release_id`,
    )
    .all() as Array<{
    release_id: string;
    game_id: number;
    game_title: string;
    platform_id: number;
    region: string | null;
    rom_name: string | null;
    canonical_release_id: number | null;
    effective_source: string | null;
    is_tracked: number;
  }>;

  type CanonicalCoverageRow = {
    id: number;
    platform_id: number;
    raw_title: string;
    normalized_title: string;
    region: string | null;
    source: string;
  };
  const canonicalRows = db
    .prepare(
      `SELECT id, platform_id, raw_title, normalized_title, region, source
       FROM canonical_releases
       WHERE is_verified_physical = 1`,
    )
    .all() as CanonicalCoverageRow[];

  const gamesCountByPlat = new Map<number, number>();
  const gameNormsByPlat = new Map<number, Set<string>>();
  for (const g of gameRows) {
    gamesCountByPlat.set(
      g.platform_id,
      (gamesCountByPlat.get(g.platform_id) || 0) + 1,
    );
    let set = gameNormsByPlat.get(g.platform_id);
    if (!set) {
      set = new Set<string>();
      gameNormsByPlat.set(g.platform_id, set);
    }
    const norm = normalizeTitleForMatching(g.title);
    if (norm) set.add(norm);
    for (const k of buildCanonicalLinkerMatchKeys(g.title)) {
      set.add(k);
    }
  }

  const linkedCanonicalIds = new Set<number>();
  const statsByPlat = new Map<
    number,
    {
      totalReleases: number;
      verifiedCount: number;
      unverifiedCount: number;
      tier1Count: number;
      tier2Count: number;
      tier3Count: number;
      tier4Count: number;
      romOnlyCount: number;
    }
  >();

  let totalReleases = 0;
  let verifiedReleases = 0;
  let unverifiedReleases = 0;
  let trackedTotalReleases = 0;
  let trackedVerifiedReleases = 0;
  let trackedUnverifiedReleases = 0;
  const trackedGameIds = new Set<number>();

  const ensurePlatStats = (platId: number) => {
    let s = statsByPlat.get(platId);
    if (!s) {
      s = {
        totalReleases: 0,
        verifiedCount: 0,
        unverifiedCount: 0,
        tier1Count: 0,
        tier2Count: 0,
        tier3Count: 0,
        tier4Count: 0,
        romOnlyCount: 0,
      };
      statsByPlat.set(platId, s);
    }
    return s;
  };

  const unverifiedByPlat = new Map<
    number,
    Array<(typeof releaseRows)[number]>
  >();

  for (const r of releaseRows) {
    if (r.canonical_release_id != null) {
      linkedCanonicalIds.add(r.canonical_release_id);
    }
    const tier = getCanonicalSourceTier(r.effective_source);
    const hasRom = Boolean(r.rom_name);
    const isVerified = tier > 0 || hasRom;
    const st = ensurePlatStats(r.platform_id);

    st.totalReleases++;
    totalReleases++;

    if (r.is_tracked === 1) {
      trackedGameIds.add(r.game_id);
      trackedTotalReleases++;
      if (isVerified) trackedVerifiedReleases++;
      else trackedUnverifiedReleases++;
    }

    if (isVerified) {
      st.verifiedCount++;
      verifiedReleases++;
      if (tier === 1) st.tier1Count++;
      else if (tier === 2) st.tier2Count++;
      else if (tier === 3) st.tier3Count++;
      else if (tier === 4) st.tier4Count++;
      else st.romOnlyCount++;
    } else {
      st.unverifiedCount++;
      unverifiedReleases++;
      const list = unverifiedByPlat.get(r.platform_id) || [];
      list.push(r);
      unverifiedByPlat.set(r.platform_id, list);
    }
  }

  const unmatTitlesByPlat = new Map<number, Set<string>>();
  const canonicalByPlatKey = new Map<string, CanonicalCoverageRow[]>();

  for (const cr of canonicalRows) {
    // Index canonical rows for Xbox gap diagnostics
    if (cr.platform_id === 49 || cr.platform_id === 50) {
      const keys = new Set<string>([
        cr.normalized_title,
        ...buildCanonicalLinkerMatchKeys(cr.raw_title),
      ]);
      for (const k of keys) {
        if (!k) continue;
        const mapKey: string = `${cr.platform_id}::${k}`;
        const existingBucket: CanonicalCoverageRow[] =
          canonicalByPlatKey.get(mapKey) ?? [];
        if (!existingBucket.includes(cr)) {
          existingBucket.push(cr);
          canonicalByPlatKey.set(mapKey, existingBucket);
        }
      }
    }

    if (linkedCanonicalIds.has(cr.id)) continue;
    const platGameNorms = gameNormsByPlat.get(cr.platform_id);
    const alreadyMaterialized =
      platGameNorms &&
      (platGameNorms.has(cr.normalized_title) ||
        buildCanonicalLinkerMatchKeys(cr.raw_title).some((k) =>
          platGameNorms.has(k),
        ));
    if (alreadyMaterialized) continue;

    let set = unmatTitlesByPlat.get(cr.platform_id);
    if (!set) {
      set = new Set<string>();
      unmatTitlesByPlat.set(cr.platform_id, set);
    }
    set.add(cr.normalized_title);
  }

  const platNameById = new Map<number, string>();
  const allPlatIds = new Set<number>();
  for (const p of platformRows) {
    platNameById.set(p.id, p.display_name);
    allPlatIds.add(p.id);
  }
  for (const platId of gamesCountByPlat.keys()) allPlatIds.add(platId);
  for (const platId of statsByPlat.keys()) allPlatIds.add(platId);
  for (const platId of unmatTitlesByPlat.keys()) allPlatIds.add(platId);

  const platforms: PlatformCoverageRow[] = Array.from(allPlatIds)
    .sort((a, b) => a - b)
    .map((platformId) => {
      const st = ensurePlatStats(platformId);
      const totalGames = gamesCountByPlat.get(platformId) || 0;
      const unmat = unmatTitlesByPlat.get(platformId)?.size || 0;
      return {
        platformId,
        displayName: platNameById.get(platformId) || `Platform ${platformId}`,
        totalGames,
        totalReleases: st.totalReleases,
        verifiedCount: st.verifiedCount,
        unverifiedCount: st.unverifiedCount,
        verifiedPct: roundPct(st.verifiedCount, st.totalReleases),
        tier1Count: st.tier1Count,
        tier2Count: st.tier2Count,
        tier3Count: st.tier3Count,
        tier4Count: st.tier4Count,
        romOnlyCount: st.romOnlyCount,
        unmaterializedCanonicalTitles: unmat,
      };
    })
    .filter(
      (p) =>
        p.totalGames > 0 ||
        p.totalReleases > 0 ||
        p.unmaterializedCanonicalTitles > 0,
    );

  const xboxGaps: XboxPlatformGapReport[] = [49, 50].map((platId) => {
    const st = ensurePlatStats(platId);
    const unverified = unverifiedByPlat.get(platId) || [];
    let trackedUnverifiedCount = 0;
    let nearMatchesInCanonicalCount = 0;

    const samplesWithMatch: XboxGapSample[] = [];
    for (const u of unverified) {
      const tracked = u.is_tracked === 1;
      if (tracked) trackedUnverifiedCount++;
      const keys = buildCanonicalLinkerMatchKeys(u.game_title);
      let nearMatch: (typeof canonicalRows)[number] | null = null;
      for (const k of keys) {
        for (const cand of canonicalByPlatKey.get(`${platId}::${k}`) || []) {
          if (
            areCanonicalTitlesSequelCompatible(u.game_title, cand.raw_title)
          ) {
            nearMatch = cand;
            break;
          }
        }
        if (nearMatch) break;
      }
      if (nearMatch) nearMatchesInCanonicalCount++;
      samplesWithMatch.push({
        releaseId: u.release_id,
        gameId: u.game_id,
        title: u.game_title,
        region: u.region,
        tracked,
        nearMatchTitle: nearMatch?.raw_title ?? null,
        nearMatchSource: nearMatch?.source ?? null,
        nearMatchRegion: nearMatch?.region ?? null,
      });
    }

    samplesWithMatch.sort((a, b) => {
      if (a.tracked !== b.tracked) return a.tracked ? -1 : 1;
      const aHasNear = a.nearMatchTitle ? 0 : 1;
      const bHasNear = b.nearMatchTitle ? 0 : 1;
      if (aHasNear !== bHasNear) return aHasNear - bHasNear;
      return a.title.localeCompare(b.title);
    });

    return {
      platformId: platId,
      displayName:
        platNameById.get(platId) ||
        (platId === 49 ? 'Xbox One' : 'Xbox Series X'),
      totalGames: gamesCountByPlat.get(platId) || 0,
      totalReleases: st.totalReleases,
      verifiedReleases: st.verifiedCount,
      unverifiedReleases: st.unverifiedCount,
      trackedUnverifiedCount,
      nearMatchesInCanonicalCount,
      sampleUnverified: samplesWithMatch.slice(0, 15),
    };
  });

  return {
    overall: {
      totalGames: gameRows.length,
      totalReleases,
      verifiedReleases,
      unverifiedReleases,
      verifiedPct: roundPct(verifiedReleases, totalReleases),
      trackedTotalGames: trackedGameIds.size,
      trackedTotalReleases,
      trackedVerifiedReleases,
      trackedUnverifiedReleases,
      trackedVerifiedPct: roundPct(
        trackedVerifiedReleases,
        trackedTotalReleases,
      ),
    },
    platforms,
    xboxGaps,
  };
}

export function formatCoverageReport(report: CoverageReport): string {
  const lines: string[] = [];
  const o = report.overall;
  lines.push('=== Overall Catalog Verification Coverage ===');
  lines.push(
    `Total Games:            ${o.totalGames.toLocaleString()} | Total Releases: ${o.totalReleases.toLocaleString()}`,
  );
  lines.push(
    `Verified Releases:      ${o.verifiedReleases.toLocaleString()} / ${o.totalReleases.toLocaleString()} (${o.verifiedPct}%) | Unverified: ${o.unverifiedReleases.toLocaleString()}`,
  );
  lines.push(
    `Tracked Collection:     ${o.trackedVerifiedReleases.toLocaleString()} / ${o.trackedTotalReleases.toLocaleString()} releases (${o.trackedVerifiedPct}%) across ${o.trackedTotalGames.toLocaleString()} games (${o.trackedUnverifiedReleases.toLocaleString()} unverified)`,
  );
  lines.push('');
  lines.push('=== Per-Platform Verification & Completeness ===');
  lines.push(
    'ID  | Platform                                | Games  | Rel    | Verified (%)       | T1     | T2     | T3     | T4    | ROM   | Unmat Canon',
  );
  lines.push('-'.repeat(134));
  for (const p of report.platforms) {
    const idStr = String(p.platformId).padEnd(3);
    const nameStr = p.displayName.slice(0, 39).padEnd(39);
    const gamesStr = String(p.totalGames).padStart(6);
    const relStr = String(p.totalReleases).padStart(6);
    const verStr = `${p.verifiedCount} (${p.verifiedPct.toFixed(1)}%)`.padStart(
      18,
    );
    const t1 = String(p.tier1Count).padStart(6);
    const t2 = String(p.tier2Count).padStart(6);
    const t3 = String(p.tier3Count).padStart(6);
    const t4 = String(p.tier4Count).padStart(5);
    const rom = String(p.romOnlyCount).padStart(5);
    const unmat = String(p.unmaterializedCanonicalTitles).padStart(11);
    lines.push(
      `${idStr} | ${nameStr} | ${gamesStr} | ${relStr} | ${verStr} | ${t1} | ${t2} | ${t3} | ${t4} | ${rom} | ${unmat}`,
    );
  }

  lines.push('');
  lines.push('=== Xbox One (49) & Xbox Series X (50) Gap Diagnosis ===');
  for (const xb of report.xboxGaps) {
    lines.push(
      `${xb.displayName} (${xb.platformId}): ${xb.verifiedReleases}/${xb.totalReleases} verified (${roundPct(xb.verifiedReleases, xb.totalReleases)}%), ${xb.unverifiedReleases} unverified (${xb.trackedUnverifiedCount} tracked, ${xb.nearMatchesInCanonicalCount} near-matches in canonical_releases)`,
    );
    for (const s of xb.sampleUnverified) {
      const tag = s.tracked ? '[TRACKED]' : '[CATALOG]';
      const near = s.nearMatchTitle
        ? ` -> near: "${s.nearMatchTitle}" (${s.nearMatchSource}, ${s.nearMatchRegion || '?'})`
        : '';
      lines.push(
        `  ${tag} ${s.releaseId} | ${s.title} (${s.region || '?'})${near}`,
      );
    }
  }

  return lines.join('\n');
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const args = process.argv.slice(2);
  const dbArg = args.find((a) => a.startsWith('--db='))?.slice(5);
  const asJson = args.includes('--json');
  const dbPath = dbArg
    ? path.resolve(dbArg)
    : path.join(process.cwd(), 'data', 'remote_baseline.db');

  if (!fs.existsSync(dbPath)) {
    console.error(`Database file not found: ${dbPath}`);
    process.exit(1);
  }

  const db = new Database(dbPath, { readonly: true });
  try {
    const report = generateCoverageReport(db);
    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatCoverageReport(report));
    }
  } finally {
    db.close();
  }
}
