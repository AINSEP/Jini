import { defineConfig } from 'vitest/config';
export default defineConfig({ test: {
  // Match executable tests explicitly; typecheck fixtures run through tsc.
  include: ['src/**/*.test.ts'], environment: 'node', environmentMatchGlobs: [['src/react/**', 'jsdom']],
} });
