PARTIAL 085b5908e 898164e9e: left G06 (blocked: sheet says after K01–K03, which another run is building now on launch.ts), G08 server half (`server/builtin-features.ts`, sheet says after K04/K06)

# b-g6c: Part G, Jini non-UI size and complexity splits

Run from 2026-11-25 09:31 to about 10:35 UTC. It was an unattended cloud run, coordinated by Opus. Builders were Sonnet subagents at high effort, with at most 4 at a time.

**Branches.** Both repos are on `integ/b-g6c-2026-11-25`, branched from `origin/integ/b-g6-2026-11-25`: Tovu at `7c0bfac8b` and Jini at `209744ad8`. The SHAs on the first line are the code heads, and this report sits one commit on top of each.

- **Jini.** 15 commits, from `8d03784ba` to `898164e9e`, listed in the table below.
- **Tovu.** Only `085b5908e`, which adds the bug log entries to `development/open-bugs.md`. No Tovu code changed.
- **Untouched.** `main`, `plan/*`, `release/*`, `codex/*`, `integ/merge-*`, `integ/b-g6-2026-11-25` and `integ/b-g6b-*`.
- **Not used:** force-push, `--no-verify`, tags, publishing, codebase-memory tools, and RemoteTrigger. `core.hooksPath` was not unset.

**Programmer skills.** I read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) first and confirmed it. Every builder was told to skim it too. The work follows it: test first, root-cause debugging, coding-foundations and testable-design, and why-comment preservation.

**Setup.**
- Node 24.22.3.
- Jini: `pnpm install --frozen-lockfile && pnpm -r build`.
- Tovu: `npm ci --ignore-scripts` in root, admin, desktop and site-chat; `link:jini`; `prepare-desktop-hooks` (`core.hooksPath=apps/desktop/scripts/hooks`); and a build of `packages/{contracts,sdk}`.
- **Gate 0:** `cd apps/desktop && npm run gates` passed 6/6 before any change.

**Method.** Builders shared the Jini checkout and each edited disjoint files. The coordinator committed each sheet with an explicit file list. Debt-json rows were staged per sheet with a script, so each commit removes only that sheet's rows.

Every sheet followed the same steps:
1. Wrote the pin first and confirmed it green on the unmodified code.
2. Applied the named mutation, confirmed the pin went red, then reverted it.
3. Extracted helpers verbatim, with why-comments moving with the code.

## Sheet table

