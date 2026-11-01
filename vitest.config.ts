import { configDefaults, defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Run the new shared loader from source; production exports are emitted by the normal build.
  resolve: { alias: { '@jini-ai/core/optional-peer': fileURLToPath(new URL('./packages/core/src/optional-peer.ts', import.meta.url)) } },
  test: {
    // These suites use node:test; test:scripts:node runs them with their owning runner.
    exclude: [
      ...configDefaults.exclude,
      'scripts/__tests__/check-hardwiring.test.ts',
      'scripts/__tests__/integration/infra-retirement.integration.test.ts',
    ],
  },
});
