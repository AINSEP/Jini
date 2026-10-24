## 0.6.11

### Patch Changes

- Site agents are confined to the site folder: Claude file tools are bounded to the site root and private temp dir, and attachments are staged inside the site (`stageAttachmentClaim`).
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @jini-ai/core@0.6.11
  - @jini-ai/oauth@0.6.11
  - @jini-ai/protocol@0.6.11

## 0.6.10

### Patch Changes

- 3fe4d14: Parse optional delegated-result markers while preserving the CLI call id and original content for daemon validation.

  Require the co-released protocol package at runtime for its shared marker codec, replacing the optional protocol peer. The workspace dependency follows the protocol release version when Changesets versions the release set.

- aad3d2e: Add the optional `onUnexposedToolCall` refusal hook to `runProviderToolTurn` for all four
  provider protocols. Hosts can await audit writes and supply uniform refusal text without
  calling the normal tool executor. Results remain errors; omitted hooks and `undefined`
  replies preserve the existing refusal text and protocol formatting. Hook failures propagate
  without falling through to execution.
- 8ff5653: Drive Antigravity (`agy`) — the 24th and last agent definition `AgentExecutor` rejected.

  `AgentExecutor` drove 23 of 24 registered definitions. Antigravity was rejected by an explicit
  `def.id === 'antigravity'` guard, for two reasons that are real but narrow:

  - **`agy` can print an OAuth sign-in URL to stdout and still exit 0.** Streaming stdout live shows
    that URL to the user as if it were the model's reply — a URL that carries the daemon operator's
    `client_id`/`redirect_uri` into a chat transcript, and that is useless to click anyway (`agy -p`
    print mode has no field to paste the resulting auth code into).
  - **`agy` has no `--model` flag.** The model choice is written into one process-global
    `~/.gemini/antigravity-cli/settings.json` that `agy` reads on its own startup, so two concurrent
    runs race: run A writes model A, A spawns, B writes model B, and only _then_ does A's `agy` read
    the file — so A silently executes on B's model.

  Both are now met by **declarative `RuntimeAgentDef` fields the executor reads generically**, joining
  the 14 optional behavior flags (`promptViaFile`, `authProbe`, …) that already work this way. There is
  no agent-id branch anywhere in the dispatch path — a deliberate divergence from Open Design's own
  daemon, which hardcodes the id twice.

  New on `@jini-ai/agent-runtime`'s `RuntimeAgentDef`:

  - `needsAgentLogFile?: boolean` — asks the caller to stage a temp path and pass it as
    `RuntimeContext.agentLogFilePath` before `buildArgs` runs, mirroring `promptViaFile`. Staged by the
    new `prepareAgentLogFile(def, label)` (the sibling of `preparePromptFileForAgent`; it creates only
    the `0o700` containing directory, since the log file is output the CLI authors, not input we do).
  - `stdoutPolicy?: RuntimeStdoutPolicy` — `{buffering: 'live'}` (the default, and every other
    definition's behavior) or `{buffering: 'until-close', sanitize?}`. A discriminated union rather
    than two flat fields on purpose: a sanitizer is only meaningful on the buffered path, because the
    pattern to redact can straddle two `'data'` chunks. Two independent flags would let a definition
    declare a sanitizer the caller could not honor — a confidentiality gap that _looks_ closed.
  - `runtimeLock?: RuntimeLock` — a mutex around a process-global side effect `buildArgs` performs.
    Acquired before `buildArgs`, released on whichever of `waitForHandoff` settling or process exit
    comes first. Releasing on exit is load-bearing, not a fallback: a watcher that stops polling means
    "I stopped watching", never "the child definitely didn't read the file".

  All three are stripped from the `DetectedAgent` registry projection. They instruct whoever _spawns_
  the CLI, not whoever lists agents — and two carry closures, which `JSON.stringify` would flatten into
  a misleading `{"buffering":"until-close"}` / `{}` rather than omit.

  In `@jini-ai/daemon`, `AgentExecutor` now stages a log file when `needsAgentLogFile` is set (released
  on every pre-spawn, spawn-failure, and close path alongside the prompt file, through one composed
  `cleanupStagedFiles` closure), calls `runtimeLock.acquire()` before `buildArgs`, and branches its
  `streamFormat: 'plain'` stdout handling on `stdoutPolicy`. `assessAgentExecutorCompatibility` no
  longer rejects anything by id, and `isAgentExecutorSupported` now accepts all 24 definitions.

  **No behavior change for any other agent.** Antigravity is the only definition declaring any of the
  three fields; the other four `streamFormat: 'plain'` definitions (`grok-build`, `aider`, `deepseek`,
  `qwen`) keep streaming live, per chunk, which `aider`'s and `deepseek`'s own comments call out as
  deliberate. That is pinned by an explicit regression test rather than left implied.

  One thing worth knowing if you consume the run event stream: on the buffered path the raw `'stdout'`
  echo is held back and sanitized too, not just the `'agent'`/`text_delta` copy. Emitting an
  unsanitized raw echo while withholding the chat copy would leak the exact string the sanitizer exists
  to remove to any subscriber. The opt-in byte journal still records raw bytes per chunk — that is its
  documented contract, and it deliberately lives in a separate `EventLog` instance that is never
  replayed to run-event subscribers.

- e16a907: Add optional adapter-owned usageCostBasis metadata; Claude declares that its reported dollars are cumulative within a session.
- Updated dependencies [22f0619]
- Updated dependencies [82ed2d3]
- Updated dependencies [3fe4d14]
- Updated dependencies [5a3de86]
  - @jini-ai/core@0.6.10
  - @jini-ai/protocol@0.6.10
  - @jini-ai/oauth@0.6.10

## 0.4.12 — 2026-10-22

- 2026-10-22: Probe-gated chromeIntegration build option, declarative supportsSubagents, network-capture and asset-harvest fixes, coverage.

## 0.4.11 — 2026-10-14

- Gemini: `applyGoogleUsage` adds `input_tokens` (`promptTokenCount`) and `output_tokens` (`candidatesTokenCount` + `thoughtsTokenCount`) next to the raw `usageMetadata` fields, so usage reducers show Gemini token counts (024fe7e8).
- Gemini: a first reply with no text and no tool calls (for example thinking consumed the whole `MAX_TOKENS` budget) now emits an error carrying the finish reason and ends with `error` instead of a blank successful `stop`. Partial text cut off by `MAX_TOKENS` and tool-only turns still succeed (a80066ae).

## 0.4.10 — 2026-10-13

- ACP `session/request_permission` no longer fails the run. Without an injected `onPermissionRequest`, the session answers by the new `AttachAcpSessionOptions.permissionMode`: `bypass` selects `allow_once`; otherwise `reject_once`, falling back to `reject_always` or `cancelled`. It never picks an "always" approval. A handler that throws, rejects, or selects an unoffered option cancels the request. Each request emits one `status` event (`label: 'acp_permission'`) with only the tool kind and decision. `choosePermissionOutcome(options, { permissionMode })` follows the same policy.

## 0.4.9 — 2026-10-13

- `@jini-ai/oauth` is a regular dependency, no longer an optional peer: the root imports it statically, so a consumer without its own copy (Tovu Desktop 0.1.15) crashed at load with ERR_MODULE_NOT_FOUND.

## 0.4.8 — 2026-10-13

- The root import no longer needs the optional `@jini-ai/integrations` peer: the media-provider catalog loads lazily, only when a default provider URL is needed. A missing peer at that point throws an actionable error with the import failure as its `cause`; explicit `*_BASE_URL` env values never touch it.
- New `createElevenLabsVoiceClient({ http, clock }, { maxCacheEntries })`: voices listed through an injected `HttpClientPort`, expired entries swept, oldest evicted past the bound, `clearCache()`. `listElevenLabsVoiceOptions` stays as the compatibility wrapper over native fetch.

## 0.4.7 — 2026-10-13

- New `createNativeAgentRuntime({ env }, { state, acpModelProbe, codexDisablePlugins, piGracefulShutdownMs })`: one host-owned runtime state with detection, launch and definitions bound to it, environment policies resolved once, and `dispose({})` that drains in-flight discovery before clearing caches.
- ACP model probes can come from the host (`AgentRuntimeState.acpModelProbe`, `fetchModels(required, { acpModelProbe })`); `setAcpModelProbe` stays as the compatibility setter for unbound definitions.
- Codex `--disable plugins` and the pi RPC shutdown grace period are explicit (`RuntimeBuildOptions.codexDisablePlugins`, `PiRpcSessionOptions.gracefulShutdownMs`); `CODEX_DISABLE_PLUGINS` / `PI_GRACEFUL_SHUTDOWN_MS` are read at native composition instead of inside `buildArgs` / the session.

## 0.4.6 — 2026-10-13

- New `./model-discovery` subpath: the discovery policy with injected `deps` and `probes` (`createAgentModelDiscovery({ agentId, configuration, deps, probes })`, `modelDiscoveryForDef({ def, deps })`, `resolveModelForLaunch({ def, context, deps })`). It loads no child_process/fs or native adapters. The root keeps the published scalar signatures, wired to the native probes.
- Platform helpers come from the narrow platform subpaths; peer `@jini-ai/platform` floor is now `^0.5.5`.

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
