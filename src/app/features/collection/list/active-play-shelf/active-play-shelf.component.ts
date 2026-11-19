import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterModule } from '@angular/router';
import { Game, PlayStatus } from '../../../../core/models/collection.models';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

const SHELF_COLLAPSED_STORAGE_KEY = 'collection_active_play_shelf_collapsed';

function readInitialCollapsed(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(SHELF_COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

@Component({
  selector: 'app-active-play-shelf',
  standalone: true,
  imports: [RouterModule, IconComponent],
  templateUrl: './active-play-shelf.component.html',
  styleUrl: './active-play-shelf.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActivePlayShelfComponent {
  public readonly PlayStatus = PlayStatus;

  public readonly playingGames = input.required<readonly Game[]>();
  public readonly queuedGames = input.required<readonly Game[]>();
  public readonly busyGameIds = input<ReadonlySet<string>>(new Set());

  public readonly advanceStatus = output<{
    game: Game;
    nextStatus: PlayStatus;
  }>();
  public readonly filterByStatus = output<PlayStatus>();

  public readonly collapsed = signal<boolean>(readInitialCollapsed());

  public readonly visiblePlayingGames = computed<readonly Game[]>(() =>
    this.playingGames().slice(0, 6),
  );

  public readonly visibleQueuedGames = computed<readonly Game[]>(() =>
    this.queuedGames().slice(0, 6),
  );

  public toggleCollapsed(): void {
    const next = !this.collapsed();
    this.collapsed.set(next);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(SHELF_COLLAPSED_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Ignore storage errors in restricted environments
      }
    }
  }

  public onFilterClick(event: MouseEvent, status: PlayStatus): void {
    event.stopPropagation();
    this.filterByStatus.emit(status);
  }

  public onAdvanceClick(
    event: MouseEvent,
    game: Game,
    nextStatus: PlayStatus,
  ): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.busyGameIds().has(game.id)) return;
    this.advanceStatus.emit({ game, nextStatus });
  }
}
