import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'shared/**/*.spec.ts',
      'worker/**/*.spec.ts',
      'scripts/**/*.spec.ts',
    ],
  },
});
