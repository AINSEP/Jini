# widgets admin route specs

Framework-neutral JSON route specs for the admin `widgets` surface (SPEC-043): the instance
library (list, get, create, update, trash) and the region reads/bind (regions list, region get,
region bind). Each spec is built with `defineJsonRoute` from `@jini-ai/core/contracts/server`.
The widgets domain's own errors map to refusals through `../../http/widgets.ts`
(`rejectWidgetError`); anything else is rethrown unchanged for the host's error port.

Architecture and the reasoning behind injected route deps:
[`ADS-memory/reports/jini-port/extraction-plan.md`](../../../../../../ADS-memory/reports/jini-port/extraction-plan.md).

## Wiring

**Provides** (one module each): `widgetListRoute`, `widgetGetRoute`, `widgetCreateRoute`,
`widgetUpdateRoute`, `widgetTrashRoute`, `widgetRegionsListRoute`, `widgetRegionGetRoute`,
`widgetRegionBindRoute`.

**Needs injected** (each route's own small deps type — pass only these fields, never a whole
host deps bag): `WidgetListRouteDeps`, `WidgetGetRouteDeps`, `WidgetCreateRouteDeps`,
`WidgetUpdateRouteDeps`, `WidgetTrashRouteDeps`, `WidgetRegionsListRouteDeps`,
`WidgetRegionGetRouteDeps`, `WidgetRegionBindRouteDeps`. The write routes take a
`widgetsDeps()` / `regionDeps()` factory, called once per request, so the host keeps building
its service deps (entry locks, host ports, outbox) exactly as before. The host's ports supply the
workspace guard, the authenticated principal (`{ id }`), the `widgets.*` authorize port used by
the region routes, and the error port for non-widgets failures (e.g. a plugin hook refusal).

```ts
import { widgetCreateRoute } from "@jini-ai/cms/admin-http/routes/widgets/create";

mountAdminJsonRoute({
  app,
  spec: widgetCreateRoute,
  deps: { workspaceId, authorize, widgetsDeps: () => buildWidgetsDeps(hostDeps) },
});
```

**Never imports**: `express`, `@jini-ai/http-kit`, any other non-core Jini package, or host code.
