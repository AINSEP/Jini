# y5p-sec — Jini-only commit plan (do not commit this file)

## Scope and constraints

One logical commit: `feat(admin): extract live security bindings and access-token controller` (adm-security Jini half, four requested files only).
Source: Tovu `origin/codex/tv-y5-adm-3`; all sheet anchors verified, including Security L123/L126/L133/L135 and controller L386–894.
No installs, builds, tests, typechecks, linters, Git writes, or Tovu edits are authorized here.
Required seams: injected hooks, kit and deps; admin production imports remain core/self/React only. Host literals and styles stay host-owned.

## Tests first

Extend `packages/admin/src/security/host/__tests__/y5-live-secrets.test.tsx` before production edits.
Existing cases: confirmation closes before stored removal; required key prevents custom save; partial other-store failure, counts and serialized replacement/removal.
Add: five-query bootstrap; local removal versus upstream revocation; promotion surviving reconciliation failure (rows and picker); stale refresh; merged store ordering/counts; required-key form and permission gating/bound-hook overrides.
Named mutations (not executed, coordinator must verify):
- `REMOVE_DEFAULT_WITHOUT_PROMOTION`: omit applyPromotedDefault in makeDefault; row and picker assertions must fail.
- `REVOKE_UPSTREAM_ON_LOCAL_REMOVE`: call the upstream-revocation fake from local remove; zero-upstream-call assertion must fail.
- `APPEND_OTHER_AFTER_PROVIDERS`: append other entries after sorting provider entries; merged-order assertion must fail (AccessTokensTab.hooks).
- `SAVE_WITHOUT_KEY`: enable the custom dialog save without readyToSave; disabled-save assertion must fail (AccessTokensTab).
- `BYPASS_SITE_KEY_PERMISSION`: offer/render the key panel without permission; bound Security gating assertion must fail (Security).

## Completed changes

1. `feat(admin): extract live security bindings and access-token controller` — Jini half implemented; leave these edits unstaged/uncommitted for the coordinator.

Changed existing files:
- `packages/admin/src/security/host/__tests__/y5-live-secrets.test.tsx` — tests written before the corresponding implementation; 3 existing tests retained, 4 added (7 total). Added cases cover bootstrap/removal/promotion/reconciliation/stale refresh, merged ordering, bound permission gating/overrides, combined counts and required-key Save. Password autocomplete assertions retain the moved scanner behavior. No tests or mutations executed.
- `packages/admin/src/security/host/AccessTokensTab.hooks.ts` — existing dialog hooks reused unchanged; merged-order types, hook and per-store entry projection moved here. The existing object-argument custom-dialog hook is retained; callers now supply `{ ref, controller }`.
- `packages/admin/src/security/react/live/Security.tsx` — `bindSecurity` captures required hooks, kit and `deps.createPanels`, resolves live/test hook overrides and memoizes the stable slots with the original dependency list. The screen's existing permission gating and layout remain its owner.
- `.changeset/y5-adm-security.md` — extend the existing minor changeset, retaining its previous other-store description.
- `packages/admin/package.json` — source exports and browser entry rows for `./security/host/AccessTokensTab` and `./security/host/hooks/use-access-tokens.hooks`; no dependency edges added.

Created source files:
- `packages/admin/src/security/host/AccessTokensTab.tsx`
- `packages/admin/src/security/host/AccessTokensGroups.tsx`
- `packages/admin/src/security/host/AccessTokenRows.tsx`
- `packages/admin/src/security/host/AccessTokenFields.tsx`
- `packages/admin/src/security/host/AccessTokenDialogs.tsx`
- `packages/admin/src/security/host/hooks/use-access-tokens.hooks.ts`
- `packages/admin/src/security/host/hooks/access-token-queries.hooks.ts`
- `packages/admin/src/security/host/hooks/access-token-stores.hooks.ts`
- `packages/admin/src/security/host/hooks/access-token-refresh.hooks.ts`
- `packages/admin/src/security/host/hooks/access-token-rows.hooks.ts`
- `packages/admin/src/security/host/hooks/access-token-drafts.hooks.ts`
- `packages/admin/src/security/host/hooks/access-token-state.hooks.ts`
- `packages/admin/src/security/host/hooks/access-token-groups.hooks.ts`
- `packages/admin/src/security/host/hooks/access-token-store-operations.ts`
- `packages/admin/src/security/host/hooks/access-token-actions.ts`
- `packages/admin/src/security/host/hooks/access-token-replace-actions.ts`
- `packages/admin/src/security/host/hooks/access-token-add-actions.ts`

No sheets stopped: all four requested source anchors match the dispatched branch. Other adm sheets are outside this job. The already-built other-credentials controller was not changed.

## Required Tovu binding work

