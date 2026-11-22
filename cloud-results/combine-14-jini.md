READY 190860f22

**`integ/merge-14-2026-11-22`**. The last content commit is `190860f22`, the merge 4 commit. Every commit after it only adds gate output and this report, and `api:update` changed nothing. All 4 branches merged with **no conflicts**. Every gate is **identical to base**: build, typecheck, guard, `api:check`, the three plugin guards, size, complexity, hooks, why-comments (both bases), log-safety, the error gate and XP. **All 4 branches' named mutations were run (5 plants) and all 5 went RED.** No fix commits were needed.

# combine-14 JINI (2026-11-22): `integ/merge-14-2026-11-22`

Unattended cloud run, started 20:22 UTC, well inside the 2.5 h cap.
- **Base:** `origin/integ/merge-13-2026-11-22` = `7c4ee7881` (verified).
- **Tools:** Node v24.22.3 (`/opt/node24`), pnpm 10.33.2.
- **Not used:** subagents, codebase-memory tools, force-push, `--no-verify`, publish, tags, version bumps, new changesets.
- **Pushed:** only this branch, always with a plain `git push`. Each push was preceded by `git pull --ff-only`, which was always a no-op.
- **Untouched:** `main`, `plan/*`, `release/*`, `refactor/terra` (fetched only, as the default why-comments base). Tovu was not opened. The branch reports read were the four `cloud-results/ex2-*-jini.md` on the Jini branches.

## Method
Setup followed combine-13's `cloud-results/combine-13-jini.md` Method.
- **Clone setup:** the clone was shallow, so I unshallowed it (fetch only) and fetched `origin/refactor/terra` = `6c9effae4`.
- **Base, on the unmodified tree:** `pnpm install --frozen-lockfile` 0, then `pnpm --no-bail -r build` 0 (0 `error TS`). After that, every gate listed under "Final gates", in `gates-base/`.
- **Base matches combine-13's final:**
  - size: 3 lines + 3 stale json-ipc rows
  - complexity: 4
  - log-safety: same rows
  - error gate: 24 New + 1 Worse, 28 improved
  - why-comments: default 10 not allow-listed; `--base 7c4ee7881` 0
  - guard: HW3 34, HW9 env 70, advisory 492
  - `api:check`: 690 entries, 17229 symbols
  - plugin guards: 0 / 0 / 0
- **Base for the XP gate:** `pnpm check:cross-package` (`--base 35c4961af`) gives EXIT 1, 2894 lines (XP1 39, XP2 33, XP3 2050, XP4 760, XP5 6). XP3 here is mostly `absolute JINI_DECLARATION_BASELINE_DIR required`, because this cloud clone has no declaration snapshot. So I also built that snapshot: a worktree at `35c4961af`, then frozen install, core build, recursive build, and this branch's script with `--write-baseline` (3308 source mappings). I ran the gate with `JINI_DECLARATION_BASELINE_DIR` against a built base worktree (`7c4ee7881`) and against final. The results are in `xp-snapshot-{base,final}.txt`.
- **Merges:** `git merge --no-ff`, in the given order, in the main tree. After each merge (in `gates-m<N>/`):
  - frozen install
  - `pnpm --no-bail --filter "...[<pre-merge>]" build`
  - `tsc -p tsconfig.json --noEmit` in every package the merge changed
  - `pnpm guard`
  - `check-size` / `check-complexity`, with base ref `7c4ee7881`
  - `check-hook-injection`
  - `check-why-comments --base 7c4ee7881`, plus the default (terra)
  - `check-log-safety`, `check-error-gate` and `check:cross-package`

  Each was diffed against base, with the "N files" counts normalized. The branch was pushed after each merge.
- **Mutations:** each branch's named mutation from its `cloud-results/ex2-*-jini.md`. One plant per run, by exact string replacement. Each mutated file was restored by byte copy and confirmed with `git diff --quiet -- packages`; every diff and result is in `mutations.txt`. For M2 the "restored clean" echo was skipped, because `mutations.txt` itself is tracked. I verified the restore afterwards: `git diff origin/codex/ex2-k4-seam-1-jini HEAD` over the seam-1 files is empty.
- **Owner args rule:** in all 4 branches, `git diff 7c4ee7881...<tip>` has **no removed line containing `_optional`**. i18n-common adds 1, rt-k1-0 adds 3 and a-k2-0a adds 3. `git diff 7c4ee7881 HEAD` removes none either.

