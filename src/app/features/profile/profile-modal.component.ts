import {
  Component,
  inject,
  OnInit,
  signal,
  computed,
  ElementRef,
  ViewChild,
  effect,
  untracked,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { KitProfileModalComponent } from '@wesdizzle/app-kit/angular';
import { CollectionService } from '../../core/services/collection.service';
import { ProfileModalService } from '../../core/services/profile-modal.service';
import { NotificationService } from '../../core/services/notification.service';
import { BrandingService } from '../../core/services/branding.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { NotificationSettingsModalComponent } from '../collection/notifications/notification-settings-modal/notification-settings-modal.component';
import { UserProfile } from '../../core/models/collection.models';

@Component({
  selector: 'app-profile-modal',
  standalone: true,
  imports: [
    FormsModule,
    KitProfileModalComponent,
    IconComponent,
    NotificationSettingsModalComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <kit-profile-modal
      #kitModal
      [isOpen]="modalService.isOpen()"
      [activeView]="modalService.activeView()"
      [isAuthenticated]="isAuthenticated()"
      [user]="profile()"
      [displayName]="displayName"
      (displayNameChange)="displayName = $event"
      [bio]="bio"
      (bioChange)="bio = $event"
      [isPublic]="isPublic"
      (isPublicChange)="isPublic = $event"
      [saving]="isSaving()"
      [statusMessage]="statusMessage() || ''"
      [isError]="isError()"
      [copied]="copied()"
      [accountHubUrl]="accountHubUrl()"
      collectionNoun="library"
      (saveClicked)="saveProfile()"
      (copyClicked)="copyLink()"
      (signOutClicked)="signOut()"
      (closed)="requestClose()"
      (backToProfile)="modalService.setView('profile')"
    >
      <div profileExtraFields class="field-group">
        <div class="field-label-row">
          <label for="homeRegion">Home Region</label>
        </div>
        <select
          id="homeRegion"
          name="homeRegion"
          [(ngModel)]="homeRegion"
          class="text-input"
        >
          @for (r of homeRegions(); track r) {
            <option [value]="r">{{ r }}</option>
          }
        </select>
        <span class="field-hint">
          Controls your default regional library filter and localized game title
          matching.
        </span>
      </div>

      @if (isAuthenticated()) {
        <button
          profileExtraNav
          type="button"
          class="nav-section-btn"
          (click)="openNotifications()"
          data-testid="profile-notifications-btn"
        >
          <div class="nav-section-left">
            <span class="nav-section-icon">
              <app-icon name="bell" [size]="18" />
            </span>
            <div class="nav-section-text">
              <span class="nav-section-title">Notifications &amp; Alerts</span>
              <span class="nav-section-desc">
                Configure push alerts for physical pre-orders, launch days, and
                retail deals.
              </span>
            </div>
          </div>
          <div class="setting-nav-right">
            <span
              class="notif-status-badge"
              [class.active]="notificationService.isSubscribed()"
            >
              {{ notificationService.isSubscribed() ? 'Active' : 'Disabled' }}
            </span>
            <svg
              class="nav-section-chevron"
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </div>
        </button>
      }

      @if (modalService.activeView() === 'notifications') {
        <app-notification-settings-modal
          profileSubview
          [embedded]="true"
          (back)="modalService.setView('profile')"
          (close)="requestClose()"
        />
      }
    </kit-profile-modal>
  `,
  styles: [
    `
      .setting-nav-right {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-shrink: 0;
      }

      .notif-status-badge {
        font-size: 0.6875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        padding: 0.175rem 0.5rem;
        border-radius: 999px;
        background: var(--m3-surface-container-highest);
        color: var(--m3-on-surface-variant);
        border: 1px solid var(--m3-outline-variant);
      }

      .notif-status-badge.active {
        background: var(--kit-success-subtle);
        color: var(--kit-success);
        border-color: var(--kit-success-border);
      }
    `,
  ],
})
export class ProfileModalComponent implements OnInit {
  @ViewChild('kitModal') kitModal?: KitProfileModalComponent;

  get dialogEl(): ElementRef<HTMLDialogElement> | undefined {
    return this.kitModal?.dialogEl;
  }

  private collectionService = inject(CollectionService);
  public modalService = inject(ProfileModalService);
  public notificationService = inject(NotificationService);
  public branding = inject(BrandingService);

  public isAuthenticated = this.collectionService.isAuthenticated;
  public publicProfile = this.collectionService.publicProfile;
  public accountHubUrl = computed(
    () =>
      this.collectionService.accountHubUrl() ||
      this.branding.accountHubUrl() ||
      '/api/auth/account',
  );

  public profile = signal<UserProfile | null>(null);
  public homeRegions = signal<string[]>([
    'USA',
    'Japan',
    'Europe',
    'UK',
    'World',
    'Asia',
    'Australia',
  ]);

  private _displayName = signal('');
  private _bio = signal('');
  private _homeRegion = signal('USA');
  private _isPublic = signal(false);

  get displayName(): string {
    return this._displayName();
  }
  set displayName(value: string) {
    this._displayName.set(value);
  }

  get bio(): string {
    return this._bio();
  }
  set bio(value: string) {
    this._bio.set(value);
  }

  get homeRegion(): string {
    return this._homeRegion();
  }
  set homeRegion(value: string) {
    this._homeRegion.set(value);
  }

  get isPublic(): boolean {
    return this._isPublic();
  }
  set isPublic(value: boolean) {
    this._isPublic.set(value);
  }

  public isSaving = signal<boolean>(false);
  public statusMessage = signal<string | null>(null);
  public isError = signal<boolean>(false);
  public copied = signal<boolean>(false);

  public publicUrl = computed(() => {
    const username = this.profile()?.username;
    if (!username) return '';
    if (typeof window !== 'undefined' && window.location) {
      return `${window.location.origin}/u/${username}`;
    }
    return `/u/${username}`;
  });

  constructor() {
    effect(() => {
      const open = this.modalService.isOpen();
      untracked(() => {
        if (open) {
          this.statusMessage.set(null);
          if (this.isAuthenticated()) {
            this.loadProfileData();
          }
        }
      });
    });
  }

  ngOnInit(): void {
    if (this.isAuthenticated()) {
      this.collectionService.getHomeRegions().subscribe({
        next: (regions) => this.homeRegions.set(regions),
        error: () => {},
      });
    }
  }

  private loadProfileData(): void {
    this.collectionService.getProfile().subscribe({
      next: (user) => {
        this.profile.set(user);
        this.displayName = user.displayName || '';
        this.bio = user.bio || '';
        this.homeRegion = user.homeRegion || 'USA';
        this.isPublic = user.isPublic;
      },
      error: () => {
        const current = this.collectionService.currentUser();
        if (current) {
          this.profile.set(current);
          this.displayName = current.displayName || '';
          this.bio = current.bio || '';
          this.homeRegion = current.homeRegion || 'USA';
          this.isPublic = current.isPublic;
        }
      },
    });
  }

  public requestClose(): void {
    this.modalService.close();
  }

  public openNotifications(): void {
    this.modalService.setView('notifications');
  }

  public saveProfile(): void {
    this.isSaving.set(true);
    this.statusMessage.set(null);
    this.isError.set(false);

    this.collectionService
      .updateProfile({
        displayName: this.displayName.trim() || null,
        bio: this.bio.trim() || null,
        homeRegion: this.homeRegion,
        isPublic: this.isPublic,
      })
      .subscribe({
        next: (updated) => {
          this.profile.set(updated);
          this.isSaving.set(false);
          this.statusMessage.set('Profile settings saved successfully.');
        },
        error: (err) => {
          this.isSaving.set(false);
          this.isError.set(true);
          const msg = err?.error?.error || 'Failed to update profile settings.';
          this.statusMessage.set(msg);
        },
      });
  }

  public copyLink(): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(this.publicUrl());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    }
  }

  public signOut(): void {
    void this.collectionService.signOut();
  }
}
