PARTIAL d340f0dd6e b00c6cda6: lane blocked on FOUNDATION; steps left = all lane steps except X-trash-1 (DONE apart from 1 log helper) and the import-ready slices of K5-publish-content-1 / K5-source-control-1 / K5-domain-dns-1 / K5-deployments-1 / K5-site-backup-1 (see "Steps skipped")

# ex4-deploy — Deployment, Source Control, Database, Recovery, Trash, Site Backup and Export (2026-11-22)

Unattended cloud run, Opus high.

**Result:** this lane **cannot be finished from these bases**. Almost every remaining step needs FOUNDATION work that has not landed: the `K4-seam-*` T halves, `K5-contracts-core-*`/`-headless-2`, the admin shell-lib and other bases, `X-identity-1` and `X-vendor-credentials-1`. This run moved what could move cleanly: **19 Tovu source files and 4 tests**. Tovu deleted every moved file and repointed its importers, with no re-export shells.

**FILES-LEFT:**
- All areas: **2,486 → 2,467 (−19)**.
- Excluding the theme areas: **2,375 → 2,356**.
- This lane's areas: **308 → 289**.

**No new red anywhere:**
- Every Jini and Tovu gate equals base.
- Every red test is BASE-RED with identical pass/fail counts.

**Four moves were reverted after the gates caught them.** Each was a plan-sheet destination that breaks a Jini rule. They are listed under Findings, and they are why the count is 19 and not 23.

## Branches and SHAs (all pushed with a plain `git push`, `git pull --rebase` first, always a no-op)
**Jini `codex/ex4-deploy-jini`** (base `4902a6a1a`):

| SHA | commit |
|---|---|
| `9688a83cb` | X-trash-1.J move |
| `ac5bf3e67` | `exactOptionalPropertyTypes` fix + api baseline |
| `add0e9a66` | A-adm-publish-content-1.J store (reverted in `d87d4d004`) |
| `f5be6cb7c` | K5-publish-content-1.J, 7 modules |
| `d2e038d1f` | devops/db batch |
| `f6758fe00` | peer-url |
| `d87d4d004` | revert media-references + store; content-hash entry set to `node` |
| `91cd4b979` | revert plan-store |
| `b00c6cda6` | revert directory-rollback-log |

The copy of this report on Jini is the commit after these.

**Tovu `codex/ex4-deploy-tovu`** (base `f7185f153` = `0d7f78fa4` + the combine-13 docs commit):

| SHA | commit |
|---|---|
| `916b0c9067` | X-trash-1.T |
| `388a03d668` | A-adm-publish-content-1.T, reverted by `58a93b6536` |
| `607a63badd` | K5-publish-content-1.T |
| `84aac59c56` | devops/db batch T |
| `862bb1244c` | peer-url T |
| `abd203be4f` | media-references back |
| `a6c4651a3b` | planner-hash-upgrade mock target fix |
| `38c2c851a7` | 5 why-comments "Moved to Jini" rows |
| `fe486cb52f` | plan-store back |
| `d340f0dd6e` | directory-rollback-log back |

This report is the commit after these.

## Setup (as combine-13 Setup, linked to this Jini branch)
- Node 24.22.3 (`/opt/node24`, sha256-checked), pnpm 10.33.2.
- Jini: `pnpm install --frozen-lockfile` 0; `pnpm --no-bail -r build` 0, with 0 `error TS`. Changed packages were rebuilt after every Jini commit.
- Tovu: `npm ci --ignore-scripts` in root, admin, desktop and site-chat: 0/0/0/0. `link-jini.mjs` against this branch: 0, re-run after each Jini commit. `packages/contracts` tsc 0; sdk build 0.
- **Tovu base gates and base attribution** ran in a clean `git worktree` at the base. It shares `node_modules`, so it is linked to this branch, whose Jini changes are additive exports only.
- **Jini base:** combine-14's recorded `gates-final`. It is the same tree, and that report found every gate equal to base.
- `origin/refactor/terra` was fetched for the why-comments base.
- **Not set up:** PostgreSQL. `*.postgres`/`*.dialects` files run without it on both trees, so they compare equally.
- **Not used:** subagents, codebase-memory tools, force-push, `--no-verify`, tags, publish, any new `_optional` change.
- **Untouched:** `main`, `integ/*`, `plan/*` and `release/*` were fetched only.

## Steps done

