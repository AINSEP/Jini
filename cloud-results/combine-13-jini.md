READY e4e3bf175

**`integ/merge-13-2026-11-22` @ `e4e3bf175`** (last content commit; the commits on top only add gate output and this report). All 5 branches are merged, with no conflicts. Build, typecheck, guard, `api:check`, the three plugin guards and every touched package suite are green, apart from BASE-RED rows and one load-only timeout that passes when run alone. 13 mutations were run and all 13 went RED.

**Listed, not fixed:** 3 new why-comment rows (decision 2). **Fixed here:** jx-chatlinks was guard-red on its own tip (R10, 2 rows). The fix is `a9b2cb04a` (decision 1).

# combine-13 JINI (2026-11-22): `integ/merge-13-2026-11-22`

This was an unattended cloud run, 06:55 to about 08:10 UTC, well inside the 3.5 h cap. The branch was created from `origin/integ/merge-12-2026-11-22` (`6b8e0d48a`). Node v24.22.3 (`/opt/node24`), pnpm 10.33.2.
- **Not used:** subagents, codebase-memory tools, force-push, `--no-verify`, `git pull --rebase`, publish, tags, version bumps, new changesets.
- **Pushed:** only this branch, always with a plain `git push`.
- **Untouched:** `main`, `refactor/terra` (fetched only, as the default why-comments base), `plan/*`, `release/*`. Tovu was only read: the four `codex/ex-*-tovu` reports and `plan/whats-left-1122` `plans/P9-extraction.md` + `plans/P9-codex-verify-N1-N4.md`.

**Summary: all 5 merges are done, and nothing is left.**
- **Conflicts:** none. `api-baseline/jini-ai__cms.json`, `packages/cms/package.json` and `pnpm-lock.yaml` were edited by both ex-export and ex-html, and git merged them automatically. I checked the result is the union of both sides: cms exports `./presentation/site/active-theme-id` + `./html/site/{slug,source-edits}` + `./posts/{post-before-save,slug}`, and the lockfile drops agent-plugins' `@jini-ai/commerce` and adds `@sindresorhus/slugify` 3.0.1. `pnpm install --frozen-lockfile` exits 0 after each merge and at the end.
- **Mutations:** **13 run, 13 RED, 0 GREEN, 0 NOT-RUN.** ex-sh has no named mutation; its plan lane says "Mutation: none (no behaviour)", and its diff only adds a comment.
- **Red found and fixed (1 commit):** `a9b2cb04a`. jx-chatlinks' chat-pane hook imports `currentOrigin` and `isOwnLinkHref` from `components/own-link`. The guard rule R10-chatpane-public-surface requires those names to be in the chat/react public barrel. The rule already exists at the branch's own base `1ac1cbbd1`, so the branch tip was red by itself; the merge did not cause it.
- **New ratchet rows (LISTED, not fixed):** why-comments `--base 6b8e0d48a` 0 → 3 lost; default (terra) 7 → 10. Every other ratchet equals base exactly.
- **API:** `api:check` exits 0 before and after `api:update`. The update is additive apart from RT-3's declared removal of `@jini-ai/agent-plugins/commerce/server` (covered by its changeset). The full list is in "New exports".

## Method
- **Setup / base first** (unmodified `6b8e0d48a`), following combine-12's Method. This clone had no `node_modules`, so the first `pnpm install --frozen-lockfile` was already a fresh frozen install (exit 0). The clone was shallow, so I unshallowed it (fetch only) and fetched `origin/refactor/terra` = `6c9effae4`. Then `pnpm --no-bail -r build` 0 (0 `error TS`); `pnpm -r --no-bail --if-present run typecheck` 0; scripts tsc 0; `pnpm guard` 0; `api:check` 0; `guard:plugins` / `:packed` / `:catalog` 0 / 0 / 0 (68/68).
- **The base equals combine-12's final state:** size 3 lines + 3 stale json-ipc rows; complexity 4; log-safety 2 rows; error gate 24 New + 1 Worse, 28 improved; why-comments default 7 not allow-listed; guard HW3 34 / HW9 env 70 / advisory 492. Raw output is in `gates-base/`.
- **Sheets read before merging:**
  - Tovu `cloud-results/ex-{core,export,html,sh}.md` on `origin/codex/ex-<lane>-tovu`.
  - `plans/P9-codex-verify-N1-N4.md`: the FIX notes for C-contracts-core-1/2, D-site-export-1, C-presentation-1, C-platform-html-1, T-post-1, RT-3 and SH-2.
  - `plans/P9-extraction.md`.
  - jx-chatlinks has no sheet. Its commit message and tests are the spec, and its mutations below are mine.
