import { navigate } from "../../shell/lib/router.js";

/** Keep this panel's selected tab in its deep link. */
export function navigateProvidersTab({ nextTabId }: { nextTabId: string }, _options = {}) {
  navigate({ routePath: `/addons/integrations?tab=${nextTabId}` }, { replace: true });
}
