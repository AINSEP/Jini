# X4 rest round 2 — Jini working-tree handoff

Status: PARTIAL / source delivery, unverified. No commits or pushes. The coordinator commits.

HEAD and `origin/codex/x4-allj` both resolve to `984a319b4adc3ea78ea148e6cb50e7ba5d875bd8` on `codex/x4g-restj`. The initial tree was clean. `.git` remains read-only. No subagents, installs, package intake, tests, mutation execution, builds, typechecks or linters ran.

Read the requested Programmer profile from `/Users/la/Programming/Tovu/AI-Dev-Shop/agents/programmer/skills.md`, its governing skill guidance and local `.claude/skills/honest-testing/SKILL.md`. The dispatch waives missing local AI-Dev-Shop and supplies the approved pattern. Its no-execution, no-new-comments, no-extra-refactoring and no-delegation instructions override the profile. The locked Jini entrypoint/extraction plan were read from the main Jini checkout. The referenced architecture chapters 13/14 were not given exact paths; `docs/architecture` does not exist in this clone or the main Jini checkout. No architecture was redesigned.

## Boundary checklist

- CMS only; all new public entries are universal, with `types`/`import`/`default`, `jini.entries`, and isolation classification. CMS has no `typesVersions` map.
- No runtime package dependency edges added. Host/member/theme/provider implementations are required callbacks, with structural types declared in the target files. No theme implementation or vendor adapter moved.
- No hooks, feature activation, wire bytes or concrete product identity changed.
- Named operations and existing private functions only; no new stage helpers or abstraction layers.
- Deferred reads stay at the original call stage. No added guards, fallback behavior, retries, configuration or default values beyond the existing function signatures.
- Source files are 47–207 lines. New/moved functions remain below the 80-line limit; branches/loops stay in their existing units.

## Logical commits, in design order

These are completed independent Jini portions, not completed Tovu MOVE files. Named characterization files were written/strengthened before their corresponding implementation edits. Tests and named mutations are unexecuted.

### X4-34

Authored reference keys, no empty-reference reads, one MIME batch after filtering, widest plain batch, first duplicate key, matching offset, visible-only metadata, missing numbered page and exact JSON projection.

Source files:

- `packages/cms/src/public-http/routes/site/pages/render-context/media-metadata.ts`
- `packages/cms/src/public-http/routes/site/pages/render-context/post-previews.ts`

Tests first:

- `packages/cms/src/public-http/routes/site/pages/render-context/__tests__/media-metadata.test.ts`
- `packages/cms/src/public-http/routes/site/pages/render-context/__tests__/post-previews.test.ts`

Named mutations: `key-metadata-by-resolved-id; page-before-visibility`.

Also touches `packages/cms/package.json` and `.changeset/x4-34.md` (minor).

### X4-35

Expansion, embeds/body, keys, menus, previews, collections, render, assets/head; pending empty HTML beats saved content through the selected-template pipeline.

Source files:

- `packages/cms/src/public-http/routes/site/pages/static-tier.ts`
- `packages/cms/src/public-http/routes/site/pages/template-render.ts`

Tests first:

- `packages/cms/src/public-http/routes/site/pages/__tests__/static-tier.test.ts`
- `packages/cms/src/public-http/routes/site/pages/__tests__/template-render.test.ts`

Named mutations: `assign-listing-keys-before-substitution; resolve-saved-html-instead-of-pending`.

Also touches `packages/cms/package.json` and `.changeset/x4-35.md` (minor).

### X4-36

Bare before theme, title before the generic read batch, time zone before render; virtual pending empty HTML, no preview access/extra head, empty generic listing.

Source files:

- `packages/cms/src/public-http/routes/site/pages/handlers/post.ts`
- `packages/cms/src/public-http/routes/site/pages/handlers/virtual-page.ts`

Tests first:

- `packages/cms/src/public-http/routes/site/pages/handlers/__tests__/post.test.ts`
- `packages/cms/src/public-http/routes/site/pages/handlers/__tests__/virtual-page.test.ts`

Named mutations: `theme-gate-before-bare; read-virtual-body-from-public-repo`.

Also touches `packages/cms/package.json` and `.changeset/x4-36.md` (minor).

### X4-37

Bare before presentation read; pending empty HTML, anonymous preview scope, render-only clone and unchanged saved row. Existing Youtube projector is already present and was skipped.

Source files:

- `packages/cms/src/admin-http/routes/posts/template-preview-render.ts`

Tests first:

