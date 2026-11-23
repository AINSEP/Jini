PARTIAL d7659907dd 106dcdeec: every remaining Library/Media/Posts step is blocked on the foundation seams/inject Tovu halves (not mergeable here), in-flight branches' files, or owner holds (tiptap, R5 `content_read`, HW3 route-key, K4i COMMON_I18N, put-providers copy) — see "Steps skipped"

# ex7 — Library, Media + Posts (continuation, 2026-11-23)

This was an unattended cloud run (Opus coordinator, 9 subagent batches). It continued the 11-22 lanes `ex4-media` and `ex5-posts` on top of a provisional foundation.
- **Moved:** 15 Tovu production files are now in Jini, plus 3 tests that moved with them.
- **New Jini route specs:** 7 K1 specs, with 6 new Jini test files written first.
- **Gate fixes:** 2 guard SI-domain fixes and 1 `jini-*` class fix that this run's self-check found.
- **FILES-LEFT:** 2,385 → **2,370 (−15)**. Without the theme areas: 2,274 → 2,259.
- **No new red** in any Tovu gate.
- **Jini gates:** equal base except log-safety: +4 `stored-error-text` entries (8 occurrences) in moved code. Codex should look at that (see Gates). One of them is in `media/site/import-media-entity.ts`, from B3's move; the other three are in the new route specs.

## Branches and SHAs (plain `git push` after `git pull --rebase`; no force, no `--no-verify`, no tags)
- **Jini `codex/ex7-media-posts-jini`** (base `origin/integ/merge-14-2026-11-22` 4902a6a1a + merges, provisional base `a6497a89d`):
  - `f64db1f04` B1 A-K2-media-1: use-edit-media-modal
  - `16c90c694` B2 post notices + ToolbarOverflowMenu
  - `7760fba42` B3 K5-media-1: import-media-entity
  - `7bc3108c5` api-baseline key order
  - `a15bed2e2` B5 RT-K1 media get-providers/delete/trash
  - `f6e0c4e61` W2c media card hooks
  - `5f7c1f0a3` docs: Wiring sections
  - `284d3c560` W2a RT-K1 media where-used/import-url
  - `7c6bf384e` W2b RT-K1 posts list/get-by-id
  - `218dad537` fix: sha256 injected
  - `edd1594f7` fix: admin isolation domains
  - `106dcdeec` fix: `jini-*` classes
  - The copy of this report is committed on top of these.
- **Tovu `codex/ex7-media-posts-tovu`** (base `origin/integ/merge-13-2026-11-22` f7185f153 + merges, provisional base `9a0d7d4c4`):
  - `3c3981cead` B1
  - `8f0d8cddd0` B2
  - `fcea30e01b` B3
  - `3ab08151a0` B5
  - `c12f35a9bf` W2c
  - `7f883cc91e` W2a
  - `6f2cfd66f4` W2b
  - `f7925ac09d` fix: sha256 binding
  - `d7659907dd` fix: `jini-*` class CSS twins and snapshots
  - This report and `cloud-results/ex7-media-posts-raw/` are committed on top of these.

## Provisional foundation (merged before branching)
- **Tovu merged:**
  - `ex4-media-tovu`: fast-forward.
  - `ex5-posts-tovu`: why-comments JSON union.
  - `ex2-tovu-halves`, `ex2-holds-tovu`, `ex5-fnd-routes-tovu`: JSON union.
  - `ex5-fnd-kit-tovu`: 3 files resolved by hand toward both sides:
    - `lib/admin-http/settings-api.ts` keeps the halves' location and relative config/request imports, plus the kit's Jini `settings-effective-reads`.
    - `use-pages`/`use-posts` unit tests take the halves' `settingsApi` path and the kit's Jini `content-refresh-bus`.
- **Tovu SKIPPED (non-trivial):**
  - **`ex5-fnd-seams-tovu`:** it deletes 9 `contracts/core/tool-metadata/*` files that `ex2-tovu-halves` edited (K4-seam-1.T approval). It also has a UU conflict in `features/media-import/tool-registrations.ts`.
  - **`ex5-fnd-inject-tovu`:** 47+ conflicting files against seams and halves (`tool-metadata/*`, `assistant/tool-approval-policy.ts`, `routes/{pages,posts}/{create,update}.ts`, …).
