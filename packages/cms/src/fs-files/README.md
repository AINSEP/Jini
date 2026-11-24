# fs-files

`native-folder-picker.ts` — opens the OS-native "choose folder" dialog on the machine running the
server (`osascript` on macOS, `zenity`/`kdialog` on Linux with a display, PowerShell on Windows)
through `execFile` with a fixed absolute binary and fixed argv. Node-only entry
(`@jini-ai/cms/fs-files/native-folder-picker`).

## Wiring

The host injects its environment map as `required.env` (`createNativeFolderPicker({ env }, optional)`;
only a declared process entry may read `process.env`). Optional test seams: `platform`, `exists`,
`execFile`. The admission rule ("own machine only") belongs to the
host route that calls `pick()`; this module only knows how to show the dialog. A host creates it once
where it mounts its admin system routes and hands it to its folder-picker route.

`write-files.ts` — batched, approved writes into an owner-picked folder (`@jini-ai/cms/fs-files/write-files`,
node): plain-relative path shape, lstat walk refusing every symlink, caps, canonical base64, and
temp-file-then-rename writes; `requirePickedFolder` applies the picked-folder rule.

### Wiring (write-files)

The host injects its guarded path resolver (the read tools' denylist + containment) as the REQUIRED
`resolveFsFilePath` field on `inspectWriteTarget`, `prepareFileWrites` and `writePreparedFiles`. The host
binds its own guarded `resolveFsFilePath` at each call site (its fs-files tool registrations and its
asset-transfer destinations and sources).
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
