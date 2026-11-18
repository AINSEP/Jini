# daemon-r8-2 (2026-11-18): re-apply wave2/daemon-r8 onto refactor/terra. PARTIAL: pins pushed, the rest is a verified patch series blocked by the lockfile rule

Unattended run. Branch `wave3/daemon-r8-2` from `origin/refactor/terra` in both repos (Jini `6c9effae`, Tovu `b5fbf2a5`). Node 24.11.1, pnpm 10.33.2. Setup before any edit: `pnpm install --frozen-lockfile` (exit 0), `pnpm --no-bail -r build` (exit 0, 0 `error TS`), base `pnpm guard` / `check:size` / `check:complexity` / `api:check` all exit 0.

## Result in one paragraph

All of daemon-r8 (R8a step 4 and 5, R8b step 6 and 8, the `AgentRuntimePort` wiring, both repos) was re-applied onto terra, every import repointed to `@jini-ai/node-adapters`, no forwarder at the old path, and the behaviour pins are green. **It cannot be pushed as a tree**: every consumer of the Node bindings (`packages/server`, `packages/daemon` tests, `examples/minimal-host`, `examples/reference-web`, and in Tovu the root and `apps/desktop`) now imports `@jini-ai/node-adapters`, which none of them declares. Declaring it is a new dependency, which is a `pnpm-lock.yaml` / `package-lock.json` change, and the standing rule (until 2026-11-19) is to never edit the lockfile and to STOP a step that needs a new dependency. So: **pushed** = the two commits that need no dependency (the R8a pins and a typecheck fix for them). **Not pushed as a tree, delivered as verified patches** = everything else, `cloud-results/daemon-r8-2/jini/0001..0006-*.patch` here and `cloud-results/daemon-r8-2/tovu/0001..0002-*.patch` in Tovu. The Jini series applies on this branch's tip with `git am --3way` and yields exactly the tree I tested (empty `git diff` against my scratch branch).

The attempt to run `pnpm install --no-frozen-lockfile --offline` was refused by the permission classifier, and so was adding the dependency line to Tovu's `package.json`; I did not try to get around either. For verification I symlinked `packages/node-adapters` into the four Jini consumers' and Tovu's `node_modules` (untracked) and left every manifest-adjacent file out of the pushed branch.

## What was pushed (Jini `wave3/daemon-r8-2`)

| SHA | Content |
|---|---|
| `522b190c` | cherry-pick of `ee1713e7`: R8a pins before step 5 (R4a refusal acquires nothing, R7 two executors, R8 argv/env golden); the executor rig moves to `__tests__/r8a-rig.ts`. Clean pick. |
| `4db241e7` | `fix(daemon)`: the R4a pin called `executor.run({... nativeToolAccess ...})` with one object, but terra's `run(required, optional)` takes two, so the file did not typecheck (vitest does not typecheck, which is why it ran green). The original branch fixed this line only in a later commit (step 4). Added on top instead of amending `522b190c` because I had already pushed it and never force-push. |

`git push` ran the Jini pre-push hook without `--no-verify`.

## What was re-applied and what was re-done (the patch series)

Jini patches, in order, each checked alone with `cd packages/daemon && npx tsc -p tsconfig.json --noEmit` and `pnpm check:size` (rebase `--exec`), skipped reports `f0498e0d`, `95ed814d`:

