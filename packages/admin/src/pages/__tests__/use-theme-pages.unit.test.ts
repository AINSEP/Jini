// @vitest-environment jsdom
import { renderHook, waitFor, act } from "../../__tests__/fetch-query-support.js";
import { describe, expect, it, vi } from "vitest";
import { useFetchQuery, useFetchMutation, useCachedLoader } from "../../react/kit.js";
const KIT_HOOKS = { useFetchQuery, useFetchMutation, useCachedLoader };

import { createFakeThemePagesPort } from "../hooks/theme-pages-fake-port.js";
import { useThemePages, type ThemePageRow } from "../hooks/use-theme-pages.hooks.js";
import type { ThemePagesFileEntry, ThemePagesPort } from "../hooks/theme-pages-port.hooks.js";

/**
 * @file `useThemePages` — the "Theme Pages" tab's data load.
 *
 * 2026-08-30 (deep-link/publish-toggle pass): rewritten alongside the port/dependencies change —
 * this hook used to expose a bare `pageIds: string[]` off one `getPresentation()` call; it now
 * chains into `getThemeDetail(activeThemeId)` for per-row publish/reset state, so the controller
 * shape changed from `pageIds` to `pages: ThemePageRow[]`. Confirmed RED against the pre-existing
 * version of this file (13 failures) before this rewrite — see the handoff for the verbatim run.
 */

const NO_THEME_ID = "none";
const useThemePagesFor = (port: ThemePagesPort) => useThemePages({ port, noThemeId: NO_THEME_ID, ...KIT_HOOKS });

const ABOUT: ThemePagesFileEntry = { path: "render/pages/about.html", group: "page", published: false, resettable: true };
const PRICING: ThemePagesFileEntry = { path: "render/pages/pricing.html", group: "page", published: true, resettable: true };
const INDEX: ThemePagesFileEntry = { path: "render/pages/index.html", group: "page", published: null, resettable: true };
const A_STYLE: ThemePagesFileEntry = { path: "css/theme.css", group: "style", published: null, resettable: true };
const COLLISION = { id: "post-1", slug: "about", title: "About Us", kind: "post" as const };
const ABOUT_WITH_COLLISION: ThemePagesFileEntry = { ...ABOUT, collidingContent: COLLISION };

