import {
  Component,
  input,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { RouterModule } from '@angular/router';
import {
  Game,
  getMediaIconName,
  normalizeBudgetToken,
} from '../../../../core/models/collection.models';
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
  game = input.required<Game>();
  showPlatform = input<boolean>(false);

  toggleStatus = output<{ event: MouseEvent; game: Game }>();
  toggleCase = output<{ event: MouseEvent; game: Game }>();
  toggleManual = output<{ event: MouseEvent; game: Game }>();
  toggleDiscBackup = output<{
    event: MouseEvent;
    game: Game;
    discIndex: number;
  }>();

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

  onToggleDiscBackupClick(event: MouseEvent, discIndex: number): void {
    event.preventDefault();
    event.stopPropagation();
    this.toggleDiscBackup.emit({ event, game: this.game(), discIndex });
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

  public getDealArbitrageSavings(game: Game): number | null {
    if (!game.retail_price || !game.price_cib) return null;
    if (game.price_cib > game.retail_price) {
      return game.price_cib - game.retail_price;
    }
    return null;
  }

  public getGamePriceBadge(
    game: Game,
  ): { cents: number; label: string } | null {
    const isCib = Boolean(game.has_case) && Boolean(game.has_manual);
    if (isCib && game.price_cib) {
      return { cents: game.price_cib, label: 'CIB' };
    }
    if (game.price_loose) {
      return { cents: game.price_loose, label: 'Loose' };
    }
    if (game.retail_price) {
      return { cents: game.retail_price, label: game.retail_store || 'Retail' };
    }
    if (game.price_new) {
      return { cents: game.price_new, label: 'New' };
    }
    return null;
  }

  public getBackedUpDiscCount(game: Game): number {
    return (game.discBackups || []).filter((b) => b === 1).length;
  }

  public getMissingDiscCount(game: Game): number {
    const total = game.discIds?.length || 1;
    const backed = this.getBackedUpDiscCount(game);
    return Math.max(0, total - backed);
  }

  public getMediaIcon(
    game: Game,
    backedUp: boolean | number,
  ): 'disc' | 'rom-archive' | 'missing-dump' {
    return getMediaIconName(game.display_name || game.platform, backedUp);
  }

  public isUpcomingDate(releaseDate: string | null | undefined): boolean {
    if (!releaseDate) return false;
    return new Date(releaseDate) > new Date();
  }

  private normalizeBudgetToken(token: string): string | null {
    return normalizeBudgetToken(token);
  }
}
