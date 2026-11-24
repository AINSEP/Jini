// @vitest-environment jsdom
import { act, renderHook, waitFor } from "../../../__tests__/fetch-query-support.js";
import { describe, expect, it, vi } from "vitest";
import { useCachedLoader, useDirtyGuard, useFetchQuery } from "../../../react/kit.js";
import type { AdminMenu } from "../api/menus-api.types.js";
import { createFakeMenusPort } from "../hooks/menus-dependencies.hooks.js";
import { useMenuEditor } from "../hooks/use-menu-editor.hooks.js";
import { useMenuEditorState, useMenuFieldActions, useMenuItemActions } from "../hooks/use-menu-editor-state.hooks.js";
import { useMenuCopyEmbed, useMenuSave } from "../hooks/use-menu-editor-writes.hooks.js";
import type { MenusApiErrorLike, MenusHostKit } from "../menus-host-kit.js";

/**
 * @file `useMenuEditor` against the in-memory `MenusPort` and a stub `MenusHostKit`: pins that every
 * host collaborator (version-conflict test and copy key, slug rule, slug-redirect rule, failure
 * channel) is reached through `deps.kit`, and that the split sub-hooks still compose the same
 * controller (load, tree edits, save).
 */

const MENU: AdminMenu = {
  id: "m1", workspaceId: "ws1", slug: "main", title: "Main menu", status: "draft",
  items: [{ id: "i1", label: "Home", target: { kind: "url", href: "/" } }], locations: [],
  updatedAt: "2026-08-01T00:00:00.000Z", version: 1,
};

function stubKit(overrides: Partial<MenusHostKit> = {}): MenusHostKit {
  return {
    isApiError: (_e: unknown): _e is MenusApiErrorLike => false,
    isVersionConflict: () => false,
    versionConflictMessage: "CONFLICT_KEY",
    toSlug: ({ text }) => `slug:${text}`,
    slugRedirectPath: () => null,
    failures: { getGeneration: () => 7, isClipboardRefusal: () => false, publishLocal: vi.fn() },
    useMenuEditorState, useMenuFieldActions, useMenuItemActions, useMenuCopyEmbed, useMenuSave,
    useCachedLoader, useDirtyGuard, useFetchQuery,
    ...overrides,
  };
}

describe("useMenuEditor — host kit collaborators", () => {
  it("reaches the loader, dirty guard and page query only through the kit's injected hooks", async () => {
    const port = createFakeMenusPort({ menus: [MENU] });
    const spyLoader = vi.fn(useCachedLoader) as unknown as MenusHostKit["useCachedLoader"];
    const spyGuard = vi.fn(useDirtyGuard) as unknown as MenusHostKit["useDirtyGuard"];
    const spyQuery = vi.fn(useFetchQuery) as unknown as MenusHostKit["useFetchQuery"];
    const kit = stubKit({ useCachedLoader: spyLoader, useDirtyGuard: spyGuard, useFetchQuery: spyQuery });
    const { result } = renderHook(() => useMenuEditor({ menuId: "m1", dependencies: { port, navigate: vi.fn(), t: (k) => k, kit } }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(spyLoader).toHaveBeenCalled();
    expect(spyGuard).toHaveBeenCalled();
    expect(spyQuery).toHaveBeenCalled();
  });

  it("loads the menu and follows the kit's slug-redirect rule with replace", async () => {
    const navigate = vi.fn();
    const slugRedirectPath = vi.fn(() => "/menus/main");
    const port = createFakeMenusPort({ menus: [MENU] });
    const { result } = renderHook(() => useMenuEditor({ menuId: "m1", dependencies: { port, navigate, t: (k) => k, kit: stubKit({ slugRedirectPath }) } }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.title).toBe("Main menu");
    expect(slugRedirectPath).toHaveBeenCalledWith({ base: "/menus", requestedId: "m1", item: MENU });
    expect(navigate).toHaveBeenCalledWith("/menus/main", { replace: true });
  });

  it("derives a new menu's slug through kit.toSlug until the slug is edited", async () => {
    const port = createFakeMenusPort();
    const { result } = renderHook(() => useMenuEditor({ menuId: null, dependencies: { port, navigate: vi.fn(), t: (k) => k, kit: stubKit() } }));
    act(() => result.current.setTitle({ next: "Footer" }));
    expect(result.current.slug).toBe("slug:Footer");
    act(() => result.current.setSlug({ next: "" }));
    act(() => result.current.setTitle({ next: "Other" }));
    expect(result.current.slug).toBe("");
  });

  it("shows the translated kit version-conflict copy when kit.isVersionConflict matches", async () => {
    const port = createFakeMenusPort({ menus: [MENU] });
    port.updateMenuTree = vi.fn().mockRejectedValue(new Error("server text"));
    const kit = stubKit({ isVersionConflict: () => true });
    const { result } = renderHook(() => useMenuEditor({ menuId: "m1", dependencies: { port, navigate: vi.fn(), t: (k) => `t:${k}`, kit } }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.save(); });
    expect(result.current.error).toBe("t:CONFLICT_KEY");
  });

  it("reports a non-refusal copy failure through kit.failures with the pre-await generation", async () => {
    const port = createFakeMenusPort({ menus: [MENU] });
    const kit = stubKit();
    const clipboard = { writeText: vi.fn().mockRejectedValue(new Error("denied")) };
    const { result } = renderHook(() => useMenuEditor({ menuId: "m1", dependencies: { port, navigate: vi.fn(), t: (k) => k, kit, clipboard } }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.copyHtmlEmbed(); });
    expect(result.current.copyFeedback).toBe("Could not copy embed");
    expect(kit.failures.publishLocal).toHaveBeenCalledWith(expect.objectContaining({ step: "Copy menu embed code" }), { generation: 7 });
  });

  it("composes the tree actions and saves the edited tree", async () => {
    const port = createFakeMenusPort({ menus: [MENU] });
    const itemIdSource = { nowMs: () => 1, random: () => 0.5 };
    const { result } = renderHook(() => useMenuEditor({ menuId: "m1", dependencies: { port, navigate: vi.fn(), t: (k) => k, kit: stubKit(), itemIdSource } }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.addRootItem());
    act(() => result.current.moveAt({ path: [1], direction: -1 }));
    expect(result.current.items.map((item) => item.id)).toEqual(["item-1-i", "i1"]);
    await act(async () => { await result.current.save(); });
    expect(result.current.message).toBe("Saved · version 2");
    expect(result.current.saving).toBe(false);
  });
});
