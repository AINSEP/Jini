PARTIAL e5f580b5d1 0496fc176: FIX 2 theme-freeze repoints (existing owner hold); forms/content-types publish handlers wait on the publish engine move (other lane); host SqlPostRepo/post repo.sqlite + InMemoryPostSearchIndex; seo optional outwardErrorMessage; vault/secrets KeyringPort unification; full-suite admin vitest not run (timed out)
# w5-content — content lane wave 5: big screens, R5/HW3/K4i, and the 8 core-owner decisions (2026-11-24, unattended)

- **Branches:** Jini `codex/w5-content-jini`, Tovu `codex/w5-content-tovu`. Plain `git push`, never forced, with ~25 WIP checkpoints pushed along the way.
- **Programmer skills:** I read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) before any work. The shared builder brief carried its rules: verbatim moves, test-first plus a named mutation for behaviour changes, why-comments moving with the code, and fresh verification evidence before completion.
- **Base:**
  - Tovu: `origin/codex/w3-content-tovu` (`c118328b50`) merged with `origin/codex/w4-core-owners-tovu` (`68d81e1120`, on integ/merge-16). Merge commit `b972892ad`.
  - Jini: `origin/codex/w3-content-jini` (`45948be62`) merged with `origin/codex/w4-core-owners-jini` (`6c24dd9f5`). Merge commit `d63d70e2`, plus the test typing fix `742fd83a`.
  - The merges were not trivial. w4-core-owners sits on merge-16, which contains the route-foundation lane (w3-rtfnd), so they carried rv1123n's MERGE-ORDER item: 21 Jini and 37 Tovu conflicts.
  - Resolution followed Codex's rule:
    - one copy of each menus/media spec;
    - route-foundation's Core DTOs and HTML-permission guard;
    - content's required `outwardErrorMessage` ports;
    - http-kit's 204/205/304 `end()` path;
    - delete/modify conflicts resolved at the destination, with the other side's edits carried into the Jini owners;
    - JSON export maps and baselines merged 3-way.
  - One judgement call: the menus delete spec keeps content's version, where the spec does the trash move with `removeMenu` and `clock`. Route-foundation's injected `trashMenu: MenuTrashFn` is dropped. **This needs Codex confirmation.**
- **Setup:**
  - Node 24.22.3 and pnpm 10.33.2.
  - Jini: `pnpm install --frozen-lockfile` and `pnpm -r build` both exit 0.
  - Tovu: `npm ci --ignore-scripts` (root, admin, desktop, site-chat), then `link-jini.mjs` with `JINI_PACKAGES_DIR=/home/user/Jini/packages`. `packages/contracts` tsc and `packages/sdk` build both exit 0.
  - Base worktrees: Jini `/home/user/jini-base` at `742fd83a` with its own install and build; Tovu `/home/user/tovu-base` at `e7a00d938`, used for why-comments.
- **Method:**
  - Opus coordinated. All builder work went to Sonnet subagents at high effort: 20 dispatches, at most 4 at a time.
  - Builders never committed. The coordinator reviewed each report, committed per batch and pushed a WIP checkpoint about every 5–10 min (repo rule 2).
- **Desktop gates (`apps/desktop npm run gates`):** red on the base (`b972892ad`), and this lane touched nothing under `apps/desktop`.
  - Failing gates: tests, coverage, and complexity (NEW violations in `SiteGrid`, `SiteStartPanel`, `TabStrip`).
  - combine-17 reported the same red pre-push gate.
  - This clone has no `core.hooksPath` installed (`npm ci --ignore-scripts` skipped `prepare`), so pushes ran without the hook. No `--no-verify` was used, and hooksPath was never unset.