Public package paths (new leaves plus extended leaves):
- `@jini-ai/admin/security/host/AccessTokensTab` — `AccessTokensTab`, `AccessTokensTabProps`, `AccessTokensTabBindings`, `bindAccessTokensTab`.
- `@jini-ai/admin/security/host/AccessTokensTab.hooks` — existing object-argument `useRemoveConfirmDialog` / `useAddCustomCredentialDialog`, their view types, plus `useMergedSecretsOrder` / `MergedSecretsEntry`.
- `@jini-ai/admin/security/host/hooks/use-access-tokens.hooks` — `useAccessTokens`, `bindAccessTokens`, controller/form/group types and required structural hook/dependency contracts.
- `@jini-ai/admin/security/react/live/Security` — existing screen and props plus `bindSecurity` / `SecurityBindingProps` (existing package export).

`AccessTokensTab.tsx` becomes one `bindAccessTokensTab({ hooks, kit, deps })` call. The raw view's required inputs are grouped; its bound component preserves optional live-hook test overrides and `showCopyKeysEntry`. Pass the existing Copy Keys hook, locale hook, access-token hook, other-credentials hook, merged-order hook, two dialog hooks and tab-keyboard hook by reference.

Bind `kit.OtherCredentialEntry` with a one-expression JSX adapter that supplies today's OtherCredentialsSection dependencies (locale/removal hooks, host removal copy, timestamp policy). Jini supplies its `store`, `row`, and `controller`; this avoids a forbidden admin-to-integrations import. Supply CredentialHint, OnboardingChipField and the three host icons in kit. Supply today's category/copy tables, count and handle-label builders, input/field builders, keyboard tab-index rule, removal messages, timezone, copy-entry availability, hosting-plugin URL and encrypted-token notice in deps. Host product wording stays byte-identical in these required inputs. Original why-comments/provenance titles are retained verbatim, including pre-existing product references in comments; production strings are injected.

The access hook becomes one `bindAccessTokens({ port, hooks, deps })` call; hooks include `useLocaleHook`, `useFetchQuery`, `useSettlementGeneration`, `useContentRefreshSubscription`. Deps include `defaultT`, category/resource/provider-copy policy, legacy sentinel labels, descriptor localization and required foreign rules. Original foreign value inventory: `buildCredentialConnectionInput`, `requiredFieldsFilled`, `withPromotedDefault`, `buildSourceControlConnectionInput`, `sourceControlProviderInfoFromDescriptor`, publish/source-control row-label constants (captured as `LEGACY_SENTINEL_LABELS`), `suggestCredentialWorksFor`, access-token readiness/build/update/classification functions, `translateCredentialMessage`, `credentialDraftError`, and `describeApiError`. Supply `isApiError: (error): error is AdminHttpError => error instanceof ApiError` as the original class check's one-expression host adapter. No new API endpoints are needed.

`Security.tsx` becomes one `bindSecurity({ hooks, kit, deps })` call. `deps.createPanels` is a one-expression arrow returning today's five panel slots; it receives `useAccessTokensHook` (possibly undefined, as today), resolved `useSiteKeyHook`, and resolved `useAdminLocaleHook`. Preserve the exact existing SiteKey props/copy, owner factor ports and recovery slot in that object. Jini owns the memoization and overrides; host slots are JSX adapters and do not call hooks. Other deps are existing screen copy and tab navigation.

Delete the host `AccessTokensTab.hooks.tsx`, repoint its two consumers and raw fixtures to the Jini hook leaf, and update the custom-dialog invocation to the existing Jini object argument. Repoint the content-refresh source probe to `../node_modules/@jini-ai/admin/src/security/host/hooks/access-token-refresh.hooks.ts`, which contains the actual subscription. Move/prune the tab's literal-copy baseline rows. Add keep rules for AccessTokensTab, Security and use-access-tokens only after reading their final G3 bindings; the other-controller binding/keep already came from the previous slice. No Tovu files or keep ledgers were edited here.

## Closeout

No mutation sensitivity or runtime success is claimed without execution. Tovu must bind the new public leaves, delete its dialog-hook file, repoint source probes and raw tests, and append keep rules only after its bindings pass G3.
Diff cleanup deletions: removed unused propagated binding parameters from pure field/actions/indicator children, unnecessary private function exports, unused copied imports/constants, duplicate imports and an unrelated JSON Unicode-escaping change. No existing tests or behavior branches were deleted.

Validation available: source anchors read and matched; extracted files were parsed while performing AST-guided edits/import cleanup. No tests, mutation runs, builds, installs, typechecks, linters or counter runs were performed. Runtime behavior and mutation sensitivity remain for Opus/coordinator validation. Git was only read; all requested changes remain in the working tree. Tovu G3 completion/counting is not claimed.
