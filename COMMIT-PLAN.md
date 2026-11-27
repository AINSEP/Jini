# adm-dom2-j — uncommitted coordinator handoff

Base: b77213b8b29499d0121dc94565beba25c9cb382c (codex/adm-dom2-j = origin/codex/adm-dom-j).
Source: Tovu origin/codex/tv-adm-dom (a844a2c7df). Scope: J07 hooks, J12, J16, J15 only.
No subagents. No tests, builds, installs, typechecks or linters run. Git remains read-only.
All mapped destinations checked absent; J11 EditorDraftPort prerequisite present.

## Ordered commits (coordinator commits; status updated below)
1. J07 package prep: packages/agentic/{package.json,tsconfig.json,tsconfig.react.json,vitest.config.ts}, pnpm-lock.yaml.
2. J07 controller leaves and witnesses: packages/agentic/src/react/skills/{use-skill-files.hooks.ts,use-skill-install.hooks.ts,use-skills.hooks.ts,__tests__/skills-install-generation.unit.test.tsx,__tests__/skills-reload-after-write.unit.test.tsx}, .changeset/admin-extraction-07.md; preserve landed API and wire test.
3. J12 core port + nine CMS leaves and three named witnesses; .changeset/admin-extraction-12.md; package manifests/isolation entries.
4. J16 six DevOps leaves and three named witnesses; .changeset/admin-extraction-16.md; manifest/isolation entries.
5. J15 four DevOps leaves and two named witnesses; .changeset/admin-extraction-15.md; manifest/isolation entries.

## Mutation witnesses (Opus runs)
- J07 M-install-before-confirm: write from proposal; M-allow-superseded-upload-read: remove generation comparison. Verify proposal has zero writes, one confirmation write, newest of two reads wins. Refresh witness pins accepted-write load, one invalidation and subscription cleanup.
- J12 M-recompute-entry-id-from-new-slug: replace loaded id with slug. M-accept-refused-url-scheme: admit a non-HTTP(S) URL. M-refocus-before-dialog-cleanup: final editor focus before closing. Pin patch omission/clearing, no-id preview, transition and cleanup before focus.
- J16 M-save-dockerfile-without-captured-version: empty ifMatch. M-mark-unverified-credential-connected: success style on unreachable. Pin routes/exclusive mounts, captured ETag, retained draft through conflict/reload, required fields.
- J15 M-hide-unlisted-saved-connection: drop appended saved row. M-pass-unredacted-token-to-hint: replace saved hint.last4 with full draft. Pin order, unlisted no form, classifier and exact saved hint prop.

## Status / API baseline delta / deletions
Implementation prepared for J07 → J12 → J16 → J15; all changes remain uncommitted. No sheet stopped for an anchor mismatch. API baseline JSON regeneration and every executable verification belong to Opus.
No existing tests deleted or weakened. No source deletions in Jini; former Tovu sources are T-sheet work.


## Handoff status
- Ten named witness files were written before the production edits for their sheet. Each contains one test; no existing test was changed, removed or weakened. The landed skills-client.wire.unit.test.ts remains unchanged.
- No tests (including mutation runs), builds, installs, typechecks, linters, guard, or API generators were run. Red/green, mutation strength, compilation, caps and browser behavior are therefore UNVERIFIED, not certified.
- Static review: collaborators are required on the moved leaves; UI/admin/TipTap runtimes are not imported by the new domain leaves; hook event subscription, dirty guard browser effects, clipboard, download, transport discrimination and branded policy/copy remain host responsibilities. Agentic root lib, DOM compiler and purity guard remain unchanged.
- The named DockerfileEditorActions and saveDockerfile are the only newly extracted private functions. Existing render bodies and why-comments stay in place. No further cap-driven helper splits were invented; Opus must reconcile any cap finding against the sheet's verbatim-move constraint before adding helpers.
- Source/importer review read 151 scoped blobs at Tovu a844a2c7dfad001ad4d0e45f4c0829e199c090b7, including the listed mocks, lazy route consumers and source pins. All named external blobs exist. The scoped match inventory is /tmp/adm-dom2-importers.txt (scratch only).

