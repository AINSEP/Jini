---
"@jini-ai/admin": minor
---

Folded `@jini-ai/composio` into `@jini-ai/admin` as a `./server` subpath, and retired the package.

Composio's only consumer is the admin surface, so a standalone package was a boundary that bought
nothing — the same reasoning that retired `@jini-ai/ui-core` into `@jini-ai/ui/core`. All 11 source
files and 8 test files move as-is; no production logic changed.

It lands under `./server`, not `./core`, because it imports `node:fs`, `node:crypto`, and
`node:path`. `/core` is the framework-free, DOM-free, universal layer, and that property is what
makes it installable without React — it is not a general-purpose home for anything non-React.
`jini.entries` now reads `{".": universal, "./core": universal, "./browser": browser,
"./server": node}`. `@jini-ai/protocol` becomes a **devDependency**: all seven references are
`import type { JsonValue }`, so admin's consumers pay nothing at runtime for this.

**Composio's tests had never been type-checked.** Its `tsconfig.json` set `include: ["src"]` while
its tests lived in a top-level `tests/` directory, so `tsc` never looked at them, and `vitest` does
not type-check. Twenty errors under `exactOptionalPropertyTypes: true` — a setting predating the
package — had been latent since its creation. Admin co-locates tests under `src/**/__tests__/`,
which `include: ["src"]` does cover, so the move surfaced them; it did not cause them. Nineteen
were mechanical fixture shapes. The twentieth was not: a `credentialStore.set` fixture in
`service.contract.test.ts` was missing `accountLabel` **on purpose**, simulating a persisted record
without one so the test could assert the resulting rejection path. "Fixing" it to satisfy the
compiler made the request match instead of mismatch and broke the test at runtime; it is now
preserved verbatim behind a documented assertion. No production type was widened to satisfy a
fixture. `src/server/**` keeps composio's own 100% coverage threshold via a scoped glob rather than
promoting it package-wide onto `/core` and `/browser`, which never carried it.

**`@jini-ai/composio` is retired, not versioned forward.** It was published (0.1.0, 0.2.0, 0.2.1 —
a longer public life than ui-core's single version), but has zero consumers: no source file,
package.json, or lockfile in either this repo or Tovu has ever referenced it, verified with a `-S`
pickaxe over full git history rather than current state alone. Deleting the source does **not**
unpublish anything — 0.2.1 stays installable and no existing build breaks — so a deprecation-stub
package was judged not worth keeping alive for a name nothing needs. Whoever runs the next release
should follow up against the registry with:

```
npm deprecate @jini-ai/composio "Merged into @jini-ai/admin; import from '@jini-ai/admin/server' instead."
```

One caution for anyone re-examining that consumer question later: composio's CHANGELOG for 0.2.1
says "Verified against a real external consumer (Tovu...)", which reads like direct evidence of a
dependency. It is not. That exact sentence appears verbatim in 23 other packages' CHANGELOGs — it
is boilerplate from a repo-wide `main`/`types` resolution fix that was batch-applied, not a
composio-specific claim.

Composio's `source-map.md` is carried forward to `src/server/source-map.md`. Its package-level
`UNLOCKED.md` is not: it tracked admission evidence for the locked/incubating gate removed
2026-07-28, and its one substantive point is covered in more detail by `source-map.md`. The root
`UNLOCKED.md`'s composio entry is deliberately left untouched as historical record, per that file's
own header.
