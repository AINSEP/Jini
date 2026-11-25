PARTIAL fa958cb01 a6195a636 | FILES LEFT 1060 (excl. themes) / 527 | new red 0 (in everything run) | left: node sweep ran 656 of 1392 files (all 578 test files changed since merge-22; 736 importer-only files unrun); FIX 4 step 3 (reporter required + legacy sink deleted) not landed; FIX 19 publish-content run-actor refusal backed out + restore-ledger actor_kind blocked (journal DB is outside ADR-066); UI bugs a–d fixed in code, none checked in a browser; bug c real-site cause still the held-copy hypothesis

> Code tips tested by the final gates: Tovu `fa958cb01`, Jini `a6195a636`. This report's commit is on top of them. Wall clock 17:25 → 19:50 UTC.

# combine-23 continuation #2 (2026-11-25): gate compare + fix on `integ/merge-23-2026-11-25`

Unattended cloud run. Opus coordinated; every worker was Opus-high (fixes touched security parity, actors, migrations and error redaction), plus one Sonnet-high worker for the FILES LEFT script. At most 4 workers ran at once.

**Programmer skill confirmed.** I read `AI-Dev-Shop/agents/programmer/skills.md` (Programmer v1.7.5) first. Every worker brief carried its rules: root cause first, failing test first plus a named mutation, never weaken a test, inject everything, hooks as required props, fn ≤ 80, complexity ≤ 10, no re-export shells, Jini neutral, themes untouched, features dark, never `--no-verify`.

**Setup:** Node 24.22.3. Two separate trees: merge-23 in `/home/user/{Jini,Tovu}`, and a read-only merge-22 clone (Jini `311494d55`, Tovu `d4a934da8`) in `/home/user/m22`. Both had a Jini `pnpm install --frozen-lockfile` + full build, Tovu `npm ci --ignore-scripts` in root/admin/desktop/site-chat, `link:jini`, and the contracts/sdk build.

**Rules held:** no force-push, no `--no-verify`, hooks untouched, no tag/publish, no codebase-memory tools, no RemoteTrigger. Only `integ/merge-23-2026-11-25` was written; merge-22 was read only. Every Tovu push passed the pre-push desktop gates. No merge item was reverted: every NEW red was fixed at the root.

## 1. Reds from combine-23, compared with merge-22

| test | class | result |
|---|---|---|
| Tovu admin vitest, 8 files (merge-23 17 red; merge-22 1 red) | 16 NEW, 1 PRE-EXISTING | **all fixed.** panel-access "storage declares only ids its server route checks" was a **real security-parity bug**: the P11 Storage panel declared `system.read`, but the route checks `storage.manage`, so non-owners saw a nav row that always 403s. Fixed in `a3aa18103`, mutation 1 red. Panel tables (51→52, verified row by row against the route), the admin-screens manifest (drift was the routines `conversation` deep link), request shapes (`listMediaGrid`, `getMediaProviderCatalog`), and request-volume (paged grid + catalog): `a3aa18103`, `ea1bdcc30`, `404c3c9bf`. Grok label: the Security row read the static catalog after grok moved into the xai plugin. It now reads the live catalog: `debb7e598` / Jini `cd0bace2b`, M `label-static-catalog` 1. app-sites "…tab=import" ×2: `7eb06dc4c` crashed the whole admin on an imports page with no `imports` array. Now refused in the port: `debb7e598`, M `imports-page-unvalidated` 2. The PRE-EXISTING "opens on Export" test passes now. Final 8-file run: see Gates. |
| Jini why-comments, 2 blocks | NEW (vs merge-22) | **fixed.** Both comments described the old update-html ladder that f221e8c34 deliberately changed (409 entity-not-live). Recorded with reasons: `23f137f2c`. Two more appeared from this run's source-control fix and were recorded the same way: `be24f1189`. |
| Jini commerce vitest | not reproduced | 11/11 green on both trees. Last run's exit 1 was transient. |
| Jini daemon characterization (merge-23: 22 fail + 252 skipped; merge-22: 15 fail) | NEW + 15 PRE-EXISTING | **all fixed, 294/294.** NEW: the harness never injected the K06 model-proxy registrations (`0b709fe09`, M `drop-proxy-providers` 22+252 skipped); two GET pins expected write copy (`0141af63f`). PRE-EXISTING: uploads 14 + paths 1 lacked the optional `maxAttachmentBytesFor` declaration (`96d4bf4d5`, M `per-name-limit-undeclared` 15). |
| Jini provider-plugins artifact.integration (merge-23: 12 fail; merge-22: 19/19) | NEW | **fixed, 21/21** (`2e6179f32`). Decision: keep the `@jini-ai/core`/`protocol` peers (the tsc-emitted host subpaths really import them). Bundled payloads stay dependency-free, now proven by a check that neither peer resolves while each payload loads. The `model-proxy-*` sources are host libraries, not plugins, and are pinned as dist subpaths. M `peer-dropped+host-library-unpublished` 12. |
| Tovu node tests | see the node table below | every NEW red fixed; the rest are PRE-EXISTING, postgres-only, or HELD |

