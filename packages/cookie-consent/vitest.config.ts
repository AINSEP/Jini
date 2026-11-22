import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node by default: contract, policy, plugins, render and server are universal and must not need a DOM.
    // Browser-client suites opt in per file with `// @vitest-environment jsdom`.
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
    // The React settings panel (moved from admin) needs a DOM for every test in its tree.
    environmentMatchGlobs: [['src/react/**', 'jsdom']],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**'],
      exclude: ['src/**/__tests__/**', 'src/client/entry.ts'],
    },
  },
});
