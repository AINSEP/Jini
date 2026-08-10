---
"@jini-ai/integrations": minor
---

Add `@jini-ai/integrations/media-providers/catalog` — a browser-safe entry exporting only the
vendor catalogue (`providers.ts`) and its types (`types.ts`).

The existing `./media-providers` entry is `jini.runtime: "node"` and its barrel statically pulls in
`node:crypto`/`node:fs`/`node:path` (`staging.ts`), `node:dns` (`dispatch/ssrf-guard.ts`), and
`undici` (`dispatch/providers/openai.ts`). A browser consumer that only needs the provider list to
render a credentials screen — Tovu's admin SPA is the first — previously had no way to get it
without dragging the whole dispatch engine into its bundle.

`providers.ts` imports only types from `types.ts`, and `types.ts` imports nothing, so the pair is
genuinely dependency-free; the new entry is marked `"universal"` in `jini.entries`. Verified by
importing the built subpath from a directory containing nothing but this package's `dist/` and
`package.json` — 11 exports, 25 vendors, no dispatch symbols reachable — while
`./media-providers` fails with `ERR_MODULE_NOT_FOUND` on `@jini-ai/core` in the same environment.

`__tests__/catalog.test.ts` walks the transitive source graph and asserts it contains exactly
`catalog.ts`/`providers.ts`/`types.ts` with zero bare import specifiers, so re-exporting anything
node-bound from this entry fails a test rather than a downstream bundle.

Additive only — no existing entry, export, or type changed.
