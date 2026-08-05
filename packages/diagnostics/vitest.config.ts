import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      // The v8 text table silently drops rows once there are many files —
      // json-summary/json are what a coverage-driven pass should actually
      // read (see ADS-memory/reports/jini-port's Phase 6.5 method).
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/**'],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        // Measured 2026-07-22: genuine 100/100/100/100 (audit fix coverage sweep — this package
        // had no committed threshold gate or test:coverage script at all before this pass).
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
