# admin-j1-j2 report (run date 2026-11-17/18)

**Status: DONE for J1 (both steps) and J2 steps 1, 1b, 2, 3, 4 (4a + 4b). J2 step 5 (`jini-` classes) HELD on purpose, as judge 2 says (it lands only with T1b step 3). J3 not in scope.**
Not visually checked: no browser was used (Jini-only sheets; nothing a Tovu screen renders changed, see "Tovu check").

Branches: Jini `wave2/admin-j` (base `origin/refactor/terra` = `65d73b0d`), Tovu `wave2/admin-j` (base `232764af`, report only).
Setup: Node 24.22.3 in `~/.local/node24`; Jini `pnpm install --frozen-lockfile` and `pnpm --no-bail -r build` exit 0.

## Jini commits (all pushed, each green alone; the full admin suite was run before every commit)
| SHA | Step |
|---|---|
| `b2a3bb69` | J1 step 1: `isPanelAccessible`, `withoutInaccessiblePanels`, `AdminPanel.anyOfPermissions`, core export, T1-T6, T9, T10 |
| `19b5f172` | J1 step 2: shell model (routable vs visible, `access`), `slots.noAccess`, T7, T8, T11-T14, docs, changeset |
| `cde06591` | J2 step 1 + 1b: hooks as props, `resolveShellHooks`, host-owned session source, 4 debt keys retired |
| `7341d35c` | J2 step 2: nav memoized (`ShellLayout` component) |
| `0dfa0d1c` | J2 step 3: `slots.sidebar` |
| `0d9d830a` | J2 step 4a: `frame`, `beforeMain`, `afterMain`, `assistantAside`, `ids` |
| `50058a40` | J2 step 4b: topbar toggle `strokeLinecap="round"` (snapshot changes by that attribute only) |
| `933a1fb2` | this report + `.changeset/admin-shell-slots.md` |
| `d9b0c65d` | restore a why-comment sentence the new `check:why-comments` gate (on newer `refactor/terra`) reported as lost (`resolveShellView` was folded into `ShellLayout`) |
| (this report revision) | post-merge validation section below |

## Baseline (unmodified `65d73b0d`) and result
| Gate | Base | Head |
|---|---|---|
| `npm --prefix packages/admin run test -- --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2` (vitest 2 rejects a bare `--maxWorkers=2`: "minThreads and maxThreads must not conflict") | 213 files, 2,846 tests pass | 221 files, 2,900 tests pass (+8 files, +54 tests, none removed) |
| `pnpm guard` | ok | ok |
| `pnpm --filter @jini-ai/admin typecheck`; root `pnpm typecheck` | ok | ok (exit 0) |
| `pnpm check:size`; `pnpm check:complexity` | ok, 157 debt entries; ok, 17 entries | same numbers |
| `node scripts/check-hook-injection.mjs` | exit 1: 68 lines, all `packages/ui` "(new)", PRE-EXISTING (BASE-RED) | same 68 lines except the three summary counts, which fall by the 4 retired calls (451 to 450 components, 587 to 583 calls, admin 100 to 96). No new line |
| debt one-liner on `packages/admin/src/react/shell` | 4 keys (`AdminShell::useAdminShellSession`, `::useAdminTheme`, `::useShellDrawer`, `::useShellRoute`) | CLEAN. Deleted by hand from `scripts/hook-injection-debt.json` (24 lines), no `--update` |
| J1 STOP (`rg resolveAdminShellModel` filtered) | prints nothing | prints nothing |
| J2 step-3 STOP (`railOverride`/`onRailCollapsedChange` exist on `Sidebar`) | found (`Sidebar.tsx:283,286`) | unchanged |
| T9 built check (`node --input-type=module` self-import of `@jini-ai/admin/core`) | n/a | `T9 built ok` |

