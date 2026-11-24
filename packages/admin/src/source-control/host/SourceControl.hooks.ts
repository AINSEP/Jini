/** The admin router's navigate, injected so this helper does not reach across into the shell. */
export type NavigateToRoute = (target: { routePath: string }, options: { replace?: boolean }) => void;

/** Keep this panel's selected tab in its deep link. */
export function navigateSourceControlTab({ nextTabId, navigate }: { nextTabId: string; navigate: NavigateToRoute }, _options = {}) {
  navigate({ routePath: `/source-control?tab=${nextTabId}` }, { replace: true });
}
