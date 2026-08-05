import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      // The v8 text table silently drops rows once there are many files —
      // json-summary/json are what a coverage-driven pass should actually
      // read (see ADS-memory/reports/jini-port's Phase 6.5 method).
      reporter: ['text', 'json-summary', 'json'],
      // CR-R4: this package had no committed coverage gate at all (see
      // ADS-memory/reports/code-review/CR-backend-coverage-push-2026-07-20.md, R4).
      // `src/common.ts` is a genuinely zero-executable-statement file
      // (`export type`/`export interface` only, verified via
      // `grep -nE '^(export )?(const|function|class|let|var) '` finding no
      // runtime declarations) — left in `include` rather than excluded so a
      // future non-type addition to that file is still gated, same
      // reasoning as packages/core/vitest.config.ts's principal.ts carve-out.
      include: ['src/**'],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        // Measured 2026-07-21 package-wide honest coverage is 100% across
        // all four metrics. Set with a small safety margin below that.
        statements: 98,
        branches: 98,
        functions: 98,
        lines: 98,
      },
    },
  },
});
