import '../../../test-setup';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  provideHttpClientTesting,
  HttpTestingController,
} from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { SwPush } from '@angular/service-worker';
import { Subject } from 'rxjs';
import {
  NotificationService,
  DEFAULT_DEAL_PREFERENCES,
} from './notification.service';
import { DealNotificationPreferences } from '../models/collection.models';

interface WindowWithPushManager extends Window {
  PushManager?: unknown;
}

describe('NotificationService', () => {
  let service: NotificationService;
  let httpTesting: HttpTestingController;
  let mockSwPush: {
    isEnabled: boolean;
    notificationClicks: Subject<{ notification: { data?: { url?: string } } }>;
    messages: Subject<object>;
    pushSubscriptionChanges: Subject<{
      oldSubscription: PushSubscription | null;
      newSubscription: PushSubscription | null;
    }>;
    requestSubscription: ReturnType<typeof vi.fn>;
    unsubscribe: ReturnType<typeof vi.fn>;
  };
  let mockRouter: {
    navigateByUrl: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    localStorage.clear();

    (window as unknown as WindowWithPushManager).PushManager =
      class PushManager {};
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {},
      configurable: true,
    });

    mockSwPush = {
      isEnabled: true,
      notificationClicks: new Subject(),
      messages: new Subject(),
      pushSubscriptionChanges: new Subject(),
      requestSubscription: vi.fn(),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    };

    mockRouter = {
      navigateByUrl: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SwPush, useValue: mockSwPush },
        { provide: Router, useValue: mockRouter },
        NotificationService,
      ],
    });

    service = TestBed.inject(NotificationService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
    TestBed.resetTestingModule();
    delete (window as unknown as WindowWithPushManager).PushManager;
  });

  it('should initialize with default preferences', () => {
    expect(service.isSupported()).toBe(true);
    expect(service.isSubscribed()).toBe(false);
    expect(service.preferences()).toEqual(DEFAULT_DEAL_PREFERENCES);
  });

  it('should enable notifications by requesting VAPID key and registering subscription', async () => {
    const mockSub = {
      endpoint: 'https://push.example.com/sub/test-1',
      toJSON: () => ({
        endpoint: 'https://push.example.com/sub/test-1',
        keys: { p256dh: 'test-p256dh', auth: 'test-auth' },
      }),
    };
    mockSwPush.requestSubscription.mockResolvedValue(mockSub);

    const enablePromise = service.enableNotifications();

    // Expect GET VAPID key
    const vapidReq = httpTesting.expectOne(
      '/api/notifications/vapid-public-key',
    );
    expect(vapidReq.request.method).toBe('GET');
    vapidReq.flush({ publicKey: 'mock-vapid-key' });

    // Wait for microtasks (firstValueFrom + mockSwPush.requestSubscription)
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }

    // Expect POST subscribe
    const subReq = httpTesting.expectOne('/api/notifications/subscribe');
    expect(subReq.request.method).toBe('POST');
    expect(subReq.request.body.endpoint).toBe(
      'https://push.example.com/sub/test-1',
    );
    subReq.flush({ success: true, id: 'sub-id' });

    const result = await enablePromise;
    expect(result).toBe(true);
    expect(service.isSubscribed()).toBe(true);
    expect(service.currentEndpoint()).toBe(
      'https://push.example.com/sub/test-1',
    );
    expect(service.preferences().enabled).toBe(true);
  });

  it('should unsubscribe and clear local state', async () => {
    service.currentEndpoint.set('https://push.example.com/sub/test-1');
    service.isSubscribed.set(true);

    const disablePromise = service.disableNotifications();

    // Wait for mockSwPush.unsubscribe promise
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }

    const unsubReq = httpTesting.expectOne('/api/notifications/unsubscribe');
    expect(unsubReq.request.method).toBe('POST');
    expect(unsubReq.request.body.endpoint).toBe(
      'https://push.example.com/sub/test-1',
    );
    unsubReq.flush({ success: true });

    const result = await disablePromise;
    expect(result).toBe(true);
    expect(service.isSubscribed()).toBe(false);
    expect(service.currentEndpoint()).toBeNull();
    expect(mockSwPush.unsubscribe).toHaveBeenCalled();
  });

  it('should update preferences and sync with backend if subscribed', async () => {
    service.currentEndpoint.set('https://push.example.com/sub/test-1');
    service.isSubscribed.set(true);

    const newPrefs: DealNotificationPreferences = {
      enabled: true,
      scope: 'seeking_and_unowned',
      minDiscountPct: 30,
      maxPriceCents: 4000,
      platformIds: [26],
      stores: ['VGP'],
    };

    const updatePromise = service.updatePreferences(newPrefs);

    const putReq = httpTesting.expectOne('/api/notifications/preferences');
    expect(putReq.request.method).toBe('PUT');
    expect(putReq.request.body.preferences).toEqual(newPrefs);
    putReq.flush({ success: true });

    const result = await updatePromise;
    expect(result).toBe(true);
    expect(service.preferences()).toEqual(newPrefs);
  });

  it('should send a test alert when requested', async () => {
    service.currentEndpoint.set('https://push.example.com/sub/test-1');

    const testPromise = service.sendTestAlert();

    const testReq = httpTesting.expectOne('/api/notifications/test');
    expect(testReq.request.method).toBe('POST');
    expect(testReq.request.body.endpoint).toBe(
      'https://push.example.com/sub/test-1',
    );
    testReq.flush({ success: true });

    const result = await testPromise;
    expect(result).toBe(true);
  });

  it('should navigate when notification click event is received', () => {
    mockSwPush.notificationClicks.next({
      notification: {
        data: { url: '/item/mario-switch' },
      },
    });

    expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/item/mario-switch');
  });

  it('should safely unsubscribe and clear local state even when SwPush.unsubscribe rejects', async () => {
    mockSwPush.unsubscribe.mockRejectedValue(
      new Error('Not subscribed to push notifications.'),
    );
    service.currentEndpoint.set('https://push.example.com/sub/test-stale');
    service.isSubscribed.set(true);

    const disablePromise = service.disableNotifications();

    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }

    const unsubReq = httpTesting.expectOne('/api/notifications/unsubscribe');
    unsubReq.flush({ success: true });

    const result = await disablePromise;
    expect(result).toBe(true);
    expect(service.isSubscribed()).toBe(false);
    expect(service.currentEndpoint()).toBeNull();
  });

  it('should invalidate stale endpoint when sendTestAlert encounters 404', async () => {
    service.currentEndpoint.set('https://push.example.com/sub/test-invalid');
    service.isSubscribed.set(true);

    const testPromise = service.sendTestAlert();

    const testReq = httpTesting.expectOne('/api/notifications/test');
    testReq.flush(
      { error: 'Subscription not found.' },
      { status: 404, statusText: 'Not Found' },
    );

    const result = await testPromise;
    expect(result).toBe(false);
    expect(service.isSubscribed()).toBe(false);
    expect(service.currentEndpoint()).toBeNull();
    expect(service.lastTestError()).toContain(
      'Push subscription expired or was invalidated',
    );
  });

  it('should toggle settings modal state', () => {
    expect(service.isSettingsModalOpen()).toBe(false);
    service.openSettingsModal();
    expect(service.isSettingsModalOpen()).toBe(true);
    service.closeSettingsModal();
    expect(service.isSettingsModalOpen()).toBe(false);
  });

  it('should confirm device delivery when SwPush.messages emits matching testId after HTTP response', async () => {
    service.currentEndpoint.set('https://push.example.com/sub/test-1');

    const testPromise = service.sendTestAlert();
    await Promise.resolve();

    const testReq = httpTesting.expectOne('/api/notifications/test');
    testReq.flush({ success: true, status: 201, testId: 'test-alert-abc' });
    await Promise.resolve();

    mockSwPush.messages.next({
      notification: { data: { testId: 'test-alert-abc' } },
    });

    const result = await testPromise;
    expect(result).toBe(true);
    expect(service.lastTestMessage()).toBe(
      '✓ Test alert delivered to this device!',
    );
    expect(service.lastTestError()).toBeNull();
  });

  it('should confirm device delivery when SwPush.messages emits matching testId before HTTP response arrives', async () => {
    service.currentEndpoint.set('https://push.example.com/sub/test-1');

    const testPromise = service.sendTestAlert();
    await Promise.resolve();

    const testReq = httpTesting.expectOne('/api/notifications/test');
    mockSwPush.messages.next({ data: { testId: 'test-alert-early' } });
    testReq.flush({ success: true, status: 201, testId: 'test-alert-early' });

    const result = await testPromise;
    expect(result).toBe(true);
    expect(service.lastTestMessage()).toBe(
      '✓ Test alert delivered to this device!',
    );
  });

  it('should report awaiting-delivery diagnostic message when SwPush.messages times out', async () => {
    vi.useFakeTimers();
    try {
      service.currentEndpoint.set('https://push.example.com/sub/test-1');

      const testPromise = service.sendTestAlert();
      await Promise.resolve();

      const testReq = httpTesting.expectOne('/api/notifications/test');
      testReq.flush({
        success: true,
        status: 201,
        testId: 'test-alert-timeout',
      });
      await Promise.resolve();

      await vi.advanceTimersByTimeAsync(6000);

      const result = await testPromise;
      expect(result).toBe(true);
      expect(service.lastTestMessage()).toContain(
        'Push service accepted test (HTTP 201)',
      );
      expect(service.lastTestMessage()).toContain('awaiting delivery');
    } finally {
      vi.useRealTimers();
    }
  });

  it('should resolve the live PushManager subscription endpoint over stale cached endpoint', async () => {
    service.currentEndpoint.set('https://push.example.com/sub/stale-cached');
    service.isSubscribed.set(true);

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistration: vi.fn().mockResolvedValue({
          active: {},
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue({
              endpoint: 'https://push.example.com/sub/live-active',
            }),
          },
        }),
      },
      configurable: true,
    });

    const testPromise = service.sendTestAlert();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const testReq = httpTesting.expectOne('/api/notifications/test');
    expect(testReq.request.body.endpoint).toBe(
      'https://push.example.com/sub/live-active',
    );
    testReq.flush({ success: true });

    const result = await testPromise;
    expect(result).toBe(true);
    expect(service.currentEndpoint()).toBe(
      'https://push.example.com/sub/live-active',
    );
    expect(localStorage.getItem('app_push_endpoint')).toBe(
      'https://push.example.com/sub/live-active',
    );
  });

  it('should clean up previous endpoint on enableNotifications when replaced', async () => {
    service.currentEndpoint.set('https://push.example.com/sub/old-endpoint');
    const mockSub = {
      endpoint: 'https://push.example.com/sub/new-endpoint',
      toJSON: () => ({
        endpoint: 'https://push.example.com/sub/new-endpoint',
        keys: { p256dh: 'new-p256dh', auth: 'new-auth' },
      }),
    };
    mockSwPush.requestSubscription.mockResolvedValue(mockSub);

    const enablePromise = service.enableNotifications();

    const vapidReq = httpTesting.expectOne(
      '/api/notifications/vapid-public-key',
    );
    vapidReq.flush({ publicKey: 'mock-vapid-key' });

    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
    }

    const subReq = httpTesting.expectOne('/api/notifications/subscribe');
    expect(subReq.request.body.endpoint).toBe(
      'https://push.example.com/sub/new-endpoint',
    );
    subReq.flush({ success: true, id: 'sub-new' });

    for (let i = 0; i < 4; i++) {
      await Promise.resolve();
    }

    const unsubReq = httpTesting.expectOne('/api/notifications/unsubscribe');
    expect(unsubReq.request.body.endpoint).toBe(
      'https://push.example.com/sub/old-endpoint',
    );
    unsubReq.flush({ success: true });

    const result = await enablePromise;
    expect(result).toBe(true);
    expect(service.currentEndpoint()).toBe(
      'https://push.example.com/sub/new-endpoint',
    );
  });

  it('should sync rotated subscription on SwPush.pushSubscriptionChanges', async () => {
    const oldSub = {
      endpoint: 'https://push.example.com/sub/rotated-old',
    } as PushSubscription;
    const newSub = {
      endpoint: 'https://push.example.com/sub/rotated-new',
      toJSON: () => ({
        endpoint: 'https://push.example.com/sub/rotated-new',
        keys: { p256dh: 'rot-p256dh', auth: 'rot-auth' },
      }),
    } as unknown as PushSubscription;

    mockSwPush.pushSubscriptionChanges.next({
      oldSubscription: oldSub,
      newSubscription: newSub,
    });

    await Promise.resolve();

    const subReq = httpTesting.expectOne('/api/notifications/subscribe');
    expect(subReq.request.body.endpoint).toBe(
      'https://push.example.com/sub/rotated-new',
    );
    subReq.flush({ success: true });

    for (let i = 0; i < 4; i++) {
      await Promise.resolve();
    }

    const unsubReq = httpTesting.expectOne('/api/notifications/unsubscribe');
    expect(unsubReq.request.body.endpoint).toBe(
      'https://push.example.com/sub/rotated-old',
    );
    unsubReq.flush({ success: true });

    for (let i = 0; i < 4; i++) {
      await Promise.resolve();
    }

    expect(service.currentEndpoint()).toBe(
      'https://push.example.com/sub/rotated-new',
    );
    expect(service.isSubscribed()).toBe(true);
  });
});
