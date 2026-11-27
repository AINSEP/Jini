# Jini extraction commit plan

HEAD: `ca9a786c919018ac9feb09e26af634b5827ce407`. Tovu reference: `caa3ac7811f3ca15afb782ef0c4823f2d2cd5f8f`.
Working-tree changes only; coordinator commits. Tests are written before their production changes; no tests, builds, installs, type checks, linters, baseline generators, or mutations are run here.

1. **P01.J — Extract agent hold filtering (completed)**
   - Created `packages/cms/src/posts/__tests__/agent-hold.test.ts` first (3 cases).
   - Created `packages/cms/src/posts/agent-hold.ts`; only the post type import differs from Tovu.
   - Updated `packages/cms/package.json`: universal `@jini-ai/cms/posts/agent-hold`.
   - Mutation: `HOLD-AT-BOUNDARY` (`>` → `>=`) must fail the equality-row assertion.
   - Jini callers repointed: none. Deletions: none.
   - This entry also touches `COMMIT-PLAN.md`.

2. **AP01.J — Extract post cover controls and slug collision notice (completed)**
   - Created tests first: `packages/cms/src/react/posts/__tests__/PostCoverImage.test.tsx` (2 cases), `packages/cms/src/react/posts/__tests__/use-post-featured-image.test.tsx` (2), `packages/cms/src/react/posts/__tests__/PostEditorSlugCollisionWarning.test.tsx` (4).
   - Created `packages/cms/src/react/posts/PostCoverImage.tsx`, `packages/cms/src/react/posts/hooks/use-post-featured-image.hooks.ts`, and `packages/cms/src/react/posts/editor/notices/PostEditorSlugCollisionWarning.tsx`.
   - Updated `packages/cms/package.json` with the three direct browser subpaths, per-entry React isolation lists matching `./react/media`, and the `posts` domain path `src/react/posts`.
   - Mutations: `COVER-NO-ORIGINAL-FALLBACK` must fail the original-URL assertion; `COLLISION-DEFAULT-FALSE` must fail the null callback/round-trip assertions.
   - Jini callers repointed: none. No source files deleted. Excluded the host-only wired hook/imports from the portable copy; removed the stale “defaults to the real hook” phrase because the sheet requires an injected hook without a default.
   - This entry also touches `COMMIT-PLAN.md`.

3. **PG01.J — Extract scoped page HTML store contracts (completed)**
   - Created `packages/core/src/contracts/site/__tests__/page-html-store.typecheck.ts` first: conforming factory, nullable version consumer, and two negative type probes.
   - Created `packages/core/src/contracts/site/page-html-store.ts` with the four declarations and original scope/actor/CAS/factory why-comments; only `PostKind` is imported.
   - Updated `packages/core/package.json`: universal `@jini-ai/core/contracts/site/page-html-store`.
   - Mutation: `PAGE-SCOPE-WORKSPACE-OPTIONAL` must make the missing-workspace `@ts-expect-error` unused. The factory-without-version probe separately requires `capturedVersion`.
   - Jini callers repointed: none. Deletions: none. No store implementation, error, route, or runtime wiring changes.
   - This entry also touches `COMMIT-PLAN.md`.

4. **AG01.J — Extract external-change banner (completed)**
   - Created `packages/cms/src/react/pages/__tests__/PageExternalChangeBanner.test.tsx` first (1 case covering translation, three handles, and independent callbacks).
   - Created `packages/cms/src/react/pages/PageExternalChangeBanner.tsx` from the declaration and leading why-comment; injected the named markup/copy props.
   - Updated `packages/cms/package.json`: browser `@jini-ai/cms/react/pages/PageExternalChangeBanner`, matching per-entry React isolation list, and `pages` domain path `src/react/pages`.
   - Mutation: `EXTERNAL-CHANGE-SWAPPED-ACTIONS` must fail the Keep/Load callback assertions.
   - Jini callers repointed: none. Deletions: none.
   - This entry also touches `COMMIT-PLAN.md`.

5. **M01.J — Extract injected large-upload annotation (completed)**
   - Created `packages/cms/src/media/site/__tests__/large-upload-routing.test.ts` first (3 cases).
   - Created `packages/cms/src/media/site/large-upload-routing.ts` with object args, the upload-tool predicate, and unchanged filter/join/spread logic; kept only the general alternate-path rationale.
   - Updated `packages/cms/package.json`: universal `@jini-ai/cms/media/site/large-upload-routing`.
   - Mutation: `UPLOAD-ANNOTATE-EVERY-TOOL` must fail the other-registration identity assertion.
   - Jini callers repointed: none. No source files deleted. Excluded the host routing sentence, local tool id, cap import, and A212 host rationale from the portable copy, as required for M01.T ownership.
   - This entry also touches `COMMIT-PLAN.md`.

6. **M02.J — Extract post-publish media verification (completed)**
   - Created `packages/cms/src/media/site/__tests__/verify-published-media.test.ts` first (5 cases): scoped sniff/persist, failed repair/next item, inactive/no blob access, missing poster, batched-read rejection; minimal scoped store setup and the required fallback fake.
   - Created `packages/cms/src/media/site/verify-published-media.ts`, using the named relative CMS imports, `MediaPublishPorts`, and injected `VerifyFallback` at the two former catch sites. The batched read stays outside fallback.
   - Updated `packages/cms/package.json`: node `@jini-ai/cms/media/site/verify-published-media`.
   - Mutation: `VERIFY-SKIP-POSTER-REFS` must fail the exact missing-poster warning assertion.
   - Jini callers repointed: none. Deletions: no files; the copied host-port import and two catch sites were replaced exactly as specified.
   - This entry also touches `COMMIT-PLAN.md`.

