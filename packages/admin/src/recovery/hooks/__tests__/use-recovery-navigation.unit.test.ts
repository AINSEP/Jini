// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AdminRestorePoint } from "../../../core/ports/database.js";
import { useRecoveryNavigation } from "../use-recovery-navigation.hooks.js";

/** Owner's 2026-09-10 consolidation (recorded in the host todo log): the inline tab shell remains
 * URL-controlled, and selecting/backing out of a point never performs a restore itself. */
const point: AdminRestorePoint = {
  id: "rp-navigation", trigger: "manual", costClass: "cheap", kind: "full",
  watermarkAtCapture: 42, createdAt: "2026-10-04T12:00:00.000Z",
};

describe("Recovery shell navigation", () => {
  it.each([undefined, null, "", "bogus"])("defaults an absent or invalid tab (%s) to the list", (tabId) => {
    const { result } = renderHook(() => useRecoveryNavigation({ tabId, setSelected: vi.fn(), port: { navigate: vi.fn() } }));
    expect(result.current.activeTabId).toBe("restore-points");
  });

  it("reads the active tab from the URL prop on every render", () => {
    const setSelected = vi.fn();
    const port = { navigate: vi.fn() };
    const { result, rerender } = renderHook(({ tabId }) => useRecoveryNavigation({ tabId, setSelected, port }), {
      initialProps: { tabId: "restore" },
    });
    expect(result.current.activeTabId).toBe("restore");
    rerender({ tabId: "restore-points" });
    expect(result.current.activeTabId).toBe("restore-points");
    expect(setSelected).not.toHaveBeenCalled();
    expect(port.navigate).not.toHaveBeenCalled();
  });

  it("switches tabs by replacing history and preserves the selected point", () => {
    const setSelected = vi.fn();
    const port = { navigate: vi.fn() };
    const { result } = renderHook(() => useRecoveryNavigation({ setSelected, port }));
    act(() => result.current.onTabChange("restore"));
    expect(port.navigate).toHaveBeenCalledTimes(1);
    expect(port.navigate).toHaveBeenCalledWith({ routePath: "/recovery?tab=restore" }, { replace: true });
    expect(setSelected).not.toHaveBeenCalled();
    // A controlled shell waits for the router prop, rather than showing a different tab to its URL.
    expect(result.current.activeTabId).toBe("restore-points");
  });

  it("selects the actual row before entering the ceremony, and clears it when backing out", () => {
    const events: unknown[] = [];
    const setSelected = vi.fn((value: AdminRestorePoint | null) => { events.push(value); });
    const port = { navigate: vi.fn(({ routePath }: { routePath: string }) => { events.push(routePath); }) };
    const { result } = renderHook(() => useRecoveryNavigation({ setSelected, port }));
    act(() => result.current.onSelectPoint(point));
    expect(events).toEqual([point, "/recovery?tab=restore"]);
    expect(port.navigate).toHaveBeenLastCalledWith({ routePath: "/recovery?tab=restore" }, { replace: true });
    act(() => result.current.onBackFromFlow());
    expect(events).toEqual([point, "/recovery?tab=restore", null, "/recovery?tab=restore-points"]);
    expect(port.navigate).toHaveBeenLastCalledWith({ routePath: "/recovery?tab=restore-points" }, { replace: true });
  });
});
