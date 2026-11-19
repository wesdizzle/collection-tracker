import {
  EphemeralMarketPrice,
  FilterState,
  Game,
  JournalEntry,
  Toy,
  computeItemEstimatedValueCents,
  formatJournalDate,
  getMarketPriceKey,
  isMarketPriceFresh,
} from './collection.models';

export interface ParsedJournalDate {
  raw: string;
  precision: 'exact' | 'month' | 'year';
  isApproximate: boolean;
  year: number;
  month: number | null;
  day: number | null;
  quarter: 1 | 2 | 3 | 4 | null;
  startIso: string;
  endIso: string;
  sortKey: string;
}

export interface CompactProvenanceBadge {
  text: string;
  title: string;
  icon: 'book-open' | 'gift';
}

export type GrowthGranularity = 'auto' | 'year' | 'quarter' | 'month';
export type EffectiveGrowthGranularity = 'year' | 'quarter' | 'month';
export type GrowthTimeRange = 'all' | '5y' | '3y' | '1y' | 'ytd';

export interface GrowthTimeBucket {
  key: string;
  label: string;
  shortLabel: string;
  drillFromIso: string;
  drillToIso: string;
  periodItemCount: number;
  periodGamesCount: number;
  periodToysCount: number;
  periodApproximateCount: number;
  periodCostBasisCents: number;
  periodPricedPaidCount: number;
  periodCurrentValueCents: number;
  periodMarketValuedCount: number;
  cumulativeItemCount: number;
  cumulativeGamesCount: number;
  cumulativeToysCount: number;
  cumulativeCostBasisCents: number;
  cumulativePricedPaidCount: number;
  cumulativeCurrentValueCents: number | null;
  cumulativeMarketValuedCount: number;
  cumulativeMatchedCostBasisCents: number;
  cumulativeMatchedValueCents: number;
  cumulativeMatchedCount: number;
  cumulativeMatchedDeltaCents: number | null;
  cumulativeMatchedRoiPct: number | null;
  cumulativeAvgCostCents: number | null;
}

export interface CollectionGrowthSeriesResult {
  effectiveGranularity: EffectiveGrowthGranularity;
  buckets: GrowthTimeBucket[];
  summary: {
    totalOwnedInScope: number;
    datedItemCount: number;
    undatedItemCount: number;
    approximateDateCount: number;
    excludedApproximateCount: number;
    pricedPaidCount: number;
    marketValuedCount: number;
    matchedCount: number;
    hasFreshMarketPrices: boolean;
    latestCumulativeItemCount: number;
    latestCumulativeCostBasisCents: number;
    latestCumulativeCurrentValueCents: number | null;
    latestMatchedCostBasisCents: number;
    latestMatchedValueCents: number;
    latestMatchedDeltaCents: number | null;
    latestMatchedRoiPct: number | null;
  };
}

export interface ComputeCollectionGrowthParams {
  ownedGames: readonly Game[];
  ownedToys: readonly Toy[];
  journalMap: ReadonlyMap<string, JournalEntry>;
  marketPricesMap: ReadonlyMap<string, EphemeralMarketPrice>;
  nowMs: number;
  canViewMarketPrices: boolean;
  scope: string;
  granularity: GrowthGranularity;
  range: GrowthTimeRange;
  includeApproximateDates: boolean;
  matchedOnly: boolean;
  referenceDate?: Date;
}

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function getMonthEndDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function findGameJournalEntry(
  game: Pick<Game, 'id' | 'game_id' | 'stable_id'>,
  journalMap: ReadonlyMap<string, JournalEntry>,
): JournalEntry | null {
  if (!journalMap || journalMap.size === 0) return null;
  if (game.game_id) {
    const byCanonical = journalMap.get(`game:${game.game_id}`);
    if (byCanonical) return byCanonical;
  }
  if (game.id) {
    const byId = journalMap.get(`game:${game.id}`);
    if (byId) return byId;
  }
  if (game.stable_id !== undefined && game.stable_id !== null) {
    const byStable = journalMap.get(`game:${game.stable_id}`);
    if (byStable) return byStable;
  }
  return null;
}

