PARTIAL 67cb6c6d06 75e265d8e: T-post-1 schemas+tool-metadata, A-adm-posts-1 (11 of 14 files), A-adm-posts-2, A-K2-posts-1/2/3, K5-post-1/2/3/4/6, RT-K1-adm-posts-1/2, RT-K1-pub-http-1, RT-K1-pub-content-1, V-post-5 and the P9F-check pub-site extras

# ex5 Posts lane (2026-11-22): Tovu `codex/ex5-posts-tovu`, Jini `codex/ex5-posts-jini`

This was an unattended cloud run that started at 23:08 UTC. Code tips: Tovu `67cb6c6d06` and Jini `75e265d8e`. Both branches were pushed with a plain `git push` after `git pull --rebase`. The run used no force-push, no `--no-verify`, no publishing and no tags, and did not touch `main`, `integ/*`, `plan/*` or `release/*`.

**Result.** Only two steps were READY in these bases:
- the narrowed **T-post-1.T** (B1)
- a dependency-free slice of **A-adm-posts-1**

Both landed. FILES-LEFT went from **2,486 to 2,481** (−5). Every other Posts step has at least one prerequisite that is not landed in these bases, and those steps are listed below.

Two moves were made and then **reverted** before the final gates, because the Jini guard flagged STOP conditions the sheets did not foresee (details below). All gates are equal to base. There are no new red tests.

## Setup
- **Bases:**
  - Jini: `origin/integ/merge-14-2026-11-22` = `4902a6a1a`.
  - Tovu: `origin/integ/merge-13-2026-11-22` = `f7185f153`. This is `0d7f78fa4` plus one docs-only commit, the combine-13 report.
- **Tools:** Node 24.22.3 (`/opt/node24`), pnpm 10.33.2.
- **Jini:** `pnpm install --frozen-lockfile` returned 0. `pnpm --no-bail -r build` returned 0, with 0 `error TS`.
- **Tovu:**
  - `npm ci --ignore-scripts` in root, admin, desktop and site-chat: 0/0/0/0.
  - `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs`: 0, with 82 links. This links **this run's Jini branch**.
  - `packages/contracts` tsc: 0. `packages/sdk` build: 0.
- **PostgreSQL:** not provisioned. The one PG-backed test that the change set selected is BASE-RED here for that reason.
- **Tovu base gates:** the 16-gate set from combine-13. They ran on a clean worktree at `f7185f153` that shares the main tree's `node_modules` (in `ex5-posts-raw/gates-tovu-base/`).
  - **`admin-tsc` is already red at base:** 4 errors, all `AdminKit` shape (`Icon`, `useT`, `values`). Jini merge-14 carries `A-K2-0a.J`, but this Tovu base does not have its host assignment `A-K2-0a.T`.
  - Tovu why-comments was compared with combine-13's final list, because the worktree run measured against a different terra base.
- **Jini base:** combine-14's `gates-final` (same content), plus `*_BASE_REF=4902a6a1` for the size, complexity and why-comments drift gates.

## Batches

