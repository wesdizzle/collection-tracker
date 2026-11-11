import {
  ApplicationConfig,
  isDevMode,
  provideZonelessChangeDetection,
} from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  RouteReuseStrategy,
} from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';
import { KIT_THEME_CONFIG } from '@wesdizzle/app-kit/angular';

import { routes } from './app.routes';
import { CollectionRouteReuseStrategy } from './core/routing/collection-route-reuse-strategy';

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
