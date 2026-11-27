# Y5 adm Round 3 — Jini working tree

Jini only. Tovu 48f6802924 is read-only source. No .git writes, subagents, installs, builds, tests, typechecks or linters. Tests precede production changes; mutation sensitivity is not executed here.

## Ordered sheet commits

1. adm-shell-lib — inherited: createSettingsTabs and six codecs. Mutation DEFER_WITHDRAWAL_UNTIL_WRITE: immediate-denial order assertion.
2. adm-shell-hooks — inherited: bindAdminAppearance. Mutation RETIRE_NEWER_DRAFT: newer-theme-draft assertion.
3. adm-shell-components — inherited: media content editor, bindExecutionConfig, subscribeStoredKeyRefresh. Mutation ADOPT_AFTER_DISPATCH: first-turn adoption/durability before dispatch (still missing).
4. adm-security — inherited: two dialog hooks. Mutations REMOVE_DEFAULT_WITHOUT_PROMOTION and REVOKE_UPSTREAM_ON_LOCAL_REMOVE remain to be characterized against live controllers.
5. adm-other — inherited: email/storage binders, Providers, External MCP controller/admissions. Mutation EXTERNAL_MCP_LOST_UPDATE: exact expectedVersion body assertion.
6. adm-deployment — inherited: static-export and static-publish controllers/binders. Mutation ACCEPT_STALE_PREVIEW: late first-target preview must remain absent after selecting second target.
7. adm-pages — inherited: route rules, public-path, PageEditorPreview. Mutation BODY_WRITE_BEFORE_CAS: metadata conflict must prevent HTML write.
8. adm-posts — inherited: list controller/binder, CMS editor-input rules. Mutation DROP_POST_EXPECTED_VERSION: exact toggle payload requires row version. Trash CAS cannot be added: pinned deletePost({id}) has no expectedVersion contract.
9. adm-publish-content — inherited: report rules. Mutation EXECUTE_BEFORE_CONFIRM: unconfirmed plan must never execute (ceremony remains missing).

## Tovu handoff

No Tovu files changed. The Tovu builder must perform G3 binding/deletion review, caller and source-probe redirects, literal-baseline pruning, keep ledger and counter. No Tovu target is claimed completed from this checkout.

## Diff pruning

No deletions.

## Round-3 additions by ordered commit unit

The units below are proposed coordinator commits, not commits made here. No whole-sheet completion is claimed for sheets with pending rows below.

1. adm-shell-lib: inherited implementation/export/test, no edits.
2. adm-shell-hooks: inherited implementation/export/test, no edits.
3. adm-shell-components: inherited media-editor/execution work, no edits; dock remains unfinished.
4. adm-security:
   - packages/admin/src/security/host/hooks/use-other-credentials.hooks.ts (new)
   - packages/admin/src/security/host/hooks/other-credential-store-operations.ts (new private split)
   - packages/admin/src/security/host/__tests__/y5-live-secrets.test.tsx
   - packages/admin/package.json (other-credentials export/entry)
   - .changeset/y5-adm-security.md
   Preserves per-store failures, configured/search counts, serial replace/remove, post-write reads, secret clearing and local external-MCP deletion. Default promotion and upstream-revocation mutation cases remain outstanding with the access-token controller.
5. adm-other:
   - packages/admin/src/screens/media/hooks/use-media.hooks.ts (new)
   - packages/admin/src/screens/media/hooks/use-edit-media-panel.hooks.ts (new)
   - packages/admin/src/screens/__tests__/y5-admin-surfaces.test.tsx
   - packages/admin/package.json (two media hooks and existing Providers export/entry)
   - packages/cms/src/react/media/hooks/use-grid-pages.hooks.ts
   - packages/cms/src/react/media/hooks/use-media-writes.hooks.ts
   - .changeset/y5-adm-other.md
   The two CMS edits only admit explicit undefined for the existing itemId/alt fields, preserving the moved controller's original argument objects under exactOptionalPropertyTypes. No runtime statements changed in those CMS hooks. Media hook inputs are required hooks/deps; locale/copy/ports bind inside Jini. Metadata patches retain the frozen mount baseline and distinguish untouched description from an explicit empty string. Clipboard/scheduling/embed policy are injected. The grid still comes from injected CMS hooks; upload retains the synchronous duplicate guard and original conversion/settlement behavior. Providers source was already present; only its public registration was missing.
6. adm-deployment:
   - packages/devops/src/deploy/react/hooks/use-publish-credentials.hooks.ts (new)
   - packages/devops/src/deploy/react/hooks/publish-credential-draft.ts (new private split)
   - packages/devops/src/deploy/react/hooks/publish-credential-writes.ts (new private split)
   - packages/devops/src/deploy/react/hooks/publish-credential-selection.ts (new private split)
   - packages/devops/src/deploy/react/__tests__/y5-static-site.test.tsx
   - packages/devops/package.json (credentials and existing static-publish export/entry)
   - .changeset/y5-adm-deployment.md
   Preserves query seeding, row edits during save/verify, verified-account projection, duplicate guards, confirmed default promotion before best-effort reconciliation, and persisted picker selection. Uses core contracts and structural injected collaborators, with no devops-to-admin edge. The inherited test's classifier fake now says generic, matching the actual host classifier; assertions are unchanged. Static publish source was already present; only public registration was missing.
