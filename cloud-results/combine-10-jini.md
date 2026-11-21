**`integ/merge-10-2026-11-21` @ `ab0cb0cb9`** (last content commit; the commit on top only adds this report)

# combine-10 JINI (2026-11-21) — `integ/merge-10-2026-11-21`

Unattended cloud run, 04:43–~05:55 UTC. Branch created from `origin/integ/merge-9-2026-11-21` (`061cd7ce1`). Node v24.22.3 (`/opt/node24`), pnpm 10.33.2 (corepack). No subagents, no codebase-memory tools, no force-push, no `--no-verify`, no publish, no tag; only this branch pushed. `main` / `refactor/terra` / `plan/*` / `release/*` untouched (`refactor/terra` only fetched as the default why-comments base, `release/lockfile-1120` only fetched and merged; Tovu `plan/commit-plans-1120` only fetched/read).

**Summary: all 3 listed merges are done, nothing left. 0 textual conflicts. Every new sheet test passes after the merge. All 16 mutations the sheets name were run, and 15 turned their tests red. J3 "stop fan-out at the first provider" survives in its literal "return the first provider's answer" form and dies in the "only consult the first provider" form. J6's load reproduction (synchronous region query) did not reproduce the race (4/4 green, 3 runs at load avg 9.5). 5 extra mutations not named by a sheet were all red (J1 flags `01`, J3 slice form, R2 ×2, lockfile ×1). Final tree: fresh-worktree build 0 (0 `error TS`); full typecheck 0 after one blocking fix; scripts tsc 0; guard 0 (HW3 34, 0 new). `api:check` showed 11 changed and 1 added export, recorded, then `api:update` committed. Plugin guards incl. `guard:plugins:packed` are 0, and the catalog test is 68/68. **The catalog drifted** (2 integrity rows, regenerated and committed). 2 new reds vs base, both listed and not fixed: size `cms/src/redirects/redirects.ts` 513 > 500, and error gate **Worse** `diagnostics/src/observability/fanout.ts (7 -> 8)`. Error gate shows 24 New (all BASE-RED) and 1 Worse, so `--update` was NOT run. 1 new test red found by the full suites, listed and not fixed: **4 provider-plugins tests time out because of engaps J4**. Proof: removing only J4's `operation.completed` line → 91/91 green. 1 fix commit for a typecheck blocker (dg-c J1 broke `examples/neutral-host`). 19 public packages ship different content on merge-10 than on the release tip `b73045ba8` (byte-level tarball comparison, both refs freshly built). One history deviation: the jx-dgc2 merge commit was linearized by a `pull --rebase` (content identical, ancestry re-recorded, see Method).**

