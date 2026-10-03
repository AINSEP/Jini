/**
 * Custom-scheme-as-fetch-proxy registration (`registerSchemesAsPrivileged`
 * + `protocol.handle`) is an Electron main-process API with no JS-callable
 * Tauri equivalent — Tauri's custom protocol handlers are registered in
 * Rust at build/config time (`tauri.conf.json` + a Rust `register_uri_scheme_protocol`
 * call), not from the webview's JS runtime. C7's narrow Tauri slice does
 * not name protocol handling at all (it names "URL load", which
 * `tauri-window-lifecycle.ts` already covers via `navigate`), so this is a
 * clearly-marked stub rather than a real adapter, same treatment as
 * `tauri-render-service.ts`.
 */
import { NotImplementedError } from './not-implemented.js';
import type { ProtocolHandlerPort } from '../protocol.js';

export function createTauriProtocolHandlerPort(_requiredArgs: Record<string, never>): ProtocolHandlerPort {
  return {
    registerSchemeProxy() {
      throw new NotImplementedError({ message: 'ProtocolHandlerPort.registerSchemeProxy is not implemented by the Tauri adapter — custom scheme registration is a Rust/tauri.conf.json-time concern with no JS-callable equivalent, and is out of scope for the C7 narrow spike' });
    },
  };
}