7. adm-pages: inherited routing/public-path/preview work, no edits; editor and controller unfinished.
8. adm-posts:
   - packages/admin/src/posts/Posts.tsx (new)
   - packages/admin/src/posts/PostsColumns.tsx (new private split)
   - packages/admin/src/posts/PostsTrashConfirm.tsx (new private split)
   - packages/admin/src/posts/__tests__/y5-post-list.test.tsx
   - packages/admin/package.json (Posts export/entry)
   - .changeset/y5-adm-posts.md
   Adds the view over the inherited controller. Keeps loading/action-error behavior, local sorting, handles, confirmation and translated copy. CMS row-menu rules, status/publish slots, locale/controller hooks, URLs/navigation and timezone are injected. Trash CAS remains blocked by the pinned deletePost({id}) contract; no version argument was invented.
9. adm-publish-content:
   - packages/cms/src/react/publish-content/PublishContentDialog.tsx (new)
   - packages/cms/src/react/publish-content/PublishContentActions.tsx (new private split)
   - packages/cms/src/react/publish-content/PublishContentReport.tsx (new private split)
   - packages/cms/src/react/publish-content/hooks/publish-confirm-view.ts (new private view types)
   - packages/cms/src/react/publish-content/__tests__/y5-publish-ceremony.test.tsx (new)
   - packages/cms/package.json (dialog export/entry/isolation rows)
   - .changeset/y5-adm-publish-content.md
   Moves the dialog, peer picker, notices, report headers and action identity. The Dialog kit and confirmation hook are required; the product form-recipient notice is injected. The controller and its phase/criteria/arming/execution work remain unfinished. View tests are not represented as proof of ceremony safety.

## Per-Tovu-file status (relative to apps/admin/src)

Ready means the Jini implementation and entry exist for coordinator review; tests have NOT run. It does not mean the Tovu file meets G3 or may be counted yet. Unfinished rows below are not external blockers and are not claimed complete.

| Tovu file | Jini side | Exact remaining issue |
|---|---|---|
| components/AssistantDock/AssistantDock.state.hooks.ts | Unfinished | State composition/binder and first-turn characterization absent. |
| components/AssistantDock/AssistantDock.tsx | Unfinished | Dock entry, structural props and binder absent. |
| components/AssistantDock/DockChatPane.tsx | Unfinished | Pane projections/composition and bindDockChatPane absent. |
| components/AssistantDock/hooks/execution-config.hooks.ts | Ready (inherited) | No Jini gap identified; Tovu must use its single binding. |
| features/deployment/StaticSiteTab.tsx | Unfinished | Workflow view and its named split leaves absent. |
| features/deployment/hooks/use-publish-credentials.hooks.ts | Ready (new) | Coordinator verification and Tovu binding pending. |
| features/deployment/hooks/use-static-publish.hooks.ts | Ready (registered existing code) | Coordinator verification and Tovu binding pending. |
| features/media/Media.tsx | Unfinished | Legacy media screen and its named view splits absent. |
| features/media/hooks/use-edit-media-panel.hooks.ts | Ready (new) | Coordinator verification and Tovu binding pending. |
| features/media/hooks/use-media.hooks.ts | Ready (new) | Coordinator verification and Tovu binding pending. |
| features/pages/PageEditor.tsx | Unfinished | Editor chrome/notices/pane and view binder absent. |
| features/pages/PageEditorPreview.tsx | Ready (inherited) | Deletion still depends on moving the host editor. |
| features/pages/hooks/use-page-editor.hooks.ts | Unfinished | Hydration/workspace/save/preview/recovery controller and binder absent. |
| features/plugins/AgentPlugins.tsx | Unfinished | Composed screen, lists/overlays, update slot and binder absent. |
| features/plugins/Plugins.tsx | Unfinished | Composed screen, lists/overlays and binder absent. |
| features/posts/Posts.tsx | Ready (new) | Coordinator verification and Tovu binding pending; trash CAS contract is unchanged. |
| features/providers/Providers.tsx | Ready (registered existing code) | Coordinator verification and Tovu binding pending. |
| features/publish-content/PublishContentDialog.tsx | Ready (new view) | Live binding depends on the missing confirmation controller. |
| features/publish-content/hooks/use-publish-content-confirm.hooks.ts | Unfinished | Peer/plan/criteria/arming/execute controller and binder absent. |
| features/security/AccessTokensTab.hooks.tsx | Unfinished | Dialog hooks exist; merged-store ordering hook/types still absent. |
| features/security/AccessTokensTab.tsx | Unfinished | Live multi-store view/groups/fields/rows/dialogs and binder absent. |
| features/security/Security.tsx | Unfinished | Existing screen lacks bindSecurity and stable override-panel composition. |
| features/security/hooks/use-access-tokens.hooks.ts | Unfinished | Five-query live controller and binder absent; default-promotion mutations untested. |
| features/security/hooks/use-other-credentials.hooks.ts | Ready (new) | Coordinator verification and Tovu binding pending. |
| features/settings/ExternalMcpSettingsPanel.tsx | Unfinished | Panel sections/rows/OAuth/tools composition and binder absent. |
| features/settings/SettingsUi.tsx | Unfinished | Settings composition/tab builders and binder absent. |
| features/settings/hooks/use-external-mcp-admissions.hooks.ts | Ready (inherited) | Coordinator verification and Tovu binding pending. |
| features/settings/hooks/use-external-mcp.hooks.ts | Ready (inherited) | Coordinator verification and Tovu binding pending. |
| lib/settings-tabs.ts | Ready (inherited) | Coordinator verification and Tovu binding pending. |

