PARTIAL b434161c5 6b6028e7: 36 lane files stay, all blocked on other lanes' unlanded steps or a STOP rule (publish-content 14, skills 12, import-export 4, fs-files 3, content-analysis 2, webmcp 1). The lane's ready work is done.

# w3-screens: admin screens on the injected kit (A-K2), 2026-11-23

Unattended cloud run, Opus high, coordinator plus subagents.

**Programmer contract.** I read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) before any work. Every worker had to read its Role and Workflow through the shared brief, and the brief applied these rules:
- minimum change;
- tests first for any behaviour change;
- a named mutation for every step;
- the verification-before-completion gate.

**SHAs on the first line.** They are the code heads before this report commit. The report commit sits on top of each.

## Bases, branches and setup
- **Base:** Jini and Tovu `origin/integ/merge-15-2026-11-23`. Jini `2e0cb890`, Tovu `d3d674941`. No prior lane branch was merged.
  - The latest merge-15 head was merged again before the final push: Jini `820e53d6` (+2 commits), Tovu `9cf74a2a5` (+3 commits). Both were disjoint from this lane.
- **Pushed:** only `codex/w3-screens-jini` and `codex/w3-screens-tovu`, with plain `git push`.
  - Not used: force-push, `--no-verify`, tags, publish, codebase-memory tools.
  - Not touched: `main`, `integ/*`, `plan/*`, `release/*`.
- **Setup:**
  - Node 24.22.3 (`/opt/node24`).
  - Jini: `pnpm install --frozen-lockfile` 0, then `pnpm --no-bail -r build` 0 (0 `error TS`).
  - Tovu: `npm ci --ignore-scripts` in root, admin, desktop and site-chat: 0/0/0/0.
  - Linking: `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs` 0 (82 links). `packages/contracts` tsc 0, `packages/sdk` build 0.
- **Base gates:** run on clean `git worktree`s of both bases (`/home/user/base-{jini,tovu}`). The Jini worktree had its own install and full build.
- **Plans:** read from `origin/plan/whats-left-1122`:
  - step sheets `plans/P9-steps/A-K2-*`;
  - `P9-data/k-work.json`;
  - `P9K-extraction.md` §1–2;
  - `P9F-feature-lanes.md`;
  - `P9-data/tools/{scan,plan}.mjs`.
- **Lane scope:** every live A-K2/A-adm row of `k-work.json` was checked against the wave-3 ownership list.
  - My candidates: `import-export`, `skills`, `content-analysis`, `webmcp`, `fs-files`, `publish-content`.
  - Every other A-K2 row is owned elsewhere, is shell (w3-fnd), or is themes, which stay in Tovu per P9F.
  - `admin-themes` is a themes screen and stays.

## FILES LEFT (`scan.mjs` + `plan.mjs`; FILES LEFT = moving + shells)
| tree | moving | shells | **FILES LEFT** | **excl. themes** (`theme` + `adm-themes` = 111) |
|---|---|---|---|---|
| base (Tovu merge-15 `d3d674941`) | 2,269 | 0 | **2,269** | **2,158** |
| final (`b434161c5`) | 2,248 | 0 | **2,248** | **2,137** |
| **delta** | −21 | 0 | **−21** | **−21** |

- 23 Tovu source files were deleted. Two Tovu host-wiring files were added: `import-export/ImportExportPanel.tsx` (the mount) and `webmcp/admin-page-tool-collaborators.ts` (a binding object, not a re-export).
- Jini gained 27 source files and 13 test files under `packages/admin/src/screens/{import-export,skills,content-analysis,webmcp,fs-files}/`.

## Batches
Each worker ran alone. Workers never committed; I reviewed every diff and made every commit.

