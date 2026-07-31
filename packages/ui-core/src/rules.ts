import type { SettingsDialogTabMeta } from './types.js';

/**
 * Resolves which tab id should be active: the requested id if it exists in
 * `tabs`, otherwise the first tab's id, otherwise `null` (an empty tab
 * list). Pulled out of the shell's `useState` initializer so it's testable
 * without mounting React — a host that passes an `initialTabId` no longer
 * present in `tabs` (e.g. a deep link to a since-removed tab) still lands on
 * a valid tab instead of a blank content pane.
 */
export function resolveInitialActiveTabId<T extends SettingsDialogTabMeta>(
  tabs: readonly T[],
  initialTabId?: string | null,
): string | null {
  if (initialTabId != null && tabs.some((tab) => tab.id === initialTabId)) {
    return initialTabId;
  }
  return tabs[0]?.id ?? null;
}

/** Finds a tab by id, or `undefined` if `activeTabId` is `null`/not present. */
export function findActiveTab<T extends SettingsDialogTabMeta>(
  tabs: readonly T[],
  activeTabId: string | null,
): T | undefined {
  if (activeTabId == null) return undefined;
  return tabs.find((tab) => tab.id === activeTabId);
}
