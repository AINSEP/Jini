import { defineConfig } from 'vitest/config';
export default defineConfig({ test: {
  // kit.spec.ts is contract data, not a test suite; match executable tests explicitly.
  include: ['src/**/*.test.ts'], environment: 'node', environmentMatchGlobs: [['src/react/**', 'jsdom']],
} });
