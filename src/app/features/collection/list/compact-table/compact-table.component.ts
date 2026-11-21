import {
  Component,
  inject,
  input,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { RouterModule } from '@angular/router';
import {
  Game,
  Toy,
  FilterState,
  formatPriceAge,
  getMediaIconName,
  getMediaNoun,
  getMissingMediaCount,
  getOwnedMediaCount,
  getTotalMediaCount,
  isMultiMediaRelease,
  normalizeBudgetToken,
  formatToyRegionBadge,
} from '../../../../core/models/collection.models';
import {
  CompactProvenanceBadge,
  findGameJournalEntry,
  findToyJournalEntry,
  formatCompactProvenanceBadge,
} from '../../../../core/models/provenance-analytics';
import { CollectionService } from '../../../../core/services/collection.service';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-compact-table',
  standalone: true,
  imports: [RouterModule, IconComponent],
  templateUrl: './compact-table.component.html',
  styleUrls: ['./compact-table.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompactTableComponent {
  private readonly collectionService = inject(CollectionService, {
    optional: true,
  });

  mode = input.required<'games' | 'toys'>();
  games = input<Game[]>([]);
  toys = input<Toy[]>([]);
  filters = input<FilterState>();
  showMediaDetails = input<boolean>(true);

  toggleGameStatus = output<{ event: MouseEvent; game: Game }>();
  toggleCase = output<{ event: MouseEvent; game: Game }>();
  toggleManual = output<{ event: MouseEvent; game: Game }>();
  toggleMediaOwned = output<{ event: MouseEvent; game: Game }>();
  openDiscChecklist = output<{ event: MouseEvent; game: Game }>();

  toggleToyStatus = output<{ event: MouseEvent; toy: Toy }>();

  onToggleGameStatusClick(event: MouseEvent, game: Game): void {
    event.preventDefault();
    event.stopPropagation();
    this.toggleGameStatus.emit({ event, game });
  }

  onToggleCaseClick(event: MouseEvent, game: Game): void {
    event.preventDefault();
    event.stopPropagation();
    this.toggleCase.emit({ event, game });
  }

  onToggleManualClick(event: MouseEvent, game: Game): void {
    event.preventDefault();
    event.stopPropagation();
    this.toggleManual.emit({ event, game });
  }

  onToggleMediaOwnedClick(event: MouseEvent, game: Game): void {
    event.preventDefault();
    event.stopPropagation();
    this.toggleMediaOwned.emit({ event, game });
  }

  onOpenDiscChecklistClick(event: MouseEvent, game: Game): void {
    event.preventDefault();
    event.stopPropagation();
    this.openDiscChecklist.emit({ event, game });
  }

  onToggleToyStatusClick(event: MouseEvent, toy: Toy): void {
    event.preventDefault();
    event.stopPropagation();
    this.toggleToyStatus.emit({ event, toy });
  }

  public isBudgetLabel(label: string): boolean {
    return this.normalizeBudgetToken(label) !== null;
  }

  public getOptionalBudgetLabels(game: Game): string[] {
    if (!game.also_released_as) return [];
    const existingVariants = new Set(
      (game.variants || '')
        .split(',')
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean),
    );
    const result: string[] = [];
    for (const rawToken of game.also_released_as.split(',')) {
      const canonical = this.normalizeBudgetToken(rawToken);
      if (!canonical) continue;
      const lower = canonical.toLowerCase();
      if (!existingVariants.has(lower) && !result.includes(canonical)) {
        result.push(canonical);
      }
    }
    return result;
  }

  public getGamePriceBadge(
    item: Game | Toy,
  ): { cents: number; label: string } | null {
    if (item.retail_price) {
      return { cents: item.retail_price, label: item.retail_store || 'Retail' };
    }
    return null;
  }

  public getMarketValueBadge(
    item: Game | Toy,
    itemType: 'game' | 'toy',
  ): { cents: number; text: string; title: string } | null {
    if (!this.collectionService?.canViewMarketPrices?.()) return null;
    const nowMs = this.collectionService.marketPriceNowMs?.() ?? Date.now();
    const est = this.collectionService.getEstimatedValue?.(item, itemType);
    if (!est || est.cents === null || !est.price) return null;
    const text =
      est.cents >= 100
        ? `Est. $${Math.round(est.cents / 100)}`
        : `Est. $${(est.cents / 100).toFixed(2)}`;
    const age = formatPriceAge(
      est.price.fetched_at,
      est.price.expires_at,
      nowMs,
    );
    return {
      cents: est.cents,
      text,
      title: `eBay ${est.tierLabel} · ${age}`,
    };
  }

  public getProvenanceBadge(
    item: Game | Toy,
    itemType: 'game' | 'toy',
  ): CompactProvenanceBadge | null {
    if (!this.collectionService?.canShowPersonalState?.()) return null;
    const map = this.collectionService.journalEntriesMap?.();
    if (!map || map.size === 0) return null;
    const entry =
      itemType === 'game'
        ? findGameJournalEntry(item as Game, map)
        : findToyJournalEntry(item as Toy, map);
    return formatCompactProvenanceBadge(entry);
  }

  public isMultiDisc(game: Game): boolean {
    return isMultiMediaRelease(game);
  }

  public getTotalDiscCount(game: Game): number {
    return getTotalMediaCount(game);
  }

  public getOwnedDiscCount(game: Game): number {
    return getOwnedMediaCount(game);
  }

  public getMissingDiscCount(game: Game): number {
    return getMissingMediaCount(game);
  }

  public getMediaIcon(
    game: Game,
    mediaOwned: boolean | number,
  ): 'disc' | 'rom-archive' | 'missing-dump' {
    return getMediaIconName(game.display_name || game.platform, mediaOwned);
  }

  public getSingleMediaTooltip(game: Game): string {
    const noun = getMediaNoun(game.display_name || game.platform, false);
    return game.has_media
      ? `${noun} Owned — Click to toggle`
      : `Missing ${noun} — Click to toggle`;
  }

  public getMultiDiscTooltip(game: Game): string {
    const total = getTotalMediaCount(game);
    const owned = getOwnedMediaCount(game);
    const plural = getMediaNoun(game.display_name || game.platform, true);
    return `${owned}/${total} ${plural} Owned — Click to manage ${plural.toLowerCase()}`;
  }

  public isUpcomingDate(releaseDate: string | null | undefined): boolean {
    if (!releaseDate) return false;
    return new Date(releaseDate) > new Date();
  }

  public formatToyRegion(region: string | null | undefined): string {
    return formatToyRegionBadge(region);
  }

  private normalizeBudgetToken(token: string): string | null {
    return normalizeBudgetToken(token);
  }
}
