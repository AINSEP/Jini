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
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.postgres.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      // The v8 text table silently drops rows once there are many files —
      // json-summary/json are what a coverage-driven pass should actually
      // read (see ADS-memory/reports/jini-port's Phase 6.5 method).
      reporter: ['text', 'json-summary', 'json'],
      // CR-R4: widened to the whole package (matching packages/core and
      // packages/agent-runtime's package-wide convention) — the prior config
      // measured only tool-executor.ts, silently excluding the newly
      // expanded run-lifecycle/event-log/agent-executor/delegated-tool-bridge
      // coverage (see
      // ADS-memory/reports/code-review/CR-backend-coverage-push-2026-07-20.md, R4).
      // `src/run/core/failure-taxonomy.ts` is a genuinely zero-executable-
      // statement file (`export type`/`export interface` only, verified via
      // `grep -nE '^(export )?(const|function|class|let|var) '` finding no
      // runtime declarations) — left in `include` rather than excluded so a
      // future non-type addition to that file is still gated, same
      // reasoning as packages/core/vitest.config.ts's principal.ts carve-out.
      include: ['src/**'],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        // Measured 2026-07-21 package-wide honest coverage is ~99.8/99.3/
        // 100/99.8 (statements/branches/functions/lines) — comfortably above
        // the 98% unit-profile target. Set with a small safety margin below
        // the measured numbers rather than pinned exactly to them.
        statements: 98,
        branches: 98,
        functions: 99,
        lines: 98,
      },
    },
  },
});
