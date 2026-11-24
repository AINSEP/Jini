/**
 * @file `@jini-ai/core/admin-runtime` — the pure runtime every admin module owner needs, placed where
 * an owner package may import it (an owner imports only itself, core and protocol). No React, no
 * DOM, no I/O. The React halves (`useController`, `bindReact`) live in `@jini-ai/ui-kit/react`.
 */
export { AdminConfigError } from './admin-config-error.js';
export { AdminApiError, describeApiError } from './admin-api-error.js';
export type { AdminHttpError, AdminHttpOptions, AdminHttpReconnect } from './admin-http.js';
export { createControllerStore } from './controller-store.js';
export type { ControllerStore, WritableControllerStore } from './controller-store.js';
// Permissions — affordance only, never an authorization boundary.
export { hasPermission, isPanelAccessible, withoutInaccessiblePanels } from './panel-access.js';
export type { AdminNavGroupShape, AdminPanelAccessDeclaration, AdminPanelAccessEntry } from './panel-access.js';
export { querySuffix } from './query-suffix.js';
