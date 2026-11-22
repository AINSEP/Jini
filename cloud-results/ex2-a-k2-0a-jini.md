DONE 8887e336e

# A-K2-0a.J (Jini half): admin kit Icon, UI `useT`, injected values

- **Branch:** `codex/ex2-a-k2-0a-jini`, based on `origin/integ/merge-13-2026-11-22` (`7c4ee7881`).
- **Spec applied:** the corrected `### A-K2-0a.J` in Tovu `plans/P9K-fix-B1-B3.md`, which overrides the sheet `plans/P9-steps/A-K2-0.md`. The prompt names `plans/P9-steps/A-K2-0a.md`, but that file does not exist on `origin/plan/whats-left-1122`. The 0a row lives in `A-K2-0.md`. All three fixcheck NEEDS notes from `plans/P9K-fixcheck-B1-B3.md` are applied (see below).
- **Commits, in order. All were pushed and confirmed:**
  - `d6e4020cb`: test, red first
  - `da03f22a9`: implementation
  - `8887e336e`: changeset and API baseline
  - a report commit follows `8887e336e`

## Files changed (no files moved; additive kit entries only)

| file | change |
|---|---|
| `packages/admin/src/react/kit.tsx` | Adds `KitIconName`, `IconProps`, the `AdminKitComponents.Icon` slot and the `Icon = slot('Icon')` facade. Adds `AdminKitHooks.useT(): KitTranslator` and the `useT` hook facade. Adds the `AdminKitValues` group (`KitDictionaries` and `KitNotificationsPreferences` shapes), the required `AdminKit.values` field and the `useAdminKitValues()` reader. |
| `packages/admin/src/react/testing-kit.tsx` | `fakeAdminKit()` gets a fake `Icon`, a stable passthrough `useT` and frozen neutral `values`, plus a `values` override group. |
| `packages/admin/src/forms/react/__tests__/harness.tsx` | `formsKit` gets throwing `Icon`, `useT` and `values` entries, the same pattern as the other unsupplied slots. |
| `packages/admin/src/react/__tests__/kit.unit.test.tsx` | 3 new cases (below). |
| `.changeset/admin-kit-icon-ui-t-values.md` | `@jini-ai/admin`: minor |
| `api-baseline/jini-ai__admin.json` | Updated by `pnpm api:update` |

## Exports and API baseline delta (`@jini-ai/admin`, entry `./react/kit`)

- **Changed:** `AdminKit` (now requires `values`), `AdminKitComponents` (now requires `Icon`), `AdminKitHooks` (now requires `useT`).
- **Added:** `Icon`, `useT`, `useAdminKitValues`, and the types `IconProps`, `KitIconName`, `KitTranslator`, `AdminKitValues`, `KitDictionaries`, `KitNotificationsPreferences`.
- No new `package.json` entry and no new cross-package import. `kit.tsx` still imports only `react` and `@jini-ai/core`.

## How the fixcheck NEEDS were applied

1. **The Icon `name` type.** `IconProps.name` is `KitIconName`, a closed union of the 20 names that Tovu admin's `@jini-ai/ui` `Icon` call sites pass:

   `alert-triangle`, `arrow-left`, `arrow-up`, `check-long`, `chevron-down`, `chevron-right`, `chevron-right-wide`, `close`, `folder`, `image`, `package-check`, `package-outline`, `play`, `plus`, `puzzle`, `refresh`, `settings`, `storefront`, `trash-compact`, `volume`

   It is not a general string. Every name is a member of UI `IconName`. The other props are the SVG attributes those call sites use: `size`, `className`, `strokeWidth`, `stroke`, `fill`, `viewBox`, `strokeLinecap`, `strokeLinejoin`, `focusable`, `aria-hidden` and `aria-label`. That set covers the `LINE_ICON` spreads in `deployment-visuals.tsx` and `plugins-visuals.tsx`. `size` has no `| undefined`, because UI's `Props.size` is exact-optional.
