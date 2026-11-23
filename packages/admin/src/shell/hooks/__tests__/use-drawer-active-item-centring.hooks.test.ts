// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  centreActiveDrawerItem,
  centredScrollOffset,
  useDrawerActiveItemCentring,
  type ScrollContainer,
} from "../use-drawer-active-item-centring.hooks.js";

/**
 * @file The phone nav drawer opens with its active item vertically centred (owner, 2026-10-07).
 * jsdom has no layout, so the drawer is a fake {@link ScrollContainer} with fixed geometry: a
 * 600px-tall drawer whose content is 1400px, items 40px tall.
 */

const VIEWPORT = 600;
const CONTENT = 1400;

/** A drawer at viewport top 100, already scrolled to `scrollTop`, whose active item starts
 *  `itemStart` px into the content (or has no active item / a zero-height one). */
function fakeDrawer(options: { itemStart?: number; itemHeight?: number; scrollTop?: number }) {
  const drawerTop = 100;
  const queried: string[] = [];
  const drawer: ScrollContainer = {
    scrollTop: options.scrollTop ?? 0,
    clientHeight: VIEWPORT,
    scrollHeight: CONTENT,
    getBoundingClientRect: () => ({ top: drawerTop }),
    querySelector: (selector) => {
      queried.push(selector);
      if (options.itemStart === undefined) return null;
      const itemStart = options.itemStart;
      return {
        getBoundingClientRect: () => ({ top: drawerTop + itemStart - drawer.scrollTop, height: options.itemHeight ?? 40 }),
      };
    },
  };
  return { drawer, queried };
}

describe("centredScrollOffset", () => {
  it("puts the item's centre at the viewport's centre", () => {
    expect(centredScrollOffset({ itemStart: 700, itemSize: 40, viewportSize: 600, scrollSize: 1400 })).toBe(420);
  });

  it("clamps to 0 near the top", () => {
    expect(centredScrollOffset({ itemStart: 40, itemSize: 40, viewportSize: 600, scrollSize: 1400 })).toBe(0);
  });

  it("clamps to the maximum scroll near the bottom", () => {
    expect(centredScrollOffset({ itemStart: 1360, itemSize: 40, viewportSize: 600, scrollSize: 1400 })).toBe(800);
  });

  it("is 0 when the content fits without scrolling", () => {
    expect(centredScrollOffset({ itemStart: 300, itemSize: 40, viewportSize: 600, scrollSize: 500 })).toBe(0);
  });
});

describe("centreActiveDrawerItem", () => {
  it("looks up the current page's link", () => {
    const { drawer, queried } = fakeDrawer({});
    centreActiveDrawerItem(drawer);
    expect(queried).toEqual(['.cms-item[aria-current="page"]']);
  });

  it("centres a mid-list item from the top", () => {
    const { drawer } = fakeDrawer({ itemStart: 700 });
    centreActiveDrawerItem(drawer);
    expect(drawer.scrollTop).toBe(420);
  });

  it("measures from the content start whatever the drawer's current scroll", () => {
    const { drawer } = fakeDrawer({ itemStart: 700, scrollTop: 250 });
    centreActiveDrawerItem(drawer);
    expect(drawer.scrollTop).toBe(420);
  });

  it("scrolls only as far as it can for an item near the bottom", () => {
    const { drawer } = fakeDrawer({ itemStart: 1340 });
    centreActiveDrawerItem(drawer);
    expect(drawer.scrollTop).toBe(800);
  });

  it("leaves the scroll alone with no active item", () => {
    const { drawer } = fakeDrawer({ scrollTop: 123 });
    centreActiveDrawerItem(drawer);
    expect(drawer.scrollTop).toBe(123);
  });

  it("leaves the scroll alone when the active item is in a collapsed section", () => {
    const { drawer } = fakeDrawer({ itemStart: 700, itemHeight: 0, scrollTop: 123 });
    centreActiveDrawerItem(drawer);
    expect(drawer.scrollTop).toBe(123);
  });
});

describe("useDrawerActiveItemCentring", () => {
  it("centres on open, not while closed, and not again while it stays open", () => {
    const { drawer } = fakeDrawer({ itemStart: 700 });
    let lookups = 0;
    const findDrawer = () => {
      lookups += 1;
      return drawer;
    };
    const { rerender } = renderHook(({ open }) => useDrawerActiveItemCentring({ open }, { findDrawer }), {
      initialProps: { open: false },
    });
    expect(lookups).toBe(0);
    expect(drawer.scrollTop).toBe(0);

    rerender({ open: true });
    expect(lookups).toBe(1);
    expect(drawer.scrollTop).toBe(420);

    drawer.scrollTop = 50; // the operator scrolls the open drawer
    rerender({ open: true });
    expect(drawer.scrollTop).toBe(50);

    rerender({ open: false });
    rerender({ open: true });
    expect(lookups).toBe(2);
    expect(drawer.scrollTop).toBe(420);
  });

  it("finds the admin sidebar (#admin-sidebar) in the page by default", () => {
    const nav = document.createElement("nav");
    nav.id = "admin-sidebar";
    nav.innerHTML = '<a class="cms-item">Posts</a><a class="cms-item" aria-current="page">SEO</a>';
    Object.defineProperty(nav, "clientHeight", { value: 600 });
    Object.defineProperty(nav, "scrollHeight", { value: 1400 });
    nav.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    (nav.querySelector('[aria-current="page"]') as HTMLElement).getBoundingClientRect = () => ({ top: 800, height: 40 }) as DOMRect;
    document.body.append(nav);
    try {
      renderHook(() => useDrawerActiveItemCentring({ open: true }));
      expect(nav.scrollTop).toBe(420);
    } finally { nav.remove(); }
  });

  it("does nothing when the drawer is not in the page", () => {
    const findDrawer = () => null;
    expect(() => renderHook(() => useDrawerActiveItemCentring({ open: true }, { findDrawer }))).not.toThrow();
  });
});
