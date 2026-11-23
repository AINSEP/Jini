// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSkillsTabs } from "../use-skills-tabs.hooks.js";

/**
 * The Skills tabs hook is URL-backed: the active tab is read from `?tab=` on the admin route and a tab
 * change is a replacement navigation to `/addons/skills?tab=<id>`, so the back button never walks
 * through tab clicks. Driven through the real router (`replaceState`) rather than a mocked one.
 */

function at(url: string) {
  window.history.replaceState(null, "", url);
}

beforeEach(() => at("/admin/addons/skills"));
afterEach(() => at("/"));

describe("useSkillsTabs", () => {
  it("defaults to the skills tab when the URL has no tab, or an unknown one", () => {
    expect(renderHook(() => useSkillsTabs()).result.current.activeTabId).toBe("skills");
    at("/admin/addons/skills?tab=nonsense");
    expect(renderHook(() => useSkillsTabs()).result.current.activeTabId).toBe("skills");
  });

  it("reads the add tab from ?tab=add", () => {
    at("/admin/addons/skills?tab=add");
    expect(renderHook(() => useSkillsTabs()).result.current.activeTabId).toBe("add");
  });

  it("onTabChange replaces the URL with the resolved tab and the hook follows it", () => {
    const before = window.history.length;
    const { result } = renderHook(() => useSkillsTabs());
    act(() => result.current.onTabChange("add"));
    expect(window.location.pathname + window.location.search).toBe("/admin/addons/skills?tab=add");
    expect(result.current.activeTabId).toBe("add");
    // An unknown tab id falls back to the default rather than being written into the URL.
    act(() => result.current.onTabChange("bogus"));
    expect(window.location.pathname + window.location.search).toBe("/admin/addons/skills?tab=skills");
    expect(result.current.activeTabId).toBe("skills");
    expect(window.history.length).toBe(before);
  });

  it("onShowAdd and onShowSkills navigate to their tab", () => {
    const { result } = renderHook(() => useSkillsTabs());
    act(() => result.current.onShowAdd());
    expect(window.location.search).toBe("?tab=add");
    act(() => result.current.onShowSkills());
    expect(window.location.search).toBe("?tab=skills");
  });
});