## Merges
| # | branch (tip) | merge commit | conflicts → resolution | per-merge gates | moved/new tests | named mutation → result | status |
|---|---|---|---|---|---|---|---|
| 1 | `origin/codex/ex2-k4-i18n-common-jini` `8d17019b5` (4 commits) | `f9131817e` | none | install 0; filtered build 0 (0 `error TS`); tsc admin 0; **all ratchets, guard and XP = base** | admin `core/__tests__/i18n-common.test.ts` 8/8 | delete `es.Save` (`Save: "Guardar",`) in `admin/src/core/i18n-common-base.ts` → **RED**, 3 failed / 5 passed (key parity, three pinned keys, Spanish Save verbatim) | GREEN |
| 2 | `origin/codex/ex2-k4-seam-1-jini` `4504b8950` (6) | `d1179bea3` | none | build 0; tsc core 0, daemon 0; **= base** | core `tool-metadata-approval-policy.unit` + `daemon-surface-exchanges.unit` 3/3; daemon `surface-deps-core-contract` 1/1 | (a) `rule?: Rule` → `rule?: never`: **RED**, core tsc 2 (TS2322 at `tool-metadata-approval-policy.unit.test.ts(16,86)`). (b) `surfaceExchanges` → `surfaceExchangeStore` in the core contract: **RED**, core tsc 2 (TS2561 and TS2551), then with core re-emitted daemon tsc 2 (TS2741 ×2 in `surface-deps-core-contract.test.ts`). Both are type-level: the vitest run stays green under (a), as the branch report says. Restored, core rebuilt, core/daemon tsc 0 | GREEN |
| 3 | `origin/codex/ex2-rt-k1-0-jini` `66310ee7d` (10) | `f97777b50` | none | build 0; tsc cms 0, core 0; **= base** | core `errors/__tests__/route-refusal.test.ts` 4/4 | `rejectRoute` drops `if (required.code !== undefined) body.code = required.code;` → **RED**, 1 failed / 3 passed ("carries the exact response for a 403 with code and permission details") | GREEN |
| 4 | `origin/codex/ex2-a-k2-0a-jini` `44ee815ef` (8) | `190860f22` | none (`api-baseline/jini-ai__admin.json` also changed by merge 1; auto-merged, and the union was verified below) | build 0; tsc admin 0; **= base** | admin `react/__tests__/kit.unit.test.tsx` 10/10 | `useT` facade → `useAdminKit().hooks.useT(); return (key) => key;` → **RED**, 2 failed / 8 passed (both identity cases) | GREEN |

Other shared files: none. Each branch adds its own changeset:
- `p9-k4-i18n-common.md`: admin patch
- `p9-k4-seam-1.md`: core patch
- `p9k-rt-k1-0.md`: core + cms patch
- `admin-kit-icon-ui-t-values.md`: admin **minor**

`pnpm-lock.yaml` is untouched by all four.

**API:**
- `pnpm api:check` after merge 4, before any update: exit 0 (695 entries, 17245 symbols).
- `pnpm api:update` writes **no diff**: each branch committed its own baseline, and the merged baselines are already the exact union.
- `git diff 7c4ee7881 HEAD -- api-baseline/` (`api-baseline-diff-vs-base.txt`) contains only the four branches' entries, listed under "Exported-API delta".

## Final gates (main tree, at the final gates commit; content = `190860f22`)
| command | base `7c4ee7881` | final |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | **0** |
| `pnpm --no-bail -r build` | 0, 0 `error TS` | **0**, 0 `error TS` |
| `pnpm -r --no-bail --if-present run typecheck` + scripts tsc | 0 / 0 | **0 / 0** (the only diff is line order) |
| `pnpm guard` | 0 (HW3 34; HW9 env 70; advisory 492) | **0, identical** |
| size (`SIZE_BASE_REF=7c4ee7881`) | 1: `redirects.ts` 513, `launch.ts` 952, `createAgentExecutor` 418, + 3 stale json-ipc rows | **1, identical** (BASE-RED) |
| complexity (`COMPLEXITY_BASE_REF=7c4ee7881`) | 1: `handleRpcError 12`, `readConfirmationResume 11`, `refusalError 11`, `ErrorNotice 11` | **1, identical** (BASE-RED) |
| hooks | 0 | **0** |
| why-comments `--base 7c4ee7881` | 0 | **0** |
| why-comments default (terra) | 1, 10 not allow-listed (352 lost / 342 allow-listed) | **1, identical** (BASE-RED; combine-13 decision-2 rows) |
| log-safety | 1 (same rows as combine-13) | **1, identical** (BASE-RED) |
| error gate | 0 WARN, 24 New + 1 Worse, 28 improved | **identical** (BASE-RED); `--update` not run |
| `check:cross-package` (XP1–XP5, `--base 35c4961af`) | 1: XP1 39 / XP2 33 / XP3 2050 / XP4 760 / XP5 6 | **1, identical** (BASE-RED). No finding names a file these merges add. **With the declaration snapshot:** base and final are **byte-identical** (path-normalized): XP1 39 / XP2 33 / XP3 112 / XP4 760 / XP5 6, all BASE-RED. |
| `pnpm api:check` | 0 (690 entries, 17229 symbols) | **0** (695 entries, 17245 symbols: +5 entries, +16 symbols) |
| `guard:plugins` / `:packed` / `:catalog` | 0 / 0 / 0 (68/68) | **0 / 0 / 0 (68/68)**; catalog generate leaves no diff |

