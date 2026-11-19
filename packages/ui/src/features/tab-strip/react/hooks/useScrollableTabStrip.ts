import { useEffect, useRef, useState } from 'react';
import { navigateTabList, revealActiveTab, rovingTabIndex, tabOverflow } from '../../scrollable.js';

/** Recheck on resize as well as selection: the active tab can leave view without a tab change. */
export function useScrollableTabStrip(
  { activeTab, tabs }: { activeTab: string | null; tabs: readonly { id: string; label: string }[] },
  { ResizeObserverImpl = globalThis.ResizeObserver, activeSelector }: {
    /** The resize port; defaults to the browser's `ResizeObserver`. */
    ResizeObserverImpl?: typeof ResizeObserver;
    activeSelector?: string | undefined;
  } = {},
) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });
  const tabKey = JSON.stringify(tabs.map((tab) => [tab.id, tab.label]));
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return undefined;
    const update = () => setOverflow(tabOverflow({ strip }));
    const reveal = () => { revealActiveTab({ strip, activeSelector }); update(); };
    reveal();
    const observer = new ResizeObserverImpl(reveal);
    observer.observe(strip);
    strip.addEventListener('scroll', update);
    return () => { observer.disconnect(); strip.removeEventListener('scroll', update); };
  }, [activeTab, tabKey, ResizeObserverImpl, activeSelector]);
  const scrollLeft = () => stripRef.current?.scrollBy({ left: -200, behavior: 'smooth' });
  const scrollRight = () => stripRef.current?.scrollBy({ left: 200, behavior: 'smooth' });
  const tabIndex = ({ tabId }: { tabId: string | null }, _options: Record<string, never> = {}) =>
    rovingTabIndex({ activeId: activeTab, tabIds: tabs.map((tab) => tab.id), tabId });
  const onKeyDown = (event: Parameters<typeof navigateTabList>[0]['event']) => {
    if (stripRef.current) navigateTabList({ strip: stripRef.current, event });
  };
  // Arrows exist only while the strip actually overflows; otherwise they read as dead controls.
  return { stripRef, overflow, showArrows: overflow.left || overflow.right, scrollLeft, scrollRight, tabIndex, onKeyDown };
}
