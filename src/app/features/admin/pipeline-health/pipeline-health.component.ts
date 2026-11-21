import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  KitKvGridComponent,
  KitKvItem,
  KitSectionCardComponent,
  KitStatBarItem,
  KitStatBarListComponent,
} from '@wesdizzle/app-kit/angular';
import {
  CatalogSeedStatus,
  MarketPricingRateLimitStatus,
} from '../../../core/models/collection.models';
import { IconComponent } from '../../../shared/components/icon/icon.component';

/**
 * Displays broad catalog seeding progress, daily D1 write quota usage,
 * continuous IGDB backfill & rolling self-healing telemetry, and watched-series
 * discovery progress for administrators.
 */
@Component({
  selector: 'app-pipeline-health',
  standalone: true,
  imports: [
    IconComponent,
    KitSectionCardComponent,
    KitKvGridComponent,
    KitStatBarListComponent,
  ],
  templateUrl: './pipeline-health.component.html',
  styleUrls: ['./pipeline-health.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PipelineHealthComponent {
  readonly status = input<CatalogSeedStatus | null>(null);
  readonly loading = input<boolean>(false);
  readonly actionBusy = input<boolean>(false);
  readonly error = input<string | null>(null);
  readonly seedProgressPct = input<number>(0);
  readonly dailyBudgetPct = input<number>(0);
  readonly backfillProgressPct = input<number>(0);
  readonly rollingProgressPct = input<number>(0);
  readonly marketPricingStatus = input<MarketPricingRateLimitStatus | null>(
    null,
  );
  readonly marketCachePurging = input<boolean>(false);

  readonly refresh = output<void>();
  readonly togglePause = output<void>();
  readonly runSeedBatch = output<void>();
  readonly runBackfillBatch = output<void>();
  readonly runRollingRefresh = output<void>();
  readonly runSeriesDiscovery = output<void>();
  readonly purgeMarketCache = output<void>();

  readonly seedBarItems = computed<readonly KitStatBarItem[]>(() => {
    const pct = this.seedProgressPct();
    return [
      {
        id: 'seed-progress',
        label: 'Cursor Progress',
        value: pct,
        max: 100,
        displayValue: `${pct}%`,
        tone: 'primary',
      },
    ];
  });

  readonly budgetBarItems = computed<readonly KitStatBarItem[]>(() => {
    const s = this.status();
    if (!s) return [];
    const budget = Math.max(1, s.dailyWriteBudget);
    return [
      {
        id: 'budget-usage',
        label: 'Writes Used Today',
        value: s.writesUsedToday,
        max: budget,
        displayValue: `${s.writesUsedToday} / ${s.dailyWriteBudget}`,
        tone: this.dailyBudgetPct() >= 90 ? 'warning' : 'primary',
      },
    ];
  });

  readonly backfillBarItems = computed<readonly KitStatBarItem[]>(() => {
    const pct = this.backfillProgressPct();
    return [
      {
        id: 'backfill-progress',
        label: 'IGDB Backfill Cursor Sweep',
        value: pct,
        max: 100,
        displayValue: `${pct}%`,
        tone: 'primary',
      },
    ];
  });

  readonly rollingBarItems = computed<readonly KitStatBarItem[]>(() => {
    const pct = this.rollingProgressPct();
    return [
      {
        id: 'rolling-progress',
        label: 'Rolling IGDB & Rule Self-Heal',
        value: pct,
        max: 100,
        displayValue: `${pct}%`,
        tone: 'primary',
      },
    ];
  });

  readonly seedKvItems = computed<readonly KitKvItem[]>(() => {
    const s = this.status();
    if (!s) return [];
    return [
      {
        label: 'Canonical Cursor',
        value: `${s.cursor} / ${s.canonicalMaxId ?? s.cursor}`,
      },
      {
        label: 'Active Platform',
        value: s.currentPlatformName || 'Caught up / Steady State',
      },
      {
        label: 'Last Seed Update',
        value: s.lastUpdatedAt || 'Never',
        tone: 'muted',
      },
    ];
  });

  readonly budgetKvItems = computed<readonly KitKvItem[]>(() => {
    const s = this.status();
    if (!s) return [];
    return [
      {
        label: 'Games Ingested Today',
        value: String(s.gamesIngestedToday ?? 0),
      },
      {
        label: 'Releases Attached Today',
        value: String(s.releasesIngestedToday ?? 0),
      },
      {
        label: 'Switch Revisions Synced',
        value: s.upstreamSources?.switchRevisionsUpdatedAt || 'Pending',
        tone: 'muted',
      },
      {
        label: 'Amiibo Catalog Synced',
        value: s.upstreamSources?.amiiboCatalogUpdatedAt || 'Pending',
        tone: 'muted',
      },
    ];
  });

  readonly backfillKvItems = computed<readonly KitKvItem[]>(() => {
    const s = this.status();
    if (!s) return [];
    return [
      {
        label: 'Stable ID Cursor',
        value: `${s.igdbBackfill?.cursor ?? 0} / ${s.maxGameStableId ?? 0}`,
      },
      {
        label: 'Games Matched (Total)',
        value: String(s.igdbBackfill?.matchedTotal ?? 0),
      },
      {
        label: 'Rules Applied (Backfill)',
        value: String(s.igdbBackfill?.rulesAppliedTotal ?? 0),
      },
      {
        label: 'Last Daily Wrap Date',
        value: s.igdbBackfill?.lastWrapDate || 'In first pass',
        tone: 'muted',
      },
    ];
  });

  readonly rollingKvItems = computed<readonly KitKvItem[]>(() => {
    const s = this.status();
    if (!s) return [];
    return [
      {
        label: 'Rolling Offset',
        value: `${s.igdbRolling?.cursorOffset ?? 0} / ${s.maxGameStableId ?? 0}`,
      },
      {
        label: 'IGDB Refreshed (Total)',
        value: String(s.igdbRolling?.refreshedTotal ?? 0),
      },
      {
        label: 'Self-Healed Rules (Total)',
        value: String(s.igdbRolling?.selfHealedRulesTotal ?? 0),
      },
      {
        label: 'Last Rolling Run',
        value: s.igdbRolling?.lastRunAt || 'Pending',
        tone: 'muted',
      },
    ];
  });

  readonly seriesDiscoveryKvItems = computed<readonly KitKvItem[]>(() => {
    const s = this.status();
    if (!s) return [];
    return [
      {
        label: 'Active Series Rules',
        value: String(s.seriesDiscovery?.totalSeriesRules ?? 0),
      },
      {
        label: 'Series Cursor',
        value: String(s.seriesDiscovery?.cursor ?? 0),
      },
      {
        label: 'Series Scanned (Total)',
        value: String(s.seriesDiscovery?.seriesScannedTotal ?? 0),
      },
      {
        label: 'Games Discovered (Total)',
        value: String(s.seriesDiscovery?.discoveredGamesTotal ?? 0),
      },
      {
        label: 'Last Discovery Run',
        value: s.seriesDiscovery?.lastRunAt || 'Pending',
        tone: 'muted',
      },
    ];
  });

  readonly marketPricingKvItems = computed<readonly KitKvItem[]>(() => {
    const mps = this.marketPricingStatus();
    if (!mps) return [];
    const items: KitKvItem[] = [
      {
        label: 'Active Unexpired Items',
        value: `${mps.cachedCount} items across ${mps.shardCount} R2 shards (≤${mps.ttlHours}h TTL, 0 D1 writes)`,
      },
    ];
    if (mps.ebayRateLimit) {
      items.push({
        label: 'Daily eBay Browse Quota',
        value: `${mps.ebayRateLimit.remaining} / ${mps.ebayRateLimit.limit} remaining`,
      });
      if (mps.ebayRateLimit.reset) {
        items.push({
          label: 'Quota Window Reset',
          value: mps.ebayRateLimit.reset,
          tone: 'muted',
        });
      }
    } else {
      items.push({
        label: 'Daily eBay Browse Quota',
        value: mps.configured
          ? 'Quota telemetry unavailable'
          : 'Configure EBAY_CLIENT_ID & EBAY_CLIENT_SECRET',
        tone: 'muted',
      });
    }
    return items;
  });
}