## Tests
Full suites of every touched package, plus the dependents whose code paths the merges can reach, run in the main tree at `190860f22` content (`npm run test -- --maxWorkers=3`, in `suites/`).
- **Scope reasoning:**
  - core and cms changes are **additive new subpath modules only** (new files plus new `exports`). No existing symbol changed, so their 40-odd transitive dependents cannot observe a difference. Their own suites ran in full.
  - The daemon change to `tool-recovery/recovery.ts` is **comment-only** (+1 new test).
  - admin changed `AdminKit`'s required shape. Its dependents are user-management and examples/neutral-host, and both ran.

| suite | combine-14 | combine-13 / branch report | Δ |
|---|---|---|---|
| admin | 3087/3087 (252 files) | 3077 at base (a-k2-0a report) | +10: i18n-common 8, kit 2 |
| user-management (admin dependent) | 1353/1353 (116 files) | 1353 (a-k2-0a) | = |
| examples/neutral-host (admin dependent) | **1 failed** / 38 passed + 13 todo (52) | not run in combine-13 | BASE-RED, see below |
| core | 2978/2978 (219 files) | 2971 | +7: seam-1 3, route-refusal 4 |
| daemon | 4855 + 1 skipped (4856) | — | includes seam-1's `surface-deps-core-contract` 1 |
| cms | **1 failed** / 5020 (5021) | 2 failed / 5019 (5021) | = total. The only red is BASE-RED `package-boundary`. The combine-13 pglite load flake passed this run |
| cms/forms | **1 failed** / 156 (157) | same | = (BASE-RED) |

## Exported-API delta the Tovu halves must consume
These come from `api-baseline-diff-vs-base.txt`. Package versions are unchanged, and nothing was bumped or published. Link Tovu against a Jini build of this branch, and rebuild core, cms and admin so the new `dist/` subpaths resolve.

