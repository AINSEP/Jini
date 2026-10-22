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
    { find: '@jini-ai/server/storage/legacy/sqlite', replacement: `${jini}server/src/storage/legacy/sqlite.ts` },
    { find: '@jini-ai/server/storage', replacement: `${jini}server/src/storage/index.ts` },
    { find: '@jini-ai/server/store/projects/sqlite', replacement: `${jini}server/src/store/projects/sqlite.ts` },
    { find: '@jini-ai/registry/tool-catalog', replacement: `${jini}registry/src/tool-catalog/index.ts` },
    { find: '@jini-ai/chat/store/legacy', replacement: `${jini}chat/src/store/legacy/index.ts` },
    ...['better-sqlite3', 'kysely', '@electric-sql/pglite', 'pg'].map(name => ({ find: name, replacement: peer(name) })),
  ] },
  test: { testTimeout: 60_000, hookTimeout: 60_000 },
});
