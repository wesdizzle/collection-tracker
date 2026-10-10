import '../../../../../test-setup';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NotificationSettingsModalComponent } from './notification-settings-modal.component';
import { NotificationService } from '../../../../core/services/notification.service';
import { signal } from '@angular/core';
import { DealNotificationPreferences } from '../../../../core/models/collection.models';

describe('NotificationSettingsModalComponent', () => {
  let component: NotificationSettingsModalComponent;
  let fixture: ComponentFixture<NotificationSettingsModalComponent>;
  let mockNotificationService: {
    isSupported: ReturnType<typeof signal<boolean>>;
    isSubscribed: ReturnType<typeof signal<boolean>>;
    permissionState: ReturnType<typeof signal<NotificationPermission>>;
    preferences: ReturnType<typeof signal<DealNotificationPreferences>>;
    isProcessing: ReturnType<typeof signal<boolean>>;
    enableNotifications: ReturnType<typeof vi.fn>;
    disableNotifications: ReturnType<typeof vi.fn>;
    updatePreferences: ReturnType<typeof vi.fn>;
    sendTestAlert: ReturnType<typeof vi.fn>;
  };

  const defaultPrefs: DealNotificationPreferences = {
    enabled: true,
    scope: 'seeking_only',
    minDiscountPct: 20,
    maxPriceCents: null,
    platformIds: [],
    stores: ['Best Buy', 'VGP', 'PNP Games'],
  };

  beforeEach(() => {
    mockNotificationService = {
      isSupported: signal(true),
      isSubscribed: signal(true),
      permissionState: signal('granted'),
      preferences: signal(defaultPrefs),
      isProcessing: signal(false),
      enableNotifications: vi.fn().mockResolvedValue(true),
      disableNotifications: vi.fn().mockResolvedValue(true),
      updatePreferences: vi.fn().mockResolvedValue(true),
      sendTestAlert: vi.fn().mockResolvedValue(true),
    };

    TestBed.configureTestingModule({
      imports: [NotificationSettingsModalComponent],
      providers: [
        { provide: NotificationService, useValue: mockNotificationService },
      ],
    });

    fixture = TestBed.createComponent(NotificationSettingsModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and render settings modal', () => {
    expect(component).toBeTruthy();
    const titleEl = fixture.nativeElement.querySelector('.modal-title');
    expect(titleEl?.textContent).toContain('Deal Alert Settings');
  });

  it('should update local dimension choices', () => {
    component.setScope('seeking_and_unowned');
    expect(component.localPrefs.scope).toBe('seeking_and_unowned');

    component.setMinDiscount(50);
    expect(component.localPrefs.minDiscountPct).toBe(50);

    component.onPriceChange(45);
    expect(component.localPrefs.maxPriceCents).toBe(4500);
    expect(component.maxPriceDollars()).toBe(45);

    component.clearMaxPrice();
    expect(component.localPrefs.maxPriceCents).toBeNull();
  });

  it('should toggle store selections while preserving at least one', () => {
    expect(component.isStoreSelected('Best Buy')).toBe(true);
    component.toggleStore('Best Buy');
    expect(component.isStoreSelected('Best Buy')).toBe(false);

    component.toggleStore('Best Buy');
    expect(component.isStoreSelected('Best Buy')).toBe(true);
  });

  it('should toggle platform selection', () => {
    expect(component.localPrefs.platformIds.length).toBe(0);
    component.toggleAllPlatforms();
    expect(component.localPrefs.platformIds).toContain(26);

    component.togglePlatform(28);
    expect(component.isPlatformSelected(28)).toBe(true);
  });

  it('should dispatch test alert and report status', async () => {
    await component.onSendTest();
    expect(mockNotificationService.sendTestAlert).toHaveBeenCalled();
    expect(component.testSuccess()).toBe(true);
    expect(component.testMessage()).toContain('Test alert sent');
  });

  it('should save preferences and close modal', async () => {
    component.setScope('all');
    await component.onSavePreferences();

    expect(mockNotificationService.updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'all' }),
    );
    expect(component.saveMessage()).toBe('✓ Saved!');
  });

  it('should emit close on escape key and backdrop click', () => {
    let closed = false;
    component.close.subscribe(() => {
      closed = true;
    });

    component.onEscapeKey();
    expect(closed).toBe(true);

    closed = false;
    const mockBackdropEvent = {
      target: fixture.nativeElement.querySelector('.modal-backdrop'),
      currentTarget: fixture.nativeElement.querySelector('.modal-backdrop'),
    } as unknown as MouseEvent;
    component.onBackdropClick(mockBackdropEvent);
    expect(closed).toBe(true);
  });
});