| batch | subagent | files moved | importers repointed | tests | status |
|---|---|---|---|---|---|
| A: T-post-1 (narrowed T + remaining J) | opus-high #1 | **Tovu deleted:** `features/post/{post-before-save,slug,rendering}.ts`, plus the duplicate `features/post/__tests__/slug.test.ts`. The Jini copies and the Jini slug test were already landed. The 4 schema files were moved and then **reverted** (STOP, below). | **All sites on the narrowed sheet's list:**<br>• **`BeforeSaveHookPort` → `@jini-ai/cms/posts/post-before-save`:** 3 post tests, `post-tool-deps`, publish-content `{tool-deps, tool-registrations, tovu-publish-ports}` + hook-refusal test, widgets `deps` + 2 widget tests, `server/routes/types.ts`, `plugin-runtime.ts`.<br>• **Mixed imports:** `post-create`, `post-update`, `post-import` (`runBeforeSaveHook`, `withCoverPresentation`, `mergeExt`).<br>• **Slug → `@jini-ai/cms/posts/slug`:** admin `posts/rules.ts`, `agent-tools`, `post-slugs`, `post-update`, `post.derived-slug-limit.test`, `tiptap-doc-schema` (stays), `doc-nodes.ts`, `social-entries.ts` (ex-`rendering`).<br>• **Barrel lines deleted:** `contracts.ts` (the `BeforeSaveHookPort` re-export) and `index.ts` (slug and hook re-exports).<br>• `dev-lite.test.mjs` scan entry removed.<br>• 1 why-comments allow-list row (`ac059ae80d3e`, moved to Jini `post-before-save.ts`). | 141 node files run alone: **1,723 pass / 2 fail, both BASE-RED** (identical at `f7185f153`): `repo.postgres` (no PG) and `render.golden.characterization` (assistant/contact-form drift, 12/1). The sheet's 8 stay tests, both widget hook tests and the publish hook-refusal test are all green.<br>**Jini mutation** (narrowed sheet): `posts/slug.ts` `"untitled"` → `""` makes `slug.test.ts` go red 2/1. Restored by byte copy (`cmp`), then 3/3 green. | DONE (narrowed T). Schema J+T held by STOP |
| B: A-adm-posts-1 / A-adm-posts-2 ready slice | opus-high #2 | **Jini `packages/admin/src/posts/`:** `PostAuthorFields.tsx`, `PostPublishingFields.tsx`.<br>• Exports `./posts/PostAuthorFields` and `./posts/PostPublishingFields` (`browser`).<br>• The class renames are listed below.<br>• `post-editor-route-key.ts` + its test were moved and then **reverted** (STOP, below). | 5 sites:<br>• `PostSettingsDialog.tsx:8,9`<br>• `__tests__/post-author.unit.test.tsx:6`<br>• `__tests__/post-schedule-featured.unit.test.tsx:9`<br>• `__tests__/posts-i18n.unit.test.ts:7`<br>CSS selector renames are in `styles.css` and `styles/editor.css`. | **Admin vitest:** 98 files (changed tests + importers of changed files), **3,812 pass / 0 fail**, 2 skipped.<br>**Jini admin full suite:** 3,087/3,087 (= combine-14).<br>**Jini cms full suite:** 5,020/1. The 1 is the forms `package-boundary` changelog version check, BASE-RED and identical in combine-14 `suites/cms.txt`. | DONE (slice) |

**Class renames (B):**
- `editor-publishing-fields` → `jini-post-publishing__fields`
- `editor-publishing-field` → `jini-post-publishing__field`
- `editor-scheduled-badge` → `jini-post-publishing__scheduled-badge`

The renames apply to the Jini TSX and to the Tovu CSS selectors (`styles.css` 1084–1096, 1137, 6729–6732; `editor.css` 354–365). No Tovu test or snapshot references these classes.

**Not renamed: `field-label`.** It is the host's shared form-label class, used by about 10 other Tovu components. Renaming its selector would restyle all of them, and switching to Jini's `jini-field-label` changes styling. **Owner decision.**

### Commits
- **Jini:**
  - `5c87f9a82`: cms schemas, reverted.
  - `1ab59cce5`: admin slice.
  - `75e265d8e`: revert of the schema and route-key moves (guard STOP).
- **Tovu:**
  - `f01497e8c`: T-post-1.T.
  - `abd9418c7`: A-adm-posts-1.T slice.
  - `ba2c331a6`: why-comments allow-list.
  - `67cb6c6d0`: revert, which restores the schemas and route-key with their importers and keeps the doc schema's slug import on Jini.
- **Net diff:**
  - Tovu `f7185f153..67cb6c6d0`: 39 files.
  - Jini `4902a6a1..75e265d8e`: 2 moved files, plus 2 package.json entries, the admin API baseline (+2 entries) and changeset `.changeset/p9-a-adm-posts-1-leaf.md`.
  - Neither repo removes a `_optional` pad.

### STOP reverts (found by the Jini guard; reviewer please confirm the hold)
1. **Remaining T-post-1.J: `post-tool-schemas.ts` and `tiptap-{doc,block,text}-schema.ts`.**
   - `pnpm guard` R5-neutrality fails with `host tool name "content_read"` in `post-tool-schemas.ts:31,48` and `tiptap-block-schema.ts:128,167` (see `ex5-posts-raw/gates-jini-stop-guard.txt`).
   - These are LLM-facing schema descriptions that name the host's read tool, so this is STOP 2 and STOP 3 (assistant guidance wording).
   - Making them neutral means injecting the tool name or rewording model-facing text. Both are behaviour changes, and the verbatim step forbids them.
   - The files stay in Tovu, and the doc schema's slug import now points at `@jini-ai/cms/posts/slug`.
   - **Decision needed:** inject the read-tool name, or accept the reworded descriptions.
