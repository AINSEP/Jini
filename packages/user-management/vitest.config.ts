import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Vitest 2 otherwise derives a CPU-based minimum that conflicts with --maxWorkers=1.
    minWorkers: 1,
    // Keep real DOM interaction suites within the shared runner's CPU budget.
    // This changes scheduling only; assertions and the 5-second per-test deadline stay intact.
    maxWorkers: 1,
    environment: 'node',
    environmentMatchGlobs: [['src/react/**', 'jsdom'], ['src/admin/react/**', 'jsdom']],
    setupFiles: ['./test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/**'],
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**'],
    },
  },
});
