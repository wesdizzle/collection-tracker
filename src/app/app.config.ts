import {
  ApplicationConfig,
  isDevMode,
  provideZonelessChangeDetection,
} from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withViewTransitions,
  RouteReuseStrategy,
} from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';
import {
  KIT_THEME_CONFIG,
  createKitViewTransitionHandler,
  type KitMediaRadiusMorph,
  type KitRouteSnapshotLike,
} from '@wesdizzle/app-kit/angular';

import { routes } from './app.routes';
import { CollectionRouteReuseStrategy } from './core/routing/collection-route-reuse-strategy';

export const GAME_CARD_MEDIA_RADIUS =
  'calc(var(--radius-card, 16px) - 1px) calc(var(--radius-card, 16px) - 1px) 0 0';
export const GAME_DETAIL_MEDIA_RADIUS = 'var(--radius-lg)';

function isGamesListRoute(snapshot: KitRouteSnapshotLike): boolean {
  return snapshot.routeConfig?.path === 'games';
}

function isGameDetailRoute(snapshot: KitRouteSnapshotLike): boolean {
  return (
    snapshot.routeConfig?.path === ':type/:id' &&
    snapshot.params?.['type'] === 'game'
  );
}

/**
 * Resolves start and end border-radius values for shared-element game cover
 * transitions between collection card grids and game detail pages.
 */
export function resolveCollectionMediaRadius(
  fromLeaf: KitRouteSnapshotLike,
  toLeaf: KitRouteSnapshotLike,
): KitMediaRadiusMorph | null {
  if (isGamesListRoute(fromLeaf) && isGameDetailRoute(toLeaf)) {
    return { from: GAME_CARD_MEDIA_RADIUS, to: GAME_DETAIL_MEDIA_RADIUS };
  }
  if (isGameDetailRoute(fromLeaf) && isGamesListRoute(toLeaf)) {
    return { from: GAME_DETAIL_MEDIA_RADIUS, to: GAME_CARD_MEDIA_RADIUS };
  }
  return null;
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    {
      provide: KIT_THEME_CONFIG,
      useValue: {
        storageKey: 'collection-theme',
        legacyKeys: ['app-theme', 'theme'],
        defaultMode: 'auto',
        darkThemeColor: '#121214',
        lightThemeColor: '#f8fafc',
      },
    },
    provideRouter(
      routes,
      withComponentInputBinding(),
      withViewTransitions({
        skipInitialTransition: true,
        onViewTransitionCreated: createKitViewTransitionHandler({
          resolveMediaRadius: resolveCollectionMediaRadius,
        }),
      }),
      withInMemoryScrolling({
        scrollPositionRestoration: 'disabled',
        anchorScrolling: 'enabled',
      }),
    ),
    {
      provide: RouteReuseStrategy,
      useClass: CollectionRouteReuseStrategy,
    },
    provideHttpClient(),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
