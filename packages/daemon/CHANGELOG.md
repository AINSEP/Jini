# @jini-ai/daemon

## 0.3.0

### Minor Changes

- 4f52784: Stop advertising agents `AgentExecutor` cannot run.

  The built-in `agents` feature scanned every runtime definition, but `AgentExecutor` rejects some of
  them (`antigravity`, whose deferral is documented in that module). A consumer could therefore offer a
  user an agent that failed the instant it was selected, with the mismatch visible nowhere.

  - `@jini-ai/daemon` exports `isAgentExecutorSupported(def)` and `assessAgentExecutorCompatibility(def)`.
    `run()` now consumes the latter instead of re-checking the conditions itself, so the discovery-time
    answer and the run-time guards cannot drift apart. Error messages are unchanged.
  - `@jini-ai/server`'s `agents` feature applies the predicate by default, and exports
    `isExecutableDetectedAgent` for hosts that want it directly.

  `antigravity`'s definition remains in `@jini-ai/agent-runtime` — the predicate is advisory, and a
  non-`AgentExecutor` launch path can ignore it. An id with no registered def is kept rather than
  dropped, so a host supplying its own `detector` is unaffected.

  Note for anyone implementing something similar: the predicate deliberately takes the full
  `RuntimeAgentDef`, not a projected `DetectedAgent`. That projection omits `maxPromptArgBytes`, and the
  argv-bound defs (`aider`, `deepseek`) qualify solely through it — judging the projection would have
  dropped two working agents while fixing one broken one.

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

- 4f52784: Add `createRunScopedContextStore` and widen `ResolvedRunInput` with the executor's optional inputs.

  **`createRunScopedContextStore<T>({ lifecycle })`** — bind/resolve/auto-evict keyed by run id, for
  host-owned context that must survive the gap between starting a run and a later delegated call that
  carries only that run's id. `resolve` fails closed (`RunContextNotBoundError`) rather than fabricating a
  default, and bindings are evicted when the run reaches a terminal state.

  `resolveRunInput` could already decode and stash such context, but it is handed no lifecycle and so
  cannot register the eviction half — leaving a map that only grows and keeps stale authority resolvable.
  Owning both halves together is the point. `T` is fully generic: this helper does not decode
  `contextRef`, does not sign or verify anything, and has no notion of a principal. It is in-memory only,
  and says so — after a restart every `resolve` fails, which is the correct posture rather than a gap.

  **`ResolvedRunInput` now carries `permissionMode`, `model`, `reasoning`, and `credentialEnv`**, each
  forwarded to `AgentExecutor.run()` only when present.

  `permissionMode` is the load-bearing one and closes a real trap: every def with an auto-approve flag
  (`bypassPermissions` / `--yolo` / `--dangerously-skip-permissions`) applies it by default when the field
  is absent. A host that had been passing `'restricted'` to `AgentExecutor.run()` by hand and then adopted
  `createDefaultRunStartHandler` would silently have started auto-approving every action — a security
  regression wearing the clothes of a refactor. Existing behavior is unchanged: omitted fields are omitted
  from the executor call, never passed as an explicit `undefined`.

- 4f52784: Add a `sidecar-strict` security mode and per-run MCP credential propagation.

  For a daemon whose threat model is **another process running as the same OS user** rather than a
  remote attacker, the existing `jini-local` mode is a no-op: `registerApiBearerAuthMiddleware`
  short-circuits for any loopback peer before it reads the `Authorization` header, and a `127.0.0.1`
  bind keeps remote hosts out while doing nothing about a co-resident process. A consumer that spawns a
  Jini daemon holding real authority — starting agent runs, executing tools against a real database —
  previously had to write its own middleware.

  - `@jini-ai/http-kit` gains `requireStrictBearerToken`: fail-closed 503 when the named token env var
    is unset, 401 on mismatch, **no loopback exemption and no disable flag**. Its `tokenEnvVar` is
    required with no default, so this package never names a host's secret.
  - `composeJiniKernel` gains `security: { mode: 'sidecar-strict', host, tokenEnvVar, exemptPaths? }`.
    Purely additive — `host` and `jini-local` are unchanged by construction, since the modes are arms of
    a discriminated union. The strict gate mounts ahead of the JSON body parser, so a caller it rejects
    never has its body parsed.
  - `@jini-ai/daemon`'s `McpJsonInjectionOptions` gains `credential?: (runId) => string | Promise<string>`
    — a **resolver, not a string**, because injection options are built once before any run exists and a
    boot-wide shared secret would defeat the point of scoping a credential to a run. It is delivered to
    the child as `JINI_DAEMON_TOKEN`.
  - `@jini-ai/mcp`'s `jini-mcp` reads that variable and attaches `Authorization` to every daemon call.
    Optional throughout: with no credential, request headers and `.mcp.json` output are byte-identical
    to before.

  Also generalized: both existing bearer gates now compare tokens in constant time (`timingSafeEqual`)
  and share one header-parsing helper, closing a timing side channel and removing a duplicated regex.

### Patch Changes

- Updated dependencies [8ff5653]
  - @jini-ai/agent-runtime@0.3.0
  - @jini-ai/core@0.3.0
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