2. **`TabBarTab` stays gated.** The kit's `TabBarTab` is unchanged. It still lacks UI's `disabled`, `dot` and `dotLabel` (see the Tovu section).
3. **Hooks and components are injected.** `Icon` uses the existing `slot` pattern, which carries the `useAdminKitHook` prop. `useT` and `useAdminKitValues` are kit hook facades. Screens should take them as hook props at move time (see the Tovu section).

**Host assignment proof.** I compiled a throwaway fixture against the built `@jini-ai/ui` dist and did not commit it. The fixture was:

```ts
{ Icon } satisfies Pick<AdminKitComponents,'Icon'>
{ useT } satisfies Pick<AdminKitHooks,'useT'>
{ SETTINGS_DIALOG_DICTIONARIES, DEFAULT_NOTIFICATIONS_PREFERENCES, UNREACHABLE_RETRY_DELAYS_MS, LOCAL_BACKUP_PRINCIPAL_ID } satisfies AdminKitValues
```

The first two values come from `@jini-ai/ui` and the last two from `@jini-ai/ui/panel-kit`. The fixture compiled with exit 0. An earlier draft with `size?: number | string | undefined` failed it with TS2322 under `exactOptionalPropertyTypes`, and I fixed that before committing.

## Tests

**New cases in `react/__tests__/kit.unit.test.tsx`:**
1. The injected `Icon` renders through the provider and receives the screen's props unchanged.
2. The `useT` facade returns the host's UI translator sentinel by identity, and `t('Save')` returns `ui-sentinel:Save`.
3. `useAdminKitValues()` returns each injected value by identity.

**Red first.** Run against commit `d6e4020cb`, before any implementation: `Tests 3 failed | 5 passed (8)`, and the 3 failures were the new cases.

**After the implementation:** `Tests 8 passed (8)`.

I edited one of my own new assertions after the red run. The Icon case first asserted the exact props object. The existing `slot` always forwards `ref` (null when none is given), so the assertion now includes `ref: null`, with a comment saying why. That is existing slot behaviour. No existing test changed.

**Full suites:**

| suite | files | tests | note |
|---|---|---|---|
| `@jini-ai/admin` (`npx vitest run`) | 251 passed | 3077 passed | Base 3074, inferred: 3077 minus the 3 new cases, since no other test file changed. |
| `@jini-ai/user-management` (built dependent of admin) | 116 passed | 1353 passed | |

## Named mutation

**Mutation:** the translator facade returns a different translator:

```ts
export const useT = () => { useAdminKit().hooks.useT(); return (key) => key; };
```

**Result with the mutation:**

```
× admin kit: UI icon, UI translator and injected values (A-K2-0a) > the useT facade returns the UI translator the host injected
AssertionError: expected [Function] to be [Function uiTranslator] // Object.is equality
Tests  1 failed | 7 passed (8)
```

**Restored** with `git checkout`. The tree was clean afterwards, and the suite was back to `Tests 8 passed (8)`.

## Gates: base (unmodified `7c4ee7881`) vs final

| gate | base | final |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | 0 |
| build (`pnpm -r build` at base; `--filter ...@jini-ai/admin` at final: admin, user-management) | 0 | 0 |
| `pnpm typecheck` | 0 | 0 |
| `pnpm guard` | 0 | 0 |
| `pnpm api:check` | 0 | 0, after `api:update` |
| `check:size` | 1 (pre-existing: stale sidecar debt entries) | 1, **output identical to base** |
| `check:complexity` | 1 (pre-existing: chat `readConfirmationResume`, core `refusalError`, ui `ErrorNotice`, …) | 1, **identical to base** |
| `check:hooks` | 0 | 0, identical |
| `check:errors` | 0 | 0, identical |
| `check:cross-package` (`--base 35c4961af`) | 1 (pre-existing XP5 in server/ui `package.json`) | 1, **identical to base** |
| `check:why-comments --base origin/integ/merge-13-2026-11-22` | ok, 0 lost | ok: 4 files checked, 0 comment blocks lost |

