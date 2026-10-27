# @jini-ai/ui

## 0.6.13

### Patch Changes

- 0728914: Engine guard clean-up (`pnpm guard` 106 -> 0): layer, subpath-isolation and module-state findings fixed by moving
  shared contracts to their owners instead of reaching across domains. Additive public API: `@jini-ai/core/filesystem`
  (guarded-reader contracts), `useFetchQueryScope` from `@jini-ai/ui` fetch-query (per-provider query scope),
  `@jini-ai/chat/react` re-exports of the accepted-input, run-state and agent-plugin chat-state helpers. The Claude
  filesystem probe cache in `@jini-ai/agent-runtime` is instance-owned. No behaviour change intended; host-facing
  breaks are listed in `owner-store-to-server` and `guard-host-ports`.
- 0a2b903: Share accessible eye toggles across React credential fields, including multiline question answers,
  CLI overrides, provider keys, login, new users, password resets, and source configuration. Preserve
  autofill protection, translated toggle names, agent handles, and secret-answer redaction. Hidden
  source environment blocks keep names visible and stored values masked until explicitly revealed.

  Chat and user-management require `@jini-ai/ui ^0.5.7` for the new `SecretInput` and `SecretTextarea`
  exports. Release UI 0.5.7 (or adjust those peer floors to the actual release containing these exports)
  with these consumers; older UI versions cannot satisfy their imports. Hosts supply `.jini-secret`,
  `.jini-secret-toggle`, and `.jini-secret--multiline` visual rules.

- 01de8c4: Allow the built-in fetch-query provider to accept core clock and scheduler ports while retaining existing timing defaults and provider-scoped cleanup.
- Updated dependencies [7479159]
- Updated dependencies [c31264d]
- Updated dependencies [0728914]
- Updated dependencies [6ecbdb2]
- Updated dependencies [63bacc5]
  - @jini-ai/core@0.6.13

## 0.6.12

### Patch Changes

- @jini-ai/core@0.6.12

## 0.6.11

### Patch Changes

- Style variables no longer reference the deleted payments and charts packages.
- Updated dependencies
- Updated dependencies
  - @jini-ai/core@0.6.11

## 0.6.10

### Patch Changes

