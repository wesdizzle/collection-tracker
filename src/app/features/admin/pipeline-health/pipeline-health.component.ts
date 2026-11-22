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
 * Displays always-living catalog maintenance telemetry: canonical tailer & R2 catalog
 * rebuilds, rolling IGDB refresh, watched-series discovery, upstream physical feed
 * sync timestamps, and eBay 6h valuation cache quota.
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
  readonly dailyBudgetPct = input<number>(0);
  readonly rollingProgressPct = input<number>(0);
  readonly marketPricingStatus = input<MarketPricingRateLimitStatus | null>(
    null,
  );
  readonly marketCachePurging = input<boolean>(false);

  readonly refresh = output<void>();
  readonly runSeedBatch = output<void>();
  readonly runRollingRefresh = output<void>();
  readonly runSeriesDiscovery = output<void>();
  readonly runNsCollectors = output<void>();
  readonly runRetailPreOrders = output<void>();
  readonly purgeMarketCache = output<void>();

  readonly budgetBarItems = computed<readonly KitStatBarItem[]>(() => {
    const tailer = this.status()?.canonicalTailer;
    if (!tailer) return [];
    const budget = Math.max(1, tailer.dailyWriteBudget);
    return [
      {
        id: 'budget-usage',
        label: 'Writes Used Today',
        value: tailer.writesUsedToday,
        max: budget,
        displayValue: `${tailer.writesUsedToday} / ${tailer.dailyWriteBudget}`,
        tone: this.dailyBudgetPct() >= 90 ? 'warning' : 'primary',
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

  readonly tailerKvItems = computed<readonly KitKvItem[]>(() => {
    const s = this.status();
    if (!s) return [];
    return [
      {
        label: 'Canonical Cursor',
        value: `${s.canonicalTailer.cursor} / ${s.canonicalTailer.canonicalMaxId}`,
      },
      {
        label: 'Games Ingested Today',
        value: String(s.canonicalTailer.gamesIngestedToday),
      },
      {
        label: 'Releases Attached Today',
        value: String(s.canonicalTailer.releasesIngestedToday),
      },
      {
        label: 'R2 Catalog Chunks',
        value: s.upstreamSources.catalogChunksUpdatedAt || 'Pending',
        tone: 'muted',
      },
      {
        label: 'Last Tailer Run',
        value: s.canonicalTailer.lastUpdatedAt || 'Pending',
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
        value: `${s.igdbRolling.cursorOffset} / ${s.canonicalTailer.maxGameStableId}`,
      },
      {
        label: 'IGDB Refreshed (Total)',
        value: String(s.igdbRolling.refreshedTotal),
      },
      {
        label: 'Updated Rows (Total)',
        value: String(s.igdbRolling.updatedTotal),
      },
      {
        label: 'Self-Healed Rules (Total)',
        value: String(s.igdbRolling.selfHealedRulesTotal),
      },
      {
        label: 'Last Rolling Run',
        value: s.igdbRolling.lastRunAt || 'Pending',
        tone: 'muted',
      },
    ];
  });

  readonly upstreamSourcesKvItems = computed<readonly KitKvItem[]>(() => {
    const u = this.status()?.upstreamSources;
    if (!u) return [];
    return [
      {
        label: 'Boutique Pre-Orders',
        value: u.boutiquePreOrdersUpdatedAt || 'Pending',
        tone: 'muted',
      },
      {
        label: 'Retail Pre-Orders (VGP / PNP)',
        value: u.retailPreOrdersUpdatedAt || 'Pending',
        tone: 'muted',
      },
      {
        label: 'Retail Deals',
        value: u.retailDealsUpdatedAt || 'Pending',
        tone: 'muted',
      },
      {
        label: 'Switch Revisions',
        value: u.switchRevisionsUpdatedAt || 'Pending',
        tone: 'muted',
      },
      {
        label: 'r/NSCollectors Sheet',
        value: u.nsCollectorsUpdatedAt || 'Pending',
        tone: 'muted',
      },
      {
        label: 'Amiibo Catalog',
        value: u.amiiboCatalogUpdatedAt || 'Pending',
        tone: 'muted',
      },
      {
        label: 'R2 Catalog Chunks',
        value: u.catalogChunksUpdatedAt || 'Pending',
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
        value: String(s.seriesDiscovery.totalSeriesRules),
      },
      {
        label: 'Series Cursor',
        value: String(s.seriesDiscovery.cursor),
      },
      {
        label: 'Series Scanned (Total)',
        value: String(s.seriesDiscovery.seriesScannedTotal),
      },
      {
        label: 'Games Discovered (Total)',
        value: String(s.seriesDiscovery.discoveredGamesTotal),
      },
      {
        label: 'Last Discovery Run',
        value: s.seriesDiscovery.lastRunAt || 'Pending',
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
