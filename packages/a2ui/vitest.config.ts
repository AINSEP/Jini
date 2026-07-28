import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      // The v8 text table silently drops rows once there are many files —
      // json-summary/json are what a coverage-driven pass should actually read.
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/**'],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        // Measured 2026-07-28 (165 tests, 10 files): 100% across all four
        // metrics with nothing excluded from `include`. Set with the same small
        // safety margin every other package here uses.
        statements: 98,
        branches: 98,
        functions: 98,
        lines: 98,
      },
    },
  },
});
