import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * EXTRACT-S5 H3: `hosted-mcp-sign-in.test.ts` wires `@jini-ai/mcp/federation/hosted` and `@jini-ai/oauth`, which this
 * example does not list as dependencies yet (adding them needs a lockfile update, which this batch may not make). Each
 * alias maps ONE public entry to exactly the file that package's `exports` map serves for it, so the test still resolves
 * only public entries. A packed consumer installs both packages instead and never reads this file.
 */
const dist = (path: string): string => fileURLToPath(new URL(`../../packages/${path}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@jini-ai\/mcp\/federation\/hosted$/, replacement: dist('mcp/dist/federation/hosted/index.js') },
      { find: /^@jini-ai\/oauth$/, replacement: dist('oauth/dist/index.js') },
    ],
  },
});
