import { useCallback } from "react";

import type { resolveActiveTabId as ResolveActiveTabId } from '@jini-ai/core/text';
const SKILLS_TAB_IDS = ["skills", "add"] as const;

/** What the host injects: its route hook, its replacement navigation and Core's tab resolver. */
export interface SkillsTabsHooks {
  useRouteLocation: () => string;
  navigate: (required: { routePath: string }, optional?: { replace?: boolean }) => void;
  resolveActiveTabId: typeof ResolveActiveTabId;
}

/** URL-backed tabs using the sibling pages' `?tab=` and replacement navigation. */
export function useSkillsTabs({ useRouteLocation, navigate, resolveActiveTabId }: SkillsTabsHooks, _optional = {}) {
  const route = useRouteLocation();
  const requestedTab = new URLSearchParams(route.split("?")[1]).get("tab");
  const activeTabId = resolveActiveTabId({ tabId: requestedTab, validIds: SKILLS_TAB_IDS, defaultId: "skills" });
  const onTabChange = useCallback((tabId: string) => {
    const nextTab = resolveActiveTabId({ tabId: tabId, validIds: SKILLS_TAB_IDS, defaultId: "skills" });
    navigate({ routePath: `/addons/skills?tab=${nextTab}` }, { replace: true });
  }, [navigate, resolveActiveTabId]);
  const onShowSkills = useCallback(() => onTabChange("skills"), [onTabChange]);
  const onShowAdd = useCallback(() => onTabChange("add"), [onTabChange]);
  return { activeTabId, onTabChange, onShowSkills, onShowAdd };
}
