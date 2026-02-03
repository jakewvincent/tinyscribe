import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use jsdom for tests that need DOM APIs
    environment: 'node',
    // Include test files
    include: ['tests/**/*.test.js'],
    // Coverage configuration (optional, run with --coverage)
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.js'],
    },
  },
});
