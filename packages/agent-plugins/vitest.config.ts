import { configDefaults, defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // The tools subpath projects into @jini-ai/plugins/host; test against its source, not a stale dist.
  resolve: { alias: [{ find: '@jini-ai/plugins/host', replacement: fileURLToPath(new URL('../plugins/src/host/index.ts', import.meta.url)) }] },
  test: {
    // Plugin folders (`<id>/**/__tests__/*.test.mjs`) hold node:test suites; the root
    // `test:agent-plugins:content` script runs them, so vitest must not collect them.
    exclude: [...configDefaults.exclude, '**/__tests__/**/*.mjs'],
    // Deliberately NO `environment: 'jsdom'`, matching `@jini-ai/cms`'s core layer — this
    // package's root export is universal (types + structural validation only, no DOM, no
    // node:* beyond what a test itself reaches for).
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
      // core/ is the build-free implementation shared by ./persistent-state and src/lifecycle; measure it too.
      include: ['src/**', 'core/**', 'persistent-state.js'],
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**'],
    },
  },
});
