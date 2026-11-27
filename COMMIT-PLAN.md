# y5p-depmed — Jini only

Starting Jini HEAD: `525b62432` (`codex/y5p-depmedj`). Move source: Tovu `48f6802924`, the checked-sheet revision. Every named anchor for both requested files matches that revision. The unrelated live Tovu checkout is `685039d820`; it has shifted imports and is not the move source.

No git writes, commits, subagents, Tovu edits, installs, builds, tests, typechecks, or linters. Keep this file uncommitted.

## Ordered design commits for coordinator

1. **adm-other / Media: STOPPED before production.**
   - Exact conflicting source: `48f6802924:apps/admin/src/features/media/Media.tsx:765`.
   - Existing why-comment: ``accessibility tree (only Tovu's own `data-agent-*` convention reads it) — so it gets an explicit``.
   - The hard rule requires this comment to move verbatim, and the hard neutrality rule forbids that product text in Jini. Editing, dropping, or relocating the comment would choose an exception the dispatch does not authorize. No Media production files, exports, changesets, or tests changed. NEEDS-OPUS: resolve this one comment exception before dispatching the move again.
   - Existing `y5-admin-surfaces.test.tsx` media deep-link, one-upload, and partial-patch tests remain unchanged.

2. **adm-deployment / StaticSiteTab: Jini counterpart implemented, unexecuted.**
   Suggested commit: `feat(devops): extract injected static-site screen`.
   Created:
   - `packages/devops/src/deploy/react/StaticSiteTab.tsx` — public screen, props, binder, capabilities and online-card composition.
   - `packages/devops/src/deploy/react/StaticExportCard.tsx` — private copy/export counts, failures, progress, command and trigger sections.
   - `packages/devops/src/deploy/react/StaticPublishCredentials.tsx` — private loading/connected credential composition.
   - `packages/devops/src/deploy/react/StaticCredentialFields.tsx` — private descriptor inputs and token hints.
   - `packages/devops/src/deploy/react/StaticCredentialSteps.tsx` — private connected/unconnected steps, verification and persisted picker.
   - `packages/devops/src/deploy/react/StaticPublishForm.tsx` — private target fields, preview, publish and result composition.
   Changed:
   - `packages/devops/src/deploy/react/__tests__/y5-static-site.test.tsx` — characterization case written before production; typed injected fakes assert export refusal, disabled progress action, and injected host copy/command. Existing five cases preserved; test declarations **5 -> 6**.
   - `packages/devops/package.json` — one `./deploy/react/StaticSiteTab` export, using the nearest sibling's dist format, and one browser `jini.entries` row. No dependency changes.
   - `.changeset/y5-adm-deployment.md` — extend the existing minor changeset for the missing view.

The extra private functions only split the sheet's long copy/field/trigger JSX at typed subsections to satisfy its 50-line limit. No lifecycle/controller changes or additional ports/types/configuration were added.

## Tests first and named mutations

- **Deployment: ACCEPT_STALE_PREVIEW.** Remove the successful-response generation check at `packages/devops/src/deploy/react/hooks/static-publish-form.hooks.ts:94` in `checkPreview`. The existing `a target change rejects a late preview and releases the preview spinner` test asserts that the late first-target result stays absent after switching to the second target, so this mutation should fail its `preview` assertion. Not applied or executed here.
- The existing named file also covers export refusal/progress, edits during credential save/verify, picker persistence after reconciliation failure, one publish trigger, the poll failure limit and timer cleanup. Those controller tests predate this move and remain unchanged.
- **Media (not implemented): DROP_MEDIA_DEEP_LINK** was the planned additional view mutation: omit `itemId` from the screen's media-hook call. No new media test remains for a stopped implementation; the existing controller cases are intact.

No RED/GREEN or mutation-sensitivity claim: execution is explicitly prohibited. Opus must execute the named test file and mutation after this handoff.

## Tovu half: new entry and exact binding inputs

New public subpath: `@jini-ai/devops/deploy/react/StaticSiteTab`.
Exports: `StaticSiteTab`, `StaticSiteTabProps`, `bindStaticSiteTab`. Private split files have no package export or entry rows.

Use one `bindStaticSiteTab({ kit, hooks, deps })` call in the host file:

- `kit`: `Icon`, `CredentialHint`, `SecretInput`, `TabBar`, `ErrorNotice`.
- `hooks`: `useStaticExportHook: useWiredStaticExport`, `useStaticPublishHook: useWiredStaticPublish`, `usePublishCredentialsHook: useWiredPublishCredentials`, `useAdminLocale`, `useWiredCopyToClipboard`.
- `deps`: `PUBLISH_RUN_RESULT_CLASSES`, `LINE_ICON`, `asciiSlug`, `STATIC_SITE_CAPABILITIES`, `createStaticSiteTabTranslator`, `adminHref`, `navigate`, `t`, `VIEWER_TIME_ZONE`.
- `deps.pluginsPath`: `/addons/agent-plugins`.
- `deps.accessTokensPath`: `/access-tokens?tab=access-tokens`.
- `deps.copy.credentialSubtitle`: the existing `copy.credentialSubtitle`.
- `deps.copy.exportDescription`: `Tovu writes every published post, the home page, products and theme pages into the folder you name.`
- `deps.copy.exportCommand`: `tovu export <dir>`.
- `deps.copy.storedTokenNotice`: `Stored encrypted on the server. Once saved, Tovu never displays it again.`
- `deps.copy.pickerTokenNotice`: `token. Pick which one Tovu publishes with.`
- `deps.copy.productName`: `Tovu` (used in the original picker agent label).

The bound component mounts without hook calls in the host. Raw view fixtures must pass all three required collaborator objects. Add `^apps/admin/src/features/deployment/StaticSiteTab\.tsx$` to the Keep rules fence only after the host binding is actually pure. This Jini-only job makes no G3/count/keep completion claim.

Media remains blocked and has no new entry.

## Static review and deletions

- All original block comments and full-line comments from StaticSiteTab are present verbatim across its moved files.
- Imports are React types, core, or the same devops package; no host/UI/admin/vendor package edge was added.
- No product-name text exists in the six new production files.
- Files: 108–422 lines. Largest function: 46 lines. Source parsing reported no syntax diagnostics. These are static source observations, not a typecheck, test result, or runtime verification.
- Existing controller files are untouched; hook invocation order and original event handler statements are retained.
- Architecture review: PASS for the inspected package boundaries; execution/type compatibility is UNVERIFIED by dispatch.
- Runtime/self-validation not run: dispatch explicitly forbids execution checks.
- Review deletions: removed the newly drafted media screen test because its production entry is blocked; no existing tests removed. Removed one unused generated `kit`/`deps` destructure from the credential-section wrapper. No tracked production paths deleted. No coverage settings, assertions, exclusions, thresholds, or capabilities reduced.
- The earlier suspected deployment icon-contract blocker was disproved by reading the pinned calls at source lines 466 and 481; both pass `LINE_ICON`. No deployment blocker remains from that suspicion.
