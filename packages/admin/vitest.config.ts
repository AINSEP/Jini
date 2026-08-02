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
    },
  },
});
