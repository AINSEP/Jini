# widgets admin route specs

Framework-neutral JSON route specs for the admin `widgets` surface (SPEC-043): the instance
library (list, get, create, update, trash), the region reads and writes (regions list, region get,
region bind, region placements PUT) and the server-side embed mutations on a host entry's body
(embed insert, remove, reorder), and the four AI tool routes (`widgets.place`, `widgets.create`,
`widgets.remove`, `widgets.diagnose` — `agent-tools-*.ts`, SPEC-043 REQ-35/44). Each spec is built with `defineJsonRoute` from `@jini-ai/core/contracts/server`.
The widgets domain's own errors map to refusals through `../../http/widgets.ts`
(`rejectWidgetError`); anything else is rethrown unchanged for the host's error port.

Architecture and the reasoning behind injected route deps:
[`ADS-memory/reports/jini-port/extraction-plan.md`](../../../../../../ADS-memory/reports/jini-port/extraction-plan.md).

## Wiring

**Provides** (one module each): `widgetListRoute`, `widgetGetRoute`, `widgetCreateRoute`,
`widgetUpdateRoute`, `widgetTrashRoute`, `widgetRegionsListRoute`, `widgetRegionGetRoute`,
`widgetRegionBindRoute`, `widgetRegionMutatePlacementsRoute` (plus its pure
`parseWidgetRegionPlacements` validator), `widgetEmbedInsertRoute`, `widgetEmbedRemoveRoute`,
`widgetEmbedReorderRoute`, and the tool specs `widgetPlaceToolRoute`, `widgetCreateToolRoute`,
`widgetRemoveToolRoute`, `widgetDiagnoseToolRoute`.

**Needs injected** (each route's own small deps type — pass only these fields, never a whole
host deps bag): `WidgetListRouteDeps`, `WidgetGetRouteDeps`, `WidgetCreateRouteDeps`,
`WidgetUpdateRouteDeps`, `WidgetTrashRouteDeps`, `WidgetRegionsListRouteDeps`,
`WidgetRegionGetRouteDeps`, `WidgetRegionBindRouteDeps`, `WidgetRegionMutatePlacementsRouteDeps`
(`widgetBindingRepo.findByRegion` + `regionDeps()`), `WidgetEmbedInsertRouteDeps`,
`WidgetEmbedRemoveRouteDeps`, `WidgetEmbedReorderRouteDeps` (each `widgetsDeps()` returning the
embed service deps), `WidgetPlaceToolRouteDeps` / `WidgetCreateToolRouteDeps` (`workspaceId`,
`widgetBindingRepo.findByRegion`, `entryRepo.findById`, `idGen.newId`, `widgetsDeps()`,
`regionDeps()`), `WidgetRemoveToolRouteDeps` (the same without `idGen`) and
`WidgetDiagnoseToolRouteDeps` (`entryRepo.findById`, `entryRefsRepo.findByTarget`). The write routes take a
`widgetsDeps()` / `regionDeps()` factory, called once per request, so the host keeps building
its service deps (entry locks, host ports, outbox) exactly as before. The host's ports supply the
workspace guard, the authenticated principal (`{ id }`), the `widgets.*` authorize port used by
the region routes and `widgets.diagnose`, and the error port for non-widgets failures (e.g. a
plugin hook refusal). `widgets.create` keeps the created widget in a placement-failure body: a
widgets domain error is refused with that body directly, anything else is thrown as
`WidgetToolPlacementFailedError` (`widget` + `cause`), and the host's error port answers it with
`widgetToolPlacementFailedBody({ widget, errorBody })` around its own envelope for `cause`.

```ts
import { widgetCreateRoute } from "@jini-ai/cms/admin-http/routes/widgets/create";
import { widgetRegionMutatePlacementsRoute } from "@jini-ai/cms/admin-http/routes/widgets/region-mutate-placements";

mountAdminJsonRoute({
  app,
  spec: widgetCreateRoute,
  deps: { workspaceId, authorize, widgetsDeps: () => buildWidgetsDeps(hostDeps) },
});

mountAdminJsonRoute({
  app,
  spec: widgetRegionMutatePlacementsRoute,
  deps: { workspaceId, authorize, widgetBindingRepo, regionDeps: () => buildWidgetsRegionDeps(hostDeps) },
});

mountAdminJsonRoute({
  app,
  spec: widgetPlaceToolRoute, // from "@jini-ai/cms/admin-http/routes/widgets/agent-tools-place"
  deps: { workspaceId, authorize, widgetBindingRepo, entryRepo, idGen, widgetsDeps: () => buildWidgetsDeps(hostDeps), regionDeps: () => buildWidgetsRegionDeps(hostDeps) },
});
```

**Never imports**: `express`, `@jini-ai/http-kit`, any other non-core Jini package, or host code.
