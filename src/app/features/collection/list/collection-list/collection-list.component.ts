/**
 * COLLECTION LIST COMPONENT
 *
 * The primary view for browsing the user's game and toy collection.
 * It provides a high-performance, infinite-scrolling grid with sophisticated
 * grouping and filtering capabilities.
 *
 * DESIGN RATIONALE:
 * - **State Persistence**: Uses an effect and HostListener to synchronize the UI
 *   state (filters, scroll position) with the CollectionService. This enables a
 *   "browser-like" navigation experience where the user never loses their place.
 * - **Infinite Scrolling**: Implements an IntersectionObserver pattern to lazily
 *   increase the 'displayLimit' signal, ensuring the DOM remains lean and the
 *   initial paint is fast even for thousands of items.
 * - **Normalization**: Series filtering uses a diacritic-insensitive normalization
 *   heuristic to handle international titles and variations (e.g. Pokémon vs Pokemon).
 * - **Retry-based Scroll Restoration**: Accounts for the asynchronous nature of
 *   Angular rendering by attempting to restore scroll position over several frames.
 */

import {
  Component,
  ChangeDetectionStrategy,
  inject,
  OnInit,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  signal,
  computed,
  effect,
  untracked,
  NgZone,
} from '@angular/core';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { ViewportScroller, DecimalPipe } from '@angular/common';
import { Subscription, forkJoin } from 'rxjs';
import { KitLoadingBannerComponent } from '@wesdizzle/app-kit/angular';
import { CollectionService } from '../../../../core/services/collection.service';

import { BrandingService } from '../../../../core/services/branding.service';
import {
  Game,
  Toy,
  Platform,
  FilterState,
  PlatformGroup,
  ProvenanceStatusFilter,
  ConditionFilter,
  ReleaseDecadeFilter,
  ToyGroup,
  ListState,
  ViewMode,
  OwnershipStatus,
  PlayStatus,
  RetailReleaseView,
  getOwnedMediaCount,
  getReleaseMediaItems,
  getSeriesCrossLanguageAliases,
  isItemAvailableAtRetail,
  normalizeBudgetToken,
} from '../../../../core/models/collection.models';
import { groupCatalogMediaIntoReleases } from '../../../../core/models/release-grouping';
import {
  findGameJournalEntry,
  findToyJournalEntry,
  getJournalPricePaidNumber,
  getProvenanceSourceLabel,
  hasActiveProvenanceFilter,
  isProvenanceSort,
  matchesProvenanceFilters,
  parseJournalDate,
} from '../../../../core/models/provenance-analytics';
import { CollectionFiltersComponent } from '../../filters/collection-filters/collection-filters.component';
import { ActivePlayShelfComponent } from '../active-play-shelf/active-play-shelf.component';
import { GameCardComponent } from '../game-card/game-card.component';
import { ToyCardComponent } from '../toy-card/toy-card.component';
import { CompactTableComponent } from '../compact-table/compact-table.component';
import { DiscOwnershipModalComponent } from '../disc-ownership-modal/disc-ownership-modal.component';

interface GameGroup {
  platformName: string;
  platformLogo?: string | null;
  launchYear?: string;
  games: Game[];
  totalCount: number;
  isFlatSort?: boolean;
  catalogCount?: number;
  completionPct?: number;
  cibCount?: number;
  physicalCount?: number;
  ownedMediaCount?: number;
}

