import '../../../test-setup';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ProfileModalComponent } from './profile-modal.component';
import { CollectionService } from '../../core/services/collection.service';
import { ProfileModalService } from '../../core/services/profile-modal.service';
import {
  UserProfile,
  OwnershipStatus,
  formatToyRegionBadge,
} from '../../core/models/collection.models';

describe('ProfileModalComponent', () => {
  let component: ProfileModalComponent;
  let fixture: ComponentFixture<ProfileModalComponent>;
  let modalService: ProfileModalService;
  let collectionService: CollectionService;

  const mockUser: UserProfile = {
    id: 1,
    email: 'test@example.com',
    username: 'retrogamer',
    role: 'admin',
    isPublic: true,
    homeRegion: 'Japan',
    displayName: 'Retro Legend',
    bio: 'Passionate game collector.',
  };

  beforeEach(async () => {
    if (typeof HTMLDialogElement !== 'undefined') {
      if (!HTMLDialogElement.prototype.showModal) {
        HTMLDialogElement.prototype.showModal = function (
          this: HTMLDialogElement,
        ) {
          this.setAttribute('open', '');
        };
      }
      if (!HTMLDialogElement.prototype.close) {
        HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
          this.removeAttribute('open');
        };
      }
    }

    await TestBed.configureTestingModule({
      imports: [ProfileModalComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        CollectionService,
        ProfileModalService,
      ],
    }).compileComponents();

    modalService = TestBed.inject(ProfileModalService);
    collectionService = TestBed.inject(CollectionService);
    collectionService.setAdminForTesting(true);

    vi.spyOn(collectionService, 'getProfile').mockReturnValue(of(mockUser));
    vi.spyOn(collectionService, 'getHomeRegions').mockReturnValue(
      of(['USA', 'Japan', 'Europe', 'UK', 'World']),
    );

    fixture = TestBed.createComponent(ProfileModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load profile and home regions on open', () => {
    modalService.open();
    fixture.detectChanges();

    expect(component.profile()?.username).toBe('retrogamer');
    expect(component.displayName).toBe('Retro Legend');
    expect(component.bio).toBe('Passionate game collector.');
    expect(component.homeRegion).toBe('Japan');
    expect(component.isPublic).toBe(true);
    expect(component.homeRegions()).toContain('Japan');
  });

  it('should update profile and display success message on saveProfile()', () => {
    modalService.open();
    fixture.detectChanges();

    const updateSpy = vi
      .spyOn(collectionService, 'updateProfile')
      .mockReturnValue(
        of({
          ...mockUser,
          displayName: 'Updated Name',
        }),
      );

    component.displayName = 'Updated Name';
    component.saveProfile();

    expect(updateSpy).toHaveBeenCalledWith({
      displayName: 'Updated Name',
      bio: 'Passionate game collector.',
      homeRegion: 'Japan',
      isPublic: true,
    });
    expect(component.statusMessage()).toBe(
      'Profile settings saved successfully.',
    );
    expect(component.isError()).toBe(false);
  });

  it('should display error message when updateProfile fails', () => {
    vi.spyOn(collectionService, 'updateProfile').mockReturnValue(
      throwError(() => ({ error: { error: 'Username unavailable' } })),
    );

    component.saveProfile();
    expect(component.statusMessage()).toBe('Username unavailable');
    expect(component.isError()).toBe(true);
  });

  it('should copy public URL to clipboard', () => {
    const clipboardSpy = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: clipboardSpy },
    });

    component.profile.set(mockUser);
    component.copyLink();

    expect(clipboardSpy).toHaveBeenCalledWith(component.publicUrl());
    expect(component.copied()).toBe(true);
  });

  it('should request close on close button click and on backdrop click', () => {
    const closeSpy = vi.spyOn(component, 'requestClose');
    const closeBtn = fixture.nativeElement.querySelector(
      '[data-testid="profile-modal-close-btn"]',
    ) as HTMLButtonElement;

    closeBtn.click();
    expect(closeSpy).toHaveBeenCalled();

    const dialog = component.dialogEl?.nativeElement;
    if (dialog) {
      component.kitModal?.onDialogClick({
        target: dialog,
      } as unknown as MouseEvent);
      expect(closeSpy).toHaveBeenCalledTimes(2);
    }
  });

  it('should trigger close on touch swipe down past threshold', () => {
    const closeSpy = vi.spyOn(component, 'requestClose');

    component.kitModal?.onTouchStart({
      touches: [{ clientY: 100 }],
    } as unknown as TouchEvent);

    component.kitModal?.onTouchMove({
      touches: [{ clientY: 250 }],
    } as unknown as TouchEvent);

    expect(component.kitModal?.effectiveTransformY()).toBe(150);

    component.kitModal?.onTouchEnd();
    expect(closeSpy).toHaveBeenCalled();
  });

  it('should snap back open instead of closing when dragged down past threshold and then pulled upward', () => {
    vi.useFakeTimers();
    try {
      const closeSpy = vi.spyOn(component, 'requestClose');

      component.kitModal?.onTouchStart({
        touches: [{ clientY: 100 }],
      } as unknown as TouchEvent);
      vi.advanceTimersByTime(50);
      component.kitModal?.onTouchMove({
        touches: [{ clientY: 250 }],
      } as unknown as TouchEvent);
      expect(component.kitModal?.effectiveTransformY()).toBe(150);

      vi.advanceTimersByTime(16);
      component.kitModal?.onTouchMove({
        touches: [{ clientY: 210 }],
      } as unknown as TouchEvent);
      expect(component.kitModal?.effectiveTransformY()).toBe(110);

      component.kitModal?.onTouchEnd();
      expect(closeSpy).not.toHaveBeenCalled();
      expect(component.kitModal?.effectiveTransformY()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should transition in-place to notifications view and back to profile view', () => {
    modalService.open();
    fixture.detectChanges();

    expect(modalService.activeView()).toBe('profile');
    expect(
      fixture.nativeElement.querySelector('app-notification-settings-modal'),
    ).toBeNull();

    const notifBtn = fixture.nativeElement.querySelector(
      '[data-testid="profile-notifications-btn"]',
    ) as HTMLButtonElement;
    expect(notifBtn).toBeTruthy();

    notifBtn.click();
    fixture.detectChanges();

    expect(modalService.activeView()).toBe('notifications');
    const embeddedNotif = fixture.nativeElement.querySelector(
      'app-notification-settings-modal',
    );
    expect(embeddedNotif).toBeTruthy();

    const backBtn = fixture.nativeElement.querySelector(
      '[data-testid="notifications-back-btn"]',
    ) as HTMLButtonElement;
    expect(backBtn).toBeTruthy();

    backBtn.click();
    fixture.detectChanges();

    expect(modalService.activeView()).toBe('profile');
    expect(
      fixture.nativeElement.querySelector('app-notification-settings-modal'),
    ).toBeNull();
  });

  it('should return to profile view on Escape cancel event when in notifications view', () => {
    modalService.open('notifications');
    fixture.detectChanges();

    const closeSpy = vi.spyOn(component, 'requestClose');
    const cancelEvent = new Event('cancel', { cancelable: true });
    component.kitModal?.onDialogCancel(cancelEvent);
    fixture.detectChanges();

    expect(modalService.activeView()).toBe('profile');
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('should render Account & Security Hub link when authenticated', () => {
    modalService.open();
    fixture.detectChanges();

    const accountHubLink = fixture.nativeElement.querySelector(
      '[data-testid="profile-account-hub-link"]',
    ) as HTMLAnchorElement;
    expect(accountHubLink).toBeTruthy();
    expect(accountHubLink.getAttribute('href')).toBe('/api/auth/account');
  });

  it('should render guest sign-in prompt when user is not authenticated', () => {
    collectionService.setAdminForTesting(false);
    modalService.open();
    fixture.detectChanges();

    const guestView = fixture.nativeElement.querySelector(
      '[data-testid="profile-guest-view"]',
    );
    expect(guestView).toBeTruthy();

    const signInLink = fixture.nativeElement.querySelector(
      '[data-testid="profile-guest-signin-btn"]',
    ) as HTMLAnchorElement;
    expect(signInLink).toBeTruthy();
    expect(signInLink.getAttribute('href')).toBe('/api/auth/login');

    expect(
      fixture.nativeElement.querySelector('[data-testid="profile-save-btn"]'),
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="profile-notifications-btn"]',
      ),
    ).toBeNull();
  });

  it('should close profile modal and navigate to /admin/verify-ownership when Verify Owned Media is clicked by admin, and hide it for non-admins', () => {
    const router = TestBed.inject(Router);
    const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    modalService.open();
    fixture.detectChanges();

    const verifyBtn = fixture.nativeElement.querySelector(
      '[data-testid="profile-verify-ownership-btn"]',
    ) as HTMLButtonElement;
    expect(verifyBtn).toBeTruthy();

    verifyBtn.click();
    fixture.detectChanges();

    expect(modalService.isOpen()).toBe(false);
    expect(navSpy).toHaveBeenCalledWith(['/admin/verify-ownership']);

    collectionService.setCurrentUserForTesting({
      ...mockUser,
      role: 'user',
    });
    modalService.open();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="profile-verify-ownership-btn"]',
      ),
    ).toBeNull();
  });

  it('should toggle trackIndividualMedia preference via updateProfile', () => {
    const updateSpy = vi
      .spyOn(collectionService, 'updateProfile')
      .mockReturnValue(of({ ...mockUser, trackIndividualMedia: true }));

    modalService.open();
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="toggle-track-individual-media"]',
    ) as HTMLInputElement;
    expect(toggle).toBeTruthy();
    expect(toggle.checked).toBe(false);

    const toggleRow = toggle.closest('label') as HTMLLabelElement;
    expect(toggleRow).toBeTruthy();
    expect(toggleRow.classList.contains('pref-toggle-row')).toBe(true);
    expect(toggleRow.classList.contains('toggle-row')).toBe(false);
    expect(toggleRow.textContent).toContain('Show Individual Discs & Carts');
    expect(toggleRow.textContent).toContain(
      'Display saved per-disc & cart status',
    );

    toggle.click();
    fixture.detectChanges();

    expect(updateSpy).toHaveBeenCalledWith({ trackIndividualMedia: true });
    expect(component.trackIndividualMedia()).toBe(true);
  });

  it('should navigate to /admin when Admin Center button is clicked by admin', () => {
    const router = TestBed.inject(Router);
    const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    modalService.open();
    fixture.detectChanges();

    const discoveryBtn = fixture.nativeElement.querySelector(
      '[data-testid="profile-discovery-btn"]',
    ) as HTMLButtonElement;
    expect(discoveryBtn).toBeTruthy();

    discoveryBtn.click();
    fixture.detectChanges();

    expect(modalService.isOpen()).toBe(false);
    expect(navSpy).toHaveBeenCalledWith(['/admin']);
  });

  it('should transition to tracking rules view and support adding and removing rules', () => {
    vi.spyOn(collectionService, 'getTrackingRules').mockReturnValue(
      of([
        {
          user_id: 1,
          rule_type: 'series',
          target_value: 'Metroid',
          auto_status: OwnershipStatus.Seeking,
          is_ignored: 0,
        },
      ]),
    );
    const saveSpy = vi
      .spyOn(collectionService, 'saveTrackingRule')
      .mockReturnValue(of({ status: 'ok' }));
    const deleteSpy = vi
      .spyOn(collectionService, 'deleteTrackingRule')
      .mockReturnValue(of({ status: 'ok' }));

    modalService.open();
    fixture.detectChanges();

    const trackingBtn = fixture.nativeElement.querySelector(
      '[data-testid="profile-tracking-rules-btn"]',
    ) as HTMLButtonElement;
    expect(trackingBtn).toBeTruthy();

    trackingBtn.click();
    fixture.detectChanges();

    expect(modalService.activeView()).toBe('tracking');
    expect(component.trackingRules().length).toBe(1);

    component.newRuleType = 'series';
    component.newRuleTarget = 'The Legend of Zelda';
    component.newRuleRegionScope = 'home';
    component.newRuleIgnored = false;
    component.addRule();

    expect(saveSpy).toHaveBeenCalledWith({
      rule_type: 'series',
      target_value: 'The Legend of Zelda',
      region_scope: 'home',
      is_ignored: false,
      clear_existing_seeking: false,
    });

    component.newRuleType = 'series';
    component.newRuleTarget = 'Mother';
    component.newRuleRegionScope = 'any';
    component.addRule();
    expect(saveSpy).toHaveBeenCalledWith({
      rule_type: 'series',
      target_value: 'Mother',
      region_scope: 'any',
      is_ignored: false,
      clear_existing_seeking: false,
    });

    const updateProfileSpy = vi
      .spyOn(collectionService, 'updateProfile')
      .mockReturnValue(
        of({
          id: 1,
          username: 'alice',
          role: 'admin',
          isPublic: false,
          homeRegion: 'USA',
          displayName: null,
          bio: null,
          autoSeekRegionScope: 'any',
          autoSeekReleaseScope: 'all_releases',
        }),
      );
    component.onChangeAutoSeekRegionScope('any');
    expect(component.autoSeekRegionScope()).toBe('any');
    expect(component.newRuleRegionScope).toBe('any');
    expect(updateProfileSpy).toHaveBeenCalledWith({
      autoSeekRegionScope: 'any',
    });

    component.onChangeAutoSeekReleaseScope('all_releases');
    expect(component.autoSeekReleaseScope()).toBe('all_releases');
    expect(updateProfileSpy).toHaveBeenCalledWith({
      autoSeekReleaseScope: 'all_releases',
    });

    const refreshSpy = vi
      .spyOn(collectionService, 'refreshAll')
      .mockResolvedValue();
    const showOptionsSpy = vi
      .spyOn(collectionService, 'showOptions')
      .mockImplementation((_t, _m, _opts, onConfirm) => onConfirm('keep'));

    component.removeRule(component.trackingRules()[0]);
    expect(showOptionsSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith('series', 'Metroid', false);
    expect(component.trackingRules().length).toBe(0);
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it('should un-seek existing Seeking games when user selects clear on active series rule removal and delete ignored/platform rules directly', () => {
    const refreshSpy = vi
      .spyOn(collectionService, 'refreshAll')
      .mockResolvedValue();
    const deleteSpy = vi
      .spyOn(collectionService, 'deleteTrackingRule')
      .mockReturnValue(of({ status: 'ok' }));
    const showOptionsSpy = vi
      .spyOn(collectionService, 'showOptions')
      .mockImplementation((_t, _m, _opts, onConfirm) => onConfirm('clear'));

    const activeSeriesRule = {
      user_id: 1,
      rule_type: 'series' as const,
      target_value: 'Metroid',
      auto_status: OwnershipStatus.Seeking,
      is_ignored: 0,
    };
    const ignoredSeriesRule = {
      user_id: 1,
      rule_type: 'series' as const,
      target_value: 'Disney',
      auto_status: OwnershipStatus.Seeking,
      is_ignored: 1,
    };
    const platformRule = {
      user_id: 1,
      rule_type: 'platform' as const,
      target_value: '26',
      auto_status: OwnershipStatus.Seeking,
      is_ignored: 0,
    };
    component.trackingRules.set([
      activeSeriesRule,
      ignoredSeriesRule,
      platformRule,
    ]);

    component.removeRule(activeSeriesRule);
    expect(showOptionsSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith('series', 'Metroid', true);
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(component.trackingRules().length).toBe(2);

    showOptionsSpy.mockClear();
    refreshSpy.mockClear();

    component.removeRule(ignoredSeriesRule);
    expect(showOptionsSpy).not.toHaveBeenCalled();
    expect(deleteSpy).toHaveBeenCalledWith('series', 'Disney', false);
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(component.trackingRules().length).toBe(1);

    component.removeRule(platformRule);
    expect(showOptionsSpy).not.toHaveBeenCalled();
    expect(deleteSpy).toHaveBeenCalledWith('platform', '26', false);
    expect(component.trackingRules().length).toBe(0);
  });

  it('should render Healthy badge with writesUsedToday tooltip when canonical tailer has 0 pending rows', () => {
    vi.spyOn(collectionService, 'getCatalogSeedStatus').mockReturnValue(
      of({
        canonicalTailer: {
          cursor: 5120,
          canonicalMinId: 1,
          canonicalMaxId: 5120,
          pendingCanonicalRows: 0,
          writesUsedToday: 120,
          dailyWriteBudget: 60000,
          gamesIngestedToday: 4,
          releasesIngestedToday: 8,
          lastUpdatedAt: '2026-11-22T01:00:00Z',
          maxGameStableId: 4000,
        },
        igdbRolling: {
          cursorOffset: 200,
          refreshedTotal: 100,
          updatedTotal: 10,
          selfHealedRulesTotal: 2,
          lastRunAt: '2026-11-22T02:00:00Z',
        },
        seriesDiscovery: {
          cursor: 1,
          totalSeriesRules: 5,
          seriesScannedTotal: 20,
          discoveredGamesTotal: 3,
          lastRunAt: '2026-11-22T02:00:00Z',
        },
        upstreamSources: {
          boutiquePreOrdersUpdatedAt: null,
          retailPreOrdersUpdatedAt: null,
          retailDealsUpdatedAt: null,
          switchRevisionsUpdatedAt: null,
          nsCollectorsUpdatedAt: null,
          amiiboCatalogUpdatedAt: null,
          catalogChunksUpdatedAt: null,
        },
      }),
    );

    modalService.open();
    fixture.detectChanges();

    const discoveryBtn = fixture.nativeElement.querySelector(
      '[data-testid="profile-discovery-btn"]',
    ) as HTMLButtonElement;
    const badge = discoveryBtn?.querySelector('.notif-status-badge');
    expect(badge?.textContent?.trim()).toBe('Healthy');
    expect(badge?.classList.contains('active')).toBe(false);
    expect(badge?.getAttribute('title')).toContain('120 / 60000 writes today');
  });

  it('should format multi-region toy badges and expose PrioritySeeking = 4', () => {
    expect(OwnershipStatus.PrioritySeeking).toBe(4);
    expect(formatToyRegionBadge('USA, Europe, Japan, Australia')).toBe(
      'USA, Europe, Japan, Australia',
    );
    expect(formatToyRegionBadge('USA, Europe, Japan')).toBe(
      'USA, Europe, Japan',
    );
    expect(formatToyRegionBadge('Japan')).toBe('Japan');
    expect(formatToyRegionBadge('USA, Japan')).toBe('USA, Japan');
    expect(formatToyRegionBadge(null)).toBe('USA');
  });

  it('should render region badge on root hub, transition to Edit Profile subview, and save/back cleanly', () => {
    modalService.open();
    fixture.detectChanges();

    expect(modalService.activeView()).toBe('profile');
    const regionBadge = fixture.nativeElement.querySelector(
      '[data-testid="profile-region-badge"]',
    ) as HTMLElement;
    expect(regionBadge?.textContent?.trim()).toBe('Japan');
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="profile-edit-subview"]',
      ),
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="profile-save-btn"]'),
    ).toBeNull();

    const editBtn = fixture.nativeElement.querySelector(
      '[data-testid="profile-edit-btn"]',
    ) as HTMLButtonElement;
    expect(editBtn).toBeTruthy();
    editBtn.click();
    fixture.detectChanges();

    expect(modalService.activeView()).toBe('edit');
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="profile-edit-subview"]',
      ),
    ).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#homeRegion')).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('[data-testid="profile-save-btn"]'),
    ).toBeTruthy();

    const backBtn = fixture.nativeElement.querySelector(
      '[data-testid="profile-edit-back-btn"]',
    ) as HTMLButtonElement;
    backBtn.click();
    fixture.detectChanges();

    expect(modalService.activeView()).toBe('profile');
    expect(
      fixture.nativeElement.querySelector('[data-testid="profile-hub-view"]'),
    ).toBeTruthy();

    const editBtnAgain = fixture.nativeElement.querySelector(
      '[data-testid="profile-edit-btn"]',
    ) as HTMLButtonElement;
    expect(editBtnAgain).toBeTruthy();
    editBtnAgain.click();
    fixture.detectChanges();
    expect(modalService.activeView()).toBe('edit');

    const updateSpy = vi
      .spyOn(collectionService, 'updateProfile')
      .mockReturnValue(of({ ...mockUser, isPublic: false }));
    component.saveProfile();
    fixture.detectChanges();
    expect(modalService.activeView()).toBe('profile');

    component.onPublicToggleSaved(false);
    expect(updateSpy).toHaveBeenCalledWith({ isPublic: false });
    expect(component.isPublic).toBe(false);
  });
});