Totals: 13 Jini-side counterparts implemented/registered, 16 unfinished. No Tovu deletions, bindings or counter completions claimed.

## Every new public export path

- @jini-ai/admin/posts/Posts — Posts, PostsProps, postsListNotice, bindPosts.
- @jini-ai/admin/screens/media/hooks/use-media.hooks — useMedia, MediaController, MediaDependencies, bindMedia.
- @jini-ai/admin/screens/media/hooks/use-edit-media-panel.hooks — useEditMediaPanel, EditMediaPanelController, EditMediaPanelHookProps, withDescriptionPatch, bindEditMediaPanel.
- @jini-ai/admin/screens/providers/Providers — existing Providers, ProvidersProps, bindProviders.
- @jini-ai/admin/security/host/hooks/use-other-credentials.hooks — useOtherCredentials, bindOtherCredentials and existing row/group/controller shapes.
- @jini-ai/devops/deploy/react/hooks/use-publish-credentials.hooks — usePublishCredentials, PublishCredentialsController, PublishCredentialRowState, bindPublishCredentials.
- @jini-ai/devops/deploy/react/hooks/use-static-publish.hooks — existing useStaticPublish, StaticPublishController, StaticPublishOptions, bindStaticPublish.
- @jini-ai/cms/react/publish-content/PublishContentDialog — PublishContentDialog, PublishContentDialogProps, bindPublishContentDialog.

All eight leaves are browser entries. Admin uses source exports. Devops/CMS use the nearest sibling's dist format. The CMS dialog copies PublishSectionButton's isolation entries/forbidden rows. Private splits have no package entries. Dependencies/peerDependencies/devDependencies are unchanged.

## Tests, mutations and validation limits

Seven tests added, none removed: y5-post-list 2 -> 4; y5-admin-surfaces 4 -> 6; y5-live-secrets 2 -> 3; new y5-publish-ceremony 0 -> 2. y5-static-site remains 5 tests; only the classifier fake's generic discriminator changed.

New cases: initial/action list notices; sorting and host URL construction; frozen-baseline metadata/description patching; exact deep-link editing plus one pending upload; partial credential-store failure/search counts and serial replace/remove; no-peer connect UI; single/multiple-peer target UI. Existing credential edit/verify/picker and stale-preview cases preceded their implementation/export changes.

Named mutations remain exactly as listed in the ordered units above. DROP_POST_EXPECTED_VERSION, ACCEPT_STALE_PREVIEW and EXTERNAL_MCP_LOST_UPDATE have inherited concrete payload/late-response assertions. DEFER_WITHDRAWAL_UNTIL_WRITE, RETIRE_NEWER_DRAFT and BODY_WRITE_BEFORE_CAS have inherited assertions. ADOPT_AFTER_DISPATCH, REMOVE_DEFAULT_WITHOUT_PROMOTION, REVOKE_UPSTREAM_ON_LOCAL_REMOVE and EXECUTE_BEFORE_CONFIRM still need the missing controller cases. No mutation was applied or executed.

No installs, builds, test suites, typechecks or lint commands ran. Source parsing/AST inspection and manifest inspection only: new logic-bearing function bodies are at most 50 lines; new files are below 500 lines; new imports have no unresolved relative source paths or added package edges. The existing CMS useMediaWrites body is 71 lines and was not refactored by its type-only edit. Runtime behavior and type compatibility remain for Opus to verify. The true counter was not run: /Users/la/Programming/Tovu/cloud-results/count-25/count-files-left.sh is absent, and no Tovu bindings were performed.

Architecture audit: WARNING because delivery and behavioral/mutation verification are incomplete. New production imports use React, core or their own package; all new cross-package/host collaborators are injected. No styles/themes/server files or .git state changed. Function review covered controllers, action splits, binders and render splits; the direct assertions above cover the new behavior seams, but no passing runtime evidence is claimed.

## Final pruning

Removed unused imports generated into the three publish-credential private splits and removed unused fields from their structural action parameters. No source files or tests were deleted. No new helpers beyond the named source operations and required view/split/bind seams are intentionally retained. Review the remaining implementation against the full sheet before calling any sheet done.
