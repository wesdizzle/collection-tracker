import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  BottomSheetDragController,
  canAnimateKitDialogExit,
} from '@wesdizzle/app-kit/angular';
import {
  Game,
  getMediaNoun,
  getReleaseMediaItems,
} from '../../../../core/models/collection.models';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

export interface DiscChecklistRow {
  releaseId: string;
  label: string;
  owned: boolean;
}

@Component({
  selector: 'app-disc-ownership-modal',
  standalone: true,
  imports: [RouterLink, IconComponent],
  templateUrl: './disc-ownership-modal.component.html',
  styleUrl: './disc-ownership-modal.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscOwnershipModalComponent implements AfterViewInit {
  private readonly destroyRef = inject(DestroyRef);

  public readonly game = input<Game | null>(null);
  public readonly isSaving = input<boolean>(false);

  public readonly closed = output<void>();
  public readonly toggleDisc = output<{
    releaseId: string;
    nextValue: 0 | 1;
  }>();
  public readonly setAllDiscs = output<{
    releaseIds: string[];
    nextValue: 0 | 1;
  }>();

  @ViewChild('dialogEl') dialogRef?: ElementRef<HTMLDialogElement>;

  public readonly isEntering = signal(false);
  public readonly isClosing = signal(false);
  private wasOpen = false;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;

  public readonly sheetDrag = new BottomSheetDragController(59);
  public readonly sheetTransformY = this.sheetDrag.effectiveTransformY;
  public readonly isDraggingSheet = this.sheetDrag.isDragging;

  public readonly effectiveTransformY = computed<number | null>(() => {
    if (this.isClosing()) return null;
    if (this.isDraggingSheet()) return this.sheetTransformY();
    return null;
  });

  public readonly mediaNoun = computed(() =>
    getMediaNoun(this.game()?.display_name || this.game()?.platform, false),
  );

  public readonly mediaNounPlural = computed(() =>
    getMediaNoun(this.game()?.display_name || this.game()?.platform, true),
  );

  public readonly discRows = computed<DiscChecklistRow[]>(() => {
    const g = this.game();
    if (!g) return [];
    const noun = getMediaNoun(g.display_name || g.platform, false);
    return getReleaseMediaItems(g).map((item, idx) => ({
      releaseId: item.id,
      label: item.label || `${noun} ${idx + 1}`,
      owned: item.hasMedia === 1,
    }));
  });

  public readonly ownedCount = computed(
    () => this.discRows().filter((r) => r.owned).length,
  );

  public readonly totalCount = computed(() => this.discRows().length);

  public readonly allOwned = computed(
    () => this.totalCount() > 0 && this.ownedCount() === this.totalCount(),
  );

  public readonly anyOwned = computed(() => this.ownedCount() > 0);

  public readonly detailRoute = computed(() => {
    const g = this.game();
    return g
      ? ['/game', g.stable_id ?? g.game_id ?? g.id]
      : ['/collection/games'];
  });

  constructor() {
    effect(() => {
      const open = this.game() !== null;
      if (open && !this.wasOpen) {
        this.wasOpen = true;
        this.isClosing.set(false);
        this.sheetDrag.reset();
        if (typeof document !== 'undefined') {
          document.body.style.overflow = 'hidden';
        }
        this.openDialog();
        this.isEntering.set(true);
        setTimeout(() => {
          this.isEntering.set(false);
        }, 280);
      } else if (!open && this.wasOpen) {
        this.wasOpen = false;
        this.isClosing.set(false);
        this.isEntering.set(false);
        this.sheetDrag.reset();
        if (typeof document !== 'undefined') {
          document.body.style.overflow = '';
        }
        this.closeDialog();
      }
    });

    this.destroyRef.onDestroy(() => {
      if (this.closeTimer !== null) {
        clearTimeout(this.closeTimer);
        this.closeTimer = null;
      }
      if (typeof document !== 'undefined') {
        document.body.style.overflow = '';
      }
    });
  }

  public ngAfterViewInit(): void {
    if (this.game() !== null) {
      this.openDialog();
    }
  }

  private openDialog(): void {
    const dialog = this.dialogRef?.nativeElement;
    if (!dialog) return;
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') {
        try {
          dialog.showModal();
        } catch {
          dialog.setAttribute('open', '');
        }
      } else {
        dialog.setAttribute('open', '');
      }
    }
  }

  private closeDialog(): void {
    const dialog = this.dialogRef?.nativeElement;
    if (!dialog) return;
    if (dialog.open || dialog.hasAttribute('open')) {
      if (typeof dialog.close === 'function') {
        try {
          dialog.close();
        } catch {
          dialog.removeAttribute('open');
        }
      } else {
        dialog.removeAttribute('open');
      }
    }
  }

  public requestDismiss(): void {
    if (this.isClosing()) return;
    if (canAnimateKitDialogExit(this.dialogRef?.nativeElement)) {
      this.isClosing.set(true);
      this.closeTimer = setTimeout(() => {
        this.closeTimer = null;
        this.isClosing.set(false);
        this.sheetDrag.reset();
        this.closed.emit();
      }, 200);
      return;
    }
    this.closed.emit();
  }

  public onDialogClick(event: MouseEvent): void {
    const dialog = this.dialogRef?.nativeElement;
    if (!dialog) return;
    const rect = dialog.getBoundingClientRect();
    const isInDialog =
      rect.top <= event.clientY &&
      event.clientY <= rect.top + rect.height &&
      rect.left <= event.clientX &&
      event.clientX <= rect.left + rect.width;
    if (!isInDialog) {
      this.requestDismiss();
    }
  }

  public onDialogCancel(event: Event): void {
    event.preventDefault();
    this.requestDismiss();
  }

  public onToggleRow(row: DiscChecklistRow): void {
    if (this.isSaving()) return;
    this.toggleDisc.emit({
      releaseId: row.releaseId,
      nextValue: row.owned ? 0 : 1,
    });
  }

  public onMarkAll(): void {
    if (this.isSaving() || this.allOwned()) return;
    const releaseIds = this.discRows()
      .filter((r) => !r.owned)
      .map((r) => r.releaseId);
    if (releaseIds.length > 0) {
      this.setAllDiscs.emit({ releaseIds, nextValue: 1 });
    }
  }

  public onClearAll(): void {
    if (this.isSaving() || !this.anyOwned()) return;
    const releaseIds = this.discRows()
      .filter((r) => r.owned)
      .map((r) => r.releaseId);
    if (releaseIds.length > 0) {
      this.setAllDiscs.emit({ releaseIds, nextValue: 0 });
    }
  }

  public onNavigateToDetails(): void {
    this.closed.emit();
  }

  public onDragHandleTouchStart(event: TouchEvent): void {
    this.sheetDrag.onTouchStart(event);
  }

  public onDragHandleTouchMove(event: TouchEvent): void {
    this.sheetDrag.onTouchMove(event);
  }

  public onDragHandleTouchEnd(): void {
    this.sheetDrag.onTouchEnd(() => {
      this.isClosing.set(true);
      this.closeTimer = setTimeout(() => {
        this.closeTimer = null;
        this.isClosing.set(false);
        this.sheetDrag.reset();
        this.closed.emit();
      }, 220);
    });
  }
}
