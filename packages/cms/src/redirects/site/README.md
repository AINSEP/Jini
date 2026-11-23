# redirects/site

Host-facing wiring for Redirects: binds the redirect resolver into a routing instance's
`pre_content` / `post_content` resolve phases. Resolution and the Location gate stay in
`../resolver.ts` and `../target-gate.ts`.

## Wiring

- **Needs injected:** `registerResolvePhase` (`RegisterRedirectsResolvePhase` =
  `Routing["registerResolvePhase"]` from `@jini-ai/cms/routing`) — the bound function of the ONE
  `createRouting(...)` instance the host shares across its composition roots — plus either the
  resolver ports (`repo`, `matcher`, `originRegistry`, `reservedSegments`; optional `hits`) or a
  ready `resolver`. All go on `RegisterRedirectsPhaseHandlersDeps`.
- **Provides:** `registerRedirectsPhaseHandlers(required, optional)` → a disposer that removes
  exactly this registration. Every call claims one module-private owner, so the newest
  composition supersedes older ones; a stale disposer never revokes a newer registration.

```ts
import { createRouting } from "@jini-ai/cms/routing";
import { registerRedirectsPhaseHandlers } from "@jini-ai/cms/redirects/site/phase-handler";

const routing = createRouting({ ports: { isLive, reportPhaseError } }); // once per process
const dispose = registerRedirectsPhaseHandlers(
  { repo, matcher, originRegistry, reservedSegments, registerResolvePhase: routing.registerResolvePhase },
  { hits: { outbox, clock, idGen } },
);
onStoreClose(dispose); // revoke with the store the resolver reads
```

- **Must never import:** a host routing singleton, any host module, a logger or an HTTP framework.
  Same-package code is imported relatively. Trust rules: `docs/decisions/DR-001-verified-origin-trust.md`.
