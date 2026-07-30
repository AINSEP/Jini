/**
 * `@jini-ai/desktop-host/electron` — the full Electron shell assembly. Split from the package's
 * main `.` entry point (2026-07-29) so an Electron app doesn't statically import the equally-full
 * Tauri assembly it will never call, and vice versa — mirrors `@jini-ai/agentic`'s `.`/`./dom`
 * subpath precedent. The shared, shell-agnostic port types/utilities
 * (`single-instance.ts`/`window-lifecycle.ts`/`protocol.ts`/`sidecar.ts`/`shell.ts`/`ports.ts`/etc.)
 * stay at the package's main entry point; only the concrete Electron implementation lives here.
 */
export * from './electron-surfaces.js';
export * from './electron-single-instance.js';
export * from './electron-window-lifecycle.js';
export * from './electron-protocol.js';
export * from './electron-render-service.js';
export * from './electron-shell.js';
export * from './create-electron-desktop-host.js';
export * from './testing.js';
