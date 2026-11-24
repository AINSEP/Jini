PARTIAL 00526116b3 631e6567e | FILES LEFT 1,583 / 1,532 (excl. themes: 1,462 / 1,412) | left: w5-content (fixed + green on local combine/m-c, not merged: 61 Tovu conflicts with webfeat at the cap), w5-admin, w5-runtime-assistant

# combine-18 (2026-11-24): Tovu + Jini `integ/merge-18-2026-11-24`

Unattended cloud run. Opus coordinator, Sonnet high-effort lane workers (Opus only for the two security fixes). I read `AI-Dev-Shop/agents/programmer/skills.md` v1.7.5 first. Every worker brief (`BRIEF.md`) carried its rules: root cause first, minimum change, fresh evidence, inject dependencies, no re-export shells.

- **Base:** Tovu `integ/merge-17-2026-11-23` = `2f6a9e1b3f` (includes `3995db6fe0`). Jini = `b84a373fb` (includes `b565aaa7`).
- **Setup:** Node 24.22.3.
  - Jini: `pnpm install --frozen-lockfile` + `pnpm -r build`.
  - Tovu: `npm ci --ignore-scripts` (root, admin, desktop, site-chat), then `link-jini.mjs` (`JINI_PACKAGES_DIR=/home/user/Jini/packages`) and `prepare-desktop-hooks.mjs`.
  - `packages/sdk` and `packages/contracts` must be built by hand after `--ignore-scripts`. Without that, the desktop typecheck fails on `@tovu/sdk`.
- **Step 0:** desktop `npm run gates` on merge-17 was **6/6 PASS**. Every push since ran it again through the pre-push hook, and every push was 6/6 PASS.
- **Rules held:**
  - No `--no-verify`; hooks and `core.hooksPath` untouched.
  - No force-push. No codebase-memory tools.
  - `main`, older `integ/*`, `plan/*`, `release/*` and `codex/*` were not touched. No tag or publish.

## Lanes

FIX status: ap = applied, st = stale, LEFT = not done.