## Method
- **Setup / base first** (unmodified `061cd7ce1`): `pnpm install --frozen-lockfile` 0; `pnpm --no-bail -r build` 0 (0 `error TS`); `pnpm -r --no-bail --if-present run typecheck` 0 + `tsc -p scripts/tsconfig.json --noEmit` 0; `pnpm guard` 0; every ratchet gate recorded (`combine-10-jini-base-<gate>.txt`). The base reds equal combine-9's list exactly (size launch.ts +2, complexity 4, log-safety 10, why-default 4, error gate 24 New).
- **Sheets read before merging**: Tovu `origin/plan/commit-plans-1120` `commit-plans/{jx-engaps,jx-engaps2,jx-dgc,jx-dgc2,jx-redirects2}.{COMMIT-PLAN,REFRESH,report}.md`. The lockfile branch has no sheet.
- **Merges** (main tree, in order): `git merge --no-ff <branch>`. Gates after each merge: `pnpm --no-bail --filter "...[<pre-merge>]" build`; `tsc -p tsconfig.json --noEmit` in each changed package; `pnpm guard`; `SIZE_BASE_REF=061cd7ce1 node scripts/check-size.mjs`; `COMPLEXITY_BASE_REF=061cd7ce1 node scripts/check-complexity.mjs`; `check-hook-injection`; `check-why-comments --base 061cd7ce1` and default (terra); `check-log-safety`; `check-error-gate`. Each was diffed against base (`combine-10-jini-gates-per-merge.txt`). Sheet tests and named mutations ran right after each merge (`combine-10-jini-sheet-tests.txt`, `combine-10-jini-mutations.txt`). A mutation is a one-line perl substitution; the file is restored with `git checkout` and each diff is recorded.
- **History deviation (merge 2)**: the first push used `git pull --rebase`, which **linearized** my merge commit `846f3c6c` into `9d56ea580 ae8986bd2 246854498 31d6ce265` (copies of `0f57dce5f 3556de08b 26d5ddfdd 82bc1aa02`, tree byte-identical to `846f3c6c`). It was pushed before I noticed. No force-push was used: `27d729586` is a `-s ours` merge of `origin/codex/jx-dgc2` with no content change, so `82bc1aa02` is again an ancestor of the branch. Later pushes used `fetch` + `merge-base --is-ancestor` and then a plain push; the remote never moved.
- **Debt files**: none changed on any merged side (no 3-way needed). No debt file was edited in this run.
- **Full suites**: separate worktree `/home/user/jt10` at `26dbb2133` (fresh frozen install 0 + `pnpm --no-bail -r build` 0, 0 `error TS`), `npm --prefix <pkg> run test -- --maxWorkers=2 --minWorkers=1`. neutral-host was re-run at `7b3e4e927` after the fix. `npx vitest run scripts/__tests__` was compared to a base run at `061cd7ce1` (worktree `/home/user/jrel`, fresh frozen install 0 + `-r build` 0).
- **Pack**: `pnpm pack` of all 41 public packages on fresh builds of both merge-10 (`/home/user/jt10`) and the release tip `b73045ba8` (`/home/user/jrel`). Tarballs were extracted and compared file by file. No tarball is committed.

## Base (`061cd7ce1`)
| gate | base |
|---|---|
| build | 0, 0 `error TS` |
| typecheck (+scripts) | 0 / 0 |
| guard | 0 (HW3 34, 0 new; HW9 env-access 70, 0 new; test-only import advisory 490) |
| size | **1 BASE-RED**: `launch.ts:852 <file> (952)` vs 950, `launch.ts:910 createAgentExecutor (418)` vs 416 |
| complexity | **1 BASE-RED**: 4 new (identical to combine-9) |
| hooks | 0 |
| why-comments `--base 061cd7ce1` | 0 |
| why-comments default (terra) | **1 BASE-RED**: 346 lost, 342 allow-listed (4 not) |
| log-safety | **1 BASE-RED**: 10 lines |
| error gate | 0 (WARN) **BASE-RED: 24 New**, 0 Worse, 11 improved |
| `vitest run scripts/__tests__` | **1 BASE-RED**: 14 failed / 998 passed / 33 skipped (1045), plus 1 node:test file vitest cannot load |

