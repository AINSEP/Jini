## 0.4.3 — 2026-10-08

- Desktop 0.1.13 release fixes: see commits a2659d24 (admin), 5695a7c3 (chat, agent-runtime), 8ad4ac5c (devops).

## 0.4.2 — 2026-10-08

- Tovu clean-up release: code Tovu moved into Jini, plus the Jini clean-up (see the commit log).

## 0.4.1 — 2026-10-06

- Tool turns accept message `images` (`{ mimeType, data }`) and deliver them to providers as image content.
- Runtime `@jini-ai/*` deps are `workspace:^` (pack as caret ranges).

# @jini-ai/agent-runtime

## 0.4.0 — 2026-10-02

### BREAKING

- Use isolated provider and cache subpaths, including ./providers/sse-decode for browsers; core clock/redaction and canonical platform address classifiers replace local contracts. Unloaded bundled skill/craft documents are archived outside the package.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

## Unreleased

### Fixes

- Align parser parity and default-option fixtures with current argument objects and exact optional-property contracts. Preserve manifest fixture tuples and type Google continuation mocks with checked request bodies for strict indexed access.
- Omit the probe environment's absent proxy override so the existing system-proxy default remains active.

### BREAKING — canonical OAuth, redaction and network primitives

- Provider PKCE uses the main OAuth API, explicitly retaining 64-byte verifier entropy; normalized tokens are adapted to the existing persisted provider wire DTO. Main OAuth now guards/bounds fixed-issuer HTTP and returns typed errors; deriveCodeChallenge validates RFC verifiers.
- Remove runtime classifier/redactor exports and local implementations. Import hostname policies from `@jini-ai/platform/net` and `redactSecrets({ input }, { exactSecrets })` from core. Conservative masking keeps model/request identifiers and uses categorized markers; diagnostics never opt into opaque-run masking.
- Model catalog clocks use core `Clock.nowMs()`; ACP unknown-value records are named `UnknownRecord`, not JSON objects.
- Callback payload caches use the main bounded store while retaining exclusive TTL and unref timer behavior. Neutralize host-settings wording and host identity comments. Drop the conversion report from published files; the document remains for later relocation.


- Preserve host environment customization after CLI housekeeping; correct the hook documentation.
- Keep DNS resolver injection required and reject lookup failures or empty answers instead of allowing unpinned fallback.
- Validate model catalogue variants with an explicit `TypeError` before trimming.
- Tag ACP failures before resume acknowledgement with `error.details.kind: 'resume_failed'`, preserving original codes and nesting original details under `cause`.

- Add `./providers/tool-turn` with injected provider adapters, normalized tool results and termination reasons, and Gemini schema adaptation. Existing provider loops and exports are preserved.
- Add `./model-catalog/cache` for instance-owned live discovery, TTL success/failure caching, tenant-safe key tuples, and injected clock/merge ports. Share the single-flight loader with the existing AMR cache.
- Complete the runtime subpaths (`./providers/tool-turn`, `./model-catalog/cache`, and `./providers/sse-decode`) with runtime metadata, declaration mappings, root barrel exports for turns/cache, and API documentation. The cache and SSE decoder can be imported independently in universal runtimes; the provider adapters and root require Node.
- Delegate provider PKCE and pending authorization primitives to `@jini-ai/oauth`, retaining provider contracts and wire formats.
- **BREAKING:** Convert existing public runtime/provider helpers, session factories, cache constructors and methods, runtime-definition callbacks, custom DNS/HTTP/event ports, and stream-feed methods to `(requiredArgs, optionalArgs)` objects. Required inputs are in the first object; optional controls are in the second. Update hosts and port implementations together using `API-CONVERSION-w7.md`. Existing export names and package version are retained; no positional compatibility adapters are provided. React props and upstream standard-library callable contracts are unchanged.
- **BREAKING:** `AcpModelProbe.detectModels` now separates required `{ bin, args }` from optional probe controls, matching `detectAcpModels` and its `probeAcpModels` alias. Custom probes must read environment, timeout, client identity and default model from the second object.

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

- Updated dependencies
  - @jini-ai/platform@0.1.1
