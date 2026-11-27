# m26 CMS guard — coordinator handoff

Status: PARTIAL. Source edits are in the working tree. No commit, push, install,
build, guard, test, typecheck, or linter was run. No subagents were used.
The initial working tree was clean. Scripts, guard configuration, allowlists,
baselines, dependency declarations, and themes were not changed.

## Logical commits prepared, in order

1. Neutralize the listed consumer references and inject the post-read tool name.
2. Declare the six constant risk catalogs and settled-change-set set readonly.
3. Break the six reported runtime cycles using type-only back-edges, injected
   functions, and the existing selection/completion/OAuth functions in leaf files.
4. Remove the listed runtime domain/Node/React edges with host injection or
   existing shared leaves; relocate report-row markup to its publish owner;
   separate transport/handshake error classes from their Node implementations.
5. Move the three standing-draft data contracts verbatim into core and repoint
   UI/CMS imports. Keep the existing panel-kit public barrel's type exports.

Some files contain hunks for more than one logical commit. The inventory below
assigns each path once for navigation; split shared files by hunk when committing.
These are proposed coordinator commits, not commits created by this run.

## Rows addressed in source (not verified by guard execution)

- R5: post tool guidance receives `contentPostReadToolId` from the host.
- N1/N2: all five listed source references replaced with neutral wording.
- L1/L3/L5: fetch-query uses the existing core `FetchQueryAdapter`; standing-draft
  types now belong to core; the recovery-message callback is stated structurally.
- SI-domain: the listed cross-domain runtime imports are injected, type-only, or
  pointed at existing shared leaves. Media hashing receives the real `createHash`.
  Rendering/form/routing functions and React primitives are required inputs.
  Publish error classification imports leaf classes instead of Node services.
- HW3: all seven listed constant collections have explicit readonly types.
- R14: OAuth, post handlers, post retirement, and publish confirmation cycles have
  their runtime back-edges removed. Moved behavior and why-comments were retained.

## Stopped / rows left — NEEDS-OPUS

All three rows on `packages/cms/src/react/pages/page-editor-rules.ts` remain:
`L1-layer-edge`, `L3-undeclared-edge`, `L5-injected-edge` for
`@jini-ai/ui/html-editor`.

The only import is the `CanvasStyling` type. Its definition includes UI-owned
`AdminTheme`/`ColorScheme`. Moving the complete contract into core requires moving
those theme types too, conflicting with "themes untouched". Preserving the exact
host styling type through a generic requires a generic the dispatch forbids.
No broad object/unknown replacement, copied theme schema, or dependency addition
was substituted. Resolve that contract/constraint conflict before this group.
No R13 freshness work was performed.

## Tests and named mutation

No test cases or named mutations were supplied with these guard rows. None were
invented. Existing test imports/fixtures were wired to the new required inputs;
no test declaration was added, removed, skipped, or weakened. The blob-bindings
call expectation now includes the required digest matcher. All runtime validation
and mutation verification are pending coordinator execution.

## Required host wiring

- Post tools: supply `contentPostReadToolId` and
  `copyBodyJsonWithFreshEmbedPlacements`; email storage also receives the real
  `PageConcurrentEditError` constructor.
- Media upload/replacement/rendition/import/tool deps: supply real `createHash`.
  Blob-write bindings receive `bytesMatchSha256`. Media contributor binding also
  receives `createRepoPublishHandler` and `sha256` (`isValidSha256Hex`,
  `bytesMatchSha256`). Existing caps and binding functions remain required.
- Form/content-type/taxonomy contributors: inject `createRepoPublishHandler` and
  `gatewayDeps`; content types additionally need `okOrThrow`.
- Collection entries: inject the factory, `gatewayDeps`, `okOrThrow`,
  `applyRunActor`, `collectBodyReferences`, term-sync functions/permission and the
  three taxonomy error constructors named in its required argument.
- Widget policies: inject the factory, gateway/actor functions and the four entry
  error constructors named in the policy.
