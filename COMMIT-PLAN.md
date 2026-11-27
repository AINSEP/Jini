# y5q-depmed — Jini only

Working-tree delivery; coordinator commits. No tests, builds, installs, typechecks, linters, or mutations executed, as dispatched.

## Ordered commits

1. adm-other — complete the legacy Media screen under `packages/admin/src/screens/media/`.
   - Tests first: `packages/admin/src/screens/__tests__/y5-admin-surfaces.test.tsx`.
   - Existing cases cover one pending upload and metadata partial patches. Add the screen's exact-item deep-link projection and live provider-count composition.
   - Named mutation: `DISCARD_EXACT_LOOKUP` replaces `media: controller.lookupMedia` with `media: controller.media` at the item-link hook call. The screen test must reject the missing exact item.
   - Screen and private splits, admin manifest, `.changeset/y5-adm-other.md`.
2. adm-deployment — finish/review the existing StaticSiteTab and its named private splits.
   - Tests first: existing `packages/devops/src/deploy/react/__tests__/y5-static-site.test.tsx` covers all listed lifecycle cases and the injected screen.
   - Named mutation: `ACCEPT_STALE_PREVIEW` removes the generation comparison in the existing publish preview controller; the late-preview test must fail.
   - Record exact touched files and review outcome below before handoff.

## Boundaries

- Only the two requested Jini screen counterparts; reuse the existing controllers and rules.
- Required host components, hooks and services; admin imports only core and itself.
- Host styles, product literals, route wiring, keep ledger and source probes belong to the coordinator's host half.
- No dependency edges, forwarding shells or additional behavior.

## Closeout

Both requested Jini screen counterparts are present. No sheet stopped. No host completion/count is claimed: the host binding/deletion, importer changes, source probes and keep ledger are outside this Jini-only dispatch. Unrelated sections of the nine sheets were not edited.

### 1. adm-other — completed in the working tree

Tests were edited before the new screen files. Existing media tests already cover the single pending upload and metadata partial patch; one additional test covers the screen's exact-item deep-link projection and live catalog/count composition. No existing assertion or case was deleted or weakened.

Files:
- `packages/admin/src/screens/__tests__/y5-admin-surfaces.test.tsx`
- `packages/admin/src/screens/media/Media.tsx`
- `packages/admin/src/screens/media/MediaPageShell.tsx`
- `packages/admin/src/screens/media/MediaPreview.tsx`
- `packages/admin/src/screens/media/MediaCards.tsx`
- `packages/admin/src/screens/media/MediaEditPanel.tsx`
- `packages/admin/src/screens/media/MediaEditFields.tsx`
- `packages/admin/src/screens/media/MediaEditChildren.tsx`
- `packages/admin/src/screens/media/MediaToolbar.tsx`
- `packages/admin/src/screens/media/MediaLightbox.tsx`
- `packages/admin/src/screens/media/MediaPurgeDialog.tsx`
- `packages/admin/src/screens/media/MediaGridOrEmpty.tsx`
- `packages/admin/src/screens/media/MediaLibraryPanel.tsx`
- `packages/admin/package.json`
- `.changeset/y5-adm-other.md`

Public entry: `@jini-ai/admin/screens/media/Media` (source-format exports; browser entry). Exports `Media` and `MediaProps`. Split-file exports are private implementation imports, not public manifest entries.

Required inputs are `MediaProps.kit`, `.hooks`, and `.deps`; optional existing view inputs remain `tabId`, `itemId`, and `viewerTimeZone`. The required hook object contains the existing twelve media/theme/kit hooks plus `useRemoteImageImport` and `useFetchMutation`. The kit contains the original imported components, including the publish button, External Providers panel, playback note, icons, remote-image import and UI pieces. The deps object contains the provider catalog port, default import port, API error describer, dictionary function, conversion-notice key, viewer timezone and grid storage key.

The host supplies its exact existing grid storage-key bytes. Upload-limit policy stays in the existing injected playback-note component and existing upload hook/port, which this task does not rewrite. The original import-dialog kit is composed from the injected components. All custom hooks in moved code remain required. No production import from CMS, integrations, UI or UI kit was added.

Reuse: existing media controllers, grid/tab/preview rules, item-link hook and metadata/grid-size hooks remain their original owners. The new view uses those existing seams; it does not use the alternative MediaPage route.

### 2. adm-deployment — completed in the working tree

The current branch already contained the complete StaticSiteTab, named splits, manifest export/browser entry, binder and `.changeset/y5-adm-deployment.md`. Reused them instead of creating another screen. The existing y5 test already contains all listed lifecycle cases and the ACCEPT_STALE_PREVIEW case. Before editing the production screen, strengthened its existing view test to assert exactly one export, publish and credential-hook call, in that order, with the publish targets passed to credentials.

Files:
- `packages/devops/src/deploy/react/__tests__/y5-static-site.test.tsx`
- `packages/devops/src/deploy/react/StaticSiteTab.tsx`
- `packages/devops/src/deploy/react/StaticExportCard.tsx`
- `packages/devops/src/deploy/react/StaticPublishCredentials.tsx`
- `packages/devops/src/deploy/react/StaticCredentialFields.tsx`
- `packages/devops/src/deploy/react/StaticCredentialSteps.tsx`
- `packages/devops/src/deploy/react/StaticPublishForm.tsx`

Production edits add the required `_optional = {}` argument to the remaining single-argument component functions. No workflow/controller statements changed. Existing public entry: `@jini-ai/devops/deploy/react/StaticSiteTab`, exporting `StaticSiteTab`, `StaticSiteTabProps` and `bindStaticSiteTab`. No new devops entry or dependency is needed.

### Coordinator host work

- Delete the old Media screen, load the new entry lazily from panel-pages, and inject its required objects at media-panel; preserve the existing grid key, timezone, provider/import ports and Publish button.
- Repoint media view tests/typechecks and both media-i18n source probes to the new entry/private source leaves. Copy and accessible attributes now live across the Media*.tsx splits, so the probes must read the relevant leaves rather than only the root screen. Prune the old literal-copy baseline rows.
- Bind StaticSiteTab with its existing required objects. Zero-argument arrow adapters are allowed for host hooks that take an empty required object.
- Add the static-site binding's exact anchored path to the host keep fence after its G3 review; the deleted Media file needs no keep entry. Host counter execution remains with the coordinator.

### Review and verification

Source review only. No test suite, targeted test, mutation, install, build, typecheck, linter or counter was run. Mutation sensitivity and runtime parity remain UNVERIFIED for Opus/cloud execution.

Static review covered required injection, unchanged core/controller ownership, private split imports, preservation of edit/lightbox keys, upload dialog persistence, exact-item lookup, provider early return, picker/trigger composition and original hook call order. Source inventory shows all new screen files below 500 lines and component functions at most 50 lines. No package dependency edges, product literals, forwarding shells, suppression directives or fallback behavior were added.

Architecture audit: PASS for the inspected source boundaries; runtime/self-validation: NOT RUN by dispatch instruction. Function-quality disposition: INCONCLUSIVE until the required behavioral and mutation tests execute; no scale or I/O algorithm was changed (existing O(n) card rendering, fixed-size tab projection and existing controller effects).

Final diff pruning: removed one unused generated type import and redundant injected destructuring; no tracked source/test files or tests were deleted. The host storage-key constant becomes a required input, as specified. All moved why-comments are retained, with product identity neutralized where present.
