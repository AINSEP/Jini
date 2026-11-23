# redirects/site

Host-facing wiring for Redirects: binds the redirect resolver into a routing instance's
`pre_content` / `post_content` resolve phases, binds the host's tool metadata around the seven
redirects agent tools (`tool-registrations.ts`), and fills the host's repo-backed publish-content
factory with the `redirect` type's config (`publish-content.ts`). Resolution and the Location gate stay in
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

- **Tools — needs injected:** `toolMetadata` (`ToolMetadataById`: search vocabulary and the
  `redirects_tombstone` confirmation policy) and `hostReads` (`HostReadVocabulary`), both REQUIRED on
  `RedirectsToolHostPolicy`. **Provides:** `contributeRedirectsTools(policy)` → a
  `ToolContributor<RedirectsPackageToolDeps, AssistantSurfaceDeps>`, and
  `buildRedirectsRegistrations({ deps, toolMetadata, hostReads })` for direct callers. The host's
  composition root binds both at its tool-catalog manifest.
- **Publish — needs injected:** `createRepoPublishHandler` (the host's repo-backed publish-handler
  factory, narrowed to `RedirectRepoPublishConfig`; its return type is the host's contributor) and
  `redirectsTable` (the host's physical table name for the coverage claim). **Provides:**
  `contributeRedirectPublish({ createRepoPublishHandler, redirectsTable })` and `redirectNaturalKey`.
  Ports are read from `deps.ports.redirect` (`RedirectPublishDeps`); absent until the host wires them.

```ts
import { contributeRedirectsTools } from "@jini-ai/cms/redirects/site/tool-registrations";
import { contributeRedirectPublish } from "@jini-ai/cms/redirects/site/publish-content";

contributions.contributors.register({ contribution: contributeRedirectsTools({ toolMetadata, hostReads }) });
registerPublishContentContributor({ contributor: contributeRedirectPublish({ createRepoPublishHandler, redirectsTable }) });
```

- Package boundary rules: `docs/decisions/DR-005-portable-package-boundaries.md`.
- **Must never import:** a host routing singleton, any host module, a logger or an HTTP framework.
  Same-package code is imported relatively. Trust rules: `docs/decisions/DR-001-verified-origin-trust.md`.
