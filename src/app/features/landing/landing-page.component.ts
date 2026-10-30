import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { CollectionService } from '../../core/services/collection.service';
import { BrandingService } from '../../core/services/branding.service';
import { IconComponent } from '../../shared/components/icon/icon.component';

@Component({
  selector: 'app-landing-page',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent],
  template: `
    <div class="landing-container">
      <div class="welcome-card">
        <img
          [src]="branding.logoUrl()"
          [alt]="branding.appName() + ' Icon'"
          class="brand-logo"
        />

        <h1 class="brand-title">{{ branding.appName() }}</h1>

        @if (accountMissing()) {
          <div
            class="alert-box alert-warning"
            data-testid="account-missing-banner"
          >
            <app-icon name="alert-triangle" [size]="20" />
            <div class="alert-content">
              <strong>Account Pending Provisioning</strong>
              <p>
                Your Cloudflare Access identity was verified, but your email
                address has not been added to the allowlist yet. This instance
                is currently invite-only.
              </p>
            </div>
            <button
              type="button"
              class="alert-close-btn"
              (click)="dismissAlert()"
              aria-label="Dismiss banner"
            >
              <app-icon name="close" [size]="16" />
            </button>
          </div>
        }

        <div class="cta-actions">
          <a
            href="/admin/login"
            class="btn btn-primary btn-lg"
            data-testid="landing-btn-login"
          >
            <app-icon name="user" [size]="18" />
            <span>Sign In</span>
          </a>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .landing-container {
        min-height: calc(100vh - 120px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-32) var(--spacing-16);
      }

      .welcome-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        max-width: 440px;
        width: 100%;
        padding: var(--spacing-40) var(--spacing-32);
        background: var(--m3-surface-variant);
        border: 1px solid var(--m3-outline-variant);
        border-radius: var(--radius-md);
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);
        gap: var(--spacing-20);
      }

      .brand-logo {
        width: 64px;
        height: 64px;
        object-fit: contain;
      }

      .brand-title {
        font-family: var(--font-heading);
        font-size: 1.75rem;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: var(--m3-on-surface);
        margin: 0;
      }

      .cta-actions {
        display: flex;
        justify-content: center;
        width: 100%;
        margin-top: var(--spacing-8);
      }

      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-8);
        font-family: var(--font-body);
        font-weight: 600;
        border-radius: var(--radius-full);
        transition: all 0.2s ease;
        text-decoration: none;
        cursor: pointer;
        border: none;
      }

      .btn-lg {
        padding: var(--spacing-12) var(--spacing-32);
        font-size: 1rem;
      }

      .btn-primary {
        background: var(--m3-primary);
        color: var(--m3-on-primary);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      }

      .btn-primary:hover {
        opacity: 0.92;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      }

      .alert-box {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        padding: 1rem 1.25rem;
        border-radius: var(--radius-xs);
        text-align: left;
        width: 100%;
      }

      .alert-warning {
        background: rgba(234, 179, 8, 0.12);
        border: 1px solid rgba(234, 179, 8, 0.35);
        color: #fef08a;
      }

      .alert-content strong {
        display: block;
        font-size: 0.875rem;
        font-weight: 600;
      }

      .alert-content p {
        margin: 0.25rem 0 0;
        font-size: 0.8125rem;
        color: var(--m3-on-surface-variant);
        line-height: 1.4;
      }

      .alert-close-btn {
        margin-left: auto;
        background: transparent;
        border: none;
        color: var(--m3-on-surface-variant);
        cursor: pointer;
        padding: 0.25rem;
        border-radius: var(--radius-tag);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .alert-close-btn:hover {
        color: var(--m3-on-surface);
        background: rgba(255, 255, 255, 0.08);
      }
    `,
  ],
})
export class LandingPageComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  public readonly collectionService = inject(CollectionService);
  public readonly branding = inject(BrandingService);

  public readonly accountMissing = signal<boolean>(false);

  ngOnInit(): void {
    const qp = this.route.snapshot.queryParams;
    if (qp['account'] === 'missing') {
      this.accountMissing.set(true);
    }
    if (this.collectionService.currentUser()) {
      this.router.navigate(['/collection/games'], { replaceUrl: true });
    }
  }

  public dismissAlert(): void {
    this.accountMissing.set(false);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { account: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
