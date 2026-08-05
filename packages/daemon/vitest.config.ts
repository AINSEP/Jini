import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      // The v8 text table silently drops rows once there are many files —
      // json-summary/json are what a coverage-driven pass should actually
      // read (see ADS-memory/reports/jini-port's Phase 6.5 method).
      reporter: ['text', 'json-summary', 'json'],
      // CR-R4: widened to the whole package (matching packages/core and
      // packages/agent-runtime's package-wide convention) — the prior config
      // measured only tool-executor.ts, silently excluding the newly
      // expanded run-lifecycle/event-log/agent-executor/delegated-tool-bridge
      // coverage (see
      // ADS-memory/reports/code-review/CR-backend-coverage-push-2026-07-20.md, R4).
      // `src/run/core/failure-taxonomy.ts` is a genuinely zero-executable-
      // statement file (`export type`/`export interface` only, verified via
      // `grep -nE '^(export )?(const|function|class|let|var) '` finding no
      // runtime declarations) — left in `include` rather than excluded so a
      // future non-type addition to that file is still gated, same
      // reasoning as packages/core/vitest.config.ts's principal.ts carve-out.
      include: ['src/**'],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        // Measured 2026-07-21 package-wide honest coverage is ~99.8/99.3/
        // 100/99.8 (statements/branches/functions/lines) — comfortably above
        // the 98% unit-profile target. Set with a small safety margin below
        // the measured numbers rather than pinned exactly to them.
        statements: 98,
        branches: 98,
        functions: 99,
        lines: 98,
      },
    },
  },
});
