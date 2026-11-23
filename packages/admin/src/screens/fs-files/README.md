# fs-files (admin screens)

Renderer-side pieces of the folder-files feature: the desktop folder-drop port reader and the
composer's native-folder-picker hook. The drop hook and the HTTP client still live in the host.

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

**Provides**
- `getFolderDropPort({ targetWindow, bridgeKey })` → `FolderDropPort | null` (`null` in a plain browser tab).
- `FolderDropPort` — an alias of `@jini-ai/ui/core`'s `FolderPathDropPort`.
- `useNativeFolderPicker` → `{ available, picking, pickFolder }` (`@jini-ai/admin/screens/fs-files/use-native-folder-picker.hooks`).

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
