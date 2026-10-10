import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { ConfirmationDialogComponent } from './shared/components/confirmation-dialog/confirmation-dialog.component';
import { CollectionService } from './core/services/collection.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ConfirmationDialogComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  public title = 'tracker';
  private collectionService = inject(CollectionService);
  private swUpdate = inject(SwUpdate, { optional: true });
  public dialogState = this.collectionService.dialogState;

  constructor() {
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
