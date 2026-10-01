import { coverageConfigDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // PGlite opens take seconds (WASM start-up, initdb on a new data dir).
    testTimeout: 60_000,
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/**'],
      exclude: [...coverageConfigDefaults.exclude, 'src/**/__tests__/**', 'src/testing/**'],
    },
  },
});
