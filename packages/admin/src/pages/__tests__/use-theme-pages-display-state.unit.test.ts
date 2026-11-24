// @vitest-environment jsdom
import { act, renderHook, waitFor } from "../../__tests__/fetch-query-support.js";
import { describe, expect, it, vi } from "vitest";

import { createFakeThemePagesPort } from "../hooks/theme-pages-fake-port.js";
import type { ThemePagesFileEntry, ThemePagesPort } from "../hooks/theme-pages-port.hooks.js";
import { useThemePages } from "../hooks/use-theme-pages.hooks.js";

const ABOUT: ThemePagesFileEntry = {
  path: "render/pages/about.html", group: "page", published: false, resettable: true,
};

describe("theme pages display state characterization", () => {
  it("shows null rows, zero count and no error while presentation is pending", async () => {
    const port = createFakeThemePagesPort();
    let release!: (value: Awaited<ReturnType<typeof port.getPresentation>>) => void;
    const pending = new Promise<Awaited<ReturnType<typeof port.getPresentation>>>((resolve) => { release = resolve; });
    port.getPresentation = () => pending;
    const { result } = renderHook(() => useThemePages({ port, noThemeId: "none" }));
    expect(result.current.pages).toBeNull();
    expect(result.current.pageCount).toBe(0);
    expect(result.current.error).toBeNull();
    await act(async () => { release({ settings: { activeThemeId: "basic" } }); });
    await waitFor(() => expect(result.current.pages).toEqual([]));
    expect(result.current.pageCount).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it("counts only loaded page rows and retains their values", async () => {
    const port = createFakeThemePagesPort({ pageFiles: [
      ABOUT,
      { ...ABOUT, path: "render/pages/contact.html", published: true },
      { path: "theme.css", group: "style", published: null, resettable: false },
    ] });
    const { result } = renderHook(() => useThemePages({ port, noThemeId: "none" }));
    await waitFor(() => expect(result.current.pageCount).toBe(2));
    expect(result.current.pages).toEqual([
      { pageId: "about", filePath: ABOUT.path, published: false, resettable: true, collidingContent: null },
      { pageId: "contact", filePath: "render/pages/contact.html", published: true, resettable: true, collidingContent: null },
    ]);
    expect(result.current.error).toBeNull();
  });

  it.each(["presentation failed", ""])("retains presentation error message %j and unloaded rows", async (message) => {
    const port = createFakeThemePagesPort({ getPresentationError: new Error(message) });
    const detail = vi.spyOn(port, "getThemeDetail");
    const { result } = renderHook(() => useThemePages({ port, noThemeId: "none" }));
    await waitFor(() => expect(result.current.error).toBe(message));
    expect(result.current.pages).toBeNull();
    expect(result.current.pageCount).toBe(0);
    expect(detail).not.toHaveBeenCalled();
  });

  it.each(["detail failed", ""])("retains detail error message %j and unloaded rows", async (message) => {
    const port = createFakeThemePagesPort({ getThemeDetailError: new Error(message) });
    const { result } = renderHook(() => useThemePages({ port, noThemeId: "none" }));
    await waitFor(() => expect(result.current.error).toBe(message));
    expect(result.current.activeThemeId).toBe("basic");
    expect(result.current.pages).toBeNull();
    expect(result.current.pageCount).toBe(0);
  });

  it.each(["publish failed", ""])("prefers action error %j over detail failure and clears it on the next action", async (message) => {
    const port = createFakeThemePagesPort({ getThemeDetailError: new Error("detail failed") });
    port.setPagePublished = vi.fn<ThemePagesPort["setPagePublished"]>().mockRejectedValue(new Error(message));
    const { result } = renderHook(() => useThemePages({ port, noThemeId: "none" }));
    await waitFor(() => expect(result.current.error).toBe("detail failed"));
    await act(() => result.current.setPagePublished("about", true));
    expect(result.current.error).toBe(message);
    expect(result.current.savingPageId).toBeNull();
    expect(result.current.pages).toBeNull();
    expect(result.current.pageCount).toBe(0);

    let finish!: (value: { page: string; published: boolean }) => void;
    const pending = new Promise<{ page: string; published: boolean }>((resolve) => { finish = resolve; });
    port.setPagePublished = () => pending;
    let saving!: Promise<void>;
    act(() => { saving = result.current.setPagePublished("about", false); });
    await waitFor(() => expect(result.current.savingPageId).toBe("about"));
    expect(result.current.error).toBe("detail failed");
    await act(async () => { finish({ page: "about", published: false }); await saving; });
    expect(result.current.savingPageId).toBeNull();
    expect(result.current.error).toBe("detail failed");
  });
});
