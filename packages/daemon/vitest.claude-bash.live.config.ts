import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// BEFORE must resolve its own built dependency graph; AFTER exercises current runtime source.
export default defineConfig({
  resolve: {
    alias: process.env.JINI_LIVE_PACKAGES_DIR ? [] : [{
      find: /^@jini-ai\/agent-runtime$/,
      replacement: fileURLToPath(new URL('../agent-runtime/src/index.ts', import.meta.url)),
    }],
  },
  test: {
    include: ['src/__tests__/integration/claude-bash-sandbox.live.test.ts'],
    // Native ESM loading keeps a selected checkout's transitive imports in its own built graph.
    server: { deps: { external: [/\/dist\//] } },
    testTimeout: 150_000,
    retry: 0,
  },
});
