---
"@jini-ai/ui": patch
---

Add `useDismissibleDropdown` and `settingsControlHandlers` to `@jini-ai/ui/browser` (a dropdown's open state with outside-press/Escape dismissal, built on `useDismissOnOutsideOrEscape`). `@jini-ai/ui/site-card`'s `useSiteListPrefs` gains an optional synchronous `seed` (first render shows the stored choices; a throwing seed falls back to the defaults with `loadError`, changes still apply for the session), starts a save at once when none is in flight, and accepts a `save` that completes synchronously by returning nothing.
