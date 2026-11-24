# `@jini-ai/cms`

Content-model capability for Jini-hosted products.

The source tree includes content domains and Node adapters. CMS depends on shared kernel
contracts and has no user-management dependency. Generic tool wiring is exported by
`@jini-ai/core`; hosts provide CMS authorization and active-principal lookup ports.
See [API integration](API-INTEGRATION.md) for current signatures and migration examples, and
[integration-report.md](integration-report.md) for pending protected work and deferred verification.

## Forms email sender

`@jini-ai/cms/forms/email-sender`: `createFormsEmailSender({ deps })`, `FormsEmailSenderDeps`, `FormEmailAction`, `FormEmailActionInput`.
Install the optional peer `@jini-ai/platform@^0.6.15` when using this sender; that release includes
`@jini-ai/platform/mail/senders`. The `@jini-ai/cms/forms` entry loads without platform installed.
Tokens use stable field ids, never labels; built-in collisions use `field.<id>`.
Built-ins: `site_name`, canonical `site_url`, and ISO `submitted_at`; templates/hosts own formatting.
Files, hidden fields, IPs, credentials, undeclared keys, defaults and owner recipients are excluded.
Only Email fields may supply recipients; choices export option values and booleans use "true"/"false".
Configuration writes only through the injected guarded settings writer; no delivery effects occur here.

## Layers

| subpath | runtime | contents |
|---|---|---|
| `.` / `./core` | universal | Content contracts and types, ports, pure domain services, kernel registries. No Express, no `node:*`, no DOM. |
| `./media` | node | Media services, transform ports and preview policies; versioned media repository and source-conditional rendition guard. |
| `./media/cover-image` | universal | Read-only cover selection and iterative body projection with injected media metadata. |
| `./media/node` | node | Filesystem blob stores, sharp image transforms and ffmpeg adapters. |
| `./settings` | universal | One-release compatibility re-export of `@jini-ai/core/settings`. |
| `./presentation/html` | universal | Document detection, off-site link attributes and head/body markup insertion. |
| `./presentation/page-head` | universal | Page-head folding and serialization. |
| `./forms/result-query` | universal | Form submission result query encoding, decoding and clearing. |
| `./forms/result-flash` | universal | Form flash cookie encoding, decoding and result merging. |
| `./themes/preview/refresh` | node | Preview-path validation, refresh requests, reads and feeds. |
| `./widgets` / `./widgets/markers` / `./widgets/resolvers` | universal | Widget contracts, markers and resolution services; no HTML parser. |
| `./widgets/html` | node | HTML scanning/substitution, fragment validation, plugin-export template resolution, page-body sanitizing and media Raw HTML resolution (diagnostics through an injected `report`). |
| `./html/style-values` | universal | CSS-value allowlists for author strings a renderer writes into a `style` attribute (`safeTextAlign`, `safeAspectRatio`). |

Hosts that sanitize SVG uploads or ingest documents through `./media` must install the optional peers
`dompurify` and `jsdom`. They load lazily: without them, other media still works, but SVG and Office uploads fail.
The optional `jsdom` peer accepts `^25.0.1 || ^26.0.0 || ^27.0.0`; media uses the shared JSDOM window, DOMParser, XMLSerializer, basic DOM queries and close APIs.

Node-bound domain adapters depend on `/core`. The reverse is a boundary violation — if a core module wants
something from a Node adapter, the dependency is backwards and the fix is a port (interface) in core,
not a widened export.

Domain HTTP adapters live under their domain subpaths. Hosts can compose them
using `@jini-ai/http-kit` and `@jini-ai/server`.
Identity tool registration composition belongs to `@jini-ai/user-management/server`.

Generic settings now belong to `@jini-ai/core/settings`; `@jini-ai/cms/settings`
remains a neutral compatibility entry. The former `./settings/express` entry has been removed.

`@jini-ai/http-kit/settings` exports `registerSettingsRoutes` and the settings HTTP
contracts. `@jini-ai/core/settings` exports the service/change-feed factories. Hosts provide route paths,
permissions, workspace, readiness, principal resolution, authorization, scheduler,
service and feed ports. Registration returns a disposer that closes active feeds.
CMS adapters pass named request objects to settings dispatch and change-feed services;
queryable index-name helpers return promises that callers must await.
Install `express` in the host when using `@jini-ai/http-kit/settings`.
The HTTP toolkit is a host composition choice and is not a CMS dependency.
Readiness or principal-resolution failures return `401 UNAUTHENTICATED`.
Stream diagnostics are best-effort: a throwing reporter cannot prevent retries,
cancellation of other schedules or ending the response.

Plugin embeds resolve only through the node entry: hosts pass their site-scoped admission port as
`ResolveHtmlPageEmbedsDeps.pluginExports` to `resolveHtmlPageEmbeds` from `@jini-ai/cms/widgets/html`,
which fills templates with parse5. The universal registry never resolves plugins. A missing port or a
refused export keeps the authored fallback HTML. See the [host adoption note](docs/plugin-export-host-adoption.md).

## Why the split exists before there is any code to split

The source of this port is an existing CMS runtime, and the boundary is drawn where a measured defect was.

There, the content model and its HTTP composition root share one `src/` tree with nothing
enforcing a boundary between them. Measured 2026-08-02:

- **53 import edges point into the composition root.** 22 of them are domain modules importing a
  454-line `RouteDeps` type whose first line is `import type { Express } from "express"`.
- **Git history shows the cost:** no content module could be changed without also changing the
  server. `features/theme` and `server` co-changed in 71% of commits touching the former;
  `identity` and `server` in 45%.
- **33 of 38 modules formed a single strongly-connected component** — none could be extracted
  without dragging the other 32.

The decomposition itself was sound (propagation cost 11%, a textbook Martin instability gradient,
domain modules that essentially never co-change with each other). What was missing was
*enforcement*. Full analysis: `ADS-memory/reports/refactors/2026-08-02-module-graph-analysis.md`
in the originating repo.

A package's `exports` map is precisely the enforcement a single `src/` tree cannot provide. A
consumer of `@jini-ai/cms/core` physically cannot reach a Node adapter, and `/core` physically
cannot import a transport type, because the module resolver refuses. Porting into this shape from
the first commit means that failure mode cannot recur here.

`@jini-ai/cms/seo/content-analysis` (universal, pure): `analyzeContent` scores title + content blocks (checks, readability, TOC with a host-supplied `slugify`) and `summarizeReport` renders the report as one English paragraph.

## Port inventory

The kernel went first — the source repo's `src/core/{ports,commands,events,tools}` — because every
domain module depends on it. Domain modules followed in no particular order: the source repo's git
history shows they essentially never co-change with each other, so each ports independently without
coordination.

**Landed** (directories under `src/`, each with its own subpath export):
`core`, `content-types`, `entries`, `media`, `navigation`, `presentation`, `settings`,
`taxonomy`, `workspace`, and `trash`. `settings` is now a compatibility shim, with implementation
in `@jini-ai/core/settings`. `./core/tools` re-exports the shared core permission helpers; `./media/import` exports bounded image fetching with injected policies and ports.

