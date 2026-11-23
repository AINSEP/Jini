# widgets screen

The admin widgets screen pieces `@jini-ai/admin` owns.

## Wiring

- `api/widgets-api.ts` — `createWidgetsApi({ request, workspaceId })`: the host injects its authenticated admin `request` (method, path, body; it owns the base URL, auth, retries and error decoding) and the workspace id every path is scoped to. The host binds one instance and its hooks read that.
- `index.ts` — `WidgetsLibrary`, `WidgetRegions`, `WidgetRegionEditor({ regionKey })` and `WidgetInstanceEditor({ widgetId, widgetType })`: the host-mounted panels. The host injects, as required props, `useModulePanel` (its custom hook that mounts a bound `widgets.*` admin-module page inside the host admin scope) and `ModuleLoading` (the loading view (`{ pageId }` selects the per-page copy), shown until that scope exists). Stylesheets the screens rely on are the host's to load.
