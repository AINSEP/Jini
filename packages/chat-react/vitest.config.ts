import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      // The v8 text table silently drops rows once there are many files —
      // json-summary/json are what a coverage-driven pass should actually
      // read (see foundry/docs/jini-port's Phase 6.5 method).
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/**'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      thresholds: {
        // Measured 2026-07-22: genuine 100/100/100/100 (audit fix coverage sweep — this package
        // already had a real jsdom test environment, but no committed coverage threshold gate or
        // test:coverage script yet).
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
