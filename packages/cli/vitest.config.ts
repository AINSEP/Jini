import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      // The v8 text table silently drops rows once there are many files —
      // json-summary/json are what a coverage-driven pass should actually
      // read (foundry/docs/jini-port/skills/fixing-open-design.md Phase 6.5).
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/**'],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        // Measured 2026-07-22: 100/99.84/100/100 (statements/branches/functions/lines) — audit
        // fix coverage pass. The one remaining branch (prompt.ts's `finish()` idempotency guard)
        // is documented-unreachable through this file's real `createReadStream` usage on a modern
        // Node runtime (Readable's 'end'/'error' mutual exclusivity contract); see that file's own
        // inline comment and source-map.md's dated entry for the full re-verification record. No
        // `/* v8 ignore */` suppression — set below the measured real number instead, matching
        // this repo's established convention (e.g. `@jini-ai/registry`'s `trust.ts`).
        statements: 100,
        branches: 99,
        functions: 100,
        lines: 100,
      },
    },
  },
});
