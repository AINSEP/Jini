import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      // The v8 text table silently drops rows once there are many files —
      // json-summary/json are what a coverage-driven pass should actually
      // read (see ADS-memory/reports/jini-port's Phase 6.5 method).
      reporter: ['text', 'json-summary', 'json'],
      // Package-wide (verified 2026-07-20 all remaining files are at or near
      // 100% on their own). compose.typecheck.ts is excluded because it's a
      // typecheck-only compile-time proof (see its own docblock) never
      // exercised by vitest — including it would tank the aggregate on a
      // file this gate was never meant to cover. principal.ts (an
      // `interface` only) is a genuinely zero-executable-statement file;
      // left in `include` rather than excluded so a future non-type addition
      // to that file is still gated, same as any other src file.
      include: ['src/**'],
      exclude: ['src/**/*.test.ts', 'src/compose.typecheck.ts'],
      thresholds: {
        statements: 99,
        branches: 99,
        functions: 99,
        lines: 99,
      },
    },
  },
});
