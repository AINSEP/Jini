PARTIAL 63a9b57b8 ef92ccbb6: 8 site-chat files STOPPED on prerequisites outside this lane (SiteAssistantWidget.tsx/.hooks.ts + site-assistant-errors.ts: codex/visitor-chat-tovu still held; loader-host.ts + SiteAssistantActivation.hooks.ts: BX-7/8 after the widget; tool-confirmation.ts + SiteToolConfirmation.hooks.ts + vanilla-tool-confirmation.ts: BX-9..12 Jini challenge lifecycle + BX-3/BX-11), run-start-context BX-31/32 injection remainder, fix 12 instance threading (follow-up). Every rv1123r assistant/runtime/db FIX is applied (12 partly), every DISAGREE file is moved/split, the held vocabulary file is moved, generated plugin state is dropped; no new red.

# w5-runtime-assistant — wave-5 lane (2026-11-24, unattended cloud run)

- **Branches:** Tovu `codex/w5-runtime-assistant-tovu`, Jini `codex/w5-runtime-assistant-jini`. Plain `git push`, no force-push, no `--no-verify`. No other branch was touched, nothing was published or tagged, and no codebase-memory tools were used.
- **Programmer contract:** I read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) before any work. Its rules went into a shared builder brief that every subagent read first:
  - root cause first
  - tests first for behaviour changes
  - named mutations
  - fresh evidence before claiming done
  - no weakened tests
  - the SELF-CHECK list
- **Method:** Opus coordinated, and all builder work went to Sonnet high-effort subagents (7 dispatches, at most 4 at a time, each within 52 tool calls).
  - The coordinator did the merges, the fix-14 drop, conflict resolution, why-comment verification, the boundary-door fix, gates and base attribution.
  - The A2UI and MCP callback route refactor (fix 17/20) is a principal-check seam. It was handled by characterization first: 10 wire pins were green on the old code, and two mutations removing the principal check were each killed in Tovu and Jini.
- **Base:**
  - Tovu: `origin/codex/w4-assistant-tovu` + `w4-runtime-tovu` + `w4-db-tovu`, merged in that order (`0bd2bbf6d`).
  - Jini: `w4-assistant-jini` + `w4-runtime-jini` + `w4-db-jini` (`e4b56db1`).
  - Conflicts were resolved toward the newer side. Runtime was merged before assistant as Codex ordered. `ToolAccessLoweringError` comes from `@jini-ai/daemon`, and the roster bus stays instance-owned (fix 19). READMEs and `why-comments-debt.json` were union-merged (by id+reason).
- **Setup:** Node 24.22.3. Jini `pnpm install --frozen-lockfile` and `pnpm -r build` both returned 0. Tovu `npm ci --ignore-scripts` returned 0 in root, admin, desktop and site-chat, followed by `link-jini.mjs`.
- **Base attribution:** clean worktrees at both bases. Jini got its own install and build; Tovu `node_modules` were symlinked with `@jini-ai/*` pointing at the base Jini. Every red was re-run there.

