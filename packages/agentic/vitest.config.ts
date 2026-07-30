import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The root half of this package (everything outside src/dom/) is DOM-free by construction —
    // see tsconfig.json's exclude and source-map.md's "DOM split" section — so it runs under
    // vitest's default 'node' environment. Only src/dom/** (the browser PageDriver) needs a DOM
    // to exercise, hence the scoped override rather than a package-wide 'jsdom' environment.
    environmentMatchGlobs: [['src/dom/**', 'jsdom']],
    coverage: {
      provider: 'v8',
      // The v8 text table silently drops rows once there are many files —
      // json-summary/json are what a coverage-driven pass should actually
      // read (see foundry/docs/jini-port's Phase 6.5 method).
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/**'],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        // This package is a relocation of already-100%-covered chat-core/agentic and
        // chat-react/agent-bridge/dom-page-driver code (2026-07-26 extraction, see
        // ADS-memory/reports/proposals/PLAN-jini-agentic-extraction-2026-07-26.md). Set with the
        // same small safety margin below the measured 100% that the source packages use.
        statements: 98,
        branches: 98,
        functions: 98,
        lines: 98,
      },
    },
  },
});