## Per branch
| # | branch (tip) | merge commit | conflicts → resolution | red found | fix commits | status |
|---|---|---|---|---|---|---|
| 1 | `release/lockfile-1120` `32b44ef73` | `11fd40f66` | none (scripts only) | none. Filtered build: exit 1 `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT` = no package selected, not a red. scripts tsc 0, guard 0; all ratchets identical to base | — | GREEN |
| 2 | `codex/jx-dgc2` `82bc1aa02` (stack `0f57dce5f` jx-engaps → `3556de08b` jx-engaps2 → `26d5ddfdd` jx-dgc → `82bc1aa02` jx-dgc2) | `846f3c6c` → linearized to `9d56ea580..31d6ce265`; ancestry `27d729586` | none (20 files, auto) | (a) build 0, tsc 0 in admin/agent-plugins/cms/core/diagnostics/provider-plugins, guard 0. (b) **error gate Worse** `[catch-reads-error] packages/diagnostics/src/observability/fanout.ts (7 -> 8)`: J3's new `activeTraceparent` loop copies the existing `activeTraceIds` `catch { failed(); }` shape. WARN mode, LISTED. (c) **full typecheck red**: `examples/neutral-host/src/neutral-host/neutral-host.test.ts(260,68): error TS2345 … Property 'requirePermission' is missing` (dg-c J1 made it required; the sheet's importer lookup did not cover `examples/`). FIXED. (d) **provider-plugins 4 timeouts** (J4), see Tests. LISTED | `7b3e4e927` (neutral-host test passes an allowing `requirePermission` and asserts both completed searches asked for `permissions.use`) | GREEN on build/typecheck/guard; 2 listed reds |
| 3 | `codex/jx-redirects2` `af6ff0339` (on `26d5ddfdd`) | `db99ac556` | none (6 files, auto) | build 0, tsc 0 admin/cms, guard 0. **size New** `[max-lines] packages/cms/src/redirects/redirects.ts:848 <file> (513)`: the sheet recorded >500 "per the owner correction", but the size ratchet has no row for it. LISTED | — | GREEN on build/typecheck/guard; 1 listed red |

After all merges: `26dbb2133` = `pnpm api:update` + gate outputs; `ab0cb0cb9` = regenerated `plugin-catalog/catalog.json` + pack lists.

