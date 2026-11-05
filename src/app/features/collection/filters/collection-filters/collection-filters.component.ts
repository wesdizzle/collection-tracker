/**
 * COLLECTION FILTERS COMPONENT
 *
 * Provides the user interface for filtering the collection by status,
 * platform, line, type, and series.
 *
 * DESIGN RATIONALE:
 * - **Collapsible Design**: Implements a 'showFilters' signal to toggle
 *   visibility on mobile, keeping the interface clean for browsing.
 * - **Signal Inputs**: Uses modern Angular 21 signal inputs (`input()`) for
 *   optimal change detection and developer ergonomics.
 * - **Unified Modal Dropdown Design System**: Replaces OS-native select and datalist
 *   popups with custom Material 3 glassmorphic floating modal dropdown menus.
 * - **One-Way Data Flow**: Emits a `filtersChange` output rather than mutating
 *   inputs, following the "Data Down, Actions Up" architecture.
 */

import {
  Component,
  input,
  output,
  signal,
  computed,
  HostListener,
  ElementRef,
  inject,
  OnDestroy,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import {
  FilterState,
  PlatformGroup,
  ViewMode,
} from '../../../../core/models/collection.models';
import { NotificationService } from '../../../../core/services/notification.service';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-collection-filters',
  standalone: true,
  imports: [FormsModule, DatePipe, IconComponent],
  templateUrl: './collection-filters.component.html',
  styleUrls: ['./collection-filters.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollectionFiltersComponent implements OnDestroy {
  public readonly notificationService = inject(NotificationService);

  private quickSearchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private seriesDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private tagDebounceTimer: ReturnType<typeof setTimeout> | null = null;

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
  }

  /** --- Internal UI State --- */
  public showFilters = signal(false);
  public showDrawer = signal(false);
  public activeDropdown = signal<string | null>(null);
  public readonly showNotificationModal =
    this.notificationService.isSettingsModalOpen;
  public readonly isNotificationSubscribed = computed(() =>
    this.notificationService.isSubscribed(),
  );

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

  public readonly isDealsActive = computed(() => {
    return (
      Boolean(this.filters().deals_only) &&
      this.filters().ownership === 'seeking_or_unowned'
    );
  });

  public readonly isUpcomingActive = computed(() => {
    return this.filters().ownership === 'upcoming';
  });

  public selectQuickStatus(
    status:
      | 'owned'
      | 'home_region_and_owned'
      | 'all'
      | 'seeking'
      | 'deals'
      | 'upcoming',
  ) {
    if (status === 'deals') {
      this.filtersChange.emit({
        ...this.filters(),
        ownership: 'seeking_or_unowned',
        deals_only: true,
      });
    } else if (status === 'upcoming') {
      this.filtersChange.emit({
        ...this.filters(),
        ownership: 'upcoming',
        deals_only: false,
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
    if (f.backup_status !== undefined && f.backup_status !== 'all') count++;
    if (f.physical_verified !== undefined && f.physical_verified !== 'all')
      count++;
    if (f.budget_label && f.budget_label !== 'all') count++;
    if (f.line) count++;
    if (f.type) count++;
    if (f.series) count++;
    if (f.tag) count++;
    if (
      f.ownership === 3 ||
      f.ownership === 0 ||
      f.ownership === 'seeking_or_unowned' ||
      f.ownership === 'home_region_and_owned'
    )
      count++;
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
      budget_label: 'all',
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

  public openNotificationSettings(): void {
    this.notificationService.openSettingsModal();
  }

  public closeNotificationSettings(): void {
    this.notificationService.closeSettingsModal();
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
  public totalValue = input<number>(0);
  public filters = input.required<FilterState>();
  public lastUpdated = input<Date | null>(null);
  public viewMode = input<ViewMode>('grid');

  /** --- Options Catalogues --- */
  readonly ownershipOptions: {
    value:
      | 'all'
      | 'seeking_or_unowned'
      | 'home_region_and_owned'
      | 1
      | 2
      | 3
      | 0;
    label: string;
  }[] = [
    { value: 'all', label: 'All' },
    { value: 'home_region_and_owned', label: 'Home Region & Owned' },
    { value: 'seeking_or_unowned', label: 'Seeking or Unowned' },
    { value: 1, label: 'Owned' },
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

  readonly sortByOptions = [
    { value: 'default', label: 'Default' },
    { value: 'release_desc', label: 'Release Date: Newest First' },
    { value: 'release_asc', label: 'Release Date: Oldest First' },
    { value: 'retail_asc', label: 'Lowest Retail Price' },
    { value: 'discount_desc', label: 'Deepest Sale Discount' },
    { value: 'value_desc', label: 'Value: High to Low' },
    { value: 'value_asc', label: 'Value: Low to High' },
  ];

  /** --- Formatted Currency Helper --- */
  public formatCurrency(cents: number | null | undefined): string {
    if (!cents || cents <= 0) return '$0.00';
    return (cents / 100).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
    });
  }

  private elementRef = inject(ElementRef);

  public filtersChange = output<FilterState>();
  public viewModeChange = output<ViewMode>();

  onViewModeSelect(mode: ViewMode) {
    if (this.viewMode() !== mode) {
      this.viewModeChange.emit(mode);
    }
  }

  /**
   * Emits a change event when a filter value is updated.
   * Handles string-to-boolean conversion for specialized inputs like 'seriesExact'
   * to maintain strict typing in the model layer.
   *
   * @param key The FilterState property to update.
   * @param value The new value for the property.
   */
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
    this.activeDropdown.set(null);
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
    const opt = this.sortByOptions.find((o) => o.value === val);
    return opt ? opt.label : 'Default';
  }

  getRegionLabel(): string {
    const selected = this.filters().regions || [];
    if (selected.length === 0) return 'All Regions';
    if (selected.length <= 2) return selected.join(', ');
    return `${selected.length} Selected`;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (
      !target.closest('.dropdown-wrapper') &&
      !target.closest('.combobox-wrapper')
    ) {
      this.closeDropdown();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.closeDropdown();
  }
}
