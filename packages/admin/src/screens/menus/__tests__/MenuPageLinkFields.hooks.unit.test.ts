// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import type { ChangeEvent } from "react";
import { describe, expect, it } from "vitest";
import type { AdminMenuItem } from "../api/menus-api.types.js";
import { useMenuPageLinkFields, useMenuTargetEditor } from "../MenuPageLinkFields.hooks.js";

/**
 * The two menu-target controllers: the target-type select and the page select. Both reshape the
 * item through the caller's `onChange(path, update)`; these tests apply that update to a real
 * previous item and assert the resulting target.
 */

const pages = [
  { id: "about", title: "Our story", status: "published" as const, publicPath: "/about" },
  { id: "draft", title: "Draft", status: "draft" as const },
];

function select(value: string) {
  return { currentTarget: { value } } as unknown as ChangeEvent<HTMLSelectElement>;
}

function recorder(item: AdminMenuItem) {
  const updates: { path: number[]; next: AdminMenuItem }[] = [];
  return { updates, onChange: (path: number[], update: (previous: AdminMenuItem) => AdminMenuItem) => { updates.push({ path, next: update(item) }); } };
}

describe("useMenuTargetEditor", () => {
  it("reports a hinted page reference as a page and a URL target as a URL", () => {
    const pageItem: AdminMenuItem = { id: "a", label: "About", target: { kind: "entryRef", entryId: "about", entryType: "page" } as AdminMenuItem["target"] };
    const urlItem: AdminMenuItem = { id: "b", label: "Docs", target: { kind: "url", href: "https://docs.example" } };
    expect(renderHook(() => useMenuTargetEditor({ item: pageItem, path: [0], onChange: () => {} })).result.current).toMatchObject({ kind: "page", isPage: true });
    expect(renderHook(() => useMenuTargetEditor({ item: urlItem, path: [0], onChange: () => {} })).result.current).toMatchObject({ kind: "url", isPage: false });
  });

  it("recognises an unhinted legacy reference as a page only once the catalogue lists it", () => {
    const legacy: AdminMenuItem = { id: "a", label: "About", target: { kind: "entryRef", entryId: "about" } };
    expect(renderHook(() => useMenuTargetEditor({ item: legacy, path: [0], onChange: () => {} })).result.current.kind).toBe("entryRef");
    expect(renderHook(() => useMenuTargetEditor({ item: legacy, path: [0], pages, onChange: () => {} })).result.current.kind).toBe("page");
  });

  it("reshapes the target for the chosen kind, keeping what carries over, at the item's path", () => {
    const item: AdminMenuItem = { id: "a", label: "Docs", target: { kind: "url", href: "https://docs.example" } };
    const { updates, onChange } = recorder(item);
    const { result } = renderHook(() => useMenuTargetEditor({ item, path: [2, 1], onChange }));
    result.current.selectType(select("page"));
    result.current.selectType(select("route"));
    expect(updates).toEqual([
      { path: [2, 1], next: { ...item, target: { kind: "entryRef", entryId: "", entryType: "page", lastKnownHref: "https://docs.example" } } },
      { path: [2, 1], next: { ...item, target: { kind: "route", route: "" } } },
    ]);
  });
});

describe("useMenuPageLinkFields", () => {
  it("exposes the selected page, its choices and whether it is unavailable", () => {
    const item: AdminMenuItem = { id: "a", label: "Old draft", target: { kind: "entryRef", entryId: "draft" } };
    const { result } = renderHook(() => useMenuPageLinkFields({ item, path: [0], pages, t: (key) => `«${key}»`, onChange: () => {} }));
    expect(result.current.value).toBe("draft");
    expect(result.current.unavailable).toBe(true);
    expect(result.current.choices.map((choice) => choice.id)).toEqual(["", "about", "draft"]);
    expect(result.current.choices[0]!.title).toBe("«Choose a page…»");
  });

  it("points the item at the chosen page with its public path snapshot", () => {
    const item: AdminMenuItem = { id: "a", label: "About", target: { kind: "url", href: "/x" } };
    const { updates, onChange } = recorder(item);
    const { result } = renderHook(() => useMenuPageLinkFields({ item, path: [3], pages, t: (key) => key, onChange }));
    result.current.selectPage(select("about"));
    result.current.selectPage(select("draft"));
    expect(updates).toEqual([
      { path: [3], next: { ...item, target: { kind: "entryRef", entryId: "about", entryType: "page", lastKnownHref: "/about" } } },
      { path: [3], next: { ...item, target: { kind: "entryRef", entryId: "draft", entryType: "page" } } },
    ]);
  });
});
