import '../../../test-setup';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AdminCenterComponent } from './admin-center.component';
import { CollectionService } from '../../core/services/collection.service';
import {
  CatalogSeedStatus,
  CronExecutionLogEntry,
} from '../../core/models/collection.models';

describe('AdminCenterComponent', () => {
  let component: AdminCenterComponent;
  let fixture: ComponentFixture<AdminCenterComponent>;

  const baseStatus: CatalogSeedStatus = {
    paused: false,
    stage: '2A',
    cursor: 500,
    canonicalMinId: 100,
    canonicalMaxId: 900,
    dailyWriteBudget: 60000,
    writesUsedToday: 12000,
    gamesIngestedToday: 42,
    releasesIngestedToday: 84,
    currentPlatformName: 'Nintendo Switch',
    maxGameStableId: 1000,
    igdbBackfill: {
      cursor: 250,
      lastWrapDate: '2026-11-17',
      matchedTotal: 200,
      rulesAppliedTotal: 15,
      lastRunAt: '2026-11-18T10:00:00Z',
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
  };

  const mockLogs: CronExecutionLogEntry[] = [
    {
      id: 1,
      job_name: 'watched_series_discovery',
      status: 'SUCCESS',
      duration_ms: 410,
      summary: 'Scanned 10 watched series',
      details: null,
      created_at: '2026-11-18T11:00:00Z',
    },
    {
      id: 2,
      job_name: 'retail_deals',
      status: 'SUCCESS',
      duration_ms: 280,
      summary: 'Matched 3 deals',
      details: null,
      created_at: '2026-11-18T00:05:00Z',
    },
  ];

  let mockCollectionService: {
    isAdmin: ReturnType<typeof vi.fn>;
    promptAdminLogin: ReturnType<typeof vi.fn>;
    getCatalogSeedStatus: ReturnType<typeof vi.fn>;
    getAdminCronLogs: ReturnType<typeof vi.fn>;
    updateCatalogSeedControl: ReturnType<typeof vi.fn>;
    getMarketPricingRateLimits: ReturnType<typeof vi.fn>;
    clearMarketPriceCache: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockCollectionService = {
      isAdmin: vi.fn(() => true),
      promptAdminLogin: vi.fn(),
      getCatalogSeedStatus: vi.fn(() => of(baseStatus)),
      getAdminCronLogs: vi.fn(() => of({ logs: mockLogs })),
      updateCatalogSeedControl: vi.fn((payload) =>
        of({
          ...baseStatus,
          paused: payload.paused ?? baseStatus.paused,
        }),
      ),
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

  it('loads pipeline status, seriesDiscovery card, and cron logs on init', () => {
    expect(mockCollectionService.getCatalogSeedStatus).toHaveBeenCalled();
    expect(mockCollectionService.getAdminCronLogs).toHaveBeenCalledWith(40);
    expect(component.seedProgressPct()).toBe(50);
    expect(component.dailyBudgetPct()).toBe(20);
    expect(component.backfillProgressPct()).toBe(25);
    expect(component.rollingProgressPct()).toBe(40);

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Admin Center');
    expect(el.textContent).toContain('Watched-Series IGDB Discovery');
    expect(el.textContent).toContain('Scanned 10 watched series');
    const verifyLink = el.querySelector(
      '[data-testid="admin-verify-ownership-link"]',
    ) as HTMLAnchorElement | null;
    expect(verifyLink).toBeTruthy();
    expect(verifyLink?.getAttribute('href')).toBe('/admin/verify-ownership');
  });

  it('filters cron execution logs by job name including watched_series_discovery', () => {
    expect(component.filteredCronLogs().length).toBe(2);

    const select = fixture.nativeElement.querySelector(
      '[data-testid="pipeline-cron-filter"]',
    ) as HTMLSelectElement;
    select.value = 'watched_series_discovery';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(component.filteredCronLogs().length).toBe(1);
    expect(component.filteredCronLogs()[0].job_name).toBe(
      'watched_series_discovery',
    );
  });

  it('triggers pause toggle, seed, backfill, rolling refresh, and watched series discovery actions', async () => {
    await component.togglePipelinePause();
    expect(mockCollectionService.updateCatalogSeedControl).toHaveBeenCalledWith(
      {
        paused: true,
      },
    );

    await component.triggerSeedBatchNow();
    expect(mockCollectionService.updateCatalogSeedControl).toHaveBeenCalledWith(
      {
        runBatchNow: true,
      },
    );

    await component.triggerBackfillBatchNow();
    expect(mockCollectionService.updateCatalogSeedControl).toHaveBeenCalledWith(
      {
        runBackfillNow: true,
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
