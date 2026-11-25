import { navigate } from "../../shell/lib/router.js";

/** Keep this panel's selected tab in its deep link. */
export function navigateSecurityTab({ nextTabId }: { nextTabId: string }, _options = {}) {
  navigate({ routePath: `/access-tokens?tab=${nextTabId}` }, { replace: true });
}