- 72ea04d: Folded `@jini-ai/renderers-react` into `@jini-ai/ui` as an independently-importable, tree-shakeable
  `./renderers` subpath, and retired the package.

  Real (non-comment) imports of `@jini-ai/renderers-react` anywhere in the repo were exactly 3 files,
  2 symbols, all inside `@jini-ai/ui`'s own `features/html-viewer` — `openSandboxedPreviewInNewTab`
  and `useSandboxBridge`. `@jini-ai/ui` was already the package's only real consumer, so a standalone
  package bought nothing, the same reasoning that folded `@jini-ai/ui-core` into `./core` and
  `@jini-ai/composio` into `@jini-ai/admin`. The whole `src/**` tree (registry, renderers, srcDoc
  host, annotation-canvas, preview-modal-shell, i18n) moves to `packages/ui/src/renderers/` as one
  `git mv`, unchanged in shape; `html-viewer`'s two consumers switch from the package-qualified
  import to a relative one, since they're now in the same package.

  **The `@jini-ai/renderers-react → @jini-ai/chat` dependency was dropped first, before the move,
  not after.** `registry.ts` imported `ArtifactManifest`/`inferLegacyManifest` from `@jini-ai/chat`,
  and `types.ts` re-exported five manifest types from there. `@jini-ai/chat` already depends on
  `@jini-ai/ui`, so folding renderers-react into `ui` unchanged would have created a real `ui ↔ chat`
  package cycle. The five manifest types (`ArtifactManifest`, `ArtifactKind`, `ArtifactRendererId`,
  `ArtifactExportKind`, `ArtifactStatus`) are now defined locally in `types.ts`, copied verbatim from
  `@jini-ai/chat`'s `src/core/util/types.ts` — a small duplicated-type cost, accepted because a
  renderer package must not depend on a chat package.

  **`resolveArtifactManifest` no longer infers a legacy manifest from a file's name/extension** — a
  real, disclosed API behavior change. It now returns `file.manifest ?? null`. Manifest inference
  (guessing kind/renderer from `.md`/`.html`/`.svg`/`.tsx`, etc.) is a caller concern that depends on
  a product's own naming conventions, not something a generic renderer registry should do on a
  caller's behalf; a caller that still wants that inference should resolve a manifest for the file
  itself (see `@jini-ai/chat`'s `inferLegacyManifest`) before handing it to this registry. Verified
  zero external callers of `RendererRegistry`/`resolveArtifactManifest`/`createDefaultRendererRegistry`
  anywhere in Jini or Tovu before making this change — `@jini-ai/chat`'s own `RendererRegistry` is an
  unrelated, locally-defined class in `artifact-types.ts`, and `@jini-ai/artifacts`' own
  `resolveArtifactManifest` is an unrelated 3-argument function; both are same-name coincidences, not
  real dependents. The four bundled renderers (`HtmlRenderer`, `MarkdownRenderer`, `SvgRenderer`,
  `ReactComponentRenderer`) gate `canRender` on a resolvable manifest before falling back to any
  `file.kind`/extension heuristic of their own, so this ripples into every test that exercised
  default-registry routing via a bare file name with no explicit `manifest` — all updated to attach
  one, with the extension-inference-specific assertions flipped to assert the removed behavior no
  longer fires. No test was weakened or deleted: every changed assertion now tests the new,
  documented contract, or restores a manifest to keep testing what it always meant to test.

  **`@jini-ai/renderers-react` is retired, not versioned forward.** It was published (0.1.2), and
  `packages/renderers-react` is deleted from this workspace. Deleting the source does not unpublish
  anything, so whoever runs the next release should follow up with:

  ```
  npm deprecate @jini-ai/renderers-react "Merged into @jini-ai/ui; import from '@jini-ai/ui/renderers' instead."
  ```

  `@jini-ai/chat`'s dead `@jini-ai/renderers-react` dependency (declared, never imported — its own
  `react/artifact-types.ts` defines a local placeholder registry instead, per its
  `TODO(renderers-react)` header, left untouched here as out of scope) is removed from its
  `package.json`, hence the accompanying patch bump.

- 4082999: Folded `@jini-ai/ui-core` into `@jini-ai/ui` as an independently-importable `./core` subpath.

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

- 82ed2d3: Remove private fetch-query shims and point deprecated public type re-exports directly at core. Memory wired hooks require MemoryPortsProvider; deprecated REST/demo singletons remain explicit compatibility bindings pending a breaking-release removal.
- ea8d883: Remove obsolete fetch-query build shims and replace prose checks with runtime and type contract coverage.
- Updated dependencies [22f0619]
- Updated dependencies [82ed2d3]
- Updated dependencies [5a3de86]
  - @jini-ai/core@0.6.10

## 0.5.6 — 2026-10-22

- 2026-10-22: MCP-UI question cards follow dark hosts, optional useCachedLoader fetch, trust options, html-editor fallbacks removed, coverage.

## 0.5.5 — 2026-10-16

- `admin-widgets` Select paints group headings and per-option badges (dc770a41) and is pane-aware; image fields name the file (bc1dbf0d).
- The preview modal's default exit-fullscreen icon draws inward arrows (ef161bf1).
- `execution`: the Claude Code model picker lists each model once, by name (4b3b894b, 0ae46113).

## 0.5.4 — 2026-10-15

- `TabBar` re-scrolls the active tab into view once web fonts are ready (06931dfe): fonts that widen tabs after the first measurement no longer leave a deep-linked tab cut off at the strip edge.

## 0.5.3 — 2026-10-14

- New `./preview-modal-shell` subpath exporting `PreviewModalShell` without the whole `./renderers` barrel (Markdown, artifact views, annotation canvas); it still includes its sandboxed HTML renderer and parser (ec060014).

## 0.5.2 — 2026-10-13

