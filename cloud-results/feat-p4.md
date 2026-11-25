PARTIAL 671bbb0250 95fd63c10: left T3b (31-file legacy HTTP consumer migration + 7 `errors` mount seams), J3a/J3b (HOLD, T3b not landed), T5 (test-only, not built), J4 item 3 (retired `onInternalError` option still in 14 daemon http files), T2 remaining host edges (direct admin JSON branches, tracker-only callers, desktop binding, INFO.md Wiring, manifest/lockfile)

# feat-p4 (2026-11-25): P4 Errors on `integ/feat-p4-2026-11-25`

This was an unattended cloud run. Opus coordinated. Opus high-effort workers did all the ordering, redaction and incident-ownership sheets; Sonnet high-effort workers did J5 and the reader tests. There were 17 dispatches, never more than 4 at once. I read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) first, and every brief carried its rules: root cause first, failing test first plus a named mutation, inject everything, fn ≤ 80 / complexity ≤ 10, no re-export shells, why-comments moved with code, no `--no-verify`.

- **Base:** Tovu `7c87b3c3f` / Jini `010c8cd87` (`integ/merge-21-2026-11-24`).
- **Sol branches** (fast-forward, one commit each): Jini `codex/f-p4j` `196cd5e4e` = **J1 only**; Tovu `codex/tv-f-p4` `7092c1b54` = **T1 only**. Sol did **not** build J5 or T5. J5 was built here; T5 was not.
- **Tips:** Tovu `671bbb0250`, Jini `95fd63c10`. Both are also on `integ/wip-feat-p4`, which was pushed after every step.
- **Setup:** Node 24.22.3.
  - Jini: `pnpm install --frozen-lockfile && pnpm -r build`.
  - Tovu: `npm ci --ignore-scripts` in root, admin, desktop and site-chat, then `JINI_PACKAGES_DIR=/home/user/Jini/packages npm run link:jini`, `prepare-desktop-hooks` and a contracts build.
- **Gate 0:** desktop `npm run gates` on merge-21 passed 6/6.
- **Rules held:**
  - No force-push, no `--no-verify`, hooks untouched.
  - No codebase-memory tools.
  - `main`, `plan/*`, `release/*`, `codex/*` and `integ/merge-*` untouched.
  - No tag, no publish.
- **Caps:**
  - Coordinator: about 180 tool calls; wall clock 05:31–07:25 UTC (about 1 h 55 min).
  - Several workers went over the 120k context cap, finishing at 130–178k: T2 lifecycle, J4a, J4b, T3, J2b ×2, J5. Each one stopped at its own cap or hard stop, and I did not resume any of them.

## Sheets

