PARTIAL 424dc62ac e920bb881: left: (1) T2.T step 4 compares the recovery marker with the stored owner/workspace/conversation/message and `routine-<runId>`, but not with the persisted user-turn context; (2) while routines are still starting, the tools report availability `error` and say "data file could not be opened" (wrong copy for that short window, needs a "starting" decision); (3) the combined release gate (Chrome UI, packaged Electron, real CLIs) cannot run in cloud. Every sheet is built and wired. The feature stays dark: `ROUTINES_RELEASE_ENABLED = false`, and it is **not yet safe to enable** (see below).

# feat-p3 continuation (2026-11-25): P3 Routines on `integ/feat-p3-2026-11-25`

This was an unattended cloud run. Opus coordinated, and the builders were Sonnet (high) and Opus (high) subagents. Before dispatching, I read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5). Its rules went into a shared brief (`/tmp/claude-0/brief-common.md`): test-first, injected ports, required hook props, fn ≤ 80, complexity ≤ 10, why-comments, and the honest-testing bans.

## Run facts

- **Base:** Tovu `a7fd5531f`, Jini `edef30532`. Both are the previous feat-p3 tips, built on merge-21.
- **Code tips:** Tovu `424dc62ac`, Jini `e920bb881`. Both are pushed; this report commit comes on top of each.
- **Setup:**
  - Node 24.22.3 (`/opt/node24/bin` first on PATH).
  - Jini: `pnpm install --frozen-lockfile && pnpm -r build`, exit 0.
  - Tovu: `npm ci --ignore-scripts` in the root, admin, desktop and site-chat; then `link:jini`, the `prepare` hook install, and a contracts + sdk build.
- **Gate 0:** desktop `npm run gates` passed 6/6 on a clean worktree of the base. The first attempt ran in the shared tree while a builder was editing desktop files, so I discarded it.
- **Rules held:**
  - No force-push, no `--no-verify`, and `core.hooksPath` untouched. Every Tovu push ran the desktop pre-push gate, which passed 6/6 at `d798e8574`.
  - No codebase-memory tools.
  - `main`, `plan/*`, `release/*`, `codex/*` and `integ/merge-*` untouched. No tag, no publish.
- **Caps:**
  - Coordinator: about 120 tool calls, about 1 h 35 min wall clock (07:00 → 08:36 UTC). At most 4 subagents ran at once.
  - **Over cap (reported, not hidden):** six first-round builders went past the 120k context cap: T2.T 181k, T4.T 193k, T1-wiring 175k, T5.T 192k, T3.T 146k, plus the two fix agents at 125k. T4.T also went past the 50-call cap (57). The second-round agents stayed under both caps (101k/23 calls and 66k/19 calls).

## Sheets

