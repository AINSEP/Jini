# forms screen

The admin forms screen pieces `@jini-ai/admin` owns.

## Wiring

- `api/forms-api.ts` — `createFormsApi({ request, workspaceId })`: the host injects its authenticated admin `request` and the workspace id every path is scoped to. The host binds one instance and its hooks read that.
