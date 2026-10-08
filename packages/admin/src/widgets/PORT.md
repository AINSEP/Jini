# Widgets admin port — C5 Part A, 2026-10-07

Programmer(Execution): Programmer + Refactor personas — implementation and behavior-preserving extraction under the C5 boundary.

## Inputs and scope

Owner dispatch: Part A ONLY, authoritative uncommitted Phase 17 native Dialog and Phase 18 TabBar changes. Governing specification is C0 + C5 and CMS-JINI-MODULAR-DESIGN Rev 3 decision 1. Architecture chapters 13/14 and Jini's extraction boundaries were consulted. No separate test certification was supplied; the source suites are the dispatch's acceptance contract.

- C0 SHA256 `6c1b41d519cccf41fc687d9f3c744b208bdbde7200f697d551bdfdec025b0efe`.
- C5 SHA256 `895d96c4ac14f52093df32dac56b481cce156e1fc98a67c4b1600c0a58a953dc`.
- Design SHA256 `efd7544a4ea3b23d59f847f00c36a2abb5c6ec9f82a2e1a6a3327f1f336ffd85`.
- `source-manifest.json` records exact hashes for all source inputs and host tests. No input drift occurred during this job.

Only this domain's Jini source and requested host artifacts were written. No Tovu source, core port, shared React component, manifest, lockfile, script or dist edit. No install, build, test, typecheck, server, index_repository, commit, staging, stash or checkout. Concurrent work elsewhere is not attributed to this job.

## Ownership and pattern contract

The coordinator explicitly selected `media` and `agent-plugins` as the seed patterns. This is the authorized pattern-priming contract; no additional approval was inferred. Reuse `defineAdminModule`, `adminPort`, `bindReact`, `useController`, `createControllerStore`, `AdminApiError`/`describeApiError`, and the existing DataTable/ConfirmDialog components. Effects and subscriptions live in React hooks; state and asynchronous decisions live in four framework-free controllers. Leaf components contain rendered markup.

`AdminWidgetsPort` belongs to `widgets/ports.ts`, per C5. The instance and region resources share this one API, rather than declaring a second core port. Instances expose list/get/create/update/trash; regions expose list/get/bind/ordered placement replacement. Embeds are present in whereUsed; the four screens never call embed mutation routes, so no speculative embed-write API is added. No purge/force-purge operation is added.

Reuse: widget instance/region behavior; searched both repositories' graph indexes, capability catalog, core ports and widgets host hooks/routes; inspected media/agent-plugins ports/adapters/controllers and all four host flows; used the source behavior over `createControllerStore` with one domain-owned API; owner C5.

Reuse: API failures; searched Jini admin/core/transport plus http-kit and ui; inspected `core/transport/errors.ts`; reused `AdminApiError` and `describeApiError`, normalizing the existing host Error+status+code+body shape rather than creating another generic error class; owner core/transport.

Reuse: shared config/picker/catalog/default config and slug redirect; inspected host WidgetConfigFields, WidgetPickerDialog, slug-redirect-path and their consumers; inject typed ConfigFields/AddControl slots plus the host catalog/defaultConfig and optional slugRedirectPath. No second production catalog/default-config/slug algorithm is introduced; owner C5's explicitly retained host components and shared slug helper.

Reuse: navigation and refresh; inspected core/ports/shell.ts and media events plus host refresh filter/subscription; optional widgetsNavigation uses `Pick<AdminShellNavigationPort, 'navigate'>`, while widgetsEvents receives resource/onRefresh and delegates filtering to the host. `AdminShellPort` named in C0 does not exist in this tree; the existing navigation owner is reused. No new router or refresh bus is implemented.

Graph MCP methods were unavailable in this host. Tovu's CLI wrapper was absent; Jini's search_graph CLI returned existing generic UI widgets, not an AdminWidgetsPort. Graphify and understand-anything scans provided no relevant current domain owner. Direct working-tree reads and scoped rg confirmed the authoritative uncommitted flow. No index was refreshed. Jini's Sonnet sidekick host/model was unavailable in this Codex dispatch; the work remained sequential and no helper result is claimed.

## Port contract and host limits

All port operations and controller factories take required/optional objects. Existing React component props, translator callbacks and the legacy useWired hook DI call shapes retain their established React/callback conventions. Scalar test facades live only under `react/__tests__/fixtures`.

Widget type, status and where-used kind are open string unions, as required by core ports README. The injected creation catalog decides what /new accepts; unknown saved types retain their raw display value. The host validates supported config schemas and region placement limits, authorizes widgets.*, resolves slug or id and owns transactional baseVersion writes. No client permission list is declared: `panels.tsx` has none for widgets.

Transport owns authentication, API prefixing, JSON serialization, request deadlines/retries and decoding. It must preserve GET/POST/PUT; the adapter forwards AbortSignal and never uses global fetch. Like the existing screens, list responses are not newly truncated or paginated, and placements are not silently capped. The configured host/server's existing limits remain authoritative.

| Operation | Workspace-relative request | Body/envelope |
|---|---|---|
| listWidgets | GET /widgets + widgetType/includeInactive query | widgets, optional skippedCount/skippedIds |
| getWidget | GET /widgets/:encoded-id-or-slug | widget + whereUsed |
| createWidget | POST /widgets | widgetType/title/config → widget |
| updateWidget | PUT /widgets/:encoded-id | baseVersion/config + title only when supplied → widget |
| trashWidget | POST /trash/items | type=widget + id → ok/version |
| listWidgetRegions | GET /widgets/regions | regions |
| bindWidgetRegion | POST /widgets/regions | regionKey → area |
| getWidgetRegion | GET /widgets/regions/:encoded-key | area + placements |
| mutateWidgetRegionPlacements | PUT /widgets/regions/:encoded-key | baseVersion + ordered placementId/widgetEntryId/enabled → area |

