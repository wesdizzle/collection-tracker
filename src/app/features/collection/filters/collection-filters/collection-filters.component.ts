/**
 * COLLECTION FILTERS COMPONENT
 *
 * Provides the user interface for filtering the collection by status,
 * platform, line, type, and series using the shared `@wesdizzle/app-kit/angular`
 * `<kit-filter-bar>`, `<kit-select>`, `<kit-combobox>`, and `<kit-multiselect>` primitives.
 */

import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  KitComboboxComponent,
  KitFilterBarComponent,
  KitFilterPill,
  KitMultiSelectComponent,
  KitSelectComponent,
  KitSelectGroup,
  KitSelectOption,
  activeKitDropdownId,
  closeAllKitDropdowns,
} from '@wesdizzle/app-kit/angular';
import {
  FilterState,
  PlatformGroup,
  ProvenanceStatusFilter,
  ViewMode,
} from '../../../../core/models/collection.models';
import { CollectionService } from '../../../../core/services/collection.service';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-collection-filters',
  standalone: true,
  imports: [
    IconComponent,
    KitFilterBarComponent,
    KitSelectComponent,
    KitComboboxComponent,
    KitMultiSelectComponent,
  ],
  templateUrl: './collection-filters.component.html',
  styleUrls: ['./collection-filters.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollectionFiltersComponent implements OnDestroy {
  private readonly collectionService = inject(CollectionService, {
    optional: true,
  });
  private quickSearchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private seriesDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private tagDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private priceMinDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private priceMaxDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnDestroy(): void {
    if (this.quickSearchDebounceTimer) {
      clearTimeout(this.quickSearchDebounceTimer);
      this.quickSearchDebounceTimer = null;
    }
    if (this.seriesDebounceTimer) {
      clearTimeout(this.seriesDebounceTimer);
      this.seriesDebounceTimer = null;
    }
    if (this.tagDebounceTimer) {
      clearTimeout(this.tagDebounceTimer);
      this.tagDebounceTimer = null;
    }
    if (this.priceMinDebounceTimer) {
      clearTimeout(this.priceMinDebounceTimer);
      this.priceMinDebounceTimer = null;
    }
    if (this.priceMaxDebounceTimer) {
      clearTimeout(this.priceMaxDebounceTimer);
      this.priceMaxDebounceTimer = null;
    }
  }

  /** --- Internal UI State --- */
  public showFilters = signal(false);
  public showDrawer = signal(false);
  public activeDropdown = activeKitDropdownId;

  /** Quick Status Helpers */
  public readonly isOwnedActive = computed(() => {
    return this.filters().ownership === 1 && !this.filters().deals_only;
  });

  public readonly isHomeRegionAndOwnedActive = computed(() => {
    return (
      this.filters().ownership === 'home_region_and_owned' &&
      !this.filters().deals_only
    );
  });

  public readonly isAllActive = computed(() => {
    const o = this.filters().ownership;
    return (o === 'all' || o === undefined) && !this.filters().deals_only;
  });

  public readonly isSeekingActive = computed(() => {
    return this.filters().ownership === 2 && !this.filters().deals_only;
  });

  public readonly isPrioritySeekingActive = computed(() => {
    return this.filters().ownership === 4 && !this.filters().deals_only;
  });

  public readonly isDealsActive = computed(() => {
    return (
      Boolean(this.filters().deals_only) &&
      this.filters().ownership === 'seeking_or_unowned'
    );
  });

  public readonly quickPills = computed<readonly KitFilterPill[]>(() => {
    const pills: KitFilterPill[] = [
      {
        id: 'owned',
        label: 'Owned',
        active: this.isOwnedActive(),
      },
      {
        id: 'home_region_and_owned',
        label: 'Home Region & Owned',
        active: this.isHomeRegionAndOwnedActive(),
        title:
          'All owned items, plus seeking/unowned items from your home region',
      },
      {
        id: 'all',
        label: 'All',
        active: this.isAllActive(),
      },
      {
        id: 'priority_seeking',
        label: 'Priority Seeking',
        active: this.isPrioritySeekingActive(),
        title: 'High-priority target games and toys',
      },
      {
        id: 'seeking',
        label: 'Seeking',
        active: this.isSeekingActive(),
      },
    ];

    pills.push(
      {
        id: 'retail_available',
        label: 'At Retail',
        active: Boolean(this.filters().retail_available),
        title: 'Filter to items currently available at retail',
      },
      {
        id: 'deals',
        label: 'Deals',
        active: this.isDealsActive(),
        variant: 'deals',
        icon: 'flame',
      },
    );

    return pills;
  });

  public onQuickPillClick(pillId: string): void {
    if (pillId === 'retail_available') {
      this.toggleRetailAvailable();
      return;
    }
    this.selectQuickStatus(
      pillId as
        | 'owned'
        | 'home_region_and_owned'
        | 'all'
        | 'priority_seeking'
        | 'seeking'
        | 'deals',
    );
  }

  public selectQuickStatus(
    status:
      | 'owned'
      | 'home_region_and_owned'
      | 'all'
      | 'priority_seeking'
      | 'seeking'
      | 'deals',
  ) {
    if (status === 'deals') {
      this.filtersChange.emit({
        ...this.filters(),
        ownership: 'seeking_or_unowned',
        deals_only: true,
      });
    } else if (status === 'home_region_and_owned') {
      this.filtersChange.emit({
        ...this.filters(),
        ownership: 'home_region_and_owned',
        deals_only: false,
      });
    } else if (status === 'owned') {
      this.filtersChange.emit({
        ...this.filters(),
        ownership: 1,
        deals_only: false,
      });
    } else if (status === 'priority_seeking') {
      this.filtersChange.emit({
        ...this.filters(),
        ownership: 4,
        deals_only: false,
      });
    } else if (status === 'seeking') {
      this.filtersChange.emit({
        ...this.filters(),
        ownership: 2,
        deals_only: false,
      });
    } else {
      this.filtersChange.emit({
        ...this.filters(),
        ownership: 'all',
        deals_only: false,
      });
    }
  }

  public readonly activeFilterCount = computed(() => {
    let count = 0;
    const f = this.filters();
    if (f.platform_id !== undefined && f.platform_id !== null) count++;
    if (f.regions && f.regions.length > 0) count++;
    if (f.play_status && f.play_status !== 'all') count++;
    if (
      this.showBackupDetails() &&
      f.backup_status !== undefined &&
      f.backup_status !== 'all'
    )
      count++;
    if (f.physical_verified !== undefined && f.physical_verified !== 'all')
      count++;
    if (f.budget_label && f.budget_label !== 'all') count++;
    if (f.line) count++;
    if (f.type) count++;
    if (f.series) count++;
    if (f.tag) count++;
    if (f.retail_available) count++;
    if (
      f.ownership === 3 ||
      f.ownership === 0 ||
      f.ownership === 'seeking_or_unowned' ||
      f.ownership === 'home_region_and_owned'
    )
      count++;
    if (this.showProvenanceFilters()) {
      if (f.provenance_status && f.provenance_status !== 'all') count++;
      if ((f.provenance_source || '').trim()) count++;
      if (
        f.acquired_year !== undefined &&
        f.acquired_year !== null &&
        f.acquired_year !== 'all'
      ) {
        count++;
      }
      if ((f.acquired_from || '').trim() || (f.acquired_to || '').trim()) {
        count++;
      }
      if (
        (f.price_paid_min !== undefined &&
          f.price_paid_min !== null &&
          Number.isFinite(Number(f.price_paid_min))) ||
        (f.price_paid_max !== undefined &&
          f.price_paid_max !== null &&
          Number.isFinite(Number(f.price_paid_max)))
      ) {
        count++;
      }
    }
    return count;
  });

  public resetFilters() {
    if (this.quickSearchDebounceTimer) {
      clearTimeout(this.quickSearchDebounceTimer);
      this.quickSearchDebounceTimer = null;
    }
    if (this.seriesDebounceTimer) {
      clearTimeout(this.seriesDebounceTimer);
      this.seriesDebounceTimer = null;
    }
    if (this.tagDebounceTimer) {
      clearTimeout(this.tagDebounceTimer);
      this.tagDebounceTimer = null;
    }
    if (this.priceMinDebounceTimer) {
      clearTimeout(this.priceMinDebounceTimer);
      this.priceMinDebounceTimer = null;
    }
    if (this.priceMaxDebounceTimer) {
      clearTimeout(this.priceMaxDebounceTimer);
      this.priceMaxDebounceTimer = null;
    }
    this.filtersChange.emit({
      ownership: 1,
      play_status: 'all',
      backup_status: 'all',
      physical_verified: 'all',
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
      provenance_status: 'all',
      provenance_source: '',
      provenanceSourceExact: false,
      acquired_year: 'all',
      acquired_from: '',
      acquired_to: '',
      price_paid_min: null,
      price_paid_max: null,
    });
  }

  public onQuickSearchInput(value: string) {
    if (this.quickSearchDebounceTimer) {
      clearTimeout(this.quickSearchDebounceTimer);
    }
    this.quickSearchDebounceTimer = setTimeout(() => {
      this.quickSearchDebounceTimer = null;
      this.onQuickSearchChange(value);
    }, 150);
  }

  public onQuickSearchEnter(event: Event) {
    if (this.quickSearchDebounceTimer) {
      clearTimeout(this.quickSearchDebounceTimer);
      this.quickSearchDebounceTimer = null;
    }
    const target = event.target as HTMLInputElement;
    if (target) {
      this.onQuickSearchChange(target.value);
    }
  }

  public onQuickSearchChange(value: string) {
    if (this.quickSearchDebounceTimer) {
      clearTimeout(this.quickSearchDebounceTimer);
      this.quickSearchDebounceTimer = null;
    }
    this.filtersChange.emit({
      ...this.filters(),
      name: value,
      seriesOrName: undefined,
    });
  }

  public clearQuickSearch() {
    if (this.quickSearchDebounceTimer) {
      clearTimeout(this.quickSearchDebounceTimer);
      this.quickSearchDebounceTimer = null;
    }
    this.filtersChange.emit({
      ...this.filters(),
      name: '',
      seriesOrName: undefined,
    });
  }

  /** Backward-compatible computed for region dropdown open state */
  public isRegionDropdownOpen = computed(
    () => this.activeDropdown() === 'region',
  );

  /** --- Reactive Inputs --- */
  public currentTab = input.required<'games' | 'toys'>();
  public platformGroups = input<PlatformGroup[]>([]);
  public uniqueLines = input<string[]>([]);
  public uniqueTypes = input<string[]>([]);
  public uniqueNames = input<string[]>([]);
  public uniqueSeries = input<string[]>([]);
  public uniqueTags = input<string[]>([]);
  public uniqueRegions = input<string[]>([]);
  public resultCount = input<number>(0);
  public filters = input.required<FilterState>();
  public lastUpdated = input<Date | null>(null);
  public viewMode = input<ViewMode>('grid');
  public showBackupDetails = input<boolean>(true);
  public showProvenanceFilters = input<boolean>(false);
  public uniqueProvenanceSources = input<string[]>([]);
  public uniqueAcquiredYears = input<number[]>([]);

  /** --- Options Catalogues --- */
  readonly ownershipOptions: {
    value:
      | 'all'
      | 'seeking_or_unowned'
      | 'home_region_and_owned'
      | 1
      | 4
      | 2
      | 3
      | 0;
    label: string;
  }[] = [
    { value: 'all', label: 'All' },
    { value: 'home_region_and_owned', label: 'Home Region & Owned' },
    { value: 'seeking_or_unowned', label: 'Seeking or Unowned' },
    { value: 1, label: 'Owned' },
    { value: 4, label: 'Priority Seeking' },
    { value: 2, label: 'Seeking' },
    { value: 3, label: 'Ordered' },
    { value: 0, label: 'Unowned' },
  ];

  readonly playStatusOptions: {
    value: 'all' | 1 | 2 | 3 | 4 | 5 | 0;
    label: string;
  }[] = [
    { value: 'all', label: 'All' },
    { value: 1, label: 'Played' },
    { value: 2, label: 'Playing' },
    { value: 3, label: 'Queued' },
    { value: 4, label: 'Paused' },
    { value: 5, label: 'Dropped' },
    { value: 0, label: 'Unplayed' },
  ];

  readonly backupOptions: {
    value: 'all' | 1 | 0 | 'uncataloged';
    label: string;
  }[] = [
    { value: 'all', label: 'All' },
    { value: 1, label: 'Backed Up' },
    { value: 0, label: 'No Backup' },
    { value: 'uncataloged', label: 'Uncataloged (No DAT CRC)' },
  ];

  readonly physicalVerifiedOptions: { value: 'all' | 1 | 0; label: string }[] =
    [
      { value: 'all', label: 'All' },
      { value: 1, label: 'Verified (DAT / Nintendo Revised)' },
      { value: 0, label: 'Unverified / Modern Platform' },
    ];

  readonly budgetLabelOptions: {
    value: 'all' | 'standard_only' | 'standard_and_budget' | 'budget_only';
    label: string;
  }[] = [
    { value: 'all', label: 'All' },
    { value: 'standard_only', label: 'Standard label only' },
    { value: 'standard_and_budget', label: 'Standard and budget labels' },
    { value: 'budget_only', label: 'Budget label only' },
  ];

  readonly provenanceStatusOptions: {
    value: ProvenanceStatusFilter;
    label: string;
  }[] = [
    { value: 'all', label: 'All' },
    { value: 'recorded', label: 'Recorded' },
    { value: 'missing', label: 'Missing Provenance' },
    { value: 'missing_date', label: 'Missing Date' },
    { value: 'missing_price', label: 'Missing Price Paid' },
    { value: 'exact_date', label: 'Exact Date' },
    { value: 'approximate_date', label: 'Approximate Date' },
    { value: 'gifted', label: 'Gifted' },
    { value: 'free', label: 'Free ($0)' },
    { value: 'has_receipt', label: 'Has Receipt' },
    { value: 'has_notes', label: 'Has Notes' },
  ];

  readonly acquiredYearAllOption: KitSelectOption<number | 'all' | 'undated'> =
    {
      value: 'all',
      label: 'All Years',
    };

  readonly acquiredYearOptions = computed<
    readonly KitSelectOption<number | 'all' | 'undated'>[]
  >(() => [
    ...this.uniqueAcquiredYears().map((y) => ({
      value: y as number | 'all' | 'undated',
      label: String(y),
    })),
    { value: 'undated', label: 'Undated' },
  ]);

  readonly activeAcquiredPeriodLabel = computed<string | null>(() => {
    const f = this.filters();
    const from = (f.acquired_from || '').trim();
    const to = (f.acquired_to || '').trim();
    if (!from && !to) return null;
    if (from && to) return `${from} – ${to}`;
    return from ? `From ${from}` : `Through ${to}`;
  });

  readonly sortByOptions = computed(() => {
    const base = [
      { value: 'default', label: 'Default' },
      { value: 'release_desc', label: 'Release Date: Newest First' },
      { value: 'release_asc', label: 'Release Date: Oldest First' },
      { value: 'retail_asc', label: 'Lowest Retail Price' },
      { value: 'discount_desc', label: 'Deepest Sale Discount' },
    ];
    if (this.showProvenanceFilters()) {
      base.push(
        { value: 'acquired_desc', label: 'Acquisition Date: Newest First' },
        { value: 'acquired_asc', label: 'Acquisition Date: Oldest First' },
        { value: 'price_paid_desc', label: 'Price Paid: High to Low' },
        { value: 'price_paid_asc', label: 'Price Paid: Low to High' },
      );
    }
    if (this.collectionService?.canViewMarketPrices?.()) {
      base.push(
        { value: 'market_value_desc', label: 'Market Value: High to Low' },
        { value: 'market_value_asc', label: 'Market Value: Low to High' },
      );
    }
    return base;
  });

  readonly platformAllOption: KitSelectOption<number | undefined> = {
    value: undefined,
    label: 'All Platforms',
  };

  readonly platformSelectGroups = computed<
    readonly KitSelectGroup<number | undefined>[]
  >(() =>
    this.platformGroups().map((group) => ({
      label: group.brand,
      options: group.platforms.map((p) => ({
        value: p.id,
        label: p.display_name || p.name,
        indent: Boolean(p.parent_platform_id),
      })),
    })),
  );

  readonly lineAllOption: KitSelectOption<string> = {
    value: '',
    label: 'All Lines',
  };

  readonly lineSelectOptions = computed<readonly KitSelectOption<string>[]>(
    () => this.uniqueLines().map((l) => ({ value: l, label: l })),
  );

  readonly typeAllOption: KitSelectOption<string> = {
    value: '',
    label: 'All Types',
  };

  readonly typeSelectOptions = computed<readonly KitSelectOption<string>[]>(
    () => this.uniqueTypes().map((t) => ({ value: t, label: t })),
  );

  public filtersChange = output<FilterState>();
  public viewModeChange = output<ViewMode>();

  onViewModeSelect(mode: string) {
    const typedMode = mode as ViewMode;
    if (this.viewMode() !== typedMode) {
      this.viewModeChange.emit(typedMode);
    }
  }

  onPartialChange(key: keyof FilterState, value: unknown) {
    let processedValue: unknown = value;
    if (value === 'true') processedValue = true;
    if (value === 'false') processedValue = false;

    this.filtersChange.emit({
      ...this.filters(),
      [key]: processedValue as FilterState[keyof FilterState],
    } as FilterState);
  }

  /** --- Dropdown Interaction Methods --- */
  toggleDropdown(name: string, event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    this.activeDropdown.update((current) => (current === name ? null : name));
  }

  closeDropdown() {
    closeAllKitDropdowns();
  }

  selectOption(key: keyof FilterState, value: unknown) {
    this.onPartialChange(key, value);
    this.closeDropdown();
  }

  selectPlatform(platformId: number | undefined) {
    this.onPartialChange('platform_id', platformId);
    this.closeDropdown();
  }

  toggleDealsOnly() {
    const current = Boolean(this.filters().deals_only);
    this.onPartialChange('deals_only', !current);
  }

  toggleRetailAvailable() {
    const current = Boolean(this.filters().retail_available);
    this.onPartialChange('retail_available', !current);
  }

  onPricePaidInput(
    key: 'price_paid_min' | 'price_paid_max',
    rawValue: string,
  ): void {
    const apply = () => {
      const trimmed = rawValue.trim();
      if (!trimmed) {
        this.onPartialChange(key, null);
        return;
      }
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed) || parsed < 0) return;
      this.onPartialChange(key, Math.round(parsed * 100) / 100);
    };

    if (key === 'price_paid_min') {
      if (this.priceMinDebounceTimer) clearTimeout(this.priceMinDebounceTimer);
      this.priceMinDebounceTimer = setTimeout(() => {
        this.priceMinDebounceTimer = null;
        apply();
      }, 150);
    } else {
      if (this.priceMaxDebounceTimer) clearTimeout(this.priceMaxDebounceTimer);
      this.priceMaxDebounceTimer = setTimeout(() => {
        this.priceMaxDebounceTimer = null;
        apply();
      }, 150);
    }
  }

  clearAcquiredPeriod(): void {
    this.filtersChange.emit({
      ...this.filters(),
      acquired_from: '',
      acquired_to: '',
    });
  }

  public filteredNamesList = computed(() => {
    const query = (this.filters().name || this.filters().seriesOrName || '')
      .trim()
      .toLowerCase();
    const names = this.uniqueNames() || [];
    if (!query) {
      return names.slice(0, 100);
    }
    return names.filter((n) => n.toLowerCase().includes(query)).slice(0, 100);
  });

  public filteredSeriesList = computed(() => {
    const query = (this.filters().series || '').trim().toLowerCase();
    const series = this.uniqueSeries() || [];
    if (!query) {
      return series.slice(0, 100);
    }
    return series.filter((s) => s.toLowerCase().includes(query)).slice(0, 100);
  });

  public filteredTagsList = computed(() => {
    const query = (this.filters().tag || '').trim().toLowerCase();
    const tags = this.uniqueTags() || [];
    if (!query) {
      return tags.slice(0, 100);
    }
    return tags.filter((t) => t.toLowerCase().includes(query)).slice(0, 100);
  });

  onNameInputChange(value: string) {
    this.filtersChange.emit({
      ...this.filters(),
      name: value,
      seriesOrName: undefined,
    });
    this.activeDropdown.set('name');
  }

  selectName(name: string) {
    this.filtersChange.emit({
      ...this.filters(),
      name,
      seriesOrName: undefined,
    });
    this.closeDropdown();
  }

  onSeriesInput(value: string) {
    this.activeDropdown.set('series');
    if (this.seriesDebounceTimer) {
      clearTimeout(this.seriesDebounceTimer);
    }
    this.seriesDebounceTimer = setTimeout(() => {
      this.seriesDebounceTimer = null;
      this.onSeriesInputChange(value);
    }, 150);
  }

  onSeriesInputChange(value: string) {
    if (this.seriesDebounceTimer) {
      clearTimeout(this.seriesDebounceTimer);
      this.seriesDebounceTimer = null;
    }
    this.onPartialChange('series', value);
    this.activeDropdown.set('series');
  }

  selectSeries(series: string) {
    if (this.seriesDebounceTimer) {
      clearTimeout(this.seriesDebounceTimer);
      this.seriesDebounceTimer = null;
    }
    this.onPartialChange('series', series);
    this.closeDropdown();
  }

  onTagInput(value: string) {
    this.activeDropdown.set('tag');
    if (this.tagDebounceTimer) {
      clearTimeout(this.tagDebounceTimer);
    }
    this.tagDebounceTimer = setTimeout(() => {
      this.tagDebounceTimer = null;
      this.onTagInputChange(value);
    }, 150);
  }

  onTagInputChange(value: string) {
    if (this.tagDebounceTimer) {
      clearTimeout(this.tagDebounceTimer);
      this.tagDebounceTimer = null;
    }
    this.onPartialChange('tag', value);
    this.activeDropdown.set('tag');
  }

  selectTag(tag: string) {
    if (this.tagDebounceTimer) {
      clearTimeout(this.tagDebounceTimer);
      this.tagDebounceTimer = null;
    }
    this.onPartialChange('tag', tag);
    this.closeDropdown();
  }

  clearRegions() {
    this.onPartialChange('regions', []);
  }

  onRegionToggle(region: string) {
    const currentRegions = this.filters().regions || [];
    let newRegions: string[];
    if (currentRegions.includes(region)) {
      newRegions = currentRegions.filter((r) => r !== region);
    } else {
      newRegions = [...currentRegions, region];
    }
    this.onPartialChange('regions', newRegions);
  }

  isRegionSelected(region: string): boolean {
    return (this.filters().regions || []).includes(region);
  }

  /** --- Label Helpers --- */
  getOwnershipLabel(): string {
    const val = this.filters().ownership ?? 'all';
    const opt = this.ownershipOptions.find((o) => o.value === val);
    return opt ? opt.label : 'All';
  }

  getPlayStatusLabel(): string {
    const val = this.filters().play_status ?? 'all';
    const opt = this.playStatusOptions.find((o) => o.value === val);
    return opt ? opt.label : 'All';
  }

  getBackupLabel(): string {
    const val = this.filters().backup_status ?? 'all';
    const opt = this.backupOptions.find((o) => o.value === val);
    return opt ? opt.label : 'All';
  }

  getPhysicalVerifiedLabel(): string {
    const val = this.filters().physical_verified ?? 'all';
    const opt = this.physicalVerifiedOptions.find((o) => o.value === val);
    return opt ? opt.label : 'All';
  }

  getBudgetLabelStatusLabel(): string {
    const val = this.filters().budget_label ?? 'all';
    const opt = this.budgetLabelOptions.find((o) => o.value === val);
    return opt ? opt.label : 'All';
  }

  getPlatformLabel(): string {
    const pId = this.filters().platform_id;
    if (pId === undefined || pId === null) return 'All Platforms';
    for (const group of this.platformGroups()) {
      const found = group.platforms.find((p) => p.id === pId);
      if (found) return found.display_name || found.name;
    }
    return 'All Platforms';
  }

  getLineLabel(): string {
    return this.filters().line || 'All Lines';
  }

  getTypeLabel(): string {
    return this.filters().type || 'All Types';
  }

  getSortByLabel(): string {
    const val = this.filters().sortBy || 'default';
    const opt = this.sortByOptions().find((o) => o.value === val);
    return opt ? opt.label : 'Default';
  }

  getRegionLabel(): string {
    const selected = this.filters().regions || [];
    if (selected.length === 0) return 'All Regions';
    if (selected.length <= 2) return selected.join(', ');
    return `${selected.length} Selected`;
  }
}