- MCP-UI surfaces follow the host's live theme (da019dde): `McpUiHost` reads the host's resolved `--jini-*` theme where a card mounts and writes it into Jini-built surface documents as a `:root` rule after the token block; a MutationObserver re-themes cards already on screen when the theme or accent changes. Third-party Views are not rewritten. Builder token overrides render as `:root:root`, so a card that sets its own tokens keeps them. New `--jini-mcpui-accent-ink` token (host `--jini-primary-ink`) for primary button text.
- Rides along, no API change: interactive-ui/charts shared code declared as isolation-shared metadata instead of a file move (28e84348 moved it, bc2945ee reverted the move); html-editor lookup sets are `ReadonlySet` (27965ef0); comment scrubs (8e508fb6).

## 0.5.1 — 2026-10-13

- Phone layout fixes. Media provider cards put one field per line on phones and keep the fields plus Clear on one row on wider screens (was a three-column grid that squeezed inputs to a few characters). The snippet block's Copy button no longer covers the command: phones start the code below it, wider screens reserve its width. `TabBar` scrolls a sideways-scrolling strip so the active tab is fully visible (only the strip scrolls, never the page).
- HTML viewer imports `renderers/new-tab-preview` and `renderers/sandbox-bridge` directly instead of the renderer barrel (no Markdown renderers or srcdoc assembly in its closure).
- New universal `./i18n` subpath re-exporting `interpolate` from the existing template-i18n owner.
- TanStack fetch-query adapter: replacement writes win at TanStack's save boundary, so an older read that settles after `replace()` can no longer overwrite it (hook data, loaders and `peek()` keep their public types).

## 0.5.0 — 2026-10-13

- Add framework-neutral chart contracts, browser/table and React hosts, provider-defined kinds and legacy chart wire aliases. Extract Recharts implementations and peers into the private browser artifact; chart component export wrappers are removed (no external consumers found).

## 0.4.6 — 2026-10-08

- parse5 optional peer widened to `^7.3.0 || ^8.0.1`: 0.4.5 required ^8 while @jini-ai/cms 0.5.3 requires ^7.3, so hosts with both hit ERESOLVE. The srcdoc builder and html-editor source splice typecheck against parse5 7.

## 0.4.5 — pending release

- Add universal `./mcp-ui/secret-card`: `defineSecretCardTool` owns fail-closed emission, cancellation, blank-secret policy, exact-byte submission and safe save-failure reporting. Specs retain domain validation, copy, dynamic fields, persistence and result projections.
- Inject the daemon's existing `askThenReport` alongside the store; core owns the shared exchange ABI. No daemon or React runtime dependency in this entry.
- Requires core 0.4.2; build and publish the release set before consumer adoption.

## 0.4.4 — 2026-10-06

- Recharts charts paint with host chart tokens `--jini-chart-1..6` / `-grid` / `-axis` / `-cursor` / `-surface` / `-text`, each falling back to a base token; a host that sets no `--jini-chart-N` gets the new warm orange `--jini-chart-default-1..6` palette (light and dark) instead of `--jini-primary`.
- Behavior change: grid and axis use `--jini-border`/`--jini-muted`, no vertical grid lines, bars get a 4px rounded top and 64px max width, lines are 2px, and the tooltip uses theme surface/ink with a soft accent hover band.

## 0.4.3 — 2026-10-05

- MCP-UI resources can carry an answer deadline: `createUIResource`/`buildConfirmationSurface` take `expiresAtMs`, written to `MCP_UI_EXPIRES_AT_META_KEY`; `readExpiresAt` reads it back (undefined when absent or not a finite number).

## 0.4.2 — 2026-10-04

- Internal `@jini-ai/*` dependencies are caret ranges (`workspace:^`) instead of exact pins, so a host on `@jini-ai/agentic` 0.4.1 or on a newer patch resolves a single copy without an override.

## 0.4.1 — 2026-10-04

