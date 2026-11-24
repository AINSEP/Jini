# comments screen

The admin comments screen pieces `@jini-ai/admin` owns.

## Wiring

- `api/comments-api.ts` — `createCommentsApi({ request, workspaceId })`: the host injects its authenticated admin `request` and the workspace id every path is scoped to. The host binds one instance and its hooks read that.
- `index.ts` — `Comments`: the host-mounted panels. The host injects, as required props, `useModulePanel` (its custom hook that mounts a bound `comments.*` admin-module page inside the host admin scope) and `ModuleLoading` (the loading view, shown until that scope exists). Stylesheets the screens rely on are the host's to load.
