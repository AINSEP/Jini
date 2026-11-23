PARTIAL 378bb710c 219a8e8df: K5-{navigation-1,widgets-1,forms-1,form-destinations-1,comments-1,comments-2}, A-K2-{menus-1,widgets-1,forms-1,comments-1}, RT-K1-adm-{menus-1/2,widgets-1–4,forms-1–3,comments-1/2}, X-navigation-1 tool-registrations.ts, R-public-http-1 form-presentation-assets/form-feedback-policy/form-wire-policy — prerequisites not in these bases or owner decision (see "Steps skipped")

# ex5-small — Menus, Widgets, Forms, Comments lane (2026-11-22)

Unattended cloud run, Opus high, coordinator plus 5 subagents in 2 waves. **Every step of this lane that is ready on these bases is done.** FILES-LEFT is **2,486 → 2,457 (−29)**, or **2,375 → 2,346** excluding themes. That is 29 sources moved: 16 website files to `@jini-ai/cms` and 13 admin files to `@jini-ai/admin/screens/*`, with 15 tests moved and 6 characterization tests written. Tovu only wires them now.

**No new red:**
- Tovu: every gate equals base. The 7 red affected test files fail with identical counts at base. Admin vitest is fully green (43 files, 673 tests).
- Jini: build, typecheck, guard, api:check and hooks are 0. The size, complexity, why-comments and XP ratchets are identical to combine-14 base. The cms and admin suites have no new red.

Codex review is still needed before merge (see "For the reviewer").

- **Branches (plain `git push`, never force):**
  - Tovu `codex/ex5-small-tovu` from `origin/integ/merge-13-2026-11-22` `f7185f153`. That is the dispatch's `0d7f78fa4` plus the combine-13 report commit (docs only).
  - Jini `codex/ex5-small-jini` from `origin/integ/merge-14-2026-11-22` `4902a6a1a`.
- **Not touched:** no tags, no publish, no `--no-verify`, no force-push, no codebase-memory tools. `main`, `integ/*`, `plan/*` and `release/*` were only fetched.
- **Setup:**
  - Node 24.22.3 (`/opt/node24`), pnpm 10.33.2, npm 11.19.1.
  - Jini: `pnpm install --frozen-lockfile` 0; `pnpm --no-bail -r build` 0, with 0 `error TS`.
  - Tovu: `npm ci --ignore-scripts` in root, admin, desktop and site-chat: 0/0/0/0.
  - `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs`: 0.
  - `packages/contracts` tsc: 0. `packages/sdk` build: 0.
  - Not set up: PostgreSQL. None of the affected tests needed it.
  - The Jini clone was un-shallowed so `check:cross-package --base 35c4961af` could run.

## Batch table

| batch | subagent | files moved (Tovu → Jini) | importers repointed | tests | status |
|---|---|---|---|---|---|
| **A** Forms/Comments (website) | opus-high #1 (31 calls) | `features/forms/{form-destination-manifest,import-remote-submissions,mail-outbox-readiness}.ts` → `cms/forms/site/`; `features/form-destinations/{pull,select}.ts` → `cms/forms/destinations/`; `features/comments/comment-targets.ts` → `cms/comments/site/`; `admin-http/http/forms.ts` → `cms/admin-http/http/forms.ts` (R-admin-http-1 Forms slice). **Coordinator:** `features/comments/ip-hash-salt.ts` → `cms/comments/site/` (its only host import was the `RuntimeMode` type, now the same local `'production' \| 'local'` union already declared in `platform/mail/purpose-scoped-mailer.ts`) | ~33 lines: forms/form-destinations/comments barrels (re-export lines deleted, users repointed), `server/routes/types.ts`, composition `form-*`, `mail-http`, comments slices, 7 admin form routes, `boot-readiness-warnings`, `visitor-submit` | moved: form-destination-manifest, pull.unit, select.unit, comment-targets, ip-hash-salt; new: `admin-http/http/__tests__/forms.characterization.test.ts` | DONE (8/8) |
| **B** Menus (website) | opus-high #2 (19 calls) | `features/navigation/{menu-html-permission,menu-trash-follow-ups,trash-menu,trash-aware-memory-menu-repo}.ts` → `cms/navigation/site/` (X-navigation-1, 4 of 5) | 12 lines + 3 admin-http menus importers (coordinator); 2 barrel lines deleted | tests-first characterization: 4 new Jini files (17 tests); Tovu trash/menu tests stay with repointed imports | DONE 4/5 (tool-registrations held) |
| **C** Public form/widget render | opus-high #3 (27 calls) | `public-http/http/site/{form-label-inspection,form-validation-i18n}.ts`, `render/widgets/placeholder.ts` → `cms/public-http/http/site/…` (R-public-http-1 Forms/Widgets slices); `features/widgets/media-html-log.ts` → `cms/widgets/site/` (X-widgets-1) | 10 lines | moved: form-validation-i18n.unit and 3 media-html tests (through a node:test mock adapter, now shared at `cms/src/__tests__/support/node-test.fixture.ts`) | DONE 4/7 (3 held on literals) |
| **D** Forms/Comments (admin) | opus-high #4 (11 calls) | `features/comments/api/comments-api.types.ts`, `features/forms/api/forms-api.types.ts`, `features/forms/{index-aligned-translations,forms-field-settings-i18n,forms-leave-guard-i18n}.ts` → `admin/screens/{comments,forms}/…` (A-adm-other-1/4 slices) | 11 lines in 10 files | moved: index-aligned-translations.unit | DONE (5/5) |
| **E** Menus/Widgets (admin) | opus-high #5 (25 calls) | `features/menus/api/menus-api.types.ts`, `features/widgets/api/widgets-api.types.ts`, `features/menus/{page-link-rules,html-rules,MenuEditor.hooks,MenuPageLinkFields,MenuPageLinkFields.hooks}`, `features/menus/hooks/menus-port.hooks.ts` → `admin/screens/{menus,widgets}/…` (A-adm-other-2/3/5/6 slices) | ~45 lines across menus, widgets, WidgetConfigFields, WidgetPickerDialog, EmbedInsertControl, jini-admin widgets module and lib widget-embed. Coordinator: `MenuEditor.tsx`'s `export { targetForKind } from …` re-export was deleted (no shells) and its one test user split | moved: page-target-kind.unit, MenuEditor.remove-hook.unit, MenuPageLinkFields.hooks.unit | DONE (8/8) |

