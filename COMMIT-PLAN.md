# M26SI-a — Jini working-tree delivery

No commits: coordinator owns commits; `.git` is read-only. No installs, builds,
tests, typechecks, linters, or guards are run here. Tests are written first;
red/green and mutation execution are deferred to Opus.

## Ordered logical commits

1. Sheet 1 — export runtime metadata (implemented; unverified).
   Files: `packages/cms/package.json`, `packages/core/package.json`,
   `scripts/__tests__/m26si-export-metadata.test.ts` (new).
   Mutation: remove any one of the five required `universal` classifications.
   Tests: five manifest-classification cases written before the manifest edits.
2. Sheet 2 — generic CMS surface styling (implemented; unverified).
   Files: `packages/cms/src/react/pages/page-editor-rules.ts`,
   `packages/cms/src/react/pages/__tests__/page-editor-rules.unit.test.ts` (new).
   Mutation: restore concrete CanvasStyling or replace the returned styling object.
   Test: host-specific styling inference, identity, and all four surface variants.
   The concrete-type mutation requires typechecking the test; runtime assertions
   cover identity and variants. Neither kind of verification was run here.
3. Sheet 3 — injected media filename and HTML attribute parser (implemented; unverified).
   Files: `packages/admin/src/screens/media/Media.tsx`, `MediaCards.tsx`,
   `hooks/use-edit-media-panel.hooks.ts`,
   `__tests__/media-screen-states.unit.test.tsx`,
   `hooks/__tests__/use-edit-media-panel.injection.test.tsx` (new), all under that media directory.
   Mutation: use either original imported implementation instead of the injected value.
   Tests: desktop/phone filename output and bound hook's parser receiving live
   draft text plus the identical embed policy. Existing filename fixture uses the real helper.
4. Sheet 4 — injected Posts sorting (implemented; unverified).
   Files under `packages/admin/src/posts/`: `Posts.tsx`, `PostsColumns.tsx`,
   `__tests__/y5-post-list.test.tsx`.
   Mutation: use the imported default or any imported comparator/label instead of its injected field.
   Test: bound screen's injected initial sort, all four comparators, both label
   helpers, and Updated descending. Existing column fixture supplies real sorting values.
5. Sheet 5 — injected Settings browser panel and BYOK translator (implemented; unverified).
   Files under `packages/admin/src/screens/settings/`: `SettingsUi.tsx`,
   `SettingsUiTabs.tsx`, `__tests__/SettingsUiTabs.injection.test.tsx` (new).
   Mutation: restore the imported panel or translator at any of the three BYOK slots.
   Test: panel identity, locale/translator/required-hook props, rendered checkbox,
   and translator identity at all three BYOK components.
6. Sheet 8 — injected access-token secret control and slugger (implemented; unverified).
   Files under `packages/admin/src/security/host/`: `AccessTokensTab.tsx`,
   `AccessTokenFields.tsx`, `AccessTokenDialogs.tsx`, `AccessTokensTab.hooks.ts`,
   `__tests__/AccessTokensTab.unit.test.tsx`, `__tests__/y5-live-secrets.test.tsx`.
   Mutation: restore the imported control at any of the three sites, or bypass the injected slugger.
   Test: all three injected secret controls render their values; the injected
   slugger determines the extra-field ID. Both existing tab fixtures supply real helpers.
7. Sheet 12 — injected passkey admission helpers (implemented; unverified).
   Files under `packages/user-management/src/admin-http/owner/`:
   `passkey-routes.ts`, `passkey-admission.ts`, `__tests__/y5-passkey-admission.test.ts`.
   Mutation: call either original helper instead of the injected helper.
   Existing binder case now supplies spies wrapping both real helpers and checks
   lazy nonowner admission, sign-in delegation, helper calls, and failure-to-incident mapping.

## Scope

Sheets 6, 7, 9, 10 are outside this dispatch. Sheet 11 is explicitly skipped:
generated payload requires a build, which this dispatch prohibits.

## Final diff pruning

Re-read the production diff and all new/changed tests. No unrelated production
edits were retained. Deletions are only the imports replaced by injection, the
CMS UI type import, and the branded citation replaced with the required neutral
ordering rationale. No tests, assertions, capabilities, or guards were deleted
or weakened. No extra production helpers, types, exports, or options were added.

Static review only: the requested runtime edges are replaced with required
injection and type-only signatures; selector branches, deferred reads, passkey
getter, labels, sorting direction, and execution order are retained. No themes,
isolation maps, allowlists, baselines, or guard code changed. Eleven new test
cases were added (five are metadata table rows); one passkey case was strengthened.

Known pre-existing test mismatch, left unchanged: the final origin-refusal case
in `packages/user-management/src/admin-http/owner/__tests__/y5-passkey-admission.test.ts`
imports `ownerPasskeyActionRoute` from `../passkey-route-deps.js`, which does not
export it. The function is exported by `../passkey-routes.js`. This is outside
the sheet's helper-injection fix and needs coordinator follow-up before that
test file can be fully green. No test run was attempted.

## Host wiring handoff

No new subpaths or exports are needed. All implementation sources below already
have public exports; bind their stable values once at the existing host seams.

- `Media.deps.mediaFileName` and `bindEditMediaPanel.deps.parseMediaHtmlAttributes`:
  originals from `@jini-ai/admin/media`; pass the bound hook into Media as before.
- `bindPosts.deps.sorting`: the seven named original values from
  `@jini-ai/admin/shell/lib/admin-post-list-sort`.
- `bindSettingsUi.kit.BrowserAgentSettingsPanel`: original from
  `@jini-ai/admin/screens/webmcp/BrowserAgentSettingsPanel`.
- `bindSettingsUi.deps.createAdminByokKeyPanelTranslator`: original from
  `@jini-ai/admin/shell/components/AdminByokKeyPanel.hooks`.
- `bindAccessTokensTab.kit.SecretInput`: original from
  `@jini-ai/admin/shell/components/SecretInput/SecretInput`.
- `bindAccessTokensTab.deps.asciiSlug`: original from
  `@jini-ai/admin/shell/lib/ascii-slug`.
- Server composition: supply both required helpers from
  `@jini-ai/user-management/admin-http/owner/passkey-route-deps` to
  `bindOwnerPasskeyRoutes`. No server binder caller was found in the inspected
  `packages/server/src` or elsewhere within `packages/user-management/src`.
- `bindPageEditor.deps.pageEditorSurface` remains the same implementation;
  the existing concrete binding signature infers its styling type.

Coordinator must execute tests, typechecking, mutations, and isolation re-checks.
No runtime, guard, or mutation pass is claimed by this delivery.