| sheet | Jini commit(s) | status | pin + mutation | split (lines are non-blank, non-comment) |
|---|---|---|---|---|
| G01 transport / durable-run | `a03580ace` | DONE | Disconnect, replay from cursor and caller abort: ordered, no duplicates, one teardown. `M-replay-from-zero`: 2 red. | `createAssistantTransportClient` 400 → ~12. Run start, stream and prompt code moved to `transport-{run,stream,prompt}.ts`, sharing one `TransportCtx`. `followDurableRun` 103 → ~20, using `FollowState`/`FollowEnv`. Every function ≤ 50. **Bug fixed:** a stream was closed twice. |
| G02 SQL store / ledger | `43384e285` (A), `0719d3844` (B) | DONE | A: byte-identical summary SQL and bind order, row encoding round trip, atomicity via a failing SQLite trigger. `M-split-write-transaction`: 2 red. B: 11 pins, covering concurrent accept (one run), atomic advance/capture/guard/settle, and first terminal write wins. `M-ledger-nonatomic-finish`: 1 red. | `createSqlChatStore` 325 → ~14, split into `store-{rows,queries,writes}.ts`. `conversationSummarySql` is built from named CTE fragments, with byte parity pinned. `createDurableRunStore` 280 → 17, with queries in `durable-run-queries.ts`. `createChatRunLedger` 185 → 22. Each transaction body stays in one `transaction` call. |
| G03 recovery / finalizer | `8d03784ba` | DONE | Lost connection, preexisting terminal run, and two finalization attempts, checked with an order log. `M-finalize-twice`: 2 red in the finalizer and about 14 in recovery. | `createDurableRecovery` 122 → ~15. `createAssistantRunFinalizer` 132 → 55. Decisions are pure helpers, and effects keep their order. |
| G04 frontend session bridge | `06fff443d`, `e836f178e` | DONE | Reconnect with backoff reset, no retry on 401/403/404/429, same-origin credentials, abort during read. `M-retry-403`: 1 red. | `createFrontendSessionBridge` 219 → 59 (under the 80 cap, over the 50 target). Invocation handling moved to `frontend-invocation-handler.ts`. `openFetchFrontendStream.connect` cognitive 11 → ≤ 10 (one attempt separated from scheduling). `e836f178e` put back one why-comment verbatim that the builder had dropped. |
| G05 parser / tagged text | `2494e0eef` | DONE | sha256 baselines at every chunk split for the artifact parser, the question-form scan and both suppressors. Suppressed text never leaks. `M-close-on-quoted-brace`: 3 of 4 red. | `createArtifactParser` 83 → ~22. Both `createTaggedTextSuppressor` 75 → ~25. `balancedObjectEnd` cognitive 13 → ≤ 10 (`jsonStringEnd` handles quoted text separately from brace counting). The two suppressors behave the same but are not byte-identical. Not deduped. |
| G06 executor launch | — | **NOT BUILT (blocked)** | — | The sheet says "after K01–K03". The concurrent K run is rewriting `agent-executor/launch.ts` on its own branch, so a split here would conflict with that work. |
| G07 daemon scheduler / idle / trace / stores | `aa0a31f25` | DONE | Stop cancels every routine, a single run for a slot plus a concurrent trigger, idle expiry with a fake clock, allowed-only trace and gap rows. `M-emit-after-stop`: 1 red. | `createInMemoryRoutineStore` 80 → 49. `RoutineService.start_` 58 → < 50 (`executeRun`). `createToolGapCollector` 79 → < 50. `withAiTracing` 67 → < 50. `createIdleMonitor` 51 → < 50 (`decideIdle`). |
| G08 builtin features / plugin runtime | `5181cb3f2`, `85ae5d836` | **PARTIAL** (plugin runtime DONE) | Unavailable plugin, failed setup that leaves the sibling loaded, disable/re-enable, dispose drains attachments. The sheet's `M-dispose-in-install-order` has no target, because there is no multi-plugin unwind (see bugs). Substitute mutations each turned 1 red. Reload rollback pin (`85ae5d836`): skipping the restore turns 2/2 red. It also passes on the pre-split code. | `createPluginRuntimeCore` 393 → ~10, split by phase into `runtime-{state,conflicts,activation,boot,reload}.ts` with one `RuntimeState`. Every function ≤ 50. **Left:** `server/builtin-features.ts:createBuiltInFeatures`, deferred per the sheet until K04/K06 land. |
| G09 sidecar JSON IPC | `dc022ca49` | DONE | Chunked reply with a split multibyte character, malformed reply, extra bytes, timeout and late reply, close after a settled error. `M-late-reply-resolves`: 1 red. | `requestJsonIpc` 129 (and its 124-line executor) → 46. A single owner, `createJsonIpcSettlement`, handles settlement. Also removed 3 stale `createJsonIpcServer*` rows. |
| G11 guarded transport / streams | `9d78d8331` | DONE | Pinned-address dial with the original Host, RFC1918 / 169.254 / CGNAT / fe80 / fd00 refused, redirect to a disallowed host refused with zero requests, chunk-stable qoder and role-marker output. `M-drop-pinned-connection-binding`: 3 new and 7 existing tests red. | `pinnedFetch` 79 → < 50 (callback 69 → < 50). `createQoderStreamHandler` 78 → < 50. `createRoleMarkerGuard` 55 → < 50. The paths were corrected: `qoder-stream.ts` and `role-marker-guard.ts` are under `agent-runtime/src/`, not `providers/`. |
| G14 CMS services | `bf1d0acd0` | DONE | Exact backstop refusals with zero saves, redirect round trip, no callback after the watcher closes, a Trash conflict leaves the record and index untouched. `M-trash-write-before-conflict-check`: 2 red. `M-watcher-event-after-close`: 3 red. | `createBackstopService` 69 → 10. `commentsDataModule` 53 → 8. `contributeRedirectPublish` 52 → 19. `createThemeWatcher` 50 → 42. `createTrashHandlers` 50 → 37. Policy members are now read at call time, not destructured at build time; this is identical unless a host mutates its policy object. |
| G15 commerce | `fb3cb0a1e` | DONE (sheet premise adjusted) | Duplicate kicks give one run and one claim, a non-owner never claims, a failed cycle surfaces the same error and releases the claim, method surface and response snapshots. `M-settle-duplicate` (drop the `holding` guard): 1 new and 1 existing test red. | `createSettlementWorker` 74 → 8, using `WorkerState`. `createCommerceServer` 62 → 50. The real idempotency is in `settle-order-payment.ts` / `worker.ts`, which were not targeted (see bugs). |
| G16 tool catalogs | `898164e9e` | DONE | Deep-equal catalog fixtures recorded before the change, risk markers, and a fixture secret that must never appear. `M-tool-risk-default-allow`: 2–3 red per package. `M-schema-exposes-secret`: 2 red each in mcp and platform. | `createPluginRuntimeToolMetadata` 71 → 12. `createRecoveryAgentToolCatalog` 69 → 8. `createExternalMcpAgentToolCatalog` 62 → 9. `saveInputSchema` 60 → ≤ 50. `buildFederatedMcpRegistrations` 58 → 25. `createEmailTemplatesAgentToolCatalog` 52 → 3. |

## Size and complexity counts, before → after (Jini)

