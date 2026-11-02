import { defineConfig } from 'vitest/config';

export default defineConfig({
  // One React for the chart provider and the UI chart host it is tested through.
  resolve: { dedupe: ['react', 'react-dom'] },
  test: {
    // Chart providers render real React/Recharts SVG; every other provider source stays node-only.
    // Their DOM test files import `__tests__/dom-setup.ts` themselves (no package-wide setup file).
    environmentMatchGlobs: [['src/charts-*/**', 'jsdom']],
  },
});
