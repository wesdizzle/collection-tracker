import { Injectable, DestroyRef, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { SwPush } from '@angular/service-worker';
import { Subscription, firstValueFrom } from 'rxjs';
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
  stores: ['VGP', 'PNP Games'],
  notify_game_releases: true,
  launch_day_scope: 'tracked_only',
  notify_physical_announcements: true,
  notify_watched_series: true,
  physical_announcement_scope: {
    seeking: true,
    uncataloged: true,
    special_editions: true,
    unowned: false,
  },
};

const STORAGE_KEY_PREFS = 'app_deal_notification_prefs';
const STORAGE_KEY_ENDPOINT = 'app_push_endpoint';
const TEST_DELIVERY_TIMEOUT_MS = 6000;

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
  private readonly destroyRef = inject(DestroyRef);

  public readonly isSupported = signal<boolean>(false);
  public readonly isSubscribed = signal<boolean>(false);
  public readonly permissionState = signal<NotificationPermission>('default');
  public readonly preferences = signal<DealNotificationPreferences>(
    DEFAULT_DEAL_PREFERENCES,
  );
  public readonly isProcessing = signal<boolean>(false);
  public readonly currentEndpoint = signal<string | null>(null);
  public readonly lastTestError = signal<string | null>(null);
  public readonly lastTestMessage = signal<string | null>(null);
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
        const storedPrefs = localStorage.getItem(STORAGE_KEY_PREFS);
        if (storedPrefs) {
          const parsed = JSON.parse(storedPrefs);
          this.preferences.set({ ...DEFAULT_DEAL_PREFERENCES, ...parsed });
        }

        const storedEndpoint = localStorage.getItem(STORAGE_KEY_ENDPOINT);
        if (storedEndpoint) {
          this.currentEndpoint.set(storedEndpoint);
          this.isSubscribed.set(true);
        }
      } catch (err) {
        console.warn('Failed to load notification preferences:', err);
      }
    }

    const initSubs: Subscription[] = [];

    // Observe browser subscription state to keep local state synchronized
    if (this.swPush?.isEnabled && this.swPush.subscription) {
      initSubs.push(
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
        }),
      );
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
    if (this.swPush?.isEnabled && this.swPush.notificationClicks) {
      initSubs.push(
        this.swPush.notificationClicks.subscribe(({ notification }) => {
          const url = notification.data?.url;
          if (url) {
            this.router.navigateByUrl(url);
          }
        }),
      );
    }

    // Re-sync browser-rotated push subscriptions automatically
    if (this.swPush?.isEnabled && this.swPush.pushSubscriptionChanges) {
      initSubs.push(
        this.swPush.pushSubscriptionChanges.subscribe((change) => {
          void this.handlePushSubscriptionChange(change);
        }),
      );
    }

    if (initSubs.length > 0) {
      this.destroyRef.onDestroy(() => {
        for (const s of initSubs) {
          s.unsubscribe();
        }
      });
    }
  }

  private async handlePushSubscriptionChange(change: {
    oldSubscription?: PushSubscription | null;
    newSubscription?: PushSubscription | null;
  }): Promise<void> {
    try {
      const oldEndpoint = change?.oldSubscription?.endpoint;
      let newSubJson: PushSubscriptionJSON | null = null;
      if (change?.newSubscription) {
        newSubJson =
          typeof change.newSubscription.toJSON === 'function'
            ? change.newSubscription.toJSON()
            : (change.newSubscription as unknown as PushSubscriptionJSON);
      }

      if (
        (!newSubJson?.endpoint ||
          !newSubJson.keys?.['p256dh'] ||
          !newSubJson.keys?.['auth']) &&
        typeof window !== 'undefined' &&
        'serviceWorker' in navigator &&
        typeof navigator.serviceWorker.getRegistration === 'function'
      ) {
        const reg = await navigator.serviceWorker.getRegistration();
        const activeSub = await reg?.pushManager?.getSubscription();
        if (activeSub) {
          newSubJson = activeSub.toJSON();
        }
      }

      const newEndpoint = newSubJson?.endpoint;
      const p256dh = newSubJson?.keys?.['p256dh'];
      const auth = newSubJson?.keys?.['auth'];
      if (newEndpoint && p256dh && auth) {
        const activePrefs = { ...this.preferences(), enabled: true };
        await firstValueFrom(
          this.http.post<{ success: boolean }>('/api/notifications/subscribe', {
            endpoint: newEndpoint,
            keys: { p256dh, auth },
            preferences: activePrefs,
          }),
        );
        this.isSubscribed.set(true);
        this.currentEndpoint.set(newEndpoint);
        this.preferences.set(activePrefs);
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem(STORAGE_KEY_ENDPOINT, newEndpoint);
          localStorage.setItem(STORAGE_KEY_PREFS, JSON.stringify(activePrefs));
        }

        if (oldEndpoint && oldEndpoint !== newEndpoint) {
          await firstValueFrom(
            this.http.post<{ success: boolean }>(
              '/api/notifications/unsubscribe',
              { endpoint: oldEndpoint },
            ),
          ).catch(() => {});
        }
      }
    } catch (err) {
      console.warn('Failed to sync rotated push subscription:', err);
    }
  }

  /**
   * Cleans up stale/invalid subscription state when backend or push service reports 404/410.
   */
  private handleStaleSubscription(customMsg?: string): void {
    this.isSubscribed.set(false);
    this.currentEndpoint.set(null);
    this.lastTestMessage.set(null);
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(STORAGE_KEY_ENDPOINT);
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
      // Capture any existing endpoint before local unsubscribe so stale D1 rows are cleaned up
      let previousEndpoint = this.currentEndpoint();
      if (
        typeof window !== 'undefined' &&
        'serviceWorker' in navigator &&
        typeof navigator.serviceWorker.getRegistration === 'function'
      ) {
        try {
          const reg = await navigator.serviceWorker.getRegistration();
          const existingSub = await reg?.pushManager?.getSubscription();
          if (existingSub?.endpoint) {
            previousEndpoint = existingSub.endpoint;
          }
        } catch {
          // Ignore registration lookup failures
        }
      }

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

      if (previousEndpoint && previousEndpoint !== sub.endpoint) {
        await firstValueFrom(
          this.http.post<{ success: boolean }>(
            '/api/notifications/unsubscribe',
            { endpoint: previousEndpoint },
          ),
        ).catch(() => {});
      }

      // 5. Update local state
      this.isSubscribed.set(true);
      this.currentEndpoint.set(sub.endpoint);
      this.lastTestError.set(null);
      this.lastTestMessage.set(null);
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
      this.lastTestMessage.set(null);
      this.preferences.set(updatedPrefs);

      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.removeItem(STORAGE_KEY_ENDPOINT);
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

  private extractTestIdFromPushMessage(message: unknown): string | null {
    if (!message || typeof message !== 'object') {
      return null;
    }
    const msg = message as {
      data?: { testId?: unknown };
      notification?: { data?: { testId?: unknown } };
    };
    const raw = msg.data?.testId ?? msg.notification?.data?.testId;
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  }

  /**
   * Resolves the browser's live PushSubscription endpoint if a Service Worker
   * registration is present, falling back to the cached signal when unavailable.
   */
  private async resolveActiveEndpoint(): Promise<string | null> {
    if (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      typeof navigator.serviceWorker.getRegistration === 'function'
    ) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg?.pushManager) {
          const sub = await reg.pushManager.getSubscription();
          if (sub?.endpoint) {
            if (
              sub.endpoint !== this.currentEndpoint() ||
              !this.isSubscribed()
            ) {
              this.currentEndpoint.set(sub.endpoint);
              this.isSubscribed.set(true);
              if (typeof window !== 'undefined' && window.localStorage) {
                localStorage.setItem(STORAGE_KEY_ENDPOINT, sub.endpoint);
              }
            }
            return sub.endpoint;
          }
          if (reg.active) {
            this.handleStaleSubscription();
            return null;
          }
        }
      } catch (err) {
        console.warn('Could not query active push subscription:', err);
      }
    }
    return this.currentEndpoint();
  }

  /**
   * Sends an immediate test alert to this device and waits briefly for
   * service-worker delivery confirmation via `SwPush.messages`.
   */
  public async sendTestAlert(): Promise<boolean> {
    this.lastTestError.set(null);
    this.lastTestMessage.set(null);

    const hasSwGetRegistration =
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      typeof navigator.serviceWorker.getRegistration === 'function';

    const endpoint = hasSwGetRegistration
      ? await this.resolveActiveEndpoint()
      : this.currentEndpoint();
    if (!endpoint) {
      if (!this.lastTestError()) {
        this.lastTestError.set('No active push endpoint found on this device.');
      }
      return false;
    }

    this.isProcessing.set(true);

    const receivedTestIds = new Set<string>();
    let onTestIdReceived: ((testId: string) => void) | null = null;
    let pushMessagesSub: Subscription | null = null;
    let deliveryTimer: ReturnType<typeof setTimeout> | null = null;

    if (this.swPush?.isEnabled && this.swPush.messages) {
      pushMessagesSub = this.swPush.messages.subscribe((msg) => {
        const testId = this.extractTestIdFromPushMessage(msg);
        if (testId) {
          receivedTestIds.add(testId);
          onTestIdReceived?.(testId);
        }
      });
    }

    try {
      const res = await firstValueFrom(
        this.http.post<{
          success: boolean;
          error?: string;
          status?: number;
          shouldDelete?: boolean;
          testId?: string;
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

      if (res.testId && this.swPush?.isEnabled && this.swPush.messages) {
        const expectedTestId = res.testId;
        let delivered = receivedTestIds.has(expectedTestId);
        if (!delivered) {
          delivered = await new Promise<boolean>((resolve) => {
            deliveryTimer = setTimeout(() => {
              deliveryTimer = null;
              onTestIdReceived = null;
              resolve(false);
            }, TEST_DELIVERY_TIMEOUT_MS);

            onTestIdReceived = (id) => {
              if (id === expectedTestId) {
                if (deliveryTimer !== null) {
                  clearTimeout(deliveryTimer);
                  deliveryTimer = null;
                }
                onTestIdReceived = null;
                resolve(true);
              }
            };
          });
        }

        this.lastTestMessage.set(
          delivered
            ? '✓ Test alert delivered to this device!'
            : `✓ Push service accepted test (HTTP ${res.status ?? 201}), awaiting delivery on this device. Check your notification tray or background the app; if it never arrives, toggle notifications off and on.`,
        );
      } else {
        this.lastTestMessage.set(
          '✓ Test alert sent! Check your notification tray.',
        );
      }

      return true;
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
      if (deliveryTimer !== null) {
        clearTimeout(deliveryTimer);
        deliveryTimer = null;
      }
      onTestIdReceived = null;
      pushMessagesSub?.unsubscribe();
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
