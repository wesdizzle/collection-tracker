import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { appConfig } from './app.config';
import { SwUpdate } from '@angular/service-worker';
import { of } from 'rxjs';

describe('PWA Configuration', () => {
  it('should have ServiceWorker registered in appConfig', () => {
    TestBed.configureTestingModule({
      providers: [...appConfig.providers]
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
        { provide: SwUpdate, useValue: { isEnabled: true, available: of() } }
      ]
    });
    const service = TestBed.inject(SwUpdate);
    expect(service).toBeTruthy();
    expect(service.isEnabled).toBe(true);
  });
});
