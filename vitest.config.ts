import { defineConfig } from 'vitest/config';
import angular from '@analogjs/vite-plugin-angular';

export default defineConfig({
  plugins: [angular()],
  test: {
    globals: true,
    css: true,
    setupFiles: ['src/test-setup.ts'],
    environment: 'jsdom',
  },
});
