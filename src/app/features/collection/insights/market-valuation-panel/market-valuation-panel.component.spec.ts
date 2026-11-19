import '../../../../../test-setup';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { MarketValuationPanelComponent } from './market-valuation-panel.component';
import { CollectionService } from '../../../../core/services/collection.service';
import {
  EBAY_PRICE_TTL_MS,
  EphemeralMarketPrice,
  Game,
  JournalEntry,
  MarketPriceScanProgress,
  Platform,
  PlayStatus,
  Toy,
} from '../../../../core/models/collection.models';

describe('MarketValuationPanelComponent', () => {
  let fixture: ComponentFixture<MarketValuationPanelComponent>;
  let component: MarketValuationPanelComponent;

  const canViewMarketPrices = signal<boolean>(true);
  const marketPricingConfigured = signal<boolean | null>(true);
  const nowIso = '2026-11-18T12:15:00.000Z';
  const nowMs = Date.parse(nowIso);
  const marketPriceNowMs = signal<number>(nowMs);
  const marketPricesMap = signal<Map<string, EphemeralMarketPrice>>(new Map());
  const journalEntriesMap = signal<Map<string, JournalEntry>>(new Map());
  const scanProgress = signal<MarketPriceScanProgress>({
    active: false,
    scopeLabel: '',
    totalItems: 0,
    completedItems: 0,
    cacheHits: 0,
    fetchedCount: 0,
    errorCount: 0,
    rateLimited: false,
    cancelled: false,
    lastError: null,
  });

  const mockCollectionService = {
    canViewMarketPrices: canViewMarketPrices.asReadonly(),
    marketPricingConfigured: marketPricingConfigured.asReadonly(),
    marketPriceNowMs: marketPriceNowMs.asReadonly(),
    marketPricesMap: marketPricesMap.asReadonly(),
    journalEntriesMap: journalEntriesMap.asReadonly(),
    marketPriceScanProgress: scanProgress.asReadonly(),
    startCollectionValuationScan: vi.fn().mockResolvedValue(undefined),
    cancelCollectionValuationScan: vi.fn(),
    syncCachedMarketPrices: vi
      .fn()
      .mockResolvedValue({ configured: true, count: 0 }),
  };

  function makePrice(
    itemType: 'game' | 'toy',
    itemId: string,
    looseCents: number | null,
    cibCents: number | null,
    expired = false,
  ): EphemeralMarketPrice {
    const fetchedAtMs =
      nowMs - (expired ? EBAY_PRICE_TTL_MS + 60_000 : 300_000);
    return {
      item_type: itemType,
      item_id: itemId,
      loose_cents: looseCents,
      cib_cents: cibCents,
      new_cents: null,
      loose_sample_size: looseCents ? 5 : 0,
      cib_sample_size: cibCents ? 5 : 0,
      new_sample_size: 0,
      confidence: 'medium',
      source: 'ebay_browse',
      fetched_at: new Date(fetchedAtMs).toISOString(),
      expires_at: new Date(fetchedAtMs + EBAY_PRICE_TTL_MS).toISOString(),
      query_used: itemId,
      sample_listings: { loose: [], cib: [], new: [] },
    };
  }

  beforeEach(async () => {
    canViewMarketPrices.set(true);
    marketPricingConfigured.set(true);
    marketPriceNowMs.set(nowMs);
    marketPricesMap.set(new Map());
    journalEntriesMap.set(new Map());

    await TestBed.configureTestingModule({
      imports: [MarketValuationPanelComponent],
      providers: [
        provideRouter([]),
        { provide: CollectionService, useValue: mockCollectionService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MarketValuationPanelComponent);
    component = fixture.componentInstance;
  });

  it('computes combined Games + Toys valuation and strict matched-item Unrealized Gain/Loss', () => {
    const ownedGames: Game[] = [
      {
        stable_id: 1,
        id: 'rel-cib',
        game_id: 'g-cib',
        title: 'CIB Game',
        series: 'S',
        canonical_series: 'S',
        platform: 'SNES',
        platform_id: 15,
        ownership_status: 1,
        play_status: PlayStatus.Played,
        backup_status: 1,
        has_case: 1,
        has_manual: 1,
      },
      {
        stable_id: 2,
        id: 'rel-boxed',
        game_id: 'g-boxed',
        title: 'Boxed No Manual Game',
        series: 'S',
        canonical_series: 'S',
        platform: 'GameCube',
        platform_id: 20,
        ownership_status: 1,
        play_status: PlayStatus.Played,
        backup_status: 1,
        has_case: 1,
        has_manual: 0,
      },
      {
        stable_id: 3,
        id: 'rel-loose',
        game_id: 'g-loose',
        title: 'Loose Game',
        series: 'S',
        canonical_series: 'S',
        platform: 'SNES',
        platform_id: 15,
        ownership_status: 1,
        play_status: PlayStatus.Unplayed,
        backup_status: 0,
        has_case: 0,
        has_manual: 0,
      },
      {
        stable_id: 4,
        id: 'rel-expired',
        game_id: 'g-expired',
        title: 'Expired Game',
        series: 'S',
        canonical_series: 'S',
        platform: 'SNES',
        platform_id: 15,
        ownership_status: 1,
        play_status: PlayStatus.Unplayed,
        backup_status: 0,
      },
    ];

    const ownedToys: Toy[] = [
      {
        stable_id: 10,
        id: 'toy-mario',
        name: 'Mario Amiibo',
        line: 'amiibo',
        type: 'Figure',
        series_name: 'Super Mario',
        series_line: 'Super Mario',
        release_date: '2015-01-01',
        ownership_status: 1,
        image_url: '',
      },
    ];

    const platforms: Platform[] = [
      {
        id: 15,
        name: 'SNES',
        display_name: 'SNES',
        brand: 'Nintendo',
        launch_date: '1991-08-23',
        image_url: '',
      },
    ];

    marketPricesMap.set(
      new Map([
        ['game:g-cib', makePrice('game', 'g-cib', 2000, 5000)], // CIB -> $50.00
        ['game:g-boxed', makePrice('game', 'g-boxed', 2000, 4000)], // Boxed midpoint -> $30.00
        ['game:g-loose', makePrice('game', 'g-loose', 1500, 3500)], // Loose -> $15.00
        ['game:g-expired', makePrice('game', 'g-expired', 9900, 9900, true)], // Expired -> excluded!
        ['toy:toy-mario', makePrice('toy', 'toy-mario', 1200, null)], // Toy loose -> $12.00
      ]),
    );

    // Journal: g-cib paid $20, g-boxed paid $10, g-expired paid $999 (must NOT skew ROI), g-loose & toy have NO journal
    journalEntriesMap.set(
      new Map([
        [
          'game:g-cib',
          { id: 1, item_type: 'game', item_id: 'g-cib', price_paid: 20 },
        ],
        [
          'game:g-boxed',
          { id: 2, item_type: 'game', item_id: 'g-boxed', price_paid: 10 },
        ],
        [
          'game:g-expired',
          { id: 3, item_type: 'game', item_id: 'g-expired', price_paid: 999 },
        ],
      ]),
    );

    fixture.componentRef.setInput('ownedGames', ownedGames);
    fixture.componentRef.setInput('ownedToys', ownedToys);
    fixture.componentRef.setInput('platforms', platforms);
    fixture.detectChanges();

    const summary = component.valuationSummary();
    expect(summary.totalOwnedCount).toBe(5);
    expect(summary.pricedCount).toBe(4);
    expect(summary.coveragePct).toBe(80);
    // $50 + $30 + $15 + $12 = $107.00
    expect(summary.totalEstimatedCents).toBe(10700);
    // Matched ROI strictly on g-cib + g-boxed: ($50 + $30) - ($20 + $10) = +$50.00
    expect(summary.matchedCount).toBe(2);
    expect(summary.matchedCostBasisCents).toBe(3000);
    expect(summary.matchedEstimatedCents).toBe(8000);
    expect(summary.unrealizedDeltaCents).toBe(5000);

    const el = fixture.nativeElement as HTMLElement;
    expect(
      el.querySelector('[data-testid="estimated-total-value"]')?.textContent,
    ).toContain('$107.00');
    expect(
      el.querySelector('[data-testid="unrealized-gain-loss"]')?.textContent,
    ).toContain('+$50.00');
  });
});
