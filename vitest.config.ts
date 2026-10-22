import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // These suites use node:test; test:scripts:node runs them with their owning runner.
    exclude: [
      ...configDefaults.exclude,
      'scripts/__tests__/check-hardwiring.test.ts',
      'scripts/__tests__/integration/infra-retirement.integration.test.ts',
    ],
  },
});