Each batch has its own commit pair (Jini `feat(...)`, Tovu `refactor(...)`). cms and admin `package.json` exports, `jini.entries`, changesets (`.changeset/p9-ex5-*.md`) and `api-baseline` were written centrally by the coordinator, the single manifest writer. **29 new subpaths:** cms 16 (4 node, 12 universal) and admin 13 (3 browser, 10 universal).

### Commits
- **Jini `codex/ex5-small-jini`:**
  - `c91fe9968` A, `2c45b6d8e` B, `88f555e66` C, `7194a232f` cms exports + API
  - `862feab5f` ip-hash-salt
  - `df061de33` D, `b915678ed` E wip snapshot, `e0aa0b8a8` E
  - `ba55846fc` API baseline
  - `c46627a51` shared node:test adapter
  - `219a8e8df` guard fix, which:
    - puts the `./admin-http/http/forms` isolation entry in the forms domain;
    - makes `form-label-inspection` a node entry, because it imports parse5.
  - The report copy is committed after this (see the branch tip).
- **Tovu `codex/ex5-small-tovu`:**
  - `88dd65e25` A, `dcec214ee` B, `c97e7bd02` C
  - `2bee61028` ip-hash-salt
  - `d45db1db0` D, `266e852c0` E wip snapshot, `8ed2b65fb` E
  - `c0179fb90` why-comments allow-list (16 rows)
  - `378bb710c` stale error-gate debt row dropped
  - This report is committed after them.

## Gates (raw outputs in `cloud-results/ex5-small-raw/`)

**Tovu, tip vs base.** The same 16 gates as combine-13 ran on a clean `git worktree` of `f7185f153` (base) and on the branch (tip):

| gate | base | tip |
|---|---|---|
| size | 1 | **1, identical** |
| boundaries | 0 | **0**; only the depcruise module count changes (6773 → 6764) |
| admin tsc | **2 (BASE-RED)**: `render-with-jini-kits.tsx`, `jini-kits.ts` lack the A-K2-0a kit `Icon`/`useT`/`values` that Jini merge-14 added. The Tovu half, A-K2-0a.T, is not in this base | **2, identical** |
| desktop tsc ×4, typecheck (+e2e), hooks, worker-import-graph, complexity, typecheck:tests | 0 | **0** |
| errors | 0 | **0, identical**. The moved `ip-hash-salt` debt row was dropped in `378bb710c` |
| typecheck:scripts | 2 | **2, identical** |
| why-comments | 1 (80 open in combine-13 final) | **1, 80 open, the same set**. 16 rows were allow-listed, each with a reason: 13 comment blocks that moved to Jini with N1/N2 rewording, and 3 comments over deleted barrel re-exports, whose why is kept in the Jini module headers |
| architecture | 1, runtime-only propagation ratchet row 3.29 | **1, the same single row, improved to 3.24** |

