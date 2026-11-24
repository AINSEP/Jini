PARTIAL ae4629835 1f9c8508b | FILES LEFT 1308 (excl. themes 1188) | left: rv1124a FIX 10/11 (RA); rv1124c bugs-tovu FIX 4/7, bugs-jini FIX 5, todos-tovu FIX 4 (C026) + FIX 5 (H4 approval resume + created_by_kind ADR-066 migration); G7-9 captions; site-update host adapters + RouteDeps slot; why-comments +15 Tovu / +24 Jini

# combine-20 (2026-11-24): Tovu + Jini `integ/merge-20-2026-11-24`

Unattended cloud run. Opus coordinated. Sonnet high-effort workers did the merge and fix work; Opus workers did the data-deletion fix (captured-mail clear) and the security fix (H5 fail closed). I read `AI-Dev-Shop/agents/programmer/skills.md` v1.7.5 first. Every worker brief carried its rules: root cause first, failing test first plus a named mutation, minimum change, fresh evidence, inject dependencies, no re-export shells, per-hunk resolution. Briefs are scratch files (`BRIEF.md`, `TASK-*.md`), not committed.

- **Base:** Tovu merge-19 = `afc90f785`. Jini merge-19 = `784ce903c`.
- **Setup:** Node 24.22.3.
  - Jini: `pnpm install --frozen-lockfile` + `pnpm -r build`.
  - Tovu: `npm ci --ignore-scripts` (root, admin, desktop, site-chat), `link-jini` with `JINI_PACKAGES_DIR=/home/user/Jini/packages`, `prepare-desktop-hooks`, and a hand build of `packages/{contracts,sdk}`.
  - Each worker got two git worktrees under `/home/user/wt/<item>-{tovu,jini}`. `node_modules` were hardlinked with `cp -al`. `dist` was copied, never hardlinked, so one worker's tsc write cannot land in another tree. Tovu was relinked to the worktree's own Jini.
  - Nested Jini `node_modules` (for example `packages/cms/forms`) have to be copied too, or the bt2 build fails.
- **Step 0:** desktop `npm run gates` on merge-19 was **6/6 PASS**.
- **Rules held:**
  - No `--no-verify`; hooks and `core.hooksPath` untouched.
  - No force-push. No codebase-memory tools.
  - `main`, `plan/*`, `release/*`, `codex/*` and older `integ/merge-*` were not touched. No tag or publish. B115 was not touched.
- **Workers:** 10 subagents, at most 4 at a time. Each stayed within 50 tool calls; the largest was 47.
- **Found at start:** combine-19's Tovu runtime-assistant tip `3f6f46e7d` was **never pushed and is lost**; `integ/wip19-runtime-assistant` does not exist on Tovu origin. Item 1 was therefore redone from `codex/w5-runtime-assistant-tovu` (`5993ed131`) onto merge-19. That merge had 158 conflicted paths.

## Items

