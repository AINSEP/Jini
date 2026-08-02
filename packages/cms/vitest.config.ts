import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Deliberately NO `environment: 'jsdom'`, matching `@jini-ai/admin`'s core layer. Neither
    // `src/core/**` nor `src/server/**` may touch the DOM: core is universal, server is Node-bound.
    // A test that reaches for `window` should fail loudly rather than be quietly accommodated.
    //
    // There is no `./react` or `./browser` layer here on purpose — admin panels for CMS content
    // belong to `@jini-ai/admin`, which already owns that surface. If a browser layer is ever
    // genuinely needed, add it by glob (as admin does) rather than by flipping the default, which
    // would erase this guard for the other two layers.
    coverage: {
      provider: 'v8',
      // The v8 text table silently drops rows once there are many files — json-summary/json are
      // what a coverage-driven pass should actually read.
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/**'],
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**'],
      // No thresholds yet, and that is a deliberate omission rather than an oversight: this package
      // is a placeholder whose only runtime statements are layer markers. Sibling packages set
      // 98–100% against real measured coverage; setting a number here would either be vacuously
      // true or block the first real port commit. Add thresholds in the same commit that lands the
      // first ported module, measured against what that module actually achieves.
    },
  },
});