- `useFocusTrap` returns focus to the element that held it when the trap activated (the dialog's opener) once the trap closes or deactivates, if that element is still in the document.

## 0.4.0 — 2026-10-02

### BREAKING

- Query cache clocks use core and browser fetch is injected. Product theme/process documents are archived; stylesheet exports remain explicit side effects.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

## Unreleased

- Publish the browser entry `@jini-ai/ui/tab-strip` with types and ESM output from
  the existing feature barrel, including `TabBar` and `TabBarTab`.

- Align A2UI catalog/clock fixtures and MCP-UI RPC calls with the current agentic API; omit absent optional fetch properties to preserve strict optional-property typing and browser defaults.
- BREAKING: remove the obsolete `A2uiClockPort` type re-export from `/a2ui`; consumers use `Clock` from `@jini-ai/core/primitives`.

- BREAKING: `exportViaHttp` takes `{ exportPath, filenamePrefix }` and optional `{ fetch }`. Browser transports accept native fetch ports and no longer depend on platform; timeout errors now retain native reasons. Add `createMemoryHttpPorts`; neutralize obsolete connector-vendor references.

- Adopt shared kernel contracts and preserve the module rationale in neutral documentation.
- BREAKING: replace package-local clock contracts with core Clock.nowMs().

### UI parity fixes

- Keep replacement writes successful when an older read rejects, including their freshness timestamp.
- Wire A2UI actions to each interactive provider's documented callback; custom registry entries may
  declare an optional `actionProp`. Existing unannotated custom table callbacks remain compatible.
- Re-render A2UI descendants and bound data when the root identity is unchanged; cache stable surface
  snapshots so unrelated notifications do not re-render unchanged surfaces.
- Clarify that parked iframes stay in a mounted container and missing crypto fails on token mint.
- Pass notice handles through the current named agent API and use the declared tab-count font token.
- Restart cached background reads on explicit refresh/invalidation; ignore superseded responses,
  invalidate failed reads, reset initial retry errors, and reject undefined query data.
- Pause offline reads and writes, resume them once online, and refresh stale enabled reads on reconnect.
  Connectivity and opt-in focus events are injectable through `FetchQueryEnvironmentPort` on the provider.
  The ten-second freshness, no automatic failure retries, and focus-disabled defaults are unchanged.

### Integrated entry points

- Publish and declare browser runtimes for `/admin-widgets`, `/panel-kit`, `/fetch-query`,
  and `/admin-widgets.css`; `/core`, `/interactive-ui/manifests` and `/mcp-ui/surfaces` are universal. No new dependencies or version bump.
- Align internal agent handle and A2UI interpreter calls with the current agentic ports.
- Use neutral `data-jini-*` canvas markers for transient editor chrome.

### BREAKING — public ui argument convention

- Shared clipboard, endpoint, SSE, color/accent and wheel helpers now take named required objects.
- Shared font, debounce, stable-handler, dismissal and global-keydown hooks split required and
  optional objects; effect dependencies can be injected as ports. The font asset URL resolver
  now takes `{ projectId, path }`.
- `InteractiveUiRegistry` constructor and lookup/registration methods,
  `buildA2uiCatalogFromRegistry`, and `AssetTreeClipboardPort.copyToClipboard` take object arguments.
- Admin widget helpers, tab keyboard helpers, dictionary/template helpers and panel hooks take
  required objects and separate optional configuration. The dictionary translator returned by
  `createDictionaryTranslator` takes `{ locale, key }`. Panel controllers take `{ action, describeError }`,
  `{ task }`, or `{ generation }`; dirty confirmation accepts `({}, { unsavedBeyondTracked })`.
- Fetch-query hooks split required key/fetch/run dependencies from optional cache configuration.
  Mutation, invalidation and loader replacement take `{ input }`, `{ key }`, and `{ value }`.
- `RendererRegistry` creation/registration and manifest resolution use named objects; optional
  resolution hints move to the second object, including the renderer matching port.
- Canvas chrome attributes change to `data-jini-*`; hosts selecting the old attributes must update.

- Add generic admin widgets with opt-in `@jini-ai/ui/admin-widgets.css`, using the existing
  `--jini-*` tokens with standalone fallbacks. `TabBar` joins the existing `tab-strip` feature
  and shares its tablist shell; existing `TabStrip` exports and behavior remain available.
- Add a panel kit with focus trapping, unsaved-change protection, async actions, serial writes,
  settlement generations, display helpers, and injected dictionary translators. Translation
  and retry classification are supplied by the host; no product dictionaries or API client move.
- Add a React-only fetch-query adapter behind `@jini-ai/ui/fetch-query` and `/panel-kit`,
  preserving the keyed query contract without a new runtime dependency or optional peer.
  All existing exports remain available; the version is reserved for the wave coordinator.

## 0.1.2

### Patch Changes

- Add top-level `main`/`types` fields alongside the existing `exports` map. A consumer on
  TypeScript's classic `moduleResolution: "node"` (node10) — which ignores `package.json#exports`
  entirely — could not resolve this package's types at all (`TS2307: Cannot find module`) even
  after the previous exports-map fix restored `require()` at runtime; type resolution and runtime
  resolution are separate algorithms. Verified against a real external consumer (whose
  tsconfig uses this legacy resolution mode): adding these two fields, with its tsconfig completely
  unchanged, made the error disappear. Also fixes absolute-path `require()` (distinct from a bare
  specifier, which already worked) for the same reason — `main` was previously absent.

  Purely additive: every modern resolver (Node's own runtime `exports` resolution, TypeScript's
  `bundler`/`node16`/`nodenext`) prefers `exports` over `main`/`types` when both are present, so
  this changes nothing for a consumer already on a modern resolver.

- Updated dependencies
  - @jini-ai/renderers-react@0.1.2
  - @jini-ai/agentic@0.1.2

## 0.1.1

### Patch Changes

- Add a `"default"` export condition to every published package's `exports` map — every one of
  them lacked it, which meant `require()` failed with `ERR_PACKAGE_PATH_NOT_EXPORTED` for any
  CommonJS consumer (found via a real external integration attempt; Node needs `require(esm)`
  support, i.e. Node >=22.12, for this to resolve).

  `@jini-ai/agent-runtime`:

  - **New**: `RuntimeBuildOptions.permissionMode` (`'bypass' | 'restricted'`) lets a caller opt a
    run OUT of the auto-approve-every-permission-prompt flag every def with one
    (`bypassPermissions` / `--yolo` / `--dangerously-skip-permissions`) previously pushed
    unconditionally, with no way to turn it off. Omitting it keeps today's default (bypass)
    behavior unchanged.
  - **New**: `ClaudeStreamEvent`, `CopilotStreamEvent`, and `QoderEvent` are now real exported
    discriminated unions instead of `Record<string, unknown>` — a real external consumer guessed a
    nonexistent field name (`event.text` instead of the actual `event.delta`) against the old
    untyped sink and silently lost every streamed token with no compile or runtime error.
  - Fixed a doc/implementation mismatch in `claude-stream.ts`: the module doc claimed `tool_result`
    events carry `{ tool_use_id, content, is_error }`; the actual emitted shape is
    `{ toolUseId, content, isError }`.

  `@jini-ai/daemon`: `AgentExecutorRunInput.permissionMode` forwards the new
  `RuntimeBuildOptions.permissionMode` through to `buildArgs`, so a host can actually reach the new
  opt-out from the daemon's real run-input surface, not just from `@jini-ai/agent-runtime` in
  isolation.

  `@jini-ai/agentic`: `setAtPointer` no longer throws on a malformed (e.g. missing leading `/`)
  `updateDataModel` path — degrades to a no-op like its sibling `getAtPointer`, matching this
  package's own "a bad binding must not crash the renderer" contract. That path is agent-authored
  wire data with no error boundary above it in any host, so the uncaught throw could unmount an
  entire chat UI from ~40 bytes of malformed input.

  `@jini-ai/chat-react`: a local (client-resolved) A2UI button action is no longer a silent no-op —
  `A2uiSurfaceCard` now surfaces the resolved value. New `ExtEventErrorBoundary` confines a
  `kind: 'ext'` event group's renderer to its own card instead of letting a render/effect-phase
  throw from agent-controlled content unmount the whole chat root (there was no error boundary
  anywhere in this package or its hosts before this).

- Updated dependencies
  - @jini-ai/renderers-react@0.1.1
  - @jini-ai/agentic@0.1.1
