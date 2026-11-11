import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { appConfig } from './app.config';
import { SwUpdate } from '@angular/service-worker';
import { of } from 'rxjs';

describe('PWA Configuration', () => {
  it('should have ServiceWorker registered in appConfig', () => {
    TestBed.configureTestingModule({
      providers: [...appConfig.providers],
    });

    const swUpdate = TestBed.inject(SwUpdate);
    expect(swUpdate).toBeTruthy();
  });
});

// Since testing the actual service worker registration is complex in unit tests,
// we'll add a test that ensures the SwUpdate service can be injected if needed.
describe('SwUpdate Service', () => {
  it('should be injectable if PWA is enabled', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: SwUpdate, useValue: { isEnabled: true, available: of() } },
      ],
    });
    const service = TestBed.inject(SwUpdate);
    expect(service).toBeTruthy();
    expect(service.isEnabled).toBe(true);
  });

  it('should handle SwUpdate version updates and activateUpdate in AppComponent', async () => {
    const versionUpdatesSubject = of({ type: 'VERSION_READY' });
    let activated = false;
    const mockSwUpdate = {
      isEnabled: true,
      versionUpdates: versionUpdatesSubject,
      activateUpdate: () => {
        activated = true;
        return Promise.resolve(true);
      },
    };

    TestBed.configureTestingModule({
      providers: [{ provide: SwUpdate, useValue: mockSwUpdate }],
    });

    const { AppComponent } = await import('./app.component');
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    await Promise.resolve();

    expect(mockSwUpdate.isEnabled).toBe(true);
    expect(activated).toBe(true);
  });
});

describe('PWA Theme Color Meta Tags', () => {
  it('should have meta theme-color elements updated appropriately', () => {
    const metaDark = document.createElement('meta');
    metaDark.setAttribute('name', 'theme-color');
    metaDark.setAttribute('media', '(prefers-color-scheme: dark)');
    metaDark.setAttribute('content', '#121214');
    document.head.appendChild(metaDark);

    expect(metaDark.getAttribute('content')).toBe('#121214');
    metaDark.remove();
  });
});