| batch | model | files moved (Tovu → Jini) | importers / host wiring | tests | status |
|---|---|---|---|---|---|
| A: import-export | Opus high | 8: `import-export-i18n`, `import-export-links`, `import-export-tabs`, `git-backup-rules`, `hooks/git-backup-port.hooks`, `hooks/use-git-backup.hooks` (controller), `GitBackupCard`, `ImportExport`. The `index.ts` barrel was deleted. | `panel-pages.ts` → new `ImportExportPanel.tsx`, which injects `useTranslate`, `useGitBackup`, `useTransferTranslate`, `useSitesAvailable`, `SiteExportTab`, `SiteImportTab`, `handleLabels` (`.tovu.zip` copy, K3) and `navigate`. Also changed: `sites-idle-requests` test (import line), `admin-route-lazy-loading` test (2 data rows), `styles.css` (+`jini-import-export-*` aliases). | Jini 29 (22 GitBackupCard moved + 7 new characterization tests). Tovu `features/import-export` 10/10 (new `git-backup-wiring`, plus an `ImportExport` mount test). Mutation: `t("Git backup")` → `"Git backupMUT"` went 1 red, then restored to 29/29. | ✅ `9685b140` · `c7b164dfe` |
| B: skills | Opus high | 6: `skills-i18n`, `skills-page-dictionary`, `SkillInstallConfirmation.hooks`, `Skills.hooks`, `skill-upload`, plus new `api/skills-api.types` (types cut from `api.ts`) | Import lines in 6 Tovu sources, 7 tests and `fqfix-actions`. | Jini 9 (`skill-upload` moved, `skills-i18n` new). Tovu 316 pass (16 files). Mutations: `skill-upload` first `if` negated went 7 red; dropping `commonDictionary` went 1 red; both restored green. | ✅ `646fbc7c` |
| B2: skills | Sonnet xhigh | 2: `skill-drop` (byte-identical), `use-skills-tabs.hooks` | Import lines: `composer-files.hooks.ts`, `use-skills.hooks.ts`, `chat-drop` test, `skill-dialogs-and-row` test. | Jini +8 new (17 skills total). Tovu skills + AssistantDock 948/948. Mutations: tab default `"skills"`→`"add"` went red; `"SKILL.md"`→`"SKILL.mdx"` went red; both restored. | ✅ `8e9ef2c7` |
| C: content-analysis + webmcp | Opus high | content-analysis 4 + 3 split: `rules` (structural host-error read), `content-analysis-i18n` split into `content-analysis-i18n` (425) + `-rows-rtl-asia` (302), `hooks/content-analysis-port.hooks`, `hooks/use-content-analysis.hooks`, `ContentAnalysisCard` (required `useContentAnalysisHook`), and `createFakeContentAnalysisPort` (from the dependencies module). webmcp 3: `webmcp-i18n`, `BrowserAgentSettingsPanel` (required `useBrowserAgentSettingsHook`), `admin-page-tools` (agentic values plus `directPageAction`, enabled-check and warning injected into its existing args, K5). | `PostSavedPanels.tsx` (posts lane; import line + injected hook only), the `vi.mock` path in 4 posts tests, `SettingsUi.tsx` (settings lane; import line + injected hook only), `App.hooks.ts` (spreads `adminPageToolCollaborators`), `styles.css`/`editor.css` (+`jini-content-analysis-*` aliases). | Jini 4 files 80/80, plus my host-error test (3). Tovu 1045 pass (44 files). Mutations: i18n `buildDictionary` `===`→`!==` went red; `registerAdminPageWebMcpTools` first `if` negated went 4/4 red; mine, `status` number→string, went 2 red. All restored. | ✅ `8e9ef2c7` · `984f59e45` |
| D: fs-files + publish-content | Opus high | fs-files 1: `hooks/use-native-folder-picker.hooks` (`probe`/`pick`/`isDialogAlreadyOpen` became required fields of its existing `input`). publish-content: 0 (STOP, below). | `AssistantDock.state.hooks.ts` (import + 3 bound fields), `assistant-dock-props.tsx` (type import), `folder-chips` test. Tovu `fs-files-api.ts` gains `isFolderPickerBusyError` (409 only). | Jini 4/4 moved. New Tovu `fs-files-api` test pins the 409 mapping. Tovu 358/358 (18 files). Mutation: first `if` negated went 4 red, then restored. | ✅ fs-files `646fbc7c`; publish-content STOP |