| step | files moved (Tovu → Jini) | importers | tests | mutation | status |
|---|---|---|---|---|---|
| **X-trash-1** | 7 of 8 → `@jini-ai/cms/trash/site/*`: `adapters/{plugin,theme}`, `ports`, `registry`, `remove-without-blocker`, `scheduler.node` (entry `node`), `widget-removal` | 73 files: every sheet line, plus 28 barrel users split off `features/trash/index` (barrel lines deleted), plus 1 relative barrel user (`entries/unreadable-owner-entries-repair.ts`) that the sheet missed | Moved: `not-trashed`, `remove-without-blocker` (Jini 5/5). Stays in Tovu: `directory-adapter.test` (uses `t.mock.method`/`t.after`) | Registry form entry marker timestamp → status: `not-trashed` 1 RED, restored 5/5 (`ex4-deploy-raw/x-trash-1-mutation.txt`). The sheet's "first `if (`" does not exist in `registry.ts` | DONE except `directory-rollback-log.ts` (reverted, log-safety). J adaptation: `widget-removal.ts` passes `{}` when `priorMarker` is undefined, because Jini compiles with `exactOptionalPropertyTypes`. Same behaviour; why-comment added |
| **K5-publish-content-1** (partial) | 7 of 11 → `@jini-ai/cms/publish/content/*`: `baseline-repo`, `content-hash` (entry `node`, it uses `node:crypto`), `execute-import`, `precheck-reasons`, `publish-readiness`, `report-contract`, `peer-url` | 95 + 6 specifiers, no barrel lines. Fix `a6c4651a3b`: `planner-hash-upgrade.test` mocked `content-hash` by file URL; it now mocks `import.meta.resolve('@jini-ai/cms/publish/content/content-hash')` (module target only) | Moved: `content-hash`, `execute-import`. Stays in Tovu: `peer-url.test` (fixtures use the product hostname). New Jini `peer-url` characterization test, written after the copy | `peer-url` first `if` negated: 1 RED, restored 48/48 (`k5-pc1b-mutation.txt`). The earlier media-references plant (6 RED) is moot: that file was reverted | PARTIAL. Comments reworded for N1/N2 in `publish-readiness` (1) and `peer-url` (4) |
| **K5-source-control-1** (partial) | 2 of 12 → `@jini-ai/devops/source-control/site/{commit-schema,credential-form}` | in the devops batch, 16 specifiers in all | `credential-form.unit` moved (8/8) | `credential-form` first `if` negated: 4 RED, restored 8/8 (`k5-sc1-mutation.txt`). The sheet names `provider-module.ts`, which is not import-ready | PARTIAL |
| **K5-domain-dns-1** (partial) | 1 of 10 → `@jini-ai/devops/dns/site/mail-requirements` | devops batch | `mail-requirements.test` stays in Tovu (needs its `dns-fakes` helper); green in the suite | not run separately; the batch mutation above covers the batch commit | PARTIAL |
| **K5-deployments-1** (partial) | 1 of 15 → `@jini-ai/devops/deploy/site/types`. The `deployments/index.ts` type re-export was deleted; it had no users | devops batch | type-only file; typecheck and typecheck:tests 0 | type-only (no runtime) | PARTIAL. Comment reworded (N1) |
| **K5-site-backup-1** (partial) | 1 of 8 → `@jini-ai/devops/backup/site/share-export-failure` | devops batch | importers' tests green in the suite | not run separately | PARTIAL |

Changesets: `.changeset/p9-x-trash-1.md`, `p9-k5-publish-content-1.md`, `p9-k5-publish-content-1-peer-url.md`, `p9-k5-{source-control,domain-dns,deployments,site-backup}-1.md` (patch).

`api-baseline/jini-ai__{cms,devops}.json` gain only the new subpaths. The db and admin baselines are back to base after the reverts.

## Moves made and then reverted (all byte-identical to base again in Tovu)

| file | caught by | why it cannot move as the sheet says |
|---|---|---|
| `publish-content/media-references.ts` (K5-publish-content-1) | Jini `guard` SI-domain | cms `publish` would reach the `widgets` domain's `markers/gallery.ts`, which `jini.isolation.shared` does not list. Fix needs an isolation decision or a different destination |
| `admin publish-content/hooks/publish-availability.store.ts` (A-adm-publish-content-1) | Jini `guard` HW3-module-state ×2 | Module-level store; the hardwiring debt is shrink-only. Needs an instance-owned store, which is a behaviour change |
| `database-transfer/plan-store.ts` (K5-database-transfer-1) | Jini db `loads-without-driver.test` | The test pins db's exact subpath list (22 → 23). The file is a 3-line singleton of a class Jini already exports |
| `trash/directory-rollback-log.ts` (X-trash-1) | Jini `check:log-safety` (new raw log path) | A direct `console.error` sink; Jini allows console only in sanctioned sinks. Fix needs an injected logger, which is a new port |

