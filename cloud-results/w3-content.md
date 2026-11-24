PARTIAL 4fef8f1676 26f395c95: lane steps blocked on owner holds (tiptap, R5 content_read, K4i i18n > 500 lines, HW3), missing Core owners (content-kernel, publish ports, tool-metadata/post, chat-attachment contracts) and big screens not yet split (MenuEditor, Collections/CollectionEntries/CollectionEntryEditor, PostEditor actions/header); 3 inherited log-safety rows in Jini route specs (w3-rtfnd) — see "Skipped"

# w3-content — Library, Media, Posts, Collections, Taxonomy, Menus, Widgets, Forms, Comments (wave 3, 2026-11-23/24, unattended)

- Branches: Jini `codex/w3-content-jini` (code tip `26f395c95`), Tovu `codex/w3-content-tovu` (code tip `4fef8f1676`). Plain `git push`, never forced.
- Programmer skills: `AI-Dev-Shop/agents/programmer/skills.md` read before work (v1.7.5: base skills, inner loop, architecture audit, pre-completion checklist, coverage/function-quality self-checks).
- Base: `origin/integ/merge-15-2026-11-23` (Jini `0a44b54c`→`60c6cd52a`, Tovu `bd89a2aa8`→`33701312a1`). Merged its latest head again mid-run (Jini `e92183290`, Tovu `9a35d9dfce`).
- Prior branches merged on top: `codex/ex7-media-posts-{jini,tovu}` and `codex/ex7-coll-small-{jini,tovu}` (all four existed; none skipped).
  - Conflicts: JSON shared files were union-merged (package exports, api-baselines, why-comments debt). The virtual merge base was unparsable, so the union ran without a base. That re-added 2 cms exports whose sources merge-15 deleted and stale api-baseline rows. Both were fixed later: Jini `c1b0166ed` dropped the exports, and `0adee1e5f`/`26f395c95` regenerated the baselines.
  - Code conflicts took the newer Jini owner: nav/trash/content-type-store/FormDeliveryConnectionPort.
  - modify/delete: the 3 Tovu tool-metadata copies stay deleted (moved to Core), and the 3 forms route files stay deleted (moved to cms specs). merge-15's object-arg projection change was carried into the Jini specs (Jini `fix(cms): forms route specs call the projections with their object args`).
- Linked Jini into Tovu with `link-jini.mjs`. The container restarted twice; 5 in-flight subagents were re-dispatched from the checkpoints.
- Method: Opus coordinator, Opus-high subagents (≤4 at a time), and a shared brief with the self-check. Subagents never committed; the coordinator committed per batch plus `wip(w3-content)` checkpoints every ~5–10 min (repo standing rule 2).
  - **Lesson:** one checkpoint captured a planted mutation (`bcb8e5528c`). It was restored in the next batch commit, and all later mutations were planted, tested and restored inside one command.

## FIX items (rv1123*, verified against current code)
| Review / item | Status |
|---|---|
| rv1123a ex5-posts FIX 1 (agentHandle injected) | already satisfied (required prop; PostSettingsDialog passes Core `agentHandle`) |
| rv1123b ex5-collections FIX 1 (C5 named mutations) | applied — M1–M9 recorded on entries/content-types/taxonomy site slices, all red→restored→green; plus M10–M13 on the new api clients |
| rv1123b ex5-collections FIX 2 (taxonomy row-menu tone classes) | already satisfied |
| rv1123b ex5-collections FIX 3 (args rule entries/contracts, taxonomy/content-targets) | already satisfied |
| rv1123b ex5-small FIX 1 (ip-hash-salt warn port, runtime-mode Core subpath) | already satisfied |
| rv1123b ex5-small FIX 2 (MenuPageLinkFields required hook, jini classes) | already satisfied |
| rv1123b ex5-small FIX 3 (Forms projections object args) | applied in the Jini forms route specs (merge carry) |
| rv1123b ex4-media FIX 1 (image-ops test, flatten key, settings ports, errorPrefix) | already satisfied |
| rv1123b ex4-media FIX 2 (theme freeze: `features/theme/__tests__/publish-content.apply.test.ts`) | **not applied — owner decision.** Restoring the base content would need a forwarding re-export of `InMemoryMediaContentTypeStore` from `features/media/index` (forbidden). Recommendation: approve the import-only repoint to `@jini-ai/cms/media/site/content-type-store`. |
| rv1123g ex7-media-posts-jini FIX 1 + tovu FIX 1 (tb-more → jini class + data attr; host selectors) | applied: `jini-post-toolbar__more` + `data-toolbar-more`. Test added at 280px; mutation "overflow-selector-revert-to-tb-more" went red |
| rv1123g ex7-media-posts-jini FIX 2 (useEditMediaModal object args, helpers bound by host) | applied; mutation "open->close swap" went red |
| rv1123g ex7-media-posts-tovu FIX 2 (14 moved why-comment IDs) | applied (rationale confirmed in Jini, 14 rows) |
| rv1123g ex7-coll-small-jini FIX 1 / tovu FIX 3 (204 via JSON) | applied: http-kit answers 204/205/304 with `end()`. Red-first test; Tovu mounted no-content assertions for moderate/purge and taxonomy empty assign. Mutations M1/M2 "204-through-json" |
| rv1123g ex7-coll-small-jini FIX 2 (7 stored-error-text sites) | applied to all 7 plus entity-not-live and import-media-entity, via the required `outwardErrorMessage` port (`cms/admin-http/http/outward-error-message.ts`). Tovu binds `({error}) => error.message`. One mutation per site |
| rv1123g ex7-coll-small-tovu FIX 1 (menu-authored-html theme test) | applied: test restored byte-for-byte. **The navigation barrel `features/navigation/index.ts` is restored byte-identical to merge-15 and HELD pending owner approval of the import-only repoint** |
| rv1123g ex7-coll-small-tovu FIX 2 (41 why-comment IDs) | applied: 3 blocks restored, 33 rows; 5 barrel IDs not lost (barrel held) |