- **`size-debt.json` rows:** 59 → **44**. 15 rows were removed and none added:
  - G01 ×2, G02 ×3, G03 ×2, G04 ×1, G05 ×1, G08 ×1
  - G09 ×5, of which 3 were already stale
- **`complexity-debt.json` rows:** 2 → **0**. G04 removed `openFetchFrontendStream.connect` and G05 removed `balancedObjectEnd`.
- **`size-exceptions.json`:** unchanged (same md5). No new exception rows.
- **`check-size`:**
  - Before: 9 new/worsened plus 3 stale rows.
  - After: the same **9 new/worsened**, all pre-existing and none in a file this run touched: admin `kit.tsx` and `rules.ts`, cms `redirects.ts`, chat `useConversation` and `createDaemonAttachmentUploader`, daemon `launch.ts` ×2, server `builtin-features.ts` ×2. **0 stale.** The ratchet is still red only because of those 9.
- **`check-complexity`:** passed before (2 entries) and passes after (**0 entries**).
- **Warn-level (> 50 line) targets:** of the 31 functions this run split, all are ≤ 50 except two: `createAssistantRunFinalizer` (55) and `createFrontendSessionBridge` (59). Both are under the 80 cap.

## Gates (final, on the code heads)

| gate | result |
|---|---|
| Jini `pnpm -r build` | ok |
| Jini `pnpm typecheck` (strict) | ok |
| Jini `api:check` | ok (public exports unchanged) |
| Jini `guard` | 1 violation, the same pre-existing HW3 `admin/src/shell/lib/shell-failure-log.ts` as on b-g6 |
| Jini `check:hooks` / `check:errors` | ok / ok |
| Jini `check:why-comments --base origin/integ/b-g6-2026-11-25` | ok (0 blocks lost) |
| Jini `check:complexity` | ok (0 entries) |
| Jini `check:size` | red: the same 9 pre-existing entries, 0 new or stale |
| Jini vitest, changed areas | 11 of 12 packages green. Commerce: 1298 passed. Chat: 2435. Agent-runtime: 4609. Mcp: 1974. Plugins: 1093. Sidecar: 448. Platform: 396. Daemon: 262. Artifacts: 248. Db: 81. Core: 68 passed and 3 failed, all pre-existing (see bugs). Cms: 7 pglite tests failed while the build ran concurrently; rerun alone they passed 140/140. The packed-consumer `chat/loads-without-driver` passes 12/12 after the rebuild. |
| Tovu root `tsc` / admin `tsc` | 0 / 0 |
| Tovu `check:hooks` / `check:why-comments` (base b-g6) | ok / ok |
| Tovu desktop `npm run gates` | **6/6 PASS** before and after |

## Bugs

All are logged in Tovu `development/open-bugs.md` (`085b5908e`).

- **Fixed: `g6c-follow-durable-run-double-close`** (`a03580ace`). `followDurableRun` closed the same stream more than once, on a disconnect followed by a reopen or `stop()`. The pin went red first.
- **Open (low): `g6c-role-marker-chunk-leak`.** When a chunk split falls inside a marker line, the role-marker guard emits the marker-prefix bytes. Nothing after the marker leaks. This is pinned as a bounded envelope. Fixing it changes behaviour, so it needs the owner.
- **Open (low): `g6c-artifact-parser-inline-code-split`.** A chunk split inside an inline code span can start an artifact. Whole-input parsing is correct. It is pinned by a recorded baseline.
- **Open, pre-existing: `g6c-presplit-reds`.** Both fail the same way on `integ/b-g6-2026-11-25`:
  - Core `provider-neutral.test.ts`: 3 failures (`custom-credentials.ts`, `media-generation.ts`, `site-guide.ts`).
  - Daemon `http/__tests__/characterization/{uploads,paths-queries-state}`: the files fail to load.
- **Re-sheet note: `g6c-sheet-premise-g08-g15`.**
  - G08 has no multi-plugin unwind, so `M-dispose-in-install-order` has no target.
  - G15's idempotency lives in `settle-order-payment.ts` / `worker.ts`.

## Run notes

- **Caps.**
  - Coordinator: about 80 tool calls, about 65 minutes wall-clock.
  - 14 builder dispatches, at most 4 concurrent, each with 16–39 tool calls.
  - Subagent tokens ranged from 68k to 142k. G01 (134k), G02a (120k) and G02b (142k) went past the 120k guideline, but each finished DONE and nothing was lost.
- **Hook nudges.** The "uncommitted changes" stop hook fired while builders were mid-edit. I committed each sheet only when its builder reported green, never half-split files. Pushes followed every sheet, roughly every 3–8 minutes.
- **Scratch.** A temporary detached worktree of `origin/integ/b-g6-2026-11-25` (`/home/user/wt/jini-base`, `node_modules` symlinked) was used only to confirm the pre-existing failures and the pre-split reload pin. It has been removed and nothing from it was committed.
