PARTIAL bb4a826e7 2f5d5a5d1: left: Tovu SOL sheets T2.T / T4.T / T5.T never built (no `codex/tv-f-p3` branch exists), so T3.T (blocked on T2.T) and the T2.T OPUS-REVIEW were not possible; T1a.T serving-app / `W/index.ts` wiring and T1b.T `bootDesktop` wiring + `desktop-agent-service` integration test not done (feature stays dark: `ROUTINES_RELEASE_ENABLED = false`)

# feat-p3 (2026-11-25): P3 Routines on `integ/feat-p3-2026-11-25`

Unattended cloud run. Opus coordinated. I read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) first, and every brief carried its rules.

## Run facts

- **Base:** Tovu `7c87b3c3f` and Jini `010c8cd87` (both `integ/merge-21-2026-11-24`).
- **Inputs:**
  - Jini `codex/f-p3j` `2c5e03783`. It fast-forwarded onto merge-21.
  - **Tovu `codex/tv-f-p3` does not exist on origin.** I searched all 242 `codex/*` refs and every commit since 11-23 for p3/routine. The only matches are plan and review commits. The Tovu SOL sheets therefore have no Sol code to test.
- **Code tips:**
  - Tovu `bb4a826e7`, plus this report.
  - Jini `2f5d5a5d1`, plus the report copy.
- **WIP refs:** `integ/wip-feat-p3` on both repos (pushed after every step).
- **Setup:**
  - Node 24.22.3 with `/opt/node24/bin` first on PATH.
  - Jini: `pnpm install --frozen-lockfile && pnpm -r build`.
  - Tovu: `npm ci --ignore-scripts` (root, admin, desktop, site-chat), then `link:jini` (`JINI_PACKAGES_DIR=/home/user/Jini/packages`), `prepare-desktop-hooks`, and a build of contracts and sdk.
- **Gate 0:** desktop `npm run gates` on the merge-21 Tovu base passed 6/6.
- **Rules held:**
  - No force-push, no `--no-verify`, hooks untouched.
  - No codebase-memory tools.
  - `main`, `plan/*`, `release/*`, `codex/*` and `integ/merge-*` untouched.
  - No tag, no publish.
- **Caps:**
  - Coordinator: about 175 tool calls, about 1 h 15 min wall clock.
  - Four subagents ran, never more than 2 Tovu builders at once. All stayed under 50 calls (36 to 43). On context:
    - The triage agent used 52k.
    - **Three Opus builders overran the 120k context cap:** T1a pieces 128k, T1b 121k, T1a composition 147k. I'm reporting this rather than hiding it.

## Sheets