### Node-test sweep (per file, concurrency 3; each file ≤ 300 s)

- The 40-minute shard approach timed out under load, so I re-ran per file.
- I ran **656 of 1392** test files: every one of the **578 test files changed since merge-22**, plus 78 importer-only files.
- **736 importer-only files were not run** (cap). They are listed in the run's scratch `unrun.txt`; the next run should start with them.
- Every red was re-run on merge-22. Every file ever red was re-run once more on the final tip (`fa958cb01`).

| file (apps/website/src unless noted) | class | result |
|---|---|---|
| assistant/site/visitor-frontend-control.unit (504) | NEW | fixed `f3fa1609f`: the fixture lacked the P4 `errors` binding |
| assistant/mcp-ui-tool-calls-route.delete-confirmation-family (2) | NEW | fixed `f3fa1609f` (typed actor) |
| features/post/publish-content (12), widgets embed-service (20) + post-host (1), trash/widget-trash-flow (11), taxonomy/publish-content (1), server/admin-widgets-routes (4), publish-content/* fixtures | NEW (FIX 19 typed actor) | fixed `f3fa1609f`, `26122df33`, `c821bb16d` (M `hardcode-user-kind` 1), `08922d940`, `5277fc9c2`, `e51dcf470`. Production paths checked: all pass a typed actor. |
| features/media-import/import-local-file, media/provider-credential-store, cli/serve-command-wiring (+1 vs merge-22) | NEW | fixed `f3fa1609f` (b-g5b `description` input; `grok` canonical sort; routines worker in the stop order) |
| site-backup/share-expiry, share-retention (new files) | NEW | fixed `a972bca3e` |
| platform/db/migrations/chat-pinned-step, sqlite/chat-db.integration | NEW | fixed `ce0859554`, `61fe8a430` (B140 0049 in the ordered history) |
| assistant/moved-tools.golden | NEW | fixed `460fc64a4`: the 2 extra tools are the p11 `site_storage_report`/`site_storage_cleanup`, intended and not dark |
| server/assistant-chats-routes (6) | NEW | fixed `27b0ad2ec` (P11 same-origin writes) |
| server/admin-media-provider-routes (7), routes/media/provider-catalog (1) | NEW | fixed `ec0cb6a2b`, `16394aa8b` (ETag If-Match; grok canonical id) |
| server/b07-admin-read-gaps | NEW | fixed `cef92fa81` (P10-S2.J `version`) |
| site-shares.integration + .wire (1 new) | NEW | fixed `f81b1839a` (`expiryChoices`) |
| site-assistant-error-report, site-chat-stream.ag-ui.golden, site-assistant-ag-ui-resume | NEW | fixed `c37702a26` (P4 `{deps, reporter}` module shape) |
| trash request-contracts (2), admin-trash-routes (+1) | NEW | fixed `c37702a26` (`retentionDays`) |
| assistant/tool-metadata-projections (2) | NEW | fixed `fa958cb01` (routine tools + host-named site_guide keyword) |
| features/media-generation/providers-tools | transient | its real-clock `idleTtlMs: 5` is flaky under load; also flaky on merge-22. Green on the final re-run. |
| bundled-tovu-theme-package (6), theme/tovu-theme-theme-toggle-storage-key (2), tovu-starter-theme-toggle-storage-key (2) | **HELD** | theme deltas held (FIX 12/15); not touched |
| copy-engine.postgres (14), runner.postgres (4), revision-thinning.postgres (2), unreadable-owner-entries-repair.postgres (2) | PRE-EXISTING / environmental | need a live Postgres server |
| site-chat site-assistant-transport | PRE-EXISTING (environmental) | React 19.2.8 vs react-dom 19.2.7 copies mixed through the Jini symlinks; red on merge-22 too |
| byok-google-catalog 1, automatic-agent-plugins 2, domain-no-direct-tool-registration 2, mcp-ui visitor-isolation 1, publish-run 1, import-restore 1, members-public-complete-sign-in 1, redirects-create 1, site-chat-stream.golden 1, owner-passkey-http 1, process-root-parity 1, route-modules 1, agent-daemon-server.typed-tools 11, media repo.contract 12, composition-boot-order 2, serve-command-wiring 2, member-adapter 3, admin-trash-routes 4, tool-registrations.media 2 | PRE-EXISTING (same counts on merge-22) | **left:** none fit the 30-min "small" bar in this run's remaining time after the NEW reds |

## 2–4. Fix items

| item | status | commits (Tovu / Jini) | test → mutation |
|---|---|---|---|
| **FIX 4** 7 legacy-sink callers | **DONE** | `416971ae7` | Probe grew 12→19. Required `BoundFailurePorts`; redacted view only. M `fix4-remaining-unbind` 1. |
| FIX 4 more unbound callers found | **DONE** | `5abad11e4`, `b1dbd2f6f`, `f621ad3d8` | Three more production paths were still on the legacy sink: routines store-open, the daemon tool-access lowering route, and **every JSON-route site-share failure** (the stand-in `res` had no reporter). M `routines-store-open-unbound` 1, M `tool-access-lowering-unbound` 2, M `share-standin-unbound` 10. |
| FIX 4 step 3 (reporter required, `reportToLegacySinks` deleted) | **LEFT** | `24cfd15d9` (design in open-bugs) | Built and typechecked, then reverted, because 6 test files still need migrating (unexpected-route-errors 5, observability-error-report 2, import-errors 2, user-facing-failure 1, site-share-failures 1 hunk). Design: `failureReporterOf({res})` returns a throwing unbound reporter, never the console. |
| **FIX 19 / H2** actor required at the general write seam | **DONE** | `724ddc31a` / `546c53f24`, `d252dc62b`, `6390c018e`, `a6195a636` | `ActorIdentityInput.actor` and `WidgetWriteActor.kind` are required. Runtime `requiredMutationActor` throws `MissingMutationActorError` in all 5 entry writers. Import/publish/unpublish events now carry the actor. Census: Jini 87→130→0, Tovu 3→0. M `actor-optional-at-seam` 2 red of 82. My own final gates found 2 more call sites the change broke: user-management tests (Jini build red) and `examples/notes-app` (strict typecheck red). Both fixed. |
| FIX 19 publish-content run-actor refusal (no `{kind:"user"}` fallback) | **LEFT (backed out)** | Jini `e00cb9427`/`2df333941` landed, then reverted (`cb3967f4f`, `ab4e873e6`) | It works, and M `fallback-to-user` gives 2 red. But about 84 more Tovu fixture tests in 12 media/post publish-content files drive handlers without `mutationActor`. Re-land = `git revert ab4e873e6` plus those fixtures (list in open-bugs). |
| FIX 19 restore ledger `actor_kind` | **BLOCKED** (owner decision) | `f5f9d2492` | `database_ledger` lives in `ops/database-journal.db` (Jini `journal-schema.ts`, `CREATE TABLE IF NOT EXISTS`, no versioned steps), not content.db, so an ADR-066 migration cannot reach it. The kind is already recorded in `detail_json.actor.kind`. Needs a decision on journal-schema versioning. |

## 5. Real-app UI bugs (from the local UI check of Tovu `c0f1068a59`)

| bug | status | root cause | commits | test → mutation |
|---|---|---|---|---|
| **a** Storage: GET /report 404, no title, bare headings, "check whether your change was saved" | **DONE** (not checked in a browser) | The client put `basePath` at the wrong level, so it called `/api/admin/v1/report`. A hand-written type plus a cast hid this; it is now `typeof request`, so tsc catches it. The route was mounted; the server is not at fault. The read-failure copy was method-blind in the client and in 3 server places. GET/HEAD now say "Nothing was changed" and show the error ID (`x-request-id`). Title is `.jini-page-title`; sections are `.jini-card`/`.jini-card-title`. | `dbb9fa5d5`, `414b18ec8`, `ff7038294` / `e04253142`, `3e9100277`, `93ecbdf43` | M `storage-basepath-top-level` 1, `read-failure-says-saved` 1, `headers-not-passed` 1, `storage-no-title` 1, `panel-bare-headings` 1, `server-read-says-saved` 4+1 |
| **b** 'Clean up chats' opens nothing | **DONE** (not checked in a browser) | The dock passed ui-kit `Button` (it takes `onPress`, and its `onClick` only calls `onPress`), so the panel's `onClick` and `aria-expanded` were dropped. Tests used a plain `"button"`. An adapter kit fixes it; the new test mounts the real hook. | `6ca31b322` | M `kit-drops-press` 2 |
| **c** Source Control Providers empty with no reason | **PARTIAL** | Fixed: the route dropped `registry.refusals`, the hook swallowed request failures, and `switchedOff` was never rendered. The page now lists each refusal or switched-off plugin with "Reinstall or turn on the plugin in Agent Plugins." (combine-23 new bug 6). Not fixed: no other code-level cause found (contribution key, enabled id and response field all checked), so the real site is most likely still the held pre-rename `tovu/github` copy. The page will now say so. | `5e92394b5` / `9cac715ed` | M `refusals-dropped` 1, `notice-withheld` 3 |
| **d** Trash header never states 30 days; old rows show 44 days | **DONE** (not checked in a browser) | `trash_item` tool text said 60 days; retention is 30. The header now reads "Items are permanently deleted {days} days after they are moved to Trash. Each item shows how many days it has left." The value comes from the injected `TRASH_RETENTION_DAYS` through a required `retentionDays` on the list DTO. The InfoTip now describes Trash. 20 non-English locales were machine-written; a native speaker should check them. **Decision on old rows:** they keep their stamped `purgeAfter` (`computePurgeAfter` stamps at trash time and the sweeper claims by stamp), so "44 days" is correct for rows trashed under the 60-day rule, and it is pinned. | `dbb9fa5d5`, `025b0f4f0`, `de82d1bff`, `496c7e9ee`, `7d3818f84` / `c4f657e2b`, `7727d518c` | M `tool-text-60-day` 1, `sweep-clamps-by-window` 1, `header-omits-window` 2+1 |

## 7. Gates (final; Jini built once at 19:10 and not rebuilt during the test runs)

**Jini (`a6195a636`)**
- build: **0** (the first attempt was red on FIX 19 test fixtures in user-management; fixed `6390c018e`).
- typecheck (strict): **0**. The first strict run was red on `examples/notes-app` (FIX 19 fallout); fixed `a6195a636`.
- guard: 0. api:check: 0. changeset status: 0. hooks: 0. complexity: 0.
- why-comments `--base 311494d55`: **ok** (merge-23 start: 2 blocks).
- vitest, test files changed in this run plus the 3 previously red packages: all green. admin 40, cms 152, commerce 11, core 8, daemon 84 (the full characterization run is 294/294), http-kit 17, provider-plugins 21, user-management 4.

**Tovu (`fa958cb01`)**
- typecheck incl. e2e: 0. admin tsc: 0. hooks: ok. boundaries: 0. why-comments `--base d4a934da86 --other-root ../Jini`: ok.
- architecture: OK. The runtime propagation-cost warning is still 3.06→3.48 (non-blocking, the same as merge-23 start).
- admin vitest (109 admin test files changed since merge-22 + the 8 previously red; `--maxWorkers=2`): **2636 pass / 0 fail** (112 files; 2 skipped, 2 todo).
- node tests: the sweep above, plus a final re-run of every file ever red: 0 NEW red. Remaining: 19 PRE-EXISTING files, 4 postgres-only files, 3 HELD theme files.
- desktop gates (`apps/desktop npm run gates`): **6/6 PASS**.

vs merge-22: the 8 admin files went from 1 red (merge-22) and 17 red (merge-23 start) to 0; daemon characterization from 15 red to 0; provider-plugins stays green; Jini why-comments from 2 to 0.

## 6. HELD (owner decision pending, untouched)

- The 6 tovu-theme 1.1.4 tests: "Tovuize asks exactly one…", "Tovuize reuses local Media…", "draft homepage is previewed…", "survey comes before the single choice card", "tovu-theme packages … 1.1.4", "writes carry expectedVersion…". The `bundled-tovu-theme-package.unit` file has 6 red.
- New this run, same cause (the theme-toggle delta held by FIX 15): `theme/tovu-theme-theme-toggle-storage-key.test.ts` (2) and `theme/tovu-starter-theme-toggle-storage-key.test.ts` (2). Both files are new in merge-23 and pin the held storage-key change.

## UNVERIFIABLE IN CLOUD (owner must check)

- UI bugs a–d in the real admin: the Storage page loads and has a title; Clean up chats opens; the Providers tab shows the refusal reason; the Trash header shows 30 days.
- Bug c on the real site: the Providers tab should now name the held `tovu/github` copy. Reinstall github from Agent Plugins.
- Postgres-only tests.
- The 20 machine-translated Trash strings.

## New bugs (found this run)

1. **FIXED:** the Storage panel was gated on `system.read`, but its route checks `storage.manage` (`a3aa18103`).
2. **FIXED:** JSON-route site-share failures, the routines store-open failure and the daemon tool-access lowering failure were still on the legacy console sink (`f621ad3d8`, `5abad11e4`, `b1dbd2f6f`).
3. **FIXED:** the admin crashed to a blank `<div/>` when the imports list response had no `imports` array (`debb7e598`).
4. **FIXED:** GET/HEAD failures told the owner to "check whether your change was saved" (client + Jini core/http-kit).
5. **OPEN:** on SIGTERM/SIGINT the `routines` worker is not stopped (`serve-listen.ts` `stopServingWithinGrace` omits it; only `releaseServeOwnership` stops it). From f9c133020. Pinned by the serve-command-wiring signal-path assertions.
6. **OPEN:** `providers-tools` L241 uses the real clock with `idleTtlMs: 5`, so it flakes under load (both trees). It should use a mock clock.
7. **OPEN:** `ProvidersTab` still has optional hook props with internal defaults (pre-existing; violates the required-hooks rule).
8. **OPEN:** check:hooks reports the debt baseline shrank by 27 entries; it can be locked with `--update` (owner's call).
9. **OPEN:** `tsc -p tsconfig.tests.json` is not part of `npm run typecheck`, so test files with stale signatures (the old `createSiteAssistantModule(deps, opts)`) pass typecheck and fail only at runtime.
10. **OPEN:** `typecheck:tests` OOMs at 6 GB on this host.

## FILES LEFT (excl. themes; planner / true)

**1060 / 527** at Tovu `fa958cb01`. That is +1/+1 vs `bf1519bba7` (1059 / 526), all in adm-shell-components (`apps/admin/src/components/AssistantDock/chat-cleanup-kit.tsx`, the bug b adapter).

Method: `combine-18-plan.mjs` + `plans/P9-data/tools/scan.mjs` + the KEEP_RULES parsed from `plans/count-1124/*.md` (507 anchored rules). It reproduces 1059 / 526 at `bf1519bba7` and 1040 / 507 at `abd42dae5b` exactly.

| area | true | planner |
|---|---:|---:|
| adm-other | 73 | 173 |
| public-http | 47 | 86 |
| adm-shell-components | 33 | 50 |
| admin-http | 30 | 65 |
| agent-plugins | 28 | 44 |
| site-backup | 28 | 36 |
| post | 23 | 30 |
| deployments | 23 | 28 |
| adm-posts | 15 | 38 |
| adm-security | 15 | 23 |
| adm-deployment | 14 | 23 |
| publish-content | 13 | 15 |
| media | 12 | 15 |
| contracts-core | 11 | 33 |
| adm-shell-lib | 9 | 36 |
| trash | 9 | 14 |
| adm-pages | 8 | 22 |
| custom-credentials | 8 | 14 |
| project-keys | 8 | 8 |
| external-mcp | 7 | 11 |
| pages | 7 | 11 |
| identity | 6 | 13 |
| adm-publish-content | 6 | 11 |
| site-export | 6 | 10 |
| others (58 areas) | 88 | 251 |