| sheet | built by | status | tests + mutation |
|---|---|---|---|
| P4-J1 refusal disclosure | Sol (tested here) | **DONE** | Core errors 80/80. **M** `match.message ?? fallback` in the own-message arm → 1 red. The changeset is as specified. The L6 proof is impossible against merge-21's baseline, as the sheet says. |
| P4-T1 shutdown settlement | Sol (tested here) | **DONE** | The shutdown pin is green. **M** drop `await` → red. `daemon dev mode passes bypass` was already red on merge-21. |
| P4-T2 exact-secret gap (`reporter.ts:110-127`) | Opus (me) | **DONE** | Jini `ce6fc9b43`. `exactSecrets` (standing and per-call, non-empty) now goes on `ErrorReport.context.exactSecrets`, documented as private in-process input. Test first: 2 red, then green. **M** drop-forward → 2 red. Tovu provider canary: `record with exactSecrets ['canary-secret'] never reaches the provider`, through the real Jini `createTracker`, is green. |
| P4-J2a core lifecycle | Opus | **DONE** | The `ClientFacingError` leaf move (`bcf5cd6e3`; cycles guard 0). `runOperation` classify/settle, contained `trackOperation`/`end`/reporter, `startOperation`/`endOnce`/`NOOP_OPERATION_TRACKER`, attribute admission, and per-reporter object dedupe. errors 81→105. 24 mutations; one survives: the attribute exact-secret check alone, because the redactor check also drops exact secrets, so the check is kept for intent. Closeout `be8604398`: changeset `core-route-operation`, API baseline, and the reporter's runtime closure declared shared in `jini.isolation` (the sheet-approved contracts→errors edge, following the `errors/idioms.ts` precedent). |
| P4-J2a Fetch binding | Opus | **DONE** | `RouteErrorPorts`, `RouteHostContext.errors?`, legacy and reporter modes. json-route 19→33 (all 10 sheet rows verbatim). contracts+errors 550/550. 8 mutations red: drop-classify, record-returned-INTERNAL_ERROR, onInternalError-in-reporter-mode, url-not-pattern, onError-after-reporter, rethrow-policy-error, settle-ignores-abort-like, second-describe. |
| P4-J2b Express + factory | Opus | **DONE** | Jini `fc2f03185`. adapter 96→114. 10/10 mutations red, including write-before-end and second-answer-after-headers. |
| P4-J2b raw + node bridge | Opus | **DONE, 1 gap** | 76→87. M1–M6 red. The double-record mutations are absorbed by core's object dedupe. **Gap:** raw body-cap/origin refusals are still written by the adapter gate helpers before the operation ends. |
| P4-J2b server preset | Opus | **DONE, 1 gap** | server 503→507. M1–M3 red. Changesets for http-kit and server. **Gap:** none of the 19 `mountRoutes` calls in `builtin-features.ts` pass `reporter` yet (this matters only after headers). |
| P4-J4 tool half | Opus | **DONE** | tool-recovery 148→159. `onFailure`/`ToolFailureRecord`/`safeOnFailure` deleted, with no shim. The decorator is installed unconditionally. Mutations mint-second-id 6, restore-noop-skip 5, omit-explicit-tracker 1, dedupe-reliance 1, nested 2. |
| P4-J4 route half | Opus | **PARTIAL** | Jini `f3b0f4fa9`. Delegated disclosure `{ errorId, message }`. A trusted stamped ID is reused without a write. The describer console sink is gone, replaced by a fixed warning through the injected logger. model-proxy uses plain words and the ERR ID, with no upstream text. Mutations restore-console-describer-sink, mint-second-id-in-route, trust-client-id and forward-upstream-text ×4 are red. Changeset `daemon-route-tool-reporter` (major). **Left:** item 3, stripping the retired `onInternalError` option from the 14 http files. |
| P4-J5 sidecar IPC | Sonnet (SOL sheet, built here) | **DONE, 2 WARN rows** | sidecar 442→454. M1–M7 red. Changeset minor; 3 stale size-debt rows removed. The worker wrote code before tests, but the mutations prove the pins. WARN-mode `check:log-safety` and `check:errors` rows on `json-ipc.ts`: see the gates table (WARN rows, not fixed). |
| P4-T2 reader parity (E4-T-READERS) | Sonnet | **DONE** | Tovu `83f4091839`. 14→24 and 23→28. Mutations on Jini dist (restored and checked with cmp): swap-precedence 2, drop-nested-decode 4, ignore-decoded 8. These tests found a **real bug**, fixed test first: Jini `f4c75e3b5` (admin patch) and Tovu `5f9c1d38a0`. Now 52/52. |
| P4-T2 factory + canaries | Opus | **DONE** | `createTovuErrorReporter`, `trackerReportPort` (consumes `exactSecrets` first, clean Error view with no cause or custom fields, bounded attributes) and `build-constants.ts`. 6/6 + 4/4, which I re-ran myself. Mutations: drop-exactSecrets-consumption 1, drop-clean-view 2, forward-cause 2, forward-exactSecrets 1, unfiltered-attributes 2, tracker-throw-escapes 1, image-tag-wins 2, first-package-json 1. |
| P4-T2 admin-failure lifecycle + createApp | Opus | **DONE** | Tovu `a3f72cd782`. C115 first. The recorded ID wins in the reply and in Copy details. Tracker `'skip'` happens only when this error object was admitted in this request. admin-failure.unit 8; observability-error-report 8→11. Mutations restore-console-sink 3, record-twice 5, report-before-C115 11, skip-on-any-report 2. |
| P4-T2 daemonRouteHost / mountJiniRoutes | Opus | **DONE** | Tovu `2b9f8e2881`. 10→14, including the two-site isolation fixture. Mutations legacy-binding-with-errors, shared-reporter-across-sites and drop-dispatcher-reporter are red. `errors` stays optional until every caller passes it. |
| P4-T2 other host edges | — | **LEFT** | Direct admin JSON branches (`admin-json-route-ports.ts:233,315`), the tracker-only callers list, desktop HTTP binding, INFO.md Wiring, manifest/lockfile ranges, and the Chrome admin 500 correlation check. |
| P4-T3 daemon + BYOK tools | Opus | **DONE, 1 left** | Tovu `f727415031`. One reporter per authorized site scope, shared by tools and scope HTTP. BYOK reuses createApp's reporter. `agent-daemon-scope-tools.reporter.integration` 2/2. **M** second-reporter-in-createScopeToolExecutor → red. Fixtures moved to `testToolReporter()`. Root tsc 0. **Left:** pass the scope reporter to the scope/attachment `mountJiniRoutes(..., { reporter })` calls. `reportCancelled` does not exist in the Jini API, so it is not bound. |
| P4-T3b consumer gate | — | **NOT STARTED** | 31 test files plus the 7 mount seams. |
| P4-J3a / P4-J3b | — | **HOLD** | The T3b gate has not cleared. |
| P4-T5 ownership proof | — | **NOT BUILT** | Sol did not build it. It needs the full T2/T3 wiring. |
| P4-T4 | — | NOT-SHEETED | It landed earlier in `04d030b5a`. |

## Gates vs merge-21

