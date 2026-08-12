import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Deliberately NO `environment: 'jsdom'`, matching `@jini-ai/cms`'s core layer — this
    // package's `/agent-plugins` is universal (types + structural validation only, no DOM,
    // no node:* beyond what a test itself reaches for).
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/**'],
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**'],
    },
  },
});