| sheet | built by | status | tests + named mutations |
|---|---|---|---|
| P3-T1a.T serving host: wiring | Opus | **DONE** | **Wiring:** `W/index.ts` and `cli serve-listen.ts` read `bootLocalOwnerSignIn` once. `serve-listen` was needed because the desktop spawns `tovu serve`, which never runs `W/index.ts`. They pass `routineDesktopEligible` and `ROUTINES_RELEASE_ENABLED` into `createServingApp`. `modules/serving-routines.ts` binds owner access (`holdsSiteOwnerAuthority` → `principalHoldsOwnerWildcard`, mounted workspace, deny by default), `mountAdminJsonRoute` with `sessionCredentialOnly`, the `deps.ts` close hooks (`site-deps/store-close-hooks.ts`), the atomic tmp+rename beacon, unref'd timers and the wake receiver.<br>**Tests:** `serving-routines.integration` 5/5 through real Express: cross-origin write → 403, non-session → refused, same-origin owner create → ok. `assistant-routines.integration` 12/12, including store-open `ERR-` id, passive other-window never runs a due slot, and fallback settlement.<br>**Mutations:** `desktop-gate-uses-env-presence` → 2 red, `drop-origin-context` → 3, `drop-error-id` → 2, `id-leaks-to-any-refusal` → 1, `body-target-required` → 3. |
| P3-T1b.T desktop boot/wake: wiring | Opus + coordinator | **DONE** | **Wiring:** `D/main/boot/routine-desktop.ts` (`armDesktopRoutines`) is wired into `bootDesktop` after `runDesktopBoot`, not in attach mode. It lists the registered sites, reads the beacon through `sharedSites.databasePath`, and uses `openSiteServer` with concurrency 2. `powerMonitor.resume` goes through `relayWake`, which is disposed in `before-quit`. The withdrawal recheck now runs **inside** the serialized start key (`startRoutineSiteInBackground`).<br>**Tests:** the integration test in `desktop-agent-service.test.ts` checks that only registered sites with an enabled beacon start, a withdrawn site stays stopped, resume reaches the owned child only, and an attached handle never sends. `project-ipc` race test.<br>**Mutations:** `drop-withdrawal-recheck` → 1, `send-to-attached` → 2, `skip-receiver-teardown` → 3.<br>**Coordinator fixes** for 6 desktop reds: the vm harness lacked the new quit binding (now pinned by source), the smoke electron stub lacked `powerMonitor`, and `main/index.ts` must not contain `listSites`, so the port is named `registeredSites` at the main boundary. |
| P3-T2.T owner-chat acceptance | Sonnet; Opus reviewed the marker and admission tests | **DONE except left (1)** | **Code:**<br>- `assistant-run-acceptance.ts`: `acceptOwnerChatRun`/`watchSettlement`/`cancelChatRun`. `proxyAcceptedRun` is HTTP-only and never passes `routine`. `sanitizeBrowserRunContext` strips `routine` before both the durable path and the proxy fallback.<br>- `routine-run-handler.ts`.<br>- `routine-recovery-admission.ts`, with `admit` threaded through `run-finalizer/entry.ts`.<br>- Strict marker decode, plus a strict routine branch in daemon tool access.<br>- Production wiring: the real handler is installed when a durable run store exists; otherwise the "Routines are not ready yet." fallback stays. `routineBoot` is forwarded to assistant-chats, and only the lease owner waits.<br>**Tests:** acceptance 7/7, handler 15/15, admission 8/8, decoder 27/27, tool-access routine 3/3, `create-app-routine-wiring` 4/4, `serving-routines-run-handler` 5/5.<br>**Mutations:** `retained-browser-marker` → 1, `direct-executor-invocation` → 8, `skip-admission` → 1, `skip-interruption-cancel` → 3, `admission-always-recover` → 3, `drop-routine-boot-forward` → 1, `drop-routine-tool-branch` → 1.<br>**Review:** a forged or mismatched marker falls back to ordinary recovery (the safe direction). A browser cannot plant a marker, because acceptance deletes it before the durable write. |
| P3-T4.T routine tools | Sonnet + Opus wiring | **DONE except left (2)** | **Prerequisite verified:** `ToolApprovalMetadata` has `confirmation:'direct'` and `class:'edit'`.<br>**Code:** four tools, with direct metadata. Each write opens the existing `requireHumanConfirm` card inside its handler. Revision CAS, owner recheck after the card, "Nothing was changed." / stale copy. 9 strings in 22 approval locales. Discovery is filtered by owner and readiness. Production supply comes from `modules/serving-routine-tools.ts`: lazy, using the same command gate as the admin routes, and only when the host is desktop-eligible **and** the release flag is on.<br>**Tests:** 17/17, serving-routine-tools 6/6, and `createApp` registers exactly the 4 IDs only with the flag. Allowlist completeness: the routine case passes. Golden catalogs were not regenerated.<br>**Mutations:** `create-before-card` → 4, `delete-before-card` → 3, `drop-tool-supply` → 3.<br>**Coordinator:** `approval-single-path` now names the routines file as a direct card owner, the same shape as database transfer. |
| P3-T5.T Routines screen + deep link | Sonnet | **DONE** | **Code:**<br>- `A/features/routines/*`: api, row projection, i18n, controller hook, screen, form, mount, deep-link hook.<br>- Release-gated `/routines` panel and the `AdminApiBasePath` literal.<br>- `routinesKit`.<br>- `query` (REQUIRED) is threaded through `App` → `App.chrome` → `AssistantDock` → `useAssistantDockState`; 59 dock fixtures updated.<br>- **Jini:** a translated "Routines" nav label in all 21 locales, with a changeset.<br>**Tests:** routines 20/20, dock deep-link integration 3/3, Jini nav-i18n 4/4.<br>**Mutations:** `missing-approval-projection` → 2, `link-without-select` → 3, `drop-es-nav-label` → 1. The screen catalog and mounting assertions are for combine, per the sheet. |
| P3-T3.T observe approval (no redeem) | Opus | **DONE** | **Transport decision: in-process projection** (README + commit). `human-confirm.ts` has an optional `approvalReceiptsFor` port, which passes `onApprovalReceipt` to `open()` only for tracked routine runs. For those runs the lease `retry` is a no-op, so a closed invocation is never restored. `routine-approval-observer.ts` + `classify-routine-approval.ts` handle the projection. Production: `byok-tool-surface` → `handle.approvalBindingFor`.<br>**Run-id equality:** the durable `run.runId` → daemon launch → `remote-tool-executor` `run.id` → `ctx.run.id`. Traced by reading the code.<br>**Tests:** `routine-approval.integration` 15/15, with the real leased exchange store and the real `requireHumanConfirm`: the 7 named tests plus duplicates, overlap, revocation, closed-invocation refusal and the nonroutine restore. human-confirm lifecycle 25/25, unmodified.<br>**Mutations:** `drop-lease` → 1, `clear-waiting-on-any-tool-result` → 1, `receipt-through-answer-path` → 11, `no-restore-refusal` → 1, `drop-message-binding` → 1, `drop-expected-ref` → 1, `drop-settled-refs` → 1, `drop-receipt-port` → 2. (The T3 builder wrote the code before the tests; the mutations are its evidence.) |
| Jini J1/J2/T2.J/T3.J | previous run | DONE | Unchanged. The chat API baseline was refreshed for the `createChatRunLedger` log port (`e920bb881`). |

