PARTIAL f217bed94 da51ac5f: K5-entries-1 (repo.sqlite, publish-content, unreadable-owner-entries-repair), K5-content-types-1, X-content-types-1 (write-service, tool-registrations), K5-taxonomy-1 (agent-tools, repo.sqlite, gated-hooks, publish-content, publish-term-ids, term-sync, tool-registrations), A-K2-collections-1/2 (all but the i18n dictionary), A-K2-taxonomy-1/2 (all but the i18n dictionary), RT-K1-adm-content-types-1/2, RT-K1-adm-entries-1, RT-K1-adm-taxonomy-1/2/3 — each blocked by a prerequisite not landed in these bases (table below)

# ex5 — Collections, Taxonomy lane (2026-11-22, unattended, Opus high, speed mode)

**30 production files left Tovu (FILES-LEFT 2,486 → 2,456; excluding theme areas, 2,375 → 2,345).** 5 tests moved with them. Every move is verbatim, except import specifiers and comments reworded to stay product-neutral. One behaviour change: the two i18n dictionaries now fall back to Jini's `ADMIN_COMMON_I18N`. Its named mutation went red 2/2. **No new red anywhere:** every red gate and test matches base, or is a load timeout that passes when run alone. Everything else in the lane waits on prerequisites that are not in these bases.

- **Bases:**
  - Jini `origin/integ/merge-14-2026-11-22` `4902a6a1a`
  - Tovu `origin/integ/merge-13-2026-11-22` `0d7f78fa4` (tip `f7185f153`, docs only after it)
- **Branches (plain `git push`, never force):**
  - Jini `codex/ex5-collections-jini`: last content commit `da51ac5f`. This report's copy is committed after it.
  - Tovu `codex/ex5-collections-tovu`: last content commit `f217bed94` (the admin copy-check fix, see Addendum). This report and raw outputs are committed with or after it.
- **Raw outputs:** `cloud-results/ex5-collections-raw/` (gates base/final, node-test lists, files-left, mutation).

## Setup (once, as combine-13 Setup)
- Node 24.22.3 (`/opt/node24`), pnpm 10.33.2.
- Jini at `4902a6a1a`:
  - `pnpm install --frozen-lockfile` 0.
  - `pnpm --no-bail -r build` 0 (0 `error TS`).
