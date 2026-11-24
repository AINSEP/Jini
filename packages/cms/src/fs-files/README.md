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
