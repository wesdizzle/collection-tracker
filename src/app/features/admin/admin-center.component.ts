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
 * Streamlined administration center housing autonomous catalog pipeline telemetry,
 * daily D1 write quota monitoring, IGDB self-healing sweep status, and watched-series
 * discovery controls.
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

  public readonly seedProgressPct = computed<number>(() => {
    const status = this.pipelineStatus();
    if (!status) return 0;
    const min = status.canonicalMinId ?? 0;
    const max = status.canonicalMaxId ?? 0;
    const cursor = status.cursor ?? 0;
    if (status.stage === 'done' || status.stage === 'completed') return 100;
    if (max <= min) return 0;
    const pct = Math.round(((cursor - min) / (max - min)) * 100);
    return Math.max(0, Math.min(100, pct));
  });

  public readonly dailyBudgetPct = computed<number>(() => {
    const status = this.pipelineStatus();
    if (!status || !status.dailyWriteBudget) return 0;
    return Math.min(
      100,
      Math.round((status.writesUsedToday / status.dailyWriteBudget) * 100),
    );
  });

  public readonly backfillProgressPct = computed<number>(() => {
    const status = this.pipelineStatus();
    const max = status?.maxGameStableId ?? 0;
    const cursor = status?.igdbBackfill?.cursor ?? 0;
    if (!max || max <= 0) return 0;
    return Math.min(100, Math.round((cursor / max) * 100));
  });

  public readonly rollingProgressPct = computed<number>(() => {
    const status = this.pipelineStatus();
    const max = status?.maxGameStableId ?? 0;
    const offset = status?.igdbRolling?.cursorOffset ?? 0;
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
      paused?: boolean;
      runBatchNow?: boolean;
      runBackfillNow?: boolean;
      runRollingRefreshNow?: boolean;
      runSeriesDiscoveryNow?: boolean;
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

  public async togglePipelinePause(): Promise<void> {
    const current = this.pipelineStatus();
    if (!current) return;
    await this.runPipelineControlAction(
      { paused: !current.paused },
      (s) =>
        s.paused
          ? 'Autonomous catalog seeding paused.'
          : 'Autonomous catalog seeding resumed.',
      'Failed to toggle catalog seed pause state.',
    );
  }

  public async triggerSeedBatchNow(): Promise<void> {
    await this.runPipelineControlAction(
      { runBatchNow: true },
      (s) =>
        `Catalog seed batch completed (Stage ${s.stage.toUpperCase()}, cursor ${s.cursor}).`,
      'Failed to run catalog seed batch.',
    );
  }

  public async triggerBackfillBatchNow(): Promise<void> {
    await this.runPipelineControlAction(
      { runBackfillNow: true },
      (s) =>
        `IGDB backfill batch completed (cursor ${s.igdbBackfill?.cursor ?? 0}).`,
      'Failed to run IGDB backfill batch.',
    );
  }

  public async triggerRollingRefreshNow(): Promise<void> {
    await this.runPipelineControlAction(
      { runRollingRefreshNow: true },
      (s) =>
        `Rolling IGDB self-heal check completed (offset ${s.igdbRolling?.cursorOffset ?? 0}).`,
      'Failed to run rolling IGDB refresh.',
    );
  }

  public async triggerSeriesDiscoveryNow(): Promise<void> {
    await this.runPipelineControlAction(
      { runSeriesDiscoveryNow: true },
      (s) =>
        `Watched-series discovery completed (cursor ${s.seriesDiscovery?.cursor ?? 0}).`,
      'Failed to run watched-series discovery.',
    );
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
