## 0.5.4 — pending release

- Re-export the canonical core surface-exchange contracts and parameter constants. Store and ask/report behavior are unchanged; requires core 0.4.2.

## 0.5.3 — 2026-10-06

- Message attachments reach every runtime: new `prepareMessageAttachments` / `messageContentWithImages` (+ `MessageAttachmentImage`, `MessageAttachmentSource`, `MessageAttachmentReader`) turn claimed refs into image pixels for providers and a file notice for non-images.
- `AttachmentStore.listPendingForOwner({ ownerId }, { runId })`: with the claiming `runId`, that run's own claimed attachments stay discoverable (owner match still required); without it, behavior is unchanged.
- The agent executor reports the CLI session id on an early `status` event so hosts can checkpoint a run before it ends; run lifecycle carries it through.
- Requires `@jini-ai/protocol` ^0.4.1 and `@jini-ai/agent-runtime` ^0.4.1.

## 0.5.2 — 2026-10-06

- No slow-run notice while a delegated tool waits on a surface: the first `emitSurface` of a call suspends the notice and the call's end resumes it. Suspensions are counted, so with two calls in flight the first to finish does not re-arm the notice over the other's open form; `resume()` drops suspensions left by an ended run.

## 0.5.1 — 2026-10-05

- The `@jini-ai/db` peer range is `^0.2.0 || ^0.3.0` (daemon uses only db's kernel and store entries, which 0.3.0 leaves unchanged), so a host on db 0.3.0 installs without a peer conflict.
- Internal `@jini-ai/*` runtime dependencies are caret ranges (`workspace:^`) instead of exact pins.

## Unreleased (shipped in 0.5.0)

### Fixes

- Keep packed session-store test fixtures within daemon's source root, use the SQLite driver's zero-argument close API, and declare PostgreSQL test types with `@types/pg`.

- Align parser feeds, event sinks, run streams, attachment matchers and OAuth cache construction with current dependency APIs.
- Omit absent optional arguments under strict TypeScript checking; restore lifecycle event input, terminal options and the delegated `tool_result` discriminant.
- Compile tests alongside source and update test fixtures to current callback and argument contracts without removing assertions.

## 0.5.0 — 2026-10-02

### BREAKING

- Daemon HTTP route packs and read-only tools now belong to this package. Run services use concept subpaths, optional HTTP peers and canonical core contracts.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

### BREAKING — HTTP and run coordination ownership

- Add optional `./http` with route packs moved from HTTP kit, plus `./read-only-tools`.
- Remove delegated policy facades; use real policy exports with host messages and core IDs.
- Run coordination modules use concept paths. Surface exchanges take core Clock/IdGenerator;
  the Node credential adapter uses core token comparison. Database-lane object APIs reconciled.
- HTTP kit and Express are optional HTTP peers; chat is test-only.

- BREAKING: All three session-store factories and SQLite event logs accept optional core `Clock` through `{ clock }` instead of `{ now }`, preserving system-time defaults.

## 0.4.0 (unpublished release candidate)

- Session-id adapters and the SQLite event log move to dedicated store subpaths; all database connections are injected.

# @jini-ai/daemon

## 0.2.1

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
  - @jini-ai/protocol@0.1.2
  - @jini-ai/core@0.1.2
  - @jini-ai/agent-runtime@0.2.1
  - @jini-ai/platform@0.1.2

## 0.2.0

### Minor Changes

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

- 0d15314: Add a neutral Composer footer slot for host-owned controls, forward an optional host-selected model through every AgentExecutor runtime transport, expose daemon-owned live agent/model discovery with an explicit rescan route, and recognize Claude Code's partial-stream `message_delta` turn boundary so successful stream-json runs close cleanly.

### Patch Changes

- e181b22: Enforce flat-package domain/runtime/admission metadata, invert optional capability dependencies,
  inject failure-contained run-stream encoders, clean up provisional replay subscribers, and add a
  neutral node-host HTTP-extension composition seam.
- Updated dependencies
- Updated dependencies [0d15314]
  - @jini-ai/protocol@0.1.1
  - @jini-ai/core@0.1.1
  - @jini-ai/platform@0.1.1
  - @jini-ai/agent-runtime@0.2.0

## Unreleased — C2 concern ownership

- Add audit, held surface-exchange, session-coordination, live-run credential and ownership subpaths; convert daemon calls to required/optional object arguments and inject host ports.
- Make watchdog cancellation permanent and agent permission defaults restricted, with explicit bypass and invalid-mode rejection.

- Added isolated SQLite event-log and rich legacy session entries with host injection.
- Added neutral session-id port, in-memory store and shared-kernel SQLite/PGlite/Postgres adapters.
- Preserved durable cursor validation, default cap 2000, dedupe/restart/media semantics.
