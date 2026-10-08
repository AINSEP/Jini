import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { agentHandle } from "@jini-ai/agentic";
import type { TabBarTab } from "./TabBar.js";

/**
 * @file TabBar's derived props and WAI-ARIA automatic-activation keyboard behavior.
 * Data and event logic live here; TabBar.tsx keeps the JSX render helpers. Arrow keys activate
 * immediately and move focus, while disabled tabs are skipped and non-tab controls keep their keys.
 */

/** The `TabBarButton` component's own `agentHandle()` spread, as a plain function rather than an
 *  inline ternary in its JSX — one more small piece pulled out of `TabBar.tsx` for the same
 *  complexity-gate reason that component's own doc comment gives.
 * @example tabHandleProps({ tab: { id: "a", label: "A", handle: "tab-a" } });
 */
export function tabHandleProps({ tab }: { tab: TabBarTab }, _optional: Record<string, never> = {}) {
  return tab.handle ? agentHandle({ handle: tab.handle }, { role: "button", label: tab.handleLabel ?? tab.label }) : {};
}

const TAB_BAR_NAV_KEYS = ["ArrowRight", "ArrowLeft", "Home", "End"] as const;
type TabBarNavKey = (typeof TAB_BAR_NAV_KEYS)[number];

function isTabBarNavKey(key: string): key is TabBarNavKey {
  return (TAB_BAR_NAV_KEYS as readonly string[]).includes(key);
}

/** Indices of every non-disabled tab, in `tabs` order — the only positions a key can land on. */
function enabledTabIndices(tabs: readonly TabBarTab[]): number[] {
  return tabs.reduce<number[]>((acc, tab, i) => (tab.disabled ? acc : [...acc, i]), []);
}

/**
 * Resolve arrow/Home/End navigation in enabled-tab order; null means no navigation.
 *
 * Resolves which tab a keydown on the tablist should move to, for the WAI-ARIA "automatic
 * activation" tabs pattern (arrow keys change the selection immediately, not just focus).
 *
 * @param input.tabs - The tab row in DOM order.
 * @param input.activeId - The currently active tab's id.
 * @param input.key - `KeyboardEvent.key` from the tablist's own `onKeyDown`.
 * @returns The target tab's index into `tabs`, or `null` when `key` isn't a nav key or every tab
 *   is disabled. Disabled tabs are never a target. Home/End always resolve to the first/last
 *   enabled tab. When `activeId` matches no enabled tab (unset, unknown id, or a disabled tab),
 *   ArrowRight/Home resolve to the first enabled tab and ArrowLeft/End resolve to the last —
 *   the same "nothing to move from" case Home/End already answer explicitly.
 * @complexity O(n²) time, O(n) space (the enabled-index reducer copies its accumulator) in `tabs.length`.
 * @example resolveTabBarKeyTarget({ tabs, activeId: "a", key: "ArrowRight" });
 */
export function resolveTabBarKeyTarget({ tabs, activeId, key }: { tabs: readonly TabBarTab[]; activeId: string; key: string }, _optional: Record<string, never> = {}): number | null {
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

/**
 * Resolves one tab's roving-tabindex value — exactly one tab in a `TabBar` is ever in the native
 * Tab order at a time (WAI-ARIA APG roving tabindex), so arrowing between tabs never lets a plain
 * Tab keypress land on more than one of them.
 *
 * @param input.tabs - The tab row in DOM order.
 * @param input.activeId - The currently active tab's id.
 * @param input.tab - The tab being rendered.
 * @returns `0` for the enabled active tab, or for the first enabled tab when `activeId` matches
 *   no enabled tab; `-1` otherwise, including every disabled tab.
 * @complexity O(n) in `tabs.length`.
 * @example resolveTabBarTabIndex({ tabs, activeId: "a", tab: tabs[0]! });
 */
export function resolveTabBarTabIndex({ tabs, activeId, tab }: { tabs: readonly TabBarTab[]; activeId: string; tab: TabBarTab }, _optional: Record<string, never> = {}): 0 | -1 {
  if (tab.disabled) return -1;
  if (tabs.some((t) => t.id === activeId && !t.disabled)) return tab.id === activeId ? 0 : -1;
  const firstEnabled = tabs.find((t) => !t.disabled);
  return firstEnabled?.id === tab.id ? 0 : -1;
}

export interface TabBarKeyboardHandlers {
  onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
}

/**
 * Wires {@link resolveTabBarKeyTarget} into a tablist's `onKeyDown`: on a nav key, changes the
 * active tab and moves DOM focus to the new tab button, so focus and selection never drift apart.
 * Keydowns that did not originate inside a `[role="tab"]` are ignored, so a non-tab control hosted
 * in the same tablist keeps its own arrow/Home/End keys.
 *
 * @param input.tabs - The tab row in DOM order.
 * @param input.activeId - The currently active tab's id.
 * @param input.onChange - `TabBarProps.onChange`, called with the target tab's id.
 * @returns `onKeyDown`, for the tablist container's own React event prop.
 * @complexity O(n²) time, O(n) space (the enabled-index reducer copies its accumulator) in `tabs.length` per keydown (bounded by the on-screen tab count).
 * @example useTabBarKeyboard({ tabs, activeId, onChange });
 */
export function useTabBarKeyboard({ tabs, activeId, onChange }: { tabs: readonly TabBarTab[]; activeId: string; onChange: (id: string) => void }, _optional: Record<string, never> = {}): TabBarKeyboardHandlers {
  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>): void {
    // A tablist may legitimately hold a control that is NOT a tab — `AccessTokensTab.tsx`'s
    // "+ Add custom provider" button sits inside its `role="tablist"` div and is Tab-reachable.
    // React's onKeyDown here fires for keydowns anywhere in the subtree, so without this origin
    // check an arrow press on that button would change the selection and pull focus onto a tab,
    // silently moving the operator off the control they were standing on.
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