## Removal of unrequested edits during final review
- Removed incidental JSON Unicode escaping and existing manifest indentation changes.
- Removed temporary additions for the three older CMS post isolation entries; only the nine new leaves are registered.
- Removed the temporary repeated ten-field patch list from CMS. PostUpdatePatch is derived from the core port member with the existing PostFormState projection.
- Removed broad SVGProps acceptance from injected icon signatures; only rendered attributes and names remain.
- Removed a redundant second URL-hook test harness while retaining all guard, focus-order and empty-alt assertions.
- Removed the extra async-await wrapper turn around the extracted save body; the existing save callback returns the helper promise directly.
- No existing Jini source files deleted. Host-only defaults/resolvers, download body, 412 reader and wired hooks are not copied into Jini. Their originals still exist in Tovu for T12/T16/T15 to relocate/bind, along with the capability tables and env-note map.

## Tovu integration requirements
- T07-hooks: bind the three new agentic hook leaves; subscribeChanged must add/remove the identical SKILLS_CHANGED_EVENT listener. Keep the landed API/event/guidance binding. installSkill remains a positional payload function. Bind the real upload reader and describeFailure with SKILL_FAILURE_HOST.
- T12 (after T11): specialize core PostEditorPort<Row, CreateInput, Presentation, Draft, Snapshot>; use nine CMS leaves below. Bind date/schedule/slug rules, classifiers and four-field reporter, Icon, siteUrl, device/view/toolbar renderers, preview rules, sandbox and preview hooks. URL hook requires getEmbedUrlFromYoutubeUrl plus a required afterEditorFocus scheduler; keep requestAnimationFrame host-side.
- T16: mount the six DevOps deployment leaves. Reuse the existing generic useDeploymentOverview binding. Supply staticSiteCapabilities/fullSiteCapabilities, four-entry envVarNotes, unsafeOwnerPasswordVar, copy.fullSiteGetLine and copy.unsafeOwnerPasswordLabel. credentialStepSubtitle requires copy.credentialSubtitle. asciiSlug is required by fieldNameHandleSegment and both handle-ID helpers. Bind download, clipboard, dirty guard, failure messages and readSaveConflict (only a non-null result resets mutation state). Static Site and History remain zero-prop host compositions.
- T15 (after T16): mount ProvidersTab and bind useSourceControlCredentials with the four-method port, query hook, localization/credential/error helpers and both message formatters. Pass kit, lineIcon, CredentialHint, viewer zone, navigation, J16 field helpers with asciiSlug bound, copy.providersRegionLabel and copy.storedTokenHint. Descriptor mapping now takes { descriptor }. Undefined hint is omitted; only saved tokenHint reaches CredentialHint.
- Keep existing linked-package ranges. No Tovu manifest, changeset, source or test was edited here. Host deletions and pin/debt updates belong to the T sheets.
- Other ext-a sheets, including NEEDS-OPUS/REJECT sheets, are outside this dispatch; no work inferred from their ledger rows.

## Exact API-baseline delta (Opus owns JSON regeneration)
Existing core leaf ./contracts/site/content-editor-ports adds only PostEditorPort, against api-baseline/jini-ai__core.json. Existing exports/barrels remain intact.

### J07: api-baseline/jini-ai__agentic.json
- ./react/skills/use-skill-files.hooks: useSkillFiles, useSkillFilesModal
- ./react/skills/use-skill-install.hooks: useSkillInstall
- ./react/skills/use-skills.hooks: useSkills, SkillsController

