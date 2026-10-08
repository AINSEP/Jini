/**
 * @jini-ai/chat/core — framework-free chat vocabulary and pure parsers.
 * No React, DOM/browser globals, Node built-ins or product-package imports (extraction-plan §12
 * C2/C3). Hosts can implement the transport port without importing a browser component graph.
 */
export * from './events.js';
export * from './messages.js';
export * from './partial-json.js';
export * from './tool-events.js';
export * from './tool-output.js';
export * from './transport.js';
export * from './tools.js';
export * from './todos.js';
export * from './question-form.js';
export * from './util/index.js';
export * from './transcript.js';
export * from './run-activity.js';
export * from './surface-expiry.js';
export * from './assistant-content.js';
export * from './compact-events.js';
/** Chat-pane capability manifest. Generic agent-control vocabulary, markup and projections are
 * owned by @jini-ai/agentic; import them there so non-chat callers stay independent of chat. */
export * from './agentic/index.js';
/**
 * Durable chat history — the storage-neutral `ChatHistoryStore` port and the local title
 * heuristic. Types and pure functions only, so this package stays framework-free and
 * `runtime: universal`; the SQLite implementation lives in `@jini-ai/sqlite-chat`'s `chat-history`
 * module, and a host binds it to its own authentication.
 */
export * from './persistence/index.js';


export { recoveredRunEvents } from './durable-projection.js';

export {
  composerHistoryKeyAction,
  createComposerHistoryState,
  mergeComposerHistory,
  normalizeComposerHistory,
  transitionComposerHistory,
} from './composer-history.js';
export type { ComposerHistoryKeyInput, ComposerHistoryState, ComposerHistoryStoragePort } from './composer-history.js';

export * from './user-text-redaction.js';