@Component({
  selector: 'app-collection-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterModule,
    DecimalPipe,
    KitLoadingBannerComponent,
    CollectionFiltersComponent,
    ActivePlayShelfComponent,
    GameCardComponent,
    ToyCardComponent,
    CompactTableComponent,
    DiscOwnershipModalComponent,
  ],
  templateUrl: './collection-list.component.html',
  styleUrls: ['./collection-list.component.css'],
})
export class CollectionListComponent
  implements OnInit, AfterViewInit, OnDestroy
{
  public readonly collectionService = inject(CollectionService);
  private branding = inject(BrandingService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private viewportScroller = inject(ViewportScroller);
  private observer?: IntersectionObserver;
  @ViewChild('scrollTrigger') scrollTrigger?: ElementRef;
  private ngZone = inject(NgZone);
  private elementRef = inject(ElementRef);

  private restorationPending = true;
  private stateInitialized = signal(false);
  private queryParamsSub?: Subscription;
  private statePersistTimer: ReturnType<typeof setTimeout> | null = null;

  public readonly discModalGameId = signal<string | null>(null);
  public readonly discModalSaving = signal<boolean>(false);
  public readonly activeDiscModalGame = computed<Game | null>(() => {
    const id = this.discModalGameId();
    if (!id) return null;
    return this.discMergedGames().find((g) => g.id === id) ?? null;
  });

  private createDefaultFilters(): FilterState {
    return {
      ownership: 1,
      play_status: 'all',
      has_media: 'all',
      platform_id: undefined,
      regions: [],
      line: '',
      type: '',
      name: '',
      nameExact: false,
      series: '',
      seriesExact: false,
      tag: '',
      tagExact: false,
      sortBy: 'default',
      deals_only: false,
      retail_available: false,
      budget_label: 'all',
      condition: 'all',
      release_decade: 'all',
      provenance_status: 'all',
      provenance_source: '',
      provenanceSourceExact: false,
      acquired_year: 'all',
      acquired_from: '',
      acquired_to: '',
      price_paid_min: null,
      price_paid_max: null,
    };
  }

  private applyQueryParams(qp: Record<string, unknown>) {
    if (!qp || Object.keys(qp).length === 0) return;

    const shouldReset = qp['reset'] === '1' || qp['reset'] === 'true';
    const qpFilters: Partial<FilterState> = {};
    if (qp['platform_id'] !== undefined) {
      const pid = parseInt(String(qp['platform_id']), 10);
      if (!isNaN(pid)) qpFilters.platform_id = pid;
    }
    if (
      qp['has_media'] !== undefined &&
      !this.collectionService.isPublicView()
    ) {
      const val = String(qp['has_media']);
      if (val === '0' || val === 'missing') {
        qpFilters.has_media = 0;
      } else if (val === '1' || val === 'owned') {
        qpFilters.has_media = 1;
      } else if (val === 'all') {
        qpFilters.has_media = 'all';
      }
    }
    if (qp['play_status'] !== undefined) {
      const psVal = String(qp['play_status']);
      if (psVal === 'backlog' || psVal === 'queued') {
        qpFilters.play_status = 3;
      } else if (psVal === 'playing') {
        qpFilters.play_status = 2;
      } else if (psVal === 'played') {
        qpFilters.play_status = 1;
      } else if (psVal === 'all') {
        qpFilters.play_status = 'all';
      } else {
        const ps = parseInt(psVal, 10);
        if (!isNaN(ps)) qpFilters.play_status = ps as PlayStatus;
      }
    }
    if (qp['quick_status'] !== undefined) {
      const qs = String(qp['quick_status']);
      if (qs === 'deals') {
        qpFilters.deals_only = true;
        qpFilters.ownership = 0;
      } else if (qs === 'priority_seeking') {
        qpFilters.ownership = 4;
      } else if (qs === 'seeking') {
        qpFilters.ownership = 2;
      } else if (qs === 'home_region_and_owned') {
        qpFilters.ownership = 'all';
      }
    }
    if (qp['ownership'] !== undefined) {
      const ownStr = String(qp['ownership']);
      if (ownStr === 'all' || ownStr === 'seeking_or_unowned') {
        qpFilters.ownership = ownStr;
      } else if (ownStr === 'home_region_and_owned') {
        qpFilters.ownership = 'all';
      } else {
        const own = parseInt(ownStr, 10);
        if (!isNaN(own)) qpFilters.ownership = own as OwnershipStatus;
      }
    }
    if (qp['deals_only'] !== undefined) {
      qpFilters.deals_only =
        String(qp['deals_only']) === 'true' || String(qp['deals_only']) === '1';
    }
    if (qp['retail_available'] !== undefined) {
      qpFilters.retail_available =
        String(qp['retail_available']) === 'true' ||
        String(qp['retail_available']) === '1';
    }
    if (qp['condition'] !== undefined) {
      const cond = String(qp['condition']) as ConditionFilter;
      if (
        cond === 'all' ||
        cond === 'cib' ||
        cond === 'boxed_only' ||
        cond === 'loose' ||
        cond === 'manual_only'
      ) {
        qpFilters.condition = cond;
      }
    }
    if (qp['release_decade'] !== undefined) {
      const dec = String(qp['release_decade']) as ReleaseDecadeFilter;
      if (
        dec === 'all' ||
        dec === '70s_80s' ||
        dec === '90s' ||
        dec === '00s' ||
        dec === '10s' ||
        dec === '20s'
      ) {
        qpFilters.release_decade = dec;
      }
    }
    if (qp['series'] !== undefined) {
      qpFilters.series = String(qp['series']);
    }
    if (qp['series_exact'] !== undefined) {
      qpFilters.seriesExact =
        String(qp['series_exact']) === 'true' ||
        String(qp['series_exact']) === '1';
    }
    if (qp['line'] !== undefined) {
      qpFilters.line = String(qp['line']);
    }
    if (qp['search'] || qp['name'] || qp['q']) {
      qpFilters.name = String(qp['search'] || qp['name'] || qp['q']);
      if (qpFilters.ownership === undefined && qp['ownership'] === undefined) {
        qpFilters.ownership = 'all';
      }
    }
    if (qp['sort_by'] !== undefined) {
      const sb = String(qp['sort_by']);
      const publicSorts = new Set([
        'default',
        'retail_asc',
        'discount_desc',
        'market_value_desc',
        'market_value_asc',
        'release_desc',
        'release_asc',
      ]);
      const provSorts = new Set([
        'acquired_desc',
        'acquired_asc',
        'price_paid_desc',
        'price_paid_asc',
      ]);
      if (publicSorts.has(sb)) {
        qpFilters.sortBy = sb as FilterState['sortBy'];
      } else if (
        this.collectionService.canShowPersonalState?.() &&
        provSorts.has(sb)
      ) {
        qpFilters.sortBy = sb as FilterState['sortBy'];
      }
    }
    if (this.collectionService.canShowPersonalState?.()) {
      const validProvStatuses = new Set<ProvenanceStatusFilter>([
        'all',
        'recorded',
        'missing',
        'missing_date',
        'missing_price',
        'exact_date',
        'approximate_date',
        'gifted',
        'free',
        'has_receipt',
        'has_notes',
      ]);
      if (qp['provenance_status'] !== undefined) {
        const ps = String(qp['provenance_status']) as ProvenanceStatusFilter;
        if (validProvStatuses.has(ps)) {
          qpFilters.provenance_status = ps;
        }
      }
      if (qp['provenance_source'] !== undefined) {
        qpFilters.provenance_source = String(qp['provenance_source']);
      }
      if (qp['provenance_exact'] !== undefined) {
        qpFilters.provenanceSourceExact =
          String(qp['provenance_exact']) === 'true' ||
          String(qp['provenance_exact']) === '1';
      }
      if (qp['acquired_year'] !== undefined) {
        const ay = String(qp['acquired_year']);
        if (ay === 'all' || ay === 'undated') {
          qpFilters.acquired_year = ay;
        } else {
          const parsedYear = parseInt(ay, 10);
          if (!isNaN(parsedYear)) {
            qpFilters.acquired_year = parsedYear;
          }
        }
        qpFilters.acquired_from = '';
        qpFilters.acquired_to = '';
      }
      if (
        qp['acquired_from'] !== undefined ||
        qp['acquired_to'] !== undefined
      ) {
        qpFilters.acquired_from =
          qp['acquired_from'] !== undefined ? String(qp['acquired_from']) : '';
        qpFilters.acquired_to =
          qp['acquired_to'] !== undefined ? String(qp['acquired_to']) : '';
        qpFilters.acquired_year = 'all';
      }
      if (qp['price_paid_min'] !== undefined) {
        const minVal = Number(qp['price_paid_min']);
        if (Number.isFinite(minVal) && minVal >= 0) {
          qpFilters.price_paid_min = minVal;
        }
      }
      if (qp['price_paid_max'] !== undefined) {
        const maxVal = Number(qp['price_paid_max']);
        if (Number.isFinite(maxVal) && maxVal >= 0) {
          qpFilters.price_paid_max = maxVal;
        }
      }
    }
    if (shouldReset) {
      const nextFilters: FilterState = {
        ...this.createDefaultFilters(),
        ...qpFilters,
      };
      this.filters.set(nextFilters);
      this.displayLimit.set(100);
      this.maybeEnsureFullCatalogForFilters(nextFilters);
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true,
      });
    } else if (Object.keys(qpFilters).length > 0) {
      this.filters.update((f) => ({ ...f, ...qpFilters }));
      this.displayLimit.set(100);
      this.maybeEnsureFullCatalogForFilters(this.filters());
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true,
      });
    }
  }

  /** --- Reactive Application State --- */
  public currentTab = signal<'games' | 'toys'>('games');
  public filters = signal<FilterState>(this.createDefaultFilters());
  public displayLimit = signal<number>(100);
  public viewMode = signal<ViewMode>('grid');
  public lastUpdated = this.collectionService.lastUpdated;

  public readonly showProvenanceFilters = computed<boolean>(() =>
    Boolean(this.collectionService.canShowPersonalState?.()),
  );

  public readonly playShelfBusyIds = signal<Set<string>>(new Set());

  private getDeduplicatedOwnedGamesByPlayStatus(
    targetStatus: PlayStatus,
  ): Game[] {
    const seen = new Set<string | number>();
    const result: Game[] = [];
    for (const g of this.discMergedGames()) {
      if (g.bundle_parent_id) continue;
      if (g.ownership_status !== OwnershipStatus.Owned) continue;
      if (g.play_status !== targetStatus) continue;
      const key = g.game_id || g.stable_id || g.id;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(g);
    }
    return result;
  }

  public readonly activePlayingGames = computed<Game[]>(() =>
    this.getDeduplicatedOwnedGamesByPlayStatus(PlayStatus.Playing),
  );

  public readonly activeQueuedGames = computed<Game[]>(() =>
    this.getDeduplicatedOwnedGamesByPlayStatus(PlayStatus.Queued),
  );

  public readonly showActivePlayShelf = computed<boolean>(() => {
    const f = this.filters();
    return (
      this.currentTab() === 'games' &&
      this.collectionService.canShowPersonalState?.() === true &&
      f.ownership === OwnershipStatus.Owned &&
      !f.deals_only &&
      (!f.play_status || f.play_status === 'all') &&
      (this.activePlayingGames().length > 0 ||
        this.activeQueuedGames().length > 0)
    );
  });

  private readonly usdFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });

  public readonly filteredFinancialSummary = computed<{
    itemCount: number;
    paidCount: number;
    totalSpendDollars: number;
    pricedCount: number;
    totalEstimatedCents: number;
    matchedCount: number;
    matchedDeltaCents: number;
  } | null>(() => {
    if (this.collectionService.canShowPersonalState?.() !== true) {
      return null;
    }

    const tab = this.currentTab();
    const journalMap =
      this.collectionService.journalEntriesMap?.() ?? new Map();
    const canPrice = this.collectionService.canViewMarketPrices?.() === true;
    const rawItems =
      tab === 'games' ? this.filteredGames() : this.filteredToys();
    const itemCount = rawItems.length;
    if (itemCount === 0) {
      return null;
    }

    let paidCount = 0;
    let totalSpendDollars = 0;
    let pricedCount = 0;
    let totalEstimatedCents = 0;
    let matchedCount = 0;
    let matchedDeltaCents = 0;

    for (const item of rawItems) {
      const jEntry =
        tab === 'games'
          ? findGameJournalEntry(item as Game, journalMap)
          : findToyJournalEntry(item as Toy, journalMap);
      const paidDollars = getJournalPricePaidNumber(jEntry);
      if (paidDollars !== null) {
        paidCount++;
        totalSpendDollars += paidDollars;
      }
      const estCents = canPrice
        ? (this.collectionService.getEstimatedValue?.(
            item,
            tab === 'games' ? 'game' : 'toy',
          )?.cents ?? null)
        : null;
      if (estCents !== null) {
        pricedCount++;
        totalEstimatedCents += estCents;
      }
      if (paidDollars !== null && estCents !== null) {
        matchedCount++;
        matchedDeltaCents += estCents - Math.round(paidDollars * 100);
      }
    }

    if (paidCount === 0 && pricedCount === 0) {
      return null;
    }

    return {
      itemCount,
      paidCount,
      totalSpendDollars,
      pricedCount,
      totalEstimatedCents,
      matchedCount,
      matchedDeltaCents,
    };
  });

  public formatCurrencyDollars(dollars: number): string {
    return this.usdFormatter.format(dollars);
  }

  public formatCurrencyCents(cents: number): string {
    return this.usdFormatter.format(cents / 100);
  }

  public formatSignedCurrencyCents(cents: number): string {
    if (cents > 0) {
      return `+${this.usdFormatter.format(cents / 100)}`;
    }
    if (cents < 0) {
      return `−${this.usdFormatter.format(Math.abs(cents) / 100)}`;
    }
    return this.usdFormatter.format(0);
  }

  public readonly effectiveSortBy = computed<
    NonNullable<FilterState['sortBy']>
  >(() => {
    const sort = this.filters().sortBy || 'default';
    if (!this.showProvenanceFilters() && isProvenanceSort(sort)) {
      return 'default';
    }
    return sort;
  });

  public readonly compactTableFilters = computed<FilterState>(() => {
    const f = this.filters();
    const safeSort = this.effectiveSortBy();
    if (f.sortBy === safeSort) return f;
    return { ...f, sortBy: safeSort };
  });

  /**
   * Computes a grouped list of platforms for use in the filter dropdown.
   * Groups by 'brand' (e.g. Nintendo, Sony) to improve selection ergonomics.
   */
  public platformGroups = computed<PlatformGroup[]>(() => {
    const data = this.collectionService.platforms();
    const grouped = new Map<string, Platform[]>();

    [...data].forEach((p) => {
      const b = p.brand || 'Other';
      if (!grouped.has(b)) grouped.set(b, []);
      grouped.get(b)!.push(p);
    });

    return Array.from(grouped.entries())
      .map(([brand, platforms]) => ({ brand, platforms }))
      .sort((a, b) => {
        if (a.brand === 'Other' && b.brand !== 'Other') return 1;
        if (b.brand === 'Other' && a.brand !== 'Other') return -1;
        return a.brand.localeCompare(b.brand);
      });
  });

  private static readonly NON_ASCII_RE = /[\u0080-\uffff]/;
  private readonly searchFieldsCache = new WeakMap<
    Game,
    { names?: string[]; series?: string[] }
  >();

  private normalizeBudgetToken(token: string): string | null {
    return normalizeBudgetToken(token);
  }

  public isBudgetLabel(label: string): boolean {
    return this.normalizeBudgetToken(label) !== null;
  }

  public getOptionalBudgetLabels(game: Game): string[] {
    if (!game.also_released_as) return [];
    const existingVariants = new Set(
      (game.variants || '')
        .split(',')
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean),
    );
    const result: string[] = [];
    for (const rawToken of game.also_released_as.split(',')) {
      const canonical = this.normalizeBudgetToken(rawToken);
      if (!canonical) continue;
      const lower = canonical.toLowerCase();
      if (existingVariants.has(lower)) continue;
      if (!result.some((r) => r.toLowerCase() === lower)) {
        result.push(canonical);
      }
    }
    return result;
  }

  /**
   * Pre-computed grouped retail releases (multi-disc grouping and companion GOTY matching).
   * Depends strictly on collectionService.games(), decoupling expensive grouping
   * and candidate scans from active filter and search keystrokes.
   */
  public discMergedGames = computed<RetailReleaseView[]>(() =>
    groupCatalogMediaIntoReleases(this.collectionService.games()),
  );

  private getOrBuildSearchableNames(g: Game): string[] {
    let cached = this.searchFieldsCache.get(g);
    if (cached?.names) {
      return cached.names;
    }
    const names = new Set<string>();
    if (g.title) names.add(this.normalizeString(g.title));
    if (g.base_title && g.base_title !== g.title) {
      names.add(this.normalizeString(g.base_title));
    }
    if (g.rom_name) names.add(this.normalizeString(g.rom_name));
    if (g.mediaItems) {
      for (const item of g.mediaItems) {
        if (item.romName) names.add(this.normalizeString(item.romName));
      }
    }
    if (g.also_released_as) {
      for (const alias of g.also_released_as.split(',')) {
        const trimmed = alias.trim();
        if (trimmed) names.add(this.normalizeString(trimmed));
      }
    }
    if (Array.isArray(g.searchableNames)) {
      for (const n of g.searchableNames) {
        if (n) names.add(this.normalizeString(n));
      }
    }
    if (g.metadata_json) {
      try {
        const parsed = JSON.parse(g.metadata_json);
        if (Array.isArray(parsed.alternative_names)) {
          for (const alt of parsed.alternative_names) {
            if (alt?.name) names.add(this.normalizeString(alt.name));
          }
        }
        if (Array.isArray(parsed.game_localizations)) {
          for (const loc of parsed.game_localizations) {
            if (loc?.name) names.add(this.normalizeString(loc.name));
          }
        }
      } catch {
        // Ignore unparseable metadata JSON
      }
    }
    const result = Array.from(names);
    if (!cached) {
      cached = {};
      this.searchFieldsCache.set(g, cached);
    }
    cached.names = result;
    return result;
  }

  private getOrBuildSearchableSeries(g: Game): string[] {
    let cached = this.searchFieldsCache.get(g);
    if (cached?.series) {
      return cached.series;
    }
    const seriesSet = new Set<string>();
    const addSeriesAndAliases = (s: string | null | undefined) => {
      if (!s) return;
      const norm = this.normalizeString(s);
      if (norm) {
        seriesSet.add(norm);
        const aliases = getSeriesCrossLanguageAliases(norm);
        if (aliases) {
          for (const a of aliases) seriesSet.add(this.normalizeString(a));
        }
      }
    };

    addSeriesAndAliases(g.canonical_series);
    addSeriesAndAliases(g.series);
    if (g.franchises) {
      for (const f of g.franchises.split(',')) {
        addSeriesAndAliases(f.trim());
      }
    }
    if (g.collections) {
      for (const c of g.collections.split(',')) {
        addSeriesAndAliases(c.trim());
      }
    }
    const result = Array.from(seriesSet);
    if (!cached) {
      cached = {};
      this.searchFieldsCache.set(g, cached);
    }
    cached.series = result;
    return result;
  }

  /**
   * Reactive pipeline that applies active filters to the full games collection.
   * Handles ownership, platform, region, name, series, and tag matching.
   */
  public filteredGames = computed(() => {
    const groupedGames = this.discMergedGames();
    const f = this.filters();
    const canProvenance = this.showProvenanceFilters();
    const journalMap = canProvenance
      ? (this.collectionService.journalEntriesMap?.() ?? new Map())
      : null;
    const applyProvFilter = Boolean(
      canProvenance && journalMap && hasActiveProvenanceFilter(f),
    );
    const activeSortBy = this.effectiveSortBy();

    // Hoist filter string normalizations outside the iteration loop for optimal O(N) performance
    const activeNameFilter = f.name || f.seriesOrName;
    const normalizedNameFilter = activeNameFilter
      ? this.normalizeString(activeNameFilter)
      : '';
    const normalizedSeriesFilter = f.series
      ? this.normalizeString(f.series)
      : '';
    const normalizedTagFilter = f.tag ? this.normalizeString(f.tag) : '';
    const normalizeFn = (s: string) => this.normalizeString(s);

    const filteredGamesList = groupedGames.filter((g) => {
      // Option A: Hide bundled child discs/games from top-level collection list
      if (g.bundle_parent_id) {
        return false;
      }

      // Basic Ownership Filter
      const status = g.ownership_status ?? 0;
      if (f.ownership === 'seeking_or_unowned') {
        const isSeekingOrUnowned =
          status === OwnershipStatus.PrioritySeeking ||
          status === OwnershipStatus.Seeking ||
          status === OwnershipStatus.Unowned;
        if (!isSeekingOrUnowned) return false;
      } else if (f.ownership !== 'all' && f.ownership !== status) {
        return false;
      }

      // Deals Only & Available at Retail Filters
      if (f.deals_only) {
        const isOnSale = Boolean(g.retail_on_sale);
        if (!isOnSale) return false;
      }
      if (f.retail_available) {
        if (!isItemAvailableAtRetail(g)) return false;
      }

      // Play Status Filter
      if (f.play_status !== undefined && f.play_status !== 'all') {
        const pStatus = g.play_status ?? 0;
        if (f.play_status !== pStatus) return false;
      }

      // Media Ownership Filter
      if (
        this.collectionService.canTrackIndividualMedia() &&
        f.has_media !== undefined &&
        f.has_media !== 'all'
      ) {
        const mStatus = g.has_media ? 1 : 0;
        if (f.has_media !== mStatus) return false;
      }

      // Pre-release Guard: hide betas, protos, demos, and kiosk samplers unless it is an owned pack-in companion bonus disc
      const isPreRelease =
        (/\b(beta|proto|taikenban|trial version|promo)\b/i.test(
          g.rom_name || '',
        ) ||
          /\b(beta|proto|taikenban|trial version|promo)\b/i.test(
            g.variants || '',
          ) ||
          (/\bdemo\b/i.test(g.rom_name || '') &&
            !/demo disc/i.test(g.title || '')) ||
          (/\bdemo\b/i.test(g.variants || '') &&
            !/demo disc/i.test(g.title || ''))) &&
        !/^prototype/i.test(g.title || '');
      if (
        isPreRelease &&
        !g.companion_game_id &&
        !g.is_companion_base_disc &&
        !g.ownership_status
      ) {
        return false;
      }

      // Budget Label Status Filter (Strict Release-Level Semantics)
      if (f.budget_label && f.budget_label !== 'all') {
        const hasOptionalBudget = this.getOptionalBudgetLabels(g).length > 0;
        const hasExclusiveBudget = (g.variants || '')
          .split(',')
          .some((v) => this.isBudgetLabel(v.trim()));

        if (f.budget_label === 'standard_and_budget') {
          if (!hasOptionalBudget) return false;
        } else if (f.budget_label === 'budget_only') {
          if (!hasExclusiveBudget || hasOptionalBudget) return false;
        } else if (f.budget_label === 'standard_only') {
          if (hasExclusiveBudget || hasOptionalBudget) return false;
        }
      }

      // Packaging Condition Filter
      if (f.condition && f.condition !== 'all') {
        const hasCase = Boolean(g.has_case);
        const hasManual = Boolean(g.has_manual);
        if (f.condition === 'cib') {
          if (!hasCase || !hasManual) return false;
        } else if (f.condition === 'boxed_only') {
          if (!hasCase || hasManual) return false;
        } else if (f.condition === 'loose') {
          if (hasCase) return false;
        } else if (f.condition === 'manual_only') {
          if (hasCase || !hasManual) return false;
        }
      }

      // Release Era / Decade Filter
      if (f.release_decade && f.release_decade !== 'all') {
        const dateStr = g.release_date;
        const match = dateStr ? dateStr.match(/\b(19\d\d|20\d\d)\b/) : null;
        if (!match) return false;
        const year = parseInt(match[1], 10);
        if (f.release_decade === '70s_80s' && year >= 1990) return false;
        if (f.release_decade === '90s' && (year < 1990 || year >= 2000))
          return false;
        if (f.release_decade === '00s' && (year < 2000 || year >= 2010))
          return false;
        if (f.release_decade === '10s' && (year < 2010 || year >= 2020))
          return false;
        if (f.release_decade === '20s' && year < 2020) return false;
      }

      // Platform Filter (Checks both direct platform and parent platform for cross-compatible hardware)
      if (f.platform_id) {
        if (
          g.platform_id !== f.platform_id &&
          g.parent_platform_id !== f.platform_id
        )
          return false;
      }

      // Region Filter
      if (f.regions && f.regions.length > 0) {
        const itemRegions = (g.region || '')
          .split(',')
          .map((r) => r.trim())
          .filter(Boolean);
        const match = itemRegions.some(
          (r) => r === 'World' || f.regions!.includes(r),
        );
        if (!match) return false;
      }

      // Linked Status Filter (IGDB connectivity)
      if (f.is_linked !== undefined) {
        const hasIgdb = !!g.igdb_id;
        if (f.is_linked !== hasIgdb) return false;
      }

      // Name Filter (Case, Accent, Ampersand, and Cross-Language Insensitive)
      if (normalizedNameFilter) {
        const query = normalizedNameFilter;
        const queryWithAnd = query.replace(/\s*&\s*/g, ' and ');
        const queryWithAmp = query.replace(/\band\b/g, '&');

        const matchesTerm = (term: string) => {
          if (f.nameExact) {
            return (
              term === query || term === queryWithAnd || term === queryWithAmp
            );
          }
          return (
            term.includes(query) ||
            (queryWithAnd !== query && term.includes(queryWithAnd)) ||
            (queryWithAmp !== query && term.includes(queryWithAmp))
          );
        };

        const namesList = this.getOrBuildSearchableNames(g);
        const seriesList = this.getOrBuildSearchableSeries(g);

        const hasNameMatch = namesList.some(matchesTerm);
        const hasSeriesMatch = seriesList.some(matchesTerm);

        if (!hasNameMatch && !hasSeriesMatch) {
          return false;
        }
      }

      // Series Filter (Case, Accent, and Cross-Language Insensitive)
      if (normalizedSeriesFilter) {
        const query = normalizedSeriesFilter;
        const queryAliases = getSeriesCrossLanguageAliases(query) || [];
        const allQueries = [
          query,
          ...queryAliases.map((a) => this.normalizeString(a)),
        ];

        const seriesList = this.getOrBuildSearchableSeries(g);

        const matchesSeries = (term: string) => {
          if (f.seriesExact) {
            return allQueries.some((q) => term === q);
          }
          return allQueries.some((q) => term.includes(q));
        };

        const hasSeriesMatch = seriesList.some(matchesSeries);
        if (!hasSeriesMatch) return false;
      }

      // Tag / Variant Filter (Case & Accent Insensitive)
      if (normalizedTagFilter) {
        const itemTags = (g.variants || '')
          .split(',')
          .map((v) => this.normalizeString(v.trim()))
          .filter(Boolean);
        if (g.also_released_as) {
          for (const raw of g.also_released_as.split(',')) {
            const normRaw = this.normalizeString(raw.trim());
            if (normRaw) {
              itemTags.push(normRaw);
              itemTags.push(`± ${normRaw}`);
            }
          }
          for (const optLbl of this.getOptionalBudgetLabels(g)) {
            const normOpt = this.normalizeString(optLbl);
            if (normOpt) {
              itemTags.push(normOpt);
              itemTags.push(`± ${normOpt}`);
            }
          }
        }
        if (itemTags.length === 0) return false;
        if (f.tagExact) {
          if (!itemTags.some((t) => t === normalizedTagFilter)) return false;
        } else {
          if (!itemTags.some((t) => t.includes(normalizedTagFilter)))
            return false;
        }
      }

      if (applyProvFilter && journalMap) {
        const jEntry = findGameJournalEntry(g, journalMap);
        if (!matchesProvenanceFilters(jEntry, f, normalizeFn)) {
          return false;
        }
      }

      return true;
    });

    /**
     * DESIGN RATIONALE: Schwartzian Transform (Decorate-Sort-Undecorate)
     * Sorting 2,000+ games previously invoked normalizeForSort() (NFD diacritics stripping,
     * regex, and lowercase) over 35,000 times per sort trigger.
     * Precomputing sort keys once per filtered item reduces normalizations and price calculations
     * from O(N log N) to O(N).
     */
    const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    const isMarketValueSort =
      activeSortBy === 'market_value_desc' ||
      activeSortBy === 'market_value_asc';
    const isAcquiredSort =
      activeSortBy === 'acquired_desc' || activeSortBy === 'acquired_asc';
    const isPricePaidSort =
      activeSortBy === 'price_paid_desc' || activeSortBy === 'price_paid_asc';
    const needJournalForSort =
      Boolean(canProvenance && journalMap) &&
      (isAcquiredSort || isPricePaidSort);

    const decoratedGames = filteredGamesList.map((g) => {
      const jEntry = needJournalForSort
        ? findGameJournalEntry(g, journalMap!)
        : null;
      return {
        item: g,
        retailPrice: g.retail_price ?? null,
        discountPct: g.retail_discount_pct ?? 0,
        marketValue: isMarketValueSort
          ? (this.collectionService.getEstimatedValue?.(g, 'game').cents ??
            null)
          : null,
        acquiredSortKey: isAcquiredSort
          ? (parseJournalDate(
              jEntry?.purchase_date,
              jEntry?.is_approximate_date,
            )?.sortKey ?? null)
          : null,
        pricePaid: isPricePaidSort ? getJournalPricePaidNumber(jEntry) : null,
        platformLaunchDate: g.platform_launch_date || '9999-99-99',
        normBrand: this.normalizeForSort(g.brand || ''),
        normSeries: this.normalizeForSort(g.canonical_series || g.title),
        releaseDate: g.release_date || '9999-99-99',
        sortIndex: g.sort_index ?? 9999,
        variantPriority: this.getVariantPriority(g.variants),
        region: g.region || '',
        id: g.id || '',
      };
    });

    decoratedGames.sort((a, b) => {
      // Acquisition Date Sorting (unrecorded always last)
      if (isAcquiredSort) {
        if (a.acquiredSortKey !== null && b.acquiredSortKey !== null) {
          if (a.acquiredSortKey !== b.acquiredSortKey) {
            return activeSortBy === 'acquired_desc'
              ? cmpStr(b.acquiredSortKey, a.acquiredSortKey)
              : cmpStr(a.acquiredSortKey, b.acquiredSortKey);
          }
        } else if (a.acquiredSortKey !== b.acquiredSortKey) {
          return a.acquiredSortKey !== null ? -1 : 1;
        }
      }

      // Price Paid Sorting (unrecorded always last)
      if (isPricePaidSort) {
        if (a.pricePaid !== null && b.pricePaid !== null) {
          if (a.pricePaid !== b.pricePaid) {
            return activeSortBy === 'price_paid_desc'
              ? b.pricePaid - a.pricePaid
              : a.pricePaid - b.pricePaid;
          }
        } else if (a.pricePaid !== b.pricePaid) {
          return a.pricePaid !== null ? -1 : 1;
        }
      }

      // Market Value Sorting (High to Low / Low to High, unpriced always last)
      if (isMarketValueSort) {
        if (a.marketValue !== null && b.marketValue !== null) {
          if (a.marketValue !== b.marketValue) {
            return activeSortBy === 'market_value_desc'
              ? b.marketValue - a.marketValue
              : a.marketValue - b.marketValue;
          }
        } else if (a.marketValue !== b.marketValue) {
          return a.marketValue !== null ? -1 : 1;
        }
      }

      // Retail Price Sorting (Low to High)
      if (activeSortBy === 'retail_asc') {
        if (a.retailPrice !== null || b.retailPrice !== null) {
          if (a.retailPrice === null) return 1;
          if (b.retailPrice === null) return -1;
          if (a.retailPrice !== b.retailPrice)
            return a.retailPrice - b.retailPrice;
        }
      }

      // Deepest Sale Discount Sorting (High to Low)
      if (activeSortBy === 'discount_desc') {
        if (a.discountPct !== b.discountPct)
          return b.discountPct - a.discountPct;
        const priceA = a.retailPrice ?? 999999;
        const priceB = b.retailPrice ?? 999999;
        if (priceA !== priceB) return priceA - priceB;
      }

      // Release Date Sorting
      if (activeSortBy === 'release_desc' || activeSortBy === 'release_asc') {
        const isDesc = activeSortBy === 'release_desc';
        // Treat placeholder/null '9999-99-99' as unknown and sort them to the end in both directions
        const aKnown = a.releaseDate !== '9999-99-99';
        const bKnown = b.releaseDate !== '9999-99-99';
        if (aKnown && bKnown) {
          if (a.releaseDate !== b.releaseDate) {
            return isDesc
              ? cmpStr(b.releaseDate, a.releaseDate)
              : cmpStr(a.releaseDate, b.releaseDate);
          }
        } else if (aKnown !== bKnown) {
          return aKnown ? -1 : 1;
        }
      }

      const isBypassPlatformGroupSort =
        activeSortBy === 'retail_asc' ||
        activeSortBy === 'discount_desc' ||
        activeSortBy === 'market_value_desc' ||
        activeSortBy === 'market_value_asc' ||
        activeSortBy === 'release_desc' ||
        activeSortBy === 'release_asc' ||
        isAcquiredSort ||
        isPricePaidSort;

      if (!isBypassPlatformGroupSort) {
        // 1. Platform Launch Date (ASC)
        if (a.platformLaunchDate !== b.platformLaunchDate) {
          return cmpStr(a.platformLaunchDate, b.platformLaunchDate);
        }

        // 2. Platform Brand (ASC)
        if (a.normBrand !== b.normBrand) {
          return cmpStr(a.normBrand, b.normBrand);
        }
      }

      // 3. Game Canonical Series (ASC, fallback to title)
      if (a.normSeries !== b.normSeries) {
        return cmpStr(a.normSeries, b.normSeries);
      }

      // 4. Game Release Date (ASC, nulls last)
      if (a.releaseDate !== b.releaseDate) {
        return cmpStr(a.releaseDate, b.releaseDate);
      }

      // 5. Sort Index (ASC, nulls last)
      if (a.sortIndex !== b.sortIndex) {
        return a.sortIndex - b.sortIndex;
      }

      // 5.5. Variant Priority (ASC)
      if (a.variantPriority !== b.variantPriority) {
        return a.variantPriority - b.variantPriority;
      }

      // 6. Region (ASC)
      if (a.region !== b.region) {
        return cmpStr(a.region, b.region);
      }

      // 7. Release ID (ASC)
      return cmpStr(a.id, b.id);
    });

    return decoratedGames.map((entry) => entry.item);
  });

  /**
   * Normalizes a string by removing diacritics and converting to lowercase.
   * Crucial for supporting international titles (e.g. Pokémon) in search.
   *
   * @param str The string to normalize.
   * @returns The normalized string.
   */
  private normalizeString(str: string): string {
    if (!CollectionListComponent.NON_ASCII_RE.test(str)) {
      return str.toLowerCase();
    }
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  /**
   * Normalizes a string for strict alphabetical sorting.
   * In addition to diacritic removal and lowercasing, it strips leading
   * articles (a, an, the) to ensure more natural "book-style" sorting.
   *
   * @param str The string to normalize.
   * @returns The normalized string for sorting.
   */
  private normalizeForSort(str: string): string {
    let s = this.normalizeString(str).trim();

    if (s.startsWith('the ')) s = s.substring(4);
    else if (s.startsWith('a ')) s = s.substring(2);
    else if (s.startsWith('an ')) s = s.substring(3);

    return s.trim();
  }

  private getVariantPriority(variants: string | null | undefined): number {
    if (!variants) return 0;
    const lower = variants.toLowerCase();
    if (/\b(beta|proto|prototype|demo|kiosk|sample|promo)\b/i.test(lower)) {
      return 2;
    }
    return 1;
  }

  private getToyTypeOrder(type: string | null | undefined): number {
    switch (type) {
      case 'Figure':
        return 1;
      case 'Yarn':
        return 2;
      case 'Block':
        return 3;
      case 'Band':
        return 4;
      case 'Card':
        return 5;
      default:
        return 99;
    }
  }

  /** Virtual list window based on displayLimit for infinite scroll performance */
  public displayGames = computed(() =>
    this.filteredGames().slice(0, this.displayLimit()),
  );

  /**
   * Computes the final UI grouping for games, organized by Platform.
   * When any retail/release sort mode is active, bypasses platform grouping and presents
   * a single unified list ranked across platforms.
   */
  public groupedGames = computed(() => {
    const allFiltered = this.filteredGames();
    const displayed = this.displayGames();
    const f = this.filters();
    const sortBy = this.effectiveSortBy();

    const isPriceSort =
      sortBy === 'retail_asc' ||
      sortBy === 'discount_desc' ||
      sortBy === 'market_value_desc' ||
      sortBy === 'market_value_asc' ||
      sortBy === 'price_paid_desc' ||
      sortBy === 'price_paid_asc';

    const isDateSort =
      sortBy === 'release_desc' ||
      sortBy === 'release_asc' ||
      sortBy === 'acquired_desc' ||
      sortBy === 'acquired_asc';
    const isFlatSort = isPriceSort || isDateSort;

    if (isFlatSort) {
      const sortLabel =
        sortBy === 'retail_asc'
          ? 'Ranked by Lowest Retail Price'
          : sortBy === 'discount_desc'
            ? 'Ranked by Biggest Sale %'
            : sortBy === 'market_value_desc'
              ? 'Sorted by Market Value (High to Low)'
              : sortBy === 'market_value_asc'
                ? 'Sorted by Market Value (Low to High)'
                : sortBy === 'acquired_desc'
                  ? 'Sorted by Acquisition Date (Newest First)'
                  : sortBy === 'acquired_asc'
                    ? 'Sorted by Acquisition Date (Oldest First)'
                    : sortBy === 'price_paid_desc'
                      ? 'Sorted by Price Paid (High to Low)'
                      : sortBy === 'price_paid_asc'
                        ? 'Sorted by Price Paid (Low to High)'
                        : sortBy === 'release_desc'
                          ? 'Ranked by Release Date (Newest First)'
                          : 'Ranked by Release Date (Oldest First)';
      const headerTitle = f.platform_id
        ? `${displayed[0]?.display_name || displayed[0]?.platform || 'Platform'} (${sortLabel})`
        : `All Platforms (${sortLabel})`;
      return [
        {
          platformName: headerTitle,
          platformLogo: f.platform_id ? displayed[0]?.platform_logo : null,
          games: displayed,
          totalCount: allFiltered.length,
          isFlatSort: true,
        },
      ];
    }

    // 1. Calculate total counts and owned completion stats per platform from ALL filtered games
    const counts = new Map<string, number>();
    const showOwnedStats = f.ownership === OwnershipStatus.Owned;
    const cibCounts = new Map<string, number>();
    const physicalCounts = new Map<string, number>();
    const ownedMediaCounts = new Map<string, number>();

    for (const g of allFiltered) {
      const p = g.display_name || g.platform;
      counts.set(p, (counts.get(p) || 0) + 1);
      if (showOwnedStats) {
        if (g.has_case && g.has_manual) {
          cibCounts.set(p, (cibCounts.get(p) || 0) + 1);
        }
        physicalCounts.set(p, (physicalCounts.get(p) || 0) + 1);
        if (g.has_media) {
          ownedMediaCounts.set(p, (ownedMediaCounts.get(p) || 0) + 1);
        }
      }
    }

    let catalogCounts: Map<string, number> | null = null;
    if (showOwnedStats && !this.collectionService.catalogIsPartial?.()) {
      catalogCounts = new Map<string, number>();
      for (const cg of this.discMergedGames()) {
        if (cg.bundle_parent_id) continue;
        const cp = cg.display_name || cg.platform;
        catalogCounts.set(cp, (catalogCounts.get(cp) || 0) + 1);
      }
    }

    // 2. Build groups from DISPLAYED games
    const groups: GameGroup[] = [];
    const groupMap = new Map<string, GameGroup>();

    for (const game of displayed) {
      const p = game.display_name || game.platform;
      let group = groupMap.get(p);
      if (!group) {
        const totalCount = counts.get(p) || 0;
        const catalogCount = catalogCounts?.get(p);
        const completionPct =
          catalogCount && catalogCount > 0
            ? Math.round((totalCount / catalogCount) * 100)
            : undefined;
        group = {
          platformName: p,
          platformLogo: game.platform_logo,
          launchYear: game.platform_launch_date
            ? (() => {
                const parts = game.platform_launch_date.split('-');
                if (parts.length === 3) {
                  const y = parseInt(parts[0], 10);
                  const m = parseInt(parts[1], 10) - 1;
                  const d = parseInt(parts[2], 10);
                  const dt = new Date(y, m, d);
                  return new Intl.DateTimeFormat('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  }).format(dt);
                }
                return game.platform_launch_date;
              })()
            : undefined,
          games: [],
          totalCount,
          ...(showOwnedStats
            ? {
                catalogCount:
                  catalogCount && catalogCount > 0 ? catalogCount : undefined,
                completionPct,
                cibCount: cibCounts.get(p) || 0,
                physicalCount: physicalCounts.get(p) || 0,
                ownedMediaCount: ownedMediaCounts.get(p) || 0,
              }
            : {}),
        };
        groups.push(group);
        groupMap.set(p, group);
      }
      group.games.push(game);
    }
    return groups;
  });

  /**
   * Reactive pipeline for filtering the toy collection.
   */
  public filteredToys = computed(() => {
    const allToys = this.collectionService.toys();
    const f = this.filters();
    const canProvenance = this.showProvenanceFilters();
    const journalMap = canProvenance
      ? (this.collectionService.journalEntriesMap?.() ?? new Map())
      : null;
    const applyProvFilter = Boolean(
      canProvenance && journalMap && hasActiveProvenanceFilter(f),
    );
    const activeSortBy = this.effectiveSortBy();

    const activeNameFilter = f.name || f.seriesOrName;
    const normalizedNameFilter = activeNameFilter
      ? this.normalizeString(activeNameFilter)
      : '';
    const normalizedSeriesFilter = f.series
      ? this.normalizeString(f.series)
      : '';
    const normalizeFn = (s: string) => this.normalizeString(s);

    const filteredToysList = allToys.filter((toy) => {
      // Ownership Filter
      const status = toy.ownership_status ?? 0;
      if (f.ownership === 'seeking_or_unowned') {
        const isSeekingOrUnowned =
          status === OwnershipStatus.PrioritySeeking ||
          status === OwnershipStatus.Seeking ||
          status === OwnershipStatus.Unowned;
        if (!isSeekingOrUnowned) return false;
      } else if (f.ownership !== 'all' && f.ownership !== status) {
        return false;
      }

      // Deals Only & Available at Retail Filters
      if (f.deals_only) {
        if (!toy.retail_on_sale) return false;
      }
      if (f.retail_available) {
        if (!isItemAvailableAtRetail(toy)) return false;
      }

      // Line Filter (e.g. Amiibo, Skylanders)
      if (f.line && toy.line !== f.line) return false;

      // Type Filter (e.g. Figure, Card)
      if (f.type && toy.type !== f.type) return false;

      // Region Filter
      if (f.regions && f.regions.length > 0) {
        const itemRegions = (toy.region || '')
          .split(',')
          .map((r) => r.trim())
          .filter(Boolean);
        const match = itemRegions.some(
          (r) => r === 'World' || f.regions!.includes(r),
        );
        if (!match) return false;
      }

      // Name Filter (Case, Accent, and Ampersand Insensitive)
      if (normalizedNameFilter) {
        const query = normalizedNameFilter;
        const queryWithAnd = query.replace(/\s*&\s*/g, ' and ');
        const queryWithAmp = query.replace(/\band\b/g, '&');
        const normalizedName = this.normalizeString(toy.name || '');
        const normalizedSeries = this.normalizeString(toy.series_name || '');

        const matchesToyTerm = (term: string) => {
          if (f.nameExact) {
            return (
              term === query || term === queryWithAnd || term === queryWithAmp
            );
          }
          return (
            term.includes(query) ||
            (queryWithAnd !== query && term.includes(queryWithAnd)) ||
            (queryWithAmp !== query && term.includes(queryWithAmp))
          );
        };

        if (
          !matchesToyTerm(normalizedName) &&
          !matchesToyTerm(normalizedSeries)
        ) {
          return false;
        }
      }

      // Series Filter (Case & Accent Insensitive)
      if (normalizedSeriesFilter) {
        const normalizedSeries = this.normalizeString(toy.series_name || '');
        if (f.seriesExact) {
          if (normalizedSeries !== normalizedSeriesFilter) return false;
        } else {
          if (!normalizedSeries.includes(normalizedSeriesFilter)) return false;
        }
      }

      if (applyProvFilter && journalMap) {
        const jEntry = findToyJournalEntry(toy, journalMap);
        if (!matchesProvenanceFilters(jEntry, f, normalizeFn)) {
          return false;
        }
      }

      return true;
    });

    /**
     * DESIGN RATIONALE: Schwartzian Transform for Toys
     * Precomputing line, series name, toy name, and type orders reduces string normalization
     * overhead during sorting across hundreds of toys.
     */
    const isMarketValueSort =
      activeSortBy === 'market_value_desc' ||
      activeSortBy === 'market_value_asc';
    const isAcquiredSort =
      activeSortBy === 'acquired_desc' || activeSortBy === 'acquired_asc';
    const isPricePaidSort =
      activeSortBy === 'price_paid_desc' || activeSortBy === 'price_paid_asc';
    const needJournalForSort =
      Boolean(canProvenance && journalMap) &&
      (isAcquiredSort || isPricePaidSort);

    const decoratedToys = filteredToysList.map((toy) => {
      const jEntry = needJournalForSort
        ? findToyJournalEntry(toy, journalMap!)
        : null;
      return {
        item: toy,
        retailPrice: toy.retail_price ?? null,
        discountPct: toy.retail_discount_pct ?? 0,
        marketValue: isMarketValueSort
          ? (this.collectionService.getEstimatedValue?.(toy, 'toy').cents ??
            null)
          : null,
        acquiredSortKey: isAcquiredSort
          ? (parseJournalDate(
              jEntry?.purchase_date,
              jEntry?.is_approximate_date,
            )?.sortKey ?? null)
          : null,
        pricePaid: isPricePaidSort ? getJournalPricePaidNumber(jEntry) : null,
        normLine: this.normalizeForSort(toy.line),
        seriesIndex: toy.series_index ?? 9999,
        normSeries: this.normalizeForSort(toy.series_name || ''),
        isAmiibo: toy.line === 'amiibo',
        toyTypeOrder: this.getToyTypeOrder(toy.type),
        releaseDate: toy.release_date || '9999-99-99',
        sortIndex: toy.sort_index ?? 9999,
        normName: this.normalizeForSort(toy.name || ''),
      };
    });

    decoratedToys.sort((a, b) => {
      // Acquisition Date Sorting (unrecorded always last)
      if (isAcquiredSort) {
        if (a.acquiredSortKey !== null && b.acquiredSortKey !== null) {
          if (a.acquiredSortKey !== b.acquiredSortKey) {
            return activeSortBy === 'acquired_desc'
              ? b.acquiredSortKey.localeCompare(a.acquiredSortKey)
              : a.acquiredSortKey.localeCompare(b.acquiredSortKey);
          }
        } else if (a.acquiredSortKey !== b.acquiredSortKey) {
          return a.acquiredSortKey !== null ? -1 : 1;
        }
      }

      // Price Paid Sorting (unrecorded always last)
      if (isPricePaidSort) {
        if (a.pricePaid !== null && b.pricePaid !== null) {
          if (a.pricePaid !== b.pricePaid) {
            return activeSortBy === 'price_paid_desc'
              ? b.pricePaid - a.pricePaid
              : a.pricePaid - b.pricePaid;
          }
        } else if (a.pricePaid !== b.pricePaid) {
          return a.pricePaid !== null ? -1 : 1;
        }
      }

      // Market Value Sorting (High to Low / Low to High, unpriced always last)
      if (isMarketValueSort) {
        if (a.marketValue !== null && b.marketValue !== null) {
          if (a.marketValue !== b.marketValue) {
            return activeSortBy === 'market_value_desc'
              ? b.marketValue - a.marketValue
              : a.marketValue - b.marketValue;
          }
        } else if (a.marketValue !== b.marketValue) {
          return a.marketValue !== null ? -1 : 1;
        }
      }

      // Retail Price Sorting (Low to High)
      if (activeSortBy === 'retail_asc') {
        if (a.retailPrice !== null || b.retailPrice !== null) {
          if (a.retailPrice === null) return 1;
          if (b.retailPrice === null) return -1;
          if (a.retailPrice !== b.retailPrice)
            return a.retailPrice - b.retailPrice;
        }
      }

      // Deepest Sale Discount Sorting (High to Low)
      if (activeSortBy === 'discount_desc') {
        if (a.discountPct !== b.discountPct)
          return b.discountPct - a.discountPct;
        const priceA = a.retailPrice ?? 999999;
        const priceB = b.retailPrice ?? 999999;
        if (priceA !== priceB) return priceA - priceB;
      }

      // Release Date Sorting
      if (activeSortBy === 'release_desc' || activeSortBy === 'release_asc') {
        const isDesc = activeSortBy === 'release_desc';
        const aKnown = a.releaseDate !== '9999-99-99';
        const bKnown = b.releaseDate !== '9999-99-99';
        if (aKnown && bKnown) {
          if (a.releaseDate !== b.releaseDate) {
            return isDesc
              ? b.releaseDate.localeCompare(a.releaseDate)
              : a.releaseDate.localeCompare(b.releaseDate);
          }
        } else if (aKnown !== bKnown) {
          return aKnown ? -1 : 1;
        }
      }

      const isBypassLineGroupSort =
        activeSortBy === 'retail_asc' ||
        activeSortBy === 'discount_desc' ||
        activeSortBy === 'market_value_desc' ||
        activeSortBy === 'market_value_asc' ||
        activeSortBy === 'release_desc' ||
        activeSortBy === 'release_asc' ||
        isAcquiredSort ||
        isPricePaidSort;

      if (!isBypassLineGroupSort) {
        // 1. Line (ASC)
        if (a.normLine !== b.normLine) {
          return a.normLine.localeCompare(b.normLine);
        }

        // 2. Series Sort Index or Name (ASC)
        if (a.seriesIndex !== b.seriesIndex) {
          return a.seriesIndex - b.seriesIndex;
        }
        if (a.normSeries !== b.normSeries) {
          return a.normSeries.localeCompare(b.normSeries);
        }
      }

      // 3. Toy-level sorting
      if (a.isAmiibo) {
        // Priority 1: Type (Figure -> Yarn -> Block -> Band -> Card)
        if (a.toyTypeOrder !== b.toyTypeOrder) {
          return a.toyTypeOrder - b.toyTypeOrder;
        }

        // Priority 2: Release Date (ASC, nulls last)
        if (a.releaseDate !== b.releaseDate) {
          return a.releaseDate.localeCompare(b.releaseDate);
        }

        // Priority 3: Sort Index (ASC, nulls last)
        if (a.sortIndex !== b.sortIndex) {
          return a.sortIndex - b.sortIndex;
        }
      } else {
        // Non-amiibo Priority 1: Sort Index (ASC, nulls last)
        if (a.sortIndex !== b.sortIndex) {
          return a.sortIndex - b.sortIndex;
        }

        // Non-amiibo Priority 2: Release Date (ASC, nulls last)
        if (a.releaseDate !== b.releaseDate) {
          return a.releaseDate.localeCompare(b.releaseDate);
        }
      }

      // 4. Name (ASC) fallback
      return a.normName.localeCompare(b.normName);
    });

    return decoratedToys.map((entry) => entry.item);
  });

  /** Virtual list window for toys */
  public displayToys = computed(() =>
    this.filteredToys().slice(0, this.displayLimit()),
  );

  /**
   * Computes the UI grouping for toys, organized by 'Line'.
   */
  public groupedToys = computed(() => {
    const displayed = this.displayToys();
    const allFiltered = this.filteredToys();
    const f = this.filters();
    const sortBy = this.effectiveSortBy();

    const isFlatSort =
      sortBy === 'retail_asc' ||
      sortBy === 'discount_desc' ||
      sortBy === 'market_value_desc' ||
      sortBy === 'market_value_asc' ||
      sortBy === 'release_desc' ||
      sortBy === 'release_asc' ||
      sortBy === 'acquired_desc' ||
      sortBy === 'acquired_asc' ||
      sortBy === 'price_paid_desc' ||
      sortBy === 'price_paid_asc';

    if (isFlatSort) {
      const sortLabel =
        sortBy === 'retail_asc'
          ? 'Ranked by Lowest Retail Price'
          : sortBy === 'discount_desc'
            ? 'Ranked by Biggest Sale %'
            : sortBy === 'market_value_desc'
              ? 'Sorted by Market Value (High to Low)'
              : sortBy === 'market_value_asc'
                ? 'Sorted by Market Value (Low to High)'
                : sortBy === 'acquired_desc'
                  ? 'Sorted by Acquisition Date (Newest First)'
                  : sortBy === 'acquired_asc'
                    ? 'Sorted by Acquisition Date (Oldest First)'
                    : sortBy === 'price_paid_desc'
                      ? 'Sorted by Price Paid (High to Low)'
                      : sortBy === 'price_paid_asc'
                        ? 'Sorted by Price Paid (Low to High)'
                        : sortBy === 'release_desc'
                          ? 'Ranked by Release Date (Newest First)'
                          : 'Ranked by Release Date (Oldest First)';
      const lineTitle = f.line
        ? `${f.line} (${sortLabel})`
        : `All Lines (${sortLabel})`;
      return [
        {
          lineName: lineTitle,
          seriesGroups: [
            {
              seriesName: sortLabel,
              toys: displayed,
              totalCount: allFiltered.length,
            },
          ],
          totalCount: allFiltered.length,
        },
      ];
    }

    // 1. Get total counts per line and per series from ALL filtered toys
    const lineCounts = new Map<string, number>();
    const seriesCounts = new Map<string, Map<string, number>>();
    const showOwnedStats = f.ownership === OwnershipStatus.Owned;

    for (const toy of allFiltered) {
      const line = toy.line || 'Unknown';
      const series = toy.series_name || 'No Series';

      lineCounts.set(line, (lineCounts.get(line) || 0) + 1);

      if (!seriesCounts.has(line)) seriesCounts.set(line, new Map());
      const sMap = seriesCounts.get(line)!;
      sMap.set(series, (sMap.get(series) || 0) + 1);
    }

    let lineCatalogCounts: Map<string, number> | null = null;
    let seriesCatalogCounts: Map<string, Map<string, number>> | null = null;
    if (showOwnedStats) {
      lineCatalogCounts = new Map<string, number>();
      seriesCatalogCounts = new Map<string, Map<string, number>>();
      for (const toy of this.collectionService.toys()) {
        const line = toy.line || 'Unknown';
        const series = toy.series_name || 'No Series';
        lineCatalogCounts.set(line, (lineCatalogCounts.get(line) || 0) + 1);
        if (!seriesCatalogCounts.has(line)) {
          seriesCatalogCounts.set(line, new Map());
        }
        const sMap = seriesCatalogCounts.get(line)!;
        sMap.set(series, (sMap.get(series) || 0) + 1);
      }
    }

    // 2. Build nested groups from DISPLAYED toys
    const groups: ToyGroup[] = [];
    const lineMap = new Map<string, ToyGroup>();

    for (const toy of displayed) {
      const lineName = toy.line || 'Unknown';
      const seriesName = toy.series_name || 'No Series';

      let lineGroup = lineMap.get(lineName);
      if (!lineGroup) {
        const totalCount = lineCounts.get(lineName) || 0;
        const catalogCount = lineCatalogCounts?.get(lineName);
        lineGroup = {
          lineName,
          seriesGroups: [],
          totalCount,
          ...(catalogCount && catalogCount > 0
            ? {
                catalogCount,
                completionPct: Math.round((totalCount / catalogCount) * 100),
              }
            : {}),
        };
        groups.push(lineGroup);
        lineMap.set(lineName, lineGroup);
      }

      let seriesGroup = lineGroup.seriesGroups.find(
        (sg) => sg.seriesName === seriesName,
      );
      if (!seriesGroup) {
        const totalCount = seriesCounts.get(lineName)?.get(seriesName) || 0;
        const catalogCount = seriesCatalogCounts
          ?.get(lineName)
          ?.get(seriesName);
        seriesGroup = {
          seriesName,
          toys: [],
          totalCount,
          ...(catalogCount && catalogCount > 0
            ? {
                catalogCount,
                completionPct: Math.round((totalCount / catalogCount) * 100),
              }
            : {}),
        };
        lineGroup.seriesGroups.push(seriesGroup);
      }
      seriesGroup.toys.push(toy);
    }
    return groups;
  });

  /** --- Utility Selectors for Filter Dropdowns --- */
  public uniqueLines = computed(() =>
    Array.from(new Set(this.collectionService.toys().map((f) => f.line)))
      .filter(Boolean)
      .sort((a, b) =>
        this.normalizeForSort(a).localeCompare(this.normalizeForSort(b)),
      ),
  );

  public uniqueTypes = computed(() =>
    Array.from(new Set(this.collectionService.toys().map((f) => f.type)))
      .filter(Boolean)
      .sort((a, b) =>
        this.normalizeForSort(a).localeCompare(this.normalizeForSort(b)),
      ),
  );

  private sortUniqueStrings(
    values: Iterable<string | null | undefined>,
  ): string[] {
    const unique = new Set<string>();
    for (const v of values) {
      if (v) unique.add(v);
    }
    const keyed = Array.from(unique, (val) => ({
      val,
      key: this.normalizeForSort(val),
    }));
    keyed.sort((a, b) =>
      a.key < b.key
        ? -1
        : a.key > b.key
          ? 1
          : a.val < b.val
            ? -1
            : a.val > b.val
              ? 1
              : 0,
    );
    return keyed.map((entry) => entry.val);
  }

  public uniqueNames = computed<string[]>(() => {
    if (this.currentTab() === 'games') {
      return this.sortUniqueStrings(
        this.collectionService.games().map((g) => g.title),
      );
    } else {
      return this.sortUniqueStrings(
        this.collectionService.toys().map((t) => t.name),
      );
    }
  });

  public uniqueSeries = computed(() => {
    if (this.currentTab() === 'games') {
      return this.sortUniqueStrings(
        this.collectionService.games().map((g) => g.canonical_series),
      );
    } else {
      const seriesMap = new Map<string, number | undefined>();
      for (const toy of this.collectionService.toys()) {
        if (toy.series_name) {
          if (
            !seriesMap.has(toy.series_name) ||
            (seriesMap.get(toy.series_name) === undefined &&
              toy.series_index !== undefined)
          ) {
            seriesMap.set(toy.series_name, toy.series_index);
          }
        }
      }
      const keyed = Array.from(seriesMap.entries(), ([val, idx]) => ({
        val,
        idx: idx ?? 9999,
        key: this.normalizeForSort(val),
      }));
      keyed.sort((a, b) => {
        if (a.idx !== b.idx) {
          return a.idx - b.idx;
        }
        return a.key < b.key
          ? -1
          : a.key > b.key
            ? 1
            : a.val < b.val
              ? -1
              : a.val > b.val
                ? 1
                : 0;
      });
      return keyed.map((entry) => entry.val);
    }
  });

  public uniqueTags = computed<string[]>(() => {
    const tagsSet = new Set<string>();
    for (const g of this.collectionService.games()) {
      if (g.variants) {
        g.variants.split(',').forEach((v) => {
          const trimmed = v.trim();
          if (trimmed) tagsSet.add(trimmed);
        });
      }
    }
    return this.sortUniqueStrings(tagsSet);
  });

  public uniqueRegions = computed<string[]>(() => {
    const regionsSet = new Set<string>();

    for (const g of this.collectionService.games()) {
      if (g.region) {
        g.region.split(',').forEach((r) => {
          const trimmed = r.trim();
          if (trimmed) regionsSet.add(trimmed);
        });
      }
    }

    for (const t of this.collectionService.toys()) {
      if (t.region) {
        t.region.split(',').forEach((r) => {
          const trimmed = r.trim();
          if (trimmed) regionsSet.add(trimmed);
        });
      }
    }

    return Array.from(regionsSet).sort();
  });

  public uniqueProvenanceSources = computed<string[]>(() => {
    if (!this.showProvenanceFilters()) return [];
    const targetType = this.currentTab() === 'games' ? 'game' : 'toy';
    const map = this.collectionService.journalEntriesMap?.();
    if (!map || map.size === 0) return [];
    const sources = new Set<string>();
    for (const entry of map.values()) {
      if (entry.item_type !== targetType) continue;
      const lbl = getProvenanceSourceLabel(entry);
      if (lbl) sources.add(lbl);
    }
    return this.sortUniqueStrings(sources);
  });

  public uniqueAcquiredYears = computed<number[]>(() => {
    if (!this.showProvenanceFilters()) return [];
    const targetType = this.currentTab() === 'games' ? 'game' : 'toy';
    const map = this.collectionService.journalEntriesMap?.();
    if (!map || map.size === 0) return [];
    const years = new Set<number>();
    for (const entry of map.values()) {
      if (entry.item_type !== targetType) continue;
      const parsed = parseJournalDate(
        entry.purchase_date,
        entry.is_approximate_date,
      );
      if (parsed) years.add(parsed.year);
    }
    return Array.from(years).sort((a, b) => b - a);
  });

  /**
   * Initializes the component and sets up the state persistence effect.
   * This effect ensures that any change to filters or display limits is
   * automatically mirrored in the CollectionService and sessionStorage.
   */
  constructor() {
    effect(() => {
      const tab = this.currentTab();
      const filters = this.filters();
      const displayLimit = this.displayLimit();
      const viewMode = this.viewMode();
      const initialized = this.stateInitialized();

      if (initialized) {
        const current = untracked(() =>
          this.collectionService.getListState(tab),
        );
        const state: ListState = {
          tab,
          filters,
          displayLimit,
          viewMode,
          scrollX: current?.scrollX ?? 0,
          scrollY: current?.scrollY ?? 0,
        };
        if (this.statePersistTimer) {
          clearTimeout(this.statePersistTimer);
        }
        this.statePersistTimer = setTimeout(() => {
          this.statePersistTimer = null;
          this.collectionService.updateListState(state);
        }, 150);
      }
    });
  }

  /**
   * Listens for scroll events outside of Angular's zone to prevent change detection
   * from firing on every frame, which causes severe scroll jank. Throttled.
   */
  private scrollTimeout: ReturnType<typeof setTimeout> | null = null;
  private isScrollListenerAttached = false;

  private attachScrollListener() {
    if (this.isScrollListenerAttached || typeof window === 'undefined') return;
    this.isScrollListenerAttached = true;
    this.ngZone.runOutsideAngular(() => {
      window.addEventListener('scroll', this.onScrollHandler, {
        passive: true,
      });
    });
  }

  private onScrollHandler = () => {
    if (!this.elementRef.nativeElement.isConnected) return;
    if (this.scrollTimeout) return;
    this.scrollTimeout = setTimeout(() => {
      this.scrollTimeout = null;
      if (!this.elementRef.nativeElement.isConnected) return;
      if (this.stateInitialized() && window.scrollY >= 0) {
        const currentState = this.collectionService.getListState(
          this.currentTab(),
        );
        const state: ListState = currentState || {
          tab: this.currentTab(),
          filters: this.filters(),
          displayLimit: this.displayLimit(),
          scrollX: 0,
          scrollY: 0,
        };

        this.collectionService.updateListState({
          ...state,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
        });
      }
    }, 100);
  };

  /**
   * Restores the previously saved scroll position after rendering.
   * Since displayLimit is hydrated before initial render, all items are present
   * in the DOM tree upfront.
   */
  private restoreScroll() {
    const savedState = this.collectionService.getListState(this.currentTab());
    if (
      !savedState ||
      savedState.scrollY === undefined ||
      savedState.scrollY <= 0
    ) {
      this.stateInitialized.set(true);
      this.attachScrollListener();
      return;
    }

    const targetY = savedState.scrollY;
    const targetX = savedState.scrollX || 0;

    if (typeof window === 'undefined') {
      this.stateInitialized.set(true);
      return;
    }

    window.scrollTo({
      left: targetX,
      top: targetY,
      behavior: 'instant' as ScrollBehavior,
    });

    this.stateInitialized.set(true);
    this.attachScrollListener();
  }

  private isInitialized = false;

  /**
   * Component Lifecycle: Restores previous tab state and initiates data refresh.
   */
  async ngOnInit() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.stateInitialized.set(false);
    this.currentTab.set(
      (this.route.snapshot.url[0]?.path as 'games' | 'toys') || 'games',
    );

    const savedState = this.collectionService.getListState(this.currentTab());
    if (savedState) {
      const validSorts = new Set([
        'default',
        'retail_asc',
        'discount_desc',
        'market_value_desc',
        'market_value_asc',
        'release_desc',
        'release_asc',
        'acquired_desc',
        'acquired_asc',
        'price_paid_desc',
        'price_paid_asc',
      ]);
      const rawSort = savedState.filters.sortBy;
      const normalizedSortBy =
        rawSort &&
        validSorts.has(rawSort) &&
        (this.showProvenanceFilters() || !isProvenanceSort(rawSort))
          ? rawSort
          : 'default';
      this.filters.set({
        ...savedState.filters,
        sortBy: normalizedSortBy,
      });
      this.displayLimit.set(savedState.displayLimit);
      if (savedState.viewMode) {
        this.viewMode.set(savedState.viewMode);
      }
    } else if (typeof localStorage !== 'undefined') {
      const globalPref = localStorage.getItem(
        'app_preferred_view_mode',
      ) as ViewMode | null;
      if (globalPref === 'grid' || globalPref === 'compact') {
        this.viewMode.set(globalPref);
      }
    }

    // Apply any inbound query parameters (e.g. from Insights drill-down links)
    if (this.route?.snapshot?.queryParams) {
      this.applyQueryParams(this.route.snapshot.queryParams);
    }
    if (this.route?.queryParams) {
      this.queryParamsSub = this.route.queryParams.subscribe((params) => {
        this.applyQueryParams(params);
      });
    }

    const hasData =
      this.collectionService.isLoadedForCurrentContext() &&
      (this.currentTab() === 'games'
        ? this.collectionService.games().length > 0
        : this.collectionService.toys().length > 0);

    if (hasData) {
      this.restoreScroll();
    } else {
      await this.collectionService.refreshAll();
      this.restoreScroll();
    }
    if (
      this.collectionService.canShowPersonalState?.() &&
      !this.collectionService.journalLoaded?.() &&
      typeof this.collectionService.loadAllJournalEntries === 'function'
    ) {
      this.collectionService.loadAllJournalEntries().subscribe();
    }
    this.maybeEnsureFullCatalogForFilters(this.filters());
  }

  private maybeEnsureFullCatalogForFilters(filters: FilterState): void {
    if (this.currentTab() !== 'games') return;
    const needsUnowned =
      filters.ownership === 0 ||
      filters.ownership === 'all' ||
      (filters.ownership === 'seeking_or_unowned' && !filters.deals_only);
    if (
      needsUnowned &&
      typeof this.collectionService.ensureFullCatalogLoaded === 'function'
    ) {
      void this.collectionService.ensureFullCatalogLoaded();
    }
  }

  /**
   * Sets up the IntersectionObserver for infinite scrolling after the view is ready.
   */
  ngAfterViewInit() {
    this.setupIntersectionObserver();
  }

  /**
   * Cleanup: disconnects observer to prevent memory leaks and persists final state.
   */
  ngOnDestroy() {
    this.isInitialized = false;
    if (this.statePersistTimer) {
      clearTimeout(this.statePersistTimer);
      this.statePersistTimer = null;
    }
    if (this.queryParamsSub) {
      this.queryParamsSub.unsubscribe();
    }
    if (this.observer) this.observer.disconnect();
    if (this.scrollTimeout) {
      clearTimeout(this.scrollTimeout);
      this.scrollTimeout = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('scroll', this.onScrollHandler);
      this.isScrollListenerAttached = false;
      if (this.stateInitialized()) {
        const currentState = this.collectionService.getListState(
          this.currentTab(),
        );
        const state: ListState = currentState || {
          tab: this.currentTab(),
          filters: this.filters(),
          displayLimit: this.displayLimit(),
          viewMode: this.viewMode(),
          scrollX: 0,
          scrollY: 0,
        };
        this.collectionService.updateListState({
          ...state,
          displayLimit: this.displayLimit(),
          viewMode: this.viewMode(),
          scrollX: window.scrollX,
          scrollY: window.scrollY,
        });
      }
    }
    this.collectionService.persistState(this.currentTab());
  }

  /**
   * Initializes the IntersectionObserver that triggers 'loadMore' when the
   * user reaches the bottom of the list.
   */
  setupIntersectionObserver() {
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) this.loadMore();
      },
      { root: null, rootMargin: '200px', threshold: 0.1 },
    );
    if (this.scrollTrigger?.nativeElement)
      this.observer.observe(this.scrollTrigger.nativeElement);
  }

  /**
   * Increases the virtual display limit, triggering the computed reactive
   * pipelines to slice a larger portion of the collection into the DOM.
   */
  loadMore() {
    if (!this.stateInitialized()) return;
    this.displayLimit.update((limit) => limit + 100);
  }

  /**
   * Event handler for filter updates from the child component.
   * Resets the display limit to ensure performance.
   */
  onFiltersChange(newFilters: FilterState) {
    this.filters.set({ ...newFilters });
    this.displayLimit.set(100);
    this.maybeEnsureFullCatalogForFilters(newFilters);
    if (
      this.route?.snapshot?.queryParams &&
      Object.keys(this.route.snapshot.queryParams).length > 0
    ) {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true,
      });
    }
  }

  /**
   * Event handler for view mode toggle updates (grid vs compact rows).
   */
  onViewModeChange(mode: ViewMode) {
    this.viewMode.set(mode);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('app_preferred_view_mode', mode);
    }
  }

  public onFilterByPlayStatus(status: PlayStatus): void {
    this.onFiltersChange({
      ...this.filters(),
      play_status: status,
    });
  }

  public onAdvancePlayStatus(event: {
    game: Game;
    nextStatus: PlayStatus;
  }): void {
    const { game, nextStatus } = event;
    if (
      this.collectionService.isPublicView() ||
      !this.collectionService.isAuthenticated() ||
      this.playShelfBusyIds().has(game.id)
    ) {
      return;
    }

    this.playShelfBusyIds.update((prev) => {
      const next = new Set(prev);
      next.add(game.id);
      return next;
    });

    const clearBusy = () => {
      this.playShelfBusyIds.update((prev) => {
        const next = new Set(prev);
        next.delete(game.id);
        return next;
      });
    };

    this.collectionService.updatePlayStatus(game.id, nextStatus).subscribe({
      next: () => clearBusy(),
      error: (err) => {
        clearBusy();
        console.error('Failed to advance play status:', err);
      },
    });
  }

  /** --- Toggle Ownership Handlers --- */
  onToggleStatus(event: MouseEvent, item: Game | Toy, type: 'game' | 'toy') {
    event.preventDefault();
    event.stopPropagation();

    if (this.collectionService.isPublicView()) {
      return;
    }

    if (!this.collectionService.isAuthenticated()) {
      this.collectionService.promptAdminLogin();
      return;
    }

    const name = (item as Game).title || (item as Toy).name;
    const prevStatus = item.ownership_status;

    this.collectionService.showOptions(
      `Change Status`,
      `Set status for "${name}":`,
      [
        { label: 'Unowned', value: 0 },
        { label: 'Owned', value: 1 },
        { label: 'Priority Seeking', value: 4 },
        { label: 'Seeking', value: 2 },
        { label: 'Ordered', value: 3 },
      ],
      (newValue) => {
        const numValue =
          typeof newValue === 'string' ? parseInt(newValue, 10) : newValue;
        if (isNaN(numValue) || numValue < 0 || numValue > 4) return;

        item.ownership_status = numValue;
        if (type === 'game') {
          this.collectionService.patchGameOptimistic(item.id, {
            ownership_status: numValue,
          });
        } else {
          this.collectionService.patchToyOptimistic(item.id, {
            ownership_status: numValue,
          });
        }
        this.collectionService
          .toggleOwnership(item.id, type, numValue)
          .subscribe({
            error: (err) => {
              item.ownership_status = prevStatus;
              if (type === 'game') {
                this.collectionService.patchGameOptimistic(item.id, {
                  ownership_status: prevStatus,
                });
              } else {
                this.collectionService.patchToyOptimistic(item.id, {
                  ownership_status: prevStatus,
                });
              }
              console.error('Failed to set status:', err);
            },
          });
      },
    );
  }

  onEditSortIndex(event: MouseEvent, item: Game | Toy, type: 'game' | 'toy') {
    event.preventDefault();
    event.stopPropagation();

    if (!this.collectionService.isAdmin()) {
      this.collectionService.promptAdminLogin();
      return;
    }

    const name = (item as Game).title || (item as Toy).name;
    const currentSort = item.sort_index ?? 0;
    const prevSort = item.sort_index;

    this.collectionService.showInput(
      `Edit Sort Index`,
      `Set sort index for "${name}":`,
      currentSort,
      (newValue) => {
        const numValue =
          newValue === '' || newValue === null
            ? 0
            : typeof newValue === 'string'
              ? parseInt(newValue, 10)
              : newValue;
        if (isNaN(numValue)) return;

        item.sort_index = numValue;
        if (type === 'game') {
          this.collectionService.patchGameOptimistic(item.id, {
            sort_index: numValue,
          });
        } else {
          this.collectionService.patchToyOptimistic(item.id, {
            sort_index: numValue,
          });
        }
        this.collectionService
          .updateSortIndex(item.id, type, numValue)
          .subscribe({
            error: (err) => {
              item.sort_index = prevSort;
              if (type === 'game') {
                this.collectionService.patchGameOptimistic(item.id, {
                  sort_index: prevSort,
                });
              } else {
                this.collectionService.patchToyOptimistic(item.id, {
                  sort_index: prevSort ?? undefined,
                });
              }
              console.error('Failed to update sort index:', err);
            },
          });
      },
    );
  }

  public getGamePriceBadge(
    game: Game,
  ): { cents: number; label: string } | null {
    if (game.retail_price) {
      return { cents: game.retail_price, label: game.retail_store || 'Retail' };
    }
    return null;
  }

  onToggleCase(event: MouseEvent, game: Game) {
    event.preventDefault();
    event.stopPropagation();
    if (this.collectionService.isPublicView()) {
      return;
    }
    if (!this.collectionService.isAuthenticated()) {
      this.collectionService.promptAdminLogin();
      return;
    }
    const prevStatus = game.has_case;
    const current = Boolean(game.has_case);
    const newStatus = current ? 0 : 1;
    game.has_case = newStatus;
    this.collectionService.patchGameOptimistic(game.id, {
      has_case: newStatus,
    });
    this.collectionService.updateHasCase(game.id, newStatus).subscribe({
      error: (err) => {
        game.has_case = prevStatus;
        this.collectionService.patchGameOptimistic(game.id, {
          has_case: prevStatus,
        });
        console.error('Failed to toggle case:', err);
      },
    });
  }

  onToggleManual(event: MouseEvent, game: Game) {
    event.preventDefault();
    event.stopPropagation();
    if (this.collectionService.isPublicView()) {
      return;
    }
    if (!this.collectionService.isAuthenticated()) {
      this.collectionService.promptAdminLogin();
      return;
    }
    const prevStatus = game.has_manual;
    const current = Boolean(game.has_manual);
    const newStatus = current ? 0 : 1;
    game.has_manual = newStatus;
    this.collectionService.patchGameOptimistic(game.id, {
      has_manual: newStatus,
    });
    this.collectionService.updateHasManual(game.id, newStatus).subscribe({
      error: (err) => {
        game.has_manual = prevStatus;
        this.collectionService.patchGameOptimistic(game.id, {
          has_manual: prevStatus,
        });
        console.error('Failed to toggle manual:', err);
      },
    });
  }

  public getOwnedDiscCount(game: Game): number {
    return getOwnedMediaCount(game);
  }

  public onToggleSingleMediaOwned(event: MouseEvent, game: Game): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.collectionService.isPublicView()) {
      return;
    }
    if (!this.collectionService.isAuthenticated()) {
      this.collectionService.promptAdminLogin();
      return;
    }
    const firstMedia = getReleaseMediaItems(game)[0];
    const releaseId = firstMedia?.id || game.id;
    if (!releaseId) return;
    const prevMediaItems = game.mediaItems ? [...game.mediaItems] : undefined;
    const prevHasMedia = game.has_media;
    const current = Boolean(game.has_media);
    const newStatus: 0 | 1 = current ? 0 : 1;
    if (game.mediaItems?.length) {
      game.mediaItems = game.mediaItems.map((m, idx) =>
        idx === 0 ? { ...m, hasMedia: newStatus } : m,
      );
    }
    game.has_media = newStatus;
    this.collectionService.patchDiscMediaOptimistic(releaseId, newStatus);
    this.collectionService.updateMediaOwned(releaseId, newStatus).subscribe({
      error: (err) => {
        if (prevMediaItems) {
          game.mediaItems = prevMediaItems;
        }
        game.has_media = prevHasMedia;
        this.collectionService.patchDiscMediaOptimistic(
          releaseId,
          current ? 1 : 0,
        );
        console.error('Failed to toggle media ownership:', err);
      },
    });
  }

  public onOpenDiscChecklist(event: MouseEvent, game: Game): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.collectionService.isPublicView()) {
      return;
    }
    if (!this.collectionService.isAuthenticated()) {
      this.collectionService.promptAdminLogin();
      return;
    }
    this.discModalGameId.set(game.id);
  }

  public onCloseDiscModal(): void {
    this.discModalGameId.set(null);
  }

  public onDiscModalToggleDisc(payload: {
    releaseId: string;
    nextValue: 0 | 1;
  }): void {
    if (this.collectionService.isPublicView()) return;
    if (!this.collectionService.isAuthenticated()) {
      this.collectionService.promptAdminLogin();
      return;
    }
    const { releaseId, nextValue } = payload;
    const active = this.activeDiscModalGame();
    const matchedItem = active
      ? getReleaseMediaItems(active).find((m) => m.id === releaseId)
      : undefined;
    const prevStatus = matchedItem ? matchedItem.hasMedia : nextValue ? 0 : 1;
    this.collectionService.patchDiscMediaOptimistic(releaseId, nextValue);
    this.collectionService.updateMediaOwned(releaseId, nextValue).subscribe({
      error: (err) => {
        this.collectionService.patchDiscMediaOptimistic(releaseId, prevStatus);
        console.error('Failed to update disc ownership:', err);
      },
    });
  }

  public onDiscModalSetAll(payload: {
    releaseIds: string[];
    nextValue: 0 | 1;
  }): void {
    if (this.collectionService.isPublicView()) return;
    if (!this.collectionService.isAuthenticated()) {
      this.collectionService.promptAdminLogin();
      return;
    }
    if (payload.releaseIds.length === 0) return;

    const active = this.activeDiscModalGame();
    const mediaById = new Map(
      (active ? getReleaseMediaItems(active) : []).map((m) => [m.id, m]),
    );
    const prevByRelease = new Map<string, number>();
    for (const id of payload.releaseIds) {
      const matchedItem = mediaById.get(id);
      const prev = matchedItem
        ? matchedItem.hasMedia
        : payload.nextValue
          ? 0
          : 1;
      prevByRelease.set(id, prev);
      this.collectionService.patchDiscMediaOptimistic(id, payload.nextValue);
    }

    this.discModalSaving.set(true);
    forkJoin(
      payload.releaseIds.map((id) =>
        this.collectionService.updateMediaOwned(id, payload.nextValue),
      ),
    ).subscribe({
      next: () => {
        this.discModalSaving.set(false);
      },
      error: (err) => {
        this.discModalSaving.set(false);
        for (const [id, prev] of prevByRelease.entries()) {
          this.collectionService.patchDiscMediaOptimistic(id, prev);
        }
        console.error('Failed to batch update disc ownership:', err);
      },
    });
  }
}
