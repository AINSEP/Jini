import { coverageConfigDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      // json-summary/json (not just the text table) so a coverage-driven
      // pass can read real per-file numbers — see
      // ADS-memory/reports/jini-port/skills/fixing-open-design-web.md Phase 9.5.
      reporter: ['text', 'json-summary', 'json'],
      exclude: [
        ...coverageConfigDefaults.exclude,
        // Zero emitted executable statements — `export interface`/type-only
        // declarations that fully erase at compile time (verified via
        // `grep -nE '^(export )?(const|function|class|let|var) '` finding
        // nothing). A file with nothing to execute is never loaded by any
        // test, so v8 reports it as 0% rather than N/A; same documented
        // carve-out `packages/ui`'s vitest.config.ts uses for its
        // `settings-dialog` types.ts files.
        'src/types.ts',
        'src/preview-modal-shell/types.ts',
      ],
    },
  },
});