- Post/page contributor arguments now receive the factory, `TERM_SYNC_PERMISSION`,
  `withTermIds`, `collectBodyReferences`, `gatewayDeps`, `prepareTermSync`,
  `readTermIds`, `contentHash`, and `applyRunActor`. Post repo ports stay unchanged.
  `packedStateOf` additionally receives `readTermIds` and `withTermIds`.
- Menu contributor arguments receive the factory, `applyRunActor`, and the real
  Node `updateMenuTree` adapter. Menu repo ports stay unchanged.
- Publish tool deps receive `buildPublishContentImportHooks`,
  `PublishContentBundleNotFoundError`, `connectDestination`,
  `disconnectDestination`, and `PublishTrustConnectError`.
- Standalone media/grid/write/preview hooks receive the React functions named in
  their required arguments. Widget-picker deps receive `useQueryFetchCallback`,
  `useEffect`, `useId`, `useRef`, `useState` (add-control needs `useState`).
  Media-content editor inputs/hooks receive `useEffect`, `useMemo`, `useRef`,
  `useState`; its deps receive `acceptedMediaItems`.
- `RenderSiteRequired` receives `siteHeader`, `siteFooter`, and the three existing
  `EMPTY_*` map constants. `sendPublicPage.ports` receives `injectFormAttemptTokens`.
  Nested page routing receives `checkSiteRelativeTarget`.

## Public paths changed

- New core: `@jini-ai/core/contracts/standing-draft` (three existing data types).
- New CMS: `@jini-ai/cms/core/days-remaining`,
  `@jini-ai/cms/admin-http/routes/external-mcp/provider-refusal`,
  `@jini-ai/cms/publish/content/peer-transport-error`,
  `@jini-ai/cms/publish/trust/handshake-error`.
- Replaced `@jini-ai/cms/react/publish-content/PublishContentDialog.hooks` with
  `@jini-ai/cms/publish/content/ui/PublishContentReportRow`; old source deleted.
- Moved error classes/types are no longer exported by `peer-transport` or
  `handshake-client`; repoint host imports to the new error leaves.
- `daysRemaining` / `externalMcpProviderRefusal` are now exported from their new
  leaves, without forwarding exports at the original owners.

## Final diff review deletions

Removed the old report-row source/export after its move; original definitions of
moved leaf functions/classes/contracts; obsolete imports, including unused risk-map
aliases. No test or supported branch was deleted. During review, removed unwanted
whole-hook/factory spreading and kept `planScope` with its original caller.

## Complete file inventory by logical commit

### 1

- `packages/cms/src/html/site/safe-url.ts`
- `packages/cms/src/posts/post-tool-deps.ts`
- `packages/cms/src/posts/post-tool-update.ts`
- `packages/cms/src/posts/tool-registrations.update.ts`
- `packages/cms/src/react/publish-content/PublishContentDialog.tsx`
- `packages/cms/src/react/publish-content/hooks/use-publish-content-confirm.hooks.ts`

### 2

- `packages/cms/src/content-duplication/tool-registrations.ts`
- `packages/cms/src/fs-files/tool-registrations.ts`
- `packages/cms/src/posts/post-tool-policy.ts`
- `packages/cms/src/posts/preview-tool.ts`
- `packages/cms/src/posts/sql/revision-refs.ts`
- `packages/cms/src/site-inspection/tool-registrations.ts`
- `packages/cms/src/trash/permanent/tool-registrations.ts`

### 3

- `packages/cms/src/admin-http/routes/external-mcp/__tests__/oauth.test.ts`
- `packages/cms/src/admin-http/routes/external-mcp/oauth.ts`
- `packages/cms/src/admin-http/routes/external-mcp/provider-refusal.ts` (new)
- `packages/cms/src/admin-http/routes/external-mcp/route-helpers.ts`
- `packages/cms/src/posts/tool-registrations.handlers.ts`
- `packages/cms/src/posts/tool-registrations.ts`
- `packages/cms/src/react/publish-content/hooks/publish-completion.rules.ts` (new)
- `packages/cms/src/react/publish-content/hooks/publish-confirm-view.ts`
- `packages/cms/src/react/publish-content/hooks/publish-execution.hooks.ts`
- `packages/cms/src/react/publish-content/hooks/publish-lifecycle.hooks.ts`
- `packages/cms/src/react/publish-content/hooks/publish-plan.hooks.ts`
- `packages/cms/src/react/publish-content/hooks/publish-selection.rules.ts` (new)

