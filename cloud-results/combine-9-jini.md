**`integ/merge-9-2026-11-21` @ `89541e499`** (last content commit; the commit on top only writes this SHA line)

# combine-9 JINI (2026-11-21) — `integ/merge-9-2026-11-21`

Unattended cloud run, 03:29–~04:20 UTC. Branch created from `origin/integ/merge-8-2026-11-21` (`3ad0c5671`). Node v24.22.3 (`~/.local/node24` → `/opt/node24`), pnpm 10.33.2 (corepack). No subagents, no codebase-memory tools, no force-push, no `--no-verify`, no publish, no tag; only this branch pushed. `main` / `refactor/terra` / `plan/*` / `release/*` untouched (`refactor/terra` only fetched as the default why-comments base, `release/lockfile-1120` only fetched and merged; Tovu `plan/commit-plans-1120` only fetched/read).

**Summary: the 1 listed merge is done, nothing left. 2 textual conflicts (both daemon, resolved by keeping both sides' intent). Final tree: fresh-worktree build 0 (0 `error TS`), full typecheck 0 / scripts 0, guard 0 (HW3 34, 0 new), hooks 0, `api:check` 0 drift (`api:update` wrote nothing), plugin guards incl. `guard:plugins:packed` 0, catalog 68/68 with no drift, every release-branch version kept exactly (0.7.3-next.1; no package.json version/range differs from `b73045ba8`). The lockfile run's 28 why-comment losses are allow-listed per the coordinator decision ("code deleted by R8b step 6"). No new red vs base: size / complexity / log-safety / why-default (terra) / error gate are all BASE-RED and unchanged in content (size: the same +2 lines over the release's lowered debt values). Error gate 24 New (all BASE-RED), 0 Worse → `--update` NOT run. Full suites of 20 packages + 2 examples: all green except 2 known reds (cms-forms CHANGELOG heading — lockfile decision 1; neutral-host contribution walk — BASE-RED), both listed, not fixed. 16 public packages ship different code on merge-9 than on the release tip `b73045ba8` (all merge-8 work) — see "Packages that differ".**

## Method
- Base first (unmodified `3ad0c5671`): `pnpm install --frozen-lockfile` 0; `pnpm --no-bail -r build` 0 (0 `error TS`); `pnpm -r --no-bail --if-present run typecheck` 0 + `tsc -p scripts/tsconfig.json --noEmit` 0; `pnpm guard` 0; every ratchet gate recorded (`combine-9-jini-base-<gate>.txt`). `origin/refactor/terra` had to be fetched before the default why-comments run (first attempt: `bad revision`, re-run after the fetch).
- Merge (main tree): `git merge --no-ff origin/release/lockfile-1120`; conflicts resolved; `pnpm install --frozen-lockfile` 0; `pnpm --no-bail --filter "...[3ad0c5671]" build` 0; `tsc -p tsconfig.json --noEmit` in every changed package (one output file per package); `pnpm guard`; `SIZE_BASE_REF=3ad0c5671 node scripts/check-size.mjs`; `COMPLEXITY_BASE_REF=3ad0c5671 node scripts/check-complexity.mjs`; `node scripts/check-hook-injection.mjs`; `node scripts/check-why-comments.mjs --base 3ad0c5671` and default (terra); `node scripts/check-log-safety.mjs`; `node scripts/check-error-gate.mjs` — each diffed against base (`combine-9-jini-gates-per-merge.txt`). Final gates re-run at the tip (`combine-9-jini-<gate>.txt`).
- Debt files: none was changed on both sides since the merge base `06559affb` (merge-8 changed `error-gate-debt.json`, `why-comments-debt.json`; the release changed `env-access-debt.json`, `injection-debt.json`, `size-debt.json`) → no per-key 3-way needed; all auto-merged.
- Owed checks: Tovu `origin/plan/commit-plans-1120` has **no** `commit-plans/<job>.*.md` for the lockfile/release run (job list: bg-jini … xd-rs-c2, none for `lockfile-1120`/`release`), so no commit-plan tests/mutations were owed. The release branch's own `cloud-results/lockfile-1120.md` LEFT items are listed under "Left / next", not attempted.
- Full suites: separate worktree `/home/user/jt` at `67b904170` (fresh frozen install 0 + `pnpm --no-bail -r build` 0, 0 `error TS`), `npm --prefix <pkg> run test -- --maxWorkers=2 --minWorkers=1`.
- Pack lists: `npm pack --dry-run --json` in the fresh worktree (the main tree's `dist/` holds stale files the release deleted, e.g. agent-plugins `dist/lifecycle/node.*`; a first listing there was discarded).

## Base (`3ad0c5671`)
| gate | base |
|---|---|
| build | 0, 0 `error TS` |
| typecheck (+scripts) | 0 / 0 |
| guard | 0 (zero violations; HW3 34; HW9 73 total, 0 new) |
| size | **1 BASE-RED**: 2 worsened (`daemon/src/agent-executor/launch.ts:826 <file> (1046, was 1044)`, `:1005 createAgentExecutor (431, was 429)`) |
| complexity | **1 BASE-RED**: 4 new (combine-8 decisions 1–2) |
| hooks | 0, 0 direct calls |
| why-comments `--base 3ad0c5671` | 0 (0 files) |
| why-comments default (terra) | **1 BASE-RED**: 318 lost, 314 allow-listed (4 not: combine-8 decision 5) |
| log-safety | **1 BASE-RED**: 10 "New raw log path" lines |
| error gate | 0 (WARN) **BASE-RED: 24 New**, 0 Worse, 11 improved |

## Per branch
| # | branch (tip) | merge | conflicts → resolution | red found | fix commits | status |
|---|---|---|---|---|---|---|
| 1 | `release/lockfile-1120` `b73045ba8` | `fb41117bd` | **2 textual (daemon)**: (a) `src/agent-executor/acp-events.ts` `acpSessionOptions` — merge-8 (jz2-a ACP-3/4/5) added the `state` parameter (descendant pids for `beforeRelease`), R8b retyped the return as `Parameters<AgentRuntimePort['sessions']['attachAcp']>[1]` → kept both (merge-8 signature, R8b return type; the daemon port's `AttachAcpSessionOptions` already carries `effort`, `resumeSessionId`, `beforeRelease`). (b) `src/agent-executor/__tests__/agent-executor.test.ts` `createAcpExecutor` — merge-8 passed `spawn`/`listProcessSnapshots`/`stopProcesses`/`prepareAgentLogFile` as flat executor options, R8b moved them into `runtimeFixture(...)` / `agentRuntimeFixture(...)` → took R8b's shape (auto-merged already) and re-added merge-8's `listProcessSnapshotsRejects` throw (ACP-5 "snapshot failure" case) into the fixture's `listProcessSnapshots`. Auto-merged: daemon `contracts.ts`, `launch.ts`, `mcp-bridge-staging.test.ts`, cli `local-daemon-discovery.test.ts`, cms `package.json`, sidecar `daemon-registry.ts` + `index.test.ts`, `api-baseline/jini-ai__daemon.json`. Versions/catalog: no conflict; every `package.json` version and range equals the release tip | build 0, tsc 0 in all 41 changed packages with a tsconfig (minimal-host, plugin-catalog have none), guard 0, hooks 0, complexity / log-safety / error gate identical to base. **why-comments `--base 3ad0c5671`: 28 lost** (27 R8b step 6 + 1 R11b-1 step 4 — the lockfile run's decision 3) → allow-listed per the coordinator decision. **size**: still the same 2 lines over debt (release lowered the rows to 950/416; merge-8's +2 remains: 952/418) — BASE-RED carried, listed | `366e65b47` (28 why-comment allow-list rows, reason "code deleted by R8b step 6 …", each naming its old location) | GREEN (ratchets BASE-RED only) |

After the merge: `pnpm api:check` 0 drift (`combine-9-jini-api-changes.txt`: 40 packages, 677 entries, 17193 symbols); `pnpm api:update` wrote no change (the auto-merged baselines already matched), so no api commit beyond the recorded check (`67b904170`).

## Decisions for the owner
1. **Publish source**: the release tip `b73045ba8` does **not** contain merge-8's work (c7, bg, rs3, jz2-b, jz2-a, jm7-b, jm7-a). 16 public packages ship different code on merge-9 (list below), with the same version 0.7.3-next.1. Publishing from `release/lockfile-1120` as planned ships 0.7.3-next.1 **without** merge-8; publishing from merge-9 ships both. If the release branch is published first, merge-9's 16 packages need a new prerelease number (next.2) before they can be published.
2. **Size (BASE-RED, unchanged)**: `daemon/src/agent-executor/launch.ts` file 952 vs debt 950, `createAgentExecutor` 418 vs 416 — the release paid R8b's debt down by 94/13 lines; merge-8's jz2-a +2 (combine-8 decision 4) is still owed. Trim 2 lines or raise both rows by 2.
3. **Why-comments**: the 28 R8b/R11b-1 rows are allow-listed (coordinator decision applied); combine-8 decision 5 (4 jz2-a rows) is still open — default (terra) still fails on exactly those 4.
4. **commandShell shape** (lockfile decision 4): accepted per the coordinator; merged unchanged.
5. Carry-overs from the lockfile run, untouched here: `changeset version` would mint 1.0.0 (4 `major` bumps) → manual 0.7.3-next.1 cut kept, cms-forms CHANGELOG-heading test stays red; raised peer floors `^0.7.3-next.1`; Tovu re-lock after publish.

## Final gates (at `67b904170`; `429ac28e0` and later add only `cloud-results/`)
| command | base `3ad0c5671` | final |
|---|---|---|
| `pnpm --no-bail -r build` | 0, 0 `error TS` | **0**, 0 `error TS` (fresh worktree `/home/user/jt`) |
| `pnpm -r --no-bail --if-present run typecheck` + scripts tsc | 0 / 0 | **0 / 0** (0 `error TS`) |
| `pnpm guard` | 0 (HW3 34; HW9 73) | **0** (HW3 34, 0 new; HW9 70, 0 new; test-only cross-package import advisory 465 → 490, not failing) |
| size | 1 — 2 worsened (1046/1044, 431/429) | **1 — the same 2 lines** (952/950, 418/416; debt values lowered by the release) — BASE-RED |
| complexity | 1 — 4 new | **1 — identical 4** (BASE-RED) |
| hooks | 0 | **0** |
| why-comments `--base 3ad0c5671` | 0 | **0** — 28 lost, 28 allow-listed |
| why-comments default (terra) | 1 — 318 lost, 314 allow-listed | **1** — 346 lost, 342 allow-listed (4 not: identical to base) — BASE-RED |
| log-safety | 1 — 10 lines | **1 — identical 10** (BASE-RED) |
| error gate | 0 WARN, 24 New, 0 Worse | **0 WARN, 24 New (identical, all BASE-RED), 0 Worse**, 11 improved → `--update` **not run** (New ≠ 0) |
| `pnpm api:check` | — | **0** (no drift; `api:update` no change) |
| `pnpm guard:plugins` / `guard:plugins:packed` | — | **0 / 0** |
| `pnpm guard:plugins:catalog` (generate + test) | — | **0**, 68/68, generate left no diff (no catalog drift) |

Every final error-gate line (all BASE-RED):
```
New: [catch-reads-error] packages/admin/src/forms/react/hooks/use-form-editor-parts.hooks.ts (3)
New: [catch-reads-error] packages/admin/src/media/adapters/http.ts (1)
New: [catch-reads-error] packages/admin/src/react/entities/FailureNotice.tsx (1)
New: [no-generic-failure-text] packages/admin/src/react/entities/FailureNotice.tsx (1)
New: [catch-reads-error] packages/agent-runtime/src/agent-protocol/acp/session-permission.ts (3)
New: [catch-reads-error] packages/agent-runtime/src/agent-protocol/acp/session-run.ts (3)
New: [catch-reads-error] packages/agent-runtime/src/claude-stream-handler.ts (1)
New: [catch-reads-error] packages/agent-runtime/src/json-event-stream-shared.ts (1)
New: [catch-reads-error] packages/chat/src/embed-widget/browser/agent-inventory.ts (2)
New: [catch-reads-error] packages/core/src/contracts/ai-trace/capture.ts (1)
New: [catch-reads-error] packages/core/src/contracts/ai-trace/sinks.ts (1)
New: [catch-reads-error] packages/daemon/src/agent-executor/mcp-json-file.ts (1)
New: [failure-text-from-catalog] packages/db/src/sqlite/stopped.ts (1)
New: [catch-reads-error] packages/desktop-host/src/electron/app-version.ts (1)
New: [catch-reads-error] packages/devops/src/packaging/electron/tree-fingerprint.ts (1)
New: [catch-reads-error] packages/diagnostics/src/web-evidence/bounded-body.ts (1)
New: [catch-reads-error] packages/http-kit/src/node-bridge.ts (6)
New: [catch-reads-error] packages/mcp/src/federation/hosted/probe.ts (1)
New: [catch-reads-error] packages/platform/src/mail/email-template-operations.ts (1)
New: [catch-reads-error] packages/platform/src/secrets/sealer-contract.ts (1)
New: [catch-reads-error] packages/ui/src/features/memory/react/hooks/useMemoryConnectors.parts.hooks.ts (3)
New: [failure-text-from-catalog] packages/ui/src/features/memory/react/hooks/useMemoryConnectors.parts.hooks.ts (3)
New: [catch-reads-error] packages/ui/src/features/version-manager/react/hooks/useVersionManager.state.ts (1)
New: [catch-reads-error] packages/ui/src/react/hooks/usePersistedDisclosure.ts (2)
```
Every log-safety line (all BASE-RED):
```
New raw log path: [raw-error] packages/chat/src/core/assistant-client/ag-ui-fetch-agent.ts (1)
New raw log path: [stored-error-text] packages/core/src/approval-batch-chain.ts (2)
New raw log path: [stored-error-text] packages/daemon/src/agent-executor/codex/home-staging.ts (1)
New raw log path: [stored-error-text] packages/daemon/src/http/tool-execution-routes.ts (1)
New raw log path: [stored-error-text] packages/desktop-host/src/app-version/loader.ts (2)
New raw log path: [error-format] packages/desktop-host/src/app-version/update-check.ts (1)
New raw log path: [error-text] packages/desktop-host/src/app-version/update-check.ts (1)
New raw log path: [error-format] packages/http-kit/src/node-bridge.ts (1)
New raw log path: [error-helper] packages/http-kit/src/node-bridge.ts (1)
New raw log path: [console] packages/ui/src/features/panel-kit/hooks/use-settings-slice-save.hooks.ts (1)
```
Every complexity line (BASE-RED): `agent-runtime/src/agent-protocol/acp/session-results.ts:21 handleRpcError (12)`, `chat/src/core/ag-ui/event-projection.ts:256 drainRunFramesToAgUi (sonarjs/cognitive-complexity 12)`, `chat/src/core/ag-ui/event-projection.ts:292 readConfirmationResume (11)`, `ui/src/features/panel-kit/ErrorNotice.tsx:22 ErrorNotice (11)`. Size lines (BASE-RED): `daemon/src/agent-executor/launch.ts:852 <file> (952, debt 950)`, `launch.ts:910 createAgentExecutor (418, debt 416)`. Why-comments default, the 4 not allow-listed (BASE-RED, combine-8 decision 5): `agent-runtime/src/agent-protocol/acp/__tests__/session.test.ts:1754-1756 [4bb23d5ecd7b]`, `core/src/errors/reporter.ts:113 [aebef68baf2a]`, `core/src/errors/reporter.ts:156-157 [b550e959f815]`, `sidecar/src/json-ipc.ts:103-113 [fa4f71f9f63b]`.

## Tests
Full suites at `67b904170` in worktree `/home/user/jt` (fresh frozen install 0 + `pnpm --no-bail -r build` 0, 0 `error TS`), every code-touched package of this merge plus every package combine-8 touched (20 packages + 2 examples), `--maxWorkers=2 --minWorkers=1` (commerce/search not in the set, so no doubled flag); raw `combine-9-jini-suites.txt`:
daemon 4854 (+1 skipped), sidecar 408 (+3), server 469 (+1), mcp 1885, node-adapters 35, agent-plugins 2187 (+2), plugins 1017, plugin-catalog 68, provider-plugins 901, chat 4486 (+1), cli 605, infra 155, agent-runtime 4537 (+1), core 2947, platform 3354 (+6), devops 1327, diagnostics 1090, integrations 2077, ui 8818, minimal-host 3 — all exit 0. **2 red, both already listed by the lockfile run, neither blocks build/typecheck/guard → LISTED, not fixed:**
- **cms 1/5002** `forms/src/__tests__/package-boundary.test.ts` "forms keeps its own published root entry and CMS exposes no forms alias": `expected '0.7.1' to be '0.7.3-next.1'` — the CHANGELOG heading only `changeset version` writes (lockfile decision 1; RED on the release tip too).
- **neutral-host 1/52** `src/contribution-contracts.test.ts` "walks every contribution file, and each kind is in the contract table": `expected 0 to be greater than or equal to 27` — walks `tovu-*.json`, combine-7 renamed them `jini-*.json` (BASE-RED since combine-7).

Count checks against the two parents (no tests lost in the merge): every count is ≥ both parents' final counts (combine-8 final / lockfile-1120 full suite) except where one side deleted tests on purpose — sidecar 408 = release 416 − 8 (merge-8's E9 deleted `jsonIpcError` and its cases: combine-8 406 + the release's +2) and agent-plugins 2187 = release 2187 < combine-8 2198 (R11a moved the Node-effect cases to node-adapters, 16 → 35; merge-8 changed no agent-plugins test). daemon 4854 vs 4844 / 4841, mcp 1885 vs 1882, plugins 1017 vs 1015 / 1017, server 469 = release; the rest equal combine-8's final counts. (The daemon count sits 8 above the naive sum of both sides' additions; vitest counts `it.each` rows, so the excess was not chased.)

## Packages that differ from the release-branch tip `b73045ba8`
`git diff b73045ba8 HEAD -- packages` (raw: `combine-9-jini-diff-vs-release-tip.txt`): **no** `package.json` version or dependency range differs (only cms `package.json` gains the `./seo/cover-image` entry + `isolation.shared` row). Packages whose **shipped source** differs (non-test files; all of it merge-8 work), i.e. whose 0.7.3-next.1 tarball differs between the two refs:

| package | non-test files differing | pack (merge-9, fresh build) |
|---|---|---|
| @jini-ai/agent-plugins | `lifecycle/automatic-use.ts` | 605 files |
| @jini-ai/agent-runtime | acp `models.ts`, `session-results.ts`, `session-run.ts`, `session-state.ts`, `session-types.ts` | 438 |
| @jini-ai/chat | `ag-ui/event-projection.ts`, `assistant-client/ag-ui-transport.ts`, **new** `assistant-client/ag-ui-fetch-agent.ts`, `embed-widget/react/embed.tsx` | 490 (incl. `dist/core/assistant-client/ag-ui-fetch-agent.{js,d.ts}`, absent on the release tip) |
| @jini-ai/cli | `daemon-url.ts`, `local-daemon-discovery.ts`, `main.ts`, `prompt.ts`, README | 41 |
| @jini-ai/cms | `package.json` (new `./seo/cover-image` export), `media/{chat-preview,cover-image,ports,repo.memory}.ts`, **new** `seo/cover-image.ts`, `trash/adapters/directory.node.ts` | 891 (incl. `dist/seo/cover-image.{js,d.ts}`, absent on the release tip) |
| @jini-ai/core | `errors/reporter.ts` | 518 |
| @jini-ai/daemon | `agent-executor/{acp-events,contracts,launch}.ts`, `frontend-session-registry.ts`, `http/frontend-control.ts`, `ports/agent-runtime-sessions.ts` | 401 |
| @jini-ai/devops | `local-dev/node-runtime.ts` | 209 |
| @jini-ai/diagnostics | `web-evidence/page-work-budget.ts` | 120 |
| @jini-ai/infra | `events/outbox/worker.ts` | 29 |
| @jini-ai/integrations | `hosted-mcp/sign-in-configuration.ts`, `webhooks/tools/tool-handlers.ts` | 261 |
| @jini-ai/mcp | `core/config.ts`, `core/opencode/config.ts` | 229 |
| @jini-ai/platform | `fs/file-lock.ts` | 273 |
| @jini-ai/plugins | `host/node/runtime-core.ts` | 145 |
| @jini-ai/sidecar | `json-ipc.ts` (E9 removed `jsonIpcError`), `daemon-registry.ts` | 47 |
| @jini-ai/ui | `features/panel-kit/ErrorNotice.tsx` | 1577 |

The pack file lists (`combine-9-jini-pack-dry-run.txt`, all exit 0, all `0.7.3-next.1`) were taken on merge-9 only; the release tip was not rebuilt, so its lists are derived: identical except the 2 new source files above (chat −2 files, cms −2 files) — file *contents* differ in all 16. The other 25 public packages are byte-identical in source between the two refs.

## Exported signatures and subpaths for the Tovu run
From the api-baseline diff `3ad0c5671..HEAD` (what merge-9 adds over merge-8; all from the release branch, already recorded):
- **New subpath**: node-adapters `./agent-plugins` → `createNodeAgentPluginEffects` (moved from agent-plugins).
- **Removed subpath**: agent-plugins `./lifecycle/node` (`createNodeAgentPluginEffects`) — import it from `@jini-ai/node-adapters/agent-plugins`.
- **New exports**: node-adapters `./process#{createSpawnPort({ spawn }), nodeSpawnPort, nodeCommandShell(...), SpawnFunction}`; daemon `.#{McpBridgeProbe, McpBridgeProbeEntry, FailRunBeforeStartInput}`; mcp `.#OwnedJsonInstallFiles { fileLock: FileLockPort; writer: Pick<AtomicFileWriterPort, 'writeText' | 'backupOriginalOnce'> }`; sidecar `.#JsonFileWriter = Pick<AtomicFileWriterPort, 'writeJson'>`.
- **Changed (breaking for callers)**: daemon `createAgentExecutor` / `CreateAgentExecutorOptions` (R8a/b: `runtime`, `hostEnv`, `agentRuntime: AgentRuntimePort` required; legacy runtime options/resolvers removed), `probeMcpBridge`, `failRunBeforeStart`, `spawnAgentChildProcess`, `stageLogFile`, `stagePromptFile` and the other `resolve*` helpers; agent-plugins `AgentPluginLifecyclePorts` (`fileLock` + `atomicWriter` required); plugins `PluginSourceDeps` / `PluginRuntimeHostBinding` / `createPluginSourceService` (`fileLock` required); mcp `installOwnedJsonAgent({ …, files: { fileLock, writer } })`; sidecar `writeJsonFile` / `writeDaemonRegistryRecord` / `createSupervisorRegistry({ registryPath, writer })` (writer required), `NodeDaemonProcessRequired` gains `process: ProcessControlPort` and `commandShell: { platform, fallbackComSpec }`; server `CreateJiniKernelBaseOptions` (`featureOptions.terminal` takes a host-built `terminalService`).
- merge-8's own list (combine-8 report) still applies on top: cms `./seo/cover-image`, chat `./core/ag-ui` + `./transports/ag-ui#createAgUiFetchAgent`, `mountEmbedChat` requires `surfaces`, cli `resolveDaemonUrl({ env })`, devops `selectNodeRuntime({ …, env })`, `AgUiRunClient.resumeAgUiRun` required, ACP/daemon/ui additive options.
- Tovu owes (from both reports): the lockfile run's host pairs are on Tovu `release/lockfile-1120` (`71cd5a84b`, `8258649f5`, `aa9f8d3db`), not on Tovu merge-8 — the Tovu combine must merge them together with merge-8's host items; Tovu lockfiles regenerate only after the publish.

## Knip (list only, nothing removed)
`pnpm quality:knip` on the merged tree (`combine-9-jini-knip.txt`). **Unused dependencies (10)** — same as combine-8: `@jini-ai/db`, `@jini-ai/http-kit`, `@jini-ai/oauth`, `@jini-ai/registry`, `@jini-ai/sidecar` (examples/minimal-host); `@jini-ai/http-kit`, `@jini-ai/mcp` (examples/reference-web); `zod` (packages/agentic); `unpdf`, `mammoth` (packages/cms). Also 60 unused files, 24 unused devDependencies, 23 unlisted dependencies, 1 unlisted binary, 15 unresolved imports, 220 unused exports (221 on combine-8), 459 unused exported types, 26 duplicate exports — every line in the file. The node-adapters `@jini-ai/agent-plugins` optional peer + devDependency (R11a) is not flagged.

## Left / next
1. Owner: decisions 1–5 (above all decision 1 — which ref to publish).
2. LEFT from the lockfile run (owed, not attempted): **R8 step 9** (drop daemon's `@jini-ai/agent-runtime` dependency) waits for R7's `model-proxy` / `xai` / `research` / `agents` route pairs; **R11b-3** (thread `GuardedHttpPort.fetch` through the media dispatch engine, 29 files, 21 with `vi.mock('@jini-ai/platform/http/guarded')`, plus Tovu/reference-web hosts).
3. Lockfile run's still-open reds (not re-checked here unless in the suites above): cms-forms CHANGELOG heading test (needs `changeset version`), neutral-host `contribution-contracts.test.ts` (BASE-RED), plugin-fixture-provider version pin (BASE-RED), reference-web e2e (ENV), Tovu `jini-mcp-peers` lock-sync ×2 until re-lock.
4. combine-8 open items unchanged: decisions 1–9, mutations NOT-RUN, findings F1–F3, ACP parity items needing a model host.
5. Not run: e2e/playwright, `pnpm test:scripts`, mutations (no commit plan owed any for this branch), the release-tip tarball rebuild for a byte-level pack diff.
