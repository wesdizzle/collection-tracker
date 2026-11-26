import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  KitLandingCardComponent,
  KitThemeService,
} from '@wesdizzle/app-kit/angular';
import { AuthSessionService } from '../../core/services/auth-session.service';
import { BrandingService } from '../../core/services/branding.service';

@Component({
  selector: 'app-landing-page',
  standalone: true,
  imports: [RouterLink, KitLandingCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <kit-landing-card
      [appName]="branding.appName()"
      subtitle="Track physical video games, regional print variants, and interactive figures."
      [logoUrl]="branding.logoUrl()"
      [theme]="themeService.theme()"
      [showThemeToggle]="true"
      [accountMissing]="accountMissing()"
      accountMissingMessage="Your identity was verified, but your collector account has not been provisioned for this instance yet."
      [loading]="authSession.isAutoSigningIn()"
      loginUrl="/api/auth/login"
      (themeToggled)="themeService.toggleTheme()"
    >
      <ul
        landingDetails
        class="landing-details-list"
        data-testid="landing-details"
      >
        <li>
          Catalog games by platform, regional release, print revision, and
          completeness (media, case, manual).
        </li>
        <li>
          Track amiibo, Skylanders, and Starlink figures alongside per-game
          hardware compatibility.
        </li>
        <li>
          Log purchase history, follow upcoming physical releases, and share
          read-only collection links.
        </li>
      </ul>

      <div landingFooter class="landing-footer-links">
        <a routerLink="/privacy" data-testid="landing-privacy-link">Privacy</a>
        @if (branding.repoUrl(); as repoUrl) {
          <span aria-hidden="true">&middot;</span>
          <a
            [href]="repoUrl"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="landing-source-link"
          >
            Source
          </a>
        }
      </div>
    </kit-landing-card>
  `,
  styles: [
    `
      .landing-details-list {
        margin: 0 0 1.5rem;
        padding: 0 0 0 1.15rem;
        text-align: left;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        font-size: 0.875rem;
        line-height: 1.45;
        color: var(--kit-on-surface-variant);
      }

      .landing-footer-links {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        font-size: 0.8125rem;
        color: var(--kit-on-surface-variant);
      }

      .landing-footer-links a {
        color: inherit;
        text-decoration: none;
      }

      .landing-footer-links a:hover {
        color: var(--kit-on-surface);
        text-decoration: underline;
      }
    `,
  ],
})
export class LandingPageComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  public readonly authSession = inject(AuthSessionService);
  public readonly branding = inject(BrandingService);
  public readonly themeService = inject(KitThemeService);

  public readonly accountMissing = signal<boolean>(false);

  ngOnInit(): void {
    const qp = this.route.snapshot.queryParams;
    if (qp['account'] === 'missing') {
      this.accountMissing.set(true);
    }
    if (this.authSession.currentUser()) {
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
