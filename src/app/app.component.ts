import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConfirmationDialogComponent } from './shared/components/confirmation-dialog/confirmation-dialog.component';
import { CollectionService } from './core/services/collection.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ConfirmationDialogComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  public title = 'tracker';
  private collectionService = inject(CollectionService);
  public dialogState = this.collectionService.dialogState;

  onConfirm() {
    const state = this.dialogState();
    if (state.onConfirm) {
      state.onConfirm();
    }
    this.collectionService.closeDialog();
  }

  onCancel() {
    this.collectionService.closeDialog();
  }
}