**Coordinator fixes (my commits):**
- **Jini `226e14b2`:**
  - API baseline for the new subpaths.
  - `jini.isolation.entries` row `./screens/skills/use-skills-tabs.hooks: browser`. This cleared the guard SI-domain line; the tabs hook reaches `shell/lib/router`, like every `./shell/**` entry.
  - Six `hook-injection-debt.json` rows. Each has the same reason as the accepted `MenuPageLinkFields`/`TaxonomyRowMenu` rows: the hook is a REQUIRED prop, and the checker reads a required injected hook as a direct call.
  - The content-analysis host-error-shape test.
- **Jini `6b6028e7`:** export `./screens/content-analysis/content-analysis-i18n`.
- **Tovu `d60f35cf5`:** 18 why-comment allow rows.
  - 12 comments moved with the code, and I found each one in the Jini file.
  - 6 became obsolete: 4 documented defaulted test seams that the required-prop rule removed, 1 headed the deleted barrel, and 1 was reworded with the move. Each row says which.
- **Tovu `b434161c5`:** fixed 4 Tovu test reds my lane had caused (see Gates).

## Skipped / STAYS (exact reasons)
- **publish-content: all 14 lane files stay. STOP.**
  - Every file imports `@tovu/publish-content-ui`, directly or through its imports. K5-publish-content-ui-1 and its prerequisites (K5-publish-content-1, K4-publish-content-2, K4-seam-21) have not landed. `packages/admin/src/publish-content/` does not exist. P9F also lists those steps under the Deployment/Operations lane.
  - Even after that lands, `use-publish-content-confirm.hooks.ts` (1,319 lines; `usePublishContentConfirm` is about 815 lines) cannot enter Jini under the 500-line file and 80-line function limits, and no size exception is allowed.
  - It also needs `useWiredAdminLocale` (A-K2-shell-hooks-3) and `lib/admin-http` (shell-lib, w3-fnd).
  - **Recommendation:** owner decision. Either split `usePublishContentConfirm` behind a characterization suite in a dedicated step, or keep it as Tovu composition and inject it as a required hook prop into a moved `PublishContentDialog`.
- **skills: 12 files stay** (11 below, plus `skills.css`, which stays at the host mount per K5css).
  - `api.ts`: needs Tovu `authenticatedAdminRequest`/`WORKSPACE_ID` and the product event name. `listSkills()` has no args object, so injection would need a new args object (STOP).
  - `skill-failure.ts`: needs Tovu `ApiError`, `describeApiError` and `TOVU_ERROR_REDACTION_OPTIONS`. No args object that reaches it moves (K3 STOP).
  - `use-skill-install.hooks.ts`: AssistantDock calls it with no collaborators.
  - `use-skill-confirmation.hooks.ts`: the kit `useFocusTrap` needs an `AdminKitProvider` above every AssistantDock render.
  - `use-skill-files.hooks.ts`, `Skills.tsx`, `SkillRow.tsx`: need plugins code (`PackageFilesModal`, `agent-plugins-visuals`). A-K2-plugins-1/2/3 have not landed (add-ons lane).
  - `use-skills.hooks.ts`, `SkillRemoveConfirmDialog.tsx`, `SkillInstallConfirmation.tsx`: follow the files above.
  - `skills-visuals.tsx`: its only consumer is `SkillRow`, and it renders a plugins class.
  - The `useAdminThemeBoundary` K5 prop waits for `Skills.tsx`.
