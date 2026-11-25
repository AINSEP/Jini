/**
 * @file `@jini-ai/admin/browser` — DOM-bound helpers. No React.
 *
 * Split from `/core` so the universal half stays testable and reusable without a DOM. See
 * `navigation.ts`'s header.
 */

export {
  BEFORE_LINK_NAVIGATION_EVENT,
  NAVIGATION_EVENT,
  installInternalLinkInterceptor,
  navigate,
  readRoutePath,
  subscribeToRoute,
} from './navigation.js';

export { createAdminShellNavigation } from './shell-navigation.js';

export { createBrowserTelemetry, installBrowserErrorListeners, type BrowserTelemetry, type BrowserTelemetryDeps, type BrowserTelemetryPayload } from './telemetry.js';

export { toRouteTemplate } from '../core/routing/route-template.js';
export { createReactRootErrorHandlers } from './react-root-errors.js';

export { createServerReconnect, shouldRetryAfterReconnect, probeReadyz, type ServerConnectionStatus, type ServerReconnectDeps, type ServerReconnectOptional, type ServerReconnect } from './server-reconnect.js';
export { subscribeToSettingsChanges } from './settings-events.js';
