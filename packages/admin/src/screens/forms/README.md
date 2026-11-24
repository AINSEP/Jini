# forms screen

The admin forms screen pieces `@jini-ai/admin` owns.

## Wiring

- `api/forms-api.ts` — `createFormsApi({ request, workspaceId })`: the host injects its authenticated admin `request` and the workspace id every path is scoped to. The host binds one instance and its hooks read that.
- `index.ts` — `FormsList` and `FormEditor({ formId, tab })`: the host-mounted panels. The host injects, as required props, `useModulePanel` (its custom hook that mounts a bound `forms.*` admin-module page inside the host admin scope) and `ModuleLoading` (the loading view (`{ editor? }` selects the editor copy), shown until that scope exists). Stylesheets the screens rely on are the host's to load.
