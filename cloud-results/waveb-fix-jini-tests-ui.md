# Wave B Jini tests (ui, user-management, admin, cms) — fix report

Branch `fix/wave-b-jini-tests-ui` (from `fix/wave-b-jini-build`). Baseline tree: `origin/refactor/terra` (worktree `../base`).
Runner: vitest `--maxWorkers=2..3 --minWorkers=1`, Node 24, per package (ui ran whole, ~13 min, no timeout).

## Totals (failed tests / total), before -> after

| package | branch before | base (terra) | branch after | note |
|---|---|---|---|---|
| user-management | 114 / 1233 | 3 | **3** | the 3 are PRE-EXISTING |
| ui | 418 / 8575 | 6 | **3** | all PRE-EXISTING |
| cms | 3 / 4061 | 3 | **3** | nothing NEW; all PRE-EXISTING |
| admin | 797 / 2853 | 27 | **~73** (last full run, before the final two small edits) | 27 PRE-EXISTING + ~46 NEW left, see below |

## Root causes and fixes

1. **Wave B C9 made the admin/ui kits injected; tests rendered bare** (user-management 63x AdminKit + 25x UiKit, ui 409x UiKit, admin 683x AdminKit).
   - user-management `09118034`: shared `fetch-query-support` render wraps UiKitProvider (real ui-kit bindings) + AdminKitProvider (fake kit); 8 bare-RTL files repointed to it. `@jini-ai/admin/react/testing-kit` is a new export (the fake admin kit moved out of `__tests__` so consumers can use it); `renderWithAdminKit` stays in admin `__tests__/`.
   - ui `ca04ff1a`: 34 files import render/renderHook from the already-present `src/__tests__/ui-kit-render-support` (real ui-kit bindings, as a host binds them).
   - admin `99ca65ab` + follow-ups: `src/__tests__/fetch-query-support.ts` wraps UiKit + AdminKit + FetchQuery; 57 bare-RTL files repointed.
2. **Fake kit too thin vs. what a host binds** (~220 admin assertions). The test admin kit now takes ui-kit's native controls, `ConfirmDialog`, `useConfirmController`, `useNativeDialog`, and ui's real `Select`/`InfoTip`/`Lightbox` + real fetch-query binding; fake dialog renders its title, switch has role=switch, fake native dialog toggles `open`, fake theme uses named colors (admin source stays literal-free).
3. **Fake `useSettlementGeneration` returned a new object each render** -> "Maximum update depth" in `useFormSubmissions` (committed locally, see Pending).

No skips, no weakened assertions, no re-export shells, no new Jini->Jini import beyond devDependencies already declared (admin/user-management already depend on ui, ui-kit, admin as workspace devDeps).

## NEW failures still open in admin (~46)

- `media/react/__tests__/providers-tab-hooks.test.tsx` (15): the real `useMediaProvidersTab`/rules live in `ui/src/features/media-providers` but are not exported from any `@jini-ai/ui` subpath, so the test kit keeps a stub. Needs either a public export or a fixture matching the hook's contract (design decision, not done).
- `forms/react/__tests__/FormEditor.unit.test.tsx`, `copy-polish`, `submissions-states` (some may be fixed by root cause 3; unverified).
- `media/react/__tests__/media.test.tsx` (3), `agent-plugins.test.tsx` (1): tests override a slot via ui-kit `KitProvider`; now must override through `AdminKitProvider` (edit for media.test.tsx made locally, see Pending; agent-plugins not done).
- `__tests__/fqfix-loading.unit.test.tsx` (2), `widgets/.../use-widget-instance-editor.hooks.unit.test.ts` (2), `react/__tests__/components/ConfirmDialog.test.tsx` (2), `media/library-parity` (1), `InteractiveHtmlEditor.wiring` (1), `media-component-states` (3) — not yet triaged.

## PRE-EXISTING (fail on terra too; left)

- user-management: `src/__tests__/public-args.test.ts`, `src/server/__tests__/authorization-regressions.test.ts` (2 tests).
- ui: `features/execution/__tests__/index.test.ts` (2 preset pins vs `DEFAULT_PROVIDER_PRESETS = []`), `features/mcp-ui/__tests__/sign-in-card.unit.test.ts:81`; plus file-level failures `panel-kit/hooks/__tests__/use-bounded-status-poll.hooks.test.tsx`, `use-optimistic-stored-value.hooks.test.tsx` (missing modules), `remixicon-css-export.build-output.test.ts` (base only).
- cms: 3 tests in 4 files, identical on both trees.
- admin: 27 tests, e.g. `widgets/__tests__/widgets-surface.unit.test.ts` (plain Error -> fallback copy; `describeApiError` by design).

## Pending / not pushed

Pushed: see git log on the branch (all commits above, plus the final media.test.tsx AdminKitProvider override which cut media.test.tsx from 3 to 2 failures).
