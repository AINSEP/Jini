PARTIAL ed93cad0e c157d4410: left = T3b admin JSON seam (mountAdminJsonRoute, ~300 mounts in 53 files) + capped content (posts.ts) + admin/public raw seams + public JSON seam; J3a/J3b stay on HOLD (T3b exit gate not cleared)

# feat-p4 (2026-11-25, continuation run 2): P4 Errors on `integ/feat-p4-2026-11-25`

This was an unattended cloud continuation. Opus coordinated, and the run was test-first throughout.

**Setup**
- I read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) first. Every brief carried its rules:
  - root cause first;
  - a failing test first, plus a named mutation;
  - inject everything;
  - fn ≤ 80 lines, complexity ≤ 10;
  - why-comments move with the code;
  - no re-export shells, no `--no-verify`.
- Node 24.22.3.
- Jini: `pnpm install --frozen-lockfile && pnpm -r build`.
- Tovu: `npm ci --ignore-scripts` in root, admin, desktop and site-chat, then `link:jini`, `prepare-desktop-hooks`, and builds of contracts and sdk.

**Starting points**
- Tovu `67858e8cd` / Jini `05082dfae`, the tips of the previous PARTIAL run.
- Jini `95fd63c10` was the previous run's untested "gate-fixer snapshot". It is now covered: root typecheck 0, build 0, daemon tests below.

**Subagents**
- 4 dispatches, never more than 2 at once (the last worker stopped at its 50-call cap before the public JSON seam):
  - Sonnet: the 31-file fixture migration.
  - Opus high: J4 item 3, the small mount seams, and the widgets / dev-auth / public-JSON seams.
- 2 workers went over the 120k context cap: the Sonnet migration (174k / 72 calls) and the J4 worker (180k / 50 calls).

**Rules held**
- No force-push, no `--no-verify`, hooks untouched.
- No codebase-memory tools.
- `main`, `plan/*`, `release/*`, `codex/*` and `integ/merge-*` untouched.
- No tag, no publish.

**Gate 0:** my first desktop `npm run gates` ran while my edits were already in the tree, so it does not count as a baseline: it went red on my own `desktop-agent.ts` break (`daemonRouteHost` now requires `errors`), which I then fixed. Every later desktop gate run passed 6/6 (pre-push on `bf7e2dd89`, and the final run on `597d0a706`). I confirmed the "pre-existing" classification of every red test by running the same tests on a worktree at `67858e8cd`.

## Pushed commits

Tovu, `integ/feat-p4-2026-11-25`:
- `263dfe097`: `daemonRouteHost` requires the owning reporter. Surface and tool-RPC hosts bind it. Adds the shared fixture `server/__tests__/helpers/route-incident-reporter.ts`.
- `bf7e2dd89`: every `daemonRouteHost` caller binds its owner's reporter: BYOK tool-RPC, the visitor site-assistant frontend and the desktop agent bridge.
- `818f33566`: the 31 legacy route-sink consumers moved to the shared fixture.
- `bc5bd5abb`: 4 why-comments restored.
- `597d0a706`: Forms submissions-pull mount in reporter mode.
- `c04915908`: Widgets mount in reporter mode.
- `ed93cad0e`: direct dev-auth mount (all 7 owner-auth registrations) in reporter mode.
- This report: see the branch tip.

Jini, `integ/feat-p4-2026-11-25`:
- `c452c0c6c`: J4 item 3. The retired `onInternalError` option is removed from the 14 daemon HTTP route files.
- `c157d4410`: daemon API baseline, plus a why-comment allow-list for the deleted field docs.
- This report copy: the branch tip after `c157d4410`.

## Sheets

