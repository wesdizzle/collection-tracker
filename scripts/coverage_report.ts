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
  extractPhysicalEditionForVariant,
  isCompilationOrBundleTitle,
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

export interface IgdbCoverageSummary {
  totalGames: number;
  exemptCuratedCount: number;
  eligibleGames: number;
  igdbLinkedCount: number;
  comboLinkedCount: number;
  igdbLinkedPct: number;
  missingIgdbCount: number;
  missingArtCount: number;
  missingDateCount: number;
}

export interface IgdbDuplicateSiblingSample {
  gameId: number;
  platformId: number;
  platformName: string;
  title: string;
  tracked: boolean;
  reason: 'shared_canonical' | 'title_or_edition_match';
  siblingGameId: number;
  siblingTitle: string;
  siblingIgdbId: number;
}

export interface IgdbCoverageReport {
  overall: IgdbCoverageSummary;
  tracked: IgdbCoverageSummary;
  modernWestern: IgdbCoverageSummary;
  modern: IgdbCoverageSummary;
  usaEnglishWestern: IgdbCoverageSummary;
  western: IgdbCoverageSummary;
  duplicateSiblingCount: number;
  trackedDuplicateSiblingCount: number;
  sampleDuplicateSiblings: IgdbDuplicateSiblingSample[];
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
  igdbCoverage: IgdbCoverageReport;
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

  const gamesCols = new Set(
    (db.pragma('table_info(games)') as Array<{ name: string }>).map(
      (c) => c.name,
    ),
  );
  const gameRows = db
    .prepare(
      `SELECT stable_id,
              title,
              platform_id,
              ${gamesCols.has('igdb_id') ? 'igdb_id' : 'NULL AS igdb_id'},
              ${gamesCols.has('image_url') ? 'image_url' : 'NULL AS image_url'},
              ${gamesCols.has('region') ? 'region' : 'NULL AS region'},
              ${gamesCols.has('metadata_json') ? 'metadata_json' : 'NULL AS metadata_json'}
       FROM games`,
    )
    .all() as Array<{
    stable_id: number;
    title: string;
    platform_id: number;
    igdb_id: number | null;
    image_url: string | null;
    region: string | null;
    metadata_json: string | null;
  }>;