## Batches (all Opus-high subagents; commits are the batch commits, wip checkpoints in between)
| batch | files moved (Tovu → Jini) | importers | tests | status |
|---|---|---|---|---|
| posts-1/2/3 (admin) | 13: posts-api.types, PostDeleteConfirmDialog, posts-list-port, use-post-editor-ui, PostEditorTemplatePicker, PostUrlDialog(+css), PostSettingsDialog, ToolbarCharacterCount, posts-api (`createPostsApi`), PostEditorTemplateModalGate | ~100 import-only repoints (posts, pages, dashboard, lib tests) | Jini posts 47 ✓; Tovu posts+pages 806 ✓; 7 named mutations | done (jini-* classes + Tovu twins) |
| media-1…6 | 18: where-used, purge-media, analytics, contracts, list-pending-chat-attachments, provider-credential-contracts, view-image-tool, media-generation catalog builder, duplicate-asset, media-import catalog builder (cms); AdminMedia → Core `contracts/site/cms-admin-media`; media-port, library rules/Library.hooks/library-port/use-library, grid-size + useMediaGridSize (admin) | ~90 | Tovu media node 303 ✓, admin media 294 ✓; mutations M1–M3, dup/import seams | done; R5/HW3/N1 guard lines fixed |
| colltax-1…4, taxonomy-2, coll-5, coll-dialogs, menus-editor | 40: taxonomy/menus/collections api clients; taxonomy rules + 9 hooks (split useTaxonomy/useTermPicker), TermPicker, Taxonomy (+TermList/DetailPanel split); collections 5 ports, rules (kit), 6 hooks, LifecycleConfirmDialog, NewContentTypeDialog, EditFieldsDialog, ContentTypeFieldsSection; menus port, useMenus, Menus, useMenuEditor (split into 4 modules) | ~80 | Tovu taxonomy/collections/menus 2392 ✓ / 365 ✓ / 211 ✓; Jini 24+34+31; ≥15 named mutations | done for these files |
| wfc-1…4 | 11: widgets/forms/comments api clients + panel modules (`useModulePanel` injected); forms rate-limit-profile, analytics-provenance, form-file-storage; comments types, data-module-install (cms site) | ~40 | Tovu admin 125 ✓, website forms/comments ✓ | done |
| post-site-1/2 (website) | 12: post, expected-version, go-live-sweep, post-write-fields, search, post-tool-errors, post-read, post-write-effects, featured-image, post-slugs, post-tool-views (cms); PostKind and scheduled-publish → Core (`@jini-ai/core/scheduled-publish`, moved out of `contracts/` for XP4) | ~250 import-only (incl. 55 route files, import line only) | post+seo node 945/950 (reds = env) | done |
| guardfix, whycomments ×3 | 0 moves: L5/L1/L3/SI-domain/HW3 cleared (admin kit, injected shell/media collaborators); why-comment rows 14+33+35+26+8, restorations | — | Tovu taxonomy/posts/pages/menus/library/collections 2392 ✓ | done |

Total this run, about 104 production files moved into Jini (plus about 25 tests). Every Tovu original was deleted and its importers repointed; there are no forwarding shells. The exception is the held navigation barrel, which is pre-existing and restored for the theme freeze.

