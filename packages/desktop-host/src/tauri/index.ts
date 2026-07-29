/**
 * `@jini-ai/desktop-host/tauri` — the full Tauri shell assembly. Split from the package's main
 * `.` entry point (2026-07-29) so a Tauri app doesn't statically import the equally-full Electron
 * assembly it will never call, and vice versa — mirrors `@jini-ai/agentic`'s `.`/`./dom` subpath
 * precedent. The shared, shell-agnostic port types/utilities
 * (`single-instance.ts`/`window-lifecycle.ts`/`protocol.ts`/`sidecar.ts`/`shell.ts`/`ports.ts`/etc.)
 * stay at the package's main entry point; only the concrete Tauri implementation lives here.
 */
export * from './tauri-surfaces.js';
export * from './tauri-single-instance.js';
export * from './tauri-window-lifecycle.js';
export * from './tauri-protocol.js';
export * from './tauri-render-service.js';
export * from './tauri-shell.js';
export * from './tauri-sidecar.js';
export * from './create-tauri-desktop-host.js';
export * from './not-implemented.js';
export * from './testing.js';
