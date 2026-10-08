## 0.4.2 — 2026-10-08

- Tovu clean-up release: code Tovu moved into Jini, plus the Jini clean-up (see the commit log).

## 0.4.1 — 2026-10-06

- `status` events carry an optional `sessionId` (agent CLI session/thread locator) so hosts can checkpoint before the terminal event.
- `@jini-ai/core` dep is `workspace:^`.

# @jini-ai/protocol

## 0.4.0 — 2026-10-02

### BREAKING

- Import primitive JSON/time types from core/primitives; the protocol no longer redeclares or re-exports its old JSON vocabulary.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

## Unreleased

- Depend on `@jini-ai/core` for canonical JSON primitives. Wire payloads and all Zod schemas
  remain unchanged; error-details and run-context callers now import the shared types directly.
- BREAKING: Remove `JsonPrimitive`/`JsonValue` declarations and re-exports from protocol.
  Import JSON types from `@jini-ai/core/primitives` instead. No compatibility aliases.


- Reject resolved registry verification metadata unless verified is explicitly true, and clarify
  MCP content-array forwarding in the human-surface isolation rationale. Regression tests are
  written, not run (owner directive).

### Integration completion

- Complete the previously deferred `EventLog` conversion. The earlier pending note
  below describes the initial handoff and is superseded by this entry.
- BREAKING: `append({ runId, event, data }, { dedupeKey? }?)`,
  `replay({ runId, afterCursor })`, `listRunIds({})`, and `drop({ runId })` replace
  the mixed/positional port signatures. Add root-exported `EventLogAppendOptions`.
- The root remains the only JavaScript entry, with explicit universal runtime metadata.
  Update usage docs and add event-log type-contract and package-wide neutrality tests.
  No dependency or version changes; wire payloads remain unchanged.

### BREAKING

- Convert existing helpers to required argument objects: `createApiError({ code,
  message }, optionalArgs)`, `createApiErrorResponse({ error })`,
  `isTerminalRunState({ state })`, `encodeRunContextRef({ payload })`, and
  `decodeRunContextRef({ contextRef })`. Names and wire payloads are unchanged;
  positional compatibility adapters are not provided.
- Convert `RegistryBackend` methods and `RegistryBackendFactory.create` to
  required objects, splitting list/search/resolve/publish options into the second
  object. See `API-CONVENTION.md` for migration shapes and consumer follow-ups.
  `EventLog` conversion remains pending because its source file belongs to an
  in-progress change by another worker.

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
