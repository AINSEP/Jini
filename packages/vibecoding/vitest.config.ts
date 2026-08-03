import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Deliberately NO `environment: 'jsdom'`. `src/core/**` is universal by contract — a test that
    // reaches for `window` should fail loudly rather than be quietly accommodated. When a `./react`
    // layer is added, give it jsdom by glob rather than flipping this default, which would erase
    // the guard for core.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/**'],
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**'],
    },
  },
});