2. **`post-editor-route-key.ts` (A-adm-posts-1).**
   - Guard HW3-module-state fails twice: the module-level `renamedRouteKeys` Map and the `draftCount` counter.
   - Moving it needs instance-owned state, which is an API change. It is held in Tovu.

## Steps skipped and why
| step | blocker (not landed in these bases, or owner decision) |
|---|---|
| T-post-1 rest | The schemas need the R5 decision above. `contracts/core/tool-metadata/post.ts` holds owner approval policy (`ToolApprovalPolicy` classes) and product search copy. The fix sheet holds it until K4-seam-1.T and the owner-policy declarations clear; seam-1.T is not in this Tovu base. |
| A-adm-posts-1 (11 of 14 files left) | **(a) No `@tiptap/*` dependency in any Jini package.** Affects `bubble-menu-state`, `toolbar-state`, `toolbar-group-props`, `PostEditor.hooks` (type imports of `@tiptap/react`) and `use-post-url-dialog.hooks` (value import of `@tiptap/extension-youtube`). Adding tiptap to `@jini-ai/admin` is a new vendor dependency plus lockfile change, so it is an **owner decision**. It also gates the whole post editor (A-K2-posts-2/3).<br>**(b) Shared DTO still in Foundation.** `api/posts-api.types.ts` is the shared Posts DTO and FOUNDATION owns it (P9F-check). Its importers `PostDeleteConfirmDialog` and `posts-list-port.hooks` wait for it.<br>**(c) Unlanded Foundation prerequisites:**<br>• `PostEditorTemplatePicker` needs `ViewTemplateButton` (A-adm-shell-components-1).<br>• `use-post-editor-ui.hooks` needs `unchanged-save-warning` (A-adm-shell-lib-3).<br>**(d)** `post-editor-route-key` is the HW3 STOP above.<br>**(e) `post-url-dialog.css`.** Jini admin has no pattern for component-local CSS, and renaming `.post-url-dialog` needs `PostUrlDialog.tsx`, which stays (STOP 6). |
| A-adm-posts-2 | `ToolbarCharacterCount` needs `toolbar-group-props` (tiptap). `ToolbarOverflowMenu` needs `use-post-editor-ui`. |
| A-K2-posts-1 | Needs A-adm-shell-lib-1/4, A-K2-shell-lib-4/6, A-K2-shell-hooks-1, A-K2-media-1, A-adm-themes-1 and A-adm-shell-lib-2. `PostEditorActions.tsx`, the only file that is a leaf, needs the kit `Icon` from A-K2-0a. That is landed in Jini, but its host assignment A-K2-0a.T is not in this Tovu base (`admin-tsc` is BASE-RED on exactly that). |
| A-K2-posts-2/3 | Needs A-K2-pages-1/2/3, A-K2-shell-components-3/5/8/9/11, A-K2-shell-lib-2/6/7, A-K2-shell-hooks-1/3, A-adm-shell-hooks-1, A-K2-content-analysis-1, A-K2-taxonomy-2, A-K2-publish-content-1 and theme hooks (host-injected), plus the tiptap decision. |
| K5-post-1/2/3/4/6, V-post-5 | `contracts/core/post-kind.ts` (K5-contracts-core-3), `platform/routing` (K5-platform-routing-1), `contracts/core/commands` (K5-contracts-core-6), K4-seam-3/5 (`Tracker` and `GuideTopic` into core), V-media-3, the publish-content K5/K4 steps, and K5-presentation-1 and the theme bindings (K5-post-6). The K5-post-1 leaves `capability-card.ts` and `go-live-sweep.ts` would add cms→agentic and cms→diagnostics imports (XP3) until K4-seam-5 and K4-seam-3 land. |
| RT-K1-adm-posts-1/2, RT-K1-pub-http-1, RT-K1-pub-content-1 | Need K5-post-1, V-post-5, K5-contracts-headless-2, RT-K1-adm-content-1, RT-K1-adm-plugin-hook-error-1, V-contracts-core-9 and K5-members-1/V-members-3. RT-K1-adm-posts-2 also needs the theme and pub-site sheets. |
| P9F-check extras (bare-page, post body/widget, listing state and batch, post previews, post and post-not-found handlers) | Every file imports at least one unlanded sheet: `render-context`, `content-html`, `post/contracts` (K5-post-3), `R-public-http-1`, `C-platform-html-1` escape, theme K5 steps or `scheduled-publish`. |

