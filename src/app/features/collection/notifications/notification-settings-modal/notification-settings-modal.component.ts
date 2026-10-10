import {
  Component,
  signal,
  output,
  inject,
  HostListener,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NotificationService } from '../../../../core/services/notification.service';
import { DealNotificationPreferences } from '../../../../core/models/collection.models';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

interface PlatformOption {
  id: number;
  name: string;
}

const COMMON_PLATFORMS: PlatformOption[] = [
  { id: 26, name: 'Nintendo Switch' },
  { id: 33, name: 'PlayStation Vita' },
  { id: 28, name: 'PlayStation 4' },
  { id: 34, name: 'PlayStation 5' },
  { id: 18, name: 'Nintendo 3DS' },
  { id: 24, name: 'PlayStation 3' },
];

@Component({
  selector: 'app-notification-settings-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div
      class="modal-backdrop fade-in"
      (click)="onBackdropClick($event)"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div class="modal-card state-layer">
        <!-- Header -->
        <div class="modal-header">
          <div class="flex items-center gap-xs">
            <span class="header-icon"
              ><app-icon name="bell" [size]="20"
            /></span>
            <h2 id="modal-title" class="modal-title">Deal Alert Settings</h2>
          </div>
          <button
            type="button"
            class="close-button state-layer"
            (click)="close.emit()"
            aria-label="Close settings"
          >
            <app-icon name="close" [size]="18" />
          </button>
        </div>

        <!-- Body -->
        <div class="modal-body">
          <!-- Browser Support & Permission Banners -->
          @if (!notificationService.isSupported()) {
            <div class="alert-banner warning">
              <span class="banner-icon"
                ><app-icon name="alert-triangle" [size]="18"
              /></span>
              <div>
                <strong>Web Push Unsupported</strong>
                <p class="text-xs mt-3xs">
                  Push notifications are not supported in this browser. On iOS,
                  install the app via <em>"Add to Home Screen"</em> in Safari
                  first.
                </p>
              </div>
            </div>
          } @else if (notificationService.permissionState() === 'denied') {
            <div class="alert-banner danger">
              <span class="banner-icon"
                ><app-icon name="ban" [size]="18"
              /></span>
              <div>
                <strong>Notifications Blocked</strong>
                <p class="text-xs mt-3xs">
                  Notification permissions are currently denied in your browser.
                  Please allow notifications in site permissions to receive
                  alerts.
                </p>
              </div>
            </div>
          }

          <!-- Master Switch Row -->
          <div class="setting-row master-switch-row">
            <div>
              <div class="font-semibold text-sm">Push Notifications</div>
              <div class="text-xs text-muted">
                Receive native OS alerts when matching deals are found
              </div>
            </div>
            <div class="flex items-center gap-xs">
              @if (notificationService.isSubscribed()) {
                <span class="status-chip active">Active</span>
                <button
                  type="button"
                  class="btn-toggle active"
                  [disabled]="notificationService.isProcessing()"
                  (click)="onToggleMaster(false)"
                  aria-label="Disable notifications"
                >
                  <span class="toggle-knob"></span>
                </button>
              } @else {
                <span class="status-chip inactive">Disabled</span>
                <button
                  type="button"
                  class="btn-toggle inactive"
                  [disabled]="
                    notificationService.isProcessing() ||
                    !notificationService.isSupported() ||
                    notificationService.permissionState() === 'denied'
                  "
                  (click)="onToggleMaster(true)"
                  aria-label="Enable notifications"
                >
                  <span class="toggle-knob"></span>
                </button>
              }
            </div>
          </div>

          <!-- Dimension 1: Collection Scope -->
          <div class="setting-section">
            <label class="section-label">Collection Scope</label>
            <div class="segmented-group">
              <button
                type="button"
                class="segmented-btn"
                [class.active]="localPrefs.scope === 'seeking_only'"
                (click)="setScope('seeking_only')"
              >
                Seeking Only
              </button>
              <button
                type="button"
                class="segmented-btn"
                [class.active]="localPrefs.scope === 'seeking_and_unowned'"
                (click)="setScope('seeking_and_unowned')"
              >
                Seeking & Unowned
              </button>
              <button
                type="button"
                class="segmented-btn"
                [class.active]="localPrefs.scope === 'all'"
                (click)="setScope('all')"
              >
                All Games
              </button>
            </div>
            <span class="text-2xs text-muted mt-3xs">
              {{ scopeDescription() }}
            </span>
          </div>

          <!-- Dimension 2: Minimum Discount -->
          <div class="setting-section">
            <label class="section-label">Minimum Discount</label>
            <div class="chip-group">
              @for (disc of discountOptions; track disc) {
                <button
                  type="button"
                  class="filter-chip"
                  [class.active]="localPrefs.minDiscountPct === disc"
                  (click)="setMinDiscount(disc)"
                >
                  {{ disc === 0 ? 'Any Deal' : disc + '%+ Off' }}
                </button>
              }
            </div>
          </div>

          <!-- Dimension 3: Stores / Retailers -->
          <div class="setting-section">
            <label class="section-label">Retail Stores</label>
            <div class="chip-group">
              @for (store of storeOptions; track store) {
                <button
                  type="button"
                  class="filter-chip"
                  [class.active]="isStoreSelected(store)"
                  (click)="toggleStore(store)"
                >
                  {{ isStoreSelected(store) ? '✓ ' : '+ ' }}{{ store }}
                </button>
              }
            </div>
          </div>

          <!-- Dimension 4: Price Ceiling -->
          <div class="setting-section">
            <label class="section-label">Maximum Price Cap (Optional)</label>
            <div class="flex items-center gap-xs">
              <div class="price-input-wrapper">
                <span class="currency-symbol">$</span>
                <input
                  type="number"
                  class="price-input"
                  placeholder="No limit"
                  min="0"
                  step="5"
                  [ngModel]="maxPriceDollars()"
                  (ngModelChange)="onPriceChange($event)"
                />
              </div>
              @if (localPrefs.maxPriceCents !== null) {
                <button
                  type="button"
                  class="btn-text text-xs"
                  (click)="clearMaxPrice()"
                >
                  Clear Cap
                </button>
              }
            </div>
          </div>

          <!-- Dimension 5: Platforms Filter -->
          <div class="setting-section">
            <div class="flex items-center justify-between">
              <label class="section-label">Platforms</label>
              <button
                type="button"
                class="btn-text text-2xs"
                (click)="toggleAllPlatforms()"
              >
                {{
                  localPrefs.platformIds.length === 0
                    ? 'Restrict Platforms'
                    : 'All Platforms'
                }}
              </button>
            </div>
            @if (localPrefs.platformIds.length === 0) {
              <div class="text-xs text-muted">
                Currently tracking deals across all platforms.
              </div>
            } @else {
              <div class="chip-group mt-3xs">
                @for (plat of platforms; track plat.id) {
                  <button
                    type="button"
                    class="filter-chip"
                    [class.active]="isPlatformSelected(plat.id)"
                    (click)="togglePlatform(plat.id)"
                  >
                    {{ isPlatformSelected(plat.id) ? '✓ ' : '+ '
                    }}{{ plat.name }}
                  </button>
                }
              </div>
            }
          </div>

          <!-- Test Alert Section -->
          @if (notificationService.isSubscribed() || testMessage()) {
            <div class="test-alert-box">
              <div class="flex items-center justify-between">
                <div>
                  <div class="font-semibold text-xs">Verify Alert Delivery</div>
                  <div class="text-2xs text-muted">
                    Send an instant test notification to this handset
                  </div>
                </div>
                <button
                  type="button"
                  class="btn-secondary text-xs"
                  [disabled]="
                    !notificationService.isSubscribed() ||
                    notificationService.isProcessing() ||
                    isTestingAlert()
                  "
                  (click)="onSendTest()"
                >
                  {{ isTestingAlert() ? 'Sending...' : 'Send Test' }}
                </button>
              </div>
              @if (testMessage()) {
                <div
                  class="text-2xs mt-3xs"
                  [class.text-success]="testSuccess()"
                  [class.text-danger]="!testSuccess()"
                >
                  {{ testMessage() }}
                </div>
              }
            </div>
          }
        </div>

        <!-- Footer -->
        <div class="modal-footer">
          @if (saveMessage()) {
            <span class="save-feedback text-xs text-success">
              {{ saveMessage() }}
            </span>
          }
          <div class="flex gap-xs items-center ml-auto">
            <button type="button" class="btn-secondary" (click)="close.emit()">
              Cancel
            </button>
            <button
              type="button"
              class="btn-primary"
              [disabled]="notificationService.isProcessing()"
              (click)="onSavePreferences()"
            >
              Save Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.65);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2000;
        padding: 1rem;
        overscroll-behavior: contain;
      }

      .modal-card {
        background: var(--m3-surface-container-high);
        border: 1px solid var(--m3-outline-variant);
        border-radius: 24px;
        width: 100%;
        max-width: 520px;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 16px 32px rgba(0, 0, 0, 0.45);
        color: var(--m3-on-surface);
      }

      :host-context(.theme-light) .modal-card {
        background: #ffffff;
        box-shadow: 0 20px 40px rgba(15, 23, 42, 0.15);
      }

      .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1.25rem 1.5rem 0.75rem;
        border-bottom: 1px solid var(--m3-outline-variant);
      }

      .modal-title {
        margin: 0;
        font-size: 1.15rem;
        font-weight: 700;
        letter-spacing: -0.01em;
        color: var(--m3-on-surface);
      }

      .header-icon {
        font-size: 1.25rem;
        color: var(--m3-primary);
      }

      .close-button {
        background: transparent;
        border: none;
        color: var(--m3-on-surface-variant);
        font-size: 1.15rem;
        cursor: pointer;
        padding: 0.25rem 0.5rem;
        border-radius: 50%;
        transition:
          color 0.15s ease,
          background-color 0.15s ease;
      }

      .close-button:hover {
        color: var(--m3-on-surface);
        background: var(--m3-surface-container-highest);
      }

      .modal-body {
        padding: 1.25rem 1.5rem;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
      }

      .alert-banner {
        display: flex;
        gap: 0.75rem;
        padding: 0.75rem 1rem;
        border-radius: 12px;
        font-size: 0.85rem;
      }

      .alert-banner.warning {
        background: rgba(234, 179, 8, 0.12);
        border: 1px solid rgba(234, 179, 8, 0.35);
        color: #ca8a04;
      }

      :host-context(.theme-dark) .alert-banner.warning {
        background: rgba(234, 179, 8, 0.15);
        color: #fde047;
      }

      .alert-banner.danger {
        background: rgba(239, 68, 68, 0.12);
        border: 1px solid rgba(239, 68, 68, 0.35);
        color: #dc2626;
      }

      :host-context(.theme-dark) .alert-banner.danger {
        background: rgba(239, 68, 68, 0.15);
        color: #fca5a5;
      }

      .banner-icon {
        font-size: 1.15rem;
      }

      .setting-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .master-switch-row {
        background: var(--m3-surface-container-low);
        padding: 0.85rem 1rem;
        border-radius: 16px;
        border: 1px solid var(--m3-outline-variant);
      }

      .status-chip {
        font-size: 0.7rem;
        padding: 0.2rem 0.55rem;
        border-radius: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .status-chip.active {
        background: rgba(34, 197, 94, 0.15);
        color: #16a34a;
        border: 1px solid rgba(34, 197, 94, 0.35);
      }

      :host-context(.theme-dark) .status-chip.active {
        color: #4ade80;
      }

      .status-chip.inactive {
        background: var(--m3-surface-container-highest);
        color: var(--m3-on-surface-variant);
        border: 1px solid var(--m3-outline-variant);
      }

      .btn-toggle {
        width: 44px;
        height: 24px;
        border-radius: 12px;
        border: 1px solid transparent;
        cursor: pointer;
        position: relative;
        transition:
          background 0.2s ease,
          border-color 0.2s ease;
      }

      .btn-toggle.active {
        background: var(--m3-primary);
        border-color: var(--m3-primary);
      }

      .btn-toggle.inactive {
        background: var(--m3-surface-container-highest);
        border-color: var(--m3-outline-variant);
      }

      .toggle-knob {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #ffffff;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
        transition: transform 0.2s ease;
      }

      .btn-toggle.active .toggle-knob {
        transform: translateX(20px);
        background: var(--m3-on-primary);
      }

      .setting-section {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
      }

      .section-label {
        font-size: 0.8rem;
        font-weight: 600;
        color: var(--m3-on-surface-variant);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .segmented-group {
        display: flex;
        background: var(--m3-surface-container-low);
        border: 1px solid var(--m3-outline-variant);
        border-radius: 14px;
        padding: 3px;
        gap: 3px;
      }

      .segmented-btn {
        flex: 1;
        background: transparent;
        border: none;
        color: var(--m3-on-surface-variant);
        padding: 0.5rem 0.6rem;
        font-size: 0.8rem;
        font-weight: 500;
        border-radius: 10px;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .segmented-btn:hover {
        color: var(--m3-on-surface);
      }

      .segmented-btn.active {
        background: var(--m3-surface-container-highest);
        color: var(--m3-on-surface);
        font-weight: 600;
      }

      :host-context(.theme-light) .segmented-btn.active {
        background: #ffffff;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
      }

      .chip-group {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
      }

      .filter-chip {
        background: var(--m3-surface-container-low);
        border: 1px solid var(--m3-outline-variant);
        color: var(--m3-on-surface-variant);
        padding: 0.35rem 0.75rem;
        font-size: 0.8rem;
        border-radius: 9999px;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .filter-chip:hover {
        color: var(--m3-on-surface);
        border-color: var(--m3-outline);
      }

      .filter-chip.active {
        background: var(--m3-primary-container);
        border-color: var(--m3-primary);
        color: var(--m3-on-primary-container);
        font-weight: 600;
      }

      .price-input-wrapper {
        position: relative;
        display: flex;
        align-items: center;
        width: 140px;
      }

      .currency-symbol {
        position: absolute;
        left: 0.75rem;
        color: var(--m3-on-surface-variant);
        font-size: 0.9rem;
      }

      .price-input {
        width: 100%;
        background: var(--m3-surface-container-low);
        border: 1px solid var(--m3-outline-variant);
        border-radius: 12px;
        padding: 0.45rem 0.75rem 0.45rem 1.6rem;
        color: var(--m3-on-surface);
        font-size: 0.85rem;
      }

      .price-input:focus {
        outline: none;
        border-color: var(--m3-primary);
        box-shadow: 0 0 0 2px var(--m3-primary-container);
      }

      .test-alert-box {
        background: var(--m3-surface-container-low);
        border: 1px solid var(--m3-outline-variant);
        border-radius: 14px;
        padding: 0.75rem 1rem;
      }

      .modal-footer {
        padding: 0.85rem 1.5rem;
        border-top: 1px solid var(--m3-outline-variant);
        display: flex;
        align-items: center;
      }

      .btn-primary {
        background: var(--m3-primary);
        color: var(--m3-on-primary);
        border: none;
        padding: 0.5rem 1.15rem;
        border-radius: 12px;
        font-size: 0.85rem;
        font-weight: 600;
        cursor: pointer;
        transition: opacity 0.15s ease;
      }

      .btn-primary:hover:not(:disabled) {
        opacity: 0.9;
      }

      .btn-primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .btn-secondary {
        background: var(--m3-surface-container-low);
        color: var(--m3-on-surface);
        border: 1px solid var(--m3-outline-variant);
        padding: 0.5rem 1rem;
        border-radius: 12px;
        font-size: 0.85rem;
        cursor: pointer;
        transition: background 0.15s ease;
      }

      .btn-secondary:hover:not(:disabled) {
        background: var(--m3-surface-container);
      }

      .btn-text {
        background: transparent;
        border: none;
        color: var(--m3-primary);
        cursor: pointer;
        padding: 0;
      }

      .text-muted {
        color: var(--m3-on-surface-variant);
      }

      .text-success {
        color: #16a34a;
      }

      :host-context(.theme-dark) .text-success {
        color: #4ade80;
      }

      .text-danger {
        color: #dc2626;
      }

      :host-context(.theme-dark) .text-danger {
        color: #f87171;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationSettingsModalComponent {
  public readonly close = output<void>();

  public readonly notificationService = inject(NotificationService);

  public readonly platforms = COMMON_PLATFORMS;
  public readonly discountOptions = [0, 15, 20, 25, 50];
  public readonly storeOptions = ['Best Buy', 'VGP', 'PNP Games'];

  public readonly isTestingAlert = signal<boolean>(false);
  public readonly testMessage = signal<string | null>(null);
  public readonly testSuccess = signal<boolean>(false);
  public readonly saveMessage = signal<string | null>(null);

  public localPrefs: DealNotificationPreferences = {
    ...this.notificationService.preferences(),
  };

  public scopeDescription(): string {
    switch (this.localPrefs.scope) {
      case 'seeking_only':
        return 'Alerts will only trigger for items on your active Seeking wishlist.';
      case 'seeking_and_unowned':
        return 'Alerts will trigger for Seeking wishlist games plus any unowned game.';
      case 'all':
        return 'Alerts will trigger for any game on sale, regardless of collection ownership.';
      default:
        return '';
    }
  }

  public maxPriceDollars(): number | null {
    if (
      this.localPrefs.maxPriceCents === null ||
      this.localPrefs.maxPriceCents === undefined
    ) {
      return null;
    }
    return Math.round(this.localPrefs.maxPriceCents / 100);
  }

  public onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close.emit();
    }
  }

  @HostListener('window:keydown.escape')
  public onEscapeKey(): void {
    this.close.emit();
  }

  public async onToggleMaster(enable: boolean): Promise<void> {
    this.testMessage.set(null);
    if (enable) {
      const ok = await this.notificationService.enableNotifications();
      if (ok) {
        this.localPrefs.enabled = true;
      }
    } else {
      const ok = await this.notificationService.disableNotifications();
      if (ok) {
        this.localPrefs.enabled = false;
      }
    }
  }

  public setScope(scope: 'seeking_only' | 'seeking_and_unowned' | 'all'): void {
    this.localPrefs.scope = scope;
  }

  public setMinDiscount(disc: number): void {
    this.localPrefs.minDiscountPct = disc;
  }

  public isStoreSelected(store: string): boolean {
    return this.localPrefs.stores.includes(store);
  }

  public toggleStore(store: string): void {
    if (this.isStoreSelected(store)) {
      if (this.localPrefs.stores.length > 1) {
        this.localPrefs.stores = this.localPrefs.stores.filter(
          (s) => s !== store,
        );
      }
    } else {
      this.localPrefs.stores = [...this.localPrefs.stores, store];
    }
  }

  public onPriceChange(value: number | null): void {
    if (value === null || value === undefined || isNaN(value) || value <= 0) {
      this.localPrefs.maxPriceCents = null;
    } else {
      this.localPrefs.maxPriceCents = Math.round(value * 100);
    }
  }

  public clearMaxPrice(): void {
    this.localPrefs.maxPriceCents = null;
  }

  public isPlatformSelected(id: number): boolean {
    return this.localPrefs.platformIds.includes(id);
  }

  public togglePlatform(id: number): void {
    if (this.isPlatformSelected(id)) {
      this.localPrefs.platformIds = this.localPrefs.platformIds.filter(
        (p) => p !== id,
      );
    } else {
      this.localPrefs.platformIds = [...this.localPrefs.platformIds, id];
    }
  }

  public toggleAllPlatforms(): void {
    if (this.localPrefs.platformIds.length === 0) {
      this.localPrefs.platformIds = [26, 33]; // default to Switch and Vita
    } else {
      this.localPrefs.platformIds = [];
    }
  }

  public async onSendTest(): Promise<void> {
    this.isTestingAlert.set(true);
    this.testMessage.set(null);
    try {
      const ok = await this.notificationService.sendTestAlert();
      this.testSuccess.set(ok);
      const err = this.notificationService.lastTestError?.();
      this.testMessage.set(
        ok
          ? '✓ Test alert sent! Check your notification tray.'
          : err
            ? `Failed: ${err}`
            : 'Failed to send test alert. Verify site permissions or VAPID configuration.',
      );
    } finally {
      this.isTestingAlert.set(false);
    }
  }

  public async onSavePreferences(): Promise<void> {
    const ok = await this.notificationService.updatePreferences(
      this.localPrefs,
    );
    if (ok) {
      this.saveMessage.set('✓ Saved!');
      setTimeout(() => {
        this.saveMessage.set(null);
        this.close.emit();
      }, 700);
    } else {
      this.saveMessage.set('Failed to save preferences.');
    }
  }
}