### J12: api-baseline/jini-ai__cms.json
- ./react/posts/editor/header/PostEditorActions: PostEditorActions
- ./react/posts/editor/header/PostEditorHeader: PostEditorHeader
- ./react/posts/editor/view-bar/PostEditorViewBar: PostEditorViewBar
- ./react/posts/editor/preview/PostPreview: PostPreview
- ./react/posts/editor/preview/PostPreviewFrame: PostPreviewFrame
- ./react/posts/hooks/post-editor-messages: SaveStatusOverride, formatSaveSuccessMessage, formatOutsideChangeMessage, formatSaveErrorMessage, POST_LOAD_FAILED, POST_NOT_LOADED_SAVE_REFUSED, reportPostLoadFailure
- ./react/posts/hooks/post-editor-state.rules: PostFormState, ActivePostTheme, resolveActivePostTheme, savedHideCoverImageInBody, loadedPostForm, postFormSnapshot, resolveEditorSlug, LoadedPostHandles, loadedPostHandles
- ./react/posts/hooks/post-editor-save.rules: PostUpdatePatch, scheduleFieldsPatch, authorFieldsPatch, PostSaveWorkingCopy, buildPostUpdatePatch, SavedPostFields, savedPostFields, withEverPublished, keepNewerEdit
- ./react/posts/hooks/use-post-url-dialog.hooks: PostUrlEditorPort, usePostUrlDialog, PostUrlDialogController

### J16: api-baseline/jini-ai__devops.json
- ./deploy/react/Deployment: DeploymentProps, Deployment
- ./deploy/react/OverviewTab: OverviewTabProps, OverviewTab
- ./deploy/react/deployment-visuals: OverviewIcon, StaticSiteIcon, FullSiteIcon, HistoryIcon, LayersIcon, StepDoneIcon, DisclosureChevron, CapabilityMark, CapabilityList
- ./deploy/react/rules: AdminPublishTargetField, AdminPublishTargetCredentialSpec, AdminPublishTargetDescriptor, DEPLOYMENT_EXPORT_RESOURCE, PUBLISH_CREDENTIAL_ROW_LABEL, credentialsForProvider, defaultCredentialForProvider, withPromotedDefault, PublishCredentialSubmitFailure, publishTargetById, requiredFieldsFilled, declaredFieldValues, buildStaticPublishConfig, staticPublishFormReadyForPreview, staticPublishFormReadyToPublish, staticPublishProjectNameToSend, credentialFormReadyToSave, buildCredentialConnectionInput, StaticPublishProjectNameCopy, staticPublishProjectNameCopy, fieldNameHandleSegment, publishConfigFieldHandleId, credentialFieldHandleId, credentialNoun, credentialStepSubtitle, fieldHelpText, fieldLabelParts, DeploymentCapability, deploymentEnvVarNoteKey, isEnvVarRowUnsafe, envVarStatusLabelKey, credentialVerifyStatusClass, runtimeModeLabelKey, productionGateLabelKey, daemonStatusLabelKey, ownerPasswordLabelKey, runStatusTone, exportRunStatusLabelKey, publishRunStatusLabelKey
- ./deploy/react/DockerfileTab: DockerfileTabProps, DockerfileTab
- ./deploy/react/hooks/use-dockerfile-source.hooks: DockerfileSourceController, useDockerfileSource

### J15: api-baseline/jini-ai__devops.json
- ./source-control/react/rules: AdminSourceControlProviderId, AdminSourceControlProviderDescriptor, AdminSourceControlCredentialSummary, AdminSourceControlConnectionInput, AdminSourceControlProvidersSnapshot, SourceControlProviderInfo, sourceControlProviderInfoFromDescriptor, sourceControlProviders, SourceControlCredentialFormFields, buildSourceControlConnectionInput, SOURCE_CONTROL_CREDENTIAL_ROW_LABEL, sourceControlCredentialsForProvider, defaultSourceControlCredentialForProvider, sourceControlCredentialRowReadyToSave, SourceControlCredentialSubmitFailure, classifySourceControlCredentialSubmitError, SourceControlProvidersNotice, sourceControlProvidersNotice
- ./source-control/react/source-control-visuals: SourceControlIcon, ConnectedMarkIcon, DisclosureChevronIcon
- ./source-control/react/ProvidersTab: ProvidersTabProps, ProvidersTab
- ./source-control/react/hooks/use-source-control-credentials.hooks: SourceControlCredentialRowState, SourceControlCredentialsController, useSourceControlCredentials