- `packages/cms/src/admin-http/routes/posts/__tests__/template-preview-render.test.ts`

Named mutations: `fallback-to-saved-on-empty-pending-html`.

Also touches `packages/cms/package.json` and `.changeset/x4-37.md` (minor).

## Tovu binding contract

Six new exported CMS subpaths (all prefixed `@jini-ai/cms/`):

| Entry | Exported surface / required host binding |
| --- | --- |
| `public-http/routes/site/pages/render-context/media-metadata` | `resolveMediaTransformVersionsForRender({ deps })`, `resolveMediaAssetMetadataForRender({ deps, post }, optional)`, `resolveFeaturedImageForRender({ deps, post })`. Inject existing record/caption/transform readers, core transform name, cover collector and featured-image projection plus current repositories. |
| `public-http/routes/site/pages/render-context/post-previews` | `formatPostPreviewDate`, `resolvePostPreviewsForRender`, `KeyedPostPreviewBatch`, `PostPreviewsResult`. Reader receives `{ limit, offset }`; the host constructs its original `{ deps: { repo }, input: { workspaceId, limit, offset } }` inside the callback, so repo access stays before workspace access. Bind membership as the original `decidePostMemberAccess` callback, not an ID-only member helper. Bind media, terms, listing-state, date-zone, href, marker-policy and excerpt collaborators. |
| `public-http/routes/site/pages/static-tier` | `finishStaticTierDocument`, `missingStaticMenuIds`, `hasStaticThemeIndex`. Theme is closed over by required render/embed/menu callbacks. Bind `DEFAULT_THEME_SLOTS` and `staticThemeScripts`; preserve the optional document-assets function. No separate theme contract added. |
| `public-http/routes/site/pages/template-render` | `renderTemplateDocument`. Exactly 15 collaborators. Bind selection, diagnostic renderer/copy, expansion/title/current-ID, terms, nested resolution, embeds, body/static/cover rendering, href, assistant and comments. Pending doc override is a thunk returning the original spread object; call it at the original spread position after embed host/repository assembly. The comment `entry()` thunk must be invoked after provider/site-ID reads and before cursor reads. Bind nested resolver ports/depth/budget using their original expression. |
| `public-http/routes/site/pages/handlers/virtual-page` | `renderVirtualPage`. Exactly 13 collaborators, plus lazy `currentPath()`. `withListingBatch` performs the original assignment to the per-call host deps variable first; subsequent callbacks close over that variable. Pass the existing sentinel. Template arm uses in-memory pending HTML and no post-preview scope; generic arm receives `posts: []`. |
| `admin-http/routes/posts/template-preview-render` | `TemplatePreviewRenderError`, `PostPreviewRenderInput`, `PostPreviewRenderResult`, `renderPostPreview`. Bind existing branch renderers, theme selection, menus, member resolver, path and exact missing/off copy. The preview's bare renderer remains injected because its title read is parallel with its other reads; the public bare renderer intentionally serializes title first and cannot replace it. |

Existing `public-http/routes/site/pages/handlers/post` is extended with `renderBarePostPage` and `renderGenericPostPage`. Bind current repository/theme/comment scope inside their required callbacks. Existing template choice/branch exports are retained. Explicit `undefined` in existing render/assets option positions is represented in the structural contracts for Jini's exact-optional typing; no runtime defaults were introduced.

Keep all live/test Tovu importers on their designated bound paths except direct error-class repoints named by X4-37. No forwarding shell is needed.

## Every previously LEFT MOVE file

Paths below are exact Tovu paths. LOC is the unmodified sibling fix-pass source, not Jini LOC. **Available** means the specified Jini source/exports now exist for a binding cut; runtime/type readiness is unverified. **Partial/blocked** gets no keep entry. None of these Tovu files was edited, deleted or counted by this Jini-only job.

