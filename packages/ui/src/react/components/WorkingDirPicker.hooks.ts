import { useCallback, type KeyboardEvent as ReactKeyboardEvent } from 'react';

export const MENU_ITEM_SELECTOR = '[role="menuitem"]:not(:disabled)';
const RECENT_ITEM_SELECTOR = '[data-testid="working-dir-recent"]';
const RECENT_LIST_SELECTOR = '[data-testid="working-dir-recent-list"]';

/**
 * The menu item a navigation key moves focus to, or `null` for any other key. `count` is never 0:
 * the "Choose folder" item is always rendered and never disabled. ArrowUp from `currentIndex` -1
 * (focus on no menu item) yields `count - 2`, pinned as-is by the component tests.
 */
function resolveMenuNavigationIndex({ key, currentIndex, count }: { key: string; currentIndex: number; count: number }): number | null {
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown') return (currentIndex + 1 + count) % count;
  if (key === 'ArrowUp') return (currentIndex - 1 + count) % count;
  return null;
}

/** Arrow/Home/End roving focus across the panel's enabled menu items; true when the key was handled. */
function handleMenuNavigationKey({ event }: { event: ReactKeyboardEvent<HTMLDivElement> }): boolean {
  const menuItems = [...event.currentTarget.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR)];
  const currentIndex = menuItems.indexOf(document.activeElement as HTMLElement);
  const nextIndex = resolveMenuNavigationIndex({ key: event.key, currentIndex, count: menuItems.length });
  if (nextIndex === null) return false;
  event.preventDefault();
  menuItems[nextIndex]?.focus();
  return true;
}

/** ArrowRight on "Recent folders" opens its flyout; ArrowLeft inside the flyout closes it again. */
function handleRecentFlyoutKey({ event, showRecent, hideRecent }: {
  event: ReactKeyboardEvent<HTMLDivElement>; showRecent: () => void; hideRecent: () => void;
}): void {
  const panel = event.currentTarget;
  if (event.key === 'ArrowRight' && event.target === panel.querySelector(RECENT_ITEM_SELECTOR)) {
    event.preventDefault();
    showRecent();
    window.setTimeout(() => {
      panel.querySelector<HTMLElement>(`${RECENT_LIST_SELECTOR} [role="menuitem"]`)?.focus();
    }, 0);
    return;
  }
  if (
    event.key === 'ArrowLeft'
    && event.target instanceof HTMLElement
    && event.target.closest(RECENT_LIST_SELECTOR)
  ) {
    event.preventDefault();
    hideRecent();
    panel.querySelector<HTMLElement>(RECENT_ITEM_SELECTOR)?.focus();
  }
}

/** Apply menu roving and recent-folder flyout navigation in their original order. */
export function useWorkingDirPanelNavigation({ showRecent, hideRecent }: { showRecent: () => void; hideRecent: () => void }, _options = {}) {
  return useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (handleMenuNavigationKey({ event })) return;
    handleRecentFlyoutKey({ event, showRecent, hideRecent });
  }, [hideRecent, showRecent]);
}
