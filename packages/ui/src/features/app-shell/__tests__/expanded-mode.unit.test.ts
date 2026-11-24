// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { COLLAPSE_KEY, chromeVisibility, expandedAfterKeyDown, expandedAfterWorkspaceChange, nextExpanded, workspaceOnScreen } from "../expanded-mode.js";
import { useExpandedMode, type KeydownTarget } from "../use-expanded-mode.hooks.js";

/** A keydown target that counts live listeners, so the listener's lifetime is asserted too. */
function countingTarget() {
  const listeners = new Set<EventListener>();
  const port = {
    addEventListener: (_type: string, listener: EventListener) => { listeners.add(listener); },
    removeEventListener: (_type: string, listener: EventListener) => { listeners.delete(listener); },
  } as unknown as KeydownTarget;
  const press = (key: string) => act(() => { for (const listener of [...listeners]) listener({ key } as unknown as Event); });
  return { port, press, live: () => listeners.size };
}

describe("expanded-mode rules", () => {
  it("toggles, collapses only on Escape, and never outlives its workspace", () => {
    expect([nextExpanded({ expanded: false }), nextExpanded({ expanded: true })]).toEqual([true, false]);
    expect(COLLAPSE_KEY).toBe("Escape");
    expect([expandedAfterKeyDown({ expanded: true, key: "Escape" }), expandedAfterKeyDown({ expanded: true, key: "a" }), expandedAfterKeyDown({ expanded: false, key: "a" })]).toEqual([false, true, false]);
    expect([expandedAfterWorkspaceChange({ expanded: true, showSiteTab: true }), expandedAfterWorkspaceChange({ expanded: true, showSiteTab: false })]).toEqual([true, false]);
  });

  it("keeps exactly the visible workspace on screen, and hides only the top nav and tab strip", () => {
    expect(workspaceOnScreen({ inSites: true, projectId: "a", visibleWorkspaceId: "a" })).toBe(true);
    expect(workspaceOnScreen({ inSites: true, projectId: "a", visibleWorkspaceId: null })).toBe(false);
    expect(workspaceOnScreen({ inSites: false, projectId: "a", visibleWorkspaceId: "a" })).toBe(false);
    expect(chromeVisibility({ expanded: false, inSites: true, appearanceOpen: false })).toEqual({ showTopNav: true, showTabStrip: true });
    expect(chromeVisibility({ expanded: true, inSites: true, appearanceOpen: false })).toEqual({ showTopNav: false, showTabStrip: false });
    expect(chromeVisibility({ expanded: false, inSites: true, appearanceOpen: true }).showTabStrip).toBe(false);
  });
});

describe("useExpandedMode", () => {
  it("listens for Escape only while expanded, collapses when the workspace goes, and detaches on unmount", () => {
    const keys = countingTarget();
    const view = renderHook(({ showSiteTab }) => useExpandedMode({ showSiteTab }, { target: keys.port }), { initialProps: { showSiteTab: true } });
    expect([view.result.current.expanded, keys.live()]).toEqual([false, 0]);
    act(() => view.result.current.toggleExpanded());
    expect([view.result.current.expanded, keys.live()]).toEqual([true, 1]);
    keys.press("Enter");
    expect(view.result.current.expanded).toBe(true);
    keys.press("Escape");
    expect([view.result.current.expanded, keys.live()]).toEqual([false, 0]);
    act(() => view.result.current.toggleExpanded());
    view.rerender({ showSiteTab: false });
    expect([view.result.current.expanded, keys.live()]).toEqual([false, 0]);
    view.rerender({ showSiteTab: true });
    expect(view.result.current.expanded).toBe(false);
    act(() => view.result.current.toggleExpanded());
    view.unmount();
    expect(keys.live()).toBe(0);
  });

  it("defaults to the window", () => {
    const view = renderHook(() => useExpandedMode({ showSiteTab: true }));
    act(() => view.result.current.toggleExpanded());
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(view.result.current.expanded).toBe(false);
  });
});
