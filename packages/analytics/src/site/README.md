# analytics/site

Host-facing analytics seams moved from a site host: the site ports and error classes
(`ports.ts`), the agent tool catalog (`agent-tools.ts`), and the visitor/browser analytics
contracts the public beacon route is typed against (`contracts.ts`). Types and data only —
ingestion, normalization and the buffer stay in the package root (`../ingest.ts`, `../salt.ts`).

## Wiring

- **Needs injected:** nothing at import time. `VisitorAnalyticsDeps<Request>` lists the host ports
  a route receives: `tracker` / `visitorTracker` (`Tracker`), `idGen`, `visitorAnalyticsProof`
  (returns a `ConsentAnalyticsProof` or `undefined`) and `visitorAnalyticsDeliveryAllowed`. All are
  optional; a missing proof or id generator denies capture. `BrowserAnalyticsSource` is the host's
  per-surface (`site` | `admin`) list of `BrowserAnalyticsContribution`s.
- **Provides:** `./site/contracts` (types), `./site/ports`, `./site/agent-tools`.

```ts
import type { VisitorAnalyticsDeps, BrowserAnalyticsSource } from "@jini-ai/analytics/site/contracts";

const browserAnalytics: BrowserAnalyticsSource = ({ surface }) => providers.forSurface(surface);
const visitor: VisitorAnalyticsDeps<Request> = {
  tracker, idGen,
  visitorAnalyticsProof: ({ request }) => consent.proofFor(request),
  visitorAnalyticsDeliveryAllowed: ({ proof }) => consent.stillValid(proof),
};
```

- **Must never import:** a host module, an HTTP framework type, a logger, or another `@jini-ai/*`
  package other than `@jini-ai/core` (seam types come from `@jini-ai/core/contracts/site/*`).
  Package boundaries: `docs/decisions/DR-005-portable-package-boundaries.md`.
