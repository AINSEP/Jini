import { defineConfig } from 'vitest/config';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // One React for the chart provider and the UI chart host it is tested through.
  resolve: { dedupe: ['react', 'react-dom'] },
  // The artifact tests build plugin packages under os.tmpdir() and import their .mjs entries. Vite 6
  // applies server.fs.allow to Vitest's module loads, so the temp root is allowed next to the workspace.
  server: { fs: { allow: [fileURLToPath(new URL('../..', import.meta.url)), tmpdir()] } },
  test: {
    // Chart providers render real React/Recharts SVG; every other provider source stays node-only.
    // Their DOM test files import `__tests__/dom-setup.ts` themselves (no package-wide setup file).
    environmentMatchGlobs: [['src/charts-*/**', 'jsdom']],
  },
});
