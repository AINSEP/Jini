// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { DEFAULT_SITE_LIST_PREFS, type SiteListItem, type SiteListPrefs } from "../site-list-view.js";
import { useSiteListView } from "../use-site-list-view.hooks.js";

const items: SiteListItem[] = [
  { id: "a", name: "a", createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "b", name: "b", createdAt: "2026-01-02T00:00:00.000Z" },
];

function setup(initial: Partial<SiteListPrefs> = {}) {
  const writes: SiteListPrefs[] = [];
  const { result } = renderHook(() => {
    const [prefs, setPrefs] = useState<SiteListPrefs>({ ...DEFAULT_SITE_LIST_PREFS, ...initial });
    return useSiteListView({ items, prefs, onPrefsChange: (next) => { writes.push(next); setPrefs(next); } });
  });
  return { result, writes };
}

describe("useSiteListView", () => {
  it("hands each change to the host, which stores it", () => {
    const { result, writes } = setup();
    act(() => result.current.setSort("name"));
    act(() => result.current.togglePin("a"));
    act(() => result.current.toggleHidden("b"));
    expect(writes.at(-1)).toEqual({ sort: "name", pinned: ["a"], hidden: ["b"] });
    expect(result.current.isPinned("a")).toBe(true);
    expect(result.current.isHidden("b")).toBe(true);
    expect(result.current.sort).toBe("name");
  });

  it("does not store the open filter", () => {
    const { result, writes } = setup({ hidden: ["a"] });
    act(() => result.current.setFilter("hidden"));
    expect(result.current.filter).toBe("hidden");
    expect(writes).toEqual([]);
  });

  it("returns to the default view once the last hidden site is shown again", () => {
    const { result } = setup({ hidden: ["a"] });
    act(() => result.current.setFilter("hidden"));
    expect(result.current.visible.map((item) => item.id)).toEqual(["a"]);
    act(() => result.current.toggleHidden("a"));
    expect(result.current.filter).toBe("pinned-recent");
    expect(result.current.visible.map((item) => item.id)).toEqual(["b", "a"]);
  });
});