**Tovu tests** (each file alone, node `--test` with the root `npm test` imports, 3 in parallel). The set is every changed test plus every direct test importer of each changed production file. The `server/routes/types.ts` hub (175 importers, type-only edit) was skipped; tsc covers it.
- **website, 111 files:** 104 green, 7 red.
- **All 7 reds are BASE-RED**, re-run at `f7185f153` with identical pass/fail counts (`tovu-red-at-base.txt`):
  - `forms-notification-retry` 2/2
  - `resolve-html-page-embeds.integration` 64/1
  - `forms-submit` 39/1
  - `l244-characterization` 17/4
  - `render-form-layout` 1/3
  - `tiptap-render-contract` 73/1
  - `render.golden.characterization` 12/1
- **admin vitest, 43 files** (same selection rule): **673/673 green**.

**Jini, against combine-14 base:**

| gate | base | final |
|---|---|---|
| `pnpm --no-bail -r build` | 0 | **0** |
| typecheck (+ scripts) | 0 | **0** |
| guard | 0 | **0**, after the isolation fix `219a8e8df`. The first run found 2 SI violations from this run, both fixed |
| api:check | 0 | **0** (724 entries, 17345 symbols) |
| size / complexity | 1 / 1 | **identical** (BASE-RED rows only) |
| hooks | 0 | **0** |
| why-comments `--base 4902a6a1` | 0 | **0** |
| why-comments default (terra) | 1 | **1, identical open set** |
| check:cross-package | 1: XP1 39 / XP2 33 / XP3 2050 / XP4 760 / XP5 6 | **1, identical counts**. No finding names a file this run added |
| log-safety | 1 (BASE-RED) | **1, plus 3 moved-code rows** (listed below) |
| error gate (WARN) | 0, 25 new or worse | **0, 26**: +1 `catch-reads-error` in `comments/site/ip-hash-salt.ts`, moved from Tovu's own debt row |

**Jini suites:**
- New and moved tests: cms 14 files / 76 tests and admin 4 files / 26 tests, all green.
- **admin suite:** 256 files, **3113/3113 green**.
- **cms suite:** 13 failed tests at final, against 7 at base.
  - The 2 failures tied to this run were fixed by `219a8e8df` and now pass: `subpath-isolation.contract` and `universal-entries.boundary`.
  - The pglite `*.dialects`/contract failures change from run to run and pass when re-run unloaded. The base run's pglite reds were a different set, so I read them as load flakes.
  - What remains is red at base too: `create-tables.reference`, forms `package-boundary`, `optional-platform` (packed).
  - **No new red.**

