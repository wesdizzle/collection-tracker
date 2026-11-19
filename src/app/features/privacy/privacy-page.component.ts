import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { BrandingService } from '../../core/services/branding.service';
import { IconComponent } from '../../shared/components/icon/icon.component';

@Component({
  selector: 'app-privacy-page',
  standalone: true,
  imports: [RouterModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="privacy-shell">
      <article class="privacy-card">
        <header class="privacy-header">
          <div class="privacy-eyebrow">
            <app-icon name="lock" [size]="16" />
            <span>Privacy &amp; Data Handling Notice</span>
          </div>
          <h1 class="privacy-title">{{ branding.appName() }} Privacy Notice</h1>
          <p class="privacy-subtitle">
            Self-hosted physical game and collectible catalog manager.
          </p>
        </header>

        <section class="privacy-section">
          <h2>1. Zero Third-Party Tracking &amp; Advertising</h2>
          <p>
            {{ branding.appName() }} does not run third-party advertising
            networks, behavioral trackers, or analytics scripts. No personal
            information is sold or shared with third parties.
          </p>
        </section>

        <section class="privacy-section">
          <h2>2. Authentication &amp; Collection Storage</h2>
          <p>
            User sessions are authenticated via private OpenID Connect (OIDC)
            using stateless, cryptographically signed <code>HttpOnly</code>
            session cookies. User-owned library records, private acquisition
            journal entries, and notification preferences are stored in private
            Cloudflare D1 and R2 storage.
          </p>
        </section>

        <section class="privacy-section">
          <h2>3. Live eBay Market Valuation Compliance</h2>
          <p>
            When authorized administrators request market replacement-value
            estimates, {{ branding.appName() }} queries the official eBay Browse
            API for currently active listings in real time. In strict adherence
            to the eBay API License Agreement:
          </p>
          <ul>
            <li>
              <strong>No Permanent Storage of eBay Data:</strong> Listing data
              returned by eBay is never persisted in relational database tables
              or backup snapshots.
            </li>
            <li>
              <strong>Maximum 6-Hour Ephemeral Cache:</strong> Aggregated price
              estimates are cached ephemerally across edge cache, ephemeral R2
              shards, and browser IndexedDB for no longer than 6 hours, after
              which expired records are automatically purged and never
              displayed.
            </li>
            <li>
              <strong>No Seller PII Collected:</strong> Only item condition,
              listing title, landed price, and a direct link back to the live
              eBay listing are surfaced.
            </li>
          </ul>
        </section>

        <footer class="privacy-footer">
          <a routerLink="/" class="back-btn">
            Back to {{ branding.appName() }}
          </a>
        </footer>
      </article>
    </main>
  `,
  styles: [
    `
      .privacy-shell {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-32, 2rem) var(--spacing-16, 1rem);
        background: var(--m3-surface, #111318);
        color: var(--m3-on-surface, #e2e2e9);
      }

      .privacy-card {
        width: 100%;
        max-width: 720px;
        background: var(--m3-surface-container, #1d2024);
        border: 1px solid var(--m3-outline-variant, #44474e);
        border-radius: var(--radius-lg, 16px);
        padding: var(--spacing-32, 2rem);
        box-sizing: border-box;
      }

      .privacy-header {
        margin-bottom: var(--spacing-24, 1.5rem);
        padding-bottom: var(--spacing-16, 1rem);
        border-bottom: 1px solid var(--m3-outline-variant, #44474e);
      }

      .privacy-eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.78rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--m3-primary, #adc6ff);
        margin-bottom: 0.5rem;
      }

      .privacy-title {
        margin: 0 0 0.35rem 0;
        font-size: 1.75rem;
        font-weight: 700;
        color: var(--m3-on-surface, #e2e2e9);
      }

      .privacy-subtitle {
        margin: 0;
        color: var(--m3-on-surface-variant, #c4c6d0);
        font-size: 0.95rem;
      }

      .privacy-section {
        margin-bottom: var(--spacing-24, 1.5rem);
      }

      .privacy-section h2 {
        font-size: 1.05rem;
        font-weight: 600;
        margin: 0 0 0.5rem 0;
        color: var(--m3-on-surface, #e2e2e9);
      }

      .privacy-section p,
      .privacy-section li {
        font-size: 0.92rem;
        line-height: 1.6;
        color: var(--m3-on-surface-variant, #c4c6d0);
      }

      .privacy-section ul {
        margin: 0.5rem 0 0 1.25rem;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
      }

      .privacy-footer {
        padding-top: var(--spacing-16, 1rem);
        border-top: 1px solid var(--m3-outline-variant, #44474e);
        display: flex;
        justify-content: flex-end;
      }

      .back-btn {
        display: inline-flex;
        align-items: center;
        padding: 0.6rem 1.25rem;
        border-radius: var(--radius-full, 9999px);
        background: var(--m3-primary-container, #284777);
        color: var(--m3-on-primary-container, #d8e2ff);
        font-weight: 600;
        font-size: 0.875rem;
        text-decoration: none;
      }

      .back-btn:hover {
        filter: brightness(1.08);
      }
    `,
  ],
})
export class PrivacyPageComponent {
  public readonly branding = inject(BrandingService);
}