## C-checks (section 2 of COMMON-ADMIN), run over the whole branch against `65d73b0d`
C3, C4 (both), C5, C7, C9, C11 print nothing. C8 (S-FN50 + `check:size` + `check:complexity`): no finding printed; both ratchets pass.
- **C6**: one removed assertion line: `AdminShell.test.tsx` `go('/private')` no longer expects `Overview screen`; it now expects the `noAccess` slot (declared change 2, D-11 / AU-D11). The other declared edit, `model.test.ts` fixture `effectivePermissions: []` (assertion `['home']` kept), is not an assertion change. Everything else added.
- **C12** lists: `isPanelAccessible`, `withoutInaccessiblePanels`, `resolveShellHooks`, `resolveShellIds` all take `(required, _options: Record<string, never> = {})` (precedent `sandbox/.../mount-characterization.test.ts:16`); `AdminShell(props)` and test helper `ports(path)` / `baseFields(p)` keep a single positional arg (a React component; test fixtures).
- Why-comments diff (`AdminShell.tsx`, `model.ts`): two lines differ. The old `resolveShellView` one-liner is replaced by the `ShellLayout` TSDoc (function removed); the `resolveAdminShellModel` `@returns` line is extended with `access`.
- Complexity measured with lowered thresholds (cyclomatic / cognitive / lines): `AdminShell` 3 / 2 / 13 (was 9); `ShellLayout` 5 / 2 / 24; `ShellMainColumn` 3 / 0 / 23; `renderRoutedPanel` 5 / - / 6; `renderShellSidebar` 3 / - / 10; `renderAssistant` 3 / 2 / 5; `resolveAdminShellModel` 5 / 2 / 18 (was 6); `resolveShellRoute` 3 / - / 10; `resolveShellHooks` 5 / - / 7; `resolveSessionHook` 3 / - / 5; `resolveShellIds` 6 / - / 6; `isPanelAccessible` 7 / 2 / 9; `withoutInaccessiblePanels` 3 / - / 14. All <= 10 and <= 50.

## Tests first (red shown, then green) and mutations
- Step 1 core: 13 new tests failed `isPanelAccessible is not a function` / missing export; green after. Mutations, each RED then restored: undefined treated as empty (T3 fails), any-of as all-of (T1, T5 fail), `||` instead of `&&` (T1, T4, all-of, T5, T6 and the group test fail), empty treated as unknown (T4 fails).
- Step 2: 9 tests red (T7, T12, T13, noAccess slot cases, the nav-fixture test, model cases). V3 mutations, each RED then restored: routable without `['*']` (8 fail incl. T11, T12, T13), real permissions passed to `resolvePanels` (6 fail incl. T12, T13), unknown collapsed to `[]` (4 fail incl. T8, T13). T10 (`resolvePanels` unchanged, 3 fixtures) was written green on the old code and stays green.
- J2 step 1: 7 of 8 tests red (the type test was green); step 2: 3 of 3 red (spy was called 3, 4 and 3 times); step 3: 4 of 4 red; step 4: 8 of 9 red (default ids case already true); step 4b: 1 red.
- Snapshot `AdminShell.markup.test.tsx` was taken before any slot existed (at the step-2 head, whose markup is unchanged from base: the existing assertions pin it) and passed unchanged through steps 3 and 4a; step 4b updated it by exactly `stroke-linecap="round"` (verified by stripping that attribute and comparing).

## What each new slot hosts in Tovu (sheet requirement; for T1b)
`sidebar` = `App.tsx:603-641`; `frame` = providers at `App.tsx:678-680`; `beforeMain` = logout confirm `App.tsx:685`; `assistantAside` = `AssistantChrome` `App.tsx:348-385` / `App.chrome.tsx:65-134`; `afterMain` = `ScrollJumpButtons` `App.chrome.tsx:195-198`; `ids` = `#admin-sidebar` / `#main-content` lookups (4 hooks, `styles.css:247`); `strokeLinecap` = `App.chrome.tsx:149`; hooks as props = `App.tsx:433-446`; `useHostSession` = session machine `App.hooks.ts:109-228` feeding `AdminBootScopeContext` (`App.tsx:460-462`).

## Declared behaviour changes (changeset `admin-shell-panel-access.md`)
(1) unknown permissions now list all-of panels in the nav; (2) a denied URL keeps its panel and renders `slots.noAccess` (empty `<main>` without one). `resolvePanels` untouched. `hasPermission` diff vs `packages/ui/src/features/panel-kit/helpers/permissions.ts:9`: same logic; the only difference is `readonly` on the admin parameter type. Not merged (admin may not import ui).

