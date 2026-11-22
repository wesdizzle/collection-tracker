import {
  EphemeralMarketPrice,
  Game,
  JournalEntry,
  MarketPriceItemType,
  Platform,
  Toy,
  computeItemEstimatedValueCents,
  formatPriceAge,
  getMarketPriceKey,
  isMarketPriceFresh,
} from './collection.models';
import {
  findGameJournalEntry,
  findToyJournalEntry,
  getJournalPricePaidNumber,
  getProvenanceSourceLabel,
  parseJournalDate,
} from './provenance-analytics';

export interface ScopedOwnedValuationEntry {
  itemType: MarketPriceItemType;
  canonicalId: string;
  routeId: string;
  title: string;
  subtitle: string;
  estimatedCents: number | null;
  tierLabel: string;
  price: EphemeralMarketPrice | null;
  journalEntry: JournalEntry | null;
  pricePaidCents: number | null;
  deltaCents: number | null;
}

export interface ScopedValuationSummary {
  entries: ScopedOwnedValuationEntry[];
  totalOwnedCount: number;
  pricedCount: number;
  coveragePct: number;
  totalEstimatedCents: number;
  matchedCount: number;
  matchedCostBasisCents: number;
  matchedEstimatedCents: number;
  unrealizedDeltaCents: number;
  unrealizedRoiPct: number | null;
  topValuable: Array<ScopedOwnedValuationEntry & { estimatedCents: number }>;
  topCostBasis: Array<ScopedOwnedValuationEntry & { pricePaidCents: number }>;
  disclosureText: string;
}

export interface ComputeScopedValuationParams {
  ownedGames: readonly Game[];
  ownedToys: readonly Toy[];
  platforms: readonly Platform[];
  journalMap: ReadonlyMap<string, JournalEntry>;
  marketPricesMap: ReadonlyMap<string, EphemeralMarketPrice>;
  nowMs: number;
  scope: string;
  canViewMarketPrices: boolean;
}

export interface MerchantStat {
  name: string;
  count: number;
  totalSpendDollars: number;
}

export interface ScopedJournalSummary {
  totalOwnedCount: number;
  recordedCount: number;
  missingCount: number;
  datedCount: number;
  undatedCount: number;
  coveragePct: number;
  paidEntryCount: number;
  totalTrackedSpendDollars: number;
  averagePricePaidDollars: number;
  allMerchants: MerchantStat[];
  topMerchants: MerchantStat[];
}

export interface ComputeScopedJournalParams {
  ownedGames: readonly Game[];
  ownedToys: readonly Toy[];
  journalMap: ReadonlyMap<string, JournalEntry>;
  scope: string;
}

export interface ToySeriesCompletionStat {
  name: string;
  ownedCount: number;
  catalogCount: number;
  completionPct: number;
}

export interface ToyLineCompletionStat {
  name: string;
  ownedCount: number;
  catalogCount: number;
  completionPct: number;
  topSeries: ToySeriesCompletionStat[];
}

export interface PlatformMediaStat {
  id: number;
  name: string;
  brand: string;
  logo?: string | null;
  physicalCount: number;
  ownedMediaCount: number;
  missingCount: number;
  mediaOwnedPct: number;
}

export interface PhysicalMediaSummary {
  physicalCount: number;
  ownedMediaCount: number;
  missingCount: number;
  mediaOwnedRatePct: number;
  platformBreakdown: PlatformMediaStat[];
}

function parsePlatformScopeId(scope: string): number | null {
  if (!scope.startsWith('platform:')) return null;
  const parsed = Number(scope.slice('platform:'.length));
  return Number.isFinite(parsed) ? parsed : null;
}

function gameMatchesPlatform(game: Game, platformId: number): boolean {
  return (
    game.platform_id === platformId || game.parent_platform_id === platformId
  );
}

function findFreshPrice(
  marketPricesMap: ReadonlyMap<string, EphemeralMarketPrice>,
  nowMs: number,
  itemType: MarketPriceItemType,
  itemId: string,
  canonicalId?: string | null,
): EphemeralMarketPrice | null {
  if (!marketPricesMap || marketPricesMap.size === 0) return null;
  if (canonicalId) {
    const byCanonical = marketPricesMap.get(
      getMarketPriceKey(itemType, canonicalId),
    );
    if (byCanonical && isMarketPriceFresh(byCanonical, nowMs)) {
      return byCanonical;
    }
  }
  const byId = marketPricesMap.get(getMarketPriceKey(itemType, itemId));
  return byId && isMarketPriceFresh(byId, nowMs) ? byId : null;
}