- **Jini merged:** `ex4-media-jini` (fast-forward), `ex5-posts-jini`, `ex5-fnd-kit-jini`, `ex5-fnd-seams-jini`, `ex5-fnd-routes-jini` and `ex3-c0b-jini`. `package.json`/api-baseline conflicts were resolved with a JSON-aware 3-way union.
- **Jini SKIPPED:** `ex5-fnd-inject-jini`. It has 20+ conflicting files against seams (`core/contracts/site/*`, `chat/core/events.ts`, `api-baseline/jini-ai__diagnostics.json` `Tracker`, …).
- **Base reds introduced by this provisional combination** (equal at tip):
  - Tovu `typecheck`, `typecheck:tests` and `typecheck:scripts` exit 2. The cause is `plugin-tier2/worker.ts`: `Tier2ImportPolicy`/`importPolicy` are missing from the linked Jini `@jini-ai/plugins`.
  - Tovu `complexity` exit 1.
- **Setup:**
  - Node 24.22.3 (`/opt/node24`, downloaded); pnpm 10.33.2.
  - Jini: `pnpm install --frozen-lockfile` 0, `pnpm --no-bail -r build` 0.
  - Tovu: `npm ci --ignore-scripts` in root, admin, desktop and site-chat: 0/0/0/0. `link-jini.mjs` (82 links, to THIS Jini branch) 0. `packages/contracts` tsc 0. `packages/sdk` build 0.
  - The Jini clone was unshallowed so that `check:cross-package` could resolve `35c4961af`.
- **Base attribution:** clean worktrees at the provisional bases, sharing the same `node_modules` and Jini link.

## Batches
| batch | subagent | files moved (Tovu → Jini) | importers repointed | tests | status |
|---|---|---|---|---|---|
| B1 A-K2-media-1 | opus-high | `features/media/hooks/use-edit-media-modal.hooks.ts` → `admin/src/screens/media/hooks/` (K2: dialog helpers from `useAdminKitValues()`), plus its test (8→9 cases; +1 kit-seam case) | `Media.tsx` | Jini 9/0. Tovu admin media + posts + literal-copy: 54 files, 1067/1. The 1 is `admin-literal-copy` (collections placeholders), BASE-RED. | DONE (slice) |
| B2 A-adm-posts-2 / A-K2-posts-1 | opus-high | `posts/editor/notices/{PostAutosaveRecoveryBanner,PostAutosaveStaleBanner,PostVersionConflictBanner}.tsx`, `posts/editor/toolbar/ToolbarOverflowMenu.tsx` → `admin/src/posts/editor/…`. K5: message builders are REQUIRED props; generic conflict/stale types; structural overflow state. | `PostEditorNotices.tsx`, `Toolbar.tsx` | Jini tests written first: 5 cases, plus a 4-mutation set. Tovu PostEditor DOM characterization 76/76 after the class fix. | DONE (slice) |
| B3 K5-media-1 | opus-high | `features/media/import-media-entity.ts` → `cms/src/media/site/` | `publish-content.ts`; 3 host tests (import lines + `sha256` binding) | Jini 4/0 (3 characterization cases + 1 injection case). Tovu import-media-entity 23/0, render 2/0, rethrow 1/0. publish-content apply 23/0, characterization 7/0, overwrite 16/0, write 18/0. | DONE (slice) |
| B4 K5-post-* | opus-high | none | — | — | SKIPPED (see below) |
| B5 RT-K1-adm-media-1/2/3 | opus-high | `routes/media/{get-providers,delete,trash}.ts` → `cms/src/admin-http/routes/media/` as `defineJsonRoute` specs, plus `shared.ts` | Registrars in `runtime/composition/modules/media.ts` (`mountAdminJsonRoute`, per-request dep closures); 7 route tests repointed (import lines only) | Jini 17 cases, tests first. All 19 Tovu media route test files green, e.g. failures matrix 81/0, providers 17/0, delete 7/0, trash 7/0. | DONE (slice) |
| W2a RT-K1-adm-media | opus-high | `routes/media/{where-used,import-url}.ts` → specs. `authorizeMediaOrForbid` keeps each route's own 403 body. | `modules/media.ts`; `mediawidget-where-used.test`, `media-route-failures`, `import-url.test` (imports only) | Jini 20 cases. Tovu where-used 5/0, import-url 5/0, failures 81/0. | DONE (slice) |
| W2b RT-K1-adm-posts-1/2 | opus-high | `routes/posts/{list,get-by-id}.ts` → `cms/src/admin-http/routes/posts/` | Registrars in `modules/content.ts`. The authorize params stay `{principalId, permission, workspaceId}`: the spec's `entityType` is dropped so that a resource-scoped grant cannot newly match. `panel-access.unit.test` evidence now reads the built Jini guard `shared.js`. | Jini 9 cases. Tovu posts routes: all 10 files green (read-routes 3/0, update 24/0, …). panel-access 43/2; both reds (database, redirects) are BASE-RED. | DONE (slice) |
| W2c A-K2-media-1 | opus-high | `features/media/hooks/use-media-card-{metadata,details}.hooks.ts` + 2 tests → `admin/src/screens/media/hooks/`. K4 structural slice `MediaCardMetadataSource`, plus a generic item, instead of the FOUNDATION `AdminMedia` DTO. | `Media.tsx` | Jini 15/0 + 2/0. Tovu admin media 24 files 294/0. | DONE (slice) |
| Docs | sonnet-xhigh | `## Wiring` sections in `cms/src/media/site/README.md` (extended), `cms/src/media/site-transform/README.md`, `platform/src/object-store/site/README.md`, `admin/src/posts/README.md` (extended) | — | — | DONE |