| gate | merge-21 | feat-p4 tip |
|---|---|---|
| Tovu desktop `npm run gates` | 6/6 PASS | **6/6 PASS** (run at the end, 07:07–07:17) |
| Tovu root `tsc -p tsconfig.json` | 0 | **0** (after the final Jini rebuild) |
| Tovu admin `tsc` | 0 | **0** |
| Tovu `check:hooks`, `check:boundaries` | 0 | **0 / 0** |
| Tovu why-comments (`--base merge-21 --other-root Jini`) | — | **0 lost** (2 restored) |
| Tovu node tests, 47 changed website test files | — | 380 tests: 364 pass, 16 fail. All 16 are pre-existing or not ours: `typed-tools.integration` ×11 (catalog-auth fixture `ToolCatalogHttpDeps`, TS2322 since `884df9707`); `publish-agent-tools.unit` (missing `publish-credentials/repo.memory.js`, TS2307 in baseline); `process-root-parity` "dev mode bypass" (red on merge-21, checked); `wiring-identity` row 7 (`agent-plugin-bootstrap.ts`, untouched); `tool-contribution-registry` (extra `agent-pause` from merge-21); `assistant-byok.inputs-pin` (`appendAutomaticPluginGuidance` unchanged; `.start` of an injected port). These were not re-run on a merge-21 Jini build (a fair baseline needs one); the classification comes from the unchanged code. |
| Tovu admin reader tests | — | **52/52** |
| Jini `pnpm typecheck` (strict, all packages) | 0 | **0** |
| Jini `pnpm guard` | 1 (HW3 admin `shell-failure-log.ts`) | **1, the same row** (R14 cycle + 2 SI-domain rows introduced and then fixed) |
| Jini `api:check` / `api:update` | — | core, daemon, http-kit, server, sidecar baselines updated. Pre-existing admin/user-management drift left alone. |
| Jini changesets | — | `core-error-reporter-contract` (J1, major), `core-error-report-exact-secrets` (minor), `core-route-operation` (minor), `http-kit-route-reporter` (minor), `server-route-reporter` (minor), `sidecar-ipc-reporter` (minor), `daemon-route-tool-reporter` (major), `admin-failure-reference-fallthrough` (patch) |
| Jini `check:hooks` | 0 | **0** |
| Jini why-comments (`--base merge-21`; the default base `origin/refactor/terra` is missing in the clone) | — | **ok, 0 lost** (18 restored) |
| Jini `check:complexity` / `check:size` | red (pre-existing rows in cms/ui/chat/agent-plugins/daemon launch.ts/server builtin-features.ts) | Still red on the **same untouched files**. No row names a file in our diff. 3 stale json-ipc size rows removed. |
| Jini `check:log-safety` | red (64 rows) | **+1 row:** `[raw-error] sidecar/src/json-ipc.ts` (the legacy incident write moved onto `ports.logger`). Not fixed. |
| Jini `check:errors` (WARN mode, exit 0) | 88 rows | **+6 rows of `catch-reads-error`**, in core json-route (1), daemon tool-recovery/observability (1), http-kit adapter (1), raw-route (1), node-bridge (6→7) and sidecar json-ipc (2). These are bare `catch {}` blocks that keep a broken sink (reporter, describer, logger) from replacing the original failure. Making them honest needs a design call on where a broken sink's own error goes; `void error` would be a cheat. Left for Opus review. |
| Jini vitest | — | core errors+contracts **550/550**; server **507/507** (+1 skip); sidecar **454/454** (+3 skip); admin reporter **8/8**; http-kit 857/859 (2 in `http-error-log-redaction`, which scans untouched `server/src/shutdown` and `mcp/federation` files); daemon http+tool-recovery 2373/2388 (15 in `uploads.characterization` + `paths-queries-state`, untouched files, the same count before and after the J4 route half) |

## UNVERIFIABLE-IN-CLOUD
- The Chrome admin 500 ID correlation (the T2 activation precondition), which needs a real browser session against a running site.
- The Electron handler-failure check for IPC reporter mode. It stays owed until a host adopts J5.
- Real provider delivery (Sentry/OTel) of the redacted clean Error view. The canaries use the real Jini tracker with a recording provider.
- The desktop binding of `versions.app` from the running Electron app.

## New bugs
1. **Fixed:** Jini admin `failureReference` (`admin-failure-reporter.ts:172`). A non-string `details.errorId` won the `??` chain, was then dropped, and hid the flat ID and the request ID.
2. **Open:** PII redaction rewrites an all-digit ERR ID to `ERR-[REDACTED:credit_card]`. Examples are `ERR-0000-0000-0000-0042` and core's `UNAVAILABLE_ERROR_ID`. Tovu admin-failure now pins the recorded ID back into the reply and Copy details, but other formatters (for example the Jini admin reader path) are still affected. Random hex IDs hit this with probability about (10/16)^16.
3. **Open:** the Tovu provider adapter sends a fresh clean Error, so the diagnostics tracker's object-identity dedupe can no longer recognise a repeat of the same original error. The ownership is now decided at the admin-failure/request-scope level, which T5 should prove.
4. **Open, design note:** the J4 route reuses a trusted stamped ID without writing. The old BRIDGE pin, which asserted an http-kit console line, was migrated to assert the reporter's single host record.
