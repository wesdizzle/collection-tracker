import {
  Component,
  inject,
  computed,
  signal,
  OnInit,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CollectionService } from '../../../core/services/collection.service';
import { Game, Toy } from '../../../core/models/collection.models';
import { IconComponent } from '../../../shared/components/icon/icon.component';

export interface PlatformCompletionStat {
  id: number;
  name: string;
  brand: string;
  logo?: string | null;
  ownedCount: number;
  catalogCount: number;
  completionPct: number;
  totalValue: number;
  backupCount: number;
  backupPct: number;
}

export interface SeriesStat {
  name: string;
  ownedCount: number;
  totalValue: number;
}

@Component({
  selector: 'app-collection-insights',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent],
  templateUrl: './collection-insights.component.html',
  styleUrl: './collection-insights.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollectionInsightsComponent implements OnInit {
  public readonly collectionService = inject(CollectionService);
  public isRefreshing = signal(false);

  async ngOnInit(): Promise<void> {
    if (
      this.collectionService.games().length === 0 &&
      this.collectionService.toys().length === 0
    ) {
      await this.refresh();
    }
  }

  async refresh(): Promise<void> {
    this.isRefreshing.set(true);
    try {
      await this.collectionService.refreshAll();
    } finally {
      this.isRefreshing.set(false);
    }
  }

  /** --- Effective Price Helpers --- */
  public getEffectiveGamePrice(game: Game): number | null {
    const isCib = Boolean(game.has_case) && Boolean(game.has_manual);
    if (isCib) {
      return game.price_cib ?? game.price_loose ?? null;
    }
    return game.price_loose ?? null;
  }

  public getEffectiveToyPrice(toy: Toy): number | null {
    return toy.price_loose ?? toy.price_cib ?? toy.price_new ?? null;
  }

  public formatCurrency(cents: number | null | undefined): string {
    if (!cents || cents <= 0) return '$0.00';
    return (cents / 100).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    });
  }

  public formatCurrencyDetailed(cents: number | null | undefined): string {
    if (!cents || cents <= 0) return '$0.00';
    return (cents / 100).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    });
  }

  /** --- Owned Datasets --- */
  public readonly ownedGames = computed<Game[]>(() =>
    this.collectionService.games().filter((g) => g.ownership_status === 1),
  );

  public readonly ownedToys = computed<Toy[]>(() =>
    this.collectionService.toys().filter((t) => t.ownership_status === 1),
  );

  public readonly seekingGamesCount = computed<number>(
    () =>
      this.collectionService.games().filter((g) => g.ownership_status === 2)
        .length,
  );

  /** --- Financial Valuation Metrics --- */
  public readonly totalGamesValue = computed<number>(() =>
    this.ownedGames().reduce(
      (sum, g) => sum + (this.getEffectiveGamePrice(g) || 0),
      0,
    ),
  );

  public readonly totalToysValue = computed<number>(() =>
    this.ownedToys().reduce(
      (sum, t) => sum + (this.getEffectiveToyPrice(t) || 0),
      0,
    ),
  );

  public readonly totalCollectionValue = computed<number>(
    () => this.totalGamesValue() + this.totalToysValue(),
  );

  public readonly cibTotalValue = computed<number>(() =>
    this.ownedGames().reduce(
      (sum, g) => sum + (g.price_cib || g.price_loose || 0),
      0,
    ),
  );

  public readonly looseTotalValue = computed<number>(() =>
    this.ownedGames().reduce((sum, g) => sum + (g.price_loose || 0), 0),
  );

  public readonly newTotalValue = computed<number>(() =>
    this.ownedGames().reduce(
      (sum, g) => sum + (g.price_new || g.price_cib || 0),
      0,
    ),
  );

  public readonly topValuableGames = computed<Game[]>(() => {
    return [...this.ownedGames()]
      .sort(
        (a, b) =>
          (this.getEffectiveGamePrice(b) || 0) -
          (this.getEffectiveGamePrice(a) || 0),
      )
      .slice(0, 5);
  });

  public readonly topValuableToys = computed<Toy[]>(() => {
    return [...this.ownedToys()]
      .sort(
        (a, b) =>
          (this.getEffectiveToyPrice(b) || 0) -
          (this.getEffectiveToyPrice(a) || 0),
      )
      .slice(0, 5);
  });

  /** --- Preservation & Backup Health --- */
  public readonly physicalOwnedGames = computed<Game[]>(() =>
    this.ownedGames().filter(
      (g) =>
        g.release_medium !== 'digital_extracted_rom' &&
        g.release_medium !== 'digital_native',
    ),
  );

  public readonly backedUpOwnedGames = computed<Game[]>(() =>
    this.physicalOwnedGames().filter((g) => Boolean(g.backup_status)),
  );

  public readonly backupRatePct = computed<number>(() => {
    const total = this.physicalOwnedGames().length;
    if (total === 0) return 0;
    return Math.round((this.backedUpOwnedGames().length / total) * 100);
  });

  public readonly missingBackupsCount = computed<number>(() =>
    Math.max(
      0,
      this.physicalOwnedGames().length - this.backedUpOwnedGames().length,
    ),
  );

  /** --- Condition Completeness --- */
  public readonly cibCount = computed<number>(
    () =>
      this.ownedGames().filter(
        (g) => Boolean(g.has_case) && Boolean(g.has_manual),
      ).length,
  );

  public readonly boxedOnlyCount = computed<number>(
    () =>
      this.ownedGames().filter((g) => Boolean(g.has_case) && !g.has_manual)
        .length,
  );

  public readonly looseCount = computed<number>(
    () => this.ownedGames().filter((g) => !g.has_case).length,
  );

  public readonly cibPct = computed<number>(() => {
    const total = this.ownedGames().length;
    return total > 0 ? Math.round((this.cibCount() / total) * 100) : 0;
  });

  public readonly boxedPct = computed<number>(() => {
    const total = this.ownedGames().length;
    return total > 0 ? Math.round((this.boxedOnlyCount() / total) * 100) : 0;
  });

  public readonly loosePct = computed<number>(() => {
    const total = this.ownedGames().length;
    return total > 0 ? Math.round((this.looseCount() / total) * 100) : 0;
  });

  /** --- Platform Distribution & Completion --- */
  public readonly platformStats = computed<PlatformCompletionStat[]>(() => {
    const platforms = this.collectionService.platforms();
    const games = this.collectionService.games();
    const owned = this.ownedGames();

    const stats: PlatformCompletionStat[] = [];

    for (const p of platforms) {
      // Catalog games belonging to this platform or children
      const catalog = games.filter(
        (g) => g.platform_id === p.id || g.parent_platform_id === p.id,
      );
      if (catalog.length === 0) continue;

      const ownedOnPlatform = owned.filter(
        (g) => g.platform_id === p.id || g.parent_platform_id === p.id,
      );
      const backedUp = ownedOnPlatform.filter((g) => Boolean(g.backup_status));
      const totalVal = ownedOnPlatform.reduce(
        (sum, g) => sum + (this.getEffectiveGamePrice(g) || 0),
        0,
      );

      const completionPct =
        catalog.length > 0
          ? Math.round((ownedOnPlatform.length / catalog.length) * 100)
          : 0;
      const backupPct =
        ownedOnPlatform.length > 0
          ? Math.round((backedUp.length / ownedOnPlatform.length) * 100)
          : 0;

      stats.push({
        id: p.id,
        name: p.display_name || p.name,
        brand: p.brand || 'Other',
        logo: p.image_url,
        ownedCount: ownedOnPlatform.length,
        catalogCount: catalog.length,
        completionPct,
        totalValue: totalVal,
        backupCount: backedUp.length,
        backupPct,
      });
    }

    // Sort by owned count desc, then total value desc
    return stats.sort(
      (a, b) => b.ownedCount - a.ownedCount || b.totalValue - a.totalValue,
    );
  });

  /** --- Franchise Representation --- */
  public readonly topSeries = computed<SeriesStat[]>(() => {
    const seriesMap = new Map<string, { count: number; value: number }>();

    for (const g of this.ownedGames()) {
      const s = g.canonical_series || g.series || 'Other';
      const existing = seriesMap.get(s) || { count: 0, value: 0 };
      existing.count += 1;
      existing.value += this.getEffectiveGamePrice(g) || 0;
      seriesMap.set(s, existing);
    }

    return Array.from(seriesMap.entries())
      .map(([name, data]) => ({
        name,
        ownedCount: data.count,
        totalValue: data.value,
      }))
      .sort(
        (a, b) => b.ownedCount - a.ownedCount || b.totalValue - a.totalValue,
      )
      .slice(0, 8);
  });

  /** --- Play Status / Backlog Breakdown --- */
  public readonly playStatusStats = computed(() => {
    const owned = this.ownedGames();
    const total = owned.length;

    const played = owned.filter((g) => g.play_status === 1).length;
    const playing = owned.filter((g) => g.play_status === 2).length;
    const queued = owned.filter((g) => g.play_status === 3).length;
    const paused = owned.filter((g) => g.play_status === 4).length;
    const dropped = owned.filter((g) => g.play_status === 5).length;
    const unplayed = owned.filter(
      (g) => g.play_status === 0 || g.play_status === undefined,
    ).length;

    return {
      played,
      playing,
      queued,
      paused,
      dropped,
      unplayed,
      playedPct: total > 0 ? Math.round((played / total) * 100) : 0,
      backlogPct:
        total > 0 ? Math.round(((unplayed + queued) / total) * 100) : 0,
    };
  });
}