**Named mutations** (`ex7-media-posts-raw/mutations.txt`): each one is red, then restored by byte copy (`cmp`) and green again.
- **B1:** the open path bypasses `openLightboxDialog` → 2/9 red.
- **B2:**
  - Conflict banner's Load-latest wired to dismiss → 1/4 red.
  - Stale-basis message dropped → 1/4 red.
  - Recovery message without `serverUpdatedAt` → 1/4 red.
  - Overflow `aria-expanded` inverted → 1/1 red.
- **B3:** invert the bytes guard → 3/3 red. **Fix:** skip the injected `bytesMatchSha256` → 2/4 red.
- **B5:**
  - get-providers wraps `{data}` → 2/4 red.
  - delete 409→400 → 1/6 red. **Tovu consumer:** the same plant in the linked dist makes `delete-route.unit` 6/1 red.
  - trash `not-found` flip → 1/7 red.
- **W2a:**
  - where-used 403 code → 1/5 red.
  - import-url without `successStatus: 201` → 1/15 red.
  - import-url without trim → 1/15 red.
- **W2b:**
  - `content.read`→`content.write` → 2/9 red.
  - Drop the 404 mapping → 1/5 red.
- **W2c:**
  - Separator `' · '`→`' - '` → 2/15 red.
  - `openDetails` no-op → 1/2 red.

## Self-check against the 11-22 Codex findings
1. **Re-export/forwarding files:** none. No `export … from` in any new Jini file, and no Tovu shell left.
2. **Hooks as REQUIRED props:** the moved Jini components take only values and functions as required props. The moved Jini hooks read the host kit (`useAdminKitValues`) or nothing. No default hook.
3. **Express / console / host log formatters in Jini:** none.
   - The import-url egress diagnosis log stays in Tovu `modules/media.ts`.
   - The route specs throw `RouteRefusalError`, which the host's `adminJsonRoutePorts` maps.
4. **`jini-*` classes:** FIXED in this run. The moved notices render `jini-post-notice(--warning|--error)` and `jini-post-notice__btn`; the overflow toggle renders `jini-post-toolbar__btn`. Tovu `styles.css` gives every global `.notice*`/`.btn-secondary`/`.tb-btn` rule a twin selector.
   - **Proof:** the 49 changed PostEditor snapshots reverse to the old file byte-for-byte when the 4 class substitutions are undone.
   - **One exception:** `tb-more` stays on the toggle, with a comment. The AVOID host hook `use-post-editor-ui.hooks.ts` measures `.tb-more`.
5. **Debt and exception lists:** no new entries in either repo. Size, complexity, error and log-safety debt files are untouched.
   - **Why-comments allow-list:** I tried to add the 7 rows for B1–B3. The run's permission classifier REFUSED it as oversight-sensitive, so I did not work around it. The 14 moved-block IDs are listed below for the reviewer.
6. **Shared wire types:**
   - No feature took a shared DTO. `posts-api.types`, `media-api.types`, `users-api` and `AdminMedia` stay with FOUNDATION.
   - W2c uses the K4 structural-slice rule.
   - The route specs restate small deps types and import only core contracts plus cms's own `MediaRecord`.
7. **Named mutations:** recorded for every behaviour-changing slice (above).

