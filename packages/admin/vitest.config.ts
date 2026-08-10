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
    //
    // `src/react/**` is routed to jsdom by GLOB rather than per-file pragma, and that asymmetry is
    // deliberate. React Testing Library needs a DOM for every test in that tree without exception,
    // so a pragma there protects nothing and only creates a way to forget: a new React test added
    // tomorrow gets jsdom automatically. Flipping the package-level `environment` to `'jsdom'`
    // instead would have reached the same tests — and silently erased the no-DOM guard for the
    // other three layers, which is the one thing this config exists to hold. `packages/ui`'s
    // config is the same mechanism pointed the other way (jsdom default, `node` by glob for its
    // framework-free tree).
    environmentMatchGlobs: [['src/react/**', 'jsdom']],
    // Loaded for every suite in the package, not just the React one — see the file's own comment
    // for why that does not weaken the no-DOM boundary above.
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/**'],
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**'],
    },
  },
});