## FIX items (Codex rv1123n w3-content fixes 1–5; rv1123q core-owners fix 17)
| Review / item | Status |
|---|---|
| rv1123n **1** (72 KiB `chat.db` from checkpoint `bcb8e5528c`) | **applied:** `git rm` plus `.gitignore` (Tovu `e7a00d938`) |
| rv1123n **2** (theme freeze at `themes/explore.ts:52`, `explore-detail-slug-collision.test.ts:16`, `template-render.canary.test.ts:10`, `theme-preview-dirty.unit.test.tsx:10`) | **STOPPED, existing owner hold (not new).** Restoring the old imports needs `#src/features/post/index` and admin `@/features/posts/api/posts-api.types` to re-export the moved `PostRecord`/`PostKind`/`PublicPostRecord`/`AdminPost`, which would be forwarding shells (forbidden). Holding the cutovers would mean un-moving those owners, which about 250 importers depend on. **Rec (same as the w3 report's ex4-media FIX 2):** the owner approves the 4 import-only repoints. These 4 files are byte-identical to the w3-content parent. |
| rv1123n **3** (`outwardErrorMessage` at `media/delete.ts`, `media/import-url.ts`, `posts/get-by-id.ts`) | **applied** in the merge (Jini `d63d70e2`): all three take the required port. It was also carried to `media/update`, `media/put-providers` and `seo/put-entry`. Tovu binds `({ error }) => error.message` in the media, content and seo modules. New tests assert that a distinct outward string reaches the body. The other seo specs keep the optional port: **follow-up.** |
| rv1123n **4** (inject `useTaxonomyHtmlEmbed` and the menu state/action/write hooks) | **applied** (Jini `5adfd33e6`, `754bdb8d1`). These are required fields on `TaxonomyHostKit`/`MenusHostKit`, bound in Tovu `taxonomy-host-ports.ts` and `menus-host-ports.ts`. Mutation: restoring the direct `useTaxonomyHtmlEmbed` import turns the test red. |
| rv1123n **5** (class cutover in `Taxonomy.tsx`, `TaxonomyTermList.tsx`, `TermPicker.tsx` and siblings) | **applied:** Jini taxonomy TSX emits only `jini-*` classes. Tovu `styles.css` and `styles/editor.css` gained `jini-*` twin selectors on the existing rules. Mutation: `jini-card`→`card` turns both Jini and Tovu red. |
| rv1123q **17** (daemon release designation) | **applied:** `.changeset/w4-core-owners.md` daemon `minor`→`major`, following the precedent `daemon-surface-deps-core-only.md` (Jini `a579e532`) |
| rv1123q STAYS-HOST DISAGREE for these parents | none: rv1123q marks core-owners "N/A, no STAYS-HOST cohort", and rv1123n lists none for w3-content |

## Coordinator decisions implemented (coordinator-decisions-wave5 item 11 + item 13)
| decision | done | where |
|---|---|---|
| publish-ports bag → one feature-owned `PublishPorts` in core contracts | **done** | Core `contracts/site/publish-ports.ts`: a generic keyed bag, since Core may not name cms port types. Each cms feature owns its slice (`posts/post-publish-ports.ts`, `media/`, `navigation/`, `forms/`, `content-types/`, `taxonomy/`, `entries/`, `widgets/`, `redirects/`, `settings/`). The cms `CmsPublishPorts` aggregate lives at `publish/content/publish-ports.ts`. Tovu `TovuPublishPorts = CmsPublishPorts & { post.remove, "theme-files", "active-theme" }`. Mutation: making the keys optional turns tsc red. |
| content kernel K4-seam-5 (types→core, runtime→cms) | **done for 7 of 9 files** | Core `StorageKernel` is the kernel type. 7 host `repo.sqlite.ts` subclasses were deleted (comments, content-types, entries, forms, navigation, taxonomy, widgets), and composition now builds the Jini `Sql*` repos with `schemaErasedKernel` plus the host table names (`platform/db/content-tables.ts`). The post search index (contract, sqlite/postgres dialects, backfill/reindex) moved to `@jini-ai/cms/posts/sql` with the persisted host names injected (`POST_SEARCH_HOST`). The host `SqlPostRepo`/`post/repo.sqlite.ts` stays: it is a host class with 35 importers. |
| secret sealer/keyring owner = integrations secrets | **done** | New `@jini-ai/integrations/secrets` with `SecretSealerPort`, `KeyringPort`, `RootKeyHandle`, `SealedSecret`, moved out of `/webhooks`; 103 Tovu import-only repoints. `vendor-credentials/project-scope` (`credentialScopes`/`credentialCreateTarget`) moved into integrations, bound by Tovu `tovu-credential-sets.ts`. Mutation: changing the project scope to "site" turns tests red. **Follow-up:** `core/contracts/vault` has a near-duplicate `KeyringPort` with `activeKey(_required)` and `string` ids. |
| execution-card types → core contracts | **done** | `@jini-ai/core/contracts/execution` (28 types). ui `DetectedAgent` is renamed `ExecutionCardAgent`. 57 ui and 41 Tovu admin import-only repoints. Changeset: ui major. |
| cms→agentic edge inverted with a port | **done** | cms `contracts/capability-card.ts` is a structural `CapabilityCard` (Core `agentic-core` `GuideTopic`). The forms/widgets/post capability cards moved to cms as `create*CapabilityCard({ host })`. cms has no agentic import. |
| comments provider registries: type in core, providers injected | **done** | `@jini-ai/core/contracts/site/comments-providers`. capability-providers keeps only the runtime. Comments `settings`, `builtin-provider` and `provider-selection` moved to `@jini-ai/cms/comments/site`, with `createProviderRegistry` and `createPrincipalLookup` injected (host membership policy). Changeset: capability-providers major. |
| AdminExecutionMode/origin adapter: type in core, adapter host | **done (nothing to move)** | No `AdminExecutionMode` type crosses the seam. The component, hook and origin adapter are host-only, so they are STAYS-HOST (host adapter). Its execution-card type imports now point at Core. |
| publish-content-ui K5 first | **done** | K5 injection first: report policy, section table, type aliases, query limits, capability id and drift copy are now injected. Then the neutral model (contract, criteria, phase, replan, publish-order, report-rows, section mechanics) moved to `@jini-ai/cms/publish/content/ui`. Tovu keeps `policy.ts`, `sections.ts`, `host-binding.ts` and a host-only barrel (20 admin importers repointed to cms for the Jini names). Mutation: `selectable` → `!== "unchanged"` turns Jini and Tovu red. |
| item 13 R5: model-facing copy via K3 args, schema moves | **done** | `post-tool-schemas` and `tiptap-block-schema` (no `@tiptap` import) moved to `@jini-ai/cms/posts`, with host tool names as `PostSchemaToolNames` K3 args. Byte-identical JSON output was checked before and after. |
| item 13 HW3: module state → injected store | **done** | `createPostEditorRouteKeyStore()` (`@jini-ai/admin/posts/post-editor-route-key`). panels own the one store. The hook-forwarding pins now assert that the store is bound. Mutation: dropping the draft-counter increment turns the test red. |
| item 13 K4i: i18n > 500 lines split by feature | **done for all 8** | posts (3305 lines), media (1888), widgets (1449), forms (1429), collections (1304), taxonomy (1282), menus (1272) and comments (943) became Jini `create<X>Dictionary({ commonDictionary, productEntries? })` factories, each slice ≤ 471 lines. Each composition was checked deep-equal against the evaluated original. Tovu `*-i18n.ts` are about 15-line host bindings with unchanged exports. `mergeLocaleOverlays` moved to `@jini-ai/core/text` (guard SI-domain). The posts dictionary takes `editorFailureDictionary` injected. |
| item 13 tiptap editor stays host | respected | `CollectionEntryEditor.tsx` and PostEditor stay |

## Files (Tovu → Jini unless noted)
| file | result |
|---|---|
| admin `features/menus/MenuEditor.tsx` (528) | **MOVED+SPLIT** → `screens/menus/{MenuEditor,MenuEditorHeader,MenuItemRow,MenuItemFields,MenuModeTabs}.tsx`, all ≤ 80-line functions. The tab strip, editor hook and row hooks are injected. |
| admin `features/menus/menu-editor-panel.tsx` (new) | STAYS-HOST (host composition: binds the Jini MenuEditor with the host kit) |
| admin `features/collections/Collections.tsx` (324), `CollectionEntries.tsx` (150) | **MOVED+SPLIT** → `screens/collections/{Collections,CollectionsTable,CollectionEntries}.tsx` plus `collections-screen-parts.ts` |
| admin `features/collections/{CollectionsScreen,CollectionEntriesScreen}.tsx` (new) | STAYS-HOST (host composition) |
| admin `features/collections/CollectionEntryEditor.tsx` | STAYS-HOST (imports `@tiptap/react`; owner: tiptap editor stays host) |
| admin `features/posts/post-editor-route-key.ts` | **MOVED** → `@jini-ai/admin/posts/post-editor-route-key` (store factory) |
| admin `features/{posts,media,widgets,forms,collections,taxonomy,menus,comments}/*-i18n.ts` | **SPLIT**: data plus factory moved to Jini. The Tovu files STAY-HOST (host binding of a Jini dictionary + Tovu `COMMON_I18N`). |
| website `features/{forms,widgets,post}/capability-card.ts` | **MOVED** → cms `{forms,widgets,posts}/capability-card.ts`. Binding in `site-guide/cms-capability-cards.ts` is STAYS-HOST (Tovu permissions, tool names, hrefs). |
| website `features/post/{post-tool-schemas,tiptap-block-schema}.ts` | **MOVED** → cms `posts/`. `post/post-schema-binding.ts` is STAYS-HOST (Tovu tool names). |
| website `features/post/{search-index,search-index.contract,search-index.sqlite,search-index.postgres}.ts`, `post-import.ts` | **MOVED** → cms `posts/sql/*`, `posts/post-import.ts`. `post/search-host-config.ts` is STAYS-HOST (persisted host names). |
| website `features/post/repo.sqlite.ts`, `search-index.memory.ts` | STAYS-HOST (host `SqlPostRepo` class with 35 importers; memory index uses `openContentDb`) |
| website `features/{comments,content-types,entries,forms,navigation,taxonomy,widgets}/repo.sqlite.ts` | **REMOVED** (empty host subclasses; composition builds Jini repos directly) |
| website `platform/db/content-tables.ts`, `content-types/content-type-repo.ts`, `entries/entry-repo.ts`, `forms/submission-ip-retention.ts` | STAYS-HOST (host schema names / host hooks over Jini SQL repos) |
| website `features/comments/{settings,builtin-provider,provider-selection}.ts` | **MOVED** → cms `comments/site/*` |
| website `features/vendor-credentials/project-scope.ts` | **MOVED** → integrations `vendor-credentials/project-scope.ts` |
| website `features/publish-content/ui/{contract,criteria,phase,replan,publish-order,report-rows}.ts` | **MOVED** → cms `publish/content/ui/*`. `policy.ts`, `sections.ts` and `host-binding.ts` are STAYS-HOST (Tovu publish policy, section table and copy). |
| website `features/publish-content/tovu-publish-ports.ts` | STAYS-HOST (host bag = `CmsPublishPorts` + theme slices; themes stay in Tovu) |
| website `features/{forms,content-types}/publish-content.ts` | **STOPPED (ownership):** the only remaining blocker is the publish engine (`publish-content/repo-handler.ts`, `type-registry.ts`), which is owned by another lane. Both engine files have only cms/core imports. `type-registry`'s `TPorts = TovuPublishPorts` default can become `CmsPublishPorts`. **Rec:** move the engine to cms; both handlers then follow, typed on their slices. |
| ui `features/execution/types.ts` + `ports.ts` types | **MOVED** → `@jini-ai/core/contracts/execution` |
| capability-providers `comments/ports.ts` | **MOVED** → `@jini-ai/core/contracts/site/comments-providers` |
| admin `shell/lib/merge-locale-overlays.ts` | **MOVED** → `@jini-ai/core/text` (changeset: admin major) |
| admin `features/ai-assistant/*AdminExecutionMode*` | STAYS-HOST (host adapter; no shared type) |
| theme-freeze files (4, see FIX 2) | STOPPED (existing owner hold) |

Changesets added: `w5-execution-contracts` (ui major), `w5-comments-provider-contracts` (capability-providers major), `w5-integrations-secrets` (integrations major), `w5-merge-locale-overlays-core` (admin major). API baselines were regenerated (`d596ec865`).

## Gates (base = the merged parents: Jini `742fd83a` worktree with its own build; Tovu `e7a00d938`)
- **Jini at the tip:**
  - Same as base, exit 0: `pnpm -r build` (0 `error TS`), `typecheck`, `api:check` (after `api:update`), `check:hooks` ("hook-injection: ok").
  - `guard`: 1 violation, the same as base (`HW3-module-state shell/lib/shell-failure-log.ts`, inherited). Test-only advisory moved 506→507.
  - Same as base: `check:why-comments` (10 lost blocks; this lane's 2 capability-providers headers were restored), `check:size` (identical), `check:complexity` (identical 6), `check:log-safety` (identical).
  - **`check:cross-package`: 2945→2951 lines.** All 6 new lines are `XP3 …: absolute JINI_DECLARATION_BASELINE_DIR required` on files this lane changed. That is the same environment error as the base's 2016 rows: the declaration check needs that env var. No new XP rule hit.
  - **vitest:**
    - core 3058/3058, admin 3927/3927, ui 8820/8820, integrations 2110/2110, capability-providers 198/198.
    - cms 6263/6266. The 3 reds are `forms/package-boundary` (CHANGELOG 0.7.2 vs 0.7.3-next.2), `universal-entries.boundary` (timeout) and `media/import-url` "authorizes media.upload…". All 3 are **red on the base worktree too.**
- **Tovu at the tip:**
  - `npm run typecheck`, admin `tsc --noEmit`, `typecheck:tests`: all 0 errors.
  - `check:why-comments`: 79 lost blocks against 80 at base. This lane's 68 newly lost blocks were resolved:
    - 47 provably moved to Jini (debt row names the Jini path);
    - 2 restored in Jini;
    - 3 relocated in Tovu;
    - 13 obsolete with a concrete reason (the deleted host repo subclasses and the hand-rolled merges replaced by `mergeLocaleOverlays`);
    - 3 publish-ui rows.
  - **Node tests (`node --test` with the root `npm test` imports, concurrency 3) on all 114 changed website test files:** 1984 tests, 1974 pass, 7 fail, 3 skipped. All 7 fails are `postgres:` cases with no Postgres socket in this container (env).
  - **Admin vitest** (`--maxWorkers=3`) over features `menus`, `collections`, `taxonomy`, `posts`, `publish-content`, `comments`, `forms`, `widgets`, plus `integrations/jini-admin` and `dictionary-lookup-sinks`: 105 files, **1873/1873 pass**.
  - Earlier builder runs: taxonomy 307, collections 422, menus 405, K4i 885 + 609, posts/pages/trash 1810, execution 698, publish-content 260 + 239 (all green). Website: comments 134, content kernel 2327/2343 (15 env/other-lane), secrets 188, publish ui 84 + 369 + 793, post search 106. Details are in the commit messages.
- **Desktop `npm run gates`:** red on the base (see Setup). Untouched by this lane.
- **Not run:** a full-suite Tovu admin vitest. Its 30-min background slot timed out while it ran behind the Jini rebuild, gates and Tovu node tests. Tovu `check:architecture` was not run; the secrets builder saw a 3.06→3.08 propagation-cost metric move on a mixed tree, and `check-architecture.baseline.json` has stale edges for the deleted `project-scope.ts`. **Follow-up:** run `--update` when the train combines.

## FILES LEFT (`plans/P9-data/tools/scan.mjs` + `plan.mjs` from `origin/plan/whats-left-1122`, `ROOT=/home/user/Tovu`)
| tree | moving | themes | excl. themes |
|---|---|---|---|
| base (merged parents `e7a00d938`) | 2,056 | 111 | 1,945 |
| w5-content tip | **2,035** | 111 | **1,924** |
| Δ | −21 | 0 | −21 |

The count drops less than the moves suggest, because about 25 of the remaining Tovu files are now thin host bindings that the scanner still counts until `plan.mjs` KEEP_RULES lists them:
- 8 `*-i18n.ts` dictionary bindings;
- `menu-editor-panel.tsx` and the two collections `*Screen.tsx`;
- `cms-capability-cards.ts`, `post-schema-binding.ts` and `search-host-config.ts`;
- `content-tables.ts`, `content-type-repo.ts` and `entry-repo.ts`;
- publish-ui `policy.ts`, `sections.ts` and `host-binding.ts`;
- `tovu-publish-ports.ts`.

**Rec (coordinator decision 12 pattern):** add anchored KEEP_RULES for them when Codex confirms. `plan/*` was not touched.

## Self-check (before each push)
- **No re-export/forwarding files.**
  - The `@tovu/publish-content-ui` barrel was reduced to host-owned names.
  - The comments, settings, vendor-credentials and post `index.ts` re-export lines of moved code were removed and their importers repointed.
  - The 3 pre-existing feature barrels (`features/{menus,collections}/index.ts`) only point at host compositions.
  - The new Jini `posts/sql/index.ts` and the cms/core subpath entries are package-owned aggregators.
- **Hooks:** custom hooks reach Jini components only as REQUIRED props or required kit fields: `useMenuEditorHook`, `rowHooks`, `tabStrip`, the 5 menu state/write hooks, `useTaxonomyHtmlEmbed`, and the collections `use*Hook` props. `check:hooks` is ok.
- **No server-framework types or host log formatters in Jini.** All new cms code takes structural ports.
- **Classes:** `jini-*` in the moved TSX, with Tovu twin selectors added to the existing rules. No new size/complexity exception rows: `check:size` and `check:complexity` are identical to base.
- **Shared wire types in a neutral Core owner:** execution, comments-providers, publish-ports, plus `mergeLocaleOverlays` in `core/text`.
- **Args:** object args with `_optional = {}` on new exported functions. Pre-existing positional signatures are kept only in Tovu `publish-content/ui/host-binding.ts`, so the existing admin call sites did not change.
- **Behaviour changes test-first with a named mutation:**
  - HW3 store: draft-counter;
  - publish-ui: `selectable`;
  - secrets: project scope;
  - K4i: one dropped slice per factory;
  - publish-ports: optional keys;
  - FIX 4/5 and execution contracts: tsc.
- **Why-comments** moved with the code. Debt rows were added only for provably moved or obsolete blocks.

## Follow-ups / open
1. FIX 2 theme freeze: owner approval for the 4 import-only repoints (above).
2. The menus delete spec dropped route-foundation's `trashMenu` port (merge choice). Codex should confirm. Tovu `server/INFO.md:32` still mentions `trashMenu`.
3. seo `get-entry`, `get-entry-analyze` and `put-settings` still use the optional `outwardErrorMessage` (raw `err.message` fallback). Make it required in a short step.
4. Publish engine (`repo-handler`, `type-registry`) → cms is owned by another lane. After it lands, forms and content-types `publish-content.ts` follow.
5. `core/contracts/vault` `KeyringPort` vs `integrations/secrets` `KeyringPort`: near-duplicates (`activeKey(_required)` and `string` ids vs `activeKey()` and `UUID`). Unify in one owner step.
6. Host `SqlPostRepo` / `post/repo.sqlite.ts` (35 importers) and `InMemoryPostSearchIndex`; post `repo.memory` invalidation codemod (from w3).
7. Desktop gates red on base (complexity in SiteGrid/SiteStartPanel/TabStrip + a test). Not this lane.
8. `check-architecture.baseline.json` stale `project-scope` edges: run `--update` on the combined tree.
