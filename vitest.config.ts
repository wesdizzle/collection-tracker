import { defineConfig } from 'vitest/config';
import angular from '@analogjs/vite-plugin-angular';

/**
 * CONSOLIDATED VITEST CONFIGURATION
 * 
 * Unifies the testing environment to resolve workspace resolution conflicts. 
 * Supports JSDOM environment for Angular 21 Components and verifies 
 * Signals-first reactivity without zone.js.
 */
export default defineConfig({
  plugins: [angular()],
  test: {
    globals: true,
    environment: 'jsdom',
    css: true,
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.spec.ts'],
  },
});