`./navigation` stays universal: submitted menu HTML requires an injected `normalizeMenuHtml`
dependency (`normalizeHtml` for `mergeMenuHtml`). Item-only writes and retained markup need no
parser. Node hosts use `./navigation/node`, which re-exports the navigation API and supplies
parse5 normalization to create/update, merge and tool registration. The existing validation,
raw-HTML permission checks, OCC and outbox owners remain unchanged; an unconfigured universal
HTML write fails before saving rather than persisting markup that could escape its theme container.

`./workspace/sql` (node) is the Kysely adapter for `WorkspaceRepoPort`: the host passes its storage
kernel and its own `workspaces` table name; the adapter has no table or product defaults.

`./taxonomy/sql` (node) is the Kysely adapter for the taxonomy ports (`SqlTaxonomyRepo`, `SqlTermRepo`,
`SqlEntryTermRepo`, `SqlTaxonomyRevisionRepo`): the host passes its storage kernel, the names of its four
taxonomy tables and the workspace each repository is scoped to; the adapter has no table or product defaults.
The universal `./taxonomy` entry carries the read-port types (`TaxonomyPublishReadPort`, `TermPublishReadPort`,
`AssignedTermView`, `EntryTermReadPort`) those repositories also satisfy.

`./navigation/sql` (node) is the Kysely adapter for `MenuRepoPort` and `NavLocationBindingRepoPort`
(`SqlMenuRepo`, `SqlNavLocationBindingRepo`): the host passes its storage kernel and the names of its menus and
location-binding tables; the adapter has no table or product defaults.

`./presentation/sql` (node) is the Kysely adapter for `PresentationSettingsRepoPort` (`SqlPresentationSettingsRepo`): the host
passes its storage kernel and the name of its presentation-settings table; the adapter has no table or product defaults.

`./content-types/sql` (node) is the Kysely adapter for `ContentTypeRepoPort` and `ContentTypeListPort`
(`SqlContentTypeRepo`): the host passes its storage kernel, the names of its content-type and revision tables, and the
declared envelope owners of the code-registered types as data; the adapter has no table or owner defaults.

`./entries/sql` (node) is the Kysely adapter for `EntryRepoPort`, `EntryListPort`, `EntryDisplayListPort`,
`EntryListExcludingTypesPort` and `EntryPublishReadPort` (`SqlEntryRepo`): the host passes its storage kernel, the names of
its entry and revision tables, the two JSON dialect helpers (`EntryJsonDialectPort`, from the same kernel) and an
`onWriteSettled` hook the repository calls after every save and transaction, success or failure.

`./entries` also exports `TrashAwareInMemoryEntryRepo`, the in-memory twin of that repository (the Trash hidden from every read, the
`findAny*` / `saveAny` / `hardDelete` seam); its required `onWriteSettled` hook is called after a save, a transaction (also on
failure), a `saveAny` and a `hardDelete` that removed a row.

`./trash` also exports the registry types (`TrashEntry`, `TrashRegistry`, `TrashMarkerSpec` and the specs they hold) and
`trashEntityLockKey`, the one lock key a Trash transition takes for an entity. `./trash/sql` (node) is the Kysely adapter for
`TrashRepoPort` (`SqlTrashRepo`: the host passes its storage kernel and the name of its `trashed_items` table) with the
registry-driven query kit a host's table adapter is built from: `notTrashed` (a `WHERE` condition) and `isTrashedRecord`
(its flat-record twin), `readLiveSnapshot`, `entryWhere` and `loose`. `createTableTrashAdapter` is the one `TrashAdapter` for every registry entry: the host
passes the entry, its storage kernel (read on first use) and the name of its `trashed_items` table.

**Still to move:** `post`, `seo`, `comments`, `redirects`, `newsletter`,
`members`. Widgets are exposed through the universal and node entries above.
The nested forms package is maintained by its separate owner and is excluded from this parent package.

**Explicitly not ported:**

- `src/server/**` — Express composition root; superseded by `@jini-ai/http-kit` / `@jini-ai/server`.
- Admin UI — `@jini-ai/admin` already owns that surface.

When porting tests, `git mv` them rather than re-authoring: re-authoring costs a full pass and
still loses coverage.

## Wiring

The admin route specs under `src/admin-http/routes/` (redirects, recovery, …) are server-neutral
`defineJsonRoute` specs, each with its own small deps type (e.g. `RecoveryDeepLinkRouteDeps`). A host
mounts one with `mountJsonRoute({ app, spec, deps })` from `@jini-ai/http-kit`, passing explicit deps
and its `authorize` port. Redirect by-id routes (get, hits, update, tombstone) authorize with
`{ entityId }`; list and import stay id-free. Tests inject typed fakes through those same deps.

Menus (`src/admin-http/routes/menus/*`; serializers in `src/admin-http/http/menus.ts`, the wire DTO
declarations in `@jini-ai/core/contracts/site/cms-menus` so an admin client shares them): get-by-id,
update-tree, assign-location and delete authorize `admin.menus.*` with `{ entityId }`; list and
create stay id-free. The host injects what is its policy, not the engine's: `rawHtmlPermission`
(the extra permission a write carrying HTML needs; update-tree asks it as a SEPARATE `authorize`
call from `admin.menus.update`, and without `entityId` when the parsed id is empty, so a host may
answer the two from different sources), `normalizeMenuHtml` (a Node host binds
`normalizeMenuHtml` from `@jini-ai/cms/navigation/node`) and `trashMenu` (the host's trash move).
Malformed bodies are refused in `parse` with the host's code-less `{ error }` body.

Browser telemetry (`src/admin-http/routes/system/browser-telemetry.ts`, `POST /api/admin/v1/telemetry`,
deployment-level, no permission): the host mounts `browserTelemetryRoute` with
`readHeaders: ["content-length"]` and injects `tracker` (`capture`/`error`), `limiter` (its own
per-principal budget, `check({ key })`) and `credentialKind({ context })` (the session layer's kind for
the authenticated principal; only `"session"` is admitted). Every gate runs in `handle`, in the order
403 credential → 413 declared length → 429 `Retry-After` → 400/413 validation → bodiless 204.

Newsletter (`src/admin-http/routes/newsletter/*`, types in `src/admin-http/http/newsletter.ts`): the
newsletter domain has no engine code yet, so every spec takes the host's services as required deps
(`saveCampaign`, `scheduleCampaign`, `openSendPipeline`, `saveList`, `importSubscriptions`, …), plus
three base fields from `NewsletterRouteBaseDeps`: `workspaceId`, `newsletterReady` (awaited after the
permission check) and `mapNewsletterError`, the host's error-class → `{ status, body }` table
(`NewsletterErrorMapper`); an unmapped error is rethrown to the host's 500 port. Routes authorize
`admin.newsletter.*` on `newsletter_campaign|newsletter_list|newsletter_subscription` without an
`entityId`, as the hand-written routes did.

Content lane (L1). `src/admin-http/http/plugin-hook-error.ts`: `createPluginHookErrorEnvelope` binds the
`PLUGIN_HOOK_FAILED` 500 envelope to the host's hook-failure class, refusal copy, redaction and log
sink; a spec calls the bound `rejectPluginHookFailure({ err })` first in its catch. Change sets
(`routes/change-sets/*`) call cms's own `revertChangeSet` and take the host's DTO mappers and revert
registry; get and revert authorize `changeset.*` with `{ entityId }`. The item mapper is cms's own
`./admin-http/http/change-sets` (`toChangeSetItemResponse({ item })`, `revertible` instead of the inverse
payload); the host injects it as `toChangeSetItem` and its own header view as `toChangeSetHeader`. Email templates
(`routes/email-templates/*`) take the template operations, their error predicates and the raw-HTML
edit permission (`editHtmlPermission`) as deps; a host keeps its own body-size binding in front of
the capped writes when its 413 copy differs from the kit's. Pages (`routes/pages/{list,get-by-id}`),
posts autosave (`routes/posts/autosave`: read + clear), presentation (`routes/presentation/{get,
rescan-themes}`) and themes (`routes/themes/{list,duplicate}` and the `explore-*` specs) take the
host's lookups, DTO mappers, not-found predicates and theme registry reads as functions. Write routes
that read an `Idempotency-Key` header are not specs yet: a spec's input carries body, query and params only.
Presentation PATCH (`routes/presentation/patch`) takes the host's active-theme write (`setActiveTheme`, bound
to its repo, tracker, clock and write allowlist), its styling-required predicate, theme discovery, the read
catalogue, the preview-refresh signal and the response DTO; one ladder over the whole request answers a validation
or styling error as a flat 400 and a missing row as a flat 404, and rethrows the rest to the host's
operation-only failure copy.

