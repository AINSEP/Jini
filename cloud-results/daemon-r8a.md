# daemon R8a, steps 0-4 (unattended build run, 2026-11-16)

Design: `plan/daemon-untangle-design-2026-11-16` R8-RUNTIME.md §12 (revision 2) + INDEX §9. Branch `refactor/daemon-r8a` in both repos, based on `origin/refactor/terra` (Jini `02edbb68`, Tovu `80b00f5b`). Node 24.22.3, `pnpm install --frozen-lockfile` (lockfile edited by hand for the node-pty move; frozen install accepts it).

**Result: steps 0, 1, 2, 3 done. Step 4 PARTIAL (shell deleted; the port-taking function is blocked, see Deviations). Step 5 not started (waits on C6, per the task).**

## Commits (Jini, branch `refactor/daemon-r8a`)

| SHA | Step | Content |
|---|---|---|
| `6ae65f9f` | 0 | characterization tests (below) |
| `9491889c` | 1 | `daemon/src/ports/{process,runtime}.ts` + fakes + self-checks; `platform/src/runtime-ports/{process,fs}.ts` + binding tests; changesets |
| `e0ae81e8` | 2 | event log opens through the host `SqliteSyncOpener`; no `@jini-ai/db` import |
| `17bab8f9` | 3a | node-pty adapter `daemon/src/terminal.adapter.ts` -> `server/src/adapters/node-pty.ts` (git mv), manifests, docs, lockfile |
| `e159e929` | 3b | `createTerminalSessionManager({ terminalService })` required; preset builds the service; `server/src/terminal-service.ts` |
| `724c643b` | 4 (partial) | `agent-executor/antigravity-permissions.ts` re-export shell deleted, importer repointed; blocked attempt kept in `cloud-results/daemon-r8a-step4-attempt/` |
| `a20e47d5` | - | tests that pin the new subpaths / node-pty's new owner |

Tovu: report-only commit, checked against Jini code SHA `a20e47d5`. No Tovu source imports anything R8a steps 0-4 changed (`rg` for `@jini-ai/daemon/terminal`, `loadRealSpawnPty`, `createTerminalSessionManager`, `ensureAntigravityMcpPermission` in Tovu `apps packages development`: none).

## Step 0: characterization tests and proof each fails

Green on the unmodified tree first: daemon full suite 4388 passed / 1 skipped, exit 0 (before steps 1-3 touched source).
Proof = one deliberate local mutation, test run (red), mutation reverted. All reverted (`git diff` clean afterwards).

| Test (file) | Pins | Mutation that made it fail | Red result |
|---|---|---|---|
| R1 `agent-executor/__tests__/r8a-characterization.test.ts` | child `error` on the next microtask is heard in the same turn as spawn; run fails `AGENT_SPAWN_FAILED`; lock then files released | `await Promise.resolve()` after `const child = spawnResult.child` in `launch.ts` | R1 + both R14 tests fail (run never settles; spawn event lost) |
| R2 same file | lock released before staged files, once each (success path and sync-spawn-failure path) | swap `releaseRuntimeLock()` / `await cleanupStagedFiles()` in `releaseStagedResources` | `['acquire','cleanup','release']` vs `['acquire','release','cleanup']` |
| R5 same file | one `listProcessSnapshots`, `stopProcesses` gets exactly the child + descendant pids, not the unrelated one | `rootPids: [child.pid]` -> `rootPids: []` in `events.ts` | `[]` vs `[6000, 6001]` |
| R5/R6 same file | `stopProcesses` failing (Error and non-Error) -> one `onCleanupFailure` report + `kill('SIGKILL')` fallback | remove the SIGKILL fallback | both cases fail |
| R6 same file | `spawn` throwing an Error / non-Error -> `AGENT_SPAWN_FAILED` naming the cause | (existing behaviour; no separate mutation) | - |
| R14 same file | args `['--mode','plan','a b','50%']` reach spawn on POSIX; pinned win32 `.cmd` gives the exact golden `/d /s /c "C:\agent\agent.cmd --mode plan "a b" "50"^%"""` with `windowsVerbatimArguments` | `createInvocation({ command, args: [], env })` in `prepareRunCommand` | `[]` vs the 4 args; golden mismatch |
| R9 `store/event-log/__tests__/sqlite-open-ownership.test.ts` | `open` once with `(file, {})`, WAL pragma first, pragma throws (Error / non-Error) -> handle closed once + original error rethrown, schema failure same, close twice closes once, failing close never masks, borrowed log never closes | `db = input.open(...)` assigned inside an `open` callback replaced by a bare `return input.open(...)` (handle not captured before the pragma) | both pragma-throw cases: `close` calls `0` vs `1` |
| R11 `agent-executor/__tests__/antigravity-permissions.order.test.ts` | on the real fs: lock held when backup runs, settings still the original at backup time, write after, no lock left; write failure keeps backup + releases lock; backup failure leaves settings unwritten | move the backup call after the write in `antigravity/permissions.ts` | all 3 fail |
| R10 `__tests__/terminal-session.test.ts` | `shutdownActive` forwards `graceMs` and no-arg unchanged | `terminalService.shutdownActive()` (drop the arg) | `[[],[]]` vs `[[{graceMs:25}],[undefined]]` |

