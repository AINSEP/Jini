# comments screen

The admin comments screen pieces `@jini-ai/admin` owns.

## Wiring

- `api/comments-api.ts` — `createCommentsApi({ request, workspaceId })`: the host injects its authenticated admin `request` and the workspace id every path is scoped to. The host binds one instance and its hooks read that.