export function computeScopedValuation(
  params: ComputeScopedValuationParams,
): ScopedValuationSummary {
  const {
    ownedGames,
    ownedToys,
    journalMap,
    marketPricesMap,
    nowMs,
    scope,
    canViewMarketPrices,
  } = params;

  const platformId = parsePlatformScopeId(scope);
  const includeGames =
    scope !== 'toys_only' && (platformId === null || ownedGames.length > 0);
  const includeToys =
    scope === 'all_owned' ||
    scope === 'with_cost_basis' ||
    scope === 'toys_only';

  const entries: ScopedOwnedValuationEntry[] = [];

  if (includeGames) {
    for (const g of ownedGames) {
      if (platformId !== null && !gameMatchesPlatform(g, platformId)) {
        continue;
      }
      const jEntry = findGameJournalEntry(g, journalMap);
      const paidDollars = getJournalPricePaidNumber(jEntry);
      if (scope === 'with_cost_basis' && paidDollars === null) {
        continue;
      }
      const pricePaidCents =
        paidDollars !== null ? Math.round(paidDollars * 100) : null;
      const canonicalId = g.game_id || g.id;
      const price = canViewMarketPrices
        ? findFreshPrice(marketPricesMap, nowMs, 'game', g.id, canonicalId)
        : null;
      const est = canViewMarketPrices
        ? computeItemEstimatedValueCents(g, price)
        : { cents: null, tierLabel: 'Unpriced' };
      const deltaCents =
        est.cents !== null && pricePaidCents !== null
          ? est.cents - pricePaidCents
          : null;

      entries.push({
        itemType: 'game',
        canonicalId,
        routeId:
          g.stable_id !== undefined ? String(g.stable_id) : g.game_id || g.id,
        title: g.title,
        subtitle: g.display_name || g.platform || 'Game',
        estimatedCents: est.cents,
        tierLabel: est.tierLabel,
        price,
        journalEntry: jEntry,
        pricePaidCents,
        deltaCents,
      });
    }
  }

  if (includeToys) {
    for (const t of ownedToys) {
      const jEntry = findToyJournalEntry(t, journalMap);
      const paidDollars = getJournalPricePaidNumber(jEntry);
      if (scope === 'with_cost_basis' && paidDollars === null) {
        continue;
      }
      const pricePaidCents =
        paidDollars !== null ? Math.round(paidDollars * 100) : null;
      const price = canViewMarketPrices
        ? findFreshPrice(marketPricesMap, nowMs, 'toy', t.id)
        : null;
      const est = canViewMarketPrices
        ? computeItemEstimatedValueCents(t, price)
        : { cents: null, tierLabel: 'Unpriced' };
      const deltaCents =
        est.cents !== null && pricePaidCents !== null
          ? est.cents - pricePaidCents
          : null;

      entries.push({
        itemType: 'toy',
        canonicalId: t.id,
        routeId: t.id,
        title: t.name,
        subtitle: t.series_name ? `${t.line} · ${t.series_name}` : t.line,
        estimatedCents: est.cents,
        tierLabel: est.tierLabel,
        price,
        journalEntry: jEntry,
        pricePaidCents,
        deltaCents,
      });
    }
  }

  const totalOwnedCount = entries.length;
  let pricedCount = 0;
  let totalEstimatedCents = 0;

  let matchedCount = 0;
  let matchedCostBasisCents = 0;
  let matchedEstimatedCents = 0;

  let newestFetchedMs = 0;
  let oldestFetchedMs = Number.POSITIVE_INFINITY;
  let newestPrice: EphemeralMarketPrice | null = null;
  let oldestPrice: EphemeralMarketPrice | null = null;

  for (const entry of entries) {
    if (entry.estimatedCents !== null) {
      pricedCount++;
      totalEstimatedCents += entry.estimatedCents;

      if (entry.pricePaidCents !== null) {
        matchedCount++;
        matchedCostBasisCents += entry.pricePaidCents;
        matchedEstimatedCents += entry.estimatedCents;
      }
    }

    if (entry.price?.fetched_at) {
      const fetchedMs = Date.parse(entry.price.fetched_at);
      if (Number.isFinite(fetchedMs)) {
        if (fetchedMs > newestFetchedMs) {
          newestFetchedMs = fetchedMs;
          newestPrice = entry.price;
        }
        if (fetchedMs < oldestFetchedMs) {
          oldestFetchedMs = fetchedMs;
          oldestPrice = entry.price;
        }
      }
    }
  }

  const coveragePct =
    totalOwnedCount > 0 ? Math.round((pricedCount / totalOwnedCount) * 100) : 0;
  const unrealizedDeltaCents = matchedEstimatedCents - matchedCostBasisCents;
  const unrealizedRoiPct =
    matchedCostBasisCents > 0
      ? Math.round((unrealizedDeltaCents / matchedCostBasisCents) * 100)
      : null;

  const topValuable = entries
    .filter(
      (e): e is ScopedOwnedValuationEntry & { estimatedCents: number } =>
        e.estimatedCents !== null,
    )
    .sort((a, b) => b.estimatedCents - a.estimatedCents)
    .slice(0, 8);

  const topCostBasis = entries
    .filter(
      (e): e is ScopedOwnedValuationEntry & { pricePaidCents: number } =>
        e.pricePaidCents !== null && e.pricePaidCents > 0,
    )
    .sort((a, b) => b.pricePaidCents - a.pricePaidCents)
    .slice(0, 8);

  let disclosureText = 'No active live eBay snapshots in the last 6 hours.';
  if (oldestPrice && newestPrice) {
    if (oldestPrice === newestPrice || oldestFetchedMs === newestFetchedMs) {
      disclosureText = formatPriceAge(
        newestPrice.fetched_at,
        newestPrice.expires_at,
        nowMs,
      );
    } else {
      disclosureText = `Live eBay active listings · Oldest snapshot: ${formatPriceAge(
        oldestPrice.fetched_at,
        oldestPrice.expires_at,
        nowMs,
      ).replace('Live eBay active listings · ', '')}`;
    }
  }

  return {
    entries,
    totalOwnedCount,
    pricedCount,
    coveragePct,
    totalEstimatedCents,
    matchedCount,
    matchedCostBasisCents,
    matchedEstimatedCents,
    unrealizedDeltaCents,
    unrealizedRoiPct,
    topValuable,
    topCostBasis,
    disclosureText,
  };
}

