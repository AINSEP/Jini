import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // No `environment: 'jsdom'` at the top level, matching `@jini-ai/admin`'s `./core` subpath:
    // `src/core/**` must stay universal (no React, no DOM) — a DOM-dependent test landing there
    // means the boundary this package exists to hold has already leaked. Let it fail loudly.
    // `src/react/**` is routed to jsdom by GLOB rather than per-file pragma, same reasoning as
    // admin's own config: React Testing Library needs a DOM for every test in that tree without
    // exception, so a pragma there protects nothing and only creates a way to forget.
    environmentMatchGlobs: [['src/react/**', 'jsdom']],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      // The v8 text table silently drops rows once there are many files —
      // json-summary/json are what a coverage-driven pass should actually
      // read (see ADS-memory/reports/jini-port's Phase 6.5 method).
      reporter: ['text', 'json-summary', 'json'],
      // CR-R4: chat-core (this layer's predecessor) had no committed coverage gate at all (see
      // ADS-memory/reports/code-review/CR-backend-coverage-push-2026-07-20.md, R4).
      // `src/core/events.ts` and `src/core/util/types.ts` are genuinely
      // zero-executable-statement files (`export type`/`export interface`
      // only, verified via
      // `grep -nE '^(export )?(const|function|class|let|var) '` finding no
      // runtime declarations) — left in `include` rather than excluded so a
      // future non-type addition to either file is still gated, same
      // reasoning as packages/core/vitest.config.ts's principal.ts carve-out.
      // Scoped to `src/core/**` (not package-wide) — `src/react/**` (once it lands) is a
      // different layer with its own coverage posture, not inheriting chat-core's 98% bar
      // sight-unseen.
      include: ['src/core/**'],
      exclude: ['src/core/**/*.test.ts'],
      thresholds: {
        // Measured 2026-07-21 chat-core coverage is 100% across all four metrics. Set with a
        // small safety margin below that. Flat (not per-glob) because `include`/`exclude` above
        // already scope this whole block to `src/core/**` — a per-glob threshold only earns its
        // keep once a second layer with a different bar (e.g. `src/react/**`) is actually being
        // measured in the same run, same as `@jini-ai/admin`'s `src/server/**` carve-out.
        statements: 98,
        branches: 98,
        functions: 98,
        lines: 98,
      },
    },
  },
});