**No new red.** Two gates needed a workaround in this shallow clone:
- I deepened the clone so `check:cross-package`'s pinned base `35c4961af` exists.
- `check:why-comments`' default base `origin/refactor/terra` is absent, so I passed the merge-13 base explicitly.

## For the Tovu half (`A-K2-0a.T`, B2 host assignment)

**Required fields.** `AdminKit` now requires `components.Icon`, `hooks.useT` and `values`. Tovu's `satisfies AdminKit` in `apps/admin/src/integrations/jini-kits.ts` goes red until the host assignment lands. Land the two halves as a pair. The proven bindings are:

```ts
import { Icon, useT, SETTINGS_DIALOG_DICTIONARIES, DEFAULT_NOTIFICATIONS_PREFERENCES } from "@jini-ai/ui";
import { UNREACHABLE_RETRY_DELAYS_MS, LOCAL_BACKUP_PRINCIPAL_ID } from "@jini-ai/ui/panel-kit";
// adminKit: components: { …, Icon }, hooks: { …, useT },
//           values: { SETTINGS_DIALOG_DICTIONARIES, DEFAULT_NOTIFICATIONS_PREFERENCES, UNREACHABLE_RETRY_DELAYS_MS, LOCAL_BACKUP_PRINCIPAL_ID }
```

**New import specifiers for moved screens:**
- From `@jini-ai/admin/react/kit`:
  - values: `Icon`, `useT`, `useAdminKitValues`
  - types: `IconProps`, `KitIconName`, `KitTranslator`, `AdminKitValues`, `KitDictionaries`, `KitNotificationsPreferences`
- Test kits: `fakeAdminKit({ components: { Icon }, hooks: { useT }, values })` from `@jini-ai/admin/react/testing-kit`.

**The hooks-as-props rule.** A moved screen takes the kit hooks as injected props with kit defaults (`useTHook = useT`, `useAdminKitValuesHook = useAdminKitValues`) and does not call them directly. The `Icon` facade already accepts `useAdminKitHook`. Following the fix sheet, plain values and helpers are better passed from composition into the screen's existing args or props.

**Two translators.** This kit `useT` is the **UI** translator. Chat `useT` is 0b (`useChatT`) and must stay a distinct field and context.

**Dictionary lookup timing.** `components/AssistantDock/assistant-dock-i18n.ts:2189` reads `SETTINGS_DIALOG_DICTIONARIES` at call time through `sharedSettingsCopy`. Keep that lookup at call time when the value comes from the host.

**`TabBarTab` gate.** The kit's `TabBarTab` lacks UI's `disabled`, `dot` and `dotLabel`. Do **not** repoint `TabBarTab` imports in callers that use those fields, such as `StaticSiteTab.tsx:577–578` (`dot`, `dotLabel`). Those callers wait for the 0c/B5 compatibility work.

**Icon names.** `KitIconName` is a closed subset. A moved screen that renders another glyph first needs that name added in Jini `kit.tsx`. Every added name must be a UI `IconName`, or the host assignment fails.

**Not in this slice.** `RemixIcon`, `useTabBarKeyboard` and the other appendix 0a rows go to **B5**, per the fix sheet. That includes the two separate `FetchQueryProvider` fields for `@jini-ai/ui/fetch-query` and `@jini-ai/ui/fetch-query/tanstack`.

## Minor findings (listed, not fixed)

- The spec sheet named in the dispatch (`plans/P9-steps/A-K2-0a.md`) does not exist. The 0a row is in `plans/P9-steps/A-K2-0.md`.
- The `slot()` facade always passes `ref` (`null` when none is given) to the implementation. That is harmless for function components under React 19. A strict host component that rejects unknown props would see it.
- The default bases of `check:why-comments` (`origin/refactor/terra`) and `check:cross-package` (`35c4961af`) are not reachable in a fresh shallow clone. Unattended runs need a deepen or an explicit `--base`.
