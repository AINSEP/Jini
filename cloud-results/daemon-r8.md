# daemon R8 (wave 2): R8a steps 4-5 done, R8b step 8 (session types) done, step 7 already landed, step 6 NOT started (Jini side)

Unattended run, 2026-11-17/18. Branch `wave2/daemon-r8` in Jini and Tovu, from `origin/wave2/c6-cont` (Jini `35ca51b1`, Tovu `b61c70a7`).
Plan: `plan/daemon-untangle-design-2026-11-16` R8-RUNTIME rev 2 (§12). Setup: Node 24.11.1, pnpm 10.33.2, `pnpm install --frozen-lockfile`, `pnpm --no-bail -r build` (exit 0) before any edit; base ratchet output recorded first.

**Result: PARTIAL.** Done: pins before step 5, step 5, step 4 (folded into step 5), the one `vi.mock` removal, step 8 for the session vocabulary types. Not done: **step 6** (the launcher consuming `AgentRuntimePort`, §12.8, the hosts' `createAgentRuntimeBindings`): too large for the context budget left after steps 4-5 (see "Next"). Step 7 needed nothing: `ai-trace-lifecycle.ts` and `event-translation.ts` already import `createAiTraceRecorder` / `normalizeAiUsage` from `@jini-ai/core/contracts/ai-trace` (C6). Step 9 waits for R7-Z.

## Commits (Jini `wave2/daemon-r8`)

| SHA | Content |
|---|---|
| `ee1713e7` | R8a pins before step 5: R4a (a refusal before anything is acquired: code + reason on the stream, no spawn, no lock, no staged file), R7 (two executors, overlapping runs, cancel one), R8 (exact argv + exact env at spawn for a pinned host env). The executor rig moves to `__tests__/r8a-rig.ts`. R12 is already pinned by `__tests__/ai-trace-lifecycle*.test.ts`. |
| `3de2c168` | **Step 5.** `createAgentExecutor({ lifecycle, runtime, hostEnv }, optional)`: `runtime` (`AgentExecutorRuntimePorts`) and `hostEnv` required; options `spawn`, `createCommandInvocation`, `listProcessSnapshots`, `collectProcessTreePids`, `stopProcesses` deleted with `resolveProcessDeps`; `planCommandInvocation` called directly with the host's `commandShell` (`agent-executor/runtime-bindings.ts`); `probeMcpBridge({ entry, spawn, hostEnv }, options)` takes both as required; `McpBridgeProbe` is the bound form. platform: `nodeSpawnPort`, `createSpawnPort`, `nodeCommandShell({ env }, { platform })` (reads no ambient env: HW9). Hosts: `server` preset (binds Node ports unless `agentExecutor.runtime` is given), `minimal-host`, `reference-web`, and the executor tests through `__tests__/runtime-fixture.ts`. |
| `48fbdd3e` | **Step 4 (folded into 5).** `ensureAntigravityMcpPermission` / `prepareAntigravityBridge` take `fileLock` + `writer`; `resolveMcpBridgeForRun` deps carry them; the launcher passes `runtime.fileLock` / `runtime.writer`. The R8a attempt patch was applied minus its platform defaults. |
| `81ae5f70` | Step 8 (types): `AcpMcpServerInput`, `AcpPermissionHandler`, `AcpSessionController`, `PiRpcSession` in `events.ts`, `mcp-bridge.ts`, `contracts.ts` import `ports/agent-runtime-sessions.ts`. |
| `45dcb9b2` | Debt rows lowered (injection x6, env-access x3, size x2). |
| `bb7f03d6` | The last `vi.mock` of another package's internals removed (below). |
| (this report) | `cloud-results/daemon-r8.md` |

Tovu `wave2/daemon-r8`: `6b058e2a` (+ its report commit), checked against Jini `3de2c168`..`bb7f03d6`.

## Failing test first (red shown, then green)

| New test | Red | Green |
|---|---|---|
| platform `createSpawnPort` (3) + `nodeCommandShell` (1) | `createSpawnPort is not a function`, 4 failures | 12/12; mutation: pass `args` uncopied -> the "new mutable copy" case fails |
| `antigravity-permissions.ports.test.ts` (8: lock -> backup -> write -> unlock; failing backup / write; failing lock as Error / non-Error / sync throw; bad name; missing file) | 7 failed / 1 passed before the signature change | 8/8 |
| `r8a-pins.test.ts` R4a, R7, R8, step-4 executor pin (4) | each red by one mutation, all reverted: R4a (`plan.verdict !== 'RUN'` -> `false`), R7 (module-level `lastStop` shared by executors: `expected "spy" to be called 1 times, but got 0`), R8 (`agent-env.ts` copies the whole host env: extra keys in the object), step 4 (launcher passes a lock that logs nothing: `expected 'text:...' to be 'lock'`) | 4/4 |
| server `terminal-service` (5, was 4) | mutation: `buildTerminalService` ignores `terminalService` -> 2 red (it + the lifecycle test); drop the `undefined` filter -> 1 red | 5/5, lifecycle 1/1 |

Tests that changed meaning (each with a destination, none dropped silently): daemon `launch-defaults-and-staging` "stops the real process tree with the real stopper" (no default to test any more, §12.11) -> platform `runtime-ports.test.ts` "stopProcesses stops a live process with SIGTERM"; `split-parity` "keeps spawn synchronous" lost its `vi.mock('node:child_process')` and asserts the port call `({ command, args }, options)`; three SEC-001 env tests (`PATH/HOME/LANG`, `USER`, `CODEX_HOME`) pass `hostEnv` instead of `vi.stubEnv` (the executor never reads the ambient env); the probe's "baseline launch environment by default" case now pins the exact env for a given host env; http-mcp-launch's `invocation` failure now fails through the real planner (pinned win32 `.cmd` + an argument with a line break). `it(` counts: daemon `agent-executor/` + `__tests__/` +11 net (4729 -> 4740 passed), platform `runtime-ports` 8 -> 13, server `terminal-service` 4 -> 5, `terminal-lifecycle` 1 -> 1, `r8a-characterization` 10 -> 10 (the win32 case now pins `platform: 'win32'` through the rig instead of redefining `process.platform`).

## The `vi.mock` removal

Both server terminal suites spied on platform's `createTerminalService` through `vi.mock('@jini-ai/platform')`. Both are gone. `buildTerminalService({ options }, { createService })` takes the engine's builder as an injectable (default: the real one) and the service tests call it directly with a recording `createService`. The lifecycle test needs the service the kernel owns, and the preset offers no other path to create a session (`terminal.create` is deny-all by default), so `featureOptions.terminal` gained **`terminalService`**: a host-built service used as given. That is an option whose first user is a test; it is the option the existing guidance error already names ("a host-supplied terminalService or loadSpawnPty"), and it is in the changeset. Also removed: `vi.mock('node:child_process')` in `split-parity.test.ts`.

## Gates (exact commands, final Jini tree `bb7f03d6`, `/home/user/Jini`)

- `pnpm guard`: ok, zero violations (the 1 stale hardwiring row is on the base). `pnpm check:size`: passed (157 entries). `pnpm check:complexity`: passed (17 entries). `pnpm -r --if-present run typecheck`: exit 0. `pnpm --no-bail -r build`: exit 0.
- `npx vitest run --maxWorkers=2 --minWorkers=1` in `packages/daemon`: 238 files, 4740 passed, 1 skipped. `packages/server`: 32 files, 506 passed, 1 skipped. `packages/platform`: 164 files, 3127 passed, 6 skipped.
- `examples/minimal-host`: `npx vitest run src/acp-fixture.test.ts` 1/1; `examples/reference-web`: `npx tsc -p . --noEmit` exit 0 (minimal-host has no tsconfig).
- BASE-RED, output recorded on the unmodified tree first (`pnpm check:hooks`, `check:log-safety`, `check:errors`): `check:hooks` fails on `packages/ui/...` lines only (none in a file of this diff); `check:log-safety` fails on `packages/http-kit/src/node-bridge.ts`, identical with my changes stashed; `check:errors` (WARN) prints the same 18 `New:` lines as the base (diffed, identical). No new line anywhere.
- Not done: `pnpm api:check` baseline update (`api-baseline` already drifts on the base: it lists unrelated `infra`/`mcp`/`http-kit` changes; the diff for this work is `daemon` signatures and the two new `platform` subpaths, left for the coordinator's single regeneration). Root `scripts/__tests__` suite not re-run (no `scripts` source touched except three debt JSON files).

## Deviations and flags

1. **STOP addition "rg finds an executor or probe caller not in §12.4":** `rg` found two Tovu callers outside the table: `development/evals/tool-search-caller2-compliance-harness.ts:231` (a scratch harness that really spawns `claude`) and `apps/website/.../assistant-run-finalizer.failed-run.integration.test.ts:30` (a test). Neither is production; both are updated in the same Tovu commit. Jini likewise had non-table callers (`minimal-host/src/acp-fixture.test.ts`, `__tests__/integration/claude-bash-sandbox.live.test.ts`, executor tests). I read the STOP as aimed at production callers; if the owner reads it strictly, this is the item to rule on.
2. `hostEnv` became required in step 5 (not left for step 6): §2.3 says so and the ambient `process.env` fallback was the defect. Tests that relied on the ambient env now pin one.
3. The `server` preset keeps `agentExecutor.runtime` / `agentExecutor.hostEnv` optional for ITS callers and binds the Node ports when absent (the preset is the Node host).
4. Platform's `nodeCommandShell` takes `{ env }` from the host (no ambient read, HW9 caught the first version). `fallbackComSpec` therefore comes from the host snapshot, not `process.env.ComSpec`; the baseline env allowlist already carries `ComSpec`.
5. Lane-K upward-import report (`rg "from '\.\./" agent-executor/antigravity/`): `../contracts.js` (type `McpBridgeDelivery`) and `../values.js` (`isRecord`); unchanged, lane-K items.
6. §12.9 stays open (O-7): the launcher's own private temp dir effects (`launch.ts` `fsPromises.mkdtemp/rm`) are not behind a port.

## Next (step 6, in this order)

1. Add required `agentRuntime: AgentRuntimePort` to `createAgentExecutor`'s first object. Test churn is mechanical: `/tmp`-style codemod over `createAgentExecutor(` calls (the one used here moved `spawn`/`listProcessSnapshots`/`stopProcesses`/`hostEnv` into `runtime: runtimeFixture(...)`; extend it to move `getAgentDef`, `resolveAgentLaunch`, `ensureAgentCapabilities`, `applyAgentLaunchEnv`, `resolveModelForLaunch`, `assertClaudeFilesystemSupport`, `attachAcpSession`, `attachPiRpcSession`, `preparePromptFileForAgent`, `prepareAgentLogFile`, `runtimeState`, `codexDisablePlugins`, `piGracefulShutdownMs` into an `agentRuntimeFixture({...})` = `createAgentRuntimeBindings({ runtime: createNativeAgentRuntime(...) })` with legacy-shaped members replaced). ~45 daemon test call sites (the rig in `r8a-rig.ts` and `runtime-fixture.ts` already centralise a dozen).
2. `launch.ts`: delete `resolveAgentRuntimeDeps` and the 22 value imports (`defs.get/ensureCapabilities`, `launch.*`, `filesystem.*`, `models.resolveForLaunch`, `sessions.*`); `events.ts` 5 values (`streams.*`, `sessions.*`); `claude/filesystem.ts` 3, `model-receipts.ts` (`models.identityKind`), `session-coordination.ts` (`failures.startupMessage`).
3. §12.8: `selectAgentExecutorHostEnv({ env, hostEnvNames })`, `appendFlagOverlay({ capabilities })`, `resolveSystemPromptOverlayDelivery(input, { capabilities })`; `host-env-ports.test.ts` gains "unknown vs false".
4. Hosts: the `server` preset (kernel-base already builds a `NativeAgentRuntime`), `minimal-host`, `reference-web`, Tovu `agent-daemon-scope.ts` / `desktop-agent.ts` (`createAgentRuntimeBindings({ runtime: assistantRuntime }) satisfies AgentRuntimePort`; delete `executorDefinitionPolicies` and the two option lines), the eval harness and the finalizer test. Then step 9 after R7-Z.

## Overlaps with other runs

`packages/daemon/src/agent-executor/{launch,contracts,events,mcp-bridge-probe}.ts` (R7/size-design 10 touch the same files); `packages/server/src/kernel-base.ts`; `packages/platform/src/runtime-ports/process.ts`; debt files `scripts/{injection,env-access,size}-debt.json` (trivial line-delete conflicts); Tovu `agent-daemon-scope.ts`, `desktop-agent.ts`.
