# widgets screen

The admin widgets screen pieces `@jini-ai/admin` owns.

## Wiring

- `api/widgets-api.ts` — `createWidgetsApi({ request, workspaceId })`: the host injects its authenticated admin `request` (method, path, body; it owns the base URL, auth, retries and error decoding) and the workspace id every path is scoped to. The host binds one instance and its hooks read that.