## Decisions where the sheet left room (name them; change if a reviewer prefers otherwise)
- `AdminShellProps` stays an interface (the port variant, so the existing `f.props.session.read = ...` test code compiles). The host variant is a new `AdminShellHostProps`; each forbids the other source with `undefined`-typed fields (`expectTypeOf` test, no suppression). `AdminShellSessionSource` is exported as the union of the two field sets. The shell's parameter is `AdminShellProps | AdminShellHostProps`.
- `sidebarProps.base` is `string` (the shell's `adminBase` is required), not `string | undefined`, so it spreads onto `Sidebar` under `exactOptionalPropertyTypes`.
- `useHostSession` is called as `hooks.useSession(context)` (a member call), so the hook-injection scanner (identifier calls only) sees no direct call and reports no key for it. This is by design of `resolveShellHooks` (the sheet's planned shape); stating it so nobody reads "CLEAN" as "scanner-verified".
- The memoized model is keyed on the `session` object identity: a host-owned session hook must return a stable object (the TSDoc says so for `translateNav`; same rule).
- `sidebarHeader` / `sidebarFooter` are not rendered when `slots.sidebar` is present (documented in the slot TSDoc and `ui.spec.md`).
- New test helper `__tests__/shell-fixture.tsx` is shared by the new shell tests.

## Shared files edited (overlap list for the other ~25 live runs)
Jini: `packages/admin/**` only, plus `scripts/hook-injection-debt.json` (deletions only: 4 `AdminShell::` keys; a conflict with another run is possible if it also edits that file near those keys) and two files in `.changeset/`. Nothing in Tovu. `git pull --rebase origin refactor/terra` before each push was clean every time.

## Validation against the newer `refactor/terra` (it moved 103 commits during the run, to `4c189236`)
The branch history was NOT rebased (rebasing would have rewritten already-pushed SHAs and needed a force-push, which is banned). Instead a scratch merge of `origin/refactor/terra` into `wave2/admin-j` was tested locally and discarded: **merges with no conflict**. On that merged tree after `pnpm --no-bail -r build` (exit 0): admin suite 227 files / 2,925 tests pass; `pnpm guard` ok; `pnpm check:size`, `pnpm check:complexity` ok; `pnpm check:why-comments` ok after `d9b0c65d` (it was red before, my doing: 1 lost comment); hook gate shows admin at 93 direct calls, no new line. Still red on that tree and not in files this branch touches (the branch diff against terra is `packages/admin/**`, `scripts/hook-injection-debt.json`, two changesets, this report): `check:log-safety` (`packages/http-kit/src/node-bridge.ts`), `check:errors` (WARN mode, `packages/ui/...`), `check:cross-package` (ENV: `fatal: bad revision '35c4961af'` in this shallow clone). A first `pnpm guard` before a full rebuild reported 1 violation (`antigravity` def: stale `@jini-ai/core` dist); it went away after the rebuild (ENV). Whoever merges to terra should rebase or merge, then rerun `check:why-comments`.

## Tovu check (no Tovu code changed; judge 2 said J1/J2 steps 1-4 cannot break a current screen: verified)
`JINI_PACKAGES_DIR=/home/user/Jini/packages npm run link:jini` (74 links) then `npm --prefix apps/admin run typecheck`: exit 0. `npm --prefix apps/admin run test -- --maxWorkers=2` on `lib/__tests__/panel-access.unit.test.ts`, `__tests__/unit/app-panel-permissions` and `__tests__/app-boot-request-volume.test.tsx`: 3 files, 51 tests pass (judge-2 baseline 51); `src/__tests__/unit/app-*`: 25 files, 258 tests pass. Then `npm run unlink:jini` (working tree clean). Tovu's own gates (`check:size`, `check:complexity`, `check:boundaries`) were not run: judge 2 recorded them red on base for `apps/website` files and nothing here touches Tovu.

## Left / next
1. **J2 step 5** (`jini-admin-*` classes, `packages/admin/docs/shell-classes.md`, `packages/ui/src/styles/admin.css:294-295`): not started; build it on `admin-ui/J2-classes` and merge only with T1b step 3 (the Tovu half).
2. J3 (theme seam) and T1a/T1b are separate sheets; T1b needs AU-D15 and Opus diff review.
3. No Jini unit covers the "frame re-keyed on identity" with a *port* session; it is covered with `useHostSession`.
4. Chrome visual check: none (Jini-only; no Tovu screen consumes the shell yet).
5. No processes or servers left running.

## What the sheet got wrong / notes for the plan
- J1 and J2 test commands use `--maxWorkers=2`, which vitest 2.1.9 in `packages/admin` rejects; use `--poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`.
- J1 sheet says to change `model.test.ts:9-15` "fixture to `effectivePermissions: []`"; done as written.
