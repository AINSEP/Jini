# `@jini-ai/integrations`

Third-party vendor integrations, grouped as subpath exports of one package rather than two separate
packages: `./composio` (OAuth-authenticated tool-connector catalog discovery and execution) and
`./media-providers` (multi-vendor image/video/audio generation gateway). An npm package name allows
only one slash (`@scope/name`), so the literal import paths `@jini-ai/integrations/composio` and
`@jini-ai/integrations/media-providers` require exactly this shape — one package, two subpath
exports — not two packages living under a shared directory.

## No root `.` export

There is deliberately no `.` export and no `main`/`types` field pointing at a barrel. Neither
subpath is "the default," and a root barrel re-exporting both would pull `./media-providers`'s code
into a `./composio`-only consumer's bundle — exactly the coupling this restructure exists to avoid.
`typesVersions` covers legacy TypeScript `moduleResolution: "node"` (node10) consumers, which ignore
`package.json#exports` entirely and would otherwise fail to resolve either subpath's `.d.ts` even
though `exports` itself resolves fine at runtime — the same class of node10 gap several packages in
this workspace hit and fixed with a `main`/`types` pair (see their `CHANGELOG.md` 0.1.2 entries);
`typesVersions` is this package's equivalent fix for a package with no single default entry to point
`main`/`types` at.

## `./composio`

OAuth-authenticated Composio connector catalog discovery and execution. No runtime dependency
beyond `@jini-ai/protocol` (a devDependency only — every reference is `import type { JsonValue }`).
`npm install @jini-ai/integrations` is enough; nothing extra to add. See `src/composio/source-map.md`
for full provenance.

## `./media-providers`

A gateway for generating images, video, and audio across many vendors behind one call — capability
registry, multi-vendor REST dispatch, policy and staging ports, and an optional SQLite task store.
See `src/media-providers/README.md` for the full feature list and `src/media-providers/source-map.md`
for provenance.

`better-sqlite3` (a native compiled addon) is an **optional peer dependency**, not a regular one.
Everything in `./media-providers` works without it — `renderStub`, the dispatch engine, the
capability registry, the in-memory task store — because the only code that touches it,
`createSqliteMediaTaskStore`, reaches it through a dynamic `await import('better-sqlite3')` inside
that one function, never a static import. Only a consumer that actually calls
`createSqliteMediaTaskStore` needs to `npm install better-sqlite3` themselves. This is the same
convention `@jini-ai/admin`'s `react`/`react-dom` optional peers use (see its README's "Layers"
section) and `packages/README.md`'s "Optional peer dependencies" table documents workspace-wide.

## Why one package, not two

The two integrations used to be separate packages specifically so a composio-only consumer would
never be forced to install `better-sqlite3`. Making `better-sqlite3` an optional peer solves that
same problem without needing two packages, so they collapsed into subpaths of one — matching the
literal `@jini-ai/integrations/composio` / `@jini-ai/integrations/media-providers` import paths a
single npm package name can produce but two package names cannot.
