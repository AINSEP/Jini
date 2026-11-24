/** `@jini-ai/ui/live-views`: the React hooks for embedded-guest lifecycles. The framework-free
 *  decisions they build on are exported from `@jini-ai/ui/core`. */
export { useLiveViews, type LiveViews } from './use-live-views.js';
export { liveViewLimit, useSiteViewPreference, type LiveViewBounds, type LiveViewPreferenceBridge } from './use-site-view-preference.js';
export { useWebviewLoadFailure, type LoadFailureEvent, type LoadFailureGuest } from './use-webview-load-failure.js';