| Sheet | Tovu path | LOC | Jini side now available / still blocked |
| --- | --- | ---: | --- |
| X4-01 | `apps/desktop/src/desktop-memory-sampler.ts` | untouched | SKIP: desktop excluded; existing desktop-host entry is already present. No desktop source read or changed. |
| X4-11 | `apps/website/src/server/inbound/admin-http/owner-passkey-routes.ts` | 87 | BLOCKED G3: named site/action/status functions already exist. Residual passkeyDeps provider availability, failure writer and six-mount loop have no additional named Jini factory in this sheet; vendor adapter stays host. |
| X4-16 | `apps/website/src/server/inbound/admin-http/routes/external-mcp/oauth.ts` | 183 | BLOCKED G3: OAuth specs plus withinRateLimit/externalMcpErrorStatus already exist. Per-family short-circuit/gate order and failure writer have no named registrar contract. No new API invented. |
| X4-16 | `apps/website/src/server/inbound/admin-http/routes/external-mcp/probe.ts` | 79 | BLOCKED G3: probe spec/limiter helper already exist. Separate limiter/middleware gate remains; no named full registrar. |
| X4-18 | `apps/website/src/server/inbound/admin-http/routes/plugins/install.ts` | 56 | BLOCKED G3: four specs, readZipUpload/respondInstallFailure already exist. Transport-selection/mount loop and preview telemetry guard need an unnamed registrar. |
| X4-19 | `apps/website/src/server/inbound/admin-http/routes/publish-content/peer-transport.ts` | 148 | BLOCKED G3: knownPeerActionRefusal/PEER_ACTION_ERRORS and push specs already exist. openPeer and incident/writer orchestration have no full named factory. |
| X4-19 | `apps/website/src/server/inbound/admin-http/routes/publish-content/route-helpers.ts` | 50 | BLOCKED G3: overwrite parser/error contracts already exist. Authorization and typed-to-incident writer branch have no named replacement operation. |
| X4-20 | `apps/website/src/server/inbound/admin-http/routes/settings/events.ts` | 164 | BLOCKED G3: headers, admission/cache and stream operation already exist. Timer defaulting/preview scheduling/admission short-circuit have no named complete stream registrar. |
| X4-21 | `apps/website/src/server/inbound/admin-http/routes/system/publish-credentials.ts` | 85 | BLOCKED G3: list/JSON/heal and typed list refusal already exist. Sheet explicitly preserves direct Express admission (missing-principal rejection) and forbids a JSON mount spec; no named direct-handler factory absorbs its catch/writer. |
| X4-21 | `apps/website/src/server/inbound/admin-http/routes/system/publish-site.ts` | 215 | PARTIAL: WAL-13c adapter/publish-run now exist on HEAD; admin-publish-read exports also already exist. Target-registry/refusal iteration and startAdminPublish assembly have no additional named complete operation. Original missing-runtime claim is obsolete; strict G3 remains blocked. |
| X4-23 | `apps/website/src/server/inbound/admin-http/routes/system/site-imports.ts` | 206 | BLOCKED G3: importSiteBackup/readSiteImportOwner/completeSiteImportOwner already exist. Busy lane/deadline/socket and direct owner/origin/form gates remain; original sheet keeps transport host-side, with no named whole registrar. Vendor mapSqliteError stays host. |
| X4-24 | `apps/website/src/server/inbound/admin-http/routes/system/site-share-password.ts` | 54 | BLOCKED G3: owner gate/refusal writer already exist. No reveal-handler export named by the sheet absorbs createSiteSharePasswordHandler; no unnamed export added. |
| X4-25 | `apps/website/src/server/inbound/public-http/routes/members/oidc-callback.ts` | 100 | BLOCKED G3: protocol callback and deferred links/userAgent/ip reads already exist. Result-to-cookie/announcement projection has no named factory; protocol not duplicated. |
| X4-25 | `apps/website/src/server/inbound/public-http/routes/members/oidc-verify-email.ts` | 87 | BLOCKED G3: proof parser/protocol operation already exist. Projection and request-app guard still have no named operation. |
| X4-25 | `apps/website/src/server/inbound/public-http/routes/members/unlink-identity.ts` | 70 | BLOCKED G3: locked unlink/session replacement operation already exists. Request-app admission gate has no named factory; transaction remains untouched. |
| X4-27 | `apps/website/src/server/inbound/public-http/middleware/site-cookie-consent.ts` | 355 | BLOCKED: site/http, document-state and document-assets exist. site/http-mounts remains absent; prior >15-collaborator stop remains. No new API/grouping invented to hide collaborators. |
| X4-28 | `apps/website/src/server/inbound/public-http/middleware/site-serving-gate.ts` | 67 | BLOCKED G3: siteServingDecision already exists. Original sheet keeps Express next/503/error handling host-side; no named neutral middleware operation absorbs it. |
| X4-32 | `apps/website/src/server/inbound/public-http/routes/site/media-rendition.ts` | 99 | BLOCKED G3: both byte routes/evidence cache already exist. readEntitlement needs member context and an entry predicate; activeMemberFromSession returns only an ID. No named compatible scope factory in the design. |
| X4-33 | `apps/website/src/server/inbound/public-http/routes/site/pages/response.ts` | 131 | BLOCKED G3: CSP merge/visitor/finalizer helpers already exist. JSON content-type branch and final response/header writer have no named complete response operation. |
| X4-34 | `apps/website/src/server/inbound/public-http/routes/site/pages/render-context/media-metadata.ts` | 200 | AVAILABLE in source: all three named functions and universal entry added, with injected readers and authored-key/MIME witnesses. Host binding still to be applied. |
| X4-34 | `apps/website/src/server/inbound/public-http/routes/site/pages/render-context/post-previews.ts` | 193 | AVAILABLE in source: both functions, result/batch contracts and universal entry added. Bound visible-source/media/listing-state callbacks replace undeclared member/theme types. |
| X4-35 | `apps/website/src/server/inbound/public-http/routes/site/pages/static-tier.ts` | 202 | PARTIAL: named static pipeline/missing-menu/index predicates now available. serveStaticThemeIndex still has title/response/assistant orchestration; no named operation absorbs that whole residual, so do not count the complete file yet. |
| X4-35 | `apps/website/src/server/inbound/public-http/routes/site/pages/template-render.ts` | 242 | AVAILABLE in source: renderTemplateDocument entry added. Bind diagnostic copy/renderer and theme/widget ports at their current stages; pending spread and comment-entry thunks preserve deferred reads. |
| X4-36 | `apps/website/src/server/inbound/public-http/routes/site/pages/handlers/home.ts` | 181 | STOP: serveHomePage source spans lines 66–155 (90 physical lines) and its direct collaborator list exceeds 15: redirects, member resolver/context/filter, posts, theme-ID/theme/sentinel, assistant, root resolver/renderer, title/widgets/media/head/menus, static-index selection/renderer, generic renderer/assets/zone and final writer/policy. No named cut recipe permits splitting that unit. Independent post/virtual portions built. |
| X4-36 | `apps/website/src/server/inbound/public-http/routes/site/pages/handlers/post-not-found.ts` | 81 | BLOCKED G3: reply/classifier already exist. Catch/writer orchestration still requires a named error-handler factory; the two named exports already own their specified decision surfaces. |
| X4-36 | `apps/website/src/server/inbound/public-http/routes/site/pages/handlers/post.ts` | 143 | AVAILABLE in source: missing renderBarePostPage/renderGenericPostPage added. Existing branch/withPageShellChoice retained. Required ports keep public title-before-batch and late render effects. |
| X4-36 | `apps/website/src/server/inbound/public-http/routes/site/pages/handlers/slug-routes.ts` | 129 | STOP: nestedPageRoute already exists; full slug handler still exceeds 15 direct collaborators (redirects, scoped listing/request slug, member resolver/context/access/filter, theme/assistant, menus/policy, marketing/post lookup, template/generic render, missing/error/write callbacks). No named cut recipe authorizes extra stage helpers or grouped opaque adapters. No slugPageRoute stub added. |
| X4-36 | `apps/website/src/server/inbound/public-http/routes/site/pages/handlers/virtual-page.ts` | 90 | AVAILABLE in source: renderVirtualPage entry added with pending-body/empty-list witnesses, lazy path and original listing/theme/policy sequence. |
| X4-37 | `apps/website/src/server/inbound/admin-http/routes/posts/template-preview-render.ts` | 213 | PARTIAL: class/input/result/renderPostPreview now available; withPageShellChoice reused. The bare preview branch remains injected because its five-read parallel assembly differs from public bare rendering. No named neutral bare-preview assembly is authorized; full G3 still blocked until that contract is specified. |
| X4-38 | `apps/website/src/server/inbound/public-http/routes/site/member-pages.ts` | 190 | BLOCKED G3: makeMemberPagePost/memberPageRoute already exist. X4-36 virtual renderer is now available, but response/session/error branches still need a named registrar; catalog/markup remain host copy. |
| X4-42 | `apps/website/src/server/inbound/public-http/routes/site/products.ts` | 138 | BLOCKED G3: selectors/two route decisions/checkout entry already exist. Theme resolution and response/error projection have no named full page resolver/registrar. Point-lookup precedence untouched. |

