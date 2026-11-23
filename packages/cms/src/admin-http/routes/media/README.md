# admin-http/routes/media

Server-neutral `defineJsonRoute` specs for the admin media routes. Why the engine owns route specs
and the host owns mounting: [`ADS-memory/reports/jini-port/extraction-plan.md`](../../../../../../ADS-memory/reports/jini-port/extraction-plan.md).

## Wiring

**Provides:** `mediaGetProvidersRoute` (GET `…/media/providers`), `mediaDeleteRoute` (DELETE
`…/media/:mediaId`), `mediaTrashRoute` (POST `…/media/:mediaId/trash`), plus `shared.ts`
(`authorizeMedia`, `principalOf`, `rejectMediaNotFound`, `MediaRoutePrincipal`).

**Needs injected** (each route's own deps type, nothing wider):
- `MediaGetProvidersRouteDeps`: `workspaceId`, `getMediaProviderCredentials` (host store + sealer bound in).
- `MediaDeleteRouteDeps`: `workspaceId`, `purgeMedia` (host's reference-checking purge), `forgetRemovedMedia`.
- `MediaTrashRouteDeps`: `workspaceId`, `mediaRepo.findById`, `removeMedia` (`MediaTrashRemove`), `clock.nowIso`, `toMediaResponse` (host DTO).
- Host ports: `workspace`, `authenticate` (sets the `{ id }` principal), `authorize`, `onError`
  (writes a thrown `RouteRefusalError` body as-is, anything else as the host's private 500).

```ts
import { mountJsonRoute } from "@jini-ai/http-kit";
import { mediaTrashRoute } from "@jini-ai/cms/admin-http/routes/media/trash";

mountJsonRoute({ app, spec: { ...mediaTrashRoute, ports: hostAdminPorts }, deps: {
  workspaceId, mediaRepo: { findById: (i) => repo.findById(i) },
  removeMedia: (i) => trash.remove(i), clock: { nowIso: () => clock.nowIso() },
  toMediaResponse: ({ media }) => toAdminDto(media),
} });
```

Bind collaborators per request (closures over the host's deps), never copy them at mount time:
host tests replace collaborators after registration.

**Never imports:** Express or any server-framework type, `@jini-ai/http-kit`, `@jini-ai/db`, host
modules, product copy. Refusals are thrown `rejectRoute`/`RouteRefusalError`; unmapped failures are
rethrown for the host's error port.
