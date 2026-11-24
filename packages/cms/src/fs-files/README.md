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
