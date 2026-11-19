import { Routes, Router } from '@angular/router';
import { inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthSessionService } from './core/services/auth-session.service';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    canActivate: [
      async () => {
        const auth = inject(AuthSessionService);
        auth.exitPublicView();
        const router = inject(Router);
        const user = await auth.ensureAuthLoaded();
        if (user) {
          return router.createUrlTree(['/collection/games']);
        }
        return true;
      },
    ],
    loadComponent: () =>
      import('./features/landing/landing-page.component').then(
        (m) => m.LandingPageComponent,
      ),
  },
  {
    path: 'privacy',
    title: 'Privacy Notice',
    loadComponent: () =>
      import('./features/privacy/privacy-page.component').then(
        (m) => m.PrivacyPageComponent,
      ),
  },
  {
    path: 'profile',
    redirectTo: '/collection/games',
    pathMatch: 'full',
  },
  {
    path: 'item/:id',
    redirectTo: '/game/:id',
    pathMatch: 'full',
  },
  {
    path: 'collection/:type/:id',
    redirectTo: '/:type/:id',
    pathMatch: 'full',
  },
  {
    path: 'u/:username/:type/:id',
    redirectTo: '/:type/:id',
    pathMatch: 'full',
  },
  {
    path: '',
    loadComponent: () =>
      import('./features/collection/layout/collection-layout/collection-layout.component').then(
        (m) => m.CollectionLayoutComponent,
      ),
    children: [
      {
        path: 'u/:username',
        canActivate: [
          async (route) => {
            const auth = inject(AuthSessionService);
            const username = route.paramMap.get('username');
            if (!username) return false;
            try {
              const profile = await firstValueFrom(
                auth.getPublicUser(username),
              );
              auth.setPublicView(true, profile);
              return true;
            } catch {
              return inject(Router).createUrlTree(['/']);
            }
          },
        ],
        children: [
          { path: '', redirectTo: 'games', pathMatch: 'full' },
          {
            path: 'games',
            title: 'Collection',
            loadComponent: () =>
              import('./features/collection/list/collection-list/collection-list.component').then(
                (m) => m.CollectionListComponent,
              ),
          },
          {
            path: 'toys',
            title: 'Toys',
            loadComponent: () =>
              import('./features/collection/list/collection-list/collection-list.component').then(
                (m) => m.CollectionListComponent,
              ),
          },
          {
            path: 'stats',
            title: 'Stats',
            loadComponent: () =>
              import('./features/collection/insights/collection-insights.component').then(
                (m) => m.CollectionInsightsComponent,
              ),
          },
        ],
      },
      {
        path: 'collection',
        canActivate: [
          async () => {
            const auth = inject(AuthSessionService);
            auth.exitPublicView();
            const router = inject(Router);
            const user = await auth.ensureAuthLoaded();
            if (!user) {
              if (auth.isAutoSigningIn()) {
                return false;
              }
              return router.createUrlTree(['/']);
            }
            return true;
          },
        ],
        children: [
          { path: '', redirectTo: 'games', pathMatch: 'full' },
          {
            path: 'games',
            title: 'Games',
            loadComponent: () =>
              import('./features/collection/list/collection-list/collection-list.component').then(
                (m) => m.CollectionListComponent,
              ),
          },
          {
            path: 'toys',
            title: 'Toys',
            loadComponent: () =>
              import('./features/collection/list/collection-list/collection-list.component').then(
                (m) => m.CollectionListComponent,
              ),
          },
          {
            path: 'discovery',
            redirectTo: '/admin',
            pathMatch: 'full',
          },
          {
            path: 'insights',
            title: 'Collection Insights',
            loadComponent: () =>
              import('./features/collection/insights/collection-insights.component').then(
                (m) => m.CollectionInsightsComponent,
              ),
          },
          {
            path: 'backups',
            title: 'Scan Local Backups',
            loadComponent: () =>
              import('./features/collection/backups/backup-scanner.component').then(
                (m) => m.BackupScannerComponent,
              ),
          },
        ],
      },
      {
        path: 'admin',
        title: 'Admin Center',
        canActivate: [
          async () => {
            const auth = inject(AuthSessionService);
            auth.exitPublicView();
            const router = inject(Router);
            await auth.ensureAuthLoaded();
            if (!auth.isAdmin()) {
              return router.createUrlTree(['/collection/games']);
            }
            return true;
          },
        ],
        loadComponent: () =>
          import('./features/admin/admin-center.component').then(
            (m) => m.AdminCenterComponent,
          ),
      },
      {
        path: 'discovery',
        redirectTo: '/admin',
        pathMatch: 'full',
      },
      {
        path: ':type/:id',
        canActivate: [
          async (route) => {
            const type = route.paramMap.get('type');
            if (type !== 'game' && type !== 'toy') {
              return inject(Router).createUrlTree(['/']);
            }
            await inject(AuthSessionService).ensureAuthLoaded();
            return true;
          },
        ],
        loadComponent: () =>
          import('./features/collection/detail/item-detail/item-detail.component').then(
            (m) => m.ItemDetailComponent,
          ),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
