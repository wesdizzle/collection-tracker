import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import {
  KitSelectComponent,
  KitSelectGroup,
  KitSelectOption,
} from '@wesdizzle/app-kit/angular';
import {
  EphemeralMarketPrice,
  Game,
  JournalEntry,
  MarketPriceScanProgress,
  Platform,
  Toy,
} from '../../../../core/models/collection.models';
import {
  ScopedOwnedValuationEntry,
  ScopedValuationSummary,
  computeScopedValuation,
} from '../../../../core/models/insights-analytics';
import { CollectionService } from '../../../../core/services/collection.service';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-market-valuation-panel',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent, KitSelectComponent],
  templateUrl: './market-valuation-panel.component.html',
  styleUrls: ['./market-valuation-panel.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarketValuationPanelComponent {
  public readonly collectionService = inject(CollectionService);

  public readonly ownedGames = input.required<Game[]>();
  public readonly ownedToys = input.required<Toy[]>();
  public readonly platforms = input.required<Platform[]>();
  public readonly externalScope = input<string | null>(null);
  public readonly variant = input<'full' | 'toolbar'>('full');

  public readonly selectedScope = signal<string>('all_owned');
  public readonly effectiveScope = computed<string>(
    () => this.externalScope() ?? this.selectedScope(),
  );
  public readonly isSyncingDevices = signal<boolean>(false);

  public readonly canRender = computed<boolean>(
    () => this.collectionService.canViewMarketPrices?.() === true,
  );

  public readonly isUnconfigured = computed<boolean>(
    () => this.collectionService.marketPricingConfigured?.() === false,
  );

  public readonly scanProgress = computed<MarketPriceScanProgress>(() => {
    const fn = this.collectionService.marketPriceScanProgress;
    if (fn) return fn();
    return {
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
      cooldownSecondsRemaining: 0,
      waitingForWake: false,
      wakeLockActive: false,
      statusMessage: null,
    };
  });

  public readonly remainingUnpricedCount = computed<number>(() =>
    Math.max(
      0,
      this.valuationSummary().totalOwnedCount -
        this.valuationSummary().pricedCount,
    ),
  );

  public readonly platformFilterOptions = computed<
    Array<{ id: number; name: string; count: number }>
  >(() => {
    const owned = this.ownedGames();
    const counts = new Map<number, number>();
    for (const g of owned) {
      counts.set(g.platform_id, (counts.get(g.platform_id) || 0) + 1);
    }
    return this.platforms()
      .filter((p) => (counts.get(p.id) || 0) > 0)
      .map((p) => ({
        id: p.id,
        name: p.display_name || p.name,
        count: counts.get(p.id) || 0,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  });

  public readonly scopeOptions = computed<KitSelectOption<string>[]>(() => [
    {
      value: 'all_owned',
      label: `All Owned (${this.ownedGames().length + this.ownedToys().length})`,
    },
    {
      value: 'with_cost_basis',
      label: 'Owned With Purchase Price',
    },
    {
      value: 'games_only',
      label: `Owned Games Only (${this.ownedGames().length})`,
    },
    {
      value: 'toys_only',
      label: `Owned Toys Only (${this.ownedToys().length})`,
    },
  ]);

  public readonly scopeGroups = computed<KitSelectGroup<string>[]>(() => {
    const opts = this.platformFilterOptions();
    if (opts.length === 0) return [];
    return [
      {
        label: 'Platforms',
        options: opts.map((p) => ({
          value: `platform:${p.id}`,
          label: `${p.name} (${p.count})`,
        })),
      },
    ];
  });

  private readonly journalMap = computed<Map<string, JournalEntry>>(
    () => this.collectionService.journalEntriesMap?.() ?? new Map(),
  );

  private readonly pricesMap = computed<Map<string, EphemeralMarketPrice>>(
    () => this.collectionService.marketPricesMap?.() ?? new Map(),
  );

  private readonly nowMs = computed<number>(
    () => this.collectionService.marketPriceNowMs?.() ?? Date.now(),
  );

  public readonly valuationSummary = computed<ScopedValuationSummary>(() => {
    if (!this.canRender()) {
      return {
        entries: [],
        totalOwnedCount: 0,
        pricedCount: 0,
        coveragePct: 0,
        totalEstimatedCents: 0,
        matchedCount: 0,
        matchedCostBasisCents: 0,
        matchedEstimatedCents: 0,
        unrealizedDeltaCents: 0,
        unrealizedRoiPct: null,
        topValuable: [],
        topCostBasis: [],
        disclosureText: 'No active live eBay snapshots in the last 6 hours.',
      };
    }

    return computeScopedValuation({
      ownedGames: this.ownedGames(),
      ownedToys: this.ownedToys(),
      platforms: this.platforms(),
      journalMap: this.journalMap(),
      marketPricesMap: this.pricesMap(),
      nowMs: this.nowMs(),
      scope: this.effectiveScope(),
      canViewMarketPrices: true,
    });
  });

  public readonly scopedEntries = computed<ScopedOwnedValuationEntry[]>(
    () => this.valuationSummary().entries,
  );

  public readonly scanProgressPct = computed<number>(() => {
    const p = this.scanProgress();
    if (!p.totalItems || p.totalItems <= 0) return 0;
    return Math.min(100, Math.round((p.completedItems / p.totalItems) * 100));
  });

  public formatCents(cents: number): string {
    return (cents / 100).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  public formatSignedCents(cents: number): string {
    const abs = this.formatCents(Math.abs(cents));
    return cents >= 0 ? `+${abs}` : `-${abs}`;
  }

  public onScopeChange(value: string): void {
    this.selectedScope.set(value || 'all_owned');
  }

  public getScopeLabel(scope: string): string {
    if (scope === 'all_owned') return 'All Owned Items';
    if (scope === 'with_cost_basis') return 'Owned With Purchase Price';
    if (scope === 'games_only') return 'Owned Games Only';
    if (scope === 'toys_only') return 'Owned Toys Only';
    if (scope.startsWith('platform:')) {
      const pid = Number(scope.slice('platform:'.length));
      const match = this.platforms().find((p) => p.id === pid);
      return match ? match.display_name || match.name : 'Platform';
    }
    return 'Selected Scope';
  }

  public async startScan(): Promise<void> {
    if (!this.canRender() || this.scanProgress().active) return;
    const scope = this.effectiveScope();
    const items = this.scopedEntries().map((e) => ({
      itemType: e.itemType,
      itemId: e.canonicalId,
    }));
    await this.collectionService.startCollectionValuationScan?.(
      items,
      this.getScopeLabel(scope),
      false,
    );
  }

  public cancelScan(): void {
    this.collectionService.cancelCollectionValuationScan?.();
  }

  public async syncFromDevices(): Promise<void> {
    if (!this.canRender() || this.isSyncingDevices()) return;
    this.isSyncingDevices.set(true);
    try {
      await this.collectionService.syncCachedMarketPrices?.(true);
    } finally {
      this.isSyncingDevices.set(false);
    }
  }

  public exportCsv(): void {
    const priced = this.scopedEntries().filter(
      (e): e is ScopedOwnedValuationEntry & { estimatedCents: number } =>
        e.estimatedCents !== null && e.price !== null,
    );
    if (priced.length === 0 || typeof document === 'undefined') return;

    const escapeCsv = (val: string): string => {
      if (/[",\r\n]/.test(val)) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };

    const headers = [
      'Item Type',
      'ID',
      'Title',
      'Platform / Line',
      'Completeness Tier',
      'Cost Paid (USD)',
      'Estimated Value (USD)',
      'Gain / Loss (USD)',
      'Confidence',
      'Fetched At',
      'Expires At',
    ];

    const rows = priced.map((entry) => {
      const paidRaw = entry.journalEntry?.price_paid;
      const hasPaid =
        paidRaw !== null &&
        paidRaw !== undefined &&
        Number.isFinite(Number(paidRaw));
      const paidDollars = hasPaid ? Number(paidRaw).toFixed(2) : '';
      const estDollars = (entry.estimatedCents / 100).toFixed(2);
      const gainLossDollars = hasPaid
        ? (
            (entry.estimatedCents - Math.round(Number(paidRaw) * 100)) /
            100
          ).toFixed(2)
        : '';

      return [
        entry.itemType,
        entry.canonicalId,
        entry.title,
        entry.subtitle,
        entry.tierLabel,
        paidDollars,
        estDollars,
        gainLossDollars,
        entry.price?.confidence || '',
        entry.price?.fetched_at || '',
        entry.price?.expires_at || '',
      ]
        .map((c) => escapeCsv(String(c)))
        .join(',');
    });

    const csv = [headers.map(escapeCsv).join(','), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `collection-market-valuation-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}
