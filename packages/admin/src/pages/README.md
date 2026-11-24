# pages


## Wiring

- `theme-canvas-port.hooks` / `theme-pages-port.hooks` — port interfaces only; the host implements `ThemeCanvasPort` and `ThemePagesPort` (the pages port is bound to the host's themes API).
- `theme-canvas-wrapper` — pure DOM derivation; nothing to inject.
- `ThemePageDetailsModal.hooks` — reads `openLightboxDialog`/`closeLightboxDialog` from `useAdminKitValues()`, so the host mounts `AdminKitProvider` with those two values.
