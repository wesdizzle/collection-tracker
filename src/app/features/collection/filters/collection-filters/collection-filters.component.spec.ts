import '../../../../../test-setup';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { SwPush } from '@angular/service-worker';
import { of } from 'rxjs';
import { CollectionFiltersComponent } from './collection-filters.component';
import { FilterState } from '../../../../core/models/collection.models';

/**
 * UNIT TEST: CollectionFiltersComponent
 *
 * Verifies that the filtering UI initializes correctly and can
 * communicate with the collection data layer.
 * Updated for Angular 21 and Vitest.
 */
describe('CollectionFiltersComponent', () => {
  let component: CollectionFiltersComponent;
  let fixture: ComponentFixture<CollectionFiltersComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CollectionFiltersComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: SwPush,
          useValue: { isEnabled: false, notificationClicks: of() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CollectionFiltersComponent);
    component = fixture.componentInstance;

    // Satisfy required high-performance signal inputs before initialization
    fixture.componentRef.setInput('currentTab', 'games');
    fixture.componentRef.setInput('filters', { ownership: 'all' });

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should display "Type" label for toys tab', () => {
    fixture.componentRef.setInput('currentTab', 'toys');
    fixture.detectChanges();

    const label = fixture.nativeElement.querySelector(
      'label[title*="Form factor"]',
    );
    expect(label).toBeTruthy();
    expect(label.textContent).toContain('Type');
  });

  it('should clear regions when clearRegions is called', () => {
    fixture.componentRef.setInput('filters', {
      ownership: 'all',
      regions: ['US', 'JP'],
    });
    fixture.detectChanges();

    let emittedFilters: FilterState | null = null;
    component.filtersChange.subscribe((f) => {
      emittedFilters = f;
    });

    component.clearRegions();
    expect(emittedFilters).toBeTruthy();
    expect(emittedFilters!.regions).toEqual([]);
  });

  it('should render physical verified filter on games tab and emit correct values on change', () => {
    fixture.componentRef.setInput('currentTab', 'games');
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector(
      '#filter-physical-verified',
    ) as HTMLSelectElement;
    expect(select).toBeTruthy();

    let emittedFilters: FilterState | null = null;
    component.filtersChange.subscribe((f) => {
      emittedFilters = f;
    });

    component.onPartialChange('physical_verified', 1);
    expect(emittedFilters).toBeTruthy();
    expect(emittedFilters!.physical_verified).toBe(1);

    component.onPartialChange('physical_verified', 0);
    expect(emittedFilters!.physical_verified).toBe(0);

    component.onPartialChange('physical_verified', 'all');
    expect(emittedFilters!.physical_verified).toBe('all');
  });

  it('should not render physical verified filter on toys tab', () => {
    fixture.componentRef.setInput('currentTab', 'toys');
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector(
      '#filter-physical-verified',
    );
    expect(select).toBeNull();
  });

  it('should render item count in count badge', () => {
    fixture.componentRef.setInput('resultCount', 42);
    fixture.detectChanges();

    const countBadge = fixture.nativeElement.querySelector('.count-badge');
    expect(countBadge).toBeTruthy();
    expect(countBadge.textContent.trim()).toBe('42 items');
  });

  it('should toggle deals_only and emit filter change when toggleDealsOnly is called', () => {
    let emittedFilters: FilterState | undefined;
    component.filtersChange.subscribe((f) => {
      emittedFilters = f;
    });

    component.toggleDealsOnly();
    expect(emittedFilters).toBeTruthy();
    expect(emittedFilters!.deals_only).toBe(true);

    fixture.componentRef.setInput('filters', {
      ownership: 'all',
      deals_only: true,
    });
    component.toggleDealsOnly();
    expect(emittedFilters!.deals_only).toBe(false);
  });

  it('should toggle retail_available and render retail/deals controls on both games and toys tabs', () => {
    let emittedFilters: FilterState | undefined;
    component.filtersChange.subscribe((f) => {
      emittedFilters = f;
    });

    component.toggleRetailAvailable();
    expect(emittedFilters?.retail_available).toBe(true);

    fixture.componentRef.setInput('currentTab', 'toys');
    fixture.componentRef.setInput('filters', {
      ownership: 'all',
      retail_available: true,
    });
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('#filter-retail-available'),
    ).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('#filter-deals-only'),
    ).toBeTruthy();
    expect(component.activeFilterCount()).toBe(1);
  });

  it('should render and select budget label status options', () => {
    expect(component.getBudgetLabelStatusLabel()).toBe('All');

    fixture.componentRef.setInput('filters', {
      ownership: 'all',
      budget_label: 'budget_only',
    });
    expect(component.getBudgetLabelStatusLabel()).toBe('Budget label only');

    fixture.componentRef.setInput('filters', {
      ownership: 'all',
      budget_label: 'standard_and_budget',
    });
    expect(component.getBudgetLabelStatusLabel()).toBe(
      'Standard and budget labels',
    );

    fixture.componentRef.setInput('filters', {
      ownership: 'all',
      budget_label: 'standard_only',
    });
    expect(component.getBudgetLabelStatusLabel()).toBe('Standard label only');

    let emittedFilters: FilterState | undefined;
    component.filtersChange.subscribe((f) => {
      emittedFilters = f;
    });

    component.selectOption('budget_label', 'budget_only');
    expect(emittedFilters?.budget_label).toBe('budget_only');
  });

  it('should render deals button with icon element and omit alerts button from filter bar', () => {
    const dealsBtn = fixture.nativeElement.querySelector('#filter-deals-only');
    expect(dealsBtn).toBeTruthy();
    expect(dealsBtn.querySelector('.deals-icon')).toBeTruthy();

    const alertsBtn = fixture.nativeElement.querySelector(
      '#filter-deal-alerts',
    );
    expect(alertsBtn).toBeNull();
  });

  it('should render view mode toggle buttons and emit viewModeChange on click', () => {
    fixture.componentRef.setInput('viewMode', 'grid');
    fixture.detectChanges();

    const viewToggles = fixture.nativeElement.querySelectorAll(
      '.view-toggle-group .view-toggle-btn',
    );
    expect(viewToggles.length).toBeGreaterThanOrEqual(2);

    const [gridBtn, compactBtn] = Array.from(
      viewToggles,
    ) as HTMLButtonElement[];
    expect(gridBtn.classList.contains('active')).toBe(true);
    expect(compactBtn.classList.contains('active')).toBe(false);

    let emittedMode: string | undefined;
    component.viewModeChange.subscribe((mode) => {
      emittedMode = mode;
    });

    compactBtn.click();
    expect(emittedMode).toBe('compact');

    fixture.componentRef.setInput('viewMode', 'compact');
    fixture.detectChanges();
    expect(compactBtn.classList.contains('active')).toBe(true);
    expect(gridBtn.classList.contains('active')).toBe(false);
  });

  it('should render quick toolbar in main row', () => {
    fixture.detectChanges();
    const toolbar = fixture.nativeElement.querySelector('.quick-toolbar');
    expect(toolbar).toBeTruthy();
  });

  it('should render quick status segmented buttons and activate Owned by default', () => {
    fixture.componentRef.setInput('filters', { ownership: 1 });
    fixture.detectChanges();

    expect(component.isOwnedActive()).toBe(true);
    expect(component.isAllActive()).toBe(false);
    expect(component.isSeekingActive()).toBe(false);

    const pills = Array.from(
      fixture.nativeElement.querySelectorAll('.status-pill-btn'),
    ) as HTMLButtonElement[];
    expect(pills.length).toBeGreaterThanOrEqual(3);
    const ownedPill = pills.find((p) => p.textContent?.includes('Owned'));
    expect(ownedPill).toBeTruthy();
    expect(ownedPill!.classList.contains('active')).toBe(true);
  });

  it('should emit filter changes when clicking quick status pills', () => {
    let emittedFilters: FilterState | undefined;
    component.filtersChange.subscribe((f) => {
      emittedFilters = f;
    });

    component.selectQuickStatus('all');
    expect(emittedFilters?.ownership).toBe('all');
    expect(emittedFilters?.deals_only).toBe(false);

    component.selectQuickStatus('seeking');
    expect(emittedFilters?.ownership).toBe(2);
    expect(emittedFilters?.deals_only).toBe(false);

    component.selectQuickStatus('deals');
    expect(emittedFilters?.ownership).toBe('seeking_or_unowned');
    expect(emittedFilters?.deals_only).toBe(true);

    component.selectQuickStatus('owned');
    expect(emittedFilters?.ownership).toBe(1);
    expect(emittedFilters?.deals_only).toBe(false);
  });

  it('should toggle secondary drawer and calculate activeFilterCount correctly', () => {
    expect(component.showDrawer()).toBe(false);
    expect(component.activeFilterCount()).toBe(0);

    const moreBtn = fixture.nativeElement.querySelector(
      '#toggle-more-filters',
    ) as HTMLButtonElement;
    expect(moreBtn).toBeTruthy();

    moreBtn.click();
    fixture.detectChanges();
    expect(component.showDrawer()).toBe(true);

    // Apply secondary filters
    fixture.componentRef.setInput('filters', {
      ownership: 1,
      platform_id: 4,
      play_status: 2,
    });
    fixture.detectChanges();
    expect(component.activeFilterCount()).toBe(2);

    const badge = fixture.nativeElement.querySelector('.filter-count-badge');
    expect(badge).toBeTruthy();
    expect(badge.textContent.trim()).toBe('2');
  });

  it('should emit filter change when quick search input changes or clears', () => {
    let emittedFilters: FilterState | undefined;
    component.filtersChange.subscribe((f) => {
      emittedFilters = f;
    });

    component.onQuickSearchChange('Metroid');
    expect(emittedFilters?.name).toBe('Metroid');

    component.clearQuickSearch();
    expect(emittedFilters?.name).toBe('');
  });

  it('should reset all filters to Owned default when resetFilters is invoked', () => {
    let emittedFilters: FilterState | undefined;
    component.filtersChange.subscribe((f) => {
      emittedFilters = f;
    });

    component.resetFilters();
    expect(emittedFilters).toBeTruthy();
    expect(emittedFilters?.ownership).toBe(1);
    expect(emittedFilters?.deals_only).toBe(false);
    expect(emittedFilters?.name).toBe('');
    expect(emittedFilters?.regions).toEqual([]);
  });

  it('should omit Disc / Cart filter dropdown and exclude has_media from activeFilterCount when showMediaDetails is false', () => {
    fixture.componentRef.setInput('filters', {
      ownership: 1,
      has_media: 1,
    });
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('#filter-has-media'),
    ).toBeTruthy();
    expect(component.activeFilterCount()).toBe(1);
    expect(component.mediaOwnedOptions.map((o) => o.label)).toEqual([
      'All',
      'Owned',
      'Missing',
    ]);

    fixture.componentRef.setInput('showMediaDetails', false);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#filter-has-media')).toBeNull();
    expect(component.activeFilterCount()).toBe(0);
  });

  it('should render provenance filters & sort options on both games and toys tabs only when showProvenanceFilters is true', () => {
    // Hidden by default (e.g., public / unauthenticated views)
    expect(
      fixture.nativeElement.querySelector('#filter-provenance-status'),
    ).toBeNull();
    expect(
      component.sortByOptions().some((opt) => opt.value === 'acquired_desc'),
    ).toBe(false);

    fixture.componentRef.setInput('showProvenanceFilters', true);
    fixture.componentRef.setInput('uniqueProvenanceSources', [
      'Best Buy',
      'Gift (Parents)',
    ]);
    fixture.componentRef.setInput('uniqueAcquiredYears', [2025, 2024]);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('#filter-provenance-status'),
    ).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('#filter-provenance-source'),
    ).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('#filter-acquired-year'),
    ).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('#filter-price-paid-min'),
    ).toBeTruthy();
    expect(
      component.sortByOptions().some((opt) => opt.value === 'acquired_desc'),
    ).toBe(true);

    // Also rendered on toys tab
    fixture.componentRef.setInput('currentTab', 'toys');
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('#filter-provenance-status'),
    ).toBeTruthy();

    // Active filter counting & clearing period
    fixture.componentRef.setInput('filters', {
      ownership: 1,
      provenance_status: 'recorded',
      provenance_source: 'Best Buy',
      acquired_year: 2025,
      acquired_from: '2025-01-01',
      acquired_to: '2025-03-31',
      price_paid_min: 10,
    });
    fixture.detectChanges();
    expect(component.activeFilterCount()).toBe(5);

    let emitted: FilterState | undefined;
    component.filtersChange.subscribe((f) => {
      emitted = f;
    });

    const clearPeriodBtn = fixture.nativeElement.querySelector(
      '#filter-clear-acquired-period',
    ) as HTMLButtonElement;
    expect(clearPeriodBtn).toBeTruthy();
    clearPeriodBtn.click();
    expect(emitted?.acquired_from).toBe('');
    expect(emitted?.acquired_to).toBe('');

    vi.useFakeTimers();
    try {
      component.onPricePaidInput('price_paid_max', '49.99');
      vi.advanceTimersByTime(150);
      expect(emitted?.price_paid_max).toBe(49.99);
    } finally {
      vi.useRealTimers();
    }

    component.resetFilters();
    expect(emitted?.provenance_status).toBe('all');
    expect(emitted?.provenance_source).toBe('');
    expect(emitted?.acquired_year).toBe('all');
    expect(emitted?.price_paid_min).toBeNull();
    expect(emitted?.price_paid_max).toBeNull();
  });

  it('should render Condition and Release Era dropdowns on games tab, count them when active, and reset them cleanly', () => {
    fixture.componentRef.setInput('currentTab', 'games');
    fixture.componentRef.setInput('filters', {
      ownership: 1,
      condition: 'cib',
      release_decade: '90s',
    });
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('#filter-condition'),
    ).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('#filter-release-decade'),
    ).toBeTruthy();
    expect(component.activeFilterCount()).toBe(2);

    let emitted: FilterState | undefined;
    component.filtersChange.subscribe((f) => {
      emitted = f;
    });

    component.selectOption('condition', 'loose');
    expect(emitted?.condition).toBe('loose');

    component.selectOption('release_decade', '00s');
    expect(emitted?.release_decade).toBe('00s');

    component.resetFilters();
    expect(emitted?.condition).toBe('all');
    expect(emitted?.release_decade).toBe('all');

    fixture.componentRef.setInput('currentTab', 'toys');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#filter-condition')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('#filter-release-decade'),
    ).toBeNull();
  });
});
