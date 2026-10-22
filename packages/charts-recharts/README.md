# Recharts browser-provider artifact

This package is a **private build/test workspace**, never an npm release. Its self-contained
browser artifact owns React, ReactDOM and Recharts and implements the vanilla ABI from
`@jini-ai/ui/charts`. No published Jini package depends on this workspace.

The coordinator builds UI first, then runs this workspace's `build` script. Output:

- `plugin/manifest.json`: provider `plugin.recharts`, version, bar/line/pie capabilities and SHA-256 asset digests.
- `plugin/client/provider.js`: standalone ESM exporting `mount`, with no external module imports.
- `plugin/client/styles.css`: compiled scoped palette/presentation, with no UI CSS imports or global reset.
- `plugin/bundle-meta.json`: build-only review evidence; exclude it from the runtime artifact.

The Tovu adapter supplies its own SDK wrapper and site manifest. It pins the reviewed provider
metadata and **all packaged-file digests** in a compiled-in approval record (including the artifact
manifest and wrapper), then uses the existing plugin activation/loader. Browser asset routes serve
`readBytes({})` from admitted assets, never reread mutable paths. Installed/custom providers remain
forbidden under ADR-025's owner-approved bundled-chart exception.

`mount({ element, spec, theme }, { onError })` returns `ready`, `update({ spec, theme }, {})` and
`destroy({}, {})`. The provider creates its own React root; the page shell needs no shared React.
UI's neutral host retains its styled data table during loading and on failure. This artifact supports
single-series bar/line and named pie data. Unsupported kinds, axes/formats and multiple series
advance to another provider or the table. Public-page integration is deferred.

Wire schemas live in UI (`@jini-ai/ui/charts`); the three `recharts.*` wire IDs are
resolved by the neutral interactive registry, not by a plugin-owned registration lifecycle.
Load provider CSS at the actual transcript/portal boundary. No override/editor UI is included.

Tests use real SVG, tooltip and legend rendering, browser geometry fakes, and the actual neutral
host/catalog. Artifact checks require the coordinator's build first. Bar/line preserve endpoint
labels while thinning overlaps with `preserveStartEnd` and `minTickGap={8}`.