| branch pair | FIX applied / stale / LEFT | merged sha (Jini / Tovu) | notes |
|---|---|---|---|
| w4-desktop (rv1123q) | ap 13, 14, 16; st 12; LEFT 15 | `68d5cfa82` / `a5d385be6d` | **FIX 12 stale:** merge-17's checker already accepts required hook props; the baseline was locked lower. **FIX 16:** new `@jini-ai/desktop-host/shell/copied-site-databases` (`commitWithCopiedDatabases`), 6 vitest. **FIX 15 LEFT:** tab-strip extraction. **Duplicate:** `@jini-ai/ui/site-card` exports both `useSitePreview` and `useSiteCardPreview` (not deduped). |
| w5-w3rest (rv1124a) | ap 12, 13 (Opus), 14, 15 (via merge), 16, origin shell deleted; LEFT the other DISAGREE moves | `09637a66e`+`cb6a9b543` / `207d0f28b7`+`fc24f77c24` | **Base:** the Tovu lane was forked from its own rebuild `b621656eb9`. I merged per file with that base, so 102 of 179 files merged clean. **FIX 13 (security):** strict AAD is restored on `AesGcmSecretSealer.seal`. The legacy unbound write is only available through the explicit `LegacyUnboundAesGcmSecretSealer`. RED first. Mutation `sealer-default-accepts-missing-aad` turns a test red. No Tovu caller needed the compat entry. **FIX 16:** `tiptapToBlocks` is in `@jini-ai/cms/seo/content-analysis`, so the trusted-imports list is unchanged. **LEFT:** keyring.env/site-key-sources, seal-aad AST check, recovery fake port, integrations-api.types. |
| w5-routes (rv1124a) | ap 1, 2, 3, 4, 6; LEFT 5, DISAGREE x2 | `d3954aa94` / `629e36edba` | **FIX 3/4:** RED first. **FIX 6:** the original three-handler site-share upload chain is restored; the snapshot was not edited. **FIX 1:** dev-proxy is on Node streams with a required `writeFailure`. **FIX 2:** legacy classes and copy are injected, and rendered bytes are pinned against a fixture recorded before the change. |
| bt-dec-a (rv1123n/o) | ap 9 (Tovu column); LEFT 7 | `3356a5a45` / `3fa478f8c8` | **FIX 9:** migration `0043_webhook_subscription_creator_kind` (nullable) + schema + types + checksum. The round-trip test covers memory, sqlite and pglite. **FIX 7 LEFT:** the dedupe mount in `modules/site-assistant.ts` (the mount exists; budget). |
| bt-dec-b | ap 12 (desktop pin) | `290ce1323` / `15528dc134` | `redactor-bindings.test.ts` 5/5 (no mutation run). The lane keeps `redactTovuLocalText` where merge-17 had the plain redactor. **Defect:** commit `15528dc134` contains conflict markers in `development/open-bugs.md`. They were fixed in the next commit (`b9bc10c50b`), and the tip is clean. |
| bt-themes-quarantine | LEFT 15, 17 | — / `b9bc10c50b` + `e4b806933c` | **Post-merge fixes:** import repoints for `GatedMutationHooks` and `bodyRecord`. Boundaries: 4 errors → 0 (in `combine/m-w`, which is now merged). The three held-back modules were added to the `features/theme` PUBLIC_ENTRIES, and `explainThemeTree` is injected from composition. 15/15 held-back tests pass. |
| w5-webfeat (rv1124b) | ap 12, 13, 14; st 11; LEFT 15, 16, 17 | `631e6567e` / `00526116b3` (+ join `combine/m-w`) | **FIX 11 stale:** `@jini-ai/core/tool-access-change` had no Core owner in this tree, so webfeat's merge made it the single owner of `ToolAccessLoweringError`/`NotifyToolAccessChanged` and deleted the daemon and contracts copies. **FIX 15 LEFT, owner call:** `menu-authored-html.test.ts` differs from merge-17 only by the import `@jini-ai/cms/navigation`, because merge-17's `#src/features/navigation/index` no longer exists. **Guard:** the `tiptap-blocks.ts` HW3 is fixed (`ReadonlySet`). **Lockfile:** regenerated (search adds pglite/db/better-sqlite3). |
| w5-content (rv1124b) | ap 4, 6, 7, 8, 10, 5 (partial) | **NOT MERGED** | **Ready on local `combine/m-c`** (Jini `cc61c4d69`, Tovu `8622942bf3`): merge-18 before webfeat + content. tsc root/admin/desktop all 0. admin vitest 926/926 and website node 161/161. **Why it is out:** it conflicts with webfeat in 61 Tovu files (mostly import hunks) and 9 Jini files, and the run hit the 2.5 h cap. Local refs are lost with the container. Rebuild recipe: `fix/w5-content` tips Jini `43e26b32c` / Tovu `66bd426462` (local only). **FIX 9 LEFT.** |
| w5-admin (rv1124b) | ap 1, 3; LEFT 2 | **NOT MERGED** | **State:** the lane-fix branch reached tsc 0 (Tovu `74c65f9365`). **Why it is out:** the join with content (worker m-ca) bulk-took the admin lane in every non-import hunk, which may drop content edits. It ended at 54 tsc errors, with duplicate dictionary factories (two per collections, menus, taxonomy and comments) and two post-editor route-key factories. That is not safe to merge. |
| w5-runtime-assistant (rv1124a) | ap 8 (Opus); LEFT 9, 10, 11 | **NOT MERGED** | **FIX 8 (security):** the principal is checked before any body read in both standalone routes. New `answerA2uiAction` takes a host-parsed body. RED first; 2 mutations turn tests red. **Why it is out:** the Tovu half conflicts with the merged webfeat in 58 files and was not finished by the cap. |

