# @jini-ai/http-kit

## 0.4.1

### Patch Changes

- Tovu clean-up release (2026-10-08): code Tovu moved into Jini, plus the Jini clean-up (see the commit log since 0.4.0).

## 0.4.0 — 2026-10-02

### BREAKING

- Domain settings and daemon route packs moved to cms/http/settings and daemon/http. Origin validation is canonical in core and the read-only tool gate belongs to daemon.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

## Unreleased

### Build compatibility

- Align HTTP pack test registrars with core's second-argument contributions API
  and supply the required origin environment variable names in the guard fixture.

### BREAKING — capability-owned HTTP

- Daemon route packs, helpers and the live route manifest move to `@jini-ai/daemon/http`.
- Read-only policy moves to `@jini-ai/daemon/read-only-tools`; delegated policy facades and
  `./read-only-tools` / `./run-credentials` entries are removed.
- Runtime dependencies no longer include daemon or agent-runtime. Generic request, response
  and origin primitives are public for capability-owned packs.

### HTTP transport consolidation

- BREAKING: Move settings routes, contracts and CMS adapters from `./settings` and the
  root barrel to `@jini-ai/cms/http/settings`; remove the CMS dependency.
- BREAKING: Origin helpers now use core's `{ config, env }` API. Guard contexts require
  explicit environments and host-selected allowed-origin, web-port and bind-host variable names.
  Bearer middleware requires its environment and token configuration in argument one.
  Strict bearer options contain only path exemptions; ambient environment defaults are removed.
- BREAKING: Remove the compat `sendApiError` and root `sendCompatApiError` writer.
  Use `sendApiError({ res, status, error })` with the retained error constructors.
- BREAKING: Rename verified-origin's `OriginContext` to `VerifiedOriginRequestContext`;
  rate limiter clocks implement core `nowMs()` instead of `nowIso()`.
- Reuse core `Result` and bind core's timing-safe comparison port to Node crypto under
  the existing public `timingSafeTokenMatch` name.
- BREAKING: DB tool registration reads only operations from argument one; policy,
  confirmation and timeout come exclusively from argument two.
- Preserve async limiting and invalid-key rejection. Regression and parity tests written;
  verification deferred by owner directive.

### HTTP contract corrections

- Fix delegated-tool read-only preflight forwarding so unverified registrations
  retain the shared fail-closed refusal.
- Reject query, fragment and backslash delimiters in local daemon authorities
  before URL parsing can discard or reinterpret them.
- Finish the DB, memory and tool-catalog argument conversion, including route
  handlers and helper/port calls. Native event-emitter methods retain their ABI.
  DB factory options now work in argument two; inline options remain supported.
- Return isolated route-inventory entries and use the documented default of 20
  for negative routine-history limits instead of clamping them to 1.
- Correct pack callback, route-spec construction and attachment rejection docs;
  classified server failures remain redacted. Regression tests are written but
  unrun under the owner's directive. No version bump.

### Integration of extracted subpaths

- Complete the Node export/runtime map and root barrels for `./rate-limit`,
  `./middleware`, `./read-only-tools`, `./settings`, `./verified-origin`,
  `./run-credentials`, and `./observability`. Settings uses the existing CMS
  contracts through a new `@jini-ai/cms` dependency; lockfile reconciliation is pending.
- Add Express adapters for daemon authorization, delegated-body binding, ownership
  and scoped listing over injected policies, plus request tracking over injected hooks.
- Reconcile protocol error helpers, core read-only classification, payment options,
  media-generation options and cancellation context forwarding. No version bump.

### BREAKING

- Existing public functions, factories, constructors, route handlers and local
  ports now use required argument objects and optional argument objects. Call
  handlers with `({ input, deps }, { signal? })`; call registrars with
  `({ app, deps, adapter })`. Export names and response/event formats remain unchanged.
  The earlier signature-compatibility note above predates this conversion.
- Payment ports accept charge fields followed by optional description; media
  engines accept `{ surface, model }` followed by generation options. Read-only
  ID generators accept `{}`. Verified-origin errors take `{ message }`.
- Protected `db-ops.ts`, `memory.ts` and `tool-catalog.ts` previously required
  their owner-lane conversion; the HTTP contract corrections above complete it.
  This source integration has not been tested or built; resolve the remaining
  consumer handoff in `INTEGRATION-http-kit.md` before publishing.

- Add `./rate-limit` with fixed-window budgets, periodic stale-key eviction,
  required clock/async counter-store ports, and explicit client-IP trust policy.
- Add `./middleware` with a parsed-JSON byte limit and required host response wording.
- Add `./read-only-tools` with required registry, executor, denial-ID and message
  ports. Consolidate route and nested-dispatch checks into one fail-closed rule;
  existing delegated-tool names, signatures and messages remain compatible.

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
  - @jini-ai/daemon@0.2.1
  - @jini-ai/agent-runtime@0.2.1
  - @jini-ai/platform@0.1.2

## 0.2.0

### Minor Changes

- e181b22: Enforce flat-package domain/runtime/admission metadata, invert optional capability dependencies,
  inject failure-contained run-stream encoders, clean up provisional replay subscribers, and add a
  neutral node-host HTTP-extension composition seam.
- 0d15314: Add a neutral Composer footer slot for host-owned controls, forward an optional host-selected model through every AgentExecutor runtime transport, expose daemon-owned live agent/model discovery with an explicit rescan route, and recognize Claude Code's partial-stream `message_delta` turn boundary so successful stream-json runs close cleanly.

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
- Updated dependencies [e181b22]
- Updated dependencies [0d15314]
  - @jini-ai/protocol@0.1.1
  - @jini-ai/core@0.1.1
  - @jini-ai/platform@0.1.1
  - @jini-ai/agent-runtime@0.2.0
  - @jini-ai/daemon@0.2.0