- **Merges:** `git merge --no-ff`, in the given order, in the main tree. Gates after each merge are in `gates-m<N>/`:
  - `pnpm --no-bail --filter "...[<pre-merge>]" build`
  - `tsc -p tsconfig.json --noEmit` in each changed package
  - `pnpm guard`
  - `SIZE_BASE_REF=6b8e0d48a check-size` and `COMPLEXITY_BASE_REF=6b8e0d48a check-complexity`
  - `check-hook-injection`
  - `check-why-comments --base 6b8e0d48a`, plus the default (terra)
  - `check-log-safety` and `check-error-gate`

  Each was diffed against base, with the "N files" counts normalized. The plugin guards ran at base and at final.
- **Mutations:** one plant per run, by exact unique string replacement. The test was run, the file restored by byte copy, and `git diff --quiet` confirmed it clean. Every plant's diff and result is in `mutations.txt`.
- **Owner args rule:** in all 5 branches, `git diff <merge-base>...<tip>` has **no removed line containing `_optional`**. ex-core adds 4 pads and ex-html adds 5. `git diff 6b8e0d48a HEAD` likewise removes none.
- **Full suites:** run in a separate worktree, `/home/user/jt13` at `e4e3bf175`:
  - Setup: fresh frozen install 0; `pnpm --no-bail -r build` 0, with 0 `error TS`.
  - Each touched package: `npm run test -- --maxWorkers=2 --minWorkers=1`.
  - agent-plugins' node:test plugin suites: all 111 `*.test.mjs` files, each run separately.
  - `scripts/__tests__/check-package-layers.test.ts`, because RT-3 edited `scripts/check-package-layers.ts`.

## Per branch
| # | branch (tip) | merge commit | conflicts → resolution | red found | fix commits | status |
|---|---|---|---|---|---|---|
| 1 | `origin/codex/ex-core-jini` `7a621602a` | `5b5492de5` | none | none. Filtered build 0; tsc core 0; **all ratchets = base** | — | GREEN |
| 2 | `origin/codex/ex-export-jini` `3985c6cb8` | `6d9e99dc2` | none | Build 0; tsc agent-plugins / cms / devops 0; guard 0. **why-comments NEW** (`--base` 0 → 1; default 7 → 8): `agent-plugins/core/commerce-server.mjs:1 [f98bce5800b5]` "the host supplies services and activation; installing the payload starts no runtime." RT-3 deletes the file, so the comment goes with the retired entry. | — | GREEN (1 listed row) |
| 3 | `origin/codex/ex-html-jini` `5fab76617` | `2bc061908` | none (`cms/package.json`, `api-baseline/jini-ai__cms.json`, `pnpm-lock.yaml` auto-merged; union verified) | none. Frozen install 0; build 0; tsc cms 0; **ratchets = merge 2** | — | GREEN |
| 4 | `origin/codex/ex-sh-jini` `c984e9dcf` (1 commit) | `fddb96339` | none | none. It does change something: a 14-line rationale comment on `platform/src/fs/strict-containment.ts resolvePathWithin` and a patch changeset. tsc platform 0; platform `src/fs` 922 + 1 skipped; **ratchets = merge 3** | — | GREEN |
| 5 | `origin/codex/jx-chatlinks` `b6e9573f5` (based on `1ac1cbbd1`) | `351211d6a` | none | Build 0; tsc chat 0. **`pnpm guard` RED (2)**: `R10-chatpane-public-surface …/useChatPaneNewTabLinks.hooks.ts: imports "currentOrigin"` / `"isOwnLinkHref" from "../../../components/own-link.js" … not in the public barrel's export list`. **why-comments NEW** (`--base` 1 → 3; default 8 → 10): `chat/src/react/components/Markdown.tsx:566-568 [3b87f7959834]` (the 2026-10-08 "every link opens in a new tab" rule, which this branch reverses) and `chat/src/react/components/__tests__/Markdown.test.tsx:89-92 [37bcb60bb758]` (a 2026-10-05 regression note on the rewritten case). | `a9b2cb04a` (barrel export; guard 0 afterwards, `gates-m5/guard-after-fix.txt`) | GREEN (2 listed rows) |

