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
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/**'],
      // Explicitly setting `coverage.exclude` at all replaces vitest's own sensible built-in
      // default (which already excludes test files) rather than extending it — so the test files
      // themselves are re-added here alongside the one custom exclusion this package needs:
      // `create-local-node-daemon.typecheck.ts` is a compile-time-only proof (see its own
      // docblock) — `tsc --noEmit` is its test runner, never vitest, the same exclusion core's own
      // vitest.config.ts applies to its sibling `compose.typecheck.ts` file.
      exclude: ['src/__tests__/**', 'src/create-local-node-daemon.typecheck.ts'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