describe("useThemePages", () => {
  it("resolves theme detail's page-group files into rows, without touching fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const port = createFakeThemePagesPort({ activeThemeId: "storefront", pageFiles: [ABOUT, PRICING] });
      const detailSpy = vi.spyOn(port, "getThemeDetail");
      const { result } = renderHook(() => useThemePagesFor(port));
      await waitFor(() => expect(result.current.pages).not.toBeNull());
      expect(result.current.pages).toEqual([
        { pageId: "about", filePath: "render/pages/about.html", published: false, resettable: true, collidingContent: null },
        { pageId: "pricing", filePath: "render/pages/pricing.html", published: true, resettable: true, collidingContent: null },
      ]);
      expect(result.current.error).toBeNull();
      expect(detailSpy).toHaveBeenCalledExactlyOnceWith({ themeId: "storefront" });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("drops non-'page'-group files from the row list", async () => {
    const port = createFakeThemePagesPort({ pageFiles: [ABOUT, A_STYLE] });
    const { result } = renderHook(() => useThemePagesFor(port));
    await waitFor(() => expect(result.current.pages).not.toBeNull());
    expect(result.current.pages).toEqual([
      { pageId: "about", filePath: "render/pages/about.html", published: false, resettable: true, collidingContent: null },
    ]);
  });

  /**
   * `pageCount` (2026-09-04, complexity-ceiling pass) — `Pages.tsx`'s TabBar count for this tab,
   * moved here from a `themePages?.length ?? 0` expression that used to live in `Pages.tsx` itself.
   * Pinning both ends of its own derivation: `0` before `pages` resolves, then the resolved row
   * count once it does — not `pageFiles.length` (`A_STYLE` here is filtered out before `pages` ever
   * sees it, same fixture as the row-list test just above).
   */
  it("pageCount is 0 while pages is still null, then the resolved row count", async () => {
    const port = createFakeThemePagesPort({ pageFiles: [ABOUT, A_STYLE] });
    const { result } = renderHook(() => useThemePagesFor(port));
    expect(result.current.pageCount).toBe(0);
    await waitFor(() => expect(result.current.pages).not.toBeNull());
    expect(result.current.pageCount).toBe(1);
  });

  /**
   * 2026-08-31 pass: the Theme Pages tab's details modal shows any live content record already
   * claiming a page's slug — the same fact Theme Studio's Explore screen reflects in its Publish
   * toggle's inline hint. `getThemeDetail`'s own `collidingContent` now flows
   * straight through into the row, same `?? null` normalization `published` already gets.
   */
  it("carries a file's collidingContent straight into its row, defaulting to null when absent", async () => {
    const port = createFakeThemePagesPort({ pageFiles: [ABOUT_WITH_COLLISION, PRICING] });
    const { result } = renderHook(() => useThemePagesFor(port));
    await waitFor(() => expect(result.current.pages).not.toBeNull());
    expect(result.current.pages?.find((p) => p.pageId === "about")?.collidingContent).toEqual(COLLISION);
    expect(result.current.pages?.find((p) => p.pageId === "pricing")?.collidingContent).toBeNull();
  });

  it("keeps a null `published` for a page the publish question doesn't apply to (index/404/a template shell)", async () => {
    const port = createFakeThemePagesPort({ pageFiles: [INDEX] });
    const { result } = renderHook(() => useThemePagesFor(port));
    await waitFor(() => expect(result.current.pages).not.toBeNull());
    expect(result.current.pages?.[0]?.published).toBeNull();
  });

  /**
   * The Theme Pages tab's URL cell links into the theme studio (`?theme=&page=`), and every publish
   * call needs a theme id too, so this hook still exposes the ACTIVE theme id from the same
   * `getPresentation()` response it always has.
   */
  it("also exposes the active theme id from the presentation response", async () => {
    const port = createFakeThemePagesPort({ activeThemeId: "storefront", pageFiles: [INDEX] });
    const { result } = renderHook(() => useThemePagesFor(port));
    await waitFor(() => expect(result.current.pages).not.toBeNull());
    expect(result.current.activeThemeId).toBe("storefront");
  });

  it("leaves activeThemeId null until the load settles, so no link/publish call can be built from a half-loaded state", async () => {
    const port = createFakeThemePagesPort({ activeThemeId: "basic", pageFiles: [] });
    const { result } = renderHook(() => useThemePagesFor(port));
    expect(result.current.activeThemeId).toBeNull();
    await waitFor(() => expect(result.current.activeThemeId).toBe("basic"));
  });

  it("resolves to [] (not an error) when the active theme ships no pages", async () => {
    const port = createFakeThemePagesPort({ pageFiles: [] });
    const { result } = renderHook(() => useThemePagesFor(port));
    await waitFor(() => expect(result.current.pages).not.toBeNull());
    expect(result.current.pages).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  /**
   * 2026-09-12 regression: turning the theme off (`activeThemeId === NO_THEME_ID`) used to still
   * chain into `getThemeDetail("none")`, which the server 404s — this hook then surfaced that as
   * an `error`, and the Theme Pages screen rendered an error banner for a state the operator chose
   * deliberately. `"none"` is a sentinel, not a real theme id, so no detail call should ever be
   * made for it; the tab should show its ordinary empty state instead (`ThemePagesTab`'s `empty`
   * prop), the same as a real theme that ships no pages.
   */
  it("short-circuits to [] without calling getThemeDetail when the theme is disabled (NO_THEME_ID)", async () => {
    const port = createFakeThemePagesPort({
      activeThemeId: NO_THEME_ID,
      // Stands in for the server's real 404 on `getThemeDetail("none")` — set so the test fails
      // loudly (via `result.current.error`) if the short-circuit regresses and this ever fires.
      getThemeDetailError: new Error("404 theme not found"),
    });
    const getThemeDetailSpy = vi.spyOn(port, "getThemeDetail");
    const { result } = renderHook(() => useThemePagesFor(port));
    await waitFor(() => expect(result.current.pages).not.toBeNull());
    expect(result.current.pages).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.activeThemeId).toBe(NO_THEME_ID);
    expect(getThemeDetailSpy).not.toHaveBeenCalled();
  });

  it("sets the fallback error when getPresentation rejects", async () => {
    const port = createFakeThemePagesPort({ getPresentationError: new Error("boom") });
    const { result } = renderHook(() => useThemePagesFor(port));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toBe("boom");
    expect(result.current.pages).toBeNull();
  });

  it("uses the load fallback for a non-Error presentation rejection", async () => {
    const port = createFakeThemePagesPort();
    port.getPresentation = async () => { throw "presentation unavailable"; };
    const { result } = renderHook(() => useThemePagesFor(port));
    await waitFor(() => expect(result.current.error).toBe("failed to load theme pages"));
    expect(result.current.activeThemeId).toBeNull();
    expect(result.current.pages).toBeNull();
  });

  it("keeps the theme id and uses the load fallback for a non-Error detail rejection", async () => {
    const port = createFakeThemePagesPort({ activeThemeId: "storefront" });
    port.getThemeDetail = async () => { throw null; };
    const { result } = renderHook(() => useThemePagesFor(port));
    await waitFor(() => expect(result.current.error).toBe("failed to load theme pages"));
    expect(result.current.activeThemeId).toBe("storefront");
    expect(result.current.pages).toBeNull();
  });

  it("sets the fallback error when the second, chained getThemeDetail call rejects", async () => {
    const port = createFakeThemePagesPort({ getThemeDetailError: new Error("detail boom") });
    const { result } = renderHook(() => useThemePagesFor(port));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toBe("detail boom");
    expect(result.current.pages).toBeNull();
    // The first leg of the chain still resolved — proves this is a genuine two-request chain, not
    // one request whose failure happens to look the same.
    expect(result.current.activeThemeId).toBe("basic");
  });

  describe("setPagePublished", () => {
    it("finishes a publish before the first detail read has filled the cache", async () => {
      const port = createFakeThemePagesPort({ pageFiles: [ABOUT] });
      const readDetail = port.getThemeDetail;
      let releaseDetail!: () => void;
      const pending = new Promise<void>((resolve) => { releaseDetail = resolve; });
      port.getThemeDetail = async (themeId) => { await pending; return readDetail(themeId); };
      const { result } = renderHook(() => useThemePagesFor(port));
      await waitFor(() => expect(result.current.activeThemeId).toBe("basic"));
      expect(result.current.pages).toBeNull();

      await act(() => result.current.setPagePublished("about", true));
      expect(result.current.savingPageId).toBeNull();
      expect(result.current.error).toBeNull();
      expect(result.current.pages).toBeNull();
      expect((await readDetail({ themeId: "basic" })).files).toContainEqual({ ...ABOUT, published: true });

      await act(async () => { releaseDetail(); });
      await waitFor(() => expect(result.current.pages).toEqual([
        { pageId: "about", filePath: ABOUT.path, published: true, resettable: true, collidingContent: null },
      ]));
    });

    it("uses the publish fallback for a non-Error rejection and retains the stored row", async () => {
      const port = createFakeThemePagesPort({ pageFiles: [ABOUT] });
      port.setPagePublished = async () => { throw { reason: "write unavailable" }; };
      const { result } = renderHook(() => useThemePagesFor(port));
      await waitFor(() => expect(result.current.pages).not.toBeNull());

      await act(() => result.current.setPagePublished("about", true));
      expect(result.current.error).toBe("failed to update publish state");
      expect(result.current.savingPageId).toBeNull();
      expect(result.current.pages).toEqual([
        { pageId: "about", filePath: ABOUT.path, published: false, resettable: true, collidingContent: null },
      ]);
      expect((await port.getThemeDetail({ themeId: "basic" })).files).toEqual([ABOUT]);
    });

    it("publishes a row and updates it in place, tracking savingPageId only for that row", async () => {
      const port = createFakeThemePagesPort({ activeThemeId: "storefront", pageFiles: [ABOUT, PRICING] });
      const publishSpy = vi.spyOn(port, "setPagePublished");
      const { result } = renderHook(() => useThemePagesFor(port));
      await waitFor(() => expect(result.current.pages).not.toBeNull());

      let settled: Promise<void> = Promise.resolve();
      act(() => {
        settled = result.current.setPagePublished("about", true);
      });
      // Only the row being saved reports it — `pricing` is untouched and not "saving" too.
      await waitFor(() => expect(result.current.savingPageId).toBe("about"));
      await act(() => settled);

      expect(result.current.savingPageId).toBeNull();
      expect(result.current.pages?.find((p) => p.pageId === "about")?.published).toBe(true);
      expect(result.current.pages?.find((p) => p.pageId === "pricing")?.published).toBe(true);
      expect(publishSpy).toHaveBeenCalledExactlyOnceWith({ themeId: "storefront", page: "about", published: true });
      const persisted = await port.getThemeDetail({ themeId: "storefront" });
      expect(persisted.files.find((f) => f.path === ABOUT.path)?.published).toBe(true);
    });

    it("is a no-op — no port call, no state change — before activeThemeId has resolved", async () => {
      const port = createFakeThemePagesPort({ pageFiles: [ABOUT] });
      const setPagePublishedSpy = vi.spyOn(port, "setPagePublished");
      const { result } = renderHook(() => useThemePagesFor(port));
      // Deliberately not awaited past this point — activeThemeId is still null.
      await act(() => result.current.setPagePublished("about", true));
      expect(setPagePublishedSpy).not.toHaveBeenCalled();
    });

    it("sets the fallback error, and clears savingPageId, when the port rejects", async () => {
      const port = createFakeThemePagesPort({
        activeThemeId: "basic",
        pageFiles: [ABOUT],
        setPagePublishedError: new Error("publish boom"),
      });
      const { result } = renderHook(() => useThemePagesFor(port));
      await waitFor(() => expect(result.current.pages).not.toBeNull());
      await act(() => result.current.setPagePublished("about", true));
      expect(result.current.error).toBe("publish boom");
      expect(result.current.savingPageId).toBeNull();
      // The row's own state is untouched by a failed call.
      expect(result.current.pages?.find((p) => p.pageId === "about")?.published).toBe(false);
    });
  });
});
