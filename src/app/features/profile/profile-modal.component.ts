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
import { Router } from '@angular/router';
import { KitProfileModalComponent } from '@wesdizzle/app-kit/angular';
import { CollectionService } from '../../core/services/collection.service';
import { ProfileModalService } from '../../core/services/profile-modal.service';
import { NotificationService } from '../../core/services/notification.service';
import { BrandingService } from '../../core/services/branding.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { NotificationSettingsModalComponent } from '../collection/notifications/notification-settings-modal/notification-settings-modal.component';
import {
  UserProfile,
  UserTrackingRule,
  CatalogSeedStatus,
} from '../../core/models/collection.models';

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
      (editProfileClicked)="onEditProfileClicked()"
      (publicToggleSaved)="onPublicToggleSaved($event)"
    >
      @if (isAuthenticated()) {
        <span
          profileIdentityBadges
          class="region-badge"
          data-testid="profile-region-badge"
          title="Home Region"
        >
          {{ homeRegion }}
        </span>
      }

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
        <div profileExtraNav class="profile-nav-groups">
          <div class="kit-nav-group">
            <span class="kit-nav-group-label">Preferences</span>
            <div class="kit-nav-group-list">
              <button
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
                    <span class="nav-section-title"
                      >Notifications &amp; Alerts</span
                    >
                    <span class="nav-section-desc">
                      Pre-orders, launch days &amp; deal alerts
                    </span>
                  </div>
                </div>
                <div class="setting-nav-right">
                  <span
                    class="notif-status-badge"
                    [class.active]="notificationService.isSubscribed()"
                  >
                    {{
                      notificationService.isSubscribed() ? 'Active' : 'Disabled'
                    }}
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

              <button
                type="button"
                class="nav-section-btn"
                (click)="openTrackingRules()"
                data-testid="profile-tracking-rules-btn"
              >
                <div class="nav-section-left">
                  <span class="nav-section-icon">
                    <app-icon name="wishlist" [size]="18" />
                  </span>
                  <div class="nav-section-text">
                    <span class="nav-section-title"
                      >Auto-Tracking &amp; Seeking Rules</span
                    >
                    <span class="nav-section-desc">
                      Series, platform &amp; toy line rules
                    </span>
                  </div>
                </div>
                <div class="setting-nav-right">
                  <span
                    class="notif-status-badge"
                    [class.active]="autoTrackSeriesOnAdd()"
                  >
                    {{ autoTrackSeriesOnAdd() ? 'Auto-Series' : 'Manual' }}
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

              <label
                class="toggle-row pref-toggle-row"
                for="toggle-track-individual-media-input"
              >
                <div class="nav-section-left">
                  <span class="nav-section-icon">
                    <app-icon name="disc" [size]="18" />
                  </span>
                  <div class="nav-section-text">
                    <span class="nav-section-title"
                      >Track Individual Discs &amp; Carts</span
                    >
                    <span class="nav-section-desc">
                      Show per-disc and cartridge ownership status on your
                      collection
                    </span>
                  </div>
                </div>
                <span class="switch-wrapper">
                  <input
                    id="toggle-track-individual-media-input"
                    type="checkbox"
                    role="switch"
                    class="sr-only-checkbox"
                    [attr.aria-checked]="trackIndividualMedia()"
                    [ngModel]="trackIndividualMedia()"
                    (ngModelChange)="onToggleTrackIndividualMedia($event)"
                    data-testid="toggle-track-individual-media"
                  />
                  <span
                    class="switch-track"
                    [class.checked]="trackIndividualMedia()"
                  >
                    <span class="switch-thumb"></span>
                  </span>
                </span>
              </label>
            </div>
          </div>

          @if (isAdmin()) {
            <div class="kit-nav-group">
              <span class="kit-nav-group-label">Admin</span>
              <div class="kit-nav-group-list">
                <button
                  type="button"
                  class="nav-section-btn"
                  (click)="openOwnershipVerification()"
                  data-testid="profile-verify-ownership-btn"
                >
                  <div class="nav-section-left">
                    <span class="nav-section-icon">
                      <app-icon name="disc" [size]="18" />
                    </span>
                    <div class="nav-section-text">
                      <span class="nav-section-title">Verify Owned Media</span>
                      <span class="nav-section-desc">
                        Audit individual discs &amp; carts against local library
                      </span>
                    </div>
                  </div>
                  <div class="setting-nav-right">
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

                <button
                  type="button"
                  class="nav-section-btn"
                  (click)="openAdminCenter()"
                  data-testid="profile-discovery-btn"
                >
                  <div class="nav-section-left">
                    <span class="nav-section-icon">
                      <app-icon name="compass" [size]="18" />
                    </span>
                    <div class="nav-section-text">
                      <span class="nav-section-title">Admin Center</span>
                      <span class="nav-section-desc">
                        Pipeline telemetry &amp; D1 write budget
                      </span>
                    </div>
                  </div>
                  <div class="setting-nav-right">
                    @if (catalogSeedStatus(); as seed) {
                      <span
                        class="notif-status-badge"
                        [class.active]="
                          !seed.paused &&
                          seed.stage !== 'done' &&
                          seed.stage !== 'completed'
                        "
                        [title]="
                          'Stage ' +
                          seed.stage.toUpperCase() +
                          ': ' +
                          (seed.dailyWritesUsed ?? seed.writesUsedToday) +
                          ' / ' +
                          seed.dailyWriteBudget +
                          ' writes today'
                        "
                      >
                        {{
                          seed.paused
                            ? 'Seed Paused'
                            : seed.stage === 'done' ||
                                seed.stage === 'completed'
                              ? 'Seeded'
                              : 'Stage ' + seed.stage.toUpperCase()
                        }}
                      </span>
                    }
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
              </div>
            </div>
          }
        </div>
      }

      @if (modalService.activeView() === 'notifications') {
        <app-notification-settings-modal
          profileSubview
          [embedded]="true"
          (back)="modalService.setView('profile')"
          (close)="requestClose()"
        />
      }

      @if (modalService.activeView() === 'tracking') {
        <div profileSubview class="tracking-subview">
          <header class="modal-header">
            <div class="header-title-row">
              <button
                type="button"
                class="subview-back-btn state-layer"
                (click)="modalService.setView('profile')"
                data-testid="tracking-back-btn"
                aria-label="Back to Profile"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </button>
              <h2>Auto-Tracking &amp; Seeking Rules</h2>
            </div>
            <button
              type="button"
              class="close-btn"
              (click)="requestClose()"
              aria-label="Close profile dialog"
            >
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </header>

          <div class="modal-body tracking-body">
            <label class="toggle-row" for="toggle-auto-track-series-input">
              <div class="toggle-text">
                <span class="toggle-title"
                  >Auto-track series when adding a game</span
                >
                <span class="toggle-desc">
                  Follow a game's franchise and mark other home-region physical
                  releases as Seeking when adding an entry.
                </span>
              </div>
              <span class="switch-wrapper">
                <input
                  id="toggle-auto-track-series-input"
                  type="checkbox"
                  role="switch"
                  class="sr-only-checkbox"
                  [attr.aria-checked]="autoTrackSeriesOnAdd()"
                  [ngModel]="autoTrackSeriesOnAdd()"
                  (ngModelChange)="onToggleAutoTrackSeries($event)"
                  data-testid="toggle-auto-track-series"
                />
                <span
                  class="switch-track"
                  [class.checked]="autoTrackSeriesOnAdd()"
                >
                  <span class="switch-thumb"></span>
                </span>
              </span>
            </label>

            <div class="tracking-card">
              <div class="tracking-label">Add Tracking or Ignore Rule</div>
              <div class="tracking-add-row">
                <select [(ngModel)]="newRuleType" class="text-input">
                  <option value="series">Game Series</option>
                  <option value="platform">Platform ID</option>
                  <option value="toy_line">Toy Line (e.g. amiibo)</option>
                  <option value="toy_series">Toy Series</option>
                </select>
                <input
                  type="text"
                  [(ngModel)]="newRuleTarget"
                  placeholder="Series name, Platform ID, or Toy Line..."
                  class="text-input"
                  data-testid="new-rule-target-input"
                />
                <label class="ignore-check">
                  <input type="checkbox" [(ngModel)]="newRuleIgnored" />
                  <span>Ignore</span>
                </label>
                <button
                  type="button"
                  class="rule-add-btn"
                  (click)="addRule()"
                  data-testid="add-tracking-rule-btn"
                >
                  Add
                </button>
              </div>
            </div>

            <div class="tracking-card">
              <div class="tracking-label">
                Active Rules ({{ trackingRules().length }})
              </div>
              @if (trackingRules().length === 0) {
                <div class="tracking-desc">
                  No tracking rules configured yet.
                </div>
              } @else {
                <div class="rules-list">
                  @for (
                    rule of trackingRules();
                    track rule.rule_type +
                      ':' +
                      (rule.target_value || rule.match_value)
                  ) {
                    <div class="rule-chip">
                      <span class="rule-type-badge">{{ rule.rule_type }}</span>
                      <span class="rule-target">{{
                        rule.target_value || rule.match_value
                      }}</span>
                      @if (rule.is_ignored) {
                        <span class="rule-ignored-badge">Ignored</span>
                      }
                      <button
                        type="button"
                        class="rule-remove-btn"
                        (click)="removeRule(rule)"
                        aria-label="Remove rule"
                      >
                        ×
                      </button>
                    </div>
                  }
                </div>
              }
            </div>
          </div>
        </div>
      }
    </kit-profile-modal>
  `,
  styles: [
    `
      .region-badge {
        font-size: 0.68rem;
        font-weight: 700;
        padding: 2px 7px;
        border-radius: 999px;
        background: var(--kit-surface-container-highest);
        color: var(--kit-on-surface-variant);
        border: 1px solid var(--kit-outline-variant);
      }

      .profile-nav-groups {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .pref-toggle-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        padding: 0.72rem 0.85rem;
        cursor: pointer;
        border-top: 1px solid
          var(--kit-outline-variant, rgba(255, 255, 255, 0.08));
        margin: 0;
        background: transparent;
      }

      .pref-toggle-row:hover {
        background: var(--kit-state-hover, rgba(255, 255, 255, 0.04));
      }

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

      .tracking-subview {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 0;
        color: var(--m3-on-surface);
      }

      .tracking-body {
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
      }

      .tracking-card {
        background: var(--m3-surface-container-low);
        border: 1px solid var(--m3-outline-variant);
        border-radius: 12px;
        padding: 0.85rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .tracking-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
      }

      .tracking-label {
        font-size: 0.85rem;
        font-weight: 600;
      }

      .tracking-desc {
        font-size: 0.75rem;
        color: var(--m3-on-surface-variant);
        margin-top: 0.2rem;
      }

      .tracking-add-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
      }

      .ignore-check {
        display: flex;
        align-items: center;
        gap: 0.3rem;
        font-size: 0.8rem;
      }

      .rule-add-btn {
        background: var(--m3-primary);
        color: var(--m3-on-primary);
        border: none;
        border-radius: 8px;
        padding: 0.4rem 0.85rem;
        font-size: 0.8rem;
        font-weight: 600;
        cursor: pointer;
      }

      .rules-list {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
      }

      .rule-chip {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0.25rem 0.6rem;
        border-radius: 999px;
        background: var(--m3-surface-container-highest);
        border: 1px solid var(--m3-outline-variant);
        font-size: 0.75rem;
      }

      .rule-type-badge {
        font-weight: 700;
        text-transform: uppercase;
        font-size: 0.65rem;
        opacity: 0.75;
      }

      .rule-ignored-badge {
        color: var(--kit-danger, #ef4444);
        font-weight: 700;
        font-size: 0.65rem;
      }

      .rule-remove-btn {
        background: transparent;
        border: none;
        color: inherit;
        cursor: pointer;
        font-size: 0.9rem;
        line-height: 1;
        padding: 0 0.15rem;
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
  private router = inject(Router);
  public modalService = inject(ProfileModalService);
  public notificationService = inject(NotificationService);
  public branding = inject(BrandingService);

  public isAuthenticated = this.collectionService.isAuthenticated;
  public isAdmin = this.collectionService.isAdmin;
  public publicProfile = this.collectionService.publicProfile;
  public autoTrackSeriesOnAdd = signal<boolean>(true);
  public trackIndividualMedia = signal<boolean>(false);
  public trackingRules = signal<UserTrackingRule[]>([]);
  public catalogSeedStatus = signal<CatalogSeedStatus | null>(null);
  public newRuleType: 'series' | 'platform' | 'toy_line' | 'toy_series' =
    'series';
  public newRuleTarget = '';
  public newRuleIgnored = false;
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
        this.autoTrackSeriesOnAdd.set(user.autoTrackSeriesOnAdd !== false);
        this.trackIndividualMedia.set(Boolean(user.trackIndividualMedia));
      },
      error: () => {
        const current = this.collectionService.currentUser();
        if (current) {
          this.profile.set(current);
          this.displayName = current.displayName || '';
          this.bio = current.bio || '';
          this.homeRegion = current.homeRegion || 'USA';
          this.isPublic = current.isPublic;
          this.autoTrackSeriesOnAdd.set(current.autoTrackSeriesOnAdd !== false);
          this.trackIndividualMedia.set(Boolean(current.trackIndividualMedia));
        }
      },
    });
    this.collectionService.getTrackingRules().subscribe({
      next: (rules) => this.trackingRules.set(rules),
      error: () => {},
    });
    if (this.isAdmin()) {
      this.collectionService.getCatalogSeedStatus().subscribe({
        next: (status) => this.catalogSeedStatus.set(status),
        error: () => {},
      });
    }
  }

  public requestClose(): void {
    this.modalService.close();
  }

  public onEditProfileClicked(): void {
    this.statusMessage.set(null);
    this.isError.set(false);
    this.modalService.setView('edit');
  }

  public onPublicToggleSaved(enabled: boolean): void {
    this.isPublic = enabled;
    this.statusMessage.set(null);
    this.isError.set(false);
    this.collectionService.updateProfile({ isPublic: enabled }).subscribe({
      next: (updated) => {
        this.profile.set(updated);
        this.statusMessage.set(
          enabled
            ? 'Public collection link enabled.'
            : 'Collection set to private.',
        );
      },
      error: (err) => {
        this.isError.set(true);
        this.statusMessage.set(
          err?.error?.error || 'Failed to update sharing preference.',
        );
      },
    });
  }

  public openNotifications(): void {
    this.modalService.setView('notifications');
  }

  public openTrackingRules(): void {
    this.modalService.setView('tracking');
  }

  public openOwnershipVerification(): void {
    this.modalService.close();
    void this.router.navigate(['/admin/verify-ownership']);
  }

  public openAdminCenter(): void {
    this.modalService.close();
    void this.router.navigate(['/admin']);
  }

  public onToggleAutoTrackSeries(enabled: boolean): void {
    this.autoTrackSeriesOnAdd.set(enabled);
    this.collectionService
      .updateProfile({ autoTrackSeriesOnAdd: enabled })
      .subscribe({
        next: (updated) => {
          this.profile.set(updated);
        },
        error: () => {},
      });
  }

  public onToggleTrackIndividualMedia(enabled: boolean): void {
    this.trackIndividualMedia.set(enabled);
    this.collectionService
      .updateProfile({ trackIndividualMedia: enabled })
      .subscribe({
        next: (updated) => {
          this.profile.set(updated);
        },
        error: () => {
          this.trackIndividualMedia.set(!enabled);
        },
      });
  }

  public addRule(): void {
    const target = this.newRuleTarget.trim();
    if (!target) return;
    this.collectionService
      .saveTrackingRule({
        rule_type: this.newRuleType,
        target_value: target,
        is_ignored: this.newRuleIgnored,
        clear_existing_seeking: this.newRuleIgnored,
      })
      .subscribe({
        next: () => {
          this.newRuleTarget = '';
          this.newRuleIgnored = false;
          this.collectionService.getTrackingRules().subscribe({
            next: (rules) => this.trackingRules.set(rules),
            error: () => {},
          });
          void this.collectionService.refreshAll();
        },
        error: () => {},
      });
  }

  public removeRule(rule: UserTrackingRule): void {
    const val = rule.target_value || rule.match_value || '';
    this.collectionService.deleteTrackingRule(rule.rule_type, val).subscribe({
      next: () => {
        this.trackingRules.update((list) =>
          list.filter(
            (r) =>
              !(
                r.rule_type === rule.rule_type &&
                (r.target_value || r.match_value) === val
              ),
          ),
        );
      },
      error: () => {},
    });
  }

  public toggleCatalogSeedPause(): void {
    const current = this.catalogSeedStatus();
    if (!current) return;
    const nextPaused = !current.paused;
    this.collectionService
      .updateCatalogSeedControl({ paused: nextPaused })
      .subscribe({
        next: (status) => this.catalogSeedStatus.set(status),
        error: () => {},
      });
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
          this.kitModal?.closeEditProfile();
          if (this.modalService.activeView() === 'edit') {
            this.modalService.setView('profile');
          }
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
