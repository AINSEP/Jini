# @jini-ai/commerce

Opt-in catalog contracts, checkout and webhook-inbox services, SQL repositories, payment providers,
payment/refund state machines, the sample store runtime, and a read-only React Payments overview.
Moved from Tovu for future reuse; Tovu keeps commerce off.

Importing this package never activates a provider, registers a route/tool/panel, seeds products, or
creates/reconciles tables. Payment and store activation require an injected `kernel` and an awaited
`prepareStorage` port. The host owns schema declarations, provenance, snapshots and recovery.
Catalog repositories borrow the six existing `commerce_*` table contracts without owning DDL.

| Export | Ownership |
| --- | --- |
| `@jini-ai/commerce` | Catalog contracts, checkout, inbox, status and storefront mapping |
| `@jini-ai/commerce/repo` | Shared Kysely queries and row mapping |
| `@jini-ai/commerce/payments` | Providers, registry, credentials, charge/refund/webhook lifecycle |
| `@jini-ai/commerce/store` | Sample stock/checkout runtime |
| `@jini-ai/commerce/http` | Explicit raw-body payment webhook registrar |
| `@jini-ai/commerce/tools` | Explicit read-only status contributor |
| `@jini-ai/commerce/react` | Unregistered, read-only Payments overview; locale injected as a prop |

The package is separate because commerce owns financial domain invariants rather than database,
HTTP, UI or agent infrastructure. It reuses `@jini-ai/db/kernel`, `@jini-ai/core/primitives`, the
core tool registration builder, CMS authorization and UI dictionary translation.

Public runtime helpers use object inputs and an options object. A host constructing environment
credentials can pass `{ prefix: "TOVU_PAYMENT" }` to preserve its existing namespace; the generic
default is `JINI_PAYMENT`. Credentials remain outside portable databases.

An opting-in HTTP host must register the webhook handler before a blanket JSON parser: signatures
cover original bytes, not reserialized JSON. Provider errors are returned through typed results;
unexpected exceptions receive a fixed 500 response without logging credential-bearing errors.

Runtime tests use real kernels and fixed test-only schemas. CMS schema, snapshots and cross-table
foreign-key integration tests remain in Tovu. See [source-map.md](source-map.md) for the extraction
boundary and coordinator build requirements. Tests and builds were not run during this dispatch.