## Gates
Final gates ran on the tree before the webfeat join (Jini `290ce1323`, Tovu `e4b806933c`). I re-checked the final tip where noted.

**Jini:**
- build and `typecheck`: 0.
- `api:check`: pass (also on the final tip).
- `check:hooks`: ok.
- `guard`: 1 on the final tip, the BASE-RED `shell-failure-log.ts` HW3. merge-17 had 9.
- vitest on changed test files in 17 packages: all pass. In webfeat's own run, cms `universal-entries.boundary` is BASE-RED (undeclared jsdom).
- `check:size` and `check:complexity`: red on files unchanged since merge-17, so BASE-RED. size: `server/builtin-features.ts` 569 plus stale sidecar rows. complexity: `session-results`, `event-projection`, `reporter`, `ErrorNotice`.
- `check:why-comments`: 12 (merge-17: 10). **+2 new.**

**Tovu:**
- `npm run typecheck` (root + e2e): 0.
- admin tsc: 0, also on the final tip.
- desktop: 6/6 through the hook on all 3 pushes.
- `check:hooks`: ok.
- `check:boundaries`: 0 errors / 134 warnings on the final tip.
- why-comments: **84** (merge-17: 61). **+23 new.** Most of the lost blocks sit in files that still exist in Tovu (pages/posts update and delete, form-render, member-auth-script). Restore them next to that code. No debt rows were added.
- admin vitest on 25 changed test files: 467/474. 7 fail:
  - `security-panel` 6: BASE-RED (combine-17b #5).
  - `dictionary-lookup-sinks` 1: it needs the `createPluginsDictionary` binding and negative cases; the floor was not lowered.
- node tests on 273 changed website/site-chat test files (postgres/live excluded, concurrency 2): 4532/4553, 20 fail.
  - BASE-RED per combine-17b: federate-mcp (4), plugin-host (3), resolve-mailer, mail-send.golden.
  - NOT ATTRIBUTED (no merge-17 rerun in time): execution-provider-catalog, mcp-ui-allowlist-completeness (`assistant_render_ui` not found by the scan), moved-tools.golden, install-tool-update, external-mcp-aad, site-backup tool-registrations-host-connection, site-backups.integration, export-preflight, credential-setup-projections, render.golden, tiptap-render-contract, plus bundled package publisher identity (`jini/` vs `tovu/` ids, BASE-RED according to the webfeat worker).

## TRUE COUNT
- **Tools:** `plans/P9-data/tools/{scan,plan}.mjs` from `origin/plan/whats-left-1122`. scan: 7,560 files on the final tip.
- **Old rules:** moving 1,583 (ready 311, blocked 1,272), keep 305, theme areas 121, so **1,583 / 1,462 excl. themes**. At the pre-webfeat tip it was 1,637 / 1,516. merge-17 was 1,659 / 1,548.
- **New rules:** **1,532 / 1,412 excl. themes** (keep 356). The new file is `cloud-results/combine-18-plan.mjs`.
  - It adds 101 anchored `KEEP_RULES`, one per Codex-AGREED STAYS-HOST path in rv1123q/r/s and rv1124a/b: the desktop IPC adapters (`app-version-ipc`, `find-in-page-ipc`), `apps/admin/src/features/admin-themes/`, and the confirmed adapter, copy and binding paths.
  - It narrows the broad voice-input rule, as rv1123q asked. `voice-input-port.ts` stays as the AGREE file.
  - It appends a theme-areas line.
  - 10 AGREE paths from the unmerged content and admin lanes have no rule yet.
- The theme-area count rose from 111 to 121 because of the new bt-themes held-back files.

## New bugs / follow-ups
1. **Merge w5-content next.** It is green on its own. The 61 webfeat overlaps are import and composition hunks, listed in Codex rv1124b MERGE-ORDER 3.
2. **w5-admin needs a careful rejoin.** Pick one dictionary factory per domain: the admin lane's `screens/<x>/<x>-i18n.ts` `{t}` or content's `create-<x>-dictionary.ts` `{dictionary,t}`. Pick one post-editor route-key factory: `createPostEditorRouteKeys` or `createPostEditorRouteKeyStore`. Review the styles.css hunks.
3. **w5-runtime-assistant Tovu:** 58 conflicts against webfeat. Callers must import `ToolAccessLoweringError` from `@jini-ai/core/tool-access-change`.
4. **why-comments:** +23 Tovu and +2 Jini lost blocks.
5. **Theme owner calls:**
   - The webfeat FIX 15 navigation import (above).
   - The `features/theme` PUBLIC_ENTRIES addition, which puts the held-back modules beside `preview-policy`.
6. **Open from the bt fixes:** bt FIX 7 (dedupe mount), FIX 15 (held-back `defineJsonRoute`), FIX 17 (hook split).
7. **Unclassified node-test reds:** rerun the 11 NOT-ATTRIBUTED files on merge-17 to classify them.
8. **Worktree environment:** hardlinked worktrees miss newer deps such as `kysely`, `parse5` and `zod/v3`. Run `pnpm install` per worktree.

## Files still Jini-bound (FILES LEFT by area, new rules, final tip)
Per-area table below; regenerate with `ROOT=<tovu> node cloud-results/combine-18-plan.mjs tv.json <out>` after `scan.mjs`.

Per-area count (new rules, final tip). Ready items include their moving tests; blocked counts are files:

| area | files |
|---|---|
| adm-other | 225 |
| admin-http | 114 |
| public-http | 88 |
| adm-shell-components | 76 |
| theme | 57 |
| adm-posts | 43 |
| post | 40 |
| site-backup | 37 |
| agent-plugins | 37 |
| publish-content | 28 |
| adm-security | 28 |
| contracts-core | 27 |
| deployments | 26 |
| adm-shell-lib | 26 |
| adm-themes | 22 |
| adm-pages | 21 |
| plugin-runtime | 20 |
| adm-deployment | 18 |
| media | 16 |
| adm-shell-hooks | 16 |
| trash | 13 |
| api-connections | 13 |
| custom-credentials | 12 |
| source-control | 12 |
| adm-publish-content | 11 |
| external-mcp | 10 |
| identity | 10 |
| forms | 9 |
| adm-source-control | 9 |
| site-export | 8 |
| pages | 8 |
| project-keys | 8 |
| newsletter | 7 |
| adm-members | 7 |
| settings | 6 |
| webhooks | 6 |
| comments | 5 |
| vendor-credentials | 5 |
| database-transfer | 5 |
| adm-recovery | 5 |
| adm-roles | 5 |
| form-destinations | 5 |
| platform-mail | 5 |
| publish-trust | 4 |
| widgets | 4 |
| site-inspection | 4 |
| adm-users | 4 |
| consent | 4 |
| fs-files | 4 |
| mail-status | 4 |
| media-generation | 4 |
| member-login | 4 |
| contracts-headless | 3 |
| taxonomy | 3 |
| navigation | 3 |
| database | 3 |
| asset-transfer | 3 |
| content-types | 3 |
| entries | 3 |
| members | 3 |
| web | 3 |
| presentation | 2 |
| desktop | 2 |
| email-templates | 2 |
| media-import | 2 |
| object-storage | 2 |
| web-screenshot | 1 |
| skills | 1 |
| recovery | 1 |
| content-duplication | 1 |
| image-transform | 1 |
| mail | 1 |
| permanent-delete | 1 |
| redirects | 1 |
| seo | 1 |
| server-logs | 1 |
| site-search | 1 |
| tool-audit | 1 |
| webmcp | 1 |
| platform-html | 0 |
| platform-routing | 0 |
| publish-content-ui | 0 |
| analytics | 0 |
| observability | 0 |
