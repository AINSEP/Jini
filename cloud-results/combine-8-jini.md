**`integ/merge-8-2026-11-21` @ `d017d5ffa`** (last merge/fix commit; the commits on top add only this report and `cloud-results/combine-8-jini-*.txt`)

# combine-8 JINI (2026-11-21) — `integ/merge-8-2026-11-21`

Unattended cloud run, 01:57–~03:20 UTC. Branch created from `origin/integ/merge-7-2026-11-20` (`06559affb`). Node v24.22.3 (`~/.local/node24` → `/opt/node24`), pnpm 10.33.2 (corepack). No subagents, no codebase-memory tools, no force-push, no `--no-verify`; only this branch pushed. `main` / `refactor/terra` / `plan/*` untouched (`refactor/terra` only fetched as the default why-comments base; Tovu `plan/commit-plans-1120` only fetched/read).

**Summary: all 7 listed merges done, nothing left. No textual conflicts. Final tree: full build 0 (0 `error TS`), full typecheck 0 / scripts 0, guard 0 (HW3 34, 0 new), hooks pass, api:update committed. Red found and fixed (build/typecheck/guard blockers + reds in the merged branches' own new tests): jz2-a TS2345 ×2 and 2 new ACP-5 daemon cases; jm7-a TS6059 ×16 + TS2741 + guard R2 ×2 (cross-package relative test imports) and 1 host-surface pin; K-04b-J's owed entry tripped guard SI-domain. RED vs base and LISTED, not fixed: complexity 4 new (jz2-a 2, jm7-a 2; the 2 base lines are gone via jm7-b), size worsened (jz2-a `launch.ts` +2 lines), why-comments 4 lost (jz2-a), log-safety +1 (jm7-a). Error gate 29 → 24 New, 0 Worse, all 24 BASE-RED → `--update` NOT run (rule: only at 0 New / 0 Worse). Full suites of all 16 touched packages green. ACP parity: 1 PASS (raw) + 3 PASS through Jini's runtime (resume / model / effort refusals), cancel PASS at runtime level, rest NOT-RUN (proxy 403 to the model host). Pilot stays OFF.**

## Method
- Base first (unmodified `06559affb`): `pnpm install --frozen-lockfile` 0; `pnpm --no-bail -r build` 0 (0 `error TS`); `pnpm -r --no-bail --if-present run typecheck` 0 + `tsc -p scripts/tsconfig.json --noEmit` 0; `pnpm guard` 0; every ratchet gate recorded (`combine-8-jini-base-<gate>.txt`).
- Per merge (main tree): `git merge --no-ff origin/codex/<name>`; `pnpm --no-bail --filter "...[<pre-merge>]" build`; `tsc -p tsconfig.json --noEmit` in every changed package; `pnpm guard`; `vitest run --maxWorkers=2 --minWorkers=1` on every test file the merge added/changed, plus the tests the branch's commit plan names (per-merge raw lines: `combine-8-jini-per-merge.txt`).
- Per merge (second worktree `/home/user/jg`, detached at the merge/fix SHA, serialized with a lock): `SIZE_BASE_REF=06559affb node scripts/check-size.mjs`; `COMPLEXITY_BASE_REF=06559affb node scripts/check-complexity.mjs`; `node scripts/check-hook-injection.mjs`; `node scripts/check-why-comments.mjs --base 06559affb` and default (terra); `node scripts/check-log-safety.mjs`; `node scripts/check-error-gate.mjs` — each diffed against base (`combine-8-jini-gates-per-merge.txt`). One early m5 run overlapped another in the same worktree; it was discarded and re-run at the right SHA (the table shows the re-run).
- Owed checks: every branch's `commit-plans/<job>.*.md` (COMMIT-PLAN / REFRESH / report) on Tovu `origin/plan/commit-plans-1120` read before its merge; every named test run; **mutations run** for every branch (patch → run the named tests → restore; restore verified with `git diff --quiet`). Results under "Mutations".
- Full suites: separate worktree `/home/user/jt` at `1aa27373` (fresh frozen install 0 + `pnpm --no-bail -r build` 0, 0 `error TS`), `npm --prefix packages/<p> run test -- --maxWorkers=2 --minWorkers=1`.

## Base (`06559affb`)
| gate | base |
|---|---|
| build | 0, 0 `error TS` |
| typecheck (+scripts) | 0 / 0 |
| guard | 0 (zero violations; HW3 34) |
| size | 0, 60 debt entries |
| complexity | **1 BASE-RED**: 2 new (`automatic-use.ts:222 prepare (11)`, `sign-in-configuration.ts:70 selfConfigureConnection (11)`) |
| hooks | 0, 0 direct calls |
| why-comments `--base 06559affb` | 0 (0 files) |
| why-comments default (terra) | **1 BASE-RED**: 314 lost, 199 allow-listed (115 not) |
| log-safety | **1 BASE-RED**: 9 "New raw log path" lines |
| error gate | 0 (WARN) **BASE-RED: 29 New**, 8 improved |

## Per branch
| # | branch (tip) | merge | conflicts → resolution | red found | fix commits | status |
|---|---|---|---|---|---|---|
| 1 | c7-jini `0696ae1e7` | `6a911a82a` | none | none. Owed: cms `directory-adapter.test.ts` 19/19; chat `ag-ui-transport.test.ts` + `log-safety-g.test.ts` 21/21 (sentinel stays absent). Error gate −1 (`cms/src/trash/adapters/directory.node.ts` failure-text gone) | — | GREEN |
| 2 | bg-jini `dc58acc1b` | `3a7e7fa4d` | none | none. chat embed 6/6 (incl. new `embed-surfaces.test.tsx`), daemon `tool-execution-rpc.test.ts` 40/40 **×9 repeats, 9/9 green** (J-401's flaky `ECONNRESET` not reproduced), platform file-lock 28/28. J-EMBED is breaking but shipped no changeset → added | `bb0958078` (changeset) | GREEN |
| 3 | rs3-jini `b81a534df` | `391f62e30` | none (only its own commit beyond merge-7) | none. chat `payload.test.ts` 27 (25→27), cli `prompt-read-file-settled` 2, diagnostics `page-work-budget` 10, mcp `config.test.ts` 77. Error gate improved 8→10 (J02 −1, J04 −2 as forecast) | — | GREEN |
| 4 | jz2-b `6a156a70e` | `b8755f9b0` | none (its J02/J04 were STOPPED; rs3 carried them — no overlap) | none. infra outbox 145, plugins host 879, mcp agent-install 88. Error gate improved 10→13 (J03, J05, J06) | — | GREEN |
| 5 | jz2-a `af7df23b6` | `c52c3bae3` | none textual (`daemon/agent-executor/acp-events.ts` auto-merged; jy-pads' `classifyFailureSafely` kept next to ACP-3's `sessionRef` lookup in `finishAcpOnClose`, as REFRESH asked) | **TS2345 ×2** `acp-events.ts:174,183` — ACP-5 calls `reportPostCloseFailure(onCleanupFailure, ctx)`; jy J-ARGS had made it one object. **daemon 2 red** (new ACP-5 cases): "stops recorded descendants…" and "reports an ACP release snapshot failure…" ended `failed` — the fake run emitted no visible output, so `observeRunOutput` (correctly) fails an empty run; and the stop expectation listed pids ascending while `collectProcessTreePids` sorts descending. Ratchets: complexity +2, size worsened, why-comments −4 (below) | `a3e60175c`, `3c146a6c1` (each case sends one `text_delta` first like its neighbour; expects `[[5101, 5100]]`); `bb0958078` (E-C-J / E-O-J breaking changesets the sheet left to the combine) | tests GREEN; ratchets RED (listed) |
| 6 | jm7-b `a4600897f` | `02d7f1f1c` | none | none in the merge. cms media+seo 842, integrations webhooks+hosted-mcp 21, agent-plugins lifecycle 1294 (+2 skipped). Complexity: both base lines gone (C7-CX1/CX2). Error gate 28→24 (C7-ERR: the 4 combine-7 lines gone, total debt unchanged). Why-comments: 116 rows allow-listed (C7-WHY expectation met: `--base d3e78b387` → 120 lost, 116 allow-listed; the 4 left are jz2-a's). **Owed K-04b-J integration** (manifest entry `./seo/cover-image` node, changeset): adding the entry tripped **guard SI-domain** (`./seo/cover-image (seo) reaches src/media/cover-image.ts (media)`) | `ca5a7f34b` (entry + exports target + cms contract row + changeset; `src/media/cover-image.ts` joins cms `isolation.shared` — decision 3) | GREEN |
| 7 | jm7-a `aad0afab7` | `5e46f8108` | none textual (`chat/.../ag-ui-transport.ts` auto-merged with c7's `runStreamError`) | **build TS6059 ×16** (rootDir) + **TS2741** — chat `ag-ui/__tests__/interrupts.test.ts` imported `../../../../../daemon/src/surface-exchanges.js`, daemon `frontend-session-ag-ui.test.ts` imported `../../../chat/src/...`; tsc also emitted `.js/.d.ts` into both `src/` trees (deleted); **guard R2-deep-path ×2** + HW3 hit on the emitted `chat/src/core/messages.js`; `transport.test.ts`'s `AgUiRunClient` fake lacked the new required `resumeAgUiRun`. Full daemon suite: `frontend-control.test.ts` host-surface pin lacked AG4-J's `begin`. Ratchets: complexity +2, log-safety +1 | `3f71e8965` (daemon test imports `@jini-ai/chat/core/ag-ui`; the one chat case needing daemon's exchange store moved verbatim to daemon `ag-ui-interrupt-exchange-expiry.test.ts` — chat must not depend on daemon; 7 + 1 cases, none lost; fake gains a throwing `resumeAgUiRun`), `d017d5ffa` (pin adds `'begin'`) | tests GREEN; ratchets RED (listed) |

After all merges: `1aa273730` `pnpm api:update` (40 packages, 677 entries, 17184 symbols); the pre-update `api:check` is `combine-8-jini-api-changes.txt`.

## Mutations (owed by the commit plans; patch → named tests → restore)
| branch | mutation | result |
|---|---|---|
| c7 | EXDEV: drop `{ cause: error }` | KILLED (1) |
| c7 | ag-ui: drop `{ cause: error }` | KILLED (2) |
| c7 | ag-ui: drop the `HTTP <status>, ` prefix | KILLED (1) |
| bg | J-EMBED: render without `ChatSurfacesProvider` | KILLED (1) |
| bg | J-LOCK-OWNER: remove the identified-holder guard | KILLED (2, both adapters) |
| bg | J-LOCK-OWNER: remove the `unchanged(observed, current)` guard | KILLED (1) |
| bg | J-401: move auth after the body read | **NOT-RUN** (route wiring change, not a one-line plant; time) |
| rs3 | AG0-J: `"undefined"` for a missing text delta / `"null"` for null tool content | KILLED (1) / KILLED (1) |
| rs3 | J02: remove `observed({ promise: closing })` | KILLED (1) |
| rs3 | J02: restore `void closing.catch(() => {})` | survives (behaviour-equivalent; it is a gate mutation — the error-gate key shrink confirms the idiom) |
| rs3 | J04: restore `prev.catch(() => {})` | gate mutation (equivalent); **extra:** `prev.then(() => {})` (a failed write poisons the queue) **SURVIVED** all 93 mcp config tests — finding F1 |
| jz2-b | J03/J05/J06 restore catches | gate mutations: confirmed by the error gate (3 keys improved); **extra:** J05 fallback `null` → `'/'` **SURVIVED** mcp agent-install 88 — finding F2 |
| jz2-a | ACP-3: remove the loadSession capability refusal | KILLED (1) |
| jz2-a | ACP-4: null-id predicate back / bypass effort selection / discard model-reply configOptions | KILLED (1) / KILLED (3) / KILLED (1) |
| jz2-a | ACP-5: release without waiting / ignore hook rejection / skip descendant stop / skip snapshot-failure report | KILLED (2) / KILLED (1) / KILLED (1) / KILLED (1) |
| jz2-a | E4: omit tracker `exactSecrets` | KILLED (1) |
| jz2-a | E6a: render `<details>` in id-only | KILLED (2) |
| jz2-a | E9: parser text back (`String(line)`) | KILLED (4) — approximate plant (may throw instead of echoing) |
| jz2-a | E-C-J: `discover({ env: {} })` / E-O-J: `usable({ env: {} })` | KILLED (3) / KILLED (2) |
| jz2-a | E4 restore `trackerCarrier`; ACP-3 restore old durable fallback / def gate | NOT-RUN (time) |
| jm7-b | I2: ignore hash filter / ignore workspace / ignore empty filter | KILLED (2) / KILLED (1) / KILLED (1) |
| jm7-b | C7-ERR B: drop `{ cause: error }` | KILLED (1) |
| jm7-b | K-04b-J host-suite mutations | NOT-RUN (host suites live in Tovu) |
| jm7-a | AG2: skip `EventSchemas.parse` / omit abort signal | KILLED (1) / KILLED (1) |
| jm7-a | AG4: begin reusable / skip owner check | KILLED (2) / KILLED (1) |
| jm7-a | AG4: drop the run-binding + entry-run checks inside `begin` | **SURVIVED** (5/5) — finding F3 |
| jm7-a | AG2 split-by-chunk / double refusal; AG3 / AG3A plants | NOT-RUN (time) |

Findings (listed, not chased): **F1** no mcp test pins that a failed config write does not block the next queued write (`afterSettled` is untested for that property). **F2** no test pins J05's alias-resolution fallback value. **F3** the registry path already finds the session by `runId`, so `begin`'s inner run checks only matter for the scoped handle path, which no test drives with a wrong run.

## Generic-message notes
No merged branch replaced a specific error/log message with a generic one that I found in the diffs I read. c7 adds the HTTP status + cause to the ag-ui run error; jz2-a E9 deliberately replaces the echoed parser text with a fixed `BAD_FRAME` refusal (no input echo — a security fix, the sheet's intent); ACP-4 messages name the refused model / effort and the offered list.

## Decisions for the owner
1. **jz2-a complexity (2 new)**: `agent-runtime/src/agent-protocol/acp/session-results.ts:21 handleRpcError (12)` (ACP-4 model-reply branch) and `ui/src/features/panel-kit/ErrorNotice.tsx:22 ErrorNotice (11)` (E6a disclosure). Split or add debt rows.
2. **jm7-a complexity (2 new)**: `chat/src/core/ag-ui/event-projection.ts:256 drainRunFramesToAgUi` (sonarjs cognitive 12) and `:292 readConfirmationResume (11)`.
3. **cms `isolation.shared` gained `src/media/cover-image.ts`** so the owed `./seo/cover-image` entry passes SI-domain (it imports only `parse5` and the already-shared widgets marker). Alternative: move `resolveCoverImage`/`collectCoverMediaRefs` into seo or inject them.
4. **jz2-a size**: `daemon/src/agent-executor/launch.ts` file 1044 → 1046 lines, `createAgentExecutor` 429 → 431 (ACP-3/4 forwarding). Trim or raise the two debt rows.
5. **jz2-a why-comments (4 lost)**: `acp/__tests__/session.test.ts` `[4bb23d5ecd7b]` (the null-id bug note — bug fixed by ACP-4), `core/src/errors/reporter.ts` `[aebef68baf2a]` + `[b550e959f815]` (E4 rewrote the tracker contract; the new comment at `reporter.ts:149` states the new rule), `sidecar/src/json-ipc.ts` `[fa4f71f9f63b]` (E9 deleted `jsonIpcError`). All four describe deleted/replaced code; allow-list rows with those reasons?
6. **jm7-a log-safety +1**: `[raw-error] chat/src/core/assistant-client/ag-ui-fetch-agent.ts:12` — `throw new Error('The agent response has no event stream')`.
7. **Breaking changesets written by the combine** (sheets left them): `cli-resolve-daemon-url-env.md`, `devops-select-node-runtime-env.md`, `chat-embed-mount-surfaces.md` (all `minor` + "BREAKING:" like the existing ones), `cms-seo-cover-image.md` (minor).
8. **AG3-J test moved across packages**: "exchange expiry denies the tool while the retained continuation remains claimable" now lives in daemon (`src/__tests__/ag-ui-interrupt-exchange-expiry.test.ts`), unchanged.
9. **`AgUiRunClient.resumeAgUiRun` is a new required member** (api: `changed export ./transports/{ag-ui,http}#AgUiRunClient`): any host that implements `AgUiRunClient` by hand must add it.

## Final gates (gates at `1aa273730`, identical to the post-merge-7 run at `3f71e8965`; `d017d5ffa` changes only one test file)
| command | base `06559affb` | final |
|---|---|---|
| `pnpm --no-bail -r build` | 0, 0 `error TS` | **0**, 0 `error TS` (fresh worktree `/home/user/jt` at `1aa27373`) |
| `pnpm -r --no-bail --if-present run typecheck` + scripts tsc | 0 / 0 | **0 / 0** (0 errors) |
| `pnpm guard` | 0 (HW3 34) | **0** (HW3 34, 0 new) |
| size | 0, 60 entries | **1 — 2 worsened** (decision 4) |
| complexity | 1, 2 new (BASE-RED) | **1 — 4 new**; both base lines gone (decisions 1–2) |
| hooks | 0 | **0** |
| why-comments `--base 06559affb` | 0 | **1 — 4 lost, 0 allow-listed** (decision 5) |
| why-comments `--base d3e78b387` (C7-WHY check) | — | 1 — 120 lost, **116 allow-listed** (the 4 of decision 5) |
| why-comments default (terra) | 1 — 314 lost, 199 allow-listed | 1 — 318 lost, **314 allow-listed** (4 not: decision 5) |
| log-safety | 1 BASE-RED (9) | 1 — 10 = base 9 + 1 (decision 6) |
| error gate | 0 WARN, 29 New | 0 WARN, **24 New** (all BASE-RED), **0 Worse**, 11 improved → `--update` **not run** (New ≠ 0) |
| `pnpm api:check` | — | 0 (changes listed below; then `api:update`) |

Every final error-gate line (all BASE-RED; the 5 base lines now gone: `cms/media/chat-preview.ts`, `cms/trash/adapters/directory.node.ts`, `integrations/webhooks/tools/tool-handlers.ts`, `platform/process-probes.ts` (2), `search/indexer-write.ts`):
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
Every log-safety line (BASE-RED unless marked):
```
New raw log path: [stored-error-text] packages/core/src/approval-batch-chain.ts (2)
New raw log path: [stored-error-text] packages/daemon/src/agent-executor/codex/home-staging.ts (1)
New raw log path: [stored-error-text] packages/daemon/src/http/tool-execution-routes.ts (1)
New raw log path: [stored-error-text] packages/desktop-host/src/app-version/loader.ts (2)
New raw log path: [error-format] packages/desktop-host/src/app-version/update-check.ts (1)
New raw log path: [error-text] packages/desktop-host/src/app-version/update-check.ts (1)
New raw log path: [error-format] packages/http-kit/src/node-bridge.ts (1)
New raw log path: [error-helper] packages/http-kit/src/node-bridge.ts (1)
New raw log path: [raw-error] packages/chat/src/core/assistant-client/ag-ui-fetch-agent.ts (1)   <- NEW (jm7-a AG2-J)
New raw log path: [console] packages/ui/src/features/panel-kit/hooks/use-settings-slice-save.hooks.ts (1)
```
Every complexity line (final): `agent-runtime/src/agent-protocol/acp/session-results.ts:21 handleRpcError (12)`, `chat/src/core/ag-ui/event-projection.ts:256 drainRunFramesToAgUi (sonarjs/cognitive-complexity 12)`, `chat/src/core/ag-ui/event-projection.ts:292 readConfirmationResume (11)`, `ui/src/features/panel-kit/ErrorNotice.tsx:22 ErrorNotice (11)`. Size lines: `daemon/src/agent-executor/launch.ts:826 <file> (1046, was 1044)`, `launch.ts:1005 createAgentExecutor (431, was 429)`. Why-comments lines: decision 5 (raw: `combine-8-jini-why-base.txt`, `-why-default.txt`, `-why-base-d3e78b387.txt`).

## Tests
Full suites at `1aa27373` in worktree `/home/user/jt` (fresh frozen install + `pnpm --no-bail -r build` exit 0, 0 `error TS`), every package this run touched (16), `--maxWorkers=2 --minWorkers=1`; raw `combine-8-jini-suites.txt`:
agent-runtime 4537 (+1 skipped), **daemon 4843/4844 (+1 skipped) → 4844/4844 after `d017d5ffa`** (re-run of the whole suite), chat 4486 (+1), cms 5002, core 2947, ui 8818, cli 605, devops 1327, sidecar 406 (+3), platform 3354 (+6), diagnostics 1090, mcp 1882, infra 155, plugins 1015, agent-plugins 2198 (+2), integrations 2077. All exit 0 (daemon after the fix).
- **daemon 1 red** `http/__tests__/frontend-control.test.ts` "exposes only the extension, the registrations and the run/request bind hooks" — the key-list pin did not include AG4-J's `begin`. Fixed `d017d5ffa` (title + list); 14/14; full daemon re-run 250 files green.
- Per-merge reds (jz2-a ACP-5 cases, jm7-a build/guard): see the per-branch table.

## Extra checks
- **(a) E-J1** cms `forms/__tests__/submit-service.host-options.test.ts` under full-suite load: **25/25 pass** (pending-copy case included) in the full cms run.
- **(b) knip** (`pnpm quality:knip`, combined tree; list only, nothing removed) — `combine-8-jini-knip.txt`. Same counts as combine-7: unused files 60; **unused dependencies (10)**: `@jini-ai/db`, `@jini-ai/http-kit`, `@jini-ai/oauth`, `@jini-ai/registry`, `@jini-ai/sidecar` (examples/minimal-host); `@jini-ai/http-kit`, `@jini-ai/mcp` (examples/reference-web); `zod` (packages/agentic); `unpdf`, `mammoth` (packages/cms). Also 24 unused devDependencies, 23 unlisted dependencies, 1 unlisted binary, 15 unresolved imports, 221 unused exports, 459 unused exported types — every line in the file.
- **(c) ACP parity** — **pilot stays OFF** (`opencodeAcpAgentDef` exists in `agent-runtime/src/defs/opencode-acp.ts`, not referenced by `registry.ts`'s `BASE_AGENT_DEFS`; not added). `opencode-ai@1.19.6` installed in scratch (npm), driven with an empty HOME (a) raw over `opencode acp` and (b) through Jini's own `attachAcpSession` (built `agent-runtime/dist` at `1aa27373`) — `combine-8-jini-acp-probe.txt`. The proxy still refuses the opencode model host (403), so nothing that needs a completed prompt can run:

| # | item | result |
|---|---|---|
| 1 | initialize advertises loadSession; capabilities/models | **PASS (raw)**: `loadSession: true`, mcp http+sse, prompt embeddedContext+image, session close/fork/list/resume; authMethods `opencode-login`; session/new offers `model` (212 options, current `opencode/big-pickle`) and `mode` (2, current `build`) |
| 2 | text_delta + succeeded + usage | NOT-RUN — prompt fails `-32603 Proxy refused to open a tunnel: 403` (Jini surfaces it as `AGENT_EXECUTION_FAILED` with that text) |
| 3 | resume via session/load (bogus id → resume_failed + reseed) | **PASS (runtime half)**: Jini sends `initialize, session/load` (capability advertised), opencode answers `-32603 OpenCode service failure`, Jini emits error `details.kind: "resume_failed"`, `durable null`. Reseed is the daemon's step after that — NOT-RUN live (needs a model); covered by the daemon suite |
| 4 | picker model accepted; bad id → plain "did not accept the model", no prompt sent | **PASS**: `nope/not-a-model` → `This agent did not accept the model "nope/not-a-model". Pick a model from its list and retry. (…model not found…)`; methods sent `initialize, session/new, session/set_config_option` — **no `session/prompt`**. Picker model `opencode/big-pickle` (already current) accepted: no switch sent, went on to `session/prompt` (then 403) |
| 5 | thought_level offered? | **not offered** (configOptions are only `model`, `mode`). With `effort: "high"` Jini refuses before prompting: `This agent does not offer the reasoning effort "high". It offers: none. …`; sent `initialize, session/new` only |
| 6 | cancel → cancelled ≤ 5 s, no leftover process | **PASS (runtime level)**: abort right after `session/prompt` → `session/cancel` sent, child exited 0 after 35 ms; no `opencode acp` process left. The daemon's `cancelled` terminal state NOT-RUN live |
| 7 | restricted run asks and is denied; bypass once | NOT-RUN (needs a model to request a tool) |
| 8 | one real Jini tool call over HTTP MCP | NOT-RUN (needs a model) |
| 9 | journal holds neither JINI_DAEMON_TOKEN nor the HTTP token | NOT-RUN (no live daemon run) |
| 10 | clean finish leaves no descendants, staged files removed | NOT-RUN live. Runtime: `beforeRelease` called exactly once on every run (ACP-5 hook), no `opencode acp` process left after all 7 runs. Daemon descendant stop covered by the suite (and its mutations, killed) |
| 11 | signed-out → AUTH_REQUIRED message | NOT-RUN — signed-out opencode falls back to its free model, so the failure here is the proxy 403, not auth |
| 12 | the 12 existing ACP defs pass `agent-executor-acp.integration.test.ts` | **PASS** — 4/4 in the full daemon suite |

## Exported signatures and subpaths for the Tovu run
From `combine-8-jini-api-changes.txt` (all then recorded by `api:update`):
- **New subpath**: cms `./seo/cover-image` (node) → `resolveSeoCoverImage`, `withCoverSeoDefaults`, `withCoverReadDeps`, `withContentImageSource`.
- **New exports**: chat `./core/ag-ui#{confirmationInterrupt, createAgUiPauseStore, readConfirmationResume}`, chat `./transports/ag-ui#createAgUiFetchAgent({ request }, optional = {})`.
- **Changed (breaking for callers)**: chat `./react/embed#mountEmbedChat` now requires `surfaces: ChatSurfaces`; cli `.#resolveDaemonUrl({ env }, options)` (env required, `ResolveDaemonUrlOptions.env` removed); devops `./local-dev#selectNodeRuntime({ searchFrom, nodePath, env })` (env required; option removed); chat `./transports/{ag-ui,http}#AgUiRunClient` gains required `resumeAgUiRun` (decision 9).
- **Changed (additive / optional)**: chat `AgUiClientPorts` (+ optional `onLiveEvent({ event })`); agent-runtime `.#AttachAcpSessionOptions` (+ `effort?`, `beforeRelease?`); cms `./media#{AssetBlobRepoPort, InMemoryAssetBlobRepo}` `list(required, { sha256s? } = {})`; cms `./media/cover-image#CoverImagePost.featuredMediaId` widens to `string | null | undefined`; core `./errors/reporter#IncidentTrackerReport.context.exactSecrets?`; daemon `.#AgentCleanupFailurePhase` (+ `'acp-release'`), `.#FrontendSessionHandle` / `.#FrontendSessionRegistry` (+ `begin`), `./http#FrontendControl` (+ `begin`); ui `.#ErrorNotice{,Props}` and `./panel-kit#ErrorNotice{,Props}` (+ `disclosure?: 'full' | 'id-only'`).
- Removed (not in the API baseline: never a package entry): sidecar `jsonIpcError` (E9).
- Tovu owes (from the commit plans): host `selectNodeRuntime` caller (dev script) passes `env`; host admin transport expectations use `The agent run stream stopped with an error (HTTP 502, Error); send the message again.`; imperative `mountEmbedChat` callers pass `surfaces`; K-04b-J host sheet switches to `@jini-ai/cms/seo/cover-image` and owns its host-suite mutations.

## Left / next
1. Owner: decisions 1–9.
2. Mutations NOT-RUN (time / not one-line plants): bg J-401 (auth after body read); jz2-a E4 `trackerCarrier` restore, ACP-3 old durable fallback + def gate; jm7-a AG2 split-by-chunk / double refusal, AG3 and AG3A plants; jm7-b K-04b-J host suites (Tovu). Findings F1–F3 (surviving extra mutations) for the owner.
3. ACP parity items 2, 7–11 (and the daemon halves of 3 and 6) need a model host the proxy allows. Pilot stays OFF.
4. Not run: e2e/playwright, `pnpm test:scripts`, chrome look for J-EMBED (open/close/unmount) and the AG-UI visitor checks the jm7-a REFRESH lists.
5. Tovu combine-8: build against this branch; the signatures above. The lockfile run (`origin/release/lockfile-1120`) is combine-9.
