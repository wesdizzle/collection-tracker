import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'collection/games', pathMatch: 'full' },
  { 
    path: 'collection',
    loadComponent: () => import('./features/collection/layout/collection-layout/collection-layout.component').then(m => m.CollectionLayoutComponent),
    children: [
      { path: '', redirectTo: 'games', pathMatch: 'full' },
      { 
        path: 'games', 
        title: 'Games',
        loadComponent: () => import('./features/collection/list/collection-list/collection-list.component').then(m => m.CollectionListComponent)
      },
      { 
        path: 'toys', 
        title: 'Toys',
        loadComponent: () => import('./features/collection/list/collection-list/collection-list.component').then(m => m.CollectionListComponent)
      },
      {
        path: 'discovery',
        title: 'Discovery Management',
        loadComponent: () => import('./features/discovery/list/discovery-list/discovery-list.component').then(m => m.DiscoveryListComponent)
      },
      { 
        path: ':type/:id', 
        loadComponent: () => import('./features/collection/detail/item-detail/item-detail.component').then(m => m.ItemDetailComponent) 
      }
    ]
  }
];
