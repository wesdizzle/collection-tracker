import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 15000,
    include: [
      'shared/**/*.spec.ts',
      'worker/**/*.spec.ts',
      'scripts/**/*.spec.ts',
    ],
  },
});
