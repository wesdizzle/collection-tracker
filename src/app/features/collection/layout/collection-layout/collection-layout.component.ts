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
  NavigationEnd,
  Router,
  RouterModule,
  RouteReuseStrategy,
} from '@angular/router';
import { filter } from 'rxjs';
import {
  KitHeaderBarComponent,
  KitHeaderTab,
  KitPublicBannerComponent,
  KitThemeService,
} from '@wesdizzle/app-kit/angular';
import { CollectionRouteReuseStrategy } from '../../../../core/routing/collection-route-reuse-strategy';
import { CollectionService } from '../../../../core/services/collection.service';
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
          <svg viewBox="0 0 24 24" class="github-icon" aria-hidden="true">
            <path
              d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
            />
          </svg>
        </a>
      }
    </kit-header-bar>

    <div class="layout-container">
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

      .github-icon {
        width: 20px;
        height: 20px;
        fill: currentColor;
      }

      .content-area {
        flex: 1;
        width: 100%;
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
        }
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

  public readonly activeTab = computed<string>(() => {
    const cleanUrl = this.currentUrl().split('?')[0].split('#')[0];
    if (cleanUrl.endsWith('/toys') || cleanUrl.startsWith('/toy/')) {
      return 'toys';
    }
    if (cleanUrl.startsWith('/collection/insights')) {
      return 'insights';
    }
    if (cleanUrl.startsWith('/collection/discovery')) {
      return 'discovery';
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
      if (this.isAdmin()) {
        tabs.push({
          id: 'discovery',
          label: 'Discovery',
          href: '/collection/discovery',
        });
      }
    }
    return tabs;
  });

  constructor() {
    this.themeService.init('collection-theme', ['app-theme', 'theme'], 'auto', {
      darkThemeColor: '#121214',
      lightThemeColor: '#f8fafc',
    });

    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((e) => {
        this.currentUrl.set(e.urlAfterRedirects || e.url);
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
      void this.router.navigateByUrl(this.collectionService.getTabUrl('games'));
    }
  }

  onTabSelected(tabId: string) {
    if (tabId === 'games' || tabId === 'toys') {
      this.onNavClick(tabId);
      void this.router.navigateByUrl(this.collectionService.getTabUrl(tabId));
    } else if (tabId === 'insights' || tabId === 'discovery') {
      this.onNavClick();
      void this.router.navigateByUrl(`/collection/${tabId}`);
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

  private applyTheme(mode: 'light' | 'dark' | 'auto') {
    this.themeService.applyTheme(mode);
  }
}