## FIX items applied (Tovu `origin/plan/whats-left-1122:reviews/rv1123r.md`, assistant / runtime / db)
| # | applied | where |
|---|---|---|
| 1 | yes | Jini infra `outboxWorkerArgs`/`processDomainOutbox` REQUIRE `scheduler` + `logger`. Tovu `contracts/core/events/outbox-worker.ts` builds them once (`createOutboxHostServices`) for every drain. A log-byte pin and its mutation (prefix) are killed. |
| 2 | yes | Jini sidecar parent-watchdog emits `ParentWatchdogEvent`s through one `report` port. Tovu `server/runtime/boot/parent-watchdog-report.ts` formats the existing lines and streams. Pins were copied from the old Jini line tests; the swap-ids and stream mutations are killed. |
| 3 | yes | `check-error-gate.mjs` now points `isLoopbackHost`/`resolveBindHost` at `@jini-ai/devops/local-dev`. The stale "Worse … local-owner-signin" line is gone. `check:errors` exits 0 (WARN mode). |
| 4 | yes | `apps/desktop/package.json` + lockfile declare `@jini-ai/analytics`. |
| 5 | yes | Both runtime DISAGREE files are now SPLIT (table below). |
| 11 | yes | Jini `RestorePointsRepoDeps.onPruneWarning` is REQUIRED, so there is no console in the engine. A failed prune still saves. |
| 15 | yes | Both Tovu restore-point constructions pass `warnRestorePointPruneFailed` (`TOVU_ERROR_REDACTION_OPTIONS`, byte-identical line). The `backup-retention` characterization still pins it, with mutation `void error`. `platform/routing/index.ts` door untouched. |
| 12 | partly | Jini `createMediaAccessEvidence()` instance factory, so the engine has no module state (mutation: module-level maps). **Left:** Tovu holds the one instance in `features/media/access-evidence.ts` (now a declared `PUBLIC_ENTRIES` door entry) and imports it instead of threading it through args. About 200 repo constructor sites made the threading too large for this lane. Recommendation: thread it through `createMediaRenditionDeps`, the post/entries repo options and `composeTrashService` in a follow-up. |
| 13 | yes | db import-isolation: the runtime kysely allowance is only `recovery/journal-schema.ts`. `journal-kernel`, `journal-repo.sql` and `watermark/kernel` are type-only, with 4 new deny assertions (value and dynamic import). Mutation: disabling the check turns 4 red. |
| 14 | yes | Dropped all 354 generated `sites/tovu-dev/agent-plugins/ws/workspace-local/` files (the `6068503f86` additions and the `18340ff541` `bundled-digests.json` update). Added a `.gitignore` rule `sites/*/agent-plugins/ws/` so they cannot be re-committed. |
| 16 | yes | core `contracts/tool-result-block` `ToolResultContentBlock` is now the one owner. agent-runtime `ProviderToolResultBlock` and daemon `ByokToolResultBlock` are removed. |
| 17 | yes | daemon `a2uiActionsRoutes` is a `defineJsonRoute` spec (`authenticate`/`onError` ports, 202). `answerSurfaceCallback` is a server-neutral streaming handler over a structural request port. Statuses, bodies, principal checks and NDJSON restore stream are unchanged: 10 Tovu wire pins plus the existing restoration test, same before and after. |
| 18 | yes | daemon `readA2uiAction` and agentic `renderA2uiSurface`/`validatedA2uiMessage`/`withA2uiExchange` take the parser, catalog and display-only property as REQUIRED fields. Protocol edges are type-only and Tovu injects the collaborators. |
| 19 | yes | Resolved in the runtime→assistant merge (above). |
| 20 | yes | Tovu `a2ui-actions-route.ts` and `mcp-ui-tool-calls-route.ts` mount the Jini specs via `mountJiniRoutes`. Express remains only in that glue, and the four test files that faked `app.post` now drive the real mounted route. |
| 21 | yes | All three assistant DISAGREE files were reclassified and moved or split (table below). Prerequisite and owner holds remain visible below. |

Not applied here: fixes 6–10 (admin-shell lane) and the `KEEP_RULES` suggestion (`plan.mjs` lives on `plan/*`, which this lane may not touch).

