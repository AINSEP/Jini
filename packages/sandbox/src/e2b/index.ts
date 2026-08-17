/**
 * @module @jini-ai/sandbox/e2b
 *
 * The E2B (Firecracker microVM) adapter: `createE2bSandboxProvider` implements
 * `@jini-ai/sandbox/core`'s `SandboxProviderPort` against `@e2b/code-interpreter`, an optional
 * peer dependency of this package. Importing this entry point is what requires it to be
 * installed.
 */
export { createE2bSandboxProvider } from './provider.js';
export type { E2bProviderConfig } from './provider.js';
export { DEFAULT_VITE_REACT_TEMPLATE } from './default-vite-react-template.js';
export { mapE2bFileChangeKind, SandboxPreviewNotReadyError, wrapE2bSandbox } from './wrap-e2b-sandbox.js';
export type { E2bSessionConfig } from './wrap-e2b-sandbox.js';
export { shellQuote } from './shell-quote.js';
export type {
  E2bCommandHandle,
  E2bCommandResult,
  E2bCommands,
  E2bFilesystem,
  E2bFilesystemEvent,
  E2bFilesystemEventType,
  E2bRunOptions,
  E2bSandboxHandle,
  E2bWatchHandle,
} from './e2b-sandbox-handle.js';
