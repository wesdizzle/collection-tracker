import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { SwPush } from '@angular/service-worker';
import { firstValueFrom } from 'rxjs';
import {
  DealNotificationPreferences,
  PushSubscriptionPayload,
} from '../models/collection.models';

export const DEFAULT_DEAL_PREFERENCES: DealNotificationPreferences = {
  enabled: false,
  scope: 'seeking_only',
  minDiscountPct: 20,
  maxPriceCents: null,
  platformIds: [],
  stores: ['Best Buy', 'VGP', 'PNP Games'],
};

const STORAGE_KEY_PREFS = 'app_deal_notification_prefs';
const STORAGE_KEY_ENDPOINT = 'app_push_endpoint';
const LEGACY_STORAGE_KEY_PREFS = 'gagglog_deal_notification_prefs';
const LEGACY_STORAGE_KEY_ENDPOINT = 'gagglog_push_endpoint';

/**
 * NOTIFICATION SERVICE
 *
 * Manages Web Push subscriptions and user-configurable deal notification
 * preferences for the Collection Tracker PWA.
 */
@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly swPush = inject(SwPush, { optional: true });

  public readonly isSupported = signal<boolean>(false);
  public readonly isSubscribed = signal<boolean>(false);
  public readonly permissionState = signal<NotificationPermission>('default');
  public readonly preferences = signal<DealNotificationPreferences>(
    DEFAULT_DEAL_PREFERENCES,
  );
  public readonly isProcessing = signal<boolean>(false);
  public readonly currentEndpoint = signal<string | null>(null);
  public readonly lastTestError = signal<string | null>(null);
  public readonly isSettingsModalOpen = signal<boolean>(false);

  constructor() {
    this.init();
  }

  private init(): void {
    // Check Web Push support in current browser / PWA context
    const supported =
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      Boolean(this.swPush?.isEnabled);

    this.isSupported.set(Boolean(supported));

    if (typeof window !== 'undefined' && 'Notification' in window) {
      this.permissionState.set(Notification.permission);
    }

    // Load persisted local preferences
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const storedPrefs =
          localStorage.getItem(STORAGE_KEY_PREFS) ??
          localStorage.getItem(LEGACY_STORAGE_KEY_PREFS);
        if (storedPrefs) {
          const parsed = JSON.parse(storedPrefs);
          this.preferences.set({ ...DEFAULT_DEAL_PREFERENCES, ...parsed });
        }

        const storedEndpoint =
          localStorage.getItem(STORAGE_KEY_ENDPOINT) ??
          localStorage.getItem(LEGACY_STORAGE_KEY_ENDPOINT);
        if (storedEndpoint) {
          this.currentEndpoint.set(storedEndpoint);
          this.isSubscribed.set(true);
        }
      } catch (err) {
        console.warn('Failed to load notification preferences:', err);
      }
    }

    // Observe browser subscription state to keep local state synchronized
    if (this.swPush?.isEnabled && this.swPush.subscription) {
      this.swPush.subscription.subscribe({
        next: (sub) => {
          if (sub) {
            this.currentEndpoint.set(sub.endpoint);
            this.isSubscribed.set(true);
            if (typeof window !== 'undefined' && window.localStorage) {
              localStorage.setItem(STORAGE_KEY_ENDPOINT, sub.endpoint);
            }
          } else {
            // Browser has no active push subscription
            if (this.isSubscribed()) {
              this.currentEndpoint.set(null);
              this.isSubscribed.set(false);
              if (typeof window !== 'undefined' && window.localStorage) {
                localStorage.removeItem(STORAGE_KEY_ENDPOINT);
                localStorage.removeItem(LEGACY_STORAGE_KEY_ENDPOINT);
              }
              console.info(
                'Detected missing/unregistered browser push subscription; local state reset.',
              );
            }
          }
        },
        error: (err) => {
          console.warn('Error observing push subscription:', err);
        },
      });
    }

    // Direct PushManager check if service worker is active
    if (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      navigator.serviceWorker.ready
    ) {
      navigator.serviceWorker.ready
        .then(async (reg) => {
          try {
            const sub = await reg.pushManager.getSubscription();
            if (!sub && this.isSubscribed()) {
              this.currentEndpoint.set(null);
              this.isSubscribed.set(false);
              if (typeof window !== 'undefined' && window.localStorage) {
                localStorage.removeItem(STORAGE_KEY_ENDPOINT);
                localStorage.removeItem(LEGACY_STORAGE_KEY_ENDPOINT);
              }
            } else if (sub && sub.endpoint !== this.currentEndpoint()) {
              this.currentEndpoint.set(sub.endpoint);
              this.isSubscribed.set(true);
              if (typeof window !== 'undefined' && window.localStorage) {
                localStorage.setItem(STORAGE_KEY_ENDPOINT, sub.endpoint);
              }
            }
          } catch (e) {
            console.warn('Could not query pushManager subscription:', e);
          }
        })
        .catch(() => {});
    }

    // Subscribe to notification clicks for routing
    if (this.swPush?.isEnabled) {
      this.swPush.notificationClicks.subscribe(({ notification }) => {
        const url = notification.data?.url;
        if (url) {
          this.router.navigateByUrl(url);
        }
      });
    }
  }

  /**
   * Cleans up stale/invalid subscription state when backend or push service reports 404/410.
   */
  private handleStaleSubscription(customMsg?: string): void {
    this.isSubscribed.set(false);
    this.currentEndpoint.set(null);
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(STORAGE_KEY_ENDPOINT);
      localStorage.removeItem(LEGACY_STORAGE_KEY_ENDPOINT);
    }
    this.lastTestError.set(
      customMsg ||
        'Push subscription expired or was invalidated on this device (e.g. after reinstall). Please toggle notifications on again to re-register.',
    );
  }

  /**
   * Requests push notification permission and registers subscription with edge worker.
   */
  public async enableNotifications(): Promise<boolean> {
    if (!this.isSupported()) {
      return false;
    }

    this.isProcessing.set(true);

    try {
      // 1. Fetch VAPID public key from backend
      const { publicKey } = await firstValueFrom(
        this.http.get<{ publicKey: string }>(
          '/api/notifications/vapid-public-key',
        ),
      );

      if (!publicKey) {
        throw new Error('VAPID public key not found from server');
      }

      // 2. Unsubscribe any stale browser subscription before creating a fresh one
      if (this.swPush?.isEnabled) {
        try {
          await this.swPush.unsubscribe();
        } catch {
          // Bypassed if not subscribed
        }
      }

      // 3. Request browser push subscription
      if (!this.swPush) {
        throw new Error('SwPush service worker integration is not available');
      }
      const sub = await this.swPush.requestSubscription({
        serverPublicKey: publicKey,
      });

      const subJson = sub.toJSON();
      const p256dh = subJson.keys?.['p256dh'];
      const auth = subJson.keys?.['auth'];
      if (!sub.endpoint || !p256dh || !auth) {
        throw new Error('Invalid subscription keys generated by browser');
      }

      const activePrefs = {
        ...this.preferences(),
        enabled: true,
      };

      const payload: PushSubscriptionPayload = {
        endpoint: sub.endpoint,
        keys: {
          p256dh,
          auth,
        },
        preferences: activePrefs,
      };

      // 4. Register with backend
      await firstValueFrom(
        this.http.post<{ success: boolean }>(
          '/api/notifications/subscribe',
          payload,
        ),
      );

      // 5. Update local state
      this.isSubscribed.set(true);
      this.currentEndpoint.set(sub.endpoint);
      this.lastTestError.set(null);
      this.preferences.set(activePrefs);
      if (typeof window !== 'undefined' && 'Notification' in window) {
        this.permissionState.set(Notification.permission);
      }

      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem(STORAGE_KEY_ENDPOINT, sub.endpoint);
        localStorage.setItem(STORAGE_KEY_PREFS, JSON.stringify(activePrefs));
      }

      return true;
    } catch (err) {
      console.error('Failed to enable push notifications:', err);
      if (typeof window !== 'undefined' && 'Notification' in window) {
        this.permissionState.set(Notification.permission);
      }
      return false;
    } finally {
      this.isProcessing.set(false);
    }
  }

  /**
   * Unsubscribes from push notifications.
   */
  public async disableNotifications(): Promise<boolean> {
    this.isProcessing.set(true);
    const endpoint = this.currentEndpoint();

    try {
      if (this.swPush?.isEnabled) {
        try {
          await this.swPush.unsubscribe();
        } catch (swErr) {
          console.warn('Browser push unsubscribe bypassed:', swErr);
        }
      }

      if (endpoint) {
        try {
          await firstValueFrom(
            this.http.post<{ success: boolean }>(
              '/api/notifications/unsubscribe',
              { endpoint },
            ),
          );
        } catch (apiErr) {
          console.warn('Backend push unsubscribe warning:', apiErr);
        }
      }

      const updatedPrefs = { ...this.preferences(), enabled: false };
      this.isSubscribed.set(false);
      this.currentEndpoint.set(null);
      this.lastTestError.set(null);
      this.preferences.set(updatedPrefs);

      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.removeItem(STORAGE_KEY_ENDPOINT);
        localStorage.removeItem(LEGACY_STORAGE_KEY_ENDPOINT);
        localStorage.setItem(STORAGE_KEY_PREFS, JSON.stringify(updatedPrefs));
      }

      return true;
    } catch (err) {
      console.error('Failed to unsubscribe from notifications:', err);
      // Fallback cleanup so the user is never permanently stuck
      this.isSubscribed.set(false);
      this.currentEndpoint.set(null);
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.removeItem(STORAGE_KEY_ENDPOINT);
        localStorage.removeItem(LEGACY_STORAGE_KEY_ENDPOINT);
      }
      return true;
    } finally {
      this.isProcessing.set(false);
    }
  }

  /**
   * Updates notification filter dimensions and syncs with edge worker if subscribed.
   */
  public async updatePreferences(
    prefs: DealNotificationPreferences,
  ): Promise<boolean> {
    this.isProcessing.set(true);

    try {
      this.preferences.set(prefs);

      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem(STORAGE_KEY_PREFS, JSON.stringify(prefs));
      }

      const endpoint = this.currentEndpoint();
      if (this.isSubscribed() && endpoint) {
        await firstValueFrom(
          this.http.put<{ success: boolean }>(
            '/api/notifications/preferences',
            {
              endpoint,
              preferences: prefs,
            },
          ),
        );
      }

      return true;
    } catch (err) {
      console.error('Failed to save notification preferences:', err);
      return false;
    } finally {
      this.isProcessing.set(false);
    }
  }

  /**
   * Sends an immediate test alert to this device.
   */
  public async sendTestAlert(): Promise<boolean> {
    const endpoint = this.currentEndpoint();
    if (!endpoint) {
      this.lastTestError.set('No active push endpoint found on this device.');
      return false;
    }

    this.isProcessing.set(true);
    this.lastTestError.set(null);
    try {
      const res = await firstValueFrom(
        this.http.post<{
          success: boolean;
          error?: string;
          status?: number;
          shouldDelete?: boolean;
        }>('/api/notifications/test', { endpoint }),
      );

      if (!res.success) {
        if (res.shouldDelete || res.status === 404 || res.status === 410) {
          this.handleStaleSubscription();
        } else if (res.error) {
          this.lastTestError.set(res.error);
        }
        return false;
      }
      return Boolean(res.success);
    } catch (err: unknown) {
      console.error('Failed to send test notification:', err);
      const httpErr = err as {
        status?: number;
        error?: { error?: string; shouldDelete?: boolean };
        message?: string;
      };
      const msg =
        httpErr?.error?.error ||
        httpErr?.message ||
        'Network error while sending test notification.';

      if (
        httpErr?.status === 404 ||
        httpErr?.status === 410 ||
        httpErr?.error?.shouldDelete ||
        msg.toLowerCase().includes('subscription not found') ||
        msg.toLowerCase().includes('410')
      ) {
        this.handleStaleSubscription();
      } else {
        this.lastTestError.set(msg);
      }
      return false;
    } finally {
      this.isProcessing.set(false);
    }
  }

  /**
   * Opens the deal alert notification settings modal.
   */
  public openSettingsModal(): void {
    this.isSettingsModalOpen.set(true);
  }

  /**
   * Closes the deal alert notification settings modal.
   */
  public closeSettingsModal(): void {
    this.isSettingsModalOpen.set(false);
  }
}
