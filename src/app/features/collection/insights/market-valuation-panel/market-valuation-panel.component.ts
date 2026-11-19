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
  EphemeralMarketPrice,
  Game,
  JournalEntry,
  MarketPriceItemType,
  MarketPriceScanProgress,
  Platform,
  Toy,
  computeItemEstimatedValueCents,
  formatPriceAge,
  getMarketPriceKey,
  isMarketPriceFresh,
} from '../../../../core/models/collection.models';
import { CollectionService } from '../../../../core/services/collection.service';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

interface ScopedOwnedEntry {
  itemType: MarketPriceItemType;
  canonicalId: string;
  routeId: string;
  title: string;
  subtitle: string;
  estimatedCents: number | null;
  tierLabel: string;
  price: EphemeralMarketPrice | null;
  journalEntry: JournalEntry | null;
}

@Component({
  selector: 'app-market-valuation-panel',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent],
  templateUrl: './market-valuation-panel.component.html',
  styleUrls: ['./market-valuation-panel.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarketValuationPanelComponent {
  public readonly collectionService = inject(CollectionService);

  public readonly ownedGames = input.required<Game[]>();
  public readonly ownedToys = input.required<Toy[]>();
  public readonly platforms = input.required<Platform[]>();

  public readonly selectedScope = signal<string>('all_owned');
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
    };
  });

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

  private readonly journalMap = computed<Map<string, JournalEntry>>(
    () => this.collectionService.journalEntriesMap?.() ?? new Map(),
  );

  private readonly pricesMap = computed<Map<string, EphemeralMarketPrice>>(
    () => this.collectionService.marketPricesMap?.() ?? new Map(),
  );

  private readonly nowMs = computed<number>(
    () => this.collectionService.marketPriceNowMs?.() ?? Date.now(),
  );

  private findGameJournalEntry(g: Game): JournalEntry | null {
    const map = this.journalMap();
    return (
      map.get(`game:${g.game_id || g.id}`) ||
      map.get(`game:${g.id}`) ||
      (g.stable_id !== undefined ? map.get(`game:${g.stable_id}`) : null) ||
      null
    );
  }

  private findFreshPrice(
    itemType: MarketPriceItemType,
    itemId: string,
    canonicalId?: string | null,
  ): EphemeralMarketPrice | null {
    const now = this.nowMs();
    const map = this.pricesMap();
    if (canonicalId) {
      const c = map.get(getMarketPriceKey(itemType, canonicalId));
      if (c && isMarketPriceFresh(c, now)) return c;
    }
    const d = map.get(getMarketPriceKey(itemType, itemId));
    return d && isMarketPriceFresh(d, now) ? d : null;
  }

  public readonly scopedEntries = computed<ScopedOwnedEntry[]>(() => {
    if (!this.canRender()) return [];
    const scope = this.selectedScope();
    const games = this.ownedGames();
    const toys = this.ownedToys();
    const jMap = this.journalMap();

    const includeGames =
      scope !== 'toys_only' &&
      (!scope.startsWith('platform:') || games.length > 0);
    const includeToys =
      scope === 'all_owned' ||
      scope === 'with_cost_basis' ||
      scope === 'toys_only';
    const platformId = scope.startsWith('platform:')
      ? Number(scope.slice('platform:'.length))
      : null;

    const result: ScopedOwnedEntry[] = [];

    if (includeGames) {
      for (const g of games) {
        if (platformId !== null && g.platform_id !== platformId) {
          continue;
        }
        const jEntry = this.findGameJournalEntry(g);
        if (
          scope === 'with_cost_basis' &&
          (jEntry?.price_paid === null || jEntry?.price_paid === undefined)
        ) {
          continue;
        }
        const canonicalId = g.game_id || g.id;
        const price = this.findFreshPrice('game', g.id, canonicalId);
        const est = computeItemEstimatedValueCents(g, price);
        result.push({
          itemType: 'game',
          canonicalId,
          routeId: g.id,
          title: g.title,
          subtitle: g.display_name || g.platform || 'Game',
          estimatedCents: est.cents,
          tierLabel: est.tierLabel,
          price,
          journalEntry: jEntry,
        });
      }
    }

    if (includeToys) {
      for (const t of toys) {
        const jEntry = jMap.get(`toy:${t.id}`) || null;
        if (
          scope === 'with_cost_basis' &&
          (jEntry?.price_paid === null || jEntry?.price_paid === undefined)
        ) {
          continue;
        }
        const price = this.findFreshPrice('toy', t.id);
        const est = computeItemEstimatedValueCents(t, price);
        result.push({
          itemType: 'toy',
          canonicalId: t.id,
          routeId: t.id,
          title: t.name,
          subtitle: t.series_name ? `${t.line} · ${t.series_name}` : t.line,
          estimatedCents: est.cents,
          tierLabel: est.tierLabel,
          price,
          journalEntry: jEntry,
        });
      }
    }

    return result;
  });

  public readonly valuationSummary = computed(() => {
    const entries = this.scopedEntries();
    const totalOwnedCount = entries.length;
    let pricedCount = 0;
    let totalEstimatedCents = 0;

    let matchedCount = 0;
    let matchedCostBasisCents = 0;
    let matchedEstimatedCents = 0;

    let newestFetchedMs = 0;
    let oldestFetchedMs = Number.POSITIVE_INFINITY;
    let newestPrice: EphemeralMarketPrice | null = null;
    let oldestPrice: EphemeralMarketPrice | null = null;

    for (const entry of entries) {
      if (entry.estimatedCents !== null) {
        pricedCount++;
        totalEstimatedCents += entry.estimatedCents;

        const paidRaw = entry.journalEntry?.price_paid;
        if (
          paidRaw !== null &&
          paidRaw !== undefined &&
          Number.isFinite(Number(paidRaw))
        ) {
          matchedCount++;
          matchedCostBasisCents += Math.round(Number(paidRaw) * 100);
          matchedEstimatedCents += entry.estimatedCents;
        }
      }

      if (entry.price?.fetched_at) {
        const fetchedMs = Date.parse(entry.price.fetched_at);
        if (Number.isFinite(fetchedMs)) {
          if (fetchedMs > newestFetchedMs) {
            newestFetchedMs = fetchedMs;
            newestPrice = entry.price;
          }
          if (fetchedMs < oldestFetchedMs) {
            oldestFetchedMs = fetchedMs;
            oldestPrice = entry.price;
          }
        }
      }
    }

    const coveragePct =
      totalOwnedCount > 0
        ? Math.round((pricedCount / totalOwnedCount) * 100)
        : 0;
    const unrealizedDeltaCents = matchedEstimatedCents - matchedCostBasisCents;
    const unrealizedRoiPct =
      matchedCostBasisCents > 0
        ? Math.round((unrealizedDeltaCents / matchedCostBasisCents) * 100)
        : null;

    const topValuable = entries
      .filter(
        (e): e is ScopedOwnedEntry & { estimatedCents: number } =>
          e.estimatedCents !== null,
      )
      .sort((a, b) => b.estimatedCents - a.estimatedCents)
      .slice(0, 8);

    const now = this.nowMs();
    let disclosureText = 'No active live eBay snapshots in the last 6 hours.';
    if (oldestPrice && newestPrice) {
      if (oldestPrice === newestPrice || oldestFetchedMs === newestFetchedMs) {
        disclosureText = formatPriceAge(
          newestPrice.fetched_at,
          newestPrice.expires_at,
          now,
        );
      } else {
        disclosureText = `Live eBay active listings · Oldest snapshot: ${formatPriceAge(oldestPrice.fetched_at, oldestPrice.expires_at, now).replace('Live eBay active listings · ', '')}`;
      }
    }

    return {
      totalOwnedCount,
      pricedCount,
      coveragePct,
      totalEstimatedCents,
      matchedCount,
      matchedCostBasisCents,
      matchedEstimatedCents,
      unrealizedDeltaCents,
      unrealizedRoiPct,
      topValuable,
      disclosureText,
    };
  });

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

  public onScopeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value || 'all_owned';
    this.selectedScope.set(value);
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
    const scope = this.selectedScope();
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
      (e): e is ScopedOwnedEntry & { estimatedCents: number } =>
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
