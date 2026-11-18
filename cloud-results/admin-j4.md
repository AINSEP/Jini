# admin-j4 report (2026-11-18)

**Status: J4 PARTIAL. Pure half DONE (Jini + Tovu). React half STOPPED (guard rule L5 vs the sheet's home; needs an owner answer). JM1-pre: step 3 (forms barrels) DONE only; steps 1, 2, 4 not started (budget).**
Not visually checked: no browser used. The Tovu change is import specifiers only; no markup/CSS.

## Branches / SHAs (same branch `wave3/admin-j3-t1a`, fast-forward pushes only)
- Jini `3b283217` J4 pure half; `7a90034d` JM1-pre step 3; then a final docs/fix commit (this report + why-comment fix, see `git log`). Base `2f5cd81f`.
- Tovu `cff4eb1d` repoint (message names Jini `3b283217`). Base `13ed6098`. Tovu pushed WITHOUT `--no-verify` (pre-push: "no apps/desktop changes, skipping desktop gates"). Jini pushed without `--no-verify`.

## J4 done: new `@jini-ai/core/admin-runtime` (universal entry, `packages/core/src/admin-runtime/`)
Moved (git mv, tests moved not copied): `createControllerStore` (+ `ControllerStore`, new explicit `WritableControllerStore` return type, needed because TS4058 could not name `AbortSignal`), `AdminConfigError` (was inside `create-admin.ts`), `AdminApiError` + `describeApiError`, `querySuffix` (now `{ query }`, C12; 3 call sites), `hasPermission` + `isPanelAccessible` + `withoutInaccessiblePanels` (reconciled with J1; the latter is generic over the nav group, structural `AdminNavGroupShape`/`AdminPanelAccessDeclaration`, so admin's `AdminNavGroup` and Tovu's panels type through unchanged).
Admin originals deleted, 87 admin files repointed, no re-export left. Admin public API removed (changeset `core-admin-runtime.md`, minor): `AdminApiError`, `describeApiError`, `hasPermission`, `isPanelAccessible`, `withoutInaccessiblePanels` from `@jini-ai/admin/core`; `AdminConfigError` from `@jini-ai/admin/core/module`. Admin's old `core/__tests__/public-surface.unit.test.ts` (T9, 3 `typeof` asserts) deleted; replaced by core `admin-runtime/__tests__/public-surface.test.ts` pinning the 8 sorted names.
Step-0 searches (reported, none merged): `user-management/src/admin/controllers/controller-store.ts` is NOT identical (copies `initial`, adds `active()`, `call: { signal }`, positional-optional args) -> left alone, reported (step 4 condition not met). `ui/src/features/panel-kit/helpers/permissions.ts` `hasPermission` has identical behaviour (body is the same one line); not touched (a ui dedupe needs a caller check and is outside this sheet). `omitKeys` untouched (JM sheets).
Tovu: `App.tsx`, `panel-access.unit.test.ts`, `panel-access-parity.unit.test.ts`, `integrations/jini-admin/redirects-ports.ts` and its test now import from `@jini-ai/core/admin-runtime` (`@jini-ai/core` already a Tovu dependency; no package.json/lockfile edit).

## J4 STOPPED: React half (`useController`, `bindReact`, `ModulePageProps`, `TabViewProps` -> `@jini-ai/ui-kit/react`)
I did the whole move (ui-kit `src/react/admin-module/`, 11 new ui-kit tests, 62 admin files repointed, 3 admin export keys + `typesVersions` removed, ui-kit added as an optional peer of admin, `pnpm install --frozen-lockfile` clean, lockfile untouched), then `pnpm guard` went red with **66 `L5-injected-edge`**: `admin -> @jini-ai/ui-kit/react: only @jini-ai/core and @jini-ai/protocol may be imported` (`scripts/lib/injection-edges.ts` `l5Reason`). The sheet and COMMON-ADMIN section 1 say React entries may import `ui-kit/react`; the gate does not allow it (user-management's own ui-kit use is debt, lane L-KIT-UM). The only ways through are 66+ new `injection-debt.json` entries (debt must only shrink) or an `injection-exceptions.json` entry, which `scripts/__tests__/injection-exceptions.q2.test.ts` pins to exactly the five Q2 edges and whose header says entries come only from owner answers. Neither is mine to decide, so I reverted the move (nothing of it is on the branch) instead of pushing a red guard.
**What I need from the owner (one answer):** (a) allow `ui-kit` as a target for module owners (admin, cms, agent-plugins, devops, cookie-consent, user-management) via an owner exception entry plus updating the Q2 test, or (b) another home for the two hooks (core cannot take React: zero-dependency kernel).
The finished work is saved as **`cloud-results/admin-j4-react-half.patch`** (`git apply --index`; made against Jini `3b283217`; build core and ui-kit first). After the owner answers, applying it plus the exception is one commit. It contains the ui-kit tests: use-controller (6 cases, incl. StrictMode replay never leaves a disposed controller) and bind-react (5 cases); the existing `bind-react` test (needs `createAdmin`) would stay in admin as `src/react/__tests__/bind-react.integration.test.tsx` (ADMIN-COMPOSITION).
JM1-JM5 move runs depend on this; the JM-pre runs do not.

## JM1-pre (forms) - step 3 only
`forms/index.ts`: 2 `export *` -> explicit names. Pin test first (`forms/__tests__/forms-public-surface.unit.test.ts`, sorted runtime names, RED under the mutation "drop `KEYS`", restored). The TypeScript export set (values and types, from the checker) is identical before/after (`cmp` of both lists: SAME). Not done: step 1 (9 hook keys), step 2 (6 size keys), step 4 (classify 32 test files).

## Gates (exact command, result)
Jini (Node 24.11.1; `pnpm install --frozen-lockfile` ok; `pnpm --no-bail -r build` exit 0):
- BASE admin tests: 227 files / 2,928 tests (from the J3 report; my own baseline run was invalidated because I edited files while it ran). After: `cd packages/admin && npm run test -- --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`: 224 files / 2,901 tests, all pass. Ledger: 2928 - 27 moved (controller-store 5, permissions 5, panel-access 12, describeApiError 5) - 1 (T9) + 1 (forms pin) = 2901. Core: `npx vitest run` 208+ files / 3,006 pass at `3b283217` (new `admin-runtime` tests: 31 = 27 moved + query-suffix 2 + config-error 1 + public surface 1).
- `pnpm guard` ok (zero violations). `pnpm check:size` ok 157 entries (unchanged); `check:complexity` ok 17; `check:why-comments` ok (first run found 1 lost block, the "Permissions - affordance only" header of admin `core/index.ts`; moved to `core/admin-runtime/index.ts`, now 0 lost; needs `git fetch origin refactor/terra` first).
- `node scripts/check-hook-injection.mjs`: exit 1, 32 "(new)" lines, same count as BASE (all `packages/ui`, BASE-RED). No admin-runtime/forms line.
- `tsc --noEmit` admin and core: clean. eslint (complexity 10 / cognitive 10 / fn 50 / file 500, no inline config) on `core/src/admin-runtime/*.ts` and `forms/index.ts`: no finding.
- C3, C5, C7, C9, C11, C12-listing: C3/C5/C7/C9/C11 print nothing. C4: only entry files naming names (`core/admin-runtime/index.ts`, admin `core/index.ts`, `core/module/index.ts`). C12: `withoutInaccessiblePanels` (existing `({...}, _options = {})` shape, now generic), `querySuffix({ query }, _optional = {})`. C6: removed asserts listed above, each moved verbatim to `core/src/admin-runtime/__tests__/`. Debt files: none edited.
- C10 (export map): `./admin-runtime` added to core `exports` + `jini.entries` (universal). Node import not run via minimal-host (core is not declared there); self-reference build proven by admin/ui-kit builds and Tovu typecheck resolving it.
Tovu (linked: `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs`; contracts + sdk built; `npm ci` root + apps/admin):
- `npm --prefix apps/admin run typecheck` exit 0. `npx vitest run --maxWorkers=2 src/lib/__tests__/panel-access src/__tests__/unit/app-panel-permissions src/integrations/jini-admin`: 20 files / 230 tests pass. `npm run check:hooks`, `check:size` (193 debt), `check:complexity` (43) ok. `check:boundaries`: no line names `apps/admin`. Whole admin suite NOT rerun (imports only; BASE-RED set from the previous report unchanged).
- Tovu stays linked to Jini locally only; `package.json`/lockfile untouched. Run `npm run unlink:jini` before a real build.

## Overlaps / shared files
Jini `packages/core/package.json` (exports + entries), `packages/admin/package.json` (3 entries removed would have been the React half: NOT applied). Tovu `App.tsx` (import lines only; T1 stays closed for it).

## Left / next
1. Owner answer on the L5 conflict above, then apply `cloud-results/admin-j4-react-half.patch` (+ exception) and push; repoint Tovu's `@jini-ai/admin/react/bind-react` sites (`module-context.ts`, `modules.hooks.unit.test.tsx`).
2. JM1-pre steps 1, 2, 4 (forms). T1b and J2 step 5 stay held.
3. No processes left running.
