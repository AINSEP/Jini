import { describe, expect, it, vi } from 'vitest';
import { scrollTabsWithWheel } from '../scroll-tabs-with-wheel.js';

/** A minimal overflowing tab-bar double: `scrollLeft` clamps to `[0, maxScrollLeft]`,
 *  matching how a real `HTMLDivElement` clamps writes at its scroll boundaries. */
function createTabBar(opts: { clientWidth: number; scrollWidth: number; scrollLeft?: number }) {
  const maxScrollLeft = Math.max(0, opts.scrollWidth - opts.clientWidth);
  let scrollLeft = opts.scrollLeft ?? 0;
  return {
    clientWidth: opts.clientWidth,
    scrollWidth: opts.scrollWidth,
    get scrollLeft() {
      return scrollLeft;
    },
    set scrollLeft(value: number) {
      scrollLeft = Math.max(0, Math.min(maxScrollLeft, value));
    },
  };
}

function createWheelEvent(overrides: Partial<{ ctrlKey: boolean; deltaMode: number; deltaX: number; deltaY: number }> = {}) {
  return {
    ctrlKey: false,
    deltaMode: 0,
    deltaX: 0,
    deltaY: 0,
    ...overrides,
    preventDefault: vi.fn(),
  };
}

describe('scrollTabsWithWheel', () => {
  it('scrolls right on positive deltaY (pixel mode) and prevents default', () => {
    const tabBar = createTabBar({ clientWidth: 200, scrollWidth: 500 });
    const event = createWheelEvent({ deltaY: 40 });

    scrollTabsWithWheel({ tabBar, event });

    expect(tabBar.scrollLeft).toBe(40);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('scrolls left on negative deltaY', () => {
    const tabBar = createTabBar({ clientWidth: 200, scrollWidth: 500, scrollLeft: 100 });
    const event = createWheelEvent({ deltaY: -30 });

    scrollTabsWithWheel({ tabBar, event });

    expect(tabBar.scrollLeft).toBe(70);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('converts line-mode delta to 16px per line', () => {
    const tabBar = createTabBar({ clientWidth: 200, scrollWidth: 500 });
    const event = createWheelEvent({ deltaY: 2, deltaMode: 1 });

    scrollTabsWithWheel({ tabBar, event });

    expect(tabBar.scrollLeft).toBe(32);
  });

  it('converts page-mode delta to 160px per page', () => {
    const tabBar = createTabBar({ clientWidth: 200, scrollWidth: 500 });
    const event = createWheelEvent({ deltaY: 1, deltaMode: 2 });

    scrollTabsWithWheel({ tabBar, event });

    expect(tabBar.scrollLeft).toBe(160);
  });

  it('treats an unrecognized deltaMode as pixels (falls through)', () => {
    const tabBar = createTabBar({ clientWidth: 200, scrollWidth: 500 });
    const event = createWheelEvent({ deltaY: 25, deltaMode: 99 });

    scrollTabsWithWheel({ tabBar, event });

    expect(tabBar.scrollLeft).toBe(25);
  });

  it('ignores a ctrl+wheel pinch-zoom gesture entirely', () => {
    const tabBar = createTabBar({ clientWidth: 200, scrollWidth: 500 });
    const event = createWheelEvent({ deltaY: 40, ctrlKey: true });

    scrollTabsWithWheel({ tabBar, event });

    expect(tabBar.scrollLeft).toBe(0);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('ignores the event when horizontal delta is dominant (a native horizontal swipe)', () => {
    const tabBar = createTabBar({ clientWidth: 200, scrollWidth: 500 });
    const event = createWheelEvent({ deltaY: 10, deltaX: 20 });

    scrollTabsWithWheel({ tabBar, event });

    expect(tabBar.scrollLeft).toBe(0);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('treats exactly-equal deltaX/deltaY as not vertical-dominant and skips', () => {
    const tabBar = createTabBar({ clientWidth: 200, scrollWidth: 500 });
    const event = createWheelEvent({ deltaY: 15, deltaX: 15 });

    scrollTabsWithWheel({ tabBar, event });

    expect(tabBar.scrollLeft).toBe(0);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('does nothing when the strip is not overflowing', () => {
    const tabBar = createTabBar({ clientWidth: 500, scrollWidth: 500 });
    const event = createWheelEvent({ deltaY: 40 });

    scrollTabsWithWheel({ tabBar, event });

    expect(tabBar.scrollLeft).toBe(0);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('does not call preventDefault when already at the scroll boundary (no-op scroll)', () => {
    const tabBar = createTabBar({ clientWidth: 200, scrollWidth: 500, scrollLeft: 300 });
    const event = createWheelEvent({ deltaY: 40 });

    scrollTabsWithWheel({ tabBar, event });

    expect(tabBar.scrollLeft).toBe(300);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