## Gates (final vs base; raw in `ex5-posts-raw/`)

**Tovu** (`gates-tovu-final/` vs `gates-tovu-base/`):
- **Exit codes:** all 16 are identical. size 1, admin-tsc 2 (BASE-RED, the AdminKit host gap), typecheck-scripts 2, why-comments 1 and architecture 1 are red at base; the rest are 0.
- **Content:**
  - size, admin-tsc, typecheck-scripts, errors, complexity and hooks are byte-identical after normalising timings.
  - boundaries: same 112 warnings; the module count drops 6773 → 6769.
  - architecture: same exit. cross-feature edges 309 → 307, API surface 687 → 686, hubs 313 → 311. No regressed metric.
  - why-comments: 81 rows against combine-13's 80. The single extra row is `development/scripts/check-route-coverage-diff.ts:161`, which this run did not touch: `origin/refactor/terra` moved since combine-13. The only row this run caused, `ac059ae80d3e`, is allow-listed.

**Jini** (`gates-jini-final/` vs combine-14 `gates-final`):
- **Builds and typecheck:** cms and admin build 0. `typecheck` 0.
- **`pnpm guard`:**
  - At the code tip it is 0, with the same 7 `[guard]` lines as base.
  - At `1ab59cce5`, before the revert, it was 1 (the STOPs above).
- **`api:check`:** 0, with 697 entries (+2: the two admin posts subpaths).
- **Ratchets:**
  - size and complexity: identical to base (BASE-RED rows only), with `*_BASE_REF=4902a6a1`.
  - hooks: 0.
  - why-comments `--base 4902a6a1`: 0, with 0 lost.
  - why-comments default (terra): the same 10 rows are not allow-listed.
- **`check:cross-package`:** XP1 39 / XP2 33 / XP3 2050 / XP4 760 / XP5 6, identical to base. This run did not build the declaration snapshot, so the XP3 figure is the "required" noise, the same as combine-14's unsnapshotted base.
- **log-safety and error gate:** identical to base.

## FILES-LEFT (`plans/P9-data/tools/{scan,plan}.mjs` from `origin/plan/whats-left-1122`, on clean worktrees)
| tree | moving | shells | FILES-LEFT | excl. theme areas (111) | post / adm-posts areas |
|---|---|---|---|---|---|
| base `f7185f153` | 2,483 | 3 | **2,486** | **2,375** | 51 / 59 |
| tip `67cb6c6d0` | 2,478 | 3 | **2,481** | **2,370** | 48 / 57 |

The −5 are `post-before-save`, `slug`, `rendering`, `PostAuthorFields` and `PostPublishingFields`. Raw output is in `ex5-posts-raw/files-left.txt`.

## For the reviewer / owner
1. **The tiptap decision gates most of the Posts editor.** No Jini package depends on `@tiptap/*`. Choose one:
   - add an optional `@tiptap/*` peer to `@jini-ai/admin`, which needs a lockfile change;
   - put the editor pieces under a package that owns tiptap;
   - replace the `Editor` type imports with a structural type.
2. **R5 `content_read` in the post schema descriptions:** inject the host read-tool name, or approve neutral wording (a behaviour change to the model-facing text).
3. **`post-editor-route-key`:** stays in the host, or gets a Jini instance-owned version (an API change; tests first).
4. **`field-label`** in the moved `PostAuthorFields` and `PostPublishingFields` is the host's shared class. Keep it, or switch it to `jini-field-label` with a style check.
5. **Registry gate:** Tovu's lockfiles still pin the registry `0.7.3-next.2` artifacts. Merge this only with a linked Jini build, or after publishing artifacts that contain `./posts/PostAuthorFields`, `./posts/PostPublishingFields` and the merge-14 APIs.