export function findToyJournalEntry(
  toy: Pick<Toy, 'id'>,
  journalMap: ReadonlyMap<string, JournalEntry>,
): JournalEntry | null {
  if (!journalMap || journalMap.size === 0 || !toy.id) return null;
  return journalMap.get(`toy:${toy.id}`) ?? null;
}

export function parseJournalDate(
  dateStr: string | null | undefined,
  explicitIsApprox?: number | boolean | null,
): ParsedJournalDate | null {
  if (!dateStr) return null;
  let cleaned = dateStr.trim();
  if (!cleaned) return null;

  let isApproximate = Boolean(explicitIsApprox);
  if (/^(~|around\s+|circa\s+)/i.test(cleaned)) {
    isApproximate = true;
    cleaned = cleaned.replace(/^(~|around\s+|circa\s+)/i, '').trim();
  }

  const yearMatch = cleaned.match(/^(\d{4})$/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1], 10);
    if (year < 1950 || year > 2100) return null;
    return {
      raw: cleaned,
      precision: 'year',
      isApproximate: true,
      year,
      month: null,
      day: null,
      quarter: null,
      startIso: `${year}-01-01`,
      endIso: `${year}-12-31`,
      sortKey: `${year}-01-01`,
    };
  }

  const ymMatch = cleaned.match(/^(\d{4})-(\d{2})$/);
  if (ymMatch) {
    const year = parseInt(ymMatch[1], 10);
    const month = parseInt(ymMatch[2], 10);
    if (year < 1950 || year > 2100 || month < 1 || month > 12) return null;
    const endDay = getMonthEndDay(year, month);
    const mm = pad2(month);
    return {
      raw: cleaned,
      precision: 'month',
      isApproximate: true,
      year,
      month,
      day: null,
      quarter: (Math.floor((month - 1) / 3) + 1) as 1 | 2 | 3 | 4,
      startIso: `${year}-${mm}-01`,
      endIso: `${year}-${mm}-${pad2(endDay)}`,
      sortKey: `${year}-${mm}-01`,
    };
  }

  const ymdMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10);
    const day = parseInt(ymdMatch[3], 10);
    if (year < 1950 || year > 2100 || month < 1 || month > 12) return null;
    const maxDay = getMonthEndDay(year, month);
    if (day < 1 || day > maxDay) return null;
    const mm = pad2(month);
    const dd = pad2(day);
    const iso = `${year}-${mm}-${dd}`;
    return {
      raw: cleaned,
      precision: 'exact',
      isApproximate,
      year,
      month,
      day,
      quarter: (Math.floor((month - 1) / 3) + 1) as 1 | 2 | 3 | 4,
      startIso: iso,
      endIso: iso,
      sortKey: iso,
    };
  }

  return null;
}

export function getProvenanceSourceLabel(
  entry: JournalEntry | null | undefined,
): string | null {
  if (!entry) return null;
  const merchant = (entry.merchant || '').trim();
  if (merchant) return merchant;
  const giftedBy = (entry.gifted_by || '').trim();
  if (giftedBy) return `Gift (${giftedBy})`;
  return null;
}

