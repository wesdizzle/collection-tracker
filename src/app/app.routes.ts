import { Routes, Router } from '@angular/router';
import { inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CollectionService } from './core/services/collection.service';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    canActivate: [
      () => {
        const cs = inject(CollectionService);
        const router = inject(Router);
        if (cs.isAuthenticated()) {
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
    path: 'profile',
    redirectTo: '/collection/games',
    pathMatch: 'full',
  },
  {
    path: 'u/:username',
    loadComponent: () =>
      import('./features/collection/layout/collection-layout/collection-layout.component').then(
        (m) => m.CollectionLayoutComponent,
      ),
    canActivate: [
      async (route) => {
        const cs = inject(CollectionService);
        const username = route.paramMap.get('username');
        if (!username) return false;
        try {
          const profile = await firstValueFrom(cs.getPublicUser(username));
          cs.setPublicView(true, profile);
          return true;
        } catch {
          return inject(Router).createUrlTree(['/']);
        }
      },
    ],
    canDeactivate: [
      () => {
        inject(CollectionService).setPublicView(false, null);
        return true;
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
        path: ':type/:id',
        loadComponent: () =>
          import('./features/collection/detail/item-detail/item-detail.component').then(
            (m) => m.ItemDetailComponent,
          ),
      },
    ],
  },
  {
    path: 'collection',
    loadComponent: () =>
      import('./features/collection/layout/collection-layout/collection-layout.component').then(
        (m) => m.CollectionLayoutComponent,
      ),
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
        title: 'Discovery Management',
        loadComponent: () =>
          import('./features/discovery/list/discovery-list/discovery-list.component').then(
            (m) => m.DiscoveryListComponent,
          ),
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
        path: ':type/:id',
        loadComponent: () =>
          import('./features/collection/detail/item-detail/item-detail.component').then(
            (m) => m.ItemDetailComponent,
          ),
      },
    ],
  },
  {
    path: 'item/:id',
    redirectTo: 'collection/game/:id',
    pathMatch: 'full',
  },
  {
    path: 'cdn-cgi/access/authorized',
    redirectTo: 'collection/games',
    pathMatch: 'full',
  },
  { path: '**', redirectTo: 'collection/games' },
];