## Files
| file | outcome |
|---|---|
| `contracts/core/extension-capability-vocabulary.ts` (runtime held) | **MOVED** (deleted; deduped onto identical `@jini-ai/core/extension-capability-vocabulary`; `host-binding.ts` + the import-identity test regex repointed; literals byte-identical) |
| `server/runtime/lifecycle/assistant-daemon-connection.ts` | **SPLIT** → `@jini-ai/sidecar/daemon-connection` `createDaemonConnectionRegistry` (instance-owned current/previous state machine). Tovu keeps the one instance + the credential fallback. |
| `server/runtime/composition/modules/run-finalizer/checkpointer.ts` | **SPLIT** → `@jini-ai/chat` run-finalizer `createRunCheckpointer` (cadence, retry floor, trailing timer, single in-flight write; structural `CheckpointWatch`; projection + ledger injected). 3 mutations killed; 1 new binding pin. |
| `platform/site-dir/resolve-install-dir-target.ts` | **MOVED** → `@jini-ai/platform/fs` `resolveDirectoryTarget` (+ unit test); 10 importers repointed |
| `platform/site-dir/move-sites-home.ts` | **SPLIT** → `@jini-ai/platform/fs` `moveDirectoryUnderLeases` (lock, claims, rollback-safe release via ports); Tovu keeps site selection, paths, bookkeeping, copy |
| `platform/site-dir/duplicate-pglite-store.ts` | **SPLIT** → `@jini-ai/db/pglite` `copyPgliteSourceTo` (served-vs-stopped copy, owner-lock lifecycle); Tovu keeps error mapping, chat purge, title reset |
| `assistant/daemon-core-protocol.ts` | **SPLIT** → core `contracts/site/daemon-core-rpc` (wire types) + daemon `core-rpc-schema` `createDaemonCoreRequestSchema({ cliConsentKeys, settingsNamespaces })`. Tovu keeps its namespaces/consent keys + `DaemonAttemptHead`/`DaemonDurableRunStore`. Those two `Pick` from `@jini-ai/chat`, and core cannot depend on chat. |
| `assistant/site/client-directives.ts` | **MOVED** (deleted) → core `contracts/site/client-directives`; website + site-chat producers/consumers repointed |
| `assistant/render-ui-tool.ts` | **SPLIT** → agentic render-surface `createRenderUiToolRegistrations` (one-shot outcome mapping); Tovu injects parser, catalog, copy, registration policy |
| `assistant/demo-image-png.ts` | **MOVED** → `@jini-ai/platform/image/png-encode` (product-neutral encoder; 9 tests moved) |
| `assistant/run-start-context.ts` | **STAYS-HOST** (host envelope parsing through Tovu `run-page-context`; its collaborators are already Jini packages). BX-31 started: `visitor-tool-budgets` now takes a REQUIRED `createCounterStore` (mutation: counter order). **Left:** plugin-reader/text-guard injection. Recommendation: a composition-built `createRunStartContextParser({ readPluginState, guardUserText, redactUserText })` so the AST-pinned call text in `run-ownership.test.ts:353` stays valid. |
| `site-chat/SiteAssistantWidget.tsx`, `SiteAssistantWidget.hooks.ts`, `site-assistant-errors.ts` | **STOPPED** (P13 §2.1 defers them to `codex/visitor-chat-tovu`, which is still held, unmerged and outside this lane) |
| `site-chat/loader-host.ts`, `SiteAssistantActivation.hooks.ts` | **STOPPED** (BX-7/8 dedupe onto `chat/react/embed` needs the held widget files first) |
| `site-chat/tool-confirmation.ts`, `SiteToolConfirmation.hooks.ts`, `vanilla-tool-confirmation.ts` | **STOPPED** (BX-13 needs BX-9..12, the Jini challenge contract and confirmation lifecycle with explicit approval, expiry and one in-flight decision, which is a security seam; it also needs BX-3 transport and BX-11 after the held widget). Progress: their wire type is now core `ToolConfirmationDirective`, so the local interface was removed. Recommendation: one Opus-reviewed lane for BX-9..12 after visitor-chat lands. |
| `sites/tovu-dev/agent-plugins/ws/workspace-local/**` (354 generated) | **DROPPED** (fix 14) |

