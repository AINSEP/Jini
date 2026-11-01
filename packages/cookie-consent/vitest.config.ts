import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Exercise the public CMS entry from source without requiring a package build or install.
  resolve: { alias: {
    '@jini-ai/cms/consent/html': fileURLToPath(new URL('../cms/src/consent/html/index.ts', import.meta.url)),
  } },
  test: {
    // Node by default: contract, policy, plugins, render and server are universal and must not need a DOM.
    // Browser-client suites opt in per file with `// @vitest-environment jsdom`.
    include: ['src/**/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**'],
      exclude: ['src/**/__tests__/**', 'src/client/entry.ts'],
    },
  },
});
