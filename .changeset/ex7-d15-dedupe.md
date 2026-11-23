---
"@jini-ai/desktop-host": minor
---

BREAKING: the `./shell/window-navigation-policy`, `./shell/webview-guest-policy` and `./shell/window-bounds-store` subpaths are removed. They were wrappers over the existing object-shaped APIs; import `installAppWindowNavigationPolicy`, `installRendererNavigationPolicy`, `installGuestWindowOpenPolicy`, `isShellPageUrl`, `isSameOrigin`, `isExternalBrowserUrl`, `applyGuestWebPreferences` and `admitGuestSource` from `./electron/navigation-policy` (`isShellPageUrl` takes `attachUrl` as its second argument; `installGuestWindowOpenPolicy` takes one `{ contents, ... }` object), and the bounds functions from `./electron/usability`, passing your own `BoundsStorePort`, file name and path join. `./shell/guest-navigation` now uses the `./electron/navigation-policy` API directly.