## Review and cloud handoff

All six `.J` sheets completed in plan order; none stopped. The named source declarations, Tovu caller anchors, existing CMS collaborators, and empty Jini destinations matched. No `.T` work was performed. No subagents or codebase-memory tools were used; `.git` was not edited.

New test files contain 20 runtime cases (P01: 3; AP01: 8; AG01: 1; M01: 3; M02: 5), plus one typecheck file with two negative probes. Existing tests/configuration were not edited or deleted. No pass result or mutation result is claimed; cloud owns execution and the two API baseline refreshes. `PAGE-STALE-NOOP-ACCEPTED` belongs to the existing Tovu stale-save characterization, not a new Jini runtime test.

Final source-versus-reference and manifest diff review removed incidental manifest serialization formatting and an extra earlier-agent fixture row from the new P01 test, keeping its cases exactly within the sheet. No unrequested source additions remain; no source files were deleted. The omitted host-only code and stale default-hook phrase are recorded under their sheets above. No checks were run.

The `.T` sheets must consume these subpaths from the **new Jini artifact**:

| Sheet | New public import | Exports / host wiring |
| --- | --- | --- |
| P01.T | `@jini-ai/cms/posts/agent-hold` | `withoutHeldAgentSchedule`, type `AgentHoldReader`; repoint memory repo and SEO imports, drain host barrel |
| AP01.T | `@jini-ai/cms/react/posts/PostCoverImage` | `PostCoverImage`, types `PostCoverImageProps`, `PostCoverImageBindings`; supply `postCoverBindings` and real wired hook |
| AP01.T | `@jini-ai/cms/react/posts/hooks/use-post-featured-image.hooks` | `usePostFeaturedImage`, type `PostFeaturedImageController`; create the named host hook/bindings module |
| AP01.T | `@jini-ai/cms/react/posts/editor/notices/PostEditorSlugCollisionWarning` | `PostEditorSlugCollisionWarning`; supply markup, tri-state mappers, seven copy strings |
| PG01.T | `@jini-ai/core/contracts/site/page-html-store` | types `PluginEmbedDiagnostic`, `PagesHtmlDocumentStoreScope`, `PagesHtmlDocumentStorePort`, `PagesHtmlDocumentStoreFactory`; split only named type imports/re-exports |
| AG01.T | `@jini-ai/cms/react/pages/PageExternalChangeBanner` | `PageExternalChangeBanner`; create host copy/markup bindings for both mounts |
| M01.T | `@jini-ai/cms/media/site/large-upload-routing` | `withLargeUploadRouting`; supply unchanged host `LARGE_UPLOAD_ROUTING` through object args |
| M02.T | `@jini-ai/cms/media/site/verify-published-media` | `verifyPublishedMedia`; pass existing core `orFallback` and CMS media slice |

Cloud must run the seven runtime suites, the typecheck probes, all seven named Jini mutations, repository/packaging/isolation checks, and regenerate `api-baseline/jini-ai__cms.json` and `api-baseline/jini-ai__core.json` before accepting the Tovu cutover.

## OPUS-CLOUD left untouched

All 49 marked rows remain left; this job grants no permission to move them. Paths below are relative to their stated Tovu feature directory.

- `apps/website/src/features/post/`: `agent-tools.ts`, `content-stats-tool.ts`, `contracts.ts`, `post-create.ts`, `post-retire.ts`, `post-tool-delete.ts`, `post-tool-deps.ts`, `post-tool-duplicate.ts`, `post-tool-policy.ts`, `post-trash.ts`, `post-update.ts`, `preview-tool.ts`, `publish-content.ts`, `repo.memory.ts`, `repo.ts`, `reverters.ts`, `tool-registrations.ts`.
- `apps/admin/src/features/posts/`: `editor/header/PostEditorActions.tsx`.
- `apps/website/src/features/pages/`: `agent-tools.ts`, `html-document-store.memory.ts`, `html-document-store.ts`, `permissions.ts`, `tool-registrations.ts`.
- `apps/website/src/features/trash/`: `adapters/comment.ts`, `adapters/media.ts`, `adapters/member.ts`, `adapters/post.ts`, `adapters/redirect.ts`, `adapters/user.ts`, `agent-delete-policy.ts`, `db-port.ts`, `index.ts`, `move-to-trash.ts`, `permissions.ts`, `registry.ts`, `repo.sqlite.ts`, `tool-kinds.ts`, `tool-registrations.ts`, `trash-item-tool.ts`.
- `apps/website/src/features/media/`: `library-save-attachment.ts`, `media-provider-credential-repo.ts`, `promote-chat-attachment.ts`, `provider-credential-store.memory.ts`, `provider-credential-store.ts`, `provider-credential-vault.ts`, `publish-content.ts`, `read-chat-attachment.ts`, `tool-registrations.ts`, `view-video-tool.ts`.

All other NOT-PLANNED and STAYS-HOST rows remain untouched as well.