- **K4-i18n-common.T** (`@jini-ai/admin`, patch):
  - New entry `./core/i18n-common` → `ADMIN_COMMON_I18N` (`Record<string, Record<string, string>>`, the same 21 locales in Tovu's order).
  - Import: `import { ADMIN_COMMON_I18N } from "@jini-ai/admin/core/i18n-common";`
  - Compose as `{ ...ADMIN_COMMON_I18N[locale], ...hostEntries[locale] }`. Tovu keeps the one branded key (`COMMON_EXTRA_KEYS` index 27).
  - Tovu's mutation target is Jini's `packages/admin/src/core/i18n-common-base.ts` `es.Save`.
- **K4-seam-1.T** (`@jini-ai/core`, patch; type-only):
  - `./contracts/site/tool-metadata-approval-policy` → `ToolApprovalPolicy<Rule extends string = string>` (interface; extends `ToolApprovalMetadata`; `rule?: Rule` is host-owned) and `ToolApprovalClass` (= `ToolApprovalMetadata["class"]`).
  - `./contracts/site/daemon-surface-exchanges` → `AssistantSurfaceDeps` (`{ readonly surfaceExchanges: SurfaceExchangeStore }`). This is an additive copy, and `@jini-ai/daemon/surface-exchanges` keeps its own identical one until B6. B6 deletes the daemon declaration and `daemon/src/__tests__/surface-deps-core-contract.test.ts` together.
  - T in B3 is approval-only. Tovu keeps its six-rule union and owner-policy docblock and specializes `ToolApprovalPolicy<TovuApprovalRule>`.
- **RT-K1-0.T** (`@jini-ai/core` + `@jini-ai/cms`, patch):
  - `@jini-ai/core/errors/route-refusal` → `RouteRefusalError` (class) and `rejectRoute` (function). These are drop-ins for `SettingsRequestError` / `rejectSettingsRequest`, with the same message, `.response.status/body` and `_optional` pad. Use **this** specifier, **not** `@jini-ai/core/contracts/server`; the branch's first-pass section is superseded by its "Review fixes".
  - `@jini-ai/cms/admin-http/limits` → `CONTENT_ENTRY_MAX_BODY_BYTES` (1 MiB; universal).
  - No http-kit or `json-route` behaviour change. Express body enforcement stays in Tovu middleware. Returned-vs-thrown `onError` parity moves to BX-53/54.
- **A-K2-0a.T** (`@jini-ai/admin`, **minor**; breaking for hosts):
  - `./react/kit`: **new** `Icon`, `useT`, `useAdminKitValues`, `IconProps`, `KitIconName`, `KitTranslator`, `AdminKitValues`, `KitDictionaries` and `KitNotificationsPreferences`.
  - `./react/kit`: **changed** `AdminKit`, `AdminKitComponents` and `AdminKitHooks`. They now **require** `components.Icon`, `hooks.useT` and `values`.
  - Tovu's `satisfies AdminKit` in `apps/admin/src/integrations/jini-kits.ts` turns red until the host assigns those three. Land both halves as a pair. The binding comes from `@jini-ai/ui` (`Icon`, `useT`, `SETTINGS_DIALOG_DICTIONARIES`, `DEFAULT_NOTIFICATIONS_PREFERENCES`) and `@jini-ai/ui/panel-kit` (`UNREACHABLE_RETRY_DELAYS_MS`, `LOCAL_BACKUP_PRINCIPAL_ID`).
  - `fakeAdminKit` in `./react/testing-kit` accepts `components.Icon`, `hooks.useT` and `values`.
  - Kit `useT` is the **UI** translator. Chat's (`useChatT`) stays distinct. `KitIconName` is a closed subset.

## Every red line
- **cms + cms/forms (BASE-RED, same as combine-13):** `forms/src/__tests__/package-boundary.test.ts > forms keeps its own published root entry and CMS exposes no forms alias`. It expects version `0.7.3-next.2` and gets `0.7.2`.
- **examples/neutral-host (BASE-RED by construction, new to these reports because combine-13 did not run it):** `src/contribution-contracts.test.ts > contribution contracts > walks every contribution file, and each kind is in the contract table`, `expected 0 to be greater than or equal to 27`.
  - Cause: the test walks `packages/agent-plugins/*/tovu-*.json` (`PREFIX = 'tovu-'`, line 33). Base commit `d9c625e6d` (2026-11-20, "remove Tovu names") renamed those files to `jini-*.json`, so it finds 0.
  - `git diff 7c4ee7881 190860f22 -- examples packages/agent-plugins` is empty, so none of the four merges is involved.
  - Not fixed. The likely one-line fix is `PREFIX = 'jini-'`. With it, the 13 `todo`/per-file cases would start running for real, so the owner should check them when it lands.
- **Ratchets:** size, complexity, log-safety, why-comments default, the error gate (WARN) and XP are all BASE-RED and **identical** to base after every merge and at final (see the gates table). There are no new rows.
- **Mutations (intended reds):** M1 3 failed; M2a core tsc TS2322; M2b core tsc TS2561/TS2551 + daemon tsc TS2741 ×2; M3 1 failed; M4 2 failed. All were restored, and the suites were green afterwards.
- **Not run** (no merged branch touches them): untouched packages' suites, the dependents of core/cms beyond the above (the change is additive), scripts vitest / `test:scripts:node`, agent-plugins node:test, e2e/playwright, knip/sonar/depcruise and Actions.

## Minor findings (listed, not fixed)
From this run:
1. `check:cross-package` cannot evaluate XP3 in a cloud clone unless `JINI_DECLARATION_BASELINE_DIR` is set; without it, 2050 XP3 rows are the "required" error. This run built the snapshot (see Method), and with it XP is unchanged by all four merges. XP4 still flags every `__tests__` file under `core/src/contracts/**`. This includes merge-13's `strict-base64.unit.test.ts`, but none of this run's files: seam-1's tests live in `core/src/__tests__`, and rt-k1-0 moved its runtime to `core/src/errors`.
2. `p9-k4-seam-1.md` and `p9k-rt-k1-0.md` both bump `@jini-ai/core` patch, and `p9-k4-i18n-common.md` (patch) plus `admin-kit-icon-ui-t-values.md` (**minor**) both bump `@jini-ai/admin`. Changesets collapses each pair. The admin minor is the breaking `AdminKit` requirement, so it may deserve a louder note in the release.

Carried from the branch reports, not re-decided here:
- **K4-i18n-common:**
  - `admin/src/widgets/react/__tests__/fixtures/common-i18n.ts` is a 682-line copy of the host's dictionary, branded entry included. It could import `ADMIN_COMMON_I18N`.
  - The base block is split into `i18n-common-base.ts` rather than given a size exception. Owner's call.
  - The moved why-comments name host files as context.
- **K4-seam-1:**
  - `AssistantSurfaceDeps` is declared twice during the additive window (B6 cleanup).
  - The XP4-for-contract-tests owner call is still open.
- **RT-K1-0:**
  - `RouteRefusalError`'s message is still `"settings request rejected"` (verbatim).
  - Same-origin refusals still bypass `onError`.
  - `route-refusal.ts` keeps double quotes and the positional `readonly response` parameter (verbatim).
- **A-K2-0a:**
  - The dispatch-named sheet `plans/P9-steps/A-K2-0a.md` does not exist; the 0a row is in `A-K2-0.md`.
  - The `slot()` facade always passes `ref`.
  - The kit's `TabBarTab` lacks `disabled`, `dot` and `dotLabel`. Do not repoint callers that use them (for example `StaticSiteTab.tsx`) until 0c/B5.
- **Combine-13 carry-overs:** decisions 1–5, including the jx-chatlinks changeset and barrel-vs-move call, the why-comment debt rows, T-post-1's 4 BLOCKED files and the cms-forms `package-boundary` BASE-RED.

## Raw outputs (`cloud-results/combine-14-jini-raw/`)
- `gates-{base,m1..m4,final}/`: install, build, tsc, guard, size, complexity, hooks, why-base, why-default, log-safety, error-gate, cross-package. Base and final also have typecheck, tsc-scripts, api-check and the three plugin guards.
- `mutations.txt`: 5 plants (the 4 branches' named mutations; K4-seam-1 has two), each with its diff and result.
- `api-check-premerge-update.txt`, `api-update.txt` (no-op), `api-baseline-diff-vs-base.txt`.
- `suites/`: one file per package, and `_summary.txt`.
- `xp-snapshot-base.txt`, `xp-snapshot-final.txt`: XP1–XP5 against the `35c4961af` declaration snapshot.

## Pushed SHAs (`integ/merge-14-2026-11-22`, first-parent order)
- `3471656f3` wip(cloud): combine-14 base gates at 7c4ee7881
- `f9131817e` Merge codex/ex2-k4-i18n-common-jini (8d17019b5): ADMIN_COMMON_I18N in @jini-ai/admin into integ/merge-14
- `b9238ece5` wip(cloud): combine-14 gates + mutation after merge 1 (k4-i18n-common)
- `d1179bea3` Merge codex/ex2-k4-seam-1-jini (4504b8950): approval + daemon-surface contract types in core into integ/merge-14
- `3f02105d7` wip(cloud): combine-14 gates + mutations after merge 2 (k4-seam-1)
- `f97777b50` Merge codex/ex2-rt-k1-0-jini (66310ee7d): RouteRefusalError/rejectRoute in core errors/route-refusal, cms admin-http/limits into integ/merge-14
- `4f1883079` wip(cloud): combine-14 gates + mutation after merge 3 (rt-k1-0)
- `190860f22` Merge codex/ex2-a-k2-0a-jini (44ee815ef): admin kit Icon/useT/injected values into integ/merge-14
- `df8b367ba` wip(cloud): combine-14 gates + mutation after merge 4 (a-k2-0a)
- `69e23644e` wip(cloud): combine-14 final gates (build, typecheck, ratchets, api:check, plugin guards); api:update no-op
- `405fdd70f` wip(cloud): combine-14 suites (admin, user-management, neutral-host, core) + report draft
- `30b925e4b` wip(cloud): combine-14 daemon suite output
- (this commit) docs(cloud): combine-14 Jini report, XP snapshot runs and final suites
