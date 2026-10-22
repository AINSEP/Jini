import { defineConfig } from 'vitest/config';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
// Offline fixtures use installed host peers; production imports retain public subpaths.
const dbRequire = createRequire(new URL('../db/package.json', import.meta.url));
const peer = (name: string) => dbRequire.resolve(name);
const jini = fileURLToPath(new URL('../', import.meta.url));

export default defineConfig({
  resolve: { alias: [
    { find: /^@jini-ai\/db\/(.*)$/, replacement: `${jini}db/dist/$1/index.js` },
    { find: /^@jini-ai\/daemon\/store\/(.*)$/, replacement: `${jini}daemon/src/store/$1.ts` },
    { find: '@jini-ai/chat/store/legacy/sqlite', replacement: `${jini}chat/src/store/legacy/sqlite/index.ts` },
    { find: '@jini-ai/chat/store/sqlite', replacement: `${jini}chat/dist/store/sqlite/index.js` },
    { find: '@jini-ai/registry/tool-catalog/sqlite', replacement: `${jini}registry/src/tool-catalog/sqlite.ts` },
    ...['better-sqlite3', 'kysely', '@electric-sql/pglite', 'pg'].map(name => ({ find: name, replacement: peer(name) })),
  ] },
  test: {
    coverage: {
      provider: 'v8',
      // The v8 text table silently drops rows once there are many files —
      // json-summary/json are what a coverage-driven pass should actually
      // read (see ADS-memory/reports/jini-port/skills/fixing-open-design.md Phase 6.5).
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/**'],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        statements: 99,
        branches: 99,
        functions: 99,
        lines: 99,
      },
    },
  },
});
