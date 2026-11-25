import { navigate } from "../../shell/lib/router.js";

/** Keep this panel's selected tab in its deep link. */
export function navigateDatabaseTab({ nextTabId }: { nextTabId: string }, _options = {}) {
  navigate({ routePath: `/database?tab=${nextTabId}` }, { replace: true });
}
