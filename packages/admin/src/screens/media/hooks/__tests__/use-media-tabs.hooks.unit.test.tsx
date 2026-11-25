// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useRouteLocation } from "../../../../shell/lib/router.js";
import { resolveActiveTab, useMediaTabs } from "../use-media-tabs.hooks.js";

afterEach(() => window.history.replaceState(null, "", "/"));

describe("media tab resolution", () => {
  // F4.3/F6.2: a resolver always returning all, or permitting arbitrary raw query values, fails.
  it.each(["all", "images", "videos", "external-providers", "trash"] as const)("accepts the %s deep link", (tab) => {
    expect(resolveActiveTab({ tabId: tab })).toBe(tab);
    const { result } = renderHook(() => useMediaTabs(tab));
    expect(result.current.activeTab).toBe(tab);
  });

  it.each([undefined, null, "", "bogus", "Images", "videos ", "__proto__"])("defaults %j to all", (tab) => {
    expect(resolveActiveTab({ tabId: tab })).toBe("all");
  });

  it("takes a changed tab prop on the next render", () => {
    const { result, rerender } = renderHook(({ tab }) => useMediaTabs(tab), { initialProps: { tab: "images" } });
    expect(result.current.activeTab).toBe("images");
    rerender({ tab: "external-providers" });
    expect(result.current.activeTab).toBe("external-providers");
    rerender({ tab: "retired" });
    expect(result.current.activeTab).toBe("all");
  });

  // F2.1/F2.4: changing replace to push, deleting navigate, or writing the wrong route fails.
  // Use the real router and its subscriber rather than a navigate spy.
  it("replaces history on each tab switch and publishes the new route to subscribers", () => {
    window.history.replaceState(null, "", "/admin/media?tab=images");
    const length = window.history.length;
    const { result } = renderHook(() => {
      const route = useRouteLocation();
      const tabs = useMediaTabs(new URLSearchParams(window.location.search).get("tab"));
      return { route, ...tabs };
    });
    expect(result.current.activeTab).toBe("images");
    for (const tab of ["videos", "external-providers", "all", "images"] as const) {
      act(() => result.current.setActiveTab(tab));
      expect(window.location.pathname).toBe("/admin/media");
      expect(window.location.search).toBe(`?tab=${tab}`);
      expect(result.current.route).toBe(`/media?tab=${tab}`);
      expect(result.current.activeTab).toBe(tab);
      expect(window.history.length).toBe(length);
    }
  });
});
