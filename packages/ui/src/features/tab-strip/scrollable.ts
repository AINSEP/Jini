/** Read horizontal overflow with a pixel of tolerance for rounded layout measurements. */
export function tabOverflow(
  { strip }: { strip: Pick<HTMLElement, 'scrollWidth' | 'clientWidth' | 'scrollLeft'> },
  _optional: Record<string, never> = {},
): { left: boolean; right: boolean } {
  return { left: strip.scrollLeft > 1, right: strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1 };
}

/** Reveal the selected tab; hosts can supply their own selection marker. */
export function revealActiveTab(
  { strip, activeSelector = '[aria-selected="true"]' }: { strip: Pick<HTMLElement, 'querySelector'>; activeSelector?: string },
  _optional: Record<string, never> = {},
): void {
  strip.querySelector<HTMLElement>(activeSelector)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/** Only the selected tab is in the tab order; a removed selection falls back to the null tab. */
export function rovingTabIndex(
  { activeId, tabIds, tabId }: { activeId: string | null; tabIds: readonly (string | null)[]; tabId: string | null },
  _optional: Record<string, never> = {},
): 0 | -1 {
  const selected = tabIds.includes(activeId) ? activeId : null;
  return selected === tabId ? 0 : -1;
}

/** Resolve horizontal tab navigation without touching focus or activation.
 * @complexity O(1) time and space.
 */
export function nextTabListIndex(
  { key, index, count }: { key: string; index: number; count: number },
  _optional: Record<string, never> = {},
): number | undefined {
  switch (key) {
    case 'ArrowLeft': return (index + count - 1) % count;
    case 'ArrowRight': return (index + 1) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return undefined;
  }
}

/** WAI-ARIA horizontal tabs: wrap arrows and activate on focus when tab panels stay mounted. */
export function navigateTabList(
  { strip, event }: {
    strip: Pick<HTMLElement, 'querySelectorAll'>;
    event: Pick<KeyboardEvent, 'key' | 'target' | 'preventDefault' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>;
  },
  _optional: Record<string, never> = {},
): void {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const tabs = Array.from(strip.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const index = tabs.findIndex((tab) => tab === event.target);
  // Close buttons and overflow arrows keep their own keyboard behaviour.
  if (index < 0) return;
  const next = nextTabListIndex({ key: event.key, index, count: tabs.length });
  if (next === undefined) return;
  const tab = tabs[next];
  if (!tab) throw new Error('tab strip navigation has no target tab');
  event.preventDefault();
  tab.focus();
  tab.click();
}
