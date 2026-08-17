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
        // at compile time. Verified with `grep -nE '^(export )?(const|function|class|let|var) '`
        // finding no runtime declaration — same documented carve-out precedent as
        // packages/infra's src/db/core/ports.ts, not a coverage dodge. `src/core/ports.ts` and
        // `src/core/index.ts` are NOT here despite mostly being types: both now carry the real
        // `SandboxOperationError` class/re-export and are covered by
        // src/core/__tests__/sandbox-operation-error.test.ts instead.
        'src/e2b/e2b-sandbox-handle.ts',
      ],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
