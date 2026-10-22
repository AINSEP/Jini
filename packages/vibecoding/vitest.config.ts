import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Deliberately NO top-level `environment: 'jsdom'`. `src/core/**` and `src/html/**` are
    // universal by contract — a test that reaches for `window` there should fail loudly rather
    // than be quietly accommodated. `src/react/**` is routed to jsdom by GLOB instead, mirroring
    // `@jini-ai/chat`'s own vitest.config.ts (same reasoning: React Testing Library needs a DOM
    // for every test in that tree, and a per-file pragma would only create a way to forget it).
    environmentMatchGlobs: [['src/react/**', 'jsdom']],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/**'],
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**'],
    },
  },
});
