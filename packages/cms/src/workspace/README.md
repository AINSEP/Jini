# workspace

The Workspace domain: create/update/delete commands, the repository port and in-memory repo, and
its agent-tool surface. A v1 install has exactly one addressable workspace, fixed at composition
as `workspaceId`.

| file | what it is |
|---|---|
| `agent-tools.ts` | The fixed catalog: `workspace_get` (optional own `workspaceId`), `workspace_update`, `workspace_list`, and the never-wired `workspace_create`/`workspace_delete`. |
| `tool-registrations.ts` | `buildWorkspaceRegistrations`: the two reads and the rename. Both reads share one permission-gated read of the boot-wired row; any other id is refused, and `workspace_list` never calls `workspaceRepo.list()`. |
| `site/` | The site profile's SQLite repo binding and its tool contributor (see `site/README.md`). |

## Wiring

Architecture: [DR-005 portable package boundaries](../../../../docs/decisions/DR-005-portable-package-boundaries.md).

**Needs injected** (`WorkspaceToolDeps`): `authorize`, the boot-wired `workspaceId`, and a
`workspaceRepo` implementing `WorkspaceRepoPort`. Optional `readToolId` names the read tool in
stale-version guidance.

**Host binding today**: the host's tool-catalog manifest installs `contributeWorkspaceTools()` from
`site/tool-registrations.ts`, passing its route deps; its admin routes use the commands directly.