## Held/skip scope and counters

Already-deleted and existing pure-binding files are skipped. Keep-only sheets X4-05/08/12/13/14/15/22/29/40/43 need no Jini changes. No new package intake or feature activation. No desktop or theme changes. K0 remains unbuilt: Appendix B and exact counter inputs were not supplied in this Jini dispatch. No keep ledger or reduction claim was manufactured. Tovu remains at its prior inventory until its coordinator actually binds/deletes and checks each file against G3.

## Review, test integrity and limitations

- Seven touched characterization files contain 12 cases, versus 1 case previously in those exact paths: +11, with zero cases removed/skipped. Existing post assertion strength is retained. `it.each` contributes two virtual-page cases.
- Mutations are recorded, not applied/run. No RED/GREEN, runtime, typecheck or coverage claim.
- API baselines cannot be measured here: they hash emitted `.d.ts` declarations, while builds are expressly prohibited. `api-baseline/jini-ai__cms.json` is unchanged; coordinator must build and refresh/inspect the six new subpaths plus the extended post surface. Existing first-pass entries are themselves absent from that baseline.
- Fresh `git diff --check` exits 0 for tracked changes. New-file whitespace review is recorded in final validation below. This is not runtime validation.
- Architecture audit: WARNING / PARTIAL. New runtime imports are within CMS or the declared core dependency; cross-domain readers/projectors that would drag host/node code into universal entries are injected. Exact-optional boundary types preserve explicit undefined in existing positions. No known intentional dependency or feature-boundary exception; host bindings/type/runtime evidence remain pending.
- Documentation: existing why-comments moved verbatim. No filler documentation added; the dispatch prohibits new source comments. Callback binding requirements are recorded here.
- Function-quality review: metadata readers and preview/static/listing private steps retain their existing loops/branches; template/post/virtual/preview entries each own one ordered orchestration. No algorithm, query bound, retry, timer or resource policy was added. Functions remain below the specified limits on source inspection; no metric tool/linter executed. Main risk is unverified host callback compatibility and deferred-read binding, not a claimed green build.
- Self-validation: NOT RUN, explicitly prohibited. Coordinator routing: compile/build emitted declarations, execute named Jini/Tovu witnesses and named mutations, then apply Tovu bindings and count only final G3-passing paths.

