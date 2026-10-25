# Changelog

## 0.6.12

### Patch Changes

- consent settings: per-site `'unsafe-eval'` toggle.

## 0.6.11

## 0.6.10

### Patch Changes

- e27fa91: Removed the `./server` export subpath. It held only the Composio integration, which moves back
  out — now `@jini-ai/integrations/composio`, a subpath of `@jini-ai/integrations`
  (`packages/integrations/`; see that package's own changeset for the full history). `jini.entries`
  drops its `"./server": "node"` entry, and the `@jini-ai/protocol` devDependency (which existed only
  for composio's type-only `JsonValue` references) is removed. No other consumer imported
  `@jini-ai/admin/server` — nothing else needs an import-path change.
- cc33cf1: Folded `@jini-ai/composio` into `@jini-ai/admin` as a `./server` subpath, and retired the package.

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

- 82ed2d3: Media, SEO and widgets require FetchQueryProvider. Successful media refreshes clear errors; editor reads request fresh versions. Remove redundant settings-loader/provider reads and limit media invalidation to the library. Retain the exported headless entry-picker controller as deprecated pending owner-approved removal.
- ea8d883: Restore host media-prefix invalidation while isolating provider queries, and validate single-owner SEO form reads.
- ea8d883: Skip cross-origin image HEAD probes, translate social image warnings through the SEO translator, and use the existing warning notice class.
- 1c5d476: Hydrate reopened SEO forms from the fresh settings read through the shared query loader so cached default values cannot hide newer settings.

## 0.4.13 — 2026-10-22

- 2026-10-22: Consent banner editor sections and preview, redirect list fixes, media lightbox via @jini-ai/ui, media provider tab fixes, coverage.

## 0.4.12 — 2026-10-16

- SEO: searchable entry picker and grouped per-entry form (6c128f9d); image fields name the file, styled analysis, slug for same-titled entries (bc1dbf0d); one Social preview section with an optional "Customize for X" (ff1a709f); X/Twitter labels, file names with extensions, muted inherited site-default image (4919371d); "Using image from page content" when the share image comes from the page (746457d9).
- Peers: `@jini-ai/ui` `^0.5.5` (grouped Select) and `@jini-ai/cms` `^0.5.13` (share-image source).

## 0.4.11 — 2026-10-14

- `FieldAttributesDialog` and `SitemapModal` use the neutral `jini-domain-dialog` class instead of a host-named one; hosts style `.jini-domain-dialog` (47b9fa4f).
- Rides along, no API change: forms option row keys come from the editor's own row list instead of a module-level counter (6281ddc8); redirects imports its shared widgets directly instead of the React barrel (9b45c742); comment scrubs (8e508fb6, 6281ddc8).

## 0.4.10 — 2026-10-13

- Forms HTML starter: URL fields emit `type="text"` plus the registry's URL hints (`inputmode`, `autocomplete`, `spellcheck`, `autocapitalize`), so bare domains such as `tovu.dev` are no longer refused by the browser. CMS peer floor ^0.5.11.

## 0.4.9 — 2026-10-13

- Sitemap modal: Regenerate no longer reads `/sitemap.xml` twice. The regenerate mutation already invalidates the cached sitemap read (since 1c5d476f), so the modal's extra refetch is gone; the modal still shows the fresh XML after a successful regenerate and keeps the old XML after a failed one.

## 0.4.8 — 2026-10-13

- Share-image warning checks decoded size against 1200×630 (width and height independently; was width ≥ 600). New copy key: `The share image is only {height} px tall; use an image at least 630 px tall.`; the width key now says 1200 px.
- SEO rules import `interpolate` from the universal `@jini-ai/ui/i18n`, so the SEO entries stay React-free. UI peer floor ^0.5.1.

## 0.4.7 — 2026-10-13

- Accept UI ^0.5.0 for the chart contract extraction.

## 0.4.4 — 2026-10-08

- Desktop 0.1.13 release fixes: see commits a2659d24 (admin), 5695a7c3 (chat, agent-runtime), 8ad4ac5c (devops).

## 0.4.3

### Patch Changes

- Tovu clean-up release (2026-10-08): code Tovu moved into Jini, plus the Jini clean-up (see the commit log since 0.4.2).

## 0.4.2 — 2026-10-05

- Catalog provider settings: on a host without `saveChanges`, a provider the last read did not return (a catalog-only provider's first key or settings) is now written instead of silently dropped while the tab reported Saved.
- `RowMenu`: positioning and click-outside are tracked from the menu's callback ref (`trackOpenMenu`); `RowMenuState` is an exported interface and its `menuRef` accepts both callback and object refs. Behavior unchanged.
- Entity fields: both `Select`s share one `selectTranslate` adapter, so the boolean field's `Select` copy also goes through the host dictionary.

## 0.4.1 — 2026-10-04

- Media cards show the original file size and upload date (`formatUploadDate` exported from the media barrel); a null size is hidden.
- Menu ports accept entry targets with an optional `lastKnownHref`.
- Internal `@jini-ai/*` dependencies are caret ranges (`workspace:^`) instead of exact pins, so a host on a newer patch resolves a single copy without an override.

## 0.4.0 — 2026-10-02

### BREAKING

- Shell copy is host-neutral and public APIs use object argument contracts; theme/process handoffs are archived.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

## Unreleased

- Add portable Forms admin screens, HTTP/memory adapters and core-port conformance under ./forms\*.
- Add composable comments admin queue/settings module with HTTP and memory adapters and API conformance.
- Add portable redirects admin module, React list, HTTP/memory adapters and API conformance.
- Add portable SEO admin settings, sitemap viewer, entry overrides and analysis with HTTP/memory adapters and API conformance.
- Add composable widgets admin screens, headless controllers, HTTP/memory adapters and API conformance.
- Media Providers tab on hosts without `saveChanges`: saving the first key or
  settings of a catalog provider the last read did not return now writes them
  (previously nothing was written, yet the tab showed "Saved").
- Fix strict compilation of entity tables and integration/session test fixtures
  with explicit row, deferred-promise and tuple types. Runtime behavior and test
  assertions are unchanged.

- Replace the removed connector integration import guidance with host-owned connector ports. Keep the allowed React agentic helpers in their original package.

- Adopt shared kernel contracts and preserve the module rationale in neutral documentation.

- Complete object-argument calls in Sidebar, RowMenu and ConfirmDialog, preserving
  preferences, routing, tone precedence, selection and agent handle behavior.
- Merge every per-request `HeadersInit` form through `Headers`, with case-insensitive
  overrides and no input mutation. Clarify host-owned route factories, restore
  ceremony inputs and the need for a host restore capability before offering media undo.
- Add caller and header regression tests; execution is deferred by owner directive.

- Restore the HTTP transport's 60-second deadline with a `timeoutMs` override and
  caller-signal precedence. Restore typed network/timeout and unparseable-5xx
  failures with neutral API messages; inject page-unload detection through the host.
- Expose success response headers through `request`'s optional `onOk({ response })`
  observer, preserving JSON return values for ETag / If-Match route adapters.
- Honor `defaultPanelId` in dashboard navigation and agent-page maps while keeping
  the conventional dashboard-root default. Clear local authentication after failed
  logout so a session-error retry cannot restore the old principal.
- Add regression tests for these audit fixes; execution is deferred by owner directive.

- Add a manifest-driven AdminShell with injected session/navigation ports, host API
  and workspace scope, feature contributions and persistent assistant-pane slots.
- Add a query-preserving shell navigation adapter and generalized shell regression
  tests. Barrel/subpath wiring and verification remain coordinator follow-ups.

### Admin extraction integration

- Wire `./react/shell`, `./react/entities`, and `./browser/shell-navigation` with
  browser runtime metadata, and expose their APIs through the existing barrels.
  Export the framework-free shell contracts from the core and ports barrels.
- Add generic entity index, list, detail and create/edit screens over the entity
  port, with injected translation/navigation and AdminShell route contributions.
- BREAKING: Admin helpers, error constructors, client/transport factories, browser
  navigation and converted service-port methods now take required and optional
  argument objects. Fetch, browser and preference persistence dependencies are
  injected ports. Pass `{}` for input-free and optional-only service-port methods,
  and update custom route factories and injected component hooks.
- Integration verification is pending. The active Sidebar/RowMenu and entity/menu
  port owners must finish their remaining convention changes before release.
- BREAKING: Embed marker helpers take `{ el }`; the React editor adapts these
  object APIs to the upstream editor callback contracts without changing markers.