export function getJournalPricePaidNumber(
  entry: JournalEntry | null | undefined,
): number | null {
  if (!entry || entry.price_paid === null || entry.price_paid === undefined) {
    return null;
  }
  const num = Number(entry.price_paid);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

export function hasProvenanceDetails(
  entry: JournalEntry | null | undefined,
): boolean {
  if (!entry) return false;
  if ((entry.purchase_date || '').trim()) return true;
  if (getJournalPricePaidNumber(entry) !== null) return true;
  if ((entry.merchant || '').trim()) return true;
  if ((entry.gifted_by || '').trim()) return true;
  if ((entry.receipt_url || '').trim()) return true;
  if ((entry.notes || '').trim()) return true;
  return false;
}

function formatCompactPricePaid(dollars: number): string {
  if (dollars === 0) return 'Free';
  const rounded = Math.round(dollars * 100) / 100;
  return Number.isInteger(rounded) ? `$${rounded}` : `$${rounded.toFixed(2)}`;
}

function formatCompactDateChip(parsed: ParsedJournalDate): string {
  const prefix = parsed.isApproximate ? '~' : '';
  if (parsed.precision === 'year' || parsed.month === null) {
    return `${prefix}${parsed.year}`;
  }
  return `${prefix}${SHORT_MONTHS[parsed.month - 1]} ${parsed.year}`;
}

export function formatCompactProvenanceBadge(
  entry: JournalEntry | null | undefined,
): CompactProvenanceBadge | null {
  if (!entry || !hasProvenanceDetails(entry)) return null;

  const parsed = parseJournalDate(
    entry.purchase_date,
    entry.is_approximate_date,
  );
  const pricePaid = getJournalPricePaidNumber(entry);
  const giftedBy = (entry.gifted_by || '').trim();
  const sourceLabel = getProvenanceSourceLabel(entry);

  const chipParts: string[] = [];
  if (parsed) {
    chipParts.push(formatCompactDateChip(parsed));
  }
  if (pricePaid !== null && !(pricePaid === 0 && giftedBy)) {
    chipParts.push(formatCompactPricePaid(pricePaid));
  }
  if (sourceLabel) {
    chipParts.push(sourceLabel);
  }
  if (chipParts.length === 0) {
    if ((entry.receipt_url || '').trim()) {
      chipParts.push('Receipt');
    } else if ((entry.notes || '').trim()) {
      chipParts.push('Provenance Notes');
    }
  }

  const titleParts: string[] = [];
  if (entry.purchase_date?.trim()) {
    titleParts.push(
      `Acquired: ${formatJournalDate(entry.purchase_date, entry.is_approximate_date)}`,
    );
  }
  if (pricePaid !== null) {
    titleParts.push(
      pricePaid === 0
        ? 'Price: Free / $0.00'
        : `Paid: $${pricePaid.toFixed(2)}`,
    );
  }
  if (sourceLabel) {
    titleParts.push(`Source: ${sourceLabel}`);
  }
  if ((entry.receipt_url || '').trim()) {
    titleParts.push('Receipt linked');
  }
  if ((entry.notes || '').trim()) {
    titleParts.push(`Notes: ${entry.notes!.trim()}`);
  }

  return {
    text: chipParts.join(' · '),
    title: titleParts.join(' · '),
    icon: giftedBy ? 'gift' : 'book-open',
  };
}

function normalizeFilterDateBound(
  raw: string | undefined,
  bound: 'start' | 'end',
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = parseJournalDate(trimmed, false);
  if (!parsed) return null;
  return bound === 'start' ? parsed.startIso : parsed.endIso;
}

export function hasActiveProvenanceFilter(f: FilterState): boolean {
  if (f.provenance_status && f.provenance_status !== 'all') return true;
  if ((f.provenance_source || '').trim()) return true;
  if (
    f.acquired_year !== undefined &&
    f.acquired_year !== null &&
    f.acquired_year !== 'all'
  ) {
    return true;
  }
  if ((f.acquired_from || '').trim()) return true;
  if ((f.acquired_to || '').trim()) return true;
  if (
    f.price_paid_min !== undefined &&
    f.price_paid_min !== null &&
    Number.isFinite(Number(f.price_paid_min))
  ) {
    return true;
  }
  if (
    f.price_paid_max !== undefined &&
    f.price_paid_max !== null &&
    Number.isFinite(Number(f.price_paid_max))
  ) {
    return true;
  }
  return false;
}

export function isProvenanceSort(sortBy: FilterState['sortBy']): boolean {
  return (
    sortBy === 'acquired_desc' ||
    sortBy === 'acquired_asc' ||
    sortBy === 'price_paid_desc' ||
    sortBy === 'price_paid_asc'
  );
}

export function matchesProvenanceFilters(
  entry: JournalEntry | null | undefined,
  f: FilterState,
  normalizeStr: (val: string) => string,
): boolean {
  const parsed = parseJournalDate(
    entry?.purchase_date,
    entry?.is_approximate_date,
  );
  const pricePaid = getJournalPricePaidNumber(entry);
  const hasDetails = hasProvenanceDetails(entry);
  const giftedBy = (entry?.gifted_by || '').trim();
  const merchant = (entry?.merchant || '').trim();
  const sourceLabel = getProvenanceSourceLabel(entry);

  if (f.provenance_status && f.provenance_status !== 'all') {
    switch (f.provenance_status) {
      case 'recorded':
        if (!hasDetails) return false;
        break;
      case 'missing':
        if (hasDetails) return false;
        break;
      case 'missing_date':
        if (parsed !== null) return false;
        break;
      case 'missing_price':
        if (pricePaid !== null) return false;
        break;
      case 'exact_date':
        if (!parsed || parsed.isApproximate) return false;
        break;
      case 'approximate_date':
        if (!parsed || !parsed.isApproximate) return false;
        break;
      case 'gifted':
        if (!giftedBy) return false;
        break;
      case 'free':
        if (pricePaid !== 0) return false;
        break;
      case 'has_receipt':
        if (!(entry?.receipt_url || '').trim()) return false;
        break;
      case 'has_notes':
        if (!(entry?.notes || '').trim()) return false;
        break;
    }
  }

  const rawSourceQuery = (f.provenance_source || '').trim();
  if (rawSourceQuery) {
    const query = normalizeStr(rawSourceQuery);
    const candidates: string[] = [];
    if (merchant) candidates.push(normalizeStr(merchant));
    if (giftedBy) candidates.push(normalizeStr(giftedBy));
    if (sourceLabel) candidates.push(normalizeStr(sourceLabel));
    if (candidates.length === 0) return false;
    const matched = f.provenanceSourceExact
      ? candidates.some((c) => c === query)
      : candidates.some((c) => c.includes(query));
    if (!matched) return false;
  }

  if (
    f.acquired_year !== undefined &&
    f.acquired_year !== null &&
    f.acquired_year !== 'all'
  ) {
    if (f.acquired_year === 'undated') {
      if (parsed !== null) return false;
    } else {
      const targetYear = Number(f.acquired_year);
      if (!parsed || parsed.year !== targetYear) return false;
    }
  }

  const fromBound = normalizeFilterDateBound(f.acquired_from, 'start');
  const toBound = normalizeFilterDateBound(f.acquired_to, 'end');
  if (fromBound || toBound) {
    if (!parsed) return false;
    if (fromBound && parsed.sortKey < fromBound) return false;
    if (toBound && parsed.sortKey > toBound) return false;
  }

  const hasMin =
    f.price_paid_min !== undefined &&
    f.price_paid_min !== null &&
    Number.isFinite(Number(f.price_paid_min));
  const hasMax =
    f.price_paid_max !== undefined &&
    f.price_paid_max !== null &&
    Number.isFinite(Number(f.price_paid_max));

  if (hasMin || hasMax) {
    if (pricePaid === null) return false;
    if (hasMin && pricePaid < Number(f.price_paid_min)) return false;
    if (hasMax && pricePaid > Number(f.price_paid_max)) return false;
  }

  return true;
}

interface ScopedTimelineItem {
  itemType: 'game' | 'toy';
  parsedDate: ParsedJournalDate;
  pricePaidCents: number | null;
  currentValueCents: number | null;
}

interface PeriodDescriptor {
  key: string;
  label: string;
  shortLabel: string;
  drillFromIso: string;
  drillToIso: string;
}

function getPeriodKeyForDate(
  parsed: ParsedJournalDate,
  granularity: EffectiveGrowthGranularity,
): PeriodDescriptor {
  const year = parsed.year;
  if (granularity === 'year') {
    return {
      key: String(year),
      label: String(year),
      shortLabel: String(year),
      drillFromIso: `${year}-01-01`,
      drillToIso: `${year}-12-31`,
    };
  }
  if (granularity === 'quarter') {
    const q = parsed.quarter ?? 1;
    const startMonth = (q - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const endDay = getMonthEndDay(year, endMonth);
    return {
      key: `${year}-Q${q}`,
      label: `Q${q} ${year}`,
      shortLabel: `Q${q} '${String(year).slice(-2)}`,
      drillFromIso: `${year}-${pad2(startMonth)}-01`,
      drillToIso: `${year}-${pad2(endMonth)}-${pad2(endDay)}`,
    };
  }
  const month = parsed.month ?? 1;
  const endDay = getMonthEndDay(year, month);
  const mm = pad2(month);
  return {
    key: `${year}-${mm}`,
    label: `${SHORT_MONTHS[month - 1]} ${year}`,
    shortLabel: `${SHORT_MONTHS[month - 1]} '${String(year).slice(-2)}`,
    drillFromIso: `${year}-${mm}-01`,
    drillToIso: `${year}-${mm}-${pad2(endDay)}`,
  };
}

function generateContinuousPeriods(
  minDate: ParsedJournalDate,
  maxDate: ParsedJournalDate,
  granularity: EffectiveGrowthGranularity,
): PeriodDescriptor[] {
  const periods: PeriodDescriptor[] = [];

  if (granularity === 'year') {
    for (let y = minDate.year; y <= maxDate.year; y++) {
      periods.push(
        getPeriodKeyForDate(
          {
            raw: String(y),
            precision: 'year',
            isApproximate: false,
            year: y,
            month: 1,
            day: 1,
            quarter: 1,
            startIso: `${y}-01-01`,
            endIso: `${y}-12-31`,
            sortKey: `${y}-01-01`,
          },
          'year',
        ),
      );
    }
    return periods;
  }

  if (granularity === 'quarter') {
    const startQ = minDate.quarter ?? 1;
    const endQ = maxDate.quarter ?? 1;
    let y = minDate.year;
    let q = startQ;
    while (y < maxDate.year || (y === maxDate.year && q <= endQ)) {
      const startMonth = (q - 1) * 3 + 1;
      periods.push(
        getPeriodKeyForDate(
          {
            raw: `${y}-${pad2(startMonth)}`,
            precision: 'month',
            isApproximate: false,
            year: y,
            month: startMonth,
            day: 1,
            quarter: q,
            startIso: `${y}-${pad2(startMonth)}-01`,
            endIso: `${y}-${pad2(startMonth)}-01`,
            sortKey: `${y}-${pad2(startMonth)}-01`,
          },
          'quarter',
        ),
      );
      if (q === 4) {
        y++;
        q = 1;
      } else {
        q = (q + 1) as 1 | 2 | 3 | 4;
      }
    }
    return periods;
  }

  const startM = minDate.month ?? 1;
  const endM = maxDate.month ?? 1;
  let y = minDate.year;
  let m = startM;
  while (y < maxDate.year || (y === maxDate.year && m <= endM)) {
    periods.push(
      getPeriodKeyForDate(
        {
          raw: `${y}-${pad2(m)}`,
          precision: 'month',
          isApproximate: false,
          year: y,
          month: m,
          day: 1,
          quarter: (Math.floor((m - 1) / 3) + 1) as 1 | 2 | 3 | 4,
          startIso: `${y}-${pad2(m)}-01`,
          endIso: `${y}-${pad2(m)}-01`,
          sortKey: `${y}-${pad2(m)}-01`,
        },
        'month',
      ),
    );
    if (m === 12) {
      y++;
      m = 1;
    } else {
      m++;
    }
  }
  return periods;
}

function resolveRangeStartIso(
  range: GrowthTimeRange,
  refDate: Date,
): string | null {
  if (range === 'all') return null;
  const year = refDate.getFullYear();
  const month = refDate.getMonth() + 1;
  const day = refDate.getDate();

  if (range === 'ytd') {
    return `${year}-01-01`;
  }
  const yearsBack = range === '5y' ? 5 : range === '3y' ? 3 : 1;
  const targetYear = year - yearsBack;
  const maxDay = getMonthEndDay(targetYear, month);
  return `${targetYear}-${pad2(month)}-${pad2(Math.min(day, maxDay))}`;
}

export function computeCollectionGrowthSeries(
  params: ComputeCollectionGrowthParams,
): CollectionGrowthSeriesResult {
  const {
    ownedGames,
    ownedToys,
    journalMap,
    marketPricesMap,
    nowMs,
    canViewMarketPrices,
    scope,
    granularity,
    range,
    includeApproximateDates,
    matchedOnly,
    referenceDate = new Date(nowMs || Date.now()),
  } = params;

  const isToysOnly = scope === 'toys_only';
  const isGamesOnly = scope === 'games_only';
  const platformId = scope.startsWith('platform:')
    ? Number(scope.slice('platform:'.length))
    : null;

  const includeGames = !isToysOnly;
  const includeToys = !isGamesOnly && platformId === null;

  // Deduplicate games across multi-disc releases
  const dedupedGames: Game[] = [];
  if (includeGames) {
    const seen = new Set<string | number>();
    for (const g of ownedGames) {
      if (
        platformId !== null &&
        g.platform_id !== platformId &&
        g.parent_platform_id !== platformId
      ) {
        continue;
      }
      const key = g.game_id || g.stable_id || g.id;
      if (!seen.has(key)) {
        seen.add(key);
        dedupedGames.push(g);
      }
    }
  }

  const scopedToys = includeToys ? ownedToys : [];

  let totalOwnedInScope = 0;
  let undatedItemCount = 0;
  let approximateDateCount = 0;
  let excludedApproximateCount = 0;
  let pricedPaidCount = 0;
  let marketValuedCount = 0;
  let matchedCount = 0;
  let hasFreshMarketPrices = false;

  const datedItems: ScopedTimelineItem[] = [];

  const lookupFreshMarketPrice = (
    itemType: 'game' | 'toy',
    itemId: string,
    canonicalId?: string | null,
  ): EphemeralMarketPrice | null => {
    if (
      !canViewMarketPrices ||
      !marketPricesMap ||
      marketPricesMap.size === 0
    ) {
      return null;
    }
    if (canonicalId) {
      const c = marketPricesMap.get(getMarketPriceKey(itemType, canonicalId));
      if (c && isMarketPriceFresh(c, nowMs)) return c;
    }
    const d = marketPricesMap.get(getMarketPriceKey(itemType, itemId));
    return d && isMarketPriceFresh(d, nowMs) ? d : null;
  };

  const processItem = (
    itemType: 'game' | 'toy',
    entry: JournalEntry | null,
    currentValueCents: number | null,
  ) => {
    totalOwnedInScope++;
    if (currentValueCents !== null) {
      hasFreshMarketPrices = true;
    }

    const parsedDate = parseJournalDate(
      entry?.purchase_date,
      entry?.is_approximate_date,
    );
    if (!parsedDate) {
      undatedItemCount++;
      return;
    }
    if (parsedDate.isApproximate) {
      approximateDateCount++;
      if (!includeApproximateDates) {
        excludedApproximateCount++;
        return;
      }
    }

    const paidDollars = getJournalPricePaidNumber(entry);
    const pricePaidCents =
      paidDollars !== null ? Math.round(paidDollars * 100) : null;

    if (
      matchedOnly &&
      (pricePaidCents === null || currentValueCents === null)
    ) {
      return;
    }

    if (pricePaidCents !== null) pricedPaidCount++;
    if (currentValueCents !== null) marketValuedCount++;
    if (pricePaidCents !== null && currentValueCents !== null) matchedCount++;

    datedItems.push({
      itemType,
      parsedDate,
      pricePaidCents,
      currentValueCents,
    });
  };

  for (const g of dedupedGames) {
    const entry = findGameJournalEntry(g, journalMap);
    const canonicalId = g.game_id || g.id;
    const price = lookupFreshMarketPrice('game', g.id, canonicalId);
    const est = price ? computeItemEstimatedValueCents(g, price).cents : null;
    processItem('game', entry, est);
  }

  for (const t of scopedToys) {
    const entry = findToyJournalEntry(t, journalMap);
    const price = lookupFreshMarketPrice('toy', t.id);
    const est = price ? computeItemEstimatedValueCents(t, price).cents : null;
    processItem('toy', entry, est);
  }

  if (datedItems.length === 0) {
    const fallbackGranularity: EffectiveGrowthGranularity =
      granularity === 'auto' ? 'year' : granularity;
    return {
      effectiveGranularity: fallbackGranularity,
      buckets: [],
      summary: {
        totalOwnedInScope,
        datedItemCount: 0,
        undatedItemCount,
        approximateDateCount,
        excludedApproximateCount,
        pricedPaidCount: 0,
        marketValuedCount: 0,
        matchedCount: 0,
        hasFreshMarketPrices,
        latestCumulativeItemCount: 0,
        latestCumulativeCostBasisCents: 0,
        latestCumulativeCurrentValueCents: null,
        latestMatchedCostBasisCents: 0,
        latestMatchedValueCents: 0,
        latestMatchedDeltaCents: null,
        latestMatchedRoiPct: null,
      },
    };
  }

  datedItems.sort((a, b) =>
    a.parsedDate.sortKey.localeCompare(b.parsedDate.sortKey),
  );

  const minDate = datedItems[0].parsedDate;
  const latestItemDate = datedItems[datedItems.length - 1].parsedDate;
  const refParsed: ParsedJournalDate = {
    raw: `${referenceDate.getFullYear()}-${pad2(referenceDate.getMonth() + 1)}-${pad2(referenceDate.getDate())}`,
    precision: 'exact',
    isApproximate: false,
    year: referenceDate.getFullYear(),
    month: referenceDate.getMonth() + 1,
    day: referenceDate.getDate(),
    quarter: (Math.floor(referenceDate.getMonth() / 3) + 1) as 1 | 2 | 3 | 4,
    startIso: `${referenceDate.getFullYear()}-${pad2(referenceDate.getMonth() + 1)}-${pad2(referenceDate.getDate())}`,
    endIso: `${referenceDate.getFullYear()}-${pad2(referenceDate.getMonth() + 1)}-${pad2(referenceDate.getDate())}`,
    sortKey: `${referenceDate.getFullYear()}-${pad2(referenceDate.getMonth() + 1)}-${pad2(referenceDate.getDate())}`,
  };
  const maxDate =
    range !== 'all' && refParsed.sortKey > latestItemDate.sortKey
      ? refParsed
      : latestItemDate;

  let effectiveGranularity: EffectiveGrowthGranularity;
  if (granularity === 'auto') {
    const spanMonths =
      (maxDate.year - minDate.year) * 12 +
      ((maxDate.month ?? 1) - (minDate.month ?? 1));
    if (spanMonths > 36) {
      effectiveGranularity = 'year';
    } else if (spanMonths > 12) {
      effectiveGranularity = 'quarter';
    } else {
      effectiveGranularity = 'month';
    }
  } else {
    effectiveGranularity = granularity;
  }

  const periodDescriptors = generateContinuousPeriods(
    minDate,
    maxDate,
    effectiveGranularity,
  );
  const groupedItems = new Map<string, ScopedTimelineItem[]>();
  for (const item of datedItems) {
    const desc = getPeriodKeyForDate(item.parsedDate, effectiveGranularity);
    const list = groupedItems.get(desc.key);
    if (list) {
      list.push(item);
    } else {
      groupedItems.set(desc.key, [item]);
    }
  }

  let cumItems = 0;
  let cumGames = 0;
  let cumToys = 0;
  let cumCostCents = 0;
  let cumPaidCount = 0;
  let cumValCents = 0;
  let cumValCount = 0;
  let cumMatchedCostCents = 0;
  let cumMatchedValCents = 0;
  let cumMatchedCount = 0;

  const fullBuckets: GrowthTimeBucket[] = periodDescriptors.map((desc) => {
    const items = groupedItems.get(desc.key) || [];
    let pGames = 0;
    let pToys = 0;
    let pApprox = 0;
    let pCost = 0;
    let pPaidCount = 0;
    let pVal = 0;
    let pValCount = 0;

    for (const it of items) {
      if (it.itemType === 'game') pGames++;
      else pToys++;
      if (it.parsedDate.isApproximate) pApprox++;

      if (it.pricePaidCents !== null) {
        pCost += it.pricePaidCents;
        pPaidCount++;
      }
      if (it.currentValueCents !== null) {
        pVal += it.currentValueCents;
        pValCount++;
      }
      if (it.pricePaidCents !== null && it.currentValueCents !== null) {
        cumMatchedCostCents += it.pricePaidCents;
        cumMatchedValCents += it.currentValueCents;
        cumMatchedCount++;
      }
    }

    cumItems += items.length;
    cumGames += pGames;
    cumToys += pToys;
    cumCostCents += pCost;
    cumPaidCount += pPaidCount;
    cumValCents += pVal;
    cumValCount += pValCount;

    const matchedDelta =
      cumMatchedCount > 0 ? cumMatchedValCents - cumMatchedCostCents : null;
    const matchedRoiPct =
      cumMatchedCount > 0 && cumMatchedCostCents > 0
        ? Math.round(
            ((cumMatchedValCents - cumMatchedCostCents) / cumMatchedCostCents) *
              100,
          )
        : null;

    return {
      key: desc.key,
      label: desc.label,
      shortLabel: desc.shortLabel,
      drillFromIso: desc.drillFromIso,
      drillToIso: desc.drillToIso,
      periodItemCount: items.length,
      periodGamesCount: pGames,
      periodToysCount: pToys,
      periodApproximateCount: pApprox,
      periodCostBasisCents: pCost,
      periodPricedPaidCount: pPaidCount,
      periodCurrentValueCents: pVal,
      periodMarketValuedCount: pValCount,
      cumulativeItemCount: cumItems,
      cumulativeGamesCount: cumGames,
      cumulativeToysCount: cumToys,
      cumulativeCostBasisCents: cumCostCents,
      cumulativePricedPaidCount: cumPaidCount,
      cumulativeCurrentValueCents: cumValCount > 0 ? cumValCents : null,
      cumulativeMarketValuedCount: cumValCount,
      cumulativeMatchedCostBasisCents: cumMatchedCostCents,
      cumulativeMatchedValueCents: cumMatchedValCents,
      cumulativeMatchedCount: cumMatchedCount,
      cumulativeMatchedDeltaCents: matchedDelta,
      cumulativeMatchedRoiPct: matchedRoiPct,
      cumulativeAvgCostCents:
        cumPaidCount > 0 ? Math.round(cumCostCents / cumPaidCount) : null,
    };
  });

  const rangeStartIso = resolveRangeStartIso(range, referenceDate);
  const slicedBuckets = rangeStartIso
    ? fullBuckets.filter((b) => b.drillToIso >= rangeStartIso)
    : fullBuckets;
  const visibleBuckets = slicedBuckets.length > 0 ? slicedBuckets : fullBuckets;
  const latest = visibleBuckets[visibleBuckets.length - 1];

  return {
    effectiveGranularity,
    buckets: visibleBuckets,
    summary: {
      totalOwnedInScope,
      datedItemCount: datedItems.length,
      undatedItemCount,
      approximateDateCount,
      excludedApproximateCount,
      pricedPaidCount,
      marketValuedCount,
      matchedCount,
      hasFreshMarketPrices,
      latestCumulativeItemCount: latest.cumulativeItemCount,
      latestCumulativeCostBasisCents: latest.cumulativeCostBasisCents,
      latestCumulativeCurrentValueCents: latest.cumulativeCurrentValueCents,
      latestMatchedCostBasisCents: latest.cumulativeMatchedCostBasisCents,
      latestMatchedValueCents: latest.cumulativeMatchedValueCents,
      latestMatchedDeltaCents: latest.cumulativeMatchedDeltaCents,
      latestMatchedRoiPct: latest.cumulativeMatchedRoiPct,
    },
  };
}
