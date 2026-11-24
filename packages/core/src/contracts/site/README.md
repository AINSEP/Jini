# `@jini-ai/core/contracts/site/*` — site seam contracts

Types only. Each module here owns declarations that a host and one or more Jini packages both
read, so neither has to import the other's implementation to name a shape. Runtime values,
classes and functions never live under `src/contracts` (they stay with their owning package or
the host); a type that needs a third-party type (Kysely, Express, React, Playwright, Node
`Buffer`) does not come here either — its users declare the structural slice they read.

## Wiring

**Needs injected:** nothing. These modules are declarations; a host implements the ports
(`CommentsProviderAdapter`, `ExternalMcpOAuthDeps`, `DeviceAuthorizationStore`,
`AdminSurfaceConnectionsHost`, `PublicDnsResolver`, `RequestRouter`, `CommercePaymentRuntimePort`, …)
and passes them into the owning package's functions through their existing args objects.

**Provides:** one subpath per seam, e.g. `./contracts/site/capability-providers-comments`,
`./contracts/site/seo-content-analysis`, `./contracts/site/ui-sections`,
`./contracts/site/admin-surfaces-connections`, `./contracts/site/api-connections-hosted-mcp`,
`./contracts/site/media-providers-catalog`, `./contracts/site/core-custom-credential-categories`
(see `package.json` `exports` for the full list).

**Host wiring example:**

```ts
import type { CommentsSelectionStorePort } from "@jini-ai/core/contracts/site/capability-providers-comments";
import { createCommentsProviderRegistry } from "@jini-ai/capability-providers/comments";

// The host implements the port over its own settings table…
const selections: CommentsSelectionStorePort = createHostCommentsSelectionStore({ db });
// …and passes it through the package's existing args object.
const registry = createCommentsProviderRegistry({ selections });
// The host keeps its runtime (DB, renderer, product copy); only the shapes are shared.
```

**Never imports:** any other `@jini-ai/*` package, any third-party module, or anything with a
runtime effect. Only `import type` from sibling core modules (relative `.js` paths).

When a package moves its declarations here, it imports them back from core and keeps a
deprecated `export type { … } from "@jini-ai/core/contracts/site/<seam>"` on its public entry until
the next major, so hosts can repoint at their own pace.

Why this split exists: see the host repository's architecture ADR on Jini/Tovu ownership
(`plans/P12-adr-drafts.md`, "New files under Core's `src/contracts` hold types only").
