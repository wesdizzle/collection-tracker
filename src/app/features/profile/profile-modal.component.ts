import {
  Component,
  inject,
  OnInit,
  signal,
  computed,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CollectionService } from '../../core/services/collection.service';
import { ProfileModalService } from '../../core/services/profile-modal.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { UserProfile } from '../../core/models/collection.models';

@Component({
  selector: 'app-profile-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <dialog
      #dialogEl
      class="profile-dialog m3-surface-container-high"
      [class.dragging]="isDraggingSheet()"
      [class.slide-up-enter]="isEntering()"
      [class.closing]="isClosing()"
      [style.transform]="
        effectiveTransformY() !== null
          ? 'translateY(' + effectiveTransformY() + 'px)'
          : null
      "
      (click)="onDialogClick($event)"
      (cancel)="onDialogCancel($event)"
      aria-label="Collector Profile & Settings"
    >
      <!-- Mobile Drag Handle Area -->
      <div
        class="sheet-drag-area"
        (touchstart)="onTouchStart($event)"
        (touchmove)="onTouchMove($event)"
        (touchend)="onTouchEnd()"
      >
        <div class="sheet-drag-handle-bar">
          <div class="sheet-drag-handle"></div>
        </div>
      </div>

      <!-- Header -->
      <header class="modal-header">
        <div class="header-left">
          <div class="avatar-circle">
            <app-icon name="user" [size]="24" />
          </div>
          <div class="header-user-info">
            <div class="user-row">
              <span class="user-handle"
                >&#64;{{ profile()?.username || 'collector' }}</span
              >
              <span
                class="role-badge"
                [class.role-admin]="profile()?.role === 'admin'"
              >
                {{ profile()?.role === 'admin' ? 'Admin' : 'Collector' }}
              </span>
            </div>
            <span class="user-email">{{ profile()?.email }}</span>
          </div>
        </div>

        <button
          type="button"
          class="btn-close state-layer"
          (click)="requestClose()"
          aria-label="Close Profile"
          data-testid="profile-modal-close-btn"
        >
          <app-icon name="close" [size]="18" />
        </button>
      </header>

      <!-- Content / Form -->
      <div class="modal-body">
        @if (statusMessage()) {
          <div
            class="status-banner"
            [class.status-error]="isError()"
            data-testid="profile-status-banner"
          >
            <span>{{ statusMessage() }}</span>
          </div>
        }

        <form (ngSubmit)="saveProfile()" class="profile-form">
          <div class="form-group">
            <label for="displayName">Display Name</label>
            <input
              type="text"
              id="displayName"
              name="displayName"
              [(ngModel)]="displayName"
              placeholder="e.g. Retro Gamer"
              maxlength="100"
              class="form-input"
            />
          </div>

          <div class="form-group">
            <label for="bio">Bio</label>
            <textarea
              id="bio"
              name="bio"
              [(ngModel)]="bio"
              placeholder="A short note about your personal collection..."
              rows="2"
              maxlength="300"
              class="form-textarea"
            ></textarea>
          </div>

          <div class="form-group">
            <label for="homeRegion">Home Region</label>
            <select
              id="homeRegion"
              name="homeRegion"
              [(ngModel)]="homeRegion"
              class="form-select"
            >
              @for (r of homeRegions(); track r) {
                <option [value]="r">{{ r }}</option>
              }
            </select>
            <p class="field-hint">
              Controls your default regional library filter and localized game
              title matching.
            </p>
          </div>

          <div class="setting-toggle-box">
            <div class="toggle-info">
              <span class="toggle-title">Public Collection</span>
              <span class="toggle-desc">
                Allow anyone with your public link to browse your library
                without personal acquisition notes or spend figures.
              </span>
            </div>
            <label class="switch">
              <input
                type="checkbox"
                name="isPublic"
                [(ngModel)]="isPublic"
                data-testid="profile-public-switch"
              />
              <span class="slider"></span>
            </label>
          </div>

          @if (isPublic) {
            <div class="public-link-box animate-fade-in">
              <label class="public-link-label">Your Public Library Link</label>
              <div class="link-input-group">
                <input
                  type="text"
                  readonly
                  [value]="publicUrl()"
                  class="link-input"
                  data-testid="profile-public-url-input"
                />
                <button
                  type="button"
                  (click)="copyLink()"
                  class="btn-copy"
                  data-testid="profile-copy-link-btn"
                >
                  <app-icon [name]="copied() ? 'check' : 'copy'" [size]="14" />
                  <span>{{ copied() ? 'Copied' : 'Copy' }}</span>
                </button>
              </div>
            </div>
          }

          <div class="form-actions">
            <button
              type="submit"
              class="btn-primary"
              [disabled]="isSaving()"
              data-testid="profile-save-btn"
            >
              {{ isSaving() ? 'Saving...' : 'Save Changes' }}
            </button>
            <button
              type="button"
              class="btn-secondary"
              (click)="signOut()"
              data-testid="profile-signout-btn"
            >
              Sign Out
            </button>
          </div>
        </form>
      </div>
    </dialog>
  `,
  styles: [
    `
      .profile-dialog {
        margin: var(--spacing-48, 48px) auto auto auto;
        padding: 0;
        width: calc(100% - var(--spacing-32, 32px));
        max-width: 540px;
        max-height: calc(85vh - 48px);
        background: var(--m3-surface-container-high);
        border: 1px solid var(--m3-outline-variant);
        border-radius: var(--radius-lg, 24px);
        box-shadow:
          0 24px 64px rgba(0, 0, 0, 0.5),
          0 0 0 1px rgba(255, 255, 255, 0.05);
        overflow: hidden;
        color: var(--m3-on-surface);
      }

      .profile-dialog:not([open]) {
        display: none;
      }

      .profile-dialog[open] {
        display: flex;
        flex-direction: column;
      }

      .profile-dialog::backdrop {
        background: rgba(0, 0, 0, 0.65);
        backdrop-filter: blur(16px) contrast(95%) brightness(85%);
        -webkit-backdrop-filter: blur(16px) contrast(95%) brightness(85%);
        overscroll-behavior: contain;
      }

      .sheet-drag-area {
        display: none;
      }

      .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1.25rem 1.5rem;
        border-bottom: 1px solid var(--m3-outline-variant);
        background: var(--m3-surface-container);
      }

      .header-left {
        display: flex;
        align-items: center;
        gap: 1rem;
        min-width: 0;
      }

      .avatar-circle {
        width: 44px;
        height: 44px;
        border-radius: var(--radius-full);
        background: var(--m3-primary-container);
        color: var(--m3-on-primary-container);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .header-user-info {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        min-width: 0;
      }

      .user-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .user-handle {
        font-size: 1.125rem;
        font-weight: 700;
        color: var(--m3-on-surface);
      }

      .role-badge {
        font-size: 0.6875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        background: var(--m3-surface-container-highest);
        color: var(--m3-on-surface-variant);
        padding: 0.125rem 0.5rem;
        border-radius: var(--radius-full);
      }

      .role-badge.role-admin {
        background: var(--m3-primary);
        color: var(--m3-on-primary);
      }

      .user-email {
        font-size: 0.8125rem;
        color: var(--m3-on-surface-variant);
        opacity: 0.85;
      }

      .btn-close {
        background: transparent;
        border: none;
        color: var(--m3-on-surface-variant);
        width: 36px;
        height: 36px;
        border-radius: var(--radius-full);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: background-color 0.15s;
        flex-shrink: 0;
      }

      .btn-close:hover {
        background: var(--m3-surface-container-highest);
        color: var(--m3-on-surface);
      }

      .modal-body {
        padding: 1.5rem;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
      }

      .status-banner {
        padding: 0.75rem 1rem;
        border-radius: var(--radius-md);
        background: rgba(34, 197, 94, 0.15);
        color: #4ade80;
        font-size: 0.875rem;
        border: 1px solid rgba(34, 197, 94, 0.3);
      }

      .status-banner.status-error {
        background: rgba(239, 68, 68, 0.15);
        color: #f87171;
        border-color: rgba(239, 68, 68, 0.3);
      }

      .profile-form {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
      }

      .form-group {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }

      .form-group label {
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--m3-on-surface);
      }

      .field-hint {
        font-size: 0.75rem;
        color: var(--m3-on-surface-variant);
        margin: 0.25rem 0 0 0;
        line-height: 1.35;
      }

      .form-input,
      .form-textarea,
      .form-select {
        background: var(--m3-surface-container);
        border: 1px solid var(--m3-outline-variant);
        border-radius: var(--radius-md);
        padding: 0.625rem 0.875rem;
        color: var(--m3-on-surface);
        font-family: inherit;
        font-size: 0.9375rem;
        transition:
          border-color 0.2s,
          box-shadow 0.2s;
      }

      .form-input:focus,
      .form-textarea:focus,
      .form-select:focus {
        outline: none;
        border-color: var(--m3-primary);
        box-shadow: 0 0 0 2px var(--m3-primary-container);
      }

      .setting-toggle-box {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 1rem;
        background: var(--m3-surface-container);
        border: 1px solid var(--m3-outline-variant);
        border-radius: var(--radius-md);
      }

      .toggle-info {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .toggle-title {
        font-weight: 600;
        font-size: 0.9375rem;
        color: var(--m3-on-surface);
      }

      .toggle-desc {
        font-size: 0.75rem;
        color: var(--m3-on-surface-variant);
        line-height: 1.35;
      }

      .switch {
        position: relative;
        display: inline-block;
        width: 48px;
        height: 28px;
        flex-shrink: 0;
      }

      .switch input {
        opacity: 0;
        width: 0;
        height: 0;
      }

      .slider {
        position: absolute;
        cursor: pointer;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: var(--m3-surface-container-highest);
        transition: 0.2s;
        border-radius: 28px;
        border: 1px solid var(--m3-outline-variant);
      }

      .slider:before {
        position: absolute;
        content: '';
        height: 20px;
        width: 20px;
        left: 3px;
        bottom: 3px;
        background-color: var(--m3-outline);
        transition: 0.2s;
        border-radius: 50%;
      }

      input:checked + .slider {
        background-color: var(--m3-primary);
        border-color: var(--m3-primary);
      }

      input:checked + .slider:before {
        transform: translateX(20px);
        background-color: var(--m3-on-primary);
      }

      .public-link-box {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        padding: 0.875rem;
        background: var(--m3-surface-container);
        border: 1px solid var(--m3-outline-variant);
        border-radius: var(--radius-md);
      }

      .public-link-label {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--m3-on-surface-variant);
      }

      .link-input-group {
        display: flex;
        gap: 0.5rem;
      }

      .link-input {
        flex: 1;
        background: var(--m3-surface-container-low);
        border: 1px solid var(--m3-outline-variant);
        border-radius: var(--radius-sm);
        padding: 0.375rem 0.625rem;
        color: var(--m3-on-surface);
        font-size: 0.8125rem;
        font-family: monospace;
      }

      .btn-copy {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        background: var(--m3-secondary-container);
        color: var(--m3-on-secondary-container);
        border: none;
        border-radius: var(--radius-sm);
        padding: 0.375rem 0.75rem;
        font-size: 0.8125rem;
        font-weight: 600;
        cursor: pointer;
        transition: opacity 0.2s;
      }

      .btn-copy:hover {
        opacity: 0.85;
      }

      .form-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        margin-top: 0.5rem;
        padding-top: 1rem;
        border-top: 1px solid var(--m3-outline-variant);
      }

      .btn-primary {
        background: var(--m3-primary);
        color: var(--m3-on-primary);
        border: none;
        border-radius: var(--radius-full);
        padding: 0.625rem 1.25rem;
        font-weight: 600;
        font-size: 0.875rem;
        cursor: pointer;
        transition: opacity 0.2s;
      }

      .btn-primary:hover:not(:disabled) {
        opacity: 0.9;
      }

      .btn-primary:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .btn-secondary {
        background: transparent;
        color: var(--m3-error, #f87171);
        border: 1px solid var(--m3-error, #f87171);
        border-radius: var(--radius-full);
        padding: 0.625rem 1.25rem;
        font-weight: 600;
        font-size: 0.875rem;
        cursor: pointer;
        transition:
          background-color 0.2s,
          color 0.2s;
      }

      .btn-secondary:hover {
        background: var(--m3-error, #f87171);
        color: #ffffff;
      }

      /* Mobile Bottom Sheet */
      @media (max-width: 768px) {
        .profile-dialog {
          margin: auto 0 0 0;
          width: 100%;
          max-width: 100%;
          max-height: 90vh;
          border-radius: var(--radius-lg, 24px) var(--radius-lg, 24px) 0 0;
          border-bottom: none;
          transform: translateY(0);
          transition: transform 0.25s cubic-bezier(0.2, 0, 0, 1);
        }

        .profile-dialog.dragging {
          transition: none !important;
        }

        .profile-dialog.slide-up-enter {
          animation: sheetSlideUp 0.28s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        @keyframes sheetSlideUp {
          from {
            transform: translateY(100%);
          }
          to {
            transform: translateY(0);
          }
        }

        .profile-dialog.closing {
          transform: translateY(100%) !important;
          opacity: 1 !important;
          transition: transform 0.22s cubic-bezier(0.4, 0, 1, 1) !important;
        }

        .profile-dialog.closing::backdrop {
          opacity: 0;
          transition: opacity 0.2s ease-out;
        }

        .sheet-drag-area {
          display: block;
          cursor: grab;
          touch-action: none;
          background: var(--m3-surface-container);
        }

        .sheet-drag-handle-bar {
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 0.625rem 0 0.25rem;
        }

        .sheet-drag-handle {
          width: 36px;
          height: 4px;
          border-radius: 2px;
          background: var(--m3-outline-variant);
        }

        .modal-header {
          padding: 0.75rem 1.25rem 1rem;
        }

        .modal-body {
          padding: 1.25rem;
        }
      }
    `,
  ],
})
export class ProfileModalComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('dialogEl') dialogEl?: ElementRef<HTMLDialogElement>;

  private collectionService = inject(CollectionService);
  public modalService = inject(ProfileModalService);

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

  public displayName = '';
  public bio = '';
  public homeRegion = 'USA';
  public isPublic = false;

  public isSaving = signal<boolean>(false);
  public statusMessage = signal<string | null>(null);
  public isError = signal<boolean>(false);
  public copied = signal<boolean>(false);

  // Animations & Sheet Dragging
  public isEntering = signal<boolean>(false);
  public isClosing = signal<boolean>(false);
  public isDraggingSheet = signal<boolean>(false);
  public effectiveTransformY = signal<number | null>(null);

  private dragStartY = 0;
  private currentDragY = 0;
  private closeTimer?: ReturnType<typeof setTimeout>;

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
      if (open) {
        this.openDialog();
      } else {
        this.closeDialog();
      }
    });
  }

  ngOnInit(): void {
    this.collectionService.getHomeRegions().subscribe({
      next: (regions) => this.homeRegions.set(regions),
      error: () => {},
    });
  }

  ngAfterViewInit(): void {
    if (this.modalService.isOpen()) {
      this.openDialog();
    }
  }

  ngOnDestroy(): void {
    if (this.closeTimer) clearTimeout(this.closeTimer);
  }

  private openDialog(): void {
    const dialog = this.dialogEl?.nativeElement;
    if (!dialog) return;

    this.loadProfileData();

    if (!dialog.open) {
      this.isEntering.set(true);
      this.isClosing.set(false);
      this.effectiveTransformY.set(null);
      this.statusMessage.set(null);
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
      setTimeout(() => this.isEntering.set(false), 300);
    }
  }

  private closeDialog(): void {
    const dialog = this.dialogEl?.nativeElement;
    if (dialog && dialog.open && !this.isClosing()) {
      if (typeof dialog.close === 'function') {
        dialog.close();
      } else {
        dialog.removeAttribute('open');
      }
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
    if (this.isClosing()) return;
    this.isClosing.set(true);

    this.closeTimer = setTimeout(() => {
      this.isClosing.set(false);
      const dialog = this.dialogEl?.nativeElement;
      if (dialog && dialog.open) {
        if (typeof dialog.close === 'function') {
          dialog.close();
        } else {
          dialog.removeAttribute('open');
        }
      }
      this.modalService.close();
    }, 220);
  }

  public onDialogClick(event: MouseEvent): void {
    const dialog = this.dialogEl?.nativeElement;
    if (dialog && event.target === dialog) {
      this.requestClose();
    }
  }

  public onDialogCancel(event: Event): void {
    event.preventDefault();
    this.requestClose();
  }

  public onTouchStart(event: TouchEvent): void {
    this.dragStartY = event.touches[0].clientY;
    this.currentDragY = this.dragStartY;
    this.isDraggingSheet.set(true);
  }

  public onTouchMove(event: TouchEvent): void {
    if (!this.isDraggingSheet()) return;
    this.currentDragY = event.touches[0].clientY;
    const deltaY = this.currentDragY - this.dragStartY;
    if (deltaY > 0) {
      this.effectiveTransformY.set(deltaY);
    }
  }

  public onTouchEnd(): void {
    if (!this.isDraggingSheet()) return;
    this.isDraggingSheet.set(false);
    const deltaY = this.currentDragY - this.dragStartY;
    if (deltaY > 100) {
      this.requestClose();
    } else {
      this.effectiveTransformY.set(null);
    }
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
    if (typeof window !== 'undefined') {
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = '/api/auth/logout';
      document.body.appendChild(form);
      form.submit();
    }
  }
}
