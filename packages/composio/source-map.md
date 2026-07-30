# `@jini/composio` — provenance

**Incubating package; not in the locked §3 package set.** The approved
pre-implementation plan is
`ADS-memory/reports/composio-port-plan-2026-07-23.md`.

## Origin

Ported from Open Design commit
`958cc8871a9dace22c6c50f07a347c844892ae48` on `main`, using the real clone at
`/Users/la/Desktop/Programming/OSS-Repos/open-design`:

| Jini file | Open Design origin | Transformation |
|---|---|---|
| `src/catalog.ts` | `apps/daemon/src/connectors/catalog.ts` | Replaced the product-owned bounded JSON schema dependency with `@jini/protocol`'s `JsonValue`; widened curation use cases to host-defined strings; made authentication explicit and removed the `provider === 'open-design'` inference. |
| `src/composio-descriptions.ts` | `apps/daemon/src/connectors/composio-descriptions.ts` | Vendor toolkit metadata copied without OD product data; module provenance comment updated. |
| `src/composio-config.ts` | `apps/daemon/src/connectors/composio-config.ts` | Replaced the module-global `.od` path with an instance-scoped `ComposioConfigStore` factory and injected file path. |
| `src/composio.ts` | `apps/daemon/src/connectors/composio.ts` | Required `userId`; injected config store, `fetchFn`, clock, cache path, base URL, user agent, featured catalog, and optional curation overlay; removed singletons and OD paths/copy; updated connected-account endpoints to the current official v3 API while retaining the official v3.1 catalog/auth-config/tool endpoints. |
| `src/service.ts` | `apps/daemon/src/connectors/service.ts` | Renamed the public service to `ComposioConnectorService`; injected the provider and stores; renamed project-shaped execution keys to neutral scope/session keys; retained validation, redaction, and rate limits. |

## Deliberate leave-outs

- `apps/daemon/src/connectors/composio-curation.ts`: all shipped entries were
  editorial data for OD's personal daily digest. The optional curation
  injection mechanism remains, with no product data.
- `apps/daemon/src/connectors/routes.ts`: HTTP and browser wiring are Phase 5
  of the approved plan and explicitly outside this package slice.
- OD's branded OAuth-success HTML and
  `/api/tools/connectors/{list,execute}` tool-token routes.
- Any dependency on `@jini/http`, `@jini/ui`,
  `@jini/capability-providers`, `@jini/daemon`, or `@jini/node-host`.

## Official Composio API verification

The request and contract tests were checked against Composio's official API
reference on 2026-07-23:

- `GET /api/v3.1/toolkits`
- `GET /api/v3.1/tools` with cursor pagination and
  `toolkit_versions=latest`
- `GET/POST /api/v3.1/auth_configs`
- `POST /api/v3/connected_accounts/link`,
  `GET/DELETE /api/v3/connected_accounts/{id}`
- `POST /api/v3.1/tools/execute/{tool_slug}`

Manual tool execution sends an explicit `version: "latest"` because the
current reference requires a known toolkit version.

## Persistence and security

The package owns debranded file adapters behind injected store interfaces.
Secret-bearing config and credential files use directory mode `0700`, file
mode `0600`, no-follow regular-file reads, ownership-checked cross-process
exclusive locks, and same-directory atomic rename. The same lock covers
catalog-cache mutation. External response data is treated as untrusted,
structurally bounded, redacted for secret-like keys, and serialized-size
capped before returning through the service.

Catalog discovery is metadata-only; aggregate schema hydration is rejected
before provider I/O. Tool schemas are obtained through bounded per-connector
preview and current-hydration paths. Provider-discovered tools are display-only
unless their exact identifiers are package- or host-curated. Execution uses
strict current hydration, so a tool-list failure denies execution and a
successful response that omits a static tool revokes its authority. Execute
identifiers and structurally bounded input are normalized before hydration or
account I/O; Composio parameter maps are converted to strict object schemas;
schema evaluation-budget exhaustion is a hard denial.

Connected-account user, connector, toolkit, auth-config, account, and active
status are revalidated before execution or disconnection. `ACTIVE` OAuth and
provider-reported connected state require matching credential evidence.
Wrong-user or wrong-connector credentials are ignored without exposing account
labels. Direct Composio credential injection is rejected by the service.

## Verification

The unit and injected provider/service contract suites cover security
boundaries, provider wire shapes, and persistence across 8 files.
`vitest.config.ts` includes every `src/**/*.ts` module with no
package-specific source exclusions and enforces 100% statements, branches,
functions, and lines. The coverage work retained provider wire aliases,
recovery paths, schema checks, output protection, cache bounds, and ownership
validation; it did not use ignore comments or metric-driven capability
deletion.

## Accepted verification gap

No live Composio project API key or OAuth credentials are available in this
environment. Unit and contract tests use injected `fetchFn` responses matching
the official wire shapes. A real hosted OAuth redirect, account ownership
round-trip, and tool execution remain an explicit live-credential E2E gap.