  const releaseRows = db
    .prepare(
      `SELECT r.id AS release_id,
              r.game_id,
              g.title AS game_title,
              g.platform_id,
              r.region,
              r.rom_name,
              r.release_date,
              r.variants,
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
    release_date: string | null;
    variants: string | null;
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

  const todayIso = new Date().toISOString().slice(0, 10);

  for (const r of releaseRows) {
    if (r.canonical_release_id != null) {
      linkedCanonicalIds.add(r.canonical_release_id);
    }
    const tier = getCanonicalSourceTier(r.effective_source);
    const hasRom = Boolean(r.rom_name);
    const isCiabRelease =
      r.effective_source === 'nscollectors_ciab' ||
      /\b(?:code\s+in\s+a\s+box|ciab)\b/i.test(r.variants || '');
    const isUpcomingPhysical =
      Boolean(r.release_date && r.release_date > todayIso) && !isCiabRelease;
    const isVerified = tier > 0 || hasRom || isUpcomingPhysical;
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
      else if (tier === 4 || (tier === 0 && !hasRom && isUpcomingPhysical))
        st.tier4Count++;
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

  const WESTERN_REGION_RE =
    /\b(usa|europe|world|north america|uk|united kingdom|australia|new zealand|canada|germany|france|spain|italy|netherlands|sweden|brazil)\b/i;
  const USA_ENGLISH_WESTERN_RE =
    /\b(usa|world|north america|canada|uk|united kingdom|australia|new zealand|ireland)\b/i;
  const MODERN_PLATFORMS = new Set([26, 27, 34, 35, 49, 50]);

  const gameHasReleaseDate = new Set<number>();
  const gameIsWestern = new Set<number>();
  const gameIsUsaEnglishWestern = new Set<number>();
  const igdbGamesByCanonical = new Map<
    string,
    Array<(typeof gameRows)[number]>
  >();
  const gameById = new Map<number, (typeof gameRows)[number]>();
  const igdbGamesByPlatLinkerKey = new Map<
    string,
    Array<(typeof gameRows)[number]>
  >();

  for (const g of gameRows) {
    gameById.set(g.stable_id, g);
    if (g.region && WESTERN_REGION_RE.test(g.region)) {
      gameIsWestern.add(g.stable_id);
    }
    if (g.region && USA_ENGLISH_WESTERN_RE.test(g.region)) {
      gameIsUsaEnglishWestern.add(g.stable_id);
    }
    if (g.igdb_id != null && g.igdb_id > 0) {
      const edBase = extractPhysicalEditionForVariant(g.title).baseTitle;
      const keys = new Set<string>([
        ...buildCanonicalLinkerMatchKeys(g.title),
        ...(edBase ? buildCanonicalLinkerMatchKeys(edBase) : []),
      ]);
      for (const k of keys) {
        if (!k) continue;
        const mapKey = `${g.platform_id}::${k}`;
        const bucket = igdbGamesByPlatLinkerKey.get(mapKey) || [];
        if (!bucket.some((x) => x.stable_id === g.stable_id)) {
          bucket.push(g);
          igdbGamesByPlatLinkerKey.set(mapKey, bucket);
        }
      }
    }
  }

  for (const r of releaseRows) {
    if (r.release_date && r.release_date.trim()) {
      gameHasReleaseDate.add(r.game_id);
    }
    if (r.region && WESTERN_REGION_RE.test(r.region)) {
      gameIsWestern.add(r.game_id);
    }
    if (r.region && USA_ENGLISH_WESTERN_RE.test(r.region)) {
      gameIsUsaEnglishWestern.add(r.game_id);
    }
    if (r.canonical_release_id != null) {
      const parent = gameById.get(r.game_id);
      if (parent && parent.igdb_id != null && parent.igdb_id > 0) {
        const key = `${r.platform_id}::${r.canonical_release_id}`;
        const bucket = igdbGamesByCanonical.get(key) || [];
        if (!bucket.some((x) => x.stable_id === parent.stable_id)) {
          bucket.push(parent);
          igdbGamesByCanonical.set(key, bucket);
        }
      }
    }
  }

  const canonicalIdsByUnlinkedGame = new Map<number, number[]>();
  for (const r of releaseRows) {
    if (r.canonical_release_id == null) continue;
    const parent = gameById.get(r.game_id);
    if (!parent || (parent.igdb_id != null && parent.igdb_id > 0)) continue;
    const arr = canonicalIdsByUnlinkedGame.get(parent.stable_id) || [];
    if (!arr.includes(r.canonical_release_id)) {
      arr.push(r.canonical_release_id);
      canonicalIdsByUnlinkedGame.set(parent.stable_id, arr);
    }
  }

  const buildSummaryBucket = () => ({
    totalGames: 0,
    exemptCuratedCount: 0,
    igdbLinkedCount: 0,
    comboLinkedCount: 0,
    missingIgdbCount: 0,
    missingArtCount: 0,
    missingDateCount: 0,
  });
  const igdbOverall = buildSummaryBucket();
  const igdbTracked = buildSummaryBucket();
  const igdbModernWestern = buildSummaryBucket();
  const igdbModern = buildSummaryBucket();
  const igdbUsaEnglishWestern = buildSummaryBucket();
  const igdbWestern = buildSummaryBucket();

  const recordIgdbStats = (
    bucket: ReturnType<typeof buildSummaryBucket>,
    isCuratedExempt: boolean,
    hasIgdbOrCombo: boolean,
    isComboLinked: boolean,
    hasArt: boolean,
    hasDate: boolean,
  ) => {
    bucket.totalGames++;
    if (isCuratedExempt) bucket.exemptCuratedCount++;
    if (hasIgdbOrCombo) {
      bucket.igdbLinkedCount++;
      if (isComboLinked) bucket.comboLinkedCount++;
    } else if (!isCuratedExempt) {
      bucket.missingIgdbCount++;
    }
    if (!hasArt) bucket.missingArtCount++;
    if (!hasDate) bucket.missingDateCount++;
  };

  const duplicateSiblings: IgdbDuplicateSiblingSample[] = [];
  let trackedDuplicateSiblingCount = 0;

  for (const g of gameRows) {
    const hasDirectIgdb = g.igdb_id != null && g.igdb_id > 0;
    let constituents: Array<{
      igdb_id?: number;
      image_url?: string | null;
      release_date?: string | null;
    }> = [];
    if (
      !hasDirectIgdb &&
      g.metadata_json &&
      g.metadata_json.includes('constituent_games')
    ) {
      try {
        const parsed = JSON.parse(g.metadata_json) as {
          constituent_games?: typeof constituents;
        };
        if (
          Array.isArray(parsed?.constituent_games) &&
          parsed.constituent_games.length >= 2 &&
          parsed.constituent_games.every((c) => Number(c?.igdb_id) > 0)
        ) {
          constituents = parsed.constituent_games;
        }
      } catch {
        // ignore malformed metadata_json
      }
    }
    const isComboLinked = !hasDirectIgdb && constituents.length >= 2;
    const hasIgdb = hasDirectIgdb || isComboLinked;
    const isCuratedExempt =
      !hasIgdb && Boolean(g.image_url && g.image_url.startsWith('/covers/'));
    const hasArt = Boolean(
      (g.image_url && g.image_url.trim().length > 0) ||
      constituents.some((c) => Boolean(c.image_url && c.image_url.trim())),
    );
    const hasDate =
      gameHasReleaseDate.has(g.stable_id) ||
      constituents.some((c) => Boolean(c.release_date));
    const isTracked = trackedGameIds.has(g.stable_id);
    const isModern = MODERN_PLATFORMS.has(g.platform_id);
    const isWest = gameIsWestern.has(g.stable_id);
    const isUsaEngWest = gameIsUsaEnglishWestern.has(g.stable_id);

    recordIgdbStats(
      igdbOverall,
      isCuratedExempt,
      hasIgdb,
      isComboLinked,
      hasArt,
      hasDate,
    );
    if (isTracked) {
      recordIgdbStats(
        igdbTracked,
        isCuratedExempt,
        hasIgdb,
        isComboLinked,
        hasArt,
        hasDate,
      );
    }
    if (isModern && isWest) {
      recordIgdbStats(
        igdbModernWestern,
        isCuratedExempt,
        hasIgdb,
        isComboLinked,
        hasArt,
        hasDate,
      );
    }
    if (isModern) {
      recordIgdbStats(
        igdbModern,
        isCuratedExempt,
        hasIgdb,
        isComboLinked,
        hasArt,
        hasDate,
      );
    }
    if (isUsaEngWest) {
      recordIgdbStats(
        igdbUsaEnglishWestern,
        isCuratedExempt,
        hasIgdb,
        isComboLinked,
        hasArt,
        hasDate,
      );
    }
    if (isWest) {
      recordIgdbStats(
        igdbWestern,
        isCuratedExempt,
        hasIgdb,
        isComboLinked,
        hasArt,
        hasDate,
      );
    }

    if (!hasIgdb && !isCuratedExempt) {
      const isComp = isCompilationOrBundleTitle(g.title);
      let matchedSib: (typeof gameRows)[number] | undefined;
      let matchReason: 'shared_canonical' | 'title_or_edition_match' =
        'shared_canonical';

      const canonIds = canonicalIdsByUnlinkedGame.get(g.stable_id) || [];
      for (const cid of canonIds) {
        const cands =
          igdbGamesByCanonical.get(`${g.platform_id}::${cid}`) || [];
        const sib = cands.find(
          (c) => isCompilationOrBundleTitle(c.title) === isComp,
        );
        if (sib) {
          matchedSib = sib;
          matchReason = 'shared_canonical';
          break;
        }
      }

      if (!matchedSib) {
        const edBase = extractPhysicalEditionForVariant(g.title).baseTitle;
        const keys = new Set<string>([
          ...buildCanonicalLinkerMatchKeys(g.title),
          ...(edBase ? buildCanonicalLinkerMatchKeys(edBase) : []),
        ]);
        for (const k of keys) {
          if (!k) continue;
          const cands =
            igdbGamesByPlatLinkerKey.get(`${g.platform_id}::${k}`) || [];
          const sib = cands.find(
            (c) =>
              isCompilationOrBundleTitle(c.title) === isComp &&
              areCanonicalTitlesSequelCompatible(g.title, c.title),
          );
          if (sib) {
            matchedSib = sib;
            matchReason = 'title_or_edition_match';
            break;
          }
        }
      }

      if (matchedSib && matchedSib.igdb_id) {
        if (isTracked) trackedDuplicateSiblingCount++;
        duplicateSiblings.push({
          gameId: g.stable_id,
          platformId: g.platform_id,
          platformName:
            platNameById.get(g.platform_id) || `Platform ${g.platform_id}`,
          title: g.title,
          tracked: isTracked,
          reason: matchReason,
          siblingGameId: matchedSib.stable_id,
          siblingTitle: matchedSib.title,
          siblingIgdbId: matchedSib.igdb_id,
        });
      }
    }
  }

  duplicateSiblings.sort((a, b) => {
    if (a.tracked !== b.tracked) return a.tracked ? -1 : 1;
    if (a.reason !== b.reason) {
      return a.reason === 'shared_canonical' ? -1 : 1;
    }
    return a.title.localeCompare(b.title);
  });

  const finalizeIgdbSummary = (
    b: ReturnType<typeof buildSummaryBucket>,
  ): IgdbCoverageSummary => {
    const eligibleGames = Math.max(0, b.totalGames - b.exemptCuratedCount);
    return {
      totalGames: b.totalGames,
      exemptCuratedCount: b.exemptCuratedCount,
      eligibleGames,
      igdbLinkedCount: b.igdbLinkedCount,
      comboLinkedCount: b.comboLinkedCount,
      igdbLinkedPct: roundPct(b.igdbLinkedCount, eligibleGames),
      missingIgdbCount: b.missingIgdbCount,
      missingArtCount: b.missingArtCount,
      missingDateCount: b.missingDateCount,
    };
  };

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
    igdbCoverage: {
      overall: finalizeIgdbSummary(igdbOverall),
      tracked: finalizeIgdbSummary(igdbTracked),
      modernWestern: finalizeIgdbSummary(igdbModernWestern),
      modern: finalizeIgdbSummary(igdbModern),
      usaEnglishWestern: finalizeIgdbSummary(igdbUsaEnglishWestern),
      western: finalizeIgdbSummary(igdbWestern),
      duplicateSiblingCount: duplicateSiblings.length,
      trackedDuplicateSiblingCount,
      sampleDuplicateSiblings: duplicateSiblings.slice(0, 15),
    },
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

  const igdb = report.igdbCoverage;
  lines.push('');
  lines.push('=== IGDB Metadata Completeness & Duplicate Sibling Audit ===');
  const formatIgdbRow = (label: string, s: IgdbCoverageSummary) =>
    `${label.padEnd(18)} ${s.igdbLinkedCount.toLocaleString()}/${s.eligibleGames.toLocaleString()} eligible (${s.igdbLinkedPct.toFixed(1)}%) | Missing IGDB: ${s.missingIgdbCount.toLocaleString()} | No Art: ${s.missingArtCount.toLocaleString()} | No Date: ${s.missingDateCount.toLocaleString()}${s.comboLinkedCount > 0 ? ` | Combo-linked: ${s.comboLinkedCount}` : ''}${s.exemptCuratedCount > 0 ? ` | Curated /covers/ exempt: ${s.exemptCuratedCount}` : ''}`;
  lines.push(formatIgdbRow('Overall:', igdb.overall));
  lines.push(formatIgdbRow('Tracked:', igdb.tracked));
  lines.push(formatIgdbRow('Modern (West):', igdb.modernWestern));
  lines.push(formatIgdbRow('Modern (All):', igdb.modern));
  lines.push(formatIgdbRow('USA/Eng West:', igdb.usaEnglishWestern));
  lines.push(formatIgdbRow('Western (All):', igdb.western));
  lines.push(
    `Duplicate Unlinked Siblings: ${igdb.duplicateSiblingCount.toLocaleString()} total (${igdb.trackedDuplicateSiblingCount.toLocaleString()} tracked)`,
  );
  for (const d of igdb.sampleDuplicateSiblings) {
    const tag = d.tracked ? '[TRACKED]' : '[CATALOG]';
    lines.push(
      `  ${tag} #${d.gameId} (${d.platformName}) "${d.title}" -> #${d.siblingGameId} "${d.siblingTitle}" (igdb:${d.siblingIgdbId}, ${d.reason})`,
    );
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