## Final diff cleanup / deletions

No files deleted. Removed transient eager callback destructuring during self-review; callbacks are accessed at their original operation stages. Removed accidental JSON Unicode escaping from the manifest rewrite. Replaced new direct cross-domain excerpt/default-slot value imports with required bindings. No unrelated source, config, hook, dependency, fallback or test scaffolding remains. Existing why-comments and assertions were retained.

## Required coordinator checks

1. Named characterization tests and seven named mutation changes above; none executed here.
2. CMS build/typecheck and actual Tovu bindings, especially optional values, scoped theme/member callbacks and lazy embed/comment reads.
3. Emit/refresh API baseline, inspect domain isolation and packed entry surfaces for six new universal subpaths.
4. Reclassify each complete Tovu file against G3; no entry in this report asserts deletion/count completion.

## Final validation and file inventory

Fresh tracked `git diff --check`: exit 0. New files checked individually with `git diff --no-index --check /dev/null <path>`: 15 files, zero whitespace diagnostics (ordinary no-index difference exit 1; no execution evidence). Removed trailing blank EOF lines found on the first new-file review. Final scope: 20 files total — 7 source files, 7 characterization files, package manifest, 4 per-sheet changesets and this uncommitted plan. No Tovu, desktop or theme files changed.

Function-quality source review (not a metric run):

| Units | Assessment | Remaining finding / next check |
| --- | --- | --- |
| Three media readers and existing traversal helpers | One resolution task each; original loops/lookup filtering retained | Unverified repo/caption/transform binding types; compile and run key/MIME witnesses |
| Preview listing resolver and existing paging/key/JSON helpers | Original batching/visibility/cursor semantics retained | 15 required deps; verify host source callback closes repo/workspace in original order |
| Static pipeline/private steps and named predicates | Same expand-to-assets sequence | Whole static-index response operation still blocked; do not count full host file |
| Selected-template render | One 15-collaborator orchestration, early diagnostic retained | Host must invoke pendingContentOverride()/entry() thunks at documented original positions |
| Bare/generic post renderers | Existing title/batch/zone/assets stages retained | Host renderer/theme/comment callback compatibility remains unverified |
| Virtual renderer | Existing listing/theme/policy/pending sequence retained | Bind per-call deps reassignment and lazy path; test both template/generic arms |
| Preview clone/body helpers and renderPostPreview | Same tri-state choice, draft/pending selection and error statuses | Distinct bare-preview assembly remains host/injected; no full G3 claim |

No tests were deleted, weakened, skipped or run. No runtime/typing/coverage claim. No baseline hashes or count reductions fabricated. Work remains entirely in the working tree.
