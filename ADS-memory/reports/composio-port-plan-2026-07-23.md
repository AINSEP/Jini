# `@jini/composio` — port plan (pre-implementation)

**Status: PLAN ONLY. No code has been written against this plan.** Written per
Coordinator decision (already made, not re-litigated here): OD's Composio
integration becomes a new leaf package `@jini/composio`, following the same
"new package for concrete vendor-coupled logic" precedent as `@jini/registry`
— not folded into `@jini/capability-providers`, whose own `source-map.md`
is explicit that it ships "abstract port/interface definitions... no OD
source... zero wiring into any other package," the wrong shape for a
concrete, stateful, single-vendor SaaS client. This document is written to
the density/citation style of `packages/registry/source-map.md` and
`packages/capability-providers/source-map.md` — every classification below
is traceable to an exact line range in a file actually read in full this
session.

## Origin — confirmed, not estimated

All 7 files live at `apps/daemon/src/connectors/` (NOT
`apps/daemon/src/integrations/composio/` as guessed in the dispatch brief)
in `/Users/la/Desktop/Programming/OSS-Repos/open-design`, on whatever branch
is currently checked out there. Every file was read in full this session.
Line counts, confirmed via `wc -l`, **matched the dispatch brief's estimates
almost exactly — total 4,598 lines across 7 files, identical to the
estimate**:

| File | Estimated | Actual | Delta |
|---|---|---|---|
| `composio.ts` | ~1540 | **1540** | 0 |
| `service.ts` | ~939 | **939** | 0 |
| `routes.ts` | ~818 | **818** | 0 |
| `composio-descriptions.ts` | ~805 | **805** | 0 |
| `catalog.ts` | ~258 | **258** | 0 |
| `composio-curation.ts` | ~123 | **123** | 0 |
| `composio-config.ts` | ~115 | **115** | 0 |
| **Total** | ~4598 | **4598** | **0** |

The prior recon pass's numbers are exact — no scope-credibility concern from
line-count drift. `apps/daemon/src/server.ts` wires all of them together
(`registerConnectorRoutes` at line 588 import, `configureConnectorCredentialStore`/
`FileConnectorCredentialStore` at 633, `composioConnectorProvider`/
`configureComposioConfigStore` at 634–635, `composioConnectorProvider.configureCatalogCache(RUNTIME_DATA_DIR)`
+ `.startCatalogRefreshLoop()` at 2280–2281, `composio: composioConnectorProvider` in
some capability map at 2693, `.stopCatalogRefreshLoop()` at shutdown, 8621).

## Prior classification context (not re-litigated, cited for the record)

Two earlier passes in this repo already touched this directory and are worth
citing since they inform risk, not scope:

- `ADS-memory/reports/jini-port/recon/r1-daemon.md:36` filed `connectors/` (all 7 files,
  same count) under **PRODUCT** (leave-out), not MIXED: *"Composio connector
  catalog/curation/descriptions. Product-curated (though pattern is
  generic)."* — i.e. the original recon pass was more conservative than the
  Coordinator's actual decision to port it as a real package. That same
  doc's line 149–151 (credential/token-store port item 4) independently
  names Composio as one of three vendor-OAuth integrations (`xai`, `vela`,
  `composio`) an engine-level "generic secret/credential provider" port
  should eventually cover — relevant context for the persistence question
  below, not a directive.
- `ADS-memory/reports/od-route-parity-audit-2026-07-22.md:50` already named
  this exact gap from the HTTP-route side: *"Connectors (`/api/connectors/*`,
  Composio etc.) have no HTTP exposure in Jini at all, despite
  `packages/capability-providers` existing as the exact kind of abstraction
  this would plug into."* That audit assumed `@jini/capability-providers`
  would eventually host this; the Coordinator's actual decision (a separate
  `@jini/composio` package) supersedes that assumption. Noted so a future
  reader doesn't find the audit and think it's still-open guidance.

## Two collisions with this session's own earlier work — read before naming anything

### 1. Export/type-name collision: "connector" already means something else in `@jini/http`