## Gates (final)

**Desktop:** `npm run gates` passed 6/6 in the pre-push hook at `d798e8574`, the last desktop change (`5fc404e93`). Nothing under `apps/desktop` changed after that.

**Tovu:**
- Root `tsc`: 0 errors. Admin `tsc`: 0 errors.
- `check:hooks`: ok.
- `check:boundaries`: 0 errors, 145 warnings, the same as before.
- `check:why-comments --base 7c87b3c3f --other-root Jini`: 0 lost. I restored one moved comment.
- Website node tests on the changed files plus importers (137 files, 1476 tests, concurrency 2):
  - 1461 pass. The 1 new red (`approval-single-path`) is fixed.
  - **14 pre-existing:** every one fails the same way on a clean base worktree. They are Gemini schema, media get-by-id, two boundary pins, allowlist "known openers (`assistant_render_ui`)", the contributor-domain list, `tool-registrations.contracts` (missing `mail-status` module), search top-3, the owner-passkey integration, the executable-tools confirmation store, pages html revisions ×2, daemon dev bypass, and the plugin lifecycle row 7.
- Admin vitest (routines, AssistantDock, `src/__tests__`): 1266 pass, 7 fail. **All 7 are pre-existing** and identical on the clean base: four CSS pin files and the Login locale pin.

**Jini:**
- `pnpm -r build`: 0. `@jini-ai/admin` was rebuilt after the nav label, and its `tsc`: 0.
- `guard`: 1 violation, the same as merge-21 (HW3 `admin/shell/lib/shell-failure-log.ts`).
- `check:hooks`: ok. `check:why-comments --base edef30532`: 0 lost.
- `api:check`: the chat drift is fixed. The admin `react/kit` and user-management subpath drift **predates P3** and is left alone.
- Daemon routines + http routines: 172/172.
- Jini daemon/core/chat source did not change this run.

## Safe to enable `ROUTINES_RELEASE_ENABLED`? **No.**

Every Routines unit and integration test and the desktop integration test pass. But the sheet's combined release gate is not met:

- **Not run (cannot run in cloud):** Chrome create/decline/edit/pause/resume/delete, keyboard, locale, timezone, light/dark, and the authorized conversation link.
- **Not run (cannot run in cloud):** packaged Electron restart from idle with no tab, one catch-up after sleep, Sites Home catch-up, two profiles across a sleep past the TTL, a zero-tab leased approval followed by exactly one effect, and quit-with-pending → Interrupted.
- **Not run (cannot run in cloud):** every enabled CLI (Claude, agy), checked live.
- **Open items:** left (1) and (2) above.
- **Not proven end to end:** run-id equality across the real daemon. It was traced by reading the code only.

## UNVERIFIABLE-IN-CLOUD

- **Packaged Electron:** real `powerMonitor` resume, a real suspend past the 90 s TTL, two profiles on one site, and the `tovu serve` child receiving `routines.reconcile` over the real IPC channel.
- **Real daemon + CLI adapters:** zero-tab approval → exactly one effect, and Codex's 400 s deadline. Codex stays refused by default.
- **Chrome UI** for the screen and the deep link: no Playwright run, and the screen catalog was deferred to combine.

## New bugs / findings

1. **Fixed: same-origin admin JSON writes returned 500, not 403.** No admin JSON route had used `requireSameOrigin` before. `mountAdminJsonRoute` now gives every such spec the browser-write origin context (`adminBrowserWriteOrigin`, core `isSameOriginBrowserWrite`), so a later route is covered without opting in.
2. **Fixed: every real routine create would have failed with 400 "target is required".** Jini's create route requires a body `target`, while the host fixes the target and the admin form never sends one. The composed target is now applied before Jini validates the body. The earlier harness missed this because its test bodies always carried a target.
3. **Fixed:** the store-open refusal now carries the admin `ERR-` id, and only on that refusal.
4. **Fixed:** desktop main wiring broke 6 desktop tests (quit binding, smoke stub, `listSites` pin).
5. **Fixed:** the P3 chat API baseline was stale (`createChatRunLedger`).
6. **Follow-up:** availability during routine startup reads `error` (left (2)).
7. **Follow-up:** if routines compose hangs, the lease-owner chat repair waits with it. That is by design, but the wait is unbounded; consider a bound.
8. **Follow-up (from the earlier run, still open):** the SQLite store's `list()` makes N+1 `lastRun` reads.
9. **Pre-existing reds:** listed under Gates above.

## Commits this run

**Tovu:** 89e7289d7, dd642215e, db8aea9bc, 8ddfcb2e3, 2eb242032, f9c133020, 064d6145f, 97df1c568, 60653b9c9, 10bd8b047, 1678fc5ee, 4b6dce00a, eac5ac8cd, 52883aee5, 145928627, 01daa8a3e, 5fc404e93, 825411658, b8483f372, 01e975d0b, d798e8574, c53d39d8e, e89819e16, 6326ccf1c, 115c8cba6, 424dc62ac.

**Jini:** 7664742bc, e920bb881.
