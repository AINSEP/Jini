# @jini-ai/node-host

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

- Updated dependencies [4f52784]
- Updated dependencies [8ff5653]
- Updated dependencies [8ff5653]
- Updated dependencies [4f52784]
- Updated dependencies [4f52784]
- Updated dependencies [4f52784]
- Updated dependencies [8ff5653]
  - @jini-ai/daemon@0.3.0
  - @jini-ai/agent-runtime@0.3.0
  - @jini-ai/http-kit@0.3.0
  - @jini-ai/core@0.3.0
  - @jini-ai/sidecar@0.3.0
  - @jini-ai/sqlite@0.3.0

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
  - @jini-ai/core@0.1.2
  - @jini-ai/daemon@0.2.1
  - @jini-ai/agent-runtime@0.2.1
  - @jini-ai/sqlite@0.1.2
  - @jini-ai/http@0.2.1
  - @jini-ai/sidecar@0.1.2

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
  - @jini-ai/core@0.1.1
  - @jini-ai/sqlite@0.1.1
  - @jini-ai/sidecar@0.1.1
  - @jini-ai/http@0.2.0
  - @jini-ai/agent-runtime@0.2.0
  - @jini-ai/daemon@0.2.0
