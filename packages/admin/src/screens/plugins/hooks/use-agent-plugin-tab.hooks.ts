import { useEffect, useState } from "react";

import { navigate } from "../../../shell/lib/router.js";

import { resolveActiveTabId } from '@jini-ai/core/text';
const TAB_IDS = ["installed", "downloaded", "add", "marketplace"] as const;

/** URL changes (including browser navigation) and shell clicks use the same guarded tab set. */
export function useAgentPluginTab({ tabId }: { tabId?: string | null }, _optional = {}) {
  const resolved = resolveActiveTabId({ tabId: tabId, validIds: TAB_IDS, defaultId: "installed" });
  const [activeTabId, setActiveTabId] = useState<string>(resolved);
  useEffect(() => setActiveTabId(resolved), [resolved]);
  return {
    activeTabId,
    onActiveTabIdChange: (next: string) => {
      const guarded = resolveActiveTabId({ tabId: next, validIds: TAB_IDS, defaultId: "installed" });
      setActiveTabId(guarded);
      navigate({ routePath: `/addons/agent-plugins?tab=${guarded}` }, { replace: true });
    },
  };
}
