import { ApplicationConfig, APP_INITIALIZER } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(
      routes, 
      withComponentInputBinding(),
      withInMemoryScrolling({
        scrollPositionRestoration: 'disabled',
        anchorScrolling: 'enabled'
      })
    ), 
    provideHttpClient(),
    {
      provide: APP_INITIALIZER,
      useValue: () => {
        if ('scrollRestoration' in history) {
          history.scrollRestoration = 'manual';
        }
      },
      multi: true
    }
  ]
};
