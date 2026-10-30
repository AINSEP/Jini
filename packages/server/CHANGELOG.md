## 0.6.15

### Minor Changes

- BREAKING (`@jini-ai/server/owner-store`): the owner store is now a read-only legacy reader. Shared keys are project
  references in the host, so nothing writes, migrates, grants, syncs or revokes an owner store any more. Removed:
  `openOwnerStore`, `OwnerStoreService`, `exportOwnerStore`, `restoreOwnerStore`, `OwnerRevocationPendingError`,
  `OwnerUnreconciledError`, `OWNER_REVOCATION_AUTO_ATTEMPTS` and their types. Added: `countLegacyOwnerStore`
  (entry/grant counts, no key), `readLegacyOwnerStore` (decrypted entries plus recorded destinations, opened with
  SQLite's read-only mode and never migrated) and `readLegacyOwnerBackup` (authenticates and validates a v1 or v2
  backup exactly as restore did, without writing). `OwnerStoreRecoveryError`, `OwnerStoreBackupError`,
  `OWNER_WORKSPACE_ID` and `ownerContext` stay. `@jini-ai/db/owner-store` drops the unpublished
  `0001_owner_revocations` step (`ownerRevocationsDdl`, `ownerRevocationsMigration`); `0000_owner_store` stays.

  Migration: hosts that opened an owner store import its entries into their own store through the reader.

## 0.6.13

### Patch Changes

- cbce255: Apply AI-trace capture policy to errors, contain tracing and sink failures, preserve canonical
  usage and stop reasons, accumulate request usage snapshots, scope tool identities per request,
  and finalize traces from committed terminal events including inactivity watchdog completion.
  Provider/session trace mappers now receive object arguments.
  A trace whose stream subscription is refused or rejects after `run_started` is now finished from
  the run's real terminal state (`waitForTerminal`, in the background) instead of being dropped.
  `RunLifecycle.waitForTerminal` takes an optional `{ signal }`: aborting it rejects with the reason and
  unregisters the waiter. The traced lifecycle gains `dispose()`, which releases open traces without
  finishing them and cancels those background waits; the server kernel's `close()` calls it after the
  agent runtime stops, so a retained kernel keeps no recorder or waiter.
- 506196f: BREAKING (host import path): the owner-store composition moved from `@jini-ai/db/owner-store` to the new
  `@jini-ai/server/owner-store` entry, so `@jini-ai/db` no longer reaches `@jini-ai/platform` or its own
  sibling domains (guard L1 / SI-domain). Moved: `openOwnerStore`, `OwnerStoreRecoveryError`, `OwnerStoreService`,
  `OWNER_WORKSPACE_ID`, `ownerContext`, `exportOwnerStore`, `restoreOwnerStore`, `OwnerStoreBackupError` and the
  `OpenOwnerStore*` / `OwnerStoreDatabase` / `OwnerGrant` / `OwnerPutInput` / `OwnerSyncTarget` types. Behaviour is
  unchanged. `@jini-ai/db/owner-store` keeps `OWNER_STORE_LEDGER`, `ownerStoreMigrations`, `ownerStoreDdl` and
  `ownerStoreMigration`.

  Migration: import those names from `@jini-ai/server/owner-store` and add `@jini-ai/server` (same version as
  `@jini-ai/db`) to the host's dependencies; that entry uses the optional `@jini-ai/db`, `@jini-ai/platform`
  and `kysely` peers. `OwnerStoreService` additionally accepts an optional `repo`; existing kernel-only
  constructions still work.

- 2e4591b: Require the optional @jini-ai/db peer at ^0.6.15 so accepted releases contain the owner-store exports.
- Updated dependencies [7479159]
- Updated dependencies [9138c3b]
- Updated dependencies [aa8de3d]
- Updated dependencies [c31264d]
- Updated dependencies [0728914]
- Updated dependencies [6ecbdb2]
- Updated dependencies [03dec0a]
- Updated dependencies [506196f]
- Updated dependencies [63bacc5]
  - @jini-ai/core@0.6.13
  - @jini-ai/db@0.6.13

## 0.6.12

### Patch Changes

- @jini-ai/core@0.6.12

## 0.6.11

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @jini-ai/core@0.6.11

## 0.6.10

### Patch Changes

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

- Updated dependencies [22f0619]
- Updated dependencies [82ed2d3]
- Updated dependencies [5a3de86]
  - @jini-ai/core@0.6.10

## 0.6.4 — 2026-10-22

- 2026-10-22: Kernel composition and feature-activation updates, security fixes, complexity refactors, coverage.

## 0.6.3 — 2026-10-14

- Express 5 accepted: the optional `express` peer is now `^4.21.0 || ^5.0.0` (1442d875), so an Express 5 host no longer hits ERESOLVE.

## 0.6.2 — 2026-10-13

- Widen the optional `@jini-ai/chat` peer to `^0.5.8 || ^0.6.0` (it rejected the published chat 0.6.0).

## 0.5.1 — 2026-10-08

- Align pack contributions, bindings, HTTP mounting, retry classification, executor settings and
  event-log cleanup with the current core/daemon object argument contracts.
- Compile server tests and fixtures; update their API calls and explicit SQLite opener wiring,
  and keep packed memory-boot support within the server source root.

- Keep SQLite composition at the server concern entries; the deprecated sqlite barrel no longer forwards these APIs. Relocate backend-config and missing-opener assertions to server storage tests.

## 0.5.0 — 2026-10-02

### BREAKING

- Assembly imports follow domain-owned HTTP and core composition surfaces; bundled runtime modules are declared free of import-time side effects.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

### BREAKING — explicit composition security

- `ComposeJiniKernelConfig.security` is required. Omitted or unknown modes now throw before
  resources open; supported-mode middleware order is unchanged.
- Built-in routes consume daemon/http and reconciled route/catalog argument objects.

- Align legacy SQLite integration fixtures with the object arguments of chat, daemon and project stores.

## 0.4.0 (unpublished release candidate)

- Storage composition consumes chat/daemon/registry/db directly. SQLite hosts must supply an opener; implicit driver loading is removed.

# @jini-ai/node-host

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

## Unreleased — C2 injected storage

- Required a host opener for SQLite composition and standalone daemon boot; memory remains driver-free.
- Replaced old storage imports with daemon/registry/db concern subpaths, preserving shared health ownership.
- Added explicit backend-config, legacy bootstrap and local-project storage entries.