- **fs-files: 3 files stay.**
  - `api/fs-files-api.ts`: Tovu `lib/admin-http`. A-adm-shell-lib-1 and A-K2-shell-lib-4 (w3-fnd) have not landed.
  - `folder-drop-port.ts`: kit gap `FolderPathDropPort` (a type), plus the Tovu `window.tovuFiles` global.
  - `hooks/use-folder-drop.hooks.ts`: kit gaps `FolderPathDropPort` and `folderPathsFromDataTransfer`, the Tovu-kept port and api, and `useFolderDrop` is about 110 lines.
- **import-export: 4 files stay.**
  - `api/import-export-api.ts` and `api/import-export-api.types.ts`: Tovu `request`/`WORKSPACE_ID` in an object-literal module, with no args object.
  - `hooks/use-import-export.hooks.ts`: Tovu locale hook, `isDesktopAdmin` and the Sites collaborators. Two of its hooks take no args, so injection would need a new args object (STOP).
  - `hooks/use-git-backup.hooks.ts` is now host wiring only (`defaultGitBackupPort`, `useWiredGitBackup`).
- **content-analysis: 2 files stay, trimmed to host wiring.**
  - `hooks/content-analysis-dependencies.hooks.ts` keeps `defaultContentAnalysisPort` (Tovu `authenticatedAdminRequest`).
  - `hooks/use-content-analysis.hooks.ts` keeps `useWiredContentAnalysis` (`useAdminLocale`).
- **webmcp: 1 file stays.**
  - `browser-agent-settings.hooks.ts` owns the product storage key `tovu.admin.webmcp.enabled` and has no args object (K3 STOP). It reaches the panel as the required prop.
  - The 5 `admin-page-*` tests stay in Tovu, repointed. They pin Tovu's `directPageAction` table, which Jini cannot import. Jini got its own `admin-page-tools` suite with every collaborator doubled.
- **Kit gaps for lane w3-fnd:** `FolderPathDropPort` (type) and `folderPathsFromDataTransfer` (value), both currently from `@jini-ai/ui`.
- **Unblocking order for a follow-up lane run:**
  1. A-K2-0 kit gaps, A-adm-shell-lib-1/A-K2-shell-lib-4 (`admin-http`) and A-K2-shell-hooks-3, which unblock fs-files, import-export api, skills api and the content-analysis/import-export wiring.
  2. A-K2-plugins-1/2/3, for the rest of skills.
  3. K5-publish-content-ui-1, plus the owner decision above, for publish-content.

## Behaviour changes (tests first / named mutation)
- **content-analysis `rules.ts`.**
  - **Before:** `instanceof ApiError` (Tovu class).
  - **After:** a structural read: an `Error` with a numeric `status` and an optional string `code`.
  - **Effect:** a non-`ApiError` `Error` carrying both a numeric `status` and a string `code` now maps to the card copy. In Tovu only `ApiError` produces that shape.
  - **Tests:** Tovu's `ApiError` cases still pass through the repointed `content-analysis-rules` and `use-content-analysis` tests. Jini `__tests__/host-api-error-shape.unit.test.ts` (3 tests) pins the structural contract, including that a string `status` is ignored.
  - **Mutation:** `typeof status !== "number"` → `"string"` went 2 red, then restored to 78/78.
- **fs-files folder picker.**
  - The optional `deps.probe`/`deps.pick` defaults and the internal 409 check became required `input` fields bound by the host. Runtime behaviour is unchanged.
  - The new Tovu test pins `isFolderPickerBusyError` (409 true; 500, 404 and a non-`ApiError` 409 false).
- **Other changes are moves.** The rest are import, kit-facade, required-prop and class-rename changes.

## Gates: base (merge-15) vs final. No new red.
**Jini** (raw in the run scratchpad; diff of normalised outputs):

