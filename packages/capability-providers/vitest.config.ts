import { coverageConfigDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      // The v8 text table silently drops rows — json-summary/json are what a
      // coverage-driven pass should actually read (see
      // ADS-memory/reports/jini-port/skills/fixing-open-design.md Phase 6.5).
      reporter: ['text', 'json-summary', 'json'],
      exclude: [...coverageConfigDefaults.exclude],
    },
  },
});
