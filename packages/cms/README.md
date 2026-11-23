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

Menus (`src/admin-http/routes/menus/*`, DTOs in `src/admin-http/http/menus.ts`): get-by-id,
update-tree, assign-location and delete authorize `admin.menus.*` with `{ entityId }`; list and
create stay id-free. The host injects what is its policy, not the engine's: `rawHtmlPermission`
(the extra permission a write carrying HTML needs), `normalizeMenuHtml` (a Node host binds
`normalizeMenuHtml` from `@jini-ai/cms/navigation/node`) and `trashMenu` (the host's trash move).
Malformed bodies are refused in `parse` with the host's code-less `{ error }` body.

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

`./publish/content`: `normalizePeerBaseUrl({ raw, hasForbiddenRawUrlCharacter })` takes the raw-URL
character check from the host (Tovu passes `@jini-ai/core/contracts/server/verified-origin`'s), and
`canPublishToLive({ resolveRuntimeMode, env? })` takes the host's runtime-mode resolver. Neither
module imports another package's runtime implementation.