`createHttpWidgetsApi({ transport: mediaTransport, basePath: '/workspaces/<id>' }, {})` uses the SAME host request/url pair. The host authenticatedAdminRequest adds /api/admin/v1. With a raw transport that does not add a prefix, basePath may instead include /api/admin/v1. basePath is the workspace root, not its /widgets child, because Trash is a sibling resource.

Memory responses are detached snapshots, copy config inputs, enforce version conflicts and retain ordered/repeated/broken placements. `widgets` and `regions` are explicitly mutable fixture collections; production views access only the port operations. In-memory validation is not a substitute for the host's widget schema validators. `whereUsed` is seeded presentation data; the memory adapter does not reproduce the server's embed/reference indexing engine.

## React host seams

Use `widgets({ slots, widgetTypes, defaultConfig }, { t, locale, headerActions, slugRedirectPath, statusLabel })`.

- ConfigFields and AddControl stay host-owned. Bind ConfigFields with its shared-components translator, preserving its separate dictionary. t supplies widgets/common strings; optional statusLabel binds the existing serverLabel(value, locale) presentation owner. A host may alternatively supply a correctly composed t covering the relevant shared keys.
- widgetTypes is the existing WIDGET_TYPE_OPTIONS; defaultConfig calls the existing defaultWidgetConfig. Since the public port's widget type is open and the host's v1 type is closed, thin typed wrappers may narrow to the host's AdminWidgetType. No new production copy is needed.
- headerActions is the host PublishSectionButton with section=widgets, rendered at precisely its original positions on library and regions. Editor headers retain their own Save cluster.
- slugRedirectPath is the existing host helper, retaining replace navigation for raw UUID bookmarks.
- widgetsEvents.subscribe delegates to contentRefreshApplies/subscribeToContentRefresh for widgets-library or widgets-regions. Editors retain optimistic concurrency and no live-refresh subscription.
- navigationBase defaults to /admin; the optional navigation port receives base/routePath plus replace options through the existing shell contract.

Pages are library (/widgets), editor (/widgets/new and /widgets/:widgetId), regions (/widgets/regions), region (/widgets/regions/:regionKey). `WidgetsModulePageProps.params` carries widgetId/widgetType/regionKey as an optional object, also accepting those additive props directly. Core currently has one path per page: editor advertises /widgets/:widgetId, which matches /new; the host dispatch maps /new to widgetId=null and the ?type= value. `widgetsEditorPaths` records both paths. `widgetsAgentPageIds` preserves widgets/widget-regions; Part B leaves the existing panels.tsx route/agent ids untouched.

## Acceptance and evidence

Nine host suites were copied, retaining all 352 assertion call expressions and 146 test declarations (it.each expansion is not counted by this static declaration count). Only imports and harness/source-read locations changed. They now use the memory API, typed slot fixtures, host dictionary fixtures and a test-only scalar facade; HTTP-focused fixtures call the real extracted HTTP adapter over injected fetch. Host locale and bus traffic is fixture-owned. Exactly ONE new test invokes `runWidgetsApiConformance` against memory; the framework-free checklist contains 23 named checks.

Static source parsing/relative-import inspection covers 53 TS/TSX files; syntax diagnostics and missing relative imports are zero. Runtime import closure inspection covers universal barrel/adapters/conformance through core and finds no React or node:* runtime import. Source-manifest hashes still match the host. Static assertion comparison is not a green test result.

A static signature edit initially overlapped nested optional type ranges and malformed six declarations. It was caught by the next syntax inspection and corrected explicitly before handoff; assertions were restored from source and re-compared. No tests were weakened or skipped to conceal it.

Coordinator must run widgets suites, admin build, guard and packaging after M2 applies c5-exports.json and installs the copied suites' user-event dev dependency. Runtime/DOM/native-dialog behavior, types and packaging are UNVERIFIED by this job. There is no claimed green baseline or final suite result.

## Handoff and risks

Observable differences intended: none when the documented host seams are supplied. The production slots/defaults/catalog remain owned by the host. Copied slot fixtures verify the screen contract, not the real nested components or native-dialog behavior. Host-only wiring cases and the real WidgetConfigFields/WidgetPickerDialog suites remain Tovu acceptance gates (listed in the behavior diff).

Recorded follow-up: extract the shared WidgetConfigFields/WidgetPickerDialog family (including catalog/default config) into its approved Jini owner in a separate job; C5 explicitly leaves it host-owned. No parallel production copy was introduced.

Next assignee: Coordinator/M2 for export aggregation and validation, then the owner for behavior-diff acceptance/publication; Part B runs later serially. Do not ship a local source-only port before the published typecheck and Claude-in-Chrome checks.

## C5 Part B source integration (2026-10-08)

The host now mounts all four pages through useModulePanel, supplying params, actual config/picker
slots, dictionaries, catalog/default config, publish contribution, slug policy, status labels,
HTTP transport and filtered refresh/navigation ports. Provider accepts an optional complete
WidgetsReactOptions object, following the existing SEO Provider contract. Updating locale does
not replace lazy page identities or controller drafts; factory defaults remain supported.

Part B source inspection found the widget record/type declarations missing from models.ts despite
ports/controllers importing them. Restored the six DTO shapes plus AdminWidgetType/AdminWidgetStatus
from the documented HTTP contract, retaining open host-defined type/status/reference-kind unions.
No wire or rendered behavior changes are intended. No build, typecheck or suite was run: the
coordinator must rebuild/publish admin and validate the new host switch suites and all copied suites.
