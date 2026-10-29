import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { CollectionService } from '../../core/services/collection.service';
import { IconComponent } from '../../shared/components/icon/icon.component';

@Component({
  selector: 'app-landing-page',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent],
  template: `
    <div class="landing-container">
      <div class="hero-section">
        <div class="brand-badge">
          <app-icon name="gamepad" [size]="20" />
          <span>Physical & Digital Video Game Archive</span>
        </div>

        <h1 class="hero-title">
          Curate, Track, and Preserve Your
          <span class="gradient-text">Video Game Collection</span>
        </h1>

        <p class="hero-subtitle">
          A high-performance personal collection tracker and release
          verification ledger. Catalog physical carts, optical discs, revisions,
          and valuations with zero bloat.
        </p>

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
          </div>
        }

        <div class="cta-actions">
          <a
            href="/api/auth/login"
            class="btn btn-primary btn-lg"
            data-testid="landing-btn-login"
          >
            <app-icon name="user" [size]="18" />
            <span>Sign In with Cloudflare</span>
          </a>

          <a
            routerLink="/collection/games"
            class="btn btn-secondary btn-lg"
            data-testid="landing-btn-browse"
          >
            <app-icon name="compass" [size]="18" />
            <span>Browse Catalog</span>
          </a>
        </div>
      </div>

      <div class="features-grid">
        <div class="feature-card">
          <div class="feature-icon">
            <app-icon name="verified-badge" [size]="24" />
          </div>
          <h3>Verified Physical Releases</h3>
          <p>
            Cross-referenced with Redump, No-Intro, and Nintendo Revised
            databases to accurately verify physical cart and disc media.
          </p>
        </div>

        <div class="feature-card">
          <div class="feature-icon">
            <app-icon name="coins" [size]="24" />
          </div>
          <h3>Valuation & Deal Sync</h3>
          <p>
            Rolling pricing data from GAMEYE and PriceCharting alongside
            automated boutique retail deals and pre-orders.
          </p>
        </div>

        <div class="feature-card">
          <div class="feature-icon">
            <app-icon name="lock" [size]="24" />
          </div>
          <h3>Private Provenance</h3>
          <p>
            Personal acquisition ledgers, purchase receipts, and condition notes
            remain completely private and isolated per user.
          </p>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .landing-container {
        max-width: 1080px;
        margin: 0 auto;
        padding: 4rem 1.5rem 6rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4rem;
      }

      .hero-section {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        max-width: 760px;
        gap: 1.5rem;
      }

      .brand-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.4rem 1rem;
        border-radius: 9999px;
        background: rgba(147, 51, 234, 0.15);
        border: 1px solid rgba(147, 51, 234, 0.3);
        color: #c084fc;
        font-size: 0.875rem;
        font-weight: 500;
      }

      .hero-title {
        font-size: 2.75rem;
        line-height: 1.15;
        font-weight: 800;
        letter-spacing: -0.02em;
        color: #f8fafc;
        margin: 0;
      }

      .gradient-text {
        background: linear-gradient(
          135deg,
          #a855f7 0%,
          #ec4899 50%,
          #3b82f6 100%
        );
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        display: inline-block;
      }

      .hero-subtitle {
        font-size: 1.125rem;
        line-height: 1.6;
        color: #94a3b8;
        margin: 0;
      }

      .cta-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        justify-content: center;
        margin-top: 1rem;
      }

      .btn {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        font-weight: 600;
        border-radius: 0.75rem;
        transition: all 0.2s ease;
        text-decoration: none;
        cursor: pointer;
      }

      .btn-lg {
        padding: 0.85rem 1.75rem;
        font-size: 1rem;
      }

      .btn-primary {
        background: #9333ea;
        color: #ffffff;
        box-shadow: 0 4px 20px rgba(147, 51, 234, 0.4);
        border: 1px solid rgba(255, 255, 255, 0.15);
      }

      .btn-primary:hover {
        background: #a855f7;
        box-shadow: 0 6px 24px rgba(147, 51, 234, 0.55);
        transform: translateY(-1px);
      }

      .btn-secondary {
        background: #1e1b4b;
        color: #e2e8f0;
        border: 1px solid rgba(147, 51, 234, 0.3);
      }

      .btn-secondary:hover {
        background: #2e1065;
        border-color: rgba(147, 51, 234, 0.5);
        color: #ffffff;
      }

      .alert-box {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        padding: 1rem 1.25rem;
        border-radius: 0.75rem;
        text-align: left;
        width: 100%;
        margin-top: 0.5rem;
      }

      .alert-warning {
        background: rgba(234, 179, 8, 0.12);
        border: 1px solid rgba(234, 179, 8, 0.35);
        color: #fef08a;
      }

      .alert-content p {
        margin: 0.25rem 0 0;
        font-size: 0.875rem;
        color: #cbd5e1;
      }

      .features-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 1.5rem;
        width: 100%;
      }

      .feature-card {
        background: rgba(15, 23, 42, 0.6);
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 1rem;
        padding: 1.75rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .feature-icon {
        width: 48px;
        height: 48px;
        border-radius: 0.75rem;
        background: rgba(147, 51, 234, 0.2);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #c084fc;
      }

      .feature-card h3 {
        margin: 0;
        font-size: 1.2rem;
        font-weight: 700;
        color: #f1f5f9;
      }

      .feature-card p {
        margin: 0;
        font-size: 0.925rem;
        line-height: 1.5;
        color: #94a3b8;
      }

      @media (max-width: 640px) {
        .hero-title {
          font-size: 2rem;
        }
        .landing-container {
          padding: 2.5rem 1rem 4rem;
          gap: 3rem;
        }
      }
    `,
  ],
})
export class LandingPageComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private collectionService = inject(CollectionService);

  public readonly accountMissing = signal<boolean>(false);

  ngOnInit(): void {
    const qp = this.route.snapshot.queryParams;
    if (qp['account'] === 'missing') {
      this.accountMissing.set(true);
    }
  }
}
