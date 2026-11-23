import { useCallback } from "react";

import { navigate, useRouteLocation } from "../../shell/lib/router.js";

import { resolveActiveTabId } from '@jini-ai/core/text';
const SKILLS_TAB_IDS = ["skills", "add"] as const;

/** URL-backed tabs using the sibling pages' `?tab=` and replacement navigation. */
export function useSkillsTabs() {
  const route = useRouteLocation();
  const requestedTab = new URLSearchParams(route.split("?")[1]).get("tab");
  const activeTabId = resolveActiveTabId({ tabId: requestedTab, validIds: SKILLS_TAB_IDS, defaultId: "skills" });
  const onTabChange = useCallback((tabId: string) => {
    const nextTab = resolveActiveTabId({ tabId: tabId, validIds: SKILLS_TAB_IDS, defaultId: "skills" });
    navigate({ routePath: `/addons/skills?tab=${nextTab}` }, { replace: true });
  }, []);
  const onShowSkills = useCallback(() => onTabChange("skills"), [onTabChange]);
  const onShowAdd = useCallback(() => onTabChange("add"), [onTabChange]);
  return { activeTabId, onTabChange, onShowSkills, onShowAdd };
}
