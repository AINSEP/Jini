import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { agentHandle } from "@jini-ai/agentic";
import type { TabBarTab } from "./TabBar.js";

export function tabHandleProps({ tab }: { tab: TabBarTab }) {
  return tab.handle ? agentHandle({ handle: tab.handle }, { role: "button", label: tab.handleLabel ?? tab.label }) : {};
}

const TAB_BAR_NAV_KEYS = ["ArrowRight", "ArrowLeft", "Home", "End"] as const;
type TabBarNavKey = (typeof TAB_BAR_NAV_KEYS)[number];

function isTabBarNavKey(key: string): key is TabBarNavKey {
  return (TAB_BAR_NAV_KEYS as readonly string[]).includes(key);
}

function enabledTabIndices(tabs: readonly TabBarTab[]): number[] {
  return tabs.reduce<number[]>((acc, tab, i) => (tab.disabled ? acc : [...acc, i]), []);
}

/** Resolve arrow/Home/End navigation in enabled-tab order; null means no navigation. */
export function resolveTabBarKeyTarget({ tabs, activeId, key }: { tabs: readonly TabBarTab[]; activeId: string; key: string }): number | null {
  if (!isTabBarNavKey(key)) return null;

  const enabled = enabledTabIndices(tabs);
  if (enabled.length === 0) return null;

  if (key === "Home") return enabled[0]!;
  if (key === "End") return enabled[enabled.length - 1]!;

  const activeIndex = tabs.findIndex((tab) => tab.id === activeId);
  const activePos = activeIndex === -1 ? -1 : enabled.indexOf(activeIndex);

  if (key === "ArrowRight") {
    if (activePos === -1) return enabled[0]!;
    return enabled[(activePos + 1) % enabled.length]!;
  }
  // ArrowLeft
  if (activePos === -1) return enabled[enabled.length - 1]!;
  return enabled[(activePos - 1 + enabled.length) % enabled.length]!;
}

export function resolveTabBarTabIndex({ tabs, activeId, tab }: { tabs: readonly TabBarTab[]; activeId: string; tab: TabBarTab }): 0 | -1 {
  if (tab.disabled) return -1;
  if (tabs.some((t) => t.id === activeId && !t.disabled)) return tab.id === activeId ? 0 : -1;
  const firstEnabled = tabs.find((t) => !t.disabled);
  return firstEnabled?.id === tab.id ? 0 : -1;
}

export interface TabBarKeyboardHandlers {
  onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
}

export function useTabBarKeyboard({ tabs, activeId, onChange }: { tabs: readonly TabBarTab[]; activeId: string; onChange: (id: string) => void }): TabBarKeyboardHandlers {
  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>): void {
    // Controls inside the strip that are not tabs keep their own navigation keys.
    if (!(e.target instanceof Element) || !e.target.closest('[role="tab"]')) return;
    const target = resolveTabBarKeyTarget({ tabs: tabs, activeId: activeId, key: e.key });
    if (target === null) return;
    e.preventDefault();
    onChange(tabs[target]!.id);
    e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[target]?.focus();
  }
  return { onKeyDown };
}