| sheet | built by | status | tests + mutation |
|---|---|---|---|
| P3-J1.J durable scheduler + lease fencing | Sol, Opus fixed | **DONE**, tested | 3 Sol tests were red. Root cause: no renew-on-wake, so after a suspend the owner's lease had expired on wall time and its own claim returned `lease-lost`. Fix: `ensureLease()` before any wake reconcile or late timer (holder-checked; a failed renewal fences like a failed heartbeat). One test had a wrong `whenReady` assumption (whenReady covers lease and interruption only). **Sleep-safe takeover (check P3 uncovered risk):** injected `monotonicNow`; a passive peer whose wall clock ran more than TTL/3 ahead of monotonic since its last look waits one more awake TTL. New `scheduler.lease-sleep.test.ts` (3): `sleep past the 90 s TTL does not let a waking passive peer interrupt the owner's live run` (the passive timer wins the first wake turn); `a dead owner is still taken over after one awake TTL, and its run is recorded Interrupted`; and owner renew-on-wake. **M `drop-sleep-check`** → 2 red. **M `drop-renew-on-wake`** → 2 red. Guard R14 runtime cycle `durable-scheduler ↔ scheduler` (Sol) fixed: the errors moved to a leaf `routine-errors.ts`, exported from the barrel, so the API is unchanged. |
| P3-J2.J SQLite store, ADR-066 migration, routes | Sol, Opus fixed | **DONE**, tested | **Pin bug:** the 0001 step imported its DDL from `routine-store.sqlite-schema.ts`, so the pinned source hash did not cover the schema. The DDL moved into `0001_jini_routines_v1.ts` (the one DDL source; the node entry re-exports it as `SQLITE_ROUTINES_SCHEMA`) and the schema file was deleted. Real pin `95c75807…77b2` is generated, and the pin test asserts no `VACUUM`. New test: real `@jini-ai/db` `runMigrations` on a borrowed better-sqlite3 handle via `sqliteKernel`. It applies `['0001_jini_routines_v1']`, a rerun applies `[]`, then the host-mode store opens. A missing ledger stamp is refused. A pruning-fixture bug (4 runs on one scheduled slot) was fixed. Sol mutations were not re-run; the real-runner and pin tests are the Opus verification. |
| P3-T2.J chat boot recovery admission | Sol, Opus reviewed + fixed | **DONE**, tested | Review fix: admission failure logged through a direct `console.error`. It now goes through an injected `log(code)` on `createChatRunLedger` (code only, never error text), with the helper hoisted and a why-comment. `run-ledger.cov-j2` + `lazy-run-ledger`: 31/31. **M `recover-before-admission`** → 2 red. |
| P3-T2.T owner-chat acceptance | — (SOL, OPUS-REVIEW) | **NOT BUILT / NOT REVIEWABLE** | No Sol branch. |
| P3-T4.T routine tools | — (SOL) | **NOT BUILT** | No Sol branch. |
| P3-T5.T Routines screen + deep link | — (SOL) | **NOT BUILT** | No Sol branch. |
| P3-T1a.T serving-site host, routes, sidecar, beacon | Opus (2 subagents) + coordinator | **PARTIAL**: everything except serving-app wiring | **Files:** `features/routines/{routines-paths,routine-commands,routine-host}.ts`, `platform/db/sqlite/routines-db.ts` (WAL, busy_timeout 5000, FK), `modules/assistant-routines.ts` (`composeAssistantRoutines`; the seven Jini factories at `/api/admin/assistant/routines{,/:id,/:id/run,/:id/runs}` through the owner gate, session-credential-only, writes same-origin), `routineDesktopEligible` (true only on the accepted desktop branch), README, and `@tovu/contracts/routines` (`ROUTINES_RELEASE_ENABLED=false`, actor, target, beacon, wake IPC). **Tests:** 50/50 on the new files, including the integration test on a real sidecar. Signin 12/12. **Mutations:** `desktop-gate-uses-env-presence` 7 red, `start-only-on-admin-connect` 3 red, `close-before-drain` 1+2 red, `reschedule-before-commit` 3, `skip-access-recheck` 1, `store-before-migrate` 2, `interrupt-foreign-runs` 2, `beacon-write-in-place` 2, `no-busy-timeout` 1, `ops-to-site-root` 2, `publish-allows-ops` 1. **`trust-body-owner` survives:** Jini's create parser already drops body `creatorId`/`owner`/`target` before the host sees them, and the test still pins creator = session principal. **Private files:** `ops/` is already excluded from backup, portable copy and publish (including `data.nosync`); tests now pin it. **Left:** `createServingApp`/`W/index.ts` wiring (real `access` = `principalHoldsOwnerWildcard`, store-close hooks, defaults); end-to-end Express cross-origin/non-session refusal (pinned only as mount flags); `ERR-` id on store-open failure; passive-profile test. |
| P3-T1b.T desktop boot, wake IPC, sleep-safe takeover | Opus (subagent) + coordinator | **PARTIAL**: modules built, `bootDesktop` not wired | **Files:** `D/main/boot/routine-sites.ts` (registered sites only, bounded versioned beacon, concurrency 2, withdrawal rechecked before each start), `D/main/boot/routine-wake.ts` (`relayWake` debounce 2 s, owned IPC handles only), `W/features/routines/routine-wake-receiver.ts` (exact message only; logger made a REQUIRED injected prop by the coordinator), the owned-handle `sendRoutineReconcile` in `tovu-server.ts` (only with the release flag), and withdrawal recorded in `handleStop` before the queued stop. **Tests:** routine-sites 9, routine-wake 6, receiver 5, tovu-server 87, project-ipc 160. **Mutations:** `drop-withdrawal-recheck` 2, `send-to-attached` 1, `accept-any-shape` 1, `drop-stop-withdrawal` 1. The sleep-safe lease test lives in Jini (J1.J row). **Left:** `bootDesktop`/`powerMonitor` wiring, the `desktop-agent-service` integration test, and a withdrawal recheck *inside* the serialized start key (it is currently checked just before `startSite`). |
| P3-T3.J authoritative approval receipts | Opus (coordinator) | **DONE** | `open({binding,emit},{onApprovalReceipt})` on leased exchanges reports `open` → `answered(confirmed)` \| `ended(expired\|abandoned)`. Each fires at most once, synchronously in try/catch, never awaited; a rejected promise is swallowed. `answered` fires before any waiter resolves. A fast answer during the first emission still reports `open` first. A close after an answer reports no `ended`. Wrong binding, duplicate deliveries and unleased exchanges report nothing. Tests first, 7: ordered receipts; reported before the handler resumes; fast answer; wrong principal/tool/duplicate silence; abort → ended and nothing before emission; unleased silence; `observer that throws changes neither the answer nor the effect count` (sync throw and async reject). **M `drop-run-bound-lease`** → 1 red. **M `drop-answer-once`** → 1 red. Core/daemon changeset `surface-approval-receipts.md` and baselines added. |
| P3-T3.T observe federated approval | — | **BLOCKED** | Needs T2.T owner-chat acceptance. |

## Gates vs merge-21

**Jini** (final):
- `pnpm -r build`: 0.
- Typecheck (strict) for daemon, chat and core: 0 errors.
- `api:check`: 0. Baselines refreshed for chat, core and daemon only. The admin and user-management drift predates P3 and was left alone.
- Changesets: durable-routine-scheduler, routine-recovery-admission, sqlite-routine-store, surface-approval-receipts.
- `guard`: 1 violation, the same as merge-21 (HW3 `admin/shell/lib/shell-failure-log.ts`). The new R14 cycle was fixed.
- `check:hooks` ok. `check:why-comments --base merge-21`: 0 blocks lost.
- Routines + http routines + surface + args-convention: 337/337. Core `contracts/server`: 292/292.
- Full chat: 4666 pass.
- Full daemon: 15 failed, 5016 pass. **Pre-existing:** the uploads characterization `familyDeps.attachments` lacks `maxAttachmentBytesFor` (added in `7c0c6d48d`), so the harness proxy throws and the route returns 500. Not in P3's files.
- Full core: 3 failed. **Pre-existing:** `tool-metadata/__tests__/provider-neutral.test.ts`; core tool-metadata is untouched by P3.

**Tovu:**
- Root `tsc`: 0. Admin `tsc`: 0. `check:hooks`: 0. why-comments (`--other-root` Jini): 0.
- `check:boundaries`: was red only on "unranked feature: routines". `routines` is now ranked 0 (it imports no feature): 0 errors, 145 warnings.
- `typecheck:tests`: 289 → 282 after fixing the 7 P3 errors. None of the remaining 282 are in P3 files.
- `check:complexity` / `src-complexity-drift`: 5 "new" violations, all in files P3 never touched (themes hooks, jini-admin modules, agent-plugins public-config, newsletter confirmation, site-databases). This drift predates P3.
- Node tests on changed files: 50/50.
- Importers:
  - `dev-auth*`, `local-owner-signin`, `admin-local-boot-session-route`, `k1-forwarding`: green.
  - **Pre-existing reds:**
    - `boot-readiness-gate` "imports inspectSiteKeyMaterial from the real keyring module" (file untouched by P3).
    - `owner-passkey-http.integration` (also red with my fixture edit reverted).
- Desktop `npm run gates`:
  - 6/6 on the base.
  - 6/6 in the pre-push hook at `b258b85c5`, the last desktop change.
  - The final run at the tip is recorded under "Final desktop gates" below.

## UNVERIFIABLE-IN-CLOUD
- Packaged Electron: real `powerMonitor` resume, real machine suspend past the 90 s TTL, and two profiles sharing one site. The logic is pinned with fake timers and an injected monotonic clock. `performance.now()` not advancing during suspend is an OS property that holds on macOS and Linux, and was not observed live.
- Daemon restart from idle with no tab, one labeled catch-up after sleep, and catch-up after reopening to Sites Home. None of this is wired yet.
- Chrome UI (screen, deep link, keyboard, locale, light/dark). Not built (T5.T).
- Real CLI adapters (Claude, Codex, agy) and Codex's 400 s deadline versus a live exchange.

## New bugs / findings
1. **Fixed (Jini):**
   - Durable scheduler had no renew-on-wake, so after any sleep the owner could not claim its own due slot.
   - The passive-peer sleep takeover could interrupt a live owner's run.
   - The migration pin did not cover the DDL.
   - Runtime import cycle (guard R14).
   - Chat admission logged through `console.error` (no injected logger).
2. **Fixed (Tovu):** the wake receiver defaulted to `console.warn` (the logger is now required).
3. **Follow-up (perf):** the SQLite store's `list()` reads every routine's full run history (up to 200 × 100 rows) on every claim, get and update to compute `lastRun`. This is an N+1 per call. Bounded, but it should become one `lastRun` query.
4. **Pre-existing reds:** listed under the gates above (Jini daemon uploads fixture, Jini core provider-neutral, Tovu boot-readiness-gate pin, Tovu owner-passkey integration, Tovu complexity drift, Tovu 282 test-typecheck errors).
5. **Gap vs sheet:** the T1b withdrawal recheck happens before `startSite`, not inside the serialized start key. The serving-site Jini route factories keep `requireSameOrigin`, but it has not been exercised end to end through Express.
6. **Input gap:** Tovu `codex/tv-f-p3` was never pushed. Sol must build T2.T, T4.T and T5.T (or re-dispatch them) before T3.T and the combined gate.

## Final desktop gates
`cd apps/desktop && npm run gates` at Tovu `bb4a826e7`: **6/6 pass** (tree-quiet, tests, typecheck, coverage, complexity, js-backslide), same as merge-21.
