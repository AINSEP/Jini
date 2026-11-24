PARTIAL <see Pushed refs: Tovu merge-19 = content + admin merge 0450013ae + this edit; Jini merge-19 = wip19-all + report> | FILES LEFT 1,388 (excl. themes 1,268; measured on the content tip, before admin) | left: w5-runtime-assistant (Tovu tsc 0 at 3f6f46e7d, website tests not re-run, not merged); content FIX 9, RA FIX 11, admin FIX 2, DISAGREE moves

# combine-19 (2026-11-24): Tovu + Jini `integ/merge-19-2026-11-24`

Unattended cloud run. Opus coordinated. Sonnet high-effort workers did the merge and fix work; the one Opus worker did security FIX 8. I read `AI-Dev-Shop/agents/programmer/skills.md` v1.7.5 first. Every worker brief (scratchpad `BRIEF.md`) carried its rules: root cause first, minimum change, fresh evidence, inject dependencies, no re-export shells, per-hunk resolution, never bulk-take a side.

- **Base:** Tovu `integ/merge-18-2026-11-24` = `8e00664eb`. Jini = `57aa0b9b7`.
- **Setup:** Node 24.22.3.
  - Jini: `pnpm install --frozen-lockfile` + `pnpm -r build`.
  - Tovu: `npm ci --ignore-scripts` (root, admin, desktop, site-chat), then `link-jini`, `prepare-desktop-hooks`, and a hand build of `packages/{contracts,sdk}`.
  - Worktrees got `cp -al` node_modules relinked to their lane's Jini.
- **Step 0:** desktop `npm run gates` on merge-18 was **6/6 PASS**.
- **Rules held:**
  - No `--no-verify`; hooks and `core.hooksPath` untouched.
  - No force-push. No codebase-memory tools.
  - `main`, `plan/*`, `release/*`, `codex/*` and older `integ/merge-*` were not touched. No tag or publish.
- **Order change:** each lane was merged onto merge-18 + content, not onto merge-18 alone. combine-18 lost two lanes on second-round join conflicts. Tovu lane overlaps were content x admin 106 files, content x RA 147, admin x RA 3. FIXes went in after each merge.

## Lanes

| lane | FIX applied / stale / LEFT | merged sha (Jini / Tovu) | notes |
|---|---|---|---|
| w5-content (rv1124b) | ap 4, 5, 6, 7, 8, 10; LEFT 9 | **MERGED** `b6d546b2b` / `cebe0727a` (+ `27a874cd4`, `fa17f687b` gate fixes) | **Conflicts:** Tovu 301 (230 content, 71 modify/delete), resolved per hunk by two partition workers. Jini had 30. **Modify/delete:** every one was import-only on the other side, so the deletions were kept. **Secrets:** `KeyringPort`/`SecretSealerPort` come from `@jini-ai/integrations/secrets`; `AesGcmSecretSealer` from `@jini-ai/platform/secrets`. **Tool access:** `ToolAccessLoweringError` comes from `@jini-ai/core/tool-access-change`. **FIX 5:** new required kit fields `MenusHostKit.{useCachedLoader,useDirtyGuard,useFetchQuery}` and `TaxonomyHostKit.{useFetchMutation,useFetchQuery,useInvalidate}`, bound from `@jini-ai/ui`. **FIX 7/10:** `MenuDeleteRouteDeps` = `{workspaceId, outwardErrorMessage, trashMenu}`; the host binds its prior closure via `@jini-ai/cms/navigation/site/trash-menu`. The SEO routes require the formatter, pinned with distinct host output. **FIX 8:** host-binding adapters take object args. **FIX 6:** `PublishContentPeerView` from core. **FIX 9 LEFT:** the SQL search move to CMS. |
| w5-admin (rv1124b) | ap 1, 3 (lane), dedupe; LEFT 2 | **MERGED (late).** Jini `a6c920770` via `integ/wip19-all` `d43eb040f`. Tovu `integ/wip19-admin` `32cc487c7` → merge `0450013ae` | **Late join:** content join `de4e33615`; tsc fixes `cb50353d4` (keyset-cursor from core, `renderA2uiSurface` collaborators injected, theme-pages types); tests `32cc487c7`. Root and admin tsc 0. admin vitest 181 changed files: 3664 pass; the 5 failures were the BASE-RED `dictionary-lookup-sinks` 1 plus 4 fixed and re-run green. Desktop gates 6/6 on `32cc487c7`. | **Jini:** merge + FIX 1 (`major` for admin and desktop-host) + dedupe. Removed admin's `screens/{collections,comments,menus,taxonomy}/*-i18n` and `posts/post-editor-route-keys` in favour of content's factories. Build, api:check and tsc are green; vitest 53 files / 461 tests pass. **Tovu:** 146 conflicts resolved per hunk onto content. One dictionary factory per content domain and one `createPostEditorRouteKeyStore` instance from `panels.tsx`. Both lanes' tests kept; css unioned. The join with `cebe0727a` and the tsc pass were in flight at the cap. |
| w5-runtime-assistant (rv1124a) | ap 8 (Opus), 9, 10; LEFT 11 | **NOT MERGED.** Jini `integ/wip19-runtime-assistant` `f8461e9d4` (+ merge-18 join; included in `wip19-all`). Tovu `integ/wip19-runtime-assistant` local tip `3f6f46e7d` (push with gates in flight at the cap) | **FIX 8 (security):** new `answerA2uiAction({request, deps})` and an internal `principalFirstJsonPost` mount check the principal before any body read. RED first (4 fail); mutations M1–M4 each turn a test red. **FIX 9:** `DaemonCoreParser`/`DaemonCoreParseResult` replace `z.ZodType` in public exports, changeset `major`. **FIX 10:** both endpoints are method-scoped `app.post` again. JSON goes through `res.json` (length + weak ETag); NDJSON goes through the bridge. Wire pins cover registration, headers and OPTIONS; named mutation `bridge-writer-for-json`. **Jini:** typecheck 0; vitest daemon 584, core 62, mcp 26, chat 76, agent-runtime 51, all pass. **Tovu:** tsc root and admin are 0. The website node run (69 files) gave 874 pass, 4 fail, 14 cancelled. The 14 cancelled files came from a stale `STOPPING_RUN_WAIT_MS` import, fixed in `3f6f46e7d` but not re-run. Open fails: `mcp-ui-allowlist-completeness` (combine-18 NOT-ATTRIBUTED), `moved-tools.golden` (+394 bytes, same 328 names; content-lane copy, so do not regenerate blindly), `byok-tool-surface`, `attachment-binding` (should be fixed by `3f6f46e7d`). |

