import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/**'],
      // Explicitly setting `coverage.exclude` at all replaces vitest's own sensible built-in
      // default (which already excludes test files) rather than extending it — so the test files
      // themselves are re-added here alongside the one custom exclusion this package needs:
      // `create-local-node-daemon.typecheck.ts` is a compile-time-only proof (see its own
      // docblock) — `tsc --noEmit` is its test runner, never vitest, the same exclusion core's own
      // vitest.config.ts applies to its sibling `compose.typecheck.ts` file.
      exclude: ['src/__tests__/**', 'src/create-local-node-daemon.typecheck.ts'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