`packages/http/src/connectors.ts` (built earlier this session, unrelated to
Composio) mounts `POST/GET /api/connectors/{auth,storage,payments,db,realtime}/...`
— one JSON route per method on `@jini/capability-providers`'s five
*generic capability* ports (`AuthProvider`/`StorageProvider`/`PaymentsProvider`/
`DbProvider`/`RealtimeProvider`), exporting `ConnectorsHttpDeps`,
`registerConnectorsRoutes`, `connectorsAuthSignUpRoute`, etc. OD's Composio
integration uses "connector" for a completely different concept — a
third-party SaaS *tool* (GitHub, Notion, Slack...) an agent can call, with
its own `ConnectorCatalogDefinition`/`ConnectorDetail`/`ConnectorService`/
`registerConnectorRoutes` (singular — OD's actual export name,
`apps/daemon/src/connectors/routes.ts:554`) names. These are two unrelated
"connector" vocabularies that happen to share a noun by historical accident
(OD's own naming, ported faithfully by an earlier session into
`@jini/http`, before this task's OD source was ever read).

**Recommendation for `@jini/composio`'s naming:** do not export a bare
`Connector`/`ConnectorService`/`registerConnectorRoutes` that would sit next
to `@jini/http`'s existing `Connectors*` exports with only a subtle
plural/singular distinction. Prefix Composio-specific types that would
otherwise read as fully generic — `ComposioConnectorService`,
`registerComposioRoutes` — while keeping names that are *already*
Composio-only in practice as-is (`ComposioConnectorProvider`,
`ComposioConfig`). Left as an open question below rather than decided
unilaterally, since `packages/ui/src/features/connectors/` (see below) has
already established a *third*, UI-side "Connector" vocabulary this needs to
stay compatible with.

### 2. Route-path collision: `/api/connectors/*` is already claimed

Worse than the export-name collision: `@jini/http`'s `connectors.ts` mounts
real routes at `/api/connectors/auth/signup`, `/api/connectors/storage/:key`,
`/api/connectors/db/:collection`, etc. (`packages/http/src/connectors.ts:190-609`).
OD's `routes.ts` also roots every Composio route under `/api/connectors`
(`/api/connectors`, `/api/connectors/status`, `/api/connectors/discovery`,
`/api/connectors/logos/:slug`, `/api/connectors/composio/config`,
`/api/connectors/:connectorId`, `/api/connectors/:connectorId/connect`,
`/api/connectors/oauth/callback/:connectorId`, etc. —
`apps/daemon/src/connectors/routes.ts:558-722`). These specific sub-paths
don't literally clash as Express routes (different leaf segments), but
mounting both route packs on the same `Express` app produces a single
`/api/connectors/*` surface serving two semantically unrelated concepts —
confusing for API consumers and for anyone reading route tables. **Phase 5
(below) must mount Composio's routes under a different root — recommend
`/api/composio/*`** (matches the vendor name directly, avoids "connector"
entirely, and is honest about being one specific provider rather than a
generic abstraction).

## A third thing to reconcile: `packages/ui/src/features/connectors/` already exists and is waiting

Independent discovery, not mentioned in the dispatch brief: `@jini/ui`
already has a fully-built, tested frontend slice —
`packages/ui/src/features/connectors/` (`ConnectorsBrowser.tsx` + 3 hooks +
`rules.ts` + `ports.ts` + `dependencies.ts` + components), documented in
`packages/ui/source-map.md:436-466`. It was ported from OD's real
`ConnectorsBrowser.tsx` with Composio-specific wire shapes **deliberately
stripped**: no category→i18n map (`packages/ui/source-map.md:452-454`, "a
host supplies `getCategoryLabel?`"), no Composio-CDN logo-slug construction
(`:455-462`, "not called out by r6 as an exclusion, but is genuinely
Composio-specific... kept the generic initials/palette-hash fallback, now
taking a plain host-resolved `logoUrl` prop instead"), and a hardcoded
`provider === 'composio'` branch in `getDisplayableConnectorAccountLabel()`
was found and stripped during its own audit (`:614-620`) as "the same class
of provider-specific-logic-in-neutral-code bug as the category map."

Its DI seam, `packages/ui/src/features/connectors/ports.ts`, defines
`ConnectorsPort`:

```ts
export interface ConnectorsPort {
  fetchConnectors(): Promise<Connector[]>;
  fetchConnectorEnrichment?(options?: { refresh?: boolean }): Promise<Connector[]>;
  fetchConnectorStatuses(): Promise<ConnectorStatusMap>;
  fetchConnectorDetail(connectorId: string, options?: FetchConnectorDetailOptions): Promise<Connector | null>;
  connectConnector(connectorId: string): Promise<ConnectorActionResult>;
  disconnectConnector(connectorId: string): Promise<Connector | null>;
  cancelConnectorAuthorization(connectorId: string): Promise<Connector | null>;
  openExternalUrl(url: string): Promise<boolean>;
}
```

Today this is wired only to `createFakeConnectorsPort`
(`packages/ui/source-map.md:442`, "per the canary's own instruction: ship a
fake, not a real `providers/registry` call"). **This is a real, already-built
consumer-shaped target `@jini/composio` + `@jini/http`'s eventual Composio
routes should satisfy** — not by `@jini/composio` importing `@jini/ui` (wrong
direction, backend package must never depend on a frontend one), but as a
design constraint on Phase 5's HTTP wire shapes: whatever JSON `/api/composio/*`
returns should be trivially mappable to `Connector`/`ConnectorActionResult`/
`ConnectorStatusMap` by a thin browser-side `ConnectorsPort` implementation
(not part of this package — a follow-up task, analogous to
`dependencies.ts`'s own comment that "OD's real implementation calls
`providers/registry`"). This maps almost 1:1 onto `ConnectorService`'s
existing method set (`listConnectors`≈`fetchConnectors`,
`listConnectorDiscovery`≈`fetchConnectorEnrichment`,
`listConnectorStatuses`≈`fetchConnectorStatuses`, `getConnector`/
`getPreviewConnector`≈`fetchConnectorDetail`, `connect`≈`connectConnector`,
`disconnect`≈`disconnectConnector`, `cancelPendingAuthorization`≈
`cancelConnectorAuthorization`) — strong evidence `ConnectorService`'s
existing method shape is already close to right and shouldn't be redesigned
wholesale during the port.

## Per-file classification

### 1. `catalog.ts` (258 lines) — **port-with-decoupling**

Type defs (`ConnectorDetail`, `ConnectorCatalogDefinition`,
`ConnectorToolDetail`, `ConnectorCatalogToolDefinition`,
`ConnectorAuthDetail`) plus pure functions (`classifyConnectorToolSafety`,
`defineConnectorTool`, `connectorDefinitionToDetail`). Genuinely well-shaped,
generic connector/tool-catalog modeling — regex-based safety classification
(destructive/write/read-only heuristics over name+description+scopes,
lines 125-184) has zero OD coupling. Two decoupling points:

- **Line 1**: `import type { BoundedJsonObject, BoundedJsonValue } from '../live-artifacts/schema.js'` —
  this file is NOT among the 7 in scope; it's OD's 904-line "Live Artifacts"
  feature validator (`apps/daemon/src/live-artifacts/schema.ts`). Must NOT be
  pulled in. **Resolution**: `@jini/protocol`'s `packages/protocol/src/common.ts:1-3`
  already defines a structurally identical `JsonValue = JsonPrimitive |
  JsonValue[] | { [key: string]: JsonValue }` (and a `BoundedJsonConstraints`
  shape for size-limit *policy*, though not the 904-line runtime validator
  itself). `@jini/composio` should import `JsonValue` from `@jini/protocol`
  and define a local `type JsonObject = Record<string, JsonValue>` alias —
  no dependency on OD's live-artifacts module, no need to port its validator.
- **Line 6**: `export type ConnectorToolUseCase = 'personal_daily_digest';` —
  a single-member union type whose only value is the name of one specific OD
  product feature ("personal daily digest"). This is the type the entire
  leave-out `composio-curation.ts` overlay (below) exists to populate. Needs
  generalizing — recommend widening to `string` (an open string type) so the
  `curation.useCases` mechanism survives generically without baking in one
  OD feature name. Open question below on whether the curation *mechanism*
  ships at all.
- **Line 254** (inside `connectorDefinitionToDetail`, lines 231-258):
  `provider: definition.authentication ?? (definition.provider === 'open-design' ? 'local' : 'oauth')`
  — a hardcoded product-identity string comparison used purely to pick a
  fallback `authentication` value when the field is unset. See the identical
  pattern in `service.ts:272` below — same fix needed in both places, listed
  as a single open question rather than two.

### 2. `composio-curation.ts` (123 lines) — **confirmed leave-out (verified by reading, not assumed)**

`COMPOSIO_CURATION_OVERLAY` (lines 7-123) is a hand-curated
`Record<toolkitSlug, Record<toolName, ConnectorToolCuration>>` covering ~19
toolkits (gmail, googlecalendar, googledrive, googledocs, googlesheets,
slack, github, notion, linear, jira, asana, todoist, googletasks, outlook,
microsoftteams, discord, figma, sentry, gitlab, clickup, trello, hubspot —
line-by-line every single entry sets `useCases: ['personal_daily_digest']`
via the shared `DAILY_DIGEST_CURATION` constant (lines 3-5). Every `reason`
string is written specifically to justify inclusion in one OD product
feature ("Recent inbox activity is useful for a personal digest," "Upcoming
and recent calendar events fit a daily briefing," etc.). This is 100%
opinion about one OD feature, confirmed by reading the whole file, not
inferred from the filename — **leave the data out entirely.**

The *mechanism* it plugs into is generic and worth keeping: `composio.ts`'s
`applyComposioToolCuration()` (composio.ts:1453-1475) merges an injected
overlay dict onto a tool definition and additionally applies a small
hardcoded safety override set
(`COMPOSIO_READ_ONLY_TOOL_SAFETY_OVERRIDES = new Set(['notion:notion_search_notion_page'])`,
composio.ts:19-27 — this override set is itself vendor-specific but not
OD-product-specific, i.e. it's Composio API quirk-handling, not an OD
opinion; port as-is). Recommendation (also see Open Questions): port the
overlay-application *mechanism* as an optional constructor parameter
(`curationOverlay?: Readonly<Record<string, Readonly<Record<string,
ConnectorToolCuration>>>>`, defaulting to `{}`), and do not port
`composio-curation.ts`'s data file at all.

### 3. `composio-config.ts` (115 lines) — **port-with-decoupling**

`ComposioConfig { apiKey, authConfigIds }` + atomic JSON file store (tmp-write
→ rename → chmod 0600, matching this repo's established atomic-write
convention). Two issues:

- **Line 14**: `let configFilePath = path.join(process.cwd(), '.od', 'connectors', 'composio-config.json');`
  — OD-branded default path (`.od/`). De-brand.
- **Lines 14-18**: the whole store is a **module-level mutable global**
  (`configFilePath`), reassigned via `configureComposioConfigStore(dataDir)`
  rather than being an instance the caller owns. This is not just a
  de-branding issue — it means two `ComposioConnectorProvider`-equivalent
  instances in the same process (e.g. two tests running in parallel, or a
  future multi-tenant daemon) would stomp each other's config path. **Real
  correctness gap, not a style nit.** Recommend porting as a factory
  returning a store object instead of mutating a module global:
  ```ts
  export interface ComposioConfigStore {
    read(): ComposioConfig;
    readPublic(): PublicComposioConfig;
    write(input: unknown): PublicComposioConfig;
    setAuthConfigId(connectorId: string, authConfigId: string): void;
    deleteAuthConfigId(connectorId: string): void;
  }
  export function createFileComposioConfigStore(options: { filePath: string }): ComposioConfigStore;
  ```
  Everything else — the `normalizeComposioConfig`/`normalizeOptionalString`/
  `normalizeAuthConfigIds` validation helpers, the atomic-write mechanics — is
  generic and ports verbatim into the new factory's closure.

### 4. `composio-descriptions.ts` (805 lines) — **port-as-is, verbatim**

`COMPOSIO_TOOLKIT_METADATA: Record<string, ComposioToolkitMetadata>` — ~150
hand-written `{description, category, toolCount?}` entries for real Composio
toolkit slugs (GITHUB, NOTION, LINEAR, JIRA, SENTRY, DATADOG, SUPABASE,
BITWARDEN, APALEO, ... down to line 796). **Zero imports, fully
self-contained** (confirmed — this file imports nothing from any other of
the 7 files or from OD internals). Grepped explicitly for OD-identity leakage
(`grep -n "open-design\|Open Design\|OD_" composio-descriptions.ts`) —
**zero matches**, confirmed clean by direct read of the head (lines 1-80)
and tail (lines 760-805) plus the grep across the full file. This is vendor
marketing-style copy about third-party SaaS tools ("Browse repositories,
read issues and pull requests..."), not OD product copy. Port the entire
file byte-for-byte; only the module doc comment (lines 1-11, which
references `composio.ts` and `DOCUMENTED_COMPOSIO_TOOLKITS` by their OD
paths) needs a path update, not a content change.

### 5. `composio.ts` (1540 lines) — **port-with-decoupling**

The core `ComposioConnectorProvider` class (lines 441-1185) plus static
catalog data/builders. Breaks into a clean read-only half and a
network/OAuth half:

**OD coupling found (all decoupling points):**

- **Line 14**: `const DEFAULT_COMPOSIO_USER_ID = 'open-design-local-user';`
  — used by `getUserId()` (lines 1182-1184), which is called at
  `connect()`'s account-link body (line 939, `user_id: this.getUserId()`),
  `execute()`'s tool-execute body (line 791), and
  `getValidatedConnectedAccount()`'s ownership check (line 757, comparing
  the provider's returned `user_id` against `this.getUserId()`). Every
  Composio API call is scoped to this single hardcoded user id — this is
  the load-bearing multi-tenancy gap the brief called out. Must become a
  required constructor parameter (`userId: string`), no default.
- **Line 42**: `let composioCatalogCacheFilePath = path.join(process.cwd(), '.od', 'connectors', 'composio-catalog-cache.json');`
  — same module-global-mutable-default pattern as `composio-config.ts:14`,
  same fix needed (constructor-injected path, no shared global). Set today
  via `configureCatalogCache(dataDir)` (lines 467-470), which itself calls
  `this.loadPersistedCatalogCache()` — that instance-method call is fine to
  keep, only the *storage location* of the path (module global → constructor
  field) needs to change.
- **Lines 1402-1414** (`fallbackComposioDescription`): every one of the 10
  category-branch template strings literally ends in `"...in Open Design"` /
  `"...Open Design artifacts"` (e.g. line 1404: `` `Coordinate ${name}
  projects, tasks, and workflow data inside Open Design.` ``). Used only when
  no curated description exists (`composio-descriptions.ts` miss) and no
  live Composio toolkit description is usable
  (`isGenericComposioDescription` filters out Composio's own generic
  placeholder). Needs a `productName` parameter (default something neutral
  like `"your workspace"` or make the product name a required constructor
  option with no default) threaded through all 10 branches.
- **Line 1166**: `'user-agent': 'OpenDesign/0.1 ComposioConnectorProvider'`
  — hardcoded OD product string in the outbound HTTP header sent to
  `backend.composio.dev`. Needs a `userAgent` constructor option, generic
  default (e.g. `'@jini/composio'` + package version).
- **Lines 8, 1453-1475**: imports `COMPOSIO_CURATION_OVERLAY` from the
  leave-out `composio-curation.ts` and applies it unconditionally inside
  `applyComposioToolCuration`, called from both `toolDefinitionFromComposioTool`
  (line 1112, the live-discovery path) and `buildStaticComposioCatalog`
  (line 1209, the static-catalog path). Since the overlay data is being left
  out, this becomes `curationOverlay?: ...` defaulting to `{}` — see item 2
  above.
- **Lines 44-144** (`FEATURED_COMPOSIO_CATALOG`): 3 fully-fleshed-out example
  connectors (github, notion, google_drive) with real tool definitions —
  this is OD's *editorial choice* of which 3 toolkits deserve featured
  treatment before any live API call, not an OD-branding issue per se (no
  "Open Design" strings inside it), but it is a product opinion about which
  integrations matter most. Recommend keeping as the package's shippable
  default (genuinely useful bootstrap data, no vendor lock-in risk) but
  exposing it as an overridable constructor option so a host can supply its
  own "featured" set without forking.
- **Lines 146-328** (`DOCUMENTED_COMPOSIO_TOOLKITS`): ~150-entry
  `{name, slug}` list of every documented Composio toolkit. This is vendor
  catalog data (a real inventory of what Composio itself offers), not an OD
  opinion — port as-is, though it will drift as Composio adds/removes
  toolkits (see Open Questions).

**Generic, port largely as-is beyond the parameterizations above:** OAuth
dance (`connect`/`prepareAuthConfig`/`completeConnection`/`disconnect`,
lines 648-780), catalog discovery/hydration/caching (`listDefinitions`/
`getDefinition`/`getHydratedDefinition`/`getPreviewDefinition`/
`refreshCatalog`/the persisted-cache read-write-refresh-loop machinery,
lines 492-630), auth-config resolution/creation (lines 813-973), the raw
Composio API client helpers (`request`/`requestJson`/`listAuthConfigs`/
`listToolkits`/`listToolsPage`, lines 975-1032, 1141-1180), tool-definition
mapping/merging (`definitionFromToolkit`/`toolDefinitionFromComposioTool`/
`mergeToolDefinition`, lines 1041-1200), and every small pure helper at the
bottom of the file (slug/name normalization, error-message extraction,
bounded-JSON conversion) — none of this has OD coupling beyond the items
listed above.

### 6. `service.ts` (939 lines) — **port-with-decoupling (more invasive than composio.ts)**

`ConnectorService`/`ConnectorStatusService`/`ConnectorCredentialStore`
(+ two implementations)/`ConnectorServiceError`/output-protection and
rate-limiting helpers. Two real design issues, not just string substitution:

- **Line 15, and used at lines 574, 578, 582, 590, 594-595, 599, 622, 624,
  626, 693, 715, 727, 741, 855**: `ConnectorService` directly imports and
  calls the **module-level singleton** `composioConnectorProvider` rather
  than accepting an injected provider. Despite generic-sounding names
  (`ConnectorService`, `ConnectorExecuteRequest`,
  `executeConnectorProviderTool`), the class is *not* actually
  provider-agnostic in practice: `executeConnectorProviderTool` (lines
  846-862) has exactly one real branch (`definition?.authentication ===
  'composio'`) and throws `'connector provider is not implemented'` (501)
  for anything else. **This should become real dependency injection** — a
  constructor parameter (`provider: ComposioConnectorProvider`) instead of
  an imported singleton — both to fix the "two instances in one process"
  problem this shares with the config-store/catalog-cache globals above, and
  because it's the honest fix for a class whose name promises more
  generality than its one real code path delivers.
- **Line 272** (`isAutoConnectedConnector`) and the duplicate at
  `catalog.ts:254`: `definition.authentication ?? (definition.provider ===
  'open-design' ? 'local' : 'oauth')`. In OD this distinguishes "a connector
  the host app itself defines" (auto-connected, no OAuth needed) from
  "everything else defaults to OAuth." A neutral engine has no equivalent
  "first-party provider id" to compare against. Two options, both requiring
  a decision (see Open Questions): (a) parameterize the magic string as a
  constructor option (`localProviderId?: string`), or (b) remove the
  fallback-inference entirely and make `ConnectorCatalogDefinition.authentication`
  a required field with no inferred default — cleaner, but is a breaking
  type change relative to OD's original (optional) field. Recommend (b) —
  inferring product identity from a string literal is exactly the kind of
  hidden coupling this port exists to remove, and every one of OD's own 3
  `FEATURED_COMPOSIO_CATALOG` + ~150 `DOCUMENTED_COMPOSIO_TOOLKITS` entries
  already sets `authentication: 'composio'` explicitly (composio.ts:52, 85,
  118, 1234), so the inference branch may not even be reachable from this
  port's own static data — needs confirming empirically once ported (do not
  assume; the "confirm before deleting" convention this repo already
  follows for unreachable-code claims applies here too).
- **Lines 464-476** (`ConnectorExecutionContext`, rate-limit constants):
  `projectsRoot`/`projectId`/`runId`/`purpose: 'agent_preview' |
  'artifact_refresh'` are named after OD's "project" noun, but functionally
  they're only used as an *opaque rate-limit bucketing key*
  (`connectorRunLimitKey`, line 507-509: `` `${context.projectId}\0${context.runId
  ?? ...}` ``) and echoed into response metadata — no actual project-model
  coupling (no filesystem path resolution, no project-CRUD call). Low-risk:
  port as-is, optionally rename `projectId`→`scopeId`/`sessionId` for
  vocabulary cleanliness, but this is cosmetic, not a real coupling fix.
- **Everything else is generic and ports as-is**: `ConnectorServiceError`
  (lines 107-117), `FileConnectorCredentialStore`/
  `InMemoryConnectorCredentialStore` (lines 169-261, generic
  atomic-file-JSON and in-memory keyed stores — see the Persistence section
  below for whether these should instead delegate to
  `@jini/capability-providers`), `ConnectorStatusService`'s in-memory status
  tracking (lines 352-462), output redaction/size-capping
  (`protectConnectorOutput`, `CONNECTOR_FORBIDDEN_OUTPUT_KEYS`, lines
  478-558 — a genuinely good generic security pattern, keep verbatim), JSON
  schema input validation (`assertJsonSchemaMatches`, lines 304-346), and
  the rate-limiting logic (`enforceRunLimits`/`pruneRunLimits`, lines
  864-899).

### 7. `routes.ts` (818 lines) — **mixed: port-with-decoupling + leave-out, and a real rewrite (not mechanical porting) for whatever ships**

This is the file needing the most judgment, and the one place a purely
mechanical "copy the file, fix the imports" port would be wrong.

**Leave-out #1 — the OD-branded OAuth-success HTML page (`renderConnectorConnectedHtml`,
lines 300-552, ~250 lines).** Hardcoded `<title>${connectorLabelHtml}
connected · Open Design</title>` (line 322), a `.chrome` header literally
containing `<span class="brand-title">Open Design</span>` (lines 475-477),
body copy referencing "Open Design" four times (487, 509, 542, 545), the
cross-window handshake's `postMessage` payload type string
`'open-design:connector-connected'` (line 504), and ~150 lines of inline CSS
using OD's specific design tokens (`--accent: #c96442`, serif font stack,
etc., lines 323-471). **Leave the specific HTML/branding out.** The
*mechanism* — serve a same-tab landing page after OAuth completes that
`postMessage`s the result back to `window.opener` and offers a manual-close
fallback when there's no live opener (the `hasLiveOpener`/`showManualCloseHint`
logic, lines 511-536, handles a real, non-obvious browser-popup-blocking
edge case referenced as "Issue #669" in OD, line 523) — is generically
useful and worth keeping. Recommend: port a minimal, unbranded default
template (generic title, no brand chrome, a generic
`'composio:connector-connected'`-shaped message type — pick a name that
doesn't collide with anything OD-branded) plus an injectable
`renderConnectedHtml?: (connectorId: string, connectorLabel: string) =>
string` override, matching the `sendApiError`-injection convention this same
file already uses for a different concern.

**Leave-out #2 — `/api/tools/connectors/list` (lines 724-753) and
`/api/tools/connectors/execute` (lines 755-817), ~95 lines total.** Both
depend on two modules that are **not among the 7 files and not part of this
port's scope**:
- `../tool-tokens.js` (`apps/daemon/src/tool-tokens.ts`, 243 lines,
  confirmed by direct read) — OD's per-chat-session "tool token" grant
  system. `CHAT_TOOL_ENDPOINTS`/`CHAT_TOOL_OPERATIONS` (lines 5-28) list
  `connectors:list`/`connectors:execute` alongside `live-artifacts:*`,
  `design-systems:read`, `media:generate`, `library:*` — i.e. this is OD's
  general chat-agent tool-authorization system, of which connector-tool
  access is just one of ten gated operations. Genuinely out of scope; not a
  Composio concern at all.
- `../tools/connectors.js` (`apps/daemon/src/tools/connectors.ts`, 137
  lines, confirmed by direct read) — `executeConnectorTool`/
  `listConnectorTools`, which filter/expose `ConnectorService`'s catalog as
  agent-callable tools, gated by the same `ToolTokenGrant` and OD's
  `projectsRoot`/`projectId` model.

  Both are OD-internal glue this port has no reason to pull in; the
  underlying capability (`ConnectorService.execute()`/`.listConnectors()`,
  already ported in Phase 3/4 below) already covers the same ground
  generically. **Leave both routes out of the initial port.** Flag as an
  open question whether a simplified, ungated equivalent belongs in
  `@jini/agent-runtime`/`@jini/daemon` later, once/if an equivalent generic
  "expose provider tools to the agent loop, gated by something" concept
  exists there — this is not `@jini/composio`'s job to invent.

- **Route-path rename (all remaining routes)**: `/api/connectors/*` →
  `/api/composio/*` throughout, per the collision finding above.
  `connectorCallbackUrl()`'s hardcoded `/api/connectors/oauth/callback`
  (line 278) moves with it.

- **Not a mechanical port: this file predates `@jini/http`'s current
  route-definition idiom.** Every other route pack this session has ported
  into `@jini/http` (`connectors.ts` — the capability-providers one — and
  `xai.ts`, both read this session) uses `defineJsonRoute`/`mountJsonRoute`
  from `./adapter.js`, parsing into a typed `RouteInputContext` and
  returning a `Result<T>`. OD's `routes.ts` instead registers raw
  `app.get/post/put/delete` handlers with manual `try/catch` and a
  caller-supplied `sendApiError` callback (`RegisterConnectorRoutesOptions`,
  lines 52-63) — an older, different convention. Phase 5 (below) is real
  design/rewrite work, not push-button porting: every handler needs
  restating as a `defineJsonRoute<Input, Output, ComposioHttpDeps>` call.
  The good news: everything genuinely reusable survives the rewrite
  unchanged — `isLoopbackHostname`/`connectorCallbackUrl`'s loopback-only
  redirect-URI enforcement (lines 43-81, 267-279, a real and generic local-daemon
  OAuth security property, keep verbatim), the Composio-logo-CDN proxy with
  its size-capped streaming read and LRU-ish cache (`fetchComposioLogo`/
  `readComposioLogoBody`/`cacheComposioLogo`, lines 133-265, fully generic
  Composio-CDN-facing logic, no OD coupling), and the config get/put routes
  (lines 596-617) all port over as logic, just restated in the new route
  idiom.

## Proposed public interface

```ts
// ---- catalog.ts (ported, decoupled) ----
export type ConnectorToolUseCase = string; // widened from the single OD literal
export interface ConnectorToolCuration { useCases?: ConnectorToolUseCase[]; reason?: string }
export interface ConnectorCatalogDefinition { /* ...as OD, minus the 'open-design' inference — see Open Questions */ }
export function classifyConnectorToolSafety(input: ConnectorToolSafetyClassificationInput): ConnectorToolSafety;
export function defineConnectorTool(tool: ...): ConnectorCatalogToolDefinition;
export function connectorDefinitionToDetail(definition: ConnectorCatalogDefinition): ConnectorDetail;

// ---- composio-descriptions.ts (ported verbatim) ----
export const COMPOSIO_TOOLKIT_METADATA: Record<string, ComposioToolkitMetadata>;
export function getComposioToolkitMetadata(slug: string): ComposioToolkitMetadata | undefined;

// ---- composio-config.ts (ported, module-global -> factory) ----
export interface ComposioConfigStore {
  read(): ComposioConfig;
  readPublic(): PublicComposioConfig;
  write(input: unknown): PublicComposioConfig;
  setAuthConfigId(connectorId: string, authConfigId: string): void;
  deleteAuthConfigId(connectorId: string): void;
}
export function createFileComposioConfigStore(options: { filePath: string }): ComposioConfigStore;

// ---- composio.ts (ported, decoupled) ----
export interface ComposioConnectorProviderOptions {
  userId: string;                    // was DEFAULT_COMPOSIO_USER_ID = 'open-design-local-user', now required
  configStore: ComposioConfigStore;  // was module-global readComposioConfig()
  catalogCachePath?: string;         // was '.od/connectors/composio-catalog-cache.json'; no default assuming a product dir
  baseUrl?: string;                  // default DEFAULT_COMPOSIO_BASE_URL ('https://backend.composio.dev')
  userAgent?: string;                // was hardcoded 'OpenDesign/0.1 ComposioConnectorProvider'
  productName?: string;              // threads into fallbackComposioDescription's 10 template strings
  curationOverlay?: Readonly<Record<string, Readonly<Record<string, ConnectorToolCuration>>>>; // default {}, was hardcoded COMPOSIO_CURATION_OVERLAY import
  featuredCatalog?: ConnectorCatalogDefinition[]; // default FEATURED_COMPOSIO_CATALOG, overridable
}
export class ComposioConnectorProvider {
  constructor(options: ComposioConnectorProviderOptions);
  // same method surface as OD: isConfigured/listDefinitions/getDefinition/getHydratedDefinition/
  // getPreviewDefinition/refreshCatalog/connect/prepareAuthConfig/completeConnection/disconnect/
  // execute/cancelPendingConnections/startCatalogRefreshLoop/stopCatalogRefreshLoop/configureCatalogCache
}
export function getStaticComposioCatalogDefinitions(toolkits?: ComposioToolkitCatalogEntry[]): ConnectorCatalogDefinition[];

// ---- service.ts (ported, provider now injected instead of a module singleton) ----
export interface ConnectorCredentialStore { get/set/delete/deleteByProvider }  // ported as-is
export class FileConnectorCredentialStore implements ConnectorCredentialStore { /* dataDir-scoped, as OD */ }
export class InMemoryConnectorCredentialStore implements ConnectorCredentialStore { /* as OD */ }
export class ConnectorStatusService { /* as OD, unchanged */ }
export class ConnectorService {
  constructor(options: { provider: ComposioConnectorProvider; statusService?: ConnectorStatusService });
  // same method surface as OD's ConnectorService: listConnectors/listConnectorStatuses/
  // listConnectorDiscovery/getConnector/getHydratedConnector/getPreviewConnector/
  // prepareAuthConfigs/connect/disconnect/cancelPendingAuthorization/
  // completeComposioConnection/execute
}
export class ConnectorServiceError extends Error { /* as OD */ }

// ---- routes.ts (Phase 5, rewritten against @jini/http's defineJsonRoute — not mechanical) ----
export interface ComposioHttpDeps {
  readonly service?: ConnectorService;
  readonly provider?: ComposioConnectorProvider;
  readonly renderConnectedHtml?: (connectorId: string, connectorLabel: string) => string;
  readonly onInternalError?: (context: ...) => void; // SEC-005 pattern, matching connectors.ts/xai.ts
}
export function registerComposioRoutes(app: Express, deps: ComposioHttpDeps, adapter: AdapterContext): void;
// mounted at /api/composio/*, NOT /api/connectors/* — see the collision section above
```

## Persistence: own store, or lean on `@jini/capability-providers`?

Three things need durable storage: (1) `ConnectorCredentialRecord`s (one per
connected connector — `connectorId`, `accountLabel`, opaque
`ConnectorCredentialMaterial`, `updatedAt`), (2) `ComposioConfig` (a single
`{apiKey, authConfigIds}` record), (3) the persisted catalog cache (a
larger, ~150-connector JSON blob refreshed daily).

Two real options, presented for sign-off rather than decided here (per the
task's own framing):

- **Option A — keep OD's file-based stores, de-branded (the `@jini/sqlite`
  precedent: "own your persistence").** `FileConnectorCredentialStore` and
  the new `createFileComposioConfigStore` already implement the atomic
  tmp-write/rename/chmod-0600 pattern this repo uses everywhere else for
  local secrets; the catalog cache is a single JSON blob with no query
  needs. Zero new dependency. Downside: a host that already has a
  `DbProvider`/`StorageProvider` wired (e.g. for multi-tenant/cloud
  deployment) gets a second, parallel on-disk storage mechanism for
  Composio specifically.
- **Option B — delegate to `@jini/capability-providers`'s `DbProvider`
  (credentials + config) and `StorageProvider` (catalog cache blob).**
  `DbRecord { id, ...fields }` + collection semantics map cleanly onto
  `ConnectorCredentialRecord` (collection `'composio-credentials'`, id =
  `connectorId`) and `ComposioConfig` (collection `'composio-config'`, a
  single record with a fixed id). `StorageProvider.put/get` (raw bytes,
  keyed) maps cleanly onto the catalog-cache JSON blob (`key:
  'composio/catalog-cache.json'`). Upside: reuses an already-built,
  already-tested port (`packages/capability-providers/source-map.md`'s
  2026-07-21 real-adapter pass ships `SqliteDbProvider`/`BlobStorageProvider`
  today) instead of a third bespoke file-store implementation. Downside:
  `@jini/capability-providers` is `"incubating"` in `UNLOCKED.md`, not
  `"stable"` — `@jini/composio` would also start `"incubating"`, so this
  isn't a locked-package boundary violation, but it does mean
  `@jini/composio`'s persistence now depends on another zero-consumer,
  not-yet-signed-off package's continued shape.

**Recommendation (not a decision — flag for Coordinator sign-off):** ship
Option A as the in-package default (de-branded, factory-based per the fixes
above) so `@jini/composio` has zero required dependency beyond `@jini/protocol`,
but shape the constructors to accept an *optional* injected
`DbProvider`/`StorageProvider` that, when supplied, is used instead of the
file-based default — the same "own a default, accept an override" shape
`ComposioConnectorProviderOptions` already uses for `curationOverlay`/
`featuredCatalog` above. This avoids a hard dependency while still letting a
host that already wired `@jini/capability-providers` reuse it.

## Phased sequencing

Reordered from the dispatch brief's suggested shape after reading the real
files — persistence needs to land *before* OAuth/execution (Phase 4 reads
credentials and auth-config ids that Phase 2's stores define), not after.

**Phase 1 — types + static data + read-only catalog (no network, no
filesystem writes).** `catalog.ts` (decoupled per above),
`composio-descriptions.ts` (verbatim), the pure static-catalog-building
half of `composio.ts` (`FEATURED_COMPOSIO_CATALOG`,
`DOCUMENTED_COMPOSIO_TOOLKITS`, `buildStaticComposioCatalog`,
`getStaticComposioCatalogDefinitions`, `cloneConnectorDefinition`,
`normalizePersistedConnectorDefinition`/`ToolDefinition`, and every small
pure string-normalization helper). Depends on: `@jini/protocol`'s
`JsonValue` (already exists, no work needed there). Blocks: everything else.

**Phase 2 — config + credential + status persistence (no network calls).**
`composio-config.ts` → `ComposioConfigStore`/`createFileComposioConfigStore`;
`service.ts`'s `ConnectorCredentialStore`/`FileConnectorCredentialStore`/
`InMemoryConnectorCredentialStore`/`ConnectorStatusService` (the persistence/
status half of `service.ts`, independent of `ConnectorService.execute()`
itself). Depends on: Phase 1 (`ConnectorCatalogDefinition`/`ConnectorStatus`
types). Blocks: Phase 4. **This is where the Persistence open question above
must be resolved before writing code** — Option A vs. B changes these
classes' constructor shapes.

**Phase 3 — Composio API client: catalog discovery + hydration (read-only
network calls).** The rest of `composio.ts`'s `ComposioConnectorProvider` —
`listDefinitions`/`getDefinition`/`getHydratedDefinition`/
`getPreviewDefinition`/`refreshCatalog`, the persisted-cache load/save/
refresh-loop machinery, and the raw Composio API helpers
(`request`/`requestJson`/`listAuthConfigs`/`listToolkits`/`listToolsPage`).
Explicitly excludes OAuth (`connect`/`completeConnection`/`disconnect`) and
`execute()` — those need Phase 2's stores fully wired first. Depends on:
Phase 1 (catalog types/static data) + Phase 2 (`ComposioConfigStore` for
reading `apiKey`). Testable today via fetch-mocking (see Open Questions) —
no live API key needed for this phase's own tests.

**Phase 4 — OAuth flow + tool execution.** `composio.ts`'s `connect`/
`prepareAuthConfig`/`completeConnection`/`disconnect`/`execute`/auth-config
resolution-and-creation methods; `service.ts`'s `ConnectorService` class
proper (wiring `provider`+`statusService`+credential store together —
`connect`/`disconnect`/`execute`/`cancelPendingAuthorization`/
`completeComposioConnection`), plus rate limiting, output redaction, and
JSON-schema input validation (all three fully generic, port verbatim).
Depends on: Phase 3. This is the **highest-risk phase for
untested-without-real-credentials** coverage (see Open Questions) — the
actual OAuth round-trip against `backend.composio.dev`'s
`/api/v3.1/connected_accounts/link` and `/api/v3.1/tools/execute/:id`
endpoints can only be verified against Composio's documented API shapes via
mocking, the same constraint this session already named for LLM-provider
live-parity testing elsewhere.

**Phase 5 — HTTP route layer.** Real design work, not mechanical porting
(see the `routes.ts` classification above) — every handler restated against
`@jini/http`'s `defineJsonRoute`/`mountJsonRoute`/`RouteInputContext`/
`Result` idiom, mounted at `/api/composio/*`. Includes: connector list/
status/discovery/detail/connect/oauth-callback/cancel/disconnect routes, the
Composio logo CDN proxy, the config get/put routes, and a minimal unbranded
OAuth-success landing page with an injectable override. Excludes (leave-out,
confirmed above): the `/api/tools/connectors/{list,execute}` agent-tool
exposure routes (depend on OD's `tool-tokens.ts`/`tools/connectors.ts`,
neither in scope) and OD's specific branded HTML. Depends on: Phase 4 for
the OAuth/connect/disconnect routes; the read-only routes (list/status/
discovery/logos/config-get) could theoretically start once Phase 2+3 land,
but shipping the route pack in one piece once Phase 4 is done is simpler and
matches how `xai.ts`/`connectors.ts` were each delivered as a single
route-pack file. A follow-up (not part of this package) is a browser-side
`ConnectorsPort` implementation in `@jini/ui`'s consuming app, per the
already-existing frontend section above.

## Open questions requiring Coordinator/human sign-off

1. **Persistence: Option A (own file store) vs. Option B (delegate to
   `@jini/capability-providers`'s `DbProvider`/`StorageProvider`) vs. the
   hybrid recommended above.** See the "Persistence" section — this changes
   constructor shapes in Phase 2, must be decided before that phase starts.
2. **The `composio-curation.ts` overlay: ship the mechanism as an optional
   hook (recommended above) with zero shipped data, or leave the whole
   concept out of v1 entirely?** If shipped as a hook, does
   `ConnectorToolUseCase` stay a free `string`, or should `@jini/composio`
   avoid inventing any "use case" vocabulary at all and let a host layer its
   own curation entirely outside this package (e.g. by wrapping
   `ConnectorCatalogDefinition[]` after the fact rather than this package
   modeling `curation` as a first-class tool field)?
3. **The `provider === 'open-design'` inference (`catalog.ts:254`,
   `service.ts:272`): parameterize with a `localProviderId` option, or
   delete the inference and make `authentication` required with no
   fallback?** Recommended above: delete it, pending an empirical check that
   none of this port's own shipped static catalog data actually needs the
   fallback (every entry in `FEATURED_COMPOSIO_CATALOG`/
   `DOCUMENTED_COMPOSIO_TOOLKITS` already sets `authentication: 'composio'`
   explicitly, so the inference branch may be provably unreachable from this
   package's own data — confirm empirically before deleting, per this
   repo's "don't claim unreachable without verifying" standing rule).
4. **Naming**: `ComposioConnectorService` vs. keeping `ConnectorService`
   bare (risk: reads as generic next to `@jini/http`'s unrelated
   `Connectors*` exports and the UI package's own `Connector` type, both
   documented above)? This plan recommends prefixing but leaves the final
   call open since it also touches `packages/ui/src/features/connectors/`'s
   existing (already-shipped, already-tested) `Connector`/`ConnectorStatus`/
   `ConnectorTool` vocabulary, which this package should stay compatible
   with in spirit even without a direct dependency.
5. **Testing without a live Composio API key.** No live credentials are
   available for `backend.composio.dev` in this environment — the same
   constraint already on record elsewhere this session for LLM-provider
   live-parity testing. Recommended approach, matching this repo's own
   established precedent (`packages/capability-providers/src/payments.ts`'s
   `StripePaymentsProvider` tests, `packages/registry/src/github-client.ts`'s
   tests, `packages/http/src/xai.ts`'s tests): inject `fetchFn` at the
   constructor boundary and mock `Response` objects shaped like Composio's
   *real, documented* API responses (fetch Composio's own API docs during
   Phase 3/4 implementation — WebFetch, not memory — the same
   "verified-against-real-docs, not recalled" discipline `StripePaymentsProvider`
   and `GithubApiRegistryClient` already used). A true end-to-end OAuth
   round-trip against the real Composio backend is not verifiable in this
   environment and should be documented as a permanent, accepted gap in the
   eventual `source-map.md`, the same way `@jini/registry`'s
   `GithubRegistryClient` documented "there is nothing to harden here until
   a real implementation is built" for an analogous untestable-without-
   live-creds boundary.
6. **`composio-descriptions.ts`'s ~150-entry static data will drift** as
   Composio adds/renames/retires toolkits — not this port's problem to
   solve (it's a snapshot, same as OD's), but worth a `// last verified
   against Composio's toolkit list on <date>` comment so a future maintainer
   knows it's a point-in-time snapshot, not a live source of truth.
7. **`DOCUMENTED_COMPOSIO_TOOLKITS`'s ~150-slug list has the identical
   staleness property** — same recommendation.
8. **Should the leave-out `/api/tools/connectors/{list,execute}` capability
   (agent-tool exposure of the connector catalog, gated by *something*) get
   a simplified, ungated equivalent later, and if so, does it belong in
   `@jini/composio`, `@jini/agent-runtime`, or `@jini/daemon`?** Not
   resolved here — flagged because `ConnectorService.execute()` already
   provides the underlying capability generically; only the
   agent-tool-listing/gating wrapper is missing, and that wrapper's natural
   home is arguably wherever Jini's generic agent-tool-registration concept
   already lives (`@jini/agent-runtime`), not a vendor-specific package.
9. **UNLOCKED.md admission.** Once Phase 1 lands, `@jini/composio` needs an
   entry in `/Users/la/Desktop/Programming/Jini/UNLOCKED.md`'s manifest
   (`status: "incubating"`, `consumers: []`, `signOff: "PENDING"`, a `note`
   citing this plan doc), per the 2026-07-19 swarm-consensus package-admission
   convention every other new package here follows. Not part of this
   plan's own deliverable — noted so whoever starts Phase 1 doesn't skip it.