## Gates (final vs merged base; no new red)
| gate | base | final |
|---|---|---|
| Jini `pnpm -r build` | 0 | 0, 0 `error TS` |
| Jini typecheck | 0 | 0 |
| Jini guard | 1 (HW3 `admin/shell-failure-log`) | the same 1 |
| Jini api:check | 0 | 0 after `api:update` (agent-runtime, agentic, chat, cms, core, daemon, db, infra, platform, sidecar) + changeset `w5-runtime-assistant` (lists the breaking pre-1.0 signature changes) |
| Jini check:hooks | 0 | 0 |
| Jini check:why-comments | 10 | 10 |
| Tovu typecheck (`tsc -p tsconfig.json`) | 0 | 0 |
| admin tsc / site-chat tsc | 0 / — | 0 / 0 |
| Tovu check:boundaries | 0 errors / 130 warnings | 0 errors / 130 warnings |
| Tovu check:errors / check:hooks | 0 / 0 | 0 / 0 |
| Tovu check:why-comments (`--other-root` Jini) | 78 | 78. 26 rows were added: 21 moved comments, each verified present at its Jini destination, and 5 obsolete fake-handler test comments, explained. The fix-16 row was repointed. |
| desktop `npm run gates` | 4 FAIL (tests, typecheck, coverage, complexity) | the same 4. Same `component-catalog-tool.ts(65)` error (unchanged since base), same 3 renderer complexity rows, same 5 failing desktop tests by name (2108/3 + 912/2 both). |

**Tests:**
- **Jini:** every changed or added test file is green: agentic 8, chat 11, cms 2, daemon 16, db 30, infra 9, platform 15, sidecar 14. Full suites are green: core 3060/3060 and agent-runtime 4566 + 1 skipped. Builders also ran the package folders they touched, e.g. platform `src/fs` 928, cms `src/media` 608, sidecar 442.
- **Tovu node:** 366 test files (every changed test plus every test directly importing a changed module), 2 workers, 5-min watchdog each. 347 green. The other 19 are red with **pass/fail counts identical to the clean base** (re-run there): outbox-worker, forms-notification-retry/-restart, outbox-retry-policies, serve-command-wiring, visitor-isolation (AST of `site-assistant.ts`), site-assistant-transport (react/react-dom link mismatch), domain-no-direct-tool-registration, 4 postgres files (no server), init-site-branches, forms-submit, site-chat-stream.golden, bundled-inactive-gating, deps-provider-plugin-boot, wiring-identity, assistant-byok.inputs-pin. The first run found 4 NEW reds (propose-credential-tool, set-token-agent-tool, providers-tools, settings-write-tools: they faked `app.post`, which fix 20 removed). They were repaired to drive the real mounted route with every assertion unchanged, and are back at base counts 23/26/36/105.
- **Admin vitest:** `VisitorToolsPanel.unit` 39/39 (`--maxWorkers=2`).

## FILES LEFT (`plans/P9-data/tools/scan.mjs` + `plan.mjs`)
| | FILES LEFT | excl. themes |
|---|---|---|
| before (merged base `fcd46a26b`) | 2,168 | 2,057 |
| after | 2,168 | 2,057 |

The number does not move: none of this lane's files fall under `plan.mjs`'s measured area prefixes. That includes `assistant/`, `site-chat/`, `server/runtime/**` and the `platform/site-dir` files, and the deleted `contracts/core` vocabulary file was not in the measured or keep set either. The w4-assistant and w4-runtime reports note the same.

## Open items / recommendations
1. Fix 12 follow-up: thread the single `mediaAccessEvidence` instance through args (see table).
2. BX-31/32 remainder (`run-start-context` factory) and `visitor-executor` executor/audit injection via the capability-registry options.
3. The site-chat holds above need `codex/visitor-chat-tovu` to land, and then a BX-9..12 lane (security seam).
4. The daemon package now depends on `zod` (`^4.6.6`, same as protocol, chat and agentic) for `core-rpc-schema`. The lockfile is updated.
5. `assistant-daemon-connection.ts` keeps four one-line named accessors over the host's one registry instance. They are not re-exports, and they keep importers and tests unchanged. They could be inlined later.
6. The `wip(...)` commits are unreviewed checkpoints pushed per the standing rules. The reviewed state is the final tip; squash freely.
