/**
 * CONFIRMATION DIALOG COMPONENT
 * 
 * A Material 3 Expressive dialog for critical user confirmations.
 * Designed to be centered in the viewport with a blurred backdrop.
 */

import { Component, EventEmitter, Input, Output, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-confirmation-dialog',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="dialog-overlay" (click)="onCancel()">
      <div class="dialog-container m3-surface-container-high animate-expressive" (click)="$event.stopPropagation()">
        <header class="dialog-header">
          <h3 class="dialog-title">{{ title }}</h3>
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
                (keydown.enter)="onConfirm()"
                (keydown.escape)="onCancel()">
            </div>
          }
        </div>
        <footer class="dialog-footer">
          <button class="m3-button m3-button-text state-layer" (click)="onCancel()">Cancel</button>
          <button class="m3-button m3-button-filled state-layer" (click)="onConfirm()">Confirm</button>
        </footer>
      </div>
    </div>
  `,
  styles: [`
    .dialog-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(20px) contrast(90%) brightness(80%);
      -webkit-backdrop-filter: blur(20px) contrast(90%) brightness(80%);
      z-index: 99999; /* Ensure it stays above everything */
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-24);
      overscroll-behavior: contain;
      transform: translateZ(0);
      will-change: transform, backdrop-filter;
    }

    .dialog-container {
      width: 100%;
      max-width: 440px;
      padding: var(--spacing-32);
      border-radius: var(--radius-md);
      box-shadow: 0 24px 48px rgba(0,0,0,0.5);
      border: 1px solid var(--m3-outline-variant);
      background: var(--m3-surface-container-high);
    }

    .dialog-header {
      margin-bottom: var(--spacing-16);
    }

    .dialog-title {
      font-size: 1.75rem;
      color: var(--m3-on-surface);
      margin: 0;
      font-family: var(--font-display);
      font-weight: 700;
    }

    .dialog-body {
      color: var(--m3-on-surface-variant);
      font-size: 1.1rem;
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
      font-family: var(--font-heading);
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
      font-weight: 700;
      cursor: pointer;
      border: none;
      transition: all 0.3s cubic-bezier(0.2, 0, 0, 1);
      font-family: var(--font-heading);
      font-size: 0.95rem;
      letter-spacing: 0.02em;
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
      box-shadow: 0 8px 16px rgba(0,0,0,0.4);
      transform: translateY(-2px);
      filter: brightness(1.1);
    }

    .m3-button-filled:active {
      transform: translateY(0);
    }
  `]
})
export class ConfirmationDialogComponent implements AfterViewInit {
  @Input() title = 'Confirm Action';
  @Input() message = 'Are you sure you want to proceed?';
  @Input() type: 'confirm' | 'input' = 'confirm';
  @Input() inputValue?: string | number;
  
  @Output() confirm = new EventEmitter<void>();
  @Output() confirmWithInput = new EventEmitter<string | number>();
  @Output() cancel = new EventEmitter<void>();

  @ViewChild('numberInput') numberInput?: ElementRef<HTMLInputElement>;

  ngAfterViewInit() {
    if (this.type === 'input' && this.numberInput) {
      setTimeout(() => {
        this.numberInput?.nativeElement.focus();
        this.numberInput?.nativeElement.select();
      }, 100);
    }
  }

  onConfirm() { 
    if (this.type === 'input') {
      this.confirmWithInput.emit(this.inputValue ?? '');
    } else {
      this.confirm.emit();
    }
  }

  onCancel() { this.cancel.emit(); }
}