## Steps skipped and why
- **Foundation halves not mergeable here.** Tovu seams/inject and Jini inject conflict with halves and seams (see above). These files still need them:
  - `contracts/core/post-kind.ts` (K5-contracts-core-3; `PostKind` includes `"email-template"`, and no Jini type matches it).
  - `contracts/core/tool-metadata/{media,post,media-generation}.ts` (K4-contracts-core-5).
  - `contracts/core/{scheduled-publish,commands,assistant-content-guidance}`.
  - `platform/db/content-kernel`.
  - `platform/secrets/vault-kinds` (product-named `parseTovuStoreMeta`/`createTovuStoreVault`).
  - `features/webhooks` `SealedSecret`.
  - `features/publish-content/media-references` (P-publish-content-1; it blocks X-media-1's `where-used.ts`/`purge-media.ts`).
  - This blocks all of K5-post-1/2/3/4/6, V-post-5, K5-media-1 (rest), K5-media-2/4, V-media-3, K5-media-import-1, K5-media-generation-1 and K5-object-storage-1. B4's report has the per-file chain: every post file reaches `post.ts`, and `post.ts` needs `PostKind`.
- **In-flight branches own the files** (`ex6-*`, `p12-cut46-tovu`, `bugs-high-tovu`; the lists are in this run's scratch, not committed):
  - Admin: `Library.tsx`, `Library.hooks.tsx`, `use-library.hooks.ts`, `media-api.ts`, `media-dependencies.hooks.ts`, `use-media{,-tabs,-item-link}.hooks.ts`, `Posts.tsx`, `PostPreview.tsx`, `PostEditorViewBar.tsx`, `post-editor-{dependencies.hooks,messages}.ts`, `use-post-editor{,-screen,-ui}.hooks.ts`, `use-posts.hooks.ts`, `posts-i18n.ts`.
  - Website: media `analytics`, `contracts`, `duplicate-asset`, `library-save-attachment`, `list-pending-chat-attachments`, `promote-chat-attachment`, `tool-registrations`, `view-{image,video}-tool`; media-generation `providers-tools`/`tool-registrations`; media-import `tool-registrations`; asset-transfer `copy-tool`; post `go-live-sweep`, `post-tool-deps`, `post-tool-duplicate`, `tiptap-block-schema`.
  - Routes owned by the foundation inject branch: `routes/media/update.ts`, `routes/posts/{autosave,create,update}.ts`.
  - Knock-on: `PostEditorActions.tsx` and `PostEditorSlugCollisionWarning.tsx` are import-ready, but only an AVOID file (`use-post-editor-screen.hooks.ts`) imports their types. The same applies to `library/rules.ts`, `library-port.hooks.ts` and `media-port.hooks.ts`.
- **Owner decisions (unchanged from 11-22, plus new ones):**
  - **tiptap:** no `@tiptap/*` in any Jini package (`PostEditor.hooks`, `bubble-menu-state`, `toolbar-state`, `toolbar-group-props`, `use-post-url-dialog.hooks`, `ToolbarCharacterCount`, and the editor body/toolbar groups).
  - **R5 `content_read`:** in the post schemas, and in `capability-card.ts`, which also hard-codes `/admin/posts`.
  - **HW3:** `post-editor-route-key.ts`.
  - **K4i:** `library-i18n`/`media-i18n`. Tovu `COMMON_I18N` adds one branded key that Jini's common dictionary lacks, so the swap is not behaviour-identical.
  - **`put-providers.ts`:** `TOVU_SITE_KEY` copy, and the host error classes need a classifier port.
  - **`document-archive.ts`:** `yauzl` is not a cms dependency.
  - **`media-provider-catalog.ts`:** it needs `@jini-ai/integrations`, which admin does not declare, and it has no args object.
- **K1 shape limits** (need a core/http-kit decision; core is foundation-owned):
  - `routes/media/list.ts` sets `Cache-Control` and the JSON spec has no response headers.
  - `routes/posts/delete.ts` reads `Idempotency-Key` and `RouteInputContext` has no headers.
  - `text.ts`, `original.ts`, `upload.ts`, `replace.ts` and `template-preview.ts` are non-JSON. No admin `ServerRoute` mount exists behind the auth/workspace/`sendAdminFailure` ports.
  - `deps.ts`, `route-guards.ts` and `http/{media,posts}.ts` are Express/host infrastructure (STAYS).

## Gates (tip vs provisional base; raw in `ex7-media-posts-raw/`)
**Tovu (16-gate combine-13 set):** every exit code is identical (summary in `tovu-gates-{base,tip}/summary.txt`).
- **Exit codes:**
  - size 1/1, boundaries 0/0, admin-tsc 0/0, desktop tsc ×4 0/0, hooks 0/0, worker-import-graph 0/0, errors 0/0.
  - typecheck 2/2, typecheck:tests 2/2, typecheck:scripts 2/2. The only errors are the base `plugin-tier2/worker.ts` pair.
  - complexity 1/1, why-comments 1/1, architecture 1/1.
- **Content:**
  - size, complexity, errors, hooks and every typecheck are byte-identical once timings and paths are normalised.
  - boundaries: the same 113 warnings, with 52 fewer dependencies cruised.
  - architecture: cross-feature edges 300 = 300; propagation 12.36 → 12.31 %, runtime-only 3.30 → 3.28 %.
- **why-comments:** 14 lost blocks come from this run's commits. Each was checked to exist in the Jini destination (some reworded neutral). They NEED reviewer allow-list rows, because the classifier refused my edit.
  - IDs: `12a0712c0a97`, `9d8d2841aa30`, `8b7b396b53b9`, `f1c7604fc6ac`, `02e90c063e62`, `2278e5d282d4`, `0271c1bcc463`, `9c480b3daa11`, `5db9360caeee`, `96f6da0c95be`, `279a2459ffb7`, `b4d9d57d1e22`, `5406dc190280`, `690bcf5bd64d`.
  - File, line and text for each are in `why-comments-moved-ids.txt`.

**Jini** (`jini-gates-{base,tip}/`, Node 24; `*_BASE_REF=4902a6a1a`):
- Full build 0, with 0 `error TS`.
- typecheck 0 = 0.
- **guard 0 = 0.** The tip first went red with 2 SI-domain violations, which are now FIXED:
  - The admin screens isolation domains.
  - `import-media-entity` now takes the publish sha256 rule through `ImportMediaEntityDeps.sha256`. This is K5, with a test written first.
- api:check 0 = 0. The new entries are added. Two stale symbol hashes (`ImageEncodeInput`, `readStoredBytes`, both from ex4's review fixes) were refreshed by `api:update`.
- hooks 0 = 0 and errors 0 = 0.
- size, complexity, why-comments and cross-package: 1 = 1, with an identical findings diff.
- **log-safety 1 = 1, plus 4 `stored-error-text` entries (8 occurrences)** in `admin-http/routes/media/{delete,import-url}.ts`, `routes/posts/get-by-id.ts` and `media/site/import-media-entity.ts`.
  - These are wire answers (`{ error: err.message }`) and result reasons that the unchanged Tovu route tests pin byte-for-byte.
  - The foundation's redirects specs show the same pattern at base.
  - Not fixed, because fixing would change wire bodies. No debt row was added (rule 5). **Reviewer: decide between the debt row and a behaviour change.**
- **vitest:** see "Suites" below.

**Suites:** SUITES_PLACEHOLDER

## FILES-LEFT (`plans/P9-data/tools/{scan,plan}.mjs` from `origin/plan/whats-left-1122`, clean worktrees; `files-left.txt`)
| tree | FILES-LEFT | excl. theme areas (111) | lane scanner areas (adm-posts / media / post / other media*) |
|---|---|---|---|
| provisional base `9a0d7d4c4` | 2,385 | 2,274 | 57 / 24 / 48 / 16 (total 145) |
| tip `d7659907dd` | **2,370** | **2,259** | 53 / 23 / 48 / 16 (total 140) |

- **Scope of the −15:** these 15 files are this run's moves. Two kinds are not counted by the scanner's lane areas:
  - Admin media/library hooks: they are in `adm-other`.
  - Route files: they are in the admin-http areas.
- **For reference:** integ merge-13 (`f7185f153`) measured 2,486 in the 11-22 reports. The provisional foundation merges account for most of the difference.

## Notes for the reviewer / combine-15
- **Overlaps with branches this run could not merge:**
  - **`features/media/publish-content.ts`** is also edited by `ex5-fnd-inject-tovu`: its line 3 (`media-references` import) versus this run's lines 4, 9, 196 and 270. The hunks are separate, but expect a 3-way merge there.
  - **`modules/media.ts` / `modules/content.ts`** now hold the K1 registrars, which follows the ex5-fnd-routes pattern. `modules/media.ts` grew to about 200 lines. The size gate is unchanged.
- **Test edits beyond import lines (please review):**
  - **`panel-access.unit.test.ts`:** the posts SERVER_EVIDENCE path now points at `node_modules/@jini-ai/cms/dist/admin-http/routes/posts/shared.js`. It needs a linked or published Jini build that carries the new route subpaths.
  - **`PostEditor.dom.characterization`:** the notice-handle selector also matches `.jini-post-notice`, and there are 49 class-only snapshot changes.
  - **The 3 import-media-entity host tests** bind `sha256` in their deps.
- **Registry:** Tovu still pins published `0.7.3-next.*` artifacts. Merge only with a linked Jini build, or after publishing artifacts that carry the new `admin`/`cms` subpaths.
