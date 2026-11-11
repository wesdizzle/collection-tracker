import {
  Component,
  input,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { RouterModule } from '@angular/router';
import {
  Game,
  Toy,
  FilterState,
  getMediaIconName,
  normalizeBudgetToken,
} from '../../../../core/models/collection.models';
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
  mode = input.required<'games' | 'toys'>();
  games = input<Game[]>([]);
  toys = input<Toy[]>([]);
  filters = input<FilterState>();
  showBackupDetails = input<boolean>(true);

  toggleGameStatus = output<{ event: MouseEvent; game: Game }>();
  toggleCase = output<{ event: MouseEvent; game: Game }>();
  toggleManual = output<{ event: MouseEvent; game: Game }>();
  toggleDiscBackup = output<{
    event: MouseEvent;
    game: Game;
    discIndex: number;
  }>();

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

  onToggleDiscBackupClick(
    event: MouseEvent,
    game: Game,
    discIndex: number,
  ): void {
    event.preventDefault();
    event.stopPropagation();
    this.toggleDiscBackup.emit({ event, game, discIndex });
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
    game: Game,
  ): { cents: number; label: string } | null {
    if (game.retail_price) {
      return { cents: game.retail_price, label: game.retail_store || 'Retail' };
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
