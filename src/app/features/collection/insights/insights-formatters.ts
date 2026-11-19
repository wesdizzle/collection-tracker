import { ReleaseDecadeFilter } from '../../../core/models/collection.models';
import { ScopedJournalSummary } from '../../../core/models/insights-analytics';

export type InsightsSubTab = 'overview' | 'value' | 'catalog';
export type PlatformSortMode = 'owned' | 'completion' | 'value' | 'name';

export interface PlatformCompletionStat {
  id: number;
  name: string;
  brand: string;
  logo?: string | null;
  ownedCount: number;
  catalogCount: number;
  completionPct: number;
  estimatedValueDollars?: number;
  pricedCount?: number;
}

export interface SeriesStat {
  name: string;
  ownedCount: number;
}

export interface DecadeStat {
  decade: Exclude<ReleaseDecadeFilter, 'all'>;
  eraName: string;
  count: number;
  pct: number;
}

export interface PlayStatusStats {
  played: number;
  playing: number;
  queued: number;
  paused: number;
  dropped: number;
  unplayed: number;
  playedPct: number;
}

export function formatInsightsDollars(
  dollars: number | null | undefined,
): string {
  if (dollars === null || dollars === undefined) return '$0.00';
  return dollars.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatInsightsWholeDollars(
  dollars: number | null | undefined,
): string {
  if (dollars === null || dollars === undefined) return '$0';
  return dollars.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

export function formatInsightsCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) {
    return '$0.00';
  }
  return formatInsightsDollars(cents / 100);
}

export function formatInsightsSignedCents(
  cents: number | null | undefined,
): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) {
    return '$0.00';
  }
  const abs = formatInsightsCents(Math.abs(cents));
  return cents >= 0 ? `+${abs}` : `-${abs}`;
}

export function buildProvenanceCoverageQueryParams(
  js: ScopedJournalSummary,
  platformId: number | null,
): Record<string, string | number> {
  const params: Record<string, string | number> = {
    reset: 1,
    ownership: 1,
    provenance_status:
      js.recordedCount < js.totalOwnedCount ? 'missing' : 'recorded',
  };
  if (platformId !== null) {
    params['platform_id'] = platformId;
  }
  return params;
}

export function buildMerchantQueryParams(
  merchantName: string,
  platformId: number | null,
): Record<string, string | number> {
  const params: Record<string, string | number> = {
    reset: 1,
    ownership: 1,
    provenance_status: 'all',
    provenance_source: merchantName,
    provenance_exact: 1,
  };
  if (platformId !== null) {
    params['platform_id'] = platformId;
  }
  return params;
}