Already covered before this run (not re-written): R13 bridge probe (`mcp-bridge-probe.unit.test.ts`: credential stripping, diagnostic run id, 2000-byte tail, spawn error / exit / timeout results); R3 and R4b lock-release paths (`agent-executor.test.ts` "runtimeLock" block); R10 default-inert boot and tuning (moved to the preset in step 3b, below). Not written: R7 (two executors, overlapping runs), R8 argv/env goldens beyond R14, R4a refusals matrix, R12 AI trace: no time/context left for them in this run; listed as open in "Next".

New test counts: step 0 added 21 tests (r8a-characterization 8 `it` blocks / 10 cases, sqlite-open-ownership 7 cases, antigravity order 3, terminal shutdown 1).

## Step 1

- `packages/daemon/src/ports/process.ts`: `ProcessSpawnPort` (synchronous, object args, returns `ChildProcess`). `ports/runtime.ts`: `AgentExecutorRuntimePorts` (spawn, processes, fileLock, writer, commandShell). No command port.
- Fakes `ports/__tests__/fakes/{process,runtime}.ts` (`fakeSpawn`, `createFakeChild`, `fakeProcessControl`, `fakeFileLock`, `fakeAtomicWriter`, `fakeRuntimePorts`) + `runtime-fakes.test.ts` (7 cases incl. a broken-adapter self-check that a dropped `pids` argument is visible in the fake's call log).
- Bindings (O-9 recommendation, "once in platform"): `@jini-ai/platform/runtime-ports/process` (`createProcessControlPort({ functions })`, `nodeProcessControl`) and `.../runtime-ports/fs` (`nodeFileLock`, `nodeAtomicWriter`), each with `satisfies`. `runtime-ports.test.ts` (8 cases) fails on the blocker class: `stopProcesses({ pids })` reaches the function as a NEW array; `waitForProcessExit({ pid })` as `(7, undefined)`, with `{ timeoutMs: 10 }` as `(7, 10)`; `listProcessSnapshots` first arg `{}`. Mutations: pass `pids` through uncopied -> "not to be" identity assertion fails; default `timeoutMs ?? 5000` -> `(7, 5000)` vs `(7, undefined)` fails. The real-function cases (lock under the lock path, `data` field written with trailing newline, backup-once) pass.
- The command binding blocker is closed by not binding: daemon will call core's `planCommandInvocation` directly (R14 pins the behaviour today, on POSIX and pinned win32, so step 5 has a golden to keep).

## Step 2

`openSqliteEventLog` now does `db = input.open(input.file, {}); db.pragma('journal_mode = WAL');` with the handle captured before the pragma. Signature unchanged, `kernel-base.ts` not edited. Event-log suites: 13 files / 124 tests green; injection-debt row removed (guard flagged it stale).

## Step 3

- 3a: `git mv` of `terminal.adapter.ts` and `terminal-optional-peer.test.ts` into `packages/server/src/adapters/`; body unchanged except the require anchor name and doc paths. daemon loses the `./terminal` export, the `node-pty` peer / peerMeta / dev dep / `optionalPeers` row; server gains `./adapters/node-pty`, the optional peer, dev dep, `optionalPeers` row. Lockfile edited by hand (a `--lockfile-only` regeneration pulled unrelated registry resolutions, discarded). Tests that needed node-pty mocks (`loadRealSpawnPty` cases) moved to `server/src/adapters/__tests__/node-pty.test.ts`.
- 3b: `createTerminalSessionManager({ terminalService }, _optional = {})`; `CreateTerminalSessionManagerOptions` replaced by `CreateTerminalSessionManagerRequired`. The preset builds the service in `server/src/terminal-service.ts` (`buildTerminalService`): host loader else an inert loader that throws the same guidance, now naming `@jini-ai/server/adapters/node-pty` (the one visible wording change, in the changeset). `featureOptions.terminal` gained the seven tuning options (`maxEvents`, `maxBufferBytes`, `exitTailBytes`, `flushIntervalMs`, `flushThresholdBytes`, `ttlMs`, `shutdownGraceMs`); explicit `undefined` is not forwarded. node-pty is never bound by the preset on its own.
- Preset tests (`builtin-features.terminal-service.test.ts`, 4): default-inert boot rejects with the new guidance; host loader wins; all seven tuning keys reach the service; omitted/undefined keys are left out. Mutations: drop `shutdownGraceMs` from the key list, forward undefined values, ignore the host loader: each turns the matching test red (1, 1, 2 failures).
- `builtin-features.terminal-lifecycle.test.ts` no longer `vi.mock`s `@jini-ai/daemon`; it passes `shutdownGraceMs: 0`. It now uses a recording SPY (not a replacement) over platform's `createTerminalService` to obtain the service the preset built, because the manager is not exposed. Flagged: one `vi.mock` of platform replaces one `vi.mock` of daemon.
- `it(` counts: `terminal-session.test.ts` 44 -> 41 (removed 5, each with a destination: `loadRealSpawnPty` and native-loader cases -> `server/.../node-pty.test.ts`; default-inert and tuning-knob cases -> `builtin-features.terminal-service.test.ts`; "injected terminalService" -> replaced by "wraps the service it is given"; added "shutdownActive forwards graceMs" and that one). The inert case's `expect(nodePtySpawnMock).not.toHaveBeenCalled()` has no daemon equivalent any more (daemon cannot import node-pty); the preset test covers "no PTY library touched" by construction (the inert loader throws before any import). `terminals.test.ts` 76 -> 76, `terminal-lifecycle` 1 -> 1.

## Step 4 (partial) and the STOP

Done: deleted `agent-executor/antigravity-permissions.ts` (one-line re-export), repointed its importer.

**Not done: `ensureAntigravityMcpPermission({ settingsPath, serverName, fileLock, writer })`.** The design (§12.4, §12.5) assumes `mcp-bridge.ts:258`'s function is "already an injected dep" the launcher supplies. It is not: `launch.ts:1568` calls `resolveMcpBridgeForRun` with `{ mcpJsonInjection, cleanupStagedFiles, failBeforeSpawn }` and never passes `ensureAntigravityMcpPermission`, so production always runs the concrete default. Taking `fileLock`/`writer` therefore needs a source in `launch.ts`, which only step 5's required `runtime` object provides. I wrote and verified (typecheck, 55 antigravity tests green, ports test green) the version where `launch.ts` resolves `options.fileLock ?? nodeFileLock` / `options.writer ?? nodeAtomicWriter` in `resolveProcessDeps`, then reverted it because it breaks three design rules that guard checks mechanically:
1. `pnpm guard` L5-injected-edge: a new `launch.ts -> @jini-ai/platform/runtime-ports/fs` import (not in `injection-debt.json`; adding debt would be improvised);
2. size ratchet: `launch.ts` 1048 -> 1053 lines ("Worsened"), and the design says R8 only deletes lines there (STOP: "any function in a touched file gains lines");
3. the alternative (required `fileLock`/`writer` on `createAgentExecutor`) touches ~47 call sites (5 production + 42 in tests/examples), which is step 5's change done twice.

The attempt is preserved: `cloud-results/daemon-r8a-step4-attempt/step4-attempt.patch` (305 lines, applies on `e159e929`; includes the permissions/mcp-bridge/launch/contracts edits and updated callers in 5 tests) and `antigravity-permissions.ports.test.ts.txt` (the lock -> backup -> write order and failing-lock/-writer cases through `fakeFileLock`/`fakeAtomicWriter`; passed before the revert). Recommended resolution: fold step 4 into step 5, where `runtime.fileLock`/`runtime.writer` exist; then apply the patch minus the `nodeFileLock` defaults.

Lane-K upward-import report for `agent-executor/antigravity/` (`rg "from '\.\./"`): `../contracts.js` (type `McpBridgeDelivery`) and `../values.js` (`isRecord`). Not fixed, recorded as lane-K items.

## Gates (final tree, Jini `a20e47d5`)

- `pnpm guard`: ok, zero violations.
- `pnpm -r --if-present run typecheck`: exit 0.
- `check:size`, `check:complexity`: pass (size-debt values for `createTerminalSessionManager` 101 -> 85, `createBuiltInFeatures` 426 -> 424, `builtin-features.ts` 566 -> 560 lowered, as the ratchet requires; no function gained lines or complexity).
- daemon full suite: 222 files / 4390 passed, 1 skipped, exit 0 (after step 3b); server full suite: 29 files / 479 passed, 1 skipped, exit 0; platform: 161 files, the one failure (`exports.test.ts` pinning published subpaths) fixed in `a20e47d5`, re-run green; root `scripts/__tests__`: the only new failure was `optional-peer-contract` (node-pty moved), fixed in `a20e47d5`; failures that also occur on the unmodified base are untouched (`ui -> lexical`, parse5 / ui-kit findings, model-fallback freshness, packed connection-card, standalone-agent-plugin, platform OS-helper isolation counts).
- Changesets: `platform-runtime-ports`, `daemon-runtime-ports`, `daemon-terminal-adapter-moves`, `daemon-terminal-service-required`.
- Tovu: `link-jini.mjs` + `packages/contracts` / `packages/sdk` build done; `tsc -p tsconfig.json --noEmit` (6 GB heap) against Jini `a20e47d5` linked via `link-jini.mjs`: exit 0, no diagnostics. No Tovu importer test was run (no Tovu file imports anything changed here).

## Deviations and notes

- `./ports` subpath: shipped as `./ports/process` and `./ports/runtime` (one file per subpath), because a single `./ports` entry would have to be a barrel (practice 5). C6 can add `./ports/agent-runtime` the same way, or the coordinator can rename.
- Bindings live in platform as two entries, not one: `subpath-isolation` (SI-domain) forbids one entry reaching both the `os` (`process.ts`) and `fs` domains. Manifest lines (exports, `jini.entries`, `isolation.entries`) applied by me since there was no coordinator.
- Daemon's own `dependencies` still list `@jini-ai/platform` / `@jini-ai/db`: removed only in step 9 per the design (tests still use them).
- Not done in step 0 and open: R7, R8 goldens beyond R14, R4a refusals matrix, R12 AI trace, `host-env` / probe goldens beyond what exists.

## Next

1. Step 5 (after C6): required `runtime` on `createAgentExecutor`, call `planCommandInvocation` directly with `{ platform, fallbackComSpec }`, probe `spawn`/`hostEnv` required, five hosts, tests; fold step 4's patch in at the same time. R1/R2/R5/R14 above are the pins; the R14 win32 golden must stay byte-identical.
2. Write the missing step-0 cases (R7, R8, R4a, R12) before step 5 edits `launch.ts`.
3. Owner: O-9 (platform bindings, now landed as two entries), O-7 unchanged.
