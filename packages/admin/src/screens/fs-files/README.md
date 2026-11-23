# fs-files (admin screens)

Renderer-side pieces of the folder-files feature: the desktop folder-drop port reader, the
composer's native-folder-picker hook, and the folder-drop hook (`useFolderDrop`: folder chips plus
the `custom` root write, last folder wins) with its pure rules. The HTTP client stays in the host.

## Wiring

Architecture: [DR-005 portable package boundaries](../../../../../docs/decisions/DR-005-portable-package-boundaries.md).

**Needs injected**
- `bridgeKey: string` — the `window` global name the host's Electron preload exposes the
  `FolderPathDropPort` (`@jini-ai/ui/core`) bridge under.
- `targetWindow: Window | undefined` — a test seam; real callers pass `undefined`.
- `useNativeFolderPicker(input, deps)` — `deps.probe` / `deps.pick` (the host's folder-picker
  GET/POST calls) and `deps.isDialogAlreadyOpen(error)` (the host's 409 "another tab has the dialog
  open" check). The host binds all three in its fs-files API module (`nativeFolderPickerDeps`) and
  passes them from its assistant dock state hook.
- `useFolderDrop(input, deps)` — `deps.getPort` (the host's `getFolderDropPort` call with its bridge
  key), `deps.getCustomRoot` / `deps.setCustomRoot` (the host's custom-root GET/PUT),
  `deps.folderPathsFromDataTransfer` (`@jini-ai/ui/core`'s), and `deps.readFailure(error)` (reads the
  host API error's `code` and server message, `null` for any other throw). The host binds all five in
  its fs-files API module (`folderDropDeps`) and passes them from its assistant dock's composer-files
  hook. `input.composerHandle` needs only `addFolders` of `@jini-ai/chat`'s composer handle.
- `useFolderDrop` reads `useSerialWrites` / `useSettlementGeneration` from the admin kit
  (`@jini-ai/admin/react/kit`), so it must render under the host's `AdminKitProvider`.

**Provides**
- `getFolderDropPort({ targetWindow, bridgeKey })` → `FolderDropPort | null` (`null` in a plain browser tab).
- `FolderDropPort` — an alias of `@jini-ai/ui/core`'s `FolderPathDropPort`.
- `useNativeFolderPicker` → `{ available, picking, pickFolder }` (`@jini-ai/admin/screens/fs-files/use-native-folder-picker.hooks`).
- `useFolderDrop` → `{ notice, dismiss, retry, handleDropCapture, insertFolderPath, showPathHint }`
  (`@jini-ai/admin/screens/fs-files/use-folder-drop.hooks`).
- `FolderDropNotice`, `FolderDropErrorReason`, `CustomRootFailure`, `reasonForCustomRootFailure`,
  `dropHasFolder`, `confirmationNotice` (`@jini-ai/admin/screens/fs-files/folder-drop.rules`).

**Host wiring example**

```ts
import { getFolderDropPort } from "@jini-ai/admin/screens/fs-files/folder-drop-port";

/** The name our preload passes to `contextBridge.exposeInMainWorld`. */
const FOLDER_DROP_BRIDGE_KEY = "myAppFiles";

export function readFolderDropPort() {
  return getFolderDropPort({ targetWindow: undefined, bridgeKey: FOLDER_DROP_BRIDGE_KEY });
}
```

**Must never import**: host app code, a host-named `window` global declaration, or any
cross-package implementation (only `@jini-ai/ui/core` types).