Site previews (`src/admin-http/routes/sites/site-previews.ts`: `sitePreviewRoute`, raw, `bufferedReply`): the host
injects `sitePreviews.read` (the stored capture bytes for a site name) and `previewContentType`, and mounts it
with `mountAdminRawRoute` (guarded, `failure` operation `routes/sites/site-previews`). `sitePreviewTargets` and
`servingAddressOf` are exported for the host's site list and theme preview.

Site backups (`src/admin-http/routes/system/site-backups.ts`: `siteBackupPlanRoute`, `siteBackupPushRoute`, raw
specs with `bufferedReply`): the host injects `plan`/`push` (its backup service; `push` bound with
`PUSH_POLL_WAIT_MS`), `isPublishTrusted({ context })` (a publishing credential answers `403 Forbidden` text),
`mapBackupError` (the service's known errors as `{ status, body }`, `undefined` for the mount's redacted 500), and
mounts them with its own plain-text workspace refusal; the no-store / nosniff headers come from the specs.

Site shares (`src/admin-http/routes/system/site-shares.ts`: list, create, static options/create, acknowledge,
revoke, artifact upload/delete; raw specs with `bufferedReply` and `Cache-Control: no-store`): the host injects
`backend()` (read per request; `undefined` answers 503), `isPublishTrusted({ context })` (a connected computer is
refused on admin operations and authorized with `publish_content.apply` on artifacts), `readCreateInput` /
`readStaticInput` (its body parsers and refusals), `isArtifactIdentity`, `invalidArtifact`, `receiveArtifact`,
`removeArtifact`, `maxArchiveBytes`, and `failureReply({ error, step, method, path, authenticated })` (its refusal
copy and incident reporting; a `SiteShareUploadRefusal` carries the deferred body read's refusal). It mounts them
with the step's own workspace refusal and a deferred missing principal; the streamed ZIP download stays host-side.

Shared Keys picker (`src/admin-http/routes/system/credential-copy.ts`: `credentialCopyListRoute`,
`credentialCopyGrantRoute`, w4-routes K): the host injects `ownerPrincipalId()` (the seeded owner),
`admitInstance({ principalId, permission })` (its optional instance admission; `true` when it has none),
`projectKeys()` (`listChoices`/`permissionFor`/`use`, or `undefined`) and `isLocalRequest({ context })` (whether this
request came from a browser on the host machine). It mounts both with `Cache-Control: no-store` on every answer, a
session-credential-only 403 ahead of the workspace 404, and its redacted `copy-failed` 500; the specs answer
owner-only, RBAC (`system.write`, then the selected key's own permission), local-host-only, 400 and the 409.

System mail (`src/admin-http/routes/system/mail-{status,dns,test-send,activity}.ts`, guards in
`mail-shared.ts`): the host binds every collaborator as a required function-typed dep — the live
mailer predicate and cached status, the DNS operations, the recipient rules and plan-then-run send,
the platform activity/suppression operations with a `classifyMailActivityError` mapper — plus the
permission names. The test send's local duplicate/rate guard answers 429 with the same `{ sent, result }` body.
Mail providers (`src/admin-http/routes/system/mail-providers.ts`: list, credential plan, activate) map the host's
classified failures through `mailProviderRefusal`, which the host's hand-written credential save shares, so both
answer from one status table.

Sites (`src/admin-http/routes/sites/sites-home.ts`: `sitesConfigReadRoute`, `sitesHomeSetRoute` and the
folder rules; `src/admin-http/routes/system/sites.ts`: `siteTokenSignInPluginsRoute`, `siteCreateRoute`,
`siteActivateRoute`): the host injects the deployment gate, its sites workspace, a `SitesDirectoryProbe`
(filesystem inspection) and the site-admin collaborators. Gates answer before authorization; folder and
name refusals after it; feature refusals map by code to status.

Saved credentials (`src/admin-http/routes/system/{source-control-credentials,custom-credentials}.ts`,
`publish-credentials/*`, shared ladder in `credential-routes-shared.ts`): the host injects the credential
store as functions and its error classes as `storeErrors`; the spec owns the status/code ladder
(`ToolInputError` → 409 `KEY_IN_USE` first, unmapped rethrown for the host 500). It also injects the
project-key attach, `prepareInvalidation`, the after-save probe, the account-label heal trigger and, for
custom keys, `credentialKindOf(principal)`, `ownerPrincipalId()` and the Shared Keys copy. The publish list
and custom list/update specs are tested but not yet mounted by Tovu (see its INFO.md).

System deploy (`src/admin-http/routes/system/{deployment-overview,export-site}.ts`,
`publish-site/{status,preview,targets}.ts`): every process-state read is an injected function —
`buildSnapshot` and `defaultOwnerPassword` for the overview, `getRunSnapshot`/`startRun` (the host's single
process-local export slot) for export, `getRunSnapshot`/`previewPublish`/`listTargets` for publish. The export
trigger answers 202, refuses a second trigger with 409 `{ error, run }` and validates its body in `handle`
(after auth and the running check) to keep the original order. Overview/export mount `direct`, publish `guarded`.

Settings (`src/admin-http/routes/settings/{get-raw,get-effective,list-definitions,set,clear,reset,register-definitions}.ts`,
`shared.ts`, `protected-namespaces.ts`): each body runs through `runSettingsRoute` in the order readiness
(`settingsReady`), principal, protected-namespace write fence, body; each route's domain-error ladder is a
`SettingsErrorRung` table and unmapped errors are rethrown to the host 500. The host injects a
`settingsService` factory, `writeServiceDeps`, `resolveReadTarget` + `crossPrincipalReadPermission` and a
`writeFence` (protected/code-owned namespaces with their copy); `touchesProtectedNamespaces` resolves names,
renames, aliases and resets.
Assistant owner grants (`src/admin-http/routes/system/assistant-owner-grant.ts` `createOwnerGrantRoutes({ path, policy })`
→ `{ get, put }` specs, policies in `assistant-{permanent-deletes,subagents}.ts`) run through the same
`runSettingsRoute`; the host injects the owner id, clock, setting writer, readiness and the per-grant policy
(read projection, validation, acknowledgment rule, tool list).

SEO (`src/admin-http/routes/seo/*`): get-entry, get-entry-analyze and put-entry authorize
`admin.seo.manage` on `seo-entry` with `{ entityId }`; get/put-settings (`seo-settings`) and
sitemap regenerate (`seo-sitemap`) stay id-free. Every spec first awaits the injected `seoReady`.
The host injects its settings ledger (`readSeoSettings`, `writeSeoSettings`), the sitemap service,
`invalidateSitemapCache` and `entryAuthorize` (the authorizer `setEntrySeoOverrides` re-checks with).
The entry specs import `seo/cover-image`, so their entries are `node`.

Media (`src/admin-http/routes/media/*`, DTO in `src/admin-http/http/media.ts`): update, trash and
delete authorize `media.*` with `{ entityId }`; get/put providers stay id-free. The host injects the
single-asset DTO lookups (recorded content type, public URL, byte size), its transactional trash flip
(`removeMedia`), the reference-checked `purgeMedia` + `forgetRemovedMedia`, and the provider
credential store with its save-error table (`saveErrorMappings`). Delete's 409 carries the
`referencing` list. `update` imports the node-only media service, so its entry is `node`. `./admin-http/routes/media/byte-size`'s
`resolveMediaByteSizes({ deps: { workspaceId, assetBlobRepo, blobStore }, media })` is the byte-size
lookup a host binds into those DTO lookups (one blob-row batch, at most eight `sizeOf` stats in flight).

Assistant (`src/admin-http/routes/assistant/*`): settings, visitor tools and the site/execution
credentials share `shared.ts`; the execution probes (detect-agents, list-models, test-agent,
test-connection) share `execution-shared.ts`. The host injects its permission name
(`managePermission`/`manageAssistantPermission`), the settings ledger, the sealed credential stores,
the visitor-tools service, each route's ordered error table (`errorMappings`, host classes and copy)
and every probe that touches the agent runtime, a subprocess or the network (`detectAgents`,
`testAgent`, `listModels`, `testConnection`, `resolveProbeCredential`). Body checks run in `handle`
after authorization, keeping the routes' 403-before-400 order. No spec echoes a credential.

Public OAuth callbacks (`src/public-http/routes/{api-connections,external-mcp}/oauth-callback.ts`) are
HTML, not JSON, so they are core `ServerRoute` factories (`apiConnectionOAuthCallbackRoute(deps)`,
`externalMcpOAuthCallbackRoute(deps)`), not `defineJsonRoute` specs. They read the host's request facts
(`readRequestFacts`: client address for the limiter key, serving protocol, parsed query) from `locals`,
so mount them through an adapter that puts the facts there. The host injects the page renderer with
its copy (`renderPage`, typed `OAuthCallbackPageRenderer` from `@jini-ai/core/contracts/site/oauth-callback-page`,
which also owns the closed `OAuthCallbackFailureReason` vocabulary), the `postMessage` type, the
binding-cookie reader/clearer, the error-class predicates (`isApiConnectionError`, `isOAuthError`,
`isUnknownServerError`), its API-connection runtime / external-MCP OAuth service, the roster fan-out,
its public-origin policy and its logger. The external-MCP callback path and URL builder
(`externalMcpOAuthCallbackUrl({ origin, serverId })`) live in `oauth-callback-url.ts`, shared with the
host's connect route.

External MCP admin (`src/admin-http/routes/external-mcp/*`): list, put, delete, admissions, tool-approvals and
OAuth disconnect authorize `admin.integrations.manage` on `integration` with no `entityId` (the hand-written
guard's rule). The host injects its server store, roster fan-out, built-in ownership rules and its error
classes as predicates; the PUT body parser (`put-body.ts`) runs after authorization, as before.

Agent plugins admin (`src/admin-http/routes/agent-plugins/{list,files,set-enabled}`, DTO helper in
`src/admin-http/http/agent-plugins.ts`): set-enabled authorizes with `{ entityId }` on `agent-plugin`; the id-free
checks pass `entityType: ""`. The host injects its plugin catalog, activation service, MCP provisioning,
package-file reader, error-class predicates and its activation-conflict copy. The hosted sign-in hop
(`connection-sign-in.ts`, a 302 + binding cookie) is a `ServerRoute` factory: the host injects its path, its
session-credential readers, the handoff store, the cookie rule and its failure page.
Memory (`src/admin-http/routes/agent-plugins/memory`, GET/PUT): authorizes `admin.plugins.read`/`enable` with
no entity type or id; the host injects the installed check, the plugin's memory store (`openMemory`), the
store's caps and, for PUT, its system-error predicate (a matching note-write error is rethrown for the host's
own 500 copy; any other write failure is the 422).
Admin surfaces (`src/admin-http/routes/agent-plugins/admin-surfaces`, `defineAdminSurfaceRoutes<S, O>()`: GET
`…/:pluginId/surfaces`, POST `…/:surfaceId/bootstrap` and `…/:surfaceId/actions`): the list asks
`admin.plugins.read`, the writes `admin.plugins.enable` (no entity type or id), then the surface 404, then (actions)
the 400 for a missing action name. `@jini-ai/agent-plugins` depends on this package, so the host injects
`listSurfaces`/`findSurface`, `surfaceFileUrl`, `bootstrapData`, `createBootstrap`, `bootstrapHeaders`, `nowMs`,
`dispatcherFor` (the package dispatcher over its handlers, with its handler-error sink) and `withSignIns`. The
writes' CSRF gate is `adminSurfaceWritePreflight({ refusal })`, a header-only check the host mounts ahead of its
credential and workspace gates; the refusal copy is the host's.
Install/update upload (`src/admin-http/routes/agent-plugins/install`, POST `install/zip` and
`:pluginId/update/zip`, raw spec with `bufferedReply`): asks `admin.plugins.enable` with no entity type or id
before any input check, then the update target, digest, body and `replace`. The zip is read through
`raw.readBody({ type: "raw", mediaType: "application/zip", limit })` — mount it with NO body parser ahead of it.
The host injects `maxArchiveBytes`, the plugin-name grammar (`isPluginName`), its installer (`installUpload`),
its read-model row (`installedRow`), its body-refusal and known-installer-error copy (`bodyRefusal`,
`installRefusal`; `undefined` rethrows for the mount's redacted 500).
Media where-used (`src/admin-http/routes/media/where-used`): asks `media.read` on `media` with no entity id; the
host injects its usage finder (`findWhereUsed`) and answers the denial with its own body (mount `forbidden`).
Media import-url (`src/admin-http/routes/media/import-url`, POST, 201): asks `media.upload` on `media` with no
entity id, then checks the body (so a denied caller learns nothing about it). The host injects its guarded
fetch (`fetchImage`), upload pipeline (`uploadMedia`), recorded-type store (`recordContentType`), public-URL
resolver and `egressRefusalMessage` (its transport refusal's caller-safe text; the host logs the private
diagnosis). Ladder: egress refusal 400, import/upload validation 400 (own message), anything else rethrown for
the host's 500. The host answers the denial with its own body (mount `forbidden`).
Media text (`src/admin-http/routes/media/text`, GET): asks `media.read` on `media` + the asset id, then checks the
`offset` (decimal digits only), then pages through the host's `readText`; extraction refusal 400 with its code,
not-found 404, validation 400, anything else rethrown. Every answer carries `MEDIA_TEXT_RESPONSE_HEADERS`
(`private, no-store`, `nosniff`) as the spec's static `responseHeaders`; the host answers the denial (`forbidden`).
Media replace (`src/admin-http/routes/media/replace`, POST): asks `media.update` on the asset, then 404/409 trashed/503
(repo lacks `replaceFileIfVersion`/`saveRenditionIfSource`) before the body; the body is strict base64 under the
host's `maxUploadBytes` with an allowed sniffed type. The host injects `replaceFile` (`null` = version moved, 409)
and `describeStored`. Media upload (`src/admin-http/routes/media/upload`, POST, 201): the body is checked in `parse`
(so its 400s precede the session; the host mount defers a missing principal), then `media.upload` on `media` with
no id; the host injects `storeUpload`, `recordContentType` (media kind only), `onUploaded` and `describeStored`.
Ladder: slug conflict 409, validation 400, anything else rethrown. replace/upload import node-only media code (`node`).

Recovery and database ceremonies (`src/admin-http/routes/recovery/{status,restore}`,
`src/admin-http/routes/database/migrate-forward`): status takes the cost-class probe, site status,
the operation-lock peek and `resolveDegradedBanner` as deps. The restore and migrate-forward
plan/confirm/execute specs own the body checks, the AUD-001 order (execute pre-authorizes through
the injected instance-scoped check before reading the body or taking the lock) and the
error → status tables; the host injects each gateway/orchestrator step, the database package's
refusal classes, and `missingPrincipalMessage` (its own missing-session diagnosis). Bodies are
validated in `handle`, after the principal, because the hand-written routes did so.

Publish-content (`src/admin-http/routes/publish-content/{peers,destination}`, guards in
`transport-shared`, report DTOs in `src/admin-http/http/publish-content.ts`): the host injects the
peer store, connected-peer lookup, deploy-config candidate, publishable types, connect/disconnect
handshake and its typed error classes; the specs own the status/code tables and the
credential-free views. Routes that read the request's credential kind or publish-trust grant
(import, backstop, bundle-create, export, capabilities, peer-transport) and the byte/stream
routes stay host-side until the host ports carry that context.
Publish-content bundle staging (`src/admin-http/routes/publish-content/bundle-create`, w3 C3b): the
host injects the bundle repo/clock/id generator, the registered handlers' `schemaVersions`, the
request's `publishTrust` grant (read through the spec's `context`), `isBackstopEntityType` /
`backstopGrantAllows`, `readBackstopMetadata` and `backstopAuditReady`; it spreads `requestFacts: true`
on at the mount (the manual-send `Host` check) and keeps its own body-cap binding (its 413 body).
The spec owns `validateBundleBody`, the door-check order and their refusal bodies.
Publish-content capabilities (`src/admin-http/routes/publish-content/capabilities`, w3 C3c): the host
injects its registered `handlers()` (read per request), the request's `publishTrust` grant (grant-only,
read through the spec's `context`) and `isBackstopEntityType` / `backstopGrantAllows`; the spec owns
the `publish_content.apply` check, the grant intersection and the `features` list.
Publish-content import (`src/admin-http/routes/publish-content/import`, w3 C3c: plan/confirm/execute/run
status): the host injects the gated-mutation calls (`planImport`, `confirmImport`, `authorizeExecute`,
`executeImport`, `runStatus`), the raw-values check and preview, the backstop audit port, the credential
kind reader and `importRefusal` (its typed error classes and copy); the specs own the body refusals,
`readOverwriteEntityKeys`, the API-key overwrite 403, the raw-values 403 and the execute pre-check's 403.
Publish-content send by hand (`src/admin-http/routes/publish-content/backstop`, w3 C3d: status, run detail,
plan/send, gaps, undo): the host injects `mayUseBackstop` (its owner/admin-role rule) with the 403 copy, `readyAudit`,
`findPeer`, `checkRequest`, `redeemPlan`, `planSelection` (pack, push, audited `planned` log), `openUndo` (the
one-transaction undo) and `backstopRefusal` (its typed errors); the session-only gate is the host mount's. The specs
own every refusal, which `planned` log `send` may redeem, the `publish_content.read` check and the answer shapes.

Plugins (`src/admin-http/routes/plugins/*`): cms does not depend on `@jini-ai/plugins`; the host
injects discovery, the activation lookup, `toAdminPluginResponse`, the uninstall move, the preview
filter, the hook-failure envelope and the error classes each ladder maps.
`set-enabled` runs the cms `executeCommand` gateway with a host-injected raw `authorizeCommand` (the
gateway names the `plugin-activation` entity itself and its `ForbiddenError` maps to 403 `FORBIDDEN`
with `details`); the host binds the plugin engine's `setPluginEnabled`, tool-access lowering, approval
recording, tracker and serializer, and the eight `setEnabledErrors` classes.
`provider-settings` (GET card / PUT save) takes the host's discovery, `declaredFields`, the provider
config store, its save rule `saveProviderSettings` (pre-bound to live reapply), the project key store,
`providerAppliesAt`, the legacy-credential check and the tracker — absent ones as explicit `undefined`
(no store answers 503). `project-key-use` takes `ownerPrincipalId`, the host's `ownerOnlyMessage` and
the project key store; its session-only rule is the host mount's gate, not the spec's.

Posts and pages create/update/delete (`src/admin-http/routes/{posts,pages}/{create,update,delete}.ts`, shared
plumbing in `routes/posts/shared.ts`) run each write through the command gateway (`executeCommand`, which
authorizes `content.write` itself — the mount's `authorize` port is never consulted) and read
`Idempotency-Key` from `raw.headers` (mount with `readHeaders: ["idempotency-key"]`; an empty value is
absent). The host injects the gateway collaborators (`commandDeps`), its post services (`createEntry`,
`updateEntry`, `trashEntry`, `restoreEntry`, `findEntry`, `updateInverse`, `findPostId`), the serializer
(`toAdminPostResponse`), the outbox drain (`drainOutbox`), its error tests (`postErrors`), the bound
`rejectPluginHookFailure` and, for pages, `pageNotFound`.

Publish-trust handshake (`./public-http/routes/publish-trust/handshake`): `publishTrustIdentityRoute`,
`publishTrustChallengeRoute` and `publishTrustSessionRoute` are unauthenticated public specs with
`requestFacts: true` (the rate-limit key is `raw.facts.clientAddress`; `/identity`'s origin is
`raw.facts.protocol` + `raw.facts.host`). Each handler answers every failure itself: the host's
`logFailure({ method, path, error })` logs it and the host's `copy.failed` is the 500 body. The host
injects `installationId()` (its derived id, `null` when keyless, resolved once per registration), the
refusal `copy`, one shared `limiter` (core `RateLimiter.check`), and the trust decisions `issueChallenge`,
`findGrant`, `isGrantActive`, `verifyResponse` and `mintSession`; the spec owns their order and the
fixed 401/429/503 answers.

Public member routes (`./public-http/routes/members/*`, w3 C5): raw (web `Response`) specs in the structural
`PublicMemberRawRoute` shape `@jini-ai/http-kit`'s raw mount takes, so this package never imports the server
toolkit. `memberSignOutRoute` reads only the `cookie` header and gets every policy from its deps: the host's
session-cookie reader (`readSessionToken`), the clearing `Set-Cookie` value (`clearedSessionCookie`), the token
hash, the session repository, the clock, and `refusalFor` (the host's credential error classes and copy; an
unmapped error is rethrown for the host's redacted 500). The host runs its member POST gates (same-origin policy,
post-parse body cap) at the mount, ahead of the spec.

The JSON public member specs (w3 C5b): `memberResetPasswordRoute`, `memberSetPasswordRoute`,
`memberForgotPasswordRoute`, `memberMeRoute`, `memberLoginProvidersRoute`. Each validates its string-only body
(`memberStringBody`) and opts into what it reads: `requestFacts` for the client address that keys the IP limiter
(`memberRequestLimitReply`: IP first, then email/identity counters, a 429 with `Retry-After` and `details`),
`readHeaders: ["cookie"]` for the session, `responseHeaders` for `no-store` / `no-referrer`. Injected per route:
the host's shared limiters (`attemptLimiter`, `ipLimiter`, `emailLimiter`, `perMemberLimiter`), its members
service calls (`resetPassword`, `setPassword`, `prepareReset`, `requireSessionMemberId`, `resolveMemberId`,
`findMember`, `toPublicMember`, `listPublicIdentities`, `listProviders`), its detached delivery owner
(`deliverInBackground`), its cookie reader (`readSessionToken`) and `refusalFor`.

- **publish-content peer pull** (`admin-http/routes/publish-content/peer-transport`): `peerPullRoute` (`POST .../peers/:peerId/pull`, 201) asks `publish_content.apply` and runs the injected `pullAndStage({peerId, principalId})` (the host opens the peer credential and stages the export); a host typed error maps through the injected `peerActionRefusal`, anything else is rethrown for the mount's redacted 500. The push relay routes stay host-side.
- **publish-content export + blob channel** (`admin-http/routes/publish-content/{export,blob-get,blob-put}`, w4-routes): `exportRoute` is a structural raw route (`PublishContentRawRoute`, the shape the host's raw admin mount takes) that streams the bundle envelope; the host injects `workspaceRepo.findById` (the `sourceLabel`), `isPublishingCredential({ context })` (its publishing-grant lookup; a grant is refused with the `publish_trust_export_not_wired` 403 before the read gate) and `packEntities({ principalId })` (its registry walk with the per-type permission gate). A pack failure after the head is sent ends the body unclosed. `blobGetRoute`/`blobPutRoute` are `defineJsonRoute` specs: the host injects `mediaRepo`/`assetBlobRepo` (the document-only check, answered as a `Cache-Control: private, no-store` 404 via `routeReply`) and `blobSource({})` (its blob store with its file-blob fallback) for GET, and `blobStore.putIfAbsent` for PUT. All three ask `publish_content.read`/`.apply` with no entity type; the blob routes refuse a malformed `:sha` in `parse`, so their mounts must defer a missing session.

## Scripts

```bash
pnpm --filter @jini-ai/cms build
pnpm --filter @jini-ai/cms typecheck
pnpm --filter @jini-ai/cms test
```

## Open cleanup

- **Add coverage thresholds.** `vitest.config.ts` still has none. That was a deliberate omission
  while the package was a placeholder; it no longer is, so the reason has expired. Set them against
  what the ported modules actually measure — siblings run 98–100%.

## Design decisions

- [Schema indexes use closed fragments and unambiguous identities](docs/decisions/DR-001-safe-schema-and-index-transitions.md).
- [Content lifecycle separates new authoring from existing-entry writes](docs/decisions/DR-002-content-lifecycle-and-cleanup.md).
- [Settings preserve total defaults, scope fences and revision evidence](docs/decisions/DR-003-settings-ledger-invariants.md).
- [Blob collection rechecks references before journaled unlink](docs/decisions/DR-004-journaled-blob-gc.md).
- [Taxonomy validation preserves first-failure order and full cycle checks](docs/decisions/DR-005-ordered-taxonomy-validation.md).
- [Mutation, audit record and outbox intent share a commit boundary](docs/decisions/DR-006-mutation-audit-atomicity.md).
- [Workspace administration preserves tenancy and ownership floors](docs/decisions/DR-007-workspace-and-owner-floors.md).
- [Navigation mutations enqueue one event only on success](docs/decisions/DR-008-navigation-event-intent.md).

The `./trash` surface owns snapshot-only listing, keyset cursors, atomic marker/index writes,
transactional follow-ups and the retention sweeper. Hosts inject their table adapters, reentrant
transaction runner, `IdGenerator`, entity policy, `Clock` and scheduler. Native timer `unref` and
error logging belong to the host. Actor/prior-marker/list filters are passed in the optional second
object. Purge callers own human confirmation and must authorize each resolved index row; unavailable
domains remain `adapter-unavailable` after authorization even when their entity policy denies them.

## Wiring

`./public-http/middleware/{canonical-site-host,theme-content-security-headers,theme-asset-dirs,theme-static-assets}` (w4-routes)
are the server-neutral decisions behind the host's public Express middleware; the host keeps the `app.use` adapters and
`express.static`. `canonical-site-host`: `isCanonicalSiteHostCandidate({ method, path, originalUrl })` (sync) and
`canonicalSiteHostRedirectLocation({ host, originalUrl, origin, toAbsoluteUrl })` (the 308 target or `undefined`); the
host resolves `origin` with this package's `./seo` lookup, injects its `toAbsoluteUrl`, and passes `Host` only. `theme-content-security-headers`:
`themeAssetSecurityHeaderSet({ path })`, written in order before the static server runs. `theme-asset-dirs`:
`resolveThemeDirs({ roots, themeId, themeIdCandidates, resolvePathWithin }, {})` takes the host's theme-id alias table and
`@jini-ai/platform/fs`'s `resolvePathWithin` (this package does not depend on platform). `theme-static-assets`:
`trustedPreviewRevision` (takes the host's `isAuthenticatedPreviewRevision`), `isRewritableCssPath`, `previewCss`,
`inheritedTemplateSource` (reads `{ dir, inheritedTemplateSources }` structurally from the host's discovered themes).
`./public-http/middleware/theme-page-preview` (w4-routes) answers the theme Explore preview routes with a neutral
`{ status, headers, type, body }` the host writes in order. `staticThemePagePreview` / `staticThemePartialPreview` take
`{ findTheme({ themeId }), renderStaticPage, renderStaticPartial }`; `templatedThemePagePreview` takes `findTheme`,
`listPublishedPosts()` (published only), `resolveWidgets`, `resolveMediaTransformVersions`, `resolveMediaAssetMetadata`,
`resolveHtmlEmbeds`, `resolveSiteTitle`, `resolveSiteTimeZone` and `renderSite`. The host owns the route table, the
admin-session + `theme.set` gate on the templated route (before the call), and failure reporting, writing
`templatedPreviewFailureResponse({ errorId })` for a thrown render.
`./public-http/routes/agent-plugin-surfaces/files` (w4-routes): `createAdminSurfaceFilesRoute<Surface>({ pathPrefix })` is the
public raw spec (`GET <prefix>/:pluginId/:surfaceId/*`, `requestFacts`, `bufferedReply`) for a plugin admin surface's static
files. The host mounts it on its public raw mount (with the `requestFacts` port: `raw.facts.clientAddress` is the limiter key)
and injects `limiter` (`check({ key })`, charged before any lookup), `findSurface({ pluginId, surfaceId })` (its admitted
surface or `undefined`) and `readSurfaceFile({ surface, path })` (its contained read: `{ ok: true, body, headers }` with the
isolation headers, or `{ ok: false }`). Every refusal or fault is a plain 404; a limited client gets 429 + `Retry-After`.
`./public-http/http/site/render/doc/doc-render-contract` (w4-routes, types only): the doc renderer's contract
(`DocNodeRenderDeps`, `DocNodeHandler`, `DocRenderOptions`, `WidgetDocRendering`). The host injects
`DocNodeRenderDeps.renderWidget` (its widget renderer, bound once) and builds `WidgetDocRendering` from its own bound
`renderDocNode`/`renderNodes`, so neither renderer imports the other. Per-asset render metadata is
`@jini-ai/core/contracts/site/cms-media`'s `MediaAssetRenderMeta`, which the host resolves per render.

`./publish/content`: `normalizePeerBaseUrl({ raw, hasForbiddenRawUrlCharacter })` takes the raw-URL
character check from the host (Tovu passes `@jini-ai/core/contracts/server/verified-origin`'s), and
`canPublishToLive({ resolveRuntimeMode, env? })` takes the host's runtime-mode resolver. Neither
module imports another package's runtime implementation.

`./admin-http/routes/members/{list,get-by-id,disable,delete}`: server-neutral `defineJsonRoute` specs for the admin members
routes, with the DTO helper at `./admin-http/http/members` and the shared guards at `./admin-http/routes/members/shared`.
The members library is not in this package, so the host injects its collaborators: `disableMember` (disable), `trashMember`
(delete) and `classifyMemberError`, a `(err) => MemberErrorKind | undefined` classifier for the
library's error classes. Each route owns its status table over those kinds (delete 404/409/400, disable 404/400, get-by-id
404; list maps `ToolInputError` to 400 `VALIDATION_ERROR`); an unclassified error is rethrown for the host's 500. Disable
also takes `versionConflictMessage`, the host's reload copy: a `conflict` (lost compare-and-set) answers 409
`VERSION_CONFLICT` with that copy, never the library's message.
`memberRepo` is Pick'd to `list`/`findById` and read structurally (`AdminMemberSource`). Authorization is `member.manage`
on the `member` entity (by-id routes pass `{ entityId }`).
`./admin-http/routes/members/request-magic-link` (w3 C2d) is an operator-triggered sign-in link resend. The host injects
`magicLinkPerEmailLimiter` (its shared per-email limiter, keyed on the trimmed lower-cased email and consulted only after
`authorize()`, so an unauthorized caller never spends a target's budget), `requestSignInLink` (its members library), the
classifier (which also names `sign-in-unavailable` and `sender-not-configured`, both a 503 `MEMBER_SIGN_IN_UNAVAILABLE`) and
`senderNotConfiguredMessage` (the host's copy for that 503). A spent budget answers 429 with `Retry-After` via `routeReply`.

`./admin-http/routes/trash/{list,restore,purge,items}`: server-neutral specs for the admin Trash routes, with shared limits
and guards in `./admin-http/routes/trash/shared` and the screen row DTO in `./admin-http/http/trash`. The host binds the
product policy as required deps: `authorizeEntry` (the Trash entry gate, answering `{ permission, allowed, reason }`),
`mayActOn`/`filterVisible` (per-kind permission and visibility), `moveToTrash` (the generic single-item move, answering
`TrashMoveOutcome`), `userRepo.list` (the "Deleted by" usernames) and `loadPostDisplayKinds` (post/page subtype by id). The
specs own the HTTP contract: query clamping, selection validation after the entry gate, 403/404/409 bodies, per-item outcomes.

`./admin-http/routes/skills/{files,install,set-enabled,uninstall,guidance}`: server-neutral specs gated by
`admin.assistant.use` on the `skill` entity type (no entity id). The host binds everything that touches its disk or product:
`loadSkillSources`, `readSkillFiles` (the Node package reader, which enforces containment) with `fileLimits`,
`installRecordFileName` (hidden from the files listing), `installSkill`/`setSkillEnabled`/`uninstallSkill`,
`skillRegistrations.build` (whose read-only handler answers the guidance preview) and `isSkillInputError` (mapped to the flat
`{ error, code: "VALIDATION_ERROR" }` 400). Bodies are validated after authorization, as before.
`./admin-http/routes/skills/list`: the listing asks `admin.assistant.use` with NO entity type (as it always did) and reads
`If-None-Match` (`readHeaders`). The host binds `listManagedSkills` only. The spec owns the validators: a weak ETag over the
exact JSON body (Web Crypto SHA-256, base64url, byte-identical to the Node value), `Cache-Control: private, no-cache`,
`Vary: Cookie`, and a bare 304 (`routeReply`) after authorization. A `ToolInputError` from the listing answers its message as
a flat 500 `INTERNAL_ERROR`; anything else goes to the host's redacted 500.

`./admin-http/routes/integrations/{list,create,pause,delete,deliveries}`: server-neutral specs with the DTO helper at
`./admin-http/http/integrations`, gated by `admin.integrations.manage` on `webhook_subscription` (`entityId` on delete,
pause and deliveries). `@jini-ai/cms` does not depend on `@jini-ai/integrations`, so the webhook feature is injected:
create/pause/delete take a lifecycle function plus `isValidationError`/`isNotFoundError` matchers for the feature's error
classes; list and deliveries take the subscription and delivery repos as narrow read views. The host owns actor
attribution, the egress policy and the version-conflict throw (answered as the shared 409 body).

`./public-http/routes/ops/health`: `healthRoute` (`GET /health`) and `healthzRoute` (`GET /healthz`), public liveness probes
that take no deps, never authorize and always answer 200 `{ ok: true }`. A host mounts them with its public JSON ports ahead
of any body parser or session middleware, so they answer while the rest of the app is still booting. Readiness (`/readyz`)
stays host-owned.

`./public-http/routes/site/pages/redirect-phase` (w4-routes): `tryRedirectPhase({ phase, path, workspaceId, res, routing })` runs
the redirects `pre_content`/`post_content` resolve phase and writes a matched redirect. The host injects `routing` (its own
`createRouting` instance's `runPreContentPhase`/`runPostContentPhase`, whose phase registry is host module state) and a `res`
with `redirect(statusCode, location)`.
`./public-http/routes/site/pages/render-context/collection-lists` (w4-routes): `resolveCollectionListsForRender({ deps, html, pagePath })`
resolves a page's `collection` markers to entry-list markup. The host injects `workspaceId`, `contentTypeRepo.findByKey`,
`entryRepo.listPublishedForDisplay`, the optional `listingBatch` request and `siteTimeZone` port, `entryListAttribute`
(its entry-list wrapper attribute; its theme styles are scoped to that name, so it stays host-owned), and `collaborators`
(`CollectionListsCollaborators`: the `listing`, `markers`, `entries` and `dates` function groups, bound once from
`./listing`, `./widgets/markers`, `./entries/site/public-list` and `./widgets/date-label` so this `public-http` subpath
loads no other domain's runtime code).

`./admin-http/routes/fs-files/custom-root`: `fsCustomRootGetRoute`/`PutRoute`/`DeleteRoute` for the admin filesystem custom
root. The host injects `readCustomRoot`, `writeCustomRoot` (a path, or `null` to clear), `isInvalidRootError` (mapped to 400
`INVALID_PATH`) and the `readPermission`/`managePermission` names; `PUT` authorizes before validating its body. Not yet
mounted by Tovu (the mount waits on a route-table pin decision); the folder-picker routes stay host-side.

`./admin-http/routes/commerce/status`: the admin Commerce operational-status route as a server-neutral spec. It reads the
served workspace and one injected status read (`readCommerceStatus`); the host binds that read to whichever payment runtime it
composed (or none), so cms does not depend on the Commerce package. Authorizes `admin.integrations.manage` on `integration`;
a reader failure is not caught and reaches the host's redacted error port.

`./admin-http/routes/consent/routes`: the six admin cookie-consent routes (`GET`/`PUT` settings, `GET` readiness, `POST`
dry-run, preview, publish) as server-neutral specs over one `ConsentRouteDeps`. The host injects its consent service
(`consent`), its closed request contract (`readConsentRequest`, `consentRevisionToken` — the same readers its tool transport
uses) and `isConsentConflict` (its revision-conflict class). Each route authorizes `settings.read` (writes:
`settings.workspace.write`) on `site-consent` with no entity id, then reads the request, so a malformed body answers after
the permission check. Every answer carries `Cache-Control: no-store` (`responseHeaders`, set before the workspace 404).
Refusals keep the consent body order `{ code, error }`: `ToolInputError` 400 `CONSENT_VALIDATION_FAILED`, conflict 409
`CONSENT_REVISION_CONFLICT`, a service permission denial the fixed 403 copy; anything else reaches the host's error port.

`./admin-http/routes/widgets/preview` (w4-routes): `widgetPreviewRoute`, the unsaved widget preview, over
`WidgetPreviewRouteDeps`. The host injects `renderPreview` (its theme/document adapter: registry validation, resolver
dispatch, themed document) and `mapWidgetError` (its typed widget error rungs; `undefined` for anything else, which is
rethrown to the host's redacted 500). Mount it with `deferMissingPrincipal` (the spec answers its own 401
`authentication required`), `"direct"` authorization (`widgets.read` on `widget`, no entity id) and the `http/widgets`
operation-only failure copy. Every answer carries `Cache-Control: no-store` (`responseHeaders`).

`./admin-http/routes/site/profile`: the admin site-profile route with its `parseSections`/`parsePageLimit` query parsers. The
host injects the profile builder plus the builder's own section vocabulary and page cap. The route authorizes nothing itself
(every section is authorized inside the builder as the authenticated principal); a malformed query is a flat 400
`VALIDATION_ERROR`, checked after the principal as before; a builder failure reaches the host's redacted error port.

`./admin-http/routes/redirects/create` completes the redirects family as specs: POST `/redirects`, 201, body refusals flat
400 `VALIDATION_ERROR` before authorization, write-chokepoint errors via the shared `REDIRECT_WRITE_ERROR_MAPPINGS`; it reads
`workspaceId` and `redirectsWriteDeps` only.

`./public-http/http/site/member-auth-script`: `injectMemberAuthScript({ html, workspaceId, marker })` adds the member sign-in `<style>` and
`<script>` (`MEMBER_AUTH_STYLE`/`MEMBER_AUTH_SCRIPT`) before `</body>` when the page has a `data-member-nav`/`data-member-page` hook. The
host injects `marker`, the one fixed boolean attribute stamped on both elements (its presence is the idempotency check); the engine
ships no product-branded name. The script talks to the `/api/members/v1/workspaces/:id` routes under `./public-http/routes/members/*`.

`./public-http/http/site/form-presentation-assets`: `formBaselineStyle({ names })` returns the `<style>` baseline every form-rendering widget carries,
`formRangeReadoutJs({ names })`/`formRangeReadoutScript({ names })` the range-slider value readout. Wiring: the host injects `names`
(`FormPresentationNames`: `formClass`, `errorClass`, `formAttr`, `errorAttr`, `rangeValueClass`, `rangeMarkerAttr`,
`dangerFallbackProp`, `successFallbackProp`), the class/attribute/custom-property names its themes already select; the engine ships no
product-branded name and interpolates each verbatim. `FORM_SUCCESS_CLASS` and `FORM_SLUG_ATTR` are the generic names.
