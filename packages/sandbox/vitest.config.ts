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
        // Zero-executable-statement file: pure `interface`/`type` declarations that fully erase
        // at compile time. Same documented carve-out precedent as packages/infra's
        // src/db/core/ports.ts, not a coverage dodge.
        'src/core/ports.ts',
      ],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