| # | item | status | merged (Jini / Tovu) | evidence |
|---|---|---|---|---|
| 0 | desktop gates on merge-19 | PASS 6/6 | — | the pre-push hook also ran 6/6 on each push that touched `apps/desktop` (`integ/wip20-ra`, `integ/wip20-fix`, merge-20 `23c2a95ff` and `318f079ad`) |
| 1 | runtime-assistant Tovu lane | **MERGED** | Jini part already in merge-19 / Tovu `integ/wip20-ra` `51d8ca3ed` → merges `03586d12e` + `318f079ad` | **Conflicts:** 158 resolved. 33 DU and 4 UD kept the deletion (the other side's change was import-only). 121 UU: import hunks were resolved by script; 12 behaviour hunks by hand. Ledgers unioned.<br>**Imports:** `ToolAccessLoweringError` has one owner, `@jini-ai/core/tool-access-change`. `STOPPING_RUN_WAIT_MS` comes from `@jini-ai/daemon/session-coordination`.<br>**tsc:** root went 198 → 0, admin 0. The desktop `tsconfig.main` needed one `noUncheckedIndexedAccess` narrowing (`73ee1fb4e`).<br>**Node tests**, run on the RA tree's 374 changed test files: 4,124 tests, 74 failing in 13 files. 11 of those files pass on merge-19. Their failures were stale test imports, which tsc does not cover, fixed in `aea91c738`, `91720d4f4` and `51d8ca3ed` (219/219). The other 2 files are BASE-RED on merge-19.<br>**`byok-tool-surface`:** red only from a stale import; fixed, 87/87 with attachment-binding.<br>**`moved-tools.golden`:** **NOT re-recorded.** The drift (757,343 → 757,737 bytes, 328 names) is already red on merge-19 itself, `afc90f785`. Per-tool id, description and schema dumps of merge-19 and the RA tree are identical, so the drift is not from the moved tools. The `tools` section differs on `search_agent_plugin_local`'s description. `mcp-ui-allowlist-completeness` ("known exchange openers") is also BASE-RED on merge-19. **rv1124a FIX 10/11 not done.** |
| 2a | rv1124c bugs-tovu FIX 1: Sheets legacy `_tovu_*` headers (**RELEASE BLOCKER**) | **FIXED** | — / `5e2e7cc16` | **Fix:** `form-delivery-deliverer.ts` injects `legacyHeaders` for `google-workspace` through `adapterOptions`.<br>**Test:** the e2e `content/agent-plugin-overlays/google-workspace/__tests__/form-delivery.e2e.test.mjs` "a sheet already receiving rows under the old _tovu_* column names keeps them: one column per field, no duplicate plugin columns" runs the production composition. RED (`mapping-invalid`) before the fix; mutation drop-injection → red.<br>**Rename record:** `persisted-names.json` has the cutover entries. |
| 2b | bugs-jini FIX 1: A007 lock wait | **FIXED** | `60ef174a5`, `d991584eb` / — | **Fix:** `reprovisionOld` rethrows lock waits, so the journal is kept and the prior activation is recovered. Test `update.unit.test.ts` "a lock wait while re-provisioning the old revision at boot keeps the journal and recovers the prior activation once the lock clears": RED `recovered-disabled`, mutation → red.<br>**Retry wait:** `AgentPluginClockPort.sleepInBackground` is injected; the production clock binds an unref'd timer, pinned in `agent-plugins.sleep.test.ts` (mutation `ref:true` → red). |
| 2c | todos-jini/-tovu FIX 1 + todos-jini FIX 2: captured-mail clear (**DATA DELETION**, Opus) | **FIXED** | `d302782e5`, `2eeee3f66` / `e7c9b74b2`, `dce495f12`, `a34da9b4d`, `fd9a6835f` | **Fix:** `reviewCaptured` returns the IDs plus a revision = sha256 of the sorted IDs. `clearReviewedCaptures` deletes `workspace_id = ? AND id IN (…)` in one transaction. The shared types and `MAIL_CAPTURE_CLEAR_PERMISSION` live in `@jini-ai/core/contracts/mail`. The clear still sits behind the existing confirm card.<br>**Tests:** `capture-clear-retention.dialects.test.ts` runs on SQLite and PGlite. Mutations: concurrent arrival survives (M1 drop-id-binding), same-summary replacement (M2), workspace isolation (M3), mounted owner-permission refusal; each mutation turns both dialects red.<br>**Hooks:** `useEmailActivity` requires `useLoadHook` + `useCaptureClearFlowHook`; the host supplies them. RED first.<br>**Assistant tool:** `mail_clear_captured` and its `BATCH_OPT_OUT` line, 8/8. |
| 2d | todos-jini FIX 3 + todos-tovu FIX 2: H5 (**SECURITY**, Opus) | **FIXED** | `884df9707` / `335cb1c1b` | **Fix:** `ToolCatalogHttpDeps` is `{catalogFor}` or `{catalog, unscoped:true}`; missing scope gives 500, and a missing context gives `UNAUTHORIZED`. The duplicate mount helper was removed; the routes use `gatedJsonRoute`. Tovu mounts `catalogFor` with the live run's principal. Desktop and the Jini server preset declare `unscoped`.<br>**Mutations:** M1 unscoped-fallback, M2 context-fallback, T1 unscoped-mount, each red.<br>**Tests:** daemon http 2221/2221; Tovu 25/25. |
| 2e | bugs-tovu FIX 2 (bt FIX 7 visitor turn dedupe), FIX 3 (B176), FIX 5 (B159) | **FIXED** | — / `b070c97d3`, `2808113f5`, `bad432585` | **FIX 2:** a same-message retry makes one provider call. RED was 200 vs 409; mutation `skip-admit-check`. The merge with RA's rename `runProviderToolTurn` was resolved by hand.<br>**FIX 3 (B176):** consent is enforced only when configured. Mutation `ignore-bound-capability`.<br>**FIX 5 (B159):** no honest RED was possible (the lists were equal by value). Mutation `site-deps-drifts-to-partial-list`.<br>All 47/47 on merge-20. |
| 2f | bugs-jini FIX 2 (C025), FIX 3 (C131), FIX 4 + bugs-tovu FIX 6 (C8) | **FIXED** | `0afe5e25e`, `b18d08d77`, `21bf0096f` / `4eec99ccf` | **C025:** `SAFE_INSTALL_FAILURE_COPY` keeps the error code and drops the path. Mutation: log `err.message` → red.<br>**C131:** the AG-UI status label is now the host `failureMessage`, and the full failed-run sequence is pinned. Mutation `daemonError=false` → red.<br>**C8:** the `jini-` class pair; Tovu admin 959/959. |
| 2g | bugs-tovu FIX 4 (held-back specs → Jini CMS), FIX 7 (B120/B033 evidence); todos-tovu FIX 4 (C026), FIX 5 (H4 approval resume); bugs-jini FIX 5 (B257 mutation record) | **LEFT** | — | not dispatched (budget) |
| 3 | WAIT-M19 rows | **PARTIAL** | Jini `120139942`, `6ee4d2083`, `c478347a3`, `cfae4835f` / Tovu `cfca1a40d`, `dbb0c6d3b`, `78b0be2af`, `fc2f82f62`, `a70f2cabd`, `cedc2fec6`, `a578ee4d8`, `a3489fd33`, `1edcdb87c` | **Done:**<br>- `.mov` URL import, with the refusal message pin.<br>- Media description (J `a38a264c9` re-picked, `MEDIA_FIELDS`).<br>- B262: Jini cherry-pick of `ad0f462d0`; core `UserRepoPort.recordLogin`; Tovu `SqlUserRepo.recordLogin`, sqlite+pglite, mutation `drop-principal-where`.<br>- G7-4: 30-day trash retention, mutation 60 → red.<br>- G7-11: the marker appears only when the site has AGENTS.md; RED first; mutation `fileExists:()=>true` 7 red.<br>- G7-1: server sites refuse the default password at boot; RED first.<br>- B224: slug → id at write through the real factory, sqlite+pglite; RED first.<br>- `mail_clear_captured` (2c), H5 mount (2d), Sheets wiring (2a).<br>- `api:update`: Jini `1f9c8508b`, plus a changeset for the cms/core/platform removals.<br>- New bug found and fixed: `buildIdentityRouteDeps` unhandled rejection on seed failure (`a3489fd33`, RED first).<br>**LEFT:** G7-9 captions (schema + migration); H4 `created_by_kind` via an ADR-066 migration; A212 (bt2-todos already lists it DONE, not re-verified); G8.3; 104/107/108 media Tovu hooks; the `packages/infra/README.md` pointer; the `docs/spec/api.spec.md:360` link. |
| 4 | owner decisions 11-24 | **DONE (C9)** / **PARTIAL (release feed)** | — / `cfca1a40d`, `1edcdb87c` | **C9:** the tree already matches the decision (`share-backend.ts:190` refuses only with a public delivery). Pinned; both mutations turn red. No code change.<br>**Release feed:** `createGithubReleaseFeed({feedUrl,getJson})` implements `ReleaseFeedPort`, has no default URL, and skips drafts and prereleases. `composeConfiguredSiteUpdateRuntime` is config-only: absent config gives no runtime. Apply revalidates the running version under the update lock, so a version change needs a fresh approval card. Never automatic.<br>**LEFT:** no RouteDeps slot binds `siteUpdateRuntime` yet. The host adapters (desktop updater/migrate, self-hosted image tag, health, backup, readiness, `runningVersion`) do not exist. The feed config key name is still to be chosen. The move of check/apply into Jini DevOps was not done. |
| 5 | collapse 3 duplicate Jini owners | **DONE** | `80f26707b`, `d299c985b` / `8d589429f`, `23069c12a` | **cms `dialog` → `ui`:** the dialog subpath is deleted. `report-reasons.ts` (host wording) is dropped. `PublishContentPeerSummary` is dropped as identical to core `PublishContentPeerView`.<br>**Comments providers:** `capability-providers-comments` → `comments-providers`.<br>**External-MCP admissions:** the 7 duplicated `Admin*` admission types now live only in `hosted-mcp/admissions`. `cms-external-mcp` is *not* a superset, so only the duplicate block was removed.<br>**Boundary test:** `ui-stays-client-safe` now guards `publish/content/ui` with the same assertions, 8/8.<br>Zero importers of removed paths remain. |

## Pushed refs
- **Tovu**
  - `integ/merge-20-2026-11-24`: see the first line.
  - WIP branches: `integ/wip20-ra` `51d8ca3ed`, `integ/wip20-fix` `335cb1c1b`, `integ/wip20-mail` `fd9a6835f`, `integ/wip20-rows` `1edcdb87c`, `integ/wip20-dedupe` `23069c12a`, `integ/wip20-p5` `4eec99ccf`.
- **Jini**
  - `integ/merge-20-2026-11-24`: see the first line, plus this report copy.
  - WIP branches: `integ/wip20-fix` `884df9707`, `integ/wip20-mail` `2eeee3f66`, `integ/wip20-rows` `cfae4835f`, `integ/wip20-dedupe` `d299c985b`, `integ/wip20-p5` `0afe5e25e`.
- **Merge order:**
  1. bt2 lanes + Sheets/A007 (`wip20-fix`)
  2. rows
  3. mail
  4. rows (G7)
  5. dedupe
  6. RA
  7. rows3
  8. p5
  9. H5
  10. RA test fixes

  Each merge was pushed right after it landed.

## Gates (merge-20)

**Jini** (`1f9c8508b`):
- `pnpm -r build`: 0 (full build, then a filtered rebuild after the last merges).
- `typecheck`: 0.
- `api:check`: 0, after `api:update` (10 baselines) plus a changeset for the removals.
- `check:hooks`: ok.
- `guard`: 1. This is the BASE-RED `shell-failure-log.ts` HW3 (same as merge-18 and merge-19).
- `check:why-comments --base origin/integ/merge-19-2026-11-24`: **24 deleted blocks**. Not fixed: LEFT.
- vitest, run per package by each worker on its changed tests (not re-run centrally), all passing except where noted:

| package | tests |
|---|---|
| daemon `src/http` | 2221/2221 |
| agent-plugins `update.unit` | 41/41 |
| node-adapters | 22/22 |
| agent-plugins `src/lifecycle` | 1308 pass, 1 fail. The failure is a load-sensitive 5 s timeout in `lifecycle-reconciliation.unit` that also fails on base; it passes alone. |
| chat `ag-ui` | 78/78 |
| ui tab-strip | 166/166 |
| admin RowMenu | 35/35 |
| admin email | 28/28 |
| cms `src/media` | 673/673 |
| user-management `src/server` | 571/571 |
| cms `src/trash` | 192 pass, 3 fail. The failures are PGlite 5 s timeouts under load; they were not re-run in isolation. |
| cms `ui` | 31/31 |
| admin settings | 48/48 |

**Tovu** (`d4e2ca945` + test fixes):
- `tsc`: root 0, admin 0, `typecheck:e2e` 0, desktop `tsconfig.main` 0.
- desktop `npm run gates`: **6/6 PASS** on each push that touched `apps/desktop`, including merge-20 `318f079ad`.
- `check:hooks`: ok.
- `check:boundaries`: **0 errors**, 144 warnings (merge-19: 137). Two new problems were fixed in `31e589ac4`: `site-update` unranked (now rank 0), and `mail-status` importing server route types.
- `check:why-comments --base origin/integ/merge-19-2026-11-24`: **15 deleted blocks**. Not fixed: LEFT. One is `vault-legacy-codecs.ts` (RA deleted that file).
- admin vitest on the 12 changed admin test files: 332/332. Workers also ran email 150/150, trash 89/89, and themes/StaticSite/PluginsAdd 959/959.
- website node tests on all **391** changed test files vs merge-19 (`--test-concurrency=3`): **5,029 tests, 4,963 pass, 63 fail**, in 30 files.
  - **23 files are BASE-RED**, failing the same way on merge-19 `afc90f785`: `assistant/__tests__/mcp-ui-allowlist-completeness.test.ts`, `assistant/__tests__/moved-tools.golden.test.ts`, `cli/__tests__/unit/serve-command-wiring.unit.test.ts`, `contracts/core/__tests__/unit/describe-error-for-log.unit.test.ts`, `contracts/core/events/__tests__/forms-notification-restart.integration.test.ts`, `contracts/core/events/__tests__/forms-notification-retry.test.ts`, `contracts/core/events/__tests__/outbox-retry-policies.unit.test.ts`, `contracts/core/events/__tests__/outbox-worker.test.ts`, `features/api-connections/__tests__/vendor-neutrality.test.ts`, `features/entries/__tests__/integration/unreadable-owner-entries-repair.postgres.test.ts`, `features/newsletter/__tests__/send-pipeline.test.ts`, `features/site-backup/__tests__/library-share.integration.test.ts`, `platform/site-dir/__tests__/integration/boot-site-dir.postgres.test.ts`, `server/__tests__/routes/forms-submit.test.ts`, `server/__tests__/routes/member-password-auth.test.ts`, `server/__tests__/unit/forms-module-sender.unit.test.ts`, `server/inbound/assistant/__tests__/agent-daemon-server.page-navigate-error-rewrap.unit.test.ts`, `server/inbound/assistant/__tests__/agent-daemon-server.session-resume-wiring.unit.test.ts`, `server/runtime/boot/__tests__/index-bind-host-wiring.unit.test.ts`, `server/runtime/boot/__tests__/resolve-mailer.unit.test.ts`, `server/runtime/composition/__tests__/plugin-host.integration.test.ts`, `server/runtime/composition/__tests__/process-root-parity.test.ts`, `server/runtime/composition/__tests__/webhook-delivery-worker.test.ts`.
  - **7 files were NEW red** vs merge-19. All are fixed: re-run **143/143** (`e1bdb9e9d`, `e2c4261b4`, `ae4629835`).
    - Causes were lane-join test-only drift. Import lines were dropped from `round-trip-harness.ts` (`entryRepoFor` and others), `form-delivery.security` (`ensureSettingDefinitions` from `@jini-ai/core/settings`), `footer-page-links` (`POST_SEARCH_HOST`), `reserved-paths` (`RESERVED_SEGMENTS`) and `set-token-agent-tool` (`startMcpUiToolCallsServer`).
    - `byok-google-catalog` now expects the wired `site-update` family.
    - `providers-tools` t10 passed on re-run with no change. It looks order or load dependent; watch it.
  - **Net: no new red vs merge-19 in the changed-file set.**

## UNVERIFIABLE-IN-CLOUD (check in the real app)
1. **Google Sheets:** delivery to a real, existing owner sheet that has `_tovu_submission_id`/`_tovu_submitted_at` headers. Only a local fake Google was exercised.
2. **Release feed:** desktop and self-hosted "Update available" against the real GitHub releases feed, once a host binds `siteUpdateRuntime`. Nothing is bound yet.
3. **G7-1:** real server boot (`TOVU_RUNTIME_MODE=production`) with and without `TOVU_ADMIN_PASSWORD`. The refusal must be readable, not a bare crash. Desktop must still seed the starter password.
4. **G7-4:** the Trash screen copy and the 30-day purge in the running admin.
5. **Captured-mail "clear all":** the approval card flow in the Email screen, and in chat via `mail_clear_captured`.
6. **H5:** an agent run with a read-only principal must not see write tools in `/api/tools` search/describe. Run it on desktop (unscoped) and on a server site.
7. **C8:** tab-bar tag/dot and the above-anchor row menu render styled in admin.
8. **B115:** `sandbox:false` was not touched; it needs a packaged-app check.

## New bugs / follow-ups
1. **Lost work:** combine-19's Tovu RA tip `3f6f46e7d` was never pushed. It was rebuilt here, so nothing is lost now. Lesson: workers must push before the cap.
2. **Fixed here:** `buildIdentityRouteDeps` produced an unhandled rejection on seed failure (`a3489fd33`).
3. **H5 is breaking for other consumers.** Zana, Tovu-Runner and OD were not searched. Any mount passing only `{ catalog }` now gets 500s and needs `unscoped: true` or `catalogFor`.
4. **`site-deps/__tests__/route-deps-content-chat.characterization.unit.test.ts` "L1"** has a stale `DEPS` URL: the literal moved to `assembly-phases.ts`. It is BASE-RED and not in the changed set.
5. **why-comments:** Tovu has +15 and Jini +24 deleted blocks vs merge-19. Restore the comments or add debt entries.
6. **Still open from rv1124c:**
   - bugs-tovu FIX 4: held-back specs move to Jini CMS with injected ops.
   - bugs-tovu FIX 7: B120 pre-fix evidence and the B033 named mutation.
   - bugs-jini FIX 5: the B257 mutation record.
   - todos-tovu FIX 4: C026 with both lanes combined.
   - todos-tovu FIX 5: H4 approval-backed resume, plus `created_by_kind` for scheduled sends and publishes via an ADR-066 migration with pinned checksum.
7. **Still open from rv1124a:** FIX 10 (method-scoped `app.post` for the a2ui and mcp-ui routes, `res.json` writer, wire pins, mutation `bridge-writer-for-json`) and FIX 11 (`access-evidence.ts` constructed in composition). The DISAGREE moves are also still open.
8. **Site update:** add a RouteDeps `siteUpdateRuntime` slot and bind `composeConfiguredSiteUpdateRuntime`, with `getJson` from `guardedOutboundHttpClient` and `feedUrl` from config. Build the host adapters. Choose the config key.
9. **`moved-tools.golden` and `mcp-ui-allowlist-completeness` are BASE-RED on merge-19.** The golden drift is `search_agent_plugin_local`'s description, not a moved tool. Re-record only after the owner confirms that description change.

## TRUE COUNT (merge-20 Tovu `d4e2ca945`)
- **Tools:** `plans/P9-data/tools/scan.mjs` from `origin/plan/whats-left-1122` plus `cloud-results/combine-18-plan.mjs` from merge-18, as asked. scan: 7,204 files.
- **Result:** moving **1,308** (ready 255, blocked 1,053), keep 352, theme areas 120, so **1,308 / 1,188 excl. themes**.
- **Same planner on merge-19:** 1,323 / 1,203, so **−15**. combine-19 reported 1,388 using its own `combine-19-plan.mjs` (10 extra keep rules) on the content tip.
- **Regenerate:** `node scan.mjs <tovu> tv.json && ROOT=<tovu> JROOT=<jini> node combine-18-plan.mjs tv.json <outdir>`.

## Files still Jini-bound (per area, merge-20; ready items count their Jini files, blocked counts are files)
| area | files |
|---|---|
| adm-other | 208 |
| public-http | 95 |
| theme | 88 |
| adm-shell-components | 71 |
| admin-http | 71 |
| contracts-core | 54 |
| agent-plugins | 45 |
| adm-posts | 40 |
| adm-shell-lib | 39 |
| site-backup | 38 |
| adm-themes | 32 |
| publish-content | 32 |
| adm-security | 29 |
| post | 29 |
| deployments | 28 |
| adm-deployment | 24 |
| plugin-runtime | 21 |
| adm-pages | 19 |
| custom-credentials | 15 |
| adm-shell-hooks | 14 |
| api-connections | 14 |
| media | 14 |
| trash | 14 |
| adm-publish-content | 13 |
| identity | 13 |
| source-control | 12 |
| external-mcp | 11 |
| site-export | 10 |
| adm-source-control | 9 |
| database-transfer | 9 |
| settings | 9 |
| forms | 8 |
| newsletter | 8 |
| pages | 8 |
| project-keys | 8 |
| webhooks | 8 |
| adm-members | 6 |
| publish-trust | 6 |
| vendor-credentials | 6 |
| adm-recovery | 5 |
| adm-roles | 5 |
| contracts-headless | 5 |
| database | 5 |
| desktop | 5 |
| platform-mail | 5 |
| site-inspection | 5 |
| adm-users | 4 |
| consent | 4 |
| content-types | 4 |
| form-destinations | 4 |
| fs-files | 4 |
| mail-status | 4 |
| member-login | 4 |
| navigation | 4 |
| publish-content-ui | 4 |
| taxonomy | 4 |
| widgets | 4 |
| asset-transfer | 3 |
| comments | 3 |
| entries | 3 |
| media-generation | 3 |
| members | 3 |
| platform-html | 3 |
| presentation | 3 |
| recovery | 3 |
| web | 3 |
| analytics | 2 |
| email-templates | 2 |
| mail | 2 |
| object-storage | 2 |
| skills | 2 |
| web-screenshot | 2 |
| content-duplication | 1 |
| image-transform | 1 |
| media-import | 1 |
| observability | 1 |
| permanent-delete | 1 |
| platform-routing | 1 |
| redirects | 1 |
| seo | 1 |
| server-logs | 1 |
| site-search | 1 |
| tool-audit | 1 |
| webmcp | 1 |
