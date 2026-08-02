import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // No `environment: 'jsdom'` at the top level, matching `@jini-ai/ui`'s `./core` subpath: `src/core/**` must
    // stay universal (no React, no DOM), and a DOM-dependent test landing there would mean the
    // boundary this package exists to hold has already leaked. Let it fail loudly.
    //
    // `src/browser/**` legitimately touches `window`. Its tests opt in per-file with the
    // `// @vitest-environment jsdom` pragma rather than widening the default here, so the
    // universal half keeps failing loudly while the browser half can still be tested.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/**'],
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**'],
      thresholds: {
        // `./server` was `@jini-ai/composio`, a standalone package whose own `vitest.config.ts`
        // enforced 100% statement/branch/function/line coverage on every `src/**/*.ts` module,
        // no exclusions. That bar is scoped to this glob rather than promoted to a package-wide
        // default: `./core` and `./browser` were never held to it, and folding composio in is not
        // the occasion to either loosen its bar or impose it retroactively on siblings that never
        // carried it. See `src/server/composio/source-map.md`'s Verification section.
        'src/server/**': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
