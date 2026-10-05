# Changelog

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
