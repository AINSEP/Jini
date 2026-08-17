import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/deploy/**'],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        statements: 99.7,
        branches: 95.9,
        functions: 100,
        lines: 99.7,
      },
    },
  },
});
