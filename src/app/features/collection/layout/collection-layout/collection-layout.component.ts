import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  Router,
  RouterModule,
  RouteReuseStrategy,
} from '@angular/router';
import { filter } from 'rxjs';
import {
  KitDegradedBannerComponent,
  KitHeaderBarComponent,
  KitHeaderTab,
  KitPublicBannerComponent,
  KitThemeService,
} from '@wesdizzle/app-kit/angular';
import { CollectionRouteReuseStrategy } from '../../../../core/routing/collection-route-reuse-strategy';
import { CollectionService } from '../../../../core/services/collection.service';
import { MarketPriceScanProgress } from '../../../../core/models/collection.models';
import { BrandingService } from '../../../../core/services/branding.service';
import { CommandPaletteService } from '../../../../core/services/command-palette.service';
import { ProfileModalService } from '../../../../core/services/profile-modal.service';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { ProfileModalComponent } from '../../../profile/profile-modal.component';

@Component({
  selector: 'app-collection-layout',
  standalone: true,
  imports: [
    RouterModule,
    KitDegradedBannerComponent,
    KitHeaderBarComponent,
    KitPublicBannerComponent,
    IconComponent,
    ProfileModalComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <kit-header-bar
      [appName]="branding.appName()"
      [logoUrl]="branding.logoUrl()"
      [brandHref]="collectionService.getTabUrl('games')"
      [tabs]="headerTabs()"
      [activeTab]="activeTab()"
      [theme]="theme()"
      [isAuthenticated]="isAuthenticated()"
      [user]="currentUser()"
      profileTestId="header-user-btn"
      (brandClicked)="onBrandClicked($event)"
      (tabSelected)="onTabSelected($event)"
      (profileClicked)="onUserIconClick()"
      (themeToggled)="toggleTheme()"
    >
      <button
        kitHeaderActions
        type="button"
        (click)="commandPalette.open()"
        class="m3-button-icon state-layer"
        title="Search & Command Palette (Ctrl+K)"
        aria-label="Open command palette"
      >
        <app-icon name="search" [size]="18" />
      </button>

      @if (branding.repoUrl(); as repoUrl) {
        <a
          headerRightEnd
          [href]="repoUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="github-btn m3-button-icon state-layer"
          title="GitHub"
          aria-label="GitHub repository"
        >
          <app-icon name="github" [size]="18" />
        </a>
      }
    </kit-header-bar>

    <div class="layout-container">
      <kit-degraded-banner
        [mode]="collectionService.degradedMode()"
        [snapshotTimestamp]="collectionService.degradedTimestamp()"
      />

      @if (activeValuationScan(); as scan) {
        <div
          class="global-valuation-banner"
          role="status"
          aria-live="polite"
          data-testid="global-valuation-scan-banner"
        >
          <div class="global-val-info">
            <span class="global-val-icon">
              <app-icon name="coins" [size]="16" />
            </span>
            <span class="global-val-text">
              {{
                scan.statusMessage ||
                  'Scanning live eBay prices (' +
                    (scan.scopeLabel || 'Collection') +
                    ')...'
              }}
            </span>
            <strong class="global-val-count">
              {{ scan.completedItems }} / {{ scan.totalItems }} ({{
                valuationScanPct()
              }}%)
            </strong>
            @if (scan.wakeLockActive) {
              <span class="global-val-wake">
                <app-icon name="eye" [size]="12" /> Awake
              </span>
            }
          </div>
          <div class="global-val-progress-track">
            <div
              class="global-val-progress-fill"
              [style.width.%]="valuationScanPct()"
            ></div>
          </div>
          <div class="global-val-actions">
            <a
              [routerLink]="['/collection/insights']"
              [queryParams]="{ tab: 'value' }"
              class="global-val-link"
              data-testid="global-valuation-open-link"
            >
              View Ledger
            </a>
            <button
              type="button"
              class="global-val-cancel"
              (click)="onCancelGlobalValuationScan()"
              data-testid="global-valuation-cancel-btn"
            >
              Cancel
            </button>
          </div>
        </div>
      }

      @if (isPublicView() && publicProfile(); as pub) {
        <kit-public-banner
          data-testid="public-collection-banner"
          title="Viewing {{ pub.displayName || pub.username }}'s library"
          [username]="pub.username"
          [bio]="pub.bio"
          [showBackLink]="true"
          backHref="/collection/games"
          backLabel="← My Collection"
          [interceptBackClick]="true"
          (backClicked)="onExitPublicView()"
        />
      }

      <main class="content-area animate-expressive">
        <router-outlet></router-outlet>
      </main>

      <footer class="main-footer">
        <div class="footer-divider"></div>
        <p class="footer-copy">{{ branding.appName() }} &copy; 2026</p>
      </footer>
    </div>

    @if (profileModalService.isOpen()) {
      <app-profile-modal />
    }
  `,
  styles: [
    `
      .layout-container {
        max-width: 1400px;
        margin: 0 auto;
        padding: var(--spacing-32) var(--container-padding) 0;
        min-height: calc(100vh - var(--header-height));
        display: flex;
        flex-direction: column;
      }

      .content-area {
        flex: 1;
        width: 100%;
        min-width: 0;
      }

      .main-footer {
        margin-top: var(--spacing-64);
        padding: var(--spacing-32) 0;
        text-align: center;
      }

      .footer-divider {
        height: 1px;
        background: var(--m3-outline-variant);
        margin-bottom: var(--spacing-24);
      }

      .footer-copy {
        color: var(--m3-on-surface-variant);
        font-size: 0.875rem;
      }

      @media (max-width: 768px) {
        .layout-container {
          padding-top: var(--spacing-24);
          padding-bottom: calc(80px + env(safe-area-inset-bottom, 0px));
        }
      }

      .global-valuation-banner {
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
        margin-bottom: var(--spacing-16);
        padding: 0.65rem 0.9rem;
        border-radius: var(--radius-sm, 12px);
        background: var(--m3-surface-container);
        border: 1px solid var(--m3-outline-variant);
      }

      .global-val-info {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.45rem;
        font-size: 0.82rem;
        color: var(--m3-on-surface);
      }

      .global-val-icon {
        display: inline-flex;
        color: var(--m3-primary);
      }

      .global-val-text {
        flex: 1 1 200px;
        min-width: 0;
      }

      .global-val-count {
        font-feature-settings: 'tnum' on;
      }

      .global-val-wake {
        display: inline-flex;
        align-items: center;
        gap: 0.2rem;
        font-size: 0.72rem;
        font-weight: 600;
        color: var(--m3-primary);
      }

      .global-val-progress-track {
        height: 6px;
        border-radius: var(--radius-full, 999px);
        background: var(--m3-surface-container-highest);
        overflow: hidden;
      }

      .global-val-progress-fill {
        height: 100%;
        background: var(--m3-primary);
        transition: width 0.2s ease;
      }

      .global-val-actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 0.65rem;
      }

      .global-val-link {
        font-size: 0.78rem;
        font-weight: 600;
        color: var(--m3-primary);
        text-decoration: none;
      }

      .global-val-link:hover {
        text-decoration: underline;
      }

      .global-val-cancel {
        border: 1px solid var(--kit-danger-border, rgba(248, 113, 113, 0.4));
        background: var(--kit-danger-subtle, rgba(239, 68, 68, 0.12));
        color: var(--kit-danger, #f87171);
        border-radius: var(--radius-full, 999px);
        padding: 0.2rem 0.65rem;
        font-family: var(--font-body);
        font-size: 0.75rem;
        font-weight: 600;
        cursor: pointer;
      }
    `,
  ],
})
export class CollectionLayoutComponent {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);
  private themeService = inject(KitThemeService);
  public readonly collectionService = inject(CollectionService);
  private routeReuseStrategy = inject(RouteReuseStrategy, { optional: true });
  public readonly commandPalette = inject(CommandPaletteService);
  public readonly profileModalService = inject(ProfileModalService);
  public readonly branding = inject(BrandingService);

  public readonly theme = this.themeService.theme;
  public readonly isAdmin = this.collectionService.isAdmin;
  public readonly isAuthenticated = this.collectionService.isAuthenticated;
  public readonly currentUser = this.collectionService.currentUser;
  public readonly isPublicView = this.collectionService.isPublicView;
  public readonly publicProfile = this.collectionService.publicProfile;

  private readonly currentUrl = signal<string>(this.router.url || '');

  public readonly isOnInsightsValueTab = computed<boolean>(() => {
    const url = this.currentUrl();
    return url.startsWith('/collection/insights') && url.includes('tab=value');
  });

  public readonly activeValuationScan =
    computed<MarketPriceScanProgress | null>(() => {
      if (this.collectionService.canViewMarketPrices?.() !== true) return null;
      const p = this.collectionService.marketPriceScanProgress?.();
      if (!p || (!p.active && !p.waitingForWake)) return null;
      return this.isOnInsightsValueTab() ? null : p;
    });

  public readonly valuationScanPct = computed<number>(() => {
    const p = this.collectionService.marketPriceScanProgress?.();
    if (!p || !p.totalItems || p.totalItems <= 0) return 0;
    return Math.min(100, Math.round((p.completedItems / p.totalItems) * 100));
  });

  public readonly activeTab = computed<string>(() => {
    const cleanUrl = this.currentUrl().split('?')[0].split('#')[0];
    if (cleanUrl.endsWith('/toys') || cleanUrl.startsWith('/toy/')) {
      return 'toys';
    }
    if (cleanUrl.startsWith('/collection/insights')) {
      return 'insights';
    }
    if (cleanUrl.endsWith('/stats')) {
      return 'stats';
    }
    if (
      cleanUrl.startsWith('/admin') ||
      cleanUrl.startsWith('/discovery') ||
      cleanUrl.startsWith('/collection/discovery')
    ) {
      return 'admin';
    }
    if (
      cleanUrl.endsWith('/games') ||
      cleanUrl.startsWith('/game/') ||
      cleanUrl === '/collection'
    ) {
      return 'games';
    }
    return '';
  });

  public readonly headerTabs = computed<KitHeaderTab[]>(() => {
    const tabs: KitHeaderTab[] = [
      {
        id: 'games',
        label: 'Games',
        href: this.collectionService.getTabUrl('games'),
      },
      {
        id: 'toys',
        label: 'Toys',
        href: this.collectionService.getTabUrl('toys'),
      },
    ];
    if (!this.isPublicView()) {
      tabs.push({
        id: 'insights',
        label: 'Insights',
        href: '/collection/insights',
      });
    } else {
      tabs.push({
        id: 'stats',
        label: 'Stats',
        href: this.collectionService.getTabUrl('stats'),
      });
    }
    return tabs;
  });

  constructor() {
    this.router.events
      .pipe(
        filter(
          (e): e is NavigationEnd | NavigationCancel | NavigationError =>
            e instanceof NavigationEnd ||
            e instanceof NavigationCancel ||
            e instanceof NavigationError,
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((e) => {
        if (e instanceof NavigationEnd) {
          this.currentUrl.set(e.urlAfterRedirects || e.url);
        } else {
          this.currentUrl.set(this.router.url || '');
        }
      });

    if (
      typeof window !== 'undefined' &&
      window.location.search.includes('nonce=')
    ) {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true,
      });
    }
  }

  onBrandClicked(event: MouseEvent) {
    if (
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    ) {
      event.preventDefault();
      this.onNavClick('games');
      const targetUrl = this.collectionService.getTabUrl('games');
      this.currentUrl.set(targetUrl);
      void this.router.navigateByUrl(targetUrl);
    }
  }

  onTabSelected(tabId: string) {
    if (tabId === 'games' || tabId === 'toys') {
      this.onNavClick(tabId);
      const targetUrl = this.collectionService.getTabUrl(tabId);
      this.currentUrl.set(targetUrl);
      void this.router.navigateByUrl(targetUrl);
    } else if (tabId === 'insights') {
      this.onNavClick();
      const targetUrl = `/collection/${tabId}`;
      this.currentUrl.set(targetUrl);
      void this.router.navigateByUrl(targetUrl);
    } else if (tabId === 'stats') {
      this.onNavClick();
      const targetUrl = this.collectionService.getTabUrl('stats');
      this.currentUrl.set(targetUrl);
      void this.router.navigateByUrl(targetUrl);
    } else if (tabId === 'admin') {
      this.onNavClick();
      this.currentUrl.set('/admin');
      void this.router.navigateByUrl('/admin');
    }
  }

  onExitPublicView() {
    this.collectionService.exitPublicView();
    void this.router.navigateByUrl('/collection/games');
  }

  onNavClick(tab?: 'games' | 'toys') {
    if (tab) {
      if (this.routeReuseStrategy instanceof CollectionRouteReuseStrategy) {
        this.routeReuseStrategy.resetScroll(tab);
      }
      this.collectionService.resetTabScroll(tab);
    }
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }
  }

  onUserIconClick() {
    this.profileModalService.open();
  }

  onAdminClick() {
    this.onUserIconClick();
  }

  toggleTheme() {
    this.themeService.toggleTheme();
  }

  onCancelGlobalValuationScan() {
    this.collectionService.cancelCollectionValuationScan?.();
  }

  private applyTheme(mode: 'light' | 'dark' | 'auto') {
    this.themeService.applyTheme(mode);
  }
}
