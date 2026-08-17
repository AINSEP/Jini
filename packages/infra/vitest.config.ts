import { coverageConfigDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/**'],
      exclude: [
        ...coverageConfigDefaults.exclude,
        'src/**/*.test.ts',
        'src/**/__tests__/**',
        // Zero-executable-statement files: pure `interface`/`type` declarations that fully erase
        // at compile time. Verified with `grep -nE '^(export )?(const|function|class|let|var) '`
        // finding no runtime declaration in either — the same documented carve-out precedent as
        // packages/integrations and packages/ui, not a coverage dodge.
        'src/db/core/ports.ts',
        'src/db/sqlite/types.ts',
      ],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
