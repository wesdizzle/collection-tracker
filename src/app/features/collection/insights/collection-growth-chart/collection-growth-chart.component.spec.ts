import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { CollectionGrowthChartComponent } from './collection-growth-chart.component';
import { CollectionService } from '../../../../core/services/collection.service';
import {
  EphemeralMarketPrice,
  Game,
  JournalEntry,
  OwnershipStatus,
  Platform,
  PlayStatus,
  Toy,
  getMarketPriceKey,
} from '../../../../core/models/collection.models';

describe('CollectionGrowthChartComponent', () => {
  let component: CollectionGrowthChartComponent;
  let fixture: ComponentFixture<CollectionGrowthChartComponent>;

  const nowMs = Date.UTC(2025, 4, 1, 12, 0, 0);
  const freshExpiresIso = new Date(nowMs + 5 * 60 * 60 * 1000).toISOString();
  const fetchedIso = new Date(nowMs - 10 * 60 * 1000).toISOString();

  const mockJournalEntriesMap = signal<Map<string, JournalEntry>>(new Map());
  const mockMarketPricesMap = signal<Map<string, EphemeralMarketPrice>>(
    new Map(),
  );
  const mockNowMs = signal<number>(nowMs);
  const mockCanViewMarketPrices = signal<boolean>(true);
  const mockMarketPricingConfigured = signal<boolean>(true);

  const mockCollectionService = {
    journalEntriesMap: mockJournalEntriesMap.asReadonly(),
    marketPricesMap: mockMarketPricesMap.asReadonly(),
    marketPriceNowMs: mockNowMs.asReadonly(),
    canViewMarketPrices: mockCanViewMarketPrices.asReadonly(),
    marketPricingConfigured: mockMarketPricingConfigured.asReadonly(),
  };

  const samplePlatforms: Platform[] = [
    {
      id: 1,
      name: 'Nintendo Switch',
      display_name: 'Switch',
      brand: 'Nintendo',
      launch_date: '2017-03-03',
      image_url: '',
    },
    {
      id: 2,
      name: 'SNES',
      display_name: 'SNES',
      brand: 'Nintendo',
      launch_date: '1990-11-21',
      image_url: '',
    },
  ];

  const sampleGames: Game[] = [
    {
      stable_id: 1,
      id: 'chrono-trigger-snes',
      game_id: 'chrono-trigger-snes',
      title: 'Chrono Trigger',
      series: 'Chrono',
      canonical_series: 'Chrono',
      platform: 'SNES',
      platform_id: 2,
      region: 'USA',
      ownership_status: OwnershipStatus.Owned,
      play_status: PlayStatus.Played,
      has_media: 1,
      has_case: 1,
      has_manual: 1,
    },
    {
      stable_id: 2,
      id: 'zelda-totk-switch',
      game_id: 'zelda-totk-switch',
      title: 'Zelda: Tears of the Kingdom',
      series: 'The Legend of Zelda',
      canonical_series: 'The Legend of Zelda',
      platform: 'Switch',
      platform_id: 1,
      region: 'USA',
      ownership_status: OwnershipStatus.Owned,
      play_status: PlayStatus.Played,
      has_media: 1,
      has_case: 1,
      has_manual: 0,
    },
    {
      stable_id: 3,
      id: 'undated-game-switch',
      game_id: 'undated-game-switch',
      title: 'Undated Switch Title',
      series: 'Misc',
      canonical_series: 'Misc',
      platform: 'Switch',
      platform_id: 1,
      region: 'USA',
      ownership_status: OwnershipStatus.Owned,
      play_status: PlayStatus.Queued,
      has_media: 0,
      has_case: 1,
      has_manual: 1,
    },
  ];

  const sampleToys: Toy[] = [
    {
      stable_id: 101,
      id: 'link-totk-amiibo',
      name: 'Link (Tears of the Kingdom)',
      line: 'Amiibo',
      type: 'Figure',
      series_name: 'The Legend of Zelda',
      series_line: 'Zelda',
      release_date: '2023-05-12',
      ownership_status: OwnershipStatus.Owned,
      region: 'USA',
      image_url: '',
    },
  ];

  const makeJournalEntry = (
    itemType: 'game' | 'toy',
    itemId: string,
    purchaseDate: string | null,
    pricePaid: number | null,
    isApprox = 0,
  ): JournalEntry => ({
    id: Math.floor(Math.random() * 10000),
    item_type: itemType,
    item_id: itemId,
    purchase_date: purchaseDate,
    is_approximate_date: isApprox,
    price_paid: pricePaid,
    merchant: 'eBay',
    gifted_by: null,
    receipt_url: null,
    notes: null,
  });

  const makeMarketPrice = (
    itemType: 'game' | 'toy',
    itemId: string,
    cibCents: number,
  ): EphemeralMarketPrice => ({
    item_type: itemType,
    item_id: itemId,
    loose_cents: Math.round(cibCents * 0.6),
    cib_cents: cibCents,
    new_cents: cibCents * 2,
    loose_sample_size: 4,
    cib_sample_size: 4,
    new_sample_size: 2,
    confidence: 'high',
    source: 'ebay_browse',
    fetched_at: fetchedIso,
    expires_at: freshExpiresIso,
    query_used: itemId,
    sample_listings: { loose: [], cib: [], new: [] },
  });

  beforeEach(async () => {
    const jMap = new Map<string, JournalEntry>();
    jMap.set(
      'game:chrono-trigger-snes',
      makeJournalEntry('game', 'chrono-trigger-snes', '2020-04-10', 100, 1),
    );
    jMap.set(
      'game:zelda-totk-switch',
      makeJournalEntry('game', 'zelda-totk-switch', '2023-05-12', 60, 0),
    );
    jMap.set(
      'toy:link-totk-amiibo',
      makeJournalEntry('toy', 'link-totk-amiibo', '2023-06-01', 20, 0),
    );
    mockJournalEntriesMap.set(jMap);
    mockMarketPricesMap.set(new Map());
    mockNowMs.set(nowMs);
    mockCanViewMarketPrices.set(true);
    mockMarketPricingConfigured.set(true);

    await TestBed.configureTestingModule({
      imports: [CollectionGrowthChartComponent],
      providers: [
        provideRouter([]),
        { provide: CollectionService, useValue: mockCollectionService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CollectionGrowthChartComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('ownedGames', sampleGames);
    fixture.componentRef.setInput('ownedToys', sampleToys);
    fixture.componentRef.setInput('platforms', samplePlatforms);
    fixture.detectChanges();
  });

  it('creates chart in cumulative line mode by default and switches to period bar mode', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(component).toBeTruthy();
    expect(component.chartMode()).toBe('line');
    expect(el.querySelector('kit-time-series-chart')).toBeTruthy();
    expect(
      el.querySelector('[data-testid="growth-kpi-strip"]')?.textContent,
    ).toContain('$180.00');
    expect(
      el.querySelector('[data-testid="growth-kpi-strip"]')?.textContent,
    ).toContain('3 / 4');

    const periodBtn = el.querySelector(
      '[data-testid="growth-mode-period"]',
    ) as HTMLButtonElement;
    periodBtn.click();
    fixture.detectChanges();

    expect(component.viewMode()).toBe('period');
    expect(component.chartMode()).toBe('bar');
    expect(component.chartDiffBand()).toBeNull();
    expect(
      component.chartSeries().find((s) => s.id === 'cost_basis')?.label,
    ).toBe('Period Spend');
  });

  it('switches scopes across all_owned, games_only, toys_only, and platform:<id> via kit-select controls', () => {
    const el = fixture.nativeElement as HTMLElement;
    const selectScopeOption = (optionLabel: string) => {
      const trigger = el.querySelector(
        '#growth-scope-select',
      ) as HTMLButtonElement;
      expect(trigger).toBeTruthy();
      trigger.click();
      fixture.detectChanges();
      const scopeHost = el.querySelector('[data-testid="growth-scope-select"]');
      const items = Array.from(
        scopeHost?.querySelectorAll('.dropdown-item') || [],
      ) as HTMLButtonElement[];
      const match = items.find((btn) => btn.textContent?.includes(optionLabel));
      expect(match).toBeTruthy();
      match!.click();
      fixture.detectChanges();
    };

    selectScopeOption('Toys Only (1)');
    expect(component.selectedScope()).toBe('toys_only');
    expect(component.growthData().summary.totalOwnedInScope).toBe(1);
    expect(component.growthData().summary.latestCumulativeCostBasisCents).toBe(
      2000,
    );
    expect(component.missingDateRoute()).toEqual(['/collection/toys']);

    selectScopeOption('Games Only (3)');
    expect(component.selectedScope()).toBe('games_only');
    expect(component.growthData().summary.totalOwnedInScope).toBe(3);
    expect(component.growthData().summary.datedItemCount).toBe(2);
    expect(component.growthData().summary.undatedItemCount).toBe(1);

    selectScopeOption('SNES (1)');
    expect(component.selectedScope()).toBe('platform:2');
    expect(component.growthData().summary.totalOwnedInScope).toBe(1);
    expect(component.growthData().summary.latestCumulativeCostBasisCents).toBe(
      10000,
    );
    expect(component.missingDateQueryParams()['platform_id']).toBe(2);

    // Granularity & Time Range kit-select dropdowns update signals cleanly
    const granularityTrigger = el.querySelector(
      '#growth-granularity-select',
    ) as HTMLButtonElement;
    granularityTrigger.click();
    fixture.detectChanges();
    const granHost = el.querySelector(
      '[data-testid="growth-granularity-select"]',
    );
    const byYearBtn = Array.from(
      granHost?.querySelectorAll('.dropdown-item') || [],
    ).find((b) => b.textContent?.includes('By Year')) as HTMLButtonElement;
    expect(byYearBtn).toBeTruthy();
    byYearBtn.click();
    fixture.detectChanges();
    expect(component.granularity()).toBe('year');

    const rangeTrigger = el.querySelector(
      '#growth-range-select',
    ) as HTMLButtonElement;
    rangeTrigger.click();
    fixture.detectChanges();
    const rangeHost = el.querySelector('[data-testid="growth-range-select"]');
    const fiveYBtn = Array.from(
      rangeHost?.querySelectorAll('.dropdown-item') || [],
    ).find((b) => b.textContent?.includes('Last 5 Years')) as HTMLButtonElement;
    expect(fiveYBtn).toBeTruthy();
    fiveYBtn.click();
    fixture.detectChanges();
    expect(component.timeRange()).toBe('5y');
  });

  it('disables current_value series when no fresh comps exist and enables series + diffBand with fresh <6h eBay prices', () => {
    const disabledValSeries = component
      .chartSeries()
      .find((s) => s.id === 'current_value');
    expect(disabledValSeries?.disabled).toBe(true);
    expect(disabledValSeries?.disabledHint).toContain('Scan live eBay prices');
    expect(component.chartDiffBand()).toBeNull();

    const mMap = new Map<string, EphemeralMarketPrice>();
    mMap.set(
      getMarketPriceKey('game', 'chrono-trigger-snes'),
      makeMarketPrice('game', 'chrono-trigger-snes', 25000),
    );
    mMap.set(
      getMarketPriceKey('game', 'zelda-totk-switch'),
      makeMarketPrice('game', 'zelda-totk-switch', 7000),
    );
    mockMarketPricesMap.set(mMap);
    fixture.detectChanges();

    const activeValSeries = component
      .chartSeries()
      .find((s) => s.id === 'current_value');
    expect(activeValSeries?.disabled).toBe(false);
    expect(component.chartDiffBand()).toEqual({
      upperSeriesId: 'current_value',
      lowerSeriesId: 'cost_basis',
    });
    const kpiText = fixture.nativeElement.querySelector(
      '[data-testid="growth-kpi-strip"]',
    )?.textContent;
    expect(kpiText).toContain('$306.00');
    expect(kpiText).toContain('+$146.00');
  });

  it('shows empty state when no dated items remain and handles approx date filter toggle', () => {
    // Filter out zelda & link by excluding approximate dates? Wait: only chrono has approx=1.
    // Test empty collection scope first
    fixture.componentRef.setInput('ownedGames', []);
    fixture.componentRef.setInput('ownedToys', []);
    fixture.detectChanges();

    expect(component.growthData().buckets.length).toBe(0);
    expect(component.emptyStateMessage()).toContain('Add owned items');

    // Approximate date exclusion message
    fixture.componentRef.setInput('ownedGames', [sampleGames[0]]);
    fixture.detectChanges();
    const approxCheckbox = fixture.nativeElement.querySelector(
      '[data-testid="growth-include-approx-checkbox"]',
    ) as HTMLInputElement;
    approxCheckbox.click();
    fixture.detectChanges();

    expect(component.includeApproximateDates()).toBe(false);
    expect(component.growthData().buckets.length).toBe(0);
    expect(component.emptyStateMessage()).toContain('approximate dates');
  });

  it('renders undated coverage link and navigates with drill-down query params on bucket click', () => {
    const router = TestBed.inject(Router);
    const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const missingLink = fixture.nativeElement.querySelector(
      '[data-testid="growth-missing-date-link"]',
    ) as HTMLAnchorElement;
    expect(missingLink).toBeTruthy();
    expect(missingLink.textContent).toContain('1 undated item');

    const targetPoint = component.chartPoints()[0];
    const bucket = component.asBucket(targetPoint.meta)!;
    component.onBucketClick(targetPoint);

    expect(navSpy).toHaveBeenCalledWith(['/collection/games'], {
      queryParams: {
        reset: 1,
        ownership: 1,
        provenance_status: 'all',
        acquired_from: bucket.drillFromIso,
        acquired_to: bucket.drillToIso,
      },
    });

    // Platform scope carries platform_id
    component.selectedScope.set('platform:2');
    fixture.detectChanges();
    component.onBucketClick(component.chartPoints()[0]);
    expect(navSpy).toHaveBeenLastCalledWith(['/collection/games'], {
      queryParams: {
        reset: 1,
        ownership: 1,
        provenance_status: 'all',
        acquired_from: component.asBucket(component.chartPoints()[0].meta)!
          .drillFromIso,
        acquired_to: component.asBucket(component.chartPoints()[0].meta)!
          .drillToIso,
        platform_id: 2,
      },
    });

    // Toys-only scope routes to /collection/toys
    component.selectedScope.set('toys_only');
    fixture.detectChanges();
    const toyPoint = component.chartPoints()[0];
    component.onBucketClick(toyPoint);
    expect(navSpy).toHaveBeenLastCalledWith(['/collection/toys'], {
      queryParams: {
        reset: 1,
        ownership: 1,
        provenance_status: 'all',
        acquired_from: component.asBucket(toyPoint.meta)!.drillFromIso,
        acquired_to: component.asBucket(toyPoint.meta)!.drillToIso,
      },
    });
  });

  it('supports controlled externalScope, hideScopeSelect, and hideKpiStrip inputs', () => {
    fixture.componentRef.setInput('externalScope', 'platform:2');
    fixture.componentRef.setInput('hideScopeSelect', true);
    fixture.componentRef.setInput('hideKpiStrip', true);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="growth-scope-select"]')).toBeNull();
    expect(el.querySelector('[data-testid="growth-kpi-strip"]')).toBeNull();
    expect(component.effectiveScope()).toBe('platform:2');
    expect(component.growthData().summary.totalOwnedInScope).toBe(1);
    expect(component.growthData().summary.latestCumulativeCostBasisCents).toBe(
      10000,
    );
  });
});
