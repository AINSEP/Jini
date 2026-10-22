import { currentRoutePath } from '../core/routing/rules.js';
import { installInternalLinkInterceptor, navigate, subscribeToRoute } from './navigation.js';
import type { AdminShellNavigationPort } from '../core/ports/shell.js';

/**
 * Adapt the existing browser router to the shell's object-based navigation port.
 * @param args Required live browser location, history/event port and document port; the admin mount path is supplied on each port call.
 * @returns A query-preserving History API adapter. Construct only in a browser host.
 */
export function createAdminShellNavigation(args: { readonly location: Pick<Location, 'pathname' | 'search'>; readonly window: Pick<Window, 'location' | 'history' | 'dispatchEvent' | 'addEventListener' | 'removeEventListener'>; readonly document: Pick<Document, 'addEventListener' | 'removeEventListener'> }): AdminShellNavigationPort {
  return {
    readRoute: ({ base }) => `${currentRoutePath({ pathname: args.location.pathname }, { base })}${args.location.search}`,
    subscribe: ({ onChange }) => subscribeToRoute({ window: args.window, onChange }),
    navigate: ({ base, routePath }, options = {}) => navigate({ routePath, window: args.window }, { base, ...options }),
    installLinkInterceptor: ({ base }) => installInternalLinkInterceptor({ window: args.window, document: args.document }, { base }),
  };
}