## Pushed refs
- **Jini**
  - `integ/merge-19-2026-11-24` = `integ/wip19-all` (`d43eb040f`: content + runtime-assistant + admin Jini lanes) + report. Tovu merge-19 compiles against it; Tovu admin was typechecked and gated against exactly this Jini. The RA Jini lane is additive for the Tovu tree without the RA Tovu lane.
  - `integ/wip19-content` = `b6d546b2b`.
  - `integ/wip19-admin` = `a6c920770`.
  - `integ/wip19-runtime-assistant` = `f8461e9d4`.
  - `integ/wip19-all` = `d43eb040f`: all three Jini lanes joined. Build, `api:check`, typecheck 0; guard has 1 = BASE-RED.
- **Tovu**
  - `integ/merge-19-2026-11-24` = content (`fa17f687b`) + report (`6e977979d`) + w5-admin merge `0450013ae` + this edit.
  - `integ/wip19-admin` = `32cc487c7`: pushed; desktop gates 6/6.
  - `integ/wip19-content` = `fa17f687b`.
  - `integ/wip19-admin` and `integ/wip19-runtime-assistant`: pushes were running with pre-push desktop gates at the cap. Run `git ls-remote origin 'refs/heads/integ/wip19-*'` to check whether they landed.
  - Local-only shas if they did not land: admin join `9fc579cf8`, RA `3f6f46e7d`. These are lost with the container.

## Gates (merge-19 = content)
- **Jini** (`b6d546b2b`):
  - `pnpm -r build`: 0.
  - `api:check`: pass.
  - typecheck: cms and admin tsc clean. Full `pnpm typecheck` was 0 on `wip19-all`.
  - `check:hooks`: ok.
  - `guard`: 1, the BASE-RED `shell-failure-log.ts` HW3 (same as merge-18).
  - `check:why-comments`: 12 (merge-18: 12). **+0.**
  - vitest on changed files: cms 258 + routes/media 85, admin collections 101 and menus/taxonomy 114, all pass. Not run: core, capability-providers, integrations changed tests.
- **Tovu** (`fa17f687b`):
  - `tsc` root: 0 (68 before the fix pass). `typecheck:e2e`: 0. admin tsc: 0 (17 before).
  - desktop `npm run gates`: **6/6 PASS** on `cebe0727a`. The two later commits do not touch desktop paths.
  - `check:hooks`: ok, after fixing 1 new entry: `EditMediaModal` now takes `useAdminKitValuesHook`.
  - `check:boundaries`: 0 errors / 137 warnings, after fixing 1 new error: `features/post` public entry `search-host-config`.
  - `check:why-comments`: **88** (merge-18: 84). **+4 new.** Run it with `../Jini` resolving to the matching Jini, or every moved block counts as deleted (7,302 false positives).
  - admin vitest on 76 changed publish, menus, taxonomy, posts, pages and app-hooks tests: 72 files / 1706 tests pass. The other ~100 changed admin test files were not run.
  - website node tests on 103 changed files: about 1331 pass and 10 fail. All 10 were caused by the merge, fixed and re-run green. The full 103-file run was not repeated end to end.