export function computeScopedJournalSummary(
  params: ComputeScopedJournalParams,
): ScopedJournalSummary {
  const { ownedGames, ownedToys, journalMap, scope } = params;
  const platformId = parsePlatformScopeId(scope);
  const includeGames = scope !== 'toys_only';
  const includeToys =
    scope === 'all_owned' ||
    scope === 'with_cost_basis' ||
    scope === 'toys_only';

  let totalOwnedCount = 0;
  let recordedCount = 0;
  let datedCount = 0;
  let undatedCount = 0;
  let paidEntryCount = 0;
  let totalTrackedSpendDollars = 0;
  const merchantCounts = new Map<
    string,
    { count: number; totalSpendDollars: number }
  >();

  const accumulateEntry = (entry: JournalEntry | null) => {
    const paidDollars = getJournalPricePaidNumber(entry);
    if (scope === 'with_cost_basis' && paidDollars === null) {
      return;
    }

    totalOwnedCount++;
    if (!entry) {
      undatedCount++;
      return;
    }
    recordedCount++;

    if (parseJournalDate(entry.purchase_date, entry.is_approximate_date)) {
      datedCount++;
    } else {
      undatedCount++;
    }

    if (paidDollars !== null) {
      totalTrackedSpendDollars += paidDollars;
      if (paidDollars > 0) {
        paidEntryCount++;
      }
    }

    const merchantName = getProvenanceSourceLabel(entry);
    if (merchantName) {
      const cur = merchantCounts.get(merchantName) || {
        count: 0,
        totalSpendDollars: 0,
      };
      cur.count += 1;
      cur.totalSpendDollars += paidDollars ?? 0;
      merchantCounts.set(merchantName, cur);
    }
  };

  if (includeGames) {
    for (const g of ownedGames) {
      if (platformId !== null && !gameMatchesPlatform(g, platformId)) {
        continue;
      }
      accumulateEntry(findGameJournalEntry(g, journalMap));
    }
  }

  if (includeToys) {
    for (const t of ownedToys) {
      accumulateEntry(findToyJournalEntry(t, journalMap));
    }
  }

  const missingCount = Math.max(0, totalOwnedCount - recordedCount);
  const coveragePct =
    totalOwnedCount > 0
      ? Math.round((recordedCount / totalOwnedCount) * 100)
      : 0;
  const averagePricePaidDollars =
    paidEntryCount > 0
      ? Math.round((totalTrackedSpendDollars / paidEntryCount) * 100) / 100
      : 0;

  const allMerchants: MerchantStat[] = Array.from(merchantCounts.entries())
    .map(([name, data]) => ({
      name,
      count: data.count,
      totalSpendDollars: Math.round(data.totalSpendDollars * 100) / 100,
    }))
    .sort(
      (a, b) => b.count - a.count || b.totalSpendDollars - a.totalSpendDollars,
    );

  return {
    totalOwnedCount,
    recordedCount,
    missingCount,
    datedCount,
    undatedCount,
    coveragePct,
    paidEntryCount,
    totalTrackedSpendDollars: Math.round(totalTrackedSpendDollars * 100) / 100,
    averagePricePaidDollars,
    allMerchants,
    topMerchants: allMerchants.slice(0, 6),
  };
}

