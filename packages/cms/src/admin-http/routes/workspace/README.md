# Workspace admin routes

Server-framework-neutral `defineJsonRoute` specs for the workspace admin surface:
`GET /api/admin/v1/workspaces` (`list.ts`), `GET|PATCH|DELETE /api/admin/v1/workspaces/:workspaceId`
(`get.ts`, `update.ts`, `delete.ts`), plus the wire projection in `../../http/workspace.ts`.
`POST /api/admin/v1/workspaces` (create) is still host-owned until the outbox runtime has a neutral owner.

## Wiring

- **Needs injected** — per-route deps `WorkspaceAdminRouteDeps` (`workspaceId`, `workspaceRepo: WorkspaceRepoPort`),
  and the host's `JsonRoutePorts`: `workspace` (the `:workspaceId` must equal the boot-wired id, else the
  host's 404, before auth), `authenticate` (the session principal), `authorize` (answers the
  `workspace.manage` / `entityType: 'workspace'` request; a refusal is a thrown `RouteRefusalError`),
  `onError` (writes a `RouteRefusalError` verbatim, maps anything else to the host's redacted 500).
- **Provides** — `workspaceListRoute`, `workspaceGetRoute`, `workspaceUpdateRoute`, `workspaceDeleteRoute`
  (204 on success; refuses the bound workspace with 409 `BOUND_WORKSPACE`), and the pure helpers
  `parseWorkspaceUpdateBody`, `workspaceUpdateFailure`, `deleteWorkspaceUnlessBound`, `deleteWorkspaceFailure`.
- **Host wiring**:

  ```ts
  import { workspaceGetRoute } from '@jini-ai/cms/admin-http/routes/workspace/get';
  // deps: only the route's own fields plus the two port fields — never the host's whole deps bag.
  const portDeps = { workspaceId: deps.workspaceId, authorize: (p) => deps.authorize(p) };
  mountAdminJsonRoute(
    { app, spec: workspaceGetRoute, deps: { ...portDeps, workspaceRepo: deps.workspaceRepo } },
    { failure: { operation: 'routes/workspace/get', code: 'INTERNAL_ERROR' } },
  );
  ```
- **Must never import** — a server framework (Express types), a host's deps bag or composition root,
  host logging/failure formatters, or another package's implementation (core types and
  `RouteRefusalError` only).

Why these boundaries: [DR-005](../../../../../../docs/decisions/DR-005-portable-package-boundaries.md).