## New bugs / follow-ups
1. **Merge w5-admin next.** Join Tovu `integ/wip19-admin` (or `9fc579cf8`) with `fa17f687b` (about 3 conflicts), link Tovu to `integ/wip19-all`, run tsc, admin vitest and desktop gates. Then advance Jini merge-19 to the admin part of `wip19-all`.
2. **Then w5-runtime-assistant.** Tovu tip `3f6f46e7d` is tsc 0. Re-run the website node tests (above), and decide on the `moved-tools.golden` byte drift and on `byok-tool-surface`. Then merge.
3. **Duplicate Jini owners to collapse:**
   - `@jini-ai/cms/publish/content/dialog` vs `.../ui`. Tovu now uses `/ui`; `PublishContentPeerSummary` still lives in `dialog/contract.ts`.
   - `@jini-ai/core/contracts/site/comments-providers` vs `capability-providers-comments`: identical declarations.
   - `core/contracts/hosted-mcp` vs admin's `cms-external-mcp` (a superset).
   - The Tovu boundary test `ui-stays-client-safe` still guards `dialog`.
4. **Content worker cap overrun.** The content-Jini worker used 129 tool calls against a cap of 50. It finished green.
5. **why-comments:** +4 Tovu blocks. **Hooks:** the admin Jini `REFUSAL_COPY` product vars for external-mcp admissions are not injected yet.
6. **FIX 9 (content):** move `search-index.memory` and the `repo.ts` SQL search to `@jini-ai/cms/posts/sql`. **FIX 11 (RA):** construct `media/access-evidence.ts` in composition. **FIX 2 (admin):** 4 DISAGREE splits. The rv1124a DISAGREE moves (`run-start-context`, `mcp-injection`, the w3rest keyring/site-key-sources, seal-aad, recovery fake, integrations types) are all LEFT.
7. **Stale dist:** `packages/contracts` dist in a fresh worktree can be stale. Rebuild it before Tovu tsc.

## TRUE COUNT (merge-19 = content tip)
- **Tools:** `plans/P9-data/tools/scan.mjs` from `origin/plan/whats-left-1122`. scan: 7,344 files.
- **Planner:** `cloud-results/combine-19-plan.mjs` = combine-18's planner + 10 anchored KEEP_RULES for the rv1124b AGREE paths that had no rule:
  - admin `external-mcp-drift-copy`;
  - content `menu-editor-panel`, `CollectionsScreen`, `CollectionEntriesScreen`, `cms-capability-cards`, `post-schema-binding`, `post/repo.sqlite`, `submission-ip-retention`, `publish-content/ui/host-binding` and `platform/db/content-tables`.
- **Result:** moving **1,388** (ready 280, blocked 1,108), keep 359, theme areas 120, so **1,388 / 1,268 excl. themes**. combine-18 final tip: 1,532 / 1,412.
- Regenerate with `node scan.mjs <tovu> tv.json && ROOT=<tovu> JROOT=<jini> node cloud-results/combine-19-plan.mjs tv.json <outdir>`.

## Files still Jini-bound (per area, merge-19 content tip; ready items count their files, blocked counts are files)
| area | files |
|---|---|
| adm-other | 232 |
| public-http | 95 |
| adm-shell-components | 91 |
| theme | 88 |
| contracts-core | 71 |
| admin-http | 71 |
| agent-plugins | 45 |
| adm-posts | 42 |
| adm-shell-lib | 41 |
| site-backup | 38 |
| adm-security | 36 |
| adm-themes | 32 |
| publish-content | 32 |
| deployments | 28 |
| post | 28 |
| adm-deployment | 27 |
| adm-pages | 23 |
| plugin-runtime | 21 |
| adm-shell-hooks | 17 |
| custom-credentials | 15 |
| trash | 14 |
| adm-publish-content | 13 |
| api-connections | 13 |
| identity | 13 |
| media | 13 |
| source-control | 12 |
| adm-source-control | 11 |
| external-mcp | 11 |
| site-export | 10 |
| database-transfer | 9 |
| settings | 9 |
| newsletter | 8 |
| pages | 8 |
| project-keys | 8 |
| webhooks | 8 |
| adm-members | 7 |
| forms | 7 |
| publish-trust | 6 |
| vendor-credentials | 6 |
| adm-recovery | 5 |
| adm-roles | 5 |
| desktop | 5 |
| contracts-headless | 5 |
| database | 5 |
| site-inspection | 5 |
| platform-mail | 5 |
| adm-users | 4 |
| consent | 4 |
| content-types | 4 |
| form-destinations | 4 |
| fs-files | 4 |
| mail-status | 4 |
| member-login | 4 |
| navigation | 4 |
| taxonomy | 4 |
| widgets | 4 |
| asset-transfer | 3 |
| comments | 3 |
| entries | 3 |
| media-generation | 3 |
| members | 3 |
| presentation | 3 |
| publish-content-ui | 3 |
| recovery | 3 |
| web | 3 |
| platform-html | 3 |
| email-templates | 2 |
| object-storage | 2 |
| skills | 2 |
| web-screenshot | 2 |
| platform-routing | 2 |
| analytics | 2 |
| content-duplication | 1 |
| image-transform | 1 |
| mail | 1 |
| media-import | 1 |
| permanent-delete | 1 |
| redirects | 1 |
| seo | 1 |
| server-logs | 1 |
| site-search | 1 |
| tool-audit | 1 |
| webmcp | 1 |
| observability | 1 |
