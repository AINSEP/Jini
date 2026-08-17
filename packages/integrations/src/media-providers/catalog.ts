/**
 * `@jini-ai/integrations/media-providers/catalog` — the vendor catalogue and its types, and
 * NOTHING else.
 *
 * Why this exists as its own subpath: the main `./media-providers` entry is `jini.runtime: "node"`
 * — its barrel statically pulls in `node:crypto`/`node:fs`/`node:path` (`staging.ts`),
 * `node:dns` (`dispatch/ssrf-guard.ts`), and `undici` (`dispatch/providers/openai.ts`). A host's
 * browser bundle needs the provider list to render a credentials screen, but must not drag the
 * dispatch engine in to get it. `providers.ts` imports only types from `types.ts`, and `types.ts`
 * imports nothing at all, so this pair is genuinely dependency-free and safe to mark
 * `"universal"`.
 *
 * The constraint this file encodes: **it may only ever re-export modules with no runtime imports.**
 * Adding anything that reaches `dispatch/`, `staging.ts`, or `sqlite-task-store.ts` silently
 * reintroduces the node dependency for every browser consumer. `__tests__/catalog.test.ts` asserts
 * the import graph stays clean, so that mistake fails a test rather than a downstream bundle.
 */
export * from './types.js';
export * from './providers.js';
