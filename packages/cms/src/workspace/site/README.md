# workspace/site

The site profile's SQLite binding of the workspace repository: `SqliteWorkspaceRepo`, the one
Kysely query body from `../sql` (`SqlWorkspaceRepo`) pinned to the site profile's `workspaces`
table (`WORKSPACE_TABLES`).

| file | what it is |
|---|---|
| `repo.sqlite.ts` | `SqliteWorkspaceRepo<TStore>` and `WORKSPACE_TABLES`. |
| `tool-registrations.ts` | `contributeWorkspaceTools()`: the site's tool contributor — binds `@jini-ai/core/tool-metadata/workspace` and the model-facing error allowlist to `../tool-registrations.ts`'s registrations, naming the host-injected `readToolId` in version-conflict guidance. |
| `__tests__/tool-registrations.test.ts` | The contributor's wired ids, list/get-by-id reads, `WORKSPACE_NOT_FOUND` refusal and version guidance. |
| `__tests__/repo.sqlite.characterization.test.ts` | The repo's behaviour (optimistic update, slug lookup, insertion-order list, roster lock first) on every dialect, through the injected `kernelFor`. |

## Wiring

Architecture: [DR-005 portable package boundaries](../../../../../docs/decisions/DR-005-portable-package-boundaries.md).

**Needs injected** (constructor args)
- `store` — whatever handle the host holds for a site's content database (its content kernel or
  its db handle). This module never names its type.
- `kernelFor({ store })` — the host's own eraser from that handle to the schema-erased storage
  kernel the SQL body runs on.

**Host binding today**: the host's website composition roots (its site deps and peer-site reads)
construct `new SqliteWorkspaceRepo({ store: kernel, kernelFor: schemaErasedKernel })`, passing their
content-kernel eraser. The host's dialect/lost-update tests import `WORKSPACE_TABLES` from here.

**Must never import**: host platform/db modules, Kysely runtime, a concrete driver.

**Tool contributor** (`tool-registrations.ts`): needs the existing `WorkspaceToolDeps`
(`authorize`, `workspaceId`, `workspaceRepo`) at `build(deps)` time, nothing else. The host's
tool-catalog manifest (its composition root) installs it with its other first-party contributors;
the host passes its card read tool as `readToolId`, and its assistant card test keeps the parity proof.
