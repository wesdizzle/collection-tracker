import {
  Component,
  ElementRef,
  ViewChild,
  computed,
  inject,
  input,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { RouterModule } from '@angular/router';
import {
  Game,
  formatPriceAge,
  getMediaIconName,
  getMediaNoun,
  getMissingMediaCount,
  getOwnedMediaCount,
  getTotalMediaCount,
  isMultiMediaRelease,
  normalizeBudgetToken,
} from '../../../../core/models/collection.models';
import {
  CompactProvenanceBadge,
  findGameJournalEntry,
  formatCompactProvenanceBadge,
} from '../../../../core/models/provenance-analytics';
import { CollectionService } from '../../../../core/services/collection.service';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-game-card',
  standalone: true,
  imports: [RouterModule, IconComponent],
  templateUrl: './game-card.component.html',
  styleUrls: ['./game-card.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameCardComponent {
  private readonly collectionService = inject(CollectionService);

  @ViewChild('coverImg') coverImg?: ElementRef<HTMLImageElement>;

  game = input.required<Game>();
  showPlatform = input<boolean>(false);
  showMediaDetails = input<boolean>(true);

  public readonly activeViewTransitionName = computed<string | null>(() => {
    const active = this.collectionService.activeTransitionItem();
    if (!active || active.type !== 'game') return null;
    const g = this.game();
    const matches =
      active.id === String(g.id) ||
      (g.game_id !== undefined && active.id === String(g.game_id)) ||
      (g.stable_id !== undefined && active.id === String(g.stable_id));
    return matches ? this.getCoverViewTransitionName(g) : null;
  });

  public readonly marketValueBadge = computed<{
    text: string;
    title: string;
  } | null>(() => {
    if (!this.collectionService.canViewMarketPrices?.()) return null;
    const nowMs = this.collectionService.marketPriceNowMs?.() ?? Date.now();
    const est = this.collectionService.getEstimatedValue?.(this.game(), 'game');
    if (!est || est.cents === null || !est.price) return null;
    const formatted =
      est.cents >= 100
        ? `Est. $${Math.round(est.cents / 100)}`
        : `Est. $${(est.cents / 100).toFixed(2)}`;
    const age = formatPriceAge(
      est.price.fetched_at,
      est.price.expires_at,
      nowMs,
    );
    return {
      text: formatted,
      title: `eBay ${est.tierLabel} · ${age} (Loose/CIB/New breakdown on detail)`,
    };
  });

  public readonly provenanceBadge = computed<CompactProvenanceBadge | null>(
    () => {
      if (!this.collectionService?.canShowPersonalState?.()) return null;
      const map = this.collectionService.journalEntriesMap?.();
      if (!map || map.size === 0) return null;
      const entry = findGameJournalEntry(this.game(), map);
      return formatCompactProvenanceBadge(entry);
    },
  );

  onCardActivate(): void {
    const g = this.game();
    const rawId = g.stable_id ?? g.id;
    this.collectionService.setActiveTransitionItem('game', rawId);
    const name = this.getCoverViewTransitionName(g);
    const imgEl = this.coverImg?.nativeElement;
    if (name && imgEl) {
      imgEl.style.setProperty('view-transition-name', name);
    }
  }

  toggleStatus = output<{ event: MouseEvent; game: Game }>();
  toggleCase = output<{ event: MouseEvent; game: Game }>();
  toggleManual = output<{ event: MouseEvent; game: Game }>();
  toggleMediaOwned = output<{ event: MouseEvent; game: Game }>();
  openDiscChecklist = output<{ event: MouseEvent; game: Game }>();

  onToggleStatusClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.toggleStatus.emit({ event, game: this.game() });
  }

  onToggleCaseClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.toggleCase.emit({ event, game: this.game() });
  }

  onToggleManualClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.toggleManual.emit({ event, game: this.game() });
  }

  onToggleMediaOwnedClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.toggleMediaOwned.emit({ event, game: this.game() });
  }

  onOpenDiscChecklistClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.openDiscChecklist.emit({ event, game: this.game() });
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

  public getCoverViewTransitionName(game: Game): string | null {
    const rawId = game.stable_id ?? game.id;
    if (!rawId) return null;
    const safeId = String(rawId).replace(/[^a-zA-Z0-9_-]/g, '-');
    return `catalog-media-game-${safeId}`;
  }

  public isUpcomingDate(releaseDate: string | null | undefined): boolean {
    if (!releaseDate) return false;
    return new Date(releaseDate) > new Date();
  }

  private normalizeBudgetToken(token: string): string | null {
    return normalizeBudgetToken(token);
  }
}