**Named mutation** (tests-first seam: B's characterization tests): I negated the trash guard in Jini `TrashAwareInMemoryMenuRepo.save`. Result: **6 of 17 tests red**, restored byte-identical (`cmp`), 17/17 green again. The other steps are verbatim moves, so no per-step mutation was run (speed mode). The `ip-hash-salt` type alias does not change behaviour.

## Steps skipped, and why
- **X-navigation-1 `tool-registrations.ts`.**
  - It imports the host's `contracts/core/tool-metadata/navigation.ts`.
  - That file moves in K4-contracts-core-5, which is not landed. Its sheet's core `src/contracts` destination would also add runtime under contracts (XP4).
  - Navigation, forms and comments metadata (P9F lane slices) are held for the same reason.
- **R-public-http-1 `form-presentation-assets.ts`, `form-feedback-policy.ts`, `form-wire-policy.ts`: owner decision needed.**
  - Their `tovu` literals (`tovu-form`, `data-tovu-form*`, `--tovu-form-*`, `data-tovu-range`, cookie `tovu_form_flash`) are hard-coded outside the moved module, in:
    - the host themes: `content/themes/static/tovu-theme/css/theme.css` and two copies;
    - `render/contact-form-widget.ts:63,68`;
    - test assertions: `html-form-embeds.integration`, `form-field-types-style.unit`, `form-render.unit`, `form-theme-colours`, `render-form-layout`, `forms-submit:1034`, `request-cost-cacheability.measurement:293,443`.
  - Renaming in Jini would break host styling and tests. Either rename in the host first, or decide how the names are supplied.
- **K5-{navigation-1, widgets-1, forms-1, form-destinations-1, comments-1, comments-2}: prerequisites not landed.**
  - Missing: K4-seam-5/8/9/10/13, K5-contracts-core-*, K4/K5-publish-content-*, K5-settings-3, X-content-types-1, X-media-1, V-post-5, K5-custom-credentials-3, K5-agent-plugins-4.
  - Every remaining file imports a host collaborator or a non-core Jini package. cms depends only on `@jini-ai/core`, so XP3 forbids the edge without those seams.
- **A-K2-{menus-1, widgets-1, forms-1, comments-1}: prerequisites not landed.**
  - Missing: A-adm-shell-lib-*, A-K2-shell-lib-*, A-adm-other-*, A-K2-0a.T, K4-i18n-common.T (review FIX).
  - The screens import `@jini-ai/ui` (K2 kit props).
  - The `*-i18n.ts` dictionaries import `lib/i18n-common.ts`, whose Tovu cutover is K4-i18n-common.T.
- **RT-K1-adm-{menus-1/2, widgets-1–4, forms-1–3, comments-1/2}: prerequisite not landed.**
  - RT-K1-0.T (the host `adminJsonRoutePorts` mount) is approved but not in this Tovu base. Several also need K5 steps.
- **RT-K1-pub-site-2 `comments-submit.ts` (K4-seam-8) and RT-K1-pub-site-5 `static-menus.ts` (route deps):** prerequisites not landed.

## FILES LEFT (`plans/P9-data/tools/scan.mjs` + `plan.mjs` from `origin/plan/whats-left-1122` `a2e4f88cf`, clean worktrees)

| tree | moving | shells | **FILES-LEFT** | excl. theme areas (`theme` 86 + `adm-themes` 25) |
|---|---|---|---|---|
| base `f7185f153` | 2,486 | 0 | **2,486** | **2,375** |
| tip `8ed2b65fb` (later commits touch only JSON debt files) | 2,457 | 0 | **2,457** | **2,346** |

−29 = A 8 + B 4 + C 4 + D 5 + E 8. Scanner areas: navigation 13→9, widgets 6→5, forms 16→13, form-destinations 9→7, comments 11→9. The admin slices count under their scanner areas. The scanner gives 0 shells at this plan revision; combine-13 counted the 3 custom-credentials shims as shells, and the total is the same.

## For the reviewer (Codex)
1. **Only non-import edits in moved code**, all type-level, for Jini's stricter `exactOptionalPropertyTypes` / `noUncheckedIndexedAccess`:
   - `AdminFormDefinitionDto.html?: string | undefined`;
   - `form-label-inspection`'s controls map value type;
   - optional params in `screens/menus/{page-link-rules,MenuPageLinkFields,MenuPageLinkFields.hooks}` gained `| undefined`;
   - non-null `!` on 3 moved test reads (2 media-html, 1 page-target-kind).
   - Runtime output is unchanged.
2. **Moved-test harness changes:**
   - The node:test `t.mock.method` suites (media-html ×3, ip-hash-salt) use `cms/src/__tests__/support/node-test.fixture.ts`. It overlaps `cms/src/forms/__tests__/support/node-test.fixture.ts`, a consolidation candidate.
   - Two admin screen tests carry `// @vitest-environment jsdom`, because `screens/**` is outside the admin config's jsdom glob. The alternative is adding a `src/screens/**` glob.
3. **cms isolation:** a new `jini.isolation.entries` map assigns `./admin-http/http/forms` (the Forms admin DTO serializer) to the `forms` domain, so its value imports from `forms` are not a cross-domain reach.
4. **log-safety: 3 new rows, all verbatim-moved behaviour,** listed rather than suppressed. Jini's debt list can only shrink against the trusted base.
   - `admin-http/http/forms.ts` [stored-error-text] ×6
   - `comments/site/ip-hash-salt.ts` [console] (the production salt warning)
   - `widgets/site/media-html-log.ts` [console] (its job is to keep the host's console lines)
5. **Kept as-is, please confirm:**
   - E kept the shared host utility classes `a11y-label-wrap`, `visually-hidden` and `muted-cell` in `MenuPageLinkFields.tsx` unprefixed. Existing Jini admin already uses them, and renaming would break host CSS.
   - No `tovu` literal moved in this run, so there are **no new P9-BREAKS rows**.
6. **Small stale text left:**
   - `MenuEditor.tsx:87` says "now re-exported from rules".
   - `apps/admin/src/lib/__tests__/dictionary-lookup-sinks.unit.test.ts:34-35` still lists `FORMS_{FIELD_SETTINGS,LEAVE_GUARD}_I18N`. It does not fail.
   - Some comments name host files (`forms-i18n.ts`, `repo.sqlite.ts` → reworded). None match N1/N2.
7. **Commits:**
   - The two `wip(admin)` E snapshots (`b915678ed`, `266e852c0`) exist only because of the push-every-10-minutes rule. The reviewed state is the commit after each.
   - The admin-http menus repoints (B's barrel users in `admin-http/http/menus.ts`, `menus-dto.unit.test.ts`, `routes/menus/delete.ts`) were made by the coordinator and committed with B.