### 4

- `packages/cms/package.json`
- `packages/cms/src/admin-http/http/trash.ts`
- `packages/cms/src/admin-http/routes/media/grid.ts`
- `packages/cms/src/admin-http/routes/publish-content/__tests__/peer-transport.routes.pins.test.ts`
- `packages/cms/src/admin-http/routes/publish-content/peer-transport.ts`
- `packages/cms/src/content-types/site/__tests__/publish-content.test.ts`
- `packages/cms/src/content-types/site/publish-content.ts`
- `packages/cms/src/core/days-remaining.ts` (new)
- `packages/cms/src/entries/site/__tests__/publish-content.test.ts`
- `packages/cms/src/entries/site/publish-content.ts`
- `packages/cms/src/forms/site/__tests__/publish-content.test.ts`
- `packages/cms/src/forms/site/publish-content.ts`
- `packages/cms/src/media/__tests__/blob-gc-journal.test.ts`
- `packages/cms/src/media/__tests__/blob-gc.test.ts`
- `packages/cms/src/media/__tests__/convert-video-tool.test.ts`
- `packages/cms/src/media/__tests__/created-by.test.ts`
- `packages/cms/src/media/__tests__/document-read-w2g.unit.test.ts`
- `packages/cms/src/media/__tests__/documents.test.ts`
- `packages/cms/src/media/__tests__/list-provenance.unit.test.ts`
- `packages/cms/src/media/__tests__/media-service.test.ts`
- `packages/cms/src/media/__tests__/original-response.test.ts`
- `packages/cms/src/media/__tests__/rendition-service.test.ts`
- `packages/cms/src/media/__tests__/replace-media-file.test.ts`
- `packages/cms/src/media/__tests__/tool-registrations.test.ts`
- `packages/cms/src/media/__tests__/unit/document-read-paging.unit.test.ts`
- `packages/cms/src/media/__tests__/unit/document-text.unit.test.ts`
- `packages/cms/src/media/__tests__/video-codec.test.ts`
- `packages/cms/src/media/__tests__/video-transcode.test.ts`
- `packages/cms/src/media/__tests__/video-upload-cap.test.ts`
- `packages/cms/src/media/media-service.ts`
- `packages/cms/src/media/rendition-service.ts`
- `packages/cms/src/media/replace-media-file.ts`
- `packages/cms/src/media/site-generation/tool-registrations.ts`
- `packages/cms/src/media/site-import/bindings.deps.ts`
- `packages/cms/src/media/site/__tests__/blob-write-bindings.test.ts`
- `packages/cms/src/media/site/__tests__/duplicate-asset.cap.test.ts`
- `packages/cms/src/media/site/__tests__/import-media-entity.test.ts`
- `packages/cms/src/media/site/__tests__/import-video-conversion.test.ts`
- `packages/cms/src/media/site/__tests__/publish-content.test.ts`
- `packages/cms/src/media/site/__tests__/view-video-tool.test.ts`
- `packages/cms/src/media/site/blob-write-bindings.ts`
- `packages/cms/src/media/site/duplicate-asset.ts`
- `packages/cms/src/media/site/import-media-entity.ts`
- `packages/cms/src/media/site/library-save-attachment.ts`
- `packages/cms/src/media/site/publish-content.ts`
- `packages/cms/src/media/tool-registrations.ts`
- `packages/cms/src/navigation/site/__tests__/publish-content.test.ts`
- `packages/cms/src/navigation/site/publish-content.ts`
- `packages/cms/src/pages/html-inverse.ts`
- `packages/cms/src/posts/__tests__/email-template-store.sql.test.ts`
- `packages/cms/src/posts/email-template-store.ts`
- `packages/cms/src/posts/post-tool-duplicate.ts`
- `packages/cms/src/posts/post-tool-list.ts`
- `packages/cms/src/posts/publish-content.retire.ts`
- `packages/cms/src/posts/publish-content.ts`
- `packages/cms/src/posts/repo.memory.ts`
- `packages/cms/src/public-http/http/site/__tests__/render.golden.characterization.test.ts`
- `packages/cms/src/public-http/http/site/render-site.ts`
- `packages/cms/src/public-http/routes/site/media-rendition.ts`
- `packages/cms/src/public-http/routes/site/pages/__tests__/response.test.ts`
- `packages/cms/src/public-http/routes/site/pages/handlers/__tests__/slug-routes.test.ts`
- `packages/cms/src/public-http/routes/site/pages/handlers/slug-routes.ts`
- `packages/cms/src/public-http/routes/site/pages/response.ts`
- `packages/cms/src/publish/content/__tests__/peer-transport.host-seam.test.ts`
- `packages/cms/src/publish/content/__tests__/peer-transport.l061.test.ts`
- `packages/cms/src/publish/content/__tests__/tool-registrations.test.ts`
- `packages/cms/src/publish/content/peer-transport-error.ts` (new)
- `packages/cms/src/publish/content/peer-transport.ts`
- `packages/cms/src/publish/content/tool-registrations.ts`
- `packages/cms/src/publish/content/ui/PublishContentReportRow.tsx` (new)
- `packages/cms/src/publish/trust/__tests__/handshake-client.test.ts`
- `packages/cms/src/publish/trust/handshake-client.ts`
- `packages/cms/src/publish/trust/handshake-error.ts` (new)
- `packages/cms/src/react/media/__tests__/media-grid-cursor.unit.test.tsx`
- `packages/cms/src/react/media/hooks/use-grid-pages.hooks.ts`
- `packages/cms/src/react/media/hooks/use-media-writes.hooks.ts`
- `packages/cms/src/react/media/use-media-provider-catalog.hooks.ts`
- `packages/cms/src/react/pages/__tests__/PageEditor.preview-youtube.unit.test.tsx`
- `packages/cms/src/react/pages/hooks/use-preview-embed-ids.hooks.ts`
- `packages/cms/src/react/publish-content/PublishContentDialog.hooks.tsx` (deleted after move)
- `packages/cms/src/react/publish-content/PublishContentReport.tsx`
- `packages/cms/src/react/widgets/WidgetConfigFields/MediaContentEditor.hooks.ts`
- `packages/cms/src/react/widgets/WidgetConfigFields/MediaContentEditor.tsx`
- `packages/cms/src/react/widgets/WidgetConfigFields/__tests__/MediaContentEditor.markup.unit.test.tsx`
- `packages/cms/src/react/widgets/WidgetPickerDialog/WidgetPickerDialog.hooks.tsx`
- `packages/cms/src/react/widgets/WidgetPickerDialog/__tests__/WidgetPickerDialog.hooks.unit.test.tsx`
- `packages/cms/src/taxonomy/site/__tests__/publish-content.test.ts`
- `packages/cms/src/taxonomy/site/publish-content.ts`
- `packages/cms/src/widgets/site/__tests__/publish-content.test.ts`
- `packages/cms/src/widgets/site/publish-content.ts`

### 5

- `packages/cms/src/react/posts/editor/notices/PostEditorNotices.tsx`
- `packages/cms/src/react/posts/post-editor-rules.ts`
- `packages/core/package.json`
- `packages/core/src/contracts/standing-draft.ts` (new)
- `packages/ui/src/features/panel-kit/helpers/__tests__/standing-draft-local-backup.unit.test.ts`
- `packages/ui/src/features/panel-kit/helpers/standing-draft-local-backup.ts`
- `packages/ui/src/features/panel-kit/helpers/standing-draft-recovery-message.ts`
- `packages/ui/src/features/panel-kit/hooks/__tests__/use-standing-draft-autosave.hooks.test.tsx`
- `packages/ui/src/features/panel-kit/hooks/use-standing-draft-autosave.hooks.ts`
- `packages/ui/src/features/panel-kit/hooks/use-standing-draft-recovery.hooks.ts`
- `packages/ui/src/features/panel-kit/hooks/use-standing-draft-state.hooks.ts`
- `packages/ui/src/features/panel-kit/hooks/use-standing-draft-writes.hooks.ts`
- `packages/ui/src/features/panel-kit/index.ts`
