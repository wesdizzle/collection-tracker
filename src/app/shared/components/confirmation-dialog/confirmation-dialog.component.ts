/**
 * CONFIRMATION DIALOG COMPONENT
 *
 * A Material 3 Expressive dialog for critical user confirmations.
 * Uses a native <dialog> element for proper modal semantics and Escape handling.
 */

import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-confirmation-dialog',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #dialogEl
      class="dialog-overlay"
      open
      aria-modal="true"
      aria-labelledby="confirmation-dialog-title"
      (click)="onBackdropClick($event)"
      (cancel)="$event.preventDefault(); onCancel()"
    >
      <div
        class="dialog-container m3-surface-container-high animate-expressive"
        (click)="$event.stopPropagation()"
      >
        <header class="dialog-header">
          <h3 id="confirmation-dialog-title" class="dialog-title">
            {{ title }}
          </h3>
        </header>
        <div class="dialog-body">
          <p>{{ message }}</p>

          @if (type === 'input') {
            <div class="input-container mt-md">
              <input
                #numberInput
                type="number"
                [(ngModel)]="inputValue"
                class="m3-input"
                aria-label="Confirmation input value"
                (keydown.enter)="onConfirm()"
                (keydown.escape)="onCancel()"
              />
            </div>
          }

          @if (type === 'options' && options) {
            <div class="options-container mt-md">
              @for (opt of options; track opt.value) {
                <button
                  type="button"
                  class="m3-button m3-button-filled state-layer option-btn"
                  (click)="onOptionSelect(opt.value)"
                >
                  {{ opt.label }}
                </button>
              }
            </div>
          }
        </div>
        @if (type !== 'options') {
          <footer class="dialog-footer">
            <button
              type="button"
              class="m3-button m3-button-text state-layer"
              (click)="onCancel()"
            >
              Cancel
            </button>
            <button
              type="button"
              class="m3-button m3-button-filled state-layer"
              (click)="onConfirm()"
            >
              Confirm
            </button>
          </footer>
        } @else {
          <footer class="dialog-footer options-footer">
            <button
              type="button"
              class="m3-button m3-button-text state-layer"
              (click)="onCancel()"
            >
              Cancel
            </button>
          </footer>
        }
      </div>
    </dialog>
  `,
  styles: [
    `
      .dialog-overlay {
        position: fixed;
        inset: 0;
        width: 100vw;
        max-width: 100vw;
        height: 100vh;
        max-height: 100vh;
        margin: 0;
        border: none;
        background: rgba(0, 0, 0, 0.75);
        backdrop-filter: blur(20px) contrast(90%) brightness(80%);
        -webkit-backdrop-filter: blur(20px) contrast(90%) brightness(80%);
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-24);
        overscroll-behavior: contain;
        transform: translateZ(0);
        will-change: transform, backdrop-filter;
      }

      .dialog-overlay::backdrop {
        background: transparent;
      }

      .dialog-container {
        width: 100%;
        max-width: 440px;
        padding: var(--spacing-32);
        border-radius: var(--radius-md);
        box-shadow: 0 24px 48px rgba(0, 0, 0, 0.5);
        border: 1px solid var(--m3-outline-variant);
        background: var(--m3-surface-container-high);
      }

      .dialog-header {
        margin-bottom: var(--spacing-16);
      }

      .dialog-title {
        font-size: 1.5rem;
        color: var(--m3-on-surface);
        margin: 0;
        font-family: var(--font-heading);
        font-weight: 700;
      }

      .dialog-body {
        color: var(--m3-on-surface-variant);
        font-size: 1.05rem;
        margin-bottom: var(--spacing-32);
        line-height: 1.6;
      }

      .input-container {
        margin-top: 1.5rem;
      }

      .m3-input {
        width: 100%;
        background: var(--m3-surface-container-highest);
        border: 2px solid var(--m3-primary);
        border-radius: var(--radius-sm);
        padding: 1rem;
        color: var(--m3-on-surface);
        font-size: 1.5rem;
        font-weight: 700;
        font-family: var(--font-body);
        text-align: center;
        outline: none;
        transition: all 0.2s ease;
      }

      .m3-input:focus {
        box-shadow: 0 0 0 4px var(--m3-primary-container);
      }

      .dialog-footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--spacing-16);
      }

      .m3-button {
        padding: 0.8rem 1.8rem;
        border-radius: var(--radius-full);
        font-weight: 600;
        cursor: pointer;
        border: none;
        transition: all 0.3s cubic-bezier(0.2, 0, 0, 1);
        font-family: var(--font-body);
        font-size: 0.9375rem;
        letter-spacing: 0.01em;
      }

      .m3-button-text {
        background: transparent;
        color: var(--m3-primary);
      }

      .m3-button-text:hover {
        background: var(--m3-primary-container);
        color: var(--m3-on-primary-container);
      }

      .m3-button-filled {
        background: var(--m3-primary);
        color: var(--m3-on-primary);
      }

      .m3-button-filled:hover {
        box-shadow: 0 8px 16px rgba(0, 0, 0, 0.4);
        transform: translateY(-2px);
        filter: brightness(1.1);
      }

      .m3-button-filled:active {
        transform: translateY(0);
      }

      .options-container {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-12);
        margin-top: var(--spacing-24);
      }

      .option-btn {
        width: 100%;
        padding: 1rem;
        font-size: 1.1rem;
        text-align: left;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--m3-surface-container-highest);
        color: var(--m3-on-surface);
        border: 1px solid var(--m3-outline-variant);
      }

      .option-btn:hover {
        background: var(--m3-primary-container);
        color: var(--m3-on-primary-container);
        border-color: var(--m3-primary);
      }

      .options-footer {
        justify-content: center;
        padding-top: var(--spacing-16);
      }
    `,
  ],
})
export class ConfirmationDialogComponent implements AfterViewInit {
  @Input() title = 'Confirm Action';
  @Input() message = 'Are you sure you want to proceed?';
  @Input() type: 'confirm' | 'input' | 'options' = 'confirm';
  @Input() inputValue?: string | number;
  @Input() options?: { label: string; value: string | number }[];

  @Output() confirm = new EventEmitter<void>();
  @Output() confirmWithInput = new EventEmitter<string | number>();
  @Output() cancel = new EventEmitter<void>();

  @ViewChild('dialogEl') dialogEl?: ElementRef<HTMLDialogElement>;
  @ViewChild('numberInput') numberInput?: ElementRef<HTMLInputElement>;

  ngAfterViewInit() {
    const dialog = this.dialogEl?.nativeElement;
    if (dialog && typeof dialog.showModal === 'function' && !dialog.open) {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute('open', '');
      }
    }
    if (this.type === 'input' && this.numberInput) {
      setTimeout(() => {
        this.numberInput?.nativeElement.focus();
        this.numberInput?.nativeElement.select();
      }, 100);
    }
  }

  onBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      this.onCancel();
    }
  }

  onConfirm() {
    if (this.type === 'input') {
      this.confirmWithInput.emit(this.inputValue ?? '');
    } else {
      this.confirm.emit();
    }
  }

  onOptionSelect(value: string | number) {
    this.confirmWithInput.emit(value);
  }

  onCancel() {
    this.cancel.emit();
  }
}
