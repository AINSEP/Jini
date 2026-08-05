/**
 * `@jini-ai/chat/core` — framework-free chat vocabulary + pure parsers.
 *
 * Zero React, zero DOM/browser globals, zero Node built-ins, zero imports
 * from any product package's scope. See ADS-memory/reports/jini-port/extraction-plan.md
 * §12 C2/C3 and ADS-memory/reports/jini-port/recon/r4b-webui-design.md §1 for the design
 * this package targets, and source-map.md for exact provenance.
 *
 * Was `@jini-ai/chat-core` (its own top-level package, one entry point) through npm 0.1.2 —
 * consolidated 2026-08-03 into `@jini-ai/chat`'s `./core` subpath alongside `./react` (formerly
 * `@jini-ai/ui`'s `./chat` export), following `@jini-ai/admin`'s umbrella-with-subpaths precedent.
 * `@jini-ai/chat-core` is retired, not deprecated-and-kept — its published npm versions
 * (0.1.0–0.1.2) go end-of-life as-is; `@jini-ai/chat` supersedes it.
 */
export * from './events.js';
export * from './messages.js';
export * from './partial-json.js';
export * from './tool-events.js';
export * from './transport.js';
export * from './tools.js';
export * from './todos.js';
export * from './question-form.js';
export * from './util/index.js';
export * from './transcript.js';
/**
 * The chat pane's own capability manifest (`CHAT_CAPABILITIES`). The framework-free agent-control
 * vocabulary this used to sit alongside — `CapabilityDef`, `PAGE_CAPABILITIES`, the
 * `data-agent-*` convention, the policy gate, the protocol projections — moved to `@jini-ai/agentic`
 * on 2026-07-26; import it directly rather than through this package. See
 * `packages/agentic/source-map.md` and this package's own source-map.md for the extraction.
 */
export * from './agentic/index.js';
/**
 * Durable chat history — the storage-neutral `ChatHistoryStore` port and the local title
 * heuristic. Types and pure functions only, so this package stays framework-free and
 * `runtime: universal`; the SQLite implementation lives in `@jini-ai/sqlite`'s `chat-history`
 * module, and a host binds it to its own authentication.
 */
export * from './persistence/index.js';

