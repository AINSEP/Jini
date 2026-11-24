# zoom

Zoom In / Zoom Out / Actual Size for a desktop window that embeds `<webview>` guests: routes each
menu command to the visible guest or to the window's own top-level page, and remembers each
guest's level in `localStorage` across reloads and relaunches.

Entry: `@jini-ai/ui/zoom` — `useZoom` (standalone hook the host calls), plus the plain helpers
`resolveZoomTarget`, `nextZoomLevel`, `readStoredZoom`, `writeStoredZoom`, `applyStoredZoom`,
`applyZoomCommand`, `windowZoomStorage`, and the structural ports `ZoomableGuest`, `ZoomBridge`,
`ZoomStorage`, `ZoomDirection`. No Electron import: the guest and bridge are structural ports.

## Wiring

The host injects:

- `bridge` — its preload bridge (`onZoomCommand`, `getZoomLevel`, `setZoomLevel`), or `undefined`
  outside a desktop window. The IPC channel that pushes the menu command stays host-owned.
- `keyPrefix` — the host's own `localStorage` key prefix for per-guest levels.
- `storage` (optional) — defaults to `windowZoomStorage`, the window's `localStorage` resolved lazily.

The host's renderer zoom adapter (its `useZoom` wrapper) supplies the bridge lookup and key prefix;
its app root calls that adapter and composes `registerGuest` into each guest's ref.
