# @jini-ai/agent-runtime

## 0.3.0

### Minor Changes

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

### Patch Changes

- @jini-ai/platform@0.3.0
- @jini-ai/protocol@0.3.0

## 0.2.1

### Patch Changes

- Add top-level `main`/`types` fields alongside the existing `exports` map. A consumer on
  TypeScript's classic `moduleResolution: "node"` (node10) — which ignores `package.json#exports`
  entirely — could not resolve this package's types at all (`TS2307: Cannot find module`) even
  after the previous exports-map fix restored `require()` at runtime; type resolution and runtime
  resolution are separate algorithms. Verified against a real external consumer (Tovu, whose
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
