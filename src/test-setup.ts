import '@angular/compiler';
import '@analogjs/vitest-angular/setup-snapshots';
import '@analogjs/vitest-angular/setup-serializers';
import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';

/**
 * ANGULAR 21 ZONELESS TEST INITIALIZATION
 * 
 * Configures the TestBed for Experimental Zoneless mode.
 * Standard fakeAsync/tick and zone-based helpers are bypassed 
 * in favor of modern high-performance reactive testing patterns.
 */
setupTestBed({
  zoneless: true,
});

// Polyfill/Mock IntersectionObserver for JSDOM environment
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class IntersectionObserver {
    constructor() {}
    observe() { return null; }
    unobserve() { return null; }
    disconnect() { return null; }
  } as any;
}