## Steps skipped, and why
**STOP (owner decision or correction needed):**
- **X-database-transfer-1:**
  - `table-catalog.ts` is a COLLISION that differs from Jini `db/transfer/table-catalog.ts`: Tovu's is drizzle/schema-driven, Jini's is generic (STOP 4).
  - `transfer-messages.ts` is product copy for the tools, which says "this site" (STOP 3).
  - `exclusions.ts` is the host's table-by-table exclusion policy (owner decision Q2), not portable.
- **X-permanent-delete-1:** `agent-tools.ts` is model-facing guidance wording with owner policy Q1 (STOP 3). `tool-registrations.ts:100` and `development/parity/tool-guides.json` also cite its path as the catalog module.
- **P-publish-trust-1:** the plan's literal renames break the host:
  - `TOVU_PUBLISH_TRUST` → `JINI_*` breaks the pinned assertion `frozen-values.pins.test.ts:115`.
  - `TOVU_REPO_ROOT` → `JINI_*` breaks the desktop shell's env handoff (`apps/desktop/src/tovu-server.ts:643`, `smoke-packaged-chat.ts`) and its tests.
  - Worst, operators who disabled publishing with `TOVU_PUBLISH_TRUST=""` would silently fall back to the committed file, which **fails open**.
  - Needs an injected env-var name or an owner decision.
- **A-adm-publish-content-1:**
  - `publish-content.css` uses host classes (`.publish-content-*`, `.settings-dialog`, `.list-table`, …) that host components still render, and Jini classes must be `jini-*`. It moves with `A-K2-publish-content-1`.
  - The store was reverted (above).

**Prerequisite not landed in these bases** (FOUNDATION or other lanes; open dependencies from each sheet's `Depends on`, checked by whether the dependency's sources still exist in Tovu):
- **K5:**
  - `K5-deployments-1` (rest: `K4-seam-1/2/3/5/6`), `-2/3/4/5/6/7`.
  - `K5-source-control-1` (rest), `-2/3`.
  - `K5-domain-dns-1` (rest: `binding.repo` imports `@jini-ai/db/kernel`, which is XP3 from devops).
  - `K5-database-1`.
  - `K5-database-transfer-1` (rest), `-2`.
  - `K5-recovery-1`, `K5-trash-1`, `K5-permanent-delete-1`.
  - `K5-site-backup-1` (rest) through `-8`.
  - `K5-site-export-1/2`.
  - `K5-publish-content-1` (rest: `deps`, `tool-deps`, `tool-registrations` need seams), `-3/4/5/6`.
  - `K5-publish-content-ui-1`, `K5-publish-trust-1`.
- **K4:** `K4-trash-2`, `K4-publish-content-2`.
- **A-adm / A-K2:**
  - `A-adm-{deployment,recovery,source-control}-1` import `@/features/*/api/*.types` and `@/lib/*` that have not moved (A-adm-shell-lib-3, A-adm-other-1/2/3).
  - `A-K2-{import-export,database,deployment-1/2,recovery,source-control,trash,publish-content}-1` need K4-i18n-common.T, A-K2-0.T and the shell slices.

The Jini halves of K4-seam-1, K4-i18n-common, A-K2-0a and RT-K1-0 are in merge-14, but their Tovu halves are not in this base.

**Not examined in this run:** `RT-K1-adm-*`, `RT-K1-pub-*` and `AX-15–25` (route and desktop sheets). Their K1 prerequisites (`RT-K1-0.T`, route deps) are not in the Tovu base.

The partial steps above moved only the files whose every relative/`#src` import was already in Jini or in the same move, with no XP3 edge and no product literal.

## Gates (base → final; raw: `cloud-results/ex4-deploy-raw/`)

**Jini:**

| gate | result |
|---|---|
| build (changed packages) | 0 `error TS` |
| `typecheck` | 0 = base |
| `guard` | 0 = base; HW3 34/0 new |
| `api:check` | 0 |
| `check:cross-package` | 1 = base: XP1 39 / XP2 33 / XP3 2050 / XP4 760 / XP5 6, no finding names a moved file |
| `check:size` | = base, identical output |
| `check:complexity` | = base, identical output |
| `check:hooks` | 0 |
| `check:why-comments` | 10 = base |
| `check:log-safety` | = base (after the revert) |
| `check:errors` | WARN 25 = base |

**Jini vitest:**
- admin: 252/252 files, 3087 tests.
- devops: 93/93, 1339.
- db: 114/114, 950 (after the plan-store revert).
- cms: 436 files, all green except `forms/src/__tests__/package-boundary.test.ts`, which is BASE-RED (version `0.7.2` vs `0.7.3-next.2`, the same as combine-14). The first full run also had 20 pglite 5 s timeouts under CPU load; all pass when re-run alone.

