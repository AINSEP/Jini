---
"@jini-ai/integrations": minor
---

Composio and the media-provider gateway collapse from two sibling packages under
`packages/integrations/` into subpaths of one package: `@jini-ai/integrations/composio` and
`@jini-ai/integrations/media-providers`. An npm package name allows only one slash, so the literal
import paths the repo owner wants require exactly this shape — one package with two subpath
exports, not two packages grouped under a shared directory.

This closes out two moves that happened earlier the same day. Composio was folded into
`@jini-ai/admin` as `./server` on 2026-08-01, then un-folded back into its own package under its
original published name, `@jini-ai/composio` (see the now-superseded
`composio-un-retirement.md`) — that un-retirement was never itself published, so no registry
version exists under that name beyond the pre-fold `0.2.1`. `@jini-ai/media` was separately renamed
and relocated to `@jini-ai/integrations-media-providers` (see the now-superseded
`media-providers-rename.md`); that rename was likewise never published — its own text notes the
version stays at `0.1.2` on disk pending a real release. Both collapse directly into this package's
two subpaths without ever taking an independent consumer-facing release under either intermediate
name.

**Breaking: `better-sqlite3` becomes an optional peer dependency of `./media-providers`, not a
regular dependency.** The concern that originally kept these as two separate packages — a
composio-only consumer being forced to install `better-sqlite3`, a native compiled addon — no
longer applies once both integrations share one package, because `better-sqlite3` is only ever
reached through a dynamic `await import('better-sqlite3')` inside `createSqliteMediaTaskStore`;
every other `./media-providers` export (the dispatch engine, capability registry, in-memory task
store, `renderStub`) never touches it. A consumer who calls `createSqliteMediaTaskStore` must now
`npm install better-sqlite3` themselves; everyone else installs nothing extra. This mirrors
`@jini-ai/admin`'s `react`/`react-dom` optional-peer convention.

No production logic changed — every file moved as-is from
`packages/integrations/{composio,media-providers}/src/**` into
`packages/integrations/src/{composio,media-providers}/**`. `examples/reference-web`, the one real
consumer of `./media-providers` in this workspace, is updated to the new import specifier.

**The standalone published names `@jini-ai/media` (`0.1.2`) and `@jini-ai/composio`
(`0.1.0`, `0.2.0`, `0.2.1`) are retired for good** — neither is versioned forward under its own
identity again. `@jini-ai/composio`'s deprecation was already flagged as a release
follow-up in `fold-composio-into-admin.md` (from the 2026-08-01 fold) and, as far as this workspace
shows, never acted on; it is restated here since it is still outstanding. `@jini-ai/media`'s
deprecation was not previously flagged anywhere. Whoever runs the next release should run both:

```
npm deprecate @jini-ai/media "Renamed and merged into @jini-ai/integrations; import from '@jini-ai/integrations/media-providers' instead."
npm deprecate @jini-ai/composio "Merged into @jini-ai/integrations; import from '@jini-ai/integrations/composio' instead."
```