export function computeToyLineStats(
  allToys: readonly Toy[],
): ToyLineCompletionStat[] {
  const lineMap = new Map<
    string,
    {
      ownedCount: number;
      catalogCount: number;
      seriesMap: Map<string, { ownedCount: number; catalogCount: number }>;
    }
  >();

  for (const toy of allToys) {
    const lineName = (toy.line || '').trim() || 'Other';
    const seriesName = (toy.series_name || '').trim() || 'Other';
    let lineBucket = lineMap.get(lineName);
    if (!lineBucket) {
      lineBucket = { ownedCount: 0, catalogCount: 0, seriesMap: new Map() };
      lineMap.set(lineName, lineBucket);
    }
    lineBucket.catalogCount++;
    const isOwned = toy.ownership_status === 1;
    if (isOwned) {
      lineBucket.ownedCount++;
    }

    let seriesBucket = lineBucket.seriesMap.get(seriesName);
    if (!seriesBucket) {
      seriesBucket = { ownedCount: 0, catalogCount: 0 };
      lineBucket.seriesMap.set(seriesName, seriesBucket);
    }
    seriesBucket.catalogCount++;
    if (isOwned) {
      seriesBucket.ownedCount++;
    }
  }

  return Array.from(lineMap.entries())
    .map(([name, data]) => {
      const completionPct =
        data.catalogCount > 0
          ? Math.round((data.ownedCount / data.catalogCount) * 100)
          : 0;
      const topSeries: ToySeriesCompletionStat[] = Array.from(
        data.seriesMap.entries(),
      )
        .map(([seriesName, sData]) => ({
          name: seriesName,
          ownedCount: sData.ownedCount,
          catalogCount: sData.catalogCount,
          completionPct:
            sData.catalogCount > 0
              ? Math.round((sData.ownedCount / sData.catalogCount) * 100)
              : 0,
        }))
        .sort(
          (a, b) =>
            b.ownedCount - a.ownedCount ||
            b.completionPct - a.completionPct ||
            a.name.localeCompare(b.name),
        );

      return {
        name,
        ownedCount: data.ownedCount,
        catalogCount: data.catalogCount,
        completionPct,
        topSeries,
      };
    })
    .sort(
      (a, b) =>
        b.ownedCount - a.ownedCount ||
        b.completionPct - a.completionPct ||
        a.name.localeCompare(b.name),
    );
}

export function computePhysicalMediaStats(
  allGames: readonly Game[],
  platforms: readonly Platform[],
): PhysicalMediaSummary {
  const physicalReleases = allGames.filter((g) => g.ownership_status === 1);
  const ownedMediaReleases = physicalReleases.filter((g) =>
    Boolean(g.has_media),
  );
  const physicalCount = physicalReleases.length;
  const ownedMediaCount = ownedMediaReleases.length;
  const missingCount = Math.max(0, physicalCount - ownedMediaCount);
  const mediaOwnedRatePct =
    physicalCount > 0 ? Math.round((ownedMediaCount / physicalCount) * 100) : 0;

  const platformBreakdown: PlatformMediaStat[] = [];
  for (const p of platforms) {
    const onPlatform = physicalReleases.filter((g) =>
      gameMatchesPlatform(g, p.id),
    );
    if (onPlatform.length === 0) continue;
    const platMediaOwned = onPlatform.filter((g) =>
      Boolean(g.has_media),
    ).length;
    const platMissing = Math.max(0, onPlatform.length - platMediaOwned);
    platformBreakdown.push({
      id: p.id,
      name: p.display_name || p.name,
      brand: p.brand || 'Other',
      logo: p.image_url,
      physicalCount: onPlatform.length,
      ownedMediaCount: platMediaOwned,
      missingCount: platMissing,
      mediaOwnedPct: Math.round((platMediaOwned / onPlatform.length) * 100),
    });
  }

  platformBreakdown.sort(
    (a, b) =>
      b.missingCount - a.missingCount ||
      b.physicalCount - a.physicalCount ||
      a.name.localeCompare(b.name),
  );

  return {
    physicalCount,
    ownedMediaCount,
    missingCount,
    mediaOwnedRatePct,
    platformBreakdown,
  };
}