- Tovu:
  - `npm ci --ignore-scripts` in root/admin/desktop/site-chat: 0/0/0/0.
  - `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs` (82 links; this branch's Jini).
  - `packages/contracts` tsc 0, `packages/sdk` build 0.
- **Tovu base gates:** run in a clean `git worktree` at the base, sharing `node_modules`, so they could not see the subagents' edits. `origin/refactor/terra` was fetched for why-comments.
- **Jini base gates:** taken from `cloud-results/combine-14-jini-raw/gates-final/` (same content, `190860f22`).
- **Not done:** no PostgreSQL in this container. No codebase-memory tools, no force-push, no `--no-verify`, no tags or publish. `main`/`integ/*`/`plan/*`/`release/*` were only fetched.

## Batches
4 subagents (opus-high) ran in parallel on disjoint folders; each made at most 26 tool calls. They edited only, with no commits, builds or gates. I reviewed each `git diff`, added the exports, built, ran the tests, then committed and pushed per batch. Subagent `git rm`s are staged in the shared index, so every Tovu commit was staged by path. One first attempt picked up other batches' deletions; it was unpushed, and I reset and recommitted it.

| batch | subagent | files moved (Tovu → Jini) | importers repointed | tests | status |
|---|---|---|---|---|---|
| **B** admin collections slice (A-adm-other-1/4) | B | 7 → `@jini-ai/admin/screens/collections/{api/collections-api.types, hooks/use-json-field-control.hooks, hooks/{collection-entries,collection-entry-editor,collections,edit-fields-dialog,new-content-type-dialog}-port.hooks}`; test `use-json-field-control.unit` moved | 41 lines in `features/collections/**`, `components/WidgetConfigFields/*` (4), `lib/__tests__/content-type-field-kind.sync.test.ts` | Jini 6/6 (moved test). Tovu admin vitest `features/collections` + `WidgetConfigFields` + sync test: 20 files, 438/438 | DONE: Jini `59b94c49`, Tovu `9420c7420` |
| **C** admin taxonomy slice (A-adm-other-3/6) | C | 9 → `@jini-ai/admin/screens/taxonomy/{api/taxonomy-api.types, html-rules, TaxonomyRowMenu(.hooks), hooks/{merge-term-section,new-taxonomy-form,new-term-form,taxonomy,term-picker}-port.hooks}`; both TaxonomyRowMenu tests moved; new `html-rules` characterization test (5 cases) | ~46 lines in `features/taxonomy/**`, `features/{database,recovery}/**` (6), `components/AssistantDock/DockSettingsMenu(.unit.test)` | Jini admin `src/screens` 4 files 34/34. Tovu admin vitest taxonomy + database + recovery + AssistantDock: 95 files, 1331/1331 | DONE: Jini `3919efed`, Tovu `bd5e57f7a` |
| **A** website entries + content-types (X-entries-1, K5-entries-1 slice, K5-contracts-core-1/3/4 slices) | A | 10 → cms. Final paths after the guard fix: `entries/site/{contracts, render-entry, tool-registrations, tool-metadata, public-list, public-read, system-content-types}`, `widgets/site/{entry-refs-extractor, declared-content-type-owners}`, `content-types/site/tool-metadata` | ~37 lines (assistant, tool-catalog-manifest, app, routes/types, content-resolvers-comments, social-entries, collection-lists, plugin-runtime, pages html-document-store ×2, widgets tests, entry-refs tests ×5, tool-metadata index, `development/scripts/migrate-page-embed-markers.ts`) | Jini characterization tests per folder. Tovu node: 164 files (changed tests + feature suites around every importer); 162 green, 2 `*.postgres.test.ts` red, identical at base (no PostgreSQL) | DONE: Jini `f4973e85`, Tovu `83fef63b2` |
| **D** website taxonomy (K5-taxonomy-1 slice, K5-contracts-core-6 slice) | D | 2 → `@jini-ai/cms/taxonomy/site/{tool-metadata, content-targets}` (agent-tools moved, then came back: see guard fix) | 6 lines (tool-registrations, tool-metadata index, assign-terms route, content-publish-ports, collection-term-policy test) | in A's run (same list); Jini `site-taxonomy.test.ts` | DONE (same commits as A) |
| **E/F** collections + taxonomy i18n (K4-i18n part of A-K2-collections-1 / A-K2-taxonomy-1) | coordinator | 2 → `@jini-ai/admin/screens/{collections/collections-i18n, taxonomy/taxonomy-i18n}`; both `*-i18n.unit` tests moved | 14 lines | Jini 46/46. Tovu admin vitest collections + taxonomy + AssistantDock: 94 files, 1408/1408. **Named mutation:** dropping `{ commonDictionary }` in each Jini dictionary turned collections 2/6 and taxonomy 3/6 red; both restored green (`mutation-i18n.txt`) | DONE: Jini `2ae92eb8`, Tovu `5d3016ef9` |
| **Guard fixes** | coordinator | see below | 16 Tovu specifiers; agent-tools' 3 importers restored | cms `*/site` 12/12; guard 0 | DONE: Jini `efdd2e30` + `da51ac5f`, Tovu `81bd392b7` + `739018abf` |

### Behaviour notes
- **i18n common fallback.** Tovu's `COMMON_I18N` and Jini's `ADMIN_COMMON_I18N` are deep-equal except one key in 21 locales: "is on an older Tovu and can't overwrite these yet…". That is publish-content product copy that neither moved dictionary looks up. It stays with Tovu's publish screen.
- **Strict engine tsconfig.** Jini's `noUncheckedIndexedAccess` needed changes in both dictionaries and their tests, all type-only:
  - In the dictionaries' `mergeDictionaryTranslations`: one cast, with a why-comment.
  - In the tests: `!` on indexed access.
  - No assertion changed.
- **Moved admin tests.** These got a `// @vitest-environment jsdom` first line. That is admin's documented per-file convention outside `react/`.

## Guard / ratchet fixes made after the first Jini gate run
- **SI-domain (7 findings).** cms isolates runtime domains, and the moved files reached across them. The fix uses placement, plus one `shared` entry:
  - The entry-refs extractor binding and the declared content-type owners only read widgets values. They now live in `widgets/site/`.
  - `system-content-types` now lives next to its only engine reader, `entries/site/public-list`.
  - The leaf `src/navigation/types.ts` (only type imports from core) joins `jini.isolation.shared`, the same treatment `src/navigation/href.ts` already has. **Owner/Codex: please confirm.**
- **R5-neutrality (1).** `taxonomy/site/agent-tools.ts` names the host tool `content_read` in model-facing tool copy. It **returned to Tovu byte-for-byte** (STAYS until a K3 copy seam exists).
- **Size (2).** The two dictionaries exceed `max-lines` (1250 / 1242). Tovu's size policy accepts `*-i18n.ts` locale dictionaries (owner-accepted exception). Jini's debt list may only shrink, so I carried that exception as two per-file entries in `scripts/size-exceptions.json`, with the same reason. **Owner/Codex: please confirm, or ask for a per-locale split.**
- **Tovu why-comments (23 rows).**
  - 21 rows: the comment moved with its file into Jini. Host path citations were reworded to be product-neutral. Each is recorded as a "Moved to Jini `<dest>` (ex5)" row.
  - 2 rows (`683d5edb7f2f`, `c110c3c5c34d`): the text was already absent from the base file, so this move deleted nothing.
  - Each row was checked against the Jini copy by text match, and the lowest matches were read by hand.
  - Open rows: 78 (combine-13 recorded 80). None comes from a file this branch touched.

## Final gates (base-diff)
**Jini** (`jini-gates-final/`; base = combine-14 `gates-final`):

| gate | base | final |
|---|---|---|
| build cms / admin | 0 | **0** (0 `error TS`) |
| typecheck (`pnpm -r` + scripts) | 0 | **0** |
| guard | 0 | **0** (`guard2.txt`; first run had 8, fixed above) |
| api:check | 0 (695 entries) | **0** (725 entries, 17333 symbols; `api:update` committed, changeset `p9-ex5-collections`) |
| size | 1 (BASE-RED rows) | **1, identical** (`size2.txt`) |
| complexity | 1 (4 BASE-RED rows) | **1, identical** |
| hooks | 0 | **0** |
| why-comments `--base 4902a6a1a` | 0 | **0** (0 blocks lost) |
| cross-package (XP1–5) | 1: XP4 760 pre-existing | `--base 35c4961af` is not in this clone. Against `4902a6a1a`: **1, only the 760 pre-existing XP4 rows**, no XP1/2/3/5 from this branch |
| admin vitest (full) | — | **258 files, 3133/3133** |
| cms vitest (full) | — | 434 files. 23 failed under load: 22 were 5 s pglite/sqlite timeouts while the Tovu gates ran, and all pass alone (`cms-vitest-rerun.txt` + single rerun). 1 is `forms/src/__tests__/package-boundary` (`'0.7.2'` vs `'0.7.3-next.2'`), unrelated: this branch touches nothing under forms. All `*/site` tests green |

**Tovu** (`tovu-gates-{base,final}/`, normalized diff):
- **Exit codes:** all 13 gates have the same exit code at base and final:
  - size 1, boundaries 0, admin tsc 2, desktop tsc 0, typecheck 0, hooks 0, errors 0, worker-import-graph 0, complexity 0, typecheck:scripts 2, why-comments 1, typecheck:tests 0, architecture 1.
- **Changes in content:**
  - **size, admin tsc, typecheck:scripts, errors, complexity:** identical.
  - **admin tsc:** the base-red is 4 errors. Jini merge-14's admin kit (A-K2-0a) adds `Icon`/`useT`/`values`, and Tovu merge-13 does not supply them yet; A-K2-0a.T is not merged.
  - **boundaries:** 112 → 111 warnings. The removed one is the `routes/types.ts → features/entries/public-list.ts` deep import.
  - **architecture:** cross-feature edges 309 → 308, runtime propagation 3.29% unchanged, deep-import edges 2812 → 2794.
- **Admin vitest (full):** see the addendum at the end.
- **Node tests:** see the A/D row above.

## Steps skipped (prerequisite not landed in these bases)
| step | what is left | blocked by |
|---|---|---|
| K5-entries-1 | `repo.sqlite`, `publish-content`, `unreadable-owner-entries-repair` | K4-seam-5 (`EntryPublishPorts`), K5-publish-content-1/3, K4-publish-content-2, K4db `ContentDb`/`ContentKernel` slice, K4-trash-2 |
| X-content-types-1 | `write-service`, `tool-registrations` (STAY); `index.ts` is the shared entry | `RESERVED_SEGMENTS` is host-owned (`platform/routing`, C-platform-routing-1). Injecting it leaves a pass-through wrapper (a shell). |
| K5-content-types-1 | `publish-content`, `repo.sqlite` | as K5-entries-1 |
| K5-taxonomy-1 | `agent-tools` (STAYS: K3 copy seam for `content_read`); `repo.sqlite` (STAYS: `schemaErasedKernel` has no Jini home; 52 call sites in 12 files would need a new deps field, and K4db is not landed); `gated-hooks`; `publish-content`; `publish-term-ids`; `term-sync`; `tool-registrations` | K4-seam-7, gated-mutations contracts (K5-contracts-core-*), K4-seam-5, K5-publish-content-3, C-platform-html-1 (`slug`), Posts `features/post` |
| A-K2-collections-1/2, A-K2-taxonomy-1/2 | screens, hooks, `rules.ts`, `api/*.ts`, `*-dependencies.hooks` | host `lib/admin-http/request` (`request`, `ApiError` — a host class, so `instanceof` cannot be repointed), `use-admin-locale`, `version-conflict`, `router`, `widget-embed-extension`, `content-refresh-bus`, `admin-failure-channel`, `status-labels`, `PublishSectionButton`, the `native-domain-dialogs.css` mount. Not landed: A-adm-shell-lib-2/3/4, A-K2-shell-lib-2/4/6/7, A-K2-shell-components-8, A-K2-publish-content-1, A-K2-0/0b, A-K2-trash-1, A-K2-auth-1 |
| RT-K1-adm-content-types-1/2, RT-K1-adm-entries-1, RT-K1-adm-taxonomy-1/2/3 | 19 route files | RT-K1-0.T (`adminJsonRoutePorts`) is not in Tovu merge-13. Only its Jini half (merge-14) is landed. Plus K5-taxonomy-1 for the taxonomy routes |

## FILES LEFT (scanner `plans/P9-data/tools/{scan,plan}.mjs` from `origin/plan/whats-left-1122`; base = combine-13 final)
| tree | moving | shells | **FILES-LEFT** | excl. theme areas (111) |
|---|---|---|---|---|
| base `0d7f78fa4` (tip `f7185f153`) | 2,483 | 3 | **2,486** | **2,375** |
| final `739018abf` | 2,453 | 3 | **2,456** | **2,345** |

−30 = admin 18 (collections 7 + taxonomy 9 + 2 dictionaries) + website 12 (A 10 + D 2). The 5 moved tests are not counted.

## Owner / review flags
1. cms `jini.isolation.shared` gains `src/navigation/types.ts` (guard fix above).
2. Jini `scripts/size-exceptions.json` gains 2 per-file locale-dictionary entries (guard fix above).
3. Placement: runtime metadata goes beside its feature in cms (`*/site/tool-metadata`), not under core `src/contracts` (XP4 type-only).
4. Tovu `features/{database,recovery}` now take the shared gated plan/confirm types from `@jini-ai/admin/screens/taxonomy/api/taxonomy-api.types`. A neutral home may be wanted later.
5. Left for the next Tovu gate owner:
   - `development/scripts/check-architecture.baseline.json:79` still names the deleted `features/entries/public-list.ts → features/content-types/index.ts` edge. The gate exit is unchanged, and the file is the baseline, so it was not edited.
   - Docs and old reports still cite old paths. Not edited.
6. Jini `check:cross-package` pins `--base 35c4961af`, which this clone cannot reach. The gate was run against the real base instead.

## Addendum: Tovu admin vitest (full) and one fix
- **Full suite at `7d2aadfb5`:** 904 files, 14,873 pass / 7 fail. combine-13 recorded 909 files, 14,917 / 6. Files and tests are fewer because 5 test files moved to Jini.
- **4 of the 5 red files are BASE-RED**, the same files with the same counts as combine-13: `JiniMediaPicker.hooks` (3), `admin-literal-copy`, `credential-input-autocomplete`, `dictionary-lookup-sinks`.
- **The 5th, `lib/__tests__/untranslated-copy.unit.test.ts`, was NEW RED and is fixed:**
  - **Why it failed:** it globs only the host's own `*-i18n` modules. With the two dictionaries moved to Jini, they dropped out of the no-English check, and its `fr :: Parent` allowance looked unused.
  - **The fix:** the test now also imports `@jini-ai/admin/screens/{collections,taxonomy}/*-i18n` into its module set. The moved copy stays under the same check. No assertion or allowance changed.
  - **After:** 68/68. Admin tsc still shows only the 4 base-red errors.
- **Net: no new red in admin.**
