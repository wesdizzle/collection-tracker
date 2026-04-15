import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Only include worker-specific tests for Vitest. 
    // Angular component tests are handled separately via Karma.
    include: ['worker/worker.spec.ts'],
  },
});
