import '../../../test-setup';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AdminCenterComponent } from './admin-center.component';
import { CollectionService } from '../../core/services/collection.service';
import { CatalogSeedStatus } from '../../core/models/collection.models';

describe('AdminCenterComponent', () => {
  let component: AdminCenterComponent;
  let fixture: ComponentFixture<AdminCenterComponent>;

  const baseStatus: CatalogSeedStatus = {
    canonicalTailer: {
      cursor: 500,
      canonicalMinId: 100,
      canonicalMaxId: 900,
      pendingCanonicalRows: 400,
      dailyWriteBudget: 60000,
      writesUsedToday: 12000,
      gamesIngestedToday: 42,
      releasesIngestedToday: 84,
      lastUpdatedAt: '2026-11-18T11:30:00Z',
      maxGameStableId: 1000,
    },
    igdbRolling: {
      cursorOffset: 400,
      refreshedTotal: 300,
      updatedTotal: 45,
      selfHealedRulesTotal: 9,
      lastRunAt: '2026-11-18T10:30:00Z',
    },
    seriesDiscovery: {
      cursor: 2,
      totalSeriesRules: 12,
      seriesScannedTotal: 20,
      discoveredGamesTotal: 6,
      lastRunAt: '2026-11-18T11:00:00Z',
    },
    upstreamSources: {
      boutiquePreOrdersUpdatedAt: '2026-11-18T01:00:00Z',
      retailPreOrdersUpdatedAt: '2026-11-18T02:00:00Z',
      retailDealsUpdatedAt: '2026-11-18T03:00:00Z',
      switchRevisionsUpdatedAt: '2026-11-18T04:00:00Z',
      nsCollectorsUpdatedAt: '2026-11-18T05:00:00Z',
      amiiboCatalogUpdatedAt: '2026-11-18T06:00:00Z',
      catalogChunksUpdatedAt: '2026-11-18T00:05:00Z',
    },
  };

  let mockCollectionService: {
    isAdmin: ReturnType<typeof vi.fn>;
    promptAdminLogin: ReturnType<typeof vi.fn>;
    getCatalogSeedStatus: ReturnType<typeof vi.fn>;
    updateCatalogSeedControl: ReturnType<typeof vi.fn>;
    getMarketPricingRateLimits: ReturnType<typeof vi.fn>;
    clearMarketPriceCache: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockCollectionService = {
      isAdmin: vi.fn(() => true),
      promptAdminLogin: vi.fn(),
      getCatalogSeedStatus: vi.fn(() => of(baseStatus)),
      updateCatalogSeedControl: vi.fn(() => of(baseStatus)),
      getMarketPricingRateLimits: vi.fn(() =>
        of({
          configured: true,
          ebayRateLimit: {
            limit: 5000,
            remaining: 4820,
            count: 180,
            reset: '2026-11-19T00:00:00Z',
            timeWindowSeconds: 86400,
          },
          cachedCount: 12,
          shardCount: 8,
          ttlHours: 6,
        }),
      ),
      clearMarketPriceCache: vi.fn().mockResolvedValue(true),
    };

    await TestBed.configureTestingModule({
      imports: [AdminCenterComponent],
      providers: [
        provideRouter([]),
        { provide: CollectionService, useValue: mockCollectionService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminCenterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await component.loadPipelineDiagnostics();
    fixture.detectChanges();
  });

  it('loads 4 always-living maintenance cards, budget, rolling progress, and 7 upstream source timestamps on init', () => {
    expect(mockCollectionService.getCatalogSeedStatus).toHaveBeenCalled();
    expect(component.dailyBudgetPct()).toBe(20);
    expect(component.rollingProgressPct()).toBe(40);

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Admin Center');
    expect(el.textContent).toContain('Rolling IGDB Refresh');
    expect(el.textContent).toContain('Watched-Series Discovery');
    expect(el.textContent).toContain('Live Upstream Sources & Pre-Orders');
    expect(el.textContent).toContain('Canonical Tailer & R2 Catalog');
    expect(el.textContent).toContain('400 Pending');
    expect(el.textContent).toContain('2026-11-18T05:00:00Z');
    expect(el.textContent).not.toContain('Pause Seeding');
    expect(el.textContent).not.toContain('IGDB Backfill');
    const verifyLink = el.querySelector(
      '[data-testid="admin-verify-ownership-link"]',
    ) as HTMLAnchorElement | null;
    expect(verifyLink).toBeTruthy();
    expect(verifyLink?.getAttribute('href')).toBe('/admin/verify-ownership');
  });

  it('triggers tailer batch, rolling refresh, watched series discovery, r/NSCollectors, and retail pre-orders actions', async () => {
    await component.triggerSeedBatchNow();
    expect(mockCollectionService.updateCatalogSeedControl).toHaveBeenCalledWith(
      {
        runBatchNow: true,
      },
    );

    await component.triggerRollingRefreshNow();
    expect(mockCollectionService.updateCatalogSeedControl).toHaveBeenCalledWith(
      {
        runRollingRefreshNow: true,
      },
    );

    await component.triggerSeriesDiscoveryNow();
    expect(mockCollectionService.updateCatalogSeedControl).toHaveBeenCalledWith(
      {
        runSeriesDiscoveryNow: true,
      },
    );

    await component.triggerNsCollectorsNow();
    expect(mockCollectionService.updateCatalogSeedControl).toHaveBeenCalledWith(
      {
        runNsCollectorsNow: true,
      },
    );

    await component.triggerRetailPreOrdersNow();
    expect(mockCollectionService.updateCatalogSeedControl).toHaveBeenCalledWith(
      {
        runRetailPreOrdersNow: true,
      },
    );
  });

  it('surfaces error banner when diagnostics request fails', async () => {
    mockCollectionService.getCatalogSeedStatus.mockReturnValueOnce(
      throwError(() => ({ error: { error: 'Forbidden' } })),
    );
    await component.loadPipelineDiagnostics();
    fixture.detectChanges();

    expect(component.pipelineError()).toBe('Forbidden');
  });

  it('renders Live eBay Valuation Cache & Quota card and wires Purge 6h Cache Now', async () => {
    const el = fixture.nativeElement as HTMLElement;
    const card = el.querySelector(
      '[data-testid="market-pricing-admin-card"]',
    ) as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.textContent).toContain('Configured');
    expect(card.textContent).toContain('4820 / 5000 remaining');
    expect(card.textContent).toContain('12 items across 8 R2 shards');

    const purgeBtn = card.querySelector(
      '[data-testid="purge-market-cache-btn"]',
    ) as HTMLButtonElement;
    purgeBtn.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(mockCollectionService.clearMarketPriceCache).toHaveBeenCalled();
    expect(component.toastMessage()).toContain('Purged all 6-hour eBay');

    mockCollectionService.getMarketPricingRateLimits.mockReturnValueOnce(
      of({
        configured: false,
        ebayRateLimit: null,
        cachedCount: 0,
        shardCount: 8,
        ttlHours: 6,
      }),
    );
    await component.loadPipelineDiagnostics();
    fixture.detectChanges();

    expect(card.textContent).toContain('Awaiting eBay API Keys');
  });
});