| sheet | status | evidence |
|---|---|---|
| P4-T3b fixture migration (31 files) | **DONE** | Every `reportRouteInternalError` import and `onInternalError` key is gone from Tovu: `grep -rln "reportRouteInternalError\|onInternalError" apps --include=*.ts` returns **no match**. Each test binds `createRouteIncidentReporter()`. A failure that crosses executor, disclosure and route reuses one reporter, so it keeps one ID. Replaced assertions are equal or stronger: one host record, ERR- id equals `requestId`, the message ends `(error <id>)`, no secret in the host record, and UUID checks became exact ERR- checks. Test count 280 → 280. 30 of the 31 files are green; `typed-tools.integration` has the same 11 red before and after (catalog-auth fixture TS2322). |
| P4-T3b production binding (`jini-routes.ts:11,192–199`) | **DONE** | `daemonRouteHost({ context, parserLimitBytes, errors })`: `errors` is now **required**, the legacy `reportRouteInternalError` import is gone, and binding is unconditional. Every caller now binds its owner's reporter:<br>• daemon scope (scope reporter, also shared by the surface routes);<br>• tool RPC (`registerAssistantToolExecRoutes({ reporter })` from BYOK);<br>• visitor site-assistant frontend (`createSiteAssistantModule({ deps, reporter })` from createApp through `mountAdminSystem`);<br>• desktop agent bridge (its own reporter at its composition root; no tracker by design).<br>`jini-routes.unit` 14/14. **M** restore-legacy-sink-binding → 2 red. |
| P4-T3b mount seam: Forms | **DONE** | createApp → `mountAdminFeatures({ reporter })` → `createFormsAdminModule({ deps, errors })` → pull registrar → `adapter { fail-closed originPolicy, errors }`. New test `forms submissions pull: mounted in reporter mode, a failed answer write is one site incident whose ID the 500 carries`: red (0 records), then green. **M** drop-errors-from-adapter → red. |
| P4-T3b mount seam: Widgets | **DONE** | Tovu `c04915908`. `createWidgetsModule({ deps, errors })` → 13 registrars → `mountWidgetJsonRoute({ ..., errors })` → adapter. Test `widgets list: mounted in reporter mode, a failed answer write is one site incident whose ID the 500 carries`: 13/14, then 14/14. **M** drop-errors → red. 118 → 119 tests; the same 8 pre-existing reds before and after. |
| P4-T3b mount seam: direct dev auth | **DONE** | Tovu `ed93cad0e`. createApp → `mountCoreContent({ reporter })` → `createCoreModule({ deps, errors })` → `registerAuthRoutes({ app, deps, errors })` → `mountOwnerAuthRoutes`. All 7 `mountJsonRoute` calls (password, MFA, logout, boot session, local boot session, current user, password status) get a fail-closed adapter with `errors`; no user-management spec sets `requireSameOrigin`. 140 test call sites in 110 files pass the fixture's `errors`. Test `owner auth logout: mounted in reporter mode, a failed answer write is one site incident whose ID the 500 carries`: 7/8, then 8/8. **M** drop-errors → red. 1276 → 1277 tests, with the same 19 reds before and after: the known list plus trash list ×4, AG-UI error frame ×2, newsletter CONFIRM/UNSUBSCRIBE, redirects body-less create, real-HTTP TOTP/passkey and BYOK preflight. All of these were red on the pre-seam commit. |
| P4-T3b mount seams: public JSON, admin/public raw, admin JSON, capped content | **LEFT** | See the exact paths below. |
| P4-J3a / P4-J3b | **HOLD** | The T3b exit gate is not cleared: not all seams carry `errors` (above). Lifting the hold now would break every un-bound Tovu mount at startup. |
| P4-T5 ownership proof | **DONE** (verified) | Built in the previous run as Tovu `671bbb025`. That report's "NOT BUILT" line was stale. The 3 sheet tests (`a public route failure is reported once`, `an unreported 5xx still produces the http.request marker`, `browser telemetry still reaches the tracker`) are present. `observability-error-report` + `browser-telemetry` pass 26/26. **M** `console.error` beside `reporter.record` → 2 red, re-run here. The commit is test-only. |
| P4-J4 item 3 (retired `onInternalError`) | **DONE** | Jini `c452c0c6c`. The option is gone from the deps and second arguments of all 14 files: attachment-lookup, attachments, connectors, db-ops, delegated-tools, media, memory, model-proxy, remote-run-events, research, runs, terminals, tool-execution-routes and xai. model-proxy's catch-all reports an unknown provider through `host.reportInternalError`. Untouched: run-lifecycle, event-cleanup, federated-refusal, and core/http-kit (J3a/J3b's). `git grep -c onInternalError -- packages/daemon/src/http ':!**/__tests__/**'` finds 0. New `route-incident-reporter.test`: 3 red, then green. **M** restore deps.onInternalError forwarding in runs.ts → red. http + tool-recovery tests 2388 → 2391, with the same 15 known failures (`uploads.characterization`, `paths-queries-state`). Two mcp fixtures drop a do-nothing `onInternalError` key; mcp tests 98/98. Changeset `daemon-route-tool-reporter` (major) extended, and the daemon API baseline updated. |
| P4-T2 other host edges | **partly** | The desktop HTTP binding is done; see the desktop agent bridge above. Still open: INFO.md Wiring, manifest/lockfile ranges, and the Chrome admin 500 check. |

### What T3b still needs (exact paths)
- **Admin JSON + capped content.** `mountAdminJsonRoute` has about 300 calls in 53 files, and none of them receives the site reporter at registration today. The reporter reaches admin routes only per request, through `res.locals.failureReporter`. This needs a design decision, either:
  - (A) put the site's `routeErrors` on `RouteDeps`, built at each composition root, and add it to `AdminJsonRoutePortDeps`, where about 200 `authorize: deps.authorize` builders would gain one field; or
  - (B) thread `errors` createApp → `mount*` → module factories → registrars, as Forms now does.

  Either way, http-kit's `adapter` type requires an `originPolicy`. Admin mounts have none, so they need the fail-closed policy the Forms seam uses, or a core type that allows `errors` without an origin.
