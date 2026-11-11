import '../../../test-setup';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { ProfileModalComponent } from './profile-modal.component';
import { CollectionService } from '../../core/services/collection.service';
import { ProfileModalService } from '../../core/services/profile-modal.service';
import { UserProfile } from '../../core/models/collection.models';

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
});