**Tovu** (`ex4-deploy-raw/tovu-gate-*.txt`):
- **Equal to base:**
  - `typecheck` 0, `typecheck:tests` 0, `check:boundaries` 0 (112 warnings = base), `check:complexity` 0, `check:hooks` 0.
  - `check:size` 1, the same single base row: `deployments/publish-agent-tools.ts` 775/763.
  - admin `tsc` 2, the same 4 errors as base: merge-14's admin kit `Icon`/`useT`/`values`, whose Tovu half is not merged.
- **`check:why-comments`:** 85 → 80 = base, after 5 "Moved to Jini" debt rows (`38c2c851a7`) for the comments reworded for N1/N2.
- **`check:architecture`:** 1, the same single non-blocking ratchet row as base. Runtime-only propagation 3.29 → 3.33, a ratio that rises as files leave. Every other metric is equal or improved: cross-feature edges 309 → 300, API surface 687 → 679.

**Tovu tests:**
- **Test set:** every changed test plus every test that imports a changed production file (`ex4-deploy-raw/tovu-test-set.txt`). Node files ran one per process under a 15-min watchdog, 3 in parallel.
- **Node: 716 files**; 645 green on the first pass, 71 not.
  - 51 of the 71 came from the mid-suite media-references revert (`ERR_PACKAGE_PATH_NOT_EXPORTED`) and were green on re-run.
  - `planner-hash-upgrade` was fixed (`a6c4651a3b`) and is green.
  - **19 red, all BASE-RED with identical pass/fail counts** (`tovu-node-red-vs-base.txt`).
  - Later reverts were re-tested directly: the plan-store and directory-rollback-log importers' tests are green. The one red, `mcp-ui-allowlist-completeness`, is 9/1 at base too.
- **Admin vitest: 29/29 files, 261/261.** `app-panel-permissions` failed once in a loaded run; it also fails at base and passes alone (timing).

## FILES LEFT (`plans/P9-data/tools/scan.mjs` + `plan.mjs` from `origin/plan/whats-left-1122`, FILES-LEFT = moving + shells)

| tree | moving | shells | **FILES-LEFT** | excl. themes (`theme` 86 + `adm-themes` 25) | this lane's areas |
|---|---|---|---|---|---|
| base `f7185f153` | 2,483 | 3 | **2,486** | **2,375** | 308 |
| final `d340f0dd6e` | 2,464 | 3 | **2,467** | **2,356** | 289 |

Lane areas at final:
- `trash` 24 → 17, `publish-content` 50 → 43, `source-control` 19 → 17.
- `domain-dns` 10 → 9, `deployments` 42 → 41, `site-backup` 44 → 43.
- Unchanged: `adm-*` 67, `database` 6, `database-transfer` 12, `publish-trust` 11, `publish-content-ui` 8, `recovery` 4, `site-export` 9, `permanent-delete` 2.

## Findings (LISTED, not fixed)
1. **Plan-sheet destinations that break Jini rules:**
   - `media-references` → cms `publish` (SI-domain).
   - The admin availability store (HW3).
   - `plan-store` (db pinned subpath list).
   - `directory-rollback-log` (log-safety).
   - The `content-hash` entry must be `node` (it uses `node:crypto`).

   `plan.mjs` should check guard SI/HW3, log-safety and pinned export lists before emitting a destination.
2. **Named mutations that do not fit their sheets:**
   - X-trash-1: `registry.ts` has no `if`.
   - K5-publish-content-1 names `content-hash.test` for a `media-references` plant.
   - K5-source-control-1 names `provider-module.ts`, which is blocked.
   - A-adm-publish-content-1 names a CSS file.
3. **The importer lists miss some forms:**
   - Relative barrel users (`../trash/index.js`).
   - `mock.module(new URL('../x.ts'))` file-URL mocks.

   A repo-wide sweep for each deleted path in string specifiers and file URLs should be part of every T half (found here by the test run).
4. **P-publish-trust-1 literal renames:** they need owner input. See "Steps skipped"; one of them is a fail-open on the publish kill switch.
5. **`exactOptionalPropertyTypes`:** Tovu code moved into Jini can fail it (`widget-removal.ts`). Sheets should flag it.
6. **Stray files outside the repos:** this run left `/xt-importers.txt` and `/xt-barrel.txt` at the container root. A safety check blocked their removal; they are harmless scratch lists.
7. **Untracked test byproducts:** `chat.db` and `sites/tovu-dev/agent-plugins/` appear in the Tovu tree after the node suite. They are not committed.
