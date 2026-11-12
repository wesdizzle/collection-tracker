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

      @if (isAuthenticated()) {
        <button
          profileExtraNav
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
                Automatically mark games &amp; toys as Seeking by series,
                platform, or toy line.
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
      }

      @if (isAuthenticated()) {
        <button
          profileExtraNav
          type="button"
          class="nav-section-btn"
          (click)="openBackupScanner()"
          data-testid="profile-backup-scanner-btn"
        >
          <div class="nav-section-left">
            <span class="nav-section-icon">
              <app-icon name="disc" [size]="18" />
            </span>
            <div class="nav-section-text">
              <span class="nav-section-title">Scan Local Backups</span>
              <span class="nav-section-desc">
                Crawl a local folder by filename to review and sync ROM backup
                status.
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
      }

      @if (isAdmin()) {
        <button
          profileExtraNav
          type="button"
          class="nav-section-btn"
          (click)="openDiscovery()"
          data-testid="profile-discovery-btn"
        >
          <div class="nav-section-left">
            <span class="nav-section-icon">
              <app-icon name="compass" [size]="18" />
            </span>
            <div class="nav-section-text">
              <span class="nav-section-title"
                >Admin: Discovery &amp; Catalog Center</span
              >
              <span class="nav-section-desc">
                Add manual releases, inspect IGDB/Amiibo feeds, and manage
                catalog ingestion.
              </span>
            </div>
          </div>
          <div class="setting-nav-right">
            @if (catalogSeedStatus(); as seed) {
              <span
                class="notif-status-badge"
                [class.active]="!seed.paused && seed.stage !== 'completed'"
                [title]="
                  'Stage ' +
                  seed.stage.toUpperCase() +
                  ': ' +
                  seed.dailyWritesUsed +
                  ' / ' +
                  seed.dailyWriteBudget +
                  ' writes today'
                "
              >
                {{
                  seed.paused
                    ? 'Seed Paused'
                    : seed.stage === 'completed'
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
          <div class="tracking-header">
            <button
              type="button"
              class="tracking-back-btn"
              (click)="modalService.setView('profile')"
              data-testid="tracking-back-btn"
              aria-label="Back to Profile"
            >
              ← Back
            </button>
            <h3 class="tracking-title">Auto-Tracking &amp; Seeking Rules</h3>
          </div>

          <div class="tracking-body">
            <div class="tracking-card">
              <div class="tracking-row">
                <div>
                  <div class="tracking-label">
                    Auto-track series when adding a game
                  </div>
                  <div class="tracking-desc">
                    Automatically follow a game's franchise and mark its other
                    home-region physical releases as Seeking whenever you mark a
                    game as Owned, Seeking, Ordered, or Priority Seeking.
                  </div>
                </div>
                <input
                  type="checkbox"
                  [ngModel]="autoTrackSeriesOnAdd()"
                  (ngModelChange)="onToggleAutoTrackSeries($event)"
                  data-testid="toggle-auto-track-series"
                />
              </div>
            </div>

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

            @if (isAdmin() && catalogSeedStatus(); as seed) {
              <div class="tracking-card">
                <div class="tracking-row">
                  <div>
                    <div class="tracking-label">
                      Admin: Autonomous Broad Catalog Seed
                    </div>
                    <div class="tracking-desc">
                      Stage: <strong>{{ seed.stage.toUpperCase() }}</strong> •
                      Cursor ID: {{ seed.cursorId ?? seed.cursor }} • Daily D1
                      Writes:
                      {{ seed.dailyWritesUsed ?? seed.writesUsedToday }} /
                      {{ seed.dailyWriteBudget }}
                    </div>
                  </div>
                  <button
                    type="button"
                    class="rule-add-btn"
                    (click)="toggleCatalogSeedPause()"
                    data-testid="profile-catalog-seed-toggle-btn"
                  >
                    {{ seed.paused ? 'Resume' : 'Pause' }}
                  </button>
                </div>
              </div>
            }
          </div>
        </div>
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

      .tracking-subview {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        padding: 1.25rem;
        color: var(--m3-on-surface);
      }

      .tracking-header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .tracking-back-btn {
        background: transparent;
        border: 1px solid var(--m3-outline-variant);
        color: var(--m3-on-surface);
        padding: 0.35rem 0.75rem;
        border-radius: 999px;
        cursor: pointer;
        font-size: 0.8rem;
      }

      .tracking-title {
        margin: 0;
        font-size: 1.05rem;
        font-weight: 700;
      }

      .tracking-body {
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
        max-height: 65vh;
        overflow-y: auto;
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

  public openNotifications(): void {
    this.modalService.setView('notifications');
  }

  public openTrackingRules(): void {
    this.modalService.setView('tracking');
  }

  public openBackupScanner(): void {
    this.modalService.close();
    void this.router.navigate(['/collection/backups']);
  }

  public openDiscovery(): void {
    this.modalService.close();
    void this.router.navigate(['/discovery']);
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
