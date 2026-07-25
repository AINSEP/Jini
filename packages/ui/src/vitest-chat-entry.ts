/**
 * Test-only narrow barrel used by `@jini/chat-react`'s Vitest resolver.
 *
 * Production consumers import the public `@jini/ui` barrel. This entry keeps
 * the real chat-facing components testable without evaluating unrelated
 * browser-only editor dependencies in Node.
 */
export { AgentIcon } from './react/components/AgentIcon.js';
export { RemixIcon } from './react/components/RemixIcon.js';
export { WorkingDirPicker } from './react/components/WorkingDirPicker.js';
export { useFileDropTarget } from './browser/useFileDropTarget.js';
export { FILE_SYSTEM_READ_ERROR_MESSAGE } from './utils/file-system-errors.js';
