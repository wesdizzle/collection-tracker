import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import {
  KitChartDiffBand,
  KitChartPoint,
  KitChartSeries,
  KitSelectComponent,
  KitSelectGroup,
  KitSelectOption,
  KitTimeSeriesChartComponent,
} from '@wesdizzle/app-kit/angular';
import {
  EphemeralMarketPrice,
  Game,
  JournalEntry,
  Platform,
  Toy,
} from '../../../../core/models/collection.models';
import {
  CollectionGrowthSeriesResult,
  GrowthGranularity,
  GrowthTimeBucket,
  GrowthTimeRange,
  computeCollectionGrowthSeries,
} from '../../../../core/models/provenance-analytics';
import { CollectionService } from '../../../../core/services/collection.service';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-collection-growth-chart',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    IconComponent,
    KitSelectComponent,
    KitTimeSeriesChartComponent,
  ],
  templateUrl: './collection-growth-chart.component.html',
  styleUrl: './collection-growth-chart.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollectionGrowthChartComponent {
  private readonly collectionService = inject(CollectionService);
  private readonly router = inject(Router);

  public readonly ownedGames = input.required<readonly Game[]>();
  public readonly ownedToys = input.required<readonly Toy[]>();
  public readonly platforms = input<readonly Platform[]>([]);
  public readonly externalScope = input<string | null>(null);
  public readonly hideScopeSelect = input<boolean>(false);
  public readonly hideKpiStrip = input<boolean>(false);

  public readonly selectedScope = signal<string>('all_owned');
  public readonly effectiveScope = computed<string>(
    () => this.externalScope() ?? this.selectedScope(),
  );
  public readonly viewMode = signal<'cumulative' | 'period'>('cumulative');
  public readonly granularity = signal<GrowthGranularity>('auto');
  public readonly timeRange = signal<GrowthTimeRange>('all');
  public readonly includeApproximateDates = signal<boolean>(true);
  public readonly matchedOnly = signal<boolean>(false);

  public readonly canViewMarketPrices = computed<boolean>(
    () => this.collectionService.canViewMarketPrices?.() === true,
  );

  public readonly isMarketUnconfigured = computed<boolean>(
    () => this.collectionService.marketPricingConfigured?.() === false,
  );

  private readonly journalMap = computed<ReadonlyMap<string, JournalEntry>>(
    () => this.collectionService.journalEntriesMap?.() ?? new Map(),
  );

  private readonly marketPricesMap = computed<
    ReadonlyMap<string, EphemeralMarketPrice>
  >(() => this.collectionService.marketPricesMap?.() ?? new Map());

  private readonly marketPriceNowMs = computed<number>(
    () => this.collectionService.marketPriceNowMs?.() ?? Date.now(),
  );

  public readonly platformFilterOptions = computed<
    Array<{ id: number; name: string; count: number }>
  >(() => {
    const owned = this.ownedGames();
    const counts = new Map<number, number>();
    for (const g of owned) {
      counts.set(g.platform_id, (counts.get(g.platform_id) || 0) + 1);
    }
    return this.platforms()
      .filter((p) => (counts.get(p.id) || 0) > 0)
      .map((p) => ({
        id: p.id,
        name: p.display_name || p.name,
        count: counts.get(p.id) || 0,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  });

  public readonly scopeOptions = computed<KitSelectOption<string>[]>(() => [
    {
      value: 'all_owned',
      label: `All Owned (${this.ownedGames().length + this.ownedToys().length})`,
    },
    {
      value: 'games_only',
      label: `Games Only (${this.ownedGames().length})`,
    },
    {
      value: 'toys_only',
      label: `Toys Only (${this.ownedToys().length})`,
    },
  ]);

  public readonly scopeGroups = computed<KitSelectGroup<string>[]>(() => {
    const opts = this.platformFilterOptions();
    if (opts.length === 0) return [];
    return [
      {
        label: 'Platforms',
        options: opts.map((p) => ({
          value: `platform:${p.id}`,
          label: `${p.name} (${p.count})`,
        })),
      },
    ];
  });

  public readonly granularityOptions: readonly KitSelectOption<GrowthGranularity>[] =
    [
      { value: 'auto', label: 'Granularity: Auto' },
      { value: 'year', label: 'By Year' },
      { value: 'quarter', label: 'By Quarter' },
      { value: 'month', label: 'By Month' },
    ];

  public readonly timeRangeOptions: readonly KitSelectOption<GrowthTimeRange>[] =
    [
      { value: 'all', label: 'Range: All Time' },
      { value: '5y', label: 'Last 5 Years' },
      { value: '3y', label: 'Last 3 Years' },
      { value: '1y', label: 'Last 12 Months' },
      { value: 'ytd', label: 'Year to Date' },
    ];

  public readonly growthData = computed<CollectionGrowthSeriesResult>(() =>
    computeCollectionGrowthSeries({
      ownedGames: this.ownedGames(),
      ownedToys: this.ownedToys(),
      journalMap: this.journalMap(),
      marketPricesMap: this.marketPricesMap(),
      nowMs: this.marketPriceNowMs(),
      canViewMarketPrices: this.canViewMarketPrices(),
      scope: this.effectiveScope(),
      granularity: this.granularity(),
      range: this.timeRange(),
      includeApproximateDates: this.includeApproximateDates(),
      matchedOnly: this.matchedOnly() && this.canViewMarketPrices(),
    }),
  );

  public readonly chartMode = computed<'line' | 'bar'>(() =>
    this.viewMode() === 'cumulative' ? 'line' : 'bar',
  );

  public readonly chartPoints = computed<KitChartPoint[]>(() => {
    const isCumulative = this.viewMode() === 'cumulative';
    const hasFresh = this.growthData().summary.hasFreshMarketPrices;

    return this.growthData().buckets.map((bucket) => {
      const costDollars =
        (isCumulative
          ? bucket.cumulativeCostBasisCents
          : bucket.periodCostBasisCents) / 100;

      let valueDollars: number | null = null;
      if (isCumulative) {
        valueDollars =
          bucket.cumulativeCurrentValueCents !== null
            ? bucket.cumulativeCurrentValueCents / 100
            : null;
      } else if (hasFresh) {
        valueDollars =
          bucket.periodMarketValuedCount > 0
            ? bucket.periodCurrentValueCents / 100
            : 0;
      }

      const itemCount = isCumulative
        ? bucket.cumulativeItemCount
        : bucket.periodItemCount;

      return {
        key: bucket.key,
        label: bucket.label,
        shortLabel: bucket.shortLabel,
        values: {
          cost_basis: costDollars,
          current_value: valueDollars,
          items: itemCount,
        },
        meta: bucket,
      };
    });
  });

  public readonly chartSeries = computed<KitChartSeries[]>(() => {
    const isCumulative = this.viewMode() === 'cumulative';
    const summary = this.growthData().summary;

    const list: KitChartSeries[] = [
      {
        id: 'cost_basis',
        label: isCumulative ? 'Cumulative Spend' : 'Period Spend',
        axis: 'left',
        color: 'var(--m3-secondary)',
        areaFill: isCumulative,
        formatValue: (v: number) => this.formatUsdDollars(v),
      },
    ];

    if (this.canViewMarketPrices()) {
      list.push({
        id: 'current_value',
        label: 'Est. Current Value (<6h eBay)',
        axis: 'left',
        color: '#22c55e',
        areaFill: false,
        disabled: !summary.hasFreshMarketPrices,
        disabledHint: this.isMarketUnconfigured()
          ? 'Configure eBay Worker secrets to unlock live comps'
          : 'Scan live eBay prices below to unlock',
        formatValue: (v: number) => this.formatUsdDollars(v),
      });
    }

    list.push({
      id: 'items',
      label: isCumulative ? 'Cumulative Items' : 'Items Added',
      axis: 'right',
      color: 'var(--m3-primary)',
      areaFill: false,
      formatValue: (v: number) => `${Math.round(v).toLocaleString()} items`,
    });

    return list;
  });

  public readonly chartDiffBand = computed<KitChartDiffBand | null>(() => {
    if (this.viewMode() !== 'cumulative') return null;
    if (!this.canViewMarketPrices()) return null;
    if (!this.growthData().summary.hasFreshMarketPrices) return null;
    return {
      upperSeriesId: 'current_value',
      lowerSeriesId: 'cost_basis',
    };
  });

  public readonly leftAxisFormatter = (val: number): string => {
    if (!Number.isFinite(val)) return '$0';
    if (Math.abs(val) >= 1000) {
      const k = val / 1000;
      const decimals = Math.abs(k) >= 10 || Number.isInteger(k) ? 0 : 1;
      return `$${k.toFixed(decimals)}k`;
    }
    return `$${Math.round(val).toLocaleString()}`;
  };

  public readonly rightAxisFormatter = (val: number): string =>
    Number.isFinite(val) ? Math.round(val).toLocaleString() : '0';

  public readonly emptyStateMessage = computed<string>(() => {
    const summary = this.growthData().summary;
    if (summary.totalOwnedInScope === 0) {
      return 'Add owned items in this scope to track collection growth over time.';
    }
    if (this.matchedOnly() && summary.hasFreshMarketPrices) {
      return 'No dated items in this scope have both a recorded purchase price and a live <6h eBay valuation.';
    }
    if (
      !this.includeApproximateDates() &&
      summary.excludedApproximateCount > 0
    ) {
      return `All ${summary.excludedApproximateCount} dated items in this scope use approximate dates. Enable "Include approx. dates" to display them.`;
    }
    return `None of the ${summary.totalOwnedInScope} owned items in this scope have a recorded acquisition date yet.`;
  });

  public readonly missingDateRoute = computed<string[]>(() =>
    this.effectiveScope() === 'toys_only'
      ? ['/collection/toys']
      : ['/collection/games'],
  );

  public readonly missingDateQueryParams = computed<
    Record<string, string | number>
  >(() => {
    const params: Record<string, string | number> = {
      reset: 1,
      ownership: 1,
      provenance_status: 'missing_date',
    };
    const pid = this.selectedPlatformId();
    if (pid !== null) {
      params['platform_id'] = pid;
    }
    return params;
  });

  public readonly selectedPlatformId = computed<number | null>(() => {
    const scope = this.effectiveScope();
    if (!scope.startsWith('platform:')) return null;
    const id = Number(scope.slice('platform:'.length));
    return Number.isFinite(id) ? id : null;
  });

  public onScopeChange(value: string): void {
    this.selectedScope.set(value || 'all_owned');
  }

  public onGranularityChange(value: GrowthGranularity): void {
    this.granularity.set(value || 'auto');
  }

  public onTimeRangeChange(value: GrowthTimeRange): void {
    this.timeRange.set(value || 'all');
  }

  public onIncludeApproxToggle(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.includeApproximateDates.set(Boolean(input.checked));
  }

  public onMatchedOnlyToggle(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.matchedOnly.set(Boolean(input.checked));
  }

  public onBucketClick(point: KitChartPoint): void {
    const bucket = this.asBucket(point.meta);
    if (!bucket) return;
    const scope = this.effectiveScope();
    const targetRoute =
      scope === 'toys_only' ? '/collection/toys' : '/collection/games';
    const queryParams: Record<string, string | number> = {
      reset: 1,
      ownership: 1,
      provenance_status: 'all',
      acquired_from: bucket.drillFromIso,
      acquired_to: bucket.drillToIso,
    };
    const platformId = this.selectedPlatformId();
    if (platformId !== null) {
      queryParams['platform_id'] = platformId;
    }
    void this.router.navigate([targetRoute], { queryParams });
  }

  public asBucket(meta: unknown): GrowthTimeBucket | null {
    if (!meta || typeof meta !== 'object') return null;
    return meta as GrowthTimeBucket;
  }

  public formatCents(cents: number | null | undefined): string {
    if (cents === null || cents === undefined || !Number.isFinite(cents)) {
      return '—';
    }
    return this.formatUsdDollars(cents / 100);
  }

  public formatSignedCents(cents: number | null | undefined): string {
    if (cents === null || cents === undefined || !Number.isFinite(cents)) {
      return '—';
    }
    const prefix = cents > 0 ? '+' : cents < 0 ? '-' : '';
    return `${prefix}${this.formatUsdDollars(Math.abs(cents) / 100)}`;
  }

  public formatUsdDollars(dollars: number): string {
    if (!Number.isFinite(dollars)) return '$0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(dollars);
  }
}
