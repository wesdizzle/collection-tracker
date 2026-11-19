import '../../../../test-setup';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import {
  ActivatedRoute,
  Router,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { signal } from '@angular/core';
import { BehaviorSubject, of } from 'rxjs';
import { CollectionInsightsComponent } from './collection-insights.component';
import { CollectionService } from '../../../core/services/collection.service';
import {
  EBAY_PRICE_TTL_MS,
  EphemeralMarketPrice,
  Game,
  JournalEntry,
  Platform,
  PublicUserProfile,
  Toy,
} from '../../../core/models/collection.models';

describe('CollectionInsightsComponent', () => {
  let component: CollectionInsightsComponent;
  let fixture: ComponentFixture<CollectionInsightsComponent>;

  const mockGames = signal<Game[]>([]);
  const mockToys = signal<Toy[]>([]);
  const mockPlatforms = signal<Platform[]>([]);
  const mockIsAdmin = signal<boolean>(false);
  const mockIsAuthenticated = signal<boolean>(false);
  const mockIsPublicView = signal<boolean>(false);
  const mockPublicProfile = signal<PublicUserProfile | null>(null);
  const mockCanShowPersonalState = signal<boolean>(false);
  const mockJournalLoaded = signal<boolean>(false);
  const mockJournalEntriesMap = signal<Map<string, JournalEntry>>(new Map());
  const mockCanViewMarketPrices = signal<boolean>(false);
  const mockMarketPricingConfigured = signal<boolean | null>(true);
  const nowMs = Date.UTC(2026, 10, 19, 12, 0, 0);
  const mockMarketPriceNowMs = signal<number>(nowMs);
  const mockMarketPricesMap = signal<Map<string, EphemeralMarketPrice>>(
    new Map(),
  );

  const queryParamSubject = new BehaviorSubject(convertToParamMap({}));

  const mockCollectionService = {
    games: mockGames.asReadonly(),
    toys: mockToys.asReadonly(),
    platforms: mockPlatforms.asReadonly(),
    isAdmin: mockIsAdmin.asReadonly(),
    isAuthenticated: mockIsAuthenticated.asReadonly(),
    isPublicView: mockIsPublicView.asReadonly(),
    publicProfile: mockPublicProfile.asReadonly(),
    canShowPersonalState: mockCanShowPersonalState.asReadonly(),
    journalLoaded: mockJournalLoaded.asReadonly(),
    journalEntriesMap: mockJournalEntriesMap.asReadonly(),
    canViewMarketPrices: mockCanViewMarketPrices.asReadonly(),
    marketPricingConfigured: mockMarketPricingConfigured.asReadonly(),
    marketPriceNowMs: mockMarketPriceNowMs.asReadonly(),
    marketPricesMap: mockMarketPricesMap.asReadonly(),
    getTabRoute: (tab: string) =>
      mockIsPublicView() && mockPublicProfile()
        ? ['/u', mockPublicProfile()!.username, tab]
        : ['/collection', tab],
    refreshAll: async () => {},
    loadAllJournalEntries: () => of([]),
  };

  function makePrice(
    itemType: 'game' | 'toy',
    itemId: string,
    looseCents: number | null,
    cibCents: number | null,
  ): EphemeralMarketPrice {
    const fetchedMs = nowMs - 300_000;
    return {
      item_type: itemType,
      item_id: itemId,
      loose_cents: looseCents,
      cib_cents: cibCents,
      new_cents: null,
      loose_sample_size: looseCents ? 4 : 0,
      cib_sample_size: cibCents ? 4 : 0,
      new_sample_size: 0,
      confidence: 'medium',
      source: 'ebay_browse',
      fetched_at: new Date(fetchedMs).toISOString(),
      expires_at: new Date(fetchedMs + EBAY_PRICE_TTL_MS).toISOString(),
      query_used: itemId,
      sample_listings: { loose: [], cib: [], new: [] },
    };
  }

  beforeEach(async () => {
    mockGames.set([]);
    mockToys.set([]);
    mockPlatforms.set([]);
    mockIsAdmin.set(false);
    mockIsAuthenticated.set(false);
    mockIsPublicView.set(false);
    mockPublicProfile.set(null);
    mockCanShowPersonalState.set(false);
    mockJournalLoaded.set(false);
    mockJournalEntriesMap.set(new Map());
    mockCanViewMarketPrices.set(false);
    mockMarketPricingConfigured.set(true);
    mockMarketPricesMap.set(new Map());
    queryParamSubject.next(convertToParamMap({}));

    await TestBed.configureTestingModule({
      imports: [CollectionInsightsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: queryParamSubject.asObservable() },
        },
        { provide: CollectionService, useValue: mockCollectionService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CollectionInsightsComponent);
    component = fixture.componentInstance;
  });

  it('should create and handle empty collection with zero fallbacks', () => {
    fixture.detectChanges();

    expect(component).toBeTruthy();
    expect(component.activeSubTab()).toBe('overview');
    expect(component.playStatusStats().playedPct).toBe(0);
    expect(component.ownedGames().length).toBe(0);
    expect(component.ownedToys().length).toBe(0);
    expect(component.toyCompletionPct()).toBe(0);
    expect(component.backupRatePct()).toBe(0);
    expect(component.cibPct()).toBe(0);
    expect(component.platformStats().length).toBe(0);
    expect(component.topSeries().length).toBe(0);
  });

  it('should calculate play backlog progress (all 6 statuses), toy completion, condition breakdowns, and Overview audit actions', () => {
    mockIsAuthenticated.set(true);
    mockCanShowPersonalState.set(true);

    const testGames: Game[] = [
      {
        stable_id: 1,
        id: 'super-mario-world-snes',
        title: 'Super Mario World',
        series: 'Mario',
        canonical_series: 'Mario',
        release_date: '1990-11-21',
        platform: 'SNES',
        platform_id: 1,
        ownership_status: 1,
        play_status: 1, // Played
        backup_status: 1,
        has_case: 1,
        has_manual: 1,
      },
      {
        stable_id: 2,
        id: 'chrono-trigger-snes',
        title: 'Chrono Trigger',
        series: 'Chrono',
        canonical_series: 'Chrono',
        release_date: '1995-03-11',
        platform: 'SNES',
        platform_id: 1,
        ownership_status: 1,
        play_status: 2, // Playing
        backup_status: 0,
        has_case: 1,
        has_manual: 0, // Boxed only
      },
      {
        stable_id: 3,
        id: 'halo-ce-xbox',
        title: 'Halo: Combat Evolved',
        series: 'Halo',
        canonical_series: 'Halo',
        release_date: '2001-11-15',
        platform: 'Xbox',
        platform_id: 2,
        ownership_status: 1,
        play_status: 3, // Queued
        backup_status: 1,
        has_case: 0,
        has_manual: 0, // Loose
      },
      {
        stable_id: 4,
        id: 'paused-game',
        title: 'Paused Game',
        series: 'Mario',
        canonical_series: 'Mario',
        release_date: '2005-01-01',
        platform: 'SNES',
        platform_id: 1,
        ownership_status: 1,
        play_status: 4, // Paused
        backup_status: 1,
        has_case: 1,
        has_manual: 1,
      },
      {
        stable_id: 5,
        id: 'dropped-game',
        title: 'Dropped Game',
        series: 'Mario',
        canonical_series: 'Mario',
        release_date: '2008-01-01',
        platform: 'SNES',
        platform_id: 1,
        ownership_status: 1,
        play_status: 5, // Dropped
        backup_status: 1,
        has_case: 1,
        has_manual: 1,
      },
    ];

    const testToys: Toy[] = [
      {
        stable_id: 101,
        id: 'mario-amiibo',
        name: 'Mario',
        line: 'Super Smash Bros.',
        type: 'Figure',
        series_name: 'Smash',
        series_line: 'Smash',
        release_date: '2014-11-21',
        ownership_status: 1,
        image_url: '',
      },
      {
        stable_id: 102,
        id: 'link-amiibo',
        name: 'Link',
        line: 'Super Smash Bros.',
        type: 'Figure',
        series_name: 'Smash',
        series_line: 'Smash',
        release_date: '2014-11-21',
        ownership_status: 2, // Seeking
        image_url: '',
      },
    ];

    mockGames.set(testGames);
    mockToys.set(testToys);
    fixture.detectChanges();

    expect(component.playStatusStats().played).toBe(1);
    expect(component.playStatusStats().playing).toBe(1);
    expect(component.playStatusStats().queued).toBe(1);
    expect(component.playStatusStats().paused).toBe(1);
    expect(component.playStatusStats().dropped).toBe(1);
    expect(component.playStatusStats().playedPct).toBe(20);

    expect(component.ownedToys().length).toBe(1);
    expect(component.catalogToysCount()).toBe(2);
    expect(component.toyCompletionPct()).toBe(50);
    expect(component.seekingToysCount()).toBe(1);

    expect(component.cibCount()).toBe(3);
    expect(component.boxedOnlyCount()).toBe(1);
    expect(component.looseCount()).toBe(1);

    const el = fixture.nativeElement as HTMLElement;
    const backupKpi = el.querySelector(
      'a[data-testid="kpi-backup-card"]',
    ) as HTMLAnchorElement;
    expect(backupKpi?.getAttribute('href')).toContain('/collection/backups');
    expect(
      el.querySelector('[data-testid="insights-audit-strip"]'),
    ).toBeTruthy();
    expect(
      el.querySelector('[data-testid="audit-missing-backups"]'),
    ).toBeTruthy();
    expect(
      el.querySelector('[data-testid="audit-missing-provenance"]'),
    ).toBeTruthy();
    expect(el.querySelector('[data-testid="audit-loose-games"]')).toBeTruthy();

    // Switch to Catalog & Stats tab and verify 6 play status chips + clickable drill-downs
    component.setActiveSubTab('catalog');
    fixture.detectChanges();

    const playChips = el.querySelectorAll(
      '[data-testid="insights-play-status-link"]',
    );
    expect(playChips.length).toBe(6);

    const conditionLinks = el.querySelectorAll(
      '[data-testid="insights-condition-link"]',
    );
    expect(conditionLinks.length).toBe(3);
    expect(conditionLinks[0].getAttribute('href')).toContain('reset=1');
    expect(conditionLinks[0].getAttribute('href')).toContain('condition=cib');

    const seriesLinks = el.querySelectorAll(
      '[data-testid="insights-series-link"]',
    );
    expect(seriesLinks.length).toBe(3);
    expect(seriesLinks[0].getAttribute('href')).toContain('series=Mario');
    expect(seriesLinks[0].getAttribute('href')).toContain('series_exact=1');
  });

  it('defaults platform list to owned-only in Catalog & Stats and supports toggle, brand filter, sorting, and toy line completion', () => {
    const testPlatforms: Platform[] = [
      {
        id: 1,
        name: 'SNES',
        display_name: 'Super Nintendo',
        brand: 'Nintendo',
        launch_date: '1990-11-21',
        image_url: '',
      },
      {
        id: 2,
        name: 'PS1',
        display_name: 'PlayStation',
        brand: 'Sony',
        launch_date: '1995-09-09',
        image_url: '',
      },
    ];

    const testGames: Game[] = [
      {
        stable_id: 1,
        id: 'smw',
        title: 'Super Mario World',
        series: 'Mario',
        canonical_series: 'Mario',
        release_date: '1990-11-21',
        platform: 'SNES',
        platform_id: 1,
        ownership_status: 1,
        play_status: 0,
        backup_status: 1,
      },
      {
        stable_id: 2,
        id: 'fzero',
        title: 'F-Zero',
        series: 'F-Zero',
        canonical_series: 'F-Zero',
        release_date: '1990-11-21',
        platform: 'SNES',
        platform_id: 1,
        ownership_status: 0,
        play_status: 0,
        backup_status: 0,
      },
      {
        stable_id: 3,
        id: 'ff7',
        title: 'Final Fantasy VII',
        series: 'Final Fantasy',
        canonical_series: 'Final Fantasy',
        release_date: '1997-01-31',
        platform: 'PS1',
        platform_id: 2,
        ownership_status: 0, // unowned platform!
        play_status: 0,
        backup_status: 0,
      },
    ];

    const testToys: Toy[] = [
      {
        stable_id: 101,
        id: 'mario-amiibo',
        name: 'Mario',
        line: 'amiibo',
        type: 'Figure',
        series_name: 'Super Mario',
        series_line: 'Super Mario',
        release_date: '2015-03-20',
        ownership_status: 1,
        image_url: '',
      },
      {
        stable_id: 102,
        id: 'luigi-amiibo',
        name: 'Luigi',
        line: 'amiibo',
        type: 'Figure',
        series_name: 'Super Mario',
        series_line: 'Super Mario',
        release_date: '2015-03-20',
        ownership_status: 0,
        image_url: '',
      },
    ];

    mockPlatforms.set(testPlatforms);
    mockGames.set(testGames);
    mockToys.set(testToys);
    component.setActiveSubTab('catalog');
    fixture.detectChanges();

    // Owned-only default excludes PlayStation (0 owned)
    expect(component.filteredPlatformStats().map((p) => p.id)).toEqual([1]);

    // Toggling "Show unowned catalog platforms" reveals PlayStation
    const checkbox = fixture.nativeElement.querySelector(
      '[data-testid="insights-show-all-platforms-checkbox"]',
    ) as HTMLInputElement;
    checkbox.click();
    fixture.detectChanges();
    expect(component.filteredPlatformStats().map((p) => p.id)).toEqual([1, 2]);

    // Brand filter narrows to Sony
    component.selectedBrand.set('Sony');
    fixture.detectChanges();
    expect(component.filteredPlatformStats().map((p) => p.id)).toEqual([2]);

    // Platform rows do not render the old ROM backup footer text
    const platEl = fixture.nativeElement.querySelector(
      '[data-testid="insights-platforms-panel"]',
    ) as HTMLElement;
    expect(platEl.textContent).not.toContain('ROM Backups:');

    // Toy Line & Series panel renders amiibo completion and drill-down links
    const toyPanel = fixture.nativeElement.querySelector(
      '[data-testid="insights-toy-lines-panel"]',
    ) as HTMLElement;
    expect(toyPanel).toBeTruthy();
    expect(toyPanel.textContent).toContain('amiibo');
    const toyLineLink = toyPanel.querySelector(
      '[data-testid="insights-toy-line-link"]',
    ) as HTMLAnchorElement;
    expect(toyLineLink?.getAttribute('href')).toContain('/collection/toys');
    expect(toyLineLink?.getAttribute('href')).toContain('line=amiibo');
  });

  it('should deduplicate multi-disc releases in ownedGames while preserving physical backup tracking in ownedReleases', () => {
    const multiDiscGames: Game[] = [
      {
        stable_id: 10,
        game_id: 'ffvii-ps1',
        id: 'ffvii-disc-1',
        title: 'Final Fantasy VII (Disc 1)',
        series: 'Final Fantasy',
        canonical_series: 'Final Fantasy',
        platform: 'PS1',
        platform_id: 1,
        ownership_status: 1,
        play_status: 1,
        backup_status: 1,
        has_case: 1,
        has_manual: 0,
        release_date: '1997-01-31',
      },
      {
        stable_id: 11,
        game_id: 'ffvii-ps1',
        id: 'ffvii-disc-2',
        title: 'Final Fantasy VII (Disc 2)',
        series: 'Final Fantasy',
        canonical_series: 'Final Fantasy',
        platform: 'PS1',
        platform_id: 1,
        ownership_status: 1,
        play_status: 1,
        backup_status: 1,
        has_case: 1,
        has_manual: 0,
        release_date: '1997-01-31',
      },
      {
        stable_id: 12,
        game_id: 'ffvii-ps1',
        id: 'ffvii-disc-3',
        title: 'Final Fantasy VII (Disc 3)',
        series: 'Final Fantasy',
        canonical_series: 'Final Fantasy',
        platform: 'PS1',
        platform_id: 1,
        ownership_status: 1,
        play_status: 1,
        backup_status: 0,
        has_case: 1,
        has_manual: 0,
        release_date: '1997-01-31',
      },
    ];

    mockGames.set(multiDiscGames);
    component.setActiveSubTab('catalog');
    fixture.detectChanges();

    expect(component.ownedReleases().length).toBe(3);
    expect(component.ownedGames().length).toBe(1);
    expect(component.physicalOwnedGames().length).toBe(3);
    expect(component.backedUpOwnedGames().length).toBe(2);
    expect(fixture.nativeElement.innerHTML).toContain(
      'Game + Box / Case (No Manual)',
    );
  });

  it('should render Value & Ledger tab with unified scope across cost basis, live valuation, growth chart, and sources; omit when unauthenticated', () => {
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    mockIsAuthenticated.set(true);
    mockIsAdmin.set(true);
    mockCanShowPersonalState.set(true);
    mockCanViewMarketPrices.set(true);

    mockPlatforms.set([
      {
        id: 1,
        name: 'SNES',
        display_name: 'SNES',
        brand: 'Nintendo',
        launch_date: '1990-11-21',
        image_url: '',
      },
      {
        id: 2,
        name: 'Switch',
        display_name: 'Switch',
        brand: 'Nintendo',
        launch_date: '2017-03-03',
        image_url: '',
      },
    ]);

    mockGames.set([
      {
        stable_id: 1,
        id: 'chrono-trigger-snes',
        game_id: 'chrono-trigger-snes',
        title: 'Chrono Trigger',
        series: 'Chrono',
        canonical_series: 'Chrono',
        release_date: '1995-03-11',
        platform: 'SNES',
        platform_id: 1,
        ownership_status: 1,
        play_status: 1,
        backup_status: 1,
        has_case: 1,
        has_manual: 1,
      },
      {
        stable_id: 2,
        id: 'smw-snes',
        game_id: 'smw-snes',
        title: 'Super Mario World',
        series: 'Mario',
        canonical_series: 'Mario',
        release_date: '1990-11-21',
        platform: 'SNES',
        platform_id: 1,
        ownership_status: 1,
        play_status: 1,
        backup_status: 1,
        has_case: 1,
        has_manual: 1,
      },
      {
        stable_id: 3,
        id: 'botw-switch',
        game_id: 'botw-switch',
        title: 'Zelda: Breath of the Wild',
        series: 'Zelda',
        canonical_series: 'Zelda',
        release_date: '2017-03-03',
        platform: 'Switch',
        platform_id: 2,
        ownership_status: 1,
        play_status: 1,
        backup_status: 1,
        has_case: 1,
        has_manual: 1,
      },
    ]);

    const entries = new Map<string, JournalEntry>([
      [
        'game:chrono-trigger-snes',
        {
          id: 1,
          item_type: 'game',
          item_id: 'chrono-trigger-snes',
          purchase_date: '2018-05-10',
          is_approximate_date: 0,
          price_paid: 120.0,
          merchant: 'eBay',
        },
      ],
      [
        'game:smw-snes',
        {
          id: 2,
          item_type: 'game',
          item_id: 'smw-snes',
          purchase_date: '2019-06-01',
          is_approximate_date: 0,
          price_paid: 40.0,
          merchant: 'eBay',
        },
      ],
      [
        'game:botw-switch',
        {
          id: 3,
          item_type: 'game',
          item_id: 'botw-switch',
          purchase_date: '2020-02-01',
          is_approximate_date: 0,
          price_paid: 50.0,
          merchant: 'Best Buy',
        },
      ],
    ]);
    mockJournalEntriesMap.set(entries);

    mockMarketPricesMap.set(
      new Map([
        [
          'game:chrono-trigger-snes',
          makePrice('game', 'chrono-trigger-snes', 20000, 32000),
        ],
      ]),
    );

    queryParamSubject.next(convertToParamMap({ tab: 'value' }));
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(component.activeSubTab()).toBe('value');

    const revealed = compiled.querySelector(
      '[data-testid="insights-journal-revealed"]',
    );
    expect(revealed).toBeTruthy();
    expect(revealed?.textContent).toContain('$210.00');
    expect(revealed?.textContent).toContain('3 / 3');

    // Growth chart hides duplicate scope select & KPI strip when embedded in Value & Ledger
    expect(
      compiled.querySelector('[data-testid="collection-growth-chart-panel"]'),
    ).toBeTruthy();
    expect(
      compiled.querySelector('[data-testid="growth-scope-select"]'),
    ).toBeNull();
    expect(
      compiled.querySelector('[data-testid="growth-kpi-strip"]'),
    ).toBeNull();
    expect(
      compiled.querySelector('[data-testid="market-valuation-toolbar"]'),
    ).toBeTruthy();

    // Changing unified scope updates cost basis, valuation, growth chart, and merchants together
    component.onLedgerScopeChange('platform:1');
    fixture.detectChanges();

    expect(revealed?.textContent).toContain('$160.00');
    expect(revealed?.textContent).toContain('$80.00');
    expect(revealed?.textContent).toContain('2 / 2');
    expect(component.scopedValuationSummary().totalEstimatedCents).toBe(32000);
    expect(
      component.scopedJournalSummary().allMerchants.map((m) => m.name),
    ).toEqual(['eBay']);

    const coverageLink = compiled.querySelector(
      'a[data-testid="insights-provenance-coverage-link"]',
    ) as HTMLAnchorElement;
    expect(coverageLink.getAttribute('href')).toContain('reset=1');
    expect(coverageLink.getAttribute('href')).toContain(
      'provenance_status=recorded',
    );
    expect(coverageLink.getAttribute('href')).toContain('platform_id=1');

    const sourceLink = compiled.querySelector(
      'a[data-testid="insights-source-link"]',
    ) as HTMLAnchorElement;
    expect(sourceLink.getAttribute('href')).toContain('provenance_source=eBay');
    expect(sourceLink.getAttribute('href')).toContain('provenance_exact=1');

    // Unauthenticated: Value & Ledger tab disappears and ?tab=value falls back to Overview
    mockIsAuthenticated.set(false);
    mockIsAdmin.set(false);
    mockCanShowPersonalState.set(false);
    mockCanViewMarketPrices.set(false);
    fixture.detectChanges();

    expect(component.activeSubTab()).toBe('overview');
    expect(
      compiled.querySelector('[data-testid="insights-tab-value"]'),
    ).toBeNull();
    expect(
      compiled.querySelector('[data-testid="insights-journal-panel"]'),
    ).toBeNull();
    expect(
      compiled.querySelector('[data-testid="collection-growth-chart-panel"]'),
    ).toBeNull();
  });

  it('calculates decadeDistribution across historical eras and renders clickable era drill-downs', () => {
    const testGames: Game[] = [
      {
        stable_id: 1,
        id: 'g-nes',
        title: 'Super Mario Bros.',
        series: 'Mario',
        canonical_series: 'Mario',
        platform: 'NES',
        platform_id: 1,
        play_status: 1,
        release_date: '1985-09-13',
        ownership_status: 1,
        backup_status: 1,
      },
      {
        stable_id: 2,
        id: 'g-snes',
        title: 'Super Mario World',
        series: 'Mario',
        canonical_series: 'Mario',
        platform: 'SNES',
        platform_id: 2,
        play_status: 1,
        release_date: '1990-11-21',
        ownership_status: 1,
        backup_status: 1,
      },
      {
        stable_id: 3,
        id: 'g-gc',
        title: 'Super Mario Sunshine',
        series: 'Mario',
        canonical_series: 'Mario',
        platform: 'GameCube',
        platform_id: 3,
        play_status: 1,
        release_date: '2002-08-26',
        ownership_status: 1,
        backup_status: 1,
      },
      {
        stable_id: 4,
        id: 'g-wiiu',
        title: 'Super Mario 3D World',
        series: 'Mario',
        canonical_series: 'Mario',
        platform: 'Wii U',
        platform_id: 4,
        play_status: 1,
        release_date: '2013-11-22',
        ownership_status: 1,
        backup_status: 1,
      },
      {
        stable_id: 5,
        id: 'g-switch',
        title: 'Super Mario Bros. Wonder',
        series: 'Mario',
        canonical_series: 'Mario',
        platform: 'Nintendo Switch',
        platform_id: 5,
        play_status: 1,
        release_date: '2023-10-20',
        ownership_status: 1,
        backup_status: 1,
      },
    ];

    mockGames.set(testGames);
    component.setActiveSubTab('catalog');
    fixture.detectChanges();

    const decades = component.decadeDistribution();
    expect(decades.length).toBe(5);
    expect(decades.find((d) => d.decade === '70s_80s')?.count).toBe(1);
    expect(decades.find((d) => d.decade === '20s')?.pct).toBe(20);

    const eraLinks = fixture.nativeElement.querySelectorAll(
      '[data-testid="insights-decade-link"]',
    ) as NodeListOf<HTMLAnchorElement>;
    expect(eraLinks.length).toBe(5);
    expect(eraLinks[0].getAttribute('href')).toContain(
      'release_decade=70s_80s',
    );
    expect(eraLinks[0].getAttribute('href')).toContain('reset=1');
  });

  it('enforces strict privacy and public /u/:username drill-down links when viewing public stats even as authenticated admin', async () => {
    const journalSpy = vi.spyOn(mockCollectionService, 'loadAllJournalEntries');

    mockIsPublicView.set(true);
    mockPublicProfile.set({
      username: 'alice',
      displayName: 'Alice',
      bio: null,
      homeRegion: 'USA',
    });
    mockIsAuthenticated.set(true);
    mockIsAdmin.set(true);
    mockCanViewMarketPrices.set(true);
    mockCanShowPersonalState.set(true);

    mockPlatforms.set([
      {
        id: 1,
        name: 'GameCube',
        display_name: 'GameCube',
        brand: 'Nintendo',
        launch_date: '2001-09-14',
        image_url: '',
      },
    ]);
    mockGames.set([
      {
        stable_id: 10,
        id: 'g-pub',
        game_id: 'g-pub',
        title: 'Paper Mario',
        series: 'Mario',
        canonical_series: 'Mario',
        platform: 'GameCube',
        platform_id: 1,
        play_status: 1,
        release_date: '2004-10-11',
        ownership_status: 1,
        has_case: 1,
        has_manual: 1,
        backup_status: 0,
      },
      {
        stable_id: 11,
        id: 'g-pub-2',
        game_id: 'g-pub-2',
        title: 'Wind Waker',
        series: 'Zelda',
        canonical_series: 'Zelda',
        platform: 'GameCube',
        platform_id: 1,
        play_status: 2,
        release_date: '2003-03-24',
        ownership_status: 0,
        backup_status: 0,
      },
    ]);
    mockToys.set([
      {
        stable_id: 201,
        id: 't-pub',
        name: 'Mario Amiibo',
        line: 'Amiibo',
        type: 'Figure',
        series_name: 'Super Mario',
        series_line: 'Amiibo',
        release_date: '2014-11-21',
        ownership_status: 1,
        image_url: '',
      },
    ]);

    const journalMap = new Map<string, JournalEntry>();
    journalMap.set('game:g-pub', {
      id: 1,
      item_type: 'game',
      item_id: 'g-pub',
      purchase_date: '2024-03-01',
      is_approximate_date: 0,
      price_paid: 45,
      merchant: 'Secret eBay Seller',
      gifted_by: null,
      receipt_url: null,
      notes: null,
    });
    mockJournalEntriesMap.set(journalMap);

    const pricesMap = new Map<string, EphemeralMarketPrice>();
    pricesMap.set('game:g-pub', makePrice('game', 'g-pub', 8000, 9500));
    mockMarketPricesMap.set(pricesMap);

    queryParamSubject.next(convertToParamMap({ tab: 'value' }));
    fixture.detectChanges();
    await component.ngOnInit();
    fixture.detectChanges();

    expect(journalSpy).not.toHaveBeenCalled();
    expect(component.canShowProvenance()).toBe(false);
    expect(component.canViewMarketPrices()).toBe(false);
    expect(component.activeSubTab()).toBe('catalog');

    component.setActiveSubTab('value');
    expect(component.activeSubTab()).toBe('catalog');

    expect(
      component.platformSortOptions().some((o) => o.value === 'value'),
    ).toBe(false);
    component.onPlatformSortChange('value');
    expect(component.platformSort()).toBe('owned');

    const el = fixture.nativeElement as HTMLElement;
    expect(
      el.querySelector('[data-testid="public-stats-title"]')?.textContent,
    ).toContain("Alice's Collection Stats");
    expect(el.querySelector('[data-testid="insights-subtabs"]')).toBeNull();
    expect(
      el.querySelector('[data-testid="public-stats-kpi-grid"]'),
    ).toBeTruthy();

    const platformLink = el.querySelector(
      '[data-testid="insights-platform-link"]',
    ) as HTMLAnchorElement;
    expect(platformLink?.getAttribute('href')).toContain('/u/alice/games');
    const toyLineLink = el.querySelector(
      '[data-testid="insights-toy-line-link"]',
    ) as HTMLAnchorElement;
    expect(toyLineLink?.getAttribute('href')).toContain('/u/alice/toys');

    expect(el.querySelector('a[href*="/collection/games"]')).toBeNull();
    expect(el.querySelector('a[href*="/collection/toys"]')).toBeNull();
    expect(el.querySelector('a[href*="/collection/backups"]')).toBeNull();

    const renderedText = el.textContent || '';
    expect(renderedText).not.toContain('Value & Ledger');
    expect(renderedText).not.toContain('Backed Up');
    expect(renderedText).not.toContain('Secret eBay Seller');
    expect(renderedText).not.toContain('eBay');
    expect(renderedText).not.toContain('$');
  });
});
