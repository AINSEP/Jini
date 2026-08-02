---
"@jini-ai/ui": minor
---

Folded `@jini-ai/ui-core` into `@jini-ai/ui` as an independently-importable `./core` subpath.

`ui-core` was never a standalone concern — it was always the framework-free half (types, decision
rules, catalogs, host port contracts; no React, no DOM) of `@jini-ai/ui`'s own features, published
separately only because that pairing was undiscoverable without reading both trees side by side.
All 13 `ui-core` features move to their same-named `@jini-ai/ui` feature directory, alongside the
React half they were always paired with; `@jini-ai/ui/core` (`src/core.ts`) is the new entry point
that re-exports exactly what `@jini-ai/ui-core`'s own root barrel did. `react`/`react-dom` move
from required to optional peer dependencies (`peerDependenciesMeta`, matching `@jini-ai/admin`'s
existing `./core`/`./browser` split) so `./core` stays importable without installing React. The
no-DOM guard `ui-core`'s own `vitest.config.ts` provided by never configuring a `jsdom` environment
is now enforced by `environmentMatchGlobs` over the (unchanged) centralized `src/__tests__/`
subtree that used to be `ui-core`'s whole test suite, so a DOM-dependent test landing there still
fails loudly instead of silently inheriting this package's `jsdom` default.

**`@jini-ai/ui-core` is retired, not versioned forward.** `packages/ui-core` is deleted from this
workspace; nothing else in it depended on the package name directly (only on `@jini-ai/ui`, which
already re-exported everything ui-core had). It had no confirmed external consumers, so a
deprecation-stub package was judged not worth the ongoing maintenance of keeping a zombie package
alive and published indefinitely for a name nothing currently needs. It was still published
(`0.1.2`, `publishConfig.access: public`), so it is not silently orphaned: whoever runs the next
release should follow up with `npm deprecate @jini-ai/ui-core "Merged into @jini-ai/ui; import from
'@jini-ai/ui/core' instead."` against the npm registry.
