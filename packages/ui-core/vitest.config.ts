import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // No `environment: 'jsdom'` on purpose: nothing in this package touches
    // the DOM, and a DOM-dependent test landing here would mean React logic
    // crept back in — which is the one thing the package boundary exists to
    // prevent. Let such a test fail loudly rather than quietly pass.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/**'],
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**'],
    },
  },
});
