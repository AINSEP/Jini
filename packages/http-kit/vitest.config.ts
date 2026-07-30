import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      // The v8 text table silently drops rows once there are many files —
      // json-summary/json are what a coverage-driven pass should actually
      // read (see foundry/docs/jini-port's Phase 6.5 method).
      reporter: ['text', 'json-summary', 'json'],
      // CR-R4: this package had no committed coverage gate at all (see
      // ADS-memory/reports/code-review/CR-backend-coverage-push-2026-07-20.md, R4).
      include: ['src/**'],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        // Measured 2026-07-22: genuine 100/100/100/100 across every file in this package (audit
        // fix — the prior runs.ts/terminals.ts branch gaps were closed with real refactors/tests,
        // not by lowering this threshold). Set at the real number, not a margin below it.
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
