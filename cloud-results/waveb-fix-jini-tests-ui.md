# Wave B Jini tests (ui, user-management, admin, cms) — fix report

Branch `fix/wave-b-jini-tests-ui` (from `fix/wave-b-jini-build`). Baseline tree: `origin/refactor/terra` (worktree `../base`).
Runner: vitest `--maxWorkers=2..3 --minWorkers=1`, Node 24, per package (ui ran whole, ~13 min, no timeout).

## Totals (failed tests / total), before -> after

| package | branch before | base (terra) | branch after | note |
|---|---|---|---|---|
| user-management | 114 / 1233 | 3 | **3** | the 3 are PRE-EXISTING |
| ui | 418 / 8575 | 6 | **3** | all PRE-EXISTING |
| cms | 3 / 4061 | 3 | **3** | nothing NEW; all PRE-EXISTING |
| admin | 797 / 2853 | 27 | **27 / 2853** (full run, continuation) | all 27 PRE-EXISTING; 0 NEW (diffed per test against terra) |

## Root causes and fixes

1. **Wave B C9 made the admin/ui kits injected; tests rendered bare** (user-management 63x AdminKit + 25x UiKit, ui 409x UiKit, admin 683x AdminKit).
   - user-management `09118034`: shared `fetch-query-support` render wraps UiKitProvider (real ui-kit bindings) + AdminKitProvider (fake kit); 8 bare-RTL files repointed to it. `@jini-ai/admin/react/testing-kit` is a new export (the fake admin kit moved out of `__tests__` so consumers can use it); `renderWithAdminKit` stays in admin `__tests__/`.
   - ui `ca04ff1a`: 34 files import render/renderHook from the already-present `src/__tests__/ui-kit-render-support` (real ui-kit bindings, as a host binds them).
   - admin `99ca65ab` + follow-ups: `src/__tests__/fetch-query-support.ts` wraps UiKit + AdminKit + FetchQuery; 57 bare-RTL files repointed.
2. **Fake kit too thin vs. what a host binds** (~220 admin assertions). The test admin kit now takes ui-kit's native controls, `ConfirmDialog`, `useConfirmController`, `useNativeDialog`, and ui's real `Select`/`InfoTip`/`Lightbox` + real fetch-query binding; fake dialog renders its title, switch has role=switch, fake native dialog toggles `open`, fake theme uses named colors (admin source stays literal-free).
3. **Fake `useSettlementGeneration` returned a new object each render** -> "Maximum update depth" in `useFormSubmissions` (committed locally, see Pending).

No skips, no weakened assertions, no re-export shells, no new Jini->Jini import beyond devDependencies already declared (admin/user-management already depend on ui, ui-kit, admin as workspace devDeps).

## Continuation run: NEW admin failures (was ~46, now 0)

Measured 73 -> 56 on the unmodified branch head (29 NEW), then all fixed. Owner rule applied: fakes implementing public interfaces, no real implementations of other packages, no `vi.mock` of another package.

- providers-tab-hooks (15) + media-component-states (3) + library-parity (1) + media.test.tsx credential tab (1) + fqfix-loading (2): the test admin kit's media-providers slot was an inert stub. Decision: not exporting the ui hook; instead a stateful fake `useMediaProvidersTab` + rules implementing `AdminMediaProvidersKit` lives in admin's `/react/testing-kit` entry (`src/react/testing-kit-media-providers.ts`). SHA 6693e31d3.
- media.test.tsx StrictMode probe (1): React 19 replays effects only when StrictMode is the root; the probe went back to bare RTL render. agent-plugins Button override (1): through `AdminKitProvider`. SHA 6a793d872.
- use-widget-instance-editor confirmLeave (2) + ConfirmDialog Tab cycling (2): the fake `useDirtyGuard` always returned true and the fake `useFocusTrap` was a no-op; both now honor their kit contracts. InteractiveHtmlEditor.wiring (1): replaced `vi.mock('@jini-ai/ui/html-editor')` with a recording `HtmlEditor` kit slot. Commit "fake kit honors dirty-guard confirm and focus-trap contracts" (see git log).
- FormEditor / copy-polish / submissions-states: already green after root cause 3.

Verification: admin full vitest 27 failed / 2853, `tsc --noEmit` clean. The 27 are identical to terra's (plain Error -> fallback copy in widgets etc.; 3 of them in use-widget-instance-editor.hooks.unit.test.ts). Mutation check not run on the fakes (time/ordering; fake behavior is asserted by the existing tests that fail without it, e.g. confirmLeave, Tab wrap).

Left: nothing NEW. Setup note: examples/reference-web build fails on both trees' setup and user-management build fails on terra (not touched).

## PRE-EXISTING (fail on terra too; left)

- user-management: `src/__tests__/public-args.test.ts`, `src/server/__tests__/authorization-regressions.test.ts` (2 tests).
- ui: `features/execution/__tests__/index.test.ts` (2 preset pins vs `DEFAULT_PROVIDER_PRESETS = []`), `features/mcp-ui/__tests__/sign-in-card.unit.test.ts:81`; plus file-level failures `panel-kit/hooks/__tests__/use-bounded-status-poll.hooks.test.tsx`, `use-optimistic-stored-value.hooks.test.tsx` (missing modules), `remixicon-css-export.build-output.test.ts` (base only).
- cms: 3 tests in 4 files, identical on both trees.
- admin: 27 tests, e.g. `widgets/__tests__/widgets-surface.unit.test.ts` (plain Error -> fallback copy; `describeApiError` by design).

## Pending / not pushed

Pushed: see git log on the branch (all commits above, plus the final media.test.tsx AdminKitProvider override which cut media.test.tsx from 3 to 2 failures).
