import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  inject,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { KitThemeService } from '@wesdizzle/app-kit/angular';
import { ConfirmationDialogComponent } from './shared/components/confirmation-dialog/confirmation-dialog.component';
import { CommandPaletteComponent } from './shared/components/command-palette/command-palette.component';
import { CollectionService } from './core/services/collection.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ConfirmationDialogComponent, CommandPaletteComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnDestroy {
  public title = 'tracker';
  private collectionService = inject(CollectionService);
  private themeService = inject(KitThemeService);
  private swUpdate = inject(SwUpdate, { optional: true });
  public dialogState = this.collectionService.dialogState;
  private visibilityListener?: () => void;

  constructor() {
    this.themeService.init('collection-theme', ['app-theme', 'theme'], 'auto', {
      darkThemeColor: '#121214',
      lightThemeColor: '#f8fafc',
    });

    if (this.swUpdate?.isEnabled) {
      this.swUpdate.versionUpdates.subscribe((event) => {
        if (event.type === 'VERSION_READY') {
          this.swUpdate?.activateUpdate().then(() => {
            if (typeof window !== 'undefined') {
              window.location.reload();
            }
          });
        }
      });
      this.swUpdate.checkForUpdate?.().catch(() => {});
      if (typeof document !== 'undefined') {
        this.visibilityListener = () => {
          if (document.visibilityState === 'visible') {
            this.swUpdate?.checkForUpdate?.().catch(() => {});
          }
        };
        document.addEventListener('visibilitychange', this.visibilityListener);
      }
    }
  }

  ngOnDestroy(): void {
    if (typeof document !== 'undefined' && this.visibilityListener) {
      document.removeEventListener('visibilitychange', this.visibilityListener);
      this.visibilityListener = undefined;
    }
  }

  onConfirm(value?: string | number) {
    const state = this.dialogState();
    if (state.onConfirm) {
      state.onConfirm(value);
    }
    this.collectionService.closeDialog();
  }

  onCancel() {
    this.collectionService.closeDialog();
  }
}