- **Raw mounts.** `mountAdminRawRoute`/`mountPublicRawRoute` have 8 production callers in 8 files (seo-documents, agent-plugin-install ×2, agent-plugin-surface-files, public-members, publish-content-blobs, site-previews, system-site-backups ×2, system-site-shares). None has a reporter. The work: add `errors` to both mounts' required object and merge it in `adapterFor`, keeping the missing-origin startup throw and the raw failure writer. Then thread the reporter through the seo, sites and publish-content modules and `mount-public-site`.
- **Public JSON.** `mountPublicJsonRoute` gains a required `errors`. Thread it through:
  - modules/core.ts: health and healthz, today `NoDepsRouteRegistrar`;
  - publish-trust.ts;
  - public-members.ts and members.ts (`createMembersModule`);
  - `mount-members-newsletter.ts`, which needs `reporter` from createApp;
  - `mount-core-content.ts`, which already has it.

  About 7 test files need updating. Write the reporter-mode test first: health, with the first `res.json` refused.

## Gates

| gate | result |
|---|---|
| Tovu desktop `npm run gates` | **6/6 PASS**: pre-push on `bf7e2dd89`, and the final run on `597d0a706`. The widgets and dev-auth commits touch no desktop file. |
| Tovu root `tsc -p tsconfig.json` | **0** (re-run on `ed93cad0e`) |
| Tovu desktop `tsc` | **0** |
| Tovu admin `tsc` | **0** |
| Tovu `check:hooks` | **0** |
| Tovu `check:boundaries` | **0 errors** (143 warnings) |
| Tovu why-comments (`--base 67858e8cd --other-root Jini`) | **ok**, 0 lost. The 4 moved comments were restored. |
| Tovu node tests, all 87 changed test files (704 tests) | 690 pass, 14 fail. All 14 also fail on `67858e8cd`:<br>• typed-tools.integration ×11 (catalog-auth fixture);<br>• the `mcp-ui-tool-calls-route.visitor-isolation` AST pin;<br>• site-chat golden `page.navigate`;<br>• route-modules "module 'members'" (TypeError at public-members.ts:190).<br>Also red at `67858e8cd`, so not counted against this run: createApp route-table pins, 7 of 18. |
| Jini `pnpm -r build` | **0** |
| Jini `pnpm typecheck` (strict, all packages) | **0** |
| Jini `api:check` | **0**. The daemon baseline is updated. Admin/user-management drift is pre-existing and left alone. |
| Jini changeset | `daemon-route-tool-reporter` (major), extended with item 3 |
| Jini `pnpm guard` | 1 violation, the same pre-existing HW3 `admin/src/shell/lib/shell-failure-log.ts` row |
| Jini `check:hooks` | **0** |
| Jini why-comments (`--base 05082dfae`) | **ok**. 16 blocks were JSDoc of the deleted fields, or test notes about them. Each is allow-listed with its reason in `scripts/why-comments-debt.json`. |
| Jini vitest | core errors + contracts **550/550**. http-kit 857/859; the 2 failures are pre-existing in `http-error-log-redaction` (scans untouched server/mcp files). daemon http + tool-recovery 2376/2391; the 15 failures are pre-existing. mcp 98/98. |

## UNVERIFIABLE-IN-CLOUD
- The Chrome admin 500 ID correlation (T2 activation precondition) against a running site.
- The desktop agent bridge's reporter in the packaged Electron app. `processBuildConstants()` reads manifests at startup, and the packaged paths are unverified.
- The Electron handler-failure check for IPC reporter mode. It is still owed until a host adopts J5.
- Real provider delivery (Sentry/OTel) of the redacted Error view.

## New bugs / notes
1. **Fixed here:** my own first sweep script skipped the fixture import in 36 test files, which gave a ReferenceError. I caught it in the first test run and fixed it in `bf7e2dd89`, so no red was ever pushed past that commit's own pre-push gate.
2. **Note:** `agent-daemon-server.tool-family.integration` was red at `67858e8cd` with a ReferenceError: its eval scope lacked `reporter` and `logger`. It is fixed in `818f33566`, test-only.
3. **Open (carried):** PII redaction turns all-digit ERR IDs into `ERR-[REDACTED:credit_card]`. The new fixture uses `ERR-7E57-…` IDs, so tests cannot hit it, but production random IDs still can.
4. **Open (carried):** the visitor-isolation AST pin looks for `confirmations` inside `createSiteAssistantModule`'s body, but it lives in `createSiteAssistantContext`. The test is stale, not the code.
5. **Design note:** the desktop agent reporter has no tracker by design (a local app). The host console record is an incident's only copy.
