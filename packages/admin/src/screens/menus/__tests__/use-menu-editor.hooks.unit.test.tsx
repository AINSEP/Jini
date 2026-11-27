// @vitest-environment jsdom
import { act, renderHook, waitFor } from "../../../__tests__/fetch-query-support.js";
import { describe, expect, it, vi } from "vitest";
import { useCachedLoader, useDirtyGuard, useFetchQuery } from "../../../react/kit.js";
import { createFakeMenusPort } from "../hooks/menus-dependencies.hooks.js";
import { useMenuEditor } from "../hooks/use-menu-editor.hooks.js";
import type { MenusHostKit } from "../menus-host-kit.js";
import { MENU, stubKit } from "./menus-fixtures.js";

/**
 * @file `useMenuEditor` against the in-memory `MenusPort` and a stub `MenusHostKit`: pins that every
 * host collaborator (version-conflict test and copy key, slug rule, slug-redirect rule, failure
 * channel) is reached through `deps.kit`, and that the split sub-hooks still compose the same
 * controller (load, tree edits, save).
 */

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

it("creates a menu with its chosen HTML and navigates to the server's canonical slug once", async () => {
  const navigate = vi.fn();
  const port = createFakeMenusPort();
  const persist = port.createMenu;
  const create = vi.spyOn(port, "createMenu").mockImplementation(({ input, options }) =>
    persist({ input: { ...input, slug: "summer-nav-2" }, options }),
  );
  const { result } = renderHook(() => useMenuEditor({ menuId: null, dependencies: { port, navigate, t: (key) => key, kit: stubKit() } }));
  act(() => {
    result.current.setTitle({ next: "Summer" });
    result.current.setSlug({ next: "summer-nav" });
  });
  act(() => result.current.changeMode("html"));
  expect(result.current.html).toBe('<a href="/">Home</a>');
  act(() => result.current.setHtml("<nav>Summer</nav>"));
  await act(async () => {
    const first = result.current.save();
    await result.current.save();
    await first;
  });
  expect(create.mock.calls).toEqual([[
    { input: { title: "Summer", slug: "summer-nav" }, options: { items: [], mode: "html", html: "<nav>Summer</nav>" } },
  ]]);
  expect(navigate.mock.calls).toEqual([["/menus/summer-nav-2"]]);
  expect((await port.getMenu({ id: "summer-nav-2" })).menu).toMatchObject({ title: "Summer", mode: "html", html: "<nav>Summer</nav>" });
});

it("loads pages only for page links, seeds HTML from the catalogue, and preserves authored markup across mode switches", async () => {
  const port = createFakeMenusPort({ menus: [MENU] });
  const listPages = vi.fn(async () => ({ pages: [{ id: "about", title: "About", status: "published" as const, publicPath: "/company/about" }] }));
  port.listPages = listPages;
  const itemIdSource = { nowMs: () => 22, random: () => 0.5 };
  const { result } = renderHook(() => useMenuEditor({ menuId: "m1", dependencies: { port, navigate: vi.fn(), t: (key) => key, kit: stubKit(), itemIdSource } }));
  await waitFor(() => expect(result.current.menu?.id).toBe("m1"));
  expect(listPages.mock.calls).toEqual([]);
  act(() => result.current.addChildAt({ path: [0] }));
  expect(result.current.items[0]?.children?.map(({ id }) => id)).toEqual(["item-22-i"]);
  act(() => result.current.changeAt({ path: [0, 0], fn: old => ({ ...old, label: "About us", target: { kind: "entryRef", entryId: "about" } }) }));
  await waitFor(() => expect(result.current.pageChoices?.map(({ id }) => id)).toEqual(["about"]));
  expect(listPages.mock.calls).toEqual([[{}]]);
  act(() => result.current.changeMode("html"));
  expect(result.current.html).toContain('<a href="/company/about">About us</a>');
  act(() => result.current.setHtml("<nav>Hand-edited</nav>"));
  act(() => result.current.changeMode("items"));
  act(() => result.current.removeAt({ path: [0, 0] }));
  expect(result.current.items[0]?.children).toEqual([]);
  expect(result.current.pageChoices).toBeUndefined();
  act(() => result.current.changeMode("html"));
  expect(result.current.html).toBe("<nav>Hand-edited</nav>");
  await act(() => result.current.save());
  expect((await port.getMenu({ id: "m1" })).menu).toMatchObject({
    mode: "html", html: "<nav>Hand-edited</nav>", items: [{ ...MENU.items[0], children: [] }], version: 2,
  });
});

