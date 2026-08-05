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
      exclude: [
        ...coverageConfigDefaults.exclude,
        // Genuinely zero-executable-statement files: pure `interface`/`type`
        // declarations that fully erase at compile time (verified via
        // `grep -nE '^(export )?(const|function|class|let|var) '` finding no
        // runtime declarations) — same documented carve-out precedent as
        // packages/ui/vitest.config.ts, not a coverage dodge.
        'src/types.ts',
        'src/dispatch/types.ts',
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