| # | Original | Result |
|---|---|---|
| 0001 | `3de2c168` R8a step 5 | **Re-done.** Terra moved `platform/src/runtime-ports/*` to `packages/node-adapters/src/{fs,process}.ts` (N1). Git followed the rename, so the platform part conflicted only in imports: `createSpawnPort`, `nodeSpawnPort`, `nodeCommandShell` now live in `node-adapters/src/process.ts` (imports `@jini-ai/platform/process`, which node-adapters already depends on), their tests in `node-adapters/src/__tests__/runtime-ports.test.ts` (coverage stays 100/100/100/100), `surface.test.ts` pins the new exported names, `source-map.md` and the changeset name node-adapters instead of platform. Every consumer imports `@jini-ai/node-adapters/{fs,process}` (9 files: `server/kernel-base.ts`, `server` kernel-runtime test, daemon `r8a-rig`, `runtime-fixture`, `mcp-bridge-probe.unit`, `claude-bash-sandbox.live`, `minimal-host` x2, `reference-web`). Manifests: `server` dependency, `daemon` devDependency (test-only, exempt from the layer rule), `minimal-host`, `reference-web`. `size-debt` `launch.ts` 1026 -> 1024 (terra's launch.ts differs from the r8 base). |
| 0002 | `48fbdd3e` step 4 | Clean, plus the same import repoint in three antigravity-permission tests. |
| 0003 | `81ae5f70` step 8 types | **Re-done:** one conflict in `mcp-bridge.ts`: terra had deleted the `export { prepareClaudeConfigDirIfNeeded ... }` / `export { mergeEnvContent* }` forwarders; kept terra's deletion and took only the `ports/agent-runtime-sessions.js` import. `events.ts` size debt 926 -> 923 moved here from the chore commit so this commit passes `check:size` alone. |
| 0004 | `45dcb9b2` debt rows | Applied; only the rows still owed. |
| 0005 | `bb7f03d6` terminal preset | **Re-done:** terra had touched `builtin-features.terminal-service.test.ts` (a restored why-comment on the `vi.mock` spy). The r8 version removes that spy, so I took the r8 file and moved the why-comment onto its replacement (`recordingBuilder`: "so knob forwarding is asserted, not assumed"). |
| 0006 | `4f58cf30` step 6 | **Re-done:** conflicts in `launch.ts` (terra moved `mergeEnvContent*`, `defaultRemoveMcpJsonFile`, `prepareClaudeConfigDirIfNeeded` imports; kept terra's locations minus `resolveCodexDisablePlugins`), `contracts.ts` (kept terra's `McpJsonServerEntry` import, dropped `PiExecutorOptions`), `codex/contracts.ts` (`CodexExecutorOptions` deleted), `r8a-rig.ts`, `injection-debt.json` (terra already dropped the other rows; the `session-coordination.ts` row goes), `size-debt.json` (`launch.ts` 952). |

Behaviour pins kept green: `r8a-pins` (3), `r8a-characterization` (10), `launch-characterization`, `runtime-policy`, `host-env-ports`, `host-env-ports` "unknown vs false", `startup-failure`.

## Gates (exact commands, final scratch tip `c41b449e` = tree of the patch series, `/home/user/Jini`, node-adapters symlinked into 4 consumers)

- `pnpm guard` exit 0 (zero violations; the manifest edits satisfy the layer rule). `pnpm check:size` exit 0 (154 entries). `pnpm check:complexity` exit 0. `pnpm api:check` exit 0 (report-only; new drift lines for daemon `createAgentExecutor`, `CreateAgentExecutorOptions`, `probeMcpBridge`, `McpBridgeProbe*`, `resolveLaunch`..., `failRunBeforeStart`, node-adapters `./process` x4 added, server `CreateJiniKernelBaseOptions`; baseline regeneration left to the coordinator's single `pnpm api:update`).
- `pnpm --filter @jini-ai/daemon --filter @jini-ai/server build` exit 0; `npx tsc -p tsconfig.json --noEmit` in `packages/daemon`, `packages/server`, `examples/reference-web`: exit 0 each (`examples/minimal-host` has no tsconfig).
- `npx vitest run --maxWorkers=2 --minWorkers=1`: `packages/daemon` 244 files, 4802 passed, 1 skipped; `packages/server` 31 files, 467 passed, 1 skipped; `packages/node-adapters` 2 files, 16 passed, `--coverage` 100% on both files; `examples/minimal-host` `src/acp-fixture.test.ts` 1/1.
- Per-commit (rebase `--exec`): daemon `tsc --noEmit` exit 0 and `pnpm check:size` exit 0 after each of the 8 commits (two failures found and fixed that way: the pins commit's type error and the two size-debt values above).
- Not run: `pnpm check:hooks` / `check:log-safety` / `check:errors` (base-red on the r8 base, not re-measured on terra), the root `scripts/__tests__` suite.

Pushed branch tip `4db241e7`: only test files differ from terra, so terra's baseline applies; `npx tsc -p tsconfig.json --noEmit` in `packages/daemon` exit 0, `r8a-pins` + `r8a-characterization` 13/13.

## To land the rest (after 2026-11-19 or when the lockfile rule is lifted)

1. Jini: on `wave3/daemon-r8-2`, `git am --3way cloud-results/daemon-r8-2/jini/*.patch`; `pnpm install` (the lockfile gains an `@jini-ai/node-adapters` `link:` in the importers of `packages/daemon` (dev), `packages/server`, `examples/minimal-host`, `examples/reference-web`); fold that lockfile change into patch 0001 so each commit installs frozen; `pnpm --no-bail -r build`; rerun the gates above.
2. Tovu: apply `cloud-results/daemon-r8-2/tovu/*.patch` after the Jini build, add `"@jini-ai/node-adapters": "^0.7.0"` to `dependencies` of the root `package.json` and `apps/desktop/package.json`, `npm install` for the lockfiles. `@jini-ai/node-adapters` with `./fs` and `./process` (including `nodeSpawnPort`) must be the version Tovu resolves (a Jini release, or `link-jini` plus a hand symlink as in this run). Until then Tovu's own test `apps/desktop/src/jini-mcp-peers.test.ts` "runtime source imports declare their packages" fails on exactly `@jini-ai/node-adapters` in `desktop-agent.ts` and `daemon-runtime-ports.ts` (seen this run).
3. Option if the owner prefers no new dependency in Tovu: the two Tovu hosts could state the five bindings themselves from `@jini-ai/platform` functions they already depend on (`withFileLock`, `writeFileAtomicAsync`, the process functions). That duplicates `node-adapters`; not done.

## Open flags carried over from the r8 reports (owner to rule; unchanged here)

`bindAgentRuntime` on the `server` preset (first user is a test); `failRunBeforeStart` with `startup` now requires `startupMessage` (type-level break); the port doc says `defs.get` returns "the definition" while the launcher never calls `defs.bind` (one sentence worth adding); filesystem-support probe cache is per bound runtime; step 9 (drop `@jini-ai/agent-runtime` / `db` / `platform` from daemon dependencies) waits for R7-Z; §12.9 temp-dir port (O-7) still open.

## Overlaps with `origin/wave2/daemon-r7` (routes; NOT merged, not in terra)

Computed with `git diff --name-only <merge-base> origin/wave2/daemon-r7` against this series. Jini: `examples/reference-web/src/daemon.ts`, `scripts/env-access-debt.json`, `scripts/injection-debt.json` (line-delete conflicts expected). Tovu: `apps/desktop/src/desktop-agent.ts`, `apps/website/src/server/inbound/assistant/agent-daemon-scope.ts`, `apps/website/src/assistant/__tests__/daemon-access.unit.test.ts`, `development/evals/tool-search-caller2-compliance-harness.ts`.
