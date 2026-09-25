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
        // finding no runtime declaration in either — same documented carve-out precedent as
        // packages/infra's src/db/core/ports.ts, not a coverage dodge. `SandboxOperationError`
        // (the one real runtime export in ./core) lives in its own errors.ts specifically so
        // ports.ts can stay on this list truthfully instead of being "mostly types, plus one
        // class" — errors.ts and the index.ts barrel that re-exports it are NOT excluded, and
        // are covered by src/core/__tests__/ instead.
        'src/core/ports.ts',
        'src/e2b/e2b-sandbox-handle.ts',
      ],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
