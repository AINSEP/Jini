import { describe, expect, it } from "vitest";
import { DEFAULT_SITE_LIST_PREFS, parseSiteListPrefs, siteListView, SITE_LIST_RECENT_COUNT, toggleListed, type SiteListFilter, type SiteListItem, type SiteListPrefs } from "../site-list-view";

const site = (id: string, day: number, name = id): SiteListItem => ({ id, name, createdAt: `2026-01-${String(day).padStart(2, "0")}T00:00:00.000Z` });
const ids = (items: readonly SiteListItem[]) => items.map((item) => item.id);
const view = (items: readonly SiteListItem[], prefs: Partial<SiteListPrefs> = {}, filter: SiteListFilter = "all") =>
  siteListView({ items, prefs: { ...DEFAULT_SITE_LIST_PREFS, ...prefs }, filter });

describe("parseSiteListPrefs", () => {
  it("reads a stored value and drops what does not belong", () => {
    expect(parseSiteListPrefs({ stored: { sort: "name", pinned: ["a", 1], hidden: ["b"], extra: true } })).toEqual({ sort: "name", pinned: ["a"], hidden: ["b"] });
  });

  it.each([[null], [undefined], ["text"], [3]])("falls back to the defaults for %s", (stored) => {
    expect(parseSiteListPrefs({ stored })).toEqual(DEFAULT_SITE_LIST_PREFS);
  });

  it("falls back per field for an unknown sort or a non-list", () => {
    expect(parseSiteListPrefs({ stored: { sort: "size", pinned: "a" } })).toEqual(DEFAULT_SITE_LIST_PREFS);
  });
});

describe("siteListView sorting", () => {
  const items = [site("b", 2), site("a", 3, "Zed"), site("c", 1, "alpha")];

  it("is most recently created first by default", () => {
    expect(ids(view(items).visible)).toEqual(["a", "b", "c"]);
  });

  it("sorts oldest first", () => {
    expect(ids(view(items, { sort: "oldest" }).visible)).toEqual(["c", "b", "a"]);
  });

  it("sorts A-Z without regard to case", () => {
    expect(ids(view(items, { sort: "name" }).visible)).toEqual(["c", "b", "a"]);
    expect(ids(view([site("x", 1, "beta"), site("y", 2, "Alpha")], { sort: "name" }).visible)).toEqual(["y", "x"]);
  });

  it("puts a site with a missing or unreadable date last when newest first, and breaks ties by name", () => {
    const undated = { id: "u", name: "u", createdAt: "" };
    expect(ids(view([undated, site("n", 1)]).visible)).toEqual(["n", "u"]);
    expect(ids(view([site("z", 1), site("m", 1)]).visible)).toEqual(["m", "z"]);
  });

  it("keeps pinned sites first whatever the sort", () => {
    expect(ids(view(items, { pinned: ["c"] }).visible)).toEqual(["c", "a", "b"]);
    expect(ids(view(items, { pinned: ["a"], sort: "oldest" }).visible)).toEqual(["a", "c", "b"]);
  });
});

describe("siteListView filters", () => {
  const many = Array.from({ length: SITE_LIST_RECENT_COUNT + 2 }, (_, index) => site(`s${index + 1}`, index + 1));

  it("shows the newest sites by default and leaves the rest to All sites", () => {
    const result = view(many, {}, "pinned-recent");
    expect(result.visible).toHaveLength(SITE_LIST_RECENT_COUNT);
    expect(ids(result.visible)).not.toContain("s1");
    expect(ids(result.visible)).not.toContain("s2");
    expect(result.allCount).toBe(SITE_LIST_RECENT_COUNT + 2);
  });

  it("shows an older pinned site by default as well, first", () => {
    const result = view(many, { pinned: ["s1"] }, "pinned-recent");
    expect(result.visible).toHaveLength(SITE_LIST_RECENT_COUNT + 1);
    expect(result.visible[0]!.id).toBe("s1");
  });

  it("takes Recent by creation date even when the chosen sort is another", () => {
    const result = view(many, { sort: "oldest" }, "pinned-recent");
    expect(ids(result.visible)).not.toContain("s1");
    expect(result.visible[0]!.id).toBe("s3");
  });

  it("does not let a hidden site take a Recent place", () => {
    const newest = `s${many.length}`;
    const result = view(many, { hidden: [newest] }, "pinned-recent");
    expect(ids(result.visible)).not.toContain(newest);
    expect(ids(result.visible)).toContain("s2");
  });

  it("takes a hidden site out of every view but Hidden, even when pinned, and counts it apart", () => {
    const items = [site("a", 1), site("b", 2)];
    const prefs = { hidden: ["a"], pinned: ["a"] };
    expect(ids(view(items, prefs, "pinned-recent").visible)).toEqual(["b"]);
    expect(ids(view(items, prefs, "all").visible)).toEqual(["b"]);
    expect(ids(view(items, prefs, "hidden").visible)).toEqual(["a"]);
    expect(view(items, prefs, "all")).toMatchObject({ allCount: 1, hiddenCount: 1 });
  });

  it("does not count ids of sites that no longer exist", () => {
    expect(view([site("a", 1)], { hidden: ["gone"], pinned: ["gone"] }, "all")).toMatchObject({ allCount: 1, hiddenCount: 0 });
  });

  it("leaves the input order untouched", () => {
    const items = [site("a", 1), site("b", 2)];
    view(items);
    expect(ids(items)).toEqual(["a", "b"]);
  });
});

describe("toggleListed", () => {
  it("adds and removes one id", () => {
    expect(toggleListed({ list: ["a"], id: "b" })).toEqual(["a", "b"]);
    expect(toggleListed({ list: ["a", "b"], id: "a" })).toEqual(["b"]);
  });
});