## Per-sheet tests and mutations
Raw: `combine-10-jini-sheet-tests.txt`, `combine-10-jini-mutations.txt` (each mutation diff + result).
| sheet | new/changed tests after merge | named mutation → result |
|---|---|---|
| engaps J4 (operation counter) | `observability-otel-operations.test.ts` 26/26 (2 new rows pass) | emit outside `once` → **RED** (3 failed: both new rows + the existing once-only case). Drop failure distinction (`'operation.failed': 0`) → **RED** (failed=true row) |
| engaps J5 (run counter) | `observability-otel-surfaces.test.ts` 20/20 (5-status table) | omit interrupted → **RED** (interrupted row). Record twice → **RED** (all 5 rows) |
| engaps J6 (await region) | `admin agent-plugins.test.tsx` 7/7 | remove Expand → **RED** (1). Restore synchronous `getByRole('region')` → passes 1 + 3 more times at load avg 9.5 on 4 cores: **race NOT reproduced** (as the sheet allowed; the awaited form is kept) |
| engaps2 J1 (carrier) | `observability-opentelemetry.test.ts` 66/69: all 12 new cases pass; the 3 failing are the J4 timeouts below | constant flags `00` → **RED** (carrier case + flags-01 row). Constant `01` → **RED** (flags-00 row) |
| engaps2 J2 (remote parent) | same file (2 valid + 9 invalid/omitted rows pass) | ignore remote parent → **RED** (both flag rows). Accept zero IDs → **RED** (both zero-ID rows) |
| engaps2 J3 (forwarding) | `trace-correlation.unit.test.ts` 2/2 | omit hook forwarding → **RED**. "Stop fan-out at first provider" as `return port.activeTraceparent?.()` (the first non-throwing provider's answer, even `undefined`) → **SURVIVED**: the test's order is throwing → active → noop, so no inactive-then-active ordering exists. As `for (const port of live.slice(0, 1))` → **RED** |
| dg-c J1 (search `use` permission, SECURITY) | `search-tool.authorization.test.ts` 1/1 | remove the permission call → **RED** |
| dg-c J3 (content-type cancel) | `content-types/…cov-j2.test.ts` 12/12 | remove the transaction-callback abort check → **RED** (admission case) |
| dg-c QJ1 (routing pins behavior) | `routing.ports.test.ts` 4/4 (5 → 4, README case removed as specified) | absent resolution returns `true` → **RED**. README rewrap: the test no longer reads the README (no README read is left), so it is N/A |
| dg-c2 J4 (entry cancel) | `entries/…cov-j2.test.ts` 10/10 | remove `optional.signal?.throwIfAborted()` → **RED** (admission case) |
| redirects2 R1 (500 bound) | `cms redirects.test.ts` 52/52 (4 new) | remove both guard calls → **RED** (create-501st + activate-at-capacity). Remove the capacity refusal → **RED** (same 2) |
| redirects2 R2 (admin notice) | `admin Redirects.unit.test.tsx` 6/6 | not named by the sheet; ran anyway: notice never shown → **RED**; `>= 500` boundary → **RED** |
| lockfile `npmPublishArgs` | `scripts/__tests__/publish-pending-args.test.ts` 2/2 | no sheet; ran anyway: always omit `--tag next` → **RED** (prerelease case) |

API-baseline rows named by the sheets were all observed in `api:check` (below): J1 `ObservabilityPort` (`activeTraceparent?(): string | undefined`), J2 `AgentRunTrackingOptions` / `OperationTrackingInput` (`traceparent?: string`), dg-c J1 `buildAgentPluginSearchRegistrations`, dg-c J3 `updateContentTypeFields`, dg-c2 J4 `updateEntry`, redirects2 `DYNAMIC_SET_LIMIT`.

## Decisions for the owner
1. **engaps J4 makes 4 existing provider-plugins tests time out** (5 s): `observability-opentelemetry.test.ts` "the factory resolves a general endpoint to /v1/traces and serves the port until disposed", "a settings card supplies no tracer name: the service name is the tracer name", "site attribution: every exported span's resource carries the host's attributes; service.name stays the host's service", and `observability-sentry.test.ts` "a composed tracker correlates Sentry errors to the actual active OTel span only". **Mechanism**: `trackOperation` now records `operation.completed` through `ctx.metric`. In `createOpenTelemetryProvider` (`opentelemetry.ts:308`, `exportEnabled` true) that lazily starts the real OTLP `PeriodicExportingMetricReader`, so `dispose()` flushes metrics over the network to the fake collector (`http://collector.test/` etc.). Here that takes ~8 s (one test passed in 8.18 s with a 60 s timeout). **Proof**: with only the `operation.completed` line removed, both files go 91/91 green; at merge-9 the file was 57/57 green. It may pass on a host where the fake hostname fails DNS fast, but it is network-dependent either way. It does not block build/typecheck/guard → LISTED, not fixed. Likely fix (test-side, not applied): give those factories `metricReaders: []` or an in-memory reader.
2. **Size**: `cms/src/redirects/redirects.ts` 513 lines (new violation from redirects2). Either add a size-debt row or trim. The launch.ts +2 (combine-9 decision 2) is unchanged.
3. **Error gate Worse**: `diagnostics/src/observability/fanout.ts` 7 → 8 `catch-reads-error` (J3, the same idiom as the neighbouring `activeTraceIds`). Accept as debt or switch to a named idiom. `--update` was NOT run (24 New BASE-RED + this Worse).
4. **J3 test gap**: the fan-out stop-early mutation survives in its literal form (see table). An "inactive first provider, active second" row would pin it.
5. **dg-c J1 is a breaking signature change** (`requirePermission` required). In Jini only `examples/neutral-host` called it and is fixed. Tovu's own `apps/website/src/features/agent-plugins/tool-registrations.ts` has a different local `buildAgentPluginSearchRegistrations({ workspaceId, agentPluginLayout })` and does not call the Jini one on its current HEAD (`0df57a3af`). The sheet's V1 "host authorizer binding" is still owed in Tovu. The JSDoc `@example buildAgentPluginSearchRegistrations({ workspaceId, ports })` (`search-tool.ts:275`) is now stale (listed). Permission is checked **after** input-window validation, so a denied principal with a bad `offset` gets the validation error rather than the denial (listed).
6. **Catalog drift**: `guard:plugins:catalog` rewrote 2 `server/index.mjs` integrity rows (observability-opentelemetry, observability-sentry). This is expected, since both bundles embed engaps code. A fresh worktree's prepack produced the identical file, and it is committed (`ab0cb0cb9`). The test passes 68/68 either way, so the drift is not test-enforced. `prepack` regenerates it at publish anyway.
7. **Publish source** (combine-9 decision 1, updated): merge-10 differs from `b73045ba8` in **19** public packages (list below). Publishing 0.7.3-next.1 from `release/lockfile-1120` ships none of merge-8/merge-10's work. Publishing from merge-10 ships all of it **plus** the `--tag next` fix (`publish-pending.ts`), which a prerelease publish needs on npm 11. Note: `publish-pending.ts`'s new `npmPublishArgs` was inserted between `main()`'s JSDoc block and `main`, so `main`'s doc now sits above `npmPublishArgs` (listed, not fixed).
8. **Tarball sha256 is not reproducible** (affects the Tovu packed-candidate check): `pnpm pack` writes the rewritten `workspace:` dependency maps in a random key order. 3 packs of `@jini-ai/sqlite` on the same tree gave 3 different sha256s and 3 dependency orders. `combine-10-jini-packed.txt` therefore also records a reproducible **canon** hash (sorted per-file sha256 with `package.json` key-sorted; 3/3 identical). Compare by canon.
9. **redirects2 open scope items** (from the sheet, unchanged): Trash restore (`updateRedirect` → `restoreTrashedRedirect`) bypasses the cap; the count-before-save check is not concurrency-safe; the admin notice hard-codes `500` although admin depends on `@jini-ai/cms` and `DYNAMIC_SET_LIMIT` is now exported (listed). The Chrome look at 501/500 is owed (not run: no browser look in this run).
10. Carry-overs unchanged: combine-9 decisions 2–5 (launch.ts +2, 4 why-comment rows vs terra, commandShell, cms-forms CHANGELOG heading / `changeset version` → 1.0.0).

## Final gates (at `ab0cb0cb9`; the report commit adds only `cloud-results/`)
| command | base `061cd7ce1` | final |
|---|---|---|
| `pnpm --no-bail -r build` | 0, 0 `error TS` | **0**, 0 `error TS` (fresh worktree `/home/user/jt10` at `26dbb2133`; package source identical to the tip: later commits touch `examples/neutral-host` test, `catalog.json`, `cloud-results/`) |
| `pnpm -r --no-bail --if-present run typecheck` + scripts tsc | 0 / 0 | **0 / 0** (0 `error TS`); it was 1 (`neutral-host`, TS2345) before `7b3e4e927` |
| `pnpm guard` | 0 (HW3 34; HW9 env 70; advisory 490) | **0** (HW3 34, 0 new; HW9 env 70, 0 new; advisory 491, not failing) |
| size | 1 — 2 lines | **1 — 3 lines**: the same 2 BASE-RED + **NEW** `[max-lines] packages/cms/src/redirects/redirects.ts:848 <file> (513)` |
| complexity | 1 — 4 new | **1 — identical 4** (BASE-RED) |
| hooks | 0 | **0** |
| why-comments `--base 061cd7ce1` | 0 | **0** (27 files, 0 lost) |
| why-comments default (terra) | 1 — 346 lost, 342 allow-listed | **1 — identical** (same 4 not allow-listed, BASE-RED) |
| log-safety | 1 — 10 lines | **1 — identical 10** (BASE-RED) |
| error gate | 0 WARN, 24 New, 0 Worse | **0 WARN, 24 New (identical, BASE-RED), 1 Worse (NEW)**, 11 improved → `--update` **not run** |
| `pnpm api:check` | — | 0 (drift listed below; `api:update` committed `26dbb2133`) |
| `pnpm guard:plugins` / `guard:plugins:packed` | — | **0 / 0** |
| `pnpm guard:plugins:catalog` | — | **0**, 68/68, **generate left a 2-row diff** → committed |

Every final size line:
```
New violation: [max-lines] packages/cms/src/redirects/redirects.ts:848 <file> (513)
Worsened from 950: [max-lines] packages/daemon/src/agent-executor/launch.ts:852 <file> (952)
Worsened from 416: [max-lines-per-function] packages/daemon/src/agent-executor/launch.ts:910 createAgentExecutor (418)
```
Every final complexity line (BASE-RED): `agent-runtime/src/agent-protocol/acp/session-results.ts:21 handleRpcError (12)`, `chat/src/core/ag-ui/event-projection.ts:256 drainRunFramesToAgUi (sonarjs/cognitive-complexity 12)`, `chat/src/core/ag-ui/event-projection.ts:292 readConfirmationResume (11)`, `ui/src/features/panel-kit/ErrorNotice.tsx:22 ErrorNotice (11)`.
Why-comments default, the 4 not allow-listed (BASE-RED): `agent-runtime/src/agent-protocol/acp/__tests__/session.test.ts:1754-1756 [4bb23d5ecd7b]`, `core/src/errors/reporter.ts:113-113 [aebef68baf2a]`, `core/src/errors/reporter.ts:156-157 [b550e959f815]`, `sidecar/src/json-ipc.ts:103-113 [fa4f71f9f63b]`.
Every final error-gate line (24 New BASE-RED + 1 Worse NEW):
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
Worse: [catch-reads-error] packages/diagnostics/src/observability/fanout.ts (7 -> 8)
New: [catch-reads-error] packages/http-kit/src/node-bridge.ts (6)
New: [catch-reads-error] packages/mcp/src/federation/hosted/probe.ts (1)
New: [catch-reads-error] packages/platform/src/mail/email-template-operations.ts (1)
New: [catch-reads-error] packages/platform/src/secrets/sealer-contract.ts (1)
New: [catch-reads-error] packages/ui/src/features/memory/react/hooks/useMemoryConnectors.parts.hooks.ts (3)
New: [failure-text-from-catalog] packages/ui/src/features/memory/react/hooks/useMemoryConnectors.parts.hooks.ts (3)
New: [catch-reads-error] packages/ui/src/features/version-manager/react/hooks/useVersionManager.state.ts (1)
New: [catch-reads-error] packages/ui/src/react/hooks/usePersistedDisclosure.ts (2)
```
Every final log-safety line (BASE-RED, identical to base):
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

## Tests
Full suites (raw `combine-10-jini-suites.txt`), every code-touched package plus neutral-host (the only in-repo caller of the changed search signature), `--maxWorkers=2 --minWorkers=1`:
| package | result | vs combine-9 |
|---|---|---|
| core | 2947/2947, exit 0 | = 2947 (extended interfaces, no new cases) |
| diagnostics | 1090/1090, exit 0 | = 1090 (J3 extended 2 existing cases) |
| provider-plugins | **4 failed** / 914 passed (918), exit 1 | 901 → 918 = +17 (J4 +2, J5 +3, J1 +1, J2 +11) |
| agent-plugins | 2188 passed + 2 skipped, exit 0 | 2187 → 2188 (+1 dg-c J1) |
| cms | **1 failed** / 5008 passed (5009), exit 1 | 5002 → 5009 = +7 (dg-c J3 +2, dg-c2 J4 +2, QJ1 −1 as specified, redirects2 +4) |
| admin | 3074/3074, exit 0 | not in combine-9's set (redirects2 R2 +1) |
| examples/neutral-host | at `7b3e4e927`: **1 failed** / 38 passed / 13 todo (52) | = 52 |
| `vitest run scripts/__tests__` | **14 failed** / 1000 passed / 33 skipped (1047) | base 14 failed / 998 passed (1045): same 14, +2 = `publish-pending-args` |

Every red line:
- **provider-plugins (4, NEW, caused by engaps J4, decision 1)**: `src/__tests__/observability-opentelemetry.test.ts > the factory resolves a general endpoint to /v1/traces and serves the port until disposed` · `… > a settings card supplies no tracer name: the service name is the tracer name` · `… > site attribution: every exported span's resource carries the host's attributes; service.name stays the host's service` · `src/__tests__/observability-sentry.test.ts > a composed tracker correlates Sentry errors to the actual active OTel span only`. All `Error: Test timed out in 5000ms.`
- **cms (1, BASE-RED, lockfile decision 1)**: `forms/src/__tests__/package-boundary.test.ts > forms keeps its own published root entry and CMS exposes no forms alias` (CHANGELOG heading 0.7.1 vs 0.7.3-next.1).
- **neutral-host (1, BASE-RED since combine-7)**: `src/contribution-contracts.test.ts > contribution contracts > walks every contribution file, and each kind is in the contract table`. At `26dbb2133` (before the fix) a second red, `neutral-host.test.ts > moved classes in a neutral host > plugin search: finds installed plugins by the host's own names`, was caused by dg-c J1 and is green after `7b3e4e927`.
- **scripts (14 + 1 unloadable, all BASE-RED, identical set at `061cd7ce1`)**: `check-env-access.test.ts` ×2 (debt current; host scan), `connection-card.packed.test.ts` ×1, `coupling-isolation.test.ts` ×6 (model-discovery policy; platform command / process / proxy-env; shared secret-input owner; web entry HTML peers), `extract-s3-source-contracts.test.ts` ×2 (F3 A2 changeset; F5 em-dash), `optional-peer-contract.test.ts` ×3 (real default entries; daemon → express; ui → lexical), plus `check-why-comments.test.mjs` "No test suite found" (a `node:test` file that `test:scripts:node` runs, not vitest). `pnpm test:scripts:node` was not run.

## Exported signatures and subpaths for the Tovu run
`pnpm api:check` (`combine-10-jini-api-changes.txt`; 40 packages, 677 entries, 17194 symbols), committed with `api:update` in `26dbb2133`:
- **@jini-ai/core `./contracts/observability`** (additive): `ObservabilityPort.activeTraceparent?(): string | undefined` (the noop port returns `undefined`); `AgentRunTrackingOptions.traceparent?: string`; `OperationTrackingInput.traceparent?: string`. A valid `00-<32hex>-<16hex>-<2hex>` remote parent wins over local parentage; zero/malformed IDs are ignored.
- **@jini-ai/provider-plugins `./observability-opentelemetry/port`**: `TracerPort.startSpan(required, optional?: { parent?: TraceSpanPort; traceparent?: string })` (additive). New runtime metrics: counter `operation.completed` {`operation.name`, `operation.failed` 0|1} and counter `agent.run.completed` {`agent.run.status`}.
- **@jini-ai/agent-plugins `./lifecycle/host-tools`** — **BREAKING**: `buildAgentPluginSearchRegistrations(routeDeps: AgentPluginSearchToolDeps & { requirePermission: RequireHostToolPermission }, _optional?)`. The handler awaits `requirePermission({ workspaceId, principalId, permission: ports.permissions.use }, { entityType: 'workspace', entityId: workspaceId })` before reading the workspace.
- **@jini-ai/cms `./content-types`**: `updateContentTypeFields(required, optional: { signal?: AbortSignal | undefined } = {})` (additive). **`./entries`**: `updateEntry(required, optional: { signal?: AbortSignal | undefined } = {})` (additive; `WidgetHostPorts.entries.updateEntry` follows via `typeof`). **`./redirects`**: new `DYNAMIC_SET_LIMIT` (= 500). `createRedirect` / `updateRedirect` signatures are unchanged but now throw `RedirectValidationError("This site already has 500 active wildcard redirects, the most it can use. Turn off or merge some before adding another.")` at capacity.
- **@jini-ai/admin `./redirects`, `./redirects/react`**: `redirectsMessagesEn` / `redirectsModule` / `redirects` fingerprints changed by one new message key, `"Only the first 500 active wildcard redirects are used. Turn off or merge some."`. Tovu translations owe this key.
- No subpath added or removed. combine-9's list (R8a/b, node-adapters `./agent-plugins`, etc.) still applies underneath.

## Release readiness (no publish)
- `guard:plugins` 0, `guard:plugins:packed` 0, `guard:plugins:catalog` 0 (68/68) — catalog regenerated and committed (decision 6). Raw: `combine-10-jini-release-readiness.txt`.
- Every `package.json` version on merge-10 is `0.7.3-next.1`. No version or range differs from `b73045ba8`; only cms `package.json` differs, with the merge-8 `./seo/cover-image` export.
- **Packed candidates**: `combine-10-jini-packed.txt` has name, version, tarball, sha256, file count and canon hash for all 41 public packages (decision 8: compare canon, not sha256).
- **Tarball content vs `b73045ba8`** (both refs freshly built and packed; raw `combine-10-jini-pack-diff-vs-release-tip.txt`). **19 DIFFER in content**: admin (821 files; redirects notice), agent-plugins (605; search permission + merge-8 automatic-use), agent-runtime (438; merge-8), chat (491 vs 489; merge-8 `ag-ui-fetch-agent`), cli (42; merge-8), cms (892 vs 890; merge-8 cover-image + cancel + redirects bound; `package.json` export), core (518; observability + merge-8 reporter), daemon (402; merge-8), devops (210; merge-8), diagnostics (120; fan-out/hooks + merge-8), infra (30; merge-8), integrations (262; merge-8), mcp (230; merge-8), platform (274; merge-8), plugin-catalog (5; `catalog.json` hashes), plugins (146; merge-8), provider-plugins (209; otel carrier/counters + the bundled otel/sentry plugin `server/index.mjs` + `jini.plugin.json`), sidecar (48; merge-8), ui (1578; merge-8). **6 differ only in `package.json` dependency key order** (pack nondeterminism, semantically equal): commerce, node-adapters, oauth, registry, server, sqlite. **16 identical**: agentic, analytics, artifacts, capability-providers, cms-forms, cookie-consent, db, desktop-host, http-kit, memory, protocol, sandbox, search, ui-kit, user-management, vibecoding.
- Publishing from merge-10 also needs `scripts/publish-pending.ts` from merge-10 (the `--tag next` fix). The release tip `b73045ba8` lacks it; it exists only on `release/lockfile-1120` `32b44ef73` and here.

## Left / next
1. Owner: decisions 1–9 (above all 1: J4 test timeouts; 7: publish source).
2. Owed by the sheets, not done here: the Chrome look for redirects2 R2 at 501/500; Tovu V1 host authorizer binding for dg-c J1; Tovu translation of the new admin redirects message; J6 retained failure output (no failure reproduced).
3. Not run: `pnpm test:scripts:node`, e2e/playwright, knip, suites of untouched packages (core's additive interface change compiled in every dependent's build and typecheck).
4. combine-9's Left items 2–5 are unchanged (R8 step 9, R11b-3, lockfile reds, combine-8 items).

## Pushed SHAs (`integ/merge-10-2026-11-21`, first-parent order)
`11fd40f66` (merge lockfile) · `9d56ea580` `ae8986bd2` `246854498` `31d6ce265` (jx-dgc2 stack, linearized) · `27d729586` (jx-dgc2 ancestry) · `db99ac556` (merge redirects2) · `26dbb2133` (api:update + gate outputs) · `7b3e4e927` (neutral-host fix) · `ab0cb0cb9` (catalog + pack lists) · report commit on top.
