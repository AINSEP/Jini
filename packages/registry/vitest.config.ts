import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      // The v8 text table silently drops rows once there are many files —
      // json-summary/json are what a coverage-driven pass should actually
      // read (see ADS-memory/reports/jini-port/skills/fixing-open-design.md Phase 6.5).
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/**'],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        statements: 99,
        branches: 99,
        functions: 99,
        lines: 99,
      },
    },
  },
});