## Skipped, with exact reasons
- **Owner holds:**
  - Anything importing `@tiptap/*`: PostEditor.hooks, bubble-menu-state, toolbar-state/group-props, use-post-url-dialog, the post toolbar groups, posts `rules.ts` (562 lines, `EditorView`).
  - R5 `content_read`: post-tool-schemas, tiptap-block-schema, capability-card.
  - HW3: post-editor-route-key.
  - K4i: `*-i18n.ts` over 500 lines (posts, media, library, taxonomy, collections, menus, widgets, forms, comments).
  - Theme freeze: see ex4-media FIX 2 above.
  - X-widgets-1 `media-html-log.ts` (host console reporter) stays.
- **Missing neutral owners or ports (recommendation in brackets):**
  - content-kernel / ContentDatabase: every `repo.sqlite`, search-index, form-file-maintenance/purge, submission-ip-expiry-sweep.
  - Host publish ports (`TovuPublishPorts`): `*/publish-content.ts`, verify-published-media.
  - `tool-metadata/post`, `human-confirm`, `contracts/headless` (CHAT_ATTACHMENT_REF_PATTERN), daemon attachment runtime: promote/read-chat-attachment, view-video-tool, library-save-attachment, image-transform tool. [add a run-attachment lookup port next to Core `daemon-http`]
  - `@jini-ai/agentic` is not a cms dependency: forms/widgets capability-card. [owner: allow the dependency or inject]
  - Comments provider-selection/settings/builtin-provider need capability-providers / cookie-consent / user-management registry ports.
  - post `repo.memory`: injecting `invalidateMediaAccessEvidence` touches 562 `new InMemoryPostRepo({})` calls in 185 files. [one codemod in a quiet window]
  - Media provider-credential vault/store/repo: security-sensitive adapter plus `@jini-ai/db`. [its own step]
  - `media/tool-registrations` + `public-urls`: `buildMediaRegistrationsForTovu` (N1) and route importers owned by w3-rtfnd.
  - `use-media-tabs` is not on the lane list, and media rules use media-i18n.
- **Budget (ready next, pattern established):**
  - MenuEditor.tsx (527 lines, tab-strip → kit).
  - Collections.tsx, CollectionEntries, CollectionEntryEditor (split + twins).
  - PostEditorActions/Header: ~16 host classes shared with PageEditor. [joint twin pass with the pages lane]
  - post `post-import` was moved, then reverted when the run was killed; still in Tovu.
- **Routes:** all RT-K1-* conversions belong to lane w3-rtfnd and were not touched. Import-line repoints and passing the injected collaborator were done in 4 route files (entity-not-live `outwardErrorMessage`).
- **Shared design classes:** moved screens still emit host design classes (`card`, `btn-*`, `field-*`, `notice`, `settings-*`) where earlier Jini screens already do. Feature classes are `jini-*` with twins. [one dedicated twin pass: `btn-secondary` alone is in 63 rules]

## Gates (base = merge-15 worktrees; raw outputs in the session scratchpad)
- **Jini:**
  - Build, api:check, typecheck, check:hooks: exit 0.
  - Same as baseline: guard (23 lines; only the test-only advisory count moved, 504→505), check:size, why-comments (10 IDs), cross-package (2936 lines), complexity (6 errors, the same ones; warnings only went up).
  - **log-safety 14→16:** 3 `[stored-error-text]` rows in the cms route specs `admin-http/routes/media/delete.ts`, `media/import-url.ts` and `posts/get-by-id.ts`. They were inherited from the merged ex7 lane branches and are owned by w3-rtfnd. The run removed 3 rows (entity-not-live plus 2 post rows) and 16+ stored-error rows in moved code.
- **Tovu:**
  - `npm run typecheck`, admin `tsc`, `tsc -p tsconfig.tests.json`: 0 errors.
  - why-comments: 79 red = the merge-15 baseline (691+8 allow rows).
  - Admin vitest: 864 files, 14483 pass, 4 files red:
    - JiniMediaPicker.hooks and credential-input-autocomplete are BASE-RED (combine-15 report).
    - app-sites-section-visibility timed out and was green on rerun.
    - narrow-content-column-css was ours; fixed in `80f4fe68b0` and green on rerun.
  - Node tests on the 246 changed website test files: 224 green, 22 red.
    - 18 fail only on `RegExp.escape is not a function`, because the container has Node 22 and the repo targets Node 24.
    - 1 has no Postgres socket.
    - 3 (resolve-html-page-embeds, content-post-get-by-slug, forms-submit log-copy) are also red on the merge-15 worktree.

## FILES LEFT (`plans/P9-data/tools/scan.mjs` + `plan.mjs`)
| tree | moving | excl. themes |
|---|---|---|
| merge-15 `33701312a1` | 2,269 | 2,158 |
| w3-content (scanned at `~a4b12ff620`, before the last dialogs/post-tools commits) | **2,131** | **2,020** |
| Δ | −138 | −138 |
