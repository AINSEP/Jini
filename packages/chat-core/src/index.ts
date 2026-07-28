/**
 * @jini-ai/chat-core — framework-free chat vocabulary + pure parsers.
 *
 * Zero React, zero DOM/browser globals, zero Node built-ins, zero imports
 * from any product package's scope. See foundry/docs/jini-port/extraction-plan.md
 * §12 C2/C3 and foundry/docs/jini-port/recon/r4b-webui-design.md §1 for the design
 * this package targets, and source-map.md for exact provenance.
 */
export * from './events.js';
export * from './messages.js';
export * from './partial-json.js';
export * from './tool-events.js';
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

