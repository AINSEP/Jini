# fs-files (cms)

Server-side pieces of the folder-files feature: the operator-set `custom` filesystem root's
per-workspace persistence and the permission that gates changing
the custom root. The guarded reader policy (denylist, listing limits), the root layout, the write
path and the agent tool registrations still live in the host.

## Wiring

Architecture: [DR-005 portable package boundaries](../../../../docs/decisions/DR-005-portable-package-boundaries.md).

**Needs injected**
- `custom-root-store`: `optional.siteDir` (or a resolved persistence directory) on every call — the
  host resolves the active site directory at boot and passes it through; nothing is read from
  module-level host state.
- `custom-root-permission`: `registerFsFilesCustomRootPermissionGrants({ registry })` takes any
  object with `roleGrants.register({ role, permission, reason })` — the host passes its
  permission-grant registry from its app-permission-grants composition list.

**Host bindings (in the host repo)**
- `server/runtime/composition/app-permission-grants.ts` registers the grant.
- `server/inbound/admin-http/routes/fs-files/{custom-root,folder-picker}.ts (permission constant)` and the assistant run
  launch/start paths read and write the custom root.

**Provides**
- `@jini-ai/cms/fs-files/custom-root-store` — `getCustomFsRoot`, `getCustomFsRootStatus`,
  `setCustomFsRoot`, `assertExistingAbsoluteDirectory`, `CustomFsRootError`, `resetCustomFsRootForTests`.
- `@jini-ai/cms/fs-files/custom-root-permission` — `FS_FILES_CUSTOM_ROOT_MANAGE_PERMISSION`,
  `registerFsFilesCustomRootPermissionGrants`, `FsFilesPermissionGrantRegistry`.

**Must never import**: host app code or any cross-package implementation (Node built-ins only).
