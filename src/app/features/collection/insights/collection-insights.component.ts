import {
  Component,
  DestroyRef,
  inject,
  computed,
  signal,
  OnInit,
  ChangeDetectionStrategy,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  KitMeterSegment,
  KitSelectGroup,
  KitSelectOption,
  KitTabItem,
  KitTabsComponent,
  createAnimatedNumber,
} from '@wesdizzle/app-kit/angular';
import { CollectionService } from '../../../core/services/collection.service';
import {
  Game,
  ReleaseDecadeFilter,
  Toy,
  computeItemEstimatedValueCents,
  getMarketPriceKey,
  isMarketPriceFresh,
} from '../../../core/models/collection.models';
import {
  PhysicalMediaSummary,
  ScopedJournalSummary,
  ScopedValuationSummary,
  ToyLineCompletionStat,
  computePhysicalMediaStats,
  computeScopedJournalSummary,
  computeScopedValuation,
  computeToyLineStats,
  isPhysicalReleaseGame,
} from '../../../core/models/insights-analytics';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { InsightsOverviewTabComponent } from './insights-overview-tab/insights-overview-tab.component';
import { InsightsLedgerTabComponent } from './insights-ledger-tab/insights-ledger-tab.component';
import { InsightsCatalogTabComponent } from './insights-catalog-tab/insights-catalog-tab.component';
import {
  DecadeStat,
  InsightsSubTab,
  PlatformCompletionStat,
  PlatformSortMode,
  SeriesStat,
  buildMerchantQueryParams,
  buildProvenanceCoverageQueryParams,
  formatInsightsCents,
  formatInsightsDollars,
  formatInsightsSignedCents,
  formatInsightsWholeDollars,
} from './insights-formatters';

export type {
  DecadeStat,
  InsightsSubTab,
  PlatformCompletionStat,
  PlatformSortMode,
  SeriesStat,
};

