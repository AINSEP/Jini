/**
 * @file `@jini-ai/admin/browser` — DOM-bound helpers. No React.
 *
 * Split from `/core` so the universal half stays testable and reusable without a DOM. See
 * `navigation.ts`'s header.
 */

export {
  NAVIGATION_EVENT,
  installInternalLinkInterceptor,
  navigate,
  readRoutePath,
  subscribeToRoute,
} from './navigation.js';
