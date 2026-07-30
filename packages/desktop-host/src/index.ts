/**
 * `@jini-ai/desktop-host` — shared, shell-agnostic desktop-host ports and utilities (single-instance
 * locking, window lifecycle, protocol handling, sidecar launching, shell operations, paths, config,
 * logging, the host-bridge global). The concrete Electron and Tauri shell assemblies live at the
 * separate `@jini-ai/desktop-host/electron` and `@jini-ai/desktop-host/tauri` entry points (split
 * 2026-07-29, mirroring `@jini-ai/agentic`'s `.`/`./dom` precedent) — a real app only ever ships
 * one shell, so importing this root entry point never statically pulls in the other one.
 */
export * from './single-instance.js';
export * from './window-lifecycle.js';
export * from './protocol.js';
export * from './sidecar.js';
export * from './paths.js';
export * from './config.js';
export * from './logging.js';
export * from './windows-registry.js';
export * from './bridge.js';
export * from './render-service.js';
export * from './shell.js';
export * from './ports.js';
export * from './tokens.js';