## Full file ledger in coordinator commit order

1. J07 package prep (implemented, uncommitted):
   - packages/agentic/package.json
   - packages/agentic/tsconfig.json
   - packages/agentic/tsconfig.react.json
   - packages/agentic/vitest.config.ts
   - pnpm-lock.yaml

2. J07 production + witnesses + exports (implemented, uncommitted):
   - packages/agentic/src/react/skills/use-skill-files.hooks.ts
   - packages/agentic/src/react/skills/use-skill-install.hooks.ts
   - packages/agentic/src/react/skills/use-skills.hooks.ts
   - packages/agentic/src/react/skills/__tests__/skills-install-generation.unit.test.tsx
   - packages/agentic/src/react/skills/__tests__/skills-reload-after-write.unit.test.tsx
   - .changeset/admin-extraction-07.md

3. J12 production + witnesses + exports (implemented, uncommitted):
   - packages/cms/src/react/posts/editor/header/PostEditorActions.tsx
   - packages/cms/src/react/posts/editor/header/PostEditorHeader.tsx
   - packages/cms/src/react/posts/editor/view-bar/PostEditorViewBar.tsx
   - packages/cms/src/react/posts/editor/preview/PostPreview.tsx
   - packages/cms/src/react/posts/editor/preview/PostPreviewFrame.tsx
   - packages/cms/src/react/posts/hooks/post-editor-messages.ts
   - packages/cms/src/react/posts/hooks/post-editor-state.rules.ts
   - packages/cms/src/react/posts/hooks/post-editor-save.rules.ts
   - packages/cms/src/react/posts/hooks/use-post-url-dialog.hooks.ts
   - packages/cms/src/react/posts/editor/preview/__tests__/post-editor-chrome.guard.unit.test.tsx
   - packages/cms/src/react/posts/hooks/__tests__/post-editor-save.rules.unit.test.ts
   - packages/cms/src/react/posts/hooks/__tests__/use-post-url-dialog.hooks.unit.test.tsx
   - packages/core/src/contracts/site/content-editor-ports.ts
   - packages/cms/package.json
   - .changeset/admin-extraction-12.md

4. J16 production + witnesses + exports (implemented, uncommitted):
   - packages/devops/src/deploy/react/Deployment.tsx
   - packages/devops/src/deploy/react/OverviewTab.tsx
   - packages/devops/src/deploy/react/deployment-visuals.tsx
   - packages/devops/src/deploy/react/rules.ts
   - packages/devops/src/deploy/react/DockerfileTab.tsx
   - packages/devops/src/deploy/react/hooks/use-dockerfile-source.hooks.ts
   - packages/devops/src/deploy/react/__tests__/Deployment.routes.unit.test.tsx
   - packages/devops/src/deploy/react/__tests__/DockerfileTab.conflict.unit.test.tsx
   - packages/devops/src/deploy/react/__tests__/deployment-fields.requires-credential.unit.test.ts
   - packages/devops/package.json
   - .changeset/admin-extraction-16.md

5. J15 production + witnesses + exports (implemented, uncommitted):
   - packages/devops/src/source-control/react/rules.ts
   - packages/devops/src/source-control/react/source-control-visuals.tsx
   - packages/devops/src/source-control/react/ProvidersTab.tsx
   - packages/devops/src/source-control/react/hooks/use-source-control-credentials.hooks.ts
   - packages/devops/src/source-control/react/__tests__/SourceControl.provider-catalog.unit.test.tsx
   - packages/devops/src/source-control/react/__tests__/SourceControl.credential-refusals.unit.test.tsx
   - packages/devops/package.json
   - .changeset/admin-extraction-15.md

## Shared-manifest staging note
packages/agentic/package.json is touched by coordinator commits 1 and 2: stage only compiler scripts/dev dependencies with package prep, then the three export/jini.entries hunks with J07 leaves. packages/devops/package.json is touched by commits 4 and 5: stage the six deploy entries before the four source-control entries. COMMIT-PLAN.md itself is not to be committed.
