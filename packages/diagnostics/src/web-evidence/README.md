# `web-evidence`

Observes what a page actually serves: the bounded body reader, cookie shapes, same-origin path
guards, the Playwright-backed page evidence collector, the own-site loopback render
(`published-page`, `site-path-policy`), and the guarded fetch of the site's own live copy
(`live-url`).

## Wiring

Architecture: [DR-005 portable package boundaries](../../../../docs/decisions/DR-005-portable-package-boundaries.md).

**Injected by the host** (on the existing `deps` objects; nothing is imported from the host):

- `reservedSegments` (`FetchPublishedPageDeps`, `resolveSitePath({ raw, base, reservedSegments })`)
  — the host's reserved first path segments (e.g. `admin`, `api`), taken from its routing
  module's `RESERVED_SEGMENTS`. The host stays the one owner of its URL-space policy; this
  folder only refuses what it is handed.
- `createSiteApp` (`FetchPublishedPageDeps`, `openLoopbackSiteServer`) — the host's own site app
  factory, typed as Node's `RequestListener`. A real framework app satisfies it structurally;
  no server-framework type is named here, and the tests use a plain `node:http` listener.
- `trackFetch` (`FetchPublishedPageDeps`, type `PublishedPageFetchTracker`) — wraps the loopback
  transport as one outbound span. The host passes `trackFetch` from
  `@jini-ai/diagnostics/observability`; it is injected so this folder stays outside the
  observability isolation domain. `observability` stays optional: without it the tracker gets
  the no-op port.

- `reservedSegments` and `isEgressRefusal` (`FetchLiveUrlDeps`, `fetchLiveUrl`) — the same
  reserved first segments, plus a predicate recognizing the host egress guard's refusal error.
  Only that error's `callerSafeMessage` reaches the model; every other failure keeps its identity.
  `httpClient` is the structural `LiveHttpClient` slice (`send(HttpRequest)` from
  `@jini-ai/core/primitives`); the host passes its shared guarded client with the live-page
  egress policy.
- `selectConnectedDestination` (`LiveOriginPolicy`, `listKnownLiveOrigins`) — the host's
  publish-peer rule for which unkeyed peer is the connected destination. The returned row is
  compared by identity against the rows the peer repository returned, so it must be one of them.
  `publishContentPeerRepo` and `publishHistoryStore` are structural read slices
  (`LivePeerRepo`, `LivePublishHistory`); `originRegistry` is core's verified-origin port.

**Bound by**: the host's site-inspection tool registrations (the `fetch_published_page` tool
binds `reservedSegments` and `trackFetch` onto its route deps) and its consent composition root
(the privacy-page render), plus its tool catalog for `openLoopbackSiteServer`. The `fetch_live_url` tool
registration binds `reservedSegments` and `isEgressRefusal` in its handler and
`selectConnectedDestination` where its tool contributor builds `listKnownOrigins`.

```ts
import { fetchPublishedPage } from "@jini-ai/diagnostics/web-evidence/published-page";
import { trackFetch } from "@jini-ai/diagnostics/observability";

const page = await fetchPublishedPage(
  { deps: { createSiteApp, observability, reservedSegments: RESERVED_SEGMENTS, trackFetch }, input: { path: "/privacy" } },
  { maxBytes: 50_000 },
);
```
