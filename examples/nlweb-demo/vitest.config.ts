import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // The http server is exercised by hand (see README); unit-testing node:http wiring would
      // test the runtime, not this spike. Excluded rather than left to silently drag the number.
      exclude: ['src/server.ts', 'src/__tests__/**'],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