it.each([
  { cause: new Error("Menu no longer exists"), message: "Menu no longer exists" },
  { cause: "host unavailable", message: "en:failed to load menu" },
])("normalizes a failed menu read as $message", async ({ cause, message }) => {
  const port = createFakeMenusPort();
  port.getMenu = vi.fn().mockRejectedValue(cause);
  const { result } = renderHook(() => useMenuEditor({ menuId: "missing", dependencies: { port, navigate: vi.fn(), t: (key) => `en:${key}`, kit: stubKit() } }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toBe(message);
  expect(result.current.menu).toBeNull();
});

it.each([
  { cause: new Error("Slug already exists"), message: "Slug already exists" },
  { cause: "garbled response", message: "save failed" },
])("exposes non-conflict save failure as $message", async ({ cause, message }) => {
  const port = createFakeMenusPort({ menus: [MENU] });
  port.updateMenuTree = vi.fn().mockRejectedValue(cause);
  const { result } = renderHook(() => useMenuEditor({ menuId: "m1", dependencies: { port, navigate: vi.fn(), t: (key) => key, kit: stubKit() } }));
  await waitFor(() => expect(result.current.menu?.id).toBe("m1"));
  act(() => result.current.setTitle({ next: "Still in draft" }));
  await act(() => result.current.save());
  expect(result.current.error).toBe(message);
  expect(result.current.title).toBe("Still in draft");
  expect(result.current.saving).toBe(false);
  expect((await port.getMenu({ id: "m1" })).menu.title).toBe("Main menu");
});

it("copies the persisted slug rather than an unsaved edit and keeps browser refusal local", async () => {
  const port = createFakeMenusPort({ menus: [MENU] });
  const writeText = vi.fn(async (_text: string) => {});
  const refusal = new Error("Not focused");
  const publishLocal = vi.fn();
  const kit = stubKit({ failures: { getGeneration: () => 4, isClipboardRefusal: ({ error }) => error === refusal, publishLocal } });
  const { result } = renderHook(() => useMenuEditor({
    menuId: "m1", dependencies: { port, navigate: vi.fn(), t: (key) => key, kit, clipboard: { writeText } },
  }));
  await waitFor(() => expect(result.current.menu?.id).toBe("m1"));
  act(() => result.current.setSlug({ next: "draft-slug" }));
  await act(() => result.current.copyHtmlEmbed());
  expect(writeText.mock.calls).toEqual([[`<div data-embed-config='{"type":"menu","id":"main","mode":"html"}'></div>`]]);
  expect(result.current.copyFeedback).toBe("Copied!");
  writeText.mockRejectedValueOnce(refusal);
  await act(() => result.current.copyHtmlEmbed());
  expect(result.current.copyFeedback).toBe("Could not copy embed");
  expect(publishLocal.mock.calls).toEqual([]);
});

it.each([true, false])("keeps the new route active when an old read finishes (rejected=%s)", async (reject) => {
  const port = createFakeMenusPort({ menus: [MENU] });
  let complete!: () => void;
  const pending = new Promise<{ menu: typeof MENU }>((resolve, refuse) => {
    complete = () => reject ? refuse(new Error("old failure")) : resolve({ menu: MENU });
  });
  const getMenu = vi.fn(() => pending);
  port.getMenu = getMenu;
  const navigate = vi.fn();
  const kit = stubKit({ slugRedirectPath: () => "/menus/stale-redirect" });
  const { result, rerender } = renderHook(({ menuId }: { menuId: string | null }) => useMenuEditor({
    menuId, dependencies: { port, navigate, t: (key) => key, kit },
  }), { initialProps: { menuId: "m1" } });
  expect(result.current.loading).toBe(true);
  await waitFor(() => expect(getMenu.mock.calls).toEqual([[{ id: "m1" }]]));
  rerender({ menuId: null });
  act(() => result.current.setTitle({ next: "New draft" }));
  await act(async () => complete());
  expect(result.current.title).toBe("New draft");
  expect(result.current.menu).toBeNull();
  expect(result.current.error).toBeNull();
  expect(navigate.mock.calls).toEqual([]);
});

it("keeps the new route loading when the previous read settles first", async () => {
  const fresh = { ...MENU, id: "m2", slug: "footer", title: "Footer" };
  let finishOld!: (value: { menu: typeof MENU }) => void;
  let finishNew!: (value: { menu: typeof MENU }) => void;
  const old = new Promise<{ menu: typeof MENU }>(resolve => { finishOld = resolve; });
  const next = new Promise<{ menu: typeof MENU }>(resolve => { finishNew = resolve; });
  const port = createFakeMenusPort();
  const getMenu = vi.fn<typeof port.getMenu>(({ id }) => {
    if (id === "m1") return old;
    if (id === "m2") return next;
    throw new Error(`Unexpected menu: ${id}`);
  });
  port.getMenu = getMenu;
  const dependencies = { port, navigate: vi.fn(), t: (key: string) => key, kit: stubKit() };
  const { result, rerender } = renderHook(({ menuId }) => useMenuEditor({ menuId, dependencies }), { initialProps: { menuId: "m1" } });
  await waitFor(() => expect(getMenu.mock.calls).toEqual([[{ id: "m1" }]]));
  rerender({ menuId: "m2" });
  await waitFor(() => expect(getMenu.mock.calls).toEqual([[{ id: "m1" }], [{ id: "m2" }]]));
  await act(async () => finishOld({ menu: MENU }));
  expect(result.current.loading).toBe(true);
  expect(result.current.menu).toBeNull();
  await act(async () => finishNew({ menu: fresh }));
  expect(result.current.loading).toBe(false);
  expect(result.current.menu).toEqual(fresh);
});

it.each([true, false])("does not publish a save settlement on a different menu (rejected=%s)", async (reject) => {
  const fresh = { ...MENU, id: "m2", slug: "footer", title: "Footer", version: 9 };
  const port = createFakeMenusPort({ menus: [MENU, fresh] });
  const write = port.updateMenuTree;
  const update = vi.spyOn(port, "updateMenuTree");
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  update.mockImplementationOnce(async (required) => {
    await gate;
    if (reject) throw new Error("Old write failed");
    return write(required);
  });
  const dependencies = { port, navigate: vi.fn(), t: (key: string) => key, kit: stubKit() };
  const { result, rerender } = renderHook(({ menuId }) => useMenuEditor({ menuId, dependencies }), { initialProps: { menuId: "m1" } });
  await waitFor(() => expect(result.current.menu?.id).toBe("m1"));
  act(() => result.current.setTitle({ next: "New header" }));
  let saving!: Promise<void>;
  act(() => { saving = result.current.save(); });
  await waitFor(() => expect(update.mock.calls).toEqual([[
    { target: { id: "m1", expectedVersion: 1, items: MENU.items }, options: { title: "New header", slug: "main" } },
  ]]));
  expect(result.current.saving).toBe(true);
  rerender({ menuId: "m2" });
  await waitFor(() => expect(result.current.menu?.id).toBe("m2"));
  await act(async () => { release(); await saving; });
  expect(result.current.menu).toEqual(fresh);
  expect(result.current.title).toBe("Footer");
  expect(result.current.message).toBeNull();
  expect(result.current.error).toBeNull();
  expect(result.current.saving).toBe(false);
  expect((await port.getMenu({ id: "m1" })).menu.title).toBe(reject ? "Main menu" : "New header");
});

it.each([true, false])("does not publish a clipboard settlement after changing routes (rejected=%s)", async (reject) => {
  const port = createFakeMenusPort({ menus: [MENU] });
  let finish!: () => void;
  const pending = new Promise<void>((resolve, refuse) => {
    finish = () => reject ? refuse(new Error("Old clipboard failure")) : resolve();
  });
  const writeText = vi.fn(() => pending);
  const publishLocal = vi.fn();
  const dependencies = {
    port, navigate: vi.fn(), t: (key: string) => key, clipboard: { writeText },
    kit: stubKit({ failures: { getGeneration: () => 7, isClipboardRefusal: () => false, publishLocal } }),
  };
  const { result, rerender } = renderHook(({ menuId }: { menuId: string | null }) => useMenuEditor({ menuId, dependencies }),
    { initialProps: { menuId: "m1" } });
  await waitFor(() => expect(result.current.menu?.id).toBe("m1"));
  let copying!: Promise<void>;
  act(() => { copying = result.current.copyHtmlEmbed(); });
  expect(writeText.mock.calls).toEqual([[`<div data-embed-config='{"type":"menu","id":"main","mode":"html"}'></div>`]]);
  rerender({ menuId: null });
  await act(async () => { finish(); await copying; });
  expect(result.current.copyFeedback).toBeNull();
  expect(publishLocal.mock.calls).toEqual([]);
});

it("does not save or copy while an existing menu has not been loaded yet", async () => {
  const port = createFakeMenusPort({ menus: [MENU] });
  let finish!: (value: { menu: typeof MENU }) => void;
  const load = new Promise<{ menu: typeof MENU }>(resolve => { finish = resolve; });
  port.getMenu = vi.fn(() => load);
  const create = vi.spyOn(port, "createMenu");
  const update = vi.spyOn(port, "updateMenuTree");
  const writeText = vi.fn(async () => {});
  const dependencies = { port, navigate: vi.fn(), t: (key: string) => key, kit: stubKit(), clipboard: { writeText } };
  const { result } = renderHook(() => useMenuEditor({ menuId: "m1", dependencies }));
  expect(result.current.loading).toBe(true);
  await act(async () => {
    await result.current.save();
    await result.current.copyHtmlEmbed();
  });
  expect(create.mock.calls).toEqual([]);
  expect(update.mock.calls).toEqual([]);
  expect(writeText.mock.calls).toEqual([]);
  expect(result.current.saving).toBe(false);
  await act(async () => finish({ menu: MENU }));
  expect(result.current.menu).toEqual(MENU);
});