| gate | base | final | new lines |
|---|---|---|---|
| admin build / typecheck | 0 / 0 | 0 / 0 | — |
| `api:check` | 0 | 0 (994 entries; baseline updated) | — |
| `guard` | 1 violation (HW3 `shell-failure-log.ts`) | same 1 | only the advisory count of test-only cross-package imports, 504 → 505 (not failing) |
| XP (`check-no-cross-package --base <merge-15>`) | red (core vault XP4) | same | none |
| `check:size` / `check:complexity` / `check:why-comments` | red (launch.ts, sidecar stale debt, 4 complexity, 10 why) | same | none |
| `check:hooks` | ok | ok | 6 debt rows, all required hook props |
| admin vitest (full) | — | 317 files, 3742/3742 | — |

**Tovu:**

| gate | base | final |
|---|---|---|
| `typecheck` (+e2e) | 0 | 0 |
| admin `tsc --noEmit` | 0 | 0 |
| `check:complexity` / `check:hooks` / `check:boundaries` | 0 / 0 / 0 | 0 / 0 / 0 |
| `check:size` / `check:architecture` | red | identical output |
| `check:why-comments` | 78 blocks | 78 blocks (+18 verified allow rows) |
| admin vitest (full) | — | 9 failed / 14,408 passed before my fix; 4 of those were mine and are fixed |

Admin vitest detail:
- **Base-red (5), same failures at base:** `admin-literal-copy` 1 (collections `NewContentTypeDialog`), `credential-input-autocomplete` 1, `JiniMediaPicker.hooks` 3.
- **My 4, fixed in `b434161c5`:**
  - `narrow-content-column-css` ×2 and `external-mcp-tool-picker-css` ×1: they read rule text by exact selector. The original `.status`/`.editor-actions`/`.btn-secondary` rule text is restored, and the aliases are listed first or in a separate rule.
  - `untranslated-copy` ×1: the moved dictionaries rejoin the check through `@jini-ai/admin`, the same way the shell pair already does.
  - After the fix, the 40 style and lib test files gave 2,023 passed, 2 failed (both base-red).
- **CSS proof:** a postcss order-independent check found every one of the 1,476 base `styles.css` rules and all 82 `editor.css` rules intact. The only additions are `.jini-*` selectors and 1 jini-only rule.
- **Node tests:** no Tovu file outside `apps/admin` changed, so no node test is affected.

## Self-check before push
- **No re-export or forwarding files.** The import-export barrel was deleted, and importers point at the concrete modules or the mount. `panel-pages.ts` re-exports were there at base.
- **Custom hooks reach Jini components as REQUIRED props** (`ImportExport` ×4, `ContentAnalysisCard`, `BrowserAgentSettingsPanel`). No default hook is imported in Jini.
- **No disallowed imports in Jini:** no express, no console formatters, and no `@tovu/*`, `@jini-ai/ui`, `@jini-ai/ui-kit` or `@jini-ai/chat`.
- **`jini-*` classes only**, with Tovu aliases.
- **No size exceptions:** 0 new entries. The content-analysis dictionary was split.
- **Shared types:** `GatedPlan`/`Confirm` already sit in core. Git backup uses admin's own `source-control/models`.
- **Object args:** `_optional = {}` pads were kept.
- **Why-comments moved** with the code.
- **`## Wiring` sections** in all 5 touched feature READMEs.

## Follow-ups (not blocking)
- **Visual check of Import & Export.** Its generic `jini-page`/`card`/`btn`/`field`/`notice` classes get their look from `integrations/jini-admin/jini-media.css`, under `:is(.jini-page, .jini-dialog)`. That stylesheet covers fewer contextual selectors than the old `.btn-secondary` family, so look at the screen once in a browser.
- **Sites lane:** `features/sites/Sites.hooks.tsx:199` has a comment that cites the deleted `features/import-export/import-export-tabs.tsx`.
- **`dictionary-lookup-sinks.unit.test.ts:38`:** its ASSEMBLED row `features/skills/skills-i18n.ts:SKILLS_PAGE_DICT` is stale. The test still passes.