@Component({
  selector: 'app-collection-insights',
  standalone: true,
  imports: [
    IconComponent,
    KitTabsComponent,
    InsightsOverviewTabComponent,
    InsightsLedgerTabComponent,
    InsightsCatalogTabComponent,
  ],
  templateUrl: './collection-insights.component.html',
  styleUrl: './collection-insights.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollectionInsightsComponent implements OnInit {
  public readonly collectionService = inject(CollectionService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  public isRefreshing = signal(false);
  public readonly requestedSubTab = signal<InsightsSubTab>('overview');
  public readonly ledgerScope = signal<string>('all_owned');
  public readonly showAllCatalogPlatforms = signal<boolean>(false);
  public readonly selectedBrand = signal<string>('all');
  public readonly platformSort = signal<PlatformSortMode>('owned');
  public readonly showAllSeries = signal<boolean>(false);
  public readonly showAllMerchants = signal<boolean>(false);
  public readonly expandedToyLines = signal<Set<string>>(new Set());

  public readonly isPublicView = computed<boolean>(
    () => this.collectionService.isPublicView?.() === true,
  );
  public readonly publicDisplayName = computed<string>(
    () =>
      this.collectionService.publicProfile?.()?.displayName ||
      this.collectionService.publicProfile?.()?.username ||
      'Public',
  );
  public readonly gamesTabRoute = computed<string[]>(() => {
    const pub = this.isPublicView();
    const profile = this.collectionService.publicProfile?.();
    if (this.collectionService.getTabRoute) {
      return this.collectionService.getTabRoute('games');
    }
    if (pub && profile?.username) {
      return ['/u', profile.username, 'games'];
    }
    return ['/collection/games'];
  });
  public readonly toysTabRoute = computed<string[]>(() => {
    const pub = this.isPublicView();
    const profile = this.collectionService.publicProfile?.();
    if (this.collectionService.getTabRoute) {
      return this.collectionService.getTabRoute('toys');
    }
    if (pub && profile?.username) {
      return ['/u', profile.username, 'toys'];
    }
    return ['/collection/toys'];
  });

  public readonly canViewMarketPrices = computed<boolean>(
    () =>
      !this.isPublicView() &&
      this.collectionService.canViewMarketPrices?.() === true,
  );
  public readonly isMarketUnconfigured = computed<boolean>(
    () => this.collectionService.marketPricingConfigured?.() === false,
  );
  public readonly canShowProvenance = computed<boolean>(() => {
    if (this.isPublicView()) return false;
    return typeof this.collectionService.canShowPersonalState === 'function'
      ? this.collectionService.canShowPersonalState()
      : this.collectionService.isAuthenticated();
  });

  public readonly insightsTabItems = computed<readonly KitTabItem[]>(() => {
    const tabs: KitTabItem[] = [
      {
        id: 'overview',
        label: 'Overview',
        icon: 'compass',
        testId: 'insights-tab-overview',
      },
    ];
    if (this.canShowProvenance()) {
      tabs.push({
        id: 'value',
        label: 'Value & Ledger',
        icon: 'coins',
        testId: 'insights-tab-value',
      });
    }
    tabs.push({
      id: 'catalog',
      label: 'Catalog & Stats',
      icon: 'chart',
      testId: 'insights-tab-catalog',
    });
    return tabs;
  });

  public readonly activeSubTab = computed<InsightsSubTab>(() => {
    if (this.isPublicView()) {
      return 'catalog';
    }
    const requested = this.requestedSubTab();
    if (requested === 'value' && !this.canShowProvenance()) {
      return 'overview';
    }
    return requested;
  });

  constructor() {
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const tab = params.get('tab');
        if (tab === 'value' || tab === 'catalog' || tab === 'overview') {
          this.requestedSubTab.set(tab);
        } else {
          this.requestedSubTab.set('overview');
        }
      });
  }

  public setActiveSubTab(tab: InsightsSubTab): void {
    if (this.isPublicView()) {
      return;
    }
    const next =
      tab === 'value' && !this.canShowProvenance() ? 'overview' : tab;
    this.requestedSubTab.set(next);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: next === 'overview' ? null : next },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  async ngOnInit(): Promise<void> {
    if (
      this.collectionService.games().length === 0 &&
      this.collectionService.toys().length === 0
    ) {
      await this.refresh();
    }
    if (typeof this.collectionService.ensureFullCatalogLoaded === 'function') {
      void this.collectionService.ensureFullCatalogLoaded();
    }
    if (this.canShowProvenance() && !this.collectionService.journalLoaded()) {
      this.collectionService.loadAllJournalEntries().subscribe();
    }
  }

  async refresh(): Promise<void> {
    this.isRefreshing.set(true);
    try {
      await this.collectionService.refreshAll();
      if (this.canShowProvenance()) {
        this.collectionService.loadAllJournalEntries().subscribe();
      }
    } finally {
      this.isRefreshing.set(false);
    }
  }

  /** --- Owned Datasets --- */
  public readonly ownedReleases = computed<Game[]>(() =>
    this.collectionService.games().filter((g) => g.ownership_status === 1),
  );

  /** Distinct owned games deduplicated across multi-disc releases */
  public readonly ownedGames = computed<Game[]>(() => {
    const releases = this.ownedReleases();
    const seen = new Set<string | number>();
    const distinct: Game[] = [];
    for (const g of releases) {
      const key = g.game_id || g.stable_id || g.id;
      if (!seen.has(key)) {
        seen.add(key);
        distinct.push(g);
      }
    }
    return distinct;
  });

  public readonly ownedToys = computed<Toy[]>(() =>
    this.collectionService.toys().filter((t) => t.ownership_status === 1),
  );

  public readonly totalOwnedCount = computed<number>(
    () => this.ownedGames().length + this.ownedToys().length,
  );

  public readonly catalogToysCount = computed<number>(
    () => this.collectionService.toys().length,
  );

  public readonly toyCompletionPct = computed<number>(() => {
    const total = this.catalogToysCount();
    return total > 0 ? Math.round((this.ownedToys().length / total) * 100) : 0;
  });

  public readonly wishlistToys = computed<Toy[]>(() =>
    this.collectionService
      .toys()
      .filter((t) => t.ownership_status === 2 || t.ownership_status === 4),
  );

  public readonly seekingGamesCount = computed<number>(
    () =>
      this.collectionService
        .games()
        .filter((g) => g.ownership_status === 2 || g.ownership_status === 4)
        .length,
  );

  public readonly seekingToysCount = computed<number>(
    () => this.wishlistToys().length,
  );

  public readonly totalSeekingCount = computed<number>(
    () => this.seekingGamesCount() + this.seekingToysCount(),
  );

  /** --- Physical Media Ownership Health (Single Source of Truth) --- */
  public readonly canTrackIndividualMedia = computed<boolean>(() =>
    Boolean(this.collectionService.canTrackIndividualMedia?.()),
  );

  public readonly isAdmin = computed<boolean>(() =>
    Boolean(this.collectionService.isAdmin?.()),
  );

  public readonly physicalOwnedGames = computed<Game[]>(() =>
    this.ownedReleases().filter((g) => isPhysicalReleaseGame(g)),
  );

  public readonly mediaOwnedGames = computed<Game[]>(() =>
    this.physicalOwnedGames().filter((g) => Boolean(g.has_media)),
  );

  public readonly mediaSummary = computed<PhysicalMediaSummary>(() =>
    computePhysicalMediaStats(
      this.collectionService.games(),
      this.collectionService.platforms(),
    ),
  );

  public readonly mediaOwnedRatePct = computed<number>(
    () => this.mediaSummary().mediaOwnedRatePct,
  );

  public readonly missingMediaCount = computed<number>(
    () => this.mediaSummary().missingCount,
  );

  /** --- Condition Completeness --- */
  public readonly cibCount = computed<number>(
    () =>
      this.ownedGames().filter(
        (g) => Boolean(g.has_case) && Boolean(g.has_manual),
      ).length,
  );

  public readonly boxedOnlyCount = computed<number>(
    () =>
      this.ownedGames().filter((g) => Boolean(g.has_case) && !g.has_manual)
        .length,
  );

  public readonly looseCount = computed<number>(
    () => this.ownedGames().filter((g) => !g.has_case).length,
  );

  public readonly cibPct = computed<number>(() => {
    const total = this.ownedGames().length;
    return total > 0 ? Math.round((this.cibCount() / total) * 100) : 0;
  });

  public readonly boxedPct = computed<number>(() => {
    const total = this.ownedGames().length;
    return total > 0 ? Math.round((this.boxedOnlyCount() / total) * 100) : 0;
  });

  public readonly loosePct = computed<number>(() => {
    const total = this.ownedGames().length;
    return total > 0 ? Math.round((this.looseCount() / total) * 100) : 0;
  });

  /** --- Platform Distribution & Completion --- */
  public readonly platformStats = computed<PlatformCompletionStat[]>(() => {
    const platforms = this.collectionService.platforms();
    const games = this.collectionService.games();
    const owned = this.ownedGames();

    const canPrice = this.canViewMarketPrices();
    const nowMs = canPrice
      ? (this.collectionService.marketPriceNowMs?.() ?? Date.now())
      : 0;
    const pricesMap = canPrice
      ? (this.collectionService.marketPricesMap?.() ?? null)
      : null;

    const stats: PlatformCompletionStat[] = [];

    for (const p of platforms) {
      const catalog = games.filter(
        (g) => g.platform_id === p.id || g.parent_platform_id === p.id,
      );
      if (catalog.length === 0) continue;

      const ownedOnPlatform = owned.filter(
        (g) => g.platform_id === p.id || g.parent_platform_id === p.id,
      );

      const completionPct =
        catalog.length > 0
          ? Math.round((ownedOnPlatform.length / catalog.length) * 100)
          : 0;

      let pricedCount = 0;
      let estimatedCents = 0;
      if (canPrice && pricesMap) {
        for (const g of ownedOnPlatform) {
          const canonical =
            pricesMap.get(getMarketPriceKey('game', g.game_id || g.id)) ||
            pricesMap.get(getMarketPriceKey('game', g.id));
          if (canonical && isMarketPriceFresh(canonical, nowMs)) {
            const est = computeItemEstimatedValueCents(g, canonical);
            if (est.cents !== null) {
              pricedCount++;
              estimatedCents += est.cents;
            }
          }
        }
      }

      stats.push({
        id: p.id,
        name: p.display_name || p.name,
        brand: p.brand || 'Other',
        logo: p.image_url,
        ownedCount: ownedOnPlatform.length,
        catalogCount: catalog.length,
        completionPct,
        ...(pricedCount > 0
          ? {
              pricedCount,
              estimatedValueDollars: Math.round(estimatedCents / 100),
            }
          : {}),
      });
    }

    return stats.sort(
      (a, b) =>
        b.ownedCount - a.ownedCount ||
        b.completionPct - a.completionPct ||
        a.name.localeCompare(b.name),
    );
  });

  public readonly topOwnedPlatformsPreview = computed<PlatformCompletionStat[]>(
    () =>
      this.platformStats()
        .filter((p) => p.ownedCount > 0)
        .slice(0, 5),
  );

  public readonly platformBrands = computed<string[]>(() => {
    const showAll = this.showAllCatalogPlatforms();
    const base = showAll
      ? this.platformStats()
      : this.platformStats().filter((p) => p.ownedCount > 0);
    const brands = new Set<string>();
    for (const p of base) {
      brands.add(p.brand);
    }
    return Array.from(brands).sort((a, b) => {
      if (a === 'Other' && b !== 'Other') return 1;
      if (b === 'Other' && a !== 'Other') return -1;
      return a.localeCompare(b);
    });
  });

  public readonly platformSortOptions = computed<
    KitSelectOption<PlatformSortMode>[]
  >(() => {
    const opts: KitSelectOption<PlatformSortMode>[] = [
      { value: 'owned', label: 'Sort: Most Owned' },
      { value: 'completion', label: 'Sort: Completion %' },
      { value: 'name', label: 'Sort: Name (A–Z)' },
    ];
    if (this.canViewMarketPrices()) {
      opts.splice(2, 0, { value: 'value', label: 'Sort: Est. Value' });
    }
    return opts;
  });

  public readonly effectivePlatformSort = computed<PlatformSortMode>(() => {
    const mode = this.platformSort();
    if (mode === 'value' && !this.canViewMarketPrices()) {
      return 'owned';
    }
    return mode;
  });

  public readonly filteredPlatformStats = computed<PlatformCompletionStat[]>(
    () => {
      const showAll = this.showAllCatalogPlatforms();
      const brand = this.selectedBrand();
      const sortMode = this.effectivePlatformSort();

      let list = this.platformStats().filter((p) =>
        showAll ? true : p.ownedCount > 0,
      );
      if (brand !== 'all') {
        list = list.filter((p) => p.brand === brand);
      }

      return [...list].sort((a, b) => {
        if (sortMode === 'completion') {
          return (
            b.completionPct - a.completionPct ||
            b.ownedCount - a.ownedCount ||
            a.name.localeCompare(b.name)
          );
        }
        if (sortMode === 'value') {
          return (
            (b.estimatedValueDollars ?? 0) - (a.estimatedValueDollars ?? 0) ||
            b.ownedCount - a.ownedCount ||
            a.name.localeCompare(b.name)
          );
        }
        if (sortMode === 'name') {
          return a.name.localeCompare(b.name);
        }
        return (
          b.ownedCount - a.ownedCount ||
          b.completionPct - a.completionPct ||
          a.name.localeCompare(b.name)
        );
      });
    },
  );

  public onPlatformSortChange(mode: PlatformSortMode): void {
    if (mode === 'value' && !this.canViewMarketPrices()) {
      this.platformSort.set('owned');
      return;
    }
    this.platformSort.set(mode || 'owned');
  }

  public onToggleShowAllCatalogPlatforms(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.showAllCatalogPlatforms.set(Boolean(input.checked));
  }

  /** --- Toy Line & Series Completion --- */
  public readonly toyLineStats = computed<ToyLineCompletionStat[]>(() =>
    computeToyLineStats(this.collectionService.toys()),
  );

  public isToyLineExpanded(lineName: string): boolean {
    return this.expandedToyLines().has(lineName);
  }

  public toggleToyLineExpanded(lineName: string): void {
    this.expandedToyLines.update((prev) => {
      const next = new Set(prev);
      if (next.has(lineName)) {
        next.delete(lineName);
      } else {
        next.add(lineName);
      }
      return next;
    });
  }

  /** --- Franchise Representation --- */
  public readonly allSeries = computed<SeriesStat[]>(() => {
    const seriesMap = new Map<string, number>();

    for (const g of this.ownedGames()) {
      const raw = (g.canonical_series || g.series || '').trim();
      if (!raw) continue;
      seriesMap.set(raw, (seriesMap.get(raw) || 0) + 1);
    }

    return Array.from(seriesMap.entries())
      .map(([name, ownedCount]) => ({
        name,
        ownedCount,
      }))
      .sort(
        (a, b) => b.ownedCount - a.ownedCount || a.name.localeCompare(b.name),
      );
  });

  public readonly topSeries = computed<SeriesStat[]>(() =>
    this.showAllSeries() ? this.allSeries() : this.allSeries().slice(0, 8),
  );

  /** --- Play Status / Backlog Breakdown (All 6 Statuses) --- */
  public readonly playStatusStats = computed(() => {
    const owned = this.ownedGames();
    const total = owned.length;

    const played = owned.filter((g) => g.play_status === 1).length;
    const playing = owned.filter((g) => g.play_status === 2).length;
    const queued = owned.filter((g) => g.play_status === 3).length;
    const paused = owned.filter((g) => g.play_status === 4).length;
    const dropped = owned.filter((g) => g.play_status === 5).length;
    const unplayed = owned.filter(
      (g) => g.play_status === 0 || g.play_status === undefined,
    ).length;

    return {
      played,
      playing,
      queued,
      paused,
      dropped,
      unplayed,
      playedPct: total > 0 ? Math.round((played / total) * 100) : 0,
      backlogPct:
        total > 0 ? Math.round(((unplayed + queued) / total) * 100) : 0,
    };
  });

  /** --- Release Era / Decade Distribution --- */
  public readonly decadeDistribution = computed<DecadeStat[]>(() => {
    const games = this.ownedGames();
    const eras: Record<
      Exclude<ReleaseDecadeFilter, 'all'>,
      { eraName: string; count: number }
    > = {
      '70s_80s': {
        eraName: '1970s & 1980s (Early Era)',
        count: 0,
      },
      '90s': {
        eraName: '1990s (16 & 32-Bit Era)',
        count: 0,
      },
      '00s': {
        eraName: '2000s (Sixth & Seventh Gen)',
        count: 0,
      },
      '10s': {
        eraName: '2010s (HD Generation)',
        count: 0,
      },
      '20s': {
        eraName: '2020s (Modern Generation)',
        count: 0,
      },
    };

    let datedCount = 0;
    for (const g of games) {
      const dateStr = g.release_date;
      if (!dateStr) continue;
      const match = dateStr.match(/\b(19\d\d|20\d\d)\b/);
      if (!match) continue;
      const year = parseInt(match[1], 10);
      datedCount++;

      if (year < 1990) {
        eras['70s_80s'].count++;
      } else if (year < 2000) {
        eras['90s'].count++;
      } else if (year < 2010) {
        eras['00s'].count++;
      } else if (year < 2020) {
        eras['10s'].count++;
      } else {
        eras['20s'].count++;
      }
    }

    const order: Array<Exclude<ReleaseDecadeFilter, 'all'>> = [
      '70s_80s',
      '90s',
      '00s',
      '10s',
      '20s',
    ];
    return order.map((key) => {
      const item = eras[key];
      const pct =
        datedCount > 0 ? Math.round((item.count / datedCount) * 100) : 0;
      return {
        decade: key,
        eraName: item.eraName,
        count: item.count,
        pct,
      };
    });
  });

  /** --- Unified Scope & Financial Analytics (Value & Ledger Tab) --- */
  public readonly ledgerPlatformOptions = computed<
    Array<{ id: number; name: string; count: number }>
  >(() => {
    const owned = this.ownedGames();
    const counts = new Map<number, number>();
    for (const g of owned) {
      counts.set(g.platform_id, (counts.get(g.platform_id) || 0) + 1);
    }
    return this.collectionService
      .platforms()
      .filter((p) => (counts.get(p.id) || 0) > 0)
      .map((p) => ({
        id: p.id,
        name: p.display_name || p.name,
        count: counts.get(p.id) || 0,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  });

  public readonly ledgerScopeOptions = computed<KitSelectOption<string>[]>(
    () => [
      {
        value: 'all_owned',
        label: `All Owned (${this.ownedGames().length + this.ownedToys().length})`,
      },
      {
        value: 'with_cost_basis',
        label: 'Owned With Purchase Price',
      },
      {
        value: 'games_only',
        label: `Owned Games Only (${this.ownedGames().length})`,
      },
      {
        value: 'toys_only',
        label: `Owned Toys Only (${this.ownedToys().length})`,
      },
    ],
  );

  public readonly ledgerScopeGroups = computed<KitSelectGroup<string>[]>(() => {
    const opts = this.ledgerPlatformOptions();
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

  public readonly selectedLedgerPlatformId = computed<number | null>(() => {
    const scope = this.ledgerScope();
    if (!scope.startsWith('platform:')) return null;
    const id = Number(scope.slice('platform:'.length));
    return Number.isFinite(id) ? id : null;
  });

  public onLedgerScopeChange(scope: string): void {
    this.ledgerScope.set(scope || 'all_owned');
  }

  public readonly ledgerDrillRoute = computed<string[]>(() =>
    this.ledgerScope() === 'toys_only'
      ? ['/collection/toys']
      : ['/collection/games'],
  );

  public readonly allOwnedJournalSummary = computed<ScopedJournalSummary>(() =>
    computeScopedJournalSummary({
      ownedGames: this.ownedGames(),
      ownedToys: this.ownedToys(),
      journalMap: this.collectionService.journalEntriesMap?.() ?? new Map(),
      scope: 'all_owned',
    }),
  );

  public readonly scopedJournalSummary = computed<ScopedJournalSummary>(() =>
    computeScopedJournalSummary({
      ownedGames: this.ownedGames(),
      ownedToys: this.ownedToys(),
      journalMap: this.collectionService.journalEntriesMap?.() ?? new Map(),
      scope: this.ledgerScope(),
    }),
  );

  /** Backward-compatible alias used across tests/templates */
  public readonly journalSummary = this.scopedJournalSummary;

  public readonly allOwnedValuationSummary = computed<ScopedValuationSummary>(
    () =>
      computeScopedValuation({
        ownedGames: this.ownedGames(),
        ownedToys: this.ownedToys(),
        platforms: this.collectionService.platforms(),
        journalMap: this.collectionService.journalEntriesMap?.() ?? new Map(),
        marketPricesMap:
          this.collectionService.marketPricesMap?.() ?? new Map(),
        nowMs: this.collectionService.marketPriceNowMs?.() ?? Date.now(),
        scope: 'all_owned',
        canViewMarketPrices: this.canViewMarketPrices(),
      }),
  );

  public readonly scopedValuationSummary = computed<ScopedValuationSummary>(
    () =>
      computeScopedValuation({
        ownedGames: this.ownedGames(),
        ownedToys: this.ownedToys(),
        platforms: this.collectionService.platforms(),
        journalMap: this.collectionService.journalEntriesMap?.() ?? new Map(),
        marketPricesMap:
          this.collectionService.marketPricesMap?.() ?? new Map(),
        nowMs: this.collectionService.marketPriceNowMs?.() ?? Date.now(),
        scope: this.ledgerScope(),
        canViewMarketPrices: this.canViewMarketPrices(),
      }),
  );

  public readonly displayedMerchants = computed(() => {
    const all = this.scopedJournalSummary().allMerchants;
    return this.showAllMerchants() ? all : all.slice(0, 6);
  });

  public readonly unpricedOwnedCount = computed<number>(() => {
    if (!this.canViewMarketPrices() || this.isMarketUnconfigured()) return 0;
    const summary = this.allOwnedValuationSummary();
    return Math.max(0, summary.totalOwnedCount - summary.pricedCount);
  });

  public readonly hasAuditActions = computed<boolean>(
    () =>
      (this.canTrackIndividualMedia() && this.missingMediaCount() > 0) ||
      (this.canShowProvenance() &&
        this.allOwnedJournalSummary().missingCount > 0) ||
      this.looseCount() > 0 ||
      this.unpricedOwnedCount() > 0,
  );

  public getProvenanceCoverageQueryParams(
    js: ScopedJournalSummary,
  ): Record<string, string | number> {
    return buildProvenanceCoverageQueryParams(
      js,
      this.selectedLedgerPlatformId(),
    );
  }

  public getMerchantQueryParams(
    merchantName: string,
  ): Record<string, string | number> {
    return buildMerchantQueryParams(
      merchantName,
      this.selectedLedgerPlatformId(),
    );
  }

  public formatDollars(dollars: number | null | undefined): string {
    return formatInsightsDollars(dollars);
  }

  public formatWholeDollars(dollars: number | null | undefined): string {
    return formatInsightsWholeDollars(dollars);
  }

  public formatCents(cents: number | null | undefined): string {
    return formatInsightsCents(cents);
  }

  public formatSignedCents(cents: number | null | undefined): string {
    return formatInsightsSignedCents(cents);
  }

  /** --- Animated KPI Display Signals & Segmented Meter Models --- */
  public readonly animatedPlayedPct = createAnimatedNumber(
    computed(() => this.playStatusStats().playedPct),
  );
  public readonly animatedTotalOwnedCount = createAnimatedNumber(
    this.totalOwnedCount,
  );
  public readonly animatedMediaOwnedRatePct = createAnimatedNumber(
    this.mediaOwnedRatePct,
  );
  public readonly animatedCibPct = createAnimatedNumber(this.cibPct);

  public readonly conditionMeterSegments = computed<KitMeterSegment[]>(() => {
    const segs: KitMeterSegment[] = [];
    if (this.cibPct() > 0) {
      segs.push({
        id: 'cib',
        label: 'Complete in Box (CIB)',
        pct: this.cibPct(),
        color: 'var(--m3-primary)',
        title: `Complete in Box: ${this.cibCount()} (${this.cibPct()}%)`,
      });
    }
    if (this.boxedPct() > 0) {
      segs.push({
        id: 'boxed',
        label: 'Game + Box / Case (No Manual)',
        pct: this.boxedPct(),
        color: 'var(--m3-tertiary)',
        title: `Game + Box / Case (No Manual): ${this.boxedOnlyCount()} (${this.boxedPct()}%)`,
      });
    }
    if (this.loosePct() > 0) {
      segs.push({
        id: 'loose',
        label: 'Loose Disc/Cart',
        pct: this.loosePct(),
        color: 'var(--m3-outline)',
        title: `Loose Disc/Cart: ${this.looseCount()} (${this.loosePct()}%)`,
      });
    }
    return segs;
  });
}
