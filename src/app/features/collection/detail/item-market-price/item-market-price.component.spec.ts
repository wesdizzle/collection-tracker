import '../../../../../test-setup';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ItemMarketPriceComponent } from './item-market-price.component';
import { CollectionService } from '../../../../core/services/collection.service';
import {
  EBAY_PRICE_TTL_MS,
  EphemeralMarketPrice,
  Game,
  JournalEntry,
  PlayStatus,
} from '../../../../core/models/collection.models';

describe('ItemMarketPriceComponent', () => {
  let fixture: ComponentFixture<ItemMarketPriceComponent>;
  let component: ItemMarketPriceComponent;

  const canViewMarketPrices = signal<boolean>(true);
  const marketPricingConfigured = signal<boolean | null>(true);
  const marketPriceNowMs = signal<number>(
    Date.parse('2026-11-18T12:15:00.000Z'),
  );
  const pricesMap = signal<Map<string, EphemeralMarketPrice>>(new Map());
  const overridesMap = signal<Map<string, string>>(new Map());

  const mockCollectionService = {
    canViewMarketPrices: canViewMarketPrices.asReadonly(),
    marketPricingConfigured: marketPricingConfigured.asReadonly(),
    marketPriceNowMs: marketPriceNowMs.asReadonly(),
    getMarketPrice: (
      itemType: 'game' | 'toy',
      itemId: string,
      canonicalId?: string | null,
    ) => {
      if (!canViewMarketPrices()) return null;
      return (
        pricesMap().get(`${itemType}:${canonicalId || itemId}`) ||
        pricesMap().get(`${itemType}:${itemId}`) ||
        null
      );
    },
    getPriceQueryOverride: (
      itemType: 'game' | 'toy',
      itemId: string,
      canonicalId?: string | null,
    ) =>
      overridesMap().get(`${itemType}:${canonicalId || itemId}`) ||
      overridesMap().get(`${itemType}:${itemId}`) ||
      '',
    checkLiveItemPrice: vi.fn(),
    savePriceQueryOverride: vi.fn(),
  };

  const baseGame: Game = {
    stable_id: 1,
    id: 'chrono-trigger-usa',
    game_id: 'chrono-trigger-snes',
    title: 'Chrono Trigger',
    series: 'Chrono',
    canonical_series: 'Chrono',
    platform: 'SNES',
    platform_id: 15,
    ownership_status: 1,
    play_status: PlayStatus.Played,
    backup_status: 1,
    has_case: 1,
    has_manual: 1,
  };

  const freshPrice: EphemeralMarketPrice = {
    item_type: 'game',
    item_id: 'chrono-trigger-snes',
    loose_cents: 1800,
    cib_cents: 4500,
    new_cents: 9900,
    loose_sample_size: 8,
    cib_sample_size: 4,
    new_sample_size: 2,
    confidence: 'high',
    source: 'ebay_browse',
    fetched_at: '2026-11-18T12:00:00.000Z',
    expires_at: new Date(
      Date.parse('2026-11-18T12:00:00.000Z') + EBAY_PRICE_TTL_MS,
    ).toISOString(),
    query_used: 'Chrono Trigger SNES',
    sample_listings: {
      loose: [
        {
          title: 'Chrono Trigger SNES Cart Only',
          totalCents: 1800,
          url: 'https://www.ebay.com/itm/111',
          condition: 'loose',
        },
      ],
      cib: [
        {
          title: 'Chrono Trigger SNES Complete CIB',
          totalCents: 4500,
          url: 'https://www.ebay.com/itm/222',
          condition: 'cib',
        },
      ],
      new: [],
    },
  };

  beforeEach(async () => {
    canViewMarketPrices.set(true);
    marketPricingConfigured.set(true);
    marketPriceNowMs.set(Date.parse('2026-11-18T12:15:00.000Z'));
    pricesMap.set(new Map());
    overridesMap.set(new Map());
    mockCollectionService.checkLiveItemPrice.mockReset();
    mockCollectionService.savePriceQueryOverride.mockReset();

    await TestBed.configureTestingModule({
      imports: [ItemMarketPriceComponent],
      providers: [
        { provide: CollectionService, useValue: mockCollectionService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ItemMarketPriceComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('itemType', 'game');
    fixture.componentRef.setInput('item', baseGame);
    fixture.componentRef.setInput('journalEntry', null);
  });

  it('hides completely for non-admin or public view', () => {
    canViewMarketPrices.set(false);
    pricesMap.set(new Map([['game:chrono-trigger-snes', freshPrice]]));
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="item-market-price-section"]',
      ),
    ).toBeNull();
  });

  it('displays graceful unconfigured notice when eBay keys are missing', () => {
    marketPricingConfigured.set(false);
    fixture.detectChanges();

    const notice = fixture.nativeElement.querySelector(
      '[data-testid="ebay-unconfigured-notice"]',
    ) as HTMLElement;
    expect(notice).toBeTruthy();
    expect(notice.textContent).toContain('EBAY_CLIENT_ID');
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="check-live-ebay-btn"]',
      ),
    ).toBeNull();
  });

  it('displays Loose/CIB/New tiers, age disclosure, live eBay links, and Journal Gain/Loss', () => {
    pricesMap.set(new Map([['game:chrono-trigger-snes', freshPrice]]));
    const journal: JournalEntry = {
      id: 7,
      item_type: 'game',
      item_id: 'chrono-trigger-snes',
      price_paid: 30,
    };
    fixture.componentRef.setInput('journalEntry', journal);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('$18.00');
    expect(el.textContent).toContain('$45.00');
    expect(el.textContent).toContain('$99.00');

    const disclosure = el.querySelector(
      '[data-testid="ebay-freshness-disclosure"]',
    );
    expect(disclosure?.textContent).toContain('15m ago');
    expect(disclosure?.textContent).toContain('expires in 5h 45m');

    const gainLoss = el.querySelector('[data-testid="ebay-gain-loss"]');
    expect(gainLoss?.textContent).toContain('$30.00');
    expect(gainLoss?.textContent).toContain('$45.00');
    expect(gainLoss?.textContent).toContain('+$15.00');
    expect(gainLoss?.textContent).toContain('+50%');

    const links = Array.from(el.querySelectorAll('.sample-listing-link'));
    expect(links.length).toBe(2);
    expect((links[0] as HTMLAnchorElement).href).toBe(
      'https://www.ebay.com/itm/222',
    );
  });

  it('displays boxed-no-manual midpoint callout when case is owned without manual', () => {
    pricesMap.set(new Map([['game:chrono-trigger-snes', freshPrice]]));
    fixture.componentRef.setInput('item', {
      ...baseGame,
      has_case: 1,
      has_manual: 0,
    });
    fixture.detectChanges();

    const callout = fixture.nativeElement.querySelector(
      '[data-testid="boxed-midpoint-callout"]',
    ) as HTMLElement;
    expect(callout).toBeTruthy();
    expect(callout.textContent).toContain('$31.50');
    expect(component.estimatedValue().tierLabel).toBe('Boxed (est.)');
  });
});
