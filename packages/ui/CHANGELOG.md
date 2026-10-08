# @jini-ai/ui

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
