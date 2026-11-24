import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { catchError, firstValueFrom, of } from 'rxjs';
import { RouterLink } from '@angular/router';
import {
  CatalogSeedStatus,
  MarketPricingRateLimitStatus,
} from '../../core/models/collection.models';
import { CollectionService } from '../../core/services/collection.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { PipelineHealthComponent } from './pipeline-health/pipeline-health.component';

/**
 * ADMIN CENTER COMPONENT (/admin)
 *
 * Streamlined administration center housing always-living catalog maintenance telemetry,
 * daily D1 write quota monitoring, IGDB rolling self-healing, watched-series
 * discovery, and upstream physical release feed sync controls.
 */
@Component({
  selector: 'app-admin-center',
  standalone: true,
  imports: [RouterLink, IconComponent, PipelineHealthComponent],
  templateUrl: './admin-center.component.html',
  styleUrls: ['./admin-center.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminCenterComponent implements OnInit, OnDestroy {
  private readonly collectionService = inject(CollectionService);

  public readonly pipelineStatus = signal<CatalogSeedStatus | null>(null);
  public readonly pipelineLoading = signal<boolean>(false);
  public readonly pipelineActionBusy = signal<boolean>(false);
  public readonly pipelineError = signal<string | null>(null);
  public readonly marketPricingStatus =
    signal<MarketPricingRateLimitStatus | null>(null);
  public readonly marketCachePurging = signal<boolean>(false);
  public readonly toastMessage = signal<string | null>(null);

  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  public readonly dailyBudgetPct = computed<number>(() => {
    const tailer = this.pipelineStatus()?.canonicalTailer;
    if (!tailer || !tailer.dailyWriteBudget) return 0;
    return Math.min(
      100,
      Math.round((tailer.writesUsedToday / tailer.dailyWriteBudget) * 100),
    );
  });

  public readonly rollingProgressPct = computed<number>(() => {
    const status = this.pipelineStatus();
    const max = status?.canonicalTailer.maxGameStableId ?? 0;
    const offset = status?.igdbRolling.cursorOffset ?? 0;
    if (!max || max <= 0) return 0;
    return Math.min(100, Math.round((offset / max) * 100));
  });

  ngOnInit(): void {
    void this.loadPipelineDiagnostics();
  }

  ngOnDestroy(): void {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
  }

  public showToast(msg: string): void {
    this.toastMessage.set(msg);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastMessage.set(null);
      this.toastTimer = null;
    }, 3500);
  }

  public async loadPipelineDiagnostics(): Promise<void> {
    this.pipelineLoading.set(true);
    this.pipelineError.set(null);

    try {
      const [status, marketStatus] = await Promise.all([
        this.collectionService.getCatalogSeedStatus
          ? firstValueFrom(this.collectionService.getCatalogSeedStatus())
          : Promise.resolve(null),
        this.collectionService.getMarketPricingRateLimits
          ? firstValueFrom(
              this.collectionService
                .getMarketPricingRateLimits()
                .pipe(catchError(() => of(null))),
            )
          : Promise.resolve(null),
      ]);
      if (status) {
        this.pipelineStatus.set(status);
      }
      if (marketStatus) {
        this.marketPricingStatus.set(marketStatus);
      }
    } catch (err: unknown) {
      console.error('[AdminCenter] Pipeline diagnostics failed:', err);
      this.pipelineError.set(
        this.extractErrorMessage(err, 'Failed to load pipeline telemetry.'),
      );
    } finally {
      this.pipelineLoading.set(false);
    }
  }

  private async runPipelineControlAction(
    payload: {
      runBatchNow?: boolean;
      runRollingRefreshNow?: boolean;
      runSeriesDiscoveryNow?: boolean;
      runNsCollectorsNow?: boolean;
      runRetailPreOrdersNow?: boolean;
      runWorkerDatsNow?: boolean;
    },
    successMessage: (status: CatalogSeedStatus) => string,
    fallbackError: string,
  ): Promise<void> {
    if (!this.collectionService.isAdmin()) {
      this.collectionService.promptAdminLogin();
      return;
    }
    if (!this.collectionService.updateCatalogSeedControl) return;

    this.pipelineActionBusy.set(true);
    this.pipelineError.set(null);
    try {
      const updatedStatus = await firstValueFrom(
        this.collectionService.updateCatalogSeedControl(payload),
      );
      this.pipelineStatus.set(updatedStatus);
      this.showToast(successMessage(updatedStatus));
    } catch (err: unknown) {
      console.error('[AdminCenter] Pipeline control action failed:', err);
      const msg = this.extractErrorMessage(err, fallbackError);
      this.pipelineError.set(msg);
      this.showToast(msg);
    } finally {
      this.pipelineActionBusy.set(false);
    }
  }

  public async triggerSeedBatchNow(): Promise<void> {
    await this.runPipelineControlAction(
      { runBatchNow: true },
      (s) =>
        `Canonical tailer batch completed (cursor ${s.canonicalTailer.cursor}).`,
      'Failed to run canonical tailer batch.',
    );
  }

  public async triggerRollingRefreshNow(): Promise<void> {
    await this.runPipelineControlAction(
      { runRollingRefreshNow: true },
      (s) =>
        `Rolling IGDB self-heal check completed (offset ${s.igdbRolling.cursorOffset}).`,
      'Failed to run rolling IGDB refresh.',
    );
  }

  public async triggerSeriesDiscoveryNow(): Promise<void> {
    await this.runPipelineControlAction(
      { runSeriesDiscoveryNow: true },
      (s) =>
        `Watched-series discovery completed (cursor ${s.seriesDiscovery.cursor}).`,
      'Failed to run watched-series discovery.',
    );
  }

  public async triggerNsCollectorsNow(): Promise<void> {
    await this.runPipelineControlAction(
      { runNsCollectorsNow: true },
      () => 'r/NSCollectors physical Switch sheet sync completed.',
      'Failed to sync r/NSCollectors sheet.',
    );
  }

  public async triggerRetailPreOrdersNow(): Promise<void> {
    await this.runPipelineControlAction(
      { runRetailPreOrdersNow: true },
      () => 'Retail pre-orders feed sync completed.',
      'Failed to sync retail pre-orders.',
    );
  }

  public async triggerWorkerDatsNow(): Promise<void> {
    await this.runPipelineControlAction(
      { runWorkerDatsNow: true },
      () => 'Worker DAT sync completed.',
      'Failed to run Worker DAT sync.',
    );
  }

  public async toggleWorkerPlanTier(tier: 'paid' | 'free'): Promise<void> {
    if (!this.collectionService.isAdmin()) {
      this.collectionService.promptAdminLogin();
      return;
    }
    if (!this.collectionService.setWorkerPlanTier) return;

    this.pipelineActionBusy.set(true);
    this.pipelineError.set(null);
    try {
      const res = await firstValueFrom(
        this.collectionService.setWorkerPlanTier(tier),
      );
      this.pipelineStatus.update((prev) =>
        prev ? { ...prev, workerPlanTier: res.tier } : prev,
      );
      this.showToast(
        res.tier === 'free'
          ? 'Switched Worker Plan Tier to Free Tier (Safe Mode).'
          : 'Switched Worker Plan Tier to Paid Tier ($5/mo).',
      );
    } catch (err: unknown) {
      console.error('[AdminCenter] Plan tier toggle failed:', err);
      const msg = this.extractErrorMessage(
        err,
        'Failed to update Worker plan tier.',
      );
      this.pipelineError.set(msg);
      this.showToast(msg);
    } finally {
      this.pipelineActionBusy.set(false);
    }
  }

  public async purgeMarketPriceCache(): Promise<void> {
    if (!this.collectionService.isAdmin()) {
      this.collectionService.promptAdminLogin();
      return;
    }
    if (!this.collectionService.clearMarketPriceCache) return;
    this.marketCachePurging.set(true);
    try {
      const cleared = await this.collectionService.clearMarketPriceCache();
      if (cleared) {
        this.showToast('Purged all 6-hour eBay market price cache shards.');
        if (this.collectionService.getMarketPricingRateLimits) {
          const updated = await firstValueFrom(
            this.collectionService
              .getMarketPricingRateLimits()
              .pipe(catchError(() => of(null))),
          );
          if (updated) {
            this.marketPricingStatus.set(updated);
          }
        }
      } else {
        this.showToast('Failed to purge eBay market price cache.');
      }
    } finally {
      this.marketCachePurging.set(false);
    }
  }

  private extractErrorMessage(err: unknown, fallback: string): string {
    if (err && typeof err === 'object') {
      const e = err as { error?: { error?: string }; message?: string };
      if (e.error?.error) return e.error.error;
      if (e.message) return e.message;
    }
    return fallback;
  }
}
