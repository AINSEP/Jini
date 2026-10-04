# @jini-ai/desktop-host

## 0.4.0 — 2026-10-02

### BREAKING

- Desktop clocks/logging adopt core ports; native updater/navigation ABIs replace custom wrappers. Native macOS speech source remains an explicit runtime export.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

## Unreleased

- Compile the macOS speech helper through the asynchronous `execFileAsync` port, and await it in availability/transcription. Concurrent first-use calls share compilation so Electron's main thread stays responsive while Swift builds the helper.
- **BREAKING:** `ensureHelperCompiled` now returns `Promise<CompileResult>` and requires `execFileAsync`. Its optional legacy `spawnSync` dependency is accepted for source compatibility but never invoked.
- Repair desktop-host test fixture types for filesystem options, legacy popup registration, mutable updater flags, single-instance notifications, IPC rejections and native toolchain errors without changing their assertions.
- **BREAKING:** Replace `HostLogger` with core `Logger`; import the type from `@jini-ai/core/primitives`. File logging accepts the optional `error` bag and records its normalized value.
- Accept native Electron navigation and electron-updater callback ABIs directly. Keep the existing object registrations as union members (`LegacyNavigableContents`, `LegacyUpdaterLike`) while hosts remove their glue.
- Controller clocks use core `Clock`, with the legacy `now` callback retained. Export `createElectronUpdaterAdapter`, `createNodeUpdateTimers`, `defaultUpdateMessages` and `defaultUpdateTiming`. Node timers and reference timing/copy are defaults; hosts may override them in parameter two. Reference timeout values are unchanged.


### Desktop host integration

- Publish `./electron/usability`, `./speech`, and `./speech/macos` alongside
  `./shutdown`, `./electron/navigation-policy`, `./electron/updates`, and
  `./node-toolchain`. Declare all subpath runtimes and ship the native Swift helper
  at `./speech/macos/speech-helper.swift`; the build copies it into `dist`.
- **BREAKING:** Existing functions, factories, constructors, and injected
  Electron/Tauri/filesystem/timer ports now take a required-arguments object and
  an optional-arguments object. Optional-only APIs take `{}` first; zero-input
  lifecycle methods remain parameterless. Export names are preserved and only the updater/navigation migration above retains legacy registration unions. Bridge validation narrows `args.value`;
  file loggers accept an optional object-argument append port.
- **BREAKING:** Usability and speech ports, menu callbacks, sender guards, path
  joiners, and native transcriber process/filesystem bindings use object arguments
  too. Host adapters translate native callbacks and preserve IPC channel payloads.
  Add package integration contracts and adapt the generalized characterization
  fixtures without changing their behavioral assertions.
- No version or dependency changes. Verification is not run by owner directive.


- Add `./shutdown`, `./electron/navigation-policy`, `./electron/updates`, and
  `./node-toolchain` with required input objects and injected host ports. Updates
  permit multiple running instances and install only when no sibling remains.
  Existing exports and version remain unchanged.
- Add generalized policy and adapter tests, deterministic timer/failure cases,
  and a runtime-source neutrality guard.

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
  - @jini-ai/core@0.1.2

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
  - @jini-ai/core@0.1.1
