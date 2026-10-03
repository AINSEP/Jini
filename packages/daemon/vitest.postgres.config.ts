/** Scoped real-Postgres C2 session contracts; no database-unavailable skip. */
import { defineConfig } from 'vitest/config';
import config from './vitest.config.js';
// Replace rather than merge the default exclusion: mergeConfig concatenates arrays.
export default defineConfig({
  ...config,
  test: {
    ...config.test,
    include: ['src/store/agent-sessions/__tests__/postgres.postgres.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
