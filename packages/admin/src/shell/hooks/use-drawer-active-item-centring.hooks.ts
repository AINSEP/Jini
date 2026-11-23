import { useEffect } from "react";

/**
 * @file Phone nav drawer: when it opens, its active item sits in the vertical middle of the drawer
 * (owner, 2026-10-07). It used to open scrolled to the top every time (`Sidebar.MobileHeader`
 * focuses the close button at the top on open), so an item far down the 26-item list, like
 * Integrations, had to be found by hand on every visit.
 *
 * The drawer (`.cms-nav`) is its own scroll container, so this sets ITS `scrollTop` directly rather
 * than calling `scrollIntoView`: that would also scroll every scrollable ancestor, including the
 * page behind the drawer. Near either end of the list the offset clamps, so the first items stay
 * at the top and the last at the bottom instead of leaving empty space.
 *
 * Runs in this App-level effect, after the Sidebar's own child effect has moved focus to the close
 * button (React runs child effects first), so the focus move's scroll cannot undo it.
 */

/** Selector for the drawer's current page link (`@jini-ai/admin`'s `Sidebar` sets `aria-current`). */
const ACTIVE_ITEM_SELECTOR = '.cms-item[aria-current="page"]';

/** The parts of a scroll container this reads and writes — an `HTMLElement` satisfies it. */
export interface ScrollContainer {
  scrollTop: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
  getBoundingClientRect(): { top: number };
  querySelector(selector: string): { getBoundingClientRect(): { top: number; height: number } } | null;
}

/**
 * The scroll offset that puts an item's centre at the viewport's centre, clamped to the range the
 * container can actually scroll.
 *
 * @param input.itemStart - The item's offset from the start of the scrolled content.
 * @param input.itemSize - The item's size along the scroll axis.
 * @param input.viewportSize - The container's visible size along that axis.
 * @param input.scrollSize - The full scrollable size along that axis.
 * @complexity O(1).
 */
export function centredScrollOffset(input: {
  itemStart: number;
  itemSize: number;
  viewportSize: number;
  scrollSize: number;
}): number {
  const ideal = input.itemStart + input.itemSize / 2 - input.viewportSize / 2;
  const max = Math.max(0, input.scrollSize - input.viewportSize);
  return Math.min(max, Math.max(0, ideal));
}

/**
 * Scrolls `drawer` so its active item is vertically centred. No-op without an active item, or when
 * that item takes no space (it sits in a collapsed nav section).
 *
 * @complexity O(items) for the selector lookup.
 */
export function centreActiveDrawerItem(drawer: ScrollContainer): void {
  const item = drawer.querySelector(ACTIVE_ITEM_SELECTOR);
  if (!item) return;
  const itemRect = item.getBoundingClientRect();
  if (itemRect.height === 0) return;
  drawer.scrollTop = centredScrollOffset({
    itemStart: itemRect.top - drawer.getBoundingClientRect().top + drawer.scrollTop,
    itemSize: itemRect.height,
    viewportSize: drawer.clientHeight,
    scrollSize: drawer.scrollHeight,
  });
}

/** Finds the drawer element; `App.tsx`'s `<Sidebar>` renders `<nav id="admin-sidebar">`. */
export type FindDrawer = () => ScrollContainer | null;

const findAdminSidebar: FindDrawer = () => document.getElementById("admin-sidebar");

/**
 * Centres the active nav item each time the drawer opens. Closing does nothing, and an open
 * drawer is never re-scrolled under the operator's finger.
 *
 * @param input.open - The drawer's open state (`useSidebarDrawer`).
 * @param deps.findDrawer - Where the drawer is. @default `#admin-sidebar`
 */
export function useDrawerActiveItemCentring(
  { open }: { open: boolean },
  { findDrawer = findAdminSidebar }: { findDrawer?: FindDrawer } = {},
): void {
  useEffect(() => {
    if (!open) return;
    const drawer = findDrawer();
    if (drawer) centreActiveDrawerItem(drawer);
  }, [open, findDrawer]);
}