After all merges, `e4e3bf175` is the `api:update` commit. The gate and mutation output commits are `047577392`, `e6b259e2b`, `f335628bf`, `17651311c`, `0bdf6cc15` and `206cc890e`.

## Per-step tests and mutations
Raw: `combine-13-jini-raw/mutations.txt` (13 plants, each with its diff and result). Each was run separately and restored clean.
| step | moved/changed tests after merge | named mutation → result |
|---|---|---|
| C-contracts-core-1.J | core `contracts/site/gated-mutations/__tests__/watermark.unit.test.ts` 3/3 | `stampWatermark` tx guard `if (!tx \|\| !tx.isOpen)` negated → **RED** (3/3 fail) |
| C-contracts-core-2.J | core `contracts/site/__tests__/strict-base64.unit.test.ts` 11/11 (request-facts and soft-delete have no Jini test, as the sheet says) | `decodeStrictBase64` decode guard negated → **RED** (11/11 fail) |
| D-site-export-1.J | devops `static-export/site/__tests__/public-origin-policy.test.ts` 4/4 (characterization test; `ports.ts` is types-only, so the sheet's mutation is impossible, per Codex FIX) | `exportPublicOrigin` `if (evidence.source !== "workspace-setting")` negated → **RED** (1 failed / 3 passed) |
| C-presentation-1.J | cms `presentation/site/__tests__/active-theme-id.unit.test.ts` 4/4 | `if (err instanceof PresentationSettingsNotFoundError)` negated → **RED** (3 failed / 1 passed) |
| RT-3 | agent-plugins `commerce/__tests__/bundled-package.test.mjs` pass 1 / fail 0; scripts `check-package-layers.test.ts` 59/59 | pre-merge `agent-plugins/package.json` restored (the `./commerce/server` export, its `jini.entries` row and the `@jini-ai/commerce` peer) → **RED** (`ℹ fail 1`) |
| C-platform-html-1.J | cms `html/site/__tests__/slug.test.ts` 4/4; `identity-extraction.boundary` 1/1; `integration-package.contract` 5/5; `universal-entries.boundary` 6/6 | `toSlug` `decamelize: false` → `true` → **RED** (2 failed / 2 passed). Mine, for the strengthened universal-entries guard: `@sindresorhus/slugify` removed from cms `dependencies` → **RED** (1 failed / 5 passed) |
| T-post-1.J (partial: 2 of 6 files; 4 BLOCKED on R5-neutrality, see ex-html) | cms `posts/__tests__/slug.test.ts` 3/3 | `slice(0, MAX_SLUG_LENGTH - DERIVED_SLUG_SUFFIX_ROOM)` → `slice(0, MAX_SLUG_LENGTH)` → **RED** (1 failed / 2 passed) |
| SH-2 (ex-sh) | platform `src/fs` 47 files, 922 + 1 skipped | none: the plan says "Mutation: none (no behaviour)", and the diff is comment-only → **NOT-RUN (no behaviour to mutate)** |
| jx-chatlinks | chat `Markdown`, `MarkdownLink`, `own-link`, `Icon` tests and the `chat-pane/__tests__` folder: 53 files, 629 + 1 skipped | (my plants; the branch names none) protocol-relative `//host` counted as own → **RED** (1); origin comparison dropped (any absolute URL is own) → **RED** (14); `MarkdownLink` gives own links a new tab (old rule) → **RED** (5); pane click guard sends own links to a new tab (old rule) → **RED** (3); new-tab icon loses `aria-label`/`title` → **RED** (5) |

## Decisions for the owner
1. **jx-chatlinks fix `a9b2cb04a` adds 2 public exports.** `@jini-ai/chat/react` now exports `currentOrigin` and `isOwnLinkHref`. That is the guard's own remedy (R10: anything ChatPane reaches outside `features/chat-pane/**` must be in the public barrel). The alternative is to move `own-link.ts` under `features/chat-pane/` and have `MarkdownLink` import it from there. Revert and pick that if you don't want these two on the public surface.
   - **jx-chatlinks has no changeset.** It changes behaviour (own-site links no longer open a new tab), adds the `'external-link'` member to `IconName`, and adds the two exports. `api:check` passes because the additions are additive. Add a chat changeset before the next release.
2. **why-comments rows (3, all obsolete with their change, none fixed):**
   - `agent-plugins/core/commerce-server.mjs:1 [f98bce5800b5]` (RT-3 deletes the file)
   - `chat/src/react/components/Markdown.tsx:566-568 [3b87f7959834]` (the 2026-10-08 every-link-new-tab rule; the owner reversed it 11-21, and `MarkdownLink`'s header now records both decisions)
   - `chat/src/react/components/__tests__/Markdown.test.tsx:89-92 [37bcb60bb758]`

   Add debt rows or accept. Combine-12 rows that are still open: `reporter.ts [5f57b7820e73]`, `load-supporting-files [03c2746c1aa4]` and `test-runner.ts [8559987223a2]`.
3. **Branch-report items carried forward (not re-decided here):**
   - ex-core: `extension-capability-vocabulary.ts` is held in Tovu (STOP 5, its test reads an import regex). Add the P9-BREAKS rows to the plan branch (`TOVU_REQUEST_FACTS` → `JINI_REQUEST_FACTS` / `"jiniRequestFacts"`, `TovuRequestFacts` → `RequestFacts`, and the `watermark.ts` message losing `(U-002-B1)`). Decide whether the 40 new `check:cross-package` XP4 rows under `core/src/contracts/site/**` get an allow-list entry. That gate was not in this run's list; it is red on base.
   - ex-export: `public-origin-policy.ts` optional fields widened to `?: string | undefined` (type-only, for `exactOptionalPropertyTypes`). The `['cms','commerce']` payload-peer allowance in `check-package-layers.ts` is now dormant. The `export-failure-summary.ts` cutover is owed by a later step.
   - ex-html: T-post-1.J is PARTIAL. 4 post/tiptap schema files are BLOCKED because their agent-facing descriptions name host tools (`content_read`, …). Either allow those names (`HOST_TOOL_NAMES`) or have the host inject the strings. `./html/site/source-edits` is `node`, not universal (parse5).
4. **RT-3 is a breaking removal** (`@jini-ai/agent-plugins/commerce/server`, 9 symbols). It ships with its own **minor** changeset `p9-rt-3-commerce-server.md`. Tovu has no importer (per ex-export).
5. **Carry-overs unchanged:** combine-12 decisions 1–9, combine-11's list, and the error gate's 24 New + 1 Worse (`--update` not run). Also the cms-forms `package-boundary` BASE-RED (`0.7.2` vs `0.7.3-next.2`).

## Final gates (main tree, at `e4e3bf175`)
| command | base `6b8e0d48a` | final |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | **0** (main tree after merge 3 and at the end; fresh worktree 0) |
| `pnpm --no-bail -r build` | 0, 0 `error TS` | **0**, 0 `error TS` (main tree and fresh worktree `jt13`) |
| `pnpm -r --no-bail --if-present run typecheck` + scripts tsc | 0 / 0 | **0 / 0** |
| `pnpm guard` | 0 (HW3 34; HW9 env 70; advisory 492) | **0**, identical (red at merge 5 before `a9b2cb04a`) |
| size (`SIZE_BASE_REF=6b8e0d48a`) | 1: `redirects.ts` 513, `launch.ts` 952, `createAgentExecutor` 418 + 3 stale json-ipc rows | **1, identical** (BASE-RED) |
| complexity (`COMPLEXITY_BASE_REF=6b8e0d48a`) | 1: `handleRpcError 12`, `readConfirmationResume 11`, `refusalError 11`, `ErrorNotice 11` | **1, identical** (BASE-RED) |
| hooks | 0 | **0** |
| why-comments `--base 6b8e0d48a` | 0 | **1, NEW: 3 lost** (decision 2) |
| why-comments default (terra) | 1, 7 not allow-listed (349 lost / 342 allow-listed) | **1, 10** = base 7 + the 3 rows above |
| log-safety | 1: `http-kit/src/node-bridge.ts`, `ui/…/use-settings-slice-save.hooks.ts` | **1, identical** (BASE-RED) |
| error gate | 0 WARN, 24 New + 1 Worse, 28 improved | **identical** (BASE-RED); `--update` not run |
| `pnpm api:check` | 0 | **0** before `api:update` (`api-check.txt`: chat `IconName` changed, `currentOrigin`/`isOwnLinkHref` added) and after (`gates-final/api-check.txt`; 40 packages, 690 entries, 17229 symbols) |
| `guard:plugins` / `:packed` / `:catalog` | 0 / 0 / 0 (68/68) | **0 / 0 / 0 (68/68)**; catalog generate leaves no diff |

## Tests
These are the full suites of every touched package, run in worktree `jt13` at `e4e3bf175` with `--maxWorkers=2` (`suites/`).
| suite | combine-13 | combine-12 | Δ |
|---|---|---|---|
| core | 2971/2971 | 2957 | +14 (watermark 3, strict-base64 11) |
| devops | 1331/1331 | not run | (+4 public-origin-policy) |
| cms | **2 failed** / 5019 (5021) | 1 failed / 5009 (5010) | +11 (html slug 4, posts slug 3, active-theme-id 4). Reds: forms `package-boundary` (BASE-RED); `create-tables.reference` pglite **5 s timeout under load**: passes alone 2/2 (`cms-pglite-rerun.txt`); ex-html saw the same flake |
| cms/forms | **1 failed** / 156 (157) | same | = (BASE-RED `package-boundary`) |
| platform | 3354 + 6 skipped | same | = |
| chat | 4508 + 1 skipped (4509) | 4491 + 1 | +17 (jx-chatlinks) |
| agent-plugins (vitest) | 2195 + 2 skipped (2197) | same | = |
| agent-plugins node:test (all 111 `*.test.mjs`) | **1396 pass / 0 fail**, all 111 exit 0 | 1396 / 0 | RT-3 reshaped the commerce file (pass 1) |
| scripts `check-package-layers.test.ts` | 59/59 | — | RT-3 touched the script |

Every red line:
- **cms + cms/forms (BASE-RED):** `forms/src/__tests__/package-boundary.test.ts > forms keeps its own published root entry and CMS exposes no forms alias`. It expects version `0.7.3-next.2` and gets `0.7.2` (combine-11 decision 6).
- **cms (load flake, not BASE-RED in combine-12):** `src/forms/__tests__/create-tables.reference.test.ts > pglite: createFormsTables matches the reference DDL's catalog`. `Test timed out in 5000ms` in the full run while the main-tree gates ran in parallel; it passes alone (2/2). No merged branch touches `src/forms`.
- **guard (fixed, `a9b2cb04a`):** two `R10-chatpane-public-surface` rows for `useChatPaneNewTabLinks.hooks.ts` (`currentOrigin`, `isOwnLinkHref`).
- **Ratchets (listed, not fixed):** why-comments 3 lost under `--base` and 3 new under default (decision 2). All other ratchet reds are BASE-RED, as in the gates table.
- **Not run** (no merged branch touches them, unchanged since combine-12): the other scripts vitest, `test:scripts:node`, examples, untouched packages, e2e/playwright, knip/sonar/depcruise, Actions. `check:cross-package` is not on this run's gate list; the branch reports cover it.

## New exports the Tovu run must consume
Diff of `api-baseline/` from `6b8e0d48a` to HEAD (`api-baseline-diff-vs-base.txt`). The C/D/T .T halves repoint Tovu importers to these.
- **@jini-ai/core** (C-contracts-core-1/2):
  - `./contracts/site/post-author`: `postAuthorForDisplay` (universal)
  - `./contracts/site/request-facts`: `JINI_REQUEST_FACTS` (= `"jiniRequestFacts"`, was Tovu's `TOVU_REQUEST_FACTS`), `RequestFacts` (was `TovuRequestFacts`), `readRequestFacts` (universal)
  - `./contracts/site/soft-delete`: `isTrashed` (universal)
  - `./contracts/site/strict-base64`: `decodeStrictBase64` (**node**, uses `Buffer`)
  - `contracts/site/gated-mutations/watermark.ts` is private (no export)
- **@jini-ai/devops** (D-site-export-1):
  - `./static-export/site/ports`: `ManifestActiveTheme`, `ManifestRoute`, `ManifestRouteKind`, `ManifestSkip`, `RouteManifest` (types)
  - `./static-export/site/public-origin-policy`: `exportPublicOrigin`, `rewriteRenderOrigins`, `rewriteExportOriginResponse` (universal; optional origin fields are `?: string | undefined`)
- **@jini-ai/cms**:
  - `./presentation/site/active-theme-id`: `resolveActiveThemeId`, `ActiveThemeIdResolutionDeps` (C-presentation-1)
  - `./html/site/slug`: `toSlug` (universal)
  - `./html/site/source-edits`: `editedHtml`, `elements`, `attribute`, `Edit`, `Element` (**node**) (C-platform-html-1; `escape.ts` retires to the existing `@jini-ai/core/text`)
  - `./posts/post-before-save`: `runBeforeSaveHook`, `mergeExt`, `withCoverPresentation`, `BeforeSaveHookPort`, `BeforeSaveEntryDraft`
  - `./posts/slug`: `derivePostSlugBase`, `isAutomaticPostSlug`, `MAX_SLUG_LENGTH`, `DERIVED_SLUG_SUFFIX_ROOM`, `SLUG_FORMAT_PATTERN` (T-post-1, partial; **no** `./posts/post-tool-schemas` or `./posts/tiptap-doc-schema`)
  - new runtime dependency `@sindresorhus/slugify ^3.0.1`
- **@jini-ai/chat `./react`** (jx-chatlinks):
  - `IconName` gains `'external-link'`
  - new `currentOrigin()` and `isOwnLinkHref({ href, origin })`
  - Behaviour: markdown links to the page's own origin (or an in-app `/path`) navigate in place with a labelled ↗ new-tab icon. Other sites still open a new tab. The pane click guard leaves own links to the browser or router (the admin link handler keeps the dock).
- **@jini-ai/agent-plugins** (RT-3, **removed**): `./commerce/server` (`createCommerceServer`, `readOwnedCommerceOrder`, `normalizedCommerceOrigin`, `CommerceUnavailableError`, 5 types) and the optional `@jini-ai/commerce` peer. Tovu has no importer.
- **@jini-ai/platform**: no API change (doc comment on `resolvePathWithin` only).
- Package versions are unchanged. Nothing was bumped or published.

## Left / next
1. Owner: decisions 1–5. First, a chat changeset and the barrel-vs-move call for jx-chatlinks. Second, the why-comment rows.
2. Owed elsewhere: the .T halves of C-platform-html-1 and T-post-1. T-post-1's 4 BLOCKED files. `extension-capability-vocabulary` (STOP 5). P9-BREAKS rows on the plan branch. A release (no bump, no tag, no publish here).
3. Not run: see "Not run" under Tests.

## Raw outputs (`cloud-results/combine-13-jini-raw/`)
- `gates-{base,m1..m5,final}/`: build, tsc, guard, size, complexity, hooks, why-base, why-default, log-safety, error-gate. Plugin guards at base and final; `gates-m5/guard-after-fix.txt`.
- `mutations.txt`: 13 plants, each with its diff and result.
- `api-check.txt`, `api-update.txt`, `api-baseline-diff.txt` (this run's update), `api-baseline-diff-vs-base.txt` (all of combine-13), `install-final.txt`.
- `suites/`: one file per package, `agent-plugins-node-test.txt` (111 files), `scripts-package-layers.txt`, `cms-pglite-rerun.txt`, `_install.txt`.

## Pushed SHAs (`integ/merge-13-2026-11-22`, first-parent order)
- `047577392` wip(cloud): combine-13 base gates at 6b8e0d48a
- `5b5492de5` Merge codex/ex-core-jini (7a621602a)
- `e6b259e2b` wip(cloud): gates + mutations after merge 1
- `6d9e99dc2` Merge codex/ex-export-jini (3985c6cb8)
- `f335628bf` wip(cloud): gates + mutations after merge 2
- `2bc061908` Merge codex/ex-html-jini (5fab76617)
- `17651311c` wip(cloud): gates + mutations after merge 3
- `fddb96339` Merge codex/ex-sh-jini (c984e9dcf)
- `0bdf6cc15` wip(cloud): gates after merge 4
- `351211d6a` Merge codex/jx-chatlinks (b6e9573f5)
- `a9b2cb04a` fix(chat): export currentOrigin/isOwnLinkHref from the react barrel (guard R10)
- `e4e3bf175` chore(api): api:update after combine-13 merges
- `206cc890e` wip(cloud): combine-13 final gates
- (next) docs(cloud): combine-13 Jini report, suites and raw outputs
